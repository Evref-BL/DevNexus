import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  defaultNexusAutomationCommandRunner,
  type NexusAutomationCommandRunner,
} from "../automation/nexusAutomationCommandExecutor.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import type {
  NexusHomeHostOverlayConfig,
  NexusHomeHostOverlaySource,
  NexusProjectHostConfig,
} from "./nexusHostRegistry.js";
import type {
  NexusRemoteExecutionCleanupStatus,
  NexusRemoteExecutionVerificationOutcome,
} from "../remote-execution/nexusRemoteExecution.js";
import type { NexusRunnerMutationClass } from "../remote-execution/nexusRunnerProfile.js";

export const nexusHostCheckResultKind = "dev-nexus.host-check.result";

export type NexusHostCheckMode = "local" | "mock-remote";
export type NexusHostCheckStatus = "passed" | "blocked" | "unavailable";
export type NexusHostCheckProbeStatus =
  | "present"
  | "missing"
  | "unknown"
  | "unavailable";
export type NexusHostCheckCommandId = "dev-nexus-cli" | "git" | "node";
export type NexusHostCheckShellKind =
  | "powershell"
  | "cmd"
  | "posix"
  | "unknown"
  | string;

export interface NexusHostCheckMockFacts {
  available?: boolean;
  unavailableReason?: string;
  platform?: string;
  shellKind?: NexusHostCheckShellKind;
  commands?: Partial<
    Record<NexusHostCheckCommandId, NexusHostCheckProbeStatus | boolean>
  >;
  mcpServerNames?: string[];
}

export interface CheckNexusHostCapabilitiesOptions {
  projectRoot: string;
  hostId?: string | null;
  mode?: NexusHostCheckMode;
  mockFacts?: NexusHostCheckMockFacts | null;
  homeConfig?: NexusHomeHostOverlaySource | null;
  commandRunner?: NexusAutomationCommandRunner;
  now?: Date | string | (() => Date | string);
}

export interface NexusHostCheckTargetSummary {
  mode: NexusHostCheckMode;
  hostId: string;
  displayName: string;
  enabled: boolean;
}

export interface NexusHostCheckOverlaySummary {
  configured: boolean;
  transportConfigured: boolean;
  workspaceRootsConfigured: boolean;
}

export interface NexusHostCheckPlatformSummary {
  tag: string;
  nodePlatform: string | null;
  architecture: string | null;
}

export interface NexusHostCheckCommandProbe {
  id: NexusHostCheckCommandId;
  status: NexusHostCheckProbeStatus;
  command: string | null;
  summary: string;
  detail: string | null;
  nextAction: string | null;
}

export interface NexusHostCheckMcpSummary {
  status: Extract<NexusHostCheckProbeStatus, "present" | "missing" | "unknown">;
  serverNames: string[];
  summary: string;
  nextAction: string | null;
}

export interface NexusHostCheckResult {
  kind: typeof nexusHostCheckResultKind;
  version: 1;
  checkedAt: string;
  projectId: string;
  projectName: string;
  target: NexusHostCheckTargetSummary;
  status: NexusHostCheckStatus;
  summary: string;
  mutationClass: NexusRunnerMutationClass;
  verificationOutcome: NexusRemoteExecutionVerificationOutcome;
  cleanupStatus: NexusRemoteExecutionCleanupStatus;
  platform: NexusHostCheckPlatformSummary;
  shellKind: NexusHostCheckShellKind;
  configuredCapabilities: string[];
  overlay: NexusHostCheckOverlaySummary;
  commandChecks: NexusHostCheckCommandProbe[];
  mcp: NexusHostCheckMcpSummary;
  nextActions: string[];
}

export class NexusHostCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusHostCheckError";
  }
}

