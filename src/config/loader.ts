import fg from "../utils/bun-glob";
import { realpath } from "fs/promises";
import { parse } from "jsonc-parser";
import { ensureHooks } from "../pipeline/hooks";
import { ensureReporterSpecs } from "../reporters/registry";
import type { ReporterSpec } from "../reporters/types";
import { pathExists, readTextFile } from "../utils/fs";
import { mergeDeep } from "../utils/merge";
import { dirname, joinPaths, relativePath, resolvePath } from "../utils/path";
import type {
  FilesMode,
  LoadConfigOptions,
  QualityConfig,
  QualityHooksConfig,
  QualityProfileConfig,
  QualityStageSpec,
  ResolvedQualityProfile,
  ResolvedStage,
  ResolvedStageGroup,
  StageAdapterCatalogEntry,
  StageCatalogConfig,
  StageGroupConfig,
  StageGroupReference,
  StagePresetSpec,
} from "./types";

const CONFIG_FILENAMES = [".qualityrc.json", ".qualityrc.jsonc", ".qualityrc"];

const profileShardFilenames = (profile: string): string[] => [
  `.qualityrc.${profile}.json`,
  `.qualityrc.${profile}.jsonc`,
];

const mergeProfileMaps = (
  ...maps: Array<QualityConfig["profiles"] | undefined>
): QualityConfig["profiles"] => {
  const merged: QualityConfig["profiles"] = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [name, config] of Object.entries(map)) {
      merged[name] = config;
    }
  }
  return merged;
};

const discoverShardProfiles = async (
  directory: string,
): Promise<Set<string>> => {
  if (!(await pathExists(directory))) return new Set();
  const files = await fg([".qualityrc.*.json", ".qualityrc.*.jsonc"], {
    cwd: directory,
    dot: true,
  });
  const profiles = new Set<string>();
  for (const file of files) {
    const match = file.match(/\.qualityrc\.([^./]+)\.jsonc?$/);
    if (match?.[1]) profiles.add(match[1]);
  }
  return profiles;
};

const resolveExistingPath = async (value: string): Promise<string> => {
  try {
    return await realpath(value);
  } catch {
    return value;
  }
};

interface LoadedConfig {
  readonly directory: string;
  readonly path: string;
  readonly config: QualityConfig;
}

export interface ResolvedConfig {
  readonly root: string;
  readonly profile: ResolvedQualityProfile;
  readonly stageCatalog: StageCatalogConfig;
  readonly adapters: readonly string[];
  readonly ignore: readonly string[];
}

