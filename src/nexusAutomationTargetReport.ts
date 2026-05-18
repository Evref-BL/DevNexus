import path from "node:path";
import {
  readNexusAutomationRunLedger,
  type NexusAutomationRunLedger,
  type NexusAutomationRunRecord,
  type NexusAutomationRunStatus,
} from "./nexusAutomation.js";
import type {
  NexusAutomationCodexAppServerLaunchMetadata,
} from "./nexusAutomationAgentLaunch.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  readNexusAutomationTargetContext,
  type NexusAutomationTargetContext,
} from "./nexusAutomationTarget.js";
import {
  readNexusAutomationTargetCycleLedger,
  summarizeNexusAutomationTargetCycles,
  type NexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleRecord,
  type NexusAutomationTargetCycleStatus,
  type NexusAutomationTargetCycleSummary,
  type NexusAutomationTargetCycleWorkItem,
  type NexusAutomationTargetCycleWorkItemStatus,
} from "./nexusAutomationTargetCycle.js";
import {
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import type { WorkStatus } from "./workTrackingTypes.js";
import type {
  WorktreePublicationDecision,
  WorktreeVerificationRecord,
} from "./worktreeExecutionMetadata.js";

export type NexusAutomationTargetReportStatus =
  | "not_started"
  | "active"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type NexusAutomationTargetReportRelaunchDecisionType =
  | "relaunch"
  | "stop"
  | "wait"
  | "report_blocked"
  | "report_failed"
  | "not_ready";

export interface BuildNexusAutomationTargetReportOptions {
  projectRoot: string;
  now?: Date | string;
}

export interface NexusAutomationTargetReportRunSummary {
  runCount: number;
  completedRunCount: number;
  blockedRunCount: number;
  failedRunCount: number;
  skippedRunCount: number;
  lastRun: NexusAutomationRunRecord | null;
}

export interface NexusAutomationTargetReportWorkItemSummary {
  totalReferences: number;
  uniqueReferences: NexusAutomationTargetReportWorkItemReference[];
  byComponent: NexusAutomationTargetReportComponentWorkItemSummary[];
  byCycleStatus: Record<NexusAutomationTargetCycleWorkItemStatus, number>;
  progress: NexusAutomationTargetReportWorkItemProgressSummary;
}

export interface NexusAutomationTargetReportWorkItemReference {
  componentId: string | null;
  id: string;
  title: string | null;
  status: WorkStatus | null;
  latestCycleStatus: NexusAutomationTargetCycleWorkItemStatus | null;
  latestCycleId: string;
  agentProfileId: string | null;
  notes: string | null;
}

export interface NexusAutomationTargetReportComponentWorkItemSummary {
  componentId: string | null;
  totalReferences: number;
  uniqueWorkItemCount: number;
}

export interface NexusAutomationTargetReportWorkItemProgressSummary {
  readyEligibleWork: NexusAutomationTargetReportWorkItemReference[];
  selectedWork: NexusAutomationTargetReportWorkItemReference[];
  blockedHitlWork: NexusAutomationTargetReportWorkItemReference[];
  completedWork: NexusAutomationTargetReportWorkItemReference[];
  skippedWork: NexusAutomationTargetReportWorkItemReference[];
}

export type NexusAutomationTargetReportActiveBlockerSource =
  | "cycle"
  | "work_item"
  | "run";

export interface NexusAutomationTargetReportActiveBlocker {
  source: NexusAutomationTargetReportActiveBlockerSource;
  componentId: string | null;
  cycleId: string | null;
  runId: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
  message: string | null;
}

export interface NexusAutomationTargetReportExecutionRunSummary {
  runId: string;
  componentId: string | null;
  status: NexusAutomationRunStatus;
  workItemId: string | null;
  workItemTitle: string | null;
  workItemStatus: WorkStatus | null;
  commitIds: string[];
  summary: string | null;
  error: string | null;
  codexAppServer: NexusAutomationCodexAppServerLaunchMetadata | null;
}

export interface NexusAutomationTargetReportVerificationSummary
  extends WorktreeVerificationRecord {
  runId: string;
  componentId: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
}

export interface NexusAutomationTargetReportPublicationDecisionSummary
  extends WorktreePublicationDecision {
  runId: string;
  componentId: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
}

export interface NexusAutomationTargetReportExecutionSummary {
  runCount: number;
  commitIds: string[];
  verification: NexusAutomationTargetReportVerificationSummary[];
  publicationDecisions: NexusAutomationTargetReportPublicationDecisionSummary[];
  runs: NexusAutomationTargetReportExecutionRunSummary[];
}

export interface NexusAutomationTargetReportComponentProgressSummary {
  componentId: string | null;
  componentName: string | null;
  role: ResolvedNexusProjectComponent["role"] | null;
  sourceRoot: string | null;
  workTrackingProvider: string | null;
  workItemCount: number;
  workItems: NexusAutomationTargetReportWorkItemProgressSummary;
  activeBlockers: NexusAutomationTargetReportActiveBlocker[];
  commitIds: string[];
  verification: NexusAutomationTargetReportVerificationSummary[];
  publicationDecisions: NexusAutomationTargetReportPublicationDecisionSummary[];
  runs: NexusAutomationTargetReportExecutionRunSummary[];
}

export interface NexusAutomationTargetReportRelaunchDecision {
  type: NexusAutomationTargetReportRelaunchDecisionType;
  reason: string;
  eligibleWorkItemCount: number | null;
  latestCycleId: string | null;
  latestRunId: string | null;
}

export interface NexusAutomationTargetReport {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: {
    id: string;
    name: string;
    componentCount: number;
  };
  target: NexusAutomationTargetContext | null;
  status: NexusAutomationTargetReportStatus;
  statusReason: string;
  cycleSummary: NexusAutomationTargetCycleSummary | null;
  runSummary: NexusAutomationTargetReportRunSummary | null;
  workItemSummary: NexusAutomationTargetReportWorkItemSummary | null;
  executionSummary: NexusAutomationTargetReportExecutionSummary | null;
  componentProgress: NexusAutomationTargetReportComponentProgressSummary[];
  relaunchDecision: NexusAutomationTargetReportRelaunchDecision;
  activeBlockers: NexusAutomationTargetReportActiveBlocker[];
  blockers: string[];
  notes: string[];
}

export class NexusAutomationTargetReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationTargetReportError";
  }
}

