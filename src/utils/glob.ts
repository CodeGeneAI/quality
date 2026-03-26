import micromatch from "micromatch";

export const DEFAULT_GLOB_IGNORE = [
  "**/node_modules/**",
  "**/.bun/**",
  "**/.turbo/**",
  "**/.dev/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.cache/**",
  "**/tmp/**",
  "**/.git/**",
  "**/sources/**",
];

const NORMALIZE_REGEX = /\\+/g;

export const normalizePath = (value: string): string =>
  value.replace(NORMALIZE_REGEX, "/");

// Cache compiled micromatch matchers keyed by the joined pattern set.
// This avoids recompiling matchers on every call (shouldIgnorePath is
// invoked per-file across thousands of files in a typical pipeline run).
const matcherCache = new Map<string, RegExp[]>();

const getCompiledMatchers = (patterns: readonly string[]): RegExp[] => {
  const key = patterns.join("\0");
  let matchers = matcherCache.get(key);
  if (!matchers) {
    matchers = patterns.map((p) => micromatch.makeRe(p));
    matcherCache.set(key, matchers);
  }
  return matchers;
};

export const shouldIgnorePath = (
  file: string,
  patterns: readonly string[] = DEFAULT_GLOB_IGNORE,
): boolean => {
  const normalized = normalizePath(file);
  return getCompiledMatchers(patterns).some((re) => re.test(normalized));
};

export const mergeIgnorePatterns = (
  base: readonly string[],
  extra?: readonly string[],
): readonly string[] => {
  if (!extra || extra.length === 0) {
    return base;
  }
  const merged = new Set<string>(base);
  for (const pattern of extra) {
    if (pattern && pattern.length > 0) {
      merged.add(pattern);
    }
  }
  return Array.from(merged);
};
