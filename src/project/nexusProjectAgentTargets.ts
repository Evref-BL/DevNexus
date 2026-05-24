import type {
  NexusProjectSkillsConfig,
  NexusProjectSkillAgentTarget,
  NexusSkillSourceControl,
} from "../agents/nexusSkills.js";
import type { NexusMcpExposureMode } from "../mcp/nexusMcpExposureTypes.js";

export type NexusProjectAgentMcpConfigFormat = "toml" | "json" | "manual";

export interface NexusMcpGatewayPolicyConfig {
  includedServers?: string[];
  includedTools?: string[];
  excludedTools?: string[];
}

export interface NexusProjectAgentMcpTarget {
  agent: string;
  provider?: string;
  enabled?: boolean;
  configPath?: string;
  configFormat?: NexusProjectAgentMcpConfigFormat;
  configSchema?: string;
  sourceControl?: NexusSkillSourceControl;
  serverName?: string;
  command?: string;
  args?: string[];
  defaultToolsApprovalMode?: string;
  exposure?: NexusMcpExposureMode;
  gateway?: NexusMcpGatewayPolicyConfig;
  activationNotes?: string[];
  trustSemantics?: string;
  manualInstructions?: string[];
}

export interface NexusProjectMcpConfig {
  enabled?: boolean;
  sourceControl?: NexusSkillSourceControl;
  exposure?: NexusMcpExposureMode;
  serverName?: string;
  command?: string;
  args?: string[];
  defaultToolsApprovalMode?: string;
  agentTargets?: NexusProjectAgentMcpTarget[];
  gateway?: NexusMcpGatewayPolicyConfig;
}

export type NexusProjectActiveAgentProvider =
  | "codex"
  | "claude"
  | "opencode"
  | "manual"
  | "custom";

export type NexusProjectAgentProjectionSource =
  | "explicit"
  | "legacy"
  | "default"
  | "disabled";

export interface NexusProjectActiveAgentMcpSettings {
  enabled?: boolean;
  configPath?: string;
  configFormat?: NexusProjectAgentMcpConfigFormat;
  configSchema?: string;
  sourceControl?: NexusSkillSourceControl;
  serverName?: string;
  command?: string;
  args?: string[];
  defaultToolsApprovalMode?: string;
  exposure?: NexusMcpExposureMode;
  activationNotes?: string[];
  trustSemantics?: string;
  manualInstructions?: string[];
}

export interface NexusProjectActiveAgentSkillSettings {
  enabled?: boolean;
  directory?: string;
  sourceControl?: NexusSkillSourceControl;
}

export interface NexusProjectActiveAgentTargetConfig {
  provider: NexusProjectActiveAgentProvider;
  enabled?: true;
  sourceControl?: NexusSkillSourceControl;
  mcp?: NexusProjectActiveAgentMcpSettings;
  skills?: NexusProjectActiveAgentSkillSettings;
  setupNotes?: string[];
}

export interface NexusProjectAgentTargetsConfig {
  active: NexusProjectActiveAgentTargetConfig[];
}

export interface NormalizedNexusProjectAgentProjection<TTarget> {
  enabled: boolean;
  source: NexusProjectAgentProjectionSource;
  target: TTarget | null;
}

export interface NormalizedNexusProjectAgentTarget {
  provider: NexusProjectActiveAgentProvider | string;
  enabled: true;
  sourceControl: NexusSkillSourceControl;
  mcp: NormalizedNexusProjectAgentProjection<NexusProjectAgentMcpTarget>;
  skills: NormalizedNexusProjectAgentProjection<NexusProjectSkillAgentTarget>;
  setupNotes: string[];
  compatibilitySource: "explicit" | "legacy";
}

export interface NormalizedNexusProjectAgentTargets {
  explicit: boolean;
  targets: NormalizedNexusProjectAgentTarget[];
  recommendations: string[];
}

export interface NexusProjectAgentTargetConfigSource {
  agentTargets?: NexusProjectAgentTargetsConfig;
  mcp?: NexusProjectMcpConfig;
  skills?: NexusProjectSkillsConfig;
}

