import type {
  NexusAutomationTargetCycleRecord,
} from "../automation/nexusAutomationTargetCycle.js";
import type {
  NexusAuthorityProjectSummary,
} from "../authority/nexusAuthority.js";
import type {
  NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import type {
  ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  reportNexusVersionReadiness,
  type NexusVersionReadinessGateReport,
} from "./nexusVersionReadiness.js";
import type {
  NexusVersionConfig,
  NexusVersionScopeEntry,
  NexusVersionScopeKind,
  NexusVersionScopeStatus,
  NexusVersionTrackerQueryDescriptor,
} from "./nexusVersionPlanningConfig.js";
import type {
  NexusVersionResolvedScopeItem,
  NexusVersionScopeResult,
} from "./nexusVersionScopeResolver.js";
import type {
  WorkItem,
  WorkStatus,
  WorkTrackerRef,
} from "../work-items/workTrackingTypes.js";
import type {
  WorktreePublicationDecision,
  WorktreeVerificationRecord,
} from "../worktrees/worktreeExecutionMetadata.js";

export type NexusVersionPlanningReadinessState =
  | "ready"
  | "blocked"
  | "warning";

export interface NexusVersionPlanningSurfaceWorkItemInput {
  componentId: string;
  workItem: WorkItem;
  logicalItemId?: string | null;
  trackerId?: string | null;
  trackerProvider?: string | null;
}

export interface NexusVersionPlanningSurfaceOptions {
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  workItems: NexusVersionPlanningSurfaceWorkItemInput[];
  targetCycles?: readonly NexusAutomationTargetCycleRecord[];
  verification?: readonly WorktreeVerificationRecord[];
  publicationDecisions?: readonly WorktreePublicationDecision[];
  authority?: NexusAuthorityProjectSummary | null;
  includeWorkItems?: boolean;
  includeUnrelatedWorkItems?: boolean;
}

export interface NexusVersionPlanningSurface {
  versionCount: number;
  shownVersionCount: number;
  omittedVersionCount: number;
  versions: NexusVersionPlanningSurfaceVersion[];
  workItems?: NexusVersionPlanningWorkItemScopeSummary[];
}

export interface NexusVersionPlanningSurfaceVersion {
  id: string;
  objective: string;
  targetBranch: string;
  owningComponents: string[];
  scopeCounts: NexusVersionPlanningSurfaceScopeCounts;
  readiness: NexusVersionPlanningSurfaceReadiness;
  blockers: string[];
  gateWarnings: NexusVersionPlanningSurfaceGateWarning[];
  warnings: string[];
}

export interface NexusVersionPlanningSurfaceScopeCounts {
  resolvedItemCount: number;
  requiredResolvedItemCount: number;
  configuredEntryCount: number;
  byScopeStatus: Record<NexusVersionScopeStatus, number>;
  configuredByScopeStatus: Record<NexusVersionScopeStatus, number>;
}

export interface NexusVersionPlanningSurfaceReadiness {
  ready: boolean;
  state: NexusVersionPlanningReadinessState;
  blockerCount: number;
  gateWarningCount: number;
  warningCount: number;
}

export interface NexusVersionPlanningSurfaceGateWarning {
  kind: NexusVersionReadinessGateReport["kind"];
  required: boolean;
  status: NexusVersionReadinessGateReport["status"];
  message: string;
}

export interface NexusVersionPlanningWorkItemScopeSummary {
  componentId: string;
  id: string;
  logicalItemId: string | null;
  title: string;
  status: WorkStatus;
  unrelated: boolean;
  scopes: NexusVersionPlanningWorkItemVersionScope[];
}

export interface NexusVersionPlanningWorkItemVersionScope {
  versionId: string;
  scopeStatus: NexusVersionScopeStatus;
  scopeStatuses: NexusVersionScopeStatus[];
  entryKinds: NexusVersionScopeKind[];
  entryIndexes: number[];
}

interface MatchedWorkItemScope {
  input: NexusVersionPlanningSurfaceWorkItemInput;
  summary: NexusVersionPlanningWorkItemScopeSummary;
}

const versionScopeStatuses: NexusVersionScopeStatus[] = [
  "committed",
  "candidate",
  "stretch",
  "deferred",
  "excluded",
];

export function buildNexusVersionPlanningSurface(
  options: NexusVersionPlanningSurfaceOptions,
): NexusVersionPlanningSurface | undefined {
  const planning = options.projectConfig.versionPlanning;
  if (!planning || planning.versions.length === 0) {
    return undefined;
  }

  const workItemScopes = options.workItems
    .map((input) => matchedWorkItemScope(planning.versions, input))
    .filter((scope) =>
      options.includeUnrelatedWorkItems || scope.summary.scopes.length > 0
    );
  const matchedVersionIds = new Set(
    workItemScopes.flatMap((scope) =>
      scope.summary.scopes.map((itemScope) => itemScope.versionId)
    ),
  );
  const shownVersions = planning.versions.filter((version, index) =>
    index === 0 || matchedVersionIds.has(version.id)
  );
  const versions = shownVersions.map((version) =>
    summarizeVersion({
      version,
      workItemScopes,
      targetCycles: options.targetCycles ?? [],
      verification: options.verification ?? [],
      publicationDecisions: options.publicationDecisions ?? [],
      authority: options.authority ?? null,
    })
  );

  return {
    versionCount: planning.versions.length,
    shownVersionCount: versions.length,
    omittedVersionCount: planning.versions.length - versions.length,
    versions,
    ...(options.includeWorkItems
      ? { workItems: workItemScopes.map((scope) => scope.summary) }
      : {}),
  };
}

function summarizeVersion(options: {
  version: NexusVersionConfig;
  workItemScopes: MatchedWorkItemScope[];
  targetCycles: readonly NexusAutomationTargetCycleRecord[];
  verification: readonly WorktreeVerificationRecord[];
  publicationDecisions: readonly WorktreePublicationDecision[];
  authority: NexusAuthorityProjectSummary | null;
}): NexusVersionPlanningSurfaceVersion {
  const scope = scopeResultForVersion(options.version, options.workItemScopes);
  const readiness = reportNexusVersionReadiness({
    version: options.version,
    scope,
    facts: {
      targetCycles: options.targetCycles,
      verification: options.verification,
      publicationDecisions: options.publicationDecisions,
      authority: options.authority,
    },
  });
  const gateWarnings = readiness.gates
    .filter((gate) => gate.status === "failed" || gate.status === "warning")
    .map((gate) => ({
      kind: gate.kind,
      required: gate.required,
      status: gate.status,
      message: gate.message,
    }));
  const blockers = uniqueStrings([
    ...readiness.progress.blockedWorkItemIds.map(
      (id) => `Work item ${id} is blocked.`,
    ),
    ...readiness.gates
      .filter((gate) => gate.required && gate.status === "failed")
      .map((gate) => gate.message),
  ]);

  return {
    id: options.version.id,
    objective: options.version.objective,
    targetBranch: options.version.targetBranch,
    owningComponents: [...options.version.owningComponents],
    scopeCounts: {
      resolvedItemCount: readiness.progress.totalScopeItemCount,
      requiredResolvedItemCount: readiness.progress.requiredScopeItemCount,
      configuredEntryCount: options.version.scope.length,
      byScopeStatus: readiness.progress.byScopeStatus,
      configuredByScopeStatus: configuredScopeCounts(options.version.scope),
    },
    readiness: {
      ready: readiness.ready,
      state: readinessState(readiness.ready, gateWarnings),
      blockerCount: blockers.length,
      gateWarningCount: gateWarnings.length,
      warningCount: readiness.warnings.length,
    },
    blockers,
    gateWarnings,
    warnings: readiness.warnings.map((warning) => warning.message),
  };
}

function matchedWorkItemScope(
  versions: readonly NexusVersionConfig[],
  input: NexusVersionPlanningSurfaceWorkItemInput,
): MatchedWorkItemScope {
  const scopes = versions
    .map((version) => scopeForVersionWorkItem(version, input))
    .filter((scope): scope is NexusVersionPlanningWorkItemVersionScope =>
      scope !== null
    );
  return {
    input,
    summary: {
      componentId: input.componentId,
      id: input.workItem.id,
      logicalItemId:
        input.logicalItemId ?? input.workItem.externalRef?.itemId ?? null,
      title: input.workItem.title,
      status: input.workItem.status,
      unrelated: scopes.length === 0,
      scopes,
    },
  };
}

function scopeForVersionWorkItem(
  version: NexusVersionConfig,
  input: NexusVersionPlanningSurfaceWorkItemInput,
): NexusVersionPlanningWorkItemVersionScope | null {
  const matches = version.scope
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => scopeEntryMatchesWorkItem(entry, input));
  if (matches.length === 0) {
    return null;
  }

  const scopeStatuses = uniqueValues(matches.map(({ entry }) => entry.status));
  return {
    versionId: version.id,
    scopeStatus: scopeStatuses[0]!,
    scopeStatuses,
    entryKinds: uniqueValues(matches.map(({ entry }) => entry.kind)),
    entryIndexes: matches.map(({ index }) => index),
  };
}

