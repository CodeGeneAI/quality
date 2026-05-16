# `import-extensions`

> Import extension enforcement.

**Type:** `imports`
**Modes:** `check`, `fix`, `report`

## What it does

Walks every `.ts` / `.tsx` file via the TypeScript parser, finds
relative import specifiers, and fails if they don't carry an explicit
file extension. Strict ESM, Node 20+ ESM resolution, and modern
bundlers all require explicit extensions on relative imports — running
this adapter in `fix` mode rewrites the imports for you so the codebase
stays buildable as the ecosystem tightens around the standard.

The adapter forbids legacy extensions (`.js`, `.jsx`, `.mjs`, `.cjs`)
on TypeScript imports, treating them as the same violation as a missing
extension. The fixer canonicalises to `.ts` / `.tsx`.

> **Note:** The file is named `import-extensions.ts` in the source tree
> but the registered `type` is `imports` (the short form used in
> `.qualityrc.jsonc` pipelines).

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:imports",
          "type": "imports",
          "overrides": {
            "verbose": true,
            "severity": "error"
          }
        }
      ]
    }
  }
}
```

## Options

- **`allowlist`** (`Record<string, string[] | string>`) — per-file allowance map. Key is a relative file path (or `"*"` for global), value is a list of import specifiers that may keep their extension-less form.
- **`verbose`** (`boolean`, default `false`) — emit one line per violation rather than a packed summary.
- **`severity`** (`"error" | "warn"`, default `"error"`) — fail vs. warn on violations.

## Example output

Success:

```
[imports] passed (312 files scanned)
```

Failure:

```
[imports] failed
  src/server.ts:3   from "./router"        → add ".ts"
  src/widget.tsx:7  from "./Button.jsx"    → use ".tsx"
  3 violations across 2 files
```

After `quality fix`:

```
[imports] passed (3 imports rewritten)
```

## See also

- [`bun-native`](./bun-native.md) — another import-shape rule;
  pairs well in the same fast group.
- [`filenames`](./filenames.md) — keeps file-extension conventions
  consistent on the disk side.
