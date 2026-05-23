import { describe, expect, it } from "vitest";
import { buildNexusProjectSetupAuthInventory } from "../src/nexusProjectSetupAuthInventory.js";
import { buildNexusProjectSetupHostingHandoff } from "../src/nexusProjectSetupHostingHandoff.js";
import type { NexusProjectSetupAnswers } from "../src/nexusProjectSetupModel.js";

function answers(): NexusProjectSetupAnswers {
  return {
    home: {
      path: "/tmp/home",
    },
    project: {
      id: "demo",
      name: "Demo",
      root: "/tmp/demo project",
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
    authProfiles: [
      {
        id: "human-github",
        provider: "github",
        actorKind: "human",
        credentialMethod: {
          kind: "provider_cli",
          cli: "gh",
        },
      },
      {
        id: "bot-github",
        provider: "github",
        actorKind: "machine_user",
        credentialMethod: {
          kind: "environment_variable",
          variable: "GITHUB_TOKEN",
        },
      },
    ],
    hostingIntent: {
      provider: "github",
      namespace: "ExampleOrg",
      repositoryName: "demo-meta",
      defaultBranch: "main",
      humanAuthProfileId: "human-github",
      automationAuthProfileId: "bot-github",
      providerMutationAuthProfileId: "bot-github",
    },
  };
}

describe("workspace setup hosting handoff", () => {
  it("reports unconfigured hosting without commands", () => {
    const setupAnswers = answers();
    delete setupAnswers.hostingIntent;

    expect(buildNexusProjectSetupHostingHandoff(setupAnswers)).toMatchObject({
      status: "not_configured",
      commands: [],
      providerMutationsDeferred: true,
      componentRepositoryHosting: "not_configured_by_project_setup",
    });
  });

  it("builds exact hosting status, plan, and apply handoff commands", () => {
    const setupAnswers = answers();
    const authInventory = buildNexusProjectSetupAuthInventory(setupAnswers, {
      env: {
        GITHUB_TOKEN: "present",
      },
      commandExists: () => true,
    });

    const handoff = buildNexusProjectSetupHostingHandoff(
      setupAnswers,
      authInventory,
    );

    expect(handoff).toMatchObject({
      status: "planned",
      provider: "github",
      namespace: "ExampleOrg",
      repositoryName: "demo-meta",
      metaProjectOnly: true,
      providerMutationsDeferred: true,
      missingAuthProfileIds: [],
    });
    expect(handoff.commands).toEqual([
      expect.objectContaining({
        id: "hosting-status",
        command: "dev-nexus workspace hosting status '/tmp/demo project' --json",
        providerMutation: false,
        allowedDuringProjectSetup: false,
        authProfileId: "human-github",
      }),
      expect.objectContaining({
        id: "hosting-plan",
        command: "dev-nexus workspace hosting plan '/tmp/demo project' --json",
        providerMutation: false,
        allowedDuringProjectSetup: false,
        authProfileId: "human-github",
      }),
      expect.objectContaining({
        id: "hosting-apply",
        command: "dev-nexus workspace hosting apply '/tmp/demo project' --json",
        providerMutation: true,
        allowedDuringProjectSetup: false,
        authProfileId: "bot-github",
      }),
    ]);
  });

  it("blocks the handoff report on missing referenced auth profiles", () => {
    const setupAnswers = answers();
    setupAnswers.hostingIntent!.providerMutationAuthProfileId = "missing-bot";
    const authInventory = buildNexusProjectSetupAuthInventory(setupAnswers);

    expect(buildNexusProjectSetupHostingHandoff(setupAnswers, authInventory))
      .toMatchObject({
        status: "blocked_on_auth",
        missingAuthProfileIds: ["missing-bot"],
        commands: [
          expect.any(Object),
          expect.any(Object),
          expect.objectContaining({
            id: "hosting-apply",
            providerMutation: true,
            allowedDuringProjectSetup: false,
            authProfileId: "missing-bot",
          }),
        ],
      });
  });
});
