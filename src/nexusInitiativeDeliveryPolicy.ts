import {
  defaultNexusFeatureBranchDeliveryConfig,
  type NexusFeatureBranchDeliveryConfig,
  type NexusFeatureBranchDeliveryBranchPublicationStrategy,
  type NexusFeatureBranchDeliveryFinalPullRequestCreationPolicy,
  type NexusFeatureBranchDeliveryBranchStrategy,
} from "./nexusAutomationConfig.js";
import { parseGitHubRemoteUrl } from "./nexusForgeRepositoryResolver.js";

export interface NexusInitiativeDeliveryBranchPlanSummary {
  topology: NexusFeatureBranchDeliveryBranchStrategy;
  targetBranch: string;
  integrationBranch: string | null;
  reviewBranchPattern: string;
  defaultSliceBaseBranch: string;
  defaultSliceReviewTarget: string;
  finalReviewTarget: string;
  finalPublicationTarget: string;
  usesStackParent: boolean;
  requiresIntegrationBranchApproval: boolean;
  stack: NexusInitiativeDeliveryStackSummary;
}

export type NexusInitiativeDeliveryStackStatus =
  | "not_applicable"
  | "active"
  | "excluded_from_publication";

export interface NexusInitiativeDeliveryStackSliceSummary {
  order: number;
  sliceSlug: string;
  branch: string;
  parentBranch: string | null;
  childBranches: string[];
  reviewTarget: string;
  publicationEligible: boolean;
}

export interface NexusInitiativeDeliveryStackSummary {
  status: NexusInitiativeDeliveryStackStatus;
  topology: NexusFeatureBranchDeliveryBranchStrategy;
  publicationEligible: boolean;
  rootBranch: string | null;
  defaultParentBranch: string | null;
  defaultReviewTarget: string;
  finalPublicationTarget: string;
  slices: NexusInitiativeDeliveryStackSliceSummary[];
}

export interface NexusInitiativeDeliveryBranchPublicationSummary {
  strategy: NexusFeatureBranchDeliveryBranchPublicationStrategy;
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
  activeFeatureId: string | null;
  activeScopeId: string;
  branchSlug: string;
  defaultIntentPrefix: string;
  allowedIntentPrefixes: string[];
  defaultBranchStrategy: NexusFeatureBranchDeliveryBranchStrategy;
  allowedBranchStrategies: NexusFeatureBranchDeliveryBranchStrategy[];
  reviewMode: string;
  finalPullRequest: boolean;
  finalPullRequestCreation: NexusFeatureBranchDeliveryFinalPullRequestCreationPolicy;
  commentPolicy: string;
  branchPublication: NexusInitiativeDeliveryBranchPublicationSummary;
  branchPlan: NexusInitiativeDeliveryBranchPlanSummary;
  warnings: string[];
}

