import { Command, Option } from "clipanion";
import fg from "fast-glob";
import { readFile } from "fs/promises";
import { parse } from "jsonc-parser";
import path from "path";
import {
  analyzeTelemetryFile,
  collectFilesForMode,
  createConsoleProgressReporter,
  ensureReporterSpecs,
  type FileCollectionMode,
  type FilesMode,
  getAdapter,
  isTelemetryEnabled,
  listAdapters,
  loadAdapterModule,
  loadQualityConfig,
  type ParallelLimitSummary,
  type ReporterSpec,
  type ResolvedConfig,
  type ResolvedStage,
  registerBuiltInAdapters,
  resetAdapters,
  runPipeline,
  type StagePresetSpec,
} from "../index";

export abstract class QualityBaseCommand extends Command {
  profile = Option.String("--profile", { required: false });
  jsonPath = Option.String("--json", { required: false });
  reporter = Option.Array("--reporter");
  stage = Option.Array("--stage");
  files = Option.Array("--files");
  filesModeFlag = Option.String("--files-mode", { required: false });
  shardDir = Option.String("--shard-dir", { required: false });
  dryRunFlag = Option.Boolean("--dry-run", false);
  telemetry = Option.String("--telemetry");
  telemetryFile = Option.String("--telemetry-file");
  debugFlag = Option.Boolean("--debug", false);
  showCommandOutputFlag = Option.Boolean("--show-command-output", false);

  protected debugCleanup?: () => void;

  protected buildReporterSpecs(
    defaults: readonly ReporterSpec[],
  ): ReporterSpec[] {
    const reporters = [...defaults];
    const overrides = this.collectReporterOverrides();
    if (overrides) {
      reporters.push(...overrides);
    }
    return ensureReporterSpecs(reporters);
  }

  protected collectReporterOverrides(): ReporterSpec[] | undefined {
    const overrides: ReporterSpec[] = [];
    if (this.jsonPath) {
      overrides.push(["json", { path: this.jsonPath }]);
    }
    for (const reporterName of this.reporter ?? []) {
      overrides.push(reporterName as ReporterSpec);
    }
    return overrides.length > 0 ? overrides : undefined;
  }

  protected async loadConfig(
    targetPaths: readonly string[] | undefined,
  ): Promise<ResolvedConfig> {
    this.debugCleanup?.();
    this.debugCleanup = this.applyDebugOptions();
    const config = await loadQualityConfig({
      profile: this.profile,
      targetPaths,
      shardDir: this.shardDir,
    });
    await this.prepareAdapters(config);
    return config;
  }

  protected applyDebugOptions(): () => void {
    const envKeys = [
      "QUALITY_TELEMETRY",
      "QUALITY_TELEMETRY_FILE",
      "QUALITY_DEBUG",
      "QUALITY_SHOW_ALL_OUTPUT",
    ] as const;

    const previous = new Map<string, string | undefined>();
    for (const key of envKeys) {
      previous.set(key, process.env[key]);
    }

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

    return () => {
      for (const key of envKeys) {
        const prev = previous.get(key);
        if (prev === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prev;
        }
      }
    };
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
      const presets = Object.entries(catalogEntry?.presets ?? {}) as Array<
        [string, StagePresetSpec]
      >;
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
  static paths = [Command.Default, ["check"], ["fix"]];

  autoFixFlag = Option.Boolean("--auto-fix,-a", {
    description:
      "Run fixable stages before verification; use --no-auto-fix to opt out when a profile enables it by default.",
  });

  async execute(): Promise<number | void> {
    const dryRun = this.dryRunFlag;
    const invokedAsFix = this.path?.[0] === "fix";
    const filesMode = normalizeFilesMode(this.filesModeFlag);
    const config = await this.loadConfig(this.files);
    // Tri-state resolution: CLI flag → profile default → false.
    const profileAutoFix =
      typeof config.profile.autoFix === "boolean"
        ? config.profile.autoFix
        : false;
    const cliAutoFixPreference =
      this.autoFixFlag ?? (invokedAsFix ? true : undefined);
    const autoFixPreference = cliAutoFixPreference ?? profileAutoFix;
    const autoFixRequested = autoFixPreference && !dryRun;
    const cleanup = this.debugCleanup;

    const effectiveFiles = await resolveFilesInput({
      cliFiles: this.files ?? [],
      filesModeOverride: filesMode,
      configFilesMode: config.profile.filesMode,
      root: config.root,
    });

    const reporters = this.buildReporterSpecs(config.profile.reporters);
    const pipeline: ResolvedStage[] = [
      ...filterStages(config.profile.pipeline, this.stage),
    ];

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

    if (dryRun) {
      this.context.stdout.write("Dry run: listing files per stage only.\n");
    }

    if (autoFixRequested) {
      const fixableStages = collectFixableStages(pipeline);
      if (fixableStages.length === 0) {
        this.context.stdout.write(
          "Auto-fix requested but no stages in the pipeline support fixing. Proceeding with check-only.\n",
        );
      } else {
        const fixPhase = progress.withPhase("fix");
        await runWithSuppressedSummary(() =>
          runPipeline({
            mode: "fix",
            files: effectiveFiles,
            config,
            reporterSpecs: reporters,
            stages: fixableStages,
            dryRun,
            telemetry: buildTelemetry("fix"),
            onStageStart: fixPhase.stageStarted,
            onStageComplete: fixPhase.stageCompleted,
          }),
        );
      }
    }

    const verifyPhase = autoFixRequested
      ? progress.withPhase("verify")
      : progress;
    const pipelineResult = await runWithSuppressedSummary(() =>
      runPipeline({
        mode: "check",
        files: effectiveFiles,
        config,
        reporterSpecs: reporters,
        stages: pipeline,
        dryRun,
        telemetry: buildTelemetry(autoFixRequested ? "verify" : "check"),
        onStageStart: verifyPhase.stageStarted,
        onStageComplete: verifyPhase.stageCompleted,
      }),
    );

    progress.finish(pipelineResult.success);
    exitCode = pipelineResult.success ? 0 : 1;

    process.exitCode = exitCode;
    cleanup?.();
    return exitCode;
  }
}

export class QualityRunStageCommand extends QualityBaseCommand {
  static paths = [["run"]];

