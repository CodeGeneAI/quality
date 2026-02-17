import { mkdir, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "bun:test";
import { packageScriptsAdapter } from "./package-scripts";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-package-scripts-"));

describe("package-scripts adapter", () => {
  let root: string;

  afterEach(async () => {
    root && ((await writeFile) ? null : null);
  });

  it("passes when required scripts are present", async () => {
    root = await createTempWorkspace();
    const pkgPath = join(root, "pkg", "package.json");
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(
      pkgPath,
      JSON.stringify(
        { name: "pkg", version: "0.0.0", scripts: { build: "x" } },
        null,
        2,
      ),
    );

    const result = await packageScriptsAdapter.run({
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "scripts",
        type: "package-scripts",
        options: {
          packages: ["pkg/package.json"],
          requiredScripts: [{ name: "build" }],
        },
      } as any,
      root,
      options: {
        packages: ["pkg/package.json"],
        requiredScripts: [{ name: "build" }],
      },
      files: [],
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });

  it("fails with helpful message when scripts missing", async () => {
    root = await createTempWorkspace();
    const pkgPath = join(root, "pkg", "package.json");
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(
      pkgPath,
      JSON.stringify(
        { name: "pkg", version: "0.0.0", scripts: { test: "x" } },
        null,
        2,
      ),
    );

    const result = await packageScriptsAdapter.run({
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "scripts",
        type: "package-scripts",
        options: {
          packages: ["pkg/package.json"],
          requiredScripts: [{ name: "build", message: "add build script" }],
        },
      } as any,
      root,
      options: {
        packages: ["pkg/package.json"],
        requiredScripts: [{ name: "build", message: "add build script" }],
      },
      files: [],
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
    expect(
      result.messages?.find((m) => m.includes("missing script 'build'")),
    ).toBeTruthy();
  });

  it("ignores package.json files under node_modules by default", async () => {
    root = await createTempWorkspace();

    // valid workspace package with required script
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(
      join(root, "pkg", "package.json"),
      JSON.stringify(
        { name: "pkg", version: "0.0.0", scripts: { build: "x" } },
        null,
        2,
      ),
    );

    // node_modules package missing the required script should be ignored
    await mkdir(join(root, "node_modules", "oops"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "oops", "package.json"),
      JSON.stringify({ name: "oops", version: "0.0.0", scripts: {} }, null, 2),
    );

    const result = await packageScriptsAdapter.run({
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "scripts",
        type: "package-scripts",
        options: {
          packages: ["**/package.json"],
          requiredScripts: [{ name: "build" }],
        },
      } as any,
      root,
      options: {
        packages: ["**/package.json"],
        requiredScripts: [{ name: "build" }],
      },
      files: [],
      ignore: [],
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });
});
