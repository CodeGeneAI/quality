# Workspace guidance: `@codesynth-labs/quality`

## Mission
Deliver a single declarative quality pipeline for the monorepo: one CLI, composable stage adapters, rich schema tooling, and local/CI parity.

## High-level architecture
- **CLI (`src/cli/index.ts`)** – clipanion-powered interface exposing `check`, `fix`, `run`, `list`, `validate-config`, and `init`. Binaries under `bin/` wrap the CLI for backwards-compatible command names (imports, bun-native, filenames, quality-suite).
- **Adapter registry (`src/adapters/`)** – registers built-in stage adapters (biome, imports, bun-native, filenames, structure, no-root-barrel, command) and loads custom adapters declared in `.qualityrc`.
- **Config loader (`src/config/loader.ts`)** – discovers `.qualityrc` files, merges profile inheritance + nested overrides, resolves presets, adapters, reporters, hooks, and stage groups. Schema lives at `schemas/qualityrc.schema.json`.
- **Pipeline (`src/pipeline/runner.ts`)** – executes resolved stages, handles parallel groups + fail-fast semantics, honours `continueOnError`, and surfaces aggregated results to reporters.
- **Reporters (`src/reporters/*`)** – summary, json, junit, verbose. Extend by adding a module and wiring it into `runReporters`.
- **Utilities (`src/utils/*`)** – filesystem helpers, deep merge, path normalization, process execution (with abort + timeout support).

## Configuration workflows
- Root and package-level `.qualityrc` files express every pipeline behaviour (stages, presets, reporters, hooks, adapters). Always reference the checked-in schema for editor IntelliSense.
- Profiles (`local`, `ci`, etc.) should use presets whenever options are shared. Stages can join groups for parallel execution and rely on `continueOnError` or command-level `abortPipelineOnFailure` when needed.
- Custom adapters must export `StageAdapter` objects and be listed under `"adapters"` in `.qualityrc`.

## CLI usage
- `quality check|fix` run the full pipeline (or filtered stages via `--stage`).
- `quality run --stage <id>` executes a single stage for debugging.
- `quality list --adapters` prints registered adapters with preset metadata.
- `quality validate-config` shows the merged profile/stage definition.
- `quality init` scaffolds a config with presets, groups, and command examples.
- `quality hooks install|list|uninstall` manage `.git/hooks/*` scripts (idempotent; `--force` overrides unmanaged scripts). `quality hooks install` skips instantly when the managed scripts already match; the workspace `prepare` script runs it so hooks stay current after installs.
- `quality git-hook <name>` executes the managed hook pipeline (used by installed scripts and for manual debugging).
- CI-target commands were removed; focus on core run/list/git-hook flows.
- Telemetry toggles: `--telemetry stdout|file`, `--telemetry-file <path>`, and `--debug` populate `QUALITY_TELEMETRY*` env vars for JSON diagnostics.

## Tests & quality gates
- Run `bun --filter @codesynth-labs/quality lint`, `bun --filter @codesynth-labs/quality typecheck`, and `bun --filter @codesynth-labs/quality test:unit` before committing.
- Unit tests cover the loader, pipeline semantics (parallel fail-fast vs continue), command adapter behaviours (timeouts, aborts, shell), schema validation, fixtures, and CLI/git-hook integration.
- Integration matrix:
  - `src/cli/commands.int.test.ts` provisions temp repos to test hook installation/listing/uninstall, `git-hook`, telemetry flags, and failure paths.
  - `src/runtime/telemetry.int.test.ts` verifies stdout/file emission to keep debugging pathways reliable across hook + pipeline runs.
  - `src/runtime/telemetry.unit.test.ts` covers low-level telemetry helpers.
- Maintain fixture configs (`basic`, `presets`, `adapters`) alongside schema changes to ensure backwards compatibility.

## Release checklist
1. Update docs/README/schema when adapter behaviour changes.
2. Run the full suite locally (`quality check`) on the monorepo to catch regressions.
3. Bump the package version and refresh the lockfile as part of the release PR.

## Contacts / ownership
DX Platform owns this package. Raise issues in the quality-suite board or ping the DX on-call.
