import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ResolvedStage } from "../../config/types";
import type { NoRootBarrelAdapterOptions } from "./no-root-barrel";
import { noRootBarrelAdapter } from "./no-root-barrel";

const createStage = (
  options: NoRootBarrelAdapterOptions,
): ResolvedStage<NoRootBarrelAdapterOptions> => ({
  id: "no-root-barrel",
  type: "no-root-barrel",
  options,
  continueOnError: false,
  files: [],
});

const runAdapter = async (root: string, options: NoRootBarrelAdapterOptions) =>
  noRootBarrelAdapter.run({
    root,
    pipelineMode: "check",
    mode: "check",
    stage: createStage(options),
    files: [],
    options,
    abortSignal: new AbortController().signal,
  });

describe("noRootBarrelAdapter", () => {
  it("flags forbidden index files", async () => {
    const root = await mkdtemp(join(tmpdir(), "no-root-barrel-"));
    const pkgDir = join(root, "packages", "example");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "index.ts"), "export * from './src';\n");

    try {
      const result = await runAdapter(root, {
        packages: ["packages/example"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honours exceptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "no-root-barrel-exception-"));
    const pkgDir = join(root, "packages", "skip-me");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "index.ts"), "export {}\n");

    try {
      const result = await runAdapter(root, {
        packages: ["packages/**/*"],
        exceptions: ["packages/skip-me"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects package.json exports that point at a root barrel", async () => {
    const root = await mkdtemp(join(tmpdir(), "no-root-barrel-exports-"));
    const pkgDir = join(root, "packages", "example");
    const pkgJson = {
      name: "example",
      exports: {
        ".": "./index.js",
      },
    };
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
    );

    try {
      const result = await runAdapter(root, {
        packages: ["packages/example"],
      });
      expect(result.status).toBe("failed");
      expect(
        result.messages?.some((message) =>
          message.includes("package.json exports"),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
