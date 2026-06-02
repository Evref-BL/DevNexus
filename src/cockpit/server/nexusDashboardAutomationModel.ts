
import {
  readNexusAutomationRunLedger,
  type NexusAutomationRunRecord,
} from "../../automation/nexusAutomation.js";
import {
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleRecord,
} from "../../automation/nexusAutomationTargetCycle.js";
import type { NexusAutomationStatus } from "../../automation/nexusAutomationStatus.js";
import type { NexusAutomationTargetReport } from "../../automation/nexusAutomationTargetReport.js";
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import type { NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import type {
  NexusDashboardAuthoritySummary,
  NexusDashboardDataResult,
  NexusDashboardPublicationSummary,
} from "./nexusDashboardTypes.js";

export function summarizePublication(
  automationStatus: NexusAutomationStatus | null,
): NexusDashboardPublicationSummary[] {
  return (
    automationStatus?.publication.map((status) => ({
      componentId: status.componentId,
      strategy: status.policy.strategy,
      targetBranch: status.policy.targetBranch ?? null,
      remote: status.policy.remote ?? null,
      blocking: status.blocking,
      actorStatus: status.actor.status,
      authorityStatus: status.authority?.status ?? null,
      warnings: status.warnings,
    })) ?? []
  );
}

export function summarizeAuthority(
  authority: NexusAutomationStatus["authority"] | null,
): NexusDashboardAuthoritySummary | null {
  if (!authority) {
    return null;
  }
  return {
    summary: authority.summary,
    warningCount: authority.warnings.length,
    blockedActionCount: authority.components.reduce(
      (count, component) => count + component.blockedActions.length,
      0,
    ),
    waitingActionCount: authority.components.reduce(
      (count, component) => count + component.waitingActions.length,
      0,
    ),
    fallbackActionCount: authority.components.reduce(
      (count, component) => count + component.fallbackActions.length,
      0,
    ),
    components: authority.components.map((component) => ({
      componentId: component.componentId,
      actorStatus: component.actor.status,
      roles: component.roles,
      blockedActions: component.blockedActions,
      warnings: component.warnings,
    })),
  };
}

export function dashboardBlockers(options: {
  automation: NexusDashboardDataResult<NexusAutomationStatus>;
  eligibleWork: NexusDashboardDataResult<NexusEligibleWorkSummary>;
  targetReport: NexusDashboardDataResult<NexusAutomationTargetReport>;
}): string[] {
  const blockers = [
    ...(options.automation.ok ? [] : [`Automation status unavailable: ${options.automation.error?.message ?? "unknown error"}`]),
    ...(options.eligibleWork.ok ? [] : [`Eligible work unavailable: ${options.eligibleWork.error?.message ?? "unknown error"}`]),
    ...(options.targetReport.ok ? [] : [`Target report unavailable: ${options.targetReport.error?.message ?? "unknown error"}`]),
    ...(options.automation.value?.eligibleWorkBlockers ?? []),
    ...(options.eligibleWork.value?.blockers ?? []),
    ...(options.targetReport.value?.activeBlockers.map(activeBlockerText) ?? []),
    ...(options.targetReport.value?.blockers ?? []),
  ];
  return [...new Set(blockers)].slice(0, 20);
}

function activeBlockerText(
  blocker: NexusAutomationTargetReport["activeBlockers"][number],
): string {
  const work = [blocker.workItemTitle, blocker.workItemId].filter(Boolean).join(" ");
  const source = [blocker.componentId, blocker.trackerProvider, blocker.trackerId]
    .filter(Boolean)
    .join(" · ");
  return [work || blocker.source, blocker.message, source].filter(Boolean).join(" · ");
}

export function cycleActionText(cycle: NexusAutomationTargetCycleRecord): string {
  return [
    cycle.id,
    cycle.summary,
    ...cycle.notes,
    ...cycle.blockers,
    ...cycle.workItems.flatMap((item) => [
      item.componentId,
      item.id,
      item.title,
      item.notes,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

export function readTargetCycles(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusAutomationTargetCycleRecord[] {
  if (!projectConfig.automation) {
    return [];
  }
  try {
    return readNexusAutomationTargetCycleLedger(
      projectRoot,
      projectConfig.automation,
    ).cycles;
  } catch {
    return [];
  }
}

export function readRuns(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusAutomationRunRecord[] {
  if (!projectConfig.automation) {
    return [];
  }
  try {
    return readNexusAutomationRunLedger(projectRoot, projectConfig.automation).runs;
  } catch {
    return [];
  }
}

export function eligibleWorkItems(
  summary: NexusEligibleWorkSummary | null,
): Array<NexusEligibleWorkSummary["components"][number]["workItems"][number]> {
  return summary?.components.flatMap((component) => component.workItems) ?? [];
}
