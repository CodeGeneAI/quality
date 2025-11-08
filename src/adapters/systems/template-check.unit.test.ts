import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedStage } from "../../config/types";
import * as fsUtils from "../../utils/fs";
import type { RunCommandOptions, RunCommandResult } from "../../utils/process";
import * as processUtils from "../../utils/process";
import type { TemplateCheckAdapterOptions } from "./template-check";
import { templateCheckAdapter } from "./template-check";

const createStage = (): ResolvedStage<TemplateCheckAdapterOptions> => ({
  id: "template:check",
  type: "template-check",
  continueOnError: false,
  files: [],
  options: {},
});

const successResult: RunCommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  terminated: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("templateCheckAdapter", () => {
  it("runs template-scoped checks when templates change", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue(successResult);
    vi.spyOn(fsUtils, "pathExists").mockResolvedValue(true);

    const result = await templateCheckAdapter.run({
      root: "/repo",
      pipelineMode: "check",
      mode: "check",
      stage: createStage(),
      files: ["packages/forge-templates/templates/web-app/base/index.ts"],
      options: {},
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    const invocation = getRunInvocation(runCommandSpy);
    expect(invocation?.command).toBe("bun");
    expect(invocation?.args).toEqual([
      "x",
      "forge",
      "template",
      "check",
      "--template",
      "web-app",
    ]);
  });

  it("falls back to full run when shared templates change", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue(successResult);
    vi.spyOn(fsUtils, "pathExists").mockResolvedValue(true);

    await templateCheckAdapter.run({
      root: "/repo",
      pipelineMode: "check",
      mode: "check",
      stage: createStage(),
      files: ["packages/forge-templates/templates/catalog/web-app.json"],
      options: {},
      abortSignal: new AbortController().signal,
    });

    const invocation = getRunInvocation(runCommandSpy);
    expect(invocation?.args).toEqual(["x", "forge", "template", "check"]);
  });

  it("skips validation when no template files are provided", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue(successResult);
    vi.spyOn(fsUtils, "pathExists").mockResolvedValue(true);

    const result = await templateCheckAdapter.run({
      root: "/repo",
      pipelineMode: "check",
      mode: "check",
      stage: createStage(),
      files: [],
      options: {},
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("skipped");
    expect(result.messages?.[0]).toContain("skipping");
    expect(runCommandSpy).not.toHaveBeenCalled();
  });

  it("falls back to full run when template config is missing", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue(successResult);
    vi.spyOn(fsUtils, "pathExists").mockResolvedValueOnce(false);

    await templateCheckAdapter.run({
      root: "/repo",
      pipelineMode: "check",
      mode: "check",
      stage: createStage(),
      files: ["packages/forge-templates/templates/unknown/base/file.ts"],
      options: {},
      abortSignal: new AbortController().signal,
    });

    const invocation = getRunInvocation(runCommandSpy);
    expect(invocation?.args).toEqual(["x", "forge", "template", "check"]);
  });
});

const getRunInvocation = (spy: any): RunCommandOptions | undefined => {
  return (spy.mock.calls[0]?.[0] ?? undefined) as RunCommandOptions | undefined;
};
