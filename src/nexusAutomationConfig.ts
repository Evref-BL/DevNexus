import type { WorkStatus } from "./workTrackingTypes.js";
import {
  validateNexusCiTierPolicyConfig,
  type NexusCiTierPolicyConfig,
} from "./nexusCiTierPolicy.js";

export type NexusAutomationMode = "run_once" | "agent_launch";
export type NexusAutomationEligibleWorkMode = "default" | "discovery";
export type NexusAutomationWorkItemClaimStalePolicy = "report" | "reclaim";
export type NexusAutomationWorkItemClaimAuthorityBackend =
  | "optimistic_tracker"
  | "postgres";
export type NexusAutomationSafetyProfile =
  | "local"
  | "isolated"
  | "host-authorized";
export type NexusAutomationPublicationStrategy =
  | "local_only"
  | "green_main"
  | "direct_integration"
  | "review_handoff";
export type NexusAutomationGreenMainIntegrationPreference =
  | "branch"
  | "pull_request";
export type NexusAutomationGreenMainDirectTargetPushPolicy =
  | "blocked"
  | "exceptional"
  | "allowed";
export type NexusAutomationGreenMainStaleCheckPolicy = "block" | "allow";
export type NexusAutomationGreenMainMergeAuthorityPolicy =
  | "handoff"
  | "authorized_merge";
export type NexusPublicationActorKind =
  | "human"
  | "machine_user"
  | "app"
  | "service_account";
export type NexusAutomationAgentProfileIntendedUse =
  | "any"
  | "coordinator"
  | "subagent";
export type NexusAutomationAgentProfileExecutorMode = "exec" | "app_server";
export type NexusAutomationCodexAppServerMode = "connect" | "spawn";
export type NexusAutomationCodexAppServerSafetyHint =
  | "connects_to_local_service"
  | "requires_local_codex_account"
  | "spawns_local_process"
  | "uses_host_local_endpoint";

export interface NexusAutomationSelectorConfig {
  statuses: WorkStatus[];
  labels: string[];
  excludeLabels: string[];
  assignees: string[];
  search: string | null;
  limit: number;
}

export interface NexusAutomationVerificationConfig {
  focusedCommands: string[];
  fullCommands: string[];
  requirePassing: boolean;
  ciTiers?: NexusCiTierPolicyConfig | null;
}

export interface NexusAutomationLedgerConfig {
  path: string;
  retention: number;
}

export interface NexusAutomationLockConfig {
  path: string;
  staleAfterMs: number;
}

export interface NexusAutomationPostgresWorkItemClaimAuthorityConfig {
  connectionProfileId: string | null;
}

export interface NexusAutomationWorkItemClaimAuthorityConfig {
  backend: NexusAutomationWorkItemClaimAuthorityBackend;
  postgres: NexusAutomationPostgresWorkItemClaimAuthorityConfig;
}

export interface NexusAutomationWorkItemClaimConfig {
  enabled: boolean;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  staleClaimPolicy: NexusAutomationWorkItemClaimStalePolicy;
  authority: NexusAutomationWorkItemClaimAuthorityConfig;
}

type PartialNexusAutomationWorkItemClaimAuthorityConfig = Partial<
  Omit<NexusAutomationWorkItemClaimAuthorityConfig, "postgres">
> & {
  postgres?: Partial<NexusAutomationPostgresWorkItemClaimAuthorityConfig>;
};

type PartialNexusAutomationWorkItemClaimConfig = Partial<
  Omit<NexusAutomationWorkItemClaimConfig, "authority">
> & {
  authority?: PartialNexusAutomationWorkItemClaimAuthorityConfig;
};

