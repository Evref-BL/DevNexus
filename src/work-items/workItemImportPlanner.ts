import crypto from "node:crypto";
import path from "node:path";
import {
  createWorkItemService,
  type ResolvedWorkItemProviderContext,
  type WorkItemProjectResolver,
  type WorkItemProviderFactory,
} from "./workItemService.js";
import {
  resolveNexusEffectiveAuthority,
  type NexusAuthorityConfig,
  type NexusEffectiveAuthorityActorInput,
  type NexusEffectiveAuthorityAuthProfileInput,
  type NexusEffectiveAuthorityResolution,
} from "../authority/nexusAuthority.js";
import {
  createWorkItemTrackerLinkService,
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  type WorkItemTrackerReference,
} from "./workItemTrackerLinks.js";
import {
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import {
  workTrackerCapabilityReport,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import type {
  LocalWorkTrackingConfig,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkStatus,
  WorkTrackerCapabilityName,
} from "./workTrackingTypes.js";
import {
  parseWorkItemSyncConflictPolicyMode,
  parseWorkItemSyncField,
  parseWorkItemSyncWriteDisposition,
  type WorkItemSyncConflictPolicyConfig,
  type WorkItemSyncCredentialPolicy,
  type WorkItemSyncField,
  type WorkItemSyncFieldChange,
  type WorkItemSyncFieldValue,
  type WorkItemSyncFilters,
  type WorkItemSyncItemSummary,
  type WorkItemSyncMissingCredentials,
  type WorkItemSyncMissingProviderCapability,
  type WorkItemSyncPolicyBlock,
  type WorkItemSyncWriteDisposition,
} from "./workItemSyncPlanner.js";

export type WorkItemImportDirection = "external_to_local";
export type WorkItemImportFingerprint =
  | "external_ref"
  | "web_url"
  | "title";

export interface WorkItemImportWritePolicyConfig {
  mode: "dry_run" | string;
  creates?: WorkItemSyncWriteDisposition;
  updates?: WorkItemSyncWriteDisposition;
  links?: WorkItemSyncWriteDisposition;
  credentials?: WorkItemSyncCredentialPolicy;
  reason?: string | null;
}

export interface WorkItemImportPolicyConfig {
  sourceTrackerId: string;
  targetTrackerId: string;
  direction?: WorkItemImportDirection | string;
  filters?: WorkItemSyncFilters;
  fieldSet?: WorkItemSyncField[];
  statusMapping?: Partial<Record<WorkStatus, WorkStatus>>;
  conflictPolicy?: WorkItemSyncConflictPolicyConfig;
  writePolicy?: WorkItemImportWritePolicyConfig;
  fingerprints?: WorkItemImportFingerprint[];
}

export interface CreateWorkItemImportPlanInput {
  project?: string;
  projectRoot?: string;
  componentId?: string;
  policy: WorkItemImportPolicyConfig;
  resolveProject: WorkItemProjectResolver;
  providerFactory?: WorkItemProviderFactory;
  providerOptions?: Omit<CreateWorkTrackerProviderOptions, "projectRoot" | "now">;
  now?: () => Date | string;
}

export interface WorkItemImportTrackerSummary {
  trackerId: string;
  trackerName: string;
  provider: string;
  roles: string[];
  capabilities: ReturnType<typeof workTrackerCapabilityReport>;
}

export interface WorkItemImportProviderFilters {
  sourceTrackerId: string;
  query: WorkItemSyncFilters;
}

export interface WorkItemImportFieldMapping {
  fields: WorkItemSyncField[];
  statusMapping: Partial<Record<WorkStatus, WorkStatus>>;
}

export type WorkItemImportTargetDetection =
  | "linked"
  | "fingerprint"
  | "unlinked"
  | "stale_link";

export interface WorkItemImportPlannedLink {
  logicalItemId: string;
  trackerId: string;
  reference: Omit<WorkItemTrackerReference, "trackerId" | "trackerName" | "firstObservedAt" | "lastObservedAt">;
}

export interface WorkItemImportCreatePlan {
  source: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetDetection: WorkItemImportTargetDetection;
  fields: WorkItemSyncFieldValue[];
  plannedLink: WorkItemImportPlannedLink;
}

export interface WorkItemImportUpdatePlan {
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetDetection: WorkItemImportTargetDetection;
  targetReference?: WorkItemTrackerReference;
  fields: WorkItemSyncFieldChange[];
  conflictFields: WorkItemSyncFieldChange[];
  plannedLink: WorkItemImportPlannedLink;
  fingerprints: string[];
}

export interface WorkItemImportSkipPlan {
  reason:
    | "up_to_date"
    | "stale_link"
    | "missing_provider_capability"
    | "missing_credentials"
    | "policy_skip"
    | "policy_block"
    | "conflict_target_wins"
    | "provider_read_failure";
  message: string;
  source?: WorkItemSyncItemSummary;
  target?: WorkItemSyncItemSummary;
  targetTrackerId?: string;
  targetReference?: WorkItemTrackerReference;
}

export interface WorkItemImportConflictPlan {
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetReference?: WorkItemTrackerReference;
  fields: WorkItemSyncFieldChange[];
  policy: WorkItemSyncConflictPolicyConfig;
}

export interface WorkItemImportAmbiguousDuplicatePlan {
  source: WorkItemSyncItemSummary;
  candidates: WorkItemSyncItemSummary[];
  targetReferences: WorkItemTrackerReference[];
  fingerprints: string[];
  message: string;
}

export interface WorkItemImportStaleLinkPlan {
  source: WorkItemSyncItemSummary;
  targetReference: WorkItemTrackerReference;
  message: string;
}

export interface WorkItemImportBlocker {
  kind:
    | "unsupported_provider_path"
    | "missing_provider_capability"
    | "missing_credentials"
    | "policy_block"
    | "provider_read_failure";
  trackerId?: string;
  provider?: string;
  operation: string;
  message: string;
}

export interface WorkItemImportFingerprintMatch {
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  fingerprints: string[];
}

export interface WorkItemImportPlanCounts {
  sourceItems: number;
  targetItems: number;
  creates: number;
  updates: number;
  skips: number;
  conflicts: number;
  ambiguousDuplicates: number;
  staleLinks: number;
  missingProviderCapabilities: number;
  missingCredentials: number;
  policyBlocks: number;
  blockers: number;
  fingerprintMatches: number;
}

export interface WorkItemImportPlan {
  dryRun: true;
  generatedAt: string;
  projectRoot: string;
  projectId: string;
  componentId: string;
  sourceTracker: WorkItemImportTrackerSummary;
  targetTracker: WorkItemImportTrackerSummary;
  policy: Required<WorkItemImportPolicyConfig>;
  providerFilters: WorkItemImportProviderFilters;
  fieldMapping: WorkItemImportFieldMapping;
  wouldChangeFiles: string[];
  counts: WorkItemImportPlanCounts;
  creates: WorkItemImportCreatePlan[];
  updates: WorkItemImportUpdatePlan[];
  skips: WorkItemImportSkipPlan[];
  conflicts: WorkItemImportConflictPlan[];
  ambiguousDuplicates: WorkItemImportAmbiguousDuplicatePlan[];
  staleLinks: WorkItemImportStaleLinkPlan[];
  missingProviderCapabilities: WorkItemSyncMissingProviderCapability[];
  missingCredentials: WorkItemSyncMissingCredentials[];
  policyBlocks: WorkItemSyncPolicyBlock[];
  blockers: WorkItemImportBlocker[];
  fingerprintMatches: WorkItemImportFingerprintMatch[];
}

export interface WorkItemImportExecutionAuthorityInput {
  authority?: NexusAuthorityConfig;
  actor?: NexusEffectiveAuthorityActorInput | null;
  authProfile?: NexusEffectiveAuthorityAuthProfileInput | null;
}

export interface ExecuteWorkItemImportInput extends CreateWorkItemImportPlanInput {
  plan?: WorkItemImportPlan;
  authority?: WorkItemImportExecutionAuthorityInput | null;
}

export type WorkItemImportRunStatus = "completed" | "blocked" | "failed";

export interface WorkItemImportLocalLink {
  action: "created" | "updated" | "linked";
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  linkAction: "linked" | "updated" | "unchanged";
  reference: WorkItemTrackerReference;
}

export interface WorkItemImportRunCounts {
  created: number;
  updated: number;
  skipped: number;
  conflicted: number;
  blocked: number;
  links: number;
  ambiguousDuplicates: number;
  staleLinks: number;
}

export interface WorkItemImportRunBlocker {
  operation: string;
  message: string;
  source?: WorkItemSyncItemSummary;
  target?: WorkItemSyncItemSummary;
}

export interface WorkItemImportRunSummary {
  id: string;
  status: WorkItemImportRunStatus;
  startedAt: string;
  finishedAt: string;
  projectRoot: string;
  projectId: string;
  componentId: string;
  sourceTrackerId: string;
  targetTrackerId: string;
  planGeneratedAt: string;
  counts: WorkItemImportRunCounts;
}

export interface WorkItemImportAuthorityDecisionSummary {
  sourceRead: NexusEffectiveAuthorityResolution;
  targetWrite: NexusEffectiveAuthorityResolution;
}

export interface WorkItemImportRun {
  summary: WorkItemImportRunSummary;
  status: WorkItemImportRunStatus;
  plan: WorkItemImportPlan;
  localLinks: WorkItemImportLocalLink[];
  comments: WorkComment[];
  blockers: WorkItemImportRunBlocker[];
  skipped: WorkItemImportSkipPlan[];
  conflicts: WorkItemImportConflictPlan[];
  ambiguousDuplicates: WorkItemImportAmbiguousDuplicatePlan[];
  staleLinks: WorkItemImportStaleLinkPlan[];
  authority: WorkItemImportAuthorityDecisionSummary;
}

interface MutableWorkItemImportPlan extends WorkItemImportPlan {
  counts: WorkItemImportPlanCounts;
}

interface TargetResolution {
  detection: WorkItemImportTargetDetection;
  targetItem?: WorkItem;
  targetReference?: WorkItemTrackerReference;
  fingerprints: string[];
}

const allFields: WorkItemSyncField[] = [
  "title",
  "description",
  "status",
  "labels",
  "assignees",
  "milestone",
];

export function defaultWorkItemImportPolicy(
  overrides: Partial<WorkItemImportPolicyConfig> & {
    sourceTrackerId: string;
    targetTrackerId: string;
  },
): WorkItemImportPolicyConfig {
  return {
    direction: "external_to_local",
    filters: {},
    fieldSet: allFields,
    statusMapping: {},
    conflictPolicy: {
      mode: "block",
    },
    writePolicy: {
      mode: "dry_run",
      creates: "plan",
      updates: "plan",
      links: "plan",
      credentials: "not_required",
    },
    fingerprints: [],
    ...overrides,
  };
}

export async function createWorkItemImportPlan(
  input: CreateWorkItemImportPlanInput,
): Promise<WorkItemImportPlan> {
  const timestamp = nowString(input.now);
  const policy = normalizeWorkItemImportPolicy(input.policy);
  const selectorValue = requiredSelector(input);
  const selector = {
    ...(input.project
      ? { project: selectorValue }
      : { projectRoot: path.resolve(selectorValue) }),
    ...(input.componentId ? { componentId: input.componentId } : {}),
  };
  const service = createWorkItemService({
    resolveProject: input.resolveProject,
    providerFactory: input.providerFactory,
    providerOptions: input.providerOptions,
    now: input.now,
  });
  const sourceContext = await service.resolveProviderContext({
    ...selector,
    trackerId: policy.sourceTrackerId,
  });
  const targetContext = await service.resolveProviderContext({
    ...selector,
    trackerId: policy.targetTrackerId,
  });
  const componentId =
    sourceContext.projectContext.componentId ??
    targetContext.projectContext.componentId ??
    "primary";
  const plan = emptyPlan({
    timestamp,
    projectRoot: path.resolve(sourceContext.projectRoot),
    projectId: sourceContext.projectContext.projectId,
    componentId,
    sourceContext,
    targetContext,
    policy,
  });

  validateImportPolicy(plan, sourceContext, targetContext);
  if (plan.blockers.length > 0) {
    refreshCounts(plan);
    return plan;
  }

  const sourceCapabilities = workTrackerCapabilityReport(sourceContext.provider);
  if (!sourceCapabilities.capabilities.list) {
    addMissingProviderCapability(plan, {
      context: sourceContext,
      capability: "list",
      operation: "read source tracker",
      effect: "block",
    });
    refreshCounts(plan);
    return plan;
  }
  const targetCapabilities = workTrackerCapabilityReport(targetContext.provider);
  if (!targetCapabilities.capabilities.list) {
    addMissingProviderCapability(plan, {
      context: targetContext,
      capability: "list",
      operation: "detect local target work items",
      effect: "block",
    });
    refreshCounts(plan);
    return plan;
  }

  const sourceItems = await readWorkItems({
    service,
    selector: {
      ...selector,
      trackerId: policy.sourceTrackerId,
    },
    query: policy.filters,
    plan,
    context: sourceContext,
    operation: "read source tracker",
  });
  if (!sourceItems) {
    refreshCounts(plan);
    return plan;
  }
  const targetItems = await readWorkItems({
    service,
    selector: {
      ...selector,
      trackerId: policy.targetTrackerId,
    },
    query: {},
    plan,
    context: targetContext,
    operation: "read target tracker",
  });
  if (!targetItems) {
    refreshCounts(plan);
    return plan;
  }

  plan.counts.sourceItems = sourceItems.length;
  plan.counts.targetItems = targetItems.length;

  const linkStore = loadWorkItemTrackerLinkStore(
    defaultWorkItemTrackerLinkStorePath(plan.projectRoot),
    timestamp,
  );
  const componentRecords = linkStore.records.filter(
    (record) =>
      record.projectId === plan.projectId && record.componentId === componentId,
  );

  for (const sourceItem of sourceItems) {
    const sourceSummary = summarizeWorkItem(sourceItem, policy.sourceTrackerId);
    const resolution = resolveImportTarget({
      plan,
      sourceItem,
      sourceSummary,
      sourceContext,
      targetItems,
      componentRecords,
      policy,
    });
    if (!resolution) {
      continue;
    }
    if (resolution.detection === "unlinked") {
      planImportCreate({
        plan,
        sourceItem,
        sourceSummary,
        sourceContext,
        targetContext,
        policy,
      });
      continue;
    }
    planImportUpdate({
      plan,
      sourceItem,
      sourceSummary,
      targetContext,
      targetItem: resolution.targetItem,
      targetReference: resolution.targetReference,
      targetDetection: resolution.detection,
      fingerprints: resolution.fingerprints,
      policy,
      sourceContext,
    });
  }

  refreshWouldChangeFiles(plan, targetContext);
  refreshCounts(plan);
  return plan;
}

export async function executeWorkItemImport(
  input: ExecuteWorkItemImportInput,
): Promise<WorkItemImportRun> {
  const startedAt = nowString(input.now);
  const freshPlan = await createWorkItemImportPlan({
    ...input,
    policy: plannerPolicyForImportExecution(input.policy),
  });
  const stalePlanBlockers = input.plan
    ? stalePlanBlockersForConsumedPlan(input.plan, freshPlan, input.policy)
    : [];
  const plan = freshPlan;
  validateConsumedImportExecutionPlan(plan, input.policy);

  const selector = executionSelector(input, plan);
  const service = createWorkItemService({
    resolveProject: input.resolveProject,
    providerFactory: input.providerFactory,
    providerOptions: input.providerOptions,
    now: input.now,
  });
  const linkService = createWorkItemTrackerLinkService({
    resolveProject: input.resolveProject,
    now: input.now,
  });
  const authority = importExecutionAuthorityDecisions(plan, input.authority);
  const localLinks: WorkItemImportLocalLink[] = [];
  const comments: WorkComment[] = [];
  const blockers: WorkItemImportRunBlocker[] = [
    ...stalePlanBlockers,
    ...executionPolicyBlockers(plan, input.policy, authority),
    ...plan.blockers.map((blocker) => ({
      operation: blocker.operation,
      message: blocker.message,
    })),
    ...plan.conflicts.map((conflict) => ({
      operation: "conflict",
      message: `Import source "${conflict.source.id}" conflicts with local target "${conflict.target.id}".`,
      source: conflict.source,
      target: conflict.target,
    })),
    ...plan.ambiguousDuplicates.map((duplicate) => ({
      operation: "ambiguous_duplicate",
      message: duplicate.message,
      source: duplicate.source,
    })),
    ...plan.staleLinks.map((stale) => ({
      operation: "stale_link",
      message: stale.message,
      source: stale.source,
    })),
  ];

  if (blockers.length === 0) {
    for (const createPlan of plan.creates) {
      try {
        const target = await service.createWorkItem({
          ...selector,
          trackerId: plan.policy.targetTrackerId,
          ...createInputFromImportPlan(createPlan),
        });
        const link = await linkService.linkReference({
          ...selector,
          logicalItemId: target.id,
          trackerId: createPlan.plannedLink.trackerId,
          ...linkInputFromPlannedLink(createPlan.plannedLink),
        });
        localLinks.push({
          action: "created",
          source: createPlan.source,
          target: summarizeWorkItem(target, plan.policy.targetTrackerId),
          linkAction: link.action,
          reference: link.reference,
        });
      } catch (error) {
        blockers.push({
          operation: "create",
          message: errorMessage(error),
          source: createPlan.source,
        });
      }
    }

    for (const updatePlan of plan.updates) {
      try {
        const target = updatePlan.fields.length > 0
          ? await service.updateWorkItem({
              ...selector,
              trackerId: plan.policy.targetTrackerId,
              ref: { id: updatePlan.target.id },
              patch: patchFromChanges(updatePlan.fields),
            })
          : await service.getWorkItem({
              ...selector,
              trackerId: plan.policy.targetTrackerId,
              id: updatePlan.target.id,
            });
        const link = await linkService.linkReference({
          ...selector,
          logicalItemId: target.id,
          trackerId: updatePlan.plannedLink.trackerId,
          ...linkInputFromPlannedLink(updatePlan.plannedLink),
        });
        localLinks.push({
          action: updatePlan.fields.length > 0 ? "updated" : "linked",
          source: updatePlan.source,
          target: summarizeWorkItem(target, plan.policy.targetTrackerId),
          linkAction: link.action,
          reference: link.reference,
        });
      } catch (error) {
        blockers.push({
          operation: updatePlan.fields.length > 0 ? "update" : "link",
          message: errorMessage(error),
          source: updatePlan.source,
          target: updatePlan.target,
        });
      }
    }
  }

  const finishedAt = nowString(input.now);
  const summary = importRunSummary({
    plan,
    status:
      blockers.length > 0
        ? localLinks.length > 0
          ? "failed"
          : "blocked"
        : "completed",
    startedAt,
    finishedAt,
    created: localLinks.filter((link) => link.action === "created").length,
    updated: localLinks.filter((link) => link.action === "updated").length,
    skipped: plan.skips.length,
    conflicted: plan.conflicts.length,
    blocked: blockers.length,
    links: localLinks.length,
    ambiguousDuplicates: plan.ambiguousDuplicates.length,
    staleLinks: plan.staleLinks.length,
  });

  return {
    summary,
    status: summary.status,
    plan,
    localLinks,
    comments,
    blockers,
    skipped: plan.skips,
    conflicts: plan.conflicts,
    ambiguousDuplicates: plan.ambiguousDuplicates,
    staleLinks: plan.staleLinks,
    authority,
  };
}

export function parseWorkItemImportDirection(
  value: string,
  pathName: string,
): WorkItemImportDirection {
  if (value === "external_to_local") {
    return value;
  }

  throw new Error(`${pathName} must be external_to_local`);
}

export function parseWorkItemImportFingerprint(
  value: string,
  pathName: string,
): WorkItemImportFingerprint {
  if (value === "external_ref" || value === "web_url" || value === "title") {
    return value;
  }

  throw new Error(`${pathName} must be external_ref, web_url, or title`);
}

export {
  parseWorkItemSyncConflictPolicyMode as parseWorkItemImportConflictPolicyMode,
  parseWorkItemSyncField as parseWorkItemImportField,
  parseWorkItemSyncWriteDisposition as parseWorkItemImportWriteDisposition,
};

function resolveImportTarget(options: {
  plan: MutableWorkItemImportPlan;
  sourceItem: WorkItem;
  sourceSummary: WorkItemSyncItemSummary;
  sourceContext: ResolvedWorkItemProviderContext;
  targetItems: WorkItem[];
  componentRecords: ReturnType<typeof loadWorkItemTrackerLinkStore>["records"];
  policy: Required<WorkItemImportPolicyConfig>;
}): TargetResolution | null {
  const sourceReference = sourceReferenceForItem(
    options.sourceItem,
    options.sourceContext,
    options.plan.generatedAt,
  );
  const linkedRecords = options.componentRecords.filter((record) =>
    record.references.some((reference) =>
      trackerReferencesSameItem(reference, sourceReference),
    ),
  );
  if (linkedRecords.length > 1) {
    options.plan.ambiguousDuplicates.push({
      source: options.sourceSummary,
      candidates: linkedRecords.flatMap((record) =>
        options.targetItems
          .filter((item) => targetItemId(item) === record.logicalItemId)
          .map((item) => summarizeWorkItem(item, options.policy.targetTrackerId)),
      ),
      targetReferences: linkedRecords.flatMap((record) =>
        record.references.filter((reference) =>
          trackerReferencesSameItem(reference, sourceReference),
        ),
      ),
      fingerprints: [],
      message: `Source item "${options.sourceSummary.id}" is linked to multiple local logical items.`,
    });
    return null;
  }

  if (linkedRecords.length === 1) {
    const record = linkedRecords[0]!;
    const targetItem = options.targetItems.find(
      (item) => targetItemId(item) === record.logicalItemId || item.id === record.logicalItemId,
    );
    const targetReference = record.references.find((reference) =>
      trackerReferencesSameItem(reference, sourceReference),
    );
    if (!targetItem && targetReference) {
      const stale = {
        source: options.sourceSummary,
        targetReference,
        message: `Linked local item "${record.logicalItemId}" was not found.`,
      };
      options.plan.staleLinks.push(stale);
      options.plan.skips.push({
        reason: "stale_link",
        message: stale.message,
        source: options.sourceSummary,
        targetTrackerId: options.policy.targetTrackerId,
        targetReference,
      });
      return null;
    }

    return {
      detection: "linked",
      targetItem,
      targetReference,
      fingerprints: [],
    };
  }

  const fingerprints = sourceFingerprints(
    options.sourceItem,
    options.sourceContext,
    options.policy.fingerprints,
  );
  if (fingerprints.length === 0) {
    return {
      detection: "unlinked",
      fingerprints: [],
    };
  }

  const fingerprintMatches = options.targetItems.filter((item) =>
    fingerprints.some((fingerprint) => itemContainsFingerprint(item, fingerprint)),
  );
  if (fingerprintMatches.length > 1) {
    options.plan.ambiguousDuplicates.push({
      source: options.sourceSummary,
      candidates: fingerprintMatches.map((item) =>
        summarizeWorkItem(item, options.policy.targetTrackerId),
      ),
      targetReferences: [],
      fingerprints,
      message: `Source item "${options.sourceSummary.id}" matched multiple local fingerprint candidates.`,
    });
    return null;
  }
  if (fingerprintMatches.length === 1) {
    const target = fingerprintMatches[0]!;
    options.plan.fingerprintMatches.push({
      source: options.sourceSummary,
      target: summarizeWorkItem(target, options.policy.targetTrackerId),
      fingerprints,
    });
    return {
      detection: "fingerprint",
      targetItem: target,
      fingerprints,
    };
  }

  return {
    detection: "unlinked",
    fingerprints,
  };
}

function planImportCreate(options: {
  plan: MutableWorkItemImportPlan;
  sourceItem: WorkItem;
  sourceSummary: WorkItemSyncItemSummary;
  sourceContext: ResolvedWorkItemProviderContext;
  targetContext: ResolvedWorkItemProviderContext;
  policy: Required<WorkItemImportPolicyConfig>;
}): void {
  const targetCapabilities = workTrackerCapabilityReport(
    options.targetContext.provider,
  );
  if (!targetCapabilities.capabilities.create) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: "create",
      operation: "plan local work item creates",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot create local work items.`,
      source: options.sourceSummary,
      targetTrackerId: options.policy.targetTrackerId,
    });
    return;
  }

  const desired = desiredFields(options.sourceItem, options.policy);
  const disposition = options.policy.writePolicy.creates ?? "plan";
  if (disposition !== "plan") {
    handleWriteDisposition({
      plan: options.plan,
      operation: "create",
      disposition,
      reason: options.policy.writePolicy.reason,
      source: options.sourceSummary,
      targetTrackerId: options.policy.targetTrackerId,
    });
    return;
  }

  options.plan.creates.push({
    source: options.sourceSummary,
    targetTrackerId: options.policy.targetTrackerId,
    targetDetection: "unlinked",
    fields: fieldValues(desired),
    plannedLink: plannedLinkFromSource({
      logicalItemId: plannedLocalLogicalItemId(options.sourceItem),
      sourceItem: options.sourceItem,
      sourceContext: options.sourceContext,
      observedAt: options.plan.generatedAt,
    }),
  });
}

function planImportUpdate(options: {
  plan: MutableWorkItemImportPlan;
  sourceItem: WorkItem;
  sourceSummary: WorkItemSyncItemSummary;
  sourceContext: ResolvedWorkItemProviderContext;
  targetContext: ResolvedWorkItemProviderContext;
  targetItem?: WorkItem;
  targetReference?: WorkItemTrackerReference;
  targetDetection: WorkItemImportTargetDetection;
  fingerprints: string[];
  policy: Required<WorkItemImportPolicyConfig>;
}): void {
  if (!options.targetItem) {
    return;
  }
  const targetSummary = summarizeWorkItem(
    options.targetItem,
    options.policy.targetTrackerId,
  );
  const fieldChanges = changedFields(
    desiredFields(options.sourceItem, options.policy),
    options.targetItem,
  );
  const conflictFields =
    options.targetReference && targetChangedAfterLink(options.targetItem, options.targetReference)
      ? fieldChanges
      : [];
  if (conflictFields.length > 0) {
    options.plan.conflicts.push({
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
      fields: conflictFields,
      policy: options.policy.conflictPolicy,
    });
    if (options.policy.conflictPolicy.mode === "block") {
      return;
    }
    if (options.policy.conflictPolicy.mode === "target_wins") {
      options.plan.skips.push({
        reason: "conflict_target_wins",
        message: "Local target changed after the source link was observed; conflict policy keeps local values.",
        source: options.sourceSummary,
        target: targetSummary,
        targetTrackerId: options.policy.targetTrackerId,
        targetReference: options.targetReference,
      });
      return;
    }
  }

  const needsLink = options.targetDetection === "fingerprint";
  if (fieldChanges.length === 0 && !needsLink) {
    options.plan.skips.push({
      reason: "up_to_date",
      message: "Linked local target already matches the selected source fields.",
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  const targetCapabilities = workTrackerCapabilityReport(
    options.targetContext.provider,
  );
  if (fieldChanges.length > 0 && !targetCapabilities.capabilities.update) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: "update",
      operation: "plan local work item updates",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot update local work items.`,
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  const updateDisposition = options.policy.writePolicy.updates ?? "plan";
  const linkDisposition = options.policy.writePolicy.links ?? "plan";
  if (fieldChanges.length > 0 && updateDisposition !== "plan") {
    handleWriteDisposition({
      plan: options.plan,
      operation: "update",
      disposition: updateDisposition,
      reason: options.policy.writePolicy.reason,
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }
  if (needsLink && linkDisposition !== "plan") {
    handleWriteDisposition({
      plan: options.plan,
      operation: "link",
      disposition: linkDisposition,
      reason: options.policy.writePolicy.reason,
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.targetContext.trackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  options.plan.updates.push({
    source: options.sourceSummary,
    target: targetSummary,
    targetTrackerId: options.policy.targetTrackerId,
    targetDetection: options.targetDetection,
    targetReference: options.targetReference,
    fields: fieldChanges,
    conflictFields,
    plannedLink: plannedLinkFromSource({
      logicalItemId: options.targetItem.id,
      sourceItem: options.sourceItem,
      sourceContext: options.sourceContext,
      observedAt: options.plan.generatedAt,
    }),
    fingerprints: options.fingerprints,
  });
}

async function readWorkItems(options: {
  service: ReturnType<typeof createWorkItemService>;
  selector: { project?: string; projectRoot?: string; componentId?: string; trackerId: string };
  query: WorkItemQuery;
  plan: MutableWorkItemImportPlan;
  context: ResolvedWorkItemProviderContext;
  operation: string;
}): Promise<WorkItem[] | null> {
  try {
    return await options.service.listWorkItems({
      ...options.selector,
      ...options.query,
    });
  } catch (error) {
    if (isCredentialError(error)) {
      addMissingCredentials(options.plan, {
        context: options.context,
        operation: options.operation,
        message: errorMessage(error),
      });
      return null;
    }
    options.plan.blockers.push({
      kind: "provider_read_failure",
      trackerId: options.context.trackerId,
      provider: options.context.provider.provider,
      operation: options.operation,
      message: errorMessage(error),
    });
    return null;
  }
}

function desiredFields(
  item: WorkItem,
  policy: Required<WorkItemImportPolicyConfig>,
): Partial<Record<WorkItemSyncField, unknown>> {
  const desired: Partial<Record<WorkItemSyncField, unknown>> = {};
  for (const field of policy.fieldSet) {
    switch (field) {
      case "title":
        desired.title = item.title;
        break;
      case "description":
        desired.description = item.description ?? null;
        break;
      case "status":
        desired.status = policy.statusMapping[item.status] ?? item.status;
        break;
      case "labels":
        desired.labels = [...(item.labels ?? [])];
        break;
      case "assignees":
        desired.assignees = [...(item.assignees ?? [])];
        break;
      case "milestone":
        desired.milestone = item.milestone ?? null;
        break;
    }
  }

  return desired;
}

function changedFields(
  desired: Partial<Record<WorkItemSyncField, unknown>>,
  targetItem: WorkItem,
): WorkItemSyncFieldChange[] {
  return Object.entries(desired).flatMap(([field, plannedValue]) => {
    const syncField = field as WorkItemSyncField;
    const targetValue = targetFieldValue(targetItem, syncField);
    if (valuesEqual(plannedValue, targetValue)) {
      return [];
    }

    return [
      {
        field: syncField,
        sourceValue: plannedValue,
        targetValue,
        plannedValue,
      },
    ];
  });
}

function targetFieldValue(item: WorkItem, field: WorkItemSyncField): unknown {
  switch (field) {
    case "title":
      return item.title;
    case "description":
      return item.description ?? null;
    case "status":
      return item.status;
    case "labels":
      return [...(item.labels ?? [])];
    case "assignees":
      return [...(item.assignees ?? [])];
    case "milestone":
      return item.milestone ?? null;
  }
}

function targetChangedAfterLink(
  targetItem: WorkItem,
  reference: WorkItemTrackerReference,
): boolean {
  if (!targetItem.updatedAt || !reference.lastObservedAt) {
    return false;
  }
  const targetUpdatedAt = Date.parse(targetItem.updatedAt);
  const referenceObservedAt = Date.parse(reference.lastObservedAt);
  if (Number.isNaN(targetUpdatedAt) || Number.isNaN(referenceObservedAt)) {
    return false;
  }

  return targetUpdatedAt > referenceObservedAt;
}

function sourceFingerprints(
  item: WorkItem,
  sourceContext: ResolvedWorkItemProviderContext,
  configured: WorkItemImportFingerprint[],
): string[] {
  const values = configured.flatMap((fingerprint) => {
    if (fingerprint === "title") {
      return [item.title];
    }
    if (fingerprint === "web_url") {
      return item.webUrl ? [item.webUrl] : [];
    }
    return externalRefFingerprints(sourceReferenceForItem(
      item,
      sourceContext,
      item.updatedAt ?? new Date(0).toISOString(),
    ));
  });

  return dedupeStrings(values.map((value) => value.trim()).filter(Boolean));
}

function externalRefFingerprints(reference: WorkItemTrackerReference): string[] {
  const repo =
    reference.repositoryOwner && reference.repositoryName
      ? `${reference.repositoryOwner}/${reference.repositoryName}`
      : null;
  return dedupeStrings([
    reference.webUrl ?? "",
    repo && reference.itemNumber
      ? `github:${repo}#${reference.itemNumber}`
      : "",
    repo ? `github:${repo}:${reference.itemId}` : "",
    reference.nodeId ? `github-node:${reference.nodeId}` : "",
  ].filter(Boolean));
}

function itemContainsFingerprint(item: WorkItem, fingerprint: string): boolean {
  const values = [
    item.id,
    item.title,
    item.description ?? "",
    item.milestone ?? "",
    ...(item.labels ?? []),
  ];
  return values.some((value) =>
    itemFingerprintTokens(value).includes(fingerprint),
  );
}

function itemFingerprintTokens(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return dedupeStrings([
    trimmed,
    ...[...trimmed.matchAll(/https?:\/\/[^\s<>"')\]}]+/gu)].map((match) =>
      stripTrailingFingerprintPunctuation(match[0]!),
    ),
    ...[...trimmed.matchAll(/\bgithub:[^\s<>"')\]}]+/gu)].map((match) =>
      stripTrailingFingerprintPunctuation(match[0]!),
    ),
    ...[...trimmed.matchAll(/\bgithub-node:[^\s<>"')\]}]+/gu)].map((match) =>
      stripTrailingFingerprintPunctuation(match[0]!),
    ),
  ].filter(Boolean));
}

function stripTrailingFingerprintPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && isFingerprintTrailingPunctuation(value[end - 1]!)) {
    end -= 1;
  }

  return value.slice(0, end);
}

function isFingerprintTrailingPunctuation(character: string): boolean {
  return character === "." ||
    character === "," ||
    character === ";" ||
    character === ":" ||
    character === "!" ||
    character === "?";
}

function sourceReferenceForItem(
  item: WorkItem,
  sourceContext: ResolvedWorkItemProviderContext,
  observedAt: string,
): WorkItemTrackerReference {
  const externalRef = item.externalRef;
  const config = sourceContext.workTracking;
  const repository = config.repository;
  const itemId = externalRef?.itemId ?? item.id.replace(/^github-/u, "");
  return {
    trackerId: sourceContext.trackerId,
    trackerName: sourceContext.trackerName,
    provider: externalRef?.provider ?? sourceContext.provider.provider,
    host: externalRef?.host ?? config.host ?? null,
    repositoryId: externalRef?.repositoryId ?? repository?.id ?? null,
    repositoryOwner: externalRef?.repositoryOwner ?? repository?.owner ?? null,
    repositoryName: externalRef?.repositoryName ?? repository?.name ?? null,
    projectId: externalRef?.projectId ?? null,
    boardId: externalRef?.boardId ?? config.board?.id ?? null,
    itemId,
    itemNumber: externalRef?.itemNumber ?? numberFromGitHubId(item.id),
    itemKey: externalRef?.itemKey ?? null,
    nodeId: externalRef?.nodeId ?? null,
    webUrl: externalRef?.webUrl ?? item.webUrl ?? null,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
  };
}

function plannedLinkFromSource(options: {
  logicalItemId: string;
  sourceItem: WorkItem;
  sourceContext: ResolvedWorkItemProviderContext;
  observedAt: string;
}): WorkItemImportPlannedLink {
  const { trackerId: _trackerId, trackerName: _trackerName, firstObservedAt: _first, lastObservedAt: _last, ...reference } =
    sourceReferenceForItem(
      options.sourceItem,
      options.sourceContext,
      options.observedAt,
    );
  return {
    logicalItemId: options.logicalItemId,
    trackerId: options.sourceContext.trackerId,
    reference,
  };
}

type TrackerReferenceIdentity = Pick<
  WorkItemTrackerReference,
  | "trackerId"
  | "provider"
  | "host"
  | "repositoryId"
  | "repositoryOwner"
  | "repositoryName"
  | "projectId"
  | "itemId"
  | "itemNumber"
  | "nodeId"
>;

type TrackerReferenceContext = Pick<
  WorkItemTrackerReference,
  "host" | "repositoryId" | "repositoryOwner" | "repositoryName" | "projectId"
>;

function trackerReferencesSameItem(
  left: TrackerReferenceIdentity,
  right: TrackerReferenceIdentity,
): boolean {
  if (left.trackerId !== right.trackerId || left.provider !== right.provider) {
    return false;
  }
  if (left.nodeId && right.nodeId && left.nodeId === right.nodeId) {
    return true;
  }
  if (
    left.itemId &&
    right.itemId &&
    left.itemId === right.itemId &&
    trackerReferenceContextsSame(left, right)
  ) {
    return true;
  }
  return Boolean(
    left.itemNumber &&
      right.itemNumber &&
      left.itemNumber === right.itemNumber &&
      trackerReferenceContextsSame(left, right),
  );
}

function trackerReferenceContextsSame(
  left: TrackerReferenceContext,
  right: TrackerReferenceContext,
): boolean {
  const fields = [
    "host",
    "repositoryId",
    "repositoryOwner",
    "repositoryName",
    "projectId",
  ] as const;
  return fields.every(
    (field) =>
      nullableContextValue(left[field]) === nullableContextValue(right[field]),
  );
}

function nullableContextValue(value: string | null | undefined): string | null {
  return value ?? null;
}

function targetItemId(item: WorkItem): string {
  return item.externalRef?.itemId ?? item.id;
}

function plannedLocalLogicalItemId(item: WorkItem): string {
  const number = item.externalRef?.itemNumber ?? numberFromGitHubId(item.id);
  return number ? `local-from-github-${number}` : `local-from-${item.id}`;
}

function numberFromGitHubId(id: string): number | null {
  const match = /^github-(\d+)$/u.exec(id.trim());
  return match ? Number(match[1]) : null;
}

function refreshWouldChangeFiles(
  plan: MutableWorkItemImportPlan,
  targetContext: ResolvedWorkItemProviderContext,
): void {
  const wouldChangeLocalItems = plan.creates.length > 0 || plan.updates.some((update) => update.fields.length > 0);
  const wouldChangeLinks =
    plan.creates.length > 0 ||
    plan.updates.some((update) => update.targetDetection === "fingerprint");
  const files = [
    ...(wouldChangeLocalItems
      ? [
          resolveLocalWorkTrackingStorePath(
            plan.projectRoot,
            targetContext.workTracking as LocalWorkTrackingConfig,
          ),
        ]
      : []),
    ...(wouldChangeLinks
      ? [defaultWorkItemTrackerLinkStorePath(plan.projectRoot)]
      : []),
  ];
  plan.wouldChangeFiles = dedupeStrings(files.map((filePath) => path.resolve(filePath)));
}

function addMissingProviderCapability(
  plan: MutableWorkItemImportPlan,
  options: {
    context: ResolvedWorkItemProviderContext;
    capability: WorkTrackerCapabilityName;
    operation: string;
    effect: "skip" | "block";
  },
): void {
  const message =
    `Tracker "${options.context.trackerId}" provider ` +
    `"${options.context.provider.provider}" is missing capability ` +
    `"${options.capability}" for ${options.operation}.`;
  plan.missingProviderCapabilities.push({
    trackerId: options.context.trackerId,
    provider: options.context.provider.provider,
    capability: options.capability,
    operation: options.operation,
    effect: options.effect,
    message,
  });
  if (options.effect === "block") {
    plan.blockers.push({
      kind: "missing_provider_capability",
      trackerId: options.context.trackerId,
      provider: options.context.provider.provider,
      operation: options.operation,
      message,
    });
  }
}

function addMissingCredentials(
  plan: MutableWorkItemImportPlan,
  options: {
    context: ResolvedWorkItemProviderContext;
    operation: string;
    message: string;
  },
): void {
  plan.missingCredentials.push({
    trackerId: options.context.trackerId,
    provider: options.context.provider.provider,
    operation: options.operation,
    message: options.message,
  });
  plan.blockers.push({
    kind: "missing_credentials",
    trackerId: options.context.trackerId,
    provider: options.context.provider.provider,
    operation: options.operation,
    message: options.message,
  });
}

function validateImportPolicy(
  plan: MutableWorkItemImportPlan,
  sourceContext: ResolvedWorkItemProviderContext,
  targetContext: ResolvedWorkItemProviderContext,
): void {
  if (plan.policy.direction !== "external_to_local") {
    addPolicyBlock(plan, {
      operation: "direction",
      reason: `Import direction "${plan.policy.direction}" is not supported by the dry-run planner.`,
    });
  }
  if (plan.policy.writePolicy.mode !== "dry_run") {
    addPolicyBlock(plan, {
      operation: "write_policy",
      reason: `Write policy mode "${plan.policy.writePolicy.mode}" is not allowed; inbound imports are plan-only.`,
    });
  }
  if (sourceContext.provider.provider !== "github") {
    plan.blockers.push({
      kind: "unsupported_provider_path",
      trackerId: sourceContext.trackerId,
      provider: sourceContext.provider.provider,
      operation: "provider_path",
      message: "Inbound import planning currently supports GitHub source trackers only.",
    });
  }
  if (targetContext.provider.provider !== "local") {
    plan.blockers.push({
      kind: "unsupported_provider_path",
      trackerId: targetContext.trackerId,
      provider: targetContext.provider.provider,
      operation: "provider_path",
      message: "Inbound import planning currently supports local target trackers only.",
    });
  }
  if (plan.policy.writePolicy.credentials === "missing") {
    addMissingCredentials(plan, {
      context: sourceContext,
      operation: "read source tracker",
      message: plan.policy.writePolicy.reason ?? "Source tracker credentials are missing.",
    });
  }
}

function addPolicyBlock(
  plan: MutableWorkItemImportPlan,
  options: {
    operation: string;
    reason: string;
  },
): void {
  plan.policyBlocks.push(options);
  plan.blockers.push({
    kind: "policy_block",
    operation: options.operation,
    message: options.reason,
  });
}

function handleWriteDisposition(options: {
  plan: MutableWorkItemImportPlan;
  operation: "create" | "update" | "link";
  disposition: WorkItemSyncWriteDisposition;
  reason?: string | null;
  source: WorkItemSyncItemSummary;
  target?: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetReference?: WorkItemTrackerReference;
}): void {
  const message =
    options.reason ??
    `Write policy is configured to ${options.disposition} ${options.operation} plans.`;
  if (options.disposition === "block") {
    addPolicyBlock(options.plan, {
      operation: options.operation,
      reason: message,
    });
  }
  options.plan.skips.push({
    reason: options.disposition === "block" ? "policy_block" : "policy_skip",
    message,
    source: options.source,
    target: options.target,
    targetTrackerId: options.targetTrackerId,
    targetReference: options.targetReference,
  });
}

function emptyPlan(options: {
  timestamp: string;
  projectRoot: string;
  projectId: string;
  componentId: string;
  sourceContext: ResolvedWorkItemProviderContext;
  targetContext: ResolvedWorkItemProviderContext;
  policy: Required<WorkItemImportPolicyConfig>;
}): MutableWorkItemImportPlan {
  return {
    dryRun: true,
    generatedAt: options.timestamp,
    projectRoot: options.projectRoot,
    projectId: options.projectId,
    componentId: options.componentId,
    sourceTracker: trackerSummary(options.sourceContext),
    targetTracker: trackerSummary(options.targetContext),
    policy: options.policy,
    providerFilters: {
      sourceTrackerId: options.policy.sourceTrackerId,
      query: options.policy.filters,
    },
    fieldMapping: {
      fields: options.policy.fieldSet,
      statusMapping: options.policy.statusMapping,
    },
    wouldChangeFiles: [],
    counts: {
      sourceItems: 0,
      targetItems: 0,
      creates: 0,
      updates: 0,
      skips: 0,
      conflicts: 0,
      ambiguousDuplicates: 0,
      staleLinks: 0,
      missingProviderCapabilities: 0,
      missingCredentials: 0,
      policyBlocks: 0,
      blockers: 0,
      fingerprintMatches: 0,
    },
    creates: [],
    updates: [],
    skips: [],
    conflicts: [],
    ambiguousDuplicates: [],
    staleLinks: [],
    missingProviderCapabilities: [],
    missingCredentials: [],
    policyBlocks: [],
    blockers: [],
    fingerprintMatches: [],
  };
}

function trackerSummary(
  context: ResolvedWorkItemProviderContext,
): WorkItemImportTrackerSummary {
  return {
    trackerId: context.trackerId,
    trackerName: context.trackerName,
    provider: context.provider.provider,
    roles: context.trackerRoles,
    capabilities: workTrackerCapabilityReport(context.provider),
  };
}

function refreshCounts(plan: MutableWorkItemImportPlan): void {
  plan.counts.creates = plan.creates.length;
  plan.counts.updates = plan.updates.length;
  plan.counts.skips = plan.skips.length;
  plan.counts.conflicts = plan.conflicts.length;
  plan.counts.ambiguousDuplicates = plan.ambiguousDuplicates.length;
  plan.counts.staleLinks = plan.staleLinks.length;
  plan.counts.missingProviderCapabilities =
    plan.missingProviderCapabilities.length;
  plan.counts.missingCredentials = plan.missingCredentials.length;
  plan.counts.policyBlocks = plan.policyBlocks.length;
  plan.counts.blockers = plan.blockers.length;
  plan.counts.fingerprintMatches = plan.fingerprintMatches.length;
}

function normalizeWorkItemImportPolicy(
  policy: WorkItemImportPolicyConfig,
): Required<WorkItemImportPolicyConfig> {
  return {
    sourceTrackerId: requiredNonEmptyString(
      policy.sourceTrackerId,
      "policy.sourceTrackerId",
    ),
    targetTrackerId: requiredNonEmptyString(
      policy.targetTrackerId,
      "policy.targetTrackerId",
    ),
    direction: policy.direction ?? "external_to_local",
    filters: policy.filters ?? {},
    fieldSet: normalizeFieldSet(policy.fieldSet),
    statusMapping: policy.statusMapping ?? {},
    conflictPolicy: policy.conflictPolicy ?? { mode: "block" },
    writePolicy: {
      mode: "dry_run",
      creates: "plan",
      updates: "plan",
      links: "plan",
      credentials: "not_required",
      ...policy.writePolicy,
    },
    fingerprints: normalizeFingerprints(policy.fingerprints),
  };
}

function normalizeFieldSet(
  fieldSet: WorkItemSyncField[] | undefined,
): WorkItemSyncField[] {
  const fields = fieldSet && fieldSet.length > 0 ? fieldSet : allFields;
  const seen = new Set<string>();
  return fields.map((field) => {
    const parsed = parseWorkItemSyncField(field, "policy.fieldSet");
    if (seen.has(parsed)) {
      throw new Error(`policy.fieldSet contains duplicate field: ${parsed}`);
    }
    seen.add(parsed);
    return parsed;
  });
}

function normalizeFingerprints(
  fingerprints: WorkItemImportFingerprint[] | undefined,
): WorkItemImportFingerprint[] {
  const values = fingerprints ?? [];
  const seen = new Set<string>();
  return values.map((value) => {
    const parsed = parseWorkItemImportFingerprint(value, "policy.fingerprints");
    if (seen.has(parsed)) {
      throw new Error(`policy.fingerprints contains duplicate value: ${parsed}`);
    }
    seen.add(parsed);
    return parsed;
  });
}

function plannerPolicyForImportExecution(
  policy: WorkItemImportPolicyConfig,
): WorkItemImportPolicyConfig {
  const normalized = normalizeWorkItemImportPolicy(policy);
  return {
    ...normalized,
    writePolicy: {
      ...normalized.writePolicy,
      mode: "dry_run",
    },
  };
}

function validateConsumedImportExecutionPlan(
  plan: WorkItemImportPlan,
  policy: WorkItemImportPolicyConfig,
): void {
  const normalized = normalizeWorkItemImportPolicy(policy);
  if (!plan.dryRun) {
    throw new Error("work item import execution requires a dry-run plan");
  }
  if (plan.policy.sourceTrackerId !== normalized.sourceTrackerId) {
    throw new Error("work item import plan source tracker does not match policy");
  }
  if (plan.policy.targetTrackerId !== normalized.targetTrackerId) {
    throw new Error("work item import plan target tracker does not match policy");
  }
  if (plan.policy.direction !== normalized.direction) {
    throw new Error("work item import plan direction does not match policy");
  }
}

function stalePlanBlockersForConsumedPlan(
  consumed: WorkItemImportPlan,
  fresh: WorkItemImportPlan,
  policy: WorkItemImportPolicyConfig,
): WorkItemImportRunBlocker[] {
  validateConsumedImportExecutionPlan(consumed, policy);
  return importPlanFingerprint(consumed) === importPlanFingerprint(fresh)
    ? []
    : [
        {
          operation: "stale_plan",
          message:
            "Inbound import plan changed when recomputed immediately before execution.",
        },
      ];
}

function importPlanFingerprint(plan: WorkItemImportPlan): string {
  return JSON.stringify({
    projectId: plan.projectId,
    componentId: plan.componentId,
    sourceTrackerId: plan.sourceTracker.trackerId,
    targetTrackerId: plan.targetTracker.trackerId,
    policy: plan.policy,
    creates: plan.creates.map((create) => ({
      sourceId: create.source.id,
      fields: create.fields,
      plannedLink: create.plannedLink,
    })),
    updates: plan.updates.map((update) => ({
      sourceId: update.source.id,
      targetId: update.target.id,
      targetDetection: update.targetDetection,
      fields: update.fields,
      plannedLink: update.plannedLink,
      fingerprints: update.fingerprints,
    })),
    skips: plan.skips.map((skip) => ({
      reason: skip.reason,
      sourceId: skip.source?.id,
      targetId: skip.target?.id,
      targetReference: skip.targetReference,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      sourceId: conflict.source.id,
      targetId: conflict.target.id,
      fields: conflict.fields,
    })),
    ambiguousDuplicates: plan.ambiguousDuplicates.map((duplicate) => ({
      sourceId: duplicate.source.id,
      candidates: duplicate.candidates.map((candidate) => candidate.id),
      fingerprints: duplicate.fingerprints,
    })),
    staleLinks: plan.staleLinks.map((stale) => ({
      sourceId: stale.source.id,
      targetReference: stale.targetReference,
    })),
    blockers: plan.blockers,
  });
}

function executionSelector(
  input: ExecuteWorkItemImportInput,
  plan: WorkItemImportPlan,
): { project?: string; projectRoot?: string; componentId?: string } {
  return {
    ...(input.project
      ? { project: input.project }
      : { projectRoot: path.resolve(input.projectRoot ?? plan.projectRoot) }),
    componentId: input.componentId ?? plan.componentId,
  };
}

function importExecutionAuthorityDecisions(
  plan: WorkItemImportPlan,
  authority: WorkItemImportExecutionAuthorityInput | null | undefined,
): WorkItemImportAuthorityDecisionSummary {
  const actor = authority?.actor ?? {};
  const authProfile = authority?.authProfile ?? null;
  return {
    sourceRead: resolveNexusEffectiveAuthority({
      authority: authority?.authority,
      actor,
      authProfile,
      project: plan.projectId,
      component: plan.componentId,
      provider: plan.sourceTracker.provider,
      tracker: plan.sourceTracker.trackerId,
      requestedAction: "provider.state.read",
    }),
    targetWrite: resolveNexusEffectiveAuthority({
      authority: authority?.authority,
      actor,
      authProfile: null,
      project: plan.projectId,
      component: plan.componentId,
      provider: plan.targetTracker.provider,
      tracker: plan.targetTracker.trackerId,
      requestedAction: "work_item.update",
    }),
  };
}

function executionPolicyBlockers(
  plan: WorkItemImportPlan,
  policy: WorkItemImportPolicyConfig,
  authority: WorkItemImportAuthorityDecisionSummary,
): WorkItemImportRunBlocker[] {
  const normalized = normalizeWorkItemImportPolicy(policy);
  const blockers: WorkItemImportRunBlocker[] = [];
  if (policy.direction !== "external_to_local") {
    blockers.push({
      operation: "direction",
      message:
        "Inbound import execution requires explicit direction external_to_local.",
    });
  } else if (normalized.direction !== "external_to_local") {
    blockers.push({
      operation: "direction",
      message: `Import direction "${normalized.direction}" is not supported for execution.`,
    });
  }
  if (normalized.writePolicy.mode !== "execute") {
    blockers.push({
      operation: "write_policy",
      message: `Write policy mode "${normalized.writePolicy.mode}" is not allowed for execution.`,
    });
  }
  if (
    plan.sourceTracker.provider !== "github" ||
    plan.targetTracker.provider !== "local"
  ) {
    blockers.push({
      operation: "provider_path",
      message:
        "Work item import execution currently supports only GitHub source trackers to local target trackers.",
    });
  }
  if (normalized.writePolicy.credentials !== "available") {
    blockers.push({
      operation: "credentials",
      message:
        "Inbound import execution requires explicit available source provider credentials policy.",
    });
  }
  if (!authority.sourceRead.allowed) {
    blockers.push({
      operation: "authority.provider_read",
      message: authority.sourceRead.explanation,
    });
  }
  if (!authority.targetWrite.allowed) {
    blockers.push({
      operation: "authority.work_item_update",
      message: authority.targetWrite.explanation,
    });
  }

  return blockers;
}

function createInputFromImportPlan(createPlan: WorkItemImportCreatePlan): {
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
} {
  const patch = patchFromFieldValues(createPlan.fields);
  if (patch.title === undefined) {
    throw new Error(
      `Create plan for source item "${createPlan.source.id}" does not include owned title field.`,
    );
  }

  return {
    title: patch.title,
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
    ...(patch.assignees !== undefined ? { assignees: patch.assignees } : {}),
    ...(patch.milestone !== undefined ? { milestone: patch.milestone } : {}),
  };
}

function patchFromChanges(changes: WorkItemSyncFieldChange[]): WorkItemPatch {
  return patchFromFieldValues(
    changes.map((change) => ({
      field: change.field,
      value: change.plannedValue,
    })),
  );
}

function patchFromFieldValues(
  values: WorkItemSyncFieldValue[],
): WorkItemPatch {
  const patch: WorkItemPatch = {};
  for (const value of values) {
    assignPatchValue(patch, value.field, value.value);
  }

  return patch;
}

function assignPatchValue(
  patch: WorkItemPatch,
  field: WorkItemSyncField,
  value: unknown,
): void {
  switch (field) {
    case "title":
      patch.title = String(value);
      break;
    case "description":
      patch.description = value === null ? null : String(value);
      break;
    case "status":
      patch.status = value as WorkStatus;
      break;
    case "labels":
      patch.labels = Array.isArray(value) ? value.map(String) : [];
      break;
    case "assignees":
      patch.assignees = Array.isArray(value) ? value.map(String) : [];
      break;
    case "milestone":
      patch.milestone = value === null ? null : String(value);
      break;
  }
}

function linkInputFromPlannedLink(
  plannedLink: WorkItemImportPlannedLink,
): Omit<
  WorkItemTrackerReference,
  "trackerId" | "trackerName" | "firstObservedAt" | "lastObservedAt"
> & { observedAt?: string | null } {
  return {
    ...plannedLink.reference,
  };
}

function importRunSummary(options: {
  plan: WorkItemImportPlan;
  status: WorkItemImportRunStatus;
  startedAt: string;
  finishedAt: string;
  created: number;
  updated: number;
  skipped: number;
  conflicted: number;
  blocked: number;
  links: number;
  ambiguousDuplicates: number;
  staleLinks: number;
}): WorkItemImportRunSummary {
  const id = `import-run-${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        projectId: options.plan.projectId,
        componentId: options.plan.componentId,
        sourceTrackerId: options.plan.sourceTracker.trackerId,
        targetTrackerId: options.plan.targetTracker.trackerId,
        startedAt: options.startedAt,
      }),
    )
    .digest("hex")
    .slice(0, 12)}`;
  return {
    id,
    status: options.status,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    projectRoot: options.plan.projectRoot,
    projectId: options.plan.projectId,
    componentId: options.plan.componentId,
    sourceTrackerId: options.plan.sourceTracker.trackerId,
    targetTrackerId: options.plan.targetTracker.trackerId,
    planGeneratedAt: options.plan.generatedAt,
    counts: {
      created: options.created,
      updated: options.updated,
      skipped: options.skipped,
      conflicted: options.conflicted,
      blocked: options.blocked,
      links: options.links,
      ambiguousDuplicates: options.ambiguousDuplicates,
      staleLinks: options.staleLinks,
    },
  };
}

function fieldValues(
  desired: Partial<Record<WorkItemSyncField, unknown>>,
): WorkItemSyncFieldValue[] {
  return Object.entries(desired).map(([field, value]) => ({
    field: field as WorkItemSyncField,
    value,
  }));
}

function summarizeWorkItem(
  item: WorkItem,
  trackerId?: string,
): WorkItemSyncItemSummary {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    trackerId: item.trackerRef?.trackerId ?? trackerId,
    provider: item.provider,
    updatedAt: item.updatedAt ?? null,
    ...(item.externalRef ? { externalRef: item.externalRef } : {}),
    ...(item.webUrl !== undefined ? { webUrl: item.webUrl } : {}),
  };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right));
}

function comparableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value].map(String).sort((left, right) => left.localeCompare(right));
  }

  return value ?? null;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function isCredentialError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /\b401\b|\b403\b|unauthori[sz]ed|forbidden/i.test(message) ||
    /No (GitHub|GitLab|Jira) token/i.test(message) ||
    /credential (was|is) (not )?available/i.test(message)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowString(now: (() => Date | string) | undefined): string {
  const value = now ? now() : new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function requiredSelector(input: CreateWorkItemImportPlanInput): string {
  const projectRoot = input.projectRoot?.trim();
  const project = input.project?.trim();
  if (projectRoot && project) {
    throw new Error("Provide either project or projectRoot, not both");
  }
  if (projectRoot) {
    return projectRoot;
  }
  if (project) {
    return project;
  }

  throw new Error("project or projectRoot is required");
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
