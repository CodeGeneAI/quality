import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedStage } from "../../config/types";
import type { RunCommandOptions, RunCommandResult } from "../../utils/process";
import * as processUtils from "../../utils/process";
import type { MetadataVerifyAdapterOptions } from "./metadata-verify";
import { metadataVerifyAdapter } from "./metadata-verify";

const createStage = (): ResolvedStage<MetadataVerifyAdapterOptions> => ({
  id: "metadata:verify",
  type: "metadata-verify",
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

describe("metadataVerifyAdapter", () => {
  it("passes template and file context through environment", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue(successResult);

    await metadataVerifyAdapter.run({
      root: "/repo",
      pipelineMode: "check",
      mode: "check",
      stage: createStage(),
      files: [
        "packages/forge-templates/templates/web-app/metadata/features/auth.json",
        "packages/forge-templates/templates/web-app/metadata/providers/email.json",
      ],
      options: {},
      abortSignal: new AbortController().signal,
    });

    const invocation = getRunInvocation(runCommandSpy);
    expect(invocation?.env?.FORGE_METADATA_TEMPLATES).toBe("web-app");
    expect(invocation?.env?.FORGE_METADATA_FILES).toBe(
      JSON.stringify([
        "templates/web-app/metadata/features/auth.json",
        "templates/web-app/metadata/providers/email.json",
      ]),
    );
  });

  it("falls back to full validation for non-metadata files", async () => {
    const runCommandSpy = vi
      .spyOn(processUtils, "runCommand")
      .mockResolvedValue(successResult);

    await metadataVerifyAdapter.run({
      root: "/repo",
      pipelineMode: "check",
      mode: "check",
      stage: createStage(),
      files: ["packages/forge-templates/templates/web-app/runtime/index.ts"],
      options: {},
      abortSignal: new AbortController().signal,
    });

    const invocation = getRunInvocation(runCommandSpy);
    expect(invocation?.env?.FORGE_METADATA_TEMPLATES).toBeUndefined();
    expect(invocation?.env?.FORGE_METADATA_FILES).toBeUndefined();
  });
});

const getRunInvocation = (spy: any): RunCommandOptions | undefined => {
  return (spy.mock.calls[0]?.[0] ?? undefined) as RunCommandOptions | undefined;
};
