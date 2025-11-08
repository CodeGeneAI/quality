import type { ResolvedCiTarget } from "../config/types";

export type CiEmitterFormat = "github" | "gitlab" | "generic";

export interface EmitOptions {
  readonly targetName: string;
  readonly target: ResolvedCiTarget;
  readonly format: CiEmitterFormat;
}

export const emitCiTarget = (options: EmitOptions): string => {
  switch (options.format) {
    case "github":
      return emitGithubJob(options.targetName, options.target);
    case "gitlab":
      return emitGitlabJob(options.targetName, options.target);
    case "generic":
      return emitGenericJob(options.targetName, options.target);
    default:
      throw new Error(`Unsupported format '${options.format}'.`);
  }
};

const emitGithubJob = (
  targetName: string,
  target: ResolvedCiTarget,
): string => {
  const lines: string[] = [
    "jobs:",
    `  quality-${sanitizeName(targetName)}:`,
    `    name: Quality (${targetName})`,
  ];

  const matrixLines = formatGithubMatrix(target.matrix);
  if (matrixLines.length > 0) {
    lines.push(...matrixLines);
  } else {
    lines.push("    runs-on: ubuntu-latest");
  }

  lines.push("    steps:");
  lines.push("      - uses: actions/checkout@v4");
  lines.push("      - uses: oven-sh/setup-bun@v1");
  lines.push("      - run: bun install");
  lines.push(...formatRunStep(targetName, target, "      "));
  return lines.join("\n");
};

const emitGitlabJob = (
  targetName: string,
  target: ResolvedCiTarget,
): string => {
  const lines: string[] = [`${sanitizeName(targetName)}:`, "  stage: test"];

  const envLines = formatEnvLines(target.env, "    ");
  if (envLines.length > 0) {
    lines.push("  variables:");
    lines.push(...envLines);
  }

  lines.push("  script:");
  lines.push("    - bun install");
  lines.push(...formatRunStep(targetName, target, "    "));
  return lines.join("\n");
};

const emitGenericJob = (
  targetName: string,
  target: ResolvedCiTarget,
): string => {
  const lines: string[] = [
    "job:",
    `  name: ${targetName}`,
    "  steps:",
    "    - run: bun install",
  ];
  lines.push(...formatRunStep(targetName, target, "    "));
  return lines.join("\n");
};

const formatRunStep = (
  targetName: string,
  target: ResolvedCiTarget,
  indent: string,
): string[] => {
  const command = `quality ci run ${targetName}`;
  const lines: string[] = [`${indent}- run: ${command}`];
  const envLines = formatEnvLines(target.env, `${indent}  `);
  if (envLines.length > 0) {
    lines.push(`${indent}  env:`);
    lines.push(...envLines);
  }
  return lines;
};

const formatGithubMatrix = (
  matrix: Record<string, readonly string[]> | undefined,
): string[] => {
  if (!matrix || Object.keys(matrix).length === 0) {
    return [];
  }
  const lines: string[] = ["    strategy:", "      matrix:"];
  for (const [key, values] of Object.entries(matrix)) {
    lines.push(`        ${key}: [${values.join(", ")}]`);
  }
  lines.push("    runs-on: ${{ matrix.os || 'ubuntu-latest' }}");
  return lines;
};

const formatEnvLines = (
  env: Record<string, string> | undefined,
  indent: string,
): string[] => {
  if (!env || Object.keys(env).length === 0) {
    return [];
  }
  return Object.entries(env).map(
    ([key, value]) => `${indent}${key}: ${JSON.stringify(value)}`,
  );
};

const sanitizeName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9\-_]/g, "-");
