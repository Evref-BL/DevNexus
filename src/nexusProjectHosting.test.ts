import { describe, expect, it } from "vitest";
import {
  deriveNexusProjectHostingRepositoryName,
  expectedNexusProjectHostingRemotes,
  preflightNexusProjectHosting,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingConfig,
  type NexusProjectHostingPermissionSet,
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
    provisioning: {
      allowCreate: false,
    },
    ...overrides,
  };
}

function provider(options: {
  repository?: NexusProjectHostingRepositoryRecord | null;
  permissions?: Record<string, Partial<NexusProjectHostingPermissionSet>>;
}): NexusProjectHostingProviderAdapter {
  return {
    provider: "github",
    async getRepository() {
      return options.repository ?? null;
    },
    async getPermissions(input) {
      return {
        read: false,
        write: false,
        admin: false,
        ...(options.permissions?.[input.remoteName] ?? {}),
      };
    },
  };
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

  it("reports configured actor permission mismatches", async () => {
    const result = await preflightNexusProjectHosting({
      project,
      hosting: hosting({
        provisioning: {
          allowCreate: true,
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
