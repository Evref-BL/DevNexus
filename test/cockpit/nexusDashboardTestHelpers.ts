import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultNexusAutomationConfig,
  nexusWorktreeLeaseKind,
  renderNexusDashboardClientModule,
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

export function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

export function fixedClock(timestamp: string): () => string {
  return () => timestamp;
}

export function extractDashboardActionToken(html: string): string | undefined {
  return html.match(/actionToken:\s*"([^"]+)"/u)?.[1];
}

export async function loadDashboardClientTestHooks(): Promise<{
  cockpitTooltipText: (target: { getAttribute?: (name: string) => string | null }) => string;
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
  defaultSelectedId: (snapshot: unknown) => string;
  isCockpitTooltipTargetTruncated: (target: {
    clientHeight?: number;
    clientWidth?: number;
    scrollHeight?: number;
    scrollWidth?: number;
  }) => boolean;
  shouldShowCockpitTooltipTarget: (target: {
    clientHeight?: number;
    clientWidth?: number;
    getAttribute?: (name: string) => string | null;
    scrollHeight?: number;
    scrollWidth?: number;
  }) => boolean;
  nextDashboardSelectedId: (
    currentSelectedId: string | null,
    nextSelectedId: string | null,
  ) => string | null;
  historyRows: (snapshot: unknown) => {
    rows: Array<{ detail: string; lane: number; node: { id: string }; title: string }>;
    lanes: Array<{ detail?: string; index: number; label: string; shortLabel: string }>;
  };
  renderBranchGraph: (
    rows: Array<{ lane: number }>,
    lanes: Array<{ index: number }>,
  ) => string;
  renderFeatureOverview: (snapshot: unknown, selectedId?: string | null) => string;
  renderDashboard: (
    snapshot: unknown,
    themeMode?: string,
    selectedId?: string | null,
    host?: unknown,
    selectedWorkspaceId?: string,
    gitHistoryFilter?: string | null,
  ) => string;
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
  gitHistoryVisualGraph: (
    graph: {
      maxLane?: number;
      repository?: unknown;
      rows: Array<{ index: number; lane: number; selectId: string }>;
      paths?: Array<{
        fromIndex?: number;
        fromLane?: number;
        points?: Array<{ index: number; lane: number }>;
        toIndex?: number;
        toLane?: number;
      }>;
    },
    selectedId?: string | null,
  ) => {
    rows: Array<{ index: number; lane: number; selectId: string; selected?: boolean }>;
    paths: Array<{
      fromIndex?: number;
      fromLane?: number;
      points?: Array<{ index: number; lane: number }>;
      toIndex?: number;
      toLane?: number;
    }>;
  };
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
export { cockpitThreadPrompt, cockpitTooltipText, dashboardRenderSignature, defaultSelectedId, gitHistoryRows, gitHistoryVisualGraph, historyRows, isCockpitTooltipTargetTruncated, nextDashboardSelectedId, renderActionStrip, renderBranchGraph, renderDashboard, renderFeatureOverview, renderGitHistory, renderHostDashboard, renderHostOverview, renderLaneKey, renderPlugins, renderProjectHeaderActions, renderSignal, renderThreadActions, renderThreadInbox, renderTrackedWork, selectedDetail, shouldShowCockpitTooltipTarget, signalPanelTarget, timelineLanes };`;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

export function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
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

export function appServerAutomationConfig(): NonNullable<NexusProjectConfig["automation"]> {
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

export function fakeGitRunner(): GitRunner {
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

export function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

export function fail(args: string[], stderr: string): GitCommandResult {
  return {
    args,
    stdout: "",
    stderr,
    exitCode: 1,
  };
}

export function worktreeLease(
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

export function hostWorkspace(
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

export class MockCodexAppServerTransport implements CodexAppServerJsonRpcTransport {
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

export class RecordingCodexChatStarter implements NexusDashboardCodexChatStarter {
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

export function cleanupDashboardTestTempDirs(): void {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
