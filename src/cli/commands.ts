import { Command, Option } from "clipanion";
import { registerBuiltInAdapters } from "../adapters/register-builtins";
import {
  listAdapters,
  loadAdapterModule,
  resetAdapters,
} from "../adapters/registry";
import type { ResolvedConfig } from "../config/loader";
import { loadQualityConfig } from "../config/loader";
import type { ResolvedStage } from "../config/types";
import { runPipeline } from "../pipeline/runner";
import { ensureReporterDefinitions } from "../reporters/registry";
import type { ReporterDefinition } from "../reporters/types";
import { executeGitHook, isStageFixable } from "../runtime/git-hook-runner";
import { createConsoleProgressReporter } from "../runtime/progress";
import { isTelemetryEnabled } from "../runtime/telemetry";
import { installHooks, listHooks, uninstallHooks } from "./git-hooks";

export abstract class QualityBaseCommand extends Command {
  profile = Option.String("--profile", { required: false });
  jsonPath = Option.String("--json", { required: false });
  reporter = Option.Array("--reporter");
  stage = Option.Array("--stage");
  files = Option.Array("--files");
  telemetry = Option.String("--telemetry");
  telemetryFile = Option.String("--telemetry-file");
  debugFlag = Option.Boolean("--debug", false);
  showCommandOutputFlag = Option.Boolean("--show-command-output", false);

  protected buildReporterDefinitions(
    defaults: readonly ReporterDefinition[],
  ): ReporterDefinition[] {
    const reporters = [...defaults];
    const overrides = this.collectReporterOverrides();
    if (overrides) {
      reporters.push(...overrides);
    }
    return ensureReporterDefinitions(reporters);
  }

  protected collectReporterOverrides(): ReporterDefinition[] | undefined {
    const overrides: ReporterDefinition[] = [];
    if (this.jsonPath) {
      overrides.push(["json", { path: this.jsonPath }]);
    }
    for (const reporterName of this.reporter ?? []) {
      overrides.push(reporterName as ReporterDefinition);
    }
    return overrides.length > 0 ? overrides : undefined;
  }

  protected async loadConfig(
    targetPaths: readonly string[] | undefined,
  ): Promise<ResolvedConfig> {
    this.applyDebugOptions();
    const config = await loadQualityConfig({
      profile: this.profile,
      targetPaths,
    });
    await this.prepareAdapters(config);
    return config;
  }

  protected applyDebugOptions(): void {
    if (this.telemetry) {
      process.env.QUALITY_TELEMETRY = this.telemetry;
    }
    if (this.telemetryFile) {
      process.env.QUALITY_TELEMETRY_FILE = this.telemetryFile;
    }
    if (this.debugFlag) {
      process.env.QUALITY_DEBUG = "1";
    }
    if (this.showCommandOutputFlag) {
      process.env.QUALITY_SHOW_ALL_OUTPUT = "1";
    }
  }

