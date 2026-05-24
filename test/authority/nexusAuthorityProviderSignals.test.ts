import { describe, expect, it } from "vitest";
import {
  resolveNexusEffectiveAuthority,
  type NexusAuthorityConfig,
  type NexusAuthorityProviderState,
} from "../../src/authority/nexusAuthority.js";
import {
  mapGitHubAuthoritySignals,
  mapGitLabAuthoritySignals,
  mapJiraAuthoritySignals,
  nexusAuthorityProviderNeutralSignals,
} from "../../src/authority/nexusAuthorityProviderSignals.js";
import type { NexusAutomationPublicationConfig } from "../../src/automation/nexusAutomationConfig.js";

const authority: NexusAuthorityConfig = {
  actors: [
    {
      id: "maintainer-bot",
      kind: "machine_user",
      provider: "github",
      providerIdentity: "maintainer-bot",
      displayName: "Maintainer Bot",
    },
  ],
  roleBindings: [
    {
      actorId: "maintainer-bot",
      roles: ["maintainer"],
      scope: {
        component: "dev-nexus",
      },
    },
  ],
};

const publication: NexusAutomationPublicationConfig = {
  strategy: "review_handoff",
  remote: "bot",
  targetBranch: "main",
  push: true,
  remoteUrl: null,
  pushUrl: null,
  sshHostAlias: "github.com-bot",
  packagePublish: false,
  releasePublish: false,
  actor: {
    id: "maintainer-bot",
    kind: "machine_user",
    provider: "github",
    handle: "maintainer-bot",
  },
  gitIdentity: null,
  manualRemote: "origin",
  manualActor: null,
  commandEnvironment: {},
};

