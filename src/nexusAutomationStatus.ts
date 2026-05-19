import fs from "node:fs";
import path from "node:path";
import {
  buildNexusAutomationWorkItemQuery,
  evaluateNexusAutomationLedgerBackoff,
  nexusAutomationLockPath,
  readNexusAutomationRunLedger,
  selectNexusAutomationWorkItem,
  type NexusAutomationBackoffDecision,
  type NexusAutomationRunLedger,
} from "./nexusAutomation.js";
import type {
  NexusAutomationConfig,
  NexusAutomationPublicationConfig,
} from "./nexusAutomationConfig.js";
import {
  preflightNexusAutomationAgentLaunch,
  type NexusAutomationAgentLaunchComponentProvider,
  type NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationAgentLaunch.js";
import {
  normalizeNexusAutomationAgentPolicy,
  type NexusAutomationAgentPolicy,
} from "./nexusAutomationAgentProfile.js";
import {
  listNexusEligibleWorkByComponent,
  type NexusEligibleWorkItem,
  type NexusEligibleWorkMode,
  type NexusEligibleWorkProviderFactory,
} from "./nexusEligibleWork.js";
import type {
  NexusWorkItemDiscoveryCredentialResolver,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  resolveNexusCurrentAutomationActor,
  summarizeNexusAuthorityForProject,
  type NexusAuthorityProjectSummary,
  type NexusCurrentActorResolution,
} from "./nexusAuthority.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import {
  buildNexusRunnerProfileStatuses,
  type NexusRunnerProfileStatus,
} from "./nexusRunnerProfile.js";
import {
  readNexusAutomationTargetContext,
  type NexusAutomationTargetContext,
} from "./nexusAutomationTarget.js";
import {
  summarizeNexusAutomationTargetCycles,
  type NexusAutomationTargetCycleSummary,
} from "./nexusAutomationTargetCycle.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  preflightNexusAutomationRunOnce,
  type NexusAutomationPreflightCheck,
  type NexusAutomationProviderContext,
  type NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import {
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import type { GitRunner } from "./gitWorktreeService.js";
import {
  getNexusPublicationStatuses,
  publicationPreflightChecks,
  resolveNexusPublicationPolicy,
  type NexusPublicationActorRunner,
  type NexusPublicationStatus,
} from "./nexusPublicationPolicy.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";
import type {
  WorkItem,
  WorkItemQuery,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export type NexusAutomationStatusKind =
  | "disabled"
  | "locked"
  | "backoff"
  | "blocked"
  | "idle"
  | "ready";

export type NexusAutomationLockStatusKind =
  | "none"
  | "active"
  | "stale"
  | "invalid";

export interface NexusAutomationStatusLock {
  path: string;
  status: NexusAutomationLockStatusKind;
  runId: string | null;
  owner: string | null;
  acquiredAt: string | null;
  expiresAt: string | null;
  message: string;
}

export interface GetNexusAutomationStatusOptions {
  projectRoot: string;
  homePath?: string;
  eligibleWorkMode?: NexusEligibleWorkMode;
  env?: NodeJS.ProcessEnv;
  credentialResolver?: NexusWorkItemDiscoveryCredentialResolver;
  authProfiles?: NexusHostingAuthProfileConfig[];
  provider?: WorkTrackerProvider;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  publicationActorRunner?: NexusPublicationActorRunner;
  now?: () => Date | string;
}

export interface NexusAutomationStatus {
  projectRoot: string;
  sourceRoot: string | null;
  components: ResolvedNexusProjectComponent[];
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig | null;
  status: NexusAutomationStatusKind;
  summary: string;
  lock: NexusAutomationStatusLock | null;
  ledger: NexusAutomationRunLedger | null;
  backoff: NexusAutomationBackoffDecision | null;
  preflight: NexusAutomationPreflightCheck[];
  target: NexusAutomationTargetContext | null;
  targetCycles: NexusAutomationTargetCycleSummary | null;
  agent: NexusAutomationAgentPolicy | null;
  runnerProfiles: NexusRunnerProfileStatus[];
  publication: NexusPublicationStatus[];
  currentActors: NexusCurrentActorResolution[];
  authority: NexusAuthorityProjectSummary;
  selectorQuery: WorkItemQuery | null;
  candidateCount: number | null;
  eligibleWorkMode: NexusEligibleWorkMode;
  eligibleWorkItems: NexusEligibleWorkItem[] | null;
  importCandidateWorkItems: NexusEligibleWorkItem[] | null;
  eligibleWorkWarnings: string[];
  eligibleWorkBlockers: string[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[] | null;
  selectedWorkItem: WorkItem | null;
}

export class NexusAutomationStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationStatusError";
  }
}

export async function getNexusAutomationStatus(
  options: GetNexusAutomationStatusOptions,
): Promise<NexusAutomationStatus> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const primaryComponent = resolvePrimaryProjectComponent(projectRoot, projectConfig);
  const sourceRoot = primaryComponent.sourceRoot;
  if (!automationConfig?.enabled) {
    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status: "disabled",
      summary: "Automation is not enabled for this project",
      lock: null,
      ledger: null,
      backoff: null,
      preflight: [],
      selectorQuery: null,
      candidateCount: null,
      eligibleWorkItems: null,
      selectedWorkItem: null,
    });
  }

  const now = currentIso(options.now);
  const ledger = readNexusAutomationRunLedger(projectRoot, automationConfig);
  const lock = readNexusAutomationStatusLock(projectRoot, automationConfig, now);
  if (lock.status === "active") {
    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status: "locked",
      summary: lock.message,
      lock,
      ledger,
      backoff: null,
      preflight: [],
      selectorQuery: null,
      candidateCount: null,
      eligibleWorkItems: null,
      selectedWorkItem: null,
    });
  }
  if (lock.status === "invalid") {
    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status: "blocked",
      summary: lock.message,
      lock,
      ledger,
      backoff: null,
      preflight: [],
      selectorQuery: null,
      candidateCount: null,
      eligibleWorkItems: null,
      selectedWorkItem: null,
    });
  }

  const backoff = evaluateNexusAutomationLedgerBackoff(
    automationConfig,
    ledger,
    now,
  );
  if (!backoff.shouldRun) {
    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status: "backoff",
      summary: backoff.reason ?? "Automation retry backoff is active",
      lock,
      ledger,
      backoff,
      preflight: [],
      selectorQuery: null,
      candidateCount: null,
      eligibleWorkItems: null,
      selectedWorkItem: null,
    });
  }

  if (automationConfig.mode === "agent_launch") {
    const componentProviders = createStatusComponentProviders({
      options,
      projectRoot,
      projectConfig,
      components,
    });
    if (componentProviders.length === 0) {
      const summary = "No project component has work tracking configured";
      return statusResult({
        projectRoot,
        sourceRoot,
        components,
        projectConfig,
        automationConfig,
        status: "blocked",
        summary,
        lock,
        ledger,
        backoff,
        preflight: [
          {
            name: "workTracking",
            status: "failed",
            message: summary,
          },
        ],
        selectorQuery: null,
        candidateCount: null,
        eligibleWorkItems: null,
        selectedWorkItem: null,
      });
    }
    const publication = getNexusPublicationStatuses({
      projectRoot,
      projectConfig,
      components,
      action: "status",
      authProfiles: options.authProfiles,
      homePath: options.homePath,
      gitRunner: options.gitRunner,
      actorRunner: options.publicationActorRunner,
    });
    const currentActors = currentAutomationActors({
      projectRoot,
      projectConfig,
      components,
      publication,
      options,
    });
    const preflight = [
      ...preflightNexusAutomationAgentLaunch({
        components,
        componentProviders,
        automationConfig,
      }),
      ...publicationPreflightChecks(publication),
    ];
    const failedChecks = preflight.filter((check) => check.status === "failed");
    if (failedChecks.length > 0) {
      return statusResult({
        projectRoot,
        sourceRoot,
        components,
        projectConfig,
        automationConfig,
        status: "blocked",
        summary: failedChecks.map((check) => check.message).join("; "),
        lock,
        ledger,
        backoff,
        preflight,
        selectorQuery: null,
        candidateCount: null,
        eligibleWorkItems: null,
        selectedWorkItem: null,
        publication,
        currentActors,
      });
    }

    const selectorQuery = buildNexusAutomationWorkItemQuery(automationConfig);
    const eligibleWork = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig,
      components,
      automationConfig,
      selectorQuery,
      mode: options.eligibleWorkMode ?? "default",
      provider: options.provider,
      providerFactory: statusEligibleWorkProviderFactory({
        options,
        projectRoot,
        projectConfig,
      }),
      providerOptions: options.providerOptions,
      credentialResolver: options.credentialResolver,
      env: options.env,
      now: options.now,
    });
    const componentEligibleWorkItems = eligibleWork.componentEligibleWorkItems;
    const eligibleWorkItems = eligibleWork.eligibleWorkItems;
    if (eligibleWork.blockers.length > 0) {
      const summary = eligibleWork.blockers.join("; ");
      return statusResult({
        projectRoot,
        sourceRoot,
        components,
        projectConfig,
        automationConfig,
        status: "blocked",
        summary,
        lock,
        ledger,
        backoff,
        preflight: [
          ...preflight,
          {
            name: "eligibleWorkDiscovery",
            status: "failed",
            message: summary,
          },
        ],
        selectorQuery,
        candidateCount: eligibleWorkItems.length,
        eligibleWorkMode: eligibleWork.mode,
        eligibleWorkItems,
        importCandidateWorkItems: eligibleWork.importCandidateWorkItems,
        eligibleWorkWarnings: eligibleWork.warnings,
        eligibleWorkBlockers: eligibleWork.blockers,
        componentEligibleWorkItems,
        selectedWorkItem: null,
        publication,
        currentActors,
      });
    }
    const status: NexusAutomationStatusKind =
      eligibleWorkItems.length > 0 ? "ready" : "idle";
    const summary =
      eligibleWorkItems.length > 0
        ? `Agent launch ready with ${eligibleWorkItems.length} eligible work item(s)`
        : "No eligible work item matched the automation selector";

    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status,
      summary,
      lock,
      ledger,
      backoff,
      preflight,
      selectorQuery,
      candidateCount: eligibleWorkItems.length,
      eligibleWorkMode: eligibleWork.mode,
      eligibleWorkItems,
      importCandidateWorkItems: eligibleWork.importCandidateWorkItems,
      eligibleWorkWarnings: eligibleWork.warnings,
      eligibleWorkBlockers: eligibleWork.blockers,
      componentEligibleWorkItems,
      selectedWorkItem: null,
      publication,
      currentActors,
    });
  }

  if (!primaryComponent.workTracking) {
    const summary = "Primary component work tracking is not configured";
    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status: "blocked",
      summary,
      lock,
      ledger,
      backoff,
      preflight: [
        {
          name: "workTracking",
          status: "failed",
          message: summary,
        },
      ],
      selectorQuery: null,
      candidateCount: null,
      eligibleWorkItems: null,
      selectedWorkItem: null,
    });
  }

  const provider = createStatusProvider({
    options,
    projectRoot,
    sourceRoot,
    projectConfig,
    component: primaryComponent,
  });

  const publication = getNexusPublicationStatuses({
    projectRoot,
    projectConfig,
    components,
    action: "status",
    authProfiles: options.authProfiles,
    homePath: options.homePath,
    gitRunner: options.gitRunner,
    actorRunner: options.publicationActorRunner,
  });
  const currentActors = currentAutomationActors({
    projectRoot,
    projectConfig,
    components,
    publication,
    options,
  });
  const preflight = preflightNexusAutomationRunOnce({
    projectRoot,
    sourceRoot,
    projectConfig,
    component: primaryComponent,
    automationConfig,
    provider,
    gitRunner: options.gitRunner,
    publicationActorRunner: options.publicationActorRunner,
  });
  const failedChecks = preflight.filter((check) => check.status === "failed");
  if (failedChecks.length > 0) {
    return statusResult({
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      status: "blocked",
      summary: failedChecks.map((check) => check.message).join("; "),
      lock,
      ledger,
      backoff,
      preflight,
      selectorQuery: null,
      candidateCount: null,
      eligibleWorkItems: null,
      selectedWorkItem: null,
      publication,
      currentActors,
    });
  }

  const selectorQuery = buildNexusAutomationWorkItemQuery(automationConfig);
  const candidates = await provider.listWorkItems({
    ...selectorQuery,
    projectRoot,
  });
  const selectedWorkItem =
    selectNexusAutomationWorkItem(candidates, automationConfig) ?? null;
  const status: NexusAutomationStatusKind = selectedWorkItem ? "ready" : "idle";
  const summary = selectedWorkItem
    ? `Selected work item ${selectedWorkItem.id}: ${selectedWorkItem.title}`
    : "No eligible work item matched the automation selector";

  return statusResult({
    projectRoot,
    sourceRoot,
    components,
    projectConfig,
    automationConfig,
    status,
    summary,
    lock,
    ledger,
    backoff,
    preflight,
    selectorQuery,
    candidateCount: candidates.length,
    eligibleWorkItems: null,
    selectedWorkItem,
    publication,
    currentActors,
  });
}

