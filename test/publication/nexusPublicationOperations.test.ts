import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import {
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  inspectNexusPublicationPullRequestForComponent,
  mergeNexusPublicationPullRequestForComponent,
  NexusReviewPolicyEnforcementError,
  pushNexusPublicationBranchForComponent,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  upsertNexusPublicationPullRequestForComponent,
  validateNexusHomeConfigBase,
  writeNexusGitHubAppUserToken,
  type NexusHostingAuthProfileConfig,
  type NexusProjectConfig,
  type NexusPublicationGitPushRunner,
} from "../../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("publication operations", () => {
  it("pushes review branches through the configured App credential without leaking the token into the plan", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const calls: Array<{ args: readonly string[]; cwd: string; token: string | undefined }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        token: options.env.DEV_NEXUS_GIT_TOKEN,
      });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/app-publication-cli",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner,
    });

    expect(result.credential).toMatchObject({
      profileId: "dev-nexus-app-github",
      kind: "github_app",
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Evref-BL/DevNexus.git",
      },
    });
    expect(result.push.plan.transport).toBe("https_token");
    expect(result.push.plan.remote).toBe("https://github.com/Evref-BL/DevNexus.git");
    expect(result.push.plan.refspec).toBe("codex/dev-nexus/app-publication-cli");
    expect(JSON.stringify(result.push.plan)).not.toContain("installation-token");
    expect(calls).toEqual([
      expect.objectContaining({
        cwd: sourceRoot,
        token: "installation-token",
      }),
    ]);
  });

  it("warns when a review branch tracks a non-policy upstream remote", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    initGitRepositoryWithUpstream({
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/app-publication-cli",
      upstreamRemote: "bot",
    });

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/app-publication-cli",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (args) => ({
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      }),
    });

    expect(result.credential.profileId).toBe("dev-nexus-app-github");
    expect(result.push.plan.remote).toBe("https://github.com/Evref-BL/DevNexus.git");
    expect(result.warnings).toEqual([
      "Branch codex/dev-nexus/app-publication-cli tracks remote bot, not configured publication remote app.",
    ]);
  });

  it("pushes feature branches through the configured fallback remote", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(projectRoot, featureFallbackPublicationProjectConfig(homePath));
    const calls: Array<{ args: readonly string[]; token: string | undefined }> = [];

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "feat/codex-goals",
      featureId: "codex-goals",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (args, options) => {
        calls.push({
          args,
          token: options.env.DEV_NEXUS_GIT_TOKEN,
        });
        return {
          args: [...args],
          stdout: "",
          stderr: "Everything up-to-date",
          exitCode: 0,
        };
      },
    });

    expect(result.featureBranchDelivery).toMatchObject({
      featureId: "codex-goals",
      branchPublication: {
        strategy: "fallback_remote",
        selectedRemote: "fork",
      },
    });
    expect(result.push.plan).toMatchObject({
      transport: "configured_remote",
      remote: "fork",
      refspec: "feat/codex-goals",
    });
    expect(calls).toEqual([
      {
        args: ["push", "fork", "feat/codex-goals"],
        token: undefined,
      },
    ]);
  });

  it("selects fallback remotes after push remote dry-run permission denial", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(
      projectRoot,
      featureFallbackPublicationProjectConfig(
        homePath,
        "push_remote_then_fallback",
      ),
    );
    const calls: Array<{ args: readonly string[]; token: string | undefined }> = [];

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "feat/codex-goals",
      featureId: "codex-goals",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (args, options) => {
        calls.push({
          args,
          token: options.env.DEV_NEXUS_GIT_TOKEN,
        });
        if (args.join(" ") === "push --dry-run app feat/codex-goals") {
          return {
            args: [...args],
            stdout: "",
            stderr: "ERROR: permission denied",
            exitCode: 1,
          };
        }
        return {
          args: [...args],
          stdout: "",
          stderr: "Everything up-to-date",
          exitCode: 0,
        };
      },
    });

    expect(result.featureBranchDelivery).toMatchObject({
      branchPublication: {
        strategy: "push_remote_then_fallback",
        selectedRemote: "fork",
      },
      remoteSelection: {
        status: "fallback_selected",
        selectedRemote: "fork",
        probes: [
          {
            remote: "app",
            writable: false,
          },
          {
            remote: "fork",
            writable: true,
          },
        ],
      },
    });
    expect(result.push.plan).toMatchObject({
      transport: "configured_remote",
      remote: "fork",
      refspec: "feat/codex-goals",
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["push", "--dry-run", "app", "feat/codex-goals"],
      ["push", "--dry-run", "fork", "feat/codex-goals"],
      ["push", "fork", "feat/codex-goals"],
    ]);
  });

  it("keeps feature branch pushes on the push remote when the dry-run succeeds", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(
      projectRoot,
      featureFallbackPublicationProjectConfig(
        homePath,
        "push_remote_then_fallback",
      ),
    );
    const calls: Array<{ args: readonly string[]; token: string | undefined }> = [];

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "feat/codex-goals",
      featureId: "codex-goals",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (args, options) => {
        calls.push({
          args,
          token: options.env.DEV_NEXUS_GIT_TOKEN,
        });
        return {
          args: [...args],
          stdout: "",
          stderr: "Everything up-to-date",
          exitCode: 0,
        };
      },
    });

    expect(result.featureBranchDelivery).toMatchObject({
      remoteSelection: {
        status: "push_remote_writable",
        selectedRemote: "app",
        probes: [
          {
            remote: "app",
            writable: true,
          },
        ],
      },
    });
    expect(result.push.plan.transport).toBe("https_token");
    expect(calls[0]!.args).toEqual([
      "push",
      "--dry-run",
      "app",
      "feat/codex-goals",
    ]);
    expect(calls[1]!.args).toContain("push");
    expect(calls[1]!.args).toContain("https://github.com/Evref-BL/DevNexus.git");
    expect(calls[1]!.args).toContain("feat/codex-goals");
  });

  it("blocks feature fallback selection before live push when fallback setup fails", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(
      projectRoot,
      featureFallbackPublicationProjectConfig(
        homePath,
        "push_remote_then_fallback",
      ),
    );

    await expect(
      pushNexusPublicationBranchForComponent({
        projectRoot,
        repositoryPath: sourceRoot,
        branch: "feat/codex-goals",
        featureId: "codex-goals",
        baseEnv: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        gitRunner: (args) => ({
          args: [...args],
          stdout: "",
          stderr: "ERROR: permission denied",
          exitCode: 1,
        }),
      }),
    ).rejects.toThrow(/fix remote fork before publishing the feature branch/u);
  });

  it("reports manual-only feature branch publication as a structured blocker", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(
      projectRoot,
      featureFallbackPublicationProjectConfig(homePath, "manual_only", null),
    );

    await expect(
      pushNexusPublicationBranchForComponent({
        projectRoot,
        repositoryPath: sourceRoot,
        branch: "feat/codex-goals",
        featureId: "codex-goals",
        baseEnv: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        gitRunner: () => {
          throw new Error("git should not run for manual-only publication");
        },
      }),
    ).rejects.toMatchObject({
      remoteSelection: {
        status: "blocked",
        reasons: ["feature branch publication is manual-only"],
      },
    });
  });


  it("pushes review branches through GitHub App user-to-server credentials for human actors", async () => {
    const { projectRoot, sourceRoot } = createHumanUserTokenPublicationProject();
    const calls: Array<{ cwd: string; token: string | undefined }> = [];
    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/human-attributed-auth",
      baseEnv: {
        DEV_NEXUS_TEST_USER_TOKEN: "user-access-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (_args, options) => {
        calls.push({
          cwd: options.cwd,
          token: options.env.DEV_NEXUS_GIT_TOKEN,
        });
        return {
          args: [],
          stdout: "",
          stderr: "Everything up-to-date",
          exitCode: 0,
        };
      },
    });

    expect(result.credential).toMatchObject({
      profileId: "gabriel-devnexus-app-user",
      actorId: "gabriel",
      account: "Gabriel-Darbord",
      kind: "github_app_user_token",
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Evref-BL/DevNexus.git",
      },
    });
    expect(result.push.plan.transport).toBe("https_token");
    expect(JSON.stringify(result.push.plan)).not.toContain("user-access-token");
    expect(calls).toEqual([
      {
        cwd: sourceRoot,
        token: "user-access-token",
      },
    ]);
  });

  it("pushes review branches through stored GitHub App user-to-server credentials", async () => {
    const { projectRoot, homePath, sourceRoot } = createHumanUserTokenPublicationProject();
    writeNexusGitHubAppUserToken({
      homePath,
      profile: publicationUserTokenProfile(),
      token: {
        accessToken: "stored-user-access-token",
        expiresAt: "2099-05-22T18:00:00.000Z",
        refreshToken: "stored-refresh-token",
        refreshTokenExpiresAt: "2099-11-22T10:00:00.000Z",
        login: "Gabriel-Darbord",
      },
      now: () => new Date("2026-05-22T10:00:00.000Z"),
    });
    const calls: Array<{ cwd: string; token: string | undefined }> = [];

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/human-attributed-auth",
      gitRunner: (_args, options) => {
        calls.push({
          cwd: options.cwd,
          token: options.env.DEV_NEXUS_GIT_TOKEN,
        });
        return {
          args: [],
          stdout: "",
          stderr: "Everything up-to-date",
          exitCode: 0,
        };
      },
    });

    expect(result.credential).toMatchObject({
      profileId: "gabriel-devnexus-app-user",
      actorId: "gabriel",
      account: "Gabriel-Darbord",
      kind: "github_app_user_token",
    });
    expect(JSON.stringify(result.push.plan)).not.toContain("stored-user-access-token");
    expect(calls).toEqual([
      {
        cwd: sourceRoot,
        token: "stored-user-access-token",
      },
    ]);
  });

  it("pushes workspace metadata branches through the App when project repository is selected", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const calls: Array<{ args: readonly string[]; cwd: string; token: string | undefined }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        token: options.env.DEV_NEXUS_GIT_TOKEN,
      });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      projectRepository: true,
      repositoryPath: projectRoot,
      branch: "codex/dogfood/code-quality-audit-records",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner,
    });

    expect(result.componentId).toBeNull();
    expect(result.target).toEqual({
      kind: "project",
      id: "publication-project",
      componentId: null,
      projectId: "publication-project",
    });
    expect(result.repository).toMatchObject({
      owner: "Gabot-Darbot",
      name: "dev-nexus-dogfood",
    });
    expect(result.push.plan.remote).toBe(
      "https://github.com/Gabot-Darbot/dev-nexus-dogfood.git",
    );
    expect(JSON.stringify(result.push.plan)).not.toContain("installation-token");
    expect(calls).toEqual([
      expect.objectContaining({
        cwd: projectRoot,
        token: "installation-token",
      }),
    ]);
  });

  it("adds force-with-lease only when the review branch update asks for it", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/app-publication-cli",
      forceWithLease: true,
      forceWithLeaseExpectedCommit: "78aee49bd490cae82e433d76b83e865296022a1c",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (args) => ({
        args: [...args],
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });

    expect(result.forceWithLease).toBe(true);
    expect(result.forceWithLeaseExpectedCommit).toBe(
      "78aee49bd490cae82e433d76b83e865296022a1c",
    );
    expect(result.push.plan.args).toContain(
      "--force-with-lease=refs/heads/codex/dev-nexus/app-publication-cli:78aee49bd490cae82e433d76b83e865296022a1c",
    );
  });

  it("creates pull requests through the forge adapter with App API credentials", async () => {
    const { projectRoot } = createPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          number: 191,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
          state: "open",
          title: "Add App publication commands",
        }),
        { status: 201 },
      );
    };

    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      head: "codex/dev-nexus/app-publication-cli",
      title: "Add App publication commands",
      body: "Use DevNexus App credentials for publication.",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.pullRequest).toMatchObject({
      number: 191,
      url: "https://github.com/Evref-BL/DevNexus/pull/191",
      title: "Add App publication commands",
    });
    expect(requests).toEqual([
      {
        url:
          "https://api.github.com/repos/Evref-BL/DevNexus/pulls?head=Evref-BL%3Acodex%2Fdev-nexus%2Fapp-publication-cli&base=main&state=open&per_page=2",
        method: "GET",
        authorization: "Bearer installation-token",
        body: null,
      },
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls",
        method: "POST",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dev-nexus/app-publication-cli",
          base: "main",
          title: "Add App publication commands",
          body: "Use DevNexus App credentials for publication.",
        },
      },
    ]);
  });

  it("creates pull requests through GitHub App user-to-server API credentials", async () => {
    const { projectRoot } = createHumanUserTokenPublicationProject();
    const requests: Array<{ method: string; authorization: string | null; body: unknown }> = [];
    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      head: "codex/dev-nexus/human-attributed-auth",
      title: "Use human-attributed App credentials",
      body: "Publish with a GitHub App user-to-server token.",
      draft: true,
      baseEnv: {
        DEV_NEXUS_TEST_USER_TOKEN: "user-access-token",
      } as NodeJS.ProcessEnv,
      fetch: (async (_input, init) => {
        const method = init?.method ?? "GET";
        requests.push({
          method,
          authorization: new Headers(init?.headers).get("authorization"),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (method === "GET") {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            number: 214,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/214",
            state: "open",
            title: "Use human-attributed App credentials",
          }),
          { status: 201 },
        );
      }) as typeof fetch,
    });

    expect(result.credential).toMatchObject({
      profileId: "gabriel-devnexus-app-user",
      actorId: "gabriel",
      account: "Gabriel-Darbord",
      kind: "github_app_user_token",
    });
    expect(result.pullRequest).toMatchObject({
      number: 214,
      title: "Use human-attributed App credentials",
    });
    expect(requests).toEqual([
      {
        method: "GET",
        authorization: "Bearer user-access-token",
        body: null,
      },
      {
        method: "POST",
        authorization: "Bearer user-access-token",
        body: {
          head: "codex/dev-nexus/human-attributed-auth",
          base: "main",
          title: "Use human-attributed App credentials",
          body: "Publish with a GitHub App user-to-server token.",
          draft: true,
        },
      },
    ]);
  });

  it("upserts pull requests against the workspace metadata repository when selected", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          number: 31,
          html_url: "https://github.com/Gabot-Darbot/dev-nexus-dogfood/pull/31",
          state: "open",
          title: "Update dogfood publication context",
        }),
        { status: 201 },
      );
    };

    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      projectRepository: true,
      head: "codex/dogfood/code-quality-audit-records",
      title: "Update dogfood publication context",
      body: "Record the current App publication path.",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.componentId).toBeNull();
    expect(result.target.kind).toBe("project");
    expect(result.pullRequest).toMatchObject({
      number: 31,
      url: "https://github.com/Gabot-Darbot/dev-nexus-dogfood/pull/31",
      title: "Update dogfood publication context",
    });
    expect(requests).toEqual([
      {
        url:
          "https://api.github.com/repos/Gabot-Darbot/dev-nexus-dogfood/pulls?head=Gabot-Darbot%3Acodex%2Fdogfood%2Fcode-quality-audit-records&base=main&state=open&per_page=2",
        method: "GET",
        authorization: "Bearer installation-token",
        body: null,
      },
      {
        url: "https://api.github.com/repos/Gabot-Darbot/dev-nexus-dogfood/pulls",
        method: "POST",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dogfood/code-quality-audit-records",
          base: "main",
          title: "Update dogfood publication context",
          body: "Record the current App publication path.",
        },
      },
    ]);
  });

  it("reads pull request evidence through the forge adapter with App API credentials", async () => {
    const { projectRoot } = createPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/pulls/191")) {
        return new Response(
          JSON.stringify({
            number: 191,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
            title: "Add App publication commands",
            mergeable: true,
            mergeable_state: "behind",
            head: {
              ref: "feat/feature-delivery-branchStrategy",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          }),
          { status: 200 },
        );
      }
      if (pathname.endsWith("/commits/abc123/check-runs")) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: "Node 22 check (ubuntu-latest)",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (pathname.endsWith("/pulls/191/reviews")) {
        return new Response(
          JSON.stringify([
            {
              state: "APPROVED",
              user: {
                login: "reviewer-a",
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "unexpected" }), {
        status: 404,
      });
    };

    const result = await inspectNexusPublicationPullRequestForComponent({
      projectRoot,
      number: 191,
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.credential).toMatchObject({
      profileId: "dev-nexus-app-github",
      kind: "github_app",
    });
    expect(result.evidence).toMatchObject({
      provider: "github",
      sourceKind: "pull_request",
      headBranch: "feat/feature-delivery-branchStrategy",
      targetBranch: "main",
      reviewState: "approved",
      baseStatus: "behind",
      mergeability: "blocked",
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          conclusion: "success",
        },
      ],
    });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`))
      .toEqual([
        "GET /repos/Evref-BL/DevNexus/pulls/191",
        "GET /repos/Evref-BL/DevNexus/commits/abc123/check-runs",
        "GET /repos/Evref-BL/DevNexus/pulls/191/reviews",
      ]);
    expect(requests.every((request) =>
      request.authorization === "Bearer installation-token"
    )).toBe(true);
  });

  it("merges pull requests through the forge adapter with App API credentials", async () => {
    const { projectRoot } = createPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          merged: true,
          sha: "merge-commit",
          message: "Pull Request successfully merged",
        }),
        { status: 200 },
      );
    };

    const result = await mergeNexusPublicationPullRequestForComponent({
      projectRoot,
      number: 191,
      method: "squash",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.merge).toMatchObject({
      merged: true,
      sha: "merge-commit",
      message: "Pull Request successfully merged",
    });
    expect(result.pullRequest).toEqual({
      number: 191,
      method: "squash",
    });
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls/191/merge",
        method: "PUT",
        authorization: "Bearer installation-token",
        body: {
          merge_method: "squash",
        },
      },
    ]);
  });

  it("blocks pull request merges when configured review policy is not satisfied", async () => {
    const { projectRoot, homePath } = createPublicationProject();
    saveProjectConfig(projectRoot, publicationProjectConfigWithReview(homePath));
    const requests: Array<{ pathname: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        pathname: url.pathname,
        method: init?.method ?? "GET",
      });
      if (url.pathname.endsWith("/pulls/191")) {
        return new Response(
          JSON.stringify({
            number: 191,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
            title: "Add review policy enforcement",
            mergeable: true,
            mergeable_state: "clean",
            head: {
              ref: "feat/component-review-policy",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          }),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/commits/abc123/check-runs")) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: "Node 24 check (ubuntu-latest)",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/pulls/191/reviews")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "unexpected" }), {
        status: 404,
      });
    };

    await expect(
      mergeNexusPublicationPullRequestForComponent({
        projectRoot,
        number: 191,
        method: "squash",
        baseEnv: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "NexusReviewPolicyEnforcementError",
      decision: {
        status: "blocked",
        requestedAction: "provider.pull_request.merge",
        reviewPlan: {
          status: "review_required",
          transport: "pull_request",
          matchedRuleIndex: 0,
        },
      },
    });
    expect(requests.map((request) => `${request.method} ${request.pathname}`))
      .toEqual([
        "GET /repos/Evref-BL/DevNexus/pulls/191",
        "GET /repos/Evref-BL/DevNexus/commits/abc123/check-runs",
        "GET /repos/Evref-BL/DevNexus/pulls/191/reviews",
      ]);
  });

  it("allows pull request merges after configured provider review gates pass", async () => {
    const { projectRoot, homePath } = createPublicationProject();
    saveProjectConfig(projectRoot, publicationProjectConfigWithReview(homePath));
    const requests: Array<{ pathname: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        pathname: url.pathname,
        method: init?.method ?? "GET",
      });
      if (url.pathname.endsWith("/pulls/191")) {
        return new Response(
          JSON.stringify({
            number: 191,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
            title: "Add review policy enforcement",
            mergeable: true,
            mergeable_state: "clean",
            head: {
              ref: "feat/component-review-policy",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          }),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/commits/abc123/check-runs")) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: "Node 24 check (ubuntu-latest)",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/pulls/191/reviews")) {
        return new Response(
          JSON.stringify([
            {
              state: "APPROVED",
              user: {
                login: "reviewer-a",
              },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/pulls/191/merge")) {
        return new Response(
          JSON.stringify({
            merged: true,
            sha: "merge-commit",
            message: "Pull Request successfully merged",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "unexpected" }), {
        status: 404,
      });
    };

    const result = await mergeNexusPublicationPullRequestForComponent({
      projectRoot,
      number: 191,
      method: "squash",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.reviewEnforcement).toMatchObject({
      status: "allowed",
      requestedAction: "provider.pull_request.merge",
      reviewPlan: {
        status: "ready",
        matchedRuleIndex: 0,
      },
    });
    expect(result.merge.merged).toBe(true);
    expect(requests.map((request) => `${request.method} ${request.pathname}`))
      .toEqual([
        "GET /repos/Evref-BL/DevNexus/pulls/191",
        "GET /repos/Evref-BL/DevNexus/commits/abc123/check-runs",
        "GET /repos/Evref-BL/DevNexus/pulls/191/reviews",
        "PUT /repos/Evref-BL/DevNexus/pulls/191/merge",
      ]);
  });

  it("blocks direct target-branch pushes when green-main policy requires a pull request", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();

    await expect(
      pushNexusPublicationBranchForComponent({
        projectRoot,
        repositoryPath: sourceRoot,
        branch: "codex/dev-nexus/app-publication-cli",
        targetBranch: "main",
        baseEnv: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        gitRunner: () => {
          throw new Error("git should not run");
        },
      }),
    ).rejects.toThrow(/blocks direct pushes to target branch main/u);
  });

  it("blocks direct target-branch pushes when component review policy is unsatisfied", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(projectRoot, publicationProjectConfigWithReview(
      homePath,
      {
        push: true,
        directTargetPush: "allowed",
        review: {
          default: {
            transport: "local",
            gates: ["human_required"],
          },
        },
      },
    ));

    await expect(
      pushNexusPublicationBranchForComponent({
        projectRoot,
        repositoryPath: sourceRoot,
        branch: "main",
        baseEnv: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        gitRunner: () => {
          throw new Error("git should not run");
        },
      }),
    ).rejects.toBeInstanceOf(NexusReviewPolicyEnforcementError);
  });
});

describe("publication CLI operations", () => {
  it("pushes a branch through the configured App credential path", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const stdout = textWriter();
    const calls: Array<{ token: string | undefined }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      calls.push({ token: options.env.DEV_NEXUS_GIT_TOKEN });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const exitCode = await main(
      [
        "publication",
        "branch-push",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "codex/dev-nexus/app-publication-cli",
        "--force-with-lease-expected",
        "78aee49bd490cae82e433d76b83e865296022a1c",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: gitRunner,
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      componentId: "primary",
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
      push: {
        plan: {
          transport: "https_token",
          remote: "https://github.com/Evref-BL/DevNexus.git",
          refspec: "codex/dev-nexus/app-publication-cli",
          forceWithLease: true,
          forceWithLeaseExpectedCommit: "78aee49bd490cae82e433d76b83e865296022a1c",
        },
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(calls).toEqual([{ token: "installation-token" }]);
  });

  it("creates review handoff pull requests through the configured App credential after pushing", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const stdout = textWriter();
    const gitCalls: Array<{ token: string | undefined }> = [];
    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      gitCalls.push({ token: options.env.DEV_NEXUS_GIT_TOKEN });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({
        url,
        method,
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          number: 275,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/275",
          state: "open",
          title: "Fix App review handoff",
        }),
        { status: 201 },
      );
    };

    const exitCode = await main(
      [
        "publication",
        "review-handoff",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "codex/dev-nexus/app-review-handoff",
        "--title",
        "Fix App review handoff",
        "--body",
        "Create the pull request with the same App-backed publication path.",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: gitRunner,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      branchPush: {
        credential: {
          profileId: "dev-nexus-app-github",
          actorId: "dev-nexus-automation-app",
          account: "devnexus-automation",
          kind: "github_app",
        },
      },
      pullRequest: {
        credential: {
          profileId: "dev-nexus-app-github",
          actorId: "dev-nexus-automation-app",
          account: "devnexus-automation",
          kind: "github_app",
        },
        pullRequest: {
          number: 275,
          url: "https://github.com/Evref-BL/DevNexus/pull/275",
        },
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(gitCalls).toEqual([{ token: "installation-token" }]);
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls?head=Evref-BL%3Acodex%2Fdev-nexus%2Fapp-review-handoff&base=main&state=open&per_page=2",
        method: "GET",
        authorization: "Bearer installation-token",
        body: null,
      },
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls",
        method: "POST",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dev-nexus/app-review-handoff",
          base: "main",
          title: "Fix App review handoff",
          body: "Create the pull request with the same App-backed publication path.",
        },
      },
    ]);
  });

  it("reports provider PR handoff failures with App credential context", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async (_input, init) =>
      (init?.method ?? "GET") === "GET"
        ? new Response(JSON.stringify([]), { status: 200 })
        : new Response(JSON.stringify({ message: "Bad credentials" }), {
            status: 401,
            statusText: "Unauthorized",
          });

    const exitCode = await main(
      [
        "publication",
        "review-handoff",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "codex/dev-nexus/app-review-handoff",
        "--title",
        "Fix App review handoff",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: (args) => ({
          args: [...args],
          stdout: "",
          stderr: "Everything up-to-date",
          exitCode: 0,
        }),
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: false,
      branchPush: {
        ok: true,
        credential: {
          profileId: "dev-nexus-app-github",
          kind: "github_app",
        },
      },
      pullRequest: {
        ok: false,
        error: {
          code: "pull_request_upsert_failed",
          providerErrorCode: "provider_request_failed",
          message: expect.stringContaining(
            "POST /repos/Evref-BL/DevNexus/pulls failed: 401 Bad credentials",
          ),
          profileId: "dev-nexus-app-github",
          actorId: "dev-nexus-automation-app",
          account: "devnexus-automation",
          credentialKind: "github_app",
          provider: "github",
          backend: "github_rest",
          capability: "pull_request.upsert",
        },
        setupActions: [
          expect.stringContaining(
            "Fix the pull request provider error for Evref-BL/DevNexus",
          ),
        ],
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("prints selected feature branch-push fallback plans as JSON", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(
      projectRoot,
      featureFallbackPublicationProjectConfig(
        homePath,
        "push_remote_then_fallback",
      ),
    );
    const stdout = textWriter();
    const gitRunner: NexusPublicationGitPushRunner = (args) => {
      if (args.join(" ") === "push --dry-run app feat/codex-goals") {
        return {
          args: [...args],
          stdout: "",
          stderr: "ERROR: permission denied",
          exitCode: 1,
        };
      }
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const exitCode = await main(
      [
        "publication",
        "branch-push",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "feat/codex-goals",
        "--feature",
        "codex-goals",
        "--dry-run",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: gitRunner,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      dryRun: true,
      featureBranchDelivery: {
        branchPublication: {
          strategy: "push_remote_then_fallback",
          selectedRemote: "fork",
        },
        remoteSelection: {
          status: "fallback_selected",
          selectedRemote: "fork",
          reasons: [
            "push remote app rejected a dry-run branch push",
            "fallback remote fork accepted a dry-run branch push",
          ],
        },
      },
      push: {
        plan: {
          transport: "configured_remote",
          remote: "fork",
        },
      },
    });
  });

  it("prints blocked feature branch-push setup actions as JSON", async () => {
    const { projectRoot, homePath, sourceRoot } = createPublicationProject();
    saveProjectConfig(
      projectRoot,
      featureFallbackPublicationProjectConfig(
        homePath,
        "push_remote_then_fallback",
      ),
    );
    const stdout = textWriter();

    const exitCode = await main(
      [
        "publication",
        "branch-push",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "feat/codex-goals",
        "--feature",
        "codex-goals",
        "--dry-run",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: (args) => ({
          args: [...args],
          stdout: "",
          stderr: "ERROR: permission denied",
          exitCode: 1,
        }),
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: false,
      error: {
        code: "feature_branch_publication_blocked",
      },
      featureBranchDelivery: {
        remoteSelection: {
          status: "blocked",
          selectedRemote: null,
          reasons: ["fallback remote fork rejected a dry-run branch push"],
          setupActions: [
            "fix remote fork before publishing the feature branch",
          ],
        },
      },
    });
  });

  it("prints project repository branch-push results through the CLI", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const stdout = textWriter();
    const gitRunner: NexusPublicationGitPushRunner = (args) => ({
      args: [...args],
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const exitCode = await main(
      [
        "publication",
        "branch-push",
        projectRoot,
        "--project-repository",
        "--repository-path",
        projectRoot,
        "--branch",
        "codex/dogfood/code-quality-audit-records",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: gitRunner,
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      componentId: null,
      target: {
        kind: "project",
        id: "publication-project",
      },
      push: {
        plan: {
          remote: "https://github.com/Gabot-Darbot/dev-nexus-dogfood.git",
          refspec: "codex/dogfood/code-quality-audit-records",
        },
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("infers project repository review handoff from a workspace metadata worktree", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const repositoryPath = initProjectRepositoryWorktree(projectRoot, "codex/dogfood/meta");
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async () => {
      throw new Error("dry-run should not call the provider");
    };

    const exitCode = await main(
      [
        "publication",
        "review-handoff",
        projectRoot,
        "--repository-path",
        repositoryPath,
        "--branch",
        "codex/dev-nexus-dogfood/typescript-plugin-refresh",
        "--title",
        "Refresh TypeScript plugin projection",
        "--dry-run",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      branchPush: {
        componentId: null,
        target: {
          kind: "project",
          id: "publication-project",
        },
        repository: {
          owner: "Gabot-Darbot",
          name: "dev-nexus-dogfood",
        },
        push: {
          plan: {
            remote: "https://github.com/Gabot-Darbot/dev-nexus-dogfood.git",
          },
        },
      },
      pullRequest: {
        componentId: null,
        target: {
          kind: "project",
          id: "publication-project",
        },
        repository: {
          owner: "Gabot-Darbot",
          name: "dev-nexus-dogfood",
        },
      },
    });
    expect(stdout.output()).not.toContain("Evref-BL/DevNexus");
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("reports setup actions when project repository PR handoff has only Git push auth", async () => {
    const { projectRoot } = createProjectRepositorySshOnlyPublicationProject();
    const repositoryPath = initProjectRepositoryWorktree(projectRoot, "codex/dogfood/meta");
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async () => {
      throw new Error("missing PR credential should fail before provider calls");
    };

    const exitCode = await main(
      [
        "publication",
        "review-handoff",
        projectRoot,
        "--project-repository",
        "--repository-path",
        repositoryPath,
        "--branch",
        "codex/dogfood/meta",
        "--title",
        "Refresh dogfood metadata",
        "--dry-run",
        "--json",
      ],
      {
        stdout,
        env: {} as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: false,
      branchPush: {
        ok: true,
        componentId: null,
        target: {
          kind: "project",
          id: "publication-project",
        },
        credential: {
          profileId: "dogfood-bot-github",
        },
      },
      pullRequest: {
        ok: false,
        error: {
          code: "pull_request_credential_unavailable",
          credentialCode: "missing_secret",
          profileId: "dogfood-bot-github",
        },
        setupActions: [
          expect.stringContaining("dogfood-bot-github"),
          expect.stringContaining("pull request API operations"),
        ],
      },
    });
  });

  it("rejects publication commands that select a component and the project repository", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const stdout = textWriter();

    await expect(
      main(
        [
          "publication",
          "branch-push",
          projectRoot,
          "--component",
          "dev-nexus",
          "--project-repository",
          "--branch",
          "codex/dogfood/code-quality-audit-records",
        ],
        { stdout },
      ),
    ).rejects.toThrow(
      "publication accepts --component or --project-repository, not both",
    );
  });

  it("upserts pull requests through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          number: 191,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
          state: "open",
          title: "Add App publication commands",
        }),
        { status: 201 },
      );
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "upsert",
        projectRoot,
        "--head",
        "codex/dev-nexus/app-publication-cli",
        "--title",
        "Add App publication commands",
        "--body",
        "Use DevNexus App credentials for publication.",
        "--draft",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      pullRequest: {
        number: 191,
        url: "https://github.com/Evref-BL/DevNexus/pull/191",
      },
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(requests).toEqual([
      {
        url:
          "https://api.github.com/repos/Evref-BL/DevNexus/pulls?head=Evref-BL%3Acodex%2Fdev-nexus%2Fapp-publication-cli&base=main&state=open&per_page=2",
        method: "GET",
        authorization: "Bearer installation-token",
        body: null,
      },
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls",
        method: "POST",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dev-nexus/app-publication-cli",
          base: "main",
          title: "Add App publication commands",
          body: "Use DevNexus App credentials for publication.",
          draft: true,
        },
      },
    ]);
  });

  it("updates an existing same-head pull request through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify([
            {
              number: 191,
              html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
              state: "open",
              title: "Existing title",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          number: 191,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
          state: "open",
          title: "Updated title",
        }),
        { status: 200 },
      );
    };

    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      head: "codex/dev-nexus/app-publication-cli",
      title: "Updated title",
      body: "Updated body.",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.plan).toMatchObject({
      operation: "update",
      number: 191,
      head: "codex/dev-nexus/app-publication-cli",
      base: "main",
    });
    expect(result.pullRequest).toMatchObject({
      number: 191,
      title: "Updated title",
      operation: "update",
    });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`))
      .toEqual([
        "GET /repos/Evref-BL/DevNexus/pulls",
        "PATCH /repos/Evref-BL/DevNexus/pulls/191",
      ]);
    expect(new URL(requests[0]!.url).searchParams.get("head"))
      .toBe("Evref-BL:codex/dev-nexus/app-publication-cli");
    expect(requests[1]!.body).toMatchObject({
      title: "Updated title",
      body: "Updated body.",
    });
  });

  it("dry-runs pull request upserts through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async () => {
      throw new Error("dry-run should not call the provider");
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "upsert",
        projectRoot,
        "--head",
        "codex/dev-nexus/app-publication-cli",
        "--title",
        "Add App publication commands",
        "--body",
        "Use DevNexus App credentials for publication.",
        "--dry-run",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      dryRun: true,
      pullRequest: null,
      plan: {
        operation: "upsert",
        head: "codex/dev-nexus/app-publication-cli",
        base: "main",
        title: "Add App publication commands",
        bodyProvided: true,
        draft: false,
      },
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("dry-runs component pull request upserts with App credentials in a dogfood-shaped workspace", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();

    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      componentId: "dev-nexus",
      head: "codex/dev-nexus/app-publication-cli",
      title: "Add App publication commands",
      dryRun: true,
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: async () => {
        throw new Error("dry-run should not call the provider");
      },
    });

    expect(result.dryRun).toBe(true);
    expect(result.repository).toMatchObject({
      owner: "Evref-BL",
      name: "DevNexus",
    });
    expect(result.credential).toMatchObject({
      profileId: "dev-nexus-app-github",
      actorId: "dev-nexus-automation-app",
      account: "devnexus-automation",
      kind: "github_app",
    });
    expect(result.plan).toMatchObject({
      operation: "upsert",
      head: "codex/dev-nexus/app-publication-cli",
      base: "main",
    });
    expect(result.pullRequest).toBeNull();
  });

  it("dry-runs review handoff through configured branch push and pull request planning", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async () => {
      throw new Error("dry-run should not call the provider");
    };

    const exitCode = await main(
      [
        "publication",
        "review-handoff",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "codex/dev-nexus/app-publication-cli",
        "--title",
        "Add App publication commands",
        "--body",
        "Use DevNexus App credentials for publication.",
        "--dry-run",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      dryRun: true,
      branchPush: {
        dryRun: true,
        credential: {
          profileId: "dev-nexus-app-github",
        },
        push: {
          plan: {
            remote: "https://github.com/Evref-BL/DevNexus.git",
            refspec: "codex/dev-nexus/app-publication-cli",
          },
        },
      },
      pullRequest: {
        dryRun: true,
        plan: {
          operation: "upsert",
          head: "codex/dev-nexus/app-publication-cli",
          base: "main",
        },
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("normalizes escaped line breaks in inline pull request bodies", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const escapedLineBreak = `${String.fromCharCode(92)}n`;
    const requests: Array<{ method: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          number: 191,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
          state: "open",
          title: "Add App publication commands",
        }),
        { status: 201 },
      );
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "upsert",
        projectRoot,
        "--head",
        "codex/dev-nexus/app-publication-cli",
        "--title",
        "Add App publication commands",
        "--body",
        ["Summary.", "", "Verification."].join(escapedLineBreak),
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        method: "GET",
        body: null,
      },
      {
        method: "POST",
        body: expect.objectContaining({
          body: ["Summary.", "", "Verification."].join(String.fromCharCode(10)),
        }),
      },
    ]);
  });

  it("prints pull request evidence through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/pulls/191")) {
        return new Response(
          JSON.stringify({
            number: 191,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
            title: "Add App publication commands",
            mergeable: true,
            mergeable_state: "clean",
            head: {
              ref: "feat/feature-delivery-branchStrategy",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          }),
          { status: 200 },
        );
      }
      if (pathname.endsWith("/commits/abc123/check-runs")) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: "Node 22 check (ubuntu-latest)",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (pathname.endsWith("/pulls/191/reviews")) {
        return new Response(
          JSON.stringify([
            {
              state: "APPROVED",
              user: {
                login: "reviewer-a",
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "unexpected" }), {
        status: 404,
      });
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "evidence",
        projectRoot,
        "--number",
        "191",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      pullRequest: {
        number: 191,
      },
      evidence: {
        provider: "github",
        reviewState: "approved",
        baseStatus: "current",
        mergeability: "mergeable",
      },
      providerEvidence: [
        {
          sourceKind: "pull_request",
          headBranch: "feat/feature-delivery-branchStrategy",
        },
      ],
    });
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("merges pull requests through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const requests: Array<{ authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          merged: true,
          sha: "merge-commit",
          message: "Pull Request successfully merged",
        }),
        { status: 200 },
      );
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "merge",
        projectRoot,
        "--number",
        "191",
        "--method",
        "rebase",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      pullRequest: {
        number: 191,
        method: "rebase",
      },
      merge: {
        merged: true,
        sha: "merge-commit",
      },
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(requests).toEqual([
      {
        authorization: "Bearer installation-token",
        body: {
          merge_method: "rebase",
        },
      },
    ]);
  });

  it("prints review policy merge blockers as structured JSON", async () => {
    const { projectRoot, homePath } = createPublicationProject();
    saveProjectConfig(projectRoot, publicationProjectConfigWithReview(homePath));
    const stdout = textWriter();
    const fetchImpl: typeof fetch = async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/pulls/191")) {
        return new Response(
          JSON.stringify({
            number: 191,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
            title: "Add review policy enforcement",
            mergeable: true,
            mergeable_state: "clean",
            head: {
              ref: "feat/component-review-policy",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          }),
          { status: 200 },
        );
      }
      if (pathname.endsWith("/commits/abc123/check-runs")) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: "Node 24 check (ubuntu-latest)",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (pathname.endsWith("/pulls/191/reviews")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "unexpected" }), {
        status: 404,
      });
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "merge",
        projectRoot,
        "--number",
        "191",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: false,
      error: {
        code: "review_policy_blocked",
      },
      reviewEnforcement: {
        status: "blocked",
        requestedAction: "provider.pull_request.merge",
      },
      reviewPlan: {
        status: "review_required",
        transport: "pull_request",
      },
    });
  });
});

