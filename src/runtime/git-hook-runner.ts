import { diff_match_patch } from "diff-match-patch";
import { rm } from "fs/promises";
import { join } from "path";
import { getAdapter } from "../adapters/registry";
import type { ResolvedConfig } from "../config/loader";
import type { ResolvedGitHookConfig, ResolvedStage } from "../config/types";
import { runPipeline } from "../pipeline/runner";
import type { ReporterDefinition } from "../reporters/types";
import {
  applyPatchToIndex,
  applyPatchToWorktree,
  exportPatch,
  getFilesForCommitRange,
  getGitStatus,
  getStagedFiles,
  getWorkspaceFiles,
  readFileFromIndex,
  resetHard,
  stageFiles,
  verifyGitRef,
} from "../utils/git";
import { prepareExecutionContext } from "./context-runner";
import { isTelemetryEnabled } from "./telemetry";

export interface GitHookExecutionOptions {
  readonly hookName: string;
  readonly hook: ResolvedGitHookConfig;
  readonly config: ResolvedConfig;
  readonly reporterOverrides?: readonly ReporterDefinition[];
  readonly prompt?: PromptFn;
  readonly gitArgs?: readonly string[];
}

export interface GitHookExecutionResult {
  readonly success: boolean;
  readonly fixesApplied: boolean;
  readonly skipped: boolean;
  readonly files: readonly string[];
  readonly stages: readonly ResolvedStage[];
}

export const executeGitHook = async (
  options: GitHookExecutionOptions,
): Promise<GitHookExecutionResult> => {
  const hookConfig = options.hook;
  const root = options.config.root;
  const prompt = options.prompt ?? defaultPrompt;
  const cleanupGitArgsEnv = applyGitArgsEnvironment(options.gitArgs);

  try {
    const rawFiles = await collectHookFiles(root, hookConfig.filesMode);
    const telemetryEnabled = isTelemetryEnabled();
    const buildTelemetry = (phase: "check" | "fix" | "verify") => {
      if (!telemetryEnabled) {
        return undefined;
      }
      return {
        context: `hook:${options.hookName}:${phase}`,
        metadata: {
          hook: options.hookName,
          filesMode: hookConfig.filesMode,
          profile: options.config.profile.name,
          phase,
        },
      } as const;
    };

    const prepared = prepareExecutionContext({
      config: options.config,
      files: rawFiles,
      requestedStageIds: hookConfig.stages,
      reporterOverrides: options.reporterOverrides,
      context: {
        kind: "hook",
        name: options.hookName,
        changedFiles: rawFiles,
        onlyChangedStageGroups: hookConfig.onlyChangedStageGroups,
      },
    });

    if (prepared.skipped) {
      return {
        success: true,
        fixesApplied: false,
        skipped: true,
        files: prepared.files,
        stages: prepared.stages,
      } satisfies GitHookExecutionResult;
    }

    const files = prepared.files;
    const stages = prepared.stages;
    const reporterDefinitions = prepared.reporters;

    const baseResult = await runPipeline({
      mode: "check",
      files,
      config: options.config,
      reporterDefinitions,
      stages,
      telemetry: buildTelemetry("check"),
    });

    if (baseResult.success) {
      return {
        success: true,
        fixesApplied: false,
        skipped: false,
        files,
        stages,
      } satisfies GitHookExecutionResult;
    }

    if (!hookConfig.autoFix.enabled) {
      return {
        success: false,
        fixesApplied: false,
        skipped: false,
        files,
        stages,
      } satisfies GitHookExecutionResult;
    }

    if (hookConfig.filesMode !== "staged") {
      return {
        success: false,
        fixesApplied: false,
        skipped: false,
        files,
        stages,
      } satisfies GitHookExecutionResult;
    }

    const fixableStages = stages.filter((stage) => isStageFixable(stage));
    if (fixableStages.length === 0) {
      return {
        success: false,
        fixesApplied: false,
        skipped: false,
        files,
        stages,
      } satisfies GitHookExecutionResult;
    }

    if (hookConfig.autoFix.safety === "confirm") {
      const proceed = await prompt(
        `Allow auto-fix for git hook '${options.hookName}'? (y/N) `,
      );
      if (!proceed) {
        return {
          success: false,
          fixesApplied: false,
          skipped: false,
          files,
          stages,
        } satisfies GitHookExecutionResult;
      }
    }

    const unstagedSnapshots = await captureUnstagedSnapshots(root);
    const stagedSnapshot = await exportPatch(root, ["--cached", "--binary"]);

    await resetHard(root);
    if (stagedSnapshot.trim()) {
      await applyPatchToWorktree(root, stagedSnapshot);
      await applyPatchToIndex(root, stagedSnapshot);
    }

    try {
      const fixStages = fixableStages.map(
        (stage) =>
          ({
            ...stage,
            mode: "fix",
          }) satisfies ResolvedStage,
      );

      await runPipeline({
        mode: "fix",
        files,
        config: options.config,
        reporterDefinitions,
        stages: fixStages,
        telemetry: buildTelemetry("fix"),
      });

      const verifyResult = await runPipeline({
        mode: "check",
        files,
        config: options.config,
        reporterDefinitions,
        stages,
        telemetry: buildTelemetry("verify"),
      });

      if (!verifyResult.success) {
        await restoreOriginalState(root, stagedSnapshot, unstagedSnapshots);
        return {
          success: false,
          fixesApplied: true,
          skipped: false,
          files,
          stages,
        } satisfies GitHookExecutionResult;
      }

      const changed = await collectFilesToStage(root, files);
      await stageFiles(root, changed);

      const fixedSnapshot = await exportPatch(root, ["--cached", "--binary"]);
      await finalizeSuccessfulFix(root, fixedSnapshot, unstagedSnapshots);

      return {
        success: true,
        fixesApplied: true,
        skipped: false,
        files,
        stages,
      } satisfies GitHookExecutionResult;
    } catch (error) {
      console.error("auto-fix failure", error);
      await restoreOriginalState(root, stagedSnapshot, unstagedSnapshots);
      return {
        success: false,
        fixesApplied: true,
        skipped: false,
        files,
        stages,
      } satisfies GitHookExecutionResult;
    }
  } finally {
    cleanupGitArgsEnv();
  }
};

