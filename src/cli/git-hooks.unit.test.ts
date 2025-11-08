import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedGitHookConfig } from "../config/types";
import { installHooks } from "./git-hooks";

const createHookConfig = (name: string): ResolvedGitHookConfig => ({
  name,
  profile: "local",
  filesMode: "staged",
  autoFix: {
    enabled: false,
    amendCommit: false,
    safety: "confirm",
    rerunAfterFix: false,
    preserveCommitMetadata: true,
  },
});

describe("git hook installation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "quality-hooks-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes hook scripts with resilient quality binary lookup", async () => {
    const hooks = { "pre-commit": createHookConfig("pre-commit") };
    const results = await installHooks({ root, hooks });

    expect(results).toHaveLength(1);
    expect(results[0]?.managed).toBe(true);
    expect(results[0]?.status).toBe("installed");

    const script = await readFile(join(root, ".git/hooks/pre-commit"), "utf8");
    expect(script).toContain("resolve_quality()");
    expect(script).toMatch(/command -v quality >\/dev\/null 2>&1/);
    expect(script).toContain(
      'if [[ -x "$search/node_modules/.bin/quality" ]]; then',
    );
    expect(script).toContain('if [[ -x "$search/.bun/bin/quality" ]]; then');
    expect(script).toContain(
      'if [[ -x "$search/.bun/install/bin/quality" ]]; then',
    );
    expect(script).toContain(
      'if [[ -n "${BUN_INSTALL:-}" ]] && [[ -x "${BUN_INSTALL}/bin/quality" ]]; then',
    );
    expect(script).toContain('if [[ -z "${QUALITY_BIN:-}" ]]; then');
    expect(script).toContain('exec "$QUALITY_BIN" git-hook pre-commit');
  });
});
