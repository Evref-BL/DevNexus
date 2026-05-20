import {
  type NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationAgentLaunch.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  getNexusAutomationStatus,
  type GetNexusAutomationStatusOptions,
} from "./nexusAutomationStatus.js";
import {
  buildNexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  buildNexusExternalIssueVisibilitySummary,
  type NexusExternalIssueVisibilitySummary,
} from "./nexusExternalIssueVisibility.js";
import {
  getNexusWorkItemDiscoveryStatus,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  summarizeNexusAutomationWorkTrackers,
  type NexusAutomationWorkTrackerSummary,
} from "./nexusAutomationWorkTrackerSummary.js";
import type {
  NexusEligibleWorkDedupeInfo,
  NexusEligibleWorkExclusionFinding,
  NexusEligibleWorkExcludedItem,
  NexusEligibleWorkItem,
  NexusEligibleWorkMode,
  NexusEligibleWorkTrackerQueryResult,
} from "./nexusEligibleWork.js";
import type { WorkItem, WorkTrackerRef } from "./workTrackingTypes.js";

export type { NexusEligibleWorkMode } from "./nexusEligibleWork.js";

export interface NexusEligibleWorkProjectSummary {
  id: string;
  name: string;
}

export interface NexusEligibleWorkItemSummary {
  componentId: string;
  id: string;
  logicalItemId: string | null;
  title: string;
  status: WorkItem["status"];
  labels: string[];
  assignees: string[];
  milestone: string | null;
  updatedAt: string | null;
  webUrl: string | null;
  trackerRef: WorkTrackerRef | null;
  canonicalTrackerRef: WorkTrackerRef | null;
  sourceTrackerRef: WorkTrackerRef | null;
  dedupe: NexusEligibleWorkDedupeInfo | null;
  warnings: string[];
  selectable: boolean;
  importOnly: boolean;
}

export interface NexusExcludedWorkItemSummary {
  componentId: string;
  id: string;
  title: string;
  status: WorkItem["status"];
  labels: string[];
  assignees: string[];
  milestone: string | null;
  updatedAt: string | null;
  webUrl: string | null;
  sourceTrackerRef: WorkTrackerRef | null;
  reasons: string[];
  exclusionFindings: NexusEligibleWorkExclusionFinding[];
}

export interface NexusEligibleWorkComponentSummary {
  componentId: string;
  componentName: string;
  role: string;
  sourceRoot: string | null;
  workTrackingProvider: string | null;
  defaultTrackerId: string | null;
  workTrackers: NexusAutomationWorkTrackerSummary[];
  workItems: NexusEligibleWorkItemSummary[];
  importCandidateWorkItems: NexusEligibleWorkItemSummary[];
  excludedWorkItemCount: number;
  excludedReasonCounts: Record<string, number>;
  excludedCategoryCounts: Record<string, number>;
  excludedWorkItems: NexusExcludedWorkItemSummary[];
  staleInProgressWorkItems: NexusEligibleWorkItemSummary[];
  warnings: string[];
  blockers: string[];
  trackerResults: NexusEligibleWorkTrackerQueryResult[];
}

export interface NexusEligibleWorkSummary {
  projectRoot: string;
  project: NexusEligibleWorkProjectSummary;
  status: string;
  summary: string;
  mode: NexusEligibleWorkMode;
  selector: NexusAutomationConfig["selector"] | null;
  eligibleWorkItemCount: number;
  importCandidateWorkItemCount: number;
  excludedWorkItemCount: number;
  excludedReasonCounts: Record<string, number>;
  excludedCategoryCounts: Record<string, number>;
  staleInProgressWorkItemCount: number;
  warnings: string[];
  blockers: string[];
  externalIssueVisibility: NexusExternalIssueVisibilitySummary;
  components: NexusEligibleWorkComponentSummary[];
}

