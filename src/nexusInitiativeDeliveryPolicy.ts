import {
  defaultNexusInitiativeDeliveryConfig,
  type NexusInitiativeDeliveryConfig,
  type NexusInitiativeDeliveryBranchPublicationStrategy,
  type NexusInitiativeDeliveryFinalPullRequestCreationPolicy,
  type NexusInitiativeDeliveryTopology,
} from "./nexusAutomationConfig.js";

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
  requiresFallbackApproval: boolean;
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
}): NexusInitiativeDeliveryBranchPublicationSummary {
  const { strategy, fallbackRemote } = options.config.branchPublication;
  const selectedRemote = selectedBranchPublicationRemote({
    strategy,
    publicationRemote: options.publicationRemote,
    fallbackRemote,
  });
  return {
    strategy,
    publicationRemote: options.publicationRemote,
    fallbackRemote,
    selectedRemote,
    requiresFallbackApproval:
      strategy === "publication_remote_then_fallback" && Boolean(fallbackRemote),
  };
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
