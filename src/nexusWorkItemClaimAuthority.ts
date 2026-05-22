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

export interface NexusWorkItemClaimAuthorityKey {
  projectId: string;
  componentId: string;
  trackerId: string;
  provider: string;
  workItemId: string;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  itemNumber?: number | null;
  itemKey?: string | null;
  nodeId?: string | null;
}

export type NexusWorkItemClaimAuthorityState = "active" | "released";

export interface NexusWorkItemClaimAuthorityRecord {
  authorityKind: string;
  key: NexusWorkItemClaimAuthorityKey;
  owner: NexusWorkItemClaimOwner;
  fencingToken: number;
  state: NexusWorkItemClaimAuthorityState;
  claimedAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  releasedAt?: string | null;
  reclaimedFrom?: NexusWorkItemClaimAuthorityRecord;
}

export type NexusWorkItemClaimResult =
  | {
      status: "claimed";
      workItem: WorkItem;
      componentId: string;
      trackerId: string;
      owner: NexusWorkItemClaimOwner;
      authorityClaim?: NexusWorkItemClaimAuthorityRecord;
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
      authorityClaim?: NexusWorkItemClaimAuthorityRecord;
      skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
      activeClaims?: NexusWorkItemClaimObservation[];
      staleClaims?: NexusWorkItemClaimObservation[];
      reclaimedFrom?: NexusWorkItemClaimObservation;
    };

export interface NexusWorkItemClaimAuthorityClaimCandidateOptions {
  projectId: string;
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
      authorityClaim?: NexusWorkItemClaimAuthorityRecord;
    }
  | {
      status: "lost_race";
      observedWorkItem: WorkItem;
      authorityClaim?: NexusWorkItemClaimAuthorityRecord;
    };

export type NexusWorkItemClaimAuthorityVerifyResult =
  | {
      status: "verified";
      claim: NexusWorkItemClaimAuthorityRecord;
    }
  | {
      status: "missing" | "token_mismatch" | "expired" | "released";
      claim?: NexusWorkItemClaimAuthorityRecord;
    };

export type NexusWorkItemClaimAuthorityHeartbeatResult =
  | {
      status: "heartbeat";
      claim: NexusWorkItemClaimAuthorityRecord;
    }
  | {
      status: "rejected";
      reason: "missing_claim" | "token_mismatch" | "expired" | "released";
      claim?: NexusWorkItemClaimAuthorityRecord;
    };

export type NexusWorkItemClaimAuthorityReleaseResult =
  | {
      status: "released";
      claim: NexusWorkItemClaimAuthorityRecord;
    }
  | {
      status: "rejected";
      reason: "missing_claim" | "token_mismatch" | "expired" | "released";
      claim?: NexusWorkItemClaimAuthorityRecord;
    };

export type NexusWorkItemClaimAuthorityReclaimResult =
  | {
      status: "claimed";
      claim: NexusWorkItemClaimAuthorityRecord;
      workItem: WorkItem;
    }
  | {
      status: "rejected";
      reason: "missing_claim" | "active_claim" | "released";
      claim?: NexusWorkItemClaimAuthorityRecord;
    };

export interface NexusWorkItemClaimAuthorityInspectOptions {
  key?: NexusWorkItemClaimAuthorityKey;
  now: Date;
}

export interface NexusWorkItemClaimAuthorityInspectResult {
  activeClaims: NexusWorkItemClaimAuthorityRecord[];
  staleClaims: NexusWorkItemClaimAuthorityRecord[];
  releasedClaims: NexusWorkItemClaimAuthorityRecord[];
}

