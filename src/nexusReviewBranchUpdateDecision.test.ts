import { describe, expect, it } from "vitest";
import { buildNexusReviewBranchUpdateDecision } from "./nexusReviewBranchUpdateDecision.js";

describe("feature branch update decisions", () => {
  it("uses the selected Git remote in merge and rebase command hints", () => {
    const decision = buildNexusReviewBranchUpdateDecision({
      baseStatus: "behind",
      headBranch: "feat/codex-goals",
      baseBranch: "main",
      pushRemote: "fork",
    });

    expect(decision).toMatchObject({
      status: "behind",
      recommendation: "merge_update",
      pushRemote: "fork",
      publicBranch: true,
      forceWithLeaseRequired: false,
      choices: [
        {
          id: "merge_update",
          command:
            "git checkout feat/codex-goals && git merge --no-ff main && git push fork feat/codex-goals",
        },
        {
          id: "rebase",
          humanInTheLoop: true,
          forceWithLeaseRequired: true,
          command:
            "git checkout feat/codex-goals && git rebase main && git push --force-with-lease fork feat/codex-goals",
        },
        {
          id: "no_update",
          command: null,
        },
      ],
    });
  });

  it("marks stacked branch updates so lower branches can be updated first", () => {
    const decision = buildNexusReviewBranchUpdateDecision({
      baseStatus: "behind",
      headBranch: "feat/codex-goals/two",
      baseBranch: "feat/codex-goals/one",
      pushRemote: "origin",
      stackedBranch: true,
    });

    expect(decision).toMatchObject({
      status: "behind",
      stackedBranch: true,
      recommendation: "merge_update",
    });
    expect(decision.reasons).toContain(
      "review branch belongs to a stack; update parent branches before children",
    );
  });

  it("keeps rebase as a HITL force-with-lease option for public branches", () => {
    const decision = buildNexusReviewBranchUpdateDecision({
      baseStatus: "diverged",
      headBranch: "feat/codex-goals",
      baseBranch: "main",
      pushRemote: "origin",
      publicBranch: true,
    });

    expect(decision).toMatchObject({
      status: "diverged",
      conflictRisk: "elevated",
      publicBranch: true,
      recommendation: "merge_update",
      forceWithLeaseRequired: false,
      humanInTheLoop: false,
    });
    expect(decision.choices.find((choice) => choice.id === "merge_update"))
      .toMatchObject({
        recommended: true,
        humanInTheLoop: false,
        forceWithLeaseRequired: false,
      });
    expect(decision.choices.find((choice) => choice.id === "rebase"))
      .toMatchObject({
        recommended: false,
        humanInTheLoop: true,
        forceWithLeaseRequired: true,
        reasons: [
          "rewrites the public review branch and requires force-with-lease approval",
        ],
      });
  });
});
