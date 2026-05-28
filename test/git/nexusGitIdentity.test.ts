import { describe, expect, it } from "vitest";
import type { NexusAutomationPublicationConfig } from "../../src/automation/nexusAutomationConfig.js";
import {
  gitCoAuthorTrailers,
  resolveExpectedAutomationGitIdentity,
} from "../../src/git/nexusGitIdentity.js";
import type { NexusHostingAuthProfileConfig } from "../../src/project/nexusProjectHosting.js";

describe("nexus git identity", () => {
  it("uses command environment identity before publication and auth profile values", () => {
    expect(
      resolveExpectedAutomationGitIdentity({
        publication: publication({
          commandEnvironment: {
            GIT_AUTHOR_NAME: "Bot Env",
            GIT_COMMITTER_NAME: "Bot Env",
            GIT_AUTHOR_EMAIL: "bot-env@example.invalid",
            GIT_COMMITTER_EMAIL: "bot-env@example.invalid",
          },
          gitIdentity: {
            name: "Configured Bot",
            email: "configured@example.invalid",
            coAuthors: [
              {
                name: "Codex",
                email: "267193182+codex@users.noreply.github.com",
              },
              {
                name: "Pair Reviewer",
                email: "pair@example.invalid",
              },
            ],
          },
        }),
        authProfiles: [authProfile()],
      }),
    ).toMatchObject({
      name: "Bot Env",
      email: "bot-env@example.invalid",
      coAuthors: [
        {
          name: "Codex",
          email: "267193182+codex@users.noreply.github.com",
        },
        {
          name: "Pair Reviewer",
          email: "pair@example.invalid",
        },
      ],
      source: "publication.commandEnvironment",
      warnings: [],
    });
  });

  it("formats all configured co-author trailers", () => {
    expect(
      gitCoAuthorTrailers({
        name: "Gabriel-Darbord",
        email: "gabriel.darbord@berger-levrault.com",
        coAuthors: [
          {
            name: "Codex",
            email: "267193182+codex@users.noreply.github.com",
          },
          {
            name: "Pair Reviewer",
            email: "pair@example.invalid",
          },
        ],
        source: "publication.gitIdentity",
        warnings: [],
      }),
    ).toEqual([
      "Co-authored-by: Codex <267193182+codex@users.noreply.github.com>",
      "Co-authored-by: Pair Reviewer <pair@example.invalid>",
    ]);
  });

  it("uses auth profile identity before GitHub noreply fallback", () => {
    expect(
      resolveExpectedAutomationGitIdentity({
        publication: publication(),
        authProfiles: [authProfile()],
      }),
    ).toMatchObject({
      name: "Profile Bot",
      email: "profile@example.invalid",
      source: "authProfile:bot-github",
      warnings: [],
    });
  });

  it("derives a GitHub noreply email when the actor has a numeric GitHub id", () => {
    expect(
      resolveExpectedAutomationGitIdentity({
        publication: publication(),
        authProfiles: [],
      }),
    ).toMatchObject({
      name: "devnexus-bot",
      email: "12345+devnexus-bot@users.noreply.github.com",
      source: "publication.actor.github_noreply",
      warnings: [],
    });
  });
});

function publication(
  overrides: Partial<NexusAutomationPublicationConfig> = {},
): NexusAutomationPublicationConfig {
  return {
    strategy: "review_handoff",
    remote: "origin",
    targetBranch: null,
    push: false,
    remoteUrl: null,
    pushUrl: null,
    sshHostAlias: null,
    packagePublish: false,
    releasePublish: false,
    actor: {
      kind: "machine_user",
      provider: "github",
      handle: "devnexus-bot",
      id: "12345",
    },
    gitIdentity: null,
    manualRemote: null,
    manualActor: null,
    commandEnvironment: {},
    ...overrides,
  };
}

function authProfile(): NexusHostingAuthProfileConfig {
  return {
    id: "bot-github",
    provider: "github",
    actorId: "12345",
    account: "devnexus-bot",
    gitUserName: "Profile Bot",
    gitUserEmail: "profile@example.invalid",
  };
}
