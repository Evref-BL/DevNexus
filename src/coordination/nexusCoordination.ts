import os from "node:os";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "../worktrees/gitWorktreeService.js";
import {
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectWorkTrackerRole,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  NexusAuthorityMutationError,
  nexusAuthorityMutationBlock,
  resolveNexusCurrentAutomationActor,
  resolveNexusEffectiveAuthorityForCurrentActor,
  summarizeNexusAuthorityForComponent,
  unconfiguredNexusAuthorityAllowedResolution,
  type NexusAuthorityAction,
  type NexusAuthorityActionDecisionSummary,
  type NexusAuthorityMutationBlock,
  type NexusAuthorityComponentSummary,
  type NexusEffectiveAuthorityResolution,
} from "../authority/nexusAuthority.js";
import {
  createOrRefreshNexusWorktreeLease,
  listNexusWorktreeLeases,
  type NexusWorktreeLeaseCollection,
  type NexusWorktreeLeaseRecord,
  type NexusWorktreeLeaseSummary,
} from "../worktrees/nexusWorktreeLease.js";
import {
  prepareNexusManualWorktree,
  summarizeNexusManualWorktreeResult,
  type NexusPreparedWorktreeSummary,
} from "../worktrees/nexusManualWorktree.js";
import {
  type ResolvedNexusProjectWorkTracker,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  resolveComponentForCurrentPath,
  resolveComponentWorkItemRoute,
  throwWorkItemLookupFailure,
} from "../work-items/nexusWorkItemRouting.js";
import {
  loadNexusPublicationAuthProfiles,
  resolveNexusPublicationPolicy,
} from "../publication/nexusPublicationPolicy.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "../work-items/workItemService.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  type WorkItemTrackerReference,
} from "../work-items/workItemTrackerLinks.js";
import {
  LocalWorkTrackerProviderError,
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
  type LocalWorkTrackingStoreDiagnostic,
} from "../work-items/workTrackingLocalProvider.js";
import type {
  ExternalRef,
  LocalWorkTrackingConfig,
  WorkComment,
  WorkItem,
} from "../work-items/workTrackingTypes.js";

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
  changedFiles: string[];
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

export interface NexusCoordinationQualityDeltaCounts {
  newFindingCount: number;
  resolvedFindingCount: number;
  touchedNewFindingCount: number;
  touchedResolvedFindingCount: number;
  newCriticalOrBlockerCount: number;
  newBugCount: number;
  newVulnerabilityCount: number;
  newSecurityHotspotCount: number;
  qualityGateRegressed: boolean;
}

export interface NexusCoordinationQualityDeltaFinding {
  source: string | null;
  category: string | null;
  severity: string | null;
  rule: string | null;
  filePath: string | null;
  line: number | null;
  message: string | null;
}

export interface NexusCoordinationQualityDeltaSummary {
  producer: string | null;
  status: string;
  sourcePath: string | null;
  touchedFiles: string[];
  summary: NexusCoordinationQualityDeltaCounts;
  attention: NexusCoordinationQualityDeltaFinding[];
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
  qualityDelta: NexusCoordinationQualityDeltaSummary | null;
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
  capability: NexusCoordinationHandoffCapability;
  tracker: NexusCoordinationTrackerSummary | null;
  trackerId: string | null;
  provider: string | null;
  records: NexusCoordinationHandoffSummary[];
  diagnostics: NexusCoordinationDiagnostic[];
  warnings: string[];
}

export interface NexusCoordinationHandoffCapability {
  read: boolean;
  write: boolean;
  reason: string | null;
  recovery: string | null;
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

export interface NexusCoordinationProviderCapabilityDiagnostic
  extends NexusCoordinationDiagnosticBase {
  kind: "coordination_provider_capability_unavailable";
  severity: "warning" | "error";
  capability: "read_handoffs" | "write_handoffs";
}

export type NexusCoordinationDiagnostic =
  | NexusCoordinationTrackerReadDiagnostic
  | NexusCoordinationHandoffCommentDiagnostic
  | NexusCoordinationProviderCapabilityDiagnostic;

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

export class NexusCoordinationProviderCapabilityError extends Error {
  readonly diagnostic: NexusCoordinationProviderCapabilityDiagnostic;

