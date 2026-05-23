import {
  buildNexusFeatureBranchDeliveryReport,
  type NexusFeatureBranchDeliveryReport,
  type NexusFeatureBranchDeliveryReportItem,
} from "./nexusFeatureBranchDeliveryReport.js";
import {
  buildNexusMergeQueueReadinessReport,
  type NexusMergeQueueReadinessReport,
  type NexusMergeQueueWorkflowTriggerInput,
} from "./nexusMergeQueueReadiness.js";
import { shellQuoteArgument } from "./nexusAutomationAgentProfile.js";
import type {
  NexusPublicationProviderEvidenceInput,
} from "./nexusPublicationProviderEvidence.js";

export type NexusFeatureFinalizationNextAction =
  | "create_pull_request"
  | "manual_pull_request"
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

export type NexusFeatureReviewReadinessStatus =
  | "needs_final_pull_request"
  | "needs_provider_evidence"
  | "needs_update"
  | "blocked"
  | "checks_failed"
  | "checks_pending"
  | "wait"
  | "ready_for_review";

export type NexusFeaturePublicationReadinessStatus =
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

type NexusFeatureSharedReadinessStatus =
  | "needs_final_pull_request"
  | "needs_provider_evidence"
  | "needs_update"
  | "blocked"
  | "checks_failed"
  | "checks_pending"
  | "wait";

export interface NexusFeatureReadinessDecision<
  TStatus extends string = string,
> {
  status: TStatus;
  nextAction: NexusFeatureFinalizationNextAction;
  reasons: string[];
}

export interface NexusFeaturePublicationAuthority {
  authorizedToMerge: false;
  humanInTheLoop: true;
  reason: string;
}

export interface NexusFeatureMergeQueueFinalizationSummary {
  enabled: boolean;
  nextAction: NexusMergeQueueReadinessReport["nextAction"];
  protectedTargetStatus: NexusMergeQueueReadinessReport["protectedTargetGate"]["status"];
  blockers: string[];
  warnings: string[];
}

export type NexusFeatureFinalPullRequestActionStatus =
  | "not_required"
  | "already_exists"
  | "create_at_feature_start"
  | "create_at_review_gate"
  | "manual_only"
  | "blocked";

