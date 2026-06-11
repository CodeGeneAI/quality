import fg from "../../utils/bun-glob";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

const DEFAULT_IGNORE_PATTERNS = DEFAULT_GLOB_IGNORE;

/** Source file types to scan for ESLint directive comments. */
const FILE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

/**
 * Matches ESLint directive comments (line and block styles).
 *
 * Captures:
 *  [1] directive – `eslint-disable-next-line` | `eslint-disable` | `eslint-enable`
 *  [2] rules    – optional comma-separated rule list (stops before ` -- reason`)
 */
const ESLINT_DIRECTIVE_REGEX =
  /(?:\/\/|\/\*)\s*(eslint-disable-next-line|eslint-disable|eslint-enable)(?:\s+([\w@/][\w@/,\s-]*?))?(?:\s+--.*?)?\s*(?:\*\/)?$/;

/**
 * Configuration options for the biome-ignore quality adapter.
 */
export interface BiomeIgnoreAdapterOptions {
  /**
   * Additional glob patterns to exclude from scanning.
   * Merged with the default ignore patterns.
   */
  readonly ignore?: readonly string[];

  /**
   * Per-file or global allowlist for ESLint directives to keep.
   * Key is a relative file path or `"*"` for all files.
   * Value is one or more directive names to allow.
   * @example { "legacy.ts": ["eslint-disable"], "*": ["eslint-enable"] }
   */
  readonly allowlist?: Record<string, string[] | string>;
}

interface Violation {
  file: string;
  line: number;
  directive: string;
  rules?: string;
  fixable: boolean;
}

const isFixable = (directive: string): boolean =>
  directive === "eslint-disable-next-line";

const buildReplacement = (
  originalLine: string,
  directive: string,
  rules: string | undefined,
): string => {
  const indent = originalLine.match(/^(\s*)/)?.[1] ?? "";
  const reason = rules?.trim() || directive;
  return `${indent}// biome-ignore lint: ${reason}`;
};

const resolveFiles = async (
  root: string,
  files: readonly string[],
  ignorePatterns: readonly string[],
  hasExplicitFileSelection: boolean,
): Promise<string[]> => {
  if (hasExplicitFileSelection) {
    return files.filter((file) => !shouldIgnorePath(file, ignorePatterns));
  }
  const matches = fg.sync(FILE_GLOB, {
    cwd: root,
    dot: true,
    ignore: [...ignorePatterns],
  });
  return matches.filter((file) => !shouldIgnorePath(file, ignorePatterns));
};

export const biomeIgnoreAdapter: StageAdapter<BiomeIgnoreAdapterOptions> = {
  type: "biome-ignore",
  label: "ESLint ignore comment migration",
  supportsModes: ["check", "fix"],
  supportsSandbox: true,
  supportsPartialFiles: true,

  async run(context) {
    const options = context.options ?? {};
    const allowlist = new Map<string, Set<string>>(
      Object.entries(options.allowlist ?? {}).map(([file, directives]) => [
        file,
        new Set(Array.isArray(directives) ? directives : [directives]),
      ]),
    );
    const stageIgnore = options.ignore ?? [];
    const combinedIgnore =
      stageIgnore.length > 0
        ? [...DEFAULT_IGNORE_PATTERNS, ...stageIgnore]
        : DEFAULT_IGNORE_PATTERNS;
    const ignorePatterns = mergeIgnorePatterns(combinedIgnore, context.ignore);

    const files = await resolveFiles(
      context.root,
      context.files,
      ignorePatterns,
      context.hasExplicitFileSelection === true,
    );
    const allViolations: Violation[] = [];
    let fixedCount = 0;

    for (const file of files) {
      const absolutePath = joinPaths(context.root, file);
      const bunFile = Bun.file(absolutePath);

      if (!(await bunFile.exists())) {
        continue;
      }

      const content = await bunFile.text();
      const lines = content.split("\n");
      const fileViolations: Violation[] = [];

      lines.forEach((line, index) => {
        const match = line.match(ESLINT_DIRECTIVE_REGEX);
        if (!match) return;

        const directive = match[1];
        const rules = match[2]?.trim();

        const fileAllow = allowlist.get(file) ?? allowlist.get("*");
        if (fileAllow?.has(directive)) return;

        fileViolations.push({
          file,
          line: index + 1,
          directive,
          rules,
          fixable: isFixable(directive),
        });
      });

      if (context.mode === "fix" && fileViolations.length > 0) {
        const updatedLines = [...lines];
        const unfixable: Violation[] = [];

        for (const violation of fileViolations) {
          if (violation.fixable) {
            updatedLines[violation.line - 1] = buildReplacement(
              lines[violation.line - 1],
              violation.directive,
              violation.rules,
            );
            fixedCount++;
          } else {
            unfixable.push(violation);
          }
        }

        let updated = updatedLines.join("\n");
        if (content.endsWith("\n") && !updated.endsWith("\n")) {
          updated += "\n";
        }
        if (updated !== content) {
          await Bun.write(absolutePath, updated);
        }

        allViolations.push(...unfixable);
      } else {
        allViolations.push(...fileViolations);
      }
    }

    if (allViolations.length === 0) {
      if (context.mode === "fix" && fixedCount > 0) {
        return {
          status: "passed",
          messages: [
            `Replaced ${fixedCount} ESLint ignore comment(s) with biome-ignore equivalents.`,
          ],
        };
      }
      return { status: "passed" };
    }

    return {
      status: "failed",
      messages: allViolations.map((violation) => {
        const ruleInfo = violation.rules ? ` (${violation.rules})` : "";
        const fixNote = !violation.fixable
          ? " [cannot auto-fix block-level directive]"
          : "";
        return `${violation.file}:${violation.line} contains ${violation.directive}${ruleInfo} (use biome-ignore instead)${fixNote}`;
      }),
    };
  },
};
