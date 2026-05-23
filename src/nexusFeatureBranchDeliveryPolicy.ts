import {
  defaultNexusFeatureBranchDeliveryConfig,
  type NexusFeatureBranchDeliveryConfig,
  type NexusFeatureBranchDeliveryBranchPublicationStrategy,
  type NexusFeatureBranchDeliveryFinalPullRequestCreationPolicy,
  type NexusFeatureBranchDeliveryBranchStrategy,
} from "./nexusAutomationConfig.js";
import { parseGitHubRemoteUrl } from "./nexusForgeRepositoryResolver.js";
import {
  isLowerAsciiLetterOrDigit,
  replaceRunsWithHyphen,
  trimHyphens,
} from "./nexusTextNormalization.js";

export interface NexusFeatureBranchDeliveryBranchPlanSummary {
  branchStrategy: NexusFeatureBranchDeliveryBranchStrategy;
  targetBranch: string;
  featureBranch: string | null;
  reviewBranchPattern: string;
  defaultChangeBaseBranch: string;
  defaultChangeReviewTarget: string;
  finalReviewTarget: string;
  finalPublicationTarget: string;
  usesStackParent: boolean;
  requiresFeatureBranchApproval: boolean;
  stack: NexusFeatureBranchDeliveryStackSummary;
}

export type NexusFeatureBranchDeliveryStackStatus =
  | "not_applicable"
  | "active"
  | "excluded_from_publication";

export interface NexusFeatureBranchDeliveryStackChangeSummary {
  order: number;
  changeSlug: string;
  branch: string;
  parentBranch: string | null;
  childBranches: string[];
  reviewTarget: string;
  publicationEligible: boolean;
}

export interface NexusFeatureBranchDeliveryStackSummary {
  status: NexusFeatureBranchDeliveryStackStatus;
  branchStrategy: NexusFeatureBranchDeliveryBranchStrategy;
  publicationEligible: boolean;
  rootBranch: string | null;
  defaultParentBranch: string | null;
  defaultReviewTarget: string;
  finalPublicationTarget: string;
  changes: NexusFeatureBranchDeliveryStackChangeSummary[];
}

export interface NexusFeatureBranchDeliveryBranchPublicationSummary {
  strategy: NexusFeatureBranchDeliveryBranchPublicationStrategy;
  pushRemote: string | null;
  fallbackRemote: string | null;
  selectedRemote: string | null;
  selectedRemoteUrl: string | null;
  selectedRemotePushUrl: string | null;
  requiresFallbackApproval: boolean;
  finalPullRequestHead: NexusFeatureBranchDeliveryPullRequestHeadSummary;
}

export type NexusFeatureBranchDeliveryPullRequestHeadStatus =
  | "upstream_branch"
  | "fork_branch"
  | "manual_only"
  | "blocked";

