import path from "node:path";
import {
  defaultNexusMcpServerName,
  resolveNexusProjectAgentMcpTargets,
} from "../agents/nexusAgentMcpConfig.js";
import { listDevNexusMcpTools } from "./nexusMcpServer.js";
import {
  resolveNexusMcpExposure,
  type NexusMcpExposureSource,
  type NexusResolvedMcpExposureMode,
} from "./nexusMcpExposurePolicy.js";
import {
  effectiveNexusMcpGatewayPolicy,
  listDevNexusMcpGatewayTools,
  nexusMcpGatewayServerId,
  nexusMcpGatewayToolAllowed,
  readNexusMcpGatewayDiscoveryRecord,
  type NexusMcpGatewayDiscoveryTool,
  type NexusMcpGatewayEffectivePolicy,
} from "./nexusMcpGateway.js";
import type {
  NexusPluginMcpServerCapability,
  NexusProjectPluginConfig,
} from "../project/nexusPluginCapabilities.js";
import {
  loadProjectConfig,
  selectNexusProjectMcpAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";

export interface NexusMcpContextBudgetReportOptions {
  projectRoot: string;
  agents?: string[];
  topLimit?: number;
}

export type NexusMcpContextBudgetSource = "direct" | "plugin";
export type NexusMcpContextBudgetMetadataStatus =
  | "known"
  | "declared"
  | "discovered"
  | "unknown";

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
  contextImpact: NexusMcpContextBudgetImpact;
  directServers: NexusMcpContextBudgetDirectServer[];
  pluginDeclaredServers: NexusMcpContextBudgetPluginServer[];
  topServers: NexusMcpContextBudgetServerContribution[];
  topTools: NexusMcpContextBudgetToolContribution[];
  warnings: string[];
}