export function normalizeNexusProjectAgentTargets(
  config: NexusProjectAgentTargetConfigSource,
): NormalizedNexusProjectAgentTargets {
  if (config.agentTargets) {
    return {
      explicit: true,
      targets: config.agentTargets.active.map(normalizeExplicitAgentTarget),
      recommendations: [],
    };
  }

  const targets = normalizeLegacyAgentTargets(config);
  return {
    explicit: false,
    targets,
    recommendations: targets.length > 0
      ? [
          "Workspace uses legacy mcp.agentTargets and skills.agentTargets compatibility; add workspace config.agentTargets.active to make active provider selection explicit.",
        ]
      : [],
  };
}

export function activeNexusProjectMcpAgentTargets(
  config: NexusProjectAgentTargetConfigSource,
): NexusProjectAgentMcpTarget[] {
  return normalizeNexusProjectAgentTargets(config).targets.flatMap((target) =>
    target.mcp.enabled && target.mcp.target ? [target.mcp.target] : [],
  );
}

export function activeNexusProjectSkillAgentTargets(
  config: NexusProjectAgentTargetConfigSource,
): NexusProjectSkillAgentTarget[] {
  return normalizeNexusProjectAgentTargets(config).targets.flatMap((target) =>
    target.skills.enabled && target.skills.target ? [target.skills.target] : [],
  );
}

export function activeNexusProjectAgentProviders(
  config: NexusProjectAgentTargetConfigSource,
): string[] {
  return normalizeNexusProjectAgentTargets(config).targets.map(
    (target) => target.provider,
  );
}

export function selectNexusProjectMcpAgentTargets(
  config: NexusProjectAgentTargetConfigSource,
  selectedAgents: readonly string[],
): NexusProjectAgentMcpTarget[] {
  const activeTargets = activeNexusProjectMcpAgentTargets(config);
  if (selectedAgents.length === 0) {
    return activeTargets;
  }

  return selectedAgents.map((agent) =>
    findConfiguredMcpTarget(config, activeTargets, agent) ?? { agent },
  );
}

function findConfiguredMcpTarget(
  config: Pick<NexusProjectAgentTargetConfigSource, "mcp">,
  activeTargets: readonly NexusProjectAgentMcpTarget[],
  agent: string,
): NexusProjectAgentMcpTarget | null {
  const selected = agent.trim().toLowerCase();
  return (
    activeTargets.find((target) => mcpTargetMatchesSelection(target, selected)) ??
    config.mcp?.agentTargets?.find((target) =>
      target.enabled !== false && mcpTargetMatchesSelection(target, selected),
    ) ??
    null
  );
}

function mcpTargetMatchesSelection(
  target: NexusProjectAgentMcpTarget,
  selected: string,
): boolean {
  return (
    target.agent.trim().toLowerCase() === selected ||
    (target.provider ?? target.agent).trim().toLowerCase() === selected
  );
}

function normalizeExplicitAgentTarget(
  target: NexusProjectActiveAgentTargetConfig,
): NormalizedNexusProjectAgentTarget {
  const sourceControl = target.sourceControl ?? "support";
  const mcpEnabled = target.mcp?.enabled !== false;
  const skillsEnabled = target.skills?.enabled !== false;

  return {
    provider: target.provider,
    enabled: true,
    sourceControl,
    mcp: mcpEnabled
      ? {
          enabled: true,
          source: "explicit",
          target: activeMcpSettingsToLegacyTarget(target, sourceControl),
        }
      : {
          enabled: false,
          source: "disabled",
          target: null,
        },
    skills: skillsEnabled
      ? {
          enabled: true,
          source: "explicit",
          target: activeSkillSettingsToLegacyTarget(target, sourceControl),
        }
      : {
          enabled: false,
          source: "disabled",
          target: null,
        },
    setupNotes: target.setupNotes ?? [],
    compatibilitySource: "explicit",
  };
}

