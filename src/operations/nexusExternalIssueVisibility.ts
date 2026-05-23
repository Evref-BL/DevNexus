import type {
  NexusAutomationComponentEligibleWorkItems,
} from "../automation/nexusAutomationEligibleWorkItems.js";
import type { NexusEligibleWorkItem } from "../work-items/nexusEligibleWork.js";
import {
  nexusWorkItemDiscoveryTrackerSelection,
  type NexusWorkItemDiscoveryComponentStatus,
  type NexusWorkItemDiscoveryStatus,
  type NexusWorkItemDiscoveryTrackerStatus,
} from "../work-items/nexusWorkItemDiscoveryStatus.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "../project/nexusProjectLifecycle.js";
import type { WorkItem } from "../work-items/workTrackingTypes.js";

export type NexusExternalIssueVisibilityMode =
  | "default_tracker_only"
  | "external_ignored"
  | "external_import_required"
  | "external_direct_selectable";

export interface NexusExternalIssueVisibilityComponentSummary {
  componentId: string;
  componentName: string;
  mode: NexusExternalIssueVisibilityMode;
  summary: string;
  sourceRoles: string[];
  defaultTrackerId: string | null;
  configuredTrackerCount: number;
  selectedTrackerCount: number;
  ignoredTrackerCount: number;
  selectedExternalTrackerCount: number;
  importOnlyWorkItemCount: number;
  providerAccessWarningCount: number;
  providerAccessBlockerCount: number;
  providerAccessWarnings: string[];
  providerAccessBlockers: string[];
}

export interface NexusExternalIssueVisibilitySummary {
  summary: string;
  componentCount: number;
  defaultTrackerOnlyComponentCount: number;
  externalIgnoredComponentCount: number;
  importRequiredComponentCount: number;
  directSelectableComponentCount: number;
  selectedTrackerCount: number;
  ignoredTrackerCount: number;
  importOnlyWorkItemCount: number;
  providerAccessWarningCount: number;
  providerAccessBlockerCount: number;
  components: NexusExternalIssueVisibilityComponentSummary[];
}

export interface BuildNexusExternalIssueVisibilitySummaryOptions {
  components: ResolvedNexusProjectComponent[];
  componentEligibleWorkItems?: NexusAutomationComponentEligibleWorkItems[] | null;
  discoveryStatus?: NexusWorkItemDiscoveryStatus | null;
}

export function buildNexusExternalIssueVisibilitySummary(
  options: BuildNexusExternalIssueVisibilitySummaryOptions,
): NexusExternalIssueVisibilitySummary {
  const eligibleByComponent = new Map(
    (options.componentEligibleWorkItems ?? []).map((component) => [
      component.componentId,
      component,
    ]),
  );
  const discoveryByComponent = new Map(
    (options.discoveryStatus?.components ?? []).map((component) => [
      component.componentId,
      component,
    ]),
  );
  const components = options.components.map((component) =>
    componentVisibilitySummary({
      component,
      eligible: eligibleByComponent.get(component.id) ?? null,
      discovery: discoveryByComponent.get(component.id) ?? null,
    }),
  );

  const defaultTrackerOnlyComponentCount = countMode(
    components,
    "default_tracker_only",
  );
  const externalIgnoredComponentCount = countMode(components, "external_ignored");
  const importRequiredComponentCount = countMode(
    components,
    "external_import_required",
  );
  const directSelectableComponentCount = countMode(
    components,
    "external_direct_selectable",
  );
  const selectedTrackerCount = sum(components, "selectedTrackerCount");
  const ignoredTrackerCount = sum(components, "ignoredTrackerCount");
  const importOnlyWorkItemCount = sum(components, "importOnlyWorkItemCount");
  const providerAccessWarningCount = sum(
    components,
    "providerAccessWarningCount",
  );
  const providerAccessBlockerCount = sum(
    components,
    "providerAccessBlockerCount",
  );

  return {
    summary: [
      `${defaultTrackerOnlyComponentCount} default-only`,
      `${importRequiredComponentCount} import-required`,
      `${directSelectableComponentCount} direct-selectable`,
      `${externalIgnoredComponentCount} external-ignored`,
      `${importOnlyWorkItemCount} import-only item(s)`,
      `${providerAccessWarningCount + providerAccessBlockerCount} provider access issue(s)`,
    ].join("; "),
    componentCount: components.length,
    defaultTrackerOnlyComponentCount,
    externalIgnoredComponentCount,
    importRequiredComponentCount,
    directSelectableComponentCount,
    selectedTrackerCount,
    ignoredTrackerCount,
    importOnlyWorkItemCount,
    providerAccessWarningCount,
    providerAccessBlockerCount,
    components,
  };
}

