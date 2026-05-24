import { describe, expect, it } from "vitest";
import {
  createNexusForgePublicationAdapter,
  NexusForgePublicationError,
  selectNexusForgePublicationBackend,
  type NexusForgePublicationCommandRunner,
} from "../../src/publication/nexusForgePublication.js";
import {
  normalizeNexusPublicationProviderEvidence,
} from "../../src/publication/nexusPublicationProviderEvidence.js";
import type { NexusResolvedProviderCredential } from "../../src/providers/nexusProviderCredentialBroker.js";

describe("nexus forge publication facade", () => {
  it("selects GitHub backends from credentials and fails clearly for unsupported providers", async () => {
    expect(
      selectNexusForgePublicationBackend({
        provider: "github",
        credential: restCredential(),
      }),
    ).toBe("github_rest");
    expect(
      selectNexusForgePublicationBackend({
        provider: "github",
        credential: cliCredential(),
      }),
    ).toBe("github_cli");
    expect(
      selectNexusForgePublicationBackend({
        provider: "gitlab",
      }),
    ).toBe("unsupported");

    const adapter = createNexusForgePublicationAdapter({
      repository: {
        provider: "gitlab",
        owner: "Evref-BL",
        name: "DevNexus",
      },
    });
    await expect(adapter.verifyActor({})).rejects.toMatchObject({
      code: "unsupported_provider",
      metadata: {
        provider: "gitlab",
        capability: "actor.verify",
      },
    });
  });

  it("verifies GitHub App actors from credential metadata without calling /app", async () => {
    const calls: CapturedFetchCall[] = [];
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential({
        kind: "github_app",
      }),
      fetch: queuedFetch(calls, []),
    });

    await expect(
      adapter.verifyActor({
        expected: {
          kind: "app",
          provider: "github",
          handle: "devnexus-automation",
          id: null,
        },
      }),
    ).resolves.toMatchObject({
      matched: true,
      observed: {
        provider: "github",
        handle: "devnexus-automation",
        source: "credential:dev-nexus-app",
        backend: "github_rest",
      },
      metadata: {
        provider: "github",
        backend: "github_rest",
        capability: "actor.verify",
      },
    });
    expect(calls).toEqual([]);
  });

  it("verifies GitHub App user-to-server credentials as user actors", async () => {
    const calls: CapturedFetchCall[] = [];
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential({
        profileId: "gabriel-devnexus-app-user",
        actorId: "gabriel",
        providerIdentity: "Gabriel-Darbord",
        account: "Gabriel-Darbord",
        kind: "github_app_user_token",
        authorizationHeader: "Bearer user-access-token",
      }),
      fetch: queuedFetch(calls, [
        {
          body: {
            login: "Gabriel-Darbord",
          },
        },
      ]),
    });

    await expect(
      adapter.verifyActor({
        expected: {
          kind: "human",
          provider: "github",
          handle: "Gabriel-Darbord",
          id: "gabriel",
        },
      }),
    ).resolves.toMatchObject({
      matched: true,
      observed: {
        provider: "github",
        handle: "Gabriel-Darbord",
        source: "github_rest_user",
        backend: "github_rest",
      },
    });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`))
      .toEqual(["GET /user"]);
  });

  it("reports wrong-user GitHub App user-to-server credentials as mismatched", async () => {
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential({
        profileId: "gabriel-devnexus-app-user",
        actorId: "gabriel",
        providerIdentity: "Gabriel-Darbord",
        account: "Gabriel-Darbord",
        kind: "github_app_user_token",
        authorizationHeader: "Bearer other-user-access-token",
      }),
      fetch: queuedFetch([], [
        {
          body: {
            login: "Other-User",
          },
        },
      ]),
    });

    await expect(
      adapter.verifyActor({
        expected: {
          kind: "human",
          provider: "github",
          handle: "Gabriel-Darbord",
          id: "gabriel",
        },
      }),
    ).resolves.toMatchObject({
      matched: false,
      observed: {
        provider: "github",
        handle: "Other-User",
        source: "github_rest_user",
        backend: "github_rest",
      },
    });
  });

  it("creates, updates, merges, and closes GitHub resources through REST", async () => {
    const calls: CapturedFetchCall[] = [];
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential(),
      fetch: queuedFetch(calls, [
        {
          status: 201,
          body: {
            number: 12,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/12",
            state: "open",
            title: "Feature",
          },
        },
        {
          body: {
            number: 12,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/12",
            state: "open",
            title: "Updated feature",
          },
        },
        {
          body: {
            merged: true,
            sha: "abc123",
            message: "Pull Request successfully merged",
          },
        },
        {
          body: {
            number: 148,
            state: "closed",
            html_url: "https://github.com/Evref-BL/DevNexus/issues/148",
          },
        },
      ]),
    });

    await expect(
      adapter.upsertPullRequest({
        head: "codex/dev-nexus/github-148",
        base: "main",
        title: "Feature",
        body: "Body",
        draft: true,
      }),
    ).resolves.toMatchObject({
      number: 12,
      url: "https://github.com/Evref-BL/DevNexus/pull/12",
      metadata: {
        backend: "github_rest",
      },
    });
    await expect(
      adapter.upsertPullRequest({
        number: 12,
        head: "codex/dev-nexus/github-148",
        base: "main",
        title: "Updated feature",
      }),
    ).resolves.toMatchObject({
      number: 12,
      title: "Updated feature",
    });
    await expect(
      adapter.mergePullRequest({
        number: 12,
        method: "squash",
      }),
    ).resolves.toMatchObject({
      merged: true,
      sha: "abc123",
    });
    await expect(
      adapter.closeIssue({
        number: 148,
        reason: "completed",
      }),
    ).resolves.toMatchObject({
      number: 148,
      state: "closed",
      url: "https://github.com/Evref-BL/DevNexus/issues/148",
    });

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`))
      .toEqual([
        "POST /repos/Evref-BL/DevNexus/pulls",
        "PATCH /repos/Evref-BL/DevNexus/pulls/12",
        "PUT /repos/Evref-BL/DevNexus/pulls/12/merge",
        "PATCH /repos/Evref-BL/DevNexus/issues/148",
      ]);
    expect(calls[0]!.body).toEqual({
      head: "codex/dev-nexus/github-148",
      base: "main",
      title: "Feature",
      body: "Body",
      draft: true,
    });
    expect(calls[2]!.body).toEqual({
      merge_method: "squash",
    });
    expect(calls[3]!.body).toEqual({
      state: "closed",
      state_reason: "completed",
    });
  });

  it("maps GitHub check runs into publication provider evidence", async () => {
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential(),
      fetch: queuedFetch([], [
        {
          body: {
            number: 12,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/12",
            title: "Feature",
            mergeable: true,
            mergeable_state: "behind",
            head: {
              ref: "codex/dev-nexus/github-148",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          },
        },
        {
          body: {
            check_runs: [
              {
                name: "test / ubuntu",
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/checks/1",
                details_url: "https://github.com/details/1",
                started_at: "2026-05-21T12:00:00Z",
                completed_at: "2026-05-21T12:05:00Z",
                check_suite: {
                  app: {
                    name: "GitHub Actions",
                  },
                },
              },
              {
                name: "test / windows",
                status: "in_progress",
                conclusion: null,
              },
            ],
          },
        },
        {
          body: [
            {
              state: "COMMENTED",
              user: {
                login: "reviewer-a",
              },
            },
            {
              state: "APPROVED",
              user: {
                login: "reviewer-a",
              },
            },
          ],
        },
      ]),
    });

    const result = await adapter.inspectPullRequestChecks({
      number: 12,
      requiredChecks: ["test / ubuntu", "test / windows"],
    });
    const [evidence] = normalizeNexusPublicationProviderEvidence([
      result.evidence,
    ]);

    expect(result.metadata).toMatchObject({
      provider: "github",
      backend: "github_rest",
      capability: "pull_request.checks",
    });
    expect(evidence).toMatchObject({
      provider: "github",
      sourceKind: "pull_request",
      headBranch: "codex/dev-nexus/github-148",
      headSha: "abc123",
      targetBranch: "main",
      reviewState: "approved",
      mergeability: "blocked",
      branchPolicy: "pending",
      baseStatus: "behind",
      checks: [
        {
          name: "test / ubuntu",
          status: "success",
          workflowName: "GitHub Actions",
          url: "https://github.com/details/1",
        },
        {
          name: "test / windows",
          status: "pending",
        },
      ],
    });
  });

  it("uses conditional GitHub REST reads for pull request check inspection", async () => {
    const calls: CapturedFetchCall[] = [];
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential(),
      fetch: queuedFetch(calls, [
        {
          headers: { etag: "\"pr-12\"" },
          body: {
            number: 12,
            html_url: "https://github.com/Evref-BL/DevNexus/pull/12",
            title: "Feature",
            head: {
              ref: "codex/dev-nexus/github-148",
              sha: "abc123",
            },
            base: {
              ref: "main",
            },
          },
        },
        {
          headers: { etag: "\"checks-abc123\"" },
          body: {
            check_runs: [],
          },
        },
        {
          headers: { etag: "\"reviews-12\"" },
          body: [],
        },
        { status: 304 },
        { status: 304 },
        { status: 304 },
      ]),
    });

    const first = await adapter.inspectPullRequestChecks({ number: 12 });
    const second = await adapter.inspectPullRequestChecks({ number: 12 });

    expect(second.evidence).toEqual(first.evidence);
    expect(calls[3]?.headers["if-none-match"]).toBe("\"pr-12\"");
    expect(calls[4]?.headers["if-none-match"]).toBe("\"checks-abc123\"");
    expect(calls[5]?.headers["if-none-match"]).toBe("\"reviews-12\"");
  });

  it("routes GitHub operations through the CLI backend when configured", async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      env: NodeJS.ProcessEnv;
    }> = [];
    const runner: NexusForgePublicationCommandRunner = (
      command,
      args,
      options,
    ) => {
      calls.push({ command, args, env: options.env });
      const key = args.join(" ");
      if (key.startsWith("api app ")) {
        return commandResult("devnexus-automation\n");
      }
      if (key.startsWith("pr create ")) {
        return commandResult(
          "https://github.com/Evref-BL/DevNexus/pull/12\n",
        );
      }
      if (key.startsWith("pr checks ")) {
        return commandResult(JSON.stringify([
          {
            name: "test / ubuntu",
            state: "SUCCESS",
            bucket: "pass",
            link: "https://github.com/checks/1",
            workflow: "CI",
          },
        ]));
      }
      if (key.startsWith("pr view ")) {
        return commandResult(JSON.stringify({
          number: 12,
          url: "https://github.com/Evref-BL/DevNexus/pull/12",
          title: "Feature",
          headRefName: "codex/dev-nexus/github-148",
          headRefOid: "abc123",
          baseRefName: "main",
          reviewDecision: "APPROVED",
          mergeStateStatus: "CLEAN",
          isDraft: false,
        }));
      }
      if (key.startsWith("pr merge ")) {
        return commandResult("");
      }
      if (key.startsWith("issue close ")) {
        return commandResult(
          "https://github.com/Evref-BL/DevNexus/issues/148\n",
        );
      }
      return {
        status: 1,
        stdout: "",
        stderr: `unexpected gh command: ${key}`,
      };
    };
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: cliCredential(),
      commandRunner: runner,
      baseEnv: {
        PATH: "/usr/bin",
      },
    });

    await expect(
      adapter.verifyActor({
        expected: {
          kind: "app",
          provider: "github",
          handle: "devnexus-automation",
          id: null,
        },
      }),
    ).resolves.toMatchObject({
      matched: true,
      observed: {
        source: "github_cli_app",
      },
    });
    await expect(
      adapter.upsertPullRequest({
        head: "codex/dev-nexus/github-148",
        base: "main",
        title: "Feature",
        draft: true,
      }),
    ).resolves.toMatchObject({
      number: 12,
      url: "https://github.com/Evref-BL/DevNexus/pull/12",
    });
    await expect(adapter.inspectPullRequestChecks({ number: 12 }))
      .resolves.toMatchObject({
        evidence: {
          checks: [
            {
              name: "test / ubuntu",
              state: "SUCCESS",
              bucket: "pass",
            },
          ],
          reviewState: "APPROVED",
          baseStatus: "current",
        },
      });
    await expect(adapter.mergePullRequest({ number: 12 }))
      .resolves.toMatchObject({
        merged: true,
      });
    await expect(
      adapter.closeIssue({
        number: 148,
        reason: "completed",
      }),
    ).resolves.toMatchObject({
      number: 148,
      state: "closed",
      url: "https://github.com/Evref-BL/DevNexus/issues/148",
    });

    expect(calls.every((call) => call.command === "gh")).toBe(true);
    expect(calls[0]!.env).toMatchObject({
      PATH: "/usr/bin",
      GH_CONFIG_DIR: "/home/alice/.config/gh",
    });
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["api", "app"],
      ["pr", "create"],
      ["pr", "checks"],
      ["pr", "view"],
      ["pr", "merge"],
      ["issue", "close"],
    ]);
    expect(calls[1]!.args).toContain("--draft");
  });

  it("reports provider request failures with capability context", async () => {
    const adapter = createNexusForgePublicationAdapter({
      repository: githubRepository(),
      credential: restCredential({
        kind: "environment_token",
        providerIdentity: "alice",
        account: "alice",
      }),
      fetch: queuedFetch([], [
        {
          status: 403,
          body: {
            message: "Resource not accessible by integration",
          },
        },
      ]),
    });

    await expect(adapter.verifyActor({})).rejects.toMatchObject({
      code: "provider_request_failed",
      metadata: {
        backend: "github_rest",
        capability: "actor.verify",
      },
      message: expect.stringContaining("Resource not accessible"),
    });
  });
});

