import type { WorkStatus } from "../work-items/workTrackingTypes.js";
import {
  validateNexusCiTierPolicyConfig,
  type NexusCiTierPolicyConfig,
} from "../operations/nexusCiTierPolicy.js";
import { stripTrailingSlashes } from "../runtime/nexusTextNormalization.js";

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
  coAuthors?: NexusPublicationGitCoAuthorConfig[];
}

export interface NexusPublicationGitCoAuthorConfig {
  name: string;
  email: string;
}

export interface NexusAutomationGreenMainConfig {
  integrationPreference: NexusAutomationGreenMainIntegrationPreference;
  integrationBranch: string | null;
  directTargetPush: NexusAutomationGreenMainDirectTargetPushPolicy;
  mergeAuthority: NexusAutomationGreenMainMergeAuthorityPolicy;
  requiredChecks: string[];
  staleChecks: NexusAutomationGreenMainStaleCheckPolicy;
}

export type NexusFeatureBranchDeliveryBranchStrategy =
  | "direct"
  | "stacked"
  | "feature_branch"
  | "hybrid"
  | "throwaway_rehearsal";

export type NexusFeatureBranchDeliveryReviewMode =
  | "review_branch_pr"
  | "commit_pr"
  | "batch_pr";

export type NexusFeatureBranchDeliveryFinalPullRequestCreationPolicy =
  | "at_feature_start"
  | "at_review_gate"
  | "manual_only";

export type NexusFeatureBranchDeliveryCommentPolicy =
  | "silent"
  | "status_only"
  | "comments_allowed";

export type NexusFeatureBranchDeliveryBranchPublicationStrategy =
  | "push_remote"
  | "fallback_remote"
  | "push_remote_then_fallback"
  | "manual_only";

export interface NexusFeatureBranchDeliveryBranchNamingConfig {
  defaultIntentPrefix: string;
  allowedIntentPrefixes: string[];
  featureBranchPattern: string;
  reviewBranchPattern: string;
}

export interface NexusFeatureBranchDeliveryReviewConfig {
  mode: NexusFeatureBranchDeliveryReviewMode;
  finalPullRequest: boolean;
  finalPullRequestCreation: NexusFeatureBranchDeliveryFinalPullRequestCreationPolicy;
}

export interface NexusFeatureBranchDeliveryProviderConfig {
  commentPolicy: NexusFeatureBranchDeliveryCommentPolicy;
}

export interface NexusFeatureBranchDeliveryBranchPublicationConfig {
  strategy: NexusFeatureBranchDeliveryBranchPublicationStrategy;
  fallbackRemote: string | null;
}

export interface NexusFeatureBranchDeliveryConfig {
  enabled: boolean;
  activeFeatureId: string | null;
  defaultBranchStrategy: NexusFeatureBranchDeliveryBranchStrategy;
  allowedBranchStrategies: NexusFeatureBranchDeliveryBranchStrategy[];
  branchNaming: NexusFeatureBranchDeliveryBranchNamingConfig;
  review: NexusFeatureBranchDeliveryReviewConfig;
  provider: NexusFeatureBranchDeliveryProviderConfig;
  branchPublication: NexusFeatureBranchDeliveryBranchPublicationConfig;
}

export type NexusGitWorkflowProfileSource =
  | "configured"
  | "legacy_feature_branch_delivery";

export type NexusGitWorkflowBranchStrategy =
  | NexusFeatureBranchDeliveryBranchStrategy
  | "release_maintenance"
  | "environment_branch";

export type NexusGitWorkflowUpdateAction =
  | "none"
  | "merge"
  | "rebase"
  | "restack"
  | "recreate"
  | "cherry_pick"
  | "block"
  | "wait";

export type NexusGitWorkflowPublicRewritePolicy =
  | "never"
  | "before_review"
  | "with_human_approval";

export type NexusGitWorkflowGate =
  | "human_approval"
  | "provider_review"
  | "required_checks"
  | "merge_queue"
  | "publication_authority"
  | "manual_cleanup";

export type NexusGitWorkflowReleaseMaintenanceFlow =
  | "oldest_to_newest"
  | "trunk_to_release";

export type NexusGitWorkflowEnvironmentPromotion =
  | "pull_request"
  | "fast_forward"
  | "manual";

export interface NexusGitWorkflowUpdatePolicyConfig {
  behind: NexusGitWorkflowUpdateAction;
  diverged: NexusGitWorkflowUpdateAction;
  wrongBase: NexusGitWorkflowUpdateAction;
  publicRewrite: NexusGitWorkflowPublicRewritePolicy;
}

export interface NexusGitWorkflowGateConfig {
  start: NexusGitWorkflowGate[];
  review: NexusGitWorkflowGate[];
  publication: NexusGitWorkflowGate[];
  cleanup: NexusGitWorkflowGate[];
}

export interface NexusGitWorkflowReleaseMaintenanceConfig {
  branches: string[];
  flow: NexusGitWorkflowReleaseMaintenanceFlow;
}

export interface NexusGitWorkflowEnvironmentBranchConfig {
  branch: string;
  promotion: NexusGitWorkflowEnvironmentPromotion;
}

export interface NexusGitWorkflowProfileConfig {
  id: string;
  name: string | null;
  source: NexusGitWorkflowProfileSource;
  branchStrategy: NexusGitWorkflowBranchStrategy;
  targetBranch: string | null;
  activeFeatureId: string | null;
  allowedBranchStrategies: NexusFeatureBranchDeliveryBranchStrategy[];
  branchNaming: NexusFeatureBranchDeliveryBranchNamingConfig;
  review: NexusFeatureBranchDeliveryReviewConfig;
  provider: NexusFeatureBranchDeliveryProviderConfig;
  branchPublication: NexusFeatureBranchDeliveryBranchPublicationConfig;
  update: NexusGitWorkflowUpdatePolicyConfig;
  gates: NexusGitWorkflowGateConfig;
  release: NexusGitWorkflowReleaseMaintenanceConfig | null;
  environment: NexusGitWorkflowEnvironmentBranchConfig | null;
}

