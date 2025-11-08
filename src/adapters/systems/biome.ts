import { joinPaths } from "../../utils/path";
import { runCommand } from "../../utils/process";
import type { StageAdapter } from "../types";

export interface BiomeAdapterOptions {
  readonly config?: string;
  readonly cache?: boolean;
  readonly flags?: readonly string[];
  readonly binary?: string;
}

export const biomeAdapter: StageAdapter<BiomeAdapterOptions> = {
  type: "biome",
  label: "Biome formatting and lint",
  supportsModes: ["check", "fix"],
  supportsSandbox: true,
  supportsPartialFiles: true,
  async run(context) {
    const options = context.options ?? {};
    const args = [
      "--bun",
      options.binary ?? "biome",
      "check",
      "--diagnostic-level",
      "error",
    ] as string[];

    if (options.config) {
      args.push("--config", joinPaths(context.root, options.config));
    }

    if (options.cache === false) {
      args.push("--no-cache");
    }

    if (context.mode === "fix") {
      args.push("--write");
    }

    if (options.flags?.length) {
      args.push(...options.flags);
    }

    if (context.files.length > 0) {
      args.push("--", ...context.files);
    }

    const result = await runCommand({
      command: "bunx",
      args,
      cwd: context.root,
      abortSignal: context.abortSignal,
    });

    if (result.terminated && result.terminationReason === "abort") {
      return {
        status: "skipped",
        messages: ["Biome execution aborted."],
      };
    }

    if (result.exitCode === 0) {
      return { status: "passed" };
    }

    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    return {
      status: "failed",
      messages: [stderr || stdout || "Biome reported violations."],
    };
  },
};