export const loadQualityConfig = async (
  options: LoadConfigOptions = {},
): Promise<ResolvedConfig> => {
  const root = await findWorkspaceRoot();
  const baseConfig = await loadConfigFromDirectory(root);
  if (!baseConfig) {
    throw new Error(
      "No .qualityrc configuration found. Run `quality init` or create a .qualityrc file at the repository root.",
    );
  }

  const shardDir = resolvePath(
    baseConfig.directory,
    options.shardDir ?? baseConfig.config.shardDir ?? "",
  );
  const shardProfiles = await discoverShardProfiles(shardDir);
  const profileName = resolveProfileName(
    baseConfig.config.profiles,
    shardProfiles,
    options.profile,
  );

  const shardOverrides: LoadedConfig[] = await loadAllProfileOverrides(
    shardDir,
    shardProfiles,
  );

  const targetOverrides = options.targetPaths
    ? await loadOverridesForTargets(root, options.targetPaths)
    : [];

  const overridesToApply: LoadedConfig[] = [
    ...shardOverrides,
    ...targetOverrides.filter((override): override is LoadedConfig =>
      Boolean(override),
    ),
  ];

  const allProfiles = mergeProfileMaps(
    baseConfig.config.profiles,
    ...overridesToApply.map((override) => override.config.profiles),
  );

  if (!allProfiles?.[profileName]) {
    throw new Error(
      `Profile '${profileName}' is not defined in base config or shards.`,
    );
  }

  const profileChain = await buildProfileChain(allProfiles, profileName);

  const mergedProfile = mergeProfiles(profileChain);
  let stageCatalog = cloneStageCatalog(baseConfig.config.stages ?? {});
  let rootHooks = baseConfig.config.hooks;
  let rootReporters = baseConfig.config.reporters;
  let resolvedFilesMode = mergedProfile.filesMode;
  let resolvedParallelLimit = mergedProfile.parallelLimit;
  let resolvedAutoFix = mergedProfile.autoFix;
  const ignorePatterns = new Set<string>(
    normalizeIgnorePatterns(baseConfig.config.ignore),
  );
  const adapterPaths = new Set<string>(
    resolveAdapterPaths(baseConfig.directory, baseConfig.config.adapters ?? []),
  );

  const applyOverride = async (override: LoadedConfig) => {
    stageCatalog = mergeStageCatalog(stageCatalog, override.config.stages);
    rootHooks = mergeHooks(rootHooks, override.config.hooks);
    rootReporters = override.config.reporters ?? rootReporters;
    const filesModeValue = override.config.profiles?.[profileName]?.filesMode;
    if (filesModeValue && typeof filesModeValue === "string") {
      resolvedFilesMode = filesModeValue;
    }
    if (
      typeof override.config.profiles?.[profileName]?.parallelLimit === "number"
    ) {
      resolvedParallelLimit =
        override.config.profiles[profileName]?.parallelLimit;
    }
    if (typeof override.config.profiles?.[profileName]?.autoFix === "boolean") {
      resolvedAutoFix = override.config.profiles[profileName]?.autoFix;
    }
    appendIgnorePatterns(ignorePatterns, override.config.ignore);
    for (const adapterPath of resolveAdapterPaths(
      override.directory,
      override.config.adapters ?? [],
    )) {
      adapterPaths.add(adapterPath);
    }
  };

  for (const override of overridesToApply) {
    await applyOverride(override);
  }

  if (options.targetPaths && options.targetPaths.length > 0) {
    const overrides = await loadOverridesForTargets(root, options.targetPaths);
    for (const override of overrides) {
      if (!override) continue;
      await applyOverride(override);
    }
  }

  const ignore = Array.from(ignorePatterns);
  const reporters = ensureReporterSpecs(
    mergedProfile.reporters ?? rootReporters ?? ["summary"],
  );

  const hooks = ensureHooks(mergeHooks(rootHooks, mergedProfile.hooks) ?? {});

  const resolvedPipeline = resolvePipelineStages(
    mergedProfile.pipeline ?? [],
    stageCatalog,
  );
  return {
    root,
    profile: {
      name: profileName,
      pipeline: resolvedPipeline,
      reporters,
      hooks,
      filesMode: resolvedFilesMode ?? mergedProfile.filesMode,
      parallelLimit: resolvedParallelLimit ?? mergedProfile.parallelLimit,
      autoFix: resolvedAutoFix ?? mergedProfile.autoFix ?? false,
    },
    stageCatalog,
    adapters: Array.from(adapterPaths),
    ignore,
  } satisfies ResolvedConfig;
};

const resolveProfileName = (
  profiles: QualityConfig["profiles"] | undefined,
  shardProfiles: ReadonlySet<string> = new Set(),
  preferred?: string,
): string => {
  if (preferred) return preferred;

  const hasProfile = (name: string | undefined): name is string =>
    Boolean(name && (profiles?.[name] || shardProfiles.has(name)));

  if (hasProfile("default")) return "default";
  if (hasProfile("local")) return "local";

  const firstBase = profiles ? Object.keys(profiles)[0] : undefined;
  if (hasProfile(firstBase)) return firstBase;

  const shardFirst = shardProfiles.values().next();
  if (!shardFirst.done) return shardFirst.value;

  throw new Error(
    ".qualityrc must define at least one profile (base config or shard).",
  );
};

const buildProfileChain = async (
  profiles: QualityConfig["profiles"] | undefined,
  profileName: string,
): Promise<QualityProfileConfig[]> => {
  const seen = new Set<string>();
  const chain: QualityProfileConfig[] = [];
  let currentName: string | undefined = profileName;
  while (currentName) {
    if (seen.has(currentName)) {
      throw new Error(
        `Circular profile inheritance detected for '${profileName}'.`,
      );
    }
    const profile: (QualityProfileConfig & { extends?: string }) | undefined =
      profiles?.[currentName];
    if (!profile) break;
    chain.unshift(profile);
    seen.add(currentName);
    currentName = profile.extends;
  }
  return chain;
};

