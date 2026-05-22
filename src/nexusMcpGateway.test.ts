import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
} from "./index.js";

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
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    automation: defaultNexusAutomationConfig,
    ...overrides,
  };
}

function toolJson(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0]!.text);
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
        ],
      },
    });
  });
});
