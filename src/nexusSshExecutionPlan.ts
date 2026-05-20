import path from "node:path";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  type NexusHomeConfigBase,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  type NexusHomeHostOverlayConfig,
  type NexusProjectHostConfig,
} from "./nexusHostRegistry.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import type { ResolvedNexusProjectComponent } from "./nexusProjectLifecycle.js";
import {
  resolveProjectComponents,
} from "./nexusProjectLifecycle.js";
import {
  getNexusRemoteExecutionRecord,
  type NexusRemoteExecutionRequestRecord,
} from "./nexusRemoteExecution.js";
import {
  type NexusRunnerProfileConfig,
} from "./nexusRunnerProfile.js";

export const nexusSshExecutionPlanKind =
  "dev-nexus.remote-execution.ssh-plan";

export type NexusSshExecutionPlanStatus = "ready" | "blocked";
export type NexusSshExecutionPlanShellKind = "posix" | "powershell" | "cmd";
export type NexusSshExecutionPlanWorkingDirectoryClass =
  | "component_root"
  | "components_root_child"
  | "project_root";

export interface PlanNexusSshExecutionOptions {
  projectRoot: string;
  requestId: string;
  homePath?: string;
  homeConfig?: NexusHomeConfigBase | null;
}

export interface NexusSshExecutionPlanCheck {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface NexusSshExecutionPlanTarget {
  hostId: string | null;
  displayName: string | null;
  platformTags: string[];
  capabilityTags: string[];
}

export interface NexusSshExecutionPlanTransport {
  kind: "ssh";
  host: "configured" | "missing";
  user: "configured" | "default";
  port: "configured" | "default";
  credentialProfile: "configured" | "missing";
  addressSource: "sshHost" | "host" | "tailscaleAddress" | null;
}

export interface NexusSshExecutionPlanWorkingDirectory {
  classification: NexusSshExecutionPlanWorkingDirectoryClass | null;
  componentId: string;
  sanitizedPath: string | null;
}

export interface NexusSshExecutionPlanCommand {
  shellKind: NexusSshExecutionPlanShellKind | null;
  commandProfileId: string;
  sshArgvShape: string[];
  display: string;
}

export interface NexusSshExecutionPlanTimeout {
  requestedMs: number;
  profileLimitMs: number | null;
  effectiveMs: number;
}

export interface NexusSshExecutionPlanOutputPolicy {
  outputLineLimit: number | null;
  outputByteLimit: number | null;
}

export interface NexusSshExecutionPlan {
  kind: typeof nexusSshExecutionPlanKind;
  version: 1;
  status: NexusSshExecutionPlanStatus;
  projectId: string;
  componentId: string;
  requestId: string;
  runnerProfileId: string;
  repository: string;
  ref: string;
  mutationClass: NexusRemoteExecutionRequestRecord["mutationClass"];
  target: NexusSshExecutionPlanTarget;
  transport: NexusSshExecutionPlanTransport | null;
  workingDirectory: NexusSshExecutionPlanWorkingDirectory;
  command: NexusSshExecutionPlanCommand;
  timeout: NexusSshExecutionPlanTimeout;
  outputPolicy: NexusSshExecutionPlanOutputPolicy;
  requiredEnvironmentKeys: string[];
  checks: NexusSshExecutionPlanCheck[];
  blockers: string[];
  summary: string;
}

export class NexusSshExecutionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusSshExecutionPlanError";
  }
}