const applyGitArgsEnvironment = (
  gitArgs: readonly string[] | undefined,
): (() => void) => {
  if (!gitArgs || gitArgs.length === 0) {
    return () => {};
  }

  const previousGitArgs = process.env.QUALITY_HOOK_GIT_ARGS;
  const previousRemoteName = process.env.QUALITY_HOOK_REMOTE_NAME;
  const previousRemoteUrl = process.env.QUALITY_HOOK_REMOTE_URL;

  process.env.QUALITY_HOOK_GIT_ARGS = JSON.stringify(gitArgs);
  if (gitArgs[0] !== undefined) {
    process.env.QUALITY_HOOK_REMOTE_NAME = gitArgs[0];
  }
  if (gitArgs[1] !== undefined) {
    process.env.QUALITY_HOOK_REMOTE_URL = gitArgs[1];
  }

  return () => {
    restoreEnv("QUALITY_HOOK_GIT_ARGS", previousGitArgs);
    restoreEnv("QUALITY_HOOK_REMOTE_NAME", previousRemoteName);
    restoreEnv("QUALITY_HOOK_REMOTE_URL", previousRemoteUrl);
  };
};

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

const collectHookFiles = async (
  root: string,
  mode: "staged" | "workspace" | "commits",
): Promise<string[]> => {
  if (mode === "staged") {
    return getStagedFiles(root);
  }

  if (mode === "workspace") {
    return getWorkspaceFiles(root);
  }

  if (mode === "commits") {
    const range = await resolveHookCommitRange(root);
    if (range) {
      try {
        return await getFilesForCommitRange(root, range.base, range.head);
      } catch (_error) {
        // fall back to workspace diff when refs are invalid
      }
    }
    return getWorkspaceFiles(root);
  }

  return [];
};