export function buildNexusAutomationTargetReport(
  options: BuildNexusAutomationTargetReportOptions,
): NexusAutomationTargetReport {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const generatedAt = isoString(options.now ?? new Date());
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (!automationConfig) {
    return {
      version: 1,
      generatedAt,
      projectRoot,
      project: projectSummary(projectConfig, components),
      target: null,
      status: "not_started",
      statusReason: "Project automation is not configured",
      cycleSummary: null,
      runSummary: null,
      workItemSummary: null,
      executionSummary: null,
      componentProgress: [],
      relaunchDecision: {
        type: "not_ready",
        reason: "Project automation is not configured",
        eligibleWorkItemCount: null,
        latestCycleId: null,
        latestRunId: null,
      },
      activeBlockers: [],
      blockers: [],
      notes: [],
    };
  }

  const target = readNexusAutomationTargetContext({
    projectRoot,
    config: automationConfig,
  });
  const cycleLedger = readNexusAutomationTargetCycleLedger(
    projectRoot,
    automationConfig,
  );
  const cycleSummary = summarizeNexusAutomationTargetCycles({
    projectRoot,
    config: automationConfig,
  });
  const runLedger = readNexusAutomationRunLedger(projectRoot, automationConfig);
  const runSummary = summarizeRuns(runLedger);
  const status = reportStatus(cycleLedger, runLedger);
  const workItemResolver = localWorkItemResolver(projectRoot, components);
  const workItemSummary = summarizeCycleWorkItems(
    cycleLedger,
    workItemResolver,
  );
  const executionSummary = summarizeExecution(runLedger, workItemResolver);
  const activeBlockers = summarizeActiveBlockers({
    lastCycle: cycleSummary.lastCycle,
    lastRun: runSummary.lastRun,
    workItemResolver,
  });

  return {
    version: 1,
    generatedAt,
    projectRoot,
    project: projectSummary(projectConfig, components),
    target,
    status,
    statusReason: reportStatusReason(status, cycleSummary.lastCycle, runSummary.lastRun),
    cycleSummary,
    runSummary,
    workItemSummary,
    executionSummary,
    componentProgress: summarizeComponentProgress({
      components,
      workItemSummary,
      executionSummary,
      activeBlockers,
    }),
    relaunchDecision: relaunchDecision({
      automationConfig,
      lastCycle: cycleSummary.lastCycle,
      lastRun: runSummary.lastRun,
    }),
    activeBlockers,
    blockers: uniqueStrings(cycleLedger.cycles.flatMap((cycle) => cycle.blockers)),
    notes: uniqueStrings(cycleLedger.cycles.flatMap((cycle) => cycle.notes)),
  };
}

