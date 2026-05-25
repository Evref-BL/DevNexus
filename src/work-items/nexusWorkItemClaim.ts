import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  buildNexusAutomationWorkItemQuery,
  eligibleNexusAutomationWorkItems,
} from "../automation/nexusAutomation.js";
import type {
  NexusAutomationConfig,
} from "../automation/nexusAutomationConfig.js";
import {
  listNexusEligibleWorkByComponent,
  type NexusEligibleWorkItem,
  type NexusEligibleWorkMode,
  type NexusEligibleWorkProviderContext,
} from "./nexusEligibleWork.js";
import type {
  NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "../project/nexusProjectLifecycle.js";
import {
  assertWorkTrackerCapability,
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusClaimAuthorityProfileConfig,
} from "../project/nexusHomeConfig.js";
import {
  createNexusNodePostgresClaimSqlClient,
  type NexusNodePostgresModule,
} from "./nexusNodePostgresClaimSqlClient.js";
import {
  NexusPostgresWorkItemClaimAuthority,
} from "./nexusPostgresWorkItemClaimAuthority.js";
import {
  resolveNexusProjectPath,
} from "../runtime/nexusPathResolver.js";
import {
  nexusWorkItemDiscoveryCredentialEnvironment,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  automationWorkItemDiscoveryCredentialResolver,
  automationWorkTrackerProviderOptions,
  loadNexusAutomationAuthProfiles,
} from "../automation/nexusAutomationWorkTrackingCredentials.js";
import type {
  WorkItem,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";
import type {
  NexusWorkItemClaimAuthority,
  NexusWorkItemClaimAuthorityRecord,
  NexusWorkItemClaimAuthorityHeartbeatResult,
  NexusWorkItemClaimAuthorityReleaseResult,
  NexusWorkItemClaimAuthorityVerifyResult,
  NexusWorkItemClaimObservation,
  NexusWorkItemClaimOwner,
  NexusWorkItemClaimOwnerInput,
  NexusWorkItemClaimResult,
  NexusWorkItemClaimSkipReason,
  NexusWorkItemClaimSkippedCandidate,
  NexusWorkItemStaleClaimPolicy,
} from "./nexusWorkItemClaimAuthority.js";
import {
  nexusWorkItemClaimAuthorityKeyForWorkItem,
} from "./nexusWorkItemClaimAuthority.js";
export {
  NexusMemoryWorkItemClaimAuthority,
  nexusWorkItemClaimAuthorityKey,
  nexusWorkItemClaimAuthorityKeyForWorkItem,
} from "./nexusWorkItemClaimAuthority.js";
export type {
  NexusWorkItemClaimAuthority,
  NexusWorkItemClaimAuthorityClaimCandidateOptions,
  NexusWorkItemClaimAuthorityClaimCandidateResult,
  NexusWorkItemClaimAuthorityHeartbeatResult,
  NexusWorkItemClaimAuthorityInspectOptions,
  NexusWorkItemClaimAuthorityInspectResult,
  NexusWorkItemClaimAuthorityKey,
  NexusWorkItemClaimAuthorityRecord,
  NexusWorkItemClaimAuthorityReclaimExpiredClaimOptions,
  NexusWorkItemClaimAuthorityReclaimResult,
  NexusWorkItemClaimAuthorityReleaseResult,
  NexusWorkItemClaimAuthorityState,
  NexusWorkItemClaimAuthorityVerifyResult,
  NexusWorkItemClaimObservation,
  NexusWorkItemClaimOwner,
  NexusWorkItemClaimOwnerInput,
  NexusWorkItemClaimResult,
  NexusWorkItemClaimSkipReason,
  NexusWorkItemClaimSkippedCandidate,
  NexusWorkItemStaleClaimPolicy,
} from "./nexusWorkItemClaimAuthority.js";

export type NexusEligibleWorkClaimProviderFactory = (
  context: NexusEligibleWorkProviderContext,
) => WorkTrackerProvider | Promise<WorkTrackerProvider>;

export interface ClaimNexusEligibleWorkItemOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  automationConfig: NexusAutomationConfig;
  componentId?: string | null;
  trackerId?: string | null;
  selectorQuery?: WorkItemQuery;
  mode?: NexusEligibleWorkMode;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusEligibleWorkClaimProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
  owner: NexusWorkItemClaimOwnerInput;
  claimAuthority?: NexusWorkItemClaimAuthority;
  nodePostgresModule?: NexusNodePostgresModule;
  nodePostgresModuleLoader?: () => Promise<unknown>;
  leaseDurationMs?: number;
  staleClaimPolicy?: NexusWorkItemStaleClaimPolicy;
  leaseTokenFactory?: () => string;
  now?: () => Date | string;
}

export interface ReleaseNexusWorkItemAuthorityClaimOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  automationConfig: NexusAutomationConfig;
  componentId?: string | null;
  trackerId?: string | null;
  workItemId: string;
  leaseToken: string;
  fencingToken?: number | null;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusEligibleWorkClaimProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
  claimAuthority?: NexusWorkItemClaimAuthority;
  nodePostgresModule?: NexusNodePostgresModule;
  nodePostgresModuleLoader?: () => Promise<unknown>;
  now?: () => Date | string;
}

export interface NexusWorkItemAuthorityClaimReleaseResult {
  projectRoot: string;
  componentId: string;
  trackerId: string;
  workItem: WorkItem;
  authorityKind: string;
  release: NexusWorkItemClaimAuthorityReleaseResult;
}

