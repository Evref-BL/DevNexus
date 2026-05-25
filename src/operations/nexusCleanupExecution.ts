import path from "node:path";
import {
  resolveNexusEffectiveAuthority,
  unconfiguredNexusAuthorityAllowedResolution,
  type NexusAuthorityConfig,
  type NexusAuthorityAction,
  type NexusEffectiveAuthorityActorInput,
  type NexusEffectiveAuthorityAuthProfileInput,
  type NexusEffectiveAuthorityResolution,
} from "../authority/nexusAuthority.js";
import {
  createGitBranch,
  deleteGitBranch,
  defaultGitRunner,
  removeGitWorktree,
  type GitCommandResult,
  type GitRunner,
} from "../worktrees/gitWorktreeService.js";
import {
  loadProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolveProjectComponents,
} from "../project/nexusProjectLifecycle.js";
import {
  readNexusWorktreeLeaseStore,
  writeNexusWorktreeLeaseStore,
  type NexusWorktreeLeaseStatus,
} from "../worktrees/nexusWorktreeLease.js";
import {
  buildNexusCleanupPlan,
  type BuildNexusCleanupPlanOptions,
  type NexusCleanupCandidate,
  type NexusCleanupClassification,
  type NexusCleanupPlan,
} from "./nexusCleanupPlan.js";

export interface SelectNexusCleanupCandidateOptions
  extends BuildNexusCleanupPlanOptions {
  candidateId: string;
}

export interface ExecuteNexusCleanupOptions
  extends SelectNexusCleanupCandidateOptions {
  deleteBranch?: boolean;
  force?: boolean;
  forceReason?: string | null;
  plannedCandidate?: NexusCleanupCandidate | null;
  allowAlreadyClean?: boolean;
  rescue?: NexusCleanupExecutionRescueOptions | null;
  authority?: NexusCleanupExecutionAuthorityInput | null;
}

export interface NexusCleanupExecutionAuthorityInput {
  authority?: NexusAuthorityConfig;
  actor?: NexusEffectiveAuthorityActorInput | null;
  authProfile?: NexusEffectiveAuthorityAuthProfileInput | null;
}

export type NexusCleanupExecutionRescueOptions =
  | { mode: "none" }
  | {
      mode: "branch";
      branchName: string;
      reason?: string | null;
    }
  | {
      mode: "archive_record";
      summary: string;
      url?: string | null;
    };

export interface NexusCleanupExecutionSkippedAction {
  candidateId: string;
  action: "cleanup" | "worktree_remove" | "branch_delete" | "rescue";
  reason: string;
}

export interface NexusCleanupExecutionRescueResult {
  mode: "none" | "branch" | "archive_record";
  createdBranch: string | null;
  startPoint: string | null;
  archiveRecord: {
    summary: string;
    url: string | null;
  } | null;
  reason: string | null;
}

export interface NexusCleanupExecutionAuthoritySummary {
  worktreeDelete: NexusEffectiveAuthorityResolution | null;
  branchDelete: NexusEffectiveAuthorityResolution | null;
  rescueBranch: NexusEffectiveAuthorityResolution | null;
}

export interface NexusCleanupExecutionProofRecord {
  candidateId: string;
  kind: NexusCleanupCandidate["kind"];
  branch: string | null;
  worktreePath: string | null;
  headCommit: string | null;
  classifications: NexusCleanupClassification[];
  safeToDelete: boolean;
  candidateProof: string[];
  blockers: string[];
  plannedCandidateId: string | null;
}

export interface NexusCleanupExecutionResult {
  project: NexusCleanupPlan["project"];
  candidate: NexusCleanupCandidate;
  forced: boolean;
  forceReason: string | null;
  actions: {
    removedWorktree: string | null;
    deletedBranch: string | null;
    updatedLeaseIds: string[];
    leaseStorePath: string | null;
    skipped: NexusCleanupExecutionSkippedAction[];
  };
  rescue: NexusCleanupExecutionRescueResult;
  authority: NexusCleanupExecutionAuthoritySummary;
  proof: NexusCleanupExecutionProofRecord;
  recoveryGuidance: string[];
  git: {
    commands: GitCommandResult[];
  };
  mutatesSource: true;
}

