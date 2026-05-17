import path from "node:path";
import type { GitRunner } from "./gitWorktreeService.js";
import {
  runNexusAutomationAgentLaunchOnce,
  type NexusAutomationAgentLauncher,
  type RunNexusAutomationAgentLaunchOnceResult,
} from "./nexusAutomationAgentLaunch.js";
import {
  nextNexusAutomationSchedulerDelayMs,
} from "./nexusAutomationScheduler.js";
import {
  getNexusAutomationStatus,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  recordNexusAutomationTargetCycleRecord,
  type NexusAutomationTargetCycleRecord,
  type NexusAutomationTargetCycleStatus,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import type {
  NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import type { CreateWorkTrackerProviderOptions } from "./workTrackingProviderService.js";
import type { WorkItem } from "./workTrackingTypes.js";

export type NexusAutomationCoordinatorLoopAction =
  | "launched"
  | "waited"
  | "skipped"
  | "blocked"
  | "stopped";

export type NexusAutomationCoordinatorLoopDecisionType =
  | "launch"
  | "wait"
  | "skip"
  | "block"
  | "fail"
  | "stop";

export type NexusAutomationCoordinatorLoopStopReason =
  | "disabled"
  | "max_runs"
  | "max_ticks"
  | "no_work"
  | "blocked"
  | "failed"
  | "stopped";

export interface NexusAutomationCoordinatorLoopDecision {
  type: NexusAutomationCoordinatorLoopDecisionType;
  reason: string;
  nextTickNotBefore: string | null;
}

export interface NexusAutomationCoordinatorLoopTick {
  index: number;
  startedAt: string;
  finishedAt: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  decision: NexusAutomationCoordinatorLoopDecision;
  action: NexusAutomationCoordinatorLoopAction;
  waitMs: number | null;
  run: RunNexusAutomationAgentLaunchOnceResult | null;
  targetCycle: NexusAutomationTargetCycleRecord | null;
}

export interface RunNexusAutomationCoordinatorLoopOptions {
  projectRoot: string;
  launcher: NexusAutomationAgentLauncher;
  owner?: string | null;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  now?: () => Date | string;
  sleep?: (ms: number) => Promise<void>;
  onTick?: (tick: NexusAutomationCoordinatorLoopTick) => void | Promise<void>;
  intervalMs?: number;
  maxTicks?: number;
  maxRuns?: number;
  runIdPrefix?: string;
  shouldStop?: () => boolean;
}

export interface RunNexusAutomationCoordinatorLoopResult {
  projectRoot: string;
  startedAt: string;
  finishedAt: string;
  ticks: NexusAutomationCoordinatorLoopTick[];
  runs: RunNexusAutomationAgentLaunchOnceResult[];
  stoppedReason: NexusAutomationCoordinatorLoopStopReason;
}

export class NexusAutomationCoordinatorLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationCoordinatorLoopError";
  }
}

