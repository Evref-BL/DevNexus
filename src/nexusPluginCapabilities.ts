import type { NexusMcpExposureMode } from "./nexusMcpExposurePolicy.js";

export type NexusPluginCapabilityKind =
  | "projected_skill"
  | "mcp_server"
  | "setup_obligation"
  | "environment_hint"
  | "cleanup_hook"
  | "agent_affordance"
  | "dependency_projection"
  | "worker_context_fragment"
  | "worker_briefing_fragment";

export type NexusPluginWorkerFragmentCapabilityKind =
  | "worker_context_fragment"
  | "worker_briefing_fragment";

export type NexusPluginCleanupHookTrigger =
  | "before_run"
  | "after_run"
  | "manual";

export type NexusPluginDependencyProjectionSourceControl =
  | "support"
  | "source";

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
  command?: string;
  args?: string[];
  targetAgents?: string[];
  exposure?: NexusMcpExposureMode;
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

export interface NexusPluginDependencyProjectionCapability
  extends NexusPluginCapabilityBase {
  kind: "dependency_projection";
  sourceComponentId?: string;
  source: string;
  target: string;
  required?: boolean;
  sourceControl?: NexusPluginDependencyProjectionSourceControl;
  targetAgents?: string[];
  targetComponents?: string[];
  reason?: string;
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
  | NexusPluginDependencyProjectionCapability
  | NexusPluginWorkerFragmentCapability;

export interface NexusProjectPluginConfig {
  id: string;
  enabled: boolean;
  name?: string;
  version?: string;
  mcpExposure?: NexusMcpExposureMode;
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
      exposure: NexusMcpExposureMode | null;
      targetAgents: string[];
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
      kind: "dependency_projection";
      id: string;
      description: string | null;
      sourceComponentId?: string;
      source: string;
      target: string;
      required: boolean;
      sourceControl: NexusPluginDependencyProjectionSourceControl;
      targetAgents: string[];
      targetComponents: string[];
      reason: string | null;
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
  activeAgents?: string[];
}

export interface NexusPluginDependencyProjectionSource {
  pluginId: string;
  pluginName: string | null;
  version: string | null;
  capabilityId: string;
}

export interface NexusPluginDependencyProjection {
  kind: "dependency_projection";
  id: string;
  description: string | null;
  sourceComponentId?: string;
  source: string;
  target: string;
  required: boolean;
  sourceControl: NexusPluginDependencyProjectionSourceControl;
  targetAgents: string[];
  targetComponents: string[];
  reason: string | null;
  pluginSource: NexusPluginDependencyProjectionSource;
}

export interface ProjectPluginDependencyProjectionsOptions {
  componentId?: string | null;
  agent?: string | null;
  activeAgents?: string[];
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

export function projectPluginDependencyProjections(
  config: { plugins?: NexusProjectPluginsConfig },
  options: ProjectPluginDependencyProjectionsOptions = {},
): NexusPluginDependencyProjection[] {
  return (config.plugins ?? [])
    .filter((plugin) => plugin.enabled !== false)
    .flatMap((plugin) =>
      plugin.capabilities
        .filter(isDependencyProjectionCapability)
        .filter((capability) =>
          dependencyProjectionMatchesScope(capability, options),
        )
        .map((capability) => projectDependencyProjection(plugin, capability)),
    )
    .sort(compareProjectedDependencyProjections);
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
      exposure: capability.exposure ?? null,
      targetAgents: capability.targetAgents ?? [],
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

  if (isDependencyProjectionCapability(capability)) {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description ?? null,
      ...(capability.sourceComponentId
        ? { sourceComponentId: capability.sourceComponentId }
        : {}),
      source: capability.source,
      target: capability.target,
      required: capability.required ?? false,
      sourceControl: capability.sourceControl ?? "support",
      targetAgents: capability.targetAgents ?? [],
      targetComponents: capability.targetComponents ?? [],
      reason: capability.reason ?? null,
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

function projectDependencyProjection(
  plugin: NexusProjectPluginConfig,
  capability: NexusPluginDependencyProjectionCapability,
): NexusPluginDependencyProjection {
  return {
    kind: capability.kind,
    id: capability.id,
    description: capability.description ?? null,
    ...(capability.sourceComponentId
      ? { sourceComponentId: capability.sourceComponentId }
      : {}),
    source: capability.source,
    target: capability.target,
    required: capability.required ?? false,
    sourceControl: capability.sourceControl ?? "support",
    targetAgents: capability.targetAgents ?? [],
    targetComponents: capability.targetComponents ?? [],
    reason: capability.reason ?? null,
    pluginSource: {
      pluginId: plugin.id,
      pluginName: plugin.name ?? null,
      version: plugin.version ?? null,
      capabilityId: capability.id,
    },
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

function isDependencyProjectionCapability(
  capability: NexusPluginCapabilityRecord,
): capability is NexusPluginDependencyProjectionCapability {
  return capability.kind === "dependency_projection";
}

function isWorkerFragmentCapability(
  capability: NexusPluginCapabilityRecord,
): capability is NexusPluginWorkerFragmentCapability {
  return (
    capability.kind === "worker_context_fragment" ||
    capability.kind === "worker_briefing_fragment"
  );
}

function dependencyProjectionMatchesScope(
  capability: NexusPluginDependencyProjectionCapability,
  options: ProjectPluginDependencyProjectionsOptions,
): boolean {
  return (
    targetMatches(capability.targetComponents, options.componentId) &&
    targetAgentMatches(capability.targetAgents, options)
  );
}

function workerFragmentMatchesScope(
  capability: NexusPluginWorkerFragmentCapability,
  options: ProjectPluginWorkerFragmentsOptions,
): boolean {
  return (
    targetMatches(capability.targetComponents, options.componentId) &&
    targetAgentMatches(capability.targetAgents, options)
  );
}

function targetAgentMatches(
  targets: string[] | undefined,
  options: { agent?: string | null; activeAgents?: string[] },
): boolean {
  if (options.agent) {
    return targetMatches(targets, options.agent);
  }
  if (!targets || targets.length === 0 || !options.activeAgents) {
    return true;
  }

  const activeAgents = new Set(options.activeAgents);
  return targets.some((target) => activeAgents.has(target));
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

function compareProjectedDependencyProjections(
  left: NexusPluginDependencyProjection,
  right: NexusPluginDependencyProjection,
): number {
  return (
    compareStrings(left.pluginSource.pluginId, right.pluginSource.pluginId) ||
    compareStrings(left.id, right.id) ||
    compareStrings(left.source, right.source) ||
    compareStrings(left.target, right.target)
  );
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
