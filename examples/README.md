# Examples

Copy-pasteable `.qualityrc.jsonc` configurations for common scenarios. Each
example is a self-contained directory with a working config and a focused
README that explains what it shows, who it's for, and how to drop it into
your own repo.

| Example | What it shows |
| --- | --- |
| [`monorepo-pre-commit/`](./monorepo-pre-commit) | Three profiles (`local`, `pre-commit`, `pre-push`) wired to Husky, with fast auto-fix on commit and heavier checks on push. |
| [`typescript-strict/`](./typescript-strict) | Single-package TypeScript-strict library: import-extensions, filenames, unit-adjacency, plus a `command` stage running `tsgo --noEmit`. |
| [`changeset-guard/`](./changeset-guard) | Monorepo release-discipline guard that warns when changed packages have no changeset. |
| [`parallel-groups/`](./parallel-groups) | Fast checks run as a parallel group; slow checks run sequentially after. Demonstrates fail-fast within a group. |
| [`custom-adapter/`](./custom-adapter) | Registers a local `StageAdapter` via the `adapters` array — the extension point for project-specific checks. |

## Run an example

Pick a directory, copy the two files into the root of your repo, and run:

```bash
bun add -D @codegeneai/quality
bun x quality check
```

To run a specific profile:

```bash
bun x quality check --profile pre-commit
```

To run with the workspace report instead of just changed files:

```bash
bun x quality check --files-mode workspace
```

Every config in this folder starts with a `$schema` reference pointing at
the npm subpath export — keep that line and your editor will give you
inline IntelliSense for every option.