export async function getNexusEligibleWorkSummary(
  options: GetNexusAutomationStatusOptions,
): Promise<NexusEligibleWorkSummary> {
  const status = await getNexusAutomationStatus(options);
  const componentById = new Map(
    status.components.map((component) => [component.id, component]),
  );
  const grouped =
    status.componentEligibleWorkItems ??
    (status.selectedWorkItem
      ? [
          {
            componentId: status.components[0]?.id ?? "primary",
            workItems: [status.selectedWorkItem],
          },
        ]
      : []);
  const targetReport = buildNexusAutomationTargetReport({
    projectRoot: status.projectRoot,
  });
  const staleInProgressWorkItems =
    targetReport.workItemSummary?.progress.staleInProgressWork ?? [];
  const summariesByComponent = new Map<
    string,
    NexusEligibleWorkComponentSummary
  >();
  const ensureComponentSummary = (
    componentId: string,
  ): NexusEligibleWorkComponentSummary => {
    const existing = summariesByComponent.get(componentId);
    if (existing) {
      return existing;
    }

    const resolved = componentById.get(componentId);
    const summary = {
      componentId,
      componentName: resolved?.name ?? componentId,
      role: resolved?.role ?? "primary",
      sourceRoot: resolved?.sourceRoot ?? null,
      workTrackingProvider: resolved?.workTracking?.provider ?? null,
      defaultTrackerId: resolved?.defaultTrackerId ?? null,
      workTrackers: resolved
        ? summarizeNexusAutomationWorkTrackers(resolved)
        : [],
      workItems: [],
      importCandidateWorkItems: [],
      excludedWorkItemCount: 0,
      excludedReasonCounts: {},
      excludedCategoryCounts: {},
      excludedWorkItems: [],
      staleInProgressWorkItems: [],
      warnings: [],
      blockers: [],
      trackerResults: [],
    };
    summariesByComponent.set(componentId, summary);
    return summary;
  };

  for (const component of grouped) {
    if (emptyEligibleComponent(component)) {
      continue;
    }
    const summary = ensureComponentSummary(component.componentId);
    summary.workItems.push(
      ...component.workItems.map((item) =>
        summarizeEligibleWorkItem(component.componentId, item),
      ),
    );
    summary.importCandidateWorkItems.push(
      ...(component.importCandidateWorkItems ?? []).map((item) =>
        summarizeEligibleWorkItem(component.componentId, item),
      ),
    );
    summary.excludedWorkItems.push(
      ...(component.excludedWorkItems ?? []).map((item) =>
        summarizeExcludedWorkItem(component.componentId, item),
      ),
    );
    summary.warnings.push(...(component.warnings ?? []));
    summary.blockers.push(...(component.blockers ?? []));
    summary.trackerResults.push(...(component.trackerResults ?? []));
  }

  for (const item of staleInProgressWorkItems) {
    const componentId = item.componentId ?? status.components[0]?.id ?? "primary";
    const trackerRef =
      item.trackerId && item.trackerProvider
        ? {
            trackerId: item.trackerId,
            provider: item.trackerProvider,
          }
        : null;
    ensureComponentSummary(componentId).staleInProgressWorkItems.push({
      componentId,
      id: item.id,
      title: item.title ?? item.id,
      status: item.status ?? "in_progress",
      labels: [],
      assignees: [],
      milestone: null,
      updatedAt: null,
      webUrl: null,
      logicalItemId: item.id,
      trackerRef,
      canonicalTrackerRef: trackerRef,
      sourceTrackerRef: trackerRef,
      dedupe: null,
      warnings: [],
      selectable: true,
      importOnly: false,
    });
  }

  for (const component of summariesByComponent.values()) {
    component.excludedWorkItemCount = countExcludedWorkItems(component);
    component.excludedReasonCounts = excludedReasonCountsForComponent(component);
    component.excludedCategoryCounts =
      excludedCategoryCountsForComponent(component);
  }

  const components = [...summariesByComponent.values()].filter(
    (component) =>
      component.workItems.length > 0 ||
      component.importCandidateWorkItems.length > 0 ||
      component.excludedWorkItemCount > 0 ||
      component.staleInProgressWorkItems.length > 0 ||
      component.warnings.length > 0 ||
      component.blockers.length > 0,
  );

  return {
    projectRoot: status.projectRoot,
    project: {
      id: status.projectConfig.id,
      name: status.projectConfig.name,
    },
    status: status.status,
    summary: status.summary,
    mode: status.eligibleWorkMode,
    selector: status.automationConfig?.selector ?? null,
    eligibleWorkItemCount: components.reduce(
      (total, component) => total + component.workItems.length,
      0,
    ),
    importCandidateWorkItemCount: components.reduce(
      (total, component) => total + component.importCandidateWorkItems.length,
      0,
    ),
    excludedWorkItemCount: components.reduce(
      (total, component) => total + component.excludedWorkItemCount,
      0,
    ),
    excludedReasonCounts: mergeCountRecords(
      components.map((component) => component.excludedReasonCounts),
    ),
    excludedCategoryCounts: mergeCountRecords(
      components.map((component) => component.excludedCategoryCounts),
    ),
    staleInProgressWorkItemCount: components.reduce(
      (total, component) => total + component.staleInProgressWorkItems.length,
      0,
    ),
    warnings: status.eligibleWorkWarnings,
    blockers: status.eligibleWorkBlockers,
    externalIssueVisibility:
      status.externalIssueVisibility ??
      buildNexusExternalIssueVisibilitySummary({
        components: status.components,
        componentEligibleWorkItems: grouped,
        discoveryStatus: getNexusWorkItemDiscoveryStatus({
          projectRoot: status.projectRoot,
          env: options.env,
          credentialResolver: options.credentialResolver,
        }),
      }),
    components,
  };
}