export interface NexusGitWorkflowConfig {
  activeProfileId: string | null;
  profiles: NexusGitWorkflowProfileConfig[];
}

export interface NexusAutomationReleaseTrainBranchNamingConfig {
  integrationPrefix: string;
  candidatePrefix: string;
  unscopedName: string;
}

export interface NexusAutomationReleaseTrainSelectorConfig {
  statuses: WorkStatus[];
  labels: string[];
  milestones: string[];
  assignees: string[];
  providerQuery: string | null;
}

export interface NexusAutomationReleaseTrainConfig {
  enabled: boolean;
  activeVersionId: string | null;
  branchNaming: NexusAutomationReleaseTrainBranchNamingConfig;
  featureBranchDelivery?: NexusFeatureBranchDeliveryConfig | null;
  ciTiers?: NexusCiTierPolicyConfig | null;
  selector: NexusAutomationReleaseTrainSelectorConfig;
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
  releaseTrain?: NexusAutomationReleaseTrainConfig | null;
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
  gitWorkflows: NexusGitWorkflowConfig;
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
  gitWorkflows: {
    activeProfileId: null,
    profiles: [],
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

export const defaultNexusGitWorkflowUpdatePolicyConfig:
  NexusGitWorkflowUpdatePolicyConfig = {
    behind: "none",
    diverged: "block",
    wrongBase: "recreate",
    publicRewrite: "with_human_approval",
  };

export const defaultNexusGitWorkflowGateConfig: NexusGitWorkflowGateConfig = {
  start: [],
  review: ["provider_review"],
  publication: ["human_approval", "publication_authority"],
  cleanup: ["manual_cleanup"],
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

export const defaultNexusAutomationReleaseTrainConfig:
  NexusAutomationReleaseTrainConfig = {
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

export const defaultNexusFeatureBranchDeliveryConfig:
  NexusFeatureBranchDeliveryConfig = {
    enabled: false,
    activeFeatureId: null,
    defaultBranchStrategy: "direct",
    allowedBranchStrategies: [
      "direct",
      "stacked",
      "feature_branch",
      "hybrid",
      "throwaway_rehearsal",
    ],
    branchNaming: {
      defaultIntentPrefix: "feat",
      allowedIntentPrefixes: [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "ci",
      ],
      featureBranchPattern: "{intent}/{feature}",
      reviewBranchPattern: "{intent}/{feature}/{change}",
    },
    review: {
      mode: "review_branch_pr",
      finalPullRequest: true,
      finalPullRequestCreation: "at_review_gate",
    },
    provider: {
      commentPolicy: "status_only",
    },
    branchPublication: {
      strategy: "push_remote",
      fallbackRemote: null,
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
  const publicationPolicy = normalizeNexusAutomationPublicationConfig(
    {
      ...defaultNexusAutomationConfig.publication,
      ...publication,
      commandEnvironment: {
        ...defaultNexusAutomationConfig.publication.commandEnvironment,
        ...publication.commandEnvironment,
      },
    },
    "workspace config.automation.publication",
  );
  const gitWorkflows = record.gitWorkflows === undefined
    ? gitWorkflowsFromLegacyFeatureBranchDelivery(publicationPolicy)
    : validateGitWorkflowConfig(
        record.gitWorkflows,
        "workspace config.automation.gitWorkflows",
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
    gitWorkflows,
    publication: publicationPolicy,
  };
}

export function normalizeNexusAutomationPublicationConfig(
  value: NexusAutomationPublicationConfig,
  pathName = "workspace config.automation.publication",
): NexusAutomationPublicationConfig {
  const releaseTrain = normalizeReleaseTrainConfig(value.releaseTrain);
  if (value.strategy === "green_main") {
    const greenMain = {
      ...defaultNexusAutomationGreenMainConfig,
      ...(value.greenMain ?? {}),
    };
    assertGreenMainPublicationConfig(value, greenMain, pathName);

    return {
      ...value,
      ...(releaseTrain !== undefined ? { releaseTrain } : {}),
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
    ...(releaseTrain !== undefined ? { releaseTrain } : {}),
  };
}

function assertGreenMainPublicationConfig(
  value: NexusAutomationPublicationConfig,
  greenMain: NexusAutomationGreenMainConfig,
  pathName: string,
): void {
  const message = greenMainPublicationConfigErrors(value, greenMain, pathName)[0];
  if (message !== undefined) {
    throw new NexusAutomationConfigError(message);
  }
}

function greenMainPublicationConfigErrors(
  value: NexusAutomationPublicationConfig,
  greenMain: NexusAutomationGreenMainConfig,
  pathName: string,
): string[] {
  return [
    ...missingGreenMainTargetBranchErrors(value, pathName),
    ...greenMainIntegrationBranchErrors(value, greenMain, pathName),
    ...greenMainDirectPushErrors(value, greenMain, pathName),
  ];
}

function missingGreenMainTargetBranchErrors(
  value: NexusAutomationPublicationConfig,
  pathName: string,
): string[] {
  return value.targetBranch
    ? []
    : [`${pathName}.targetBranch is required when strategy is green_main`];
}

function greenMainIntegrationBranchErrors(
  value: NexusAutomationPublicationConfig,
  greenMain: NexusAutomationGreenMainConfig,
  pathName: string,
): string[] {
  const errors: string[] = [];
  if (
    greenMain.integrationPreference === "branch" &&
    !greenMain.integrationBranch
  ) {
    errors.push(
      `${pathName}.greenMain.integrationBranch is required when integrationPreference is branch`,
    );
  }
  if (
    greenMain.integrationBranch &&
    value.targetBranch &&
    greenMain.integrationBranch === value.targetBranch
  ) {
    errors.push(
      `${pathName}.greenMain.integrationBranch must not be the targetBranch`,
    );
  }
  return errors;
}

function greenMainDirectPushErrors(
  value: NexusAutomationPublicationConfig,
  greenMain: NexusAutomationGreenMainConfig,
  pathName: string,
): string[] {
  return value.push && greenMain.directTargetPush === "blocked"
    ? [
        `${pathName}.push must be false when greenMain.directTargetPush is blocked`,
      ]
    : [];
}

function normalizeReleaseTrainConfig(
  value: NexusAutomationPublicationConfig["releaseTrain"],
): NexusAutomationPublicationConfig["releaseTrain"] | undefined {
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
    ...(value.featureBranchDelivery
      ? {
          featureBranchDelivery: normalizeFeatureBranchDeliveryConfig(
            value.featureBranchDelivery,
          ),
        }
      : value.featureBranchDelivery === null
        ? { featureBranchDelivery: null }
        : {}),
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

function normalizeFeatureBranchDeliveryConfig(
  value: NexusFeatureBranchDeliveryConfig,
): NexusFeatureBranchDeliveryConfig {
  const branchNaming = {
    ...defaultNexusFeatureBranchDeliveryConfig.branchNaming,
    ...value.branchNaming,
  };
  return {
    ...defaultNexusFeatureBranchDeliveryConfig,
    ...value,
    allowedBranchStrategies: value.allowedBranchStrategies
      ? [...value.allowedBranchStrategies]
      : [...defaultNexusFeatureBranchDeliveryConfig.allowedBranchStrategies],
    branchNaming: {
      ...branchNaming,
      allowedIntentPrefixes: branchNaming.allowedIntentPrefixes
        ? [...branchNaming.allowedIntentPrefixes]
        : [
            ...defaultNexusFeatureBranchDeliveryConfig.branchNaming
              .allowedIntentPrefixes,
          ],
    },
    review: {
      ...defaultNexusFeatureBranchDeliveryConfig.review,
      ...value.review,
    },
    provider: {
      ...defaultNexusFeatureBranchDeliveryConfig.provider,
      ...value.provider,
    },
  };
}

function gitWorkflowsFromLegacyFeatureBranchDelivery(
  publication: NexusAutomationPublicationConfig,
): NexusGitWorkflowConfig {
  const delivery = publication.releaseTrain?.featureBranchDelivery;
  if (!delivery?.enabled) {
    return {
      activeProfileId: defaultNexusAutomationConfig.gitWorkflows.activeProfileId,
      profiles: [...defaultNexusAutomationConfig.gitWorkflows.profiles],
    };
  }

  const config = normalizeFeatureBranchDeliveryConfig(delivery);
  const id = "legacy-feature-branch-delivery";
  const branchStrategy = config.defaultBranchStrategy;
  const review = branchStrategy === "throwaway_rehearsal"
    ? {
        ...config.review,
        finalPullRequest: false,
        finalPullRequestCreation: "manual_only" as const,
      }
    : config.review;

  return {
    activeProfileId: id,
    profiles: [
      {
        id,
        name: "Legacy feature branch delivery",
        source: "legacy_feature_branch_delivery",
        branchStrategy,
        targetBranch: publication.targetBranch,
        activeFeatureId: config.activeFeatureId,
        allowedBranchStrategies: [...config.allowedBranchStrategies],
        branchNaming: {
          ...config.branchNaming,
          allowedIntentPrefixes: [
            ...config.branchNaming.allowedIntentPrefixes,
          ],
        },
        review,
        provider: { ...config.provider },
        branchPublication: { ...config.branchPublication },
        update: defaultGitWorkflowUpdatePolicyFor(branchStrategy),
        gates: defaultGitWorkflowGatePolicyFor(review),
        release: null,
        environment: null,
      },
    ],
  };
}

function validateGitWorkflowConfig(
  value: unknown,
  pathName: string,
): NexusGitWorkflowConfig {
  const record = assertRecord(value, pathName);
  const profiles = record.profiles === undefined
    ? []
    : optionalArray(
        record.profiles,
        `${pathName}.profiles`,
        validateGitWorkflowProfile,
      );
  assertUniqueGitWorkflowProfileIds(profiles, `${pathName}.profiles`);
  const activeProfileId = optionalNullableString(
    record.activeProfileId,
    `${pathName}.activeProfileId`,
  ) ?? null;
  if (
    activeProfileId &&
    !profiles.some((profile) => profile.id === activeProfileId)
  ) {
    throw new NexusAutomationConfigError(
      `${pathName}.activeProfileId must reference a configured profile`,
    );
  }

  return {
    activeProfileId,
    profiles,
  };
}

function assertUniqueGitWorkflowProfileIds(
  profiles: NexusGitWorkflowProfileConfig[],
  pathName: string,
): void {
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      throw new NexusAutomationConfigError(
        `${pathName} must not contain duplicate profile id ${profile.id}`,
      );
    }
    seen.add(profile.id);
  }
}

function validateGitWorkflowProfile(
  value: unknown,
  pathName: string,
): NexusGitWorkflowProfileConfig {
  const record = assertRecord(value, pathName);
  const id = validateGitWorkflowProfileId(record.id, `${pathName}.id`);
  const branchStrategy = validateGitWorkflowBranchStrategy(
    record.branchStrategy,
    `${pathName}.branchStrategy`,
  );
  const review = validateGitWorkflowReview(
    record.review,
    `${pathName}.review`,
    branchStrategy,
  );
  const release = validateOptionalGitWorkflowReleaseMaintenance(
    record.release,
    `${pathName}.release`,
  );
  const environment = validateOptionalGitWorkflowEnvironmentBranch(
    record.environment,
    `${pathName}.environment`,
  );
  const update = validateGitWorkflowUpdatePolicy(
    record.update,
    `${pathName}.update`,
    branchStrategy,
  );
  assertGitWorkflowSpecializedConfig(branchStrategy, release, environment, pathName);

  return {
    id,
    name: optionalNullableString(record.name, `${pathName}.name`) ?? null,
    source: record.source === undefined
      ? "configured"
      : validateGitWorkflowProfileSource(record.source, `${pathName}.source`),
    branchStrategy,
    targetBranch:
      optionalNullableString(record.targetBranch, `${pathName}.targetBranch`) ??
      null,
    activeFeatureId:
      optionalNullableString(
        record.activeFeatureId,
        `${pathName}.activeFeatureId`,
      ) ?? null,
    allowedBranchStrategies: validateAllowedFeatureBranchStrategies(
      record.allowedBranchStrategies,
      `${pathName}.allowedBranchStrategies`,
    ),
    branchNaming: validateFeatureBranchDeliveryBranchNaming(
      record.branchNaming,
      `${pathName}.branchNaming`,
    ),
    review,
    provider: validateFeatureBranchDeliveryProvider(
      record.provider,
      `${pathName}.provider`,
    ),
    branchPublication: validateFeatureBranchDeliveryBranchPublication(
      record.branchPublication,
      `${pathName}.branchPublication`,
    ),
    update,
    gates: validateGitWorkflowGatePolicy(record.gates, `${pathName}.gates`, review),
    release,
    environment,
  };
}

function validateGitWorkflowProfileId(value: unknown, pathName: string): string {
  const id = requiredNonEmptyString(value, pathName);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)) {
    throw new NexusAutomationConfigError(
      `${pathName} must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens`,
    );
  }
  return id;
}

function validateGitWorkflowProfileSource(
  value: unknown,
  pathName: string,
): NexusGitWorkflowProfileSource {
  if (value === "configured" || value === "legacy_feature_branch_delivery") {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be configured or legacy_feature_branch_delivery`,
  );
}

function validateGitWorkflowBranchStrategy(
  value: unknown,
  pathName: string,
): NexusGitWorkflowBranchStrategy {
  if (
    value === "direct" ||
    value === "stacked" ||
    value === "feature_branch" ||
    value === "hybrid" ||
    value === "throwaway_rehearsal" ||
    value === "release_maintenance" ||
    value === "environment_branch"
  ) {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be direct, stacked, feature_branch, hybrid, release_maintenance, environment_branch, or throwaway_rehearsal`,
  );
}

function validateGitWorkflowReview(
  value: unknown,
  pathName: string,
  branchStrategy: NexusGitWorkflowBranchStrategy,
): NexusFeatureBranchDeliveryReviewConfig {
  const review = value === undefined && branchStrategy === "throwaway_rehearsal"
    ? {
        ...defaultNexusFeatureBranchDeliveryConfig.review,
        finalPullRequest: false,
        finalPullRequestCreation: "manual_only" as const,
      }
    : validateFeatureBranchDeliveryReview(value, pathName);
  if (branchStrategy === "throwaway_rehearsal" && review.finalPullRequest) {
    throw new NexusAutomationConfigError(
      `${pathName}.finalPullRequest: throwaway_rehearsal profiles cannot create a final pull request`,
    );
  }
  return review;
}

function validateGitWorkflowUpdatePolicy(
  value: unknown,
  pathName: string,
  branchStrategy: NexusGitWorkflowBranchStrategy,
): NexusGitWorkflowUpdatePolicyConfig {
  const defaults = defaultGitWorkflowUpdatePolicyFor(branchStrategy);
  if (value === undefined) {
    return defaults;
  }
  const record = assertRecord(value, pathName);
  const update = {
    behind: record.behind === undefined
      ? defaults.behind
      : validateGitWorkflowUpdateAction(record.behind, `${pathName}.behind`),
    diverged: record.diverged === undefined
      ? defaults.diverged
      : validateGitWorkflowUpdateAction(record.diverged, `${pathName}.diverged`),
    wrongBase: record.wrongBase === undefined
      ? defaults.wrongBase
      : validateGitWorkflowUpdateAction(record.wrongBase, `${pathName}.wrongBase`),
    publicRewrite: record.publicRewrite === undefined
      ? defaults.publicRewrite
      : validateGitWorkflowPublicRewritePolicy(
          record.publicRewrite,
          `${pathName}.publicRewrite`,
        ),
  };
  assertGitWorkflowUpdatePolicy(update, branchStrategy, pathName);
  return update;
}

function defaultGitWorkflowUpdatePolicyFor(
  branchStrategy: NexusGitWorkflowBranchStrategy,
): NexusGitWorkflowUpdatePolicyConfig {
  if (branchStrategy === "stacked" || branchStrategy === "hybrid") {
    return {
      ...defaultNexusGitWorkflowUpdatePolicyConfig,
      behind: "restack",
    };
  }
  if (branchStrategy === "release_maintenance") {
    return {
      ...defaultNexusGitWorkflowUpdatePolicyConfig,
      behind: "cherry_pick",
      diverged: "cherry_pick",
    };
  }
  if (branchStrategy === "throwaway_rehearsal") {
    return {
      behind: "recreate",
      diverged: "recreate",
      wrongBase: "recreate",
      publicRewrite: "before_review",
    };
  }
  return { ...defaultNexusGitWorkflowUpdatePolicyConfig };
}

function assertGitWorkflowUpdatePolicy(
  update: NexusGitWorkflowUpdatePolicyConfig,
  branchStrategy: NexusGitWorkflowBranchStrategy,
  pathName: string,
): void {
  const actions = [update.behind, update.diverged, update.wrongBase];
  const usesRestack = actions.includes("restack");
  if (
    usesRestack &&
    branchStrategy !== "stacked" &&
    branchStrategy !== "hybrid"
  ) {
    throw new NexusAutomationConfigError(
      `${pathName}: restack update actions require stacked or hybrid branchStrategy`,
    );
  }
  if (
    update.publicRewrite === "never" &&
    actions.some((action) => action === "rebase" || action === "restack")
  ) {
    throw new NexusAutomationConfigError(
      `${pathName}: publicRewrite never conflicts with rebase or restack update actions`,
    );
  }
}

function validateGitWorkflowUpdateAction(
  value: unknown,
  pathName: string,
): NexusGitWorkflowUpdateAction {
  if (
    value === "none" ||
    value === "merge" ||
    value === "rebase" ||
    value === "restack" ||
    value === "recreate" ||
    value === "cherry_pick" ||
    value === "block" ||
    value === "wait"
  ) {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be none, merge, rebase, restack, recreate, cherry_pick, block, or wait`,
  );
}

function validateGitWorkflowPublicRewritePolicy(
  value: unknown,
  pathName: string,
): NexusGitWorkflowPublicRewritePolicy {
  if (
    value === "never" ||
    value === "before_review" ||
    value === "with_human_approval"
  ) {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be never, before_review, or with_human_approval`,
  );
}

function validateGitWorkflowGatePolicy(
  value: unknown,
  pathName: string,
  review: NexusFeatureBranchDeliveryReviewConfig,
): NexusGitWorkflowGateConfig {
  if (value === undefined) {
    return defaultGitWorkflowGatePolicyFor(review);
  }
  const record = assertRecord(value, pathName);
  return {
    start: validateOptionalGitWorkflowGates(record.start, `${pathName}.start`) ??
      [],
    review: validateOptionalGitWorkflowGates(record.review, `${pathName}.review`) ??
      [],
    publication:
      validateOptionalGitWorkflowGates(
        record.publication,
        `${pathName}.publication`,
      ) ?? [],
    cleanup:
      validateOptionalGitWorkflowGates(record.cleanup, `${pathName}.cleanup`) ??
      [],
  };
}

function defaultGitWorkflowGatePolicyFor(
  review: NexusFeatureBranchDeliveryReviewConfig,
): NexusGitWorkflowGateConfig {
  return {
    ...defaultNexusGitWorkflowGateConfig,
    review: review.mode === "review_branch_pr" ? ["provider_review"] : [],
    publication: [
      "human_approval",
      ...(review.finalPullRequest ? ["provider_review" as const] : []),
      "publication_authority",
    ],
  };
}

function validateOptionalGitWorkflowGates(
  value: unknown,
  pathName: string,
): NexusGitWorkflowGate[] | undefined {
  return optionalStringArray(value, pathName)?.map((item) =>
    validateGitWorkflowGate(item, pathName),
  );
}

function validateGitWorkflowGate(
  value: unknown,
  pathName: string,
): NexusGitWorkflowGate {
  if (
    value === "human_approval" ||
    value === "provider_review" ||
    value === "required_checks" ||
    value === "merge_queue" ||
    value === "publication_authority" ||
    value === "manual_cleanup"
  ) {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must contain only known Git workflow gates`,
  );
}

function validateOptionalGitWorkflowReleaseMaintenance(
  value: unknown,
  pathName: string,
): NexusGitWorkflowReleaseMaintenanceConfig | null {
  if (value === undefined || value === null) {
    return null;
  }
  const record = assertRecord(value, pathName);
  const branches = optionalStringArray(record.branches, `${pathName}.branches`);
  if (!branches || branches.length === 0) {
    throw new NexusAutomationConfigError(`${pathName}.branches must not be empty`);
  }
  return {
    branches: uniqueValues(branches.map((branch, index) =>
      validateGitWorkflowBranchName(branch, `${pathName}.branches[${index}]`)
    )),
    flow: validateGitWorkflowReleaseMaintenanceFlow(
      record.flow,
      `${pathName}.flow`,
    ),
  };
}

function validateGitWorkflowReleaseMaintenanceFlow(
  value: unknown,
  pathName: string,
): NexusGitWorkflowReleaseMaintenanceFlow {
  if (value === "oldest_to_newest" || value === "trunk_to_release") {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be oldest_to_newest or trunk_to_release`,
  );
}

function validateOptionalGitWorkflowEnvironmentBranch(
  value: unknown,
  pathName: string,
): NexusGitWorkflowEnvironmentBranchConfig | null {
  if (value === undefined || value === null) {
    return null;
  }
  const record = assertRecord(value, pathName);
  return {
    branch: validateGitWorkflowBranchName(record.branch, `${pathName}.branch`),
    promotion: validateGitWorkflowEnvironmentPromotion(
      record.promotion,
      `${pathName}.promotion`,
    ),
  };
}

function validateGitWorkflowEnvironmentPromotion(
  value: unknown,
  pathName: string,
): NexusGitWorkflowEnvironmentPromotion {
  if (value === "pull_request" || value === "fast_forward" || value === "manual") {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be pull_request, fast_forward, or manual`,
  );
}

function assertGitWorkflowSpecializedConfig(
  branchStrategy: NexusGitWorkflowBranchStrategy,
  release: NexusGitWorkflowReleaseMaintenanceConfig | null,
  environment: NexusGitWorkflowEnvironmentBranchConfig | null,
  pathName: string,
): void {
  if (branchStrategy === "release_maintenance" && !release) {
    throw new NexusAutomationConfigError(
      `${pathName}.release is required when branchStrategy is release_maintenance`,
    );
  }
  if (branchStrategy !== "release_maintenance" && release) {
    throw new NexusAutomationConfigError(
      `${pathName}.release requires branchStrategy release_maintenance`,
    );
  }
  if (branchStrategy === "environment_branch" && !environment) {
    throw new NexusAutomationConfigError(
      `${pathName}.environment is required when branchStrategy is environment_branch`,
    );
  }
  if (branchStrategy !== "environment_branch" && environment) {
    throw new NexusAutomationConfigError(
      `${pathName}.environment requires branchStrategy environment_branch`,
    );
  }
}

function validateGitWorkflowBranchName(value: unknown, pathName: string): string {
  const branch = stripTrailingSlashes(requiredNonEmptyString(value, pathName));
  if (
    branch.length === 0 ||
    branch.startsWith("/") ||
    branch.includes("..") ||
    /\s/u.test(branch)
  ) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a relative Git branch name without whitespace or parent traversal`,
    );
  }
  return branch;
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
    ...optionalReleaseTrainField(record, "releaseTrain", pathName),
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
  const coAuthors = optionalPublicationGitCoAuthors(
    identity.coAuthors,
    `${identityPath}.coAuthors`,
  );
  return {
    [key]: {
      name: optionalNullableString(identity.name, `${identityPath}.name`) ?? null,
      email:
        optionalNullableString(identity.email, `${identityPath}.email`) ?? null,
      ...(coAuthors !== undefined ? { coAuthors } : {}),
    },
  } as Record<Key, NexusPublicationGitIdentityConfig>;
}

function optionalPublicationGitCoAuthors(
  value: unknown,
  pathName: string,
): NexusPublicationGitCoAuthorConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName} must be an array`);
  }

  return value.map((item, index) => {
    const itemPath = `${pathName}[${index}]`;
    const record = assertRecord(item, itemPath);
    return {
      name: requiredNonEmptyString(record.name, `${itemPath}.name`),
      email: requiredNonEmptyString(record.email, `${itemPath}.email`),
    };
  });
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

function optionalArray<Item>(
  value: unknown,
  pathName: string,
  normalizeItem: (value: unknown, pathName: string) => Item,
): Item[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName} must be an array`);
  }

  return value.map((item, index) =>
    normalizeItem(item, `${pathName}[${index}]`),
  );
}

