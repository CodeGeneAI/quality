import { mkdir, readdir, rm, stat } from "fs/promises";

export const pathExists = async (target: string): Promise<boolean> => {
  // Bun.file().exists() is ~20x faster than fs.stat() but only works for files.
  // Try the fast path first, then fall back to stat() for directories.
  if (await Bun.file(target).exists()) return true;
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
};

export const ensureDir = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
};

export const removePath = async (target: string): Promise<void> => {
  await rm(target, { recursive: true, force: true });
};

export const readTextFile = (filePath: string): Promise<string> =>
  Bun.file(filePath).text();

export const readJsonFile = async <T>(filePath: string): Promise<T> =>
  Bun.file(filePath).json() as T;

export const writeTextFile = async (
  filePath: string,
  data: string,
): Promise<void> => {
  await Bun.write(filePath, data, { createPath: true });
};

export const listDirectories = async (directory: string): Promise<string[]> => {
  if (!(await pathExists(directory))) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return directories;
};