function relaunchDecision(options: {
  automationConfig: NonNullable<NexusProjectConfig["automation"]>;
  lastCycle: NexusAutomationTargetCycleRecord | null;
  lastRun: NexusAutomationRunRecord | null;
}): NexusAutomationTargetReportRelaunchDecision {
  const { automationConfig, lastCycle, lastRun } = options;
  if (!lastCycle) {
    if (lastRun?.status === "blocked") {
      return decision(
        "report_blocked",
        `Latest automation run ${lastRun.id} is blocked and no target cycle is recorded`,
        null,
        null,
        lastRun.id,
      );
    }
    if (lastRun?.status === "failed") {
      return decision(
        "report_failed",
        `Latest automation run ${lastRun.id} failed and no target cycle is recorded`,
        null,
        null,
        lastRun.id,
      );
    }

    return decision(
      "not_ready",
      "No target cycle is recorded",
      null,
      null,
      lastRun?.id ?? null,
    );
  }

  const latestRunId = lastCycle.runId ?? lastRun?.id ?? null;
  if (lastCycle.status === "started" || lastCycle.status === "dispatched") {
    return decision(
      "wait",
      `Latest target cycle ${lastCycle.id} is still ${lastCycle.status}`,
      lastCycle.eligibleWorkItemCount,
      lastCycle.id,
      latestRunId,
    );
  }
  if (lastCycle.status === "blocked") {
    return decision(
      "report_blocked",
      `Latest target cycle ${lastCycle.id} is blocked`,
      lastCycle.eligibleWorkItemCount,
      lastCycle.id,
      latestRunId,
    );
  }
  if (lastCycle.status === "failed") {
    return decision(
      "report_failed",
      `Latest target cycle ${lastCycle.id} failed`,
      lastCycle.eligibleWorkItemCount,
      lastCycle.id,
      latestRunId,
    );
  }

  const eligibleWorkItemCount = lastCycle.eligibleWorkItemCount;
  if (eligibleWorkItemCount === null) {
    return decision(
      "not_ready",
      `Latest target cycle ${lastCycle.id} did not record eligible work item count`,
      null,
      lastCycle.id,
      latestRunId,
    );
  }
  if (eligibleWorkItemCount > 0) {
    if (automationConfig.agent.relaunch.whileEligible) {
      return decision(
        "relaunch",
        `Latest target cycle ${lastCycle.id} recorded ${eligibleWorkItemCount} eligible work item(s) and relaunch while eligible is enabled`,
        eligibleWorkItemCount,
        lastCycle.id,
        latestRunId,
      );
    }

    return decision(
      "wait",
      `Latest target cycle ${lastCycle.id} recorded ${eligibleWorkItemCount} eligible work item(s), but relaunch while eligible is disabled`,
      eligibleWorkItemCount,
      lastCycle.id,
      latestRunId,
    );
  }

  if (automationConfig.target.stopWhenNoEligibleWork) {
    return decision(
      "stop",
      `Latest target cycle ${lastCycle.id} recorded no eligible work item(s)`,
      eligibleWorkItemCount,
      lastCycle.id,
      latestRunId,
    );
  }

  return decision(
    "wait",
    `Latest target cycle ${lastCycle.id} recorded no eligible work item(s), but stopWhenNoEligibleWork is disabled`,
    eligibleWorkItemCount,
    lastCycle.id,
    latestRunId,
  );
}

function decision(
  type: NexusAutomationTargetReportRelaunchDecisionType,
  reason: string,
  eligibleWorkItemCount: number | null,
  latestCycleId: string | null,
  latestRunId: string | null,
): NexusAutomationTargetReportRelaunchDecision {
  return {
    type,
    reason,
    eligibleWorkItemCount,
    latestCycleId,
    latestRunId,
  };
}

function projectSummary(
  projectConfig: NexusProjectConfig,
  components: ResolvedNexusProjectComponent[],
): NexusAutomationTargetReport["project"] {
  return {
    id: projectConfig.id,
    name: projectConfig.name,
    componentCount: components.length,
  };
}

function summarizeRuns(
  ledger: NexusAutomationRunLedger,
): NexusAutomationTargetReportRunSummary {
  return {
    runCount: ledger.runs.length,
    completedRunCount: ledger.runs.filter((run) => run.status === "completed")
      .length,
    blockedRunCount: ledger.runs.filter((run) => run.status === "blocked")
      .length,
    failedRunCount: ledger.runs.filter((run) => run.status === "failed").length,
    skippedRunCount: ledger.runs.filter((run) => run.status === "skipped")
      .length,
    lastRun: ledger.runs.at(-1) ?? null,
  };
}