function createPublicationProject(): { projectRoot: string; homePath: string; sourceRoot: string } {
  const projectRoot = makeTempDir("dev-nexus-publication-ops-");
  const homePath = path.join(projectRoot, "home");
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  savePublicationHomeConfig(homePath);
  saveProjectConfig(projectRoot, publicationProjectConfig(homePath));
  return { projectRoot, homePath, sourceRoot };
}

function createHumanUserTokenPublicationProject(): {
  projectRoot: string;
  homePath: string;
  sourceRoot: string;
} {
  const projectRoot = makeTempDir("dev-nexus-publication-user-token-");
  const homePath = path.join(projectRoot, "home");
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  savePublicationHomeConfig(homePath);
  saveProjectConfig(projectRoot, {
    ...publicationProjectConfig(homePath),
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        remote: "app",
        targetBranch: "main",
        push: false,
        actor: {
          kind: "human",
          provider: "github",
          handle: "Gabriel-Darbord",
          id: "gabriel",
        },
      },
    },
  });
  return { projectRoot, homePath, sourceRoot };
}

function createMultiComponentPublicationProject(): {
  projectRoot: string;
  homePath: string;
  sourceRoot: string;
} {
  const projectRoot = makeTempDir("dev-nexus-publication-multi-");
  const homePath = path.join(projectRoot, "home");
  const sourceRoot = path.join(projectRoot, "sources", "dev-nexus");
  fs.mkdirSync(sourceRoot, { recursive: true });
  savePublicationHomeConfig(homePath);
  saveProjectConfig(projectRoot, {
    ...publicationProjectConfig(homePath),
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:Gabot-Darbot/dev-nexus-dogfood.git",
      defaultBranch: "main",
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
        defaultBranch: "main",
        sourceRoot: "sources/dev-nexus",
        workTracking: {
          provider: "github",
          repository: {
            owner: "Evref-BL",
            name: "DevNexus",
          },
        },
        relationships: [],
      },
    ],
  });
  return { projectRoot, homePath, sourceRoot };
}

