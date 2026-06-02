
import {
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
} from "../../work-items/workTrackingLocalProvider.js";
import type { WorkItem, WorkTrackerRef } from "../../work-items/workTrackingTypes.js";
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import type { ResolvedNexusProjectComponent } from "../../project/nexusProjectLifecycle.js";
import type { NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import {
  providerActionsForHref,
  providerActionsFromText,
  uniqueProviderActions,
} from "./nexusDashboardProviderActions.js";
import type { NexusDashboardProviderUrls } from "./nexusDashboardProviderActions.js";
import type {
  NexusDashboardTrackedWorkItem,
  NexusDashboardTrackedWorkKind,
  NexusDashboardTrackedWorkSummary,
} from "./nexusDashboardTypes.js";
import { capture } from "./nexusDashboardModelUtils.js";

export function summarizeTrackedWork(
  summary: NexusEligibleWorkSummary | null,
  providerUrls: NexusDashboardProviderUrls,
): NexusDashboardTrackedWorkSummary {
  const records: NexusDashboardTrackedWorkItem[] = [];
  for (const component of summary?.components ?? []) {
    for (const item of component.workItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "ready",
        kindLabel: "ready",
        detail: item.importOnly
          ? "Ready to import before automation can select it."
          : "Ready for automation or a human to pick up.",
        providerUrls,
      }));
    }
    for (const item of component.importCandidateWorkItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "import-candidate",
        kindLabel: "import",
        detail: "Provider work can be linked or imported into this workspace.",
        providerUrls,
      }));
    }
    for (const item of component.staleInProgressWorkItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "stale",
        kindLabel: "stale",
        detail: "In progress, but no recent cycle has advanced it.",
        providerUrls,
      }));
    }
    for (const item of component.excludedWorkItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "excluded",
        kindLabel: "hidden",
        detail: item.reasons.length > 0
          ? item.reasons.slice(0, 2).join(", ")
          : "Visible to the tracker, but not selectable right now.",
        providerUrls,
      }));
    }
  }
  records.sort(compareTrackedWorkItems);
  return {
    totalCount:
      (summary?.eligibleWorkItemCount ?? 0) +
      (summary?.importCandidateWorkItemCount ?? 0) +
      (summary?.staleInProgressWorkItemCount ?? 0) +
      (summary?.excludedWorkItemCount ?? 0),
    blockedCount: trackedWorkBlockedCount(records),
    readyCount: trackedWorkReadyCount(records),
    importCandidateCount: summary?.importCandidateWorkItemCount ?? 0,
    staleCount: summary?.staleInProgressWorkItemCount ?? 0,
    excludedCount: summary?.excludedWorkItemCount ?? 0,
    source: "provider",
    incomplete: false,
    detail: null,
    records: records.slice(0, 30),
  };
}

interface SummarizeLocalTrackedWorkOptions {
  generatedAt: string;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  providerUrls: NexusDashboardProviderUrls;
}

export function summarizeLocalTrackedWork(
  options: SummarizeLocalTrackedWorkOptions,
): NexusDashboardTrackedWorkSummary {
  const records: NexusDashboardTrackedWorkItem[] = [];
  const seen = new Set<string>();
  for (const component of options.components) {
    for (const item of localTrackedWorkItemsForComponent(options, component)) {
      addUniqueTrackedWorkRecord(records, seen, item);
    }
  }

  records.sort(compareTrackedWorkItems);
  return {
    totalCount: records.length,
    blockedCount: trackedWorkBlockedCount(records),
    readyCount: trackedWorkReadyCount(records),
    importCandidateCount: 0,
    staleCount: records.filter((item) => item.kind === "stale").length,
    excludedCount: 0,
    source: "local",
    incomplete: true,
    detail: "Showing local tracker records while provider work items finish loading.",
    records: records.slice(0, 30),
  };
}

function localTrackedWorkItemsForComponent(
  options: SummarizeLocalTrackedWorkOptions,
  component: ResolvedNexusProjectComponent,
): NexusDashboardTrackedWorkItem[] {
  return component.workTrackers.flatMap((tracker) =>
    localTrackedWorkItemsForTracker(options, component, tracker),
  );
}

function localTrackedWorkItemsForTracker(
  options: SummarizeLocalTrackedWorkOptions,
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectComponent["workTrackers"][number],
): NexusDashboardTrackedWorkItem[] {
  const localWorkTracking = tracker.workTracking;
  if (!tracker.enabled || localWorkTracking.provider !== "local") {
    return [];
  }
  const store = capture(() =>
    loadLocalWorkTrackingStore(
      resolveLocalWorkTrackingStorePath(options.projectRoot, localWorkTracking),
      options.generatedAt,
      "dashboardTrackedWorkLocalFallback",
    ),
  );
  if (!store.ok) {
    return [];
  }

  return (store.value?.items ?? [])
    .filter(isVisibleLocalTrackedWorkItem)
    .map((item) =>
      trackedWorkLocalItem({
        item,
        component,
        trackerRef: localTrackedWorkTrackerRef(component, tracker),
        providerUrls: options.providerUrls,
      }),
    );
}

