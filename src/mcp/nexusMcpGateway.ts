import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
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
} from "../agents/nexusAgentMcpConfig.js";
import {
  resolveNexusMcpExposure,
  type NexusMcpExposureSource,
  type NexusResolvedMcpExposureMode,
} from "./nexusMcpExposurePolicy.js";
import type {
  NexusPluginMcpServerCapability,
  NexusProjectPluginConfig,
} from "../project/nexusPluginCapabilities.js";
import {
  loadProjectConfig,
  selectNexusProjectMcpAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
  type NexusMcpGatewayPolicyConfig,
} from "../project/nexusProjectConfig.js";
import { providerCompatibleMcpTools } from "./nexusMcpSchemaCompatibility.js";
export {
  defaultNexusMcpGatewayServerName,
  defaultNexusMcpGatewayStdioArg,
} from "./nexusMcpGatewayProjection.js";

export type NexusMcpGatewayServerSource = "core" | "plugin";
export type NexusMcpGatewayToolSchemaStatus =
  | "known"
  | "declared_name_only"
  | "discovered";

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

export interface NexusMcpGatewayDiscoveryTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface NexusMcpGatewayDiscoveryRecord {
  version: 1;
  createdAt: string;
  serverId: string;
  serverName: string;
  command: string;
  args: string[];
  tools: NexusMcpGatewayDiscoveryTool[];
}

export interface NexusMcpGatewayEffectivePolicy {
  includedServers: string[];
  includedTools: string[];
  excludedTools: string[];
}

export interface NexusMcpGatewayResultRecord {
  version: 1;
  id: string;
  createdAt: string;
  projectRoot: string;
  toolId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  command: string;
  args: string[];
  argumentBytes: number;
  resultBytes: number;
  stored: true;
  truncated: boolean;
  policy: {
    decision: "allowed";
    reason: string;
  };
  response: unknown;
}

const defaultGatewayCallInlineBytes = 8000;
const maxGatewayCallInlineBytes = 50000;
const gatewayCallTimeoutMs = 15_000;

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
  {
    name: "mcp_gateway_call",
    description:
      "Invoke one gateway-routed command-based MCP tool by toolId and return a bounded result with an audit id.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        agent: { type: "string" },
        toolId: { type: "string" },
        arguments: { type: "object" },
        maxInlineBytes: {
          type: "number",
          minimum: 1000,
          maximum: maxGatewayCallInlineBytes,
          default: defaultGatewayCallInlineBytes,
        },
      },
      required: ["projectRoot", "toolId"],
      additionalProperties: false,
    },
  },
  {
    name: "mcp_gateway_result_fetch",
    description:
      "Fetch a stored MCP gateway call result and audit record by result id.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        resultId: { type: "string" },
      },
      required: ["projectRoot", "resultId"],
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
  const base = buildNexusMcpGatewayBaseIndex(options);
  return applyGatewayPolicy(base.index, base.projectConfig, base.selectedTargets);
}

export async function buildNexusMcpGatewayIndexWithDiscovery(
  options: NexusMcpGatewayIndexOptions,
): Promise<NexusMcpGatewayIndex> {
  const base = buildNexusMcpGatewayBaseIndex(options);
  await discoverMissingGatewayMetadata(base.index);
  return applyGatewayPolicy(base.index, base.projectConfig, base.selectedTargets);
}

