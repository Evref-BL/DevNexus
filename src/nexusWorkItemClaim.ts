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
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusClaimAuthorityProfileConfig,
} from "./nexusHomeConfig.js";
import {
  createNexusNodePostgresClaimSqlClient,
  type NexusNodePostgresModule,
} from "./nexusNodePostgresClaimSqlClient.js";
import {
  NexusPostgresWorkItemClaimAuthority,
} from "./nexusPostgresWorkItemClaimAuthority.js";
import {
  resolveNexusProjectPath,
} from "./nexusPathResolver.js";
import {
  nexusWorkItemDiscoveryCredentialEnvironment,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  automationWorkItemDiscoveryCredentialResolver,
  automationWorkTrackerProviderOptions,
  loadNexusAutomationAuthProfiles,
} from "./nexusAutomationWorkTrackingCredentials.js";
import type {
  WorkItem,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";
import type {
  NexusWorkItemClaimAuthority,
  NexusWorkItemClaimObservation,
  NexusWorkItemClaimOwner,
  NexusWorkItemClaimOwnerInput,
  NexusWorkItemClaimResult,
  NexusWorkItemClaimSkipReason,
  NexusWorkItemClaimSkippedCandidate,
  NexusWorkItemStaleClaimPolicy,
} from "./nexusWorkItemClaimAuthority.js";
export {
  NexusMemoryWorkItemClaimAuthority,
  nexusWorkItemClaimAuthorityKey,
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

const defaultLeaseDurationMs = 60 * 60 * 1000;
const claimMarkerName = "dev-nexus-work-item-claim";
const claimBlockPattern =
  /<!--\s*dev-nexus-work-item-claim\s*\n([\s\S]*?)\n-->/g;

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
  const activeClaims: NexusWorkItemClaimObservation[] = [];
  if (eligibleWork.eligibleWorkItems.length === 0) {
    const inspectedClaims = await inspectExistingWorkItemClaims({
      options,
      projectRoot,
      components,
      env,
      selectorQuery,
      now,
    });
    const reclaimed = await maybeReclaimStaleClaim({
      options,
      projectRoot,
      env,
      inspection: inspectedClaims,
      now,
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

  const skippedCandidates: NexusWorkItemClaimSkippedCandidate[] = [];
  for (const candidate of eligibleWork.eligibleWorkItems) {
    const resolved = await resolveCandidateTracker(
      options,
      projectRoot,
      components,
      candidate,
      env,
    );
    if (!resolved) {
      skippedCandidates.push(skippedCandidate(candidate, "missing_tracker", null));
      continue;
    }

    const { provider, tracker } = resolved;
    assertWorkTrackerCapability(provider, "get", "verify claim candidates");
    const ref = workItemRefForCandidate(candidate);
    const fresh = await provider.getWorkItem(ref);
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
      activeClaims.push(
        claimObservation(candidate, tracker, fresh, activeClaim),
      );
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
    const claimAttempt = await claimAuthority.claimCandidate({
      projectId: options.projectConfig.id,
      candidate,
      tracker,
      provider,
      ref,
      freshWorkItem: fresh,
      owner,
      now,
    });
    if (claimAttempt.status === "lost_race") {
      return {
        status: "lost_race",
        reason: "verification_failed",
        candidate: fresh,
        observedWorkItem: claimAttempt.observedWorkItem,
        componentId: candidate.componentId,
        trackerId: tracker.id,
        owner,
        ...(claimAttempt.authorityClaim
          ? { authorityClaim: claimAttempt.authorityClaim }
          : {}),
        skippedCandidates,
        ...claimDiagnosticsFields({ activeClaims, staleClaims: [] }),
      };
    }

    return {
      status: "claimed",
      workItem: claimAttempt.workItem,
      componentId: candidate.componentId,
      trackerId: tracker.id,
      owner,
      ...(claimAttempt.authorityClaim
        ? { authorityClaim: claimAttempt.authorityClaim }
        : {}),
      skippedCandidates,
      ...claimDiagnosticsFields({ activeClaims, staleClaims: [] }),
    };
  }

  const inspectedClaims = await inspectExistingWorkItemClaims({
    options,
    projectRoot,
    components,
    env,
    selectorQuery,
    now,
  });
  const combinedActiveClaims = [
    ...activeClaims,
    ...inspectedClaims.activeClaims.map((item) => item.observation),
  ];
  const reclaimed = await maybeReclaimStaleClaim({
    options,
    projectRoot,
    env,
    inspection: inspectedClaims,
    now,
    skippedCandidates,
    activeClaims: combinedActiveClaims,
  });
  if (reclaimed) {
    return reclaimed;
  }

  return noClaimResult("candidates_not_claimable", skippedCandidates, {
    activeClaims: combinedActiveClaims,
    staleClaims: inspectedClaims.staleClaims.map((item) => item.observation),
  });
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

  return {
    status: "claimed",
    workItem: reclaimAttempt.workItem,
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
