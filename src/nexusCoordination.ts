import os from "node:os";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";
import {
  loadProjectConfig,
  type NexusProjectWorkTrackerRole,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  createOrRefreshNexusWorktreeLease,
  listNexusWorktreeLeases,
  type NexusWorktreeLeaseCollection,
  type NexusWorktreeLeaseRecord,
} from "./nexusWorktreeLease.js";
import {
  type ResolvedNexusProjectWorkTracker,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  resolveComponentForCurrentPath,
  resolveComponentWorkItemRoute,
  throwWorkItemLookupFailure,
} from "./nexusWorkItemRouting.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "./workItemService.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  type WorkItemTrackerReference,
} from "./workItemTrackerLinks.js";
import {
  LocalWorkTrackerProviderError,
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
  type LocalWorkTrackingStoreDiagnostic,
} from "./workTrackingLocalProvider.js";
import type {
  ExternalRef,
  LocalWorkTrackingConfig,
  WorkComment,
  WorkItem,
} from "./workTrackingTypes.js";

export const coordinationHandoffCommentMarker = "DevNexus coordination handoff";
export const coordinationHandoffKind = "dev-nexus.coordination.handoff";
export const defaultCoordinationHandoffStaleAfterMs = 24 * 60 * 60 * 1000;

export type NexusCoordinationHandoffStatus =
  | "working"
  | "ready"
  | "blocked"
  | "merged";

export interface NexusCoordinationGitStatus {
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  baseRef: string | null;
  headCommit: string | null;
  dirty: boolean | null;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  ahead: number | null;
  behind: number | null;
  pushed: boolean | null;
  warnings: string[];
}

export interface NexusCoordinationTrackerSummary {
  trackerId: string;
  trackerName: string;
  trackerRoles: string[];
  provider: string;
  default: boolean;
  selection: "explicit_id" | "explicit_role" | "role" | "default";
}

export interface NexusCoordinationWorkItemTrackerReference {
  componentId: string;
  trackerId: string;
  trackerName: string | null;
  provider: string;
  itemId: string;
  itemNumber: number | null;
  itemKey: string | null;
  webUrl: string | null;
  externalRef: ExternalRef | null;
}

export interface NexusCoordinationHandoffRecord {
  kind: typeof coordinationHandoffKind;
  version: 1;
  createdAt: string;
  projectId: string;
  projectRoot: string;
  componentId: string;
  componentName: string;
  workItemId: string;
  logicalItemId: string | null;
  selectedWorkItemRef: NexusCoordinationWorkItemTrackerReference | null;
  coordinationTargetRef: NexusCoordinationWorkItemTrackerReference | null;
  trackerReferences: NexusCoordinationWorkItemTrackerReference[];
  hostId: string;
  agentId: string | null;
  status: NexusCoordinationHandoffStatus;
  leaseId: string | null;
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  baseRef: string | null;
  headCommit: string | null;
  dirty: boolean | null;
  ahead: number | null;
  behind: number | null;
  pushed: boolean | null;
  changedAreas: string[];
  decisions: string[];
  verificationSummary: string | null;
  integrationPreference: string | null;
  note: string | null;
}

export interface NexusCoordinationHandoffSummary
  extends NexusCoordinationHandoffRecord {
  commentId: string | null;
  commentCreatedAt: string | null;
  stale: boolean;
  ageMs: number | null;
}

export interface NexusCoordinationHandoffCollection {
  available: boolean;
  tracker: NexusCoordinationTrackerSummary | null;
  trackerId: string | null;
  provider: string | null;
  records: NexusCoordinationHandoffSummary[];
  diagnostics: NexusCoordinationDiagnostic[];
  warnings: string[];
}

export type NexusCoordinationDiagnosticSeverity = "error" | "warning";

export interface NexusCoordinationDiagnosticBase {
  severity: NexusCoordinationDiagnosticSeverity;
  componentId: string;
  trackerId: string | null;
  provider: string | null;
  storePath: string | null;
  operation: string;
  stage: string;
  workItemId: string | null;
  commentId: string | null;
  recovery: string;
  cause: string;
  message: string;
}

export interface NexusCoordinationTrackerReadDiagnostic
  extends NexusCoordinationDiagnosticBase {
  kind: "coordination_tracker_read_failure";
  severity: "error";
  localStorePath: string | null;
}

export interface NexusCoordinationHandoffCommentDiagnostic
  extends NexusCoordinationDiagnosticBase {
  kind: "coordination_handoff_comment_malformed";
  severity: "warning";
}

export type NexusCoordinationDiagnostic =
  | NexusCoordinationTrackerReadDiagnostic
  | NexusCoordinationHandoffCommentDiagnostic;

export class NexusCoordinationTrackerReadError extends Error {
  readonly diagnostic: NexusCoordinationTrackerReadDiagnostic;

  constructor(
    message: string,
    diagnostic: NexusCoordinationTrackerReadDiagnostic,
    options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = "NexusCoordinationTrackerReadError";
    this.diagnostic = diagnostic;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export type NexusCoordinationIntegrationScope =
  | "work_item"
  | "component"
  | "target_branch";

export type NexusCoordinationMergeStatus =
  | "clean"
  | "conflict"
  | "skipped"
  | "unknown";

export interface NexusCoordinationIntegrationFetchPlan {
  requested: boolean;
  allowed: boolean;
  remote: string | null;
  targetBranch: string | null;
  ran: boolean;
  exitCode: number | null;
  warning: string | null;
}

export interface NexusCoordinationIntegrationBranchMerge {
  status: NexusCoordinationMergeStatus;
  mergeBase: string | null;
  targetCommit: string | null;
  branchCommit: string | null;
  changedFiles: string[];
  conflictFiles: string[];
  messages: string[];
  summary: string;
  rangeDiff: string[];
}

export interface NexusCoordinationIntegrationBranchPlan {
  workItemId: string;
  branch: string;
  status: NexusCoordinationHandoffStatus;
  stale: boolean;
  headCommit: string | null;
  handoff: {
    hostId: string;
    agentId: string | null;
    status: NexusCoordinationHandoffStatus;
    createdAt: string;
    stale: boolean;
    changedAreas: string[];
    decisions: string[];
    verificationSummary: string | null;
    integrationPreference: string | null;
    note: string | null;
  };
  merge: NexusCoordinationIntegrationBranchMerge;
}

export interface NexusCoordinationDecisionConflict {
  kind: "changed_area" | "integration_preference";
  branches: string[];
  changedArea: string | null;
  decisions: string[];
  summary: string;
}

export interface NexusCoordinationSuggestedMergeStep {
  branch: string;
  workItemId: string;
  direction: string;
  reason: string;
}

export interface NexusCoordinationIntegrationPlan {
  project: NexusCoordinationStatus["project"];
  component: NexusCoordinationStatus["component"];
  scope: NexusCoordinationIntegrationScope;
  target: {
    branch: string | null;
    ref: string;
    commit: string | null;
  };
  fetch: NexusCoordinationIntegrationFetchPlan;
  handoffs: {
    available: boolean;
    tracker: NexusCoordinationTrackerSummary | null;
    trackerId: string | null;
    provider: string | null;
    totalCount: number;
    activeCount: number;
    staleCount: number;
    records: NexusCoordinationHandoffSummary[];
    diagnostics: NexusCoordinationDiagnostic[];
    warnings: string[];
  };
  branches: NexusCoordinationIntegrationBranchPlan[];
  decisionConflicts: NexusCoordinationDecisionConflict[];
  suggestedOrder: NexusCoordinationSuggestedMergeStep[];
  nextAction: string;
  warnings: string[];
  mutatesSource: false;
}

export interface NexusCoordinationStatus {
  project: {
    id: string;
    name: string;
    projectRoot: string;
  };
  component: {
    id: string;
    name: string;
    role: string;
    sourceRoot: string;
    worktreesRoot: string;
    workTrackingProvider: string | null;
  };
  workItem: WorkItem | null;
  coordinationTracker: NexusCoordinationTrackerSummary;
  git: NexusCoordinationGitStatus;
  leases: NexusWorktreeLeaseCollection;
  handoffs: NexusCoordinationHandoffCollection;
  nextAction: string;
  blocking: boolean;
  warnings: string[];
}

export interface NexusCoordinationStatusOptions {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  trackerId?: string;
  trackerRole?: string;
  currentPath?: string;
  gitRunner?: GitRunner;
  now?: () => Date | string;
  maxHandoffAgeMs?: number;
  maxLeaseAgeMs?: number;
}

export interface NexusCoordinationHandoffOptions
  extends NexusCoordinationStatusOptions {
  workItemId: string;
  status: NexusCoordinationHandoffStatus;
  hostId?: string;
  agentId?: string;
  changedAreas?: string[];
  decisions?: string[];
  verificationSummary?: string | null;
  integrationPreference?: string | null;
  note?: string | null;
}

export interface NexusCoordinationIntegrationOptions
  extends NexusCoordinationStatusOptions {
  targetBranch?: string;
  fetch?: boolean;
}

export interface NexusCoordinationHandoffResult {
  project: NexusCoordinationStatus["project"];
  component: NexusCoordinationStatus["component"];
  record: NexusCoordinationHandoffRecord;
  comment: WorkComment;
  git: NexusCoordinationGitStatus;
  lease: NexusWorktreeLeaseRecord;
}

interface ResolvedCoordinationContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  workItemId?: string;
  currentPath: string;
}

interface ResolvedCoordinationTracker {
  tracker: ResolvedNexusProjectWorkTracker;
  summary: NexusCoordinationTrackerSummary;
}

const handoffStatuses = new Set<NexusCoordinationHandoffStatus>([
  "working",
  "ready",
  "blocked",
  "merged",
]);

export async function getNexusCoordinationStatus(
  options: NexusCoordinationStatusOptions,
): Promise<NexusCoordinationStatus> {
  const context = resolveCoordinationContext(options);
  const coordinationTracker = resolveCoordinationTracker(context, {
    trackerId: options.trackerId,
    trackerRole: options.trackerRole,
    preferredRoles: ["coordination"],
  });
  const git = getCoordinationGitStatus(context, options.gitRunner);
  const workItemId = context.workItemId;
  const workItem = workItemId
    ? await getCoordinationWorkItem(context, workItemId, options.now)
    : null;
  const now = currentTimestamp(options.now);
  const linkReferences = workItemId
    ? workItemTrackerReferencesForLogicalItem(context, workItemId, now)
    : [];
  const target = workItemId
    ? coordinationTargetForWorkItem({
        context,
        logicalItemId: workItemId,
        workItem,
        tracker: coordinationTracker.tracker,
        linkReferences,
        requireLinkedTarget: false,
      })
    : null;
  const handoffs = readCoordinationHandoffs({
    context,
    tracker: coordinationTracker,
    logicalItemId: workItemId,
    targetWorkItemId: target?.itemId ?? null,
    missingTargetWarning: target?.warning ?? null,
    now,
    maxHandoffAgeMs:
      options.maxHandoffAgeMs ?? defaultCoordinationHandoffStaleAfterMs,
  });
  const leases = listNexusWorktreeLeases({
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    workItemId,
    now,
    staleAfterMs: options.maxLeaseAgeMs,
  });
  const warnings = [...git.warnings, ...handoffs.warnings, ...leases.warnings];

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    workItem,
    coordinationTracker: coordinationTracker.summary,
    git,
    leases,
    handoffs,
    nextAction: coordinationNextAction(git),
    blocking: false,
    warnings,
  };
}

