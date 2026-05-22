import path from "node:path";
import {
  jsonRpcError,
  jsonRpcResult,
  StdioJsonRpcTransport,
  type JsonRpcRequest,
} from "./nexusMcpJsonRpcTransport.js";
import {
  listDevNexusMcpTools,
  devNexusMcpProtocolVersion,
  type DevNexusMcpToolResult,
  type McpTool,
} from "./nexusMcpServer.js";
import {
  defaultNexusMcpServerName,
  resolveNexusProjectAgentMcpTargets,
} from "./nexusAgentMcpConfig.js";
import {
  resolveNexusMcpExposure,
  type NexusMcpExposureSource,
  type NexusResolvedMcpExposureMode,
} from "./nexusMcpExposurePolicy.js";
import type {
  NexusPluginMcpServerCapability,
  NexusProjectPluginConfig,
} from "./nexusPluginCapabilities.js";
import {
  loadProjectConfig,
  selectNexusProjectMcpAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { providerCompatibleMcpTools } from "./nexusMcpSchemaCompatibility.js";
export {
  defaultNexusMcpGatewayServerName,
  defaultNexusMcpGatewayStdioArg,
} from "./nexusMcpGatewayProjection.js";

export type NexusMcpGatewayServerSource = "core" | "plugin";
export type NexusMcpGatewayToolSchemaStatus = "known" | "declared_name_only";

export interface NexusMcpGatewayServerRecord {
  serverId: string;
  source: NexusMcpGatewayServerSource;
  agent: string;
  provider: string;
  serverName: string;
  pluginId: string | null;
  capabilityId: string | null;
  command: string | null;
  args: string[];
  toolCount: number;
  effectiveExposure: NexusResolvedMcpExposureMode;
  exposureSource: NexusMcpExposureSource;
  exposureReason: string;
}

export interface NexusMcpGatewayToolRecord {
  toolId: string;
  serverId: string;
  source: NexusMcpGatewayServerSource;
  agent: string;
  provider: string;
  serverName: string;
  pluginId: string | null;
  capabilityId: string | null;
  toolName: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  schemaStatus: NexusMcpGatewayToolSchemaStatus;
  effectiveExposure: NexusResolvedMcpExposureMode;
  exposureSource: NexusMcpExposureSource;
  exposureReason: string;
}

export interface NexusMcpGatewayIndex {
  projectRoot: string;
  agentFilter: string | null;
  servers: NexusMcpGatewayServerRecord[];
  tools: NexusMcpGatewayToolRecord[];
  warnings: string[];
}

export interface NexusMcpGatewaySearchMatch {
  toolId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  pluginId: string | null;
  capabilityId: string | null;
  source: NexusMcpGatewayServerSource;
  description: string | null;
  schemaStatus: NexusMcpGatewayToolSchemaStatus;
  score: number;
}

export interface NexusMcpGatewayIndexOptions {
  projectRoot: string;
  agent?: string | null;
}

const gatewayTools: McpTool[] = [
  {
    name: "mcp_gateway_status",
    description:
      "Report gateway-routed DevNexus MCP upstream servers, exposure policy, and indexed tool counts.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        agent: { type: "string" },
      },
      required: ["projectRoot"],
      additionalProperties: false,
    },
  },
  {
    name: "mcp_gateway_search",
    description:
      "Search gateway-routed MCP tool metadata and return concise ranked matches.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        agent: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["projectRoot", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "mcp_gateway_describe",
    description:
      "Return full available metadata for one gateway-routed MCP tool selected from search results.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        agent: { type: "string" },
        toolId: { type: "string" },
      },
      required: ["projectRoot", "toolId"],
      additionalProperties: false,
    },
  },
];

export function listDevNexusMcpGatewayTools(): McpTool[] {
  return providerCompatibleMcpTools(gatewayTools);
}

