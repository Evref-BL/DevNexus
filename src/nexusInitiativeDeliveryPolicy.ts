import {
  defaultNexusInitiativeDeliveryConfig,
  type NexusInitiativeDeliveryConfig,
  type NexusInitiativeDeliveryBranchPublicationStrategy,
  type NexusInitiativeDeliveryFinalPullRequestCreationPolicy,
  type NexusInitiativeDeliveryTopology,
} from "./nexusAutomationConfig.js";
import { parseGitHubRemoteUrl } from "./nexusForgeRepositoryResolver.js";

export interface NexusInitiativeDeliveryBranchPlanSummary {
  topology: NexusInitiativeDeliveryTopology;
  targetBranch: string;
  integrationBranch: string | null;
  sliceBranchPattern: string;
  defaultSliceBaseBranch: string;
  defaultSliceReviewTarget: string;
  finalReviewTarget: string;
  finalPublicationTarget: string;
  usesStackParent: boolean;
  requiresIntegrationBranchApproval: boolean;
}

export interface NexusInitiativeDeliveryBranchPublicationSummary {
  strategy: NexusInitiativeDeliveryBranchPublicationStrategy;
  publicationRemote: string | null;
  fallbackRemote: string | null;
  selectedRemote: string | null;
  selectedRemoteUrl: string | null;
  selectedRemotePushUrl: string | null;
  requiresFallbackApproval: boolean;
  finalPullRequestHead: NexusInitiativeDeliveryPullRequestHeadSummary;
}

export type NexusInitiativeDeliveryPullRequestHeadStatus =
  | "upstream_branch"
  | "fork_branch"
  | "manual_only"
  | "blocked";

export interface NexusInitiativeDeliveryPullRequestHeadSummary {
  status: NexusInitiativeDeliveryPullRequestHeadStatus;
  branch: string | null;
  remote: string | null;
  remoteUrl: string | null;
  provider: "github" | null;
  host: string | null;
  owner: string | null;
  repository: string | null;
  displayRef: string | null;
  setupAction: string | null;
}

export interface NexusInitiativeDeliveryPolicySummary {
  enabled: boolean;
  activeInitiativeId: string | null;
  activeScopeId: string;
  branchSlug: string;
  defaultIntentPrefix: string;
  allowedIntentPrefixes: string[];
  defaultTopology: NexusInitiativeDeliveryTopology;
  allowedTopologies: NexusInitiativeDeliveryTopology[];
  reviewMode: string;
  finalPullRequest: boolean;
  finalPullRequestCreation: NexusInitiativeDeliveryFinalPullRequestCreationPolicy;
  providerNoise: string;
  branchPublication: NexusInitiativeDeliveryBranchPublicationSummary;
  branchPlan: NexusInitiativeDeliveryBranchPlanSummary;
  warnings: string[];
}

export function summarizeNexusInitiativeDeliveryPolicy(options: {
  config: NexusInitiativeDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
  targetBranch: string;
  publicationRemote?: string | null;
  remoteUrls?: Record<string, string | null | undefined>;
  remotePushUrls?: Record<string, string | null | undefined>;
}): NexusInitiativeDeliveryPolicySummary {
  const config = mergeInitiativeDeliveryDefaults(options.config);
  const activeScopeId =
    config.activeInitiativeId ?? options.fallbackScopeId ?? options.unscopedName;
  const branchSlug = branchSlugFor(activeScopeId);
  const integrationBranch = renderInitiativeBranchPattern(
    config.branchNaming.integrationBranchPattern,
    {
      intent: config.branchNaming.defaultIntentPrefix,
      initiative: branchSlug,
      slice: null,
    },
  );
  const sliceBranchPattern = renderInitiativeBranchPattern(
    config.branchNaming.sliceBranchPattern,
    {
      intent: config.branchNaming.defaultIntentPrefix,
      initiative: branchSlug,
      slice: "{slice}",
    },
  );
  const usesIntegrationBranch = topologyUsesIntegrationBranch(
    config.defaultTopology,
  );
  const usesStackParent = config.defaultTopology === "stacked" ||
    config.defaultTopology === "hybrid";
  const defaultSliceBaseBranch = usesIntegrationBranch
    ? integrationBranch
    : options.targetBranch;
  const defaultSliceReviewTarget =
    config.defaultTopology === "stacked"
      ? "parent_slice_or_target"
      : usesIntegrationBranch
        ? integrationBranch
        : options.targetBranch;
  const warnings = initiativeDeliveryWarnings({
    config,
    fallbackScopeId: options.fallbackScopeId,
    unscopedName: options.unscopedName,
    publicationRemote: options.publicationRemote ?? null,
  });
  const branchPublication = initiativeBranchPublicationSummary({
    config,
    publicationRemote: options.publicationRemote ?? null,
    remoteUrls: options.remoteUrls ?? {},
    remotePushUrls: options.remotePushUrls ?? {},
    headBranch: usesIntegrationBranch ? integrationBranch : null,
  });

  return {
    enabled: config.enabled,
    activeInitiativeId: config.activeInitiativeId,
    activeScopeId,
    branchSlug,
    defaultIntentPrefix: config.branchNaming.defaultIntentPrefix,
    allowedIntentPrefixes: [...config.branchNaming.allowedIntentPrefixes],
    defaultTopology: config.defaultTopology,
    allowedTopologies: [...config.allowedTopologies],
    reviewMode: config.review.mode,
    finalPullRequest: config.review.finalPullRequest,
    finalPullRequestCreation: config.review.finalPullRequestCreation,
    providerNoise: config.provider.noise,
    branchPublication,
    branchPlan: {
      topology: config.defaultTopology,
      targetBranch: options.targetBranch,
      integrationBranch: usesIntegrationBranch ? integrationBranch : null,
      sliceBranchPattern,
      defaultSliceBaseBranch,
      defaultSliceReviewTarget,
      finalReviewTarget: usesIntegrationBranch
        ? options.targetBranch
        : defaultSliceReviewTarget,
      finalPublicationTarget: options.targetBranch,
      usesStackParent,
      requiresIntegrationBranchApproval: usesIntegrationBranch,
    },
    warnings,
  };
}

