# Comparison

`@codegeneai/quality` overlaps with several well-known tools. This page
explains what overlaps, what doesn't, and where each alternative is a
better fit. The honest summary: this package is a *pipeline runner with
typed adapters* sitting one layer above raw linters and one layer below
build-graph orchestrators. It composes with most of them rather than
replacing them.

## Table

| Axis | `@codegeneai/quality` | Husky + lint-staged | Lefthook | Biome (raw) | Turborepo / Nx |
| --- | --- | --- | --- | --- | --- |
| Language | TypeScript | JS (Husky), JS (lint-staged) | Go | Rust | Go / TS |
| Runtime | Bun | Node | Native binary | Native binary | Node / native |
| Config format | JSONC + JSON Schema | `package.json` + shell | YAML | JSON | JSON / TS |
| Primary unit | Stage adapter | Glob -> command | Hook -> command | Rule | Task |
| Adapter pattern | Yes (`StageAdapter`) | No | No | N/A | No |
| Parallel execution | Per-group, configurable | No (sequential) | Yes (per-hook) | Single-process | Yes (task graph) |
| Reporters | summary / json / junit / verbose | Plain stdout | Plain stdout | stylish / json / sarif | Turbo summary |
| Profiles | First-class | None | Multiple hook files | None | Pipeline tasks |
| Schema validation | Bundled JSON Schema | None | None | Yes (Biome config) | Yes (turbo.json) |
| OSS license | MIT | MIT | MIT | Apache-2.0 (Biome) | MPL-2.0 / MIT |

## Husky + lint-staged

**What overlaps.** Both want to run quality checks before commits and
filter to staged files. `lint-staged` even has a primitive notion of
"glob -> command" that this pipeline generalizes.

**What's different.** `husky` and `lint-staged` are coordination tools
without typed stage abstractions, profiles, schema validation, or a
notion of `check` vs. `fix` vs. `report` modes. Adding a new check
means editing the `lint-staged` block in `package.json` and possibly
writing a shell wrapper. Adding a new check here means dropping in a
stage entry and (optionally) a custom adapter.

**Recommended pairing.** Keep Husky as the hook *trigger* —
`.husky/pre-commit` can be a one-liner that runs
`bun x quality check --profile pre-commit`. Drop `lint-staged`; the
pipeline's `filesMode: "staged"` handles the same job and gives every
stage uniform access to the changed files. See
[`examples/monorepo-pre-commit/`](../examples/monorepo-pre-commit/).

## Lefthook

**What overlaps.** Both are pipeline runners that fan out commands and
support pre-commit / pre-push contexts. Both bias toward declarative
config rather than scripting.

**What's different.** Lefthook is YAML-driven and written in Go, with
no abstraction over the commands it runs — every step is a shell
invocation. This package adds a typed `StageAdapter` interface that
encapsulates option schemas, mode support, and file matching, and
ships a JSON Schema that gives editors autocomplete and validation
out of the box. The tradeoff: Lefthook is a single static binary
with zero runtime dependencies, while this package requires Bun on
`PATH`.

**Recommended pairing.** Pick one. If you want a typed
extension model and a real programmatic API, use this. If you want a
zero-dep static binary and your checks are all "run this shell
command on these files", use Lefthook.

## Running Biome directly

**What overlaps.** Both can lint and format your codebase. The
`biome-config` and `biome-ignore` adapters here even read Biome's own
configuration files.

**What's different.** Biome is one stage in this pipeline, not a
competitor to it. The pipeline adds: multi-stage orchestration,
profiles for different contexts (local vs. CI), parallel group
execution, hooks that fire on success/failure, multiple reporter
outputs, and adapters for checks Biome doesn't perform (filename
conventions, package-catalog enforcement, unit-test colocation,
Dockerfile-presence, dotenv hygiene).

**Recommended pairing.** If your only quality check is "run Biome on
staged files," skip this package and call Biome from a Husky hook
directly — you'll save the install. If you have five checks to
coordinate and want them to share files, profiles, and reporters,
this is the layer for that.

## Turborepo / Nx run-many

**What overlaps.** Both can run tasks across packages in a monorepo
with caching. Both produce structured output.

**What's different.** Turborepo and Nx are *build graph* runners.
They schedule tasks based on dependency edges and cache outputs.
This package is a *quality pipeline* runner — it doesn't model task
graphs, doesn't cache, and doesn't track outputs. It cares about
running an ordered list of checks once per invocation and producing
a clear pass/fail.

**Recommended pairing.** Compose them. Define `quality` as a task in
`turbo.json` and have Turbo invoke `bun x quality check` per package
in parallel — Turbo handles fan-out and caching across packages,
this package handles what to actually check within each package.
Or, for a single root config that sees the whole monorepo at once,
skip Turbo for the quality task and run this directly from the root.

## When you don't need this package

- You have a single linter (Biome or ESLint) and no other checks: call
  the linter directly from your hook.
- Your hooks are three lines of shell and you're happy with that: stay
  there.
- You're on Node-only and can't introduce Bun as a build-time
  dependency: this package isn't a fit today.

Use this when your `package.json` `scripts` section is sprouting
`lint:foo`, `lint:bar`, `check:baz` entries and a fragile shell wrapper
that chains them together. That's the failure mode this collapses.
