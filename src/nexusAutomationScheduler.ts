import path from "node:path";
import type { GitRunner } from "./gitWorktreeService.js";
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
import type { NexusMcpRuntimeProcess } from "./nexusSetupAssistant.js";
import type { CreateWorkTrackerProviderOptions } from "./workTrackingProviderService.js";
import type { WorkTrackerProvider } from "./workTrackingTypes.js";
import {
  isAsciiIdentifierSegmentCharacter,
  replaceRunsWithHyphen,
  trimHyphens,
} from "./nexusTextNormalization.js";

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

    const tickStartedAt = currentIso(options.now);
    const status = await getNexusAutomationStatus({
      projectRoot,
      provider: options.provider,
      providerFactory: options.providerFactory,
      providerOptions: options.providerOptions,
      gitRunner: options.gitRunner,
      now: options.now,
    });
    const intervalMs = intervalOverride ?? status.automationConfig?.schedule.intervalMs;
    if (!status.automationConfig?.schedule.enabled || !intervalMs) {
      const tick = schedulerTick({
        index: ticks.length + 1,
        startedAt: tickStartedAt,
        finishedAt: currentIso(options.now),
        status,
        action: "stopped",
        waitMs: null,
        run: null,
      });
      ticks.push(tick);
      await options.onTick?.(tick);
      stoppedReason = "disabled";
      break;
    }

    let action: NexusAutomationSchedulerAction = "waited";
    let waitMs: number | null = nextNexusAutomationSchedulerDelayMs(
      status,
      intervalMs,
      tickStartedAt,
    );
    let run: NexusAutomationSchedulerRunResult | null = null;

    if (status.status === "ready") {
      const runId = schedulerRunId(
        options.runIdPrefix,
        ticks.length + 1,
        tickStartedAt,
      );
      if (status.automationConfig?.mode === "agent_launch") {
        if (!options.agentLauncher) {
          throw new NexusAutomationSchedulerError(
            "agentLauncher is required when automation.mode is agent_launch",
          );
        }
        run = await runNexusAutomationAgentLaunchOnce({
          projectRoot,
          provider: options.provider,
          providerFactory: options.providerFactory,
          providerOptions: options.providerOptions,
          gitRunner: options.gitRunner,
          mcpRuntimeProcesses: options.mcpRuntimeProcesses,
          now: options.now,
          owner: options.owner ?? "scheduler",
          runId,
          launcher: options.agentLauncher,
        });
        waitMs = status.automationConfig.agent.relaunch.whileEligible &&
          maxRuns !== undefined
          ? 0
          : intervalMs;
      } else {
        if (!options.executor) {
          throw new NexusAutomationSchedulerError(
            "executor is required when automation.mode is run_once",
          );
        }
        run = await runNexusAutomationOnce({
          projectRoot,
          provider: options.provider,
          providerFactory: options.providerFactory,
          providerOptions: options.providerOptions,
          gitRunner: options.gitRunner,
          now: options.now,
          owner: options.owner ?? "scheduler",
          baseRef: options.baseRef,
          runId,
          executor: options.executor,
        });
      }
      runs.push(run);
      action = "ran";
    }

    const tick = schedulerTick({
      index: ticks.length + 1,
      startedAt: tickStartedAt,
      finishedAt: currentIso(options.now),
      status,
      action,
      waitMs,
      run,
    });
    ticks.push(tick);
    await options.onTick?.(tick);

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

    await sleep(waitMs);
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
