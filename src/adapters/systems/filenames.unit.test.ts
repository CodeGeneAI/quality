import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

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

import type { ResolvedStage } from "../../config/types";
import fg from "../../utils/bun-glob";
import type { FilenameAdapterOptions } from "./filenames";
import { filenameAdapter } from "./filenames";

type FastGlobSync = (
  source: string | readonly string[],
  options?: object,
) => string[];

const createStage = (
  options: FilenameAdapterOptions = {},
): ResolvedStage<FilenameAdapterOptions> => ({
  id: "filenames:test",
  type: "filenames",
  options,
  continueOnError: false,
  files: [],
});

describe("filenameAdapter", () => {
  let syncSpy: ReturnType<typeof vi.fn<FastGlobSync>>;

  beforeEach(() => {
    syncSpy = vi.spyOn(fg, "sync") as unknown as ReturnType<
      typeof vi.fn<FastGlobSync>
    >;
    mocked(syncSpy).mockReset();
    mocked(syncSpy).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses provided files without invoking glob", async () => {
    const stage = createStage();

    const result = await filenameAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: ["tests/example.unit.spec.ts"],
      options: stage.options ?? {},
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it("falls back to globbing when no files are provided", async () => {
    syncSpy.mockReturnValueOnce(["tests/example.unit.spec.ts"]);
    const stage = createStage();

    const result = await filenameAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: [],
      options: stage.options ?? {},
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