function createProjectRepositorySshOnlyPublicationProject(): {
  projectRoot: string;
  homePath: string;
} {
  const projectRoot = makeTempDir("dev-nexus-publication-project-ssh-only-");
  const homePath = path.join(projectRoot, "home");
  saveNexusHomeConfigFile(
    homePath,
    {
      version: 1,
      paths: {
        projectsRoot: path.join(homePath, "projects"),
        workspacesRoot: path.join(homePath, "workspaces"),
      },
      authProfiles: [
        {
          id: "dogfood-bot-github",
          actorId: "dogfood-gabot-automation-bot",
          provider: "github",
          kind: "automation",
          account: "Gabot-Darbot",
          host: "github.com",
          sshHost: "github.com-bot",
          purposes: ["api", "git", "cli"],
          gitUserName: "Gabot-Darbot",
          gitUserEmail: "285409735+Gabot-Darbot@users.noreply.github.com",
        },
      ],
      projects: [],
    },
    validateNexusHomeConfigBase,
  );
  saveProjectConfig(projectRoot, {
    ...publicationProjectConfig(homePath),
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:Gabot-Darbot/dev-nexus-dogfood.git",
      defaultBranch: "main",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "direct_integration",
        remote: "bot",
        targetBranch: "main",
        push: true,
        sshHostAlias: "github.com-bot",
        actor: {
          kind: "machine_user",
          provider: "github",
          handle: "Gabot-Darbot",
          id: "dogfood-gabot-automation-bot",
        },
        gitIdentity: {
          name: "Gabot-Darbot",
          email: "285409735+Gabot-Darbot@users.noreply.github.com",
        },
      },
    },
    hosting: {
      provider: "github",
      namespace: "Gabot-Darbot",
      repository: {
        name: "dev-nexus-dogfood",
        visibility: "private",
        defaultBranch: "main",
      },
      authProfile: "dogfood-bot-github",
      remotes: [
        {
          name: "bot",
          role: "automation",
          protocol: "ssh",
          authProfile: "dogfood-bot-github",
        },
      ],
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
        defaultBranch: "main",
        sourceRoot: "sources/dev-nexus",
        workTracking: {
          provider: "github",
          repository: {
            owner: "Evref-BL",
            name: "DevNexus",
          },
        },
        relationships: [],
      },
    ],
  });
  return { projectRoot, homePath };
}

