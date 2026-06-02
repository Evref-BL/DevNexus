
import type { NexusAutomationRunRecord } from "../../automation/nexusAutomation.js";
import type { NexusAutomationTargetCycleRecord } from "../../automation/nexusAutomationTargetCycle.js";
import type { NexusAutomationStatus } from "../../automation/nexusAutomationStatus.js";
import type { NexusAutomationTargetReport } from "../../automation/nexusAutomationTargetReport.js";
import type { NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import {
  firstActionHref,
  providerActionsForHref,
  providerActionsFromText,
} from "./nexusDashboardProviderActions.js";
import type { NexusDashboardProviderUrls } from "./nexusDashboardProviderActions.js";
import type { NexusDashboardEvent, NexusDashboardWorktreeSummary } from "./nexusDashboardTypes.js";
import { cycleActionText } from "./nexusDashboardAutomationModel.js";
import { compactDetail, nodeId, plural } from "./nexusDashboardModelUtils.js";

export function buildDashboardEvents(options: {
  generatedAt: string;
  automation: NexusAutomationStatus | null;
  eligibleWork: NexusEligibleWorkSummary | null;
  targetReport: NexusAutomationTargetReport | null;
  worktrees: NexusDashboardWorktreeSummary;
  cycles: NexusAutomationTargetCycleRecord[];
  runs: NexusAutomationRunRecord[];
  blockers: string[];
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardEvent[] {
  const events: NexusDashboardEvent[] = [
    {
      id: "snapshot-generated",
      time: options.generatedAt,
      source: "actual",
      severity: "info",
      title: "Snapshot refreshed",
      body: "Read local DevNexus state.",
      relatedNodeIds: ["project"],
      href: options.providerUrls.project,
      actions: providerActionsForHref(options.providerUrls.project, "Open repository"),
    },
  ];

  if (options.automation) {
    const actions = providerActionsFromText(options.automation.summary, options.providerUrls);
    events.push({
      id: "automation-status",
      time: options.generatedAt,
      source: "actual",
      severity: options.automation.status === "blocked" ? "warning" : "info",
      title: `Automation ${options.automation.status}`,
      body: compactDetail(options.automation.summary),
      relatedNodeIds: ["project"],
      href: firstActionHref(actions),
      actions,
    });
  }

  if (options.eligibleWork) {
    const actions = providerActionsFromText(options.eligibleWork.summary, options.providerUrls);
    events.push({
      id: "eligible-work",
      time: options.generatedAt,
      source: "actual",
      severity: options.eligibleWork.eligibleWorkItemCount > 0 ? "success" : "info",
      title: `${options.eligibleWork.eligibleWorkItemCount} ready ${plural(options.eligibleWork.eligibleWorkItemCount, "item", "items")}`,
      body: compactDetail(options.eligibleWork.summary),
      relatedNodeIds: ["project"],
      href: firstActionHref(actions),
      actions,
    });
  }

  for (const cycle of options.cycles.slice(-8).reverse()) {
    const actions = providerActionsFromText(cycleActionText(cycle), options.providerUrls);
    events.push({
      id: `target-cycle-${cycle.id}`,
      time: cycle.finishedAt ?? cycle.startedAt,
      source: "actual",
      severity: cycle.status === "blocked" || cycle.status === "failed" ? "warning" : "info",
      title: `Target cycle ${cycle.status}`,
      body: cycle.summary ?? cycle.id,
      relatedNodeIds: [nodeId("target-cycle", cycle.id)],
      href: firstActionHref(actions),
      actions,
    });
  }

  for (const run of options.runs.slice(-5).reverse()) {
    const actions = providerActionsFromText(`${run.summary ?? ""} ${run.error ?? ""} ${run.workItemId ?? ""} ${run.branchName ?? ""}`, options.providerUrls, run.componentId);
    events.push({
      id: `run-${run.id}`,
      time: run.finishedAt ?? run.startedAt,
      source: "actual",
      severity: run.status === "failed" || run.status === "blocked" ? "warning" : "info",
      title: `Run ${run.status}`,
      body: run.summary ?? run.id,
      relatedNodeIds: [nodeId("run", run.id)],
      href: firstActionHref(actions),
      actions,
    });
  }

  for (const worktree of options.worktrees.records.slice(0, 8)) {
    const actions = providerActionsFromText(`${worktree.workItemId ?? ""} ${worktree.branchName ?? worktree.id}`, options.providerUrls, worktree.componentId);
    events.push({
      id: `worktree-${worktree.id}`,
      time: worktree.updatedAt,
      source: "actual",
      severity: worktree.stale ? "warning" : "info",
      title: `Worktree ${worktree.effectiveStatus}`,
      body: `${worktree.branchName ?? worktree.id} on ${worktree.hostId}`,
      relatedNodeIds: [nodeId("worktree", worktree.id)],
      href: firstActionHref(actions),
      actions,
    });
  }

  options.blockers.slice(0, 8).forEach((blocker, index) => {
    const actions = providerActionsFromText(blocker, options.providerUrls);
    events.push({
      id: `blocker-${index}`,
      time: options.generatedAt,
      source: "warning",
      severity: "warning",
      title: "Active blocker",
      body: compactDetail(blocker),
      relatedNodeIds: [nodeId("blocker", String(index))],
      href: firstActionHref(actions),
      actions,
    });
  });

  return events;
}
