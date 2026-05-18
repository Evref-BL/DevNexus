import { describe, expect, it } from "vitest";
import {
  deriveNexusProjectHostingRepositoryName,
  expectedNexusProjectHostingRemotes,
  planNexusProjectHosting,
  preflightNexusProjectHosting,
  statusNexusProjectHosting,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingConfig,
  type NexusProjectHostingPermissionSet,
  type NexusProjectHostingProviderAccessRecord,
  type NexusProjectHostingProviderAdapter,
  type NexusProjectHostingRepositoryRecord,
} from "./nexusProjectHosting.js";

const project = {
  id: "example-suite",
  name: "Example Suite",
};

const authProfiles: NexusHostingAuthProfileConfig[] = [
  {
    id: "human-github",
    provider: "github",
    kind: "human",
    account: "alice",
    host: "github.com",
  },
  {
    id: "bot-github",
    provider: "github",
    kind: "automation",
    account: "example-bot",
    sshHost: "github.com-example-bot",
    githubCliConfigDir: "/home/alice/.config/gh-example-bot",
  },
];

function hosting(
  overrides: Partial<NexusProjectHostingConfig> = {},
): NexusProjectHostingConfig {
  return {
    provider: "github",
    namespace: "ExampleOrg",
    repository: {
      nameTemplate: "{projectNameSlug}-meta",
      visibility: "private",
      defaultBranch: "main",
    },
    authProfile: "human-github",
    remotes: [
      {
        name: "origin",
        role: "human",
        protocol: "ssh",
      },
      {
        name: "bot",
        role: "automation",
        protocol: "ssh",
        authProfile: "bot-github",
      },
    ],
    access: [],
    provisioning: {
      allowCreate: false,
      allowLocalRemoteRepair: false,
      allowAccessRepair: false,
      allowInvitationAcceptance: false,
      allowDefaultBranchRepair: false,
      allowVisibilityRepair: false,
    },
    ...overrides,
  };
}

function provider(options: {
  repository?: NexusProjectHostingRepositoryRecord | null;
  permissions?: Record<string, Partial<NexusProjectHostingPermissionSet>>;
  actors?: Record<string, string | null>;
  access?: Record<string, NexusProjectHostingProviderAccessRecord>;
}): NexusProjectHostingProviderAdapter {
  const adapter: NexusProjectHostingProviderAdapter = {
    provider: "github",
    async getRepository() {
      return options.repository ?? null;
    },
    async getPermissions(input) {
      return {
        read: false,
        write: false,
        maintain: false,
        admin: false,
        ...(options.permissions?.[input.remoteName] ?? {}),
      };
    },
  };

  if (options.actors) {
    adapter.getAuthenticatedAccount = async (input) =>
      options.actors?.[input.authProfile.id] ?? null;
  }
  if (options.access) {
    adapter.getAccess = async (input) =>
      options.access?.[
        `${input.principal.kind}:${input.principal.providerIdentity}`.toLowerCase()
      ] ?? {
        effectivePermission: null,
      };
  }

  return adapter;
}

