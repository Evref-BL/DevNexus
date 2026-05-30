import {
  getNexusConfigReferenceEntries,
  nexusConfigReferenceParserFieldNames,
  renderNexusConfigReferenceMarkdown,
  type NexusConfigReferenceSelector,
} from "../config-reference/nexusConfigReference.js";
import {
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";

interface ConfigReferenceCliDependencies {
  stdout?: TextWriter;
}

interface ParsedConfigReferenceCommand {
  scope: NexusConfigReferenceSelector;
  json?: boolean;
}

export async function handleConfigReferenceCommand(
  argv: string[],
  dependencies: ConfigReferenceCliDependencies,
): Promise<number> {
  if (argv[1] !== "reference") {
    throw new Error("config requires reference");
  }

  const parsed = parseConfigReferenceCommand(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      scope: parsed.scope,
      entries: getNexusConfigReferenceEntries(parsed.scope),
      parserFieldNames: nexusConfigReferenceParserFieldNames,
    });
    return 0;
  }

  writeLine(stdout, renderNexusConfigReferenceMarkdown(parsed.scope));
  return 0;
}

function parseConfigReferenceCommand(argv: string[]): ParsedConfigReferenceCommand {
  let scope: NexusConfigReferenceSelector = "all";
  let json = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--scope") {
      const value = argv[index + 1];
      if (!isNexusConfigReferenceSelector(value)) {
        throw new Error("--scope must be workspace, home, or all");
      }
      scope = value;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`unknown config reference option: ${arg}`);
  }

  return {
    scope,
    ...(json ? { json } : {}),
  };
}

function isNexusConfigReferenceSelector(
  value: string | undefined,
): value is NexusConfigReferenceSelector {
  return value === "workspace" || value === "home" || value === "all";
}
