import {
  buildNexusInitiativeDeliveryReport,
  type NexusInitiativeDeliveryReport,
  type NexusInitiativeDeliveryReportItem,
} from "./nexusInitiativeDeliveryReport.js";
import {
  buildNexusMergeQueueReadinessReport,
  type NexusMergeQueueReadinessReport,
  type NexusMergeQueueWorkflowTriggerInput,
} from "./nexusMergeQueueReadiness.js";
import type {
  NexusPublicationProviderEvidenceInput,
} from "./nexusPublicationProviderEvidence.js";

export type NexusInitiativeFinalizationNextAction =
  | "create_pull_request"
  | "collect_provider_evidence"
  | "update_branch"
  | "resolve_conflicts"
  | "resolve_branch_policy"
  | "resolve_failed_checks"
  | "wait_for_checks"
  | "request_review"
  | "mark_ready_for_review"
  | "request_publication_approval"
  | "wait";

export type NexusInitiativeReviewReadinessStatus =
  | "needs_final_pull_request"
  | "needs_provider_evidence"
  | "needs_update"
  | "blocked"
  | "checks_failed"
  | "checks_pending"
  | "wait"
  | "ready_for_review";

export type NexusInitiativePublicationReadinessStatus =
  | "needs_final_pull_request"
  | "needs_provider_evidence"
  | "needs_update"
  | "blocked"
  | "checks_failed"
  | "checks_pending"
  | "wait"
  | "needs_review"
  | "blocked_by_draft"
  | "ready_for_publication";

type NexusInitiativeSharedReadinessStatus =
  | "needs_final_pull_request"
  | "needs_provider_evidence"
  | "needs_update"
  | "blocked"
  | "checks_failed"
  | "checks_pending"
  | "wait";

export interface NexusInitiativeReadinessDecision<
  TStatus extends string = string,
> {
  status: TStatus;
  nextAction: NexusInitiativeFinalizationNextAction;
  reasons: string[];
}

export interface NexusInitiativePublicationAuthority {
  authorizedToMerge: false;
  humanInTheLoop: true;
  reason: string;
}

export interface NexusInitiativeMergeQueueFinalizationSummary {
  enabled: boolean;
  nextAction: NexusMergeQueueReadinessReport["nextAction"];
  protectedTargetStatus: NexusMergeQueueReadinessReport["protectedTargetGate"]["status"];
  blockers: string[];
  warnings: string[];
}

export interface NexusInitiativeFinalizationPlanItem {
  componentId: string;
  initiativeId: string;
  integrationBranch: string | null;
  finalPublicationTarget: string;
  finalPullRequestCreation: string;
  reviewTarget: string;
  providerEvidence: NexusInitiativeDeliveryReportItem["providerEvidence"];
  reviewReadiness: NexusInitiativeReadinessDecision<NexusInitiativeReviewReadinessStatus> & {
    safeToReview: boolean;
  };
  publicationReadiness: NexusInitiativeReadinessDecision<NexusInitiativePublicationReadinessStatus> & {
    authorizedToMerge: false;
  };
  publicationAuthority: NexusInitiativePublicationAuthority;
  mergeQueue: NexusInitiativeMergeQueueFinalizationSummary | null;
  warnings: string[];
}

export interface NexusInitiativeFinalizationPlanSummary {
  itemCount: number;
  safeToReviewCount: number;
  readyForPublicationCount: number;
  needsFinalPullRequestCount: number;
  needsProviderEvidenceCount: number;
  needsUpdateCount: number;
  blockedCount: number;
  checksFailedCount: number;
  checksPendingCount: number;
  needsReviewCount: number;
}

