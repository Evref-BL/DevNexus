import { spawnSync } from "node:child_process";
import path from "node:path";
import type { NexusAutomationPublicationConfig } from "./nexusAutomationConfig.js";
import { resolveNexusCommandPath } from "./nexusCommandPath.js";
import {
  buildNexusFeatureBranchDeliveryPlan,
} from "./nexusFeatureBranchDeliveryPlan.js";
import type {
  NexusFeatureBranchDeliveryBranchPublicationSummary,
} from "./nexusFeatureBranchDeliveryPolicy.js";
import {
  createNexusForgePublicationAdapter,
  type NexusForgePullRequestChecksResult,
  type NexusForgePullRequestMergeResult,
  type NexusForgePullRequestResult,
} from "./nexusForgePublication.js";
import {
  nexusForgeRepositoryFromGitHubRepository,
  resolveNexusGitHubRepositoryFromRemoteUrl,
  resolveNexusGitHubRepository,
  selectNexusGitHubPrimaryTracker,
  type NexusGitHubRepositorySelection,
} from "./nexusForgeRepositoryResolver.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  createHostAuthProfileCredentialBroker,
  resolveProviderCredential,
  type NexusProviderCredentialCommandRunner,
  type NexusResolvedProviderCredential,
} from "./nexusProviderCredentialBroker.js";
import {
  loadNexusPublicationAuthProfiles,
  pushNexusPublicationBranch,
  resolveNexusPublicationHomePath,
  resolveNexusPublicationPolicy,
  type NexusPublicationGitPushResult,
  type NexusPublicationGitPushRunner,
} from "./nexusPublicationPolicy.js";
import {
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidence,
} from "./nexusPublicationProviderEvidence.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";
import type { NexusReviewLocalAuthorization } from "./nexusReviewPolicy.js";
import {
  assertNexusReviewPolicyEnforcement,
  buildNexusReviewPolicyEnforcementDecision,
  type NexusReviewPolicyEnforcementDecision,
} from "./nexusReviewPolicyEnforcement.js";

export interface NexusPublicationComponentContext {
  projectRoot: string;
  homePath: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  publication: NexusAutomationPublicationConfig;
  authProfiles: NexusHostingAuthProfileConfig[];
  repository: NexusGitHubRepositorySelection;
}

export interface NexusPublicationProjectContext {
  projectRoot: string;
  homePath: string;
  projectConfig: NexusProjectConfig;
  component: null;
  publication: NexusAutomationPublicationConfig;
  authProfiles: NexusHostingAuthProfileConfig[];
  repository: NexusGitHubRepositorySelection;
}

export interface NexusPublicationTargetSummary {
  kind: "component" | "project";
  id: string;
  componentId: string | null;
  projectId: string | null;
}

export type NexusPublicationTargetContext =
  | NexusPublicationComponentContext
  | NexusPublicationProjectContext;

export interface NexusPublicationCredentialSummary {
  provider: string;
  profileId: string;
  actorId: string | null;
  account: string | null;
  kind: string;
  purposes: string[];
  permissions: Record<string, string> | null;
  gitCredential: {
    protocol: "https" | "ssh";
    host: string;
    path: string | null;
  } | null;
}

export interface NexusPublicationBranchPushResult {
  projectRoot: string;
  componentId: string | null;
  target: NexusPublicationTargetSummary;
  repository: NexusGitHubRepositorySelection;
  branch: string;
  targetBranch: string | null;
  forceWithLease: boolean;
  forceWithLeaseExpectedCommit: string | null;
  featureBranchDelivery: NexusPublicationBranchPushFeatureSummary | null;
  warnings: string[];
  credential: NexusPublicationCredentialSummary;
  push: NexusPublicationGitPushResult;
  reviewEnforcement: NexusReviewPolicyEnforcementDecision | null;
}

export interface NexusPublicationBranchPushFeatureSummary {
  featureId: string;
  branchPublication: NexusFeatureBranchDeliveryBranchPublicationSummary;
  remoteSelection: NexusPublicationBranchPushRemoteSelection;
}