export async function createNexusCoordinationHandoff(
  options: NexusCoordinationHandoffOptions,
): Promise<NexusCoordinationHandoffResult> {
  const context = resolveCoordinationContext(options);
  const coordinationTracker = resolveCoordinationTracker(context, {
    trackerId: options.trackerId,
    trackerRole: options.trackerRole,
    preferredRoles: ["coordination"],
  });
  const status = parseNexusCoordinationHandoffStatus(options.status, "status");
  const git = getCoordinationGitStatus(context, options.gitRunner);
  const timestamp = currentTimestamp(options.now);
  const logicalItemId = requiredNonEmptyString(
    context.workItemId ?? options.workItemId,
    "workItemId",
  );
  const workItem = await getCoordinationWorkItem(context, logicalItemId, options.now);
  const linkReferences = workItemTrackerReferencesForLogicalItem(
    context,
    logicalItemId,
    timestamp,
  );
  const target = coordinationTargetForWorkItem({
    context,
    logicalItemId,
    workItem,
    tracker: coordinationTracker.tracker,
    linkReferences,
    requireLinkedTarget: true,
  });
  if (!target) {
    throw new Error(
      `Coordination handoff cannot target tracker "${coordinationTracker.tracker.id}" for ` +
        `${context.component.id}:${logicalItemId}; link the logical work item to that tracker first.`,
    );
  }
  const hostId = optionalTrimmedString(options.hostId) ?? os.hostname();
  const agentId = optionalTrimmedString(options.agentId) ?? null;
  const lease = createOrRefreshNexusWorktreeLease({
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    hostId,
    agentId,
    workItemId: logicalItemId,
    branchName: git.branch,
    baseRef: git.baseRef,
    worktreePath: git.repositoryPath ?? context.currentPath,
    writeScope: options.changedAreas,
    status,
    notes: coordinationLeaseNotes(options),
    gitFacts: {
      repositoryPath: git.repositoryPath,
      upstream: git.upstream,
      headCommit: git.headCommit,
      dirty: git.dirty,
      stagedCount: git.stagedCount,
      unstagedCount: git.unstagedCount,
      untrackedCount: git.untrackedCount,
      ahead: git.ahead,
      behind: git.behind,
      pushed: git.pushed,
      warnings: git.warnings,
    },
    now: timestamp,
  });
  const record: NexusCoordinationHandoffRecord = {
    kind: coordinationHandoffKind,
    version: 1,
    createdAt: timestamp,
    projectId: context.projectConfig.id,
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    componentName: context.component.name,
    workItemId: logicalItemId,
    logicalItemId,
    selectedWorkItemRef: workItemTrackerReferenceFromWorkItem({
      componentId: context.component.id,
      workItem,
    }),
    coordinationTargetRef: target.reference,
    trackerReferences: coordinationTrackerReferences({
      componentId: context.component.id,
      workItem,
      linkReferences,
    }),
    hostId,
    agentId,
    status,
    leaseId: lease.id,
    repositoryPath: git.repositoryPath,
    branch: git.branch,
    upstream: git.upstream,
    baseRef: git.baseRef,
    headCommit: git.headCommit,
    dirty: git.dirty,
    ahead: git.ahead,
    behind: git.behind,
    pushed: git.pushed,
    changedAreas: normalizedStringArray(options.changedAreas, "changedAreas"),
    decisions: normalizedStringArray(options.decisions, "decisions"),
    verificationSummary:
      optionalNullableTrimmedString(options.verificationSummary) ?? null,
    integrationPreference:
      optionalNullableTrimmedString(options.integrationPreference) ?? null,
    note: optionalNullableTrimmedString(options.note) ?? null,
  };
  let comment: WorkComment;
  try {
    comment = await workItemServiceForContext(context, options.now).addComment({
      projectRoot: context.projectRoot,
      componentId: context.component.id,
      trackerId: coordinationTracker.tracker.id,
      ref: { id: target.itemId },
      body: formatCoordinationHandoffComment(record),
    });
  } catch (error) {
    throw new Error(
      `Coordination handoff comment failed for component "${context.component.id}" ` +
        `tracker "${coordinationTracker.tracker.id}" provider ` +
        `"${coordinationTracker.tracker.workTracking.provider}" item "${target.itemId}": ` +
        errorDetail(error),
    );
  }

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    record,
    comment,
    git,
    lease,
  };
}

