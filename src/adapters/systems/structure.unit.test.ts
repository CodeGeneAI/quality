import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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

const runAdapter = async (
  root: string,
  options: StructureAdapterOptions,
  mode: "check" | "fix" = "check",
) =>
  structureAdapter.run({
    root,
    pipelineMode: mode,
    mode,
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

  it("creates missing files for requireWithContent in fix mode", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "quality-structure-require-content-"),
    );
    try {
      const resultCheck = await runAdapter(root, {
        rules: [
          {
            type: "requireWithContent",
            paths: "CLAUDE.md",
            content: "@./AGENTS.md\n",
          },
        ],
      });
      expect(resultCheck.status).toBe("failed");

      const resultFix = await runAdapter(
        root,
        {
          rules: [
            {
              type: "requireWithContent",
              paths: "CLAUDE.md",
              content: "@./AGENTS.md\n",
            },
          ],
        },
        "fix",
      );
      expect(resultFix.status).toBe("passed");

      const resultCheckAfter = await runAdapter(root, {
        rules: [
          {
            type: "requireWithContent",
            paths: "CLAUDE.md",
            content: "@./AGENTS.md\n",
          },
        ],
      });
      expect(resultCheckAfter.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rewrites content when overwrite is true", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "quality-structure-require-overwrite-"),
    );
    try {
      await writeFile(join(root, "CLAUDE.md"), "old\n");

      const resultCheck = await runAdapter(root, {
        rules: [
          {
            type: "requireWithContent",
            paths: "CLAUDE.md",
            content: "@./AGENTS.md\n",
            overwrite: true,
          },
        ],
      });
      expect(resultCheck.status).toBe("failed");

      const resultFix = await runAdapter(
        root,
        {
          rules: [
            {
              type: "requireWithContent",
              paths: "CLAUDE.md",
              content: "@./AGENTS.md\n",
              overwrite: true,
            },
          ],
        },
        "fix",
      );
      expect(resultFix.status).toBe("passed");

      const updated = await readFile(join(root, "CLAUDE.md"), "utf8");
      expect(updated).toBe("@./AGENTS.md\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