export function readNexusAutomationStatusLock(
  projectRoot: string,
  config: NexusAutomationConfig,
  now: Date | string = new Date(),
): NexusAutomationStatusLock {
  const lockPath = nexusAutomationLockPath(projectRoot, config);
  if (!fs.existsSync(lockPath)) {
    return {
      path: lockPath,
      status: "none",
      runId: null,
      owner: null,
      acquiredAt: null,
      expiresAt: null,
      message: "No automation run lock is present",
    };
  }

  try {
    const record = JSON.parse(fs.readFileSync(lockPath, "utf8").replace(/^\uFEFF/, ""));
    const runId = requiredLockString(record.runId, "automation lock.runId");
    const acquiredAt = requiredLockIsoString(
      record.acquiredAt,
      "automation lock.acquiredAt",
    );
    const expiresAt = requiredLockIsoString(
      record.expiresAt,
      "automation lock.expiresAt",
    );
    const owner = optionalLockString(record.owner);
    const expiresAtDate = dateFrom(expiresAt, "automation lock.expiresAt");
    const status: NexusAutomationLockStatusKind =
      expiresAtDate.getTime() > dateFrom(now, "now").getTime()
        ? "active"
        : "stale";
    const message =
      status === "active"
        ? `Automation run lock is held by ${runId} until ${expiresAt}`
        : `Automation run lock is stale and can be replaced: ${runId}`;

    return {
      path: lockPath,
      status,
      runId,
      owner,
      acquiredAt,
      expiresAt,
      message,
    };
  } catch (error) {
    return {
      path: lockPath,
      status: "invalid",
      runId: null,
      owner: null,
      acquiredAt: null,
      expiresAt: null,
      message: `Automation run lock is invalid: ${errorMessage(error)}`,
    };
  }
}

