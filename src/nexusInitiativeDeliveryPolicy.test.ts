import { describe, expect, it } from "vitest";
import {
  defaultNexusInitiativeDeliveryConfig,
  type NexusInitiativeDeliveryConfig,
} from "./nexusAutomationConfig.js";
import {
  branchSlugFor,
  renderInitiativeBranchPattern,
  summarizeNexusInitiativeDeliveryPolicy,
} from "./nexusInitiativeDeliveryPolicy.js";

function initiativeConfig(
  patch: Partial<NexusInitiativeDeliveryConfig> = {},
): NexusInitiativeDeliveryConfig {
  return {
    ...defaultNexusInitiativeDeliveryConfig,
    ...patch,
    branchNaming: {
      ...defaultNexusInitiativeDeliveryConfig.branchNaming,
      ...patch.branchNaming,
    },
    review: {
      ...defaultNexusInitiativeDeliveryConfig.review,
      ...patch.review,
    },
    provider: {
      ...defaultNexusInitiativeDeliveryConfig.provider,
      ...patch.provider,
    },
    branchPublication: {
      ...defaultNexusInitiativeDeliveryConfig.branchPublication,
      ...patch.branchPublication,
    },
  };
}

describe("initiative delivery policy", () => {
  it("plans hybrid initiative branches with conventional intent prefixes", () => {
    const summary = summarizeNexusInitiativeDeliveryPolicy({
      config: initiativeConfig({
        enabled: true,
        activeInitiativeId: "Codex Goals",
        defaultTopology: "hybrid",
      }),
      fallbackScopeId: "v-next",
      unscopedName: "manual",
      targetBranch: "main",
      publicationRemote: "app",
    });

    expect(summary).toMatchObject({
      enabled: true,
      activeInitiativeId: "Codex Goals",
      activeScopeId: "Codex Goals",
      branchSlug: "codex-goals",
      defaultIntentPrefix: "feat",
      defaultTopology: "hybrid",
      reviewMode: "slice_pr",
      finalPullRequest: true,
      finalPullRequestCreation: "at_review_gate",
      providerNoise: "status_only",
      branchPublication: {
        strategy: "publication_remote",
        publicationRemote: "app",
        fallbackRemote: null,
        selectedRemote: "app",
        requiresFallbackApproval: false,
      },
      branchPlan: {
        topology: "hybrid",
        targetBranch: "main",
        integrationBranch: "feat/codex-goals",
        sliceBranchPattern: "feat/codex-goals/{slice}",
        defaultSliceBaseBranch: "feat/codex-goals",
        defaultSliceReviewTarget: "feat/codex-goals",
        finalReviewTarget: "main",
        finalPublicationTarget: "main",
        usesStackParent: true,
        requiresIntegrationBranchApproval: true,
      },
    });
  });

  it("keeps direct slices targeting the final branch", () => {
    const summary = summarizeNexusInitiativeDeliveryPolicy({
      config: initiativeConfig({
        enabled: true,
        activeInitiativeId: "small-fixes",
        defaultTopology: "direct",
        branchNaming: {
          defaultIntentPrefix: "fix",
          allowedIntentPrefixes: ["feat", "fix"],
          integrationBranchPattern: "{intent}/{initiative}",
          sliceBranchPattern: "{intent}/{initiative}/{slice}",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      publicationRemote: "app",
    });

    expect(summary.branchPlan).toMatchObject({
      topology: "direct",
      integrationBranch: null,
      defaultSliceBaseBranch: "main",
      defaultSliceReviewTarget: "main",
      finalReviewTarget: "main",
      requiresIntegrationBranchApproval: false,
    });
    expect(summary.branchPlan.sliceBranchPattern).toBe("fix/small-fixes/{slice}");
  });

  it("uses publication train scope when no active initiative id is configured", () => {
    const summary = summarizeNexusInitiativeDeliveryPolicy({
      config: initiativeConfig({
        enabled: true,
        activeInitiativeId: null,
        defaultTopology: "integration_branch",
      }),
      fallbackScopeId: "0.2.0",
      unscopedName: "manual",
      targetBranch: "main",
      publicationRemote: "app",
    });

    expect(summary.activeScopeId).toBe("0.2.0");
    expect(summary.branchPlan.integrationBranch).toBe("feat/0.2.0");
    expect(summary.warnings).toEqual([]);
  });

  it("warns when enabled without an initiative or fallback scope", () => {
    const summary = summarizeNexusInitiativeDeliveryPolicy({
      config: initiativeConfig({
        enabled: true,
        activeInitiativeId: null,
        defaultTopology: "throwaway_rehearsal",
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      publicationRemote: "app",
    });

    expect(summary.activeScopeId).toBe("manual");
    expect(summary.warnings).toEqual([
      "initiative delivery has no active initiative id; using manual",
      "throw-away rehearsal branches must not become publication sources",
    ]);
  });

  it("renders branch patterns and normalizes arbitrary ids to branch slugs", () => {
    expect(branchSlugFor(" Feature: Codex Goals! ")).toBe("feature-codex-goals");
    expect(
      renderInitiativeBranchPattern("{intent}/{initiative}/{slice}", {
        intent: "feat",
        initiative: "codex-goals",
        slice: "target-projection",
      }),
    ).toBe("feat/codex-goals/target-projection");
  });

  it("plans configured fallback remotes for fork or temp branch publication", () => {
    const summary = summarizeNexusInitiativeDeliveryPolicy({
      config: initiativeConfig({
        enabled: true,
        activeInitiativeId: "fork-review",
        defaultTopology: "hybrid",
        branchPublication: {
          strategy: "publication_remote_then_fallback",
          fallbackRemote: "fork",
        },
      }),
      fallbackScopeId: null,
      unscopedName: "manual",
      targetBranch: "main",
      publicationRemote: "app",
    });

    expect(summary.branchPublication).toEqual({
      strategy: "publication_remote_then_fallback",
      publicationRemote: "app",
      fallbackRemote: "fork",
      selectedRemote: "app",
      requiresFallbackApproval: true,
    });
    expect(summary.warnings).toEqual([]);
  });
});