describe("nexus authority provider signal mapping", () => {
  it("exposes the neutral provider signals required by authority summaries", () => {
    expect(nexusAuthorityProviderNeutralSignals).toEqual(
      expect.arrayContaining([
        "waiting_for_approval",
        "approved",
        "changes_requested",
        "rejected",
        "checks_pending",
        "checks_stale",
        "checks_failed",
        "checks_passed",
        "branch_policy_blocked",
        "mergeable",
        "merge_conflict",
        "timed_out",
      ]),
    );
  });

  it("maps GitHub pull request reviews checks mergeability branch protection and issue status", () => {
    const summary = mapGitHubAuthoritySignals({
      pullRequest: {
        reviewDecision: "APPROVED",
        requiredChecks: [
          {
            name: "ci",
            conclusion: "success",
          },
        ],
        mergeable: true,
        branchProtection: {
          status: "clear",
          requiredApprovingReviewCount: 1,
        },
      },
      issue: {
        labels: ["approval:approved"],
        assignees: ["designer"],
        expectedResponders: ["reviewer"],
        comments: [{ body: "Looks ready." }],
      },
    });

    expect(summary.providerState).toMatchObject({
      pullRequest: {
        review: "approved",
        checks: "checks_passed",
        mergeability: "mergeable",
        branchPolicy: "clear",
      },
      issue: {
        designApproval: "approved",
        assignedActorIds: ["designer"],
      },
    });
    expect(summary.ownership).toEqual({
      assignedActorIds: ["designer"],
      expectedResponderIds: ["reviewer"],
    });
    expect(summary.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "pull_request_review",
          signal: "approved",
        }),
        expect.objectContaining({ category: "checks", signal: "checks_passed" }),
        expect.objectContaining({
          category: "mergeability",
          signal: "mergeable",
        }),
        expect.objectContaining({ category: "branch_policy", signal: "clear" }),
        expect.objectContaining({ category: "issue_design", signal: "approved" }),
      ]),
    );
    expect(resolveMerge(summary.providerState)).toMatchObject({
      status: "allowed",
      missingProviderSignals: [],
    });
  });

  it("keeps GitHub assignment and comments separate from pull request approval", () => {
    const summary = mapGitHubAuthoritySignals({
      pullRequest: {
        reviews: [],
        requiredChecks: [{ name: "ci", conclusion: "failure" }],
        mergeable: true,
        branchProtection: {
          blocked: true,
          requiredApprovingReviewCount: 1,
        },
      },
      issue: {
        assignees: ["maintainer-bot"],
        comments: [{ body: "Please take a look." }],
      },
    });

    expect(summary.providerState).toMatchObject({
      pullRequest: {
        review: "waiting_for_approval",
        checks: "checks_failed",
        mergeability: "mergeable",
        branchPolicy: "branch_policy_blocked",
      },
      issue: {
        designApproval: "unknown",
        assignedActorIds: ["maintainer-bot"],
      },
    });
    expect(resolveMerge(summary.providerState)).toMatchObject({
      status: "blocked",
      missingProviderSignals: expect.arrayContaining([
        "pull_request_review.approved",
        "checks.passed",
        "branch_policy.clear",
      ]),
    });
  });

  it("maps stale GitHub checks as blocking merge evidence", () => {
    const summary = mapGitHubAuthoritySignals({
      pullRequest: {
        reviewDecision: "APPROVED",
        requiredChecks: [{ name: "ci", conclusion: "stale" }],
        mergeable: true,
        branchProtection: {
          status: "clear",
          requiredApprovingReviewCount: 1,
        },
      },
    });

    expect(summary.providerState).toMatchObject({
      pullRequest: {
        review: "approved",
        checks: "checks_stale",
        mergeability: "mergeable",
        branchPolicy: "clear",
      },
    });
    expect(resolveMerge(summary.providerState)).toMatchObject({
      status: "blocked",
      missingProviderSignals: expect.arrayContaining(["checks.passed"]),
    });
  });

  it("maps GitLab approvals pipeline mergeability labels and transitions", () => {
    const approved = mapGitLabAuthoritySignals({
      mergeRequest: {
        approvalsRequired: 2,
        approvedBy: ["alice", "bob"],
        pipeline: { status: "success" },
        mergeStatus: "can_be_merged",
      },
      issue: {
        status: "Changes Requested",
        labels: ["decision:approved"],
        assignees: ["owner"],
      },
    });
    const blocked = mapGitLabAuthoritySignals({
      mergeRequest: {
        approvalsRequired: 2,
        approvedBy: ["alice"],
        pipeline: "running",
        mergeStatus: "cannot_be_merged",
        protectedBranchBlocked: true,
      },
    });

    expect(approved.providerState).toMatchObject({
      pullRequest: {
        review: "approved",
        checks: "checks_passed",
        mergeability: "mergeable",
        branchPolicy: "clear",
      },
      issue: {
        designApproval: "changes_requested",
        assignedActorIds: ["owner"],
      },
    });
    expect(resolveMerge(approved.providerState)).toMatchObject({
      status: "allowed",
    });
    expect(blocked.providerState).toMatchObject({
      pullRequest: {
        review: "waiting_for_approval",
        checks: "checks_pending",
        mergeability: "merge_conflict",
        branchPolicy: "branch_policy_blocked",
      },
    });
  });

  it("maps Jira workflow status categories and comments to issue-level decisions only", () => {
    const approved = mapJiraAuthoritySignals({
      issue: {
        status: "In Review",
        statusCategory: "indeterminate",
        transitions: ["Start review", "Approve"],
        comments: [{ body: "decision: approved" }],
        assignees: ["architect"],
      },
    });
    const assignedOnly = mapJiraAuthoritySignals({
      issue: {
        statusCategory: "new",
        assignees: ["architect"],
      },
    });

    expect(approved.providerState).toMatchObject({
      issue: {
        designApproval: "approved",
        assignedActorIds: ["architect"],
      },
    });
    expect(approved.providerState.pullRequest).toBeUndefined();
    expect(resolveMerge(approved.providerState)).toMatchObject({
      status: "waiting",
      missingProviderSignals: expect.arrayContaining([
        "pull_request_review.approved",
        "checks.passed",
        "mergeable",
        "branch_policy.clear",
      ]),
    });
    expect(assignedOnly.providerState).toMatchObject({
      issue: {
        designApproval: "unknown",
        assignedActorIds: ["architect"],
      },
    });
  });
});

function resolveMerge(providerState: NexusAuthorityProviderState) {
  return resolveNexusEffectiveAuthority({
    authority,
    actor: { id: "maintainer-bot" },
    authProfile: {
      id: "bot-github",
      actorId: "maintainer-bot",
      kind: "automation",
      provider: "github",
      account: "maintainer-bot",
    },
    project: "demo-project",
    component: "dev-nexus",
    provider: "github",
    tracker: "default",
    remote: "bot",
    repository: "Evref-BL/DevNexus",
    targetBranch: "main",
    publication,
    requestedAction: "provider.pull_request.merge",
    providerState,
  });
}
