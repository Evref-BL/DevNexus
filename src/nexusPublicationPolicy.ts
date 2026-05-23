import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import type {
  GitCommandResult,
  GitRunner,
} from "./gitWorktreeService.js";
import {
  defaultGitRunner,
} from "./gitWorktreeService.js";
import { resolveNexusCommandPath } from "./nexusCommandPath.js";
import {
  stripHttpScheme,
  stripTrailingSlashes,
} from "./nexusTextNormalization.js";
import {
  resolveNexusCurrentAutomationActor,
  resolveNexusEffectiveAuthority,
  type NexusAuthorityAction,
  type NexusAuthorityProviderChecksSignal,
  type NexusAuthorityProviderState,
  type NexusEffectiveAuthorityResolution,
} from "./nexusAuthority.js";
import {
  defaultNexusAutomationGreenMainConfig,
  defaultNexusAutomationConfig,
  normalizeNexusAutomationPublicationConfig,
  summarizeNexusAutomationPublicationPolicy,
  type NexusAutomationPublicationConfig,
  type NexusAutomationPublicationPolicySummary,
  type NexusPublicationActorConfig,
} from "./nexusAutomationConfig.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import type { NexusResolvedProviderCredential } from "./nexusProviderCredentialBroker.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";
import type { ResolvedNexusProjectComponent } from "./nexusProjectLifecycle.js";
import {
  compareGitIdentity,
  gitIdentityEnvironment,
  readObservedGitIdentity,
  resolveExpectedAutomationGitIdentity,
  type NexusGitIdentityStatus,
} from "./nexusGitIdentity.js";

export type NexusPublicationGuardAction =
  | "status"
  | "git_push"
  | "provider_write"
  | "provider_pull_request_merge"
  | "provider_review_approve"
  | "package_publish"
  | "release_publish";

export interface NexusPublicationCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NexusPublicationActorRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => NexusPublicationCommandResult;

export type NexusPublicationGitPushTransport =
  | "configured_remote"
  | "https_token";

export interface NexusPublicationGitPushPlan {
  command: "git";
  cwd: string;
  args: string[];
  redactedArgs: string[];
  environment: Record<string, string>;
  redactedEnvironment: Record<string, string>;
  secretEnvironmentKeys: string[];
  transport: NexusPublicationGitPushTransport;
  remote: string;
  refspec: string;
  branch: string;
  targetBranch: string | null;
  forceWithLease: boolean;
  forceWithLeaseExpectedCommit: string | null;
}

export interface NexusPublicationGitPushInvocation {
  plan: NexusPublicationGitPushPlan;
  secretEnvironment: Record<string, string>;
}

export type NexusPublicationGitPushRunner = (
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => GitCommandResult;

export interface NexusPublicationGitPushResult {
  plan: NexusPublicationGitPushPlan;
  git: GitCommandResult;
}

export interface NexusPublicationGitStatus {
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  pushUrl: string | null;
  targetBranch: string | null;
  warnings: string[];
}

export type NexusPublicationActorStatusKind =
  | "not_configured"
  | "matched"
  | "mismatched"
  | "unchecked"
  | "unavailable";

export interface NexusPublicationObservedActor {
  provider: string;
  handle: string;
  source: string;
}

export interface NexusPublicationActorStatus {
  status: NexusPublicationActorStatusKind;
  expected: NexusPublicationActorConfig | null;
  observed: NexusPublicationObservedActor | null;
  commandEnvironment: Record<string, string>;
  message: string;
}

export interface NexusPublicationPolicyCheck {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export type NexusPublicationScope = "workspace" | "component";

export type NexusGreenMainCandidateStatus =
  | "not_on_candidate_branch"
  | "candidate_branch_local"
  | "candidate_branch_pushed";
export type NexusGreenMainChecksStatus =
  | "not_required"
  | "unknown"
  | "pending"
  | "green"
  | "stale"
  | "failed";
export type NexusGreenMainMergeabilityStatus =
  | "not_applicable"
  | "unknown"
  | "clear"
  | "blocked";
export type NexusGreenMainHandoffStatus =
  | "not_ready"
  | "ready_for_handoff"
  | "merge_authority_required"
  | "merge_authorized";

export interface NexusGreenMainPublicationStatus {
  candidate: {
    status: NexusGreenMainCandidateStatus;
    branch: string | null;
    upstream: string | null;
    message: string;
  };
  checks: {
    status: NexusGreenMainChecksStatus;
    source: "branch" | "pull_request";
    requiredChecks: string[];
    staleChecks: "block" | "allow";
    message: string;
  };
  mergeability: {
    status: NexusGreenMainMergeabilityStatus;
    message: string;
  };
  handoff: {
    status: NexusGreenMainHandoffStatus;
    mergeAuthority: "handoff" | "authorized_merge";
    message: string;
  };
  mergeAuthority: NexusEffectiveAuthorityResolution | null;
  summary: string;
}

export interface NexusPublicationStatus {
  scope: NexusPublicationScope;
  componentId: string | null;
  sourceRoot: string;
  action: NexusPublicationGuardAction;
  policy: NexusAutomationPublicationConfig;
  policySummary: NexusAutomationPublicationPolicySummary;
  greenMain: NexusGreenMainPublicationStatus | null;
  git: NexusPublicationGitStatus;
  gitIdentity: NexusGitIdentityStatus;
  actor: NexusPublicationActorStatus;
  authority: NexusEffectiveAuthorityResolution | null;
  checks: NexusPublicationPolicyCheck[];
  blocking: boolean;
  warnings: string[];
}

interface NexusPublicationTarget {
  scope: NexusPublicationScope;
  componentId: string | null;
  label: string;
  sourceRoot: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  trackerId: string | null;
  workTracking: { provider?: string; host?: string | null } | null;
}

export class NexusPublicationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusPublicationPolicyError";
  }
}

