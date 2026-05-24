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
