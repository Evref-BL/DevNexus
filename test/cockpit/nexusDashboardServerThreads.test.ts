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

describe("nexus dashboard server thread routes", () => {  it("resumes a recorded assistant thread for cockpit targets", async () => {
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