export function checkNexusHostCapabilities(
  options: CheckNexusHostCapabilitiesOptions,
): NexusHostCheckResult {
  const projectRoot = path.resolve(requiredString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const host = selectProjectHost(projectConfig, options.hostId);
  const overlay = host
    ? (options.homeConfig?.hostOverlays ?? []).find(
        (candidate) => candidate.hostId === host.id,
      ) ?? null
    : null;
  const mode = options.mode ?? "local";
  const timestamp = currentTimestamp(options.now);

  if (host && !host.enabled) {
    return unavailableResult({
      projectConfig,
      timestamp,
      mode,
      host,
      overlay,
      reason: `Host ${host.id} is disabled in shared workspace config.`,
      nextAction: "Enable the host in shared workspace config or choose another host.",
    });
  }

  if (mode === "mock-remote") {
    return checkMockRemoteHost({
      projectConfig,
      timestamp,
      host,
      overlay,
      mockFacts: options.mockFacts,
    });
  }

  return checkLocalHost({
    projectRoot,
    projectConfig,
    timestamp,
    host,
    overlay,
    commandRunner:
      options.commandRunner ?? defaultNexusAutomationCommandRunner,
  });
}

function checkLocalHost(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  timestamp: string;
  host: NexusProjectHostConfig | null;
  overlay: NexusHomeHostOverlayConfig | null;
  commandRunner: NexusAutomationCommandRunner;
}): NexusHostCheckResult {
  const commandChecks: NexusHostCheckCommandProbe[] = [
    {
      id: "dev-nexus-cli",
      status: "present",
      command: null,
      summary: "DevNexus CLI is available from the current process.",
      detail: "current-process",
      nextAction: null,
    },
    commandProbe({
      id: "git",
      command: "git --version",
      projectRoot: options.projectRoot,
      commandRunner: options.commandRunner,
    }),
    commandProbe({
      id: "node",
      command: "node --version",
      projectRoot: options.projectRoot,
      commandRunner: options.commandRunner,
    }),
  ];
  const mcp = mcpSummary(options.projectConfig, null);

  return buildResult({
    projectConfig: options.projectConfig,
    timestamp: options.timestamp,
    mode: "local",
    host: options.host,
    overlay: options.overlay,
    platform: {
      tag: platformTag(process.platform),
      nodePlatform: process.platform,
      architecture: os.arch(),
    },
    shellKind: inferLocalShellKind(),
    commandChecks,
    mcp,
  });
}

function checkMockRemoteHost(options: {
  projectConfig: NexusProjectConfig;
  timestamp: string;
  host: NexusProjectHostConfig | null;
  overlay: NexusHomeHostOverlayConfig | null;
  mockFacts: NexusHostCheckMockFacts | null | undefined;
}): NexusHostCheckResult {
  const facts = options.mockFacts;
  if (!facts || facts.available === false) {
    return unavailableResult({
      projectConfig: options.projectConfig,
      timestamp: options.timestamp,
      mode: "mock-remote",
      host: options.host,
      overlay: options.overlay,
      reason:
        sanitizeHostLocalDetail(facts?.unavailableReason) ??
        "Mock remote facts were not provided.",
      nextAction:
        "Check host availability or retry when the mocked transport is available.",
    });
  }

  const commandChecks = hostCheckCommandIds.map((id) =>
    mockCommandProbe(id, facts.commands?.[id]),
  );
  const mcp = mcpSummary(options.projectConfig, facts.mcpServerNames);

  return buildResult({
    projectConfig: options.projectConfig,
    timestamp: options.timestamp,
    mode: "mock-remote",
    host: options.host,
    overlay: options.overlay,
    platform: {
      tag: facts.platform ?? firstPlatformTag(options.host) ?? "unknown",
      nodePlatform: null,
      architecture: null,
    },
    shellKind: facts.shellKind ?? shellKindFromOverlay(options.overlay),
    commandChecks,
    mcp,
  });
}

function unavailableResult(options: {
  projectConfig: NexusProjectConfig;
  timestamp: string;
  mode: NexusHostCheckMode;
  host: NexusProjectHostConfig | null;
  overlay: NexusHomeHostOverlayConfig | null;
  reason: string;
  nextAction: string;
}): NexusHostCheckResult {
  return {
    kind: nexusHostCheckResultKind,
    version: 1,
    checkedAt: options.timestamp,
    projectId: options.projectConfig.id,
    projectName: options.projectConfig.name,
    target: targetSummary(options.mode, options.host),
    status: "unavailable",
    summary: `Host check unavailable: ${sanitizeHostLocalDetail(options.reason)}`,
    mutationClass: "none",
    verificationOutcome: "blocked",
    cleanupStatus: "not_required",
    platform: {
      tag: firstPlatformTag(options.host) ?? "unknown",
      nodePlatform: null,
      architecture: null,
    },
    shellKind: shellKindFromOverlay(options.overlay),
    configuredCapabilities: options.host?.capabilityTags ?? [],
    overlay: overlaySummary(options.overlay),
    commandChecks: hostCheckCommandIds.map((id) => ({
      id,
      status: "unavailable",
      command: null,
      summary: "Host is unavailable; command probe was not run.",
      detail: null,
      nextAction: options.nextAction,
    })),
    mcp: {
      status: "unknown",
      serverNames: [],
      summary: "Host is unavailable; MCP config visibility was not checked.",
      nextAction: options.nextAction,
    },
    nextActions: [options.nextAction],
  };
}

