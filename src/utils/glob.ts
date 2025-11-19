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

export const shouldIgnorePath = (
  file: string,
  patterns: readonly string[] = DEFAULT_GLOB_IGNORE,
): boolean => {
  const normalized = normalizePath(file);
  return patterns.some((pattern) => micromatch.isMatch(normalized, pattern));
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
