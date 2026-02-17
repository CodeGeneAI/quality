import { afterEach, describe, expect, it, vi } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { loadQualityConfig } from "./loader";

const originalCwd = process.cwd();
const fixtureRoot = fileURLToPath(
  new URL("../../test/fixtures/basic", import.meta.url),
);
const jsoncRoot = fileURLToPath(
  new URL("../../test/fixtures/config-jsonc", import.meta.url),
);
const presetsRoot = fileURLToPath(
  new URL("../../test/fixtures/presets", import.meta.url),
);
const adaptersRoot = fileURLToPath(
  new URL("../../test/fixtures/adapters", import.meta.url),
);

afterEach(() => {
  process.chdir(originalCwd);
});

describe("loadQualityConfig", () => {
  it("loads configuration from .qualityrc.jsonc", async () => {
    process.chdir(jsoncRoot);

    const config = await loadQualityConfig();

    expect(config.profile.name).toBe("local");
    expect(config.profile.pipeline).toHaveLength(1);
    expect(config.profile.pipeline[0]).toMatchObject({
      id: "sample:command",
      type: "command",
    });
    expect(config.profile.reporters).toEqual(["summary"]);
  });

  it("loads the root .qualityrc and default profile", async () => {
    process.chdir(fixtureRoot);

    const config = await loadQualityConfig();

    expect(config.profile.name).toBe("local");
    expect(config.profile.pipeline).toHaveLength(1);
    expect(config.profile.pipeline[0]).toMatchObject({
      id: "stub:base",
      type: "stub",
      options: { shouldFail: false },
    });
    expect(config.profile.reporters).toEqual(["summary"]);
    expect(config.profile.hooks.onStart).toEqual([{ command: "echo start" }]);
    expect(config.profile.hooks.onStageFail).toEqual({});
    expect(config.ignore).toEqual(["fixture-root-ignore/**"]);
  });

  it("merges package-level overrides when target paths are provided", async () => {
    process.chdir(fixtureRoot);

    const target = join("packages", "app", "src", "index.ts");
    const config = await loadQualityConfig({ targetPaths: [target] });

    const hasOverrideStage = config.profile.pipeline.some(
      (stage) => stage.label === "app override",
    );
    expect(hasOverrideStage).toBe(true);
    const overrideStage = config.profile.pipeline.find(
      (stage) => stage.id === "stub:override",
    );
    expect(overrideStage?.options).toMatchObject({ shouldFail: true });
    expect(config.ignore).toEqual([
      "fixture-root-ignore/**",
      "fixture-app-ignore/**",
    ]);
  });

  it("resolves presets with inheritance and overrides", async () => {
    process.chdir(presetsRoot);

    const config = await loadQualityConfig();

    expect(config.profile.pipeline).toHaveLength(1);
    const stage = config.profile.pipeline[0];
    expect(stage.continueOnError).toBe(true);
    expect(stage.description).toBe("Extended lint preset");
    expect(stage.group).toMatchObject({
      id: "lint",
      parallel: true,
      failFast: false,
    });
    expect(stage.options).toMatchObject({
      flag: "extended",
      additional: true,
      shared: true,
      optionsOnly: true,
    });
  });

  it("derives continueOnError from command adapter options", async () => {
    process.chdir(fixtureRoot);

    const config = await loadQualityConfig({ profile: "command" });

    expect(config.profile.pipeline).toHaveLength(1);
    const [stage] = config.profile.pipeline;
    expect(stage.type).toBe("command");
    expect(stage.continueOnError).toBe(true);
    expect(stage.options).toMatchObject({
      abortPipelineOnFailure: false,
      commands: ["echo command"],
    });
  });

  it("aggregates adapters and resolves preset metadata", async () => {
    process.chdir(adaptersRoot);

    const config = await loadQualityConfig();

    expect(config.adapters).toHaveLength(1);
    expect(config.adapters[0]).toMatch(/custom-adapter\.ts$/);
    expect(config.stageCatalog.custom?.presets?.default).toMatchObject({
      label: "Custom preset",
      description: "Runs the custom adapter",
    });
    expect(config.profile.pipeline).toHaveLength(1);
    const [stage] = config.profile.pipeline;
    expect(stage.continueOnError).toBe(true);
    expect(stage.options).toMatchObject({ message: "hello" });
  });

  it("resolves profile-level filesMode", async () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "quality-filesmode-"));
    try {
      process.chdir(tmpDir);
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "filesmode-fixture" }),
        "utf8",
      );
      writeFileSync(
        join(tmpDir, ".qualityrc.json"),
        JSON.stringify(
          {
            profiles: {
              local: {
                filesMode: "staged",
                pipeline: [
                  {
                    id: "cmd",
                    type: "command",
                    overrides: { commands: ["echo ok"] },
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadQualityConfig();
      expect(config.profile.filesMode).toBe("staged");
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("propagates profile parallelLimit", async () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "quality-parallel-limit-"));
    try {
      process.chdir(tmpDir);
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "parallel-limit" }),
        "utf8",
      );
      writeFileSync(
        join(tmpDir, ".qualityrc.json"),
        JSON.stringify(
          {
            profiles: {
              base: {
                parallelLimit: 4,
                pipeline: [
                  {
                    id: "cmd-base",
                    type: "command",
                    overrides: { commands: ["echo base"] },
                  },
                ],
              },
              local: {
                extends: "base",
                parallelLimit: 2,
                pipeline: [
                  {
                    id: "cmd-local",
                    type: "command",
                    overrides: { commands: ["echo local"] },
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadQualityConfig({ profile: "local" });

      expect(config.profile.parallelLimit).toBe(2);
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applies nested override parallelLimit while preserving inherited pipeline", async () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "quality-parallel-inherit-"));
    const featureDir = join(tmpDir, "packages", "feature");
    const targetFile = join(featureDir, "src", "index.ts");
    try {
      process.chdir(tmpDir);
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "parallel-inherit" }),
        "utf8",
      );
      writeFileSync(
        join(tmpDir, ".qualityrc.json"),
        JSON.stringify(
          {
            profiles: {
              base: {
                parallelLimit: 3,
                pipeline: [
                  {
                    id: "root",
                    type: "command",
                    overrides: { commands: ["echo base"] },
                  },
                ],
              },
              local: {
                extends: "base",
                parallelLimit: 2,
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      mkdirSync(join(featureDir, "src"), { recursive: true });
      writeFileSync(
        join(featureDir, ".qualityrc.json"),
        JSON.stringify(
          {
            profiles: {
              local: {
                extends: "base",
                parallelLimit: 5,
              },
            },
          },
          null,
          2,
        ),
        { encoding: "utf8", flag: "w" },
      );

      writeFileSync(targetFile, "// target", "utf8");

      const config = await loadQualityConfig({
        profile: "local",
        targetPaths: [targetFile],
      });

      expect(config.profile.parallelLimit).toBe(5);
      expect(config.profile.pipeline).toHaveLength(1);
      expect(config.profile.pipeline[0]?.id).toBe("root");
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("warns when a stage defines filesMode", async () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "quality-filesmode-stage-"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.chdir(tmpDir);
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "filesmode-stage-fixture" }),
        "utf8",
      );
      writeFileSync(
        join(tmpDir, ".qualityrc.json"),
        JSON.stringify(
          {
            profiles: {
              local: {
                pipeline: [
                  {
                    id: "bad",
                    type: "command",
                    filesMode: "staged",
                    overrides: { commands: ["echo bad"] },
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const config = await loadQualityConfig();
      expect(config.profile.pipeline).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