function createStatusProvider(options: {
  options: GetNexusAutomationStatusOptions;
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): WorkTrackerProvider {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationStatusError(
      "Primary component work tracking is not configured",
    );
  }
  if (options.options.provider) {
    return options.options.provider;
  }
  if (options.options.providerFactory) {
    return options.options.providerFactory({
      projectRoot: options.projectRoot,
      sourceRoot: options.sourceRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      workTracking,
    } satisfies NexusAutomationProviderContext);
  }

  return createWorkTrackerProvider(workTracking, {
    ...options.options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

function createStatusComponentProviders(options: {
  options: GetNexusAutomationStatusOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
}): NexusAutomationAgentLaunchComponentProvider[] {
  return options.components
    .filter((component) => component.workTracking)
    .map((component) => ({
      component,
      provider: createStatusComponentProvider({
        options: options.options,
        projectRoot: options.projectRoot,
        projectConfig: options.projectConfig,
        component,
      }),
    }));
}

function createStatusComponentProvider(options: {
  options: GetNexusAutomationStatusOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): WorkTrackerProvider {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationStatusError(
      `Component ${options.component.id} work tracking is not configured`,
    );
  }
  if (options.options.provider) {
    return options.options.provider;
  }
  if (options.options.providerFactory) {
    return options.options.providerFactory({
      projectRoot: options.projectRoot,
      sourceRoot: options.component.sourceRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      workTracking,
    } satisfies NexusAutomationProviderContext);
  }

  return createWorkTrackerProvider(workTracking, {
    ...options.options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

type AutomationStatusInput = Omit<
  NexusAutomationStatus,
  | "agent"
  | "componentEligibleWorkItems"
  | "components"
  | "currentActors"
  | "eligibleWorkBlockers"
  | "eligibleWorkMode"
  | "eligibleWorkWarnings"
  | "importCandidateWorkItems"
  | "publication"
  | "runnerProfiles"
  | "target"
  | "targetCycles"
  | "authority"
> &
  Partial<
    Pick<
      NexusAutomationStatus,
      | "agent"
      | "componentEligibleWorkItems"
      | "components"
      | "currentActors"
      | "eligibleWorkBlockers"
      | "eligibleWorkMode"
      | "eligibleWorkWarnings"
      | "importCandidateWorkItems"
      | "publication"
      | "runnerProfiles"
      | "target"
      | "targetCycles"
      | "authority"
    >
  >;

function statusResult(result: AutomationStatusInput): NexusAutomationStatus {
  const target =
    result.target ??
    (result.automationConfig
      ? readNexusAutomationTargetContext({
          projectRoot: result.projectRoot,
          config: result.automationConfig,
        })
      : null);
  const agent =
    result.agent ??
    (result.automationConfig
      ? normalizeNexusAutomationAgentPolicy(result.automationConfig)
      : null);
  const targetCycles =
    result.targetCycles ??
    (result.automationConfig
      ? summarizeNexusAutomationTargetCycles({
          projectRoot: result.projectRoot,
          config: result.automationConfig,
        })
      : null);

  const components = result.components ?? [];
  const currentActors = result.currentActors ?? [];
  const authority =
    result.authority ??
    summarizeNexusAuthorityForProject({
      projectId: result.projectConfig.id,
      authority: result.projectConfig.authority,
      components: components.map((component) => ({
        projectId: result.projectConfig.id,
        componentId: component.id,
        componentName: component.name,
        authority: result.projectConfig.authority,
        publication: resolveNexusPublicationPolicy(
          result.projectConfig,
          component,
        ),
        safety: result.automationConfig?.safety ?? null,
        currentActor:
          currentActors.find((actor) => actor.componentId === component.id) ??
          null,
        tracker: component.defaultTrackerId,
        repository: component.remoteUrl,
      })),
    });

  return {
    ...result,
    target,
    targetCycles,
    agent,
    runnerProfiles:
      result.runnerProfiles ??
      buildNexusRunnerProfileStatuses(
        result.projectConfig.runnerProfiles,
        result.projectConfig.hosts,
    ),
    publication: result.publication ?? [],
    currentActors,
    authority,
    components,
    componentEligibleWorkItems: result.componentEligibleWorkItems ?? null,
    eligibleWorkMode: result.eligibleWorkMode ?? "default",
    importCandidateWorkItems: result.importCandidateWorkItems ?? null,
    eligibleWorkWarnings: result.eligibleWorkWarnings ?? [],
    eligibleWorkBlockers: result.eligibleWorkBlockers ?? [],
  };
}

function statusEligibleWorkProviderFactory(options: {
  options: GetNexusAutomationStatusOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
}): NexusEligibleWorkProviderFactory | undefined {
  if (!options.options.providerFactory) {
    return undefined;
  }

  return (context) =>
    options.options.providerFactory!({
      projectRoot: options.projectRoot,
      sourceRoot: context.component.sourceRoot,
      projectConfig: options.projectConfig,
      component: context.component,
      workTracking: context.tracker.workTracking,
    });
}

function currentAutomationActors(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  publication: NexusPublicationStatus[];
  options: GetNexusAutomationStatusOptions;
}): NexusCurrentActorResolution[] {
  const authProfiles = automationStatusAuthProfiles({
    projectRoot: options.projectRoot,
    projectConfig: options.projectConfig,
    statusOptions: options.options,
  });
  const publicationByComponent = new Map(
    options.publication.map((publication) => [
      publication.componentId,
      publication,
    ]),
  );

  return options.components.map((component) =>
    resolveNexusCurrentAutomationActor({
      authority: options.projectConfig.authority,
      componentId: component.id,
      publication:
        publicationByComponent.get(component.id)?.policy ??
        localOnlyPublicationPolicy(),
      authProfiles,
    })
  );
}

function automationStatusAuthProfiles(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  statusOptions: GetNexusAutomationStatusOptions;
}): NexusHostingAuthProfileConfig[] {
  if (options.statusOptions.authProfiles) {
    return options.statusOptions.authProfiles;
  }

  const homePath = options.statusOptions.homePath
    ? path.resolve(options.statusOptions.homePath)
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
    ).authProfiles ?? [];
  } catch {
    return [];
  }
}

function localOnlyPublicationPolicy(): NexusAutomationPublicationConfig {
  return {
    strategy: "local_only",
    remote: null,
    targetBranch: null,
    push: false,
    remoteUrl: null,
    pushUrl: null,
    sshHostAlias: null,
    packagePublish: false,
    releasePublish: false,
    actor: null,
    manualRemote: null,
    manualActor: null,
    commandEnvironment: {},
  };
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  return dateFrom(value, "now").toISOString();
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationStatusError(`${name} must be a valid date`);
  }

  return date;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationStatusError(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function requiredLockString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationStatusError(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function requiredLockIsoString(value: unknown, name: string): string {
  const stringValue = requiredLockString(value, name);
  dateFrom(stringValue, name);

  return stringValue;
}

function optionalLockString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requiredLockString(value, "automation lock.owner");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
