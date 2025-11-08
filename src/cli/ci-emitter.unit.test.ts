import { describe, expect, it } from "vitest";
import type { ResolvedCiTarget } from "../config/types";
import { emitCiTarget } from "./ci-emitter";

const baseTarget = {
  name: "github:pr",
  profile: "ci",
  stages: undefined,
  filesMode: "workspace" as const,
  timeoutMs: undefined,
  reporters: undefined,
  hooks: undefined,
  env: { CI: "1" },
  matrix: { node: ["20", "22"], os: ["ubuntu-latest"] },
  artifacts: undefined,
  autoFix: {
    enabled: false,
    amendCommit: false,
    safety: "force" as const,
    rerunAfterFix: true,
    preserveCommitMetadata: true,
  },
} satisfies ResolvedCiTarget;

describe("emitCiTarget", () => {
  it("produces GitHub workflow snippet", () => {
    const output = emitCiTarget({
      targetName: "github:pr",
      target: baseTarget,
      format: "github",
    });
    expect(output).toContain("jobs:");
    expect(output).toContain("quality-github-pr");
    expect(output).toContain("matrix:");
  });

  it("produces GitLab job snippet", () => {
    const output = emitCiTarget({
      targetName: "github:pr",
      target: baseTarget,
      format: "gitlab",
    });
    expect(output).toContain("stage: test");
    expect(output).toContain("script:");
  });

  it("produces generic job snippet", () => {
    const output = emitCiTarget({
      targetName: "github:pr",
      target: baseTarget,
      format: "generic",
    });
    expect(output).toContain("job:");
    expect(output).toContain("steps:");
  });
});
