import { inspect } from "util";

type Lazy<T> = T | (() => T);

export const isDebugEnabled = (): boolean =>
  process.env.QUALITY_DEBUG === "1" || process.env.QUALITY_DEBUG === "true";

export const debugLog = (
  context: string,
  message: Lazy<string>,
  details?: Lazy<unknown>,
): void => {
  if (!isDebugEnabled()) {
    return;
  }
  const resolvedMessage = resolveLazy(message);
  const timestamp = new Date().toISOString();
  if (details === undefined) {
    console.debug(`[quality][${timestamp}][${context}] ${resolvedMessage}`);
    return;
  }
  const resolvedDetails = resolveLazy(details);
  console.debug(
    `[quality][${timestamp}][${context}] ${resolvedMessage} ${inspect(
      resolvedDetails,
      {
        depth: 4,
        colors: false,
        sorted: true,
      },
    )}`,
  );
};

const resolveLazy = <T>(value: Lazy<T>): T => {
  if (typeof value === "function") {
    return (value as () => T)();
  }
  return value;
};
