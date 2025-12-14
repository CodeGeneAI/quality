import { createReadStream, promises as fs } from "fs";
import readline from "readline";
import type { StageTimingMetadata } from "../pipeline/runner";
import type { TelemetryPayload } from "./telemetry";

export interface TelemetryAnalysisFilters {
  readonly profile?: string;
  readonly contextIncludes?: string;
  readonly successOnly?: boolean;
}

export interface ParallelLimitSummary {
  readonly limit: number | null;
  readonly source?: unknown;
  readonly samples: number;
  readonly successRate: number;
  readonly averagePipelineDurationMs: number;
  readonly averageSerialDurationMs: number;
  readonly parallelizationRatio: number;
  readonly averageLongestStageDurationMs: number;
  readonly averageStagesPerRun: number;
}

export interface TelemetryAnalysisResult {
  readonly totalEntries: number;
  readonly analyzedEntries: number;
  readonly buckets: readonly ParallelLimitSummary[];
  readonly discardedEntries: number;
}

export interface TelemetryAnalysisOptions extends TelemetryAnalysisFilters {
  readonly filePath?: string;
}

interface TelemetrySample {
  readonly parallelLimit: number | null;
  readonly parallelLimitSource?: unknown;
  readonly success: boolean;
  readonly stageTiming: StageTimingMetadata;
}

interface BucketAccumulator {
  samples: number;
  successes: number;
  pipelineDurationTotal: number;
  serialDurationTotal: number;
  efficiencyTotal: number;
  longestStageTotal: number;
  longestStageSamples: number;
  stageCountTotal: number;
}

const defaultTelemetryPath = "quality-telemetry.log";

