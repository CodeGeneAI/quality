import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { loadQualityConfig } from "../../config/loader";
import { runPipeline } from "../../pipeline/runner";
import { runCommand } from "../../utils/process";
import { registerBuiltInAdapters } from "../register-builtins";
import { resetAdapters } from "../registry";

const fixtureRoot = fileURLToPath(
  new URL("../../../test/fixtures/changeset-guard", import.meta.url),
);

const git = async (cwd: string, ...args: string[]) => {
  const result = await runCommand({
    command: "git",
    args,
    cwd,
    env: {
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
};

describe("changeset-guard adapter – integration", () => {
  let workspace: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    resetAdapters();
    registerBuiltInAdapters();
    workspace = await mkdtemp(join(tmpdir(), "quality-cg-int-"));
    await cp(fixtureRoot, workspace, { recursive: true });

    // Initialize git repo on main
    await git(workspace, "init", "-b", "main");
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "initial");

    process.chdir(workspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  });

  it("warns when source files changed with no changeset", async () => {
    // Create feature branch and add source changes
    await git(workspace, "checkout", "-b", "feat/new-feature");
    await writeFile(
      join(workspace, "packages", "app", "src", "feature.ts"),
      "export const feature = true;\n",
    );
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "add feature");

    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterSpecs: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    // Should pass (severity=warn) but with messages about @fixture/app
    expect(result.success).toBe(true);
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("@fixture/app")),
      ),
    ).toBe(true);
  });

  it("warns when only source files are deleted with no changeset", async () => {
    await git(workspace, "checkout", "-b", "feat/delete-source");
    await rm(join(workspace, "packages", "lib", "src", "index.ts"));
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "remove source file");

    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterSpecs: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(true);
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("@fixture/lib")),
      ),
    ).toBe(true);
  });

  it("passes when changeset file exists", async () => {
    await git(workspace, "checkout", "-b", "feat/with-changeset");
    await writeFile(
      join(workspace, "packages", "app", "src", "feature.ts"),
      "export const feature = true;\n",
    );
    await writeFile(
      join(workspace, ".changeset", "my-change.md"),
      "---\n'@fixture/app': patch\n---\n\nAdd feature\n",
    );
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "add feature with changeset");

    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterSpecs: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(true);
    // Should NOT have any missing changeset messages
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("Missing changeset")),
      ),
    ).toBe(false);
  });

  it("passes when only test files changed", async () => {
    await git(workspace, "checkout", "-b", "feat/tests-only");
    await writeFile(
      join(workspace, "packages", "lib", "src", "index.test.ts"),
      "test('lib', () => {});\n",
    );
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "add test");

    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterSpecs: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(true);
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("Missing changeset")),
      ),
    ).toBe(false);
  });

  it("still warns when a pre-existing changeset on main covers a different package", async () => {
    // Simulate another dev's changeset already on main
    await writeFile(
      join(workspace, ".changeset", "someone-elses.md"),
      "---\n'@fixture/lib': patch\n---\n\nUnrelated fix\n",
    );
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "add unrelated changeset to main");

    // Feature branch changes @fixture/app but adds no new changeset
    await git(workspace, "checkout", "-b", "feat/no-new-changeset");
    await writeFile(
      join(workspace, "packages", "app", "src", "feature.ts"),
      "export const feature = true;\n",
    );
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "change without own changeset");

    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterSpecs: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(true);
    // Should warn — the changeset on main is NOT from this branch
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("@fixture/app")),
      ),
    ).toBe(true);
  });

  it("excludes ignored packages even with source changes", async () => {
    await git(workspace, "checkout", "-b", "feat/ignored-pkg");
    await writeFile(
      join(workspace, "packages", "ignored", "src", "change.ts"),
      "export const change = true;\n",
    );
    await git(workspace, "add", "-A");
    await git(workspace, "commit", "-m", "change ignored package");

    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterSpecs: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(true);
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("@fixture/ignored")),
      ),
    ).toBe(false);
  });
});
