import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createWorkItemService,
  type ResolvedWorkItemProviderContext,
  type WorkItemProjectResolver,
  type WorkItemProviderFactory,
} from "./workItemService.js";
import {
  createWorkItemTrackerLinkService,
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  type WorkItemTrackerLinkRecord,
  type WorkItemTrackerReference,
} from "./workItemTrackerLinks.js";
import {
  workTrackerCapabilityReport,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import type {
  ExternalRef,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkStatus,
  WorkComment,
  WorkTrackerCapabilityName,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export const workItemSyncFields = [
  "title",
  "description",
  "status",
  "labels",
  "assignees",
  "milestone",
] as const;

export type WorkItemSyncField = (typeof workItemSyncFields)[number];
export type WorkItemSyncDirection = "source_to_target";
export type WorkItemSyncCommentPolicyMode = "ignore" | "plan";
export type WorkItemSyncConflictPolicyMode =
  | "block"
  | "source_wins"
  | "target_wins";
export type WorkItemSyncWriteDisposition = "plan" | "skip" | "block";
export type WorkItemSyncCredentialPolicy =
  | "not_required"
  | "available"
  | "missing";

export interface WorkItemSyncFilters {
  status?: WorkStatus | WorkStatus[];
  labels?: string[];
  assignees?: string[];
  search?: string;
  limit?: number;
}

export interface WorkItemSyncCommentPolicyConfig {
  mode: WorkItemSyncCommentPolicyMode;
}

export interface WorkItemSyncConflictPolicyConfig {
  mode: WorkItemSyncConflictPolicyMode;
}

export interface WorkItemSyncWritePolicyConfig {
  mode: "dry_run" | string;
  creates?: WorkItemSyncWriteDisposition;
  updates?: WorkItemSyncWriteDisposition;
  credentials?: WorkItemSyncCredentialPolicy;
  reason?: string | null;
}

export interface WorkItemSyncPolicyConfig {
  sourceTrackerId: string;
  targetTrackerId: string;
  direction: WorkItemSyncDirection | string;
  filters?: WorkItemSyncFilters;
  fieldSet?: WorkItemSyncField[];
  commentPolicy?: WorkItemSyncCommentPolicyConfig;
  statusMapping?: Partial<Record<WorkStatus, WorkStatus>>;
  conflictPolicy?: WorkItemSyncConflictPolicyConfig;
  writePolicy?: WorkItemSyncWritePolicyConfig;
}

export interface CreateWorkItemSyncPlanInput {
  project?: string;
  projectRoot?: string;
  componentId?: string;
  policy: WorkItemSyncPolicyConfig;
  resolveProject: WorkItemProjectResolver;
  providerFactory?: WorkItemProviderFactory;
  providerOptions?: Omit<CreateWorkTrackerProviderOptions, "projectRoot" | "now">;
  now?: () => Date | string;
}

export interface WorkItemSyncTrackerSummary {
  trackerId: string;
  trackerName: string;
  provider: string;
  roles: string[];
  capabilities: ReturnType<typeof workTrackerCapabilityReport>;
}

export interface WorkItemSyncItemSummary {
  id: string;
  title: string;
  status: WorkStatus;
  trackerId?: string;
  provider: string;
  updatedAt: string | null;
  externalRef?: ExternalRef;
  webUrl?: string | null;
}

export interface WorkItemSyncFieldValue {
  field: WorkItemSyncField;
  value: unknown;
}

export interface WorkItemSyncFieldChange {
  field: WorkItemSyncField;
  sourceValue: unknown;
  targetValue: unknown;
  plannedValue: unknown;
}

export type WorkItemSyncTargetDetection =
  | "linked"
  | "unlinked"
  | "stale_link";

export interface WorkItemSyncCreatePlan {
  source: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetDetection: WorkItemSyncTargetDetection;
  fields: WorkItemSyncFieldValue[];
}

export interface WorkItemSyncUpdatePlan {
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetDetection: WorkItemSyncTargetDetection;
  targetReference: WorkItemTrackerReference;
  fields: WorkItemSyncFieldChange[];
  conflictFields: WorkItemSyncFieldChange[];
}

interface MatchedLinkRecord {
  record: WorkItemTrackerLinkRecord;
  sourceMatch: "logical" | "reference";
}

export interface WorkItemSyncSkipPlan {
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

export interface WorkItemSyncConflictPlan {
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  targetTrackerId: string;
  targetReference: WorkItemTrackerReference;
  fields: WorkItemSyncFieldChange[];
  policy: WorkItemSyncConflictPolicyConfig;
}

export interface WorkItemSyncMissingProviderCapability {
  trackerId: string;
  provider: string;
  capability: WorkTrackerCapabilityName;
  operation: string;
  effect: "skip" | "block";
  message: string;
}

export interface WorkItemSyncMissingCredentials {
  trackerId: string;
  provider: string;
  operation: string;
  message: string;
}

export interface WorkItemSyncPolicyBlock {
  operation: string;
  reason: string;
}

export interface WorkItemSyncBlocker {
  kind:
    | "missing_provider_capability"
    | "missing_credentials"
    | "policy_block"
    | "provider_read_failure";
  trackerId?: string;
  provider?: string;
  operation: string;
  message: string;
}

export interface WorkItemSyncLinkedTarget {
  status: "linked" | "stale";
  source: WorkItemSyncItemSummary;
  target?: WorkItemSyncItemSummary;
  targetReference: WorkItemTrackerReference;
}

export interface WorkItemSyncPlanCounts {
  sourceItems: number;
  targetItems: number;
  creates: number;
  updates: number;
  skips: number;
  conflicts: number;
  missingProviderCapabilities: number;
  missingCredentials: number;
  policyBlocks: number;
  blockers: number;
  linkedTargets: number;
  unlinkedTargets: number;
  staleLinks: number;
}

export interface WorkItemSyncPlan {
  dryRun: true;
  generatedAt: string;
  projectRoot: string;
  projectId: string;
  componentId: string;
  sourceTracker: WorkItemSyncTrackerSummary;
  targetTracker: WorkItemSyncTrackerSummary;
  policy: Required<WorkItemSyncPolicyConfig>;
  counts: WorkItemSyncPlanCounts;
  creates: WorkItemSyncCreatePlan[];
  updates: WorkItemSyncUpdatePlan[];
  skips: WorkItemSyncSkipPlan[];
  conflicts: WorkItemSyncConflictPlan[];
  missingProviderCapabilities: WorkItemSyncMissingProviderCapability[];
  missingCredentials: WorkItemSyncMissingCredentials[];
  policyBlocks: WorkItemSyncPolicyBlock[];
  blockers: WorkItemSyncBlocker[];
  linkedTargets: WorkItemSyncLinkedTarget[];
  unlinkedTargets: WorkItemSyncItemSummary[];
}

export interface ExecuteWorkItemSyncInput extends CreateWorkItemSyncPlanInput {
  plan?: WorkItemSyncPlan;
  recordRun?: boolean;
}

export type WorkItemSyncRunStatus = "completed" | "blocked" | "failed";

export interface WorkItemSyncProviderLink {
  action: "created" | "updated";
  source: WorkItemSyncItemSummary;
  target: WorkItemSyncItemSummary;
  linkAction: "linked" | "updated" | "unchanged";
  reference: WorkItemTrackerReference;
}

export interface WorkItemSyncRunCounts {
  created: number;
  updated: number;
  skipped: number;
  conflicted: number;
  blocked: number;
  comments: number;
  links: number;
}

export interface WorkItemSyncRunBlocker {
  operation: string;
  message: string;
  source?: WorkItemSyncItemSummary;
  target?: WorkItemSyncItemSummary;
}

export interface WorkItemSyncRunSummary {
  id: string;
  status: WorkItemSyncRunStatus;
  startedAt: string;
  finishedAt: string;
  projectRoot: string;
  projectId: string;
  componentId: string;
  sourceTrackerId: string;
  targetTrackerId: string;
  planGeneratedAt: string;
  counts: WorkItemSyncRunCounts;
}

export interface WorkItemSyncRun {
  summary: WorkItemSyncRunSummary;
  status: WorkItemSyncRunStatus;
  plan: WorkItemSyncPlan;
  providerLinks: WorkItemSyncProviderLink[];
  comments: WorkComment[];
  blockers: WorkItemSyncRunBlocker[];
  skipped: WorkItemSyncSkipPlan[];
  conflicts: WorkItemSyncConflictPlan[];
  storePath?: string;
}

export interface WorkItemSyncRunStore {
  version: 1;
  updatedAt: string | null;
  runs: Array<{
    summary: WorkItemSyncRunSummary;
    providerLinks: WorkItemSyncProviderLink[];
    blockers: WorkItemSyncRunBlocker[];
  }>;
}

interface MutableWorkItemSyncPlan extends WorkItemSyncPlan {
  counts: WorkItemSyncPlanCounts;
}

const allFields: WorkItemSyncField[] = [...workItemSyncFields];
export const workItemSyncRunStoreFileName = "work-item-sync-runs.json";

export function defaultWorkItemSyncPolicy(
  overrides: Partial<WorkItemSyncPolicyConfig> & {
    sourceTrackerId: string;
    targetTrackerId: string;
  },
): WorkItemSyncPolicyConfig {
  return {
    direction: "source_to_target",
    filters: {},
    fieldSet: allFields,
    commentPolicy: {
      mode: "ignore",
    },
    statusMapping: {},
    conflictPolicy: {
      mode: "block",
    },
    writePolicy: {
      mode: "dry_run",
      creates: "plan",
      updates: "plan",
      credentials: "not_required",
    },
    ...overrides,
  };
}

export async function createWorkItemSyncPlan(
  input: CreateWorkItemSyncPlanInput,
): Promise<WorkItemSyncPlan> {
  const timestamp = nowString(input.now);
  const policy = normalizeWorkItemSyncPolicy(input.policy);
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

  validateDryRunPolicy(plan, targetContext);
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
      operation: "detect unlinked target work items",
      effect: "skip",
    });
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

  const targetItems = targetCapabilities.capabilities.list
    ? await readWorkItems({
        service,
        selector: {
          ...selector,
          trackerId: policy.targetTrackerId,
        },
        query: {},
        plan,
        context: targetContext,
        operation: "read target tracker",
      })
    : [];
  if (targetItems === null) {
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
  const linkedTargetIds = linkedTargetItemIds({
    records: componentRecords,
    sourceItems,
    sourceTrackerId: policy.sourceTrackerId,
    targetItems,
    targetTrackerId: policy.targetTrackerId,
  });
  plan.unlinkedTargets.push(
    ...targetItems
      .filter((item) => !linkedTargetIds.has(targetItemId(item)))
      .map((item) => summarizeWorkItem(item, policy.targetTrackerId)),
  );

  for (const sourceItem of sourceItems) {
    const sourceSummary = summarizeWorkItem(sourceItem, policy.sourceTrackerId);
    const match = findLinkRecordForSourceItem({
      records: componentRecords,
      sourceItem,
      sourceTrackerId: policy.sourceTrackerId,
    });
    const targetReference = match
      ? targetReferenceForRecord({
          record: match.record,
          allowLogicalTarget: match.sourceMatch === "reference",
          targetItems,
          targetContext,
          targetTrackerId: policy.targetTrackerId,
        })
      : undefined;

    if (!targetReference) {
      planCreate({
        plan,
        sourceItem,
        sourceSummary,
        targetContext,
        policy,
      });
      continue;
    }

    await planLinkedUpdate({
      service,
      selector,
      plan,
      sourceItem,
      sourceSummary,
      targetContext,
      targetReference,
      policy,
    });
  }

  refreshCounts(plan);
  return plan;
}

export async function executeWorkItemSync(
  input: ExecuteWorkItemSyncInput,
): Promise<WorkItemSyncRun> {
  const startedAt = nowString(input.now);
  const plan =
    input.plan ??
    (await createWorkItemSyncPlan({
      ...input,
      policy: plannerPolicyForExecution(input.policy),
    }));
  validateConsumedExecutionPlan(plan, input.policy);

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
  const providerLinks: WorkItemSyncProviderLink[] = [];
  const comments: WorkComment[] = [];
  const blockers: WorkItemSyncRunBlocker[] = [
    ...executionPolicyBlockers(plan, input.policy),
    ...plan.blockers.map((blocker) => ({
      operation: blocker.operation,
      message: blocker.message,
    })),
  ];

  if (blockers.length === 0) {
    for (const createPlan of plan.creates) {
      try {
        const target = await service.createWorkItem({
          ...selector,
          trackerId: plan.policy.targetTrackerId,
          ...createInputFromPlan(createPlan),
        });
        const link = await linkService.linkReference({
          ...selector,
          logicalItemId: createPlan.source.id,
          trackerId: plan.policy.targetTrackerId,
          ...linkInputFromTarget(target),
        });
        const targetSummary = summarizeWorkItem(
          target,
          plan.policy.targetTrackerId,
        );
        providerLinks.push({
          action: "created",
          source: createPlan.source,
          target: targetSummary,
          linkAction: link.action,
          reference: link.reference,
        });
        const comment = await maybeAddSyncComment({
          service,
          selector,
          plan,
          source: createPlan.source,
          target,
          action: "created",
          fields: createPlan.fields.map((field) => field.field),
        });
        if (comment) {
          comments.push(comment);
        }
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
        const target = await service.updateWorkItem({
          ...selector,
          trackerId: plan.policy.targetTrackerId,
          ref: {
            id: updatePlan.targetReference.itemId,
            externalRef: updatePlan.targetReference,
          },
          patch: patchFromChanges(updatePlan.fields),
        });
        const link = await linkService.linkReference({
          ...selector,
          logicalItemId: updatePlan.source.id,
          trackerId: plan.policy.targetTrackerId,
          ...linkInputFromTarget(target),
        });
        const targetSummary = summarizeWorkItem(
          target,
          plan.policy.targetTrackerId,
        );
        providerLinks.push({
          action: "updated",
          source: updatePlan.source,
          target: targetSummary,
          linkAction: link.action,
          reference: link.reference,
        });
        const comment = await maybeAddSyncComment({
          service,
          selector,
          plan,
          source: updatePlan.source,
          target,
          action: "updated",
          fields: updatePlan.fields.map((field) => field.field),
        });
        if (comment) {
          comments.push(comment);
        }
      } catch (error) {
        blockers.push({
          operation: "update",
          message: errorMessage(error),
          source: updatePlan.source,
          target: updatePlan.target,
        });
      }
    }
  }

  const finishedAt = nowString(input.now);
  const summary = runSummary({
    plan,
    status:
      blockers.length > 0
        ? providerLinks.length > 0
          ? "failed"
          : "blocked"
        : "completed",
    startedAt,
    finishedAt,
    created: providerLinks.filter((link) => link.action === "created").length,
    updated: providerLinks.filter((link) => link.action === "updated").length,
    skipped: plan.skips.length,
    conflicted: plan.conflicts.length,
    blocked: blockers.length,
    comments: comments.length,
    links: providerLinks.length,
  });
  const run: WorkItemSyncRun = {
    summary,
    status: summary.status,
    plan,
    providerLinks,
    comments,
    blockers,
    skipped: plan.skips,
    conflicts: plan.conflicts,
  };

  if (input.recordRun !== false) {
    const storePath = appendWorkItemSyncRunRecord(plan.projectRoot, run, finishedAt);
    return {
      ...run,
      storePath,
    };
  }

  return run;
}

export function defaultWorkItemSyncRunStorePath(projectRoot: string): string {
  return path.join(
    path.resolve(requiredNonEmptyString(projectRoot, "projectRoot")),
    ".dev-nexus",
    workItemSyncRunStoreFileName,
  );
}

export function readWorkItemSyncRunStore(projectRoot: string): WorkItemSyncRunStore {
  const storePath = defaultWorkItemSyncRunStorePath(projectRoot);
  if (!fs.existsSync(storePath)) {
    return emptyWorkItemSyncRunStore();
  }

  return normalizeWorkItemSyncRunStore(
    JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function parseWorkItemSyncField(
  value: string,
  pathName: string,
): WorkItemSyncField {
  if ((workItemSyncFields as readonly string[]).includes(value)) {
    return value as WorkItemSyncField;
  }

  throw new Error(
    `${pathName} must be title, description, status, labels, assignees, or milestone`,
  );
}

export function parseWorkItemSyncDirection(
  value: string,
  pathName: string,
): WorkItemSyncDirection {
  if (value === "source_to_target") {
    return value;
  }

  throw new Error(`${pathName} must be source_to_target`);
}

export function parseWorkItemSyncCommentPolicyMode(
  value: string,
  pathName: string,
): WorkItemSyncCommentPolicyMode {
  if (value === "ignore" || value === "plan") {
    return value;
  }

  throw new Error(`${pathName} must be ignore or plan`);
}

export function parseWorkItemSyncConflictPolicyMode(
  value: string,
  pathName: string,
): WorkItemSyncConflictPolicyMode {
  if (value === "block" || value === "source_wins" || value === "target_wins") {
    return value;
  }

  throw new Error(`${pathName} must be block, source_wins, or target_wins`);
}

export function parseWorkItemSyncWriteDisposition(
  value: string,
  pathName: string,
): WorkItemSyncWriteDisposition {
  if (value === "plan" || value === "skip" || value === "block") {
    return value;
  }

  throw new Error(`${pathName} must be plan, skip, or block`);
}

export function parseWorkItemSyncCredentialPolicy(
  value: string,
  pathName: string,
): WorkItemSyncCredentialPolicy {
  if (value === "not_required" || value === "available" || value === "missing") {
    return value;
  }

  throw new Error(`${pathName} must be not_required, available, or missing`);
}

async function planLinkedUpdate(options: {
  service: ReturnType<typeof createWorkItemService>;
  selector: { project?: string; projectRoot?: string; componentId?: string };
  plan: MutableWorkItemSyncPlan;
  sourceItem: WorkItem;
  sourceSummary: WorkItemSyncItemSummary;
  targetContext: ResolvedWorkItemProviderContext;
  targetReference: WorkItemTrackerReference;
  policy: Required<WorkItemSyncPolicyConfig>;
}): Promise<void> {
  const targetCapabilities = workTrackerCapabilityReport(
    options.targetContext.provider,
  );
  if (!targetCapabilities.capabilities.get) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: "get",
      operation: "read linked target work item",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot read linked work items.`,
      source: options.sourceSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  const targetItem = await readLinkedTargetItem(options);
  if (targetItem === null) {
    options.plan.linkedTargets.push({
      status: "stale",
      source: options.sourceSummary,
      targetReference: options.targetReference,
    });
    options.plan.skips.push({
      reason: "stale_link",
      message: `Linked target item "${options.targetReference.itemId}" was not found.`,
      source: options.sourceSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }
  if (targetItem === undefined) {
    return;
  }

  const targetSummary = summarizeWorkItem(
    targetItem,
    options.policy.targetTrackerId,
  );
  options.plan.linkedTargets.push({
    status: "linked",
    source: options.sourceSummary,
    target: targetSummary,
    targetReference: options.targetReference,
  });

  const fieldChanges = changedFields(
    desiredFields(options.sourceItem, options.policy),
    targetItem,
  );
  if (fieldChanges.length === 0) {
    options.plan.skips.push({
      reason: "up_to_date",
      message: "Linked target already matches the selected source fields.",
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  const conflictFields = targetChangedAfterLink(
    targetItem,
    options.targetReference,
  )
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
        message: "Target changed after the link was observed; conflict policy keeps target values.",
        source: options.sourceSummary,
        target: targetSummary,
        targetTrackerId: options.policy.targetTrackerId,
        targetReference: options.targetReference,
      });
      return;
    }
  }

  if (!targetCapabilities.capabilities.update) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: "update",
      operation: "plan update work items",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot update work items.`,
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  const fieldCapability = missingFieldCapability({
    provider: options.targetContext.provider,
    patch: patchFromChanges(fieldChanges),
    operation: "plan update work item fields",
  });
  if (fieldCapability) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: fieldCapability,
      operation: "plan update work item fields",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot update field capability "${fieldCapability}".`,
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  const disposition = options.policy.writePolicy.updates ?? "plan";
  if (disposition !== "plan") {
    handleWriteDisposition({
      plan: options.plan,
      operation: "update",
      disposition,
      reason: options.policy.writePolicy.reason,
      source: options.sourceSummary,
      target: targetSummary,
      targetTrackerId: options.policy.targetTrackerId,
      targetReference: options.targetReference,
    });
    return;
  }

  options.plan.updates.push({
    source: options.sourceSummary,
    target: targetSummary,
    targetTrackerId: options.policy.targetTrackerId,
    targetDetection: "linked",
    targetReference: options.targetReference,
    fields: fieldChanges,
    conflictFields,
  });
}

function planCreate(options: {
  plan: MutableWorkItemSyncPlan;
  sourceItem: WorkItem;
  sourceSummary: WorkItemSyncItemSummary;
  targetContext: ResolvedWorkItemProviderContext;
  policy: Required<WorkItemSyncPolicyConfig>;
}): void {
  const targetCapabilities = workTrackerCapabilityReport(
    options.targetContext.provider,
  );
  if (!targetCapabilities.capabilities.create) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: "create",
      operation: "plan create work items",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot create work items.`,
      source: options.sourceSummary,
      targetTrackerId: options.policy.targetTrackerId,
    });
    return;
  }

  const desired = desiredFields(options.sourceItem, options.policy);
  const fieldCapability = missingFieldCapability({
    provider: options.targetContext.provider,
    patch: desiredPatchForCreate(desired),
    operation: "plan create work item fields",
  });
  if (fieldCapability) {
    addMissingProviderCapability(options.plan, {
      context: options.targetContext,
      capability: fieldCapability,
      operation: "plan create work item fields",
      effect: "skip",
    });
    options.plan.skips.push({
      reason: "missing_provider_capability",
      message: `Target tracker "${options.policy.targetTrackerId}" cannot create field capability "${fieldCapability}".`,
      source: options.sourceSummary,
      targetTrackerId: options.policy.targetTrackerId,
    });
    return;
  }

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
  });
}

