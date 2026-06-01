import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerJsonRpcClient,
  defaultNexusAutomationConfig,
  probeCodexAppServerInitialize,
  probeCodexAppServerInitializeForProfile,
  saveProjectConfig,
  type CodexAppServerJsonRpcNotification,
  type CodexAppServerJsonRpcRequest,
  type CodexAppServerJsonRpcResponse,
  type CodexAppServerJsonRpcTransport,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

class MockCodexAppServerTransport implements CodexAppServerJsonRpcTransport {
  readonly requests: CodexAppServerJsonRpcRequest[] = [];
  readonly notifications: CodexAppServerJsonRpcNotification[] = [];

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

  sendNotification(notification: CodexAppServerJsonRpcNotification): void {
    this.notifications.push(notification);
  }
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function appServerProjectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "app-server-probe-project",
    name: "App Server Probe Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/app-server-probe.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      mode: "agent_launch",
      agent: {
        ...defaultNexusAutomationConfig.agent,
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
            args: [],
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

function saveProbeProject(config: NexusProjectConfig = appServerProjectConfig()): string {
  const projectRoot = makeTempDir("dev-nexus-app-server-probe-");
  saveProjectConfig(projectRoot, config);
  return projectRoot;
}

function initializeTransport(
  methods: string[],
): MockCodexAppServerTransport {
  return new MockCodexAppServerTransport((request) => {
    if (request.method === "thread/goal/get") {
      return {
        id: request.id,
        error: {
          code: -32600,
          message: "thread not found: 00000000-0000-4000-8000-000000000001",
        },
      };
    }
    return {
      id: request.id,
      result: {
        serverInfo: {
          name: "codex-app-server",
          version: "0.130.0",
        },
        capabilities: {
          methods,
        },
      },
    };
  });
}

function currentProtocolInitializeTransport(): MockCodexAppServerTransport {
  return new MockCodexAppServerTransport((request) => {
    if (request.method === "thread/goal/get") {
      return {
        id: request.id,
        error: {
          code: -32600,
          message: "thread not found: 00000000-0000-4000-8000-000000000001",
        },
      };
    }
    return {
      id: request.id,
      result: {
        userAgent: "Codex Desktop/0.130.0 (Mac OS 26.5.0; arm64) dumb (dev-nexus; 1)",
        codexHome: "/Users/example/.codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
    };
  });
}

function currentProtocolInitializeResult(
  request: CodexAppServerJsonRpcRequest,
): CodexAppServerJsonRpcResponse {
  return {
    id: request.id,
    result: {
      userAgent: "Codex Desktop/0.130.0 (Mac OS 26.5.0; arm64) dumb (dev-nexus; 1)",
      codexHome: "/Users/example/.codex",
      platformFamily: "unix",
      platformOs: "macos",
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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Codex app-server initialize probe", () => {
  it("recognizes current Codex app-server protocol methods when initialize omits method advertisements", async () => {
    const projectRoot = saveProbeProject();
    const transport = currentProtocolInitializeTransport();

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "ready",
      profileId: "codex-app-server",
      transportMode: "spawn",
      endpointScope: "loopback",
      codexVersion: "0.130.0",
      methodSource: "current_protocol_fallback",
      advertisedMethods: [],
      blockerKind: null,
      blockerSummary: null,
      goalRuntime: {
        status: "enabled",
        method: "thread/goal/get",
      },
    });
    expect(report.effectiveMethods).toEqual(
      expect.arrayContaining([
        "thread/start",
        "thread/fork",
        "turn/start",
        "turn/interrupt",
        "thread/read",
      ]),
    );
    expect(report.requiredCapabilities.every((item) => item.status === "supported"))
      .toBe(true);
    expect(report.optionalCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "thread_goal_set",
          status: "supported",
          method: "thread/goal/set",
        }),
        expect.objectContaining({
          capability: "mcp_status",
          status: "supported",
          method: "mcpServerStatus/list",
        }),
      ]),
    );
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/goal/get",
    ]);
    expect(transport.notifications.map((notification) => notification.method))
      .toEqual(["initialized"]);
    expect(transport.requests[0]!.params).toMatchObject({
      clientInfo: {
        name: "dev-nexus",
        title: "DevNexus Codex app-server initialize probe",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  });

  it("reports an all-good initialize capability result without starting threads", async () => {
    const projectRoot = saveProbeProject();
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/read",
      "thread/goal/set",
      "thread/goal/get",
      "thread/goal/clear",
      "mcpServerStatus/list",
      "mcpServer/tool/call",
      "plugin/list",
    ]);

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "ready",
      profileId: "codex-app-server",
      transportMode: "spawn",
      endpointScope: "loopback",
      codexVersion: "0.130.0",
      methodSource: "initialize",
      blockerSummary: null,
      goalRuntime: {
        status: "enabled",
        method: "thread/goal/get",
      },
    });
    expect(report.advertisedMethods).toContain("thread/start");
    expect(report.effectiveMethods).toContain("thread/start");
    expect(report.requiredCapabilities.every((item) => item.status === "supported"))
      .toBe(true);
    expect(report.optionalCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "thread_goal_set",
          status: "supported",
          method: "thread/goal/set",
        }),
        expect.objectContaining({
          capability: "thread_goal_get",
          status: "supported",
          method: "thread/goal/get",
        }),
        expect.objectContaining({
          capability: "thread_goal_clear",
          status: "supported",
          method: "thread/goal/clear",
        }),
        expect.objectContaining({
          capability: "mcp_status",
          status: "supported",
          method: "mcpServerStatus/list",
        }),
        expect.objectContaining({
          capability: "plugins",
          status: "supported",
          method: "plugin/list",
        }),
      ]),
    );
    expect(report.goalPolicy).toMatchObject({
      mode: "goal_projection",
      status: "warning",
      blockers: [],
      warnings: [
        expect.objectContaining({ code: "approval_policy_unspecified" }),
        expect.objectContaining({ code: "token_budget_omitted" }),
      ],
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/goal/get",
    ]);
    expect(transport.notifications.map((notification) => notification.method))
      .toEqual(["initialized"]);
    expect(transport.requests[0]!.params).toMatchObject({
      clientInfo: {
        name: "dev-nexus",
        title: "DevNexus Codex app-server initialize probe",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "thread/start",
    );
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "turn/start",
    );
  });

  it("reports Goals as disabled when the runtime feature gate rejects the read probe", async () => {
    const projectRoot = saveProbeProject();
    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "thread/goal/get") {
        return {
          id: request.id,
          error: {
            code: -32600,
            message: "goals feature is disabled",
          },
        };
      }
      return currentProtocolInitializeResult(request);
    });

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "ready",
      methodSource: "current_protocol_fallback",
      goalRuntime: {
        status: "disabled",
        method: "thread/goal/get",
      },
    });
    expect(report.goalRuntime.summary).toContain("goals feature is disabled");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/goal/get",
    ]);
  });

  it("runs an opt-in Goal storage smoke without starting a turn", async () => {
    const projectRoot = saveProbeProject();
    let objective: string | null = null;
    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: {
            thread: {
              id: "thread-storage-smoke",
              ephemeral: false,
            },
          },
        };
      }
      if (request.method === "thread/goal/set") {
        const params = request.params as Record<string, unknown>;
        objective = String(params.objective);
        return {
          id: request.id,
          result: {
            goal: {
              objective,
            },
          },
        };
      }
      if (request.method === "thread/goal/get") {
        return {
          id: request.id,
          result: {
            goal: {
              objective,
            },
          },
        };
      }
      if (request.method === "thread/goal/clear") {
        return { id: request.id, result: { cleared: true } };
      }
      if (request.method === "thread/archive") {
        return { id: request.id, result: { archived: true } };
      }
      return currentProtocolInitializeResult(request);
    });

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
      goalStorageSmoke: true,
    });

    expect(report).toMatchObject({
      status: "ready",
      blockerKind: null,
      blockerSummary: null,
      goalRuntime: {
        status: "enabled",
        check: "storage_smoke",
        method: "thread/goal/set",
        threadId: "thread-storage-smoke",
      },
    });
    expect(report.goalRuntime.summary).toContain("set, read, cleared");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "thread/goal/set",
      "thread/goal/get",
      "thread/goal/clear",
      "thread/archive",
    ]);
    expect(requestParams(transport, "thread/start")).toMatchObject({
      cwd: projectRoot,
      ephemeral: false,
      model: "gpt-5.5",
    });
    expect(requestParams(transport, "thread/goal/set")).toMatchObject({
      threadId: "thread-storage-smoke",
      tokenBudget: 1,
    });
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "turn/start",
    );
  });

  it("blocks the opt-in Goal storage smoke when Codex reports schema skew", async () => {
    const projectRoot = saveProbeProject();
    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: {
            thread: {
              id: "thread-storage-skew",
              ephemeral: false,
            },
          },
        };
      }
      if (request.method === "thread/goal/set") {
        return {
          id: request.id,
          error: {
            code: -32000,
            message:
              "error returned from database: (code: 1) no such table: thread_goals",
          },
        };
      }
      if (request.method === "thread/goal/clear") {
        return { id: request.id, result: { cleared: true } };
      }
      if (request.method === "thread/archive") {
        return { id: request.id, result: { archived: true } };
      }
      return currentProtocolInitializeResult(request);
    });

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
      goalStorageSmoke: true,
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "goal_runtime_failure",
      goalRuntime: {
        status: "failed",
        check: "storage_smoke",
        method: "thread/goal/set",
        threadId: "thread-storage-skew",
      },
    });
    expect(report.blockerSummary).toContain("missing thread_goals table");
    expect(report.goalRuntime.summary).toContain("no such table: thread_goals");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "thread/goal/set",
      "thread/goal/clear",
      "thread/archive",
    ]);
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "turn/start",
    );
  });

  it("blocks the opt-in Goal storage smoke when Goals are feature-disabled", async () => {
    const projectRoot = saveProbeProject();
    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "thread/start") {
        return {
          id: request.id,
          result: {
            thread: {
              id: "thread-goals-disabled",
              ephemeral: false,
            },
          },
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
      if (request.method === "thread/goal/clear") {
        return { id: request.id, result: { cleared: true } };
      }
      if (request.method === "thread/archive") {
        return { id: request.id, result: { archived: true } };
      }
      return currentProtocolInitializeResult(request);
    });

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
      goalStorageSmoke: true,
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "goal_runtime_failure",
      goalRuntime: {
        status: "disabled",
        check: "storage_smoke",
        method: "thread/goal/set",
        threadId: "thread-goals-disabled",
      },
    });
    expect(report.blockerSummary).toContain("goals feature is disabled");
  });

  it("blocks the opt-in Goal storage smoke when Goal mutation methods are unavailable", async () => {
    const projectRoot = saveProbeProject();
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/read",
    ]);

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
      goalStorageSmoke: true,
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "goal_runtime_failure",
      goalRuntime: {
        status: "unsupported",
        check: "storage_smoke",
        method: null,
      },
    });
    expect(report.blockerSummary).toContain("thread/goal/set is required");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
    ]);
  });

  it("reports absent thread goal methods as optional, not blockers", async () => {
    const projectRoot = saveProbeProject();
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/list",
    ]);

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "ready",
      blockerKind: null,
      blockerSummary: null,
    });
    expect(report.optionalCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "thread_goal_set",
          status: "optional",
          method: null,
          alternatives: ["thread/goal/set"],
        }),
        expect.objectContaining({
          capability: "thread_goal_get",
          status: "optional",
          method: null,
          alternatives: ["thread/goal/get"],
        }),
        expect.objectContaining({
          capability: "thread_goal_clear",
          status: "optional",
          method: null,
          alternatives: ["thread/goal/clear"],
        }),
      ]),
    );
  });

  it("reports a missing required app-server method as a blocker", async () => {
    const projectRoot = saveProbeProject();
    const transport = initializeTransport([
      "thread/start",
      "turn/start",
      "thread/read",
    ]);

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "missing_required_method",
    });
    expect(report.blockerSummary).toContain("thread/fork");
    expect(report.blockerSummary).toContain("turn/interrupt");
    expect(report.requiredCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "thread_fork",
          status: "missing",
        }),
        expect.objectContaining({
          capability: "turn_interrupt",
          status: "missing",
        }),
      ]),
    );
  });

  it("reports unsupported wire protocol failures", async () => {
    const projectRoot = saveProbeProject();
    const transport = new MockCodexAppServerTransport((request) => ({
      id: request.id,
      jsonrpc: "1.0" as "2.0",
      result: {},
    }));

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "unsupported_wire_protocol",
    });
    expect(report.blockerSummary).toContain(
      "response jsonrpc must be absent or \"2.0\"",
    );
  });

  it("reports auth failures without retrying through prompts or automations", async () => {
    const projectRoot = saveProbeProject();
    const transport = new MockCodexAppServerTransport((request) => ({
      id: request.id,
      error: {
        code: 401,
        message: "unauthorized",
      },
    }));

    const report = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "auth_failure",
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
    ]);
  });

  it("blocks non-loopback endpoints unless host-local policy allows them", async () => {
    const projectRoot = saveProbeProject(
      appServerProjectConfig({
        automation: {
          ...defaultNexusAutomationConfig,
          mode: "agent_launch",
          agent: {
            ...defaultNexusAutomationConfig.agent,
            coordinatorProfileId: "codex-app-server",
            profiles: [
              {
                id: "codex-app-server",
                executor: "codex",
                executorMode: "app_server",
                model: null,
                reasoning: null,
                command: null,
                args: [],
                appServer: {
                  mode: "connect",
                  command: null,
                  args: [],
                  endpoint: "http://192.0.2.10:18080",
                  ephemeralThreadDefault: true,
                  localPolicy: {
                    allowNonLoopbackEndpoint: true,
                    hostLocalSafetyHints: ["uses_host_local_endpoint"],
                  },
                },
              },
            ],
          },
        },
      }),
    );
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/list",
    ]);

    const allowedReport = await probeCodexAppServerInitialize({
      projectRoot,
      client: new CodexAppServerJsonRpcClient({ transport }),
    });

    expect(allowedReport).toMatchObject({
      status: "ready",
      endpointScope: "non_loopback",
      transportMode: "connect",
    });
    expect(transport.requests).toHaveLength(1);
  });

  it("blocks non-loopback endpoints before contacting a mocked transport when policy denies them", async () => {
    const projectConfig = appServerProjectConfig();
    const profile = {
      id: "codex-app-server",
      executor: "codex",
      executorMode: "app_server" as const,
      model: null,
      version: null,
      variant: null,
      reasoning: null,
      intelligence: null,
      intendedUse: "coordinator" as const,
      safety: defaultNexusAutomationConfig.safety,
      command: null,
      args: [],
      appServer: {
        mode: "connect" as const,
        command: null,
        args: [],
        endpoint: "http://192.0.2.10:18080",
        ephemeralThreadDefault: true,
        localPolicy: {
          allowNonLoopbackEndpoint: false,
          hostLocalSafetyHints: ["uses_host_local_endpoint" as const],
        },
      },
    };
    const appServer = {
      mode: "connect",
      command: null,
      args: [],
      endpoint: "http://192.0.2.10:18080",
      ephemeralThreadDefault: true,
      localPolicy: {
        allowNonLoopbackEndpoint: false,
        hostLocalSafetyHints: ["uses_host_local_endpoint"],
      },
    } as const;
    let contacted = false;

    const report = await probeCodexAppServerInitializeForProfile({
      projectRoot: "C:\\dev\\example",
      projectConfig,
      profile,
      appServer,
      transportFactory: () => {
        contacted = true;
        return initializeTransport([]);
      },
    });

    expect(report).toMatchObject({
      status: "blocked",
      blockerKind: "non_loopback_endpoint_blocked",
      endpointScope: "non_loopback",
    });
    expect(contacted).toBe(false);
  });
});
