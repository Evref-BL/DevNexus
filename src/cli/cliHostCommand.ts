import fs from "node:fs";
import process from "node:process";
import type { NexusAutomationCommandRunner } from "../automation/nexusAutomationCommandExecutor.js";
import {
  checkNexusHostCapabilities,
  type NexusHostCheckMode,
  type NexusHostCheckMockFacts,
  type NexusHostCheckResult,
} from "../hosts/nexusHostCheck.js";
import { writeJson, writeLine, type TextWriter } from "./cliSupport.js";

interface HostCliDependencies {
  stdout?: TextWriter;
  commandRunner?: NexusAutomationCommandRunner;
  now?: () => Date | string;
}

interface ParsedHostCheckCommand {
  projectRoot: string;
  hostId?: string;
  mode: NexusHostCheckMode;
  mockFacts?: NexusHostCheckMockFacts;
  json?: boolean;
}

export async function handleHostCommand(
  argv: string[],
  dependencies: HostCliDependencies,
): Promise<number> {
  if (argv[1] === "check") {
    const parsed = parseHostCheckCommand(argv);
    const result = checkNexusHostCapabilities({
      projectRoot: parsed.projectRoot,
      hostId: parsed.hostId,
      mode: parsed.mode,
      mockFacts: parsed.mockFacts,
      commandRunner: dependencies.commandRunner,
      now: dependencies.now,
    });
    printHostCheckResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  throw new Error("host requires check");
}

function parseHostCheckCommand(argv: string[]): ParsedHostCheckCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("host check requires a workspace root");
  }

  const parsed: ParsedHostCheckCommand = {
    projectRoot,
    mode: "local",
  };
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
      case "--host":
        parsed.hostId = next();
        break;
      case "--mock-remote":
        parsed.mode = "mock-remote";
        break;
      case "--mock-facts":
        parsed.mode = "mock-remote";
        parsed.mockFacts = JSON.parse(
          fs.readFileSync(next(), "utf8").replace(/^\uFEFF/u, ""),
        ) as NexusHostCheckMockFacts;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown host check option: ${arg}`);
    }
  }

  return parsed;
}

function printHostCheckResult(
  result: NexusHostCheckResult,
  parsed: ParsedHostCheckCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus host check: ${result.status}.`);
  writeLine(stdout, `  Host: ${result.target.hostId} (${result.target.mode})`);
  writeLine(stdout, `  Platform: ${result.platform.tag}`);
  writeLine(stdout, `  Shell: ${result.shellKind}`);
  writeLine(
    stdout,
    `  Capabilities: ${result.configuredCapabilities.join(",") || "none"}`,
  );
  writeLine(
    stdout,
    `  MCP: ${result.mcp.status} ${result.mcp.serverNames.join(",") || "none"}`,
  );
  for (const check of result.commandChecks) {
    writeLine(stdout, `  ${check.id}: ${check.status}`);
  }
  for (const action of result.nextActions) {
    writeLine(stdout, `  Next: ${action}`);
  }
}
