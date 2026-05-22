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
