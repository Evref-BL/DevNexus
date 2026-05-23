import path from "node:path";
import {
  defaultNexusPublicationTrainCiTierPolicy,
  mergeNexusCiTierPolicy,
  resolveNexusCiTierDecision,
  type NexusCiTierDecision,
  type NexusCiTierPolicyConfig,
} from "./nexusCiTierPolicy.js";
import {
  buildNexusInitiativeBranchUpdateDecision,
  type NexusInitiativeBranchUpdateDecision,
} from "./nexusInitiativeBranchUpdateDecision.js";
import {
  buildNexusInitiativeDeliveryPlan,
  type NexusInitiativeDeliveryPlanItem,
} from "./nexusInitiativeDeliveryPlan.js";
import type {
  NexusInitiativeDeliveryBranchPublicationSummary,
  NexusInitiativeDeliveryPolicySummary,
  NexusInitiativeDeliveryPullRequestHeadSummary,
} from "./nexusInitiativeDeliveryPolicy.js";
import {
  classifyNexusPublicationProviderEvidenceChecks,
  findNexusPublicationProviderEvidence,
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderBaseStatus,
  type NexusPublicationProviderBranchPolicy,
  type NexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidenceInput,
  type NexusPublicationProviderEvidenceStatus,
  type NexusPublicationProviderReviewState,
  type NexusPublicationProviderReviewTarget,
} from "./nexusPublicationProviderEvidence.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import { resolveNexusPublicationPolicy } from "./nexusPublicationPolicy.js";

export type NexusInitiativeDeliveryReportNextAction =
  | "create_pull_request"
  | "collect_provider_evidence"
  | "update_branch"
  | "resolve_conflicts"
  | "resolve_branch_policy"
  | "resolve_failed_checks"
  | "wait_for_checks"
  | "request_review"
  | "ready_for_final_publication"
  | "wait";

export type NexusInitiativeDeliveryReportItemStatus =
  | "needs_final_pull_request"
  | "needs_provider_evidence"
  | "needs_update"
  | "blocked"
  | "checks_failed"
  | "checks_pending"
  | "review_needed"
  | "ready"
  | "wait";

export interface NexusInitiativeDeliveryProviderEvidenceSummary {
  provider: string | null;
  sourceKind: NexusPublicationProviderEvidence["sourceKind"] | null;
  sourceUrl: string | null;
  reviewTarget: NexusPublicationProviderReviewTarget | null;
  headBranch: string | null;
  headRef: string | null;
  headSha: string | null;
  targetBranch: string | null;
  intendedCiTier: string | null;
  checksStatus: NexusPublicationProviderEvidenceStatus;
  checksMessage: string;
  requiredChecks: {
    name: string;
    status: string;
    url: string | null;
  }[];
  reviewState: NexusPublicationProviderReviewState | null;
  mergeability: NexusPublicationProviderEvidence["mergeability"];
  branchPolicy: NexusPublicationProviderBranchPolicy | null;
  baseStatus: NexusPublicationProviderBaseStatus | null;
  draft: boolean | null;
  stale: boolean;
  unknown: boolean;
  collectedAt: string | null;
}

export interface NexusInitiativeDeliveryReportItem {
  componentId: string;
  componentName: string;
  targetBranch: string;
  publicationTrainVersionId: string | null;
  initiativeId: string;
  topology: string;
  reviewMode: string;
  providerNoise: string;
  integrationBranch: string | null;
  sliceBranchPattern: string;
  stack: NexusInitiativeDeliveryPolicySummary["branchPlan"]["stack"];
  finalReviewTarget: string;
  finalPublicationTarget: string;
  finalPullRequest: boolean;
  finalPullRequestCreation: string;
  branchPublication: NexusInitiativeDeliveryBranchPublicationSummary;
  finalPullRequestHead: NexusInitiativeDeliveryPullRequestHeadSummary;
  branchUpdateDecision: NexusInitiativeBranchUpdateDecision;
  ciTier: NexusCiTierDecision;
  providerEvidence: NexusInitiativeDeliveryProviderEvidenceSummary;
  status: NexusInitiativeDeliveryReportItemStatus;
  nextAction: NexusInitiativeDeliveryReportNextAction;
  reasons: string[];
  warnings: string[];
}

