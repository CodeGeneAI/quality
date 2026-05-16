# `dotenv-secrets`

> Dotenv secret encryption guard.

**Type:** `dotenv-secrets`
**Modes:** `check`, `report`

## What it does

Scans committed `.env.production` / `.env.staging` / `.env.preview` files
and fails if any key whose name looks like a secret (matches a pattern
such as `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `PEM`, `PRIVATE`,
`CREDENTIAL`) has a plaintext value. Encrypted values (dotenvx's
`encrypted:...` prefix) pass. The check pairs naturally with
[`dotenv-plaintext`](./dotenv-plaintext.md), which enforces the opposite
constraint for public/frontend keys.

`DOTENV_PUBLIC_KEY*` and `NODE_ENV` / `APP_ENV` are always allowed in
plaintext — they're the dotenvx key envelope and the canonical env
indicator.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "ci": {
      "pipeline": [
        {
          "id": "env:secrets",
          "type": "dotenv-secrets",
          "alwaysRun": true,
          "overrides": {
            "plaintextAllowlist": ["FEATURE_FLAG_KEY"]
          }
        }
      ]
    }
  }
}
```

## Options

- **`files`** (`readonly string[]`, default `["**/.env.production", "**/.env.staging", "**/.env.preview"]`) — globs for committed `.env` files to scan.
- **`plaintextAllowlist`** (`readonly string[]`, default `["APP_ENV", "NODE_ENV"]`) — exact key names allowed to remain plaintext even if they match a secret pattern.
- **`secretKeyPatterns`** (`readonly string[]`, default includes `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `PEM`, `PRIVATE`, `CREDENTIAL`) — case-insensitive substrings that mark a key name as secret-bearing.

## Example output

Success:

```
[dotenv-secrets] passed (3 files scanned)
```

Failure:

```
[dotenv-secrets] failed
  apps/api/.env.production
    DATABASE_PASSWORD: plaintext value (matches pattern "PASSWORD")
    STRIPE_SECRET_KEY: plaintext value (matches pattern "SECRET")
```

## See also

- [`dotenv-plaintext`](./dotenv-plaintext.md) — opposite constraint;
  keep public/frontend keys readable.
