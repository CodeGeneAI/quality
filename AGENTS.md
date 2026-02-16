<!-- doc-catalog:banner:start -->
> [!NOTE]
> This document participates in the Platform documentation catalog. See [documentation catalog](../../README.md#documentation-catalog) for cross-links and regeneration instructions.
<!-- doc-catalog:banner:end -->

# Workspace guidance: `@codegeneai/quality`

## Mission
Deliver a single declarative quality pipeline for the monorepo: composable stage adapters, rich schema tooling, and local/CI parity. The CLI now ships with this package directly (`quality …` via `bun x quality`).

## High-level architecture
- **CLI (hosted in this package)** – `quality …` registers the command set; programmatic APIs live alongside the adapters and loader.
- **Adapter registry (`src/adapters/`)** – registers built-in stage adapters (imports, bun-native, filenames, structure, command) and loads custom adapters declared in `.qualityrc`.
- **Config loader (`src/config/loader.ts`)** – discovers `.qualityrc` files, merges profile inheritance + nested overrides, resolves presets, adapters, reporters, hooks, and stage groups. Schema lives at `schemas/qualityrc.schema.json`.
- **Pipeline (`src/pipeline/runner.ts`)** – executes resolved stages, handles parallel groups + fail-fast semantics, honours `continueOnError`, and surfaces aggregated results to reporters.
- **Reporters (`src/reporters/*`)** – summary, json, junit, verbose. Extend by adding a module and wiring it into `runReporters`.
- **Utilities (`src/utils/*`)** – filesystem helpers, deep merge, path normalization, process execution (with abort + timeout support).

## Configuration workflows
- Root and package-level `.qualityrc` files express every pipeline behaviour (stages, presets, reporters, hooks, adapters). Always reference the checked-in schema for editor IntelliSense.
- Profiles (`local`, `ci`, etc.) should use presets whenever options are shared. Stages can join groups for parallel execution and rely on `continueOnError` or command-level `abortPipelineOnFailure` when needed.
- Custom adapters must export `StageAdapter` objects and be listed under `"adapters"` in `.qualityrc`.

## CLI usage
- `quality check|fix` runs the full pipeline (or filtered stages via `--stage`).
- `quality run --stage <id>` executes a single stage for debugging.
- `quality list --adapters` prints registered adapters with preset metadata.
- `quality validate-config` shows the merged profile/stage spec.
- `quality init` scaffolds a config with presets, groups, and command examples.
- Use Husky to wire Git hooks to quality profiles (see README for sample pre-commit/pre-push scripts with Git LFS). The quality CLI no longer manages `.git/hooks` shims.
- Telemetry toggles: `--telemetry stdout|file`, `--telemetry-file <path>`, and `--debug` populate `QUALITY_TELEMETRY*` env vars for JSON diagnostics.

## Tests & quality gates
- Run `bun --filter @codegeneai/quality lint`, `bun --filter @codegeneai/quality typecheck`, and `bun --filter @codegeneai/quality test:unit` before committing, then follow workspace gates (`bun run test:smoke` → `bun run test:int`).
- Do **not** use `bun test`; it executes the wrong scope and yields unreliable results. Always run `bun run test:unit` (or `bun --filter … test:unit`) inside the package you want to verify.
- Unit tests cover the loader, pipeline semantics (parallel fail-fast vs continue), command adapter behaviours (timeouts, aborts, shell), schema validation, and fixtures. CLI paths are exercised directly in this package.
- Integration matrix:
  - `src/runtime/telemetry.int.test.ts` verifies stdout/file emission remains stable across pipeline runs.
  - `src/runtime/telemetry.unit.test.ts` covers low-level telemetry helpers.
- Maintain fixture configs (`basic`, `presets`, `adapters`) alongside schema changes to ensure backwards compatibility.

## Release checklist
1. Update docs/README/schema when adapter behaviour changes.
2. Run the full suite locally (`quality check`) on the monorepo to catch regressions.
3. Bump the package version and refresh the lockfile as part of the release PR.

## Contacts / ownership
DX Platform owns this package. Raise issues in the quality-suite board or ping the DX on-call.
