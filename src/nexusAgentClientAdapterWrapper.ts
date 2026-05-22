import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  defaultNexusAgentClientRuntimeCommandRunner,
  formatNexusAgentClientRuntimeCommand,
  resolveNexusAgentClientRuntime,
  type NexusAgentClientRuntimeCommandRunner,
  type NexusAgentClientRuntimeCommandRunResult,
  type NexusAgentClientRuntimeResolution,
  type ResolveNexusAgentClientRuntimeOptions,
} from "./nexusAgentClientRuntimeResolver.js";
import {
  normalizeNexusPathPlatform,
  type NexusPathHostPlatform,
  type NexusPathStyle,
} from "./nexusPathResolver.js";

export type NexusAgentClientAdapterEntrypoint =
  | "mcp-stdio"
  | "setup"
  | "status"
  | "doctor";

export type NexusAgentClientAdapterPlanStatus =
  | "ready"
  | "blocked"
  | "warning";

export type NexusAgentClientAdapterRunStatus =
  | "completed"
  | "failed"
  | "blocked";

export type NexusAgentClientAdapterProjectRootSource =
  | "explicit"
  | "environment"
  | "mcp_roots"
  | "start_directory"
  | "process_cwd"
  | "fallback";

export type NexusAgentClientAdapterMutationClass =
  | "none"
  | "live_runtime";

export interface NexusAgentClientProjectRootDiscovery {
  projectRoot: string;
  source: NexusAgentClientAdapterProjectRootSource;
  projectConfigFound: boolean;
  checkedRoots: string[];
  diagnostics: string[];
}

export interface DiscoverNexusAgentClientProjectRootOptions {
  projectRoot?: string | null;
  startDirectory?: string | null;
  mcpRoots?: readonly string[];
  env?: NodeJS.ProcessEnv;
  platform?: NexusPathHostPlatform | NexusPathStyle;
  fileExists?: (filePath: string) => boolean;
}

export interface NexusAgentClientAdapterInvocation {
  command: string;
  args: string[];
  commandLine: string;
  cwd: string;
  mutationClass: NexusAgentClientAdapterMutationClass;
}

export interface NexusAgentClientAdapterAdvisoryOperation {
  summary: string;
  command: string | null;
  requiresApproval: boolean;
}

export interface NexusAgentClientAdapterAdvisoryPlan {
  advisory: true;
  fileMutations: NexusAgentClientAdapterAdvisoryOperation[];
  packageOperations: NexusAgentClientAdapterAdvisoryOperation[];
  networkOperations: NexusAgentClientAdapterAdvisoryOperation[];
  providerOperations: NexusAgentClientAdapterAdvisoryOperation[];
  writesUnderPluginRoot: false;
}

export interface NexusAgentClientAdapterCommandPlan {
  status: NexusAgentClientAdapterPlanStatus;
  client: string;
  entrypoint: NexusAgentClientAdapterEntrypoint;
  projectRoot: string;
  projectDiscovery: NexusAgentClientProjectRootDiscovery;
  runtime: NexusAgentClientRuntimeResolution;
  invocation: NexusAgentClientAdapterInvocation | null;
  advisory: NexusAgentClientAdapterAdvisoryPlan;
  diagnostics: string[];
}

export interface NexusAgentClientAdapterRunResult {
  status: NexusAgentClientAdapterRunStatus;
  plan: NexusAgentClientAdapterCommandPlan;
  run: NexusAgentClientRuntimeCommandRunResult | null;
  diagnostics: string[];
}

export interface PlanNexusAgentClientAdapterCommandOptions
  extends Omit<ResolveNexusAgentClientRuntimeOptions, "projectRoot">,
    DiscoverNexusAgentClientProjectRootOptions {
  client: string;
  entrypoint: NexusAgentClientAdapterEntrypoint;
  extraArgs?: readonly string[];
  setupFlowId?: string;
  pluginRoot?: string | null;
}

export interface RunNexusAgentClientAdapterCommandOptions
  extends PlanNexusAgentClientAdapterCommandOptions {}

const defaultExpectedCommands = [
  "dev-nexus mcp-stdio",
  "dev-nexus workspace status <workspace-id-or-root>",
  "dev-nexus setup plan <workspace-root> <flow-id>",
  "dev-nexus setup check <workspace-root> <flow-id>",
] as const;

