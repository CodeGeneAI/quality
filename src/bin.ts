#!/usr/bin/env bun

import { createQualityCli } from "./cli/index";

const cli = createQualityCli();

cli.runExit(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
