import { describe, expect, it } from "vitest";
import {
  resolveNexusMcpExposure,
  resolveNexusPluginMcpServerExposures,
} from "../src/nexusMcpExposurePolicy.js";
import type { NexusProjectConfig } from "../src/nexusProjectConfig.js";

describe("MCP exposure policy", () => {
  it("defaults missing exposure metadata to direct", () => {
    expect(resolveNexusMcpExposure({}).mode).toBe("direct");
    expect(resolveNexusMcpExposure({}).source).toBe("built_in");
  });

  it("resolves exposure by server, plugin, agent target, workspace, then built-in", () => {
    expect(
      resolveNexusMcpExposure({
        workspaceExposure: "gateway",
        agentTarget: { agent: "codex", exposure: "hidden" },
        plugin: { id: "plugin-a", enabled: true, mcpExposure: "direct" },
        server: {
          kind: "mcp_server",
          id: "server-a",
          serverName: "server_a",
          exposure: "gateway",
        },
      }),
    ).toMatchObject({
      applicable: true,
      mode: "gateway",
      source: "server",
      path: "workspace config.plugins.plugin-a.capabilities.server-a.exposure",
    });

    expect(
      resolveNexusMcpExposure({
        workspaceExposure: "gateway",
        agentTarget: { agent: "codex", exposure: "hidden" },
        plugin: { id: "plugin-a", enabled: true, mcpExposure: "direct" },
        server: {
          kind: "mcp_server",
          id: "server-a",
          serverName: "server_a",
          exposure: "inherit",
        },
      }),
    ).toMatchObject({
      mode: "direct",
      source: "plugin",
    });

    expect(
      resolveNexusMcpExposure({
        workspaceExposure: "gateway",
        agentTarget: { agent: "codex", exposure: "hidden" },
        plugin: { id: "plugin-a", enabled: true, mcpExposure: "inherit" },
        server: {
          kind: "mcp_server",
          id: "server-a",
          serverName: "server_a",
        },
      }),
    ).toMatchObject({
      mode: "hidden",
      source: "agent_target",
    });

    expect(
      resolveNexusMcpExposure({
        workspaceExposure: "gateway",
        agentTarget: { agent: "codex", exposure: "inherit" },
        plugin: { id: "plugin-a", enabled: true },
        server: {
          kind: "mcp_server",
          id: "server-a",
          serverName: "server_a",
        },
      }),
    ).toMatchObject({
      mode: "gateway",
      source: "workspace",
    });
  });

  it("marks disabled plugins and target-agent mismatches as not applicable", () => {
    expect(
      resolveNexusMcpExposure({
        plugin: { id: "plugin-a", enabled: false, mcpExposure: "direct" },
        server: {
          kind: "mcp_server",
          id: "server-a",
          serverName: "server_a",
        },
      }),
    ).toMatchObject({
      applicable: false,
      mode: "hidden",
      source: "plugin_disabled",
    });

    expect(
      resolveNexusMcpExposure({
        agentTarget: { agent: "claude" },
        plugin: { id: "plugin-a", enabled: true },
        server: {
          kind: "mcp_server",
          id: "server-a",
          serverName: "server_a",
          targetAgents: ["codex"],
        },
      }),
    ).toMatchObject({
      applicable: false,
      mode: "hidden",
      source: "target_agent_filter",
    });
  });

  it("lists effective plugin MCP server exposure for one agent", () => {
    const config = {
      version: 1,
      id: "demo",
      name: "Demo",
      mcp: {
        exposure: "gateway",
        agentTargets: [{ agent: "codex", exposure: "direct" }],
      },
      plugins: [
        {
          id: "enabled-plugin",
          enabled: true,
          mcpExposure: "inherit",
          capabilities: [
            {
              kind: "mcp_server",
              id: "visible",
              serverName: "visible_mcp",
              targetAgents: ["codex"],
            },
            {
              kind: "mcp_server",
              id: "hidden",
              serverName: "hidden_mcp",
              exposure: "hidden",
            },
          ],
        },
        {
          id: "disabled-plugin",
          enabled: false,
          capabilities: [
            {
              kind: "mcp_server",
              id: "disabled",
              serverName: "disabled_mcp",
            },
          ],
        },
      ],
    } satisfies Partial<NexusProjectConfig>;

    expect(resolveNexusPluginMcpServerExposures(config, { agent: "codex" }))
      .toMatchObject([
        {
          pluginId: "enabled-plugin",
          capabilityId: "visible",
          serverName: "visible_mcp",
          mode: "direct",
          source: "agent_target",
          applicable: true,
        },
        {
          pluginId: "enabled-plugin",
          capabilityId: "hidden",
          serverName: "hidden_mcp",
          mode: "hidden",
          source: "server",
          applicable: true,
        },
      ]);
  });
});
