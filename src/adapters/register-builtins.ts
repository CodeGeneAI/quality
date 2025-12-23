import { registerAdapters } from "./registry";
import { barrelExportsAdapter } from "./systems/barrel-exports";
import { biomeConfigAdapter } from "./systems/biome-config";
import { bunNativeAdapter } from "./systems/bun-native";
import { commandAdapter } from "./systems/command";
import { filenameAdapter } from "./systems/filenames";
import { importExtensionsAdapter } from "./systems/import-extensions";
import { packageCatalogAdapter } from "./systems/package-catalog";
import { packageScriptsAdapter } from "./systems/package-scripts";
import { structureAdapter } from "./systems/structure";
import { unitAdjacencyAdapter } from "./systems/unit-adjacency";

export const registerBuiltInAdapters = (): void => {
  registerAdapters([
    importExtensionsAdapter,
    bunNativeAdapter,
    barrelExportsAdapter,
    biomeConfigAdapter,
    filenameAdapter,
    structureAdapter,
    unitAdjacencyAdapter,
    packageCatalogAdapter,
    packageScriptsAdapter,
    commandAdapter,
  ]);
};
