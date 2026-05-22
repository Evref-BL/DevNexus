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
      case "mcp_gateway_call": {
        const projectRoot = requiredString(args, "projectRoot", "arguments");
        const index = buildNexusMcpGatewayIndex({
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
  const recordPath = gatewayResultRecordPath(projectRoot, resultId);
  if (!fs.existsSync(recordPath)) {
    throw new Error(`Gateway result record not found: ${resultId}`);
  }
  return JSON.parse(fs.readFileSync(recordPath, "utf8")) as NexusMcpGatewayResultRecord;
}

function gatewayResultRecordPath(projectRoot: string, resultId: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".dev-nexus",
    "mcp-gateway",
    "results",
    `${resultId}.json`,
  );
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
