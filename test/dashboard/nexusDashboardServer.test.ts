import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationRunRecord,
  appendNexusAutomationTargetCycleRecord,
  auditNexusDashboardClientVisuals,
  buildNexusDashboardHostActionQueue,
  buildNexusDashboardHostSnapshot,
  buildNexusDashboardSnapshot,
  CodexAppServerJsonRpcClient,
  createLocalWorkTrackerProvider,
  createNexusDashboardCodexChatStarter,
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  renderNexusDashboardClientModule,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  startNexusDashboardServer,
  stopVerifiedNexusDashboardServerRecord,
  validateNexusHomeConfigBase,
  writeNexusWorktreeLeaseStore,
  type GitRunner,
  type NexusDashboardServerRecord,
  type StopProcessByPidResult,
} from "../../src/index.js";
import {
  appServerAutomationConfig,
  cleanupDashboardTestTempDirs,
  extractDashboardActionToken,
  fakeGitRunner,
  fail,
  fixedClock,
  hostWorkspace,
  loadDashboardClientTestHooks,
  makeTempDir,
  MockCodexAppServerTransport,
  ok,
  projectConfig,
  RecordingCodexChatStarter,
  worktreeLease,
} from "./nexusDashboardTestHelpers.js";

afterEach(cleanupDashboardTestTempDirs);

