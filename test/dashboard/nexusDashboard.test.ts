import fs from "node:fs";
import os from "node:os";
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
  type NexusDashboardHostWorkspaceRecord,
  type NexusProjectConfig,
  type NexusWorktreeLeaseRecord,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
}

async function loadDashboardClientTestHooks(): Promise<{
  cockpitThreadPrompt: (thread: {
    branchName?: string | null;
    componentId?: string | null;
    decisionDetail: string;
    decisionLabel: string;
    hostId?: string | null;
    title: string;
    workItemId?: string | null;
  }) => string;
  dashboardRenderSignature: (value: unknown) => string;
  historyRows: (snapshot: unknown) => {
    rows: Array<{ detail: string; lane: number; node: { id: string }; title: string }>;
    lanes: Array<{ detail?: string; index: number; label: string; shortLabel: string }>;
  };
  renderBranchGraph: (
    rows: Array<{ lane: number }>,
    lanes: Array<{ index: number }>,
  ) => string;
  renderFeatureOverview: (snapshot: unknown, selectedId?: string | null) => string;
  renderGitHistory: (snapshot: unknown, selectedId?: string | null, filter?: string | null) => string;
  gitHistoryRows: (snapshot: unknown, filter?: string | null) => {
    maxLane: number;
    repository: unknown;
    rows: Array<{ commit: { hash: string }; index: number; lane: number; selectId: string }>;
    paths: Array<{
      fromIndex?: number;
      fromLane?: number;
      points?: Array<{ index: number; lane: number }>;
      toIndex?: number;
      toLane?: number;
    }>;
  } | null;
  renderActionStrip: (
    actions: Array<{
      href: string;
      kind: string;
      label: string;
      provider: string;
      title: string | null;
    }>,
  ) => string;
  renderLaneKey: (
    lanes: Array<{ detail?: string; index: number; label: string; shortLabel: string }>,
  ) => string;
  renderHostDashboard: (host: unknown, themeMode?: string, hostFocus?: string) => string;
  renderHostOverview: (host: unknown, snapshot?: unknown, selectedWorkspaceId?: string, options?: unknown) => string;
  renderProjectHeaderActions: (snapshot: unknown, themeMode?: string, selectedWorkspaceId?: string) => string;
  renderPlugins: (plugins: unknown) => string;
  renderSignal: (signal: unknown, selectedId?: string | null) => string;
  renderTrackedWork: (snapshot: unknown, selectedId?: string | null) => string;
  renderThreadInbox: (snapshot: unknown, selectedId?: string | null) => string;
  renderThreadActions: (thread: {
    actions?: unknown[];
    assistantThreadId?: string | null;
    decision: string;
    decisionDetail: string;
    decisionLabel: string;
    id: string;
    title: string;
  }) => string;
  selectedDetail: (snapshot: unknown, selectedId?: string | null) => {
    actions: Array<{ href: string; label: string }>;
    chat: { prompt: string; resumeThreadId?: string | null; targetId?: string; title: string } | null;
    facts: Array<[string, string]>;
    title: string;
  };
  signalPanelTarget: (id: string) => string;
  timelineLanes: (snapshot: unknown) => Array<{
    detail?: string;
    index: number;
    label: string;
    shortLabel: string;
  }>;
}> {
  const source = `${renderNexusDashboardClientModule()
    .replace(
      "export async function fetchDevNexusDashboard",
      "async function fetchDevNexusDashboard",
    )
    .replace(
      "export async function fetchDevNexusDashboardHost",
      "async function fetchDevNexusDashboardHost",
    )
    .replace(
      "export function mountDevNexusDashboard",
      "function mountDevNexusDashboard",
    )}
export { cockpitThreadPrompt, dashboardRenderSignature, gitHistoryRows, historyRows, renderActionStrip, renderBranchGraph, renderFeatureOverview, renderGitHistory, renderHostDashboard, renderHostOverview, renderLaneKey, renderPlugins, renderProjectHeaderActions, renderSignal, renderThreadActions, renderThreadInbox, renderTrackedWork, selectedDetail, signalPanelTarget, timelineLanes };`;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
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

function hostWorkspace(
  overrides: Partial<NexusDashboardHostWorkspaceRecord> = {},
): NexusDashboardHostWorkspaceRecord {
  return {
    id: "workspace",
    name: "Workspace",
    root: "/workspace",
    registered: true,
    current: false,
    generatedAt: "2026-05-21T10:00:00.000Z",
    summary: "Workspace is ready.",
    tone: "good",
    componentCount: 1,
    dirtyComponentCount: 0,
    threadCount: 0,
    needsDecisionCount: 0,
    staleThreadCount: 0,
    approvalCount: 0,
    blockerCount: 0,
    pluginCount: 0,
    automationStatus: "idle",
    eligibleWorkCount: 0,
    firstReadyWorkSelectionId: null,
    firstReadyWorkProviderAction: null,
    actionUpdatedAt: {},
    updatedAt: "2026-05-21T10:00:00.000Z",
    error: null,
    ...overrides,
  };
}

class MockCodexAppServerTransport implements CodexAppServerJsonRpcTransport {
  readonly requests: CodexAppServerJsonRpcRequest[] = [];
  closed = false;
  closeError: Error | null = null;

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
    if (this.closeError) {
      throw this.closeError;
    }
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
      contract: {
        scope: "workspace",
        diagnostics: {
          defaultPayload: false,
          endpoint: "/api/diagnostics",
        },
        surfaces: {
          workspaceSummary: {
            field: "summary",
          },
          selectedWorkspaceSnapshot: {
            field: "project",
          },
          actionQueue: {
            defaultPayload: false,
          },
          providerActions: {
            field: "actions",
          },
          plugins: {
            field: "plugins",
          },
          threadActions: {
            field: "threads.records",
          },
        },
      },
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
      detail: "1 thread needs action",
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
        projectedSkills: ["typescript-diagnose"],
        mcpServers: ["dev-nexus-typescript"],
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

  it("builds git history from refs and commit parent relationships", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-git-history-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "show-ref -d --head") {
        return ok(args as string[], [
          "merge000000000000000000000000000000000000000 HEAD",
          "merge000000000000000000000000000000000000000 refs/heads/main",
          "feature000000000000000000000000000000000000 refs/heads/feat/cockpit-graph",
          "merge000000000000000000000000000000000000000 refs/remotes/app/main",
          "tag0000000000000000000000000000000000000000 refs/tags/v1.0.0",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log")) {
        expect(command).toContain("--all");
        return ok(args as string[], [
          [
            "merge000000000000000000000000000000000000000",
            "main10000000000000000000000000000000000000 feature000000000000000000000000000000000000",
            "Gabriel",
            "gabriel@example.com",
            "1779537600",
            "Merge feature graph",
          ].join(field),
          [
            "feature000000000000000000000000000000000000",
            "main10000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537300",
            "Add graph data",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      now: fixedClock("2026-05-23T10:00:00.000Z"),
    });

    expect(snapshot.history).toMatchObject({
      totalCommitCount: 2,
      incomplete: false,
      repositories: [
        expect.objectContaining({
          componentId: "primary",
          head: "merge000000000000000000000000000000000000000",
          scope: {
            kind: "all",
            branches: [],
          },
          branchNames: [
            "main",
            "feat/cockpit-graph",
            "app/main",
          ],
          tagNames: ["v1.0.0"],
          moreAvailable: false,
          commits: [
            expect.objectContaining({
              hash: "merge000000000000000000000000000000000000000",
              shortHash: "merge00",
              parents: [
                "main10000000000000000000000000000000000000",
                "feature000000000000000000000000000000000000",
              ],
              subject: "Merge feature graph",
              refs: expect.arrayContaining([
                expect.objectContaining({ kind: "head", name: "HEAD" }),
                expect.objectContaining({ kind: "branch", name: "main" }),
                expect.objectContaining({ kind: "remote", name: "app/main" }),
              ]),
            }),
            expect.objectContaining({
              hash: "feature000000000000000000000000000000000000",
              parents: ["main10000000000000000000000000000000000000"],
              committedAt: "2026-05-23T11:55:00.000Z",
              subject: "Add graph data",
              refs: [
                expect.objectContaining({
                  kind: "branch",
                  name: "feat/cockpit-graph",
                }),
              ],
            }),
          ],
        }),
      ],
    });
  });

  it("can scope git history to selected branches", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-filtered-git-history-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "show-ref -d --head") {
        return ok(args as string[], [
          "feature100000000000000000000000000000000000 refs/heads/feat/cockpit-graph",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log")) {
        expect(command).toContain("feat/cockpit-graph");
        expect(command).not.toContain("--all");
        return ok(args as string[], [
          [
            "feature100000000000000000000000000000000000",
            "main10000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537600",
            "Add graph data",
          ].join(field),
          [
            "feature000000000000000000000000000000000000",
            "main00000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537300",
            "Start graph data",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      historyBranches: ["feat/cockpit-graph"],
      historyMaxCommits: 1,
      now: fixedClock("2026-05-23T10:00:00.000Z"),
    });

    expect(snapshot.history.repositories[0]).toMatchObject({
      scope: {
        kind: "branches",
        branches: ["feat/cockpit-graph"],
      },
      moreAvailable: true,
      commits: [
        expect.objectContaining({
          hash: "feature100000000000000000000000000000000000",
        }),
      ],
    });
  });

  it("builds a feature overview from feature branch delivery policy and related threads", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-features-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const baseConfig = projectConfig();
    const config = {
      ...baseConfig,
      automation: {
        ...baseConfig.automation!,
        publication: {
          ...baseConfig.automation!.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: "v-next",
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
            },
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
    };
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-23T09:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-feature-branch",
          branchName: "feat/codex-goals",
          lastSeenAt: "2026-05-23T08:30:00.000Z",
          updatedAt: "2026-05-23T08:30:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-review-branch",
          branchName: "feat/codex-goals/header-card",
          lastSeenAt: "2026-05-23T08:45:00.000Z",
          updatedAt: "2026-05-23T08:45:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-unrelated",
          branchName: "fix/other-thing",
          lastSeenAt: "2026-05-23T08:50:00.000Z",
          updatedAt: "2026-05-23T08:50:00.000Z",
        }),
      ],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.features).toMatchObject({
      activeCount: 2,
      needsAttentionCount: 0,
      records: expect.arrayContaining([
        expect.objectContaining({
          id: "feature:primary:codex-goals",
          title: "codex-goals",
          componentIds: ["primary"],
          branchStrategy: "hybrid",
          status: "active",
          statusLabel: "Active",
          featureBranch: "feat/codex-goals",
          reviewBranchPattern: "feat/codex-goals/{change}",
          finalPublicationTarget: "main",
          threadCount: 2,
          branchCount: 2,
          branches: ["feat/codex-goals", "feat/codex-goals/header-card"],
        }),
      ]),
    });
  });

  it("infers active feature groups from branch families when no feature policy is configured", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-inferred-features-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-23T09:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-feature-api",
          branchName: "feat/codex-goals/api",
          lastSeenAt: "2026-05-23T08:30:00.000Z",
          updatedAt: "2026-05-23T08:30:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-feature-ui",
          branchName: "feat/codex-goals/ui",
          lastSeenAt: "2026-05-23T08:45:00.000Z",
          updatedAt: "2026-05-23T08:45:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-dashboard",
          branchName: "codex/dev-nexus/dashboard-cockpit-kit",
          lastSeenAt: "2026-05-23T08:50:00.000Z",
          updatedAt: "2026-05-23T08:50:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-quality-audit",
          branchName: "codex/dev-nexus/---quality+++audit---",
          lastSeenAt: "2026-05-23T08:55:00.000Z",
          updatedAt: "2026-05-23T08:55:00.000Z",
        }),
      ],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.features.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "feature:inferred:codex-goals",
          title: "codex-goals",
          branchStrategy: "inferred",
          status: "active",
          branchCount: 2,
          branches: ["feat/codex-goals/api", "feat/codex-goals/ui"],
        }),
        expect.objectContaining({
          id: "feature:inferred:dashboard-cockpit-kit",
          title: "dashboard-cockpit-kit",
          branchStrategy: "inferred",
          status: "active",
          branchCount: 1,
          branches: ["codex/dev-nexus/dashboard-cockpit-kit"],
        }),
        expect.objectContaining({
          id: "feature:inferred:quality-audit",
          title: "---quality+++audit---",
          branchStrategy: "inferred",
          status: "active",
          branchCount: 1,
          branches: ["codex/dev-nexus/---quality+++audit---"],
        }),
      ]),
    );
  });

  it("infers active feature groups from Git refs without worktree leases", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-inferred-git-features-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "show-ref -d --head") {
        return ok(args as string[], [
          "main000000000000000000000000000000000000000 refs/heads/main",
          "api0000000000000000000000000000000000000000 refs/remotes/origin/feat/codex-goals/api",
          "ui00000000000000000000000000000000000000000 refs/heads/feat/codex-goals/ui",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log")) {
        return ok(args as string[], [
          [
            "ui00000000000000000000000000000000000000000",
            "main000000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537600",
            "Add UI branch",
          ].join(field),
          [
            "api0000000000000000000000000000000000000000",
            "main000000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537300",
            "Add API branch",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.features.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "feature:inferred:codex-goals",
          title: "codex-goals",
          branchStrategy: "inferred",
          status: "active",
          featureBranch: "feat/codex-goals",
          branchCount: 2,
          branches: [
            "origin/feat/codex-goals/api",
            "feat/codex-goals/ui",
          ],
          componentIds: ["primary"],
          componentNames: ["Dashboard Demo"],
        }),
      ]),
    );
    expect(
      snapshot.features.records.find(
        (feature) => feature.id === "feature:inferred:codex-goals",
      )?.detail,
    ).toContain("Git refs");
  });

  it("classifies thread lifecycle states and resumable assistant chats", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-thread-lifecycle-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-resume",
          workItemId: "local-1",
          branchName: "codex/dev-nexus/github-114-dashboard",
          status: "working",
          updatedAt: "2026-05-21T10:00:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-blocked",
          workItemId: "github-120",
          branchName: "codex/dev-nexus/github-120-blocked",
          status: "blocked",
          updatedAt: "2026-05-21T09:00:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-merged",
          workItemId: "github-121",
          branchName: "codex/dev-nexus/github-121-merged",
          status: "merged",
          updatedAt: "2026-05-21T08:00:00.000Z",
        }),
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

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot.threads).toMatchObject({
      activeCount: 1,
      needsDecisionCount: 2,
    });
    expect(snapshot.threads.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lease-resume",
          decision: "resume",
          decisionLabel: "Resume",
          assistantThreadId: "existing-thread",
        }),
        expect.objectContaining({
          id: "lease-blocked",
          decision: "blocked",
          decisionLabel: "Blocked",
        }),
        expect.objectContaining({
          id: "lease-merged",
          decision: "merged",
          decisionLabel: "Merged",
        }),
      ]),
    );
  });

  it("summarizes enabled and disabled plugins for cockpit cards", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-plugins-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      plugins: [
        ...(projectConfig().plugins ?? []),
        {
          id: "dev-nexus-research",
          name: "DevNexus Research",
          version: "0.1.0-test",
          enabled: false,
          capabilities: [
            {
              kind: "setup_obligation",
              id: "research-corpus",
              description: "Prepare research corpus",
              required: true,
            },
            {
              kind: "dependency_projection",
              id: "research-node-modules",
              source: "node_modules",
              target: "node_modules",
              required: true,
            },
          ],
        },
      ],
    });
    saveProjectConfig(projectRoot, config);

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot.plugins).toMatchObject({
      totalCount: 2,
      enabledCount: 1,
      capabilityCount: 4,
    });
    expect(snapshot.plugins.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dev-nexus-research",
          enabled: false,
          setupActionCount: 1,
          dependencyProjectionCount: 1,
          setupHints: ["Prepare research corpus"],
          dependencyHints: ["node_modules -> node_modules"],
        }),
      ]),
    );
  });

  it("surfaces local plugin packages as available cockpit plugins", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-local-plugins-");
    const pluginRoot = path.join(projectRoot, "source", "plugins", "dev-nexus-research");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "package.json"),
      JSON.stringify({
        name: "@evref-bl/dev-nexus-research",
        version: "0.1.0-alpha.0",
        description: "Research workflow support for DevNexus.",
      }),
      "utf8",
    );
    saveProjectConfig(projectRoot, projectConfig({ plugins: [] }));

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot.plugins).toMatchObject({
      totalCount: 1,
      enabledCount: 0,
      configuredCount: 0,
      availableCount: 1,
      capabilityCount: 0,
    });
    expect(snapshot.plugins.records[0]).toMatchObject({
      id: "dev-nexus-research",
      name: "DevNexus Research",
      source: "local",
      state: "available",
      enabled: false,
      packageName: "@evref-bl/dev-nexus-research",
      sourcePath: pluginRoot,
      detail: "Research workflow support for DevNexus.",
    });
    expect(snapshot.plugins.records[0]?.refreshCommand).toContain("dev-nexus workspace plugin refresh");
    expect(snapshot.plugins.records[0]?.refreshCommand).toContain("--from");
    expect(snapshot.plugins.records[0]?.refreshCommand).toContain(pluginRoot);
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
      selectedWorkspaceId: "current-project",
      workspaceCount: 2,
      homeError: null,
      contract: {
        scope: "host",
        selection: {
          selectedWorkspaceId: "current-project",
          workspaceQueryParam: "workspace",
        },
        surfaces: {
          hostSummary: {
            field: "workspaces",
          },
          workspaceSummary: {
            field: "workspaces[]",
          },
          selectedWorkspaceSnapshot: {
            endpoint: "/api/cockpit?workspace=:workspaceId",
          },
          actionQueue: {
            field: "actionQueue",
          },
          providerActions: {
            field: "actionQueue[].providerAction",
          },
          plugins: {
            field: "workspaces[].pluginCount",
          },
          threadActions: {
            field: "workspaces[].needsDecisionCount",
          },
        },
      },
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

  it("builds a ranked host action queue from workspace attention signals", () => {
    const actions = buildNexusDashboardHostActionQueue([
      hostWorkspace({
        id: "dirty",
        name: "Dirty Workspace",
        dirtyComponentCount: 2,
        tone: "warn",
      }),
      hostWorkspace({
        id: "approval",
        name: "Approval Workspace",
        approvalCount: 3,
        actionUpdatedAt: {
          approval: "2026-05-21T09:30:00.000Z",
        },
        tone: "warn",
      }),
      hostWorkspace({
        id: "thread",
        name: "Thread Workspace",
        threadCount: 4,
        needsDecisionCount: 2,
        staleThreadCount: 1,
        actionUpdatedAt: {
          thread: "2026-05-21T08:15:00.000Z",
        },
        tone: "warn",
      }),
      hostWorkspace({
        id: "ready",
        name: "Ready Workspace",
        eligibleWorkCount: 2,
        actionUpdatedAt: {
          "ready-work": "2026-05-21T09:45:00.000Z",
        },
        firstReadyWorkSelectionId: "tracked-work:primary:github-42",
        firstReadyWorkProviderAction: {
          label: "#42: ready work",
          href: "https://github.com/Evref-BL/DevNexus/issues/42",
          provider: "github",
          kind: "issue",
          title: "ready work",
        },
        tone: "active",
      }),
      hostWorkspace({
        id: "blocked",
        name: "Blocked Workspace",
        blockerCount: 1,
        automationStatus: "blocked",
        actionUpdatedAt: {
          blocker: "2026-05-21T09:50:00.000Z",
        },
        tone: "danger",
      }),
      hostWorkspace({
        id: "broken",
        name: "Broken Workspace",
        summary: "Workspace snapshot is unavailable.",
        actionUpdatedAt: {
          "workspace-error": "2026-05-21T09:55:00.000Z",
        },
        tone: "danger",
        error: {
          name: "Error",
          message: "Missing project config",
        },
      }),
    ]);

    expect(actions.map((action) => action.kind)).toEqual([
      "workspace-error",
      "blocker",
      "approval",
      "ready-work",
      "thread",
      "dirty",
    ]);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "host-action:broken:workspace-error",
          workspaceId: "broken",
          reason: "Workspace unavailable",
          state: "unavailable",
          updatedAt: "2026-05-21T09:55:00.000Z",
          primaryAction: {
            label: "Review workspace",
            kind: "review",
            workspaceId: "broken",
            targetSelectionId: null,
          },
        }),
        expect.objectContaining({
          id: "host-action:approval:approval",
          reason: "3 approvals needed",
          updatedAt: "2026-05-21T09:30:00.000Z",
          primaryAction: expect.objectContaining({
            label: "Review approval",
          }),
        }),
        expect.objectContaining({
          id: "host-action:thread:thread",
          reason: "2 threads need action",
          state: "stale threads",
          updatedAt: "2026-05-21T08:15:00.000Z",
        }),
        expect.objectContaining({
          id: "host-action:ready:ready-work",
          reason: "2 ready items",
          updatedAt: "2026-05-21T09:45:00.000Z",
          primaryAction: {
            label: "Review work",
            kind: "start-work",
            workspaceId: "ready",
            targetSelectionId: "tracked-work:primary:github-42",
          },
          providerAction: expect.objectContaining({
            href: "https://github.com/Evref-BL/DevNexus/issues/42",
          }),
        }),
        expect.objectContaining({
          id: "host-action:dirty:dirty",
          reason: "2 dirty components",
          updatedAt: null,
          primaryAction: {
            label: "Rescue changes",
            kind: "rescue",
            workspaceId: "dirty",
            targetSelectionId: null,
          },
        }),
      ]),
    );
  });

  it("renders a client module with explicit light and dark mode controls", () => {
    const module = renderNexusDashboardClientModule();

    expect(module).toContain("dev-nexus-cockpit-theme");
    expect(module).toContain("data-dev-nexus-theme");
    expect(module).toContain("data-theme-mode=\"system\"");
    expect(module).toContain("data-theme-mode=\"light\"");
    expect(module).toContain("data-theme-mode=\"dark\"");
    expect(module).toContain(":root[data-dev-nexus-theme='light']");
    expect(module).toContain(":root[data-dev-nexus-theme='dark']");
    expect(module).toContain("color-scheme");
    expect(module).toContain("prefers-color-scheme");
    expect(module).toContain("data-select-id");
    expect(module).toContain("Activity Lanes");
    expect(module).toContain("Host cockpit");
    expect(module).toContain("Workspaces");
    expect(module).toContain("Action Needed");
    expect(module).toContain("HITL queue");
    expect(module).toContain("Plugins");
    expect(module).toContain("renderThreadInbox");
    expect(module).toContain("renderHostOverview");
    expect(module).toContain("renderWorkspaceCard");
    expect(module).toContain("renderHostDashboard");
    expect(module).toContain("renderHostActionQueue");
    expect(module).toContain("Host Cockpit");
    expect(module).toContain("Host HITL");
    expect(module).toContain("Action Queue");
    expect(module).toContain("renderLoading");
    expect(module).toContain("dn-loading-panel");
    expect(module).toContain("dn-loader");
    expect(module).toContain("dn-skeleton");
    expect(module).toContain("if (!workspaceId) {\n        if (!latestHost) {");
    expect(module).toContain("@keyframes dn-spin");
    expect(module).toContain("@keyframes dn-shimmer");
    expect(module).toContain("Loading host cockpit");
    expect(module).toContain("Switching workspace");
    expect(module).toContain("hostRefreshMs");
    expect(module).toContain("hostInFlight");
    expect(module).toContain("workspaceQuery");
    expect(module).toContain("?workspace=");
    expect(module).toContain("selectedWorkspaceId");
    expect(module).toContain("readWorkspaceIdFromLocation");
    expect(module).toContain("writeWorkspaceIdToLocation");
    expect(module).toContain("bindWorkspaceControls");
    expect(module).toContain("bindHostSignalControls");
    expect(module).toContain("data-host-focus");
    expect(module).toContain("data-scroll-target");
    expect(module).toContain("scrollToDashboardSection");
    expect(module).toContain("signalPanelTarget");
    expect(module).toContain("filteredHostActions");
    expect(module).toContain("filteredHostWorkspaces");
    expect(module).toContain("host-action-queue");
    expect(module).toContain("dn-host-action-shell");
    expect(module).toContain("host-workspaces");
    expect(module).not.toContain("dn-host-sticky-panel");
    expect(module).toContain("data-workspace-id");
    expect(module).toContain("data-workspace-selection-id");
    expect(module).toContain("targetSelectionId");
    expect(module).toContain("renderCurrent();");
    expect(module).toContain("renderThreadActions");
    expect(module).toContain("threadSelectId");
    expect(module).toContain("threadDetail");
    expect(module).toContain("id=\"hitl-queue\"");
    expect(module).toContain("renderThreadPolicyAction");
    expect(module).toContain("renderPlugins");
    expect(module).toContain("pluginPills");
    expect(module).toContain("renderPluginPolicyAction");
    expect(module).toContain("renderDisabledAction");
    expect(module).toContain("dn-policy-action");
    expect(module).toContain("data-thread-action");
    expect(module).toContain("/api/cockpit/thread-action");
    expect(module).toContain("Needs plugin enable policy");
    expect(module).toContain("Local plugin candidates copy a refresh command");
    expect(module).toContain("data-copy-text");
    expect(module).toContain("bindLocalActions");
    expect(module).toContain("data-copy-prompt");
    expect(module).toContain("Copy prompt");
    expect(module).toContain("renderOpenMenu");
    expect(module).toContain("chevronDownIcon");
    expect(module).toContain("dn-open-chevron");
    expect(module).toContain("dn-open-chevron-shell");
    expect(module).toContain("min-width: 94px");
    expect(module).toContain(".dn-open-menu[open] .dn-open-chevron");
    expect(module).toContain("/api/local/open");
    expect(module).toContain("data-open-target");
    expect(module).toContain("data-open-app");
    expect(module).toContain("/api/local/app-icon?app=");
    expect(module).toContain("dn-app-icon-img");
    expect(module).toContain(".dn-header-path-menu { flex: 0 1 auto; width: fit-content; min-width: min(100%, 320px); max-width: min(100%, 520px); }");
    expect(module).toContain("@media (max-width: 860px) { .dn-header { grid-template-columns: 1fr; } .dn-header-actions { justify-content: flex-end; width: 100%; } .dn-header-strip { width: 100%; } }");
    expect(module).toContain("@media (max-width: 560px) { .dn-header-actions { justify-content: stretch; } .dn-header-strip { justify-content: stretch; } .dn-header-path-menu { width: 100%; max-width: 100%; } }");
    expect(module).not.toContain(".dn-header-strip, .dn-header-path-menu { width: 100%; }");
    expect(module).toContain("Finder");
    expect(module).toContain("VS Code");
    expect(module).toContain("Terminal");
    expect(module).not.toContain("<span aria-hidden=\"true\">v</span>");
    expect(module).not.toContain("min-width: 116px");
    expect(module).not.toContain("Copy brief");
    expect(module).toContain("Start chat");
    expect(module).toContain("Resume chat");
    expect(module).toContain("data-start-chat-prompt");
    expect(module).toContain("data-chat-target-id");
    expect(module).toContain("/api/codex/thread");
    expect(module).toContain("/api/codex/thread${workspaceQuery(workspaceId)}");
    expect(module).toContain("/api/host");
    expect(module).toContain("x-dev-nexus-action-token");
    expect(module).toContain("renderChatActionStrip");
    expect(module).toContain("detailPrompt");
    expect(module).toContain("sentenceLine");
    expect(module).toContain("stripTerminalPunctuation");
    expect(module).not.toContain("Copy Codex brief");
    expect(module).not.toContain("Start Codex chat");
    expect(module).not.toContain("data-start-codex-prompt");
    expect(module).toContain("Workspace map");
    expect(module).toContain("dn-work-stack");
    expect(module).toContain("dn-plugin-row");
    expect(module).toContain("dn-workspace-card");
    expect(module).toContain("Extensions");
    expect(module).not.toContain("Capability layer");
    expect(module).not.toContain("dn-side-stack");
    expect(module).toContain("Approval");
    expect(module).not.toContain("Human approval");
    expect(module).toContain("selectedDetail");
    expect(module).toContain("renderSelectedItem");
    expect(module).toContain("dn-selected-panel");
    expect(module).toContain("id=\"selected-item\"");
    expect(module).toContain("id=\"tracked-work-panel\"");
    expect(module).toContain("id=\"plugins-panel\"");
    expect(module).toContain("id=\"components-panel\"");
    expect(module).toContain("id=\"blockers-panel\"");
    expect(module).toContain("Selected item");
    expect(module).toContain("Summary");
    expect(module).toContain("Actions");
    expect(module).toContain("Evidence");
    expect(module).toContain("Diagnostics");
    expect(module).not.toContain("dn-inspector");
    expect(module).toContain("timelineLanes");
    expect(module).toContain("renderBranchGraph");
    expect(module).toContain("dn-branch-svg");
    expect(module).toContain("const rowHeight = 34");
    expect(module).toContain("data-row-height");
    expect(module).toContain("--dn-project-accent");
    expect(module).toContain("projectAccentStyle");
    expect(module).toContain("projectAccentCount = 7");
    expect(module).toContain("workspaceAccentMap");
    expect(module).toContain("--dn-branch-6");
    expect(module).toContain("stableAccentIndex");
    expect(module).not.toContain("--dn-warn: #9a641c");
    expect(module).toContain("providerIcon");
    expect(module).toContain("externalLinkIcon");
    expect(module).toContain("clipboardIcon");
    expect(module).toContain("signal-components");
    expect(module).toContain("Not Git history");
    expect(module).toContain("Each rail is a workspace category");
    expect(module).toContain("Source checkout");
    expect(module).toContain("Active branch");
    expect(module).toContain("More branches");
    expect(module).toContain("Automation");
    expect(module).toContain("Decisions");
    expect(module).toContain("rowGuides");
    expect(module).not.toContain("tonebox");
    expect(module).not.toContain("renderRailLabels");
    expect(module).toContain("threadDetail");
    expect(module).toContain("left: calc(-115px + (var(--dn-lane) * 18px))");
    expect(module).toContain("-webkit-line-clamp: 3");
    expect(module).toContain("dn-action-strip");
    expect(module).toContain("target=\"_blank\"");
    expect(module).toContain("formatDisplayText");
    expect(module).toContain("signalIcon");
    expect(module.indexOf("await sectionRefresh;")).toBeGreaterThan(
      module.indexOf("sectionRefresh = refreshWorkspaceSections"),
    );
    expect(module.indexOf("const snapshot = await fetchDevNexusDashboard")).toBeGreaterThan(
      module.indexOf("await sectionRefresh;"),
    );
  });

  it("keeps visible dashboard content stable during background refresh", () => {
    const module = renderNexusDashboardClientModule();

    expect(module).toContain("lastRenderSignature");
    expect(module).toContain("dashboardRenderSignature");
    expect(module).toContain("stripVolatileDashboardFields");
    expect(module).toContain("if (signature && signature === lastRenderSignature) return;");
    expect(module).toContain("const hasVisibleData = selectedWorkspaceId ? Boolean(latestSnapshot) : Boolean(latestHost);");
    expect(module).toContain("if (!hasVisibleData) {");
    expect(module).toContain("latestSnapshot = null;");
    expect(module).not.toContain("catch (error) {\n      latestSnapshot = null;");
    expect(module).not.toContain("catch {\n      latestHost = null;");
  });

  it("ignores refresh-clock activity timestamps in dashboard render signatures", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const firstSnapshot = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      events: [
        {
          id: "snapshot-generated",
          time: "2026-05-21T10:00:00.000Z",
          title: "Snapshot refreshed",
        },
        {
          id: "automation-status",
          time: "2026-05-21T10:00:00.000Z",
          title: "Automation blocked",
        },
        {
          id: "worktree-lease-1",
          time: "2026-05-21T09:45:00.000Z",
          title: "Worktree working",
        },
      ],
    };
    const secondSnapshot = {
      ...firstSnapshot,
      generatedAt: "2026-05-21T10:00:15.000Z",
      events: [
        {
          id: "snapshot-generated",
          time: "2026-05-21T10:00:15.000Z",
          title: "Snapshot refreshed",
        },
        {
          id: "automation-status",
          time: "2026-05-21T10:00:15.000Z",
          title: "Automation blocked",
        },
        {
          id: "worktree-lease-1",
          time: "2026-05-21T09:45:00.000Z",
          title: "Worktree working",
        },
      ],
    };
    const actualWorkChange = {
      ...secondSnapshot,
      events: [
        ...secondSnapshot.events.slice(0, 2),
        {
          id: "worktree-lease-1",
          time: "2026-05-21T10:00:10.000Z",
          title: "Worktree working",
        },
      ],
    };

    expect(hooks.dashboardRenderSignature(firstSnapshot)).toBe(
      hooks.dashboardRenderSignature(secondSnapshot),
    );
    expect(hooks.dashboardRenderSignature(secondSnapshot)).not.toBe(
      hooks.dashboardRenderSignature(actualWorkChange),
    );
  });

  it("audits static visual guardrails for light and dark cockpit modes", () => {
    const audit = auditNexusDashboardClientVisuals();

    expect(audit.ok).toBe(true);
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "theme-modes", status: "passed" }),
        expect.objectContaining({ id: "signal-accents", status: "passed" }),
        expect.objectContaining({ id: "branch-accents", status: "passed" }),
        expect.objectContaining({ id: "host-smart-cards", status: "passed" }),
        expect.objectContaining({ id: "text-fitting", status: "passed" }),
        expect.objectContaining({ id: "neutral-surfaces", status: "passed" }),
        expect.objectContaining({ id: "lane-labels", status: "passed" }),
        expect.objectContaining({ id: "selected-details", status: "passed" }),
        expect.objectContaining({ id: "action-buttons", status: "passed" }),
        expect.objectContaining({ id: "plugin-cards", status: "passed" }),
        expect.objectContaining({ id: "tracked-work", status: "passed" }),
        expect.objectContaining({ id: "responsive-layout", status: "passed" }),
      ]),
    );
    expect(audit.limitations).toEqual(
      expect.arrayContaining([
        "Pixel screenshots still require a browser renderer and human review.",
      ]),
    );
  });

  it("labels parallel work-map lanes without repeating branch names as row titles", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      project: {
        defaultBranch: "main",
        name: "Dashboard Demo",
        root: "/tmp/dashboard-demo",
      },
      weave: {
        nodes: [
          {
            id: "branch:main",
            kind: "branch",
            label: "main",
            detail: "origin/main",
            status: "clean",
            timestamp: null,
          },
          {
            id: "worktree:alpha",
            kind: "worktree",
            label: "codex/dev-nexus/alpha-branch",
            detail: "working on Mac.lan",
            status: "working",
            timestamp: "2026-05-21T10:00:00.000Z",
          },
          {
            id: "worktree:beta",
            kind: "worktree",
            label: "codex/dev-nexus/beta-branch",
            detail: "working on Mac.lan",
            status: "working",
            timestamp: "2026-05-21T09:00:00.000Z",
          },
          {
            id: "worktree:gamma",
            kind: "worktree",
            label: "codex/dev-nexus/gamma-branch",
            detail: "working on Mac.lan",
            status: "working",
            timestamp: "2026-05-21T08:00:00.000Z",
          },
          {
            id: "target-cycle:cycle-1",
            kind: "target-cycle",
            label: "cycle-1",
            detail: "Completed provider links.",
            status: "completed",
            timestamp: "2026-05-21T07:00:00.000Z",
          },
          {
            id: "authority",
            kind: "authority",
            label: "Approval",
            detail: "One provider action needs approval.",
            status: "blocked",
            timestamp: null,
          },
        ],
      },
      worktrees: {
        records: [
          {
            id: "alpha",
            branchName: "codex/dev-nexus/alpha-branch",
            componentId: "dev-nexus",
            workItemId: "github-114",
            hostId: "Mac.lan",
            updatedAt: "2026-05-21T10:00:00.000Z",
          },
          {
            id: "beta",
            branchName: "codex/dev-nexus/beta-branch",
            componentId: "dev-nexus",
            workItemId: "github-115",
            hostId: "Mac.lan",
            updatedAt: "2026-05-21T09:00:00.000Z",
          },
          {
            id: "gamma",
            branchName: "codex/dev-nexus/gamma-branch",
            componentId: "dev-nexus",
            workItemId: "github-116",
            hostId: "Mac.lan",
            updatedAt: "2026-05-21T08:00:00.000Z",
          },
        ],
      },
    };

    const lanes = hooks.timelineLanes(snapshot);
    expect(lanes.map((lane) => [lane.label, lane.detail])).toEqual([
      ["Source checkout", "main component heads"],
      ["Active branch", "dev-nexus/alpha-branch"],
      ["Active branch", "dev-nexus/beta-branch"],
      ["More branches", "1 grouped branch"],
      ["Automation", "Runs and target cycles"],
      ["Decisions", "Approvals and blockers"],
    ]);

    const laneKey = hooks.renderLaneKey(lanes);
    expect(laneKey).toContain("<strong>Active branch</strong>");
    expect(laneKey).toContain("dev-nexus/alpha-branch");
    expect(laneKey).toContain("Approvals and blockers");

    const timeline = hooks.historyRows(snapshot);
    const alphaRow = timeline.rows.find((row) => row.node.id === "worktree:alpha");
    const gammaRow = timeline.rows.find((row) => row.node.id === "worktree:gamma");
    expect(alphaRow).toMatchObject({
      title: "github-114",
      lane: 1,
    });
    expect(alphaRow?.title).not.toContain("alpha-branch");
    expect(alphaRow?.detail).toContain("dev-nexus/alpha-branch");
    expect(gammaRow).toMatchObject({
      title: "dev-nexus/gamma-branch",
      lane: 3,
    });

    const graph = hooks.renderBranchGraph(timeline.rows, timeline.lanes);
    expect(graph).toContain(" H 118");
    expect(graph).not.toContain(" C ");
  });

  it("renders active features as the primary project workflow surface", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      features: {
        activeCount: 1,
        needsAttentionCount: 0,
        records: [
          {
            id: "feature:primary:codex-goals",
            title: "codex-goals",
            featureId: "codex-goals",
            componentIds: ["primary"],
            componentNames: ["DevNexus"],
            releaseTrainVersionId: "v-next",
            branchStrategy: "hybrid",
            status: "active",
            statusLabel: "Active",
            tone: "active",
            detail: "hybrid branch strategy, feature branch feat/codex-goals, 2 branches, 2 threads, targeting main.",
            featureBranch: "feat/codex-goals",
            reviewBranchPattern: "feat/codex-goals/{change}",
            defaultChangeBaseBranch: "feat/codex-goals",
            finalReviewTarget: "main",
            finalPublicationTarget: "main",
            reviewMode: "review_branch_pr",
            finalPullRequestCreation: "at_review_gate",
            commentPolicy: "status_only",
            threadCount: 2,
            activeThreadCount: 2,
            needsDecisionCount: 0,
            branchCount: 2,
            branches: ["feat/codex-goals", "feat/codex-goals/header-card"],
            updatedAt: "2026-05-23T09:00:00.000Z",
            warnings: [],
          },
        ],
      },
      events: [],
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderFeatureOverview(
      snapshot,
      "feature:primary:codex-goals",
    );
    const detail = hooks.selectedDetail(snapshot, "feature:primary:codex-goals");

    expect(rendered).toContain("Active Features");
    expect(rendered).toContain("codex-goals");
    expect(rendered).toContain("hybrid");
    expect(rendered).toContain("feat/codex-goals");
    expect(rendered).toContain("2 branches");
    expect(rendered).toContain("data-select-id=\"feature:primary:codex-goals\"");
    expect(detail).toMatchObject({
      title: "codex-goals",
      facts: expect.arrayContaining([
        ["Type", "feature"],
        ["Branch strategy", "hybrid"],
        ["Feature branch", "feat/codex-goals"],
        ["Target branch", "main"],
      ]),
    });
  });

  it("renders project git history as a graph with selectable commits", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        totalCommitCount: 3,
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/cockpit-graph"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main10000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature graph",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "merge000000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["main00000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Add graph data",
                refs: [
                  {
                    name: "feat/cockpit-graph",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main10000000000000000000000000000000000000",
                shortHash: "main100",
                parents: ["main00000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Prepare base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      events: [],
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);
    const rendered = hooks.renderGitHistory(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    );
    const detail = hooks.selectedDetail(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    );

    expect(rows?.rows).toHaveLength(3);
    expect(rows?.paths.some((path) => path.fromLane !== path.toLane)).toBe(true);
    expect(rendered).toContain("Project History");
    expect(rendered).toContain("<svg");
    expect(rendered).toContain("feat/cockpit-graph");
    expect(rendered).toContain("Add graph data");
    expect(rendered).toContain("data-select-id=\"history:primary:feature000000000000000000000000000000000000\"");
    expect(detail).toMatchObject({
      title: "Add graph data",
      facts: expect.arrayContaining([
        ["Type", "commit"],
        ["Component", "DevNexus"],
        ["Commit", "feature"],
        ["Parents", "1"],
      ]),
    });
  });

  it("routes cross-lane git graph links through row corridors", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/corridor"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main20000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature branch",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "merge000000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main20000000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main10000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Main corridor step",
                refs: [],
              },
              {
                hash: "main10000000000000000000000000000000000000",
                shortHash: "main100",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:56:00.000Z",
                subject: "Main base step",
                refs: [],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Feature branch step",
                refs: [
                  {
                    name: "feat/corridor",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "base0000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderGitHistory(snapshot);
    const graph = hooks.gitHistoryRows(snapshot);
    const delayedCrossLanePaths = graph?.paths.filter(
      (path) => {
        if (path.fromLane === path.toLane) return false;
        const points = path.points ?? [];
        const firstCrossLanePoint = points.find((point) => point.lane !== path.fromLane);
        return firstCrossLanePoint
          ? Math.abs(firstCrossLanePoint.index - (path.fromIndex ?? 0)) > 1.5
          : false;
      },
    );

    expect(rendered).toContain("dn-git-line-shadow");
    expect(rendered).toContain("V 28.5");
    expect(rendered).toContain("V 105");
    expect(rendered).not.toContain("H 50 V 105");
    expect(rendered).not.toMatch(/M 28 15 C .*50 .*105/);
    expect(delayedCrossLanePaths).toEqual([]);
  });

  it("anchors fractional git graph connector endpoints on routed lanes", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/corridor"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main20000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature branch",
                refs: [],
              },
              {
                hash: "main20000000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main10000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Main corridor step",
                refs: [],
              },
              {
                hash: "main10000000000000000000000000000000000000",
                shortHash: "main100",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:56:00.000Z",
                subject: "Main base step",
                refs: [],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Feature branch step",
                refs: [],
              },
              {
                hash: "base0000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Base",
                refs: [],
              },
            ],
          },
        ],
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const graph = hooks.gitHistoryRows(snapshot);
    const allPoints =
      graph?.paths.flatMap((path) => path.points ?? []) ?? [];
    const fractionalEndpoints =
      graph?.paths.flatMap((path) => {
        const points = path.points ?? [];
        const last = points.at(-1);
        return last && !Number.isInteger(last.index) ? [last] : [];
      }) ?? [];

    expect(graph?.paths.length).toBeGreaterThan(0);
    expect(fractionalEndpoints.length).toBeGreaterThan(0);
    for (const endpoint of fractionalEndpoints) {
      const matches = allPoints.filter(
        (point) => point.lane === endpoint.lane && point.index === endpoint.index,
      );
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("reuses git graph lanes for side branches with separate lifetimes", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "mergeB0000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/a", "feat/b"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "mergeB0000000000000000000000000000000000",
                shortHash: "mergeB0",
                parents: [
                  "main300000000000000000000000000000000000",
                  "sideB00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge second side branch",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "mergeB0000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "sideB00000000000000000000000000000000000",
                shortHash: "sideB00",
                parents: ["main300000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Second side branch work",
                refs: [
                  {
                    name: "feat/b",
                    kind: "branch",
                    remote: null,
                    hash: "sideB00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main300000000000000000000000000000000000",
                shortHash: "main300",
                parents: ["mergeA0000000000000000000000000000000000"],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:56:00.000Z",
                subject: "Main after first merge",
                refs: [],
              },
              {
                hash: "mergeA0000000000000000000000000000000000",
                shortHash: "mergeA0",
                parents: [
                  "main200000000000000000000000000000000000",
                  "sideA00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:54:00.000Z",
                subject: "Merge first side branch",
                refs: [],
              },
              {
                hash: "sideA00000000000000000000000000000000000",
                shortHash: "sideA00",
                parents: ["main200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:52:00.000Z",
                subject: "First side branch work",
                refs: [
                  {
                    name: "feat/a",
                    kind: "branch",
                    remote: null,
                    hash: "sideA00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main200000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main100000000000000000000000000000000000"],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Shared base",
                refs: [],
              },
              {
                hash: "main100000000000000000000000000000000000",
                shortHash: "main100",
                parents: [],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:45:00.000Z",
                subject: "Root",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);
    const sideA = rows?.rows.find((row) => row.commit.hash.startsWith("sideA"));
    const sideB = rows?.rows.find((row) => row.commit.hash.startsWith("sideB"));

    expect(sideA?.lane).toBe(1);
    expect(sideB?.lane).toBe(1);
    expect(rows?.maxLane).toBe(1);
  });

  it("compacts git graph lanes after side branches rejoin active history", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "top0000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/a", "feat/b"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "top0000000000000000000000000000000000000",
                shortHash: "top0000",
                parents: [
                  "main300000000000000000000000000000000000",
                  "sideA00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge first side branch",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "top0000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main300000000000000000000000000000000000",
                shortHash: "main300",
                parents: [
                  "main200000000000000000000000000000000000",
                  "sideB00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Merge second side branch",
                refs: [],
              },
              {
                hash: "sideA00000000000000000000000000000000000",
                shortHash: "sideA00",
                parents: ["main200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:57:00.000Z",
                subject: "First side branch work",
                refs: [
                  {
                    name: "feat/a",
                    kind: "branch",
                    remote: null,
                    hash: "sideA00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "sideB00000000000000000000000000000000000",
                shortHash: "sideB00",
                parents: ["main200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Second side branch work",
                refs: [
                  {
                    name: "feat/b",
                    kind: "branch",
                    remote: null,
                    hash: "sideB00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main200000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main100000000000000000000000000000000000"],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Shared base",
                refs: [],
              },
              {
                hash: "main100000000000000000000000000000000000",
                shortHash: "main100",
                parents: [],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:45:00.000Z",
                subject: "Root",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);
    const sideB = rows?.rows.find((row) => row.commit.hash.startsWith("sideB"));

    expect(sideB?.lane).toBe(1);
    expect(Math.max(...(rows?.rows.map((row) => row.lane) ?? []))).toBe(1);
    expect(rows?.maxLane).toBe(2);
    expect(rows?.paths.some((path) => path.points?.some((point) => point.lane > 2))).toBe(false);
  });

  it("keeps every loaded git history row visible in the graph", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const commits = Array.from({ length: 82 }, (_, index) => {
      const hash = `commit${String(index).padStart(34, "0")}`;
      const parent =
        index + 1 < 82 ? `commit${String(index + 1).padStart(34, "0")}` : null;
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parent ? [parent] : [],
        authorName: "Codex",
        authorEmail: "codex@example.com",
        committedAt: "2026-05-23T12:00:00.000Z",
        subject: `Commit ${index}`,
        refs:
          index === 0
            ? [
                {
                  name: "main",
                  kind: "branch",
                  remote: null,
                  hash,
                },
              ]
            : [],
      };
    });
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: commits[0].hash,
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main"],
            tagNames: [],
            moreAvailable: true,
            warnings: [],
            commits,
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);

    expect(rows?.rows).toHaveLength(82);
  });

  it("renders git graph svg at the same height as its commit rows", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "head000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "head000000000000000000000000000000000000",
                shortHash: "head000",
                parents: ["step200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Head",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "head000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "step200000000000000000000000000000000000",
                shortHash: "step200",
                parents: ["step100000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Step 2",
                refs: [],
              },
              {
                hash: "step100000000000000000000000000000000000",
                shortHash: "step100",
                parents: ["base000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Step 1",
                refs: [],
              },
              {
                hash: "base000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:45:00.000Z",
                subject: "Base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderGitHistory(snapshot);

    expect(rendered).toContain('width="148"');
    expect(rendered).toContain('height="120"');
    expect(rendered).toContain('viewBox="0 0 148 120"');
  });

  it("filters project git history by branch head ancestors", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      features: {
        records: [
          {
            id: "feature:primary:feat-cockpit-graph",
            title: "Cockpit graph",
            featureBranch: "feat/cockpit-graph",
          },
        ],
      },
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/cockpit-graph", "feat/other-work"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main10000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature graph",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "merge000000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Add graph data",
                refs: [
                  {
                    name: "feat/cockpit-graph",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "other0000000000000000000000000000000000000",
                shortHash: "other00",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:53:00.000Z",
                subject: "Other feature work",
                refs: [
                  {
                    name: "feat/other-work",
                    kind: "branch",
                    remote: null,
                    hash: "other0000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "base0000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Prepare base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot, "branch:feat/cockpit-graph");
    const rendered = hooks.renderGitHistory(snapshot, null, "branch:feat/cockpit-graph");

    expect(rows?.rows.map((row) => row.commit.hash)).toEqual([
      "feature000000000000000000000000000000000000",
      "base0000000000000000000000000000000000000",
    ]);
    expect(rendered).toContain("data-git-history-filter=\"branch:feat/cockpit-graph\"");
    expect(rendered).toContain("aria-pressed=\"true\"");
    expect(rendered).toContain("Add graph data");
    expect(rendered).toContain("Prepare base");
    expect(rendered).not.toContain("Merge feature graph");
    expect(rendered).not.toContain("Other feature work");
  });

  it("annotates git history with feature status and provider actions", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const action = {
      label: "Open issue #42",
      href: "https://github.com/Evref-BL/DevNexus/issues/42",
      provider: "github",
      kind: "issue",
      title: "Review cockpit graph",
    };
    const snapshot = {
      features: {
        records: [
          {
            id: "feature:primary:feat-cockpit-graph",
            title: "Cockpit graph",
            status: "needs-review",
            statusLabel: "Needs review",
            featureBranch: "feat/cockpit-graph",
            branches: ["feat/cockpit-graph"],
          },
        ],
      },
      threads: {
        records: [
          {
            id: "thread-1",
            title: "Review graph UX",
            componentId: "primary",
            workItemId: "github-42",
            branchName: "feat/cockpit-graph",
            hostId: "Mac.lan",
            decision: "review",
            decisionLabel: "Review",
            decisionDetail: "Human review is needed.",
            updatedAt: "2026-05-23T12:00:00.000Z",
            actions: [action],
          },
        ],
      },
      trackedWork: {
        records: [],
      },
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "feature000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/cockpit-graph"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Add graph annotations",
                refs: [
                  {
                    name: "feat/cockpit-graph",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderGitHistory(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    );
    const detail = hooks.selectedDetail(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    ) as {
      actions: Array<{ href: string }>;
      facts: Array<[string, string]>;
    };

    expect(rendered).toContain("Needs review");
    expect(rendered).toContain("1 thread");
    expect(detail.facts).toEqual(
      expect.arrayContaining([
        ["Feature", "Cockpit graph"],
        ["Threads", "1"],
      ]),
    );
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
  });

  it("renders compact provider chips with provider and external-link affordances", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderActionStrip([
      {
        label: "Open issue #42",
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
        provider: "github",
        kind: "issue",
        title: null,
      },
      {
        label: "PR #66: provider links",
        href: "https://github.com/Evref-BL/DevNexus/pull/66",
        provider: "github",
        kind: "pull-request",
        title: "provider links",
      },
    ]);

    expect(html).toContain("provider-github kind-issue");
    expect(html).toContain("provider-github kind-pull-request");
    expect(html).toContain('<span class="dn-action-label">#42</span>');
    expect(html).toContain('<span class="dn-action-label">PR #66: provider links</span>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
    expect(html).toContain("M9 2h5v5");
  });

  it("renders tracked work as compact issue cards", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const snapshot = {
      trackedWork: {
        readyCount: 1,
        importCandidateCount: 1,
        staleCount: 0,
        excludedCount: 0,
        records: [
          {
            id: "github-42",
            title: "Add cockpit issue lane",
            componentId: "dev-nexus",
            componentName: "DevNexus",
            status: "ready",
            kind: "ready",
            kindLabel: "ready",
            detail: "Ready for automation or a human to pick up.",
            provider: "github",
            trackerId: "github",
            updatedAt: "2026-05-21T10:00:00.000Z",
            actions: [
              {
                label: "#42: cockpit issue lane",
                href: "https://github.com/Evref-BL/DevNexus/issues/42",
                provider: "github",
                kind: "issue",
                title: "cockpit issue lane",
              },
            ],
          },
        ],
      },
    };
    const html = hooks.renderTrackedWork(snapshot, "tracked-work:dev-nexus:github-42");

    expect(html).toContain("Issues and Work Items");
    expect(html).toContain("1 ready item · 1 import candidate · 0 stale items");
    expect(html).toContain("Add cockpit issue lane");
    expect(html).toContain("kind-ready");
    expect(html).toContain("selected");
    expect(html).toContain('data-select-id="tracked-work:dev-nexus:github-42"');
    expect(html).toContain("provider-github kind-issue");
    expect(html).toContain("#42: cockpit issue lane");

    const detail = hooks.selectedDetail({
      ...snapshot,
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      events: [],
      weave: {
        nodes: [],
      },
    }, "tracked-work:dev-nexus:github-42");
    expect(detail.title).toBe("Add cockpit issue lane");
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
    expect(detail.chat).toMatchObject({
      targetId: "tracked-work:dev-nexus:github-42",
      title: "Continue Add cockpit issue lane",
    });
    expect(detail.chat?.prompt).toContain("Continue cockpit item: Add cockpit issue lane.");
  });

  it("surfaces related issue and PR actions from selected feature details", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      events: [],
      weave: {
        nodes: [],
      },
      features: {
        records: [
          {
            id: "feature:cockpit-graph",
            title: "Cockpit graph",
            status: "needs-review",
            statusLabel: "Needs review",
            branchStrategy: "feature branch",
            featureBranch: "codex/dev-nexus/dashboard-cockpit-kit",
            branches: ["codex/dev-nexus/dashboard-cockpit-kit"],
            reviewBranchPattern: "codex/dev-nexus/dashboard-*",
            finalPublicationTarget: "main",
            detail: "Feature needs review before publication.",
          },
        ],
      },
      threads: {
        records: [
          {
            id: "thread-graph",
            branchName: "codex/dev-nexus/dashboard-cockpit-kit",
            actions: [
              {
                label: "Open PR #263",
                href: "https://github.com/Evref-BL/DevNexus/pull/263",
                provider: "github",
                kind: "pull-request",
                title: "dashboard graph",
              },
            ],
          },
        ],
      },
      trackedWork: {
        records: [
          {
            id: "github-42",
            logicalItemId: null,
            title: "dashboard-cockpit-kit issue follow-up",
            detail: "Review the dashboard-cockpit-kit provider action.",
            webUrl: "https://github.com/Evref-BL/DevNexus/issues/42",
            actions: [
              {
                label: "Open issue #42",
                href: "https://github.com/Evref-BL/DevNexus/issues/42",
                provider: "github",
                kind: "issue",
                title: "provider action",
              },
            ],
          },
        ],
      },
    };

    const detail = hooks.selectedDetail(snapshot, "feature:cockpit-graph");

    expect(detail.title).toBe("Cockpit graph");
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/pull/263",
      }),
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
    expect(detail.chat).toMatchObject({
      targetId: "feature:cockpit-graph",
      title: "Continue Cockpit graph",
    });
  });

  it("routes signal cards to the relevant cockpit section", async () => {
    const hooks = await loadDashboardClientTestHooks();

    expect(hooks.signalPanelTarget("components")).toBe("components-panel");
    expect(hooks.signalPanelTarget("eligible-work")).toBe("tracked-work-panel");
    expect(hooks.signalPanelTarget("worktrees")).toBe("hitl-queue");
    expect(hooks.signalPanelTarget("blockers")).toBe("blockers-panel");
    expect(hooks.signalPanelTarget("plugins")).toBe("plugins-panel");

    const html = hooks.renderSignal({
      id: "eligible-work",
      label: "Tracked work",
      value: "2",
      detail: "Ready issues",
    }, "signal:eligible-work");

    expect(html).toContain('data-select-id="signal:eligible-work"');
    expect(html).toContain('data-scroll-target="tracked-work-panel"');
    expect(html).toContain("selected");
  });

  it("uses singular nouns for one-count cockpit labels", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const hostHtml = hooks.renderHostOverview({
      partial: false,
      workspaceCount: 1,
      needsAttentionCount: 1,
      workspaces: [
        {
          id: "workspace-one",
          name: "Workspace One",
          root: "/tmp/workspace-one",
          registered: true,
          current: false,
          loading: false,
          tone: "active",
          summary: "Workspace has one plugin.",
          componentCount: 1,
          needsDecisionCount: 1,
          threadCount: 1,
          pluginCount: 1,
          blockerCount: 0,
          automationStatus: "idle",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
      ],
    }, null, "", { hostMode: false });

    expect(hostHtml).toContain("1 needs attention · 1 workspace");
    expect(hostHtml).toContain("1 component");
    expect(hostHtml).toContain("1 active HITL");
    expect(hostHtml).toContain("1 active thread");
    expect(hostHtml).toContain("1 plugin");
    expect(hostHtml).not.toContain("1 components");
    expect(hostHtml).not.toContain("1 active threads");
    expect(hostHtml).not.toContain("1 plugins");

    const pluginHtml = hooks.renderPlugins({
      enabledCount: 1,
      availableCount: 1,
      capabilityCount: 1,
      records: [],
    });

    expect(pluginHtml).toContain("1 enabled plugin · 1 available plugin · 1 capability");
    expect(pluginHtml).not.toContain("1 enabled plugins");
    expect(pluginHtml).not.toContain("1 available plugins");
    expect(pluginHtml).not.toContain("1 capabilities");
  });

  it("does not badge registered workspace cards and highlights the current workspace", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const hostHtml = hooks.renderHostOverview({
      partial: false,
      workspaceCount: 2,
      needsAttentionCount: 0,
      workspaces: [
        {
          id: "registered-workspace",
          name: "Registered Workspace",
          root: "/tmp/registered-workspace",
          registered: true,
          current: false,
          loading: false,
          tone: "good",
          summary: "Registered workspace is clear.",
          componentCount: 2,
          needsDecisionCount: 0,
          threadCount: 0,
          pluginCount: 1,
          blockerCount: 0,
          automationStatus: "idle",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
        {
          id: "current-workspace",
          name: "Current Workspace",
          root: "/tmp/current-workspace",
          registered: true,
          current: true,
          loading: false,
          tone: "active",
          summary: "Current workspace is selected.",
          componentCount: 1,
          needsDecisionCount: 1,
          threadCount: 1,
          pluginCount: 1,
          blockerCount: 0,
          automationStatus: "idle",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
      ],
    }, null, "current-workspace", { hostMode: false });

    expect(hostHtml).not.toContain(">registered<");
    expect(hostHtml).toContain("dn-workspace-card current-workspace");
    expect(hostHtml).toContain("dn-workspace-current-badge");
    expect(hostHtml).toContain(">current<");
    expect(hostHtml).not.toContain("decision-rescue\">registered");
    expect(hostHtml).not.toContain("decision-continue\">registered");
  });

  it("renders a compact host header with colocated path actions and host identity", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderHostDashboard({
      version: 1,
      generatedAt: "2026-05-23T08:15:00.000Z",
      hostId: "Mac.lan",
      homePath: "/Users/gabriel.darbord/.dev-nexus",
      workspaceCount: 1,
      needsAttentionCount: 0,
      partial: false,
      actionQueue: [],
      workspaces: [],
    }, "dark");

    expect(html).toContain("dn-host-identity");
    expect(html).toContain("Mac.lan");
    expect(html).toContain("dn-header-path-menu");
    expect(html).toContain("dn-header-path-control");
    expect(html).toContain("dn-header-path-value");
    expect(html).toContain("dn-app-icon-img");
    expect(html).toContain("dn-app-icon-finder");
    expect(html).toContain("/api/local/app-icon?app=file");
    expect(html).toContain("/Users/gabriel.darbord/.dev-nexus");
    expect(html).toContain('data-open-target="home"');
    expect(html).toContain("dn-header-stamp");
    expect(html).toContain("Generated");
    expect(html).not.toContain('class="dn-meta"');
    expect(html).not.toContain("dn-header-path-row");
    expect(html.indexOf("dn-header-path-value")).toBeLessThan(
      html.indexOf("data-open-target=\"home\""),
    );
  });

  it("renders workspace headers with the compact project path controls", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderProjectHeaderActions({
      generatedAt: "2026-05-23T09:15:00.000Z",
      project: {
        name: "DevNexus PLexus",
        root: "/Users/gabriel.darbord/dev-nexus/dev-nexus-plexus",
      },
    }, "dark", "dev-nexus-plexus");

    expect(html).toContain("dn-project-header-actions");
    expect(html).toContain("Host cockpit");
    expect(html).toContain("dn-header-strip");
    expect(html).toContain("dn-header-stamp");
    expect(html).toContain("Generated");
    expect(html).toContain("dn-header-path-menu");
    expect(html).toContain("dn-header-path-control");
    expect(html).toContain("dn-header-path-value");
    expect(html).toContain("dn-app-icon-finder");
    expect(html).toContain("/api/local/app-icon?app=file");
    expect(html).toContain("Project");
    expect(html).toContain("/Users/gabriel.darbord/dev-nexus/dev-nexus-plexus");
    expect(html).toContain('data-open-target="project"');
    expect(html).not.toContain('class="dn-meta"');
    expect(html).not.toContain("Root</span>");
  });

  it("keeps host workspaces above the action queue like project pages", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderHostDashboard({
      version: 1,
      generatedAt: "2026-05-23T08:15:00.000Z",
      hostId: "Mac.lan",
      homePath: "/Users/gabriel.darbord/.dev-nexus",
      workspaceCount: 1,
      needsAttentionCount: 1,
      partial: false,
      actionQueue: [],
      workspaces: [
        {
          id: "dev-nexus-dogfood",
          name: "DevNexus Dogfood",
          root: "/Users/gabriel.darbord/dev-nexus/dev-nexus-dogfood",
          registered: true,
          current: true,
          loading: false,
          tone: "danger",
          summary: "Workspace needs attention.",
          componentCount: 5,
          needsDecisionCount: 1,
          threadCount: 2,
          pluginCount: 1,
          blockerCount: 1,
          automationStatus: "blocked",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
      ],
    }, "dark");

    expect(html).toContain('id="host-workspaces"');
    expect(html).toContain('aria-label="Host signals"');
    expect(html).toContain('id="host-action-queue"');
    expect(html).not.toContain("dn-host-main-grid");
    expect(html).not.toContain("dn-host-sticky-panel");
    expect(html.indexOf('id="host-workspaces"')).toBeLessThan(
      html.indexOf('aria-label="Host signals"'),
    );
    expect(html.indexOf('aria-label="Host signals"')).toBeLessThan(
      html.indexOf('id="host-action-queue"'),
    );
  });

  it("makes HITL threads selectable with the same chat actions as the queue", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      events: [],
      weave: {
        nodes: [],
      },
      threads: {
        records: [
          {
            id: "thread-1",
            title: "Review dashboard thread",
            decision: "archive",
            decisionLabel: "Archive",
            decisionDetail: "Useful notes, but not active work.",
            branchName: "codex/dev-nexus/dashboard-thread",
            componentId: "dev-nexus",
            hostId: "local",
            workItemId: "github-42",
            updatedAt: "2026-05-21T10:00:00.000Z",
            assistantThreadId: "codex-thread-1",
            actions: [
              {
                label: "Open issue #42",
                href: "https://github.com/Evref-BL/DevNexus/issues/42",
                provider: "github",
                kind: "issue",
                title: "Dashboard thread",
              },
            ],
          },
        ],
        needsDecisionCount: 1,
        incomplete: false,
      },
    };

    const html = hooks.renderThreadInbox(snapshot, "thread:thread-1");
    expect(html).toContain('id="hitl-queue"');
    expect(html).toContain('data-select-id="thread:thread-1"');
    expect(html).toContain('data-scroll-target="selected-item"');
    expect(html).toContain("selected");
    expect(html).toContain("Resume chat");

    const detail = hooks.selectedDetail(snapshot, "thread:thread-1");
    expect(detail.title).toBe("Review dashboard thread");
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
    expect(detail.chat).toMatchObject({
      resumeThreadId: "codex-thread-1",
      targetId: "thread:thread-1",
      title: "Continue Review dashboard thread",
    });
  });

  it("renders compact next-action labels for HITL thread decisions", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      events: [],
      weave: {
        nodes: [],
      },
      threads: {
        records: [
          {
            id: "archive-thread",
            title: "Archive completed notes",
            decision: "archive",
            decisionLabel: "Archive",
            decisionDetail: "Notes were captured elsewhere.",
            updatedAt: "2026-05-21T10:00:00.000Z",
          },
          {
            id: "rescue-thread",
            title: "Rescue local branch",
            decision: "rescue",
            decisionLabel: "Rescue",
            decisionDetail: "Local changes need inspection.",
            updatedAt: "2026-05-21T09:00:00.000Z",
          },
          {
            id: "blocked-thread",
            title: "Resolve provider permission",
            decision: "blocked",
            decisionLabel: "Blocked",
            decisionDetail: "Provider approval is required.",
            updatedAt: "2026-05-21T08:00:00.000Z",
          },
        ],
        needsDecisionCount: 3,
        incomplete: false,
      },
    };

    const html = hooks.renderThreadInbox(snapshot, "thread:rescue-thread");

    expect(html).toContain("dn-thread-next");
    expect(html).toContain("Archive local record");
    expect(html).toContain("Inspect before cleanup");
    expect(html).toContain("Resolve blocker");
  });

  it("generates provider-neutral thread prompts without duplicate punctuation", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const prompt = hooks.cockpitThreadPrompt({
      title: "main.",
      decisionLabel: "Rescue",
      decisionDetail: "Local changes need inspection before this can be archived or forgotten.",
      branchName: "main",
      componentId: "dev-nexus",
      hostId: "local",
      workItemId: null,
    });

    expect(prompt).toContain("Continue cockpit thread: main.");
    expect(prompt).toContain(
      "Reason: Local changes need inspection before this can be archived or forgotten.",
    );
    expect(prompt).not.toContain("..");
    expect(prompt).not.toContain("Codex");
  });

  it("renders approved local thread cleanup actions", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderThreadActions({
      id: "thread-archive",
      title: "Archive old branch",
      decision: "archive",
      decisionLabel: "Archive",
      decisionDetail: "Done enough to archive.",
      assistantThreadId: null,
      actions: [],
    });

    expect(html).toContain("Archive");
    expect(html).toContain('data-thread-action="archive"');
    expect(html).toContain('data-thread-id="thread-archive"');
    expect(html).toContain("Start chat");
    expect(html).toContain("Copy prompt");
    expect(html).not.toContain("Needs archive policy");
  });

  it("renders plugin cards with policy-gated setup actions", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderPlugins({
      totalCount: 2,
      enabledCount: 1,
      capabilityCount: 4,
      records: [
        {
          id: "dev-nexus-typescript",
          name: "DevNexus TypeScript",
          version: "0.1.0-test",
          enabled: true,
          capabilityCount: 2,
          projectedSkillCount: 1,
          mcpServerCount: 1,
          setupActionCount: 0,
          dependencyProjectionCount: 0,
          projectedSkills: ["typescript-diagnose"],
          mcpServers: ["dev-nexus-typescript"],
          setupHints: [],
          dependencyHints: [],
        },
        {
          id: "dev-nexus-research",
          name: "DevNexus Research",
          version: null,
          enabled: false,
          capabilityCount: 2,
          projectedSkillCount: 0,
          mcpServerCount: 0,
          setupActionCount: 1,
          dependencyProjectionCount: 1,
          projectedSkills: [],
          mcpServers: [],
          setupHints: ["Prepare research corpus"],
          dependencyHints: ["node_modules -> node_modules"],
        },
      ],
    });

    expect(html).toContain("1 enabled plugin · 1 disabled plugin · 4 capabilities");
    expect(html).toContain("Skill: typescript-diagnose");
    expect(html).toContain("MCP: dev-nexus-typescript");
    expect(html).toContain("Setup: Prepare research corpus");
    expect(html).toContain("Deps: node_modules -&gt; node_modules");
    expect(html).toContain("Local plugin candidates copy a refresh command");
    expect(html).toContain("Enable unavailable");
    expect(html).toContain("Needs plugin enable policy");
    expect(html).toContain("dn-policy-action");
    expect(html).toContain("disabled");
    expect(html).not.toContain("data-install-plugin");
    expect(html).not.toContain("data-enable-plugin");
  });

  it("renders local plugin candidates with a copyable refresh command", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderPlugins({
      totalCount: 1,
      enabledCount: 0,
      configuredCount: 0,
      availableCount: 1,
      capabilityCount: 0,
      records: [
        {
          id: "dev-nexus-research",
          name: "DevNexus Research",
          version: "0.1.0-alpha.0",
          enabled: false,
          state: "available",
          source: "local",
          packageName: "@evref-bl/dev-nexus-research",
          sourcePath: "/tmp/project/source/plugins/dev-nexus-research",
          refreshCommand:
            "dev-nexus workspace plugin refresh '/tmp/project' --from '/tmp/project/source/plugins/dev-nexus-research'",
          capabilityCount: 0,
          projectedSkillCount: 0,
          mcpServerCount: 0,
          setupActionCount: 0,
          dependencyProjectionCount: 0,
          projectedSkills: [],
          mcpServers: [],
          setupHints: [],
          dependencyHints: [],
          detail: "Research workflow support for DevNexus.",
        },
      ],
    });

    expect(html).toContain("0 enabled plugins · 1 available plugin");
    expect(html).toContain("available");
    expect(html).toContain("@evref-bl/dev-nexus-research");
    expect(html).toContain("Research workflow support for DevNexus.");
    expect(html).toContain("Copy command");
    expect(html).toContain("data-copy-text=");
    expect(html).toContain("Copied command");
    expect(html).not.toContain("Enable unavailable");
    expect(html).not.toContain("data-install-plugin");
  });

  it("extracts GitHub provider actions from bare issue references", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-provider-actions-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-21T09:00:00.000Z"),
    });
    const item = await tracker.createWorkItem({
      projectRoot,
      title:
        "Review HTTPS://GITHUB.COM/Evref-BL/DevNexus/pull/66, then #42: provider routing",
      status: "ready",
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(
      snapshot.weave.nodes.find((node) => node.id === `work-item:primary-${item.id}`),
    ).toMatchObject({
      actions: [
        expect.objectContaining({
          label: "Open PR #66",
          href: "https://github.com/Evref-BL/DevNexus/pull/66",
          provider: "github",
          kind: "pull-request",
        }),
        expect.objectContaining({
          href: "https://github.com/Evref-BL/DevNexus/issues/42",
          provider: "github",
          kind: "issue",
        }),
      ],
    });
    expect(snapshot.trackedWork).toMatchObject({
      totalCount: 1,
      readyCount: 1,
      records: [
        expect.objectContaining({
          id: item.id,
          title:
            "Review HTTPS://GITHUB.COM/Evref-BL/DevNexus/pull/66, then #42: provider routing",
          kind: "ready",
          actions: [
            expect.objectContaining({
              label: "Open PR #66",
              href: "https://github.com/Evref-BL/DevNexus/pull/66",
            }),
            expect.objectContaining({
              href: "https://github.com/Evref-BL/DevNexus/issues/42",
            }),
          ],
        }),
      ],
    });
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
      const actionToken = html.match(
        /__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = "([^"]+)"/u,
      )?.[1];
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
            records: [
              expect.objectContaining({
                id: "configured-plugin",
                state: "enabled",
              }),
            ],
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
      const actionToken = html.match(
        /__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = "([^"]+)"/u,
      )?.[1];
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
      const actionToken = html.match(
        /__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = "([^"]+)"/u,
      )?.[1];
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