export async function getNexusCoordinationIntegrationPlan(
  options: NexusCoordinationIntegrationOptions,
): Promise<NexusCoordinationIntegrationPlan> {
  const context = resolveCoordinationContext(options);
  const coordinationTracker = resolveCoordinationTracker(context, {
    trackerId: options.trackerId,
    trackerRole: options.trackerRole,
    preferredRoles: ["coordination"],
  });
  const runner = options.gitRunner ?? defaultGitRunner;
  const now = currentTimestamp(options.now);
  const maxHandoffAgeMs =
    options.maxHandoffAgeMs ?? defaultCoordinationHandoffStaleAfterMs;
  const git = getCoordinationGitStatus(context, runner, {
    repositoryCandidates: integrationRepositoryCandidates(context),
  });
  const workItemId = context.workItemId;
  const workItem = workItemId
    ? await getCoordinationWorkItem(context, workItemId, options.now)
    : null;
  const linkReferences = workItemId
    ? workItemTrackerReferencesForLogicalItem(context, workItemId, now)
    : [];
  const target = workItemId
    ? coordinationTargetForWorkItem({
        context,
        logicalItemId: workItemId,
        workItem,
        tracker: coordinationTracker.tracker,
        linkReferences,
        requireLinkedTarget: false,
      })
    : null;
  const targetBranch = integrationTargetBranch(context, options, git);
  const fetch = maybeFetchIntegrationTarget({
    context,
    repositoryPath: git.repositoryPath,
    runner,
    requested: options.fetch === true,
    targetBranch,
  });
  const targetRef = integrationTargetRef({ fetch, git, targetBranch });
  const handoffCollection = readCoordinationHandoffs({
    context,
    tracker: coordinationTracker,
    logicalItemId: workItemId,
    targetWorkItemId: target?.itemId ?? null,
    missingTargetWarning: target?.warning ?? null,
    now,
    maxHandoffAgeMs,
  });
  const scope: NexusCoordinationIntegrationScope = workItemId
    ? "work_item"
    : options.targetBranch
      ? "target_branch"
      : "component";
  const relatedRecords = relatedIntegrationHandoffs({
    records: handoffCollection.records,
    targetBranch,
    filterByTargetBranch: scope === "target_branch",
  });
  const uniqueRecords = latestHandoffPerBranch(relatedRecords);
  const repositoryPath = git.repositoryPath;
  const targetCommit = repositoryPath
    ? gitStdout(runOptionalGit(runner, ["rev-parse", "--verify", targetRef], repositoryPath))
    : null;
  const branches = uniqueRecords.map((record) =>
    integrationBranchPlan({
      record,
      runner,
      repositoryPath,
      targetRef,
      targetCommit,
    }),
  );
  const decisionConflicts = findDecisionConflicts(branches);
  const suggestedOrder = suggestMergeOrder({
    branches,
    targetRef,
    decisionConflicts,
  });
  const warnings = [
    ...git.warnings,
    ...handoffCollection.warnings,
    ...(fetch.warning ? [fetch.warning] : []),
    ...branches.flatMap((branch) =>
      branch.merge.status === "unknown" ? [branch.merge.summary] : [],
    ),
  ];

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    scope,
    target: {
      branch: targetBranch,
      ref: targetRef,
      commit: targetCommit,
    },
    fetch,
    handoffs: {
      available: handoffCollection.available,
      tracker: handoffCollection.tracker,
      trackerId: handoffCollection.trackerId,
      provider: handoffCollection.provider,
      totalCount: relatedRecords.length,
      activeCount: branches.filter(
        (branch) => !branch.stale && branch.status !== "merged",
      ).length,
      staleCount: relatedRecords.filter((record) => record.stale).length,
      records: relatedRecords,
      diagnostics: handoffCollection.diagnostics,
      warnings: handoffCollection.warnings,
    },
    branches,
    decisionConflicts,
    suggestedOrder,
    nextAction: integrationNextAction(branches, decisionConflicts),
    warnings,
    mutatesSource: false,
  };
}

export function parseNexusCoordinationHandoffStatus(
  value: string,
  pathName: string,
): NexusCoordinationHandoffStatus {
  if (handoffStatuses.has(value as NexusCoordinationHandoffStatus)) {
    return value as NexusCoordinationHandoffStatus;
  }

  throw new Error(`${pathName} must be working, ready, blocked, or merged`);
}

export function nexusCoordinationDiagnosticsFromError(
  error: unknown,
): NexusCoordinationDiagnostic[] {
  if (error instanceof NexusCoordinationTrackerReadError) {
    return [error.diagnostic];
  }

  return [];
}

