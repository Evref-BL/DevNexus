import { describe, expect, it } from "vitest";
import {
  buildNexusProjectHostingFixture,
  NEXUS_PROJECT_HOSTING_FIXTURE_ENV,
  planNexusProjectHostingFixtureRun,
  runNexusProjectHostingFixtureProvisioning,
  validateNexusProjectHostingFixtureCleanupTarget,
  type NexusProjectHostingFixture,
} from "../../src/project/nexusProjectHostingIntegrationFixture.js";
import type {
  NexusProjectHostingLocalRemoteCommand,
  NexusProjectHostingLocalRemoteCommandResult,
  NexusProjectHostingProviderAccessRecord,
  NexusProjectHostingProviderAdapter,
  NexusProjectHostingRepositoryRecord,
} from "../../src/project/nexusProjectHosting.js";

describe("project hosting integration fixture", () => {
  it("builds a disposable fake-project hosting fixture", () => {
    const fixture = buildNexusProjectHostingFixture({
      namespace: "FixtureOrg",
      runId: "case-001",
      humanAccount: "alice",
      automationAccount: "example-bot",
    });

    expect(fixture.repositoryName).toBe("dev-nexus-fixture-case-001");
    expect(fixture.project).toEqual({
      id: "dev-nexus-fixture-case-001",
      name: "DevNexus Hosting Fixture case-001",
    });
    expect(fixture.hosting).toMatchObject({
      provider: "github",
      namespace: "FixtureOrg",
      repository: {
        name: "dev-nexus-fixture-case-001",
        visibility: "private",
        defaultBranch: "main",
      },
      remotes: [
        {
          name: "origin",
          role: "human",
          protocol: "ssh",
          authProfile: "human-github",
        },
        {
          name: "bot",
          role: "automation",
          protocol: "ssh",
          authProfile: "bot-github",
          sshHost: "github.com-bot",
        },
      ],
      access: [
        {
          kind: "machine_user",
          providerIdentity: "example-bot",
          role: "automation",
          requiredPermission: "admin",
          authProfile: "bot-github",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "maintain",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
      ],
      provisioning: {
        allowCreate: true,
        allowLocalRemoteRepair: true,
        allowAccessRepair: true,
        allowInvitationAcceptance: true,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    expect(fixture.authProfiles).toEqual([
      expect.objectContaining({
        id: "human-github",
        provider: "github",
        kind: "human",
        account: "alice",
      }),
      expect.objectContaining({
        id: "bot-github",
        provider: "github",
        kind: "automation",
        account: "example-bot",
        sshHost: "github.com-bot",
      }),
    ]);
    expect(fixture.cleanup).toMatchObject({
      ok: true,
      status: "allowed",
      provider: "github",
      namespace: "FixtureOrg",
      repositoryName: "dev-nexus-fixture-case-001",
    });
  });

  it("skips live fixture runs by default and requires explicit configuration", () => {
    expect(planNexusProjectHostingFixtureRun({ env: {} })).toMatchObject({
      enabled: false,
      status: "skipped",
      fixture: null,
      reason: expect.stringContaining(
        NEXUS_PROJECT_HOSTING_FIXTURE_ENV.enabled,
      ),
    });

    expect(
      planNexusProjectHostingFixtureRun({
        env: {
          [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.enabled]: "1",
          [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.namespace]: "FixtureOrg",
        },
      }),
    ).toMatchObject({
      enabled: true,
      status: "skipped",
      reason: expect.stringContaining("missing required fixture settings"),
    });

    const plan = planNexusProjectHostingFixtureRun({
      env: {
        [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.enabled]: "true",
        [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.namespace]: "FixtureOrg",
        [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.runId]: "env-001",
        [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.humanAccount]: "alice",
        [NEXUS_PROJECT_HOSTING_FIXTURE_ENV.automationAccount]: "example-bot",
      },
    });

    expect(plan).toMatchObject({
      enabled: true,
      status: "ready",
      reason: expect.stringContaining(
        "FixtureOrg/dev-nexus-fixture-env-001",
      ),
      fixture: {
        repositoryName: "dev-nexus-fixture-env-001",
      },
    });
  });

  it("refuses cleanup outside the disposable fixture policy", () => {
    expect(
      validateNexusProjectHostingFixtureCleanupTarget({
        expectedNamespace: "FixtureOrg",
        namespace: "OtherOrg",
        repositoryName: "dev-nexus-fixture-case-001",
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("namespace OtherOrg"),
    });

    expect(
      validateNexusProjectHostingFixtureCleanupTarget({
        expectedNamespace: "FixtureOrg",
        namespace: "FixtureOrg",
        repositoryName: "dev-nexus-plexus",
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("does not start with"),
    });

    expect(
      validateNexusProjectHostingFixtureCleanupTarget({
        expectedNamespace: "FixtureOrg",
        namespace: "FixtureOrg",
        repositoryName: "dev-nexus-fixture-case-001",
      }),
    ).toMatchObject({
      ok: true,
      status: "allowed",
    });
  });

  it("provisions the fixture end to end through an injected provider", async () => {
    const fixture = buildNexusProjectHostingFixture({
      namespace: "FixtureOrg",
      runId: "mock-001",
      humanAccount: "alice",
      automationAccount: "example-bot",
    });
    const localCommands: NexusProjectHostingLocalRemoteCommand[] = [];
    const provider = mutableFixtureProvider(fixture);

    const result = await runNexusProjectHostingFixtureProvisioning({
      fixture,
      provider,
      localRemotes: [],
      runLocalRemoteCommand(command) {
        localCommands.push(command);
        return localRemoteResult(command);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "passed",
      cleanup: {
        ok: true,
        repositoryName: "dev-nexus-fixture-mock-001",
      },
      finalPlan: {
        actions: [],
      },
    });
    expect(
      result.passes.flatMap((pass) =>
        pass.apply.actions.map((action) => action.actionId),
      ),
    ).toEqual([
      "repository:create",
      "remote:origin:add",
      "remote:bot:add",
      "access:machine_user:example-bot:invite",
      "access:human:alice:invite",
      "access:human:alice:accept-invitation",
    ]);
    expect(localCommands.map((command) => command.remoteName)).toEqual([
      "origin",
      "bot",
    ]);
  });

  it("blocks fixture mutation before missing or mismatched auth can touch a provider", async () => {
    const fixture = buildNexusProjectHostingFixture({
      namespace: "FixtureOrg",
      runId: "auth-001",
      humanAccount: "alice",
      automationAccount: "example-bot",
    });
    const missingBotProfile: NexusProjectHostingFixture = {
      ...fixture,
      authProfiles: fixture.authProfiles.filter(
        (profile) => profile.id !== "bot-github",
      ),
    };
    const provider = mutableFixtureProvider(fixture);

    const missingAuth = await runNexusProjectHostingFixtureProvisioning({
      fixture: missingBotProfile,
      provider,
      runLocalRemoteCommand: localRemoteResult,
    });

    expect(missingAuth).toMatchObject({
      ok: false,
      status: "blocked",
      passes: [
        {
          apply: {
            actions: [
              expect.objectContaining({
                actionId: "repository:create",
                disposition: "blocked",
                reason: expect.stringContaining(
                  "host-local auth profile is missing: bot-github",
                ),
              }),
            ],
          },
        },
      ],
    });
    expect(provider.createCalls).toBe(0);

    const wrongActorProvider = mutableFixtureProvider(fixture, {
      authenticatedAccounts: {
        "bot-github": "mallory",
      },
    });

    const wrongActor = await runNexusProjectHostingFixtureProvisioning({
      fixture,
      provider: wrongActorProvider,
      runLocalRemoteCommand: localRemoteResult,
    });

    expect(wrongActor).toMatchObject({
      ok: false,
      status: "blocked",
      passes: [
        {
          apply: {
            actions: [
              expect.objectContaining({
                actionId: "repository:create",
                disposition: "blocked",
                reason: expect.stringContaining(
                  "authenticated as mallory; expected example-bot",
                ),
              }),
            ],
          },
        },
      ],
    });
    expect(wrongActorProvider.createCalls).toBe(0);
  });
});

function localRemoteResult(
  command: NexusProjectHostingLocalRemoteCommand,
): NexusProjectHostingLocalRemoteCommandResult {
  return {
    args: command.args,
    stdout: "",
    stderr: "",
    exitCode: 0,
  };
}

function mutableFixtureProvider(
  fixture: NexusProjectHostingFixture,
  options: {
    authenticatedAccounts?: Record<string, string | null>;
  } = {},
): NexusProjectHostingProviderAdapter & { createCalls: number } {
  let repository: NexusProjectHostingRepositoryRecord | null = null;
  const access = new Map<string, NexusProjectHostingProviderAccessRecord>();
  let createCalls = 0;
  const adapter: NexusProjectHostingProviderAdapter & { createCalls: number } = {
    provider: "github",
    get createCalls() {
      return createCalls;
    },
    async getRepository() {
      return repository;
    },
    async getPermissions() {
      return {
        read: true,
        write: true,
        maintain: true,
        admin: true,
      };
    },
    async getAuthenticatedAccount(input) {
      if (input.authProfile.id in (options.authenticatedAccounts ?? {})) {
        return options.authenticatedAccounts?.[input.authProfile.id] ?? null;
      }
      return input.authProfile.account ?? null;
    },
    async createRepository(input) {
      createCalls += 1;
      repository = {
        namespace: input.namespace,
        name: input.repositoryName,
        visibility: input.visibility,
        defaultBranch: input.defaultBranch,
      };
      return {
        status: "created",
        repository,
      };
    },
    async getAccess(input) {
      return (
        access.get(accessKey(input.principal.kind, input.principal.providerIdentity)) ??
        {
          effectivePermission: null,
        }
      );
    },
    async repairAccess(input) {
      const key = accessKey(
        input.principal.kind,
        input.principal.providerIdentity,
      );
      const repaired: NexusProjectHostingProviderAccessRecord =
        input.principal.invitationPolicy === "auto_accept"
          ? {
              effectivePermission: null,
              pendingInvitation: true,
              invitationId: `invite-${input.principal.providerIdentity}`,
            }
          : {
              effectivePermission: input.requiredPermission,
            };
      access.set(key, repaired);
      return {
        status: input.operation === "update" ? "updated" : "invited",
        access: repaired,
      };
    },
    async listInvitations(input) {
      const record = access.get(
        accessKey(input.principal.kind, input.principal.providerIdentity),
      );
      return record?.pendingInvitation && record.invitationId
        ? [
            {
              id: record.invitationId,
              namespace: fixture.hosting.namespace,
              repositoryName: fixture.repositoryName,
              permission: input.principal.requiredPermission,
            },
          ]
        : [];
    },
    async acceptInvitation(input) {
      const accessRecord: NexusProjectHostingProviderAccessRecord = {
        effectivePermission: input.principal.requiredPermission,
        pendingInvitation: false,
      };
      access.set(
        accessKey(input.principal.kind, input.principal.providerIdentity),
        accessRecord,
      );
      return {
        status: "accepted",
        access: accessRecord,
      };
    },
  };
  return adapter;
}

function accessKey(kind: string, providerIdentity: string): string {
  return `${kind}:${providerIdentity}`.toLowerCase();
}
