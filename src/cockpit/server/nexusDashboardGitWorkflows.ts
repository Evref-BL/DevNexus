import type { NexusGitWorkflowProfileConfig } from "../../automation/nexusAutomationConfig.js";
import {
  listNexusGitWorkflowRuns,
  type NexusGitWorkflowRunOwner,
  type NexusGitWorkflowRunStatus,
  type NexusGitWorkflowRunSummary,
  type NexusGitWorkflowRunTerminalOutcome,
} from "../../git-workflows/nexusGitWorkflowRunState.js";
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";

export interface NexusDashboardGitWorkflowProfileRecord {
  id: string;
  name: string;
  source: string;
  branchStrategy: string;
  targetBranch: string | null;
  activeFeatureId: string | null;
  reviewMode: string;
  finalPullRequest: boolean;
  gateCount: number;
}

export interface NexusDashboardGitWorkflowRunRecord {
  id: string;
  componentId: string | null;
  profileId: string;
  branchStrategy: string | null;
  status: NexusGitWorkflowRunStatus;
  statusLabel: string;
  terminalOutcome: NexusGitWorkflowRunTerminalOutcome | null;
  branchName: string | null;
  currentRef: string | null;
  targetBranch: string | null;
  workItemId: string | null;
  currentNodeId: string | null;
  nextOwnerLabel: string;
  preservationKind: string | null;
  evidenceCount: number;
  allowedTransitionCount: number;
  updatedAt: string;
}

export interface NexusDashboardGitWorkflowSummary {
  activeProfileId: string | null;
  profileCount: number;
  runCount: number;
  activeRunCount: number;
  waitingRunCount: number;
  blockedRunCount: number;
  terminalRunCount: number;
  storePath: string | null;
  profiles: NexusDashboardGitWorkflowProfileRecord[];
  runs: NexusDashboardGitWorkflowRunRecord[];
}

const terminalStatuses = new Set<NexusGitWorkflowRunStatus>([
  "completed",
  "aborted",
  "abandoned",
  "archived",
  "rescued",
  "merged",
]);

const waitingStatuses = new Set<NexusGitWorkflowRunStatus>([
  "ready_for_review",
  "waiting",
  "paused",
]);

export function summarizeGitWorkflows(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusDashboardGitWorkflowSummary {
  const config = projectConfig.automation?.gitWorkflows ?? {
    activeProfileId: null,
    profiles: [],
  };
  const listed = listNexusGitWorkflowRuns({ projectRoot });
  const runs = listed.runs
    .map(gitWorkflowRunRecord)
    .sort(compareGitWorkflowRuns);

  return {
    activeProfileId: config.activeProfileId,
    profileCount: config.profiles.length,
    runCount: runs.length,
    activeRunCount: runs.filter((run) => !terminalStatuses.has(run.status)).length,
    waitingRunCount: runs.filter((run) => waitingStatuses.has(run.status)).length,
    blockedRunCount: runs.filter((run) => run.status === "blocked").length,
    terminalRunCount: runs.filter((run) => terminalStatuses.has(run.status)).length,
    storePath: listed.storePath,
    profiles: config.profiles.map(gitWorkflowProfileRecord),
    runs,
  };
}

function gitWorkflowProfileRecord(
  profile: NexusGitWorkflowProfileConfig,
): NexusDashboardGitWorkflowProfileRecord {
  return {
    id: profile.id,
    name: profile.name ?? profile.id,
    source: profile.source,
    branchStrategy: profile.branchStrategy,
    targetBranch: profile.targetBranch,
    activeFeatureId: profile.activeFeatureId,
    reviewMode: profile.review.mode,
    finalPullRequest: profile.review.finalPullRequest,
    gateCount:
      profile.gates.start.length +
      profile.gates.review.length +
      profile.gates.publication.length +
      profile.gates.cleanup.length,
  };
}

function gitWorkflowRunRecord(
  run: NexusGitWorkflowRunSummary,
): NexusDashboardGitWorkflowRunRecord {
  return {
    id: run.id,
    componentId: run.componentId,
    profileId: run.profileId,
    branchStrategy: run.branchStrategy,
    status: run.status,
    statusLabel: statusLabel(run.status),
    terminalOutcome: run.terminalOutcome,
    branchName: run.branchName,
    currentRef: run.currentRef,
    targetBranch: run.targetBranch,
    workItemId: run.workItemId,
    currentNodeId: run.currentNodeId,
    nextOwnerLabel: ownerLabel(run.nextOwner),
    preservationKind: run.preservation?.kind ?? null,
    evidenceCount: run.evidenceCount,
    allowedTransitionCount: run.allowedTransitionCount,
    updatedAt: run.updatedAt,
  };
}

function compareGitWorkflowRuns(
  left: NexusDashboardGitWorkflowRunRecord,
  right: NexusDashboardGitWorkflowRunRecord,
): number {
  const byTime = right.updatedAt.localeCompare(left.updatedAt);
  return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
}

function ownerLabel(owner: NexusGitWorkflowRunOwner): string {
  if (owner.kind === "none") {
    return "No owner";
  }
  const label = owner.kind.charAt(0).toUpperCase() + owner.kind.slice(1);
  return owner.id ? `${label}: ${owner.id}` : label;
}

function statusLabel(status: NexusGitWorkflowRunStatus): string {
  const words = status
    .split("_")
    .map((part) => part.toLowerCase());
  const label = words.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
