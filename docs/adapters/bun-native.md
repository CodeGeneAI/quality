# `bun-native`

> Bun-native API enforcement.

**Type:** `bun-native`
**Modes:** `check`, `fix`

## What it does

Flags imports of Node.js built-ins that have a Bun-native replacement —
`fs`, `fs/promises`, `child_process`, `crypto`, `path`, `url`, `os`,
`net`, `buffer`, `util`, `timers/promises`. The idea is to push code
toward `Bun.file`, `Bun.spawn`, `Bun.write`, `Bun.SQL`, `Bun.S3`, etc.,
which are faster and tighter than the polyfilled Node surface.

In `fix` mode the adapter can strip a `node:` prefix from imports
(`import fs from "node:fs/promises"` → `import fs from "fs/promises"`)
when `stripNodePrefix` is enabled, which normalises before subsequent
ESLint/Biome passes.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:bun-native",
          "type": "bun-native",
          "overrides": {
            "allowedModules": ["timers/promises"],
            "ignore": ["scripts/**", "**/*.compat.ts"],
            "stripNodePrefix": true
          }
        }
      ]
    }
  }
}
```

## Options

- **`allowlist`** (`Record<string, string[] | string>`) — per-file allowance map. Key is a relative file path (or `"*"` for all files), value is a list of tracked module names allowed in that file.
- **`allowedModules`** (`readonly string[]`) — tracked modules allowed globally without per-file entries.
- **`ignore`** (`readonly string[]`) — extra glob patterns to skip on top of the built-in defaults.
- **`stripNodePrefix`** (`boolean`) — when true, the fixer rewrites `node:fs` → `fs`. Default `false`.

## Example output

Success:

```
[bun-native] passed
```

Failure:

```
[bun-native] failed
  src/storage.ts:3   import "fs/promises"  → use Bun.file() / Bun.write()
  src/server.ts:1    import "crypto"       → use Bun.password / globalThis.crypto
```

## See also

- [`import-extensions`](./import-extensions.md) — closely related;
  both run on TypeScript source files and benefit from the same
  `files` scope.
