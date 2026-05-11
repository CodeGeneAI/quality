export interface EnvEntry {
  readonly key: string;
  readonly value: string;
  readonly line: number;
}

export const ENCRYPTED_PREFIX = "encrypted:";

export const COMPUTED_ENV_VALUE_PATTERN =
  /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}$/;

export function parseEnvFile(content: string): readonly EnvEntry[] {
  const entries: EnvEntry[] = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push({ key, value, line: i + 1 });
  }

  return entries;
}

export function isComputedEnvValue(value: string): boolean {
  return COMPUTED_ENV_VALUE_PATTERN.test(value);
}
