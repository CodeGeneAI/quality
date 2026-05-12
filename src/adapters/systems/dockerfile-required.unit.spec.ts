import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DockerfileRequiredAdapterOptions } from "./dockerfile-required";
import {
  createDockerfileRequiredAdapter,
  dockerfileRequiredAdapter,
  ExplicitPathTargetSource,
  PackageGlobTargetSource,
} from "./dockerfile-required";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-dockerfile-required-"));

const runAdapter = async (
  root: string,
  options: DockerfileRequiredAdapterOptions,
) =>
  dockerfileRequiredAdapter.run({
    mode: "check",
    pipelineMode: "check",
    stage: {
      id: "dockerfile-required",
      type: "dockerfile-required",
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

const writeFileAt = async (
  root: string,
  relativePath: string,
  content: string,
): Promise<void> => {
  const filePath = join(root, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
};

const writePackage = async (
  root: string,
  packageDir: string,
  name: string,
): Promise<void> => {
  await writeFileAt(
    root,
    `${packageDir}/package.json`,
    JSON.stringify({ name, version: "0.0.0", private: true }),
  );
};

const writeDockerfile = async (
  root: string,
  packageDir: string,
): Promise<void> => {
  await writeFileAt(
    root,
    `${packageDir}/Dockerfile`,
    "FROM oven/bun:1.3.13-alpine\n",
  );
};

describe("dockerfile-required adapter", () => {
  it("passes when every apps/* and services/* directory ships a Dockerfile", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");
      await writeDockerfile(root, "apps/web");
      await writePackage(root, "services/auth", "@example/auth");
      await writeDockerfile(root, "services/auth");

      const result = await runAdapter(root, {});
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when an apps/* directory is missing a Dockerfile", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");

      const result = await runAdapter(root, {});
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("apps/web");
      expect(result.messages![0]).toContain("missing Dockerfile");
      expect(result.messages![0]).toContain("package-glob");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a services/* directory is missing a Dockerfile", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "services/auth", "@example/auth");

      const result = await runAdapter(root, {});
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain("services/auth");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when an extraRequiredPaths target has its Dockerfile", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "packages/ui", "@example/ui");
      await writeDockerfile(root, "packages/ui");

      const result = await runAdapter(root, {
        packageGlobs: [],
        extraRequiredPaths: ["packages/ui"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when an extraRequiredPaths target is missing its Dockerfile", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "packages/ui", "@example/ui");

      const result = await runAdapter(root, {
        packageGlobs: [],
        extraRequiredPaths: ["packages/ui"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain("packages/ui");
      expect(result.messages![0]).toContain("explicit-path");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports only the missing entries when targets are mixed", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");
      await writeDockerfile(root, "apps/web");
      await writePackage(root, "apps/admin", "@example/admin");
      await writePackage(root, "services/auth", "@example/auth");
      await writeDockerfile(root, "services/auth");

      const result = await runAdapter(root, {});
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("apps/admin");
      expect(result.messages![0]).not.toContain("apps/web");
      expect(result.messages![0]).not.toContain("services/auth");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores directories without a package.json", async () => {
    const root = await createTempWorkspace();
    try {
      // apps/notes is a stray directory with no package.json — must not be
      // flagged as a missing-Dockerfile target.
      await mkdir(join(root, "apps/notes"), { recursive: true });
      await writeFileAt(root, "apps/notes/README.md", "# notes\n");

      await writePackage(root, "apps/web", "@example/web");
      await writeDockerfile(root, "apps/web");

      const result = await runAdapter(root, {});
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects a custom filename", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");
      await writeFileAt(root, "apps/web/Containerfile", "FROM alpine\n");

      const result = await runAdapter(root, {
        packageGlobs: ["apps/*"],
        filename: "Containerfile",
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects custom packageGlobs (override removes defaults)", async () => {
    const root = await createTempWorkspace();
    try {
      // apps/* is normally required; with packageGlobs scoped to services/*
      // only, an undockerized app must not be flagged.
      await writePackage(root, "apps/web", "@example/web");
      await writePackage(root, "services/auth", "@example/auth");

      const result = await runAdapter(root, {
        packageGlobs: ["services/*"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("services/auth");
      expect(result.messages![0]).not.toContain("apps/web");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when no targets exist (empty workspace)", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {});
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats overlapping package-glob and extraRequiredPaths entries once", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");

      const result = await runAdapter(root, {
        packageGlobs: ["apps/*"],
        extraRequiredPaths: ["apps/web"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      // The first source (package-glob) wins for the deduplicated entry.
      expect(result.messages![0]).toContain("package-glob");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes the missing list under details.missing for structured reporters", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");
      await writePackage(root, "services/auth", "@example/auth");

      const result = await runAdapter(root, {});
      expect(result.status).toBe("failed");
      const missing = result.details?.missing as
        | Array<{ path: string; sourceId: string }>
        | undefined;
      expect(missing).toBeDefined();
      expect(missing).toHaveLength(2);
      expect(missing!.map((entry) => entry.path).sort()).toEqual([
        "apps/web",
        "services/auth",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes extraRequiredPaths so spellings like './foo/' and 'foo' dedupe", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "packages/ui", "@example/ui");

      const result = await runAdapter(root, {
        packageGlobs: [],
        extraRequiredPaths: ["./packages/ui/", "packages/ui", "packages//ui"],
      });
      expect(result.status).toBe("failed");
      // All three spellings collapse to a single "packages/ui" entry.
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("packages/ui");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the Dockerfile path is a directory, not a regular file", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");
      // Create a *directory* named "Dockerfile" — a real Docker build would
      // reject this, so the adapter must too.
      await mkdir(join(root, "apps/web/Dockerfile"), { recursive: true });

      const result = await runAdapter(root, {});
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain("apps/web");
      expect(result.messages![0]).toContain("missing Dockerfile");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("flags extraRequiredPaths that escape the workspace root", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {
        packageGlobs: [],
        // Every input here resolves above the workspace root after
        // normalization. The counter-based normalizer must preserve the
        // leading `..` segments so the escape guard can flag them.
        extraRequiredPaths: [
          "../escape",
          "a/../../escape",
          "../../secret",
          "../..",
        ],
      });
      expect(result.status).toBe("failed");
      const invalid = result.details?.invalid as
        | Array<{ raw: string; sourceId: string }>
        | undefined;
      expect(invalid).toBeDefined();
      expect(invalid!.map((entry) => entry.raw).sort()).toEqual([
        "../..",
        "../../secret",
        "../escape",
        "a/../../escape",
      ]);
      // Invalid messages mention "invalid required path" and never silently
      // probe outside the workspace root.
      expect(
        result.messages!.every((message) =>
          message.includes("invalid required path"),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes backslash-separated extraRequiredPaths to forward slashes", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {
        packageGlobs: [],
        extraRequiredPaths: ["packages\\ui"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain("packages/ui");
      expect(result.messages![0]).not.toContain("\\");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports composing the adapter with a custom IDockerfileTargetSource", async () => {
    const root = await createTempWorkspace();
    try {
      await writePackage(root, "apps/web", "@example/web");
      await writeDockerfile(root, "apps/web");
      await mkdir(join(root, "custom/probe"), { recursive: true });

      const customAdapter = createDockerfileRequiredAdapter([
        new PackageGlobTargetSource(),
        new ExplicitPathTargetSource(),
        {
          id: "custom-probe",
          async collect() {
            return ["custom/probe"];
          },
        },
      ]);

      const result = await customAdapter.run({
        mode: "check",
        pipelineMode: "check",
        stage: {
          id: "dockerfile-required",
          type: "dockerfile-required",
          options: {},
          continueOnError: false,
          files: [],
        },
        root,
        options: {},
        files: [],
        ignore: [],
        abortSignal: new AbortController().signal,
      });

      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("custom/probe");
      expect(result.messages![0]).toContain("custom-probe");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
