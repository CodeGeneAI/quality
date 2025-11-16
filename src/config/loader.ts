import { parse } from "jsonc-parser";
import { ensureHooks } from "../pipeline/hooks";
import { ensureReporterDefinitions } from "../reporters/registry";
import type { ReporterDefinition } from "../reporters/types";
import { pathExists, readTextFile } from "../utils/fs";
import { mergeDeep } from "../utils/merge";
import { loadTsConfigModule } from "../utils/module-loader";
import { dirname, joinPaths, relativePath, resolvePath } from "../utils/path";
import type {
  AutoFixConfig,
  GitHookConfig,
  GitHooksConfig,
  LoadConfigOptions,
  QualityConfig,
  QualityHooksConfig,
  QualityProfileConfig,
  QualityStageDefinition,
  ResolvedAutoFixConfig,
  ResolvedGitHookConfig,
  ResolvedQualityProfile,
  ResolvedStage,
  ResolvedStageGroup,
  StageAdapterCatalogEntry,
  StageCatalogConfig,
  StageGroupConfig,
  StageGroupReference,
  StagePresetDefinition,
} from "./types";

const CONFIG_FILENAMES = [
  ".qualityrc.ts",
  ".qualityrc.cjs",
  ".qualityrc.mjs",
  ".qualityrc.json",
  ".qualityrc.jsonc",
  ".qualityrc",
];

interface LoadedConfig {
  readonly directory: string;
  readonly config: QualityConfig;
}

export interface ResolvedConfig {
  readonly root: string;
  readonly profile: ResolvedQualityProfile;
  readonly stageCatalog: StageCatalogConfig;
  readonly adapters: readonly string[];
  readonly gitHooksManage: boolean;
  readonly gitHooks: Record<string, ResolvedGitHookConfig>;
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

  const profileName = resolveProfileName(baseConfig.config, options.profile);
  const profileChain = await buildProfileChain(baseConfig.config, profileName);

  let mergedProfile = mergeProfiles(profileChain);
  let stageCatalog = cloneStageCatalog(baseConfig.config.stages ?? {});
  let rootHooks = baseConfig.config.hooks;
  let rootReporters = baseConfig.config.reporters;
  let gitHooksState = createGitHooksState(baseConfig.config.gitHooks);
  const adapterPaths = new Set<string>(
    resolveAdapterPaths(baseConfig.directory, baseConfig.config.adapters ?? []),
  );

  if (options.targetPaths && options.targetPaths.length > 0) {
    const overrides = await loadOverridesForTargets(root, options.targetPaths);
    for (const override of overrides) {
      if (!override) continue;
      const overrideProfileName = resolveProfileName(
        override.config,
        options.profile,
      );
      const overrideChain = await buildProfileChain(
        override.config,
        overrideProfileName,
      );
      mergedProfile = mergeProfiles([mergedProfile, ...overrideChain]);
      stageCatalog = mergeStageCatalog(stageCatalog, override.config.stages);
      rootHooks = mergeHooks(rootHooks, override.config.hooks);
      rootReporters = override.config.reporters ?? rootReporters;
      gitHooksState = mergeGitHooksState(
        gitHooksState,
        override.config.gitHooks,
      );
      for (const adapterPath of resolveAdapterPaths(
        override.directory,
        override.config.adapters ?? [],
      )) {
        adapterPaths.add(adapterPath);
      }
    }
  }

  const reporters = ensureReporterDefinitions(
    mergedProfile.reporters ?? rootReporters ?? ["summary"],
  );

  const hooks = ensureHooks(mergeHooks(rootHooks, mergedProfile.hooks) ?? {});

  const resolvedPipeline = resolvePipelineStages(
    mergedProfile.pipeline ?? [],
    stageCatalog,
  );

  const resolvedGitHooks = resolveGitHooksConfigs(gitHooksState, profileName);
  return {
    root,
    profile: {
      name: profileName,
      pipeline: resolvedPipeline,
      reporters,
      hooks,
    },
    stageCatalog,
    adapters: Array.from(adapterPaths),
    gitHooksManage: gitHooksState.manage ?? true,
    gitHooks: resolvedGitHooks,
  } satisfies ResolvedConfig;
};

const resolveProfileName = (
  config: QualityConfig,
  preferred?: string,
): string => {
  if (preferred && config.profiles[preferred]) {
    return preferred;
  }
  if (config.profiles.local) {
    return "local";
  }
  const [firstProfile] = Object.keys(config.profiles);
  if (!firstProfile) {
    throw new Error(".qualityrc must define at least one profile.");
  }
  return firstProfile;
};

const buildProfileChain = async (
  config: QualityConfig,
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
    const profile: QualityProfileConfig & { extends?: string } =
      config.profiles[currentName];
    if (!profile) {
      throw new Error(`Profile '${currentName}' not found in .qualityrc.`);
    }
    chain.unshift(profile);
    seen.add(currentName);
    currentName = profile.extends;
  }
  return chain;
};