function activeMcpSettingsToLegacyTarget(
  target: NexusProjectActiveAgentTargetConfig,
  sourceControl: NexusSkillSourceControl,
): NexusProjectAgentMcpTarget {
  const settings = target.mcp;
  return {
    agent: target.provider,
    provider: target.provider,
    sourceControl: settings?.sourceControl ?? sourceControl,
    ...(settings?.configPath !== undefined ? { configPath: settings.configPath } : {}),
    ...(settings?.configFormat !== undefined ? { configFormat: settings.configFormat } : {}),
    ...(settings?.configSchema !== undefined ? { configSchema: settings.configSchema } : {}),
    ...(settings?.serverName !== undefined ? { serverName: settings.serverName } : {}),
    ...(settings?.command !== undefined ? { command: settings.command } : {}),
    ...(settings?.args !== undefined ? { args: settings.args } : {}),
    ...(settings?.defaultToolsApprovalMode !== undefined
      ? { defaultToolsApprovalMode: settings.defaultToolsApprovalMode }
      : {}),
    ...(settings?.exposure !== undefined ? { exposure: settings.exposure } : {}),
    ...(settings?.activationNotes !== undefined
      ? { activationNotes: settings.activationNotes }
      : {}),
    ...(settings?.trustSemantics !== undefined ? { trustSemantics: settings.trustSemantics } : {}),
    ...(settings?.manualInstructions !== undefined
      ? { manualInstructions: settings.manualInstructions }
      : {}),
  };
}

function activeSkillSettingsToLegacyTarget(
  target: NexusProjectActiveAgentTargetConfig,
  sourceControl: NexusSkillSourceControl,
): NexusProjectSkillAgentTarget {
  const settings = target.skills;
  return {
    agent: target.provider,
    sourceControl: settings?.sourceControl ?? sourceControl,
    ...(settings?.directory !== undefined ? { directory: settings.directory } : {}),
  };
}

function normalizeLegacyAgentTargets(
  config: Pick<NexusProjectAgentTargetConfigSource, "mcp" | "skills">,
): NormalizedNexusProjectAgentTarget[] {
  const targets = new Map<string, NormalizedNexusProjectAgentTarget>();
  const ensureTarget = (provider: string): NormalizedNexusProjectAgentTarget => {
    const existing = targets.get(provider);
    if (existing) {
      return existing;
    }
    const created: NormalizedNexusProjectAgentTarget = {
      provider,
      enabled: true,
      sourceControl: "support",
      mcp: {
        enabled: false,
        source: "disabled",
        target: null,
      },
      skills: {
        enabled: false,
        source: "disabled",
        target: null,
      },
      setupNotes: [],
      compatibilitySource: "legacy",
    };
    targets.set(provider, created);
    return created;
  };

  if (config.mcp?.enabled !== false) {
    const mcpTargets = config.mcp?.agentTargets ?? [{ agent: "codex" }];
    const mcpSource: NexusProjectAgentProjectionSource =
      config.mcp?.agentTargets ? "legacy" : "default";
    for (const target of mcpTargets.filter((entry) => entry.enabled !== false)) {
      const provider = legacyMcpProvider(target);
      const normalized = ensureTarget(provider);
      normalized.sourceControl =
        target.sourceControl ?? config.mcp?.sourceControl ?? normalized.sourceControl;
      normalized.mcp = {
        enabled: true,
        source: mcpSource,
        target: {
          ...target,
          provider: target.provider ?? provider,
        },
      };
    }
  }

  for (const target of (config.skills?.agentTargets ?? []).filter(
    (entry) => entry.enabled !== false,
  )) {
    const provider = target.agent.trim().toLowerCase();
    const normalized = ensureTarget(provider);
    normalized.sourceControl =
      target.sourceControl ?? config.skills?.sourceControl ?? normalized.sourceControl;
    normalized.skills = {
      enabled: true,
      source: "legacy",
      target,
    };
  }

  return [...targets.values()];
}

function legacyMcpProvider(target: NexusProjectAgentMcpTarget): string {
  return (target.provider ?? target.agent).trim().toLowerCase();
}
