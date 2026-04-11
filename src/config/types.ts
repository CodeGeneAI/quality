import type { ResolvedHooks } from "../pipeline/hooks";
import type { ReporterSpec } from "../reporters/types";

export type FilesMode = "staged" | "workspace" | "commits" | "none";

export type QualityMode = "check" | "fix";

export type StageGroupReference = string | StageGroupConfig;

export interface StageGroupConfig {
  readonly id: string;
  readonly label?: string;
  readonly parallel?: boolean;
  readonly failFast?: boolean;
  readonly continueOnError?: boolean;
}

export interface QualityStageSpec {
  readonly id: string;
  readonly type: string;
  readonly preset?: string;
  readonly overrides?: Record<string, unknown>;
  readonly alwaysRun?: boolean;
  readonly output?: StageOutputOptions;
  readonly label?: string;
  readonly description?: string;
  readonly mode?: QualityMode | "report";
  readonly files?: readonly string[];
  readonly group?: StageGroupReference;
  readonly continueOnError?: boolean;
  readonly if?: string;
  readonly reporters?: readonly ReporterSpec[];
}

export interface StagePresetSpec {
  readonly extends?: string | readonly string[];
  readonly label?: string;
  readonly description?: string;
  readonly mode?: QualityMode | "report";
  readonly alwaysRun?: boolean;
  readonly output?: StageOutputOptions;
  readonly files?: readonly string[];
  readonly group?: StageGroupReference;
  readonly continueOnError?: boolean;
  readonly if?: string;
  readonly reporters?: readonly ReporterSpec[];
  readonly options?: Record<string, unknown>;
}

export interface StageOutputOptions {
  readonly preset?: "bun-test" | "playwright" | "turbo";
  readonly mode?: "passthrough" | "errors-only";
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly trimLines?: boolean;
  readonly showOnSuccess?: "none" | "filtered" | "raw";
  readonly showOnFailure?: "none" | "filtered" | "raw";
}

export interface StageAdapterCatalogEntry {
  presets?: Record<string, StagePresetSpec>;
}

export interface StageCatalogConfig {
  [adapterType: string]: StageAdapterCatalogEntry | undefined;
}

export interface QualityProfileConfig {
  readonly pipeline?: readonly QualityStageSpec[];
  readonly reporters?: readonly ReporterSpec[];
  readonly hooks?: QualityHooksConfig;
  readonly filesMode?: FilesMode;
  readonly parallelLimit?: number;
  /**
   * When true, fixable stages run before verification without requiring the --auto-fix flag.
   * Developers can opt out per-invocation via --no-auto-fix.
   * @default false
   */
  readonly autoFix?: boolean;
  /**
   * Controls how child profiles combine pipelines when using `extends`.
   * - "append" (default): child pipeline entries are appended to the inherited pipeline.
   * - "replace": child pipeline replaces the inherited pipeline entirely.
   */
  readonly pipelineStrategy?: "append" | "replace";
}

export interface QualityHooksConfig {
  readonly onStart?: readonly HookSpec[];
  readonly onComplete?: readonly HookSpec[];
  readonly onSuccess?: readonly HookSpec[];
  readonly onStageFail?: Record<string, readonly HookSpec[]>;
}

export type HookSpec =
  | string
  | {
      readonly command: string;
      readonly cwd?: string;
      readonly env?: Record<string, string>;
      readonly continueOnError?: boolean;
    };

export interface QualityConfig {
  readonly $schema?: string;
  readonly shardDir?: string;
  readonly adapters?: readonly string[];
  readonly stages?: StageCatalogConfig;
  readonly ignore?: readonly string[];
  readonly profiles?: Record<
    string,
    QualityProfileConfig & { extends?: string }
  >;
  readonly reporters?: readonly ReporterSpec[];
  readonly hooks?: QualityHooksConfig;
}

export interface ResolvedStageGroup {
  readonly id: string;
  readonly label?: string;
  readonly parallel: boolean;
  readonly failFast: boolean;
  readonly continueOnError?: boolean;
}

export interface ResolvedStage<TOptions = unknown>
  extends Omit<QualityStageSpec, "preset" | "overrides" | "group"> {
  readonly group?: ResolvedStageGroup;
  readonly options: TOptions;
  readonly preset?: string;
  readonly reporters?: readonly ReporterSpec[];
  readonly alwaysRun?: boolean;
}

export interface ResolvedQualityProfile {
  readonly name: string;
  readonly pipeline: readonly ResolvedStage[];
  readonly reporters: readonly ReporterSpec[];
  readonly hooks: ResolvedHooks;
  readonly filesMode?: FilesMode;
  readonly parallelLimit?: number;
  readonly autoFix?: boolean;
}

export interface LoadConfigOptions {
  readonly profile?: string;
  readonly targetPaths?: readonly string[];
  readonly shardDir?: string;
}