export interface NexusInitiativeDeliveryReportSummary {
  itemCount: number;
  readyCount: number;
  needsFinalPullRequestCount: number;
  needsProviderEvidenceCount: number;
  needsUpdateCount: number;
  blockedCount: number;
  checksFailedCount: number;
  checksPendingCount: number;
  reviewNeededCount: number;
  waitCount: number;
}

export interface NexusInitiativeDeliveryReport {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  componentId: string | null;
  initiativeId: string | null;
  summary: NexusInitiativeDeliveryReportSummary;
  nextAction: NexusInitiativeDeliveryReportNextAction;
  items: NexusInitiativeDeliveryReportItem[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusInitiativeDeliveryReport(options: {
  projectRoot: string;
  componentId?: string;
  initiativeId?: string | null;
  providerEvidence?: NexusPublicationProviderEvidenceInput[];
  fullMatrixBudgetAvailable?: boolean | null;
  now?: Date | string | (() => Date | string);
}): NexusInitiativeDeliveryReport {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const plan = buildNexusInitiativeDeliveryPlan({
    projectRoot,
    componentId: options.componentId,
    initiativeId: options.initiativeId,
  });
  const normalizedEvidence = normalizeNexusPublicationProviderEvidence(
    options.providerEvidence ?? [],
  );
  const warnings = [...plan.warnings];
  const items = plan.items.map((item) =>
    reportItem({
      projectConfig,
      components,
      item,
      providerEvidence: normalizedEvidence,
      fullMatrixBudgetAvailable: options.fullMatrixBudgetAvailable ?? true,
    })
  );

  return {
    version: 1,
    generatedAt: isoString(options.now ?? new Date()),
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    componentId: options.componentId ?? null,
    initiativeId: options.initiativeId ?? null,
    summary: summarizeItems(items),
    nextAction: nextAction(items),
    items,
    warnings: uniqueStrings(warnings),
    mutatesSource: false,
  };
}

function reportItem(options: {
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  item: NexusInitiativeDeliveryPlanItem;
  providerEvidence: NexusPublicationProviderEvidence[];
  fullMatrixBudgetAvailable: boolean;
}): NexusInitiativeDeliveryReportItem {
  const component = options.components.find((candidate) =>
    candidate.id === options.item.componentId
  );
  if (!component) {
    throw new Error(`Component ${options.item.componentId} was not found.`);
  }
  const initiative = options.item.initiative;
  const branchPlan = initiative.branchPlan;
  const branchName = branchPlan.integrationBranch ??
    branchPlan.defaultSliceReviewTarget;
  const ciTier = resolveNexusCiTierDecision({
    policy: initiativeCiTierPolicy(options.projectConfig, component),
    eventName: "pull_request",
    branchName,
    targetBranch: branchPlan.finalPublicationTarget,
    fullMatrixBudgetAvailable: options.fullMatrixBudgetAvailable,
  });
  const evidence = findEvidenceForInitiative({
    evidence: options.providerEvidence,
    branchName,
    targetBranch: branchPlan.finalPublicationTarget,
    intendedCiTier: ciTier.tier.id,
  });
  const classification = classifyNexusPublicationProviderEvidenceChecks({
    evidence,
    requiredChecks: ciTier.requiredChecks,
  });
  const providerEvidence = providerEvidenceSummary(evidence, classification);
  const classificationResult = classifyItem({
    initiativeFinalPullRequest: initiative.finalPullRequest,
    providerEvidence,
    ciTier,
    finalPullRequestCreation: initiative.finalPullRequestCreation,
  });

  return {
    componentId: options.item.componentId,
    componentName: options.item.componentName,
    targetBranch: options.item.targetBranch,
    publicationTrainVersionId: options.item.publicationTrainVersionId,
    initiativeId: initiative.activeScopeId,
    topology: initiative.defaultTopology,
    reviewMode: initiative.reviewMode,
    providerNoise: initiative.providerNoise,
    integrationBranch: branchPlan.integrationBranch,
    sliceBranchPattern: branchPlan.sliceBranchPattern,
    stack: branchPlan.stack,
    finalReviewTarget: branchPlan.finalReviewTarget,
    finalPublicationTarget: branchPlan.finalPublicationTarget,
    finalPullRequest: initiative.finalPullRequest,
    finalPullRequestCreation: initiative.finalPullRequestCreation,
    branchPublication: initiative.branchPublication,
    finalPullRequestHead: initiative.branchPublication.finalPullRequestHead,
    branchUpdateDecision: buildNexusInitiativeBranchUpdateDecision({
      baseStatus: providerEvidence.baseStatus,
      headBranch: providerEvidence.headBranch ?? branchName,
      baseBranch: branchPlan.finalPublicationTarget,
      pushRemote: initiative.branchPublication.selectedRemote,
      publicBranch: providerEvidence.sourceKind === "pull_request" ||
        providerEvidence.sourceKind === "branch" ||
        providerEvidence.reviewTarget !== null,
      stackedBranch: branchPlan.stack.status === "active" &&
        (branchPlan.stack.topology === "stacked" ||
          branchPlan.stack.topology === "hybrid"),
    }),
    ciTier,
    providerEvidence,
    status: classificationResult.status,
    nextAction: classificationResult.nextAction,
    reasons: classificationResult.reasons,
    warnings: [...initiative.warnings],
  };
}

function initiativeCiTierPolicy(
  projectConfig: NexusProjectConfig,
  component: ResolvedNexusProjectComponent,
): NexusCiTierPolicyConfig {
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  if (publication.publicationTrain?.ciTiers) {
    return mergeNexusCiTierPolicy(
      defaultNexusPublicationTrainCiTierPolicy,
      publication.publicationTrain.ciTiers,
    );
  }
  if (component.verification?.ciTiers) {
    return component.verification.ciTiers;
  }
  if (projectConfig.automation?.verification.ciTiers) {
    return projectConfig.automation.verification.ciTiers;
  }
  return defaultNexusPublicationTrainCiTierPolicy;
}

function findEvidenceForInitiative(options: {
  evidence: NexusPublicationProviderEvidence[];
  branchName: string | null;
  targetBranch: string;
  intendedCiTier: string;
}): NexusPublicationProviderEvidence | null {
  const match = {
    branchName: options.branchName,
    targetBranch: options.targetBranch,
    intendedCiTier: options.intendedCiTier,
  };
  return findNexusPublicationProviderEvidence(options.evidence, {
    sourceKind: "pull_request",
    ...match,
  }) ?? findNexusPublicationProviderEvidence(options.evidence, match);
}

function providerEvidenceSummary(
  evidence: NexusPublicationProviderEvidence | null,
  classification: ReturnType<typeof classifyNexusPublicationProviderEvidenceChecks>,
): NexusInitiativeDeliveryProviderEvidenceSummary {
  return {
    provider: evidence?.provider ?? null,
    sourceKind: evidence?.sourceKind ?? null,
    sourceUrl: evidence?.sourceUrl ?? null,
    reviewTarget: evidence?.reviewTarget ?? null,
    headBranch: evidence?.headBranch ?? null,
    headRef: evidence?.headRef ?? null,
    headSha: evidence?.headSha ?? null,
    targetBranch: evidence?.targetBranch ?? null,
    intendedCiTier: evidence?.intendedCiTier ?? null,
    checksStatus: classification.status,
    checksMessage: classification.message,
    requiredChecks: classification.requiredChecks.map((check) => ({
      name: check.name,
      status: check.status,
      url: check.url,
    })),
    reviewState: evidence?.reviewState ?? null,
    mergeability: evidence?.mergeability ?? null,
    branchPolicy: evidence?.branchPolicy ?? null,
    baseStatus: evidence?.baseStatus ?? null,
    draft: evidence ? booleanMetadata(evidence.metadata, "draft") : null,
    stale: evidence?.stale ?? false,
    unknown: evidence?.unknown ?? false,
    collectedAt: evidence?.collectedAt ?? null,
  };
}

function classifyItem(options: {
  initiativeFinalPullRequest: boolean;
  finalPullRequestCreation: string;
  providerEvidence: NexusInitiativeDeliveryProviderEvidenceSummary;
  ciTier: NexusCiTierDecision;
}): {
  status: NexusInitiativeDeliveryReportItemStatus;
  nextAction: NexusInitiativeDeliveryReportNextAction;
  reasons: string[];
} {
  const evidence = options.providerEvidence;
  const reasons: string[] = [];
  if (!evidence.provider) {
    if (
      options.initiativeFinalPullRequest &&
      options.finalPullRequestCreation === "at_review_gate"
    ) {
      reasons.push("final pull request is created at the review gate");
      return {
        status: "needs_final_pull_request",
        nextAction: "create_pull_request",
        reasons,
      };
    }
    reasons.push("provider evidence is unavailable");
    return {
      status: "needs_provider_evidence",
      nextAction: "collect_provider_evidence",
      reasons,
    };
  }
  if (evidence.mergeability === "conflicting") {
    reasons.push("review branch has merge conflicts");
    return {
      status: "blocked",
      nextAction: "resolve_conflicts",
      reasons,
    };
  }
  if (evidence.baseStatus === "behind" || evidence.baseStatus === "diverged") {
    reasons.push(`review branch base status is ${evidence.baseStatus}`);
    return {
      status: "needs_update",
      nextAction: "update_branch",
      reasons,
    };
  }
  if (evidence.checksStatus === "failed" || evidence.checksStatus === "missing") {
    reasons.push(evidence.checksMessage);
    return {
      status: "checks_failed",
      nextAction: "resolve_failed_checks",
      reasons,
    };
  }
  if (
    evidence.checksStatus === "pending" ||
    evidence.checksStatus === "stale" ||
    evidence.checksStatus === "unavailable"
  ) {
    reasons.push(evidence.checksMessage);
    return {
      status: "checks_pending",
      nextAction: "wait_for_checks",
      reasons,
    };
  }
  if (options.ciTier.budgetLimited) {
    reasons.push("full matrix CI budget is exhausted");
    return {
      status: "wait",
      nextAction: "wait",
      reasons,
    };
  }
  if (
    options.initiativeFinalPullRequest &&
    evidence.reviewState !== "approved"
  ) {
    if (evidence.draft === true) {
      reasons.push("pull request is draft");
    }
    reasons.push(
      `pull request review state is ${evidence.reviewState ?? "unknown"}`,
    );
    return {
      status: "review_needed",
      nextAction: "request_review",
      reasons,
    };
  }
  if (evidence.branchPolicy === "blocked") {
    reasons.push(
      evidence.draft === true ? "pull request is draft" : "branch policy is blocked",
    );
    return {
      status: "blocked",
      nextAction: "resolve_branch_policy",
      reasons,
    };
  }

  return {
    status: "ready",
    nextAction: "ready_for_final_publication",
    reasons,
  };
}

function booleanMetadata(
  metadata: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

function summarizeItems(
  items: NexusInitiativeDeliveryReportItem[],
): NexusInitiativeDeliveryReportSummary {
  return {
    itemCount: items.length,
    readyCount: countStatus(items, "ready"),
    needsFinalPullRequestCount: countStatus(items, "needs_final_pull_request"),
    needsProviderEvidenceCount: countStatus(items, "needs_provider_evidence"),
    needsUpdateCount: countStatus(items, "needs_update"),
    blockedCount: countStatus(items, "blocked"),
    checksFailedCount: countStatus(items, "checks_failed"),
    checksPendingCount: countStatus(items, "checks_pending"),
    reviewNeededCount: countStatus(items, "review_needed"),
    waitCount: countStatus(items, "wait"),
  };
}

function countStatus(
  items: NexusInitiativeDeliveryReportItem[],
  status: NexusInitiativeDeliveryReportItemStatus,
): number {
  return items.filter((item) => item.status === status).length;
}

function nextAction(
  items: NexusInitiativeDeliveryReportItem[],
): NexusInitiativeDeliveryReportNextAction {
  const actions = items.map((item) => item.nextAction);
  for (const action of [
    "resolve_conflicts",
    "update_branch",
    "resolve_branch_policy",
    "resolve_failed_checks",
    "wait_for_checks",
    "create_pull_request",
    "request_review",
    "collect_provider_evidence",
    "wait",
  ] satisfies NexusInitiativeDeliveryReportNextAction[]) {
    if (actions.includes(action)) {
      return action;
    }
  }
  return items.length > 0 ? "ready_for_final_publication" : "wait";
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function isoString(value: Date | string | (() => Date | string)): string {
  const actual = typeof value === "function" ? value() : value;
  const date = actual instanceof Date ? actual : new Date(actual);
  if (Number.isNaN(date.getTime())) {
    throw new Error("now must be a valid date");
  }
  return date.toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