export const analyzeTelemetryFile = async (
  options: TelemetryAnalysisOptions = {},
): Promise<TelemetryAnalysisResult> => {
  const filePath = options.filePath ?? defaultTelemetryPath;
  let lines: readline.Interface | undefined;
  try {
    await fs.access(filePath);
    const stream = createReadStream(filePath, { encoding: "utf8" });
    lines = readline.createInterface({
      input: stream,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Telemetry file not found at '${filePath}'. Generate telemetry by running the pipeline with telemetry enabled or pass --file <path> to quality telemetry analyze.`,
      );
    }
    throw new Error(
      `Failed to read telemetry file at '${filePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let totalEntries = 0;
  let analyzedEntries = 0;
  let discardedEntries = 0;

  const buckets = new Map<
    string,
    BucketAccumulator & { key: { limit: number | null; source?: unknown } }
  >();

  try {
    for await (const rawLine of lines) {
      if (!rawLine || rawLine.trim().length === 0) {
        continue;
      }
      totalEntries += 1;
      const sample = parseTelemetryLine(rawLine, options);
      if (!sample) {
        discardedEntries += 1;
        continue;
      }
      analyzedEntries += 1;
      const key = serializeBucketKey(
        sample.parallelLimit,
        sample.parallelLimitSource,
      );
      const existing = buckets.get(key);
      if (existing) {
        appendSample(existing, sample);
      } else {
        buckets.set(key, createBucket(sample));
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to read telemetry file at '${filePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    lines?.close();
  }

  const summaries = Array.from(buckets.values()).map((bucket) =>
    buildSummary(bucket),
  );
  const sorted = summaries.sort((left, right) => {
    const leftLimit = left.limit ?? Number.POSITIVE_INFINITY;
    const rightLimit = right.limit ?? Number.POSITIVE_INFINITY;
    if (leftLimit === rightLimit) {
      return 0;
    }
    return leftLimit < rightLimit ? -1 : 1;
  });

  return {
    totalEntries,
    analyzedEntries,
    buckets: sorted,
    discardedEntries,
  };
};

export const analyzeTelemetryContent = (
  content: string,
  filters: TelemetryAnalysisFilters = {},
): TelemetryAnalysisResult => {
  const lines = content.split(/\r?\n/);
  let totalEntries = 0;
  let analyzedEntries = 0;
  let discardedEntries = 0;
  const buckets = new Map<
    string,
    BucketAccumulator & { key: { limit: number | null; source?: unknown } }
  >();

  for (const line of lines) {
    if (!line || line.trim().length === 0) {
      continue;
    }
    totalEntries += 1;
    const sample = parseTelemetryLine(line, filters);
    if (!sample) {
      discardedEntries += 1;
      continue;
    }
    analyzedEntries += 1;
    const key = serializeBucketKey(
      sample.parallelLimit,
      sample.parallelLimitSource,
    );
    const existing = buckets.get(key);
    if (existing) {
      appendSample(existing, sample);
    } else {
      buckets.set(key, createBucket(sample));
    }
  }

  const summaries = Array.from(buckets.values()).map((bucket) =>
    buildSummary(bucket),
  );
  const sorted = summaries.sort((left, right) => {
    const leftLimit = left.limit ?? Number.POSITIVE_INFINITY;
    const rightLimit = right.limit ?? Number.POSITIVE_INFINITY;
    if (leftLimit === rightLimit) {
      return 0;
    }
    return leftLimit < rightLimit ? -1 : 1;
  });

  return {
    totalEntries,
    analyzedEntries,
    buckets: sorted,
    discardedEntries,
  };
};

const parseTelemetryLine = (
  line: string,
  filters: TelemetryAnalysisFilters,
): TelemetrySample | null => {
  let payload: TelemetryPayload;
  try {
    payload = JSON.parse(line) as TelemetryPayload;
  } catch {
    return null;
  }

  if (filters.profile && payload.profile !== filters.profile) {
    return null;
  }
  if (
    filters.contextIncludes &&
    !payload.context
      .toLowerCase()
      .includes(filters.contextIncludes.toLowerCase())
  ) {
    return null;
  }
  if (filters.successOnly && !payload.success) {
    return null;
  }

  const stageTiming = extractStageTiming(payload.metadata?.stageTiming);
  if (!stageTiming) {
    return null;
  }

  return {
    parallelLimit: normalizeParallelLimit(payload.metadata?.parallelLimit),
    parallelLimitSource: payload.metadata?.parallelLimitSource,
    success: payload.success,
    stageTiming,
  };
};

const extractStageTiming = (value: unknown): StageTimingMetadata | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const typed = value as Partial<StageTimingMetadata>;
  if (
    !isNumber(typed.pipelineDurationMs) ||
    !isNumber(typed.serialDurationMs) ||
    !isNumber(typed.averageStageDurationMs) ||
    !Array.isArray(typed.stages)
  ) {
    return null;
  }

  const stages = typed.stages.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.status === "string" &&
      isNumber(entry.durationMs),
  )
    ? typed.stages
    : null;

  if (!stages) {
    return null;
  }

  const longestStage =
    typed.longestStage &&
    typeof typed.longestStage === "object" &&
    isNumber(typed.longestStage.durationMs)
      ? typed.longestStage
      : undefined;

  return {
    pipelineDurationMs: Math.max(0, typed.pipelineDurationMs),
    serialDurationMs: Math.max(0, typed.serialDurationMs),
    averageStageDurationMs: Math.max(0, typed.averageStageDurationMs),
    longestStage,
    stages,
  } satisfies StageTimingMetadata;
};

const normalizeParallelLimit = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
};

const serializeBucketKey = (limit: number | null, source: unknown): string =>
  `${limit ?? "unbound"}:${String(source ?? "unspecified")}`;

const createBucket = (
  sample: TelemetrySample,
): BucketAccumulator & { key: { limit: number | null; source?: unknown } } => {
  const efficiency = calculateEfficiency(sample.stageTiming);
  return {
    key: {
      limit: sample.parallelLimit,
      source: sample.parallelLimitSource,
    },
    samples: 1,
    successes: sample.success ? 1 : 0,
    pipelineDurationTotal: sample.stageTiming.pipelineDurationMs,
    serialDurationTotal: sample.stageTiming.serialDurationMs,
    efficiencyTotal: efficiency,
    longestStageTotal: sample.stageTiming.longestStage?.durationMs ?? 0,
    longestStageSamples: sample.stageTiming.longestStage ? 1 : 0,
    stageCountTotal: sample.stageTiming.stages.length,
  };
};

const appendSample = (
  bucket: BucketAccumulator,
  sample: TelemetrySample,
): void => {
  bucket.samples += 1;
  if (sample.success) {
    bucket.successes += 1;
  }
  bucket.pipelineDurationTotal += sample.stageTiming.pipelineDurationMs;
  bucket.serialDurationTotal += sample.stageTiming.serialDurationMs;
  bucket.efficiencyTotal += calculateEfficiency(sample.stageTiming);
  if (sample.stageTiming.longestStage) {
    bucket.longestStageTotal += sample.stageTiming.longestStage.durationMs;
    bucket.longestStageSamples += 1;
  }
  bucket.stageCountTotal += sample.stageTiming.stages.length;
};

const buildSummary = (
  bucket: BucketAccumulator & {
    key: { limit: number | null; source?: unknown };
  },
): ParallelLimitSummary => {
  const averageLongestStageDurationMs =
    bucket.longestStageSamples === 0
      ? 0
      : bucket.longestStageTotal / bucket.longestStageSamples;

  return {
    limit: bucket.key.limit,
    source: bucket.key.source,
    samples: bucket.samples,
    successRate: bucket.samples === 0 ? 0 : bucket.successes / bucket.samples,
    averagePipelineDurationMs:
      bucket.samples === 0 ? 0 : bucket.pipelineDurationTotal / bucket.samples,
    averageSerialDurationMs:
      bucket.samples === 0 ? 0 : bucket.serialDurationTotal / bucket.samples,
    parallelizationRatio:
      bucket.samples === 0 ? 0 : bucket.efficiencyTotal / bucket.samples,
    averageLongestStageDurationMs,
    averageStagesPerRun:
      bucket.samples === 0 ? 0 : bucket.stageCountTotal / bucket.samples,
  } satisfies ParallelLimitSummary;
};

const calculateEfficiency = (timing: StageTimingMetadata): number => {
  if (timing.serialDurationMs <= 0 || timing.pipelineDurationMs <= 0) {
    return 0;
  }
  return timing.pipelineDurationMs / timing.serialDurationMs;
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
