
import type { NexusAutomationStatus } from "../../automation/nexusAutomationStatus.js";
import type { NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import type {
  NexusDashboardComponentSummary,
  NexusDashboardPluginSummary,
  NexusDashboardSignal,
  NexusDashboardSignalTone,
  NexusDashboardThreadSummary,
} from "./nexusDashboardTypes.js";
import { compactDetail, plural } from "./nexusDashboardModelUtils.js";

export function dashboardSignals(
  components: NexusDashboardComponentSummary[],
  automation: NexusAutomationStatus | null,
  eligibleWork: NexusEligibleWorkSummary | null,
  threads: NexusDashboardThreadSummary,
  plugins: NexusDashboardPluginSummary,
  blockers: string[],
): NexusDashboardSignal[] {
  return [
    {
      id: "components",
      label: "Components",
      value: String(components.length),
      tone: components.every((component) => component.sourceRootExists) ? "good" : "danger",
      detail: "Ready",
    },
    {
      id: "automation",
      label: "Automation",
      value: automation?.status ?? "unknown",
      tone: automationTone(automation?.status),
      detail: automationDetail(automation),
    },
    {
      id: "eligible-work",
      label: "Eligible Work",
      value: String(eligibleWork?.eligibleWorkItemCount ?? 0),
      tone: eligibleWork && eligibleWork.eligibleWorkItemCount > 0 ? "active" : "neutral",
      detail: eligibleWork?.eligibleWorkItemCount
        ? `${eligibleWork.eligibleWorkItemCount} ready`
        : "No ready items",
    },
    {
      id: "worktrees",
      label: "Threads",
      value: String(threads.totalCount),
      tone: threads.needsDecisionCount > 0
        ? "warn"
        : threads.activeCount > 0
          ? "active"
          : "neutral",
      detail: threadSignalDetail(threads),
    },
    {
      id: "blockers",
      label: "Blockers",
      value: String(blockers.length),
      tone: blockers.length > 0 ? "warn" : "good",
      detail: blockers.length > 0 ? "Needs attention" : "Clear",
    },
    {
      id: "plugins",
      label: "Plugins",
      value: String(plugins.enabledCount),
      tone: plugins.enabledCount > 0 ? "active" : "neutral",
      detail: plugins.capabilityCount > 0
        ? `${plugins.capabilityCount} ${plural(plugins.capabilityCount, "capability", "capabilities")}`
        : "No plugins",
    },
  ];
}

function threadSignalDetail(threads: NexusDashboardThreadSummary): string {
  if (threads.needsDecisionCount > 0) {
    return `${threads.needsDecisionCount} ${plural(threads.needsDecisionCount, "thread", "threads")} ${threads.needsDecisionCount === 1 ? "needs" : "need"} action`;
  }
  if (threads.forgetCandidateCount > 0) {
    return `${threads.forgetCandidateCount} ready to forget`;
  }
  if (threads.activeCount > 0) {
    return `${threads.activeCount} active`;
  }
  return "No open threads";
}

function automationDetail(automation: NexusAutomationStatus | null): string {
  if (!automation) {
    return "Status unavailable";
  }
  if (automation.status === "blocked" && /github|token|credential|auth/iu.test(automation.summary)) {
    return "GitHub auth blocked";
  }
  return compactDetail(automation.summary);
}

export function dashboardSummary(
  components: NexusDashboardComponentSummary[],
  automation: NexusAutomationStatus | null,
  eligibleWork: NexusEligibleWorkSummary | null,
  threads: NexusDashboardThreadSummary,
  blockers: string[],
): string {
  const readyCount = eligibleWork?.eligibleWorkItemCount ?? 0;
  return [
    `${components.length} ${plural(components.length, "component", "components")}`,
    readyCount > 0 ? `${readyCount} ready ${plural(readyCount, "item", "items")}` : "no ready items",
    `${threads.totalCount} ${plural(threads.totalCount, "thread", "threads")}`,
    threads.needsDecisionCount > 0
      ? `${threads.needsDecisionCount} ${plural(threads.needsDecisionCount, "thread", "threads")} ${threads.needsDecisionCount === 1 ? "needs" : "need"} action`
      : "threads current",
    blockers.length > 0 ? `${blockers.length} ${plural(blockers.length, "blocker", "blockers")}` : "no blockers",
    automation ? `automation ${automation.status}` : "automation unknown",
  ].join(", ");
}

function automationTone(status: string | undefined): NexusDashboardSignalTone {
  switch (status) {
    case "ready":
      return "good";
    case "locked":
    case "idle":
      return "active";
    case "blocked":
    case "backoff":
      return "warn";
    case "disabled":
      return "neutral";
    default:
      return "danger";
  }
}
