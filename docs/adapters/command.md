# `command`

> Custom command runner.

**Type:** `command`
**Modes:** `check`, `fix`, `report`

## What it does

The escape hatch. The `command` adapter shells out to one or more
arbitrary commands and treats their exit codes as pass/fail. Use it to
plug in `tsc`, `prettier --check`, `vitest`, a Python linter, or any
existing tooling that doesn't yet have a first-class adapter.

The adapter understands per-command working directories, environment
overlays, timeouts, `continueOnError` semantics, and an `output`
filtering pipeline that can suppress noisy stdout on success while
preserving the raw stream on failure.

If the stage has `alwaysRun: false` (the default) and no files match
its scope, the adapter skips the commands entirely — useful when a
heavy command should only run when relevant files changed.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "typecheck",
          "type": "command",
          "alwaysRun": true,
          "overrides": {
            "commands": [
              {
                "command": ["bun", "x", "tsgo", "--noEmit"],
                "label": "tsgo --noEmit",
                "timeoutMs": 120000
              }
            ],
            "output": {
              "showOnSuccess": "none",
              "showOnFailure": "raw"
            }
          }
        }
      ]
    }
  }
}
```

## Options

- **`commands`** (`readonly CommandStageEntry[]`) — list of commands to run. Each entry is either a string (parsed with the shell) or an object with `command`, `args`, `cwd`, `env`, `shell`, `timeoutMs`, `continueOnError`, `label`.
- **`cwd`** (`string`) — default working directory for all commands in the stage.
- **`env`** (`Record<string, string>`) — extra environment variables overlaid onto each command's process.
- **`shell`** (`boolean | string`) — run commands through a shell; pass a string to pick the shell binary.
- **`timeoutMs`** (`number`) — default per-command timeout.
- **`abortPipelineOnFailure`** (`boolean`) — when true, a failing command aborts the whole pipeline rather than only the stage.
- **`output`** (`object`) — filter and gating config: `preset`, `showOnSuccess` (`"none" | "filtered" | "raw"`), `showOnFailure` (same), plus the underlying `CommandOutputFilterConfig` keys for line-level rules.

## Example output

Success:

```
[typecheck] passed (1 command)
```

Failure:

```
[typecheck] failed (1 command)
  $ bun x tsgo --noEmit
  src/server.ts(42,5): error TS2322: Type 'number' is not assignable to type 'string'.
  exit code: 2
```

## See also

- [`examples/typescript-strict/`](../../examples/typescript-strict) and
  [`examples/parallel-groups/`](../../examples/parallel-groups) both
  use `command` for the slow, real-tool stages.
