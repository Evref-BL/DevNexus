import path from "node:path";
import type { GitRunner } from "../worktrees/gitWorktreeService.js";
import {
  runNexusAutomationOnce,
  type NexusAutomationExecutor,
  type RunNexusAutomationOnceResult,
  type NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import {
  runNexusAutomationAgentLaunchOnce,
  type NexusAutomationAgentLauncher,
  type RunNexusAutomationAgentLaunchOnceResult,
} from "./nexusAutomationAgentLaunch.js";
import {
  getNexusAutomationStatus,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import type { NexusMcpRuntimeProcess } from "../project/nexusSetupAssistant.js";
import type { CreateWorkTrackerProviderOptions } from "../work-items/workTrackingProviderService.js";
import type { WorkTrackerProvider } from "../work-items/workTrackingTypes.js";
import {
  isAsciiIdentifierSegmentCharacter,
  replaceRunsWithHyphen,
  trimHyphens,
} from "../runtime/nexusTextNormalization.js";

export type NexusAutomationSchedulerAction = "ran" | "waited" | "stopped";
export type NexusAutomationSchedulerStopReason =
  | "disabled"
  | "max_runs"
  | "max_ticks"
  | "stopped";
export type NexusAutomationSchedulerRunResult =
  | RunNexusAutomationOnceResult
  | RunNexusAutomationAgentLaunchOnceResult;

export interface NexusAutomationSchedulerTick {
  index: number;
  startedAt: string;
  finishedAt: string;
  status: NexusAutomationStatus;
  action: NexusAutomationSchedulerAction;
  waitMs: number | null;
  run: NexusAutomationSchedulerRunResult | null;
}

export interface RunNexusAutomationSchedulerOptions {
  projectRoot: string;
  executor?: NexusAutomationExecutor;
  agentLauncher?: NexusAutomationAgentLauncher;
  owner?: string | null;
  baseRef?: string | null;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  mcpRuntimeProcesses?: readonly NexusMcpRuntimeProcess[] | false;
  now?: () => Date | string;
  sleep?: (ms: number) => Promise<void>;
  onTick?: (tick: NexusAutomationSchedulerTick) => void | Promise<void>;
  intervalMs?: number;
  maxTicks?: number;
  maxRuns?: number;
  runIdPrefix?: string;
  shouldStop?: () => boolean;
}

export interface RunNexusAutomationSchedulerResult {
  projectRoot: string;
  startedAt: string;
  finishedAt: string;
  ticks: NexusAutomationSchedulerTick[];
  runs: NexusAutomationSchedulerRunResult[];
  stoppedReason: NexusAutomationSchedulerStopReason;
}

export class NexusAutomationSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationSchedulerError";
  }
}

