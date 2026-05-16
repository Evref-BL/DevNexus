import path from "node:path";
import {
  readNexusAutomationRunLedger,
  type NexusAutomationRunLedger,
  type NexusAutomationRunRecord,
} from "./nexusAutomation.js";
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
}

export interface NexusAutomationTargetReportWorkItemReference {
  componentId: string | null;
  id: string;
  title: string | null;
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
  relaunchDecision: NexusAutomationTargetReportRelaunchDecision;
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
      relaunchDecision: {
        type: "not_ready",
        reason: "Project automation is not configured",
        eligibleWorkItemCount: null,
        latestCycleId: null,
        latestRunId: null,
      },
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
    workItemSummary: summarizeCycleWorkItems(cycleLedger),
    relaunchDecision: relaunchDecision({
      automationConfig,
      lastCycle: cycleSummary.lastCycle,
      lastRun: runSummary.lastRun,
    }),
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

  if (lastCycle.status === "started" || lastCycle.status === "dispatched") {
    return decision(
      "wait",
      `Latest target cycle ${lastCycle.id} is still ${lastCycle.status}`,
      lastCycle.eligibleWorkItemCount,
      lastCycle.id,
      lastRun?.id ?? null,
    );
  }
  if (lastCycle.status === "blocked") {
    return decision(
      "report_blocked",
      `Latest target cycle ${lastCycle.id} is blocked`,
      lastCycle.eligibleWorkItemCount,
      lastCycle.id,
      lastRun?.id ?? null,
    );
  }
  if (lastCycle.status === "failed") {
    return decision(
      "report_failed",
      `Latest target cycle ${lastCycle.id} failed`,
      lastCycle.eligibleWorkItemCount,
      lastCycle.id,
      lastRun?.id ?? null,
    );
  }

  const eligibleWorkItemCount = lastCycle.eligibleWorkItemCount;
  if (eligibleWorkItemCount === null) {
    return decision(
      "not_ready",
      `Latest target cycle ${lastCycle.id} did not record eligible work item count`,
      null,
      lastCycle.id,
      lastRun?.id ?? null,
    );
  }
  if (eligibleWorkItemCount > 0) {
    if (automationConfig.agent.relaunch.whileEligible) {
      return decision(
        "relaunch",
        `Latest target cycle ${lastCycle.id} recorded ${eligibleWorkItemCount} eligible work item(s) and relaunch while eligible is enabled`,
        eligibleWorkItemCount,
        lastCycle.id,
        lastRun?.id ?? null,
      );
    }

    return decision(
      "wait",
      `Latest target cycle ${lastCycle.id} recorded ${eligibleWorkItemCount} eligible work item(s), but relaunch while eligible is disabled`,
      eligibleWorkItemCount,
      lastCycle.id,
      lastRun?.id ?? null,
    );
  }

  if (automationConfig.target.stopWhenNoEligibleWork) {
    return decision(
      "stop",
      `Latest target cycle ${lastCycle.id} recorded no eligible work item(s)`,
      eligibleWorkItemCount,
      lastCycle.id,
      lastRun?.id ?? null,
    );
  }

  return decision(
    "wait",
    `Latest target cycle ${lastCycle.id} recorded no eligible work item(s), but stopWhenNoEligibleWork is disabled`,
    eligibleWorkItemCount,
    lastCycle.id,
    lastRun?.id ?? null,
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

function summarizeCycleWorkItems(
  ledger: NexusAutomationTargetCycleLedger,
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
    unique.set(key, {
      componentId: item.componentId,
      id: item.id,
      title: item.title,
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

  return {
    totalReferences: all.length,
    uniqueReferences: [...unique.values()],
    byComponent: [...componentCounts.values()].map((component) => ({
      componentId: component.componentId,
      totalReferences: component.totalReferences,
      uniqueWorkItemCount: component.uniqueIds.size,
    })),
    byCycleStatus,
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
