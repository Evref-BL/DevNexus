import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";
import {
  defaultNexusAutomationCommandRunner,
  type NexusAutomationCommandRunner,
} from "../automation/nexusAutomationCommandExecutor.js";
import { shellQuoteArgument } from "../automation/nexusAutomationAgentProfile.js";
import {
  buildNexusCliVersionSkewDiagnostic,
  parseDevNexusCommandLines,
  type NexusCliVersionSkewDiagnostic,
} from "./nexusCliVersionSkewDiagnostic.js";
import {
  packageRootPath,
  readCurrentPackageVersion,
} from "./cliRuntime.js";

interface DiagnosticsCliDependencies {
  stdout?: TextWriter;
  commandRunner?: NexusAutomationCommandRunner;
  usage: () => string;
}

interface ParsedDiagnosticsCliVersionSkewCommand {
  installedHelpFile?: string;
  installedCommand?: string;
  expectedFiles: string[];
  sourceCommandFiles: string[];
  expectedCommands: string[];
  packageVersion?: string | null;
  json?: boolean;
}

export async function handleDiagnosticsCommand(
  argv: string[],
  dependencies: DiagnosticsCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "cli-version-skew") {
    const parsed = parseDiagnosticsCliVersionSkewCommand(argv);
    const expected = resolveExpectedCliVersionSkewCommands(parsed);
    const diagnostic = buildNexusCliVersionSkewDiagnostic({
      installedHelpText: resolveDiagnosticsInstalledHelpText(parsed, dependencies),
      expectedCommands: expected.documentedCommands,
      sourceCommands: expected.sourceCommands,
      installedPackageVersion:
        parsed.packageVersion === undefined
          ? readCurrentPackageVersion()
          : parsed.packageVersion,
      expectedSource: expected.sourceDescription,
    });
    printDiagnosticsCliVersionSkewResult(
      diagnostic,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return diagnostic.status === "ok" ? 0 : 1;
  }

  throw new Error("diagnostics requires cli-version-skew");
}

function parseDiagnosticsCliVersionSkewCommand(
  argv: string[],
): ParsedDiagnosticsCliVersionSkewCommand {
  const parsed: ParsedDiagnosticsCliVersionSkewCommand = {
    expectedFiles: [],
    sourceCommandFiles: [],
    expectedCommands: [],
  };
  const rest = argv.slice(2);
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--installed-help-file":
        parsed.installedHelpFile = next();
        break;
      case "--installed-command":
        parsed.installedCommand = next();
        break;
      case "--expected-file":
        parsed.expectedFiles.push(next());
        break;
      case "--source-command-file":
        parsed.sourceCommandFiles.push(next());
        break;
      case "--expected-command":
        parsed.expectedCommands.push(next());
        break;
      case "--package-version":
        parsed.packageVersion = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown diagnostics cli-version-skew option: ${arg}`);
    }
  }

  if (
    parsed.expectedFiles.length === 0 &&
    parsed.expectedCommands.length === 0 &&
    parsed.sourceCommandFiles.length === 0
  ) {
    parsed.expectedFiles = defaultCliVersionSkewExpectedFiles();
    parsed.sourceCommandFiles = defaultCliVersionSkewSourceCommandFiles();
  }

  return parsed;
}

function resolveDiagnosticsInstalledHelpText(
  parsed: ParsedDiagnosticsCliVersionSkewCommand,
  dependencies: DiagnosticsCliDependencies,
): string {
  if (parsed.installedHelpFile) {
    return fs.readFileSync(parsed.installedHelpFile, "utf8");
  }
  if (parsed.installedCommand) {
    const commandRunner =
      dependencies.commandRunner ?? defaultNexusAutomationCommandRunner;
    const result = commandRunner(`${shellQuoteArgument(parsed.installedCommand)} --help`, {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10000,
    });
    return [result.stdout, result.stderr].filter((text) => text.length > 0)
      .join("\n");
  }
  return dependencies.usage();
}

function printDiagnosticsCliVersionSkewResult(
  diagnostic: NexusCliVersionSkewDiagnostic,
  parsed: ParsedDiagnosticsCliVersionSkewCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: diagnostic.status === "ok", diagnostic };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus CLI version skew: ${diagnostic.status}.`);
  writeLine(stdout, `  Verdict: ${diagnostic.verdict}`);
  writeLine(
    stdout,
    `  Installed package version: ${diagnostic.installedPackageVersion ?? "unknown"}`,
  );
  writeLine(
    stdout,
    `  Expected command source: ${diagnostic.expectedSource ?? "unknown"}`,
  );
  if (diagnostic.missingDocumentedCommands.length > 0) {
    writeLine(stdout, "  Missing documented commands:");
    for (const command of diagnostic.missingDocumentedCommands) {
      writeLine(stdout, `    ${command}`);
    }
  } else {
    writeLine(stdout, "  Missing documented commands: none");
  }
  if (diagnostic.missingSourceCommands.length > 0) {
    writeLine(stdout, "  Missing source-declared commands:");
    for (const command of diagnostic.missingSourceCommands) {
      writeLine(stdout, `    ${command}`);
    }
  } else {
    writeLine(stdout, "  Missing source-declared commands: none");
  }
  writeLine(stdout, `  Remediation: ${diagnostic.remediation.summary}`);
}

function resolveExpectedCliVersionSkewCommands(
  parsed: ParsedDiagnosticsCliVersionSkewCommand,
): {
  documentedCommands: string[];
  sourceCommands: string[];
  sourceDescription: string | null;
} {
  const documentedCommands = [
    ...parsed.expectedCommands,
    ...parsed.expectedFiles.flatMap((filePath) =>
      parseDevNexusCommandLines(fs.readFileSync(filePath, "utf8")),
    ),
  ];
  const sourceCommands = parsed.sourceCommandFiles.flatMap((filePath) =>
    parseDevNexusCommandLines(fs.readFileSync(filePath, "utf8")),
  );
  const sources = [
    ...(parsed.expectedCommands.length > 0 ? ["explicit expected commands"] : []),
    ...parsed.expectedFiles,
    ...parsed.sourceCommandFiles,
  ];
  return {
    documentedCommands,
    sourceCommands,
    sourceDescription: sources.length > 0 ? sources.join(", ") : null,
  };
}

function defaultCliVersionSkewExpectedFiles(): string[] {
  const root = packageRootPath();
  return [
    path.join(root, "README.md"),
    path.join(root, "docs", "user", "getting-started.md"),
  ].filter((filePath) => fs.existsSync(filePath));
}

function defaultCliVersionSkewSourceCommandFiles(): string[] {
  const root = packageRootPath();
  return [path.join(root, "src", "cli", "cliUsage.ts")].filter((filePath) =>
    fs.existsSync(filePath),
  );
}
