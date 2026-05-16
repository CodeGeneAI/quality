# `biome-config`

> Validate Biome configuration.

**Type:** `biome-config`
**Modes:** `check`, `fix`, `report`

## What it does

Looks up the `biome.json` next to each matched `package.json` and checks
its shape against a Zod schema and a small set of policy rules. Useful
when a monorepo standardises on a particular Biome posture (e.g.,
`linter.rules.style.useImportType: "off"`) and you want drift caught at
review time instead of via reviewer memory.

In `fix` mode the adapter will create a missing `biome.json` from the
configured template, so onboarding a new package is one `quality fix`
away.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:biome-config",
          "type": "biome-config",
          "overrides": {
            "packages": ["packages/*/package.json", "apps/*/package.json"],
            "expectedUseImportType": "off"
          }
        }
      ]
    }
  }
}
```

## Options

- **`packages`** (`readonly string[]`) — glob patterns for `package.json` files whose sibling `biome.json` should be validated.
- **`biomeFile`** (`string`, default `"biome.json"`) — filename to look for in each package directory.
- **`expectedUseImportType`** (`string`, default `"off"`) — expected value for `linter.rules.style.useImportType`.
- **`template`** (`object`) — JSON template used to seed a missing `biome.json` in fix mode. Defaults to a minimal Biome config.
- **`severity`** (`"error" | "warn"`, default `"error"`) — fail vs. warn on violations.

## Example output

Success:

```
[biome-config] passed (3 packages validated)
```

Failure:

```
[biome-config] failed
  packages/ui/biome.json: linter.rules.style.useImportType is "on", expected "off"
  apps/web/biome.json: invalid biome.json structure: linter.rules: Required
```

## See also

- [`biome-ignore`](./biome-ignore.md) — pairs naturally with this
  adapter; together they keep both the config and the inline directives
  honest.
