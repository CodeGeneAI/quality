// Node's fs.promises API is used here because Bun does not yet expose a high-level
// rename helper that preserves atomic filesystem semantics.

import fg from "fast-glob";
import { mkdir, rename as renameFile } from "fs/promises";
import micromatch from "micromatch";
import { pathExists } from "../../utils/fs";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import { dirname as getDirname, joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

const DEFAULT_INCLUDE = [
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.test.ts",
  "**/*.test.tsx",
];

const DEFAULT_PATTERNS = [
  "**/*.unit.spec.ts",
  "**/*.unit.spec.tsx",
  "**/*.int.spec.ts",
  "**/*.int.spec.tsx",
];

const DEFAULT_IGNORE_PATTERNS = DEFAULT_GLOB_IGNORE;

export interface FilenameRenameRule {
  readonly match: string;
  readonly replace: string;
}

export interface FilenameAdapterOptions {
  readonly patterns?: readonly string[];
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly severity?: "error" | "warn";
  readonly rename?: readonly FilenameRenameRule[];
}

export const filenameAdapter: StageAdapter<FilenameAdapterOptions> = {
  type: "filenames",
  label: "Test filename lint",
  supportsModes: ["check", "fix", "report"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run(context) {
    const options = context.options ?? {};
    const include = Array.from(options.include ?? DEFAULT_INCLUDE);
    const stageIgnore = options.ignore ? Array.from(options.ignore) : [];
    const ignore = mergeIgnorePatterns(
      stageIgnore.length > 0
        ? [...DEFAULT_IGNORE_PATTERNS, ...stageIgnore]
        : DEFAULT_IGNORE_PATTERNS,
      context.ignore,
    );
    const patterns = Array.from(options.patterns ?? DEFAULT_PATTERNS);
    const candidateFiles = resolveCandidateFiles(
      context.root,
      context.files,
      include,
      ignore,
    );

    const violations: string[] = [];
    const renameSummaries: string[] = [];

    for (const file of candidateFiles) {
      if (shouldIgnorePath(file, ignore)) {
        continue;
      }
      if (matchesAnyPattern(file, patterns)) {
        continue;
      }

      const renameRules = options.rename ? Array.from(options.rename) : [];
      if (context.mode === "fix" && renameRules.length > 0) {
        const renamed = await attemptRename({
          root: context.root,
          file,
          rules: renameRules,
          patterns,
        });
        if (renamed) {
          renameSummaries.push(`${file} -> ${renamed}`);
          continue;
        }
      }

      const suggestion = renameRules.length
        ? suggestRename(file, renameRules, patterns)
        : undefined;
      violations.push(
        suggestion
          ? `${file} does not match allowed test filename patterns. Suggested rename: ${suggestion}.`
          : `${file} does not match allowed test filename patterns.`,
      );
    }

    if (violations.length === 0) {
      if (renameSummaries.length > 0) {
        return {
          status: "passed",
          messages: [
            `Renamed ${renameSummaries.length} file(s).`,
            ...renameSummaries,
          ],
        };
      }
      return { status: "passed" };
    }

    if (context.mode === "fix" && renameSummaries.length > 0) {
      return {
        status: "passed",
        messages: [
          `Renamed ${renameSummaries.length} file(s).`,
          ...renameSummaries,
        ],
      };
    }

    if (context.mode === "report") {
      return {
        status: "passed",
        messages: violations,
      };
    }

    if (options.severity === "warn") {
      return {
        status: "passed",
        messages: violations,
      };
    }

    return {
      status: "failed",
      messages: violations,
    };
  },
};

const matchesAnyPattern = (
  file: string,
  patterns: readonly string[],
): boolean => patterns.some((pattern) => micromatch.isMatch(file, pattern));

const resolveCandidateFiles = (
  root: string,
  changedFiles: readonly string[],
  include: readonly string[],
  ignore: readonly string[],
): string[] => {
  if (changedFiles.length > 0) {
    return Array.from(changedFiles).filter(
      (file) =>
        !shouldIgnorePath(file, ignore) && micromatch.isMatch(file, include),
    );
  }

  const patterns = Array.from(include);
  const ignorePatterns = Array.from(ignore);
  const matches = fg.sync(patterns, {
    cwd: root,
    dot: true,
    ignore: ignorePatterns,
  });

  return matches.filter((file) => !shouldIgnorePath(file, ignorePatterns));
};

const suggestRename = (
  file: string,
  rules: readonly FilenameRenameRule[],
  patterns: readonly string[],
): string | undefined => {
  for (const rule of rules) {
    const regex = new RegExp(rule.match);
    if (!regex.test(file)) {
      continue;
    }
    const candidate = file.replace(regex, rule.replace);
    if (candidate !== file && matchesAnyPattern(candidate, patterns)) {
      return candidate;
    }
  }
  return undefined;
};

const attemptRename = async ({
  root,
  file,
  rules,
  patterns,
}: {
  readonly root: string;
  readonly file: string;
  readonly rules: readonly FilenameRenameRule[];
  readonly patterns: readonly string[];
}): Promise<string | undefined> => {
  const target = suggestRename(file, rules, patterns);
  if (!target || target === file) {
    return undefined;
  }
  const sourcePath = joinPaths(root, file);
  const targetPath = joinPaths(root, target);
  if (await pathExists(targetPath)) {
    return undefined;
  }
  const targetDir = getDirname(targetPath);
  if (targetDir !== ".") {
    await mkdir(targetDir, { recursive: true });
  }
  await renameFile(sourcePath, targetPath);
  return target;
};
