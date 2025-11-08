import {
  buildFilterFromPreset,
  type CommandOutputFilter,
  type CommandOutputFilterConfig,
  type CommandOutputFilterPreset,
  type CommandOutputLine,
} from "../../utils/command-output-filter";
import { type RunCommandResult, runCommand } from "../../utils/process";
import type { StageAdapter } from "../types";

export type CommandStageEntry =
  | string
  | {
      readonly command: string | readonly string[];
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly env?: Record<string, string>;
      readonly shell?: boolean | string;
      readonly timeoutMs?: number;
      readonly continueOnError?: boolean;
      readonly label?: string;
    };

export interface CommandAdapterOptions {
  readonly commands?: readonly CommandStageEntry[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly shell?: boolean | string;
  readonly timeoutMs?: number;
  readonly abortPipelineOnFailure?: boolean;
  readonly output?: CommandAdapterOutputOptions;
}

export interface CommandAdapterOutputOptions extends CommandOutputFilterConfig {
  readonly preset?: CommandOutputFilterPreset;
  readonly showOnSuccess?: "none" | "filtered" | "raw";
  readonly showOnFailure?: "filtered" | "raw";
}

interface NormalizedCommand {
  readonly displayName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly shell?: boolean | string;
  readonly timeoutMs?: number;
  readonly continueOnError?: boolean;
}

interface OutputContext {
  readonly filter: CommandOutputFilter;
  readonly showOnSuccess: "none" | "filtered" | "raw";
  readonly showOnFailure: "filtered" | "raw";
}

export const commandAdapter: StageAdapter<CommandAdapterOptions> = {
  type: "command",
  label: "Custom command runner",
  supportsModes: ["check", "fix", "report"],
  supportsSandbox: false,
  supportsPartialFiles: true,
  async run(context) {
    const options = context.options ?? {};
    if (context.files.length === 0) {
      return {
        status: "skipped",
        messages: ["No files matched stage scope; skipping commands."],
      };
    }
    const normalized = normalizeCommands(options);
    if (normalized.length === 0) {
      return { status: "passed" };
    }

    const messages: string[] = [];
    const details: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly exitCode: number;
      readonly timedOut: boolean;
      readonly stdout: string;
      readonly stderr: string;
      readonly filtered?: readonly string[];
    }> = [];

    for (const entry of normalized) {
      if (context.abortSignal.aborted) {
        return {
          status: "skipped",
          messages: ["Command execution aborted."],
        };
      }

      const outputContext = resolveOutputContext(options.output);

      const result = await runCommand({
        command: entry.command,
        args: entry.args,
        cwd: entry.cwd ?? options.cwd ?? context.root,
        env: { ...(options.env ?? {}), ...(entry.env ?? {}) },
        abortSignal: context.abortSignal,
        shell: entry.shell ?? options.shell,
        timeoutMs: entry.timeoutMs ?? options.timeoutMs,
        onStdoutChunk: outputContext
          ? (chunk) => outputContext.filter.addChunk("stdout", chunk)
          : undefined,
        onStderrChunk: outputContext
          ? (chunk) => outputContext.filter.addChunk("stderr", chunk)
          : undefined,
      });

      outputContext?.filter.finalize();
      const filteredLines = outputContext
        ? formatOutputLines(outputContext.filter.getFilteredLines())
        : undefined;
      const rawLines = outputContext
        ? formatOutputLines(outputContext.filter.getRawLines())
        : undefined;

      details.push({
        command: entry.command,
        args: entry.args,
        exitCode: result.exitCode,
        timedOut: result.terminationReason === "timeout",
        stdout: result.stdout,
        stderr: result.stderr,
        filtered: filteredLines,
      });

      if (result.terminated && result.terminationReason === "abort") {
        return {
          status: "skipped",
          messages: ["Command execution aborted."],
          details: { commands: details },
        };
      }

      if (result.exitCode !== 0) {
        if (outputContext) {
          const failureLines = resolveLinesForDisplay(
            outputContext,
            filteredLines,
            rawLines,
            "failure",
          );
          if (failureLines.length > 0) {
            messages.push(
              ...failureLines.map((line) => lineWithLabel(entry, line)),
            );
          } else {
            messages.push(commandSummary(entry, result));
          }
        } else {
          messages.push(commandSummary(entry, result));
        }
        if (entry.continueOnError === true) {
          continue;
        }
        return {
          status: "failed",
          messages,
          details: { commands: details },
        };
      }

      if (outputContext) {
        const successLines = resolveLinesForDisplay(
          outputContext,
          filteredLines,
          rawLines,
          "success",
        );
        if (successLines.length > 0) {
          messages.push(
            ...successLines.map((line) => lineWithLabel(entry, line)),
          );
        }
      } else if (result.stdout.trim()) {
        messages.push(`${entry.displayName}: ${result.stdout.trim()}`);
      }
    }

    return {
      status: "passed",
      messages,
      details: { commands: details },
    };
  },
};

