import { describe, expect, it } from "vitest";
import {
  applyNexusProjectHosting,
  applyNexusProjectHostingLocalRemoteRepairs,
  deriveNexusProjectHostingRepositoryName,
  expectedNexusProjectHostingRemotes,
  planNexusProjectHosting,
  preflightNexusProjectHosting,
  statusNexusProjectHosting,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingConfig,
  type NexusProjectHostingPermissionSet,
  type NexusProjectHostingProviderAccessRecord,
  type NexusProjectHostingProviderAppInstallationRecord,
  type NexusProjectHostingProviderAdapter,
  type NexusProjectHostingRepositoryRecord,
} from "../src/nexusProjectHosting.js";

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
  {
    id: "devnexus-app",
    provider: "github",
    kind: "app",
    credentialKind: "github_app",
    account: "devnexus-automation",
    host: "github.com",
    githubApp: {
      appId: "3794753",
      slug: "devnexus-automation",
      privateKeyPath: "/home/alice/.dev-nexus/devnexus-automation.pem",
      installationAccount: "ExampleOrg",
      repositories: ["example-suite-meta"],
    },
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
  appInstallations?: Record<
    string,
    NexusProjectHostingProviderAppInstallationRecord | null
  >;
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
  if (options.appInstallations) {
    adapter.getAppInstallation = async (input) =>
      options.appInstallations?.[
        `${input.principal.kind}:${input.principal.providerIdentity}`.toLowerCase()
      ] ?? null;
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

  it("reports installed GitHub Apps separately from collaborator access", async () => {
    const config = hosting({
      access: [
        {
          kind: "app",
          providerIdentity: "devnexus-automation",
          role: "automation",
          requiredPermission: "write",
          requiredProviderPermissions: {
            contents: "write",
            issues: "write",
            pull_requests: "write",
          },
          authProfile: "devnexus-app",
          invitationPolicy: "manual",
        },
      ],
    });

    const result = await statusNexusProjectHosting({
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
        actors: {
          "devnexus-app": "devnexus-automation",
        },
        appInstallations: {
          "app:devnexus-automation": {
            installed: true,
            installationAccount: "ExampleOrg",
            repositorySelection: "selected",
            repositorySelected: true,
            permissions: {
              contents: "write",
              issues: "write",
              pull_requests: "write",
            },
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "passed",
      access: [],
      appInstallations: [
        {
          providerIdentity: "devnexus-automation",
          installationAccount: "ExampleOrg",
          repositorySelection: "selected",
          repositorySelected: true,
          status: "installed",
          missingPermissions: {},
        },
      ],
      issues: [],
    });
    expect(result.authProfiles).toContainEqual(
      expect.objectContaining({
        id: "devnexus-app",
        kind: "app",
        status: "matched",
      }),
    );
    expect(
      planNexusProjectHosting({
        hosting: config,
        status: result,
      }).actions,
    ).toEqual([]);
  });

  it("distinguishes GitHub App installation, repository, and permission gaps", async () => {
    const config = hosting({
      access: [
        {
          kind: "app",
          providerIdentity: "devnexus-automation",
          role: "automation",
          requiredPermission: "write",
          requiredProviderPermissions: {
            contents: "write",
            issues: "write",
          },
          authProfile: "devnexus-app",
          invitationPolicy: "manual",
        },
      ],
    });
    const repository = {
      namespace: "ExampleOrg",
      name: "example-suite-meta",
      visibility: "private" as const,
      defaultBranch: "main",
    };

    const missingInstallation = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: provider({
        repository,
        appInstallations: {
          "app:devnexus-automation": null,
        },
      }),
    });
    expect(missingInstallation).toMatchObject({
      ok: false,
      status: "blocked",
      appInstallations: [
        {
          providerIdentity: "devnexus-automation",
          status: "missing",
        },
      ],
      issues: [
        {
          code: "app_installation_missing",
          severity: "blocker",
        },
      ],
    });

    const missingRepository = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: provider({
        repository,
        appInstallations: {
          "app:devnexus-automation": {
            installed: true,
            installationAccount: "ExampleOrg",
            repositorySelection: "selected",
            repositorySelected: false,
            permissions: {
              contents: "write",
              issues: "write",
            },
          },
        },
      }),
    });
    expect(missingRepository).toMatchObject({
      ok: false,
      status: "blocked",
      appInstallations: [
        {
          providerIdentity: "devnexus-automation",
          repositorySelected: false,
          status: "repository_missing",
        },
      ],
      issues: [
        {
          code: "app_repository_not_selected",
          severity: "blocker",
        },
      ],
    });
    expect(
      planNexusProjectHosting({
        hosting: config,
        status: missingRepository,
      }).actions,
    ).toMatchObject([
      {
        id: "app:devnexus-automation:select-repository",
        kind: "select_app_repository",
        disposition: "manual",
      },
    ]);

    const missingPermission = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: provider({
        repository,
        appInstallations: {
          "app:devnexus-automation": {
            installed: true,
            installationAccount: "ExampleOrg",
            repositorySelection: "all",
            repositorySelected: true,
            permissions: {
              contents: "write",
              issues: "read",
            },
          },
        },
      }),
    });
    expect(missingPermission).toMatchObject({
      ok: false,
      status: "blocked",
      appInstallations: [
        {
          providerIdentity: "devnexus-automation",
          status: "permission_missing",
          missingPermissions: {
            issues: "write",
          },
        },
      ],
      issues: [
        {
          code: "app_permission_missing",
          severity: "blocker",
        },
      ],
    });
    expect(
      planNexusProjectHosting({
        hosting: config,
        status: missingPermission,
      }).actions,
    ).toMatchObject([
      {
        id: "app:devnexus-automation:permissions",
        kind: "update_app_permissions",
        disposition: "manual",
      },
    ]);
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

  it("applies allowed local remote repairs and reports final status", async () => {
    const config = hosting({
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: true,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
      },
    });
    const localRemotes = new Map<string, string | null>([
      ["origin", "git@github.com:ExampleOrg/wrong.git"],
      ["upstream", "git@github.com:ExampleOrg/upstream.git"],
    ]);
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      localRemotes: [...localRemotes].map(([name, url]) => ({ name, url })),
    });

    const result = await applyNexusProjectHostingLocalRemoteRepairs({
      hosting: config,
      status,
      async runLocalRemoteCommand(command) {
        if (command.kind === "set_url") {
          localRemotes.set(command.remoteName, command.url);
        } else {
          localRemotes.set(command.remoteName, command.url);
        }
        return {
          args: command.args,
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      },
      refreshStatus: () =>
        statusNexusProjectHosting({
          project,
          hosting: config,
          authProfiles,
          localRemotes: [...localRemotes].map(([name, url]) => ({ name, url })),
        }),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("passed");
    expect(
      result.actions.map((action) => [
        action.actionId,
        action.disposition,
        action.command?.args,
      ]),
    ).toEqual([
      [
        "remote:origin:update",
        "applied",
        [
          "remote",
          "set-url",
          "origin",
          "git@github.com:ExampleOrg/example-suite-meta.git",
        ],
      ],
      [
        "remote:bot:add",
        "applied",
        [
          "remote",
          "add",
          "bot",
          "git@github.com-example-bot:ExampleOrg/example-suite-meta.git",
        ],
      ],
    ]);
    expect(localRemotes.get("upstream")).toBe(
      "git@github.com:ExampleOrg/upstream.git",
    );
    expect(result.finalStatus?.remotes.map((remote) => remote.status)).toEqual([
      "matched",
      "matched",
    ]);
    expect(result.finalPlan?.actions).toEqual([]);
  });

  it("skips blocked local remote repairs without executing commands", async () => {
    const config = hosting({
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
      },
    });
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      localRemotes: [],
    });
    const commands: unknown[] = [];

    const result = await applyNexusProjectHostingLocalRemoteRepairs({
      hosting: config,
      status,
      async runLocalRemoteCommand(command) {
        commands.push(command);
        return {
          args: command.args,
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(commands).toEqual([]);
    expect(result.actions).toEqual([
      expect.objectContaining({
        actionId: "remote:origin:add",
        disposition: "skipped",
        reason:
          "Skipped blocked local remote repair: Local Git remote origin is missing, but hosting.provisioning.allowLocalRemoteRepair is false.",
      }),
      expect.objectContaining({
        actionId: "remote:bot:add",
        disposition: "skipped",
      }),
    ]);
  });

  it("does not mutate already-correct local remotes", async () => {
    const config = hosting({
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: true,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
      },
    });
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      localRemotes: [
        {
          name: "origin",
          url: "git@github.com:ExampleOrg/example-suite-meta.git",
        },
        {
          name: "bot",
          url: "git@github.com-example-bot:ExampleOrg/example-suite-meta.git",
        },
      ],
    });
    const commands: unknown[] = [];

    const result = await applyNexusProjectHostingLocalRemoteRepairs({
      hosting: config,
      status,
      async runLocalRemoteCommand(command) {
        commands.push(command);
        return {
          args: command.args,
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "passed",
      actions: [],
    });
    expect(commands).toEqual([]);
  });

  it("creates a missing repository through the provider and reports final facts", async () => {
    const config = hosting({
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
    let repository: NexusProjectHostingRepositoryRecord | null = null;
    const createInputs: unknown[] = [];
    const hostingProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
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
        return input.authProfile.account ?? null;
      },
      async createRepository(input) {
        createInputs.push(input);
        repository = {
          namespace: input.namespace,
          name: input.repositoryName,
          visibility: input.visibility,
          defaultBranch: input.defaultBranch,
        };
        return {
          status: "created",
          repository,
          webUrl: "https://github.com/ExampleOrg/example-suite-meta",
          remoteUrl: "git@github.com-bot:ExampleOrg/example-suite-meta.git",
        };
      },
    };

    const initialStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: hostingProvider,
    });

    const result = await applyNexusProjectHosting({
      hosting: config,
      status: initialStatus,
      authProfiles,
      provider: hostingProvider,
      refreshStatus: () =>
        statusNexusProjectHosting({
          project,
          hosting: config,
          authProfiles,
          provider: hostingProvider,
        }),
    });

    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([
      expect.objectContaining({
        actionId: "repository:create",
        disposition: "applied",
        providerResult: expect.objectContaining({
          status: "created",
          webUrl: "https://github.com/ExampleOrg/example-suite-meta",
          remoteUrl: "git@github.com-bot:ExampleOrg/example-suite-meta.git",
        }),
      }),
    ]);
    expect(createInputs).toEqual([
      expect.objectContaining({
        namespace: "ExampleOrg",
        repositoryName: "example-suite-meta",
        visibility: "private",
        defaultBranch: "main",
        authProfile: expect.objectContaining({ id: "bot-github" }),
      }),
    ]);
    expect(result.finalStatus?.repository).toMatchObject({
      exists: true,
      visibility: "private",
      defaultBranch: "main",
    });
    expect(result.finalPlan?.actions).toEqual([]);
  });

  it("repairs missing and insufficient collaborator access through the provider", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "allow_pending",
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
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: true,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    const accessState = new Map<string, NexusProjectHostingProviderAccessRecord>([
      ["human:alice", { effectivePermission: null }],
      ["machine_user:example-bot", { effectivePermission: "read" }],
    ]);
    const repairInputs: unknown[] = [];
    const hostingProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
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
        return input.authProfile.account ?? null;
      },
      async getAccess(input) {
        return (
          accessState.get(
            `${input.principal.kind}:${input.principal.providerIdentity}`.toLowerCase(),
          ) ?? { effectivePermission: null }
        );
      },
      async repairAccess(input) {
        repairInputs.push(input);
        const key =
          `${input.principal.kind}:${input.principal.providerIdentity}`.toLowerCase();
        const access = {
          effectivePermission: input.requiredPermission,
        };
        accessState.set(key, access);
        return {
          status: input.operation === "update" ? "updated" : "invited",
          access,
        };
      },
    };
    const initialStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: hostingProvider,
    });

    const result = await applyNexusProjectHosting({
      hosting: config,
      status: initialStatus,
      authProfiles,
      provider: hostingProvider,
      refreshStatus: () =>
        statusNexusProjectHosting({
          project,
          hosting: config,
          authProfiles,
          provider: hostingProvider,
        }),
    });

    expect(result.ok).toBe(true);
    expect(
      result.actions.map((action) => [
        action.actionId,
        action.kind,
        action.disposition,
        action.providerResult?.status,
      ]),
    ).toEqual([
      [
        "access:human:alice:invite",
        "invite_collaborator",
        "applied",
        "invited",
      ],
      [
        "access:machine_user:example-bot:update",
        "update_collaborator_permission",
        "applied",
        "updated",
      ],
    ]);
    expect(repairInputs).toEqual([
      expect.objectContaining({
        namespace: "ExampleOrg",
        repositoryName: "example-suite-meta",
        operation: "invite",
        requiredPermission: "admin",
        principal: expect.objectContaining({
          kind: "human",
          providerIdentity: "alice",
        }),
        mutationAuthProfile: expect.objectContaining({ id: "bot-github" }),
      }),
      expect.objectContaining({
        operation: "update",
        requiredPermission: "write",
        principal: expect.objectContaining({
          kind: "machine_user",
          providerIdentity: "example-bot",
        }),
        mutationAuthProfile: expect.objectContaining({ id: "bot-github" }),
      }),
    ]);
    expect(result.finalStatus?.access.map((access) => access.status)).toEqual([
      "satisfied",
      "satisfied",
    ]);
    expect(result.finalPlan?.actions).toEqual([]);

    const rerun = await applyNexusProjectHosting({
      hosting: config,
      status: result.finalStatus!,
      authProfiles,
      provider: hostingProvider,
    });
    expect(rerun).toMatchObject({
      ok: true,
      status: "passed",
      actions: [],
    });
    expect(repairInputs).toHaveLength(2);
  });

  it("blocks access repair before provider mutation when auth is missing or mismatched", async () => {
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
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: true,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    let repairCalls = 0;
    const baseProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
      },
      async getPermissions() {
        return {
          read: true,
          write: true,
          maintain: true,
          admin: true,
        };
      },
      async getAccess() {
        return {
          effectivePermission: null,
        };
      },
      async repairAccess() {
        repairCalls += 1;
        return {
          status: "invited",
        };
      },
    };

    const missingAuthStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      provider: baseProvider,
    });
    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status: missingAuthStatus,
        provider: baseProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:human:alice:invite",
          disposition: "blocked",
          reason:
            "Skipped access repair: host-local auth profile is missing: bot-github.",
        },
      ],
    });

    const wrongActorProvider: NexusProjectHostingProviderAdapter = {
      ...baseProvider,
      async getAuthenticatedAccount() {
        return "mallory";
      },
    };
    const wrongActorStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: wrongActorProvider,
    });
    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status: wrongActorStatus,
        authProfiles,
        provider: wrongActorProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:human:alice:invite",
          disposition: "blocked",
          reason:
            "Skipped access repair: auth profile bot-github is authenticated as mallory; expected example-bot.",
        },
      ],
    });
    expect(repairCalls).toBe(0);
  });

  it("reports provider access repair blockers and unsupported principal kinds", async () => {
    const config = hosting({
      access: [
        {
          kind: "deploy_key",
          providerIdentity: "ci-read-key",
          role: "automation",
          requiredPermission: "read",
          invitationPolicy: "require_accepted",
        },
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: true,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    const hostingProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
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
        return input.authProfile.account ?? null;
      },
      async getAccess() {
        return {
          effectivePermission: null,
        };
      },
      async repairAccess() {
        return {
          status: "blocked",
          code: "unsupported_principal_kind",
          message:
            "GitHub access repair for deploy_key principals is not supported by this adapter.",
        };
      },
    };
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: hostingProvider,
    });

    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status,
        authProfiles,
        provider: hostingProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:deploy_key:ci-read-key:add",
          disposition: "blocked",
          providerResult: {
            code: "unsupported_principal_kind",
          },
          reason:
            "GitHub access repair for deploy_key principals is not supported by this adapter.",
        },
      ],
    });
  });

  it("accepts pending invitations through invitee auth profiles", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: true,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    let accessRecord: NexusProjectHostingProviderAccessRecord = {
      effectivePermission: null,
      pendingInvitation: true,
    };
    const listInputs: unknown[] = [];
    const acceptInputs: unknown[] = [];
    const hostingProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
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
        return input.authProfile.account ?? null;
      },
      async getAccess() {
        return accessRecord;
      },
      async listInvitations(input) {
        listInputs.push(input);
        return [
          {
            id: "invite-1",
            namespace: "ExampleOrg",
            repositoryName: "example-suite-meta",
            permission: "admin",
          },
        ];
      },
      async acceptInvitation(input) {
        acceptInputs.push(input);
        accessRecord = {
          effectivePermission: "admin",
          pendingInvitation: false,
        };
        return {
          status: "accepted",
          access: accessRecord,
        };
      },
    };
    const initialStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: hostingProvider,
    });

    const result = await applyNexusProjectHosting({
      hosting: config,
      status: initialStatus,
      authProfiles,
      provider: hostingProvider,
      refreshStatus: () =>
        statusNexusProjectHosting({
          project,
          hosting: config,
          authProfiles,
          provider: hostingProvider,
        }),
    });

    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([
      expect.objectContaining({
        actionId: "access:human:alice:accept-invitation",
        kind: "accept_invitation",
        disposition: "applied",
        providerResult: expect.objectContaining({
          status: "accepted",
        }),
      }),
    ]);
    expect(listInputs).toEqual([
      expect.objectContaining({
        namespace: "ExampleOrg",
        repositoryName: "example-suite-meta",
        principal: expect.objectContaining({
          kind: "human",
          providerIdentity: "alice",
        }),
        authProfile: expect.objectContaining({ id: "human-github" }),
      }),
    ]);
    expect(acceptInputs).toEqual([
      expect.objectContaining({
        namespace: "ExampleOrg",
        repositoryName: "example-suite-meta",
        invitationId: "invite-1",
        principal: expect.objectContaining({
          kind: "human",
          providerIdentity: "alice",
        }),
        authProfile: expect.objectContaining({ id: "human-github" }),
      }),
    ]);
    expect(result.finalStatus?.access).toEqual([
      expect.objectContaining({
        providerIdentity: "alice",
        status: "satisfied",
        effectivePermission: "admin",
        pendingInvitation: false,
      }),
    ]);
    expect(result.finalPlan?.actions).toEqual([]);

    const rerun = await applyNexusProjectHosting({
      hosting: config,
      status: result.finalStatus!,
      authProfiles,
      provider: hostingProvider,
    });
    expect(rerun.actions).toEqual([]);
    expect(acceptInputs).toHaveLength(1);
  });

  it("blocks invitation acceptance before provider mutation when invitee auth is missing or mismatched", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: true,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    let acceptCalls = 0;
    const baseProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
      },
      async getPermissions() {
        return {
          read: true,
          write: true,
          maintain: true,
          admin: true,
        };
      },
      async getAccess() {
        return {
          effectivePermission: null,
          pendingInvitation: true,
          invitationId: "invite-1",
        };
      },
      async acceptInvitation() {
        acceptCalls += 1;
        return {
          status: "accepted",
        };
      },
    };

    const missingAuthStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      provider: baseProvider,
    });
    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status: missingAuthStatus,
        provider: baseProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:human:alice:accept-invitation",
          disposition: "blocked",
          reason:
            "Skipped invitation acceptance: host-local auth profile is missing: human-github.",
        },
      ],
    });

    const wrongActorProvider: NexusProjectHostingProviderAdapter = {
      ...baseProvider,
      async getAuthenticatedAccount() {
        return "mallory";
      },
    };
    const wrongActorStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: wrongActorProvider,
    });
    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status: wrongActorStatus,
        authProfiles,
        provider: wrongActorProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:human:alice:accept-invitation",
          disposition: "blocked",
          reason:
            "Skipped invitation acceptance: auth profile human-github is authenticated as mallory; expected alice.",
        },
      ],
    });
    expect(acceptCalls).toBe(0);
  });

  it("reports missing and provider-blocked invitation acceptance", async () => {
    const config = hosting({
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: true,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });
    let acceptCalls = 0;
    const missingInvitationProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
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
        return input.authProfile.account ?? null;
      },
      async getAccess() {
        return {
          effectivePermission: null,
          pendingInvitation: true,
        };
      },
      async listInvitations() {
        return [];
      },
      async acceptInvitation() {
        acceptCalls += 1;
        return {
          status: "accepted",
        };
      },
    };
    const missingInvitationStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: missingInvitationProvider,
    });
    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status: missingInvitationStatus,
        authProfiles,
        provider: missingInvitationProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:human:alice:accept-invitation",
          disposition: "blocked",
          reason:
            "Skipped invitation acceptance: pending invitation was not found for human:alice.",
        },
      ],
    });
    expect(acceptCalls).toBe(0);

    const providerBlockedStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: {
        ...missingInvitationProvider,
        async getAccess() {
          return {
            effectivePermission: null,
            pendingInvitation: true,
            invitationId: "invite-1",
          };
        },
      },
    });
    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status: providerBlockedStatus,
        authProfiles,
        provider: {
          ...missingInvitationProvider,
          async acceptInvitation() {
            return {
              status: "blocked",
              code: "expired_invitation",
              message: "GitHub reports that invite-1 has expired.",
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "access:human:alice:accept-invitation",
          disposition: "blocked",
          providerResult: {
            code: "expired_invitation",
          },
          reason: "GitHub reports that invite-1 has expired.",
        },
      ],
    });
  });

  it("blocks repository creation before provider mutation when auth is missing or mismatched", async () => {
    const config = hosting({
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
    let createCalls = 0;
    const baseProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return null;
      },
      async getPermissions() {
        return {
          read: true,
          write: true,
          maintain: true,
          admin: true,
        };
      },
      async createRepository() {
        createCalls += 1;
        return {
          status: "created",
        };
      },
    };

    const missingAuthStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      provider: baseProvider,
    });
    const missingAuthResult = await applyNexusProjectHosting({
      hosting: config,
      status: missingAuthStatus,
      provider: baseProvider,
    });

    expect(missingAuthResult).toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          actionId: "repository:create",
          disposition: "blocked",
          reason:
            "Skipped repository create: host-local auth profile is missing: bot-github.",
        },
      ],
    });

    const wrongActorProvider: NexusProjectHostingProviderAdapter = {
      ...baseProvider,
      async getAuthenticatedAccount() {
        return "mallory";
      },
    };
    const wrongActorStatus = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: wrongActorProvider,
    });
    const wrongActorResult = await applyNexusProjectHosting({
      hosting: config,
      status: wrongActorStatus,
      authProfiles,
      provider: wrongActorProvider,
    });

    expect(wrongActorResult.ok).toBe(false);
    expect(wrongActorResult.actions).toEqual([
      expect.objectContaining({
        actionId: "repository:create",
        disposition: "blocked",
        reason:
          "Skipped repository create: auth profile bot-github is authenticated as mallory; expected example-bot.",
      }),
    ]);
    expect(createCalls).toBe(0);
  });

  it("reports provider repository creation blockers and returned repository mismatches", async () => {
    const config = hosting({
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
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: provider({
        repository: null,
        actors: {
          "bot-github": "example-bot",
        },
      }),
    });
    const blockedProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return null;
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
        return input.authProfile.account ?? null;
      },
      async createRepository() {
        return {
          status: "blocked",
          code: "insufficient_token_scope",
          message:
            "GitHub token lacks repository administration scope for ExampleOrg.",
        };
      },
    };

    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status,
        authProfiles,
        provider: blockedProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      actions: [
        {
          disposition: "blocked",
          providerResult: {
            code: "insufficient_token_scope",
          },
          reason:
            "GitHub token lacks repository administration scope for ExampleOrg.",
        },
      ],
    });

    const mismatchProvider: NexusProjectHostingProviderAdapter = {
      ...blockedProvider,
      async createRepository() {
        return {
          status: "created",
          repository: {
            namespace: "OtherOrg",
            name: "example-suite-meta",
            visibility: "private",
            defaultBranch: "main",
          },
        };
      },
    };

    await expect(
      applyNexusProjectHosting({
        hosting: config,
        status,
        authProfiles,
        provider: mismatchProvider,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "failed",
      actions: [
        {
          disposition: "failed",
          reason:
            "Provider returned repository OtherOrg/example-suite-meta; expected ExampleOrg/example-suite-meta.",
        },
      ],
    });
  });

  it("does not create a repository when status already reports the target exists", async () => {
    const config = hosting({
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
    let createCalls = 0;
    const hostingProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return {
          namespace: "ExampleOrg",
          name: "example-suite-meta",
          visibility: "private",
          defaultBranch: "main",
        };
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
        return input.authProfile.account ?? null;
      },
      async createRepository() {
        createCalls += 1;
        return {
          status: "created",
        };
      },
    };
    const status = await statusNexusProjectHosting({
      project,
      hosting: config,
      authProfiles,
      provider: hostingProvider,
    });

    const result = await applyNexusProjectHosting({
      hosting: config,
      status,
      authProfiles,
      provider: hostingProvider,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "passed",
      actions: [],
      plan: {
        actions: [],
      },
    });
    expect(createCalls).toBe(0);
  });
});