  private async prepareAdapters(config: ResolvedConfig): Promise<void> {
    resetAdapters();
    registerBuiltInAdapters();
    for (const adapterPath of config.adapters) {
      try {
        await loadAdapterModule(adapterPath);
      } catch (error) {
        throw new Error(
          `Failed to load adapter module '${adapterPath}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

export class QualityListCommand extends QualityBaseCommand {
  static paths = [["list"]];

  adaptersFlag = Option.Boolean("--adapters", false);

  async execute(): Promise<void> {
    const config = await this.loadConfig(undefined);

    if (this.adaptersFlag) {
      this.printAdapters(config);
      return;
    }

    this.printPipeline(config.profile.pipeline);
  }

  private printAdapters(config: ResolvedConfig): void {
    const adapters = listAdapters();
    this.context.stdout.write("Registered adapters:\n");
    for (const adapter of adapters) {
      const catalogEntry = config.stageCatalog[adapter.type];
      const presets = Object.entries(catalogEntry?.presets ?? {});
      const headerLabel = adapter.label ? `: ${adapter.label}` : "";
      const description = adapter.description
        ? ` — ${adapter.description}`
        : "";
      this.context.stdout.write(
        ` - ${adapter.type}${headerLabel}${description}\n`,
      );
      if (adapter.supportsModes && adapter.supportsModes.length > 0) {
        this.context.stdout.write(
          `   Modes: ${adapter.supportsModes.join(", ")}\n`,
        );
      }
      if (presets.length > 0) {
        this.context.stdout.write("   Presets:\n");
        for (const [name, preset] of presets) {
          const labelParts = [name];
          if (preset.label) {
            labelParts.push(`(${preset.label})`);
          }
          const summary = labelParts.join(" ");
          const presetDescription = preset.description
            ? ` — ${preset.description}`
            : "";
          this.context.stdout.write(`     • ${summary}${presetDescription}\n`);
        }
      }
    }
  }

  private printPipeline(stages: readonly ResolvedStage[]): void {
    if (stages.length === 0) {
      this.context.stdout.write(
        "No stages configured in the selected profile.\n",
      );
      return;
    }
    this.context.stdout.write("Resolved pipeline:\n");
    stages.forEach((stage, index) => {
      const groupLabel = stage.group
        ? ` [group: ${stage.group.id}${stage.group.label ? ` (${stage.group.label})` : ""}]`
        : "";
      const presetLabel = stage.preset ? ` (preset: ${stage.preset})` : "";
      this.context.stdout.write(
        ` ${index + 1}. ${stage.id} <${stage.type}>${presetLabel}${groupLabel}\n`,
      );
    });
  }
}

export class QualityRunCommand extends QualityBaseCommand {
  static paths = [["check"], ["fix"]];

  async execute(): Promise<number | void> {
    const mode = this.path?.[0] === "fix" ? "fix" : "check";
    const files = this.files ?? [];
    const config = await this.loadConfig(files);

    const reporters = this.buildReporterDefinitions(config.profile.reporters);
    const pipeline = filterStages(config.profile.pipeline, this.stage);

    if (pipeline.length === 0) {
      this.context.stdout.write("No matching stages to execute.\n");
      return 0;
    }

    const progress = createConsoleProgressReporter({
      profile: config.profile.name,
      stages: pipeline,
    });

    const telemetryEnabled = isTelemetryEnabled();
    const buildTelemetry = (phase: "check" | "fix" | "verify") =>
      telemetryEnabled
        ? {
            context: `cli:${phase}:${config.profile.name}`,
            metadata: {
              mode: phase,
              profile: config.profile.name,
              stages: pipeline.map((stage) => stage.id),
            },
          }
        : undefined;

    const runWithSuppressedSummary = async <T>(
      executor: () => Promise<T>,
    ): Promise<T> => {
      const previous = process.env.QUALITY_SUMMARY_SUPPRESS_STAGES;
      process.env.QUALITY_SUMMARY_SUPPRESS_STAGES = "1";
      try {
        return await executor();
      } finally {
        if (previous === undefined) {
          delete process.env.QUALITY_SUMMARY_SUPPRESS_STAGES;
        } else {
          process.env.QUALITY_SUMMARY_SUPPRESS_STAGES = previous;
        }
      }
    };

    let exitCode = 0;

    if (mode === "fix") {
      const fixableStages = collectFixableStages(pipeline);
      if (fixableStages.length > 0) {
        const fixPhase = progress.withPhase("fix");
        await runWithSuppressedSummary(() =>
          runPipeline({
            mode: "fix",
            files,
            config,
            reporterDefinitions: reporters,
            stages: fixableStages,
            telemetry: buildTelemetry("fix"),
            onStageStart: fixPhase.stageStarted,
            onStageComplete: fixPhase.stageCompleted,
          }),
        );
      }

      const verifyPhase = progress.withPhase("verify");
      const verifyResult = await runWithSuppressedSummary(() =>
        runPipeline({
          mode: "check",
          files,
          config,
          reporterDefinitions: reporters,
          stages: pipeline,
          telemetry: buildTelemetry("verify"),
          onStageStart: verifyPhase.stageStarted,
          onStageComplete: verifyPhase.stageCompleted,
        }),
      );

      progress.finish(verifyResult.success);
      exitCode = verifyResult.success ? 0 : 1;
    } else {
      const checkPhase = progress;
      const pipelineResult = await runWithSuppressedSummary(() =>
        runPipeline({
          mode: "check",
          files,
          config,
          reporterDefinitions: reporters,
          stages: pipeline,
          telemetry: buildTelemetry("check"),
          onStageStart: checkPhase.stageStarted,
          onStageComplete: checkPhase.stageCompleted,
        }),
      );

      progress.finish(pipelineResult.success);
      exitCode = pipelineResult.success ? 0 : 1;
    }

    process.exitCode = exitCode;
    return exitCode;
  }
}

export class QualityRunStageCommand extends QualityBaseCommand {
  static paths = [["run"]];

  mode = Option.String("--mode", "check");
  stageId = Option.String("--stage");

  async execute(): Promise<number | void> {
    if (!this.stageId) {
      throw new Error("--stage is required when using `quality run`.");
    }
    const files = this.files ?? [];
    const config = await this.loadConfig(files);
    const reporters = this.buildReporterDefinitions(config.profile.reporters);
    const requestedMode = normalizeMode(this.mode);
    const pipeline = filterStages(config.profile.pipeline, [this.stageId]).map(
      (stage) =>
        requestedMode === "report"
          ? ({ ...stage, mode: "report" } satisfies ResolvedStage)
          : stage,
    );

    if (pipeline.length === 0) {
      this.context.stdout.write(
        `No stage found with id '${this.stageId}' in profile '${config.profile.name}'.\n`,
      );
      process.exitCode = 1;
      return 1;
    }

    const progress = createConsoleProgressReporter({
      profile: config.profile.name,
      stages: pipeline,
    });

    const telemetryEnabled = isTelemetryEnabled();
    const buildTelemetry = (phase: "check" | "fix" | "verify") =>
      telemetryEnabled
        ? {
            context: `cli:run:${this.stageId}:${phase}`,
            metadata: {
              mode: phase,
              profile: config.profile.name,
              stage: this.stageId,
            },
          }
        : undefined;

    const runWithSuppressedSummary = async <T>(
      executor: () => Promise<T>,
    ): Promise<T> => {
      const previous = process.env.QUALITY_SUMMARY_SUPPRESS_STAGES;
      process.env.QUALITY_SUMMARY_SUPPRESS_STAGES = "1";
      try {
        return await executor();
      } finally {
        if (previous === undefined) {
          delete process.env.QUALITY_SUMMARY_SUPPRESS_STAGES;
        } else {
          process.env.QUALITY_SUMMARY_SUPPRESS_STAGES = previous;
        }
      }
    };

    const pipelineMode = requestedMode === "report" ? "check" : requestedMode;

    let exitCode = 0;

    if (pipelineMode === "fix") {
      const fixableStages = collectFixableStages(pipeline);
      if (fixableStages.length > 0) {
        const fixPhase = progress.withPhase("fix");
        await runWithSuppressedSummary(() =>
          runPipeline({
            mode: "fix",
            files,
            config,
            reporterDefinitions: reporters,
            stages: fixableStages,
            telemetry: buildTelemetry("fix"),
            onStageStart: fixPhase.stageStarted,
            onStageComplete: fixPhase.stageCompleted,
          }),
        );
      }

      const verifyPhase = progress.withPhase("verify");
      const verifyResult = await runWithSuppressedSummary(() =>
        runPipeline({
          mode: "check",
          files,
          config,
          reporterDefinitions: reporters,
          stages: pipeline,
          telemetry: buildTelemetry("verify"),
          onStageStart: verifyPhase.stageStarted,
          onStageComplete: verifyPhase.stageCompleted,
        }),
      );

      progress.finish(verifyResult.success);
      exitCode = verifyResult.success ? 0 : 1;
    } else {
      const phaseHooks =
        pipelineMode === "check" ? progress : progress.withPhase(pipelineMode);
      const pipelineResult = await runWithSuppressedSummary(() =>
        runPipeline({
          mode: pipelineMode,
          files,
          config,
          reporterDefinitions: reporters,
          stages: pipeline,
          telemetry: buildTelemetry("check"),
          onStageStart: phaseHooks.stageStarted,
          onStageComplete: phaseHooks.stageCompleted,
        }),
      );

      progress.finish(pipelineResult.success);
      exitCode = pipelineResult.success ? 0 : 1;
    }

    process.exitCode = exitCode;
    return exitCode;
  }
}

export class QualityHooksInstallCommand extends QualityBaseCommand {
  static paths = [["hooks", "install"]];

  force = Option.Boolean("--force", false);

  async execute(): Promise<void> {
    const config = await this.loadConfig(undefined);
    if (!config.gitHooksManage) {
      this.context.stdout.write(
        "gitHooks.manage is false; skipping hook installation.\n",
      );
      return;
    }
    const hookEntries = Object.entries(config.gitHooks);
    if (hookEntries.length === 0) {
      this.context.stdout.write("No git hooks defined in configuration.\n");
      return;
    }
    const results = await installHooks({
      root: config.root,
      hooks: config.gitHooks,
      force: this.force,
    });
    for (const result of results) {
      if (!result.managed) {
        this.context.stdout.write(
          `Skipped hook '${result.name}' because an existing script is unmanaged.\n`,
        );
        continue;
      }

      switch (result.status) {
        case "installed":
          this.context.stdout.write(`Installed hook '${result.name}'.\n`);
          break;
        case "updated":
          this.context.stdout.write(`Updated hook '${result.name}'.\n`);
          break;
        case "replaced":
          this.context.stdout.write(
            `Replaced existing hook '${result.name}'.\n`,
          );
          break;
        case "unchanged":
        default:
          this.context.stdout.write(
            `Hook '${result.name}' already installed; skipping.\n`,
          );
          break;
      }
    }
  }
}

export class QualityHooksUninstallCommand extends QualityBaseCommand {
  static paths = [["hooks", "uninstall"]];

  async execute(): Promise<void> {
    const config = await this.loadConfig(undefined);
    const hookNames = Object.keys(config.gitHooks);
    if (hookNames.length === 0) {
      this.context.stdout.write("No git hooks defined in configuration.\n");
      return;
    }
    const results = await uninstallHooks({
      root: config.root,
      hooks: hookNames,
    });
    for (const result of results) {
      if (result.managed) {
        this.context.stdout.write(`Removed hook '${result.name}'.\n`);
      } else {
        this.context.stdout.write(
          `Skipped hook '${result.name}' (not managed by quality).\n`,
        );
      }
    }
  }
}

export class QualityHooksListCommand extends QualityBaseCommand {
  static paths = [["hooks", "list"]];

  async execute(): Promise<void> {
    const config = await this.loadConfig(undefined);
    const hookNames = Object.keys(config.gitHooks);
    if (hookNames.length === 0) {
      this.context.stdout.write("No git hooks defined in configuration.\n");
      return;
    }
    const results = await listHooks({ root: config.root, hooks: hookNames });
    this.context.stdout.write("Managed hooks:\n");
    for (const result of results) {
      const status = result.managed ? "managed" : "unmanaged";
      this.context.stdout.write(` - ${result.name} (${status})\n`);
    }
  }
}

export class QualityGitHookCommand extends QualityBaseCommand {
  static paths = [["git-hook"]];

  hookName = Option.String({ required: true });

  async execute(): Promise<number | void> {
    const config = await this.loadConfig(undefined);
    const hookConfig = config.gitHooks[this.hookName];
    if (!hookConfig) {
      this.context.stderr.write(
        `Hook '${this.hookName}' is not defined in .qualityrc.\n`,
      );
      process.exitCode = 1;
      return 1;
    }
    try {
      const reporterOverrides = this.collectReporterOverrides();
      const result = await executeGitHook({
        hookName: this.hookName,
        hook: hookConfig,
        config,
        reporterOverrides,
      });
      if (result.skipped) {
        this.context.stdout.write(
          `Hook '${this.hookName}' skipped (no matching stages).\n`,
        );
      }
      const exitCode = result.success ? 0 : 1;
      process.exitCode = exitCode;
      return exitCode;
    } catch (error) {
      this.context.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return 1;
    }
  }
}

export class QualityInitCommand extends Command {
  static paths = [["init"]];

  cwd = Option.String("--cwd", process.cwd());

  async execute(): Promise<void> {
    const root = this.cwd;
    const target = `${root}/.qualityrc.json`;
    const file = Bun.file(target);
    if (await file.exists()) {
      this.context.stdout.write(".qualityrc already exists.\n");
      return;
    }
    const template = JSON.stringify(
      {
        $schema: "./packages/quality/schemas/qualityrc.schema.json",
        stages: {
          biome: {
            presets: {
              recommended: {
                label: "Biome (monorepo defaults)",
                group: {
                  id: "lint",
                  label: "Lint",
                  parallel: true,
                  failFast: true,
                },
              },
            },
          },
          command: {
            presets: {
              "docs:check": {
                label: "Docs lint",
                description:
                  "Runs documentation linting without blocking the pipeline",
                continueOnError: true,
                options: {
                  abortPipelineOnFailure: false,
                  commands: [
                    {
                      command: ["bun", "run", "docs:lint"],
                      label: "docs:lint",
                      continueOnError: true,
                    },
                  ],
                },
              },
            },
          },
        },
        profiles: {
          local: {
            pipeline: [
              {
                id: "lint:biome",
                type: "biome",
                preset: "recommended",
              },
              {
                id: "lint:imports",
                type: "imports",
                group: "lint",
              },
              {
                id: "lint:bun-native",
                type: "bun-native",
                group: "lint",
              },
              {
                id: "lint:filenames",
                type: "filenames",
                overrides: { severity: "error" },
              },
              {
                id: "lint:structure",
                type: "structure",
              },
              {
                id: "docs:check",
                type: "command",
                preset: "docs:check",
              },
            ],
            reporters: ["summary"],
            hooks: {
              onStart: ['echo "🚀 quality checks"'],
            },
          },
          ci: {
            extends: "local",
            pipeline: [
              {
                id: "ci:no-root-barrel",
                type: "no-root-barrel",
                overrides: { packages: ["packages/*"] },
              },
            ],
            reporters: ["summary", ["json", { path: "reports/quality.json" }]],
          },
        },
        gitHooks: {
          manage: true,
          hooks: {
            "pre-commit": {
              stages: ["lint:biome"],
              filesMode: "staged",
              autoFix: {
                enabled: true,
                safety: "confirm",
                rerunAfterFix: true,
                preserveCommitMetadata: true,
              },
            },
          },
        },
      },
      null,
      2,
    );
    await Bun.write(target, `${template}\n`);
    this.context.stdout.write("Created .qualityrc.json\n");
  }
}

export class QualityValidateCommand extends QualityBaseCommand {
  static paths = [["validate-config"]];

  async execute(): Promise<void> {
    const files = this.files ?? [];
    const config = await this.loadConfig(files);
    const stages = filterStages(config.profile.pipeline, this.stage);
    if (this.stage && this.stage.length > 0) {
      if (stages.length === 0) {
        this.context.stdout.write("[]\n");
        return;
      }
      this.context.stdout.write(
        JSON.stringify(stages.length === 1 ? stages[0] : stages, null, 2) +
          "\n",
      );
      return;
    }
    this.context.stdout.write(JSON.stringify(config.profile, null, 2) + "\n");
  }
}

const filterStages = (
  stages: readonly ResolvedStage[],
  ids: readonly string[] | undefined,
): readonly ResolvedStage[] => {
  if (!ids || ids.length === 0) {
    return stages;
  }
  const wanted = new Set(ids);
  return stages.filter((stage) => wanted.has(stage.id));
};

const normalizeMode = (
  value: string | undefined,
): "check" | "fix" | "report" => {
  if (value === "fix" || value === "report") {
    return value;
  }
  return "check";
};
export const collectFixableStages = (
  stages: readonly ResolvedStage[],
): ResolvedStage[] =>
  stages.filter((stage) => isStageFixable(stage) && stage.type !== "command");