const normalizeCommands = (
  options: CommandAdapterOptions,
): NormalizedCommand[] => {
  const commands = Array.isArray(options.commands) ? options.commands : [];
  const normalized: NormalizedCommand[] = [];
  commands.forEach((entry, index) => {
    if (typeof entry === "string") {
      normalized.push({
        displayName: entry,
        command: entry,
        args: [],
        shell: true,
      });
      return;
    }
    const baseArgs: readonly string[] = Array.isArray(entry.command)
      ? entry.command.slice(1)
      : [];
    const commandBinary = Array.isArray(entry.command)
      ? String(entry.command[0])
      : String(entry.command);
    const args = entry.args ? [...baseArgs, ...entry.args] : baseArgs;
    normalized.push({
      displayName: entry.label ?? commandLabel(commandBinary, args, index),
      command: commandBinary,
      args,
      cwd: entry.cwd,
      env: entry.env,
      shell: entry.shell,
      timeoutMs: entry.timeoutMs,
      continueOnError: entry.continueOnError,
    });
  });
  return normalized;
};

const resolveOutputContext = (
  config?: CommandAdapterOutputOptions,
): OutputContext | undefined => {
  if (!config) {
    return undefined;
  }
  if (process.env.QUALITY_SHOW_ALL_OUTPUT === "1") {
    return undefined;
  }
  const { preset, showOnSuccess, showOnFailure, ...filterConfig } = config;
  const filter = buildFilterFromPreset(preset, filterConfig);
  return {
    filter,
    showOnSuccess: showOnSuccess ?? "none",
    showOnFailure: showOnFailure ?? "filtered",
  } satisfies OutputContext;
};

const resolveLinesForDisplay = (
  context: OutputContext,
  filtered: readonly string[] | undefined,
  raw: readonly string[] | undefined,
  phase: "success" | "failure",
): string[] => {
  const mode =
    phase === "success" ? context.showOnSuccess : context.showOnFailure;
  if (mode === "none") {
    return [];
  }
  if (mode === "raw") {
    return [...(raw ?? [])];
  }
  const preferred = filtered && filtered.length > 0 ? filtered : [];
  if (preferred.length > 0) {
    return [...preferred];
  }
  return phase === "failure" ? [...(raw ?? [])] : [];
};

const formatOutputLines = (
  lines: readonly CommandOutputLine[],
): readonly string[] =>
  lines.map((line) =>
    line.source === "stderr" ? `[stderr] ${line.text}` : line.text,
  );

const lineWithLabel = (entry: NormalizedCommand, line: string): string =>
  `${entry.displayName}: ${line}`;

const commandSummary = (
  entry: NormalizedCommand,
  result: RunCommandResult,
): string => {
  const summary = `${entry.displayName} exited with code ${result.exitCode}`;
  return result.stderr.trim() ? `${summary}: ${result.stderr.trim()}` : summary;
};

const commandLabel = (
  command: string,
  args: readonly string[],
  index: number,
): string => {
  const suffix = args.length > 0 ? ` ${args.join(" ")}` : "";
  return `command ${index + 1}: ${command}${suffix}`;
};
