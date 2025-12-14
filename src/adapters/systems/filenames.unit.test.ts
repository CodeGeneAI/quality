import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedStage } from "../../config/types";
import type { FilenameAdapterOptions } from "./filenames";
import { filenameAdapter } from "./filenames";

type FastGlobFn = (
  source: string | readonly string[],
  options?: object,
) => string[];

type FastGlobMock = ReturnType<typeof vi.fn<FastGlobFn>> & {
  sync: ReturnType<typeof vi.fn<FastGlobFn>>;
};

vi.mock("fast-glob", () => {
  const syncMock = vi.fn<FastGlobFn>().mockReturnValue([]);
  const fn = vi.fn<FastGlobFn>().mockReturnValue([]) as unknown as FastGlobMock;
  fn.sync = syncMock as FastGlobMock["sync"];
  return { default: fn };
});

import fg from "fast-glob";

const fgMock = fg as unknown as FastGlobMock;

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
  beforeEach(() => {
    fgMock.mockClear();
    fgMock.sync.mockClear();
    fgMock.mockReturnValue([]);
    fgMock.sync.mockReturnValue([]);
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
    expect(fgMock).not.toHaveBeenCalled();
  });

  it("falls back to globbing when no files are provided", async () => {
    fgMock.sync.mockReturnValueOnce(["tests/example.unit.spec.ts"]);
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
    expect(fgMock.sync).toHaveBeenCalledTimes(1);
  });
});
