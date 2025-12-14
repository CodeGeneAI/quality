import { cp, mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadQualityConfig } from "../../config/loader";
import { runPipeline } from "../../pipeline/runner";
import { registerBuiltInAdapters } from "../register-builtins";
import { resetAdapters } from "../registry";

const fixtureRoot = fileURLToPath(
  new URL("../../../test/fixtures/package-catalog", import.meta.url),
);

describe("package-catalog adapter – integration", () => {
  let workspace: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    resetAdapters();
    registerBuiltInAdapters();
    workspace = await mkdtemp(join(tmpdir(), "quality-pkg-catalog-"));
    await cp(fixtureRoot, workspace, { recursive: true });
    process.chdir(workspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
  });

  it("fails in check mode when non-catalog versions present", async () => {
    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "check",
      files: [],
      reporterDefinitions: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(false);
    expect(
      result.stages.some((s) =>
        s.messages.some((m) => m.includes("needs-fix")),
      ),
    ).toBe(true);
  });

  it("rewrites to catalog versions in fix mode when catalog entry exists", async () => {
    const config = await loadQualityConfig();
    const result = await runPipeline({
      config,
      mode: "fix",
      files: [],
      reporterDefinitions: config.profile.reporters,
      stages: config.profile.pipeline,
    });

    expect(result.success).toBe(false);
    expect(
      result.stages.some((s) => s.messages.some((m) => m.includes("leftpad"))),
    ).toBe(true);

    const pkgText = await readFile(
      join(workspace, "packages/needs-fix/package.json"),
      "utf8",
    );
    const pkg = JSON.parse(pkgText) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.axios).toBe("catalog:tooling");
  });
});
