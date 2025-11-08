import { writeTextFile } from "../utils/fs";
import { joinPaths } from "../utils/path";
import type { PipelineResult, ReporterOptions } from "./types";

export const runJsonReporter = async (
  result: PipelineResult,
  options: ReporterOptions | undefined,
  root: string,
): Promise<void> => {
  if (options && options.enabled === false) {
    return;
  }
  const path = options?.path ?? "reports/quality.json";
  const resolved = joinPaths(root, path);
  await writeTextFile(resolved, JSON.stringify(result, null, 2));
};
