import path from "node:path";
import {
  defaultNexusMcpServerName,
  resolveNexusProjectAgentMcpTargets,
} from "./nexusAgentMcpConfig.js";
import { listDevNexusMcpTools } from "./nexusMcpServer.js";
import {
  resolveNexusMcpExposure,
  type NexusMcpExposureSource,
  type NexusResolvedMcpExposureMode,
} from "./nexusMcpExposurePolicy.js";
import type { NexusPluginMcpServerCapability } from "./nexusPluginCapabilities.js";
import {
  loadProjectConfig,
  selectNexusProjectMcpAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";

export interface NexusMcpContextBudgetReportOptions {
  projectRoot: string;
  agents?: string[];
  topLimit?: number;
}

export type NexusMcpContextBudgetSource = "direct" | "plugin";
export type NexusMcpContextBudgetMetadataStatus = "known" | "declared" | "unknown";

export interface NexusMcpContextBudgetToolContribution {
  source: NexusMcpContextBudgetSource;
  serverName: string;
  toolName: string;
  description: string | null;
  estimatedBytes: number;
  estimatedTokens: number;
}

export interface NexusMcpContextBudgetDirectServer {
  source: "direct";
  agent: string;
  provider: string;
  serverName: string;
  command: string;
  args: string[];
  configPathRelative: string;
  toolCount: number;
  estimatedBytes: number;
  estimatedTokens: number;
  metadataStatus: NexusMcpContextBudgetMetadataStatus;
  effectiveExposure: NexusResolvedMcpExposureMode;
  exposureSource: NexusMcpExposureSource;
  exposureReason: string;
}

export interface NexusMcpContextBudgetPluginServer {
  source: "plugin";
  pluginId: string;
  pluginName: string | null;
  pluginVersion: string | null;
  capabilityId: string;
  serverName: string;
  command: string | null;
  args: string[];
  targetAgents: string[];
  declaredToolCount: number;
  toolCount: number;
  declaredTools: NexusMcpContextBudgetToolContribution[];
  estimatedBytes: number;
  estimatedTokens: number;
  metadataStatus: NexusMcpContextBudgetMetadataStatus;
  materializationStatus: "declared" | "missing_command" | "no_matching_target";
  effectiveExposure: NexusResolvedMcpExposureMode;
  exposureSource: NexusMcpExposureSource;
  exposureReason: string;
}

export interface NexusMcpContextBudgetServerContribution {
  source: NexusMcpContextBudgetSource;
  serverName: string;
  agent: string | null;
  pluginId: string | null;
  toolCount: number;
  estimatedBytes: number;
  estimatedTokens: number;
  metadataStatus: NexusMcpContextBudgetMetadataStatus;
}

export interface NexusMcpContextBudgetReport {
  ok: true;
  projectRoot: string;
  totals: {
    directTargetCount: number;
    directServerCount: number;
    pluginDeclaredServerCount: number;
    knownToolCount: number;
    estimatedBytes: number;
    estimatedTokens: number;
  };
  directServers: NexusMcpContextBudgetDirectServer[];
  pluginDeclaredServers: NexusMcpContextBudgetPluginServer[];
  topServers: NexusMcpContextBudgetServerContribution[];
  topTools: NexusMcpContextBudgetToolContribution[];
  warnings: string[];
}

interface ServerToolMetadata {
  tools: NexusMcpContextBudgetToolContribution[];
  estimatedBytes: number;
  estimatedTokens: number;
  metadataStatus: NexusMcpContextBudgetMetadataStatus;
}

const DEFAULT_TOP_LIMIT = 10;
const APPROXIMATE_TOKEN_BYTES = 4;

export function buildNexusMcpContextBudgetReport(
  options: NexusMcpContextBudgetReportOptions,
): NexusMcpContextBudgetReport {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const selectedTargets = selectNexusProjectMcpAgentTargets(
    projectConfig,
    options.agents ?? [],
  );
  const directTargets = resolveNexusProjectAgentMcpTargets({
    projectRoot,
    mcpConfig: projectConfig.mcp,
    agentTargets: selectedTargets,
  });
  const topLimit = options.topLimit ?? DEFAULT_TOP_LIMIT;
  const directServers = directTargets.map((target) => {
    const metadata = directServerToolMetadata(target.serverName, target.args);
    const configuredTarget = findConfiguredTarget(selectedTargets, target.agent);
    const exposure = resolveNexusMcpExposure({
      workspaceExposure: projectConfig.mcp?.exposure,
      agentTarget: configuredTarget ?? {
        agent: target.agent,
        provider: target.provider,
      },
    });
    return {
      source: "direct" as const,
      agent: target.agent,
      provider: target.provider,
      serverName: target.serverName,
      command: target.command,
      args: target.args,
      configPathRelative: target.configPathRelative,
      toolCount: metadata.tools.length,
      estimatedBytes: metadata.estimatedBytes,
      estimatedTokens: metadata.estimatedTokens,
      metadataStatus: metadata.metadataStatus,
      effectiveExposure: exposure.mode,
      exposureSource: exposure.source,
      exposureReason: exposure.reason,
    };
  });
  const pluginDeclaredServers = pluginMcpServers(projectConfig, selectedTargets);
  const directToolContributions = directTargets.flatMap((target) =>
    directServerToolMetadata(target.serverName, target.args).tools,
  );
  const pluginToolContributions = pluginDeclaredServers.flatMap(
    (server) => server.declaredTools,
  );
  const topTools = [...directToolContributions, ...pluginToolContributions]
    .sort(compareToolContributions)
    .slice(0, topLimit);
  const topServers = [
    ...directServers.map(serverContributionFromDirectServer),
    ...pluginDeclaredServers.map(serverContributionFromPluginServer),
  ]
    .sort(compareServerContributions)
    .slice(0, topLimit);
  const estimatedBytes = [...directServers, ...pluginDeclaredServers].reduce(
    (total, server) => total + server.estimatedBytes,
    0,
  );
  const knownToolCount = [...directServers, ...pluginDeclaredServers].reduce(
    (total, server) => total + server.toolCount,
    0,
  );

  return {
    ok: true,
    projectRoot,
    totals: {
      directTargetCount: directServers.length,
      directServerCount: new Set(directServers.map((server) => server.serverName)).size,
      pluginDeclaredServerCount: pluginDeclaredServers.length,
      knownToolCount,
      estimatedBytes,
      estimatedTokens: estimateTokens(estimatedBytes),
    },
    directServers,
    pluginDeclaredServers,
    topServers,
    topTools,
    warnings: budgetWarnings(directServers, pluginDeclaredServers),
  };
}

function directServerToolMetadata(
  serverName: string,
  args: readonly string[],
): ServerToolMetadata {
  if (serverName !== defaultNexusMcpServerName && !args.includes("mcp-stdio")) {
    return {
      tools: [],
      estimatedBytes: 0,
      estimatedTokens: 0,
      metadataStatus: "unknown",
    };
  }

  const tools = listDevNexusMcpTools().map((tool) => {
    const estimatedBytes = estimateMetadataBytes({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    return {
      source: "direct" as const,
      serverName,
      toolName: tool.name,
      description: tool.description,
      estimatedBytes,
      estimatedTokens: estimateTokens(estimatedBytes),
    };
  });

  return {
    tools,
    estimatedBytes: tools.reduce((total, tool) => total + tool.estimatedBytes, 0),
    estimatedTokens: estimateTokens(
      tools.reduce((total, tool) => total + tool.estimatedBytes, 0),
    ),
    metadataStatus: "known",
  };
}

function pluginMcpServers(
  projectConfig: NexusProjectConfig,
  selectedTargets: readonly NexusProjectAgentMcpTarget[],
): NexusMcpContextBudgetPluginServer[] {
  return (projectConfig.plugins ?? [])
    .filter((plugin) => plugin.enabled !== false)
    .flatMap((plugin) =>
      plugin.capabilities
        .filter((capability): capability is NexusPluginMcpServerCapability =>
          capability.kind === "mcp_server"
        )
        .map((capability) => {
          const targetAgents = capability.targetAgents ?? [];
          const metadata = pluginServerMetadata(capability);
          const exposure = resolveNexusMcpExposure({
            workspaceExposure: projectConfig.mcp?.exposure,
            agentTarget: selectedTargets[0] ?? null,
            plugin,
            server: capability,
          });
          return {
            source: "plugin" as const,
            pluginId: plugin.id,
            pluginName: plugin.name ?? null,
            pluginVersion: plugin.version ?? null,
            capabilityId: capability.id,
            serverName: capability.serverName,
            command: capability.command ?? null,
            args: [...(capability.args ?? [])],
            targetAgents,
            declaredToolCount: capability.tools?.length ?? 0,
            toolCount: metadata.tools.length,
            declaredTools: metadata.tools,
            estimatedBytes: metadata.estimatedBytes,
            estimatedTokens: metadata.estimatedTokens,
            metadataStatus: metadata.metadataStatus,
            materializationStatus: pluginMaterializationStatus(
              capability,
              selectedTargets.map((target) => target.agent),
            ),
            effectiveExposure: exposure.mode,
            exposureSource: exposure.source,
            exposureReason: exposure.reason,
          };
        }),
    );
}

function findConfiguredTarget(
  targets: readonly NexusProjectAgentMcpTarget[],
  agent: string,
): NexusProjectAgentMcpTarget | null {
  const normalized = agent.trim().toLowerCase();
  return (
    targets.find((target) => target.agent.trim().toLowerCase() === normalized) ??
    null
  );
}

function pluginServerMetadata(
  capability: NexusPluginMcpServerCapability,
): ServerToolMetadata {
  const tools = (capability.tools ?? []).map((tool) => {
    const estimatedBytes = estimateMetadataBytes({
      name: tool.name,
      description: tool.description ?? null,
    });
    return {
      source: "plugin" as const,
      serverName: capability.serverName,
      toolName: tool.name,
      description: tool.description ?? null,
      estimatedBytes,
      estimatedTokens: estimateTokens(estimatedBytes),
    };
  });
  const estimatedBytes = tools.reduce((total, tool) => total + tool.estimatedBytes, 0);
  return {
    tools,
    estimatedBytes,
    estimatedTokens: estimateTokens(estimatedBytes),
    metadataStatus: tools.length > 0 ? "declared" : "unknown",
  };
}

function pluginMaterializationStatus(
  capability: NexusPluginMcpServerCapability,
  selectedAgents: readonly string[],
): NexusMcpContextBudgetPluginServer["materializationStatus"] {
  if (!capability.command) {
    return "missing_command";
  }
  const targetAgents = capability.targetAgents ?? [];
  if (
    targetAgents.length > 0 &&
    selectedAgents.length > 0 &&
    !targetAgents.some((agent) => selectedAgents.includes(agent))
  ) {
    return "no_matching_target";
  }
  return "declared";
}

function serverContributionFromDirectServer(
  server: NexusMcpContextBudgetDirectServer,
): NexusMcpContextBudgetServerContribution {
  return {
    source: "direct",
    serverName: server.serverName,
    agent: server.agent,
    pluginId: null,
    toolCount: server.toolCount,
    estimatedBytes: server.estimatedBytes,
    estimatedTokens: server.estimatedTokens,
    metadataStatus: server.metadataStatus,
  };
}

function serverContributionFromPluginServer(
  server: NexusMcpContextBudgetPluginServer,
): NexusMcpContextBudgetServerContribution {
  return {
    source: "plugin",
    serverName: server.serverName,
    agent: null,
    pluginId: server.pluginId,
    toolCount: server.declaredToolCount,
    estimatedBytes: server.estimatedBytes,
    estimatedTokens: server.estimatedTokens,
    metadataStatus: server.metadataStatus,
  };
}

function budgetWarnings(
  directServers: readonly NexusMcpContextBudgetDirectServer[],
  pluginServers: readonly NexusMcpContextBudgetPluginServer[],
): string[] {
  return [
    ...directServers
      .filter((server) => server.metadataStatus === "unknown")
      .map((server) =>
        `No tool metadata is available for direct MCP server ${server.serverName}.`
      ),
    ...pluginServers
      .filter((server) => server.metadataStatus === "unknown")
      .map((server) =>
        `No tool metadata is declared for plugin MCP server ${server.serverName}.`
      ),
  ];
}

function estimateMetadataBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / APPROXIMATE_TOKEN_BYTES);
}

function compareToolContributions(
  left: NexusMcpContextBudgetToolContribution,
  right: NexusMcpContextBudgetToolContribution,
): number {
  return (
    right.estimatedBytes - left.estimatedBytes ||
    left.serverName.localeCompare(right.serverName) ||
    left.toolName.localeCompare(right.toolName)
  );
}

function compareServerContributions(
  left: NexusMcpContextBudgetServerContribution,
  right: NexusMcpContextBudgetServerContribution,
): number {
  return (
    right.estimatedBytes - left.estimatedBytes ||
    left.serverName.localeCompare(right.serverName)
  );
}
