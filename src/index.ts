export { registerBuiltInAdapters } from "./adapters/register-builtins";
export {
  getAdapter,
  listAdapters,
  loadAdapterModule,
  resetAdapters,
} from "./adapters/registry";
export type {
  StageAdapter,
  StageAdapterModuleExport,
  StageExecutionContext,
  StageExecutionResult,
} from "./adapters/types";
export { loadQualityConfig, type ResolvedConfig } from "./config/loader";
export type {
  FilesMode,
  ResolvedStage,
  StagePresetSpec,
} from "./config/types";
export { runPipeline } from "./pipeline/runner";
export { ensureReporterSpecs } from "./reporters/registry";
export type { ReporterSpec } from "./reporters/types";
export {
  collectFilesForMode,
  type FileCollectionMode,
} from "./runtime/file-collector";
export { createConsoleProgressReporter } from "./runtime/progress";
export { isTelemetryEnabled } from "./runtime/telemetry";
export {
  analyzeTelemetryFile,
  type ParallelLimitSummary,
} from "./runtime/telemetry-analysis";