interface QueuedResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface CapturedFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function githubRepository() {
  return {
    provider: "github",
    host: "github.com",
    owner: "Evref-BL",
    name: "DevNexus",
  };
}

function restCredential(
  overrides: Partial<NexusResolvedProviderCredential> = {},
): NexusResolvedProviderCredential {
  return {
    provider: "github",
    host: "github.com",
    profileId: "dev-nexus-app",
    actorId: "dev-nexus-automation-app",
    providerIdentity: "devnexus-automation",
    account: "devnexus-automation",
    kind: "github_app",
    purposes: ["api", "cli"],
    authorizationHeader: "Bearer installation-token",
    ...overrides,
  };
}

function cliCredential(): NexusResolvedProviderCredential {
  return {
    provider: "github",
    host: "github.com",
    profileId: "human-github",
    actorId: "human",
    providerIdentity: "alice",
    account: "alice",
    kind: "provider_cli",
    purposes: ["cli"],
    env: {
      GH_CONFIG_DIR: "/home/alice/.config/gh",
    },
  };
}

function queuedFetch(
  calls: CapturedFetchCall[],
  responses: QueuedResponse[],
): typeof fetch {
  return (async (input, init) => {
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }
    const headers = Object.fromEntries(
      new Headers(init?.headers).entries(),
    );
    calls.push({
      url: input.toString(),
      method: init?.method ?? "GET",
      headers,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return new Response(
      response.body === undefined ? null : JSON.stringify(response.body),
      {
        status: response.status ?? 200,
        headers: {
          "Content-Type": "application/json",
          ...(response.headers ?? {}),
        },
      },
    );
  }) as typeof fetch;
}

function commandResult(stdout: string) {
  return {
    status: 0,
    stdout,
    stderr: "",
  };
}
