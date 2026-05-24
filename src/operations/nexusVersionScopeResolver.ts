import path from "node:path";
import type { NexusProjectConfig } from "../project/nexusProjectConfig.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "../project/nexusProjectLifecycle.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  type WorkItemTrackerLinkRecord,
  type WorkItemTrackerReference,
} from "../work-items/workItemTrackerLinks.js";
import { createWorkTrackerProvider } from "../work-items/workTrackingProviderService.js";
import type {
  ExternalRef,
  WorkItem,
  WorkItemQuery,
  WorkTrackerProvider,
  WorkTrackerRef,
  WorkTrackingConfig,
} from "../work-items/workTrackingTypes.js";
import type {
  NexusVersionConfig,
  NexusVersionScopeEntry,
  NexusVersionScopeStatus,
  NexusVersionTrackerQueryDescriptor,
} from "./nexusVersionPlanningConfig.js";

export type NexusVersionScopeWarningCode =
  | "unknown_component"
  | "unknown_tracker"
  | "disabled_tracker"
  | "provider_mismatch"
  | "unsupported_get"
  | "unsupported_list"
  | "unsupported_labels"
  | "unsupported_milestones"
  | "unsupported_assignees"
  | "unresolved_work_item"
  | "provider_read_failed"
  | "no_scope_matches"
  | "ambiguous_tracker_links";

export type NexusVersionScopeDedupeReason =
  | "tracker_link"
  | "external_ref"
  | "provider_identity";

export interface NexusVersionScopeWarning {
  code: NexusVersionScopeWarningCode;
  message: string;
  componentId: string;
  trackerId: string | null;
  entryIndex: number;
}

export interface NexusVersionScopeDedupeInfo {
  reason: NexusVersionScopeDedupeReason;
  key: string;
  collapsedCount: number;
  logicalItemId?: string;
  linkId?: string;
}

export interface NexusVersionResolvedScopeItem {
  versionId: string;
  componentId: string;
  workItem: WorkItem;
  scopeStatus: NexusVersionScopeStatus;
  scopeStatuses: NexusVersionScopeStatus[];
  scopeEntryIndexes: number[];
  scopeEntries: NexusVersionScopeEntry[];
  sourceTrackerRef: WorkTrackerRef;
  canonicalTrackerRef: WorkTrackerRef | null;
  logicalItemId: string | null;
  dedupe: NexusVersionScopeDedupeInfo | null;
}

export interface NexusVersionScopeResult {
  versionId: string;
  items: NexusVersionResolvedScopeItem[];
  warnings: NexusVersionScopeWarning[];
}

export interface NexusVersionScopeProviderContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  version: NexusVersionConfig;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  workTracking: WorkTrackingConfig;
}

export type NexusVersionScopeProviderFactory = (
  context: NexusVersionScopeProviderContext,
) => WorkTrackerProvider;

export interface ResolveNexusVersionScopeOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  version: NexusVersionConfig;
  providerFactory?: NexusVersionScopeProviderFactory;
  linkRecords?: WorkItemTrackerLinkRecord[];
}

interface VersionScopeCandidateIdentity {
  key: string;
  reason: NexusVersionScopeDedupeReason;
  linkId?: string;
  logicalItemId?: string;
}

interface VersionScopeCandidate {
  order: number;
  versionId: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  workItem: WorkItem;
  scopeEntry: NexusVersionScopeEntry;
  scopeStatus: NexusVersionScopeStatus;
  scopeEntryIndex: number;
  sourceTrackerRef: WorkTrackerRef;
  canonicalTrackerRef: WorkTrackerRef | null;
  logicalItemId: string | null;
  linkRecords: WorkItemTrackerLinkRecord[];
  defaultReference: WorkItemTrackerReference | null;
  identityKeys: VersionScopeCandidateIdentity[];
}

interface ProviderCacheEntry {
  provider: WorkTrackerProvider;
}

