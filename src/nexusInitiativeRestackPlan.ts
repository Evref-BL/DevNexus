import type {
  NexusInitiativeDeliveryTopology,
} from "./nexusAutomationConfig.js";
import type {
  NexusPublicationProviderBaseStatus,
} from "./nexusPublicationProviderEvidence.js";

export type NexusInitiativeRestackPlanStatus =
  | "not_required"
  | "ready"
  | "needs_restack";

export type NexusInitiativeRestackNextAction =
  | "wait"
  | "update_branches"
  | "request_human_approval";

export interface NexusInitiativeRestackBranchInput {
  branch: string;
  parentBranch: string | null;
  childBranches?: string[];
  position: number;
  pushed: boolean;
  parentChanged: boolean;
  baseStatus?: NexusPublicationProviderBaseStatus | null;
}

export interface NexusInitiativeRestackPlanItem {
  branch: string;
  parentBranch: string | null;
  childBranches: string[];
  position: number;
  pushed: boolean;
  baseStatus: NexusPublicationProviderBaseStatus | null;
  needsUpdate: boolean;
  forceWithLeaseRequired: boolean;
  humanApprovalRequired: boolean;
  reasons: string[];
}

export interface NexusInitiativeRestackPlan {
  topology: NexusInitiativeDeliveryTopology;
  finalPublicationTarget: string;
  status: NexusInitiativeRestackPlanStatus;
  nextAction: NexusInitiativeRestackNextAction;
  publicationEligible: boolean;
  branchCount: number;
  needsUpdateCount: number;
  forceWithLeaseCount: number;
  humanApprovalCount: number;
  items: NexusInitiativeRestackPlanItem[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusInitiativeRestackPlan(options: {
  topology: NexusInitiativeDeliveryTopology;
  finalPublicationTarget: string;
  branches: NexusInitiativeRestackBranchInput[];
}): NexusInitiativeRestackPlan {
  const publicationEligible = options.topology !== "throwaway_rehearsal";
  if (options.topology === "direct" || !publicationEligible) {
    return {
      topology: options.topology,
      finalPublicationTarget: options.finalPublicationTarget,
      status: "not_required",
      nextAction: "wait",
      publicationEligible,
      branchCount: 0,
      needsUpdateCount: 0,
      forceWithLeaseCount: 0,
      humanApprovalCount: 0,
      items: [],
      warnings: publicationEligible
        ? []
        : ["throw-away rehearsal branches are excluded from publication restack plans"],
      mutatesSource: false,
    };
  }

  const items = options.branches
    .map(restackItem)
    .sort((left, right) => left.position - right.position);
  const needsUpdateCount = items.filter((item) => item.needsUpdate).length;
  const forceWithLeaseCount = items.filter((item) =>
    item.forceWithLeaseRequired
  ).length;
  const humanApprovalCount = items.filter((item) =>
    item.humanApprovalRequired
  ).length;

  return {
    topology: options.topology,
    finalPublicationTarget: options.finalPublicationTarget,
    status: needsUpdateCount > 0 ? "needs_restack" : "ready",
    nextAction: humanApprovalCount > 0
      ? "request_human_approval"
      : needsUpdateCount > 0
        ? "update_branches"
        : "wait",
    publicationEligible,
    branchCount: items.length,
    needsUpdateCount,
    forceWithLeaseCount,
    humanApprovalCount,
    items,
    warnings: [],
    mutatesSource: false,
  };
}

function restackItem(
  input: NexusInitiativeRestackBranchInput,
): NexusInitiativeRestackPlanItem {
  const baseStatus = input.baseStatus ?? null;
  const reasons = restackReasons({
    parentChanged: input.parentChanged,
    baseStatus,
  });
  const needsUpdate = reasons.length > 0;
  const forceWithLeaseRequired = needsUpdate && input.pushed;

  return {
    branch: input.branch,
    parentBranch: input.parentBranch,
    childBranches: [...(input.childBranches ?? [])],
    position: input.position,
    pushed: input.pushed,
    baseStatus,
    needsUpdate,
    forceWithLeaseRequired,
    humanApprovalRequired: forceWithLeaseRequired,
    reasons,
  };
}

function restackReasons(options: {
  parentChanged: boolean;
  baseStatus: NexusPublicationProviderBaseStatus | null;
}): string[] {
  const reasons: string[] = [];
  if (options.parentChanged) {
    reasons.push("parent branch changed");
  }
  if (options.baseStatus === "behind" || options.baseStatus === "diverged") {
    reasons.push(`review branch base status is ${options.baseStatus}`);
  }
  return reasons;
}