const mergeProfiles = (
  chain: readonly QualityProfileConfig[],
): QualityProfileConfig => {
  if (chain.length === 0) {
    throw new Error("Cannot merge empty profile chain.");
  }

  let pipeline: QualityStageDefinition[] = [];
  let reporters: readonly ReporterDefinition[] | undefined;
  let hooks: QualityHooksConfig | undefined;

  for (const profile of chain) {
    if (profile.pipeline?.length) {
      pipeline = [...pipeline, ...profile.pipeline];
    }
    if (profile.reporters) {
      reporters = profile.reporters;
    }
    hooks = mergeHooks(hooks, profile.hooks);
  }

  return {
    pipeline,
    reporters,
    hooks,
  } satisfies QualityProfileConfig;
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
  base: Record<string, StagePresetDefinition>,
  next: Record<string, StagePresetDefinition>,
): Record<string, StagePresetDefinition> => {
  const result: Record<string, StagePresetDefinition> = {
    ...clonePresetMap(base),
  };
  for (const [presetName, preset] of Object.entries(next)) {
    const existing = result[presetName];
    if (!existing) {
      result[presetName] = { ...preset } satisfies StagePresetDefinition;
      continue;
    }
    result[presetName] = mergePresetDefinition(existing, preset);
  }
  return result;
};

const mergePresetDefinition = (
  base: StagePresetDefinition,
  next: StagePresetDefinition,
): StagePresetDefinition => ({
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
  pipeline: readonly QualityStageDefinition[],
  catalog: StageCatalogConfig,
): ResolvedStage[] => pipeline.map((stage) => resolveStage(stage, catalog));

const resolveStage = (
  stage: QualityStageDefinition,
  catalog: StageCatalogConfig,
): ResolvedStage => {
  const preset = stage.preset
    ? resolvePreset(stage.type, stage.preset, catalog)
    : undefined;
  const group = resolveStageGroup(stage.group ?? preset?.group);
  const options = mergeDeep(preset?.options ?? {}, stage.overrides ?? {});
  const continueOnError = resolveContinueOnError(stage, preset, group, options);
  return {
    id: stage.id,
    type: stage.type,
    preset: stage.preset,
    label: stage.label ?? preset?.label,
    description: stage.description ?? preset?.description,
    mode: stage.mode ?? preset?.mode,
    files: stage.files ?? preset?.files ?? [],
    group,
    continueOnError,
    if: stage.if ?? preset?.if,
    reporters: stage.reporters ?? preset?.reporters,
    options,
  } satisfies ResolvedStage;
};

const resolveContinueOnError = (
  stage: QualityStageDefinition,
  preset:
    | (StagePresetDefinition & { options?: Record<string, unknown> })
    | undefined,
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
): StagePresetDefinition => {
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
    (acc, parent) => mergePresetDefinition(acc, parent),
    createEmptyPreset(),
  );
  return mergePresetDefinition(parentAggregate, preset);
};

const createEmptyPreset = (): StagePresetDefinition => ({
  options: {},
});

const normalizeExtends = (
  value: StagePresetDefinition["extends"],
): string[] => {
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
  presets: Record<string, StagePresetDefinition>,
): Record<string, StagePresetDefinition> => {
  const result: Record<string, StagePresetDefinition> = {};
  for (const [name, preset] of Object.entries(presets)) {
    result[name] = { ...preset };
  }
  return result;
};

interface GitHooksState {
  readonly manage?: boolean;
  readonly hooks: Record<string, GitHookConfig>;
}

const createGitHooksState = (
  config: GitHooksConfig | undefined,
): GitHooksState => {
  if (!config) {
    return { hooks: {} } satisfies GitHooksState;
  }
  const hooks: Record<string, GitHookConfig> = {};
  if (config.hooks) {
    for (const [name, hook] of Object.entries(config.hooks)) {
      hooks[name] = cloneGitHookConfig(hook);
    }
  }
  return { manage: config.manage, hooks } satisfies GitHooksState;
};

const mergeGitHooksState = (
  base: GitHooksState,
  next: GitHooksConfig | undefined,
): GitHooksState => {
  if (!next) {
    return base;
  }
  const hooks = { ...base.hooks } as Record<string, GitHookConfig>;
  if (next.hooks) {
    for (const [name, hook] of Object.entries(next.hooks)) {
      const existing = hooks[name];
      hooks[name] = existing
        ? mergeGitHookConfig(existing, hook)
        : cloneGitHookConfig(hook);
    }
  }
  return {
    manage: typeof next.manage === "boolean" ? next.manage : base.manage,
    hooks,
  } satisfies GitHooksState;
};