export async function runNexusAutomationCoordinatorLoop(
  options: RunNexusAutomationCoordinatorLoopOptions,
): Promise<RunNexusAutomationCoordinatorLoopResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const maxTicks = optionalPositiveInteger(options.maxTicks, "maxTicks");
  const maxRuns = optionalPositiveInteger(options.maxRuns, "maxRuns");
  const intervalOverride = optionalPositiveInteger(options.intervalMs, "intervalMs");
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = currentIso(options.now);
  const ticks: NexusAutomationCoordinatorLoopTick[] = [];
  const runs: RunNexusAutomationAgentLaunchOnceResult[] = [];
  let stoppedReason: NexusAutomationCoordinatorLoopStopReason = "stopped";

  while (true) {
    if (options.shouldStop?.()) {
      stoppedReason = "stopped";
      break;
    }

    const tickStartedAt = currentIso(options.now);
    const status = await getNexusAutomationStatus({
      projectRoot,
      providerFactory: options.providerFactory,
      providerOptions: options.providerOptions,
      gitRunner: options.gitRunner,
      now: options.now,
    });
    const targetReport = buildNexusAutomationTargetReport({
      projectRoot,
      now: tickStartedAt,
    });
    const intervalMs =
      intervalOverride ?? status.automationConfig?.schedule.intervalMs;
    const cycleId = coordinatorLoopCycleId(
      options.runIdPrefix,
      ticks.length + 1,
      tickStartedAt,
    );
    const runId = coordinatorLoopRunId(
      options.runIdPrefix,
      ticks.length + 1,
      tickStartedAt,
    );

    if (!status.automationConfig?.enabled) {
      const tick = coordinatorLoopTick({
        index: ticks.length + 1,
        startedAt: tickStartedAt,
        finishedAt: currentIso(options.now),
        status,
        targetReport,
        decision: {
          type: "stop",
          reason: status.summary,
          nextTickNotBefore: null,
        },
        action: "stopped",
        waitMs: null,
        run: null,
        targetCycle: null,
      });
      ticks.push(tick);
      await options.onTick?.(tick);
      stoppedReason = "disabled";
      break;
    }

    if (!status.automationConfig.schedule.enabled || !intervalMs) {
      const tick = recordDecisionTick({
        projectRoot,
        status,
        targetReport,
        index: ticks.length + 1,
        startedAt: tickStartedAt,
        finishedAt: currentIso(options.now),
        cycleId,
        decision: {
          type: "stop",
          reason: "Automation schedule is disabled for this project",
          nextTickNotBefore: null,
        },
        action: "stopped",
        waitMs: null,
        run: null,
        cycleStatus: "skipped",
        notes: [
          "managed-loop: decision=stop",
          "managed-loop: no coordinator launched",
        ],
      });
      ticks.push(tick);
      await options.onTick?.(tick);
      stoppedReason = "disabled";
      break;
    }

    if (status.automationConfig.mode !== "agent_launch") {
      const summary =
        "Managed coordinator loop requires automation.mode to be agent_launch";
      const tick = recordDecisionTick({
        projectRoot,
        status,
        targetReport,
        index: ticks.length + 1,
        startedAt: tickStartedAt,
        finishedAt: currentIso(options.now),
        cycleId,
        decision: {
          type: "block",
          reason: summary,
          nextTickNotBefore: null,
        },
        action: "blocked",
        waitMs: null,
        run: null,
        cycleStatus: "blocked",
        blockers: [summary],
        notes: [
          "managed-loop: decision=block",
          "managed-loop: no coordinator launched",
        ],
      });
      ticks.push(tick);
      await options.onTick?.(tick);
      stoppedReason = "blocked";
      break;
    }

    const statusBasedDecision = statusDecision(status, intervalMs, tickStartedAt);
    const targetGate = targetReportGateDecision(targetReport);
    const decision =
      statusBasedDecision.type === "launch"
        ? targetGate ?? statusBasedDecision
        : statusBasedDecision;
    if (decision.type !== "launch") {
      const action = actionForDecision(decision);
      const waitMs = waitMsForDecision(decision, status, intervalMs, tickStartedAt);
      const tick = recordDecisionTick({
        projectRoot,
        status,
        targetReport,
        index: ticks.length + 1,
        startedAt: tickStartedAt,
        finishedAt: currentIso(options.now),
        cycleId,
        decision,
        action,
        waitMs,
        run: null,
        cycleStatus: cycleStatusForDecision(decision),
        eligibleWorkItemCount: eligibleWorkItemCount(status),
        workItems: targetCycleWorkItems(status),
        blockers:
          decision.type === "block" || decision.type === "fail"
            ? [decision.reason]
            : [],
        nextCycleNotBefore: decision.nextTickNotBefore,
        notes: [
          `managed-loop: decision=${decision.type}`,
          "managed-loop: no coordinator launched",
        ],
      });
      ticks.push(tick);
      await options.onTick?.(tick);

      if (decision.type === "block") {
        stoppedReason = "blocked";
        break;
      }
      if (decision.type === "fail") {
        stoppedReason = "failed";
        break;
      }
      if (
        decision.type === "skip" &&
        status.status === "idle" &&
        status.automationConfig.target.stopWhenNoEligibleWork
      ) {
        stoppedReason = "no_work";
        break;
      }
    } else {
      recordCoordinatorLoopCycle({
        projectRoot,
        status,
        targetReport,
        cycleId,
        runId,
        cycleStatus: "dispatched",
        startedAt: tickStartedAt,
        finishedAt: null,
        summary: "Coordinator launch dispatched",
        eligibleWorkItemCount: eligibleWorkItemCount(status),
        workItems: targetCycleWorkItems(status),
        notes: [
          "managed-loop: decision=launch",
          "managed-loop: coordinator launched",
        ],
      });

      const run = await runNexusAutomationAgentLaunchOnce({
        projectRoot,
        providerFactory: options.providerFactory,
        providerOptions: options.providerOptions,
        gitRunner: options.gitRunner,
        owner: options.owner ?? "coordinator-loop",
        now: options.now,
        runId,
        launcher: options.launcher,
      });
      runs.push(run);
      const finishedAt = currentIso(options.now);
      const finalStatus =
        run.status === "completed"
          ? await getNexusAutomationStatus({
              projectRoot,
              providerFactory: options.providerFactory,
              providerOptions: options.providerOptions,
              gitRunner: options.gitRunner,
              now: options.now,
            })
          : status;
      const targetCycle = recordCoordinatorLoopCycle({
        projectRoot,
        status: finalStatus,
        targetReport,
        cycleId,
        runId,
        cycleStatus: targetCycleStatusForRun(run.status),
        startedAt: tickStartedAt,
        finishedAt,
        summary: run.summary,
        eligibleWorkItemCount: eligibleWorkItemCount(finalStatus),
        workItems: targetCycleWorkItems(finalStatus),
        blockers:
          run.status === "blocked" || run.status === "failed"
            ? [run.summary]
            : [],
        notes: [
          "managed-loop: decision=launch",
          "managed-loop: coordinator launched",
          `managed-loop: coordinator ${run.status}`,
        ],
      });
      const tick = coordinatorLoopTick({
        index: ticks.length + 1,
        startedAt: tickStartedAt,
        finishedAt,
        status,
        targetReport,
        decision,
        action: "launched",
        waitMs: null,
        run,
        targetCycle,
      });
      ticks.push(tick);
      await options.onTick?.(tick);
    }

    if (maxRuns !== undefined && runs.length >= maxRuns) {
      stoppedReason = "max_runs";
      break;
    }
    if (maxTicks !== undefined && ticks.length >= maxTicks) {
      stoppedReason = "max_ticks";
      break;
    }
    if (options.shouldStop?.()) {
      stoppedReason = "stopped";
      break;
    }

    const lastTick = ticks.at(-1);
    await sleep(lastTick?.waitMs ?? intervalMs);
  }

  return {
    projectRoot,
    startedAt,
    finishedAt: currentIso(options.now),
    ticks,
    runs,
    stoppedReason,
  };
}