export function planNexusSshExecution(
  options: PlanNexusSshExecutionOptions,
): NexusSshExecutionPlan {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const { request } = getNexusRemoteExecutionRecord({
    projectRoot,
    requestId: requiredNonEmptyString(options.requestId, "requestId"),
  });
  const component = componentForRequest(components, request);
  const runnerProfile = runnerProfileForRequest(projectConfig, request);
  const targetResolution = resolveTargetHost({
    projectConfig,
    runnerProfile,
    request,
  });
  const overlay = targetResolution.host
    ? hostOverlayForTarget({
        projectRoot,
        projectConfig,
        homePath: options.homePath,
        homeConfig: options.homeConfig,
        hostId: targetResolution.host.id,
      })
    : null;
  const shellKind = overlay?.transport
    ? sshShellKind(overlay.transport.shell)
    : null;
  const workingDirectory = remoteWorkingDirectory({
    overlay,
    component,
  });
  const timeout = timeoutPolicy(request, runnerProfile);
  const checks = [
    ...targetResolution.checks,
    check(
      "runnerProfile",
      runnerProfile.enabled,
      `Runner profile ${runnerProfile.id} is enabled.`,
      `Runner profile ${runnerProfile.id} is disabled.`,
    ),
    check(
      "commandProfile",
      runnerProfile.commandProfileRefs.includes(request.commandProfileId),
      `Command profile ${request.commandProfileId} is allowed by runner profile ${runnerProfile.id}.`,
      `Command profile ${request.commandProfileId} is not allowed by runner profile ${runnerProfile.id}.`,
    ),
    check(
      "mutationClass",
      runnerProfile.mutationClass === request.mutationClass,
      `Mutation class ${request.mutationClass} matches runner profile ${runnerProfile.id}.`,
      `Mutation class ${request.mutationClass} does not match runner profile ${runnerProfile.id}.`,
    ),
    check(
      "transport",
      overlay?.transport?.kind === "ssh",
      "Host-local SSH transport overlay is configured.",
      `Host ${targetResolution.host?.id ?? "unknown"} needs a host-local SSH transport overlay.`,
    ),
    check(
      "sshAddress",
      Boolean(sshAddressSource(overlay)),
      "SSH host or Tailscale address is configured in the host-local overlay.",
      `Host ${targetResolution.host?.id ?? "unknown"} needs sshHost, host, or tailscaleAddress in its host-local overlay.`,
    ),
    check(
      "workspaceRoot",
      workingDirectory.classification !== null,
      "Remote working directory can be resolved from host-local workspace roots.",
      `Host ${targetResolution.host?.id ?? "unknown"} needs a host-local projectRoot, componentsRoot, or componentRoots.${component.id}.`,
    ),
    check(
      "shell",
      shellKind !== null,
      "SSH shell kind is supported.",
      `Host ${targetResolution.host?.id ?? "unknown"} needs a supported shell kind: sh, bash, zsh, cmd, powershell, or pwsh.`,
    ),
  ];
  const blockers = checks
    .filter((item) => item.status === "failed")
    .map((item) => item.message);
  const status: NexusSshExecutionPlanStatus =
    blockers.length === 0 ? "ready" : "blocked";
  const command = sshCommandPlan({
    shellKind,
    commandProfileId: request.commandProfileId,
    transport: overlay?.transport ?? null,
  });

  return {
    kind: nexusSshExecutionPlanKind,
    version: 1,
    status,
    projectId: projectConfig.id,
    componentId: component.id,
    requestId: request.id,
    runnerProfileId: runnerProfile.id,
    repository: request.repository,
    ref: request.ref,
    mutationClass: request.mutationClass,
    target: {
      hostId: targetResolution.host?.id ?? null,
      displayName: targetResolution.host?.displayName ?? null,
      platformTags: targetResolution.host?.platformTags ?? [],
      capabilityTags: targetResolution.host?.capabilityTags ?? [],
    },
    transport: overlay?.transport
      ? {
          kind: "ssh",
          host: sshAddressSource(overlay) ? "configured" : "missing",
          user: overlay.transport.sshUser ? "configured" : "default",
          port: overlay.transport.port ? "configured" : "default",
          credentialProfile: overlay.transport.authProfile
            ? "configured"
            : "missing",
          addressSource: sshAddressSource(overlay),
        }
      : null,
    workingDirectory,
    command,
    timeout,
    outputPolicy: {
      outputLineLimit: runnerProfile.limits.outputLineLimit,
      outputByteLimit: runnerProfile.limits.outputByteLimit,
    },
    requiredEnvironmentKeys: [
      "DEV_NEXUS_REMOTE_EXECUTION_REQUEST_ID",
      "DEV_NEXUS_REMOTE_EXECUTION_COMMAND_PROFILE",
      "DEV_NEXUS_REMOTE_EXECUTION_REPOSITORY",
      "DEV_NEXUS_REMOTE_EXECUTION_REF",
    ],
    checks,
    blockers,
    summary:
      status === "ready"
        ? `SSH execution plan is ready for request ${request.id} on host ${targetResolution.host?.id}.`
        : `SSH execution plan is blocked for request ${request.id}: ${blockers.join("; ")}`,
  };
}

