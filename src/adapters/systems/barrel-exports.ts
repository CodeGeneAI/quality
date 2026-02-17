import micromatch from "micromatch";
import { dirname } from "path";
import fg from "../../utils/bun-glob";
import { readJsonFile, readTextFile } from "../../utils/fs";
import { mergeIgnorePatterns } from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

export interface BarrelExportsAdapterOptions {
  /**
   * Glob patterns for package.json files to check.
   * @default ["packages/*\/package.json", "packages/**\/package.json"]
   */
  readonly packages?: readonly string[];
  /**
   * Peer dependencies that indicate this is a client package.
   * If a package has any of these in peerDependencies, it will be checked.
   * @default ["react", "react-dom"]
   */
  readonly clientPackageIndicators?: readonly string[];
  /**
   * Package names or glob patterns to ignore.
   * Matches against the package name from package.json.
   * @example ["@codegeneai/workflow-sdk", "@codegeneai/legacy-*"]
   */
  readonly ignore?: readonly string[];
}

interface PackageInfo {
  name: string;
  relativePath: string;
  packageDir: string;
}

const NODE_MODULES_IGNORE = ["**/node_modules/**"] as const;

/**
 * Check if a package name matches any of the ignore patterns.
 */
const isIgnoredPackage = (
  packageName: string,
  ignorePatterns: readonly string[],
): boolean => {
  if (ignorePatterns.length === 0) {
    return false;
  }
  return micromatch.isMatch(packageName, [...ignorePatterns]);
};

/**
 * Check if a package has any of the client indicators in its peerDependencies.
 */
const isClientPackage = (
  pkgJson: Record<string, unknown>,
  indicators: readonly string[],
): boolean => {
  const peerDeps = pkgJson.peerDependencies;
  if (!peerDeps || typeof peerDeps !== "object") {
    return false;
  }
  return indicators.some((indicator) =>
    Object.hasOwn(peerDeps as Record<string, unknown>, indicator),
  );
};

/**
 * Check if index.ts has actual exports (not just `export {};` or empty).
 */
const hasBarrelExports = (content: string): boolean => {
  // TODO(#237): Naive comment removal doesn't handle edge cases where comment-like
  // sequences appear inside string literals (e.g., `"/* not a comment */"` or
  // `"https://example.com"`). Low impact for barrel files but could cause false negatives.
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments
    .replace(/\/\/.*$/gm, ""); // Remove line comments

  // Check for export statements that aren't just `export {};`
  const exportStatements = withoutComments.match(
    /export\s+(?:\{[^}]*\}|\*|(?:default|const|let|var|function|class|type|interface)\s)/g,
  );

  if (!exportStatements) {
    return false;
  }

  // Filter out empty exports like `export {};` or `export { };`
  const nonEmptyExports = exportStatements.filter((exp) => {
    const emptyExportMatch = exp.match(/export\s+\{\s*\}/);
    return !emptyExportMatch;
  });

  return nonEmptyExports.length > 0;
};

export const barrelExportsAdapter: StageAdapter<BarrelExportsAdapterOptions> = {
  type: "barrel-exports",
  label: "Prevent barrel exports in client packages",
  supportsModes: ["check", "report"],
  supportsSandbox: true,
  supportsPartialFiles: false,
  async run(context) {
    const options = context.options ?? {};
    const packageGlobs = options.packages ?? [
      "packages/*/package.json",
      "packages/*/*/package.json",
      "packages/*/*/*/package.json",
    ];
    const clientIndicators = options.clientPackageIndicators ?? [
      "react",
      "react-dom",
    ];
    const packageIgnorePatterns = options.ignore ?? [];

    if (packageGlobs.length === 0) {
      return { status: "passed" };
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
    const clientPackages: PackageInfo[] = [];

    // First pass: identify client packages
    for (const relativePath of packagePaths) {
      const pkgPath = joinPaths(context.root, relativePath);
      const pkgJson = await readJsonFile<Record<string, unknown>>(
        pkgPath,
      ).catch(() => undefined);

      if (!pkgJson || typeof pkgJson !== "object") {
        continue;
      }

      if (isClientPackage(pkgJson, clientIndicators)) {
        const pkgName =
          typeof pkgJson.name === "string" ? pkgJson.name : relativePath;
        clientPackages.push({
          name: pkgName,
          relativePath,
          packageDir: dirname(relativePath),
        });
      }
    }

    // Second pass: check for barrel exports in client packages
    for (const pkg of clientPackages) {
      // Skip ignored packages
      if (isIgnoredPackage(pkg.name, packageIgnorePatterns)) {
        continue;
      }

      const indexPath = joinPaths(context.root, pkg.packageDir, "src/index.ts");

      let indexContent: string;
      try {
        indexContent = await readTextFile(indexPath);
      } catch {
        // No src/index.ts - that's fine, not a violation
        continue;
      }

      if (hasBarrelExports(indexContent)) {
        failures.push(
          `${pkg.name} (${pkg.packageDir}): Client package has barrel exports in src/index.ts. ` +
            "Use explicit subpath exports in package.json instead to enable tree-shaking. " +
            "Replace barrel exports with `export {};` and add subpath exports to package.json.",
        );
      }
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
