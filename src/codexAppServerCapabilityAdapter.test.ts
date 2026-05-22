import { describe, expect, it } from "vitest";
import {
  CodexAppServerCapabilityError,
  CodexAppServerJsonRpcClient,
  CodexAppServerJsonRpcError,
  initializeCodexAppServerCapabilityAdapter,
  summarizeCodexAppServerJsonRpcFailure,
  type CodexAppServerJsonRpcRequest,
  type CodexAppServerJsonRpcResponse,
  type CodexAppServerJsonRpcTransport,
} from "./index.js";

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

function initializeTransport(
  methods: string[],
): MockCodexAppServerTransport {
  return new MockCodexAppServerTransport((request) => ({
    id: request.id,
    result: {
      serverInfo: {
        name: "codex-app-server",
      },
      capabilities: {
        methods,
      },
    },
  }));
}

describe("Codex app-server capability adapter", () => {
  it("initializes and detects required thread and turn JSON-RPC capabilities", async () => {
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/read",
      "thread/goal/set",
      "thread/goal/get",
      "thread/goal/clear",
      "plugin/list",
    ]);
    const client = new CodexAppServerJsonRpcClient({ transport });

    const adapter = await initializeCodexAppServerCapabilityAdapter({ client });

    expect(adapter.advertisedMethods).toEqual([
      "plugin/list",
      "thread/fork",
      "thread/goal/clear",
      "thread/goal/get",
      "thread/goal/set",
      "thread/read",
      "thread/start",
      "turn/interrupt",
      "turn/start",
    ]);
    expect(adapter.capabilities.threadStart.available).toBe(true);
    expect(adapter.capabilities.threadFork.available).toBe(true);
    expect(adapter.capabilities.turnStart.available).toBe(true);
    expect(adapter.capabilities.turnInterrupt.available).toBe(true);
    expect(adapter.capabilities.threadReadOrList).toMatchObject({
      available: true,
      method: "thread/read",
    });
    expect(adapter.capabilities.threadGoalSet.available).toBe(true);
    expect(adapter.capabilities.threadGoalGet.available).toBe(true);
    expect(adapter.capabilities.threadGoalClear.available).toBe(true);
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
    ]);
  });

  it("accepts thread/list as the read capability fallback", async () => {
    const transport = initializeTransport([
      "thread/start",
      "thread/fork",
      "turn/start",
      "turn/interrupt",
      "thread/list",
    ]);
    const client = new CodexAppServerJsonRpcClient({ transport });

    const adapter = await initializeCodexAppServerCapabilityAdapter({ client });

    expect(adapter.capabilities.threadRead.available).toBe(false);
    expect(adapter.capabilities.threadList.available).toBe(true);
    expect(adapter.capabilities.threadReadOrList).toMatchObject({
      available: true,
      method: "thread/list",
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
    ]);
  });

  it("reports clear missing capability errors without assuming automation methods", async () => {
    const transport = initializeTransport(["thread/start", "turn/start"]);
    const client = new CodexAppServerJsonRpcClient({ transport });

    await expect(
      initializeCodexAppServerCapabilityAdapter({ client }),
    ).rejects.toMatchObject({
      name: "CodexAppServerCapabilityError",
      missingCapabilities: [
        "thread/fork",
        "turn/interrupt",
        "thread/read or thread/list",
      ],
    } satisfies Partial<CodexAppServerCapabilityError>);
    await expect(
      initializeCodexAppServerCapabilityAdapter({ client }),
    ).rejects.toThrow(
      "Codex app-server is missing required JSON-RPC capabilities: thread/fork, turn/interrupt, thread/read or thread/list",
    );
    try {
      await initializeCodexAppServerCapabilityAdapter({ client });
    } catch (error) {
      expect(error).toMatchObject({
        missingCapabilities: [
          "thread/fork",
          "turn/interrupt",
          "thread/read or thread/list",
        ],
      });
    }
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "initialize",
      "initialize",
    ]);
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "automation/list",
    );
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "heartbeat/list",
    );
    expect(transport.requests.map((request) => request.method)).not.toContain(
      "cron/list",
    );
  });

  it("summarizes JSON-RPC protocol errors", async () => {
    const transport = new MockCodexAppServerTransport((request) => ({
      id: Number(request.id) + 1,
      result: {},
    }));
    const client = new CodexAppServerJsonRpcClient({ transport });

    await expect(client.request("initialize")).rejects.toMatchObject({
      name: "CodexAppServerJsonRpcError",
      kind: "protocol",
      method: "initialize",
    } satisfies Partial<CodexAppServerJsonRpcError>);
    await expect(client.request("initialize")).rejects.toThrow(
      "Codex app-server JSON-RPC protocol error while calling initialize: response id 3 did not match request id 2",
    );
  });

  it("summarizes transport failures with the attempted method", async () => {
    const transport = new MockCodexAppServerTransport(() => {
      throw new Error("stdio pipe closed");
    });
    const client = new CodexAppServerJsonRpcClient({ transport });

    let failure: unknown;
    try {
      await client.request("initialize");
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "CodexAppServerJsonRpcError",
      kind: "transport",
      method: "initialize",
    } satisfies Partial<CodexAppServerJsonRpcError>);
    expect(summarizeCodexAppServerJsonRpcFailure(failure)).toBe(
      "Codex app-server JSON-RPC transport failed while calling initialize: stdio pipe closed",
    );
  });
});