export interface NexusAutomationBackoffConfig {
  failureLimit: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface NexusAutomationScheduleConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface NexusAutomationDependencyLinkConfig {
  source: string;
  target: string;
  required: boolean;
}

export interface NexusAutomationSetupConfig {
  dependencyLinks: NexusAutomationDependencyLinkConfig[];
}

export interface NexusAutomationExecutorConfig {
  command: string | null;
  timeoutMs: number | null;
  runFullVerification: boolean;
}

export interface NexusAutomationAgentRelaunchConfig {
  whileEligible: boolean;
}

export interface NexusAutomationAgentProfileConfig {
  id: string;
  executor: string;
  executorMode?: NexusAutomationAgentProfileExecutorMode;
  model: string | null;
  version?: string | null;
  variant?: string | null;
  reasoning: string | null;
  intelligence?: string | null;
  intendedUse?: NexusAutomationAgentProfileIntendedUse;
  safety?: NexusAutomationSafetyConfig | null;
  command: string | null;
  args: string[];
  appServer?: NexusAutomationCodexAppServerConfig;
}

export interface NexusAutomationCodexAppServerLocalPolicy {
  allowNonLoopbackEndpoint: boolean;
  hostLocalSafetyHints: NexusAutomationCodexAppServerSafetyHint[];
}

export interface NexusAutomationCodexAppServerConfig {
  mode: NexusAutomationCodexAppServerMode;
  command: string | null;
  args: string[];
  endpoint: string;
  ephemeralThreadDefault: boolean;
  localPolicy: NexusAutomationCodexAppServerLocalPolicy;
}

export interface NexusAutomationAgentConfig {
  command: string | null;
  timeoutMs: number | null;
  coordinatorProfileId: string | null;
  maxConcurrentSubagents: number;
  profiles: NexusAutomationAgentProfileConfig[];
  relaunch: NexusAutomationAgentRelaunchConfig;
}

export interface NexusAutomationTargetConfig {
  id: string | null;
  objective: string | null;
  statePath: string;
  cycleLedgerPath: string;
  stopWhenNoEligibleWork: boolean;
  maxCycles: number | null;
  maxWorkItems: number | null;
}

export interface NexusAutomationSafetyConfig {
  profile: NexusAutomationSafetyProfile;
  allowHostMutation: boolean;
  allowDependencyInstall: boolean;
  allowLiveServices: boolean;
}

export interface NexusPublicationActorConfig {
  kind: NexusPublicationActorKind;
  provider: string | null;
  handle: string | null;
  id: string | null;
}

export interface NexusPublicationGitIdentityConfig {
  name: string | null;
  email: string | null;
}

export interface NexusAutomationGreenMainConfig {
  integrationPreference: NexusAutomationGreenMainIntegrationPreference;
  integrationBranch: string | null;
  directTargetPush: NexusAutomationGreenMainDirectTargetPushPolicy;
  mergeAuthority: NexusAutomationGreenMainMergeAuthorityPolicy;
  requiredChecks: string[];
  staleChecks: NexusAutomationGreenMainStaleCheckPolicy;
}

export interface NexusAutomationPublicationTrainBranchNamingConfig {
  integrationPrefix: string;
  candidatePrefix: string;
  unscopedName: string;
}

export interface NexusAutomationPublicationTrainSelectorConfig {
  statuses: WorkStatus[];
  labels: string[];
  milestones: string[];
  assignees: string[];
  providerQuery: string | null;
}

export interface NexusAutomationPublicationTrainConfig {
  enabled: boolean;
  activeVersionId: string | null;
  branchNaming: NexusAutomationPublicationTrainBranchNamingConfig;
  ciTiers?: NexusCiTierPolicyConfig | null;
  selector: NexusAutomationPublicationTrainSelectorConfig;
}

export interface NexusAutomationPublicationConfig {
  strategy: NexusAutomationPublicationStrategy;
  remote: string | null;
  targetBranch: string | null;
  push: boolean;
  remoteUrl: string | null;
  pushUrl: string | null;
  sshHostAlias: string | null;
  packagePublish: boolean;
  releasePublish: boolean;
  actor: NexusPublicationActorConfig | null;
  gitIdentity: NexusPublicationGitIdentityConfig | null;
  manualRemote: string | null;
  manualActor: NexusPublicationActorConfig | null;
  commandEnvironment: Record<string, string>;
  greenMain?: NexusAutomationGreenMainConfig | null;
  publicationTrain?: NexusAutomationPublicationTrainConfig | null;
}

export interface NexusAutomationPublicationPolicySummary {
  mode: NexusAutomationPublicationStrategy;
  targetBranch: string | null;
  integrationPreference:
    | NexusAutomationGreenMainIntegrationPreference
    | "direct_push"
    | "local_only";
  integrationBranch: string | null;
  directTargetPush: NexusAutomationGreenMainDirectTargetPushPolicy;
  mergeAuthority: NexusAutomationGreenMainMergeAuthorityPolicy | null;
  requiredChecks: string[];
  staleChecks: NexusAutomationGreenMainStaleCheckPolicy | null;
  summary: string;
}

export interface NexusAutomationConfig {
  enabled: boolean;
  mode: NexusAutomationMode;
  eligibleWorkMode: NexusAutomationEligibleWorkMode;
  selector: NexusAutomationSelectorConfig;
  verification: NexusAutomationVerificationConfig;
  ledger: NexusAutomationLedgerConfig;
  lock: NexusAutomationLockConfig;
  workItemClaims: NexusAutomationWorkItemClaimConfig;
  backoff: NexusAutomationBackoffConfig;
  schedule: NexusAutomationScheduleConfig;
  setup: NexusAutomationSetupConfig;
  executor: NexusAutomationExecutorConfig;
  agent: NexusAutomationAgentConfig;
  target: NexusAutomationTargetConfig;
  safety: NexusAutomationSafetyConfig;
  publication: NexusAutomationPublicationConfig;
}

export const defaultNexusAutomationConfig: NexusAutomationConfig = {
  enabled: true,
  mode: "run_once",
  eligibleWorkMode: "default",
  selector: {
    statuses: ["ready", "todo"],
    labels: [],
    excludeLabels: [],
    assignees: [],
    search: null,
    limit: 10,
  },
  verification: {
    focusedCommands: [],
    fullCommands: [],
    requirePassing: true,
  },
  ledger: {
    path: ".dev-nexus/automation/runs.json",
    retention: 200,
  },
  lock: {
    path: ".dev-nexus/automation/run.lock",
    staleAfterMs: 60 * 60 * 1000,
  },
  workItemClaims: {
    enabled: true,
    leaseDurationMs: 60 * 60 * 1000,
    heartbeatIntervalMs: 20 * 60 * 1000,
    staleClaimPolicy: "report",
    authority: {
      backend: "optimistic_tracker",
      postgres: {
        connectionProfileId: null,
      },
    },
  },
  backoff: {
    failureLimit: 3,
    baseDelayMs: 5 * 60 * 1000,
    maxDelayMs: 60 * 60 * 1000,
  },
  schedule: {
    enabled: true,
    intervalMs: 15 * 60 * 1000,
  },
  setup: {
    dependencyLinks: [],
  },
  executor: {
    command: null,
    timeoutMs: null,
    runFullVerification: false,
  },
  agent: {
    command: null,
    timeoutMs: null,
    coordinatorProfileId: null,
    maxConcurrentSubagents: 1,
    profiles: [],
    relaunch: {
      whileEligible: false,
    },
  },
  target: {
    id: null,
    objective: null,
    statePath: ".dev-nexus/automation/target-state.md",
    cycleLedgerPath: ".dev-nexus/automation/target-cycles.json",
    stopWhenNoEligibleWork: true,
    maxCycles: null,
    maxWorkItems: null,
  },
  safety: {
    profile: "local",
    allowHostMutation: false,
    allowDependencyInstall: false,
    allowLiveServices: false,
  },
  publication: {
    strategy: "review_handoff",
    remote: "origin",
    targetBranch: null,
    push: false,
    remoteUrl: null,
    pushUrl: null,
    sshHostAlias: null,
    packagePublish: false,
    releasePublish: false,
    actor: null,
    gitIdentity: null,
    manualRemote: null,
    manualActor: null,
    commandEnvironment: {},
  },
};

export const defaultNexusAutomationGreenMainConfig:
  NexusAutomationGreenMainConfig = {
    integrationPreference: "pull_request",
    integrationBranch: null,
    directTargetPush: "blocked",
    mergeAuthority: "handoff",
    requiredChecks: [],
    staleChecks: "block",
  };

export const defaultNexusAutomationPublicationTrainConfig:
  NexusAutomationPublicationTrainConfig = {
    enabled: false,
    activeVersionId: null,
    branchNaming: {
      integrationPrefix: "integration",
      candidatePrefix: "candidate",
      unscopedName: "manual",
    },
    selector: {
      statuses: ["ready"],
      labels: [],
      milestones: [],
      assignees: [],
      providerQuery: null,
    },
  };

export class NexusAutomationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationConfigError";
  }
}

