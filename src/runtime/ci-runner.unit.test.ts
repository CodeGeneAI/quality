import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdapter, resetAdapters } from "../adapters/registry";
import type { StageAdapter } from "../adapters/types";
import type { ResolvedConfig } from "../config/loader";
import type { ResolvedCiTarget, ResolvedStage } from "../config/types";
import { ensureHooks } from "../pipeline/hooks";
import { runGit } from "../utils/git";
import { executeCiTarget } from "./ci-runner";

interface StubOptions {
  readonly search?: string;
  readonly replace?: string;
}

const formatAdapter: StageAdapter<StubOptions> = {
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
        await Bun.write(absolute, content.replaceAll(search, replace));
      }
      return { status: "passed" };
    }
    for (const file of context.files) {
      const absolute = join(context.root, file);
      const content = await Bun.file(absolute).text();
      if (content.includes(search)) {
        return {
          status: "failed",
          messages: [`${file} contains '${search}'`],
        };
      }
    }
    return { status: "passed" };
  },
};

const createConfig = (
  root: string,
  stages: readonly ResolvedStage[],
): ResolvedConfig => ({
  root,
  adapters: [],
  stageCatalog: {},
  gitHooksManage: true,
  gitHooks: {},
  ciTargets: {},
  profile: {
    name: "ci",
    pipeline: stages,
    reporters: ["summary"],
    hooks: ensureHooks(),
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
  appliesTo: overrides.appliesTo,
});

describe("executeCiTarget", () => {
  let root: string;
  let config: ResolvedConfig;
  let target: ResolvedCiTarget;

  beforeEach(async () => {
    resetAdapters();
    registerAdapter(formatAdapter);
    root = await mkdtemp(join(tmpdir(), "quality-ci-"));
    await runGit(["init"], { cwd: root });
    await runGit(["config", "user.name", "Test"], { cwd: root });
    await runGit(["config", "user.email", "test@example.com"], { cwd: root });

    const filePath = join(root, "sample.txt");
    await writeFile(filePath, "good\n", "utf8");
    await runGit(["add", "sample.txt"], { cwd: root });
    await runGit(["commit", "-m", "initial"], { cwd: root });

    config = createConfig(root, [
      createStage({ id: "format:stub", files: ["sample.txt"] }),
    ]);

    target = {
      name: "github:pr",
      profile: "ci",
      stages: undefined,
      filesMode: "workspace",
      timeoutMs: undefined,
      reporters: undefined,
      hooks: undefined,
      env: undefined,
      matrix: undefined,
      artifacts: undefined,
      autoFix: {
        enabled: false,
        amendCommit: false,
        safety: "force",
        rerunAfterFix: true,
        preserveCommitMetadata: true,
      },
    } satisfies ResolvedCiTarget;
  });

  afterEach(async () => {
    await runGit(["reset", "--hard"], { cwd: root, allowFailure: true });
    await runGit(["stash", "clear"], { cwd: root, allowFailure: true });
    vi.restoreAllMocks();
  });

  it("returns success when workspace pipeline passes", async () => {
    await writeFile(join(root, "sample.txt"), "good\nupdate\n", "utf8");

    const result = await executeCiTarget({
      targetName: "github:pr",
      target,
      config,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.files).toContain("sample.txt");
  });

  it("resolves commit diff from environment variables", async () => {
    await writeFile(join(root, "sample.txt"), "bad\n", "utf8");
    await runGit(["commit", "-am", "update"], { cwd: root });

    const commitHead = (
      await runGit(["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();
    const commitBase = (
      await runGit(["rev-parse", "HEAD^"], { cwd: root })
    ).stdout.trim();

    const commitTarget: ResolvedCiTarget = {
      ...target,
      filesMode: "commits",
    } satisfies ResolvedCiTarget;

    const result = await executeCiTarget({
      targetName: "github:pr",
      target: commitTarget,
      config,
      env: {
        QUALITY_CI_BASE_REF: commitBase,
        QUALITY_CI_HEAD_REF: commitHead,
      },
    });

    expect(result.files).toEqual(["sample.txt"]);
    expect(result.commitRange).toEqual({ base: commitBase, head: commitHead });
    expect(result.success).toBe(false);
  });

  it("requires commit refs when filesMode is commits", async () => {
    const commitTarget: ResolvedCiTarget = {
      ...target,
      filesMode: "commits",
    } satisfies ResolvedCiTarget;

    await expect(
      executeCiTarget({
        targetName: "github:pr",
        target: commitTarget,
        config,
        env: {},
      }),
    ).rejects.toThrow(/Unable to resolve CI commit range/i);
  });

  it("enforces auto-fix safety guardrails", async () => {
    const guardedTarget: ResolvedCiTarget = {
      ...target,
      autoFix: { ...target.autoFix, enabled: true, safety: "confirm" },
    } satisfies ResolvedCiTarget;

    await expect(
      executeCiTarget({
        targetName: "github:pr",
        target: guardedTarget,
        config,
      }),
    ).rejects.toThrow("CI auto-fix requires safety");
  });

  it("throws descriptive error when commit refs are invalid", async () => {
    const commitTarget: ResolvedCiTarget = {
      ...target,
      filesMode: "commits",
    } satisfies ResolvedCiTarget;

    await expect(
      executeCiTarget({
        targetName: "github:pr",
        target: commitTarget,
        config,
        env: {
          QUALITY_CI_BASE_REF: "invalid-base",
          QUALITY_CI_HEAD_REF: "invalid-head",
        },
      }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("allows workspace fallback for invalid refs when override enabled", async () => {
    const commitTarget: ResolvedCiTarget = {
      ...target,
      filesMode: "commits",
    } satisfies ResolvedCiTarget;

    await writeFile(join(root, "sample.txt"), "workspace change\n", "utf8");

    const result = await executeCiTarget({
      targetName: "github:pr",
      target: commitTarget,
      config,
      env: {
        QUALITY_CI_BASE_REF: "invalid-base",
        QUALITY_CI_HEAD_REF: "invalid-head",
        QUALITY_CI_ALLOW_WORKSPACE_FALLBACK: "1",
      },
    });

    expect(result.files).toContain("sample.txt");
    expect(result.commitRange).toBeUndefined();
  });

  it("applies auto-fix and reruns verification when enabled", async () => {
    await writeFile(join(root, "sample.txt"), "bad\n", "utf8");

    const fixingTarget: ResolvedCiTarget = {
      ...target,
      autoFix: { ...target.autoFix, enabled: true },
    } satisfies ResolvedCiTarget;

    const result = await executeCiTarget({
      targetName: "github:pr",
      target: fixingTarget,
      config,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);
    const content = await Bun.file(join(root, "sample.txt")).text();
    expect(content).toContain("good");
  });

  it("filters stages by CI target applicability", async () => {
    config = createConfig(root, [
      createStage({
        id: "format:ci",
        files: ["sample.txt"],
        appliesTo: { ciTargets: ["github:pr"] },
      }),
      createStage({
        id: "format:other",
        files: ["sample.txt"],
        appliesTo: { ciTargets: ["gitlab:merge"] },
      }),
    ]);

    const result = await executeCiTarget({
      targetName: "github:pr",
      target,
      config,
    });

    expect(result.success).toBe(true);
    expect(result.stages.map((stage) => stage.id)).toEqual(["format:ci"]);
  });
});
