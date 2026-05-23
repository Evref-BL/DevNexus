import { describe, expect, it } from "vitest";
import {
  defaultNexusFeatureBranchDeliveryConfig,
  type NexusFeatureBranchDeliveryConfig,
} from "../src/nexusAutomationConfig.js";
import {
  branchSlugFor,
  renderFeatureBranchPattern,
  summarizeNexusFeatureBranchDeliveryPolicy,
} from "../src/nexusFeatureBranchDeliveryPolicy.js";

function featureConfig(
  patch: Partial<NexusFeatureBranchDeliveryConfig> = {},
): NexusFeatureBranchDeliveryConfig {
  return {
    ...defaultNexusFeatureBranchDeliveryConfig,
    ...patch,
    branchNaming: {
      ...defaultNexusFeatureBranchDeliveryConfig.branchNaming,
      ...patch.branchNaming,
    },
    review: {
      ...defaultNexusFeatureBranchDeliveryConfig.review,
      ...patch.review,
    },
    provider: {
      ...defaultNexusFeatureBranchDeliveryConfig.provider,
      ...patch.provider,
    },
    branchPublication: {
      ...defaultNexusFeatureBranchDeliveryConfig.branchPublication,
      ...patch.branchPublication,
    },
  };
}

describe("feature branch delivery policy", () => {
  it("plans hybrid feature branches with conventional intent prefixes", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "Codex Goals",
        defaultBranchStrategy: "hybrid",
      }),
      fallbackScopeId: "v-next",
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "app",
    });

    expect(summary).toMatchObject({
      enabled: true,
      activeFeatureId: "Codex Goals",
      activeScopeId: "Codex Goals",
      branchSlug: "codex-goals",
      defaultIntentPrefix: "feat",
      defaultBranchStrategy: "hybrid",
      reviewMode: "review_branch_pr",
      finalPullRequest: true,
      finalPullRequestCreation: "at_review_gate",
      commentPolicy: "status_only",
      branchPublication: {
        strategy: "push_remote",
        pushRemote: "app",
        fallbackRemote: null,
        selectedRemote: "app",
        requiresFallbackApproval: false,
      },
      branchPlan: {
        branchStrategy: "hybrid",
        targetBranch: "main",
        featureBranch: "feat/codex-goals",
        reviewBranchPattern: "feat/codex-goals/{change}",
        defaultChangeBaseBranch: "feat/codex-goals",
        defaultChangeReviewTarget: "feat/codex-goals",
        finalReviewTarget: "main",
        finalPublicationTarget: "main",
        usesStackParent: true,
        requiresFeatureBranchApproval: true,
        stack: {
          status: "active",
          branchStrategy: "hybrid",
          publicationEligible: true,
          rootBranch: "feat/codex-goals",
          defaultParentBranch: "feat/codex-goals",
          defaultReviewTarget: "feat/codex-goals",
        },
      },
    });
  });

  it("keeps direct changes targeting the final branch", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "small-fixes",
        defaultBranchStrategy: "direct",
        branchNaming: {
          defaultIntentPrefix: "fix",
          allowedIntentPrefixes: ["feat", "fix"],
          featureBranchPattern: "{intent}/{feature}",
          reviewBranchPattern: "{intent}/{feature}/{change}",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "app",
    });

    expect(summary.branchPlan).toMatchObject({
      branchStrategy: "direct",
      featureBranch: null,
      defaultChangeBaseBranch: "main",
      defaultChangeReviewTarget: "main",
      finalReviewTarget: "main",
      requiresFeatureBranchApproval: false,
      stack: {
        status: "not_applicable",
        publicationEligible: true,
        rootBranch: null,
        defaultParentBranch: null,
      },
    });
    expect(summary.branchPlan.reviewBranchPattern).toBe("fix/small-fixes/{change}");
  });

  it("summarizes stacked branchStrategy with target-rooted change parents", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "stacked-work",
        defaultBranchStrategy: "stacked",
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "app",
    });

    expect(summary.branchPlan).toMatchObject({
      branchStrategy: "stacked",
      featureBranch: null,
      defaultChangeBaseBranch: "main",
      defaultChangeReviewTarget: "parent_change_or_target",
      stack: {
        status: "active",
        branchStrategy: "stacked",
        publicationEligible: true,
        rootBranch: "main",
        defaultParentBranch: "main",
        defaultReviewTarget: "parent_change_or_target",
        changes: [],
      },
    });
  });

  it("uses release train scope when no active feature id is configured", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: null,
        defaultBranchStrategy: "feature_branch",
      }),
      fallbackScopeId: "0.2.0",
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "app",
    });

    expect(summary.activeScopeId).toBe("0.2.0");
    expect(summary.branchPlan.featureBranch).toBe("feat/0.2.0");
    expect(summary.warnings).toEqual([]);
  });

  it("warns when enabled without an feature or fallback scope", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: null,
        defaultBranchStrategy: "throwaway_rehearsal",
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "app",
    });

    expect(summary.activeScopeId).toBe("manual");
    expect(summary.branchPlan.stack).toMatchObject({
      status: "excluded_from_publication",
      publicationEligible: false,
      rootBranch: "feat/manual",
      defaultParentBranch: "feat/manual",
    });
    expect(summary.warnings).toEqual([
      "feature branch delivery has no active feature id; using manual",
      "throw-away rehearsal branches must not become publication sources",
    ]);
  });

  it("renders branch patterns and normalizes arbitrary ids to branch slugs", () => {
    expect(branchSlugFor(" Feature: Codex Goals! ")).toBe("feature-codex-goals");
    expect(
      renderFeatureBranchPattern("{intent}/{feature}/{change}", {
        intent: "feat",
        feature: "codex-goals",
        change: "target-projection",
      }),
    ).toBe("feat/codex-goals/target-projection");
  });

  it("plans configured fallback remotes for fork or temp branch publication", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "fork-review",
        defaultBranchStrategy: "hybrid",
        branchPublication: {
          strategy: "push_remote_then_fallback",
          fallbackRemote: "fork",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "app",
    });

    expect(summary.branchPublication).toMatchObject({
      strategy: "push_remote_then_fallback",
      pushRemote: "app",
      fallbackRemote: "fork",
      selectedRemote: "app",
      requiresFallbackApproval: true,
    });
    expect(summary.warnings).toEqual([]);
  });

  it("renders upstream final pull request heads as branch names", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "Codex Goals",
        defaultBranchStrategy: "hybrid",
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "origin",
      remoteUrls: {
        origin: "https://github.com/Evref-BL/DevNexus.git",
      },
    });

    expect(summary.branchPublication.finalPullRequestHead).toMatchObject({
      status: "upstream_branch",
      branch: "feat/codex-goals",
      remote: "origin",
      provider: "github",
      owner: "Evref-BL",
      repository: "DevNexus",
      displayRef: "feat/codex-goals",
      setupAction: null,
    });
  });

  it("renders GitHub fork final pull request heads from SSH fallback remotes", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "Codex Goals",
        defaultBranchStrategy: "hybrid",
        branchPublication: {
          strategy: "fallback_remote",
          fallbackRemote: "fork",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "origin",
      remoteUrls: {
        fork: "git@github.com:Gabriel-Darbord/DevNexus.git",
      },
    });

    expect(summary.branchPublication.finalPullRequestHead).toMatchObject({
      status: "fork_branch",
      branch: "feat/codex-goals",
      remote: "fork",
      provider: "github",
      owner: "Gabriel-Darbord",
      repository: "DevNexus",
      displayRef: "Gabriel-Darbord:feat/codex-goals",
      setupAction: null,
    });
  });

  it("renders GitHub fork final pull request heads from HTTPS fallback remotes", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "Codex Goals",
        defaultBranchStrategy: "hybrid",
        branchPublication: {
          strategy: "fallback_remote",
          fallbackRemote: "fork",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "origin",
      remoteUrls: {
        fork: "https://github.com/Gabriel-Darbord/DevNexus.git",
      },
    });

    expect(summary.branchPublication.finalPullRequestHead).toMatchObject({
      status: "fork_branch",
      owner: "Gabriel-Darbord",
      repository: "DevNexus",
      displayRef: "Gabriel-Darbord:feat/codex-goals",
    });
  });


  it("blocks fork pull request heads when fallback remotes have no GitHub URL", () => {
    const summary = summarizeNexusFeatureBranchDeliveryPolicy({
      config: featureConfig({
        enabled: true,
        activeFeatureId: "Codex Goals",
        defaultBranchStrategy: "hybrid",
        branchPublication: {
          strategy: "fallback_remote",
          fallbackRemote: "fork",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      pushRemote: "origin",
    });

    expect(summary.branchPublication.finalPullRequestHead).toMatchObject({
      status: "blocked",
      remote: "fork",
      displayRef: null,
      setupAction:
        "configure remote fork with a GitHub URL before creating a fork pull request",
    });
  });
});
