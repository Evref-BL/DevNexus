import path from "node:path";
import {
  loadProjectConfig,
  type NormalizedNexusProjectTrackerDiscoveryPolicy,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
  type ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import type {
  WorkTrackerCapabilityReport,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export type NexusWorkItemDiscoveryCredentialStatus =
  | "not_required"
  | "available"
  | "missing";

export type NexusWorkItemDiscoveryReadableStatus =
  | "readable"
  | "not_readable"
  | "skipped"
  | "blocked"
  | "disabled";

export interface NexusWorkItemDiscoveryCredentialCheckInput {
  componentId: string;
  trackerId: string;
  provider: string;
  workTracking: WorkTrackingConfig;
}

export interface NexusWorkItemDiscoveryCredentialCheck {
  status: NexusWorkItemDiscoveryCredentialStatus;
  required: boolean;
  message: string;
}

export type NexusWorkItemDiscoveryCredentialResolver = (
  input: NexusWorkItemDiscoveryCredentialCheckInput,
) => NexusWorkItemDiscoveryCredentialCheck;

export interface GetNexusWorkItemDiscoveryStatusOptions {
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  credentialResolver?: NexusWorkItemDiscoveryCredentialResolver;
}

export interface NexusWorkItemDiscoveryTrackerStatus {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  default: boolean;
  roles: string[];
  selectedForDiscovery: boolean;
  discoveryReasons: string[];
  capabilityReport: WorkTrackerCapabilityReport;
  credentials: NexusWorkItemDiscoveryCredentialCheck;
  readable: {
    status: NexusWorkItemDiscoveryReadableStatus;
    message: string;
  };
}

export interface NexusWorkItemDiscoveryComponentStatus {
  componentId: string;
  componentName: string;
  role: string;
  sourceRoot: string;
  defaultTracker: {
    id: string;
    name: string;
    provider: string;
  } | null;
  effectiveDiscoveryPolicy: NormalizedNexusProjectTrackerDiscoveryPolicy;
  configuredTrackers: NexusWorkItemDiscoveryTrackerStatus[];
  discoveryTrackerIds: string[];
  warnings: string[];
  blockers: string[];
}

export interface NexusWorkItemDiscoveryStatus {
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  components: NexusWorkItemDiscoveryComponentStatus[];
  warnings: string[];
  blockers: string[];
  summary: string;
}

export function getNexusWorkItemDiscoveryStatus(
  options: GetNexusWorkItemDiscoveryStatusOptions,
): NexusWorkItemDiscoveryStatus {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const credentialResolver =
    options.credentialResolver ?? defaultCredentialResolver(options.env ?? process.env);
  const componentStatuses = components.map((component) =>
    componentDiscoveryStatus(component, credentialResolver),
  );
  const warnings = componentStatuses.flatMap((component) => component.warnings);
  const blockers = componentStatuses.flatMap((component) => component.blockers);

  return {
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    components: componentStatuses,
    warnings,
    blockers,
    summary:
      blockers.length > 0
        ? `Tracker discovery status has ${blockers.length} blocker(s)`
        : `Tracker discovery status reported ${warnings.length} warning(s)`,
  };
}

function componentDiscoveryStatus(
  component: ResolvedNexusProjectComponent,
  credentialResolver: NexusWorkItemDiscoveryCredentialResolver,
): NexusWorkItemDiscoveryComponentStatus {
  const defaultTracker =
    component.defaultTrackerId === null
      ? null
      : component.workTrackers.find(
          (tracker) => tracker.id === component.defaultTrackerId,
        ) ?? null;
  const trackers = component.workTrackers.map((tracker) =>
    trackerDiscoveryStatus(component, tracker, credentialResolver),
  );
  const warnings = trackers
    .filter((tracker) => tracker.selectedForDiscovery && tracker.readable.status === "skipped")
    .map(
      (tracker) =>
        `Component ${component.id} tracker ${tracker.id} skipped: ${tracker.readable.message}`,
    );
  const blockers = trackers
    .filter((tracker) => tracker.selectedForDiscovery && tracker.readable.status === "blocked")
    .map(
      (tracker) =>
        `Component ${component.id} tracker ${tracker.id} blocked: ${tracker.readable.message}`,
    );

  return {
    componentId: component.id,
    componentName: component.name,
    role: component.role,
    sourceRoot: component.sourceRoot,
    defaultTracker: defaultTracker
      ? {
          id: defaultTracker.id,
          name: defaultTracker.name,
          provider: defaultTracker.provider,
        }
      : null,
    effectiveDiscoveryPolicy: component.trackerDiscovery,
    configuredTrackers: trackers,
    discoveryTrackerIds: trackers
      .filter((tracker) => tracker.selectedForDiscovery)
      .map((tracker) => tracker.id),
    warnings,
    blockers,
  };
}

function trackerDiscoveryStatus(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
  credentialResolver: NexusWorkItemDiscoveryCredentialResolver,
): NexusWorkItemDiscoveryTrackerStatus {
  const discoverySelection = trackerDiscoverySelection(component, tracker);
  const credentials = credentialResolver({
    componentId: component.id,
    trackerId: tracker.id,
    provider: tracker.provider,
    workTracking: tracker.workTracking,
  });
  const readable = trackerReadableStatus({
    tracker,
    selectedForDiscovery: discoverySelection.selected,
    policy: component.trackerDiscovery,
    credentials,
  });

  return {
    id: tracker.id,
    name: tracker.name,
    provider: tracker.provider,
    enabled: tracker.enabled,
    default: tracker.default,
    roles: [...tracker.roles],
    selectedForDiscovery: discoverySelection.selected,
    discoveryReasons: discoverySelection.reasons,
    capabilityReport: tracker.workTrackingCapabilityReport,
    credentials,
    readable,
  };
}

function trackerDiscoverySelection(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): { selected: boolean; reasons: string[] } {
  const policy = component.trackerDiscovery;
  const reasons: string[] = [];
  if (!tracker.enabled) {
    return { selected: false, reasons: ["tracker disabled"] };
  }
  if (
    policy.providerFilters.length > 0 &&
    !policy.providerFilters.includes(tracker.workTracking.provider)
  ) {
    return { selected: false, reasons: ["provider filtered out"] };
  }
  if (policy.defaultTrackerOnly) {
    return tracker.default
      ? { selected: true, reasons: ["default tracker policy"] }
      : { selected: false, reasons: ["default tracker policy excludes tracker"] };
  }

  const scannedRoles = new Set(policy.scannedRoles);
  const matchedRoles = tracker.roles.filter((role) => scannedRoles.has(role));
  if (matchedRoles.length === 0) {
    return { selected: false, reasons: ["no scanned role"] };
  }

  reasons.push(...matchedRoles.map((role) => `role ${role}`));
  return { selected: true, reasons };
}

function trackerReadableStatus(options: {
  tracker: ResolvedNexusProjectWorkTracker;
  selectedForDiscovery: boolean;
  policy: NormalizedNexusProjectTrackerDiscoveryPolicy;
  credentials: NexusWorkItemDiscoveryCredentialCheck;
}): NexusWorkItemDiscoveryTrackerStatus["readable"] {
  if (!options.tracker.enabled) {
    return {
      status: "disabled",
      message: "Tracker binding is disabled.",
    };
  }
  if (!options.tracker.workTrackingCapabilityReport.capabilities.list) {
    return {
      status: options.selectedForDiscovery ? "blocked" : "not_readable",
      message: "Provider does not support listing work items.",
    };
  }
  if (options.credentials.status === "missing") {
    if (!options.selectedForDiscovery) {
      return {
        status: "not_readable",
        message: options.credentials.message,
      };
    }
    if (options.policy.missingCredentialBehavior === "skip") {
      return {
        status: "skipped",
        message: options.credentials.message,
      };
    }

    return {
      status: "blocked",
      message: options.credentials.message,
    };
  }

  return {
    status: "readable",
    message: options.credentials.message,
  };
}

function defaultCredentialResolver(
  env: NodeJS.ProcessEnv,
): NexusWorkItemDiscoveryCredentialResolver {
  return (input) => {
    if (input.provider === "local") {
      return {
        status: "not_required",
        required: false,
        message: "Local tracker files are readable without provider credentials.",
      };
    }
    if (providerEnvironmentCredentialAvailable(input.provider, env)) {
      return {
        status: "available",
        required: true,
        message: `Provider credentials are available for ${input.provider}.`,
      };
    }

    return {
      status: "missing",
      required: true,
      message: `No configured ${input.provider} credentials were detected for read-only discovery.`,
    };
  };
}

function providerEnvironmentCredentialAvailable(
  provider: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (provider === "github") {
    return nonEmpty(env.GITHUB_TOKEN) || nonEmpty(env.GH_TOKEN);
  }
  if (provider === "gitlab") {
    return nonEmpty(env.GITLAB_TOKEN) || nonEmpty(env.GL_TOKEN);
  }
  if (provider === "jira") {
    return (
      nonEmpty(env.JIRA_TOKEN) ||
      (nonEmpty(env.JIRA_EMAIL) && nonEmpty(env.JIRA_API_TOKEN)) ||
      (nonEmpty(env.ATLASSIAN_EMAIL) && nonEmpty(env.ATLASSIAN_API_TOKEN))
    );
  }

  return false;
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
