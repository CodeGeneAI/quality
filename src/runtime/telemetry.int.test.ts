import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadQualityConfig } from "../config/loader";
import { runGit } from "../utils/git";
import { executeCiTarget } from "./ci-runner";
import { executeGitHook } from "./git-hook-runner";

const createTelemetryConfig = () => ({
  $schema: "./packages/tooling/quality/schemas/qualityrc.schema.json",
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
  ciTargets: {
    "github:pr": {
      profile: "ci",
      filesMode: "workspace",
      stages: ["delay:command"],
      autoFix: {
        enabled: false,
        safety: "force",
        rerunAfterFix: true,
        preserveCommitMetadata: true,
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
  let hookRepo: string;
  let ciRepo: string;
  let telemetryPath: string;

  beforeEach(async () => {
    suiteRoot = await mkdtemp(join(tmpdir(), "quality-telemetry-suite-"));
    hookRepo = await initialiseRepository(suiteRoot, "hook");
    ciRepo = await initialiseRepository(suiteRoot, "ci");
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
    delete process.env.QUALITY_TELEMETRY;
    delete process.env.QUALITY_TELEMETRY_FILE;
    process.chdir(originalCwd);
    if (suiteRoot) {
      await rm(suiteRoot, { recursive: true, force: true });
    }
  });

  it("appends telemetry entries when hook and CI run concurrently", async () => {
    const hookConfig = await loadConfigForRepo(hookRepo);
    const ciConfig = await loadConfigForRepo(ciRepo);

    const hook = hookConfig.gitHooks["pre-commit"];
    const target = ciConfig.ciTargets["github:pr"];

    expect(hook).toBeDefined();
    expect(target).toBeDefined();

    const [hookResult, ciResult] = await Promise.all([
      executeGitHook({
        hookName: "pre-commit",
        hook,
        config: hookConfig,
      }),
      executeCiTarget({
        targetName: "github:pr",
        target,
        config: ciConfig,
      }),
    ]);

    expect(hookResult.success).toBe(true);
    expect(ciResult.success).toBe(true);

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
    expect(contexts).toEqual(["ci:github:pr:check", "hook:pre-commit:check"]);

    for (const entry of entries.slice(1)) {
      expect(Array.isArray(entry.stages)).toBe(true);
      expect(entry.stages.length).toBeGreaterThan(0);
      for (const stage of entry.stages) {
        expect(stage.status).toBe("passed");
      }
    }
  });
});
