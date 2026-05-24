import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHostAuthProfileCredentialBroker,
  type NexusProviderCredentialBroker,
  type NexusProviderCredentialRequest,
} from "../../src/providers/nexusProviderCredentialBroker.js";
import {
  assertWorkTrackerCapability,
  createWorkTrackerProvider,
  createWorkTrackerProviderAsync,
  workTrackerCapabilityReportForConfig,
  workTrackerCapabilitiesForConfig,
} from "../../src/work-items/workTrackingProviderService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("work tracking provider service", () => {
  it("creates the local provider from generic config", async () => {
    const projectRoot = makeTempDir("dev-nexus-provider-");
    const provider = createWorkTrackerProvider(
      {
        provider: "local",
      },
      {
        projectRoot,
        now: () => "2026-05-15T10:00:00.000Z",
      },
    );

    await expect(
      provider.createWorkItem({ title: "Local core item" }),
    ).resolves.toMatchObject({
      id: "local-1",
      title: "Local core item",
      createdAt: "2026-05-15T10:00:00.000Z",
    });
  });

  it("creates forge providers without specialization workspace config", () => {
    expect(
      createWorkTrackerProvider({
        provider: "github",
        repository: { owner: "owner", name: "repo" },
      }).capabilities.createItem,
    ).toBe(true);
    expect(
      createWorkTrackerProvider({
        provider: "gitlab",
        repository: { id: "group/project" },
      }).capabilities.createItem,
    ).toBe(true);
    expect(
      createWorkTrackerProvider({
        provider: "jira",
        host: "https://example.atlassian.net",
        projectKey: "NEX",
      }).capabilities.createItem,
    ).toBe(true);
  });

  it("can route provider credentials through a broker before creating a GitHub provider", async () => {
    const calls: Array<{
      url: string;
      headers: Record<string, string>;
    }> = [];
    const provider = createWorkTrackerProvider(
      {
        provider: "github",
        repository: { owner: "owner", name: "repo" },
      },
      {
        credentials: {
          broker: createHostAuthProfileCredentialBroker({
            authProfiles: [
              {
                id: "dev-nexus-app",
                actorId: "dev-nexus-automation-app",
                provider: "github",
                kind: "app",
                credentialKind: "github_app",
                account: "devnexus-automation",
                host: "github.com",
                environmentKeys: ["GH_TOKEN"],
                purposes: ["api", "cli"],
              },
            ],
            env: {
              GH_TOKEN: "broker-token",
            },
          }),
          actorId: "dev-nexus-automation-app",
          providerIdentity: "devnexus-automation",
        },
        github: {
          credentialRunner: false,
          fetch: (async (input, init = {}) => {
            calls.push({
              url: String(input),
              headers: init.headers as Record<string, string>,
            });
            return new Response(
              JSON.stringify({
                id: 1,
                number: 7,
                title: "Credentialed issue",
                state: "open",
                labels: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }) as typeof fetch,
        },
      },
    );

    await expect(provider.getWorkItem({ id: "github-7" })).resolves.toMatchObject({
      id: "github-7",
      title: "Credentialed issue",
    });
    expect(calls).toMatchObject([
      {
        url: "https://api.github.com/repos/owner/repo/issues/7",
        headers: {
          Authorization: "Bearer broker-token",
        },
      },
    ]);
  });

  it("routes GitHub App user-to-server credentials through GitHub work tracking writes", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    const provider = createWorkTrackerProvider(
      {
        provider: "github",
        repository: { owner: "Evref-BL", name: "DevNexus" },
      },
      {
        credentials: {
          broker: createHostAuthProfileCredentialBroker({
            authProfiles: [
              {
                id: "gabriel-devnexus-app-user",
                actorId: "gabriel",
                provider: "github",
                kind: "human",
                credentialKind: "github_app_user_token",
                account: "Gabriel-Darbord",
                host: "github.com",
                environmentKeys: ["GH_USER_TOKEN"],
                purposes: ["api"],
              },
            ],
            env: {
              GH_USER_TOKEN: "user-access-token",
            },
          }),
          profileId: "gabriel-devnexus-app-user",
          actorId: "gabriel",
          providerIdentity: "Gabriel-Darbord",
          requiredPermissions: {
            issues: "write",
          },
        },
        github: {
          credentialRunner: false,
          fetch: (async (input, init = {}) => {
            calls.push({
              url: String(input),
              method: init.method ?? "GET",
              headers: init.headers as Record<string, string>,
              body: init.body ? JSON.parse(String(init.body)) : null,
            });
            return new Response(
              JSON.stringify({
                id: 2,
                number: 12,
                title: "Human attributed issue",
                state: "open",
                labels: [],
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              },
            );
          }) as typeof fetch,
        },
      },
    );

    await expect(
      provider.createWorkItem({ title: "Human attributed issue" }),
    ).resolves.toMatchObject({
      id: "github-12",
      title: "Human attributed issue",
    });
    expect(calls).toEqual([
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/issues",
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer user-access-token",
        }),
        body: {
          title: "Human attributed issue",
        },
      },
    ]);
  });

  it("resolves async broker credentials before creating a GitHub provider", async () => {
    const credentialRequests: NexusProviderCredentialRequest[] = [];
    const calls: Array<{
      url: string;
      headers: Record<string, string>;
    }> = [];
    const broker: NexusProviderCredentialBroker = {
      resolveCredential: () => {
        throw new Error("sync credential path should not run");
      },
      resolveCredentialAsync: async (request) => {
        credentialRequests.push(request);
        return {
          provider: request.provider,
          host: request.host ?? null,
          profileId: "dev-nexus-app",
          actorId: request.actorId ?? null,
          providerIdentity: request.providerIdentity ?? null,
          account: "devnexus-automation",
          kind: "github_app",
          purposes: ["api"],
          permissions: { issues: "write" },
          authorizationHeader: "Bearer app-token",
          env: { GH_TOKEN: "app-token" },
          secret: { kind: "token", value: "app-token" },
        };
      },
    };

    const provider = await createWorkTrackerProviderAsync(
      {
        provider: "github",
        repository: { owner: "owner", name: "repo" },
      },
      {
        credentials: {
          broker,
          actorId: "dev-nexus-automation-app",
          providerIdentity: "devnexus-automation",
          requiredPermissions: { issues: "write" },
        },
        github: {
          credentialRunner: false,
          fetch: (async (input, init = {}) => {
            calls.push({
              url: String(input),
              headers: init.headers as Record<string, string>,
            });
            return new Response(
              JSON.stringify({
                id: 1,
                number: 7,
                title: "Credentialed issue",
                state: "open",
                labels: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }) as typeof fetch,
        },
      },
    );

    await expect(provider.getWorkItem({ id: "github-7" })).resolves.toMatchObject({
      id: "github-7",
      title: "Credentialed issue",
    });
    expect(credentialRequests).toMatchObject([
      {
        provider: "github",
        purpose: "api",
        actorId: "dev-nexus-automation-app",
        providerIdentity: "devnexus-automation",
        repository: { owner: "owner", name: "repo" },
        requiredPermissions: { issues: "write" },
      },
    ]);
    expect(calls[0]?.headers.Authorization).toBe("Bearer app-token");
  });

  it("routes broker token environment through GitLab and Jira providers", async () => {
    const credentialRequests: NexusProviderCredentialRequest[] = [];
    const broker: NexusProviderCredentialBroker = {
      resolveCredential: (request) => {
        credentialRequests.push(request);
        const token =
          request.provider === "gitlab" ? "gitlab-broker-token" : "jira-broker-token";
        return {
          provider: request.provider,
          host: request.host ?? null,
          profileId: `${request.provider}-token`,
          kind: "environment_token",
          purposes: ["api"],
          authorizationHeader: `Bearer ${token}`,
          env:
            request.provider === "gitlab"
              ? { GITLAB_TOKEN: token }
              : { JIRA_TOKEN: token },
          secret: { kind: "token", value: token },
        };
      },
    };
    const gitlabCalls: Array<{ headers: Record<string, string> }> = [];
    const jiraCalls: Array<{ headers: Record<string, string> }> = [];
    const gitlabProvider = await createWorkTrackerProviderAsync(
      {
        provider: "gitlab",
        repository: { id: "group/project" },
      },
      {
        credentials: { broker },
        gitlab: {
          credentialRunner: false,
          fetch: (async (_input, init = {}) => {
            gitlabCalls.push({ headers: init.headers as Record<string, string> });
            return new Response(
              JSON.stringify({
                id: 1001,
                iid: 7,
                title: "GitLab issue",
                state: "opened",
                labels: [],
                assignees: [],
                milestone: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }) as typeof fetch,
        },
      },
    );
    const jiraProvider = await createWorkTrackerProviderAsync(
      {
        provider: "jira",
        host: "https://example.atlassian.net",
        projectKey: "NEX",
      },
      {
        credentials: { broker },
        jira: {
          credentialRunner: false,
          fetch: (async (_input, init = {}) => {
            jiraCalls.push({ headers: init.headers as Record<string, string> });
            return new Response(
              JSON.stringify({
                id: "10001",
                key: "NEX-1",
                fields: {
                  summary: "Jira issue",
                  description: null,
                  status: { name: "To Do", statusCategory: { key: "new" } },
                  labels: [],
                  assignee: null,
                  created: null,
                  updated: null,
                  resolutiondate: null,
                  issuetype: { name: "Task" },
                  project: { key: "NEX", id: "10000" },
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }) as typeof fetch,
        },
      },
    );

    await expect(gitlabProvider.getWorkItem({ id: "gitlab-7" })).resolves.toMatchObject({
      id: "gitlab-7",
      title: "GitLab issue",
    });
    await expect(jiraProvider.getWorkItem({ id: "NEX-1" })).resolves.toMatchObject({
      id: "jira-NEX-1",
      title: "Jira issue",
    });
    expect(credentialRequests.map((request) => request.provider)).toEqual([
      "gitlab",
      "jira",
    ]);
    expect(gitlabCalls[0]?.headers["PRIVATE-TOKEN"]).toBe("gitlab-broker-token");
    expect(jiraCalls[0]?.headers.Authorization).toBe("Bearer jira-broker-token");
  });

  it("reports configured capabilities without requiring provider credentials", () => {
    expect(
      workTrackerCapabilityReportForConfig({
        provider: "local",
      }),
    ).toMatchObject({
      provider: "local",
      capabilities: {
        create: true,
        list: true,
        get: true,
        update: true,
        comment: true,
        labels: true,
        assignees: true,
        milestones: true,
        board: false,
        boardStatus: false,
      },
      unsupported: ["board", "boardStatus"],
    });
    expect(
      workTrackerCapabilitiesForConfig({
        provider: "github",
        repository: { owner: "owner", name: "repo" },
        board: {
          kind: "github-project-v2",
          projectId: "project-node",
          statusFieldId: "field-node",
          statusOptions: {
            ready: "option-node",
          },
        },
      }),
    ).toMatchObject({
      listItems: true,
      board: true,
      boardStatus: true,
    });
    expect(
      workTrackerCapabilityReportForConfig({
        provider: "jira",
        host: "https://example.atlassian.net",
        projectKey: "NEX",
        board: {
          kind: "jira-workflow",
          statusOptions: {
            blocked: "31",
          },
        },
      }),
    ).toMatchObject({
      provider: "jira",
      capabilities: {
        board: true,
        boardStatus: true,
        milestones: false,
      },
      unsupported: ["milestones"],
    });
  });

  it("uses explicit capability names in unsupported-operation diagnostics", () => {
    const provider = {
      provider: "minimal",
      capabilities: {
        ...workTrackerCapabilitiesForConfig({ provider: "local" }),
        listItems: false,
      },
    };

    expect(() =>
      assertWorkTrackerCapability(provider, "list", "discover eligible work"),
    ).toThrow(
      /provider "minimal" cannot discover eligible work; required capability "list" is disabled/,
    );
  });
});
