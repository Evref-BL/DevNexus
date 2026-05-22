import { describe, expect, it } from "vitest";
import { buildNexusInitiativeRestackPlan } from "./nexusInitiativeRestackPlan.js";

describe("initiative restack plan", () => {
  it("does not require restack planning for direct topology", () => {
    const plan = buildNexusInitiativeRestackPlan({
      topology: "direct",
      finalPublicationTarget: "main",
      branches: [
        {
          branch: "feat/small-fixes/parser",
          parentBranch: "main",
          position: 1,
          pushed: false,
          parentChanged: false,
          baseStatus: "current",
        },
      ],
    });

    expect(plan).toMatchObject({
      status: "not_required",
      nextAction: "wait",
      publicationEligible: true,
      needsUpdateCount: 0,
      forceWithLeaseCount: 0,
      humanApprovalCount: 0,
    });
  });

  it("reports stacked branches that need restack and force-with-lease approval", () => {
    const plan = buildNexusInitiativeRestackPlan({
      topology: "stacked",
      finalPublicationTarget: "main",
      branches: [
        {
          branch: "feat/codex-goals/target-projection",
          parentBranch: "main",
          childBranches: ["feat/codex-goals/finalization"],
          position: 1,
          pushed: true,
          parentChanged: true,
          baseStatus: "behind",
        },
        {
          branch: "feat/codex-goals/finalization",
          parentBranch: "feat/codex-goals/target-projection",
          position: 2,
          pushed: false,
          parentChanged: true,
          baseStatus: "current",
        },
      ],
    });

    expect(plan).toMatchObject({
      status: "needs_restack",
      nextAction: "request_human_approval",
      publicationEligible: true,
      needsUpdateCount: 2,
      forceWithLeaseCount: 1,
      humanApprovalCount: 1,
      items: [
        {
          branch: "feat/codex-goals/target-projection",
          parentBranch: "main",
          childBranches: ["feat/codex-goals/finalization"],
          position: 1,
          needsUpdate: true,
          forceWithLeaseRequired: true,
          humanApprovalRequired: true,
        },
        {
          branch: "feat/codex-goals/finalization",
          parentBranch: "feat/codex-goals/target-projection",
          position: 2,
          needsUpdate: true,
          forceWithLeaseRequired: false,
          humanApprovalRequired: false,
        },
      ],
    });
  });

  it("keeps hybrid stacks ready when branch graph facts are current", () => {
    const plan = buildNexusInitiativeRestackPlan({
      topology: "hybrid",
      finalPublicationTarget: "main",
      branches: [
        {
          branch: "feat/codex-goals/target-projection",
          parentBranch: "feat/codex-goals",
          position: 1,
          pushed: true,
          parentChanged: false,
          baseStatus: "current",
        },
      ],
    });

    expect(plan).toMatchObject({
      status: "ready",
      nextAction: "wait",
      needsUpdateCount: 0,
      forceWithLeaseCount: 0,
      humanApprovalCount: 0,
    });
  });

  it("excludes throw-away rehearsal topology from publication restack plans", () => {
    const plan = buildNexusInitiativeRestackPlan({
      topology: "throwaway_rehearsal",
      finalPublicationTarget: "main",
      branches: [
        {
          branch: "feat/codex-goals/rehearsal",
          parentBranch: "feat/codex-goals",
          position: 1,
          pushed: true,
          parentChanged: true,
          baseStatus: "behind",
        },
      ],
    });

    expect(plan).toMatchObject({
      status: "not_required",
      publicationEligible: false,
      needsUpdateCount: 0,
      forceWithLeaseCount: 0,
      humanApprovalCount: 0,
      warnings: ["throw-away rehearsal branches are excluded from publication restack plans"],
    });
  });
});
