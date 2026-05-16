export type NexusPluginCapabilityKind =
  | "projected_skill"
  | "mcp_server"
  | "setup_obligation"
  | "environment_hint"
  | "cleanup_hook"
  | "agent_affordance";

export type NexusPluginCleanupHookTrigger =
  | "before_run"
  | "after_run"
  | "manual";

export interface NexusPluginCapabilityBase {
  kind: NexusPluginCapabilityKind;
  id: string;
  description?: string;
}

export interface NexusPluginProjectedSkillCapability
  extends NexusPluginCapabilityBase {
  kind: "projected_skill";
  skillId: string;
  targetAgents?: string[];
}

export interface NexusPluginMcpToolCapability {
  name: string;
  description?: string;
}

export interface NexusPluginMcpServerCapability
  extends NexusPluginCapabilityBase {
  kind: "mcp_server";
  serverName: string;
  tools?: NexusPluginMcpToolCapability[];
}

export interface NexusPluginSetupObligationCapability
  extends NexusPluginCapabilityBase {
  kind: "setup_obligation";
  description: string;
  required?: boolean;
}

export interface NexusPluginEnvironmentHintCapability
  extends NexusPluginCapabilityBase {
  kind: "environment_hint";
  variable: string;
  valueHint?: string;
  required?: boolean;
}

export interface NexusPluginCleanupHookCapability
  extends NexusPluginCapabilityBase {
  kind: "cleanup_hook";
  description: string;
  trigger?: NexusPluginCleanupHookTrigger;
  required?: boolean;
}

export interface NexusPluginAgentAffordanceCapability
  extends NexusPluginCapabilityBase {
  kind: "agent_affordance";
  description: string;
}

export type NexusPluginCapabilityRecord =
  | NexusPluginProjectedSkillCapability
  | NexusPluginMcpServerCapability
  | NexusPluginSetupObligationCapability
  | NexusPluginEnvironmentHintCapability
  | NexusPluginCleanupHookCapability
  | NexusPluginAgentAffordanceCapability;

export interface NexusProjectPluginConfig {
  id: string;
  enabled: boolean;
  name?: string;
  version?: string;
  capabilities: NexusPluginCapabilityRecord[];
}

export type NexusProjectPluginsConfig = NexusProjectPluginConfig[];

export type NexusPluginCapabilityProjectionRecord =
  | {
      kind: "projected_skill";
      id: string;
      description: string | null;
      skillId: string;
      targetAgents: string[];
    }
  | {
      kind: "mcp_server";
      id: string;
      description: string | null;
      serverName: string;
      tools: Array<{
        name: string;
        description: string | null;
      }>;
    }
  | {
      kind: "setup_obligation";
      id: string;
      description: string;
      required: boolean;
    }
  | {
      kind: "environment_hint";
      id: string;
      description: string | null;
      variable: string;
      valueHint: string | null;
      required: boolean;
    }
  | {
      kind: "cleanup_hook";
      id: string;
      description: string;
      trigger: NexusPluginCleanupHookTrigger | null;
      required: boolean;
    }
  | {
      kind: "agent_affordance";
      id: string;
      description: string;
    };

export interface NexusPluginCapabilityProjection {
  pluginId: string;
  pluginName: string | null;
  version: string | null;
  capabilityCount: number;
  capabilities: NexusPluginCapabilityProjectionRecord[];
}

export function projectPluginCapabilityProjections(config: {
  plugins?: NexusProjectPluginsConfig;
}): NexusPluginCapabilityProjection[] {
  return (config.plugins ?? [])
    .filter((plugin) => plugin.enabled !== false)
    .map((plugin) => {
      const capabilities = plugin.capabilities.map(projectCapabilityRecord);
      return {
        pluginId: plugin.id,
        pluginName: plugin.name ?? null,
        version: plugin.version ?? null,
        capabilityCount: capabilities.length,
        capabilities,
      };
    });
}

function projectCapabilityRecord(
  capability: NexusPluginCapabilityRecord,
): NexusPluginCapabilityProjectionRecord {
  if (capability.kind === "projected_skill") {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description ?? null,
      skillId: capability.skillId,
      targetAgents: capability.targetAgents ?? [],
    };
  }

  if (capability.kind === "mcp_server") {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description ?? null,
      serverName: capability.serverName,
      tools: (capability.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description ?? null,
      })),
    };
  }

  if (capability.kind === "setup_obligation") {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description,
      required: capability.required ?? false,
    };
  }

  if (capability.kind === "environment_hint") {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description ?? null,
      variable: capability.variable,
      valueHint: capability.valueHint ?? null,
      required: capability.required ?? false,
    };
  }

  if (capability.kind === "cleanup_hook") {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description,
      trigger: capability.trigger ?? null,
      required: capability.required ?? false,
    };
  }

  return {
    kind: capability.kind,
    id: capability.id,
    description: capability.description,
  };
}
