import {
  createGitHubWorkTrackerProvider,
  type GitHubWorkTrackerProviderOptions,
} from "./workTrackingGitHubProvider.js";
import {
  createGitLabWorkTrackerProvider,
  type GitLabWorkTrackerProviderOptions,
} from "./workTrackingGitLabProvider.js";
import {
  createJiraWorkTrackerProvider,
  type JiraWorkTrackerProviderOptions,
} from "./workTrackingJiraProvider.js";
import { createLocalWorkTrackerProvider } from "./workTrackingLocalProvider.js";
import {
  createVibeWorkTrackerProvider,
  type VibeWorkTrackerProviderOptions,
} from "./workTrackingVibeProvider.js";
import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  VibeKanbanWorkTrackingConfig,
  WorkTrackingConfig,
  WorkTrackerProvider,
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