export function discoverNexusAgentClientProjectRoot(
  options: DiscoverNexusAgentClientProjectRootOptions = {},
): NexusAgentClientProjectRootDiscovery {
  const platform = normalizeNexusPathPlatform(options.platform);
  const pathApi = pathApiForPlatform(platform);
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? defaultFileExists;
  const candidates = discoveryCandidates({
    options,
    env,
  });
  const checkedRoots: string[] = [];

  for (const candidate of candidates) {
    const normalized = pathApi.normalize(candidate.root);
    const discovered = findProjectRoot({
      startDirectory: normalized,
      pathApi,
      fileExists,
      checkedRoots,
    });
    if (discovered) {
      return {
        projectRoot: discovered,
        source: candidate.source,
        projectConfigFound: true,
        checkedRoots: uniqueStrings(checkedRoots),
        diagnostics: [],
      };
    }
  }

  const fallback = pathApi.normalize(candidates[0]?.root ?? process.cwd());
  return {
    projectRoot: fallback,
    source: "fallback",
    projectConfigFound: false,
    checkedRoots: uniqueStrings(checkedRoots),
    diagnostics: [
      `No dev-nexus.project.json found from adapter project-root candidates.`,
    ],
  };
}

export function planNexusAgentClientAdapterCommand(
  options: PlanNexusAgentClientAdapterCommandOptions,
): NexusAgentClientAdapterCommandPlan {
  const client = requiredNonEmptyString(options.client, "client");
  const platform = normalizeNexusPathPlatform(options.platform);
  const env = options.env ?? process.env;
  const projectDiscovery = discoverNexusAgentClientProjectRoot({
    projectRoot: options.projectRoot,
    startDirectory: options.startDirectory,
    mcpRoots: options.mcpRoots,
    env,
    platform,
    fileExists: options.fileExists,
  });
  const runtime = resolveNexusAgentClientRuntime({
    ...runtimeOptions(options),
    projectRoot: projectDiscovery.projectRoot,
    platform,
    env,
    pluginDataRoot: options.pluginDataRoot,
    expectedCommands: options.expectedCommands ?? defaultExpectedCommands,
  });
  const invocation = runtime.selected
    ? adapterInvocation({
        entrypoint: options.entrypoint,
        runtime,
        projectRoot: projectDiscovery.projectRoot,
        platform,
        setupFlowId: options.setupFlowId,
        extraArgs: options.extraArgs ?? [],
      })
    : null;
  const advisory = adapterAdvisoryPlan(runtime);
  const status: NexusAgentClientAdapterPlanStatus = invocation
    ? runtime.status === "warning"
      ? "warning"
      : "ready"
    : "blocked";
  const diagnostics = [
    ...projectDiscovery.diagnostics,
    ...runtime.diagnostics,
    ...(invocation ? [] : ["No usable DevNexus runtime invocation is available."]),
  ];

  return {
    status,
    client,
    entrypoint: options.entrypoint,
    projectRoot: projectDiscovery.projectRoot,
    projectDiscovery,
    runtime,
    invocation,
    advisory,
    diagnostics,
  };
}

export function runNexusAgentClientAdapterCommand(
  options: RunNexusAgentClientAdapterCommandOptions,
): NexusAgentClientAdapterRunResult {
  const commandRunner =
    options.commandRunner ?? defaultNexusAgentClientRuntimeCommandRunner;
  const plan = planNexusAgentClientAdapterCommand({
    ...options,
    commandRunner,
  });
  if (!plan.invocation) {
    return {
      status: "blocked",
      plan,
      run: null,
      diagnostics: plan.diagnostics,
    };
  }

  const run = commandRunner(plan.invocation.command, plan.invocation.args, {
    cwd: plan.invocation.cwd,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs,
  });
  const status: NexusAgentClientAdapterRunStatus =
    run.exitCode === 0 && !run.error ? "completed" : "failed";

  return {
    status,
    plan,
    run,
    diagnostics:
      status === "completed"
        ? plan.diagnostics
        : [
            ...plan.diagnostics,
            `Adapter command failed: ${run.error ?? run.stderr ?? "unknown error"}`,
          ],
  };
}

function adapterInvocation(options: {
  entrypoint: NexusAgentClientAdapterEntrypoint;
  runtime: NexusAgentClientRuntimeResolution;
  projectRoot: string;
  platform: NexusPathStyle;
  setupFlowId?: string;
  extraArgs: readonly string[];
}): NexusAgentClientAdapterInvocation {
  const selected = options.runtime.selected;
  if (!selected) {
    throw new Error("adapter invocation requires a selected runtime");
  }
  const entrypointArgs = adapterEntrypointArgs({
    entrypoint: options.entrypoint,
    projectRoot: options.projectRoot,
    setupFlowId: options.setupFlowId,
  });
  const args = [...selected.args, ...entrypointArgs, ...options.extraArgs];
  const mutationClass: NexusAgentClientAdapterMutationClass =
    options.entrypoint === "mcp-stdio" ? "live_runtime" : "none";

  return {
    command: selected.command,
    args,
    commandLine: formatNexusAgentClientRuntimeCommand({
      command: selected.command,
      args,
      platform: options.platform,
    }),
    cwd: options.projectRoot,
    mutationClass,
  };
}

