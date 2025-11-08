import micromatch from "micromatch";
import type { ResolvedStage } from "../config/types";

export type ExecutionContextKind = "hook" | "ci";

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

  return options.stages.filter((stage) => {
    if (requested && !requested.has(stage.id)) {
      return false;
    }
    if (!appliesToContext(stage, options.context)) {
      return false;
    }
    if (filterByChange && stage.group && changedFiles.length > 0) {
      return matchesChangedFiles(stage, changedFiles);
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

const appliesToContext = (
  stage: ResolvedStage,
  context: StageSelectionContext,
): boolean => {
  const applies = stage.appliesTo;
  if (!applies) {
    return true;
  }
  if (context.kind === "hook") {
    if (applies.hooks) {
      return applies.hooks.includes(context.name);
    }
    return !applies.ciTargets;
  }
  if (context.kind === "ci") {
    if (applies.ciTargets) {
      return applies.ciTargets.includes(context.name);
    }
    return !applies.hooks;
  }
  return true;
};

const matchesChangedFiles = (
  stage: ResolvedStage,
  changedFiles: readonly string[],
): boolean => {
  if (changedFiles.length === 0) {
    return false;
  }
  const applicability = stage.appliesTo;
  const patterns: string[] = [];
  if (applicability?.paths) {
    patterns.push(...applicability.paths);
  }
  if (stage.files) {
    patterns.push(...stage.files);
  }
  if (patterns.length === 0) {
    return true;
  }
  return micromatch.some(changedFiles, patterns);
};