function buildResult(options: {
  projectConfig: NexusProjectConfig;
  timestamp: string;
  mode: NexusHostCheckMode;
  host: NexusProjectHostConfig | null;
  overlay: NexusHomeHostOverlayConfig | null;
  platform: NexusHostCheckPlatformSummary;
  shellKind: NexusHostCheckShellKind;
  commandChecks: NexusHostCheckCommandProbe[];
  mcp: NexusHostCheckMcpSummary;
}): NexusHostCheckResult {
  const missingActions = uniqueStrings([
    ...options.commandChecks.flatMap((check) =>
      check.status === "missing" && check.nextAction ? [check.nextAction] : [],
    ),
    ...(options.mcp.status === "missing" && options.mcp.nextAction
      ? [options.mcp.nextAction]
      : []),
  ]);
  const blocked = missingActions.length > 0;
  const status: NexusHostCheckStatus = blocked ? "blocked" : "passed";

  return {
    kind: nexusHostCheckResultKind,
    version: 1,
    checkedAt: options.timestamp,
    projectId: options.projectConfig.id,
    projectName: options.projectConfig.name,
    target: targetSummary(options.mode, options.host),
    status,
    summary: blocked
      ? `Host check blocked: ${missingActions[0]}`
      : "Host check passed.",
    mutationClass: "none",
    verificationOutcome: blocked ? "blocked" : "passed",
    cleanupStatus: "not_required",
    platform: options.platform,
    shellKind: options.shellKind,
    configuredCapabilities: options.host?.capabilityTags ?? [],
    overlay: overlaySummary(options.overlay),
    commandChecks: options.commandChecks,
    mcp: options.mcp,
    nextActions: missingActions,
  };
}

function commandProbe(options: {
  id: Exclude<NexusHostCheckCommandId, "dev-nexus-cli">;
  command: string;
  projectRoot: string;
  commandRunner: NexusAutomationCommandRunner;
}): NexusHostCheckCommandProbe {
  try {
    const result = options.commandRunner(options.command, {
      cwd: options.projectRoot,
      env: process.env,
      timeoutMs: 10_000,
    });
    const detail = sanitizeHostLocalDetail(commandOutputDetail(result));
    if (result.exitCode === 0 && !result.error) {
      return {
        id: options.id,
        status: "present",
        command: options.command,
        summary: `${options.id} command is available.`,
        detail,
        nextAction: null,
      };
    }

    return {
      id: options.id,
      status: "missing",
      command: options.command,
      summary: `${options.id} command is missing or failed.`,
      detail,
      nextAction: `Install ${options.id} or add it to the host-local runner path.`,
    };
  } catch (error) {
    return {
      id: options.id,
      status: "missing",
      command: options.command,
      summary: `${options.id} command probe failed.`,
      detail: sanitizeHostLocalDetail(
        error instanceof Error ? error.message : String(error),
      ),
      nextAction: `Install ${options.id} or add it to the host-local runner path.`,
    };
  }
}

function mockCommandProbe(
  id: NexusHostCheckCommandId,
  value: NexusHostCheckProbeStatus | boolean | undefined,
): NexusHostCheckCommandProbe {
  const status = mockProbeStatus(value);
  return {
    id,
    status,
    command: id === "dev-nexus-cli" ? null : `${id} --version`,
    summary: `${id} command status is ${status}.`,
    detail: null,
    nextAction:
      status === "missing"
        ? `Install ${id} or add it to the host-local runner path.`
        : null,
  };
}

function mcpSummary(
  projectConfig: NexusProjectConfig,
  mockServerNames: string[] | null | undefined,
): NexusHostCheckMcpSummary {
  const serverNames = uniqueStrings(
    mockServerNames ?? configuredMcpServerNames(projectConfig),
  );
  if (serverNames.length === 0) {
    return {
      status: "missing",
      serverNames,
      summary: "No MCP server configuration is visible in shared workspace config.",
      nextAction: "Configure DevNexus MCP or plugin MCP server entries.",
    };
  }

  return {
    status: "present",
    serverNames,
    summary: `Visible MCP server configuration: ${serverNames.join(", ")}.`,
    nextAction: null,
  };
}