export function nexusCoordinationErrorPayload(error: unknown): {
  error: string;
  diagnostics?: NexusCoordinationDiagnostic[];
} {
  const diagnostics = nexusCoordinationDiagnosticsFromError(error);
  return {
    error: error instanceof Error ? error.message : String(error),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function formatCoordinationHandoffComment(
  record: NexusCoordinationHandoffRecord,
): string {
  const lines = [
    coordinationHandoffCommentMarker,
    "",
    `Status: ${record.status}`,
    `Host: ${record.hostId}`,
    `Branch: ${record.branch ?? "unknown"}`,
    `Head: ${record.headCommit ?? "unknown"}`,
    "",
    "```json",
    JSON.stringify(record, null, 2),
    "```",
  ];
  return lines.join("\n");
}

function resolveCoordinationContext(
  options: NexusCoordinationStatusOptions,
): ResolvedCoordinationContext {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const currentPath = path.resolve(options.currentPath ?? process.cwd());
  const workItemRoute = options.workItemId
    ? resolveComponentWorkItemRoute({
        projectRoot,
        projectConfig,
        componentId: options.componentId,
        workItemId: options.workItemId,
        currentPath,
      })
    : null;
  const component =
    workItemRoute?.component ??
    resolveComponentForCurrentPath({
      projectRoot,
      projectConfig,
      componentId: options.componentId,
      currentPath,
    });
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    projectRoot,
    projectConfig,
    component,
    ...(workItemRoute ? { workItemId: workItemRoute.itemId } : {}),
    currentPath,
  };
}

function workItemServiceForContext(
  context: ResolvedCoordinationContext,
  now?: () => Date | string,
) {
  return createWorkItemService({
    resolveProject: () => workItemProjectContext(context),
    now,
  });
}

async function getCoordinationWorkItem(
  context: ResolvedCoordinationContext,
  workItemId: string,
  now?: () => Date | string,
): Promise<WorkItem> {
  try {
    return await workItemServiceForContext(context, now).getWorkItem({
      projectRoot: context.projectRoot,
      componentId: context.component.id,
      id: workItemId,
    });
  } catch (error) {
    throwWorkItemLookupFailure({
      component: context.component,
      itemId: workItemId,
      cause: error,
    });
  }
}

function workItemProjectContext(
  context: ResolvedCoordinationContext,
): ResolvedWorkItemProjectContext {
  const workTracking = context.component.workTracking;
  if (!workTracking) {
    throw new Error(`Component ${context.component.id} work tracking is not configured`);
  }

  return {
    homePath: context.projectConfig.home ?? "",
    projectRoot: context.projectRoot,
    projectId: context.projectConfig.id,
    projectName: context.projectConfig.name,
    componentId: context.component.id,
    componentName: context.component.name,
    sourceRoot: context.component.sourceRoot,
    defaultTrackerId: context.component.defaultTrackerId,
    workTrackers: context.component.workTrackers.map((tracker) => ({
      id: tracker.id,
      name: tracker.name,
      enabled: tracker.enabled,
      roles: tracker.roles,
      workTracking: tracker.workTracking,
    })),
    workTracking,
  };
}

function resolveCoordinationTracker(
  context: ResolvedCoordinationContext,
  options: {
    trackerId?: string;
    trackerRole?: string;
    preferredRoles: NexusProjectWorkTrackerRole[];
  },
): ResolvedCoordinationTracker {
  const trackers = context.component.workTrackers.filter((tracker) => tracker.enabled);
  if (trackers.length === 0) {
    throw new Error(`Component ${context.component.id} work tracking is not configured`);
  }

  const explicitTrackerId = optionalTrimmedString(options.trackerId);
  if (explicitTrackerId) {
    const tracker = trackers.find((candidate) => candidate.id === explicitTrackerId);
    if (!tracker) {
      throw new Error(
        `Component "${context.component.id}" coordination tracker is not configured or enabled: ${explicitTrackerId}`,
      );
    }

    return resolvedCoordinationTracker(context, tracker, "explicit_id");
  }

  const explicitRole = optionalTrimmedString(options.trackerRole);
  if (explicitRole) {
    return resolvedCoordinationTrackerByRole(
      context,
      trackers,
      parseNexusCoordinationTrackerRole(explicitRole, "trackerRole"),
      "explicit_role",
    );
  }

  for (const role of options.preferredRoles) {
    const matched = trackers.filter((tracker) => tracker.roles.includes(role));
    if (matched.length === 1) {
      return resolvedCoordinationTracker(context, matched[0]!, "role");
    }
    if (matched.length > 1) {
      throw new Error(
        `Component "${context.component.id}" has multiple enabled coordination trackers with role "${role}": ` +
          matched.map((tracker) => tracker.id).join(", "),
      );
    }
  }

  const defaultTracker =
    trackers.find((tracker) => tracker.id === context.component.defaultTrackerId) ??
    trackers[0]!;
  return resolvedCoordinationTracker(context, defaultTracker, "default");
}

function resolvedCoordinationTrackerByRole(
  context: ResolvedCoordinationContext,
  trackers: ResolvedNexusProjectWorkTracker[],
  role: NexusProjectWorkTrackerRole,
  selection: NexusCoordinationTrackerSummary["selection"],
): ResolvedCoordinationTracker {
  const matched = trackers.filter((tracker) => tracker.roles.includes(role));
  if (matched.length === 0) {
    throw new Error(
      `Component "${context.component.id}" has no enabled work tracker with role "${role}"`,
    );
  }
  if (matched.length > 1) {
    throw new Error(
      `Component "${context.component.id}" has multiple enabled work trackers with role "${role}": ` +
        matched.map((tracker) => tracker.id).join(", "),
    );
  }

  return resolvedCoordinationTracker(context, matched[0]!, selection);
}

function resolvedCoordinationTracker(
  context: ResolvedCoordinationContext,
  tracker: ResolvedNexusProjectWorkTracker,
  selection: NexusCoordinationTrackerSummary["selection"],
): ResolvedCoordinationTracker {
  return {
    tracker,
    summary: {
      trackerId: tracker.id,
      trackerName: tracker.name,
      trackerRoles: tracker.roles,
      provider: tracker.workTracking.provider,
      default: context.component.defaultTrackerId === tracker.id,
      selection,
    },
  };
}

export function parseNexusCoordinationTrackerRole(
  value: string,
  pathName: string,
): NexusProjectWorkTrackerRole {
  if (
    value === "primary" ||
    value === "mirror" ||
    value === "coordination" ||
    value === "planning" ||
    value === "external_feedback" ||
    value === "migration" ||
    value === "archive"
  ) {
    return value;
  }

  throw new Error(
    `${pathName} must be primary, mirror, coordination, planning, external_feedback, migration, or archive`,
  );
}

function workItemTrackerReferencesForLogicalItem(
  context: ResolvedCoordinationContext,
  logicalItemId: string,
  timestamp: string,
): WorkItemTrackerReference[] {
  const store = loadWorkItemTrackerLinkStore(
    defaultWorkItemTrackerLinkStorePath(context.projectRoot),
    timestamp,
  );
  return (
    store.records.find(
      (record) =>
        record.projectId === context.projectConfig.id &&
        record.componentId === context.component.id &&
        record.logicalItemId === logicalItemId,
    )?.references ?? []
  );
}

function coordinationTargetForWorkItem(options: {
  context: ResolvedCoordinationContext;
  logicalItemId: string;
  workItem: WorkItem | null;
  tracker: ResolvedNexusProjectWorkTracker;
  linkReferences: WorkItemTrackerReference[];
  requireLinkedTarget: boolean;
}): {
  itemId: string;
  reference: NexusCoordinationWorkItemTrackerReference;
  warning: string | null;
} | null {
  if (options.context.component.defaultTrackerId === options.tracker.id) {
    const fallbackReference = options.workItem
      ? workItemTrackerReferenceFromWorkItem({
          componentId: options.context.component.id,
          workItem: options.workItem,
        })
      : null;
    return {
      itemId: options.logicalItemId,
      reference:
        fallbackReference ??
        trackerReferenceFromParts({
          componentId: options.context.component.id,
          tracker: options.tracker,
          itemId: options.logicalItemId,
          externalRef: null,
        }),
      warning: null,
    };
  }

  const linked = options.linkReferences.find(
    (reference) => reference.trackerId === options.tracker.id,
  );
  if (linked) {
    return {
      itemId: linked.itemId,
      reference: trackerReferenceFromLink({
        componentId: options.context.component.id,
        reference: linked,
      }),
      warning: null,
    };
  }

  const warning =
    `No tracker reference links logical work item "${options.context.component.id}:${options.logicalItemId}" ` +
    `to coordination tracker "${options.tracker.id}".`;
  if (options.requireLinkedTarget) {
    return null;
  }

  return {
    itemId: "",
    reference: trackerReferenceFromParts({
      componentId: options.context.component.id,
      tracker: options.tracker,
      itemId: "",
      externalRef: null,
    }),
    warning,
  };
}

function coordinationTrackerReferences(options: {
  componentId: string;
  workItem: WorkItem;
  linkReferences: WorkItemTrackerReference[];
}): NexusCoordinationWorkItemTrackerReference[] {
  const references = [
    workItemTrackerReferenceFromWorkItem({
      componentId: options.componentId,
      workItem: options.workItem,
    }),
    ...options.linkReferences.map((reference) =>
      trackerReferenceFromLink({
        componentId: options.componentId,
        reference,
      }),
    ),
  ];
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.trackerId}\u0000${reference.provider}\u0000${reference.itemId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function workItemTrackerReferenceFromWorkItem(options: {
  componentId: string;
  workItem: WorkItem;
}): NexusCoordinationWorkItemTrackerReference {
  const trackerRef = options.workItem.trackerRef;
  const externalRef = options.workItem.externalRef ?? null;
  return {
    componentId: options.componentId,
    trackerId: trackerRef?.trackerId ?? "default",
    trackerName: trackerRef?.trackerName ?? null,
    provider:
      trackerRef?.provider ??
      externalRef?.provider ??
      options.workItem.provider ??
      "unknown",
    itemId: externalRef?.itemId ?? options.workItem.id,
    itemNumber: externalRef?.itemNumber ?? null,
    itemKey: externalRef?.itemKey ?? null,
    webUrl: externalRef?.webUrl ?? options.workItem.webUrl ?? null,
    externalRef,
  };
}

function trackerReferenceFromLink(options: {
  componentId: string;
  reference: WorkItemTrackerReference;
}): NexusCoordinationWorkItemTrackerReference {
  return {
    componentId: options.componentId,
    trackerId: options.reference.trackerId,
    trackerName: options.reference.trackerName ?? null,
    provider: options.reference.provider,
    itemId: options.reference.itemId,
    itemNumber: options.reference.itemNumber ?? null,
    itemKey: options.reference.itemKey ?? null,
    webUrl: options.reference.webUrl ?? null,
    externalRef: {
      provider: options.reference.provider,
      host: options.reference.host,
      repositoryId: options.reference.repositoryId,
      repositoryOwner: options.reference.repositoryOwner,
      repositoryName: options.reference.repositoryName,
      projectId: options.reference.projectId,
      boardId: options.reference.boardId,
      itemId: options.reference.itemId,
      itemNumber: options.reference.itemNumber,
      itemKey: options.reference.itemKey,
      nodeId: options.reference.nodeId,
      webUrl: options.reference.webUrl,
    },
  };
}

function trackerReferenceFromParts(options: {
  componentId: string;
  tracker: ResolvedNexusProjectWorkTracker;
  itemId: string;
  externalRef: ExternalRef | null;
}): NexusCoordinationWorkItemTrackerReference {
  return {
    componentId: options.componentId,
    trackerId: options.tracker.id,
    trackerName: options.tracker.name,
    provider: options.tracker.workTracking.provider,
    itemId: options.externalRef?.itemId ?? options.itemId,
    itemNumber: options.externalRef?.itemNumber ?? null,
    itemKey: options.externalRef?.itemKey ?? null,
    webUrl: options.externalRef?.webUrl ?? null,
    externalRef: options.externalRef,
  };
}

function getCoordinationGitStatus(
  context: ResolvedCoordinationContext,
  gitRunner: GitRunner | undefined,
  options: { repositoryCandidates?: string[] } = {},
): NexusCoordinationGitStatus {
  const runner = gitRunner ?? defaultGitRunner;
  const repositoryPath = findGitRepositoryPath(
    runner,
    options.repositoryCandidates ?? [
      context.currentPath,
      context.component.sourceRoot,
    ],
  );
  const baseRefFallback = context.component.defaultBranch;
  if (!repositoryPath) {
    return {
      repositoryPath: null,
      branch: null,
      upstream: null,
      baseRef: baseRefFallback,
      headCommit: null,
      dirty: null,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      ahead: null,
      behind: null,
      pushed: null,
      warnings: ["No git repository could be resolved for the coordination path."],
    };
  }

  const branch = gitStdout(
    runOptionalGit(runner, ["symbolic-ref", "--short", "HEAD"], repositoryPath),
  );
  const headCommit = gitStdout(
    runOptionalGit(runner, ["rev-parse", "HEAD"], repositoryPath),
  );
  const upstream = gitStdout(
    runOptionalGit(
      runner,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      repositoryPath,
    ),
  );
  const parsedStatus = parsePorcelainStatus(
    gitStdout(runOptionalGit(runner, ["status", "--porcelain=v1"], repositoryPath)) ??
      "",
  );
  const aheadBehind = upstream
    ? parseAheadBehind(
        gitStdout(
          runOptionalGit(
            runner,
            ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            repositoryPath,
          ),
        ),
      )
    : { ahead: null, behind: null };
  const warnings: string[] = [];
  if (!upstream) {
    warnings.push("Current branch has no upstream configured.");
  }

  return {
    repositoryPath,
    branch,
    upstream,
    baseRef: upstream ?? baseRefFallback,
    headCommit,
    dirty: parsedStatus.dirty,
    stagedCount: parsedStatus.stagedCount,
    unstagedCount: parsedStatus.unstagedCount,
    untrackedCount: parsedStatus.untrackedCount,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    pushed: upstream && aheadBehind.ahead !== null ? aheadBehind.ahead === 0 : null,
    warnings,
  };
}

function integrationRepositoryCandidates(
  context: ResolvedCoordinationContext,
): string[] {
  return [context.component.sourceRoot, context.currentPath];
}

function integrationTargetBranch(
  context: ResolvedCoordinationContext,
  options: NexusCoordinationIntegrationOptions,
  git: NexusCoordinationGitStatus,
): string | null {
  return (
    optionalTrimmedString(options.targetBranch) ??
    context.component.publication?.targetBranch ??
    context.projectConfig.automation?.publication.targetBranch ??
    context.component.defaultBranch ??
    git.baseRef
  );
}

function integrationTargetRef(options: {
  fetch: NexusCoordinationIntegrationFetchPlan;
  git: NexusCoordinationGitStatus;
  targetBranch: string | null;
}): string {
  if (
    options.fetch.ran &&
    options.fetch.exitCode === 0 &&
    options.fetch.remote &&
    options.targetBranch
  ) {
    return `${options.fetch.remote}/${options.targetBranch}`;
  }

  return options.targetBranch ?? options.git.baseRef ?? "HEAD";
}

function integrationRemote(context: ResolvedCoordinationContext): string | null {
  return (
    context.component.publication?.remote ??
    context.projectConfig.automation?.publication.remote ??
    null
  );
}

function maybeFetchIntegrationTarget(options: {
  context: ResolvedCoordinationContext;
  repositoryPath: string | null;
  runner: GitRunner;
  requested: boolean;
  targetBranch: string | null;
}): NexusCoordinationIntegrationFetchPlan {
  const remote = integrationRemote(options.context);
  const allowed =
    options.context.projectConfig.automation?.safety.allowHostMutation === true;
  const base: NexusCoordinationIntegrationFetchPlan = {
    requested: options.requested,
    allowed,
    remote,
    targetBranch: options.targetBranch,
    ran: false,
    exitCode: null,
    warning: null,
  };
  if (!options.requested) {
    return base;
  }
  if (!options.repositoryPath) {
    return {
      ...base,
      warning: "Fetch requested but no git repository was resolved.",
    };
  }
  if (!remote) {
    return {
      ...base,
      warning: "Fetch requested but no integration remote is configured.",
    };
  }
  if (!allowed) {
    return {
      ...base,
      warning:
        "Fetch requested but automation safety does not allow host mutation.",
    };
  }

  const result = runGitNoThrow(
    options.runner,
    [
      "fetch",
      "--prune",
      remote,
      ...(options.targetBranch ? [options.targetBranch] : []),
    ],
    options.repositoryPath,
  );

  return {
    ...base,
    ran: true,
    exitCode: result?.exitCode ?? null,
    warning:
      result && result.exitCode !== 0
        ? conciseGitFailure("Fetch failed", result)
        : null,
  };
}

function relatedIntegrationHandoffs(options: {
  records: NexusCoordinationHandoffSummary[];
  targetBranch: string | null;
  filterByTargetBranch: boolean;
}): NexusCoordinationHandoffSummary[] {
  if (!options.filterByTargetBranch || !options.targetBranch) {
    return options.records;
  }

  return options.records.filter((record) =>
    handoffTargetsBranch(record, options.targetBranch!),
  );
}

function handoffTargetsBranch(
  record: NexusCoordinationHandoffSummary,
  targetBranch: string,
): boolean {
  const normalizedTarget = normalizedBranchTail(targetBranch);
  const candidates = [
    record.baseRef,
    record.upstream,
    record.integrationPreference,
  ].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) {
    return true;
  }

  return candidates.some((candidate) =>
    normalizedBranchTail(candidate).endsWith(normalizedTarget),
  );
}

function normalizedBranchTail(value: string): string {
  return value
    .trim()
    .replace(/^refs\/heads\//u, "")
    .replace(/^refs\/remotes\//u, "")
    .replace(/^origin\//u, "");
}

function latestHandoffPerBranch(
  records: NexusCoordinationHandoffSummary[],
): NexusCoordinationHandoffSummary[] {
  const byBranch = new Map<string, NexusCoordinationHandoffSummary>();
  for (const record of records) {
    const branch = optionalTrimmedString(record.branch ?? undefined);
    if (!branch || byBranch.has(branch)) {
      continue;
    }
    byBranch.set(branch, record);
  }

  return [...byBranch.values()];
}

function integrationBranchPlan(options: {
  record: NexusCoordinationHandoffSummary;
  runner: GitRunner;
  repositoryPath: string | null;
  targetRef: string;
  targetCommit: string | null;
}): NexusCoordinationIntegrationBranchPlan {
  const branch = options.record.branch!;
  const skipReason = skippedMergeReason(options.record, options.repositoryPath);
  const merge = skipReason
    ? skippedMerge(skipReason)
    : analyzeBranchMerge({
        runner: options.runner,
        repositoryPath: options.repositoryPath!,
        targetRef: options.targetRef,
        targetCommit: options.targetCommit,
        branch,
      });

  return {
    workItemId: options.record.workItemId,
    branch,
    status: options.record.status,
    stale: options.record.stale,
    headCommit: options.record.headCommit,
    handoff: {
      hostId: options.record.hostId,
      agentId: options.record.agentId,
      status: options.record.status,
      createdAt: options.record.createdAt,
      stale: options.record.stale,
      changedAreas: options.record.changedAreas,
      decisions: options.record.decisions,
      verificationSummary: options.record.verificationSummary,
      integrationPreference: options.record.integrationPreference,
      note: options.record.note,
    },
    merge,
  };
}

function skippedMergeReason(
  record: NexusCoordinationHandoffSummary,
  repositoryPath: string | null,
): string | null {
  if (!repositoryPath) {
    return "No git repository was resolved for integration planning.";
  }
  if (record.stale) {
    return "Skipped stale handoff; refresh the handoff before integration.";
  }
  if (record.status === "merged") {
    return "Skipped merged handoff.";
  }

  return null;
}

function skippedMerge(summary: string): NexusCoordinationIntegrationBranchMerge {
  return {
    status: "skipped",
    mergeBase: null,
    targetCommit: null,
    branchCommit: null,
    changedFiles: [],
    conflictFiles: [],
    messages: [summary],
    summary,
    rangeDiff: [],
  };
}

function analyzeBranchMerge(options: {
  runner: GitRunner;
  repositoryPath: string;
  targetRef: string;
  targetCommit: string | null;
  branch: string;
}): NexusCoordinationIntegrationBranchMerge {
  const branchCommit = gitStdout(
    runOptionalGit(
      options.runner,
      ["rev-parse", "--verify", options.branch],
      options.repositoryPath,
    ),
  );
  const mergeBase = gitStdout(
    runOptionalGit(
      options.runner,
      ["merge-base", options.targetRef, options.branch],
      options.repositoryPath,
    ),
  );
  const changedFiles = uniqueSortedStrings(
    linesFromGitResult(
      runOptionalGit(
        options.runner,
        ["diff", "--name-only", `${options.targetRef}...${options.branch}`],
        options.repositoryPath,
      ),
    ),
  );
  const quietMerge = runGitNoThrow(
    options.runner,
    ["merge-tree", "--write-tree", "--quiet", options.targetRef, options.branch],
    options.repositoryPath,
  );
  const detailMerge = runGitNoThrow(
    options.runner,
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--messages",
      options.targetRef,
      options.branch,
    ],
    options.repositoryPath,
  );
  const mergeStatus = mergeStatusFromResult(quietMerge);
  const messages = conciseMergeMessages(detailMerge);
  const conflictFiles =
    mergeStatus === "conflict"
      ? uniqueSortedStrings([
          ...mergeTreeConflictFiles(detailMerge),
          ...conflictFilesFromMessages(messages),
        ])
      : [];
  const rangeDiff = mergeBase
    ? conciseOutputLines(
        runGitNoThrow(
          options.runner,
          [
            "range-diff",
            `${mergeBase}..${options.targetRef}`,
            `${mergeBase}..${options.branch}`,
          ],
          options.repositoryPath,
        ),
      )
    : [];

  return {
    status: mergeStatus,
    mergeBase,
    targetCommit: options.targetCommit,
    branchCommit,
    changedFiles,
    conflictFiles,
    messages,
    summary: mergeSummary({
      status: mergeStatus,
      branch: options.branch,
      targetRef: options.targetRef,
      changedFiles,
      conflictFiles,
    }),
    rangeDiff,
  };
}

function mergeStatusFromResult(
  result: GitCommandResult | null,
): NexusCoordinationMergeStatus {
  if (!result) {
    return "unknown";
  }
  if (result.exitCode === 0) {
    return "clean";
  }
  if (result.exitCode === 1) {
    return "conflict";
  }

  return "unknown";
}

function mergeSummary(options: {
  status: NexusCoordinationMergeStatus;
  branch: string;
  targetRef: string;
  changedFiles: string[];
  conflictFiles: string[];
}): string {
  if (options.status === "clean") {
    return `${options.branch} merges cleanly into ${options.targetRef} with ${options.changedFiles.length} changed file(s).`;
  }
  if (options.status === "conflict") {
    const files = options.conflictFiles.length > 0
      ? options.conflictFiles.join(", ")
      : "unknown files";
    return `${options.branch} has textual conflicts against ${options.targetRef}: ${files}.`;
  }
  if (options.status === "skipped") {
    return "Merge analysis skipped.";
  }

  return `Merge analysis for ${options.branch} against ${options.targetRef} is unknown.`;
}

function runGitNoThrow(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  try {
    return gitRunner(args, cwd);
  } catch {
    return null;
  }
}

function linesFromGitResult(result: GitCommandResult | null): string[] {
  return result?.stdout ? nonEmptyLines(result.stdout) : [];
}

function conciseMergeMessages(result: GitCommandResult | null): string[] {
  const lines = [
    ...nonEmptyLines(result?.stdout ?? ""),
    ...nonEmptyLines(result?.stderr ?? ""),
  ].filter((line) => !/^[0-9a-f]{40}$/iu.test(line));
  return conciseLines(lines.filter((line) => !looksLikeMergeTreePathLine(line)));
}

function conciseOutputLines(result: GitCommandResult | null): string[] {
  if (!result || (result.exitCode !== 0 && !result.stdout.trim())) {
    return [];
  }

  return conciseLines(nonEmptyLines(result.stdout));
}

function conciseLines(lines: string[]): string[] {
  return lines.slice(0, 8).map((line) =>
    line.length > 140 ? `${line.slice(0, 137)}...` : line,
  );
}

function mergeTreeConflictFiles(result: GitCommandResult | null): string[] {
  if (!result?.stdout) {
    return [];
  }
  const files: string[] = [];
  const lines = nonEmptyLines(result.stdout);
  for (const line of lines) {
    if (/^[0-9a-f]{40}$/iu.test(line)) {
      continue;
    }
    if (line.startsWith("Auto-merging ") || line.startsWith("CONFLICT ")) {
      continue;
    }
    if (looksLikeMergeTreePathLine(line)) {
      files.push(line);
    }
  }

  return files;
}

function conflictFilesFromMessages(messages: string[]): string[] {
  const files: string[] = [];
  for (const message of messages) {
    const match = /\bin\s+(.+)$/u.exec(message);
    if (message.startsWith("CONFLICT ") && match?.[1]) {
      files.push(match[1].trim());
    }
  }

  return files;
}

function looksLikeMergeTreePathLine(line: string): boolean {
  return (
    !line.includes(": ") &&
    !line.includes(" ") &&
    !line.startsWith("CONFLICT") &&
    !line.startsWith("Auto-merging") &&
    !/^[0-9a-f]{40}$/iu.test(line)
  );
}

function nonEmptyLines(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function conciseGitFailure(prefix: string, result: GitCommandResult): string {
  const detail = (result.stderr || result.stdout).trim();
  return detail ? `${prefix}: ${detail}` : `${prefix}.`;
}

function findDecisionConflicts(
  branches: NexusCoordinationIntegrationBranchPlan[],
): NexusCoordinationDecisionConflict[] {
  const activeBranches = branches.filter(
    (branch) => !branch.stale && branch.status !== "merged",
  );
  const conflicts: NexusCoordinationDecisionConflict[] = [];
  const conflictsByArea = new Map<string, NexusCoordinationIntegrationBranchPlan[]>();
  for (const branch of activeBranches) {
    const areas = branch.handoff.changedAreas.length > 0
      ? branch.handoff.changedAreas
      : branch.merge.changedFiles;
    for (const area of areas) {
      const existing = conflictsByArea.get(area) ?? [];
      existing.push(branch);
      conflictsByArea.set(area, existing);
    }
  }
  for (const [area, areaBranches] of conflictsByArea) {
    const decisionSets = uniqueSortedStrings(
      areaBranches.flatMap((branch) => branch.handoff.decisions),
    );
    if (areaBranches.length > 1 && decisionSets.length > 1) {
      conflicts.push({
        kind: "changed_area",
        changedArea: area,
        branches: uniqueSortedStrings(areaBranches.map((branch) => branch.branch)),
        decisions: decisionSets,
        summary: `Multiple handoff branches record different decisions for ${area}.`,
      });
    }
  }

  const preferences = new Map<string, NexusCoordinationIntegrationBranchPlan[]>();
  for (const branch of activeBranches) {
    const preference = branch.handoff.integrationPreference;
    if (!preference) {
      continue;
    }
    const group = preferences.get(preference) ?? [];
    group.push(branch);
    preferences.set(preference, group);
  }
  if (preferences.size > 1) {
    conflicts.push({
      kind: "integration_preference",
      changedArea: null,
      branches: uniqueSortedStrings(activeBranches.map((branch) => branch.branch)),
      decisions: uniqueSortedStrings([...preferences.keys()]),
      summary: "Handoff branches record different integration preferences.",
    });
  }

  return conflicts;
}

function suggestMergeOrder(options: {
  branches: NexusCoordinationIntegrationBranchPlan[];
  targetRef: string;
  decisionConflicts: NexusCoordinationDecisionConflict[];
}): NexusCoordinationSuggestedMergeStep[] {
  if (options.decisionConflicts.length > 0) {
    return [];
  }

  return options.branches
    .filter(
      (branch) =>
        !branch.stale &&
        branch.status === "ready" &&
        branch.merge.status === "clean",
    )
    .sort((a, b) => a.handoff.createdAt.localeCompare(b.handoff.createdAt))
    .map((branch) => ({
      branch: branch.branch,
      workItemId: branch.workItemId,
      direction: `${branch.branch} -> ${options.targetRef}`,
      reason: branch.handoff.integrationPreference
        ? `Handoff preference: ${branch.handoff.integrationPreference}`
        : "Ready handoff merges cleanly.",
    }));
}

function integrationNextAction(
  branches: NexusCoordinationIntegrationBranchPlan[],
  decisionConflicts: NexusCoordinationDecisionConflict[],
): string {
  if (decisionConflicts.length > 0) {
    return "Resolve competing handoff decisions before choosing merge order.";
  }
  if (branches.some((branch) => branch.merge.status === "conflict")) {
    return "Resolve textual conflicts before merging affected branches.";
  }
  if (
    branches.some(
      (branch) =>
        !branch.stale &&
        branch.status === "ready" &&
        branch.merge.status === "clean",
    )
  ) {
    return "Merge clean ready handoff branches in the suggested order.";
  }
  if (branches.some((branch) => branch.stale)) {
    return "Refresh stale handoffs before integration.";
  }

  return "No active handoff branches are ready for integration.";
}

function findGitRepositoryPath(
  gitRunner: GitRunner,
  candidates: string[],
): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    const result = runOptionalGit(gitRunner, ["rev-parse", "--show-toplevel"], resolved);
    const repositoryPath = gitStdout(result);
    if (repositoryPath) {
      return path.resolve(repositoryPath);
    }
  }

  return null;
}

function runOptionalGit(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result : null;
  } catch {
    return null;
  }
}

function gitStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout.trim();
  return value ? value : null;
}