const defaultLeaseDurationMs = 60 * 60 * 1000;
const claimMarkerName = "dev-nexus-work-item-claim";

interface ClaimInspectionCandidate {
  observation: NexusWorkItemClaimObservation;
  candidate: NexusEligibleWorkItem;
  workItem: WorkItem;
  provider: WorkTrackerProvider;
  tracker: ResolvedNexusProjectWorkTracker;
  ref: WorkItemRef;
}

interface ClaimInspectionResult {
  activeClaims: ClaimInspectionCandidate[];
  staleClaims: ClaimInspectionCandidate[];
}

const optimisticTrackerClaimAuthority: NexusWorkItemClaimAuthority = {
  kind: "optimistic-tracker",
  async claimCandidate(options) {
    assertWorkTrackerCapability(
      options.provider,
      "update",
      "claim work items",
    );
    await options.provider.updateWorkItem(options.ref, {
      status: "in_progress",
      description: descriptionWithClaim(
        options.freshWorkItem.description,
        options.owner,
      ),
    });
    const observed = await options.provider.getWorkItem(options.ref);
    const observedClaim = activeWorkItemClaim(observed, options.now);
    if (
      observed.status !== "in_progress" ||
      observedClaim?.leaseToken !== options.owner.leaseToken
    ) {
      return {
        status: "lost_race",
        observedWorkItem: observed,
      };
    }

    if (options.provider.capabilities.comment) {
      await options.provider.addComment(
        options.ref,
        claimComment(options.owner),
      );
    }

    return {
      status: "claimed",
      workItem: observed,
    };
  },
  async reclaimExpiredClaim(options) {
    assertWorkTrackerCapability(
      options.provider,
      "update",
      "reclaim stale work item claims",
    );
    await options.provider.updateWorkItem(options.ref, {
      status: "in_progress",
      description: descriptionWithClaim(
        options.freshWorkItem.description,
        options.owner,
      ),
    });
    const observed = await options.provider.getWorkItem(options.ref);
    const observedClaim = activeWorkItemClaim(observed, options.now);
    if (
      observed.status !== "in_progress" ||
      observedClaim?.leaseToken !== options.owner.leaseToken
    ) {
      return {
        status: "lost_race",
        observedWorkItem: observed,
      };
    }

    if (options.provider.capabilities.comment) {
      await options.provider.addComment(
        options.ref,
        reclaimComment(options.owner, options.previousOwner),
      );
    }

    return {
      status: "claimed",
      workItem: observed,
    };
  },
};

export async function claimNexusEligibleWorkItem(
  options: ClaimNexusEligibleWorkItemOptions,
): Promise<NexusWorkItemClaimResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const components = claimSelectableComponents(options);
  const env = nexusWorkItemDiscoveryCredentialEnvironment({
    projectRoot,
    projectConfig: options.projectConfig,
    env: options.env ?? process.env,
  });
  const credentialResolver = automationWorkItemDiscoveryCredentialResolver({
    env,
    authProfiles: loadNexusAutomationAuthProfiles({
      projectRoot,
      projectConfig: options.projectConfig,
    }),
  });
  const selectorQuery =
    options.selectorQuery ??
    buildNexusAutomationWorkItemQuery(options.automationConfig);
  const eligibleWork = await listNexusEligibleWorkByComponent({
    projectRoot,
    projectConfig: options.projectConfig,
    components,
    automationConfig: options.automationConfig,
    selectorQuery,
    mode: options.mode,
    provider: options.provider,
    providerFactory: claimProviderFactory(options, projectRoot, env),
    providerOptions: options.providerOptions,
    credentialResolver,
    env,
    now: options.now,
  });
  const now = currentDate(options.now);
  const claimAuthority = await claimAuthorityForConfig(options, projectRoot, env);
  const context: ClaimExecutionContext = {
    options,
    projectRoot,
    components,
    env,
    selectorQuery,
    eligibleWork,
    now,
    claimAuthority,
    activeClaims: [],
    skippedCandidates: [],
  };

  if (eligibleWork.eligibleWorkItems.length === 0) {
    return claimNoEligibleCandidateResult(context);
  }

  return (
    (await claimFirstEligibleCandidate(context)) ??
    (await claimRemainingCandidatesResult(context))
  );
}

interface ClaimExecutionContext {
  options: ClaimNexusEligibleWorkItemOptions;
  projectRoot: string;
  components: ResolvedNexusProjectComponent[];
  env: NodeJS.ProcessEnv;
  selectorQuery: WorkItemQuery;
  eligibleWork: Awaited<ReturnType<typeof listNexusEligibleWorkByComponent>>;
  now: Date;
  claimAuthority: NexusWorkItemClaimAuthority;
  activeClaims: NexusWorkItemClaimObservation[];
  skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
}

interface ResolvedClaimCandidate {
  candidate: NexusEligibleWorkItem;
  provider: WorkTrackerProvider;
  tracker: ResolvedNexusProjectWorkTracker;
  ref: WorkItemRef;
  fresh: WorkItem;
}