function isVisibleLocalTrackedWorkItem(item: WorkItem): boolean {
  return item.status !== "done" && item.status !== "wont_do";
}

function localTrackedWorkTrackerRef(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectComponent["workTrackers"][number],
): WorkTrackerRef {
  return {
    componentId: component.id,
    componentName: component.name,
    trackerId: tracker.id,
    trackerName: tracker.name,
    provider: tracker.provider,
    roles: tracker.roles,
    default: tracker.default,
  };
}

function addUniqueTrackedWorkRecord(
  records: NexusDashboardTrackedWorkItem[],
  seen: Set<string>,
  item: NexusDashboardTrackedWorkItem,
): void {
  const key = `${item.componentId}:${item.id}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  records.push(item);
}

function trackedWorkLocalItem(options: {
  item: WorkItem;
  component: ResolvedNexusProjectComponent;
  trackerRef: WorkTrackerRef;
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardTrackedWorkItem {
  const status = options.item.status;
  const kind: NexusDashboardTrackedWorkKind =
    status === "blocked" ? "blocked" : status === "in_progress" ? "stale" : "ready";
  const kindLabel =
    status === "blocked" ? "blocked" : status === "in_progress" ? "active" : "local";
  const detail =
    status === "blocked"
      ? "Blocked local work item. Review before automation can continue."
      : status === "in_progress"
        ? "Local item is in progress; provider scan is still loading."
        : "Local work item is visible while provider scan finishes.";
  const actions = uniqueProviderActions([
    ...providerActionsForHref(options.item.webUrl),
    ...providerActionsFromText(
      `${options.item.id} ${options.item.title}`,
      options.providerUrls,
      options.component.id,
    ),
  ]);
  return {
    id: options.item.id,
    logicalItemId: options.item.externalRef?.itemId ?? options.item.id,
    componentId: options.component.id,
    componentName: options.component.name,
    title: options.item.title,
    status,
    kind,
    kindLabel,
    detail,
    provider: options.trackerRef.provider,
    trackerId: options.trackerRef.trackerId,
    updatedAt: options.item.updatedAt ?? null,
    webUrl: options.item.webUrl ?? null,
    actions,
  };
}

function trackedWorkItem(options: {
  item:
    | NexusEligibleWorkSummary["components"][number]["workItems"][number]
    | NexusEligibleWorkSummary["components"][number]["excludedWorkItems"][number];
  component: NexusEligibleWorkSummary["components"][number];
  kind: NexusDashboardTrackedWorkKind;
  kindLabel: string;
  detail: string;
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardTrackedWorkItem {
  const item = options.item;
  const trackerRef =
    "sourceTrackerRef" in item && item.sourceTrackerRef
      ? item.sourceTrackerRef
      : "canonicalTrackerRef" in item && item.canonicalTrackerRef
        ? item.canonicalTrackerRef
        : "trackerRef" in item
          ? item.trackerRef
          : null;
  const actions = uniqueProviderActions([
    ...providerActionsForHref(item.webUrl),
    ...providerActionsFromText(
      `${item.id} ${"logicalItemId" in item ? item.logicalItemId ?? "" : ""} ${item.title}`,
      options.providerUrls,
      options.component.componentId,
    ),
  ]);
  return {
    id: item.id,
    logicalItemId: "logicalItemId" in item ? item.logicalItemId : item.id,
    componentId: options.component.componentId,
    componentName: options.component.componentName,
    title: item.title,
    status: item.status,
    kind: options.kind,
    kindLabel: options.kindLabel,
    detail: options.detail,
    provider: trackerRef?.provider ?? null,
    trackerId: trackerRef?.trackerId ?? null,
    updatedAt: item.updatedAt,
    webUrl: item.webUrl,
    actions,
  };
}

function compareTrackedWorkItems(
  left: NexusDashboardTrackedWorkItem,
  right: NexusDashboardTrackedWorkItem,
): number {
  return trackedWorkScore(right) - trackedWorkScore(left) ||
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
    left.componentName.localeCompare(right.componentName) ||
    left.title.localeCompare(right.title);
}

function trackedWorkScore(item: NexusDashboardTrackedWorkItem): number {
  if (item.status === "blocked") {
    return 95;
  }
  switch (item.kind) {
    case "blocked":
      return 95;
    case "ready":
      return 90;
    case "import-candidate":
      return 70;
    case "stale":
      return 60;
    case "excluded":
      return 20;
  }
}

function trackedWorkBlockedCount(records: NexusDashboardTrackedWorkItem[]): number {
  return records.filter((item) => item.kind === "blocked" || item.status === "blocked").length;
}

function trackedWorkReadyCount(records: NexusDashboardTrackedWorkItem[]): number {
  return records.filter((item) =>
    item.kind === "ready" && item.status !== "blocked"
  ).length;
}
