import fs from "node:fs";
import path from "node:path";
import { defaultNexusHomePath } from "../project/nexusHomeConfig.js";
import { resolveNexusProjectPath } from "../runtime/nexusPathResolver.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
  type NormalizedNexusProjectTrackerDiscoveryPolicy,
} from "../project/nexusProjectConfig.js";
import { resolveNexusCurrentAutomationActor } from "../authority/nexusAuthority.js";
import {
  createHostAuthProfileCredentialBroker,
  NexusProviderCredentialBrokerError,
  type NexusProviderCredentialBroker,
  type NexusProviderCredentialCommandRunner,
} from "../providers/nexusProviderCredentialBroker.js";
import type { NexusHostingAuthProfileConfig } from "../project/nexusProjectHosting.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
  type ResolvedNexusProjectWorkTracker,
} from "../project/nexusProjectLifecycle.js";
import type {
  WorkTrackerCapabilityReport,
  WorkItem,
  WorkStatus,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";
import {
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import {
  openWorkStatuses,
} from "./workTrackingQuery.js";
import {
  loadNexusPublicationAuthProfiles,
  publicationCommandEnvironment,
  resolveNexusPublicationPolicy,
} from "../publication/nexusPublicationPolicy.js";

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

export type NexusWorkItemDiscoveryIgnoredWorkStatus =
  | "readable"
  | "not_checked"
  | "not_readable";

export interface NexusWorkItemDiscoveryIgnoredWorkExample {
  id: string;
  title: string;
  status: WorkStatus;
  linkedCanonical: boolean;
  canonicalReference: NexusWorkItemDiscoveryCanonicalReference | null;
}

export interface NexusWorkItemDiscoveryCanonicalReference {
  trackerId: string;
  itemId: string;
  itemNumber?: number | null;
  itemKey?: string | null;
  webUrl?: string | null;
}

export interface NexusWorkItemDiscoveryIgnoredWork {
  status: NexusWorkItemDiscoveryIgnoredWorkStatus;
  message: string;
  openStatuses: WorkStatus[];
  openCount: number | null;
  linkedCanonicalCount: number | null;
  unlinkedCount: number | null;
  exampleLimit: number;
  examples: NexusWorkItemDiscoveryIgnoredWorkExample[];
  suggestedCommand: string[] | null;
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
  ignoredWork: NexusWorkItemDiscoveryIgnoredWork | null;
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

interface DiscoveryLinkRecordsResult {
  records: DiscoveryLinkRecord[];
  warnings: string[];
}

interface DiscoveryLinkReference {
  trackerId: string;
  itemId: string;
  itemNumber?: number | null;
  itemKey?: string | null;
  webUrl?: string | null;
}

interface DiscoveryLinkRecord {
  projectId: string;
  componentId: string;
  references: DiscoveryLinkReference[];
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
  const linkRecords = loadDiscoveryLinkRecords({
    projectRoot,
    projectId: projectConfig.id,
  });
  const componentStatuses = components.map((component) =>
    componentDiscoveryStatus({
      projectRoot,
      component,
      credentialResolver,
      linkRecords: linkRecords.records,
      now: options.now,
    }),
  );
  const warnings = [
    ...linkRecords.warnings,
    ...componentStatuses.flatMap((component) => component.warnings),
  ];
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

function loadDiscoveryLinkRecords(options: {
  projectRoot: string;
  projectId: string;
}): DiscoveryLinkRecordsResult {
  const storePath = path.join(options.projectRoot, ".dev-nexus", "work-item-links.json");
  if (!fs.existsSync(storePath)) {
    return {
      records: [],
      warnings: [],
    };
  }

  try {
    return {
      records: discoveryLinkRecordsFromJson(
        JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/u, "")),
      ).filter((record) => record.projectId === options.projectId),
      warnings: [],
    };
  } catch (error) {
    return {
      records: [],
      warnings: [
        `Work item tracker links could not be read for ignored-work diagnostics: ${errorMessage(error)}`,
      ],
    };
  }
}

function discoveryLinkRecordsFromJson(value: unknown): DiscoveryLinkRecord[] {
  if (!isRecord(value) || !Array.isArray(value.records)) {
    throw new Error("work-item link store must contain a records array");
  }

  return value.records
    .filter(isRecord)
    .map((record) => ({
      projectId: optionalString(record.projectId) ?? "",
      componentId: optionalString(record.componentId) ?? "",
      references: Array.isArray(record.references)
        ? record.references.filter(isRecord).map(discoveryLinkReferenceFromRecord)
        : [],
    }))
    .filter((record) => record.projectId.length > 0 && record.componentId.length > 0);
}

function discoveryLinkReferenceFromRecord(
  value: Record<string, unknown>,
): DiscoveryLinkReference {
  return {
    trackerId: optionalString(value.trackerId) ?? "",
    itemId: optionalString(value.itemId) ?? "",
    itemNumber: optionalNumber(value.itemNumber),
    itemKey: optionalString(value.itemKey),
    webUrl: optionalString(value.webUrl),
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

function componentDiscoveryStatus(options: {
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  credentialResolver: NexusWorkItemDiscoveryCredentialResolver;
  linkRecords: DiscoveryLinkRecord[];
  now?: Date | string | (() => Date | string);
}): NexusWorkItemDiscoveryComponentStatus {
  const { component } = options;
  const defaultTracker =
    component.defaultTrackerId === null
      ? null
      : component.workTrackers.find(
          (tracker) => tracker.id === component.defaultTrackerId,
        ) ?? null;
  const trackers = component.workTrackers.map((tracker) =>
    trackerDiscoveryStatus({
      projectRoot: options.projectRoot,
      component,
      tracker,
      credentialResolver: options.credentialResolver,
      linkRecords: options.linkRecords,
      now: options.now,
    }),
  );
  const ignoredWorkWarnings = trackers.flatMap((tracker) =>
    ignoredWorkWarning(component, tracker));
  const warnings = trackers
    .filter((tracker) => tracker.selectedForDiscovery && tracker.readable.status === "skipped")
    .map(
      (tracker) =>
        `Component ${component.id} tracker ${tracker.id} skipped: ${tracker.readable.message}`,
    )
    .concat(ignoredWorkWarnings);
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

function trackerDiscoveryStatus(options: {
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  credentialResolver: NexusWorkItemDiscoveryCredentialResolver;
  linkRecords: DiscoveryLinkRecord[];
  now?: Date | string | (() => Date | string);
}): NexusWorkItemDiscoveryTrackerStatus {
  const discoverySelection = trackerDiscoverySelection(
    options.component,
    options.tracker,
  );
  const credentials = options.credentialResolver({
    componentId: options.component.id,
    trackerId: options.tracker.id,
    provider: options.tracker.provider,
    workTracking: options.tracker.workTracking,
  });
  const readable = trackerReadableStatus({
    tracker: options.tracker,
    selectedForDiscovery: discoverySelection.selected,
    policy: options.component.trackerDiscovery,
    credentials,
  });
  const ignoredWork = ignoredTrackerWork({
    ...options,
    selectedForDiscovery: discoverySelection.selected,
    readable,
  });

  return {
    id: options.tracker.id,
    name: options.tracker.name,
    provider: options.tracker.provider,
    enabled: options.tracker.enabled,
    default: options.tracker.default,
    roles: [...options.tracker.roles],
    selectedForDiscovery: discoverySelection.selected,
    discoveryReasons: discoverySelection.reasons,
    capabilityReport: options.tracker.workTrackingCapabilityReport,
    credentials,
    readable,
    ignoredWork,
  };
}

function ignoredTrackerWork(options: {
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  selectedForDiscovery: boolean;
  readable: NexusWorkItemDiscoveryTrackerStatus["readable"];
  linkRecords: DiscoveryLinkRecord[];
  now?: Date | string | (() => Date | string);
}): NexusWorkItemDiscoveryIgnoredWork | null {
  if (options.selectedForDiscovery || !options.tracker.enabled) {
    return null;
  }

  const suggestedCommand = manualMigrationCommand(options.component, options.tracker);
  if (options.readable.status !== "readable") {
    return {
      status: "not_readable",
      message: options.readable.message,
      openStatuses: [...openWorkStatuses],
      openCount: null,
      linkedCanonicalCount: null,
      unlinkedCount: null,
      exampleLimit: 0,
      examples: [],
      suggestedCommand,
    };
  }

  if (options.tracker.workTracking.provider !== "local") {
    return {
      status: "not_checked",
      message:
        "Ignored non-local tracker work is not counted by this synchronous status command; run the suggested manual plan command for provider-backed details.",
      openStatuses: [...openWorkStatuses],
      openCount: null,
      linkedCanonicalCount: null,
      unlinkedCount: null,
      exampleLimit: 0,
      examples: [],
      suggestedCommand,
    };
  }

  try {
    const storePath = resolveLocalWorkTrackingStorePath(
      options.projectRoot,
      options.tracker.workTracking,
    );
    const store = loadLocalWorkTrackingStore(
      storePath,
      currentIso(options.now),
      "work-item discovery-status ignored-work",
    );
    const openItems = store.items.filter((item) =>
      openWorkStatuses.includes(item.status));
    const examples = openItems.slice(0, 5).map((item) =>
      ignoredWorkExample({
        item,
        component: options.component,
        tracker: options.tracker,
        linkRecords: options.linkRecords,
      }),
    );
    const linkedCanonicalCount = openItems.filter((item) =>
      Boolean(canonicalReferenceForItem({
        item,
        component: options.component,
        tracker: options.tracker,
        linkRecords: options.linkRecords,
      })),
    ).length;

    return {
      status: "readable",
      message: openItems.length === 0
        ? "Ignored local tracker has no open work items."
        : "Ignored local tracker contains open work items that normal discovery will not select.",
      openStatuses: [...openWorkStatuses],
      openCount: openItems.length,
      linkedCanonicalCount,
      unlinkedCount: openItems.length - linkedCanonicalCount,
      exampleLimit: 5,
      examples,
      suggestedCommand,
    };
  } catch (error) {
    return {
      status: "not_readable",
      message: errorMessage(error),
      openStatuses: [...openWorkStatuses],
      openCount: null,
      linkedCanonicalCount: null,
      unlinkedCount: null,
      exampleLimit: 0,
      examples: [],
      suggestedCommand,
    };
  }
}

function ignoredWorkExample(options: {
  item: WorkItem;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  linkRecords: DiscoveryLinkRecord[];
}): NexusWorkItemDiscoveryIgnoredWorkExample {
  const canonicalReference = canonicalReferenceForItem(options);
  return {
    id: options.item.id,
    title: options.item.title,
    status: options.item.status,
    linkedCanonical: Boolean(canonicalReference),
    canonicalReference: canonicalReference
      ? {
          trackerId: canonicalReference.trackerId,
          itemId: canonicalReference.itemId,
          itemNumber: canonicalReference.itemNumber,
          itemKey: canonicalReference.itemKey,
          webUrl: canonicalReference.webUrl,
        }
      : null,
  };
}

function canonicalReferenceForItem(options: {
  item: WorkItem;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  linkRecords: DiscoveryLinkRecord[];
}): DiscoveryLinkReference | null {
  const defaultTrackerId = options.component.defaultTrackerId;
  if (!defaultTrackerId || defaultTrackerId === options.tracker.id) {
    return null;
  }
  const record = options.linkRecords.find((candidate) =>
    candidate.componentId === options.component.id &&
    candidate.references.some((reference) =>
      reference.trackerId === options.tracker.id &&
      referenceMatchesWorkItem(reference, options.item)
    ));
  return record?.references.find((reference) =>
    reference.trackerId === defaultTrackerId) ?? null;
}

function referenceMatchesWorkItem(
  reference: DiscoveryLinkReference,
  item: WorkItem,
): boolean {
  const itemReference = item.externalRef;
  return (
    reference.itemId === item.id ||
    (itemReference?.itemId !== undefined &&
      reference.itemId === itemReference.itemId) ||
    (itemReference?.itemNumber !== undefined &&
      reference.itemNumber === itemReference.itemNumber) ||
    (itemReference?.itemKey !== undefined &&
      reference.itemKey === itemReference.itemKey)
  );
}

function manualMigrationCommand(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): string[] | null {
  const targetTracker = component.defaultTrackerId
    ? component.workTrackers.find((candidate) =>
        candidate.id === component.defaultTrackerId)
    : null;
  if (!targetTracker || targetTracker.id === tracker.id) {
    return null;
  }

  const command = tracker.workTracking.provider === "local" &&
    targetTracker.workTracking.provider !== "local"
    ? "sync-plan"
    : targetTracker.workTracking.provider === "local" &&
        tracker.workTracking.provider !== "local"
      ? "import-plan"
      : "sync-plan";

  return [
    "dev-nexus",
    "work-item",
    command,
    "<workspace-root>",
    "--component",
    component.id,
    "--source-tracker",
    tracker.id,
    "--target-tracker",
    targetTracker.id,
    ...openStatusCommandArgs(command),
  ];
}

function openStatusCommandArgs(command: "sync-plan" | "import-plan"): string[] {
  if (command === "sync-plan") {
    return ["--open"];
  }

  return openWorkStatuses.flatMap((status) => ["--status", status]);
}

function ignoredWorkWarning(
  component: ResolvedNexusProjectComponent,
  tracker: NexusWorkItemDiscoveryTrackerStatus,
): string[] {
  const ignoredWork = tracker.ignoredWork;
  if (!ignoredWork || ignoredWork.openCount === null || ignoredWork.openCount === 0) {
    return [];
  }
  const command = ignoredWork.suggestedCommand?.join(" ") ?? null;
  return [
    [
      `Component ${component.id} tracker ${tracker.id} ignored: ${ignoredWork.openCount} open item(s) are not selected for discovery.`,
      `linkedCanonical=${ignoredWork.linkedCanonicalCount ?? 0}`,
      `unlinked=${ignoredWork.unlinkedCount ?? 0}.`,
      command ? `Review manually with: ${command}` : null,
    ].filter((part): part is string => part !== null).join(" "),
  ];
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
    repository: component.remoteUrl,
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

function currentIso(
  now: Date | string | (() => Date | string) | undefined,
): string {
  const value = typeof now === "function" ? now() : now;
  if (typeof value === "string") {
    return value;
  }
  return (value ?? new Date()).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
