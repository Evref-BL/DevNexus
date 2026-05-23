import { describe, expect, it } from "vitest";
import {
  defaultNexusCiTierDefinitions,
  defaultNexusReleaseTrainCiTierPolicy,
  NexusCiTierPolicyError,
  resolveNexusCiTierDecision,
  validateNexusCiTierPolicyConfig,
} from "../../src/operations/nexusCiTierPolicy.js";

const fullMatrixChecks = [
  "Node 22 check (ubuntu-latest)",
  "Node 22 check (windows-latest)",
  "Node 22 check (macos-latest)",
];

describe("nexus CI tier policy", () => {
  it("defaults to protected target validation until a project opts in", () => {
    const decision = resolveNexusCiTierDecision({
      eventName: "pull_request",
      branchName: "feature/source-change",
      changedPaths: ["src/cli.ts"],
    });

    expect(decision.status).toBe("required");
    expect(decision.tier.id).toBe("protected_target");
    expect(decision.requiredChecks).toEqual(fullMatrixChecks);
    expect(decision.reasonCodes).toEqual([
      "default_conservative_policy",
      "ordinary_branch",
      "budget_available",
    ]);
  });

  it("keeps ordinary source pull requests on cheap remote smoke after opt-in", () => {
    const decision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "feature/source-change",
      changedPaths: ["src/cli.ts"],
    });

    expect(decision.tier.id).toBe("remote_smoke");
    expect(decision.requiredChecks).toEqual(["Node 22 check (ubuntu-latest)"]);
    expect(decision.skippedChecks).toEqual([
      "Node 22 check (windows-latest)",
      "Node 22 check (macos-latest)",
    ]);
    expect(decision.summary).toContain("ordinary branch validation");
  });

  it("skips remote checks for documentation-only changes", () => {
    const decision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "feature/docs",
      changedPaths: ["docs/publication-train.md", "README.md"],
    });

    expect(decision.status).toBe("skipped");
    expect(decision.tier.id).toBe("local_focused");
    expect(decision.requiredChecks).toEqual([]);
    expect(decision.skippedChecks).toEqual(fullMatrixChecks);
    expect(decision.reasonCodes).toContain("documentation_only");
  });

  it("keeps metadata-only changes on cheap remote smoke", () => {
    const decision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "feature/metadata",
      changedPaths: [".dev-nexus/automation/target-state.md"],
    });

    expect(decision.tier.id).toBe("remote_smoke");
    expect(decision.reasonCodes).toContain("metadata_only");
    expect(decision.requiredChecks).toEqual(["Node 22 check (ubuntu-latest)"]);
  });

  it("escalates cross-platform risk and candidate branches to the matrix tier", () => {
    const crossPlatformDecision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "feature/process-supervisor",
      changeRisk: "cross_platform",
      changedPaths: ["src/processSupervisor.ts"],
    });
    const candidateDecision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "candidate/0.2.0",
      changedPaths: ["src/cli.ts"],
    });

    expect(crossPlatformDecision.tier.id).toBe("candidate_matrix");
    expect(crossPlatformDecision.requiredChecks).toEqual(fullMatrixChecks);
    expect(crossPlatformDecision.reasonCodes).toContain("cross_platform_risk");
    expect(candidateDecision.tier.id).toBe("candidate_matrix");
    expect(candidateDecision.reasonCodes).toContain("candidate_branch");
  });

  it("keeps merge queue and target branches as protected gates", () => {
    const mergeQueueDecision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "merge_group",
      branchName: "gh-readonly-queue/main/pr-1",
      fullMatrixBudgetAvailable: false,
    });
    const targetDecision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "push",
      branchName: "main",
      targetBranch: "main",
      fullMatrixBudgetAvailable: false,
    });
    const targetPullRequestDecision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "feature/source-change",
      baseBranch: "main",
      targetBranch: "main",
      changedPaths: ["docs/readme.md"],
      fullMatrixBudgetAvailable: false,
    });

    expect(mergeQueueDecision.tier.id).toBe("protected_target");
    expect(mergeQueueDecision.budgetLimited).toBe(false);
    expect(mergeQueueDecision.requiredChecks).toEqual(fullMatrixChecks);
    expect(targetDecision.tier.id).toBe("protected_target");
    expect(targetDecision.budgetLimited).toBe(false);
    expect(targetPullRequestDecision.tier.id).toBe("protected_target");
    expect(targetPullRequestDecision.budgetLimited).toBe(false);
    expect(targetPullRequestDecision.status).toBe("required");
    expect(targetPullRequestDecision.requiredChecks).toEqual(fullMatrixChecks);
    expect(targetPullRequestDecision.reasonCodes).toEqual([
      "target_branch",
      "budget_available",
    ]);
  });

  it("falls back to cheap smoke when high-cost candidate budget is exhausted", () => {
    const decision = resolveNexusCiTierDecision({
      policy: defaultNexusReleaseTrainCiTierPolicy,
      eventName: "pull_request",
      branchName: "candidate/0.2.0",
      changedPaths: ["src/cli.ts"],
      fullMatrixBudgetAvailable: false,
    });

    expect(decision.tier.id).toBe("remote_smoke");
    expect(decision.budgetLimited).toBe(true);
    expect(decision.reasonCodes).toEqual([
      "candidate_branch",
      "budget_exhausted",
    ]);
    expect(decision.requiredChecks).toEqual(["Node 22 check (ubuntu-latest)"]);
  });

  it("validates configured policies before resolution", () => {
    const policy = validateNexusCiTierPolicyConfig({
      defaultTier: "remote_smoke",
      fullMatrixBudget: {
        minimumIntervalMinutes: 45,
        minimumChangeCount: 4,
      },
      tiers: defaultNexusCiTierDefinitions.map((tier) =>
        tier.id === "remote_smoke"
          ? {
              ...tier,
              requiredChecks: ["smoke"],
            }
          : tier,
      ),
    });

    expect(policy).toMatchObject({
      enabled: true,
      defaultTier: "remote_smoke",
      fullMatrixBudget: {
        minimumIntervalMinutes: 45,
        minimumChangeCount: 4,
      },
    });
    expect(policy?.tiers.find((tier) => tier.id === "remote_smoke"))
      .toMatchObject({ requiredChecks: ["smoke"] });
  });

  it("rejects broken tier policies", () => {
    expect(() =>
      validateNexusCiTierPolicyConfig({
        tiers: [
          ...defaultNexusCiTierDefinitions,
          defaultNexusCiTierDefinitions[0]!,
        ],
      }),
    ).toThrow(/duplicate tier id: local_focused/);

    expect(() =>
      validateNexusCiTierPolicyConfig({
        defaultTier: "remote_smoke",
        tiers: [defaultNexusCiTierDefinitions[0]!],
      }),
    ).toThrow(NexusCiTierPolicyError);

    expect(() =>
      validateNexusCiTierPolicyConfig({
        fullMatrixBudget: {
          minimumIntervalMinutes: 0,
        },
      }),
    ).toThrow(/minimumIntervalMinutes must be a positive integer or null/);
  });
});