describe("project hosting", () => {
  it("derives repository names and expected GitHub remote URLs", () => {
    const config = hosting();

    expect(
      deriveNexusProjectHostingRepositoryName({
        project,
        hosting: config,
      }),
    ).toBe("example-suite-meta");
    expect(
      expectedNexusProjectHostingRemotes({
        project,
        hosting: config,
        authProfiles,
      }),
    ).toEqual([
      {
        name: "origin",
        role: "human",
        protocol: "ssh",
        authProfile: "human-github",
        url: "git@github.com:ExampleOrg/example-suite-meta.git",
      },
      {
        name: "bot",
        role: "automation",
        protocol: "ssh",
        authProfile: "bot-github",
        url: "git@github.com-example-bot:ExampleOrg/example-suite-meta.git",
      },
    ]);
  });

  it("preflights a missing repository without creating it", async () => {
    const result = await preflightNexusProjectHosting({
      project,
      hosting: hosting(),
      authProfiles,
      provider: provider({
        repository: null,
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      repositoryExists: false,
      issues: [
        {
          code: "repository_missing",
          severity: "blocker",
        },
      ],
    });
  });

  it("builds a passed read-only hosting status from local and provider facts", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "machine_user",
          providerIdentity: "example-bot",
          role: "automation",
          requiredPermission: "write",
          authProfile: "bot-github",
          invitationPolicy: "require_accepted",
        },
      ],
    });
    const remotes = expectedNexusProjectHostingRemotes({
      project,
      hosting: config,
      authProfiles,
    });

    const result = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      localRemotes: remotes.map((remote) => ({
        name: remote.name,
        url: remote.url,
      })),
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        },
        actors: {
          "human-github": "alice",
          "bot-github": "example-bot",
        },
        access: {
          "human:alice": {
            effectivePermission: "admin",
          },
          "machine_user:example-bot": {
            effectivePermission: "write",
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "passed",
      configured: true,
      repositoryName: "example-suite-meta",
      repository: {
        exists: true,
        visibility: "private",
        defaultBranch: "main",
      },
      remotes: [
        {
          name: "origin",
          status: "matched",
        },
        {
          name: "bot",
          status: "matched",
        },
      ],
      authProfiles: [
        {
          id: "bot-github",
          status: "matched",
        },
        {
          id: "human-github",
          status: "matched",
        },
      ],
      access: [
        {
          providerIdentity: "alice",
          status: "satisfied",
        },
        {
          providerIdentity: "example-bot",
          status: "satisfied",
        },
      ],
      issues: [],
    });
  });

  it("reports local remote, actor, access, and pending-invitation drift", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "machine_user",
          providerIdentity: "example-bot",
          role: "automation",
          requiredPermission: "write",
          authProfile: "bot-github",
          invitationPolicy: "require_accepted",
        },
      ],
    });

    const result = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      localRemotes: [
        {
          name: "origin",
          url: "git@github.com:ExampleOrg/wrong.git",
        },
      ],
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        },
        actors: {
          "human-github": "mallory",
          "bot-github": "example-bot",
        },
        access: {
          "human:alice": {
            effectivePermission: "read",
          },
          "machine_user:example-bot": {
            effectivePermission: null,
            pendingInvitation: true,
          },
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "local_remote_url_mismatch",
      "local_remote_missing",
      "auth_profile_actor_mismatch",
      "access_insufficient",
      "access_pending_invitation",
    ]);
    expect(result.remotes.map((remote) => [remote.name, remote.status])).toEqual([
      ["origin", "mismatch"],
      ["bot", "missing"],
    ]);
    expect(
      result.access.map((access) => [
        access.providerIdentity,
        access.status,
      ]),
    ).toEqual([
      ["alice", "insufficient"],
      ["example-bot", "pending"],
    ]);
  });

  it("distinguishes missing config, missing repository, and unsupported access reads", async () => {
    await expect(statusNexusProjectHosting({ project })).resolves.toMatchObject({
      ok: true,
      status: "not_configured",
      configured: false,
      issues: [
        {
          code: "hosting_not_configured",
        },
      ],
    });

    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "read",
          authProfile: "human-github",
          invitationPolicy: "require_accepted",
        },
      ],
    });

    await expect(
      statusNexusProjectHosting({
        project,
        hosting: config,
        authProfiles,
        provider: provider({
          repository: null,
        }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      repository: {
        exists: false,
      },
      access: [
        {
          status: "unchecked",
        },
      ],
      issues: [
        {
          code: "repository_missing",
        },
      ],
    });

    await expect(
      statusNexusProjectHosting({
        project,
        hosting: config,
        authProfiles,
        provider: provider({
          repository: {
            namespace: "ExampleOrg",
            name: "example-suite-meta",
            visibility: "private",
            defaultBranch: "main",
          },
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "warning",
      access: [
        {
          status: "unsupported",
        },
      ],
      issues: [
        {
          code: "provider_access_unsupported",
        },
      ],
    });
  });

  it("plans ordered allowed hosting repairs without mutating provider state", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "team",
          providerIdentity: "platform",
          role: "reviewer",
          requiredPermission: "read",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "machine_user",
          providerIdentity: "example-bot",
          role: "automation",
          requiredPermission: "write",
          authProfile: "bot-github",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "human",
          providerIdentity: "bob",
          role: "reviewer",
          requiredPermission: "read",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
        {
          kind: "human",
          providerIdentity: "carol",
          role: "observer",
          requiredPermission: "read",
          authProfile: "human-github",
          invitationPolicy: "manual",
        },
      ],
      provisioning: {
        allowCreate: true,
        allowLocalRemoteRepair: true,
        allowAccessRepair: true,
        allowInvitationAcceptance: true,
        allowDefaultBranchRepair: true,
        allowVisibilityRepair: true,
        providerMutationAuthProfile: "bot-github",
      },
    });
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      localRemotes: [
        {
          name: "origin",
          url: "git@github.com:ExampleOrg/wrong.git",
        },
      ],
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "public",
          defaultBranch: "trunk",
        },
        access: {
          "human:alice": {
            effectivePermission: null,
          },
          "team:platform": {
            effectivePermission: null,
          },
          "machine_user:example-bot": {
            effectivePermission: "read",
          },
          "human:bob": {
            effectivePermission: null,
            pendingInvitation: true,
          },
          "human:carol": {
            effectivePermission: null,
            pendingInvitation: true,
          },
        },
      }),
    });

    const plan = planNexusProjectHosting({
      hosting: config,
      status,
    });

    expect(plan).toMatchObject({
      ok: true,
      status: "manual",
      provider: "github",
      namespace: "ExampleOrg",
      repositoryName: "example-suite-meta",
    });
    expect(
      plan.actions.map((action) => [
        action.id,
        action.kind,
        action.disposition,
        action.mutationClass,
        action.authProfile,
      ]),
    ).toEqual([
      [
        "remote:origin:update",
        "update_local_remote",
        "allowed",
        "local_remote_repair",
        "human-github",
      ],
      [
        "remote:bot:add",
        "add_local_remote",
        "allowed",
        "local_remote_repair",
        "bot-github",
      ],
      [
        "access:human:alice:invite",
        "invite_collaborator",
        "allowed",
        "access_repair",
        "bot-github",
      ],
      [
        "access:team:platform:add",
        "add_collaborator",
        "allowed",
        "access_repair",
        "bot-github",
      ],
      [
        "access:machine_user:example-bot:update",
        "update_collaborator_permission",
        "allowed",
        "access_repair",
        "bot-github",
      ],
      [
        "access:human:bob:accept-invitation",
        "accept_invitation",
        "allowed",
        "invitation_acceptance",
        "human-github",
      ],
      [
        "access:human:carol:wait-invitation",
        "wait_for_invitation",
        "manual",
        "read_only",
        "human-github",
      ],
      [
        "repository:default-branch",
        "repair_default_branch",
        "allowed",
        "default_branch_repair",
        "bot-github",
      ],
      [
        "repository:visibility",
        "repair_visibility",
        "allowed",
        "visibility_repair",
        "bot-github",
      ],
    ]);
    expect(plan.actions[0]).toMatchObject({
      current: {
        url: "git@github.com:ExampleOrg/wrong.git",
      },
      desired: {
        url: "git@github.com:ExampleOrg/example-suite-meta.git",
      },
    });
    expect(plan.actions.at(-1)).toMatchObject({
      current: {
        visibility: "public",
      },
      desired: {
        visibility: "private",
      },
    });
  });

  it("plans repository creation and blocked policy gates deterministically", async () => {
    const createConfig = hosting({
      provisioning: {
        allowCreate: true,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    const createStatus = await statusNexusProjectHosting({
      project,
      hosting: createConfig,
      provider: provider({
        repository: null,
      }),
    });

    expect(
      planNexusProjectHosting({
        hosting: createConfig,
        status: createStatus,
      }).actions,
    ).toMatchObject([
      {
        id: "repository:create",
        kind: "create_repository",
        disposition: "allowed",
        authProfile: "bot-github",
        desired: {
          exists: true,
          visibility: "private",
          defaultBranch: "main",
        },
      },
    ]);

    const blockedConfig = hosting({
      repository: {
        name: "example-suite-meta",
        visibility: "public",
        defaultBranch: "main",
      },
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "write",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: true,
      },
    });
    const blockedStatus = await statusNexusProjectHosting({
      project,
      hosting: blockedConfig,
      authProfiles,
      localRemotes: [],
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "trunk",
        },
        access: {
          "human:alice": {
            effectivePermission: null,
            pendingInvitation: true,
          },
        },
      }),
    });

    const blockedPlan = planNexusProjectHosting({
      hosting: blockedConfig,
      status: blockedStatus,
    });

    expect(blockedPlan.ok).toBe(false);
    expect(
      blockedPlan.actions.map((action) => [
        action.kind,
        action.disposition,
        action.reason,
      ]),
    ).toEqual([
      [
        "add_local_remote",
        "blocked",
        "Local Git remote origin is missing, but hosting.provisioning.allowLocalRemoteRepair is false.",
      ],
      [
        "add_local_remote",
        "blocked",
        "Local Git remote bot is missing, but hosting.provisioning.allowLocalRemoteRepair is false.",
      ],
      [
        "accept_invitation",
        "blocked",
        "Invitation acceptance is blocked because hosting.provisioning.allowInvitationAcceptance is false.",
      ],
      [
        "repair_default_branch",
        "blocked",
        "Default-branch repair is blocked because hosting.provisioning.allowDefaultBranchRepair is false.",
      ],
      [
        "repair_visibility",
        "blocked",
        "Visibility repair would broaden repository exposure and is declined as unsafe.",
      ],
    ]);
  });

  it("plans unsupported provider access and missing hosting as explicit actions", async () => {
    expect(
      planNexusProjectHosting({
        status: await statusNexusProjectHosting({ project }),
      }),
    ).toMatchObject({
      ok: true,
      status: "manual",
      actions: [
        {
          id: "hosting:configure",
          kind: "configure_hosting",
          disposition: "manual",
        },
      ],
    });

    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "read",
          authProfile: "human-github",
          invitationPolicy: "require_accepted",
        },
      ],
    });
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        },
      }),
    });

    expect(
      planNexusProjectHosting({
        hosting: config,
        status,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          id: "access:human:alice:unsupported",
          kind: "unsupported_provider_operation",
          disposition: "blocked",
          mutationClass: "read_only",
        },
      ],
    });
  });

  it("reports configured actor permission mismatches", async () => {
    const result = await preflightNexusProjectHosting({
      project,
      hosting: hosting({
        provisioning: {
          allowCreate: true,
          allowLocalRemoteRepair: false,
          allowAccessRepair: false,
          allowInvitationAcceptance: false,
          allowDefaultBranchRepair: false,
          allowVisibilityRepair: false,
        },
      }),
      authProfiles,
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        },
        permissions: {
          origin: {
            read: true,
          },
          bot: {
            read: true,
            write: true,
            admin: false,
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      issues: [
        {
          code: "permission_mismatch",
          remoteName: "bot",
          authProfile: "bot-github",
        },
      ],
    });
    expect(result.issues[0]?.message).toContain("admin access");
  });

  it("reports missing host-local auth profiles referenced by shared config", async () => {
    const result = await preflightNexusProjectHosting({
      project,
      hosting: hosting(),
      authProfiles: authProfiles.filter((profile) => profile.id !== "bot-github"),
      provider: provider({
        repository: {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        },
        permissions: {
          origin: {
            read: true,
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      issues: [
        {
          code: "auth_profile_missing",
          remoteName: "bot",
          authProfile: "bot-github",
        },
      ],
    });
  });
});
