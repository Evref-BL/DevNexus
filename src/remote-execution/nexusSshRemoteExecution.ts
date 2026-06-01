import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  parseNexusAutomationCommandExpression,
} from "../automation/nexusAutomationCommandExecutor.js";
import type {
  NexusHomeHostOverlayConfig,
  NexusHomeHostTransportConfig,
} from "../hosts/nexusHostRegistry.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  type NexusHomeConfigBase,
  type NexusHomeRemoteExecutionCommandProfileConfig,
  validateNexusHomeConfigBase,
} from "../project/nexusHomeConfig.js";
import { loadProjectConfig } from "../project/nexusProjectConfig.js";
import { resolveNexusProjectPath } from "../runtime/nexusPathResolver.js";
import {
  getNexusRemoteExecutionRecord,
  maxNexusRemoteExecutionOutputTailLength,
  recordNexusRemoteExecutionResult,
  type NexusRemoteExecutionResultRecord,
} from "./nexusRemoteExecution.js";
import {
  planNexusSshExecution,
  type NexusSshExecutionPlan,
  type NexusSshExecutionPlanShellKind,
} from "./nexusSshExecutionPlan.js";
import type { NexusRunnerProfileConfig } from "./nexusRunnerProfile.js";

const actualCommitMarker = "__DEV_NEXUS_ACTUAL_COMMIT__";

export interface NexusSshRemoteExecutionCommandProfile {
  id: string;
  command: string;
  argv: string[];
}

export interface NexusSshRemoteExecutionTransportSshTarget {
  host: string;
  user: string | null;
  port: number | null;
  shellKind: NexusSshExecutionPlanShellKind;
  workingDirectory: string;
}

export interface NexusSshRemoteExecutionTransportInput {
  projectRoot: string;
  requestId: string;
  hostId: string;
  runnerProfileId: string;
  commandProfile: NexusSshRemoteExecutionCommandProfile;
  repository: string;
  ref: string;
  timeoutMs: number;
  outputLineLimit: number | null;
  outputByteLimit: number | null;
  expectedCredentialIdentityRef: string | null;
  environment: Record<string, string>;
  ssh: NexusSshRemoteExecutionTransportSshTarget | null;
  plan: NexusSshExecutionPlan;
}

export interface NexusSshRemoteExecutionTransportResult {
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  timedOut?: boolean;
  error?: string | null;
  actualRef?: string | null;
  actualCommit?: string | null;
  credentialIdentityRef?: string | null;
  artifactRefs?: string[];
}

export type NexusSshRemoteExecutionTransport = (
  input: NexusSshRemoteExecutionTransportInput,
) =>
  | NexusSshRemoteExecutionTransportResult
  | Promise<NexusSshRemoteExecutionTransportResult>;

export interface RunNexusSshRemoteExecutionOptions {
  projectRoot: string;
  requestId: string;
  homePath?: string;
  homeConfig?: NexusHomeConfigBase | null;
  transport?: NexusSshRemoteExecutionTransport;
  now?: Date | string | (() => Date | string);
}

export interface RunNexusSshRemoteExecutionResult {
  ok: true;
  localOnly: true;
  plan: NexusSshExecutionPlan;
  result: NexusRemoteExecutionResultRecord;
}

export class NexusSshRemoteExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusSshRemoteExecutionError";
  }
}

