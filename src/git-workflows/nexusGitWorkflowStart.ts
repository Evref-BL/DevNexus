import {
  prepareNexusManualWorktree,
  summarizeNexusManualWorktreeResult,
  type PrepareNexusManualWorktreeResult,
  type NexusPreparedWorktreeSummary,
} from "../worktrees/nexusManualWorktree.js";
import type { GitRunner } from "../worktrees/gitWorktreeService.js";
import {
  buildNexusGitWorkflowPlan,
  type NexusGitWorkflowPlanStatusResult,
} from "./nexusGitWorkflowPlanStatus.js";
import {
  createNexusGitWorkflowRun,
  type NexusGitWorkflowRunRecord,
} from "./nexusGitWorkflowRunState.js";

export interface StartNexusGitWorkflowOptions {
  projectRoot: string;
  componentId?: string | null;
  profileId?: string | null;
  runId?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  workItemDescription?: string | null;
  branchName?: string | null;
  worktreeName?: string | null;
  baseRef?: string | null;
  hostId?: string | null;
  agentId?: string | null;
  workerAgentProvider?: string | null;
  writeScope?: string[];
  leaseNotes?: string[];
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface StartNexusGitWorkflowResult {
  projectRoot: string;
  profile: NexusGitWorkflowPlanStatusResult["profile"];
  plan: NexusGitWorkflowPlanStatusResult;
  prepared: PrepareNexusManualWorktreeResult;
  preparedSummary: NexusPreparedWorktreeSummary;
  run: NexusGitWorkflowRunRecord;
  nextActions: string[];
}

export function startNexusGitWorkflow(
  options: StartNexusGitWorkflowOptions,
): StartNexusGitWorkflowResult {
  const plan = buildNexusGitWorkflowPlan({
    projectRoot: options.projectRoot,
    componentId: options.componentId,
    profileId: options.profileId,
    workItemId: options.workItemId,
    branchName: options.branchName,
    gitRunner: options.gitRunner,
  });
  const baseRef = options.baseRef !== undefined ? options.baseRef : plan.refs.baseRef;
  assertStartableGitWorkflowPlan(plan, {
    ignoreDefaultBaseRefBlocker: options.baseRef !== undefined,
  });
  const prepared = prepareNexusManualWorktree({
    projectRoot: options.projectRoot,
    componentId: options.componentId ?? undefined,
    branchName: options.branchName ?? undefined,
    worktreeName: options.worktreeName ?? undefined,
    baseRef,
    workItemId: options.workItemId,
    workItemTitle: options.workItemTitle,
    workItemDescription: options.workItemDescription,
    hostId: options.hostId,
    agentId: options.agentId,
    workerAgentProvider: options.workerAgentProvider,
    writeScope: options.writeScope,
    leaseNotes: options.leaseNotes,
    gitRunner: options.gitRunner,
    now: options.now,
  });
  const workItemId = options.workItemId ?? prepared.worktree.workItem?.id ?? null;
  const run = createNexusGitWorkflowRun({
    projectRoot: prepared.worktree.worktreePath,
    id: options.runId,
    projectId: prepared.projectId,
    componentId: prepared.component?.id ?? prepared.worktree.componentId,
    profileId: plan.profile.id!,
    branchStrategy: plan.profile.branchStrategy,
    workItemId,
    branchName: prepared.worktree.branchName,
    currentRef: prepared.worktree.branchName,
    baseRef: prepared.worktree.baseRef,
    baseCommit: prepared.worktree.resolvedBaseCommit,
    targetBranch: plan.refs.targetBranch,
    owner: {
      kind: "agent",
      id: options.agentId ?? null,
    },
    evidence: [
      {
        id: "worktree-lease",
        kind: "worktree_lease",
        summary: `Created worktree lease ${prepared.lease.id}.`,
      },
      {
        id: "branch-strategy",
        kind: "git_workflow_profile",
        summary: `Selected ${plan.profile.branchStrategy} branch strategy from profile ${plan.profile.id}.`,
      },
    ],
    nodes: [
      {
        id: "start",
        kind: "action",
        summary: "Prepared the Git workflow worktree and recorded the initial run.",
      },
    ],
    now: options.now,
  });

  return {
    projectRoot: prepared.projectRoot,
    profile: plan.profile,
    plan,
    prepared,
    preparedSummary: summarizeNexusManualWorktreeResult(prepared),
    run,
    nextActions: [
      ...prepared.nextActions,
      "Use dev-nexus git-workflow status to inspect the recorded run before provider or publication actions.",
    ],
  };
}

function assertStartableGitWorkflowPlan(
  plan: NexusGitWorkflowPlanStatusResult,
  options: { ignoreDefaultBaseRefBlocker: boolean },
): void {
  if (!plan.profile.id || !plan.profile.branchStrategy) {
    throw new Error("git-workflow start requires a selected Git workflow profile");
  }
  if (!plan.refs.targetBranch) {
    throw new Error("git-workflow start requires a resolved target branch");
  }
  const blockers = options.ignoreDefaultBaseRefBlocker
    ? plan.blockers.filter((blocker) =>
        !blocker.startsWith("Base ref could not be resolved:")
      )
    : plan.blockers;
  if (blockers.length > 0) {
    throw new Error(
      `git-workflow start is blocked: ${blockers.join("; ")}`,
    );
  }
}