export function buildNexusMcpGatewayIndex(
  options: NexusMcpGatewayIndexOptions,
): NexusMcpGatewayIndex {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  if (projectConfig.mcp?.enabled === false) {
    return {
      projectRoot,
      agentFilter: options.agent ?? null,
      servers: [],
      tools: [],
      warnings: ["Workspace MCP projection is disabled."],
    };
  }

  const selectedTargets = selectNexusProjectMcpAgentTargets(
    projectConfig,
    options.agent ? [options.agent] : [],
  );
  const core = coreGatewayRecords(projectRoot, projectConfig, selectedTargets);
  const plugins = pluginGatewayRecords(projectConfig, selectedTargets);
  const servers = [...core.servers, ...plugins.servers];
  const tools = [...core.tools, ...plugins.tools];

  return {
    projectRoot,
    agentFilter: options.agent ?? null,
    servers,
    tools,
    warnings: [
      ...core.warnings,
      ...plugins.warnings,
    ],
  };
}

export function searchNexusMcpGatewayTools(
  index: NexusMcpGatewayIndex,
  query: string,
  limit = 10,
): NexusMcpGatewaySearchMatch[] {
  const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  return index.tools
    .map((tool) => ({
      tool,
      score: scoreGatewayTool(tool, query),
    }))
    .filter((match) => query.trim().length === 0 || match.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.tool.serverName.localeCompare(right.tool.serverName) ||
      left.tool.toolName.localeCompare(right.tool.toolName)
    )
    .slice(0, normalizedLimit)
    .map(({ tool, score }) => ({
      toolId: tool.toolId,
      serverId: tool.serverId,
      serverName: tool.serverName,
      toolName: tool.toolName,
      pluginId: tool.pluginId,
      capabilityId: tool.capabilityId,
      source: tool.source,
      description: tool.description,
      schemaStatus: tool.schemaStatus,
      score,
    }));
}

export async function callDevNexusMcpGatewayTool(
  name: string,
  argsValue: unknown,
): Promise<DevNexusMcpToolResult> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "mcp_gateway_status": {
        const index = buildNexusMcpGatewayIndex({
          projectRoot: requiredString(args, "projectRoot", "arguments"),
          agent: optionalString(args, "agent", "arguments"),
        });
        return toolResult({
          ok: true,
          projectRoot: index.projectRoot,
          agentFilter: index.agentFilter,
          totals: {
            serverCount: index.servers.length,
            toolCount: index.tools.length,
            warningCount: index.warnings.length,
          },
          servers: index.servers,
          warnings: index.warnings,
        });
      }
      case "mcp_gateway_search": {
        const index = buildNexusMcpGatewayIndex({
          projectRoot: requiredString(args, "projectRoot", "arguments"),
          agent: optionalString(args, "agent", "arguments"),
        });
        const matches = searchNexusMcpGatewayTools(
          index,
          requiredString(args, "query", "arguments"),
          optionalNumber(args, "limit", "arguments") ?? 10,
        );
        return toolResult({
          ok: true,
          projectRoot: index.projectRoot,
          matches,
          warningCount: index.warnings.length,
          warnings: index.warnings,
        });
      }
      case "mcp_gateway_describe": {
        const index = buildNexusMcpGatewayIndex({
          projectRoot: requiredString(args, "projectRoot", "arguments"),
          agent: optionalString(args, "agent", "arguments"),
        });
        const toolId = requiredString(args, "toolId", "arguments");
        const tool = index.tools.find((candidate) => candidate.toolId === toolId);
        if (!tool) {
          return toolResult({
            ok: false,
            error: `Gateway tool not found: ${toolId}`,
          }, true);
        }
        return toolResult({
          ok: true,
          projectRoot: index.projectRoot,
          tool,
        });
      }
      default:
        return toolResult({
          ok: false,
          error: `Unknown DevNexus MCP gateway tool: ${name}`,
        }, true);
    }
  } catch (error) {
    return toolResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, true);
  }
}

