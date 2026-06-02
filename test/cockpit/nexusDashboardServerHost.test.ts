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
  renderNexusDashboardHtml,
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

describe("nexus dashboard server host routes", () => {  it("serves a host workspace overview endpoint", async () => {
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


});
