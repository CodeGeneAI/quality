import { mkdir, readdir, rm, stat } from "fs/promises";

export const pathExists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
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
  JSON.parse(await readTextFile(filePath)) as T;

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
