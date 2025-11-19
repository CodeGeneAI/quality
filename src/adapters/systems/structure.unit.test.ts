import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
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
    ignore: [],
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

  it("requires files per matched directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-structure-per-match-"));
    try {
      await mkdir(join(root, "packages/pkg-a"), { recursive: true });
      await mkdir(join(root, "packages/pkg-b"), { recursive: true });
      await writeFile(join(root, "packages/pkg-a/package.json"), "{}");
      await writeFile(join(root, "packages/pkg-b/package.json"), "{}");
      await writeFile(join(root, "packages/pkg-a/README.md"), "# pkg-a\n");

      const result = await runAdapter(root, {
        rules: [
          {
            type: "require",
            glob: "README.md",
            perMatchGlob: "packages/**/package.json",
            perMatchKind: "file",
            message: "Missing README.md",
          },
        ],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("pkg-b");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when every matched directory satisfies the requirement", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "quality-structure-per-match-pass-"),
    );
    try {
      await mkdir(join(root, "packages/pkg-a"), { recursive: true });
      await mkdir(join(root, "packages/pkg-b"), { recursive: true });
      await writeFile(join(root, "packages/pkg-a/package.json"), "{}");
      await writeFile(join(root, "packages/pkg-b/package.json"), "{}");
      await writeFile(join(root, "packages/pkg-a/README.md"), "# pkg-a\n");
      await writeFile(join(root, "packages/pkg-b/README.md"), "# pkg-b\n");

      const result = await runAdapter(root, {
        rules: [
          {
            type: "require",
            glob: "README.md",
            perMatchGlob: "packages/**/package.json",
            perMatchKind: "file",
          },
        ],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
