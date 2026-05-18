export interface NexusProjectHostConfig {
  id: string;
  displayName: string;
  platformTags: string[];
  capabilityTags: string[];
  enabled: boolean;
  notes?: string;
}

export type NexusHomeHostTransportKind = "local" | "ssh" | "manual";

export interface NexusHomeHostTransportConfig {
  kind: NexusHomeHostTransportKind;
  host?: string;
  sshHost?: string;
  sshUser?: string;
  port?: number;
  tailscaleAddress?: string;
  shell?: string;
  authProfile?: string;
  commandPaths?: Record<string, string>;
}

export interface NexusHomeHostWorkspaceRootsConfig {
  projectRoot?: string;
  componentsRoot?: string;
  worktreesRoot?: string;
  componentRoots?: Record<string, string>;
}

export interface NexusHomeHostOverlayConfig {
  hostId: string;
  transport?: NexusHomeHostTransportConfig;
  workspaceRoots?: NexusHomeHostWorkspaceRootsConfig;
  notes?: string;
}

export interface NexusProjectHostStatus {
  id: string;
  displayName: string;
  enabled: boolean;
  platformTags: string[];
  capabilityTags: string[];
  overlayConfigured: boolean;
  transportConfigured: boolean;
  workspaceRootsConfigured: boolean;
  warnings: string[];
}

export interface NexusHomeHostOverlaySource {
  hostOverlays?: NexusHomeHostOverlayConfig[];
}

export interface NexusSharedHostLocalDetailWarning {
  path: string;
  reason: string;
}

export function buildNexusProjectHostStatuses(
  hosts: readonly NexusProjectHostConfig[] | undefined,
  homeConfig?: NexusHomeHostOverlaySource | null,
): NexusProjectHostStatus[] {
  const overlays = new Map(
    (homeConfig?.hostOverlays ?? []).map((overlay) => [
      overlay.hostId,
      overlay,
    ]),
  );

  return (hosts ?? []).map((host) => {
    const overlay = overlays.get(host.id);
    const overlayConfigured = overlay !== undefined;
    const transportConfigured = overlay?.transport !== undefined;
    const workspaceRootsConfigured = hasWorkspaceRoots(overlay?.workspaceRoots);
    const warnings =
      host.enabled && !overlayConfigured
        ? [`Host ${host.id} is enabled but no host-local overlay is configured.`]
        : [];

    return {
      id: host.id,
      displayName: host.displayName,
      enabled: host.enabled,
      platformTags: [...host.platformTags],
      capabilityTags: [...host.capabilityTags],
      overlayConfigured,
      transportConfigured,
      workspaceRootsConfigured,
      warnings,
    };
  });
}

export function findForbiddenSharedHostLocalDetails(
  rawProjectConfig: unknown,
): NexusSharedHostLocalDetailWarning[] {
  if (!rawProjectConfig || typeof rawProjectConfig !== "object") {
    return [];
  }
  const hosts = (rawProjectConfig as { hosts?: unknown }).hosts;
  if (!Array.isArray(hosts)) {
    return [];
  }

  const warnings: NexusSharedHostLocalDetailWarning[] = [];
  hosts.forEach((host, index) => {
    scanSharedHostValue(host, `hosts[${index}]`, warnings);
  });

  return warnings;
}

function hasWorkspaceRoots(
  workspaceRoots: NexusHomeHostWorkspaceRootsConfig | undefined,
): boolean {
  if (!workspaceRoots) {
    return false;
  }

  return (
    workspaceRoots.projectRoot !== undefined ||
    workspaceRoots.componentsRoot !== undefined ||
    workspaceRoots.worktreesRoot !== undefined ||
    Object.keys(workspaceRoots.componentRoots ?? {}).length > 0
  );
}

function scanSharedHostValue(
  value: unknown,
  pathName: string,
  warnings: NexusSharedHostLocalDetailWarning[],
): void {
  const fieldReason = forbiddenSharedHostFieldReason(pathName);
  if (fieldReason) {
    warnings.push({ path: pathName, reason: fieldReason });
  }

  if (typeof value === "string") {
    const valueReason = forbiddenSharedHostValueReason(value);
    if (valueReason) {
      warnings.push({ path: pathName, reason: valueReason });
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanSharedHostValue(entry, `${pathName}[${index}]`, warnings),
    );
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    scanSharedHostValue(entry, `${pathName}.${key}`, warnings);
  }
}

function forbiddenSharedHostFieldReason(pathName: string): string | null {
  const field = pathName.split(".").at(-1) ?? pathName;
  if (/tailscale(?:ip|address|host)?/iu.test(field)) {
    return "Tailscale addresses belong in host-local overlays.";
  }
  if (
    /(?:transport|sshhost|hostname|hostaddress|remotehost|shell|commandpath)/iu.test(
      field,
    )
  ) {
    return "Transport details and command paths belong in host-local overlays.";
  }
  if (/^(?:ssh)?(?:user|username)$/iu.test(field)) {
    return "SSH usernames belong in host-local overlays.";
  }
  if (
    /(?:authprofile|password|token|secret|credential|privatekey|keypath)/iu.test(
      field,
    )
  ) {
    return "Credential material and key paths belong in host-local overlays.";
  }
  if (/(?:workspace|project|component|source|worktrees)root/iu.test(field)) {
    return "Workspace and source roots belong in host-local overlays.";
  }
  if (/(?:^|mcp|http|runtime)ports?$/iu.test(field)) {
    return "Live ports belong in host-local overlays.";
  }
  if (/(?:runtime|artifact|image|log).*path/iu.test(field)) {
    return "Runtime artifact paths belong in host-local overlays.";
  }

  return null;
}

function forbiddenSharedHostValueReason(value: string): string | null {
  if (containsTailscaleIp(value)) {
    return "Tailscale IP addresses belong in host-local overlays.";
  }
  if (containsPersonalAbsolutePath(value)) {
    return "Absolute personal paths belong in host-local overlays.";
  }
  if (/(?:localhost|127\.0\.0\.1|\[?::1\]?):\d{2,5}/iu.test(value)) {
    return "Live ports belong in host-local overlays.";
  }
  if (
    /(?:ghp_|github_pat_|sk-[A-Za-z0-9]|password=|token=|secret=)/u.test(value)
  ) {
    return "Credential material belongs in host-local overlays.";
  }
  if (/\.(?:image|changes|ombu|log)\b/iu.test(value)) {
    return "Runtime artifact paths belong in host-local overlays.";
  }

  return null;
}

function containsTailscaleIp(value: string): boolean {
  const matches = value.match(/\b100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/gu);
  if (!matches) {
    return false;
  }

  return matches.some((match) => {
    const matchResult =
      /\b100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/u.exec(match);
    if (!matchResult) {
      return false;
    }
    const octets = matchResult.slice(1).map((part) => Number(part));
    return (
      octets.every(
        (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
      ) &&
      octets[0]! >= 64 &&
      octets[0]! <= 127
    );
  });
}

function containsPersonalAbsolutePath(value: string): boolean {
  return (
    /\b[A-Za-z]:\\Users\\/u.test(value) ||
    /(?:^|\s)\/Users\/[^/\s]+/u.test(value) ||
    /(?:^|\s)\/home\/[^/\s]+/u.test(value)
  );
}
