import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineResult } from "../reporters/types";
import { readTextFile } from "../utils/fs";
import { isTelemetryEnabled, publishTelemetry } from "./telemetry";

const baseResult: PipelineResult = {
  profile: "local",
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(1000).toISOString(),
  stages: [],
  success: true,
};

const resetEnvs: string[] = ["QUALITY_TELEMETRY", "QUALITY_TELEMETRY_FILE"];

beforeEach(() => {
  for (const key of resetEnvs) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of resetEnvs) {
    delete process.env[key];
  }
  vi.restoreAllMocks();
});

describe("publishTelemetry", () => {
  it("writes payloads to stdout", async () => {
    process.env.QUALITY_TELEMETRY = "stdout";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await publishTelemetry({
      context: "test:stdout",
      result: baseResult,
      files: ["sample.txt"],
      root: process.cwd(),
      metadata: { phase: "check" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0]?.[0] ?? "";
    expect(payload).toContain("quality.telemetry");
    expect(payload).toContain("test:stdout");
  });

  it("appends payloads to a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quality-telemetry-"));
    const filePath = join(dir, "telemetry.log");
    process.env.QUALITY_TELEMETRY = "file";
    process.env.QUALITY_TELEMETRY_FILE = filePath;

    await publishTelemetry({
      context: "test:file",
      result: baseResult,
      files: [],
      root: process.cwd(),
    });

    const text = await readTextFile(filePath);
    expect(text).toContain("test:file");
  });
});

describe("isTelemetryEnabled", () => {
  it("returns false when telemetry is disabled", () => {
    delete process.env.QUALITY_TELEMETRY;
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("returns true for stdout mode", () => {
    process.env.QUALITY_TELEMETRY = "stdout";
    expect(isTelemetryEnabled()).toBe(true);
  });

  it("returns true for file mode", () => {
    process.env.QUALITY_TELEMETRY = "file";
    expect(isTelemetryEnabled()).toBe(true);
  });
});
