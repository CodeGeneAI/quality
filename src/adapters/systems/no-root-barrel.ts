import fg from "fast-glob";
import micromatch from "micromatch";
import { pathExists, readJsonFile } from "../../utils/fs";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

export interface NoRootBarrelAdapterOptions {
  readonly packages?: readonly string[];
  readonly exceptions?: readonly string[];
  readonly forbiddenFiles?: readonly string[];
  readonly checkExports?: boolean;
  readonly severity?: "error" | "warn";
}

const DEFAULT_FORBIDDEN_FILES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.mjs",
  "index.cjs",
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/index.mjs",
  "src/index.cjs",
] as const;

const PACKAGE_EXPORT_FIELDS = ["main", "module", "types", "typings"] as const;

export const noRootBarrelAdapter: StageAdapter<NoRootBarrelAdapterOptions> = {
  type: "no-root-barrel",
  label: "Forbid root barrel exports",
  supportsModes: ["check", "report"],
  supportsSandbox: true,
  supportsPartialFiles: false,
  async run(context) {
    const options = context.options ?? {};
    const packageGlobs = options.packages ?? [];
    if (packageGlobs.length === 0) {
      return { status: "passed" };
    }

    const matcherCache = new Map<string, (value: string) => boolean>();

    const exceptions = options.exceptions ?? [];
    const forbiddenFiles = options.forbiddenFiles ?? DEFAULT_FORBIDDEN_FILES;

    const matchedPackages = await fg(Array.from(packageGlobs), {
      cwd: context.root,
      onlyDirectories: true,
      dot: false,
      unique: true,
    });

    const violations: string[] = [];

    for (const relativeDir of matchedPackages) {
      if (
        exceptions.length > 0 &&
        isMatchCached(relativeDir, exceptions, matcherCache)
      ) {
        continue;
      }

      const packagePath = joinPaths(context.root, relativeDir);

      for (const file of forbiddenFiles) {
        const candidate = joinPaths(packagePath, file);
        if (await pathExists(candidate)) {
          violations.push(
            `${relativeDir}: found forbidden barrel file '${file}'`,
          );
        }
      }

      if (options.checkExports !== false) {
        const pkgJsonPath = joinPaths(packagePath, "package.json");
        if (await pathExists(pkgJsonPath)) {
          const pkg = await readJsonFile<Record<string, unknown>>(pkgJsonPath);
          violations.push(...collectPackageExportViolations(relativeDir, pkg));
        }
      }
    }

    if (violations.length === 0) {
      return { status: "passed" };
    }

    if (context.mode === "report" || options.severity === "warn") {
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

const collectPackageExportViolations = (
  relativeDir: string,
  pkg: Record<string, unknown>,
): string[] => {
  const messages: string[] = [];

  for (const field of PACKAGE_EXPORT_FIELDS) {
    const value = pkg[field];
    if (value && isRootIndexExport(value)) {
      messages.push(
        `${relativeDir}: package.json field '${field}' references a root index entry`,
      );
    }
  }

  const exportsField = pkg.exports;
  if (exportsField && isRootIndexExport(exportsField)) {
    messages.push(
      `${relativeDir}: package.json exports exposes a root barrel entry point`,
    );
  }

  return messages;
};

const isMatchCached = (
  value: string,
  patterns: readonly string[],
  cache: Map<string, (value: string) => boolean>,
): boolean => {
  const key = Array.isArray(patterns) ? patterns.join("|") : String(patterns);
  let matcher = cache.get(key);
  if (!matcher) {
    const normalized = Array.isArray(patterns) ? [...patterns] : [patterns];
    matcher = micromatch.matcher(
      normalized.length === 1 ? normalized[0] : normalized,
    );
    cache.set(key, matcher);
  }
  return matcher(value);
};

const isRootIndexExport = (value: unknown): boolean => {
  if (typeof value === "string") {
    return DEFAULT_FORBIDDEN_FILES.some(
      (file) => value === `./${file}` || value.endsWith(`/${file}`),
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => isRootIndexExport(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => isRootIndexExport(entry));
  }

  return false;
};
