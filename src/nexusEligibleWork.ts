import path from "node:path";
import { eligibleNexusAutomationWorkItems } from "./nexusAutomation.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import {
  defaultNexusWorkItemDiscoveryCredentialResolver,
  nexusWorkItemDiscoveryTrackerSelection,
  type NexusWorkItemDiscoveryCredentialCheck,
  type NexusWorkItemDiscoveryCredentialResolver,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  type WorkItemTrackerLinkRecord,
  type WorkItemTrackerReference,
} from "./workItemTrackerLinks.js";
import type {
  ExternalRef,
  WorkItem,
  WorkItemQuery,
  WorkStatus,
  WorkTrackerProvider,
  WorkTrackerRef,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export type NexusEligibleWorkMode = "default" | "discovery";

export interface NexusEligibleWorkProviderContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  workTracking: WorkTrackingConfig;
}

export type NexusEligibleWorkProviderFactory = (
  context: NexusEligibleWorkProviderContext,
) => WorkTrackerProvider;

export interface ListNexusEligibleWorkOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  automationConfig: NexusAutomationConfig;
  selectorQuery: WorkItemQuery;
  mode?: NexusEligibleWorkMode;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusEligibleWorkProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  credentialResolver?: NexusWorkItemDiscoveryCredentialResolver;
  env?: NodeJS.ProcessEnv;
  now?: () => Date | string;
}

export interface NexusEligibleWorkTrackerQueryResult {
  trackerId: string;
  trackerName: string;
  provider: string;
  selected: boolean;
  selectableCount: number;
  importCandidateCount: number;
  warnings: string[];
  blockers: string[];
}

export interface NexusEligibleWorkItem extends WorkItem {
  componentId: string;
  logicalItemId: string | null;
  canonicalTrackerRef: WorkTrackerRef | null;
  sourceTrackerRef: WorkTrackerRef | null;
  warnings: string[];
  selectable: boolean;
  importOnly: boolean;
}

export interface NexusEligibleWorkComponentResult {
  componentId: string;
  workItems: NexusEligibleWorkItem[];
  importCandidateWorkItems: NexusEligibleWorkItem[];
  finalLimit: number | null;
  warnings: string[];
  blockers: string[];
  trackerResults: NexusEligibleWorkTrackerQueryResult[];
}

export interface NexusEligibleWorkResult {
  mode: NexusEligibleWorkMode;
  componentEligibleWorkItems: NexusEligibleWorkComponentResult[];
  eligibleWorkItems: NexusEligibleWorkItem[];
  importCandidateWorkItems: NexusEligibleWorkItem[];
  warnings: string[];
  blockers: string[];
}

interface CandidateRecord {
  key: string;
  order: number;
  item: NexusEligibleWorkItem;
  sourceIsDefault: boolean;
  hasCanonicalDefault: boolean;
}

interface ComponentScanState {
  component: ResolvedNexusProjectComponent;
  result: NexusEligibleWorkComponentResult;
  candidatesByKey: Map<string, CandidateRecord[]>;
  order: number;
}

export async function listNexusEligibleWorkByComponent(
  options: ListNexusEligibleWorkOptions,
): Promise<NexusEligibleWorkResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const mode = options.mode ?? "default";
  const result =
    mode === "discovery"
      ? await listDiscoveryEligibleWork({ ...options, projectRoot })
      : await listDefaultEligibleWork({ ...options, projectRoot });

  return result;
}

