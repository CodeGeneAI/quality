import {
  resolveTemplatePath,
  stripTemplateRepoPath,
} from "@codesynth-labs/forge-templates";
import { pathExists } from "../../utils/fs";
import { runCommand } from "../../utils/process";
import type { StageAdapter } from "../types";

export interface TemplateCheckAdapterOptions {
  readonly command?: readonly [string, ...string[]];
  readonly env?: Record<string, string>;
}

const SHARED_TEMPLATE_DIRS = new Set(["catalog", "shared-metadata", "testing"]);

const DEFAULT_COMMAND: readonly [string, ...string[]] = [
  "bun",
  "x",
  "forge",
  "template",
  "check",
];

export const templateCheckAdapter: StageAdapter<TemplateCheckAdapterOptions> = {
  type: "template-check",
  label: "Scoped template validation",
  supportsModes: ["check"],
  supportsSandbox: false,
  supportsPartialFiles: true,
  async run(context) {
    const options = context.options ?? {};
    const command = options.command ?? DEFAULT_COMMAND;

    if (context.files.length === 0) {
      return {
        status: "skipped",
        messages: ["No template files changed; skipping validation."],
      };
    }

    const { templates, requireFullRun } = await resolveTemplates(
      context.root,
      context.files,
    );

    const commandsToRun: Array<{ readonly template?: string }> = [];
    if (requireFullRun || templates.length === 0) {
      commandsToRun.push({});
    } else {
      for (const templateId of templates) {
        commandsToRun.push({ template: templateId });
      }
    }

    const messages: string[] = [];

    for (const entry of commandsToRun) {
      const args = buildArgs(command, entry.template);
      const binary = command[0];
      const result = await runCommand({
        command: binary,
        args: args,
        cwd: context.root,
        env: { ...options.env },
      });

      if (result.exitCode !== 0) {
        const summary = entry.template
          ? `forge template check --template ${entry.template}`
          : "forge template check";
        const detail = result.stderr.trim() || result.stdout.trim();
        return {
          status: "failed",
          messages: [
            `${summary} exited with code ${result.exitCode}`,
            ...(detail ? [detail] : []),
          ],
          details: {
            template: entry.template,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          },
        };
      }

      if (entry.template) {
        messages.push(`Validated template '${entry.template}'.`);
      } else {
        messages.push("Validated all templates.");
      }
    }

    if (commandsToRun.length === 0) {
      return {
        status: "skipped",
        messages: ["No template files matched known templates; skipping."],
      };
    }

    return {
      status: "passed",
      messages,
    };
  },
};

const buildArgs = (
  command: readonly [string, ...string[]],
  templateId: string | undefined,
): readonly string[] => {
  if (!templateId) {
    return command.slice(1);
  }
  return [...command.slice(1), "--template", templateId];
};

const resolveTemplates = async (
  _root: string,
  files: readonly string[],
): Promise<{
  readonly templates: string[];
  readonly requireFullRun: boolean;
}> => {
  if (files.length === 0) {
    return { templates: [], requireFullRun: true };
  }

  const templates = new Set<string>();
  let requireFullRun = false;

  for (const file of files) {
    const templateRelative = stripTemplatesPrefix(file);
    if (!templateRelative) {
      requireFullRun = true;
      continue;
    }
    const segments = templateRelative
      .split("/")
      .filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      requireFullRun = true;
      continue;
    }
    const templateId = segments[0];
    if (SHARED_TEMPLATE_DIRS.has(templateId)) {
      requireFullRun = true;
      continue;
    }
    const configPath = resolveTemplatePath(templateId, "template.config.json");
    if (await pathExists(configPath)) {
      templates.add(templateId);
    } else {
      requireFullRun = true;
    }
  }

  return { templates: [...templates].sort(), requireFullRun };
};

const stripTemplatesPrefix = (filePath: string): string | null =>
  stripTemplateRepoPath(filePath);