function emptyEligibleComponent(
  component: NexusAutomationComponentEligibleWorkItems,
): boolean {
  return (
    component.workItems.length === 0 &&
    (component.importCandidateWorkItems ?? []).length === 0 &&
    (component.excludedWorkItems ?? []).length === 0 &&
    (component.trackerResults ?? []).every(
      (tracker) => tracker.excludedCount === 0,
    ) &&
    (component.warnings ?? []).length === 0 &&
    (component.blockers ?? []).length === 0
  );
}

function summarizeEligibleWorkItem(
  componentId: string,
  item: WorkItem,
): NexusEligibleWorkItemSummary {
  const eligible = item as WorkItem & Partial<NexusEligibleWorkItem>;
  return {
    componentId,
    id: item.id,
    logicalItemId: eligible.logicalItemId ?? item.externalRef?.itemId ?? item.id,
    title: item.title,
    status: item.status,
    labels: item.labels ?? [],
    assignees: item.assignees ?? [],
    milestone: item.milestone ?? null,
    updatedAt: item.updatedAt ?? null,
    webUrl: item.webUrl ?? null,
    trackerRef: item.trackerRef ?? null,
    canonicalTrackerRef: Object.hasOwn(eligible, "canonicalTrackerRef")
      ? eligible.canonicalTrackerRef ?? null
      : item.trackerRef ?? null,
    sourceTrackerRef: Object.hasOwn(eligible, "sourceTrackerRef")
      ? eligible.sourceTrackerRef ?? null
      : item.trackerRef ?? null,
    dedupe: eligible.dedupe ?? null,
    warnings: eligible.warnings ?? [],
    selectable: eligible.selectable ?? true,
    importOnly: eligible.importOnly ?? false,
  };
}

function summarizeExcludedWorkItem(
  componentId: string,
  item: NexusEligibleWorkExcludedItem,
): NexusExcludedWorkItemSummary {
  return {
    componentId,
    id: item.id,
    title: item.title,
    status: item.status,
    labels: [...(item.labels ?? [])],
    assignees: [...(item.assignees ?? [])],
    milestone: item.milestone ?? null,
    updatedAt: item.updatedAt ?? null,
    webUrl: item.webUrl ?? item.externalRef?.webUrl ?? null,
    sourceTrackerRef: item.sourceTrackerRef,
    reasons: [...item.reasons],
    exclusionFindings: [...item.exclusionFindings],
  };
}

function countExcludedWorkItems(
  component: NexusEligibleWorkComponentSummary,
): number {
  const visibleExcludedCount = component.trackerResults.reduce(
    (total, tracker) => total + tracker.excludedCount,
    0,
  );
  const finalLimitExcludedCount = component.excludedWorkItems.filter((item) =>
    item.reasons.includes("final limit reached"),
  ).length;

  return visibleExcludedCount + finalLimitExcludedCount;
}

function excludedReasonCountsForComponent(
  component: NexusEligibleWorkComponentSummary,
): Record<string, number> {
  const counts = mergeCountRecords(
    component.trackerResults.map((tracker) => tracker.exclusionReasonCounts),
  );
  for (const item of finalLimitExcludedItems(component)) {
    for (const reason of item.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }

  return counts;
}

function excludedCategoryCountsForComponent(
  component: NexusEligibleWorkComponentSummary,
): Record<string, number> {
  const counts = mergeCountRecords(
    component.trackerResults.map(
      (tracker) => tracker.exclusionCategoryCounts ?? {},
    ),
  );
  for (const item of finalLimitExcludedItems(component)) {
    for (const finding of item.exclusionFindings) {
      counts[finding.category] = (counts[finding.category] ?? 0) + 1;
    }
  }

  return counts;
}

function finalLimitExcludedItems(
  component: NexusEligibleWorkComponentSummary,
): NexusExcludedWorkItemSummary[] {
  return component.excludedWorkItems.filter((item) =>
    item.reasons.includes("final limit reached"),
  );
}

function mergeCountRecords(
  records: Array<Record<string, number> | undefined>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record ?? {})) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}
