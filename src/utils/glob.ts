import micromatch from "micromatch";

export const DEFAULT_GLOB_IGNORE = [
  "**/node_modules/**",
  "**/.bun/**",
  "**/.turbo/**",
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
