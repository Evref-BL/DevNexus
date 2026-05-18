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
  return new MockCodexAppServerTransport((request) => ({
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
  }));
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Codex app-server initialize probe", () => {
  it("reports an all-good initialize capability result without starting threads", async () => {
    const projectRoot = saveProbeProject();
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/read",
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
      blockerSummary: null,
    });
    expect(report.advertisedMethods).toContain("thread/start");
    expect(report.requiredCapabilities.every((item) => item.status === "supported"))
      .toBe(true);
    expect(report.optionalCapabilities).toEqual(
      expect.arrayContaining([
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
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
    ]);
    expect(transport.requests[0]!.params).toMatchObject({
      clientInfo: {
        name: "dev-nexus",
        title: "DevNexus Codex app-server initialize probe",
      },
      clientCapabilities: {
        probe: true,
        durableThreads: false,
        userPrompts: false,
        automations: false,
      },
      devNexus: {
        purpose: "diagnostic_probe",
        projectId: "app-server-probe-project",
        profileId: "codex-app-server",
        persistence: "none",
      },
    });
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "thread/start",
    );
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "turn/start",
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
