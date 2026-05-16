# FAQ

Questions we hear when people evaluate `@codegeneai/quality`. Answers
aim to be honest and concrete; if something is rough or missing today,
we say so.

## Adoption & comparisons

### Why a new tool when Husky and lint-staged already exist?

`husky` triggers commands on git events. `lint-staged` filters the
file list down to what's staged. Neither one is a *pipeline*: there's
no shared notion of profiles, no schema validation, no per-stage modes
(`check` / `fix` / `report`), and no pluggable adapter abstraction.
This package replaces the **coordination** layer — pipelines, groups,
hooks, reporters — and is happy to be invoked *by* Husky from a
`.husky/pre-commit` script. See [`docs/comparison.md`](./comparison.md)
for the side-by-side.

### How does this differ from running Biome or ESLint directly?

Biome and ESLint are linters. They lint. This pipeline runs Biome as
one stage among many: filename conventions, import hygiene,
package-catalog checks, unit-test colocation, structural rules,
arbitrary commands, custom adapters. If your repo only needs Biome to
run on staged files, you don't need this tool — wire Biome straight
into your hook script. If you're already gluing five different
checkers together with shell scripts, this collapses that mess into
one declarative config.

### How does it compare to Lefthook, pre-commit, or Turborepo?

Lefthook and pre-commit are pipeline runners with YAML configs; they
shell out to commands. This package adds typed adapters on top of the
command-runner pattern, plus profiles, schema validation, and an npm
distribution. Turborepo and Nx are task runners that schedule package
builds; they compose well with this — use Turbo to run
`bun x quality check` across packages in parallel. Full comparison
table in [`docs/comparison.md`](./comparison.md).

## Runtime & platform

### Does it require Bun? Can I use Node?

Yes, it requires Bun at runtime today. The CLI entrypoint is
`#!/usr/bin/env bun` and the source uses Bun-native APIs (`Bun.glob`,
`Bun.$`, etc.) without a Node fallback. The package itself can be
installed with any package manager (the `bin` field resolves
`quality`), but invoking it requires `bun` on `PATH`. A Node-runtime
build is out of scope for the foreseeable future — we picked Bun on
purpose for startup latency and the bundled shell.

### Does it support Windows?

Mixed. The pure-TypeScript adapters (`imports`, `filenames`,
`structure`, `unit-adjacency`, `bun-native`, `barrel-exports`,
`package-catalog`, `package-scripts`, `biome-config`, `biome-ignore`)
work anywhere Bun runs. The `command` adapter uses Bun's shell, which
behaves consistently across platforms for the simple cases but can
surface differences with complex pipes or POSIX-isms. WSL is the
safest path on Windows today. If you hit a Windows-specific bug,
please file an issue with the failing command.

### What's the minimum Bun version?

Bun 1.3.0 or later (see `engines.bun` in `package.json`). CI builds
against 1.3.14.

## Configuration & usage

### Can I use it without Biome?

Yes. Biome is referenced by the `biome-config` and `biome-ignore`
adapters, but you don't have to enable either. The pipeline is just
"a list of stages"; pick the ones you want. A minimal config with
only a single `command` stage running `tsc --noEmit` is valid.

### Do you support pre-commit and pre-push hooks?

Yes — but indirectly. The package doesn't install git hooks itself.
You wire it up via Husky (or any other hook manager) and call
`bun x quality check --profile pre-commit` (or `pre-push`) from the
hook script. See [`examples/monorepo-pre-commit/`](../examples/monorepo-pre-commit/)
for a working setup. The reason we don't install hooks is that hook
management is a separate concern with strong existing tools (Husky,
Lefthook); we don't want to compete on that axis.

### How do shards and profiles work?

