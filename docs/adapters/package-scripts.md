# `package-scripts`

> Validate required `package.json` scripts.

**Type:** `package-scripts`
**Modes:** `check`, `report`

## What it does

Walks every `package.json` matched by `packages` and asserts that each
listed required script is present. The intent is to keep onboarding
predictable across a monorepo — `bun run build`, `bun run test:unit`,
`bun run lint` should mean the same thing whichever package you `cd`
into.

Each required entry can carry a custom `message` that gets surfaced in
the failure output, so the error doubles as documentation for the
contributor who hit it.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "deps:scripts",
          "type": "package-scripts",
          "overrides": {
            "packages": ["packages/*/package.json", "apps/*/package.json"],
            "requiredScripts": [
              { "name": "build" },
              { "name": "lint", "message": "Add `lint: biome check` to your package.json" },
              { "name": "test:unit" }
            ]
          }
        }
      ]
    }
  }
}
```

## Options

- **`packages`** (`readonly string[]`) — glob patterns for the `package.json` files to scan. Empty / unset means the stage is a no-op.
- **`requiredScripts`** (`readonly { name: string; message?: string }[]`) — list of script names that must exist. `message` overrides the default failure text for that script.

## Example output

Success:

```
[package-scripts] passed (8 packages have all required scripts)
```

Failure:

```
[package-scripts] failed
  packages/forms/package.json: missing script "lint" — Add `lint: biome check` to your package.json
  apps/web/package.json: missing script "test:unit"
```

## See also

- [`package-catalog`](./package-catalog.md) — covers the dependency-version
  half of `package.json` hygiene.
- [`dockerfile-required`](./dockerfile-required.md) — pair these two to
  enforce that every deployable package has a build script *and* a
  Dockerfile.
