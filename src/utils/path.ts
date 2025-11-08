const normalizeSeparators = (value: string): string =>
  value.replace(/\\/g, "/");

const normalizeSegment = (segment: string, isFirst: boolean): string => {
  const replaced = normalizeSeparators(segment);
  if (isFirst) {
    return replaced.replace(/\/+$/g, "");
  }
  return replaced.replace(/^\/+/, "").replace(/\/+$/g, "");
};

const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;

export const isAbsolutePath = (value: string): boolean => {
  const normalized = normalizeSeparators(value);
  return normalized.startsWith("/") || WINDOWS_DRIVE_PATTERN.test(normalized);
};

export const joinPaths = (...segments: string[]): string => {
  if (segments.length === 0) {
    return ".";
  }
  const normalized = segments
    .filter((segment) => segment !== "")
    .map((segment, index) => normalizeSegment(segment, index === 0))
    .filter((segment, index) => !(index !== 0 && segment.length === 0));
  if (normalized.length === 0) {
    return ".";
  }
  const [first, ...rest] = normalized;
  const safeFirst = first ?? "";
  const origin = segments[0] ?? "";
  const base =
    safeFirst.length === 0 && origin.startsWith("/") ? "/" : safeFirst;
  const joined = [base, ...rest].join("/");
  return joined.replace(/\/+/g, "/");
};

export const dirname = (value: string): string => {
  const normalized = normalizeSeparators(value);
  if (normalized === "/") {
    return "/";
  }
  const withoutTrailing = normalized.replace(/\/+$/g, "");
  const lastSlash = withoutTrailing.lastIndexOf("/");
  if (lastSlash <= 0) {
    return normalized.startsWith("/") ? "/" : ".";
  }
  return withoutTrailing.slice(0, lastSlash);
};

export const extname = (value: string): string => {
  const normalized = normalizeSeparators(value);
  const base = normalized.split("/").pop() ?? "";
  const index = base.lastIndexOf(".");
  if (index <= 0) {
    return "";
  }
  return base.slice(index).toLowerCase();
};

export const relativePath = (from: string, to: string): string => {
  const fromParts = joinPaths(from).split("/").filter(Boolean);
  const toParts = joinPaths(to).split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  const ups = new Array(fromParts.length).fill("..");
  const remainder = [...ups, ...toParts];
  return remainder.length === 0 ? "." : remainder.join("/");
};

export const resolvePath = (...segments: string[]): string => {
  if (segments.length === 0) {
    return normalizeSeparators(process.cwd());
  }

  let resolved = "";
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    const normalized = normalizeSeparators(segment);
    if (!normalized) {
      continue;
    }
    if (isAbsolutePath(normalized)) {
      resolved = normalized;
    } else if (resolved === "") {
      resolved = joinPaths(process.cwd(), normalized);
    } else {
      resolved = joinPaths(resolved, normalized);
    }
  }

  return resolved || normalizeSeparators(process.cwd());
};

export const resolveFrom = (base: string, ...segments: string[]): string =>
  joinPaths(base, ...segments);