export function resolveNexusPublicationPolicy(
  projectConfig: NexusProjectConfig,
  component?: Pick<ResolvedNexusProjectComponent, "publication">,
): NexusAutomationPublicationConfig {
  const projectPublication =
    projectConfig.automation?.publication ??
    defaultNexusAutomationConfig.publication;
  const componentPublication = component?.publication ?? {};

  const hasComponentGreenMain = Object.prototype.hasOwnProperty.call(
    componentPublication,
    "greenMain",
  );
  const hasComponentReleaseTrain = Object.prototype.hasOwnProperty.call(
    componentPublication,
    "releaseTrain",
  );
  const hasProjectReleaseTrain = Object.prototype.hasOwnProperty.call(
    projectPublication,
    "releaseTrain",
  );
  const merged: NexusAutomationPublicationConfig = {
    ...defaultNexusAutomationConfig.publication,
    ...projectPublication,
    ...componentPublication,
    actor:
      Object.prototype.hasOwnProperty.call(componentPublication, "actor")
        ? componentPublication.actor ?? null
        : projectPublication.actor ?? null,
    manualActor:
      Object.prototype.hasOwnProperty.call(componentPublication, "manualActor")
        ? componentPublication.manualActor ?? null
        : projectPublication.manualActor ?? null,
    commandEnvironment: {
      ...defaultNexusAutomationConfig.publication.commandEnvironment,
      ...projectPublication.commandEnvironment,
      ...componentPublication.commandEnvironment,
    },
    greenMain: hasComponentGreenMain
      ? componentPublication.greenMain ?? null
      : projectPublication.greenMain ?? null,
    ...(hasComponentReleaseTrain
      ? { releaseTrain: componentPublication.releaseTrain ?? null }
      : hasProjectReleaseTrain
        ? { releaseTrain: projectPublication.releaseTrain ?? null }
        : {}),
  };

  return normalizeNexusAutomationPublicationConfig(
    merged,
    "resolved publication policy",
  );
}

function publicationTargetForComponent(
  component: ResolvedNexusProjectComponent,
): NexusPublicationTarget {
  return {
    scope: "component",
    componentId: component.id,
    label: component.id,
    sourceRoot: component.sourceRoot,
    remoteUrl: component.remoteUrl,
    defaultBranch: component.defaultBranch,
    trackerId: component.defaultTrackerId,
    workTracking: component.workTracking ?? null,
  };
}

function publicationTargetForWorkspace(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusPublicationTarget {
  return {
    scope: "workspace",
    componentId: null,
    label: "workspace",
    sourceRoot: path.resolve(projectRoot),
    remoteUrl: projectConfig.repo.remoteUrl,
    defaultBranch: projectConfig.repo.defaultBranch,
    trackerId: null,
    workTracking: projectConfig.workTracking ?? null,
  };
}

export function getNexusPublicationStatus(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  action?: NexusPublicationGuardAction;
  authProfiles?: NexusHostingAuthProfileConfig[];
  homePath?: string;
  providerState?: NexusAuthorityProviderState | null;
  gitRunner?: GitRunner;
  actorRunner?: NexusPublicationActorRunner;
  env?: NodeJS.ProcessEnv;
}): NexusPublicationStatus {
  return getNexusPublicationStatusForTarget({
    ...options,
    target: publicationTargetForComponent(options.component),
    policy: resolveNexusPublicationPolicy(
      options.projectConfig,
      options.component,
    ),
  });
}

export function getNexusWorkspacePublicationStatus(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  action?: NexusPublicationGuardAction;
  authProfiles?: NexusHostingAuthProfileConfig[];
  homePath?: string;
  providerState?: NexusAuthorityProviderState | null;
  gitRunner?: GitRunner;
  actorRunner?: NexusPublicationActorRunner;
  env?: NodeJS.ProcessEnv;
}): NexusPublicationStatus {
  return getNexusPublicationStatusForTarget({
    ...options,
    target: publicationTargetForWorkspace(
      options.projectRoot,
      options.projectConfig,
    ),
    policy: resolveNexusPublicationPolicy(options.projectConfig),
  });
}

function getNexusPublicationStatusForTarget(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  target: NexusPublicationTarget;
  policy: NexusAutomationPublicationConfig;
  action?: NexusPublicationGuardAction;
  authProfiles?: NexusHostingAuthProfileConfig[];
  homePath?: string;
  providerState?: NexusAuthorityProviderState | null;
  gitRunner?: GitRunner;
  actorRunner?: NexusPublicationActorRunner;
  env?: NodeJS.ProcessEnv;
}): NexusPublicationStatus {
  const action = options.action ?? "status";
  const git = readPublicationGitStatus({
    target: options.target,
    projectConfig: options.projectConfig,
    policy: options.policy,
    gitRunner: options.gitRunner ?? defaultGitRunner,
  });
  const authProfiles =
    options.authProfiles ??
    loadNexusPublicationAuthProfiles({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      homePath: options.homePath,
    });
  const gitIdentity = readPublicationGitIdentityStatus({
    policy: options.policy,
    repositoryPath: git.repositoryPath ?? options.target.sourceRoot,
    gitRunner: options.gitRunner ?? defaultGitRunner,
    authProfiles,
  });
  const actor = readPublicationActorStatus({
    projectRoot: options.projectRoot,
    target: options.target,
    policy: options.policy,
    cwd: git.repositoryPath ?? options.target.sourceRoot,
    actorRunner: options.actorRunner ?? defaultPublicationActorRunner,
    baseEnv: options.env ?? process.env,
    authProfiles,
  });
  const authority = resolvePublicationAuthority({
    projectConfig: options.projectConfig,
    target: options.target,
    policy: options.policy,
    git,
    action,
    authProfiles,
    providerState: options.providerState ?? null,
  });
  const greenMain = greenMainPublicationStatus({
    projectConfig: options.projectConfig,
    target: options.target,
    policy: options.policy,
    git,
    authProfiles,
    providerState: options.providerState ?? null,
  });
  const strict = publicationPolicyRequiresGuard(options.policy, action);
  const checks = publicationPolicyChecks({
    target: options.target,
    policy: options.policy,
    git,
    gitIdentity,
    actor,
    authority,
    strict,
  });
  const warnings = [
    ...git.warnings,
    ...(gitIdentity.status === "unchecked" ||
    gitIdentity.status === "unavailable" ||
    gitIdentity.status === "mismatched"
      ? [gitIdentity.message]
      : []),
    ...(actor.status === "unchecked" || actor.status === "unavailable"
      ? [actor.message]
      : []),
    ...(authority && !authority.allowed && authority.fallbackSuggestion
      ? [authority.fallbackSuggestion]
      : []),
  ];

  return {
    scope: options.target.scope,
    componentId: options.target.componentId,
    sourceRoot: options.target.sourceRoot,
    action,
    policy: options.policy,
    policySummary: summarizeNexusAutomationPublicationPolicy(options.policy),
    greenMain,
    git,
    gitIdentity,
    actor,
    authority,
    checks,
    blocking: checks.some((check) => check.status === "failed"),
    warnings,
  };
}

export function getNexusPublicationStatuses(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  action?: NexusPublicationGuardAction;
  authProfiles?: NexusHostingAuthProfileConfig[];
  homePath?: string;
  providerState?: NexusAuthorityProviderState | null;
  gitRunner?: GitRunner;
  actorRunner?: NexusPublicationActorRunner;
  env?: NodeJS.ProcessEnv;
}): NexusPublicationStatus[] {
  return options.components.map((component) =>
    getNexusPublicationStatus({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      component,
      action: options.action,
      authProfiles: options.authProfiles,
      homePath: options.homePath,
      providerState: options.providerState,
      gitRunner: options.gitRunner,
      actorRunner: options.actorRunner,
      env: options.env,
    }),
  );
}