async function listDefaultEligibleWork(
  options: ListNexusEligibleWorkOptions & { projectRoot: string },
): Promise<NexusEligibleWorkResult> {
  const componentEligibleWorkItems: NexusEligibleWorkComponentResult[] = [];
  for (const component of options.components.filter(
    (candidate) => candidate.workTracking,
  )) {
    const tracker = defaultTracker(component);
    if (!tracker) {
      continue;
    }
    const provider = createProvider(options, component, tracker);
    const listed = await provider.listWorkItems({
      ...options.selectorQuery,
      projectRoot: options.projectRoot,
    });
    const workItems = eligibleNexusAutomationWorkItems(
      listed,
      options.automationConfig,
    ).map((item) =>
      eligibleItem({
        component,
        item,
        sourceTracker: tracker,
        sourceTrackerRef: trackerRef(component, tracker),
        canonicalTrackerRef: trackerRef(component, tracker),
        logicalItemId: item.externalRef?.itemId ?? item.id,
        selectable: true,
        importOnly: false,
        warnings: [],
      }),
    );
    componentEligibleWorkItems.push({
      componentId: component.id,
      workItems,
      importCandidateWorkItems: [],
      finalLimit: null,
      warnings: [],
      blockers: [],
      trackerResults: [
        {
          trackerId: tracker.id,
          trackerName: tracker.name,
          provider: tracker.provider,
          selected: true,
          selectableCount: workItems.length,
          importCandidateCount: 0,
          warnings: [],
          blockers: [],
        },
      ],
    });
  }

  return eligibleWorkResult("default", componentEligibleWorkItems);
}

async function listDiscoveryEligibleWork(
  options: ListNexusEligibleWorkOptions & { projectRoot: string },
): Promise<NexusEligibleWorkResult> {
  const credentialResolver =
    options.credentialResolver ??
    defaultNexusWorkItemDiscoveryCredentialResolver(options.env ?? process.env);
  const linkStore = loadWorkItemTrackerLinkStore(
    defaultWorkItemTrackerLinkStorePath(options.projectRoot),
    currentIso(options.now),
  );
  const componentResults: NexusEligibleWorkComponentResult[] = [];

  for (const component of options.components) {
    const state: ComponentScanState = {
      component,
      result: {
        componentId: component.id,
        workItems: [],
        importCandidateWorkItems: [],
        finalLimit: component.trackerDiscovery.finalLimit,
        warnings: [],
        blockers: [],
        trackerResults: [],
      },
      candidatesByKey: new Map(),
      order: 0,
    };

    for (const tracker of component.workTrackers) {
      await scanDiscoveryTracker({
        options,
        component,
        tracker,
        credentialResolver,
        linkRecords: linkStore.records,
        state,
      });
    }

    materializeComponentCandidates(state);
    componentResults.push(state.result);
  }

  applyFinalLimit(componentResults, options.selectorQuery);

  return eligibleWorkResult("discovery", componentResults);
}

async function scanDiscoveryTracker(options: {
  options: ListNexusEligibleWorkOptions & { projectRoot: string };
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  credentialResolver: NexusWorkItemDiscoveryCredentialResolver;
  linkRecords: WorkItemTrackerLinkRecord[];
  state: ComponentScanState;
}): Promise<void> {
  const selection = nexusWorkItemDiscoveryTrackerSelection(
    options.component,
    options.tracker,
  );
  if (!selection.selected) {
    const disabledWarning = disabledSelectedTrackerWarning(
      options.component,
      options.tracker,
    );
    if (disabledWarning) {
      addWarning(options.state, options.tracker, disabledWarning);
    }
    options.state.result.trackerResults.push(emptyTrackerResult({
      tracker: options.tracker,
      selected: false,
      warnings: disabledWarning ? [disabledWarning] : [],
      blockers: [],
    }));
    return;
  }

  const capabilityBlocker = listCapabilityBlocker(options.tracker);
  if (capabilityBlocker) {
    addPolicyIssue(options.state, options.tracker, capabilityBlocker);
    return;
  }

  const credentials = options.credentialResolver({
    componentId: options.component.id,
    trackerId: options.tracker.id,
    provider: options.tracker.provider,
    workTracking: options.tracker.workTracking,
  });
  const credentialIssue = credentialReadIssue(credentials);
  if (credentialIssue) {
    addPolicyIssue(options.state, options.tracker, credentialIssue);
    return;
  }

  const trackerResult = emptyTrackerResult({
    tracker: options.tracker,
    selected: true,
    warnings: [],
    blockers: [],
  });
  options.state.result.trackerResults.push(trackerResult);

  let listed: WorkItem[];
  try {
    listed = await createProvider(
      options.options,
      options.component,
      options.tracker,
    ).listWorkItems({
      ...discoveryQuery(
        options.options.selectorQuery,
        options.component.trackerDiscovery,
        options.tracker,
      ),
      projectRoot: options.options.projectRoot,
    });
  } catch (error) {
    addPolicyIssue(
      options.state,
      options.tracker,
      `Provider read failed: ${errorMessage(error)}`,
    );
    return;
  }

  const matchingItems = listed.filter((item) =>
    itemMatchesDiscoveryFilters(
      item,
      options.options.automationConfig,
      options.component.trackerDiscovery,
    ),
  );
  for (const item of matchingItems) {
    const candidate = candidateFromItem({
      component: options.component,
      tracker: options.tracker,
      item,
      linkRecords: options.linkRecords,
      order: options.state.order,
    });
    options.state.order += 1;
    const existing = options.state.candidatesByKey.get(candidate.key) ?? [];
    existing.push(candidate);
    options.state.candidatesByKey.set(candidate.key, existing);
    if (candidate.item.selectable) {
      trackerResult.selectableCount += 1;
    } else {
      trackerResult.importCandidateCount += 1;
    }
  }
}