export async function resolveNexusVersionScope(
  options: ResolveNexusVersionScopeOptions,
): Promise<NexusVersionScopeResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(
    options.projectRoot,
    "projectRoot",
  ));
  const warnings: NexusVersionScopeWarning[] = [];
  const linkRecords = (options.linkRecords ??
    loadWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot))
      .records).filter((record) => record.projectId === options.projectConfig.id);
  const providerCache = new Map<string, ProviderCacheEntry>();
  const candidates: VersionScopeCandidate[] = [];
  let order = 0;

  for (const [entryIndex, entry] of options.version.scope.entries()) {
    const component = options.components.find(
      (candidate) => candidate.id === entry.componentId,
    );
    if (!component) {
      warnings.push(warning({
        code: "unknown_component",
        message: `Version ${options.version.id} scope entry references unknown component "${entry.componentId}".`,
        componentId: entry.componentId,
        trackerId: entry.trackerId,
        entryIndex,
      }));
      continue;
    }

    const tracker = resolveScopeTracker(component, entry.trackerId);
    if (!tracker) {
      warnings.push(warning({
        code: "unknown_tracker",
        message: `Component ${component.id} work tracker is not configured: ${entry.trackerId ?? component.defaultTrackerId ?? "default"}.`,
        componentId: component.id,
        trackerId: entry.trackerId ?? component.defaultTrackerId,
        entryIndex,
      }));
      continue;
    }
    if (!tracker.enabled) {
      warnings.push(warning({
        code: "disabled_tracker",
        message: `Component ${component.id} work tracker "${tracker.id}" is disabled.`,
        componentId: component.id,
        trackerId: tracker.id,
        entryIndex,
      }));
      continue;
    }

    const provider = providerFor({
      options,
      projectRoot,
      component,
      tracker,
      providerCache,
    });
    const matchedItems = await resolveScopeEntryItems({
      projectRoot,
      component,
      tracker,
      provider,
      entry,
      entryIndex,
      warnings,
    });
    for (const item of matchedItems) {
      candidates.push(candidateFromItem({
        order,
        versionId: options.version.id,
        component,
        tracker,
        item,
        entry,
        entryIndex,
        linkRecords,
      }));
      order += 1;
    }
  }

  return {
    versionId: options.version.id,
    items: materializeScopeItems(candidates, warnings),
    warnings,
  };
}

async function resolveScopeEntryItems(options: {
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
  entry: NexusVersionScopeEntry;
  entryIndex: number;
  warnings: NexusVersionScopeWarning[];
}): Promise<WorkItem[]> {
  const capabilities = options.tracker.workTrackingCapabilityReport.capabilities;
  const entry = options.entry;
  switch (entry.kind) {
    case "work_item":
      if (!capabilities.get) {
        options.warnings.push(warning({
          code: "unsupported_get",
          message: `Component ${options.component.id} tracker ${options.tracker.id} does not support direct work-item reads.`,
          componentId: options.component.id,
          trackerId: options.tracker.id,
          entryIndex: options.entryIndex,
        }));
        return [];
      }
      try {
        return [
          await options.provider.getWorkItem({
            id: entry.workItemId,
          }),
        ];
      } catch (error) {
        options.warnings.push(warning({
          code: "unresolved_work_item",
          message: `Component ${options.component.id} tracker ${options.tracker.id} work item "${entry.workItemId}" could not be resolved: ${errorMessage(error)}.`,
          componentId: options.component.id,
          trackerId: options.tracker.id,
          entryIndex: options.entryIndex,
        }));
        return [];
      }
    case "label":
      if (!capabilities.labels) {
        options.warnings.push(warning({
          code: "unsupported_labels",
          message: `Component ${options.component.id} tracker ${options.tracker.id} does not report label filtering support for "${entry.label}".`,
          componentId: options.component.id,
          trackerId: options.tracker.id,
          entryIndex: options.entryIndex,
        }));
      }
      return listAndFilterScopeItems({
        ...options,
        query: capabilities.labels ? { labels: [entry.label] } : {},
        filter: (item) => item.labels?.includes(entry.label) ?? false,
      });
    case "milestone":
      if (!capabilities.milestones) {
        options.warnings.push(warning({
          code: "unsupported_milestones",
          message: `Component ${options.component.id} tracker ${options.tracker.id} does not report milestone filtering support for "${entry.milestone}".`,
          componentId: options.component.id,
          trackerId: options.tracker.id,
          entryIndex: options.entryIndex,
        }));
      }
      return listAndFilterScopeItems({
        ...options,
        query: {},
        filter: (item) => item.milestone === entry.milestone,
      });
    case "tracker_query":
      return listTrackerQueryScopeItems({ ...options, entry });
  }
}

