import fg from "fast-glob";
import { DEFAULT_GLOB_IGNORE } from "../../utils/glob";
import type { StageAdapter } from "../types";

type StructureRuleType = "require" | "disallow";

export interface StructureRule {
  readonly type: StructureRuleType;
  readonly glob: string;
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

    const failures: string[] = [];
    await Promise.all(
      rules.map(async (rule) => {
        const matches = await fg(rule.glob, {
          cwd: context.root,
          dot: true,
          ignore: DEFAULT_GLOB_IGNORE,
        });
        if (rule.type === "require" && matches.length === 0) {
          failures.push(
            rule.message ?? `Expected to find files matching '${rule.glob}'.`,
          );
        }
        if (rule.type === "disallow" && matches.length > 0) {
          failures.push(
            rule.message ??
              `Found disallowed files matching '${rule.glob}': ${matches
                .slice(0, 3)
                .join(", ")}${matches.length > 3 ? "…" : ""}`,
          );
        }
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
