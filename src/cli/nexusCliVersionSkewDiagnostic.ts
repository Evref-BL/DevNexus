export type NexusCliVersionSkewStatus = "ok" | "skew_detected";

export type NexusCliVersionSkewRemediation =
  | "upgrade_npm_package"
  | "install_from_source"
  | "follow_versioned_docs";

export interface NexusCliVersionSkewDiagnosticInput {
  installedHelpText: string;
  expectedCommands: readonly string[];
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
  missingDocumentedCommands: string[];
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
  const missingDocumentedCommands = expectedCommands.filter(
    (expected) =>
      !installedCommands.some(
        (installed) => expected === installed || expected.startsWith(`${installed} `),
      ),
  );
  const status: NexusCliVersionSkewStatus =
    missingDocumentedCommands.length > 0 ? "skew_detected" : "ok";

  return {
    status,
    verdict:
      status === "ok"
        ? "Installed CLI help covers the expected documented command surface."
        : "Installed CLI help is missing documented commands.",
    installedPackageVersion: input.installedPackageVersion ?? null,
    expectedSource: input.expectedSource ?? null,
    installedCommands,
    expectedCommands,
    missingDocumentedCommands,
    remediation: remediationFor(status, input.installedPackageVersion),
  };
}

export function parseDevNexusCommandLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("dev-nexus "));
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

function remediationFor(
  status: NexusCliVersionSkewStatus,
  installedPackageVersion?: string | null,
): { action: NexusCliVersionSkewRemediation; summary: string } {
  if (status === "ok") {
    return {
      action: "follow_versioned_docs",
      summary:
        "Continue with the docs that shipped with this CLI, or keep using the explicitly supplied expected command list.",
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
