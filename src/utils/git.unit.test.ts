import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGitStatus,
  getStagedFiles,
  popStash,
  runGit,
  stageFiles,
  stashUnstagedChanges,
} from "./git";

const configureRepository = async (root: string): Promise<void> => {
  await runGit(["init"], { cwd: root });
  await runGit(["config", "user.name", "Test"], { cwd: root });
  await runGit(["config", "user.email", "test@example.com"], { cwd: root });
};

describe("git utilities", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "quality-git-"));
    await configureRepository(root);
  });

  afterEach(async () => {
    await runGit(["reset", "--hard"], { cwd: root, allowFailure: true });
  });

  it("lists staged files", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "hello\n", "utf8");
    await runGit(["add", "file.txt"], { cwd: root });

    const staged = await getStagedFiles(root);
    expect(staged).toEqual(["file.txt"]);
  });

  it("stashes and restores unstaged changes", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "one\n", "utf8");
    await runGit(["add", "file.txt"], { cwd: root });
    await runGit(["commit", "-m", "initial"], { cwd: root });

    await writeFile(file, "two\n", "utf8");
    const stashRef = await stashUnstagedChanges(root);
    expect(stashRef).toBeDefined();

    const statusDuring = await getGitStatus(root);
    expect(statusDuring).toEqual([]);

    await popStash(root, stashRef);
    const statusAfter = await getGitStatus(root);
    expect(statusAfter.some((entry) => entry.worktree === "M")).toBe(true);
  });

  it("stages files via stageFiles helper", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "hello\n", "utf8");

    let status = await getGitStatus(root);
    expect(status).toEqual([{ index: "?", worktree: "?", path: "file.txt" }]);

    await stageFiles(root, ["file.txt"]);

    status = await getGitStatus(root);
    expect(status).toEqual([{ index: "A", worktree: " ", path: "file.txt" }]);
  });
});