export interface NexusMcpContextBudgetImpact {
  directToolCount: number;
  directEstimatedBytes: number;
  directEstimatedTokens: number;
  gatewaySurfaceToolCount: number;
  gatewaySurfaceEstimatedBytes: number;
  gatewaySurfaceEstimatedTokens: number;
  gatewayRoutedToolCount: number;
  gatewayRoutedEstimatedBytes: number;
  gatewayRoutedEstimatedTokens: number;
  hiddenToolCount: number;
  hiddenEstimatedBytes: number;
  hiddenEstimatedTokens: number;
  withoutGatewayEstimatedBytes: number;
  withoutGatewayEstimatedTokens: number;
  visibleEstimatedBytes: number;
  visibleEstimatedTokens: number;
  savedBytes: number;
  savedTokens: number;
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
  const directServerEntries = directTargets.map((target) => {
    const unfilteredMetadata = directServerToolMetadata(target.serverName, target.args);
    const configuredTarget = findConfiguredTarget(selectedTargets, target.agent);
    const exposure = resolveNexusMcpExposure({
      workspaceExposure: projectConfig.mcp?.exposure,
      agentTarget: configuredTarget ?? {
        agent: target.agent,
        provider: target.provider,
      },
    });
    const metadata = exposure.mode === "gateway"
      ? filterServerToolMetadataByGatewayPolicy({
          metadata: unfilteredMetadata,
          projectConfig,
          agentTarget: configuredTarget,
          serverName: target.serverName,
        })
      : unfilteredMetadata;
    return {
      server: {
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
      },
      tools: metadata.tools,
    };
  });
  const directServers = directServerEntries.map((entry) => entry.server);
  const pluginDeclaredServers = pluginMcpServers(
    projectRoot,
    projectConfig,
    selectedTargets,
  );
  const directToolContributions = directServerEntries.flatMap(
    (entry) => entry.tools,
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
  const contextImpact = buildContextImpact({
    directServers,
    pluginServers: pluginDeclaredServers,
  });

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
    contextImpact,
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
  projectRoot: string,
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
          const agentTarget = selectedTargets[0] ?? null;
          const exposure = resolveNexusMcpExposure({
            workspaceExposure: projectConfig.mcp?.exposure,
            agentTarget,
            plugin,
            server: capability,
          });
          const metadata = pluginServerMetadata({
            projectRoot,
            projectConfig,
            agentTarget,
            plugin,
            capability,
            exposureMode: exposure.mode,
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

function pluginServerMetadata(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  agentTarget: NexusProjectAgentMcpTarget | null;
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginMcpServerCapability;
  exposureMode: NexusResolvedMcpExposureMode;
}): ServerToolMetadata {
  const declaredTools = options.capability.tools ?? [];
  const discoveredTools = declaredTools.length === 0
    ? readDiscoveredPluginTools(options)
    : [];
  const tools = [
    ...declaredTools.map((tool) => {
      const estimatedBytes = estimateMetadataBytes({
        name: tool.name,
        description: tool.description ?? null,
      });
      return {
        source: "plugin" as const,
        serverName: options.capability.serverName,
        toolName: tool.name,
        description: tool.description ?? null,
        estimatedBytes,
        estimatedTokens: estimateTokens(estimatedBytes),
      };
    }),
    ...discoveredTools.map((tool) => {
      const estimatedBytes = estimateMetadataBytes({
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? null,
      });
      return {
        source: "plugin" as const,
        serverName: options.capability.serverName,
        toolName: tool.name,
        description: tool.description ?? null,
        estimatedBytes,
        estimatedTokens: estimateTokens(estimatedBytes),
      };
    }),
  ];
  const filteredTools = options.exposureMode === "gateway"
    ? filterToolContributionsByGatewayPolicy({
        tools,
        policy: effectiveNexusMcpGatewayPolicy(
          options.projectConfig,
          options.agentTarget,
        ),
        serverName: options.capability.serverName,
      })
    : tools;
  const estimatedBytes = filteredTools.reduce(
    (total, tool) => total + tool.estimatedBytes,
    0,
  );
  return {
    tools: filteredTools,
    estimatedBytes,
    estimatedTokens: estimateTokens(estimatedBytes),
    metadataStatus: pluginMetadataStatus(declaredTools.length, discoveredTools.length),
  };
}

function readDiscoveredPluginTools(options: {
  projectRoot: string;
  agentTarget: NexusProjectAgentMcpTarget | null;
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginMcpServerCapability;
}): NexusMcpGatewayDiscoveryTool[] {
  if (!options.agentTarget || !options.capability.command) {
    return [];
  }
  const record = readNexusMcpGatewayDiscoveryRecord(
    options.projectRoot,
    nexusMcpGatewayServerId({
      agent: options.agentTarget.agent,
      source: "plugin",
      pluginId: options.plugin.id,
      capabilityId: options.capability.id,
      serverName: options.capability.serverName,
    }),
  );
  if (!record) {
    return [];
  }
  if (
    record.command !== options.capability.command ||
    !sameStringArray(record.args, options.capability.args ?? [])
  ) {
    return [];
  }
  return record.tools;
}

function pluginMetadataStatus(
  declaredToolCount: number,
  discoveredToolCount: number,
): NexusMcpContextBudgetMetadataStatus {
  if (declaredToolCount > 0) {
    return "declared";
  }
  if (discoveredToolCount > 0) {
    return "discovered";
  }
  return "unknown";
}

function filterServerToolMetadataByGatewayPolicy(options: {
  metadata: ServerToolMetadata;
  projectConfig: NexusProjectConfig;
  agentTarget: NexusProjectAgentMcpTarget | null;
  serverName: string;
}): ServerToolMetadata {
  const tools = filterToolContributionsByGatewayPolicy({
    tools: options.metadata.tools,
    policy: effectiveNexusMcpGatewayPolicy(
      options.projectConfig,
      options.agentTarget,
    ),
    serverName: options.serverName,
  });
  const estimatedBytes = tools.reduce((total, tool) => total + tool.estimatedBytes, 0);
  return {
    tools,
    estimatedBytes,
    estimatedTokens: estimateTokens(estimatedBytes),
    metadataStatus: options.metadata.metadataStatus,
  };
}

function filterToolContributionsByGatewayPolicy(options: {
  tools: readonly NexusMcpContextBudgetToolContribution[];
  policy: NexusMcpGatewayEffectivePolicy;
  serverName: string;
}): NexusMcpContextBudgetToolContribution[] {
  return options.tools.filter((tool) =>
    nexusMcpGatewayToolAllowed({
      policy: options.policy,
      serverName: options.serverName,
      toolName: tool.toolName,
    })
  );
}

function gatewaySurfaceMetadata(): Pick<ServerToolMetadata, "tools" | "estimatedBytes" | "estimatedTokens"> {
  const tools = listDevNexusMcpGatewayTools().map((tool) => {
    const estimatedBytes = estimateMetadataBytes({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    return {
      source: "direct" as const,
      serverName: defaultNexusMcpServerName,
      toolName: tool.name,
      description: tool.description,
      estimatedBytes,
      estimatedTokens: estimateTokens(estimatedBytes),
    };
  });
  const estimatedBytes = tools.reduce((total, tool) => total + tool.estimatedBytes, 0);
  return {
    tools,
    estimatedBytes,
    estimatedTokens: estimateTokens(estimatedBytes),
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
    toolCount: server.toolCount,
    estimatedBytes: server.estimatedBytes,
    estimatedTokens: server.estimatedTokens,
    metadataStatus: server.metadataStatus,
  };
}

function buildContextImpact(options: {
  directServers: readonly NexusMcpContextBudgetDirectServer[];
  pluginServers: readonly NexusMcpContextBudgetPluginServer[];
}): NexusMcpContextBudgetImpact {
  const servers = [...options.directServers, ...options.pluginServers];
  const direct = sumServersByExposure(servers, "direct");
  const gatewayRouted = sumServersByExposure(servers, "gateway");
  const hidden = sumServersByExposure(servers, "hidden");
  const gatewaySurface = gatewayRouted.toolCount > 0
    ? gatewaySurfaceMetadata()
    : { tools: [], estimatedBytes: 0, estimatedTokens: 0 };
  const withoutGatewayEstimatedBytes =
    direct.estimatedBytes + gatewayRouted.estimatedBytes;
  const visibleEstimatedBytes =
    direct.estimatedBytes + gatewaySurface.estimatedBytes;
  const savedBytes = withoutGatewayEstimatedBytes - visibleEstimatedBytes;

  return {
    directToolCount: direct.toolCount,
    directEstimatedBytes: direct.estimatedBytes,
    directEstimatedTokens: estimateTokens(direct.estimatedBytes),
    gatewaySurfaceToolCount: gatewaySurface.tools.length,
    gatewaySurfaceEstimatedBytes: gatewaySurface.estimatedBytes,
    gatewaySurfaceEstimatedTokens: estimateTokens(gatewaySurface.estimatedBytes),
    gatewayRoutedToolCount: gatewayRouted.toolCount,
    gatewayRoutedEstimatedBytes: gatewayRouted.estimatedBytes,
    gatewayRoutedEstimatedTokens: estimateTokens(gatewayRouted.estimatedBytes),
    hiddenToolCount: hidden.toolCount,
    hiddenEstimatedBytes: hidden.estimatedBytes,
    hiddenEstimatedTokens: estimateTokens(hidden.estimatedBytes),
    withoutGatewayEstimatedBytes,
    withoutGatewayEstimatedTokens: estimateTokens(withoutGatewayEstimatedBytes),
    visibleEstimatedBytes,
    visibleEstimatedTokens: estimateTokens(visibleEstimatedBytes),
    savedBytes,
    savedTokens: estimateSignedTokens(savedBytes),
  };
}

function sumServersByExposure(
  servers: ReadonlyArray<
    NexusMcpContextBudgetDirectServer | NexusMcpContextBudgetPluginServer
  >,
  exposure: NexusResolvedMcpExposureMode,
): { toolCount: number; estimatedBytes: number } {
  return servers
    .filter((server) => server.effectiveExposure === exposure)
    .reduce(
      (total, server) => ({
        toolCount: total.toolCount + server.toolCount,
        estimatedBytes: total.estimatedBytes + server.estimatedBytes,
      }),
      { toolCount: 0, estimatedBytes: 0 },
    );
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

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function estimateMetadataBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / APPROXIMATE_TOKEN_BYTES);
}

function estimateSignedTokens(bytes: number): number {
  return bytes >= 0 ? estimateTokens(bytes) : -estimateTokens(Math.abs(bytes));
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
