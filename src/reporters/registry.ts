import type { ReporterDefinition, ReporterName } from "./types";

const REPORTER_NAMES: readonly ReporterName[] = [
  "summary",
  "json",
  "junit",
  "verbose",
];

const isReporterName = (value: string): value is ReporterName =>
  (REPORTER_NAMES as readonly string[]).includes(value);

export const ensureReporterDefinitions = (
  reporters: readonly ReporterDefinition[] | ReporterDefinition,
): ReporterDefinition[] => {
  const list = Array.isArray(reporters) ? reporters : [reporters];
  const normalized: ReporterDefinition[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      if (isReporterName(entry)) {
        normalized.push(entry);
      }
    } else if (
      Array.isArray(entry) &&
      entry.length > 0 &&
      typeof entry[0] === "string" &&
      isReporterName(entry[0])
    ) {
      const tuple: ReporterDefinition = [entry[0], entry[1]];
      normalized.push(tuple);
    }
  }
  if (normalized.length === 0) {
    normalized.push("summary");
  }
  return normalized;
};
