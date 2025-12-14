import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBuiltInAdapters } from "../adapters/register-builtins";
import { resetAdapters } from "../adapters/registry";
import { loadQualityConfig } from "../config/loader";
import { runPipeline } from "../pipeline/runner";

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
});

const writeQualityConfig = async (root: string): Promise<void> => {
  const config = createTelemetryConfig();
  await writeFile(
    join(root, ".qualityrc.json"),
    JSON.stringify(config, null, 2),
    "utf8",
  );
};

describe("telemetry runtime integration", () => {
  const originalCwd = process.cwd();
  let suiteRoot: string;
  let telemetryPath: string;

  beforeEach(async () => {
    resetAdapters();
    registerBuiltInAdapters();
    suiteRoot = await mkdtemp(join(tmpdir(), "quality-telemetry-suite-"));
    telemetryPath = join(suiteRoot, "quality-telemetry.log");
    await writeFile(
      telemetryPath,
      `${JSON.stringify({ context: "seed-entry" })}\n`,
      "utf8",
    );
    await writeFile(
      join(suiteRoot, "package.json"),
      JSON.stringify({ name: "quality-telemetry", version: "0.0.0" }),
      "utf8",
    );
    await writeQualityConfig(suiteRoot);
    await writeFile(join(suiteRoot, "sample.txt"), "ok\n", "utf8");
    process.chdir(suiteRoot);
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

  it("appends telemetry entries when pipeline runs", async () => {
    const config = await loadQualityConfig({ profile: "local" });

    const pipelineResult = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(pipelineResult.success).toBe(true);

    const content = await readFile(telemetryPath, "utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(lines.length).toBe(2);
    const entries = lines.map((line) => JSON.parse(line));

    expect(entries[0].context).toBe("seed-entry");
    expect(entries[1].context).toBe("pipeline:local:check");
    expect(entries[1].stages.length).toBeGreaterThan(0);
    for (const stage of entries[1].stages) {
      expect(stage.status).toBe("passed");
    }
  });
});
