import type {
  NexusPluginMcpServerCapability,
  NexusProjectPluginConfig,
} from "./nexusPluginCapabilities.js";
import {
  activeNexusProjectMcpAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";

export type NexusMcpExposureMode = "direct" | "gateway" | "hidden" | "inherit";
export type NexusResolvedMcpExposureMode = Exclude<NexusMcpExposureMode, "inherit">;

export type NexusMcpExposureSource =
  | "server"
  | "plugin"
  | "agent_target"
  | "workspace"
  | "built_in"
  | "plugin_disabled"
  | "target_agent_filter";

export interface NexusMcpExposureResolution {
  applicable: boolean;
  mode: NexusResolvedMcpExposureMode;
  source: NexusMcpExposureSource;
  declaredMode: NexusMcpExposureMode | null;
  path: string | null;
  reason: string;
}

export interface ResolveNexusMcpExposureOptions {
  workspaceExposure?: NexusMcpExposureMode;
  agentTarget?: Pick<NexusProjectAgentMcpTarget, "agent" | "provider" | "exposure"> | null;
  plugin?: Pick<NexusProjectPluginConfig, "id" | "enabled" | "mcpExposure"> | null;
  server?: Pick<
    NexusPluginMcpServerCapability,
    "kind" | "id" | "serverName" | "targetAgents" | "exposure"
  > | null;
}

export interface NexusPluginMcpServerExposureResolution
  extends NexusMcpExposureResolution {
  pluginId: string;
  capabilityId: string;
  serverName: string;
  agent: string;
}

export function isNexusMcpExposureMode(value: unknown): value is NexusMcpExposureMode {
  return (
    value === "direct" ||
    value === "gateway" ||
    value === "hidden" ||
    value === "inherit"
  );
}

export function resolveNexusMcpExposure(
  options: ResolveNexusMcpExposureOptions,
): NexusMcpExposureResolution {
  const agentName = options.agentTarget?.agent ?? options.agentTarget?.provider ?? null;
  if (options.plugin?.enabled === false) {
    return {
      applicable: false,
      mode: "hidden",
      source: "plugin_disabled",
      declaredMode: null,
      path: pluginPath(options.plugin.id, "enabled"),
      reason: `Plugin ${options.plugin.id} is disabled.`,
    };
  }

  const targetAgents = options.server?.targetAgents ?? [];
  if (
    agentName &&
    targetAgents.length > 0 &&
    !targetAgents.some((targetAgent) => sameAgent(targetAgent, agentName))
  ) {
    return {
      applicable: false,
      mode: "hidden",
      source: "target_agent_filter",
      declaredMode: null,
      path: serverPath(options.plugin?.id, options.server, "targetAgents"),
      reason: `MCP server ${options.server?.serverName ?? "unknown"} does not target agent ${agentName}.`,
    };
  }

  const candidates: Array<{
    mode: NexusMcpExposureMode | undefined;
    source: Exclude<NexusMcpExposureSource, "built_in" | "plugin_disabled" | "target_agent_filter">;
    path: string;
    reason: string;
  }> = [
    {
      mode: options.server?.exposure,
      source: "server",
      path: serverPath(options.plugin?.id, options.server, "exposure"),
      reason: "MCP server exposure policy selected the mode.",
    },
    {
      mode: options.plugin?.mcpExposure,
      source: "plugin",
      path: pluginPath(options.plugin?.id, "mcpExposure"),
      reason: "Plugin MCP exposure policy selected the mode.",
    },
    {
      mode: options.agentTarget?.exposure,
      source: "agent_target",
      path: agentTargetPath(options.agentTarget?.agent, "exposure"),
      reason: "Agent target MCP exposure policy selected the mode.",
    },
    {
      mode: options.workspaceExposure,
      source: "workspace",
      path: "workspace config.mcp.exposure",
      reason: "Workspace MCP exposure policy selected the mode.",
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.mode || candidate.mode === "inherit") {
      continue;
    }
    return {
      applicable: true,
      mode: candidate.mode,
      source: candidate.source,
      declaredMode: candidate.mode,
      path: candidate.path,
      reason: candidate.reason,
    };
  }

  return {
    applicable: true,
    mode: "direct",
    source: "built_in",
    declaredMode: null,
    path: null,
    reason: "Built-in MCP exposure default preserves existing direct projection behavior.",
  };
}

export function resolveNexusPluginMcpServerExposures(
  config: Pick<NexusProjectConfig, "mcp" | "agentTargets" | "skills" | "plugins">,
  options: { agent?: string } = {},
): NexusPluginMcpServerExposureResolution[] {
  const agentTargets = selectedMcpAgentTargets(config, options.agent);
  return agentTargets.flatMap((agentTarget) =>
    (config.plugins ?? [])
      .filter((plugin) => plugin.enabled !== false)
      .flatMap((plugin) =>
        plugin.capabilities
          .filter((capability): capability is NexusPluginMcpServerCapability =>
            capability.kind === "mcp_server"
          )
          .map((server) => ({
            pluginId: plugin.id,
            capabilityId: server.id,
            serverName: server.serverName,
            agent: agentTarget.agent,
            ...resolveNexusMcpExposure({
              workspaceExposure: config.mcp?.exposure,
              agentTarget,
              plugin,
              server,
            }),
          })),
      )
      .filter((resolution) => resolution.applicable),
  );
}

function selectedMcpAgentTargets(
  config: Pick<NexusProjectConfig, "mcp" | "agentTargets" | "skills">,
  selectedAgent?: string,
): NexusProjectAgentMcpTarget[] {
  const targets = activeNexusProjectMcpAgentTargets(config);
  if (!selectedAgent) {
    return targets;
  }
  const normalized = selectedAgent.trim().toLowerCase();
  return targets.filter(
    (target) =>
      sameAgent(target.agent, normalized) ||
      (target.provider !== undefined && sameAgent(target.provider, normalized)),
  );
}

function sameAgent(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function pluginPath(pluginId: string | undefined, field: string): string {
  return `workspace config.plugins.${pluginId ?? "<plugin>"}.${field}`;
}

function serverPath(
  pluginId: string | undefined,
  server: Pick<NexusPluginMcpServerCapability, "id"> | null | undefined,
  field: string,
): string {
  return `workspace config.plugins.${pluginId ?? "<plugin>"}.capabilities.${server?.id ?? "<server>"}.${field}`;
}

function agentTargetPath(agent: string | undefined, field: string): string {
  return `workspace config.mcp.agentTargets.${agent ?? "<agent>"}.${field}`;
}