function statusDecision(
  status: NexusAutomationStatus,
  intervalMs: number,
  now: string,
): NexusAutomationCoordinatorLoopDecision {
  if (status.status === "ready") {
    return {
      type: "launch",
      reason: status.summary,
      nextTickNotBefore: null,
    };
  }
  if (status.status === "locked") {
    return {
      type: "wait",
      reason: status.summary,
      nextTickNotBefore: status.lock?.expiresAt ?? null,
    };
  }
  if (status.status === "backoff") {
    return {
      type: "wait",
      reason: status.summary,
      nextTickNotBefore: status.backoff?.retryAfter ?? null,
    };
  }
  if (status.status === "blocked") {
    return {
      type: "block",
      reason: status.summary,
      nextTickNotBefore: null,
    };
  }
  if (status.status === "disabled") {
    return {
      type: "stop",
      reason: status.summary,
      nextTickNotBefore: null,
    };
  }

  const nextTickNotBefore =
    status.status === "idle" &&
    status.automationConfig?.target.stopWhenNoEligibleWork
      ? null
      : addMilliseconds(now, intervalMs);

  return {
    type: "skip",
    reason: status.summary,
    nextTickNotBefore,
  };
}

function targetReportGateDecision(
  report: NexusAutomationTargetReport,
): NexusAutomationCoordinatorLoopDecision | null {
  if (report.relaunchDecision.type === "wait") {
    return {
      type: "wait",
      reason: report.relaunchDecision.reason,
      nextTickNotBefore: null,
    };
  }
  if (report.relaunchDecision.type === "report_blocked") {
    return {
      type: "block",
      reason: report.relaunchDecision.reason,
      nextTickNotBefore: null,
    };
  }
  if (report.relaunchDecision.type === "report_failed") {
    return {
      type: "fail",
      reason: report.relaunchDecision.reason,
      nextTickNotBefore: null,
    };
  }

  return null;
}