function componentVisibilitySummary(options: {
  component: ResolvedNexusProjectComponent;
  eligible: NexusAutomationComponentEligibleWorkItems | null;
  discovery: NexusWorkItemDiscoveryComponentStatus | null;
}): NexusExternalIssueVisibilityComponentSummary {
  const trackerStatuses =
    options.discovery?.configuredTrackers ??
    options.component.workTrackers.map((tracker) =>
      staticTrackerStatus(options.component, tracker),
    );
  const selectedTrackerCount = trackerStatuses.filter(
    (tracker) => tracker.selectedForDiscovery,
  ).length;
  const ignoredTrackerCount = trackerStatuses.filter(
    (tracker) => !tracker.selectedForDiscovery,
  ).length;
  const selectedExternalTrackerCount = trackerStatuses.filter(
    (tracker) => tracker.selectedForDiscovery && !tracker.default,
  ).length;
  const importOnlyWorkItemCount = importOnlyCount(options.eligible);
  const providerAccessWarnings = trackerStatuses.flatMap((tracker) =>
    providerAccessWarning(tracker),
  );
  const providerAccessBlockers = trackerStatuses.flatMap((tracker) =>
    providerAccessBlocker(tracker),
  );
  const mode = componentVisibilityMode({
    component: options.component,
    selectedExternalTrackerCount,
  });

  return {
    componentId: options.component.id,
    componentName: options.component.name,
    mode,
    summary: componentSummary({
      mode,
      selectedTrackerCount,
      ignoredTrackerCount,
      importOnlyWorkItemCount,
      providerAccessIssueCount:
        providerAccessWarnings.length + providerAccessBlockers.length,
    }),
    sourceRoles: [...options.component.trackerDiscovery.scannedRoles],
    defaultTrackerId: options.component.defaultTrackerId,
    configuredTrackerCount: trackerStatuses.length,
    selectedTrackerCount,
    ignoredTrackerCount,
    selectedExternalTrackerCount,
    importOnlyWorkItemCount,
    providerAccessWarningCount: providerAccessWarnings.length,
    providerAccessBlockerCount: providerAccessBlockers.length,
    providerAccessWarnings,
    providerAccessBlockers,
  };
}

function staticTrackerStatus(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): Pick<
  NexusWorkItemDiscoveryTrackerStatus,
  | "id"
  | "provider"
  | "default"
  | "selectedForDiscovery"
  | "credentials"
  | "readable"
> {
  const selection = nexusWorkItemDiscoveryTrackerSelection(component, tracker);
  return {
    id: tracker.id,
    provider: tracker.provider,
    default: tracker.default,
    selectedForDiscovery: selection.selected,
    credentials: {
      status: tracker.provider === "local" ? "not_required" : "missing",
      required: tracker.provider !== "local",
      message:
        tracker.provider === "local"
          ? "Local tracker files are readable without provider credentials."
          : "Provider credentials were not checked for this summary.",
    },
    readable: {
      status: selection.selected ? "readable" : "skipped",
      message: selection.reasons.join("; "),
    },
  };
}

function componentVisibilityMode(options: {
  component: ResolvedNexusProjectComponent;
  selectedExternalTrackerCount: number;
}): NexusExternalIssueVisibilityMode {
  const policy = options.component.trackerDiscovery;
  if (policy.defaultTrackerOnly) {
    return "default_tracker_only";
  }
  if (options.selectedExternalTrackerCount === 0) {
    return "external_ignored";
  }
  if (policy.directExternalSelection === "allowed" && !policy.importRequiredFirst) {
    return "external_direct_selectable";
  }
  return "external_import_required";
}

function componentSummary(options: {
  mode: NexusExternalIssueVisibilityMode;
  selectedTrackerCount: number;
  ignoredTrackerCount: number;
  importOnlyWorkItemCount: number;
  providerAccessIssueCount: number;
}): string {
  const modeText: Record<NexusExternalIssueVisibilityMode, string> = {
    default_tracker_only: "default tracker only",
    external_ignored: "external trackers ignored",
    external_import_required: "external trackers require import",
    external_direct_selectable: "external trackers directly selectable",
  };
  return `${modeText[options.mode]}; selected=${options.selectedTrackerCount}; ignored=${options.ignoredTrackerCount}; import-only=${options.importOnlyWorkItemCount}; provider-access=${options.providerAccessIssueCount}`;
}

function importOnlyCount(
  eligible: NexusAutomationComponentEligibleWorkItems | null,
): number {
  if (!eligible) {
    return 0;
  }
  const workItems = eligible.workItems as Array<WorkItem & Partial<NexusEligibleWorkItem>>;
  const importCandidates =
    eligible.importCandidateWorkItems as Array<Partial<NexusEligibleWorkItem>> | undefined;
  return (
    workItems.filter((item) => item.importOnly).length +
    (importCandidates ?? []).filter((item) => item.importOnly ?? true).length
  );
}

function providerAccessWarning(
  tracker: Pick<
    NexusWorkItemDiscoveryTrackerStatus,
    "id" | "provider" | "selectedForDiscovery" | "credentials" | "readable"
  >,
): string[] {
  if (!tracker.selectedForDiscovery || tracker.readable.status !== "skipped") {
    return [];
  }
  return [providerAccessMessage(tracker, "warning")];
}

function providerAccessBlocker(
  tracker: Pick<
    NexusWorkItemDiscoveryTrackerStatus,
    "id" | "provider" | "selectedForDiscovery" | "credentials" | "readable"
  >,
): string[] {
  if (!tracker.selectedForDiscovery || tracker.readable.status !== "blocked") {
    return [];
  }
  return [providerAccessMessage(tracker, "blocker")];
}

function providerAccessMessage(
  tracker: Pick<
    NexusWorkItemDiscoveryTrackerStatus,
    "id" | "provider" | "credentials" | "readable"
  >,
  severity: "warning" | "blocker",
): string {
  const credentialStatus =
    tracker.credentials.status === "missing"
      ? "missing credentials"
      : tracker.readable.status.replace(/_/gu, " ");
  return `Tracker ${tracker.id} (${tracker.provider}) ${severity}: ${credentialStatus}.`;
}

function countMode(
  components: NexusExternalIssueVisibilityComponentSummary[],
  mode: NexusExternalIssueVisibilityMode,
): number {
  return components.filter((component) => component.mode === mode).length;
}

function sum(
  components: NexusExternalIssueVisibilityComponentSummary[],
  key: keyof Pick<
    NexusExternalIssueVisibilityComponentSummary,
    | "selectedTrackerCount"
    | "ignoredTrackerCount"
    | "importOnlyWorkItemCount"
    | "providerAccessWarningCount"
    | "providerAccessBlockerCount"
  >,
): number {
  return components.reduce((total, component) => total + component[key], 0);
}
