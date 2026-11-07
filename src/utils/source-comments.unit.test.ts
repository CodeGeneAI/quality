import { describe, expect, it } from "bun:test";
import { createCommentProbe, loaderForPath } from "./source-comments";

const MARK = "MARKER";

/** Probes the first occurrence of MARK in `source`. */
const isComment = (file: string, source: string): boolean => {
  const offset = source.indexOf(MARK);
  if (offset === -1) throw new Error("source has no MARKER");
  return createCommentProbe(file, source)(offset, MARK.length);
};

describe("createCommentProbe", () => {
  it.each([
    ["a line comment", "a.ts", "// MARKER\nexport const x = 1;\n"],
    ["a block comment", "a.ts", "export const x = /* MARKER */ 1;\n"],
    ["a JSDoc comment", "a.ts", "/** MARKER */\nexport const x = 1;\n"],
    [
      "a legal block comment (/*!)",
      "a.ts",
      "/*! MARKER */\nexport const x = 1;\n",
    ],
    ["a legal line comment (//!)", "a.ts", "//! MARKER\nexport const x = 1;\n"],
    [
      "a comment inside a JSX expression",
      "a.tsx",
      "export const A = <div>{/* MARKER */}</div>;\n",
    ],
    [
      "a comment inside a template substitution",
      "a.ts",
      "export const s = `a${/* MARKER */ 1}b`;\n",
    ],
    [
      "a comment after a shebang",
      "a.ts",
      "#!/usr/bin/env bun\n// MARKER\nexport const x = 1;\n",
    ],
  ])("answers true in %s", (_name, file, source) => {
    expect(isComment(file, source)).toBe(true);
  });

  it.each([
    ["a double-quoted string", "a.ts", 'export const s = "// MARKER";\n'],
    ["a single-quoted string", "a.ts", "export const s = '/* MARKER */';\n"],
    ["a template literal", "a.ts", "export const s = `\n// MARKER\n`;\n"],
    [
      "a template literal after a substitution",
      "a.ts",
      "export const s = `${1}\n/* MARKER */`;\n",
    ],
    ["a regular expression", "a.ts", "export const r = /\\/\\/ MARKER/;\n"],
    ["JSX text", "a.tsx", "export const A = <p>// MARKER</p>;\n"],
    ["JSX text in a .js file", "a.js", "export const A = <p>// MARKER</p>;\n"],
    [
      "a string holding a legal-comment opener",
      "a.ts",
      'export const s = "/*! MARKER */";\n',
    ],
    [
      "a string after a legal comment",
      "a.ts",
      '/*! keep */\nexport const s = "MARKER";\n',
    ],
  ])("answers false in %s", (_name, file, source) => {
    expect(isComment(file, source)).toBe(false);
  });

  it("answers true for a string literal type, which the transpiler erases", () => {
    expect(
      isComment("a.ts", 'export type T = "MARKER";\nexport const x = 1;\n'),
    ).toBe(true);
  });

  it("answers true when the file cannot be parsed", () => {
    expect(isComment("a.ts", 'export const = "MARKER";\n')).toBe(true);
  });

  it("answers true for an extension it has no loader for", () => {
    expect(isComment("a.vue", 'const s = "MARKER";\n')).toBe(true);
  });

  it("answers true for a span outside the content", () => {
    const probe = createCommentProbe("a.ts", "export const x = 1;\n");
    expect(probe(-1, 3)).toBe(true);
    expect(probe(18, 10)).toBe(true);
    expect(probe(0, 0)).toBe(true);
  });

  it("answers each question about the same file independently", () => {
    const source = 'export const s = "MARKER"; // MARKER\n';
    const probe = createCommentProbe("a.ts", source);
    expect(probe(source.indexOf(MARK), MARK.length)).toBe(false);
    expect(probe(source.lastIndexOf(MARK), MARK.length)).toBe(true);
  });
});

describe("loaderForPath", () => {
  it.each<[string, ReturnType<typeof loaderForPath>]>([
    ["a.ts", "ts"],
    ["a.d.ts", "ts"],
    ["a.mts", "ts"],
    ["a.cts", "ts"],
    ["a.tsx", "tsx"],
    ["a.js", "jsx"],
    ["a.mjs", "jsx"],
    ["a.cjs", "jsx"],
    ["a.jsx", "jsx"],
    ["A.TS", "ts"],
    ["a.vue", undefined],
    ["Makefile", undefined],
  ])("%s -> %s", (file, loader) => {
    expect(loaderForPath(file)).toBe(loader);
  });
});
