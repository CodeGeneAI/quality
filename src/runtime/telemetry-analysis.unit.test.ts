import { describe, expect, it } from "bun:test";
import os from "os";
import path from "path";
import {
  analyzeTelemetryContent,
  analyzeTelemetryFile,
  type ParallelLimitSummary,
} from "./telemetry-analysis";

const buildPayload = (options: {
  limit?: number | null;
  source?: string;
  success?: boolean;
  context?: string;
  profile?: string;
  pipelineDurationMs?: number;
  serialDurationMs?: number;
  longestStageMs?: number;
  stageCount?: number;
}): string => {
  const {
    limit = null,
    source = "profile",
    success = true,
    context = "pipeline:local:check",
    profile = "local",
    pipelineDurationMs = 1000,
    serialDurationMs = 2000,
    longestStageMs = 1200,
    stageCount = 2,
  } = options;
  return JSON.stringify({
    timestamp: new Date(0).toISOString(),
    context,
    profile,
    success,
    files: ["sample.txt"],
    stages: [],
    durationMs: pipelineDurationMs,
    metadata: {
      parallelLimit: limit,
      parallelLimitSource: source,
      stageTiming: {
        pipelineDurationMs,
        serialDurationMs,
        averageStageDurationMs: serialDurationMs / stageCount,
        longestStage: longestStageMs
          ? {
              id: "alpha",
              status: "passed",
              durationMs: longestStageMs,
            }
          : undefined,
        stages: Array.from({ length: stageCount }, (_, index) => ({
          id: `stage-${index}`,
          status: "passed",
          durationMs: serialDurationMs / stageCount,
        })),
      },
    },
  });
};

const readBucket = (
  buckets: readonly ParallelLimitSummary[],
  limit: number | null,
): ParallelLimitSummary => {
  const bucket = buckets.find((entry) => entry.limit === limit);
  if (!bucket) {
    throw new Error(`Missing bucket for limit ${String(limit)}`);
  }
  return bucket;
};

describe("analyzeTelemetryContent", () => {
  it("aggregates entries by parallel limit and computes averages", () => {
    const content = [
      buildPayload({
        limit: 2,
        pipelineDurationMs: 500,
        serialDurationMs: 1500,
      }),
      buildPayload({
        limit: 2,
        pipelineDurationMs: 700,
        serialDurationMs: 1400,
      }),
      buildPayload({
        limit: null,
        source: "env",
        pipelineDurationMs: 1200,
        serialDurationMs: 1200,
      }),
    ].join("\n");

    const result = analyzeTelemetryContent(content);
    expect(result.analyzedEntries).toBe(3);
    expect(result.discardedEntries).toBe(0);

    const limited = readBucket(result.buckets, 2);
    expect(limited.samples).toBe(2);
    expect(limited.averagePipelineDurationMs).toBeCloseTo(600);
    expect(limited.averageSerialDurationMs).toBeCloseTo(1450);
    expect(limited.parallelizationRatio).toBeCloseTo(600 / 1450);

    const unbound = readBucket(result.buckets, null);
    expect(unbound.samples).toBe(1);
    expect(unbound.source).toBe("env");
    expect(unbound.parallelizationRatio).toBeCloseTo(1);
    expect(unbound.averageLongestStageDurationMs).toBeGreaterThan(0);
  });

  it("filters by profile, context, and success flag", () => {
    const content = [
      buildPayload({ profile: "ci", context: "pipeline:ci:check" }),
      buildPayload({ profile: "local" }),
      buildPayload({ success: false, pipelineDurationMs: 1500 }),
    ].join("\n");

    const result = analyzeTelemetryContent(content, {
      profile: "ci",
      contextIncludes: "pipeline:ci",
      successOnly: true,
    });

    expect(result.analyzedEntries).toBe(1);
    expect(result.discardedEntries).toBe(2);
    expect(result.buckets[0]?.limit).toBe(null);
  });

  it("ignores malformed entries and missing stage timing", () => {
    const content = [
      "not-json",
      JSON.stringify({ metadata: {} }),
      buildPayload({ limit: 4 }),
    ].join("\n");

    const result = analyzeTelemetryContent(content);
    expect(result.analyzedEntries).toBe(1);
    expect(result.discardedEntries).toBe(2);
    expect(result.totalEntries).toBe(3);
  });

  it("throws a descriptive error when the telemetry file is missing", async () => {
    const missingPath = path.join(
      os.tmpdir(),
      `missing-telemetry-${Date.now()}.log`,
    );

    await expect(
      analyzeTelemetryFile({ filePath: missingPath }),
    ).rejects.toThrow("Telemetry file not found");
  });
});
