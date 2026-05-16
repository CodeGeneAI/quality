# Programmatic API

Everything documented here is exported from the package entry
(`@codegeneai/quality`). The CLI sits on top of these same exports —
nothing the CLI does requires private API. Imports should always go
through the package name, never via relative paths into
`node_modules/@codegeneai/quality/...`.

```ts
import { runPipeline, loadQualityConfig } from "@codegeneai/quality";
```

The subpath exports declared in `package.json` are:

| Subpath | What's there |
| --- | --- |
| `@codegeneai/quality` | All programmatic exports below. |
| `@codegeneai/quality/cli` | `createQualityCli()` factory for embedding the CLI in your own binary. |
| `@codegeneai/quality/schemas/qualityrc.schema.json` | JSON Schema for `.qualityrc.jsonc`. |
| `@codegeneai/quality/schemas/quality.schema.json` | Top-level meta-schema. |

## Adapter authoring

### `StageAdapter<TOptions = unknown>`

The single interface every stage adapter implements.

```ts
import type { StageAdapter, StageExecutionResult } from "@codegeneai/quality";

export const myAdapter: StageAdapter<{ paths: readonly string[] }> = {
  type: "my-check",
  label: "My custom check",
  description: "Asserts something about the files we care about.",
  supportsModes: ["check"],
  supportsPartialFiles: true,
  async run(ctx): Promise<StageExecutionResult> {
    const offenders = ctx.files.filter((f) => /* ... */ false);
    return offenders.length === 0
      ? { status: "passed" }
      : { status: "failed", messages: offenders.map((f) => `bad: ${f}`) };
  },
};
```

Fields:

- `type` — string id matched against `pipeline[].type` in user config.
- `label` — short human label used by reporters.
- `description` — optional long-form description.
- `supportsModes` — subset of `"check" | "fix" | "report"`; absent means all modes.
- `supportsSandbox` — opt-in flag for sandboxed execution environments.
- `supportsPartialFiles` — `true` if the adapter can operate on a filtered subset of files.

### `StageExecutionContext<TOptions>`

The argument passed to `adapter.run`. Holds the workspace root, the
resolved options object, the file list, an `AbortSignal`, and the
pipeline mode (`check`/`fix`/`report`).

### `StageExecutionResult`

What `adapter.run` returns: a `status`
(`"passed" | "failed" | "skipped" | "dry-run"`), optional `messages`
(human-readable bullets), and optional `details` (structured data
copied into reporter output verbatim).

### `StageAdapterModuleExport`

A relaxed shape that adapter module files can use as their default
export. Accepts a single adapter, an array of adapters, or an object
with an `adapters` field.

```ts
import type { StageAdapterModuleExport } from "@codegeneai/quality";

const exports: StageAdapterModuleExport = { adapters: [myAdapter] };
export default exports;
```

## Adapter registry

### `registerBuiltInAdapters()`

Registers all 15 built-in adapters into the in-memory registry. Call
this once at startup before running a pipeline.

```ts
import { registerBuiltInAdapters } from "@codegeneai/quality";

registerBuiltInAdapters();
```

### `loadAdapterModule(modulePath)`

Imports a module by path and registers any `StageAdapter`s it exports.
Used by the loader for the `adapters` array in `.qualityrc.jsonc`.

```ts
import { loadAdapterModule } from "@codegeneai/quality";

await loadAdapterModule("./adapters/my-check.ts");
```

### `getAdapter(type)`

Returns the registered adapter for a given `type` string, or `undefined`.

### `listAdapters()`

Returns an array of every currently-registered adapter. Useful for
`quality list` style introspection.

### `resetAdapters()`

Clears the registry. Mostly used in tests and in the CLI's per-run
re-registration flow.

## Config loading

### `loadQualityConfig(options?)`

Reads `.qualityrc[.jsonc]` from the workspace root, merges in any
profile shards, resolves `extends` chains, and returns a frozen
`ResolvedConfig`.

```ts
import { loadQualityConfig, type ResolvedConfig } from "@codegeneai/quality";

const config: ResolvedConfig = await loadQualityConfig({
  profile: "ci",
  targetPaths: ["packages/ui/src/index.ts"],
});
```

Options:

- `profile` — name of the profile to resolve (defaults to `local`, or the only profile defined).
- `targetPaths` — files whose nearest enclosing config overlays should be applied.
- `shardDir` — directory to scan for `.qualityrc.<profile>.json[c]` shard files.

### `ResolvedConfig`

