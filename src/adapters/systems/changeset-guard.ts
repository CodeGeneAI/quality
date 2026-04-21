import micromatch from "micromatch";
import { join } from "path";
import { pathExists, readJsonFile, readTextFile } from "../../utils/fs";
import { runGit, verifyGitRef } from "../../utils/git";
import {
  mapFilesToPackages,
  resolveWorkspacePackages,
} from "../../utils/workspace";
import type { StageAdapter } from "../types";

export interface ChangesetGuardOptions {
  readonly baseBranch?: string;
  readonly includePrivate?: boolean;
  readonly severity?: "warn" | "fail";
  readonly ignorePackages?: readonly string[];
  readonly changedFilePatterns?: readonly string[];
  readonly ignoreFilePatterns?: readonly string[];
}

interface ChangesetConfig {
  readonly ignore?: readonly string[];
  readonly baseBranch?: string;
}

const DEFAULT_BASE_BRANCH = "origin/main";
const DEFAULT_CHANGED_FILE_PATTERNS = ["src/**", "lib/**"];
const DEFAULT_IGNORE_FILE_PATTERNS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/fixtures/**",
  "**/*.md",
  "**/CHANGELOG.md",
  "**/.qualityrc*",
  "**/biome.json",
  "**/tsconfig*.json",
  "**/bunfig.toml",
];

const getCurrentBranch = async (root: string): Promise<string> => {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    allowFailure: true,
  });
  return result.stdout.trim();
};

