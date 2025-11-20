<!-- doc-catalog:banner:start -->
> [!NOTE]
> This document participates in the Forge documentation catalog. See [documentation catalog](../../README.md#documentation-catalog) for cross-links and regeneration instructions.

_Last synced: 2025-11-20 · Generated via `bun run docs:banners`._
<!-- doc-catalog:banner:end -->

# @codesynth-labs/quality

Unified quality suite for the Forge Platform monorepo. The package ships the `quality` CLI, a declarative pipeline runner, built-in adapters for linting/validation, JSON schema tooling, and fixtures/tests. Every behaviour of the quality pipeline is expressed through `.qualityrc` files so teams can compose checks without touching TypeScript. Loader discovery supports `.qualityrc.json`, `.qualityrc.jsonc`, `.qualityrc.ts`, and `.qualityrc.(mjs|cjs)` so teams can use comments/trailing commas or TypeScript when needed.

## Core concepts

- **Stage adapters** – Modules that implement a single responsibility (Biome, import hygiene, filenames, structure, bun-native, command, etc.). Adapters expose metadata (label, description, supported modes) and an execution hook.
- **Presets** – Named option bundles defined per adapter under `stages.<adapter>.presets`. Presets can extend other presets (single or multiple inheritance) and configure defaults such as groups, modes, hooks, and adapter options.
- **Profiles** – Named pipelines that order stages, set reporters, and attach hooks. Profiles can extend one another, allowing “local” and “ci” variants with small diffs.
- **Groups** – Stages can join a group to opt into parallel execution, fail-fast semantics, or shared metadata.
- **Hooks & reporters** – Declarative shell commands that run on start/success/failure, and reporters (summary/json/junit/verbose) that consume pipeline results.
- **Schema-first** – `packages/quality/schemas/qualityrc.schema.json` models the entire configuration surface so editors and CI can validate configs.

## Legacy configuration migration

Earlier revisions shipped standalone JSON allowlists under `config/` alongside a deprecated `gates` block in the root `.qualityrc`. The stage catalog now owns those rules directly. When migrating existing repositories:

| Legacy JSON | Replacement |
| --- | --- |
| `config/import-extension-allowlist.json` | `stages.imports.presets.workspace.options.allowlist` |
| `config/bun-node-import-allowlist.json` | `stages."bun-native".presets.workspace.options.allowlist` |
| `config/test-filename-rules.json` | `stages.filenames.presets.workspace.options` (patterns/ignore/etc.) |

CLI shims that previously forwarded `quality check --gate <name>` now dispatch via `--stage <name>` so every workflow goes through the stage-based pipeline.

## Getting started

1. Ensure dependencies are installed: `bun install` at the repo root.
2. Generate a starter configuration: `bun --bun packages/quality/src/cli/index.ts init` (or `bun run quality:init`). The stack demonstrates presets, command stages, and grouped adapters.
3. Reference the schema inside `.qualityrc` files to enable editor IntelliSense:

```jsonc
{
  "$schema": "./packages/quality/schemas/qualityrc.schema.json",
  "stages": {
    "command": {
      "presets": {
        "docs:check": {
          "continueOnError": true,
          "options": {
            "abortPipelineOnFailure": false,
            "commands": ["bun run docs:lint"]
          }
        }
      }
    }
  },
  "profiles": {
    "local": {
      "pipeline": [
        { "id": "lint:biome", "type": "biome", "preset": "recommended" },
        { "id": "lint:imports", "type": "imports", "group": "lint" },
        { "id": "docs:check", "type": "command", "preset": "docs:check" }
      ],
      "reporters": ["summary"],
      "hooks": { "onStart": ["echo '🔍 quality checks'"] }
    },
    "ci": {
      "extends": "local",
      "pipeline": [
        {
          "id": "ci:no-root-barrel",
          "type": "no-root-barrel",
          "overrides": { "packages": ["packages/*"] }
        }
      ],
      "reporters": [
        "summary",
        ["json", { "path": "reports/quality.json" }]
      ]
    }
  }
}
```

Create additional `.qualityrc` files inside packages to extend/override stages for that subtree. The loader walks upward from the file(s) being linted, merging presets, profiles, hooks, and adapter registrations.

## Configuration reference

### Global ignore

- Set `ignore` at the root of `.qualityrc` to provide glob patterns that should
  be skipped by every stage. These patterns augment the built-in defaults
  (`node_modules`, `.git`, caches, etc.) and flow through adapter internals, so a
  single entry such as `".forge/**"` keeps helper directories out of linting,
  hooks, and stage-specific globbing.

### Built-in adapters

- biome — Biome lint/format.
- imports — strip file extensions per allowlist.
- bun-native — guard `node:` imports.
- filenames — enforce test/fixture naming.
- structure — require presence/absence of files.
- command — run arbitrary commands.
- stack-check — validate stack manifests.
- metadata-verify — validate metadata files.
- package-scripts — enforce required scripts in `package.json` files.
- package-catalog — enforce dependency versions use `catalog:<name>` (or `workspace:`) with optional fix-mode rewrite using the root catalogs map.

### package-catalog

Ensures dependency versions in targeted `package.json` files use the monorepo catalogs.

Options:

- `packages` (string[]): glob(s) to `package.json` files (ignored: `**/node_modules/**`).
- `sections` (string[]): which dependency blocks to scan; defaults to `dependencies`, `devDependencies`, `peerDependencies`.
- `allowlist` (string[]): package names (globs) to exempt.
- `rootCatalogPath` (string): path to the root package file containing `catalogs` (default: `package.json`).

Behaviour:

- **check**: fails if any targeted dependency lacks `catalog:<name>` or `workspace:*`. When a catalog entry exists, the message points to the expected `catalog:<name>`; otherwise it asks to add the dep to root catalogs or the allowlist.
- **fix**: rewrites eligible deps to `catalog:<name>` when a root catalog entry exists. Deps without catalog entries still fail with guidance.

Example stage:

```jsonc
{
  "id": "package-catalog",
  "type": "package-catalog",
  "overrides": {
    "packages": [
      "packages/*/package.json",
      "packages/*/*/package.json",
      "packages/*/*/*/package.json",
      "services/*/package.json",
      "apps/*/package.json",
      "!packages/forge-stacks/stacks/**/package.json"
    ],
    "allowlist": ["@codesynth-labs/*"]
  }
}
```

### Git hooks

`.qualityrc` can manage Git hook automation:

```jsonc
{
  "gitHooks": {
    "manage": true,
    "hooks": {
      "pre-commit": {
        "stages": ["lint:biome"],
        "filesMode": "staged",
        "autoFix": { "enabled": true, "safety": "confirm" }
      }
    }
  }
}
```

- `quality hooks install` now materialises a **versioned** `.quality/` folder plus tiny shims in `.git/hooks/*` (only when `manage` is true). Shims delegate to `.quality/<hook>` which sources `./_/quality.sh` and invokes `quality git-hook <name>`. Hooks are replaced on every install; add `"prepare": "quality hooks install"` so fresh clones stay in sync.
- `quality git-hook <name>` runs the configured stages in hook context, respecting auto-fix policies and safeguards inherited from Phase 1.

### Stage definitions

Each stage entry resolves to a `ResolvedStage` with these fields:

| Field | Description |
| --- | --- |
| `id` | Unique identifier printed in reports and used by `quality run --stage <id>`. |
| `type` | Adapter type (`biome`, `imports`, `command`, etc.). |
| `preset` | Optional preset name defined under `stages.<type>.presets`. Presets may `extends` one or many other presets. |
| `overrides` | Free-form options merged on top of the preset. |
| `label` / `description` | Friendly metadata for reporters. |
| `mode` | Overrides the pipeline mode (`check`, `fix`, or `report`). |
| `files` | Glob array evaluated when the CLI is invoked without `--files`. |
| `group` | String (group id) or object (`{ id, label?, parallel?, failFast?, continueOnError? }`). Stages sharing the same group id execute concurrently when `parallel` is true. |
| `continueOnError` | When `true`, the pipeline continues even if the stage fails. Defaults to `false`, but can be inherited from presets or groups. Command stages also infer this from `options.abortPipelineOnFailure`. |
| `if` | JavaScript expression evaluated with `process.env` to determine whether the stage runs. |
| `reporters` | Overrides the profile-level reporters for this stage. |

### Groups & parallel execution

- Stages within the same group id run concurrently when `parallel: true`.
- `failFast: true` (default) aborts sibling stages at the first failure via `AbortController`.
- `continueOnError: true` on the stage or group allows the pipeline to keep running after failures.
- The runner aggregates output in a deterministic order regardless of parallel execution.

### Command adapter options

`command` stages accept:

| Option | Description |
| --- | --- |
| `commands` | Array of either shell strings or objects `{ command, args?, cwd?, env?, shell?, timeoutMs?, continueOnError?, label? }`. Arrays in `command` allow specifying the binary plus default args. |
| `cwd` | Working directory for commands (default: repo root). |
| `env` | Additional environment variables. |
| `shell` | Whether to execute through the shell (`true`, `false`, or shell binary). Shell strings default to `shell: true`. |
| `timeoutMs` | Per-command timeout. |
| `abortPipelineOnFailure` | When `false`, the stage inherits `continueOnError: true` so downstream stages continue. |
| `output` | Optional object that enables quiet logging. Supports `preset` (`vitest`, `playwright`, `turbo`), `mode` (`passthrough` or `errors-only`), pattern overrides, and `showOnSuccess`/`showOnFailure` toggles. |

The adapter collects stdout/stderr per command, respects pipeline abort signals, and reports timeouts with structured details.

When `output` is configured the adapter streams stdout/stderr through the
command-output filter and only emits the filtered lines (for example, failing
Vitest assertions). Passing stages can suppress logs entirely by setting
`showOnSuccess: "none"`, keeping `quality check` output tight even when the
underlying command is noisy. Set `QUALITY_SHOW_ALL_OUTPUT=1` or pass
`--show-command-output` to the CLI to bypass filtering for a given run.

### Extending adapters

Add custom adapters by exporting modules that return a `StageAdapter`:

```ts
// packages/tools/quality/custom-adapter.ts
import type { StageAdapter } from "@codesynth-labs/quality/src/adapters/types";

export const greetAdapter: StageAdapter<{ message?: string }> = {
  type: "greet",
  label: "Greeter",
  description: "Prints a greeting",
  async run(context) {
    const message = context.options.message ?? "hello";
    console.log(message);
    return { status: "passed" };
  },
};

export default { adapters: [greetAdapter] };
```

Reference the module path from `.qualityrc`:

```jsonc
{
  "$schema": "./packages/quality/schemas/qualityrc.schema.json",
  "adapters": ["./packages/tools/quality/custom-adapter.ts"],
  "profiles": {
    "local": {
      "pipeline": [
        { "id": "greet", "type": "greet", "overrides": { "message": "hi" } }
      ]
    }
  }
}
```

The loader resolves module paths relative to the config file, registers adapters, and exposes preset metadata to the CLI.

### Schema & validation

`packages/quality/schemas/qualityrc.schema.json` describes:

- Root keys (`$schema`, `adapters`, `stages`, `profiles`, `reporters`, `hooks`).
- Built-in adapter option definitions (biome/imports/bun-native/filenames/structure/no-root-barrel/command).
- Group metadata, parallel semantics, and hook definitions.

Unit tests use a vendored JSON Schema validator to ensure sample `.qualityrc` files remain compliant. Point editors at the relative schema path or host the schema at `$id` for global distribution.

## CLI reference

```
Usage: quality <command> [options]

Commands:
  quality check [--profile <name>] [--files <glob>] [--stage <id>] [--reporter <name>] [--json <path>]
  quality fix [--profile <name>] [--files <glob>] [--stage <id>]
  quality run --stage <id> [--mode check|fix|report] [--files <glob>]
  quality list [--adapters]
  quality hooks install [--force]
  quality hooks uninstall
  quality hooks list
  quality git-hook <name>
  quality validate-config [--profile <name>] [--stage <id>]
  quality init [--cwd <path>]
```

Highlights:

- `quality list` prints the resolved pipeline. `quality list --adapters` shows registered adapters, supported modes, and preset descriptions.
- `quality validate-config` outputs the merged profile JSON, or a specific stage via `--stage`.
- `quality run --stage` executes a single stage ad-hoc (useful for command adapters or debugging).
- `--reporter` can be repeated; `--json <path>` adds the JSON reporter automatically.
- `quality hooks install` writes deterministic **.git/hooks shims** that invoke `.quality/<hook>`; use `quality hooks list` to audit managed shims and `quality hooks uninstall` to clean them up. The `.quality/` folder (including `_/quality.sh` and hook files) should be committed.

## Nested configs

Place additional `.qualityrc` files within packages to customize presets or append stages for that subtree. The loader merges configs in this order:

1. Repository root `.qualityrc`.
2. Profile inheritance (`extends`).
3. Nested `.qualityrc` files closest to the targeted files.
4. Stage-level overrides.

Adapters declared in nested configs are registered automatically.

## Development

- Type check: `bun --filter @codesynth-labs/quality typecheck`
- Lint: `bun --filter @codesynth-labs/quality lint`
- Unit tests: `bun --filter @codesynth-labs/quality test:unit`

Tests live alongside the source (e.g., `src/pipeline/runner.unit.test.ts`). Fixtures under `test/fixtures/**` exercise loader behaviours, preset inheritance, and schema validation.

Run `quality check` before publishing changes to ensure reporters, hooks, and adapters remain functional across the monorepo.
