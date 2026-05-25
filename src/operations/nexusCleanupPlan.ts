import fs from "node:fs";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "../worktrees/gitWorktreeService.js";
import {
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  defaultNexusWorktreeLeaseStaleAfterMs,
  readNexusWorktreeLeaseStore,
  type NexusWorktreeLeaseRecord,
} from "../worktrees/nexusWorktreeLease.js";
import {
  readNexusGitWorkflowRunStore,
  type NexusGitWorkflowRunOwner,
  type NexusGitWorkflowRunPreservation,
  type NexusGitWorkflowRunRecord,
  type NexusGitWorkflowRunStatus,
  type NexusGitWorkflowRunTerminalOutcome,
} from "../git-workflows/nexusGitWorkflowRunState.js";

export type NexusCleanupCandidateKind = "branch" | "worktree";

export type NexusCleanupClassification =
  | "safe"
  | "blocked"
  | "stale"
  | "merged"
  | "superseded"
  | "dirty"
  | "unpushed"
  | "missing_handoff"
  | "unknown_merge_state"
  | "active_lease"
  | "abandoned"
  | "needs_rescue"
  | "workflow_active"
  | "workflow_paused"
  | "workflow_abandoned"
  | "workflow_aborted"
  | "workflow_archived"
  | "workflow_rescued";

export interface NexusCleanupGitFacts {
  repositoryPath: string | null;
  branch: string | null;
  headCommit: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  stagedCount: number | null;
  unstagedCount: number | null;
  untrackedCount: number | null;
  targetBranch: string | null;
  targetCommit: string | null;
  mergedIntoTarget: boolean | null;
}

export interface NexusCleanupLeaseSummary {
  id: string;
  status: string;
  effectiveStatus: string;
  stale: boolean;
  workItemId: string | null;
  branchName: string | null;
  lastObservedHeadCommit: string | null;
  lastSeenAt: string;
  notes: string[];
}

export interface NexusCleanupWorkflowRunSummary {
  id: string;
  status: NexusGitWorkflowRunStatus;
  terminalOutcome: NexusGitWorkflowRunTerminalOutcome | null;
  workItemId: string | null;
  branchName: string | null;
  currentRef: string | null;
  nextOwner: NexusGitWorkflowRunOwner;
  preservation: NexusGitWorkflowRunPreservation | null;
  updatedAt: string;
}

export interface NexusCleanupCandidate {
  id: string;
  kind: NexusCleanupCandidateKind;
  scope: "component" | "project_meta";
  componentId: string | null;
  worktreePath: string | null;
  branch: string | null;
  classifications: NexusCleanupClassification[];
  safeToDelete: boolean;
  proof: string[];
  blockers: string[];
  rescue: {
    needed: boolean;
    reason: string | null;
  };
  git: NexusCleanupGitFacts;
  lease: NexusCleanupLeaseSummary | null;
  workflowRun: NexusCleanupWorkflowRunSummary | null;
}

export interface NexusCleanupPlan {
  project: {
    id: string;
    name: string;
    projectRoot: string;
  };
  scope: {
    componentId: string | null;
    includeProjectMeta: boolean;
  };
  targets: Array<{
    scope: "component" | "project_meta";
    componentId: string | null;
    targetBranch: string | null;
    targetCommit: string | null;
    warnings: string[];
  }>;
  candidates: NexusCleanupCandidate[];
  summary: {
    total: number;
    safe: number;
    blocked: number;
    needsRescue: number;
    activeLeases: number;
    staleLeases: number;
  };
  warnings: string[];
  mutatesSource: false;
}

export interface BuildNexusCleanupPlanOptions {
  projectRoot: string;
  componentId?: string | null;
  includeProjectMeta?: boolean;
  targetBranch?: string | null;
  gitRunner?: GitRunner;
  now?: Date | string | (() => Date | string);
  staleAfterMs?: number;
}

interface CleanupScope {
  scope: "component" | "project_meta";
  component: ResolvedNexusProjectComponent | null;
  repositoryPath: string;
  worktreesRoot: string;
  branchPrefix: string;
  targetBranch: string | null;
}

