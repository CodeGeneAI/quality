import path from "path";
import fg from "../../utils/bun-glob";
import { DEFAULT_GLOB_IGNORE, mergeIgnorePatterns } from "../../utils/glob";
import type { StageAdapter } from "../types";

export interface DockerfileRequiredAdapterOptions {
  /**
   * Directory globs whose package.json-bearing descendants must each ship
   * a Dockerfile. Each glob is expanded against the workspace root and
   * filtered to entries that contain a package.json — non-runnable dirs
   * are ignored.
   * @default ["apps/*", "services/*"]
   */
  readonly packageGlobs?: readonly string[];

  /**
   * Additional directories that must contain a Dockerfile even though they
   * are not picked up by `packageGlobs` (e.g. `packages/ui`, which is a
   * library by convention but ships a deployable showcase image).
   */
  readonly extraRequiredPaths?: readonly string[];

  /**
   * Required filename inside each target directory.
   * @default "Dockerfile"
   */
  readonly filename?: string;
}

export interface ResolvedDockerfileOptions {
  readonly packageGlobs: readonly string[];
  readonly extraRequiredPaths: readonly string[];
  readonly filename: string;
}

export interface IDockerfileTargetSource {
  readonly id: string;
  collect(
    root: string,
    options: ResolvedDockerfileOptions,
    ignorePatterns: readonly string[],
  ): Promise<readonly string[]>;
}

const DEFAULT_PACKAGE_GLOBS = ["apps/*", "services/*"] as const;
const DEFAULT_FILENAME = "Dockerfile";

export class PackageGlobTargetSource implements IDockerfileTargetSource {
  readonly id = "package-glob";

  async collect(
    root: string,
    options: ResolvedDockerfileOptions,
    ignorePatterns: readonly string[],
  ): Promise<readonly string[]> {
    if (options.packageGlobs.length === 0) {
      return [];
    }

    const packageJsonGlobs = options.packageGlobs.map(
      (glob) => `${glob.replace(/\/+$/, "")}/package.json`,
    );

    const matches = await fg(packageJsonGlobs, {
      cwd: root,
      dot: false,
      unique: true,
      ignore: [...ignorePatterns],
    });

    return matches.map((match) => path.dirname(match));
  }
}

export class ExplicitPathTargetSource implements IDockerfileTargetSource {
  readonly id = "explicit-path";

  // Intentionally does not consult `ignorePatterns`: paths in
  // `extraRequiredPaths` are user-declared requirements, not discovered
  // candidates. Silently dropping one because it matches a default ignore
  // pattern would be a footgun.
  async collect(
    _root: string,
    options: ResolvedDockerfileOptions,
  ): Promise<readonly string[]> {
    return options.extraRequiredPaths;
  }
}

export const createDefaultDockerfileTargetSources =
  (): readonly IDockerfileTargetSource[] => [
    new PackageGlobTargetSource(),
    new ExplicitPathTargetSource(),
  ];

const resolveOptions = (
  options: DockerfileRequiredAdapterOptions | undefined,
): ResolvedDockerfileOptions => ({
  packageGlobs: options?.packageGlobs ?? [...DEFAULT_PACKAGE_GLOBS],
  extraRequiredPaths: options?.extraRequiredPaths ?? [],
  filename: options?.filename ?? DEFAULT_FILENAME,
});

// Collapse a user- or glob-supplied path into a canonical, forward-slashed,
// root-relative form so the same directory under two different spellings
// (`apps/web`, `./apps/web/`, `apps\\web`) deduplicates correctly. Leading
// `..` segments that would escape the workspace root are preserved as-is
// — the adapter's escape guard recognizes them and reports the input as
// an invalid required path rather than silently probing outside the repo.
const normalizeRelativePath = (value: string): string => {
  const forwardSlashed = value.replace(/\\+/g, "/");
  const segments: string[] = [];
  let leadingUps = 0;
  for (const segment of forwardSlashed.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      } else {
        leadingUps += 1;
      }
      continue;
    }
    segments.push(segment);
  }
  const ups: string[] = [];
  for (let i = 0; i < leadingUps; i += 1) {
    ups.push("..");
  }
  return [...ups, ...segments].join("/");
};

export const createDockerfileRequiredAdapter = (
  sources: readonly IDockerfileTargetSource[] = createDefaultDockerfileTargetSources(),
): StageAdapter<DockerfileRequiredAdapterOptions> => ({
  type: "dockerfile-required",
  label: "Dockerfile presence guard",
  description:
    "Requires every app and service (plus explicit extraRequiredPaths) to ship a Dockerfile so each runnable workload owns a reproducible image contract.",
  supportsModes: ["check", "report"],
  supportsSandbox: true,
  supportsPartialFiles: false,

  async run(context) {
    const resolved = resolveOptions(context.options ?? undefined);
    const ignorePatterns = mergeIgnorePatterns(
      DEFAULT_GLOB_IGNORE,
      context.ignore,
    );

    const targets = new Map<string, string>();
    const invalid: Array<{ raw: string; sourceId: string }> = [];
    for (const source of sources) {
      const collected = await source.collect(
        context.root,
        resolved,
        ignorePatterns,
      );
      for (const candidate of collected) {
        const normalized = normalizeRelativePath(candidate);
        if (normalized.length === 0) continue;
        if (normalized === ".." || normalized.startsWith("../")) {
          // A path that resolves above the workspace root cannot be a
          // valid Dockerfile target. Surface it as a hard failure rather
          // than silently probing outside the repo.
          invalid.push({ raw: candidate, sourceId: source.id });
          continue;
        }
        if (!targets.has(normalized)) {
          targets.set(normalized, source.id);
        }
      }
    }

    if (targets.size === 0 && invalid.length === 0) {
      return { status: "passed" };
    }

    const missing: Array<{ path: string; sourceId: string }> = [];

    await Promise.all(
      Array.from(targets.entries()).map(async ([relativePath, sourceId]) => {
        const dockerfilePath = path.join(
          context.root,
          relativePath,
          resolved.filename,
        );
        // Bun.file().exists() returns false for directories, so a stray
        // dir named "Dockerfile" won't satisfy the check.
        if (!(await Bun.file(dockerfilePath).exists())) {
          missing.push({ path: relativePath, sourceId });
        }
      }),
    );

    if (missing.length === 0 && invalid.length === 0) {
      return { status: "passed" };
    }

    missing.sort((left, right) => left.path.localeCompare(right.path));
    invalid.sort((left, right) => left.raw.localeCompare(right.raw));

    const missingMessages = missing.map(
      ({ path: targetPath, sourceId }) =>
        `${targetPath}: missing ${resolved.filename} (required by ${sourceId}). ` +
        `Create ${targetPath}/${resolved.filename} that builds and runs this workload's image.`,
    );
    const invalidMessages = invalid.map(
      ({ raw, sourceId }) =>
        `${raw}: invalid required path (resolves above the workspace root, supplied by ${sourceId}).`,
    );

    return {
      status: "failed",
      messages: [...invalidMessages, ...missingMessages],
      details: { missing, invalid },
    };
  },
});

export const dockerfileRequiredAdapter = createDockerfileRequiredAdapter();