export async function runNexusAutomationScheduler(
  options: RunNexusAutomationSchedulerOptions,
): Promise<RunNexusAutomationSchedulerResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const intervalOverride = optionalPositiveInteger(options.intervalMs, "intervalMs");
  const maxTicks = optionalPositiveInteger(options.maxTicks, "maxTicks");
  const maxRuns = optionalPositiveInteger(options.maxRuns, "maxRuns");
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = currentIso(options.now);
  const ticks: NexusAutomationSchedulerTick[] = [];
  const runs: NexusAutomationSchedulerRunResult[] = [];
  let stoppedReason: NexusAutomationSchedulerStopReason = "stopped";

  while (true) {
    if (options.shouldStop?.()) {
      stoppedReason = "stopped";
      break;
    }

    const { tick, run, stopReason } = await runNexusAutomationSchedulerTick({
      options,
      projectRoot,
      intervalOverride,
      maxRuns,
      tickIndex: ticks.length + 1,
    });
    ticks.push(tick);
    if (run) {
      runs.push(run);
    }
    await options.onTick?.(tick);
    if (stopReason) {
      stoppedReason = stopReason;
      break;
    }

    const limitStopReason = schedulerLimitStopReason({
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

    await sleep(tick.waitMs ?? 0);
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

interface NexusAutomationSchedulerTickRun {
  tick: NexusAutomationSchedulerTick;
  run: NexusAutomationSchedulerRunResult | null;
  stopReason: NexusAutomationSchedulerStopReason | null;
}

async function runNexusAutomationSchedulerTick(options: {
  options: RunNexusAutomationSchedulerOptions;
  projectRoot: string;
  intervalOverride: number | undefined;
  maxRuns: number | undefined;
  tickIndex: number;
}): Promise<NexusAutomationSchedulerTickRun> {
  const tickStartedAt = currentIso(options.options.now);
  const status = await getNexusAutomationStatus({
    projectRoot: options.projectRoot,
    provider: options.options.provider,
    providerFactory: options.options.providerFactory,
    providerOptions: options.options.providerOptions,
    gitRunner: options.options.gitRunner,
    now: options.options.now,
  });
  const intervalMs = options.intervalOverride ?? status.automationConfig?.schedule.intervalMs;
  if (!status.automationConfig?.schedule.enabled || !intervalMs) {
    return {
      tick: schedulerTick({
        index: options.tickIndex,
        startedAt: tickStartedAt,
        finishedAt: currentIso(options.options.now),
        status,
        action: "stopped",
        waitMs: null,
        run: null,
      }),
      run: null,
      stopReason: "disabled",
    };
  }

  const run = status.status === "ready"
    ? await runReadyNexusAutomationSchedulerTick({
        options: options.options,
        projectRoot: options.projectRoot,
        status,
        tickIndex: options.tickIndex,
        tickStartedAt,
      })
    : null;
  const waitMs = schedulerTickWaitMs({
    status,
    intervalMs,
    tickStartedAt,
    run,
    maxRuns: options.maxRuns,
  });

  return {
    tick: schedulerTick({
      index: options.tickIndex,
      startedAt: tickStartedAt,
      finishedAt: currentIso(options.options.now),
      status,
      action: run ? "ran" : "waited",
      waitMs,
      run,
    }),
    run,
    stopReason: null,
  };
}

async function runReadyNexusAutomationSchedulerTick(options: {
  options: RunNexusAutomationSchedulerOptions;
  projectRoot: string;
  status: NexusAutomationStatus;
  tickIndex: number;
  tickStartedAt: string;
}): Promise<NexusAutomationSchedulerRunResult> {
  const runId = schedulerRunId(
    options.options.runIdPrefix,
    options.tickIndex,
    options.tickStartedAt,
  );
  if (options.status.automationConfig?.mode === "agent_launch") {
    return runNexusAutomationSchedulerAgentLaunch(options, runId);
  }
  return runNexusAutomationSchedulerOnce(options, runId);
}

function runNexusAutomationSchedulerAgentLaunch(
  options: {
    options: RunNexusAutomationSchedulerOptions;
    projectRoot: string;
  },
  runId: string,
): Promise<RunNexusAutomationAgentLaunchOnceResult> {
  if (!options.options.agentLauncher) {
    throw new NexusAutomationSchedulerError(
      "agentLauncher is required when automation.mode is agent_launch",
    );
  }
  return runNexusAutomationAgentLaunchOnce({
    projectRoot: options.projectRoot,
    provider: options.options.provider,
    providerFactory: options.options.providerFactory,
    providerOptions: options.options.providerOptions,
    gitRunner: options.options.gitRunner,
    mcpRuntimeProcesses: options.options.mcpRuntimeProcesses,
    now: options.options.now,
    owner: options.options.owner ?? "scheduler",
    runId,
    launcher: options.options.agentLauncher,
  });
}

function runNexusAutomationSchedulerOnce(
  options: {
    options: RunNexusAutomationSchedulerOptions;
    projectRoot: string;
  },
  runId: string,
): Promise<RunNexusAutomationOnceResult> {
  if (!options.options.executor) {
    throw new NexusAutomationSchedulerError(
      "executor is required when automation.mode is run_once",
    );
  }
  return runNexusAutomationOnce({
    projectRoot: options.projectRoot,
    provider: options.options.provider,
    providerFactory: options.options.providerFactory,
    providerOptions: options.options.providerOptions,
    gitRunner: options.options.gitRunner,
    now: options.options.now,
    owner: options.options.owner ?? "scheduler",
    baseRef: options.options.baseRef,
    runId,
    executor: options.options.executor,
  });
}

function schedulerTickWaitMs(options: {
  status: NexusAutomationStatus;
  intervalMs: number;
  tickStartedAt: string;
  run: NexusAutomationSchedulerRunResult | null;
  maxRuns: number | undefined;
}): number {
  if (
    options.run &&
    options.status.automationConfig?.mode === "agent_launch" &&
    options.status.automationConfig.agent.relaunch.whileEligible &&
    options.maxRuns !== undefined
  ) {
    return 0;
  }
  return options.run
    ? options.intervalMs
    : nextNexusAutomationSchedulerDelayMs(
        options.status,
        options.intervalMs,
        options.tickStartedAt,
      );
}

function schedulerLimitStopReason(options: {
  maxRuns: number | undefined;
  runCount: number;
  maxTicks: number | undefined;
  tickCount: number;
}): NexusAutomationSchedulerStopReason | null {
  if (options.maxRuns !== undefined && options.runCount >= options.maxRuns) {
    return "max_runs";
  }
  if (options.maxTicks !== undefined && options.tickCount >= options.maxTicks) {
    return "max_ticks";
  }
  return null;
}

export function nextNexusAutomationSchedulerDelayMs(
  status: NexusAutomationStatus,
  intervalMs: number,
  now: Date | string = new Date(),
): number {
  const normalizedInterval = optionalPositiveInteger(intervalMs, "intervalMs");
  if (normalizedInterval === undefined) {
    throw new NexusAutomationSchedulerError("intervalMs is required");
  }

  if (status.status === "backoff" && status.backoff?.retryAfter) {
    return delayUntil(status.backoff.retryAfter, now);
  }
  if (status.status === "locked" && status.lock?.expiresAt) {
    return delayUntil(status.lock.expiresAt, now);
  }

  return normalizedInterval;
}

function schedulerTick(tick: NexusAutomationSchedulerTick): NexusAutomationSchedulerTick {
  return tick;
}

function schedulerRunId(
  prefix: string | undefined,
  tickIndex: number,
  timestamp: string,
): string {
  return [
    safeRunIdPrefix(prefix ?? "scheduled"),
    timestamp.replaceAll("-", "").replaceAll(":", "").replace(".", "-"),
    tickIndex.toString(),
  ].join("-");
}

function safeRunIdPrefix(value: string): string {
  const normalized = trimHyphens(
    replaceRunsWithHyphen(
      value.trim(),
      (character) => !isAsciiIdentifierSegmentCharacter(character),
    ),
  );
  if (!normalized) {
    throw new NexusAutomationSchedulerError(
      "runIdPrefix must contain at least one safe character",
    );
  }

  return normalized;
}

function delayUntil(target: Date | string, now: Date | string): number {
  const targetDate = dateFrom(target, "target");
  const nowDate = dateFrom(now, "now");
  return Math.max(0, targetDate.getTime() - nowDate.getTime());
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  return dateFrom(value, "now").toISOString();
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationSchedulerError(`${name} must be a valid date`);
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
    throw new NexusAutomationSchedulerError(
      `${name} must be a positive integer`,
    );
  }

  return value;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationSchedulerError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
