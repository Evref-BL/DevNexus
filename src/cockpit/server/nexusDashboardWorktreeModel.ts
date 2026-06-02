
import path from "node:path";
import { projectWorktreesRootPath, type NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import type {
  NexusWorktreeLeaseCollection,
  NexusWorktreeLeaseSummary,
} from "../../worktrees/nexusWorktreeLease.js";
import type {
  NexusDashboardComponentSummary,
  NexusDashboardWorktreeSummary,
} from "./nexusDashboardTypes.js";

export function summarizeWorktrees(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
  collection: NexusWorktreeLeaseCollection | null,
): NexusDashboardWorktreeSummary {
  return {
    activeCount: collection?.activeCount ?? 0,
    staleCount: collection?.staleCount ?? 0,
    warnings: collection?.warnings ?? [],
    records:
      collection?.records.map((record) => ({
        id: record.id,
        componentId:
          record.scope.kind === "component" ? record.scope.componentId : null,
        workItemId: record.workItemId,
        status: record.status,
        effectiveStatus: record.effectiveStatus,
        branchName: record.branchName,
        worktreePath: dashboardLeaseWorktreePath(
          projectRoot,
          projectConfig,
          components,
          record,
        ),
        hostId: record.hostId,
        agentId: record.agentId,
        stale: record.stale,
        dirty: record.dirty,
        pushed: record.pushed,
        updatedAt: record.updatedAt,
        writeScope: record.writeScope,
      })) ?? [],
  };
}

function dashboardLeaseWorktreePath(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
  lease: NexusWorktreeLeaseSummary,
): string | null {
  const relativePath = lease.worktree.relativePath ?? "";
  if (lease.worktree.base === "projectRoot") {
    return path.resolve(projectRoot, relativePath);
  }
  if (lease.worktree.base === "projectWorktreesRoot") {
    return path.resolve(
      projectWorktreesRootPath(projectRoot, projectConfig),
      relativePath,
    );
  }
  const componentId = lease.worktree.componentId ?? lease.scope.componentId;
  const component = componentId
    ? components.find((candidate) => candidate.id === componentId)
    : null;
  if (lease.worktree.base === "componentWorktreesRoot" && component) {
    return path.resolve(component.worktreesRoot, relativePath);
  }
  if (lease.worktree.base === "componentSourceRoot" && component) {
    return path.resolve(component.sourceRoot, relativePath);
  }
  return null;
}
