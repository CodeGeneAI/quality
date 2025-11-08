import { beforeEach, describe, expect, it } from "vitest";
import { registerAdapter, resetAdapters } from "../adapters/registry";
import type { StageAdapter } from "../adapters/types";
import type { ResolvedStage } from "../config/types";
import { collectFixableStages } from "./commands";

describe("collectFixableStages", () => {
  beforeEach(() => {
    resetAdapters();
  });

  const makeStage = (type: string, id: string): ResolvedStage => ({
    id,
    type,
    files: [],
    continueOnError: false,
    options: {},
  });

  it("returns only adapters that support fix mode", () => {
    const fixableAdapter: StageAdapter = {
      type: "format",
      label: "Format",
      supportsModes: ["check", "fix"],
      supportsSandbox: false,
      supportsPartialFiles: true,
      async run() {
        return { status: "passed" };
      },
    };

    const checkOnlyAdapter: StageAdapter = {
      type: "lint",
      label: "Lint",
      supportsModes: ["check"],
      supportsSandbox: false,
      supportsPartialFiles: true,
      async run() {
        return { status: "passed" };
      },
    };

    const commandAdapter: StageAdapter = {
      type: "command",
      label: "Command",
      supportsModes: ["check", "fix"],
      supportsSandbox: false,
      supportsPartialFiles: false,
      async run() {
        return { status: "passed" };
      },
    };

    registerAdapter(fixableAdapter);
    registerAdapter(checkOnlyAdapter);
    registerAdapter(commandAdapter);

    const stages: ResolvedStage[] = [
      makeStage("format", "format"),
      makeStage("lint", "lint"),
      makeStage("command", "command"),
    ];

    const result = collectFixableStages(stages);
    expect(result.map((stage) => stage.id)).toEqual(["format"]);
  });
});
