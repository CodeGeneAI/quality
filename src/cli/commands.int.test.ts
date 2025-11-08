import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGit } from "../utils/git";
import {
  QualityCiEmitCommand,
  QualityCiListCommand,
  QualityCiRunCommand,
  QualityGitHookCommand,
  QualityHooksInstallCommand,
  QualityHooksListCommand,
  QualityHooksUninstallCommand,
  QualityRunCommand,
} from "./commands";

interface CommandResultContext {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly context: {
    readonly stdin: NodeJS.ReadStream;
    readonly stdout: { write: (message: string) => number };
    readonly stderr: { write: (message: string) => number };
  };
}

const createCommandContext = (): CommandResultContext => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    context: {
      stdin: process.stdin,
      stdout: {
        write(message: string) {
          stdout.push(message);
          return message.length;
        },
      },
      stderr: {
        write(message: string) {
          stderr.push(message);
          return message.length;
        },
      },
    },
  } satisfies CommandResultContext;
};

const baseConfig = {
  $schema: "./packages/quality/schemas/qualityrc.schema.json",
  stages: {},
  profiles: {
    local: {
      pipeline: [
        {
          id: "lint:command",
          type: "command",
          options: {
            commands: [
              {
                command: [
                  "bash",
                  "-lc",
                  "if grep -q 'fail' sample.txt; then exit 1; fi",
                ],
              },
            ],
          },
        },
      ],
      reporters: ["summary"],
    },
    ci: {
      extends: "local",
    },
  },
  gitHooks: {
    manage: true,
    hooks: {
      "pre-commit": {
        profile: "local",
        stages: ["lint:command"],
        filesMode: "staged",
        autoFix: {
          enabled: false,
          safety: "force",
          rerunAfterFix: true,
          preserveCommitMetadata: true,
        },
      },
    },
  },
  ciTargets: {
    "github:pr": {
      profile: "ci",
      filesMode: "workspace",
      autoFix: {
        enabled: false,
        safety: "force",
        rerunAfterFix: true,
        preserveCommitMetadata: true,
      },
    },
  },
};

const writeQualityConfig = async (
  root: string,
  config: unknown,
): Promise<void> => {
  await writeFile(
    join(root, ".qualityrc.json"),
    JSON.stringify(config, null, 2),
  );
};