export async function runNexusSshRemoteExecution(
  options: RunNexusSshRemoteExecutionOptions,
): Promise<RunNexusSshRemoteExecutionResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(
    options.projectRoot,
    "projectRoot",
  ));
  const requestId = requiredNonEmptyString(options.requestId, "requestId");
  const projectConfig = loadProjectConfig(projectRoot);
  const homeConfig = resolveHomeConfig({
    projectRoot,
    homePath: options.homePath,
    homeConfig: options.homeConfig,
  });
  const plan = planNexusSshExecution({
    projectRoot,
    requestId,
    homePath: options.homePath,
    homeConfig,
  });
  const { request } = getNexusRemoteExecutionRecord({ projectRoot, requestId });
  const runnerProfile = runnerProfileForRequest(projectConfig, request.runnerProfileId);

  if (plan.status !== "ready") {
    return blockedRun({
      projectRoot,
      requestId,
      plan,
      runnerProfile,
      command: null,
      reason: plan.blockers.join("; "),
      now: options.now,
    });
  }

  const operationBlocker = verificationOnlyBlocker(runnerProfile);
  if (operationBlocker) {
    return blockedRun({
      projectRoot,
      requestId,
      plan,
      runnerProfile,
      command: null,
      reason: operationBlocker,
      now: options.now,
    });
  }

  const commandProfileResolution = resolveCommandProfile(
    homeConfig,
    request.commandProfileId,
  );
  if ("error" in commandProfileResolution) {
    return blockedRun({
      projectRoot,
      requestId,
      plan,
      runnerProfile,
      command: null,
      reason: commandProfileResolution.error,
      now: options.now,
    });
  }
  const commandProfile = commandProfileResolution.commandProfile;
  const transportInput = buildTransportInput({
    projectRoot,
    plan,
    homeConfig,
    runnerProfile,
    commandProfile,
  });
  const transport = options.transport ?? defaultNexusSshRemoteExecutionTransport;
  const transportResult = await transport(transportInput);
  const blocker = transportEvidenceBlocker({
    runnerProfile,
    transportResult,
  });
  if (blocker) {
    return blockedRun({
      projectRoot,
      requestId,
      plan,
      runnerProfile,
      command: commandProfile.command,
      reason: blocker,
      outputTail: outputTail(transportResult, runnerProfile),
      now: options.now,
    });
  }

  const status = transportResult.timedOut
    ? "timed_out"
    : transportResult.exitCode === 0
      ? "completed"
      : "failed";
  const result = recordNexusRemoteExecutionResult({
    projectRoot,
    requestId,
    status,
    hostId: plan.target.hostId!,
    runnerProfileId: runnerProfile.id,
    actualRef: transportResult.actualRef ?? plan.ref,
    actualCommit: transportResult.actualCommit ?? null,
    commands: [commandProfile.command],
    exitCode: transportResult.timedOut
      ? null
      : (transportResult.exitCode ?? null),
    verificationOutcome: transportResult.timedOut
      ? "timed_out"
      : status === "completed"
        ? "passed"
        : "failed",
    outputTail: outputTail(transportResult, runnerProfile),
    artifactRefs: transportResult.artifactRefs ?? [],
    cleanupStatus: "completed",
    blockerSafetyReason: null,
    now: options.now,
  });

  return { ok: true, localOnly: true, plan, result };
}

export function defaultNexusSshRemoteExecutionTransport(
  input: NexusSshRemoteExecutionTransportInput,
): NexusSshRemoteExecutionTransportResult {
  if (!input.ssh) {
    return {
      exitCode: null,
      error: "SSH transport target is not configured.",
    };
  }
  if (input.ssh.shellKind !== "posix") {
    return {
      exitCode: null,
      error: `Default SSH execution currently supports posix shells, not ${input.ssh.shellKind}.`,
    };
  }

  const script = posixRemoteScript(input);
  const target = input.ssh.user
    ? `${input.ssh.user}@${input.ssh.host}`
    : input.ssh.host;
  const argv = [
    ...(input.ssh.port ? ["-p", String(input.ssh.port)] : []),
    target,
    "--",
    "sh",
    "-lc",
    script,
  ];
  const result = spawnSync("ssh", argv, {
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: input.timeoutMs,
    windowsHide: true,
    encoding: "utf8",
  });
  const stdout = String(result.stdout ?? "");
  const marker = extractActualCommit(stdout);

  return {
    exitCode: result.status ?? null,
    stdout: marker.stdout,
    stderr: String(result.stderr ?? ""),
    timedOut:
      result.error?.name === "TimeoutError" ||
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
      result.signal === "SIGTERM",
    error: result.error?.message ?? null,
    actualRef: marker.actualCommit ? input.ref : null,
    actualCommit: marker.actualCommit,
  };
}

function blockedRun(options: {
  projectRoot: string;
  requestId: string;
  plan: NexusSshExecutionPlan;
  runnerProfile: NexusRunnerProfileConfig;
  command: string | null;
  reason: string;
  outputTail?: string | null;
  now?: Date | string | (() => Date | string);
}): RunNexusSshRemoteExecutionResult {
  const result = recordNexusRemoteExecutionResult({
    projectRoot: options.projectRoot,
    requestId: options.requestId,
    status: "blocked",
    hostId: options.plan.target.hostId ?? "unresolved",
    runnerProfileId: options.runnerProfile.id,
    actualRef: null,
    actualCommit: null,
    commands: options.command ? [options.command] : [],
    exitCode: null,
    verificationOutcome: "blocked",
    outputTail: options.outputTail ?? null,
    artifactRefs: [],
    cleanupStatus: "not_required",
    blockerSafetyReason: options.reason,
    now: options.now,
  });
  return {
    ok: true,
    localOnly: true,
    plan: options.plan,
    result,
  };
}

