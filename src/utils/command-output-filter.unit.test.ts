import { describe, expect, it } from "bun:test";
import {
  buildFilterFromPreset,
  CommandOutputFilter,
  commandOutputFilterPresets,
} from "./command-output-filter";

const sampleVitestLog = `
 RUN  v4.0.6 /repo
 
 ✓ pkg/a.spec.ts (2)
 ✓ pkg/b.spec.ts (1)
 ✖ pkg/c.spec.ts (1)
   ● Test suite failed
     AssertionError: expected true to be false
         at Object.<anonymous> (pkg/c.spec.ts:10:5)
`;

describe("CommandOutputFilter", () => {
  it("collects raw and filtered lines with chunked input", () => {
    const filter = new CommandOutputFilter({
      mode: "errors-only",
      include: [/FAIL/],
    });

    const chunk = "FAIL test one\nPASS second";
    filter.addChunk("stdout", chunk.slice(0, 10));
    filter.addChunk("stdout", chunk.slice(10));
    filter.finalize();

    expect(filter.getRawLines().map((line) => line.text)).toEqual([
      "FAIL test one",
      "PASS second",
    ]);
    expect(filter.getFilteredLines().map((line) => line.text)).toEqual([
      "FAIL test one",
    ]);
  });

  it("applies vitest preset rules", () => {
    const filter = buildFilterFromPreset("vitest");
    filter.addChunk("stderr", sampleVitestLog);
    filter.finalize();

    const filtered = filter.getFilteredLines().map((line) => line.text.trim());
    expect(filtered).toEqual([
      "✖ pkg/c.spec.ts (1)",
      "● Test suite failed",
      "AssertionError: expected true to be false",
      "at Object.<anonymous> (pkg/c.spec.ts:10:5)",
    ]);
    expect(commandOutputFilterPresets.vitest.mode).toBe("errors-only");
  });
});