function uniqueValues<Value>(values: Value[]): Value[] {
  return [...new Set(values)];
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
  const prefix = stripTrailingSlashes(requiredNonEmptyString(value, pathName));
  if (prefix.length === 0 || /\s/u.test(prefix) || prefix.startsWith("/")) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a relative Git branch prefix without whitespace`,
    );
  }
  return prefix;
}

function validateBranchIntentPrefix(
  value: unknown,
  pathName: string,
): string {
  const prefix = stripTrailingSlashes(requiredNonEmptyString(value, pathName));
  if (
    prefix.length === 0 ||
    prefix.includes("/") ||
    prefix === "." ||
    prefix === ".." ||
    /\s/u.test(prefix)
  ) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a single Git branch prefix segment without whitespace`,
    );
  }
  return prefix;
}

function validateFeatureBranchPattern(
  value: unknown,
  pathName: string,
  requiredPlaceholders: string[],
  forbiddenPlaceholders: string[],
  defaultPattern: string,
): string {
  const pattern = value === undefined
    ? defaultPattern
    : requiredNonEmptyString(value, pathName);
  if (pattern.startsWith("/") || pattern.includes("..") || /\s/u.test(pattern)) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a relative Git branch pattern without whitespace or parent traversal`,
    );
  }
  for (const placeholder of requiredPlaceholders) {
    if (!pattern.includes(`{${placeholder}}`)) {
      throw new NexusAutomationConfigError(
        `${pathName} must include {${placeholder}}`,
      );
    }
  }
  for (const placeholder of forbiddenPlaceholders) {
    if (pattern.includes(`{${placeholder}}`)) {
      throw new NexusAutomationConfigError(
        `${pathName} must not include {${placeholder}}`,
      );
    }
  }
  return stripTrailingSlashes(pattern);
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

function optionalReleaseTrainField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationReleaseTrainConfig | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  return {
    [key]: validateReleaseTrainConfig(value, `${pathName}.${key}`),
  } as Record<Key, NexusAutomationReleaseTrainConfig>;
}

function validateReleaseTrainConfig(
  value: unknown,
  pathName: string,
): NexusAutomationReleaseTrainConfig {
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName) ??
    defaultNexusAutomationReleaseTrainConfig.enabled;
  const activeVersionId = optionalNullableString(
    record.activeVersionId,
    `${pathName}.activeVersionId`,
  ) ?? defaultNexusAutomationReleaseTrainConfig.activeVersionId;
  const branchNaming = validateReleaseTrainBranchNaming(
    record.branchNaming,
    `${pathName}.branchNaming`,
  );
  const featureBranchDelivery = record.featureBranchDelivery === undefined
    ? undefined
    : validateFeatureBranchDeliveryConfig(
        record.featureBranchDelivery,
        `${pathName}.featureBranchDelivery`,
      );
  const ciTiers = record.ciTiers === undefined
    ? undefined
    : validateNexusCiTierPolicyConfig(record.ciTiers, `${pathName}.ciTiers`);
  const selector = validateReleaseTrainSelector(
    record.selector,
    `${pathName}.selector`,
  );

  return {
    enabled,
    activeVersionId,
    branchNaming,
    ...(featureBranchDelivery !== undefined ? { featureBranchDelivery } : {}),
    ...(ciTiers !== undefined ? { ciTiers } : {}),
    selector,
  };
}

function validateFeatureBranchDeliveryConfig(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryConfig | null {
  if (value === null) {
    return null;
  }
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName) ??
    defaultNexusFeatureBranchDeliveryConfig.enabled;
  const activeFeatureId = optionalNullableString(
    record.activeFeatureId,
    `${pathName}.activeFeatureId`,
  ) ?? defaultNexusFeatureBranchDeliveryConfig.activeFeatureId;
  const allowedBranchStrategies = validateAllowedFeatureBranchStrategies(
    record.allowedBranchStrategies,
    `${pathName}.allowedBranchStrategies`,
  );
  const defaultBranchStrategy = record.defaultBranchStrategy === undefined
    ? defaultNexusFeatureBranchDeliveryConfig.defaultBranchStrategy
    : validateFeatureBranchDeliveryBranchStrategy(
        record.defaultBranchStrategy,
        `${pathName}.defaultBranchStrategy`,
      );
  if (!allowedBranchStrategies.includes(defaultBranchStrategy)) {
    throw new NexusAutomationConfigError(
      `${pathName}.defaultBranchStrategy must be included in allowedBranchStrategies`,
    );
  }

  return {
    enabled,
    activeFeatureId,
    defaultBranchStrategy,
    allowedBranchStrategies,
    branchNaming: validateFeatureBranchDeliveryBranchNaming(
      record.branchNaming,
      `${pathName}.branchNaming`,
    ),
    review: validateFeatureBranchDeliveryReview(
      record.review,
      `${pathName}.review`,
    ),
    provider: validateFeatureBranchDeliveryProvider(
      record.provider,
      `${pathName}.provider`,
    ),
    branchPublication: validateFeatureBranchDeliveryBranchPublication(
      record.branchPublication,
      `${pathName}.branchPublication`,
    ),
  };
}

function validateAllowedFeatureBranchStrategies(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryBranchStrategy[] {
  const branchStrategies = value === undefined
    ? [...defaultNexusFeatureBranchDeliveryConfig.allowedBranchStrategies]
    : optionalArray(value, pathName, validateFeatureBranchDeliveryBranchStrategy);
  if (branchStrategies.length === 0) {
    throw new NexusAutomationConfigError(`${pathName} must not be empty`);
  }
  return uniqueValues(branchStrategies);
}

function validateFeatureBranchDeliveryBranchNaming(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryBranchNamingConfig {
  if (value === undefined) {
    return {
      defaultIntentPrefix:
        defaultNexusFeatureBranchDeliveryConfig.branchNaming.defaultIntentPrefix,
      allowedIntentPrefixes: [
        ...defaultNexusFeatureBranchDeliveryConfig.branchNaming.allowedIntentPrefixes,
      ],
      featureBranchPattern:
        defaultNexusFeatureBranchDeliveryConfig.branchNaming.featureBranchPattern,
      reviewBranchPattern:
        defaultNexusFeatureBranchDeliveryConfig.branchNaming.reviewBranchPattern,
    };
  }
  const record = assertRecord(value, pathName);
  const allowedIntentPrefixes = record.allowedIntentPrefixes === undefined
    ? [...defaultNexusFeatureBranchDeliveryConfig.branchNaming.allowedIntentPrefixes]
    : uniqueValues(optionalArray(
        record.allowedIntentPrefixes,
        `${pathName}.allowedIntentPrefixes`,
        validateBranchIntentPrefix,
      ));
  if (allowedIntentPrefixes.length === 0) {
    throw new NexusAutomationConfigError(
      `${pathName}.allowedIntentPrefixes must not be empty`,
    );
  }
  const defaultIntentPrefix = record.defaultIntentPrefix === undefined
    ? defaultNexusFeatureBranchDeliveryConfig.branchNaming.defaultIntentPrefix
    : validateBranchIntentPrefix(
        record.defaultIntentPrefix,
        `${pathName}.defaultIntentPrefix`,
      );
  if (!allowedIntentPrefixes.includes(defaultIntentPrefix)) {
    throw new NexusAutomationConfigError(
      `${pathName}.defaultIntentPrefix must be included in allowedIntentPrefixes`,
    );
  }

  return {
    defaultIntentPrefix,
    allowedIntentPrefixes,
    featureBranchPattern: validateFeatureBranchPattern(
      record.featureBranchPattern,
      `${pathName}.featureBranchPattern`,
      ["intent", "feature"],
      ["change"],
      defaultNexusFeatureBranchDeliveryConfig.branchNaming.featureBranchPattern,
    ),
    reviewBranchPattern: validateFeatureBranchPattern(
      record.reviewBranchPattern,
      `${pathName}.reviewBranchPattern`,
      ["intent", "feature", "change"],
      [],
      defaultNexusFeatureBranchDeliveryConfig.branchNaming.reviewBranchPattern,
    ),
  };
}

function validateFeatureBranchDeliveryReview(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryReviewConfig {
  if (value === undefined) {
    return { ...defaultNexusFeatureBranchDeliveryConfig.review };
  }
  const record = assertRecord(value, pathName);
  return {
    mode: record.mode === undefined
      ? defaultNexusFeatureBranchDeliveryConfig.review.mode
      : validateFeatureBranchDeliveryReviewMode(record.mode, `${pathName}.mode`),
    finalPullRequest:
      optionalBoolean(record, "finalPullRequest", pathName) ??
      defaultNexusFeatureBranchDeliveryConfig.review.finalPullRequest,
    finalPullRequestCreation: record.finalPullRequestCreation === undefined
      ? defaultNexusFeatureBranchDeliveryConfig.review.finalPullRequestCreation
      : validateFeatureBranchDeliveryFinalPullRequestCreationPolicy(
          record.finalPullRequestCreation,
          `${pathName}.finalPullRequestCreation`,
        ),
  };
}

function validateFeatureBranchDeliveryFinalPullRequestCreationPolicy(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryFinalPullRequestCreationPolicy {
  if (
    value === "at_feature_start" ||
    value === "at_review_gate" ||
    value === "manual_only"
  ) {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be at_feature_start, at_review_gate, or manual_only`,
  );
}

