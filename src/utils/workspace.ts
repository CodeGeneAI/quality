import { join } from "path";
import bunGlob from "./bun-glob";
import { readJsonFile } from "./fs";

export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly isPrivate: boolean;
}

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly workspaces?: readonly string[];
}

export const resolveWorkspacePackages = async (
  root: string,
): Promise<WorkspacePackage[]> => {
  const rootPkg = await readJsonFile<PackageJson>(join(root, "package.json"));
  const workspaceGlobs = rootPkg.workspaces;
  if (!workspaceGlobs || workspaceGlobs.length === 0) {
    return [];
  }

  const matched = await bunGlob(
    workspaceGlobs.map((g) => `${g}/package.json`),
    { cwd: root },
  );

  const packages: WorkspacePackage[] = [];
  for (const pkgJsonPath of matched) {
    try {
      const fullPath = join(root, pkgJsonPath);
      const pkg = await readJsonFile<PackageJson>(fullPath);
      if (!pkg.name) continue;

      const dir = pkgJsonPath.replace(/\/package\.json$/, "");
      packages.push({
        name: pkg.name,
        dir,
        isPrivate: pkg.private === true,
      });
    } catch {
      // Skip directories where package.json can't be read
    }
  }

  return packages;
};

export const mapFilesToPackages = (
  packages: readonly WorkspacePackage[],
  files: readonly string[],
): Map<string, string[]> => {
  // Sort packages by directory depth (deepest first) so nested packages match first
  const sorted = [...packages].sort((a, b) => b.dir.length - a.dir.length);

  const result = new Map<string, string[]>();

  for (const file of files) {
    const pkg = sorted.find(
      (p) => file === p.dir || file.startsWith(`${p.dir}/`),
    );
    if (!pkg) continue;

    const existing = result.get(pkg.name);
    if (existing) {
      existing.push(file);
    } else {
      result.set(pkg.name, [file]);
    }
  }

  return result;
};