const mergeProfiles = (
  chain: readonly QualityProfileConfig[],
): QualityProfileConfig => {
  let pipeline: QualityStageSpec[] = [];
  let reporters: readonly ReporterSpec[] | undefined;
  let hooks: QualityHooksConfig | undefined;
  let filesMode: FilesMode | undefined;
  let parallelLimit: number | undefined;
  let autoFix: boolean | undefined;

  for (const profile of chain) {
    if (profile.pipeline) {
      const strategy = profile.pipelineStrategy ?? "append";
      pipeline =
        strategy === "replace"
          ? [...profile.pipeline]
          : [...pipeline, ...profile.pipeline];
    }
    if (profile.reporters) {
      reporters = profile.reporters;
    }
    hooks = mergeHooks(hooks, profile.hooks);
    if (profile.filesMode) {
      filesMode = profile.filesMode;
    }
    if (typeof profile.parallelLimit === "number") {
      parallelLimit = profile.parallelLimit;
    }
    if (typeof profile.autoFix === "boolean") {
      autoFix = profile.autoFix;
    }
  }

  return {
    pipeline,
    reporters,
    hooks,
    filesMode,
    parallelLimit,
    autoFix,
  } satisfies QualityProfileConfig;
};

const normalizeIgnorePatterns = (patterns?: readonly string[]): string[] => {
  if (!patterns || patterns.length === 0) {
    return [];
  }
  return patterns
    .map((pattern) => pattern?.trim())
    .filter((pattern): pattern is string => Boolean(pattern?.length));
};

const appendIgnorePatterns = (
  target: Set<string>,
  patterns?: readonly string[],
): void => {
  for (const pattern of normalizeIgnorePatterns(patterns)) {
    target.add(pattern);
  }
};

const mergeHooks = (
  base: QualityHooksConfig | undefined,
  next: QualityHooksConfig | undefined,
): QualityHooksConfig | undefined => {
  if (!base) {
    return next ? { ...next } : undefined;
  }
  if (!next) {
    return base;
  }
  return {
    onStart: [...(base.onStart ?? []), ...(next.onStart ?? [])],
    onComplete: [...(base.onComplete ?? []), ...(next.onComplete ?? [])],
    onSuccess: [...(base.onSuccess ?? []), ...(next.onSuccess ?? [])],
    onStageFail: { ...base.onStageFail, ...next.onStageFail },
  } satisfies QualityHooksConfig;
};

const mergeStageCatalog = (
  base: StageCatalogConfig,
  next: StageCatalogConfig | undefined,
): StageCatalogConfig => {
  if (!next) {
    return base;
  }
  const result: StageCatalogConfig = { ...base };
  for (const [adapterType, entry] of Object.entries(next)) {
    if (!entry) continue;
    const existing = result[adapterType];
    result[adapterType] = mergeCatalogEntry(existing, entry);
  }
  return result;
};

const mergeCatalogEntry = (
  base: StageAdapterCatalogEntry | undefined,
  next: StageAdapterCatalogEntry,
): StageAdapterCatalogEntry => {
  if (!base) {
    return cloneCatalogEntry(next);
  }
  const presets = mergePresetMap(base.presets ?? {}, next.presets ?? {});
  return { presets } satisfies StageAdapterCatalogEntry;
};

const mergePresetMap = (
  base: Record<string, StagePresetSpec>,
  next: Record<string, StagePresetSpec>,
): Record<string, StagePresetSpec> => {
  const result: Record<string, StagePresetSpec> = {
    ...clonePresetMap(base),
  };
  for (const [presetName, preset] of Object.entries(next)) {
    const existing = result[presetName];
    if (!existing) {
      result[presetName] = { ...preset } satisfies StagePresetSpec;
      continue;
    }
    result[presetName] = mergePresetSpec(existing, preset);
  }
  return result;
};