function validateFeatureBranchDeliveryProvider(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryProviderConfig {
  if (value === undefined) {
    return { ...defaultNexusFeatureBranchDeliveryConfig.provider };
  }
  const record = assertRecord(value, pathName);
  return {
    commentPolicy: record.commentPolicy === undefined
      ? defaultNexusFeatureBranchDeliveryConfig.provider.commentPolicy
      : validateFeatureBranchDeliveryCommentPolicy(
          record.commentPolicy,
          `${pathName}.commentPolicy`,
        ),
  };
}

function validateFeatureBranchDeliveryBranchPublication(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryBranchPublicationConfig {
  if (value === undefined) {
    return { ...defaultNexusFeatureBranchDeliveryConfig.branchPublication };
  }
  const record = assertRecord(value, pathName);
  const strategy = record.strategy === undefined
    ? defaultNexusFeatureBranchDeliveryConfig.branchPublication.strategy
    : validateFeatureBranchDeliveryBranchPublicationStrategy(
        record.strategy,
        `${pathName}.strategy`,
      );
  const fallbackRemote = validateFeatureBranchDeliveryRemoteName(
    optionalNullableString(record.fallbackRemote, `${pathName}.fallbackRemote`) ??
      defaultNexusFeatureBranchDeliveryConfig.branchPublication.fallbackRemote,
    `${pathName}.fallbackRemote`,
  );
  if (
    (strategy === "fallback_remote" ||
      strategy === "push_remote_then_fallback") &&
    !fallbackRemote
  ) {
    throw new NexusAutomationConfigError(
      `${pathName}.fallbackRemote is required when strategy is ${strategy}`,
    );
  }

  return {
    strategy,
    fallbackRemote,
  };
}

function validateFeatureBranchDeliveryBranchPublicationStrategy(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryBranchPublicationStrategy {
  if (
    value === "push_remote" ||
    value === "fallback_remote" ||
    value === "push_remote_then_fallback" ||
    value === "manual_only"
  ) {
    return value;
  }
  throw new NexusAutomationConfigError(
    `${pathName} must be push_remote, fallback_remote, push_remote_then_fallback, or manual_only`,
  );
}

function validateFeatureBranchDeliveryRemoteName(
  value: string | null | undefined,
  pathName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const remote = value.trim();
  if (remote.length === 0 || /\s/u.test(remote)) {
    throw new NexusAutomationConfigError(
      `${pathName} must be a Git remote name without whitespace`,
    );
  }
  return remote;
}

function validateReleaseTrainBranchNaming(
  value: unknown,
  pathName: string,
): NexusAutomationReleaseTrainBranchNamingConfig {
  if (value === undefined) {
    return { ...defaultNexusAutomationReleaseTrainConfig.branchNaming };
  }
  const record = assertRecord(value, pathName);
  return {
    integrationPrefix:
      optionalBranchPrefix(record.integrationPrefix, `${pathName}.integrationPrefix`) ??
      defaultNexusAutomationReleaseTrainConfig.branchNaming.integrationPrefix,
    candidatePrefix:
      optionalBranchPrefix(record.candidatePrefix, `${pathName}.candidatePrefix`) ??
      defaultNexusAutomationReleaseTrainConfig.branchNaming.candidatePrefix,
    unscopedName:
      optionalBranchSegment(record.unscopedName, `${pathName}.unscopedName`) ??
      defaultNexusAutomationReleaseTrainConfig.branchNaming.unscopedName,
  };
}

function validateReleaseTrainSelector(
  value: unknown,
  pathName: string,
): NexusAutomationReleaseTrainSelectorConfig {
  if (value === undefined) {
    return {
      statuses: [...defaultNexusAutomationReleaseTrainConfig.selector.statuses],
      labels: [...defaultNexusAutomationReleaseTrainConfig.selector.labels],
      milestones: [...defaultNexusAutomationReleaseTrainConfig.selector.milestones],
      assignees: [...defaultNexusAutomationReleaseTrainConfig.selector.assignees],
      providerQuery:
        defaultNexusAutomationReleaseTrainConfig.selector.providerQuery,
    };
  }
  const record = assertRecord(value, pathName);
  return {
    statuses: optionalArrayField(
      record,
      "statuses",
      pathName,
      validateWorkStatus,
    ).statuses ?? [...defaultNexusAutomationReleaseTrainConfig.selector.statuses],
    labels: optionalArrayField(
      record,
      "labels",
      pathName,
      requiredNonEmptyString,
    ).labels ?? [...defaultNexusAutomationReleaseTrainConfig.selector.labels],
    milestones: optionalArrayField(
      record,
      "milestones",
      pathName,
      requiredNonEmptyString,
    ).milestones ?? [...defaultNexusAutomationReleaseTrainConfig.selector.milestones],
    assignees: optionalArrayField(
      record,
      "assignees",
      pathName,
      requiredNonEmptyString,
    ).assignees ?? [...defaultNexusAutomationReleaseTrainConfig.selector.assignees],
    providerQuery:
      optionalNullableString(record.providerQuery, `${pathName}.providerQuery`) ??
      defaultNexusAutomationReleaseTrainConfig.selector.providerQuery,
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

function validateFeatureBranchDeliveryBranchStrategy(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryBranchStrategy {
  if (
    value === "direct" ||
    value === "stacked" ||
    value === "feature_branch" ||
    value === "hybrid" ||
    value === "throwaway_rehearsal"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be direct, stacked, feature_branch, hybrid, or throwaway_rehearsal`,
  );
}

function validateFeatureBranchDeliveryReviewMode(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryReviewMode {
  if (
    value === "review_branch_pr" ||
    value === "commit_pr" ||
    value === "batch_pr"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be review_branch_pr, commit_pr, or batch_pr`,
  );
}

function validateFeatureBranchDeliveryCommentPolicy(
  value: unknown,
  pathName: string,
): NexusFeatureBranchDeliveryCommentPolicy {
  if (
    value === "silent" ||
    value === "status_only" ||
    value === "comments_allowed"
  ) {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be silent, status_only, or comments_allowed`,
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
