import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  buildNexusAutomationWorkItemQuery,
  eligibleNexusAutomationWorkItems,
} from "./nexusAutomation.js";
import type {
  NexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import {
  listNexusEligibleWorkByComponent,
  type NexusEligibleWorkItem,
  type NexusEligibleWorkMode,
  type NexusEligibleWorkProviderContext,
} from "./nexusEligibleWork.js";
import type {
  NexusProjectConfig,
} from "./nexusProjectConfig.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import {
  assertWorkTrackerCapability,
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import type {
  WorkItem,
  WorkItemQuery,
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

export type NexusEligibleWorkClaimProviderFactory = (
  context: NexusEligibleWorkProviderContext,
) => WorkTrackerProvider;

export interface ClaimNexusEligibleWorkItemOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  automationConfig: NexusAutomationConfig;
  selectorQuery?: WorkItemQuery;
  mode?: NexusEligibleWorkMode;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusEligibleWorkClaimProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  owner: NexusWorkItemClaimOwnerInput;
  leaseDurationMs?: number;
  leaseTokenFactory?: () => string;
  now?: () => Date | string;
}

export type NexusWorkItemClaimResult =
  | {
      status: "claimed";
      workItem: WorkItem;
      componentId: string;
      trackerId: string;
      owner: NexusWorkItemClaimOwner;
      skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
    }
  | {
      status: "no_claim";
      reason: "no_eligible_candidate" | "candidates_not_claimable";
      skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
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
    };

const defaultLeaseDurationMs = 60 * 60 * 1000;
const claimMarkerName = "dev-nexus-work-item-claim";
const claimBlockPattern =
  /<!--\s*dev-nexus-work-item-claim\s*\n([\s\S]*?)\n-->/g;

export async function claimNexusEligibleWorkItem(
  options: ClaimNexusEligibleWorkItemOptions,
): Promise<NexusWorkItemClaimResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const selectorQuery =
    options.selectorQuery ??
    buildNexusAutomationWorkItemQuery(options.automationConfig);
  const eligibleWork = await listNexusEligibleWorkByComponent({
    projectRoot,
    projectConfig: options.projectConfig,
    components: options.components,
    automationConfig: options.automationConfig,
    selectorQuery,
    mode: options.mode,
    provider: options.provider,
    providerFactory: options.providerFactory,
    providerOptions: options.providerOptions,
    now: options.now,
  });
  if (eligibleWork.eligibleWorkItems.length === 0) {
    return {
      status: "no_claim",
      reason: "no_eligible_candidate",
      skippedCandidates: [],
    };
  }

  const skippedCandidates: NexusWorkItemClaimSkippedCandidate[] = [];
  for (const candidate of eligibleWork.eligibleWorkItems) {
    const resolved = resolveCandidateTracker(options, projectRoot, candidate);
    if (!resolved) {
      skippedCandidates.push(skippedCandidate(candidate, "missing_tracker", null));
      continue;
    }

    const { provider, tracker } = resolved;
    assertWorkTrackerCapability(provider, "get", "verify claim candidates");
    assertWorkTrackerCapability(provider, "update", "claim work items");
    const ref = workItemRefForCandidate(candidate);
    const fresh = await provider.getWorkItem(ref);
    const now = currentDate(options.now);
    const activeClaim = activeWorkItemClaim(fresh, now);
    const selectorMatch = eligibleNexusAutomationWorkItems(
      [fresh],
      options.automationConfig,
    ).length === 1;

    if (fresh.status === "in_progress") {
      skippedCandidates.push(
        skippedCandidate(candidate, "already_in_progress", fresh.status),
      );
      continue;
    }
    if (activeClaim) {
      skippedCandidates.push(
        skippedCandidate(candidate, "claimed_by_another_owner", fresh.status),
      );
      continue;
    }
    if (!selectorMatch) {
      skippedCandidates.push(
        skippedCandidate(
          candidate,
          fresh.status === "ready" ? "selector_mismatch" : "no_longer_ready",
          fresh.status,
        ),
      );
      continue;
    }

    const owner = claimOwner({
      input: options.owner,
      leaseToken:
        options.leaseTokenFactory?.() ?? randomUUID(),
      now,
      leaseDurationMs: options.leaseDurationMs ?? defaultLeaseDurationMs,
    });
    await provider.updateWorkItem(ref, {
      status: "in_progress",
      description: descriptionWithClaim(fresh.description, owner),
    });
    const observed = await provider.getWorkItem(ref);
    const observedClaim = activeWorkItemClaim(observed, now);
    if (
      observed.status !== "in_progress" ||
      observedClaim?.leaseToken !== owner.leaseToken
    ) {
      return {
        status: "lost_race",
        reason: "verification_failed",
        candidate: fresh,
        observedWorkItem: observed,
        componentId: candidate.componentId,
        trackerId: tracker.id,
        owner,
        skippedCandidates,
      };
    }

    if (provider.capabilities.comment) {
      await provider.addComment(ref, claimComment(owner));
    }

    return {
      status: "claimed",
      workItem: observed,
      componentId: candidate.componentId,
      trackerId: tracker.id,
      owner,
      skippedCandidates,
    };
  }

  return {
    status: "no_claim",
    reason: "candidates_not_claimable",
    skippedCandidates,
  };
}