The merged, normalized config object the runner consumes. Key fields:
`root` (workspace root), `profile` (a `ResolvedQualityProfile` with
`pipeline`, `reporters`, `hooks`, `filesMode`, `parallelLimit`,
`autoFix`), `stageCatalog`, `ignore`, `adapters` (paths to custom
adapter modules to load).

### `FilesMode`, `ResolvedStage`, `StagePresetSpec`

Type aliases re-exported for callers that need to type their own
config-manipulation code. `FilesMode` is the string-literal union
`"staged" | "workspace" | "commits" | "none"`.

## Pipeline execution

### `runPipeline(options)`

The single entrypoint that executes a pipeline against a file list and
returns a `PipelineResult`.

```ts
import {
  loadQualityConfig,
  registerBuiltInAdapters,
  runPipeline,
  ensureReporterSpecs,
} from "@codegeneai/quality";

registerBuiltInAdapters();
const config = await loadQualityConfig({ profile: "ci" });
const result = await runPipeline({
  mode: "check",
  files: ["src/index.ts", "src/cli/commands.ts"],
  config,
  reporterSpecs: ensureReporterSpecs(config.profile.reporters),
});
console.log(result.success); // boolean
```

Required options: `mode`, `files`, `config`, `reporterSpecs`. Optional:
`stages` (override the profile's pipeline), `dryRun`, `telemetry`,
`onStageStart` / `onStageComplete` (progress hooks).

The return type `PipelineRunResult` extends `PipelineResult`:

```ts
interface PipelineResult {
  readonly profile: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stages: readonly StageResultSummary[];
  readonly success: boolean;
}
```

## Reporters

### `ensureReporterSpecs(reporters)`

Normalizes a mixed array of reporter names and `[name, options]`
tuples, falling back to `["summary"]` when empty. Use this on any
user-supplied reporter list before passing it to `runPipeline`.

```ts
import { ensureReporterSpecs } from "@codegeneai/quality";

const specs = ensureReporterSpecs([
  "summary",
  ["json", { path: "reports/quality.json" }],
]);
```

### `ReporterSpec`

Union: a reporter name (`"summary" | "json" | "junit" | "verbose"`)
or a tuple `[name, ReporterOptions?]`. `ReporterOptions` accepts
`path` (where to write file output) and `enabled` (skip the reporter
when false).

## File collection

### `collectFilesForMode(options)`

Returns the file list a given `FileCollectionMode` would produce
(`staged`, `workspace`, or `commits`). Useful for tools that want to
drive `runPipeline` with the same input set the CLI would.

```ts
import { collectFilesForMode } from "@codegeneai/quality";

const files = await collectFilesForMode({
  root: process.cwd(),
  mode: "staged",
});
```

### `FileCollectionMode`

`"staged" | "workspace" | "commits"`. Excludes the `"none"` member of
`FilesMode` because there's nothing to collect in that mode.

## Runtime helpers

### `createConsoleProgressReporter(options)`

Builds a small object with `withPhase(name)` and `stageStarted` /
`stageCompleted` callbacks suitable for plugging into
`runPipeline`'s `onStageStart` / `onStageComplete` hooks. Used by the
CLI for the live "running stage X" output.

### `isTelemetryEnabled()`

Returns true when `QUALITY_TELEMETRY` is set to a truthy value. Wrap
your own telemetry calls in this so they're a no-op when the env var
is off.

### `analyzeTelemetryFile(path, options?)` and `ParallelLimitSummary`

Reads a telemetry NDJSON file written by previous pipeline runs and
returns a summary including the `ParallelLimitSummary` (observed
concurrency vs. configured `parallelLimit`). Useful for diagnosing
"my pipeline isn't using all my cores" complaints.

## Dockerfile-required adapter (extension hooks)

The `dockerfile-required` adapter asserts every runnable workload
(every `apps/*` and `services/*` package, plus any explicit
`extraRequiredPaths`) ships a `Dockerfile`. It exposes its own
building blocks so projects can plug in a custom enumeration of
which directories must own an image contract.

### `DockerfileRequiredAdapterOptions`

The option shape consumed by `createDockerfileRequiredAdapter` and
accepted by the default adapter at `pipeline[].options`. All fields
are optional.

```ts
interface DockerfileRequiredAdapterOptions {
  /** Directory globs whose package.json-bearing descendants must ship a Dockerfile. Default: ["apps/*", "services/*"]. */
  readonly packageGlobs?: readonly string[];
  /** Additional directories that must contain a Dockerfile even though they are not picked up by packageGlobs. */
  readonly extraRequiredPaths?: readonly string[];
  /** Required filename inside each target directory. Default: "Dockerfile". */
  readonly filename?: string;
}
```

### `ResolvedDockerfileOptions`

The normalized form of `DockerfileRequiredAdapterOptions` after
defaults are applied. Passed to every `IDockerfileTargetSource` so
custom sources never have to re-derive defaults.

```ts
interface ResolvedDockerfileOptions {
  readonly packageGlobs: readonly string[];
  readonly extraRequiredPaths: readonly string[];
  readonly filename: string;
}
```

### `IDockerfileTargetSource`

The extension point. Implement this interface to add a new strategy
for discovering directories that must contain a `Dockerfile`. The
adapter dedupes paths across all registered sources before checking
the filesystem.

```ts
interface IDockerfileTargetSource {
  readonly id: string;
  collect(
    root: string,
    options: ResolvedDockerfileOptions,
    ignorePatterns: readonly string[],
  ): Promise<readonly string[]>;
}
```

### `PackageGlobTargetSource`

Default source that expands `packageGlobs` to their
`package.json`-bearing directories. Respects the adapter's
`ignorePatterns` (so common ignores like `node_modules` are excluded
automatically).

### `ExplicitPathTargetSource`

Default source that returns `extraRequiredPaths` verbatim.
Intentionally does **not** consult `ignorePatterns` — user-declared
required paths are requirements, not discovered candidates, so they
are never silently dropped.

### `createDefaultDockerfileTargetSources()`

Returns the two default sources (`PackageGlobTargetSource` then
`ExplicitPathTargetSource`) as a fresh array. Useful when you want
to compose custom sources alongside the defaults.

```ts
import {
  createDefaultDockerfileTargetSources,
  createDockerfileRequiredAdapter,
  type IDockerfileTargetSource,
} from "@codegeneai/quality";

const customSource: IDockerfileTargetSource = {
  id: "infra-modules",
  async collect() {
    return ["infra/migrator", "infra/scheduler"];
  },
};

const adapter = createDockerfileRequiredAdapter([
  ...createDefaultDockerfileTargetSources(),
  customSource,
]);
```

### `createDockerfileRequiredAdapter(sources?)`

Factory that returns a configured `StageAdapter<DockerfileRequiredAdapterOptions>`.
Pass a custom array of `IDockerfileTargetSource`s to replace the
defaults entirely, or omit the argument to use
`createDefaultDockerfileTargetSources()`.

```ts
import { createDockerfileRequiredAdapter } from "@codegeneai/quality";

// Default behavior, explicit factory call.
const adapter = createDockerfileRequiredAdapter();
```

### `dockerfileRequiredAdapter`

The default registered adapter — equivalent to calling
`createDockerfileRequiredAdapter()` with no arguments. This is what
`registerBuiltInAdapters()` wires up under the
`"dockerfile-required"` type, so most projects do not need to
reference it directly.

```ts
import { dockerfileRequiredAdapter } from "@codegeneai/quality";

// type === "dockerfile-required"
console.log(dockerfileRequiredAdapter.type);
```

Use the factory when you want a tailored variant; use the default
adapter when the built-in behavior is enough.

## Stability

The **CLI surface** (`quality check`, `quality fix`, `quality init`,
`quality list`, `quality run <stageId>`, `quality validate-config`,
`quality telemetry analyze`, the `--profile` / `--files-mode` /
`--reporter` / `--json` / `--stage` flags) is the most-stable
interface. We treat CLI flag renames and removed subcommands as
breaking changes, gated by a major version bump.

The **programmatic API** documented above is exported and supported,
but more likely to evolve before `3.0`. Specifically: signatures of
internal helpers (`createConsoleProgressReporter`,
`analyzeTelemetryFile`) and the exact field set on `ResolvedConfig`
and `ResolvedStage` may change in minor releases as we tighten the
extension points. The high-traffic surface — `StageAdapter`,
`runPipeline`, `loadQualityConfig`, `ensureReporterSpecs` — will
follow semver and gain new optional fields without removing existing
ones.

If you depend on the programmatic API in production code, pin to an
exact minor version and watch the changelog. The `StageAdapter`
interface itself is the single most stable thing in this package —
that contract is what the rest of the system is built around.

Always import from `@codegeneai/quality` (or its declared subpaths),
never from a relative path into `node_modules`. Deep imports are not
part of the public surface and will break without warning.
