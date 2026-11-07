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

Only comments count, as for ESLint itself, which reads its directives
from comments. The same text inside a string, a template literal, a
regular expression or JSX text (a test fixture, a code generator, docs
rendered from code) is neither reported nor rewritten. The adapter asks
Bun's transpiler, which drops comments and keeps everything else: a
directive whose characters can be blanked without changing the
transpiled output is a comment. When it cannot tell (a file the
transpiler cannot parse, an extension other than `.ts`, `.tsx`, `.mts`,
`.cts`, `.js`, `.jsx`, `.mjs` or `.cjs`, or a string literal type, which
the transpiler erases like a comment), the directive is reported, as a
plain text match would.

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