export function validateNexusAutomationConfig(
  value: unknown,
): NexusAutomationConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "workspace config.automation");
  const enabled = optionalBoolean(
    record,
    "enabled",
    "workspace config.automation",
  );
  const mode = validateMode(record.mode, "workspace config.automation.mode");
  const eligibleWorkMode = validateEligibleWorkMode(
    record.eligibleWorkMode,
    "workspace config.automation.eligibleWorkMode",
  );
  const selector = validateSelectorConfig(record.selector);
  const verification = validateVerificationConfig(record.verification);
  const ledger = validateLedgerConfig(record.ledger);
  const lock = validateLockConfig(record.lock);
  const workItemClaims = resolvedWorkItemClaimConfig(
    validateWorkItemClaimConfig(record.workItemClaims),
  );
  const backoff = validateBackoffConfig(record.backoff);
  const schedule = validateScheduleConfig(record.schedule);
  const setup = validateSetupConfig(record.setup);
  const executor = validateExecutorConfig(record.executor);
  const agent = validateAgentConfig(record.agent);
  const target = validateTargetConfig(record.target);
  const safety = validateSafetyConfig(record.safety);
  const publication = validatePartialNexusAutomationPublicationConfig(
    record.publication,
    "workspace config.automation.publication",
  );

  return {
    enabled: enabled ?? defaultNexusAutomationConfig.enabled,
    mode: mode ?? defaultNexusAutomationConfig.mode,
    eligibleWorkMode:
      eligibleWorkMode ?? defaultNexusAutomationConfig.eligibleWorkMode,
    selector: {
      ...defaultNexusAutomationConfig.selector,
      ...selector,
    },
    verification: {
      ...defaultNexusAutomationConfig.verification,
      ...verification,
    },
    ledger: {
      ...defaultNexusAutomationConfig.ledger,
      ...ledger,
    },
    lock: {
      ...defaultNexusAutomationConfig.lock,
      ...lock,
    },
    workItemClaims,
    backoff: {
      ...defaultNexusAutomationConfig.backoff,
      ...backoff,
    },
    schedule: {
      ...defaultNexusAutomationConfig.schedule,
      ...schedule,
    },
    setup: {
      ...defaultNexusAutomationConfig.setup,
      ...setup,
    },
    executor: {
      ...defaultNexusAutomationConfig.executor,
      ...executor,
    },
    agent: {
      ...defaultNexusAutomationConfig.agent,
      ...agent,
      relaunch: {
        ...defaultNexusAutomationConfig.agent.relaunch,
        ...agent.relaunch,
      },
    },
    target: {
      ...defaultNexusAutomationConfig.target,
      ...target,
    },
    safety: {
      ...defaultNexusAutomationConfig.safety,
      ...safety,
    },
    publication: normalizeNexusAutomationPublicationConfig(
      {
        ...defaultNexusAutomationConfig.publication,
        ...publication,
        commandEnvironment: {
          ...defaultNexusAutomationConfig.publication.commandEnvironment,
          ...publication.commandEnvironment,
        },
      },
      "workspace config.automation.publication",
    ),
  };
}

export function normalizeNexusAutomationPublicationConfig(
  value: NexusAutomationPublicationConfig,
  pathName = "workspace config.automation.publication",
): NexusAutomationPublicationConfig {
  const publicationTrain = normalizePublicationTrainConfig(value.publicationTrain);
  if (value.strategy === "green_main") {
    const greenMain = {
      ...defaultNexusAutomationGreenMainConfig,
      ...(value.greenMain ?? {}),
    };
    if (!value.targetBranch) {
      throw new NexusAutomationConfigError(
        `${pathName}.targetBranch is required when strategy is green_main`,
      );
    }
    if (
      greenMain.integrationPreference === "branch" &&
      !greenMain.integrationBranch
    ) {
      throw new NexusAutomationConfigError(
        `${pathName}.greenMain.integrationBranch is required when integrationPreference is branch`,
      );
    }
    if (
      greenMain.integrationBranch &&
      value.targetBranch &&
      greenMain.integrationBranch === value.targetBranch
    ) {
      throw new NexusAutomationConfigError(
        `${pathName}.greenMain.integrationBranch must not be the targetBranch`,
      );
    }
    if (value.push && greenMain.directTargetPush === "blocked") {
      throw new NexusAutomationConfigError(
        `${pathName}.push must be false when greenMain.directTargetPush is blocked`,
      );
    }

    return {
      ...value,
      ...(publicationTrain !== undefined ? { publicationTrain } : {}),
      greenMain: {
        ...greenMain,
        requiredChecks: [...greenMain.requiredChecks],
      },
    };
  }

  if (value.greenMain && Object.keys(value.greenMain).length > 0) {
    throw new NexusAutomationConfigError(
      `${pathName}.greenMain requires strategy green_main`,
    );
  }

  const { greenMain: _greenMain, ...withoutGreenMain } = value;
  return {
    ...withoutGreenMain,
    ...(publicationTrain !== undefined ? { publicationTrain } : {}),
  };
}

function normalizePublicationTrainConfig(
  value: NexusAutomationPublicationConfig["publicationTrain"],
): NexusAutomationPublicationConfig["publicationTrain"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return {
    enabled: value.enabled,
    activeVersionId: value.activeVersionId,
    branchNaming: { ...value.branchNaming },
    ...(value.ciTiers
      ? {
          ciTiers: {
            enabled: value.ciTiers.enabled,
            defaultTier: value.ciTiers.defaultTier,
            tiers: value.ciTiers.tiers.map((tier) => ({
              ...tier,
              requiredChecks: [...tier.requiredChecks],
              optionalChecks: [...tier.optionalChecks],
              branchPatterns: [...tier.branchPatterns],
              eventNames: [...tier.eventNames],
            })),
            fullMatrixBudget: { ...value.ciTiers.fullMatrixBudget },
          },
        }
      : value.ciTiers === null
        ? { ciTiers: null }
        : {}),
    selector: {
      statuses: [...value.selector.statuses],
      labels: [...value.selector.labels],
      milestones: [...value.selector.milestones],
      assignees: [...value.selector.assignees],
      providerQuery: value.selector.providerQuery,
    },
  };
}

export function summarizeNexusAutomationPublicationPolicy(
  policy: NexusAutomationPublicationConfig,
): NexusAutomationPublicationPolicySummary {
  if (policy.strategy === "green_main") {
    const greenMain = {
      ...defaultNexusAutomationGreenMainConfig,
      ...(policy.greenMain ?? {}),
    };
    const directTargetPush = greenMain.directTargetPush;
    const checks = greenMain.requiredChecks.length > 0
      ? greenMain.requiredChecks.join(",")
      : "none";
    return {
      mode: "green_main",
      targetBranch: policy.targetBranch,
      integrationPreference: greenMain.integrationPreference,
      integrationBranch: greenMain.integrationBranch,
      directTargetPush,
      mergeAuthority: greenMain.mergeAuthority,
      requiredChecks: [...greenMain.requiredChecks],
      staleChecks: greenMain.staleChecks,
      summary:
        `green_main target=${policy.targetBranch ?? "none"} ` +
        `integration=${greenMain.integrationPreference}` +
        `${greenMain.integrationBranch ? ` branch=${greenMain.integrationBranch}` : ""} ` +
        `directTargetPush=${directTargetPush} ` +
        `mergeAuthority=${greenMain.mergeAuthority} checks=${checks} ` +
        `staleChecks=${greenMain.staleChecks}`,
    };
  }

  if (policy.strategy === "direct_integration") {
    return {
      mode: "direct_integration",
      targetBranch: policy.targetBranch,
      integrationPreference: "direct_push",
      integrationBranch: null,
      directTargetPush: policy.push ? "allowed" : "blocked",
      mergeAuthority: null,
      requiredChecks: [],
      staleChecks: null,
      summary:
        `direct_integration target=${policy.targetBranch ?? "none"} ` +
        `directTargetPush=${policy.push ? "allowed" : "blocked"}`,
    };
  }

  if (policy.strategy === "review_handoff") {
    return {
      mode: "review_handoff",
      targetBranch: policy.targetBranch,
      integrationPreference: "pull_request",
      integrationBranch: null,
      directTargetPush: "blocked",
      mergeAuthority: null,
      requiredChecks: [],
      staleChecks: null,
      summary: `review_handoff target=${policy.targetBranch ?? "none"}`,
    };
  }

  return {
    mode: "local_only",
    targetBranch: policy.targetBranch,
    integrationPreference: "local_only",
    integrationBranch: null,
    directTargetPush: "blocked",
    mergeAuthority: null,
    requiredChecks: [],
    staleChecks: null,
    summary: "local_only",
  };
}