describe("CLI commands", () => {
  const originalCwd = process.cwd();
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "quality-cli-"));
    process.chdir(root);
    await runGit(["init"], { cwd: root });
    await runGit(["config", "user.name", "Test"], { cwd: root });
    await runGit(["config", "user.email", "test@example.com"], { cwd: root });
    await writeQualityConfig(root, baseConfig);
    await writeFile(join(root, "sample.txt"), "ok\n", "utf8");
    await runGit(["add", "sample.txt"], { cwd: root });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
    process.exitCode = 0;
    delete process.env.QUALITY_TELEMETRY;
    delete process.env.QUALITY_TELEMETRY_FILE;
    delete process.env.QUALITY_DEBUG;
  });

  it("installs, lists, and uninstalls managed git hooks", async () => {
    const install = new QualityHooksInstallCommand();
    const installCtx = createCommandContext();
    install.context = installCtx.context as any;
    await install.execute();

    const hookPath = join(root, ".git/hooks/pre-commit");
    const content = await readFile(hookPath, "utf8");
    expect(content).toContain("quality-managed-hook");

    const list = new QualityHooksListCommand();
    const listCtx = createCommandContext();
    list.context = listCtx.context as any;
    await list.execute();
    expect(listCtx.stdout.join("\n")).toContain("pre-commit (managed)");

    const uninstall = new QualityHooksUninstallCommand();
    const uninstallCtx = createCommandContext();
    uninstall.context = uninstallCtx.context as any;
    await uninstall.execute();
    await expect(readFile(hookPath, "utf8")).rejects.toThrow();
  });

  it("executes git hook pipeline and reports failure", async () => {
    await writeFile(join(root, "sample.txt"), "fail\n", "utf8");
    await runGit(["add", "sample.txt"], { cwd: root });

    const command = new QualityGitHookCommand();
    command.hookName = "pre-commit";
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();
    expect(process.exitCode).toBe(1);
    expect(exitCode).toBe(1);
  });

  it("returns zero exit code when CLI pipeline succeeds", async () => {
    const command = new QualityRunCommand();
    command.path = ["check"];
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();
    expect(exitCode).toBe(0);
    expect(process.exitCode).toBe(0);
  });

  it("returns non-zero exit code when CLI pipeline fails", async () => {
    await writeFile(join(root, "sample.txt"), "fail\n", "utf8");
    const command = new QualityRunCommand();
    command.path = ["check"];
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();
    expect(exitCode).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it("skips unsupported stages when running fix", async () => {
    const config = JSON.parse(JSON.stringify(baseConfig));
    config.profiles.local.pipeline.push({
      id: "structure:check",
      type: "structure",
      overrides: {
        rules: [{ type: "require", glob: "sample.txt" }],
      },
    });
    await writeQualityConfig(root, config);

    const command = new QualityRunCommand();
    command.path = ["fix"];
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();

    expect(exitCode).toBe(0);
    expect(process.exitCode).toBe(0);
    const stdout = ctx.stdout.join("\n");
    expect(stdout).toContain(
      "Stage adapter 'structure' does not support mode 'fix'; skipping.",
    );
    expect(stdout).toContain("[verify] structure:check");
    expect(stdout).not.toContain("[fix] typecheck");
  });

  it("fails fix runs when verification still detects issues", async () => {
    await writeFile(join(root, "sample.txt"), "fail\n", "utf8");

    const command = new QualityRunCommand();
    command.path = ["fix"];
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();

    expect(exitCode).toBe(1);
    expect(process.exitCode).toBe(1);
    expect(ctx.stdout.join("\n")).toContain("[verify] lint:command");
  });

  it("runs CI target successfully", async () => {
    await writeFile(join(root, "sample.txt"), "ok\n", "utf8");

    const command = new QualityCiRunCommand();
    command.targetName = "github:pr";
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();
    expect(process.exitCode).toBe(0);
    expect(exitCode).toBe(0);
  });

  it("fails CI target when pipeline fails", async () => {
    await writeFile(join(root, "sample.txt"), "fail\n", "utf8");

    const command = new QualityCiRunCommand();
    command.targetName = "github:pr";
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const exitCode = await command.execute();
    expect(process.exitCode).toBe(1);
    expect(exitCode).toBe(1);
  });

  it("emits CI job snippet in GitHub format", async () => {
    const command = new QualityCiEmitCommand();
    command.targetName = "github:pr";
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    await command.execute();
    expect(ctx.stdout.join("\n")).toContain("jobs:");
    expect(ctx.stdout.join("\n")).toContain("quality-github-pr");
  });

  it("emits CI job snippets for GitLab and generic formats", async () => {
    const gitlab = new QualityCiEmitCommand();
    gitlab.targetName = "github:pr";
    gitlab.format = "gitlab";
    const gitlabCtx = createCommandContext();
    gitlab.context = gitlabCtx.context as any;
    await gitlab.execute();
    expect(gitlabCtx.stdout.join("\n")).toContain("stage: test");

    const generic = new QualityCiEmitCommand();
    generic.targetName = "github:pr";
    generic.format = "generic";
    const genericCtx = createCommandContext();
    generic.context = genericCtx.context as any;
    await generic.execute();
    expect(genericCtx.stdout.join("\n")).toContain("job:");
  });

  it("lists CI targets", async () => {
    const command = new QualityCiListCommand();
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    await command.execute();
    expect(ctx.stdout.join("\n")).toContain("github:pr");
  });

  it("enforces CI auto-fix safety guardrails", async () => {
    const guardedConfig = JSON.parse(JSON.stringify(baseConfig));
    guardedConfig.ciTargets["github:pr"].autoFix.enabled = true;
    guardedConfig.ciTargets["github:pr"].autoFix.safety = "confirm";
    await writeQualityConfig(root, guardedConfig);

    const command = new QualityCiRunCommand();
    command.targetName = "github:pr";
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    await command.execute();
    expect(process.exitCode).toBe(1);
    expect(ctx.stderr.join("\n")).toContain("requires safety");
  });

  it("honours telemetry flags for CLI runs", async () => {
    const command = new QualityRunCommand();
    command.path = ["check"];
    command.telemetry = "stdout";
    command.debugFlag = true;
    const ctx = createCommandContext();
    command.context = ctx.context as any;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await command.execute();
    expect(process.env.QUALITY_TELEMETRY).toBe("stdout");
    expect(process.env.QUALITY_DEBUG).toBe("1");
    logSpy.mockRestore();
  });
});