function configuredMcpServerNames(projectConfig: NexusProjectConfig): string[] {
  const names: string[] = [];
  if (projectConfig.mcp && projectConfig.mcp.enabled !== false) {
    names.push(projectConfig.mcp?.serverName ?? "dev_nexus");
  }
  for (const plugin of projectConfig.plugins ?? []) {
    if (plugin.enabled === false) {
      continue;
    }
    for (const capability of plugin.capabilities) {
      if (capability.kind === "mcp_server") {
        names.push(capability.serverName);
      }
    }
  }

  return names;
}

function selectProjectHost(
  projectConfig: NexusProjectConfig,
  hostId: string | null | undefined,
): NexusProjectHostConfig | null {
  const normalizedHostId = hostId?.trim();
  if (!normalizedHostId) {
    return null;
  }
  const host = (projectConfig.hosts ?? []).find(
    (candidate) => candidate.id === normalizedHostId,
  );
  if (!host) {
    throw new NexusHostCheckError(`Project host is not configured: ${normalizedHostId}`);
  }

  return host;
}

function targetSummary(
  mode: NexusHostCheckMode,
  host: NexusProjectHostConfig | null,
): NexusHostCheckTargetSummary {
  return {
    mode,
    hostId: host?.id ?? "local",
    displayName: host?.displayName ?? "Local Host",
    enabled: host?.enabled ?? true,
  };
}

function overlaySummary(
  overlay: NexusHomeHostOverlayConfig | null,
): NexusHostCheckOverlaySummary {
  return {
    configured: overlay !== null,
    transportConfigured: overlay?.transport !== undefined,
    workspaceRootsConfigured:
      overlay?.workspaceRoots !== undefined &&
      Object.keys(overlay.workspaceRoots).length > 0,
  };
}

function shellKindFromOverlay(
  overlay: NexusHomeHostOverlayConfig | null,
): NexusHostCheckShellKind {
  const shell = overlay?.transport?.shell?.trim().toLowerCase();
  if (!shell) {
    return "unknown";
  }
  if (shell.includes("powershell") || shell === "pwsh") {
    return "powershell";
  }
  if (shell === "cmd" || shell === "cmd.exe") {
    return "cmd";
  }
  if (shell === "sh" || shell === "bash" || shell === "zsh") {
    return "posix";
  }

  return shell;
}

function inferLocalShellKind(): NexusHostCheckShellKind {
  if (process.platform === "win32") {
    const shell = process.env.ComSpec?.toLowerCase() ?? "";
    return shell.includes("cmd") ? "cmd" : "powershell";
  }

  return "posix";
}

function platformTag(nodePlatform: NodeJS.Platform): string {
  if (nodePlatform === "win32") {
    return "windows";
  }
  if (nodePlatform === "darwin") {
    return "macos";
  }
  if (nodePlatform === "linux") {
    return "linux";
  }
  return nodePlatform;
}

function firstPlatformTag(host: NexusProjectHostConfig | null): string | null {
  return host?.platformTags[0] ?? null;
}

function mockProbeStatus(
  value: NexusHostCheckProbeStatus | boolean | undefined,
): NexusHostCheckProbeStatus {
  if (value === true) {
    return "present";
  }
  if (value === false) {
    return "missing";
  }
  return value ?? "unknown";
}

function commandOutputDetail(result: {
  stdout: string;
  stderr: string;
  error?: string;
  exitCode: number | null;
}): string | null {
  if (result.error) {
    return result.error;
  }
  const detail = lastNonEmptyLine(result.stderr) ?? lastNonEmptyLine(result.stdout);
  if (detail) {
    return detail;
  }
  return result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
}

function lastNonEmptyLine(value: string): string | null {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? null;
}

export function sanitizeHostLocalDetail(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\?)+/gu, "[host-local-path]")
    .replace(/(?:^|\s)\/Users\/[^/\s]+(?:\/[^\s]+)*/gu, " [host-local-path]")
    .replace(/(?:^|\s)\/home\/[^/\s]+(?:\/[^\s]+)*/gu, " [host-local-path]")
    .replace(
      /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})\b/gu,
      "[tailscale-address]",
    )
    .replace(
      /(?:localhost|127\.0\.0\.1|\[?::1\]?):\d{2,5}/giu,
      "[host-local-port]",
    )
    .replace(
      /(?:ghp_|github_pat_|sk-[A-Za-z0-9]|password=|token=|secret=)[^\s]*/gu,
      "[secret]",
    );
}

function currentTimestamp(now?: Date | string | (() => Date | string)): string {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusHostCheckError("now must be a valid date");
  }

  return date.toISOString();
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function requiredString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusHostCheckError(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}

const hostCheckCommandIds: NexusHostCheckCommandId[] = [
  "dev-nexus-cli",
  "git",
  "node",
];