export interface NexusInitiativeFinalizationPlan {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: NexusInitiativeDeliveryReport["project"];
  componentId: string | null;
  initiativeId: string | null;
  summary: NexusInitiativeFinalizationPlanSummary;
  nextAction: NexusInitiativeFinalizationNextAction;
  deliveryReport: NexusInitiativeDeliveryReport;
  items: NexusInitiativeFinalizationPlanItem[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusInitiativeFinalizationPlan(options: {
  projectRoot: string;
  componentId?: string;
  initiativeId?: string | null;
  providerEvidence?: NexusPublicationProviderEvidenceInput[];
  fullMatrixBudgetAvailable?: boolean | null;
  mergeQueueEnabled?: boolean | null;
  workflowTriggers?: NexusMergeQueueWorkflowTriggerInput[];
  now?: Date | string | (() => Date | string);
}): NexusInitiativeFinalizationPlan {
  const deliveryReport = buildNexusInitiativeDeliveryReport({
    projectRoot: options.projectRoot,
    componentId: options.componentId,
    initiativeId: options.initiativeId,
    providerEvidence: options.providerEvidence,
    fullMatrixBudgetAvailable: options.fullMatrixBudgetAvailable,
    now: options.now,
  });
  const items = deliveryReport.items.map((item) =>
    finalizationItem({
      item,
      projectRoot: options.projectRoot,
      providerEvidence: options.providerEvidence ?? [],
      mergeQueueEnabled: options.mergeQueueEnabled,
      workflowTriggers: options.workflowTriggers ?? [],
      now: options.now,
    })
  );

  return {
    version: 1,
    generatedAt: deliveryReport.generatedAt,
    projectRoot: deliveryReport.projectRoot,
    project: deliveryReport.project,
    componentId: deliveryReport.componentId,
    initiativeId: deliveryReport.initiativeId,
    summary: summarizeItems(items),
    nextAction: nextAction(items),
    deliveryReport,
    items,
    warnings: deliveryReport.warnings,
    mutatesSource: false,
  };
}

function finalizationItem(options: {
  item: NexusInitiativeDeliveryReportItem;
  projectRoot: string;
  providerEvidence: NexusPublicationProviderEvidenceInput[];
  mergeQueueEnabled?: boolean | null;
  workflowTriggers: NexusMergeQueueWorkflowTriggerInput[];
  now?: Date | string | (() => Date | string);
}): NexusInitiativeFinalizationPlanItem {
  const reviewDecision = classifyReviewReadiness(options.item);
  const mergeQueue = mergeQueueSummary(options);
  const publicationDecision = classifyPublicationReadiness(options.item, mergeQueue);

  return {
    componentId: options.item.componentId,
    initiativeId: options.item.initiativeId,
    integrationBranch: options.item.integrationBranch,
    finalPublicationTarget: options.item.finalPublicationTarget,
    finalPullRequestCreation: options.item.finalPullRequestCreation,
    reviewTarget: options.item.finalReviewTarget,
    providerEvidence: options.item.providerEvidence,
    reviewReadiness: {
      ...reviewDecision,
      safeToReview: reviewDecision.status === "ready_for_review",
    },
    publicationReadiness: {
      ...publicationDecision,
      authorizedToMerge: false,
    },
    publicationAuthority: {
      authorizedToMerge: false,
      humanInTheLoop: true,
      reason: "final publication is a human-in-the-loop gate",
    },
    mergeQueue,
    warnings: options.item.warnings,
  };
}

function classifyReviewReadiness(
  item: NexusInitiativeDeliveryReportItem,
): NexusInitiativeReadinessDecision<NexusInitiativeReviewReadinessStatus> {
  const blocker = sharedReadinessBlocker(item);
  if (blocker) {
    return blocker;
  }
  return {
    status: "ready_for_review",
    nextAction:
      item.finalPullRequest && item.providerEvidence.reviewState !== "approved"
        ? "request_review"
        : "wait",
    reasons: [],
  };
}

function classifyPublicationReadiness(
  item: NexusInitiativeDeliveryReportItem,
  mergeQueue: NexusInitiativeMergeQueueFinalizationSummary | null,
): NexusInitiativeReadinessDecision<NexusInitiativePublicationReadinessStatus> {
  const blocker = sharedReadinessBlocker(item);
  if (blocker) {
    return blocker;
  }
  const evidence = item.providerEvidence;
  if (item.finalPullRequest && evidence.reviewState !== "approved") {
    return {
      status: "needs_review",
      nextAction: "request_review",
      reasons: [
        `pull request review state is ${evidence.reviewState ?? "unknown"}`,
      ],
    };
  }
  if (evidence.branchPolicy === "blocked") {
    return {
      status: evidence.draft === true ? "blocked_by_draft" : "blocked",
      nextAction: evidence.draft === true
        ? "mark_ready_for_review"
        : "resolve_branch_policy",
      reasons: [
        evidence.draft === true ? "pull request is draft" : "branch policy is blocked",
      ],
    };
  }
  if (mergeQueue?.nextAction === "wait") {
    return {
      status: "checks_pending",
      nextAction: "wait_for_checks",
      reasons: ["merge queue protected target validation is still pending"],
    };
  }
  if (
    mergeQueue?.nextAction === "resolve_blockers" ||
    mergeQueue?.nextAction === "update_workflow"
  ) {
    return {
      status: "blocked",
      nextAction: "resolve_branch_policy",
      reasons: [...mergeQueue.blockers],
    };
  }

  return {
    status: "ready_for_publication",
    nextAction: "request_publication_approval",
    reasons: ["final publication requires human approval"],
  };
}

function sharedReadinessBlocker(
  item: NexusInitiativeDeliveryReportItem,
): NexusInitiativeReadinessDecision<NexusInitiativeSharedReadinessStatus> | null {
  const evidence = item.providerEvidence;
  if (!evidence.provider) {
    if (
      item.finalPullRequest &&
      item.finalPullRequestCreation === "at_review_gate"
    ) {
      return {
        status: "needs_final_pull_request",
        nextAction: "create_pull_request",
        reasons: ["final pull request is created at the review gate"],
      };
    }
    return {
      status: "needs_provider_evidence",
      nextAction: "collect_provider_evidence",
      reasons: ["provider evidence is unavailable"],
    };
  }
  if (evidence.mergeability === "conflicting") {
    return {
      status: "blocked",
      nextAction: "resolve_conflicts",
      reasons: ["review branch has merge conflicts"],
    };
  }
  if (evidence.baseStatus === "behind" || evidence.baseStatus === "diverged") {
    return {
      status: "needs_update",
      nextAction: "update_branch",
      reasons: [`review branch base status is ${evidence.baseStatus}`],
    };
  }
  if (evidence.checksStatus === "failed" || evidence.checksStatus === "missing") {
    return {
      status: "checks_failed",
      nextAction: "resolve_failed_checks",
      reasons: [evidence.checksMessage],
    };
  }
  if (
    evidence.checksStatus === "pending" ||
    evidence.checksStatus === "stale" ||
    evidence.checksStatus === "unavailable"
  ) {
    return {
      status: "checks_pending",
      nextAction: "wait_for_checks",
      reasons: [evidence.checksMessage],
    };
  }
  if (item.ciTier.budgetLimited) {
    return {
      status: "wait",
      nextAction: "wait",
      reasons: ["full matrix CI budget is exhausted"],
    };
  }
  return null;
}

function mergeQueueSummary(options: {
  item: NexusInitiativeDeliveryReportItem;
  projectRoot: string;
  providerEvidence: NexusPublicationProviderEvidenceInput[];
  mergeQueueEnabled?: boolean | null;
  workflowTriggers: NexusMergeQueueWorkflowTriggerInput[];
  now?: Date | string | (() => Date | string);
}): NexusInitiativeMergeQueueFinalizationSummary | null {
  if (options.mergeQueueEnabled !== true) {
    return null;
  }
  const report = buildNexusMergeQueueReadinessReport({
    projectRoot: options.projectRoot,
    componentId: options.item.componentId,
    mergeQueueEnabled: options.mergeQueueEnabled,
    workflowTriggers: options.workflowTriggers,
    providerEvidence: options.providerEvidence,
    now: options.now,
  });
  return {
    enabled: report.mergeQueue.enabled,
    nextAction: report.nextAction,
    protectedTargetStatus: report.protectedTargetGate.status,
    blockers: report.blockers,
    warnings: report.warnings,
  };
}

function summarizeItems(
  items: NexusInitiativeFinalizationPlanItem[],
): NexusInitiativeFinalizationPlanSummary {
  return {
    itemCount: items.length,
    safeToReviewCount: items.filter((item) => item.reviewReadiness.safeToReview)
      .length,
    readyForPublicationCount: items.filter((item) =>
      item.publicationReadiness.status === "ready_for_publication"
    ).length,
    needsFinalPullRequestCount: items.filter((item) =>
      item.publicationReadiness.status === "needs_final_pull_request"
    ).length,
    needsProviderEvidenceCount: items.filter((item) =>
      item.publicationReadiness.status === "needs_provider_evidence"
    ).length,
    needsUpdateCount: items.filter((item) =>
      item.publicationReadiness.status === "needs_update"
    ).length,
    blockedCount: items.filter((item) =>
      item.publicationReadiness.status === "blocked" ||
      item.publicationReadiness.status === "blocked_by_draft"
    ).length,
    checksFailedCount: items.filter((item) =>
      item.publicationReadiness.status === "checks_failed"
    ).length,
    checksPendingCount: items.filter((item) =>
      item.publicationReadiness.status === "checks_pending"
    ).length,
    needsReviewCount: items.filter((item) =>
      item.publicationReadiness.status === "needs_review"
    ).length,
  };
}

function nextAction(
  items: NexusInitiativeFinalizationPlanItem[],
): NexusInitiativeFinalizationNextAction {
  const actions = items.flatMap((item) => [
    item.reviewReadiness.nextAction,
    item.publicationReadiness.nextAction,
  ]);
  for (const action of [
    "resolve_conflicts",
    "update_branch",
    "resolve_failed_checks",
    "wait_for_checks",
    "resolve_branch_policy",
    "create_pull_request",
    "request_review",
    "mark_ready_for_review",
    "request_publication_approval",
    "collect_provider_evidence",
    "wait",
  ] satisfies NexusInitiativeFinalizationNextAction[]) {
    if (actions.includes(action)) {
      return action;
    }
  }
  return items.length > 0 ? "request_publication_approval" : "wait";
}
