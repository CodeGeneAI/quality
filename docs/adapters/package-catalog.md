# `package-catalog`

> Enforce `catalog:<name>` dependency versions.

**Type:** `package-catalog`
**Modes:** `check`, `fix`, `report`

## What it does

Reads the root `package.json`'s `catalogs` block (the Bun / pnpm catalog
mechanism for sharing dependency versions across a monorepo) and walks
every `package.json` matched by the `packages` glob. For each dependency
that appears in some catalog, the adapter requires the package to
reference it as `"catalog:<name>"` instead of pinning its own version.
In `fix` mode the version is rewritten in place.

The check skips workspace specifiers (`workspace:*`) and entries listed
in `allowlist`, so legitimately divergent packages don't get flagged.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "deps:catalog",
          "type": "package-catalog",
          "overrides": {
            "packages": ["packages/*/package.json", "apps/*/package.json"],
            "sections": ["dependencies", "devDependencies"],
            "allowlist": ["typescript"]
          }
        }
      ]
    }
  }
}
```

## Options

- **`packages`** (`readonly string[]`) — glob patterns for the `package.json` files to scan. No default — pipeline that doesn't set this is a no-op.
- **`sections`** (`readonly ("dependencies" | "devDependencies" | "peerDependencies")[]`, default all three) — which dependency sections to enforce.
- **`allowlist`** (`readonly string[]`) — dependency names that may use a literal version even when present in a catalog.
- **`rootCatalogPath`** (`string`, default `"package.json"`) — path to the file that holds the `catalogs` block.

## Example output

Success:

```
[package-catalog] passed (12 packages, all aligned)
```

Failure:

```
[package-catalog] failed
  packages/ui/package.json
    dependencies.react: "18.3.1" must be "catalog:" (catalog has react@18.3.1)
  apps/web/package.json
    devDependencies.typescript: "5.8.2" must be "catalog:tooling"
```

## See also

- [`package-scripts`](./package-scripts.md) — sibling adapter for
  per-package `package.json` rules.