const mergePresetSpec = (
  base: StagePresetSpec,
  next: StagePresetSpec,
): StagePresetSpec => ({
  extends: next.extends ?? base.extends,
  label: next.label ?? base.label,
  description: next.description ?? base.description,
  mode: next.mode ?? base.mode,
  files: next.files ?? base.files,
  group: next.group ?? base.group,
  continueOnError: next.continueOnError ?? base.continueOnError,
  if: next.if ?? base.if,
  reporters: next.reporters ?? base.reporters,
  options: mergeDeep(base.options ?? {}, next.options ?? {}),
});

const resolvePipelineStages = (
  pipeline: readonly QualityStageSpec[],
  catalog: StageCatalogConfig,
): ResolvedStage[] => pipeline.map((stage) => resolveStage(stage, catalog));

const resolveStage = (
  stage: QualityStageSpec,
  catalog: StageCatalogConfig,
): ResolvedStage => {
  if ("filesMode" in (stage as unknown as Record<string, unknown>)) {
    console.warn(
      `[quality] Stage '${stage.id}' defines unsupported property 'filesMode'. Use profile-level 'filesMode' or '--files-mode' instead.`,
    );
  }
  const preset = stage.preset
    ? resolvePreset(stage.type, stage.preset, catalog)
    : undefined;
  const group = resolveStageGroup(stage.group ?? preset?.group);
  const baseOptions = mergeDeep(preset?.options ?? {}, stage.overrides ?? {});
  const output = stage.output ?? preset?.output ?? (baseOptions as any).output;
  const options = output
    ? ({ ...baseOptions, output } as typeof baseOptions)
    : baseOptions;
  const continueOnError = resolveContinueOnError(stage, preset, group, options);
  const filesForInference = stage.files ?? preset?.files ?? [];
  const alwaysRun =
    stage.alwaysRun ?? preset?.alwaysRun ?? filesForInference.length === 0;
  return {
    id: stage.id,
    type: stage.type,
    preset: stage.preset,
    label: stage.label ?? preset?.label,
    description: stage.description ?? preset?.description,
    mode: stage.mode ?? preset?.mode,
    files: filesForInference,
    alwaysRun,
    group,
    continueOnError,
    if: stage.if ?? preset?.if,
    reporters: stage.reporters ?? preset?.reporters,
    options,
  } satisfies ResolvedStage;
};

const resolveContinueOnError = (
  stage: QualityStageSpec,
  preset: (StagePresetSpec & { options?: Record<string, unknown> }) | undefined,
  group: ResolvedStageGroup | undefined,
  options: Record<string, unknown>,
): boolean => {
  if (
    stage.type === "command" &&
    typeof (options as { abortPipelineOnFailure?: boolean })
      .abortPipelineOnFailure === "boolean"
  ) {
    return !(options as { abortPipelineOnFailure: boolean })
      .abortPipelineOnFailure;
  }
  if (typeof stage.continueOnError === "boolean") {
    return stage.continueOnError;
  }
  if (typeof preset?.continueOnError === "boolean") {
    return preset.continueOnError;
  }
  if (typeof group?.continueOnError === "boolean") {
    return group.continueOnError;
  }
  return false;
};

const resolveStageGroup = (
  reference: StageGroupReference | undefined,
): ResolvedStageGroup | undefined => {
  if (!reference) {
    return undefined;
  }
  if (typeof reference === "string") {
    return {
      id: reference,
      parallel: true,
      failFast: true,
    } satisfies ResolvedStageGroup;
  }
  const config = reference as StageGroupConfig;
  return {
    id: config.id,
    label: config.label,
    parallel: config.parallel ?? true,
    failFast: config.failFast ?? true,
    continueOnError: config.continueOnError,
  } satisfies ResolvedStageGroup;
};

const resolvePreset = (
  adapterType: string,
  presetName: string,
  catalog: StageCatalogConfig,
  stack: string[] = [],
): StagePresetSpec => {
  if (stack.includes(presetName)) {
    throw new Error(
      `Circular preset inheritance detected for '${adapterType}:${presetName}'.`,
    );
  }
  const adapterCatalog = catalog[adapterType];
  if (!adapterCatalog?.presets?.[presetName]) {
    throw new Error(
      `Preset '${presetName}' not found for adapter '${adapterType}'.`,
    );
  }
  const preset = adapterCatalog.presets[presetName];
  const parents = normalizeExtends(preset.extends);
  if (!parents.length) {
    return { ...preset };
  }
  const resolvedParents = parents.map((parent) =>
    resolvePreset(adapterType, parent, catalog, [...stack, presetName]),
  );
  const parentAggregate = resolvedParents.reduce(
    (acc, parent) => mergePresetSpec(acc, parent),
    createEmptyPreset(),
  );
  return mergePresetSpec(parentAggregate, preset);
};

