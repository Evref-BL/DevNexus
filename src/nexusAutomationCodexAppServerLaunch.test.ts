import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerJsonRpcClient,
  createLocalWorkTrackerProvider,
  createNexusAutomationCodexAppServerLauncher,
  defaultNexusAutomationConfig,
  readNexusAutomationRunLedger,
  runNexusAutomationAgentLaunchOnce,
  saveProjectConfig,
  type CodexAppServerJsonRpcRequest,
  type CodexAppServerJsonRpcResponse,
  type CodexAppServerJsonRpcTransport,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

class MockCodexAppServerTransport implements CodexAppServerJsonRpcTransport {
  readonly requests: CodexAppServerJsonRpcRequest[] = [];

  constructor(
    private readonly handler: (
      request: CodexAppServerJsonRpcRequest,
    ) => CodexAppServerJsonRpcResponse | Promise<CodexAppServerJsonRpcResponse>,
  ) {}

  async send(
    request: CodexAppServerJsonRpcRequest,
  ): Promise<CodexAppServerJsonRpcResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

function appServerProjectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "app-server-project",
    name: "App Server Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/app-server.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
    },
    mcp: {
      defaultToolsApprovalMode: "approve",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: [],
        limit: 5,
      },
      agent: {
        ...defaultNexusAutomationConfig.agent,
        command: null,
        timeoutMs: 120000,
        coordinatorProfileId: "codex-app-server",
        profiles: [
          {
            id: "codex-app-server",
            executor: "codex",
            executorMode: "app_server",
            model: "gpt-5.5",
            reasoning: "high",
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
              endpoint: "ws://127.0.0.1:18080",
              ephemeralThreadDefault: true,
              localPolicy: {
                allowNonLoopbackEndpoint: false,
                hostLocalSafetyHints: ["spawns_local_process"],
              },
            },
          },
        ],
      },
    },
    ...overrides,
  };
}

function initializeResult(request: CodexAppServerJsonRpcRequest): CodexAppServerJsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      capabilities: {
        methods: [
          "thread/start",
          "thread/fork",
          "turn/start",
          "turn/interrupt",
          "thread/read",
        ],
      },
    },
  };
}

function requestParams(
  transport: MockCodexAppServerTransport,
  method: string,
): Record<string, unknown> {
  const request = transport.requests.find((item) => item.method === method);
  expect(request).toBeDefined();
  expect(request!.params).toBeTypeOf("object");
  return request!.params as Record<string, unknown>;
}

async function createReadyWork(projectRoot: string): Promise<void> {
  await createLocalWorkTrackerProvider({
    projectRoot,
    now: fixedClock("2026-05-16T09:00:00.000Z"),
  }).createWorkItem({
    projectRoot,
    title: "App-server launch task",
    status: "ready",
    labels: ["automation"],
  });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation Codex app-server launch", () => {
  it("starts an ephemeral app-server thread and turn from the configured profile", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-launch-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/start") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { threadId: "thread-1" },
        };
      }
      if (request.method === "turn/start") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { turn: { id: "turn-1" } },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-run-1",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        cwd: (input) => input.sourceRoot,
        turnInput: "Handle local-1 using the DevNexus result contract.",
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      summary: "Codex app-server started thread thread-1 and turn turn-1",
      launch: {
        codexAppServer: {
          provider: "codex-app-server",
          status: "started",
          action: "thread_start",
          runId: "app-server-run-1",
          profileId: "codex-app-server",
          threadId: "thread-1",
          turnId: "turn-1",
          ephemeral: true,
          cwd: sourceRoot,
          model: "gpt-5.5",
          reasoning: "high",
          failureSummary: null,
        },
      },
    });
    expect(result.preflight).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agentProfile:codex-app-server:appServer",
          status: "passed",
        }),
      ]),
    );
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "turn/start",
    ]);

    const threadParams = requestParams(transport, "thread/start");
    expect(threadParams).toMatchObject({
      ephemeral: true,
      cwd: sourceRoot,
      model: "gpt-5.5",
      reasoning: "high",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      permissionProfile: "isolated",
      permissions: {
        profile: "isolated",
        approvalPolicy: "never",
        sandbox: "workspace-write",
        allowHostMutation: false,
        allowDependencyInstall: false,
        allowLiveServices: false,
      },
      mcp: {
        defaultToolsApprovalMode: "approve",
      },
      devNexus: {
        runId: "app-server-run-1",
        projectRoot,
        sourceRoot,
        contextFile: result.contextFile,
        resultFile: result.resultFile,
        result: {
          file: result.resultFile,
          requiredFields: ["status", "summary"],
        },
      },
    });

    const turnParams = requestParams(transport, "turn/start");
    expect(turnParams).toMatchObject({
      threadId: "thread-1",
      input: "Handle local-1 using the DevNexus result contract.",
      cwd: sourceRoot,
      model: "gpt-5.5",
      devNexus: {
        contextFile: result.contextFile,
        resultFile: result.resultFile,
      },
    });
  });

  it("forks a durable app-server thread when explicitly requested", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-fork-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/fork") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { thread: { id: "forked-thread" } },
        };
      }
      if (request.method === "turn/start") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { turnId: "forked-turn" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-fork-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        threadPersistence: "durable",
        fork: {
          threadId: "existing-thread",
          turnId: "existing-turn",
        },
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      launch: {
        codexAppServer: {
          action: "thread_fork",
          threadId: "forked-thread",
          turnId: "forked-turn",
          sourceThreadId: "existing-thread",
          sourceTurnId: "existing-turn",
          ephemeral: false,
        },
      },
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/fork",
      "turn/start",
    ]);
    expect(requestParams(transport, "thread/fork")).toMatchObject({
      sourceThreadId: "existing-thread",
      sourceTurnId: "existing-turn",
      ephemeral: false,
    });
  });

  it("returns app-server failure summaries without requiring live Codex", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-failure-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/start") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { id: "thread-before-failure" },
        };
      }
      if (request.method === "turn/start") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: "permission denied",
          },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-failure-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      summary:
        "Codex app-server launch failed: Codex app-server JSON-RPC method turn/start failed: permission denied",
      launch: {
        error:
          "Codex app-server JSON-RPC method turn/start failed: permission denied",
        codexAppServer: {
          status: "failed",
          threadId: "thread-before-failure",
          turnId: null,
          failureSummary:
            "Codex app-server JSON-RPC method turn/start failed: permission denied",
        },
      },
    });
    expect(
      readNexusAutomationRunLedger(
        projectRoot,
        appServerProjectConfig().automation!,
      ).runs[0],
    ).toMatchObject({
      id: "app-server-failure-run",
      status: "failed",
      summary:
        "Codex app-server launch failed: Codex app-server JSON-RPC method turn/start failed: permission denied",
      error:
        "Codex app-server JSON-RPC method turn/start failed: permission denied",
    });
  });
});
