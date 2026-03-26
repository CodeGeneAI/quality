import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { BiomeIgnoreAdapterOptions } from "./biome-ignore";
import { biomeIgnoreAdapter } from "./biome-ignore";

const createTempWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "quality-biome-ignore-"));

const runAdapter = async (
  root: string,
  options: BiomeIgnoreAdapterOptions = {},
  mode: "check" | "fix" = "check",
  files: readonly string[] = [],
) =>
  biomeIgnoreAdapter.run({
    mode,
    pipelineMode: mode,
    stage: {
      id: "biome-ignore",
      type: "biome-ignore",
      options,
      continueOnError: false,
      files: [],
    },
    root,
    options,
    files,
    ignore: [],
    abortSignal: new AbortController().signal,
  });

describe("biome-ignore adapter", () => {
  // ==========================================================================
  // Check mode — basic detection
  // ==========================================================================

  it("passes when no eslint directives exist", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "const x = 1;\nconsole.log(x);\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes on empty file", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(join(root, "empty.ts"), "");

      const result = await runAdapter(root, {}, "check", ["empty.ts"]);

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails on // eslint-disable-next-line", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable-next-line\nconst x = 1;\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(1);
      expect(result.messages?.[0]).toContain("index.ts:1");
      expect(result.messages?.[0]).toContain("eslint-disable-next-line");
      expect(result.messages?.[0]).toContain("use biome-ignore instead");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails on // eslint-disable-next-line with rules", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("no-console");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails on /* eslint-disable */ and /* eslint-enable */", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "/* eslint-disable */\nconst x = 1;\n/* eslint-enable */\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails on // eslint-disable (block start)", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable\nconst x = 1;\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("eslint-disable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects multiple violations in one file", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        [
          "// eslint-disable-next-line no-console",
          'console.log("a");',
          "// eslint-disable-next-line no-debugger",
          "debugger;",
          "// eslint-disable",
          "const x = 1;",
        ].join("\n"),
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects violations across multiple files", async () => {
    const root = await createTempWorkspace();
    try {
      const src = join(root, "src");
      await mkdir(src, { recursive: true });
      await writeFile(
        join(src, "a.ts"),
        "// eslint-disable-next-line\nconst a = 1;\n",
      );
      await writeFile(
        join(src, "b.ts"),
        "// eslint-disable-next-line\nconst b = 2;\n",
      );

      const result = await runAdapter(root, {}, "check", [
        "src/a.ts",
        "src/b.ts",
      ]);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Check mode — regex edge cases
  // ==========================================================================

  it("detects scoped rule names like @typescript-eslint/no-explicit-any", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst x: any = 1;\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain(
        "@typescript-eslint/no-explicit-any",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("strips -- reason suffix from captured rules", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable-next-line no-console -- needed for debug\nconsole.log('debug');\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("no-console");
      expect(result.messages?.[0]).not.toContain("needed for debug");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects inline eslint comment after code", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "const x = 1; // eslint-disable-next-line\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("eslint-disable-next-line");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Check mode — file resolution and ignoring
  // ==========================================================================

  it("performs full glob scan when no files provided", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "a.ts"),
        "// eslint-disable-next-line\nconst a = 1;\n",
      );
      await writeFile(join(root, "b.js"), "// eslint-disable\nconst b = 2;\n");

      const result = await runAdapter(root, {}, "check", []);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects stage-level ignore option", async () => {
    const root = await createTempWorkspace();
    try {
      const ignored = join(root, "vendor");
      await mkdir(ignored, { recursive: true });
      await writeFile(
        join(ignored, "lib.ts"),
        "// eslint-disable-next-line\nconst x = 1;\n",
      );
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable-next-line\nconst y = 2;\n",
      );

      const result = await runAdapter(
        root,
        { ignore: ["vendor/**"] },
        "check",
        ["index.ts", "vendor/lib.ts"],
      );

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(1);
      expect(result.messages?.[0]).toContain("index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips nonexistent files gracefully", async () => {
    const root = await createTempWorkspace();
    try {
      const result = await runAdapter(root, {}, "check", ["nonexistent.ts"]);

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Allowlist
  // ==========================================================================

  it("respects allowlist for specific file", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "legacy.ts"),
        "// eslint-disable-next-line\nconst x = 1;\n",
      );

      const result = await runAdapter(
        root,
        { allowlist: { "legacy.ts": ["eslint-disable-next-line"] } },
        "check",
        ["legacy.ts"],
      );

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects wildcard allowlist", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable\nconst x = 1;\n// eslint-enable\n",
      );

      const result = await runAdapter(
        root,
        { allowlist: { "*": ["eslint-disable", "eslint-enable"] } },
        "check",
        ["index.ts"],
      );

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("respects allowlist with string value (not array)", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "legacy.ts"),
        "// eslint-disable\nconst x = 1;\n",
      );

      const result = await runAdapter(
        root,
        { allowlist: { "legacy.ts": "eslint-disable" } },
        "check",
        ["legacy.ts"],
      );

      expect(result.status).toBe("passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Fix mode
  // ==========================================================================

  it("replaces eslint-disable-next-line with biome-ignore lint", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      const content = await readFile(filePath, "utf8");
      expect(content).toBe(
        '// biome-ignore lint: no-console\nconsole.log("hi");\n',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaces eslint-disable-next-line without rules using directive as reason", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(filePath, "// eslint-disable-next-line\nconst x = 1;\n");

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      const content = await readFile(filePath, "utf8");
      expect(content).toBe(
        "// biome-ignore lint: eslint-disable-next-line\nconst x = 1;\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves indentation when fixing", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        "function foo() {\n    // eslint-disable-next-line no-console\n    console.log('hi');\n}\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      const content = await readFile(filePath, "utf8");
      expect(content).toContain("    // biome-ignore lint: no-console");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves trailing newline in fix mode", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        "// eslint-disable-next-line no-console\nconsole.log('hi');\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      const content = await readFile(filePath, "utf8");
      expect(content.endsWith("\n")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not auto-fix block-level eslint-disable", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        "// eslint-disable\nconst x = 1;\n// eslint-enable\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(2);
      expect(result.messages?.[0]).toContain(
        "cannot auto-fix block-level directive",
      );
      const content = await readFile(filePath, "utf8");
      expect(content).toContain("// eslint-disable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fixes next-line directives and reports unfixable block directives", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        [
          "// eslint-disable-next-line no-console",
          'console.log("a");',
          "// eslint-disable",
          "const x = 1;",
          "// eslint-enable",
        ].join("\n") + "\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.length).toBe(2);

      const content = await readFile(filePath, "utf8");
      expect(content).toContain("// biome-ignore lint: no-console");
      expect(content).toContain("// eslint-disable\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns passed with message when all violations are fixable", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable-next-line no-console\nconsole.log('a');\n// eslint-disable-next-line no-debugger\ndebugger;\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      expect(result.messages?.[0]).toContain(
        "Replaced 2 ESLint ignore comment(s)",
      );
      const content = await readFile(join(root, "index.ts"), "utf8");
      expect(content).toContain("// biome-ignore lint: no-console");
      expect(content).toContain("// biome-ignore lint: no-debugger");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns passed with no messages in fix mode when nothing to fix", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "const x = 1;\nconsole.log(x);\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      expect(result.messages).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("strips -- reason suffix when fixing", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        "// eslint-disable-next-line no-console -- needed for debug\nconsole.log('debug');\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      const content = await readFile(filePath, "utf8");
      expect(content).toContain("// biome-ignore lint: no-console");
      expect(content).not.toContain("needed for debug");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses directive as reason when rules are whitespace-only", async () => {
    const root = await createTempWorkspace();
    try {
      const filePath = join(root, "index.ts");
      await writeFile(
        filePath,
        "// eslint-disable-next-line    \nconsole.log('hi');\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("passed");
      const content = await readFile(filePath, "utf8");
      expect(content).toContain(
        "// biome-ignore lint: eslint-disable-next-line",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks eslint-enable as unfixable block-level directive", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-enable\nconst x = 1;\n",
      );

      const result = await runAdapter(root, {}, "fix", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).toContain("eslint-enable");
      expect(result.messages?.[0]).toContain(
        "cannot auto-fix block-level directive",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not capture -- reason as rules when no rules are present", async () => {
    const root = await createTempWorkspace();
    try {
      await writeFile(
        join(root, "index.ts"),
        "// eslint-disable-next-line -- some reason\nconst x = 1;\n",
      );

      const result = await runAdapter(root, {}, "check", ["index.ts"]);

      expect(result.status).toBe("failed");
      expect(result.messages?.[0]).not.toContain("-- some reason");
      expect(result.messages?.[0]).toContain("eslint-disable-next-line");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
