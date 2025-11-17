import { mkdir, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { packageCatalogAdapter } from "./package-catalog";

const createWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-package-catalog-"));

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

describe("package-catalog adapter", () => {
  it("passes when versions already use catalog", async () => {
    const root = await createWorkspace();
    await writeJson(join(root, "package.json"), {
      catalogs: { tooling: { lodash: "^1.0.0" } },
    });
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeJson(join(root, "pkg", "package.json"), {
      name: "pkg",
      version: "0.0.0",
      dependencies: { lodash: "catalog:tooling" },
    });

    const result = await packageCatalogAdapter.run({
      root,
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "catalog",
        type: "package-catalog",
        options: {
          packages: ["pkg/package.json"],
        },
      } as any,
      files: [],
      options: {
        packages: ["pkg/package.json"],
      },
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });

  it("auto-fixes to catalog version when fix mode and catalog entry exists", async () => {
    const root = await createWorkspace();
    await writeJson(join(root, "package.json"), {
      catalogs: { tooling: { axios: "1.0.0" } },
    });
    await mkdir(join(root, "svc"), { recursive: true });
    const svcPkg = join(root, "svc", "package.json");
    await writeJson(svcPkg, {
      name: "svc",
      version: "0.0.0",
      dependencies: { axios: "1.2.3" },
    });

    const result = await packageCatalogAdapter.run({
      root,
      mode: "fix",
      pipelineMode: "fix",
      stage: {
        id: "catalog",
        type: "package-catalog",
        options: {
          packages: ["svc/package.json"],
        },
      } as any,
      files: [],
      options: {
        packages: ["svc/package.json"],
      },
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
    const rewritten = JSON.parse(await Bun.file(svcPkg).text()) as {
      dependencies: Record<string, string>;
    };
    expect(rewritten.dependencies.axios).toBe("catalog:tooling");
  });

  it("fails with guidance when no catalog entry exists", async () => {
    const root = await createWorkspace();
    await writeJson(join(root, "package.json"), { catalogs: {} });
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeJson(join(root, "pkg", "package.json"), {
      name: "pkg",
      version: "0.0.0",
      dependencies: { react: "19.0.0" },
    });

    const result = await packageCatalogAdapter.run({
      root,
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "catalog",
        type: "package-catalog",
        options: {
          packages: ["pkg/package.json"],
        },
      } as any,
      files: [],
      options: {
        packages: ["pkg/package.json"],
      },
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
    expect(result.messages?.[0]).toContain("non-catalog version");
  });

  it("respects allowlist entries", async () => {
    const root = await createWorkspace();
    await writeJson(join(root, "package.json"), { catalogs: {} });
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeJson(join(root, "pkg", "package.json"), {
      name: "pkg",
      version: "0.0.0",
      dependencies: { "@codesynth-labs/foo": "workspace:*" },
    });

    const result = await packageCatalogAdapter.run({
      root,
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "catalog",
        type: "package-catalog",
        options: {
          packages: ["pkg/package.json"],
          allowlist: ["@codesynth-labs/*"],
        },
      } as any,
      files: [],
      options: {
        packages: ["pkg/package.json"],
        allowlist: ["@codesynth-labs/*"],
      },
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });

  it("ignores package.json files inside node_modules", async () => {
    const root = await createWorkspace();
    await writeJson(join(root, "package.json"), {
      catalogs: { tooling: { axios: "1.0.0" } },
    });
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeJson(join(root, "pkg", "package.json"), {
      name: "pkg",
      version: "0.0.0",
      dependencies: { axios: "catalog:tooling" },
    });
    await mkdir(join(root, "node_modules", "skip"), { recursive: true });
    await writeJson(join(root, "node_modules", "skip", "package.json"), {
      name: "skip",
      version: "0.0.0",
      dependencies: { leftpad: "1.0.0" },
    });

    const result = await packageCatalogAdapter.run({
      root,
      mode: "check",
      pipelineMode: "check",
      stage: {
        id: "catalog",
        type: "package-catalog",
        options: {
          packages: ["**/package.json"],
        },
      } as any,
      files: [],
      options: {
        packages: ["**/package.json"],
      },
      abortSignal: new AbortController().signal,
    });

    expect(result.status).toBe("passed");
  });
});
