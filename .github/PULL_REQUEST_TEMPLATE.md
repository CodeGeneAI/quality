<!--
Thanks for the PR! A few notes:
- The title becomes the squash-commit subject. release-please reads it.
- Use a Conventional Commits prefix (feat / fix / docs / chore / refactor / test / ci / style / perf).
  - feat: → minor bump
  - fix:  → patch bump
  - perf: → patch bump
  - others → no release
- Breaking changes: add `!` after the type (e.g. `feat!:`) or `BREAKING CHANGE:` in the footer.
-->

## Summary

<!-- One or two sentences describing what changed and why. -->

## Type of change

- [ ] `feat:` — new functionality (minor bump)
- [ ] `fix:` — bug fix (patch bump)
- [ ] `perf:` — performance improvement (patch bump)
- [ ] `docs:` — documentation only (no release)
- [ ] `refactor:` — code change that neither fixes a bug nor adds a feature (no release)
- [ ] `test:` — tests only (no release)
- [ ] `chore:` / `ci:` / `style:` — tooling, CI, or formatting (no release)
- [ ] Breaking change (add `!` to the prefix or `BREAKING CHANGE:` footer)

## Checklist

- [ ] Tests added or updated (unit tests colocated as `*.unit.test.ts`)
- [ ] `bun run lint`, `bun run typecheck`, `bun run test:unit` all pass locally
- [ ] Documentation updated if behaviour, CLI flags, or schema changed
- [ ] Linked issues below

## Linked issues

<!-- Closes #123, Refs #456 -->