function validateMode(
  value: unknown,
  pathName: string,
): NexusAutomationMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "run_once" || value === "agent_launch") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be run_once or agent_launch`);
}

function validateEligibleWorkMode(
  value: unknown,
  pathName: string,
): NexusAutomationEligibleWorkMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "default" || value === "discovery") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be default or discovery`);
}

function validateSelectorConfig(
  value: unknown,
): Partial<NexusAutomationSelectorConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.selector";
  const record = assertRecord(value, pathName);
  return {
    ...optionalArrayField(record, "statuses", pathName, validateWorkStatus),
    ...optionalArrayField(record, "labels", pathName, requiredNonEmptyString),
    ...optionalArrayField(
      record,
      "excludeLabels",
      pathName,
      requiredNonEmptyString,
    ),
    ...optionalArrayField(record, "assignees", pathName, requiredNonEmptyString),
    ...optionalNullableStringField(record, "search", pathName),
    ...optionalPositiveIntegerField(record, "limit", pathName),
  };
}

function validateVerificationConfig(
  value: unknown,
): Partial<NexusAutomationVerificationConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.verification";
  const record = assertRecord(value, pathName);
  return {
    ...optionalArrayField(
      record,
      "focusedCommands",
      pathName,
      requiredNonEmptyString,
    ),
    ...optionalArrayField(
      record,
      "fullCommands",
      pathName,
      requiredNonEmptyString,
    ),
    ...optionalBooleanField(record, "requirePassing", pathName),
    ...optionalCiTierPolicyField(record, "ciTiers", pathName),
  };
}

function optionalCiTierPolicyField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusCiTierPolicyConfig | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  return {
    [key]: validateNexusCiTierPolicyConfig(value, `${pathName}.${key}`) ?? null,
  } as Record<Key, NexusCiTierPolicyConfig | null>;
}

function validateLedgerConfig(
  value: unknown,
): Partial<NexusAutomationLedgerConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.ledger";
  const record = assertRecord(value, pathName);
  return {
    ...optionalStringField(record, "path", pathName),
    ...optionalPositiveIntegerField(record, "retention", pathName),
  };
}

function validateLockConfig(value: unknown): Partial<NexusAutomationLockConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.lock";
  const record = assertRecord(value, pathName);
  return {
    ...optionalStringField(record, "path", pathName),
    ...optionalPositiveIntegerField(record, "staleAfterMs", pathName),
  };
}

function validateWorkItemClaimConfig(
  value: unknown,
): PartialNexusAutomationWorkItemClaimConfig {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.workItemClaims";
  const record = assertRecord(value, pathName);
  const authority = validateWorkItemClaimAuthorityConfig(record.authority);
  return {
    ...optionalBooleanField(record, "enabled", pathName),
    ...optionalPositiveIntegerField(record, "leaseDurationMs", pathName),
    ...optionalPositiveIntegerField(record, "heartbeatIntervalMs", pathName),
    ...optionalWorkItemClaimStalePolicyField(
      record,
      "staleClaimPolicy",
      pathName,
    ),
    ...(Object.keys(authority).length > 0 ? { authority } : {}),
  };
}

function resolvedWorkItemClaimConfig(
  partial: PartialNexusAutomationWorkItemClaimConfig,
): NexusAutomationWorkItemClaimConfig {
  const resolved: NexusAutomationWorkItemClaimConfig = {
    ...defaultNexusAutomationConfig.workItemClaims,
    ...partial,
    authority: {
      ...defaultNexusAutomationConfig.workItemClaims.authority,
      ...partial.authority,
      postgres: {
        ...defaultNexusAutomationConfig.workItemClaims.authority.postgres,
        ...partial.authority?.postgres,
      },
    },
  };
  if (resolved.heartbeatIntervalMs > resolved.leaseDurationMs / 2) {
    throw new NexusAutomationConfigError(
      "project config.automation.workItemClaims.heartbeatIntervalMs must be no more than half leaseDurationMs",
    );
  }

  return resolved;
}

function validateWorkItemClaimAuthorityConfig(
  value: unknown,
): PartialNexusAutomationWorkItemClaimAuthorityConfig {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.workItemClaims.authority";
  const record = assertRecord(value, pathName);
  const postgres = validatePostgresWorkItemClaimAuthorityConfig(record.postgres);
  return {
    ...optionalWorkItemClaimAuthorityBackendField(record, "backend", pathName),
    ...(Object.keys(postgres).length > 0 ? { postgres } : {}),
  };
}

function validatePostgresWorkItemClaimAuthorityConfig(
  value: unknown,
): Partial<NexusAutomationPostgresWorkItemClaimAuthorityConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.workItemClaims.authority.postgres";
  const record = assertRecord(value, pathName);
  return {
    ...optionalNullableStringField(record, "connectionProfileId", pathName),
  };
}

function optionalWorkItemClaimStalePolicyField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationWorkItemClaimStalePolicy>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === "report" || value === "reclaim") {
    return { [key]: value } as Record<Key, NexusAutomationWorkItemClaimStalePolicy>;
  }

  throw new NexusAutomationConfigError(
    `${pathName}.${key} must be report or reclaim`,
  );
}

function optionalWorkItemClaimAuthorityBackendField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationWorkItemClaimAuthorityBackend>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === "optimistic_tracker" || value === "postgres") {
    return { [key]: value } as Record<
      Key,
      NexusAutomationWorkItemClaimAuthorityBackend
    >;
  }

  throw new NexusAutomationConfigError(
    `${pathName}.${key} must be optimistic_tracker or postgres`,
  );
}

function validateBackoffConfig(
  value: unknown,
): Partial<NexusAutomationBackoffConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.backoff";
  const record = assertRecord(value, pathName);
  return {
    ...optionalPositiveIntegerField(record, "failureLimit", pathName),
    ...optionalPositiveIntegerField(record, "baseDelayMs", pathName),
    ...optionalPositiveIntegerField(record, "maxDelayMs", pathName),
  };
}

function validateScheduleConfig(
  value: unknown,
): Partial<NexusAutomationScheduleConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.schedule";
  const record = assertRecord(value, pathName);
  return {
    ...optionalBooleanField(record, "enabled", pathName),
    ...optionalPositiveIntegerField(record, "intervalMs", pathName),
  };
}

