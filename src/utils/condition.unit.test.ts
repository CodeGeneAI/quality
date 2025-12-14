import { describe, expect, it, vi } from "vitest";
import { evaluateCondition } from "./condition";

describe("evaluateCondition", () => {
  const context = {
    env: {
      CI: "true",
      QUALITY_PARALLEL_LIMIT: "2",
      EMPTY: "",
      CACHED: "yes",
      TEXT: "Hello\nworld",
    },
  } satisfies { env: NodeJS.ProcessEnv };

  it("supports loose equality for env-provided strings", () => {
    expect(evaluateCondition("env.CI == true", context)).toBe(true);
    expect(evaluateCondition("env.QUALITY_PARALLEL_LIMIT == 2", context)).toBe(
      true,
    );
    expect(evaluateCondition("env.QUALITY_PARALLEL_LIMIT != 3", context)).toBe(
      true,
    );
  });

  it("evaluates logical operators with correct precedence", () => {
    expect(
      evaluateCondition(
        '(env.CI == true && env.EMPTY == "") || false',
        context,
      ),
    ).toBe(true);
    expect(
      evaluateCondition("env.QUALITY_PARALLEL_LIMIT > 1 && env.CI", context),
    ).toBe(true);
  });

  it("parses string literals with escape sequences", () => {
    expect(evaluateCondition("'Hello\\nworld' == env.TEXT", context)).toBe(
      true,
    );
    expect(evaluateCondition('"He said \\"hi\\"" != env.EMPTY', context)).toBe(
      true,
    );
  });

  it("treats missing identifiers, null, and undefined as falsy", () => {
    expect(evaluateCondition("env.MISSING", context)).toBe(false);
    expect(evaluateCondition("null", context)).toBe(false);
    expect(evaluateCondition("undefined", context)).toBe(false);
  });

  it("throws descriptive errors for malformed expressions", () => {
    expect(() => evaluateCondition("(env.CI == true", context)).toThrow(
      "Unbalanced parentheses",
    );
    expect(() => evaluateCondition("'unterminated", context)).toThrow(
      "Unterminated string literal",
    );
    expect(() => evaluateCondition("env.CI &&& true", context)).toThrow(
      "Unexpected character '&'",
    );
  });

  it("caches compiled evaluators per expression", () => {
    const setSpy = vi.spyOn(Map.prototype, "set");
    evaluateCondition('env.CACHED == "yes"', context);
    evaluateCondition('env.CACHED == "yes"', context);
    const cacheSetsForExpression = setSpy.mock.calls.filter(
      ([key]) => key === 'env.CACHED == "yes"',
    );
    expect(cacheSetsForExpression).toHaveLength(1);
    setSpy.mockRestore();
  });
});
