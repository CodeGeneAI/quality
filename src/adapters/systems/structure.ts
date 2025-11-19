import fg from "fast-glob";
import path from "path";
import { DEFAULT_GLOB_IGNORE, mergeIgnorePatterns } from "../../utils/glob";
import type { StageAdapter } from "../types";

type StructureRuleType = "require" | "disallow";

export interface StructureRule {
  readonly type: StructureRuleType;
  readonly glob: string | readonly string[];
  readonly perMatchGlob?: string | readonly string[];
  readonly perMatchKind?: "directory" | "file";
  readonly message?: string;
}

export interface StructureAdapterOptions {
  readonly rules?: readonly StructureRule[];
  readonly severity?: "error" | "warn";
}

export const structureAdapter: StageAdapter<StructureAdapterOptions> = {
  type: "structure",
  label: "Workspace structure validation",
  supportsModes: ["check", "report"],
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
    await Promise.all(
      rules.map(async (rule) => {
        const perMatchTargets = await resolvePerMatchTargets(
          rule,
          context.root,
          ignorePatterns,
        );
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
      return { status: "passed" };
    }

    if (context.mode === "report" || options.severity === "warn") {
      return {
        status: "passed",
        messages: failures,
      };
    }

    return {
      status: "failed",
      messages: failures,
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
