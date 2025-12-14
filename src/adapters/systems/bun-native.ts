import fg from "fast-glob";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

const TRACKED_MODULES = [
  "fs/promises",
  "child_process",
  "timers/promises",
  "buffer",
  "crypto",
  "path",
  "url",
  "util",
  "fs",
  "os",
  "net",
] as const;

const DEFAULT_IGNORE_PATTERNS = DEFAULT_GLOB_IGNORE;

export interface BunNativeAdapterOptions {
  readonly allowlist?: Record<string, string[] | string>;
  readonly allowedModules?: readonly string[];
  readonly ignore?: readonly string[];
  readonly stripNodePrefix?: boolean;
}

export const bunNativeAdapter: StageAdapter<BunNativeAdapterOptions> = {
  type: "bun-native",
  label: "Bun-native API enforcement",
  supportsModes: ["check", "fix"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run(context) {
    const options = context.options ?? {};
    const allowlist = new Map<string, Set<string>>(
      Object.entries(options.allowlist ?? {}).map(([file, modules]) => [
        file,
        new Set(Array.isArray(modules) ? modules : [modules]),
      ]),
    );
    const allowedModules = new Set(options.allowedModules ?? []);
    const stageIgnore = options.ignore ?? [];
    const combinedStageIgnore =
      stageIgnore.length > 0
        ? [...DEFAULT_IGNORE_PATTERNS, ...stageIgnore]
        : DEFAULT_IGNORE_PATTERNS;
    const ignorePatterns = mergeIgnorePatterns(
      combinedStageIgnore,
      context.ignore,
    );

    const files = await resolveFiles(
      context.root,
      context.files,
      ignorePatterns,
    );
    const violations: Array<{ file: string; line: number; module: string }> =
      [];
    const stripPrefix = options.stripNodePrefix !== false;

    for (const file of files) {
      if (shouldIgnorePath(file, ignorePatterns)) {
        continue;
      }
      const absolutePath = joinPaths(context.root, file);
      const content = await Bun.file(absolutePath).text();
      const fileViolations: Array<{ line: number; module: string }> = [];
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        const match = line.match(/node:([a-z0-9_/.-]+)/i);
        if (!match) return;
        const moduleName = match[1];
        if (allowedModules.has(moduleName)) {
          return;
        }
        if (
          !TRACKED_MODULES.includes(
            moduleName as (typeof TRACKED_MODULES)[number],
          )
        ) {
          return;
        }
        const fileAllow = allowlist.get(file) ?? allowlist.get("*");
        if (fileAllow?.has(moduleName)) {
          return;
        }
        fileViolations.push({ line: index + 1, module: moduleName });
      });
      if (context.mode === "fix" && fileViolations.length > 0 && stripPrefix) {
        const updated = content.replace(
          /node:([a-z0-9_/.-]+)/gi,
          (_match, mod) => mod,
        );
        await Bun.write(absolutePath, updated);
      }
      for (const violation of fileViolations) {
        violations.push({
          file,
          line: violation.line,
          module: violation.module,
        });
      }
    }

    if (violations.length === 0) {
      return { status: "passed" };
    }

    if (context.mode === "fix" && stripPrefix) {
      return {
        status: "passed",
        messages: [
          `Stripped node: prefix from ${violations.length} import specifier(s).`,
        ],
      };
    }

    return {
      status: "failed",
      messages: violations.map(
        (violation) =>
          `${violation.file}:${violation.line} imports node:${violation.module}`,
      ),
    };
  },
};

const resolveFiles = async (
  root: string,
  files: readonly string[],
  ignorePatterns: readonly string[],
): Promise<string[]> => {
  if (files.length > 0) {
    return files.filter((file) => !shouldIgnorePath(file, ignorePatterns));
  }
  const matches = fg.sync("**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}", {
    cwd: root,
    dot: true,
    ignore: [...ignorePatterns],
  });
  return matches.filter((file) => !shouldIgnorePath(file, ignorePatterns));
};