  mode = Option.String("--mode", "check");
  stageId = Option.String("--stage");
  dryRunFlag = Option.Boolean("--dry-run", false);

  async execute(): Promise<number | void> {
    if (!this.stageId) {
      throw new Error("--stage is required when using `quality run`.");
    }
    const filesMode = normalizeFilesMode(this.filesModeFlag);
    const dryRun = this.dryRunFlag;
    const config = await this.loadConfig(this.files);
    const cleanup = this.debugCleanup;
    const effectiveFiles = await resolveFilesInput({
      cliFiles: this.files ?? [],
      filesModeOverride: filesMode,
      configFilesMode: config.profile.filesMode,
      root: config.root,
    });
    const reporters = this.buildReporterSpecs(config.profile.reporters);
    const requestedMode = normalizeMode(this.mode);
    const pipeline: ResolvedStage[] = [
      ...filterStages(config.profile.pipeline, [this.stageId]),
    ].map((stage) =>
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

    const pipelineMode = dryRun
      ? "check"
      : requestedMode === "report"
        ? "check"
        : requestedMode;

    let exitCode = 0;

    if (pipelineMode === "fix") {
      const fixableStages = collectFixableStages(pipeline);
      if (fixableStages.length > 0) {
        const fixPhase = progress.withPhase("fix");
        await runWithSuppressedSummary(() =>
          runPipeline({
            mode: "fix",
            files: effectiveFiles,
            config,
            reporterSpecs: reporters,
            stages: fixableStages,
            dryRun,
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
          files: effectiveFiles,
          config,
          reporterSpecs: reporters,
          stages: pipeline,
          dryRun,
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
          files: effectiveFiles,
          config,
          reporterSpecs: reporters,
          stages: pipeline,
          dryRun,
          telemetry: buildTelemetry("check"),
          onStageStart: phaseHooks.stageStarted,
          onStageComplete: phaseHooks.stageCompleted,
        }),
      );

      progress.finish(pipelineResult.success);
      exitCode = pipelineResult.success ? 0 : 1;
    }

    process.exitCode = exitCode;
    cleanup?.();
    return exitCode;
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
    const stack = JSON.stringify(
      {
        $schema: "./packages/quality/schemas/qualityrc.schema.json",
        stages: {
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
            pipeline: [],
            reporters: ["summary", ["json", { path: "reports/quality.json" }]],
          },
          "pre-commit": {
            extends: "local",
            pipeline: [],
            reporters: ["summary"],
          },
          "pre-push": {
            extends: "local",
            pipeline: [],
            reporters: ["summary"],
          },
        },
      },
      null,
      2,
    );
    await Bun.write(target, `${stack}\n`);
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

export class QualityConfigValidateAllCommand extends QualityBaseCommand {
  static paths = [["config", "validate"]];

  async execute(): Promise<number | void> {
    const profiles = await discoverProfiles({ shardDir: this.shardDir });

    let ok = true;
    for (const name of profiles) {
      try {
        await loadQualityConfig({
          profile: name,
          targetPaths: this.files,
          shardDir: this.shardDir,
        });
        this.context.stdout.write(`✔ profile '${name}' valid\n`);
      } catch (err) {
        ok = false;
        this.context.stderr.write(
          `✖ profile '${name}' invalid: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    process.exitCode = ok ? 0 : 1;
    return ok ? 0 : 1;
  }
}

export class QualityConfigPrintCommand extends QualityBaseCommand {
  static paths = [["config", "print"]];

  compact = Option.Boolean("--compact", false);

  async execute(): Promise<void> {
    const config = await this.loadConfig(this.files);
    const pretty = !this.compact;
    const output = pretty
      ? JSON.stringify(config, null, 2)
      : JSON.stringify(config);
    this.context.stdout.write(`${output}\n`);
  }
}

export class QualityTelemetryAnalyzeCommand extends Command {
  static paths = [["telemetry", "analyze"]];

  filePath = Option.String("--file", { required: false });
  profile = Option.String("--profile", { required: false });
  contextIncludes = Option.String("--context", { required: false });
  successOnly = Option.Boolean("--success-only", false);
  jsonFlag = Option.Boolean("--json", false);

  async execute(): Promise<void> {
    const result = await analyzeTelemetryFile({
      filePath: this.filePath,
      profile: this.profile,
      contextIncludes: this.contextIncludes,
      successOnly: this.successOnly,
    });

    if (this.jsonFlag) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    this.printHumanSummary(result.buckets, result);
  }

  private printHumanSummary(
    buckets: readonly ParallelLimitSummary[],
    result: {
      totalEntries: number;
      analyzedEntries: number;
      discardedEntries: number;
    },
  ): void {
    console.log(
      `Analyzed ${result.analyzedEntries} entries (${result.discardedEntries} discarded, ${result.totalEntries} total)`,
    );

    if (buckets.length === 0) {
      console.log(
        "No telemetry entries contained stage timing metadata that matched the filters.",
      );
      return;
    }

    const headers = [
      "parallelLimit",
      "source",
      "runs",
      "success",
      "avg pipeline",
      "avg serial",
      "parallel ratio",
      "avg longest",
      "avg stages",
    ];
    const rows = buckets.map((bucket) => [
      bucket.limit ?? "unbound",
      bucket.source ?? "unspecified",
      bucket.samples,
      `${formatPercent(bucket.successRate)}%`,
      formatMs(bucket.averagePipelineDurationMs),
      formatMs(bucket.averageSerialDurationMs),
      formatRatio(bucket.parallelizationRatio),
      formatMs(bucket.averageLongestStageDurationMs),
      bucket.averageStagesPerRun.toFixed(1),
    ]);

    const widths = headers.map((header, columnIndex) =>
      Math.max(
        header.length,
        ...rows.map((row) => String(row[columnIndex]).length),
      ),
    );

    const renderRow = (cells: readonly unknown[]): string =>
      cells
        .map((cell, index) => String(cell).padEnd(widths[index], " "))
        .join("  ");

    console.log(renderRow(headers));
    for (const row of rows) {
      console.log(renderRow(row));
    }
  }
}

const formatMs = (value: number): string => `${Math.round(value)}ms`;
const formatPercent = (value: number): string => (value * 100).toFixed(1);
const formatRatio = (value: number): string =>
  value === 0 ? "n/a" : `x${value.toFixed(2)}`;

const BASE_CONFIG_FILENAMES = [
  ".qualityrc.json",
  ".qualityrc.jsonc",
  ".qualityrc",
];

const discoverProfiles = async ({
  shardDir,
}: {
  shardDir?: string | null;
}): Promise<Set<string>> => {
  const cwd = process.cwd();
  let basePath: string | undefined;
  for (const name of BASE_CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name);
    try {
      await readFile(candidate, "utf8");
      basePath = candidate;
      break;
    } catch (_) {}
  }
  if (!basePath) {
    throw new Error("Unable to locate base .qualityrc (json/jsonc) in cwd.");
  }
  const baseConfig = parse(await readFile(basePath, "utf8")) as any;
  const profiles = new Set<string>(Object.keys(baseConfig.profiles ?? {}));

  const shardBase = shardDir
    ? path.isAbsolute(shardDir)
      ? shardDir
      : path.join(path.dirname(basePath), shardDir)
    : path.dirname(basePath);
  const shardFiles = await fg([".qualityrc.*.json", ".qualityrc.*.jsonc"], {
    cwd: shardBase,
    dot: true,
  });
  for (const file of shardFiles) {
    const m = file.match(/\.qualityrc\.([^./]+)\.jsonc?$/);
    if (m) profiles.add(m[1]);
  }
  return profiles;
};

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

const normalizeFilesMode = (
  value: string | undefined,
): FilesMode | undefined =>
  value === "staged" || value === "workspace" || value === "commits"
    ? value
    : value === "none"
      ? "none"
      : undefined;

const dedupeFiles = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
};

const resolveFilesInput = async ({
  cliFiles,
  filesModeOverride,
  configFilesMode,
  root,
}: {
  readonly cliFiles: readonly string[];
  readonly filesModeOverride?: FilesMode;
  readonly configFilesMode?: FilesMode;
  readonly root: string;
}): Promise<string[]> => {
  if (cliFiles.length > 0) {
    return dedupeFiles(cliFiles);
  }

  const selectedMode = filesModeOverride ?? configFilesMode;
  if (!selectedMode || selectedMode === "none") {
    return [];
  }

  const files = await collectFilesForMode({
    root,
    mode: selectedMode as FileCollectionMode,
  });
  return dedupeFiles(files);
};

const isStageFixable = (stage: ResolvedStage): boolean => {
  const adapter = getAdapter(stage.type);
  return Boolean(
    adapter?.supportsModes && adapter.supportsModes.includes("fix" as const),
  );
};

export const collectFixableStages = (
  stages: readonly ResolvedStage[],
): ResolvedStage[] =>
  stages.filter((stage) => isStageFixable(stage) && stage.type !== "command");