export function assertNexusPublicationGuard(status: NexusPublicationStatus): void {
  const failed = status.checks.filter((check) => check.status === "failed");
  if (failed.length === 0) {
    return;
  }

  throw new NexusPublicationPolicyError(
    failed.map((check) => check.message).join("; "),
  );
}

export function publicationPreflightChecks(
  statuses: NexusPublicationStatus[],
): NexusPublicationPolicyCheck[] {
  return statuses.flatMap((status) => status.checks);
}

export function publicationCommandEnvironment(
  policy: NexusAutomationPublicationConfig,
  options: { projectRoot?: string } = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(policy.commandEnvironment).map(([key, value]) => [
      key,
      resolvePublicationCommandEnvironmentValue(
        value,
        options.projectRoot ?? process.cwd(),
      ),
    ]),
  );
}

export function publicationProcessEnvironment(
  policy: NexusAutomationPublicationConfig,
  options: {
    baseEnv: NodeJS.ProcessEnv;
    projectRoot?: string;
    authProfiles?: NexusHostingAuthProfileConfig[];
  },
): NodeJS.ProcessEnv {
  const commandEnvironment = publicationCommandEnvironment(policy, {
    projectRoot: options.projectRoot,
  });
  const env: NodeJS.ProcessEnv = {
    ...options.baseEnv,
    ...commandEnvironment,
    ...gitIdentityEnvironment(
      resolveExpectedAutomationGitIdentity({
        publication: policy,
        authProfiles: options.authProfiles,
      }),
    ),
  };

  if (shouldUseIsolatedGitHubCliProfile(policy, commandEnvironment)) {
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    delete env.GH_ENTERPRISE_TOKEN;
    delete env.GITHUB_ENTERPRISE_TOKEN;
  }

  return env;
}

function resolvePublicationCommandEnvironmentValue(
  value: string,
  projectRoot: string,
): string {
  if (/^(projectRoot|projectParent|home|sourcesRoot):/u.test(value)) {
    return resolveNexusProjectPath({ projectRoot, value });
  }

  return value;
}

function shouldUseIsolatedGitHubCliProfile(
  policy: NexusAutomationPublicationConfig,
  commandEnvironment: Record<string, string>,
): boolean {
  return (
    policy.actor?.provider?.toLowerCase() === "github" &&
    Boolean(commandEnvironment.GH_CONFIG_DIR?.trim())
  );
}

export function publicationEnvironmentVariables(
  policy: NexusAutomationPublicationConfig,
): NodeJS.ProcessEnv {
  const policySummary = summarizeNexusAutomationPublicationPolicy(policy);
  return {
    DEV_NEXUS_PUBLICATION_STRATEGY: policy.strategy,
    DEV_NEXUS_PUBLICATION_MODE: policySummary.mode,
    DEV_NEXUS_PUBLICATION_REMOTE: policy.remote ?? "",
    DEV_NEXUS_PUBLICATION_TARGET_BRANCH: policy.targetBranch ?? "",
    DEV_NEXUS_PUBLICATION_INTEGRATION_PREFERENCE:
      policySummary.integrationPreference,
    DEV_NEXUS_PUBLICATION_INTEGRATION_BRANCH:
      policySummary.integrationBranch ?? "",
    DEV_NEXUS_PUBLICATION_DIRECT_TARGET_PUSH:
      policySummary.directTargetPush,
    DEV_NEXUS_PUBLICATION_MERGE_AUTHORITY:
      policySummary.mergeAuthority ?? "",
    DEV_NEXUS_PUBLICATION_REQUIRED_CHECKS:
      policySummary.requiredChecks.join(","),
    DEV_NEXUS_PUBLICATION_STALE_CHECKS:
      policySummary.staleChecks ?? "",
    DEV_NEXUS_PUBLICATION_ACTOR_KIND: policy.actor?.kind ?? "",
    DEV_NEXUS_PUBLICATION_ACTOR_PROVIDER: policy.actor?.provider ?? "",
    DEV_NEXUS_PUBLICATION_ACTOR_HANDLE: policy.actor?.handle ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_REMOTE: policy.manualRemote ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_KIND: policy.manualActor?.kind ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_PROVIDER:
      policy.manualActor?.provider ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_HANDLE:
      policy.manualActor?.handle ?? "",
    DEV_NEXUS_PUBLICATION_PACKAGE_PUBLISH: String(policy.packagePublish),
    DEV_NEXUS_PUBLICATION_RELEASE_PUBLISH: String(policy.releasePublish),
    DEV_NEXUS_PUBLICATION_COMMAND_ENV_KEYS: Object.keys(
      policy.commandEnvironment,
    )
      .sort((left, right) => left.localeCompare(right))
      .join(","),
  };
}

export function buildNexusPublicationGitPushPlan(options: {
  policy: NexusAutomationPublicationConfig;
  repositoryPath: string;
  branch: string;
  targetBranch?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  credential?: NexusResolvedProviderCredential | null;
  projectRoot?: string;
  authProfiles?: NexusHostingAuthProfileConfig[];
  remoteOverride?: string | null;
  preferConfiguredRemote?: boolean;
}): NexusPublicationGitPushPlan {
  return prepareNexusPublicationGitPush(options).plan;
}

