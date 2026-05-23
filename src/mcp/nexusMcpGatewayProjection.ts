import {
  currentNexusCliScriptPath,
  defaultProjectedNexusMcpCommand,
} from "../agents/nexusAgentMcpConfig.js";
import {
  resolveNexusMcpExposure,
  resolveNexusPluginMcpServerExposures,
} from "./nexusMcpExposurePolicy.js";
import type {
  NexusProjectAgentMcpTarget,
  NexusProjectConfig,
} from "../project/nexusProjectConfig.js";

export const defaultNexusMcpGatewayServerName = "dev_nexus_gateway";
export const defaultNexusMcpGatewayStdioArg = "mcp-gateway-stdio";

export function nexusMcpGatewayAgentTargets(options: {
  projectConfig: NexusProjectConfig;
  selectedTargets: readonly NexusProjectAgentMcpTarget[];
}): NexusProjectAgentMcpTarget[] {
  if (options.projectConfig.mcp?.enabled === false) {
    return [];
  }

  return options.selectedTargets
    .filter((target) =>
      nexusMcpTargetNeedsGateway(options.projectConfig, target)
    )
    .map((target) => ({
      ...target,
      serverName: defaultNexusMcpGatewayServerName,
      command: defaultProjectedNexusMcpCommand,
      args: [currentNexusCliScriptPath(), defaultNexusMcpGatewayStdioArg],
      exposure: "direct",
    }));
}

export function nexusMcpTargetNeedsGateway(
  projectConfig: NexusProjectConfig,
  target: NexusProjectAgentMcpTarget,
): boolean {
  const coreExposure = resolveNexusMcpExposure({
    workspaceExposure: projectConfig.mcp?.exposure,
    agentTarget: target,
  });
  if (coreExposure.mode === "gateway") {
    return true;
  }

  return resolveNexusPluginMcpServerExposures(projectConfig, {
    agent: target.agent,
  }).some((resolution) => resolution.mode === "gateway");
}