interface WorkItemSnapshot {
  title: string;
  status: WorkStatus;
}

type LocalWorkItemResolver = (
  componentId: string | null,
  id: string,
) => WorkItemSnapshot | null;

function summarizeCycleWorkItems(
  ledger: NexusAutomationTargetCycleLedger,
  workItemResolver: LocalWorkItemResolver,
): NexusAutomationTargetReportWorkItemSummary {
  const all = ledger.cycles.flatMap((cycle) =>
    cycle.workItems.map((item) => ({ cycle, item })),
  );
  const unique = new Map<string, NexusAutomationTargetReportWorkItemReference>();
  const componentCounts = new Map<
    string,
    { componentId: string | null; totalReferences: number; uniqueIds: Set<string> }
  >();
  const byCycleStatus = {
    eligible: 0,
    selected: 0,
    dispatched: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    skipped: 0,
  } satisfies Record<NexusAutomationTargetCycleWorkItemStatus, number>;

  for (const { cycle, item } of all) {
    const key = workItemKey(item);
    const resolved = workItemResolver(item.componentId, item.id);
    unique.set(key, {
      componentId: item.componentId,
      id: item.id,
      title: item.title ?? resolved?.title ?? null,
      status: item.status ?? resolved?.status ?? null,
      latestCycleStatus: item.cycleStatus,
      latestCycleId: cycle.id,
      agentProfileId: item.agentProfileId,
      notes: item.notes,
    });

    const componentKey = item.componentId ?? "";
    const component = componentCounts.get(componentKey) ?? {
      componentId: item.componentId,
      totalReferences: 0,
      uniqueIds: new Set<string>(),
    };
    component.totalReferences += 1;
    component.uniqueIds.add(item.id);
    componentCounts.set(componentKey, component);

    if (item.cycleStatus) {
      byCycleStatus[item.cycleStatus] += 1;
    }
  }

  const uniqueReferences = [...unique.values()];
  return {
    totalReferences: all.length,
    uniqueReferences,
    byComponent: [...componentCounts.values()].map((component) => ({
      componentId: component.componentId,
      totalReferences: component.totalReferences,
      uniqueWorkItemCount: component.uniqueIds.size,
    })),
    byCycleStatus,
    progress: summarizeWorkItemProgress(uniqueReferences),
  };
}

function summarizeExecution(
  ledger: NexusAutomationRunLedger,
  workItemResolver: LocalWorkItemResolver,
): NexusAutomationTargetReportExecutionSummary {
  const runs = ledger.runs.map((run) => {
    const resolved = run.workItemId
      ? workItemResolver(run.componentId, run.workItemId)
      : null;
    return {
      runId: run.id,
      componentId: run.componentId,
      status: run.status,
      workItemId: run.workItemId,
      workItemTitle: run.workItemTitle ?? resolved?.title ?? null,
      workItemStatus: resolved?.status ?? null,
      commitIds: run.commitIds,
      summary: run.summary,
      error: run.error,
      codexAppServer: run.codexAppServer,
    } satisfies NexusAutomationTargetReportExecutionRunSummary;
  });
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const verification = ledger.runs.flatMap((run) => {
    const summary = runById.get(run.id);
    return run.verification.map((record) => ({
      runId: run.id,
      componentId: run.componentId,
      workItemId: run.workItemId,
      workItemTitle: summary?.workItemTitle ?? null,
      ...record,
    }));
  });
  const publicationDecisions = ledger.runs.flatMap((run) => {
    if (!run.publicationDecision) {
      return [];
    }
    const summary = runById.get(run.id);
    return [
      {
        runId: run.id,
        componentId: run.componentId,
        workItemId: run.workItemId,
        workItemTitle: summary?.workItemTitle ?? null,
        ...run.publicationDecision,
      },
    ];
  });

  return {
    runCount: ledger.runs.length,
    commitIds: uniqueStrings(ledger.runs.flatMap((run) => run.commitIds)),
    verification,
    publicationDecisions,
    runs,
  };
}