function candidateFromItem(options: {
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  item: WorkItem;
  linkRecords: WorkItemTrackerLinkRecord[];
  order: number;
}): CandidateRecord {
  const sourceTrackerRef = trackerRef(options.component, options.tracker);
  const sourceIsDefault = options.tracker.default;
  const linkRecord = findLinkRecordForItem(
    options.linkRecords,
    options.component,
    options.tracker,
    options.item,
  );
  const defaultTrackerId = options.component.defaultTrackerId;
  const defaultTrackerRef = defaultTrackerId
    ? trackerRefById(options.component, defaultTrackerId)
    : null;
  const defaultReference = defaultTrackerId
    ? linkRecord?.references.find(
        (reference) => reference.trackerId === defaultTrackerId,
      ) ?? null
    : null;
  const hasCanonicalDefault = sourceIsDefault || Boolean(defaultReference);
  const linkedLogicalItemId = linkRecord?.logicalItemId ?? null;

  if (sourceIsDefault) {
    const logicalItemId = linkedLogicalItemId ?? options.item.externalRef?.itemId ?? options.item.id;
    return {
      key: `logical:${options.component.id}:${logicalItemId}`,
      order: options.order,
      sourceIsDefault,
      hasCanonicalDefault,
      item: eligibleItem({
        component: options.component,
        item: options.item,
        sourceTracker: options.tracker,
        sourceTrackerRef,
        canonicalTrackerRef: sourceTrackerRef,
        logicalItemId,
        selectable: true,
        importOnly: false,
        warnings: [],
      }),
    };
  }

  if (defaultReference && defaultTrackerRef) {
    const logicalItemId = linkedLogicalItemId ?? defaultReference.itemId;
    return {
      key: `logical:${options.component.id}:${logicalItemId}`,
      order: options.order,
      sourceIsDefault,
      hasCanonicalDefault,
      item: eligibleItem({
        component: options.component,
        item: {
          ...options.item,
          id: defaultReference.itemId,
          provider: defaultTrackerRef.provider,
          externalRef: {
            provider: defaultTrackerRef.provider,
            itemId: defaultReference.itemId,
            itemNumber: defaultReference.itemNumber,
            itemKey: defaultReference.itemKey,
            webUrl: defaultReference.webUrl,
          },
        },
        sourceTracker: options.tracker,
        sourceTrackerRef,
        canonicalTrackerRef: defaultTrackerRef,
        logicalItemId,
        selectable: true,
        importOnly: false,
        warnings: [],
      }),
    };
  }

  const directSelectionAllowed =
    options.component.trackerDiscovery.directExternalSelection === "allowed" &&
    !options.component.trackerDiscovery.importRequiredFirst;
  const selectable = directSelectionAllowed;
  const logicalItemId = linkedLogicalItemId;
  const warnings = selectable
    ? []
    : ["External work item must be imported before local assignment."];

  return {
    key: `external:${options.component.id}:${options.tracker.id}:${externalItemKey(options.item)}`,
    order: options.order,
    sourceIsDefault,
    hasCanonicalDefault,
    item: eligibleItem({
      component: options.component,
      item: options.item,
      sourceTracker: options.tracker,
      sourceTrackerRef,
      canonicalTrackerRef: selectable ? sourceTrackerRef : null,
      logicalItemId,
      selectable,
      importOnly: !selectable,
      warnings,
    }),
  };
}

