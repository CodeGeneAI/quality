import fg from "fast-glob";
import micromatch from "micromatch";
import { performance } from "perf_hooks";
import { getAdapter } from "../adapters/registry";
import type { StageExecutionResult } from "../adapters/types";
import type { ResolvedConfig } from "../config/loader";
import type { QualityMode, ResolvedStage } from "../config/types";
import { runReporters } from "../reporters";
import type {
  PipelineResult,
  ReporterDefinition,
  StageResultSummary,
} from "../reporters/types";
import { debugLog } from "../runtime/debug";
import { isTelemetryEnabled, publishTelemetry } from "../runtime/telemetry";
import { DEFAULT_GLOB_IGNORE, shouldIgnorePath } from "../utils/glob";
import {
  type HookRunOutcome,
  runHookSequence,
  runStageFailureHooks,
} from "./hooks";

const DEFAULT_STAGE_IGNORE_PATTERNS = DEFAULT_GLOB_IGNORE;

export interface PipelineRunOptions {
  readonly mode: QualityMode;
  readonly files: readonly string[];
  readonly config: ResolvedConfig;
  readonly reporterDefinitions: readonly ReporterDefinition[];
  readonly stages?: readonly ResolvedStage[];
  readonly telemetry?: {
    readonly context: string;
    readonly metadata?: Record<string, unknown>;
  };
  readonly onStageStart?: StageLifecycleHandler;
  readonly onStageComplete?: StageCompletionHandler;
}

export interface PipelineRunResult extends PipelineResult {}

interface StageExecutionOutcome {
  readonly summary: StageResultSummary;
  readonly shouldHalt: boolean;
}

interface PipelineContext {
  readonly mode: QualityMode;
  readonly files: readonly string[];
  readonly root: string;
}

type StageLifecycleHandler = (stage: ResolvedStage) => void | Promise<void>;
type StageCompletionHandler = (
  summary: StageResultSummary,
) => void | Promise<void>;

interface StageEventHandlers {
  readonly onStageStart?: StageLifecycleHandler;
  readonly onStageComplete?: StageCompletionHandler;
}

export const runPipeline = async (
  options: PipelineRunOptions,
): Promise<PipelineRunResult> => {
  const { config, mode, files } = options;
  const pipelineStages = options.stages ?? config.profile.pipeline;
  const startedAt = new Date();
  const stageResults: StageResultSummary[] = [];
  let success = true;
  let haltPipeline = false;
  const hooks = config.profile.hooks;
  const hookContext = { root: config.root };
  const { onStageStart, onStageComplete } = options;

  const recordStageSummary = async (
    summary: StageResultSummary,
    emitProgress = true,
  ) => {
    if (emitProgress && onStageComplete) {
      await onStageComplete(summary);
    }
    stageResults.push(summary);
  };

  debugLog(
    "pipeline",
    () => `starting pipeline (profile=${config.profile.name}, mode=${mode})`,
    () => ({
      files,
      stageCount: pipelineStages.length,
      stages: pipelineStages.map((stage) => stage.id),
    }),
  );

  const applyHookOutcome = (outcome: HookRunOutcome) => {
    if (!outcome.success) {
      success = false;
    }
    if (outcome.shouldHalt) {
      haltPipeline = true;
    }
  };

  const startHooksOutcome = await runHookSequence(hooks.onStart, hookContext);
  applyHookOutcome(startHooksOutcome);

  for (let index = 0; index < pipelineStages.length; index += 1) {
    const stage = pipelineStages[index];

    if (haltPipeline) {
      const summary = createStageResult(stage, "skipped", 0, [
        "Skipped due to earlier failure.",
      ]);
      await recordStageSummary(summary);
      continue;
    }

    if (stage.group?.parallel) {
      const { results, shouldHalt, lastIndex, groupSuccess } =
        await runParallelGroup(
          pipelineStages,
          index,
          {
            mode,
            files,
            root: config.root,
          },
          { onStageStart, onStageComplete },
        );
      for (const result of results) {
        await recordStageSummary(result.summary, false);
        if (result.summary.status === "failed") {
          success = false;
          if (!haltPipeline) {
            const outcome = await runStageFailureHooks(
              hooks.onStageFail,
              result.summary.id,
              hookContext,
            );
            applyHookOutcome(outcome);
          }
        }
      }
      if (!groupSuccess) {
        success = false;
      }
      if (shouldHalt) {
        haltPipeline = true;
      }
      index = lastIndex;
      continue;
    }

    if (onStageStart) {
      await onStageStart(stage);
    }
    const outcome = await executeStage(stage, {
      mode,
      files,
      root: config.root,
    });
    await recordStageSummary(outcome.summary);
    if (outcome.summary.status === "failed") {
      success = false;
      if (!haltPipeline) {
        const hookOutcome = await runStageFailureHooks(
          hooks.onStageFail,
          stage.id,
          hookContext,
        );
        applyHookOutcome(hookOutcome);
      }
    }
    if (outcome.shouldHalt) {
      haltPipeline = true;
    }
  }

  const finishedAt = new Date();
  const completeHooksOutcome = await runHookSequence(
    hooks.onComplete,
    hookContext,
  );
  applyHookOutcome(completeHooksOutcome);

  if (!haltPipeline && success) {
    const successHooksOutcome = await runHookSequence(
      hooks.onSuccess,
      hookContext,
    );
    applyHookOutcome(successHooksOutcome);
  }

  const pipelineResult: PipelineResult = {
    profile: config.profile.name,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    stages: stageResults,
    success,
  } satisfies PipelineResult;

  if (isTelemetryEnabled()) {
    await publishTelemetry({
      context:
        options.telemetry?.context ?? `pipeline:${config.profile.name}:${mode}`,
      result: pipelineResult,
      files,
      root: config.root,
      metadata: options.telemetry?.metadata,
    });
  }

  await runReporters(pipelineResult, options.reporterDefinitions, config.root);

  debugLog(
    "pipeline",
    () => `finished pipeline (profile=${config.profile.name}, mode=${mode})`,
    () => ({
      success: pipelineResult.success,
      durationMs: Math.max(
        0,
        Date.parse(pipelineResult.finishedAt) - startedAt.getTime(),
      ),
    }),
  );

  return pipelineResult;
};

