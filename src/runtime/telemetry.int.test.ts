import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBuiltInAdapters } from "../adapters/register-builtins";
import { resetAdapters } from "../adapters/registry";
import { loadQualityConfig } from "../config/loader";
import { runPipeline } from "../pipeline/runner";
import { runGit } from "../utils/git";
import { executeGitHook } from "./git-hook-runner";

const createTelemetryConfig = () => ({
  $schema: "./packages/quality/schemas/qualityrc.schema.json",
  stages: {},
  profiles: {
    local: {
      pipeline: [
        {
          id: "delay:command",
          type: "command",
          options: {
            commands: [
              {
                command: [
                  "bash",
                  "-lc",
                  "sleep 0.1 && if grep -q 'fail' sample.txt 2>/dev/null; then exit 1; fi",
                ],
              },
            ],
          },
        },
      ],
      reporters: ["summary"],
    },
    ci: {
      extends: "local",
    },
  },
  gitHooks: {
    manage: true,
    hooks: {
      "pre-commit": {
        profile: "local",
        stages: ["delay:command"],
        filesMode: "staged",
        autoFix: {
          enabled: false,
          safety: "force",
          rerunAfterFix: false,
          preserveCommitMetadata: true,
        },
      },
    },
  },
});

const writeQualityConfig = async (root: string): Promise<void> => {
  const config = createTelemetryConfig();
  await writeFile(
    join(root, ".qualityrc.json"),
    JSON.stringify(config, null, 2),
    "utf8",
  );
};

const initialiseRepository = async (
  parent: string,
  label: string,
): Promise<string> => {
  const repoRoot = await mkdtemp(join(parent, `quality-telemetry-${label}-`));
  await runGit(["init"], { cwd: repoRoot });
  await runGit(["config", "user.name", "Test"], { cwd: repoRoot });
  await runGit(["config", "user.email", "test@example.com"], {
    cwd: repoRoot,
  });
  await writeFile(
    join(repoRoot, "package.json"),
    JSON.stringify({
      name: `quality-telemetry-${label}`,
      version: "0.0.0",
    }),
    "utf8",
  );
  await writeQualityConfig(repoRoot);
  await writeFile(join(repoRoot, "sample.txt"), "ok\n", "utf8");
  await runGit(["add", "sample.txt"], { cwd: repoRoot });
  return repoRoot;
};

const loadConfigForRepo = async (root: string) => {
  const previous = process.cwd();
  process.chdir(root);
  try {
    return await loadQualityConfig({ profile: "local" });
  } finally {
    process.chdir(previous);
  }
};

describe("telemetry runtime integration", () => {
  const originalCwd = process.cwd();
  let suiteRoot: string;
  let repo: string;
  let telemetryPath: string;

  beforeEach(async () => {
    resetAdapters();
    registerBuiltInAdapters();
    suiteRoot = await mkdtemp(join(tmpdir(), "quality-telemetry-suite-"));
    repo = await initialiseRepository(suiteRoot, "hook");
    telemetryPath = join(suiteRoot, "quality-telemetry.log");
    await writeFile(
      telemetryPath,
      `${JSON.stringify({ context: "seed-entry" })}\n`,
      "utf8",
    );
    process.env.QUALITY_TELEMETRY = "file";
    process.env.QUALITY_TELEMETRY_FILE = telemetryPath;
  });

  afterEach(async () => {
    resetAdapters();
    delete process.env.QUALITY_TELEMETRY;
    delete process.env.QUALITY_TELEMETRY_FILE;
    process.chdir(originalCwd);
    if (suiteRoot) {
      await rm(suiteRoot, { recursive: true, force: true });
    }
  });

  it("appends telemetry entries when hook and CI run concurrently", async () => {
    const config = await loadConfigForRepo(repo);
    const hook = config.gitHooks["pre-commit"];

    expect(hook).toBeDefined();

    const [hookResult, pipelineResult] = await Promise.all([
      executeGitHook({
        hookName: "pre-commit",
        hook,
        config,
      }),
      runPipeline({
        mode: "check",
        files: [],
        config,
        reporterDefinitions: config.profile.reporters,
        stages: config.profile.pipeline,
      }),
    ]);

    expect(hookResult.success).toBe(true);
    expect(pipelineResult.success).toBe(true);

    const content = await readFile(telemetryPath, "utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(lines.length).toBe(3);
    const entries = lines.map((line) => JSON.parse(line));

    expect(entries[0].context).toBe("seed-entry");

    const contexts = entries
      .slice(1)
      .map((entry) => entry.context)
      .sort();
    expect(contexts).toEqual(["hook:pre-commit:check", "pipeline:local:check"]);

    for (const entry of entries.slice(1)) {
      expect(Array.isArray(entry.stages)).toBe(true);
      expect(entry.stages.length).toBeGreaterThan(0);
      for (const stage of entry.stages) {
        expect(stage.status).toBe("passed");
      }
    }
  });
});