export type NexusPublicationBranchPushRemoteSelectionStatus =
  | "not_required"
  | "push_remote_writable"
  | "fallback_selected"
  | "blocked";

export interface NexusPublicationBranchPushRemoteSelection {
  status: NexusPublicationBranchPushRemoteSelectionStatus;
  selectedRemote: string | null;
  pushRemote: string | null;
  fallbackRemote: string | null;
  reasons: string[];
  setupActions: string[];
  probes: NexusPublicationBranchPushRemoteProbe[];
}

export interface NexusPublicationBranchPushRemoteProbe {
  remote: string;
  exitCode: number | null;
  stderr: string;
  writable: boolean;
}

export class NexusPublicationBranchPushBlockedError extends Error {
  readonly featureBranchDelivery: NexusPublicationBranchPushFeatureSummary;
  readonly remoteSelection: NexusPublicationBranchPushRemoteSelection;

  constructor(options: {
    message: string;
    featureBranchDelivery: NexusPublicationBranchPushFeatureSummary;
  }) {
    super(options.message);
    this.name = "NexusPublicationBranchPushBlockedError";
    this.featureBranchDelivery = options.featureBranchDelivery;
    this.remoteSelection = options.featureBranchDelivery.remoteSelection;
  }
}

export interface NexusPublicationPullRequestUpsertResult {
  projectRoot: string;
  componentId: string | null;
  target: NexusPublicationTargetSummary;
  repository: NexusGitHubRepositorySelection;
  credential: NexusPublicationCredentialSummary;
  dryRun: boolean;
  plan: NexusPublicationPullRequestUpsertPlan;
  pullRequest: NexusForgePullRequestResult | null;
}

export interface NexusPublicationPullRequestUpsertPlan {
  operation: "create" | "update";
  number: number | null;
  head: string;
  base: string;
  title: string;
  bodyProvided: boolean;
  draft: boolean;
  backend: "github_rest";
}

export interface NexusPublicationPullRequestMergeResult {
  projectRoot: string;
  componentId: string | null;
  target: NexusPublicationTargetSummary;
  repository: NexusGitHubRepositorySelection;
  credential: NexusPublicationCredentialSummary;
  pullRequest: {
    number: number;
    method: "merge" | "squash" | "rebase";
  };
  reviewEnforcement: NexusReviewPolicyEnforcementDecision | null;
  merge: NexusForgePullRequestMergeResult;
}

export interface NexusPublicationPullRequestEvidenceResult {
  projectRoot: string;
  componentId: string | null;
  target: NexusPublicationTargetSummary;
  repository: NexusGitHubRepositorySelection;
  credential: NexusPublicationCredentialSummary;
  pullRequest: {
    number: number;
  };
  evidence: NexusForgePullRequestChecksResult["evidence"];
  metadata: NexusForgePullRequestChecksResult["metadata"];
}

export interface NexusPublicationOperationRuntimeOptions {
  baseEnv?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  credentialCommandRunner?: NexusProviderCredentialCommandRunner;
}

export interface PushNexusPublicationBranchForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  repositoryPath: string;
  branch: string;
  targetBranch?: string | null;
  featureId?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  localAuthorization?: Partial<NexusReviewLocalAuthorization> | null;
  gitRunner?: NexusPublicationGitPushRunner;
  remoteProbeRunner?: NexusPublicationGitPushRunner;
}

export interface UpsertNexusPublicationPullRequestForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number?: number | null;
  head: string;
  base?: string | null;
  title: string;
  body?: string | null;
  draft?: boolean;
  dryRun?: boolean;
}

export interface MergeNexusPublicationPullRequestForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number: number;
  method?: "merge" | "squash" | "rebase";
  branchRole?: string | null;
  localAuthorization?: Partial<NexusReviewLocalAuthorization> | null;
}

export interface InspectNexusPublicationPullRequestForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number: number;
}

