import {
  createGitHubWorkTrackerProvider,
  githubWorkTrackerCapabilitiesForConfig,
  type GitHubWorkTrackerProviderOptions,
} from "./workTrackingGitHubProvider.js";
import {
  createGitLabWorkTrackerProvider,
  gitLabWorkTrackerCapabilities,
  type GitLabWorkTrackerProviderOptions,
} from "./workTrackingGitLabProvider.js";
import {
  createJiraWorkTrackerProvider,
  jiraWorkTrackerCapabilitiesForConfig,
  type JiraWorkTrackerProviderOptions,
} from "./workTrackingJiraProvider.js";
import type {
  NexusProviderCredentialBroker,
  NexusProviderCredentialPurpose,
  NexusProviderCredentialRequest,
  NexusResolvedProviderCredential,
} from "../providers/nexusProviderCredentialBroker.js";
import { resolveProviderCredential } from "../providers/nexusProviderCredentialBroker.js";
import {
  createLocalWorkTrackerProvider,
  localWorkTrackerCapabilities,
} from "./workTrackingLocalProvider.js";
import {
  createVibeWorkTrackerProvider,
  vibeWorkTrackerCapabilities,
  type VibeWorkTrackerProviderOptions,
} from "./workTrackingVibeProvider.js";
import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  VibeKanbanWorkTrackingConfig,
  WorkTrackerActionCapabilities,
  WorkTrackerCapabilityName,
  WorkTrackerCapabilityReport,
  WorkTrackingConfig,
  WorkTrackerProvider,
  TrackerCapabilities,
  WorkTrackingRepositoryConfig,
} from "./workTrackingTypes.js";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
  credentials?: CreateWorkTrackerProviderCredentialOptions;
  github?: Omit<GitHubWorkTrackerProviderOptions, "config">;
  gitlab?: Omit<GitLabWorkTrackerProviderOptions, "config">;
  jira?: Omit<JiraWorkTrackerProviderOptions, "config">;
  vibeKanban?: Omit<VibeWorkTrackerProviderOptions, "config">;
}

export interface CreateWorkTrackerProviderCredentialOptions {
  broker: NexusProviderCredentialBroker;
  purpose?: NexusProviderCredentialPurpose;
  profileId?: string | null;
  actorId?: string | null;
  providerIdentity?: string | null;
  host?: string | null;
  repository?: WorkTrackingRepositoryConfig | null;
  requiredPermissions?: Record<string, string>;
}

export class WorkTrackingProviderServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkTrackingProviderServiceError";
  }
}

const workTrackerCapabilityNames: WorkTrackerCapabilityName[] = [
  "create",
  "list",
  "get",
  "update",
  "comment",
  "labels",
  "assignees",
  "milestones",
  "board",
  "boardStatus",
];

export function createWorkTrackerProvider(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  const credential = workTrackerUsesProviderCredentials(config)
    ? resolveWorkTrackerCredential(config, options.credentials)
    : undefined;

  return createWorkTrackerProviderFromCredential(config, options, credential);
}

export async function createWorkTrackerProviderAsync(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderOptions = {},
): Promise<WorkTrackerProvider> {
  const credential = workTrackerUsesProviderCredentials(config)
    ? await resolveWorkTrackerCredentialAsync(config, options.credentials)
    : undefined;

  return createWorkTrackerProviderFromCredential(config, options, credential);
}

function createWorkTrackerProviderFromCredential(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderOptions,
  credential: NexusResolvedProviderCredential | undefined,
): WorkTrackerProvider {
  const providerName = config.provider;

  if (config.provider === "local") {
    return createLocalWorkTrackerProvider({
      projectRoot: options.projectRoot,
      config,
      now: options.now,
    });
  }

  if (config.provider === "vibe-kanban") {
    if (!options.vibeKanban) {
      throw new WorkTrackingProviderServiceError(
        "Vibe Kanban provider requires Vibe Kanban API options",
      );
    }

    return createVibeWorkTrackerProvider({
      ...options.vibeKanban,
      config: config as VibeKanbanWorkTrackingConfig,
    });
  }

  if (config.provider === "github") {
    return createGitHubWorkTrackerProvider({
      ...options.github,
      ...credentialOptions(options.github?.env, credential),
      config: config as GitHubWorkTrackingConfig,
    });
  }

  if (config.provider === "gitlab") {
    return createGitLabWorkTrackerProvider({
      ...options.gitlab,
      env: mergedCredentialEnv(options.gitlab?.env, credential),
      config: config as GitLabWorkTrackingConfig,
    });
  }

  if (config.provider === "jira") {
    return createJiraWorkTrackerProvider({
      ...options.jira,
      env: mergedCredentialEnv(options.jira?.env, credential),
      config: config as JiraWorkTrackingConfig,
    });
  }

  throw new WorkTrackingProviderServiceError(
    `Work tracking provider is not available in DevNexus core: ${providerName}`,
  );
}