async function readLinkedTargetItem(options: {
  service: ReturnType<typeof createWorkItemService>;
  selector: { project?: string; projectRoot?: string; componentId?: string };
  plan: MutableWorkItemSyncPlan;
  targetContext: ResolvedWorkItemProviderContext;
  targetReference: WorkItemTrackerReference;
  policy: Required<WorkItemSyncPolicyConfig>;
}): Promise<WorkItem | null | undefined> {
  try {
    return await options.service.getWorkItem({
      ...options.selector,
      trackerId: options.policy.targetTrackerId,
      id: options.targetReference.itemId,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    if (isCredentialError(error)) {
      addMissingCredentials(options.plan, {
        context: options.targetContext,
        operation: "read linked target work item",
        message: errorMessage(error),
      });
      return undefined;
    }
    options.plan.blockers.push({
      kind: "provider_read_failure",
      trackerId: options.policy.targetTrackerId,
      provider: options.targetContext.provider.provider,
      operation: "read linked target work item",
      message: errorMessage(error),
    });
    return undefined;
  }
}

async function readWorkItems(options: {
  service: ReturnType<typeof createWorkItemService>;
  selector: { project?: string; projectRoot?: string; componentId?: string; trackerId: string };
  query: WorkItemQuery;
  plan: MutableWorkItemSyncPlan;
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
  policy: Required<WorkItemSyncPolicyConfig>,
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

function patchFromChanges(changes: WorkItemSyncFieldChange[]): WorkItemPatch {
  const patch: WorkItemPatch = {};
  for (const change of changes) {
    assignPatchValue(patch, change.field, change.plannedValue);
  }

  return patch;
}

function desiredPatchForCreate(
  desired: Partial<Record<WorkItemSyncField, unknown>>,
): WorkItemPatch {
  const patch: WorkItemPatch = {};
  for (const [field, value] of Object.entries(desired)) {
    assignPatchValue(patch, field as WorkItemSyncField, value);
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
      patch.title = typeof value === "string" ? value : String(value);
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

function missingFieldCapability(options: {
  provider: WorkTrackerProvider;
  patch: WorkItemPatch;
  operation: string;
}): WorkTrackerCapabilityName | null {
  const capabilities = workTrackerCapabilityReport(options.provider).capabilities;
  if (Object.prototype.hasOwnProperty.call(options.patch, "labels") && !capabilities.labels) {
    return "labels";
  }
  if (
    Object.prototype.hasOwnProperty.call(options.patch, "assignees") &&
    !capabilities.assignees
  ) {
    return "assignees";
  }
  if (
    Object.prototype.hasOwnProperty.call(options.patch, "milestone") &&
    options.patch.milestone !== null &&
    !capabilities.milestones
  ) {
    return "milestones";
  }

  return null;
}

function linkedTargetItemIds(options: {
  records: WorkItemTrackerLinkRecord[];
  sourceItems: WorkItem[];
  sourceTrackerId: string;
  targetItems: WorkItem[];
  targetTrackerId: string;
}): Set<string> {
  const linkedIds = new Set(
    options.records.flatMap((record) =>
      record.references
        .filter((reference) => reference.trackerId === options.targetTrackerId)
        .map((reference) => reference.itemId),
    ),
  );

  for (const record of options.records) {
    if (
      !record.references.some(
        (reference) =>
          reference.trackerId === options.sourceTrackerId &&
          options.sourceItems.some((sourceItem) =>
            referenceMatchesWorkItem(reference, sourceItem),
          ),
      )
    ) {
      continue;
    }

    const logicalTarget = options.targetItems.find((item) =>
      targetItemMatchesLogicalItem(item, record.logicalItemId),
    );
    if (logicalTarget) {
      linkedIds.add(targetItemId(logicalTarget));
    }
  }

  return linkedIds;
}

function findLinkRecordForSourceItem(options: {
  records: WorkItemTrackerLinkRecord[];
  sourceItem: WorkItem;
  sourceTrackerId: string;
}): MatchedLinkRecord | undefined {
  const logicalRecord = options.records.find(
    (candidate) => candidate.logicalItemId === options.sourceItem.id,
  );
  if (logicalRecord) {
    return {
      record: logicalRecord,
      sourceMatch: "logical",
    };
  }

  const referencedRecord = options.records.find((candidate) =>
    candidate.references.some(
      (reference) =>
        reference.trackerId === options.sourceTrackerId &&
        referenceMatchesWorkItem(reference, options.sourceItem),
    ),
  );
  return referencedRecord
    ? {
        record: referencedRecord,
        sourceMatch: "reference",
      }
    : undefined;
}

function targetReferenceForRecord(options: {
  record: WorkItemTrackerLinkRecord;
  allowLogicalTarget: boolean;
  targetItems: WorkItem[];
  targetContext: ResolvedWorkItemProviderContext;
  targetTrackerId: string;
}): WorkItemTrackerReference | undefined {
  const directReference = options.record.references.find(
    (reference) => reference.trackerId === options.targetTrackerId,
  );
  if (directReference) {
    return directReference;
  }

  if (!options.allowLogicalTarget) {
    return undefined;
  }

  const logicalTarget = options.targetItems.find((item) =>
    targetItemMatchesLogicalItem(item, options.record.logicalItemId),
  );
  if (!logicalTarget) {
    return undefined;
  }

  return referenceFromLinkedLogicalTarget({
    record: options.record,
    targetItem: logicalTarget,
    targetContext: options.targetContext,
    targetTrackerId: options.targetTrackerId,
  });
}

function referenceFromLinkedLogicalTarget(options: {
  record: WorkItemTrackerLinkRecord;
  targetItem: WorkItem;
  targetContext: ResolvedWorkItemProviderContext;
  targetTrackerId: string;
}): WorkItemTrackerReference {
  const externalRef = options.targetItem.externalRef;
  return {
    trackerId: options.targetTrackerId,
    trackerName: options.targetContext.trackerName,
    provider: externalRef?.provider ?? options.targetItem.provider,
    host: externalRef?.host ?? null,
    repositoryId: externalRef?.repositoryId ?? null,
    repositoryOwner: externalRef?.repositoryOwner ?? null,
    repositoryName: externalRef?.repositoryName ?? null,
    projectId: externalRef?.projectId ?? null,
    boardId: externalRef?.boardId ?? null,
    itemId: targetItemId(options.targetItem),
    itemNumber: externalRef?.itemNumber ?? null,
    itemKey: externalRef?.itemKey ?? null,
    nodeId: externalRef?.nodeId ?? null,
    webUrl: externalRef?.webUrl ?? options.targetItem.webUrl ?? null,
    firstObservedAt: options.record.createdAt,
    lastObservedAt: options.record.updatedAt,
  };
}

function referenceMatchesWorkItem(
  reference: WorkItemTrackerReference,
  item: WorkItem,
): boolean {
  const externalRef = item.externalRef;
  return (
    reference.itemId === item.id ||
    reference.itemId === externalRef?.itemId ||
    (reference.itemNumber !== null &&
      reference.itemNumber !== undefined &&
      reference.itemNumber === externalRef?.itemNumber) ||
    (reference.itemKey !== null &&
      reference.itemKey !== undefined &&
      reference.itemKey === externalRef?.itemKey) ||
    (reference.nodeId !== null &&
      reference.nodeId !== undefined &&
      reference.nodeId === externalRef?.nodeId)
  );
}

function targetItemMatchesLogicalItem(
  item: WorkItem,
  logicalItemId: string,
): boolean {
  return item.id === logicalItemId || item.externalRef?.itemId === logicalItemId;
}

function handleWriteDisposition(options: {
  plan: MutableWorkItemSyncPlan;
  operation: "create" | "update";
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
    options.plan.policyBlocks.push({
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

function targetItemId(item: WorkItem): string {
  return item.externalRef?.itemId ?? item.id;
}

function addMissingProviderCapability(
  plan: MutableWorkItemSyncPlan,
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
  const key = [
    options.context.trackerId,
    options.capability,
    options.operation,
    options.effect,
  ].join("\u0000");
  if (
    !plan.missingProviderCapabilities.some(
      (entry) =>
        [
          entry.trackerId,
          entry.capability,
          entry.operation,
          entry.effect,
        ].join("\u0000") === key,
    )
  ) {
    plan.missingProviderCapabilities.push({
      trackerId: options.context.trackerId,
      provider: options.context.provider.provider,
      capability: options.capability,
      operation: options.operation,
      effect: options.effect,
      message,
    });
  }
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
  plan: MutableWorkItemSyncPlan,
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

function validateDryRunPolicy(
  plan: MutableWorkItemSyncPlan,
  targetContext: ResolvedWorkItemProviderContext,
): void {
  if (plan.policy.direction !== "source_to_target") {
    addPolicyBlock(plan, {
      operation: "direction",
      reason: `Sync direction "${plan.policy.direction}" is not supported by the dry-run planner.`,
    });
  }
  if (plan.policy.writePolicy.mode !== "dry_run") {
    addPolicyBlock(plan, {
      operation: "write_policy",
      reason: `Write policy mode "${plan.policy.writePolicy.mode}" is not allowed; this planner is dry-run only.`,
    });
  }
  if (plan.policy.commentPolicy.mode !== "ignore" && plan.policy.commentPolicy.mode !== "plan") {
    addPolicyBlock(plan, {
      operation: "comment_policy",
      reason: `Comment policy "${plan.policy.commentPolicy.mode}" is not supported by the dry-run planner.`,
    });
  }
  if (plan.policy.writePolicy.credentials === "missing") {
    addMissingCredentials(plan, {
      context: targetContext,
      operation: "read target tracker",
      message: plan.policy.writePolicy.reason ?? "Target tracker credentials are missing.",
    });
  }
}

function addPolicyBlock(
  plan: MutableWorkItemSyncPlan,
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

function emptyPlan(options: {
  timestamp: string;
  projectRoot: string;
  projectId: string;
  componentId: string;
  sourceContext: ResolvedWorkItemProviderContext;
  targetContext: ResolvedWorkItemProviderContext;
  policy: Required<WorkItemSyncPolicyConfig>;
}): MutableWorkItemSyncPlan {
  return {
    dryRun: true,
    generatedAt: options.timestamp,
    projectRoot: options.projectRoot,
    projectId: options.projectId,
    componentId: options.componentId,
    sourceTracker: trackerSummary(options.sourceContext),
    targetTracker: trackerSummary(options.targetContext),
    policy: options.policy,
    counts: {
      sourceItems: 0,
      targetItems: 0,
      creates: 0,
      updates: 0,
      skips: 0,
      conflicts: 0,
      missingProviderCapabilities: 0,
      missingCredentials: 0,
      policyBlocks: 0,
      blockers: 0,
      linkedTargets: 0,
      unlinkedTargets: 0,
      staleLinks: 0,
    },
    creates: [],
    updates: [],
    skips: [],
    conflicts: [],
    missingProviderCapabilities: [],
    missingCredentials: [],
    policyBlocks: [],
    blockers: [],
    linkedTargets: [],
    unlinkedTargets: [],
  };
}

function trackerSummary(
  context: ResolvedWorkItemProviderContext,
): WorkItemSyncTrackerSummary {
  return {
    trackerId: context.trackerId,
    trackerName: context.trackerName,
    provider: context.provider.provider,
    roles: context.trackerRoles,
    capabilities: workTrackerCapabilityReport(context.provider),
  };
}

function refreshCounts(plan: MutableWorkItemSyncPlan): void {
  plan.counts.creates = plan.creates.length;
  plan.counts.updates = plan.updates.length;
  plan.counts.skips = plan.skips.length;
  plan.counts.conflicts = plan.conflicts.length;
  plan.counts.missingProviderCapabilities =
    plan.missingProviderCapabilities.length;
  plan.counts.missingCredentials = plan.missingCredentials.length;
  plan.counts.policyBlocks = plan.policyBlocks.length;
  plan.counts.blockers = plan.blockers.length;
  plan.counts.linkedTargets = plan.linkedTargets.length;
  plan.counts.unlinkedTargets = plan.unlinkedTargets.length;
  plan.counts.staleLinks = plan.linkedTargets.filter(
    (target) => target.status === "stale",
  ).length;
}

function normalizeWorkItemSyncPolicy(
  policy: WorkItemSyncPolicyConfig,
): Required<WorkItemSyncPolicyConfig> {
  return {
    sourceTrackerId: requiredNonEmptyString(
      policy.sourceTrackerId,
      "policy.sourceTrackerId",
    ),
    targetTrackerId: requiredNonEmptyString(
      policy.targetTrackerId,
      "policy.targetTrackerId",
    ),
    direction: policy.direction ?? "source_to_target",
    filters: policy.filters ?? {},
    fieldSet: normalizeFieldSet(policy.fieldSet),
    commentPolicy: policy.commentPolicy ?? { mode: "ignore" },
    statusMapping: policy.statusMapping ?? {},
    conflictPolicy: policy.conflictPolicy ?? { mode: "block" },
    writePolicy: {
      mode: "dry_run",
      creates: "plan",
      updates: "plan",
      credentials: "not_required",
      ...policy.writePolicy,
    },
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

function requiredSelector(input: CreateWorkItemSyncPlanInput): string {
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

function plannerPolicyForExecution(
  policy: WorkItemSyncPolicyConfig,
): WorkItemSyncPolicyConfig {
  const normalized = normalizeWorkItemSyncPolicy(policy);
  return {
    ...normalized,
    writePolicy: {
      ...normalized.writePolicy,
      mode: "dry_run",
    },
  };
}

function validateConsumedExecutionPlan(
  plan: WorkItemSyncPlan,
  policy: WorkItemSyncPolicyConfig,
): void {
  const normalized = normalizeWorkItemSyncPolicy(policy);
  if (!plan.dryRun) {
    throw new Error("work item sync execution requires a dry-run plan");
  }
  if (plan.policy.sourceTrackerId !== normalized.sourceTrackerId) {
    throw new Error("work item sync plan source tracker does not match policy");
  }
  if (plan.policy.targetTrackerId !== normalized.targetTrackerId) {
    throw new Error("work item sync plan target tracker does not match policy");
  }
  if (plan.policy.direction !== normalized.direction) {
    throw new Error("work item sync plan direction does not match policy");
  }
}

function executionSelector(
  input: ExecuteWorkItemSyncInput,
  plan: WorkItemSyncPlan,
): { project?: string; projectRoot?: string; componentId?: string } {
  return {
    ...(input.project
      ? { project: input.project }
      : { projectRoot: path.resolve(input.projectRoot ?? plan.projectRoot) }),
    componentId: input.componentId ?? plan.componentId,
  };
}

function executionPolicyBlockers(
  plan: WorkItemSyncPlan,
  policy: WorkItemSyncPolicyConfig,
): WorkItemSyncRunBlocker[] {
  const normalized = normalizeWorkItemSyncPolicy(policy);
  const blockers: WorkItemSyncRunBlocker[] = [];
  if (normalized.direction !== "source_to_target") {
    blockers.push({
      operation: "direction",
      message: `Sync direction "${normalized.direction}" is not supported for execution.`,
    });
  }
  if (normalized.writePolicy.mode !== "execute") {
    blockers.push({
      operation: "write_policy",
      message: `Write policy mode "${normalized.writePolicy.mode}" is not allowed for execution.`,
    });
  }
  if (
    plan.sourceTracker.provider !== "local" ||
    plan.targetTracker.provider !== "github"
  ) {
    blockers.push({
      operation: "provider_path",
      message:
        "Work item sync execution currently supports only local source trackers to GitHub target trackers.",
    });
  }
  if (
    plan.targetTracker.provider !== "local" &&
    normalized.writePolicy.credentials !== "available"
  ) {
    blockers.push({
      operation: "credentials",
      message:
        "External work item sync execution requires explicit available credentials policy.",
    });
  }

  return blockers;
}

function createInputFromPlan(
  createPlan: WorkItemSyncCreatePlan,
): {
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

function patchFromFieldValues(fields: WorkItemSyncFieldValue[]): WorkItemPatch {
  const patch: WorkItemPatch = {};
  for (const field of fields) {
    assignPatchValue(patch, field.field, field.value);
  }

  return patch;
}

function linkInputFromTarget(target: WorkItem): {
  provider?: string;
  host?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  itemId: string;
  itemNumber?: number | null;
  itemKey?: string | null;
  nodeId?: string | null;
  webUrl?: string | null;
  observedAt?: string | null;
} {
  const externalRef = target.externalRef;
  return {
    provider: externalRef?.provider ?? target.provider,
    host: externalRef?.host ?? null,
    repositoryId: externalRef?.repositoryId ?? null,
    repositoryOwner: externalRef?.repositoryOwner ?? null,
    repositoryName: externalRef?.repositoryName ?? null,
    projectId: externalRef?.projectId ?? null,
    boardId: externalRef?.boardId ?? null,
    itemId: externalRef?.itemId ?? target.id,
    itemNumber: externalRef?.itemNumber ?? null,
    itemKey: externalRef?.itemKey ?? null,
    nodeId: externalRef?.nodeId ?? null,
    webUrl: externalRef?.webUrl ?? target.webUrl ?? null,
    observedAt: target.updatedAt ?? null,
  };
}

async function maybeAddSyncComment(options: {
  service: ReturnType<typeof createWorkItemService>;
  selector: { project?: string; projectRoot?: string; componentId?: string };
  plan: WorkItemSyncPlan;
  source: WorkItemSyncItemSummary;
  target: WorkItem;
  action: "created" | "updated";
  fields: WorkItemSyncField[];
}): Promise<WorkComment | null> {
  if (options.plan.policy.commentPolicy.mode !== "plan") {
    return null;
  }
  if (!options.plan.targetTracker.capabilities.capabilities.comment) {
    return null;
  }

  return options.service.addComment({
    ...options.selector,
    trackerId: options.plan.policy.targetTrackerId,
    ref: {
      id: options.target.externalRef?.itemId ?? options.target.id,
      externalRef: options.target.externalRef,
    },
    body: syncCommentBody(options),
  });
}

function syncCommentBody(options: {
  plan: WorkItemSyncPlan;
  source: WorkItemSyncItemSummary;
  target: WorkItem;
  action: "created" | "updated";
  fields: WorkItemSyncField[];
}): string {
  const fingerprint = syncCommentFingerprint(options);
  return [
    `<!-- dev-nexus-sync:${fingerprint} -->`,
    `DevNexus sync ${options.action} this mirror from ${options.plan.sourceTracker.trackerId}/${options.source.id}.`,
    `Owned fields: ${options.fields.join(", ") || "none"}.`,
  ].join("\n");
}

function syncCommentFingerprint(options: {
  plan: WorkItemSyncPlan;
  source: WorkItemSyncItemSummary;
  target: WorkItem;
  action: "created" | "updated";
  fields: WorkItemSyncField[];
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        projectId: options.plan.projectId,
        componentId: options.plan.componentId,
        sourceTrackerId: options.plan.sourceTracker.trackerId,
        targetTrackerId: options.plan.targetTracker.trackerId,
        sourceId: options.source.id,
        targetId: options.target.externalRef?.itemId ?? options.target.id,
        action: options.action,
        fields: options.fields,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function runSummary(options: {
  plan: WorkItemSyncPlan;
  status: WorkItemSyncRunStatus;
  startedAt: string;
  finishedAt: string;
  created: number;
  updated: number;
  skipped: number;
  conflicted: number;
  blocked: number;
  comments: number;
  links: number;
}): WorkItemSyncRunSummary {
  const id = `sync-run-${crypto
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
      comments: options.comments,
      links: options.links,
    },
  };
}

function appendWorkItemSyncRunRecord(
  projectRoot: string,
  run: WorkItemSyncRun,
  timestamp: string,
): string {
  const storePath = defaultWorkItemSyncRunStorePath(projectRoot);
  const existing = readWorkItemSyncRunStore(projectRoot);
  const store: WorkItemSyncRunStore = {
    version: 1,
    updatedAt: timestamp,
    runs: [
      ...existing.runs,
      {
        summary: run.summary,
        providerLinks: run.providerLinks,
        blockers: run.blockers,
      },
    ].slice(-100),
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify(normalizeWorkItemSyncRunStore(store), null, 2)}\n`,
    "utf8",
  );

  return storePath;
}

function emptyWorkItemSyncRunStore(): WorkItemSyncRunStore {
  return {
    version: 1,
    updatedAt: null,
    runs: [],
  };
}

function normalizeWorkItemSyncRunStore(value: unknown): WorkItemSyncRunStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyWorkItemSyncRunStore();
  }
  const record = value as Record<string, unknown>;
  const runs = Array.isArray(record.runs) ? record.runs : [];
  return {
    version: 1,
    updatedAt:
      typeof record.updatedAt === "string" || record.updatedAt === null
        ? record.updatedAt
        : null,
    runs: runs
      .filter((run): run is WorkItemSyncRunStore["runs"][number] =>
        Boolean(run && typeof run === "object" && "summary" in run),
      )
      .map((run) => ({
        summary: run.summary,
        providerLinks: Array.isArray(run.providerLinks)
          ? run.providerLinks
          : [],
        blockers: Array.isArray(run.blockers) ? run.blockers : [],
      })),
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

function isCredentialError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /\b401\b|\b403\b|unauthori[sz]ed|forbidden/i.test(message) ||
    /No (GitHub|GitLab|Jira) token/i.test(message) ||
    /credential (was|is) (not )?available/i.test(message)
  );
}

function isNotFoundError(error: unknown): boolean {
  return /not found|404/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowString(now: (() => Date | string) | undefined): string {
  const value = now ? now() : new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