interface RawCleanupCandidate {
  kind: NexusCleanupCandidateKind;
  scope: "component" | "project_meta";
  componentId: string | null;
  repositoryPath: string;
  worktreePath: string | null;
  branch: string | null;
  targetBranch: string | null;
}

interface WorktreeListEntry {
  path: string;
  branch: string | null;
  headCommit: string | null;
}

interface ClassificationContext {
  projectRoot: string;
  projectWorktreesRoot: string;
  component: ResolvedNexusProjectComponent | null;
  candidate: RawCleanupCandidate;
  leases: NexusWorktreeLeaseRecord[];
  now: string;
  staleAfterMs: number;
  gitRunner: GitRunner;
}

export function buildNexusCleanupPlan(
  options: BuildNexusCleanupPlanOptions,
): NexusCleanupPlan {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const projectWorktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const now = currentTimestamp(options.now);
  const staleAfterMs =
    options.staleAfterMs ?? defaultNexusWorktreeLeaseStaleAfterMs;
  const scopes = cleanupScopes({
    projectRoot,
    projectConfig,
    componentId: options.componentId,
    includeProjectMeta: options.includeProjectMeta,
    targetBranch: options.targetBranch,
  });
  const leaseStore = readNexusWorktreeLeaseStore(projectRoot);
  const warnings: string[] = [];
  const targets: NexusCleanupPlan["targets"] = [];
  const candidates: NexusCleanupCandidate[] = [];

  for (const scope of scopes) {
    const target = targetFacts(scope, gitRunner);
    targets.push({
      scope: scope.scope,
      componentId: scope.component?.id ?? null,
      targetBranch: scope.targetBranch,
      targetCommit: target.commit,
      warnings: target.warnings,
    });
    warnings.push(...target.warnings);

    for (const candidate of collectCleanupCandidates(scope, gitRunner)) {
      candidates.push(
        classifyCleanupCandidate({
          projectRoot,
          projectWorktreesRoot,
          component: scope.component,
          candidate: {
            ...candidate,
            targetBranch: scope.targetBranch,
          },
          leases: leaseStore.leases,
          now,
          staleAfterMs,
          gitRunner,
        }),
      );
    }
  }

  const uniqueCandidates = uniqueCleanupCandidates(candidates);

  return {
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
      projectRoot,
    },
    scope: {
      componentId: options.componentId ?? null,
      includeProjectMeta: options.includeProjectMeta ?? false,
    },
    targets,
    candidates: uniqueCandidates,
    summary: {
      total: uniqueCandidates.length,
      safe: uniqueCandidates.filter((candidate) => candidate.safeToDelete).length,
      blocked: uniqueCandidates.filter((candidate) => !candidate.safeToDelete).length,
      needsRescue: uniqueCandidates.filter((candidate) => candidate.rescue.needed).length,
      activeLeases: uniqueCandidates.filter((candidate) =>
        candidate.classifications.includes("active_lease"),
      ).length,
      staleLeases: uniqueCandidates.filter((candidate) =>
        candidate.classifications.includes("stale"),
      ).length,
    },
    warnings: uniqueStrings(warnings),
    mutatesSource: false,
  };
}

function cleanupScopes(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  componentId?: string | null;
  includeProjectMeta?: boolean;
  targetBranch?: string | null;
}): CleanupScope[] {
  const components = resolveProjectComponents(options.projectRoot, options.projectConfig);
  const selectedComponent = options.componentId
    ? components.find((component) => component.id === options.componentId)
    : resolvePrimaryProjectComponent(options.projectRoot, options.projectConfig);
  if (!selectedComponent) {
    throw new Error(`Unknown component for cleanup plan: ${options.componentId}`);
  }

  const scopes: CleanupScope[] = [{
    scope: "component",
    component: selectedComponent,
    repositoryPath: selectedComponent.sourceRoot,
    worktreesRoot: selectedComponent.worktreesRoot,
    branchPrefix: `codex/${selectedComponent.id}/`,
    targetBranch:
      options.targetBranch ??
      selectedComponent.publication?.targetBranch ??
      selectedComponent.defaultBranch ??
      options.projectConfig.repo.defaultBranch,
  }];

  if (options.includeProjectMeta) {
    scopes.push({
      scope: "project_meta",
      component: null,
      repositoryPath: options.projectRoot,
      worktreesRoot: projectWorktreesRootPath(options.projectRoot, options.projectConfig),
      branchPrefix: `codex/${options.projectConfig.id}/`,
      targetBranch:
        options.targetBranch ??
        options.projectConfig.automation?.publication?.targetBranch ??
        options.projectConfig.repo.defaultBranch,
    });
  }

  return scopes;
}

