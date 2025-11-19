import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdapter, resetAdapters } from "../adapters/registry";
import type { StageAdapter } from "../adapters/types";
import type { ResolvedConfig } from "../config/loader";
import type { ResolvedStage } from "../config/types";
import * as processUtils from "../utils/process";
import { ensureHooks } from "./hooks";
import { runPipeline } from "./runner";

interface StubOptions {
  readonly shouldFail?: boolean;
  readonly delayMs?: number;
}

const observedFiles = new Map<string, readonly string[]>();

const stubAdapter: StageAdapter<StubOptions> = {
  type: "stub",
  label: "Stub stage",
  async run(context) {
    observedFiles.set(context.stage.id, context.files);
    if (context.abortSignal.aborted) {
      return { status: "skipped", messages: ["aborted"] };
    }
    if (context.options.delayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, context.options.delayMs),
      );
      if (context.abortSignal.aborted) {
        return { status: "skipped", messages: ["aborted"] };
      }
    }
    if (context.options.shouldFail) {
      return {
        status: "failed",
        messages: ["stub failure"],
      };
    }
    return { status: "passed" };
  },
};

const checkOnlyAdapter: StageAdapter = {
  type: "check-only",
  label: "Check-only stage",
  supportsModes: ["check"],
  async run() {
    return { status: "passed" };
  },
};

const createConfig = (
  stages: readonly ResolvedStage[],
  hooks?: Parameters<typeof ensureHooks>[0],
  ignore: readonly string[] = [],
): ResolvedConfig => ({
  root: process.cwd(),
  adapters: [],
  stageCatalog: {},
  gitHooksManage: true,
  gitHooks: {},
  ignore,
  profile: {
    name: "test",
    pipeline: stages,
    reporters: [],
    hooks: ensureHooks(hooks),
  },
});

const createStage = (
  overrides: Partial<ResolvedStage> & { options?: unknown },
): ResolvedStage => ({
  id: overrides.id ?? "stub",
  type: overrides.type ?? "stub",
  options: overrides.options ?? {},
  continueOnError: overrides.continueOnError ?? false,
  files: overrides.files ?? [],
  group: overrides.group,
  label: overrides.label,
  description: overrides.description,
  mode: overrides.mode,
  preset: overrides.preset,
  reporters: overrides.reporters,
  if: overrides.if,
});