async function listTrackerQueryScopeItems(options: {
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
  entry: Extract<NexusVersionScopeEntry, { kind: "tracker_query" }>;
  entryIndex: number;
  warnings: NexusVersionScopeWarning[];
}): Promise<WorkItem[]> {
  const descriptor = options.entry.query;
  if (descriptor.provider && descriptor.provider !== options.tracker.provider) {
    options.warnings.push(warning({
      code: "provider_mismatch",
      message: `Version scope query asks for provider "${descriptor.provider}" but component ${options.component.id} tracker ${options.tracker.id} uses "${options.tracker.provider}".`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
    return [];
  }

  const capabilities = options.tracker.workTrackingCapabilityReport.capabilities;
  if (descriptor.labels.length > 0 && !capabilities.labels) {
    options.warnings.push(warning({
      code: "unsupported_labels",
      message: `Component ${options.component.id} tracker ${options.tracker.id} does not report label filtering support for query labels.`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
  }
  if (descriptor.milestones.length > 0 && !capabilities.milestones) {
    options.warnings.push(warning({
      code: "unsupported_milestones",
      message: `Component ${options.component.id} tracker ${options.tracker.id} does not report milestone filtering support for query milestones.`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
  }
  if (descriptor.assignees.length > 0 && !capabilities.assignees) {
    options.warnings.push(warning({
      code: "unsupported_assignees",
      message: `Component ${options.component.id} tracker ${options.tracker.id} does not report assignee filtering support for query assignees.`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
  }

  const query = trackerQuery(descriptor, capabilities);
  return listAndFilterScopeItems({
    ...options,
    query,
    filter: (item) => itemMatchesTrackerQuery(item, descriptor),
  });
}

async function listAndFilterScopeItems(options: {
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
  entry: NexusVersionScopeEntry;
  entryIndex: number;
  warnings: NexusVersionScopeWarning[];
  query: WorkItemQuery;
  filter: (item: WorkItem) => boolean;
}): Promise<WorkItem[]> {
  const capabilities = options.tracker.workTrackingCapabilityReport.capabilities;
  if (!capabilities.list) {
    options.warnings.push(warning({
      code: "unsupported_list",
      message: `Component ${options.component.id} tracker ${options.tracker.id} does not support listing work items.`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
    return [];
  }

  let listed: WorkItem[];
  try {
    listed = await options.provider.listWorkItems({
      ...options.query,
      projectRoot: options.projectRoot,
    });
  } catch (error) {
    options.warnings.push(warning({
      code: "provider_read_failed",
      message: `Component ${options.component.id} tracker ${options.tracker.id} read failed: ${errorMessage(error)}.`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
    return [];
  }

  const matched = listed.filter(options.filter);
  if (matched.length === 0) {
    options.warnings.push(warning({
      code: "no_scope_matches",
      message: `Component ${options.component.id} tracker ${options.tracker.id} scope entry matched no work items.`,
      componentId: options.component.id,
      trackerId: options.tracker.id,
      entryIndex: options.entryIndex,
    }));
  }

  return matched;
}

function trackerQuery(
  descriptor: NexusVersionTrackerQueryDescriptor,
  capabilities: ResolvedNexusProjectWorkTracker["workTrackingCapabilityReport"]["capabilities"],
): WorkItemQuery {
  return {
    ...(descriptor.statuses.length > 0 ? { status: descriptor.statuses } : {}),
    ...(descriptor.labels.length > 0 && capabilities.labels
      ? { labels: descriptor.labels }
      : {}),
    ...(descriptor.assignees.length > 0 && capabilities.assignees
      ? { assignees: descriptor.assignees }
      : {}),
    ...(descriptor.text ? { search: descriptor.text } : {}),
  };
}

function itemMatchesTrackerQuery(
  item: WorkItem,
  descriptor: NexusVersionTrackerQueryDescriptor,
): boolean {
  if (
    descriptor.provider &&
    item.provider !== descriptor.provider &&
    item.externalRef?.provider !== descriptor.provider
  ) {
    return false;
  }
  if (
    descriptor.statuses.length > 0 &&
    !descriptor.statuses.includes(item.status)
  ) {
    return false;
  }
  if (descriptor.labels.some((label) => !item.labels?.includes(label))) {
    return false;
  }
  if (descriptor.milestones.length > 0) {
    if (!item.milestone || !descriptor.milestones.includes(item.milestone)) {
      return false;
    }
  }
  if (descriptor.assignees.some((assignee) => !item.assignees?.includes(assignee))) {
    return false;
  }
  if (descriptor.text && !itemMatchesText(item, descriptor.text)) {
    return false;
  }

  return true;
}

function candidateFromItem(options: {
  order: number;
  versionId: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  item: WorkItem;
  entry: NexusVersionScopeEntry;
  entryIndex: number;
  linkRecords: WorkItemTrackerLinkRecord[];
}): VersionScopeCandidate {
  const sourceTrackerRef = trackerRef(options.component, options.tracker);
  const linkRecords = findLinkRecordsForItem(
    options.linkRecords,
    options.component,
    options.tracker,
    options.item,
  );
  const linkRecord = linkRecords.length === 1 ? linkRecords[0]! : null;
  const defaultTrackerRef = options.component.defaultTrackerId
    ? trackerRefById(options.component, options.component.defaultTrackerId)
    : null;
  const defaultReference = options.component.defaultTrackerId
    ? linkRecord?.references.find(
        (reference) => reference.trackerId === options.component.defaultTrackerId,
      ) ?? null
    : null;
  const sourceIsDefault = options.tracker.default;
  const canonicalTrackerRef =
    sourceIsDefault ? sourceTrackerRef : defaultReference && defaultTrackerRef
      ? defaultTrackerRef
      : sourceTrackerRef;
  const logicalItemId = linkRecord?.logicalItemId ?? defaultLogicalItemId(options.item);
  const workItem =
    !sourceIsDefault && defaultReference && defaultTrackerRef
      ? canonicalizedLinkedWorkItem(options.item, defaultTrackerRef, defaultReference)
      : options.item;

  return {
    order: options.order,
    versionId: options.versionId,
    component: options.component,
    tracker: options.tracker,
    workItem,
    scopeEntry: options.entry,
    scopeStatus: options.entry.status,
    scopeEntryIndex: options.entryIndex,
    sourceTrackerRef,
    canonicalTrackerRef,
    logicalItemId,
    linkRecords,
    defaultReference,
    identityKeys: candidateIdentityKeys({
      component: options.component,
      tracker: options.tracker,
      item: options.item,
      linkRecord,
    }),
  };
}

function materializeScopeItems(
  candidates: VersionScopeCandidate[],
  warnings: NexusVersionScopeWarning[],
): NexusVersionResolvedScopeItem[] {
  for (const candidate of candidates) {
    if (candidate.linkRecords.length > 1) {
      warnings.push(warning({
        code: "ambiguous_tracker_links",
        message: `Work item "${candidate.workItem.id}" from tracker "${candidate.tracker.id}" matches conflicting link records: ${candidate.linkRecords
          .map((record) => record.logicalItemId)
          .join(", ")}.`,
        componentId: candidate.component.id,
        trackerId: candidate.tracker.id,
        entryIndex: candidate.scopeEntryIndex,
      }));
    }
  }

  return dedupeCandidateGroups(candidates)
    .map((group) => resolvedScopeItem(group))
    .sort((left, right) => left.scopeEntryIndexes[0]! - right.scopeEntryIndexes[0]!);
}

function resolvedScopeItem(
  candidates: VersionScopeCandidate[],
): NexusVersionResolvedScopeItem {
  const sorted = [...candidates].sort((left, right) => left.order - right.order);
  const preferred = choosePreferredCandidate(sorted);
  const scopeStatuses = uniqueValues(sorted.map((candidate) => candidate.scopeStatus));
  const scopeEntries = sorted.map((candidate) => candidate.scopeEntry);
  const scopeEntryIndexes = sorted.map((candidate) => candidate.scopeEntryIndex);

  return {
    versionId: preferred.versionId,
    componentId: preferred.component.id,
    workItem: preferred.workItem,
    scopeStatus: scopeStatuses[0]!,
    scopeStatuses,
    scopeEntryIndexes,
    scopeEntries,
    sourceTrackerRef: preferred.sourceTrackerRef,
    canonicalTrackerRef: preferred.canonicalTrackerRef,
    logicalItemId: preferred.logicalItemId,
    dedupe: sorted.length > 1 ? dedupeInfo(sorted) : null,
  };
}

function choosePreferredCandidate(
  sorted: VersionScopeCandidate[],
): VersionScopeCandidate {
  return (
    sorted.find((candidate) => candidate.sourceTrackerRef.default) ??
    sorted.find((candidate) => candidate.canonicalTrackerRef?.default) ??
    sorted[0]!
  );
}

function dedupeCandidateGroups(
  candidates: VersionScopeCandidate[],
): VersionScopeCandidate[][] {
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

  for (const indexes of identityGroups.values()) {
    if (indexes.length < 2) {
      continue;
    }
    const [first, ...rest] = indexes;
    for (const index of rest) {
      union(first!, index);
    }
  }

  const groups = new Map<number, VersionScopeCandidate[]>();
  for (const [index, candidate] of candidates.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }

  return [...groups.values()];
}

function candidateIndexesByIdentityKey(
  candidates: VersionScopeCandidate[],
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

function dedupeInfo(
  candidates: VersionScopeCandidate[],
): NexusVersionScopeDedupeInfo {
  const identities = candidates.flatMap((candidate) => candidate.identityKeys);
  const identity =
    identities.find((candidate) => candidate.reason === "tracker_link") ??
    identities.find((candidate) => candidate.reason === "external_ref") ??
    identities.find((candidate) => candidate.reason === "provider_identity");

  return {
    reason: identity?.reason ?? "provider_identity",
    key: identity?.key ?? `scope:${candidates[0]!.component.id}:${candidates[0]!.workItem.id}`,
    collapsedCount: candidates.length,
    ...(identity?.logicalItemId ? { logicalItemId: identity.logicalItemId } : {}),
    ...(identity?.linkId ? { linkId: identity.linkId } : {}),
  };
}

function candidateIdentityKeys(options: {
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  item: WorkItem;
  linkRecord: WorkItemTrackerLinkRecord | null;
}): VersionScopeCandidateIdentity[] {
  const keys: VersionScopeCandidateIdentity[] = [];
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

  return dedupeIdentityKeys(keys);
}

function providerIdentityKeys(
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
): VersionScopeCandidateIdentity[] {
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

  return dedupeIdentityRefs(refs).flatMap(({ ref, reason }) =>
    stableExternalRefKeys(ref).map((key) => ({
      key,
      reason,
    })),
  );
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
  if (reference.trackerId !== tracker.id || reference.provider !== tracker.provider) {
    return false;
  }
  if (!item.externalRef) {
    return reference.itemId === item.id;
  }

  return externalRefMatchesReference(item.externalRef, reference) ||
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

function dedupeIdentityKeys(
  keys: VersionScopeCandidateIdentity[],
): VersionScopeCandidateIdentity[] {
  const seen = new Set<string>();
  const result: VersionScopeCandidateIdentity[] = [];
  for (const key of keys) {
    if (seen.has(key.key)) {
      continue;
    }
    seen.add(key.key);
    result.push(key);
  }

  return result;
}

function resolveScopeTracker(
  component: ResolvedNexusProjectComponent,
  trackerId: string | null,
): ResolvedNexusProjectWorkTracker | null {
  const id = trackerId ?? component.defaultTrackerId;
  if (!id) {
    return component.workTrackers[0] ?? null;
  }

  return component.workTrackers.find((candidate) => candidate.id === id) ?? null;
}

function providerFor(options: {
  options: ResolveNexusVersionScopeOptions;
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  providerCache: Map<string, ProviderCacheEntry>;
}): WorkTrackerProvider {
  const cacheKey = `${options.component.id}\u0000${options.tracker.id}`;
  const cached = options.providerCache.get(cacheKey);
  if (cached) {
    return cached.provider;
  }

  const provider = options.options.providerFactory
    ? options.options.providerFactory({
        projectRoot: options.projectRoot,
        projectConfig: options.options.projectConfig,
        version: options.options.version,
        component: options.component,
        tracker: options.tracker,
        workTracking: options.tracker.workTracking,
      })
    : createWorkTrackerProvider(options.tracker.workTracking, {
        projectRoot: options.projectRoot,
      });
  options.providerCache.set(cacheKey, { provider });
  return provider;
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

function trackerRefById(
  component: ResolvedNexusProjectComponent,
  trackerId: string,
): WorkTrackerRef | null {
  const tracker = component.workTrackers.find((candidate) => candidate.id === trackerId);
  return tracker ? trackerRef(component, tracker) : null;
}

function canonicalizedLinkedWorkItem(
  item: WorkItem,
  defaultTrackerRef: WorkTrackerRef,
  defaultReference: WorkItemTrackerReference,
): WorkItem {
  return {
    ...item,
    id: defaultReference.itemId,
    provider: defaultTrackerRef.provider,
    externalRef: {
      provider: defaultTrackerRef.provider,
      host: defaultReference.host,
      repositoryId: defaultReference.repositoryId,
      repositoryOwner: defaultReference.repositoryOwner,
      repositoryName: defaultReference.repositoryName,
      projectId: defaultReference.projectId,
      boardId: defaultReference.boardId,
      itemId: defaultReference.itemId,
      itemNumber: defaultReference.itemNumber,
      itemKey: defaultReference.itemKey,
      nodeId: defaultReference.nodeId,
      webUrl: defaultReference.webUrl,
    },
  };
}

function defaultLogicalItemId(item: WorkItem): string {
  return item.provider === "local"
    ? item.id
    : item.externalRef?.itemId ?? item.id;
}

function itemMatchesText(item: WorkItem, text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return [item.id, item.title, item.description ?? "", item.webUrl ?? ""].some(
    (value) => value.toLowerCase().includes(normalized),
  );
}

function configuredProjectIdentity(
  config: WorkTrackingConfig,
): string | null | undefined {
  if (config.provider === "jira") {
    return config.projectKey;
  }

  return undefined;
}

function warning(input: NexusVersionScopeWarning): NexusVersionScopeWarning {
  return input;
}

function uniqueValues<T>(values: T[]): T[] {
  const result: T[] = [];
  for (const value of values) {
    if (!result.includes(value)) {
      result.push(value);
    }
  }

  return result;
}

function normalizedIdentityPart(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedNullableIdentityPart(value: string | null | undefined): string {
  return value ? normalizedIdentityPart(value) : "";
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