export function prepareNexusPublicationGitPush(options: {
  policy: NexusAutomationPublicationConfig;
  repositoryPath: string;
  branch: string;
  targetBranch?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  credential?: NexusResolvedProviderCredential | null;
  projectRoot?: string;
  authProfiles?: NexusHostingAuthProfileConfig[];
  remoteOverride?: string | null;
  preferConfiguredRemote?: boolean;
}): NexusPublicationGitPushInvocation {
  const repositoryPath = path.resolve(
    requiredPublicationValue(options.repositoryPath, "repositoryPath"),
  );
  const branch = requiredPublicationValue(options.branch, "branch");
  const targetBranch = options.targetBranch?.trim() || null;
  const forceWithLease = options.forceWithLease ?? false;
  const forceWithLeaseExpectedCommit =
    options.forceWithLeaseExpectedCommit?.trim() || null;
  const refspec =
    targetBranch && targetBranch !== branch ? `${branch}:${targetBranch}` : branch;
  const forceWithLeaseArg = publicationForceWithLeaseArg({
    branch,
    targetBranch,
    forceWithLease,
    expectedCommit: forceWithLeaseExpectedCommit,
  });
  const environment = {
    ...publicationCommandEnvironment(options.policy, {
      projectRoot: options.projectRoot,
    }),
    ...gitIdentityEnvironment(
      resolveExpectedAutomationGitIdentity({
        publication: options.policy,
        authProfiles: options.authProfiles,
      }),
    ),
    GIT_TERMINAL_PROMPT: "0",
  };
  const credential = options.credential ?? null;
  if (
    options.preferConfiguredRemote !== true &&
    credential &&
    (credential.secret?.kind === "token" ||
      credential.kind === "github_app" ||
      credential.gitCredential?.protocol === "https")
  ) {
    return prepareTokenBackedGitPush({
      repositoryPath,
      branch,
      targetBranch,
      forceWithLease,
      forceWithLeaseExpectedCommit,
      forceWithLeaseArg,
      refspec,
      environment,
      credential,
    });
  }

  const remote = requiredPublicationValue(
    options.remoteOverride ??
      options.policy.remote ??
      defaultNexusAutomationConfig.publication.remote,
    "publication remote",
  );
  const args = [
    "push",
    ...(forceWithLeaseArg ? [forceWithLeaseArg] : []),
    remote,
    refspec,
  ];
  return {
    plan: {
      command: "git",
      cwd: repositoryPath,
      args,
      redactedArgs: [...args],
      environment,
      redactedEnvironment: { ...environment },
      secretEnvironmentKeys: [],
      transport: "configured_remote",
      remote,
      refspec,
      branch,
      targetBranch,
      forceWithLease,
      forceWithLeaseExpectedCommit,
    },
    secretEnvironment: {},
  };
}

export function pushNexusPublicationBranch(options: {
  policy: NexusAutomationPublicationConfig;
  repositoryPath: string;
  branch: string;
  targetBranch?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  credential?: NexusResolvedProviderCredential | null;
  projectRoot?: string;
  authProfiles?: NexusHostingAuthProfileConfig[];
  baseEnv?: NodeJS.ProcessEnv;
  gitRunner?: NexusPublicationGitPushRunner;
  remoteOverride?: string | null;
  preferConfiguredRemote?: boolean;
}): NexusPublicationGitPushResult {
  const invocation = prepareNexusPublicationGitPush(options);
  const gitRunner = options.gitRunner ?? defaultPublicationGitPushRunner;
  const result = gitRunner(invocation.plan.args, {
    cwd: invocation.plan.cwd,
    env: {
      ...(options.baseEnv ?? process.env),
      ...invocation.plan.environment,
      ...invocation.secretEnvironment,
    },
  });

  return {
    plan: invocation.plan,
    git: result,
  };
}

export function loadNexusPublicationAuthProfiles(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): NexusHostingAuthProfileConfig[] {
  const homePath = resolveNexusPublicationHomePath(options);
  try {
    return loadNexusHomeConfigFile(
      homePath,
      validateNexusHomeConfigBase,
    ).authProfiles ?? [];
  } catch {
    return [];
  }
}

export function resolveNexusPublicationHomePath(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): string {
  return options.homePath
    ? path.resolve(options.homePath)
    : options.projectConfig.home
      ? resolveNexusProjectPath({
          projectRoot: options.projectRoot,
          value: options.projectConfig.home,
        })
      : defaultNexusHomePath();
}

function greenMainPublicationStatus(options: {
  projectConfig: NexusProjectConfig;
  target: NexusPublicationTarget;
  policy: NexusAutomationPublicationConfig;
  git: NexusPublicationGitStatus;
  authProfiles: NexusHostingAuthProfileConfig[];
  providerState: NexusAuthorityProviderState | null;
}): NexusGreenMainPublicationStatus | null {
  if (options.policy.strategy !== "green_main") {
    return null;
  }
  const greenMain = {
    ...defaultNexusAutomationGreenMainConfig,
    ...(options.policy.greenMain ?? {}),
  };
  const candidate = greenMainCandidateStatus(options.git);
  const checks = greenMainChecksStatus({
    greenMain,
    providerState: options.providerState,
  });
  const mergeability = greenMainMergeabilityStatus(options.providerState);
  const mergeAuthority = resolvePublicationAuthority({
    projectConfig: options.projectConfig,
    target: options.target,
    policy: options.policy,
    git: options.git,
    action: "provider_pull_request_merge",
    authProfiles: options.authProfiles,
    providerState: options.providerState,
  });
  const handoff = greenMainHandoffStatus({
    candidate,
    checks,
    mergeability,
    mergeAuthority,
    mergeAuthorityPolicy: greenMain.mergeAuthority,
  });

  return {
    candidate,
    checks,
    mergeability,
    handoff,
    mergeAuthority,
    summary: [
      `candidate=${candidate.status}`,
      `checks=${checks.status}`,
      `mergeability=${mergeability.status}`,
      `handoff=${handoff.status}`,
      `mergeAuthority=${greenMain.mergeAuthority}`,
    ].join(" "),
  };
}

function greenMainCandidateStatus(
  git: NexusPublicationGitStatus,
): NexusGreenMainPublicationStatus["candidate"] {
  if (!git.branch || git.branch === git.targetBranch) {
    return {
      status: "not_on_candidate_branch",
      branch: git.branch,
      upstream: git.upstream,
      message: git.branch
        ? `Current branch ${git.branch} is the target branch, not a green-main candidate branch.`
        : "No current branch was resolved for green-main candidate publication.",
    };
  }
  if (!git.upstream) {
    return {
      status: "candidate_branch_local",
      branch: git.branch,
      upstream: null,
      message: `Candidate branch ${git.branch} has no upstream; branch CI cannot be checked from provider signals yet.`,
    };
  }

  return {
    status: "candidate_branch_pushed",
    branch: git.branch,
    upstream: git.upstream,
    message: `Candidate branch ${git.branch} is pushed as ${git.upstream}.`,
  };
}

function greenMainChecksStatus(options: {
  greenMain: NonNullable<NexusAutomationPublicationConfig["greenMain"]>;
  providerState: NexusAuthorityProviderState | null;
}): NexusGreenMainPublicationStatus["checks"] {
  const signal = options.providerState?.pullRequest?.checks ?? "unknown";
  const source = options.greenMain.integrationPreference;
  const status = greenMainChecksStatusValue({
    signal,
    hasRequiredChecks: options.greenMain.requiredChecks.length > 0,
  });
  const requiredChecks = [...options.greenMain.requiredChecks];
  const checksLabel = requiredChecks.length > 0
    ? requiredChecks.join(", ")
    : "provider policy";

  return {
    status,
    source,
    requiredChecks,
    staleChecks: options.greenMain.staleChecks,
    message: greenMainChecksMessage({
      status,
      checksLabel,
      staleChecks: options.greenMain.staleChecks,
    }),
  };
}