function parsePorcelainStatus(output: string): {
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
} {
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  for (const line of output.split(/\r?\n/u)) {
    if (!line) {
      continue;
    }
    if (line.startsWith("??")) {
      untrackedCount += 1;
      continue;
    }

    const staged = line[0];
    const unstaged = line[1];
    if (staged && staged !== " ") {
      stagedCount += 1;
    }
    if (unstaged && unstaged !== " ") {
      unstagedCount += 1;
    }
  }

  return {
    dirty: stagedCount + unstagedCount + untrackedCount > 0,
    stagedCount,
    unstagedCount,
    untrackedCount,
  };
}

function parseAheadBehind(
  output: string | null,
): { ahead: number | null; behind: number | null } {
  if (!output) {
    return { ahead: null, behind: null };
  }
  const [aheadValue, behindValue] = output.split(/\s+/u);
  const ahead = Number(aheadValue);
  const behind = Number(behindValue);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return { ahead: null, behind: null };
  }

  return { ahead, behind };
}

function readCoordinationHandoffs(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  logicalItemId?: string;
  targetWorkItemId: string | null;
  missingTargetWarning: string | null;
  now: string;
  maxHandoffAgeMs: number;
}): NexusCoordinationHandoffCollection {
  const provider = options.tracker.tracker.workTracking.provider;
  if (provider !== "local") {
    return {
      available: false,
      tracker: options.tracker.summary,
      trackerId: options.tracker.tracker.id,
      provider,
      records: [],
      diagnostics: [],
      warnings: [
        `Related handoffs cannot be read from tracker "${options.tracker.tracker.id}" provider "${provider}" because DevNexus core does not expose provider comment reads for coordination records.`,
      ],
    };
  }
  if (options.logicalItemId && options.missingTargetWarning) {
    return {
      available: true,
      tracker: options.tracker.summary,
      trackerId: options.tracker.tracker.id,
      provider,
      records: [],
      diagnostics: [],
      warnings: [options.missingTargetWarning],
    };
  }

  const workTracking = options.tracker.tracker.workTracking as LocalWorkTrackingConfig;
  const storePath = resolveLocalWorkTrackingStorePath(
    options.context.projectRoot,
    workTracking,
  );
  let store: ReturnType<typeof loadLocalWorkTrackingStore>;
  try {
    store = loadLocalWorkTrackingStore(
      storePath,
      undefined,
      "readCoordinationHandoffs",
    );
  } catch (error) {
    const diagnostic = coordinationTrackerReadDiagnostic({
      context: options.context,
      tracker: options.tracker,
      storePath,
      error,
    });
    throw new NexusCoordinationTrackerReadError(
      diagnostic.message,
      diagnostic,
      { cause: error },
    );
  }
  const comments = options.logicalItemId
    ? (store.comments[options.targetWorkItemId ?? ""] ?? []).map((comment) => ({
        workItemId: options.logicalItemId!,
        comment,
      }))
    : Object.entries(store.comments).flatMap(([workItemId, itemComments]) =>
        itemComments.map((comment) => ({ workItemId, comment })),
      );
  const nowMs = Date.parse(options.now);
  const warnings: string[] = [];
  const diagnostics: NexusCoordinationDiagnostic[] = [];
  const records: NexusCoordinationHandoffSummary[] = [];
  for (const { workItemId, comment } of comments) {
    const result = handoffSummaryFromComment({
        comment,
        fallbackWorkItemId: workItemId,
        projectId: options.context.projectConfig.id,
        componentId: options.context.component.id,
        trackerId: options.tracker.tracker.id,
        provider,
        storePath,
        nowMs,
        maxHandoffAgeMs: options.maxHandoffAgeMs,
      });
    if (result.record) {
      records.push(result.record);
    }
    if (result.diagnostic) {
      diagnostics.push(result.diagnostic);
      warnings.push(malformedHandoffWarning(result.diagnostic));
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const record of records) {
    if (record.stale) {
      warnings.push(
        `Handoff for ${record.workItemId} from ${record.createdAt} is stale.`,
      );
    }
  }

  return {
    available: true,
    tracker: options.tracker.summary,
    trackerId: options.tracker.tracker.id,
    provider,
    records,
    diagnostics,
    warnings,
  };
}

function handoffSummaryFromComment(options: {
  comment: WorkComment;
  fallbackWorkItemId: string;
  projectId: string;
  componentId: string;
  trackerId: string | null;
  provider: string | null;
  storePath: string;
  nowMs: number;
  maxHandoffAgeMs: number;
}): {
  record: NexusCoordinationHandoffSummary | null;
  diagnostic: NexusCoordinationHandoffCommentDiagnostic | null;
} {
  const parsed = parseCoordinationHandoffComment(options.comment.body);
  if (!parsed.record) {
    return {
      record: null,
      diagnostic: parsed.diagnostic
        ? coordinationHandoffCommentDiagnostic({
            componentId: options.componentId,
            trackerId: options.trackerId,
            provider: options.provider,
            storePath: options.storePath,
            workItemId: options.fallbackWorkItemId,
            comment: options.comment,
            diagnostic: parsed.diagnostic,
          })
        : null,
    };
  }
  const record = parsed.record;
  if (
    record.projectId !== options.projectId ||
    record.componentId !== options.componentId
  ) {
    return { record: null, diagnostic: null };
  }

  const createdMs = Date.parse(record.createdAt);
  const ageMs =
    Number.isFinite(createdMs) && Number.isFinite(options.nowMs)
      ? Math.max(0, options.nowMs - createdMs)
      : null;

  return {
    record: {
      ...record,
      workItemId: record.workItemId || options.fallbackWorkItemId,
      commentId: options.comment.id ?? null,
      commentCreatedAt: options.comment.createdAt ?? null,
      stale:
        ageMs !== null && options.maxHandoffAgeMs >= 0
          ? ageMs > options.maxHandoffAgeMs
          : false,
      ageMs,
    },
    diagnostic: null,
  };
}

function parseCoordinationHandoffComment(
  body: string,
): {
  record: NexusCoordinationHandoffRecord | null;
  diagnostic: { stage: string; message: string; cause: string } | null;
} {
  if (!body.includes(coordinationHandoffCommentMarker)) {
    return { record: null, diagnostic: null };
  }

  const match = /```json\s*([\s\S]*?)```/u.exec(body);
  if (!match) {
    return {
      record: null,
      diagnostic: {
        stage: "handoff_comment_json_block",
        message:
          "Coordination handoff marker is present but no JSON code block was found.",
        cause: "missing JSON code block",
      },
    };
  }

  try {
    const record = handoffRecordFromUnknown(JSON.parse(match[1]!));
    return record
      ? { record, diagnostic: null }
      : {
          record: null,
          diagnostic: {
            stage: "handoff_comment_record",
            message:
              "Coordination handoff JSON block is not a valid version 1 DevNexus handoff record.",
            cause: "invalid handoff record",
          },
        };
  } catch (error) {
    return {
      record: null,
      diagnostic: {
        stage:
          error instanceof SyntaxError
            ? "handoff_comment_json_parse"
            : "handoff_comment_record",
        message: `Coordination handoff comment could not be parsed: ${errorDetail(error)}`,
        cause: errorDetail(error),
      },
    };
  }
}

function coordinationTrackerReadDiagnostic(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  storePath: string;
  error: unknown;
}): NexusCoordinationTrackerReadDiagnostic {
  const localDiagnostic = localWorkTrackingDiagnostic(options.error);
  const stage = localDiagnostic?.stage ?? "read";
  const operation = localDiagnostic?.operation ?? "readCoordinationHandoffs";
  const storePath = localDiagnostic?.storePath ?? path.resolve(options.storePath);
  const trackerId = options.tracker.tracker.id;
  const provider = options.tracker.tracker.workTracking.provider;
  const componentId = options.context.component.id;
  const message =
    `Coordination handoff read failed for component "${componentId}" ` +
    `tracker "${trackerId ?? "default"}" provider "${provider ?? "unknown"}" ` +
    `at ${storePath} during ${operation} (${stage}).`;

  return {
    kind: "coordination_tracker_read_failure",
    severity: "error",
    componentId,
    trackerId,
    provider,
    storePath,
    localStorePath: provider === "local" ? storePath : null,
    operation,
    stage,
    workItemId: options.context.workItemId ?? null,
    commentId: null,
    recovery:
      localDiagnostic?.recovery ??
      "Repair the configured work tracker state, then retry coordination integrate.",
    cause: localDiagnostic?.cause ?? errorDetail(options.error),
    message,
  };
}

