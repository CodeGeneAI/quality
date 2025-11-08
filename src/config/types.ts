import type { ResolvedHooks } from "../pipeline/hooks";
import type { ReporterDefinition } from "../reporters/types";

export type QualityMode = "check" | "fix";

export type GitHookFilesMode = "staged" | "workspace" | "commits";

export type CiFilesMode = "workspace" | "commits";

export type StageGroupReference = string | StageGroupConfig;

export interface StageGroupConfig {
  readonly id: string;
  readonly label?: string;
  readonly parallel?: boolean;
  readonly failFast?: boolean;
  readonly continueOnError?: boolean;
}

export interface QualityStageDefinition {
  readonly id: string;
  readonly type: string;
  readonly preset?: string;
  readonly overrides?: Record<string, unknown>;
  readonly label?: string;
  readonly description?: string;
  readonly mode?: QualityMode | "report";
  readonly files?: readonly string[];
  readonly group?: StageGroupReference;
  readonly continueOnError?: boolean;
  readonly if?: string;
  readonly reporters?: readonly ReporterDefinition[];
  readonly appliesTo?: StageApplicability;
}

export interface StagePresetDefinition {
  readonly extends?: string | readonly string[];
  readonly label?: string;
  readonly description?: string;
  readonly mode?: QualityMode | "report";
  readonly files?: readonly string[];
  readonly group?: StageGroupReference;
  readonly continueOnError?: boolean;
  readonly if?: string;
  readonly reporters?: readonly ReporterDefinition[];
  readonly options?: Record<string, unknown>;
  readonly appliesTo?: StageApplicability;
}

export interface StageApplicability {
  readonly hooks?: readonly string[];
  readonly ciTargets?: readonly string[];
  readonly paths?: readonly string[];
}

export interface StageAdapterCatalogEntry {
  presets?: Record<string, StagePresetDefinition>;
}

export interface StageCatalogConfig {
  [adapterType: string]: StageAdapterCatalogEntry | undefined;
}

export interface QualityProfileConfig {
  readonly pipeline?: readonly QualityStageDefinition[];
  readonly reporters?: readonly ReporterDefinition[];
  readonly hooks?: QualityHooksConfig;
}

export interface QualityHooksConfig {
  readonly onStart?: readonly HookDefinition[];
  readonly onComplete?: readonly HookDefinition[];
  readonly onSuccess?: readonly HookDefinition[];
  readonly onStageFail?: Record<string, readonly HookDefinition[]>;
}

export type HookDefinition =
  | string
  | {
      readonly command: string;
      readonly cwd?: string;
      readonly env?: Record<string, string>;
      readonly continueOnError?: boolean;
    };

export interface QualityConfig {
  readonly $schema?: string;
  readonly adapters?: readonly string[];
  readonly stages?: StageCatalogConfig;
  readonly profiles: Record<
    string,
    QualityProfileConfig & { extends?: string }
  >;
  readonly reporters?: readonly ReporterDefinition[];
  readonly hooks?: QualityHooksConfig;
  readonly gitHooks?: GitHooksConfig;
  readonly ciTargets?: Record<string, CiTargetConfig>;
}

export interface AutoFixConfig {
  readonly enabled?: boolean;
  readonly amendCommit?: boolean;
  readonly safety?: "confirm" | "force";
  readonly rerunAfterFix?: boolean;
  readonly preserveCommitMetadata?: boolean;
}

export interface GitHookConfig {
  readonly profile?: string;
  readonly stages?: readonly string[];
  readonly filesMode?: GitHookFilesMode;
  readonly timeoutMs?: number;
  readonly reporters?: readonly ReporterDefinition[];
  readonly hooks?: QualityHooksConfig;
  readonly autoFix?: AutoFixConfig;
  readonly env?: Record<string, string>;
  readonly onlyChangedStageGroups?: boolean;
}

export interface GitHooksConfig {
  readonly manage?: boolean;
  readonly hooks?: Record<string, GitHookConfig>;
}

export interface CiTargetConfig {
  readonly profile?: string;
  readonly stages?: readonly string[];
  readonly filesMode?: CiFilesMode;
  readonly timeoutMs?: number;
  readonly reporters?: readonly ReporterDefinition[];
  readonly hooks?: QualityHooksConfig;
  readonly env?: Record<string, string>;
  readonly matrix?: Record<string, readonly string[]>;
  readonly artifacts?: readonly string[];
  readonly autoFix?: AutoFixConfig;
}

export interface ResolvedAutoFixConfig {
  readonly enabled: boolean;
  readonly amendCommit: boolean;
  readonly safety: "confirm" | "force";
  readonly rerunAfterFix: boolean;
  readonly preserveCommitMetadata: boolean;
}

export interface ResolvedGitHookConfig {
  readonly name: string;
  readonly profile: string;
  readonly stages?: readonly string[];
  readonly filesMode: GitHookFilesMode;
  readonly timeoutMs?: number;
  readonly reporters?: readonly ReporterDefinition[];
  readonly hooks?: QualityHooksConfig;
  readonly autoFix: ResolvedAutoFixConfig;
  readonly env?: Record<string, string>;
  readonly onlyChangedStageGroups?: boolean;
}

export interface ResolvedCiTarget {
  readonly name: string;
  readonly profile: string;
  readonly stages?: readonly string[];
  readonly filesMode: CiFilesMode;
  readonly timeoutMs?: number;
  readonly reporters?: readonly ReporterDefinition[];
  readonly hooks?: QualityHooksConfig;
  readonly env?: Record<string, string>;
  readonly matrix?: Record<string, readonly string[]>;
  readonly artifacts?: readonly string[];
  readonly autoFix: ResolvedAutoFixConfig;
}

export interface ResolvedStageGroup {
  readonly id: string;
  readonly label?: string;
  readonly parallel: boolean;
  readonly failFast: boolean;
  readonly continueOnError?: boolean;
}

export interface ResolvedStage<TOptions = unknown>
  extends Omit<QualityStageDefinition, "preset" | "overrides" | "group"> {
  readonly group?: ResolvedStageGroup;
  readonly options: TOptions;
  readonly preset?: string;
  readonly reporters?: readonly ReporterDefinition[];
}

export interface ResolvedQualityProfile {
  readonly name: string;
  readonly pipeline: readonly ResolvedStage[];
  readonly reporters: readonly ReporterDefinition[];
  readonly hooks: ResolvedHooks;
}

export interface LoadConfigOptions {
  readonly profile?: string;
  readonly targetPaths?: readonly string[];
}
