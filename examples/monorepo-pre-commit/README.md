# Monorepo pre-commit + pre-push

## What this shows

Three `.qualityrc.jsonc` profiles wired to Husky:

- **`local`** — the baseline that devs run by hand with `bun x quality check`.
- **`pre-commit`** — a fast subset (`bun-native` + `filenames`) with
  `autoFix: true` and `filesMode: staged`, so it only touches the files the
  commit will create and silently fixes what it can.
- **`pre-push`** — the heavier set: adjacency, imports, and a `command`
  stage that runs `tsgo --noEmit`. Uses `extends: local` so the baseline
  stages run first.

Note the `pipelineStrategy: replace` on `pre-commit` — without it, `extends`
would append on top of the inherited pipeline. With `replace`, the
pre-commit profile only runs what it lists.

## Who it's for

Monorepo teams who want a tight commit loop (sub-second on a typical diff)
but still demand a full check before code leaves the developer's machine.

## How to use

1. Copy `.qualityrc.jsonc` to the root of your repo.
2. Install the package:
   ```bash
   bun add -D @codegeneai/quality
   ```
3. Wire it into Husky (`.husky/pre-commit` and `.husky/pre-push`):
   ```bash
   # .husky/pre-commit
   bun x quality check --profile pre-commit --files-mode staged

   # .husky/pre-push
   bun x quality check --profile pre-push
   ```
4. Sanity check both profiles manually:
   ```bash
   bun x quality check --profile pre-commit
   bun x quality check --profile pre-push
   ```
