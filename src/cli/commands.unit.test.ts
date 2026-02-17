import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from "bun:test";

const mocked = <T>(value: T) =>
  value as T & {
    mock: { calls: unknown[][]; results: unknown[] };
    mockClear: () => unknown;
    mockReset: () => unknown;
    mockRestore: () => unknown;
    mockImplementation: (
      implementation: (...args: unknown[]) => unknown,
    ) => unknown;
    mockImplementationOnce: (
      implementation: (...args: unknown[]) => unknown,
    ) => unknown;
    mockReturnValue: (value: unknown) => unknown;
    mockReturnValueOnce: (value: unknown) => unknown;
    mockResolvedValue: (value: unknown) => unknown;
    mockResolvedValueOnce: (value: unknown) => unknown;
    mockRejectedValue: (value: unknown) => unknown;
    mockRejectedValueOnce: (value: unknown) => unknown;
  };

import { Cli } from "clipanion";
import { Writable } from "stream";

const runPipeline = vi.fn();
const loadQualityConfig = vi.fn();
const collectFilesForMode = vi.fn();
const createConsoleProgressReporter = vi.fn();
const ensureReporterSpecs = vi.fn();
const getAdapter = vi.fn();

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

const buildCli = async () => {
  const { QualityRunCommand } = await import("./commands");
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
    mock.module("../index", () => ({
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

    mocked(runPipeline).mockResolvedValue({ success: true });
    mocked(ensureReporterSpecs).mockImplementation(
      (reporters: unknown) => reporters,
    );
    mocked(collectFilesForMode).mockResolvedValue([]);
    mocked(createConsoleProgressReporter).mockReturnValue({
      stageStarted: vi.fn(),
      stageCompleted: vi.fn(),
      withPhase: vi.fn(() => ({
        stageStarted: vi.fn(),
        stageCompleted: vi.fn(),
      })),
      finish: vi.fn(),
    });
    mocked(getAdapter).mockReturnValue({ supportsModes: ["fix"] });
    mocked(loadQualityConfig).mockResolvedValue({ ...defaultConfig });
  });

  afterEach(() => {
    mock.restore();
    vi.clearAllMocks();
  });

  it("runs the check pipeline when no subcommand is provided", async () => {
    const cli = await buildCli();
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
    const cli = await buildCli();
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
    mocked(loadQualityConfig).mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: true },
    });
    const cli = await buildCli();
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
    mocked(loadQualityConfig).mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: true },
    });
    const cli = await buildCli();
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
    const cli = await buildCli();
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
    mocked(loadQualityConfig).mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: false },
    });
    const cli = await buildCli();
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
    mocked(loadQualityConfig).mockResolvedValue({
      ...defaultConfig,
      profile: { ...defaultConfig.profile, autoFix: undefined },
    });
    const cli = await buildCli();
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
    const cli = await buildCli();
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
    mocked(getAdapter).mockReturnValue({ supportsModes: ["check"] });
    const cli = await buildCli();
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