function componentForRequest(
  components: ResolvedNexusProjectComponent[],
  request: NexusRemoteExecutionRequestRecord,
): ResolvedNexusProjectComponent {
  const component = components.find(
    (candidate) => candidate.id === request.componentId,
  );
  if (!component) {
    throw new NexusSshExecutionPlanError(
      `Project component is not configured: ${request.componentId}`,
    );
  }

  return component;
}

function runnerProfileForRequest(
  projectConfig: NexusProjectConfig,
  request: NexusRemoteExecutionRequestRecord,
): NexusRunnerProfileConfig {
  const profile = (projectConfig.runnerProfiles ?? []).find(
    (candidate) => candidate.id === request.runnerProfileId,
  );
  if (!profile) {
    throw new NexusSshExecutionPlanError(
      `Runner profile is not configured: ${request.runnerProfileId}`,
    );
  }

  return profile;
}

function resolveTargetHost(options: {
  projectConfig: NexusProjectConfig;
  runnerProfile: NexusRunnerProfileConfig;
  request: NexusRemoteExecutionRequestRecord;
}): {
  host: NexusProjectHostConfig | null;
  checks: NexusSshExecutionPlanCheck[];
} {
  const hosts = options.projectConfig.hosts ?? [];
  const requiredCapabilities = uniqueStrings([
    ...options.runnerProfile.requiredCapabilities,
    ...options.request.requiredCapabilities,
  ]);
  if (options.request.targetHostId) {
    const host =
      hosts.find(
        (candidate) => candidate.id === options.request.targetHostId,
      ) ?? null;
    if (!host) {
      return {
        host: null,
        checks: [
          check(
            "targetHost",
            false,
            "",
            `Target host is not configured: ${options.request.targetHostId}`,
          ),
        ],
      };
    }
    return {
      host,
      checks: [
        check(
          "targetHost",
          host.enabled,
          `Target host ${host.id} is enabled.`,
          `Target host ${host.id} is disabled.`,
        ),
        check(
          "hostCapabilities",
          missingCapabilities(requiredCapabilities, host.capabilityTags).length === 0,
          `Target host ${host.id} satisfies required capabilities.`,
          `Target host ${host.id} is missing capabilities: ${missingCapabilities(requiredCapabilities, host.capabilityTags).join(", ") || "unknown"}.`,
        ),
      ],
    };
  }

  const candidates = hosts.filter(
    (host) =>
      host.enabled &&
      missingCapabilities(requiredCapabilities, host.capabilityTags).length === 0,
  );
  if (candidates.length === 1) {
    return {
      host: candidates[0]!,
      checks: [
        check(
          "targetHost",
          true,
          `Selected target host ${candidates[0]!.id} from required capabilities.`,
          "",
        ),
      ],
    };
  }

  return {
    host: null,
    checks: [
      check(
        "targetHost",
        false,
        "",
        candidates.length === 0
          ? `No enabled host satisfies required capabilities: ${requiredCapabilities.join(", ") || "none"}.`
          : `Multiple enabled hosts satisfy required capabilities; set targetHostId explicitly: ${candidates.map((host) => host.id).join(", ")}.`,
      ),
    ],
  };
}

function hostOverlayForTarget(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
  homeConfig?: NexusHomeConfigBase | null;
  hostId: string;
}): NexusHomeHostOverlayConfig | null {
  const homeConfig =
    options.homeConfig !== undefined
      ? options.homeConfig
      : loadHomeConfig(options);
  return (
    homeConfig?.hostOverlays?.find(
      (candidate) => candidate.hostId === options.hostId,
    ) ?? null
  );
}

function loadHomeConfig(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): NexusHomeConfigBase | null {
  const homePath = options.homePath
    ? path.resolve(options.homePath)
    : options.projectConfig.home
      ? resolveNexusProjectPath({
          projectRoot: options.projectRoot,
          value: options.projectConfig.home,
        })
      : defaultNexusHomePath();
  try {
    return loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase);
  } catch {
    return null;
  }
}

