import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { shellQuoteArgument } from "../automation/nexusAutomationAgentProfile.js";
import {
  buildNexusCliVersionSkewDiagnostic,
  type NexusCliVersionSkewDiagnostic,
} from "../cli/nexusCliVersionSkewDiagnostic.js";
import {
  normalizeNexusPathPlatform,
  type NexusPathHostPlatform,
  type NexusPathStyle,
} from "../runtime/nexusPathResolver.js";

export type NexusAgentClientRuntimeMode =
  | "source_current"
  | "project_local"
  | "plugin_local"
  | "path"
  | "manual_global";

export type NexusAgentClientRuntimeCandidateStatus =
  | "available"
  | "missing"
  | "blocked"
  | "warning";

export type NexusAgentClientRuntimeResolutionStatus =
  | "ready"
  | "blocked"
  | "warning";

export type NexusAgentClientRuntimeSetupActionKind =
  | "install_node"
  | "install_dev_nexus"
  | "repair_project_local_runtime"
  | "repair_plugin_local_runtime";

export type NexusAgentClientRuntimeSetupMutationClass =
  | "host_local"
  | "project_local"
  | "plugin_local";

export interface NexusAgentClientRuntimeCommandRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface NexusAgentClientRuntimeCommandRunResult {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export type NexusAgentClientRuntimeCommandRunner = (
  command: string,
  args: string[],
  options: NexusAgentClientRuntimeCommandRunOptions,
) => NexusAgentClientRuntimeCommandRunResult;

export type NexusAgentClientRuntimeCommandLocator = (
  command: string,
  options: {
    env: NodeJS.ProcessEnv;
    platform: NexusPathStyle;
    fileExists: (filePath: string) => boolean;
  },
) => string | null;

export interface NexusAgentClientRuntimeToolStatus {
  available: boolean;
  command: string;
  version: string | null;
  satisfiesRequirement: boolean | null;
  requirement: string | null;
  summary: string;
}

export interface NexusAgentClientRuntimeCandidate {
  mode: NexusAgentClientRuntimeMode;
  status: NexusAgentClientRuntimeCandidateStatus;
  command: string;
  args: string[];
  commandLine: string;
  packageRoot: string | null;
  packageVersion: string | null;
  reason: string;
  diagnostics: string[];
  skew: NexusCliVersionSkewDiagnostic | null;
}

export interface NexusAgentClientRuntimeSetupAction {
  kind: NexusAgentClientRuntimeSetupActionKind;
  mutationClass: NexusAgentClientRuntimeSetupMutationClass;
  requiresApproval: true;
  summary: string;
  commands: string[];
}

export interface NexusAgentClientRuntimeSetupPlan {
  advisory: true;
  actions: NexusAgentClientRuntimeSetupAction[];
}

export interface NexusAgentClientRuntimeResolution {
  status: NexusAgentClientRuntimeResolutionStatus;
  projectRoot: string;
  platform: NexusPathStyle;
  selected: NexusAgentClientRuntimeCandidate | null;
  candidates: NexusAgentClientRuntimeCandidate[];
  node: NexusAgentClientRuntimeToolStatus;
  npm: NexusAgentClientRuntimeToolStatus;
  setupPlan: NexusAgentClientRuntimeSetupPlan;
  diagnostics: string[];
}

export interface ResolveNexusAgentClientRuntimeOptions {
  projectRoot: string;
  platform?: NexusPathHostPlatform | NexusPathStyle;
  env?: NodeJS.ProcessEnv;
  sourceRoot?: string | null;
  sourceCliPath?: string | null;
  projectLocalRuntimeRoot?: string | null;
  pluginLocalRuntimeRoot?: string | null;
  pluginDataRoot?: string | null;
  manualGlobalCommand?: string | null;
  expectedCommands?: readonly string[];
  preferredMode?: NexusAgentClientRuntimeMode | null;
  commandRunner?: NexusAgentClientRuntimeCommandRunner;
  commandLocator?: NexusAgentClientRuntimeCommandLocator;
  fileExists?: (filePath: string) => boolean;
  timeoutMs?: number;
}

export function resolveNexusAgentClientRuntime(
  options: ResolveNexusAgentClientRuntimeOptions,
): NexusAgentClientRuntimeResolution {
  const platform = normalizeNexusPathPlatform(options.platform);
  const pathApi = pathApiForPlatform(platform);
  const projectRoot = normalizeRoot(options.projectRoot, platform);
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? fs.existsSync;
  const commandRunner =
    options.commandRunner ?? defaultNexusAgentClientRuntimeCommandRunner;
  const commandLocator =
    options.commandLocator ?? defaultNexusAgentClientRuntimeCommandLocator;
  const commandOptions = {
    cwd: projectRoot,
    env,
    timeoutMs: options.timeoutMs,
  };
  const node = inspectRuntimeTool({
    command: "node",
    args: ["--version"],
    requirement: packageNodeRequirement(options.sourceRoot, fileExists) ?? ">=22",
    commandRunner,
    commandOptions,
  });
  const npm = inspectRuntimeTool({
    command: "npm",
    args: ["--version"],
    requirement: null,
    commandRunner,
    commandOptions,
  });
  const candidates = [
    sourceCurrentCandidate({
      options,
      platform,
      pathApi,
      fileExists,
      node,
    }),
    projectLocalCandidate({
      runtimeRoot:
        options.projectLocalRuntimeRoot ??
        pathApi.join(projectRoot, ".dev-nexus", "runtime", "npm-tools"),
      platform,
      fileExists,
      node,
    }),
    pluginLocalCandidate({
      options,
      platform,
      pathApi,
      fileExists,
      node,
      env,
    }),
    pathCandidate({
      projectRoot,
      platform,
      env,
      fileExists,
      commandLocator,
      commandRunner,
      expectedCommands: options.expectedCommands ?? [],
      commandOptions,
    }),
    manualGlobalCandidate({
      command: options.manualGlobalCommand,
      projectRoot,
      platform,
      env,
      fileExists,
      commandLocator,
      commandRunner,
      expectedCommands: options.expectedCommands ?? [],
      commandOptions,
    }),
  ];
  const selected = selectCandidate(candidates, options.preferredMode ?? null);
  const setupPlan = buildSetupPlan({
    node,
    npm,
    candidates,
    selected,
  });
  const diagnostics = [
    ...candidates.flatMap((candidate) =>
      candidate.diagnostics.map((diagnostic) => `${candidate.mode}: ${diagnostic}`),
    ),
    ...setupPlan.actions.map((action) => action.summary),
  ];
  const status: NexusAgentClientRuntimeResolutionStatus = selected
    ? selected.status === "warning"
      ? "warning"
      : "ready"
    : "blocked";

  return {
    status,
    projectRoot,
    platform,
    selected,
    candidates,
    node,
    npm,
    setupPlan,
    diagnostics,
  };
}

export function formatNexusAgentClientRuntimeCommand(options: {
  command: string;
  args?: readonly string[];
  platform?: NexusPathHostPlatform | NexusPathStyle;
}): string {
  const platform = normalizeNexusPathPlatform(options.platform);
  const tokens = [options.command, ...(options.args ?? [])];
  if (platform === "windows") {
    return tokens.map(windowsQuoteArgument).join(" ");
  }
  return tokens.map(shellQuoteArgument).join(" ");
}

export function defaultNexusAgentClientRuntimeCommandRunner(
  command: string,
  args: string[],
  options: NexusAgentClientRuntimeCommandRunOptions,
): NexusAgentClientRuntimeCommandRunResult {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    encoding: "utf8",
    timeout: options.timeoutMs,
    windowsHide: true,
  });

  return {
    command,
    args: [...args],
    cwd: options.cwd,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
    ...(result.error ? { error: result.error.message } : {}),
  };
}

