import type { HookDefinition, QualityHooksConfig } from "../config/types";
import { runCommand } from "../utils/process";

export interface RunHooksOptions {
  readonly root: string;
  readonly abortSignal?: AbortSignal;
}

export interface HookRunOutcome {
  readonly success: boolean;
  readonly shouldHalt: boolean;
}

export interface ResolvedHook {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly continueOnError?: boolean;
}

export interface ResolvedHooks {
  readonly onStart: readonly ResolvedHook[];
  readonly onComplete: readonly ResolvedHook[];
  readonly onSuccess: readonly ResolvedHook[];
  readonly onStageFail: Record<string, readonly ResolvedHook[]>;
}

export const ensureHooks = (hooks: QualityHooksConfig = {}): ResolvedHooks => ({
  onStart: normalizeHooks(hooks.onStart),
  onComplete: normalizeHooks(hooks.onComplete),
  onSuccess: normalizeHooks(hooks.onSuccess),
  onStageFail: normalizeStageHooks(hooks.onStageFail),
});

export const runHookSequence = async (
  hooks: readonly ResolvedHook[],
  options: RunHooksOptions,
): Promise<HookRunOutcome> => {
  let success = true;
  let shouldHalt = false;
  for (const hook of hooks) {
    if (options.abortSignal?.aborted) {
      break;
    }
    const outcome = await runHook(hook, options);
    if (!outcome.success) {
      success = false;
    }
    if (outcome.shouldHalt) {
      shouldHalt = true;
      break;
    }
  }
  return { success, shouldHalt } satisfies HookRunOutcome;
};

export const runStageFailureHooks = async (
  hooks: ResolvedHooks["onStageFail"],
  stageId: string,
  options: RunHooksOptions,
): Promise<HookRunOutcome> => {
  const stageHooks: ResolvedHook[] = [];
  if (hooks[stageId]) {
    stageHooks.push(...hooks[stageId]);
  }
  if (hooks["*"]) {
    stageHooks.push(...hooks["*"]);
  }
  if (stageHooks.length === 0) {
    return { success: true, shouldHalt: false } satisfies HookRunOutcome;
  }
  return runHookSequence(stageHooks, options);
};

const normalizeHooks = (
  hooks: readonly HookDefinition[] | undefined,
): readonly ResolvedHook[] => {
  if (!hooks) return [];
  return hooks.map((hook) =>
    typeof hook === "string" ? { command: hook } : { ...hook },
  );
};

const normalizeStageHooks = (
  hooks: Record<string, readonly HookDefinition[]> | undefined,
): Record<string, readonly ResolvedHook[]> => {
  if (!hooks) return {};
  const entries = Object.entries(hooks).map(
    ([key, value]) => [key, normalizeHooks(value)] as const,
  );
  return Object.fromEntries(entries);
};

const runHook = async (
  hook: ResolvedHook,
  options: RunHooksOptions,
): Promise<HookRunOutcome> => {
  const cwd = hook.cwd ?? options.root;
  try {
    const result = await runCommand({
      command: hook.command,
      cwd,
      env: hook.env,
      abortSignal: options.abortSignal,
      shell: true,
    });

    if (result.exitCode === 0 && !result.terminated) {
      return { success: true, shouldHalt: false } satisfies HookRunOutcome;
    }

    logHookFailure(hook, result);
    const suppressFailure = hook.continueOnError === true;
    return {
      success: suppressFailure,
      shouldHalt: suppressFailure ? false : true,
    } satisfies HookRunOutcome;
  } catch (error) {
    console.error(`[quality] Hook '${hook.command}' failed to execute:`, error);
    const suppressFailure = hook.continueOnError === true;
    return {
      success: suppressFailure,
      shouldHalt: suppressFailure ? false : true,
    } satisfies HookRunOutcome;
  }
};

const logHookFailure = (
  hook: ResolvedHook,
  result: Awaited<ReturnType<typeof runCommand>>,
): void => {
  const reason = result.terminated
    ? result.terminationReason === "timeout"
      ? "timeout"
      : "abort"
    : `exit code ${result.exitCode}`;
  const message = `[quality] Hook '${hook.command}' failed (${reason}).`;
  console.error(message);
  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    console.error(stderr);
  }
};
