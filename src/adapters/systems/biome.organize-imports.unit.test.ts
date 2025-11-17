import { describe, expect, it, vi } from "vitest";
import type { ResolvedStage } from "../../config/types";
import { biomeAdapter } from "./biome";
import * as processModule from "../../utils/process";

type AdapterArgs = Parameters<typeof biomeAdapter.run>[0];

const stage: ResolvedStage = {
  id: "biome",
  type: "biome",
  files: ["foo.ts"],
  continueOnError: false,
};

describe("biomeAdapter organize-imports", () => {
  it("uses lint --write during fix mode so organizeImports assists are applied", async () => {
    const runCommandSpy = vi
      .spyOn(processModule, "runCommand")
      .mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        terminated: false,
      });

    await biomeAdapter.run({
      root: process.cwd(),
      pipelineMode: "check",
      mode: "fix",
      stage,
      files: stage.files,
      options: stage.options,
      abortSignal: new AbortController().signal,
    } as AdapterArgs);

    expect(runCommandSpy).toHaveBeenCalledTimes(1);
    const call = runCommandSpy.mock.calls[0]?.[0];
    expect(call?.command).toBe("bunx");
    expect(call?.args).toContain("lint");
    expect(call?.args).toContain("--write");
  });
});