export function defaultNexusAgentClientRuntimeCommandLocator(
  command: string,
  options: Parameters<NexusAgentClientRuntimeCommandLocator>[1],
): string | null {
  const pathApi = pathApiForPlatform(options.platform);
  if (command.includes("/") || command.includes("\\")) {
    const normalized = pathApi.normalize(command);
    return options.fileExists(normalized) ? normalized : null;
  }

  const pathValue = options.env.PATH ?? options.env.Path ?? "";
  const delimiter = options.platform === "windows" ? ";" : ":";
  const extensions =
    options.platform === "windows" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${command}${extension}`);
      if (options.fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function sourceCurrentCandidate(options: {
  options: ResolveNexusAgentClientRuntimeOptions;
  platform: NexusPathStyle;
  pathApi: typeof path.posix;
  fileExists: (filePath: string) => boolean;
  node: NexusAgentClientRuntimeToolStatus;
}): NexusAgentClientRuntimeCandidate {
  const sourceRoot =
    optionalString(options.options.sourceRoot) ??
    (optionalString(options.options.sourceCliPath)
      ? options.pathApi.dirname(options.pathApi.dirname(options.options.sourceCliPath!))
      : null);
  const sourceCliPath =
    optionalString(options.options.sourceCliPath) ??
    (sourceRoot ? options.pathApi.join(sourceRoot, "dist", "cli.js") : null);
  if (!sourceRoot || !sourceCliPath) {
    return missingCandidate({
      mode: "source_current",
      reason: "No source-current runtime was configured.",
      platform: options.platform,
    });
  }

  if (!options.fileExists(sourceCliPath)) {
    return missingCandidate({
      mode: "source_current",
      command: "node",
      args: [sourceCliPath],
      packageRoot: sourceRoot,
      packageVersion: readPackageVersion(sourceRoot, options.fileExists),
      reason: `Source-current CLI script is missing: ${sourceCliPath}`,
      platform: options.platform,
    });
  }

  const nodeUsable =
    options.node.available && options.node.satisfiesRequirement !== false;
  const status: NexusAgentClientRuntimeCandidateStatus = nodeUsable
    ? "available"
    : "blocked";
  return candidate({
    mode: "source_current",
    status,
    command: "node",
    args: [sourceCliPath],
    packageRoot: sourceRoot,
    packageVersion: readPackageVersion(sourceRoot, options.fileExists),
    reason:
      status === "available"
        ? "Using configured source-current DevNexus CLI script."
        : "Source-current runtime needs Node.js before it can run.",
    diagnostics:
      status === "available" ? [] : [options.node.summary],
    platform: options.platform,
  });
}

function projectLocalCandidate(options: {
  runtimeRoot: string;
  platform: NexusPathStyle;
  fileExists: (filePath: string) => boolean;
  node: NexusAgentClientRuntimeToolStatus;
}): NexusAgentClientRuntimeCandidate {
  const bin = runtimeBinPath(options.runtimeRoot, options.platform);
  if (!options.fileExists(bin)) {
    return missingCandidate({
      mode: "project_local",
      command: bin,
      packageRoot: options.runtimeRoot,
      packageVersion: readRuntimePackageVersion(options.runtimeRoot, options.fileExists),
      reason: `Project-local DevNexus runtime is not installed: ${bin}`,
      platform: options.platform,
    });
  }

  const nodeUsable =
    options.node.available && options.node.satisfiesRequirement !== false;
  return candidate({
    mode: "project_local",
    status: nodeUsable ? "available" : "blocked",
    command: bin,
    args: [],
    packageRoot: options.runtimeRoot,
    packageVersion: readRuntimePackageVersion(options.runtimeRoot, options.fileExists),
    reason: nodeUsable
      ? "Using project-local DevNexus runtime."
      : "Project-local runtime needs Node.js before it can run.",
    diagnostics: nodeUsable ? [] : [options.node.summary],
    platform: options.platform,
  });
}

function pluginLocalCandidate(options: {
  options: ResolveNexusAgentClientRuntimeOptions;
  platform: NexusPathStyle;
  pathApi: typeof path.posix;
  fileExists: (filePath: string) => boolean;
  node: NexusAgentClientRuntimeToolStatus;
  env: NodeJS.ProcessEnv;
}): NexusAgentClientRuntimeCandidate {
  const runtimeRoot =
    optionalString(options.options.pluginLocalRuntimeRoot) ??
    pluginRuntimeRootFromDataRoot({
      pluginDataRoot:
        optionalString(options.options.pluginDataRoot) ??
        optionalString(options.env.CLAUDE_PLUGIN_DATA),
      pathApi: options.pathApi,
    });
  if (!runtimeRoot) {
    return missingCandidate({
      mode: "plugin_local",
      reason: "No plugin-local runtime data root was configured.",
      platform: options.platform,
    });
  }

  const bin = runtimeBinPath(runtimeRoot, options.platform);
  if (!options.fileExists(bin)) {
    return missingCandidate({
      mode: "plugin_local",
      command: bin,
      packageRoot: runtimeRoot,
      packageVersion: readRuntimePackageVersion(runtimeRoot, options.fileExists),
      reason: `Plugin-local DevNexus runtime is not installed: ${bin}`,
      platform: options.platform,
    });
  }

  const nodeUsable =
    options.node.available && options.node.satisfiesRequirement !== false;
  return candidate({
    mode: "plugin_local",
    status: nodeUsable ? "available" : "blocked",
    command: bin,
    args: [],
    packageRoot: runtimeRoot,
    packageVersion: readRuntimePackageVersion(runtimeRoot, options.fileExists),
    reason: nodeUsable
      ? "Using plugin-local DevNexus runtime."
      : "Plugin-local runtime needs Node.js before it can run.",
    diagnostics: nodeUsable ? [] : [options.node.summary],
    platform: options.platform,
  });
}

function pathCandidate(options: {
  projectRoot: string;
  platform: NexusPathStyle;
  env: NodeJS.ProcessEnv;
  fileExists: (filePath: string) => boolean;
  commandLocator: NexusAgentClientRuntimeCommandLocator;
  commandRunner: NexusAgentClientRuntimeCommandRunner;
  expectedCommands: readonly string[];
  commandOptions: NexusAgentClientRuntimeCommandRunOptions;
}): NexusAgentClientRuntimeCandidate {
  const command = options.commandLocator("dev-nexus", options);
  if (!command) {
    return missingCandidate({
      mode: "path",
      command: "dev-nexus",
      reason: "No dev-nexus command was found on PATH.",
      platform: options.platform,
    });
  }

  return commandCandidateWithSkew({
    mode: "path",
    command,
    args: [],
    reason: "Using dev-nexus command found on PATH.",
    platform: options.platform,
    commandRunner: options.commandRunner,
    commandOptions: options.commandOptions,
    expectedCommands: options.expectedCommands,
  });
}

function manualGlobalCandidate(options: {
  command: string | null | undefined;
  projectRoot: string;
  platform: NexusPathStyle;
  env: NodeJS.ProcessEnv;
  fileExists: (filePath: string) => boolean;
  commandLocator: NexusAgentClientRuntimeCommandLocator;
  commandRunner: NexusAgentClientRuntimeCommandRunner;
  expectedCommands: readonly string[];
  commandOptions: NexusAgentClientRuntimeCommandRunOptions;
}): NexusAgentClientRuntimeCandidate {
  const configured = optionalString(options.command);
  if (!configured) {
    return missingCandidate({
      mode: "manual_global",
      command: "dev-nexus",
      reason: "Manual global runtime was not explicitly configured.",
      platform: options.platform,
    });
  }

  const command = options.commandLocator(configured, options) ?? configured;
  return commandCandidateWithSkew({
    mode: "manual_global",
    command,
    args: [],
    reason: "Using explicitly configured manual global DevNexus runtime.",
    platform: options.platform,
    commandRunner: options.commandRunner,
    commandOptions: options.commandOptions,
    expectedCommands: options.expectedCommands,
  });
}

function commandCandidateWithSkew(options: {
  mode: NexusAgentClientRuntimeMode;
  command: string;
  args: string[];
  reason: string;
  platform: NexusPathStyle;
  commandRunner: NexusAgentClientRuntimeCommandRunner;
  commandOptions: NexusAgentClientRuntimeCommandRunOptions;
  expectedCommands: readonly string[];
}): NexusAgentClientRuntimeCandidate {
  const help = options.commandRunner(options.command, ["--help"], options.commandOptions);
  const helpText = [help.stdout, help.stderr].filter((text) => text.length > 0)
    .join("\n");
  const skew =
    options.expectedCommands.length > 0
      ? buildNexusCliVersionSkewDiagnostic({
          installedHelpText: helpText,
          expectedCommands: options.expectedCommands,
        })
      : null;
  const commandFailed = help.exitCode !== 0 || Boolean(help.error);
  const skewDetected = skew?.status === "skew_detected";
  const status: NexusAgentClientRuntimeCandidateStatus = commandFailed
    ? "blocked"
    : skewDetected
      ? "warning"
      : "available";
  const diagnostics = [
    ...(commandFailed
      ? [`Runtime command failed: ${help.error ?? help.stderr ?? "unknown error"}`]
      : []),
    ...(skewDetected
      ? [
          `Installed CLI help is missing commands: ${skew.missingDocumentedCommands.join(", ")}`,
        ]
      : []),
  ];

  return candidate({
    mode: options.mode,
    status,
    command: options.command,
    args: options.args,
    packageRoot: null,
    packageVersion: null,
    reason: options.reason,
    diagnostics,
    skew,
    platform: options.platform,
  });
}

function inspectRuntimeTool(options: {
  command: string;
  args: string[];
  requirement: string | null;
  commandRunner: NexusAgentClientRuntimeCommandRunner;
  commandOptions: NexusAgentClientRuntimeCommandRunOptions;
}): NexusAgentClientRuntimeToolStatus {
  const result = options.commandRunner(
    options.command,
    options.args,
    options.commandOptions,
  );
  const output = firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr);
  const available = result.exitCode === 0 && !result.error && Boolean(output);
  const satisfiesRequirement =
    available && options.requirement
      ? versionSatisfiesSimpleRequirement(output!, options.requirement)
      : available
        ? null
        : false;
  return {
    available,
    command: options.command,
    version: available ? output! : null,
    satisfiesRequirement,
    requirement: options.requirement,
    summary: available
      ? runtimeToolSummary({
          command: options.command,
          output: output!,
          requirement: options.requirement,
          satisfiesRequirement,
        })
      : `${options.command} is not available.`,
  };
}

function runtimeToolSummary(options: {
  command: string;
  output: string;
  requirement: string | null;
  satisfiesRequirement: boolean | null;
}): string {
  if (!options.requirement) {
    return `${options.command} ${options.output}`;
  }
  const status = options.satisfiesRequirement
    ? "satisfies"
    : "does not satisfy";
  return `${options.command} ${options.output} (${status} ${options.requirement})`;
}

function selectCandidate(
  candidates: readonly NexusAgentClientRuntimeCandidate[],
  preferredMode: NexusAgentClientRuntimeMode | null,
): NexusAgentClientRuntimeCandidate | null {
  const selectable = (candidate: NexusAgentClientRuntimeCandidate) =>
    candidate.status === "available";
  if (preferredMode) {
    const preferred = candidates.find(
      (candidate) => candidate.mode === preferredMode && selectable(candidate),
    );
    if (preferred) {
      return preferred;
    }
  }
  return candidates.find(selectable) ?? null;
}

function buildSetupPlan(options: {
  node: NexusAgentClientRuntimeToolStatus;
  npm: NexusAgentClientRuntimeToolStatus;
  candidates: readonly NexusAgentClientRuntimeCandidate[];
  selected: NexusAgentClientRuntimeCandidate | null;
}): NexusAgentClientRuntimeSetupPlan {
  const actions: NexusAgentClientRuntimeSetupAction[] = [];
  if (!options.node.available || options.node.satisfiesRequirement === false) {
    actions.push({
      kind: "install_node",
      mutationClass: "host_local",
      requiresApproval: true,
      summary:
        "Install or upgrade Node.js before using DevNexus agent-client adapters.",
      commands: ["node --version"],
    });
  }

  if (
    !options.selected &&
    options.candidates.every((candidate) => candidate.status !== "available")
  ) {
    actions.push({
      kind: "install_dev_nexus",
      mutationClass: "host_local",
      requiresApproval: true,
      summary:
        "Install DevNexus explicitly before using an agent-client plugin runtime.",
      commands: ["npm install -g @evref-bl/dev-nexus"],
    });
  }

  return { advisory: true, actions };
}

function candidate(options: {
  mode: NexusAgentClientRuntimeMode;
  status: NexusAgentClientRuntimeCandidateStatus;
  command: string;
  args: readonly string[];
  packageRoot: string | null;
  packageVersion: string | null;
  reason: string;
  diagnostics?: readonly string[];
  skew?: NexusCliVersionSkewDiagnostic | null;
  platform: NexusPathStyle;
}): NexusAgentClientRuntimeCandidate {
  return {
    mode: options.mode,
    status: options.status,
    command: options.command,
    args: [...options.args],
    commandLine: formatNexusAgentClientRuntimeCommand({
      command: options.command,
      args: options.args,
      platform: options.platform,
    }),
    packageRoot: options.packageRoot,
    packageVersion: options.packageVersion,
    reason: options.reason,
    diagnostics: [...(options.diagnostics ?? [])],
    skew: options.skew ?? null,
  };
}

function missingCandidate(options: {
  mode: NexusAgentClientRuntimeMode;
  command?: string;
  args?: readonly string[];
  packageRoot?: string | null;
  packageVersion?: string | null;
  reason: string;
  platform?: NexusPathStyle;
}): NexusAgentClientRuntimeCandidate {
  return {
    mode: options.mode,
    status: "missing",
    command: options.command ?? "",
    args: [...(options.args ?? [])],
    commandLine: options.command
      ? formatNexusAgentClientRuntimeCommand({
          command: options.command,
          args: options.args ?? [],
          platform: options.platform,
        })
      : "",
    packageRoot: options.packageRoot ?? null,
    packageVersion: options.packageVersion ?? null,
    reason: options.reason,
    diagnostics: [options.reason],
    skew: null,
  };
}

function runtimeBinPath(runtimeRoot: string, platform: NexusPathStyle): string {
  const pathApi = pathApiForPlatform(platform);
  return pathApi.join(
    normalizeRoot(runtimeRoot, platform),
    "node_modules",
    ".bin",
    platform === "windows" ? "dev-nexus.cmd" : "dev-nexus",
  );
}

function pluginRuntimeRootFromDataRoot(options: {
  pluginDataRoot: string | null;
  pathApi: typeof path.posix;
}): string | null {
  return options.pluginDataRoot
    ? options.pathApi.join(options.pluginDataRoot, "runtime", "npm-tools")
    : null;
}

function packageNodeRequirement(
  packageRoot: string | null | undefined,
  fileExists: (filePath: string) => boolean,
): string | null {
  return readPackageJson(packageRoot, fileExists)?.engines?.node ?? null;
}

function readPackageVersion(
  packageRoot: string | null,
  fileExists: (filePath: string) => boolean,
): string | null {
  return readPackageJson(packageRoot, fileExists)?.version ?? null;
}

function readRuntimePackageVersion(
  runtimeRoot: string,
  fileExists: (filePath: string) => boolean,
): string | null {
  const pathApi = runtimeRoot.includes("\\") ? path.win32 : path;
  for (const packageRoot of [
    pathApi.join(runtimeRoot, "node_modules", "@evref-bl", "dev-nexus"),
    pathApi.join(runtimeRoot, "node_modules", "dev-nexus"),
  ]) {
    const version = readPackageVersion(packageRoot, fileExists);
    if (version) {
      return version;
    }
  }
  return null;
}

function readPackageJson(
  packageRoot: string | null | undefined,
  fileExists: (filePath: string) => boolean,
): { version?: string; engines?: { node?: string } } | null {
  if (!packageRoot) {
    return null;
  }
  const pathApi = packageRoot.includes("\\") ? path.win32 : path;
  const packageJsonPath = pathApi.join(packageRoot, "package.json");
  if (!fileExists(packageJsonPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const engines = record.engines;
    return {
      ...(typeof record.version === "string" ? { version: record.version } : {}),
      ...(engines && typeof engines === "object" && !Array.isArray(engines)
        ? {
            engines: {
              ...(typeof (engines as Record<string, unknown>).node === "string"
                ? { node: (engines as Record<string, string>).node }
                : {}),
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function versionSatisfiesSimpleRequirement(
  versionText: string,
  requirement: string,
): boolean {
  const minimum = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(requirement);
  if (!minimum) {
    return true;
  }
  const version = /v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(versionText);
  if (!version) {
    return false;
  }
  const actual = [
    Number(version[1] ?? 0),
    Number(version[2] ?? 0),
    Number(version[3] ?? 0),
  ];
  const required = [
    Number(minimum[1] ?? 0),
    Number(minimum[2] ?? 0),
    Number(minimum[3] ?? 0),
  ];
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index]! > required[index]!) {
      return true;
    }
    if (actual[index]! < required[index]!) {
      return false;
    }
  }
  return true;
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
}

function optionalString(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function normalizeRoot(value: string, platform: NexusPathStyle): string {
  return pathApiForPlatform(platform).normalize(value);
}

function pathApiForPlatform(platform: NexusPathStyle): typeof path.posix {
  return platform === "windows" ? path.win32 : path.posix;
}

function windowsQuoteArgument(value: string): string {
  return `"${value.replace(/"/gu, '\\"')}"`;
}
