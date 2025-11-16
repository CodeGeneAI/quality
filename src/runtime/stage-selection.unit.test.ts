import { describe, expect, it } from "vitest";
import type { ResolvedStage } from "../config/types";
import { selectStagesForContext } from "./stage-selection";

describe("selectStagesForContext", () => {
  const baseStage = (
    overrides: Partial<ResolvedStage> = {},
  ): ResolvedStage => ({
    id: overrides.id ?? "stage",
    type: overrides.type ?? "stub",
    options: overrides.options ?? {},
    continueOnError: overrides.continueOnError ?? false,
    files: overrides.files ?? [],
    group: overrides.group,
    label: overrides.label,
    description: overrides.description,
    preset: overrides.preset,
    mode: overrides.mode,
    reporters: overrides.reporters,
    if: overrides.if,
  });

  it("returns all stages when no filters applied", () => {
    const stages = [baseStage({ id: "a" }), baseStage({ id: "b" })];
    const result = selectStagesForContext({
      stages,
      context: { kind: "hook", name: "pre-commit" },
    });
    expect(result.map((stage) => stage.id)).toEqual(["a", "b"]);
  });

  it("filters by requested stage ids", () => {
    const stages = [baseStage({ id: "a" }), baseStage({ id: "b" })];
    const result = selectStagesForContext({
      stages,
      requestedStageIds: ["b"],
      context: { kind: "hook", name: "pre-commit" },
    });
    expect(result.map((stage) => stage.id)).toEqual(["b"]);
  });

  it("filters by changed files when requested", () => {
    const stages = [
      baseStage({
        id: "grouped",
        group: { id: "lint", parallel: true, failFast: true },
        files: ["src/**/*.ts"],
      }),
      baseStage({
        id: "ungrouped",
      }),
    ];

    const result = selectStagesForContext({
      stages,
      context: {
        kind: "hook",
        name: "pre-commit",
        changedFiles: ["README.md"],
        onlyChangedStageGroups: true,
      },
    });

    expect(result.map((stage) => stage.id)).toEqual(["ungrouped"]);
  });
});
