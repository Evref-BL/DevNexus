import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteNexusGitHubAppUserToken,
  nexusGitHubAppUserTokenStatus,
  readNexusGitHubAppUserToken,
  runNexusGitHubAppUserDeviceLogin,
  type NexusGitHubAppUserAuthFetch,
} from "../../src/git/nexusGitHubAppUserAuth.js";
import type { NexusHostingAuthProfileConfig } from "../../src/project/nexusProjectHosting.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function userProfile(
  overrides: Partial<NexusHostingAuthProfileConfig> = {},
): NexusHostingAuthProfileConfig {
  return {
    id: "gabriel-devnexus-app-user",
    actorId: "gabriel",
    provider: "github",
    kind: "human",
    credentialKind: "github_app_user_token",
    account: "Gabriel-Darbord",
    host: "github.com",
    purposes: ["api", "git"],
    githubApp: {
      clientId: "Iv23client",
      slug: "devnexus-automation",
      installationAccount: "Evref-BL",
      repositories: ["DevNexus"],
    },
    ...overrides,
  };
}

describe("GitHub App user auth", () => {
  it("runs the device flow, validates the GitHub login, and stores tokens in the host-local home", async () => {
    const homePath = makeTempDir("dev-nexus-home-");
    const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetchImpl: NexusGitHubAppUserAuthFetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? "GET",
        authorization: new Headers(init.headers).get("authorization"),
      });
      if (url === "https://github.com/login/device/code") {
        return jsonResponse({
          device_code: "device-code",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return jsonResponse({
          access_token: "ghu_access",
          expires_in: 28800,
          refresh_token: "ghr_refresh",
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        });
      }
      if (url === "https://api.github.com/user") {
        return jsonResponse({
          login: "Gabriel-Darbord",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await runNexusGitHubAppUserDeviceLogin({
      homePath,
      profile: userProfile(),
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      fetch: fetchImpl,
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({
      profileId: "gabriel-devnexus-app-user",
      login: "Gabriel-Darbord",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      status: {
        state: "authorized",
      },
    });
    expect(readNexusGitHubAppUserToken({ homePath, profileId: userProfile().id })).toMatchObject({
      accessToken: "ghu_access",
      refreshToken: "ghr_refresh",
      expiresAt: "2026-05-22T18:00:00.000Z",
      refreshTokenExpiresAt: "2026-11-22T10:00:00.000Z",
      login: "Gabriel-Darbord",
    });
    expect(calls).toEqual([
      {
        url: "https://github.com/login/device/code",
        method: "POST",
        authorization: null,
      },
      {
        url: "https://github.com/login/oauth/access_token",
        method: "POST",
        authorization: null,
      },
      {
        url: "https://api.github.com/user",
        method: "GET",
        authorization: "Bearer ghu_access",
      },
    ]);
  });

  it("reports token status and removes the stored token on logout", () => {
    const homePath = makeTempDir("dev-nexus-home-");

    expect(
      nexusGitHubAppUserTokenStatus({
        homePath,
        profile: userProfile(),
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      }),
    ).toMatchObject({
      state: "missing",
    });

    fs.mkdirSync(path.dirname(tokenPath(homePath)), { recursive: true });
    fs.writeFileSync(
      tokenPath(homePath),
      JSON.stringify(
        {
          version: 1,
          provider: "github",
          host: "github.com",
          profileId: "gabriel-devnexus-app-user",
          clientId: "Iv23client",
          accessToken: "ghu_access",
          expiresAt: "2026-05-22T18:00:00.000Z",
          refreshToken: "ghr_refresh",
          refreshTokenExpiresAt: "2026-11-22T10:00:00.000Z",
          login: "Gabriel-Darbord",
          tokenType: "bearer",
          updatedAt: "2026-05-22T10:00:00.000Z",
        },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );

    expect(
      nexusGitHubAppUserTokenStatus({
        homePath,
        profile: userProfile(),
        now: () => new Date("2026-05-22T11:00:00.000Z"),
      }),
    ).toMatchObject({
      state: "authorized",
      login: "Gabriel-Darbord",
      expiresAt: "2026-05-22T18:00:00.000Z",
    });
    expect(deleteNexusGitHubAppUserToken({ homePath, profileId: userProfile().id })).toBe(true);
    expect(deleteNexusGitHubAppUserToken({ homePath, profileId: userProfile().id })).toBe(false);
    expect(
      nexusGitHubAppUserTokenStatus({
        homePath,
        profile: userProfile(),
        now: () => new Date("2026-05-22T11:00:00.000Z"),
      }),
    ).toMatchObject({
      state: "missing",
    });
  });
});

function tokenPath(homePath: string): string {
  return path.join(
    homePath,
    "auth",
    "github-app-user-tokens",
    "gabriel-devnexus-app-user.json",
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