const resolveGitHooksConfigs = (
  state: GitHooksState,
  defaultProfile: string,
): Record<string, ResolvedGitHookConfig> => {
  const resolved: Record<string, ResolvedGitHookConfig> = {};
  for (const [name, hook] of Object.entries(state.hooks)) {
    resolved[name] = {
      name,
      profile: hook.profile ?? defaultProfile,
      stages: hook.stages?.slice(),
      filesMode: hook.filesMode ?? "staged",
      timeoutMs: hook.timeoutMs,
      reporters: hook.reporters?.slice(),
      hooks: hook.hooks ? { ...hook.hooks } : undefined,
      autoFix: resolveAutoFixConfig(hook.autoFix),
      env: hook.env ? { ...hook.env } : undefined,
      onlyChangedStageGroups: hook.onlyChangedStageGroups,
    } satisfies ResolvedGitHookConfig;
  }
  return resolved;
};

const cloneGitHookConfig = (config: GitHookConfig): GitHookConfig => ({
  profile: config.profile,
  stages: config.stages?.slice(),
  filesMode: config.filesMode,
  timeoutMs: config.timeoutMs,
  reporters: config.reporters?.slice(),
  hooks: config.hooks ? { ...config.hooks } : undefined,
  autoFix: cloneAutoFixConfig(config.autoFix),
  env: config.env ? { ...config.env } : undefined,
  onlyChangedStageGroups: config.onlyChangedStageGroups,
});

const mergeGitHookConfig = (
  base: GitHookConfig,
  next: GitHookConfig,
): GitHookConfig => ({
  profile: next.profile ?? base.profile,
  stages: next.stages ?? base.stages,
  filesMode: next.filesMode ?? base.filesMode,
  timeoutMs: next.timeoutMs ?? base.timeoutMs,
  reporters: next.reporters ?? base.reporters,
  hooks: mergeHooks(base.hooks, next.hooks),
  autoFix: mergeAutoFixConfig(base.autoFix, next.autoFix),
  env: mergeEnv(base.env, next.env),
  onlyChangedStageGroups:
    typeof next.onlyChangedStageGroups === "boolean"
      ? next.onlyChangedStageGroups
      : base.onlyChangedStageGroups,
});

const cloneAutoFixConfig = (
  config: AutoFixConfig | undefined,
): AutoFixConfig | undefined => {
  if (!config) {
    return undefined;
  }
  return {
    enabled: config.enabled,
    amendCommit: config.amendCommit,
    safety: config.safety,
    rerunAfterFix: config.rerunAfterFix,
    preserveCommitMetadata: config.preserveCommitMetadata,
  } satisfies AutoFixConfig;
};

const mergeAutoFixConfig = (
  base: AutoFixConfig | undefined,
  next: AutoFixConfig | undefined,
): AutoFixConfig | undefined => {
  if (!base) {
    return cloneAutoFixConfig(next);
  }
  if (!next) {
    return cloneAutoFixConfig(base);
  }
  return {
    enabled: next.enabled ?? base.enabled,
    amendCommit: next.amendCommit ?? base.amendCommit,
    safety: next.safety ?? base.safety,
    rerunAfterFix: next.rerunAfterFix ?? base.rerunAfterFix,
    preserveCommitMetadata:
      next.preserveCommitMetadata ?? base.preserveCommitMetadata,
  } satisfies AutoFixConfig;
};

const resolveAutoFixConfig = (
  config: AutoFixConfig | undefined,
): ResolvedAutoFixConfig => ({
  enabled: config?.enabled ?? false,
  amendCommit: config?.amendCommit ?? false,
  safety: config?.safety ?? "confirm",
  rerunAfterFix: config?.rerunAfterFix ?? true,
  preserveCommitMetadata: config?.preserveCommitMetadata ?? true,
});

const mergeEnv = (
  base: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!base) {
    return next ? { ...next } : undefined;
  }
  if (!next) {
    return { ...base };
  }
  return { ...base, ...next };
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
  for (const path of targetPaths) {
    const absolute = resolvePath(path);
    let current = absolute;
    while (current.startsWith(root)) {
      directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  const depthFromRoot = (value: string): number => {
    const relative = relativePath(root, value);
    if (!relative || relative === ".") {
      return 0;
    }
    return relative.split("/").filter(Boolean).length;
  };

  const orderedDirectories = Array.from(directories)
    .filter((directory) => directory !== root)
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
    if (
      filename.endsWith(".ts") ||
      filename.endsWith(".mjs") ||
      filename.endsWith(".cjs")
    ) {
      const module = await loadTsConfigModule(filePath);
      return { directory, config: module.default as QualityConfig };
    }
    const raw = await readTextFile(filePath);
    const parsed = parse(raw) as QualityConfig;
    return { directory, config: parsed };
  }
  return undefined;
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
