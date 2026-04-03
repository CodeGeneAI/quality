import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DotenvSecretsAdapterOptions } from "./dotenv-secrets";
import { dotenvSecretsAdapter } from "./dotenv-secrets";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-dotenv-secrets-"));

const runAdapter = async (root: string, options: DotenvSecretsAdapterOptions) =>
  dotenvSecretsAdapter.run({
    mode: "check",
    pipelineMode: "check",
    stage: {
      id: "dotenv-secrets",
      type: "dotenv-secrets",
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

const writeEnvFile = async (
  root: string,
  relativePath: string,
  content: string,
): Promise<void> => {
  const filePath = join(root, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
};

describe("dotenv-secrets adapter", () => {
  it("passes when all secret values are encrypted", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.production",
        [
          'DOTENV_PUBLIC_KEY_PRODUCTION="abc123"',
          'AUTH_SIGNING_PRIVATE_KEY_PEM="encrypted:BMTuU15zL+base64data=="',
          'AUTH_CLIENT_REGISTRY_ADMIN_TOKEN="encrypted:BIhSkUbase64data=="',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when values are empty placeholders", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.preview",
        ['AUTH_SECRET_KEY=""', 'API_TOKEN=""'].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.preview"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes for allowlisted plaintext keys", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/codegene/.env.production",
        [
          'APP_ENV="production"',
          'NODE_ENV="production"',
          'DOTENV_PUBLIC_KEY_PRODUCTION="0286f44b69d38d"',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
        plaintextAllowlist: ["APP_ENV", "NODE_ENV"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a secret-looking key has plaintext value", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.production",
        [
          'DOTENV_PUBLIC_KEY_PRODUCTION="abc"',
          'AUTH_SIGNING_PRIVATE_KEY_PEM="actual-private-key-content"',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("AUTH_SIGNING_PRIVATE_KEY_PEM");
      expect(result.messages![0]).toContain("not encrypted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects multiple unencrypted secrets in same file", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.staging",
        [
          'API_TOKEN="plaintext-token"',
          'CLIENT_SECRET="plaintext-secret"',
          'SAFE_CONFIG="some-value"',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.staging"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(2);
      expect(result.messages!.some((m) => m.includes("API_TOKEN"))).toBe(true);
      expect(result.messages!.some((m) => m.includes("CLIENT_SECRET"))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scans across multiple env files", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.production",
        'AUTH_SECRET_KEY="encrypted:valid=="',
      );
      await writeEnvFile(
        root,
        "services/auth/.env.staging",
        'AUTH_SECRET_KEY="oops-plaintext"',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production", "**/.env.staging"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain(".env.staging");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores comments and blank lines", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.production",
        [
          "# This is a comment about SECRET_KEY",
          "",
          "  # Another comment with TOKEN in it",
          'AUTH_SECRET="encrypted:valid=="',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when no env files exist", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects custom secret key patterns", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/codegene/.env.production",
        'DATABASE_URL="postgres://user:pass@host/db"',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
        secretKeyPatterns: ["URL", "DSN"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain("DATABASE_URL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects custom plaintext allowlist", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/codegene/.env.production",
        'AUTH_PUBLIC_KEY_ID="not-actually-secret"',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
        plaintextAllowlist: ["AUTH_PUBLIC_KEY_ID"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when secret-like keys use computed placeholder values", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/assets/.env.preview",
        [
          'S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}"',
          'S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}"',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.preview"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when placeholder syntax is malformed", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/assets/.env.preview",
        'S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:default}"',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.preview"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("S3_SECRET_ACCESS_KEY");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
