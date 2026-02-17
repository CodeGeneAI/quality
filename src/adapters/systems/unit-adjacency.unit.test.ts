import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "bun:test";

import type { ResolvedStage } from "../../config/types";
import {
  type UnitAdjacencyOptions,
  unitAdjacencyAdapter,
} from "./unit-adjacency";

const createStage = (
  options: UnitAdjacencyOptions = {},
): ResolvedStage<UnitAdjacencyOptions> => ({
  id: "unit-adjacency",
  type: "unit-adjacency",
  options,
  files: [],
  continueOnError: false,
});

const runAdapter = async (
  root: string,
  files: readonly string[],
  options: UnitAdjacencyOptions = {},
  mode: "check" | "report" = "check",
) =>
  unitAdjacencyAdapter.run({
    root,
    pipelineMode: mode === "report" ? "check" : mode,
    mode,
    stage: createStage(options),
    files,
    options,
    ignore: [],
    abortSignal: new AbortController().signal,
  });

describe("unitAdjacencyAdapter", () => {
  it("passes when a unit test sits next to its subject", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-unit-adjacent-"));
    try {
      await writeFile(join(root, "feature.ts"), "export {}\n");
      await writeFile(join(root, "feature.unit.spec.ts"), "test\n");

      const result = await runAdapter(root, ["feature.unit.spec.ts"]);
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when placed inside a forbidden directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-unit-forbidden-"));
    try {
      await mkdir(join(root, "__tests__"), { recursive: true });
      await writeFile(
        join(root, "__tests__", "feature.unit.spec.ts"),
        "test\n",
      );

      const result = await runAdapter(root, ["__tests__/feature.unit.spec.ts"]);
      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("forbidden test directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when no adjacent subject exists and requireSubject is true", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-unit-missing-subject-"));
    try {
      await writeFile(join(root, "feature.unit.spec.ts"), "test\n");

      const result = await runAdapter(root, ["feature.unit.spec.ts"], {
        requireSubject: true,
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("no adjacent subject file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when subject is missing but requireSubject is false", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "quality-unit-optional-subject-"),
    );
    try {
      await writeFile(join(root, "feature.unit.spec.ts"), "test\n");

      const result = await runAdapter(root, ["feature.unit.spec.ts"], {
        requireSubject: false,
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows subject-less tests inside src/__tests__ when dir is clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-unit-testsdir-"));
    try {
      const testDir = join(root, "src/__tests__");
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, "isolated.unit.spec.ts"), "test\n");

      const result = await runAdapter(
        root,
        ["src/__tests__/isolated.unit.spec.ts"],
        {
          requireSubject: true,
        },
      );

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails subject-less tests outside src/__tests__", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "quality-unit-testsdir-outside-"),
    );
    try {
      await mkdir(join(root, "tests"), { recursive: true });
      await writeFile(join(root, "tests/isolated.unit.spec.ts"), "test\n");

      const result = await runAdapter(root, ["tests/isolated.unit.spec.ts"], {
        requireSubject: true,
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("no adjacent subject file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when src/__tests__ contains non-unit-test files", async () => {
    const root = await mkdtemp(join(tmpdir(), "quality-unit-testsdir-mixed-"));
    try {
      const testDir = join(root, "src/__tests__");
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, "isolated.unit.spec.ts"), "test\n");
      await writeFile(join(testDir, "notes.md"), "doc\n");

      const result = await runAdapter(
        root,
        ["src/__tests__/isolated.unit.spec.ts"],
        {
          requireSubject: true,
        },
      );

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("non-unit-test files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
