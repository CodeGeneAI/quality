import micromatch from "micromatch";
import fg from "../../utils/bun-glob";
import { readJsonFile, writeTextFile } from "../../utils/fs";
import { mergeIgnorePatterns } from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

type DependencySection =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies";

export interface PackageCatalogAdapterOptions {
  readonly packages?: readonly string[];
  readonly sections?: readonly DependencySection[];
  readonly allowlist?: readonly string[];
  readonly rootCatalogPath?: string;
}

interface CatalogLookup {
  readonly byPackage: Map<string, string>;
}

const DEFAULT_SECTIONS: readonly DependencySection[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
];

const NODE_MODULES_IGNORE = ["**/node_modules/**"] as const;

const isCatalogVersion = (version: unknown): version is string =>
  typeof version === "string" && version.startsWith("catalog:");

const isWorkspaceVersion = (version: unknown): version is string =>
  typeof version === "string" && version.startsWith("workspace:");

const loadCatalog = async (
  root: string,
  catalogPath: string,
): Promise<CatalogLookup> => {
  const pkg = await readJsonFile<Record<string, unknown>>(catalogPath);
  const catalogs =
    (pkg as { catalogs?: Record<string, Record<string, string>> }).catalogs ??
    {};

  const byPackage = new Map<string, string>();
  for (const [catalogName, entries] of Object.entries(catalogs)) {
    for (const [pkgName] of Object.entries(entries ?? {})) {
      if (!byPackage.has(pkgName)) {
        byPackage.set(pkgName, catalogName);
      }
    }
  }

  return { byPackage };
};

export const packageCatalogAdapter: StageAdapter<PackageCatalogAdapterOptions> =
  {
    type: "package-catalog",
    label: "Enforce catalog:<name> dependency versions",
    supportsModes: ["check", "fix", "report"],
    supportsSandbox: true,
    supportsPartialFiles: false,
    async run(context) {
      const options = context.options ?? {};
      const packageGlobs = options.packages ?? [];
      const sections = options.sections?.length
        ? options.sections
        : DEFAULT_SECTIONS;
      const allowlist = options.allowlist ?? [];
      const catalogPath = joinPaths(
        context.root,
        options.rootCatalogPath ?? "package.json",
      );

      if (packageGlobs.length === 0 || sections.length === 0) {
        return { status: "passed" };
      }

      let catalogLookup: CatalogLookup;
      try {
        catalogLookup = await loadCatalog(context.root, catalogPath);
      } catch (error) {
        return {
          status: "failed",
          messages: [
            `Unable to read root catalog at ${catalogPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ],
        };
      }

      const ignorePatterns = mergeIgnorePatterns(
        NODE_MODULES_IGNORE,
        context.ignore,
      );

      const packagePaths = await fg(Array.from(packageGlobs), {
        cwd: context.root,
        dot: false,
        unique: true,
        ignore: [...ignorePatterns],
      });

      const failures: string[] = [];
      const rewrites: Array<{ path: string; contents: string }> = [];
      const isFix = context.mode === "fix";

      for (const relativePath of packagePaths) {
        const pkgPath = joinPaths(context.root, relativePath);
        const pkgJson = await readJsonFile<Record<string, unknown>>(
          pkgPath,
        ).catch(() => undefined);

        if (!pkgJson || typeof pkgJson !== "object") {
          failures.push(`${relativePath}: unable to read package.json`);
          continue;
        }

        let updated = false;

        for (const section of sections) {
          const deps = (pkgJson as Record<string, unknown>)[section];
          if (!deps || typeof deps !== "object") continue;

          for (const [depName, version] of Object.entries(
            deps as Record<string, unknown>,
          )) {
            if (allowlist.length && micromatch.isMatch(depName, allowlist)) {
              continue;
            }

            if (isCatalogVersion(version) || isWorkspaceVersion(version)) {
              continue;
            }

            const catalogName = catalogLookup.byPackage.get(depName);
            if (catalogName && isFix) {
              (deps as Record<string, string>)[depName] =
                `catalog:${catalogName}`;
              updated = true;
              continue;
            }

            if (catalogName) {
              failures.push(
                `${relativePath}: ${section} '${depName}' should use catalog:${catalogName}`,
              );
              continue;
            }

            failures.push(
              `${relativePath}: ${section} '${depName}' has non-catalog version '${String(
                version,
              )}'. Add it to root catalogs or allowlist it.`,
            );
          }
        }

        if (updated) {
          const next = `${JSON.stringify(pkgJson, null, 2)}\n`;
          rewrites.push({ path: pkgPath, contents: next });
        }
      }

      for (const rewrite of rewrites) {
        await writeTextFile(rewrite.path, rewrite.contents);
      }

      if (failures.length === 0) {
        return { status: "passed" };
      }

      return {
        status: "failed",
        messages: failures,
      };
    },
  };
