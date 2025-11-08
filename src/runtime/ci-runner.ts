import type { ResolvedConfig } from "../config/loader";
import type { ResolvedCiTarget, ResolvedStage } from "../config/types";
import { runPipeline } from "../pipeline/runner";
import type { ReporterDefinition } from "../reporters/types";
import {
  getFilesForCommitRange,
  getWorkspaceFiles,
  verifyGitRef,
} from "../utils/git";
import { prepareExecutionContext } from "./context-runner";
import { isStageFixable } from "./git-hook-runner";
import { isTelemetryEnabled } from "./telemetry";

export interface CiTargetExecutionOptions {
  readonly targetName: string;
  readonly target: ResolvedCiTarget;
  readonly config: ResolvedConfig;
  readonly reporterOverrides?: readonly ReporterDefinition[];
  readonly env?: NodeJS.ProcessEnv;
  readonly baseRef?: string;
  readonly headRef?: string;
}

export interface CiTargetExecutionResult {
  readonly success: boolean;
  readonly fixesApplied: boolean;
  readonly skipped: boolean;
  readonly files: readonly string[];
  readonly stages: readonly ResolvedStage[];
  readonly matrix?: Record<string, readonly string[]>;
  readonly env?: Record<string, string>;
  readonly commitRange?: { readonly base: string; readonly head: string };
}

export const executeCiTarget = async (
  options: CiTargetExecutionOptions,
): Promise<CiTargetExecutionResult> => {
  const { config, targetName, target } = options;
  const root = config.root;
  const environment = options.env ?? process.env;
  const effectiveEnv = { ...environment };
  const baseRefOverride = options.baseRef;
  const headRefOverride = options.headRef;
  const telemetryEnabled = isTelemetryEnabled();
  const buildTelemetry = (phase: "check" | "fix" | "verify") => {
    if (!telemetryEnabled) {
      return undefined;
    }
    return {
      context: `ci:${targetName}:${phase}`,
      metadata: {
        target: targetName,
        filesMode: target.filesMode,
        profile: target.profile,
        phase,
      },
    } as const;
  };

  const resolvedFiles = await resolveCiFiles({
    root,
    filesMode: target.filesMode,
    env: effectiveEnv,
    baseRef: baseRefOverride,
    headRef: headRefOverride,
  });

  const prepared = prepareExecutionContext({
    config,
    files: resolvedFiles.files,
    requestedStageIds: target.stages,
    reporterOverrides: options.reporterOverrides,
    context: {
      kind: "ci",
      name: targetName,
      changedFiles: resolvedFiles.files,
    },
  });

  if (prepared.skipped) {
    return {
      success: true,
      fixesApplied: false,
      skipped: true,
      files: prepared.files,
      stages: prepared.stages,
      matrix: target.matrix,
      env: target.env,
      commitRange: resolvedFiles.commitRange,
    } satisfies CiTargetExecutionResult;
  }

  const reporterDefinitions = prepared.reporters;
  const files = prepared.files;
  const stages = prepared.stages;

  const baseResult = await runPipeline({
    mode: "check",
    files,
    config,
    reporterDefinitions,
    stages,
    telemetry: buildTelemetry("check"),
  });

  if (target.autoFix.enabled && target.autoFix.safety !== "force") {
    throw new Error(
      "CI auto-fix requires safety to be set to 'force' to prevent interactive prompts.",
    );
  }

  if (baseResult.success) {
    return {
      success: true,
      fixesApplied: false,
      skipped: false,
      files,
      stages,
      matrix: target.matrix,
      env: target.env,
      commitRange: resolvedFiles.commitRange,
    } satisfies CiTargetExecutionResult;
  }

  if (!target.autoFix.enabled) {
    return {
      success: false,
      fixesApplied: false,
      skipped: false,
      files,
      stages,
      matrix: target.matrix,
      env: target.env,
      commitRange: resolvedFiles.commitRange,
    } satisfies CiTargetExecutionResult;
  }

  const fixableStages = stages.filter((stage) => isStageFixable(stage));
  if (fixableStages.length === 0) {
    return {
      success: false,
      fixesApplied: false,
      skipped: false,
      files,
      stages,
      matrix: target.matrix,
      env: target.env,
      commitRange: resolvedFiles.commitRange,
    } satisfies CiTargetExecutionResult;
  }

  await runPipeline({
    mode: "fix",
    files,
    config,
    reporterDefinitions,
    stages: fixableStages,
    telemetry: buildTelemetry("fix"),
  });

  let verifySuccess = true;
  if (target.autoFix.rerunAfterFix) {
    const verifyResult = await runPipeline({
      mode: "check",
      files,
      config,
      reporterDefinitions,
      stages,
      telemetry: buildTelemetry("verify"),
    });
    verifySuccess = verifyResult.success;
    if (!verifySuccess) {
      return {
        success: false,
        fixesApplied: true,
        skipped: false,
        files,
        stages,
        matrix: target.matrix,
        env: target.env,
        commitRange: resolvedFiles.commitRange,
      } satisfies CiTargetExecutionResult;
    }
  }

  return {
    success: verifySuccess,
    fixesApplied: true,
    skipped: false,
    files,
    stages,
    matrix: target.matrix,
    env: target.env,
    commitRange: resolvedFiles.commitRange,
  } satisfies CiTargetExecutionResult;
};

interface ResolveCiFilesOptions {
  readonly root: string;
  readonly filesMode: ResolvedCiTarget["filesMode"];
  readonly env: NodeJS.ProcessEnv;
  readonly baseRef?: string;
  readonly headRef?: string;
}