async function claimNoEligibleCandidateResult(
  context: ClaimExecutionContext,
): Promise<NexusWorkItemClaimResult> {
  const inspectedClaims = await inspectClaimsForContext(context);
  const reclaimed = await maybeReclaimStaleClaim({
    options: context.options,
    projectRoot: context.projectRoot,
    env: context.env,
    inspection: inspectedClaims,
    now: context.now,
    skippedCandidates: [],
  });
  if (reclaimed) {
    return reclaimed;
  }

  return noClaimResult("no_eligible_candidate", [], {
    activeClaims: inspectedClaims.activeClaims.map((item) => item.observation),
    staleClaims: inspectedClaims.staleClaims.map((item) => item.observation),
  });
}

async function claimFirstEligibleCandidate(
  context: ClaimExecutionContext,
): Promise<NexusWorkItemClaimResult | null> {
  for (const candidate of context.eligibleWork.eligibleWorkItems) {
    const resolved = await resolveFreshClaimCandidate(context, candidate);
    if (!resolved) {
      continue;
    }
    return claimResolvedEligibleCandidate(context, resolved);
  }
  return null;
}

async function resolveFreshClaimCandidate(
  context: ClaimExecutionContext,
  candidate: NexusEligibleWorkItem,
): Promise<ResolvedClaimCandidate | null> {
  const resolved = await resolveCandidateTracker(
    context.options,
    context.projectRoot,
    context.components,
    candidate,
    context.env,
  );
  if (!resolved) {
    context.skippedCandidates.push(
      skippedCandidate(candidate, "missing_tracker", null),
    );
    return null;
  }

  const { provider, tracker } = resolved;
  assertWorkTrackerCapability(provider, "get", "verify claim candidates");
  const ref = workItemRefForCandidate(candidate);
  const fresh = await provider.getWorkItem(ref);
  const activeClaim = activeWorkItemClaim(fresh, context.now);
  const selectorMatch =
    eligibleNexusAutomationWorkItems(
      [fresh],
      context.options.automationConfig,
    ).length === 1;
  const skipReason = freshClaimSkipReason(fresh, activeClaim, selectorMatch);
  if (skipReason) {
    if (activeClaim) {
      context.activeClaims.push(
        claimObservation(candidate, tracker, fresh, activeClaim),
      );
    }
    context.skippedCandidates.push(
      skippedCandidate(candidate, skipReason, fresh.status),
    );
    return null;
  }

  return { candidate, provider, tracker, ref, fresh };
}

function freshClaimSkipReason(
  fresh: WorkItem,
  activeClaim: NexusWorkItemClaimOwner | null,
  selectorMatch: boolean,
): NexusWorkItemClaimSkipReason | null {
  if (fresh.status === "in_progress") {
    return "already_in_progress";
  }
  if (activeClaim) {
    return "claimed_by_another_owner";
  }
  if (!selectorMatch) {
    return fresh.status === "ready" ? "selector_mismatch" : "no_longer_ready";
  }
  return null;
}

async function claimResolvedEligibleCandidate(
  context: ClaimExecutionContext,
  resolved: ResolvedClaimCandidate,
): Promise<NexusWorkItemClaimResult> {
  const owner = claimOwner({
    input: context.options.owner,
    leaseToken: context.options.leaseTokenFactory?.() ?? randomUUID(),
    now: context.now,
    leaseDurationMs: context.options.leaseDurationMs ?? defaultLeaseDurationMs,
  });
  const claimAttempt = await context.claimAuthority.claimCandidate({
    projectId: context.options.projectConfig.id,
    candidate: resolved.candidate,
    tracker: resolved.tracker,
    provider: resolved.provider,
    ref: resolved.ref,
    freshWorkItem: resolved.fresh,
    owner,
    now: context.now,
  });
  if (claimAttempt.status === "lost_race") {
    return claimCandidateLostRaceResult(
      context,
      resolved,
      owner,
      claimAttempt.observedWorkItem,
      claimAttempt.authorityClaim,
    );
  }

  const verification = await verifyAuthorityBackedClaim({
    claimAuthority: context.claimAuthority,
    authorityClaim: claimAttempt.authorityClaim,
    provider: resolved.provider,
    ref: resolved.ref,
    owner,
    now: context.now,
  });
  if (verification.status === "lost_race") {
    return claimCandidateLostRaceResult(
      context,
      resolved,
      owner,
      verification.observedWorkItem,
      verification.authorityClaim,
    );
  }

  return claimCandidateSuccessResult(
    context,
    resolved,
    owner,
    claimAttempt.workItem,
    verification.authorityClaim,
  );
}

function claimCandidateLostRaceResult(
  context: ClaimExecutionContext,
  resolved: ResolvedClaimCandidate,
  owner: NexusWorkItemClaimOwner,
  observedWorkItem: WorkItem,
  authorityClaim?: NexusWorkItemClaimAuthorityRecord,
): NexusWorkItemClaimResult {
  return {
    status: "lost_race",
    reason: "verification_failed",
    candidate: resolved.fresh,
    observedWorkItem,
    componentId: resolved.candidate.componentId,
    trackerId: resolved.tracker.id,
    owner,
    ...(authorityClaim ? { authorityClaim } : {}),
    skippedCandidates: context.skippedCandidates,
    ...claimDiagnosticsFields({ activeClaims: context.activeClaims, staleClaims: [] }),
  };
}