function targetFacts(
  scope: CleanupScope,
  gitRunner: GitRunner,
): { commit: string | null; warnings: string[] } {
  if (!scope.targetBranch) {
    return {
      commit: null,
      warnings: [`No cleanup target branch is configured for ${scopeLabel(scope)}.`],
    };
  }
  const result = runOptionalGit(
    gitRunner,
    ["rev-parse", "--verify", scope.targetBranch],
    scope.repositoryPath,
  );
  if (!result) {
    return {
      commit: null,
      warnings: [
        `Target branch ${scope.targetBranch} could not be resolved for ${scopeLabel(scope)}.`,
      ],
    };
  }

  return {
    commit: result.stdout.trim() || null,
    warnings: [],
  };
}

function collectCleanupCandidates(
  scope: CleanupScope,
  gitRunner: GitRunner,
): RawCleanupCandidate[] {
  const candidates: RawCleanupCandidate[] = [];
  for (const entry of gitWorktreeList(scope.repositoryPath, gitRunner)) {
    if (isInsidePath(scope.worktreesRoot, entry.path)) {
      candidates.push({
        kind: "worktree",
        scope: scope.scope,
        componentId: scope.component?.id ?? null,
        repositoryPath: entry.path,
        worktreePath: entry.path,
        branch: entry.branch,
        targetBranch: scope.targetBranch,
      });
    }
  }

  if (fs.existsSync(scope.worktreesRoot)) {
    for (const entry of fs.readdirSync(scope.worktreesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const worktreePath = path.join(scope.worktreesRoot, entry.name);
      if (!isGitWorktree(worktreePath, gitRunner)) {
        continue;
      }
      candidates.push({
        kind: "worktree",
        scope: scope.scope,
        componentId: scope.component?.id ?? null,
        repositoryPath: worktreePath,
        worktreePath,
        branch: currentBranch(worktreePath, gitRunner),
        targetBranch: scope.targetBranch,
      });
    }
  }

  for (const branch of cleanupBranches(scope, gitRunner)) {
    candidates.push({
      kind: "branch",
      scope: scope.scope,
      componentId: scope.component?.id ?? null,
      repositoryPath: scope.repositoryPath,
      worktreePath: null,
      branch,
      targetBranch: scope.targetBranch,
    });
  }

  return candidates;
}

function classifyCleanupCandidate(
  context: ClassificationContext,
): NexusCleanupCandidate {
  const candidate = context.candidate;
  const proof: string[] = [];
  const blockers: string[] = [];
  const classifications: NexusCleanupClassification[] = [];
  const branch = candidate.branch;
  const repositoryPath = candidate.worktreePath ?? candidate.repositoryPath;
  const lease = matchingLease(context);
  const workflowRun = matchingWorkflowRun(context, lease?.record ?? null);
  const workflowAllowsUnmergedCleanup =
    workflowRunAllowsUnmergedCleanup(workflowRun);
  const statusFacts = candidate.worktreePath
    ? worktreeStatusFacts(candidate.worktreePath, context.gitRunner)
    : { stagedCount: null, unstagedCount: null, untrackedCount: null };
  const headCommit = branch
    ? gitOutput(context.gitRunner, ["rev-parse", branch], candidate.repositoryPath)
    : gitOutput(context.gitRunner, ["rev-parse", "HEAD"], repositoryPath);
  const targetCommit = candidate.targetBranch
    ? gitOutput(
        context.gitRunner,
        ["rev-parse", "--verify", candidate.targetBranch],
        candidate.repositoryPath,
      )
    : null;
  const mergedIntoTarget = branch && candidate.targetBranch && targetCommit
    ? gitExitCode(
        context.gitRunner,
        ["merge-base", "--is-ancestor", branch, candidate.targetBranch],
        candidate.repositoryPath,
      ) === 0
    : null;
  const upstream = branch
    ? gitOutput(
        context.gitRunner,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{u}`],
        candidate.repositoryPath,
      )
    : null;
  const aheadBehind = branch && upstream
    ? branchAheadBehind(context.gitRunner, candidate.repositoryPath, branch, upstream)
    : { ahead: null, behind: null };
  const superseded = supersededByRecordedMergedHead({
    context,
    lease,
    targetBranch: candidate.targetBranch,
  });

  if ((statusFacts.untrackedCount ?? 0) > 0) {
    classifications.push("needs_rescue", "blocked");
    blockers.push("Worktree contains untracked files that are not preserved by any branch.");
  }
  if ((statusFacts.stagedCount ?? 0) > 0 || (statusFacts.unstagedCount ?? 0) > 0) {
    classifications.push("dirty", "blocked");
    blockers.push("Worktree contains staged or unstaged local changes.");
  }

  if (lease) {
    proof.push(
      `Matched ${lease.stale ? "stale " : ""}lease ${lease.record.id} with status ${lease.record.status}.`,
    );
    if (lease.record.status === "abandoned") {
      classifications.push("abandoned", "blocked");
      blockers.push("Lease marks this work as abandoned; preserve or explicitly archive before cleanup.");
    } else if (lease.stale) {
      classifications.push("stale");
      if (mergedIntoTarget === true) {
        proof.push(
          "Lease is stale, but Git proves the branch is contained in the target branch.",
        );
      } else {
        classifications.push("blocked");
        blockers.push("Lease is stale; refresh ownership or inspect manually before cleanup.");
      }
    } else if (!["merged"].includes(lease.record.status)) {
      classifications.push("active_lease", "blocked");
      blockers.push(`Lease status ${lease.record.status} indicates active or pending work.`);
    }
  } else if (
    branch &&
    mergedIntoTarget !== true &&
    !workflowRun &&
    !workflowAllowsUnmergedCleanup
  ) {
    classifications.push("missing_handoff", "blocked");
    blockers.push("No matching handoff or lease evidence was found for this unmerged branch.");
  }

  if ((aheadBehind.ahead ?? 0) > 0) {
    classifications.push("unpushed", "blocked");
    blockers.push(`Branch has ${aheadBehind.ahead} commit(s) not present on upstream ${upstream}.`);
  }
  if (
    branch &&
    !upstream &&
    mergedIntoTarget !== true &&
    !workflowAllowsUnmergedCleanup
  ) {
    classifications.push("unknown_merge_state", "blocked");
    blockers.push("Branch has no upstream, so remote recoverability is unknown.");
  }
  if (candidate.targetBranch && !targetCommit) {
    classifications.push("unknown_merge_state", "blocked");
    blockers.push(`Target branch ${candidate.targetBranch} cannot be resolved.`);
  }

  if (mergedIntoTarget === true) {
    classifications.push("merged", "safe");
    proof.push(`Branch ${branch ?? "HEAD"} is contained in ${candidate.targetBranch}.`);
  } else if (superseded) {
    classifications.push("superseded", "safe");
    proof.push(superseded);
  } else if (mergedIntoTarget === false) {
    proof.push(`Branch ${branch ?? "HEAD"} is not contained in ${candidate.targetBranch}.`);
  }

  applyWorkflowRunCleanupEvidence({
    workflowRun,
    branch,
    statusFacts,
    proof,
    blockers,
    classifications,
  });

  const uniqueClassifications = uniqueStrings(classifications) as NexusCleanupClassification[];
  const safeToDelete =
    uniqueClassifications.includes("safe") &&
    !uniqueClassifications.includes("blocked");
  const needsRescue =
    uniqueClassifications.includes("needs_rescue") ||
    uniqueClassifications.includes("dirty") ||
    uniqueClassifications.includes("abandoned");

  return {
    id: cleanupCandidateId(candidate),
    kind: candidate.kind,
    scope: candidate.scope,
    componentId: candidate.componentId,
    worktreePath: candidate.worktreePath,
    branch,
    classifications: uniqueClassifications.length > 0
      ? uniqueClassifications
      : ["blocked", "unknown_merge_state"],
    safeToDelete,
    proof,
    blockers: uniqueStrings(blockers),
    rescue: {
      needed: needsRescue,
      reason: needsRescue
        ? "Preserve local work with a rescue branch or explicit archive record before cleanup."
        : null,
    },
    git: {
      repositoryPath,
      branch,
      headCommit,
      upstream,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      stagedCount: statusFacts.stagedCount,
      unstagedCount: statusFacts.unstagedCount,
      untrackedCount: statusFacts.untrackedCount,
      targetBranch: candidate.targetBranch,
      targetCommit,
      mergedIntoTarget,
    },
    lease: lease ? leaseSummary(lease.record, lease.stale) : null,
    workflowRun: workflowRun ? workflowRunSummary(workflowRun) : null,
  };
}

function matchingLease(context: ClassificationContext): {
  record: NexusWorktreeLeaseRecord;
  stale: boolean;
} | null {
  const candidate = context.candidate;
  const matches = context.leases
    .filter((lease) => {
      if (candidate.scope === "component") {
        if (
          lease.scope.kind !== "component" ||
          lease.scope.componentId !== candidate.componentId
        ) {
          return false;
        }
      } else if (lease.scope.kind !== "project_meta") {
        return false;
      }

      const branchMatches =
        candidate.branch &&
        lease.branchName &&
        candidate.branch === lease.branchName;
      const worktreeMatches =
        candidate.worktreePath &&
        pathMatchesLeaseWorktree(
          context.projectRoot,
          context.projectWorktreesRoot,
          context.component,
          lease,
          candidate.worktreePath,
        );

      return Boolean(branchMatches || worktreeMatches);
    })
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const record = matches[0];
  if (!record) {
    return null;
  }

  return {
    record,
    stale: leaseIsStale(record, context.now, context.staleAfterMs),
  };
}

function matchingWorkflowRun(
  context: ClassificationContext,
  lease: NexusWorktreeLeaseRecord | null,
): NexusGitWorkflowRunRecord | null {
  const candidate = context.candidate;
  if (!candidate.worktreePath) {
    return null;
  }

  let runs: NexusGitWorkflowRunRecord[];
  try {
    runs = readNexusGitWorkflowRunStore(candidate.worktreePath).runs;
  } catch {
    return null;
  }
  if (runs.length === 0) {
    return null;
  }

  const componentId = candidate.componentId;
  const matching = runs
    .filter((run) => componentId ? run.componentId === componentId : true)
    .filter((run) => {
      if (candidate.branch) {
        return run.branchName === candidate.branch || run.currentRef === candidate.branch;
      }
      if (lease?.workItemId) {
        return run.workItemId === lease.workItemId;
      }
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return matching[0] ?? null;
}

function applyWorkflowRunCleanupEvidence(options: {
  workflowRun: NexusGitWorkflowRunRecord | null;
  branch: string | null;
  statusFacts: {
    stagedCount: number | null;
    unstagedCount: number | null;
    untrackedCount: number | null;
  };
  proof: string[];
  blockers: string[];
  classifications: NexusCleanupClassification[];
}): void {
  const run = options.workflowRun;
  if (!run) {
    return;
  }
  options.proof.push(`Matched Git workflow run ${run.id} with status ${run.status}.`);

  if (run.status === "paused") {
    options.classifications.push("workflow_paused", "blocked");
    options.blockers.push(
      `Git workflow run ${run.id} is paused for ${ownerLabel(run.owner)}; resume it or choose abandon, archive, or rescue before cleanup.`,
    );
    return;
  }

  if (!isTerminalWorkflowStatus(run.status)) {
    options.classifications.push("workflow_active", "blocked");
    options.blockers.push(
      `Git workflow run ${run.id} is still ${run.status}; finish, pause, archive, or rescue it before cleanup.`,
    );
    return;
  }

  if (run.status === "abandoned") {
    options.classifications.push("workflow_abandoned");
    if (!run.preservation) {
      options.classifications.push("needs_rescue", "blocked");
      options.blockers.push(
        `Git workflow run ${run.id} was abandoned without archive or rescue preservation.`,
      );
    }
    return;
  }

  if (run.status === "aborted") {
    options.classifications.push("workflow_aborted");
    if (!options.branch && cleanStatusFacts(options.statusFacts)) {
      options.classifications.push("safe");
      options.proof.push(
        `Workflow run ${run.id} was cleanly aborted before durable branch work existed.`,
      );
    } else if (run.preservation?.kind === "empty") {
      options.classifications.push("safe");
      options.proof.push(
        `Workflow run ${run.id} records empty-work preservation before cleanup.`,
      );
    }
    return;
  }

  if (run.status === "archived") {
    options.classifications.push("workflow_archived");
    if (run.preservation?.kind === "archive_record") {
      options.classifications.push("safe");
      options.proof.push(
        `Workflow run ${run.id} was archived: ${run.preservation.summary}`,
      );
    } else {
      options.classifications.push("needs_rescue", "blocked");
      options.blockers.push(
        `Archived workflow run ${run.id} does not include archive preservation evidence.`,
      );
    }
    return;
  }

  if (run.status === "rescued") {
    options.classifications.push("workflow_rescued");
    if (run.preservation?.kind === "rescue_branch") {
      options.classifications.push("safe");
      options.proof.push(
        `Workflow run ${run.id} was rescued: ${run.preservation.summary}`,
      );
    } else {
      options.classifications.push("needs_rescue", "blocked");
      options.blockers.push(
        `Rescued workflow run ${run.id} does not include rescue preservation evidence.`,
      );
    }
  }
}

function workflowRunAllowsUnmergedCleanup(
  run: NexusGitWorkflowRunRecord | null,
): boolean {
  return (
    run?.status === "archived" &&
    run.preservation?.kind === "archive_record"
  ) || (
    run?.status === "rescued" &&
    run.preservation?.kind === "rescue_branch"
  );
}

function workflowRunSummary(
  run: NexusGitWorkflowRunRecord,
): NexusCleanupWorkflowRunSummary {
  return {
    id: run.id,
    status: run.status,
    terminalOutcome: run.terminalOutcome,
    workItemId: run.workItemId,
    branchName: run.branchName,
    currentRef: run.currentRef,
    nextOwner: run.owner,
    preservation: run.preservation,
    updatedAt: run.updatedAt,
  };
}

function supersededByRecordedMergedHead(options: {
  context: ClassificationContext;
  lease: { record: NexusWorktreeLeaseRecord; stale: boolean } | null;
  targetBranch: string | null;
}): string | null {
  if (!options.lease || !options.targetBranch) {
    return null;
  }
  if (options.lease.record.status !== "merged") {
    return null;
  }
  const observedHead = options.lease.record.lastObservedHeadCommit;
  if (!observedHead) {
    return null;
  }
  const exitCode = gitExitCode(
    options.context.gitRunner,
    ["merge-base", "--is-ancestor", observedHead, options.targetBranch],
    options.context.candidate.repositoryPath,
  );
  if (exitCode !== 0) {
    return null;
  }

  return `Recorded merged head ${observedHead} is contained in ${options.targetBranch}.`;
}

function worktreeStatusFacts(
  worktreePath: string,
  gitRunner: GitRunner,
): {
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
} {
  const status = runOptionalGit(gitRunner, ["status", "--porcelain=v1"], worktreePath);
  if (!status) {
    return { stagedCount: 0, unstagedCount: 0, untrackedCount: 0 };
  }

  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  for (const line of status.stdout.split(/\r?\n/u).filter(Boolean)) {
    if (line.startsWith("??")) {
      untrackedCount += 1;
      continue;
    }
    if (line[0] && line[0] !== " ") {
      stagedCount += 1;
    }
    if (line[1] && line[1] !== " ") {
      unstagedCount += 1;
    }
  }

  return { stagedCount, unstagedCount, untrackedCount };
}

function branchAheadBehind(
  gitRunner: GitRunner,
  repositoryPath: string,
  branch: string,
  upstream: string,
): { ahead: number | null; behind: number | null } {
  const result = runOptionalGit(
    gitRunner,
    ["rev-list", "--left-right", "--count", `${branch}...${upstream}`],
    repositoryPath,
  );
  if (!result) {
    return { ahead: null, behind: null };
  }
  const [ahead, behind] = result.stdout.trim().split(/\s+/u).map((value) =>
    Number.parseInt(value, 10),
  );

  return {
    ahead: Number.isFinite(ahead) ? ahead! : null,
    behind: Number.isFinite(behind) ? behind! : null,
  };
}

function gitWorktreeList(
  repositoryPath: string,
  gitRunner: GitRunner,
): WorktreeListEntry[] {
  const result = runOptionalGit(
    gitRunner,
    ["worktree", "list", "--porcelain"],
    repositoryPath,
  );
  if (!result) {
    return [];
  }

  const entries: WorktreeListEntry[] = [];
  let current: Partial<WorktreeListEntry> | null = null;
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      if (current?.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? null,
          headCommit: current.headCommit ?? null,
        });
      }
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("HEAD ")) {
      current.headCommit = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//u, "");
    }
  }
  if (current?.path) {
    entries.push({
      path: current.path,
      branch: current.branch ?? null,
      headCommit: current.headCommit ?? null,
    });
  }

  return entries;
}

function cleanupBranches(scope: CleanupScope, gitRunner: GitRunner): string[] {
  const result = runOptionalGit(
    gitRunner,
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/codex"],
    scope.repositoryPath,
  );
  if (!result) {
    return [];
  }

  return uniqueStrings(
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((branch) => branch.startsWith(scope.branchPrefix)),
  );
}

function isGitWorktree(worktreePath: string, gitRunner: GitRunner): boolean {
  return gitExitCode(
    gitRunner,
    ["rev-parse", "--is-inside-work-tree"],
    worktreePath,
  ) === 0;
}

function currentBranch(worktreePath: string, gitRunner: GitRunner): string | null {
  return gitOutput(gitRunner, ["symbolic-ref", "--short", "HEAD"], worktreePath);
}

function pathMatchesLeaseWorktree(
  projectRoot: string,
  projectWorktreesRoot: string,
  component: ResolvedNexusProjectComponent | null,
  lease: NexusWorktreeLeaseRecord,
  worktreePath: string,
): boolean {
  const absolute = leaseWorktreePath(projectRoot, projectWorktreesRoot, component, lease);
  return absolute
    ? canonicalPath(absolute) === canonicalPath(worktreePath)
    : false;
}

function leaseWorktreePath(
  projectRoot: string,
  projectWorktreesRoot: string,
  component: ResolvedNexusProjectComponent | null,
  lease: NexusWorktreeLeaseRecord,
): string | null {
  if (!lease.worktree.relativePath) {
    return null;
  }
  if (lease.worktree.base === "projectRoot") {
    return path.join(projectRoot, lease.worktree.relativePath);
  }
  if (lease.worktree.base === "projectWorktreesRoot") {
    return path.join(projectWorktreesRoot, lease.worktree.relativePath);
  }
  if (lease.worktree.base === "componentWorktreesRoot" && component) {
    return path.join(component.worktreesRoot, lease.worktree.relativePath);
  }
  if (lease.worktree.base === "componentSourceRoot" && component) {
    return path.join(component.sourceRoot, lease.worktree.relativePath);
  }

  return null;
}

function leaseSummary(
  lease: NexusWorktreeLeaseRecord,
  stale: boolean,
): NexusCleanupLeaseSummary {
  return {
    id: lease.id,
    status: lease.status,
    effectiveStatus: stale ? "stale" : lease.status,
    stale,
    workItemId: lease.workItemId,
    branchName: lease.branchName,
    lastObservedHeadCommit: lease.lastObservedHeadCommit,
    lastSeenAt: lease.lastSeenAt,
    notes: lease.notes,
  };
}

function isTerminalWorkflowStatus(status: NexusGitWorkflowRunStatus): boolean {
  return status === "completed" ||
    status === "aborted" ||
    status === "abandoned" ||
    status === "archived" ||
    status === "rescued" ||
    status === "merged";
}

function ownerLabel(owner: NexusGitWorkflowRunOwner): string {
  return owner.id ? `${owner.kind} ${owner.id}` : owner.kind;
}

function cleanStatusFacts(statusFacts: {
  stagedCount: number | null;
  unstagedCount: number | null;
  untrackedCount: number | null;
}): boolean {
  return (statusFacts.stagedCount ?? 0) === 0 &&
    (statusFacts.unstagedCount ?? 0) === 0 &&
    (statusFacts.untrackedCount ?? 0) === 0;
}

function leaseIsStale(
  lease: NexusWorktreeLeaseRecord,
  now: string,
  staleAfterMs: number,
): boolean {
  if (lease.status === "merged" || lease.status === "abandoned") {
    return false;
  }
  const lastSeen = Date.parse(lease.lastSeenAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(lastSeen) &&
    Number.isFinite(nowMs) &&
    nowMs - lastSeen > staleAfterMs;
}

function uniqueCleanupCandidates(
  candidates: NexusCleanupCandidate[],
): NexusCleanupCandidate[] {
  const seen = new Set<string>();
  const result: NexusCleanupCandidate[] = [];
  for (const candidate of candidates) {
    const worktreePath = candidate.worktreePath
      ? canonicalPath(candidate.worktreePath)
      : "";
    const branch = candidate.kind === "branch" ? candidate.branch ?? "" : "";
    const key = [
      candidate.kind,
      candidate.scope,
      candidate.componentId ?? "",
      worktreePath,
      branch,
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

function cleanupCandidateId(candidate: RawCleanupCandidate): string {
  const subject = candidate.kind === "worktree"
    ? worktreeCandidateSlug(candidate.worktreePath) ?? candidate.branch ?? "unknown"
    : candidate.branch ?? "unknown";

  return [
    candidate.scope,
    candidate.componentId ?? "project",
    candidate.kind,
    subject,
  ].join(":");
}

function worktreeCandidateSlug(worktreePath: string | null): string | null {
  if (!worktreePath) {
    return null;
  }
  const normalized = path.normalize(worktreePath);
  const basename = path.basename(normalized);
  if (basename) {
    return basename;
  }

  return canonicalPath(worktreePath).replace(/[^a-z0-9._-]+/giu, "-");
}

function scopeLabel(scope: CleanupScope): string {
  return scope.scope === "project_meta"
    ? "workspace meta worktrees"
    : `component ${scope.component?.id ?? "unknown"}`;
}

function gitOutput(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  const result = runOptionalGit(gitRunner, args, cwd);
  return result ? result.stdout.trim() || null : null;
}

function gitExitCode(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): number | null {
  return gitRunner(args, cwd).exitCode;
}

function runOptionalGit(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  const result = gitRunner(args, cwd);
  return result.exitCode === 0 ? result : null;
}

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function canonicalPath(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function currentTimestamp(value: Date | string | (() => Date | string) | undefined): string {
  const resolved = typeof value === "function" ? value() : value;
  if (resolved instanceof Date) {
    return resolved.toISOString();
  }
  return resolved ?? new Date().toISOString();
}

function requiredNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return trimmed;
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}
