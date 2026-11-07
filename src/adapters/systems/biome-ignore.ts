import { readFileSync, statSync } from "node:fs";
import fg from "../../utils/bun-glob";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import {
  type CommentProbe,
  createCommentProbe,
} from "../../utils/source-comments";
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

const isBom = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 &&
  ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff));

// Every directive ESLINT_DIRECTIVE_REGEX matches contains the ASCII text
// "eslint-", which UTF-8 decoding leaves intact and never produces from other
// bytes, so a regular file whose raw bytes lack it has no violation to report
// or fix and is not decoded. The awaited `Bun.file().text()` per file was 2.5
// of this stage's 5.9 CPU seconds over the CodeGene platform monorepo's 26,841 source files,
// against 0.3 s for the same files read synchronously (CPU profile and
// measurement 2026-10-30). Only that case is decided here. Anything else
// (a path that is not a regular file, a read that fails, a file that starts
// with a UTF-16 byte order mark, which `Bun.file().text()` decodes as UTF-16
// so its ASCII letters are not in its bytes) answers `true` and goes the way
// it always went, so the stage's verdict, errors and fixes for those inputs
// are the published ones.
const mayHoldDirective = (absolutePath: string): boolean => {
  try {
    if (!statSync(absolutePath).isFile()) {
      return true;
    }
    const bytes = readFileSync(absolutePath);
    return isBom(bytes) || bytes.includes("eslint-");
  } catch {
    return true;
  }
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
      if (!mayHoldDirective(absolutePath)) {
        continue;
      }
      const bunFile = Bun.file(absolutePath);

      if (!(await bunFile.exists())) {
        continue;
      }

      const content = await bunFile.text();
      const lines = content.split("\n");
      const fileViolations: Violation[] = [];

      let probe: CommentProbe | undefined;
      let lineStart = 0;

      lines.forEach((line, index) => {
        const offset = lineStart;
        lineStart += line.length + 1;

        const match = line.match(ESLINT_DIRECTIVE_REGEX);
        if (!match || match.index === undefined) return;

        const directive = match[1];
        const rules = match[2]?.trim();

        const fileAllow = allowlist.get(file) ?? allowlist.get("*");
        if (fileAllow?.has(directive)) return;

        // A directive is a comment; the same text in a string, template
        // literal, regular expression or JSX text is not one (ESLint reads
        // directives from comments only).
        probe ??= createCommentProbe(file, content);
        const directiveOffset =
          offset + match.index + match[0].indexOf(directive);
        if (!probe(directiveOffset, directive.length)) return;

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
