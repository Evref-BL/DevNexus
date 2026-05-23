import type {
  NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationEligibleWorkItems.js";
import type {
  NexusWorkItemClaimObservation,
  NexusWorkItemClaimOwner,
  NexusWorkItemClaimResult,
  NexusWorkItemClaimSkippedCandidate,
} from "./nexusWorkItemClaim.js";
import type {
  NexusWorkItemClaimAuthorityRecord,
} from "./nexusWorkItemClaimAuthority.js";

export type NexusAutomationWorkItemClaimStatus =
  NexusWorkItemClaimResult["status"] | "blocked" | "disabled";

export interface NexusAutomationWorkItemClaim {
  status: NexusAutomationWorkItemClaimStatus;
  reason: string | null;
  componentId: string | null;
  trackerId: string | null;
  workItemId: string | null;
  logicalWorkItemId: string | null;
  workItemTitle: string | null;
  owner: NexusWorkItemClaimOwner | null;
  authorityClaim: NexusWorkItemClaimAuthorityRecord | null;
  reclaimedFrom: NexusWorkItemClaimObservation | null;
  skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
  activeClaims: NexusWorkItemClaimObservation[];
  staleClaims: NexusWorkItemClaimObservation[];
}

export function automationWorkItemClaimFromResult(
  claim: NexusWorkItemClaimResult,
): NexusAutomationWorkItemClaim {
  if (claim.status === "claimed") {
    return {
      status: "claimed",
      reason: null,
      componentId: claim.componentId,
      trackerId: claim.trackerId,
      workItemId: claim.workItem.id,
      logicalWorkItemId: claim.workItem.externalRef?.itemId ?? claim.workItem.id,
      workItemTitle: claim.workItem.title,
      owner: claim.owner,
      authorityClaim: claim.authorityClaim ?? null,
      reclaimedFrom: claim.reclaimedFrom ?? null,
      skippedCandidates: claim.skippedCandidates,
      activeClaims: claim.activeClaims ?? [],
      staleClaims: claim.staleClaims ?? [],
    };
  }

  if (claim.status === "lost_race") {
    return {
      status: "lost_race",
      reason: claim.reason,
      componentId: claim.componentId,
      trackerId: claim.trackerId,
      workItemId: claim.candidate.id,
      logicalWorkItemId: claim.candidate.externalRef?.itemId ?? claim.candidate.id,
      workItemTitle: claim.candidate.title,
      owner: claim.owner,
      authorityClaim: claim.authorityClaim ?? null,
      reclaimedFrom: claim.reclaimedFrom ?? null,
      skippedCandidates: claim.skippedCandidates,
      activeClaims: claim.activeClaims ?? [],
      staleClaims: claim.staleClaims ?? [],
    };
  }

  return {
    status: "no_claim",
    reason: claim.reason,
    componentId: null,
    trackerId: null,
    workItemId: null,
    logicalWorkItemId: null,
    workItemTitle: null,
    owner: null,
    authorityClaim: null,
    reclaimedFrom: null,
    skippedCandidates: claim.skippedCandidates,
    activeClaims: claim.activeClaims ?? [],
    staleClaims: claim.staleClaims ?? [],
  };
}

export function disabledAutomationWorkItemClaim(): NexusAutomationWorkItemClaim {
  return {
    status: "disabled",
    reason: "disabled_by_project_policy",
    componentId: null,
    trackerId: null,
    workItemId: null,
    logicalWorkItemId: null,
    workItemTitle: null,
    owner: null,
    authorityClaim: null,
    reclaimedFrom: null,
    skippedCandidates: [],
    activeClaims: [],
    staleClaims: [],
  };
}

export function blockedAutomationWorkItemClaim(
  reason: string,
): NexusAutomationWorkItemClaim {
  return {
    status: "blocked",
    reason,
    componentId: null,
    trackerId: null,
    workItemId: null,
    logicalWorkItemId: null,
    workItemTitle: null,
    owner: null,
    authorityClaim: null,
    reclaimedFrom: null,
    skippedCandidates: [],
    activeClaims: [],
    staleClaims: [],
  };
}

export function automationComponentEligibleWorkItemsForClaim(options: {
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  claim: Extract<NexusWorkItemClaimResult, { status: "claimed" }>;
}): NexusAutomationComponentEligibleWorkItems[] {
  const existing = options.componentEligibleWorkItems.find(
    (component) => component.componentId === options.claim.componentId,
  );
  return [
    {
      componentId: options.claim.componentId,
      workItems: [options.claim.workItem],
      ...(existing?.importCandidateWorkItems
        ? { importCandidateWorkItems: existing.importCandidateWorkItems }
        : {}),
      ...(existing?.excludedWorkItems
        ? { excludedWorkItems: existing.excludedWorkItems }
        : {}),
      ...(existing?.warnings ? { warnings: existing.warnings } : {}),
      ...(existing?.blockers ? { blockers: existing.blockers } : {}),
      ...(existing?.trackerResults ? { trackerResults: existing.trackerResults } : {}),
    },
  ];
}

export function automationWorkItemClaimSkipSummary(
  claim: NexusAutomationWorkItemClaim,
  actorLabel: string,
): string {
  if (claim.status === "lost_race") {
    return `Work-item claim lost race for ${claim.workItemId ?? "candidate"}; ${actorLabel} skipped`;
  }
  if (claim.reason === "active_claims") {
    return "Eligible work is already claimed by another owner";
  }
  if (claim.reason === "stale_claims") {
    return "Eligible work has stale claims and reclaim policy is disabled";
  }
  if (claim.reason === "candidates_not_claimable") {
    return "Eligible work items were not claimable";
  }

  return "No eligible work item could be claimed";
}