describe("nexus dashboard server", () => {
  it("serves a Codex thread action endpoint for dashboard prompts", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-server-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const codexChatStarter = new RecordingCodexChatStarter();
    const server = await startNexusDashboardServer({
      projectRoot,
      codexChatStarter,
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      expect(actionToken).toBeTruthy();
      const unauthenticatedResponse = await fetch(`${server.url}api/codex/thread`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Review blocked approval.",
        }),
      });
      expect(unauthenticatedResponse.status).toBe(403);

      const response = await fetch(`${server.url}api/codex/thread`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          prompt: "Review blocked approval.",
          title: "Approval needed",
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body).toMatchObject({
        ok: true,
        result: {
          status: "started",
          profileId: "codex-app-server",
          threadId: "thread-1",
          turnId: "turn-1",
          threadPersistence: "durable",
        },
      });
      expect(codexChatStarter.starts).toEqual([
        {
          projectRoot,
          prompt: "Review blocked approval.",
          title: "Approval needed",
        },
      ]);
    } finally {
      await server.close();
    }

    expect(codexChatStarter.closed).toBe(true);
  });

  it("records dashboard server metadata and exposes server ownership info", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-server-info-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const server = await startNexusDashboardServer({
      projectRoot,
      now: fixedClock("2026-05-21T10:30:00.000Z"),
    });

    try {
      const publicInfo = await fetch(`${server.url}api/dashboard/server-info`)
        .then((response) => response.json());
      expect(publicInfo).toMatchObject({
        ok: true,
        dashboard: {
          id: expect.any(String),
          pid: process.pid,
          projectRoot: path.resolve(projectRoot),
          currentProjectRoot: null,
          host: "127.0.0.1",
          port: server.port,
          url: server.url,
          startedAt: "2026-05-21T10:30:00.000Z",
        },
        verified: false,
      });
      expect(publicInfo.dashboard.verificationToken).toBeUndefined();

      const registryPath = path.join(
        projectRoot,
        ".dev-nexus",
        "runtime",
        "dashboard-servers.json",
      );
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      expect(registry).toMatchObject({
        version: 1,
        servers: [
          {
            id: publicInfo.dashboard.id,
            pid: process.pid,
            host: "127.0.0.1",
            port: server.port,
            url: server.url,
            verificationToken: expect.any(String),
          },
        ],
      });

      const verifiedInfo = await fetch(`${server.url}api/dashboard/server-info`, {
        headers: {
          "x-dev-nexus-dashboard-verification":
            registry.servers[0].verificationToken,
        },
      }).then((response) => response.json());
      expect(verifiedInfo).toMatchObject({
        ok: true,
        verified: true,
        dashboard: {
          id: publicInfo.dashboard.id,
        },
      });
      expect(verifiedInfo.dashboard.verificationToken).toBeUndefined();
    } finally {
      await server.close();
    }

    const afterClosePath = path.join(
      projectRoot,
      ".dev-nexus",
      "runtime",
      "dashboard-servers.json",
    );
    const afterClose = fs.existsSync(afterClosePath)
      ? JSON.parse(fs.readFileSync(afterClosePath, "utf8"))
      : { servers: [] };
    expect(afterClose.servers).toEqual([]);
  });

  it("explains how to recover when a known cockpit port is occupied", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-port-conflict-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const server = await startNexusDashboardServer({ projectRoot });

    try {
      let message = "";
      try {
        await startNexusDashboardServer({
          projectRoot,
          host: "127.0.0.1",
          port: server.port,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain(
        `Cockpit port 127.0.0.1:${server.port} is already in use.`,
      );
      expect(message).toContain(server.url);
      expect(message).toContain("dev-nexus cockpit status");
      expect(message).toContain("--restart");
    } finally {
      await server.close();
    }
  });

  it("stops only a verified dashboard-owned server record for restart", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-safe-restart-");
    const record: NexusDashboardServerRecord = {
      id: "server-1",
      pid: process.pid,
      projectRoot,
      currentProjectRoot: null,
      host: "127.0.0.1",
      port: 4242,
      url: "http://127.0.0.1:4242/",
      startedAt: "2026-05-21T10:30:00.000Z",
      updatedAt: "2026-05-21T10:30:00.000Z",
      verificationToken: "secret-token",
    };
    const stopped: number[] = [];

    const result = await stopVerifiedNexusDashboardServerRecord(record, {
      currentPid: 999,
      fetcher: async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-dev-nexus-dashboard-verification"]).toBe(
          "secret-token",
        );
        return new Response(
          JSON.stringify({
            ok: true,
            verified: true,
            dashboard: {
              id: "server-1",
              pid: process.pid,
              projectRoot,
              currentProjectRoot: null,
              host: "127.0.0.1",
              port: 4242,
              url: "http://127.0.0.1:4242/",
              startedAt: "2026-05-21T10:30:00.000Z",
              updatedAt: "2026-05-21T10:30:00.000Z",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      stopper: async (pid): Promise<StopProcessByPidResult> => {
        stopped.push(pid);
        return {
          pid,
          stopped: true,
          alreadyExited: false,
          method: "process.kill",
        };
      },
    });

    expect(result).toMatchObject({
      stopped: true,
      reason: "stopped",
      verification: {
        owned: true,
      },
    });
    expect(stopped).toEqual([process.pid]);
  });

  it("shares provider freshness across cockpit server routes", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-provider-freshness-");
    const homePath = makeTempDir("dev-nexus-dashboard-provider-freshness-home-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [],
        authProfiles: [
          {
            id: "bot-github",
            actorId: "example-bot-actor",
            provider: "github",
            kind: "app",
            credentialKind: "github_app",
            account: "example-bot",
            host: "github.com",
            sshHost: "github.com-bot",
            githubCliConfigDir: "home:.config/gh-example-bot",
            gitUserName: "Example Bot",
            gitUserEmail: "bot@example.invalid",
            environmentKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    saveProjectConfig(projectRoot, projectConfig({
      automation: {
        ...defaultNexusAutomationConfig,
        selector: {
          ...defaultNexusAutomationConfig.selector,
          statuses: ["ready"],
          limit: 5,
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "direct_integration",
          remote: "bot",
          remoteUrl: "git@github.com-bot:example/project.git",
          sshHostAlias: "github.com-bot",
          targetBranch: "main",
          push: true,
          actor: {
            kind: "app",
            provider: "github",
            handle: "example-bot",
            id: null,
          },
          commandEnvironment: {
            GH_CONFIG_DIR: "home:.config/gh-example-bot",
          },
        },
      },
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "service_account",
            provider: "github",
            providerIdentity: "example-bot",
            displayName: "Example Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["maintainer"],
            scope: {
              component: "primary",
            },
          },
        ],
      },
      components: [
        {
          id: "primary",
          name: "Dashboard Demo",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:example/project.git",
          defaultBranch: "main",
          sourceRoot: "source",
          defaultWorkTrackerId: "github",
          workTrackers: [
            {
              id: "github",
              name: "GitHub Issues",
              enabled: true,
              roles: ["primary", "eligible_source"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "example",
                  name: "project",
                },
              },
            },
          ],
          trackerDiscovery: {
            scannedRoles: ["primary", "eligible_source"],
            directExternalSelection: "allowed",
            importRequiredFirst: false,
            providerFilters: ["github"],
            queryLimit: 5,
            conflictWinner: "scanned_tracker",
            missingCredentialBehavior: "skip",
          },
          relationships: [],
        },
      ],
    }));
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "remote get-url bot") {
        return ok([...args], "git@github.com-bot:example/project.git\n");
      }
      if (command === "remote get-url --push bot") {
        return ok([...args], "git@github.com-bot:example/project.git\n");
      }
      if (
        command === "config --local --get user.name" ||
        command === "config --get user.name"
      ) {
        return ok([...args], "Example Bot\n");
      }
      if (
        command === "config --local --get user.email" ||
        command === "config --get user.email"
      ) {
        return ok([...args], "bot@example.invalid\n");
      }
      return baseGitRunner(args, cwd);
    };
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url: String(input), headers });
      if (headers["If-None-Match"] === "\"dashboard-issues\"") {
        return new Response(null, { status: 304 });
      }
      return new Response(
        JSON.stringify([
          {
            id: 42,
            number: 42,
            title: "Ready cockpit task",
            body: "Provider-backed task",
            state: "open",
            labels: [{ name: "status:ready" }],
            assignees: [],
            created_at: "2026-05-21T09:40:00.000Z",
            updated_at: "2026-05-21T09:45:00.000Z",
            html_url: "https://github.com/example/project/issues/42",
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            etag: "\"dashboard-issues\"",
          },
        },
      );
    };
    const server = await startNexusDashboardServer({
      projectRoot,
      homePath,
      gitRunner,
      env: {
        GH_TOKEN: "github-token",
        GITHUB_TOKEN: "github-token",
      },
      providerOptions: {
        github: {
          fetch: fetcher,
          token: "github-token",
          apiBaseUrl: "https://api.github.test",
        },
      },
      now: fixedClock("2026-05-21T10:26:45.000Z"),
    });

    try {
      const host = await fetch(
        `${server.url}api/host?workspace=dashboard-demo`,
      ).then((response) => response.json());
      const cockpit = await fetch(
        `${server.url}api/cockpit?workspace=dashboard-demo`,
      ).then((response) => response.json());

      expect(host.actionQueue).toEqual(expect.any(Array));
      expect(cockpit.project.id).toBe("dashboard-demo");
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.slice(1).some((call) =>
        call.headers["If-None-Match"] === "\"dashboard-issues\""
      )).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("archives dashboard threads locally without deleting worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-thread-action-");
    const worktreesRoot = makeTempDir("dev-nexus-dashboard-thread-action-worktrees-");
    const worktreePath = path.join(worktreesRoot, "primary", "dashboard");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    const config = projectConfig({
      id: "thread-action-project",
      worktreesRoot,
    });
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-archive",
          status: "abandoned",
          branchName: "codex/dev-nexus/old-dashboard",
          updatedAt: "2026-05-21T09:00:00.000Z",
        }),
      ],
    });
    const server = await startNexusDashboardServer({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:20:00.000Z"),
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      expect(actionToken).toBeTruthy();
      const before = await fetch(`${server.url}api/cockpit`).then((response) =>
        response.json(),
      );
      expect(before.threads.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "lease-archive",
            decision: "archive",
          }),
        ]),
      );

      const response = await fetch(`${server.url}api/cockpit/thread-action`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          threadId: "lease-archive",
          action: "archive",
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        result: {
          action: "archive",
          threadId: "lease-archive",
          scope: "local",
        },
      });
      expect(fs.existsSync(worktreePath)).toBe(true);

      const after = await fetch(`${server.url}api/cockpit`).then((nextResponse) =>
        nextResponse.json(),
      );
      expect(
        after.threads.records.some(
          (thread: { id: string }) => thread.id === "lease-archive",
        ),
      ).toBe(false);
      expect(after.threads.totalCount).toBe(before.threads.totalCount - 1);
      expect(fs.existsSync(worktreePath)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("serves a host workspace overview endpoint", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-server-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-server-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-server-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "server-registered",
      name: "Server Registered",
    });
    const currentConfig = projectConfig({
      id: "server-current",
      name: "Server Current",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveProjectConfig(currentRoot, currentConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      projectRoot: currentRoot,
      homePath,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:20:00.000Z"),
    });

    try {
      const host = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      const projects = await fetch(`${server.url}api/projects`).then((response) =>
        response.json(),
      );
      const selectedHost = await fetch(
        `${server.url}api/host?workspace=server-registered`,
      ).then((response) => response.json());
      const selectedDashboard = await fetch(
        `${server.url}api/cockpit?workspace=server-registered`,
      ).then((response) => response.json());
      const selectedDiagnostics = await fetch(
        `${server.url}api/diagnostics?workspace=server-registered`,
      ).then((response) => response.json());
      const selectedWeave = await fetch(
        `${server.url}api/weave?workspace=server-registered`,
      ).then((response) => response.json());
      const selectedEvents = await fetch(
        `${server.url}api/events?workspace=server-registered`,
      ).then((response) => response.json());
      const missingResponse = await fetch(
        `${server.url}api/cockpit?workspace=missing-workspace`,
      );

      expect(host).toMatchObject({
        version: 1,
        homePath,
        currentProjectRoot: currentRoot,
        selectedWorkspaceId: "server-current",
        workspaceCount: 2,
        contract: {
          scope: "host",
          selection: {
            selectedWorkspaceId: "server-current",
          },
        },
      });
      expect(host.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
        "server-current",
        "server-registered",
      ]);
      expect(projects.projects.map((workspace: { id: string }) => workspace.id)).toEqual([
        "server-current",
        "server-registered",
      ]);
      expect(selectedHost).toMatchObject({
        version: 1,
        homePath,
        currentProjectRoot: registeredRoot,
        selectedWorkspaceId: "server-registered",
        workspaceCount: 2,
      });
      expect(
        selectedHost.workspaces.find(
          (workspace: { id: string }) => workspace.id === "server-registered",
        ),
      ).toMatchObject({
        current: true,
        root: registeredRoot,
      });
      expect(
        selectedHost.workspaces.find(
          (workspace: { id: string }) => workspace.id === "server-current",
        ),
      ).toMatchObject({
        current: false,
        root: currentRoot,
      });
      expect(selectedDashboard.project).toMatchObject({
        id: "server-registered",
        name: "Server Registered",
        root: registeredRoot,
      });
      expect(selectedDashboard.contract).toMatchObject({
        scope: "workspace",
        selection: {
          hostMode: true,
          selectedWorkspaceId: "server-registered",
          selectedWorkspaceRoot: registeredRoot,
        },
        diagnostics: {
          defaultPayload: false,
          endpoint: "/api/diagnostics",
        },
      });
      expect(selectedDashboard).not.toHaveProperty("automation");
      expect(selectedDashboard).not.toHaveProperty("eligibleWork");
      expect(selectedDashboard).not.toHaveProperty("targetReport");
      expect(selectedDiagnostics).toMatchObject({
        version: 1,
        projectRoot: registeredRoot,
        contract: {
          scope: "diagnostics",
          diagnostics: {
            defaultPayload: true,
          },
        },
      });
      expect(selectedDiagnostics).toHaveProperty("automation");
      expect(selectedDiagnostics).toHaveProperty("eligibleWork");
      expect(selectedDiagnostics).toHaveProperty("targetReport");
      expect(selectedWeave.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "project", label: "Server Registered" }),
        ]),
      );
      expect(Array.isArray(selectedEvents.events)).toBe(true);
      expect(missingResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("reuses full workspace snapshots across dashboard endpoints", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-cache-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const baseGitRunner = fakeGitRunner();
    let allowGit = true;
    let gitCalls = 0;
    const server = await startNexusDashboardServer({
      projectRoot,
      gitRunner: (args, cwd) => {
        if (!allowGit) {
          throw new Error("workspace refresh should use the cached snapshot");
        }
        gitCalls += 1;
        return baseGitRunner(args, cwd);
      },
      now: fixedClock("2026-05-21T10:26:00.000Z"),
    });

    try {
      const first = await fetch(`${server.url}api/cockpit`).then((response) =>
        response.json(),
      );
      expect(first.project.id).toBe("dashboard-demo");
      expect(gitCalls).toBeGreaterThan(0);

      allowGit = false;

      const diagnostics = await fetch(`${server.url}api/diagnostics`).then(
        (response) => response.json(),
      );
      const weave = await fetch(`${server.url}api/weave`).then((response) =>
        response.json(),
      );
      const events = await fetch(`${server.url}api/events`).then((response) =>
        response.json(),
      );
      const second = await fetch(`${server.url}api/cockpit`).then((response) =>
        response.json(),
      );

      expect(diagnostics.projectRoot).toBe(projectRoot);
      expect(weave.nodes).toEqual(expect.any(Array));
      expect(events.events).toEqual(expect.any(Array));
      expect(second.project.id).toBe("dashboard-demo");
    } finally {
      await server.close();
    }
  });

  it("reuses host snapshots across refresh requests", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-host-cache-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-host-cache-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-host-cache-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "host-cache-registered",
      name: "Host Cache Registered",
    });
    const currentConfig = projectConfig({
      id: "host-cache-current",
      name: "Host Cache Current",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveProjectConfig(currentRoot, currentConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const baseGitRunner = fakeGitRunner();
    let allowGit = true;
    let gitCalls = 0;
    const server = await startNexusDashboardServer({
      projectRoot: currentRoot,
      homePath,
      gitRunner: (args, cwd) => {
        if (!allowGit) {
          throw new Error("host refresh should use the cached snapshot");
        }
        gitCalls += 1;
        return baseGitRunner(args, cwd);
      },
      now: fixedClock("2026-05-21T10:26:30.000Z"),
    });

    try {
      const first = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      expect(first.workspaceCount).toBe(2);
      expect(gitCalls).toBeGreaterThan(0);

      allowGit = false;

      const second = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      expect(second.workspaceCount).toBe(2);
      expect(second.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
        "host-cache-current",
        "host-cache-registered",
      ]);
    } finally {
      await server.close();
    }
  });

  it("serves a host project shell without probing workspace Git state", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-project-shell-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-project-shell-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "project-shell",
      name: "Project Shell",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: () => {
        throw new Error("project shell must not run Git");
      },
      now: fixedClock("2026-05-21T10:24:00.000Z"),
    });

    try {
      const response = await fetch(`${server.url}api/projects`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.host).toMatchObject({
        version: 1,
        workspaceCount: 1,
        partial: true,
      });
      expect(payload.projects).toEqual([
        expect.objectContaining({
          id: "project-shell",
          name: "Project Shell",
          root: registeredRoot,
          loading: true,
          componentCount: 1,
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("resolves selected workspace dashboard data without probing unrelated workspaces", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-selected-shell-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-selected-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-selected-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "selected-registered",
      name: "Selected Registered",
    });
    const currentConfig = projectConfig({
      id: "selected-current",
      name: "Selected Current",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveProjectConfig(currentRoot, currentConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const baseGitRunner = fakeGitRunner();
    const server = await startNexusDashboardServer({
      projectRoot: currentRoot,
      homePath,
      gitRunner: (args, cwd) => {
        if (cwd?.startsWith(registeredRoot)) {
          throw new Error("selected workspace lookup must not probe registered Git");
        }
        return baseGitRunner(args, cwd);
      },
      now: fixedClock("2026-05-21T10:24:30.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit?workspace=selected-current`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.project).toMatchObject({
        id: "selected-current",
        root: currentRoot,
      });
    } finally {
      await server.close();
    }
  });

  it("serves a workspace shell without probing Git or provider state", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-workspace-shell-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-workspace-shell-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "workspace-shell",
      name: "Workspace Shell",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: () => {
        throw new Error("workspace shell must not run Git");
      },
      now: fixedClock("2026-05-21T10:24:45.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/shell?workspace=workspace-shell`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        version: 1,
        partial: true,
        project: {
          id: "workspace-shell",
          name: "Workspace Shell",
          root: registeredRoot,
        },
        summary: "Loading workspace signals.",
      });
      expect(payload.components).toHaveLength(1);
      expect(payload.components[0].git).toBeNull();
      expect(payload.signals.map((signal: { value: string }) => signal.value)).toContain("...");
      expect(payload.threads.records).toEqual([]);
      expect(payload.trackedWork.records).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("serves workspace sections independently for card hydration", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-section-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-section-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "workspace-section",
      name: "Workspace Section",
      plugins: [
        {
          id: "configured-plugin",
          enabled: true,
          capabilities: [],
        },
      ],
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: () => {
        throw new Error("plugin section must not run Git");
      },
      now: fixedClock("2026-05-21T10:24:50.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/section?workspace=workspace-section&section=plugins`,
      );
      const payload = await response.json();
      const invalidResponse = await fetch(
        `${server.url}api/cockpit/section?workspace=workspace-section&section=unknown`,
      );

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        version: 1,
        section: "plugins",
        patch: {
          loadedSections: ["plugins"],
          plugins: {
            enabledCount: 1,
            availableCount: 3,
            records: expect.arrayContaining([
              expect.objectContaining({
                id: "configured-plugin",
                state: "enabled",
              }),
              expect.objectContaining({
                id: "dev-nexus-research",
                source: "catalogue",
                state: "available",
              }),
            ]),
          },
        },
      });
      expect(invalidResponse.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("serves local tracked work without provider hydration", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-tracked-local-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-tracked-local-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "tracked-local",
      name: "Tracked Local",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot: registeredRoot,
      now: fixedClock("2026-05-21T10:24:55.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot: registeredRoot,
      title: "Keep local work visible",
      status: "ready",
    });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      providerFactory: () => {
        throw new Error("tracked-work section must not hydrate provider work");
      },
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:25:00.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/section?workspace=tracked-local&section=tracked-work`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        section: "tracked-work",
        patch: {
          loadedSections: ["tracked-work"],
          trackedWork: {
            source: "local",
            incomplete: true,
            readyCount: 1,
            records: [
              expect.objectContaining({
                title: "Keep local work visible",
                provider: "local",
              }),
            ],
          },
          eligibleWork: {
            ok: false,
            error: {
              name: "Pending",
            },
          },
          blockers: [],
        },
      });
    } finally {
      await server.close();
    }
  });

  it("serves local thread state without cleanup planning", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-thread-local-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-thread-local-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "thread-local",
      name: "Thread Local",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    writeNexusWorktreeLeaseStore(registeredRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(registeredConfig.id, {
          id: "lease-thread-local",
          status: "working",
          branchName: "codex/dev-nexus/thread-local",
        }),
      ],
    });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: (args, cwd) => {
        const command = args.join(" ");
        if (command.includes("worktree") || command.startsWith("branch ")) {
          throw new Error(`thread section must not run cleanup planner: ${command} in ${cwd}`);
        }
        return fakeGitRunner()(args, cwd);
      },
      now: fixedClock("2026-05-21T10:25:00.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/section?workspace=thread-local&section=threads`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        section: "threads",
        patch: {
          loadedSections: ["threads"],
          threads: {
            source: "local",
            incomplete: true,
            totalCount: 1,
            records: [
              expect.objectContaining({
                id: "lease-thread-local",
                branchName: "codex/dev-nexus/thread-local",
                decision: "continue",
              }),
            ],
          },
        },
      });
    } finally {
      await server.close();
    }
  });

  it("serves host cockpit data without a current workspace root", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-host-only-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-host-only-registered-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "host-only-registered",
      name: "Host Only Registered",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:25:00.000Z"),
    });

    try {
      const host = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      const workspaceResponse = await fetch(`${server.url}api/cockpit`);

      expect(server.projectRoot).toBeNull();
      expect(host).toMatchObject({
        version: 1,
        currentProjectRoot: null,
        selectedWorkspaceId: null,
        workspaceCount: 1,
        contract: {
          scope: "host",
          selection: {
            hostMode: true,
            selectedWorkspaceId: null,
          },
        },
      });
      expect(host.workspaces[0]).toMatchObject({
        id: "host-only-registered",
        current: false,
        registered: true,
      });
      expect(workspaceResponse.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("starts dashboard chats in the selected host workspace", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-chat-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-chat-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-chat-current-");
    const registeredWorktreesRoot = makeTempDir(
      "dev-nexus-dashboard-chat-worktrees-",
    );
    const registeredWorktreePath = path.join(
      registeredWorktreesRoot,
      "primary",
      "dashboard",
    );
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(registeredWorktreePath, { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "chat-registered",
      name: "Chat Registered",
      worktreesRoot: registeredWorktreesRoot,
    });
    const currentConfig = projectConfig({
      id: "chat-current",
      name: "Chat Current",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveProjectConfig(currentRoot, currentConfig);
    writeNexusWorktreeLeaseStore(registeredRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(registeredConfig.id, {
          id: "lease-dashboard",
        }),
      ],
    });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const codexChatStarter = new RecordingCodexChatStarter();
    const server = await startNexusDashboardServer({
      projectRoot: currentRoot,
      homePath,
      codexChatStarter,
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const response = await fetch(
        `${server.url}api/codex/thread?workspace=chat-registered`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            prompt: "Review selected workspace.",
            title: "Selected workspace",
            targetId: "thread:lease-dashboard",
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(codexChatStarter.starts).toEqual([
        {
          projectRoot: registeredRoot,
          prompt: "Review selected workspace.",
          title: "Selected workspace",
          cwd: registeredWorktreePath,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("opens home and project directories through server-owned paths", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-open-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-open-registered-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "open-registered",
      name: "Open Registered",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const opened: Array<{ app: string; target: string; path: string }> = [];
    const server = await startNexusDashboardServer({
      homePath,
      localResourceOpener: async (request) => {
        opened.push(request);
        return {
          ok: true,
          app: request.app,
          target: request.target,
          path: request.path,
        };
      },
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const openProject = await fetch(
        `${server.url}api/local/open?workspace=open-registered`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            target: "project",
            app: "terminal",
          }),
        },
      ).then(async (response) => ({
        status: response.status,
        body: await response.json(),
      }));
      const rejected = await fetch(
        `${server.url}api/local/open?workspace=open-registered`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            target: "project",
            app: "file",
            path: "/tmp/evil",
          }),
        },
      ).then(async (response) => ({
          status: response.status,
          body: await response.json(),
        }));
      const localAppIcon = await fetch(
        `${server.url}api/local/app-icon?app=file`,
      ).then(async (response) => ({
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bytes: (await response.arrayBuffer()).byteLength,
      }));

      expect(openProject.status).toBe(200);
      expect(openProject.body).toMatchObject({
        ok: true,
        result: {
          app: "terminal",
          target: "project",
          path: registeredRoot,
        },
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.message).toContain("path is server-controlled");
      expect(localAppIcon.status).toBe(200);
      expect(localAppIcon.contentType).toMatch(/^image\//u);
      expect(localAppIcon.bytes).toBeGreaterThan(0);
      expect(opened).toEqual([
        {
          app: "terminal",
          target: "project",
          path: registeredRoot,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("resumes a recorded assistant thread for cockpit targets", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-server-resume-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id),
      ],
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-21T10:02:00.000Z",
      record: {
        id: "run-chat-1",
        projectId: config.id,
        componentId: "primary",
        status: "completed",
        startedAt: "2026-05-21T10:01:00.000Z",
        finishedAt: "2026-05-21T10:02:00.000Z",
        workItemId: "local-1",
        branchName: "codex/dev-nexus/github-114-dashboard",
        codexAppServer: {
          provider: "codex-app-server",
          status: "completed",
          action: "thread_start",
          runId: "run-chat-1",
          profileId: "codex-app-server",
          threadId: "existing-thread",
          turnId: "turn-old",
          sourceThreadId: null,
          sourceTurnId: null,
          ephemeral: false,
          threadPersistence: "durable",
          cwd: projectRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: path.join(projectRoot, ".dev-nexus", "automation", "result.json"),
          failureSummary: null,
        },
      },
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-21T10:03:00.000Z",
      record: {
        id: "run-chat-ephemeral",
        projectId: config.id,
        componentId: "primary",
        status: "completed",
        startedAt: "2026-05-21T10:02:30.000Z",
        finishedAt: "2026-05-21T10:03:00.000Z",
        workItemId: "local-1",
        branchName: "codex/dev-nexus/github-114-dashboard",
        codexAppServer: {
          provider: "codex-app-server",
          status: "completed",
          action: "thread_start",
          runId: "run-chat-ephemeral",
          profileId: "codex-app-server",
          threadId: "ephemeral-thread",
          turnId: "turn-ephemeral",
          sourceThreadId: null,
          sourceTurnId: null,
          ephemeral: true,
          threadPersistence: "ephemeral",
          cwd: projectRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: path.join(projectRoot, ".dev-nexus", "automation", "result.json"),
          failureSummary: null,
        },
      },
    });
    const codexChatStarter = new RecordingCodexChatStarter();
    const server = await startNexusDashboardServer({
      projectRoot,
      codexChatStarter,
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const response = await fetch(`${server.url}api/codex/thread`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          prompt: "Continue cockpit target.",
          title: "Resume dashboard branch",
          targetId: "thread:lease-dashboard",
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body).toMatchObject({
        ok: true,
        result: {
          status: "resumed",
          profileId: "codex-app-server",
          threadId: "existing-thread",
          turnId: "turn-1",
        },
      });
      expect(codexChatStarter.starts).toEqual([
        {
          projectRoot,
          prompt: "Continue cockpit target.",
          title: "Resume dashboard branch",
          threadId: "existing-thread",
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("resumes related assistant thread context from tracked work targets", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-server-resume-work-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-21T09:00:00.000Z"),
    });
    const item = await tracker.createWorkItem({
      projectRoot,
      title: "Review dashboard chat context",
      status: "ready",
    });
    const branchName = "codex/dev-nexus/dashboard-chat-context";
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-chat-context",
          workItemId: item.id,
          branchName,
        }),
      ],
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-21T10:02:00.000Z",
      record: {
        id: "run-chat-context",
        projectId: config.id,
        componentId: "primary",
        status: "completed",
        startedAt: "2026-05-21T10:01:00.000Z",
        finishedAt: "2026-05-21T10:02:00.000Z",
        workItemId: item.id,
        branchName,
        codexAppServer: {
          provider: "codex-app-server",
          status: "completed",
          action: "thread_start",
          runId: "run-chat-context",
          profileId: "codex-app-server",
          threadId: "tracked-work-thread",
          turnId: "turn-old",
          sourceThreadId: null,
          sourceTurnId: null,
          ephemeral: false,
          threadPersistence: "durable",
          cwd: projectRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: path.join(projectRoot, ".dev-nexus", "automation", "result.json"),
          failureSummary: null,
        },
      },
    });
    const codexChatStarter = new RecordingCodexChatStarter();
    const server = await startNexusDashboardServer({
      projectRoot,
      codexChatStarter,
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const response = await fetch(`${server.url}api/codex/thread`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          prompt: "Continue tracked work.",
          title: "Tracked work",
          targetId: `tracked-work:primary:${item.id}`,
        }),
      });

      expect(response.status).toBe(201);
      expect(codexChatStarter.starts).toEqual([
        {
          projectRoot,
          prompt: "Continue tracked work.",
          title: "Tracked work",
          threadId: "tracked-work-thread",
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("rejects browser-controlled profile and cwd values for Codex thread actions", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-server-guard-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const codexChatStarter = new RecordingCodexChatStarter();
    const server = await startNexusDashboardServer({
      projectRoot,
      codexChatStarter,
    });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const response = await fetch(`${server.url}api/codex/thread`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          prompt: "Review blocked approval.",
          profileId: "other-profile",
          cwd: "/tmp",
          threadId: "other-thread",
          assistantThreadId: "other-thread",
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.message).toContain("profileId is server-controlled");
      expect(codexChatStarter.starts).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("starts a durable Codex app-server chat from a dashboard prompt", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-codex-chat-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      automation: appServerAutomationConfig(),
    }));
    const transport = new MockCodexAppServerTransport();
    const starter = createNexusDashboardCodexChatStarter({
      clientFactory: () =>
        new CodexAppServerJsonRpcClient({
          transport,
        }),
    });

    try {
      const result = await starter.start({
        projectRoot,
        prompt: "Review this thread.",
        title: "Review",
      });

      expect(result).toMatchObject({
        status: "started",
        profileId: "codex-app-server",
        threadId: "thread-1",
        turnId: "turn-1",
        cwd: projectRoot,
        model: "gpt-5.5",
        reasoning: "high",
        threadPersistence: "durable",
      });
      expect(transport.requests.map((request) => request.method)).toEqual([
        "initialize",
        "thread/start",
        "turn/start",
      ]);
      expect(transport.requests[1]?.params).toMatchObject({
        ephemeral: false,
        cwd: projectRoot,
        model: "gpt-5.5",
        approvalPolicy: "never",
        sandbox: "workspace-write",
        threadSource: "user",
      });
      expect(transport.requests[2]?.params).toMatchObject({
        threadId: "thread-1",
        cwd: projectRoot,
        model: "gpt-5.5",
        effort: "high",
        approvalPolicy: "never",
        input: [
          {
            type: "text",
            text: "Review this thread.",
            text_elements: [],
          },
        ],
      });
    } finally {
      await starter.close();
    }

    expect(transport.closed).toBe(true);
  });

  it("settles synchronous Codex app-server client close failures", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-codex-close-failure-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      automation: appServerAutomationConfig(),
    }));
    const transport = new MockCodexAppServerTransport();
    transport.closeError = new Error("close failed");
    const starter = createNexusDashboardCodexChatStarter({
      clientFactory: () =>
        new CodexAppServerJsonRpcClient({
          transport,
        }),
    });

    await starter.start({
      projectRoot,
      prompt: "Review this thread.",
    });

    await expect(starter.close()).resolves.toBeUndefined();
    expect(transport.closed).toBe(true);
  });

  it("resumes a durable Codex app-server chat from a known thread id", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-codex-resume-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      automation: appServerAutomationConfig(),
    }));
    const transport = new MockCodexAppServerTransport();
    const starter = createNexusDashboardCodexChatStarter({
      clientFactory: () =>
        new CodexAppServerJsonRpcClient({
          transport,
        }),
    });

    try {
      const result = await starter.start({
        projectRoot,
        prompt: "Resume this thread.",
        threadId: "existing-thread",
      });

      expect(result).toMatchObject({
        status: "resumed",
        profileId: "codex-app-server",
        threadId: "existing-thread",
        turnId: "turn-1",
        cwd: projectRoot,
        model: "gpt-5.5",
        reasoning: "high",
        threadPersistence: "durable",
      });
      expect(transport.requests.map((request) => request.method)).toEqual([
        "initialize",
        "thread/resume",
        "turn/start",
      ]);
      expect(transport.requests[1]?.params).toMatchObject({
        threadId: "existing-thread",
        cwd: projectRoot,
        model: "gpt-5.5",
        approvalPolicy: "never",
        sandbox: "workspace-write",
      });
      expect(transport.requests[2]?.params).toMatchObject({
        threadId: "existing-thread",
        cwd: projectRoot,
        model: "gpt-5.5",
        effort: "high",
        approvalPolicy: "never",
        input: [
          {
            type: "text",
            text: "Resume this thread.",
            text_elements: [],
          },
        ],
      });
    } finally {
      await starter.close();
    }

    expect(transport.closed).toBe(true);
  });

  it("reports a setup blocker when no Codex app-server profile is configured", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-codex-blocker-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const starter = createNexusDashboardCodexChatStarter({
      clientFactory: () => {
        throw new Error("client factory should not run");
      },
    });

    await expect(starter.start({
      projectRoot,
      prompt: "Review this thread.",
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("No Codex app-server profile"),
    });
  });
});