export function resolveNexusPublicationComponentContext(options: {
  projectRoot: string;
  componentId?: string;
}): NexusPublicationComponentContext {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const homePath = resolveNexusPublicationHomePath({
    projectRoot,
    projectConfig,
  });
  const component = resolveComponent(
    projectRoot,
    projectConfig,
    options.componentId,
  );
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot,
    projectConfig,
  });
  const tracker = selectNexusGitHubPrimaryTracker(component, "publication");
  const repository = resolveNexusGitHubRepository(tracker, "publication");

  return {
    projectRoot,
    homePath,
    projectConfig,
    component,
    publication,
    authProfiles,
    repository,
  };
}

export function resolveNexusPublicationTargetContext(options: {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
}): NexusPublicationTargetContext {
  if (options.projectRepository && options.componentId) {
    throw new Error("Publication target accepts --component or --project-repository, not both.");
  }
  if (!options.projectRepository) {
    return resolveNexusPublicationComponentContext(options);
  }

  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const homePath = resolveNexusPublicationHomePath({
    projectRoot,
    projectConfig,
  });
  const publication = resolveNexusPublicationPolicy(projectConfig);
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot,
    projectConfig,
  });
  const repository = resolveNexusGitHubRepositoryFromRemoteUrl(
    projectConfig.repo.remoteUrl,
    "project repository publication",
  );

  return {
    projectRoot,
    homePath,
    projectConfig,
    component: null,
    publication,
    authProfiles,
    repository,
  };
}

export async function pushNexusPublicationBranchForComponent(
  options: PushNexusPublicationBranchForComponentOptions,
): Promise<NexusPublicationBranchPushResult> {
  const context = resolveNexusPublicationTargetContext(options);
  const featureBranchDeliveryPlan = resolveFeatureBranchPushPolicy({
    context,
    featureId: options.featureId ?? null,
  });
  assertSafePublicationBranchTarget({
    publication: context.publication,
    branch: options.branch,
    targetBranch: options.targetBranch ?? null,
  });
  const reviewEnforcement = branchPushReviewEnforcement({
    context,
    branch: options.branch,
    targetBranch: options.targetBranch ?? null,
    localAuthorization: options.localAuthorization ?? null,
  });
  assertNexusReviewPolicyEnforcement(reviewEnforcement);
  const credential = await resolvePublicationCredential({
    context,
    purpose: "git",
    requiredPermissions: { contents: "write" },
    runtime: options,
  });
  const featureBranchDelivery = featureBranchDeliveryPlan
    ? resolveFeatureBranchPushRemoteSelection({
        featureBranchDelivery: featureBranchDeliveryPlan,
        repositoryPath: options.repositoryPath,
        branch: options.branch,
        baseEnv: options.baseEnv,
        gitRunner: options.remoteProbeRunner ?? options.gitRunner,
      })
    : null;
  const remoteOverride =
    featureBranchDelivery?.remoteSelection.selectedRemote ??
    featureBranchDelivery?.branchPublication.selectedRemote ??
    null;
  const preferConfiguredRemote = Boolean(
    remoteOverride && remoteOverride !== context.publication.remote,
  );
  const push = pushNexusPublicationBranch({
    policy: context.publication,
    repositoryPath: options.repositoryPath,
    branch: options.branch,
    targetBranch: options.targetBranch,
    forceWithLease: options.forceWithLease,
    forceWithLeaseExpectedCommit: options.forceWithLeaseExpectedCommit,
    credential,
    projectRoot: context.projectRoot,
    authProfiles: context.authProfiles,
    baseEnv: options.baseEnv,
    gitRunner: options.gitRunner,
    remoteOverride,
    preferConfiguredRemote,
  });
  const warnings = publicationBranchPushWarnings({
    repositoryPath: options.repositoryPath,
    branch: options.branch,
    configuredRemote: context.publication.remote,
    selectedRemote:
      remoteOverride ??
      context.publication.remote ??
      null,
  });

  return {
    projectRoot: context.projectRoot,
    componentId: componentIdForPublicationTarget(context),
    target: publicationTargetSummary(context),
    repository: context.repository,
    branch: options.branch,
    targetBranch: options.targetBranch ?? null,
    forceWithLease: options.forceWithLease ?? false,
    forceWithLeaseExpectedCommit: options.forceWithLeaseExpectedCommit ?? null,
    featureBranchDelivery,
    warnings,
    credential: summarizePublicationCredential(credential),
    push,
    reviewEnforcement,
  };
}

