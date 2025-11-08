import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ResolvedStage } from "../../config/types";
import type { StructureAdapterOptions } from "./structure";
import { structureAdapter } from "./structure";

const createStage = (
  options: StructureAdapterOptions,
): ResolvedStage<StructureAdapterOptions> => ({
  id: "structure",
  type: "structure",
  options,
  continueOnError: false,
  files: [],
});

const runAdapter = async (root: string, options: StructureAdapterOptions) =>
  structureAdapter.run({
    root,
    pipelineMode: "check",
    mode: "check",
    stage: createStage(options),
    files: [],
    options,
    abortSignal: new AbortController().signal,
  });

describe("structureAdapter", () => {
  it("passes when required files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-structure-pass-"));
    try {
      await writeFile(join(root, "README.md"), "# fixture\n");

      const result = await runAdapter(root, {
        rules: [
          { type: "require", glob: "README.md" },
          { type: "disallow", glob: "forbidden.txt" },
        ],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when disallowed files are present", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-structure-fail-"));
    try {
      await writeFile(join(root, "forbidden.txt"), "nope");

      const result = await runAdapter(root, {
        rules: [{ type: "disallow", glob: "*.txt" }],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("*.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
