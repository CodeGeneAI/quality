import { escapeRegExp } from "./string";

export type CommandOutputSource = "stdout" | "stderr";

export type CommandOutputFilterPreset = "bun-test" | "playwright" | "turbo";

export interface CommandOutputFilterConfig {
  readonly mode?: "passthrough" | "errors-only";
  readonly include?: readonly (string | RegExp)[];
  readonly exclude?: readonly (string | RegExp)[];
  readonly trimLines?: boolean;
}

export interface CommandOutputLine {
  readonly source: CommandOutputSource;
  readonly text: string;
}

export class CommandOutputFilter {
  private readonly include?: readonly RegExp[];

  private readonly exclude?: readonly RegExp[];

  private readonly trimLines: boolean;

  private readonly mode: "passthrough" | "errors-only";

  private readonly buffers: Record<CommandOutputSource, string> = {
    stdout: "",
    stderr: "",
  };

  private readonly rawLines: CommandOutputLine[] = [];

  private readonly filteredLines: CommandOutputLine[] = [];

  constructor(config: CommandOutputFilterConfig = {}) {
    this.mode = config.mode ?? "passthrough";
    this.include = normalizePatterns(config.include);
    this.exclude = normalizePatterns(config.exclude);
    this.trimLines = config.trimLines ?? true;
  }

  addChunk(source: CommandOutputSource, chunk: string): void {
    this.buffers[source] += chunk;
    this.flushBuffer(source);
  }

  finalize(): void {
    this.flushBuffer("stdout", true);
    this.flushBuffer("stderr", true);
  }

  getRawLines(): readonly CommandOutputLine[] {
    return this.rawLines;
  }

  getFilteredLines(): readonly CommandOutputLine[] {
    return this.mode === "passthrough" ? this.rawLines : this.filteredLines;
  }

  private flushBuffer(source: CommandOutputSource, force = false): void {
    const buffer = this.buffers[source];
    if (!buffer && !force) {
      return;
    }
    const lines = buffer.split(/\n/);
    if (!force) {
      this.buffers[source] = lines.pop() ?? "";
    } else {
      this.buffers[source] = "";
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
    }
    for (const rawLine of lines) {
      const line = this.trimLines ? rawLine.trimEnd() : rawLine;
      const record = { source, text: line } satisfies CommandOutputLine;
      this.rawLines.push(record);
      if (this.mode === "passthrough") {
        continue;
      }
      if (line.length === 0) {
        continue;
      }
      if (this.include && !this.include.some((regex) => regex.test(line))) {
        continue;
      }
      if (this.exclude && this.exclude.some((regex) => regex.test(line))) {
        continue;
      }
      this.filteredLines.push(record);
    }
  }
}

export const commandOutputFilterPresets: Record<
  CommandOutputFilterPreset,
  CommandOutputFilterConfig
> = {
  "bun-test": {
    mode: "errors-only",
    include: [
      /^\s*(FAIL|✖|✗|×|ERR)/i,
      /^\s*[●•]/,
      /AssertionError/,
      /^Error:/,
      /^\s*at\s/,
    ],
    exclude: [/^(\s+at\snode:internal)/],
  },
  playwright: {
    mode: "errors-only",
    include: [/^\s*(FAIL|ERR|Timeout)/i, /^\s*at\s/],
  },
  turbo: {
    mode: "errors-only",
    include: [/^\s*✖/, /^\s*ERROR/i],
    exclude: [/^\s*cache/],
  },
};

export const buildFilterFromPreset = (
  preset?: CommandOutputFilterPreset,
  overrides?: CommandOutputFilterConfig,
): CommandOutputFilter => {
  const base = preset ? (commandOutputFilterPresets[preset] ?? {}) : {};
  return new CommandOutputFilter({
    ...base,
    ...overrides,
    include: mergePatternArrays(base.include, overrides?.include),
    exclude: mergePatternArrays(base.exclude, overrides?.exclude),
  });
};

const mergePatternArrays = (
  base?: readonly (string | RegExp)[] | undefined,
  extra?: readonly (string | RegExp)[] | undefined,
): readonly (string | RegExp)[] | undefined => {
  if (!base && !extra) {
    return undefined;
  }
  return [...(base ?? []), ...(extra ?? [])];
};

const normalizePatterns = (
  patterns?: readonly (string | RegExp)[],
): readonly RegExp[] | undefined => {
  if (!patterns || patterns.length === 0) {
    return undefined;
  }
  return patterns.map((pattern) =>
    pattern instanceof RegExp
      ? pattern
      : new RegExp(escapeRegExp(pattern), "i"),
  );
};
