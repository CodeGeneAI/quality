import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { loadQualityConfig } from "./loader";

const schemaPath = "./packages/quality/schemas/qualityrc.schema.json";

describe("loadQualityConfig with shard-only profiles", () => {
  const cwdStack: string[] = [];
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "quality-shard-"));
    cwdStack.push(process.cwd());
    process.chdir(tmpDir);

    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "shard-fixture" }),
      "utf8",
    );

    writeFileSync(
      path.join(tmpDir, ".qualityrc.jsonc"),
      JSON.stringify(
        {
          $schema: schemaPath,
          stages: {},
          shardDir: ".",
        },
        null,
        2,
      ),
      "utf8",
    );

    writeFileSync(
      path.join(tmpDir, ".qualityrc.local.jsonc"),
      JSON.stringify(
        {
          profiles: {
            local: {
              pipeline: [],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  afterEach(() => {
    process.chdir(cwdStack.pop() ?? process.cwd());
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a profile defined only in a shard", async () => {
    const config = await loadQualityConfig();
    expect(config.profile.name).toBe("local");
    expect(config.profile.pipeline).toHaveLength(0);
  });

  it("prefers the 'default' profile when no preference is provided", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.default.jsonc"),
      JSON.stringify(
        {
          profiles: {
            default: {
              pipeline: [
                {
                  id: "base",
                  type: "command",
                  overrides: { commands: ["echo base"] },
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
    expect(config.profile.name).toBe("default");
    expect(config.profile.pipeline.map((s) => s.id)).toEqual(["base"]);
  });

  it("appends pipelines when extending (default strategy)", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.default.jsonc"),
      JSON.stringify(
        {
          profiles: {
            default: {
              pipeline: [{ id: "base", type: "command" }],
            },
            "pre-push": {
              extends: "default",
              pipeline: [{ id: "extra", type: "command" }],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig({ profile: "pre-push" });
    expect(config.profile.pipeline.map((s) => s.id)).toEqual(["base", "extra"]);
  });

  it("replaces pipelines when pipelineStrategy is 'replace'", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.default.jsonc"),
      JSON.stringify(
        {
          profiles: {
            default: {
              pipeline: [{ id: "base", type: "command" }],
            },
            "pre-commit": {
              extends: "default",
              pipelineStrategy: "replace",
              pipeline: [{ id: "fast", type: "command" }],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig({ profile: "pre-commit" });
    expect(config.profile.pipeline.map((s) => s.id)).toEqual(["fast"]);
  });

  it("respects explicit profile selection", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.ci.jsonc"),
      JSON.stringify(
        {
          profiles: {
            ci: {
              pipeline: [],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig({ profile: "ci" });
    expect(config.profile.name).toBe("ci");
  });

  it("enables auto-fix by default when the profile opts in", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.local.jsonc"),
      JSON.stringify(
        {
          profiles: {
            local: {
              pipeline: [],
              autoFix: true,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig();
    expect(config.profile.autoFix).toBe(true);
  });

  it("disables auto-fix when the profile opts out explicitly", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.local.jsonc"),
      JSON.stringify(
        {
          profiles: {
            local: {
              pipeline: [],
              autoFix: false,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig();
    expect(config.profile.autoFix).toBe(false);
  });

  it("defaults auto-fix to false when omitted from the profile", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.local.jsonc"),
      JSON.stringify(
        {
          profiles: {
            local: {
              pipeline: [],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig();
    expect(config.profile.autoFix).toBe(false);
  });

  it("allows shards to override inherited auto-fix preferences", async () => {
    writeFileSync(
      path.join(tmpDir, ".qualityrc.jsonc"),
      JSON.stringify(
        {
          $schema: schemaPath,
          stages: {},
          shardDir: ".",
          profiles: {
            default: {
              pipeline: [],
              autoFix: true,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    writeFileSync(
      path.join(tmpDir, ".qualityrc.default.jsonc"),
      JSON.stringify(
        {
          profiles: {
            default: {
              pipeline: [],
              autoFix: false,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadQualityConfig({ profile: "default" });
    expect(config.profile.autoFix).toBe(false);
  });
});
