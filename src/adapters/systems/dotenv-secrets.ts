import fg from "../../utils/bun-glob";
import {
  ENCRYPTED_PREFIX,
  isComputedEnvValue,
  parseEnvFile,
} from "../../utils/dotenv-parse";
import { readTextFile } from "../../utils/fs";
import { mergeIgnorePatterns } from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

export interface DotenvSecretsAdapterOptions {
  /**
   * Glob patterns for committed .env files to scan.
   * @default ["**\/.env.production", "**\/.env.staging", "**\/.env.preview"]
   */
  readonly files?: readonly string[];

  /**
   * Key names that are allowed to have plaintext (non-encrypted) values.
   * Matched exactly (case-sensitive).
   */
  readonly plaintextAllowlist?: readonly string[];

  /**
   * Patterns in key names that indicate a secret. If a key matches any of
   * these patterns (case-insensitive) and its value is non-empty and not
   * encrypted, the check fails.
   */
  readonly secretKeyPatterns?: readonly string[];
}

const DEFAULT_FILES = [
  "**/.env.production",
  "**/.env.staging",
  "**/.env.preview",
];

const DEFAULT_PLAINTEXT_ALLOWLIST = ["APP_ENV", "NODE_ENV"];

const DEFAULT_SECRET_KEY_PATTERNS = [
  "SECRET",
  "KEY",
  "TOKEN",
  "PASSWORD",
  "PEM",
  "PRIVATE",
  "CREDENTIAL",
];

const NODE_MODULES_IGNORE = ["**/node_modules/**"] as const;
const DOTENV_PUBLIC_KEY_PREFIX = "DOTENV_PUBLIC_KEY";

function isPlaintextAllowed(
  key: string,
  allowlist: readonly string[],
): boolean {
  return key.startsWith(DOTENV_PUBLIC_KEY_PREFIX) || allowlist.includes(key);
}

function matchesSecretPattern(
  key: string,
  patterns: readonly string[],
): boolean {
  const upper = key.toUpperCase();
  return patterns.some((pattern) => upper.includes(pattern.toUpperCase()));
}

export const dotenvSecretsAdapter: StageAdapter<DotenvSecretsAdapterOptions> = {
  type: "dotenv-secrets",
  label: "Dotenv secret encryption guard",
  description:
    "Prevents committing plaintext secrets in .env files. Values must be encrypted or explicitly allowlisted.",
  supportsModes: ["check", "report"],
  supportsSandbox: true,
  supportsPartialFiles: false,

  async run(context) {
    const options = context.options ?? {};
    const fileGlobs = options.files ?? DEFAULT_FILES;
    const allowlist = options.plaintextAllowlist ?? DEFAULT_PLAINTEXT_ALLOWLIST;
    const secretPatterns =
      options.secretKeyPatterns ?? DEFAULT_SECRET_KEY_PATTERNS;

    if (fileGlobs.length === 0) {
      return { status: "passed" };
    }

    const ignorePatterns = mergeIgnorePatterns(
      NODE_MODULES_IGNORE,
      context.ignore,
    );

    const envFiles = await fg(Array.from(fileGlobs), {
      cwd: context.root,
      dot: true,
      unique: true,
      ignore: [...ignorePatterns],
    });

    const failures: string[] = [];

    await Promise.all(
      envFiles.map(async (relativePath) => {
        const filePath = joinPaths(context.root, relativePath);
        let content: string;
        try {
          content = await readTextFile(filePath);
        } catch {
          return;
        }

        const entries = parseEnvFile(content);

        for (const entry of entries) {
          // Skip empty values — they're placeholders
          if (entry.value === "") {
            continue;
          }

          // Skip already-encrypted values
          if (entry.value.startsWith(ENCRYPTED_PREFIX)) {
            continue;
          }

          // Skip explicitly allowlisted keys
          if (isPlaintextAllowed(entry.key, allowlist)) {
            continue;
          }

          // Skip values that are runtime-computed placeholders.
          if (isComputedEnvValue(entry.value)) {
            continue;
          }

          // If the key matches a secret pattern, it must be encrypted
          if (matchesSecretPattern(entry.key, secretPatterns)) {
            failures.push(
              `${relativePath}:${entry.line}: "${entry.key}" looks like a secret but is not encrypted. ` +
                `Use \`dotenvx set ${entry.key} "<value>" -fk .env.keys -f ${relativePath}\` to encrypt it, ` +
                "or add it to the plaintextAllowlist if it is not sensitive.",
            );
          }
        }
      }),
    );

    if (failures.length === 0) {
      return { status: "passed" };
    }

    return {
      status: "failed",
      messages: failures.sort(),
    };
  },
};