const runParallelGroup = async (
  pipeline: readonly ResolvedStage[],
  startIndex: number,
  context: PipelineContext,
  handlers: StageEventHandlers,
): Promise<{
  readonly results: readonly StageExecutionOutcome[];
  readonly shouldHalt: boolean;
  readonly lastIndex: number;
  readonly groupSuccess: boolean;
}> => {
  const baseStage = pipeline[startIndex];
  const groupId = baseStage.group?.id;
  const { onStageStart, onStageComplete } = handlers;
  if (!groupId || !baseStage.group.parallel) {
    if (onStageStart) {
      await onStageStart(baseStage);
    }
    const outcome = await executeStage(baseStage, context);
    if (onStageComplete) {
      await onStageComplete(outcome.summary);
    }
    return {
      results: [outcome],
      shouldHalt: outcome.shouldHalt,
      lastIndex: startIndex,
      groupSuccess: outcome.summary.status !== "failed",
    };
  }

  const grouped: Array<{ stage: ResolvedStage; index: number }> = [];
  let cursor = startIndex;
  while (cursor < pipeline.length) {
    const candidate = pipeline[cursor];
    if (!candidate.group || candidate.group.id !== groupId) {
      break;
    }
    if (!candidate.group.parallel) {
      break;
    }
    grouped.push({ stage: candidate, index: cursor });
    cursor += 1;
  }

  const abortController = new AbortController();
  const results = new Map<number, StageExecutionOutcome>();
  let shouldHalt = false;
  let groupSuccess = true;

  await Promise.all(
    grouped.map(async ({ stage, index }) => {
      if (onStageStart) {
        await onStageStart(stage);
      }
      const outcome = await executeStage(
        stage,
        context,
        abortController.signal,
      );
      if (onStageComplete) {
        await onStageComplete(outcome.summary);
      }
      results.set(index, outcome);
      if (outcome.summary.status === "failed") {
        groupSuccess = false;
      }
      if (outcome.shouldHalt) {
        shouldHalt = true;
        if (stage.group?.failFast ?? true) {
          abortController.abort();
        }
      }
    }),
  );

  const orderedResults = grouped.map(
    ({ index }) =>
      results.get(index) ?? {
        summary: createStageResult(pipeline[index], "skipped", 0, [
          "Aborted before execution.",
        ]),
        shouldHalt,
      },
  );

  return {
    results: orderedResults,
    shouldHalt,
    lastIndex: grouped[grouped.length - 1]?.index ?? startIndex,
    groupSuccess,
  };
};