function localWorkTrackingDiagnostic(
  error: unknown,
): LocalWorkTrackingStoreDiagnostic | null {
  if (error instanceof LocalWorkTrackerProviderError) {
    return error.diagnostic ?? null;
  }

  return null;
}

function coordinationHandoffCommentDiagnostic(options: {
  componentId: string;
  trackerId: string | null;
  provider: string | null;
  storePath: string;
  workItemId: string;
  comment: WorkComment;
  diagnostic: { stage: string; message: string; cause: string };
}): NexusCoordinationHandoffCommentDiagnostic {
  return {
    kind: "coordination_handoff_comment_malformed",
    severity: "warning",
    componentId: options.componentId,
    trackerId: options.trackerId,
    provider: options.provider,
    storePath: path.resolve(options.storePath),
    operation: "readCoordinationHandoffs",
    stage: options.diagnostic.stage,
    workItemId: options.workItemId,
    commentId: options.comment.id ?? null,
    recovery:
      "Edit or remove the malformed DevNexus coordination handoff comment; valid handoffs from other comments are still considered.",
    cause: options.diagnostic.cause,
    message: options.diagnostic.message,
  };
}

function malformedHandoffWarning(
  diagnostic: NexusCoordinationHandoffCommentDiagnostic,
): string {
  return (
    `Skipped malformed coordination handoff comment ` +
    `${diagnostic.commentId ?? "unknown"} on ${diagnostic.workItemId ?? "unknown"} ` +
    `for component "${diagnostic.componentId}" during ${diagnostic.stage}: ` +
    diagnostic.message
  );
}

