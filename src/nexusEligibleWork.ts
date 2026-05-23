import path from "node:path";
import { eligibleNexusAutomationWorkItems } from "./nexusAutomation.js";
import type {
  NexusAutomationConfig,
  NexusAutomationEligibleWorkMode,
} from "./nexusAutomationConfig.js";
import type {
  NexusProjectConfig,
  NexusProjectTrackerDiscoveryFingerprintConfig,
} from "./nexusProjectConfig.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import {
  defaultNexusWorkItemDiscoveryCredentialResolver,
  nexusWorkItemDiscoveryCredentialEnvironment,
  nexusWorkItemDiscoveryTrackerSelection,
  type NexusWorkItemDiscoveryCredentialCheck,
  type NexusWorkItemDiscoveryCredentialResolver,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  createWorkTrackerProviderAsync,
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
  WorkStatusQuery,
  WorkTrackerProvider,
  WorkTrackerRef,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export type NexusEligibleWorkMode = NexusAutomationEligibleWorkMode;

export interface NexusEligibleWorkProviderContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  workTracking: WorkTrackingConfig;
}

export type NexusEligibleWorkProviderFactory = (
  context: NexusEligibleWorkProviderContext,
) => WorkTrackerProvider | Promise<WorkTrackerProvider>;

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
  excludedCount: number;
  exclusionReasonCounts: Record<string, number>;
  exclusionCategoryCounts: Record<string, number>;
  warnings: string[];
  blockers: string[];
}

export type NexusEligibleWorkExclusionCategory =
  | "status"
  | "required_label"
  | "excluded_label"
  | "assignee"
  | "milestone"
  | "search"
  | "limit";

export interface NexusEligibleWorkExclusionFinding {
  category: NexusEligibleWorkExclusionCategory;
  reason: string;
  value: string | null;
}

export type NexusEligibleWorkDedupeReason =
  | "tracker_link"
  | "external_ref"
  | "provider_identity"
  | "configured_fingerprint";

export interface NexusEligibleWorkDedupeInfo {
  reason: NexusEligibleWorkDedupeReason;
  key: string;
  collapsedCount: number;
  linkId?: string;
  logicalItemId?: string;
}

export interface NexusEligibleWorkItem extends WorkItem {
  componentId: string;
  logicalItemId: string | null;
  canonicalTrackerRef: WorkTrackerRef | null;
  sourceTrackerRef: WorkTrackerRef | null;
  dedupe: NexusEligibleWorkDedupeInfo | null;
  warnings: string[];
  selectable: boolean;
  importOnly: boolean;
}

export interface NexusEligibleWorkExcludedItem extends WorkItem {
  componentId: string;
  sourceTrackerRef: WorkTrackerRef | null;
  reasons: string[];
  exclusionFindings: NexusEligibleWorkExclusionFinding[];
}

export interface NexusEligibleWorkComponentResult {
  componentId: string;
  workItems: NexusEligibleWorkItem[];
  importCandidateWorkItems: NexusEligibleWorkItem[];
  excludedWorkItems: NexusEligibleWorkExcludedItem[];
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
  excludedWorkItems: NexusEligibleWorkExcludedItem[];
  warnings: string[];
  blockers: string[];
}

interface CandidateIdentityKey {
  key: string;
  reason: NexusEligibleWorkDedupeReason;
  linkId?: string;
  logicalItemId?: string;
}

interface CandidateRecord {
  order: number;
  item: NexusEligibleWorkItem;
  sourceIsDefault: boolean;
  hasCanonicalDefault: boolean;
  identityKeys: CandidateIdentityKey[];
  linkRecords: WorkItemTrackerLinkRecord[];
  defaultReference: WorkItemTrackerReference | null;
  dedupeIssues: string[];
}

interface ComponentScanState {
  component: ResolvedNexusProjectComponent;
  result: NexusEligibleWorkComponentResult;
  candidates: CandidateRecord[];
  successfulTrackerIds: Set<string>;
  observedReferenceKeys: Set<string>;
  reportedDedupeIssues: Set<string>;
  order: number;
}

