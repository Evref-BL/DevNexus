import type { NexusForgeRepositoryRef } from "./nexusForgePublication.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";

export interface NexusGitHubRepositorySelection {
  owner: string;
  name: string;
  host: string | null;
  trackerId: string;
}

export function selectNexusGitHubPrimaryTracker(
  component: ResolvedNexusProjectComponent,
  context: string,
): ResolvedNexusProjectWorkTracker {
  const tracker =
    component.workTrackers.find(
      (candidate) =>
        candidate.id === component.defaultTrackerId &&
        candidate.provider === "github",
    ) ??
    component.workTrackers.find(
      (candidate) =>
        candidate.default && candidate.provider === "github",
    ) ??
    component.workTrackers.find(
      (candidate) =>
        candidate.roles.includes("primary") && candidate.provider === "github",
    );
  if (!tracker) {
    throw new Error(
      `Component ${component.id} does not have a GitHub primary/default tracker for ${context}.`,
    );
  }

  return tracker;
}

export function resolveNexusGitHubRepository(
  tracker: ResolvedNexusProjectWorkTracker,
  context: string,
): NexusGitHubRepositorySelection {
  const workTracking = tracker.workTracking;
  if (workTracking.provider !== "github") {
    throw new Error(`Tracker ${tracker.id} is not a GitHub tracker.`);
  }
  if (!workTracking.repository?.owner || !workTracking.repository.name) {
    throw new Error(
      `Tracker ${tracker.id} must configure a GitHub repository owner and name for ${context}.`,
    );
  }

  return {
    owner: workTracking.repository.owner,
    name: workTracking.repository.name,
    host: workTracking.host ?? "github.com",
    trackerId: tracker.id,
  };
}

export function resolveNexusGitHubRepositoryFromRemoteUrl(
  remoteUrl: string | null | undefined,
  context: string,
  options: { trackerId?: string } = {},
): NexusGitHubRepositorySelection {
  const parsed = parseGitHubRemoteUrl(remoteUrl);
  if (!parsed) {
    throw new Error(`Project repository remote must be a GitHub URL for ${context}.`);
  }

  return {
    owner: parsed.owner,
    name: parsed.name,
    host: parsed.host,
    trackerId: options.trackerId ?? "project",
  };
}

export function nexusForgeRepositoryFromGitHubRepository(
  repository: NexusGitHubRepositorySelection,
): NexusForgeRepositoryRef {
  return {
    provider: "github",
    owner: repository.owner,
    name: repository.name,
    host: repository.host,
  };
}

function parseGitHubRemoteUrl(
  remoteUrl: string | null | undefined,
): { host: string; owner: string; name: string } | null {
  const normalized = remoteUrl?.trim();
  if (!normalized) {
    return null;
  }

  const scp = /^(?:[^@]+@)?([^:]+):([^/]+)\/(.+)$/u.exec(normalized);
  if (scp) {
    return normalizeGitHubRepositoryParts(scp[1]!, scp[2]!, scp[3]!);
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "ssh:") {
      return null;
    }
    const [owner, name, ...extra] = url.pathname.replace(/^\/+/u, "").split("/");
    if (extra.length > 0) {
      return null;
    }
    return normalizeGitHubRepositoryParts(url.hostname, owner, name);
  } catch {
    return null;
  }
}

function normalizeGitHubRepositoryParts(
  host: string | undefined,
  owner: string | undefined,
  name: string | undefined,
): { host: string; owner: string; name: string } | null {
  const normalizedHost = host?.trim() || "github.com";
  const normalizedOwner = owner?.trim();
  const normalizedName = name?.trim().replace(/\.git$/u, "");
  if (!normalizedOwner || !normalizedName || normalizedName.includes("/")) {
    return null;
  }

  return {
    host: normalizedHost,
    owner: normalizedOwner,
    name: normalizedName,
  };
}