const resolveHookCommitRange = async (
  root: string,
): Promise<{ readonly base: string; readonly head: string } | undefined> => {
  const baseCandidate = pickFirst(
    process.env.QUALITY_HOOK_BASE_REF,
    process.env.QUALITY_CI_BASE_REF,
    process.env.GITHUB_BASE_REF,
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH,
    process.env.CI_DEFAULT_BRANCH,
    "HEAD^",
  );

  const headCandidate = pickFirst(
    process.env.QUALITY_HOOK_HEAD_REF,
    process.env.QUALITY_CI_HEAD_REF,
    process.env.GITHUB_SHA,
    process.env.GITHUB_HEAD_REF,
    process.env.CI_COMMIT_SHA,
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA,
    "HEAD",
  );

  if (!baseCandidate || !headCandidate) {
    return undefined;
  }

  const [baseIsValid, headIsValid] = await Promise.all([
    verifyGitRef(root, baseCandidate),
    verifyGitRef(root, headCandidate),
  ]);

  if (!baseIsValid || !headIsValid) {
    return undefined;
  }

  return { base: baseCandidate, head: headCandidate };
};

const pickFirst = (
  ...candidates: Array<string | undefined>
): string | undefined => {
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
};

export const isStageFixable = (stage: ResolvedStage): boolean => {
  const adapter = getAdapter(stage.type);
  if (!adapter) {
    return false;
  }
  if (!adapter.supportsModes || !adapter.supportsModes.includes("fix")) {
    return false;
  }
  return true;
};

const collectFilesToStage = async (
  root: string,
  fallback: readonly string[],
): Promise<string[]> => {
  const status = await getGitStatus(root);
  const worktreeChanges = status
    .filter((entry) => entry.worktree !== " " && entry.worktree !== "?")
    .map((entry) => entry.path);
  const newFiles = status
    .filter((entry) => entry.worktree === "?")
    .map((entry) => entry.path);
  const combined = [...new Set([...worktreeChanges, ...newFiles])];
  if (combined.length > 0) {
    return combined;
  }
  return [...new Set(fallback)];
};

const finalizeSuccessfulFix = async (
  root: string,
  fixedStagedPatch: string,
  snapshots: UnstagedSnapshots,
): Promise<void> => {
  await resetHard(root);
  if (fixedStagedPatch.trim()) {
    await applyPatchToWorktree(root, fixedStagedPatch);
    await applyPatchToIndex(root, fixedStagedPatch);
  }
  await mergeSnapshotsWithFix(root, snapshots);
};

const restoreOriginalState = async (
  root: string,
  stagedPatch: string,
  snapshots: UnstagedSnapshots,
): Promise<void> => {
  await resetHard(root);
  if (stagedPatch.trim()) {
    await applyPatchToWorktree(root, stagedPatch);
    await applyPatchToIndex(root, stagedPatch);
  }
  await applyOriginalSnapshots(root, snapshots);
};

interface UnstagedSnapshot {
  readonly base: string;
  readonly theirs?: string;
  readonly isBinary: boolean;
  readonly binary?: Uint8Array;
  readonly hasChanges: boolean;
  readonly existsInWorktree: boolean;
}

type UnstagedSnapshots = Map<string, UnstagedSnapshot>;

const textDecoder = new TextDecoder();