beforeEach(() => {
  observedFiles.clear();
  resetAdapters();
  registerAdapter(stubAdapter);
  registerAdapter(checkOnlyAdapter);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runPipeline", () => {
  it("returns success when stages pass", async () => {
    const config = createConfig([
      createStage({ id: "stage:pass", options: { shouldFail: false } }),
    ]);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({
      id: "stage:pass",
      status: "passed",
    });
  });

  it("halts execution when a stage fails and continueOnError is false", async () => {
    const stages = [
      createStage({ id: "stage:fail", options: { shouldFail: true } }),
      createStage({
        id: "stage:should-not-run",
        options: { shouldFail: false },
      }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("skipped");
  });

  it("continues when continueOnError is true", async () => {
    const stages = [
      createStage({
        id: "stage:fail",
        continueOnError: true,
        options: { shouldFail: true },
      }),
      createStage({ id: "stage:pass", options: { shouldFail: false } }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[1].status).toBe("passed");
  });

  it("aborts siblings in a fail-fast parallel group", async () => {
    const stages = [
      createStage({
        id: "parallel:fail",
        group: { id: "parallel", parallel: true, failFast: true },
        options: { shouldFail: true },
      }),
      createStage({
        id: "parallel:slow",
        group: { id: "parallel", parallel: true, failFast: true },
        options: { delayMs: 200 },
      }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("skipped");
  });

  it("allows other stages to finish when failFast is disabled", async () => {
    const stages = [
      createStage({
        id: "parallel:fail",
        group: { id: "batch", parallel: true, failFast: false },
        options: { shouldFail: true },
      }),
      createStage({
        id: "parallel:pass",
        group: { id: "batch", parallel: true, failFast: false },
        options: { delayMs: 50 },
      }),
      createStage({ id: "after", options: { shouldFail: false } }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages[1].status).toBe("passed");
    expect(result.stages[2]).toMatchObject({
      id: "after",
      status: "skipped",
    });
    expect(result.stages).toHaveLength(3);
  });

  it("filters cli-supplied files using global ignore patterns", async () => {
    const stages = [
      createStage({
        id: "stage:files",
        files: ["src/**/*.ts"],
      }),
    ];
    const config = createConfig(stages, undefined, ["ignored/**"]);

    await runPipeline({
      mode: "check",
      files: ["src/index.ts", "ignored/temp.ts"],
      config,
      reporterDefinitions: [],
    });

    expect(observedFiles.get("stage:files")).toEqual(["src/index.ts"]);
  });

  it("does not drop files that only match built-in defaults", async () => {
    const stages = [
      createStage({
        id: "stage:tmp",
        files: ["tmp/**/*.ts"],
      }),
    ];
    const config = createConfig(stages);

    await runPipeline({
      mode: "check",
      files: ["tmp/work.ts"],
      config,
      reporterDefinitions: [],
    });

    expect(observedFiles.get("stage:tmp")).toEqual(["tmp/work.ts"]);
  });

  it("continues pipeline when parallel stage allows errors", async () => {
    const stages = [
      createStage({
        id: "parallel:lenient",
        group: { id: "lenient", parallel: true, failFast: true },
        continueOnError: true,
        options: { shouldFail: true },
      }),
      createStage({
        id: "parallel:peer",
        group: { id: "lenient", parallel: true, failFast: true },
        options: { delayMs: 20 },
      }),
      createStage({ id: "after", options: { shouldFail: false } }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(3);
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("passed");
    expect(result.stages[2].id).toBe("after");
    expect(result.stages[2].status).toBe("passed");
  });

  it("runs lifecycle hooks around pipeline execution", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        terminated: false,
      });

    const config = createConfig(
      [createStage({ id: "stage:pass", options: { shouldFail: false } })],
      {
        onStart: [{ command: "echo start" }],
        onComplete: [{ command: "echo complete" }],
        onSuccess: [{ command: "echo success" }],
      },
    );

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(true);
    expect(runCommandSpy).toHaveBeenCalledTimes(3);
    expect(
      runCommandSpy.mock.calls.map((call) => ({
        command: call[0].command,
        cwd: call[0].cwd,
        shell: call[0].shell,
      })),
    ).toEqual([
      { command: "echo start", cwd: config.root, shell: true },
      { command: "echo complete", cwd: config.root, shell: true },
      { command: "echo success", cwd: config.root, shell: true },
    ]);
  });

  it("does not mark the pipeline as failed when a hook opts into continueOnError", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "boom",
        terminated: false,
      });

    const config = createConfig(
      [createStage({ id: "stage:pass", options: { shouldFail: false } })],
      {
        onStart: [{ command: "echo fail", continueOnError: true }],
      },
    );

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(true);
    expect(result.stages[0].status).toBe("passed");
    expect(runCommandSpy).toHaveBeenCalledTimes(1);
    expect(runCommandSpy.mock.calls[0][0].command).toBe("echo fail");
  });

  it("runs stage failure hooks for matching ids and wildcard", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        terminated: false,
      });

    const config = createConfig(
      [createStage({ id: "stage:fail", options: { shouldFail: true } })],
      {
        onStageFail: {
          "stage:fail": [{ command: "echo specific" }],
          "*": [{ command: "echo wildcard" }],
        },
      },
    );

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(runCommandSpy).toHaveBeenCalledTimes(2);
    expect(runCommandSpy.mock.calls[0][0].command).toBe("echo specific");
    expect(runCommandSpy.mock.calls[1][0].command).toBe("echo wildcard");
  });

  it("filters stage files using stage patterns", async () => {
    const stages = [
      createStage({
        id: "filtered",
        files: ["src/**/*.ts"],
        options: { shouldFail: false },
      }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: ["src/app.ts", "docs/readme.md"],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(true);
    expect(observedFiles.get("filtered")).toEqual(["src/app.ts"]);
  });

  it("invokes stage lifecycle callbacks", async () => {
    const stages = [
      createStage({ id: "stage:fail", options: { shouldFail: true } }),
      createStage({ id: "stage:skipped", options: { shouldFail: false } }),
    ];
    const config = createConfig(stages);

    const onStageStart = vi.fn();
    const onStageComplete = vi.fn();

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterDefinitions: [],
      onStageStart,
      onStageComplete,
    });

    expect(result.success).toBe(false);
    expect(onStageStart).toHaveBeenCalledTimes(1);
    expect(onStageStart.mock.calls[0][0].id).toBe("stage:fail");
    expect(onStageComplete).toHaveBeenCalledTimes(2);
    expect(onStageComplete.mock.calls.map(([summary]) => summary.id)).toEqual([
      "stage:fail",
      "stage:skipped",
    ]);
    expect(onStageComplete.mock.calls[1][0].status).toBe("skipped");
  });

  it("skips fix execution for adapters without fix support", async () => {
    const stages = [createStage({ id: "structure", type: "check-only" })];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "fix",
      files: [],
      config,
      reporterDefinitions: [],
    });

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({
      id: "structure",
      status: "skipped",
      messages: [
        "Stage adapter 'check-only' does not support mode 'fix'; skipping.",
      ],
    });
  });
});
