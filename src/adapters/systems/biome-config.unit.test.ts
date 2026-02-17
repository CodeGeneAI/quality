import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { BiomeConfigAdapterOptions } from "./biome-config";
import { biomeConfigAdapter } from "./biome-config";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-biome-config-"));

const runAdapter = async (
  root: string,
  options: BiomeConfigAdapterOptions,
  mode: "check" | "fix" | "report" = "check",
) =>
  biomeConfigAdapter.run({
    mode,
    // pipelineMode is always "check" or "fix", never "report"
    pipelineMode: mode === "report" ? "check" : mode,
    stage: {
      id: "biome-config",
      type: "biome-config",
      options,
      continueOnError: false,
      files: [],
    },
    root,
    options,
    files: [],
    ignore: [],
    abortSignal: new AbortController().signal,
  });

describe("biome-config adapter", () => {
  // ============================================================================
  // Basic functionality tests
  // ============================================================================

  it("passes when biome.json already sets useImportType to off", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "services", "api");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "api", version: "0.0.0" }),
      );
      await writeFile(
        join(workspaceDir, "biome.json"),
        JSON.stringify(
          {
            linter: { rules: { style: { useImportType: "off" } } },
          },
          null,
          2,
        ),
      );

      const result = await runAdapter(root, {
        packages: ["services/*/package.json"],
        expectedUseImportType: "off",
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when biome.json is missing in check mode", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(
        root,
        "packages",
        "example",
        "integrations",
        "nest",
      );
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "example", version: "0.0.0" }),
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/integrations/nest/package.json"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("missing Biome config");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates biome.json when useImportType differs in fix mode", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(
        root,
        "packages",
        "example",
        "integrations",
        "nest",
      );
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "example", version: "0.0.0" }),
      );
      const biomePath = join(workspaceDir, "biome.json");
      await writeFile(
        biomePath,
        JSON.stringify(
          {
            $schema: "https://biomejs.dev/schemas/2.3.8/schema.json",
            linter: { rules: { style: { useImportType: "error" } } },
          },
          null,
          2,
        ),
      );

      const result = await runAdapter(
        root,
        {
          packages: ["packages/*/integrations/nest/package.json"],
          expectedUseImportType: "off",
        },
        "fix",
      );

      expect(result.status).toBe("passed");
      const parsed = JSON.parse(await readFile(biomePath, "utf8"));
      expect(parsed.linter.rules.style.useImportType).toBe("off");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Edge case tests - Error handling
  // ============================================================================

  it("reports parse error for malformed JSON", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "malformed");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "malformed" }),
      );
      // Invalid JSON - missing closing brace
      await writeFile(join(workspaceDir, "biome.json"), '{ "linter": {');

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("Failed to parse biome.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates structure and reports invalid biome config shape", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "invalid-structure");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "invalid-structure" }),
      );
      // Valid JSON but invalid structure - linter should be an object
      await writeFile(
        join(workspaceDir, "biome.json"),
        JSON.stringify({ linter: "not-an-object" }),
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("Invalid biome.json structure");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Edge case tests - Empty and multiple packages
  // ============================================================================

  it("passes immediately when packages array is empty", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {
        packages: [],
      });

      expect(result.status).toBe("passed");
      expect(result.messages).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("processes multiple packages and collects all failures", async () => {
    const root = await createTempWorkspace();
    try {
      // Package 1: missing biome.json
      const pkg1 = join(root, "packages", "pkg1");
      await mkdir(pkg1, { recursive: true });
      await writeFile(
        join(pkg1, "package.json"),
        JSON.stringify({ name: "pkg1" }),
      );

      // Package 2: wrong useImportType value
      const pkg2 = join(root, "packages", "pkg2");
      await mkdir(pkg2, { recursive: true });
      await writeFile(
        join(pkg2, "package.json"),
        JSON.stringify({ name: "pkg2" }),
      );
      await writeFile(
        join(pkg2, "biome.json"),
        JSON.stringify({
          linter: { rules: { style: { useImportType: "error" } } },
        }),
      );

      // Package 3: correct config
      const pkg3 = join(root, "packages", "pkg3");
      await mkdir(pkg3, { recursive: true });
      await writeFile(
        join(pkg3, "package.json"),
        JSON.stringify({ name: "pkg3" }),
      );
      await writeFile(
        join(pkg3, "biome.json"),
        JSON.stringify({
          linter: { rules: { style: { useImportType: "off" } } },
        }),
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        expectedUseImportType: "off",
      });

      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(2);
      expect(result.messages?.some((m) => m.includes("pkg1"))).toBe(true);
      expect(result.messages?.some((m) => m.includes("pkg2"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Edge case tests - Report and severity modes
  // ============================================================================

  it("returns passed status with messages in report mode", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "report-test");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "report-test" }),
      );
      await writeFile(
        join(workspaceDir, "biome.json"),
        JSON.stringify({
          linter: { rules: { style: { useImportType: "error" } } },
        }),
      );

      const result = await runAdapter(
        root,
        {
          packages: ["packages/*/package.json"],
          expectedUseImportType: "off",
        },
        "report",
      );

      expect(result.status).toBe("passed");
      expect(result.messages).toBeDefined();
      expect(result.messages?.[0]).toContain(
        "expected linter.rules.style.useImportType",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns passed status with messages when severity is warn", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "warn-test");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "warn-test" }),
      );
      await writeFile(
        join(workspaceDir, "biome.json"),
        JSON.stringify({
          linter: { rules: { style: { useImportType: "error" } } },
        }),
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        expectedUseImportType: "off",
        severity: "warn",
      });

      expect(result.status).toBe("passed");
      expect(result.messages).toBeDefined();
      expect(result.messages?.[0]).toContain(
        "expected linter.rules.style.useImportType",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Edge case tests - Template and fix mode
  // ============================================================================

  it("preserves template fields when creating new biome.json", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "template-test");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "template-test" }),
      );

      const customTemplate = {
        $schema: "https://custom.schema/biome.json",
        formatter: { enabled: true, indentStyle: "space" },
        organizeImports: { enabled: true },
      };

      const result = await runAdapter(
        root,
        {
          packages: ["packages/*/package.json"],
          expectedUseImportType: "off",
          template: customTemplate,
        },
        "fix",
      );

      expect(result.status).toBe("passed");
      const biomePath = join(workspaceDir, "biome.json");
      const parsed = JSON.parse(await readFile(biomePath, "utf8"));
      expect(parsed.$schema).toBe("https://custom.schema/biome.json");
      expect(parsed.formatter.indentStyle).toBe("space");
      expect(parsed.organizeImports.enabled).toBe(true);
      expect(parsed.linter.rules.style.useImportType).toBe("off");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates deep nested structure when biome.json is missing", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "deep-nest");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "deep-nest" }),
      );

      const result = await runAdapter(
        root,
        {
          packages: ["packages/*/package.json"],
          expectedUseImportType: "off",
        },
        "fix",
      );

      expect(result.status).toBe("passed");
      const biomePath = join(workspaceDir, "biome.json");
      const parsed = JSON.parse(await readFile(biomePath, "utf8"));
      expect(parsed.$schema).toBeDefined();
      expect(parsed.root).toBe(false);
      expect(parsed.extends).toBe("//");
      expect(parsed.linter.rules.style.useImportType).toBe("off");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves existing fields when updating useImportType", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "preserve-test");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "preserve-test" }),
      );
      const biomePath = join(workspaceDir, "biome.json");
      await writeFile(
        biomePath,
        JSON.stringify({
          $schema: "https://biomejs.dev/schemas/2.3.8/schema.json",
          formatter: { enabled: true },
          linter: {
            enabled: true,
            rules: {
              recommended: true,
              style: {
                useImportType: "error",
                noUnusedTemplateLiteral: "warn",
              },
              correctness: {
                noUnusedImports: "error",
              },
            },
          },
        }),
      );

      const result = await runAdapter(
        root,
        {
          packages: ["packages/*/package.json"],
          expectedUseImportType: "off",
        },
        "fix",
      );

      expect(result.status).toBe("passed");
      const parsed = JSON.parse(await readFile(biomePath, "utf8"));
      // Should preserve existing fields
      expect(parsed.formatter.enabled).toBe(true);
      expect(parsed.linter.enabled).toBe(true);
      expect(parsed.linter.rules.recommended).toBe(true);
      expect(parsed.linter.rules.style.noUnusedTemplateLiteral).toBe("warn");
      expect(parsed.linter.rules.correctness.noUnusedImports).toBe("error");
      // Should update the target field
      expect(parsed.linter.rules.style.useImportType).toBe("off");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Edge case tests - Value formats
  // ============================================================================

  it("reports correct current value when useImportType is undefined", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "undefined-test");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "undefined-test" }),
      );
      // biome.json exists but without useImportType
      await writeFile(
        join(workspaceDir, "biome.json"),
        JSON.stringify({ linter: { rules: { style: {} } } }),
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        expectedUseImportType: "off",
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("found undefined");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles useImportType as an object configuration", async () => {
    const root = await createTempWorkspace();
    try {
      const workspaceDir = join(root, "packages", "object-config");
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "object-config" }),
      );
      // useImportType can be an object in Biome config
      await writeFile(
        join(workspaceDir, "biome.json"),
        JSON.stringify({
          linter: {
            rules: {
              style: { useImportType: { level: "error", fix: "safe" } },
            },
          },
        }),
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        expectedUseImportType: "off",
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain(
        'found {"level":"error","fix":"safe"}',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
