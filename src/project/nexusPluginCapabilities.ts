import type { NexusMcpExposureMode } from "../mcp/nexusMcpExposureTypes.js";

export const devNexusPluginCatalogueSecurityRationale =
  "DevNexus keeps plugin discovery on a curated allowlist so agents and dashboards do not turn arbitrary packages, component source roots, or a public marketplace into executable setup or MCP guidance before trust, signing, permission diffs, and revocation policy exist.";

export interface NexusPluginCatalogueEntry {
  id: string;
  name: string;
  packageName: string;
  version: string | null;
  description: string;
  repositoryUrl: string;
  configExportName: string;
  installCommand: string;
  sourcePath: null;
}

const devNexusPluginCatalogueEntries: NexusPluginCatalogueEntry[] = [
  {
    id: "dev-nexus-typescript",
    name: "DevNexus TypeScript",
    packageName: "@evref-bl/dev-nexus-typescript",
    version: "0.1.0-alpha.1",
    description: "TypeScript and JavaScript tooling plugin for DevNexus worktrees.",
    repositoryUrl: "https://github.com/Evref-BL/DevNexus-TypeScript",
    configExportName: "devNexusTypeScriptDevNexusPluginConfig",
    installCommand: "npm install --save-dev @evref-bl/dev-nexus-typescript",
    sourcePath: null,
  },
  {
    id: "dev-nexus-pharo",
    name: "DevNexus-Pharo",
    packageName: "@evref-bl/dev-nexus-pharo",
    version: "0.1.0-alpha.10",
    description: "Pharo specialization layer for DevNexus, PLexus, and Pharo project workspaces.",
    repositoryUrl: "https://github.com/Evref-BL/DevNexus-Pharo",
    configExportName: "devNexusPharoDevNexusPluginConfig",
    installCommand: "npm install --save-dev @evref-bl/dev-nexus-pharo",
    sourcePath: null,
  },
  {
    id: "dev-nexus-research",
    name: "DevNexus Research",
    packageName: "@evref-bl/dev-nexus-research",
    version: "0.1.0-alpha.0",
    description: "Research and LaTeX paper-writing workflow plugin for DevNexus.",
    repositoryUrl: "https://github.com/Evref-BL/DevNexus-Research",
    configExportName: "devNexusResearchDevNexusPluginConfig",
    installCommand: "npm install --save-dev @evref-bl/dev-nexus-research",
    sourcePath: null,
  },
];

export function listDevNexusPluginCatalogue(): NexusPluginCatalogueEntry[] {
  return devNexusPluginCatalogueEntries.map((entry) => ({ ...entry }));
}

export function findDevNexusPluginCatalogueEntry(
  idOrPackageName: string,
): NexusPluginCatalogueEntry | null {
  const normalized = normalizePluginCatalogueKey(idOrPackageName);
  const entry = devNexusPluginCatalogueEntries.find((candidate) =>
    normalizePluginCatalogueKey(candidate.id) === normalized ||
    normalizePluginCatalogueKey(candidate.packageName) === normalized
  );
  return entry ? { ...entry } : null;
}

export function nexusPluginCatalogueRefreshCommand(
  projectRoot: string,
  entry: NexusPluginCatalogueEntry,
): string {
  return [
    "dev-nexus workspace plugin refresh",
    shellQuote(projectRoot),
    "--from",
    shellQuote(entry.packageName),
    "--export",
    entry.configExportName,
  ].join(" ");
}

