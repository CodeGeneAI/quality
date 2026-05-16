# TypeScript-strict library

## What this shows

A `.qualityrc.jsonc` for a single-package TypeScript library with
`strict: true`. The pipeline pairs three lightweight repo-shape adapters
(`imports`, `filenames`, `unit-adjacency`) with a `command` stage that
runs `tsgo --noEmit` as the real type checker.

Two details worth copying:

- **`alwaysRun: true`** on the typecheck stage — required because tsgo
  evaluates the whole project graph and would otherwise be skipped when
  no source files match.
- **`output.showOnSuccess: "none"`** — the `summary` reporter stays quiet
  on green runs and only dumps tsgo output when the stage fails.

## Who it's for

Library authors who treat TypeScript strictness as a non-negotiable, want
fast structural lints before a slow type check, and prefer one tool over
juggling `tsc`, eslint, and a hand-written check script.

## How to use

1. Copy `.qualityrc.jsonc` to the root of your repo.
2. Install the package and tsgo:
   ```bash
   bun add -D @codegeneai/quality @typescript/native-preview
   ```
3. Run the pipeline:
   ```bash
   bun x quality check
   ```
4. (Optional) Drop the `command` stage if you'd rather call `tsgo` from
   a separate npm script — the other three adapters are useful on their own.