function savePublicationHomeConfig(homePath: string): void {
  saveNexusHomeConfigFile(
    homePath,
    {
      version: 1,
      paths: {
        projectsRoot: path.join(homePath, "projects"),
        workspacesRoot: path.join(homePath, "workspaces"),
      },
      authProfiles: [
        {
          id: "dev-nexus-app-github",
          actorId: "dev-nexus-automation-app",
          provider: "github",
          kind: "app",
          credentialKind: "github_app",
          account: "devnexus-automation",
          host: "github.com",
          purposes: ["api", "git"],
          environmentKeys: ["DEV_NEXUS_TEST_APP_TOKEN"],
        },
        publicationUserTokenProfile(),
      ],
      projects: [],
    },
    validateNexusHomeConfigBase,
  );
}

function publicationProjectConfig(homePath: string): NexusProjectConfig {
  return {
    version: 1,
    id: "publication-project",
    name: "Publication Project",
    home: homePath,
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "github",
      repository: {
        owner: "Evref-BL",
        name: "DevNexus",
      },
    },
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        remote: "app",
        targetBranch: "main",
        push: false,
        actor: {
          kind: "app",
          provider: "github",
          handle: "devnexus-automation",
          id: "dev-nexus-automation-app",
        },
      },
    },
  };
}

