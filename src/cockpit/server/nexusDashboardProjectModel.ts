
import { samePath, type ResolvedNexusProjectComponent } from "../../project/nexusProjectLifecycle.js";
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import type { GitRunner } from "../../worktrees/gitWorktreeService.js";
import type { NexusDashboardGitHistoryComponent } from "./nexusDashboardGitHistory.js";
import type {
  NexusDashboardComponentSummary,
  NexusDashboardProjectSummary,
} from "./nexusDashboardTypes.js";
import { collectDashboardGitState } from "./nexusDashboardGitState.js";

export function projectSummary(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
): NexusDashboardProjectSummary {
  return {
    id: projectConfig.id,
    name: projectConfig.name,
    root: projectRoot,
    componentCount: components.length,
    defaultBranch: projectConfig.repo.defaultBranch,
    remoteUrl: projectConfig.repo.remoteUrl,
  };
}

export function summarizeComponent(
  component: ResolvedNexusProjectComponent,
  gitRunner: GitRunner,
): NexusDashboardComponentSummary {
  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    role: component.role,
    remoteUrl: component.remoteUrl,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    defaultTrackerId: component.defaultTrackerId,
    trackerProviders: component.workTrackers.map((tracker) => tracker.provider),
    verificationRequired: component.verification?.requirePassing ?? false,
    publicationStrategy: component.publication?.strategy ?? null,
    git: component.sourceRootExists
      ? collectDashboardGitState(component.sourceRoot, gitRunner)
      : null,
  };
}

export function summarizeWorkspaceGitHistoryComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
  gitRunner: GitRunner,
): NexusDashboardGitHistoryComponent | null {
  const git = collectDashboardGitState(projectRoot, gitRunner);
  if (!git) return null;
  const primaryComponent = components.find((component) => component.role === "primary");
  if (
    primaryComponent?.remoteUrl &&
    projectConfig.repo.remoteUrl &&
    sameGitRemoteIdentity(primaryComponent.remoteUrl, projectConfig.repo.remoteUrl)
  ) {
    return null;
  }
  if (components.some((component) =>
    component.git?.repositoryPath &&
    samePath(component.git.repositoryPath, git.repositoryPath)
  )) {
    return null;
  }
  return {
    id: workspaceGitHistoryComponentId(components),
    name: "Workspace",
    sourceRoot: projectRoot,
    sourceRootExists: true,
    git: {
      repositoryPath: git.repositoryPath,
      headCommit: git.headCommit,
    },
  };
}

function workspaceGitHistoryComponentId(
  components: NexusDashboardComponentSummary[],
): string {
  const componentIds = new Set(components.map((component) => component.id));
  if (!componentIds.has("workspace")) return "workspace";
  let index = 2;
  while (componentIds.has(`workspace-${index}`)) index += 1;
  return `workspace-${index}`;
}

function sameGitRemoteIdentity(left: string, right: string): boolean {
  return normalizeGitRemoteIdentity(left) === normalizeGitRemoteIdentity(right);
}

function normalizeGitRemoteIdentity(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/u, "$1/")
    .replace(/^ssh:\/\/git@/u, "")
    .replace(/^https?:\/\//u, "")
    .replace(/\.git$/u, "");
}

export function summarizeComponentShell(
  component: ResolvedNexusProjectComponent,
): NexusDashboardComponentSummary {
  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    role: component.role,
    remoteUrl: component.remoteUrl,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    defaultTrackerId: component.defaultTrackerId,
    trackerProviders: component.workTrackers.map((tracker) => tracker.provider),
    verificationRequired: component.verification?.requirePassing ?? false,
    publicationStrategy: component.publication?.strategy ?? null,
    git: null,
  };
}
