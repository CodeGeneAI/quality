import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../../schemas/qualityrc.schema.json", import.meta.url),
);

const loadJson = (path: string): unknown => {
  const content = readFileSync(path, "utf8");
  return JSON.parse(content);
};

describe("quality schema", () => {
  it("validates known good configurations", async () => {
    const jsonschemaModule = await import(
      "../../test/helpers/jsonschema/index.js"
    );
    const { Validator } = (jsonschemaModule.default ?? jsonschemaModule) as {
      Validator: new () => {
        addSchema: (schema: unknown, id?: string) => void;
        validate: (
          instance: unknown,
          schema: unknown,
        ) => {
          errors: unknown[];
        };
      };
    };
    const validator = new Validator();
    const schema = loadJson(schemaPath) as { $id?: string };
    if (typeof schema.$id === "string") {
      validator.addSchema(schema, schema.$id);
    }

    const fixtureRoot = fileURLToPath(
      new URL("../../test/fixtures", import.meta.url),
    );
    const configs = [
      join(fixtureRoot, "basic/.qualityrc.json"),
      join(fixtureRoot, "basic/packages/app/.qualityrc.json"),
      join(fixtureRoot, "presets/.qualityrc.json"),
      join(fixtureRoot, "adapters/.qualityrc.json"),
    ];

    for (const configPath of configs) {
      const config = loadJson(configPath);
      const result = validator.validate(config, schema);
      if (result.errors.length > 0) {
        const errors = result.errors as Array<{ stack?: string }>;
        console.error(
          `Schema validation failed for ${configPath}:`,
          errors.map((error) => error.stack ?? String(error)),
        );
      }
      expect(result.errors).toHaveLength(0);
    }
  });

  it("rejects invalid configurations", async () => {
    const jsonschemaModule = await import(
      "../../test/helpers/jsonschema/index.js"
    );
    const { Validator } = (jsonschemaModule.default ?? jsonschemaModule) as {
      Validator: new () => {
        validate: (
          instance: unknown,
          schema: unknown,
        ) => {
          errors: Array<{ stack?: string }>;
        };
      };
    };
    const validator = new Validator();
    const schema = loadJson(schemaPath);

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

    const result = validator.validate(invalidConfig, schema);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(
      result.errors.some(
        (error: { stack?: string }) =>
          typeof error.stack === "string" && error.stack.includes("type"),
      ),
    ).toBe(true);
  });
});