export function renderInitiativeBranchPattern(
  pattern: string,
  values: {
    intent: string;
    initiative: string;
    slice: string | null;
  },
): string {
  return pattern
    .replaceAll("{intent}", values.intent)
    .replaceAll("{initiative}", values.initiative)
    .replaceAll("{slice}", values.slice ?? "{slice}")
    .replace(/\/+$/u, "");
}

export function branchSlugFor(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "manual";
}

function mergeInitiativeDeliveryDefaults(
  config: NexusInitiativeDeliveryConfig,
): NexusInitiativeDeliveryConfig {
  return {
    ...defaultNexusInitiativeDeliveryConfig,
    ...config,
    allowedTopologies:
      config.allowedTopologies.length > 0
        ? [...config.allowedTopologies]
        : [...defaultNexusInitiativeDeliveryConfig.allowedTopologies],
    branchNaming: {
      ...defaultNexusInitiativeDeliveryConfig.branchNaming,
      ...config.branchNaming,
      allowedIntentPrefixes:
        config.branchNaming.allowedIntentPrefixes.length > 0
          ? [...config.branchNaming.allowedIntentPrefixes]
          : [
              ...defaultNexusInitiativeDeliveryConfig.branchNaming
                .allowedIntentPrefixes,
            ],
    },
    review: {
      ...defaultNexusInitiativeDeliveryConfig.review,
      ...config.review,
    },
    provider: {
      ...defaultNexusInitiativeDeliveryConfig.provider,
      ...config.provider,
    },
    branchPublication: {
      ...defaultNexusInitiativeDeliveryConfig.branchPublication,
      ...config.branchPublication,
    },
  };
}

function initiativeDeliveryWarnings(options: {
  config: NexusInitiativeDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
  publicationRemote: string | null;
}): string[] {
  const warnings: string[] = [];
  if (
    options.config.enabled &&
    !options.config.activeInitiativeId &&
    !options.fallbackScopeId
  ) {
    warnings.push(
      `initiative delivery has no active initiative id; using ${options.unscopedName}`,
    );
  }
  if (
    options.config.enabled &&
    options.config.defaultTopology === "throwaway_rehearsal"
  ) {
    warnings.push("throw-away rehearsal branches must not become publication sources");
  }
  if (
    options.config.enabled &&
    options.config.branchPublication.strategy === "publication_remote" &&
    !options.publicationRemote
  ) {
    warnings.push("initiative branch publication requires a configured publication remote");
  }
  return warnings;
}