function materializeComponentCandidates(state: ComponentScanState): void {
  const candidates = [...state.candidatesByKey.values()]
    .map((group) => chooseCandidate(state.component, group))
    .sort((left, right) => left.order - right.order);

  for (const candidate of candidates) {
    if (candidate.item.selectable) {
      state.result.workItems.push(candidate.item);
    } else {
      state.result.importCandidateWorkItems.push(candidate.item);
    }
  }
}

function chooseCandidate(
  component: ResolvedNexusProjectComponent,
  candidates: CandidateRecord[],
): CandidateRecord {
  const sorted = [...candidates].sort((left, right) => left.order - right.order);
  const duplicateWarning =
    sorted.length > 1
      ? [`Discovered ${sorted.length} linked tracker representations for this work item.`]
      : [];
  const selectable = sorted.filter((candidate) => candidate.item.selectable);
  const preferred =
    chooseByConflictPolicy(component, selectable.length ? selectable : sorted) ??
    sorted[0]!;

  return {
    ...preferred,
    item: {
      ...preferred.item,
      warnings: [...preferred.item.warnings, ...duplicateWarning],
    },
  };
}

function chooseByConflictPolicy(
  component: ResolvedNexusProjectComponent,
  candidates: CandidateRecord[],
): CandidateRecord | null {
  if (candidates.length === 0) {
    return null;
  }
  if (component.trackerDiscovery.conflictWinner === "scanned_tracker") {
    return (
      candidates.find(
        (candidate) =>
          !candidate.sourceIsDefault && candidate.hasCanonicalDefault,
      ) ??
      candidates.find((candidate) => !candidate.sourceIsDefault) ??
      candidates[0]!
    );
  }

  return (
    candidates.find((candidate) => candidate.sourceIsDefault) ??
    candidates.find((candidate) => candidate.hasCanonicalDefault) ??
    candidates[0]!
  );
}

function applyFinalLimit(
  components: NexusEligibleWorkComponentResult[],
  selectorQuery: WorkItemQuery,
): void {
  let remaining = finalLimitForComponents(components, selectorQuery);
  if (remaining === null) {
    return;
  }

  for (const component of components) {
    if (remaining <= 0) {
      component.workItems = [];
      continue;
    }
    component.workItems = component.workItems.slice(0, remaining);
    remaining -= component.workItems.length;
  }
}

function finalLimitForComponents(
  components: NexusEligibleWorkComponentResult[],
  selectorQuery: WorkItemQuery,
): number | null {
  const policyLimit = components.find(
    (component) => component.finalLimit !== null,
  )?.finalLimit ?? null;
  return policyLimit ?? selectorQuery.limit ?? null;
}

function eligibleWorkResult(
  mode: NexusEligibleWorkMode,
  components: NexusEligibleWorkComponentResult[],
): NexusEligibleWorkResult {
  const eligibleWorkItems = components.flatMap((component) => component.workItems);
  const importCandidateWorkItems = components.flatMap(
    (component) => component.importCandidateWorkItems,
  );
  const warnings = components.flatMap((component) => component.warnings);
  const blockers = components.flatMap((component) => component.blockers);

  return {
    mode,
    componentEligibleWorkItems: components,
    eligibleWorkItems,
    importCandidateWorkItems,
    warnings,
    blockers,
  };
}

function discoveryQuery(
  selectorQuery: WorkItemQuery,
  policy: ResolvedNexusProjectComponent["trackerDiscovery"],
  tracker: ResolvedNexusProjectWorkTracker,
): WorkItemQuery {
  const statuses = mergedStatuses(selectorQuery.status, policy.statuses);
  const labels = uniqueStrings([
    ...(selectorQuery.labels ?? []),
    ...policy.labels,
  ]);
  const assignees = uniqueStrings([
    ...(selectorQuery.assignees ?? []),
    ...policy.assignees,
  ]);
  const query: WorkItemQuery = {
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(assignees.length > 0 ? { assignees } : {}),
    ...(policy.providerQuery ?? selectorQuery.search
      ? { search: policy.providerQuery ?? selectorQuery.search }
      : {}),
  };
  const limit = policy.trackerLimits[tracker.id] ?? policy.queryLimit;
  if (limit !== null) {
    query.limit = limit;
  }

  return query;
}

