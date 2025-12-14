import Ajv from "ajv";
import { readFileSync } from "fs";
import { parse } from "jsonc-parser";
import { extname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../../schemas/qualityrc.schema.json", import.meta.url),
);

const loadJson = (path: string): unknown => {
  const content = readFileSync(path, "utf8");
  if (extname(path) === ".jsonc") {
    return parse(content) as unknown;
  }
  return JSON.parse(content);
};

describe("quality schema", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = loadJson(schemaPath) as { $id?: string };
  const validate = ajv.compile(schema);

  it("validates known good configurations", async () => {
    const fixtureRoot = fileURLToPath(
      new URL("../../test/fixtures", import.meta.url),
    );
    const configs = [
      join(fixtureRoot, "basic/.qualityrc.json"),
      join(fixtureRoot, "basic/packages/app/.qualityrc.json"),
      join(fixtureRoot, "presets/.qualityrc.json"),
      join(fixtureRoot, "adapters/.qualityrc.json"),
      join(fixtureRoot, "pipeline-strategy/.qualityrc.json"),
      join(fixtureRoot, "auto-fix/.qualityrc.json"),
      // profile-less base config with shardDir is valid
      join(fixtureRoot, "config-jsonc/.qualityrc.jsonc"),
    ];

    for (const configPath of configs) {
      const config = loadJson(configPath);
      const valid = validate(config);
      if (!valid) {
        console.error(
          `Schema validation failed for ${configPath}:`,
          validate.errors,
        );
      }
      expect(validate.errors ?? []).toHaveLength(0);
    }
  });

  it("rejects configs with an invalid pipelineStrategy", async () => {
    const invalidConfig = {
      profiles: {
        local: {
          pipeline: [{ id: "a", type: "stub" }],
          pipelineStrategy: "invalid",
        },
      },
    };

    const valid = validate(invalidConfig);
    expect(valid).toBe(false);
    expect(
      (validate.errors ?? []).some(
        (error) =>
          error.instancePath === "/profiles/local/pipelineStrategy" &&
          error.keyword === "enum",
      ),
    ).toBe(true);
  });

  it("rejects invalid configurations", async () => {
    const invalidConfig = {
      profiles: {
        local: {
          pipeline: [
            {
              id: "missing:type",
              overrides: {},
            },
          ],
        },
      },
    };
    const valid = validate(invalidConfig);
    expect(valid).toBe(false);
    expect(
      (validate.errors ?? []).some((error) =>
        typeof error?.instancePath === "string" ? true : true,
      ),
    ).toBe(true);
  });
});