function waitMsForDecision(
  decision: NexusAutomationCoordinatorLoopDecision,
  status: NexusAutomationStatus,
  intervalMs: number,
  now: string,
): number | null {
  if (decision.type === "block" || decision.type === "fail" || decision.type === "stop") {
    return null;
  }
  if (
    decision.type === "skip" &&
    status.status === "idle" &&
    status.automationConfig?.target.stopWhenNoEligibleWork
  ) {
    return null;
  }
  if (decision.nextTickNotBefore) {
    return delayUntil(decision.nextTickNotBefore, now);
  }
  if (status.status === "backoff" || status.status === "locked") {
    return nextNexusAutomationSchedulerDelayMs(status, intervalMs, now);
  }

  return intervalMs;
}

function actionForDecision(
  decision: NexusAutomationCoordinatorLoopDecision,
): NexusAutomationCoordinatorLoopAction {
  if (decision.type === "wait") {
    return "waited";
  }
  if (decision.type === "skip") {
    return "skipped";
  }
  if (decision.type === "block" || decision.type === "fail") {
    return "blocked";
  }

  return "stopped";
}

function cycleStatusForDecision(
  decision: NexusAutomationCoordinatorLoopDecision,
): NexusAutomationTargetCycleStatus {
  if (decision.type === "block") {
    return "blocked";
  }
  if (decision.type === "fail") {
    return "failed";
  }

  return "skipped";
}

function targetCycleStatusForRun(
  status: RunNexusAutomationAgentLaunchOnceResult["status"],
): NexusAutomationTargetCycleStatus {
  if (status === "completed") {
    return "completed";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "failed") {
    return "failed";
  }

  return "skipped";
}

function recordDecisionTick(options: {
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  index: number;
  startedAt: string;
  finishedAt: string;
  cycleId: string;
  decision: NexusAutomationCoordinatorLoopDecision;
  action: NexusAutomationCoordinatorLoopAction;
  waitMs: number | null;
  run: RunNexusAutomationAgentLaunchOnceResult | null;
  cycleStatus: NexusAutomationTargetCycleStatus;
  eligibleWorkItemCount?: number | null;
  workItems?: ReturnType<typeof targetCycleWorkItems>;
  blockers?: string[];
  nextCycleNotBefore?: string | null;
  notes?: string[];
}): NexusAutomationCoordinatorLoopTick {
  const targetCycle = recordCoordinatorLoopCycle({
    projectRoot: options.projectRoot,
    status: options.status,
    targetReport: options.targetReport,
    cycleId: options.cycleId,
    cycleStatus: options.cycleStatus,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    summary: options.decision.reason,
    eligibleWorkItemCount: options.eligibleWorkItemCount ?? null,
    workItems: options.workItems ?? [],
    blockers: options.blockers ?? [],
    nextCycleNotBefore: options.nextCycleNotBefore ?? null,
    notes: options.notes ?? [],
  });

  return coordinatorLoopTick({
    index: options.index,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    status: options.status,
    targetReport: options.targetReport,
    decision: options.decision,
    action: options.action,
    waitMs: options.waitMs,
    run: options.run,
    targetCycle,
  });
}