function normalizePluginCatalogueKey(value: string): string {
  return value.trim().toLowerCase().replace(/^@[^/]+\//u, "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export type NexusPluginCapabilityKind =
  | "projected_skill"
  | "mcp_server"
  | "agent_package"
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

export type NexusPluginAgentPackageKind =
  | "native"
  | "shim"
  | "bundled_fallback"
  | "manual_guidance";

export type NexusPluginAgentPackageSurface =
  | "skills"
  | "commands"
  | "hooks"
  | "mcp"
  | "scripts"
  | "adapters"
  | "schemas"
  | "templates"
  | "examples"
  | "tests"
  | "references";

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

export type NexusPluginMcpServerTransport = "stdio" | "http";

export interface NexusPluginMcpServerCapability
  extends NexusPluginCapabilityBase {
  kind: "mcp_server";
  serverName: string;
  transport?: NexusPluginMcpServerTransport;
  command?: string;
  args?: string[];
  url?: string;
  targetAgents?: string[];
  exposure?: NexusMcpExposureMode;
  tools?: NexusPluginMcpToolCapability[];
}

export interface NexusPluginAgentPackageCapability
  extends NexusPluginCapabilityBase {
  kind: "agent_package";
  packageKind: NexusPluginAgentPackageKind;
  packageName: string;
  repositoryUrl?: string;
  installCommand?: string;
  checkCommand?: string;
  versionPolicy?: string;
  license?: string;
  provenance?: string;
  required?: boolean;
  targetAgents?: string[];
  surfaces?: NexusPluginAgentPackageSurface[];
  setupInstructions?: string[];
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
  | NexusPluginAgentPackageCapability
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
      transport: NexusPluginMcpServerTransport | null;
      exposure: NexusMcpExposureMode | null;
      url: string | null;
      targetAgents: string[];
      tools: Array<{
        name: string;
        description: string | null;
      }>;
    }
  | {
      kind: "agent_package";
      id: string;
      description: string | null;
      packageKind: NexusPluginAgentPackageKind;
      packageName: string;
      repositoryUrl: string | null;
      installCommand: string | null;
      checkCommand: string | null;
      versionPolicy: string | null;
      license: string | null;
      provenance: string | null;
      required: boolean;
      targetAgents: string[];
      surfaces: NexusPluginAgentPackageSurface[];
      setupInstructions: string[];
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

export interface NexusPluginAgentPackageProjectionSource {
  pluginId: string;
  pluginName: string | null;
  version: string | null;
  capabilityId: string;
}

export interface NexusPluginAgentPackageProjection {
  kind: "agent_package";
  id: string;
  description: string | null;
  packageKind: NexusPluginAgentPackageKind;
  packageName: string;
  repositoryUrl: string | null;
  installCommand: string | null;
  checkCommand: string | null;
  versionPolicy: string | null;
  license: string | null;
  provenance: string | null;
  required: boolean;
  targetAgents: string[];
  surfaces: NexusPluginAgentPackageSurface[];
  setupInstructions: string[];
  pluginSource: NexusPluginAgentPackageProjectionSource;
}

export interface ProjectPluginAgentPackagesOptions {
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

export function projectPluginAgentPackages(
  config: { plugins?: NexusProjectPluginsConfig },
  options: ProjectPluginAgentPackagesOptions = {},
): NexusPluginAgentPackageProjection[] {
  return (config.plugins ?? [])
    .filter((plugin) => plugin.enabled !== false)
    .flatMap((plugin) =>
      plugin.capabilities
        .filter(isAgentPackageCapability)
        .filter((capability) =>
          targetAgentMatches(capability.targetAgents, options),
        )
        .map((capability) => projectAgentPackage(plugin, capability)),
    )
    .sort(compareProjectedAgentPackages);
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
      transport: capability.transport ?? (capability.url ? "http" : null),
      exposure: capability.exposure ?? null,
      url: capability.url ?? null,
      targetAgents: capability.targetAgents ?? [],
      tools: (capability.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description ?? null,
      })),
    };
  }

  if (isAgentPackageCapability(capability)) {
    return {
      kind: capability.kind,
      id: capability.id,
      description: capability.description ?? null,
      packageKind: capability.packageKind,
      packageName: capability.packageName,
      repositoryUrl: capability.repositoryUrl ?? null,
      installCommand: capability.installCommand ?? null,
      checkCommand: capability.checkCommand ?? null,
      versionPolicy: capability.versionPolicy ?? null,
      license: capability.license ?? null,
      provenance: capability.provenance ?? null,
      required: capability.required ?? false,
      targetAgents: capability.targetAgents ?? [],
      surfaces: capability.surfaces ?? [],
      setupInstructions: capability.setupInstructions ?? [],
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

function projectAgentPackage(
  plugin: NexusProjectPluginConfig,
  capability: NexusPluginAgentPackageCapability,
): NexusPluginAgentPackageProjection {
  return {
    kind: capability.kind,
    id: capability.id,
    description: capability.description ?? null,
    packageKind: capability.packageKind,
    packageName: capability.packageName,
    repositoryUrl: capability.repositoryUrl ?? null,
    installCommand: capability.installCommand ?? null,
    checkCommand: capability.checkCommand ?? null,
    versionPolicy: capability.versionPolicy ?? null,
    license: capability.license ?? null,
    provenance: capability.provenance ?? null,
    required: capability.required ?? false,
    targetAgents: capability.targetAgents ?? [],
    surfaces: capability.surfaces ?? [],
    setupInstructions: capability.setupInstructions ?? [],
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

function isAgentPackageCapability(
  capability: NexusPluginCapabilityRecord,
): capability is NexusPluginAgentPackageCapability {
  return capability.kind === "agent_package";
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

function compareProjectedAgentPackages(
  left: NexusPluginAgentPackageProjection,
  right: NexusPluginAgentPackageProjection,
): number {
  return (
    compareStrings(left.pluginSource.pluginId, right.pluginSource.pluginId) ||
    compareStrings(left.id, right.id) ||
    compareStrings(left.packageName, right.packageName)
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
