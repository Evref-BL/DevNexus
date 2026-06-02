
import type { NexusAutomationRunRecord } from "../../automation/nexusAutomation.js";
import type { NexusAutomationTargetCycleRecord } from "../../automation/nexusAutomationTargetCycle.js";
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import type { NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import {
  authorityProviderActions,
  componentProviderUrl,
  firstActionHref,
  providerActionsForHref,
  providerActionsFromText,
  uniqueProviderActions,
} from "./nexusDashboardProviderActions.js";
import type { NexusDashboardProviderUrls } from "./nexusDashboardProviderActions.js";
import type {
  NexusDashboardAuthoritySummary,
  NexusDashboardComponentSummary,
  NexusDashboardWeave,
  NexusDashboardWeaveEdge,
  NexusDashboardWeaveLane,
  NexusDashboardWeaveNode,
  NexusDashboardWorktreeSummary,
} from "./nexusDashboardTypes.js";
import { cycleActionText, eligibleWorkItems } from "./nexusDashboardAutomationModel.js";
import { edgeId, nodeId, plural } from "./nexusDashboardModelUtils.js";

export function buildNexusDashboardWeave(options: {
  generatedAt: string;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: NexusDashboardComponentSummary[];
  eligibleWork: NexusEligibleWorkSummary | null;
  worktrees: NexusDashboardWorktreeSummary;
  cycles: NexusAutomationTargetCycleRecord[];
  runs: NexusAutomationRunRecord[];
  authority: NexusDashboardAuthoritySummary | null;
  blockers: string[];
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardWeave {
  const lanes: NexusDashboardWeaveLane[] = [
    { id: "project", label: "Project", nodeIds: [] },
    { id: "components", label: "Components", nodeIds: [] },
    { id: "work", label: "Work", nodeIds: [] },
    { id: "branches", label: "Branches", nodeIds: [] },
    { id: "cycles", label: "Cycles", nodeIds: [] },
    { id: "authority", label: "Approvals", nodeIds: [] },
  ];
  const nodes: NexusDashboardWeaveNode[] = [];
  const edges: NexusDashboardWeaveEdge[] = [];
  const addNode = (node: NexusDashboardWeaveNode): void => {
    if (nodes.some((candidate) => candidate.id === node.id)) {
      return;
    }
    nodes.push(node);
    const lane = lanes.find((candidate) => candidate.id === node.laneId);
    lane?.nodeIds.push(node.id);
  };
  const addEdge = (edge: NexusDashboardWeaveEdge): void => {
    if (!edges.some((candidate) => candidate.id === edge.id)) {
      edges.push(edge);
    }
  };
  const projectNodeId = "project";

  addNode({
    id: projectNodeId,
    kind: "project",
    laneId: "project",
    label: options.projectConfig.name,
    detail: options.projectRoot,
    status: "active",
    timestamp: null,
    href: options.providerUrls.project,
    actions: providerActionsForHref(options.providerUrls.project, "Open repository"),
  });

  for (const component of options.components) {
    const componentNodeId = nodeId("component", component.id);
    const repositoryUrl = componentProviderUrl(options.providerUrls, component.id);
    addNode({
      id: componentNodeId,
      kind: "component",
      laneId: "components",
      label: component.name,
      detail: `${component.role} component`,
      status: component.sourceRootExists ? "ready" : "missing",
      timestamp: null,
      href: repositoryUrl,
      actions: providerActionsForHref(repositoryUrl, "Open repository"),
    });
    addEdge({
      id: edgeId(projectNodeId, componentNodeId, "contains"),
      kind: "contains",
      from: projectNodeId,
      to: componentNodeId,
      label: "contains",
    });

    if (component.defaultTrackerId) {
      const trackerNodeId = nodeId("tracker", `${component.id}-${component.defaultTrackerId}`);
      addNode({
        id: trackerNodeId,
        kind: "tracker",
        laneId: "work",
        label: component.defaultTrackerId,
        detail: component.trackerProviders.join(", ") || "tracker",
        status: "configured",
        timestamp: null,
        href: null,
        actions: [],
      });
      addEdge({
        id: edgeId(componentNodeId, trackerNodeId, "tracks"),
        kind: "tracks",
        from: componentNodeId,
        to: trackerNodeId,
        label: "tracks",
      });
    }

    if (component.git?.headCommit) {
      const branchNodeId = nodeId("branch", `${component.id}-${component.git.branch ?? "detached"}`);
      const commitNodeId = nodeId("commit", `${component.id}-${component.git.headCommit.slice(0, 12)}`);
      addNode({
        id: branchNodeId,
        kind: "branch",
        laneId: "branches",
        label: component.git.branch ?? "detached",
        detail: component.git.upstream ?? "no upstream",
        status: component.git.dirty ? "dirty" : "clean",
        timestamp: null,
        href: null,
        actions: providerActionsFromText(component.git.branch ?? "", options.providerUrls, component.id),
      });
      addNode({
        id: commitNodeId,
        kind: "commit",
        laneId: "branches",
        label: component.git.headCommit.slice(0, 12),
        detail: component.sourceRoot,
        status: "head",
        timestamp: null,
        href: null,
        actions: [],
      });
      addEdge({
        id: edgeId(componentNodeId, branchNodeId, "owns"),
        kind: "owns",
        from: componentNodeId,
        to: branchNodeId,
        label: "branch",
      });
      addEdge({
        id: edgeId(branchNodeId, commitNodeId, "points-to"),
        kind: "points-to",
        from: branchNodeId,
        to: commitNodeId,
        label: "HEAD",
      });
    }
  }

  for (const item of eligibleWorkItems(options.eligibleWork)) {
    const workItemNodeId = nodeId("work-item", `${item.componentId}-${item.id}`);
    const actions = uniqueProviderActions([
      ...providerActionsForHref(item.webUrl),
      ...providerActionsFromText(`${item.id} ${item.title}`, options.providerUrls, item.componentId),
    ]);
    addNode({
      id: workItemNodeId,
      kind: "work-item",
      laneId: "work",
      label: item.title,
      detail: item.id,
      status: item.status,
      timestamp: item.updatedAt,
      href: item.webUrl ?? firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(nodeId("component", item.componentId), workItemNodeId, "owns"),
      kind: "owns",
      from: nodeId("component", item.componentId),
      to: workItemNodeId,
      label: "owns",
    });
  }

  for (const worktree of options.worktrees.records) {
    const worktreeNodeId = nodeId("worktree", worktree.id);
    const actions = providerActionsFromText(
      `${worktree.workItemId ?? ""} ${worktree.branchName ?? worktree.id}`,
      options.providerUrls,
      worktree.componentId,
    );
    addNode({
      id: worktreeNodeId,
      kind: "worktree",
      laneId: "branches",
      label: worktree.branchName ?? worktree.id,
      detail: `${worktree.effectiveStatus} on ${worktree.hostId}`,
      status: worktree.effectiveStatus,
      timestamp: worktree.updatedAt,
      href: firstActionHref(actions),
      actions,
    });
    if (worktree.componentId) {
      addEdge({
        id: edgeId(nodeId("component", worktree.componentId), worktreeNodeId, "checks-out"),
        kind: "checks-out",
        from: nodeId("component", worktree.componentId),
        to: worktreeNodeId,
        label: "worktree",
      });
    }
    if (worktree.workItemId && worktree.componentId) {
      addEdge({
        id: edgeId(nodeId("work-item", `${worktree.componentId}-${worktree.workItemId}`), worktreeNodeId, "selected"),
        kind: "selected",
        from: nodeId("work-item", `${worktree.componentId}-${worktree.workItemId}`),
        to: worktreeNodeId,
        label: "selected",
      });
    }
  }

  for (const cycle of options.cycles.slice(-8)) {
    const cycleNodeId = nodeId("target-cycle", cycle.id);
    const actions = providerActionsFromText(cycleActionText(cycle), options.providerUrls);
    addNode({
      id: cycleNodeId,
      kind: "target-cycle",
      laneId: "cycles",
      label: cycle.id,
      detail: cycle.summary ?? cycle.status,
      status: cycle.status,
      timestamp: cycle.finishedAt ?? cycle.startedAt,
      href: firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(projectNodeId, cycleNodeId, "records"),
      kind: "records",
      from: projectNodeId,
      to: cycleNodeId,
      label: "cycle",
    });
    for (const item of cycle.workItems.slice(0, 8)) {
      const workItemNodeId = nodeId("work-item", `${item.componentId}-${item.id}`);
      const cycleStatus = item.cycleStatus ?? "referenced";
      const actions = providerActionsFromText(
        `${item.id} ${item.title ?? ""}`,
        options.providerUrls,
        item.componentId,
      );
      addNode({
        id: workItemNodeId,
        kind: "work-item",
        laneId: "work",
        label: item.title ?? item.id,
        detail: item.id,
        status: cycleStatus,
        timestamp: cycle.finishedAt ?? cycle.startedAt,
        href: firstActionHref(actions),
        actions,
      });
      addEdge({
        id: edgeId(cycleNodeId, workItemNodeId, "selected"),
        kind: "selected",
        from: cycleNodeId,
        to: workItemNodeId,
        label: cycleStatus,
      });
    }
  }

  for (const run of options.runs.slice(-6)) {
    const runNodeId = nodeId("run", run.id);
    const actions = providerActionsFromText(
      `${run.summary ?? ""} ${run.error ?? ""} ${run.workItemId ?? ""} ${run.branchName ?? ""}`,
      options.providerUrls,
      run.componentId,
    );
    addNode({
      id: runNodeId,
      kind: "run",
      laneId: "cycles",
      label: run.id,
      detail: run.summary ?? run.status,
      status: run.status,
      timestamp: run.finishedAt ?? run.startedAt,
      href: firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(projectNodeId, runNodeId, "records"),
      kind: "records",
      from: projectNodeId,
      to: runNodeId,
      label: "run",
    });
  }

  if (options.authority) {
    const authorityNodeId = "authority";
    addNode({
      id: authorityNodeId,
      kind: "authority",
      laneId: "authority",
      label: "Approval",
      detail: authorityDashboardSummary(options.authority),
      status: options.authority.blockedActionCount > 0 ? "blocked" : "ready",
      timestamp: null,
      href: null,
      actions: authorityProviderActions(options.authority, options.providerUrls),
    });
    addEdge({
      id: edgeId(projectNodeId, authorityNodeId, "published-by"),
      kind: "published-by",
      from: projectNodeId,
      to: authorityNodeId,
      label: "policy",
    });
  }

  options.blockers.slice(0, 8).forEach((blocker, index) => {
    const blockerNodeId = nodeId("blocker", String(index));
    const actions = providerActionsFromText(blocker, options.providerUrls);
    addNode({
      id: blockerNodeId,
      kind: "blocker",
      laneId: "authority",
      label: "Blocker",
      detail: blocker,
      status: "blocked",
      timestamp: null,
      href: firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(projectNodeId, blockerNodeId, "blocked-by"),
      kind: "blocked-by",
      from: projectNodeId,
      to: blockerNodeId,
      label: "blocked",
    });
  });

  return {
    version: 1,
    generatedAt: options.generatedAt,
    lanes,
    nodes,
    edges,
  };
}

function authorityDashboardSummary(authority: NexusDashboardAuthoritySummary): string {
  const componentCount = authority.components.length;
  const blocked = authority.blockedActionCount;
  const fallbacks = authority.fallbackActionCount;
  if (blocked > 0) {
    return `${blocked} provider ${plural(blocked, "action", "actions")} need approval. Review or open the provider item manually.`;
  }
  if (fallbacks > 0) {
    return `${fallbacks} provider ${plural(fallbacks, "action", "actions")} need an approval path.`;
  }
  return `Publication permissions are ready for ${componentCount} ${plural(componentCount, "component", "components")}.`;
}
