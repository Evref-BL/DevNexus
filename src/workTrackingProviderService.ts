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
import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  WorkTrackingConfig,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
  github?: Omit<GitHubWorkTrackerProviderOptions, "config">;
  gitlab?: Omit<GitLabWorkTrackerProviderOptions, "config">;
  jira?: Omit<JiraWorkTrackerProviderOptions, "config">;
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
  if (config.provider === "local") {
    return createLocalWorkTrackerProvider({
      projectRoot: options.projectRoot,
      config,
      now: options.now,
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
    `Work tracking provider is not available in DevNexus core: ${config.provider}`,
  );
}