function recordCoordinatorLoopCycle(options: {
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  cycleId: string;
  runId?: string | null;
  cycleStatus: NexusAutomationTargetCycleStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  eligibleWorkItemCount: number | null;
  workItems: ReturnType<typeof targetCycleWorkItems>;
  blockers?: string[];
  nextCycleNotBefore?: string | null;
  notes?: string[];
}): NexusAutomationTargetCycleRecord {
  const automationConfig = options.status.automationConfig;
  if (!automationConfig) {
    throw new NexusAutomationCoordinatorLoopError(
      "automationConfig is required to record target cycle facts",
    );
  }

  const ledger = recordNexusAutomationTargetCycleRecord({
    projectRoot: options.projectRoot,
    config: automationConfig,
    now: options.finishedAt ?? options.startedAt,
    record: {
      id: options.cycleId,
      projectId: options.status.projectConfig.id,
      targetId: automationConfig.target.id,
      runId: options.runId ?? null,
      status: options.cycleStatus,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      objective: automationConfig.target.objective,
      summary: options.summary,
      eligibleWorkItemCount: options.eligibleWorkItemCount,
      workItems: options.workItems,
      blockers: options.blockers ?? [],
      notes: [
        ...(options.notes ?? []),
        `managed-loop: target-report=${options.targetReport.relaunchDecision.type}`,
      ],
      nextCycleNotBefore: options.nextCycleNotBefore ?? null,
    },
  });

  return ledger.cycles.at(-1)!;
}

function targetCycleWorkItems(status: NexusAutomationStatus) {
  const grouped =
    status.componentEligibleWorkItems ??
    (status.selectedWorkItem
      ? [
          {
            componentId: primaryComponentId(status),
            workItems: [status.selectedWorkItem],
          },
        ]
      : []);

  return grouped.flatMap((component) =>
    component.workItems.map((item: WorkItem) => ({
      componentId: component.componentId,
      id: item.id,
      title: item.title,
      status: item.status,
      cycleStatus: "eligible" as const,
    })),
  );
}

function eligibleWorkItemCount(status: NexusAutomationStatus): number {
  if (status.componentEligibleWorkItems) {
    return status.componentEligibleWorkItems.reduce(
      (total, component) => total + component.workItems.length,
      0,
    );
  }
  if (status.eligibleWorkItems) {
    return status.eligibleWorkItems.length;
  }
  if (status.selectedWorkItem) {
    return 1;
  }

  return status.status === "idle" ? 0 : status.candidateCount ?? 0;
}

function primaryComponentId(status: NexusAutomationStatus): string {
  return (
    status.components.find((component) => component.role === "primary")?.id ??
    status.components[0]?.id ??
    "primary"
  );
}

function coordinatorLoopTick(
  tick: NexusAutomationCoordinatorLoopTick,
): NexusAutomationCoordinatorLoopTick {
  return tick;
}

function coordinatorLoopRunId(
  prefix: string | undefined,
  tickIndex: number,
  timestamp: string,
): string {
  return [
    safeIdSegment(prefix ?? "coordinator-loop"),
    timestampSegment(timestamp),
    tickIndex.toString(),
  ].join("-");
}

function coordinatorLoopCycleId(
  prefix: string | undefined,
  tickIndex: number,
  timestamp: string,
): string {
  return `target-cycle-${coordinatorLoopRunId(prefix, tickIndex, timestamp)}`;
}

function safeIdSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new NexusAutomationCoordinatorLoopError(
      "runIdPrefix must contain at least one safe character",
    );
  }

  return normalized;
}

function timestampSegment(timestamp: string): string {
  return timestamp
    .replace(/^(\d{4})-(\d{2})-(\d{2})T/u, "$1$2$3-t")
    .replaceAll(":", "")
    .replace(".", "-")
    .replace(/Z$/u, "-z")
    .toLowerCase();
}

function addMilliseconds(timestamp: Date | string, ms: number): string {
  return new Date(dateFrom(timestamp, "timestamp").getTime() + ms).toISOString();
}

function delayUntil(target: Date | string, now: Date | string): number {
  return Math.max(
    0,
    dateFrom(target, "target").getTime() - dateFrom(now, "now").getTime(),
  );
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  return dateFrom(value, "now").toISOString();
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationCoordinatorLoopError(`${name} must be a valid date`);
  }

  return date;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function optionalPositiveInteger(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new NexusAutomationCoordinatorLoopError(
      `${name} must be a positive integer`,
    );
  }

  return value;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationCoordinatorLoopError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
