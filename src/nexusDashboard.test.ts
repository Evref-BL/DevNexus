import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationRunRecord,
  appendNexusAutomationTargetCycleRecord,
  buildNexusDashboardHostSnapshot,
  buildNexusDashboardSnapshot,
  CodexAppServerJsonRpcClient,
  createLocalWorkTrackerProvider,
  createNexusDashboardCodexChatStarter,
  defaultNexusAutomationConfig,
  nexusWorktreeLeaseKind,
  renderNexusDashboardClientModule,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  startNexusDashboardServer,
  validateNexusHomeConfigBase,
  writeNexusWorktreeLeaseStore,
  type CodexAppServerJsonRpcRequest,
  type CodexAppServerJsonRpcResponse,
  type CodexAppServerJsonRpcTransport,
  type GitCommandResult,
  type GitRunner,
  type NexusDashboardCodexChatStartOptions,
  type NexusDashboardCodexChatStartResult,
  type NexusDashboardCodexChatStarter,
  type NexusProjectConfig,
  type NexusWorktreeLeaseRecord,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "dashboard-demo",
    name: "Dashboard Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        limit: 5,
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
        targetBranch: "main",
      },
    },
    plugins: [
      {
        id: "dev-nexus-typescript",
        name: "DevNexus TypeScript",
        version: "0.1.0-test",
        enabled: true,
        capabilities: [
          {
            kind: "projected_skill",
            id: "skill-typescript-diagnose",
            skillId: "typescript-diagnose",
          },
          {
            kind: "mcp_server",
            id: "mcp-typescript-diagnostics",
            serverName: "dev-nexus-typescript",
            tools: [
              {
                name: "typescript.diagnostics",
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function appServerAutomationConfig(): NonNullable<NexusProjectConfig["automation"]> {
  return {
    ...defaultNexusAutomationConfig,
    agent: {
      ...defaultNexusAutomationConfig.agent,
      coordinatorProfileId: "codex-app-server",
      profiles: [
        {
          id: "codex-app-server",
          executor: "codex",
          executorMode: "app_server",
          model: "gpt-5.5",
          version: null,
          variant: null,
          reasoning: "high",
          intelligence: null,
          intendedUse: "coordinator",
          safety: {
            profile: "isolated",
            allowHostMutation: false,
            allowDependencyInstall: false,
            allowLiveServices: false,
          },
          command: null,
          args: [
            "-c",
            "approval_policy=never",
            "--sandbox",
            "workspace-write",
          ],
          appServer: {
            mode: "spawn",
            command: "codex",
            args: ["app-server"],
            endpoint: "http://127.0.0.1:18080",
            ephemeralThreadDefault: false,
            localPolicy: {
              allowNonLoopbackEndpoint: false,
              hostLocalSafetyHints: ["spawns_local_process"],
            },
          },
        },
      ],
    },
  };
}

function fakeGitRunner(): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    const command = argsArray.join(" ");
    if (command === "rev-parse --show-toplevel") {
      return ok(argsArray, `${cwd ?? ""}\n`);
    }
    if (command === "rev-parse --abbrev-ref HEAD") {
      return ok(argsArray, "main\n");
    }
    if (command === "rev-parse HEAD") {
      return ok(argsArray, "abc1234567890\n");
    }
    if (command === "status --porcelain=v1") {
      return ok(argsArray, "");
    }
    if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return fail(argsArray, "fatal: no upstream configured\n");
    }
    if (command === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, "0\t0\n");
    }
    if (command.startsWith("config ")) {
      return ok(argsArray, "");
    }
    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function fail(args: string[], stderr: string): GitCommandResult {
  return {
    args,
    stdout: "",
    stderr,
    exitCode: 1,
  };
}

function worktreeLease(
  projectId: string,
  overrides: Partial<NexusWorktreeLeaseRecord> = {},
): NexusWorktreeLeaseRecord {
  const lease: NexusWorktreeLeaseRecord = {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id: "lease-dashboard",
    projectId,
    scope: {
      kind: "component",
      componentId: "primary",
    },
    hostId: "host-1",
    agentId: "agent-1",
    workItemId: "local-1",
    branchName: "codex/dev-nexus/github-114-dashboard",
    baseRef: "main",
    worktree: {
      kind: "component_worktree",
      base: "componentWorktreesRoot",
      componentId: "primary",
      relativePath: "dashboard",
    },
    writeScope: ["src/nexusDashboard.ts"],
    status: "working",
    createdAt: "2026-05-21T10:00:00.000Z",
    lastSeenAt: "2026-05-21T10:00:00.000Z",
    updatedAt: "2026-05-21T10:00:00.000Z",
    refreshCount: 0,
    lastObservedHeadCommit: "abc1234567890",
    dirty: false,
    pushed: false,
    git: {
      repository: {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId: "primary",
        relativePath: "dashboard",
      },
      upstream: null,
      ahead: null,
      behind: null,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      warnings: [],
    },
    notes: [],
  };
  return {
    ...lease,
    ...overrides,
    git: {
      ...lease.git,
      ...overrides.git,
    },
  };
}

class MockCodexAppServerTransport implements CodexAppServerJsonRpcTransport {
  readonly requests: CodexAppServerJsonRpcRequest[] = [];
  closed = false;

  async send(
    request: CodexAppServerJsonRpcRequest,
  ): Promise<CodexAppServerJsonRpcResponse> {
    this.requests.push(request);
    if (request.method === "initialize") {
      return { id: request.id, result: { protocolVersion: "0.1.0" } };
    }
    if (request.method === "thread/start") {
      return { id: request.id, result: { thread: { id: "thread-1" } } };
    }
    if (request.method === "thread/resume") {
      return { id: request.id, result: { thread: { id: "existing-thread" } } };
    }
    if (request.method === "turn/start") {
      return { id: request.id, result: { turn: { id: "turn-1" } } };
    }
    return {
      id: request.id,
      error: {
        code: -32601,
        message: `Unsupported method ${request.method}`,
      },
    };
  }

  close(): void {
    this.closed = true;
  }
}

class RecordingCodexChatStarter implements NexusDashboardCodexChatStarter {
  readonly starts: NexusDashboardCodexChatStartOptions[] = [];
  closed = false;

  async start(
    options: NexusDashboardCodexChatStartOptions,
  ): Promise<NexusDashboardCodexChatStartResult> {
    this.starts.push(options);
    return {
      status: options.threadId ? "resumed" : "started",
      profileId: "codex-app-server",
      threadId: options.threadId ?? "thread-1",
      turnId: "turn-1",
      cwd: options.cwd ?? options.projectRoot,
      model: "gpt-5.5",
      reasoning: "high",
      threadPersistence: "durable",
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus dashboard", () => {
  it("builds a typed snapshot and weave from project facts", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-21T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Build cockpit",
      status: "ready",
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-21T09:30:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "dashboard-demo",
        targetId: "dashboard",
        status: "dispatched",
        summary: "Completed via DevNexus PR #66: provider links.",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            title: "Build cockpit",
            cycleStatus: "dispatched",
          },
        ],
      },
    });
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id),
        worktreeLease(config.id, {
          id: "lease-stale-notes",
          branchName: "codex/dev-nexus/github-115-stale-notes",
          lastSeenAt: "2026-05-19T10:00:00.000Z",
          updatedAt: "2026-05-19T10:00:00.000Z",
          notes: ["Interesting research notes; park this before cleanup."],
        }),
      ],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      version: 1,
      generatedAt: "2026-05-21T10:05:00.000Z",
      project: {
        id: "dashboard-demo",
        componentCount: 1,
      },
      eligibleWork: {
        ok: true,
        value: {
          eligibleWorkItemCount: 1,
        },
      },
      worktrees: {
        activeCount: 1,
        staleCount: 1,
      },
      threads: {
        totalCount: 2,
        activeCount: 1,
        needsDecisionCount: 1,
      },
      plugins: {
        enabledCount: 1,
        totalCount: 1,
        capabilityCount: 2,
      },
    });
    expect(snapshot.threads.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lease-dashboard",
          decision: "continue",
          decisionLabel: "Continue",
        }),
        expect.objectContaining({
          id: "lease-stale-notes",
          decision: "review",
          decisionLabel: "Review",
          actions: [
            expect.objectContaining({
              label: "#115: stale notes",
              href: "https://github.com/Evref-BL/DevNexus/issues/115",
            }),
          ],
        }),
      ]),
    );
    expect(snapshot.signals.map((signal) => signal.id)).toContain("eligible-work");
    expect(snapshot.signals.find((signal) => signal.id === "worktrees")).toMatchObject({
      label: "Threads",
      value: "2",
      detail: "1 needs review",
    });
    expect(snapshot.signals.find((signal) => signal.id === "plugins")).toMatchObject({
      label: "Plugins",
      value: "1",
      detail: "2 capabilities",
    });
    expect(snapshot.plugins.records).toEqual([
      expect.objectContaining({
        id: "dev-nexus-typescript",
        name: "DevNexus TypeScript",
        capabilityCount: 2,
        mcpServerCount: 1,
        projectedSkillCount: 1,
      }),
    ]);
    expect(snapshot.weave.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "project",
        "component:primary",
        "work-item:primary-local-1",
        "worktree:lease-dashboard",
        "target-cycle:cycle-1",
      ]),
    );
    expect(snapshot.weave.edges.some((edge) => edge.kind === "selected")).toBe(true);
    expect(snapshot.weave.nodes.find((node) => node.id === "target-cycle:cycle-1")).toMatchObject({
      href: "https://github.com/Evref-BL/DevNexus/pull/66",
      actions: [
        {
          label: "PR #66: provider links",
          href: "https://github.com/Evref-BL/DevNexus/pull/66",
          provider: "github",
          kind: "pull-request",
        },
      ],
    });
    expect(snapshot.weave.nodes.find((node) => node.id === "worktree:lease-dashboard")).toMatchObject({
      href: "https://github.com/Evref-BL/DevNexus/issues/114",
      actions: [
        {
          label: "#114: dashboard",
          href: "https://github.com/Evref-BL/DevNexus/issues/114",
          provider: "github",
          kind: "issue",
        },
      ],
    });
    expect(snapshot.events.find((event) => event.id === "target-cycle-cycle-1")).toMatchObject({
      href: "https://github.com/Evref-BL/DevNexus/pull/66",
    });
  });

  it("builds a host snapshot from registered workspaces plus the current project", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "registered-project",
      name: "Registered Project",
    });
    const currentConfig = projectConfig({
      id: "current-project",
      name: "Current Project",
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

    const host = await buildNexusDashboardHostSnapshot({
      projectRoot: currentRoot,
      homePath,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:10:00.000Z"),
    });

    expect(host).toMatchObject({
      version: 1,
      generatedAt: "2026-05-21T10:10:00.000Z",
      homePath,
      currentProjectRoot: currentRoot,
      workspaceCount: 2,
      homeError: null,
    });
    expect(host.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "current-project",
          name: "Current Project",
          root: currentRoot,
          current: true,
          registered: false,
          componentCount: 1,
          pluginCount: 1,
        }),
        expect.objectContaining({
          id: "registered-project",
          name: "Registered Project",
          root: registeredRoot,
          current: false,
          registered: true,
          componentCount: 1,
          pluginCount: 1,
        }),
      ]),
    );
  });

  it("renders a client module with explicit light and dark mode controls", () => {
    const module = renderNexusDashboardClientModule();

    expect(module).toContain("dev-nexus-dashboard-theme");
    expect(module).toContain("data-dev-nexus-theme");
    expect(module).toContain("data-theme-mode=\"system\"");
    expect(module).toContain("data-theme-mode=\"light\"");
    expect(module).toContain("data-theme-mode=\"dark\"");
    expect(module).toContain(":root[data-dev-nexus-theme='light']");
    expect(module).toContain(":root[data-dev-nexus-theme='dark']");
    expect(module).toContain("color-scheme");
    expect(module).toContain("prefers-color-scheme");
    expect(module).toContain("data-select-id");
    expect(module).toContain("Workspace Activity");
    expect(module).toContain("Host cockpit");
    expect(module).toContain("Workspaces");
    expect(module).toContain("Action Needed");
    expect(module).toContain("HITL queue");
    expect(module).toContain("Plugins");
    expect(module).toContain("renderThreadInbox");
    expect(module).toContain("renderHostOverview");
    expect(module).toContain("renderWorkspaceCard");
    expect(module).toContain("hostRefreshMs");
    expect(module).toContain("hostInFlight");
    expect(module).toContain("renderThreadActions");
    expect(module).toContain("renderPlugins");
    expect(module).toContain("bindLocalActions");
    expect(module).toContain("data-copy-prompt");
    expect(module).toContain("Copy brief");
    expect(module).toContain("Start chat");
    expect(module).toContain("Resume chat");
    expect(module).toContain("data-start-chat-prompt");
    expect(module).toContain("data-chat-target-id");
    expect(module).toContain("/api/codex/thread");
    expect(module).toContain("/api/host");
    expect(module).toContain("x-dev-nexus-action-token");
    expect(module).toContain("renderChatActionStrip");
    expect(module).toContain("detailPrompt");
    expect(module).toContain("sentenceLine");
    expect(module).toContain("stripTerminalPunctuation");
    expect(module).not.toContain("Copy Codex brief");
    expect(module).not.toContain("Start Codex chat");
    expect(module).not.toContain("data-start-codex-prompt");
    expect(module).toContain("Parallel work map");
    expect(module).toContain("dn-work-stack");
    expect(module).toContain("dn-plugin-row");
    expect(module).toContain("dn-workspace-card");
    expect(module).toContain("Installed extensions");
    expect(module).not.toContain("Capability layer");
    expect(module).not.toContain("dn-side-stack");
    expect(module).toContain("Approval");
    expect(module).not.toContain("Human approval");
    expect(module).toContain("selectedDetail");
    expect(module).toContain("timelineLanes");
    expect(module).toContain("renderBranchGraph");
    expect(module).toContain("dn-branch-svg");
    expect(module).toContain("const rowHeight = 34");
    expect(module).toContain("data-row-height");
    expect(module).toContain("providerIcon");
    expect(module).toContain("externalLinkIcon");
    expect(module).toContain("clipboardIcon");
    expect(module).toContain("signal-components");
    expect(module).toContain("work: ${branch}");
    expect(module).not.toContain("tonebox");
    expect(module).not.toContain("renderRailLabels");
    expect(module).not.toContain("threadDetail");
    expect(module).toContain("left: calc(-115px + (var(--dn-lane) * 18px))");
    expect(module).toContain("-webkit-line-clamp: 3");
    expect(module).toContain("dn-action-strip");
    expect(module).toContain("target=\"_blank\"");
    expect(module).toContain("formatDisplayText");
    expect(module).toContain("signalIcon");
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
      const actionToken = html.match(
        /__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = "([^"]+)"/u,
      )?.[1];
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

      expect(host).toMatchObject({
        version: 1,
        homePath,
        currentProjectRoot: currentRoot,
        workspaceCount: 2,
      });
      expect(host.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
        "server-current",
        "server-registered",
      ]);
      expect(projects.projects.map((workspace: { id: string }) => workspace.id)).toEqual([
        "server-current",
        "server-registered",
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
      const actionToken = html.match(
        /__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = "([^"]+)"/u,
      )?.[1];
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
      const actionToken = html.match(
        /__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = "([^"]+)"/u,
      )?.[1];
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
