import { describe, expect, it } from "vitest";
import {
  evaluateNexusCodexGoalsAutomationPolicy,
  nexusCodexGoalsHitlStates,
} from "../../src/automation/nexusCodexGoalsPolicy.js";

describe("nexus Codex Goals automation policy", () => {
  it("allows Goal projection while warning about AFK-sensitive profile choices", () => {
    const decision = evaluateNexusCodexGoalsAutomationPolicy({
      mode: "goal_projection",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      permissionProfile: "isolated",
      allowHostMutation: false,
      allowDependencyInstall: false,
      allowLiveServices: false,
      tokenBudget: null,
      devNexusRelaunchWhileEligible: true,
      mcpDefaultToolsApprovalMode: "approve",
    });

    expect(decision).toMatchObject({
      mode: "goal_projection",
      status: "warning",
      hitlStates: nexusCodexGoalsHitlStates,
    });
    expect(decision.blockers).toEqual([]);
    expect(decision.warnings.map((warning) => warning.code)).toEqual([
      "approval_policy_never",
      "token_budget_omitted",
    ]);
    expect(decision.findings.map((finding) => finding.summary).join("\n"))
      .toContain("Goal projection records the objective only");
  });

  it("blocks native Goal continuation when DevNexus relaunch would also drive work", () => {
    const decision = evaluateNexusCodexGoalsAutomationPolicy({
      mode: "goal_continuation",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      permissionProfile: "isolated",
      allowHostMutation: false,
      allowDependencyInstall: false,
      allowLiveServices: false,
      tokenBudget: 4_000,
      devNexusRelaunchWhileEligible: true,
      mcpDefaultToolsApprovalMode: "approve",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers.map((blocker) => blocker.code)).toContain(
      "double_driving",
    );
  });

  it("blocks native Goal continuation without budget and HITL for broad runtime authority", () => {
    const decision = evaluateNexusCodexGoalsAutomationPolicy({
      mode: "goal_continuation",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      permissionProfile: "host-authorized",
      allowHostMutation: true,
      allowDependencyInstall: true,
      allowLiveServices: true,
      tokenBudget: null,
      devNexusRelaunchWhileEligible: false,
      mcpDefaultToolsApprovalMode: "never",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "token_budget_required",
        "approval_policy_never_with_broad_authority",
        "approval_policy_never_with_live_services",
        "approval_policy_never_with_dependency_installs",
        "mcp_tools_without_approval",
      ]),
    );
  });
});
