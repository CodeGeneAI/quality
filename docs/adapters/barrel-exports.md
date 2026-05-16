# `barrel-exports`

> Prevent barrel exports in client packages.

**Type:** `barrel-exports`
**Modes:** `check`, `report`

## What it does

Scans each workspace package's `index.ts` and fails if a package that
ships React (or any other peer dependency declared as a "client
indicator") re-exports its surface area through a barrel file. Barrel
exports defeat tree-shaking in client bundles — every module in the
barrel is pulled into the consumer's graph whether it's used or not.

The check only fires for packages that declare a client-indicator
peer dependency (default: `react`, `react-dom`). Server-only packages
are ignored.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:barrel",
          "type": "barrel-exports",
          "overrides": {
            "packages": ["packages/*/package.json"],
            "clientPackageIndicators": ["react"],
            "ignore": ["@your-org/legacy-*"]
          }
        }
      ]
    }
  }
}
```

## Options

- **`packages`** (`readonly string[]`, default `["packages/*/package.json", "packages/**/package.json"]`) — glob patterns for `package.json` files to scan.
- **`clientPackageIndicators`** (`readonly string[]`, default `["react", "react-dom"]`) — peer-dependency names that mark a package as client-bundled.
- **`ignore`** (`readonly string[]`, default `[]`) — package-name globs to skip entirely.

## Example output

Success:

```
[barrel-exports] passed
```

Failure:

```
[barrel-exports] failed
  packages/ui/index.ts: barrel re-exports found in a React client package
  packages/forms/index.ts: barrel re-exports found in a React client package
```

## See also

- [`structure`](./structure.md) — if you want to forbid `index.ts` at the
  package root altogether.
- [`package-scripts`](./package-scripts.md) — sibling adapter for
  per-package `package.json` invariants.
