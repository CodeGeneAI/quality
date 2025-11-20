import { diff_match_patch } from "diff-match-patch";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdapter, resetAdapters } from "../adapters/registry";
import type { StageAdapter } from "../adapters/types";
import type { ResolvedConfig } from "../config/loader";
import type { ResolvedGitHookConfig, ResolvedStage } from "../config/types";
import { ensureHooks } from "../pipeline/hooks";
import { exportPatch, runGit } from "../utils/git";
import { executeGitHook } from "./git-hook-runner";

interface StubOptions {
  readonly search?: string;
  readonly replace?: string;
}

const stubAdapter: StageAdapter<StubOptions> = {
  type: "format",
  label: "Stub formatter",
  supportsModes: ["check", "fix"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run(context) {
    if (context.files.length === 0) {
      return { status: "passed" };
    }
    const search = context.options.search ?? "bad";
    const replace = context.options.replace ?? "good";
    if (context.mode === "fix") {
      for (const file of context.files) {
        const absolute = join(context.root, file);
        const content = await Bun.file(absolute).text();
        const updated = content.replaceAll(search, replace);
        await Bun.write(absolute, updated);
      }
      return { status: "passed" };
    }
    for (const file of context.files) {
      const absolute = join(context.root, file);
      const content = await Bun.file(absolute).text();
      if (content.includes(search)) {
        return {
          status: "failed",
          messages: [`${file} contains disallowed token '${search}'`],
        };
      }
    }
    return { status: "passed" };
  },
};

const checkOnlyAdapter: StageAdapter = {
  type: "check-only",
  label: "Check-only formatter",
  supportsModes: ["check"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run(context) {
    if (context.files.length === 0) {
      return { status: "passed" };
    }
    for (const file of context.files) {
      const absolute = join(context.root, file);
      const content = await Bun.file(absolute).text();
      if (content.includes("bad")) {
        return {
          status: "failed",
          messages: [`${file} contains disallowed token 'bad'`],
        };
      }
    }
    return { status: "passed" };
  },
};

const throwingAdapter: StageAdapter = {
  type: "throwing-format",
  label: "Throwing formatter",
  supportsModes: ["check", "fix"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run(context) {
    if (context.files.length === 0) {
      return { status: "passed" };
    }
    const file = context.files[0];
    const absolute = join(context.root, file);
    if (context.mode === "fix") {
      throw new Error("formatter failure");
    }
    const content = await Bun.file(absolute).text();
    if (content.includes("bad")) {
      return {
        status: "failed",
        messages: [`${file} contains disallowed token 'bad'`],
      };
    }
    return { status: "passed" };
  },
};

interface EnvCaptureSnapshot {
  readonly gitArgs?: string;
  readonly remoteName?: string;
  readonly remoteUrl?: string;
}

const createEnvCaptureAdapter = (
  capture: (snapshot: EnvCaptureSnapshot) => void,
): StageAdapter => ({
  type: "env-capture",
  label: "Environment capture",
  supportsModes: ["check"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run() {
    capture({
      gitArgs: process.env.QUALITY_HOOK_GIT_ARGS,
      remoteName: process.env.QUALITY_HOOK_REMOTE_NAME,
      remoteUrl: process.env.QUALITY_HOOK_REMOTE_URL,
    });
    return { status: "passed" };
  },
});

const createStage = (
  overrides: Partial<ResolvedStage> = {},
): ResolvedStage => ({
  id: overrides.id ?? "format:stub",
  type: overrides.type ?? "format",
  options: overrides.options ?? {},
  continueOnError: overrides.continueOnError ?? false,
  files: overrides.files ?? [],
  group: overrides.group,
  label: overrides.label,
  description: overrides.description,
  preset: overrides.preset,
  mode: overrides.mode,
  reporters: overrides.reporters,
  if: overrides.if,
});

const createConfig = (
  root: string,
  stages: readonly ResolvedStage[],
): ResolvedConfig => ({
  root,
  adapters: [],
  stageCatalog: {},
  gitHooksManage: true,
  gitHooks: {},
  ignore: [],
  profile: {
    name: "test",
    pipeline: stages,
    reporters: ["summary"],
    hooks: ensureHooks(),
  },
});

describe("executeGitHook", () => {
  let root: string;
  let config: ResolvedConfig;
  let hook: ResolvedGitHookConfig;

  beforeEach(async () => {
    resetAdapters();
    registerAdapter(stubAdapter);
    root = await mkdtemp(join(tmpdir(), "quality-hook-"));
    await runGit(["init"], { cwd: root });
    await runGit(["config", "user.name", "Test"], { cwd: root });
    await runGit(["config", "user.email", "test@example.com"], { cwd: root });

    await stageSampleForFix();

    config = createConfig(root, [createStage({ files: ["sample.txt"] })]);
    hook = {
      name: "pre-commit",
      profile: "test",
      stages: undefined,
      filesMode: "staged",
      timeoutMs: undefined,
      reporters: undefined,
      hooks: undefined,
      env: undefined,
      onlyChangedStageGroups: false,
      autoFix: {
        enabled: true,
        amendCommit: false,
        safety: "force",
        rerunAfterFix: true,
        preserveCommitMetadata: true,
      },
    } satisfies ResolvedGitHookConfig;
  });

  afterEach(async () => {
    await runGit(["reset", "--hard"], { cwd: root, allowFailure: true });
    await runGit(["stash", "clear"], { cwd: root, allowFailure: true });
    vi.restoreAllMocks();
  });

  interface TrackedDeletionSpec {
    readonly relativePath: string;
    readonly content: string | Uint8Array;
  }

  const stageSampleForFix = async (): Promise<void> => {
    const samplePath = join(root, "sample.txt");
    await writeFile(samplePath, "bad\n", "utf8");
    await runGit(["add", "sample.txt"], { cwd: root });
    await writeFile(samplePath, "bad\nlocal-note\n", "utf8");
  };

  const prepareTrackedDeletions = async (
    entries: readonly TrackedDeletionSpec[],
  ): Promise<readonly string[]> => {
    const trackedPaths: string[] = [];
    for (const entry of entries) {
      const absolute = join(root, entry.relativePath);
      const relativeDir = entry.relativePath.includes("/")
        ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
        : "";
      if (relativeDir.length > 0) {
        await mkdir(join(root, relativeDir), { recursive: true });
      }
      await writeFile(absolute, entry.content);
      await runGit(["add", entry.relativePath], { cwd: root });
      await runGit(
        [
          "commit",
          "-m",
          `track ${entry.relativePath}`,
          "--",
          entry.relativePath,
        ],
        { cwd: root },
      );
      await rm(absolute);
      trackedPaths.push(absolute);
    }
    await stageSampleForFix();
    return trackedPaths;
  };

  it("applies fixes and preserves unstaged changes", async () => {
    const initialUnstagedPatch = await exportPatch(root, ["--binary"]);
    expect(initialUnstagedPatch).toContain("local-note");

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("good");
    expect(stagedDiff.stdout).not.toContain("bad");
    expect(stagedDiff.stdout).not.toContain("local-note");

    const fileContent = await Bun.file(join(root, "sample.txt")).text();
    expect(fileContent).toContain("local-note");

    const worktreeDiff = await runGit(["diff"], { cwd: root });
    expect(worktreeDiff.stdout).toContain("local-note");
  });

  it("applies fixes when unstaged deletions exist", async () => {
    const [ghostPath] = await prepareTrackedDeletions([
      { relativePath: "ghost.txt", content: "ghost\n" },
    ]);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("good");
    expect(await Bun.file(ghostPath).exists()).toBe(false);
  });

  it("applies fixes when multiple deletions and untracked files exist", async () => {
    const [textGhost, binaryGhost] = await prepareTrackedDeletions([
      { relativePath: "ghost-a.txt", content: "ghost-a\n" },
      { relativePath: "ghost.bin", content: new Uint8Array([0, 1, 2, 3]) },
    ]);
    const untrackedPath = join(root, "local-only.txt");
    await writeFile(untrackedPath, "local data\n", "utf8");

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);
    expect(await Bun.file(textGhost).exists()).toBe(false);
    expect(await Bun.file(binaryGhost).exists()).toBe(false);
    expect(await Bun.file(untrackedPath).text()).toContain("local data");
  });

  it("fails when auto-fix disabled", async () => {
    const disabledHook = {
      ...hook,
      autoFix: { ...hook.autoFix, enabled: false },
    };
    const result = await executeGitHook({
      hookName: "pre-commit",
      hook: disabledHook,
      config,
    });

    expect(result.success).toBe(false);
    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("bad");
  });

  it("requires confirmation before applying auto-fix", async () => {
    const confirmHook: ResolvedGitHookConfig = {
      ...hook,
      autoFix: { ...hook.autoFix, safety: "confirm" },
    };
    const prompt = vi.fn().mockResolvedValue(false);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook: confirmHook,
      config,
      prompt,
    });

    expect(prompt).toHaveBeenCalledWith(
      "Allow auto-fix for git hook 'pre-commit'? (y/N) ",
    );
    expect(result.success).toBe(false);
    expect(result.fixesApplied).toBe(false);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("bad");
    const fileContent = await Bun.file(join(root, "sample.txt")).text();
    expect(fileContent).toContain("local-note");
  });

  it("applies fixes after confirmation is approved", async () => {
    const confirmHook: ResolvedGitHookConfig = {
      ...hook,
      autoFix: { ...hook.autoFix, safety: "confirm" },
    };
    const prompt = vi.fn().mockResolvedValue(true);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook: confirmHook,
      config,
      prompt,
    });

    expect(prompt).toHaveBeenCalledWith(
      "Allow auto-fix for git hook 'pre-commit'? (y/N) ",
    );
    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);
  });

  it("skips stages when onlyChangedStageGroups filters out changes", async () => {
    const docPath = join(root, "docs.md");
    await writeFile(docPath, "bad\n", "utf8");
    await runGit(["add", "docs.md"], { cwd: root });

    config = createConfig(root, [
      createStage({
        id: "format:skipped",
        files: ["src/**/*.ts"],
        group: { id: "format", parallel: true, failFast: true },
      }),
    ]);

    const selectiveHook: ResolvedGitHookConfig = {
      ...hook,
      onlyChangedStageGroups: true,
      stages: undefined,
    };

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook: selectiveHook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.fixesApplied).toBe(false);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("bad");
  });

  it("returns failure when no stages support fix mode", async () => {
    registerAdapter(checkOnlyAdapter);

    config = createConfig(root, [
      createStage({
        id: "check-only",
        type: "check-only",
        files: ["sample.txt"],
      }),
    ]);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(false);
    expect(result.fixesApplied).toBe(false);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("bad");
  });

  it("is idempotent across consecutive runs", async () => {
    const firstRun = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(firstRun.success).toBe(true);
    expect(firstRun.fixesApplied).toBe(true);

    const secondRun = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(secondRun.success).toBe(true);
    expect(secondRun.fixesApplied).toBe(false);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("good");
    expect(stagedDiff.stdout).not.toContain("bad");

    const fileContent = await Bun.file(join(root, "sample.txt")).text();
    expect(fileContent).toContain("local-note");
  });

  it("applies fixes across multiple staged files and preserves each unstaged change", async () => {
    const secondPath = join(root, "second.txt");
    await writeFile(secondPath, "ugly\n", "utf8");
    await runGit(["add", "second.txt"], { cwd: root });
    await writeFile(secondPath, "ugly\nworkspace-note\n", "utf8");

    config = createConfig(root, [
      createStage({ id: "format:sample", files: ["sample.txt"] }),
      createStage({
        id: "format:second",
        files: ["second.txt"],
        options: { search: "ugly", replace: "pretty" },
      }),
    ]);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("good");
    expect(stagedDiff.stdout).toContain("pretty");

    const sampleContent = await Bun.file(join(root, "sample.txt")).text();
    expect(sampleContent).toContain("local-note");

    const secondContent = await Bun.file(secondPath).text();
    expect(secondContent).toContain("workspace-note");
  });

  it("restores original state when unstaged edits conflict with formatter output", async () => {
    const patchSpy = vi
      .spyOn(diff_match_patch.prototype, "patch_apply")
      .mockImplementation((patches, text) => [text, patches.map(() => false)]);

    try {
      const samplePath = join(root, "sample.txt");

      const result = await executeGitHook({
        hookName: "pre-commit",
        hook,
        config,
        prompt: async () => true,
      });

      expect(result.success).toBe(false);
      expect(result.fixesApplied).toBe(true);

      const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
      expect(stagedDiff.stdout).toContain("bad");
      expect(stagedDiff.stdout).not.toContain("good");

      const fileContent = await Bun.file(samplePath).text();
      expect(fileContent).toContain("local-note");
      expect(fileContent).not.toContain("good");
    } finally {
      patchSpy.mockRestore();
    }
  });

  it("preserves unstaged binary changes when fixes succeed", async () => {
    const binaryPath = join(root, "binary.bin");
    const initialBinary = new Uint8Array([0, 1, 2, 3]);
    await Bun.write(binaryPath, initialBinary);
    await runGit(["add", "binary.bin"], { cwd: root });
    const updatedBinary = new Uint8Array([0, 1, 2, 3, 4, 5]);
    await Bun.write(binaryPath, updatedBinary);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);

    const stagedDiff = await runGit(["diff", "--cached", "--binary"], {
      cwd: root,
    });
    expect(stagedDiff.stdout).toContain("good");
    expect(stagedDiff.stdout).not.toContain("bad");

    const binaryContent = new Uint8Array(
      await Bun.file(binaryPath).arrayBuffer(),
    );
    expect(Array.from(binaryContent)).toEqual(Array.from(updatedBinary));

    const worktreeDiff = await runGit(["diff"], { cwd: root });
    expect(worktreeDiff.stdout).toContain("binary.bin");
  });

  it("preserves unstaged edits on renamed files", async () => {
    const srcDir = join(root, "src");
    await mkdir(srcDir, { recursive: true });
    const originalRel = "src/original.ts";
    await writeFile(join(root, originalRel), "bad\n", "utf8");
    await runGit(["add", originalRel], { cwd: root });
    await runGit(["commit", "-m", "add original", "--", originalRel], {
      cwd: root,
    });

    const renamedRel = "src/renamed.ts";
    await runGit(["mv", originalRel, renamedRel], { cwd: root });
    await runGit(["add", renamedRel], { cwd: root });
    await writeFile(join(root, renamedRel), "bad\nlocal-rename\n", "utf8");

    config = createConfig(root, [
      createStage({ id: "format:renamed", files: [renamedRel] }),
    ]);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    const renamedContent = await Bun.file(join(root, renamedRel)).text();
    expect(renamedContent).toContain("local-rename");
    expect(renamedContent).toContain("good");
  });

  it("preserves deleted files when fixes fail and rollback", async () => {
    const [ghostPath] = await prepareTrackedDeletions([
      { relativePath: "ghost.txt", content: "ghost\n" },
    ]);
    registerAdapter(throwingAdapter);
    config = createConfig(root, [
      createStage({
        id: "format:throwing",
        type: "throwing-format",
        files: ["sample.txt"],
      }),
    ]);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(false);
    expect(result.fixesApplied).toBe(true);

    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("bad");
    expect(await Bun.file(ghostPath).exists()).toBe(false);
  });

  it("preserves deleted binary files when fixes fail and rollback", async () => {
    const [binaryGhost] = await prepareTrackedDeletions([
      { relativePath: "ghost.bin", content: new Uint8Array([0, 1, 2, 3]) },
    ]);
    registerAdapter(throwingAdapter);
    config = createConfig(root, [
      createStage({
        id: "format:throwing",
        type: "throwing-format",
        files: ["sample.txt"],
      }),
    ]);

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(false);
    expect(result.fixesApplied).toBe(true);
    expect(await Bun.file(binaryGhost).exists()).toBe(false);
  });

  it("collects workspace files when filesMode is workspace", async () => {
    config = createConfig(root, [
      createStage({
        files: ["sample.txt"],
        options: { search: "__never__" },
      }),
    ]);

    const workspaceHook: ResolvedGitHookConfig = {
      ...hook,
      name: "pre-push",
      filesMode: "workspace",
      autoFix: { ...hook.autoFix, enabled: false },
    };

    const result = await executeGitHook({
      hookName: "pre-push",
      hook: workspaceHook,
      config,
    });

    expect(result.success).toBe(true);
    expect(result.files).toEqual(["sample.txt"]);
  });

  it("does not auto-fix when filesMode is workspace", async () => {
    const workspaceHook: ResolvedGitHookConfig = {
      ...hook,
      name: "pre-push",
      filesMode: "workspace",
      autoFix: { ...hook.autoFix, enabled: true },
    };

    const result = await executeGitHook({
      hookName: "pre-push",
      hook: workspaceHook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(false);
    expect(result.fixesApplied).toBe(false);
    const stagedDiff = await runGit(["diff", "--cached"], { cwd: root });
    expect(stagedDiff.stdout).toContain("bad");
  });

  it("collects commit files when filesMode is commits", async () => {
    const samplePath = join(root, "sample.txt");
    await runGit(["checkout", "--", "sample.txt"], { cwd: root });
    await runGit(["commit", "-m", "initial"], { cwd: root });
    await Bun.write(samplePath, "good\n");
    await runGit(["add", "sample.txt"], { cwd: root });
    await runGit(["commit", "-m", "update"], { cwd: root });

    const head = (
      await runGit(["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();
    const base = (
      await runGit(["rev-parse", "HEAD^"], { cwd: root })
    ).stdout.trim();

    process.env.QUALITY_HOOK_BASE_REF = base;
    process.env.QUALITY_HOOK_HEAD_REF = head;

    config = createConfig(root, [createStage({ files: ["sample.txt"] })]);
    const commitsHook: ResolvedGitHookConfig = {
      ...hook,
      name: "pre-push",
      filesMode: "commits",
      autoFix: { ...hook.autoFix, enabled: false },
    };

    try {
      const result = await executeGitHook({
        hookName: "pre-push",
        hook: commitsHook,
        config,
      });

      expect(result.success).toBe(true);
      expect(result.files).toEqual(["sample.txt"]);
    } finally {
      delete process.env.QUALITY_HOOK_BASE_REF;
      delete process.env.QUALITY_HOOK_HEAD_REF;
    }
  });

  it("respects hook stage filters during auto-fix", async () => {
    const secondaryPath = join(root, "secondary.txt");
    await writeFile(secondaryPath, "bad\n", "utf8");
    await runGit(["add", "secondary.txt"], { cwd: root });
    await writeFile(secondaryPath, "bad\nworkspace\n", "utf8");

    config = createConfig(root, [
      createStage({ id: "format:sample", files: ["sample.txt"] }),
      createStage({ id: "format:secondary", files: ["secondary.txt"] }),
    ]);

    const selectiveHook: ResolvedGitHookConfig = {
      ...hook,
      stages: ["format:sample"],
    };

    const result = await executeGitHook({
      hookName: "pre-commit",
      hook: selectiveHook,
      config,
      prompt: async () => true,
    });

    expect(result.success).toBe(true);
    const secondaryContent = await Bun.file(secondaryPath).text();
    expect(secondaryContent).toContain("bad");
    expect(secondaryContent).toContain("workspace");
  });

  it("exposes git arguments through environment variables during execution", async () => {
    const snapshots: EnvCaptureSnapshot[] = [];
    const captureAdapter = createEnvCaptureAdapter((snapshot) => {
      snapshots.push(snapshot);
    });
    registerAdapter(captureAdapter);
    config = createConfig(root, [
      createStage({ id: "env:capture", type: captureAdapter.type, files: ["sample.txt"] }),
    ]);

    const previousGitArgs = process.env.QUALITY_HOOK_GIT_ARGS;
    const previousRemoteName = process.env.QUALITY_HOOK_REMOTE_NAME;
    const previousRemoteUrl = process.env.QUALITY_HOOK_REMOTE_URL;

    process.env.QUALITY_HOOK_GIT_ARGS = "baseline-args";
    process.env.QUALITY_HOOK_REMOTE_NAME = "baseline-remote";
    process.env.QUALITY_HOOK_REMOTE_URL = "baseline-url";

    const gitArgs = ["origin", "git@example.com/repo.git", "refs/heads/main"];

    try {
      const result = await executeGitHook({
        hookName: "pre-commit",
        hook,
        config,
        gitArgs,
      });

      expect(result.success).toBe(true);
      expect(snapshots).toEqual([
        {
          gitArgs: JSON.stringify(gitArgs),
          remoteName: "origin",
          remoteUrl: "git@example.com/repo.git",
        },
      ]);

      expect(process.env.QUALITY_HOOK_GIT_ARGS).toBe("baseline-args");
      expect(process.env.QUALITY_HOOK_REMOTE_NAME).toBe("baseline-remote");
      expect(process.env.QUALITY_HOOK_REMOTE_URL).toBe("baseline-url");
    } finally {
      if (previousGitArgs === undefined) {
        delete process.env.QUALITY_HOOK_GIT_ARGS;
      } else {
        process.env.QUALITY_HOOK_GIT_ARGS = previousGitArgs;
      }

      if (previousRemoteName === undefined) {
        delete process.env.QUALITY_HOOK_REMOTE_NAME;
      } else {
        process.env.QUALITY_HOOK_REMOTE_NAME = previousRemoteName;
      }

      if (previousRemoteUrl === undefined) {
        delete process.env.QUALITY_HOOK_REMOTE_URL;
      } else {
        process.env.QUALITY_HOOK_REMOTE_URL = previousRemoteUrl;
      }
    }
  });
});
