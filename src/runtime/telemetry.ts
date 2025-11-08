import { appendFile } from "fs/promises";
import { dirname, join } from "path";
import type { PipelineResult } from "../reporters/types";
import { ensureDir } from "../utils/fs";

export interface TelemetryPayload {
  readonly timestamp: string;
  readonly context: string;
  readonly profile: string;
  readonly success: boolean;
  readonly files: readonly string[];
  readonly stages: PipelineResult["stages"];
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface TelemetryOptions {
  readonly context: string;
  readonly result: PipelineResult;
  readonly files: readonly string[];
  readonly root: string;
  readonly metadata?: Record<string, unknown>;
}

type TelemetryMode = "off" | "stdout" | "file";

const resolveTelemetryMode = (): TelemetryMode => {
  const value = (process.env.QUALITY_TELEMETRY ?? "").toLowerCase();
  if (value === "stdout" || value === "file") {
    return value;
  }
  return "off";
};

export const isTelemetryEnabled = (): boolean => {
  const mode = resolveTelemetryMode();
  return mode === "stdout" || mode === "file";
};

export const publishTelemetry = async (
  options: TelemetryOptions,
): Promise<void> => {
  const mode = resolveTelemetryMode();
  if (mode === "off") {
    return;
  }

  const started = Date.parse(options.result.startedAt);
  const finished = Date.parse(options.result.finishedAt);
  const payload: TelemetryPayload = {
    timestamp: new Date().toISOString(),
    context: options.context,
    profile: options.result.profile,
    success: options.result.success,
    files: Array.from(options.files),
    stages: options.result.stages,
    durationMs: Number.isFinite(finished - started) ? finished - started : 0,
    metadata: options.metadata,
  } satisfies TelemetryPayload;

  try {
    if (mode === "stdout") {
      console.log(`quality.telemetry ${JSON.stringify(payload)}`);
      return;
    }
    if (mode === "file") {
      const target = resolveTelemetryFile(options.root);
      await ensureParentDir(target);
      await appendFile(target, `${JSON.stringify(payload)}\n`, "utf8");
      return;
    }
  } catch (error) {
    console.warn(
      "Failed to publish quality telemetry:",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const resolveTelemetryFile = (root: string): string => {
  const override = process.env.QUALITY_TELEMETRY_FILE;
  if (override && override.trim().length > 0) {
    return override;
  }
  return join(root, "quality-telemetry.log");
};

const ensureParentDir = async (path: string): Promise<void> => {
  await ensureDir(dirname(path));
};
