#!/usr/bin/env bun
process.argv.splice(2, 0, "check");
await import("../src/cli/index.ts");