function greenMainChecksStatusValue(options: {
  signal: NexusAuthorityProviderChecksSignal;
  hasRequiredChecks: boolean;
}): NexusGreenMainChecksStatus {
  if (!options.hasRequiredChecks && options.signal === "unknown") {
    return "not_required";
  }

  switch (options.signal) {
    case "checks_passed":
      return "green";
    case "checks_failed":
      return "failed";
    case "checks_stale":
      return "stale";
    case "checks_pending":
      return "pending";
    default:
      return "unknown";
  }
}

function greenMainChecksMessage(options: {
  status: NexusGreenMainChecksStatus;
  checksLabel: string;
  staleChecks: "block" | "allow";
}): string {
  switch (options.status) {
    case "green":
      return `Required checks are green: ${options.checksLabel}.`;
    case "failed":
      return `Required checks failed: ${options.checksLabel}.`;
    case "pending":
      return `Required checks are pending: ${options.checksLabel}.`;
    case "stale":
      return options.staleChecks === "block"
        ? `Required checks are stale and staleChecks=block: ${options.checksLabel}.`
        : `Required checks are stale but staleChecks=allow: ${options.checksLabel}.`;
    case "not_required":
      return "No explicit required checks or provider check signal are configured.";
    case "unknown":
      return `Required check state is unknown: ${options.checksLabel}.`;
  }
}

function greenMainMergeabilityStatus(
  providerState: NexusAuthorityProviderState | null,
): NexusGreenMainPublicationStatus["mergeability"] {
  const pullRequest = providerState?.pullRequest ?? null;
  const mergeability = pullRequest?.mergeability ?? "unknown";
  const branchPolicy =
    pullRequest?.branchPolicy ?? providerState?.branchPolicy ?? "unknown";
  if (mergeability === "merge_conflict") {
    return {
      status: "blocked",
      message: "Pull request has merge conflicts.",
    };
  }
  if (branchPolicy === "branch_policy_blocked") {
    return {
      status: "blocked",
      message: "Provider branch policy blocks integration.",
    };
  }
  if (mergeability === "mergeable" && branchPolicy === "clear") {
    return {
      status: "clear",
      message: "Pull request is mergeable and branch policy is clear.",
    };
  }
  if (mergeability === "mergeable" && branchPolicy === "unknown") {
    return {
      status: "unknown",
      message: "Pull request is mergeable but branch policy state is unknown.",
    };
  }

  return {
    status: "unknown",
    message: "Mergeability or branch policy state is unknown.",
  };
}

function greenMainHandoffStatus(options: {
  candidate: NexusGreenMainPublicationStatus["candidate"];
  checks: NexusGreenMainPublicationStatus["checks"];
  mergeability: NexusGreenMainPublicationStatus["mergeability"];
  mergeAuthority: NexusEffectiveAuthorityResolution | null;
  mergeAuthorityPolicy: "handoff" | "authorized_merge";
}): NexusGreenMainPublicationStatus["handoff"] {
  const ready =
    options.candidate.status === "candidate_branch_pushed" &&
    (options.checks.status === "green" ||
      (options.checks.status === "stale" &&
        options.checks.staleChecks === "allow")) &&
    options.mergeability.status === "clear";
  if (!ready) {
    return {
      status: "not_ready",
      mergeAuthority: options.mergeAuthorityPolicy,
      message: "Green-main candidate is not ready for integration handoff.",
    };
  }
  if (options.mergeAuthorityPolicy === "handoff") {
    return {
      status: "ready_for_handoff",
      mergeAuthority: options.mergeAuthorityPolicy,
      message:
        "Green-main candidate is validated; hand off to a human or maintainer for integration.",
    };
  }
  if (options.mergeAuthority?.allowed) {
    return {
      status: "merge_authorized",
      mergeAuthority: options.mergeAuthorityPolicy,
      message:
        "Green-main candidate is validated and the current actor is authorized to merge.",
    };
  }

  return {
    status: "merge_authority_required",
    mergeAuthority: options.mergeAuthorityPolicy,
    message:
      "Green-main candidate is validated, but the current actor lacks merge authority.",
  };
}

function readPublicationGitStatus(options: {
  target: NexusPublicationTarget;
  projectConfig: NexusProjectConfig;
  policy: NexusAutomationPublicationConfig;
  gitRunner: GitRunner;
}): NexusPublicationGitStatus {
  const repositoryPath = gitStdout(
    runOptionalGit(
      options.gitRunner,
      ["rev-parse", "--show-toplevel"],
      options.target.sourceRoot,
    ),
  );
  const warnings: string[] = [];
  if (!repositoryPath) {
    return {
      repositoryPath: null,
      branch: null,
      upstream: null,
      upstreamRemote: null,
      upstreamBranch: null,
      remoteName: options.policy.remote,
      remoteUrl: null,
      pushUrl: null,
      targetBranch:
        options.policy.targetBranch ??
        options.target.defaultBranch ??
        options.projectConfig.repo.defaultBranch,
      warnings: [
        `No Git repository could be resolved for ${options.target.scope} ${options.target.label}.`,
      ],
    };
  }

  const branch = gitStdout(
    runOptionalGit(
      options.gitRunner,
      ["symbolic-ref", "--short", "HEAD"],
      repositoryPath,
    ),
  );
  const upstream = gitStdout(
    runOptionalGit(
      options.gitRunner,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      repositoryPath,
    ),
  );
  const upstreamParts = splitUpstream(upstream);
  const remoteName =
    options.policy.remote ??
    upstreamParts.remote ??
    defaultNexusAutomationConfig.publication.remote;
  const remoteUrl = remoteName
    ? gitStdout(
        runOptionalGit(
          options.gitRunner,
          ["remote", "get-url", remoteName],
          repositoryPath,
        ),
      )
    : null;
  const pushUrl = remoteName
    ? gitStdout(
        runOptionalGit(
          options.gitRunner,
          ["remote", "get-url", "--push", remoteName],
          repositoryPath,
        ),
      ) ?? remoteUrl
    : null;
  if (!upstream) {
    warnings.push("Current branch has no upstream configured.");
  }
  if (upstreamParts.remote && remoteName && upstreamParts.remote !== remoteName) {
    warnings.push(
      `Current upstream uses remote ${upstreamParts.remote}, not configured publication remote ${remoteName}.`,
    );
  }

  return {
    repositoryPath,
    branch,
    upstream,
    upstreamRemote: upstreamParts.remote,
    upstreamBranch: upstreamParts.branch,
    remoteName,
    remoteUrl,
    pushUrl,
    targetBranch:
      options.policy.targetBranch ??
      upstreamParts.branch ??
      options.target.defaultBranch ??
      options.projectConfig.repo.defaultBranch,
    warnings,
  };
}