function summarizeActiveBlockers(options: {
  lastCycle: NexusAutomationTargetCycleRecord | null;
  lastRun: NexusAutomationRunRecord | null;
  workItemResolver: LocalWorkItemResolver;
}): NexusAutomationTargetReportActiveBlocker[] {
  const { lastCycle, lastRun, workItemResolver } = options;
  const active: NexusAutomationTargetReportActiveBlocker[] = [];
  if (
    lastCycle &&
    (lastCycle.status === "completed" || lastCycle.status === "skipped")
  ) {
    return active;
  }

  if (lastCycle) {
    for (const blocker of lastCycle.blockers) {
      active.push({
        source: "cycle",
        componentId: null,
        cycleId: lastCycle.id,
        runId: lastCycle.runId,
        workItemId: null,
        workItemTitle: null,
        message: blocker,
      });
    }
    for (const item of lastCycle.workItems) {
      const resolved = workItemResolver(item.componentId, item.id);
      const status = item.status ?? resolved?.status ?? null;
      if (item.cycleStatus !== "blocked" && status !== "blocked") {
        continue;
      }
      active.push({
        source: "work_item",
        componentId: item.componentId,
        cycleId: lastCycle.id,
        runId: lastCycle.runId,
        workItemId: item.id,
        workItemTitle: item.title ?? resolved?.title ?? null,
        message: item.notes,
      });
    }
  }

  if (
    lastRun &&
    (lastRun.status === "blocked" || lastRun.status === "failed") &&
    (!lastCycle || lastCycle.runId === lastRun.id)
  ) {
    const resolved = lastRun.workItemId
      ? workItemResolver(lastRun.componentId, lastRun.workItemId)
      : null;
    active.push({
      source: "run",
      componentId: lastRun.componentId,
      cycleId: lastCycle?.id ?? null,
      runId: lastRun.id,
      workItemId: lastRun.workItemId,
      workItemTitle: lastRun.workItemTitle ?? resolved?.title ?? null,
      message: lastRun.error,
    });
  }

  return active;
}

function summarizeComponentProgress(options: {
  components: ResolvedNexusProjectComponent[];
  workItemSummary: NexusAutomationTargetReportWorkItemSummary;
  executionSummary: NexusAutomationTargetReportExecutionSummary;
  activeBlockers: NexusAutomationTargetReportActiveBlocker[];
}): NexusAutomationTargetReportComponentProgressSummary[] {
  const drafts = new Map<
    string,
    {
      component: ResolvedNexusProjectComponent | null;
      componentId: string | null;
      workItems: NexusAutomationTargetReportWorkItemReference[];
      activeBlockers: NexusAutomationTargetReportActiveBlocker[];
      runs: NexusAutomationTargetReportExecutionRunSummary[];
    }
  >();
  const ensureDraft = (
    componentId: string | null,
    component: ResolvedNexusProjectComponent | null = null,
  ): {
    component: ResolvedNexusProjectComponent | null;
    componentId: string | null;
    workItems: NexusAutomationTargetReportWorkItemReference[];
    activeBlockers: NexusAutomationTargetReportActiveBlocker[];
    runs: NexusAutomationTargetReportExecutionRunSummary[];
  } => {
    const key = componentId ?? "";
    const existing = drafts.get(key);
    if (existing) {
      if (!existing.component && component) {
        existing.component = component;
      }
      return existing;
    }

    const draft = {
      component,
      componentId,
      workItems: [],
      activeBlockers: [],
      runs: [],
    };
    drafts.set(key, draft);
    return draft;
  };

  for (const component of options.components) {
    ensureDraft(component.id, component);
  }
  for (const item of options.workItemSummary.uniqueReferences) {
    ensureDraft(item.componentId).workItems.push(item);
  }
  for (const blocker of options.activeBlockers) {
    if (blocker.componentId !== null) {
      ensureDraft(blocker.componentId).activeBlockers.push(blocker);
    }
  }
  for (const run of options.executionSummary.runs) {
    ensureDraft(run.componentId).runs.push(run);
  }

  return [...drafts.values()].map((draft) => {
    const componentId = draft.component?.id ?? draft.componentId;
    const verification = options.executionSummary.verification.filter(
      (record) => record.componentId === componentId,
    );
    const publicationDecisions =
      options.executionSummary.publicationDecisions.filter(
        (decisionRecord) => decisionRecord.componentId === componentId,
      );

    return {
      componentId,
      componentName: draft.component?.name ?? componentId,
      role: draft.component?.role ?? null,
      sourceRoot: draft.component?.sourceRoot ?? null,
      workTrackingProvider: draft.component?.workTracking?.provider ?? null,
      workItemCount: draft.workItems.length,
      workItems: summarizeWorkItemProgress(draft.workItems),
      activeBlockers: draft.activeBlockers,
      commitIds: uniqueStrings(draft.runs.flatMap((run) => run.commitIds)),
      verification,
      publicationDecisions,
      runs: draft.runs,
    };
  });
}

