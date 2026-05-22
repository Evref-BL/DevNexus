import { describe, expect, it } from "vitest";
import { buildNexusProjectSetupAuthInventory } from "./nexusProjectSetupAuthInventory.js";
import type { NexusProjectSetupAnswers } from "./nexusProjectSetupModel.js";

function answers(): NexusProjectSetupAnswers {
  return {
    home: {
      path: "/tmp/home",
    },
    project: {
      id: "demo",
      name: "Demo",
      root: "/tmp/demo",
    },
    components: [
      {
        id: "core",
        role: "primary",
        source: {
          kind: "reference_existing",
          path: "/tmp/demo/core",
        },
      },
    ],
    workTrackers: [
      {
        id: "github",
        provider: "github",
        role: "eligible_source",
        authProfileId: "bot-github",
        repositoryOwner: "Example",
        repositoryName: "demo",
      },
      {
        id: "jira",
        provider: "jira",
        role: "coordination",
        authProfileId: "jira-work",
        projectKey: "DEMO",
      },
    ],
    authProfiles: [
      {
        id: "human-github",
        provider: "github",
        actorKind: "human",
        account: "alice",
        credentialMethod: {
          kind: "provider_cli",
          cli: "gh",
          configDir: "home:.config/gh",
        },
      },
      {
        id: "bot-github",
        provider: "github",
        actorKind: "machine_user",
        account: "demo-bot",
        credentialMethod: {
          kind: "environment_variable",
          variable: "GITHUB_TOKEN",
        },
      },
      {
        id: "jira-work",
        provider: "jira",
        actorKind: "service_account",
        credentialMethod: {
          kind: "token_store_reference",
          reference: "host-local:jira-work",
        },
      },
    ],
    hostingIntent: {
      provider: "github",
      namespace: "Example",
      repositoryName: "demo-meta",
      humanAuthProfileId: "human-github",
      automationAuthProfileId: "bot-github",
      providerMutationAuthProfileId: "bot-github",
    },
    publication: {
      posture: "direct_integration",
      automationAuthProfileId: "bot-github",
      humanAuthProfileId: "human-github",
    },
    readinessChecks: [
      {
        id: "jira-ready",
        title: "Read Jira issues",
        provider: "jira",
        requiresAuthProfileId: "jira-work",
      },
    ],
  };
}

describe("workspace setup auth inventory", () => {
  it("classifies required, optional, and provider mutation auth profiles", () => {
    const inventory = buildNexusProjectSetupAuthInventory(answers(), {
      env: {
        GITHUB_TOKEN: "present",
      },
      commandExists: (command) => command === "gh",
    });

    expect(inventory.summary).toContain("3 auth profile(s)");
    expect(inventory.requiredNowProfileIds).toEqual([
      "human-github",
      "bot-github",
      "jira-work",
    ]);
    expect(inventory.providerMutationOnlyProfileIds).toEqual([]);
    expect(inventory.missingProfiles).toEqual([]);
    expect(inventory.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "human-github",
          actorKind: "human",
          credentialMethodKind: "provider_cli",
          capabilityChecks: [
            expect.objectContaining({
              status: "available",
              nextAction: expect.stringContaining("gh auth status"),
            }),
          ],
        }),
        expect.objectContaining({
          id: "bot-github",
          actorKind: "machine_user",
          credentialReference: "GITHUB_TOKEN",
          capabilityChecks: [
            expect.objectContaining({
              status: "available",
              summary: expect.not.stringContaining("present"),
            }),
          ],
        }),
      ]),
    );
  });

  it("reports missing referenced profiles and missing host-local credentials", () => {
    const setupAnswers = answers();
    setupAnswers.hostingIntent!.providerMutationAuthProfileId = "missing-bot";

    const inventory = buildNexusProjectSetupAuthInventory(setupAnswers, {
      env: {},
      commandExists: () => false,
    });

    expect(inventory.missingProfiles).toEqual([
      expect.objectContaining({
        profileId: "missing-bot",
        nextAction: expect.stringContaining("Add authProfiles[] entry"),
      }),
    ]);
    expect(inventory.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "human-github",
          capabilityChecks: [
            expect.objectContaining({
              status: "missing",
              summary: "gh is not available on PATH.",
            }),
          ],
        }),
        expect.objectContaining({
          id: "bot-github",
          capabilityChecks: [
            expect.objectContaining({
              status: "missing",
              summary: "GITHUB_TOKEN is not defined.",
            }),
          ],
        }),
      ]),
    );
  });

  it("reports GitHub App user-to-server helper readiness without reading tokens", () => {
    const setupAnswers = answers();
    setupAnswers.authProfiles!.push({
      id: "alice-devnexus-app-user",
      provider: "github",
      actorKind: "human",
      account: "alice",
      credentialMethod: {
        kind: "github_app_user_to_server",
        helperCommand: "devnexus-github-app-user-token",
        appSlug: "devnexus-automation",
        authorizationMode: "device_flow",
      },
    });
    setupAnswers.publication!.humanAuthProfileId = "alice-devnexus-app-user";

    const inventory = buildNexusProjectSetupAuthInventory(setupAnswers, {
      commandExists: (command) => command === "devnexus-github-app-user-token",
    });

    expect(inventory.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "alice-devnexus-app-user",
          actorKind: "human",
          credentialMethodKind: "github_app_user_to_server",
          credentialReference:
            "devnexus-github-app-user-token app=devnexus-automation authorization=device_flow",
          capabilityChecks: [
            expect.objectContaining({
              status: "manual",
              summary: expect.stringContaining("token values were not read"),
              nextAction: expect.stringContaining("App user authorization"),
            }),
          ],
        }),
      ]),
    );
  });
});
