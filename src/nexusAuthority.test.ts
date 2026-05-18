import { describe, expect, it } from "vitest";
import {
  resolveNexusCurrentAutomationActor,
  type NexusAuthorityConfig,
} from "./nexusAuthority.js";
import type { NexusAutomationPublicationConfig } from "./nexusAutomationConfig.js";
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
