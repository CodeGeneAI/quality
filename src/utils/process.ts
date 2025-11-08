export interface RunCommandOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly abortSignal?: AbortSignal;
  readonly shell?: boolean | string;
  readonly timeoutMs?: number;
  readonly onStdoutChunk?: (chunk: string) => void;
  readonly onStderrChunk?: (chunk: string) => void;
}

export interface RunCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly terminated: boolean;
  readonly terminationReason?: "abort" | "timeout";
}

export const runCommand = async (
  options: RunCommandOptions,
): Promise<RunCommandResult> => {
  const argsForSpawn = resolveCommand(options);
  const child = Bun.spawn({
    cmd: argsForSpawn,
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  let terminated = false;
  let terminationReason: RunCommandResult["terminationReason"];

  const abortListener = () => {
    if (terminated) return;
    terminated = true;
    terminationReason = "abort";
    child.kill();
  };

  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", abortListener);
    if (options.abortSignal.aborted) {
      abortListener();
    }
  }

  const timeoutId =
    typeof options.timeoutMs === "number"
      ? setTimeout(() => {
          if (terminated) return;
          terminated = true;
          terminationReason = "timeout";
          child.kill();
        }, options.timeoutMs)
      : undefined;

  try {
    const stdoutPromise = child.stdout
      ? readStream(child.stdout, options.onStdoutChunk)
      : Promise.resolve("");
    const stderrPromise = child.stderr
      ? readStream(child.stderr, options.onStderrChunk)
      : Promise.resolve("");

    const exitCode = (await child.exited) ?? 0;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    return {
      exitCode,
      stdout,
      stderr,
      terminated,
      terminationReason,
    } satisfies RunCommandResult;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (options.abortSignal) {
      options.abortSignal.removeEventListener("abort", abortListener);
    }
  }
};

const readStream = async (
  stream: ReadableStream<Uint8Array>,
  onChunk?: (chunk: string) => void,
): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) {
        output += text;
        onChunk?.(text);
      }
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      output += tail;
      onChunk?.(tail);
    }
  } finally {
    reader.releaseLock();
  }
  return output;
};

const resolveCommand = (options: RunCommandOptions): string[] => {
  const args = options.args ? [...options.args] : [];
  if (!options.shell) {
    return [options.command, ...args];
  }
  const shellBinary =
    typeof options.shell === "string" ? options.shell : "/bin/sh";
  const commandString = [options.command, ...args].join(" ");
  return [shellBinary, "-c", commandString];
};