function itemMatchesDiscoveryFilters(
  item: WorkItem,
  automationConfig: NexusAutomationConfig,
  policy: ResolvedNexusProjectComponent["trackerDiscovery"],
): boolean {
  if (!eligibleNexusAutomationWorkItems([item], automationConfig).length) {
    return false;
  }
  if (
    policy.statuses.length > 0 &&
    !policy.statuses.includes(item.status)
  ) {
    return false;
  }
  if (policy.labels.some((label) => !item.labels?.includes(label))) {
    return false;
  }
  if (policy.assignees.some((assignee) => !item.assignees?.includes(assignee))) {
    return false;
  }
  if (
    policy.milestones.length > 0 &&
    (!item.milestone || !policy.milestones.includes(item.milestone))
  ) {
    return false;
  }

  return true;
}

function mergedStatuses(
  selectorStatus: WorkItemQuery["status"],
  policyStatuses: readonly WorkStatus[],
): WorkStatus[] {
  const selectorStatuses = Array.isArray(selectorStatus)
    ? selectorStatus
    : selectorStatus
      ? [selectorStatus]
      : [];
  if (selectorStatuses.length === 0) {
    return [...policyStatuses];
  }
  if (policyStatuses.length === 0) {
    return [...selectorStatuses];
  }
  const policySet = new Set(policyStatuses);
  return selectorStatuses.filter((status) => policySet.has(status));
}

function listCapabilityBlocker(
  tracker: ResolvedNexusProjectWorkTracker,
): string | null {
  return tracker.workTrackingCapabilityReport.capabilities.list
    ? null
    : "Provider does not support listing work items.";
}

function credentialReadIssue(
  credentials: NexusWorkItemDiscoveryCredentialCheck,
): string | null {
  return credentials.status === "missing" ? credentials.message : null;
}

function addPolicyIssue(
  state: ComponentScanState,
  tracker: ResolvedNexusProjectWorkTracker,
  message: string,
): void {
  const useWarning =
    state.component.trackerDiscovery.missingCredentialBehavior === "skip";
  if (useWarning) {
    addWarning(state, tracker, message);
  } else {
    addBlocker(state, tracker, message);
  }
}

function addWarning(
  state: ComponentScanState,
  tracker: ResolvedNexusProjectWorkTracker,
  message: string,
): void {
  const warning = `Component ${state.component.id} tracker ${tracker.id} skipped: ${message}`;
  state.result.warnings.push(warning);
  state.result.trackerResults.push(emptyTrackerResult({
    tracker,
    selected: true,
    warnings: [warning],
    blockers: [],
  }));
}

function addBlocker(
  state: ComponentScanState,
  tracker: ResolvedNexusProjectWorkTracker,
  message: string,
): void {
  const blocker = `Component ${state.component.id} tracker ${tracker.id} blocked: ${message}`;
  state.result.blockers.push(blocker);
  state.result.trackerResults.push(emptyTrackerResult({
    tracker,
    selected: true,
    warnings: [],
    blockers: [blocker],
  }));
}

function disabledSelectedTrackerWarning(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): string | null {
  if (tracker.enabled) {
    return null;
  }
  const selectionIfEnabled = nexusWorkItemDiscoveryTrackerSelection(component, {
    ...tracker,
    enabled: true,
  });
  return selectionIfEnabled.selected ? "Tracker binding is disabled." : null;
}

function emptyTrackerResult(options: {
  tracker: ResolvedNexusProjectWorkTracker;
  selected: boolean;
  warnings: string[];
  blockers: string[];
}): NexusEligibleWorkTrackerQueryResult {
  return {
    trackerId: options.tracker.id,
    trackerName: options.tracker.name,
    provider: options.tracker.provider,
    selected: options.selected,
    selectableCount: 0,
    importCandidateCount: 0,
    warnings: options.warnings,
    blockers: options.blockers,
  };
}

