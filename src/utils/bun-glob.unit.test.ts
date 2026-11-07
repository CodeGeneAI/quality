/**
 * The exclusion matcher is compiled once per glob call, on the first
 * candidate, instead of once per candidate. These cases hold what a caller
 * sees: the matches, and when a pattern micromatch refuses is refused (on the
 * first candidate, never for a scan with none), as `micromatch.isMatch` per
 * candidate gave and a matcher compiled up front would not.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fg from "./bun-glob";

const FILES = [
  "a.ts",
  "src/b.ts",
  "src/b.test.ts",
  ".hidden/c.ts",
  ".hidden/node_modules/d.ts",
  "node_modules/e.ts",
  "vendor/f.ts",
];

describe("bun-glob exclusions", () => {
  let root: string;
  let empty: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "quality-glob-"));
    empty = await mkdtemp(join(tmpdir(), "quality-glob-empty-"));
    for (const file of FILES) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), "");
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  });

  const ignore = ["**/node_modules/**", "vendor/**", "**/*.test.ts"];

  test("drops every excluded candidate, hidden directories included, and sorts the rest", async () => {
    const expected = [".hidden/c.ts", "a.ts", "src/b.ts"];
    expect(fg.sync("**/*.ts", { cwd: root, dot: true, ignore })).toEqual(
      expected,
    );
    expect(await fg("**/*.ts", { cwd: root, dot: true, ignore })).toEqual(
      expected,
    );
  });

  test("without dot a hidden directory is not offered and `**` does not reach into it", () => {
    expect(fg.sync("**/*.ts", { cwd: root, ignore })).toEqual([
      "a.ts",
      "src/b.ts",
    ]);
  });

  test("a negated include pattern is an exclusion", () => {
    expect(
      fg.sync(["**/*.ts", "!vendor/**", "!**/node_modules/**"], {
        cwd: root,
        dot: true,
      }),
    ).toEqual([".hidden/c.ts", "a.ts", "src/b.test.ts", "src/b.ts"]);
  });

  test("a pattern micromatch refuses fails the first candidate it is asked about", async () => {
    expect(() => fg.sync("**/*.ts", { cwd: root, ignore: [""] })).toThrow(
      "non-empty string",
    );
    await expect(fg("**/*.ts", { cwd: root, ignore: [""] })).rejects.toThrow(
      "non-empty string",
    );
  });

  test("a pattern micromatch refuses is not looked at when the scan offers no candidate", async () => {
    expect(fg.sync("**/*.ts", { cwd: empty, ignore: [""] })).toEqual([]);
    expect(await fg("**/*.ts", { cwd: empty, ignore: [""] })).toEqual([]);
  });
});
