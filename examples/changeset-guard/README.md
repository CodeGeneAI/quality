# Changeset guard

## What this shows

The `changeset-guard` adapter wired to a two-profile setup: a `local`
profile that warns and a `ci` profile that fails. The adapter looks at
the branch diff against `baseBranch`, maps changed files to workspace
packages, and verifies that every changed package is covered by a new
`.changeset/*.md` file on the branch.

### What release discipline this enforces

- Every shipping change must declare what it changes. PRs that bump
  `src/**` in a package without a corresponding changeset entry are
  flagged — the team can't ship a silent breaking change by accident.
- Tests, docs, and configs are explicitly ignored, so refactors and
  fixture tweaks don't generate noise.
- `includePrivate: true` keeps the check honest across private workspace
  packages — useful when private apps still need release notes for
  internal stakeholders.
- The `local` profile warns; `ci` fails. That lets developers see what
  they'll need before they push, without being blocked mid-edit.

## Who it's for

Monorepo teams already using [@changesets/cli](https://github.com/changesets/changesets)
and looking for a structural check to back up team conventions in PR
review.

## How to use

1. Copy `.qualityrc.jsonc` to the root of your repo.
2. Install the package:
   ```bash
   bun add -D @codegeneai/quality
   ```
3. Run locally to preview what CI will say:
   ```bash
   bun x quality check --profile local
   ```
4. Run the CI profile (this is what should run on PR merge gate):
   ```bash
   bun x quality check --profile ci
   ```
   If any package has source-level changes without a covering changeset,
   the run exits non-zero with the offending packages listed.
