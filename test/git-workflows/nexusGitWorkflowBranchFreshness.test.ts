import { describe, expect, it } from "vitest";
import {
  buildNexusGitWorkflowBranchFreshnessDecision,
  defaultNexusFeatureBranchDeliveryConfig,
  type NexusGitWorkflowProfileConfig,
  type NexusGitWorkflowUpdateAction,
} from "../../src/index.js";

describe("nexus Git workflow branch freshness decisions", () => {
  it("chooses a merge update for a strict behind branch", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("direct", { behind: "merge" }),
      headBranch: "feat/demo",
      baseBranch: "main",
      pushRemote: "origin",
      provider: {
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "strict_checks",
        requiredChecks: "stale",
      },
    });

    expect(decision).toMatchObject({
      freshness: "behind",
      action: "merge",
      hitlRequired: false,
      command:
        "git checkout feat/demo && git merge --no-ff main && git push origin feat/demo",
      reasons: expect.arrayContaining([
        "provider reports branch is behind its base",
        "strict checks require the review branch to include the current base",
      ]),
    });
  });

  it("requires human approval for public rebase updates", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("feature_branch", {
        diverged: "rebase",
        publicRewrite: "with_human_approval",
      }),
      headBranch: "feat/demo",
      baseBranch: "main",
      pushRemote: "origin",
      publicBranch: true,
      provider: {
        baseStatus: "diverged",
        mergeable: "mergeable",
        validationMode: "strict_checks",
        requiredChecks: "stale",
      },
    });

    expect(decision).toMatchObject({
      freshness: "diverged",
      action: "rebase",
      hitlRequired: true,
      forceWithLeaseRequired: true,
      command:
        "git checkout feat/demo && git rebase main && git push --force-with-lease origin feat/demo",
      humanGate: "public_history_rewrite",
    });
  });

  it("blocks conflicting branches instead of suggesting an automatic update", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("direct", { behind: "merge" }),
      headBranch: "feat/conflict",
      baseBranch: "main",
      provider: {
        baseStatus: "behind",
        mergeable: "conflicting",
        validationMode: "strict_checks",
        requiredChecks: "stale",
      },
    });

    expect(decision).toMatchObject({
      freshness: "conflicting",
      action: "block",
      blockers: ["provider reports merge conflicts"],
      command: null,
    });
  });

  it("falls back to local Git ahead and behind facts when provider status is unavailable", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("feature_branch", { diverged: "rebase" }),
      headBranch: "feat/local-facts",
      baseBranch: "main",
      git: {
        aheadBy: 3,
        behindBy: 2,
      },
      provider: {
        baseStatus: "unknown",
        mergeable: "unknown",
        validationMode: "strict_checks",
        requiredChecks: "unknown",
      },
    });

    expect(decision).toMatchObject({
      freshness: "diverged",
      action: "rebase",
      command:
        "git checkout feat/local-facts && git rebase main && git push --force-with-lease origin feat/local-facts",
      reasons: expect.arrayContaining([
        "local Git facts report branch has diverged from its base",
      ]),
    });
  });

  it("keeps loose-check direct workflows from unnecessary branch updates", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("direct", { behind: "merge" }),
      headBranch: "feat/direct",
      baseBranch: "main",
      provider: {
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "loose_checks",
        requiredChecks: "passed",
      },
    });

    expect(decision).toMatchObject({
      freshness: "behind",
      action: "none",
      command: null,
      reasons: expect.arrayContaining([
        "direct workflow uses loose checks; provider validation can run without updating the branch",
      ]),
    });
  });

  it("keeps merge-queue direct workflows from unnecessary branch updates", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("direct", { behind: "merge" }),
      headBranch: "feat/queue",
      baseBranch: "main",
      provider: {
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "merge_queue",
        mergeQueue: "available",
        requiredChecks: "passed",
      },
    });

    expect(decision).toMatchObject({
      freshness: "behind",
      action: "none",
      command: null,
      providerAction: "enter_merge_queue",
      reasons: expect.arrayContaining([
        "merge queue will validate the candidate against the protected target",
      ]),
    });
  });

  it("guides stacked workflows to restack parents before children", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("stacked", { behind: "restack" }),
      headBranch: "feat/stack/two",
      baseBranch: "feat/stack/one",
      parentBranches: ["feat/stack/one"],
      childBranches: ["feat/stack/three"],
      publicBranch: true,
      provider: {
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "strict_checks",
        requiredChecks: "stale",
      },
    });

    expect(decision).toMatchObject({
      freshness: "behind",
      action: "restack",
      hitlRequired: true,
      forceWithLeaseRequired: true,
      orderedUpdates: [
        {
          branch: "feat/stack/one",
          order: "parent",
        },
        {
          branch: "feat/stack/two",
          order: "current",
        },
        {
          branch: "feat/stack/three",
          order: "child",
        },
      ],
      reasons: expect.arrayContaining([
        "stacked workflow must update parent branches before child branches",
      ]),
    });
  });

  it("blocks required check failures before branch update selection", () => {
    const decision = buildNexusGitWorkflowBranchFreshnessDecision({
      profile: profile("direct", { behind: "merge" }),
      headBranch: "feat/failing",
      baseBranch: "main",
      provider: {
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "strict_checks",
        requiredChecks: "failed",
      },
    });

    expect(decision).toMatchObject({
      freshness: "behind",
      action: "block",
      blockers: ["required checks failed"],
      command: null,
    });
  });
});

function profile(
  branchStrategy: NexusGitWorkflowProfileConfig["branchStrategy"],
  update: Partial<Record<"behind" | "diverged" | "wrongBase", NexusGitWorkflowUpdateAction>> & {
    publicRewrite?: NexusGitWorkflowProfileConfig["update"]["publicRewrite"];
  },
): NexusGitWorkflowProfileConfig {
  return {
    id: `${branchStrategy}-profile`,
    name: null,
    source: "configured",
    branchStrategy,
    targetBranch: "main",
    activeFeatureId: branchStrategy === "direct" ? null : "demo-feature",
    allowedBranchStrategies: [
      "direct",
      "stacked",
      "feature_branch",
      "hybrid",
      "throwaway_rehearsal",
    ],
    branchNaming: {
      ...defaultNexusFeatureBranchDeliveryConfig.branchNaming,
      allowedIntentPrefixes: [
        ...defaultNexusFeatureBranchDeliveryConfig.branchNaming.allowedIntentPrefixes,
      ],
    },
    review: { ...defaultNexusFeatureBranchDeliveryConfig.review },
    provider: { ...defaultNexusFeatureBranchDeliveryConfig.provider },
    branchPublication: {
      ...defaultNexusFeatureBranchDeliveryConfig.branchPublication,
    },
    update: {
      behind: update.behind ?? "none",
      diverged: update.diverged ?? "block",
      wrongBase: update.wrongBase ?? "recreate",
      publicRewrite: update.publicRewrite ?? "with_human_approval",
    },
    gates: {
      start: [],
      review: ["provider_review"],
      publication: ["human_approval", "provider_review", "publication_authority"],
      cleanup: ["manual_cleanup"],
    },
    release: null,
    environment: null,
  };
}