function readPublicationActorStatus(options: {
  projectRoot: string;
  target: NexusPublicationTarget;
  policy: NexusAutomationPublicationConfig;
  cwd: string;
  actorRunner: NexusPublicationActorRunner;
  baseEnv: NodeJS.ProcessEnv;
  authProfiles: NexusHostingAuthProfileConfig[];
}): NexusPublicationActorStatus {
  const expected = options.policy.actor;
  const commandEnvironment = publicationCommandEnvironment(options.policy, {
    projectRoot: options.projectRoot,
  });
  if (!expected) {
    return {
      status: "not_configured",
      expected: null,
      observed: null,
      commandEnvironment,
      message: "No automated publication actor is configured.",
    };
  }

  const provider = expected.provider?.toLowerCase() ?? null;
  if (provider !== "github") {
    return {
      status: "unchecked",
      expected,
      observed: null,
      commandEnvironment,
      message: `Publication actor provider ${expected.provider ?? "unknown"} is not checked by DevNexus core.`,
    };
  }

  const appProfileStatus = readGitHubAppActorStatusFromAuthProfile({
    expected,
    commandEnvironment,
    authProfiles: options.authProfiles,
  });
  if (appProfileStatus) {
    return appProfileStatus;
  }

  const host = githubActorHost(options.target);
  const args =
    expected.kind === "app"
      ? ["api", "app", "--jq", ".slug", "--hostname", host]
      : ["api", "user", "--jq", ".login", "--hostname", host];
  const result = options.actorRunner("gh", args, {
    cwd: options.cwd,
    env: publicationProcessEnvironment(options.policy, {
      baseEnv: options.baseEnv,
      projectRoot: options.projectRoot,
      authProfiles: options.authProfiles,
    }),
  });
  if (result.status !== 0 || result.error) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || result.error?.message;
    return {
      status: "unavailable",
      expected,
      observed: null,
      commandEnvironment,
      message: detail
        ? `Observed GitHub actor could not be checked: ${detail}`
        : "Observed GitHub actor could not be checked.",
    };
  }

  const handle = result.stdout.trim();
  if (!handle) {
    return {
      status: "unavailable",
      expected,
      observed: null,
      commandEnvironment,
      message: "Observed GitHub actor command returned an empty handle.",
    };
  }

  const observed = {
    provider: "github",
    handle,
    source: expected.kind === "app" ? "github_cli_app" : "github_cli_user",
  };
  const expectedHandle = expected.handle;
  if (!expectedHandle) {
    return {
      status: "unchecked",
      expected,
      observed,
      commandEnvironment,
      message: "Publication actor has no expected handle to compare.",
    };
  }

  const matched = handlesEqual(expectedHandle, observed.handle);
  return {
    status: matched ? "matched" : "mismatched",
    expected,
    observed,
    commandEnvironment,
    message: matched
      ? `Observed ${observed.provider} actor ${observed.handle} matches publication policy.`
      : `Observed ${observed.provider} actor ${observed.handle} does not match expected actor ${expectedHandle}.`,
  };
}

function readGitHubAppActorStatusFromAuthProfile(options: {
  expected: NexusPublicationActorConfig;
  commandEnvironment: Record<string, string>;
  authProfiles: NexusHostingAuthProfileConfig[];
}): NexusPublicationActorStatus | null {
  if (options.expected.kind !== "app") {
    return null;
  }
  const profiles = options.authProfiles.filter((profile) =>
    githubAppAuthProfileMatchesActor(profile, options.expected)
  );
  if (profiles.length === 0) {
    return null;
  }
  if (profiles.length > 1) {
    return {
      status: "unavailable",
      expected: options.expected,
      observed: null,
      commandEnvironment: options.commandEnvironment,
      message: `Multiple host-local GitHub App auth profiles can satisfy publication actor ${options.expected.handle ?? options.expected.id ?? "unknown"}: ${profiles.map((profile) => profile.id).join(", ")}.`,
    };
  }

  const profile = profiles[0]!;
  const handle =
    profile.githubApp?.slug?.trim() || profile.account?.trim() || null;
  if (!handle) {
    return {
      status: "unavailable",
      expected: options.expected,
      observed: null,
      commandEnvironment: options.commandEnvironment,
      message: `Host-local GitHub App auth profile ${profile.id} does not declare an App slug or account handle.`,
    };
  }

  const observed = {
    provider: "github",
    handle,
    source: `authProfile:${profile.id}`,
  };
  const expectedHandle = options.expected.handle;
  if (!expectedHandle) {
    return {
      status: "unchecked",
      expected: options.expected,
      observed,
      commandEnvironment: options.commandEnvironment,
      message: "Publication actor has no expected handle to compare.",
    };
  }

  const matched = handlesEqual(expectedHandle, observed.handle);
  return {
    status: matched ? "matched" : "mismatched",
    expected: options.expected,
    observed,
    commandEnvironment: options.commandEnvironment,
    message: matched
      ? `Host-local GitHub App auth profile ${profile.id} matches publication policy.`
      : `Host-local GitHub App auth profile ${profile.id} declares actor ${observed.handle}, not expected actor ${expectedHandle}.`,
  };
}

function githubAppAuthProfileMatchesActor(
  profile: NexusHostingAuthProfileConfig,
  expected: NexusPublicationActorConfig,
): boolean {
  if (!profileCanRepresentGitHubApp(profile)) {
    return false;
  }
  if (expected.id && profile.actorId === expected.id) {
    return true;
  }
  const handles = [profile.githubApp?.slug, profile.account]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Boolean(
    expected.handle &&
      handles.some((handle) => handlesEqual(handle, expected.handle!)),
  );
}

function profileCanRepresentGitHubApp(
  profile: NexusHostingAuthProfileConfig,
): boolean {
  return (
    profile.provider.toLowerCase() === "github" &&
    (profile.kind === "app" ||
      profile.credentialKind === "github_app" ||
      Boolean(profile.githubApp))
  );
}

function readPublicationGitIdentityStatus(options: {
  policy: NexusAutomationPublicationConfig;
  repositoryPath: string;
  gitRunner: GitRunner;
  authProfiles: NexusHostingAuthProfileConfig[];
}): NexusGitIdentityStatus {
  return compareGitIdentity({
    expected: resolveExpectedAutomationGitIdentity({
      publication: options.policy,
      authProfiles: options.authProfiles,
    }),
    observed: readObservedGitIdentity({
      repositoryPath: options.repositoryPath,
      gitRunner: options.gitRunner,
    }),
  });
}

export function publicationPolicyRequiresGuard(
  policy: NexusAutomationPublicationConfig,
  action: NexusPublicationGuardAction,
): boolean {
  return (
    action !== "status" ||
    policy.push ||
    policy.strategy === "green_main" ||
    policy.strategy === "direct_integration" ||
    Boolean(
      policy.remoteUrl ||
        policy.pushUrl ||
        policy.sshHostAlias ||
        policy.actor,
    )
  );
}

