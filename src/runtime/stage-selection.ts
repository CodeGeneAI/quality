import micromatch from "micromatch";
import type { ResolvedStage } from "../config/types";

export type ExecutionContextKind = "hook" | "pipeline";

export interface StageSelectionContext {
  readonly kind: ExecutionContextKind;
  readonly name: string;
  readonly changedFiles?: readonly string[];
  readonly onlyChangedStageGroups?: boolean;
}

export interface StageSelectionOptions {
  readonly stages: readonly ResolvedStage[];
  readonly requestedStageIds?: readonly string[];
  readonly context: StageSelectionContext;
}

export const selectStagesForContext = (
  options: StageSelectionOptions,
): readonly ResolvedStage[] => {
  const requested = normalizeRequested(options.requestedStageIds);
  const changedFiles = options.context.changedFiles ?? [];
  const filterByChange = Boolean(options.context.onlyChangedStageGroups);
  const matcherCache = new Map<string, (files: readonly string[]) => boolean>();

  return options.stages.filter((stage) => {
    if (requested && !requested.has(stage.id)) {
      return false;
    }
    if (filterByChange && stage.group && changedFiles.length > 0) {
      return matchesChangedFiles(stage, changedFiles, matcherCache);
    }
    return true;
  });
};

const normalizeRequested = (
  requested: readonly string[] | undefined,
): Set<string> | undefined => {
  if (!requested || requested.length === 0) {
    return undefined;
  }
  return new Set(requested);
};

const matchesChangedFiles = (
  stage: ResolvedStage,
  changedFiles: readonly string[],
  cache: Map<string, (files: readonly string[]) => boolean>,
): boolean => {
  if (changedFiles.length === 0) {
    return false;
  }
  const patterns: string[] = [];
  if (stage.files) {
    patterns.push(...stage.files);
  }
  if (patterns.length === 0) {
    return true;
  }
  const cacheKey = `${stage.id}|${patterns.join(",")}`;
  const matcher =
    cache.get(cacheKey) ??
    (() => {
      const compiled = (files: readonly string[]) =>
        micromatch.some(files, patterns);
      cache.set(cacheKey, compiled);
      return compiled;
    })();
  return matcher(changedFiles);
};