function validateSetupConfig(
  value: unknown,
): Partial<NexusAutomationSetupConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.setup";
  const record = assertRecord(value, pathName);
  const dependencyLinks = record.dependencyLinks;
  if (dependencyLinks === undefined) {
    return {};
  }
  if (!Array.isArray(dependencyLinks)) {
    throw new NexusAutomationConfigError(
      `${pathName}.dependencyLinks must be an array`,
    );
  }

  return {
    dependencyLinks: dependencyLinks.map((link, index) =>
      validateDependencyLinkConfig(
        link,
        `${pathName}.dependencyLinks[${index}]`,
      ),
    ),
  };
}

function validateExecutorConfig(
  value: unknown,
): Partial<NexusAutomationExecutorConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.executor";
  const record = assertRecord(value, pathName);
  return {
    ...optionalNullableStringField(record, "command", pathName),
    ...optionalNullablePositiveIntegerField(record, "timeoutMs", pathName),
    ...optionalBooleanField(record, "runFullVerification", pathName),
  };
}

function validateAgentConfig(
  value: unknown,
): Partial<NexusAutomationAgentConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.agent";
  const record = assertRecord(value, pathName);
  const coordinatorProfileId = optionalNullableStringField(
    record,
    "coordinatorProfileId",
    pathName,
  );
  const profiles = optionalArrayField(
    record,
    "profiles",
    pathName,
    validateAgentProfileConfig,
  );
  if (profiles.profiles) {
    assertUniqueAgentProfileIds(profiles.profiles, `${pathName}.profiles`);
  }
  if (coordinatorProfileId.coordinatorProfileId) {
    const profile = profiles.profiles?.find(
      (item) => item.id === coordinatorProfileId.coordinatorProfileId,
    );
    if (!profile) {
      throw new NexusAutomationConfigError(
        `${pathName}.coordinatorProfileId must reference a configured agent profile`,
      );
    }
  }

  return {
    ...optionalNullableStringField(record, "command", pathName),
    ...optionalNullablePositiveIntegerField(record, "timeoutMs", pathName),
    ...coordinatorProfileId,
    ...optionalPositiveIntegerField(record, "maxConcurrentSubagents", pathName),
    ...profiles,
    ...validateAgentRelaunchConfig(record.relaunch),
  };
}

function validateAgentProfileConfig(
  value: unknown,
  pathName: string,
): NexusAutomationAgentProfileConfig {
  const record = assertRecord(value, pathName);
  const id = requiredNonEmptyString(record.id, `${pathName}.id`);
  const executor = requiredNonEmptyString(record.executor, `${pathName}.executor`);
  const executorMode = validateAgentProfileExecutorMode(
    record.executorMode,
    `${pathName}.executorMode`,
  );
  const appServer = validateCodexAppServerConfig(
    record.appServer,
    `${pathName}.appServer`,
  );
  const resolvedExecutorMode = validateAgentProfileExecutorModeCombination({
    executor,
    executorMode,
    appServer,
    pathName,
  });

  return {
    id,
    executor,
    ...(resolvedExecutorMode ? { executorMode: resolvedExecutorMode } : {}),
    model: optionalNullableString(record.model, `${pathName}.model`) ?? null,
    version:
      optionalNullableString(record.version, `${pathName}.version`) ?? null,
    variant:
      optionalNullableString(record.variant, `${pathName}.variant`) ?? null,
    reasoning:
      optionalNullableString(record.reasoning, `${pathName}.reasoning`) ?? null,
    intelligence:
      optionalNullableString(record.intelligence, `${pathName}.intelligence`) ??
      null,
    intendedUse: validateAgentProfileIntendedUse(
      record.intendedUse,
      `${pathName}.intendedUse`,
    ),
    safety: validateAgentProfileSafetyConfig(
      record.safety,
      `${pathName}.safety`,
    ),
    command: optionalNullableString(record.command, `${pathName}.command`) ?? null,
    args: optionalStringArray(record.args, `${pathName}.args`) ?? [],
    ...(appServer ? { appServer } : {}),
  };
}

function validateAgentProfileExecutorMode(
  value: unknown,
  pathName: string,
): NexusAutomationAgentProfileExecutorMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "exec" || value === "app_server") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be exec or app_server`);
}

function validateAgentProfileExecutorModeCombination(options: {
  executor: string;
  executorMode: NexusAutomationAgentProfileExecutorMode | undefined;
  appServer: NexusAutomationCodexAppServerConfig | undefined;
  pathName: string;
}): NexusAutomationAgentProfileExecutorMode | undefined {
  const resolvedMode =
    options.executorMode ?? (options.appServer ? "app_server" : undefined);
  if (!resolvedMode) {
    return undefined;
  }
  if (options.executor.toLowerCase() !== "codex") {
    throw new NexusAutomationConfigError(
      `${options.pathName}.executorMode app_server requires executor codex`,
    );
  }
  if (resolvedMode === "exec" && options.appServer) {
    throw new NexusAutomationConfigError(
      `${options.pathName}.appServer requires executorMode app_server`,
    );
  }
  if (resolvedMode === "app_server" && !options.appServer) {
    throw new NexusAutomationConfigError(
      `${options.pathName}.appServer must be configured when executorMode is app_server`,
    );
  }

  return resolvedMode;
}

function validateCodexAppServerConfig(
  value: unknown,
  pathName: string,
): NexusAutomationCodexAppServerConfig | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const mode = validateCodexAppServerMode(record.mode, `${pathName}.mode`);
  const command = optionalNullableString(record.command, `${pathName}.command`) ??
    null;
  const args = optionalStringArray(record.args, `${pathName}.args`) ?? [];
  const endpoint = requiredCodexAppServerEndpoint(
    record.endpoint,
    `${pathName}.endpoint`,
  );
  const ephemeralThreadDefault = optionalBoolean(
    record,
    "ephemeralThreadDefault",
    pathName,
  ) ?? true;
  const localPolicy = validateCodexAppServerLocalPolicy(
    record.localPolicy,
    `${pathName}.localPolicy`,
  );

  validateCodexAppServerModeCombination({
    mode,
    command,
    args,
    pathName,
  });
  validateCodexAppServerEndpointPolicy({
    endpoint,
    localPolicy,
    pathName,
  });

  return {
    mode,
    command,
    args,
    endpoint,
    ephemeralThreadDefault,
    localPolicy,
  };
}

function validateCodexAppServerMode(
  value: unknown,
  pathName: string,
): NexusAutomationCodexAppServerMode {
  if (value === "connect" || value === "spawn") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be connect or spawn`);
}

function validateCodexAppServerLocalPolicy(
  value: unknown,
  pathName: string,
): NexusAutomationCodexAppServerLocalPolicy {
  if (value === undefined || value === null) {
    return {
      allowNonLoopbackEndpoint: false,
      hostLocalSafetyHints: [],
    };
  }

  const record = assertRecord(value, pathName);
  return {
    allowNonLoopbackEndpoint:
      optionalBoolean(record, "allowNonLoopbackEndpoint", pathName) ?? false,
    hostLocalSafetyHints: optionalArrayField(
      record,
      "hostLocalSafetyHints",
      pathName,
      validateCodexAppServerSafetyHint,
    ).hostLocalSafetyHints ?? [],
  };
}

