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
} from "./workTrackingTypes.js";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
  github?: Omit<GitHubWorkTrackerProviderOptions, "config">;
  gitlab?: Omit<GitLabWorkTrackerProviderOptions, "config">;
  jira?: Omit<JiraWorkTrackerProviderOptions, "config">;
  vibeKanban?: Omit<VibeWorkTrackerProviderOptions, "config">;
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
      config: config as GitHubWorkTrackingConfig,
    });
  }

  if (config.provider === "gitlab") {
    return createGitLabWorkTrackerProvider({
      ...options.gitlab,
      config: config as GitLabWorkTrackingConfig,
    });
  }

  if (config.provider === "jira") {
    return createJiraWorkTrackerProvider({
      ...options.jira,
      config: config as JiraWorkTrackingConfig,
    });
  }

  throw new WorkTrackingProviderServiceError(
    `Work tracking provider is not available in DevNexus core: ${providerName}`,
  );
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
