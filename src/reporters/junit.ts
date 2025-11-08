import { writeTextFile } from "../utils/fs";
import { joinPaths } from "../utils/path";
import type { PipelineResult, ReporterOptions } from "./types";

export const runJUnitReporter = async (
  result: PipelineResult,
  options: ReporterOptions | undefined,
  root: string,
): Promise<void> => {
  if (options && options.enabled === false) {
    return;
  }
  const path = options?.path ?? "reports/quality.junit.xml";
  const resolved = joinPaths(root, path);
  const xml = buildJUnitXml(result);
  await writeTextFile(resolved, xml);
};

const buildJUnitXml = (result: PipelineResult): string => {
  const tests = result.stages.length;
  const failures = result.stages.filter(
    (stage) => stage.status === "failed",
  ).length;
  const cases = result.stages
    .map((stage) => {
      const failureBlock =
        stage.status === "failed"
          ? `<failure message="${encodeXml(stage.messages.join("; "))}"/>`
          : "";
      return `<testcase name="${encodeXml(stage.id)}" time="${(stage.durationMs / 1000).toFixed(3)}">${failureBlock}</testcase>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="quality" tests="${tests}" failures="${failures}">${cases}</testsuite>`;
};

const encodeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