function validateCodexAppServerSafetyHint(
  value: unknown,
  pathName: string,
): NexusAutomationCodexAppServerSafetyHint {
  if (
    value === "connects_to_local_service" ||
    value === "requires_local_codex_account" ||
    value === "spawns_local_process" ||
    value === "uses_host_local_endpoint"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be connects_to_local_service, requires_local_codex_account, spawns_local_process, or uses_host_local_endpoint`,
  );
}

function validateCodexAppServerModeCombination(options: {
  mode: NexusAutomationCodexAppServerMode;
  command: string | null;
  args: string[];
  pathName: string;
}): void {
  if (options.mode === "spawn" && !options.command) {
    throw new NexusAutomationConfigError(
      `${options.pathName}.command must be configured when appServer.mode is spawn`,
    );
  }
  if (options.mode === "connect" && options.command) {
    throw new NexusAutomationConfigError(
      `${options.pathName}.command must be omitted when appServer.mode is connect`,
    );
  }
  if (options.mode === "connect" && options.args.length > 0) {
    throw new NexusAutomationConfigError(
      `${options.pathName}.args must be omitted when appServer.mode is connect`,
    );
  }
}

function requiredCodexAppServerEndpoint(
  value: unknown,
  pathName: string,
): string {
  const endpoint = requiredNonEmptyString(value, pathName);
  const url = parseCodexAppServerEndpoint(endpoint, pathName);
  if (url.username || url.password || url.search || url.hash) {
    throw new NexusAutomationConfigError(
      `${pathName} must not include credentials, query, or fragment values`,
    );
  }

  return endpoint;
}

function validateCodexAppServerEndpointPolicy(options: {
  endpoint: string;
  localPolicy: NexusAutomationCodexAppServerLocalPolicy;
  pathName: string;
}): void {
  if (isLoopbackCodexAppServerEndpoint(options.endpoint, options.pathName)) {
    return;
  }
  if (options.localPolicy.allowNonLoopbackEndpoint) {
    return;
  }

  throw new NexusAutomationConfigError(
    `${options.pathName}.endpoint uses a non-loopback host; set ${options.pathName}.localPolicy.allowNonLoopbackEndpoint to true only for explicit host-local policy`,
  );
}

export function codexAppServerEndpointScope(
  endpoint: string,
): "loopback" | "non_loopback" {
  return isLoopbackCodexAppServerEndpoint(
    endpoint,
    "appServer.endpoint",
  ) ? "loopback" : "non_loopback";
}

function isLoopbackCodexAppServerEndpoint(
  endpoint: string,
  pathName: string,
): boolean {
  const url = parseCodexAppServerEndpoint(endpoint, pathName);
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.|$)/u.test(hostname)
  );
}

function parseCodexAppServerEndpoint(endpoint: string, pathName: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new NexusAutomationConfigError(
      `${pathName} must be an http, https, ws, or wss URL`,
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:" &&
    url.protocol !== "ws:" &&
    url.protocol !== "wss:"
  ) {
    throw new NexusAutomationConfigError(
      `${pathName} must be an http, https, ws, or wss URL`,
    );
  }
  if (!url.hostname) {
    throw new NexusAutomationConfigError(`${pathName} must include a host`);
  }

  return url;
}

function validateAgentProfileIntendedUse(
  value: unknown,
  pathName: string,
): NexusAutomationAgentProfileIntendedUse {
  if (value === undefined) {
    return "any";
  }
  if (value === "any" || value === "coordinator" || value === "subagent") {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be any, coordinator, or subagent`,
  );
}

function validateAgentProfileSafetyConfig(
  value: unknown,
  pathName: string,
): NexusAutomationSafetyConfig | null {
  if (value === undefined || value === null) {
    return null;
  }

  return {
    ...defaultNexusAutomationConfig.safety,
    ...validateSafetyConfigAt(value, pathName),
  };
}

function assertUniqueAgentProfileIds(
  profiles: NexusAutomationAgentProfileConfig[],
  pathName: string,
): void {
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new NexusAutomationConfigError(
        `${pathName} contains duplicate id: ${profile.id}`,
      );
    }
    ids.add(profile.id);
  }
}

function validateAgentRelaunchConfig(
  value: unknown,
): Partial<Pick<NexusAutomationAgentConfig, "relaunch">> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.agent.relaunch";
  const record = assertRecord(value, pathName);
  return {
    relaunch: {
      ...defaultNexusAutomationConfig.agent.relaunch,
      ...optionalBooleanField(record, "whileEligible", pathName),
    },
  };
}

function validateTargetConfig(
  value: unknown,
): Partial<NexusAutomationTargetConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "workspace config.automation.target";
  const record = assertRecord(value, pathName);
  return {
    ...optionalNullableStringField(record, "id", pathName),
    ...optionalNullableStringField(record, "objective", pathName),
    ...optionalRelativePathField(record, "statePath", pathName),
    ...optionalRelativePathField(record, "cycleLedgerPath", pathName),
    ...optionalBooleanField(record, "stopWhenNoEligibleWork", pathName),
    ...optionalNullablePositiveIntegerField(record, "maxCycles", pathName),
    ...optionalNullablePositiveIntegerField(record, "maxWorkItems", pathName),
  };
}

function validateDependencyLinkConfig(
  value: unknown,
  pathName: string,
): NexusAutomationDependencyLinkConfig {
  const record = assertRecord(value, pathName);

  return {
    source: requiredNonEmptyString(record.source, `${pathName}.source`),
    target: requiredNonEmptyString(record.target, `${pathName}.target`),
    required: optionalBoolean(record, "required", pathName) ?? false,
  };
}

function validateSafetyConfig(
  value: unknown,
): Partial<NexusAutomationSafetyConfig> {
  return validateSafetyConfigAt(value, "workspace config.automation.safety");
}

function validateSafetyConfigAt(
  value: unknown,
  pathName: string,
): Partial<NexusAutomationSafetyConfig> {
  if (value === undefined) {
    return {};
  }

  const record = assertRecord(value, pathName);
  return {
    ...optionalSafetyProfileField(record, "profile", pathName),
    ...optionalBooleanField(record, "allowHostMutation", pathName),
    ...optionalBooleanField(record, "allowDependencyInstall", pathName),
    ...optionalBooleanField(record, "allowLiveServices", pathName),
  };
}

