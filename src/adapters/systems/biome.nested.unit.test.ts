import { cp, rm } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBuiltInAdapters } from "../../adapters/register-builtins";
import { resetAdapters } from "../../adapters/registry";
import { loadQualityConfig } from "../../config/loader";
import { runPipeline } from "../../pipeline/runner";

const originalCwd = process.cwd();
const fixtureRoot = fileURLToPath(
  new URL("../../../test/fixtures/biome-nested", import.meta.url),
);
const templateRootConfig = join(fixtureRoot, "biome.root.json");
const templateNestedConfig = join(
  fixtureRoot,
  "packages/nested/biome.override.json",
);
const runtimeRootConfig = join(fixtureRoot, "biome.json");
const runtimeNestedConfig = join(fixtureRoot, "packages/nested/biome.json");

describe("biome adapter configuration resolution", () => {
  beforeEach(async () => {
    resetAdapters();
    registerBuiltInAdapters();
    await cp(templateRootConfig, runtimeRootConfig, { errorOnExist: false });
    await cp(templateNestedConfig, runtimeNestedConfig, {
      errorOnExist: false,
    });
    process.chdir(fixtureRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(runtimeRootConfig, { force: true });
    await rm(runtimeNestedConfig, { force: true });
  });

  it("respects nested biome.json overrides", async () => {
    const config = await loadQualityConfig();
    const biomeStage = config.profile.pipeline.find(
      (stage) => stage.type === "biome",
    );
    expect(biomeStage).toBeDefined();

    const result = await runPipeline({
      mode: "check",
      files: ["src/root.ts", "packages/nested/src/nested.ts"],
      config,
      reporterDefinitions: [],
      stages: biomeStage ? [biomeStage] : [],
    });

    expect(result.success).toBe(false);
    const [stageResult] = result.stages;
    expect(stageResult).toBeDefined();
    const messageText = stageResult.messages.join("\n");
    expect(messageText).toContain("src/root.ts");
    expect(messageText).not.toContain("packages/nested/src/nested.ts");
  });
});