const executeStage = async (
  stage: ResolvedStage,
  context: PipelineContext,
  abortSignal?: AbortSignal,
): Promise<StageExecutionOutcome> => {
  if (!shouldRunStage(stage)) {
    return {
      summary: createStageResult(stage, "skipped", 0, []),
      shouldHalt: false,
    };
  }

  const signal = abortSignal ?? new AbortController().signal;
  if (signal.aborted) {
    return {
      summary: createStageResult(stage, "skipped", 0, ["Stage aborted."]),
      shouldHalt: false,
    };
  }

  const adapter = getAdapter(stage.type);
  if (!adapter) {
    return {
      summary: createStageResult(stage, "failed", 0, [
        `Stage adapter '${stage.type}' is not registered.`,
      ]),
      shouldHalt: true,
    };
  }

  const stageMode = stage.mode ?? context.mode;
  if (adapter.supportsModes && !adapter.supportsModes.includes(stageMode)) {
    if (stageMode === "fix") {
      return {
        summary: createStageResult(stage, "skipped", 0, [
          `Stage adapter '${stage.type}' does not support mode 'fix'; skipping.`,
        ]),
        shouldHalt: false,
      } satisfies StageExecutionOutcome;
    }
    return {
      summary: createStageResult(stage, "failed", 0, [
        `Stage adapter '${stage.type}' does not support mode '${stageMode}'.`,
      ]),
      shouldHalt: true,
    } satisfies StageExecutionOutcome;
  }

  const stageFiles = await resolveStageFiles(
    stage,
    context.files,
    context.root,
  );
  const start = performance.now();
  let result: StageExecutionResult;
  try {
    result = await adapter.run({
      root: context.root,
      pipelineMode: context.mode,
      mode: stageMode,
      stage,
      files: stageFiles,
      options: stage.options ?? {},
      abortSignal: signal,
    });
  } catch (error) {
    if (signal.aborted) {
      result = {
        status: "skipped",
        messages: ["Stage aborted."],
      } satisfies StageExecutionResult;
    } else {
      result = {
        status: "failed",
        messages: [error instanceof Error ? error.message : String(error)],
      } satisfies StageExecutionResult;
    }
  }
  const durationMs = performance.now() - start;
  const summary = createStageResult(
    stage,
    result.status,
    durationMs,
    result.messages ?? [],
    result.details,
  );
  const shouldHalt = result.status === "failed" && !stage.continueOnError;
  return { summary, shouldHalt } satisfies StageExecutionOutcome;
};

const shouldRunStage = (stage: ResolvedStage): boolean => {
  if (!stage.if) {
    return true;
  }
  try {
    const fn = new Function("env", `return (${stage.if});`);
    return Boolean(fn(process.env));
  } catch (error) {
    console.error(
      `Failed to evaluate condition '${stage.if}' for stage '${stage.id}':`,
      error,
    );
    return false;
  }
};

const shouldIgnoreStageFile = (file: string): boolean =>
  shouldIgnorePath(file, DEFAULT_STAGE_IGNORE_PATTERNS);

const resolveStageFiles = async (
  stage: ResolvedStage,
  cliFiles: readonly string[],
  root: string,
): Promise<string[]> => {
  if (cliFiles.length > 0) {
    const candidates = cliFiles.filter((file) => !shouldIgnoreStageFile(file));
    const patterns = buildStageMatchPatterns(stage);
    if (patterns.length === 0) {
      return candidates;
    }
    return micromatch(candidates, patterns, {
      dot: true,
    });
  }
  if (!stage.files || stage.files.length === 0) {
    return [];
  }
  const patterns = Array.from(stage.files);
  const matches = fg.sync(patterns, {
    cwd: root,
    dot: true,
    ignore: [...DEFAULT_STAGE_IGNORE_PATTERNS],
  });
  return matches.filter((file) => !shouldIgnoreStageFile(file));
};

const buildStageMatchPatterns = (stage: ResolvedStage): string[] => {
  const patterns: string[] = [];
  if (stage.files) {
    patterns.push(...stage.files);
  }
  if (stage.appliesTo?.paths) {
    patterns.push(...stage.appliesTo.paths);
  }
  return patterns;
};

const createStageResult = (
  stage: ResolvedStage,
  status: StageResultSummary["status"],
  durationMs: number,
  messages: readonly string[],
  details?: Record<string, unknown>,
): StageResultSummary => ({
  id: stage.id,
  type: stage.type,
  label: stage.label,
  preset: stage.preset,
  group: stage.group
    ? { id: stage.group.id, label: stage.group.label }
    : undefined,
  status,
  durationMs,
  messages: [...messages],
  details,
});