function claimCandidateSuccessResult(
  context: ClaimExecutionContext,
  resolved: ResolvedClaimCandidate,
  owner: NexusWorkItemClaimOwner,
  workItem: WorkItem,
  authorityClaim?: NexusWorkItemClaimAuthorityRecord,
): NexusWorkItemClaimResult {
  return {
    status: "claimed",
    workItem,
    componentId: resolved.candidate.componentId,
    trackerId: resolved.tracker.id,
    owner,
    ...(authorityClaim ? { authorityClaim } : {}),
    skippedCandidates: context.skippedCandidates,
    ...claimDiagnosticsFields({ activeClaims: context.activeClaims, staleClaims: [] }),
  };
}

async function claimRemainingCandidatesResult(
  context: ClaimExecutionContext,
): Promise<NexusWorkItemClaimResult> {
  const inspectedClaims = await inspectClaimsForContext(context);
  const combinedActiveClaims = [
    ...context.activeClaims,
    ...inspectedClaims.activeClaims.map((item) => item.observation),
  ];
  const reclaimed = await maybeReclaimStaleClaim({
    options: context.options,
    projectRoot: context.projectRoot,
    env: context.env,
    inspection: inspectedClaims,
    now: context.now,
    skippedCandidates: context.skippedCandidates,
    activeClaims: combinedActiveClaims,
  });
  if (reclaimed) {
    return reclaimed;
  }

  return noClaimResult("candidates_not_claimable", context.skippedCandidates, {
    activeClaims: combinedActiveClaims,
    staleClaims: inspectedClaims.staleClaims.map((item) => item.observation),
  });
}

function inspectClaimsForContext(
  context: ClaimExecutionContext,
): Promise<ClaimInspectionResult> {
  return inspectExistingWorkItemClaims({
    options: context.options,
    projectRoot: context.projectRoot,
    components: context.components,
    env: context.env,
    selectorQuery: context.selectorQuery,
    now: context.now,
  });
}

export async function verifyNexusWorkItemAuthorityClaim(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  authorityClaim: NexusWorkItemClaimAuthorityRecord;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
  claimAuthority?: NexusWorkItemClaimAuthority;
  nodePostgresModule?: NexusNodePostgresModule;
  nodePostgresModuleLoader?: () => Promise<unknown>;
  now?: () => Date | string;
}): Promise<NexusWorkItemClaimAuthorityVerifyResult> {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const env = nexusWorkItemDiscoveryCredentialEnvironment({
    projectRoot,
    projectConfig: options.projectConfig,
    env: options.env ?? process.env,
  });
  const claimAuthority = await claimAuthorityForConfig(options, projectRoot, env);
  if (!claimAuthority.verifyClaim) {
    throw new Error(
      `Claim authority backend ${claimAuthority.kind} does not support claim verification`,
    );
  }

  return claimAuthority.verifyClaim({
    key: options.authorityClaim.key,
    leaseToken: options.authorityClaim.owner.leaseToken,
    now: currentDate(options.now),
  });
}

export async function heartbeatNexusWorkItemAuthorityClaim(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  authorityClaim: NexusWorkItemClaimAuthorityRecord;
  leaseDurationMs?: number;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
  claimAuthority?: NexusWorkItemClaimAuthority;
  nodePostgresModule?: NexusNodePostgresModule;
  nodePostgresModuleLoader?: () => Promise<unknown>;
  now?: () => Date | string;
}): Promise<NexusWorkItemClaimAuthorityHeartbeatResult> {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const env = nexusWorkItemDiscoveryCredentialEnvironment({
    projectRoot,
    projectConfig: options.projectConfig,
    env: options.env ?? process.env,
  });
  const claimAuthority = await claimAuthorityForConfig(options, projectRoot, env);
  if (!claimAuthority.heartbeatClaim) {
    throw new Error(
      `Claim authority backend ${claimAuthority.kind} does not support claim heartbeat`,
    );
  }

  return claimAuthority.heartbeatClaim({
    key: options.authorityClaim.key,
    leaseToken: options.authorityClaim.owner.leaseToken,
    leaseDurationMs: options.leaseDurationMs ?? defaultLeaseDurationMs,
    now: currentDate(options.now),
  });
}

export async function releaseNexusWorkItemAuthorityClaim(
  options: ReleaseNexusWorkItemAuthorityClaimOptions,
): Promise<NexusWorkItemAuthorityClaimReleaseResult> {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const env = nexusWorkItemDiscoveryCredentialEnvironment({
    projectRoot,
    projectConfig: options.projectConfig,
    env: options.env ?? process.env,
  });
  const now = currentDate(options.now);
  const claimAuthority = await claimAuthorityForConfig(options, projectRoot, env);
  if (!claimAuthority.releaseClaim) {
    throw new Error(
      `Claim authority backend ${claimAuthority.kind} does not support claim release`,
    );
  }

  const target = await resolveClaimReleaseTarget({
    options,
    projectRoot,
    env,
  });
  const key = nexusWorkItemClaimAuthorityKeyForWorkItem({
    projectId: options.projectConfig.id,
    componentId: target.component.id,
    tracker: target.tracker,
    workItem: target.workItem,
  });

  return {
    projectRoot,
    componentId: target.component.id,
    trackerId: target.tracker.id,
    workItem: target.workItem,
    authorityKind: claimAuthority.kind,
    release: await claimAuthority.releaseClaim({
      key,
      leaseToken: requiredNonEmptyString(options.leaseToken, "leaseToken"),
      fencingToken: options.fencingToken ?? null,
      now,
    }),
  };
}

