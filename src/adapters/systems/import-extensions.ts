import micromatch from "micromatch";
import * as ts from "typescript";
import fg from "../../utils/bun-glob";
import {
  DEFAULT_GLOB_IGNORE,
  mergeIgnorePatterns,
  shouldIgnorePath,
} from "../../utils/glob";
import { extname, joinPaths } from "../../utils/path";
import type { StageAdapter } from "../types";

const TARGET_FILE_EXTENSIONS = ["ts", "tsx"] as const;
const FORBIDDEN_SPEC_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const DEFAULT_IGNORE_PATTERNS = [...DEFAULT_GLOB_IGNORE, "**/build/**"];

export interface ImportExtensionsAdapterOptions {
  readonly allowlist?: Record<string, string[] | string>;
  readonly verbose?: boolean;
  readonly severity?: "error" | "warn";
}

export const importExtensionsAdapter: StageAdapter<ImportExtensionsAdapterOptions> =
  {
    type: "imports",
    label: "Import extension enforcement",
    supportsModes: ["check", "fix", "report"],
    supportsSandbox: true,
    supportsPartialFiles: true,
    async run(context) {
      const options = context.options ?? {};
      const allowlist = buildAllowlist(options.allowlist ?? {});
      const verbose = options.verbose === true;
      const ignorePatterns = mergeIgnorePatterns(
        DEFAULT_IGNORE_PATTERNS,
        context.ignore,
      );
      const globIgnore = [...ignorePatterns];
      const files = await resolveFiles(context.root, context.files, globIgnore);

      let totalViolations = 0;
      let filesWithViolations = 0;
      let filesPatched = 0;
      const violationMessages: string[] = [];

      for (const filePath of files) {
        if (context.abortSignal.aborted) {
          break;
        }
        if (shouldIgnorePath(filePath, DEFAULT_IGNORE_PATTERNS)) {
          continue;
        }
        const absolutePath = joinPaths(context.root, filePath);
        const file = Bun.file(absolutePath);
        if (!(await file.exists())) {
          continue;
        }
        const content = await file.text();
        if (!mightContainForbiddenExtension(content)) {
          continue;
        }

        const scriptKind = resolveScriptKind(filePath);
        const sourceFile = ts.createSourceFile(
          filePath,
          content,
          ts.ScriptTarget.Latest,
          true,
          scriptKind,
        );

        const { patches, violations } = collectViolations(
          sourceFile,
          content,
          filePath,
          allowlist,
        );

        if (violations.length === 0) {
          continue;
        }

        filesWithViolations += 1;
        totalViolations += violations.length;
        for (const violation of violations) {
          violationMessages.push(
            `${violation.file}:${violation.line}:${violation.column} -> ${violation.spec} (should be ${violation.replacement})`,
          );
        }

        if (context.mode === "fix" && !context.abortSignal.aborted) {
          const updated = applyPatches(content, patches);
          await Bun.write(absolutePath, updated);
          filesPatched += 1;
          if (verbose) {
            console.log(
              `${filePath} -> fixed ${violations.length} import specifier(s)`,
            );
          }
        }
      }

      if (context.abortSignal.aborted) {
        return {
          status: "skipped",
          messages: ["Import extension enforcement aborted."],
        };
      }

      if (totalViolations === 0) {
        return { status: "passed" };
      }

      if (context.mode === "fix") {
        return {
          status: "passed",
          messages: [
            `Removed extensions from ${totalViolations} import specifier(s) across ${filesPatched} file(s).`,
          ],
        };
      }

      if (context.mode === "report" || options.severity === "warn") {
        return {
          status: "passed",
          messages: [
            ...violationMessages,
            `Found ${totalViolations} import specifier(s) ending with disallowed extensions across ${filesWithViolations} file(s).`,
          ],
        };
      }

      return {
        status: "failed",
        messages: [
          ...violationMessages,
          `Found ${totalViolations} import specifier(s) ending with disallowed extensions across ${filesWithViolations} file(s).`,
        ],
      };
    },
  };

