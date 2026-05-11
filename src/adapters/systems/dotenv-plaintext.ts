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

export interface DotenvPlaintextAdapterOptions {
  /**
   * Glob patterns for committed .env files to scan.
   * @default ["**\/.env.production", "**\/.env.staging", "**\/.env.preview"]
   */
  readonly files?: readonly string[];

  /**
   * Key-name prefixes that must always remain plaintext (case-sensitive).
   * Any key whose name starts with one of these prefixes fails if its value
   * is encrypted.
   */
  readonly plaintextKeyPrefixes?: readonly string[];

  /**
   * Exact key names (case-sensitive) that must always remain plaintext.
   */
  readonly plaintextKeys?: readonly string[];

  /**
   * Keys allowed to be encrypted even if they match a plaintext rule.
   * Escape hatch for the rare case where a public-looking key is genuinely
   * sensitive in this codebase.
   */
  readonly encryptedAllowlist?: readonly string[];
}

const DEFAULT_FILES = [
  "**/.env.production",
  "**/.env.staging",
  "**/.env.preview",
];

const DEFAULT_PLAINTEXT_KEY_PREFIXES = [
  "NEXT_PUBLIC_",
  "VITE_",
  "PUBLIC_",
  "REACT_APP_",
  "EXPO_PUBLIC_",
  "STORYBOOK_",
  "DOTENV_PUBLIC_KEY",
];

const DEFAULT_PLAINTEXT_KEYS = ["NODE_ENV", "APP_ENV"];

const NODE_MODULES_IGNORE = ["**/node_modules/**"] as const;

function isPlaintextRequired(
  key: string,
  prefixes: readonly string[],
  exact: readonly string[],
): boolean {
  if (exact.includes(key)) {
    return true;
  }
  return prefixes.some((prefix) => key.startsWith(prefix));
}

export const dotenvPlaintextAdapter: StageAdapter<DotenvPlaintextAdapterOptions> =
  {
    type: "dotenv-plaintext",
    label: "Dotenv plaintext guard",
    description:
      "Prevents committing encrypted values for keys that must stay plaintext (frontend-public prefixes, dotenvx public keys, bootstrap vars).",
    supportsModes: ["check", "report"],
    supportsSandbox: true,
    supportsPartialFiles: false,

    async run(context) {
      const options = context.options ?? {};
      const fileGlobs = options.files ?? DEFAULT_FILES;
      const prefixes =
        options.plaintextKeyPrefixes ?? DEFAULT_PLAINTEXT_KEY_PREFIXES;
      const exactKeys = options.plaintextKeys ?? DEFAULT_PLAINTEXT_KEYS;
      const encryptedAllowlist = options.encryptedAllowlist ?? [];

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
            if (entry.value === "") {
              continue;
            }

            if (isComputedEnvValue(entry.value)) {
              continue;
            }

            if (!entry.value.startsWith(ENCRYPTED_PREFIX)) {
              continue;
            }

            if (encryptedAllowlist.includes(entry.key)) {
              continue;
            }

            if (!isPlaintextRequired(entry.key, prefixes, exactKeys)) {
              continue;
            }

            failures.push(
              `${relativePath}:${entry.line}: "${entry.key}" must remain plaintext but is encrypted. ` +
                `Run \`bun x dotenvx decrypt -k ${entry.key} -f ${relativePath}\` to restore the plaintext value ` +
                `(and \`bun x dotenvx set ${entry.key} "<plaintext>" -f ${relativePath} --plain\` to rewrite it). ` +
                "If encryption is intentional, add the key to `encryptedAllowlist`.",
            );
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
