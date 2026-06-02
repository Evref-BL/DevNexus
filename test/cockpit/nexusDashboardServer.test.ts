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

describe("nexus dashboard server", () => {  it("imports the cockpit module through a revisioned asset URL", () => {
    const html = renderNexusDashboardHtml();

    expect(html).toMatch(
      /import \{ mountDevNexusCockpit \} from "\/assets\/dev-nexus-cockpit\.js\?v=[^"]+"/u,
    );
  });

  it("serves the Vite-built cockpit browser module when the bundle exists", async () => {
    const builtAssetPath = path.join(
      process.cwd(),
      "dist",
      "cockpit-client",
      "dev-nexus-cockpit.js",
    );
    if (!fs.existsSync(builtAssetPath)) {
      return;
    }
    const projectRoot = makeTempDir("dev-nexus-dashboard-built-asset-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const server = await startNexusDashboardServer({ projectRoot });

    try {
      const module = await fetch(`${server.url}assets/dev-nexus-cockpit.js`)
        .then((response) => response.text());

      expect(module).toContain("mountDevNexusCockpit");
      expect(module).toContain("dn-git-workflows");
      expect(module).not.toContain('from "./nexusCockpitStyles.js"');
      expect(module).not.toContain('from "./history/nexusCockpitWorkMap.js"');
    } finally {
      await server.close();
    }
  });

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


});