function publicationProjectConfigWithReview(
  homePath: string,
  options: {
    push?: boolean;
    directTargetPush?: "allowed" | "blocked";
    review?: NonNullable<NexusProjectConfig["components"]>[number]["review"];
  } = {},
): NexusProjectConfig {
  const base = publicationProjectConfig(homePath);
  return {
    ...base,
    automation: {
      ...base.automation,
      publication: {
        ...base.automation!.publication,
        push: options.push ?? base.automation!.publication.push,
        greenMain: {
          ...(base.automation!.publication.greenMain ?? {}),
          ...(options.directTargetPush
            ? { directTargetPush: options.directTargetPush }
            : {}),
        },
      },
    },
    components: [
      {
        id: "primary",
        name: "Publication Project",
        kind: "git",
        role: "primary",
        remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
        defaultBranch: "main",
        sourceRoot: "source",
        workTracking: {
          provider: "github",
          repository: {
            owner: "Evref-BL",
            name: "DevNexus",
          },
        },
        review: options.review ?? {
          default: {
            transport: "local",
            gates: ["human_required"],
          },
          rules: [
            {
              match: {
                branchRole: "feature_finalization",
              },
              transport: "pull_request",
              gates: ["provider_approval_required", "ci_required"],
            },
          ],
        },
        relationships: [],
      },
    ],
  };
}

