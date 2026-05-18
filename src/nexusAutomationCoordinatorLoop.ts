import path from "node:path";
import type { GitRunner } from "./gitWorktreeService.js";
import {
  eligibleNexusAutomationWorkItems,
} from "./nexusAutomation.js";
import {
  runNexusAutomationAgentLaunchOnce,
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
import type {
  NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import type { CreateWorkTrackerProviderOptions } from "./workTrackingProviderService.js";
import {
  createWorkItemService,
  type WorkItemProviderFactory,
  type WorkItemProjectResolver,
} from "./workItemService.js";
import type {
  WorkItem,
  WorkItemRef,
  WorkStatus,
} from "./workTrackingTypes.js";

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
      const finalization = await finalizeCoordinatorRun({
        projectRoot,
        initialStatus: status,
        run,
        finishedAt,
        providerFactory: options.providerFactory,
        providerOptions: options.providerOptions,
        gitRunner: options.gitRunner,
        now: options.now,
      });
      const targetCycle = recordCoordinatorLoopCycle({
        projectRoot,
        status: finalization.status,
        targetReport,
        cycleId,
        runId,
        cycleStatus: finalization.cycleStatus,
        startedAt: tickStartedAt,
        finishedAt,
        summary: run.summary,
        eligibleWorkItemCount: finalization.eligibleWorkItemCount,
        workItems: finalization.workItems,
        blockers: finalization.blockers,
        notes: [
          "managed-loop: decision=launch",
          "managed-loop: coordinator launched",
          `managed-loop: coordinator ${run.status}`,
          ...finalization.notes,
          ...agentLaunchTargetCycleNotes(run),
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
  const selectedItems = selectedCoordinatorWorkItems(options.initialStatus);
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
): SelectedCoordinatorWorkItem[] {
  return targetCycleWorkItems(status).map((item) => ({
    ...item,
    componentId: item.componentId ?? primaryComponentId(status),
    trackerId: item.trackerId ?? "default",
    trackerProvider: item.trackerProvider ?? null,
  }));
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
    if (selectedItems.length === 1) {
      const selected = selectedItems[0]!;
      results.set(workItemKey(selected), {
        componentId: selected.componentId,
        trackerId: selected.trackerId,
        id: selected.id,
        status: defaultWorkItemResultStatus(run.status),
        summary: run.summary,
      });
    } else if (selectedItems.length > 1 && run.status !== "completed") {
      for (const selected of selectedItems) {
        results.set(workItemKey(selected), {
          componentId: selected.componentId,
          trackerId: selected.trackerId,
          id: selected.id,
          status: defaultWorkItemResultStatus(run.status),
          summary: run.summary,
        });
      }
    } else if (selectedItems.length > 1) {
      blockers.push(
        "Coordinator result contract is missing workItems for a multi-item completed run",
      );
    }

    return { results, blockers };
  }

  for (const result of explicitResults) {
    const matched = matchResultToSelectedWorkItem(result, selectedItems);
    if (!matched) {
      blockers.push(
        reconciliationBlocker({
          componentId: result.componentId ?? null,
          trackerId: result.trackerId ?? null,
          trackerProvider: null,
          itemId: result.id,
          reason: "Coordinator result referenced an item that was not selected",
        }),
      );
      continue;
    }

    const key = workItemKey(matched);
    if (results.has(key)) {
      blockers.push(
        reconciliationBlocker({
          componentId: matched.componentId,
          trackerId: matched.trackerId,
          trackerProvider: matched.trackerProvider,
          itemId: matched.id,
          reason: "Coordinator result reported the selected item more than once",
        }),
      );
      continue;
    }

    results.set(key, {
      ...result,
      componentId: matched.componentId,
      trackerId: matched.trackerId,
    });
  }

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

  return { results, blockers };
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
  const appServer = run.launch?.codexAppServer;
  if (!appServer) {
    return [];
  }

  return [
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
