import type { ResolvedStage } from "../config/types";
import type { StageResultSummary } from "../reporters/types";

export interface ConsoleProgressReporterOptions {
  readonly profile: string;
  readonly stages: readonly ResolvedStage[];
}

export interface ConsoleProgressPhase {
  readonly stageStarted: (stage: ResolvedStage) => void | Promise<void>;
  readonly stageCompleted: (
    summary: StageResultSummary,
  ) => void | Promise<void>;
}

export interface ConsoleProgressReporter extends ConsoleProgressPhase {
  readonly finish: (success: boolean) => void;
  readonly withPhase: (phase: string) => ConsoleProgressPhase;
}

export const createConsoleProgressReporter = (
  options: ConsoleProgressReporterOptions,
): ConsoleProgressReporter => {
  const { profile, stages } = options;
  const header = `Quality results for profile '${profile}'`;
  console.log(header);
  console.log("-".repeat(header.length));

  const stageIdLengths = stages.map((stage) => stage.id.length);
  const labelWidth =
    stageIdLengths.length > 0 ? Math.max(20, ...stageIdLengths) : 20;

  const stageStarted = (): void => {
    // Placeholder for future richer progress events.
  };

  const stageCompleted = async (
    summary: StageResultSummary,
    phase?: string,
  ): Promise<void> => {
    const symbol =
      summary.status === "passed"
        ? "✅"
        : summary.status === "failed"
          ? "❌"
          : "⚪";
    const duration = Number.isFinite(summary.durationMs)
      ? Math.max(0, Math.round(summary.durationMs)).toString().padStart(6, " ")
      : "   n/a";
    const phasePrefix = phase ? `[${phase}] ` : "";
    console.log(
      `${symbol} ${phasePrefix}${summary.id.padEnd(labelWidth, " ")} (${duration}ms)`,
    );
    for (const message of summary.messages) {
      const trimmed = message.trim();
      if (trimmed.length === 0) {
        continue;
      }
      console.log(`    • ${trimmed}`);
    }
  };

  const finish = (success: boolean): void => {
    console.log(success ? "All stages passed." : "Some stages failed.");
  };

  const buildPhase = (phase?: string): ConsoleProgressPhase => ({
    stageStarted,
    stageCompleted: (summary) => stageCompleted(summary, phase),
  });

  return {
    ...buildPhase(),
    finish,
    withPhase: (phase: string) => buildPhase(phase),
  } satisfies ConsoleProgressReporter;
};