const captureUnstagedSnapshots = async (
  root: string,
): Promise<UnstagedSnapshots> => {
  const status = await getGitStatus(root);
  const map: UnstagedSnapshots = new Map();
  for (const entry of status) {
    if (entry.worktree === " " || entry.worktree === "?") {
      continue;
    }
    const base = await readFileFromIndex(root, entry.path);
    const theirsPath = join(root, entry.path);
    const theirsFile = Bun.file(theirsPath);
    const existsInWorktree = await theirsFile.exists();
    if (!existsInWorktree) {
      map.set(entry.path, {
        base,
        isBinary: false,
        hasChanges: true,
        existsInWorktree: false,
      });
      continue;
    }

    const binaryContent = new Uint8Array(await theirsFile.arrayBuffer());
    const isBinary = isBinaryContent(binaryContent);
    if (isBinary) {
      map.set(entry.path, {
        base,
        isBinary: true,
        binary: binaryContent,
        hasChanges: true,
        existsInWorktree: true,
      });
      continue;
    }

    const theirsContent = textDecoder.decode(binaryContent);
    map.set(entry.path, {
      base,
      theirs: theirsContent,
      isBinary: false,
      hasChanges: base !== theirsContent,
      existsInWorktree: true,
    });
  }
  return map;
};

const isBinaryContent = (buffer: Uint8Array): boolean => {
  if (buffer.length === 0) {
    return false;
  }
  let printable = 0;
  const length = buffer.length;
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[index];
    if (byte === 0) {
      return true;
    }
    if (byte >= 32 && byte <= 126) {
      printable += 1;
    }
  }
  return printable / length < 0.85;
};

const mergeSnapshotsWithFix = async (
  root: string,
  snapshots: UnstagedSnapshots,
): Promise<void> => {
  for (const [path, snapshot] of snapshots) {
    const absolute = join(root, path);

    if (!snapshot.existsInWorktree) {
      await deleteIfExists(absolute);
      continue;
    }

    if (snapshot.isBinary) {
      if (snapshot.binary) {
        await Bun.write(absolute, snapshot.binary);
      }
      continue;
    }

    if (!snapshot.hasChanges) {
      continue;
    }

    if (!snapshot.theirs) {
      throw new Error(
        `missing unstaged content snapshot for '${path}', cannot restore changes`,
      );
    }
    const ours = await Bun.file(absolute).text();
    let merged: string;
    try {
      merged = mergeTextContents(snapshot.base, ours, snapshot.theirs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `failed to merge unstaged changes for '${path}': ${reason}`,
      );
    }
    await Bun.write(absolute, merged);
  }
};

const mergeTextContents = (
  base: string,
  ours: string,
  theirs: string,
): string => {
  const dmp = new diff_match_patch();
  const patches = dmp.patch_make(base, theirs);
  if (patches.length === 0) {
    return ours;
  }

  const [candidate, applied] = dmp.patch_apply(patches, ours);
  if (applied.some((result) => !result)) {
    throw new Error("diff-match-patch failed to apply patches");
  }

  const diffBaseToOurs = dmp.diff_main(base, ours);
  dmp.diff_cleanupSemantic(diffBaseToOurs);

  const insertedSegments = new Set(
    diffBaseToOurs
      .filter(
        ([op, text]) => op === diff_match_patch.DIFF_INSERT && text.length > 0,
      )
      .map(([, text]) => text),
  );

  for (const segment of insertedSegments) {
    if (!candidate.includes(segment)) {
      throw new Error("merged content discarded formatter changes");
    }
  }

  return candidate;
};

const applyOriginalSnapshots = async (
  root: string,
  snapshots: UnstagedSnapshots,
): Promise<void> => {
  for (const [path, snapshot] of snapshots) {
    const absolute = join(root, path);

    if (!snapshot.existsInWorktree) {
      await deleteIfExists(absolute);
      continue;
    }

    if (snapshot.isBinary) {
      if (snapshot.binary) {
        await Bun.write(absolute, snapshot.binary);
      }
      continue;
    }

    if (snapshot.theirs === undefined) {
      throw new Error(
        `missing unstaged content snapshot for '${path}', cannot restore changes`,
      );
    }
    await Bun.write(absolute, snapshot.theirs);
  }
};

const deleteIfExists = async (path: string): Promise<void> => {
  try {
    await rm(path, { force: true });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as { code?: string }).code !== "ENOENT"
    ) {
      throw error;
    }
  }
};

type PromptFn = (message: string) => Promise<boolean>;

const defaultPrompt: PromptFn = async (message: string) => {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return true;
  }
  const readline = await import("readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(message);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
};
