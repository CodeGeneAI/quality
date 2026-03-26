import micromatch from "micromatch";
import { performance } from "perf_hooks";
import { getAdapter } from "../adapters/registry";
import type { StageExecutionResult } from "../adapters/types";
import type { ResolvedConfig } from "../config/loader";
import type { QualityMode, ResolvedStage } from "../config/types";
import { runReporters } from "../reporters";
import type {
  PipelineResult,
  ReporterSpec,
  StageResultSummary,
  StageStatus,
} from "../reporters/types";
import { debugLog } from "../runtime/debug";
import { isTelemetryEnabled, publishTelemetry } from "../runtime/telemetry";
import fg from "../utils/bun-glob";
import { evaluateCondition } from "../utils/condition";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../utils/glob";
import {
  type HookRunOutcome,
  runHookSequence,
  runStageFailureHooks,
} from "./hooks";

const DEFAULT_STAGE_IGNORE_PATTERNS = DEFAULT_GLOB_IGNORE;
const getParallelLimitFromEnv = (): number | undefined => {
  const rawLimit = process.env.QUALITY_PARALLEL_LIMIT;
  if (!rawLimit) {
    return undefined;
  }
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed)) {
    console.warn("Ignoring QUALITY_PARALLEL_LIMIT because it is not a number.");
    return undefined;
  }
  return parsed;
};

type ParallelLimitSource = "profile" | "env" | "none";

const sanitizeParallelLimit = (
  value: number | undefined,
  source: ParallelLimitSource,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (Number.isNaN(value) || value < 1) {
    console.warn(
      `Discarding invalid parallelLimit from ${source}: ${value}. Expected a positive integer.`,
    );
    return undefined;
  }
  return value;
};

const resolveParallelLimitPreference = (
  profileLimit: number | undefined,
  envLimit: number | undefined,
): { limit?: number; source: ParallelLimitSource } => {
  const normalizedProfile = sanitizeParallelLimit(profileLimit, "profile");
  if (normalizedProfile !== undefined) {
    return { limit: normalizedProfile, source: "profile" };
  }

  const normalizedEnv = sanitizeParallelLimit(envLimit, "env");
  if (normalizedEnv !== undefined) {
    return { limit: normalizedEnv, source: "env" };
  }

  return { limit: undefined, source: "none" };
};

export interface PipelineRunOptions {
  readonly mode: QualityMode;
  readonly files: readonly string[];
  readonly config: ResolvedConfig;
  readonly reporterSpecs: readonly ReporterSpec[];
  readonly stages?: readonly ResolvedStage[];
  readonly dryRun?: boolean;
  readonly telemetry?: {
    readonly context: string;
    readonly metadata?: Record<string, unknown>;
  };
  readonly onStageStart?: StageLifecycleHandler;
  readonly onStageComplete?: StageCompletionHandler;
}

export interface PipelineRunResult extends PipelineResult {}

export interface StageTimingMetadataEntry {
  readonly id: string;
  readonly status: StageStatus;
  readonly durationMs: number;
  readonly groupId?: string;
}

export interface StageTimingMetadata {
  readonly pipelineDurationMs: number;
  readonly serialDurationMs: number;
  readonly averageStageDurationMs: number;
  readonly longestStage?: StageTimingMetadataEntry;
  readonly stages: readonly StageTimingMetadataEntry[];
}

interface StageExecutionOutcome {
  readonly summary: StageResultSummary;
  readonly shouldHalt: boolean;
}

interface PipelineContext {
  readonly mode: QualityMode;
  readonly files: readonly string[];
  readonly root: string;
  readonly ignore: readonly string[];
  readonly globCache: Map<string, Promise<string[]>>;
  readonly parallelLimit?: number;
  readonly parallelLimitSource: ParallelLimitSource;
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
  const { config, mode } = options;
  const pipelineStages = options.stages ?? config.profile.pipeline;
  const isDryRun = options.dryRun === true;
  const startedAt = new Date();
  const stageResults: StageResultSummary[] = [];
  let success = true;
  let haltPipeline = false;
  const hooks = config.profile.hooks;
  const hookContext = { root: config.root };
  const { onStageStart, onStageComplete } = options;
  const pipelineFiles = filterIgnoredFiles(options.files, config.ignore);
  const globCache = new Map<string, Promise<string[]>>();
  const parallelLimitPreference = resolveParallelLimitPreference(
    config.profile.parallelLimit,
    getParallelLimitFromEnv(),
  );

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
      files: pipelineFiles,
      stageCount: pipelineStages.length,
      stages: pipelineStages.map((stage) => stage.id),
      parallelLimit: parallelLimitPreference.limit ?? null,
      parallelLimitSource: parallelLimitPreference.source,
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

