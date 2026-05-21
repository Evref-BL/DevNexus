import { describe, expect, it } from "vitest";
import {
  createHostAuthProfileCredentialBroker,
  NexusProviderCredentialBrokerError,
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
    purposes: ["api", "cli"],
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
      purposes: ["api", "cli"],
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
