import { statSync } from "fs";
import { stat } from "fs/promises";
import micromatch from "micromatch";
import { resolve } from "path";
import { normalizePath } from "./glob";

type GlobSource = string | readonly string[];

interface GlobOptions {
  readonly cwd?: string;
  readonly dot?: boolean;
  readonly ignore?: readonly string[];
  readonly unique?: boolean;
  readonly onlyDirectories?: boolean;
}

interface BunGlobLike {
  (source: GlobSource, options?: GlobOptions): Promise<string[]>;
  sync(source: GlobSource, options?: GlobOptions): string[];
}

const toPatternArray = (value: GlobSource): string[] =>
  Array.isArray(value) ? [...value] : [value as string];

const splitPatterns = (
  source: GlobSource,
  ignore: readonly string[] | undefined,
): { include: string[]; exclude: string[] } => {
  const include: string[] = [];
  const exclude: string[] = ignore ? [...ignore] : [];

  for (const pattern of toPatternArray(source)) {
    if (!pattern) continue;
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1).trim();
      if (negated) {
        exclude.push(negated);
      }
      continue;
    }
    include.push(pattern);
  }

  return { include, exclude };
};

const shouldExclude = (
  filePath: string,
  exclude: readonly string[],
  dot: boolean,
): boolean =>
  exclude.length > 0 &&
  micromatch.isMatch(filePath, exclude, {
    dot,
  });

const finalizeMatches = (
  matches: readonly string[],
  unique: boolean,
): string[] => {
  const normalized = matches.map((match) => normalizePath(match));
  const values = unique ? Array.from(new Set(normalized)) : [...normalized];
  values.sort((left, right) => left.localeCompare(right));
  return values;
};

const isDirectoryAsync = async (cwd: string, relativePath: string) => {
  try {
    const info = await stat(resolve(cwd, relativePath));
    return info.isDirectory();
  } catch {
    return false;
  }
};

const isDirectorySync = (cwd: string, relativePath: string) => {
  try {
    const info = statSync(resolve(cwd, relativePath));
    return info.isDirectory();
  } catch {
    return false;
  }
};

const runGlob = async (
  source: GlobSource,
  options: GlobOptions = {},
): Promise<string[]> => {
  const cwd = options.cwd ?? process.cwd();
  const dot = options.dot ?? false;
  const unique = options.unique !== false;
  const onlyDirectories = options.onlyDirectories === true;
  const { include, exclude } = splitPatterns(source, options.ignore);

  if (include.length === 0) {
    return [];
  }

  const matches: string[] = [];

  for (const pattern of include) {
    const glob = new Bun.Glob(pattern);
    for await (const candidate of glob.scan({
      cwd,
      dot,
      onlyFiles: !onlyDirectories,
    })) {
      const normalized = normalizePath(candidate);
      if (shouldExclude(normalized, exclude, dot)) {
        continue;
      }
      if (onlyDirectories && !(await isDirectoryAsync(cwd, normalized))) {
        continue;
      }
      matches.push(normalized);
    }
  }

  return finalizeMatches(matches, unique);
};

const runGlobSync = (
  source: GlobSource,
  options: GlobOptions = {},
): string[] => {
  const cwd = options.cwd ?? process.cwd();
  const dot = options.dot ?? false;
  const unique = options.unique !== false;
  const onlyDirectories = options.onlyDirectories === true;
  const { include, exclude } = splitPatterns(source, options.ignore);

  if (include.length === 0) {
    return [];
  }

  const matches: string[] = [];

  for (const pattern of include) {
    const glob = new Bun.Glob(pattern);
    for (const candidate of glob.scanSync({
      cwd,
      dot,
      onlyFiles: !onlyDirectories,
    })) {
      const normalized = normalizePath(candidate);
      if (shouldExclude(normalized, exclude, dot)) {
        continue;
      }
      if (onlyDirectories && !isDirectorySync(cwd, normalized)) {
        continue;
      }
      matches.push(normalized);
    }
  }

  return finalizeMatches(matches, unique);
};

const bunGlob = runGlob as BunGlobLike;
bunGlob.sync = runGlobSync;

export default bunGlob;
