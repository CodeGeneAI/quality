/**
 * Tells whether a span of JavaScript or TypeScript source lies inside a
 * comment, as opposed to a string, template literal, regular expression or
 * JSX text that only spells the same characters.
 *
 * Bun's transpiler drops comments from its output and keeps every other
 * token, so a span whose characters can be replaced by spaces without changing
 * the transpiled output sits in a comment, and a span whose replacement changes
 * the output is code. This uses the parser that runs the file instead of a
 * hand-written tokenizer, so template nesting, regular expression literals and
 * JSX are read the way Bun reads them.
 *
 * Two kinds of comment survive transpiling and are neutralized first, in both
 * texts the probe compares: legal comments that start `/*!` or `//!` (Bun keeps
 * them, measured with Bun 1.4.4 on 2026-11-07). Each is rewritten with a space
 * in place of the `!`, which keeps every offset and leaves a string or regular
 * expression that happens to contain the same bytes changed identically in both
 * texts, so the comparison still reads only the probed span.
 *
 * The probe answers `true` ("comment") whenever it cannot tell: an extension
 * it has no loader for, or a file the transpiler refuses. A caller that reports
 * comments therefore keeps reporting what a plain text match would report in
 * those cases. Characters in TypeScript type positions (a string literal type)
 * are erased by the transpiler like comments are, so they also answer `true`.
 */

type SourceLoader = "ts" | "tsx" | "jsx";

const LOADER_BY_EXTENSION: Readonly<Record<string, SourceLoader>> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
  // Bun's `js` loader rejects JSX, which React projects commonly put in .js
  // files; `jsx` parses plain JavaScript as well.
  js: "jsx",
  mjs: "jsx",
  cjs: "jsx",
  jsx: "jsx",
};

const LEGAL_COMMENT_OPENERS = /\/\*!|\/\/!/g;

/** Answers whether `content.slice(offset, offset + length)` is in a comment. */
export type CommentProbe = (offset: number, length: number) => boolean;

/** Picks the transpiler loader for a path, or `undefined` for other files. */
export const loaderForPath = (filePath: string): SourceLoader | undefined => {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return undefined;
  return LOADER_BY_EXTENSION[filePath.slice(dot + 1).toLowerCase()];
};

const neutralizeLegalComments = (source: string): string =>
  source.replace(LEGAL_COMMENT_OPENERS, (opener) => `${opener.slice(0, 2)} `);

/**
 * Builds a probe for one file's content. The content is transpiled at most
 * once for the baseline, on the first question, plus once per question.
 */
export const createCommentProbe = (
  filePath: string,
  content: string,
): CommentProbe => {
  const loader = loaderForPath(filePath);
  if (!loader) return () => true;

  const transpiler = new Bun.Transpiler({ loader });
  const source = neutralizeLegalComments(content);
  const transform = (text: string): string | undefined => {
    try {
      return transpiler.transformSync(text);
    } catch {
      return undefined;
    }
  };

  let baseline: string | undefined | null = null;

  return (offset, length) => {
    if (length <= 0 || offset < 0 || offset + length > source.length) {
      return true;
    }
    if (baseline === null) baseline = transform(source);
    if (baseline === undefined) return true;

    const blanked =
      source.slice(0, offset) +
      " ".repeat(length) +
      source.slice(offset + length);
    const output = transform(blanked);
    return output === undefined || output === baseline;
  };
};
