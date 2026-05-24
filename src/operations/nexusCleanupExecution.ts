import path from "node:path";
import {
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
  };
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
  const { plan, candidate } = selectNexusCleanupCandidate({
    ...options,
    projectRoot,
    gitRunner,
  });
  const forced = options.force === true;
  const forceReason = normalizedForceReason(options.forceReason);
  assertCleanupAllowed(candidate, {
    forced,
    forceReason,
  });

  const sourceRoot = cleanupSourceRoot(projectRoot, candidate);
  const commands: GitCommandResult[] = [];
  let removedWorktree: string | null = null;
  let deletedBranch: string | null = null;

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

  if (options.deleteBranch !== false && candidate.branch) {
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
    },
    git: {
      commands,
    },
    mutatesSource: true,
  };
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