function resolveCandidateTracker(
  options: ClaimNexusEligibleWorkItemOptions,
  projectRoot: string,
  candidate: NexusEligibleWorkItem,
): {
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
} | null {
  const component = options.components.find(
    (item) => item.id === candidate.componentId,
  );
  if (!component) {
    return null;
  }
  const trackerId =
    candidate.sourceTrackerRef?.trackerId ??
    candidate.canonicalTrackerRef?.trackerId ??
    candidate.trackerRef?.trackerId;
  const tracker = component.workTrackers.find((item) => item.id === trackerId);
  if (!tracker) {
    return null;
  }
  const context: NexusEligibleWorkProviderContext = {
    projectRoot,
    projectConfig: options.projectConfig,
    component,
    tracker,
    workTracking: tracker.workTracking,
  };
  const provider =
    options.provider ??
    options.providerFactory?.(context) ??
    createWorkTrackerProvider(tracker.workTracking, {
      ...options.providerOptions,
      projectRoot,
      now: options.now,
    });

  return {
    component,
    tracker,
    provider,
  };
}

function workItemRefForCandidate(candidate: NexusEligibleWorkItem): WorkItemRef {
  return {
    provider: candidate.provider,
    id: candidate.id,
    ...(candidate.externalRef ? { externalRef: candidate.externalRef } : {}),
  };
}

function skippedCandidate(
  candidate: NexusEligibleWorkItem,
  reason: NexusWorkItemClaimSkipReason,
  observedStatus: WorkStatus | null,
): NexusWorkItemClaimSkippedCandidate {
  return {
    id: candidate.id,
    title: candidate.title,
    componentId: candidate.componentId,
    trackerId:
      candidate.sourceTrackerRef?.trackerId ??
      candidate.canonicalTrackerRef?.trackerId ??
      candidate.trackerRef?.trackerId ??
      null,
    reason,
    observedStatus,
  };
}

function claimOwner(options: {
  input: NexusWorkItemClaimOwnerInput;
  leaseToken: string;
  now: Date;
  leaseDurationMs: number;
}): NexusWorkItemClaimOwner {
  if (!Number.isFinite(options.leaseDurationMs) || options.leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be a positive number");
  }
  const hostId = requiredNonEmptyString(options.input.hostId, "owner.hostId");
  const leaseToken = requiredNonEmptyString(options.leaseToken, "leaseToken");
  return {
    version: 1,
    hostId,
    agentId: optionalNonEmptyString(options.input.agentId) ?? null,
    ownerId: optionalNonEmptyString(options.input.ownerId) ?? null,
    leaseToken,
    claimedAt: options.now.toISOString(),
    expiresAt: new Date(options.now.getTime() + options.leaseDurationMs).toISOString(),
  };
}

function descriptionWithClaim(
  description: string | null | undefined,
  owner: NexusWorkItemClaimOwner,
): string {
  const base = (description ?? "").replace(claimBlockPattern, "").trimEnd();
  const block = [
    `<!-- ${claimMarkerName}`,
    JSON.stringify(owner),
    "-->",
  ].join("\n");

  return base ? `${base}\n\n${block}` : block;
}

function activeWorkItemClaim(
  item: Pick<WorkItem, "description">,
  now: Date,
): NexusWorkItemClaimOwner | null {
  const claims = workItemClaims(item.description);
  for (let index = claims.length - 1; index >= 0; index -= 1) {
    const claim = claims[index]!;
    if (dateFrom(claim.expiresAt, "claim.expiresAt").getTime() > now.getTime()) {
      return claim;
    }
  }

  return null;
}

function workItemClaims(
  description: string | null | undefined,
): NexusWorkItemClaimOwner[] {
  if (!description) {
    return [];
  }
  const claims: NexusWorkItemClaimOwner[] = [];
  for (const match of description.matchAll(claimBlockPattern)) {
    const raw = match[1];
    if (!raw) {
      continue;
    }
    const parsed = safeJsonParse(raw);
    const claim = normalizeClaimOwner(parsed);
    if (claim) {
      claims.push(claim);
    }
  }

  return claims;
}

function normalizeClaimOwner(value: unknown): NexusWorkItemClaimOwner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  const hostId = optionalNonEmptyString(record.hostId);
  const leaseToken = optionalNonEmptyString(record.leaseToken);
  const claimedAt = optionalNonEmptyString(record.claimedAt);
  const expiresAt = optionalNonEmptyString(record.expiresAt);
  if (!hostId || !leaseToken || !claimedAt || !expiresAt) {
    return null;
  }
  if (
    Number.isNaN(new Date(claimedAt).getTime()) ||
    Number.isNaN(new Date(expiresAt).getTime())
  ) {
    return null;
  }

  return {
    version: 1,
    hostId,
    agentId: optionalNonEmptyString(record.agentId) ?? null,
    ownerId: optionalNonEmptyString(record.ownerId) ?? null,
    leaseToken,
    claimedAt: new Date(claimedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function claimComment(owner: NexusWorkItemClaimOwner): string {
  return [
    "DevNexus optimistic claim acquired.",
    "",
    `- host: ${owner.hostId}`,
    ...(owner.agentId ? [`- agent: ${owner.agentId}`] : []),
    ...(owner.ownerId ? [`- owner: ${owner.ownerId}`] : []),
    `- lease token: ${owner.leaseToken}`,
    `- expires: ${owner.expiresAt}`,
  ].join("\n");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function currentDate(now?: () => Date | string): Date {
  return dateFrom(now ? now() : new Date(), "now");
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }

  return date;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  const normalized = optionalNonEmptyString(value);
  if (!normalized) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
