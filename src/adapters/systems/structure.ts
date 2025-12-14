import fg from "fast-glob";
import path from "path";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import type { StageAdapter } from "../types";

type StructureRuleType = "require" | "disallow" | "requireWithContent";

export interface StructureRule {
  readonly type: StructureRuleType;
  readonly glob?: string | readonly string[];
  readonly perMatchGlob?: string | readonly string[];
  readonly perMatchKind?: "directory" | "file";
  readonly message?: string;
  /** For requireWithContent */
  readonly paths?: string | readonly string[];
  readonly content?: string;
  readonly overwrite?: boolean;
}

export interface StructureAdapterOptions {
  readonly rules?: readonly StructureRule[];
  readonly severity?: "error" | "warn";
}

export const structureAdapter: StageAdapter<StructureAdapterOptions> = {
  type: "structure",
  label: "Workspace structure validation",
  supportsModes: ["check", "report", "fix"],
  supportsSandbox: true,
  supportsPartialFiles: false,
  async run(context) {
    const options = context.options ?? {};
    const rules = options.rules ?? [];
    if (rules.length === 0) {
      return { status: "passed" };
    }

    const globCache = new Map<string, string | string[]>();
    const ignorePatterns = mergeIgnorePatterns(
      DEFAULT_GLOB_IGNORE,
      context.ignore,
    );

    const failures: string[] = [];
    const infos: string[] = [];
    await Promise.all(
      rules.map(async (rule) => {
        if (rule.type === "requireWithContent") {
          await handleRequireWithContent({
            rule,
            context,
            ignorePatterns,
            failures,
            infos,
          });
          return;
        }

        const perMatchTargets = await resolvePerMatchTargets(
          rule,
          context.root,
          ignorePatterns,
        );
        if (!rule.glob) {
          failures.push(
            "Structure rule of type require/disallow is missing 'glob'.",
          );
          return;
        }
        const evaluatedTargets =
          perMatchTargets.size > 0 ? perMatchTargets : new Set(["."]);

        const globInput = normalizeGlobCached(globCache, rule.glob);
        await Promise.all(
          Array.from(evaluatedTargets).map(async (relativeRoot) => {
            const matches = await fg(globInput, {
              cwd: path.join(context.root, relativeRoot),
              dot: true,
              ignore: [...ignorePatterns],
            });
            const displayRoot =
              relativeRoot === "." ? "workspace root" : relativeRoot;

            if (rule.type === "require" && matches.length === 0) {
              failures.push(
                rule.message
                  ? `${rule.message} (${displayRoot})`
                  : `Expected to find files matching '${rule.glob}' in ${displayRoot}.`,
              );
            }
            if (rule.type === "disallow" && matches.length > 0) {
              const sample = matches.slice(0, 3).join(", ");
              failures.push(
                rule.message
                  ? `${rule.message} (${displayRoot})`
                  : `Found disallowed files matching '${rule.glob}' in ${displayRoot}: ${sample}${matches.length > 3 ? "…" : ""}`,
              );
            }
          }),
        );
      }),
    );

    if (failures.length === 0) {
      return { status: "passed", messages: infos.length ? infos : undefined };
    }

    if (context.mode === "report" || options.severity === "warn") {
      return {
        status: "passed",
        messages: [...failures, ...infos],
      };
    }

    return {
      status: "failed",
      messages: [...failures, ...infos],
    };
  },
};

const resolvePerMatchTargets = async (
  rule: StructureRule,
  root: string,
  ignorePatterns: readonly string[],
): Promise<Set<string>> => {
  if (!rule.perMatchGlob) {
    return new Set();
  }

  const perMatchKind = rule.perMatchKind ?? "directory";
  const perMatches = await fg(
    normalizeGlobCached(new Map(), rule.perMatchGlob),
    {
      cwd: root,
      dot: true,
      ignore: [...ignorePatterns],
      onlyDirectories: perMatchKind === "directory",
    },
  );

  const targets = new Set<string>();
  for (const match of perMatches) {
    const relative = perMatchKind === "file" ? path.dirname(match) : match;
    targets.add(relative === "" ? "." : relative);
  }
  return targets;
};

const normalizeGlobCached = (
  cache: Map<string, string | string[]>,
  pattern: string | readonly string[],
): string | string[] => {
  const key = Array.isArray(pattern) ? pattern.join("|") : String(pattern);
  const cached = cache.get(key);
  if (cached) return cached;
  const normalized = typeof pattern === "string" ? pattern : [...pattern];
  cache.set(key, normalized);
  return normalized;
};

const handleRequireWithContent = async ({
  rule,
  context,
  ignorePatterns,
  failures,
  infos,
}: {
  rule: StructureRule;
  context: Parameters<StageAdapter<StructureAdapterOptions>["run"]>[0];
  ignorePatterns: readonly string[];
  failures: string[];
  infos: string[];
}): Promise<void> => {
  const paths = normalizeGlobCached(new Map(), rule.paths ?? []);
  const targetPaths = Array.isArray(paths) ? paths : [paths];
  if (targetPaths.length === 0) {
    failures.push("requireWithContent rule missing 'paths'.");
    return;
  }
  const content = rule.content ?? "";
  const perMatchTargets = await resolvePerMatchTargets(
    rule,
    context.root,
    ignorePatterns,
  );
  const evaluatedTargets =
    perMatchTargets.size > 0 ? perMatchTargets : new Set(["."]);

  const createdOrUpdated: string[] = [];

  for (const relativeRoot of evaluatedTargets) {
    const displayRoot = relativeRoot === "." ? "workspace root" : relativeRoot;
    for (const relPath of targetPaths) {
      const joined = path.join(relativeRoot, relPath);
      if (shouldIgnorePath(joined, ignorePatterns)) {
        continue;
      }
      const absPath = path.join(context.root, joined);
      const file = Bun.file(absPath);
      const exists = await file.exists();
      if (!exists) {
        if (context.mode === "fix") {
          await Bun.write(absPath, content);
          createdOrUpdated.push(joined);
        } else {
          failures.push(
            rule.message
              ? `${rule.message} (${displayRoot})`
              : `Expected required file '${relPath}' in ${displayRoot}.`,
          );
        }
        continue;
      }

      if (rule.overwrite !== true) {
        continue;
      }

      const existing = await file.text();
      if (existing !== content) {
        if (context.mode === "fix") {
          await Bun.write(absPath, content);
          createdOrUpdated.push(joined);
        } else {
          failures.push(
            rule.message
              ? `${rule.message} (${displayRoot})`
              : `File '${relPath}' in ${displayRoot} differs from required content.`,
          );
        }
      }
    }
  }

  if (createdOrUpdated.length > 0) {
    const summary = `requireWithContent created/updated ${createdOrUpdated.length} file(s): ${createdOrUpdated.slice(0, 5).join(", ")}${
      createdOrUpdated.length > 5 ? "…" : ""
    }`;
    infos.push(summary);
  }
};