export interface NexusFeatureFinalPullRequestProviderAction {
  kind: "pull_request_upsert";
  componentId: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface NexusFeatureFinalPullRequestAction {
  status: NexusFeatureFinalPullRequestActionStatus;
  humanInTheLoop: boolean;
  providerAction: NexusFeatureFinalPullRequestProviderAction | null;
  cliCommand: string | null;
  reasons: string[];
}

export interface NexusFeatureFinalizationPlanItem {
  componentId: string;
  featureId: string;
  featureBranch: string | null;
  stack: NexusFeatureBranchDeliveryReportItem["stack"];
  finalPublicationTarget: string;
  finalPullRequestCreation: string;
  finalPullRequestHead: NexusFeatureBranchDeliveryReportItem["finalPullRequestHead"];
  finalPullRequestAction: NexusFeatureFinalPullRequestAction;
  branchUpdateDecision: NexusFeatureBranchDeliveryReportItem["branchUpdateDecision"];
  reviewTarget: string;
  providerEvidence: NexusFeatureBranchDeliveryReportItem["providerEvidence"];
  reviewReadiness: NexusFeatureReadinessDecision<NexusFeatureReviewReadinessStatus> & {
    safeToReview: boolean;
  };
  publicationReadiness: NexusFeatureReadinessDecision<NexusFeaturePublicationReadinessStatus> & {
    authorizedToMerge: false;
  };
  publicationAuthority: NexusFeaturePublicationAuthority;
  mergeQueue: NexusFeatureMergeQueueFinalizationSummary | null;
  warnings: string[];
}

export interface NexusFeatureFinalizationPlanSummary {
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

export interface NexusFeatureFinalizationPlan {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: NexusFeatureBranchDeliveryReport["project"];
  componentId: string | null;
  featureId: string | null;
  summary: NexusFeatureFinalizationPlanSummary;
  nextAction: NexusFeatureFinalizationNextAction;
  deliveryReport: NexusFeatureBranchDeliveryReport;
  items: NexusFeatureFinalizationPlanItem[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusFeatureFinalizationPlan(options: {
  projectRoot: string;
  componentId?: string;
  featureId?: string | null;
  providerEvidence?: NexusPublicationProviderEvidenceInput[];
  fullMatrixBudgetAvailable?: boolean | null;
  mergeQueueEnabled?: boolean | null;
  workflowTriggers?: NexusMergeQueueWorkflowTriggerInput[];
  now?: Date | string | (() => Date | string);
}): NexusFeatureFinalizationPlan {
  const deliveryReport = buildNexusFeatureBranchDeliveryReport({
    projectRoot: options.projectRoot,
    componentId: options.componentId,
    featureId: options.featureId,
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
    featureId: deliveryReport.featureId,
    summary: summarizeItems(items),
    nextAction: nextAction(items),
    deliveryReport,
    items,
    warnings: deliveryReport.warnings,
    mutatesSource: false,
  };
}

function finalizationItem(options: {
  item: NexusFeatureBranchDeliveryReportItem;
  projectRoot: string;
  providerEvidence: NexusPublicationProviderEvidenceInput[];
  mergeQueueEnabled?: boolean | null;
  workflowTriggers: NexusMergeQueueWorkflowTriggerInput[];
  now?: Date | string | (() => Date | string);
}): NexusFeatureFinalizationPlanItem {
  const finalPullRequestAction = buildFinalPullRequestAction({
    item: options.item,
    projectRoot: options.projectRoot,
  });
  const reviewDecision = classifyReviewReadiness(
    options.item,
    finalPullRequestAction,
  );
  const mergeQueue = mergeQueueSummary(options);
  const publicationDecision = classifyPublicationReadiness(
    options.item,
    mergeQueue,
    finalPullRequestAction,
  );

  return {
    componentId: options.item.componentId,
    featureId: options.item.featureId,
    featureBranch: options.item.featureBranch,
    stack: options.item.stack,
    finalPublicationTarget: options.item.finalPublicationTarget,
    finalPullRequestCreation: options.item.finalPullRequestCreation,
    finalPullRequestHead: options.item.finalPullRequestHead,
    finalPullRequestAction,
    branchUpdateDecision: options.item.branchUpdateDecision,
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
  item: NexusFeatureBranchDeliveryReportItem,
  finalPullRequestAction: NexusFeatureFinalPullRequestAction,
): NexusFeatureReadinessDecision<NexusFeatureReviewReadinessStatus> {
  const blocker = sharedReadinessBlocker(item, finalPullRequestAction);
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
  item: NexusFeatureBranchDeliveryReportItem,
  mergeQueue: NexusFeatureMergeQueueFinalizationSummary | null,
  finalPullRequestAction: NexusFeatureFinalPullRequestAction,
): NexusFeatureReadinessDecision<NexusFeaturePublicationReadinessStatus> {
  const blocker = sharedReadinessBlocker(item, finalPullRequestAction);
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
  item: NexusFeatureBranchDeliveryReportItem,
  finalPullRequestAction: NexusFeatureFinalPullRequestAction,
): NexusFeatureReadinessDecision<NexusFeatureSharedReadinessStatus> | null {
  const evidence = item.providerEvidence;
  if (finalPullRequestAction.status === "manual_only") {
    return {
      status: "needs_final_pull_request",
      nextAction: "manual_pull_request",
      reasons: finalPullRequestAction.reasons,
    };
  }
  if (finalPullRequestAction.status === "blocked") {
    return {
      status: "blocked",
      nextAction: "resolve_branch_policy",
      reasons: finalPullRequestAction.reasons,
    };
  }
  if (
    finalPullRequestAction.status === "create_at_review_gate" ||
    finalPullRequestAction.status === "create_at_feature_start"
  ) {
    return {
      status: "needs_final_pull_request",
      nextAction: "create_pull_request",
      reasons: finalPullRequestAction.reasons,
    };
  }
  if (!evidence.provider) {
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

function buildFinalPullRequestAction(options: {
  item: NexusFeatureBranchDeliveryReportItem;
  projectRoot: string;
}): NexusFeatureFinalPullRequestAction {
  if (!options.item.finalPullRequest) {
    return {
      status: "not_required",
      humanInTheLoop: false,
      providerAction: null,
      cliCommand: null,
      reasons: [],
    };
  }
  if (finalPullRequestExists(options.item)) {
    return {
      status: "already_exists",
      humanInTheLoop: false,
      providerAction: null,
      cliCommand: null,
      reasons: [],
    };
  }
  if (options.item.finalPullRequestCreation === "manual_only") {
    return {
      status: "manual_only",
      humanInTheLoop: true,
      providerAction: null,
      cliCommand: null,
      reasons: ["final pull request creation is manual-only"],
    };
  }
  if (
    options.item.finalPullRequestHead.status === "blocked" ||
    options.item.finalPullRequestHead.status === "manual_only"
  ) {
    return {
      status: "blocked",
      humanInTheLoop: true,
      providerAction: null,
      cliCommand: null,
      reasons: [
        options.item.finalPullRequestHead.setupAction ??
        "final pull request head cannot be resolved",
      ],
    };
  }

  const headBranch = options.item.finalPullRequestHead.branch ??
    options.item.featureBranch ??
    options.item.providerEvidence.headBranch ??
    options.item.providerEvidence.headRef;
  const head = options.item.finalPullRequestHead.displayRef ?? headBranch;
  if (!head || !headBranch) {
    return {
      status: "blocked",
      humanInTheLoop: true,
      providerAction: null,
      cliCommand: null,
      reasons: ["final pull request head branch is unavailable"],
    };
  }

  const status = finalPullRequestActionStatus(
    options.item.finalPullRequestCreation,
  );
  if (!status) {
    return {
      status: "blocked",
      humanInTheLoop: true,
      providerAction: null,
      cliCommand: null,
      reasons: [
        `unsupported final pull request creation policy: ${options.item.finalPullRequestCreation}`,
      ],
    };
  }

  const title = `Finalize feature ${options.item.featureId}`;
  const providerAction: NexusFeatureFinalPullRequestProviderAction = {
    kind: "pull_request_upsert",
    componentId: options.item.componentId,
    head,
    base: options.item.finalPublicationTarget,
    title,
    body: finalPullRequestBody(options.item, headBranch),
    draft: false,
  };

  return {
    status,
    humanInTheLoop: false,
    providerAction,
    cliCommand: finalPullRequestCliCommand(options.projectRoot, providerAction),
    reasons: [finalPullRequestActionReason(status)],
  };
}

function finalPullRequestExists(item: NexusFeatureBranchDeliveryReportItem): boolean {
  return Boolean(
    item.providerEvidence.provider &&
      (item.providerEvidence.sourceKind === "pull_request" ||
        item.providerEvidence.reviewTarget),
  );
}

function finalPullRequestActionStatus(
  policy: string,
): "create_at_feature_start" | "create_at_review_gate" | null {
  if (policy === "at_feature_start") {
    return "create_at_feature_start";
  }
  if (policy === "at_review_gate") {
    return "create_at_review_gate";
  }
  return null;
}

function finalPullRequestActionReason(
  status: "create_at_feature_start" | "create_at_review_gate",
): string {
  return status === "create_at_feature_start"
    ? "final pull request should have been created at feature start"
    : "final pull request is created at the review gate";
}

function finalPullRequestBody(
  item: NexusFeatureBranchDeliveryReportItem,
  head: string,
): string {
  return `Finalize feature ${item.featureId}.

Head: ${head}
Base: ${item.finalPublicationTarget}
Review target: ${item.finalReviewTarget}

Run feature-finalization with current provider evidence before publication.`;
}

function finalPullRequestCliCommand(
  projectRoot: string,
  action: NexusFeatureFinalPullRequestProviderAction,
): string {
  return [
    "dev-nexus",
    "publication",
    "pull-request",
    "upsert",
    projectRoot,
    "--component",
    action.componentId,
    "--head",
    action.head,
    "--base",
    action.base,
    "--title",
    action.title,
    "--body",
    singleLinePullRequestBody(action.body),
  ].map(shellQuoteArgument).join(" ");
}

function singleLinePullRequestBody(body: string): string {
  return body.split(/\r?\u000a/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

function mergeQueueSummary(options: {
  item: NexusFeatureBranchDeliveryReportItem;
  projectRoot: string;
  providerEvidence: NexusPublicationProviderEvidenceInput[];
  mergeQueueEnabled?: boolean | null;
  workflowTriggers: NexusMergeQueueWorkflowTriggerInput[];
  now?: Date | string | (() => Date | string);
}): NexusFeatureMergeQueueFinalizationSummary | null {
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
  items: NexusFeatureFinalizationPlanItem[],
): NexusFeatureFinalizationPlanSummary {
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
  items: NexusFeatureFinalizationPlanItem[],
): NexusFeatureFinalizationNextAction {
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
    "manual_pull_request",
    "request_review",
    "mark_ready_for_review",
    "request_publication_approval",
    "collect_provider_evidence",
    "wait",
  ] satisfies NexusFeatureFinalizationNextAction[]) {
    if (actions.includes(action)) {
      return action;
    }
  }
  return items.length > 0 ? "request_publication_approval" : "wait";
}
