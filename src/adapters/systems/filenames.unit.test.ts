import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import fg from "../../utils/bun-glob";
import type { ResolvedStage } from "../../config/types";
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
    syncSpy = vi.spyOn(
      fg,
      "sync",
    ) as unknown as ReturnType<typeof vi.fn<FastGlobSync>>;
    syncSpy.mockReset();
    syncSpy.mockReturnValue([]);
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