function publicationPolicyChecks(options: {
  target: NexusPublicationTarget;
  policy: NexusAutomationPublicationConfig;
  git: NexusPublicationGitStatus;
  gitIdentity: NexusGitIdentityStatus;
  actor: NexusPublicationActorStatus;
  authority: NexusEffectiveAuthorityResolution | null;
  strict: boolean;
}): NexusPublicationPolicyCheck[] {
  const checks: NexusPublicationPolicyCheck[] = [];
  const prefix = `publication:${options.target.label}`;
  const remoteName = options.policy.remote;
  if (remoteName && options.strict) {
    checks.push(
      check(
        `${prefix}:remote`,
        options.git.remoteName === remoteName && Boolean(options.git.remoteUrl),
        `Publication remote ${remoteName} is configured`,
        `Publication remote ${remoteName} is not available in ${options.target.sourceRoot}`,
      ),
    );
  }

  if (options.policy.remoteUrl) {
    checks.push(
      check(
        `${prefix}:remoteUrl`,
        matchesExpectedUrl(options.policy.remoteUrl, [
          options.git.remoteUrl,
          options.git.pushUrl,
        ]),
        `Publication remote URL matches ${options.policy.remoteUrl}`,
        `Publication remote URL mismatch for ${options.target.label}: expected ${options.policy.remoteUrl}, observed ${options.git.remoteUrl ?? "unknown"}`,
      ),
    );
  }

  if (options.policy.pushUrl) {
    checks.push(
      check(
        `${prefix}:pushUrl`,
        normalizeUrl(options.git.pushUrl) ===
          normalizeUrl(options.policy.pushUrl),
        `Publication push URL matches ${options.policy.pushUrl}`,
        `Publication push URL mismatch for ${options.target.label}: expected ${options.policy.pushUrl}, observed ${options.git.pushUrl ?? "unknown"}`,
      ),
    );
  }

  if (options.policy.sshHostAlias) {
    checks.push(
      check(
        `${prefix}:sshHostAlias`,
        [options.git.pushUrl, options.git.remoteUrl].some(
          (url) => sshHostAlias(url) === options.policy.sshHostAlias,
        ),
        `Publication SSH host alias matches ${options.policy.sshHostAlias}`,
        `Publication SSH host alias mismatch for ${options.target.label}: expected ${options.policy.sshHostAlias}, observed ${sshHostAlias(options.git.pushUrl ?? options.git.remoteUrl) ?? "unknown"}`,
      ),
    );
  }

  if (options.policy.actor && options.strict) {
    checks.push(
      check(
        `${prefix}:actor`,
        options.actor.status === "matched" || options.actor.status === "unchecked",
        options.actor.message,
        options.actor.message,
      ),
    );
    if (
      options.policy.actor.kind !== "human" &&
      options.gitIdentity.status !== "not_configured"
    ) {
      checks.push(
        check(
          `${prefix}:gitIdentity`,
          options.gitIdentity.status === "matched",
          options.gitIdentity.message,
          options.gitIdentity.message,
        ),
      );
    }
  }

  if (options.authority && options.strict) {
    const failedMessage = [
      options.authority.explanation,
      ...(options.authority.blockingReasons.length > 0
        ? [`Reasons: ${options.authority.blockingReasons.join(" ")}`]
        : []),
      ...(options.authority.fallbackSuggestion
        ? [`Fallback: ${options.authority.fallbackSuggestion}`]
        : []),
    ].join(" ");
    checks.push(
      check(
        `${prefix}:authority:${options.authority.requestedAction}`,
        options.authority.allowed,
        options.authority.explanation,
        failedMessage,
      ),
    );
  }

  return checks;
}

function resolvePublicationAuthority(options: {
  projectConfig: NexusProjectConfig;
  target: NexusPublicationTarget;
  policy: NexusAutomationPublicationConfig;
  git: NexusPublicationGitStatus;
  action: NexusPublicationGuardAction;
  authProfiles: NexusHostingAuthProfileConfig[];
  providerState: NexusAuthorityProviderState | null;
}): NexusEffectiveAuthorityResolution | null {
  const requestedAction = publicationAuthorityAction(
    options.action,
    options.policy,
  );
  if (!requestedAction) {
    return null;
  }

  const currentActor = resolveNexusCurrentAutomationActor({
    authority: options.projectConfig.authority,
    componentId: options.target.componentId,
    publication: options.policy,
    authProfiles: options.authProfiles,
    repository:
      options.target.remoteUrl ??
      options.git.pushUrl ??
      options.git.remoteUrl ??
      null,
  });
  const authProfile = currentActor.profileId
    ? options.authProfiles.find((profile) => profile.id === currentActor.profileId) ??
      null
    : null;

  return resolveNexusEffectiveAuthority({
    authority: options.projectConfig.authority,
    actor: {
      id: currentActor.expectedActorId,
      kind: currentActor.expectedActorKind,
      provider: currentActor.expectedProvider,
      providerIdentity: currentActor.expectedHandle,
    },
    authProfile: authProfile
      ? {
          id: authProfile.id,
          actorId: authProfile.actorId ?? null,
          kind: authProfile.kind ?? null,
          provider: authProfile.provider,
          account: authProfile.account ?? null,
        }
      : null,
    project: options.projectConfig.id,
    component: options.target.componentId,
    provider:
      options.policy.actor?.provider ??
      options.policy.manualActor?.provider ??
      currentActor.expectedProvider ??
      options.target.workTracking?.provider ??
      null,
    tracker: options.target.trackerId,
    remote: options.git.remoteName ?? options.policy.remote,
    repository:
      options.target.remoteUrl ??
      options.git.pushUrl ??
      options.git.remoteUrl ??
      null,
    targetBranch: options.git.targetBranch ?? options.policy.targetBranch,
    requestedAction,
    publication: options.policy,
    providerState: options.providerState,
  });
}

function publicationAuthorityAction(
  action: NexusPublicationGuardAction,
  policy: NexusAutomationPublicationConfig,
): NexusAuthorityAction | null {
  switch (action) {
    case "git_push":
      return "git.push_target_branch";
    case "provider_write":
      return "provider.pull_request.open";
    case "provider_pull_request_merge":
      return "provider.pull_request.merge";
    case "provider_review_approve":
      return "provider.review.approve";
    case "package_publish":
      return "package.publish";
    case "release_publish":
      return "release.publish";
    case "status":
      if (policy.strategy === "direct_integration" && policy.push) {
        return "git.push_target_branch";
      }
      if (policy.strategy === "green_main") {
        return "provider.pull_request.open";
      }
      if (policy.strategy !== "local_only") {
        return "provider.pull_request.open";
      }
      return null;
  }
}

