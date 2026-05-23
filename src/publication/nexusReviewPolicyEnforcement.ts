import type {
  NexusPublicationProviderEvidence,
} from "./nexusPublicationProviderEvidence.js";
import {
  buildNexusReviewPlan,
  type NexusResolvedReviewPolicy,
  type NexusReviewLocalAuthorization,
  type NexusReviewPlan,
  type NexusReviewPolicyConfig,
} from "./nexusReviewPolicy.js";

export type NexusReviewPolicyEnforcementMode = "noop" | "final_actions";

export type NexusReviewPolicyEnforcementStatus = "allowed" | "blocked";

export interface NexusReviewPolicyEnforcementDecision {
  mode: NexusReviewPolicyEnforcementMode;
  status: NexusReviewPolicyEnforcementStatus;
  componentId: string | null;
  requestedAction: string;
  finalAction: boolean;
  reason: string;
  blockingMessages: string[];
  reviewPlan: NexusReviewPlan | null;
}

export class NexusReviewPolicyEnforcementError extends Error {
  readonly decision: NexusReviewPolicyEnforcementDecision;
  readonly reviewPlan: NexusReviewPlan | null;

  constructor(decision: NexusReviewPolicyEnforcementDecision) {
    super(decision.reason);
    this.name = "NexusReviewPolicyEnforcementError";
    this.decision = decision;
    this.reviewPlan = decision.reviewPlan;
  }
}

export function buildNexusReviewPolicyEnforcementDecision(options: {
  componentId: string | null;
  policy?: NexusReviewPolicyConfig | NexusResolvedReviewPolicy | null;
  finalAction: boolean;
  requestedAction: string;
  branchRole?: string | null;
  branchName?: string | null;
  headSha?: string | null;
  localAuthorization?: Partial<NexusReviewLocalAuthorization> | null;
  providerEvidence?: NexusPublicationProviderEvidence | null;
}): NexusReviewPolicyEnforcementDecision {
  if (!options.policy) {
    return {
      mode: "noop",
      status: "allowed",
      componentId: options.componentId,
      requestedAction: options.requestedAction,
      finalAction: options.finalAction,
      reason: "no component review policy is configured",
      blockingMessages: [],
      reviewPlan: null,
    };
  }

  if (!options.finalAction) {
    return {
      mode: "final_actions",
      status: "allowed",
      componentId: options.componentId,
      requestedAction: options.requestedAction,
      finalAction: false,
      reason: "review policy enforcement applies only to final publication actions",
      blockingMessages: [],
      reviewPlan: null,
    };
  }

  const reviewPlan = buildNexusReviewPlan({
    componentId: options.componentId ?? "workspace",
    policy: options.policy,
    branchRole: options.branchRole,
    requestedAction: options.requestedAction,
    branchName: options.branchName,
    headSha: options.headSha,
    localAuthorization: options.localAuthorization ?? null,
    providerEvidence: options.providerEvidence ?? null,
  });
  if (reviewPlan.status === "ready") {
    return {
      mode: "final_actions",
      status: "allowed",
      componentId: options.componentId,
      requestedAction: options.requestedAction,
      finalAction: true,
      reason: "configured review policy is satisfied",
      blockingMessages: [],
      reviewPlan,
    };
  }

  const blockingMessages = reviewPlan.gateResults
    .filter((result) =>
      result.status === "missing" || result.status === "blocked"
    )
    .map((result) => `${result.gate}: ${result.message}`);

  return {
    mode: "final_actions",
    status: "blocked",
    componentId: options.componentId,
    requestedAction: options.requestedAction,
    finalAction: true,
    reason: [
      `review policy blocks ${options.requestedAction}`,
      ...blockingMessages,
    ].join("; "),
    blockingMessages,
    reviewPlan,
  };
}

export function assertNexusReviewPolicyEnforcement(
  decision: NexusReviewPolicyEnforcementDecision | null,
): void {
  if (!decision || decision.status === "allowed") {
    return;
  }

  throw new NexusReviewPolicyEnforcementError(decision);
}