function resolveHomeConfig(options: {
  projectRoot: string;
  homePath?: string;
  homeConfig?: NexusHomeConfigBase | null;
}): NexusHomeConfigBase | null {
  if (options.homeConfig !== undefined) {
    return options.homeConfig;
  }
  const projectConfig = loadProjectConfig(options.projectRoot);
  const homePath = options.homePath
    ? path.resolve(options.homePath)
    : projectConfig.home
      ? resolveNexusProjectPath({
          projectRoot: options.projectRoot,
          value: projectConfig.home,
        })
      : defaultNexusHomePath();
  try {
    return loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase);
  } catch {
    return null;
  }
}

function runnerProfileForRequest(
  projectConfig: ReturnType<typeof loadProjectConfig>,
  runnerProfileId: string,
): NexusRunnerProfileConfig {
  const profile = (projectConfig.runnerProfiles ?? []).find(
    (candidate) => candidate.id === runnerProfileId,
  );
  if (!profile) {
    throw new NexusSshRemoteExecutionError(
      `Runner profile is not configured: ${runnerProfileId}`,
    );
  }
  return profile;
}

function verificationOnlyBlocker(
  runnerProfile: NexusRunnerProfileConfig,
): string | null {
  if (
    runnerProfile.mutationClass !== "verification" &&
    runnerProfile.mutationClass !== "none"
  ) {
    return `Runner profile ${runnerProfile.id} has mutation class ${runnerProfile.mutationClass}; remote execution run only supports none or verification.`;
  }
  const unsupported = runnerProfile.allowedOperationClasses.filter(
    (operationClass) =>
      operationClass !== "read_only" && operationClass !== "verification",
  );
  if (unsupported.length > 0) {
    return `Runner profile ${runnerProfile.id} enables unsupported operation classes for verification-only execution: ${unsupported.join(", ")}.`;
  }
  return null;
}

