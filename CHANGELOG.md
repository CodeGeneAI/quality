# @codegeneai/quality

## [2.2.0](https://github.com/CodeGeneAI/quality/compare/v2.1.4...v2.2.0) (2026-05-16)


### Features

* add dev session logs retention test and implement pruning logic ([c8d5c55](https://github.com/CodeGeneAI/quality/commit/c8d5c55b23cd3864bbb2b223868439a73c3f57ca))
* add README files for secrets and telemetry packages ([de843c0](https://github.com/CodeGeneAI/quality/commit/de843c0314cad54b9904312a06b379e4cd0ac6ba))
* add workspace database config parsing ([61a68d4](https://github.com/CodeGeneAI/quality/commit/61a68d423aff043bed5ab78550b8572c6cbe0a67))
* **auth:** implement real GitHub App installation flow for workspace creation ([#979](https://github.com/CodeGeneAI/quality/issues/979)) ([e8f5ab6](https://github.com/CodeGeneAI/quality/commit/e8f5ab6cd3987df8faf0165fe34b59143c9dbeb6))
* **build:** Dockerfiles for apps/services/ui + dockerfile-required quality adapter ([#1223](https://github.com/CodeGeneAI/quality/issues/1223)) ([c393850](https://github.com/CodeGeneAI/quality/commit/c393850aad1588091432d406dbf2cb516dce8d5a))
* enhance MSSQL integration tests and improve connection string parsing ([5a1269e](https://github.com/CodeGeneAI/quality/commit/5a1269ecddc7a87ea97c2cb476ef56e83b302c09))
* enhance stack-test-runner CLI with auto-dependency resolution options ([c8d5c55](https://github.com/CodeGeneAI/quality/commit/c8d5c55b23cd3864bbb2b223868439a73c3f57ca))
* enhance structure validation with per-match globbing ([de843c0](https://github.com/CodeGeneAI/quality/commit/de843c0314cad54b9904312a06b379e4cd0ac6ba))
* implement auto-inference of adapter dependencies in service graph ([c8d5c55](https://github.com/CodeGeneAI/quality/commit/c8d5c55b23cd3864bbb2b223868439a73c3f57ca))
* implement service environment loader with enhanced secret handling ([4237b72](https://github.com/CodeGeneAI/quality/commit/4237b72bd686094ce1fcb2eae1bc8140b5d3f89b))
* integrate automatic secrets loading based on environment variables ([4237b72](https://github.com/CodeGeneAI/quality/commit/4237b72bd686094ce1fcb2eae1bc8140b5d3f89b))
* **quality:** add changeset-guard adapter for pre-push changeset detection ([#841](https://github.com/CodeGeneAI/quality/issues/841)) ([7d88ea3](https://github.com/CodeGeneAI/quality/commit/7d88ea328e9994e0767e7e62d1b4b72ff872b0ee))
* **quality:** add dotenv-plaintext adapter to flag over-encrypted env vars ([#1219](https://github.com/CodeGeneAI/quality/issues/1219)) ([d7308b6](https://github.com/CodeGeneAI/quality/commit/d7308b699dc436b4b545e3d295ab11c40c5435be))
* **trigger-migration:** finalize preview and reconcile hard-cut ([#955](https://github.com/CodeGeneAI/quality/issues/955)) ([c942da9](https://github.com/CodeGeneAI/quality/commit/c942da9c81d27fc1cc35d4a350fa14155399c29c))
* update workspace schema generation and validation instructions; enhance structure adapter glob handling ([d39fca5](https://github.com/CodeGeneAI/quality/commit/d39fca558fceb59a041d5c8f1ee75f6ad5380049))


### Bug Fixes

* improve service environment loading to respect existing process environment variables ([c8d5c55](https://github.com/CodeGeneAI/quality/commit/c8d5c55b23cd3864bbb2b223868439a73c3f57ca))
* **quality:** capture git hook args ([6f641a4](https://github.com/CodeGeneAI/quality/commit/6f641a4f351a71688c8be44a892a33c5e3457dd0))
* **testing:** stabilize vitest worker behavior ([62f182b](https://github.com/CodeGeneAI/quality/commit/62f182be04b0dc34d911802f17bf47e39af51c16))
* update environment variables for auth service ([de843c0](https://github.com/CodeGeneAI/quality/commit/de843c0314cad54b9904312a06b379e4cd0ac6ba))
* update import paths for stack test runner and biome adapters ([ecde13b](https://github.com/CodeGeneAI/quality/commit/ecde13b5275771ff052d4ed9719a2d65ab96a980))
* update secrets directory structure to include .forge prefix for better organization ([4237b72](https://github.com/CodeGeneAI/quality/commit/4237b72bd686094ce1fcb2eae1bc8140b5d3f89b))
* update test command syntax in package.json for consistency ([e6b793d](https://github.com/CodeGeneAI/quality/commit/e6b793d2876a56fba0f1a0274e78a602a9bb711f))

## 2.1.4

### Patch Changes

- [#1119](https://github.com/CodeGeneAI/platform/pull/1119) [`e0d8ae8`](https://github.com/CodeGeneAI/platform/commit/e0d8ae8e1f84f5d879d4566c9b0472f03b109ce5) Thanks [@rszemplinski](https://github.com/rszemplinski)! - changeset-guard: stop surfacing `bun x changeset --empty` and `git push --no-verify` in warning output so the skip/bypass escape hatches are no longer advertised to contributors. The empty-changeset opt-out still functions internally; only the message is removed.

## 2.1.3

### Patch Changes

- [#979](https://github.com/CodeGeneAI/platform/pull/979) [`d05be3b`](https://github.com/CodeGeneAI/platform/commit/d05be3b23f19821df10358dfdcd089d88adffd34) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Improvements and optimizations

## 2.1.2

### Patch Changes

- [#841](https://github.com/CodeGeneAI/platform/pull/841) [`4fe2c14`](https://github.com/CodeGeneAI/platform/commit/4fe2c14febdf1e1a34340af876deaedaab0f009f) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Make `changeset-guard` blocking in pre-push, include deleted files when detecting changed packages, and improve missing-changeset guidance with a direct `changeset add` command.

## 2.1.1

### Patch Changes

- [#523](https://github.com/CodeGeneAI/platform/pull/523) [`6065b06`](https://github.com/CodeGeneAI/platform/commit/6065b06c968178d5ac942e6a9ef5378dc4973b49) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Harden module audit tooling with safer path handling, bounded file scanning, and added unit tests.

## 2.1.0

### Minor Changes

- [#232](https://github.com/CodeGeneAI/platform/pull/232) [`e6d6fcc`](https://github.com/CodeGeneAI/platform/commit/e6d6fcc2fae7ebe30217a5348073c95bcb911168) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Add biome-config and barrel-exports quality adapters

  - **biome-config adapter**: Enforces `useImportType: "off"` in biome.json for services and NestJS integrations. Features Zod schema validation, custom error classes for proper error handling, and comprehensive test coverage.

  - **barrel-exports adapter**: Prevents barrel exports in client packages (those with react/react-dom peer dependencies) to ensure proper tree-shaking. Supports ignore patterns for specific packages.

  Both adapters include fix mode support and detailed error messages.

## 2.0.4

### Patch Changes

- [`e28b2ec`](https://github.com/CodeGeneAI/platform/commit/e28b2ec1faec8cfdcb4d4895b9e92f58a62d4ee6) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Test changeset to validate release workflow automation.

## 2.0.3

### Patch Changes

- [#121](https://github.com/CodeGeneAI/platform/pull/121) [`ec000d3`](https://github.com/CodeGeneAI/platform/commit/ec000d3dfa46c3dc3ab1987d0c948a00aac275bc) Thanks [@rszemplinski](https://github.com/rszemplinski)! - refactor: document @codegeneai scope migration and remove committed npm auth token

## 2.0.2

### Patch Changes

- [#119](https://github.com/CodeGeneAI/platform/pull/119) [`2454b6f`](https://github.com/CodeGeneAI/platform/commit/2454b6f74ff023d750111cb0813bb0691f719168) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Remove all platform CLI and platform-suite documentation references

  ## Documentation Cleanup

  Removed all lingering and obsolete documentation referencing the retired platform CLI and platform-suite packages across the repository:

  - **AGENTS.md**: Removed manifest workflow section, platform CLI commands from quick reference tables
  - **GLOSSARY.md**: Removed platform-specific terms (Stack tests, Stack, Workspace manifest, Secrets bundle vs cache, Runbooks)
  - **Onboarding docs**: Removed platform secrets sync commands
  - **README files**: Removed "generated by Platform CLI" and "Platform Generator" sections from apps/services
  - **ENVIRONMENT.md files**: Removed "Platform Generator Configuration" sections from all 6 environment files
  - **Agent guide docs**: Removed platform.workspace.json references from phase-planning, quality-gates, solid-principles
  - **Component docs**: Removed manifest and stack-test references from apps.md, services.md
  - **ADR files**: Removed platform.workspace.json implementation references
  - **Package documentation**: Removed doc-catalog banners and platform-cli.md references from secrets and telemetry packages
  - **GitHub templates**: Removed manifest checklist sections from PR and issue templates
  - **Config files**: Removed legacy manifest ignore patterns from .qualityrc.jsonc and platform.workspace.json file nesting from VS Code settings

## 2.0.1

### Patch Changes

- [#115](https://github.com/CodeGeneAI/platform/pull/115) [`0452393`](https://github.com/CodeGeneAI/platform/commit/04523932db8b0a7c99110035c2d486e09fbf7438) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Ensure the quality CLI command tests stub the local index exports so the CLI paths run against the mocked helpers and avoid executing the real pipeline.

## 2.0.0

### Major Changes

- [#48](https://github.com/CodeGeneAI/platform/pull/48) [`ff1efda`](https://github.com/CodeGeneAI/platform/commit/ff1efda84a995a047e0a09858cf17a5951182390) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Centralize CLI entrypoints under `@codegeneai/platform`, remove package-level binaries, and fold the old `platform-types`/`platform-utils` surfaces into `platform-core` (schema, loaders, dependency graph). All other platform-suite packages now export SDKs only.

### Patch Changes

- [#53](https://github.com/CodeGeneAI/platform/pull/53) [`3b7b3ad`](https://github.com/CodeGeneAI/platform/commit/3b7b3adc50414be256f5ace62d122314552aa49f) Thanks [@rszemplinski](https://github.com/rszemplinski)! - Improve auto-fix defaults and CLI ergonomics by documenting resolution order, tightening validation, and adding defensive feedback and tests.
