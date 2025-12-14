export const mergeDeep = <T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T => {
  const output: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = output[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      output[key] = mergeDeep(existing as Record<string, unknown>, value);
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      output[key] = [...existing, ...value];
    } else {
      output[key] = value;
    }
  }
  return output as T;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
