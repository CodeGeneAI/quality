import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { biomeIgnoreAdapter } from "./biome-ignore";

/**
 * ESLint reads its directives from comments only, so the stage reports an
 * `eslint-*` directive when it is a comment and never when a string, template
 * literal, regular expression or JSX text merely spells one.
 */

const runOnFile = async (
  name: string,
  content: string,
  mode: "check" | "fix" = "check",
) => {
  const root = await mkdtemp(join(tmpdir(), "quality-biome-ignore-comments-"));
  try {
    await writeFile(join(root, name), content);
    const result = await biomeIgnoreAdapter.run({
      mode,
      pipelineMode: mode,
      stage: {
        id: "biome-ignore",
        type: "biome-ignore",
        options: {},
        continueOnError: false,
        files: [],
      },
      root,
      options: {},
      files: [name],
      hasExplicitFileSelection: true,
      ignore: [],
      abortSignal: new AbortController().signal,
    });
    const after = await readFile(join(root, name), "utf8");
    return { result, after };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const reportedLines = (messages: readonly string[] | undefined): number[] =>
  (messages ?? []).map((message) =>
    Number(message.match(/^[^:]+:(\d+) /)?.[1]),
  );

describe("biome-ignore reads real comments only", () => {
  describe("real directives are still reported", () => {
    const cases: ReadonlyArray<{ name: string; file: string; source: string }> =
      [
        {
          name: "a line comment",
          file: "a.ts",
          source: "const x = 1;\n// eslint-disable-next-line no-console\n",
        },
        {
          name: "a block comment",
          file: "a.ts",
          source: "/* eslint-disable */\nexport const x = 1;\n",
        },
        {
          name: "a trailing comment after a string holding //",
          file: "a.ts",
          source:
            'export const url = "https://example.com"; // eslint-disable -- reason\n',
        },
        {
          name: "a comment after a legal comment the transpiler keeps",
          file: "a.ts",
          source: "/*! license */ /* eslint-disable */\nexport const x = 1;\n",
        },
        {
          name: "a comment in a TSX file beside JSX",
          file: "a.tsx",
          source:
            "export const A = () => (\n  // eslint-disable-next-line react/jsx-key\n  <div>hi</div>\n);\n",
        },
        {
          name: "a comment in a .js file that holds JSX",
          file: "a.js",
          source:
            "// eslint-disable-next-line no-undef\nexport const A = () => <div>hi</div>;\n",
        },
        {
          name: "a comment after a template literal",
          file: "a.ts",
          source:
            "export const s = `a\nb`;\n/* eslint-enable */\nexport const t = 1;\n",
        },
        {
          name: "a comment after a regular expression holding /*",
          file: "a.ts",
          source: "export const r = /\\/\\*/g; // eslint-disable -- regex\n",
        },
      ];

    for (const testCase of cases) {
      it(testCase.name, async () => {
        const { result } = await runOnFile(testCase.file, testCase.source);
        expect(result.status).toBe("failed");
        expect(result.messages).toHaveLength(1);
      });
    }
  });

  describe("text that only spells a directive is not reported", () => {
    const cases: ReadonlyArray<{ name: string; file: string; source: string }> =
      [
        {
          name: "a template literal line in a spec",
          file: "a.unit.spec.ts",
          source:
            'const source = `\n/* eslint-disable no-console */\nconsole.log("x");\n`;\nexport { source };\n',
        },
        {
          name: "a string with a -- reason",
          file: "a.ts",
          source:
            'export const s = "// eslint-disable-next-line no-x -- why";\n',
        },
        {
          name: "a single-quoted string with a -- reason",
          file: "a.ts",
          source: "export const s = '/* eslint-enable -- why */';\n",
        },
        {
          name: "a regular expression literal",
          file: "a.ts",
          source: "export const r = /\\/* eslint-disable -- x/;\n",
        },
        {
          name: "JSX text",
          file: "a.tsx",
          source:
            "export const A = () => (\n  <pre>\n    // eslint-disable-next-line no-console\n  </pre>\n);\n",
        },
        {
          name: "a legal-comment opener inside a string",
          file: "a.ts",
          source:
            'export const s = "/*! keep */ /* eslint-disable -- why */";\n',
        },
      ];

    for (const testCase of cases) {
      it(testCase.name, async () => {
        const { result } = await runOnFile(testCase.file, testCase.source);
        expect(result.status).toBe("passed");
      });
    }
  });

  it("reports the real comment and not the mention in the same file", async () => {
    const source = [
      "const fixture = `",
      "// eslint-disable-next-line no-console",
      "`;",
      "// eslint-disable-next-line no-console",
      "console.log(fixture);",
      "",
    ].join("\n");

    const { result } = await runOnFile("mixed.ts", source);

    expect(result.status).toBe("failed");
    expect(reportedLines(result.messages)).toEqual([4]);
  });

  it("--auto-fix rewrites the comment and leaves the template literal untouched", async () => {
    const source = [
      "const fixture = `",
      "  // eslint-disable-next-line no-console",
      "`;",
      "// eslint-disable-next-line no-console",
      "console.log(fixture);",
      "",
    ].join("\n");

    const { result, after } = await runOnFile("mixed.ts", source, "fix");

    expect(result.status).toBe("passed");
    expect(after).toBe(
      [
        "const fixture = `",
        "  // eslint-disable-next-line no-console",
        "`;",
        "// biome-ignore lint: no-console",
        "console.log(fixture);",
        "",
      ].join("\n"),
    );
  });

  it("keeps reporting when the file cannot be parsed", async () => {
    const source = "export const = ;\nconst s = `\n// eslint-disable\n`;\n";

    const { result } = await runOnFile("broken.ts", source);

    expect(result.status).toBe("failed");
    expect(reportedLines(result.messages)).toEqual([3]);
  });

  it("keeps reporting in a selected file the transpiler has no loader for", async () => {
    const { result } = await runOnFile(
      "component.vue",
      "<script>\n// eslint-disable-next-line\n</script>\n",
    );

    expect(result.status).toBe("failed");
    expect(reportedLines(result.messages)).toEqual([2]);
  });
});