function errorDetail(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function handoffRecordFromUnknown(
  value: unknown,
): NexusCoordinationHandoffRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== coordinationHandoffKind || record.version !== 1) {
    return null;
  }

  return {
    kind: coordinationHandoffKind,
    version: 1,
    createdAt: requiredRecordString(record, "createdAt"),
    projectId: requiredRecordString(record, "projectId"),
    projectRoot: requiredRecordString(record, "projectRoot"),
    componentId: requiredRecordString(record, "componentId"),
    componentName: requiredRecordString(record, "componentName"),
    workItemId: requiredRecordString(record, "workItemId"),
    logicalItemId:
      nullableRecordString(record, "logicalItemId") ??
      requiredRecordString(record, "workItemId"),
    selectedWorkItemRef: nullableRecordTrackerReference(
      record,
      "selectedWorkItemRef",
    ),
    coordinationTargetRef: nullableRecordTrackerReference(
      record,
      "coordinationTargetRef",
    ),
    trackerReferences: recordTrackerReferences(record, "trackerReferences"),
    hostId: requiredRecordString(record, "hostId"),
    agentId: nullableRecordString(record, "agentId"),
    status: parseNexusCoordinationHandoffStatus(
      requiredRecordString(record, "status"),
      "handoff.status",
    ),
    leaseId: nullableRecordString(record, "leaseId"),
    repositoryPath: nullableRecordString(record, "repositoryPath"),
    branch: nullableRecordString(record, "branch"),
    upstream: nullableRecordString(record, "upstream"),
    baseRef: nullableRecordString(record, "baseRef"),
    headCommit: nullableRecordString(record, "headCommit"),
    dirty: nullableRecordBoolean(record, "dirty"),
    ahead: nullableRecordInteger(record, "ahead"),
    behind: nullableRecordInteger(record, "behind"),
    pushed: nullableRecordBoolean(record, "pushed"),
    changedAreas: recordStringArray(record, "changedAreas"),
    decisions: recordStringArray(record, "decisions"),
    verificationSummary: nullableRecordString(record, "verificationSummary"),
    integrationPreference: nullableRecordString(record, "integrationPreference"),
    note: nullableRecordString(record, "note"),
  };
}