export async function listNexusEligibleWorkByComponent(
  options: ListNexusEligibleWorkOptions,
): Promise<NexusEligibleWorkResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const runtimeOptions = {
    ...options,
    projectRoot,
    env: nexusWorkItemDiscoveryCredentialEnvironment({
      projectRoot,
      projectConfig: options.projectConfig,
      env: options.env,
    }),
  };
  const mode = options.mode ?? "default";
  const result =
    mode === "discovery"
      ? await listDiscoveryEligibleWork(runtimeOptions)
      : await listDefaultEligibleWork(runtimeOptions);

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
    const provider = await createProvider(options, component, tracker);
    const listed = await provider.listWorkItems({
      ...options.selectorQuery,
      projectRoot: options.projectRoot,
    });
    const result: NexusEligibleWorkComponentResult = {
      componentId: component.id,
      workItems: [],
      importCandidateWorkItems: [],
      excludedWorkItems: [],
      finalLimit: null,
      warnings: [],
      blockers: [],
      trackerResults: [],
    };
    const trackerResult = emptyTrackerResult({
      tracker,
      selected: true,
      warnings: [],
      blockers: [],
    });
    result.trackerResults.push(trackerResult);
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
        dedupe: null,
        warnings: [],
      }),
    );
    result.workItems = workItems;
    trackerResult.selectableCount = workItems.length;
    await recordVisibleExcludedWork({
      options,
      component,
      tracker,
      provider,
      query: options.selectorQuery,
      listed,
      matchingKeys: new Set(
        workItems.flatMap((item) => observedReferenceKeys(tracker, item)),
      ),
      trackerResult,
      result,
      otherwiseSelectableFinding:
        options.selectorQuery.limit === null ||
        options.selectorQuery.limit === undefined
          ? null
          : {
              category: "limit",
              reason: "selector limit reached",
              value: String(options.selectorQuery.limit),
            },
    });
    componentEligibleWorkItems.push(result);
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
  const projectLinkRecords = linkStore.records.filter(
    (record) => record.projectId === options.projectConfig.id,
  );
  const componentResults: NexusEligibleWorkComponentResult[] = [];

  for (const component of options.components) {
    const state: ComponentScanState = {
      component,
      result: {
        componentId: component.id,
        workItems: [],
        importCandidateWorkItems: [],
        excludedWorkItems: [],
        finalLimit: component.trackerDiscovery.finalLimit,
        warnings: [],
        blockers: [],
        trackerResults: [],
      },
      candidates: [],
      successfulTrackerIds: new Set(),
      observedReferenceKeys: new Set(),
      reportedDedupeIssues: new Set(),
      order: 0,
    };

    for (const tracker of component.workTrackers) {
      await scanDiscoveryTracker({
        options,
        component,
        tracker,
        credentialResolver,
        linkRecords: projectLinkRecords,
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
  const provider = await createProvider(
    options.options,
    options.component,
    options.tracker,
  );
  const query = discoveryQuery(
    options.options.selectorQuery,
    options.component.trackerDiscovery,
    options.tracker,
  );
  try {
    listed = await provider.listWorkItems({
      ...query,
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
  const matchingKeys = new Set(
    matchingItems.flatMap((item) => observedReferenceKeys(options.tracker, item)),
  );
  await recordVisibleExcludedWork({
    ...options,
    provider,
    query,
    listed,
    matchingKeys,
    trackerResult,
    result: options.state.result,
    otherwiseSelectableFinding: null,
  });
  options.state.successfulTrackerIds.add(options.tracker.id);
  for (const item of matchingItems) {
    for (const key of observedReferenceKeys(options.tracker, item)) {
      options.state.observedReferenceKeys.add(key);
    }
    const candidate = candidateFromItem({
      component: options.component,
      tracker: options.tracker,
      item,
      linkRecords: options.linkRecords,
      order: options.state.order,
    });
    options.state.order += 1;
    options.state.candidates.push(candidate);
    if (candidate.item.selectable) {
      trackerResult.selectableCount += 1;
    } else {
      trackerResult.importCandidateCount += 1;
    }
  }
}

async function recordVisibleExcludedWork(options: {
  options: ListNexusEligibleWorkOptions & { projectRoot: string };
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
  query: WorkItemQuery;
  listed: WorkItem[];
  matchingKeys: Set<string>;
  trackerResult: NexusEligibleWorkTrackerQueryResult;
  result: NexusEligibleWorkComponentResult;
  otherwiseSelectableFinding: NexusEligibleWorkExclusionFinding | null;
}): Promise<void> {
  const visibleQuery = visibleDiscoveryQuery(
    options.options.selectorQuery,
    options.component.trackerDiscovery,
    options.tracker,
  );
  let visibleItems = options.listed;
  if (!sameWorkItemQuery(options.query, visibleQuery)) {
    try {
      visibleItems = await options.provider.listWorkItems({
        ...visibleQuery,
        projectRoot: options.options.projectRoot,
      });
    } catch (error) {
      const warning = `Component ${options.component.id} tracker ${options.tracker.id} could not read visible excluded work: ${errorMessage(error)}`;
      options.result.warnings.push(warning);
      options.trackerResult.warnings.push(warning);
      return;
    }
  }

  for (const item of visibleItems) {
    if (hasObservedMatchingReference(options.tracker, item, options.matchingKeys)) {
      continue;
    }
    const findings = visibleExcludedWorkFindings({
      item,
      selectorQuery: options.options.selectorQuery,
      automationConfig: options.options.automationConfig,
      policy: options.component.trackerDiscovery,
      otherwiseSelectableFinding: options.otherwiseSelectableFinding,
    });
    if (findings.length === 0) {
      continue;
    }

    recordVisibleExclusion({
      item,
      component: options.component,
      tracker: options.tracker,
      trackerResult: options.trackerResult,
      result: options.result,
      findings,
    });
  }
}

function hasObservedMatchingReference(
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
  matchingKeys: Set<string>,
): boolean {
  return observedReferenceKeys(tracker, item).some((key) => matchingKeys.has(key));
}

function visibleExcludedWorkFindings(options: {
  item: WorkItem;
  selectorQuery: WorkItemQuery;
  automationConfig: NexusAutomationConfig;
  policy: ResolvedNexusProjectComponent["trackerDiscovery"];
  otherwiseSelectableFinding: NexusEligibleWorkExclusionFinding | null;
}): NexusEligibleWorkExclusionFinding[] {
  const findings = eligibleWorkExclusionFindings(options);
  return findings.length > 0 || !options.otherwiseSelectableFinding
    ? findings
    : [options.otherwiseSelectableFinding];
}

function recordVisibleExclusion(options: {
  item: WorkItem;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  trackerResult: NexusEligibleWorkTrackerQueryResult;
  result: NexusEligibleWorkComponentResult;
  findings: NexusEligibleWorkExclusionFinding[];
}): void {
  const reasons = options.findings.map((finding) => finding.reason);
  options.trackerResult.excludedCount += 1;
  for (const finding of options.findings) {
    incrementCount(options.trackerResult.exclusionReasonCounts, finding.reason);
    incrementCount(
      options.trackerResult.exclusionCategoryCounts,
      finding.category,
    );
  }
  if (options.result.excludedWorkItems.length >= 10) {
    return;
  }
  options.result.excludedWorkItems.push({
    ...options.item,
    componentId: options.component.id,
    sourceTrackerRef: trackerRef(options.component, options.tracker),
    reasons,
    exclusionFindings: options.findings,
  });
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
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
  const linkRecords = findLinkRecordsForItem(
    options.linkRecords,
    options.component,
    options.tracker,
    options.item,
  );
  const linkRecord = linkRecords.length === 1 ? linkRecords[0]! : null;
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
  const dedupeIssues =
    linkRecords.length > 1
      ? [
          `Work item "${options.item.id}" from tracker "${options.tracker.id}" matches conflicting link records: ${linkRecords
            .map((record) => record.logicalItemId)
            .join(", ")}.`,
        ]
      : [];
  const identityKeys = candidateIdentityKeys({
    component: options.component,
    tracker: options.tracker,
    item: options.item,
    linkRecord,
  });

  if (sourceIsDefault) {
    const logicalItemId = linkedLogicalItemId ?? defaultLogicalItemId(options.item);
    return {
      order: options.order,
      sourceIsDefault,
      hasCanonicalDefault,
      identityKeys,
      linkRecords,
      defaultReference,
      dedupeIssues,
      item: eligibleItem({
        component: options.component,
        item: options.item,
        sourceTracker: options.tracker,
        sourceTrackerRef,
        canonicalTrackerRef: sourceTrackerRef,
        logicalItemId,
        selectable: true,
        importOnly: false,
        dedupe: null,
        warnings: [],
      }),
    };
  }

  if (defaultReference && defaultTrackerRef && linkRecords.length <= 1) {
    const logicalItemId = linkedLogicalItemId ?? defaultReference.itemId;
    return {
      order: options.order,
      sourceIsDefault,
      hasCanonicalDefault,
      identityKeys,
      linkRecords,
      defaultReference,
      dedupeIssues,
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
        dedupe: null,
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
    order: options.order,
    sourceIsDefault,
    hasCanonicalDefault,
    identityKeys,
    linkRecords,
    defaultReference,
    dedupeIssues,
    item: eligibleItem({
      component: options.component,
      item: options.item,
      sourceTracker: options.tracker,
      sourceTrackerRef,
      canonicalTrackerRef: selectable ? sourceTrackerRef : null,
      logicalItemId,
      selectable,
      importOnly: !selectable,
      dedupe: null,
      warnings,
    }),
  };
}

function materializeComponentCandidates(state: ComponentScanState): void {
  reportCandidateDedupeIssues(state);
  const groups = dedupeCandidateGroups(state)
    .map((group) => chooseCandidate(state, group))
    .sort((left, right) => left.order - right.order);

  for (const candidate of groups) {
    if (candidate.item.selectable) {
      state.result.workItems.push(candidate.item);
    } else {
      state.result.importCandidateWorkItems.push(candidate.item);
    }
  }
}

function chooseCandidate(
  state: ComponentScanState,
  candidates: CandidateRecord[],
): CandidateRecord {
  const sorted = [...candidates].sort((left, right) => left.order - right.order);
  const duplicateDedupe = sorted.length > 1
    ? dedupeInfoForGroup(sorted)
    : null;
  const selectable = sorted.filter((candidate) => candidate.item.selectable);
  const preferred =
    chooseByConflictPolicy(state.component, selectable.length ? selectable : sorted) ??
    sorted[0]!;
  const staleWarnings = staleCanonicalWarnings(state, preferred);
  for (const warning of staleWarnings) {
    addDedupeIssue(state, warning);
  }

  return {
    ...preferred,
    item: {
      ...preferred.item,
      dedupe: duplicateDedupe,
      warnings: [
        ...preferred.item.warnings,
        ...preferred.dedupeIssues,
        ...staleWarnings,
      ],
    },
  };
}

function dedupeCandidateGroups(state: ComponentScanState): CandidateRecord[][] {
  const candidates = state.candidates;
  const parents = candidates.map((_candidate, index) => index);
  const identityGroups = candidateIndexesByIdentityKey(candidates);

  const find = (index: number): number => {
    let parent = parents[index]!;
    while (parent !== parents[parent]) {
      parents[parent] = parents[parents[parent]!]!;
      parent = parents[parent]!;
    }
    return parent;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[rightRoot] = leftRoot;
    }
  };

  for (const [key, indexes] of identityGroups.entries()) {
    if (indexes.length < 2) {
      continue;
    }
    const grouped = indexes.map((index) => candidates[index]!);
    const issue = ambiguousIdentityIssue(key, grouped);
    if (issue) {
      for (const candidate of grouped) {
        candidate.dedupeIssues.push(issue);
      }
      addDedupeIssue(state, issue);
      continue;
    }

    const [first, ...rest] = indexes;
    for (const index of rest) {
      union(first!, index);
    }
  }

  const groups = new Map<number, CandidateRecord[]>();
  for (const [index, candidate] of candidates.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }

  return [...groups.values()];
}

function candidateIndexesByIdentityKey(
  candidates: CandidateRecord[],
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const [index, candidate] of candidates.entries()) {
    for (const identity of candidate.identityKeys) {
      const indexes = groups.get(identity.key) ?? [];
      indexes.push(index);
      groups.set(identity.key, indexes);
    }
  }

  return groups;
}

function ambiguousIdentityIssue(
  key: string,
  candidates: CandidateRecord[],
): string | null {
  const linkIds = uniqueStrings(
    candidates.flatMap((candidate) =>
      candidate.linkRecords.map((record) => record.logicalItemId),
    ),
  );
  if (linkIds.length > 1) {
    return `Provider identity "${key}" is linked to conflicting logical work items: ${linkIds.join(", ")}.`;
  }

  const canonicalIds = uniqueStrings(
    candidates
      .filter((candidate) => candidate.item.canonicalTrackerRef?.default)
      .map((candidate) => candidate.item.id),
  );
  const keyReason = candidates
    .flatMap((candidate) => candidate.identityKeys)
    .find((identity) => identity.key === key)?.reason;
  if (
    canonicalIds.length > 1 &&
    keyReason !== "tracker_link" &&
    keyReason !== "configured_fingerprint"
  ) {
    return `Ambiguous unlinked provider identity "${key}" matches multiple canonical work items: ${canonicalIds.join(", ")}.`;
  }

  return null;
}

function dedupeInfoForGroup(
  candidates: CandidateRecord[],
): NexusEligibleWorkDedupeInfo {
  const identities = candidates.flatMap((candidate) => candidate.identityKeys);
  const chosen =
    identities.find((identity) => identity.reason === "tracker_link") ??
    identities.find((identity) => identity.reason === "configured_fingerprint") ??
    identities.find((identity) => identity.reason === "external_ref") ??
    identities.find((identity) => identity.reason === "provider_identity") ??
    identities[0]!;

  return {
    reason: chosen.reason,
    key: chosen.key,
    collapsedCount: candidates.length,
    ...(chosen.linkId ? { linkId: chosen.linkId } : {}),
    ...(chosen.logicalItemId ? { logicalItemId: chosen.logicalItemId } : {}),
  };
}

function reportCandidateDedupeIssues(state: ComponentScanState): void {
  for (const candidate of state.candidates) {
    for (const issue of candidate.dedupeIssues) {
      addDedupeIssue(state, issue);
    }
  }
}

function staleCanonicalWarnings(
  state: ComponentScanState,
  candidate: CandidateRecord,
): string[] {
  const reference = candidate.defaultReference;
  if (!reference || !state.successfulTrackerIds.has(reference.trackerId)) {
    return [];
  }
  if (state.observedReferenceKeys.has(referenceObservedKey(reference))) {
    return [];
  }

  return [
    `Linked canonical tracker item "${reference.itemId}" from tracker "${reference.trackerId}" was not returned by discovery; the link may be stale, filtered, or missing.`,
  ];
}

function addDedupeIssue(
  state: ComponentScanState,
  message: string,
): void {
  if (state.reportedDedupeIssues.has(message)) {
    return;
  }
  state.reportedDedupeIssues.add(message);
  const decorated = `Component ${state.component.id} dedupe: ${message}`;
  if (state.component.trackerDiscovery.conflictWinner === "block") {
    state.result.blockers.push(decorated);
  } else {
    state.result.warnings.push(decorated);
  }
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
      component.excludedWorkItems.push(
        ...component.workItems.map((item) =>
          excludedFromEligibleItem(item, "final limit reached"),
        ),
      );
      component.workItems = [];
      continue;
    }
    if (component.workItems.length > remaining) {
      component.excludedWorkItems.push(
        ...component.workItems
          .slice(remaining)
          .map((item) => excludedFromEligibleItem(item, "final limit reached")),
      );
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
  const excludedWorkItems = components.flatMap(
    (component) => component.excludedWorkItems,
  );
  const warnings = components.flatMap((component) => component.warnings);
  const blockers = components.flatMap((component) => component.blockers);

  return {
    mode,
    componentEligibleWorkItems: components,
    eligibleWorkItems,
    importCandidateWorkItems,
    excludedWorkItems,
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

function visibleDiscoveryQuery(
  _selectorQuery: WorkItemQuery,
  policy: ResolvedNexusProjectComponent["trackerDiscovery"],
  tracker: ResolvedNexusProjectWorkTracker,
): WorkItemQuery {
  const query: WorkItemQuery = {
    ...(policy.providerQuery ? { search: policy.providerQuery } : {}),
  };
  const limit = policy.trackerLimits[tracker.id] ?? policy.queryLimit;
  if (limit !== null) {
    query.limit = limit;
  }

  return query;
}

function sameWorkItemQuery(left: WorkItemQuery, right: WorkItemQuery): boolean {
  return (
    JSON.stringify(normalizedQuery(left)) ===
    JSON.stringify(normalizedQuery(right))
  );
}

function normalizedQuery(query: WorkItemQuery): WorkItemQuery {
  return {
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.labels !== undefined ? { labels: query.labels } : {}),
    ...(query.assignees !== undefined ? { assignees: query.assignees } : {}),
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  };
}

function eligibleWorkExclusionFindings(options: {
  item: WorkItem;
  selectorQuery: WorkItemQuery;
  automationConfig: NexusAutomationConfig;
  policy: ResolvedNexusProjectComponent["trackerDiscovery"];
}): NexusEligibleWorkExclusionFinding[] {
  const findings: NexusEligibleWorkExclusionFinding[] = [];
  const labels = lowerSet(options.item.labels);
  const assignees = lowerSet(options.item.assignees);
  findings.push(...statusExclusionFindings(options));
  findings.push(...requiredLabelExclusionFindings(options, labels));
  findings.push(...excludedLabelFindings(options, labels));
  findings.push(...assigneeExclusionFindings(options, assignees));
  findings.push(...milestoneExclusionFindings(options));
  findings.push(...searchExclusionFindings(options));
  return uniqueExclusionFindings(findings);
}

function statusExclusionFindings(options: {
  item: WorkItem;
  selectorQuery: WorkItemQuery;
  policy: ResolvedNexusProjectComponent["trackerDiscovery"];
}): NexusEligibleWorkExclusionFinding[] {
  const statuses = mergedStatuses(
    options.selectorQuery.status,
    options.policy.statuses,
  );
  return statuses.length > 0 && !statuses.includes(options.item.status)
    ? [
        {
          category: "status",
          reason: `status ${options.item.status} not selected`,
          value: options.item.status,
        },
      ]
    : [];
}

function requiredLabelExclusionFindings(
  options: {
    selectorQuery: WorkItemQuery;
    policy: ResolvedNexusProjectComponent["trackerDiscovery"];
  },
  labels: Set<string>,
): NexusEligibleWorkExclusionFinding[] {
  return uniqueStrings([
    ...(options.selectorQuery.labels ?? []),
    ...options.policy.labels,
  ]).flatMap((label) =>
    labels.has(label.toLowerCase())
      ? []
      : [{ category: "required_label", reason: `missing label ${label}`, value: label }],
  );
}

function excludedLabelFindings(
  options: { automationConfig: NexusAutomationConfig },
  labels: Set<string>,
): NexusEligibleWorkExclusionFinding[] {
  return options.automationConfig.selector.excludeLabels.flatMap((label) =>
    labels.has(label.toLowerCase())
      ? [{ category: "excluded_label", reason: `excluded label ${label}`, value: label }]
      : [],
  );
}

function assigneeExclusionFindings(
  options: {
    selectorQuery: WorkItemQuery;
    policy: ResolvedNexusProjectComponent["trackerDiscovery"];
  },
  assignees: Set<string>,
): NexusEligibleWorkExclusionFinding[] {
  return uniqueStrings([
    ...(options.selectorQuery.assignees ?? []),
    ...options.policy.assignees,
  ]).flatMap((assignee) =>
    assignees.has(assignee.toLowerCase())
      ? []
      : [{ category: "assignee", reason: `missing assignee ${assignee}`, value: assignee }],
  );
}

function milestoneExclusionFindings(options: {
  item: WorkItem;
  policy: ResolvedNexusProjectComponent["trackerDiscovery"];
}): NexusEligibleWorkExclusionFinding[] {
  const milestone = options.item.milestone ?? null;
  return options.policy.milestones.length > 0 &&
    (!milestone || !options.policy.milestones.includes(milestone))
    ? [{ category: "milestone", reason: "missing milestone", value: milestone }]
    : [];
}

function searchExclusionFindings(options: {
  item: WorkItem;
  selectorQuery: WorkItemQuery;
  policy: ResolvedNexusProjectComponent["trackerDiscovery"];
}): NexusEligibleWorkExclusionFinding[] {
  return uniqueStrings([
    options.policy.providerQuery ?? "",
    options.selectorQuery.search ?? "",
  ])
    .filter((value) => value.length > 0)
    .flatMap((search) =>
      matchesSearch(options.item, search)
        ? []
        : [{ category: "search", reason: `search mismatch ${search}`, value: search }],
    );
}

function matchesSearch(item: WorkItem, search: string): boolean {
  const needle = search.toLowerCase();
  return [item.id, item.title, item.description ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

function lowerSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function excludedFromEligibleItem(
  item: NexusEligibleWorkItem,
  reason: string,
): NexusEligibleWorkExcludedItem {
  return {
    ...item,
    sourceTrackerRef: item.sourceTrackerRef,
    reasons: [reason],
    exclusionFindings: [
      {
        category: "limit",
        reason,
        value: null,
      },
    ],
  };
}

function uniqueExclusionFindings(
  findings: NexusEligibleWorkExclusionFinding[],
): NexusEligibleWorkExclusionFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.category}\u0000${finding.reason}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  const neutralSelectorStatuses = selectorStatuses.filter(isWorkStatus);
  if (selectorStatuses.length === 0) {
    return [...policyStatuses];
  }
  if (policyStatuses.length === 0) {
    return [...neutralSelectorStatuses];
  }
  const policySet = new Set(policyStatuses);
  return neutralSelectorStatuses.filter((status) => policySet.has(status));
}

function isWorkStatus(status: WorkStatusQuery): status is WorkStatus {
  return (
    status === "todo" ||
    status === "ready" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "done" ||
    status === "wont_do"
  );
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
    excludedCount: 0,
    exclusionReasonCounts: {},
    exclusionCategoryCounts: {},
    warnings: options.warnings,
    blockers: options.blockers,
  };
}

function createProvider(
  options: ListNexusEligibleWorkOptions,
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): Promise<WorkTrackerProvider> {
  if (options.provider) {
    return Promise.resolve(options.provider);
  }
  if (options.providerFactory) {
    return Promise.resolve(
      options.providerFactory({
        projectRoot: options.projectRoot,
        projectConfig: options.projectConfig,
        component,
        tracker,
        workTracking: tracker.workTracking,
      }),
    );
  }

  return createWorkTrackerProviderAsync(tracker.workTracking, {
    ...providerOptionsWithEnv(options.providerOptions, options.env),
    projectRoot: options.projectRoot,
    now: options.now,
  });
}

function providerOptionsWithEnv(
  providerOptions: CreateWorkTrackerProviderOptions | undefined,
  env: NodeJS.ProcessEnv | undefined,
): CreateWorkTrackerProviderOptions | undefined {
  if (!env) {
    return providerOptions;
  }

  return {
    ...providerOptions,
    github: {
      ...providerOptions?.github,
      env: providerOptions?.github?.env ?? env,
    },
    gitlab: {
      ...providerOptions?.gitlab,
      env: providerOptions?.gitlab?.env ?? env,
    },
    jira: {
      ...providerOptions?.jira,
      env: providerOptions?.jira?.env ?? env,
    },
  };
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
  dedupe: NexusEligibleWorkDedupeInfo | null;
  warnings: string[];
}): NexusEligibleWorkItem {
  return {
    ...options.item,
    componentId: options.component.id,
    logicalItemId: options.logicalItemId,
    trackerRef: options.canonicalTrackerRef ?? options.sourceTrackerRef,
    canonicalTrackerRef: options.canonicalTrackerRef,
    sourceTrackerRef: options.sourceTrackerRef,
    dedupe: options.dedupe,
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

function candidateIdentityKeys(options: {
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  item: WorkItem;
  linkRecord: WorkItemTrackerLinkRecord | null;
}): CandidateIdentityKey[] {
  const keys: CandidateIdentityKey[] = [];
  if (options.linkRecord) {
    keys.push({
      key: `link:${options.component.id}:${options.linkRecord.logicalItemId}`,
      reason: "tracker_link",
      linkId: options.linkRecord.logicalItemId,
      logicalItemId: options.linkRecord.logicalItemId,
    });
  }

  for (const identity of providerIdentityKeys(options.tracker, options.item)) {
    keys.push(identity);
  }
  for (const identity of configuredFingerprintKeys(options)) {
    keys.push(identity);
  }

  return dedupeIdentityKeys(keys);
}

function providerIdentityKeys(
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): CandidateIdentityKey[] {
  return identityRefsForItem(tracker, item).flatMap(({ ref, reason }) =>
    stableExternalRefKeys(ref).map((key) => ({
      key,
      reason,
    })),
  );
}

function identityRefsForItem(
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): Array<{ ref: ExternalRef; reason: "external_ref" | "provider_identity" }> {
  const refs: Array<{ ref: ExternalRef; reason: "external_ref" | "provider_identity" }> = [];
  if (item.externalRef) {
    refs.push({
      ref: item.externalRef,
      reason:
        item.provider === "local" && item.externalRef.provider !== "local"
          ? "external_ref"
          : "provider_identity",
    });
  }
  if (item.provider === tracker.provider) {
    refs.push({
      ref: providerExternalRefForItem(tracker, item),
      reason: "provider_identity",
    });
  }

  return dedupeIdentityRefs(refs);
}

function providerExternalRefForItem(
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): ExternalRef {
  const externalRef =
    item.externalRef?.provider === tracker.provider ? item.externalRef : undefined;
  const config = tracker.workTracking;
  return {
    provider: tracker.provider,
    host: externalRef?.host ?? config.host ?? null,
    repositoryId: externalRef?.repositoryId ?? config.repository?.id ?? null,
    repositoryOwner:
      externalRef?.repositoryOwner ?? config.repository?.owner ?? null,
    repositoryName:
      externalRef?.repositoryName ?? config.repository?.name ?? null,
    projectId:
      externalRef?.projectId ?? configuredProjectIdentity(config) ?? null,
    boardId: externalRef?.boardId ?? config.board?.id ?? null,
    itemId: externalRef?.itemId ?? item.id,
    itemNumber: externalRef?.itemNumber ?? null,
    itemKey: externalRef?.itemKey ?? null,
    nodeId: externalRef?.nodeId ?? null,
    webUrl: externalRef?.webUrl ?? item.webUrl ?? null,
  };
}

function stableExternalRefKeys(ref: ExternalRef): string[] {
  const provider = normalizedIdentityPart(ref.provider);
  const host = normalizedNullableIdentityPart(ref.host);
  const scope = externalRefScope(ref);
  if (ref.nodeId) {
    return [`provider:${provider}:host:${host}:node:${normalizedIdentityPart(ref.nodeId)}`];
  }
  if (ref.itemKey) {
    return [`provider:${provider}:host:${host}:key:${normalizedIdentityPart(ref.itemKey)}`];
  }
  if (scope && ref.itemNumber !== undefined && ref.itemNumber !== null) {
    return [`provider:${provider}:host:${host}:${scope}:number:${ref.itemNumber}`];
  }
  if (scope && ref.itemId) {
    return [`provider:${provider}:host:${host}:${scope}:item:${normalizedIdentityPart(ref.itemId)}`];
  }

  return [];
}

function externalRefScope(ref: ExternalRef): string | null {
  if (ref.repositoryId) {
    return `repo-id:${normalizedIdentityPart(ref.repositoryId)}`;
  }
  if (ref.repositoryOwner && ref.repositoryName) {
    return `repo:${normalizedIdentityPart(ref.repositoryOwner)}/${normalizedIdentityPart(ref.repositoryName)}`;
  }
  if (ref.projectId) {
    return `project:${normalizedIdentityPart(ref.projectId)}`;
  }
  if (ref.boardId) {
    return `board:${normalizedIdentityPart(ref.boardId)}`;
  }

  return null;
}

function configuredFingerprintKeys(options: {
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  item: WorkItem;
}): CandidateIdentityKey[] {
  return options.component.trackerDiscovery.fingerprints
    .filter((fingerprint) =>
      fingerprintMatchesItem(fingerprint, options.tracker, options.item),
    )
    .map((fingerprint) => ({
      key: `fingerprint:${options.component.id}:${fingerprint.id}`,
      reason: "configured_fingerprint",
    }));
}

function fingerprintMatchesItem(
  fingerprint: NexusProjectTrackerDiscoveryFingerprintConfig,
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): boolean {
  if (fingerprint.trackerId && fingerprint.trackerId !== tracker.id) {
    return false;
  }

  return identityRefsForItem(tracker, item).some(({ ref }) =>
    fingerprintMatchesExternalRef(fingerprint, ref, item),
  );
}

function fingerprintMatchesExternalRef(
  fingerprint: NexusProjectTrackerDiscoveryFingerprintConfig,
  ref: ExternalRef,
  item: WorkItem,
): boolean {
  return (
    optionalMatch(fingerprint.provider, ref.provider) &&
    optionalMatch(fingerprint.host, ref.host ?? null) &&
    optionalMatch(fingerprint.repositoryId, ref.repositoryId ?? null) &&
    optionalMatch(fingerprint.repositoryOwner, ref.repositoryOwner ?? null) &&
    optionalMatch(fingerprint.repositoryName, ref.repositoryName ?? null) &&
    optionalMatch(fingerprint.projectId, ref.projectId ?? null) &&
    optionalMatch(fingerprint.boardId, ref.boardId ?? null) &&
    optionalItemIdMatch(fingerprint.itemId, ref.itemId, item.id) &&
    optionalMatch(fingerprint.itemNumber, ref.itemNumber ?? null) &&
    optionalMatch(fingerprint.itemKey, ref.itemKey ?? null) &&
    optionalMatch(fingerprint.nodeId, ref.nodeId ?? null)
  );
}

function optionalMatch<T>(expected: T | null | undefined, actual: T | null): boolean {
  return expected === undefined || expected === actual;
}

function optionalItemIdMatch(
  expected: string | undefined,
  refItemId: string,
  itemId: string,
): boolean {
  return expected === undefined || expected === refItemId || expected === itemId;
}

function dedupeIdentityKeys(
  keys: CandidateIdentityKey[],
): CandidateIdentityKey[] {
  const seen = new Set<string>();
  const result: CandidateIdentityKey[] = [];
  for (const key of keys) {
    if (seen.has(key.key)) {
      continue;
    }
    seen.add(key.key);
    result.push(key);
  }

  return result;
}

function dedupeIdentityRefs(
  refs: Array<{ ref: ExternalRef; reason: "external_ref" | "provider_identity" }>,
): Array<{ ref: ExternalRef; reason: "external_ref" | "provider_identity" }> {
  const seen = new Set<string>();
  const result: Array<{ ref: ExternalRef; reason: "external_ref" | "provider_identity" }> = [];
  for (const ref of refs) {
    const key = [
      ref.ref.provider,
      ref.ref.host ?? "",
      ref.ref.repositoryId ?? "",
      ref.ref.repositoryOwner ?? "",
      ref.ref.repositoryName ?? "",
      ref.ref.projectId ?? "",
      ref.ref.boardId ?? "",
      ref.ref.itemId,
      ref.ref.itemNumber ?? "",
      ref.ref.itemKey ?? "",
      ref.ref.nodeId ?? "",
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(ref);
  }

  return result;
}

function observedReferenceKeys(
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): string[] {
  return uniqueStrings([
    referenceObservedKey({
      trackerId: tracker.id,
      provider: tracker.provider,
      itemId: item.id,
    }),
    ...(item.externalRef?.provider === tracker.provider
      ? [
          referenceObservedKey({
            trackerId: tracker.id,
            provider: tracker.provider,
            itemId: item.externalRef.itemId,
          }),
        ]
      : []),
  ]);
}

function referenceObservedKey(
  reference: Pick<WorkItemTrackerReference, "trackerId" | "provider" | "itemId">,
): string {
  return [
    reference.trackerId,
    normalizedIdentityPart(reference.provider),
    reference.itemId,
  ].join("\u0000");
}

function defaultLogicalItemId(item: WorkItem): string {
  return item.provider === "local"
    ? item.id
    : item.externalRef?.itemId ?? item.id;
}

function configuredProjectIdentity(
  config: WorkTrackingConfig,
): string | null | undefined {
  if (config.provider === "vibe-kanban") {
    return config.projectId;
  }
  if (config.provider === "jira") {
    return config.projectKey;
  }

  return undefined;
}

function normalizedIdentityPart(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedNullableIdentityPart(value: string | null | undefined): string {
  return value ? normalizedIdentityPart(value) : "";
}

function findLinkRecordsForItem(
  records: WorkItemTrackerLinkRecord[],
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): WorkItemTrackerLinkRecord[] {
  return records.filter(
    (record) =>
      record.componentId === component.id &&
      record.references.some((reference) =>
        referenceMatchesItem(reference, tracker, item),
      ),
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
