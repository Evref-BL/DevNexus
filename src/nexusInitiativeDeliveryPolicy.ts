import {
  defaultNexusInitiativeDeliveryConfig,
  type NexusInitiativeDeliveryConfig,
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
  providerNoise: string;
  branchPlan: NexusInitiativeDeliveryBranchPlanSummary;
  warnings: string[];
}

export function summarizeNexusInitiativeDeliveryPolicy(options: {
  config: NexusInitiativeDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
  targetBranch: string;
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
    providerNoise: config.provider.noise,
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
  };
}

function initiativeDeliveryWarnings(options: {
  config: NexusInitiativeDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
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
  return warnings;
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