function adapterEntrypointArgs(options: {
  entrypoint: NexusAgentClientAdapterEntrypoint;
  projectRoot: string;
  setupFlowId?: string;
}): string[] {
  if (options.entrypoint === "mcp-stdio") {
    return ["mcp-stdio"];
  }
  if (options.entrypoint === "status") {
    return ["workspace", "status", options.projectRoot, "--json"];
  }
  if (options.entrypoint === "setup") {
    return [
      "setup",
      "check",
      options.projectRoot,
      options.setupFlowId ?? "join-existing-project",
      "--json",
    ];
  }
  return ["diagnostics", "cli-version-skew", "--json"];
}

function adapterAdvisoryPlan(
  runtime: NexusAgentClientRuntimeResolution,
): NexusAgentClientAdapterAdvisoryPlan {
  const packageOperations = runtime.setupPlan.actions
    .filter((action) => action.kind === "install_dev_nexus")
    .flatMap((action) =>
      action.commands.map((command) => ({
        summary: action.summary,
        command,
        requiresApproval: action.requiresApproval,
      })),
    );
  const networkOperations = packageOperations.length > 0
    ? [
        {
          summary: "Package installation may read from the npm registry.",
          command: null,
          requiresApproval: true,
        },
      ]
    : [];

  return {
    advisory: true,
    fileMutations: [],
    packageOperations,
    networkOperations,
    providerOperations: [],
    writesUnderPluginRoot: false,
  };
}

function runtimeOptions(
  options: PlanNexusAgentClientAdapterCommandOptions,
): Omit<ResolveNexusAgentClientRuntimeOptions, "projectRoot"> {
  return {
    env: options.env,
    sourceRoot: options.sourceRoot,
    sourceCliPath: options.sourceCliPath,
    projectLocalRuntimeRoot: options.projectLocalRuntimeRoot,
    pluginLocalRuntimeRoot: options.pluginLocalRuntimeRoot,
    pluginDataRoot: options.pluginDataRoot,
    manualGlobalCommand: options.manualGlobalCommand,
    preferredMode: options.preferredMode,
    commandRunner: options.commandRunner,
    commandLocator: options.commandLocator,
    fileExists: options.fileExists,
    timeoutMs: options.timeoutMs,
  };
}

function discoveryCandidates(options: {
  options: DiscoverNexusAgentClientProjectRootOptions;
  env: NodeJS.ProcessEnv;
}): Array<{
  root: string;
  source: NexusAgentClientAdapterProjectRootSource;
}> {
  const projectRoot = optionalString(options.options.projectRoot);
  if (projectRoot) {
    return [{ root: projectRoot, source: "explicit" }];
  }

  const candidates: Array<{
    root: string;
    source: NexusAgentClientAdapterProjectRootSource;
  }> = [];
  const envProjectRoot = optionalString(options.env.DEV_NEXUS_PROJECT_ROOT);
  if (envProjectRoot) {
    candidates.push({ root: envProjectRoot, source: "environment" });
  }
  for (const root of options.options.mcpRoots ?? []) {
    const normalized = optionalString(root);
    if (normalized) {
      candidates.push({ root: normalized, source: "mcp_roots" });
    }
  }
  const startDirectory = optionalString(options.options.startDirectory);
  if (startDirectory) {
    candidates.push({ root: startDirectory, source: "start_directory" });
  }
  candidates.push({ root: process.cwd(), source: "process_cwd" });
  return candidates;
}

function findProjectRoot(options: {
  startDirectory: string;
  pathApi: typeof path.posix;
  fileExists: (filePath: string) => boolean;
  checkedRoots: string[];
}): string | null {
  let current = options.pathApi.normalize(options.startDirectory);
  while (true) {
    options.checkedRoots.push(current);
    if (options.fileExists(options.pathApi.join(current, "dev-nexus.project.json"))) {
      return current;
    }

    const parent = options.pathApi.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function defaultFileExists(filePath: string): boolean {
  return path.isAbsolute(filePath)
    ? safeExists(filePath)
    : safeExists(path.resolve(filePath));
}

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function pathApiForPlatform(platform: NexusPathStyle): typeof path.posix {
  return platform === "windows" ? path.win32 : path.posix;
}

function optionalString(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function requiredNonEmptyString(value: string, name: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