export class NexusCleanupExecutionError extends Error {
  readonly candidate: NexusCleanupCandidate | null;
  readonly blockers: string[];

  constructor(
    message: string,
    options: {
      candidate?: NexusCleanupCandidate | null;
      blockers?: string[];
    } = {},
  ) {
    super(message);
    this.name = "NexusCleanupExecutionError";
    this.candidate = options.candidate ?? null;
    this.blockers = options.blockers ?? [];
  }
}

interface CleanupRescueExecutionResult {
  result: NexusCleanupExecutionRescueResult;
  gitCommands: GitCommandResult[];
}

export function selectNexusCleanupCandidate(
  options: SelectNexusCleanupCandidateOptions,
): { plan: NexusCleanupPlan; candidate: NexusCleanupCandidate } {
  const candidateId = requiredNonEmptyString(options.candidateId, "candidateId");
  const plan = buildNexusCleanupPlan(options);
  const candidate = plan.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate was not found: ${candidateId}`,
    );
  }

  return { plan, candidate };
}

export function executeNexusCleanup(
  options: ExecuteNexusCleanupOptions,
): NexusCleanupExecutionResult {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const candidateId = requiredNonEmptyString(options.candidateId, "candidateId");
  const plan = buildNexusCleanupPlan({
    ...options,
    projectRoot,
    gitRunner,
  });
  const candidate = plan.candidates.find((entry) => entry.id === candidateId);
  const forced = options.force === true;
  const forceReason = normalizedForceReason(options.forceReason);
  const plannedCandidate = options.plannedCandidate ?? null;
  if (!candidate) {
    if (
      options.allowAlreadyClean === true &&
      plannedCandidate &&
      plannedCandidate.id === candidateId
    ) {
      return alreadyCleanCleanupResult({
        plan,
        candidate: plannedCandidate,
        forced,
        forceReason,
      });
    }
    throw new NexusCleanupExecutionError(
      `Cleanup candidate was not found: ${candidateId}`,
    );
  }
  assertPlannedCandidateFresh(plannedCandidate, candidate);
  const rescueRequest = normalizeRescueRequest(options.rescue);
  assertCleanupAllowed(candidate, {
    forced,
    forceReason,
  });

  const sourceRoot = cleanupSourceRoot(projectRoot, candidate);
  const authority = resolveCleanupExecutionAuthority({
    plan,
    candidate,
    authority: options.authority ?? null,
    deleteBranch: options.deleteBranch !== false,
    rescue: rescueRequest,
  });
  assertCleanupAuthorityAllowed(candidate, authority);
  const commands: GitCommandResult[] = [];
  let removedWorktree: string | null = null;
  let deletedBranch: string | null = null;
  const skipped: NexusCleanupExecutionSkippedAction[] = [];

  const rescueExecution = executeCleanupRescue({
    candidate,
    sourceRoot,
    rescue: rescueRequest,
    gitRunner,
  });
  const rescue = rescueExecution.result;
  commands.push(...rescueExecution.gitCommands);

  if (candidate.kind === "worktree") {
    if (!candidate.worktreePath) {
      throw new NexusCleanupExecutionError(
        `Cleanup candidate ${candidate.id} does not include a worktree path.`,
        { candidate },
      );
    }
    const removed = removeGitWorktree({
      sourceRoot,
      worktreePath: candidate.worktreePath,
      force: forced,
      gitRunner,
    });
    commands.push(...removed.git.commands);
    removedWorktree = removed.worktreePath;
  }

  if (
    options.deleteBranch !== false &&
    candidate.branch &&
    candidate.git.headCommit === null
  ) {
    skipped.push({
      candidateId: candidate.id,
      action: "branch_delete",
      reason: "Branch is already absent from the local repository.",
    });
  } else if (options.deleteBranch !== false && candidate.branch) {
    const deleted = deleteGitBranch({
      sourceRoot,
      branchName: candidate.branch,
      force: forced,
      gitRunner,
    });
    commands.push(...deleted.git.commands);
    deletedBranch = deleted.branchName;
  }

  const leaseUpdate = updateCleanupLeases({
    projectRoot,
    candidate,
    forced,
    forceReason,
    rescue,
    now: options.now,
  });

  return {
    project: plan.project,
    candidate,
    forced,
    forceReason,
    actions: {
      removedWorktree,
      deletedBranch,
      updatedLeaseIds: leaseUpdate.updatedLeaseIds,
      leaseStorePath: leaseUpdate.leaseStorePath,
      skipped,
    },
    rescue,
    authority,
    proof: cleanupExecutionProof(candidate, plannedCandidate),
    recoveryGuidance: cleanupRecoveryGuidance(candidate, rescue),
    git: {
      commands,
    },
    mutatesSource: true,
  };
}

function alreadyCleanCleanupResult(options: {
  plan: NexusCleanupPlan;
  candidate: NexusCleanupCandidate;
  forced: boolean;
  forceReason: string | null;
}): NexusCleanupExecutionResult {
  return {
    project: options.plan.project,
    candidate: options.candidate,
    forced: options.forced,
    forceReason: options.forceReason,
    actions: {
      removedWorktree: null,
      deletedBranch: null,
      updatedLeaseIds: [],
      leaseStorePath: null,
      skipped: [
        {
          candidateId: options.candidate.id,
          action: "cleanup",
          reason: "Candidate is absent from the recomputed cleanup plan.",
        },
      ],
    },
    rescue: noCleanupRescueResult(null),
    authority: {
      worktreeDelete: null,
      branchDelete: null,
      rescueBranch: null,
    },
    proof: cleanupExecutionProof(options.candidate, options.candidate),
    recoveryGuidance: [
      "No source mutation was needed; the planned candidate is already absent.",
    ],
    git: {
      commands: [],
    },
    mutatesSource: true,
  };
}

function assertPlannedCandidateFresh(
  plannedCandidate: NexusCleanupCandidate | null,
  candidate: NexusCleanupCandidate,
): void {
  if (!plannedCandidate) {
    return;
  }
  const mismatches: string[] = [];
  if (plannedCandidate.id !== candidate.id) {
    mismatches.push(
      `planned candidate ${plannedCandidate.id} does not match recomputed candidate ${candidate.id}`,
    );
  }
  if (plannedCandidate.kind !== candidate.kind) {
    mismatches.push(
      `kind changed from ${plannedCandidate.kind} to ${candidate.kind}`,
    );
  }
  if (plannedCandidate.branch !== candidate.branch) {
    mismatches.push(
      `branch changed from ${plannedCandidate.branch ?? "none"} to ${candidate.branch ?? "none"}`,
    );
  }
  if (plannedCandidate.worktreePath !== candidate.worktreePath) {
    mismatches.push(
      `worktree path changed from ${plannedCandidate.worktreePath ?? "none"} to ${candidate.worktreePath ?? "none"}`,
    );
  }
  if (plannedCandidate.git.headCommit !== candidate.git.headCommit) {
    mismatches.push(
      `head changed from ${plannedCandidate.git.headCommit ?? "unknown"} to ${candidate.git.headCommit ?? "unknown"}`,
    );
  }
  if (plannedCandidate.safeToDelete !== candidate.safeToDelete) {
    mismatches.push(
      `safeToDelete changed from ${String(plannedCandidate.safeToDelete)} to ${String(candidate.safeToDelete)}`,
    );
  }
  if (!sameStringSet(plannedCandidate.classifications, candidate.classifications)) {
    mismatches.push(
      `classifications changed from ${plannedCandidate.classifications.join(",")} to ${candidate.classifications.join(",")}`,
    );
  }
  if (mismatches.length === 0) {
    return;
  }

  throw new NexusCleanupExecutionError(
    `Refusing cleanup for ${candidate.id}: stale cleanup plan (${mismatches.join("; ")}).`,
    { candidate, blockers: mismatches },
  );
}

function normalizeRescueRequest(
  rescue: NexusCleanupExecutionRescueOptions | null | undefined,
): NexusCleanupExecutionRescueOptions {
  if (!rescue || rescue.mode === "none") {
    return { mode: "none" };
  }
  if (rescue.mode === "branch") {
    return {
      mode: "branch",
      branchName: requiredNonEmptyString(rescue.branchName, "rescue.branchName"),
      reason: normalizedForceReason(rescue.reason),
    };
  }

  return {
    mode: "archive_record",
    summary: requiredNonEmptyString(rescue.summary, "rescue.summary"),
    url: normalizedForceReason(rescue.url),
  };
}

function resolveCleanupExecutionAuthority(options: {
  plan: NexusCleanupPlan;
  candidate: NexusCleanupCandidate;
  authority: NexusCleanupExecutionAuthorityInput | null;
  deleteBranch: boolean;
  rescue: NexusCleanupExecutionRescueOptions;
}): NexusCleanupExecutionAuthoritySummary {
  return {
    worktreeDelete: options.candidate.kind === "worktree"
      ? cleanupAuthorityResolution(options, "worktree.delete")
      : null,
    branchDelete: options.deleteBranch && options.candidate.branch
      ? cleanupAuthorityResolution(options, "git.branch.delete")
      : null,
    rescueBranch: options.rescue.mode === "branch"
      ? cleanupAuthorityResolution(options, "git.branch.create")
      : null,
  };
}

function cleanupAuthorityResolution(
  options: {
    plan: NexusCleanupPlan;
    candidate: NexusCleanupCandidate;
    authority: NexusCleanupExecutionAuthorityInput | null;
  },
  requestedAction: NexusAuthorityAction,
): NexusEffectiveAuthorityResolution {
  if (!options.authority) {
    return unconfiguredNexusAuthorityAllowedResolution(requestedAction);
  }

  return resolveNexusEffectiveAuthority({
    authority: options.authority.authority,
    actor: options.authority.actor ?? {},
    authProfile: options.authority.authProfile ?? null,
    project: options.plan.project.id,
    component: options.candidate.componentId,
    repository: options.candidate.git.repositoryPath,
    targetBranch: options.candidate.git.targetBranch,
    requestedAction,
  });
}

function assertCleanupAuthorityAllowed(
  candidate: NexusCleanupCandidate,
  authority: NexusCleanupExecutionAuthoritySummary,
): void {
  const blockers = [
    authority.worktreeDelete,
    authority.branchDelete,
    authority.rescueBranch,
  ]
    .filter((decision): decision is NexusEffectiveAuthorityResolution => {
      return decision !== null && !decision.allowed;
    })
    .map((decision) => decision.explanation);
  if (blockers.length === 0) {
    return;
  }

  throw new NexusCleanupExecutionError(
    `Cleanup candidate ${candidate.id} is blocked by effective authority: ${blockers.join(" ")}`,
    { candidate, blockers },
  );
}

function executeCleanupRescue(options: {
  candidate: NexusCleanupCandidate;
  sourceRoot: string;
  rescue: NexusCleanupExecutionRescueOptions;
  gitRunner: GitRunner;
}): CleanupRescueExecutionResult {
  if (options.rescue.mode === "none") {
    return {
      result: noCleanupRescueResult(null),
      gitCommands: [],
    };
  }
  if (options.rescue.mode === "archive_record") {
    return {
      result: {
        mode: "archive_record",
        createdBranch: null,
        startPoint: null,
        archiveRecord: {
          summary: options.rescue.summary,
          url: options.rescue.url ?? null,
        },
        reason: options.rescue.summary,
      },
      gitCommands: [],
    };
  }

  if (hasUncommittedWork(options.candidate)) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate ${options.candidate.id} has uncommitted work that a rescue branch cannot preserve.`,
      { candidate: options.candidate, blockers: options.candidate.blockers },
    );
  }
  const startPoint = options.candidate.git.headCommit ?? options.candidate.branch;
  if (!startPoint) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate ${options.candidate.id} cannot be rescued because no branch or head commit is known.`,
      { candidate: options.candidate, blockers: options.candidate.blockers },
    );
  }
  const created = createGitBranch({
    sourceRoot: options.sourceRoot,
    branchName: options.rescue.branchName,
    startPoint,
    gitRunner: options.gitRunner,
  });

  return {
    result: {
      mode: "branch",
      createdBranch: created.branchName,
      startPoint: created.startPoint,
      archiveRecord: null,
      reason: options.rescue.reason ?? null,
    },
    gitCommands: created.git.commands,
  };
}

function noCleanupRescueResult(
  reason: string | null,
): NexusCleanupExecutionRescueResult {
  return {
    mode: "none",
    createdBranch: null,
    startPoint: null,
    archiveRecord: null,
    reason,
  };
}

function cleanupExecutionProof(
  candidate: NexusCleanupCandidate,
  plannedCandidate: NexusCleanupCandidate | null,
): NexusCleanupExecutionProofRecord {
  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    branch: candidate.branch,
    worktreePath: candidate.worktreePath,
    headCommit: candidate.git.headCommit,
    classifications: [...candidate.classifications],
    safeToDelete: candidate.safeToDelete,
    candidateProof: [...candidate.proof],
    blockers: [...candidate.blockers],
    plannedCandidateId: plannedCandidate?.id ?? null,
  };
}

function cleanupRecoveryGuidance(
  candidate: NexusCleanupCandidate,
  rescue: NexusCleanupExecutionRescueResult,
): string[] {
  if (rescue.mode === "branch" && rescue.createdBranch) {
    return [
      `Rescue branch ${rescue.createdBranch} points to ${rescue.startPoint ?? "the rescued head"}.`,
      "Recover with git worktree add or git branch from that rescue ref if this cleanup was mistaken.",
    ];
  }
  if (rescue.mode === "archive_record" && rescue.archiveRecord) {
    return [
      `Archive record before cleanup: ${rescue.archiveRecord.summary}`,
    ];
  }
  if (candidate.git.upstream) {
    return [
      `Recover the deleted branch from upstream ${candidate.git.upstream} if needed.`,
    ];
  }
  if (candidate.git.headCommit) {
    return [
      `Recover the branch with git branch <name> ${candidate.git.headCommit} if needed and the commit is still reachable.`,
    ];
  }

  return [
    "No recovery ref is known; inspect Git reflogs promptly if this cleanup was mistaken.",
  ];
}

function assertCleanupAllowed(
  candidate: NexusCleanupCandidate,
  options: {
    forced: boolean;
    forceReason: string | null;
  },
): void {
  if (candidate.safeToDelete) {
    return;
  }
  if (!options.forced) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate ${candidate.id} is not safe to delete.`,
      { candidate, blockers: candidate.blockers },
    );
  }
  if (!options.forceReason) {
    throw new NexusCleanupExecutionError(
      `Forced cleanup for ${candidate.id} requires a force reason.`,
      { candidate, blockers: candidate.blockers },
    );
  }

  const nonForceable = candidate.classifications.filter(
    (classification) => !forceableCleanupClassifications.has(classification),
  );
  if (nonForceable.length > 0) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate ${candidate.id} cannot be force-cleaned: ${nonForceable.join(", ")}.`,
      { candidate, blockers: candidate.blockers },
    );
  }
}

const forceableCleanupClassifications = new Set<NexusCleanupClassification>([
  "abandoned",
  "blocked",
  "dirty",
  "missing_handoff",
  "merged",
  "needs_rescue",
  "safe",
  "stale",
  "superseded",
  "unknown_merge_state",
  "unpushed",
  "workflow_abandoned",
]);

function cleanupSourceRoot(
  projectRoot: string,
  candidate: NexusCleanupCandidate,
): string {
  if (candidate.scope === "project_meta") {
    return projectRoot;
  }
  const componentId = candidate.componentId;
  if (!componentId) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate ${candidate.id} does not include a component id.`,
      { candidate },
    );
  }
  const projectConfig = loadProjectConfig(projectRoot);
  const component = resolveProjectComponents(projectRoot, projectConfig)
    .find((entry) => entry.id === componentId);
  if (!component) {
    throw new NexusCleanupExecutionError(
      `Cleanup candidate ${candidate.id} references unknown component ${componentId}.`,
      { candidate },
    );
  }

  return component.sourceRoot;
}

