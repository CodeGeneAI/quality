# `changeset-guard`

> Changeset requirement check.

**Type:** `changeset-guard`
**Modes:** `check`

## What it does

Diffs the current branch against `baseBranch`, maps each changed source
file to its workspace package, then reads any new `.changeset/*.md`
files added on the branch to figure out which packages they cover. If a
package has meaningful changes (files that match `changedFilePatterns`
and don't match `ignoreFilePatterns`) but no covering changeset, the
adapter reports it as uncovered.

An explicit empty changeset (`changeset add --empty`) is recognised as
an opt-out — useful for refactors that touch source but don't ship.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "ci": {
      "pipeline": [
        {
          "id": "changeset-guard",
          "type": "changeset-guard",
          "alwaysRun": true,
          "overrides": {
            "baseBranch": "origin/main",
            "includePrivate": true,
            "severity": "fail",
            "changedFilePatterns": ["src/**", "lib/**"]
          }
        }
      ]
    }
  }
}
```

## Options

- **`baseBranch`** (`string`, default `"origin/main"`) — git ref to diff against.
- **`includePrivate`** (`boolean`, default `false`) — when true, private workspace packages also require a changeset.
- **`severity`** (`"warn" | "fail"`, default `"fail"`) — `"warn"` reports missing changesets but the pipeline passes; `"fail"` exits non-zero.
- **`ignorePackages`** (`readonly string[]`) — package-name globs to skip entirely.
- **`changedFilePatterns`** (`readonly string[]`, default `["src/**", "lib/**"]`) — only files matching these patterns count as release-worthy changes.
- **`ignoreFilePatterns`** (`readonly string[]`) — patterns that suppress a file even if it matches `changedFilePatterns` (defaults to tests, fixtures, markdown, biome/tsconfig configs).

## Example output

Success:

```
[changeset-guard] passed (3 changed packages, all covered)
```

Failure:

```
[changeset-guard] failed
  Missing changeset for changed packages:
    - @your-org/ui (packages/ui)
    - @your-org/forms (packages/forms)

  To add:     bun x changeset add
  Quick add:  bun x changeset add --message "Describe your change"
```

## See also

- [`examples/changeset-guard/`](../../examples/changeset-guard) for a
  two-profile (warn locally, fail in CI) setup.
