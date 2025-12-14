import type { ResolvedConfig } from "../config/loader";
import type { ResolvedStage } from "../config/types";
import { ensureReporterDefinitions } from "../reporters/registry";
import type { ReporterDefinition } from "../reporters/types";
import { shouldIgnorePath } from "../utils/glob";
import type { StageSelectionContext } from "./stage-selection";
import { selectStagesForContext } from "./stage-selection";

export interface PreparedExecutionContext {
  readonly files: readonly string[];
  readonly stages: readonly ResolvedStage[];
  readonly reporters: readonly ReporterDefinition[];
  readonly skipped: boolean;
}

export interface PrepareExecutionContextOptions {
  readonly config: ResolvedConfig;
  readonly context: StageSelectionContext;
  readonly files: readonly string[];
  readonly requestedStageIds?: readonly string[];
  readonly reporterOverrides?: readonly ReporterDefinition[];
}

export const prepareExecutionContext = (
  options: PrepareExecutionContextOptions,
): PreparedExecutionContext => {
  const ignorePatterns = options.config.ignore ?? [];
  const files = dedupe(options.files, ignorePatterns);
  const stages = selectStagesForContext({
    stages: options.config.profile.pipeline,
    requestedStageIds: options.requestedStageIds,
    context: {
      ...options.context,
      changedFiles: files,
    },
  });

  const requestedReporters = mergeReporterDefinitions(
    options.config.profile.reporters,
    options.reporterOverrides,
  );
  const reporters = ensureReporterDefinitions(requestedReporters);

  const skipped = stages.length === 0;

  return {
    files,
    stages,
    reporters,
    skipped,
  } satisfies PreparedExecutionContext;
};

const mergeReporterDefinitions = (
  base: readonly ReporterDefinition[] | undefined,
  overrides: readonly ReporterDefinition[] | undefined,
): ReporterDefinition[] => {
  if (!base && !overrides) {
    return ["summary"];
  }
  const combined = [...(base ?? []), ...(overrides ?? [])];
  if (combined.length === 0) {
    return ["summary"];
  }
  return combined;
};

const dedupe = (
  values: readonly string[],
  ignorePatterns: readonly string[],
): string[] => {
  if (values.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value.length === 0) {
      continue;
    }
    if (shouldIgnorePath(value, ignorePatterns)) {
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
};
