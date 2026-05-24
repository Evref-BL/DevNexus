import { describe, expect, it } from "vitest";
import {
  buildNexusReviewPlan,
  resolveNexusReviewPolicy,
  validateNexusReviewPolicyConfig,
} from "../../src/publication/nexusReviewPolicy.js";
import {
  assertNexusReviewPolicyEnforcement,
  buildNexusReviewPolicyEnforcementDecision,
  NexusReviewPolicyEnforcementError,
} from "../../src/publication/nexusReviewPolicyEnforcement.js";
import { normalizeNexusPublicationProviderEvidence } from "../../src/publication/nexusPublicationProviderEvidence.js";

describe("nexus review policy", () => {
  it("defaults to local human review without provider mutations", () => {
    const plan = buildNexusReviewPlan({
      componentId: "api",
      branchName: "docs/review-policy",
      headSha: "abc123",
      requestedAction: "merge",
    });

    expect(plan).toMatchObject({
      componentId: "api",
      status: "review_required",
      nextAction: "collect_local_authorization",
      transport: "local",
      gates: ["human_required"],
      providerMutations: [],
      blockedActions: ["merge"],
      gateResults: [
        {
          gate: "human_required",
          status: "missing",
          evidenceSource: "local_authorization",
        },
      ],
    });
  });

  it("treats local approval as authorization for the matching action and head", () => {
    const readyPlan = buildNexusReviewPlan({
      componentId: "api",
      requestedAction: "merge",
      branchName: "docs/review-policy",
      headSha: "abc123",
      localAuthorization: {
        authorized: true,
        authorizedAt: "2026-05-23T10:00:00Z",
        requestedAction: "merge",
        branchName: "docs/review-policy",
        headSha: "abc123",
      },
    });
    expect(readyPlan.status).toBe("ready");
    expect(readyPlan.nextAction).toBe("proceed");
    expect(readyPlan.blockedActions).toEqual([]);

    const stalePlan = buildNexusReviewPlan({
      componentId: "api",
      requestedAction: "merge",
      branchName: "docs/review-policy",
      headSha: "def456",
      localAuthorization: {
        authorized: true,
        requestedAction: "merge",
        branchName: "docs/review-policy",
        headSha: "abc123",
      },
    });
    expect(stalePlan.status).toBe("blocked");
    expect(stalePlan.gateResults[0]?.message).toContain(
      "authorization was for head abc123",
    );
  });

  it("matches ordered rules and consumes provider review plus CI evidence", () => {
    const policy = resolveNexusReviewPolicy(
      validateNexusReviewPolicyConfig({
        default: {
          transport: "local",
          gates: ["human_required"],
        },
        rules: [
          {
            match: {
              branchRole: "feature_finalization",
            },
            transport: "pull_request",
            gates: [
              "provider_approval_required",
              "ci_required",
              "final_human_approval_required",
            ],
          },
        ],
      }),
    );
    const providerEvidence = normalizeNexusPublicationProviderEvidence([
      {
        reviewState: "approved",
        checks: [
          { name: "Node 24 check (ubuntu-latest)", conclusion: "success" },
          { name: "Node 24 check (windows-latest)", conclusion: "success" },
        ],
      },
    ])[0]!;

    const plan = buildNexusReviewPlan({
      componentId: "api",
      policy,
      branchRole: "feature_finalization",
      requestedAction: "merge",
      branchName: "feat/review-policy",
      headSha: "abc123",
      providerEvidence,
      localAuthorization: {
        authorized: true,
        requestedAction: "merge",
        branchName: "feat/review-policy",
        headSha: "abc123",
      },
    });

    expect(plan).toMatchObject({
      status: "ready",
      transport: "pull_request",
      matchedRuleIndex: 0,
      providerMutations: ["create_or_update_pull_request"],
      requiredEvidence: [],
    });
    expect(plan.gateResults.map((result) => result.status)).toEqual([
      "satisfied",
      "satisfied",
      "satisfied",
    ]);
  });

  it("matches path rules and rejects ambiguous none gates", () => {
    const policy = validateNexusReviewPolicyConfig({
      default: {
        transport: "pull_request",
        gates: ["provider_approval_required"],
      },
      rules: [
        {
          match: {
            paths: ["docs/**", "plugins/**/skills/**"],
          },
          transport: "local",
          gates: ["human_required"],
        },
      ],
    });
    const plan = buildNexusReviewPlan({
      componentId: "api",
      policy,
      paths: ["docs/dev/review-policy.md"],
    });

    expect(plan.transport).toBe("local");
    expect(plan.matchedRuleIndex).toBe(0);

    expect(() =>
      validateNexusReviewPolicyConfig({
        default: {
          gates: ["none", "human_required"],
        },
      }),
    ).toThrow(/must not combine none/);
  });

  it("enforces review policy only for final actions when explicitly configured", () => {
    const noPolicy = buildNexusReviewPolicyEnforcementDecision({
      componentId: "api",
      finalAction: true,
      requestedAction: "provider.pull_request.merge",
    });
    expect(noPolicy).toMatchObject({
      mode: "noop",
      status: "allowed",
      reviewPlan: null,
    });

    const configuredPolicy = validateNexusReviewPolicyConfig({
      default: {
        transport: "pull_request",
        gates: ["provider_approval_required"],
      },
    });
    const reviewSurfaceAction = buildNexusReviewPolicyEnforcementDecision({
      componentId: "api",
      policy: configuredPolicy,
      finalAction: false,
      requestedAction: "provider.pull_request.open",
    });
    expect(reviewSurfaceAction).toMatchObject({
      mode: "final_actions",
      status: "allowed",
      reviewPlan: null,
    });

    const blockedFinalAction = buildNexusReviewPolicyEnforcementDecision({
      componentId: "api",
      policy: configuredPolicy,
      finalAction: true,
      requestedAction: "provider.pull_request.merge",
    });
    expect(blockedFinalAction).toMatchObject({
      mode: "final_actions",
      status: "blocked",
      reviewPlan: {
        status: "review_required",
      },
    });
    expect(() =>
      assertNexusReviewPolicyEnforcement(blockedFinalAction)
    ).toThrow(NexusReviewPolicyEnforcementError);
  });
});