function resolveFeatureBranchPushPolicy(options: {
  context: NexusPublicationTargetContext;
  featureId: string | null;
}): NexusPublicationBranchPushFeatureSummary | null {
  if (!options.featureId) {
    return null;
  }
  if (!options.context.component) {
    throw new Error("Feature branch publication requires a component target.");
  }
  const plan = buildNexusFeatureBranchDeliveryPlan({
    projectRoot: options.context.projectRoot,
    componentId: options.context.component.id,
    featureId: options.featureId,
  });
  const item = plan.items[0];
  if (!item) {
    throw new Error(`Feature branch delivery policy was not found: ${options.featureId}`);
  }
  const summary = {
    featureId: item.feature.activeScopeId,
    branchPublication: item.feature.branchPublication,
    remoteSelection: {
      status: "not_required" as const,
      selectedRemote: item.feature.branchPublication.selectedRemote,
      pushRemote: item.feature.branchPublication.pushRemote,
      fallbackRemote: item.feature.branchPublication.fallbackRemote,
      reasons: [],
      setupActions: [],
      probes: [],
    },
  };
  if (!item.feature.branchPublication.selectedRemote) {
    const manualOnly =
      item.feature.branchPublication.strategy === "manual_only";
    throw new NexusPublicationBranchPushBlockedError({
      message:
        manualOnly
          ? `Feature ${options.featureId} branch publication is manual-only; no push remote was selected.`
          : `Feature ${options.featureId} branch publication has no selected push remote.`,
      featureBranchDelivery: featureRemoteSelection(summary, {
        status: "blocked",
        selectedRemote: null,
        pushRemote: item.feature.branchPublication.pushRemote,
        fallbackRemote: item.feature.branchPublication.fallbackRemote,
        reasons: [
          manualOnly
            ? "feature branch publication is manual-only"
            : "feature branch publication has no selected remote",
        ],
        setupActions: [
          manualOnly
            ? "publish manually or configure featureBranchDelivery.branchPublication"
            : "configure automation.publication.remote or featureBranchDelivery.branchPublication.fallbackRemote",
        ],
        probes: [],
      }),
    });
  }
  return summary;
}

function resolveFeatureBranchPushRemoteSelection(options: {
  featureBranchDelivery: NexusPublicationBranchPushFeatureSummary;
  repositoryPath: string;
  branch: string;
  baseEnv?: NodeJS.ProcessEnv;
  gitRunner?: NexusPublicationGitPushRunner;
}): NexusPublicationBranchPushFeatureSummary {
  const branchPublication = options.featureBranchDelivery.branchPublication;
  if (branchPublication.strategy !== "push_remote_then_fallback") {
    return options.featureBranchDelivery;
  }

  const pushRemote = branchPublication.pushRemote;
  const fallbackRemote = branchPublication.fallbackRemote;
  if (!pushRemote) {
    if (!fallbackRemote) {
      return blockedFeatureRemoteSelection(
        options.featureBranchDelivery,
        "push remote is not configured",
        "configure automation.publication.remote or featureBranchDelivery.branchPublication.fallbackRemote",
      );
    }
    return featureRemoteSelection(options.featureBranchDelivery, {
      status: "fallback_selected",
      selectedRemote: fallbackRemote,
      pushRemote,
      fallbackRemote,
      reasons: ["push remote is not configured"],
      setupActions: [],
      probes: [],
    });
  }

  const publicationProbe = probeFeatureBranchRemote({
    remote: pushRemote,
    repositoryPath: options.repositoryPath,
    branch: options.branch,
    baseEnv: options.baseEnv,
    gitRunner: options.gitRunner,
  });
  if (publicationProbe.writable) {
    return featureRemoteSelection(options.featureBranchDelivery, {
      status: "push_remote_writable",
      selectedRemote: pushRemote,
      pushRemote,
      fallbackRemote,
      reasons: ["push remote accepted a dry-run branch push"],
      setupActions: [],
      probes: [publicationProbe],
    });
  }
  if (!fallbackRemote) {
    return blockedFeatureRemoteSelection(
      options.featureBranchDelivery,
      `push remote ${pushRemote} rejected a dry-run branch push`,
      "configure featureBranchDelivery.branchPublication.fallbackRemote",
      [publicationProbe],
    );
  }

  const fallbackProbe = probeFeatureBranchRemote({
    remote: fallbackRemote,
    repositoryPath: options.repositoryPath,
    branch: options.branch,
    baseEnv: options.baseEnv,
    gitRunner: options.gitRunner,
  });
  if (!fallbackProbe.writable) {
    return blockedFeatureRemoteSelection(
      options.featureBranchDelivery,
      `fallback remote ${fallbackRemote} rejected a dry-run branch push`,
      `fix remote ${fallbackRemote} before publishing the feature branch`,
      [publicationProbe, fallbackProbe],
    );
  }

  return featureRemoteSelection(options.featureBranchDelivery, {
    status: "fallback_selected",
    selectedRemote: fallbackRemote,
    pushRemote,
    fallbackRemote,
    reasons: [
      `push remote ${pushRemote} rejected a dry-run branch push`,
      `fallback remote ${fallbackRemote} accepted a dry-run branch push`,
    ],
    setupActions: [],
    probes: [publicationProbe, fallbackProbe],
  });
}

