import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DotenvPlaintextAdapterOptions } from "./dotenv-plaintext";
import { dotenvPlaintextAdapter } from "./dotenv-plaintext";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-dotenv-plaintext-"));

const runAdapter = async (
  root: string,
  options: DotenvPlaintextAdapterOptions,
  files: readonly string[] = [],
  hasExplicitFileSelection = files.length > 0,
) =>
  dotenvPlaintextAdapter.run({
    mode: "check",
    pipelineMode: "check",
    stage: {
      id: "dotenv-plaintext",
      type: "dotenv-plaintext",
      options,
      continueOnError: false,
      files: [],
    },
    root,
    options,
    files,
    hasExplicitFileSelection,
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

describe("dotenv-plaintext adapter", () => {
  it("passes when all plaintext-required keys are plaintext", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        [
          'DOTENV_PUBLIC_KEY_PRODUCTION="0286f44b69d38d"',
          'NODE_ENV="production"',
          'APP_ENV="production"',
          'NEXT_PUBLIC_APP_URL="https://app.example.com"',
          'VITE_API_URL="https://api.example.com"',
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

  it("passes when unrelated keys are encrypted", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "services/auth/.env.production",
        [
          'DOTENV_PUBLIC_KEY_PRODUCTION="abc"',
          'AUTH_SIGNING_PRIVATE_KEY_PEM="encrypted:BMTuU15zL+base64=="',
          'AUTH_CLIENT_SECRET="encrypted:BIhSkUbase64=="',
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

  it("fails when NEXT_PUBLIC_* is encrypted", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NEXT_PUBLIC_APP_URL="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("NEXT_PUBLIC_APP_URL");
      expect(result.messages![0]).toContain("must remain plaintext");
      expect(result.messages![0]).toContain("dotenvx decrypt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when VITE_* is encrypted", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'VITE_API_URL="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("VITE_API_URL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when DOTENV_PUBLIC_KEY_* is encrypted (chicken-and-egg guard)", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'DOTENV_PUBLIC_KEY_PRODUCTION="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("DOTENV_PUBLIC_KEY_PRODUCTION");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when NODE_ENV is encrypted (exact-key match)", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NODE_ENV="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("NODE_ENV");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when an encrypted plaintext-required key is in encryptedAllowlist", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NEXT_PUBLIC_APP_URL="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
        encryptedAllowlist: ["NEXT_PUBLIC_APP_URL"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips empty values", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        ['NEXT_PUBLIC_APP_URL=""', 'VITE_API_URL=""'].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips ${VAR} and ${VAR:-default} computed placeholders", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.preview",
        [
          'NEXT_PUBLIC_APP_URL="${APP_URL}"',
          'VITE_API_URL="${API_URL:-https://example.com}"',
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

  it("respects custom plaintextKeyPrefixes (override removes defaults)", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        [
          'VITE_API_URL="encrypted:BMxxxbase64=="',
          'MY_FRONTEND_FLAG="encrypted:BMxxxbase64=="',
        ].join("\n"),
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
        plaintextKeyPrefixes: ["MY_FRONTEND_"],
        plaintextKeys: [],
      });
      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("MY_FRONTEND_FLAG");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects custom plaintextKeys", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'SERVICE_REGION="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
        plaintextKeyPrefixes: [],
        plaintextKeys: ["SERVICE_REGION"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain("SERVICE_REGION");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does case-sensitive prefix matching", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'next_public_foo="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scans across multiple env files and reports only offenders", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NEXT_PUBLIC_APP_URL="https://app.example.com"',
      );
      await writeEnvFile(
        root,
        "apps/web/.env.staging",
        'NEXT_PUBLIC_APP_URL="encrypted:BMxxxbase64=="',
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
        "apps/web/.env.production",
        [
          "# encrypted:NEXT_PUBLIC_APP_URL example comment",
          "",
          "  # Another comment mentioning VITE_API_URL",
          'NEXT_PUBLIC_APP_URL="https://app.example.com"',
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

  it("does not scan workspace env files for unrelated explicit partial input", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NEXT_PUBLIC_APP_URL="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(
        root,
        {
          files: ["**/.env.production"],
        },
        [".changeset/example.md"],
      );

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("checks matching env files from explicit partial input", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NEXT_PUBLIC_APP_URL="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(
        root,
        {
          files: ["**/.env.production"],
        },
        ["apps/web/.env.production"],
      );

      expect(result.status).toBe("failed");
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0]).toContain("NEXT_PUBLIC_APP_URL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates correct remediation command", async () => {
    const root = await createTempWorkspace();
    try {
      await writeEnvFile(
        root,
        "apps/web/.env.production",
        'NEXT_PUBLIC_APP_URL="encrypted:BMxxxbase64=="',
      );

      const result = await runAdapter(root, {
        files: ["**/.env.production"],
      });
      expect(result.status).toBe("failed");
      expect(result.messages![0]).toContain(
        "bun x dotenvx decrypt -k NEXT_PUBLIC_APP_URL -f apps/web/.env.production",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