function createProvider(
  options: ListNexusEligibleWorkOptions,
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): WorkTrackerProvider {
  if (options.provider) {
    return options.provider;
  }
  if (options.providerFactory) {
    return options.providerFactory({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      component,
      tracker,
      workTracking: tracker.workTracking,
    });
  }

  return createWorkTrackerProvider(tracker.workTracking, {
    ...options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.now,
  });
}

function eligibleItem(options: {
  component: ResolvedNexusProjectComponent;
  item: WorkItem;
  sourceTracker: ResolvedNexusProjectWorkTracker;
  sourceTrackerRef: WorkTrackerRef;
  canonicalTrackerRef: WorkTrackerRef | null;
  logicalItemId: string | null;
  selectable: boolean;
  importOnly: boolean;
  warnings: string[];
}): NexusEligibleWorkItem {
  return {
    ...options.item,
    componentId: options.component.id,
    logicalItemId: options.logicalItemId,
    trackerRef: options.canonicalTrackerRef ?? options.sourceTrackerRef,
    canonicalTrackerRef: options.canonicalTrackerRef,
    sourceTrackerRef: options.sourceTrackerRef,
    warnings: options.warnings,
    selectable: options.selectable,
    importOnly: options.importOnly,
  };
}

function defaultTracker(
  component: ResolvedNexusProjectComponent,
): ResolvedNexusProjectWorkTracker | null {
  return component.defaultTrackerId
    ? component.workTrackers.find(
        (tracker) => tracker.id === component.defaultTrackerId,
      ) ?? null
    : null;
}

function trackerRefById(
  component: ResolvedNexusProjectComponent,
  trackerId: string,
): WorkTrackerRef | null {
  const tracker =
    component.workTrackers.find((candidate) => candidate.id === trackerId) ??
    null;
  return tracker ? trackerRef(component, tracker) : null;
}

function trackerRef(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): WorkTrackerRef {
  return {
    componentId: component.id,
    componentName: component.name,
    trackerId: tracker.id,
    trackerName: tracker.name,
    provider: tracker.provider,
    roles: [...tracker.roles],
    default: tracker.default,
  };
}

function findLinkRecordForItem(
  records: WorkItemTrackerLinkRecord[],
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): WorkItemTrackerLinkRecord | null {
  return (
    records.find(
      (record) =>
        record.componentId === component.id &&
        record.references.some((reference) =>
          referenceMatchesItem(reference, tracker, item),
        ),
    ) ?? null
  );
}

function referenceMatchesItem(
  reference: WorkItemTrackerReference,
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): boolean {
  if (reference.trackerId !== tracker.id) {
    return false;
  }
  if (reference.provider !== tracker.provider) {
    return false;
  }
  const externalRef = item.externalRef;
  if (!externalRef) {
    return reference.itemId === item.id;
  }
  return externalRefMatchesReference(externalRef, reference) ||
    reference.itemId === item.id;
}

function externalRefMatchesReference(
  externalRef: ExternalRef,
  reference: WorkItemTrackerReference,
): boolean {
  if (externalRef.provider !== reference.provider) {
    return false;
  }
  if (externalRef.itemId && externalRef.itemId === reference.itemId) {
    return true;
  }
  if (
    externalRef.itemNumber !== undefined &&
    externalRef.itemNumber !== null &&
    externalRef.itemNumber === reference.itemNumber
  ) {
    return true;
  }
  if (externalRef.itemKey && externalRef.itemKey === reference.itemKey) {
    return true;
  }
  if (externalRef.nodeId && externalRef.nodeId === reference.nodeId) {
    return true;
  }

  return false;
}

function externalItemKey(item: WorkItem): string {
  const externalRef = item.externalRef;
  return [
    externalRef?.provider ?? item.provider,
    externalRef?.repositoryId ??
      `${externalRef?.repositoryOwner ?? ""}/${externalRef?.repositoryName ?? ""}`,
    externalRef?.itemId ?? item.id,
    externalRef?.itemNumber ?? "",
    externalRef?.itemKey ?? "",
    externalRef?.nodeId ?? "",
  ].join(":");
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("now must return a valid date");
  }

  return date.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
