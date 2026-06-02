
import type { NexusDashboardGitHistorySummary } from "./nexusDashboardGitHistory.js";
import type {
  NexusDashboardComponentSummary,
  NexusDashboardDataResult,
  NexusDashboardPluginSummary,
  NexusDashboardProjectSummary,
  NexusDashboardSignal,
  NexusDashboardThreadSummary,
  NexusDashboardTrackedWorkSummary,
  NexusDashboardWeave,
  NexusDashboardWeaveNode,
  NexusDashboardWorktreeSummary,
} from "./nexusDashboardTypes.js";

export function pendingDashboardResult<T>(
  message: string,
): NexusDashboardDataResult<T> {
  return {
    ok: false,
    value: null,
    error: {
      name: "Pending",
      message,
    },
  };
}

export function emptyWorktreeSummary(): NexusDashboardWorktreeSummary {
  return {
    activeCount: 0,
    staleCount: 0,
    warnings: [],
    records: [],
  };
}

export function emptyThreadSummary(): NexusDashboardThreadSummary {
  return {
    totalCount: 0,
    activeCount: 0,
    needsDecisionCount: 0,
    archiveCandidateCount: 0,
    forgetCandidateCount: 0,
    source: "local",
    incomplete: true,
    detail: null,
    records: [],
  };
}

export function emptyTrackedWorkSummary(): NexusDashboardTrackedWorkSummary {
  return {
    totalCount: 0,
    blockedCount: 0,
    readyCount: 0,
    importCandidateCount: 0,
    staleCount: 0,
    excludedCount: 0,
    records: [],
  };
}

export function emptyGitHistorySummary(): NexusDashboardGitHistorySummary {
  return {
    totalCommitCount: 0,
    repositories: [],
    incomplete: true,
    detail: "Git history is loading.",
  };
}

export function dashboardShellSignals(
  components: NexusDashboardComponentSummary[],
  plugins: NexusDashboardPluginSummary,
): NexusDashboardSignal[] {
  return [
    {
      id: "components",
      label: "Components",
      value: String(components.length),
      tone: "good",
      detail: "Component list loaded.",
    },
    {
      id: "automation",
      label: "Automation",
      value: "...",
      tone: "neutral",
      detail: "Loading automation status.",
    },
    {
      id: "eligible-work",
      label: "Tracked work",
      value: "...",
      tone: "neutral",
      detail: "Loading issues and work items.",
    },
    {
      id: "worktrees",
      label: "Threads",
      value: "...",
      tone: "neutral",
      detail: "Loading active thread state.",
    },
    {
      id: "blockers",
      label: "Blockers",
      value: "...",
      tone: "neutral",
      detail: "Loading approvals and blockers.",
    },
    {
      id: "plugins",
      label: "Plugins",
      value: String(plugins.enabledCount),
      tone: "neutral",
      detail: "Configured plugins loaded; local candidates are still loading.",
    },
  ];
}

export function workspaceShellWeave(
  generatedAt: string,
  project: NexusDashboardProjectSummary,
  components: NexusDashboardComponentSummary[],
): NexusDashboardWeave {
  const projectNode: NexusDashboardWeaveNode = {
    id: "project",
    kind: "project",
    laneId: "project",
    label: project.name,
    detail: project.root,
    status: "loading",
    timestamp: generatedAt,
    href: project.remoteUrl,
    actions: [],
  };
  const componentNodes = components.map((component) => ({
    id: `component:${component.id}`,
    kind: "component" as const,
    laneId: "components",
    label: component.name,
    detail: `${component.role} component`,
    status: component.sourceRootExists ? "loading" : "missing",
    timestamp: generatedAt,
    href: component.remoteUrl,
    actions: [],
  }));
  return {
    version: 1,
    generatedAt,
    lanes: [
      {
        id: "project",
        label: "Workspace",
        nodeIds: ["project"],
      },
      {
        id: "components",
        label: "Components",
        nodeIds: componentNodes.map((node) => node.id),
      },
    ],
    nodes: [projectNode, ...componentNodes],
    edges: componentNodes.map((node) => ({
      id: `project-${node.id}`,
      kind: "contains",
      from: "project",
      to: node.id,
      label: "contains",
    })),
  };
}
