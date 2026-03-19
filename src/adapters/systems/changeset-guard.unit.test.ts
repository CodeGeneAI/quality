import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ResolvedStage } from "../../config/types";
import { runCommand } from "../../utils/process";
import type { ChangesetGuardOptions } from "./changeset-guard";
import { changesetGuardAdapter } from "./changeset-guard";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const git = async (root: string, ...args: string[]) => {
  const result = await runCommand({
    command: "git",
    args,
    cwd: root,
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

const createFixture = async (): Promise<string> => {
  const root = join(
    tmpdir(),
    `quality-cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(root, { recursive: true });

  // Root package.json
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@fixture/root",
      private: true,
      workspaces: ["packages/*"],
    }),
  );

  // .changeset/config.json
  await mkdir(join(root, ".changeset"), { recursive: true });
  await writeFile(
    join(root, ".changeset", "config.json"),
    JSON.stringify({
      baseBranch: "main",
      ignore: ["@fixture/ignored"],
    }),
  );

  // packages/app (private)
  await mkdir(join(root, "packages", "app", "src"), { recursive: true });
  await writeFile(
    join(root, "packages", "app", "package.json"),
    JSON.stringify({ name: "@fixture/app", private: true, version: "1.0.0" }),
  );
  await writeFile(
    join(root, "packages", "app", "src", "index.ts"),
    "export const x = 1;\n",
  );

  // packages/lib (public)
  await mkdir(join(root, "packages", "lib", "src"), { recursive: true });
  await writeFile(
    join(root, "packages", "lib", "package.json"),
    JSON.stringify({ name: "@fixture/lib", version: "1.0.0" }),
  );
  await writeFile(
    join(root, "packages", "lib", "src", "index.ts"),
    "export const y = 1;\n",
  );

  // packages/ignored (in changeset ignore list)
  await mkdir(join(root, "packages", "ignored", "src"), { recursive: true });
  await writeFile(
    join(root, "packages", "ignored", "package.json"),
    JSON.stringify({ name: "@fixture/ignored", version: "1.0.0" }),
  );
  await writeFile(
    join(root, "packages", "ignored", "src", "index.ts"),
    "export const z = 1;\n",
  );

  // Initialize git repo on "main" branch
  await git(root, "init", "-b", "main");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "initial");

  return root;
};

const createStage = (
  options: ChangesetGuardOptions,
): ResolvedStage<ChangesetGuardOptions> => ({
  id: "changeset-guard",
  type: "changeset-guard",
  options,
  continueOnError: false,
  files: [],
  alwaysRun: true,
});

const runAdapter = async (
  root: string,
  options: ChangesetGuardOptions = {},
) => {
  const mergedOptions: ChangesetGuardOptions = {
    baseBranch: "main",
    ...options,
  };
  return changesetGuardAdapter.run({
    root,
    pipelineMode: "check",
    mode: "check",
    stage: createStage(mergedOptions),
    files: [],
    options: mergedOptions,
    ignore: [],
    abortSignal: new AbortController().signal,
  });
};

/* ------------------------------------------------------------------ */
/* Tests: Core Logic                                                   */
/* ------------------------------------------------------------------ */

describe("changesetGuardAdapter", () => {
  let root: string;

  beforeEach(async () => {
    root = await createFixture();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("has type changeset-guard", () => {
    expect(changesetGuardAdapter.type).toBe("changeset-guard");
  });

  describe("no changes", () => {
    it("passes when there are no changed files", async () => {
      // Stay on main — no diff against self
      const result = await runAdapter(root, { baseBranch: "main" });
      // On main, should skip
      expect(result.status).toBe("skipped");
    });

    it("passes when on a feature branch with no changes", async () => {
      await git(root, "checkout", "-b", "feat/empty");
      const result = await runAdapter(root, { baseBranch: "main" });
      expect(result.status).toBe("passed");
    });
  });

  describe("non-meaningful changes only", () => {
    it("passes when only test files are changed", async () => {
      await git(root, "checkout", "-b", "feat/tests-only");
      await writeFile(
        join(root, "packages", "app", "src", "index.unit.test.ts"),
        "test('x', () => {});\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add test");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
        ignoreFilePatterns: ["**/*.test.*", "**/*.spec.*"],
      });

      expect(result.status).toBe("passed");
    });

    it("passes when only markdown files are changed", async () => {
      await git(root, "checkout", "-b", "feat/docs-only");
      await writeFile(join(root, "packages", "app", "README.md"), "# Docs\n");
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add docs");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
        ignoreFilePatterns: ["**/*.md"],
      });

      expect(result.status).toBe("passed");
    });
  });

  describe("changeset coverage (only new files in the branch diff count)", () => {
    it("passes when a new changeset in the diff covers the affected package", async () => {
      await git(root, "checkout", "-b", "feat/with-changeset");
      await writeFile(
        join(root, "packages", "app", "src", "new-feature.ts"),
        "export const feature = true;\n",
      );
      await writeFile(
        join(root, ".changeset", "my-change.md"),
        "---\n'@fixture/app': patch\n---\n\nAdd feature\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add feature with changeset");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("passed");
    });

    it("warns when a new changeset exists but does not cover the affected package", async () => {
      await git(root, "checkout", "-b", "feat/wrong-changeset");
      await writeFile(
        join(root, "packages", "app", "src", "new-feature.ts"),
        "export const feature = true;\n",
      );
      // Changeset covers @fixture/lib, NOT @fixture/app
      await writeFile(
        join(root, ".changeset", "unrelated-change.md"),
        "---\n'@fixture/lib': patch\n---\n\nUnrelated fix\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add feature with wrong changeset");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "warn",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("passed");
      expect(result.messages).toBeDefined();
      expect(result.messages!.some((m) => m.includes("@fixture/app"))).toBe(
        true,
      );
    });

    it("warns when a changeset exists on main but nothing new was added on the branch", async () => {
      // Add a changeset to main first (simulating another dev's unrelated work)
      await writeFile(
        join(root, ".changeset", "someone-elses-work.md"),
        "---\n'@fixture/lib': patch\n---\n\nSomeone else's fix\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add unrelated changeset on main");

      // Now create a feature branch with source changes but NO new changeset
      await git(root, "checkout", "-b", "feat/no-new-changeset");
      await writeFile(
        join(root, "packages", "app", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change without changeset");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "warn",
        changedFilePatterns: ["src/**"],
      });

      // Should warn — the changeset on main is NOT from this branch
      expect(result.messages).toBeDefined();
      expect(result.messages!.some((m) => m.includes("@fixture/app"))).toBe(
        true,
      );
    });

    it("passes when multiple new changesets collectively cover all affected packages", async () => {
      await git(root, "checkout", "-b", "feat/multi-changeset");
      await writeFile(
        join(root, "packages", "app", "src", "new-feature.ts"),
        "export const feature = true;\n",
      );
      await writeFile(
        join(root, "packages", "lib", "src", "new-util.ts"),
        "export const util = true;\n",
      );
      await writeFile(
        join(root, ".changeset", "change-app.md"),
        "---\n'@fixture/app': patch\n---\n\nApp change\n",
      );
      await writeFile(
        join(root, ".changeset", "change-lib.md"),
        "---\n'@fixture/lib': minor\n---\n\nLib change\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "changes with full coverage");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("passed");
      const warningMessages = (result.messages ?? []).filter((m) =>
        m.includes("Missing changeset"),
      );
      expect(warningMessages.length).toBe(0);
    });

    it("warns only about uncovered packages when some are covered", async () => {
      await git(root, "checkout", "-b", "feat/partial-coverage");
      await writeFile(
        join(root, "packages", "app", "src", "new-feature.ts"),
        "export const feature = true;\n",
      );
      await writeFile(
        join(root, "packages", "lib", "src", "new-util.ts"),
        "export const util = true;\n",
      );
      // Only covers @fixture/app, not @fixture/lib
      await writeFile(
        join(root, ".changeset", "partial.md"),
        "---\n'@fixture/app': patch\n---\n\nPartial coverage\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "partial changeset coverage");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "warn",
        changedFilePatterns: ["src/**"],
      });

      expect(result.messages).toBeDefined();
      expect(result.messages!.some((m) => m.includes("@fixture/lib"))).toBe(
        true,
      );
      expect(result.messages!.some((m) => m.includes("@fixture/app"))).toBe(
        false,
      );
    });

    it("passes when changeset --empty was used (official opt-out)", async () => {
      await git(root, "checkout", "-b", "feat/empty-changeset");
      await writeFile(
        join(root, "packages", "app", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await writeFile(
        join(root, ".changeset", "empty-change.md"),
        "---\n---\n\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change with empty changeset");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("passed");
    });
  });

  describe("meaningful changes without changeset", () => {
    it("warns by default when changeset is missing", async () => {
      await git(root, "checkout", "-b", "feat/no-changeset");
      await writeFile(
        join(root, "packages", "app", "src", "new-feature.ts"),
        "export const feature = true;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add feature");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "warn",
        changedFilePatterns: ["src/**"],
      });

      // severity=warn means it passes but with messages
      expect(result.status).toBe("passed");
      expect(result.messages).toBeDefined();
      expect(result.messages!.length).toBeGreaterThan(0);
      expect(result.messages!.some((m) => m.includes("@fixture/app"))).toBe(
        true,
      );
    });

    it("fails when severity is set to fail", async () => {
      await git(root, "checkout", "-b", "feat/fail-mode");
      await writeFile(
        join(root, "packages", "lib", "src", "new-feature.ts"),
        "export const feature = true;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "add feature");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "fail",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages).toBeDefined();
      expect(result.messages!.some((m) => m.includes("@fixture/lib"))).toBe(
        true,
      );
    });

    it("fails when only source files are deleted with no changeset", async () => {
      await git(root, "checkout", "-b", "feat/delete-source");
      await rm(join(root, "packages", "lib", "src", "index.ts"));
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "remove exported source file");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "fail",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages).toBeDefined();
      expect(result.messages!.some((m) => m.includes("@fixture/lib"))).toBe(
        true,
      );
    });

    it("includes actionable instructions in warning messages", async () => {
      await git(root, "checkout", "-b", "feat/instructions");
      await writeFile(
        join(root, "packages", "app", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change");

      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "warn",
        changedFilePatterns: ["src/**"],
      });

      const allMessages = (result.messages ?? []).join("\n");
      expect(allMessages).toContain("changeset");
      expect(allMessages).toContain("--empty");
      expect(allMessages).toContain("--no-verify");
    });
  });

  describe("ignored packages", () => {
    it("excludes packages from .changeset/config.json ignore list", async () => {
      await git(root, "checkout", "-b", "feat/ignored-pkg");
      await writeFile(
        join(root, "packages", "ignored", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change ignored");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
      });

      // Only the ignored package changed — should pass with no warning
      expect(result.status).toBe("passed");
    });

    it("excludes packages from ignorePackages option", async () => {
      await git(root, "checkout", "-b", "feat/ignore-option");
      await writeFile(
        join(root, "packages", "app", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change");

      const result = await runAdapter(root, {
        baseBranch: "main",
        ignorePackages: ["@fixture/app"],
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("passed");
    });
  });

  describe("private packages", () => {
    it("includes private packages when includePrivate is true", async () => {
      await git(root, "checkout", "-b", "feat/private-included");
      await writeFile(
        join(root, "packages", "app", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change private");

      const result = await runAdapter(root, {
        baseBranch: "main",
        includePrivate: true,
        severity: "warn",
        changedFilePatterns: ["src/**"],
      });

      expect(result.messages).toBeDefined();
      expect(result.messages!.some((m) => m.includes("@fixture/app"))).toBe(
        true,
      );
    });

    it("excludes private packages when includePrivate is false", async () => {
      await git(root, "checkout", "-b", "feat/private-excluded");
      // Only change a private package
      await writeFile(
        join(root, "packages", "app", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change private");

      const result = await runAdapter(root, {
        baseBranch: "main",
        includePrivate: false,
        changedFilePatterns: ["src/**"],
      });

      // Only private package changed and includePrivate=false — should pass
      expect(result.status).toBe("passed");
    });
  });

  /* ------------------------------------------------------------------ */
  /* Tests: Edge Cases                                                   */
  /* ------------------------------------------------------------------ */

  describe("edge cases", () => {
    it("skips when current branch is main", async () => {
      // Already on main from fixture setup
      const result = await runAdapter(root, { baseBranch: "main" });
      expect(result.status).toBe("skipped");
    });

    it("skips when base ref does not exist", async () => {
      await git(root, "checkout", "-b", "feat/no-base");
      const result = await runAdapter(root, {
        baseBranch: "nonexistent-branch",
      });
      expect(result.status).toBe("skipped");
      expect(result.messages).toBeDefined();
      expect(
        result.messages!.some((m) => m.includes("nonexistent-branch")),
      ).toBe(true);
    });

    it("treats .changeset/ with only config.json as no changesets", async () => {
      await git(root, "checkout", "-b", "feat/config-only");
      await writeFile(
        join(root, "packages", "lib", "src", "change.ts"),
        "export const c = 1;\n",
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "change");

      // .changeset/ only has config.json (from fixture)
      const result = await runAdapter(root, {
        baseBranch: "main",
        severity: "fail",
        changedFilePatterns: ["src/**"],
      });

      expect(result.status).toBe("failed");
    });

    it("respects changedFilePatterns to narrow meaningful changes", async () => {
      await git(root, "checkout", "-b", "feat/narrow-patterns");
      // Change a file outside src/ (e.g., package.json itself)
      await writeFile(
        join(root, "packages", "lib", "package.json"),
        JSON.stringify({ name: "@fixture/lib", version: "1.0.1" }),
      );
      await git(root, "add", "-A");
      await git(root, "commit", "-m", "bump version");

      const result = await runAdapter(root, {
        baseBranch: "main",
        changedFilePatterns: ["src/**"],
      });

      // package.json change doesn't match src/** — no changeset needed
      expect(result.status).toBe("passed");
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      await git(root, "checkout", "-b", "feat/abort");

      const result = await changesetGuardAdapter.run({
        root,
        pipelineMode: "check",
        mode: "check",
        stage: createStage({ baseBranch: "main" }),
        files: [],
        options: { baseBranch: "main" },
        ignore: [],
        abortSignal: controller.signal,
      });

      expect(result.status).toBe("skipped");
    });
  });
});
