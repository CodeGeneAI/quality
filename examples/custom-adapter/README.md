# Custom adapter

## What this shows

How to register a project-specific check by implementing the
`StageAdapter` interface and listing the module in the `adapters` array
of `.qualityrc.jsonc`. The adapter is the extension point — once
registered, your `type` is a first-class citizen in `stages` and
`pipeline`.

The adapter contract is small. Every adapter must export an object that
matches:

```ts
interface StageAdapter<TOptions = unknown> {
  readonly type: string;        // the value used in pipeline[].type
  readonly label: string;
  readonly description?: string;
  readonly supportsModes?: readonly ("check" | "fix" | "report")[];
  readonly supportsSandbox?: boolean;
  readonly supportsPartialFiles?: boolean;
  run(context: StageExecutionContext<TOptions>):
    Promise<StageExecutionResult>;
}
```

The module can default-export `{ adapters: [...] }`, a single adapter,
or an array of adapters — the loader accepts all three shapes. See
`src/adapters/types.ts` in the published package for the exact type.

## Who it's for

Anyone with a one-off, project-specific lint that doesn't deserve a
whole new tool — a "make sure every README has a Quickstart heading"
check, a license-header validator, a vendored-library version pin, etc.

## How to use

1. Copy both files (`.qualityrc.jsonc` and `custom-adapter.ts`) to the
   root of your repo.
2. Install the package:
   ```bash
   bun add -D @codegeneai/quality
   ```
3. Run the pipeline:
   ```bash
   bun x quality check
   ```
4. Edit `custom-adapter.ts` to do real work: read files via
   `context.files`, return `{ status: "failed", messages: [...] }` on a
   violation, or `{ status: "passed" }` when everything's fine.