function coordinationNextAction(git: NexusCoordinationGitStatus): string {
  if (!git.repositoryPath) {
    return "Open the component source or a git worktree before integration.";
  }
  if (git.dirty) {
    return "Review, commit, or explicitly hand off local changes before integration.";
  }
  if (!git.upstream) {
    return "Push the branch and set upstream, or tell the integration host where to fetch it.";
  }
  if (git.behind !== null && git.behind > 0) {
    return "Rebase or merge upstream before integration.";
  }
  if (git.ahead !== null && git.ahead > 0) {
    return "Push the branch or ask the integration host to fetch it.";
  }

  return "Ready for review or integration.";
}

function coordinationLeaseNotes(
  options: NexusCoordinationHandoffOptions,
): string[] {
  const note = optionalNullableTrimmedString(options.note) ?? null;
  const verification =
    optionalNullableTrimmedString(options.verificationSummary) ?? null;
  const integrationPreference =
    optionalNullableTrimmedString(options.integrationPreference) ?? null;

  return [
    note,
    verification ? `Verification: ${verification}` : null,
    integrationPreference
      ? `Integration preference: ${integrationPreference}`
      : null,
  ].filter((entry): entry is string => entry !== null);
}

function projectSummary(
  context: ResolvedCoordinationContext,
): NexusCoordinationStatus["project"] {
  return {
    id: context.projectConfig.id,
    name: context.projectConfig.name,
    projectRoot: context.projectRoot,
  };
}

function componentSummary(
  component: ResolvedNexusProjectComponent,
): NexusCoordinationStatus["component"] {
  return {
    id: component.id,
    name: component.name,
    role: component.role,
    sourceRoot: component.sourceRoot,
    worktreesRoot: component.worktreesRoot,
    workTrackingProvider: component.workTracking?.provider ?? null,
  };
}

function currentTimestamp(now?: () => Date | string): string {
  const value = now?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizedStringArray(
  values: string[] | undefined,
  pathName: string,
): string[] {
  if (!values) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = requiredNonEmptyString(value, pathName);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableTrimmedString(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return optionalTrimmedString(value) ?? null;
}

function requiredNonEmptyString(value: string, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}

function requiredRecordString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`handoff.${key} must be a non-empty string`);
  }

  return value;
}

function nullableRecordString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`handoff.${key} must be a string or null`);
  }

  return value;
}

function nullableRecordBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`handoff.${key} must be a boolean or null`);
  }

  return value;
}

function nullableRecordInteger(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`handoff.${key} must be an integer or null`);
  }

  return value;
}

function nullableRecordTrackerReference(
  record: Record<string, unknown>,
  key: string,
): NexusCoordinationWorkItemTrackerReference | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  return recordTrackerReference(value, `handoff.${key}`);
}

function recordTrackerReferences(
  record: Record<string, unknown>,
  key: string,
): NexusCoordinationWorkItemTrackerReference[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`handoff.${key} must be an array`);
  }

  return value.map((entry, index) =>
    recordTrackerReference(entry, `handoff.${key}[${index}]`),
  );
}

function recordTrackerReference(
  value: unknown,
  pathName: string,
): NexusCoordinationWorkItemTrackerReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    componentId: recordRequiredString(record, "componentId", pathName),
    trackerId: recordRequiredString(record, "trackerId", pathName),
    trackerName: recordNullableString(record, "trackerName", pathName),
    provider: recordRequiredString(record, "provider", pathName),
    itemId: recordRequiredString(record, "itemId", pathName),
    itemNumber: recordNullableInteger(record, "itemNumber", pathName),
    itemKey: recordNullableString(record, "itemKey", pathName),
    webUrl: recordNullableString(record, "webUrl", pathName),
    externalRef: externalRefFromUnknown(record.externalRef, `${pathName}.externalRef`),
  };
}

function externalRefFromUnknown(value: unknown, pathName: string): ExternalRef | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object or null`);
  }
  const record = value as Record<string, unknown>;
  return {
    provider: recordRequiredString(record, "provider", pathName),
    host: recordNullableString(record, "host", pathName),
    repositoryId: recordNullableString(record, "repositoryId", pathName),
    repositoryOwner: recordNullableString(record, "repositoryOwner", pathName),
    repositoryName: recordNullableString(record, "repositoryName", pathName),
    projectId: recordNullableString(record, "projectId", pathName),
    boardId: recordNullableString(record, "boardId", pathName),
    itemId: recordRequiredString(record, "itemId", pathName),
    itemNumber: recordNullableInteger(record, "itemNumber", pathName),
    itemKey: recordNullableString(record, "itemKey", pathName),
    nodeId: recordNullableString(record, "nodeId", pathName),
    webUrl: recordNullableString(record, "webUrl", pathName),
  };
}

function recordRequiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string`);
  }

  return value;
}

function recordNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${pathName}.${key} must be a string or null`);
  }

  return value;
}

function recordNullableInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${pathName}.${key} must be an integer or null`);
  }

  return value;
}

function recordStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`handoff.${key} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`handoff.${key}[${index}] must be a non-empty string`);
    }

    return entry;
  });
}
