#!/usr/bin/env bun
import { Cli } from "clipanion";
import {
  QualityCiEmitCommand,
  QualityCiListCommand,
  QualityCiRunCommand,
  QualityGitHookCommand,
  QualityHooksInstallCommand,
  QualityHooksListCommand,
  QualityHooksUninstallCommand,
  QualityInitCommand,
  QualityListCommand,
  QualityRunCommand,
  QualityRunStageCommand,
  QualityValidateCommand,
} from "./commands";

const cli = new Cli({
  binaryLabel: "Forge Quality Suite",
  binaryName: "quality",
  binaryVersion: "0.0.1",
});

cli.register(QualityRunCommand);
cli.register(QualityRunStageCommand);
cli.register(QualityListCommand);
cli.register(QualityHooksInstallCommand);
cli.register(QualityHooksUninstallCommand);
cli.register(QualityHooksListCommand);
cli.register(QualityGitHookCommand);
cli.register(QualityCiRunCommand);
cli.register(QualityCiListCommand);
cli.register(QualityCiEmitCommand);
cli.register(QualityInitCommand);
cli.register(QualityValidateCommand);

void cli.runExit(process.argv.slice(2));