function buildNexusMcpGatewayBaseIndex(
  options: NexusMcpGatewayIndexOptions,
): {
  index: NexusMcpGatewayIndex;
  projectConfig: NexusProjectConfig;
  selectedTargets: NexusProjectAgentMcpTarget[];
} {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  if (projectConfig.mcp?.enabled === false) {
    return {
      projectConfig,
      selectedTargets: [],
      index: {
        projectRoot,
        agentFilter: options.agent ?? null,
        servers: [],
        tools: [],
        warnings: ["Workspace MCP projection is disabled."],
      },
    };
  }

  const selectedTargets = selectNexusProjectMcpAgentTargets(
    projectConfig,
    options.agent ? [options.agent] : [],
  );
  const core = coreGatewayRecords(projectRoot, projectConfig, selectedTargets);
  const plugins = pluginGatewayRecords(projectRoot, projectConfig, selectedTargets);
  const servers = [...core.servers, ...plugins.servers];
  const tools = [...core.tools, ...plugins.tools];

  return {
    projectConfig,
    selectedTargets,
    index: {
      projectRoot,
      agentFilter: options.agent ?? null,
      servers,
      tools,
      warnings: [
        ...core.warnings,
        ...plugins.warnings,
      ],
    },
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

export function effectiveNexusMcpGatewayPolicy(
  projectConfig: NexusProjectConfig,
  agentTarget: NexusProjectAgentMcpTarget | null | undefined,
): NexusMcpGatewayEffectivePolicy {
  return mergeGatewayPolicy(
    projectConfig.mcp?.gateway,
    agentTarget?.gateway,
  );
}

export function nexusMcpGatewayToolAllowed(options: {
  policy: NexusMcpGatewayEffectivePolicy;
  serverName: string;
  toolName: string;
}): boolean {
  const includedServers = normalizedPolicySet(options.policy.includedServers);
  const includedTools = normalizedPolicySet(options.policy.includedTools);
  const excludedTools = normalizedPolicySet(options.policy.excludedTools);
  const serverKey = normalizePolicyKey(options.serverName);
  const toolKeys = gatewayToolPolicyKeys(options.serverName, options.toolName);
  const hasIncludes = includedServers.size > 0 || includedTools.size > 0;
  const included = !hasIncludes ||
    includedServers.has(serverKey) ||
    toolKeys.some((key) => includedTools.has(key));
  if (!included) {
    return false;
  }

  return !toolKeys.some((key) => excludedTools.has(key));
}

function applyGatewayPolicy(
  index: NexusMcpGatewayIndex,
  projectConfig: NexusProjectConfig,
  selectedTargets: readonly NexusProjectAgentMcpTarget[],
): NexusMcpGatewayIndex {
  const rawToolCount = index.tools.length;
  const filteredTools = index.tools.filter((tool) => {
    const target = selectedTargets.find((candidate) =>
      sameAgent(candidate.agent, tool.agent)
    );
    return nexusMcpGatewayToolAllowed({
      policy: effectiveNexusMcpGatewayPolicy(projectConfig, target),
      serverName: tool.serverName,
      toolName: tool.toolName,
    });
  });
  const toolCounts = new Map<string, number>();
  for (const tool of filteredTools) {
    toolCounts.set(tool.serverId, (toolCounts.get(tool.serverId) ?? 0) + 1);
  }
  const filteredServers = index.servers.map((server) => ({
    ...server,
    toolCount: toolCounts.get(server.serverId) ?? 0,
  }));
  const warnings = [...index.warnings];
  if (rawToolCount > 0 && filteredTools.length === 0) {
    warnings.push("Gateway grouping policy excludes all gateway-routed tools.");
  }

  return {
    ...index,
    servers: filteredServers,
    tools: filteredTools,
    warnings,
  };
}

function mergeGatewayPolicy(
  workspace: NexusMcpGatewayPolicyConfig | undefined,
  agent: NexusMcpGatewayPolicyConfig | undefined,
): NexusMcpGatewayEffectivePolicy {
  return {
    includedServers: uniquePolicyValues([
      ...(workspace?.includedServers ?? []),
      ...(agent?.includedServers ?? []),
    ]),
    includedTools: uniquePolicyValues([
      ...(workspace?.includedTools ?? []),
      ...(agent?.includedTools ?? []),
    ]),
    excludedTools: uniquePolicyValues([
      ...(workspace?.excludedTools ?? []),
      ...(agent?.excludedTools ?? []),
    ]),
  };
}

function uniquePolicyValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedPolicySet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizePolicyKey));
}

