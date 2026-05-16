# `filenames`

> Test filename lint.

**Type:** `filenames`
**Modes:** `check`, `fix`, `report`

## What it does

Enforces a single canonical naming convention for test files. By default
the adapter scans `**/*.spec.ts(x)` and `**/*.test.ts(x)` and requires
the explicit `unit` or `int` qualifier (`*.unit.spec.ts`,
`*.int.spec.ts`). It can be configured with custom rename rules — for
example, "any `*.test.ts` is renamed to `*.unit.spec.ts`".

In `fix` mode, matching files are renamed via the filesystem (using a
preserve-semantics rename so the file isn't lost on crash). The pair
adapter [`unit-adjacency`](./unit-adjacency.md) then enforces *where*
those renamed files live.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:filenames",
          "type": "filenames",
          "overrides": {
            "include": ["**/*.spec.ts", "**/*.test.ts"],
            "patterns": ["**/*.unit.spec.ts", "**/*.int.spec.ts"],
            "rename": [
              { "match": "**/*.test.ts", "replace": "$1.unit.spec.ts" }
            ]
          }
        }
      ]
    }
  }
}
```

## Options

- **`patterns`** (`readonly string[]`, default `["**/*.unit.spec.ts(x)", "**/*.int.spec.ts(x)"]`) — accepted filename patterns. A scanned file passes if it matches at least one.
- **`include`** (`readonly string[]`, default `["**/*.spec.ts(x)", "**/*.test.ts(x)"]`) — patterns that select files to scan in the first place.
- **`ignore`** (`readonly string[]`) — extra glob patterns to skip on top of the built-in defaults.
- **`severity`** (`"error" | "warn"`) — fail vs. warn on violations.
- **`rename`** (`readonly { match: string; replace: string }[]`) — rules applied in `fix` mode to rewrite filenames.

## Example output

Success:

```
[filenames] passed (42 test files conform)
```

Failure:

```
[filenames] failed
  src/auth/login.test.ts: does not match any accepted pattern
  src/widget.spec.tsx: does not match any accepted pattern
```

After `quality fix`:

```
[filenames] passed (2 files renamed: login.test.ts → login.unit.spec.ts, widget.spec.tsx → widget.unit.spec.tsx)
```

## See also

- [`unit-adjacency`](./unit-adjacency.md) — enforces that `*.unit.spec.ts`
  files live next to their subject.
