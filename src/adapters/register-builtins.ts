import { registerAdapters } from "./registry";
import { biomeAdapter } from "./systems/biome";
import { bunNativeAdapter } from "./systems/bun-native";
import { commandAdapter } from "./systems/command";
import { filenameAdapter } from "./systems/filenames";
import { importExtensionsAdapter } from "./systems/import-extensions";
import { metadataVerifyAdapter } from "./systems/metadata-verify";
import { noRootBarrelAdapter } from "./systems/no-root-barrel";
import { structureAdapter } from "./systems/structure";
import { templateCheckAdapter } from "./systems/template-check";

export const registerBuiltInAdapters = (): void => {
  registerAdapters([
    biomeAdapter,
    importExtensionsAdapter,
    bunNativeAdapter,
    filenameAdapter,
    structureAdapter,
    noRootBarrelAdapter,
    commandAdapter,
    templateCheckAdapter,
    metadataVerifyAdapter,
  ]);
};