function gatewayToolPolicyKeys(serverName: string, toolName: string): string[] {
  return [
    normalizePolicyKey(toolName),
    normalizePolicyKey(`${serverName}.${toolName}`),
    normalizePolicyKey(`${serverName}__${toolName}`),
  ];
}

function normalizePolicyKey(value: string): string {
  return value.trim().toLowerCase();
}

function sameAgent(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function callDevNexusMcpGatewayTool(
  name: string,
  argsValue: unknown,
): Promise<DevNexusMcpToolResult> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "mcp_gateway_status": {
        const index = await buildNexusMcpGatewayIndexWithDiscovery({
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
        const index = await buildNexusMcpGatewayIndexWithDiscovery({
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
        const index = await buildNexusMcpGatewayIndexWithDiscovery({
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
      case "mcp_gateway_call": {
        const projectRoot = requiredString(args, "projectRoot", "arguments");
        const index = await buildNexusMcpGatewayIndexWithDiscovery({
          projectRoot,
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
        const server = index.servers.find(
          (candidate) => candidate.serverId === tool.serverId,
        );
        if (!server?.command) {
          return toolResult({
            ok: false,
            error: `Gateway server ${tool.serverName} does not declare a command.`,
            toolId,
          }, true);
        }
        const toolArguments = optionalRecord(args, "arguments", "arguments") ?? {};
        const response = await callCommandMcpTool({
          projectRoot: index.projectRoot,
          command: server.command,
          args: server.args,
          toolName: tool.toolName,
          toolArguments,
        });
        const record = writeGatewayResultRecord({
          projectRoot: index.projectRoot,
          tool,
          server,
          toolArguments,
          response,
        });
        return toolResult(summarizeGatewayResultRecord(
          record,
          optionalNumber(args, "maxInlineBytes", "arguments") ??
            defaultGatewayCallInlineBytes,
        ));
      }
      case "mcp_gateway_result_fetch": {
        const projectRoot = requiredString(args, "projectRoot", "arguments");
        const resultId = requiredString(args, "resultId", "arguments");
        return toolResult({
          ok: true,
          result: readGatewayResultRecord(projectRoot, resultId),
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
  projectRoot: string,
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
        const discovered = capability.command
          ? readNexusMcpGatewayDiscoveryRecord(projectRoot, serverId)
          : null;
        const discoveredCacheIsCurrent = discovered
          ? discovered.command === capability.command &&
            sameStringArray(discovered.args, capability.args ?? [])
          : false;
        const discoveredTools = discovered && discoveredCacheIsCurrent
          ? discovered.tools
          : [];
        const discoveredToolsByName = new Map(
          discoveredTools.map((tool) => [tool.name, tool]),
        );
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
          toolCount: declaredTools.length > 0
            ? declaredTools.length
            : discoveredTools.length,
          effectiveExposure: exposure.mode,
          exposureSource: exposure.source,
          exposureReason: exposure.reason,
        });
        if (!capability.command) {
          warnings.push(
            `Gateway-routed plugin MCP server ${plugin.id}/${capability.serverName} has no command declaration.`,
          );
        }
        if (discovered && !discoveredCacheIsCurrent) {
          warnings.push(
            `Gateway discovery cache for plugin MCP server ${plugin.id}/${capability.serverName} is stale because its command or args changed.`,
          );
        }
        if (
          declaredTools.length === 0 &&
          discoveredTools.length === 0 &&
          !capability.command
        ) {
          warnings.push(
            `Gateway-routed plugin MCP server ${plugin.id}/${capability.serverName} declares no tool metadata.`,
          );
        }
        for (const tool of declaredTools) {
          const discoveredTool = discoveredToolsByName.get(tool.name);
          tools.push(pluginToolRecord({
            tool: discoveredTool
              ? mergeDeclaredGatewayToolMetadata(tool, discoveredTool)
              : tool,
            serverId,
            plugin,
            capability,
            agentTarget,
            provider,
            exposureSource: exposure.source,
            exposureReason: exposure.reason,
            schemaStatus: discoveredTool
              ? "discovered"
              : "declared_name_only",
          }));
        }
        if (declaredTools.length === 0) {
          for (const tool of discoveredTools) {
            tools.push(pluginToolRecord({
              tool,
              serverId,
              plugin,
              capability,
              agentTarget,
              provider,
              exposureSource: exposure.source,
              exposureReason: exposure.reason,
              schemaStatus: "discovered",
            }));
          }
        }
      }
    }
  }

  return { servers, tools, warnings };
}

function pluginToolRecord(options: {
  tool: NonNullable<NexusPluginMcpServerCapability["tools"]>[number] |
    NexusMcpGatewayDiscoveryTool;
  serverId: string;
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginMcpServerCapability;
  agentTarget: NexusProjectAgentMcpTarget;
  provider: string;
  exposureSource: NexusMcpExposureSource;
  exposureReason: string;
  schemaStatus: NexusMcpGatewayToolSchemaStatus;
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
    inputSchema: "inputSchema" in options.tool
      ? options.tool.inputSchema ?? null
      : null,
    schemaStatus: options.schemaStatus,
    effectiveExposure: "gateway",
    exposureSource: options.exposureSource,
    exposureReason: options.exposureReason,
  };
}

function mergeDeclaredGatewayToolMetadata(
  declared: NonNullable<NexusPluginMcpServerCapability["tools"]>[number],
  discovered: NexusMcpGatewayDiscoveryTool,
): NexusMcpGatewayDiscoveryTool {
  return {
    name: declared.name,
    description: declared.description ?? discovered.description,
    ...(discovered.inputSchema ? { inputSchema: discovered.inputSchema } : {}),
  };
}

async function discoverMissingGatewayMetadata(
  index: NexusMcpGatewayIndex,
): Promise<void> {
  const toolsByServer = new Map<string, NexusMcpGatewayToolRecord[]>();
  for (const tool of index.tools) {
    const tools = toolsByServer.get(tool.serverId) ?? [];
    tools.push(tool);
    toolsByServer.set(tool.serverId, tools);
  }

  for (const server of index.servers) {
    const existingTools = toolsByServer.get(server.serverId) ?? [];
    if (
      server.source !== "plugin" ||
      !server.command ||
      !gatewayServerNeedsDiscovery(existingTools)
    ) {
      continue;
    }

    try {
      const discoveredTools = await discoverCommandMcpTools({
        projectRoot: index.projectRoot,
        command: server.command,
        args: server.args,
      });
      writeNexusMcpGatewayDiscoveryRecord(index.projectRoot, {
        version: 1,
        createdAt: new Date().toISOString(),
        serverId: server.serverId,
        serverName: server.serverName,
        command: server.command,
        args: server.args,
        tools: discoveredTools,
      });
      server.toolCount = discoveredTools.length;
      if (discoveredTools.length === 0) {
        index.warnings.push(
          `Gateway-routed plugin MCP server ${server.serverName} discovery returned no tools.`,
        );
      }
      if (existingTools.length > 0) {
        mergeDiscoveredGatewayToolMetadata(existingTools, discoveredTools);
        server.toolCount = existingTools.length;
        continue;
      }
      for (const tool of discoveredTools) {
        index.tools.push({
          toolId: gatewayToolId(server.serverId, tool.name),
          serverId: server.serverId,
          source: server.source,
          agent: server.agent,
          provider: server.provider,
          serverName: server.serverName,
          pluginId: server.pluginId,
          capabilityId: server.capabilityId,
          toolName: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
          schemaStatus: "discovered",
          effectiveExposure: server.effectiveExposure,
          exposureSource: server.exposureSource,
          exposureReason: server.exposureReason,
        });
      }
    } catch (error) {
      index.warnings.push(
        `Gateway-routed plugin MCP server ${server.serverName} discovery failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
}

function gatewayServerNeedsDiscovery(
  tools: readonly NexusMcpGatewayToolRecord[],
): boolean {
  return tools.length === 0 ||
    tools.some((tool) =>
      tool.schemaStatus === "declared_name_only" &&
      tool.inputSchema === null
    );
}

function mergeDiscoveredGatewayToolMetadata(
  existingTools: readonly NexusMcpGatewayToolRecord[],
  discoveredTools: readonly NexusMcpGatewayDiscoveryTool[],
): void {
  const discoveredToolsByName = new Map(
    discoveredTools.map((tool) => [tool.name, tool]),
  );
  for (const existingTool of existingTools) {
    const discoveredTool = discoveredToolsByName.get(existingTool.toolName);
    if (!discoveredTool) {
      continue;
    }
    existingTool.description =
      existingTool.description ?? discoveredTool.description ?? null;
    existingTool.inputSchema =
      discoveredTool.inputSchema ?? existingTool.inputSchema;
    existingTool.schemaStatus = "discovered";
  }
}

async function discoverCommandMcpTools(options: {
  projectRoot: string;
  command: string;
  args: readonly string[];
}): Promise<NexusMcpGatewayDiscoveryTool[]> {
  const client = new StdioMcpClient({
    projectRoot: options.projectRoot,
    command: options.command,
    args: options.args,
    timeoutMs: gatewayCallTimeoutMs,
  });
  try {
    await client.start();
    await client.request("initialize", {
      protocolVersion: devNexusMcpProtocolVersion,
      capabilities: {},
      clientInfo: {
        name: "dev-nexus-mcp-gateway",
        version: "0.1.0",
      },
    });
    client.notify("notifications/initialized", {});

    const tools: NexusMcpGatewayDiscoveryTool[] = [];
    let cursor: string | undefined;
    do {
      const result = asRecord(
        await client.request("tools/list", cursor ? { cursor } : {}),
        "tools/list result",
      );
      const resultTools = result.tools;
      if (!Array.isArray(resultTools)) {
        throw new Error("tools/list result.tools must be an array");
      }
      for (const toolValue of resultTools) {
        const tool = asRecord(toolValue, "tools/list result.tools[]");
        const name = requiredString(tool, "name", "tools/list result.tools[]");
        const description = optionalString(
          tool,
          "description",
          "tools/list result.tools[]",
        );
        const inputSchema = optionalRecord(
          tool,
          "inputSchema",
          "tools/list result.tools[]",
        );
        tools.push({
          name,
          ...(description !== undefined ? { description } : {}),
          ...(inputSchema !== undefined ? { inputSchema } : {}),
        });
      }
      cursor = optionalString(result, "nextCursor", "tools/list result");
    } while (cursor);

    return tools;
  } finally {
    await client.stop();
  }
}

async function callCommandMcpTool(options: {
  projectRoot: string;
  command: string;
  args: readonly string[];
  toolName: string;
  toolArguments: Record<string, unknown>;
}): Promise<unknown> {
  const client = new StdioMcpClient({
    projectRoot: options.projectRoot,
    command: options.command,
    args: options.args,
    timeoutMs: gatewayCallTimeoutMs,
  });
  try {
    await client.start();
    await client.request("initialize", {
      protocolVersion: devNexusMcpProtocolVersion,
      capabilities: {},
      clientInfo: {
        name: "dev-nexus-mcp-gateway",
        version: "0.1.0",
      },
    });
    client.notify("notifications/initialized", {});
    return await client.request("tools/call", {
      name: options.toolName,
      arguments: options.toolArguments,
    });
  } finally {
    await client.stop();
  }
}

class StdioMcpClient {
  private child: childProcess.ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer: Buffer = Buffer.alloc(0);
  private stderr = "";
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  constructor(
    private readonly options: {
      projectRoot: string;
      command: string;
      args: readonly string[];
      timeoutMs: number;
    },
  ) {}

  async start(): Promise<void> {
    this.child = childProcess.spawn(this.options.command, [...this.options.args], {
      cwd: this.options.projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer | string) => {
      const bufferChunk = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, "utf8");
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, bufferChunk]);
      this.processStdout();
    });
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    });
    this.child.once("error", (error) => {
      this.rejectPending(error);
    });
    this.child.once("exit", (code, signal) => {
      if (this.pending.size > 0) {
        this.rejectPending(new Error(
          `MCP upstream exited before responding: code=${code ?? "null"} signal=${signal ?? "null"} stderr=${this.stderr.trim()}`,
        ));
      }
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const child = this.assertChild();
    const id = this.nextId++;
    child.stdin.write(jsonRpcFrame({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP upstream request timed out: ${method}`));
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method: string, params: unknown): void {
    this.assertChild().stdin.write(jsonRpcFrame({
      jsonrpc: "2.0",
      method,
      params,
    }));
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 100);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
  }

  private processStdout(): void {
    while (true) {
      const extracted = extractJsonRpcMessage(this.stdoutBuffer);
      if (!extracted) {
        return;
      }
      this.stdoutBuffer = extracted.remaining;
      this.handleMessage(extracted.message);
    }
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return;
    }
    const record = message as Record<string, unknown>;
    const id = typeof record.id === "number" ? record.id : null;
    if (id === null) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (record.error) {
      pending.reject(new Error(JSON.stringify(record.error)));
      return;
    }
    pending.resolve(record.result);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private assertChild(): childProcess.ChildProcessWithoutNullStreams {
    if (!this.child) {
      throw new Error("MCP upstream process is not running");
    }
    return this.child;
  }
}

function writeGatewayResultRecord(options: {
  projectRoot: string;
  tool: NexusMcpGatewayToolRecord;
  server: NexusMcpGatewayServerRecord;
  toolArguments: Record<string, unknown>;
  response: unknown;
}): NexusMcpGatewayResultRecord {
  const id = `mcp-result-${new Date().toISOString().replace(/[^0-9TZ]/gu, "")}-${crypto.randomUUID()}`;
  const responseText = JSON.stringify(options.response);
  const record: NexusMcpGatewayResultRecord = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    projectRoot: options.projectRoot,
    toolId: options.tool.toolId,
    serverId: options.server.serverId,
    serverName: options.server.serverName,
    toolName: options.tool.toolName,
    command: options.server.command ?? "",
    args: options.server.args,
    argumentBytes: Buffer.byteLength(JSON.stringify(options.toolArguments), "utf8"),
    resultBytes: Buffer.byteLength(responseText, "utf8"),
    stored: true,
    truncated: false,
    policy: {
      decision: "allowed",
      reason: "Gateway MVP allows configured command-based upstream MCP tools.",
    },
    response: options.response,
  };
  const recordPath = gatewayResultRecordPath(options.projectRoot, id);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function summarizeGatewayResultRecord(
  record: NexusMcpGatewayResultRecord,
  maxInlineBytes: number,
): Record<string, unknown> {
  const inlineLimit = Math.max(
    1000,
    Math.min(maxGatewayCallInlineBytes, Math.trunc(maxInlineBytes)),
  );
  const responseText = JSON.stringify(record.response, null, 2);
  const responseBytes = Buffer.byteLength(responseText, "utf8");
  const truncated = responseBytes > inlineLimit;
  return {
    ok: true,
    resultId: record.id,
    toolId: record.toolId,
    serverId: record.serverId,
    serverName: record.serverName,
    toolName: record.toolName,
    stored: true,
    truncated,
    argumentBytes: record.argumentBytes,
    resultBytes: record.resultBytes,
    policy: record.policy,
    response: truncated
      ? {
          excerpt: responseText.slice(0, inlineLimit),
          omittedBytes: responseBytes - inlineLimit,
        }
      : record.response,
  };
}

function readGatewayResultRecord(
  projectRoot: string,
  resultId: string,
): NexusMcpGatewayResultRecord {
  if (!/^mcp-result-[A-Za-z0-9TZ-]+$/u.test(resultId)) {
    throw new Error("arguments.resultId must be a gateway result id");
  }
  const recordPath =
    existingGatewayResultRecordPath(projectRoot, resultId) ??
      gatewayResultRecordPath(projectRoot, resultId);
  if (!fs.existsSync(recordPath)) {
    throw new Error(`Gateway result record not found: ${resultId}`);
  }
  return JSON.parse(fs.readFileSync(recordPath, "utf8")) as NexusMcpGatewayResultRecord;
}

export function readNexusMcpGatewayDiscoveryRecord(
  projectRoot: string,
  serverId: string,
): NexusMcpGatewayDiscoveryRecord | null {
  const recordPath =
    existingGatewayDiscoveryRecordPath(projectRoot, serverId) ??
      gatewayDiscoveryRecordPath(projectRoot, serverId);
  if (!fs.existsSync(recordPath)) {
    return null;
  }

  const record = JSON.parse(
    fs.readFileSync(recordPath, "utf8"),
  ) as NexusMcpGatewayDiscoveryRecord;
  if (record.version !== 1 || record.serverId !== serverId) {
    return null;
  }
  return record;
}

function writeNexusMcpGatewayDiscoveryRecord(
  projectRoot: string,
  record: NexusMcpGatewayDiscoveryRecord,
): void {
  const recordPath = gatewayDiscoveryRecordPath(projectRoot, record.serverId);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function gatewayResultRecordPath(projectRoot: string, resultId: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".dev-nexus",
    "runtime",
    "mcp-gateway",
    "results",
    `${resultId}.json`,
  );
}

function gatewayDiscoveryRecordPath(projectRoot: string, serverId: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".dev-nexus",
    "runtime",
    "mcp-gateway",
    "discovery",
    `${safeIdPart(serverId)}.json`,
  );
}

function legacyGatewayResultRecordPath(projectRoot: string, resultId: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".dev-nexus",
    "mcp-gateway",
    "results",
    `${resultId}.json`,
  );
}

function legacyGatewayDiscoveryRecordPath(projectRoot: string, serverId: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".dev-nexus",
    "mcp-gateway",
    "discovery",
    `${safeIdPart(serverId)}.json`,
  );
}

function existingGatewayResultRecordPath(
  projectRoot: string,
  resultId: string,
): string | null {
  return [
    gatewayResultRecordPath(projectRoot, resultId),
    legacyGatewayResultRecordPath(projectRoot, resultId),
  ].find((recordPath) => fs.existsSync(recordPath)) ?? null;
}

function existingGatewayDiscoveryRecordPath(
  projectRoot: string,
  serverId: string,
): string | null {
  return [
    gatewayDiscoveryRecordPath(projectRoot, serverId),
    legacyGatewayDiscoveryRecordPath(projectRoot, serverId),
  ].find((recordPath) => fs.existsSync(recordPath)) ?? null;
}

function jsonRpcFrame(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function extractJsonRpcMessage(buffer: Buffer): {
  message: unknown;
  remaining: Buffer;
} | null {
  if (buffer.length === 0) {
    return null;
  }
  if (
    buffer.subarray(0, Math.min(buffer.length, "Content-Length:".length))
      .toString("utf8")
      .toLowerCase() === "content-length:"
  ) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return null;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
    if (!lengthMatch) {
      throw new Error("Missing Content-Length header from MCP upstream");
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(lengthMatch[1]);
    if (buffer.length < bodyEnd) {
      return null;
    }
    return {
      message: JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8")),
      remaining: buffer.slice(bodyEnd),
    };
  }

  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex < 0) {
    return null;
  }
  const line = buffer.slice(0, newlineIndex).toString("utf8").trim();
  return {
    message: JSON.parse(line),
    remaining: buffer.slice(newlineIndex + 1),
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

export function nexusMcpGatewayServerId(options: {
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

const gatewayServerId = nexusMcpGatewayServerId;

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

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an object`);
  }
  return value as Record<string, unknown>;
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