export function summarizeNexusInitiativeDeliveryPolicy(options: {
  config: NexusFeatureBranchDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
  targetBranch: string;
  publicationRemote?: string | null;
  remoteUrls?: Record<string, string | null | undefined>;
  remotePushUrls?: Record<string, string | null | undefined>;
}): NexusInitiativeDeliveryPolicySummary {
  const config = mergeInitiativeDeliveryDefaults(options.config);
  const activeScopeId =
    config.activeFeatureId ?? options.fallbackScopeId ?? options.unscopedName;
  const branchSlug = branchSlugFor(activeScopeId);
  const integrationBranch = renderInitiativeBranchPattern(
    config.branchNaming.featureBranchPattern,
    {
      intent: config.branchNaming.defaultIntentPrefix,
      feature: branchSlug,
      change: null,
    },
  );
  const reviewBranchPattern = renderInitiativeBranchPattern(
    config.branchNaming.reviewBranchPattern,
    {
      intent: config.branchNaming.defaultIntentPrefix,
      feature: branchSlug,
      change: "{change}",
    },
  );
  const usesIntegrationBranch = topologyUsesIntegrationBranch(
    config.defaultBranchStrategy,
  );
  const usesStackParent = config.defaultBranchStrategy === "stacked" ||
    config.defaultBranchStrategy === "hybrid";
  const defaultSliceBaseBranch = usesIntegrationBranch
    ? integrationBranch
    : options.targetBranch;
  const defaultSliceReviewTarget =
    config.defaultBranchStrategy === "stacked"
      ? "parent_slice_or_target"
      : usesIntegrationBranch
        ? integrationBranch
        : options.targetBranch;
  const warnings = featureBranchDeliveryWarnings({
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
    activeFeatureId: config.activeFeatureId,
    activeScopeId,
    branchSlug,
    defaultIntentPrefix: config.branchNaming.defaultIntentPrefix,
    allowedIntentPrefixes: [...config.branchNaming.allowedIntentPrefixes],
    defaultBranchStrategy: config.defaultBranchStrategy,
    allowedBranchStrategies: [...config.allowedBranchStrategies],
    reviewMode: config.review.mode,
    finalPullRequest: config.review.finalPullRequest,
    finalPullRequestCreation: config.review.finalPullRequestCreation,
    commentPolicy: config.provider.commentPolicy,
    branchPublication,
    branchPlan: {
      topology: config.defaultBranchStrategy,
      targetBranch: options.targetBranch,
      integrationBranch: usesIntegrationBranch ? integrationBranch : null,
      reviewBranchPattern,
      defaultSliceBaseBranch,
      defaultSliceReviewTarget,
      finalReviewTarget: usesIntegrationBranch
        ? options.targetBranch
        : defaultSliceReviewTarget,
      finalPublicationTarget: options.targetBranch,
      usesStackParent,
      requiresIntegrationBranchApproval: usesIntegrationBranch,
      stack: stackSummary({
        topology: config.defaultBranchStrategy,
        usesStackParent,
        integrationBranch: usesIntegrationBranch ? integrationBranch : null,
        targetBranch: options.targetBranch,
        defaultSliceReviewTarget,
      }),
    },
    warnings,
  };
}

export function buildNexusInitiativeStackSliceSummary(options: {
  order: number;
  sliceSlug: string;
  branch: string;
  parentBranch: string | null;
  childBranches?: string[];
  reviewTarget: string;
  publicationEligible: boolean;
}): NexusInitiativeDeliveryStackSliceSummary {
  return {
    order: options.order,
    sliceSlug: options.sliceSlug,
    branch: options.branch,
    parentBranch: options.parentBranch,
    childBranches: [...(options.childBranches ?? [])],
    reviewTarget: options.reviewTarget,
    publicationEligible: options.publicationEligible,
  };
}

export function renderInitiativeBranchPattern(
  pattern: string,
  values: {
    intent: string;
    feature: string;
    change: string | null;
  },
): string {
  return pattern
    .replaceAll("{intent}", values.intent)
    .replaceAll("{feature}", values.feature)
    .replaceAll("{change}", values.change ?? "{change}")
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
  config: NexusFeatureBranchDeliveryConfig,
): NexusFeatureBranchDeliveryConfig {
  return {
    ...defaultNexusFeatureBranchDeliveryConfig,
    ...config,
    allowedBranchStrategies:
      config.allowedBranchStrategies.length > 0
        ? [...config.allowedBranchStrategies]
        : [...defaultNexusFeatureBranchDeliveryConfig.allowedBranchStrategies],
    branchNaming: {
      ...defaultNexusFeatureBranchDeliveryConfig.branchNaming,
      ...config.branchNaming,
      allowedIntentPrefixes:
        config.branchNaming.allowedIntentPrefixes.length > 0
          ? [...config.branchNaming.allowedIntentPrefixes]
          : [
              ...defaultNexusFeatureBranchDeliveryConfig.branchNaming
                .allowedIntentPrefixes,
            ],
    },
    review: {
      ...defaultNexusFeatureBranchDeliveryConfig.review,
      ...config.review,
    },
    provider: {
      ...defaultNexusFeatureBranchDeliveryConfig.provider,
      ...config.provider,
    },
    branchPublication: {
      ...defaultNexusFeatureBranchDeliveryConfig.branchPublication,
      ...config.branchPublication,
    },
  };
}

function featureBranchDeliveryWarnings(options: {
  config: NexusFeatureBranchDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
  publicationRemote: string | null;
}): string[] {
  const warnings: string[] = [];
  if (
    options.config.enabled &&
    !options.config.activeFeatureId &&
    !options.fallbackScopeId
  ) {
    warnings.push(
      `initiative delivery has no active initiative id; using ${options.unscopedName}`,
    );
  }
  if (
    options.config.enabled &&
    options.config.defaultBranchStrategy === "throwaway_rehearsal"
  ) {
    warnings.push("throw-away rehearsal branches must not become publication sources");
  }
  if (
    options.config.enabled &&
    options.config.branchPublication.strategy === "push_remote" &&
    !options.publicationRemote
  ) {
    warnings.push("initiative branch publication requires a configured publication remote");
  }
  return warnings;
}

function stackSummary(options: {
  topology: NexusFeatureBranchDeliveryBranchStrategy;
  usesStackParent: boolean;
  integrationBranch: string | null;
  targetBranch: string;
  defaultSliceReviewTarget: string;
}): NexusInitiativeDeliveryStackSummary {
  const publicationEligible = options.topology !== "throwaway_rehearsal";
  if (!publicationEligible) {
    const rootBranch = options.integrationBranch ?? options.targetBranch;
    return {
      status: "excluded_from_publication",
      topology: options.topology,
      publicationEligible,
      rootBranch,
      defaultParentBranch: rootBranch,
      defaultReviewTarget: options.defaultSliceReviewTarget,
      finalPublicationTarget: options.targetBranch,
      slices: [],
    };
  }
  if (!options.usesStackParent) {
    return {
      status: "not_applicable",
      topology: options.topology,
      publicationEligible,
      rootBranch: null,
      defaultParentBranch: null,
      defaultReviewTarget: options.defaultSliceReviewTarget,
      finalPublicationTarget: options.targetBranch,
      slices: [],
    };
  }
  const rootBranch = options.integrationBranch ?? options.targetBranch;
  return {
    status: publicationEligible ? "active" : "excluded_from_publication",
    topology: options.topology,
    publicationEligible,
    rootBranch,
    defaultParentBranch: rootBranch,
    defaultReviewTarget: options.defaultSliceReviewTarget,
    finalPublicationTarget: options.targetBranch,
    slices: [],
  };
}

function initiativeBranchPublicationSummary(options: {
  config: NexusFeatureBranchDeliveryConfig;
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
      strategy === "push_remote_then_fallback" && Boolean(fallbackRemote),
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
  strategy: NexusFeatureBranchDeliveryBranchPublicationStrategy;
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
  strategy: NexusFeatureBranchDeliveryBranchPublicationStrategy;
  publicationRemote: string | null;
  fallbackRemote: string | null;
}): string | null {
  switch (options.strategy) {
    case "push_remote":
      return options.publicationRemote;
    case "fallback_remote":
      return options.fallbackRemote;
    case "push_remote_then_fallback":
      return options.publicationRemote ?? options.fallbackRemote;
    case "manual_only":
      return null;
  }
}

function topologyUsesIntegrationBranch(
  topology: NexusFeatureBranchDeliveryBranchStrategy,
): boolean {
  return (
    topology === "integration_branch" ||
    topology === "hybrid" ||
    topology === "throwaway_rehearsal"
  );
}