  if (isDryRun) {
    for (const stage of pipelineStages) {
      if (!shouldRunStage(stage)) {
        await recordStageSummary(
          createStageResult(stage, "skipped", 0, [
            stage.if
              ? `Condition '${stage.if}' evaluated to false; stage skipped.`
              : "Stage skipped.",
          ]),
        );
        continue;
      }

      const filesForStage = await resolveStageFiles(
        stage,
        pipelineFiles,
        config.root,
        config.ignore,
        globCache,
      );
      const dryRunMessages = buildDryRunMessages(stage, filesForStage);
      await recordStageSummary(
        createStageResult(stage, "dry-run", 0, dryRunMessages, {
          files: filesForStage,
        }),
      );
    }

    const finishedAt = new Date();
    const pipelineResult: PipelineResult = {
      profile: config.profile.name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      stages: stageResults,
      success: true,
    } satisfies PipelineResult;

    await runReporters(pipelineResult, options.reporterSpecs, config.root);
    return pipelineResult;
  }

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
            files: pipelineFiles,
            root: config.root,
            ignore: config.ignore,
            globCache,
            parallelLimit: parallelLimitPreference.limit,
            parallelLimitSource: parallelLimitPreference.source,
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
      files: pipelineFiles,
      root: config.root,
      ignore: config.ignore,
      globCache,
      parallelLimit: parallelLimitPreference.limit,
      parallelLimitSource: parallelLimitPreference.source,
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

  const telemetryMetadata = {
    ...options.telemetry?.metadata,
    parallelLimit: parallelLimitPreference.limit ?? null,
    parallelLimitSource: parallelLimitPreference.source,
    stageTiming: buildStageTimingMetadata(pipelineResult),
  };

  if (isTelemetryEnabled() && !isDryRun) {
    await publishTelemetry({
      context:
        options.telemetry?.context ?? `pipeline:${config.profile.name}:${mode}`,
      result: pipelineResult,
      files: pipelineFiles,
      root: config.root,
      metadata: telemetryMetadata,
    });
  }

  await runReporters(pipelineResult, options.reporterSpecs, config.root);

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

const resolveParallelLimit = (
  requestedLimit: number | undefined,
  groupSize: number,
): number => {
  if (!requestedLimit || Number.isNaN(requestedLimit) || requestedLimit < 1) {
    return groupSize;
  }
  return Math.min(requestedLimit, groupSize);
};

export const buildStageTimingMetadata = (
  result: PipelineResult,
): StageTimingMetadata => {
  const startedAt = Date.parse(result.startedAt);
  const finishedAt = Date.parse(result.finishedAt);
  const pipelineDurationMs = Number.isFinite(finishedAt - startedAt)
    ? Math.max(0, finishedAt - startedAt)
    : 0;

  const stages: StageTimingMetadataEntry[] = result.stages.map((stage) => ({
    id: stage.id,
    status: stage.status,
    durationMs: Number.isFinite(stage.durationMs)
      ? Math.max(0, stage.durationMs)
      : 0,
    groupId: stage.group?.id,
  }));

  const serialDurationMs = stages.reduce(
    (total, entry) => total + entry.durationMs,
    0,
  );

  const longestStage = stages.reduce<StageTimingMetadataEntry | undefined>(
    (longest, entry) => {
      if (!longest || entry.durationMs > longest.durationMs) {
        return entry;
      }
      return longest;
    },
    undefined,
  );

  const averageStageDurationMs =
    stages.length === 0 ? 0 : serialDurationMs / stages.length;

  return {
    pipelineDurationMs,
    serialDurationMs,
    averageStageDurationMs,
    longestStage,
    stages,
  } satisfies StageTimingMetadata;
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
  let pipelineCursor = startIndex;
  while (pipelineCursor < pipeline.length) {
    const candidate = pipeline[pipelineCursor];
    if (!candidate.group || candidate.group.id !== groupId) {
      break;
    }
    if (!candidate.group.parallel) {
      break;
    }
    grouped.push({ stage: candidate, index: pipelineCursor });
    pipelineCursor += 1;
  }

  const abortController = new AbortController();
  const results = new Map<number, StageExecutionOutcome>();
  let shouldHalt = false;
  let groupSuccess = true;

  const groupedLimit = resolveParallelLimit(
    context.parallelLimit,
    grouped.length,
  );
  let workCursor = 0;

  const runWorker = async (): Promise<void> => {
    while (workCursor < grouped.length) {
      const current = workCursor;
      workCursor += 1;
      const { stage, index } = grouped[current];
      if (abortController.signal.aborted) {
        results.set(index, {
          summary: createStageResult(stage, "skipped", 0, [
            "Aborted before execution.",
          ]),
          shouldHalt: true,
        });
        continue;
      }

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
    }
  };

  const workerCount = Math.max(1, groupedLimit);
  const workers = Array.from({ length: workerCount }, () => runWorker());
  await Promise.all(workers);

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
    context.ignore,
    context.globCache,
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
      ignore: context.ignore,
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
    return evaluateCondition(stage.if, { env: process.env });
  } catch (error) {
    console.error(
      `Failed to evaluate condition '${stage.if}' for stage '${stage.id}':`,
      error,
    );
    return false;
  }
};