const createEmptyPreset = (): StagePresetSpec => ({
  options: {},
});

const normalizeExtends = (value: StagePresetSpec["extends"]): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...(value as readonly string[])];
  }
  return [value as string];
};

const cloneStageCatalog = (catalog: StageCatalogConfig): StageCatalogConfig => {
  const result: StageCatalogConfig = {};
  for (const [adapterType, entry] of Object.entries(catalog)) {
    if (!entry) continue;
    result[adapterType] = cloneCatalogEntry(entry);
  }
  return result;
};

const cloneCatalogEntry = (
  entry: StageAdapterCatalogEntry,
): StageAdapterCatalogEntry => ({
  presets: entry.presets ? clonePresetMap(entry.presets) : undefined,
});

const clonePresetMap = (
  presets: Record<string, StagePresetSpec>,
): Record<string, StagePresetSpec> => {
  const result: Record<string, StagePresetSpec> = {};
  for (const [name, preset] of Object.entries(presets)) {
    result[name] = { ...preset };
  }
  return result;
};

const resolveAdapterPaths = (
  directory: string,
  adapters: readonly string[],
): string[] =>
  adapters.map((adapterPath) =>
    adapterPath.startsWith(".") || adapterPath.startsWith("/")
      ? resolvePath(joinPaths(directory, adapterPath))
      : adapterPath,
  );

const loadOverridesForTargets = async (
  root: string,
  targetPaths: readonly string[],
): Promise<(LoadedConfig | undefined)[]> => {
  const directories = new Set<string>();
  const normalizedRoot = await resolveExistingPath(root);
  for (const path of targetPaths) {
    const absolute = await resolveExistingPath(resolvePath(path));
    let current = absolute;
    while (current.startsWith(normalizedRoot)) {
      directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  const depthFromRoot = (value: string): number => {
    const relative = relativePath(normalizedRoot, value);
    if (!relative || relative === ".") {
      return 0;
    }
    return relative.split("/").filter(Boolean).length;
  };

  const orderedDirectories = Array.from(directories)
    .filter((directory) => directory !== normalizedRoot)
    .sort((left, right) => {
      const depthDelta = depthFromRoot(left) - depthFromRoot(right);
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return left.localeCompare(right);
    });

  const configs: (LoadedConfig | undefined)[] = [];
  for (const directory of orderedDirectories) {
    const override = await loadConfigFromDirectory(directory);
    if (override) {
      configs.push(override);
    }
  }
  return configs;
};

const loadConfigFromDirectory = async (
  directory: string,
): Promise<LoadedConfig | undefined> => {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = joinPaths(directory, filename);
    if (!(await pathExists(filePath))) {
      continue;
    }
    const raw = await readTextFile(filePath);
    const parsed = parse(raw) as QualityConfig;
    return { directory, path: filePath, config: parsed };
  }
  return undefined;
};

const loadProfileOverride = async (
  shardDir: string,
  profile: string,
): Promise<LoadedConfig | undefined> => {
  for (const filename of profileShardFilenames(profile)) {
    const filePath = joinPaths(shardDir, filename);
    if (!(await pathExists(filePath))) continue;
    const raw = await readTextFile(filePath);
    const parsed = parse(raw) as QualityConfig;
    return { directory: shardDir, path: filePath, config: parsed };
  }
  return undefined;
};

const loadAllProfileOverrides = async (
  shardDir: string,
  profiles: ReadonlySet<string>,
): Promise<LoadedConfig[]> => {
  const overrides: LoadedConfig[] = [];
  for (const profile of profiles) {
    const override = await loadProfileOverride(shardDir, profile);
    if (override) overrides.push(override);
  }
  return overrides;
};

const findWorkspaceRoot = async (): Promise<string> => {
  let current = resolvePath(process.cwd());
  while (true) {
    if (await pathExists(joinPaths(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate repository root.");
    }
    current = parent;
  }
};
