import type { PipelineResult } from "./types";

export const runSummaryReporter = async (
  result: PipelineResult,
): Promise<void> => {
  if (process.env.QUALITY_SUMMARY_SUPPRESS_STAGES === "1") {
    return;
  }
  const header = `Quality results for profile '${result.profile}'`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const stage of result.stages) {
    const status =
      stage.status === "passed"
        ? "✅"
        : stage.status === "failed"
          ? "❌"
          : "⚪";
    const duration = stage.durationMs.toFixed(0).padStart(6, " ");
    console.log(`${status} ${stage.id.padEnd(20, " ")} (${duration}ms)`);
    for (const message of stage.messages) {
      console.log(`    • ${message}`);
    }
  }
  console.log(result.success ? "All stages passed." : "Some stages failed.");
};
