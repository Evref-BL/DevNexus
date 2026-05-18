import { describe, expect, it } from "vitest";
import {
  deriveNexusProjectHostingRepositoryName,
  expectedNexusProjectHostingRemotes,
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