function updateCleanupLeases(options: {
  projectRoot: string;
  candidate: NexusCleanupCandidate;
  forced: boolean;
  forceReason: string | null;
  rescue: NexusCleanupExecutionRescueResult;
  now: Date | string | (() => Date | string) | undefined;
}): { updatedLeaseIds: string[]; leaseStorePath: string | null } {
  const leaseId = options.candidate.lease?.id;
  if (!leaseId) {
    return { updatedLeaseIds: [], leaseStorePath: null };
  }

  const timestamp = currentTimestamp(options.now);
  const store = readNexusWorktreeLeaseStore(options.projectRoot);
  let changed = false;
  const leases = store.leases.map((lease) => {
    if (lease.id !== leaseId) {
      return lease;
    }
    changed = true;
    const notes = uniqueStrings([
      ...lease.notes,
      `Cleaned up by DevNexus cleanup execution: ${options.candidate.id}.`,
      ...(options.forceReason
        ? [`Forced cleanup reason: ${options.forceReason}`]
        : []),
      ...rescueLeaseNotes(options.rescue),
    ]);
    const status: NexusWorktreeLeaseStatus =
      options.forced && !options.candidate.safeToDelete ? "abandoned" : "merged";

    return {
      ...lease,
      status,
      lastSeenAt: timestamp,
      updatedAt: timestamp,
      lastObservedHeadCommit:
        options.candidate.git.headCommit ?? lease.lastObservedHeadCommit,
      notes,
    };
  });
  if (!changed) {
    return { updatedLeaseIds: [], leaseStorePath: null };
  }

  return {
    updatedLeaseIds: [leaseId],
    leaseStorePath: writeNexusWorktreeLeaseStore(options.projectRoot, {
      version: 1,
      updatedAt: timestamp,
      leases,
    }),
  };
}

function rescueLeaseNotes(
  rescue: NexusCleanupExecutionRescueResult,
): string[] {
  if (rescue.mode === "branch" && rescue.createdBranch) {
    return [
      `Rescue branch before cleanup: ${rescue.createdBranch} at ${rescue.startPoint ?? "unknown"}.`,
    ];
  }
  if (rescue.mode === "archive_record" && rescue.archiveRecord) {
    return [
      `Archive record before cleanup: ${rescue.archiveRecord.summary}`,
    ];
  }

  return [];
}

function hasUncommittedWork(candidate: NexusCleanupCandidate): boolean {
  return (candidate.git.stagedCount ?? 0) > 0 ||
    (candidate.git.unstagedCount ?? 0) > 0 ||
    (candidate.git.untrackedCount ?? 0) > 0;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function normalizedForceReason(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function currentTimestamp(
  value: Date | string | (() => Date | string) | undefined,
): string {
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
