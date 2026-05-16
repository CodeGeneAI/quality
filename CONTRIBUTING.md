# Contributing to @codegeneai/quality

Thanks for your interest in improving `@codegeneai/quality`. This document explains how to set up the project, the conventions we follow, and what to expect when opening a pull request.

## Local setup

Prerequisites: [Bun](https://bun.sh) 1.3.0 or newer. Everything else is installed by Bun.

```bash
git clone https://github.com/CodeGeneAI/quality.git
cd quality
bun install
bun run test:unit
```

Useful scripts:

- `bun run lint` — Biome (`biome check --write`) over the workspace.
- `bun run typecheck` — `tsgo --noEmit`.
- `bun run test:unit` — colocated unit tests (`*.unit.test.ts` / `*.unit.spec.ts`).
- `bun run start` — runs the CLI from source (`bun src/bin.ts`).

> **Never run bare `bun test`.** It picks up an unintended scope. Use `bun run test:unit` or pass an explicit file list.

## Conventional commits

We use [Conventional Commits](https://www.conventionalcommits.org/) and let [release-please](https://github.com/googleapis/release-please) cut releases automatically. Your commit and PR titles must use one of the prefixes below, with optional `(scope)`:

| Prefix      | Effect on release          |
| ----------- | -------------------------- |
| `feat:`     | Minor version bump         |
| `fix:`      | Patch version bump         |
| `docs:`     | No release                 |
| `chore:`    | No release                 |
| `refactor:` | No release                 |
| `test:`     | No release                 |
| `ci:`       | No release                 |
| `style:`    | No release                 |
| `perf:`     | Patch version bump         |

Breaking changes go in the commit footer (`BREAKING CHANGE: …`) or use the `!` suffix (`feat!: …`). Either triggers a major bump.

Examples:

```
feat(adapter): add lockfile-consistency stage adapter
fix(cli): exit with code 1 when no stages match --stage filter
docs: clarify shard discovery order in README
```

## Proposing a new stage adapter

Stage adapters live in `src/adapters/systems/`. Each adapter:

1. Implements the `StageAdapter` interface from `src/adapters/types.ts`.
2. Exports `type`, `label`, `description`, the supported modes (`check`, `fix`, `report`), and an async `run(context)` function.
3. Is registered in `src/adapters/register-builtins.ts`.
4. Ships a colocated unit test (`*.unit.test.ts`) — see `barrel-exports.unit.test.ts`, `unit-adjacency.unit.test.ts`, or `command.unit.test.ts` as references.
5. Updates the JSON Schema in `schemas/qualityrc.schema.json` if it accepts options.

Before opening a PR for a new adapter, please open an issue describing the problem it solves and the option surface you're proposing — it's faster to align on the shape than to rewrite a finished PR.

## Test layout

- Unit: `*.unit.test.ts` or `*.unit.spec.ts` colocated with the source file (e.g. `src/pipeline/runner.unit.test.ts`).
- Integration: `*.int.test.ts` for adapters that touch the real filesystem (see `package-catalog.int.test.ts`).
- Fixtures: `test/fixtures/**` for sample `.qualityrc` files and synthetic repos used by the loader.

New code without tests will be sent back. Prefer small, focused tests that exercise one behaviour each.

## Pull request expectations

- **Small and focused.** One concern per PR. If you find yourself touching ten files for two unrelated changes, split the PR.
- **Tests pass.** Run `bun run lint`, `bun run typecheck`, and `bun run test:unit` before pushing.
- **Conventional title.** The PR title becomes the commit subject on squash-merge; release-please reads it. Make sure the prefix is right.
- **Docs updated.** If you change a CLI flag, schema, or adapter option, update the README and the JSON Schema in the same PR.
- **No backwards-compat scaffolding unless asked.** Default is direct replacement and cleanup of old behaviour — feature flags and migration paths land only when explicitly requested.

## Reporting bugs and proposing features

- File issues using the [bug report](./.github/ISSUE_TEMPLATE/bug.yml) or [feature request](./.github/ISSUE_TEMPLATE/feature.yml) templates.
- For security vulnerabilities, follow [`SECURITY.md`](./SECURITY.md) — please do not file a public issue.