const getChangedFiles = async (
  root: string,
  baseBranch: string,
): Promise<string[]> => {
  const result = await runGit(
    ["diff", "--name-only", "--diff-filter=ACMRD", `${baseBranch}...HEAD`],
    { cwd: root, allowFailure: true },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const readChangesetConfig = async (
  root: string,
): Promise<ChangesetConfig | undefined> => {
  const configPath = join(root, ".changeset", "config.json");
  if (!(await pathExists(configPath))) return undefined;
  try {
    return await readJsonFile<ChangesetConfig>(configPath);
  } catch {
    return undefined;
  }
};

/**
 * Extract new changeset .md files from the branch diff.
 * Only files added/modified in `.changeset/` on THIS branch count —
 * pre-existing files from main are irrelevant.
 */
const getNewChangesetFiles = (changedFiles: readonly string[]): string[] =>
  changedFiles.filter(
    (f) =>
      f.startsWith(".changeset/") &&
      f.endsWith(".md") &&
      f !== ".changeset/README.md",
  );

/**
 * Parse changeset frontmatter to extract covered package names.
 * Returns an empty set for `changeset --empty` (the official opt-out),
 * which has frontmatter `---\n---` with no package entries.
 * Returns `null` for empty changesets to signal explicit opt-out.
 */
const parseChangesetPackages = async (
  root: string,
  changesetPath: string,
): Promise<{ packages: Set<string>; isEmpty: boolean }> => {
  const fullPath = join(root, changesetPath);
  try {
    const content = await readTextFile(fullPath);
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { packages: new Set(), isEmpty: false };

    const frontmatter = match[1].trim();
    if (frontmatter.length === 0) {
      // `changeset --empty` produces empty frontmatter — explicit opt-out
      return { packages: new Set(), isEmpty: true };
    }

    const packages = new Set<string>();
    for (const line of frontmatter.split("\n")) {
      // Format: "@scope/name": patch  OR  "@scope/name": minor  etc.
      // Also handles unquoted: @scope/name: patch
      const pkgMatch = line.match(
        /^['"]?(@?[^'":\s]+(?:\/[^'":\s]+)?)['"]?\s*:/,
      );
      if (pkgMatch) {
        packages.add(pkgMatch[1]);
      }
    }
    return { packages, isEmpty: false };
  } catch {
    return { packages: new Set(), isEmpty: false };
  }
};

const filterMeaningfulFiles = (
  files: readonly string[],
  packageDir: string,
  changedFilePatterns: readonly string[],
  ignoreFilePatterns: readonly string[],
): string[] => {
  return files.filter((file) => {
    const relativeToPackage = file.startsWith(`${packageDir}/`)
      ? file.slice(packageDir.length + 1)
      : file;

    const matchesChanged = micromatch.isMatch(
      relativeToPackage,
      changedFilePatterns,
    );
    if (!matchesChanged) return false;

    const matchesIgnore = micromatch.isMatch(
      relativeToPackage,
      ignoreFilePatterns,
    );
    return !matchesIgnore;
  });
};

const formatWarningMessages = (
  uncoveredPackages: Array<{ name: string; dir: string }>,
): string[] => {
  const messages: string[] = [];
  messages.push("Missing changeset for changed packages:");
  for (const pkg of uncoveredPackages) {
    messages.push(`  - ${pkg.name} (${pkg.dir})`);
  }
  messages.push("");
  messages.push("To add:     bun x changeset add");
  messages.push(
    'Quick add:  bun x changeset add --message "Describe your change"',
  );
  return messages;
};

export const changesetGuardAdapter: StageAdapter<ChangesetGuardOptions> = {
  type: "changeset-guard",
  label: "Changeset requirement check",
  supportsModes: ["check"],
  supportsSandbox: false,
  supportsPartialFiles: false,

  async run(context) {
    const options = context.options ?? {};

    if (context.abortSignal.aborted) {
      return { status: "skipped", messages: ["Aborted."] };
    }

    const baseBranch = options.baseBranch ?? DEFAULT_BASE_BRANCH;
    const includePrivate = options.includePrivate !== false;
    const severity = options.severity ?? "warn";
    const changedFilePatterns =
      options.changedFilePatterns ?? DEFAULT_CHANGED_FILE_PATTERNS;
    const ignoreFilePatterns =
      options.ignoreFilePatterns ?? DEFAULT_IGNORE_FILE_PATTERNS;

    // Skip on main branch or detached HEAD
    const currentBranch = await getCurrentBranch(context.root);
    if (currentBranch === "main" || currentBranch === "HEAD") {
      return {
        status: "skipped",
        messages: [
          currentBranch === "HEAD"
            ? "Skipped: detached HEAD."
            : "Skipped: on main branch.",
        ],
      };
    }

    // Verify base ref exists
    const baseExists = await verifyGitRef(context.root, baseBranch);
    if (!baseExists) {
      return {
        status: "skipped",
        messages: [
          `Skipped: base ref "${baseBranch}" not found. Fetch or set a valid baseBranch.`,
        ],
      };
    }

    // Get changed files in this branch
    const changedFiles = await getChangedFiles(context.root, baseBranch);
    if (changedFiles.length === 0) {
      return { status: "passed", messages: [] };
    }

    // Resolve workspace packages
    const workspacePackages = await resolveWorkspacePackages(context.root);

    // Read changeset config for ignore list
    const changesetConfig = await readChangesetConfig(context.root);
    const configIgnore = changesetConfig?.ignore ?? [];
    const allIgnored = new Set([
      ...configIgnore,
      ...(options.ignorePackages ?? []),
    ]);

    // Map changed files to packages
    const filesByPackage = mapFilesToPackages(workspacePackages, changedFiles);

    // Determine which packages have meaningful changes
    const affectedPackages: Array<{ name: string; dir: string }> = [];

    for (const [pkgName, files] of filesByPackage) {
      if (allIgnored.has(pkgName)) continue;

      const pkg = workspacePackages.find((p) => p.name === pkgName);
      if (pkg?.isPrivate && !includePrivate) continue;

      const meaningful = filterMeaningfulFiles(
        files,
        pkg?.dir ?? "",
        changedFilePatterns,
        ignoreFilePatterns,
      );

      if (meaningful.length > 0) {
        affectedPackages.push({ name: pkgName, dir: pkg?.dir ?? "" });
      }
    }

    if (affectedPackages.length === 0) {
      return { status: "passed", messages: [] };
    }

    // Check NEW changeset files added in this branch's diff (not pre-existing on main)
    const newChangesetFiles = getNewChangesetFiles(changedFiles);

    if (newChangesetFiles.length > 0) {
      // Parse all changeset files in parallel
      const parsedChangesets = await Promise.all(
        newChangesetFiles.map((csFile) =>
          parseChangesetPackages(context.root, csFile),
        ),
      );

      const coveredPackages = new Set<string>();
      let hasEmptyChangeset = false;

      for (const parsed of parsedChangesets) {
        if (parsed.isEmpty) {
          // `changeset --empty` is the official opt-out — pass immediately
          hasEmptyChangeset = true;
          break;
        }
        for (const pkg of parsed.packages) {
          coveredPackages.add(pkg);
        }
      }

      if (hasEmptyChangeset) {
        return { status: "passed", messages: [] };
      }

      // Filter to only uncovered packages
      const uncovered = affectedPackages.filter(
        (pkg) => !coveredPackages.has(pkg.name),
      );

      if (uncovered.length === 0) {
        return { status: "passed", messages: [] };
      }

      // Some packages are uncovered
      const messages = formatWarningMessages(uncovered);
      return {
        status: severity === "fail" ? "failed" : "passed",
        messages,
      };
    }

    // No new changeset files at all
    const messages = formatWarningMessages(affectedPackages);

    if (severity === "fail") {
      return { status: "failed", messages };
    }

    return { status: "passed", messages };
  },
};
