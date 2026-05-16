# `dotenv-plaintext`

> Dotenv plaintext guard.

**Type:** `dotenv-plaintext`
**Modes:** `check`, `report`

## What it does

Inverts the usual concern. Some env keys **must** stay plaintext — any
`NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, `STORYBOOK_*`, `REACT_APP_*`,
`EXPO_PUBLIC_*`, `DOTENV_PUBLIC_KEY*`, `NODE_ENV`, `APP_ENV` — because
the frontend bundle reads them at build time and can't decrypt at
runtime. This adapter scans committed `.env.production` / `.env.staging`
/ `.env.preview` files and fails if any matching key carries a
dotenvx-encrypted value.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "ci": {
      "pipeline": [
        {
          "id": "env:plaintext",
          "type": "dotenv-plaintext",
          "alwaysRun": true,
          "overrides": {
            "files": ["**/.env.production", "**/.env.preview"],
            "encryptedAllowlist": ["NEXT_PUBLIC_INTERNAL_KEY"]
          }
        }
      ]
    }
  }
}
```

## Options

- **`files`** (`readonly string[]`, default `["**/.env.production", "**/.env.staging", "**/.env.preview"]`) — globs for committed `.env` files to scan.
- **`plaintextKeyPrefixes`** (`readonly string[]`, default includes `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `REACT_APP_`, `EXPO_PUBLIC_`, `STORYBOOK_`, `DOTENV_PUBLIC_KEY`) — key-name prefixes that must stay plaintext.
- **`plaintextKeys`** (`readonly string[]`, default `["NODE_ENV", "APP_ENV"]`) — exact key names that must stay plaintext.
- **`encryptedAllowlist`** (`readonly string[]`) — escape hatch: keys allowed to be encrypted even when they would otherwise match a plaintext rule.

## Example output

Success:

```
[dotenv-plaintext] passed (2 files scanned)
```

Failure:

```
[dotenv-plaintext] failed
  apps/web/.env.production
    NEXT_PUBLIC_API_URL: encrypted, must be plaintext (frontend prefix)
    NODE_ENV: encrypted, must be plaintext (exact match)
```

## See also

- [`dotenv-secrets`](./dotenv-secrets.md) — the mirror-image check:
  refuses plaintext for keys that look like secrets.
