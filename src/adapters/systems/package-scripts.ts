import fg from "fast-glob";
import { readJsonFile } from "../../utils/fs";
import { mergeIgnorePatterns } from "../../utils/glob";
import { joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

export interface PackageScriptsAdapterOptions {
  readonly packages?: readonly string[];
  readonly requiredScripts?: readonly {
    readonly name: string;
    readonly message?: string;
  }[];
}

const NODE_MODULES_IGNORE = ["**/node_modules/**"] as const;

export const packageScriptsAdapter: StageAdapter<PackageScriptsAdapterOptions> =
  {
    type: "package-scripts",
    label: "Validate required package.json scripts",
    supportsModes: ["check", "report"],
    supportsSandbox: true,
    supportsPartialFiles: false,
    async run(context) {
      const options = context.options ?? {};
      const packageGlobs = options.packages ?? [];
      const required = options.requiredScripts ?? [];
      if (packageGlobs.length === 0 || required.length === 0) {
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

      for (const relativePath of packagePaths) {
        const pkgPath = joinPaths(context.root, relativePath);
        const pkg = await readJsonFile<Record<string, unknown>>(pkgPath).catch(
          () => undefined,
        );
        if (!pkg || typeof pkg !== "object") {
          failures.push(`${relativePath}: unable to read package.json`);
          continue;
        }
        const scripts =
          (pkg as { scripts?: Record<string, string> }).scripts ?? {};
        for (const req of required) {
          if (!scripts || typeof scripts[req.name] !== "string") {
            failures.push(
              req.message
                ? `${relativePath}: missing script '${req.name}' — ${req.message}`
                : `${relativePath}: missing script '${req.name}'`,
            );
          }
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