function workTrackerUsesProviderCredentials(config: WorkTrackingConfig): boolean {
  return (
    config.provider === "github" ||
    config.provider === "gitlab" ||
    config.provider === "jira"
  );
}

function resolveWorkTrackerCredential(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderCredentialOptions | undefined,
): NexusResolvedProviderCredential | undefined {
  if (!options) {
    return undefined;
  }

  return options.broker.resolveCredential(
    workTrackerCredentialRequest(config, options),
  );
}

async function resolveWorkTrackerCredentialAsync(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderCredentialOptions | undefined,
): Promise<NexusResolvedProviderCredential | undefined> {
  if (!options) {
    return undefined;
  }

  return resolveProviderCredential(
    options.broker,
    workTrackerCredentialRequest(config, options),
  );
}

function workTrackerCredentialRequest(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderCredentialOptions,
): NexusProviderCredentialRequest {
  return {
    provider: config.provider,
    purpose: options.purpose ?? "api",
    host: options.host ?? config.host ?? null,
    profileId: options.profileId ?? null,
    actorId: options.actorId ?? null,
    providerIdentity: options.providerIdentity ?? null,
    repository: options.repository ?? config.repository ?? null,
    ...(options.requiredPermissions
      ? { requiredPermissions: options.requiredPermissions }
      : {}),
  };
}

function credentialOptions(
  env: Record<string, string | undefined> | undefined,
  credential: NexusResolvedProviderCredential | undefined,
): Pick<GitHubWorkTrackerProviderOptions, "authorizationHeader" | "env"> {
  const mergedEnv = mergedCredentialEnv(env, credential);
  return {
    ...(credential?.authorizationHeader
      ? { authorizationHeader: credential.authorizationHeader }
      : {}),
    ...(mergedEnv ? { env: mergedEnv } : {}),
  };
}

function mergedCredentialEnv(
  env: Record<string, string | undefined> | undefined,
  credential: NexusResolvedProviderCredential | undefined,
): Record<string, string | undefined> | undefined {
  if (!credential?.env) {
    return env;
  }

  return {
    ...(env ?? {}),
    ...credential.env,
  };
}

export function workTrackerCapabilityReportForConfig(
  config: WorkTrackingConfig,
): WorkTrackerCapabilityReport {
  return workTrackerCapabilityReportFromCapabilities(
    config.provider,
    workTrackerCapabilitiesForConfig(config),
  );
}

export function workTrackerCapabilityReport(
  provider: Pick<WorkTrackerProvider, "provider" | "capabilities">,
): WorkTrackerCapabilityReport {
  return workTrackerCapabilityReportFromCapabilities(
    provider.provider,
    provider.capabilities,
  );
}

export function assertWorkTrackerCapability(
  provider: Pick<WorkTrackerProvider, "provider" | "capabilities">,
  capability: WorkTrackerCapabilityName,
  operation: string,
): void {
  const report = workTrackerCapabilityReport(provider);
  if (report.capabilities[capability]) {
    return;
  }

  throw new WorkTrackingProviderServiceError(
    `Work tracking provider "${provider.provider}" cannot ${operation}; ` +
      `required capability "${capability}" is disabled`,
  );
}

export function workTrackerCapabilitiesForConfig(
  config: WorkTrackingConfig,
): TrackerCapabilities {
  const providerName = config.provider;
  if (config.provider === "local") {
    return localWorkTrackerCapabilities;
  }
  if (config.provider === "vibe-kanban") {
    return vibeWorkTrackerCapabilities;
  }
  if (config.provider === "github") {
    return githubWorkTrackerCapabilitiesForConfig(config);
  }
  if (config.provider === "gitlab") {
    return gitLabWorkTrackerCapabilities;
  }
  if (config.provider === "jira") {
    return jiraWorkTrackerCapabilitiesForConfig(config);
  }

  throw new WorkTrackingProviderServiceError(
    `Work tracking provider is not available in DevNexus core: ${providerName}`,
  );
}

function workTrackerCapabilityReportFromCapabilities(
  provider: string,
  capabilities: TrackerCapabilities,
): WorkTrackerCapabilityReport {
  const actionCapabilities = workTrackerActionCapabilities(capabilities);
  return {
    provider,
    capabilities: actionCapabilities,
    unsupported: workTrackerCapabilityNames.filter(
      (capability) => !actionCapabilities[capability],
    ),
  };
}

function workTrackerActionCapabilities(
  capabilities: TrackerCapabilities,
): WorkTrackerActionCapabilities {
  const board = capabilities.board;
  return {
    create: capabilities.createItem,
    list: capabilities.listItems,
    get: capabilities.getItem,
    update: capabilities.updateItem,
    comment: capabilities.comment,
    labels: capabilities.labels,
    assignees: capabilities.assignees,
    milestones: capabilities.milestones,
    board,
    boardStatus: board && capabilities.boardStatus,
  };
}