export interface NexusFeatureBranchDeliveryPullRequestHeadSummary {
  status: NexusFeatureBranchDeliveryPullRequestHeadStatus;
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

export interface NexusFeatureBranchDeliveryPolicySummary {
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
  branchPublication: NexusFeatureBranchDeliveryBranchPublicationSummary;
  branchPlan: NexusFeatureBranchDeliveryBranchPlanSummary;
  warnings: string[];
}

export function summarizeNexusFeatureBranchDeliveryPolicy(options: {
  config: NexusFeatureBranchDeliveryConfig;
  fallbackScopeId: string | null;
  unscopedName: string;
  targetBranch: string;
  pushRemote?: string | null;
  remoteUrls?: Record<string, string | null | undefined>;
  remotePushUrls?: Record<string, string | null | undefined>;
}): NexusFeatureBranchDeliveryPolicySummary {
  const config = mergeFeatureBranchDeliveryDefaults(options.config);
  const activeScopeId =
    config.activeFeatureId ?? options.fallbackScopeId ?? options.unscopedName;
  const branchSlug = branchSlugFor(activeScopeId);
  const featureBranch = renderFeatureBranchPattern(
    config.branchNaming.featureBranchPattern,
    {
      intent: config.branchNaming.defaultIntentPrefix,
      feature: branchSlug,
      change: null,
    },
  );
  const reviewBranchPattern = renderFeatureBranchPattern(
    config.branchNaming.reviewBranchPattern,
    {
      intent: config.branchNaming.defaultIntentPrefix,
      feature: branchSlug,
      change: "{change}",
    },
  );
  const usesFeatureBranch = branchStrategyUsesFeatureBranch(
    config.defaultBranchStrategy,
  );
  const usesStackParent = config.defaultBranchStrategy === "stacked" ||
    config.defaultBranchStrategy === "hybrid";
  const defaultChangeBaseBranch = usesFeatureBranch
    ? featureBranch
    : options.targetBranch;
  const defaultChangeReviewTarget =
    config.defaultBranchStrategy === "stacked"
      ? "parent_change_or_target"
      : usesFeatureBranch
        ? featureBranch
        : options.targetBranch;
  const warnings = featureBranchDeliveryWarnings({
    config,
    fallbackScopeId: options.fallbackScopeId,
    unscopedName: options.unscopedName,
    pushRemote: options.pushRemote ?? null,
  });
  const branchPublication = featureBranchPublicationSummary({
    config,
    pushRemote: options.pushRemote ?? null,
    remoteUrls: options.remoteUrls ?? {},
    remotePushUrls: options.remotePushUrls ?? {},
    headBranch: usesFeatureBranch ? featureBranch : null,
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
      branchStrategy: config.defaultBranchStrategy,
      targetBranch: options.targetBranch,
      featureBranch: usesFeatureBranch ? featureBranch : null,
      reviewBranchPattern,
      defaultChangeBaseBranch,
      defaultChangeReviewTarget,
      finalReviewTarget: usesFeatureBranch
        ? options.targetBranch
        : defaultChangeReviewTarget,
      finalPublicationTarget: options.targetBranch,
      usesStackParent,
      requiresFeatureBranchApproval: usesFeatureBranch,
      stack: stackSummary({
        branchStrategy: config.defaultBranchStrategy,
        usesStackParent,
        featureBranch: usesFeatureBranch ? featureBranch : null,
        targetBranch: options.targetBranch,
        defaultChangeReviewTarget,
      }),
    },
    warnings,
  };
}

export function buildNexusFeatureStackChangeSummary(options: {
  order: number;
  changeSlug: string;
  branch: string;
  parentBranch: string | null;
  childBranches?: string[];
  reviewTarget: string;
  publicationEligible: boolean;
}): NexusFeatureBranchDeliveryStackChangeSummary {
  return {
    order: options.order,
    changeSlug: options.changeSlug,
    branch: options.branch,
    parentBranch: options.parentBranch,
    childBranches: [...(options.childBranches ?? [])],
    reviewTarget: options.reviewTarget,
    publicationEligible: options.publicationEligible,
  };
}

export function renderFeatureBranchPattern(
  pattern: string,
  values: {
    intent: string;
    feature: string;
    change: string | null;
  },
): string {
  const rendered = pattern
    .replaceAll("{intent}", values.intent)
    .replaceAll("{feature}", values.feature)
    .replaceAll("{change}", values.change ?? "{change}");
  return rendered.slice(0, stripTrailingSlashEnd(rendered));
}

export function branchSlugFor(value: string): string {
  const slug = trimHyphens(
    replaceRunsWithHyphen(
      value.trim().toLowerCase(),
      (character) => !isBranchSlugCharacter(character),
    ),
  );
  return slug.length > 0 ? slug : "manual";
}

function stripTrailingSlashEnd(value: string): number {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }

  return end;
}

function isBranchSlugCharacter(character: string): boolean {
  return isLowerAsciiLetterOrDigit(character) ||
    character === "." ||
    character === "_" ||
    character === "-";
}

