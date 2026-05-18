import { describe, expect, it } from "vitest";
import {
  resolveNexusEffectiveAuthority,
  resolveNexusCurrentAutomationActor,
  type NexusAuthorityConfig,
  type ResolveNexusEffectiveAuthorityOptions,
} from "./nexusAuthority.js";
import {
  defaultNexusAutomationConfig,
  type NexusAutomationPublicationConfig,
  type NexusAutomationSafetyConfig,
} from "./nexusAutomationConfig.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";

const authority: NexusAuthorityConfig = {
  actors: [
    {
      id: "example-bot-actor",
      kind: "machine_user",
      provider: "github",
      providerIdentity: "Example-Bot",
      displayName: "Example Bot",
      handles: {
        github: "Example-Bot",
      },
    },
    {
      id: "example-human",
      kind: "human",
      provider: "github",
      providerIdentity: "Example-Human",
      displayName: "Example Human",
    },
  ],
  roleBindings: [
    {
      actorId: "example-bot-actor",
      roles: ["maintainer"],
      scope: {
        component: "dev-nexus",
      },
    },
  ],
};

const publication: NexusAutomationPublicationConfig = {
  strategy: "direct_integration",
  remote: "bot",
  targetBranch: "main",
  push: true,
  remoteUrl: "git@github.com-bot:Evref-BL/DevNexus.git",
  pushUrl: null,
  sshHostAlias: "github.com-bot",
  actor: {
    id: "example-bot-actor",
    kind: "machine_user",
    provider: "github",
    handle: "Example-Bot",
  },
  manualRemote: "origin",
  manualActor: {
    id: "example-human",
    kind: "human",
    provider: "github",
    handle: "Example-Human",
  },
  commandEnvironment: {
    GH_CONFIG_DIR: "home:.config/gh-automation-github",
  },
};
const hostAuthorizedSafety: NexusAutomationSafetyConfig = {
  profile: "host-authorized",
  allowHostMutation: true,
  allowDependencyInstall: false,
  allowLiveServices: true,
};
const effectiveAuthority: NexusAuthorityConfig = {
  actors: [
    authorityActor("maintainer-bot"),
    authorityActor("contributor-bot"),
    authorityActor("reviewer-bot"),
    authorityActor("observer-bot"),
    authorityActor("runtime-bot"),
    authorityActor("release-bot"),
    authorityActor("scoped-bot"),
  ],
  roleBindings: [
    {
      actorId: "maintainer-bot",
      roles: ["maintainer"],
      scope: {
        component: "dev-nexus",
      },
    },
    {
      actorId: "contributor-bot",
      roles: ["contributor"],
      scope: {
        component: "dev-nexus",
      },
    },
    {
      actorId: "reviewer-bot",
      roles: ["reviewer"],
      scope: {
        component: "dev-nexus",
      },
    },
    {
      actorId: "observer-bot",
      roles: ["observer"],
      scope: {
        component: "dev-nexus",
      },
    },
    {
      actorId: "runtime-bot",
      roles: ["runtime_operator"],
      scope: {
        environment: "runtime",
      },
    },
    {
      actorId: "release-bot",
      roles: ["release_operator"],
      scope: {
        component: "dev-nexus",
      },
    },
    {
      actorId: "scoped-bot",
      roles: ["maintainer"],
      scope: {
        project: "demo-project",
      },
    },
    {
      actorId: "scoped-bot",
      roles: ["contributor"],
      scope: {
        component: "dev-nexus",
      },
    },
    {
      actorId: "scoped-bot",
      roles: ["reviewer"],
      scope: {
        provider: "github",
      },
    },
    {
      actorId: "scoped-bot",
      roles: ["observer"],
      scope: {
        tracker: "default",
      },
    },
    {
      actorId: "scoped-bot",
      roles: ["contributor"],
      scope: {
        targetBranch: "main",
      },
    },
    {
      actorId: "scoped-bot",
      roles: ["runtime_operator"],
      scope: {
        environment: "runtime",
      },
    },
  ],
};