function scopeEntryMatchesWorkItem(
  entry: NexusVersionScopeEntry,
  input: NexusVersionPlanningSurfaceWorkItemInput,
): boolean {
  if (entry.componentId !== input.componentId) {
    return false;
  }
  if (!scopeEntryMatchesTracker(entry, input)) {
    return false;
  }

  switch (entry.kind) {
    case "work_item":
      return workItemIds(input).includes(entry.workItemId);
    case "label":
      return input.workItem.labels?.includes(entry.label) ?? false;
    case "milestone":
      return input.workItem.milestone === entry.milestone;
    case "tracker_query":
      return workItemMatchesTrackerQuery(input.workItem, entry.query);
  }
}

function scopeEntryMatchesTracker(
  entry: NexusVersionScopeEntry,
  input: NexusVersionPlanningSurfaceWorkItemInput,
): boolean {
  if (!entry.trackerId) {
    return true;
  }
  return entry.trackerId === (
    input.trackerId ?? input.workItem.trackerRef?.trackerId ?? null
  );
}

function workItemIds(input: NexusVersionPlanningSurfaceWorkItemInput): string[] {
  return uniqueStrings([
    input.workItem.id,
    input.logicalItemId ?? null,
    input.workItem.externalRef?.itemId ?? null,
  ]);
}

