# ADR: Husky-style git hook layout for `@codesynth-labs/quality`

**Date:** 2025-11-16

## Context

- Today `quality hooks install` writes managed scripts directly into `.git/hooks/*` and executes pipelines via `quality git-hook <name>`.
- Husky’s UX is familiar to most users: a repository-local folder (by default `.husky/`) stores hook scripts, accompanied by a tiny bootstrap shim in `.git/hooks` that delegates to that folder. The folder is versioned, easy to audit, and regenerated via an install step (often in `prepare`).
- We want Quality to mirror this ergonomics: generate a `.quality/` directory with managed hook scripts and a shared helper (`_/quality.sh`), while keeping a lightweight managed shim inside `.git/hooks` for Git compatibility.

## Decision

1) **Managed folder:** Introduce a repo-local, version-controlled `.quality/` directory (name is fixed, no config). Contents:
   - Per-hook executable files (e.g., `.quality/pre-commit`).
   - Shared helper script `.quality/_/quality.sh` sourced by each hook to set PATH, env, and invoke `quality git-hook <name>`.

2) **Installer semantics:**
   - `quality hooks install` becomes the single entry point. It creates `.quality/` and helper, ensures executable bits, and writes minimal shims to `.git/hooks/*` that delegate to `.quality/<hook>` using `core.hooksPath` if needed.
   - Recommend adding `"prepare": "quality hooks install"` (or equivalent) so fresh clones regenerate hooks automatically.

3) **Execution model:**
   - Git runs `.git/hooks/<hook>` → shim delegates to `.quality/<hook>` → the hook sources `./_/quality.sh` → runs `quality git-hook <name>` with the existing pipeline logic.
   - Opt-out via `QUALITY_HOOKS=0` (parallel to Husky’s `HUSKY=0`) and Git’s `--no-verify` behavior remains intact.

4) **Migration/compatibility:**
   - Installer detects old quality-managed hook markers in `.git/hooks/*`; rewrites them to the new shim and creates `.quality/` if missing.
   - If user had custom unmanaged hooks, installer refuses to overwrite and reports actionable guidance.

5) **Telemetry & context:**
   - Keep existing telemetry context strings; prepend folder-based execution metadata where useful (e.g., `hook:<hook>:check`).

6) **Docs & templates:**
   - Update README/AGENTS and `quality init` template output to describe `.quality/`, the helper script, and recommended `prepare` script.

## Alternatives considered

- **Direct hooks only (status quo):** Simple but hides the hook logic and is harder to audit/version. Rejected for UX.
- **Configurable folder name:** Adds complexity for little value; fixed `.quality/` keeps documentation and tooling straightforward.

## Risks & mitigations

- **Windows shell compatibility:** Use POSIX-sh compatible scripts (no bashisms). Add a small test to ensure hooks run under `sh`.
- **Existing custom hooks:** Detection + non-destructive refusal with clear messaging; provide migration instructions.
- **Stale installs:** Rely on `prepare` script guidance and idempotent installer (safe to rerun).

## Verification plan (per-phase gates)

- Installer on fresh repo creates `.quality/`, helper, and hook shims; files are executable.
- Git commit triggers `.quality/pre-commit`; setting `QUALITY_HOOKS=0` suppresses execution.
- Migration: repo with old managed hook markers rewrites to new layout; unmanaged hooks are left untouched with warnings.
- Unit + lint + typecheck green for `@codesynth-labs/quality`; targeted integration check proving hook delegation path works.

