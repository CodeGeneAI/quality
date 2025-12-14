import { runJsonReporter } from "./json";
import { runJUnitReporter } from "./junit";
import { runSummaryReporter } from "./summary";
import type {
  PipelineResult,
  ReporterDefinition,
  ReporterOptions,
} from "./types";

export const runReporters = async (
  result: PipelineResult,
  reporters: readonly ReporterDefinition[],
  root: string,
): Promise<void> => {
  for (const reporter of reporters) {
    if (typeof reporter === "string") {
      await runReporter(reporter, undefined, result, root);
    } else {
      const [name, options] = reporter;
      await runReporter(name, options, result, root);
    }
  }
};

const runReporter = async (
  name: string,
  options: ReporterOptions | undefined,
  result: PipelineResult,
  root: string,
): Promise<void> => {
  switch (name) {
    case "summary":
      await runSummaryReporter(result);
      break;
    case "json":
      await runJsonReporter(result, options, root);
      break;
    case "junit":
      await runJUnitReporter(result, options, root);
      break;
    case "verbose":
      await runSummaryReporter(result);
      break;
    default:
      console.warn(`Unknown reporter '${name}', skipping.`);
  }
};