export async function handleDevNexusMcpGatewayJsonRpcMessage(
  message: JsonRpcRequest,
): Promise<unknown | undefined> {
  switch (message.method) {
    case "initialize":
      return jsonRpcResult(message.id, {
        protocolVersion: devNexusMcpProtocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "dev-nexus-mcp-gateway",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listDevNexusMcpGatewayTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callDevNexusMcpGatewayTool(params.name, params.arguments),
      );
    }
    default:
      if (message.id === undefined) {
        return undefined;
      }
      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export async function runDevNexusMcpGatewayStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(
    handleDevNexusMcpGatewayJsonRpcMessage,
  );
  await transport.start();
}

function coreGatewayRecords(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  selectedTargets: readonly NexusProjectAgentMcpTarget[],
): Pick<NexusMcpGatewayIndex, "servers" | "tools" | "warnings"> {
  const materializedTargets = resolveNexusProjectAgentMcpTargets({
    projectRoot,
    mcpConfig: projectConfig.mcp,
    agentTargets: [...selectedTargets],
  }).filter((target) => target.effectiveExposure === "gateway");
  const servers: NexusMcpGatewayServerRecord[] = [];
  const tools: NexusMcpGatewayToolRecord[] = [];

  for (const target of materializedTargets) {
    const serverId = gatewayServerId({
      agent: target.agent,
      source: "core",
      pluginId: null,
      capabilityId: null,
      serverName: target.serverName,
    });
    const coreTools = target.serverName === defaultNexusMcpServerName
      ? listDevNexusMcpTools()
      : [];
    servers.push({
      serverId,
      source: "core",
      agent: target.agent,
      provider: target.provider,
      serverName: target.serverName,
      pluginId: null,
      capabilityId: null,
      command: target.command,
      args: target.args,
      toolCount: coreTools.length,
      effectiveExposure: target.effectiveExposure,
      exposureSource: target.exposureSource,
      exposureReason: target.exposureReason,
    });
    for (const tool of coreTools) {
      tools.push({
        toolId: gatewayToolId(serverId, tool.name),
        serverId,
        source: "core",
        agent: target.agent,
        provider: target.provider,
        serverName: target.serverName,
        pluginId: null,
        capabilityId: null,
        toolName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        schemaStatus: "known",
        effectiveExposure: target.effectiveExposure,
        exposureSource: target.exposureSource,
        exposureReason: target.exposureReason,
      });
    }
  }

  return {
    servers,
    tools,
    warnings: materializedTargets
      .filter((target) => target.serverName !== defaultNexusMcpServerName)
      .map((target) =>
        `No built-in metadata is available for gateway-routed core MCP server ${target.serverName}.`
      ),
  };
}

function pluginGatewayRecords(
  projectConfig: NexusProjectConfig,
  selectedTargets: readonly NexusProjectAgentMcpTarget[],
): Pick<NexusMcpGatewayIndex, "servers" | "tools" | "warnings"> {
  const servers: NexusMcpGatewayServerRecord[] = [];
  const tools: NexusMcpGatewayToolRecord[] = [];
  const warnings: string[] = [];

  for (const plugin of enabledPluginConfigs(projectConfig)) {
    for (const capability of plugin.capabilities) {
      if (capability.kind !== "mcp_server") {
        continue;
      }
      for (const agentTarget of selectedTargets) {
        const exposure = resolveNexusMcpExposure({
          workspaceExposure: projectConfig.mcp?.exposure,
          agentTarget,
          plugin,
          server: capability,
        });
        if (!exposure.applicable || exposure.mode !== "gateway") {
          continue;
        }

        const provider = agentTarget.provider ?? agentTarget.agent;
        const serverId = gatewayServerId({
          agent: agentTarget.agent,
          source: "plugin",
          pluginId: plugin.id,
          capabilityId: capability.id,
          serverName: capability.serverName,
        });
        const declaredTools = capability.tools ?? [];
        servers.push({
          serverId,
          source: "plugin",
          agent: agentTarget.agent,
          provider,
          serverName: capability.serverName,
          pluginId: plugin.id,
          capabilityId: capability.id,
          command: capability.command ?? null,
          args: [...(capability.args ?? [])],
          toolCount: declaredTools.length,
          effectiveExposure: exposure.mode,
          exposureSource: exposure.source,
          exposureReason: exposure.reason,
        });
        if (!capability.command) {
          warnings.push(
            `Gateway-routed plugin MCP server ${plugin.id}/${capability.serverName} has no command declaration.`,
          );
        }
        if (declaredTools.length === 0) {
          warnings.push(
            `Gateway-routed plugin MCP server ${plugin.id}/${capability.serverName} declares no tool metadata.`,
          );
        }
        for (const tool of declaredTools) {
          tools.push(pluginToolRecord({
            tool,
            serverId,
            plugin,
            capability,
            agentTarget,
            provider,
            exposureSource: exposure.source,
            exposureReason: exposure.reason,
          }));
        }
      }
    }
  }

  return { servers, tools, warnings };
}

function pluginToolRecord(options: {
  tool: NonNullable<NexusPluginMcpServerCapability["tools"]>[number];
  serverId: string;
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginMcpServerCapability;
  agentTarget: NexusProjectAgentMcpTarget;
  provider: string;
  exposureSource: NexusMcpExposureSource;
  exposureReason: string;
}): NexusMcpGatewayToolRecord {
  return {
    toolId: gatewayToolId(options.serverId, options.tool.name),
    serverId: options.serverId,
    source: "plugin",
    agent: options.agentTarget.agent,
    provider: options.provider,
    serverName: options.capability.serverName,
    pluginId: options.plugin.id,
    capabilityId: options.capability.id,
    toolName: options.tool.name,
    description: options.tool.description ?? null,
    inputSchema: null,
    schemaStatus: "declared_name_only",
    effectiveExposure: "gateway",
    exposureSource: options.exposureSource,
    exposureReason: options.exposureReason,
  };
}

function scoreGatewayTool(tool: NexusMcpGatewayToolRecord, query: string): number {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  if (terms.length === 0) {
    return 1;
  }

  const name = tool.toolName.toLowerCase();
  const server = tool.serverName.toLowerCase();
  const plugin = (tool.pluginId ?? "").toLowerCase();
  const description = (tool.description ?? "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name === term) {
      score += 40;
    }
    if (name.includes(term)) {
      score += 20;
    }
    if (server.includes(term)) {
      score += 8;
    }
    if (plugin.includes(term)) {
      score += 6;
    }
    if (description.includes(term)) {
      score += 4;
    }
  }
  return score;
}

function gatewayServerId(options: {
  agent: string;
  source: NexusMcpGatewayServerSource;
  pluginId: string | null;
  capabilityId: string | null;
  serverName: string;
}): string {
  return [
    safeIdPart(options.agent),
    options.source,
    safeIdPart(options.pluginId ?? "core"),
    safeIdPart(options.capabilityId ?? options.serverName),
    safeIdPart(options.serverName),
  ].join("/");
}

function gatewayToolId(serverId: string, toolName: string): string {
  return `${serverId}/${safeIdPart(toolName)}`;
}

function safeIdPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]/gu, "_");
}

function enabledPluginConfigs(
  projectConfig: NexusProjectConfig,
): NexusProjectPluginConfig[] {
  return (projectConfig.plugins ?? []).filter((plugin) => plugin.enabled !== false);
}

function toolResult(value: unknown, isError = false): DevNexusMcpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function parseToolCallParams(params: unknown): { name: string; arguments?: unknown } {
  const record = asRecord(params, "params");
  const name = requiredString(record, "name", "params");
  return { name, arguments: record.arguments };
}

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    throw new Error(`${pathName}.${key} is required`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${pathName}.${key} must be a number`);
  }
  return value;
}
