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
    const args = ["--bun", options.binary ?? "biome"] as string[];

    if (context.mode === "fix") {
      // organizeImports is a lint rule; lint --write applies the fix.
      args.push("lint", "--write");
    } else {
      args.push("lint", "--diagnostic-level", "error");
    }

    if (options.config) {
      args.push("--config", joinPaths(context.root, options.config));
    }

    if (options.cache === false) {
      args.push("--no-cache");
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

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    const noFilesProcessed = /No files were processed/i.test(combinedOutput);

    if (result.exitCode !== 0 && noFilesProcessed) {
      return {
        status: "skipped",
        messages: ["Biome reported no files to process; skipping stage."],
      };
    }

    if (result.exitCode === 0) {
      return { status: "passed" };
    }

    return {
      status: "failed",
      messages: [
        combinedOutput || "Biome reported violations.",
      ],
    };
  },
};