const shouldIgnoreStageFile = (
  file: string,
  patterns: readonly string[],
): boolean => shouldIgnorePath(file, patterns);

const filterIgnoredFiles = (
  values: readonly string[],
  patterns: readonly string[] | undefined,
): string[] => {
  if (!values || values.length === 0) {
    return [];
  }
  if (!patterns || patterns.length === 0) {
    return [...values];
  }
  return values.filter((file) => !shouldIgnorePath(file, patterns));
};

const resolveStageFiles = async (
  stage: ResolvedStage,
  cliFiles: readonly string[],
  root: string,
  globalIgnore: readonly string[],
  cache?: Map<string, Promise<string[]>>,
): Promise<string[]> => {
  const ignorePatterns =
    cliFiles.length > 0
      ? [...(globalIgnore ?? [])]
      : mergeIgnorePatterns(DEFAULT_STAGE_IGNORE_PATTERNS, globalIgnore);
  const patterns = buildStageMatchPatterns(stage);

  // If CLI provided files (from --files or filesMode), filter those.
  if (cliFiles.length > 0) {
    const candidates = cliFiles.filter(
      (file) => !shouldIgnoreStageFile(file, ignorePatterns),
    );
    if (patterns.length === 0) {
      // alwaysRun stages can still consume the provided files if nothing else is specified.
      return candidates;
    }
    return micromatch(candidates, patterns, {
      dot: true,
    });
  }

  // No CLI-provided files: only glob when stage has explicit files.
  if (patterns.length === 0) {
    return [];
  }
  const cacheKey = createGlobCacheKey(patterns, root, ignorePatterns);
  const cached = cache?.get(cacheKey);
  if (cached) {
    return cached;
  }

  // fg() already filters by ignorePatterns internally via Bun.Glob + micromatch,
  // so there is no need to double-filter the results with shouldIgnoreStageFile.
  const globPromise = fg(patterns, {
    cwd: root,
    dot: true,
    ignore: [...ignorePatterns],
  });

  if (cache) {
    cache.set(cacheKey, globPromise);
  }

  return globPromise;
};

const createGlobCacheKey = (
  patterns: readonly string[],
  root: string,
  ignorePatterns: readonly string[],
): string => {
  const normalizedPatterns = [...patterns].sort().join("|");
  const normalizedIgnore = [...ignorePatterns].sort().join("|");
  return `${root}::${normalizedPatterns}::${normalizedIgnore}`;
};

const buildStageMatchPatterns = (stage: ResolvedStage): string[] => {
  const patterns: string[] = [];
  if (stage.files) {
    patterns.push(...stage.files);
  }
  return patterns;
};

const buildDryRunMessages = (
  stage: ResolvedStage,
  files: readonly string[],
): string[] => {
  if (files.length === 0) {
    if (stage.alwaysRun) {
      return [
        "Dry run: no matching files were found; stage is marked alwaysRun so adapter would decide its scope.",
      ];
    }
    return ["Dry run: no files matched this stage."];
  }

  const maxList = 20;
  const list =
    files.length > maxList
      ? [...files.slice(0, maxList), `… and ${files.length - maxList} more`]
      : [...files];

  return [
    `Dry run: ${files.length} file(s) would be processed.`,
    ...list.map((file) => `  - ${file}`),
  ];
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
