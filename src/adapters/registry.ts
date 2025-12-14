import type { StageAdapter, StageAdapterModuleExport } from "./types";

const registry = new Map<string, StageAdapter>();

export const registerAdapter = (adapter: StageAdapter): void => {
  if (registry.has(adapter.type)) {
    return;
  }
  registry.set(adapter.type, adapter);
};

export const registerAdapters = (adapters: readonly StageAdapter[]): void => {
  for (const adapter of adapters) {
    registerAdapter(adapter);
  }
};

export const loadAdapterModule = async (
  modulePath: string,
): Promise<readonly StageAdapter[]> => {
  const module = await import(modulePath);
  const adapters = extractAdaptersFromModule(module);
  registerAdapters(adapters);
  return adapters;
};

export const extractAdaptersFromModule = (module: unknown): StageAdapter[] => {
  const adapters: StageAdapter[] = [];
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }
    if (typeof value === "object") {
      if ("adapters" in (value as Record<string, unknown>)) {
        const { adapters: nested } = value as {
          adapters?: StageAdapterModuleExport;
        };
        visit(nested);
        return;
      }
    }
    if (isStageAdapter(value)) {
      adapters.push(value);
    }
  };

  if (module && typeof module === "object") {
    const record = module as Record<string, unknown>;
    if ("default" in record) {
      visit(record.default);
    }
    if ("adapters" in record) {
      visit(record.adapters);
    }
  } else {
    visit(module);
  }

  return adapters;
};

export const getAdapter = (type: string): StageAdapter | undefined =>
  registry.get(type);

export const listAdapters = (): StageAdapter[] => Array.from(registry.values());

export const resetAdapters = (): void => {
  registry.clear();
};

const isStageAdapter = (value: unknown): value is StageAdapter =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as StageAdapter).type === "string" &&
      typeof (value as StageAdapter).run === "function",
  );