async function inspectExistingWorkItemClaims(options: {
  options: ClaimNexusEligibleWorkItemOptions;
  projectRoot: string;
  components: ResolvedNexusProjectComponent[];
  env: NodeJS.ProcessEnv;
  selectorQuery: WorkItemQuery;
  now: Date;
}): Promise<ClaimInspectionResult> {
  const automationConfig = {
    ...options.options.automationConfig,
    selector: {
      ...options.options.automationConfig.selector,
      statuses: ["in_progress" as const],
    },
  };
  const selectorQuery: WorkItemQuery = {
    ...options.selectorQuery,
    status: "in_progress",
  };
  const eligibleWork = await listNexusEligibleWorkByComponent({
    projectRoot: options.projectRoot,
    projectConfig: options.options.projectConfig,
    components: options.components,
    automationConfig,
    selectorQuery,
    mode: options.options.mode,
    provider: options.options.provider,
    providerFactory: claimProviderFactory(
      options.options,
      options.projectRoot,
      options.env,
    ),
    providerOptions: options.options.providerOptions,
    credentialResolver: automationWorkItemDiscoveryCredentialResolver({
      env: options.env,
      authProfiles: loadNexusAutomationAuthProfiles({
        projectRoot: options.projectRoot,
        projectConfig: options.options.projectConfig,
      }),
    }),
    env: options.env,
    now: options.options.now,
  });
  const activeClaims: ClaimInspectionCandidate[] = [];
  const staleClaims: ClaimInspectionCandidate[] = [];

  for (const candidate of eligibleWork.eligibleWorkItems) {
    const resolved = await resolveCandidateTracker(
      options.options,
      options.projectRoot,
      options.components,
      candidate,
      options.env,
    );
    if (!resolved) {
      continue;
    }
    const { provider, tracker } = resolved;
    assertWorkTrackerCapability(provider, "get", "inspect work item claims");
    const ref = workItemRefForCandidate(candidate);
    const fresh = await provider.getWorkItem(ref);
    const claim = latestWorkItemClaim(fresh);
    if (!claim) {
      continue;
    }
    const inspection = {
      observation: claimObservation(candidate, tracker, fresh, claim),
      candidate,
      workItem: fresh,
      provider,
      tracker,
      ref,
    };
    if (claimIsActive(claim, options.now)) {
      activeClaims.push(inspection);
    } else {
      staleClaims.push(inspection);
    }
  }

  return {
    activeClaims,
    staleClaims,
  };
}

async function maybeReclaimStaleClaim(options: {
  options: ClaimNexusEligibleWorkItemOptions;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  inspection: ClaimInspectionResult;
  now: Date;
  skippedCandidates: NexusWorkItemClaimSkippedCandidate[];
  activeClaims?: NexusWorkItemClaimObservation[];
}): Promise<NexusWorkItemClaimResult | null> {
  if (
    options.options.staleClaimPolicy !== "reclaim" ||
    options.inspection.staleClaims.length === 0
  ) {
    return null;
  }

  const staleClaim = options.inspection.staleClaims[0]!;
  const { provider, ref, workItem, candidate, tracker } = staleClaim;
  const owner = claimOwner({
    input: options.options.owner,
    leaseToken:
      options.options.leaseTokenFactory?.() ?? randomUUID(),
    now: options.now,
    leaseDurationMs:
      options.options.leaseDurationMs ?? defaultLeaseDurationMs,
  });
  const claimAuthority = await claimAuthorityForConfig(
    options.options,
    options.projectRoot,
    options.env,
  );
  if (!claimAuthority.reclaimExpiredClaim) {
    return null;
  }
  const reclaimAttempt = await claimAuthority.reclaimExpiredClaim({
    projectId: options.options.projectConfig.id,
    candidate,
    tracker,
    provider,
    ref,
    freshWorkItem: workItem,
    previousOwner: staleClaim.observation.owner,
    owner,
    now: options.now,
  });
  const activeClaims = options.activeClaims ?? [];
  const staleClaims = options.inspection.staleClaims.map((item) => item.observation);
  if (reclaimAttempt.status === "rejected") {
    return null;
  }
  if (reclaimAttempt.status === "lost_race") {
    return {
      status: "lost_race",
      reason: "verification_failed",
      candidate: workItem,
      observedWorkItem: reclaimAttempt.observedWorkItem,
      componentId: candidate.componentId,
      trackerId: tracker.id,
      owner,
      ...(reclaimAttempt.authorityClaim
        ? { authorityClaim: reclaimAttempt.authorityClaim }
        : {}),
      skippedCandidates: options.skippedCandidates,
      reclaimedFrom: staleClaim.observation,
      ...claimDiagnosticsFields({ activeClaims, staleClaims }),
    };
  }
  const verification = await verifyAuthorityBackedClaim({
    claimAuthority,
    authorityClaim: reclaimAttempt.authorityClaim,
    provider,
    ref,
    owner,
    now: options.now,
  });
  if (verification.status === "lost_race") {
    return {
      status: "lost_race",
      reason: "verification_failed",
      candidate: workItem,
      observedWorkItem: verification.observedWorkItem,
      componentId: candidate.componentId,
      trackerId: tracker.id,
      owner,
      ...(verification.authorityClaim
        ? { authorityClaim: verification.authorityClaim }
        : {}),
      skippedCandidates: options.skippedCandidates,
      reclaimedFrom: staleClaim.observation,
      ...claimDiagnosticsFields({ activeClaims, staleClaims }),
    };
  }

  return {
    status: "claimed",
    workItem: reclaimAttempt.workItem,
    componentId: candidate.componentId,
    trackerId: tracker.id,
    owner,
    ...(verification.authorityClaim
      ? { authorityClaim: verification.authorityClaim }
      : {}),
    skippedCandidates: options.skippedCandidates,
    reclaimedFrom: staleClaim.observation,
    ...claimDiagnosticsFields({ activeClaims, staleClaims }),
  };
}

