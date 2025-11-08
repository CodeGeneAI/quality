import { stripTemplateRepoPath } from "@codesynth-labs/forge-templates";
import path from "path";
import { runCommand } from "../../utils/process";
import type { StageAdapter } from "../types";

export interface MetadataVerifyAdapterOptions {
  readonly command?: readonly [string, ...string[]];
  readonly env?: Record<string, string>;
}

const DEFAULT_COMMAND: readonly [string, ...string[]] = [
  "bun",
  "run",
  "verify:metadata",
];

const METADATA_ROOT_SEGMENT = "metadata";
const ROOT_TEMPLATES_PREFIX = "templates/";

export const metadataVerifyAdapter: StageAdapter<MetadataVerifyAdapterOptions> =
  {
    type: "metadata-verify",
    label: "Scoped metadata validation",
    supportsModes: ["check"],
    supportsSandbox: false,
    supportsPartialFiles: true,
    async run(context) {
      const options = context.options ?? {};
      const command = options.command ?? DEFAULT_COMMAND;

      if (context.files.length === 0) {
        return {
          status: "skipped",
          messages: ["No metadata files changed; skipping validation."],
        };
      }

      const { templates, files, requireFullRun } = selectMetadataTargets(
        context.files,
      );

      const args = command.slice(1);
      const env = { ...options.env };
      if (!requireFullRun && templates.size > 0) {
        env.FORGE_METADATA_TEMPLATES = [...templates].sort().join(",");
        env.FORGE_METADATA_FILES = JSON.stringify([...files].sort());
      }

      const result = await runCommand({
        command: command[0],
        args,
        cwd: context.root,
        env,
      });

      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        return {
          status: "failed",
          messages: [
            `verify:metadata exited with code ${result.exitCode}`,
            ...(detail ? [detail] : []),
          ],
          details: {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          },
        };
      }

      if (!requireFullRun && templates.size === 0) {
        return {
          status: "skipped",
          messages: ["No metadata files changed; skipping validation."],
        };
      }

      return {
        status: "passed",
        messages: [
          requireFullRun
            ? "Validated metadata for all templates."
            : `Validated metadata for ${templates.size} template(s).`,
        ],
      };
    },
  };

const selectMetadataTargets = (
  files: readonly string[],
): {
  readonly templates: Set<string>;
  readonly files: Set<string>;
  readonly requireFullRun: boolean;
} => {
  if (files.length === 0) {
    return { templates: new Set(), files: new Set(), requireFullRun: true };
  }

  const templates = new Set<string>();
  const normalizedFiles = new Set<string>();
  let requireFullRun = false;

  for (const file of files) {
    const templateRelative = stripTemplatesPrefix(file);
    if (!templateRelative) {
      requireFullRun = true;
      continue;
    }
    const segments = templateRelative.split("/").filter(Boolean);
    if (segments.length < 3 || segments[1] !== METADATA_ROOT_SEGMENT) {
      requireFullRun = true;
      continue;
    }

    const templateId = segments[0];
    const category = segments[2];
    if (!category || segments[segments.length - 1] === "") {
      requireFullRun = true;
      continue;
    }

    if (!file.endsWith(".json")) {
      requireFullRun = true;
      continue;
    }

    templates.add(templateId);
    normalizedFiles.add(
      `${ROOT_TEMPLATES_PREFIX}${path.posix.join(...segments)}`,
    );
  }

  return { templates, files: normalizedFiles, requireFullRun };
};

const stripTemplatesPrefix = (filePath: string): string | null =>
  stripTemplateRepoPath(filePath);