export function validatePartialNexusAutomationPublicationConfig(
  value: unknown,
  pathName = "workspace config.automation.publication",
): Partial<NexusAutomationPublicationConfig> {
  if (value === undefined) {
    return {};
  }

  const record = assertRecord(value, pathName);
  return {
    ...optionalPublicationStrategyField(record, "strategy", pathName),
    ...optionalNullableStringField(record, "remote", pathName),
    ...optionalNullableStringField(record, "targetBranch", pathName),
    ...optionalBooleanField(record, "push", pathName),
    ...optionalNullableStringField(record, "remoteUrl", pathName),
    ...optionalNullableStringField(record, "pushUrl", pathName),
    ...optionalNullableStringField(record, "sshHostAlias", pathName),
    ...optionalBooleanField(record, "packagePublish", pathName),
    ...optionalBooleanField(record, "releasePublish", pathName),
    ...optionalPublicationActorField(record, "actor", pathName),
    ...optionalPublicationGitIdentityField(record, "gitIdentity", pathName),
    ...optionalNullableStringField(record, "manualRemote", pathName),
    ...optionalPublicationActorField(record, "manualActor", pathName),
    ...optionalCommandEnvironmentField(record, "commandEnvironment", pathName),
    ...optionalGreenMainPublicationField(record, "greenMain", pathName),
    ...optionalPublicationTrainField(record, "publicationTrain", pathName),
  };
}

function optionalPublicationGitIdentityField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusPublicationGitIdentityConfig | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  const identityPath = `${pathName}.${key}`;
  const identity = assertRecord(value, identityPath);
  return {
    [key]: {
      name: optionalNullableString(identity.name, `${identityPath}.name`) ?? null,
      email:
        optionalNullableString(identity.email, `${identityPath}.email`) ?? null,
    },
  } as Record<Key, NexusPublicationGitIdentityConfig>;
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new NexusAutomationConfigError(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function optionalBooleanField<
  Key extends string,
  OutputKey extends Key = Key,
>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
  outputKey: OutputKey = key as OutputKey,
): Partial<Record<OutputKey, boolean>> {
  const value = optionalBoolean(record, key, pathName);
  return value === undefined ? {} : { [outputKey]: value } as Record<OutputKey, boolean>;
}

function optionalStringField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, string>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }

  return {
    [key]: requiredNonEmptyString(value, `${pathName}.${key}`),
  } as Record<Key, string>;
}

function optionalNullableString(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, pathName);
}

function optionalNullableStringField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, string | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  return {
    [key]: requiredNonEmptyString(value, `${pathName}.${key}`),
  } as Record<Key, string>;
}

function optionalRelativePathField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, string>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  const normalized = requiredNonEmptyString(value, `${pathName}.${key}`);
  if (
    normalized.split(/[\\/]/u).some((part) => part === "..") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\")
  ) {
    throw new NexusAutomationConfigError(
      `${pathName}.${key} must be a project-relative path`,
    );
  }

  return { [key]: normalized } as Record<Key, string>;
}

function optionalPositiveIntegerField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, number>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusAutomationConfigError(
      `${pathName}.${key} must be a positive integer`,
    );
  }

  return { [key]: value } as Record<Key, number>;
}

function optionalNullablePositiveIntegerField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, number | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusAutomationConfigError(
      `${pathName}.${key} must be a positive integer or null`,
    );
  }

  return { [key]: value } as Record<Key, number>;
}

function optionalArrayField<Key extends string, Item>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
  normalizeItem: (value: unknown, pathName: string) => Item,
): Partial<Record<Key, Item[]>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName}.${key} must be an array`);
  }

  return {
    [key]: value.map((item, index) =>
      normalizeItem(item, `${pathName}.${key}[${index}]`),
    ),
  } as Record<Key, Item[]>;
}

function optionalStringArray(
  value: unknown,
  pathName: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${pathName}[${index}]`),
  );
}

function optionalBranchPrefix(
  value: unknown,
  pathName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const prefix = requiredNonEmptyString(value, pathName).replace(/\/+$/u, "");
  if (prefix.length === 0 || /\s/u.test(prefix) || prefix.startsWith("/")) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a relative Git branch prefix without whitespace`,
    );
  }
  return prefix;
}

function optionalBranchSegment(
  value: unknown,
  pathName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const segment = requiredNonEmptyString(value, pathName);
  if (segment.includes("/") || /\s/u.test(segment)) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a single Git branch path segment without whitespace`,
    );
  }
  return segment;
}

function optionalCommandEnvironmentField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, Record<string, string>>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  const environment = assertRecord(value, `${pathName}.${key}`);
  const normalized: Record<string, string> = {};
  for (const [envKey, envValue] of Object.entries(environment)) {
    const envPath = `${pathName}.${key}.${envKey}`;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(envKey)) {
      throw new NexusAutomationConfigError(
        `${envPath} must be a valid environment variable name`,
      );
    }
    if (secretLikeEnvironmentKey(envKey)) {
      throw new NexusAutomationConfigError(
        `${envPath} must not store secrets in shared publication policy; use a host-local auth profile reference instead`,
      );
    }
    normalized[envKey] = requiredNonEmptyString(envValue, envPath);
  }

  return { [key]: normalized } as Record<Key, Record<string, string>>;
}

function secretLikeEnvironmentKey(key: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|PASS|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)/iu.test(
    key,
  );
}

function optionalPublicationActorField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusPublicationActorConfig | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  return {
    [key]: validatePublicationActorConfig(value, `${pathName}.${key}`),
  } as Record<Key, NexusPublicationActorConfig>;
}

function optionalGreenMainPublicationField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationGreenMainConfig | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  return {
    [key]: validateGreenMainPublicationConfig(value, `${pathName}.${key}`),
  } as Record<Key, NexusAutomationGreenMainConfig>;
}

function validateGreenMainPublicationConfig(
  value: unknown,
  pathName: string,
): NexusAutomationGreenMainConfig {
  const record = assertRecord(value, pathName);
  const integrationPreference = validateGreenMainIntegrationPreference(
    record.integrationPreference,
    `${pathName}.integrationPreference`,
  );
  const integrationBranch = optionalNullableString(
    record.integrationBranch,
    `${pathName}.integrationBranch`,
  );
  const directTargetPush = validateGreenMainDirectTargetPushPolicy(
    record.directTargetPush,
    `${pathName}.directTargetPush`,
  );
  const mergeAuthority = validateGreenMainMergeAuthorityPolicy(
    record.mergeAuthority,
    `${pathName}.mergeAuthority`,
  );
  const requiredChecks = optionalStringArray(
    record.requiredChecks,
    `${pathName}.requiredChecks`,
  );
  const staleChecks = validateGreenMainStaleCheckPolicy(
    record.staleChecks,
    `${pathName}.staleChecks`,
  );

  return {
    integrationPreference:
      integrationPreference ??
      defaultNexusAutomationGreenMainConfig.integrationPreference,
    integrationBranch:
      integrationBranch ??
      defaultNexusAutomationGreenMainConfig.integrationBranch,
    directTargetPush:
      directTargetPush ??
      defaultNexusAutomationGreenMainConfig.directTargetPush,
    mergeAuthority:
      mergeAuthority ??
      defaultNexusAutomationGreenMainConfig.mergeAuthority,
    requiredChecks: [
      ...(requiredChecks ??
        defaultNexusAutomationGreenMainConfig.requiredChecks),
    ],
    staleChecks:
      staleChecks ??
      defaultNexusAutomationGreenMainConfig.staleChecks,
  };
}

