import fg from "fast-glob";
import { existsSync } from "fs";
import path from "path";
import z from "zod";
import { readJsonFile, writeTextFile } from "../../utils/fs";
import { mergeIgnorePatterns } from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

// ============================================================================
// Types and Schemas
// ============================================================================

type Severity = "error" | "warn";

/**
 * Zod schema for validating Biome configuration structure.
 * Validates the shape of biome.json files to catch malformed configs early.
 */
const BiomeConfigSchema = z
  .object({
    $schema: z.string().optional(),
    root: z.boolean().optional(),
    extends: z.string().optional(),
    formatter: z.record(z.string(), z.unknown()).optional(),
    linter: z
      .object({
        enabled: z.boolean().optional(),
        rules: z
          .object({
            recommended: z.boolean().optional(),
            style: z
              .object({
                useImportType: z
                  .union([z.string(), z.record(z.string(), z.unknown())])
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type BiomeConfig = z.infer<typeof BiomeConfigSchema>;

type JsonObject = Record<string, unknown>;

/**
 * Configuration options for the biome-config quality adapter.
 */
export interface BiomeConfigAdapterOptions {
  /**
   * Glob patterns for package.json files to check.
   * The adapter will look for biome.json in the same directory as each package.json.
   * @example ["services/*\/package.json", "packages/**\/nest/package.json"]
   */
  readonly packages?: readonly string[];

  /**
   * Name of the Biome configuration file to check.
   * @default "biome.json"
   */
  readonly biomeFile?: string;

  /**
   * Expected value for linter.rules.style.useImportType.
   * @default "off"
   */
  readonly expectedUseImportType?: string;

  /**
   * Template to use when creating new biome.json files in fix mode.
   * If not provided, a minimal template will be generated.
   */
  readonly template?: JsonObject;

  /**
   * How to treat violations.
   * - "error": Fail the check (default)
   * - "warn": Report but pass
   * @default "error"
   */
  readonly severity?: Severity;
}

// ============================================================================
// Constants
// ============================================================================

const NODE_MODULES_IGNORE = ["**/node_modules/**"] as const;
const DEFAULT_BIOME_FILENAME = "biome.json";
const DEFAULT_USE_IMPORT_TYPE = "off";
const DEFAULT_SCHEMA = "https://biomejs.dev/schemas/2.3.8/schema.json";
const DEFAULT_SEVERITY: Severity = "error";

// ============================================================================
// Error Types
// ============================================================================

class BiomeConfigError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "BiomeConfigError";
  }
}

class BiomeConfigParseError extends BiomeConfigError {
  constructor(filePath: string, cause: Error) {
    super(`Failed to parse biome.json: ${cause.message}`, filePath, cause);
    this.name = "BiomeConfigParseError";
  }
}

class BiomeConfigValidationError extends BiomeConfigError {
  constructor(filePath: string, zodError: z.ZodError) {
    const issues = zodError.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    super(`Invalid biome.json structure: ${issues}`, filePath);
    this.name = "BiomeConfigValidationError";
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates the structure of a parsed Biome config against the Zod schema.
 * @throws BiomeConfigValidationError if validation fails
 */
const validateBiomeConfig = (
  config: unknown,
  filePath: string,
): BiomeConfig => {
  const result = BiomeConfigSchema.safeParse(config);
  if (!result.success) {
    throw new BiomeConfigValidationError(filePath, result.error);
  }
  return result.data;
};

/**
 * Checks if a value satisfies linter.rules.style.useImportType requirements.
 */
const validateUseImportType = (
  config: BiomeConfig,
  expected: string,
): { isValid: boolean; currentValue: unknown } => {
  const currentValue = config.linter?.rules?.style?.useImportType;
  return {
    isValid: currentValue === expected,
    currentValue,
  };
};

// ============================================================================
// File I/O Functions
// ============================================================================

/**
 * Reads and validates a Biome configuration file.
 * @returns The validated config, or undefined if file doesn't exist
 * @throws BiomeConfigParseError for JSON parse errors
 * @throws BiomeConfigValidationError for invalid structure
 * @throws BiomeConfigError for other I/O errors
 */
const readBiomeConfig = async (
  filePath: string,
): Promise<BiomeConfig | undefined> => {
  // Check if file exists first to distinguish missing file from errors
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const rawConfig = await readJsonFile<unknown>(filePath);
    return validateBiomeConfig(rawConfig, filePath);
  } catch (error) {
    // Re-throw our custom errors
    if (error instanceof BiomeConfigError) {
      throw error;
    }

    // Wrap JSON parse errors
    if (error instanceof SyntaxError) {
      throw new BiomeConfigParseError(filePath, error);
    }

    // Wrap other errors with context
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new BiomeConfigError(
      `Failed to read biome.json: ${cause.message}`,
      filePath,
      cause,
    );
  }
};

/**
 * Writes a Biome configuration to disk.
 */
const writeBiomeConfig = async (
  filePath: string,
  config: JsonObject,
): Promise<void> => {
  await writeTextFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
};

// ============================================================================
// Config Transformation Functions
// ============================================================================

/**
 * Builds a template for a new biome.json file.
 * Applies defaults for missing required fields.
 */
const buildTemplate = (
  template: JsonObject | undefined,
  expectedUseImportType: string,
): JsonObject => {
  const base: JsonObject = template ? structuredClone(template) : {};

  // Apply defaults using nullish coalescing for consistency
  base.$schema ??= DEFAULT_SCHEMA;
  base.root ??= false;
  base.extends ??= "//";

  // Build nested structure immutably
  const existingLinter = isJsonObject(base.linter) ? base.linter : {};
  const existingRules = isJsonObject(existingLinter.rules)
    ? existingLinter.rules
    : {};
  const existingStyle = isJsonObject(existingRules.style)
    ? existingRules.style
    : {};

  base.linter = {
    ...existingLinter,
    rules: {
      ...existingRules,
      style: {
        ...existingStyle,
        useImportType: expectedUseImportType,
      },
    },
  };

  return base;
};

/**
 * Updates a Biome config to have the expected useImportType value.
 * Returns a new config object without mutating the input.
 */
const updateUseImportType = (
  biomeConfig: BiomeConfig,
  expectedUseImportType: string,
): BiomeConfig => {
  // Deep clone to avoid mutation
  const updated = structuredClone(biomeConfig) as BiomeConfig;

  // Ensure nested structure exists
  updated.linter ??= {};
  updated.linter.rules ??= {};
  updated.linter.rules.style ??= {};
  updated.linter.rules.style.useImportType = expectedUseImportType;

  return updated;
};

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Formats a value for display in error messages.
 */
const stringifyValue = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `'${value}'`;
  return JSON.stringify(value);
};

/**
 * Formats a missing config error message.
 */
const formatMissingConfigError = (
  relativePath: string,
  expected: string,
): string =>
  `${relativePath}: missing Biome config with useImportType '${expected}'`;

/**
 * Formats a wrong value error message.
 */
const formatWrongValueError = (
  relativePath: string,
  expected: string,
  actual: unknown,
): string =>
  `${relativePath}: expected linter.rules.style.useImportType to be '${expected}' (found ${stringifyValue(actual)})`;

// ============================================================================
// Type Guards
// ============================================================================

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ============================================================================
// Main Adapter
// ============================================================================

export const biomeConfigAdapter: StageAdapter<BiomeConfigAdapterOptions> = {
  type: "biome-config",
  label: "Validate Biome configuration",
  supportsModes: ["check", "fix", "report"],
  supportsSandbox: true,
  supportsPartialFiles: false,

  async run(context) {
    const options = context.options ?? {};
    const packageGlobs = options.packages ?? [];
    const biomeFile = options.biomeFile ?? DEFAULT_BIOME_FILENAME;
    const expectedUseImportType =
      options.expectedUseImportType ?? DEFAULT_USE_IMPORT_TYPE;
    const severity = options.severity ?? DEFAULT_SEVERITY;

    // Early return for empty config
    if (packageGlobs.length === 0) {
      return { status: "passed" };
    }

    const ignorePatterns = mergeIgnorePatterns(
      NODE_MODULES_IGNORE,
      context.ignore,
    );
    const packagePaths = await fg(Array.from(packageGlobs), {
      cwd: context.root,
      dot: false,
      unique: true,
      ignore: [...ignorePatterns],
    });

    const failures: string[] = [];
    const infos: string[] = [];

    for (const packagePath of packagePaths) {
      const workspaceRoot = path.dirname(packagePath);
      const biomeRelativePath = joinPaths(workspaceRoot, biomeFile);
      const biomeAbsolutePath = joinPaths(context.root, biomeRelativePath);

      try {
        const biomeConfig = await readBiomeConfig(biomeAbsolutePath);

        if (!biomeConfig) {
          // File doesn't exist
          if (context.mode === "fix") {
            const template = buildTemplate(
              options.template,
              expectedUseImportType,
            );
            await writeBiomeConfig(biomeAbsolutePath, template);
            infos.push(
              `${biomeRelativePath}: created with useImportType '${expectedUseImportType}'`,
            );
            continue;
          }

          failures.push(
            formatMissingConfigError(biomeRelativePath, expectedUseImportType),
          );
          continue;
        }

        // Config exists, validate useImportType
        const { isValid, currentValue } = validateUseImportType(
          biomeConfig,
          expectedUseImportType,
        );

        if (!isValid) {
          if (context.mode === "fix") {
            const updated = updateUseImportType(
              biomeConfig,
              expectedUseImportType,
            );
            await writeBiomeConfig(biomeAbsolutePath, updated);
            infos.push(
              `${biomeRelativePath}: set useImportType to '${expectedUseImportType}'`,
            );
            continue;
          }

          failures.push(
            formatWrongValueError(
              biomeRelativePath,
              expectedUseImportType,
              currentValue,
            ),
          );
        }
      } catch (error) {
        // Handle our custom errors with proper messages
        if (error instanceof BiomeConfigError) {
          failures.push(`${biomeRelativePath}: ${error.message}`);
          continue;
        }

        // Unexpected errors should propagate
        throw error;
      }
    }

    // Determine result based on failures and severity
    if (failures.length === 0) {
      return {
        status: "passed",
        messages: infos.length > 0 ? infos : undefined,
      };
    }

    if (context.mode === "report" || severity === "warn") {
      return { status: "passed", messages: [...failures, ...infos] };
    }

    return { status: "failed", messages: [...failures, ...infos] };
  },
};