function initiativeBranchPublicationSummary(options: {
  config: NexusInitiativeDeliveryConfig;
  publicationRemote: string | null;
  remoteUrls: Record<string, string | null | undefined>;
  remotePushUrls: Record<string, string | null | undefined>;
  headBranch: string | null;
}): NexusInitiativeDeliveryBranchPublicationSummary {
  const { strategy, fallbackRemote } = options.config.branchPublication;
  const selectedRemote = selectedBranchPublicationRemote({
    strategy,
    publicationRemote: options.publicationRemote,
    fallbackRemote,
  });
  const selectedRemoteUrl = selectedRemote
    ? cleanRemoteUrl(options.remoteUrls[selectedRemote])
    : null;
  const selectedRemotePushUrl = selectedRemote
    ? cleanRemoteUrl(options.remotePushUrls[selectedRemote])
    : null;
  return {
    strategy,
    publicationRemote: options.publicationRemote,
    fallbackRemote,
    selectedRemote,
    selectedRemoteUrl,
    selectedRemotePushUrl,
    requiresFallbackApproval:
      strategy === "publication_remote_then_fallback" && Boolean(fallbackRemote),
    finalPullRequestHead: pullRequestHeadSummary({
      strategy,
      publicationRemote: options.publicationRemote,
      fallbackRemote,
      selectedRemote,
      selectedRemoteUrl,
      selectedRemotePushUrl,
      headBranch: options.headBranch,
    }),
  };
}

function pullRequestHeadSummary(options: {
  strategy: NexusInitiativeDeliveryBranchPublicationStrategy;
  publicationRemote: string | null;
  fallbackRemote: string | null;
  selectedRemote: string | null;
  selectedRemoteUrl: string | null;
  selectedRemotePushUrl: string | null;
  headBranch: string | null;
}): NexusInitiativeDeliveryPullRequestHeadSummary {
  if (options.strategy === "manual_only") {
    return blockedHead("manual_only", options, "branch publication is manual-only");
  }
  if (!options.headBranch) {
    return blockedHead(
      "blocked",
      options,
      "initiative topology has no stable final pull request head branch",
    );
  }
  if (!options.selectedRemote) {
    return blockedHead(
      "blocked",
      options,
      "initiative branch publication has no selected remote",
    );
  }

  const remoteUrl = options.selectedRemotePushUrl ?? options.selectedRemoteUrl;
  const parsed = parseGitHubRemoteUrl(remoteUrl);
  const usesFallbackRemote = options.selectedRemote === options.fallbackRemote &&
    options.selectedRemote !== options.publicationRemote;
  if (usesFallbackRemote && !remoteUrl) {
    return blockedHead(
      "blocked",
      options,
      `configure remote ${options.selectedRemote} with a GitHub URL before creating a fork pull request`,
    );
  }
  if (usesFallbackRemote && !parsed) {
    return blockedHead(
      "blocked",
      options,
      `remote ${options.selectedRemote} must be a GitHub URL before creating a fork pull request`,
    );
  }

  return {
    status: usesFallbackRemote ? "fork_branch" : "upstream_branch",
    branch: options.headBranch,
    remote: options.selectedRemote,
    remoteUrl,
    provider: parsed ? "github" : null,
    host: parsed?.host ?? null,
    owner: parsed?.owner ?? null,
    repository: parsed?.name ?? null,
    displayRef: usesFallbackRemote && parsed
      ? `${parsed.owner}:${options.headBranch}`
      : options.headBranch,
    setupAction: null,
  };
}

function blockedHead(
  status: "manual_only" | "blocked",
  options: {
    selectedRemote: string | null;
    selectedRemoteUrl: string | null;
    selectedRemotePushUrl: string | null;
    headBranch: string | null;
  },
  setupAction: string,
): NexusInitiativeDeliveryPullRequestHeadSummary {
  return {
    status,
    branch: options.headBranch,
    remote: options.selectedRemote,
    remoteUrl: options.selectedRemotePushUrl ?? options.selectedRemoteUrl,
    provider: null,
    host: null,
    owner: null,
    repository: null,
    displayRef: null,
    setupAction,
  };
}

function cleanRemoteUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function selectedBranchPublicationRemote(options: {
  strategy: NexusInitiativeDeliveryBranchPublicationStrategy;
  publicationRemote: string | null;
  fallbackRemote: string | null;
}): string | null {
  switch (options.strategy) {
    case "publication_remote":
      return options.publicationRemote;
    case "fallback_remote":
      return options.fallbackRemote;
    case "publication_remote_then_fallback":
      return options.publicationRemote ?? options.fallbackRemote;
    case "manual_only":
      return null;
  }
}

function topologyUsesIntegrationBranch(
  topology: NexusInitiativeDeliveryTopology,
): boolean {
  return (
    topology === "integration_branch" ||
    topology === "hybrid" ||
    topology === "throwaway_rehearsal"
  );
}
