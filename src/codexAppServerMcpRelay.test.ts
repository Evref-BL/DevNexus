import { describe, expect, it } from "vitest";
import {
  CodexAppServerJsonRpcClient,
  CodexAppServerMcpRelayError,
  createCodexAppServerMcpRelay,
  detectCodexAppServerMcpCapabilities,
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

function relayWithTransport(
  transport: MockCodexAppServerTransport,
  advertisedMethods = ["mcpServerStatus/list", "mcpServer/tool/call"],
) {
  return createCodexAppServerMcpRelay({
    client: new CodexAppServerJsonRpcClient({ transport }),
    advertisedMethods,
  });
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

describe("Codex app-server MCP relay", () => {
  it("detects optional MCP app-server methods without making them required", () => {
    const capabilities = detectCodexAppServerMcpCapabilities([
      "thread/start",
      "mcpServerStatus/list",
    ]);

    expect(capabilities.statusList).toEqual({
      method: "mcpServerStatus/list",
      available: true,
    });
    expect(capabilities.toolCall).toEqual({
      method: "mcpServer/tool/call",
      available: false,
    });
  });

  it("lists and checks MCP server status for an app-server thread", async () => {
    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "mcpServerStatus/list") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            servers: [
              {
                name: "project-tools",
                status: "running",
                tools: [
                  {
                    name: "project_status",
                    description: "Read project state",
                  },
                ],
              },
            ],
          },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });
    const relay = relayWithTransport(transport);

    const listed = await relay.listServerStatus({ threadId: "thread-1" });
    const checked = await relay.checkServerStatus({
      threadId: "thread-1",
      serverName: "project-tools",
    });

    expect(listed.servers).toEqual([
      {
        name: "project-tools",
        status: "running",
        tools: [
          {
            name: "project_status",
            description: "Read project state",
          },
        ],
        raw: {
          name: "project-tools",
          status: "running",
          tools: [
            {
              name: "project_status",
              description: "Read project state",
            },
          ],
        },
      },
    ]);
    expect(checked.name).toBe("project-tools");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "mcpServerStatus/list",
      "mcpServerStatus/list",
    ]);
    expect(requestParams(transport, "mcpServerStatus/list")).toEqual({
      threadId: "thread-1",
    });
  });

  it("relays structured MCP tool arguments and returns structured tool content", async () => {
    const transport = new MockCodexAppServerTransport((request) => {
      if (request.method === "mcpServer/tool/call") {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [
              {
                type: "text",
                text: "status ok",
              },
            ],
            structuredContent: {
              ok: true,
            },
          },
        };
      }
      throw new Error(`unexpected method ${request.method}`);
    });
    const relay = relayWithTransport(transport);

    const result = await relay.callTool({
      threadId: "thread-1",
      serverName: "project-tools",
      toolName: "project_status",
      arguments: {
        projectRoot: "C:\\dev\\project",
        includeWorkItems: true,
      },
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "status ok",
        },
      ],
      structuredContent: {
        ok: true,
      },
      isError: false,
      raw: {
        content: [
          {
            type: "text",
            text: "status ok",
          },
        ],
        structuredContent: {
          ok: true,
        },
      },
    });
    expect(requestParams(transport, "mcpServer/tool/call")).toEqual({
      threadId: "thread-1",
      serverName: "project-tools",
      toolName: "project_status",
      arguments: {
        projectRoot: "C:\\dev\\project",
        includeWorkItems: true,
      },
    });
  });

  it("returns MCP tool error results as structured results, not infrastructure failures", async () => {
    const transport = new MockCodexAppServerTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: "The requested project is outside the configured boundary.",
          },
        ],
      },
    }));
    const relay = relayWithTransport(transport);

    await expect(
      relay.callTool({
        serverName: "project-tools",
        toolName: "project_status",
        arguments: {},
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "The requested project is outside the configured boundary.",
        },
      ],
    });
  });

  it("reports unsupported MCP methods as optional infrastructure capability failures", async () => {
    const transport = new MockCodexAppServerTransport(() => {
      throw new Error("the relay should fail before JSON-RPC transport use");
    });
    const relay = relayWithTransport(transport, ["thread/start"]);

    await expect(
      relay.callTool({
        serverName: "project-tools",
        toolName: "project_status",
        arguments: {},
      }),
    ).rejects.toMatchObject({
      name: "CodexAppServerMcpRelayError",
      kind: "capability",
      method: "mcpServer/tool/call",
      serverName: "project-tools",
      toolName: "project_status",
      summary:
        "Codex app-server does not advertise mcpServer/tool/call; update Codex app-server or disable this optional MCP relay.",
    } satisfies Partial<CodexAppServerMcpRelayError>);
    expect(transport.requests).toEqual([]);
  });

  it.each([
    {
      message: "approval required for MCP tool call",
      expectedKind: "approval",
      expectedSummary:
        "Codex app-server requires approval before relaying MCP tool project-tools/project_status; approve the tool in Codex or adjust the selected profile MCP approval policy.",
    },
    {
      message: "permission denied by sandbox policy",
      expectedKind: "permission",
      expectedSummary:
        "Codex app-server denied MCP tool project-tools/project_status by permission or sandbox policy; use a profile with the required permission or choose a safer tool.",
    },
    {
      message: "MCP server not found: project-tools",
      expectedKind: "missing_server",
      expectedSummary:
        "MCP server project-tools is not available in this Codex app-server thread; refresh MCP configuration or choose a configured server.",
    },
    {
      message: "MCP tool not found: project_status",
      expectedKind: "missing_tool",
      expectedSummary:
        "MCP tool project_status is not available on server project-tools; list server status and choose an advertised tool.",
    },
  ])(
    "classifies remote MCP relay infrastructure failure: $expectedKind",
    async ({ message, expectedKind, expectedSummary }) => {
      const transport = new MockCodexAppServerTransport((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message,
        },
      }));
      const relay = relayWithTransport(transport);

      await expect(
        relay.callTool({
          serverName: "project-tools",
          toolName: "project_status",
          arguments: {},
        }),
      ).rejects.toMatchObject({
        name: "CodexAppServerMcpRelayError",
        kind: expectedKind,
        summary: expectedSummary,
      });
    },
  );

  it("reports malformed app-server MCP responses as protocol failures", async () => {
    const transport = new MockCodexAppServerTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [
          {
            text: "missing content type",
          },
        ],
      },
    }));
    const relay = relayWithTransport(transport);

    await expect(
      relay.callTool({
        serverName: "project-tools",
        toolName: "project_status",
        arguments: {},
      }),
    ).rejects.toMatchObject({
      name: "CodexAppServerMcpRelayError",
      kind: "protocol",
      summary:
        "Codex app-server returned malformed MCP tool result for mcpServer/tool/call; update Codex app-server or the DevNexus relay schema.",
    });
  });
});
