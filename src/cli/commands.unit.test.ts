import { Cli } from "clipanion";
import { Writable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QualityRunCommand } from "./commands";

const runPipeline = vi.fn();
const loadQualityConfig = vi.fn();
const collectFilesForMode = vi.fn();
const createConsoleProgressReporter = vi.fn();
const ensureReporterSpecs = vi.fn();
const getAdapter = vi.fn();

vi.mock("../index", () => ({
  analyzeTelemetryFile: vi.fn(),
  collectFilesForMode: (...args: unknown[]) => collectFilesForMode(...args),
  createConsoleProgressReporter: (...args: unknown[]) =>
    createConsoleProgressReporter(...args),
  ensureReporterSpecs: (...args: unknown[]) => ensureReporterSpecs(...args),
  getAdapter: (...args: unknown[]) => getAdapter(...args),
  isTelemetryEnabled: () => false,
  listAdapters: vi.fn(),
  loadAdapterModule: vi.fn(),
  loadQualityConfig: (...args: unknown[]) => loadQualityConfig(...args),
  registerBuiltInAdapters: vi.fn(),
  resetAdapters: vi.fn(),
  runPipeline: (...args: unknown[]) => runPipeline(...args),
}));

const capture = () => {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { sink, read: () => chunks.join("") };
};

const buildCli = () => {
  const cli = new Cli({
    binaryLabel: "quality-test",
    binaryName: "quality",
    binaryVersion: "0.0.0-test",
  });
  cli.register(QualityRunCommand);
  return cli;
};

const defaultStage = {
  id: "lint:imports",
  type: "imports",
  options: {},
  reporters: [],
};

const defaultConfig = {
  root: "/repo",
  profile: {
    name: "local",
    pipeline: [defaultStage],
    reporters: ["summary"],
    hooks: {
      onStart: [],
      onComplete: [],
      onSuccess: [],
      onStageFail: {},
    },
    filesMode: "workspace" as const,
    parallelLimit: undefined,
    autoFix: undefined as boolean | undefined,
  },
  stageCatalog: {},
  adapters: [],
  ignore: [],
};

describe("quality check auto-fix preference", () => {
  beforeEach(() => {
    runPipeline.mockResolvedValue({ success: true });
    ensureReporterSpecs.mockImplementation((reporters: unknown) => reporters);
    collectFilesForMode.mockResolvedValue([]);
    createConsoleProgressReporter.mockReturnValue({
      stageStarted: vi.fn(),
      stageCompleted: vi.fn(),
      withPhase: vi.fn(() => ({
        stageStarted: vi.fn(),
        stageCompleted: vi.fn(),
      })),
      finish: vi.fn(),
    });
    getAdapter.mockReturnValue({ supportsModes: ["fix"] });
    loadQualityConfig.mockResolvedValue({ ...defaultConfig });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs the check pipeline when no subcommand is provided", async () => {
    const cli = buildCli();
    const out = capture();

    await cli.run([], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("treats the fix alias as auto-fix + verify", async () => {
    const cli = buildCli();
    const out = capture();

    await cli.run(["fix"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "fix" }),
    );
    expect(runPipeline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("runs fixable stages automatically when the profile opts in", async () => {
    loadQualityConfig.mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: true },
    });
    const cli = buildCli();
    const out = capture();

    await cli.run(["check"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "fix" }),
    );
    expect(runPipeline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("allows opting out of profile defaults via --no-auto-fix", async () => {
    loadQualityConfig.mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: true },
    });
    const cli = buildCli();
    const out = capture();

    await cli.run(["check", "--no-auto-fix"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("honors the -a alias to enable auto-fix for the run", async () => {
    const cli = buildCli();
    const out = capture();

    await cli.run(["check", "-a"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "fix" }),
    );
    expect(runPipeline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("lets the CLI override a profile auto-fix opt-out", async () => {
    loadQualityConfig.mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: false },
    });
    const cli = buildCli();
    const out = capture();

    await cli.run(["check", "--auto-fix"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "fix" }),
    );
    expect(runPipeline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("defaults to no auto-fix when neither the CLI nor profile enable it", async () => {
    loadQualityConfig.mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: undefined },
    });
    const cli = buildCli();
    const out = capture();

    await cli.run(["check"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("suppresses auto-fix during dry runs even when requested", async () => {
    const cli = buildCli();
    const out = capture();

    await cli.run(["check", "--auto-fix", "--dry-run"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "check" }),
    );
  });

  it("informs the user when auto-fix is requested but no stages support it", async () => {
    getAdapter.mockReturnValue({ supportsModes: ["check"] });
    const cli = buildCli();
    const out = capture();

    await cli.run(["check", "--auto-fix"], {
      stdin: process.stdin,
      stdout: out.sink,
      stderr: out.sink,
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(out.read()).toContain(
      "Auto-fix requested but no stages in the pipeline support fixing. Proceeding with check-only.",
    );
  });
});