function prepareTokenBackedGitPush(options: {
  repositoryPath: string;
  branch: string;
  targetBranch: string | null;
  forceWithLease: boolean;
  forceWithLeaseExpectedCommit: string | null;
  forceWithLeaseArg: string | null;
  refspec: string;
  environment: Record<string, string>;
  credential: NexusResolvedProviderCredential;
}): NexusPublicationGitPushInvocation {
  const token = options.credential.secret?.value;
  if (!token) {
    throw new NexusPublicationPolicyError(
      `Credential ${options.credential.profileId} does not include a token for Git push.`,
    );
  }
  if (
    options.credential.permissions?.contents &&
    !publicationPermissionSatisfies(options.credential.permissions.contents, "write")
  ) {
    throw new NexusPublicationPolicyError(
      `Credential ${options.credential.profileId} does not grant contents:write for Git push.`,
    );
  }

  const remote = gitRemoteUrlFromCredential(options.credential);
  const tokenEnvironmentKey = "DEV_NEXUS_GIT_TOKEN";
  const helper =
    `!f() { echo username=x-access-token; echo password="$${tokenEnvironmentKey}"; }; f`;
  const args = [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=${helper}`,
    "push",
    ...(options.forceWithLeaseArg ? [options.forceWithLeaseArg] : []),
    remote,
    options.refspec,
  ];
  return {
    plan: {
      command: "git",
      cwd: options.repositoryPath,
      args,
      redactedArgs: [...args],
      environment: options.environment,
      redactedEnvironment: {
        ...options.environment,
        [tokenEnvironmentKey]: "<redacted>",
      },
      secretEnvironmentKeys: [tokenEnvironmentKey],
      transport: "https_token",
      remote,
      refspec: options.refspec,
      branch: options.branch,
      targetBranch: options.targetBranch,
      forceWithLease: options.forceWithLease,
      forceWithLeaseExpectedCommit: options.forceWithLeaseExpectedCommit,
    },
    secretEnvironment: {
      [tokenEnvironmentKey]: token,
    },
  };
}

function gitRemoteUrlFromCredential(
  credential: NexusResolvedProviderCredential,
): string {
  const gitCredential = credential.gitCredential;
  if (!gitCredential) {
    throw new NexusPublicationPolicyError(
      `Credential ${credential.profileId} does not include a Git transport descriptor.`,
    );
  }
  if (gitCredential.protocol !== "https") {
    throw new NexusPublicationPolicyError(
      `Credential ${credential.profileId} uses ${gitCredential.protocol} Git transport; token-backed publication requires https.`,
    );
  }
  const host = stripTrailingSlashes(
    stripHttpScheme(gitCredential.host.trim()),
  );
  const repositoryPath = gitCredential.path?.trim();
  if (!host || !repositoryPath) {
    throw new NexusPublicationPolicyError(
      `Credential ${credential.profileId} must include Git host and repository path for token-backed publication.`,
    );
  }
  const normalizedPath = repositoryPath
    .replace(/^\/+/u, "")
    .replace(/\.git$/u, "");
  if (!normalizedPath.includes("/")) {
    throw new NexusPublicationPolicyError(
      `Credential ${credential.profileId} has an invalid Git repository path: ${repositoryPath}.`,
    );
  }

  return `https://${host}/${normalizedPath}.git`;
}

function publicationPermissionSatisfies(
  granted: string | undefined,
  required: string,
): boolean {
  if (!granted) {
    return false;
  }
  const levels = ["none", "read", "write", "admin"];
  const grantedLevel = levels.indexOf(granted);
  const requiredLevel = levels.indexOf(required);
  if (grantedLevel === -1 || requiredLevel === -1) {
    return granted === required;
  }
  return grantedLevel >= requiredLevel;
}

function publicationForceWithLeaseArg(options: {
  branch: string;
  targetBranch: string | null;
  forceWithLease: boolean;
  expectedCommit: string | null;
}): string | null {
  if (!options.forceWithLease && !options.expectedCommit) {
    return null;
  }
  if (!options.expectedCommit) {
    return "--force-with-lease";
  }
  const destinationBranch = options.targetBranch || options.branch;
  const destinationRef = destinationBranch.startsWith("refs/")
    ? destinationBranch
    : `refs/heads/${destinationBranch}`;
  return `--force-with-lease=${destinationRef}:${options.expectedCommit}`;
}

function defaultPublicationGitPushRunner(
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): GitCommandResult {
  const result = spawnSync(
    resolveNexusCommandPath("git", options.env),
    [...args],
    {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );

  return {
    args: [...args],
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
}

function defaultPublicationActorRunner(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): NexusPublicationCommandResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function runOptionalGit(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result : null;
  } catch {
    return null;
  }
}

function gitStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout.trim();
  return value ? value : null;
}

function splitUpstream(
  upstream: string | null,
): { remote: string | null; branch: string | null } {
  if (!upstream) {
    return { remote: null, branch: null };
  }
  const separator = upstream.indexOf("/");
  if (separator <= 0 || separator === upstream.length - 1) {
    return { remote: null, branch: upstream };
  }

  return {
    remote: upstream.slice(0, separator),
    branch: upstream.slice(separator + 1),
  };
}

function matchesExpectedUrl(expected: string, observed: Array<string | null>): boolean {
  const normalizedExpected = normalizeUrl(expected);
  return observed.some((value) => normalizeUrl(value) === normalizedExpected);
}

function normalizeUrl(value: string | null): string | null {
  const normalized = value ? stripTrailingSlashes(value.trim()) : "";
  return normalized || null;
}

function sshHostAlias(value: string | null): string | null {
  const remote = value?.trim();
  if (!remote) {
    return null;
  }
  const scpLike = /^[^@\s]+@([^:\s]+):/u.exec(remote);
  if (scpLike?.[1]) {
    return scpLike[1];
  }
  try {
    const url = new URL(remote);
    return url.hostname || null;
  } catch {
    return null;
  }
}

function githubActorHost(target: NexusPublicationTarget): string {
  const host = target.workTracking?.host?.trim();
  if (!host || host === "https://github.com" || host === "api.github.com") {
    return "github.com";
  }
  const normalized = stripTrailingSlashes(stripHttpScheme(host));
  return normalized.startsWith("api.") ? normalized.slice("api.".length) : normalized;
}

function handlesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function requiredPublicationValue(value: string | null | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new NexusPublicationPolicyError(`${name} must be configured.`);
  }
  return trimmed;
}

function check(
  name: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): NexusPublicationPolicyCheck {
  return {
    name,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : failedMessage,
  };
}