function workItemMatchesTrackerQuery(
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
  if (
    descriptor.assignees.some((assignee) =>
      !item.assignees?.includes(assignee)
    )
  ) {
    return false;
  }
  if (descriptor.text && !itemMatchesText(item, descriptor.text)) {
    return false;
  }

  return true;
}

function itemMatchesText(item: WorkItem, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    item.id,
    item.title,
    item.description ?? "",
    ...(item.labels ?? []),
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}

function scopeResultForVersion(
  version: NexusVersionConfig,
  workItemScopes: readonly MatchedWorkItemScope[],
): NexusVersionScopeResult {
  return {
    versionId: version.id,
    items: workItemScopes.flatMap((scope) => {
      const itemScope = scope.summary.scopes.find(
        (candidate) => candidate.versionId === version.id,
      );
      if (!itemScope) {
        return [];
      }
      return [resolvedScopeItem(version, scope, itemScope)];
    }),
    warnings: [],
  };
}

function resolvedScopeItem(
  version: NexusVersionConfig,
  scope: MatchedWorkItemScope,
  itemScope: NexusVersionPlanningWorkItemVersionScope,
): NexusVersionResolvedScopeItem {
  const sourceTrackerRef = trackerRefFor(scope.input);
  return {
    versionId: version.id,
    componentId: scope.input.componentId,
    workItem: scope.input.workItem,
    scopeStatus: itemScope.scopeStatus,
    scopeStatuses: itemScope.scopeStatuses,
    scopeEntryIndexes: itemScope.entryIndexes,
    scopeEntries: itemScope.entryIndexes.map((index) => version.scope[index]!),
    sourceTrackerRef,
    canonicalTrackerRef: sourceTrackerRef,
    logicalItemId: scope.summary.logicalItemId,
    dedupe: null,
  };
}

function trackerRefFor(
  input: NexusVersionPlanningSurfaceWorkItemInput,
): WorkTrackerRef {
  return input.workItem.trackerRef ?? {
    componentId: input.componentId,
    trackerId: input.trackerId ?? "default",
    provider: input.trackerProvider ?? input.workItem.provider,
  };
}

function readinessState(
  ready: boolean,
  gateWarnings: readonly NexusVersionPlanningSurfaceGateWarning[],
): NexusVersionPlanningReadinessState {
  if (ready) {
    return "ready";
  }
  return gateWarnings.some((gate) => gate.status === "failed")
    ? "blocked"
    : "warning";
}

function configuredScopeCounts(
  scope: readonly NexusVersionScopeEntry[],
): Record<NexusVersionScopeStatus, number> {
  const counts = emptyScopeCounts();
  for (const entry of scope) {
    counts[entry.status] += 1;
  }
  return counts;
}

function emptyScopeCounts(): Record<NexusVersionScopeStatus, number> {
  return Object.fromEntries(
    versionScopeStatuses.map((status) => [status, 0]),
  ) as Record<NexusVersionScopeStatus, number>;
}

function uniqueValues<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return uniqueValues(values.filter((value): value is string => Boolean(value)));
}
