# `biome-ignore`

> Migrate ESLint disable comments to Biome's ignore syntax.

**Type:** `biome-ignore`
**Modes:** `check`, `fix`

## What it does

Scans source files for `// eslint-disable-next-line`,
`/* eslint-disable */`, and `/* eslint-enable */` directives left over
from a previous ESLint-based setup. In `check` mode the adapter
reports each occurrence; in `fix` mode it rewrites
`eslint-disable-next-line` directives to the equivalent
`// biome-ignore lint:` form, preserving indentation and the disable
reason.

`eslint-disable` and `eslint-enable` (block-style) are reported but not
auto-fixed — their block semantics don't map cleanly to Biome's
per-line model and need a human eye.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:biome-ignore",
          "type": "biome-ignore",
          "overrides": {
            "ignore": ["**/vendor/**"],
            "allowlist": { "legacy.ts": ["eslint-disable"] }
          }
        }
      ]
    }
  }
}
```

## Options

- **`ignore`** (`readonly string[]`) — extra glob patterns to skip on top of the built-in defaults (e.g., `**/node_modules/**`, `**/dist/**`).
- **`allowlist`** (`Record<string, string[] | string>`) — per-file or global allowlist of ESLint directives to keep as-is. Use `"*"` as the key to allow a directive everywhere (example: `{ "*": ["eslint-enable"] }`).

## Example output

Success:

```
[biome-ignore] passed
```

Failure (check mode):

```
[biome-ignore] failed
  src/legacy.ts:42  eslint-disable-next-line  (fixable)
  src/legacy.ts:88  eslint-disable            (manual fix required)
```

After `quality fix`:

```
[biome-ignore] passed (1 fixed, 1 needs manual review)
```

## See also

- [`biome-config`](./biome-config.md) — keep the Biome config that
  consumes these comments in shape.
