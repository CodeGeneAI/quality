import type { ResolvedConfig } from "../config/loader";
import type { ResolvedStage } from "../config/types";
import { ensureReporterSpecs } from "../reporters/registry";
import type { ReporterSpec } from "../reporters/types";
import { shouldIgnorePath } from "../utils/glob";
import type { StageSelectionContext } from "./stage-selection";
import { selectStagesForContext } from "./stage-selection";

export interface PreparedExecutionContext {
  readonly files: readonly string[];
  readonly stages: readonly ResolvedStage[];
  readonly reporters: readonly ReporterSpec[];
  readonly skipped: boolean;
}

export interface PrepareExecutionContextOptions {
  readonly config: ResolvedConfig;
  readonly context: StageSelectionContext;
  readonly files: readonly string[];
  readonly requestedStageIds?: readonly string[];
  readonly reporterOverrides?: readonly ReporterSpec[];
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

  const requestedReporters = mergeReporterSpecs(
    options.config.profile.reporters,
    options.reporterOverrides,
  );
  const reporters = ensureReporterSpecs(requestedReporters);

  const skipped = stages.length === 0;

  return {
    files,
    stages,
    reporters,
    skipped,
  } satisfies PreparedExecutionContext;
};

const mergeReporterSpecs = (
  base: readonly ReporterSpec[] | undefined,
  overrides: readonly ReporterSpec[] | undefined,
): ReporterSpec[] => {
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
