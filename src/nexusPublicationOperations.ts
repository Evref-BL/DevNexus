import path from "node:path";
import type { NexusAutomationPublicationConfig } from "./nexusAutomationConfig.js";
import {
  buildNexusInitiativeDeliveryPlan,
} from "./nexusInitiativeDeliveryPlan.js";
import type {
  NexusInitiativeDeliveryBranchPublicationSummary,
} from "./nexusInitiativeDeliveryPolicy.js";
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
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";

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
  initiativeDelivery: NexusPublicationBranchPushInitiativeSummary | null;
  credential: NexusPublicationCredentialSummary;
  push: NexusPublicationGitPushResult;
}

export interface NexusPublicationBranchPushInitiativeSummary {
  initiativeId: string;
  branchPublication: NexusInitiativeDeliveryBranchPublicationSummary;
}

export interface NexusPublicationPullRequestUpsertResult {
  projectRoot: string;
  componentId: string | null;
  target: NexusPublicationTargetSummary;
  repository: NexusGitHubRepositorySelection;
  credential: NexusPublicationCredentialSummary;
  pullRequest: NexusForgePullRequestResult;
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
  initiativeId?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  gitRunner?: NexusPublicationGitPushRunner;
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
}

export interface MergeNexusPublicationPullRequestForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number: number;
  method?: "merge" | "squash" | "rebase";
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
  const initiativeDelivery = resolveInitiativeBranchPushPolicy({
    context,
    initiativeId: options.initiativeId ?? null,
  });
  const remoteOverride = initiativeDelivery?.branchPublication.selectedRemote ?? null;
  const preferConfiguredRemote = Boolean(
    remoteOverride && remoteOverride !== context.publication.remote,
  );
  assertSafePublicationBranchTarget({
    publication: context.publication,
    branch: options.branch,
    targetBranch: options.targetBranch ?? null,
  });
  const credential = await resolvePublicationCredential({
    context,
    purpose: "git",
    requiredPermissions: { contents: "write" },
    runtime: options,
  });
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

  return {
    projectRoot: context.projectRoot,
    componentId: componentIdForPublicationTarget(context),
    target: publicationTargetSummary(context),
    repository: context.repository,
    branch: options.branch,
    targetBranch: options.targetBranch ?? null,
    forceWithLease: options.forceWithLease ?? false,
    forceWithLeaseExpectedCommit: options.forceWithLeaseExpectedCommit ?? null,
    initiativeDelivery,
    credential: summarizePublicationCredential(credential),
    push,
  };
}

function resolveInitiativeBranchPushPolicy(options: {
  context: NexusPublicationTargetContext;
  initiativeId: string | null;
}): NexusPublicationBranchPushInitiativeSummary | null {
  if (!options.initiativeId) {
    return null;
  }
  if (!options.context.component) {
    throw new Error("Initiative branch publication requires a component target.");
  }
  const plan = buildNexusInitiativeDeliveryPlan({
    projectRoot: options.context.projectRoot,
    componentId: options.context.component.id,
    initiativeId: options.initiativeId,
  });
  const item = plan.items[0];
  if (!item) {
    throw new Error(`Initiative delivery policy was not found: ${options.initiativeId}`);
  }
  if (!item.initiative.branchPublication.selectedRemote) {
    throw new Error(
      `Initiative ${options.initiativeId} branch publication is manual-only; no push remote was selected.`,
    );
  }
  return {
    initiativeId: item.initiative.activeScopeId,
    branchPublication: item.initiative.branchPublication,
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
    base:
      options.base ??
      context.publication.targetBranch ??
      publicationTargetDefaultBranch(context) ??
      "main",
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
    pullRequest,
  };
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
