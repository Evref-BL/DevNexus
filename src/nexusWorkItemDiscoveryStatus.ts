import path from "node:path";
import { defaultNexusHomePath } from "./nexusHomeConfig.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
  type NormalizedNexusProjectTrackerDiscoveryPolicy,
} from "./nexusProjectConfig.js";
import { resolveNexusCurrentAutomationActor } from "./nexusAuthority.js";
import {
  createHostAuthProfileCredentialBroker,
  NexusProviderCredentialBrokerError,
  type NexusProviderCredentialBroker,
  type NexusProviderCredentialCommandRunner,
} from "./nexusProviderCredentialBroker.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
  type ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import type {
  WorkTrackerCapabilityReport,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";
import {
  loadNexusPublicationAuthProfiles,
  publicationCommandEnvironment,
  resolveNexusPublicationPolicy,
} from "./nexusPublicationPolicy.js";

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

export interface NexusWorkItemDiscoveryTrackerSelection {
  selected: boolean;
  reasons: string[];
}

export interface GetNexusWorkItemDiscoveryStatusOptions {
  projectRoot: string;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date | string | (() => Date | string);
  authProfiles?: NexusHostingAuthProfileConfig[];
  credentialBroker?: NexusProviderCredentialBroker;
  credentialCommandRunner?: NexusProviderCredentialCommandRunner;
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
  const homePath = resolveDiscoveryHomePath({
    projectRoot,
    projectConfig,
    homePath: options.homePath,
  });
  const env = nexusWorkItemDiscoveryCredentialEnvironment({
    projectRoot,
    projectConfig,
    env: options.env,
  });
  const authProfiles =
    options.authProfiles ??
    loadNexusPublicationAuthProfiles({
      projectRoot,
      projectConfig,
      homePath,
    });
  const credentialBroker =
    options.credentialBroker ??
    (authProfiles.length > 0
      ? createHostAuthProfileCredentialBroker({
          authProfiles,
          projectRoot,
          homePath,
          env,
          now: options.now,
          ...(options.credentialCommandRunner
            ? { commandRunner: options.credentialCommandRunner }
            : {}),
        })
      : undefined);
  const credentialResolver =
    options.credentialResolver ??
    defaultNexusWorkItemDiscoveryCredentialResolver({
      env,
      projectRoot,
      projectConfig,
      components,
      authProfiles,
      credentialBroker,
    });
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

export function nexusWorkItemDiscoveryCredentialEnvironment(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  return {
    ...(options.env ?? process.env),
    ...(options.projectConfig.automation
      ? publicationCommandEnvironment(options.projectConfig.automation.publication, {
          projectRoot: options.projectRoot,
        })
      : {}),
  };
}

function resolveDiscoveryHomePath(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): string {
  if (options.homePath?.trim()) {
    return path.resolve(options.homePath);
  }
  if (options.projectConfig.home?.trim()) {
    return resolveNexusProjectPath({
      projectRoot: options.projectRoot,
      value: options.projectConfig.home,
    });
  }

  return defaultNexusHomePath();
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
): NexusWorkItemDiscoveryTrackerSelection {
  return nexusWorkItemDiscoveryTrackerSelection(component, tracker);
}

export function nexusWorkItemDiscoveryTrackerSelection(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): NexusWorkItemDiscoveryTrackerSelection {
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

export function defaultNexusWorkItemDiscoveryCredentialResolver(
  input: NodeJS.ProcessEnv | {
    env: NodeJS.ProcessEnv;
    projectRoot?: string;
    projectConfig?: NexusProjectConfig;
    components?: ResolvedNexusProjectComponent[];
    authProfiles?: NexusHostingAuthProfileConfig[];
    credentialBroker?: NexusProviderCredentialBroker;
  },
): NexusWorkItemDiscoveryCredentialResolver {
  const options = isCredentialResolverOptions(input) ? input : { env: input };
  return (input) => {
    if (input.provider === "local") {
      return {
        status: "not_required",
        required: false,
        message: "Local tracker files are readable without provider credentials.",
      };
    }
    if (providerEnvironmentCredentialAvailable(input.provider, options.env)) {
      return {
        status: "available",
        required: true,
        message: `Provider credentials are available for ${input.provider}.`,
      };
    }
    const brokerCredential = providerBrokerCredentialAvailable(input, options);
    if (brokerCredential) {
      return brokerCredential;
    }

    return {
      status: "missing",
      required: true,
      message: `No configured ${input.provider} credentials were detected for read-only discovery.`,
    };
  };
}

function isCredentialResolverOptions(
  input: NodeJS.ProcessEnv | {
    env: NodeJS.ProcessEnv;
  },
): input is { env: NodeJS.ProcessEnv } {
  return "env" in input && typeof input.env === "object";
}

function providerBrokerCredentialAvailable(
  input: NexusWorkItemDiscoveryCredentialCheckInput,
  options: {
    projectRoot?: string;
    projectConfig?: NexusProjectConfig;
    components?: ResolvedNexusProjectComponent[];
    authProfiles?: NexusHostingAuthProfileConfig[];
    credentialBroker?: NexusProviderCredentialBroker;
  },
): NexusWorkItemDiscoveryCredentialCheck | null {
  if (!options.credentialBroker) {
    return null;
  }
  const currentActor = discoveryCredentialCurrentActor(input, options);
  try {
    const credential = options.credentialBroker.resolveCredential({
      provider: input.provider,
      purpose: "api",
      host: input.workTracking.host ?? null,
      profileId: currentActor.profileId,
      actorId: currentActor.actorId,
      providerIdentity: currentActor.providerIdentity,
      repository: input.workTracking.repository ?? null,
    });
    return {
      status: "available",
      required: true,
      message:
        `Provider credentials are available for ${input.provider} ` +
        `through auth profile ${credential.profileId}.`,
    };
  } catch (error) {
    if (
      error instanceof NexusProviderCredentialBrokerError &&
      error.code === "async_required"
    ) {
      return {
        status: "available",
        required: true,
        message:
          `Provider credentials are configured for ${input.provider}; ` +
          "token exchange runs asynchronously when the provider is used.",
      };
    }
    if (
      error instanceof NexusProviderCredentialBrokerError &&
      error.code !== "missing_profile" &&
      error.code !== "wrong_actor"
    ) {
      return {
        status: "missing",
        required: true,
        message:
          `Configured ${input.provider} credentials are not usable: ` +
          error.message,
      };
    }
  }

  return null;
}

function discoveryCredentialCurrentActor(
  input: NexusWorkItemDiscoveryCredentialCheckInput,
  options: {
    projectConfig?: NexusProjectConfig;
    components?: ResolvedNexusProjectComponent[];
    authProfiles?: NexusHostingAuthProfileConfig[];
  },
): {
  profileId: string | null;
  actorId: string | null;
  providerIdentity: string | null;
} {
  const projectConfig = options.projectConfig;
  const component = options.components?.find(
    (candidate) => candidate.id === input.componentId,
  );
  if (!projectConfig || !component) {
    return { profileId: null, actorId: null, providerIdentity: null };
  }
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: projectConfig.authority,
    componentId: component.id,
    publication,
    authProfiles: options.authProfiles ?? [],
  });
  return {
    profileId: currentActor.profileId,
    actorId: currentActor.expectedActorId,
    providerIdentity: currentActor.expectedHandle,
  };
}

function providerEnvironmentCredentialAvailable(
  provider: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (provider === "github") {
    return (
      nonEmpty(env.GITHUB_TOKEN) ||
      nonEmpty(env.GH_TOKEN) ||
      nonEmpty(env.GH_CONFIG_DIR)
    );
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
