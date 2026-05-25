import path from "node:path";
import type { GitRunner } from "../worktrees/gitWorktreeService.js";
import {
  eligibleNexusAutomationWorkItems,
} from "./nexusAutomation.js";
import {
  runNexusAutomationAgentLaunchOnce,
  type NexusAutomationAgentLaunchWorkItemClaim,
  type NexusAutomationAgentLauncher,
  type NexusAutomationAgentResultWorkItem,
  type NexusAutomationAgentResultWorkItemStatus,
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
  type NexusAutomationTargetCycleWorkItemInput,
  type NexusAutomationTargetCycleWorkItemStatus,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import type { NexusMcpRuntimeProcess } from "../project/nexusSetupAssistant.js";
import type { NexusWorkItemClaimOwnerInput } from "../work-items/nexusWorkItemClaim.js";
import type {
  NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import type { CreateWorkTrackerProviderOptions } from "../work-items/workTrackingProviderService.js";
import {
  createWorkItemService,
  type WorkItemProviderFactory,
  type WorkItemProjectResolver,
} from "../work-items/workItemService.js";
import type {
  WorkItem,
  WorkItemRef,
  WorkStatus,
} from "../work-items/workTrackingTypes.js";
import {
  isLowerAsciiIdentifierSegmentCharacter,
  replaceRunsWithHyphen,
  trimHyphens,
} from "../runtime/nexusTextNormalization.js";

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

export type NexusAutomationCoordinatorLoopProgressEvent =
  | {
      type: "loop_started";
      projectRoot: string;
      startedAt: string;
    }
  | {
      type: "tick_started";
      index: number;
      startedAt: string;
    }
  | {
      type: "decision";
      index: number;
      status: NexusAutomationStatus["status"];
      summary: string;
      decision: NexusAutomationCoordinatorLoopDecision;
      eligibleWorkItemCount: number;
    }
  | {
      type: "launch_dispatched";
      index: number;
      runId: string;
      cycleId: string;
      eligibleWorkItemCount: number;
    }
  | {
      type: "run_started";
      index: number;
      runId: string;
    }
  | {
      type: "run_finished";
      index: number;
      runId: string;
      status: RunNexusAutomationAgentLaunchOnceResult["status"];
      summary: string;
    }
  | {
      type: "tick_finished";
      index: number;
      finishedAt: string;
      action: NexusAutomationCoordinatorLoopAction;
    }
  | {
      type: "loop_stopped";
      projectRoot: string;
      finishedAt: string;
      stoppedReason: NexusAutomationCoordinatorLoopStopReason;
      tickCount: number;
      runCount: number;
    };

export interface RunNexusAutomationCoordinatorLoopOptions {
  projectRoot: string;
  launcher: NexusAutomationAgentLauncher;
  owner?: string | null;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  mcpRuntimeProcesses?: readonly NexusMcpRuntimeProcess[] | false;
  workItemClaimOwner?: NexusWorkItemClaimOwnerInput;
  workItemClaimLeaseTokenFactory?: () => string;
  now?: () => Date | string;
  sleep?: (ms: number) => Promise<void>;
  onTick?: (tick: NexusAutomationCoordinatorLoopTick) => void | Promise<void>;
  intervalMs?: number;
  maxTicks?: number;
  maxRuns?: number;
  runIdPrefix?: string;
  shouldStop?: () => boolean;
  onProgress?: (
    event: NexusAutomationCoordinatorLoopProgressEvent,
  ) => void | Promise<void>;
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
  await emitCoordinatorLoopProgress(options, {
    type: "loop_started",
    projectRoot,
    startedAt,
  });

  while (true) {
    if (options.shouldStop?.()) {
      stoppedReason = "stopped";
      break;
    }

    const tickResult = await runCoordinatorLoopTick({
      options,
      projectRoot,
      intervalOverride,
      tickIndex: ticks.length + 1,
    });
    ticks.push(tickResult.tick);
    if (tickResult.run) {
      runs.push(tickResult.run);
    }
    if (tickResult.stoppedReason) {
      stoppedReason = tickResult.stoppedReason;
      break;
    }

    const limitStopReason = coordinatorLoopLimitStopReason({
      maxRuns,
      runCount: runs.length,
      maxTicks,
      tickCount: ticks.length,
    });
    if (limitStopReason) {
      stoppedReason = limitStopReason;
      break;
    }
    if (options.shouldStop?.()) {
      stoppedReason = "stopped";
      break;
    }

    await sleep(tickResult.sleepMs);
  }

  const finishedAt = currentIso(options.now);
  await emitCoordinatorLoopProgress(options, {
    type: "loop_stopped",
    projectRoot,
    finishedAt,
    stoppedReason,
    tickCount: ticks.length,
    runCount: runs.length,
  });

  return {
    projectRoot,
    startedAt,
    finishedAt,
    ticks,
    runs,
    stoppedReason,
  };
}

async function emitCoordinatorLoopProgress(
  options: RunNexusAutomationCoordinatorLoopOptions,
  event: NexusAutomationCoordinatorLoopProgressEvent,
): Promise<void> {
  await options.onProgress?.(event);
}

interface CoordinatorLoopTickRun {
  tick: NexusAutomationCoordinatorLoopTick;
  run: RunNexusAutomationAgentLaunchOnceResult | null;
  stoppedReason: NexusAutomationCoordinatorLoopStopReason | null;
  sleepMs: number;
}

async function runCoordinatorLoopTick(options: {
  options: RunNexusAutomationCoordinatorLoopOptions;
  projectRoot: string;
  intervalOverride: number | undefined;
  tickIndex: number;
}): Promise<CoordinatorLoopTickRun> {
  const tickStartedAt = currentIso(options.options.now);
  await emitCoordinatorLoopProgress(options.options, {
    type: "tick_started",
    index: options.tickIndex,
    startedAt: tickStartedAt,
  });
  const status = await getNexusAutomationStatus({
    projectRoot: options.projectRoot,
    providerFactory: options.options.providerFactory,
    providerOptions: options.options.providerOptions,
    gitRunner: options.options.gitRunner,
    now: options.options.now,
  });
  const targetReport = buildNexusAutomationTargetReport({
    projectRoot: options.projectRoot,
    now: tickStartedAt,
  });
  const intervalMs =
    options.intervalOverride ?? status.automationConfig?.schedule.intervalMs;
  const cycleId = coordinatorLoopCycleId(
    options.options.runIdPrefix,
    options.tickIndex,
    tickStartedAt,
  );
  const earlyStop = await coordinatorLoopEarlyStopTick({
    options: options.options,
    projectRoot: options.projectRoot,
    status,
    targetReport,
    tickIndex: options.tickIndex,
    tickStartedAt,
    cycleId,
    intervalMs,
  });
  if (earlyStop) {
    return { ...earlyStop, run: null, sleepMs: 0 };
  }

  const activeIntervalMs = requiredCoordinatorLoopIntervalMs(intervalMs);
  const decision = coordinatorLoopDecision(status, targetReport, activeIntervalMs, tickStartedAt);
  await emitCoordinatorDecisionProgress(
    { options: options.options, tickIndex: options.tickIndex, status },
    decision,
  );
  if (decision.type !== "launch") {
    const decisionTick = await coordinatorLoopNonLaunchDecisionTick({
      options: options.options,
      projectRoot: options.projectRoot,
      status,
      targetReport,
      tickIndex: options.tickIndex,
      tickStartedAt,
      cycleId,
      intervalMs: activeIntervalMs,
      decision,
    });
    return { ...decisionTick, run: null, sleepMs: decisionTick.tick.waitMs ?? activeIntervalMs };
  }

  const launchTick = await coordinatorLoopLaunchTick({
    options: options.options,
    projectRoot: options.projectRoot,
    status,
    targetReport,
    tickIndex: options.tickIndex,
    tickStartedAt,
    cycleId,
    runId: coordinatorLoopRunId(options.options.runIdPrefix, options.tickIndex, tickStartedAt),
    decision,
  });
  return { ...launchTick, stoppedReason: null, sleepMs: activeIntervalMs };
}

function coordinatorLoopDecision(
  status: NexusAutomationStatus,
  targetReport: NexusAutomationTargetReport,
  intervalMs: number,
  tickStartedAt: string,
): NexusAutomationCoordinatorLoopDecision {
  const statusBasedDecision = statusDecision(status, intervalMs, tickStartedAt);
  const targetGate = targetReportGateDecision(targetReport);
  return statusBasedDecision.type === "launch"
    ? targetGate ?? statusBasedDecision
    : statusBasedDecision;
}

function coordinatorLoopLimitStopReason(options: {
  maxRuns: number | undefined;
  runCount: number;
  maxTicks: number | undefined;
  tickCount: number;
}): NexusAutomationCoordinatorLoopStopReason | null {
  if (options.maxRuns !== undefined && options.runCount >= options.maxRuns) {
    return "max_runs";
  }
  if (options.maxTicks !== undefined && options.tickCount >= options.maxTicks) {
    return "max_ticks";
  }
  return null;
}

interface CoordinatorLoopStoppedTick {
  tick: NexusAutomationCoordinatorLoopTick;
  stoppedReason: NexusAutomationCoordinatorLoopStopReason;
}

interface CoordinatorLoopDecisionTick {
  tick: NexusAutomationCoordinatorLoopTick;
  stoppedReason: NexusAutomationCoordinatorLoopStopReason | null;
}

interface CoordinatorLoopLaunchTick {
  tick: NexusAutomationCoordinatorLoopTick;
  run: RunNexusAutomationAgentLaunchOnceResult;
}

async function coordinatorLoopEarlyStopTick(options: {
  options: RunNexusAutomationCoordinatorLoopOptions;
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  tickIndex: number;
  tickStartedAt: string;
  cycleId: string;
  intervalMs: number | undefined;
}): Promise<CoordinatorLoopStoppedTick | null> {
  if (!options.status.automationConfig?.enabled) {
    const decision: NexusAutomationCoordinatorLoopDecision = {
      type: "stop",
      reason: options.status.summary,
      nextTickNotBefore: null,
    };
    await emitCoordinatorDecisionProgress(options, decision);
    const tick = coordinatorLoopTick({
      index: options.tickIndex,
      startedAt: options.tickStartedAt,
      finishedAt: currentIso(options.options.now),
      status: options.status,
      targetReport: options.targetReport,
      decision,
      action: "stopped",
      waitMs: null,
      run: null,
      targetCycle: null,
    });
    await finishCoordinatorLoopTick(options.options, tick);
    return { tick, stoppedReason: "disabled" };
  }

  if (!options.status.automationConfig.schedule.enabled || !options.intervalMs) {
    return coordinatorLoopRecordedStopTick({
      ...options,
      decision: {
        type: "stop",
        reason: "Automation schedule is disabled for this project",
        nextTickNotBefore: null,
      },
      cycleStatus: "skipped",
      stoppedReason: "disabled",
      notes: [
        "managed-loop: decision=stop",
        "managed-loop: no coordinator launched",
      ],
    });
  }

  if (options.status.automationConfig.mode !== "agent_launch") {
    const summary =
      "Managed coordinator loop requires automation.mode to be agent_launch";
    return coordinatorLoopRecordedStopTick({
      ...options,
      decision: {
        type: "block",
        reason: summary,
        nextTickNotBefore: null,
      },
      action: "blocked",
      cycleStatus: "blocked",
      stoppedReason: "blocked",
      blockers: [summary],
      notes: [
        "managed-loop: decision=block",
        "managed-loop: no coordinator launched",
      ],
    });
  }

  return null;
}

function requiredCoordinatorLoopIntervalMs(intervalMs: number | undefined): number {
  if (intervalMs === undefined) {
    throw new NexusAutomationCoordinatorLoopError(
      "Automation schedule interval is not configured for this project",
    );
  }
  return intervalMs;
}

async function coordinatorLoopRecordedStopTick(options: {
  options: RunNexusAutomationCoordinatorLoopOptions;
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  tickIndex: number;
  tickStartedAt: string;
  cycleId: string;
  decision: NexusAutomationCoordinatorLoopDecision;
  action?: NexusAutomationCoordinatorLoopAction;
  cycleStatus: NexusAutomationTargetCycleStatus;
  stoppedReason: NexusAutomationCoordinatorLoopStopReason;
  blockers?: string[];
  notes: string[];
}): Promise<CoordinatorLoopStoppedTick> {
  await emitCoordinatorDecisionProgress(options, options.decision);
  const tick = recordDecisionTick({
    projectRoot: options.projectRoot,
    status: options.status,
    targetReport: options.targetReport,
    index: options.tickIndex,
    startedAt: options.tickStartedAt,
    finishedAt: currentIso(options.options.now),
    cycleId: options.cycleId,
    decision: options.decision,
    action: options.action ?? "stopped",
    waitMs: null,
    run: null,
    cycleStatus: options.cycleStatus,
    blockers: options.blockers,
    notes: options.notes,
  });
  await finishCoordinatorLoopTick(options.options, tick);
  return { tick, stoppedReason: options.stoppedReason };
}

async function coordinatorLoopNonLaunchDecisionTick(options: {
  options: RunNexusAutomationCoordinatorLoopOptions;
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  tickIndex: number;
  tickStartedAt: string;
  cycleId: string;
  intervalMs: number;
  decision: NexusAutomationCoordinatorLoopDecision;
}): Promise<CoordinatorLoopDecisionTick> {
  const action = actionForDecision(options.decision);
  const waitMs = waitMsForDecision(
    options.decision,
    options.status,
    options.intervalMs,
    options.tickStartedAt,
  );
  const tick = recordDecisionTick({
    projectRoot: options.projectRoot,
    status: options.status,
    targetReport: options.targetReport,
    index: options.tickIndex,
    startedAt: options.tickStartedAt,
    finishedAt: currentIso(options.options.now),
    cycleId: options.cycleId,
    decision: options.decision,
    action,
    waitMs,
    run: null,
    cycleStatus: cycleStatusForDecision(options.decision),
    eligibleWorkItemCount: eligibleWorkItemCount(options.status),
    workItems: targetCycleWorkItems(options.status),
    blockers: coordinatorDecisionBlockers(options.decision),
    nextCycleNotBefore: options.decision.nextTickNotBefore,
    notes: [
      `managed-loop: decision=${options.decision.type}`,
      "managed-loop: no coordinator launched",
    ],
  });
  await finishCoordinatorLoopTick(options.options, tick);
  return {
    tick,
    stoppedReason: stoppedReasonForCoordinatorDecision(
      options.decision,
      options.status,
    ),
  };
}

async function coordinatorLoopLaunchTick(options: {
  options: RunNexusAutomationCoordinatorLoopOptions;
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  tickIndex: number;
  tickStartedAt: string;
  cycleId: string;
  runId: string;
  decision: NexusAutomationCoordinatorLoopDecision;
}): Promise<CoordinatorLoopLaunchTick> {
  recordCoordinatorLoopCycle({
    projectRoot: options.projectRoot,
    status: options.status,
    targetReport: options.targetReport,
    cycleId: options.cycleId,
    runId: options.runId,
    cycleStatus: "dispatched",
    startedAt: options.tickStartedAt,
    finishedAt: null,
    summary: "Coordinator launch dispatched",
    eligibleWorkItemCount: eligibleWorkItemCount(options.status),
    workItems: targetCycleWorkItems(options.status),
    notes: [
      "managed-loop: decision=launch",
      "managed-loop: coordinator launched",
    ],
  });
  await emitCoordinatorLoopProgress(options.options, {
    type: "launch_dispatched",
    index: options.tickIndex,
    runId: options.runId,
    cycleId: options.cycleId,
    eligibleWorkItemCount: eligibleWorkItemCount(options.status),
  });
  await emitCoordinatorLoopProgress(options.options, {
    type: "run_started",
    index: options.tickIndex,
    runId: options.runId,
  });

  const run = await runNexusAutomationAgentLaunchOnce({
    projectRoot: options.projectRoot,
    providerFactory: options.options.providerFactory,
    providerOptions: options.options.providerOptions,
    gitRunner: options.options.gitRunner,
    mcpRuntimeProcesses: options.options.mcpRuntimeProcesses,
    workItemClaimOwner: options.options.workItemClaimOwner,
    workItemClaimLeaseTokenFactory: options.options.workItemClaimLeaseTokenFactory,
    owner: options.options.owner ?? "coordinator-loop",
    now: options.options.now,
    runId: options.runId,
    launcher: options.options.launcher,
  });
  await emitCoordinatorLoopProgress(options.options, {
    type: "run_finished",
    index: options.tickIndex,
    runId: options.runId,
    status: run.status,
    summary: run.summary,
  });
  const finishedAt = currentIso(options.options.now);
  const finalization = await finalizeCoordinatorRun({
    projectRoot: options.projectRoot,
    initialStatus: options.status,
    run,
    finishedAt,
    providerFactory: options.options.providerFactory,
    providerOptions: options.options.providerOptions,
    gitRunner: options.options.gitRunner,
    now: options.options.now,
  });
  const targetCycle = recordCoordinatorFinishedCycle({
    ...options,
    run,
    finishedAt,
    finalization,
  });
  const tick = coordinatorLoopTick({
    index: options.tickIndex,
    startedAt: options.tickStartedAt,
    finishedAt,
    status: options.status,
    targetReport: options.targetReport,
    decision: options.decision,
    action: "launched",
    waitMs: null,
    run,
    targetCycle,
  });
  await finishCoordinatorLoopTick(options.options, tick);
  return { tick, run };
}

function recordCoordinatorFinishedCycle(options: {
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  tickStartedAt: string;
  cycleId: string;
  runId: string;
  run: RunNexusAutomationAgentLaunchOnceResult;
  finishedAt: string;
  finalization: Awaited<ReturnType<typeof finalizeCoordinatorRun>>;
}): NexusAutomationTargetCycleRecord {
  return recordCoordinatorLoopCycle({
    projectRoot: options.projectRoot,
    status: options.finalization.status,
    targetReport: options.targetReport,
    cycleId: options.cycleId,
    runId: options.runId,
    cycleStatus: options.finalization.cycleStatus,
    startedAt: options.tickStartedAt,
    finishedAt: options.finishedAt,
    summary: options.run.summary,
    eligibleWorkItemCount: options.finalization.eligibleWorkItemCount,
    workItems: options.finalization.workItems,
    blockers: options.finalization.blockers,
    notes: [
      "managed-loop: decision=launch",
      "managed-loop: coordinator launched",
      `managed-loop: coordinator ${options.run.status}`,
      ...options.finalization.notes,
      ...agentLaunchTargetCycleNotes(options.run),
    ],
  });
}

async function finishCoordinatorLoopTick(
  options: RunNexusAutomationCoordinatorLoopOptions,
  tick: NexusAutomationCoordinatorLoopTick,
): Promise<void> {
  await options.onTick?.(tick);
  await emitCoordinatorLoopProgress(options, {
    type: "tick_finished",
    index: tick.index,
    finishedAt: tick.finishedAt,
    action: tick.action,
  });
}

function emitCoordinatorDecisionProgress(
  options: {
    options: RunNexusAutomationCoordinatorLoopOptions;
    tickIndex: number;
    status: NexusAutomationStatus;
  },
  decision: NexusAutomationCoordinatorLoopDecision,
): Promise<void> {
  return emitCoordinatorLoopProgress(options.options, {
    type: "decision",
    index: options.tickIndex,
    status: options.status.status,
    summary: options.status.summary,
    decision,
    eligibleWorkItemCount: eligibleWorkItemCount(options.status),
  });
}

function coordinatorDecisionBlockers(
  decision: NexusAutomationCoordinatorLoopDecision,
): string[] {
  return decision.type === "block" || decision.type === "fail"
    ? [decision.reason]
    : [];
}

function stoppedReasonForCoordinatorDecision(
  decision: NexusAutomationCoordinatorLoopDecision,
  status: NexusAutomationStatus,
): NexusAutomationCoordinatorLoopStopReason | null {
  if (decision.type === "block") {
    return "blocked";
  }
  if (decision.type === "fail") {
    return "failed";
  }
  if (
    decision.type === "skip" &&
    status.status === "idle" &&
    status.automationConfig?.target.stopWhenNoEligibleWork
  ) {
    return "no_work";
  }
  return null;
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

interface FinalizeCoordinatorRunResult {
  status: NexusAutomationStatus;
  cycleStatus: NexusAutomationTargetCycleStatus;
  eligibleWorkItemCount: number;
  workItems: NexusAutomationTargetCycleWorkItemInput[];
  blockers: string[];
  notes: string[];
}

interface SelectedCoordinatorWorkItem
  extends NexusAutomationTargetCycleWorkItemInput {
  componentId: string;
  trackerId: string;
  trackerProvider: string | null;
}

interface ReconciledCoordinatorWorkItem {
  cycleItem: NexusAutomationTargetCycleWorkItemInput;
  workItem: WorkItem | null;
  blocker: string | null;
  note: string | null;
}

async function finalizeCoordinatorRun(options: {
  projectRoot: string;
  initialStatus: NexusAutomationStatus;
  run: RunNexusAutomationAgentLaunchOnceResult;
  finishedAt: string;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}): Promise<FinalizeCoordinatorRunResult> {
  const selectedItems = selectedCoordinatorWorkItems(
    options.initialStatus,
    options.run,
  );
  const resultMapping = mapCoordinatorResultWorkItems(
    options.run,
    selectedItems,
  );
  const service = coordinatorWorkItemService({
    projectRoot: options.projectRoot,
    status: options.initialStatus,
    providerFactory: options.providerFactory,
    providerOptions: options.providerOptions,
    now: options.now,
  });
  const reconciled: ReconciledCoordinatorWorkItem[] = [];

  for (const selected of selectedItems) {
    reconciled.push(
      await reconcileSelectedWorkItem({
        service,
        projectRoot: options.projectRoot,
        selected,
        result: resultMapping.results.get(workItemKey(selected)) ?? null,
      }),
    );
  }

  const blockers = [
    ...resultMapping.blockers,
    ...reconciled.flatMap((item) => (item.blocker ? [item.blocker] : [])),
    ...(options.run.status === "blocked" || options.run.status === "failed"
      ? [options.run.summary]
      : []),
  ];
  const notes = reconciled.flatMap((item) => (item.note ? [item.note] : []));
  const refreshedStatus =
    options.run.status === "completed"
      ? await getNexusAutomationStatus({
          projectRoot: options.projectRoot,
          providerFactory: options.providerFactory,
          providerOptions: options.providerOptions,
          gitRunner: options.gitRunner,
          now: options.now,
        })
      : options.initialStatus;
  const selectedKeys = new Set(selectedItems.map(workItemKey));
  const nonSelectedEligibleWorkItems = targetCycleWorkItems(refreshedStatus)
    .filter((item) => !selectedKeys.has(workItemKey(item)));
  const selectedEligibleCount = reconciled.filter((item) =>
    item.workItem
      ? eligibleNexusAutomationWorkItems(
          [item.workItem],
          options.initialStatus.automationConfig!,
        ).length > 0
      : false,
  ).length;
  const eligibleWorkItemCount =
    selectedEligibleCount + nonSelectedEligibleWorkItems.length;
  const workItems = [
    ...reconciled.map((item) => item.cycleItem),
    ...nonSelectedEligibleWorkItems,
  ];

  return {
    status: refreshedStatus,
    cycleStatus: reconciledCycleStatus({
      runStatus: options.run.status,
      workItems,
      blockers,
    }),
    eligibleWorkItemCount,
    workItems,
    blockers,
    notes,
  };
}

function selectedCoordinatorWorkItems(
  status: NexusAutomationStatus,
  run?: RunNexusAutomationAgentLaunchOnceResult,
): SelectedCoordinatorWorkItem[] {
  const claimed = selectedCoordinatorClaimWorkItem(status, run?.workItemClaim);
  if (run?.workItemClaim && run.workItemClaim.status !== "disabled") {
    return claimed ? [claimed] : [];
  }

  return targetCycleWorkItems(status).map((item) => ({
    ...item,
    componentId: item.componentId ?? primaryComponentId(status),
    trackerId: item.trackerId ?? "default",
    trackerProvider: item.trackerProvider ?? null,
  }));
}

function selectedCoordinatorClaimWorkItem(
  status: NexusAutomationStatus,
  claim: NexusAutomationAgentLaunchWorkItemClaim | null | undefined,
): SelectedCoordinatorWorkItem | null {
  if (!claim || claim.status === "disabled") {
    return null;
  }
  if (claim.status !== "claimed" || !claim.workItemId || !claim.componentId) {
    return null;
  }

  const cycleItems = targetCycleWorkItems(status);
  const matched = cycleItems.find(
    (item) =>
      item.id === claim.workItemId &&
      (item.componentId ?? primaryComponentId(status)) === claim.componentId,
  );
  const component = status.components.find(
    (candidate) => candidate.id === claim.componentId,
  );
  return {
    ...matched,
    componentId: claim.componentId,
    trackerId: claim.trackerId ?? matched?.trackerId ?? component?.defaultTrackerId ?? "default",
    trackerProvider:
      matched?.trackerProvider ?? component?.workTracking?.provider ?? null,
    id: claim.workItemId,
    logicalItemId:
      claim.logicalWorkItemId ?? matched?.logicalItemId ?? claim.workItemId,
    title: claim.workItemTitle ?? matched?.title ?? null,
    status: "in_progress",
    cycleStatus: "selected",
  };
}

function mapCoordinatorResultWorkItems(
  run: RunNexusAutomationAgentLaunchOnceResult,
  selectedItems: SelectedCoordinatorWorkItem[],
): {
  results: Map<string, NexusAutomationAgentResultWorkItem>;
  blockers: string[];
} {
  const explicitResults = run.launch?.workItems;
  const blockers: string[] = [];
  const results = new Map<string, NexusAutomationAgentResultWorkItem>();
  if (!explicitResults || explicitResults.length === 0) {
    return defaultCoordinatorResultWorkItems(run, selectedItems);
  }

  for (const result of explicitResults) {
    recordExplicitCoordinatorResult({
      result,
      selectedItems,
      results,
      blockers,
    });
  }

  appendMissingCoordinatorResultBlockers(selectedItems, results, blockers);

  return { results, blockers };
}

function defaultCoordinatorResultWorkItems(
  run: RunNexusAutomationAgentLaunchOnceResult,
  selectedItems: SelectedCoordinatorWorkItem[],
): {
  results: Map<string, NexusAutomationAgentResultWorkItem>;
  blockers: string[];
} {
  const results = new Map<string, NexusAutomationAgentResultWorkItem>();
  if (selectedItems.length === 1) {
    recordDefaultCoordinatorResult(run, selectedItems[0]!, results);
    return { results, blockers: [] };
  }
  if (selectedItems.length > 1 && run.status !== "completed") {
    for (const selected of selectedItems) {
      recordDefaultCoordinatorResult(run, selected, results);
    }
    return { results, blockers: [] };
  }
  return {
    results,
    blockers:
      selectedItems.length > 1
        ? ["Coordinator result contract is missing workItems for a multi-item completed run"]
        : [],
  };
}

function recordDefaultCoordinatorResult(
  run: RunNexusAutomationAgentLaunchOnceResult,
  selected: SelectedCoordinatorWorkItem,
  results: Map<string, NexusAutomationAgentResultWorkItem>,
): void {
  results.set(workItemKey(selected), {
    componentId: selected.componentId,
    trackerId: selected.trackerId,
    id: selected.id,
    status: defaultWorkItemResultStatus(run.status),
    summary: run.summary,
  });
}

function recordExplicitCoordinatorResult(options: {
  result: NexusAutomationAgentResultWorkItem;
  selectedItems: SelectedCoordinatorWorkItem[];
  results: Map<string, NexusAutomationAgentResultWorkItem>;
  blockers: string[];
}): void {
  const matched = matchResultToSelectedWorkItem(
    options.result,
    options.selectedItems,
  );
  if (!matched) {
    options.blockers.push(
      reconciliationBlocker({
        componentId: options.result.componentId ?? null,
        trackerId: options.result.trackerId ?? null,
        trackerProvider: null,
        itemId: options.result.id,
        reason: "Coordinator result referenced an item that was not selected",
      }),
    );
    return;
  }

  const key = workItemKey(matched);
  if (options.results.has(key)) {
    options.blockers.push(
      reconciliationBlocker({
        componentId: matched.componentId,
        trackerId: matched.trackerId,
        trackerProvider: matched.trackerProvider,
        itemId: matched.id,
        reason: "Coordinator result reported the selected item more than once",
      }),
    );
    return;
  }

  options.results.set(key, {
    ...options.result,
    componentId: matched.componentId,
    trackerId: matched.trackerId,
  });
}

function appendMissingCoordinatorResultBlockers(
  selectedItems: SelectedCoordinatorWorkItem[],
  results: Map<string, NexusAutomationAgentResultWorkItem>,
  blockers: string[],
): void {
  for (const selected of selectedItems) {
    if (!results.has(workItemKey(selected))) {
      blockers.push(
        reconciliationBlocker({
          componentId: selected.componentId,
          trackerId: selected.trackerId,
          trackerProvider: selected.trackerProvider,
          itemId: selected.id,
          reason: "Coordinator result did not report a status for the selected item",
        }),
      );
    }
  }
}

async function reconcileSelectedWorkItem(options: {
  service: ReturnType<typeof createWorkItemService>;
  projectRoot: string;
  selected: SelectedCoordinatorWorkItem;
  result: NexusAutomationAgentResultWorkItem | null;
}): Promise<ReconciledCoordinatorWorkItem> {
  const selector = {
    projectRoot: options.projectRoot,
    componentId: options.selected.componentId,
    trackerId: options.selected.trackerId,
  };
  let current: WorkItem | null = null;
  let blocker: string | null = null;
  try {
    current = await options.service.getWorkItem({
      ...selector,
      id: options.selected.id,
      ...(options.selected.trackerProvider
        ? { provider: options.selected.trackerProvider }
        : {}),
    });
  } catch (error) {
    blocker = reconciliationBlocker({
      componentId: options.selected.componentId,
      trackerId: options.selected.trackerId,
      trackerProvider: options.selected.trackerProvider,
      itemId: options.selected.id,
      reason: `Tracker item could not be read: ${errorMessage(error)}`,
    });
  }

  const desiredStatus = desiredTrackerStatus(options.result?.status ?? null);
  const shouldUpdate =
    current &&
    desiredStatus &&
    current.status !== desiredStatus &&
    (current.status === "ready" || current.status === "in_progress");
  if (shouldUpdate) {
    try {
      current = await options.service.setStatus({
        ...selector,
        ref: workItemRef(options.selected),
        status: desiredStatus,
      });
    } catch (error) {
      blocker = reconciliationBlocker({
        componentId: options.selected.componentId,
        trackerId: options.selected.trackerId,
        trackerProvider: options.selected.trackerProvider,
        itemId: options.selected.id,
        reason:
          `Tracker status update to ${desiredStatus} failed: ${errorMessage(error)}`,
      });
    }
  }

  const resultStatus = options.result?.status ?? null;
  const cycleStatus = blocker
    ? "blocked"
    : cycleWorkItemStatusForResult(resultStatus);
  const note = blocker ?? resultNote(options.result);

  return {
    cycleItem: {
      componentId: options.selected.componentId,
      trackerId: options.selected.trackerId,
      trackerProvider: options.selected.trackerProvider,
      id: options.selected.id,
      logicalItemId: options.selected.logicalItemId ?? options.selected.id,
      title: current?.title ?? options.selected.title ?? null,
      status: current?.status ?? options.selected.status ?? null,
      cycleStatus,
      agentProfileId: options.selected.agentProfileId ?? null,
      notes: note,
    },
    workItem: current,
    blocker,
    note: blocker ? `managed-loop: reconciliation blocked ${blocker}` : null,
  };
}

function coordinatorWorkItemService(options: {
  projectRoot: string;
  status: NexusAutomationStatus;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  now?: () => Date | string;
}) {
  const componentById = new Map(
    options.status.components.map((component) => [component.id, component]),
  );
  const primaryComponent =
    options.status.components.find((component) => component.role === "primary") ??
    options.status.components[0] ??
    null;
  const resolveProject: WorkItemProjectResolver = async (selector) => {
    const component =
      componentById.get(selector.componentId ?? primaryComponent?.id ?? "") ??
      primaryComponent;
    if (!component?.workTracking) {
      throw new NexusAutomationCoordinatorLoopError(
        `Component ${selector.componentId ?? "primary"} work tracking is not configured`,
      );
    }

    return {
      homePath: options.projectRoot,
      projectRoot: options.projectRoot,
      projectId: options.status.projectConfig.id,
      projectName: options.status.projectConfig.name,
      componentId: component.id,
      componentName: component.name,
      sourceRoot: component.sourceRoot,
      defaultTrackerId: component.defaultTrackerId,
      workTrackers: component.workTrackers.map((tracker) => ({
        id: tracker.id,
        name: tracker.name,
        enabled: tracker.enabled,
        roles: tracker.roles,
        workTracking: tracker.workTracking,
      })),
      workTracking: component.workTracking,
    };
  };
  const providerFactory: WorkItemProviderFactory | undefined =
    options.providerFactory
      ? (context) => {
          const component =
            componentById.get(context.componentId ?? primaryComponent?.id ?? "") ??
            primaryComponent;
          if (!component) {
            throw new NexusAutomationCoordinatorLoopError(
              `Component ${context.componentId ?? "primary"} is not configured`,
            );
          }

          return options.providerFactory!({
            projectRoot: options.projectRoot,
            sourceRoot: component.sourceRoot,
            projectConfig: options.status.projectConfig,
            component,
            workTracking: context.workTracking,
          });
        }
      : undefined;

  return createWorkItemService({
    resolveProject,
    ...(providerFactory ? { providerFactory } : {}),
    providerOptions: options.providerOptions,
    now: options.now,
  });
}

function defaultWorkItemResultStatus(
  status: RunNexusAutomationAgentLaunchOnceResult["status"],
): NexusAutomationAgentResultWorkItemStatus {
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "skipped") {
    return "skipped";
  }

  return "completed";
}

function desiredTrackerStatus(
  status: NexusAutomationAgentResultWorkItemStatus | null,
): WorkStatus | null {
  if (status === "completed") {
    return "done";
  }
  if (status === "blocked") {
    return "blocked";
  }

  return null;
}

function cycleWorkItemStatusForResult(
  status: NexusAutomationAgentResultWorkItemStatus | null,
): NexusAutomationTargetCycleWorkItemStatus {
  if (status === "completed") {
    return "completed";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "skipped") {
    return "skipped";
  }

  return "selected";
}

function reconciledCycleStatus(options: {
  runStatus: RunNexusAutomationAgentLaunchOnceResult["status"];
  workItems: NexusAutomationTargetCycleWorkItemInput[];
  blockers: string[];
}): NexusAutomationTargetCycleStatus {
  if (options.workItems.some((item) => item.cycleStatus === "failed")) {
    return "failed";
  }
  if (
    options.blockers.length > 0 ||
    options.workItems.some((item) => item.cycleStatus === "blocked")
  ) {
    return "blocked";
  }

  return targetCycleStatusForRun(options.runStatus);
}

function matchResultToSelectedWorkItem(
  result: NexusAutomationAgentResultWorkItem,
  selectedItems: SelectedCoordinatorWorkItem[],
): SelectedCoordinatorWorkItem | null {
  const candidates = selectedItems.filter((item) => item.id === result.id);
  if (result.componentId) {
    return (
      candidates.find((item) => item.componentId === result.componentId) ?? null
    );
  }
  if (result.trackerId) {
    return candidates.find((item) => item.trackerId === result.trackerId) ?? null;
  }

  return candidates.length === 1 ? candidates[0]! : null;
}

function resultNote(
  result: NexusAutomationAgentResultWorkItem | null,
): string | null {
  return result?.notes ?? result?.summary ?? null;
}

function workItemRef(item: SelectedCoordinatorWorkItem): WorkItemRef {
  return {
    id: item.id,
    ...(item.trackerProvider ? { provider: item.trackerProvider } : {}),
  };
}

function reconciliationBlocker(options: {
  componentId: string | null;
  trackerId: string | null;
  trackerProvider: string | null;
  itemId: string;
  reason: string;
}): string {
  return `reconciliation_blocker ${JSON.stringify(options)}`;
}

function workItemKey(
  item: Pick<NexusAutomationTargetCycleWorkItemInput, "componentId" | "id">,
): string {
  return `${item.componentId ?? ""}:${item.id}`;
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
  workItems?: NexusAutomationTargetCycleWorkItemInput[];
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
  workItems: NexusAutomationTargetCycleWorkItemInput[];
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
      authority: options.status.authority,
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

function targetCycleWorkItems(
  status: NexusAutomationStatus,
): NexusAutomationTargetCycleWorkItemInput[] {
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
  const componentById = new Map(
    status.components.map((component) => [component.id, component]),
  );

  return grouped.flatMap((component) =>
    component.workItems.map((item: WorkItem) => {
      const resolvedComponent = componentById.get(component.componentId);
      return {
        componentId: component.componentId,
        trackerId:
          item.trackerRef?.trackerId ??
          resolvedComponent?.defaultTrackerId ??
          "default",
        trackerProvider:
          item.trackerRef?.provider ??
          resolvedComponent?.workTracking?.provider ??
          item.provider ??
          null,
        id: item.id,
        logicalItemId: item.externalRef?.itemId ?? item.id,
        title: item.title,
        status: item.status,
        cycleStatus: "eligible" as const,
      };
    }),
  );
}

function agentLaunchTargetCycleNotes(
  run: RunNexusAutomationAgentLaunchOnceResult,
): string[] {
  const claimNote = agentLaunchWorkItemClaimNote(run.workItemClaim);
  const appServer = run.launch?.codexAppServer;
  const notes = claimNote ? [claimNote] : [];
  if (!appServer) {
    return notes;
  }

  return [
    ...notes,
    boundedTargetCycleNote(
      [
        "agent-launch: provider=codex-app-server",
        `profile=${appServer.profileId}`,
        `status=${appServer.status}`,
        `thread=${appServer.threadId ?? "none"}`,
        `turn=${appServer.turnId ?? "none"}`,
        `persistence=${appServer.threadPersistence}`,
        `result=${appServer.resultFile}`,
      ].join(" "),
    ),
    ...(appServer.failureSummary
      ? [
          boundedTargetCycleNote(
            `agent-launch: failure=${appServer.failureSummary}`,
          ),
        ]
      : []),
  ];
}

function agentLaunchWorkItemClaimNote(
  claim: NexusAutomationAgentLaunchWorkItemClaim | null,
): string | null {
  if (!claim || claim.status === "disabled") {
    return null;
  }
  if (claim.status === "claimed") {
    return boundedTargetCycleNote(
      [
        "agent-launch: work-item-claim=claimed",
        `component=${claim.componentId ?? "none"}`,
        `tracker=${claim.trackerId ?? "none"}`,
        `item=${claim.workItemId ?? "none"}`,
        `host=${claim.owner?.hostId ?? "none"}`,
        `agent=${claim.owner?.agentId ?? "none"}`,
        `expires=${claim.owner?.expiresAt ?? "none"}`,
      ].join(" "),
    );
  }

  return boundedTargetCycleNote(
    [
      `agent-launch: work-item-claim=${claim.status}`,
      `reason=${claim.reason ?? "none"}`,
      `activeClaims=${claim.activeClaims.length}`,
      `staleClaims=${claim.staleClaims.length}`,
      `skippedCandidates=${claim.skippedCandidates.length}`,
    ].join(" "),
  );
}

function boundedTargetCycleNote(note: string): string {
  return note.length <= 1000 ? note : `${note.slice(0, 997)}...`;
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
  const normalized = trimHyphens(
    replaceRunsWithHyphen(
      value.trim().toLowerCase(),
      (character) => !isLowerAsciiIdentifierSegmentCharacter(character),
    ),
  );
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