type Allowlist = Map<string, string[]>;

type Patch = {
  start: number;
  end: number;
  text: string;
};

type Violation = {
  file: string;
  line: number;
  column: number;
  spec: string;
  replacement: string;
};

const buildAllowlist = (
  config: Record<string, string[] | string>,
): Allowlist => {
  const map = new Map<string, string[]>();
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) {
      map.set(key, value.map(String));
    } else if (typeof value === "string") {
      map.set(key, [value]);
    }
  }
  return map;
};

const resolveFiles = async (
  root: string,
  files: readonly string[],
  ignorePatterns: readonly string[],
): Promise<string[]> => {
  if (files.length > 0) {
    return files.filter((file) => !shouldIgnorePath(file, ignorePatterns));
  }
  const matches = fg.sync(`**/*.{${TARGET_FILE_EXTENSIONS.join(",")}}`, {
    cwd: root,
    dot: true,
    ignore: [...ignorePatterns],
  });
  return matches.filter((file) => !shouldIgnorePath(file, ignorePatterns));
};

const resolveScriptKind = (filePath: string): ts.ScriptKind => {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.TS;
  }
};

const mightContainForbiddenExtension = (content: string): boolean => {
  const lower = content.toLowerCase();
  return FORBIDDEN_SPEC_EXTENSIONS.some((ext) => lower.includes(ext));
};

const collectViolations = (
  sourceFile: ts.SourceFile,
  content: string,
  relativeFile: string,
  allowlist: Allowlist,
): { patches: Patch[]; violations: Violation[] } => {
  const patches: Patch[] = [];
  const violations: Violation[] = [];

  const visitor = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    ) {
      const specifier = getModuleSpecifier(node);
      if (!specifier) return;
      const literal = specifier.getText(sourceFile);
      if (!literal.startsWith('"') && !literal.startsWith("'")) {
        return;
      }
      const text = literal.slice(1, -1);
      const extension = FORBIDDEN_SPEC_EXTENSIONS.find((ext) =>
        text.endsWith(ext),
      );
      if (!extension) {
        return;
      }
      const fileAllow = allowlist.get(relativeFile) ?? allowlist.get("*");
      if (
        fileAllow &&
        fileAllow.some((pattern) => micromatch.isMatch(text, pattern))
      ) {
        return;
      }
      const replacement = text.replace(extension, "");
      patches.push({
        start: specifier.getStart(),
        end: specifier.getEnd(),
        text: `'${replacement}'`,
      });
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        specifier.getStart(),
      );
      violations.push({
        file: relativeFile,
        line: line + 1,
        column: character + 1,
        spec: text,
        replacement,
      });
    }
    ts.forEachChild(node, visitor);
  };

  visitor(sourceFile);
  return { patches, violations };
};

const getModuleSpecifier = (
  node:
    | ts.ImportDeclaration
    | ts.ExportDeclaration
    | ts.ImportEqualsDeclaration,
): ts.Expression | undefined => {
  if (ts.isImportEqualsDeclaration(node)) {
    return node.moduleReference &&
      ts.isExternalModuleReference(node.moduleReference)
      ? (node.moduleReference.expression ?? undefined)
      : undefined;
  }
  return node.moduleSpecifier ?? undefined;
};

const applyPatches = (content: string, patches: Patch[]): string => {
  if (patches.length === 0) {
    return content;
  }
  const sorted = [...patches].sort((a, b) => a.start - b.start);
  let offset = 0;
  let updated = content;
  for (const patch of sorted) {
    const start = patch.start + offset;
    const end = patch.end + offset;
    updated = `${updated.slice(0, start)}${patch.text}${updated.slice(end)}`;
    offset += patch.text.length - (patch.end - patch.start);
  }
  return updated;
};