function summarizeWorkItemProgress(
  references: NexusAutomationTargetReportWorkItemReference[],
): NexusAutomationTargetReportWorkItemProgressSummary {
  const progress = emptyWorkItemProgress();
  for (const reference of references) {
    const bucket = workItemProgressBucket(reference);
    if (bucket) {
      progress[bucket].push(reference);
    }
  }

  return progress;
}

function emptyWorkItemProgress(): NexusAutomationTargetReportWorkItemProgressSummary {
  return {
    readyEligibleWork: [],
    selectedWork: [],
    blockedHitlWork: [],
    completedWork: [],
    skippedWork: [],
  };
}

function workItemProgressBucket(
  reference: NexusAutomationTargetReportWorkItemReference,
): keyof NexusAutomationTargetReportWorkItemProgressSummary | null {
  switch (reference.latestCycleStatus) {
    case "eligible":
      return "readyEligibleWork";
    case "selected":
    case "dispatched":
    case "in_progress":
      return "selectedWork";
    case "blocked":
      return "blockedHitlWork";
    case "completed":
      return "completedWork";
    case "skipped":
      return "skippedWork";
    default:
      break;
  }

  switch (reference.status) {
    case "ready":
      return "readyEligibleWork";
    case "in_progress":
      return "selectedWork";
    case "blocked":
      return "blockedHitlWork";
    case "done":
      return "completedWork";
    case "wont_do":
      return "skippedWork";
    default:
      return null;
  }
}

function localWorkItemResolver(
  projectRoot: string,
  components: ResolvedNexusProjectComponent[],
): LocalWorkItemResolver {
  const primaryComponentId =
    components.find((component) => component.role === "primary")?.id ??
    components[0]?.id ??
    null;
  const itemsByComponent = new Map<string, Map<string, WorkItemSnapshot>>();
  for (const component of components) {
    const workTracking = component.workTracking;
    if (workTracking?.provider !== "local") {
      continue;
    }
    try {
      const store = loadLocalWorkTrackingStore(
        resolveLocalWorkTrackingStorePath(projectRoot, workTracking),
      );
      itemsByComponent.set(
        component.id,
        new Map(
          store.items.map((item) => [
            item.id,
            {
              title: item.title,
              status: item.status,
            },
          ]),
        ),
      );
    } catch {
      continue;
    }
  }

  return (componentId, id) => {
    const resolvedComponentId = componentId ?? primaryComponentId;
    if (!resolvedComponentId) {
      return null;
    }

    return itemsByComponent.get(resolvedComponentId)?.get(id) ?? null;
  };
}

function reportStatus(
  cycleLedger: NexusAutomationTargetCycleLedger,
  runLedger: NexusAutomationRunLedger,
): NexusAutomationTargetReportStatus {
  const lastCycle = cycleLedger.cycles.at(-1);
  if (lastCycle) {
    return cycleStatusToReportStatus(lastCycle.status);
  }

  const lastRun = runLedger.runs.at(-1);
  if (!lastRun) {
    return "not_started";
  }
  return "not_started";
}

function cycleStatusToReportStatus(
  status: NexusAutomationTargetCycleStatus,
): NexusAutomationTargetReportStatus {
  if (status === "started" || status === "dispatched") {
    return "active";
  }
  return status;
}

function reportStatusReason(
  status: NexusAutomationTargetReportStatus,
  lastCycle: NexusAutomationTargetCycleRecord | null,
  lastRun: NexusAutomationRunRecord | null,
): string {
  if (lastCycle) {
    return `Latest target cycle ${lastCycle.id} is ${lastCycle.status}`;
  }
  if (lastRun) {
    return `No target cycle is recorded; latest automation run ${lastRun.id} is ${lastRun.status}`;
  }
  if (status === "not_started") {
    return "No target cycles or automation runs are recorded";
  }

  return `Target report status is ${status}`;
}

function workItemKey(item: NexusAutomationTargetCycleWorkItem): string {
  return `${item.componentId ?? ""}:${item.id}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isoString(value: Date | string): string {
  return dateFrom(value, "date").toISOString();
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationTargetReportError(`${name} must be a valid date`);
  }

  return date;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationTargetReportError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
