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
  runNexusAutomationAgentLaunchOnce as runNexusAutomationAgentLaunchOnceBase,
  saveProjectConfig,
  type CodexAppServerJsonRpcRequest,
  type CodexAppServerJsonRpcResponse,
  type CodexAppServerJsonRpcTransport,
  type NexusProjectConfig,
} from "../src/index.js";

const tempDirs: string[] = [];

function runNexusAutomationAgentLaunchOnce(
  options: Parameters<typeof runNexusAutomationAgentLaunchOnceBase>[0],
): ReturnType<typeof runNexusAutomationAgentLaunchOnceBase> {
  return runNexusAutomationAgentLaunchOnceBase({
    mcpRuntimeProcesses: false,
    ...options,
  });
}

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

class NotificationAwareMockCodexAppServerTransport
  extends MockCodexAppServerTransport {
  waitForNotificationCallCount = 0;
  private readonly bufferedNotifications: { method: string; params?: unknown }[] = [];
  private notificationWaiter:
    | {
        predicate: (notification: {
          method: string;
          params?: unknown;
        }) => boolean;
        resolve: (notification: {
          method: string;
          params?: unknown;
        }) => void;
      }
    | null = null;

  waitForNotification(
    predicate: (notification: { method: string; params?: unknown }) => boolean,
  ): Promise<{ method: string; params?: unknown }> {
    this.waitForNotificationCallCount += 1;
    for (let index = 0; index < this.bufferedNotifications.length; index += 1) {
      const notification = this.bufferedNotifications[index]!;
      if (predicate(notification)) {
        this.bufferedNotifications.splice(index, 1);
        return Promise.resolve(notification);
      }
    }

    return new Promise((resolve) => {
      this.notificationWaiter = { predicate, resolve };
    });
  }

  emitNotification(notification: { method: string; params?: unknown }): void {
    if (this.notificationWaiter?.predicate(notification)) {
      const waiter = this.notificationWaiter;
      this.notificationWaiter = null;
      waiter.resolve(notification);
      return;
    }

    this.bufferedNotifications.push(notification);
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

function initializeResult(
  request: CodexAppServerJsonRpcRequest,
  extraMethods: readonly string[] = [],
): CodexAppServerJsonRpcResponse {
  return {
    id: request.id,
    result: {
      capabilities: {
        methods: [
          "thread/start",
          "thread/fork",
          "turn/start",
          "turn/interrupt",
          "thread/read",
          ...extraMethods,
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

function writeResultFromTurnRequest(
  request: CodexAppServerJsonRpcRequest,
  result: Record<string, unknown>,
): void {
  expect(request.params).toBeTypeOf("object");
  const params = request.params as Record<string, unknown>;
  expect(params.devNexus).toBeTypeOf("object");
  const devNexus = params.devNexus as Record<string, unknown>;
  expect(devNexus.resultFile).toBeTypeOf("string");
  fs.writeFileSync(
    devNexus.resultFile as string,
    `${JSON.stringify(result)}\n`,
    "utf8",
  );
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
          id: request.id,
          result: { threadId: "thread-1" },
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          status: "completed",
          summary: "Codex app-server started thread thread-1 and turn turn-1",
        });
        return {
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
          status: "completed",
          ephemeral: true,
          threadPersistence: "ephemeral",
          cwd: sourceRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: result.resultFile,
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

  it("sets a Codex Goal after thread creation when the app-server supports goals", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-goal-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const projectConfig = appServerProjectConfig();
    projectConfig.automation = {
      ...projectConfig.automation!,
      target: {
        ...projectConfig.automation!.target,
        id: "goal-target",
        objective: "Use Codex Goals to finish bounded DevNexus targets.",
      },
    };
    saveProjectConfig(projectRoot, projectConfig);
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request, ["thread/goal/set"]);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-goal" },
        };
      }
      if (request.method === "thread/goal/set") {
        return {
          id: request.id,
          result: {},
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          status: "completed",
          summary: "Codex app-server projected the target into a thread Goal",
        });
        return {
          id: request.id,
          result: { turnId: "turn-goal" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-goal-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        cwd: (input) => input.sourceRoot,
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      launch: {
        codexAppServer: {
          status: "completed",
          threadId: "thread-goal",
          turnId: "turn-goal",
          goal: {
            requested: true,
            setMethodAvailable: true,
            getMethodAvailable: false,
            setStatus: "set",
            readStatus: "unsupported",
            threadId: "thread-goal",
          },
        },
      },
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "thread/goal/set",
      "turn/start",
    ]);

    const goalParams = requestParams(transport, "thread/goal/set");
    expect(goalParams).toMatchObject({
      threadId: "thread-goal",
      objective: expect.stringContaining(
        "Use Codex Goals to finish bounded DevNexus targets.",
      ),
    });
    expect(goalParams).not.toHaveProperty("tokenBudget");
    const objective = goalParams.objective as string;
    expect(objective).toContain(result.resultFile!);
    expect(objective).toContain("App-server launch task");
    expect(objective).toContain("Stop and report blocked");
    expect(objective).not.toContain("\\n");
  });

  it("reads Codex Goal lifecycle facts after the worker turn completes", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-goal-read-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request, ["thread/goal/set", "thread/goal/get"]);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-goal-read" },
        };
      }
      if (request.method === "thread/goal/set") {
        return {
          id: request.id,
          result: {},
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          status: "completed",
          summary: "Codex app-server read goal lifecycle facts",
        });
        return {
          id: request.id,
          result: { turnId: "turn-goal-read" },
        };
      }
      if (request.method === "thread/goal/get") {
        return {
          id: request.id,
          result: {
            goal: {
              id: "goal-1",
              threadId: "thread-goal-read",
              status: "complete",
              tokenBudget: 2000,
              tokensUsed: 512,
              timeUsedSeconds: 37,
            },
          },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-goal-read-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      launch: {
        codexAppServer: {
          status: "completed",
          threadId: "thread-goal-read",
          turnId: "turn-goal-read",
          goal: {
            requested: true,
            setStatus: "set",
            readStatus: "read",
            goalId: "goal-1",
            threadId: "thread-goal-read",
            status: "complete",
            tokenBudget: 2000,
            tokensUsed: 512,
            timeUsedSeconds: 37,
            failureSummary: null,
          },
        },
      },
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "thread/goal/set",
      "turn/start",
      "thread/goal/get",
    ]);
    expect(requestParams(transport, "thread/goal/get")).toEqual({
      threadId: "thread-goal-read",
    });
  });

  it("does not treat a budget-limited Goal as successful without the result contract", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-goal-budget-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request, ["thread/goal/set", "thread/goal/get"]);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-goal-budget" },
        };
      }
      if (request.method === "thread/goal/set") {
        return {
          id: request.id,
          result: {},
        };
      }
      if (request.method === "turn/start") {
        return {
          id: request.id,
          result: { turnId: "turn-goal-budget" },
        };
      }
      if (request.method === "thread/goal/get") {
        return {
          id: request.id,
          result: {
            threadId: "thread-goal-budget",
            status: "budgetLimited",
            tokenBudget: 100,
            tokensUsed: 100,
            timeUsedSeconds: 11,
          },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-goal-budget-run",
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
      summary: expect.stringContaining("Agent result file was not written"),
      launch: {
        codexAppServer: {
          status: "failed",
          threadId: "thread-goal-budget",
          turnId: "turn-goal-budget",
          goal: {
            readStatus: "read",
            status: "budgetLimited",
            tokenBudget: 100,
            tokensUsed: 100,
            timeUsedSeconds: 11,
          },
        },
      },
    });
  });

  it("continues the turn when the Codex app-server reports goals are disabled", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-goal-disabled-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request, ["thread/goal/set"]);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-goal-disabled" },
        };
      }
      if (request.method === "thread/goal/set") {
        return {
          id: request.id,
          error: {
            code: -32600,
            message: "goals feature is disabled",
          },
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          status: "completed",
          summary: "Codex app-server continued without goal projection",
        });
        return {
          id: request.id,
          result: { turnId: "turn-goal-disabled" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-goal-disabled-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      launch: {
        codexAppServer: {
          status: "completed",
          threadId: "thread-goal-disabled",
          turnId: "turn-goal-disabled",
        },
      },
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "thread/goal/set",
      "turn/start",
    ]);
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
          id: request.id,
          result: { thread: { id: "forked-thread" } },
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          status: "completed",
          summary:
            "Codex app-server forked thread forked-thread and turn forked-turn",
        });
        return {
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
          status: "completed",
          threadId: "forked-thread",
          turnId: "forked-turn",
          sourceThreadId: "existing-thread",
          sourceTurnId: "existing-turn",
          ephemeral: false,
          threadPersistence: "durable",
          resultFile: result.resultFile,
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

  it("fails a started app-server turn until the result contract validates", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-missing-result-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-without-result" },
        };
      }
      if (request.method === "turn/start") {
        return {
          id: request.id,
          result: { turnId: "turn-without-result" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-missing-result-run",
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
      summary: expect.stringContaining("Agent result file was not written"),
      launch: {
        error: expect.stringContaining("Agent result file was not written"),
        codexAppServer: {
          provider: "codex-app-server",
          status: "failed",
          profileId: "codex-app-server",
          threadId: "thread-without-result",
          turnId: "turn-without-result",
          ephemeral: true,
          threadPersistence: "ephemeral",
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: result.resultFile,
          failureSummary: expect.stringContaining(
            "Agent result file was not written",
          ),
        },
      },
    });
    expect(
      readNexusAutomationRunLedger(
        projectRoot,
        appServerProjectConfig().automation!,
      ).runs[0],
    ).toMatchObject({
      id: "app-server-missing-result-run",
      status: "failed",
      error: expect.stringContaining("Agent result file was not written"),
      codexAppServer: {
        profileId: "codex-app-server",
        threadId: "thread-without-result",
        turnId: "turn-without-result",
        resultFile: result.resultFile,
        failureSummary: expect.stringContaining(
          "Agent result file was not written",
        ),
      },
    });
  });

  it("propagates blocked app-server result contracts", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-blocked-result-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-blocked" },
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          status: "blocked",
          summary: "Human approval is required",
          error: "approval missing",
        });
        return {
          id: request.id,
          result: { turnId: "turn-blocked" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-blocked-result-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: "Human approval is required",
      launch: {
        error: "approval missing",
        codexAppServer: {
          status: "blocked",
          threadId: "thread-blocked",
          turnId: "turn-blocked",
          failureSummary: "approval missing",
        },
      },
    });
    expect(
      readNexusAutomationRunLedger(
        projectRoot,
        appServerProjectConfig().automation!,
      ).runs[0],
    ).toMatchObject({
      status: "blocked",
      error: "approval missing",
      codexAppServer: {
        status: "blocked",
        failureSummary: "approval missing",
      },
    });
  });

  it("waits for turn completion notifications before reading the result contract", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-turn-notification-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    let turnRequest: CodexAppServerJsonRpcRequest | null = null;
    const transport = new NotificationAwareMockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-notify" },
        };
      }
      if (request.method === "turn/start") {
        turnRequest = request;
        queueMicrotask(() => {
          writeResultFromTurnRequest(request, {
            status: "completed",
            summary: "Completion arrived from the turn notification",
          });
          transport.emitNotification({
            method: "turn/completed",
            params: {
              threadId: "thread-notify",
              turnId: "turn-notify",
              status: "completed",
            },
          });
        });
        return {
          id: request.id,
          result: { turnId: "turn-notify" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-turn-notification-run",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationCodexAppServerLauncher({
        clientFactory: () => new CodexAppServerJsonRpcClient({ transport }),
      }),
    });

    expect(turnRequest).not.toBeNull();
    expect(transport.waitForNotificationCallCount).toBe(1);
    expect(result).toMatchObject({
      status: "completed",
      summary: "Completion arrived from the turn notification",
      launch: {
        codexAppServer: {
          status: "completed",
          threadId: "thread-notify",
          turnId: "turn-notify",
          failureSummary: null,
        },
      },
    });
  });

  it("fails malformed app-server result contracts", async () => {
    const projectRoot = makeTempDir("dev-nexus-app-server-malformed-result-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, appServerProjectConfig());
    await createReadyWork(projectRoot);

    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "initialize") {
        return initializeResult(request);
      }
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: { threadId: "thread-malformed" },
        };
      }
      if (request.method === "turn/start") {
        writeResultFromTurnRequest(request, {
          summary: "missing status",
        });
        return {
          id: request.id,
          result: { turnId: "turn-malformed" },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "app-server-malformed-result-run",
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
        "Agent result file is invalid: agent result.status must be a non-empty string",
      launch: {
        error:
          "Agent result file is invalid: agent result.status must be a non-empty string",
        codexAppServer: {
          status: "failed",
          threadId: "thread-malformed",
          turnId: "turn-malformed",
          failureSummary:
            "Agent result file is invalid: agent result.status must be a non-empty string",
        },
      },
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
          id: request.id,
          result: { id: "thread-before-failure" },
        };
      }
      if (request.method === "turn/start") {
        return {
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