function resolveCommandProfile(
  homeConfig: NexusHomeConfigBase | null,
  commandProfileId: string,
):
  | { commandProfile: NexusSshRemoteExecutionCommandProfile }
  | { error: string } {
  const profile = (homeConfig?.remoteExecution?.commandProfiles ?? []).find(
    (candidate) => candidate.id === commandProfileId,
  );
  if (!profile) {
    return {
      error: `Command profile is not configured in home remoteExecution.commandProfiles: ${commandProfileId}.`,
    };
  }
  try {
    return { commandProfile: normalizeCommandProfile(profile) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeCommandProfile(
  profile: NexusHomeRemoteExecutionCommandProfileConfig,
): NexusSshRemoteExecutionCommandProfile {
  const parsed = parseNexusAutomationCommandExpression(profile.command);
  return {
    id: profile.id,
    command: parsed.display,
    argv: [parsed.command, ...parsed.args],
  };
}

function buildTransportInput(options: {
  projectRoot: string;
  plan: NexusSshExecutionPlan;
  homeConfig: NexusHomeConfigBase | null;
  runnerProfile: NexusRunnerProfileConfig;
  commandProfile: NexusSshRemoteExecutionCommandProfile;
}): NexusSshRemoteExecutionTransportInput {
  return {
    projectRoot: options.projectRoot,
    requestId: options.plan.requestId,
    hostId: options.plan.target.hostId!,
    runnerProfileId: options.runnerProfile.id,
    commandProfile: options.commandProfile,
    repository: options.plan.repository,
    ref: options.plan.ref,
    timeoutMs: options.plan.timeout.effectiveMs,
    outputLineLimit: options.runnerProfile.limits.outputLineLimit,
    outputByteLimit: options.runnerProfile.limits.outputByteLimit,
    expectedCredentialIdentityRef:
      options.runnerProfile.credentialIdentity.kind === "none"
        ? null
        : options.runnerProfile.credentialIdentity.identityRef,
    environment: {
      DEV_NEXUS_REMOTE_EXECUTION_REQUEST_ID: options.plan.requestId,
      DEV_NEXUS_REMOTE_EXECUTION_COMMAND_PROFILE: options.commandProfile.id,
      DEV_NEXUS_REMOTE_EXECUTION_REPOSITORY: options.plan.repository,
      DEV_NEXUS_REMOTE_EXECUTION_REF: options.plan.ref,
    },
    ssh: sshTarget({
      plan: options.plan,
      homeConfig: options.homeConfig,
    }),
    plan: options.plan,
  };
}

function sshTarget(options: {
  plan: NexusSshExecutionPlan;
  homeConfig: NexusHomeConfigBase | null;
}): NexusSshRemoteExecutionTransportSshTarget | null {
  const overlay = hostOverlay(options.homeConfig, options.plan.target.hostId);
  const transport = overlay?.transport;
  const host = sshHost(transport);
  const shellKind = options.plan.command.shellKind;
  const workingDirectory = remoteWorkingDirectory({
    overlay,
    componentId: options.plan.componentId,
  });
  if (!transport || !host || !shellKind || !workingDirectory) {
    return null;
  }
  return {
    host,
    user: transport.sshUser ?? null,
    port: transport.port ?? null,
    shellKind,
    workingDirectory,
  };
}

function hostOverlay(
  homeConfig: NexusHomeConfigBase | null,
  hostId: string | null,
): NexusHomeHostOverlayConfig | null {
  if (!hostId) {
    return null;
  }
  return homeConfig?.hostOverlays?.find((overlay) => overlay.hostId === hostId) ??
    null;
}

function sshHost(
  transport: NexusHomeHostTransportConfig | undefined,
): string | null {
  return transport?.sshHost ??
    transport?.host ??
    transport?.tailscaleAddress ??
    null;
}

function remoteWorkingDirectory(options: {
  overlay: NexusHomeHostOverlayConfig | null;
  componentId: string;
}): string | null {
  return options.overlay?.workspaceRoots?.componentRoots?.[options.componentId] ??
    (options.overlay?.workspaceRoots?.componentsRoot
      ? path.posix.join(
          options.overlay.workspaceRoots.componentsRoot,
          options.componentId,
        )
      : null) ??
    options.overlay?.workspaceRoots?.projectRoot ??
    null;
}

function transportEvidenceBlocker(options: {
  runnerProfile: NexusRunnerProfileConfig;
  transportResult: NexusSshRemoteExecutionTransportResult;
}): string | null {
  if (options.transportResult.timedOut) {
    return null;
  }
  if (!options.transportResult.actualCommit) {
    return "Remote execution transport did not report an actual commit for the requested ref.";
  }
  if (!options.transportResult.actualRef) {
    return "Remote execution transport did not report an actual ref for the requested ref.";
  }
  const expectedIdentity =
    options.runnerProfile.credentialIdentity.kind === "none"
      ? null
      : options.runnerProfile.credentialIdentity.identityRef;
  const actualIdentity = options.transportResult.credentialIdentityRef ?? null;
  if (
    expectedIdentity &&
    actualIdentity &&
    actualIdentity !== expectedIdentity
  ) {
    return `Remote execution used credential identity ${actualIdentity} but runner profile ${options.runnerProfile.id} requires ${expectedIdentity}.`;
  }
  return null;
}

function outputTail(
  result: NexusSshRemoteExecutionTransportResult,
  runnerProfile: NexusRunnerProfileConfig,
): string | null {
  const sections: string[] = [];
  const stdout = (result.stdout ?? "").trimEnd();
  const stderr = (result.stderr ?? "").trimEnd();
  if (stdout) {
    sections.push(`stdout:\n${stdout}`);
  }
  if (stderr) {
    sections.push(`stderr:\n${stderr}`);
  }
  if (result.error) {
    sections.push(`error:\n${result.error}`);
  }
  if (sections.length === 0) {
    return null;
  }

  return limitOutputTail(
    sections.join("\n"),
    runnerProfile.limits.outputLineLimit,
    Math.min(
      runnerProfile.limits.outputByteLimit ?? maxNexusRemoteExecutionOutputTailLength,
      maxNexusRemoteExecutionOutputTailLength,
    ),
  );
}

function limitOutputTail(
  value: string,
  lineLimit: number | null,
  byteLimit: number,
): string {
  let result = value;
  if (lineLimit !== null) {
    const lines = result.split(/\r?\n/u);
    result = lines.slice(-lineLimit).join("\n");
  }
  while (Buffer.byteLength(result, "utf8") > byteLimit) {
    result = result.slice(1);
  }
  return result.trimStart();
}

function posixRemoteScript(input: NexusSshRemoteExecutionTransportInput): string {
  const command = input.commandProfile.argv.map(posixQuote).join(" ");
  const environment = Object.entries(input.environment)
    .map(([key, value]) => `export ${key}=${posixQuote(value)}`)
    .join("\n");
  return [
    "set -e",
    environment,
    `cd ${posixQuote(input.ssh!.workingDirectory)}`,
    "actual_commit=$(git rev-parse --verify --end-of-options \"$DEV_NEXUS_REMOTE_EXECUTION_REF^{commit}\")",
    "git checkout --detach \"$actual_commit\" >/dev/null 2>&1",
    `printf '${actualCommitMarker}%s\\n' "$actual_commit"`,
    command,
  ].join("\n");
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function extractActualCommit(stdout: string): {
  actualCommit: string | null;
  stdout: string;
} {
  const lines = stdout.split(/\r?\n/u);
  let actualCommit: string | null = null;
  const outputLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(actualCommitMarker)) {
      actualCommit = line.slice(actualCommitMarker.length).trim() || null;
      continue;
    }
    outputLines.push(line);
  }
  return {
    actualCommit,
    stdout: outputLines.join("\n"),
  };
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusSshRemoteExecutionError(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}
