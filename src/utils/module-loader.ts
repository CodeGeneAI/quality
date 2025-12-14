export const loadTsConfigModule = async (
  filePath: string,
): Promise<{ default: unknown }> => {
  const url = pathToFileUrl(filePath).href;
  const module = await import(url);
  return module as { default: unknown };
};

const pathToFileUrl = (path: string): URL => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return new URL(`file://${normalized}`);
};
