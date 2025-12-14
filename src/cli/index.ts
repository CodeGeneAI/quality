import { Cli } from "clipanion";
import packageJson from "../../package.json" with { type: "json" };
import {
  QualityConfigPrintCommand,
  QualityConfigValidateAllCommand,
  QualityInitCommand,
  QualityListCommand,
  QualityRunCommand,
  QualityRunStageCommand,
  QualityTelemetryAnalyzeCommand,
  QualityValidateCommand,
} from "./commands";

const { version: packageVersion } = packageJson;

export const createQualityCli = (): Cli => {
  const cli = new Cli({
    binaryLabel: "Quality Suite",
    binaryName: "quality",
    binaryVersion: packageVersion,
  });

  cli.register(QualityRunCommand);
  cli.register(QualityRunStageCommand);
  cli.register(QualityListCommand);
  cli.register(QualityInitCommand);
  cli.register(QualityValidateCommand);
  cli.register(QualityConfigValidateAllCommand);
  cli.register(QualityConfigPrintCommand);
  cli.register(QualityTelemetryAnalyzeCommand);

  return cli;
};

export const runQualityCli = async (
  args: string[],
  stdio?: {
    readonly stdin?: NodeJS.ReadStream;
    readonly stdout?: NodeJS.WriteStream;
    readonly stderr?: NodeJS.WriteStream;
  },
): Promise<number | void> => {
  const cli = createQualityCli();
  const exitCode = await cli.run(args, {
    stdin: stdio?.stdin ?? process.stdin,
    stdout: stdio?.stdout ?? process.stdout,
    stderr: stdio?.stderr ?? process.stderr,
  });
  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
  }
  return exitCode;
};

export const qualityCliFacade = {
  createCli: createQualityCli,
  runCli: runQualityCli,
};
