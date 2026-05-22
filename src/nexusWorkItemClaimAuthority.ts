import type {
  NexusEligibleWorkItem,
} from "./nexusEligibleWork.js";
import type {
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import type {
  WorkItem,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export interface NexusWorkItemClaimOwnerInput {
  hostId: string;
  agentId?: string | null;
  ownerId?: string | null;
}

export interface NexusWorkItemClaimOwner {
  version: 1;
  hostId: string;
  agentId: string | null;
  ownerId: string | null;
  leaseToken: string;
  claimedAt: string;
  expiresAt: string;
}

export type NexusWorkItemStaleClaimPolicy = "report" | "reclaim";

export interface NexusWorkItemClaimObservation {
  id: string;
  title: string;
  componentId: string;
  trackerId: string;
  observedStatus: WorkStatus;
  owner: NexusWorkItemClaimOwner;
}

export type NexusWorkItemClaimSkipReason =
  | "missing_tracker"
  | "no_longer_ready"
  | "already_in_progress"
  | "claimed_by_another_owner"
  | "selector_mismatch";

export interface NexusWorkItemClaimSkippedCandidate {
  id: string;
  title: string;
  componentId: string;
  trackerId: string | null;
  reason: NexusWorkItemClaimSkipReason;
  observedStatus: WorkStatus | null;
}

export type NexusWorkItemClaimResult =
  | {
      status: "claimed";
      workItem: WorkItem;
      componentId: string;
      trackerId: string;
      owner: NexusWorkItemClaimOwner;
      skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
      activeClaims?: NexusWorkItemClaimObservation[];
      staleClaims?: NexusWorkItemClaimObservation[];
      reclaimedFrom?: NexusWorkItemClaimObservation;
    }
  | {
      status: "no_claim";
      reason:
        | "no_eligible_candidate"
        | "candidates_not_claimable"
        | "active_claims"
        | "stale_claims";
      skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
      activeClaims?: NexusWorkItemClaimObservation[];
      staleClaims?: NexusWorkItemClaimObservation[];
    }
  | {
      status: "lost_race";
      reason: "verification_failed";
      candidate: WorkItem;
      observedWorkItem: WorkItem;
      componentId: string;
      trackerId: string;
      owner: NexusWorkItemClaimOwner;
      skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
      activeClaims?: NexusWorkItemClaimObservation[];
      staleClaims?: NexusWorkItemClaimObservation[];
      reclaimedFrom?: NexusWorkItemClaimObservation;
    };

export interface NexusWorkItemClaimAuthorityClaimCandidateOptions {
  candidate: NexusEligibleWorkItem;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
  ref: WorkItemRef;
  freshWorkItem: WorkItem;
  owner: NexusWorkItemClaimOwner;
  now: Date;
}

export type NexusWorkItemClaimAuthorityClaimCandidateResult =
  | {
      status: "claimed";
      workItem: WorkItem;
    }
  | {
      status: "lost_race";
      observedWorkItem: WorkItem;
    };

export interface NexusWorkItemClaimAuthority {
  readonly kind: string;
  claimCandidate(
    options: NexusWorkItemClaimAuthorityClaimCandidateOptions,
  ): Promise<NexusWorkItemClaimAuthorityClaimCandidateResult>;
}