  constructor(
    message: string,
    diagnostic: NexusCoordinationProviderCapabilityDiagnostic,
  ) {
    super(message);
    this.name = "NexusCoordinationProviderCapabilityError";
    this.diagnostic = diagnostic;
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
    baseRef: string | null;
    changedAreas: string[];
    decisions: string[];
    verificationSummary: string | null;
    integrationPreference: string | null;
    qualityDelta: NexusCoordinationQualityDeltaSummary | null;
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
    capability: NexusCoordinationHandoffCapability;
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
  authority: NexusAuthorityComponentSummary;
  branches: NexusCoordinationIntegrationBranchPlan[];
  decisionConflicts: NexusCoordinationDecisionConflict[];
  suggestedOrder: NexusCoordinationSuggestedMergeStep[];
  nextAction: string;
  warnings: string[];
  mutatesSource: false;
}

export type NexusCoordinationActivityOwnership =
  | "current_host"
  | "other_host"
  | "unknown";

export type NexusCoordinationActivityOverlapGranularity =
  | "none"
  | "component"
  | "package"
  | "file";

export interface NexusCoordinationActivityOverlap {
  likely: boolean;
  granularity: NexusCoordinationActivityOverlapGranularity;
  currentFiles: string[];
  matchedAreas: string[];
}

export interface NexusCoordinationActivityGroup {
  id: string;
  componentId: string | null;
  workItemId: string | null;
  branch: string | null;
  leaseIds: string[];
  handoffCount: number;
  hosts: string[];
  agents: string[];
  statuses: string[];
  changedAreas: string[];
  writeScopes: string[];
  ownership: NexusCoordinationActivityOwnership;
  active: boolean;
  stale: boolean;
  dirty: boolean;
  unpushed: boolean;
  missingUpstream: boolean;
  ahead: number | null;
  behind: number | null;
  overlap: NexusCoordinationActivityOverlap;
  nextAction: string;
}

export interface NexusCoordinationActivityAuthoritySummary {
  missingSummary: boolean;
  read: NexusAuthorityActionDecisionSummary | null;
  handoff: NexusAuthorityActionDecisionSummary | null;
  pushBranch: NexusAuthorityActionDecisionSummary | null;
  integrate: NexusAuthorityActionDecisionSummary | null;
  cleanupWorktree: NexusAuthorityActionDecisionSummary | null;
  cleanupBranch: NexusAuthorityActionDecisionSummary | null;
}

export interface NexusCoordinationActivityStatus {
  groups: NexusCoordinationActivityGroup[];
  activeGroupCount: number;
  staleGroupCount: number;
  overlapCount: number;
  dirtySharedCheckout: boolean;
  dirtyGeneratedWorktree: boolean;
  currentBranch: {
    missingUpstream: boolean;
    unpushed: boolean;
    ahead: number | null;
    behind: number | null;
  };
  authority: NexusCoordinationActivityAuthoritySummary;
  nextAction: string;
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
  authority: NexusAuthorityComponentSummary;
  leases: NexusWorktreeLeaseCollection;
  handoffs: NexusCoordinationHandoffCollection;
  activity: NexusCoordinationActivityStatus;
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

export interface NexusCoordinationStartOptions
  extends NexusCoordinationStatusOptions {
  projectMeta?: boolean;
  topic?: string | null;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string | null;
  dryRun?: boolean;
  hostId?: string | null;
  agentId?: string | null;
  workerAgentProvider?: string | null;
  writeScope?: string[];
  leaseNotes?: string[];
}

export interface NexusCoordinationAdoptedWorktree {
  lease: NexusWorktreeLeaseSummary;
  refreshedLease: NexusWorktreeLeaseRecord | null;
  worktreePath: string;
  branchName: string | null;
  git: NexusCoordinationGitStatus;
}

export interface NexusCoordinationStartResult {
  project: NexusCoordinationStatus["project"];
  component: NexusCoordinationStatus["component"] | null;
  status: NexusCoordinationStatus;
  action: "prepare" | "adopt" | "blocked";
  dryRun: boolean;
  mutatesSource: boolean;
  preparedWorktree: NexusPreparedWorktreeSummary | null;
  adoptedWorktree: NexusCoordinationAdoptedWorktree | null;
  blockedReasons: string[];
  alternatives: string[];
  nextAction: string;
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
  qualityDelta?: unknown;
  qualityDeltaSourcePath?: string | null;
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
  comment: WorkComment | null;
  git: NexusCoordinationGitStatus;
  lease: NexusWorktreeLeaseRecord | null;
  authority: NexusEffectiveAuthorityResolution;
  blockedMutation: NexusAuthorityMutationBlock | null;
}

interface ResolvedCoordinationContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  workItemId?: string;
  currentPath: string;
  currentPathExplicit: boolean;
  componentSelectionExplicit: boolean;
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
  const handoffs = await readCoordinationHandoffs({
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
  const activityLeases = workItemId
    ? listNexusWorktreeLeases({
        projectRoot: context.projectRoot,
        componentId: context.component.id,
        now,
        staleAfterMs: options.maxLeaseAgeMs,
      })
    : leases;
  const authority = coordinationAuthoritySummary(context);
  const activity = coordinationActivityStatus({
    context,
    git,
    leases: activityLeases,
    handoffs,
    authority,
  });
  const warnings = [...git.warnings, ...handoffs.warnings, ...leases.warnings];

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    workItem,
    coordinationTracker: coordinationTracker.summary,
    git,
    authority,
    leases,
    handoffs,
    activity,
    nextAction: coordinationNextAction(git, handoffs),
    blocking: false,
    warnings,
  };
}

export async function startOrAdoptNexusCoordinationWork(
  options: NexusCoordinationStartOptions,
): Promise<NexusCoordinationStartResult> {
  const status = await getNexusCoordinationStatus(options);
  const dryRun = options.dryRun === true;
  const context = resolveCoordinationContext(options);
  const hostId = optionalNullableTrimmedString(options.hostId) ?? os.hostname();
  const workItemId = context.workItemId ?? null;
  const adoption = coordinationAdoptionCandidate({
    context,
    status,
    hostId,
    workItemId,
    gitRunner: options.gitRunner,
  });
  if (adoption.blockedReasons.length > 0) {
    return blockedCoordinationStartResult({
      status,
      projectMeta: options.projectMeta === true,
      reasons: adoption.blockedReasons,
    });
  }
  if (adoption.worktree) {
    if (dryRun) {
      return coordinationStartResult({
        status,
        action: "adopt",
        dryRun,
        adoptedWorktree: {
          ...adoption.worktree,
          refreshedLease: null,
        },
        nextAction: "Adopt the existing owned worktree.",
      });
    }
    const refreshedLease = createOrRefreshNexusWorktreeLease({
      projectRoot: context.projectRoot,
      componentId: adoption.worktree.lease.scope.componentId,
      projectMeta: adoption.worktree.lease.scope.kind === "project_meta",
      hostId,
      agentId: options.agentId,
      workItemId: adoption.worktree.lease.workItemId,
      branchName: adoption.worktree.lease.branchName,
      baseRef: adoption.worktree.lease.baseRef,
      requestedBaseRef: adoption.worktree.lease.requestedBaseRef,
      resolvedBaseCommit: adoption.worktree.lease.resolvedBaseCommit,
      baseRefKind: adoption.worktree.lease.baseRefKind,
      worktreePath: adoption.worktree.worktreePath,
      writeScope: options.writeScope ?? adoption.worktree.lease.writeScope,
      status: "working",
      notes: options.leaseNotes ?? adoption.worktree.lease.notes,
      gitRunner: options.gitRunner,
      now: options.now,
    });
    return coordinationStartResult({
      status,
      action: "adopt",
      dryRun,
      adoptedWorktree: {
        ...adoption.worktree,
        refreshedLease,
      },
      nextAction: `Use existing worktree ${adoption.worktree.worktreePath}.`,
    });
  }

  const blockers = coordinationStartPrepareBlockers(status);
  if (blockers.length > 0) {
    return blockedCoordinationStartResult({
      status,
      projectMeta: options.projectMeta === true,
      reasons: blockers,
    });
  }
  if (dryRun) {
    return coordinationStartResult({
      status,
      action: "prepare",
      dryRun,
      nextAction: "Prepare a new isolated worktree.",
    });
  }

  const prepared = prepareNexusManualWorktree({
    projectRoot: options.projectRoot,
    componentId: options.projectMeta ? undefined : context.component.id,
    projectMeta: options.projectMeta,
    branchName: options.branchName,
    worktreeName: options.worktreeName,
    baseRef: options.baseRef,
    topic: options.topic,
    workItemId,
    workItemTitle: status.workItem?.title ?? null,
    workItemDescription: status.workItem?.description ?? null,
    hostId,
    agentId: options.agentId,
    workerAgentProvider: options.workerAgentProvider,
    writeScope: options.writeScope,
    leaseNotes: options.leaseNotes,
    gitRunner: options.gitRunner,
    now: options.now,
  });

  return coordinationStartResult({
    status,
    action: "prepare",
    dryRun,
    preparedWorktree: summarizeNexusManualWorktreeResult(prepared),
    nextAction: `Use prepared worktree ${prepared.worktree.worktreePath}.`,
  });
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
  assertCoordinationHandoffWriteCapability({
    context,
    tracker: coordinationTracker,
  });
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
  const authority = resolveCoordinationMutationAuthority({
    context,
    tracker: coordinationTracker,
    requestedAction: "coordination.handoff",
  });
  const recordBase: Omit<NexusCoordinationHandoffRecord, "leaseId"> = {
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
    qualityDelta: coordinationQualityDeltaForHandoff(options),
    note: optionalNullableTrimmedString(options.note) ?? null,
  };
  if (!authority.allowed) {
    return {
      project: projectSummary(context),
      component: componentSummary(context.component),
      record: {
        ...recordBase,
        leaseId: null,
      },
      comment: null,
      git,
      lease: null,
      authority,
      blockedMutation: nexusAuthorityMutationBlock(authority),
    };
  }
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
    ...recordBase,
    leaseId: lease.id,
  };
  const comment = await coordinationHandoffPublisher({
    context,
    tracker: coordinationTracker,
  }).publish({
    target,
    record,
    now: options.now,
  });

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    record,
    comment,
    git,
    lease,
    authority,
    blockedMutation: null,
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
  const handoffCollection = await readCoordinationHandoffs({
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
  const baseRefWarnings = handoffDefaultBaseRefWarnings({
    records: handoffCollection.records,
    targetBranch,
    defaultBranch: context.component.defaultBranch,
  });
  const warnings = [
    ...git.warnings,
    ...handoffCollection.warnings,
    ...(fetch.warning ? [fetch.warning] : []),
    ...baseRefWarnings,
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
      capability: handoffCollection.capability,
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
    authority: coordinationAuthoritySummary(context),
    branches,
    decisionConflicts,
    suggestedOrder,
    nextAction: integrationNextAction(
      branches,
      decisionConflicts,
      handoffCollection,
    ),
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
  if (error instanceof NexusCoordinationProviderCapabilityError) {
    return [error.diagnostic];
  }

  return [];
}

export function nexusCoordinationErrorPayload(error: unknown): {
  error: string;
  diagnostics?: NexusCoordinationDiagnostic[];
  blockedMutation?: NexusAuthorityMutationBlock;
} {
  const diagnostics = nexusCoordinationDiagnosticsFromError(error);
  return {
    error: error instanceof Error ? error.message : String(error),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(error instanceof NexusAuthorityMutationError
      ? { blockedMutation: error.block }
      : {}),
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
    ...(record.qualityDelta
      ? ["", formatNexusCoordinationQualityDeltaSummary(record.qualityDelta)]
      : []),
    "",
    "```json",
    JSON.stringify(record, null, 2),
    "```",
  ];
  return lines.join("\n");
}

export function normalizeNexusCoordinationQualityDelta(
  value: unknown,
  sourcePath: string | null = null,
): NexusCoordinationQualityDeltaSummary {
  const record = requiredQualityRecord(value, "qualityDelta");

  return {
    producer:
      qualityNullableString(record, "producer", "qualityDelta") ??
      qualityNullableString(record, "source", "qualityDelta") ??
      qualityNullableString(record, "tool", "qualityDelta"),
    status: qualityString(record, "status", "qualityDelta"),
    sourcePath:
      sourcePath ??
      optionalNullableTrimmedString(
        qualityNullableString(record, "sourcePath", "qualityDelta"),
      ) ??
      null,
    touchedFiles: qualityStringArray(record.touchedFiles, "qualityDelta.touchedFiles"),
    summary: qualityDeltaCounts(record.summary),
    attention: qualityDeltaAttentionFindings(record),
  };
}

export function formatNexusCoordinationQualityDeltaSummary(
  qualityDelta: NexusCoordinationQualityDeltaSummary,
): string {
  const summary = qualityDelta.summary;
  const details = [
    `${summary.newFindingCount} new finding(s)`,
    `${summary.touchedNewFindingCount} on touched file(s)`,
    summary.newCriticalOrBlockerCount > 0
      ? `${summary.newCriticalOrBlockerCount} critical/blocker`
      : null,
    summary.newBugCount > 0 ? `${summary.newBugCount} bug(s)` : null,
    summary.newVulnerabilityCount > 0
      ? `${summary.newVulnerabilityCount} vulnerability issue(s)`
      : null,
    summary.newSecurityHotspotCount > 0
      ? `${summary.newSecurityHotspotCount} security hotspot(s)`
      : null,
    summary.qualityGateRegressed ? "quality gate regressed" : null,
  ].filter((entry): entry is string => entry !== null);

  return `Quality delta: ${qualityDelta.status}; ${details.join("; ")}`;
}

function coordinationQualityDeltaForHandoff(
  options: NexusCoordinationHandoffOptions,
): NexusCoordinationQualityDeltaSummary | null {
  return options.qualityDelta === undefined || options.qualityDelta === null
    ? null
    : normalizeNexusCoordinationQualityDelta(
        options.qualityDelta,
        optionalNullableTrimmedString(options.qualityDeltaSourcePath) ?? null,
      );
}

function resolveCoordinationContext(
  options: NexusCoordinationStatusOptions,
): ResolvedCoordinationContext {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const currentPathExplicit = options.currentPath !== undefined;
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
    currentPathExplicit,
    componentSelectionExplicit:
      optionalTrimmedString(options.componentId) !== undefined ||
      workItemRoute?.qualified === true,
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
    options.repositoryCandidates ?? coordinationRepositoryCandidates(context),
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
      changedFiles: [],
      warnings: coordinationGitResolutionWarnings(context),
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
    gitRawStdout(runOptionalGit(runner, ["status", "--porcelain=v1"], repositoryPath)) ??
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
  const changedFiles = uniqueSortedStrings([
    ...linesFromGitResult(
      runOptionalGit(runner, ["diff", "--name-only", "HEAD"], repositoryPath),
    ),
    ...linesFromGitResult(
      runOptionalGit(
        runner,
        ["ls-files", "--others", "--exclude-standard"],
        repositoryPath,
      ),
    ),
  ]);
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
    changedFiles,
    warnings,
  };
}

function coordinationRepositoryCandidates(
  context: ResolvedCoordinationContext,
): string[] {
  if (!context.currentPathExplicit && context.componentSelectionExplicit) {
    return [context.component.sourceRoot];
  }

  return [context.currentPath, context.component.sourceRoot];
}

function coordinationGitResolutionWarnings(
  context: ResolvedCoordinationContext,
): string[] {
  const warnings = ["No git repository could be resolved for the coordination path."];
  if (!context.currentPathExplicit && context.componentSelectionExplicit) {
    warnings.push(
      `Coordination was scoped to component ${context.component.id} without currentPath; ` +
        `checked component source root ${context.component.sourceRoot}. ` +
        "Pass currentPath to record a generated component worktree or another checkout.",
    );
  }

  return warnings;
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

function handoffDefaultBaseRefWarnings(options: {
  records: NexusCoordinationHandoffSummary[];
  targetBranch: string | null;
  defaultBranch: string | null;
}): string[] {
  if (!options.targetBranch || !options.defaultBranch) {
    return [];
  }
  if (sameBranchTarget(options.targetBranch, options.defaultBranch)) {
    return [];
  }

  return options.records
    .filter(
      (record) =>
        record.status !== "merged" &&
        Boolean(record.branch) &&
        Boolean(record.baseRef) &&
        sameBranchTarget(record.baseRef!, options.defaultBranch!),
    )
    .map(
      (record) =>
        `Handoff branch ${record.branch} was based on default branch ${options.defaultBranch} ` +
        `while integration target is ${options.targetBranch}; prepare worker branches with ` +
        `--base-ref ${options.targetBranch} or a pinned commit.`,
    );
}

function sameBranchTarget(left: string, right: string): boolean {
  const leftTail = normalizedBranchTail(left);
  const rightTail = normalizedBranchTail(right);

  return leftTail === rightTail || leftTail.endsWith(`/${rightTail}`);
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
      baseRef: options.record.baseRef,
      changedAreas: options.record.changedAreas,
      decisions: options.record.decisions,
      verificationSummary: options.record.verificationSummary,
      integrationPreference: options.record.integrationPreference,
      qualityDelta: options.record.qualityDelta,
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
    if (isFortyCharacterHexSha(line)) {
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
    const filePath = conflictMessageFilePath(message);
    if (message.startsWith("CONFLICT ") && filePath) {
      files.push(filePath);
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
    !isFortyCharacterHexSha(line)
  );
}

function conflictMessageFilePath(message: string): string | null {
  let candidate: string | null = null;
  for (let index = 0; index < message.length - 2; index += 1) {
    if (
      message[index] !== "i" ||
      message[index + 1] !== "n" ||
      !isWordBoundaryBefore(message, index) ||
      !isWhitespace(message[index + 2]!)
    ) {
      continue;
    }

    const start = skipWhitespace(message, index + 2);
    const filePath = message.slice(start).trim();
    if (filePath) {
      candidate = filePath;
    }
  }

  return candidate;
}

function isFortyCharacterHexSha(value: string): boolean {
  if (value.length !== 40) {
    return false;
  }

  for (const character of value) {
    if (!isHexCharacter(character)) {
      return false;
    }
  }

  return true;
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
  handoffs: NexusCoordinationHandoffCollection,
): string {
  if (!handoffs.available) {
    return (
      handoffs.capability.recovery ??
      "Coordination handoffs are unavailable; use a local coordination tracker or inspect worktree leases directly."
    );
  }
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

function gitRawStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout;
  return value && value.length > 0 ? value : null;
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

function coordinationHandoffCapability(
  tracker: ResolvedCoordinationTracker,
): NexusCoordinationHandoffCapability {
  const provider = tracker.tracker.workTracking.provider;
  if (provider === "local") {
    return {
      read: true,
      write: true,
      reason: null,
      recovery: null,
    };
  }
  if (provider === "github") {
    return {
      read: true,
      write: true,
      reason: null,
      recovery: null,
    };
  }

  return {
    read: false,
    write: false,
    reason:
      `Provider-backed coordination is incomplete for tracker "${tracker.tracker.id}" ` +
      `provider "${provider}": DevNexus cannot read provider comments back ` +
      "through the work-tracker interface.",
    recovery:
      "Use a local coordination tracker for durable handoffs, or rely on worktree leases and ordinary work-item comments until provider comment reads are implemented.",
  };
}

function assertCoordinationHandoffWriteCapability(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
}): void {
  const capability = coordinationHandoffCapability(options.tracker);
  if (capability.write) {
    return;
  }

  const diagnostic = coordinationProviderCapabilityDiagnostic({
    context: options.context,
    tracker: options.tracker,
    severity: "error",
    capability: "write_handoffs",
    operation: "createCoordinationHandoff",
    stage: "provider_handoff_write_disabled",
  });
  throw new NexusCoordinationProviderCapabilityError(
    diagnostic.message,
    diagnostic,
  );
}

interface CoordinationHandoffPublisher {
  publish(options: {
    target: { itemId: string };
    record: NexusCoordinationHandoffRecord;
    now?: () => Date | string;
  }): Promise<WorkComment | null>;
}

const noopCoordinationHandoffPublisher: CoordinationHandoffPublisher = {
  async publish() {
    return null;
  },
};

function coordinationHandoffPublisher(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
}): CoordinationHandoffPublisher {
  if (options.tracker.tracker.communication.coordinationHandoffs === "silent") {
    return noopCoordinationHandoffPublisher;
  }

  return commentCoordinationHandoffPublisher(options);
}

function commentCoordinationHandoffPublisher(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
}): CoordinationHandoffPublisher {
  return {
    async publish(input) {
      try {
        return await workItemServiceForContext(
          options.context,
          input.now,
        ).addComment({
          projectRoot: options.context.projectRoot,
          componentId: options.context.component.id,
          trackerId: options.tracker.tracker.id,
          ref: { id: input.target.itemId },
          body: formatCoordinationHandoffComment(input.record),
        });
      } catch (error) {
        throw new Error(
          `Coordination handoff comment failed for component "${options.context.component.id}" ` +
            `tracker "${options.tracker.tracker.id}" provider ` +
            `"${options.tracker.tracker.workTracking.provider}" item "${input.target.itemId}": ` +
            errorDetail(error),
        );
      }
    },
  };
}

function coordinationProviderCapabilityDiagnostic(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  severity: NexusCoordinationDiagnosticSeverity;
  capability: NexusCoordinationProviderCapabilityDiagnostic["capability"];
  operation: string;
  stage: string;
}): NexusCoordinationProviderCapabilityDiagnostic {
  const capability = coordinationHandoffCapability(options.tracker);
  const provider = options.tracker.tracker.workTracking.provider;
  const message =
    capability.reason ??
    `Coordination handoff capability ${options.capability} is unavailable for ` +
      `tracker "${options.tracker.tracker.id}" provider "${provider}".`;
  return {
    kind: "coordination_provider_capability_unavailable",
    severity: options.severity,
    componentId: options.context.component.id,
    trackerId: options.tracker.tracker.id,
    provider,
    storePath: null,
    operation: options.operation,
    stage: options.stage,
    workItemId: options.context.workItemId ?? null,
    commentId: null,
    recovery:
      capability.recovery ??
      "Use a local coordination tracker for durable handoffs.",
    cause: `missing ${options.capability}`,
    message,
    capability: options.capability,
  };
}

async function readCoordinationHandoffs(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  logicalItemId?: string;
  targetWorkItemId: string | null;
  missingTargetWarning: string | null;
  now: string;
  maxHandoffAgeMs: number;
}): Promise<NexusCoordinationHandoffCollection> {
  const provider = options.tracker.tracker.workTracking.provider;
  const capability = coordinationHandoffCapability(options.tracker);
  if (!capability.read) {
    const diagnostic = coordinationProviderCapabilityDiagnostic({
      context: options.context,
      tracker: options.tracker,
      severity: "warning",
      capability: "read_handoffs",
      operation: "readCoordinationHandoffs",
      stage: "provider_handoff_read_disabled",
    });
    return {
      available: false,
      capability,
      tracker: options.tracker.summary,
      trackerId: options.tracker.tracker.id,
      provider,
      records: [],
      diagnostics: [diagnostic],
      warnings: [diagnostic.message],
    };
  }
  if (options.logicalItemId && options.missingTargetWarning) {
    return {
      available: true,
      capability,
      tracker: options.tracker.summary,
      trackerId: options.tracker.tracker.id,
      provider,
      records: [],
      diagnostics: [],
      warnings: [options.missingTargetWarning],
    };
  }
  if (provider !== "local") {
    let comments: CoordinationCommentSource[];
    try {
      comments = await readProviderCoordinationComments(options);
    } catch (error) {
      const diagnostic = coordinationTrackerReadDiagnostic({
        context: options.context,
        tracker: options.tracker,
        storePath: null,
        error,
      });
      throw new NexusCoordinationTrackerReadError(
        diagnostic.message,
        diagnostic,
        { cause: error },
      );
    }

    return summarizeCoordinationHandoffComments({
      context: options.context,
      tracker: options.tracker,
      provider,
      capability,
      comments,
      storePath: null,
      now: options.now,
      maxHandoffAgeMs: options.maxHandoffAgeMs,
    });
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

  return summarizeCoordinationHandoffComments({
    context: options.context,
    tracker: options.tracker,
    provider,
    capability,
    comments,
    storePath,
    now: options.now,
    maxHandoffAgeMs: options.maxHandoffAgeMs,
  });
}

interface CoordinationCommentSource {
  workItemId: string;
  comment: WorkComment;
}

async function readProviderCoordinationComments(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  logicalItemId?: string;
  targetWorkItemId: string | null;
}): Promise<CoordinationCommentSource[]> {
  const service = workItemServiceForContext(options.context);
  if (options.logicalItemId && options.targetWorkItemId) {
    const comments = await service.listComments({
      projectRoot: options.context.projectRoot,
      componentId: options.context.component.id,
      trackerId: options.tracker.tracker.id,
      ref: { id: options.targetWorkItemId },
    });
    return comments.map((comment) => ({
      workItemId: options.logicalItemId!,
      comment,
    }));
  }

  const workItems = await service.listWorkItems({
    projectRoot: options.context.projectRoot,
    componentId: options.context.component.id,
    trackerId: options.tracker.tracker.id,
  });
  const commentSets = await Promise.all(
    workItems.map(async (workItem) => {
      const comments = await service.listComments({
        projectRoot: options.context.projectRoot,
        componentId: options.context.component.id,
        trackerId: options.tracker.tracker.id,
        ref: { id: workItem.id },
      });
      return comments.map((comment) => ({
        workItemId: workItem.id,
        comment,
      }));
    }),
  );

  return commentSets.flat();
}

function summarizeCoordinationHandoffComments(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  provider: string;
  capability: NexusCoordinationHandoffCapability;
  comments: CoordinationCommentSource[];
  storePath: string | null;
  now: string;
  maxHandoffAgeMs: number;
}): NexusCoordinationHandoffCollection {
  const nowMs = Date.parse(options.now);
  const warnings: string[] = [];
  const diagnostics: NexusCoordinationDiagnostic[] = [];
  const records: NexusCoordinationHandoffSummary[] = [];
  for (const { workItemId, comment } of options.comments) {
    const result = handoffSummaryFromComment({
      comment,
      fallbackWorkItemId: workItemId,
      projectId: options.context.projectConfig.id,
      componentId: options.context.component.id,
      trackerId: options.tracker.tracker.id,
      provider: options.provider,
      storePath: options.storePath,
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
    capability: options.capability,
    tracker: options.tracker.summary,
    trackerId: options.tracker.tracker.id,
    provider: options.provider,
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
  storePath: string | null;
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

  const jsonBlock = firstJsonCodeBlock(body);
  if (!jsonBlock) {
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
    const record = handoffRecordFromUnknown(JSON.parse(jsonBlock));
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

function firstJsonCodeBlock(body: string): string | null {
  const openingFence = "```json";
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const opening = body.indexOf(openingFence, searchFrom);
    if (opening < 0) {
      return null;
    }

    const afterOpening = opening + openingFence.length;
    if (afterOpening < body.length && !isWhitespace(body[afterOpening]!)) {
      searchFrom = afterOpening;
      continue;
    }

    const contentStart = skipWhitespace(body, afterOpening);
    const closing = body.indexOf("```", contentStart);
    if (closing < 0) {
      return null;
    }

    return body.slice(contentStart, closing);
  }

  return null;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && isWhitespace(value[index]!)) {
    index += 1;
  }

  return index;
}

function isWhitespace(character: string): boolean {
  return character.trim().length === 0;
}

function isWordBoundaryBefore(value: string, index: number): boolean {
  return index === 0 || !isWordCharacter(value[index - 1]!);
}

function isWordCharacter(character: string): boolean {
  return isHexCharacter(character) ||
    (character >= "g" && character <= "z") ||
    (character >= "G" && character <= "Z") ||
    character === "_";
}

function isHexCharacter(character: string): boolean {
  return (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F");
}

function coordinationTrackerReadDiagnostic(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  storePath: string | null;
  error: unknown;
}): NexusCoordinationTrackerReadDiagnostic {
  const localDiagnostic = localWorkTrackingDiagnostic(options.error);
  const stage = localDiagnostic?.stage ?? "read";
  const operation = localDiagnostic?.operation ?? "readCoordinationHandoffs";
  const storePath = localDiagnostic?.storePath
    ? path.resolve(localDiagnostic.storePath)
    : options.storePath
      ? path.resolve(options.storePath)
      : null;
  const trackerId = options.tracker.tracker.id;
  const provider = options.tracker.tracker.workTracking.provider;
  const componentId = options.context.component.id;
  const location = storePath ? `at ${storePath}` : "from provider comments";
  const message =
    `Coordination handoff read failed for component "${componentId}" ` +
    `tracker "${trackerId ?? "default"}" provider "${provider ?? "unknown"}" ` +
    `${location} during ${operation} (${stage}).`;

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
  storePath: string | null;
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
    storePath: options.storePath ? path.resolve(options.storePath) : null,
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
    qualityDelta: nullableRecordQualityDelta(record, "qualityDelta"),
    note: nullableRecordString(record, "note"),
  };
}

function coordinationNextAction(
  git: NexusCoordinationGitStatus,
  handoffs: NexusCoordinationHandoffCollection,
): string {
  if (!handoffs.available) {
    return (
      handoffs.capability.recovery ??
      "Coordination handoffs are unavailable; use a local coordination tracker or inspect worktree leases directly."
    );
  }
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

function coordinationActivityStatus(options: {
  context: ResolvedCoordinationContext;
  git: NexusCoordinationGitStatus;
  leases: NexusWorktreeLeaseCollection;
  handoffs: NexusCoordinationHandoffCollection;
  authority: NexusAuthorityComponentSummary;
}): NexusCoordinationActivityStatus {
  const groups = coordinationActivityGroups(options);
  const activeGroups = groups.filter((group) => group.active);
  const staleGroups = groups.filter((group) => group.stale);
  const overlappingGroups = groups.filter((group) => group.overlap.likely);
  const currentPathKind = coordinationCurrentPathKind(
    options.context,
    options.git.repositoryPath,
  );
  const currentBranch = {
    missingUpstream: Boolean(options.git.branch && !options.git.upstream),
    unpushed: options.git.ahead !== null && options.git.ahead > 0,
    ahead: options.git.ahead,
    behind: options.git.behind,
  };

  return {
    groups,
    activeGroupCount: activeGroups.length,
    staleGroupCount: staleGroups.length,
    overlapCount: overlappingGroups.length,
    dirtySharedCheckout: options.git.dirty === true && currentPathKind === "shared",
    dirtyGeneratedWorktree:
      options.git.dirty === true && currentPathKind === "generated_worktree",
    currentBranch,
    authority: coordinationActivityAuthority(options.authority),
    nextAction: coordinationActivityNextAction({
      git: options.git,
      groups,
      currentPathKind,
    }),
  };
}

function coordinationActivityGroups(options: {
  context: ResolvedCoordinationContext;
  git: NexusCoordinationGitStatus;
  leases: NexusWorktreeLeaseCollection;
  handoffs: NexusCoordinationHandoffCollection;
  authority: NexusAuthorityComponentSummary;
}): NexusCoordinationActivityGroup[] {
  const groups = new Map<string, {
    componentId: string | null;
    workItemId: string | null;
    branch: string | null;
    leases: NexusWorktreeLeaseSummary[];
    handoffs: NexusCoordinationHandoffSummary[];
  }>();

  const ensureGroup = (input: {
    componentId: string | null;
    workItemId: string | null;
    branch: string | null;
    fallbackId: string;
  }) => {
    const id = [
      input.componentId ?? options.context.component.id,
      input.workItemId ?? "no-work-item",
      input.branch ?? input.fallbackId,
    ].join(":");
    const existing = groups.get(id);
    if (existing) {
      return existing;
    }
    const created = {
      componentId: input.componentId,
      workItemId: input.workItemId,
      branch: input.branch,
      leases: [],
      handoffs: [],
    };
    groups.set(id, created);
    return created;
  };

  for (const lease of options.leases.records) {
    ensureGroup({
      componentId: lease.scope.componentId,
      workItemId: lease.workItemId,
      branch: lease.branchName,
      fallbackId: lease.id,
    }).leases.push(lease);
  }
  for (const handoff of options.handoffs.records) {
    ensureGroup({
      componentId: handoff.componentId,
      workItemId: handoff.workItemId,
      branch: handoff.branch,
      fallbackId: handoff.commentId ?? handoff.createdAt,
    }).handoffs.push(handoff);
  }

  return [...groups.entries()]
    .map(([id, group]) => coordinationActivityGroup({
      id,
      context: options.context,
      git: options.git,
      componentId: group.componentId,
      workItemId: group.workItemId,
      branch: group.branch,
      leases: group.leases,
      handoffs: group.handoffs,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function coordinationActivityGroup(options: {
  id: string;
  context: ResolvedCoordinationContext;
  git: NexusCoordinationGitStatus;
  componentId: string | null;
  workItemId: string | null;
  branch: string | null;
  leases: NexusWorktreeLeaseSummary[];
  handoffs: NexusCoordinationHandoffSummary[];
}): NexusCoordinationActivityGroup {
  const hosts = uniqueSortedStrings(options.leases.map((lease) => lease.hostId));
  const agents = uniqueSortedStrings(
    options.leases
      .map((lease) => lease.agentId)
      .filter((agentId): agentId is string => Boolean(agentId)),
  );
  const statuses = uniqueSortedStrings([
    ...options.leases.map((lease) => lease.effectiveStatus),
    ...options.handoffs.map((handoff) => handoff.status),
  ]);
  const changedAreas = uniqueSortedStrings(
    options.handoffs.flatMap((handoff) => handoff.changedAreas),
  );
  const writeScopes = uniqueSortedStrings(
    options.leases.flatMap((lease) => lease.writeScope),
  );
  const stale =
    options.leases.some((lease) => lease.stale) ||
    options.handoffs.some((handoff) => handoff.stale);
  const active =
    !stale &&
    (
      options.leases.some((lease) =>
        !["merged", "abandoned"].includes(lease.status)
      ) ||
      options.handoffs.some((handoff) => handoff.status !== "merged")
    );
  const dirty =
    options.leases.some((lease) => lease.dirty === true) ||
    options.handoffs.some((handoff) => handoff.dirty === true);
  const aheadValues = [
    ...options.leases.map((lease) => lease.git.ahead),
    ...options.handoffs.map((handoff) => handoff.ahead),
  ].filter((value): value is number => value !== null);
  const behindValues = [
    ...options.leases.map((lease) => lease.git.behind),
    ...options.handoffs.map((handoff) => handoff.behind),
  ].filter((value): value is number => value !== null);
  const missingUpstream =
    Boolean(options.branch) &&
    (
      options.leases.some((lease) => !lease.git.upstream) ||
      options.handoffs.some((handoff) => !handoff.upstream)
    );
  const unpushed =
    options.leases.some((lease) => lease.pushed === false) ||
    options.handoffs.some((handoff) => handoff.pushed === false) ||
    aheadValues.some((ahead) => ahead > 0);
  const ownership = coordinationActivityOwnership(hosts);
  const overlap = coordinationActivityOverlap({
    currentFiles: options.git.changedFiles,
    changedAreas,
    writeScopes,
  });

  const group: Omit<NexusCoordinationActivityGroup, "nextAction"> = {
    id: options.id,
    componentId: options.componentId,
    workItemId: options.workItemId,
    branch: options.branch,
    leaseIds: options.leases.map((lease) => lease.id),
    handoffCount: options.handoffs.length,
    hosts,
    agents,
    statuses,
    changedAreas,
    writeScopes,
    ownership,
    active,
    stale,
    dirty,
    unpushed,
    missingUpstream,
    ahead: aheadValues.length > 0 ? Math.max(...aheadValues) : null,
    behind: behindValues.length > 0 ? Math.max(...behindValues) : null,
    overlap,
  };

  return {
    ...group,
    nextAction: coordinationActivityGroupNextAction(group),
  };
}

function coordinationActivityOwnership(
  hosts: string[],
): NexusCoordinationActivityOwnership {
  if (hosts.length === 0) {
    return "unknown";
  }
  return hosts.every((host) => host === os.hostname())
    ? "current_host"
    : "other_host";
}

function coordinationActivityOverlap(options: {
  currentFiles: string[];
  changedAreas: string[];
  writeScopes: string[];
}): NexusCoordinationActivityOverlap {
  const areas = uniqueSortedStrings([...options.changedAreas, ...options.writeScopes]);
  let granularity: NexusCoordinationActivityOverlapGranularity = "none";
  const matchedAreas: string[] = [];
  for (const file of options.currentFiles) {
    for (const area of areas) {
      const match = changedAreaMatchesFile(area, file);
      if (match === "none") {
        continue;
      }
      matchedAreas.push(area);
      granularity = moreSpecificOverlapGranularity(granularity, match);
    }
  }

  return {
    likely: matchedAreas.length > 0,
    granularity,
    currentFiles: [...options.currentFiles],
    matchedAreas: uniqueSortedStrings(matchedAreas),
  };
}

function changedAreaMatchesFile(
  area: string,
  file: string,
): NexusCoordinationActivityOverlapGranularity {
  const normalizedArea = normalizeCoordinationPath(area);
  const normalizedFile = normalizeCoordinationPath(file);
  if (!normalizedArea || !normalizedFile) {
    return "none";
  }
  if (normalizedArea === normalizedFile) {
    return "file";
  }
  if (
    normalizedFile.startsWith(`${normalizedArea}/`) ||
    normalizedArea.startsWith(`${normalizedFile}/`)
  ) {
    return "package";
  }
  if (normalizedArea.split("/")[0] === normalizedFile.split("/")[0]) {
    return "component";
  }

  return "none";
}

function moreSpecificOverlapGranularity(
  left: NexusCoordinationActivityOverlapGranularity,
  right: NexusCoordinationActivityOverlapGranularity,
): NexusCoordinationActivityOverlapGranularity {
  const rank = { none: 0, component: 1, package: 2, file: 3 };
  return rank[right] > rank[left] ? right : left;
}

function normalizeCoordinationPath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\.\/+/u, "");
}

function coordinationActivityGroupNextAction(
  group: Omit<NexusCoordinationActivityGroup, "nextAction">,
): string {
  if (group.stale) {
    return "Run cleanup dry-run or refresh the stale lease.";
  }
  if (group.active && group.overlap.likely && group.ownership !== "current_host") {
    return "Coordinate before editing overlapping active work.";
  }
  if (group.active && group.ownership === "current_host") {
    return "Continue or hand off the owned active worktree.";
  }
  if (group.missingUpstream || group.unpushed) {
    return "Push the branch or record a handoff with fetch instructions.";
  }
  if (group.statuses.includes("ready")) {
    return "Consider integration planning for the ready handoff.";
  }

  return "Monitor or inspect this coordination group.";
}

function coordinationActivityAuthority(
  authority: NexusAuthorityComponentSummary,
): NexusCoordinationActivityAuthoritySummary {
  const decision = (key: string) =>
    authority.decisions.find((entry) => entry.key === key) ?? null;
  return {
    missingSummary:
      authority.actor.status !== "matched" ||
      authority.warnings.length > 0,
    read: decision("read_project"),
    handoff: decision("handoff"),
    pushBranch: decision("push_branch"),
    integrate: decision("direct_integration"),
    cleanupWorktree: decision("delete_worktree"),
    cleanupBranch: decision("delete_branch"),
  };
}

function coordinationActivityNextAction(options: {
  git: NexusCoordinationGitStatus;
  groups: NexusCoordinationActivityGroup[];
  currentPathKind: "shared" | "generated_worktree" | "other";
}): string {
  if (options.git.dirty) {
    const location = options.currentPathKind === "shared"
      ? "shared checkout"
      : "worktree";
    return `Review, commit, or hand off current ${location} changes before starting parallel work.`;
  }
  if (options.groups.some((group) =>
    group.active && group.overlap.likely && group.ownership !== "current_host"
  )) {
    return "Coordinate overlapping active work before editing.";
  }
  if (options.groups.some((group) => group.ownership === "current_host" && group.active)) {
    return "Continue the owned active worktree or record a handoff.";
  }
  if (options.groups.some((group) => group.stale)) {
    return "Run coordination cleanup-plan before deleting stale worktrees or branches.";
  }
  if (options.git.branch && !options.git.upstream) {
    return "Push the branch and set upstream, or record fetch instructions.";
  }
  if (options.git.ahead !== null && options.git.ahead > 0) {
    return "Push the branch before requesting integration.";
  }

  return "No parallel activity needs action before continuing.";
}

function coordinationCurrentPathKind(
  context: ResolvedCoordinationContext,
  repositoryPath: string | null,
): "shared" | "generated_worktree" | "other" {
  if (!repositoryPath) {
    return "other";
  }
  if (samePath(repositoryPath, context.component.sourceRoot)) {
    return "shared";
  }
  if (pathIsInside(context.component.worktreesRoot, repositoryPath)) {
    return "generated_worktree";
  }

  return "other";
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function coordinationStartResult(options: {
  status: NexusCoordinationStatus;
  action: "prepare" | "adopt";
  dryRun: boolean;
  preparedWorktree?: NexusPreparedWorktreeSummary | null;
  adoptedWorktree?: NexusCoordinationAdoptedWorktree | null;
  nextAction: string;
}): NexusCoordinationStartResult {
  return {
    project: options.status.project,
    component: options.action === "prepare" &&
        options.preparedWorktree?.scope === "project"
      ? null
      : options.status.component,
    status: options.status,
    action: options.action,
    dryRun: options.dryRun,
    mutatesSource: options.action === "prepare" && !options.dryRun,
    preparedWorktree: options.preparedWorktree ?? null,
    adoptedWorktree: options.adoptedWorktree ?? null,
    blockedReasons: [],
    alternatives: [],
    nextAction: options.nextAction,
  };
}

function blockedCoordinationStartResult(options: {
  status: NexusCoordinationStatus;
  projectMeta: boolean;
  reasons: string[];
}): NexusCoordinationStartResult {
  return {
    project: options.status.project,
    component: options.projectMeta ? null : options.status.component,
    status: options.status,
    action: "blocked",
    dryRun: true,
    mutatesSource: false,
    preparedWorktree: null,
    adoptedWorktree: null,
    blockedReasons: uniqueSortedStrings(options.reasons),
    alternatives: [
      "Choose another work item or topic.",
      "Continue the existing owned worktree if it is still valid.",
      "Wait for a handoff or ask the active owner to hand off.",
      "Run coordination integrate or cleanup-plan when stale or ready work needs resolution.",
    ],
    nextAction: "Resolve the blocked start/adopt conditions before mutating source.",
  };
}

function coordinationAdoptionCandidate(options: {
  context: ResolvedCoordinationContext;
  status: NexusCoordinationStatus;
  hostId: string;
  workItemId: string | null;
  gitRunner?: GitRunner;
}): {
  worktree: Omit<NexusCoordinationAdoptedWorktree, "refreshedLease"> | null;
  blockedReasons: string[];
} {
  const ownedLeases = options.status.leases.records.filter((lease) =>
    lease.hostId === options.hostId &&
    !lease.stale &&
    !["merged", "abandoned"].includes(lease.status) &&
    (options.workItemId ? lease.workItemId === options.workItemId : true)
  );
  const lease = ownedLeases[0] ?? null;
  if (!lease) {
    return { worktree: null, blockedReasons: [] };
  }

  const worktreePath = coordinationLeaseWorktreePath(options.context, lease);
  if (!worktreePath) {
    return {
      worktree: null,
      blockedReasons: [
        `Owned lease ${lease.id} does not include an adoptable worktree path.`,
      ],
    };
  }
  const git = getCoordinationGitStatus(options.context, options.gitRunner, {
    repositoryCandidates: [worktreePath],
  });
  const blockers: string[] = [];
  if (!git.repositoryPath) {
    blockers.push(`Owned lease ${lease.id} worktree is not a Git checkout.`);
  }
  if (lease.branchName && git.branch && lease.branchName !== git.branch) {
    blockers.push(
      `Owned lease ${lease.id} branch ${lease.branchName} does not match worktree branch ${git.branch}.`,
    );
  }
  if (options.workItemId && lease.workItemId !== options.workItemId) {
    blockers.push(
      `Owned lease ${lease.id} is for ${lease.workItemId ?? "no work item"}, not ${options.workItemId}.`,
    );
  }
  if (blockers.length > 0) {
    return { worktree: null, blockedReasons: blockers };
  }

  return {
    worktree: {
      lease,
      worktreePath,
      branchName: lease.branchName,
      git,
    },
    blockedReasons: [],
  };
}

function coordinationStartPrepareBlockers(
  status: NexusCoordinationStatus,
): string[] {
  const blockers: string[] = [];
  const createWorktree = status.authority.decisions.find((decision) =>
    decision.key === "create_worktree"
  );
  if (createWorktree && !createWorktree.allowed && status.authority.actor.knownActor) {
    blockers.push(createWorktree.explanation);
  }
  for (const group of status.activity.groups) {
    if (
      group.active &&
      group.ownership !== "current_host" &&
      (
        group.overlap.likely ||
        (status.workItem && group.workItemId === status.workItem.id)
      )
    ) {
      blockers.push(
        `Active work ${group.branch ?? group.id} is owned by another host and may overlap this start request.`,
      );
    }
  }
  if (status.activity.dirtySharedCheckout) {
    blockers.push(
      "Current path is a dirty shared checkout; commit, clean, or hand off before starting a new chat flow.",
    );
  }

  return blockers;
}

function coordinationLeaseWorktreePath(
  context: ResolvedCoordinationContext,
  lease: NexusWorktreeLeaseSummary,
): string | null {
  const relativePath = lease.worktree.relativePath;
  if (!relativePath) {
    return null;
  }
  if (lease.worktree.base === "projectRoot") {
    return path.join(context.projectRoot, relativePath);
  }
  if (lease.worktree.base === "projectWorktreesRoot") {
    return path.join(
      projectWorktreesRootPath(context.projectRoot, context.projectConfig),
      relativePath,
    );
  }
  if (lease.worktree.base === "componentSourceRoot") {
    return path.join(context.component.sourceRoot, relativePath);
  }
  if (lease.worktree.base === "componentWorktreesRoot") {
    return path.join(context.component.worktreesRoot, relativePath);
  }

  return null;
}

function coordinationLeaseNotes(
  options: NexusCoordinationHandoffOptions,
): string[] {
  const note = optionalNullableTrimmedString(options.note) ?? null;
  const verification =
    optionalNullableTrimmedString(options.verificationSummary) ?? null;
  const integrationPreference =
    optionalNullableTrimmedString(options.integrationPreference) ?? null;
  const qualityDelta = coordinationQualityDeltaForHandoff(options);

  return [
    note,
    verification ? `Verification: ${verification}` : null,
    integrationPreference
      ? `Integration preference: ${integrationPreference}`
      : null,
    qualityDelta ? formatNexusCoordinationQualityDeltaSummary(qualityDelta) : null,
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

function coordinationAuthoritySummary(
  context: ResolvedCoordinationContext,
): NexusAuthorityComponentSummary {
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot: context.projectRoot,
    projectConfig: context.projectConfig,
  });

  return summarizeNexusAuthorityForComponent({
    projectId: context.projectConfig.id,
    componentId: context.component.id,
    componentName: context.component.name,
    authority: context.projectConfig.authority,
    authProfiles,
    publication: resolveNexusPublicationPolicy(
      context.projectConfig,
      context.component,
    ),
    safety: context.projectConfig.automation?.safety ?? null,
    tracker: context.component.defaultTrackerId,
    repository: context.component.remoteUrl,
  });
}

function resolveCoordinationMutationAuthority(options: {
  context: ResolvedCoordinationContext;
  tracker: ResolvedCoordinationTracker;
  requestedAction: NexusAuthorityAction;
}): NexusEffectiveAuthorityResolution {
  if (!options.context.projectConfig.authority) {
    return unconfiguredNexusAuthorityAllowedResolution(options.requestedAction);
  }
  const publication = resolveNexusPublicationPolicy(
    options.context.projectConfig,
    options.context.component,
  );
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: options.context.projectConfig.authority,
    componentId: options.context.component.id,
    publication,
    authProfiles: [],
    repository: options.context.component.remoteUrl,
  });

  return resolveNexusEffectiveAuthorityForCurrentActor({
    authority: options.context.projectConfig.authority,
    currentActor,
    project: options.context.projectConfig.id,
    component: options.context.component.id,
    provider: options.tracker.tracker.workTracking.provider,
    tracker: options.tracker.tracker.id,
    remote: publication.remote,
    repository: options.context.component.remoteUrl,
    targetBranch: publication.targetBranch,
    requestedAction: options.requestedAction,
    publication,
    safety: options.context.projectConfig.automation?.safety ?? null,
  });
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

function nullableRecordQualityDelta(
  record: Record<string, unknown>,
  key: string,
): NexusCoordinationQualityDeltaSummary | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeNexusCoordinationQualityDelta(value);
}

function qualityDeltaCounts(value: unknown): NexusCoordinationQualityDeltaCounts {
  const record = requiredQualityRecord(value, "qualityDelta.summary");
  return {
    newFindingCount: qualityInteger(record, "newFindingCount", "qualityDelta.summary"),
    resolvedFindingCount: qualityInteger(
      record,
      "resolvedFindingCount",
      "qualityDelta.summary",
    ),
    touchedNewFindingCount: qualityInteger(
      record,
      "touchedNewFindingCount",
      "qualityDelta.summary",
    ),
    touchedResolvedFindingCount: qualityInteger(
      record,
      "touchedResolvedFindingCount",
      "qualityDelta.summary",
    ),
    newCriticalOrBlockerCount: qualityInteger(
      record,
      "newCriticalOrBlockerCount",
      "qualityDelta.summary",
    ),
    newBugCount: qualityInteger(record, "newBugCount", "qualityDelta.summary"),
    newVulnerabilityCount: qualityInteger(
      record,
      "newVulnerabilityCount",
      "qualityDelta.summary",
    ),
    newSecurityHotspotCount: qualityInteger(
      record,
      "newSecurityHotspotCount",
      "qualityDelta.summary",
    ),
    qualityGateRegressed: qualityBoolean(
      record,
      "qualityGateRegressed",
      "qualityDelta.summary",
    ),
  };
}

function qualityDeltaAttentionFindings(
  record: Record<string, unknown>,
): NexusCoordinationQualityDeltaFinding[] {
  const source = Array.isArray(record.attention)
    ? record.attention
    : Array.isArray(record.newFindings)
      ? record.newFindings.filter(isAttentionQualityFinding)
      : [];
  return source
    .slice(0, 10)
    .map((entry, index) =>
      qualityDeltaFinding(entry, `qualityDelta.attention[${index}]`),
    );
}

function qualityDeltaFinding(
  value: unknown,
  pathName: string,
): NexusCoordinationQualityDeltaFinding {
  const record = requiredQualityRecord(value, pathName);
  return {
    source: qualityNullableString(record, "source", pathName),
    category: qualityNullableString(record, "category", pathName),
    severity: qualityNullableString(record, "severity", pathName),
    rule: qualityNullableString(record, "rule", pathName),
    filePath: qualityNullableString(record, "filePath", pathName),
    line: qualityNullableInteger(record, "line", pathName),
    message: qualityNullableString(record, "message", pathName),
  };
}

function isAttentionQualityFinding(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const category = typeof record.category === "string"
    ? record.category.toLowerCase()
    : "";
  const severity = typeof record.severity === "string"
    ? record.severity.toLowerCase()
    : "";
  return (
    category === "bug" ||
    category === "vulnerability" ||
    category === "security_hotspot" ||
    severity === "critical" ||
    severity === "blocker"
  );
}

function requiredQualityRecord(
  value: unknown,
  pathName: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function qualityString(
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

function qualityNullableString(
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

function qualityStringArray(value: unknown, pathName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`${pathName}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function qualityInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${pathName}.${key} must be an integer`);
  }
  return value;
}

function qualityNullableInteger(
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

function qualityBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${pathName}.${key} must be a boolean`);
  }
  return value;
}
