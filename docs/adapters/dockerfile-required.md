# `dockerfile-required`

> Dockerfile presence guard.

**Type:** `dockerfile-required`
**Modes:** `check`, `report`

## What it does

Walks the workspace using `packageGlobs` (default `apps/*`, `services/*`),
keeps the directories that contain a `package.json`, and fails if any of
them lacks a `Dockerfile`. `extraRequiredPaths` adds explicit
directories that must ship a Dockerfile even if they're not picked up
by the globs (e.g., a `packages/ui` that ships a deployable Storybook
image).

Paths in `extraRequiredPaths` intentionally bypass the ignore-list
filter — silently dropping a user-declared requirement because it
matched a default ignore pattern would be a footgun.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "ci": {
      "pipeline": [
        {
          "id": "infra:dockerfile",
          "type": "dockerfile-required",
          "alwaysRun": true,
          "overrides": {
            "packageGlobs": ["apps/*", "services/*"],
            "extraRequiredPaths": ["packages/ui"]
          }
        }
      ]
    }
  }
}
```

## Options

- **`packageGlobs`** (`readonly string[]`, default `["apps/*", "services/*"]`) — directory globs whose `package.json`-bearing descendants must each ship a Dockerfile.
- **`extraRequiredPaths`** (`readonly string[]`) — additional explicit directories that must contain a Dockerfile, even when not selected by `packageGlobs`.
- **`filename`** (`string`, default `"Dockerfile"`) — required filename inside each target directory.

## Example output

Success:

```
[dockerfile-required] passed (4 targets verified)
```

Failure:

```
[dockerfile-required] failed
  apps/web         missing Dockerfile
  services/api     missing Dockerfile
  packages/ui      missing Dockerfile (declared via extraRequiredPaths)
```

## See also

- [`package-scripts`](./package-scripts.md) — pair with it to require
  `docker:build` / `docker:push` scripts in the same packages.
- [`structure`](./structure.md) — broader workspace-shape rules where
  Dockerfile presence is one of many invariants.