function probeFeatureBranchRemote(options: {
  remote: string;
  repositoryPath: string;
  branch: string;
  baseEnv?: NodeJS.ProcessEnv;
  gitRunner?: NexusPublicationGitPushRunner;
}): NexusPublicationBranchPushRemoteProbe {
  if (!options.gitRunner) {
    return {
      remote: options.remote,
      exitCode: null,
      stderr: "remote writability probe was not run",
      writable: true,
    };
  }
  const result = options.gitRunner(
    ["push", "--dry-run", options.remote, options.branch],
    {
      cwd: options.repositoryPath,
      env: {
        ...(options.baseEnv ?? process.env),
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  return {
    remote: options.remote,
    exitCode: result.exitCode,
    stderr: result.stderr,
    writable: result.exitCode === 0,
  };
}

function blockedFeatureRemoteSelection(
  featureBranchDelivery: NexusPublicationBranchPushFeatureSummary,
  reason: string,
  setupAction: string,
  probes: NexusPublicationBranchPushRemoteProbe[] = [],
): never {
  const blocked = featureRemoteSelection(featureBranchDelivery, {
    status: "blocked",
    selectedRemote: null,
    pushRemote: featureBranchDelivery.branchPublication.pushRemote,
    fallbackRemote: featureBranchDelivery.branchPublication.fallbackRemote,
    reasons: [reason],
    setupActions: [setupAction],
    probes,
  });
  throw new NexusPublicationBranchPushBlockedError({
    message: [
      "Feature branch publication is blocked.",
      ...blocked.remoteSelection.reasons,
      ...blocked.remoteSelection.setupActions,
    ].join(" "),
    featureBranchDelivery: blocked,
  });
}

function featureRemoteSelection(
  featureBranchDelivery: NexusPublicationBranchPushFeatureSummary,
  remoteSelection: NexusPublicationBranchPushRemoteSelection,
): NexusPublicationBranchPushFeatureSummary {
  return {
    ...featureBranchDelivery,
    branchPublication: {
      ...featureBranchDelivery.branchPublication,
      selectedRemote: remoteSelection.selectedRemote,
    },
    remoteSelection,
  };
}

export async function upsertNexusPublicationPullRequestForComponent(
  options: UpsertNexusPublicationPullRequestForComponentOptions,
): Promise<NexusPublicationPullRequestUpsertResult> {
  const context = resolveNexusPublicationTargetContext(options);
  const credential = await resolvePublicationCredential({
    context,
    purpose: "api",
    requiredPermissions: { pull_requests: "write" },
    runtime: options,
  });
  const base =
    options.base ??
    context.publication.targetBranch ??
    publicationTargetDefaultBranch(context) ??
    "main";
  const plan: NexusPublicationPullRequestUpsertPlan = {
    operation: options.number ? "update" : "create",
    number: options.number ?? null,
    head: options.head,
    base,
    title: options.title,
    bodyProvided: options.body !== undefined,
    draft: options.draft === true,
    backend: "github_rest",
  };
  if (options.dryRun === true) {
    return {
      projectRoot: context.projectRoot,
      componentId: componentIdForPublicationTarget(context),
      target: publicationTargetSummary(context),
      repository: context.repository,
      credential: summarizePublicationCredential(credential),
      dryRun: true,
      plan,
      pullRequest: null,
    };
  }

  const adapter = createNexusForgePublicationAdapter({
    repository: nexusForgeRepositoryFromGitHubRepository(context.repository),
    credential,
    preferredBackend: "github_rest",
    fetch: options.fetch,
    baseEnv: options.baseEnv,
  });
  const pullRequest = await adapter.upsertPullRequest({
    number: options.number,
    head: options.head,
    base,
    title: options.title,
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.draft === true ? { draft: true } : {}),
  });

  return {
    projectRoot: context.projectRoot,
    componentId: componentIdForPublicationTarget(context),
    target: publicationTargetSummary(context),
    repository: context.repository,
    credential: summarizePublicationCredential(credential),
    dryRun: false,
    plan,
    pullRequest,
  };
}

function publicationBranchPushWarnings(options: {
  repositoryPath: string;
  branch: string;
  configuredRemote?: string | null;
  selectedRemote?: string | null;
}): string[] {
  const configuredRemote = options.configuredRemote ?? null;
  const selectedRemote = options.selectedRemote ?? configuredRemote;
  if (!configuredRemote || selectedRemote !== configuredRemote) {
    return [];
  }
  const upstreamRemote = gitConfigValue(
    options.repositoryPath,
    `branch.${options.branch}.remote`,
  );
  if (!upstreamRemote || upstreamRemote === configuredRemote) {
    return [];
  }

  return [
    `Branch ${options.branch} tracks remote ${upstreamRemote}, not configured publication remote ${configuredRemote}.`,
  ];
}

function gitConfigValue(repositoryPath: string, key: string): string | null {
  const result = spawnSync(
    resolveNexusCommandPath("git"),
    ["config", "--get", key],
    {
      cwd: repositoryPath,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export async function mergeNexusPublicationPullRequestForComponent(
  options: MergeNexusPublicationPullRequestForComponentOptions,
): Promise<NexusPublicationPullRequestMergeResult> {
  const context = resolveNexusPublicationTargetContext(options);
  const credential = await resolvePublicationCredential({
    context,
    purpose: "api",
    requiredPermissions: { contents: "write", pull_requests: "write" },
    runtime: options,
  });
  const adapter = createNexusForgePublicationAdapter({
    repository: nexusForgeRepositoryFromGitHubRepository(context.repository),
    credential,
    preferredBackend: "github_rest",
    fetch: options.fetch,
    baseEnv: options.baseEnv,
  });
  const method = options.method ?? "merge";
  const reviewEnforcement = await pullRequestMergeReviewEnforcement({
    context,
    adapter,
    number: options.number,
    branchRole: options.branchRole ?? null,
    localAuthorization: options.localAuthorization ?? null,
  });
  assertNexusReviewPolicyEnforcement(reviewEnforcement);
  const merge = await adapter.mergePullRequest({
    number: options.number,
    method,
  });

  return {
    projectRoot: context.projectRoot,
    componentId: componentIdForPublicationTarget(context),
    target: publicationTargetSummary(context),
    repository: context.repository,
    credential: summarizePublicationCredential(credential),
    pullRequest: {
      number: options.number,
      method,
    },
    reviewEnforcement,
    merge,
  };
}

export async function inspectNexusPublicationPullRequestForComponent(
  options: InspectNexusPublicationPullRequestForComponentOptions,
): Promise<NexusPublicationPullRequestEvidenceResult> {
  const context = resolveNexusPublicationTargetContext(options);
  const credential = await resolvePublicationCredential({
    context,
    purpose: "api",
    requiredPermissions: { pull_requests: "read" },
    runtime: options,
  });
  const adapter = createNexusForgePublicationAdapter({
    repository: nexusForgeRepositoryFromGitHubRepository(context.repository),
    credential,
    preferredBackend: "github_rest",
    fetch: options.fetch,
    baseEnv: options.baseEnv,
  });
  const result = await adapter.inspectPullRequestChecks({
    number: options.number,
  });

  return {
    projectRoot: context.projectRoot,
    componentId: componentIdForPublicationTarget(context),
    target: publicationTargetSummary(context),
    repository: context.repository,
    credential: summarizePublicationCredential(credential),
    pullRequest: {
      number: options.number,
    },
    evidence: result.evidence,
    metadata: result.metadata,
  };
}

export function summarizePublicationCredential(
  credential: NexusResolvedProviderCredential,
): NexusPublicationCredentialSummary {
  return {
    provider: credential.provider,
    profileId: credential.profileId,
    actorId: credential.actorId ?? null,
    account: credential.account ?? null,
    kind: credential.kind,
    purposes: [...credential.purposes],
    permissions: credential.permissions ? { ...credential.permissions } : null,
    gitCredential: credential.gitCredential
      ? {
          protocol: credential.gitCredential.protocol,
          host: credential.gitCredential.host,
          path: credential.gitCredential.path ?? null,
        }
      : null,
  };
}

async function resolvePublicationCredential(options: {
  context: NexusPublicationTargetContext;
  purpose: "api" | "git";
  requiredPermissions: Record<string, string>;
  runtime: NexusPublicationOperationRuntimeOptions;
}): Promise<NexusResolvedProviderCredential> {
  const broker = createHostAuthProfileCredentialBroker({
    authProfiles: options.context.authProfiles,
    projectRoot: options.context.projectRoot,
    homePath: options.context.homePath,
    env: options.runtime.baseEnv,
    commandRunner: options.runtime.credentialCommandRunner,
    fetch: options.runtime.fetch,
  });
  const actor = options.context.publication.actor;

  return resolveProviderCredential(broker, {
    provider: actor?.provider ?? "github",
    purpose: options.purpose,
    actorId: actor?.id ?? undefined,
    providerIdentity: actor?.handle ?? undefined,
    host: options.context.repository.host,
    repository: {
      owner: options.context.repository.owner,
      name: options.context.repository.name,
      path: `${options.context.repository.owner}/${options.context.repository.name}`,
    },
    requiredPermissions: options.requiredPermissions,
  });
}

function componentIdForPublicationTarget(
  context: NexusPublicationTargetContext,
): string | null {
  return context.component?.id ?? null;
}

function publicationTargetSummary(
  context: NexusPublicationTargetContext,
): NexusPublicationTargetSummary {
  if (context.component) {
    return {
      kind: "component",
      id: context.component.id,
      componentId: context.component.id,
      projectId: context.projectConfig.id ?? null,
    };
  }

  return {
    kind: "project",
    id: context.projectConfig.id,
    componentId: null,
    projectId: context.projectConfig.id,
  };
}

function publicationTargetDefaultBranch(
  context: NexusPublicationTargetContext,
): string | null {
  return context.component?.defaultBranch ?? context.projectConfig.repo.defaultBranch ?? null;
}

function branchPushReviewEnforcement(options: {
  context: NexusPublicationTargetContext;
  branch: string;
  targetBranch: string | null;
  localAuthorization: Partial<NexusReviewLocalAuthorization> | null;
}): NexusReviewPolicyEnforcementDecision | null {
  const reviewPolicy = options.context.component?.review ?? null;
  if (!reviewPolicy) {
    return null;
  }
  const finalTargetBranch = publicationFinalTargetBranch(options.context);
  const pushedTargetBranch = options.targetBranch?.trim() || options.branch.trim();
  if (!finalTargetBranch || pushedTargetBranch !== finalTargetBranch) {
    return null;
  }
  const requestedAction = "git.push_target_branch";

  return buildNexusReviewPolicyEnforcementDecision({
    componentId: componentIdForPublicationTarget(options.context),
    policy: reviewPolicy,
    finalAction: true,
    requestedAction,
    branchRole: "direct_target_push",
    branchName: pushedTargetBranch,
    localAuthorization: scopedLocalAuthorization({
      localAuthorization: options.localAuthorization,
      requestedAction,
      branchName: pushedTargetBranch,
      headSha: null,
    }),
  });
}

async function pullRequestMergeReviewEnforcement(options: {
  context: NexusPublicationTargetContext;
  adapter: ReturnType<typeof createNexusForgePublicationAdapter>;
  number: number;
  branchRole: string | null;
  localAuthorization: Partial<NexusReviewLocalAuthorization> | null;
}): Promise<NexusReviewPolicyEnforcementDecision | null> {
  const reviewPolicy = options.context.component?.review ?? null;
  if (!reviewPolicy) {
    return null;
  }
  const evidenceResult = await options.adapter.inspectPullRequestChecks({
    number: options.number,
  });
  const providerEvidence = normalizeNexusPublicationProviderEvidence([
    evidenceResult.evidence,
  ])[0] ?? null;
  const requestedAction = "provider.pull_request.merge";
  const branchName = providerEvidence?.headBranch ?? providerEvidence?.headRef ?? null;
  const headSha = providerEvidence?.headSha ?? null;

  return buildNexusReviewPolicyEnforcementDecision({
    componentId: componentIdForPublicationTarget(options.context),
    policy: reviewPolicy,
    finalAction: true,
    requestedAction,
    branchRole: options.branchRole ??
      inferPullRequestMergeBranchRole(options.context, providerEvidence),
    branchName,
    headSha,
    localAuthorization: scopedLocalAuthorization({
      localAuthorization: options.localAuthorization,
      requestedAction,
      branchName,
      headSha,
    }),
    providerEvidence,
  });
}

function inferPullRequestMergeBranchRole(
  context: NexusPublicationTargetContext,
  providerEvidence: NexusPublicationProviderEvidence | null,
): string | null {
  const targetBranch = providerEvidence?.targetBranch ?? null;
  const finalTargetBranch = publicationFinalTargetBranch(context);
  if (targetBranch && finalTargetBranch && targetBranch === finalTargetBranch) {
    return "feature_finalization";
  }
  return null;
}

function scopedLocalAuthorization(options: {
  localAuthorization: Partial<NexusReviewLocalAuthorization> | null;
  requestedAction: string;
  branchName: string | null;
  headSha: string | null;
}): Partial<NexusReviewLocalAuthorization> | null {
  const authorization = options.localAuthorization;
  if (!authorization?.authorized) {
    return authorization ?? null;
  }

  return {
    ...authorization,
    requestedAction: authorization.requestedAction ?? options.requestedAction,
    branchName: authorization.branchName ?? options.branchName,
    headSha: authorization.headSha ?? options.headSha,
  };
}

function publicationFinalTargetBranch(
  context: NexusPublicationTargetContext,
): string | null {
  return context.publication.targetBranch ?? publicationTargetDefaultBranch(context);
}

function assertSafePublicationBranchTarget(options: {
  publication: NexusAutomationPublicationConfig;
  branch: string;
  targetBranch: string | null;
}): void {
  const branch = required(options.branch, "branch");
  const targetBranch = options.targetBranch?.trim() || null;
  const configuredTargetBranch = options.publication.targetBranch?.trim() || null;
  if (
    targetBranch &&
    targetBranch !== branch &&
    configuredTargetBranch &&
    targetBranch === configuredTargetBranch &&
    !options.publication.push
  ) {
    throw new Error(
      `Publication policy blocks direct pushes to target branch ${targetBranch}; push the review branch and open a pull request instead.`,
    );
  }
}

function resolveComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string | undefined,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (!componentId) {
    return components[0] ?? missingComponent(componentId);
  }

  return (
    components.find((component) => component.id === componentId) ??
    missingComponent(componentId)
  );
}

function missingComponent(componentId: string | undefined): never {
  throw new Error(`Component ${componentId ?? "<default>"} was not found.`);
}

function required(value: string | undefined | null, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}