function remoteWorkingDirectory(options: {
  overlay: NexusHomeHostOverlayConfig | null;
  component: ResolvedNexusProjectComponent;
}): NexusSshExecutionPlanWorkingDirectory {
  const workspaceRoots = options.overlay?.workspaceRoots;
  if (workspaceRoots?.componentRoots?.[options.component.id]) {
    return {
      classification: "component_root",
      componentId: options.component.id,
      sanitizedPath: "[host-local-component-root]",
    };
  }
  if (workspaceRoots?.componentsRoot) {
    return {
      classification: "components_root_child",
      componentId: options.component.id,
      sanitizedPath: "[host-local-components-root]/<component-id>",
    };
  }
  if (workspaceRoots?.projectRoot) {
    return {
      classification: "project_root",
      componentId: options.component.id,
      sanitizedPath: "[host-local-project-root]",
    };
  }

  return {
    classification: null,
    componentId: options.component.id,
    sanitizedPath: null,
  };
}

function sshCommandPlan(options: {
  shellKind: NexusSshExecutionPlanShellKind | null;
  commandProfileId: string;
  transport: NexusHomeHostOverlayConfig["transport"] | null;
}): NexusSshExecutionPlanCommand {
  const shellShape = remoteShellShape(
    options.shellKind,
    options.commandProfileId,
  );
  const argv = [
    "ssh",
    ...(options.transport?.port ? ["-p", "<ssh-port>"] : []),
    "<ssh-user>@<ssh-host>",
    "--",
    ...shellShape,
  ];

  return {
    shellKind: options.shellKind,
    commandProfileId: options.commandProfileId,
    sshArgvShape: argv,
    display: argv.join(" "),
  };
}

function remoteShellShape(
  shellKind: NexusSshExecutionPlanShellKind | null,
  commandProfileId: string,
): string[] {
  const commandPlaceholder = `<command-profile:${commandProfileId}>`;
  switch (shellKind) {
    case "powershell":
      return ["pwsh", "-NoProfile", "-Command", commandPlaceholder];
    case "cmd":
      return ["cmd", "/d", "/s", "/c", commandPlaceholder];
    case "posix":
      return ["sh", "-lc", commandPlaceholder];
    case null:
      return ["<unsupported-shell>", commandPlaceholder];
  }
}

function sshShellKind(
  shell: string | null | undefined,
): NexusSshExecutionPlanShellKind | null {
  const normalized = shell?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "sh" ||
    normalized === "bash" ||
    normalized === "zsh" ||
    normalized.endsWith("/sh") ||
    normalized.endsWith("/bash") ||
    normalized.endsWith("/zsh")
  ) {
    return "posix";
  }
  if (
    normalized === "powershell" ||
    normalized === "powershell.exe" ||
    normalized === "pwsh" ||
    normalized === "pwsh.exe" ||
    normalized.endsWith("/pwsh")
  ) {
    return "powershell";
  }
  if (normalized === "cmd" || normalized === "cmd.exe") {
    return "cmd";
  }

  return null;
}

function sshAddressSource(
  overlay: NexusHomeHostOverlayConfig | null,
): NexusSshExecutionPlanTransport["addressSource"] {
  if (overlay?.transport?.sshHost) {
    return "sshHost";
  }
  if (overlay?.transport?.host) {
    return "host";
  }
  if (overlay?.transport?.tailscaleAddress) {
    return "tailscaleAddress";
  }
  return null;
}

function timeoutPolicy(
  request: NexusRemoteExecutionRequestRecord,
  runnerProfile: NexusRunnerProfileConfig,
): NexusSshExecutionPlanTimeout {
  const profileLimitMs = runnerProfile.limits.timeoutMs;
  return {
    requestedMs: request.timeoutMs,
    profileLimitMs,
    effectiveMs: profileLimitMs
      ? Math.min(request.timeoutMs, profileLimitMs)
      : request.timeoutMs,
  };
}

function check(
  name: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): NexusSshExecutionPlanCheck {
  return {
    name,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : failedMessage,
  };
}

function missingCapabilities(
  requiredCapabilities: readonly string[],
  hostCapabilities: readonly string[],
): string[] {
  const hostCapabilitySet = new Set(hostCapabilities);
  return requiredCapabilities.filter(
    (capability) => !hostCapabilitySet.has(capability),
  );
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

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusSshExecutionPlanError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
