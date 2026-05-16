# `unit-adjacency`

> Unit test adjacency enforcement.

**Type:** `unit-adjacency`
**Modes:** `check`, `report`

## What it does

Requires every `*.unit.spec.ts` to live in the **same directory** as
the file it tests, and forbids tests from being parked under
`__tests__` or `test/` folders. Co-locating the test next to the
subject means a developer renaming or moving the subject sees the
broken test in the same diff — refactors stay honest, dead tests are
caught at review.

When `requireSubject` is true (the default), the adapter also fails if
it can't find a subject file (`<basename>.ts`, `.tsx`, `.js`, etc.) next
to the test. `allowSubjectlessInTestsDir` opts a single `__tests__`
folder back in for tests that genuinely have no subject (e.g.,
end-to-end harnesses).

## Configuration

```jsonc
{
  "$schema": "./node_modules/@codegeneai/quality/schemas/qualityrc.schema.json",
  "profiles": {
    "local": {
      "pipeline": [
        {
          "id": "lint:unit-adjacency",
          "type": "unit-adjacency",
          "overrides": {
            "requireSubject": true,
            "allowSubjectlessInTestsDir": false
          }
        }
      ]
    }
  }
}
```

## Options

- **`unitPatterns`** (`readonly string[]`, default `["**/*.unit.spec.{ts,tsx,js,jsx,mts,mjs,cts,cjs}"]`) — globs that select the unit test files to validate.
- **`forbiddenSegments`** (`readonly string[]`, default `["__tests__", "test"]`) — path segments that disqualify a unit test's location.
- **`requireSubject`** (`boolean`, default `true`) — fail when no subject file lives next to the test.
- **`ignore`** (`readonly string[]`) — extra glob patterns to skip on top of the built-in defaults.
- **`allowSubjectlessInTestsDir`** (`boolean`, default `true`) — opt-out: allow tests inside `testsDirName` to skip the subject check.
- **`testsDirName`** (`string`, default `"__tests__"`) — directory name that activates the opt-out above.

## Example output

Success:

```
[unit-adjacency] passed (87 unit tests verified)
```

Failure:

```
[unit-adjacency] failed
  src/__tests__/auth.unit.spec.ts: lives inside forbidden segment "__tests__"
  src/widget.unit.spec.ts: no subject file found (expected widget.{ts,tsx,...} sibling)
```

## See also

- [`filenames`](./filenames.md) — keeps the `*.unit.spec.ts` naming
  convention itself in shape; pair both adapters to enforce *what* a
  test is called and *where* it lives.