const BASE_REF_ENV_KEYS = [
  "QUALITY_CI_BASE_REF",
  "GITHUB_BASE_REF",
  "CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
  "CI_MERGE_REQUEST_TARGET_BRANCH",
  "CI_DEFAULT_BRANCH",
] as const;

const HEAD_REF_ENV_KEYS = [
  "QUALITY_CI_HEAD_REF",
  "GITHUB_SHA",
  "GITHUB_HEAD_REF",
  "CI_COMMIT_SHA",
  "CI_MERGE_REQUEST_SOURCE_BRANCH_SHA",
] as const;

const ALLOW_WORKSPACE_FALLBACK_ENV = "QUALITY_CI_ALLOW_WORKSPACE_FALLBACK";

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

class CommitRangeError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid",
  ) {
    super(message);
    this.name = "CommitRangeError";
  }
}

const shouldAllowWorkspaceFallback = (env: NodeJS.ProcessEnv): boolean => {
  const candidate =
    env[ALLOW_WORKSPACE_FALLBACK_ENV] ??
    process.env[ALLOW_WORKSPACE_FALLBACK_ENV];
  if (!candidate) {
    return false;
  }
  return TRUTHY_ENV_VALUES.has(candidate.toLowerCase());
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface ResolvedFiles {
  readonly files: string[];
  readonly commitRange?: { readonly base: string; readonly head: string };
}

const resolveCiFiles = async (
  options: ResolveCiFilesOptions,
): Promise<ResolvedFiles> => {
  if (options.filesMode === "workspace") {
    const files = await getWorkspaceFiles(options.root);
    return { files } satisfies ResolvedFiles;
  }

  if (options.filesMode === "commits") {
    try {
      const commitRange = await resolveCommitRange({
        root: options.root,
        env: options.env,
        baseRef: options.baseRef,
        headRef: options.headRef,
      });

      try {
        const files = await getFilesForCommitRange(
          options.root,
          commitRange.base,
          commitRange.head,
        );
        return { files, commitRange } satisfies ResolvedFiles;
      } catch (error) {
        throw new CommitRangeError(
          `Failed to enumerate files for CI commit range ${commitRange.base}..${commitRange.head}: ${errorMessage(error)}`,
          "invalid",
        );
      }
    } catch (error) {
      if (shouldAllowWorkspaceFallback(options.env)) {
        const files = await getWorkspaceFiles(options.root);
        return { files } satisfies ResolvedFiles;
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  return { files: [] } satisfies ResolvedFiles;
};

interface ResolveCommitRangeOptions {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly baseRef?: string;
  readonly headRef?: string;
}

const resolveCommitRange = async (
  options: ResolveCommitRangeOptions,
): Promise<{ readonly base: string; readonly head: string }> => {
  const baseCandidate = pickFirstCandidate(
    { value: options.baseRef, source: "override" },
    ...BASE_REF_ENV_KEYS.map((key) => ({
      value: options.env[key],
      source: key,
    })),
  );

  const headCandidate = pickFirstCandidate(
    { value: options.headRef, source: "override" },
    ...HEAD_REF_ENV_KEYS.map((key) => ({
      value: options.env[key],
      source: key,
    })),
  );

  const missingBase = !baseCandidate?.value;
  const missingHead = !headCandidate?.value;
  if (missingBase || missingHead) {
    throw new CommitRangeError(
      buildMissingCommitRefMessage(missingBase, missingHead),
      "missing",
    );
  }

  const base = baseCandidate.value!;
  const head = headCandidate.value!;

  const [baseIsValid, headIsValid] = await Promise.all([
    verifyGitRef(options.root, base),
    verifyGitRef(options.root, head),
  ]);

  if (!baseIsValid || !headIsValid) {
    const parts: string[] = [];
    if (!baseIsValid) {
      parts.push(`'${base}' (base)`);
    }
    if (!headIsValid) {
      parts.push(`'${head}' (head)`);
    }
    throw new CommitRangeError(
      `CI commit reference ${parts.join(" and ")} does not exist in this repository. Ensure the refs are fetched before running quality checks.`,
      "invalid",
    );
  }

  return { base, head };
};

interface ReferenceCandidate {
  readonly value?: string;
  readonly source: string;
}

const pickFirstCandidate = (
  ...candidates: readonly ReferenceCandidate[]
): ReferenceCandidate | undefined => {
  for (const candidate of candidates) {
    if (candidate.value && candidate.value.trim().length > 0) {
      return { value: candidate.value.trim(), source: candidate.source };
    }
  }
  return undefined;
};

const buildMissingCommitRefMessage = (
  missingBase: boolean,
  missingHead: boolean,
): string => {
  const baseProviders = BASE_REF_ENV_KEYS.filter(
    (key) => key !== "QUALITY_CI_BASE_REF",
  ).join(", ");
  const headProviders = HEAD_REF_ENV_KEYS.filter(
    (key) => key !== "QUALITY_CI_HEAD_REF",
  ).join(", ");

  if (missingBase && missingHead) {
    return `Unable to resolve CI commit range. Provide QUALITY_CI_BASE_REF and QUALITY_CI_HEAD_REF or configure provider variables (${baseProviders} / ${headProviders}).`;
  }
  if (missingBase) {
    return `Unable to resolve CI base ref. Set QUALITY_CI_BASE_REF or one of: ${baseProviders}.`;
  }
  return `Unable to resolve CI head ref. Set QUALITY_CI_HEAD_REF or one of: ${headProviders}.`;
};
