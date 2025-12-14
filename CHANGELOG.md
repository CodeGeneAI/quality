# @codesynth-labs/quality

## 2.0.0

### Major Changes

- [#48](https://github.com/CodeSynth-Labs/forge-platform/pull/48) [`ff1efda`](https://github.com/CodeSynth-Labs/forge-platform/commit/ff1efda84a995a047e0a09858cf17a5951182390) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Centralize CLI entrypoints under `@codesynth-labs/forge`, remove package-level binaries, and fold the old `forge-types`/`forge-utils` surfaces into `forge-core` (schema, loaders, dependency graph). All other forge-suite packages now export SDKs only.

### Patch Changes

- [#53](https://github.com/CodeSynth-Labs/forge-platform/pull/53) [`3b7b3ad`](https://github.com/CodeSynth-Labs/forge-platform/commit/3b7b3adc50414be256f5ace62d122314552aa49f) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Improve auto-fix defaults and CLI ergonomics by documenting resolution order, tightening validation, and adding defensive feedback and tests.
