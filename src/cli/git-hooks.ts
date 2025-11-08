import { chmod, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { ResolvedGitHookConfig } from "../config/types";

const HOOK_MARKER = "# quality-managed-hook";

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

export type ManagedHookStatus =
  | "installed"
  | "updated"
  | "unchanged"
  | "replaced"
  | "skipped-unmanaged";

export interface ManagedHookInfo {
  readonly name: string;
  readonly managed: boolean;
  readonly path: string;
  readonly status?: ManagedHookStatus;
}

const HOOKS_DIR = ".git/hooks";

export const installHooks = async (
  options: InstallHooksOptions,
): Promise<ManagedHookInfo[]> => {
  const hooksDir = join(options.root, HOOKS_DIR);
  await mkdir(hooksDir, { recursive: true });

  const results: ManagedHookInfo[] = [];
  for (const hookName of Object.keys(options.hooks)) {
    const hookPath = join(hooksDir, hookName);
    const outcome = await writeHookScript({
      hookPath,
      hookName,
      force: options.force ?? false,
    });
    results.push({
      name: hookName,
      managed: outcome.managed,
      path: hookPath,
      status: outcome.status,
    });
  }
  return results;
};

export const uninstallHooks = async (
  options: UninstallHooksOptions,
): Promise<ManagedHookInfo[]> => {
  const hooksDir = join(options.root, HOOKS_DIR);
  const results: ManagedHookInfo[] = [];
  for (const hookName of options.hooks) {
    const hookPath = join(hooksDir, hookName);
    const managed = await isManagedHook(hookPath);
    if (managed) {
      await rm(hookPath, { force: true });
    }
    results.push({ name: hookName, managed, path: hookPath });
  }
  return results;
};

export const listHooks = async (
  options: ListHooksOptions,
): Promise<ManagedHookInfo[]> => {
  const hooksDir = join(options.root, HOOKS_DIR);
  const results: ManagedHookInfo[] = [];
  for (const hookName of options.hooks) {
    const hookPath = join(hooksDir, hookName);
    const managed = await isManagedHook(hookPath);
    results.push({ name: hookName, managed, path: hookPath });
  }
  return results;
};

interface WriteHookOutcome {
  readonly managed: boolean;
  readonly status: ManagedHookStatus;
}

const writeHookScript = async ({
  hookPath,
  hookName,
  force,
}: {
  hookPath: string;
  hookName: string;
  force: boolean;
}): Promise<WriteHookOutcome> => {
  const exists = await fileExists(hookPath);
  const script = buildHookScript(hookName);
  let existedManaged = false;
  if (exists) {
    existedManaged = await isManagedHook(hookPath);
    if (!existedManaged && !force) {
      return { managed: false, status: "skipped-unmanaged" };
    }
    if (existedManaged) {
      const current = await readFile(hookPath, "utf8").catch(() => "");
      if (current === script) {
        return { managed: true, status: "unchanged" };
      }
    }
  } else {
    await mkdir(dirname(hookPath), { recursive: true });
  }

  await writeFile(hookPath, script, { mode: 0o755 });
  await chmod(hookPath, 0o755);

  if (!exists) {
    return { managed: true, status: "installed" };
  }
  if (!existedManaged) {
    return { managed: true, status: "replaced" };
  }
  return { managed: true, status: "updated" };
};

const buildHookScript = (hookName: string): string => {
  const lines = [
    "#!/usr/bin/env bash",
    HOOK_MARKER,
    "set -euo pipefail",
    "",
    'ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    'export PATH="$ROOT_DIR/node_modules/.bin:$PATH"',
    "",
    "resolve_quality() {",
    "  if command -v quality >/dev/null 2>&1; then",
    "    command -v quality",
    "    return 0",
    "  fi",
    "",
    '  local search="$ROOT_DIR"',
    '  while [[ "$search" != "/" ]]; do',
    '    if [[ -x "$search/node_modules/.bin/quality" ]]; then',
    '      echo "$search/node_modules/.bin/quality"',
    "      return 0",
    "    fi",
    '    if [[ -x "$search/.bun/bin/quality" ]]; then',
    '      echo "$search/.bun/bin/quality"',
    "      return 0",
    "    fi",
    '    if [[ -x "$search/.bun/install/bin/quality" ]]; then',
    '      echo "$search/.bun/install/bin/quality"',
    "      return 0",
    "    fi",
    '    search="$(dirname "$search")"',
    "  done",
    "",
    '  if [[ -n "${BUN_INSTALL:-}" ]] && [[ -x "${BUN_INSTALL}/bin/quality" ]]; then',
    '    echo "${BUN_INSTALL}/bin/quality"',
    "    return 0",
    "  fi",
    "",
    "  return 1",
    "}",
    "",
    'QUALITY_BIN="$(resolve_quality || true)"',
    'if [[ -z "${QUALITY_BIN:-}" ]]; then',
    `  echo "[quality] Unable to locate the 'quality' executable for hook '${hookName}'." >&2`,
    '  echo "[quality] Install dependencies or add quality to PATH." >&2',
    "  exit 1",
    "fi",
    "",
    `exec "$QUALITY_BIN" git-hook ${hookName}`,
    "",
  ];

  return lines.join("\n");
};

const isManagedHook = async (hookPath: string): Promise<boolean> => {
  if (!(await fileExists(hookPath))) {
    return false;
  }
  const content = await readFile(hookPath, "utf8").catch(() => "");
  return content.includes(HOOK_MARKER);
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (_error) {
    return false;
  }
};
