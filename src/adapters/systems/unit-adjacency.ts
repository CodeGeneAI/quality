import fg from "fast-glob";
import micromatch from "micromatch";
import { pathExists } from "../../utils/fs";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import { dirname, joinPaths, relativePath } from "../../utils/path";
import type { StageAdapter } from "../types";

const DEFAULT_UNIT_PATTERNS = [
  "**/*.unit.spec.ts",
  "**/*.unit.spec.tsx",
  "**/*.unit.spec.js",
  "**/*.unit.spec.jsx",
  "**/*.unit.spec.mts",
  "**/*.unit.spec.mjs",
  "**/*.unit.spec.cts",
  "**/*.unit.spec.cjs",
];

const DEFAULT_FORBIDDEN_SEGMENTS = ["__tests__", "test"] as const;

const SUBJECT_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "mts",
  "cjs",
  "cts",
];

export interface UnitAdjacencyOptions {
  readonly unitPatterns?: readonly string[];
  readonly forbiddenSegments?: readonly string[];
  readonly requireSubject?: boolean;
  readonly ignore?: readonly string[];
  readonly allowSubjectlessInTestsDir?: boolean;
  readonly testsDirName?: string;
}

export const unitAdjacencyAdapter: StageAdapter<UnitAdjacencyOptions> = {
  type: "unit-adjacency",
  label: "Unit test adjacency enforcement",
  description:
    "Ensures unit tests live next to the files they cover and not inside __tests__ or test/ folders.",
  supportsModes: ["check", "report"],
  supportsPartialFiles: true,
  async run(context) {
    const options = context.options ?? {};
    const patterns = options.unitPatterns?.length
      ? [...options.unitPatterns]
      : DEFAULT_UNIT_PATTERNS;
    const forbiddenSegments = options.forbiddenSegments?.length
      ? [...options.forbiddenSegments]
      : [...DEFAULT_FORBIDDEN_SEGMENTS];
    const requireSubject = options.requireSubject ?? true;

    const ignore = mergeIgnorePatterns(
      options.ignore?.length ? [...options.ignore] : DEFAULT_GLOB_IGNORE,
      context.ignore,
    );

    const allowSubjectlessInTestsDir =
      options.allowSubjectlessInTestsDir ?? true;
    const testsDirName = options.testsDirName ?? "__tests__";
    const testsDirCache = new Map<string, { ok: boolean; message?: string }>();

    const unitTests = await resolveUnitTests({
      root: context.root,
      changedFiles: context.files,
      patterns,
      ignore,
    });

    const violations: string[] = [];

    for (const file of unitTests) {
      const subject = await findSubjectFile(context.root, file);
      if (subject) continue;

      if (!requireSubject) {
        continue;
      }

      const testsDirAllowance = allowSubjectlessInTestsDir
        ? checkTestsDirAllowance({
            root: context.root,
            file,
            testsDirName,
            patterns,
            ignore,
            cache: testsDirCache,
          })
        : { ok: false };

      if (testsDirAllowance.ok) {
        continue;
      }

      if (containsForbiddenSegment(file, forbiddenSegments)) {
        if (testsDirAllowance.message) {
          violations.push(testsDirAllowance.message);
          continue;
        }
        violations.push(
          `${file} is located inside a forbidden test directory (${forbiddenSegments.join(", ")}). Place unit tests next to their subjects instead.`,
        );
        continue;
      }

      if (testsDirAllowance.message) {
        violations.push(testsDirAllowance.message);
        continue;
      }

      const candidate = describeSubjectCandidates(file);
      violations.push(
        `${file} has no adjacent subject file. Expected one of: ${candidate}.`,
      );
    }

    if (violations.length === 0) {
      return { status: "passed" };
    }

    if (context.mode === "report") {
      return { status: "passed", messages: violations };
    }

    return { status: "failed", messages: violations };
  },
};

const resolveUnitTests = async ({
  root,
  changedFiles,
  patterns,
  ignore,
}: {
  root: string;
  changedFiles: readonly string[];
  patterns: readonly string[];
  ignore: readonly string[];
}): Promise<string[]> => {
  if (changedFiles.length > 0) {
    return changedFiles.filter(
      (file) =>
        micromatch.isMatch(file, patterns) && !shouldIgnorePath(file, ignore),
    );
  }

  const matches = await fg(Array.from(patterns), {
    cwd: root,
    dot: true,
    ignore: Array.from(ignore),
  });

  return matches.filter((file) => !shouldIgnorePath(file, ignore));
};

const containsForbiddenSegment = (
  file: string,
  forbidden: readonly string[],
): boolean => {
  const segments = file.split(/[/\\]/);
  return segments.some((segment) => forbidden.includes(segment));
};

const findSubjectFile = async (
  root: string,
  unitTestPath: string,
): Promise<string | undefined> => {
  const stem = extractStem(unitTestPath);
  if (!stem) return undefined;

  const dir = dirname(unitTestPath);
  for (const ext of SUBJECT_EXTENSIONS) {
    const candidate = joinPaths(dir, `${stem}.${ext}`);
    if (await pathExists(joinPaths(root, candidate))) {
      return candidate;
    }
  }
  return undefined;
};

const describeSubjectCandidates = (unitTestPath: string): string => {
  const stem = extractStem(unitTestPath);
  const dir = dirname(unitTestPath);
  const candidates = SUBJECT_EXTENSIONS.map((ext) =>
    relativePath(dir, `${stem}.${ext}`),
  );
  return candidates.join(", ");
};

const checkTestsDirAllowance = ({
  root,
  file,
  testsDirName,
  patterns,
  ignore,
  cache,
}: {
  root: string;
  file: string;
  testsDirName: string;
  patterns: readonly string[];
  ignore: readonly string[];
  cache: Map<string, { ok: boolean; message?: string }>;
}): { ok: boolean; message?: string } => {
  const segments = file.split(/[/\\]/);
  const testsIndex = segments.lastIndexOf(testsDirName);
  if (testsIndex === -1) {
    return { ok: false };
  }
  // must be under src/**/__tests__/**
  if (testsIndex === 0 || !segments.slice(0, testsIndex).includes("src")) {
    return { ok: false };
  }

  const testsDirPath = segments.slice(0, testsIndex + 1).join("/");
  const cached = cache.get(testsDirPath);
  if (cached) return cached;

  // Ensure all files inside testsDir are unit tests (match patterns or ignored)
  const entries = fg.sync("**/*", {
    cwd: joinPaths(root, testsDirPath),
    dot: true,
    ignore: Array.from(ignore),
  }) as string[];

  for (const entry of entries) {
    const rel = joinPaths(testsDirPath, entry);
    if (shouldIgnorePath(rel, ignore)) continue;
    if (micromatch.isMatch(rel, patterns)) continue;
    const result = {
      ok: false,
      message: `${file} is in ${testsDirPath}, but that directory contains non-unit-test files (e.g., ${rel}). Remove them or convert to unit test filenames.`,
    } as const;
    cache.set(testsDirPath, result);
    return result;
  }

  const okResult = { ok: true } as const;
  cache.set(testsDirPath, okResult);
  return okResult;
};

const extractStem = (unitTestPath: string): string => {
  const parts = unitTestPath.split(/[/\\]/);
  const base = parts.pop() ?? "";
  return base.replace(/\.unit\.spec\.[^.]+$/, "");
};
