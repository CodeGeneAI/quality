# Adapter reference

Every quality stage is powered by an **adapter**. The adapter declares
what work to do, which modes it supports (`check`, `fix`, `report`), and
the option shape it accepts. In your `.qualityrc.jsonc`, the `type` field
on each pipeline stage names the adapter to run.

| Adapter | `type` | One-liner |
| --- | --- | --- |
| [barrel-exports](./barrel-exports.md) | `barrel-exports` | Prevent barrel exports in client packages. |
| [biome-config](./biome-config.md) | `biome-config` | Validate per-package Biome configuration. |
| [biome-ignore](./biome-ignore.md) | `biome-ignore` | Migrate ESLint disable comments to Biome's ignore syntax. |
| [bun-native](./bun-native.md) | `bun-native` | Enforce Bun-native APIs over Node built-ins. |
| [changeset-guard](./changeset-guard.md) | `changeset-guard` | Require a `@changesets/cli` entry for every changed package. |
| [command](./command.md) | `command` | Run an arbitrary shell command as a pipeline stage. |
| [dockerfile-required](./dockerfile-required.md) | `dockerfile-required` | Guarantee every app and service ships a `Dockerfile`. |
| [dotenv-plaintext](./dotenv-plaintext.md) | `dotenv-plaintext` | Keep public env keys (frontend prefixes, bootstrap vars) plaintext. |
| [dotenv-secrets](./dotenv-secrets.md) | `dotenv-secrets` | Block committed plaintext secrets in `.env` files. |
| [filenames](./filenames.md) | `filenames` | Enforce `*.unit.spec.ts` / `*.int.spec.ts` test filename convention. |
| [import-extensions](./import-extensions.md) | `imports` | Require explicit `.ts`/`.tsx` extensions on relative imports. |
| [package-catalog](./package-catalog.md) | `package-catalog` | Enforce `catalog:` versions for shared dependencies. |
| [package-scripts](./package-scripts.md) | `package-scripts` | Require a set of named scripts in each workspace `package.json`. |
| [structure](./structure.md) | `structure` | Assert workspace files exist (or don't) via glob rules. |
| [unit-adjacency](./unit-adjacency.md) | `unit-adjacency` | Require unit tests live next to the files they cover. |

> **Note:** `import-extensions` is the file/folder name, but its
> registered `type` is `imports`. The `type` is what you put in
> `pipeline[].type`.

## Writing your own adapter

See [`examples/custom-adapter/`](../../examples/custom-adapter) for a
working template. The minimum interface is in `src/adapters/types.ts`:

```ts
export interface StageAdapter<TOptions = unknown> {
  readonly type: string;
  readonly label: string;
  readonly description?: string;
  readonly supportsModes?: readonly ("check" | "fix" | "report")[];
  readonly supportsSandbox?: boolean;
  readonly supportsPartialFiles?: boolean;
  run(context: StageExecutionContext<TOptions>):
    Promise<StageExecutionResult>;
}
```

Register it by listing the file in the top-level `adapters` array of
your `.qualityrc.jsonc`.
