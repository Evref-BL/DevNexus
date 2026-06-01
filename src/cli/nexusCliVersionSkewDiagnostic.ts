export type NexusCliVersionSkewStatus = "ok" | "skew_detected";

export type NexusCliVersionSkewRemediation =
  | "upgrade_npm_package"
  | "install_from_source"
  | "rebuild_from_source"
  | "follow_versioned_docs";

export interface NexusCliVersionSkewDiagnosticInput {
  installedHelpText: string;
  expectedCommands: readonly string[];
  sourceCommands?: readonly string[];
  installedPackageVersion?: string | null;
  expectedSource?: string | null;
}

export interface NexusCliVersionSkewDiagnostic {
  status: NexusCliVersionSkewStatus;
  verdict: string;
  installedPackageVersion: string | null;
  expectedSource: string | null;
  installedCommands: string[];
  expectedCommands: string[];
  sourceCommands: string[];
  missingDocumentedCommands: string[];
  missingSourceCommands: string[];
  remediation: {
    action: NexusCliVersionSkewRemediation;
    summary: string;
  };
}

export function buildNexusCliVersionSkewDiagnostic(
  input: NexusCliVersionSkewDiagnosticInput,
): NexusCliVersionSkewDiagnostic {
  const installedCommands = uniqueSorted(
    parseDevNexusCommandLines(input.installedHelpText).map(commandPrefix),
  );
  const expectedCommands = uniqueSorted(input.expectedCommands.map(commandPrefix));
  const sourceCommands = uniqueSorted(
    (input.sourceCommands ?? []).map(commandPrefix),
  );
  const missingDocumentedCommands = expectedCommands.filter(
    (expected) => !isCommandCoveredByInstalledHelp(expected, installedCommands),
  );
  const missingSourceCommands = sourceCommands.filter(
    (expected) => !isCommandCoveredByInstalledHelp(expected, installedCommands),
  );
  const status: NexusCliVersionSkewStatus =
    missingDocumentedCommands.length > 0 || missingSourceCommands.length > 0
      ? "skew_detected"
      : "ok";

  return {
    status,
    verdict:
      status === "ok"
        ? "Installed CLI help covers the expected command surface."
        : missingSourceCommands.length > 0
          ? "Installed CLI help is missing commands declared by the source checkout."
          : "Installed CLI help is missing documented commands.",
    installedPackageVersion: input.installedPackageVersion ?? null,
    expectedSource: input.expectedSource ?? null,
    installedCommands,
    expectedCommands,
    sourceCommands,
    missingDocumentedCommands,
    missingSourceCommands,
    remediation: remediationFor(
      status,
      input.installedPackageVersion,
      missingSourceCommands.length > 0,
    ),
  };
}

export function parseDevNexusCommandLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(extractDevNexusCommandLine)
    .filter((line): line is string => line !== null);
}

function commandPrefix(commandLine: string): string {
  const tokens = commandLine.trim().split(/\s+/);
  const prefix: string[] = [];
  for (const token of tokens) {
    if (
      prefix.length > 0 &&
      (token.startsWith("<") ||
        token.startsWith("[") ||
        token.startsWith("(") ||
        (token.startsWith("--") && token !== "--help"))
    ) {
      break;
    }
    prefix.push(token);
  }
  return prefix.join(" ");
}

function extractDevNexusCommandLine(line: string): string | null {
  const trimmed = line.trim();
  const direct = normalizeDevNexusCommandLine(trimmed);
  if (direct) {
    return direct;
  }

  const quoted = trimmed.match(/^(['"`])([\s\S]*)\1,?;?$/);
  if (!quoted) {
    return null;
  }
  return normalizeDevNexusCommandLine(quoted[2] ?? "");
}

function normalizeDevNexusCommandLine(value: string): string | null {
  const normalized = value.trim();
  if (normalized.includes("${")) {
    return null;
  }
  return normalized.startsWith("dev-nexus ") ? normalized : null;
}

function isCommandCoveredByInstalledHelp(
  expected: string,
  installedCommands: readonly string[],
): boolean {
  return installedCommands.some((installed) => {
    if (expected === installed) {
      return true;
    }
    return expected.startsWith(`${installed} `);
  });
}

function remediationFor(
  status: NexusCliVersionSkewStatus,
  installedPackageVersion?: string | null,
  sourceCommandSkew = false,
): { action: NexusCliVersionSkewRemediation; summary: string } {
  if (status === "ok") {
    return {
      action: "follow_versioned_docs",
      summary:
        "Continue with the docs that shipped with this CLI, or keep using the explicitly supplied expected command list.",
    };
  }

  if (sourceCommandSkew) {
    return {
      action: "rebuild_from_source",
      summary:
        "Rebuild the local DevNexus source checkout, reinstall or relink the CLI if it points at built output, then refresh workspace MCP config when generated MCP uses that CLI.",
    };
  }

  if (installedPackageVersion) {
    return {
      action: "upgrade_npm_package",
      summary:
        "Upgrade @evref-bl/dev-nexus from npm, or install from the source checkout that matches the documentation.",
    };
  }

  return {
    action: "install_from_source",
    summary:
      "Install DevNexus from the source checkout that contains these docs, or follow documentation versioned for the installed CLI.",
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}
