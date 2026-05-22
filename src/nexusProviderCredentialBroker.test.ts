import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createHostAuthProfileCredentialBroker,
  NexusProviderCredentialBrokerError,
  resolveProviderCredential,
  type NexusProviderCredentialCommandRunner,
} from "./nexusProviderCredentialBroker.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";

function appProfile(
  overrides: Partial<NexusHostingAuthProfileConfig> = {},
): NexusHostingAuthProfileConfig {
  return {
    id: "dev-nexus-app",
    actorId: "dev-nexus-automation-app",
    provider: "github",
    kind: "app",
    credentialKind: "github_app",
    account: "devnexus-automation",
    host: "github.com",
    environmentKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
    ...overrides,
  };
}

describe("provider credential broker", () => {
  it("resolves host-local environment token profiles by provider, actor, and purpose", () => {
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [appProfile()],
      env: {
        GH_TOKEN: "installation-token",
      },
    });

    expect(
      broker.resolveCredential({
        provider: "github",
        host: "https://api.github.com",
        purpose: "api",
        actorId: "dev-nexus-automation-app",
        providerIdentity: "devnexus-automation",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
      }),
    ).toMatchObject({
      provider: "github",
      host: "github.com",
      profileId: "dev-nexus-app",
      actorId: "dev-nexus-automation-app",
      providerIdentity: "devnexus-automation",
      kind: "github_app",
      purposes: ["api", "cli", "git"],
      authorizationHeader: "Bearer installation-token",
      env: {
        GH_TOKEN: "installation-token",
        GITHUB_TOKEN: "installation-token",
      },
      secret: {
        kind: "token",
        value: "installation-token",
      },
    });
  });

  it("selects matching GitHub App profiles by installation account and repository", () => {
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          id: "dev-nexus-app-evref",
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
            repositories: ["DevNexus"],
          },
        }),
        appProfile({
          id: "dev-nexus-app-dogfood",
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Gabot-Darbot",
            repositories: ["dev-nexus-dogfood"],
          },
        }),
      ],
      env: {
        GH_TOKEN: "installation-token",
      },
    });

    expect(
      broker.resolveCredential({
        provider: "github",
        purpose: "git",
        actorId: "dev-nexus-automation-app",
        providerIdentity: "devnexus-automation",
        repository: {
          owner: "Gabot-Darbot",
          name: "dev-nexus-dogfood",
        },
      }),
    ).toMatchObject({
      profileId: "dev-nexus-app-dogfood",
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Gabot-Darbot/dev-nexus-dogfood.git",
      },
      secret: {
        kind: "token",
        value: "installation-token",
      },
    });
  });

  it("resolves command-backed credentials with metadata and conservative expiry checks", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const commandRunner: NexusProviderCredentialCommandRunner = (
      command,
      args,
    ) => {
      calls.push({ command, args });
      return {
        status: 0,
        stdout: JSON.stringify({
          token: "issued-token",
          expiresAt: "2026-05-21T13:00:00.000Z",
          scopes: "repo issues",
          permissions: {
            contents: "write",
            issues: "write",
          },
        }),
        stderr: "",
      };
    };
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          command: "/secrets/github-app-token.mjs",
          commandArgs: ["--repo", "{repository.name}", "--format", "token"],
        }),
      ],
      now: "2026-05-21T12:50:00.000Z",
      commandRunner,
    });

    expect(
      broker.resolveCredential({
        provider: "github",
        purpose: "api",
        profileId: "dev-nexus-app",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
      }),
    ).toMatchObject({
      authorizationHeader: "Bearer issued-token",
      expiresAt: "2026-05-21T13:00:00.000Z",
      scopes: ["repo", "issues"],
      permissions: {
        contents: "write",
        issues: "write",
      },
      env: {
        GH_TOKEN: "issued-token",
        GITHUB_TOKEN: "issued-token",
      },
    });
    expect(calls).toEqual([
      {
        command: "/secrets/github-app-token.mjs",
        args: ["--repo", "DevNexus", "--format", "token"],
      },
    ]);
  });

  it("resolves home-relative command helpers with inline arguments", () => {
    const homePath = path.join("/tmp", "dev-nexus-home");
    const calls: Array<{ command: string; args: string[] }> = [];
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          command:
            "home:secrets/github-apps/devnexus-automation/github-app-token.mjs --repo {repository.name} --format token",
        }),
      ],
      homePath,
      commandRunner: (command, args) => {
        calls.push({ command, args });
        return {
          status: 0,
          stdout: "issued-token",
          stderr: "",
        };
      },
    });

    expect(
      broker.resolveCredential({
        provider: "github",
        purpose: "api",
        profileId: "dev-nexus-app",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
      }),
    ).toMatchObject({
      authorizationHeader: "Bearer issued-token",
    });
    expect(calls).toEqual([
      {
        command: path.join(
          homePath,
          "secrets/github-apps/devnexus-automation/github-app-token.mjs",
        ),
        args: ["--repo", "DevNexus", "--format", "token"],
      },
    ]);
  });

  it("resolves command-backed GitHub App tokens for HTTPS Git transport", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          command: "/secrets/github-app-token.mjs",
          commandArgs: ["--repo", "{repository.name}", "--format", "json"],
        }),
      ],
      commandRunner: (command, args) => {
        calls.push({ command, args });
        return {
          status: 0,
          stdout: JSON.stringify({
            token: "installation-token",
            expiresAt: "2026-05-21T13:00:00.000Z",
            permissions: {
              contents: "write",
            },
          }),
          stderr: "",
        };
      },
      now: "2026-05-21T12:30:00.000Z",
    });

    expect(
      broker.resolveCredential({
        provider: "github",
        purpose: "git",
        profileId: "dev-nexus-app",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
      }),
    ).toMatchObject({
      kind: "github_app",
      authorizationHeader: "Bearer installation-token",
      expiresAt: "2026-05-21T13:00:00.000Z",
      permissions: {
        contents: "write",
      },
      secret: {
        kind: "token",
        value: "installation-token",
      },
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Evref-BL/DevNexus.git",
      },
    });
    expect(calls).toEqual([
      {
        command: "/secrets/github-app-token.mjs",
        args: ["--repo", "DevNexus", "--format", "json"],
      },
    ]);
  });

  it("mints and caches GitHub App installation tokens with repository and permission metadata", async () => {
    const privateKey = testPrivateKey();
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: unknown;
    }> = [];
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          environmentKeys: ["GH_TOKEN"],
          githubApp: {
            appId: "12345",
            slug: "devnexus-automation",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
            repositories: ["DevNexus"],
            tokenRefreshBufferSeconds: 300,
          },
        }),
      ],
      now: "2026-05-21T12:00:00.000Z",
      readFile: (filePath) => {
        expect(filePath).toBe("/secrets/app.private-key.pem");
        return privateKey;
      },
      fetch: queuedFetch(calls, [
        {
          body: [
            {
              id: 987,
              account: { login: "Evref-BL" },
              repository_selection: "selected",
            },
          ],
        },
        {
          status: 201,
          body: {
            token: "installation-token",
            expires_at: "2026-05-21T13:00:00.000Z",
            repository_selection: "selected",
            permissions: {
              contents: "write",
              issues: "write",
            },
            repositories: [{ name: "DevNexus" }],
          },
        },
      ]),
    });

    const request = {
      provider: "github",
      purpose: "api" as const,
      profileId: "dev-nexus-app",
      repository: {
        owner: "Evref-BL",
        name: "DevNexus",
      },
      requiredPermissions: {
        contents: "write",
        issues: "read",
      },
    };
    await expect(resolveProviderCredential(broker, request)).resolves.toMatchObject({
      kind: "github_app",
      authorizationHeader: "Bearer installation-token",
      expiresAt: "2026-05-21T13:00:00.000Z",
      permissions: {
        contents: "write",
        issues: "write",
      },
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Evref-BL/DevNexus.git",
      },
      env: {
        GH_TOKEN: "installation-token",
      },
    });
    await expect(resolveProviderCredential(broker, request)).resolves.toMatchObject({
      secret: {
        kind: "token",
        value: "installation-token",
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: "https://api.github.com/app/installations?per_page=100",
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    expect(calls[0]?.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
    expect(calls[1]).toMatchObject({
      url: "https://api.github.com/app/installations/987/access_tokens",
      method: "POST",
      body: {
        repositories: ["DevNexus"],
      },
    });
  });

  it("surfaces actionable GitHub App credential failures without leaking tokens", async () => {
    const privateKey = testPrivateKey();
    const repositoryBlocked = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
            repositories: ["OtherRepo"],
          },
        }),
      ],
      readFile: () => privateKey,
      fetch: queuedFetch([], []),
    });

    await expectCredentialErrorAsync(
      () =>
        resolveProviderCredential(repositoryBlocked, {
          provider: "github",
          purpose: "api",
          profileId: "dev-nexus-app",
          repository: {
            owner: "Evref-BL",
            name: "DevNexus",
          },
        }),
      "repository_not_selected",
    );

    const missingInstallation = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
          },
        }),
      ],
      readFile: () => privateKey,
      fetch: queuedFetch([], [{ body: [] }]),
    });
    await expectCredentialErrorAsync(
      () =>
        resolveProviderCredential(missingInstallation, {
          provider: "github",
          purpose: "api",
          profileId: "dev-nexus-app",
        }),
      "installation_not_found",
    );

    const missingPermission = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
          },
        }),
      ],
      now: "2026-05-21T12:00:00.000Z",
      readFile: () => privateKey,
      fetch: queuedFetch([], [
        {
          body: [{ id: 987, account: { login: "Evref-BL" } }],
        },
        {
          status: 201,
          body: {
            token: "installation-token",
            expires_at: "2026-05-21T13:00:00.000Z",
            permissions: {
              contents: "read",
            },
          },
        },
      ]),
    });
    await expectCredentialErrorAsync(
      () =>
        resolveProviderCredential(missingPermission, {
          provider: "github",
          purpose: "api",
          profileId: "dev-nexus-app",
          requiredPermissions: {
            contents: "write",
          },
        }),
      "missing_permission",
    );

    const missingKey = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
          },
        }),
      ],
      readFile: () => {
        throw new Error("ENOENT");
      },
      fetch: queuedFetch([], []),
    });
    await expectCredentialErrorAsync(
      () =>
        resolveProviderCredential(missingKey, {
          provider: "github",
          purpose: "api",
          profileId: "dev-nexus-app",
        }),
      "private_key_unavailable",
    );
  });

  it("mints GitHub App installation tokens asynchronously for Git transport", async () => {
    const privateKey = testPrivateKey();
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          githubApp: {
            appId: "12345",
            privateKeyPath: "/secrets/app.private-key.pem",
            installationAccount: "Evref-BL",
            repositories: ["DevNexus"],
          },
        }),
      ],
      readFile: () => privateKey,
      fetch: queuedFetch([], [
        {
          body: [
            {
              id: 987,
              account: { login: "Evref-BL" },
              repository_selection: "selected",
            },
          ],
        },
        {
          status: 201,
          body: {
            token: "installation-token",
            expires_at: "2026-05-21T13:00:00.000Z",
            repository_selection: "selected",
            permissions: {
              contents: "write",
            },
            repositories: [{ name: "DevNexus" }],
          },
        },
      ]),
    });

    expect(() =>
      broker.resolveCredential({
        provider: "github",
        purpose: "git",
        profileId: "dev-nexus-app",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
        requiredPermissions: {
          contents: "write",
        },
      }),
    ).toThrow(NexusProviderCredentialBrokerError);
    await expect(
      resolveProviderCredential(broker, {
        provider: "github",
        purpose: "git",
        profileId: "dev-nexus-app",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
        requiredPermissions: {
          contents: "write",
        },
      }),
    ).resolves.toMatchObject({
      kind: "github_app",
      authorizationHeader: "Bearer installation-token",
      permissions: {
        contents: "write",
      },
      secret: {
        kind: "token",
        value: "installation-token",
      },
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Evref-BL/DevNexus.git",
      },
    });
  });

  it("keeps provider CLI and Git transport compatibility profiles separate from API tokens", () => {
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        {
          id: "human-github",
          provider: "github",
          kind: "human",
          account: "alice",
          host: "github.com",
          sshHost: "github.com-alice",
          githubCliConfigDir: "/home/alice/.config/gh",
        },
      ],
    });

    expect(
      broker.resolveCredential({
        provider: "github",
        purpose: "cli",
        profileId: "human-github",
      }),
    ).toMatchObject({
      kind: "provider_cli",
      env: {
        GH_CONFIG_DIR: "/home/alice/.config/gh",
      },
    });
    expect(
      broker.resolveCredential({
        provider: "github",
        purpose: "git",
        profileId: "human-github",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
      }),
    ).toMatchObject({
      kind: "git_credential",
      gitCredential: {
        protocol: "ssh",
        host: "github.com-alice",
        path: "Evref-BL/DevNexus.git",
      },
    });
  });

  it("fails closed for missing profiles, wrong actors, expired credentials, and unsupported purposes", () => {
    const expiredRunner: NexusProviderCredentialCommandRunner = () => ({
      status: 0,
      stdout: JSON.stringify({
        token: "expired-token",
        expiresAt: "2026-05-21T12:00:00.000Z",
      }),
      stderr: "",
    });
    const broker = createHostAuthProfileCredentialBroker({
      authProfiles: [
        appProfile({
          command: "/secrets/github-app-token.mjs",
        }),
      ],
      now: "2026-05-21T12:30:00.000Z",
      commandRunner: expiredRunner,
    });

    expectCredentialError(
      () => broker.resolveCredential({
        provider: "gitlab",
        purpose: "api",
      }),
      "missing_profile",
    );
    expectCredentialError(
      () => broker.resolveCredential({
        provider: "github",
        purpose: "api",
        profileId: "dev-nexus-app",
        actorId: "other-actor",
      }),
      "wrong_actor",
    );
    expectCredentialError(
      () => broker.resolveCredential({
        provider: "github",
        purpose: "git",
        profileId: "dev-nexus-app",
      }),
      "expired_credential",
    );
    expectCredentialError(
      () =>
        createHostAuthProfileCredentialBroker({
          authProfiles: [
            appProfile({
              purposes: ["api", "cli"],
            }),
          ],
        }).resolveCredential({
          provider: "github",
          purpose: "git",
          profileId: "dev-nexus-app",
        }),
      "unsupported_purpose",
    );
    expectCredentialError(
      () => broker.resolveCredential({
        provider: "github",
        purpose: "api",
        profileId: "dev-nexus-app",
      }),
      "expired_credential",
    );
  });
});

function expectCredentialError(
  action: () => unknown,
  code: NexusProviderCredentialBrokerError["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(NexusProviderCredentialBrokerError);
    expect((error as NexusProviderCredentialBrokerError).code).toBe(code);
    return;
  }

  throw new Error(`Expected credential error ${code}`);
}

async function expectCredentialErrorAsync(
  action: () => Promise<unknown>,
  code: NexusProviderCredentialBrokerError["code"],
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(NexusProviderCredentialBrokerError);
    expect((error as NexusProviderCredentialBrokerError).code).toBe(code);
    return;
  }

  throw new Error(`Expected credential error ${code}`);
}

interface QueuedResponse {
  status?: number;
  body: unknown;
}

function queuedFetch(
  calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  }>,
  responses: QueuedResponse[],
): typeof fetch {
  return (async (input, init = {}) => {
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected GitHub App request: ${String(input)}`);
    }
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body:
        typeof init.body === "string" && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined,
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return privateKey.export({
    type: "pkcs1",
    format: "pem",
  }) as string;
}
