import { join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
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
});