async function verifyAuthorityBackedClaim(options: {
  claimAuthority: NexusWorkItemClaimAuthority;
  authorityClaim?: NexusWorkItemClaimAuthorityRecord;
  provider: WorkTrackerProvider;
  ref: WorkItemRef;
  owner: NexusWorkItemClaimOwner;
  now: Date;
}): Promise<
  | {
      status: "verified";
      authorityClaim?: NexusWorkItemClaimAuthorityRecord;
    }
  | {
      status: "lost_race";
      observedWorkItem: WorkItem;
      authorityClaim?: NexusWorkItemClaimAuthorityRecord;
    }
> {
  if (!options.authorityClaim || !options.claimAuthority.verifyClaim) {
    return {
      status: "verified",
      ...(options.authorityClaim
        ? { authorityClaim: options.authorityClaim }
        : {}),
    };
  }

  const verification = await options.claimAuthority.verifyClaim({
    key: options.authorityClaim.key,
    leaseToken: options.owner.leaseToken,
    now: options.now,
  });
  if (verification.status === "verified") {
    return {
      status: "verified",
      authorityClaim: verification.claim,
    };
  }

  return {
    status: "lost_race",
    observedWorkItem: await options.provider.getWorkItem(options.ref),
    ...(verification.claim
      ? { authorityClaim: verification.claim }
      : { authorityClaim: options.authorityClaim }),
  };
}

function noClaimResult(
  fallbackReason: Extract<
    NexusWorkItemClaimResult,
    { status: "no_claim" }
  >["reason"],
  skippedCandidates: NexusWorkItemClaimSkippedCandidate[],
  diagnostics: {
    activeClaims: NexusWorkItemClaimObservation[];
    staleClaims: NexusWorkItemClaimObservation[];
  },
): NexusWorkItemClaimResult {
  const reason =
    diagnostics.staleClaims.length > 0
      ? "stale_claims"
      : diagnostics.activeClaims.length > 0
        ? "active_claims"
        : fallbackReason;
  return {
    status: "no_claim",
    reason,
    skippedCandidates,
    ...claimDiagnosticsFields(diagnostics),
  };
}