A **profile** is a named pipeline. You define them under `profiles`
in `.qualityrc.jsonc` (`local`, `ci`, `pre-commit`, whatever you
want). Profiles can `extends` each other to share stages. A
**shard** is a sibling file like `.qualityrc.ci.jsonc` that defines
overrides for a single profile; the loader auto-discovers them and
merges them in. Shards let you keep the base config small while
adding CI-only stages without `extends` plumbing.

### What's the JSON output schema?

`--json reports/quality.json` (or adding the `json` reporter) writes
the full `PipelineResult` object: `profile`, `startedAt`,
`finishedAt`, `success`, and `stages` — an array of `StageResultSummary`
entries with `id`, `type`, `label`, `preset`, `group`, `status`
(`passed | failed | skipped | dry-run`), `durationMs`, `messages`,
and `details`. See `src/reporters/types.ts` for the canonical
TypeScript types — they're exported and stable. JUnit XML is also
available via the `junit` reporter for CI test-result panels.

### How do I disable a single check temporarily?

Three options, roughly in order of preference:

1. Run a subset of stages: `bun x quality check --stage lint:imports --stage lint:filenames`.
2. Make the stage a no-op for one profile by overriding it in a
   `.qualityrc.<profile>.jsonc` shard with `continueOnError: true`
   or a narrower `files` glob.
3. Comment out the stage in the pipeline. Honest and obvious — fine
   for short-lived experiments.

There's no `// quality-disable-next-line` style escape hatch and we
don't plan to add one. The pipeline is configured in one place; keep
it there.

### Is there a watch mode?

Not today. The CLI runs end-to-end on each invocation. Pair it with
your editor's "save and run task" feature or with `entr`/`watchexec`
if you want file-change re-runs. Open to discussion — please file a
feature request with the use case so we can design the right thing.

## Monorepos & extensibility

### How do I run it in CI?

Same binary, different profile. Minimal GitHub Actions step:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: 1.3.14
- run: bun install --frozen-lockfile
- run: bun x quality check --profile ci --files-mode workspace
```

`--files-mode workspace` checks every tracked file; the default
`staged` mode is only useful in a pre-commit hook. Set
`--json reports/quality.json` if you want to upload the result as an
artifact, or use the `junit` reporter for native test-result UI.

### What about monorepos with multiple packages?

This is the primary design target. Run it from the repo root with
one `.qualityrc.jsonc`; the file-collection step gives every adapter
the full changed-file list and each adapter scopes itself by glob
(`packages/*/src/**/*.ts`). The `package-catalog`,
`package-scripts`, and `dockerfile-required` adapters were written
specifically for monorepo invariants — required scripts in every
workspace, single source of truth for shared dependency versions,
Dockerfile present in every deployable.

### How do I add a custom adapter?

Implement the `StageAdapter` interface, export it from a file in
your repo, and list that file in the top-level `adapters` array of
`.qualityrc.jsonc`. Working template:
[`examples/custom-adapter/`](../examples/custom-adapter/). The
interface is six fields plus a `run(context)` method that returns
`{ status, messages, details }`. See [`docs/api.md`](./api.md) for
the type signatures and [`docs/adapters/README.md`](./adapters/README.md)
for how the built-ins are structured.

### How do I contribute a new built-in adapter?

Three things make an adapter built-in candidate material:

1. It addresses a check that's plausibly relevant to many repos, not
   just one organization's conventions.
2. It has a clear failure mode the user can act on (the error
   message points at the specific file and the specific rule).
3. It ships with unit tests (`*.unit.test.ts`) covering the pass,
   fail, and edge cases.

Open an issue with a sketch first — we'd rather discuss the
abstraction than rewrite a PR. Then follow `CONTRIBUTING.md`.

### Can I use it as a library, not a CLI?

Yes — the programmatic API is exported from the package root.
`loadQualityConfig`, `runPipeline`, the adapter registry helpers,
the reporter spec validator, and the file-collection helpers are
all callable. See [`docs/api.md`](./api.md) for the surface and
stability notes. The CLI is the most-stable interface; the
programmatic API may shift before 3.0.