export interface NexusWorkItemClaimAuthority {
  readonly kind: string;
  claimCandidate(
    options: NexusWorkItemClaimAuthorityClaimCandidateOptions,
  ): Promise<NexusWorkItemClaimAuthorityClaimCandidateResult>;
  verifyClaim?(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityVerifyResult>;
  heartbeatClaim?(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityHeartbeatResult>;
  releaseClaim?(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityReleaseResult>;
  reclaimExpiredClaim?(options: {
    key: NexusWorkItemClaimAuthorityKey;
    owner: NexusWorkItemClaimOwner;
    workItem: WorkItem;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityReclaimResult>;
  inspectClaims?(
    options: NexusWorkItemClaimAuthorityInspectOptions,
  ): Promise<NexusWorkItemClaimAuthorityInspectResult>;
}

export class NexusMemoryWorkItemClaimAuthority
  implements Required<NexusWorkItemClaimAuthority>
{
  readonly kind = "memory";
  private readonly claims = new Map<string, NexusWorkItemClaimAuthorityRecord>();
  private nextFencingToken = 1;

  async claimCandidate(
    options: NexusWorkItemClaimAuthorityClaimCandidateOptions,
  ): Promise<NexusWorkItemClaimAuthorityClaimCandidateResult> {
    const key = nexusWorkItemClaimAuthorityKey(options);
    const existing = this.claims.get(serializedClaimAuthorityKey(key));
    if (existing && claimIsCurrent(existing, options.now)) {
      return {
        status: "lost_race",
        observedWorkItem: claimedWorkItem(options.freshWorkItem),
        authorityClaim: cloneClaimAuthorityRecord(existing),
      };
    }

    const claim = this.createClaim({
      key,
      owner: options.owner,
      now: options.now,
      reclaimedFrom:
        existing && existing.state === "active"
          ? cloneClaimAuthorityRecord(existing)
          : undefined,
    });

    return {
      status: "claimed",
      workItem: claimedWorkItem(options.freshWorkItem),
      authorityClaim: cloneClaimAuthorityRecord(claim),
    };
  }

  async verifyClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityVerifyResult> {
    const claim = this.claims.get(serializedClaimAuthorityKey(options.key));
    const result = verifyCurrentClaim({
      claim,
      leaseToken: options.leaseToken,
      now: options.now,
    });
    if (result.status === "verified") {
      return result;
    }

    return result;
  }

  async heartbeatClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityHeartbeatResult> {
    assertPositiveDuration(options.leaseDurationMs);
    const serializedKey = serializedClaimAuthorityKey(options.key);
    const claim = this.claims.get(serializedKey);
    const result = verifyCurrentClaim({
      claim,
      leaseToken: options.leaseToken,
      now: options.now,
    });
    if (result.status !== "verified") {
      return {
        status: "rejected",
        reason: verifyStatusToRejectedReason(result.status),
        ...(result.claim ? { claim: result.claim } : {}),
      };
    }

    const updated = {
      ...result.claim,
      owner: {
        ...result.claim.owner,
        expiresAt: new Date(
          options.now.getTime() + options.leaseDurationMs,
        ).toISOString(),
      },
      expiresAt: new Date(
        options.now.getTime() + options.leaseDurationMs,
      ).toISOString(),
      lastHeartbeatAt: options.now.toISOString(),
    };
    this.claims.set(serializedKey, updated);

    return {
      status: "heartbeat",
      claim: cloneClaimAuthorityRecord(updated),
    };
  }

  async releaseClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityReleaseResult> {
    const serializedKey = serializedClaimAuthorityKey(options.key);
    const claim = this.claims.get(serializedKey);
    const result = verifyCurrentClaim({
      claim,
      leaseToken: options.leaseToken,
      now: options.now,
    });
    if (result.status !== "verified") {
      return {
        status: "rejected",
        reason: verifyStatusToRejectedReason(result.status),
        ...(result.claim ? { claim: result.claim } : {}),
      };
    }

    const released = {
      ...result.claim,
      state: "released" as const,
      releasedAt: options.now.toISOString(),
    };
    this.claims.set(serializedKey, released);

    return {
      status: "released",
      claim: cloneClaimAuthorityRecord(released),
    };
  }

  async reclaimExpiredClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    owner: NexusWorkItemClaimOwner;
    workItem: WorkItem;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityReclaimResult> {
    const existing = this.claims.get(serializedClaimAuthorityKey(options.key));
    if (!existing) {
      return {
        status: "rejected",
        reason: "missing_claim",
      };
    }
    if (existing.state === "released") {
      return {
        status: "rejected",
        reason: "released",
        claim: cloneClaimAuthorityRecord(existing),
      };
    }
    if (!claimIsExpired(existing, options.now)) {
      return {
        status: "rejected",
        reason: "active_claim",
        claim: cloneClaimAuthorityRecord(existing),
      };
    }

    const claim = this.createClaim({
      key: options.key,
      owner: options.owner,
      now: options.now,
      reclaimedFrom: cloneClaimAuthorityRecord(existing),
    });

    return {
      status: "claimed",
      claim: cloneClaimAuthorityRecord(claim),
      workItem: claimedWorkItem(options.workItem),
    };
  }

  async inspectClaims(
    options: NexusWorkItemClaimAuthorityInspectOptions,
  ): Promise<NexusWorkItemClaimAuthorityInspectResult> {
    const records = [...this.claims.values()].filter((claim) =>
      options.key
        ? serializedClaimAuthorityKey(claim.key) ===
          serializedClaimAuthorityKey(options.key)
        : true,
    );
    return {
      activeClaims: records
        .filter(
          (claim) => claim.state === "active" && !claimIsExpired(claim, options.now),
        )
        .map(cloneClaimAuthorityRecord),
      staleClaims: records
        .filter(
          (claim) => claim.state === "active" && claimIsExpired(claim, options.now),
        )
        .map(cloneClaimAuthorityRecord),
      releasedClaims: records
        .filter((claim) => claim.state === "released")
        .map(cloneClaimAuthorityRecord),
    };
  }

  private createClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    owner: NexusWorkItemClaimOwner;
    now: Date;
    reclaimedFrom?: NexusWorkItemClaimAuthorityRecord;
  }): NexusWorkItemClaimAuthorityRecord {
    const claim: NexusWorkItemClaimAuthorityRecord = {
      authorityKind: this.kind,
      key: cloneClaimAuthorityKey(options.key),
      owner: cloneClaimOwner(options.owner),
      fencingToken: this.nextFencingToken,
      state: "active",
      claimedAt: options.owner.claimedAt,
      expiresAt: options.owner.expiresAt,
      lastHeartbeatAt: options.now.toISOString(),
      releasedAt: null,
      ...(options.reclaimedFrom
        ? { reclaimedFrom: cloneClaimAuthorityRecord(options.reclaimedFrom) }
        : {}),
    };
    this.nextFencingToken += 1;
    this.claims.set(serializedClaimAuthorityKey(options.key), claim);

    return claim;
  }
}

export function nexusWorkItemClaimAuthorityKey(
  options: Pick<
    NexusWorkItemClaimAuthorityClaimCandidateOptions,
    "projectId" | "candidate" | "tracker"
  >,
): NexusWorkItemClaimAuthorityKey {
  const externalRef = options.candidate.externalRef;
  return {
    projectId: options.projectId,
    componentId: options.candidate.componentId,
    trackerId: options.tracker.id,
    provider: options.candidate.provider,
    workItemId: externalRef?.itemId ?? options.candidate.id,
    repositoryId:
      externalRef?.repositoryId ??
      options.tracker.workTracking.repository?.id ??
      null,
    repositoryOwner:
      externalRef?.repositoryOwner ??
      options.tracker.workTracking.repository?.owner ??
      null,
    repositoryName:
      externalRef?.repositoryName ??
      options.tracker.workTracking.repository?.name ??
      null,
    itemNumber: externalRef?.itemNumber ?? null,
    itemKey: externalRef?.itemKey ?? null,
    nodeId: externalRef?.nodeId ?? null,
  };
}

function verifyCurrentClaim(options: {
  claim: NexusWorkItemClaimAuthorityRecord | undefined;
  leaseToken: string;
  now: Date;
}): NexusWorkItemClaimAuthorityVerifyResult {
  if (!options.claim) {
    return {
      status: "missing",
    };
  }
  const claim = cloneClaimAuthorityRecord(options.claim);
  if (claim.owner.leaseToken !== options.leaseToken) {
    return {
      status: "token_mismatch",
      claim,
    };
  }
  if (claim.state === "released") {
    return {
      status: "released",
      claim,
    };
  }
  if (claimIsExpired(claim, options.now)) {
    return {
      status: "expired",
      claim,
    };
  }

  return {
    status: "verified",
    claim,
  };
}

function verifyStatusToRejectedReason(
  status: Exclude<NexusWorkItemClaimAuthorityVerifyResult["status"], "verified">,
): "missing_claim" | "token_mismatch" | "expired" | "released" {
  return status === "missing" ? "missing_claim" : status;
}

function claimIsCurrent(
  claim: NexusWorkItemClaimAuthorityRecord,
  now: Date,
): boolean {
  return claim.state === "active" && !claimIsExpired(claim, now);
}

function claimIsExpired(
  claim: NexusWorkItemClaimAuthorityRecord,
  now: Date,
): boolean {
  return new Date(claim.expiresAt).getTime() <= now.getTime();
}

function claimedWorkItem(workItem: WorkItem): WorkItem {
  return {
    ...cloneWorkItem(workItem),
    status: "in_progress",
  };
}

function cloneClaimAuthorityRecord(
  claim: NexusWorkItemClaimAuthorityRecord,
): NexusWorkItemClaimAuthorityRecord {
  return {
    ...claim,
    key: cloneClaimAuthorityKey(claim.key),
    owner: cloneClaimOwner(claim.owner),
    ...(claim.reclaimedFrom
      ? { reclaimedFrom: cloneClaimAuthorityRecord(claim.reclaimedFrom) }
      : {}),
  };
}

function cloneClaimAuthorityKey(
  key: NexusWorkItemClaimAuthorityKey,
): NexusWorkItemClaimAuthorityKey {
  return {
    ...key,
  };
}

function cloneClaimOwner(
  owner: NexusWorkItemClaimOwner,
): NexusWorkItemClaimOwner {
  return {
    ...owner,
  };
}

function cloneWorkItem(workItem: WorkItem): WorkItem {
  return {
    ...workItem,
    labels: workItem.labels ? [...workItem.labels] : undefined,
    assignees: workItem.assignees ? [...workItem.assignees] : undefined,
    externalRef: workItem.externalRef ? { ...workItem.externalRef } : undefined,
    trackerRef: workItem.trackerRef ? { ...workItem.trackerRef } : undefined,
  };
}

function serializedClaimAuthorityKey(
  key: NexusWorkItemClaimAuthorityKey,
): string {
  return JSON.stringify([
    key.projectId,
    key.componentId,
    key.trackerId,
    key.provider,
    key.workItemId,
    key.repositoryId ?? null,
    key.repositoryOwner ?? null,
    key.repositoryName ?? null,
    key.itemNumber ?? null,
    key.itemKey ?? null,
    key.nodeId ?? null,
  ]);
}

function assertPositiveDuration(leaseDurationMs: number): void {
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be a positive number");
  }
}