async function claimAuthorityForConfig(
  options: Pick<
    ClaimNexusEligibleWorkItemOptions,
    | "automationConfig"
    | "claimAuthority"
    | "projectConfig"
    | "homePath"
    | "nodePostgresModule"
    | "nodePostgresModuleLoader"
  >,
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<NexusWorkItemClaimAuthority> {
  if (options.claimAuthority) {
    return options.claimAuthority;
  }
  const backend = options.automationConfig.workItemClaims.authority.backend;
  if (backend === "optimistic_tracker") {
    return optimisticTrackerClaimAuthority;
  }

  return postgresClaimAuthorityForConfig(options, projectRoot, env);
}

async function postgresClaimAuthorityForConfig(
  options: Pick<
    ClaimNexusEligibleWorkItemOptions,
    | "automationConfig"
    | "projectConfig"
    | "homePath"
    | "nodePostgresModule"
    | "nodePostgresModuleLoader"
  >,
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<NexusWorkItemClaimAuthority> {
  const profileId =
    options.automationConfig.workItemClaims.authority.postgres.connectionProfileId;
  if (!profileId) {
    throw new Error(
      "PostgreSQL claim authority requires project config.automation.workItemClaims.authority.postgres.connectionProfileId",
    );
  }

  const profile = loadClaimAuthorityProfiles({
    projectRoot,
    projectConfig: options.projectConfig,
    homePath: options.homePath,
  }).find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(
      `PostgreSQL claim authority profile ${profileId} was not found in DevNexus home config`,
    );
  }

  const connectionString = optionalNonEmptyString(env[profile.connectionStringEnv]);
  if (!connectionString) {
    throw new Error(
      `PostgreSQL claim authority profile ${profile.id} requires environment variable ${profile.connectionStringEnv}`,
    );
  }

  const client = await createNexusNodePostgresClaimSqlClient({
    connectionString,
    schema: profile.schema,
    module: options.nodePostgresModule,
    loadModule: options.nodePostgresModuleLoader,
  });
  return new NexusPostgresWorkItemClaimAuthority({ client });
}

function loadClaimAuthorityProfiles(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): NexusClaimAuthorityProfileConfig[] {
  const homePath = options.homePath
    ? path.resolve(options.homePath)
    : options.projectConfig.home
      ? resolveNexusProjectPath({
          projectRoot: options.projectRoot,
          value: options.projectConfig.home,
        })
      : defaultNexusHomePath();
  try {
    return loadNexusHomeConfigFile(
      homePath,
      validateNexusHomeConfigBase,
    ).claimAuthorityProfiles ?? [];
  } catch {
    return [];
  }
}

function claimDiagnosticsFields(diagnostics: {
  activeClaims: NexusWorkItemClaimObservation[];
  staleClaims: NexusWorkItemClaimObservation[];
}): {
  activeClaims?: NexusWorkItemClaimObservation[];
  staleClaims?: NexusWorkItemClaimObservation[];
} {
  return {
    ...(diagnostics.activeClaims.length > 0
      ? { activeClaims: diagnostics.activeClaims }
      : {}),
    ...(diagnostics.staleClaims.length > 0
      ? { staleClaims: diagnostics.staleClaims }
      : {}),
  };
}

function claimObservation(
  candidate: NexusEligibleWorkItem,
  tracker: ResolvedNexusProjectWorkTracker,
  item: WorkItem,
  owner: NexusWorkItemClaimOwner,
): NexusWorkItemClaimObservation {
  return {
    id: item.id,
    title: item.title,
    componentId: candidate.componentId,
    trackerId: tracker.id,
    observedStatus: item.status,
    owner,
  };
}

async function resolveCandidateTracker(
  options: ClaimNexusEligibleWorkItemOptions,
  projectRoot: string,
  components: ResolvedNexusProjectComponent[],
  candidate: NexusEligibleWorkItem,
  env: NodeJS.ProcessEnv,
): Promise<{
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
} | null> {
  const component = components.find(
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
    (options.providerFactory
      ? await options.providerFactory(context)
      : await createWorkTrackerProviderAsync(tracker.workTracking, {
          ...providerOptionsWithEnv(
            automationWorkTrackerProviderOptions({
              projectRoot,
              projectConfig: options.projectConfig,
              component,
              workTrackingProvider: tracker.workTracking.provider,
              baseOptions: options.providerOptions,
              env,
              now: options.now,
            }),
            env,
          ),
          projectRoot,
          now: options.now,
        }));

  return {
    component,
    tracker,
    provider,
  };
}

async function resolveClaimReleaseTarget(options: {
  options: ReleaseNexusWorkItemAuthorityClaimOptions;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
}): Promise<{
  component: ResolvedNexusProjectComponent;
  tracker: ResolvedNexusProjectWorkTracker;
  provider: WorkTrackerProvider;
  workItem: WorkItem;
}> {
  const component = claimReleaseComponent(options.options);
  const tracker = claimReleaseTracker(component, options.options.trackerId);
  const context: NexusEligibleWorkProviderContext = {
    projectRoot: options.projectRoot,
    projectConfig: options.options.projectConfig,
    component,
    tracker,
    workTracking: tracker.workTracking,
  };
  const provider =
    options.options.provider ??
    (options.options.providerFactory
      ? await options.options.providerFactory(context)
      : await createWorkTrackerProviderAsync(tracker.workTracking, {
          ...providerOptionsWithEnv(
            automationWorkTrackerProviderOptions({
              projectRoot: options.projectRoot,
              projectConfig: options.options.projectConfig,
              component,
              workTrackingProvider: tracker.workTracking.provider,
              baseOptions: options.options.providerOptions,
              env: options.env,
              now: options.options.now,
            }),
            options.env,
          ),
          projectRoot: options.projectRoot,
          now: options.options.now,
        }));
  assertWorkTrackerCapability(provider, "get", "release work item claims");
  const workItem = await provider.getWorkItem({
    provider: tracker.workTracking.provider,
    id: requiredNonEmptyString(options.options.workItemId, "workItemId"),
  });

  return {
    component,
    tracker,
    provider,
    workItem,
  };
}

function claimReleaseComponent(
  options: ReleaseNexusWorkItemAuthorityClaimOptions,
): ResolvedNexusProjectComponent {
  const componentId = optionalNonEmptyString(options.componentId);
  const component = componentId
    ? options.components.find((candidate) => candidate.id === componentId)
    : options.components.find((candidate) => candidate.role === "primary") ??
      options.components[0];
  if (!component) {
    throw new Error(
      componentId
        ? `Workspace component is not configured: ${componentId}`
        : "Workspace has no configured components",
    );
  }

  return component;
}

function claimReleaseTracker(
  component: ResolvedNexusProjectComponent,
  trackerId: string | null | undefined,
): ResolvedNexusProjectWorkTracker {
  const resolvedTrackerId =
    optionalNonEmptyString(trackerId) ??
    optionalNonEmptyString(component.defaultTrackerId);
  const tracker = resolvedTrackerId
    ? component.workTrackers.find((candidate) => candidate.id === resolvedTrackerId)
    : component.workTrackers[0];
  if (!tracker) {
    throw new Error(
      resolvedTrackerId
        ? `Component ${component.id} work tracker is not configured: ${resolvedTrackerId}`
        : `Component ${component.id} has no configured work trackers`,
    );
  }

  return tracker;
}

function claimSelectableComponents(
  options: ClaimNexusEligibleWorkItemOptions,
): ResolvedNexusProjectComponent[] {
  const componentId = optionalNonEmptyString(options.componentId);
  const trackerId = optionalNonEmptyString(options.trackerId);
  const components = componentId
    ? options.components.filter((component) => component.id === componentId)
    : options.components;
  if (componentId && components.length === 0) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  if (!trackerId) {
    return components;
  }

  return components.map((component) => {
    const tracker = component.workTrackers.find(
      (candidate) => candidate.id === trackerId,
    );
    if (!tracker) {
      throw new Error(
        `Component ${component.id} work tracker is not configured: ${trackerId}`,
      );
    }

    return {
      ...component,
      defaultTrackerId: tracker.id,
      workTrackers: [tracker],
      workTracking: tracker.workTracking,
      workTrackingCapabilities: tracker.workTrackingCapabilities,
      workTrackingCapabilityReport: tracker.workTrackingCapabilityReport,
    };
  });
}

function claimProviderFactory(
  options: ClaimNexusEligibleWorkItemOptions,
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): NexusEligibleWorkClaimProviderFactory | undefined {
  if (options.providerFactory) {
    return options.providerFactory;
  }

  return (context) =>
    createWorkTrackerProviderAsync(context.tracker.workTracking, {
      ...providerOptionsWithEnv(
        automationWorkTrackerProviderOptions({
          projectRoot,
          projectConfig: options.projectConfig,
          component: context.component,
          workTrackingProvider: context.tracker.workTracking.provider,
          baseOptions: options.providerOptions,
          env,
          now: options.now,
        }),
        env,
      ),
      projectRoot,
      now: options.now,
    });
}

function providerOptionsWithEnv(
  providerOptions: CreateWorkTrackerProviderOptions | undefined,
  env: NodeJS.ProcessEnv,
): CreateWorkTrackerProviderOptions | undefined {
  return {
    ...providerOptions,
    github: {
      ...providerOptions?.github,
      env: providerOptions?.github?.env ?? env,
    },
    gitlab: {
      ...providerOptions?.gitlab,
      env: providerOptions?.gitlab?.env ?? env,
    },
    jira: {
      ...providerOptions?.jira,
      env: providerOptions?.jira?.env ?? env,
    },
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
  const base = removeClaimBlocks(description ?? "").trimEnd();
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
  const claim = latestWorkItemClaim(item);
  return claim && claimIsActive(claim, now) ? claim : null;
}

function latestWorkItemClaim(
  item: Pick<WorkItem, "description">,
): NexusWorkItemClaimOwner | null {
  return workItemClaims(item.description).at(-1) ?? null;
}

function claimIsActive(
  claim: NexusWorkItemClaimOwner,
  now: Date,
): boolean {
  return dateFrom(claim.expiresAt, "claim.expiresAt").getTime() > now.getTime();
}

function workItemClaims(
  description: string | null | undefined,
): NexusWorkItemClaimOwner[] {
  if (!description) {
    return [];
  }
  const claims: NexusWorkItemClaimOwner[] = [];
  for (const block of claimBlocks(description)) {
    const parsed = safeJsonParse(block);
    const claim = normalizeClaimOwner(parsed);
    if (claim) {
      claims.push(claim);
    }
  }

  return claims;
}

function removeClaimBlocks(description: string): string {
  const blocks = claimBlockRanges(description);
  if (blocks.length === 0) {
    return description;
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    parts.push(description.slice(cursor, block.start));
    cursor = block.end;
  }
  parts.push(description.slice(cursor));
  return parts.join("");
}

function claimBlocks(description: string): string[] {
  return claimBlockRanges(description).map((block) => block.body);
}

function claimBlockRanges(
  description: string,
): Array<{ start: number; end: number; body: string }> {
  const blocks: Array<{ start: number; end: number; body: string }> = [];
  let searchFrom = 0;
  while (searchFrom < description.length) {
    const opening = description.indexOf("<!--", searchFrom);
    if (opening < 0) {
      break;
    }

    const markerStart = skipWhitespace(description, opening + "<!--".length);
    if (!description.startsWith(claimMarkerName, markerStart)) {
      searchFrom = opening + "<!--".length;
      continue;
    }

    const bodyStart = lineStartAfterWhitespace(
      description,
      markerStart + claimMarkerName.length,
    );
    if (bodyStart === null) {
      searchFrom = markerStart + claimMarkerName.length;
      continue;
    }

    const closing = description.indexOf("\n-->", bodyStart);
    if (closing < 0) {
      break;
    }

    blocks.push({
      start: opening,
      end: closing + "\n-->".length,
      body: description.slice(bodyStart, closing),
    });
    searchFrom = closing + "\n-->".length;
  }

  return blocks;
}

function lineStartAfterWhitespace(value: string, start: number): number | null {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\n") {
      return index + 1;
    }
    if (value[index]!.trim().length !== 0) {
      return null;
    }
  }

  return null;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && value[index]!.trim().length === 0) {
    index += 1;
  }

  return index;
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

function reclaimComment(
  owner: NexusWorkItemClaimOwner,
  previousOwner: NexusWorkItemClaimOwner,
): string {
  return [
    "DevNexus optimistic claim reclaimed from expired owner.",
    "",
    `- host: ${owner.hostId}`,
    ...(owner.agentId ? [`- agent: ${owner.agentId}`] : []),
    ...(owner.ownerId ? [`- owner: ${owner.ownerId}`] : []),
    `- lease token: ${owner.leaseToken}`,
    `- expires: ${owner.expiresAt}`,
    `- previous host: ${previousOwner.hostId}`,
    ...(previousOwner.agentId
      ? [`- previous agent: ${previousOwner.agentId}`]
      : []),
    `- previous lease token: ${previousOwner.leaseToken}`,
    `- previous expiry: ${previousOwner.expiresAt}`,
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
