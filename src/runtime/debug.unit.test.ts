import { afterEach, describe, expect, it, vi } from "bun:test";
import { debugLog, isDebugEnabled } from "./debug";

describe("debug utilities", () => {
  const originalDebug = process.env.QUALITY_DEBUG;

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.QUALITY_DEBUG;
    } else {
      process.env.QUALITY_DEBUG = originalDebug;
    }
    vi.restoreAllMocks();
  });

  it("disables logs when QUALITY_DEBUG is unset", () => {
    delete process.env.QUALITY_DEBUG;
    expect(isDebugEnabled()).toBe(false);
  });

  it("writes structured logs when enabled", () => {
    process.env.QUALITY_DEBUG = "1";
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

    debugLog("test", "hello", { foo: "bar" });

    expect(spy).toHaveBeenCalledTimes(1);
    const message = spy.mock.calls[0]?.[0] ?? "";
    expect(message).toContain("[quality]");
    expect(message).toContain("hello");
    expect(message).toContain("foo");
  });

  it("avoids evaluating lazy payloads when disabled", () => {
    delete process.env.QUALITY_DEBUG;
    const messageFactory = vi.fn(() => "lazy message");
    const detailsFactory = vi.fn(() => ({ lazy: true }));

    debugLog("test", messageFactory, detailsFactory);

    expect(messageFactory).not.toHaveBeenCalled();
    expect(detailsFactory).not.toHaveBeenCalled();
  });
});