function optionalPublicationTrainField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationPublicationTrainConfig | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  return {
    [key]: validatePublicationTrainConfig(value, `${pathName}.${key}`),
  } as Record<Key, NexusAutomationPublicationTrainConfig>;
}

function validatePublicationTrainConfig(
  value: unknown,
  pathName: string,
): NexusAutomationPublicationTrainConfig {
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName) ??
    defaultNexusAutomationPublicationTrainConfig.enabled;
  const activeVersionId = optionalNullableString(
    record.activeVersionId,
    `${pathName}.activeVersionId`,
  ) ?? defaultNexusAutomationPublicationTrainConfig.activeVersionId;
  const branchNaming = validatePublicationTrainBranchNaming(
    record.branchNaming,
    `${pathName}.branchNaming`,
  );
  const ciTiers = record.ciTiers === undefined
    ? undefined
    : validateNexusCiTierPolicyConfig(record.ciTiers, `${pathName}.ciTiers`);
  const selector = validatePublicationTrainSelector(
    record.selector,
    `${pathName}.selector`,
  );

  return {
    enabled,
    activeVersionId,
    branchNaming,
    ...(ciTiers !== undefined ? { ciTiers } : {}),
    selector,
  };
}

function validatePublicationTrainBranchNaming(
  value: unknown,
  pathName: string,
): NexusAutomationPublicationTrainBranchNamingConfig {
  if (value === undefined) {
    return { ...defaultNexusAutomationPublicationTrainConfig.branchNaming };
  }
  const record = assertRecord(value, pathName);
  return {
    integrationPrefix:
      optionalBranchPrefix(record.integrationPrefix, `${pathName}.integrationPrefix`) ??
      defaultNexusAutomationPublicationTrainConfig.branchNaming.integrationPrefix,
    candidatePrefix:
      optionalBranchPrefix(record.candidatePrefix, `${pathName}.candidatePrefix`) ??
      defaultNexusAutomationPublicationTrainConfig.branchNaming.candidatePrefix,
    unscopedName:
      optionalBranchSegment(record.unscopedName, `${pathName}.unscopedName`) ??
      defaultNexusAutomationPublicationTrainConfig.branchNaming.unscopedName,
  };
}

function validatePublicationTrainSelector(
  value: unknown,
  pathName: string,
): NexusAutomationPublicationTrainSelectorConfig {
  if (value === undefined) {
    return {
      statuses: [...defaultNexusAutomationPublicationTrainConfig.selector.statuses],
      labels: [...defaultNexusAutomationPublicationTrainConfig.selector.labels],
      milestones: [...defaultNexusAutomationPublicationTrainConfig.selector.milestones],
      assignees: [...defaultNexusAutomationPublicationTrainConfig.selector.assignees],
      providerQuery:
        defaultNexusAutomationPublicationTrainConfig.selector.providerQuery,
    };
  }
  const record = assertRecord(value, pathName);
  return {
    statuses: optionalArrayField(
      record,
      "statuses",
      pathName,
      validateWorkStatus,
    ).statuses ?? [...defaultNexusAutomationPublicationTrainConfig.selector.statuses],
    labels: optionalArrayField(
      record,
      "labels",
      pathName,
      requiredNonEmptyString,
    ).labels ?? [...defaultNexusAutomationPublicationTrainConfig.selector.labels],
    milestones: optionalArrayField(
      record,
      "milestones",
      pathName,
      requiredNonEmptyString,
    ).milestones ?? [...defaultNexusAutomationPublicationTrainConfig.selector.milestones],
    assignees: optionalArrayField(
      record,
      "assignees",
      pathName,
      requiredNonEmptyString,
    ).assignees ?? [...defaultNexusAutomationPublicationTrainConfig.selector.assignees],
    providerQuery:
      optionalNullableString(record.providerQuery, `${pathName}.providerQuery`) ??
      defaultNexusAutomationPublicationTrainConfig.selector.providerQuery,
  };
}

function validatePublicationActorConfig(
  value: unknown,
  pathName: string,
): NexusPublicationActorConfig {
  const record = assertRecord(value, pathName);
  return {
    kind: validatePublicationActorKind(record.kind, `${pathName}.kind`),
    provider: optionalNullableString(record.provider, `${pathName}.provider`) ?? null,
    handle: optionalNullableString(record.handle, `${pathName}.handle`) ?? null,
    id: optionalNullableString(record.id, `${pathName}.id`) ?? null,
  };
}

function validatePublicationActorKind(
  value: unknown,
  pathName: string,
): NexusPublicationActorKind {
  if (
    value === "human" ||
    value === "machine_user" ||
    value === "app" ||
    value === "service_account"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be human, machine_user, app, or service_account`,
  );
}

function validateGreenMainIntegrationPreference(
  value: unknown,
  pathName: string,
): NexusAutomationGreenMainIntegrationPreference | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "branch" || value === "pull_request") {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be branch or pull_request`,
  );
}

function validateGreenMainDirectTargetPushPolicy(
  value: unknown,
  pathName: string,
): NexusAutomationGreenMainDirectTargetPushPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "blocked" ||
    value === "exceptional" ||
    value === "allowed"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be blocked, exceptional, or allowed`,
  );
}

function validateGreenMainStaleCheckPolicy(
  value: unknown,
  pathName: string,
): NexusAutomationGreenMainStaleCheckPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "block" || value === "allow") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be block or allow`);
}

function validateGreenMainMergeAuthorityPolicy(
  value: unknown,
  pathName: string,
): NexusAutomationGreenMainMergeAuthorityPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "handoff" || value === "authorized_merge") {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be handoff or authorized_merge`,
  );
}

function optionalSafetyProfileField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationSafetyProfile>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === "local" || value === "isolated" || value === "host-authorized") {
    return { [key]: value } as Record<Key, NexusAutomationSafetyProfile>;
  }

  throw new NexusAutomationConfigError(
    `${pathName}.${key} must be local, isolated, or host-authorized`,
  );
}

function optionalPublicationStrategyField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationPublicationStrategy>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (
    value === "local_only" ||
    value === "green_main" ||
    value === "direct_integration" ||
    value === "review_handoff"
  ) {
    return { [key]: value } as Record<Key, NexusAutomationPublicationStrategy>;
  }

  throw new NexusAutomationConfigError(
    `${pathName}.${key} must be local_only, green_main, direct_integration, or review_handoff`,
  );
}

function validateWorkStatus(value: unknown, pathName: string): WorkStatus {
  if (
    value === "todo" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done" ||
    value === "wont_do"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
  );
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationConfigError(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}
