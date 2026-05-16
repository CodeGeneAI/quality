# `structure`

> Workspace structure validation.

**Type:** `structure`
**Modes:** `check`, `fix`, `report`

## What it does

A small rule engine for "this file must (or must not) exist" assertions
over the workspace. Each rule is one of three types:

- **`require`** — the glob must match at least one path.
- **`disallow`** — the glob must match nothing.
- **`requireWithContent`** — the file at `paths` must exist with the
  exact `content` (in `fix` mode, the adapter writes it if missing).

`perMatchGlob` and `perMatchKind` let you scope a rule to every
directory or file matched by an outer glob — useful for "every package
must have a CHANGELOG.md" type rules.

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "structure",
          "type": "structure",
          "overrides": {
            "rules": [
              { "type": "require", "glob": "README.md" },
              { "type": "disallow", "glob": "**/*.orig" },
              {
                "type": "requireWithContent",
                "paths": ".editorconfig",
                "content": "root = true\n[*]\nindent_style = space\n"
              }
            ]
          }
        }
      ]
    }
  }
}
```

## Options

- **`rules`** (`readonly StructureRule[]`) — list of rules to apply. Each rule has:
  - **`type`** (`"require" | "disallow" | "requireWithContent"`) — what to assert.
  - **`glob`** (`string | string[]`) — pattern for `require` / `disallow`.
  - **`perMatchGlob`** (`string | string[]`) — outer pattern to scope the inner glob against.
  - **`perMatchKind`** (`"directory" | "file"`) — interpret `perMatchGlob` matches as dirs or files.
  - **`paths`** (`string | string[]`) — target file(s) for `requireWithContent`.
  - **`content`** (`string`) — exact expected content.
  - **`overwrite`** (`boolean`) — let `fix` mode overwrite existing content.
  - **`message`** (`string`) — custom failure message.
- **`severity`** (`"error" | "warn"`) — fail vs. warn on violations.

## Example output

Success:

```
[structure] passed (3 rules satisfied)
```

Failure:

```
[structure] failed
  Expected to find files matching 'README.md' in workspace root.
  Found disallowed files matching '**/*.orig' in workspace root: src/server.ts.orig
```

## See also

- [`dockerfile-required`](./dockerfile-required.md) — narrower
  per-deployable-package check; use `structure` for everything else.
- [`barrel-exports`](./barrel-exports.md) — pair with a `structure`
  rule like `{ type: "disallow", glob: "index.ts", perMatchGlob:
  "packages/*", perMatchKind: "directory" }` to forbid barrel files
  outright.
