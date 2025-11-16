import { chmod, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { ResolvedGitHookConfig } from "../config/types";

const HOOK_MARKER = "# quality-managed-hook";
const SHIM_MARKER = "# quality-managed-shim";
const QUALITY_DIR = ".quality";
const QUALITY_HELPER = join(QUALITY_DIR, "_", "quality.sh");

export interface InstallHooksOptions {
  readonly root: string;
  readonly hooks: Record<string, ResolvedGitHookConfig>;
  readonly force?: boolean;
}

export interface UninstallHooksOptions {
  readonly root: string;
  readonly hooks: readonly string[];
}

export interface ListHooksOptions {
  readonly root: string;
  readonly hooks: readonly string[];
}

export type ManagedHookStatus = "installed" | "replaced";

export interface ManagedHookInfo {
  readonly name: string;
  readonly managed: boolean;
  readonly path: string;
  readonly status?: ManagedHookStatus;
}

const GIT_DIR = ".git";

const hooksDirCache = new Map<string, string>();

const resolveHooksDir = async (root: string): Promise<string> => {
  if (hooksDirCache.has(root)) {
    return hooksDirCache.get(root)!;
  }
  const gitPath = join(root, GIT_DIR);
  let gitStats: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    gitStats = await stat(gitPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Unable to locate git directory at ${gitPath}`);
    }
    throw error;
  }

  if (gitStats?.isDirectory()) {
    const dir = join(gitPath, "hooks");
    hooksDirCache.set(root, dir);
    return dir;
  }

  // Worktree .git files store a pointer to the real git dir.
  const descriptor = await readFile(gitPath, "utf8");
  const match = /^gitdir:\s*(.+)$/im.exec(descriptor);
  if (!match) {
    throw new Error(`Unable to resolve gitdir from ${gitPath}`);
  }
  const gitDir = match[1].trim();
  const resolvedGitDir = gitDir.startsWith("/") ? gitDir : join(root, gitDir);
  const dir = join(resolvedGitDir, "hooks");
  hooksDirCache.set(root, dir);
  return dir;
};

export const installHooks = async (
  options: InstallHooksOptions,
): Promise<ManagedHookInfo[]> => {
  const hooksDir = await resolveHooksDir(options.root);
  await mkdir(hooksDir, { recursive: true });
  await ensureQualityStructure(options.root);

  const results: ManagedHookInfo[] = [];
  for (const hookName of Object.keys(options.hooks)) {
    const shimPath = join(hooksDir, hookName);
    const qualityHookPath = join(options.root, QUALITY_DIR, hookName);

    // Always replace existing hooks per new policy.
    await rm(shimPath, { force: true });
    await writeQualityHookScript({ hookPath: qualityHookPath, hookName });
    await writeShimScript({ shimPath, hookName });

    results.push({
      name: hookName,
      managed: true,
      path: shimPath,
      status: "installed",
    });
  }
  return results;
};

export const uninstallHooks = async (
  options: UninstallHooksOptions,
): Promise<ManagedHookInfo[]> => {
  const hooksDir = await resolveHooksDir(options.root);
  const results: ManagedHookInfo[] = [];
  for (const hookName of options.hooks) {
    const hookPath = join(hooksDir, hookName);
    await rm(hookPath, { force: true });
    results.push({ name: hookName, managed: true, path: hookPath });
  }
  return results;
};

export const listHooks = async (
  options: ListHooksOptions,
): Promise<ManagedHookInfo[]> => {
  const hooksDir = await resolveHooksDir(options.root);
  const results: ManagedHookInfo[] = [];
  for (const hookName of options.hooks) {
    const hookPath = join(hooksDir, hookName);
    const managed = await isManagedHook(hookPath);
    results.push({ name: hookName, managed, path: hookPath });
  }
  return results;
};
const ensureQualityStructure = async (root: string): Promise<void> => {
  const qualityDir = join(root, QUALITY_DIR);
  const helperPath = join(root, QUALITY_HELPER);
  await mkdir(join(qualityDir, "_"), { recursive: true });
  await writeIfChanged(helperPath, buildHelperScript(root));
};

const writeQualityHookScript = async ({
  hookPath,
  hookName,
}: {
  hookPath: string;
  hookName: string;
}): Promise<void> => {
  await mkdir(dirname(hookPath), { recursive: true });
  const script = buildQualityHookScript(hookName);
  await writeFile(hookPath, script, { mode: 0o755 });
  await chmod(hookPath, 0o755);
};

const writeShimScript = async ({
  shimPath,
  hookName,
}: {
  shimPath: string;
  hookName: string;
}): Promise<void> => {
  await mkdir(dirname(shimPath), { recursive: true });
  const script = buildShimScript({ hookName });
  await writeIfChanged(shimPath, script, SHIM_MARKER);
};

const buildQualityHookScript = (hookName: string): string => {
  const lines = [
    "#!/usr/bin/env sh",
    HOOK_MARKER,
    'HOOK_NAME="' + hookName + '"',
    '. "$(dirname "$0")/_/quality.sh" "$@"',
    "",
  ];
  return lines.join("\n");
};

const buildShimScript = ({ hookName }: { hookName: string }): string => {
  const lines = [
    "#!/usr/bin/env sh",
    SHIM_MARKER,
    'ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"',
    `QUALITY_HOOK="$ROOT_DIR/${QUALITY_DIR}/${hookName}"`,
    'if [ ! -x "$QUALITY_HOOK" ]; then',
    `  echo "[quality] missing hook for ${hookName} at $QUALITY_HOOK" >&2`,
    "  exit 0",
    "fi",
    'exec "$QUALITY_HOOK" "$@"',
    "",
  ];
  return lines.join("\n");
};

const buildHelperScript = (_root: string): string => {
  const lines = [
    "#!/usr/bin/env sh",
    "set -eu",
    'if [ "${QUALITY_HOOKS:-1}" = "0" ]; then exit 0; fi',
    'ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"',
    'PATH="$ROOT_DIR/node_modules/.bin:$ROOT_DIR/.bun/bin:$PATH"',
    'HOOK_NAME="${HOOK_NAME:-$(basename "$0")}"',
    "",
    "find_quality() {",
    "  if command -v quality >/dev/null 2>&1; then",
    "    command -v quality",
    "    return 0",
    "  fi",
    '  search="$ROOT_DIR"',
    '  while [ "$search" != "/" ]; do',
    '    if [ -x "$search/node_modules/.bin/quality" ]; then echo "$search/node_modules/.bin/quality"; return 0; fi',
    '    if [ -x "$search/.bun/bin/quality" ]; then echo "$search/.bun/bin/quality"; return 0; fi',
    '    if [ -x "$search/.bun/install/bin/quality" ]; then echo "$search/.bun/install/bin/quality"; return 0; fi',
    '    search="$(dirname "$search")"',
    "  done",
    '  if [ -n "${BUN_INSTALL:-}" ] && [ -x "${BUN_INSTALL}/bin/quality" ]; then',
    '    echo "${BUN_INSTALL}/bin/quality"',
    "    return 0",
    "  fi",
    "  return 1",
    "}",
    "",
    'QUALITY_BIN="$(find_quality || true)"',
    'if [ -z "$QUALITY_BIN" ]; then',
    '  echo "[quality] Unable to locate the quality executable." >&2',
    "  exit 1",
    "fi",
    "",
    'exec "$QUALITY_BIN" git-hook "$HOOK_NAME" "$@"',
    "",
  ];
  return lines.join("\n");
};

const writeIfChanged = async (
  target: string,
  content: string,
  marker?: string,
): Promise<void> => {
  const exists = await fileExists(target);
  if (exists) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current === content) {
      return;
    }
    if (marker && current.includes(marker)) {
      // replace managed content silently
    }
  }
  await writeFile(target, content, { mode: 0o755 });
  await chmod(target, 0o755);
};

const isManagedHook = async (hookPath: string): Promise<boolean> => {
  if (!(await fileExists(hookPath))) {
    return false;
  }
  const content = await readFile(hookPath, "utf8").catch(() => "");
  return content.includes(SHIM_MARKER);
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (_error) {
    return false;
  }
};
