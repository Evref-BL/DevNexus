import path from "node:path";
import type { NexusAutomationPublicationConfig } from "./nexusAutomationConfig.js";
import {
  createNexusForgePublicationAdapter,
  type NexusForgePullRequestMergeResult,
  type NexusForgePullRequestResult,
} from "./nexusForgePublication.js";
import {
  nexusForgeRepositoryFromGitHubRepository,
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
  resolveNexusPublicationPolicy,
  type NexusPublicationGitPushResult,
  type NexusPublicationGitPushRunner,
} from "./nexusPublicationPolicy.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";

export interface NexusPublicationComponentContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  publication: NexusAutomationPublicationConfig;
  authProfiles: NexusHostingAuthProfileConfig[];
  repository: NexusGitHubRepositorySelection;
}

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
  componentId: string;
  repository: NexusGitHubRepositorySelection;
  branch: string;
  targetBranch: string | null;
  forceWithLease: boolean;
  forceWithLeaseExpectedCommit: string | null;
  credential: NexusPublicationCredentialSummary;
  push: NexusPublicationGitPushResult;
}

export interface NexusPublicationPullRequestUpsertResult {
  projectRoot: string;
  componentId: string;
  repository: NexusGitHubRepositorySelection;
  credential: NexusPublicationCredentialSummary;
  pullRequest: NexusForgePullRequestResult;
}

export interface NexusPublicationPullRequestMergeResult {
  projectRoot: string;
  componentId: string;
  repository: NexusGitHubRepositorySelection;
  credential: NexusPublicationCredentialSummary;
  pullRequest: {
    number: number;
    method: "merge" | "squash" | "rebase";
  };
  merge: NexusForgePullRequestMergeResult;
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
  repositoryPath: string;
  branch: string;
  targetBranch?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  gitRunner?: NexusPublicationGitPushRunner;
}

export interface UpsertNexusPublicationPullRequestForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  number?: number | null;
  head: string;
  base?: string | null;
  title: string;
  body?: string | null;
}

export interface MergeNexusPublicationPullRequestForComponentOptions
  extends NexusPublicationOperationRuntimeOptions {
  projectRoot: string;
  componentId?: string;
  number: number;
  method?: "merge" | "squash" | "rebase";
}

export function resolveNexusPublicationComponentContext(options: {
  projectRoot: string;
  componentId?: string;
}): NexusPublicationComponentContext {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
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
    projectConfig,
    component,
    publication,
    authProfiles,
    repository,
  };
}

export async function pushNexusPublicationBranchForComponent(
  options: PushNexusPublicationBranchForComponentOptions,
): Promise<NexusPublicationBranchPushResult> {
  const context = resolveNexusPublicationComponentContext(options);
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
  });

  return {
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    repository: context.repository,
    branch: options.branch,
    targetBranch: options.targetBranch ?? null,
    forceWithLease: options.forceWithLease ?? false,
    forceWithLeaseExpectedCommit: options.forceWithLeaseExpectedCommit ?? null,
    credential: summarizePublicationCredential(credential),
    push,
  };
}

export async function upsertNexusPublicationPullRequestForComponent(
  options: UpsertNexusPublicationPullRequestForComponentOptions,
): Promise<NexusPublicationPullRequestUpsertResult> {
  const context = resolveNexusPublicationComponentContext(options);
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
      context.component.defaultBranch ??
      "main",
    title: options.title,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });

  return {
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    repository: context.repository,
    credential: summarizePublicationCredential(credential),
    pullRequest,
  };
}

export async function mergeNexusPublicationPullRequestForComponent(
  options: MergeNexusPublicationPullRequestForComponentOptions,
): Promise<NexusPublicationPullRequestMergeResult> {
  const context = resolveNexusPublicationComponentContext(options);
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
    componentId: context.component.id,
    repository: context.repository,
    credential: summarizePublicationCredential(credential),
    pullRequest: {
      number: options.number,
      method,
    },
    merge,
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
  context: NexusPublicationComponentContext;
  purpose: "api" | "git";
  requiredPermissions: Record<string, string>;
  runtime: NexusPublicationOperationRuntimeOptions;
}): Promise<NexusResolvedProviderCredential> {
  const broker = createHostAuthProfileCredentialBroker({
    authProfiles: options.context.authProfiles,
    projectRoot: options.context.projectRoot,
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
