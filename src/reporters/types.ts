export type ReporterName = "summary" | "json" | "junit" | "verbose";

export type ReporterDefinition =
  | ReporterName
  | readonly [ReporterName, ReporterOptions?];

export interface ReporterOptions {
  readonly path?: string;
  readonly enabled?: boolean;
}

export type StageStatus = "passed" | "failed" | "skipped";

export interface StageResultSummary {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
  readonly preset?: string;
  readonly group?: { readonly id: string; readonly label?: string };
  readonly status: StageStatus;
  readonly durationMs: number;
  readonly messages: readonly string[];
  readonly details?: Record<string, unknown>;
}

export interface PipelineResult {
  readonly profile: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stages: readonly StageResultSummary[];
  readonly success: boolean;
}
