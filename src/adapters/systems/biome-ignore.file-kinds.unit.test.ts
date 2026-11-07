import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { biomeIgnoreAdapter } from "./biome-ignore";

/**
 * The stage reads a regular file's bytes first and decodes only one that may
 * hold a directive. Every other kind of path takes the decoding read, so these
 * cases hold the verdict for each: a UTF-16 file (its ASCII letters are not in
 * its bytes), links, a vanished file and a directory in a file's place.
 */

const LINE_DIRECTIVE =
  "// eslint-disable-next-line no-console\nconsole.log(1);\n";

const run = async (root: string, files: readonly string[]) =>
  biomeIgnoreAdapter.run({
    mode: "check",
    pipelineMode: "check",
    stage: {
      id: "biome-ignore",
      type: "biome-ignore",
      options: {},
      continueOnError: false,
      files: [],
    },
    root,
    options: {},
    files,
    hasExplicitFileSelection: true,
    ignore: [],
    abortSignal: new AbortController().signal,
  });

const withRoot = async (body: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), "quality-biome-ignore-kinds-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const utf16le = (text: string): Uint8Array => {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return bytes;
};

describe("biome-ignore over each kind of path", () => {
  it("decodes and reports a UTF-16 file with a byte order mark", () =>
    withRoot(async (root) => {
      await writeFile(join(root, "wide.ts"), utf16le(LINE_DIRECTIVE));
      const result = await run(root, ["wide.ts"]);
      expect(result.status).toBe("failed");
      expect(result.messages).toEqual([
        "wide.ts:1 contains eslint-disable-next-line (no-console) (use biome-ignore instead)",
      ]);
    }));

  it("follows a link to a file", () =>
    withRoot(async (root) => {
      await writeFile(join(root, "target.ts"), LINE_DIRECTIVE);
      await symlink(join(root, "target.ts"), join(root, "link.ts"));
      const result = await run(root, ["link.ts"]);
      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toStartWith("link.ts:1 ");
    }));

  it("skips a dangling link, a link to a directory and a vanished file", () =>
    withRoot(async (root) => {
      await mkdir(join(root, "folder"));
      await symlink(join(root, "missing.ts"), join(root, "dangling.ts"));
      await symlink(join(root, "folder"), join(root, "dir-link.ts"));
      const result = await run(root, ["dangling.ts", "dir-link.ts", "gone.ts"]);
      expect(result.status).toBe("passed");
    }));

  it("skips a directory in a file's place", () =>
    withRoot(async (root) => {
      await mkdir(join(root, "folder.ts"));
      const result = await run(root, ["folder.ts"]);
      expect(result.status).toBe("passed");
    }));
});
