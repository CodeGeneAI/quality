import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  mapFilesToPackages,
  resolveWorkspacePackages,
  type WorkspacePackage,
} from "./workspace";

const createFixtureWorkspace = async (): Promise<string> => {
  const dir = join(
    tmpdir(),
    `quality-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(dir, { recursive: true });

  // Root package.json with workspace globs
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@fixture/root",
      private: true,
      workspaces: ["apps/*", "packages/*", "packages/auth/*"],
    }),
  );

  // apps/web — private app
  await mkdir(join(dir, "apps", "web", "src"), { recursive: true });
  await writeFile(
    join(dir, "apps", "web", "package.json"),
    JSON.stringify({ name: "@fixture/web", private: true, version: "1.0.0" }),
  );

  // packages/shared — public package
  await mkdir(join(dir, "packages", "shared", "src"), { recursive: true });
  await writeFile(
    join(dir, "packages", "shared", "package.json"),
    JSON.stringify({ name: "@fixture/shared", version: "1.0.0" }),
  );

  // packages/auth/client — nested workspace
  await mkdir(join(dir, "packages", "auth", "client", "src"), {
    recursive: true,
  });
  await writeFile(
    join(dir, "packages", "auth", "client", "package.json"),
    JSON.stringify({
      name: "@fixture/auth-client",
      private: true,
      version: "0.1.0",
    }),
  );

  // packages/auth — parent that is also a workspace
  await writeFile(
    join(dir, "packages", "auth", "package.json"),
    JSON.stringify({ name: "@fixture/auth", version: "1.0.0" }),
  );

  return dir;
};

describe("resolveWorkspacePackages", () => {
  it("resolves all workspace packages from root package.json globs", async () => {
    const root = await createFixtureWorkspace();
    try {
      const packages = await resolveWorkspacePackages(root);

      const names = packages.map((p) => p.name).sort();
      expect(names).toContain("@fixture/web");
      expect(names).toContain("@fixture/shared");
      expect(names).toContain("@fixture/auth-client");
      expect(names).toContain("@fixture/auth");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("correctly identifies private vs public packages", async () => {
    const root = await createFixtureWorkspace();
    try {
      const packages = await resolveWorkspacePackages(root);

      const web = packages.find((p) => p.name === "@fixture/web");
      expect(web?.isPrivate).toBe(true);

      const shared = packages.find((p) => p.name === "@fixture/shared");
      expect(shared?.isPrivate).toBe(false);

      const authClient = packages.find(
        (p) => p.name === "@fixture/auth-client",
      );
      expect(authClient?.isPrivate).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("includes the relative directory path for each package", async () => {
    const root = await createFixtureWorkspace();
    try {
      const packages = await resolveWorkspacePackages(root);

      const web = packages.find((p) => p.name === "@fixture/web");
      expect(web?.dir).toBe("apps/web");

      const shared = packages.find((p) => p.name === "@fixture/shared");
      expect(shared?.dir).toBe("packages/shared");

      const authClient = packages.find(
        (p) => p.name === "@fixture/auth-client",
      );
      expect(authClient?.dir).toBe("packages/auth/client");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles empty workspaces gracefully", async () => {
    const dir = join(
      tmpdir(),
      `quality-ws-empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "@fixture/empty", workspaces: ["packages/*"] }),
    );
    // No packages/ directory at all
    try {
      const packages = await resolveWorkspacePackages(dir);
      expect(packages).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips directories without a package.json", async () => {
    const dir = join(
      tmpdir(),
      `quality-ws-nopkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "@fixture/root", workspaces: ["packages/*"] }),
    );
    // Create a directory that matches the glob but has no package.json
    await mkdir(join(dir, "packages", "orphan", "src"), { recursive: true });
    await writeFile(join(dir, "packages", "orphan", "src", "index.ts"), "");

    try {
      const packages = await resolveWorkspacePackages(dir);
      expect(packages).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mapFilesToPackages", () => {
  const packages: WorkspacePackage[] = [
    { name: "@fixture/web", dir: "apps/web", isPrivate: true },
    { name: "@fixture/shared", dir: "packages/shared", isPrivate: false },
    { name: "@fixture/auth", dir: "packages/auth", isPrivate: false },
    {
      name: "@fixture/auth-client",
      dir: "packages/auth/client",
      isPrivate: true,
    },
  ];

  it("maps files to their owning package", () => {
    const result = mapFilesToPackages(packages, [
      "apps/web/src/index.ts",
      "packages/shared/src/utils.ts",
    ]);

    expect(result.get("@fixture/web")).toEqual(["apps/web/src/index.ts"]);
    expect(result.get("@fixture/shared")).toEqual([
      "packages/shared/src/utils.ts",
    ]);
  });

  it("maps nested files to the deepest matching package", () => {
    const result = mapFilesToPackages(packages, [
      "packages/auth/client/src/login.ts",
    ]);

    // Should match @fixture/auth-client (deeper), not @fixture/auth
    expect(result.get("@fixture/auth-client")).toEqual([
      "packages/auth/client/src/login.ts",
    ]);
    expect(result.has("@fixture/auth")).toBe(false);
  });

  it("excludes files not in any package (root-level files)", () => {
    const result = mapFilesToPackages(packages, [
      "tsconfig.json",
      ".eslintrc.js",
      "README.md",
    ]);

    expect(result.size).toBe(0);
  });

  it("groups multiple files under the same package", () => {
    const result = mapFilesToPackages(packages, [
      "apps/web/src/index.ts",
      "apps/web/src/app.tsx",
      "apps/web/package.json",
    ]);

    expect(result.get("@fixture/web")).toEqual([
      "apps/web/src/index.ts",
      "apps/web/src/app.tsx",
      "apps/web/package.json",
    ]);
  });

  it("returns empty map for empty file list", () => {
    const result = mapFilesToPackages(packages, []);
    expect(result.size).toBe(0);
  });
});
