import { describe, expect, it } from "bun:test";
import {
  buildFilterFromPreset,
  CommandOutputFilter,
  commandOutputFilterPresets,
} from "./command-output-filter";

const sampleBunTestLog = `
 bun test v1.3.11 (af24e281)
 
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

  it("applies bun-test preset rules", () => {
    const filter = buildFilterFromPreset("bun-test");
    filter.addChunk("stderr", sampleBunTestLog);
    filter.finalize();

    const filtered = filter.getFilteredLines().map((line) => line.text.trim());
    expect(filtered).toEqual([
      "✖ pkg/c.spec.ts (1)",
      "● Test suite failed",
      "AssertionError: expected true to be false",
      "at Object.<anonymous> (pkg/c.spec.ts:10:5)",
    ]);
    expect(commandOutputFilterPresets["bun-test"].mode).toBe("errors-only");
  });
});
