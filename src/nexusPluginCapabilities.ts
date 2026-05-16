export type NexusPluginCapabilityKind =
  | "projected_skill"
  | "mcp_server"
  | "setup_obligation"
  | "environment_hint"
  | "cleanup_hook"
  | "agent_affordance"
  | "worker_context_fragment"
  | "worker_briefing_fragment";

export type NexusPluginWorkerFragmentCapabilityKind =
  | "worker_context_fragment"
  | "worker_briefing_fragment";

export type NexusPluginCleanupHookTrigger =
  | "before_run"
  | "after_run"
  | "manual";

export const nexusPluginWorkerFragmentTitleMaxLength = 160;
export const nexusPluginWorkerFragmentBodyMaxLength = 4000;
export const nexusPluginWorkerFragmentProvenanceMaxLength = 240;

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

export interface NexusPluginWorkerFragmentCapability
  extends NexusPluginCapabilityBase {
  kind: NexusPluginWorkerFragmentCapabilityKind;
  title: string;
  body: string;
  targetAgents?: string[];
  targetComponents?: string[];
  provenance: string;
}

export type NexusPluginCapabilityRecord =
  | NexusPluginProjectedSkillCapability
  | NexusPluginMcpServerCapability
  | NexusPluginSetupObligationCapability
  | NexusPluginEnvironmentHintCapability
  | NexusPluginCleanupHookCapability
  | NexusPluginAgentAffordanceCapability
  | NexusPluginWorkerFragmentCapability;

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
    }
  | {
      kind: NexusPluginWorkerFragmentCapabilityKind;
      id: string;
      description: string | null;
      title: string;
      body: string;
      targetAgents: string[];
      targetComponents: string[];
      provenance: string;
      advisory: true;
    };

export interface NexusPluginCapabilityProjection {
  pluginId: string;
  pluginName: string | null;
  version: string | null;
  capabilityCount: number;
  capabilities: NexusPluginCapabilityProjectionRecord[];
}

export interface NexusPluginWorkerFragmentSource {
  pluginId: string;
  pluginName: string | null;
  version: string | null;
  capabilityId: string;
}

export interface NexusPluginWorkerFragmentProjection {
  kind: NexusPluginWorkerFragmentCapabilityKind;
  id: string;
  title: string;
  body: string;
  provenance: string;
  advisory: true;
  targetAgents: string[];
  targetComponents: string[];
  source: NexusPluginWorkerFragmentSource;
}

export interface NexusPluginWorkerFragmentsProjection {
  context: NexusPluginWorkerFragmentProjection[];
  briefing: NexusPluginWorkerFragmentProjection[];
}

export interface ProjectPluginWorkerFragmentsOptions {
  componentId?: string | null;
  agent?: string | null;
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

export function projectPluginWorkerFragments(
  config: { plugins?: NexusProjectPluginsConfig },
  options: ProjectPluginWorkerFragmentsOptions = {},
): NexusPluginWorkerFragmentsProjection {
  const fragments = (config.plugins ?? [])
    .filter((plugin) => plugin.enabled !== false)
    .flatMap((plugin) =>
      plugin.capabilities
        .filter(isWorkerFragmentCapability)
        .filter((capability) => workerFragmentMatchesScope(capability, options))
        .map((capability) => projectWorkerFragment(plugin, capability)),
    )
    .sort(compareProjectedWorkerFragments);

  return {
    context: fragments.filter(
      (fragment) => fragment.kind === "worker_context_fragment",
    ),
    briefing: fragments.filter(
      (fragment) => fragment.kind === "worker_briefing_fragment",
    ),
  };
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

  if (isWorkerFragmentCapability(capability)) {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description ?? null,
      title: capability.title,
      body: capability.body,
      targetAgents: capability.targetAgents ?? [],
      targetComponents: capability.targetComponents ?? [],
      provenance: capability.provenance,
      advisory: true,
    };
  }

  return {
    kind: capability.kind,
    id: capability.id,
    description: capability.description,
  };
}

function projectWorkerFragment(
  plugin: NexusProjectPluginConfig,
  capability: NexusPluginWorkerFragmentCapability,
): NexusPluginWorkerFragmentProjection {
  return {
    kind: capability.kind,
    id: capability.id,
    title: capability.title,
    body: capability.body,
    provenance: capability.provenance,
    advisory: true,
    targetAgents: capability.targetAgents ?? [],
    targetComponents: capability.targetComponents ?? [],
    source: {
      pluginId: plugin.id,
      pluginName: plugin.name ?? null,
      version: plugin.version ?? null,
      capabilityId: capability.id,
    },
  };
}

function isWorkerFragmentCapability(
  capability: NexusPluginCapabilityRecord,
): capability is NexusPluginWorkerFragmentCapability {
  return (
    capability.kind === "worker_context_fragment" ||
    capability.kind === "worker_briefing_fragment"
  );
}

function workerFragmentMatchesScope(
  capability: NexusPluginWorkerFragmentCapability,
  options: ProjectPluginWorkerFragmentsOptions,
): boolean {
  return (
    targetMatches(capability.targetComponents, options.componentId) &&
    targetMatches(capability.targetAgents, options.agent)
  );
}

function targetMatches(
  targets: string[] | undefined,
  activeTarget: string | null | undefined,
): boolean {
  if (!targets || targets.length === 0 || !activeTarget) {
    return true;
  }

  return targets.includes(activeTarget);
}

function compareProjectedWorkerFragments(
  left: NexusPluginWorkerFragmentProjection,
  right: NexusPluginWorkerFragmentProjection,
): number {
  return (
    compareStrings(left.source.pluginId, right.source.pluginId) ||
    compareStrings(left.id, right.id) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.provenance, right.provenance)
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }

  return 0;
}
