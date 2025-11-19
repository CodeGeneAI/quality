import type { QualityMode, ResolvedStage } from "../config/types";
import type { StageStatus } from "../reporters/types";

export interface StageExecutionContext<TOptions = unknown> {
  readonly root: string;
  readonly pipelineMode: QualityMode;
  readonly mode: QualityMode | "report";
  readonly stage: ResolvedStage<TOptions>;
  readonly files: readonly string[];
  readonly options: TOptions;
  readonly abortSignal: AbortSignal;
  readonly ignore: readonly string[];
}

export interface StageExecutionResult {
  readonly status: StageStatus;
  readonly messages?: readonly string[];
  readonly details?: Record<string, unknown>;
}

export interface StageAdapter<TOptions = unknown> {
  readonly type: string;
  readonly label: string;
  readonly description?: string;
  readonly supportsModes?: readonly (QualityMode | "report")[];
  readonly supportsSandbox?: boolean;
  readonly supportsPartialFiles?: boolean;
  run(context: StageExecutionContext<TOptions>): Promise<StageExecutionResult>;
}

export type StageAdapterModuleExport =
  | StageAdapter
  | readonly StageAdapter[]
  | { readonly adapters: readonly StageAdapter[] };