describe("nexus current automation actor resolution", () => {
  it("matches the expected automation actor through host-local profile metadata", () => {
    const result = resolveNexusCurrentAutomationActor({
      authority,
      componentId: "dev-nexus",
      publication,
      authProfiles: [
        automationProfile({
          actorId: "example-bot-actor",
          sshHost: "github.com-bot",
          githubCliConfigDir: "home:.config/gh-automation-github",
          environmentKeys: ["GH_CONFIG_DIR"],
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "matched",
      expectedActorId: "example-bot-actor",
      profileId: "bot-github",
      roles: ["maintainer"],
      warnings: [],
    });
    expect(result.profiles[0]?.mechanisms).toEqual([
      "actorId",
      "account",
      "sshHost",
      "githubCliConfigDir",
      "environmentKeys",
    ]);
  });

  it("reports missing when no host-local profile is bound to the actor", () => {
    const result = resolveNexusCurrentAutomationActor({
      authority,
      componentId: "dev-nexus",
      publication,
      authProfiles: [],
    });

    expect(result).toMatchObject({
      status: "missing",
      expectedActorId: "example-bot-actor",
      profileId: null,
      profiles: [],
    });
    expect(result.warnings[0]).toMatch(/No host-local auth profile/);
  });

  it("reports ambiguous when more than one automation profile can satisfy the actor", () => {
    const result = resolveNexusCurrentAutomationActor({
      authority,
      componentId: "dev-nexus",
      publication,
      authProfiles: [
        automationProfile({ id: "bot-gh", actorId: "example-bot-actor" }),
        automationProfile({ id: "bot-ssh", actorId: "example-bot-actor" }),
      ],
    });

    expect(result).toMatchObject({
      status: "ambiguous",
      expectedActorId: "example-bot-actor",
      profileId: null,
    });
    expect(result.profiles.map((profile) => profile.id)).toEqual([
      "bot-gh",
      "bot-ssh",
    ]);
  });

  it("does not let a human profile satisfy an automation actor", () => {
    const result = resolveNexusCurrentAutomationActor({
      authority,
      componentId: "dev-nexus",
      publication,
      authProfiles: [
        {
          id: "human-github",
          actorId: "example-bot-actor",
          provider: "github",
          kind: "human",
          account: "Example-Bot",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "mismatched",
      expectedActorId: "example-bot-actor",
      profileId: null,
      profiles: [
        {
          id: "human-github",
          kind: "human",
        },
      ],
    });
  });

  it("falls back to unknown observer authority when no automation actor is configured", () => {
    const result = resolveNexusCurrentAutomationActor({
      authority,
      componentId: "dev-nexus",
      publication: {
        ...publication,
        actor: null,
      },
      authProfiles: [
        automationProfile({ actorId: "example-bot-actor" }),
      ],
    });

    expect(result).toMatchObject({
      status: "unknown",
      expectedActorId: null,
      profileId: null,
      roles: ["observer"],
    });
    expect(result.actions).toContain("project.read");
    expect(result.actions).not.toContain("git.push_target_branch");
  });
});

describe("nexus effective authority resolution", () => {
  it("allows maintainer direct integration only when publication policy and actor authority both allow it", () => {
    const result = resolveEffectiveAuthority({
      actor: { id: "maintainer-bot" },
      requestedAction: "git.push_target_branch",
    });

    expect(result).toMatchObject({
      status: "allowed",
      allowed: true,
      matchedActorId: "maintainer-bot",
      matchedRoles: ["maintainer"],
      matchedRule: {
        precedence: "component_override",
      },
      missingRequiredActions: [],
      missingProviderSignals: [],
      recommendedFallbackAction: null,
    });
  });

  it("blocks direct integration for a contributor but allows the pull request fallback", () => {
    const directPush = resolveEffectiveAuthority({
      actor: { id: "contributor-bot" },
      requestedAction: "git.push_target_branch",
    });
    const pullRequest = resolveEffectiveAuthority({
      actor: { id: "contributor-bot" },
      requestedAction: "provider.pull_request.open",
    });

    expect(directPush).toMatchObject({
      status: "blocked",
      missingRequiredActions: ["git.push_target_branch"],
      recommendedFallbackAction: "provider.pull_request.open",
    });
    expect(pullRequest).toMatchObject({
      status: "allowed",
      matchedRoles: ["contributor"],
    });
  });

  it("allows reviewer approval without granting merge or issue-level design approval", () => {
    const reviewApproval = resolveEffectiveAuthority({
      actor: { id: "reviewer-bot" },
      requestedAction: "provider.review.approve",
    });
    const merge = resolveEffectiveAuthority({
      actor: { id: "reviewer-bot" },
      requestedAction: "provider.pull_request.merge",
      providerState: approvedPullRequestState(),
    });
    const issueDesignApproval = resolveEffectiveAuthority({
      actor: { id: "reviewer-bot" },
      requestedAction: "provider.issue.design_approve",
    });

    expect(reviewApproval.status).toBe("allowed");
    expect(merge).toMatchObject({
      status: "blocked",
      missingRequiredActions: ["provider.pull_request.merge"],
    });
    expect(issueDesignApproval).toMatchObject({
      status: "blocked",
      missingRequiredActions: ["provider.issue.design_approve"],
    });
  });

  it("keeps observer authority read-only apart from handoffs", () => {
    const read = resolveEffectiveAuthority({
      actor: { id: "observer-bot" },
      requestedAction: "project.read",
    });
    const update = resolveEffectiveAuthority({
      actor: { id: "observer-bot" },
      requestedAction: "work_item.update",
    });

    expect(read.status).toBe("allowed");
    expect(update).toMatchObject({
      status: "blocked",
      missingRequiredActions: ["work_item.update"],
      recommendedFallbackAction: "coordination.handoff",
    });
  });

  it("allows a runtime operator to mutate approved runtime state without merge authority", () => {
    const runtimeMutation = resolveEffectiveAuthority({
      actor: { id: "runtime-bot" },
      environment: "runtime",
      requestedAction: "runtime.mutate",
      safety: hostAuthorizedSafety,
    });
    const merge = resolveEffectiveAuthority({
      actor: { id: "runtime-bot" },
      environment: "runtime",
      requestedAction: "provider.pull_request.merge",
      providerState: approvedPullRequestState(),
    });

    expect(runtimeMutation).toMatchObject({
      status: "allowed",
      matchedRoles: ["runtime_operator"],
    });
    expect(merge).toMatchObject({
      status: "blocked",
      missingRequiredActions: ["provider.pull_request.merge"],
    });
  });

  it("allows a release operator to publish releases without implementation authority", () => {
    const publish = resolveEffectiveAuthority({
      actor: { id: "release-bot" },
      requestedAction: "release.publish",
    });
    const commit = resolveEffectiveAuthority({
      actor: { id: "release-bot" },
      requestedAction: "git.commit",
    });

    expect(publish).toMatchObject({
      status: "allowed",
      matchedRoles: ["release_operator"],
    });
    expect(commit).toMatchObject({
      status: "blocked",
      missingRequiredActions: ["git.commit"],
      recommendedFallbackAction: "coordination.handoff",
    });
  });

  it("applies deterministic scope precedence from project through environment", () => {
    expect(
      resolveEffectiveAuthority({
        actor: { id: "scoped-bot" },
        component: null,
        provider: null,
        tracker: null,
        targetBranch: null,
        requestedAction: "git.push_target_branch",
      }),
    ).toMatchObject({
      status: "allowed",
      matchedRoles: ["maintainer"],
      matchedRule: { precedence: "project_default" },
    });
    expect(
      resolveEffectiveAuthority({
        actor: { id: "scoped-bot" },
        provider: null,
        tracker: null,
        targetBranch: null,
        requestedAction: "provider.pull_request.open",
      }),
    ).toMatchObject({
      status: "allowed",
      matchedRoles: ["contributor"],
      matchedRule: { precedence: "component_override" },
    });
    expect(
      resolveEffectiveAuthority({
        actor: { id: "scoped-bot" },
        tracker: null,
        targetBranch: null,
        requestedAction: "provider.review.approve",
      }),
    ).toMatchObject({
      status: "allowed",
      matchedRoles: ["reviewer"],
      matchedRule: { precedence: "provider_override" },
    });
    expect(
      resolveEffectiveAuthority({
        actor: { id: "scoped-bot" },
        targetBranch: null,
        requestedAction: "project.read",
      }),
    ).toMatchObject({
      status: "allowed",
      matchedRoles: ["observer"],
      matchedRule: { precedence: "tracker_override" },
    });
    expect(
      resolveEffectiveAuthority({
        actor: { id: "scoped-bot" },
        requestedAction: "provider.pull_request.open",
      }),
    ).toMatchObject({
      status: "allowed",
      matchedRoles: ["contributor"],
      matchedRule: { precedence: "branch_override" },
    });
    expect(
      resolveEffectiveAuthority({
        actor: { id: "scoped-bot" },
        environment: "runtime",
        requestedAction: "runtime.mutate",
        safety: hostAuthorizedSafety,
      }),
    ).toMatchObject({
      status: "allowed",
      matchedRoles: ["runtime_operator"],
      matchedRule: { precedence: "environment_override" },
    });
  });

  it("waits for pull request review approval instead of treating issue approval, assignment, comments, or silence as approval", () => {
    const result = resolveEffectiveAuthority({
      actor: { id: "maintainer-bot" },
      requestedAction: "provider.pull_request.merge",
      providerState: {
        pullRequest: {
          checks: "checks_passed",
          mergeability: "mergeable",
        },
        issue: {
          designApproval: "approved",
          assignedActorIds: ["maintainer-bot"],
          casualCommentCount: 3,
        },
      },
    });
    const silentResult = resolveEffectiveAuthority({
      actor: { id: "maintainer-bot" },
      requestedAction: "provider.pull_request.merge",
      providerState: {
        pullRequest: {
          checks: "checks_passed",
          mergeability: "mergeable",
        },
        issue: {
          silent: true,
        },
      },
    });

    expect(result).toMatchObject({
      status: "waiting",
      missingProviderSignals: ["pull_request_review.approved"],
      recommendedFallbackAction: "provider.review.request",
    });
    expect(silentResult).toMatchObject({
      status: "waiting",
      missingProviderSignals: ["pull_request_review.approved"],
    });
  });

  it("allows pull request merge only after review approval, checks, and mergeability are present", () => {
    const result = resolveEffectiveAuthority({
      actor: { id: "maintainer-bot" },
      requestedAction: "provider.pull_request.merge",
      providerState: approvedPullRequestState(),
    });

    expect(result).toMatchObject({
      status: "allowed",
      missingProviderSignals: [],
    });
  });

  it("blocks direct integration when component publication policy is not direct integration", () => {
    const result = resolveEffectiveAuthority({
      actor: { id: "maintainer-bot" },
      requestedAction: "git.push_target_branch",
      publication: {
        ...publication,
        strategy: "review_handoff",
        push: false,
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      missingRequiredActions: [],
      recommendedFallbackAction: "provider.pull_request.open",
    });
    expect(result.explanation).toContain("Component publication policy");
  });
});

function automationProfile(
  overrides: Partial<NexusHostingAuthProfileConfig> = {},
): NexusHostingAuthProfileConfig {
  return {
    id: "bot-github",
    actorId: "example-bot-actor",
    provider: "github",
    kind: "automation",
    account: "Example-Bot",
    ...overrides,
  };
}

function resolveEffectiveAuthority(
  overrides: Partial<ResolveNexusEffectiveAuthorityOptions> &
    Pick<ResolveNexusEffectiveAuthorityOptions, "requestedAction">,
) {
  return resolveNexusEffectiveAuthority({
    authority: effectiveAuthority,
    actor: { id: "maintainer-bot" },
    authProfile: {
      id: "bot-github",
      actorId: overrides.actor?.id ?? "maintainer-bot",
      kind: "automation",
      provider: "github",
      account: "Example-Bot",
    },
    project: "demo-project",
    component: "dev-nexus",
    provider: "github",
    tracker: "default",
    remote: "bot",
    repository: "Evref-BL/DevNexus",
    targetBranch: "main",
    publication,
    safety: defaultNexusAutomationConfig.safety,
    ...overrides,
  });
}

function authorityActor(id: string) {
  return {
    id,
    kind: "machine_user" as const,
    provider: "github",
    providerIdentity: id,
    displayName: id,
  };
}

function approvedPullRequestState() {
  return {
    pullRequest: {
      review: "approved" as const,
      checks: "checks_passed" as const,
      mergeability: "mergeable" as const,
      branchPolicy: "clear" as const,
    },
  };
}
