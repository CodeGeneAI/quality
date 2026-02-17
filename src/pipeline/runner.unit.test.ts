import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

import { registerAdapter, resetAdapters } from "../adapters/registry";
import type { StageAdapter } from "../adapters/types";
import type { ResolvedConfig } from "../config/loader";
import type { ResolvedQualityProfile, ResolvedStage } from "../config/types";
import type { PipelineResult } from "../reporters/types";
import * as processUtils from "../utils/process";
import { ensureHooks } from "./hooks";
import { buildStageTimingMetadata, runPipeline } from "./runner";

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
  profileOverrides?: Partial<Pick<ResolvedQualityProfile, "parallelLimit">>,
): ResolvedConfig => ({
  root: process.cwd(),
  adapters: [],
  stageCatalog: {},
  ignore,
  profile: {
    name: "test",
    pipeline: stages,
    reporters: [],
    hooks: ensureHooks(hooks),
    parallelLimit: profileOverrides?.parallelLimit,
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

describe("buildStageTimingMetadata", () => {
  it("summarizes pipeline and stage timings for telemetry", () => {
    const result = {
      profile: "test",
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1500).toISOString(),
      success: true,
      stages: [
        {
          id: "one",
          type: "stub",
          status: "passed",
          durationMs: 500,
          messages: [],
        },
        {
          id: "two",
          type: "stub",
          status: "failed",
          durationMs: 1000,
          messages: [],
          group: { id: "parallel" },
        },
        {
          id: "three",
          type: "stub",
          status: "skipped",
          durationMs: Number.NaN,
          messages: [],
        },
      ],
    } satisfies PipelineResult;

    const metadata = buildStageTimingMetadata(result);

    expect(metadata.pipelineDurationMs).toBe(1500);
    expect(metadata.serialDurationMs).toBe(1500);
    expect(metadata.averageStageDurationMs).toBeCloseTo(500);
    expect(metadata.longestStage?.id).toBe("two");
    expect(metadata.stages).toEqual([
      { id: "one", status: "passed", durationMs: 500, groupId: undefined },
      { id: "two", status: "failed", durationMs: 1000, groupId: "parallel" },
      { id: "three", status: "skipped", durationMs: 0, groupId: undefined },
    ]);
  });
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
      reporterSpecs: [],
    });

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({
      id: "stage:pass",
      status: "passed",
    });
  });

  it("publishes telemetry with stage timing metadata when enabled", async () => {
    const previousTelemetry = process.env.QUALITY_TELEMETRY;
    process.env.QUALITY_TELEMETRY = "stdout";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = createConfig([
      createStage({ id: "stage:telemetry", options: { delayMs: 5 } }),
    ]);

    await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const payload = consoleSpy.mock.calls[0]?.[0];
    if (typeof payload !== "string") {
      throw new Error("expected telemetry payload to be a string");
    }
    const jsonStart = payload.indexOf("{");
    const parsed = JSON.parse(payload.slice(jsonStart));
    expect(parsed.metadata.stageTiming.stages[0].id).toBe("stage:telemetry");
    expect(parsed.metadata.stageTiming.pipelineDurationMs).toBeGreaterThan(0);

    consoleSpy.mockRestore();
    if (previousTelemetry === undefined) {
      delete process.env.QUALITY_TELEMETRY;
    } else {
      process.env.QUALITY_TELEMETRY = previousTelemetry;
    }
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
      reporterSpecs: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("skipped");
  });

  it("evaluates conditional stages against environment variables", async () => {
    const envKey = "QUALITY_CONDITION_FLAG";
    const originalValue = process.env[envKey];
    process.env[envKey] = "enabled";

    const stages = [
      createStage({
        id: "conditional",
        if: `env.${envKey} === "enabled"`,
        options: { shouldFail: false },
      }),
      createStage({
        id: "conditional:skip",
        if: "env.NON_EXISTENT_FLAG === 'true'",
        options: { shouldFail: false },
      }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
    });

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe("passed");
    expect(result.stages[1].status).toBe("skipped");

    if (originalValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalValue;
    }
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
      reporterSpecs: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[1].status).toBe("passed");
  });

  it("performs a dry run without executing adapters and lists matched files", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-dry-"));
    const files = [
      path.join(tmpDir, "src", "a.ts"),
      path.join(tmpDir, "src", "nested", "b.ts"),
      path.join(tmpDir, "README.md"),
    ];
    files.forEach((file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "// stub", "utf8");
    });

    const stages = [
      createStage({
        id: "ts-only",
        type: "stub",
        files: ["src/**/*.ts"],
      }),
      createStage({
        id: "all",
        type: "stub",
        files: ["**/*"],
      }),
    ];

    const config: ResolvedConfig = {
      root: tmpDir,
      adapters: [],
      stageCatalog: {},
      ignore: [],
      profile: {
        name: "test",
        pipeline: stages,
        reporters: [],
        hooks: ensureHooks(),
      },
    };

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.stages.map((s) => s.status)).toEqual(["dry-run", "dry-run"]);
    const firstStageFiles = (result.stages[0].details?.files ?? []) as string[];
    expect(firstStageFiles.sort()).toEqual(["src/a.ts", "src/nested/b.ts"]);
    expect(observedFiles.size).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
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
      reporterSpecs: [],
    });

    expect(result.success).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("skipped");
  });

  it("limits parallel group concurrency when QUALITY_PARALLEL_LIMIT is set", async () => {
    const previousLimit = process.env.QUALITY_PARALLEL_LIMIT;
    process.env.QUALITY_PARALLEL_LIMIT = "1";

    let inFlight = 0;
    let peakInFlight = 0;
    const trackingAdapter: StageAdapter<StubOptions> = {
      type: "tracking",
      label: "Tracking adapter",
      async run(context) {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) =>
          setTimeout(resolve, context.options.delayMs),
        );
        inFlight -= 1;
        return { status: "passed" };
      },
    };

    registerAdapter(trackingAdapter);

    const stages = [
      createStage({
        id: "parallel:one",
        type: "tracking",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
      createStage({
        id: "parallel:two",
        type: "tracking",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
      createStage({
        id: "parallel:three",
        type: "tracking",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
    ];
    const config = createConfig(stages);

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
    });

    expect(result.success).toBe(true);
    expect(peakInFlight).toBe(1);

    if (previousLimit === undefined) {
      delete process.env.QUALITY_PARALLEL_LIMIT;
    } else {
      process.env.QUALITY_PARALLEL_LIMIT = previousLimit;
    }
  });

  it("honors profile-level parallelLimit when configured", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const trackingAdapter: StageAdapter<StubOptions> = {
      type: "tracking",
      label: "Tracking adapter",
      async run(context) {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) =>
          setTimeout(resolve, context.options.delayMs),
        );
        inFlight -= 1;
        return { status: "passed" };
      },
    };

    registerAdapter(trackingAdapter);

    const stages = [
      createStage({
        id: "parallel:one",
        type: "tracking",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
      createStage({
        id: "parallel:two",
        type: "tracking",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
    ];
    const config = createConfig(stages, undefined, [], { parallelLimit: 1 });

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
    });

    expect(result.success).toBe(true);
    expect(peakInFlight).toBe(1);
  });

  it("prefers profile parallelLimit over QUALITY_PARALLEL_LIMIT", async () => {
    const previousLimit = process.env.QUALITY_PARALLEL_LIMIT;
    process.env.QUALITY_PARALLEL_LIMIT = "3";

    let inFlight = 0;
    let peakInFlight = 0;
    const trackingAdapter: StageAdapter<StubOptions> = {
      type: "tracking-prefer-profile",
      label: "Tracking adapter",
      async run(context) {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) =>
          setTimeout(resolve, context.options.delayMs),
        );
        inFlight -= 1;
        return { status: "passed" };
      },
    };

    registerAdapter(trackingAdapter);

    const stages = [
      createStage({
        id: "parallel:one",
        type: "tracking-prefer-profile",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
      createStage({
        id: "parallel:two",
        type: "tracking-prefer-profile",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
      createStage({
        id: "parallel:three",
        type: "tracking-prefer-profile",
        group: { id: "limited", parallel: true, failFast: true },
        options: { delayMs: 30 },
      }),
    ];
    const config = createConfig(stages, undefined, [], { parallelLimit: 1 });

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
    });

    expect(result.success).toBe(true);
    expect(peakInFlight).toBe(1);

    if (previousLimit === undefined) {
      delete process.env.QUALITY_PARALLEL_LIMIT;
    } else {
      process.env.QUALITY_PARALLEL_LIMIT = previousLimit;
    }
  });

  it("warns and ignores invalid parallelLimit inputs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previousLimit = process.env.QUALITY_PARALLEL_LIMIT;
    process.env.QUALITY_PARALLEL_LIMIT = "0";

    const stages = [createStage({ id: "single" })];
    const config = createConfig(stages, undefined, [], { parallelLimit: 0 });

    const result = await runPipeline({
      mode: "check",
      files: [],
      config,
      reporterSpecs: [],
    });

    expect(result.success).toBe(true);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes("profile"),
      ),
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(([message]) => String(message).includes("env")),
    ).toBe(true);

    warnSpy.mockRestore();
    if (previousLimit === undefined) {
      delete process.env.QUALITY_PARALLEL_LIMIT;
    } else {
      process.env.QUALITY_PARALLEL_LIMIT = previousLimit;
    }
  });

  it("reuses glob results across stages with identical patterns", async () => {
    const originalCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "quality-glob-cache-"),
    );
    try {
      process.chdir(tmpDir);
      fs.writeFileSync(path.join(tmpDir, "one.ts"), "// one");
      fs.writeFileSync(path.join(tmpDir, "two.ts"), "// two");

      const stages = [
        createStage({ id: "first", files: ["**/*.ts"] }),
        createStage({ id: "second", files: ["**/*.ts"] }),
      ];
      const config = createConfig(stages);

      const result = await runPipeline({
        mode: "check",
        files: [],
        config,
        reporterSpecs: [],
      });

      expect(result.success).toBe(true);
      expect(observedFiles.get("first")).toEqual(["one.ts", "two.ts"]);
      expect(observedFiles.get("second")).toEqual(["one.ts", "two.ts"]);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
      reporterSpecs: [],
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
