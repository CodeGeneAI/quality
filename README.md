# @codegeneai/quality

> Declarative, schema-driven quality pipeline (lint, format, test orchestration) for monorepos and single packages — built on Bun, written in TypeScript.

[![npm version](https://img.shields.io/npm/v/@codegeneai/quality.svg)](https://www.npmjs.com/package/@codegeneai/quality)
[![npm downloads](https://img.shields.io/npm/dm/@codegeneai/quality.svg)](https://www.npmjs.com/package/@codegeneai/quality)
[![CI](https://github.com/CodeGeneAI/quality/actions/workflows/ci.yml/badge.svg)](https://github.com/CodeGeneAI/quality/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df)](https://bun.sh)

```bash
bun add -D @codegeneai/quality
bun x quality init
bun x quality check
```

That's it — `quality init` drops a starter `.qualityrc.jsonc` in your repo, and `quality check` runs the pipeline.

<details>
<summary><strong>Table of contents</strong></summary>

- [Why this exists](#why-this-exists)
- [Core concepts](#core-concepts)
- [Getting started](#getting-started)
- [Shards and profiles](#shards-and-profiles)
- [Configuration reference](#configuration-reference)
  - [Files and shards](#files-and-shards)
  - [Auto-fix defaults](#auto-fix-defaults)
  - [CLI reference (quality)](#cli-reference-quality)
  - [Global ignore](#global-ignore)
  - [Built-in adapters](#built-in-adapters)
  - [package-catalog](#package-catalog)
  - [Husky hooks (recommended)](#husky-hooks-recommended)
  - [Stage specs](#stage-specs)
  - [Groups & parallel execution](#groups--parallel-execution)
  - [Command adapter options](#command-adapter-options)
  - [Extending adapters](#extending-adapters)
  - [Schema & validation](#schema--validation)
- [CLI reference](#cli-reference)
- [Nested configs](#nested-configs)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

</details>

## Why this exists

Most repos end up gluing together `husky`, `lint-staged`, `biome` (or `eslint` + `prettier`), and a stack of bespoke shell scripts to enforce quality before commits and in CI. `@codegeneai/quality` collapses that pile into a single declarative config file: pipelines, profiles (`local`, `pre-commit`, `pre-push`, `ci`), stage adapters, hooks, and reporters all live in `.qualityrc.jsonc`. You compose checks without writing TypeScript, share configuration across monorepo packages via nested configs, and run the same pipeline locally and in CI.

It pairs especially well with Bun and Biome but does not require either at the stage level — any check that can be expressed as a command or implemented as a stage adapter fits.

## Core concepts

- **Stage adapters** – Modules that implement a single responsibility (import hygiene, filenames, structure, bun-native, command, etc.). Adapters expose metadata (label, description, supported modes) and an execution hook.
- **Presets** – Named option bundles defined per adapter under `stages.<adapter>.presets`. Presets can extend other presets (single or multiple inheritance) and configure defaults such as groups, modes, hooks, and adapter options.
- **Profiles** – Named pipelines that order stages, set reporters, and attach hooks. Profiles can extend one another, allowing "local" and "ci" variants with small diffs.
- **Groups** – Stages can join a group to opt into parallel execution, fail-fast semantics, or shared metadata.
- **Hooks & reporters** – Declarative shell commands that run on start/success/failure, and reporters (summary/json/junit/verbose) that consume pipeline results.
- **Schema-first** – A bundled JSON Schema models the entire configuration surface so editors and CI can validate configs.

## Getting started

1. Install: `bun add -D @codegeneai/quality`.
2. After installing, run `bun x quality init` in your repo to generate a starter `.qualityrc.jsonc` (the stack demonstrates presets, command stages, and grouped adapters).
3. Reference the schema inside `.qualityrc` files to enable editor IntelliSense:

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
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
  }
}
```

> Editors that support `npm:` schema references (or your monorepo tooling) can also use `"$schema": "npm:@codegeneai/quality/schemas/qualityrc.schema.json"`. The relative `./node_modules/...` path above works everywhere.

Profiles can live entirely in shard files (e.g., `.qualityrc.local.jsonc`, `.qualityrc.pre-push.jsonc`). If the base config omits profiles, the loader discovers shards automatically and defaults to `local` (or a `--profile` override / the first shard found).

Create additional `.qualityrc` files inside packages to extend/override stages for that subtree. The loader walks upward from the file(s) being linted, merging presets, profiles, hooks, and adapter registrations.

## Shards and profiles

- Base config: `.qualityrc.jsonc` (or `.json`).
- Profile shards: `.qualityrc.<profile>.jsonc|json` are loaded automatically and merged on top of the base. By default shards live beside the base config; set `"shardDir": "relative/path"` in the base config to load shards from another directory.
- Example shards: `.qualityrc.local-fast.jsonc`, `.qualityrc.pre-commit.jsonc`, `.qualityrc.pre-push.jsonc`, `.qualityrc.ci.jsonc`.

## Configuration reference

### Files and shards

- Base config: `.qualityrc.jsonc` (or `.json`). JSON/JSONC only.
- Profile shards: `.qualityrc.<profile>.jsonc|json` loaded automatically and merged on top of the base. Default location is the same directory as the base; set `"shardDir": "relative/path"` in the base config to load shards from a custom folder.
- Example shards: `.qualityrc.local-fast.jsonc`, `.qualityrc.pre-commit.jsonc`, `.qualityrc.pre-push.jsonc`, `.qualityrc.ci.jsonc`.

### Auto-fix defaults

- Each profile accepts `autoFix: true` to run fixable stages before verification without passing `--auto-fix`.
- Developers can disable the default on a given invocation with `--no-auto-fix`.
- Use the `-a` alias to keep hooks and scripts short while enabling auto-fix explicitly.
- Example profile configuration and usage:

```jsonc
{
  "profiles": {
    "local": {
      "pipeline": [
        { "id": "lint:imports", "type": "imports" },
        { "id": "lint:structure", "type": "structure" }
      ],
      "autoFix": true // Enable auto-fix by default
    }
  }
}
```

```bash
quality check  # Auto-fix enabled (profile default)
quality check --no-auto-fix  # Override to disable auto-fix
quality check -a  # Explicitly enable auto-fix regardless of profile default
```

### CLI reference (quality)

- `quality check [-a|--auto-fix] [--no-auto-fix] [--profile <name>] [--files <glob>] [--stage <id>] [--reporter <name>] [--json <path>] [--shard-dir <dir>]`
- `quality run --stage <id> [--mode check|fix|report] [--shard-dir <dir>]`
- `quality list [--adapters] [--shard-dir <dir>]`
- `quality init`
- `quality validate-config [--stage <id>] [--shard-dir <dir>]` (prints resolved profile/stage as JSON)
- `quality config validate [--shard-dir <dir>]` (validates all profiles/shards)
- `quality config print [--compact] [--shard-dir <dir>]` (prints merged config; pretty-prints by default, use `--compact` for single-line JSON)
- `quality telemetry analyze [--file <path>] [--profile <name>] [--context <substring>] [--success-only] [--json]`

**Resolution order:** CLI flag (`--auto-fix` or `--no-auto-fix`) → profile `autoFix` → `false` (default).

### Global ignore

- Set `ignore` at the root of `.qualityrc` to provide glob patterns that should
  be skipped by every stage. These patterns augment the built-in defaults
  (`node_modules`, `.git`, caches, etc.) and flow through adapter internals, so a
  single entry such as `"scripts/helpers/**"` keeps helper directories out of linting,
  hooks, and stage-specific globbing.

### Built-in adapters

- imports — strip file extensions per allowlist.
- bun-native — guard `node:` imports.
- filenames — enforce test/fixture naming.
- structure — require presence/absence of files; supports `requireWithContent` (autofix create/overwrite) e.g., `CLAUDE.md` with `@./AGENTS.md`.
- unit-adjacency — ensure unit tests (e.g., `*.unit.spec.ts`) sit next to the subject file. Subject-less tests are allowed only under `src/__tests__/` (configurable) and only if that folder contains unit tests only; `requireSubject` and directory options are configurable.
- command — run arbitrary commands.
- package-scripts — enforce required scripts in `package.json` files.
- package-catalog — enforce dependency versions use `catalog:<name>` (or `workspace:`) with optional fix-mode rewrite using the root catalogs map.
- barrel-exports — enforce barrel-file conventions.
- biome-config — validate Biome configuration consistency.
- biome-ignore — keep Biome ignore lists in sync.
- changeset-guard — guard changeset usage on configured branches.
- dockerfile-required — require Dockerfiles in selected packages.
- dotenv-plaintext — flag plaintext secrets in `.env` files.
- dotenv-secrets — validate dotenvx-encrypted secret files.

Adapters that support partial file input honour `--files` and profile-level
`filesMode` selections. In pre-commit profiles, `biome-ignore`,
`dotenv-plaintext`, and `dotenv-secrets` inspect only matching staged files and
skip quickly when unrelated files are staged, while workspace/CI profiles still
perform their configured full scans.

### package-catalog

Ensures dependency versions in targeted `package.json` files use shared catalogs (a Bun monorepo feature; safe to skip in single-package repos).

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
      "!packages/example/stacks/**/package.json"
    ],
    "allowlist": ["@your-scope/*"]
  }
}
```

### Husky hooks (recommended)

Use Husky to connect Git hooks to your quality profiles. Example hooks that also keep Git LFS happy:

`.husky/pre-commit`

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
command -v git-lfs >/dev/null 2>&1 && git lfs pre-commit "$@"
bun x quality check --profile pre-commit --files-mode staged --reporter summary
```

`.husky/pre-push`

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
command -v git-lfs >/dev/null 2>&1 && git lfs pre-push "$@"
bun x quality check --profile pre-push --files-mode workspace --reporter summary
```

Setup steps:

1. `bun add -D husky`.
2. Add `"prepare": "husky install"` to `package.json` so fresh installs create `.husky/`.
3. Commit the `.husky/*` hook files alongside your `.qualityrc` profiles.

Define dedicated profiles (e.g., `pre-commit`, `pre-push`) in `.qualityrc` so hook commands stay stable. Husky lives at `.husky/` (via `core.hooksPath`), avoiding conflicts with Git LFS and other tools.

### Stage specs

Each stage entry resolves to a `ResolvedStage` with these fields:

| Field | Description |
| --- | --- |
| `id` | Unique identifier printed in reports and used by `quality run --stage <id>`. |
| `type` | Adapter type (`imports`, `command`, etc.). |
| `preset` | Optional preset name defined under `stages.<type>.presets`. Presets may `extends` one or many other presets. |
| `overrides` | Free-form options merged on top of the preset. |
| `label` / `description` | Friendly metadata for reporters. |
| `mode` | Overrides the pipeline mode (`check`, `fix`, or `report`). |
| `files` | Glob array evaluated when the CLI is invoked without `--files`. |
| `group` | String (group id) or object (`{ id, label?, parallel?, failFast?, continueOnError? }`). Stages sharing the same group id execute concurrently when `parallel` is true. |
| `continueOnError` | When `true`, the pipeline continues even if the stage fails. Defaults to `false`, but can be inherited from presets or groups. Command stages also infer this from `options.abortPipelineOnFailure`. |
| `if` | Boolean condition evaluated by a sandboxed parser (no dynamic code). Supports `env.*` lookups, string/number/boolean/null/undefined literals, comparisons (`===`, `!==`, `<`, `<=`, `>`, `>=`), and logical operators (`!`, `&&`, `||`). |
| `reporters` | Overrides the profile-level reporters for this stage. |

File globs declared under `files` are resolved asynchronously and cached per pattern/root/ignore combination during a run so parallel groups that share patterns do not repeat identical filesystem scans.

#### Conditional syntax

- Access environment variables via `env.VAR_NAME` or dotted keys (`env.NODE_ENV`).
- Supported operators: `!`, `&&`, `||`, `===`, `!==`, `==`, `!=`, `<`, `<=`, `>`, `>=`. `==`/`!=` perform limited coercion for env-provided strings (for example, `"true"` → `true`, numeric strings → numbers) to keep legacy guards working.
- Supported literals: strings (single or double quotes), numbers, `true`/`false`, `null`, `undefined`.
- Parentheses are allowed for grouping; unmatched parentheses or unknown tokens fail the condition and skip the stage.
- Prefer short, explicit checks such as `env.NODE_ENV === "ci"` or `env.QUALITY_FLAG === "1"`; avoid chained logic that hides failure modes (`(env.A === "1" && env.B === "1") || env.C === "1"`).
- Conditions resolve missing environment variables to `undefined`; include defaults explicitly (for example, `env.TARGET ?? "local" === "ci"` is not supported, use `env.TARGET === "ci"`).
- Wrap string literals in quotes and avoid interpolated paths or shell expressions. All unknown tokens cause the condition to evaluate to `false` so the stage is skipped.
- Capture common guardrails in presets (for example, a `ci-only` preset that sets `if: "env.CI === \"true\""`) to keep stage specs consistent across services.
- Share this guidance with config authors when adding new profiles to reduce invalid `if` expressions; keep conditions short, quoted, and explicit.

### Groups & parallel execution

- Stages within the same group id run concurrently when `parallel: true`.
- `failFast: true` (default) aborts sibling stages at the first failure via `AbortController`.
- `continueOnError: true` on the stage or group allows the pipeline to keep running after failures.
- The runner aggregates output in a deterministic order regardless of parallel execution.
- Cap concurrency per group with `profiles.<name>.parallelLimit` (preferred) or `QUALITY_PARALLEL_LIMIT`. Profile values win when both are set.

#### Telemetry for stage timing

- Set `QUALITY_TELEMETRY=stdout` (or `file`) to emit run metadata that includes the resolved `parallelLimit`, its source, and a `stageTiming` summary (pipeline duration, aggregate stage time, longest stage, and per-stage timing with group ids).
- Compare `stageTiming` fields across runs with different `parallelLimit` values to understand contention on constrained hosts; a large gap between `serialDurationMs` and `pipelineDurationMs` indicates effective parallelism.
- Use the metadata to validate low-power profiles: keep the same stage ordering and results while monitoring whether tighter caps reduce wall-clock duration or stabilize CI throughput.

##### Analyzing telemetry output

- Run `quality telemetry analyze --file <path>` (defaults to `./quality-telemetry.log`) to summarize stage timing by `parallelLimit` and its source. Add `--profile <name>` or `--context <substring>` to focus on specific runs, `--success-only` to exclude failures, and `--json` for machine-readable output.
- Inspect the `parallel ratio` column (`pipelineDurationMs / serialDurationMs`) to gauge how much parallelism you gain at each limit. Lower values indicate better overlap (for example, `0.5x` beats `1.0x`, which is purely serial execution).
- Capture and compare summaries from low-power hosts when tuning `parallelLimit`: if a tighter cap improves efficiency without lowering success rate, prefer the smaller limit for that profile.

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
| `output` | Optional object that enables quiet logging. Supports `preset` (`bun-test`, `playwright`, `turbo`), `mode` (`passthrough` or `errors-only`), pattern overrides, and `showOnSuccess`/`showOnFailure` toggles. |

The adapter collects stdout/stderr per command, respects pipeline abort signals, and reports timeouts with structured details.

When `output` is configured the adapter streams stdout/stderr through the
command-output filter and only emits the filtered lines (for example, failing
bun:test assertions). Passing stages can suppress logs entirely by setting
`showOnSuccess: "none"`, keeping `quality check` output tight even when the
underlying command is noisy. Set `QUALITY_SHOW_ALL_OUTPUT=1` or pass
`--show-command-output` to the CLI to bypass filtering for a given run.

### Extending adapters

Add custom adapters by exporting modules that return a `StageAdapter`:

```ts
// tools/quality/custom-adapter.ts
import type { StageAdapter } from "@codegeneai/quality";

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
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "adapters": ["./tools/quality/custom-adapter.ts"],
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

The bundled JSON Schema (`@codegeneai/quality/schemas/qualityrc.schema.json`) describes:

- Root keys (`$schema`, `adapters`, `stages`, `profiles`, `reporters`, `hooks`).
- Built-in adapter option specs (imports/bun-native/filenames/structure/no-root-barrel/command).
- Group metadata, parallel semantics, and hook specs.

Unit tests use a vendored JSON Schema validator to ensure sample `.qualityrc` files remain compliant. Point editors at the relative schema path (`./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json`) or host the schema at `$id` for global distribution.

## CLI reference

```
Usage: quality <command> [options]

Commands:
  quality check [-a|--auto-fix] [--no-auto-fix] [--profile <name>] [--files <glob>] [--stage <id>] [--reporter <name>] [--json <path>]
  quality run --stage <id> [--mode check|fix|report] [--files <glob>]
  quality list [--adapters]
  quality validate-config [--profile <name>] [--stage <id>]
  quality config validate [--shard-dir <dir>]
  quality config print [--compact]
  quality init [--cwd <path>]
  quality telemetry analyze [--file <path>] [--profile <name>] [--context <substring>] [--success-only] [--json]
```

Highlights:

- `quality list` prints the resolved pipeline. `quality list --adapters` shows registered adapters, supported modes, and preset descriptions.
- `-a` / `--auto-fix` runs fixable stages before verification (with `--no-auto-fix` to disable); set `autoFix: true` on a profile to default to this behaviour.
- `quality validate-config` outputs the merged profile JSON, or a specific stage via `--stage`.
- `quality run --stage` executes a single stage ad-hoc (useful for command adapters or debugging).
- `--reporter` can be repeated; `--json <path>` adds the JSON reporter automatically.
- Use Husky to wire git hooks to the profiles you define (see Husky section above); the quality CLI does not manage `.git/hooks` directly.

## Nested configs

Place additional `.qualityrc` files within packages to customize presets or append stages for that subtree. The loader merges configs in this order:

1. Repository root `.qualityrc`.
2. Profile inheritance (`extends`).
3. Nested `.qualityrc` files closest to the targeted files.
4. Stage-level overrides.

Adapters declared in nested configs are registered automatically.

## Development

```bash
git clone https://github.com/CodeGeneAI/quality.git
cd quality
bun install
bun run test:unit
```

- Type check: `bun run typecheck`
- Lint: `bun run lint`
- Unit tests: `bun run test:unit`
- Avoid `bun test`; it runs an unintended scope. Always execute `bun run test:unit` for reliable results.

Tests live alongside the source (e.g., `src/pipeline/runner.unit.test.ts`). Fixtures under `test/fixtures/**` exercise loader behaviours, preset inheritance, and schema validation.

Run `quality check` before publishing changes to ensure reporters, hooks, and adapters remain functional.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, conventional-commit conventions, and how to add a new stage adapter. Security issues should be reported privately via [GitHub Security Advisories](https://github.com/CodeGeneAI/quality/security/advisories/new) — see [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) © CodeGeneAI
