import { describe, expect, it, vi } from "vitest";
import type { ResolvedStage } from "../../config/types";
import * as processModule from "../../utils/process";
import { biomeAdapter } from "./biome";

type AdapterArgs = Parameters<typeof biomeAdapter.run>[0];

const stage: ResolvedStage = {
  id: "biome",
  type: "biome",
  files: ["foo.ts"],
  continueOnError: false,
  options: undefined,
};

describe("biomeAdapter no-files handling", () => {
  it("returns skipped when biome reports no files processed", async () => {
    const runCommandSpy = vi
      .spyOn(processModule, "runCommand")
      .mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "No files were processed in the specified paths.",
        terminated: false,
      });

    const result = await biomeAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "check",
      stage,
      files: stage.files,
      options: stage.options,
      abortSignal: new AbortController().signal,
    } as AdapterArgs);

    expect(result.status).toBe("skipped");
    expect(runCommandSpy).toHaveBeenCalledTimes(1);
  });
});
