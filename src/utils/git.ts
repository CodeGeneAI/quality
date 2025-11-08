import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { ensureDir } from "./fs";
import { runCommand } from "./process";

export interface GitCommandOptions {
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly allowFailure?: boolean;
}

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export const runGit = async (
  args: readonly string[],
  options: GitCommandOptions,
): Promise<GitCommandResult> => {
  const result = await runCommand({
    command: "git",
    args,
    cwd: options.cwd,
    env: options.env,
  });

  if (result.exitCode !== 0 && !options.allowFailure) {
    const message =
      result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")}`;
    throw new Error(message);
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  } satisfies GitCommandResult;
};

export const getStagedFiles = async (root: string): Promise<string[]> => {
  const { stdout } = await runGit(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: root },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

export const getWorkspaceFiles = async (root: string): Promise<string[]> => {
  const status = await getGitStatus(root);
  const files: string[] = [];
  for (const entry of status) {
    if (entry.index === " " && entry.worktree === " ") {
      continue;
    }
    files.push(entry.path);
  }
  return files;
};

export const getFilesForCommitRange = async (
  root: string,
  baseRef: string,
  headRef: string,
): Promise<string[]> => {
  const { stdout } = await runGit(
    ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}..${headRef}`],
    { cwd: root },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

export const hasUnstagedChanges = async (root: string): Promise<boolean> => {
  const { stdout } = await runGit(["status", "--porcelain"], { cwd: root });
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .some((line) => {
      if (line.length === 0) return false;
      if (line.startsWith("??")) return true;
      return line.length > 1 && line[1] !== " ";
    });
};

export const stashUnstagedChanges = async (
  root: string,
): Promise<string | undefined> => {
  const before = await listStashRefs(root);
  await runGit(
    [
      "stash",
      "push",
      "--keep-index",
      "--include-untracked",
      "--message",
      "quality-hooks",
    ],
    { cwd: root, allowFailure: true },
  );
  const after = await listStashRefs(root);
  if (after.length <= before.length) {
    return undefined;
  }
  return after[0];
};

export const popStash = async (
  root: string,
  ref: string | undefined,
): Promise<void> => {
  if (!ref) {
    return;
  }
  await runGit(["stash", "pop", ref, "--quiet"], {
    cwd: root,
    allowFailure: true,
  });
};

const listStashRefs = async (root: string): Promise<string[]> => {
  const { stdout } = await runGit(["stash", "list", "--format=%gd"], {
    cwd: root,
    allowFailure: true,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

export const checkoutIndexToDirectory = async (
  root: string,
  directory: string,
  paths: readonly string[],
): Promise<void> => {
  if (paths.length === 0) {
    return;
  }
  await ensureDir(directory);
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  await runGit(
    ["checkout-index", "--quiet", "--force", `--prefix=${prefix}`, ...paths],
    { cwd: root },
  );
};

export const diffFiles = async (
  leftPath: string,
  rightPath: string,
): Promise<string | undefined> => {
  const result = await runCommand({
    command: "git",
    args: ["diff", "--no-index", "--binary", leftPath, rightPath],
    cwd: process.cwd(),
  });

  if (result.exitCode === 0) {
    return undefined;
  }
  if (result.exitCode === 1) {
    return result.stdout;
  }
  throw new Error(result.stderr.trim() || result.stdout.trim());
};

export const applyPatchToIndex = async (
  root: string,
  patch: string,
): Promise<void> => {
  if (!patch) return;
  const tempDir = await mkdtemp(join(tmpdir(), "quality-apply-"));
  const patchPath = join(tempDir, "changes.patch");
  await Bun.write(patchPath, patch);
  try {
    await runGit(
      ["apply", "--cached", "--allow-empty", "--whitespace=nowarn", patchPath],
      { cwd: root },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const applyPatchToWorktree = async (
  root: string,
  patch: string,
): Promise<void> => {
  if (!patch) return;
  const tempDir = await mkdtemp(join(tmpdir(), "quality-apply-"));
  const patchPath = join(tempDir, "changes.patch");
  await Bun.write(patchPath, patch);
  try {
    await runGit(["apply", "--allow-empty", "--whitespace=nowarn", patchPath], {
      cwd: root,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const applyPatchToWorktreeThreeWay = async (
  root: string,
  patch: string,
): Promise<void> => {
  if (!patch) return;
  const tempDir = await mkdtemp(join(tmpdir(), "quality-apply-"));
  const patchPath = join(tempDir, "changes.patch");
  await Bun.write(patchPath, patch);
  try {
    const result = await runCommand({
      command: "git",
      args: [
        "apply",
        "--3way",
        "--allow-empty",
        "--whitespace=nowarn",
        patchPath,
      ],
      cwd: root,
    });

    if (result.exitCode !== 0) {
      await runCommand({
        command: "git",
        args: ["apply", "--allow-empty", "--whitespace=nowarn", patchPath],
        cwd: root,
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const verifyGitRef = async (
  root: string,
  ref: string,
): Promise<boolean> => {
  const result = await runGit(["rev-parse", "--verify", ref], {
    cwd: root,
    allowFailure: true,
  });
  return result.exitCode === 0;
};

export interface GitStatusEntry {
  readonly path: string;
  readonly index: string;
  readonly worktree: string;
}

export const getGitStatus = async (root: string): Promise<GitStatusEntry[]> => {
  const { stdout } = await runGit(["status", "--porcelain"], { cwd: root });
  const entries: GitStatusEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const path = line.slice(3).trim();
    entries.push({ path, index, worktree });
  }
  return entries;
};

export const stageFiles = async (
  root: string,
  files: readonly string[],
): Promise<void> => {
  if (files.length === 0) {
    return;
  }
  await runGit(["add", "--", ...files], { cwd: root });
};

export const resetHard = async (root: string): Promise<void> => {
  await runGit(["reset", "--hard"], { cwd: root });
};

export const exportPatch = async (
  root: string,
  args: readonly string[],
): Promise<string> => {
  const { stdout } = await runGit(["diff", ...args], {
    cwd: root,
  });
  return stdout;
};

export const readFileFromIndex = async (
  root: string,
  path: string,
): Promise<string> => {
  const result = await runGit(["show", `:${path}`], {
    cwd: root,
    allowFailure: true,
  });
  return result.stdout;
};
