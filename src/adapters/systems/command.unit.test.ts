import { describe, expect, it } from "bun:test";
import type { ResolvedStage } from "../../config/types";
import type { CommandAdapterOptions } from "./command";
import { commandAdapter } from "./command";

const createStage = (
  options: CommandAdapterOptions,
  overrides: Partial<ResolvedStage> = {},
): ResolvedStage<CommandAdapterOptions> => ({
  id: "command:test",
  type: "command",
  options,
  continueOnError: false,
  files: [],
  alwaysRun: overrides.alwaysRun,
});

describe("commandAdapter", () => {
  it("supports partial file inputs", () => {
    expect(commandAdapter.supportsPartialFiles).toBe(true);
  });

  it("runs a single command successfully", async () => {
    const stage = createStage({
      commands: [{ command: "echo", args: ["hello"] }],
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });

  it("supports shell string commands", async () => {
    const stage = createStage({
      commands: ["echo shell"],
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    expect(result.messages?.some((message) => message.includes("shell"))).toBe(
      true,
    );
  });

  it("reports failure for non-zero exit codes", async () => {
    const stage = createStage({
      commands: [{ command: "sh", args: ["-c", "exit 1"] }],
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
    expect(result.messages?.[0]).toContain("exit 1");
  });

  it("continues executing when a command sets continueOnError", async () => {
    const stage = createStage({
      commands: [
        {
          command: "sh",
          args: ["-c", "exit 1"],
          continueOnError: true,
        },
        {
          command: "echo",
          args: ["after"],
        },
      ],
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    expect(result.messages?.some((message) => message.includes("after"))).toBe(
      true,
    );
  });

  it("respects abort signals", async () => {
    const stage = createStage({
      commands: [{ command: "sleep", args: ["1"] }],
    });

    const abortController = new AbortController();
    abortController.abort();

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: abortController.signal,
    });

    expect(result.status).toBe("skipped");
    expect(result.messages?.[0]).toContain("aborted");
  });

  it("times out long running commands", async () => {
    const stage = createStage({
      commands: [
        {
          command: "sleep",
          args: ["2"],
          timeoutMs: 50,
        },
      ],
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
    expect(result.details).toMatchObject({
      commands: expect.arrayContaining([
        expect.objectContaining({ timedOut: true }),
      ]),
    });
  });

  it("skips when no files are provided", async () => {
    const stage = createStage({
      commands: [{ command: "echo", args: ["unused"] }],
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: [],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("skipped");
    expect(result.messages?.[0]).toContain("No files matched");
  });

  it("runs even with no files when alwaysRun is true", async () => {
    const stage = createStage(
      {
        commands: [{ command: "echo", args: ["always"] }],
      },
      { alwaysRun: true },
    );

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: [],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });

  it("suppresses success noise when output filtering is enabled", async () => {
    const stage = createStage({
      commands: [
        {
          command: "sh",
          args: ["-c", "echo PASS; echo DETAIL"],
        },
      ],
      output: {
        preset: "vitest",
        showOnSuccess: "none",
      },
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    expect(result.messages?.length ?? 0).toBe(0);
  });

  it("emits filtered failure lines when output filtering is enabled", async () => {
    const stage = createStage({
      commands: [
        {
          command: "sh",
          args: ["-c", "echo '✖ suite failed'; echo 'Error: boom' >&2; exit 1"],
        },
      ],
      output: {
        preset: "vitest",
        showOnFailure: "filtered",
      },
    });

    const result = await commandAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["src/example.ts"],
      options: stage.options,
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
    expect(
      result.messages?.some((message) => message.includes("suite failed")),
    ).toBe(true);
    expect(
      result.messages?.some((message) => message.includes("Error: boom")),
    ).toBe(true);
  });
});
