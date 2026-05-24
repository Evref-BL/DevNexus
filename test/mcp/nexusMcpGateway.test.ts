import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusMcpGatewayIndex,
  callDevNexusMcpGatewayTool,
  defaultNexusAutomationConfig,
  handleDevNexusMcpGatewayJsonRpcMessage,
  listDevNexusMcpGatewayTools,
  saveProjectConfig,
  searchNexusMcpGatewayTools,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "gateway-demo",
    name: "Gateway Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:gateway/demo.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [
      {
        id: "primary",
        name: "Gateway Demo",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:gateway/demo.git",
        defaultBranch: "main",
        sourceRoot: "source",
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    automation: defaultNexusAutomationConfig,
    ...overrides,
  };
}

function toolJson(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0]!.text);
}

function writeEchoMcpServer(projectRoot: string): string {
  const serverPath = path.join(projectRoot, "echo-mcp-server.cjs");
  fs.writeFileSync(
    serverPath,
    `
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});
function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) throw new Error("missing content length");
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
    buffer = buffer.slice(bodyEnd);
    handle(message);
  }
}
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
}
function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo" } } });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [
      {
        name: "echo",
        description: "Echo text from arguments.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            repeat: { type: "number" }
          }
        }
      },
      {
        name: "secret_echo",
        description: "Echo text that should be excluded by gateway policy.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" }
          }
        }
      }
    ] } });
    return;
  }
  if (message.method === "tools/call") {
    const args = message.params.arguments || {};
    const text = typeof args.repeat === "number" ? "x".repeat(args.repeat) : String(args.text || "ok");
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } });
  }
}
`,
    "utf8",
  );
  return serverPath;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("DevNexus MCP gateway", () => {
  it("advertises a lean fixed tool surface", () => {
    expect(listDevNexusMcpGatewayTools().map((tool) => tool.name)).toEqual([
      "mcp_gateway_status",
      "mcp_gateway_search",
      "mcp_gateway_describe",
      "mcp_gateway_call",
      "mcp_gateway_result_fetch",
    ]);
  });

  it("indexes gateway-routed core and plugin MCP metadata", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        exposure: "gateway",
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "workflow-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "workflow-mcp",
              serverName: "workflow_runtime",
              command: "node",
              args: ["workflow-server.js"],
              tools: [
                {
                  name: "workflow_search",
                  description: "Search workflow records by task text.",
                },
                {
                  name: "workflow_describe",
                  description: "Describe one workflow record.",
                },
              ],
            },
            {
              kind: "mcp_server",
              id: "direct-mcp",
              serverName: "direct_runtime",
              command: "node",
              args: ["direct-server.js"],
              exposure: "direct",
              tools: [{ name: "direct_only" }],
            },
            {
              kind: "mcp_server",
              id: "hidden-mcp",
              serverName: "hidden_runtime",
              command: "node",
              args: ["hidden-server.js"],
              exposure: "hidden",
              tools: [{ name: "hidden_only" }],
            },
          ],
        },
      ],
    }));

    const index = buildNexusMcpGatewayIndex({ projectRoot, agent: "codex" });

    expect(index.servers.map((server) => server.serverName)).toEqual([
      "dev_nexus",
      "workflow_runtime",
    ]);
    expect(index.tools.map((tool) => tool.toolName)).toContain("project_status");
    expect(index.tools.map((tool) => tool.toolName)).toContain("workflow_search");
    expect(index.tools.map((tool) => tool.toolName)).not.toContain("direct_only");
    expect(index.tools.map((tool) => tool.toolName)).not.toContain("hidden_only");

    const matches = searchNexusMcpGatewayTools(index, "task workflow", 5);
    expect(matches[0]).toMatchObject({
      serverName: "workflow_runtime",
      toolName: "workflow_search",
      pluginId: "workflow-plugin",
      schemaStatus: "declared_name_only",
    });
  });

  it("keeps duplicate upstream tool names addressable by tool id", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-duplicates-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "alpha-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "alpha-mcp",
              serverName: "alpha_runtime",
              command: "node",
              args: ["alpha.js"],
              tools: [{ name: "inspect", description: "Inspect alpha data." }],
            },
          ],
        },
        {
          id: "beta-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "beta-mcp",
              serverName: "beta_runtime",
              command: "node",
              args: ["beta.js"],
              tools: [{ name: "inspect", description: "Inspect beta data." }],
            },
          ],
        },
      ],
    }));

    const matches = searchNexusMcpGatewayTools(
      buildNexusMcpGatewayIndex({ projectRoot }),
      "inspect",
      10,
    );

    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((match) => match.toolId)).size).toBe(2);
    expect(matches.map((match) => match.serverName).sort()).toEqual([
      "alpha_runtime",
      "beta_runtime",
    ]);
  });

  it("serves status, search, and describe through gateway tool calls", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-calls-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "workflow-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "workflow-mcp",
              serverName: "workflow_runtime",
              command: "node",
              args: ["workflow-server.js"],
              tools: [
                {
                  name: "workflow_search",
                  description: "Search workflow records by task text.",
                },
              ],
            },
          ],
        },
      ],
    }));

    const status = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_status",
      { projectRoot },
    ));
    expect(status).toMatchObject({
      ok: true,
      totals: {
        serverCount: 1,
        toolCount: 1,
      },
    });

    const search = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_search",
      { projectRoot, query: "task" },
    ));
    expect(search.matches[0]).toMatchObject({
      serverName: "workflow_runtime",
      toolName: "workflow_search",
    });

    const described = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_describe",
      { projectRoot, toolId: search.matches[0].toolId },
    ));
    expect(described.tool).toMatchObject({
      serverName: "workflow_runtime",
      toolName: "workflow_search",
      inputSchema: null,
    });
  });

  it("calls command-based upstream tools and fetches stored results", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-call-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const serverPath = writeEchoMcpServer(projectRoot);
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "echo-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "echo-mcp",
              serverName: "echo_runtime",
              command: process.execPath,
              args: [serverPath],
              tools: [
                {
                  name: "echo",
                  description: "Echo text from arguments.",
                },
              ],
            },
          ],
        },
      ],
    }));
    const search = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_search",
      { projectRoot, query: "echo" },
    ));

    const called = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_call",
      {
        projectRoot,
        toolId: search.matches[0].toolId,
        arguments: { text: "hello gateway" },
      },
    ));

    expect(called).toMatchObject({
      ok: true,
      stored: true,
      truncated: false,
      response: {
        content: [{ type: "text", text: "hello gateway" }],
      },
      policy: {
        decision: "allowed",
      },
    });
    const fetched = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_result_fetch",
      { projectRoot, resultId: called.resultId },
    ));
    expect(fetched.result).toMatchObject({
      id: called.resultId,
      serverName: "echo_runtime",
      toolName: "echo",
      resultBytes: expect.any(Number),
      response: {
        content: [{ type: "text", text: "hello gateway" }],
      },
    });
  });

  it("discovers command-based upstream tools dynamically when metadata is not declared", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-discovery-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const serverPath = writeEchoMcpServer(projectRoot);
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "echo-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "echo-mcp",
              serverName: "echo_runtime",
              command: process.execPath,
              args: [serverPath],
            },
          ],
        },
      ],
    }));

    const search = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_search",
      { projectRoot, query: "echo" },
    ));

    expect(search.matches[0]).toMatchObject({
      serverName: "echo_runtime",
      toolName: "echo",
      schemaStatus: "discovered",
    });

    const described = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_describe",
      { projectRoot, toolId: search.matches[0].toolId },
    ));
    expect(described.tool.inputSchema).toMatchObject({
      type: "object",
      properties: {
        text: { type: "string" },
      },
    });

    const called = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_call",
      {
        projectRoot,
        toolId: search.matches[0].toolId,
        arguments: { text: "dynamic" },
      },
    ));
    expect(called.response).toMatchObject({
      content: [{ type: "text", text: "dynamic" }],
    });
  });

  it("applies gateway grouping policy to discovered tools before search and call", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-groups-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const serverPath = writeEchoMcpServer(projectRoot);
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        gateway: {
          includedServers: ["echo_runtime"],
          excludedTools: ["echo_runtime.secret_echo"],
        },
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "echo-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "echo-mcp",
              serverName: "echo_runtime",
              command: process.execPath,
              args: [serverPath],
            },
          ],
        },
      ],
    }));

    const search = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_search",
      { projectRoot, query: "echo" },
    ));

    expect(search.matches.map((match: any) => match.toolName)).toEqual(["echo"]);

    const blocked = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_call",
      {
        projectRoot,
        toolId: "codex/plugin/echo-plugin/echo-mcp/echo_runtime/secret_echo",
        arguments: { text: "blocked" },
      },
    ));
    expect(blocked).toMatchObject({
      ok: false,
      error: expect.stringContaining("Gateway tool not found"),
    });
  });

  it("returns bounded inline content for large gateway call results", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-gateway-large-call-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const serverPath = writeEchoMcpServer(projectRoot);
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "echo-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "echo-mcp",
              serverName: "echo_runtime",
              command: process.execPath,
              args: [serverPath],
              tools: [{ name: "echo", description: "Echo text from arguments." }],
            },
          ],
        },
      ],
    }));
    const search = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_search",
      { projectRoot, query: "echo" },
    ));

    const called = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_call",
      {
        projectRoot,
        toolId: search.matches[0].toolId,
        arguments: { repeat: 3000 },
        maxInlineBytes: 1000,
      },
    ));

    expect(called.truncated).toBe(true);
    expect(called.response.excerpt.length).toBe(1000);
    const fetched = toolJson(await callDevNexusMcpGatewayTool(
      "mcp_gateway_result_fetch",
      { projectRoot, resultId: called.resultId },
    ));
    expect(fetched.result.response.content[0].text).toHaveLength(3000);
  });

  it("handles gateway MCP JSON-RPC initialize, tools/list, and tools/call", async () => {
    const initialized = await handleDevNexusMcpGatewayJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "dev-nexus-mcp-gateway",
        },
      },
    });

    const listed = await handleDevNexusMcpGatewayJsonRpcMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(listed).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          expect.objectContaining({ name: "mcp_gateway_status" }),
          expect.objectContaining({ name: "mcp_gateway_search" }),
          expect.objectContaining({ name: "mcp_gateway_describe" }),
          expect.objectContaining({ name: "mcp_gateway_call" }),
          expect.objectContaining({ name: "mcp_gateway_result_fetch" }),
        ],
      },
    });
  });
});