function mergeFeatureBranchDeliveryDefaults(
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
  pushRemote: string | null;
}): string[] {
  const warnings: string[] = [];
  if (
    options.config.enabled &&
    !options.config.activeFeatureId &&
    !options.fallbackScopeId
  ) {
    warnings.push(
      `feature branch delivery has no active feature id; using ${options.unscopedName}`,
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
    !options.pushRemote
  ) {
    warnings.push("feature branch publication requires a configured push remote");
  }
  return warnings;
}

function stackSummary(options: {
  branchStrategy: NexusFeatureBranchDeliveryBranchStrategy;
  usesStackParent: boolean;
  featureBranch: string | null;
  targetBranch: string;
  defaultChangeReviewTarget: string;
}): NexusFeatureBranchDeliveryStackSummary {
  const publicationEligible = options.branchStrategy !== "throwaway_rehearsal";
  if (!publicationEligible) {
    const rootBranch = options.featureBranch ?? options.targetBranch;
    return {
      status: "excluded_from_publication",
      branchStrategy: options.branchStrategy,
      publicationEligible,
      rootBranch,
      defaultParentBranch: rootBranch,
      defaultReviewTarget: options.defaultChangeReviewTarget,
      finalPublicationTarget: options.targetBranch,
      changes: [],
    };
  }
  if (!options.usesStackParent) {
    return {
      status: "not_applicable",
      branchStrategy: options.branchStrategy,
      publicationEligible,
      rootBranch: null,
      defaultParentBranch: null,
      defaultReviewTarget: options.defaultChangeReviewTarget,
      finalPublicationTarget: options.targetBranch,
      changes: [],
    };
  }
  const rootBranch = options.featureBranch ?? options.targetBranch;
  return {
    status: publicationEligible ? "active" : "excluded_from_publication",
    branchStrategy: options.branchStrategy,
    publicationEligible,
    rootBranch,
    defaultParentBranch: rootBranch,
    defaultReviewTarget: options.defaultChangeReviewTarget,
    finalPublicationTarget: options.targetBranch,
    changes: [],
  };
}

function featureBranchPublicationSummary(options: {
  config: NexusFeatureBranchDeliveryConfig;
  pushRemote: string | null;
  remoteUrls: Record<string, string | null | undefined>;
  remotePushUrls: Record<string, string | null | undefined>;
  headBranch: string | null;
}): NexusFeatureBranchDeliveryBranchPublicationSummary {
  const { strategy, fallbackRemote } = options.config.branchPublication;
  const selectedRemote = selectedBranchPushRemote({
    strategy,
    pushRemote: options.pushRemote,
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
    pushRemote: options.pushRemote,
    fallbackRemote,
    selectedRemote,
    selectedRemoteUrl,
    selectedRemotePushUrl,
    requiresFallbackApproval:
      strategy === "push_remote_then_fallback" && Boolean(fallbackRemote),
    finalPullRequestHead: pullRequestHeadSummary({
      strategy,
      pushRemote: options.pushRemote,
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
  pushRemote: string | null;
  fallbackRemote: string | null;
  selectedRemote: string | null;
  selectedRemoteUrl: string | null;
  selectedRemotePushUrl: string | null;
  headBranch: string | null;
}): NexusFeatureBranchDeliveryPullRequestHeadSummary {
  if (options.strategy === "manual_only") {
    return blockedHead("manual_only", options, "branch publication is manual-only");
  }
  if (!options.headBranch) {
    return blockedHead(
      "blocked",
      options,
      "feature branchStrategy has no stable final pull request head branch",
    );
  }
  if (!options.selectedRemote) {
    return blockedHead(
      "blocked",
      options,
      "feature branch publication has no selected remote",
    );
  }

  const remoteUrl = options.selectedRemotePushUrl ?? options.selectedRemoteUrl;
  const parsed = parseGitHubRemoteUrl(remoteUrl);
  const usesFallbackRemote = options.selectedRemote === options.fallbackRemote &&
    options.selectedRemote !== options.pushRemote;
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
): NexusFeatureBranchDeliveryPullRequestHeadSummary {
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

function selectedBranchPushRemote(options: {
  strategy: NexusFeatureBranchDeliveryBranchPublicationStrategy;
  pushRemote: string | null;
  fallbackRemote: string | null;
}): string | null {
  switch (options.strategy) {
    case "push_remote":
      return options.pushRemote;
    case "fallback_remote":
      return options.fallbackRemote;
    case "push_remote_then_fallback":
      return options.pushRemote ?? options.fallbackRemote;
    case "manual_only":
      return null;
  }
}

function branchStrategyUsesFeatureBranch(
  branchStrategy: NexusFeatureBranchDeliveryBranchStrategy,
): boolean {
  return (
    branchStrategy === "feature_branch" ||
    branchStrategy === "hybrid" ||
    branchStrategy === "throwaway_rehearsal"
  );
}