function featureFallbackPublicationProjectConfig(
  homePath: string,
  strategy:
    | "fallback_remote"
    | "manual_only"
    | "push_remote_then_fallback" = "fallback_remote",
  fallbackRemote: string | null = "fork",
): NexusProjectConfig {
  return {
    ...publicationProjectConfig(homePath),
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        remote: "app",
        targetBranch: "main",
        push: false,
        actor: {
          kind: "app",
          provider: "github",
          handle: "devnexus-automation",
          id: "dev-nexus-automation-app",
        },
        releaseTrain: {
          enabled: true,
          activeVersionId: null,
          branchNaming: {
            integrationPrefix: "integration",
            candidatePrefix: "candidate",
            unscopedName: "manual",
          },
          featureBranchDelivery: {
            ...defaultNexusFeatureBranchDeliveryConfig,
            enabled: true,
            activeFeatureId: "codex-goals",
            defaultBranchStrategy: "hybrid",
            branchPublication: {
              strategy,
              fallbackRemote,
            },
          },
          selector: {
            statuses: ["ready"],
            labels: [],
            milestones: [],
            assignees: [],
            providerQuery: null,
          },
        },
      },
    },
  };
}

function publicationUserTokenProfile(): NexusHostingAuthProfileConfig {
  return {
    id: "gabriel-devnexus-app-user",
    actorId: "gabriel",
    provider: "github",
    kind: "human",
    credentialKind: "github_app_user_token",
    account: "Gabriel-Darbord",
    host: "github.com",
    purposes: ["api", "git"],
    environmentKeys: ["DEV_NEXUS_TEST_USER_TOKEN"],
    githubApp: {
      clientId: "Iv23client",
      slug: "devnexus-automation",
      installationAccount: "Evref-BL",
      repositories: ["DevNexus"],
    },
  };
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function initGitRepositoryWithUpstream(options: {
  repositoryPath: string;
  branch: string;
  upstreamRemote: string;
}): void {
  runGit(options.repositoryPath, ["init"]);
  runGit(options.repositoryPath, ["checkout", "--orphan", options.branch]);
  fs.writeFileSync(path.join(options.repositoryPath, "README.md"), "test\n", "utf8");
  runGit(options.repositoryPath, ["add", "README.md"]);
  runGit(options.repositoryPath, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "Initial commit",
  ]);
  runGit(options.repositoryPath, [
    "remote",
    "add",
    options.upstreamRemote,
    "git@github.com:Gabot-Darbot/DevNexus.git",
  ]);
  runGit(options.repositoryPath, [
    "config",
    `branch.${options.branch}.remote`,
    options.upstreamRemote,
  ]);
  runGit(options.repositoryPath, [
    "config",
    `branch.${options.branch}.merge`,
    `refs/heads/${options.branch}`,
  ]);
}

function initProjectRepositoryWorktree(projectRoot: string, branch: string): string {
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["checkout", "-b", "main"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "test\n", "utf8");
  runGit(projectRoot, ["add", "README.md"]);
  runGit(projectRoot, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "Initial commit",
  ]);
  const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus-dogfood", "meta");
  runGit(projectRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  return worktreePath;
}

function runGit(repositoryPath: string, args: string[]): void {
  const command = spawnSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
  });
  if (command.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${command.stderr}`);
  }
}

function textWriter(): { write(chunk: string): boolean; output(): string } {
  let output = "";
  return {
    write(chunk: string): boolean {
      output += chunk;
      return true;
    },
    output: () => output,
  };
}
