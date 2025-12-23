import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { BarrelExportsAdapterOptions } from "./barrel-exports";
import { barrelExportsAdapter } from "./barrel-exports";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-barrel-exports-"));

const runAdapter = async (
  root: string,
  options: BarrelExportsAdapterOptions,
  mode: "check" | "report" = "check",
) =>
  barrelExportsAdapter.run({
    mode,
    pipelineMode: mode === "report" ? "check" : mode,
    stage: {
      id: "barrel-exports",
      type: "barrel-exports",
      options,
      continueOnError: false,
      files: [],
    },
    root,
    options,
    files: [],
    ignore: [],
    abortSignal: new AbortController().signal,
  });

const createClientPackage = async (
  root: string,
  name: string,
  indexContent?: string,
): Promise<string> => {
  const pkgDir = join(root, "packages", name);
  await mkdir(join(pkgDir, "src"), { recursive: true });
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: `@codegeneai/${name}`,
      peerDependencies: { react: "^18.0.0" },
    }),
  );
  if (indexContent !== undefined) {
    await writeFile(join(pkgDir, "src/index.ts"), indexContent);
  }
  return pkgDir;
};

const createNonClientPackage = async (
  root: string,
  name: string,
  indexContent?: string,
): Promise<string> => {
  const pkgDir = join(root, "packages", name);
  await mkdir(join(pkgDir, "src"), { recursive: true });
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: `@codegeneai/${name}`,
      dependencies: { zod: "^3.0.0" },
    }),
  );
  if (indexContent !== undefined) {
    await writeFile(join(pkgDir, "src/index.ts"), indexContent);
  }
  return pkgDir;
};

describe("barrel-exports adapter", () => {
  // ============================================================================
  // Basic functionality tests
  // ============================================================================

  it("passes when client package has no barrel exports", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(root, "auth-client", "export {};");

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when client package has barrel exports", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "identity-client",
        `export * from "./hooks";
export { useAuth } from "./hooks/useAuth";
export type { AuthContext } from "./types";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("@codegeneai/identity-client");
      expect(result.messages?.[0]).toContain("barrel exports");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when client package has no src/index.ts", async () => {
    const root = await createTempWorkspace();
    try {
      // Create client package without index.ts
      await createClientPackage(root, "realtime-client");

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when non-client package has barrel exports", async () => {
    const root = await createTempWorkspace();
    try {
      // Non-client packages are allowed to have barrel exports
      await createNonClientPackage(
        root,
        "server-utils",
        `export * from "./utils";
export { formatDate } from "./helpers";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Ignore pattern tests
  // ============================================================================

  it("ignores packages matching ignore patterns", async () => {
    const root = await createTempWorkspace();
    try {
      // Create a client package with barrel exports that should be ignored
      await createClientPackage(
        root,
        "di",
        `export * from "./container";
export { createContainer } from "./container";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        ignore: ["@codegeneai/di"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports glob patterns in ignore", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(root, "legacy-auth", `export * from "./auth";`);
      await createClientPackage(
        root,
        "legacy-identity",
        `export * from "./identity";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        ignore: ["@codegeneai/legacy-*"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Edge cases - Empty and multiple packages
  // ============================================================================

  it("passes immediately when packages array is empty", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {
        packages: [],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("processes multiple packages and collects all failures", async () => {
    const root = await createTempWorkspace();
    try {
      // Package 1: client with barrel exports (should fail)
      await createClientPackage(
        root,
        "auth-client",
        `export * from "./hooks";`,
      );

      // Package 2: client with barrel exports (should fail)
      await createClientPackage(
        root,
        "identity-client",
        `export { useIdentity } from "./useIdentity";`,
      );

      // Package 3: client without barrel exports (should pass)
      await createClientPackage(root, "pwa-support", "export {};");

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(2);
      expect(result.messages?.some((m) => m.includes("auth-client"))).toBe(
        true,
      );
      expect(result.messages?.some((m) => m.includes("identity-client"))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Export detection tests
  // ============================================================================

  it("detects export * statements", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        `export * from "./hooks";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects named exports", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        `export { foo, bar } from "./utils";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects default exports", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        "export default function Component() {}",
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects type exports", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        `export type { User, Account } from "./types";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores empty export statements", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        `export {};

// This file intentionally empty to prevent barrel exports`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores exports in comments", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        `export {};

// Old exports removed:
// export * from "./hooks";
/* export { useAuth } from "./auth"; */`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Client detection tests
  // ============================================================================

  it("uses custom client indicators", async () => {
    const root = await createTempWorkspace();
    try {
      const pkgDir = join(root, "packages", "vue-client");
      await mkdir(join(pkgDir, "src"), { recursive: true });
      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@codegeneai/vue-client",
          peerDependencies: { vue: "^3.0.0" },
        }),
      );
      await writeFile(
        join(pkgDir, "src/index.ts"),
        `export * from "./composables";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
        clientPackageIndicators: ["vue"],
      });

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("@codegeneai/vue-client");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles package without peerDependencies", async () => {
    const root = await createTempWorkspace();
    try {
      const pkgDir = join(root, "packages", "utils");
      await mkdir(join(pkgDir, "src"), { recursive: true });
      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@codegeneai/utils",
          // No peerDependencies at all
        }),
      );
      await writeFile(
        join(pkgDir, "src/index.ts"),
        `export * from "./helpers";`,
      );

      const result = await runAdapter(root, {
        packages: ["packages/*/package.json"],
      });

      // Not a client package, so barrel exports are allowed
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Report mode
  // ============================================================================

  it("returns same result in report mode as check mode", async () => {
    const root = await createTempWorkspace();
    try {
      await createClientPackage(
        root,
        "test-client",
        `export * from "./hooks";`,
      );

      const checkResult = await runAdapter(
        root,
        { packages: ["packages/*/package.json"] },
        "check",
      );
      const reportResult = await runAdapter(
        root,
        { packages: ["packages/*/package.json"] },
        "report",
      );

      expect(checkResult.status).toBe(reportResult.status);
      expect(checkResult.messages).toEqual(reportResult.messages);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
