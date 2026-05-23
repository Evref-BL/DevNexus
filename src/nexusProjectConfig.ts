import fs from "node:fs";
import path from "node:path";
import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  LocalWorkTrackingConfig,
  VibeKanbanWorkTrackingConfig,
  WorkTrackingBoardConfig,
  WorkTrackingConfig,
  WorkTrackingProviderName,
  WorkTrackingRepositoryConfig,
  WorkStatus,
} from "./workTrackingTypes.js";
import type {
  NexusProjectSkillsConfig,
  NexusProjectSkillAgentTarget,
  NexusProjectSkillSelection,
  NexusSkillMaterializationMode,
  NexusSkillSourceControl,
} from "./nexusSkills.js";
import {
  nexusPluginWorkerFragmentBodyMaxLength,
  nexusPluginWorkerFragmentProvenanceMaxLength,
  nexusPluginWorkerFragmentTitleMaxLength,
  type NexusPluginCapabilityKind,
  type NexusPluginCapabilityRecord,
  type NexusPluginCleanupHookTrigger,
  type NexusPluginDependencyProjectionSourceControl,
  type NexusPluginMcpToolCapability,
  type NexusProjectPluginConfig,
  type NexusProjectPluginsConfig,
} from "./nexusPluginCapabilities.js";
import {
  devNexusCoreMcpServerName,
  devNexusCoreMcpToolNames,
} from "./nexusCoreMcpTools.js";
import type { NexusMcpExposureMode } from "./nexusMcpExposurePolicy.js";
import {
  validatePartialNexusAutomationPublicationConfig,
  validateNexusAutomationConfig,
  type NexusAutomationConfig,
  type NexusAutomationPublicationConfig,
  type NexusAutomationVerificationConfig,
} from "./nexusAutomationConfig.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import type {
  NexusProjectHostingAccessPrincipalKind,
  NexusProjectHostingAccessRole,
  NexusProjectHostingConfig,
  NexusProjectHostingInvitationPolicy,
  NexusProjectHostingProviderName,
  NexusProjectHostingRequiredPermission,
  NexusProjectHostingRemoteProtocol,
  NexusProjectHostingRemoteRole,
  NexusProjectHostingRepositoryVisibility,
} from "./nexusProjectHosting.js";
import type { NexusProjectHostConfig } from "./nexusHostRegistry.js";
import {
  requiredMutationClassForOperationClasses,
  runnerProfileRequiresApproval,
  type NexusRunnerApprovalRequirementConfig,
  type NexusRunnerArtifactRetentionConfig,
  type NexusRunnerCredentialIdentityPolicyConfig,
  type NexusRunnerMutationClass,
  type NexusRunnerOperationClass,
  type NexusRunnerProfileConfig,
  type NexusRunnerProfileLimitsConfig,
} from "./nexusRunnerProfile.js";
import {
  nexusAuthorityActionNames,
  recommendedNexusAuthorityRoleDefinitions,
  type NexusAuthorityAction,
  type NexusAuthorityActorConfig,
  type NexusAuthorityActorKind,
  type NexusAuthorityConfig,
  type NexusAuthorityRoleBindingConfig,
  type NexusAuthorityRoleDefinitionConfig,
  type NexusAuthorityScopeConfig,
} from "./nexusAuthority.js";
import {
  validateNexusVersionPlanningConfig,
  type NexusVersionPlanningConfig,
} from "./nexusVersionPlanningConfig.js";
import { validateNexusCiTierPolicyConfig } from "./nexusCiTierPolicy.js";
import {
  validateNexusReviewPolicyConfig,
  type NexusReviewPolicyConfig,
} from "./nexusReviewPolicy.js";

export const devNexusProjectConfigFileName = "dev-nexus.project.json";
export const nexusProjectWorktreesDirectoryName = "worktrees";

export type NexusProjectRepoKind = "local" | "git";

export interface NexusProjectRepoConfig {
  kind: NexusProjectRepoKind;
  remoteUrl: string | null;
  defaultBranch: string | null;
  sourceRoot?: string;
}

export type NexusProjectComponentRole =
  | "primary"
  | "extension"
  | "addon"
  | "dependency"
  | "optional";

export type NexusProjectComponentRelationshipKind =
  | "extends"
  | "depends_on"
  | "optional"
  | "related";

export interface NexusProjectComponentRelationshipConfig {
  kind: NexusProjectComponentRelationshipKind;
  componentId: string;
}

export type NexusProjectWorkTrackerRole =
  | "primary"
  | "eligible_source"
  | "external_inbox"
  | "mirror"
  | "coordination"
  | "planning"
  | "external_feedback"
  | "migration"
  | "archive";

export type NexusProjectTrackerDiscoveryDirectExternalSelection =
  | "disabled"
  | "allowed";

export type NexusProjectTrackerDiscoveryConflictWinner =
  | "block"
  | "default_tracker"
  | "scanned_tracker";

export type NexusProjectTrackerDiscoveryMissingCredentialBehavior =
  | "block"
  | "skip";

export type NexusProjectTrackerCoordinationHandoffPolicy =
  | "comment"
  | "silent";

export interface NexusProjectTrackerCommunicationPolicyConfig {
  coordinationHandoffs?: NexusProjectTrackerCoordinationHandoffPolicy;
}

export interface NormalizedNexusProjectTrackerCommunicationPolicy {
  coordinationHandoffs: NexusProjectTrackerCoordinationHandoffPolicy;
}

export interface NexusProjectTrackerDiscoveryFingerprintConfig {
  id: string;
  trackerId?: string;
  provider?: WorkTrackingProviderName;
  host?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  itemId?: string;
  itemNumber?: number;
  itemKey?: string;
  nodeId?: string;
}

export interface NexusProjectTrackerDiscoveryPolicyConfig {
  scannedRoles: NexusProjectWorkTrackerRole[];
  directExternalSelection: NexusProjectTrackerDiscoveryDirectExternalSelection;
  importRequiredFirst: boolean;
  providerFilters: WorkTrackingProviderName[];
  queryLimit: number | null;
  trackerLimits?: Record<string, number>;
  finalLimit?: number | null;
  statuses?: WorkStatus[];
  labels?: string[];
  milestones?: string[];
  assignees?: string[];
  providerQuery?: string | null;
  fingerprints?: NexusProjectTrackerDiscoveryFingerprintConfig[];
  conflictWinner: NexusProjectTrackerDiscoveryConflictWinner;
  missingCredentialBehavior: NexusProjectTrackerDiscoveryMissingCredentialBehavior;
}

export interface NormalizedNexusProjectTrackerDiscoveryPolicy
  extends Omit<
    NexusProjectTrackerDiscoveryPolicyConfig,
    | "assignees"
    | "finalLimit"
    | "labels"
    | "milestones"
    | "providerQuery"
    | "statuses"
    | "fingerprints"
    | "trackerLimits"
  > {
  trackerLimits: Record<string, number>;
  finalLimit: number | null;
  statuses: WorkStatus[];
  labels: string[];
  milestones: string[];
  assignees: string[];
  providerQuery: string | null;
  fingerprints: NexusProjectTrackerDiscoveryFingerprintConfig[];
  defaultTrackerOnly: boolean;
}

export interface NexusProjectWorkTrackerBindingConfig {
  id: string;
  name: string;
  enabled: boolean;
  roles: NexusProjectWorkTrackerRole[];
  communication?: NexusProjectTrackerCommunicationPolicyConfig;
  workTracking: WorkTrackingConfig;
}

export interface NormalizedNexusProjectWorkTrackers {
  defaultTrackerId: string | null;
  defaultTracker: NexusProjectWorkTrackerBindingConfig | null;
  trackers: NexusProjectWorkTrackerBindingConfig[];
  discoveryPolicy: NormalizedNexusProjectTrackerDiscoveryPolicy;
}

export interface NexusProjectComponentConfig {
  id: string;
  name: string;
  kind: NexusProjectRepoKind;
  role: NexusProjectComponentRole;
  remoteUrl: string | null;
  defaultBranch: string | null;
  sourceRoot?: string;
  worktreesRoot?: string;
  workTracking?: WorkTrackingConfig;
  defaultWorkTrackerId?: string;
  workTrackers?: NexusProjectWorkTrackerBindingConfig[];
  trackerDiscovery?: NexusProjectTrackerDiscoveryPolicyConfig;
  review?: NexusReviewPolicyConfig;
  verification?: Partial<NexusAutomationVerificationConfig>;
  publication?: Partial<NexusAutomationPublicationConfig>;
  relationships: NexusProjectComponentRelationshipConfig[];
}

export interface NexusAgentConfig {
  executor?: string;
  model?: string;
  reasoning?: string;
}

export interface NexusProjectKanbanConfig {
  provider: "vibe-kanban";
  projectId: string | null;
}

export type NexusProjectExtensionsConfig = Record<string, Record<string, unknown>>;

export type NexusProjectAgentMcpConfigFormat = "toml" | "json" | "manual";

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

export interface NexusMcpGatewayPolicyConfig {
  includedServers?: string[];
  includedTools?: string[];
  excludedTools?: string[];
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

export interface NexusProjectConfig {
  version: 1;
  id: string;
  name: string;
  home: string | null;
  repo: NexusProjectRepoConfig;
  components: NexusProjectComponentConfig[];
  worktreesRoot: string;
  kanban?: NexusProjectKanbanConfig;
  workTracking?: WorkTrackingConfig;
  workTrackerCommunication?: NexusProjectTrackerCommunicationPolicyConfig;
  extensions?: NexusProjectExtensionsConfig;
  agent?: NexusAgentConfig;
  agentTargets?: NexusProjectAgentTargetsConfig;
  mcp?: NexusProjectMcpConfig;
  skills?: NexusProjectSkillsConfig;
  plugins?: NexusProjectPluginsConfig;
  hosting?: NexusProjectHostingConfig;
  automation?: NexusAutomationConfig;
  hosts?: NexusProjectHostConfig[];
  runnerProfiles?: NexusRunnerProfileConfig[];
  authority?: NexusAuthorityConfig;
  versionPlanning?: NexusVersionPlanningConfig;
}

export interface ResolveNexusAgentConfigOptions {
  issue?: NexusAgentConfig;
  project?: Pick<NexusProjectConfig, "agent"> | NexusAgentConfig;
  home?: { agent?: NexusAgentConfig } | NexusAgentConfig;
  fallback?: NexusAgentConfig;
}

export class NexusConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusConfigError";
  }
}

export const defaultNexusProjectTrackerDiscoveryPolicy: NexusProjectTrackerDiscoveryPolicyConfig = {
  scannedRoles: ["primary"],
  directExternalSelection: "disabled",
  importRequiredFirst: true,
  providerFilters: [],
  queryLimit: 50,
  trackerLimits: {},
  finalLimit: null,
  statuses: [],
  labels: [],
  milestones: [],
  assignees: [],
  providerQuery: null,
  fingerprints: [],
  conflictWinner: "default_tracker",
  missingCredentialBehavior: "block",
};

export function defaultNexusProjectTrackerCommunicationPolicy(
  provider: WorkTrackingProviderName | string,
): NormalizedNexusProjectTrackerCommunicationPolicy {
  return {
    coordinationHandoffs: provider === "local" ? "comment" : "silent",
  };
}

export function normalizeNexusProjectTrackerCommunicationPolicy(options: {
  provider: WorkTrackingProviderName | string;
  project?: NexusProjectTrackerCommunicationPolicyConfig;
  tracker?: NexusProjectTrackerCommunicationPolicyConfig;
}): NormalizedNexusProjectTrackerCommunicationPolicy {
  const fallback = defaultNexusProjectTrackerCommunicationPolicy(options.provider);

  return {
    coordinationHandoffs:
      options.tracker?.coordinationHandoffs ??
      options.project?.coordinationHandoffs ??
      fallback.coordinationHandoffs,
  };
}

export function projectConfigPath(projectRootPath: string): string {
  return path.join(path.resolve(projectRootPath), devNexusProjectConfigFileName);
}

function resolveFromProject(projectRootPath: string, value: string): string {
  return resolveNexusProjectPath({
    projectRoot: path.resolve(projectRootPath),
    value,
  });
}

export function projectWorktreesRootPath(
  projectRootPath: string,
  config?: Pick<NexusProjectConfig, "worktreesRoot">,
): string {
  return resolveFromProject(
    projectRootPath,
    config?.worktreesRoot ?? nexusProjectWorktreesDirectoryName,
  );
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function requiredBoundedString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
  maxLength: number,
): string {
  const value = requiredString(record, key, pathName);
  if (value.length > maxLength) {
    throw new NexusConfigError(
      `${pathName}.${key} must be at most ${maxLength} characters`,
    );
  }

  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function requiredProjectRelativePath(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = requiredString(record, key, pathName).trim();
  if (
    value.split(/[\\/]/u).some((part) => part === "..") ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a project-relative path`,
    );
  }

  return value;
}

function requiredDependencyProjectionTargetPath(
  record: Record<string, unknown>,
  pathName: string,
  allowsOutsideWorker: boolean,
): string {
  const value = requiredString(record, "target", pathName).trim();
  if (
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    throw new NexusConfigError(
      `${pathName}.target must be a relative path`,
    );
  }
  if (
    !allowsOutsideWorker &&
    value.split(/[\\/]/u).some((part) => part === "..")
  ) {
    throw new NexusConfigError(
      `${pathName}.target must be a project-relative path unless sourceComponentId is declared`,
    );
  }

  return value;
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

export function validateNexusAgentConfig(
  value: unknown,
  pathName: string,
): NexusAgentConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const agent = compactAgentConfig({
    executor: optionalString(record, "executor", pathName),
    model: optionalString(record, "model", pathName),
    reasoning: optionalString(record, "reasoning", pathName),
  });
  if (Object.keys(agent).length === 0) {
    throw new NexusConfigError(
      `${pathName} must define executor, model, or reasoning`,
    );
  }

  return agent;
}

function compactAgentConfig(
  config: NexusAgentConfig | undefined,
): NexusAgentConfig {
  const compacted: NexusAgentConfig = {};
  if (config?.executor) {
    compacted.executor = config.executor;
  }
  if (config?.model) {
    compacted.model = config.model;
  }
  if (config?.reasoning) {
    compacted.reasoning = config.reasoning;
  }

  return compacted;
}

function agentConfigFromSource(
  source:
    | Pick<NexusProjectConfig, "agent">
    | { agent?: NexusAgentConfig }
    | NexusAgentConfig
    | undefined,
): NexusAgentConfig {
  if (!source) {
    return {};
  }

  if (Object.prototype.hasOwnProperty.call(source, "agent")) {
    return compactAgentConfig((source as { agent?: NexusAgentConfig }).agent);
  }

  return compactAgentConfig(source as NexusAgentConfig);
}

export function resolveNexusAgentConfig(
  options: ResolveNexusAgentConfigOptions,
): NexusAgentConfig {
  return compactAgentConfig({
    ...agentConfigFromSource(options.fallback),
    ...agentConfigFromSource(options.home),
    ...agentConfigFromSource(options.project),
    ...agentConfigFromSource(options.issue),
  });
}

export function normalizeNexusProjectAgentTargets(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
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
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
): NexusProjectAgentMcpTarget[] {
  return normalizeNexusProjectAgentTargets(config).targets.flatMap((target) =>
    target.mcp.enabled && target.mcp.target ? [target.mcp.target] : [],
  );
}

export function activeNexusProjectSkillAgentTargets(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
): NexusProjectSkillAgentTarget[] {
  return normalizeNexusProjectAgentTargets(config).targets.flatMap((target) =>
    target.skills.enabled && target.skills.target ? [target.skills.target] : [],
  );
}

export function activeNexusProjectAgentProviders(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
): string[] {
  return normalizeNexusProjectAgentTargets(config).targets.map(
    (target) => target.provider,
  );
}

export function selectNexusProjectMcpAgentTargets(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
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
  config: Pick<NexusProjectConfig, "mcp">,
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
    ...(settings?.trustSemantics !== undefined
      ? { trustSemantics: settings.trustSemantics }
      : {}),
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
  config: Pick<NexusProjectConfig, "mcp" | "skills">,
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

const nexusAuthorityActionNameSet = new Set<string>(nexusAuthorityActionNames);
const nexusAuthorityScopeKeys = [
  "project",
  "component",
  "provider",
  "tracker",
  "repository",
  "targetBranch",
  "environment",
] as const;

function validateNexusAuthorityActorKind(
  value: unknown,
  pathName: string,
): NexusAuthorityActorKind {
  if (
    value === "human" ||
    value === "machine_user" ||
    value === "service_account" ||
    value === "external_agent" ||
    value === "local" ||
    value === "team"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be human, machine_user, service_account, external_agent, local, or team`,
  );
}

function validateNexusAuthorityActor(
  value: unknown,
  index: number,
): NexusAuthorityActorConfig {
  const pathName = `workspace config.authority.actors[${index}]`;
  const record = assertRecord(value, pathName);
  const handles = optionalStringRecord(record, "handles", pathName);

  return {
    id: requiredString(record, "id", pathName),
    kind: validateNexusAuthorityActorKind(record.kind, `${pathName}.kind`),
    provider: nullableString(record, "provider", pathName),
    providerIdentity: requiredString(record, "providerIdentity", pathName),
    displayName: requiredString(record, "displayName", pathName),
    ...(handles ? { handles } : {}),
  };
}

function validateNexusAuthorityActors(
  value: unknown,
): NexusAuthorityActorConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.authority.actors must be an array");
  }

  const actors = value.map((item, index) =>
    validateNexusAuthorityActor(item, index),
  );
  const actorIds = new Set<string>();
  for (const actor of actors) {
    if (actorIds.has(actor.id)) {
      throw new NexusConfigError(
        `workspace config.authority.actors contains duplicate id: ${actor.id}`,
      );
    }
    actorIds.add(actor.id);
  }

  return actors;
}

function validateNexusAuthorityAction(
  value: unknown,
  pathName: string,
): NexusAuthorityAction {
  if (typeof value === "string" && nexusAuthorityActionNameSet.has(value)) {
    return value as NexusAuthorityAction;
  }

  throw new NexusConfigError(
    `${pathName} must be one of ${nexusAuthorityActionNames.join(", ")}`,
  );
}

function validateNexusAuthorityActions(
  value: unknown,
  pathName: string,
): NexusAuthorityAction[] {
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName} must not be empty`);
  }

  const actions = value.map((action, index) =>
    validateNexusAuthorityAction(action, `${pathName}[${index}]`),
  );
  assertUniqueValues(actions, pathName);

  return actions;
}

function validateNexusAuthorityRoleDefinition(
  value: unknown,
  index: number,
): NexusAuthorityRoleDefinitionConfig {
  const pathName = `workspace config.authority.roles[${index}]`;
  const record = assertRecord(value, pathName);
  const name = optionalString(record, "name", pathName);
  const description = optionalString(record, "description", pathName);

  return {
    id: requiredString(record, "id", pathName),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    actions: validateNexusAuthorityActions(record.actions, `${pathName}.actions`),
  };
}

function validateNexusAuthorityRoles(
  value: unknown,
): NexusAuthorityRoleDefinitionConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.authority.roles must be an array");
  }

  const roles = value.map((item, index) =>
    validateNexusAuthorityRoleDefinition(item, index),
  );
  const roleIds = new Set<string>();
  for (const role of roles) {
    if (roleIds.has(role.id)) {
      throw new NexusConfigError(
        `workspace config.authority.roles contains duplicate id: ${role.id}`,
      );
    }
    roleIds.add(role.id);
  }

  return roles;
}

function validateNexusAuthorityScope(
  value: unknown,
  pathName: string,
): NexusAuthorityScopeConfig {
  if (value === undefined) {
    throw new NexusConfigError(`${pathName} must contain at least one scope`);
  }

  const record = assertRecord(value, pathName);
  const scope: NexusAuthorityScopeConfig = {};
  for (const key of nexusAuthorityScopeKeys) {
    const scopeValue = optionalString(record, key, pathName);
    if (scopeValue !== undefined) {
      scope[key] = scopeValue;
    }
  }

  if (Object.keys(scope).length === 0) {
    throw new NexusConfigError(`${pathName} must contain at least one scope`);
  }

  return scope;
}

function validateNexusAuthorityBindingRoles(
  value: unknown,
  pathName: string,
  knownRoleIds: Set<string>,
): string[] {
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName} must not be empty`);
  }

  const roles = value.map((role, index) => {
    const roleId = role;
    if (typeof roleId !== "string" || roleId.trim().length === 0) {
      throw new NexusConfigError(
        `${pathName}[${index}] must be a non-empty string`,
      );
    }
    if (!knownRoleIds.has(roleId)) {
      throw new NexusConfigError(
        `${pathName}[${index}] references unknown role: ${roleId}`,
      );
    }

    return roleId;
  });
  assertUniqueValues(roles, pathName);

  return roles;
}

function validateNexusAuthorityRoleBinding(
  value: unknown,
  index: number,
  knownRoleIds: Set<string>,
): NexusAuthorityRoleBindingConfig {
  const pathName = `workspace config.authority.roleBindings[${index}]`;
  const record = assertRecord(value, pathName);

  return {
    actorId: requiredString(record, "actorId", pathName),
    roles: validateNexusAuthorityBindingRoles(
      record.roles,
      `${pathName}.roles`,
      knownRoleIds,
    ),
    scope: validateNexusAuthorityScope(record.scope, `${pathName}.scope`),
  };
}

function validateNexusAuthorityRoleBindings(
  value: unknown,
  knownRoleIds: Set<string>,
): NexusAuthorityRoleBindingConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(
      "workspace config.authority.roleBindings must be an array",
    );
  }

  return value.map((binding, index) =>
    validateNexusAuthorityRoleBinding(binding, index, knownRoleIds),
  );
}

function validateNexusAuthorityConfig(
  value: unknown,
): NexusAuthorityConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = "workspace config.authority";
  const record = assertRecord(value, pathName);
  const actors = validateNexusAuthorityActors(record.actors);
  const roles = validateNexusAuthorityRoles(record.roles);
  const knownRoleIds = new Set<string>(
    recommendedNexusAuthorityRoleDefinitions.map((role) => role.id),
  );
  for (const role of roles ?? []) {
    knownRoleIds.add(role.id);
  }

  const unknownActorFallbackRole = optionalString(
    record,
    "unknownActorFallbackRole",
    pathName,
  );
  if (
    unknownActorFallbackRole !== undefined &&
    !knownRoleIds.has(unknownActorFallbackRole)
  ) {
    throw new NexusConfigError(
      `${pathName}.unknownActorFallbackRole references unknown role: ${unknownActorFallbackRole}`,
    );
  }
  const roleBindings = validateNexusAuthorityRoleBindings(
    record.roleBindings,
    knownRoleIds,
  );

  return {
    ...(actors !== undefined ? { actors } : {}),
    ...(roles !== undefined ? { roles } : {}),
    ...(roleBindings !== undefined ? { roleBindings } : {}),
    ...(unknownActorFallbackRole !== undefined ? { unknownActorFallbackRole } : {}),
  };
}

function validateKanbanConfig(
  value: unknown,
): NexusProjectKanbanConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "kanban");
  if (record.provider !== "vibe-kanban") {
    throw new NexusConfigError("kanban.provider must be vibe-kanban");
  }

  return {
    provider: "vibe-kanban",
    projectId: nullableString(record, "projectId", "kanban"),
  };
}

function validateProjectExtensionsConfig(
  value: unknown,
): NexusProjectExtensionsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "workspace config.extensions");
  const extensions: NexusProjectExtensionsConfig = {};
  for (const [key, extensionValue] of Object.entries(record)) {
    if (!key.trim()) {
      throw new NexusConfigError(
        "workspace config.extensions keys must be non-empty strings",
      );
    }
    if (
      !extensionValue ||
      typeof extensionValue !== "object" ||
      Array.isArray(extensionValue)
    ) {
      throw new NexusConfigError(
        `workspace config.extensions.${key} must be an object`,
      );
    }

    extensions[key] = { ...(extensionValue as Record<string, unknown>) };
  }

  return extensions;
}

function validateProjectHostConfig(
  value: unknown,
  index: number,
): NexusProjectHostConfig {
  const pathName = `workspace config.hosts[${index}]`;
  const record = assertRecord(value, pathName);
  const id = requiredString(record, "id", pathName);
  const notes = optionalString(record, "notes", pathName);

  return {
    id,
    displayName: optionalString(record, "displayName", pathName) ?? id,
    platformTags: optionalStringArray(record, "platformTags", pathName) ?? [],
    capabilityTags: optionalStringArray(record, "capabilityTags", pathName) ?? [],
    enabled: optionalBoolean(record, "enabled", pathName) ?? true,
    ...(notes !== undefined ? { notes } : {}),
  };
}

function validateProjectHostsConfig(value: unknown): NexusProjectHostConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.hosts must be an array");
  }

  const hosts = value.map((item, index) => validateProjectHostConfig(item, index));
  const ids = new Set<string>();
  for (const host of hosts) {
    if (ids.has(host.id)) {
      throw new NexusConfigError(
        `workspace config.hosts contains duplicate id: ${host.id}`,
      );
    }
    ids.add(host.id);
  }

  return hosts;
}

function validateRunnerProfilesConfig(
  value: unknown,
): NexusRunnerProfileConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.runnerProfiles must be an array");
  }

  const profiles = value.map((item, index) =>
    validateRunnerProfileConfig(item, index),
  );
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new NexusConfigError(
        `workspace config.runnerProfiles contains duplicate id: ${profile.id}`,
      );
    }
    ids.add(profile.id);
  }

  return profiles;
}

function validateRunnerProfileConfig(
  value: unknown,
  index: number,
): NexusRunnerProfileConfig {
  const pathName = `workspace config.runnerProfiles[${index}]`;
  const record = assertRecord(value, pathName);
  const id = requiredString(record, "id", pathName);
  const allowedOperationClasses = validateRunnerOperationClasses(
    record.allowedOperationClasses,
    `${pathName}.allowedOperationClasses`,
  );
  const mutationClass = validateRunnerMutationClass(
    record.mutationClass,
    `${pathName}.mutationClass`,
  );
  validateRunnerMutationClassMatchesOperations({
    mutationClass,
    allowedOperationClasses,
    pathName,
  });
  const approval = validateRunnerApprovalRequirement(
    record.approval,
    `${pathName}.approval`,
  );
  validateRunnerApprovalGate({
    approval,
    allowedOperationClasses,
    mutationClass,
    pathName,
  });

  return {
    id,
    displayName: optionalString(record, "displayName", pathName) ?? id,
    enabled: optionalBoolean(record, "enabled", pathName) ?? true,
    requiredCapabilities:
      optionalUniqueStringArray(record, "requiredCapabilities", pathName) ?? [],
    allowedOperationClasses,
    commandProfileRefs:
      optionalUniqueStringArray(record, "commandProfileRefs", pathName) ?? [],
    limits: validateRunnerProfileLimits(record.limits, `${pathName}.limits`),
    artifactRetention: validateRunnerArtifactRetention(
      record.artifactRetention,
      `${pathName}.artifactRetention`,
    ),
    credentialIdentity: validateRunnerCredentialIdentity(
      record.credentialIdentity,
      `${pathName}.credentialIdentity`,
    ),
    mutationClass,
    approval,
  };
}

function validateRunnerOperationClasses(
  value: unknown,
  pathName: string,
): NexusRunnerOperationClass[] {
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName} must not be empty`);
  }

  const classes = value.map((entry, index) =>
    validateRunnerOperationClass(entry, `${pathName}[${index}]`),
  );
  assertUniqueValues(classes, pathName);
  return classes;
}

function validateRunnerOperationClass(
  value: unknown,
  pathName: string,
): NexusRunnerOperationClass {
  if (
    value === "read_only" ||
    value === "verification" ||
    value === "project_local_mutation" ||
    value === "live_runtime" ||
    value === "destructive"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be read_only, verification, project_local_mutation, live_runtime, or destructive`,
  );
}

function validateRunnerMutationClass(
  value: unknown,
  pathName: string,
): NexusRunnerMutationClass {
  if (
    value === "none" ||
    value === "verification" ||
    value === "project_local" ||
    value === "live_runtime" ||
    value === "destructive"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be none, verification, project_local, live_runtime, or destructive`,
  );
}

function validateRunnerMutationClassMatchesOperations(options: {
  mutationClass: NexusRunnerMutationClass;
  allowedOperationClasses: NexusRunnerOperationClass[];
  pathName: string;
}): void {
  const requiredMutationClass = requiredMutationClassForOperationClasses(
    options.allowedOperationClasses,
  );
  if (options.mutationClass !== requiredMutationClass) {
    throw new NexusConfigError(
      `${options.pathName}.mutationClass must be ${requiredMutationClass} for allowedOperationClasses`,
    );
  }
}

function validateRunnerProfileLimits(
  value: unknown,
  pathName: string,
): NexusRunnerProfileLimitsConfig {
  if (value === undefined) {
    return {
      timeoutMs: null,
      outputLineLimit: null,
      outputByteLimit: null,
    };
  }

  const record = assertRecord(value, pathName);
  return {
    timeoutMs: optionalNullablePositiveInteger(record, "timeoutMs", pathName),
    outputLineLimit: optionalNullablePositiveInteger(
      record,
      "outputLineLimit",
      pathName,
    ),
    outputByteLimit: optionalNullablePositiveInteger(
      record,
      "outputByteLimit",
      pathName,
    ),
  };
}

function validateRunnerArtifactRetention(
  value: unknown,
  pathName: string,
): NexusRunnerArtifactRetentionConfig {
  if (value === undefined) {
    return {
      mode: "none",
      ttlDays: null,
    };
  }

  const record = assertRecord(value, pathName);
  const mode = validateRunnerArtifactRetentionMode(record.mode, `${pathName}.mode`);
  const ttlDays = optionalNullablePositiveInteger(record, "ttlDays", pathName);
  if (mode === "none" && ttlDays !== null) {
    throw new NexusConfigError(`${pathName}.ttlDays must be null when mode is none`);
  }

  return {
    mode,
    ttlDays,
  };
}

function validateRunnerArtifactRetentionMode(
  value: unknown,
  pathName: string,
): NexusRunnerArtifactRetentionConfig["mode"] {
  if (
    value === undefined ||
    value === "none" ||
    value === "summary" ||
    value === "logs" ||
    value === "artifacts"
  ) {
    return value ?? "none";
  }

  throw new NexusConfigError(
    `${pathName} must be none, summary, logs, or artifacts`,
  );
}

function validateRunnerCredentialIdentity(
  value: unknown,
  pathName: string,
): NexusRunnerCredentialIdentityPolicyConfig {
  if (value === undefined) {
    return {
      kind: "none",
      identityRef: null,
    };
  }

  const record = assertRecord(value, pathName);
  const kind = validateRunnerCredentialIdentityKind(record.kind, `${pathName}.kind`);
  const identityRef =
    optionalNullableString(record, "identityRef", pathName) ?? null;
  if (kind === "none" && identityRef !== null) {
    throw new NexusConfigError(
      `${pathName}.identityRef must be null when kind is none`,
    );
  }
  if (kind !== "none" && identityRef === null) {
    throw new NexusConfigError(
      `${pathName}.identityRef must be configured when kind is ${kind}`,
    );
  }

  return {
    kind,
    identityRef,
  };
}

function validateRunnerCredentialIdentityKind(
  value: unknown,
  pathName: string,
): NexusRunnerCredentialIdentityPolicyConfig["kind"] {
  if (
    value === undefined ||
    value === "none" ||
    value === "host" ||
    value === "automation" ||
    value === "manual"
  ) {
    return value ?? "none";
  }

  throw new NexusConfigError(
    `${pathName} must be none, host, automation, or manual`,
  );
}

function validateRunnerApprovalRequirement(
  value: unknown,
  pathName: string,
): NexusRunnerApprovalRequirementConfig {
  if (value === undefined) {
    return {
      required: false,
      policyGateIds: [],
      approvalRef: null,
      reason: null,
    };
  }

  const record = assertRecord(value, pathName);
  return {
    required: optionalBoolean(record, "required", pathName) ?? false,
    policyGateIds:
      optionalUniqueStringArray(record, "policyGateIds", pathName) ?? [],
    approvalRef: optionalNullableString(record, "approvalRef", pathName) ?? null,
    reason: optionalNullableString(record, "reason", pathName) ?? null,
  };
}

function validateRunnerApprovalGate(options: {
  approval: NexusRunnerApprovalRequirementConfig;
  allowedOperationClasses: NexusRunnerOperationClass[];
  mutationClass: NexusRunnerMutationClass;
  pathName: string;
}): void {
  if (
    !runnerProfileRequiresApproval(
      options.allowedOperationClasses,
      options.mutationClass,
    )
  ) {
    return;
  }
  if (!options.approval.required) {
    throw new NexusConfigError(
      `${options.pathName}.approval.required must be true for live-runtime or destructive runner profiles`,
    );
  }
  if (
    options.approval.policyGateIds.length === 0 &&
    !options.approval.approvalRef
  ) {
    throw new NexusConfigError(
      `${options.pathName}.approval must declare policyGateIds or approvalRef for live-runtime or destructive runner profiles`,
    );
  }
}

function validateSkillMaterialization(
  value: unknown,
  pathName: string,
): NexusSkillMaterializationMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "copy" || value === "symlink" || value === "reference") {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be copy, symlink, or reference`,
  );
}

function validateSkillSourceControl(
  value: unknown,
  pathName: string,
): NexusSkillSourceControl | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "support" || value === "source") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be support or source`);
}

function validateProjectSkillSelection(
  value: unknown,
  index: number,
): NexusProjectSkillSelection {
  const pathName = `workspace config.skills.items[${index}]`;
  const record = assertRecord(value, pathName);
  const enabled = record.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new NexusConfigError(`${pathName}.enabled must be a boolean`);
  }
  const version = optionalString(record, "version", pathName);
  const materialization = validateSkillMaterialization(
    record.materialization,
    `${pathName}.materialization`,
  );
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );

  return {
    id: requiredString(record, "id", pathName),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(materialization !== undefined ? { materialization } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
  };
}

function validateProjectSkillAgentTarget(
  value: unknown,
  index: number,
): NexusProjectSkillAgentTarget {
  const pathName = `workspace config.skills.agentTargets[${index}]`;
  const record = assertRecord(value, pathName);
  const enabled = record.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new NexusConfigError(`${pathName}.enabled must be a boolean`);
  }
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );
  const directory = optionalString(record, "directory", pathName);

  return {
    agent: requiredString(record, "agent", pathName),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(directory !== undefined ? { directory } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
  };
}

function validateProjectSkillsConfig(
  value: unknown,
): NexusProjectSkillsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "workspace config.skills");
  const defaultCorePack = record.defaultCorePack;
  if (defaultCorePack !== undefined && typeof defaultCorePack !== "boolean") {
    throw new NexusConfigError(
      "workspace config.skills.defaultCorePack must be a boolean",
    );
  }
  const items = record.items;
  if (items !== undefined && !Array.isArray(items)) {
    throw new NexusConfigError("workspace config.skills.items must be an array");
  }
  const agentTargets = record.agentTargets;
  if (agentTargets !== undefined && !Array.isArray(agentTargets)) {
    throw new NexusConfigError(
      "workspace config.skills.agentTargets must be an array",
    );
  }
  const materialization = validateSkillMaterialization(
    record.materialization,
    "workspace config.skills.materialization",
  );
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    "workspace config.skills.sourceControl",
  );

  return {
    ...(defaultCorePack !== undefined ? { defaultCorePack } : {}),
    ...(materialization !== undefined ? { materialization } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(agentTargets
      ? {
          agentTargets: agentTargets.map((target, index) =>
            validateProjectSkillAgentTarget(target, index),
          ),
        }
      : {}),
    ...(items
      ? {
          items: items.map((item, index) =>
            validateProjectSkillSelection(item, index),
          ),
        }
      : {}),
  };
}

function validatePluginCapabilityKind(
  value: unknown,
  pathName: string,
): NexusPluginCapabilityKind {
  if (
    value === "projected_skill" ||
    value === "mcp_server" ||
    value === "setup_obligation" ||
    value === "environment_hint" ||
    value === "cleanup_hook" ||
    value === "agent_affordance" ||
    value === "dependency_projection" ||
    value === "worker_context_fragment" ||
    value === "worker_briefing_fragment"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be projected_skill, mcp_server, setup_obligation, environment_hint, cleanup_hook, agent_affordance, dependency_projection, worker_context_fragment, or worker_briefing_fragment`,
  );
}

function validatePluginCleanupHookTrigger(
  value: unknown,
  pathName: string,
): NexusPluginCleanupHookTrigger | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "before_run" || value === "after_run" || value === "manual") {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be before_run, after_run, or manual`,
  );
}

function validatePluginDependencyProjectionSourceControl(
  value: unknown,
  pathName: string,
): NexusPluginDependencyProjectionSourceControl | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "support" || value === "source") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be support or source`);
}

function validatePluginMcpTools(
  value: unknown,
  pathName: string,
): NexusPluginMcpToolCapability[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }

  return value.map((tool, index) => {
    const toolPath = `${pathName}[${index}]`;
    const record = assertRecord(tool, toolPath);
    const description = optionalString(record, "description", toolPath);

    return {
      name: requiredString(record, "name", toolPath),
      ...(description !== undefined ? { description } : {}),
    };
  });
}

function validateMcpExposureMode(
  value: unknown,
  pathName: string,
): NexusMcpExposureMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "direct" ||
    value === "gateway" ||
    value === "hidden" ||
    value === "inherit"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be direct, gateway, hidden, or inherit`,
  );
}

function validateMcpGatewayPolicyConfig(
  value: unknown,
  pathName: string,
): NexusMcpGatewayPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const includedServers = optionalStringArray(record, "includedServers", pathName);
  const includedTools = optionalStringArray(record, "includedTools", pathName);
  const excludedTools = optionalStringArray(record, "excludedTools", pathName);
  return {
    ...(includedServers !== undefined ? { includedServers } : {}),
    ...(includedTools !== undefined ? { includedTools } : {}),
    ...(excludedTools !== undefined ? { excludedTools } : {}),
  };
}

function validatePluginCapabilityRecord(
  value: unknown,
  index: number,
  pluginPathName: string,
): NexusPluginCapabilityRecord {
  const pathName = `${pluginPathName}.capabilities[${index}]`;
  const record = assertRecord(value, pathName);
  const kind = validatePluginCapabilityKind(record.kind, `${pathName}.kind`);
  const id = requiredString(record, "id", pathName);
  const description = optionalString(record, "description", pathName);

  if (kind === "projected_skill") {
    const targetAgents = optionalStringArray(record, "targetAgents", pathName);
    return {
      kind,
      id,
      ...(description !== undefined ? { description } : {}),
      skillId: requiredString(record, "skillId", pathName),
      ...(targetAgents !== undefined ? { targetAgents } : {}),
    };
  }

  if (kind === "mcp_server") {
    const targetAgents = optionalStringArray(record, "targetAgents", pathName);
    const tools = validatePluginMcpTools(record.tools, `${pathName}.tools`);
    const command = optionalString(record, "command", pathName);
    const args = optionalStringArray(record, "args", pathName);
    const exposure = validateMcpExposureMode(record.exposure, `${pathName}.exposure`);
    return {
      kind,
      id,
      ...(description !== undefined ? { description } : {}),
      serverName: requiredString(record, "serverName", pathName),
      ...(command !== undefined ? { command } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(targetAgents !== undefined ? { targetAgents } : {}),
      ...(exposure !== undefined ? { exposure } : {}),
      ...(tools !== undefined ? { tools } : {}),
    };
  }

  if (kind === "setup_obligation") {
    return {
      kind,
      id,
      description: requiredString(record, "description", pathName),
      required: optionalBoolean(record, "required", pathName) ?? false,
    };
  }

  if (kind === "environment_hint") {
    const valueHint = optionalString(record, "valueHint", pathName);
    return {
      kind,
      id,
      ...(description !== undefined ? { description } : {}),
      variable: requiredString(record, "variable", pathName),
      ...(valueHint !== undefined ? { valueHint } : {}),
      required: optionalBoolean(record, "required", pathName) ?? false,
    };
  }

  if (kind === "cleanup_hook") {
    const trigger = validatePluginCleanupHookTrigger(
      record.trigger,
      `${pathName}.trigger`,
    );
    return {
      kind,
      id,
      description: requiredString(record, "description", pathName),
      ...(trigger !== undefined ? { trigger } : {}),
      required: optionalBoolean(record, "required", pathName) ?? false,
    };
  }

  if (kind === "dependency_projection") {
    const sourceControl = validatePluginDependencyProjectionSourceControl(
      record.sourceControl,
      `${pathName}.sourceControl`,
    );
    const sourceComponentId = optionalString(
      record,
      "sourceComponentId",
      pathName,
    );
    const targetAgents = optionalStringArray(record, "targetAgents", pathName);
    const targetComponents = optionalStringArray(
      record,
      "targetComponents",
      pathName,
    );
    const reason = optionalString(record, "reason", pathName);

    return {
      kind,
      id,
      ...(description !== undefined ? { description } : {}),
      ...(sourceComponentId !== undefined ? { sourceComponentId } : {}),
      source: requiredProjectRelativePath(record, "source", pathName),
      target: requiredDependencyProjectionTargetPath(
        record,
        pathName,
        sourceComponentId !== undefined,
      ),
      required: optionalBoolean(record, "required", pathName) ?? false,
      sourceControl: sourceControl ?? "support",
      ...(targetAgents !== undefined ? { targetAgents } : {}),
      ...(targetComponents !== undefined ? { targetComponents } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  if (kind === "worker_context_fragment" || kind === "worker_briefing_fragment") {
    const targetAgents = optionalStringArray(record, "targetAgents", pathName);
    const targetComponents = optionalStringArray(
      record,
      "targetComponents",
      pathName,
    );
    return {
      kind,
      id,
      ...(description !== undefined ? { description } : {}),
      title: requiredBoundedString(
        record,
        "title",
        pathName,
        nexusPluginWorkerFragmentTitleMaxLength,
      ),
      body: requiredBoundedString(
        record,
        "body",
        pathName,
        nexusPluginWorkerFragmentBodyMaxLength,
      ),
      provenance: requiredBoundedString(
        record,
        "provenance",
        pathName,
        nexusPluginWorkerFragmentProvenanceMaxLength,
      ),
      ...(targetAgents !== undefined ? { targetAgents } : {}),
      ...(targetComponents !== undefined ? { targetComponents } : {}),
    };
  }

  return {
    kind,
    id,
    description: requiredString(record, "description", pathName),
  };
}

function validateProjectPluginConfig(
  value: unknown,
  index: number,
): NexusProjectPluginConfig {
  const pathName = `workspace config.plugins[${index}]`;
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName) ?? true;
  const name = optionalString(record, "name", pathName);
  const version = optionalString(record, "version", pathName);
  const mcpExposure = validateMcpExposureMode(
    record.mcpExposure,
    `${pathName}.mcpExposure`,
  );
  const capabilitiesValue = record.capabilities;
  if (capabilitiesValue !== undefined && !Array.isArray(capabilitiesValue)) {
    throw new NexusConfigError(`${pathName}.capabilities must be an array`);
  }
  const capabilities = (capabilitiesValue ?? []).map((capability, capabilityIndex) =>
    validatePluginCapabilityRecord(capability, capabilityIndex, pathName),
  );
  const ids = new Set<string>();
  for (const capability of capabilities) {
    if (ids.has(capability.id)) {
      throw new NexusConfigError(
        `${pathName}.capabilities contains duplicate id: ${capability.id}`,
      );
    }
    ids.add(capability.id);
  }

  return {
    id: requiredString(record, "id", pathName),
    enabled,
    ...(name !== undefined ? { name } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(mcpExposure !== undefined ? { mcpExposure } : {}),
    capabilities,
  };
}

function validateProjectPluginsConfig(
  value: unknown,
): NexusProjectPluginsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.plugins must be an array");
  }

  const plugins = value.map((plugin, index) =>
    validateProjectPluginConfig(plugin, index),
  );
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) {
      throw new NexusConfigError(
        `workspace config.plugins contains duplicate id: ${plugin.id}`,
      );
    }
    ids.add(plugin.id);
  }

  return plugins;
}

function validateProjectAgentTargetsConfig(
  value: unknown,
): NexusProjectAgentTargetsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = assertRecord(value, "workspace config.agentTargets");
  const active = record.active;
  if (!Array.isArray(active)) {
    throw new NexusConfigError(
      "workspace config.agentTargets.active must be an array",
    );
  }
  if (active.length === 0) {
    throw new NexusConfigError(
      "workspace config.agentTargets.active must not be empty",
    );
  }

  const targets = active.map((item, index) =>
    validateProjectActiveAgentTargetConfig(item, index),
  );
  const providers = new Set<string>();
  for (const target of targets) {
    if (providers.has(target.provider)) {
      throw new NexusConfigError(
        `workspace config.agentTargets.active contains duplicate provider: ${target.provider}`,
      );
    }
    providers.add(target.provider);
  }

  return { active: targets };
}

function validateProjectActiveAgentTargetConfig(
  value: unknown,
  index: number,
): NexusProjectActiveAgentTargetConfig {
  const pathName = `workspace config.agentTargets.active[${index}]`;
  const record = assertRecord(value, pathName);
  const provider = validateActiveAgentProvider(record.provider, `${pathName}.provider`);
  const enabled = optionalBoolean(record, "enabled", pathName);
  if (enabled === false) {
    throw new NexusConfigError(`${pathName}.enabled must not be false`);
  }
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );
  const mcp = validateProjectActiveAgentMcpSettings(record.mcp, `${pathName}.mcp`);
  const skills = validateProjectActiveAgentSkillSettings(
    record.skills,
    `${pathName}.skills`,
  );
  const setupNotes = optionalStringArray(record, "setupNotes", pathName);

  return {
    provider,
    ...(enabled === true ? { enabled } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(mcp !== undefined ? { mcp } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(setupNotes !== undefined ? { setupNotes } : {}),
  };
}

function validateProjectActiveAgentMcpSettings(
  value: unknown,
  pathName: string,
): NexusProjectActiveAgentMcpSettings | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName);
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );
  const configPath = optionalString(record, "configPath", pathName);
  const configFormat = validateAgentMcpConfigFormat(
    record.configFormat,
    `${pathName}.configFormat`,
  );
  const configSchema = optionalString(record, "configSchema", pathName);
  const serverName = optionalString(record, "serverName", pathName);
  const command = optionalString(record, "command", pathName);
  const args = optionalStringArray(record, "args", pathName);
  const defaultToolsApprovalMode = optionalString(
    record,
    "defaultToolsApprovalMode",
    pathName,
  );
  const exposure = validateMcpExposureMode(record.exposure, `${pathName}.exposure`);
  const activationNotes = optionalStringArray(record, "activationNotes", pathName);
  const trustSemantics = optionalString(record, "trustSemantics", pathName);
  const manualInstructions = optionalStringArray(
    record,
    "manualInstructions",
    pathName,
  );

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(configPath !== undefined ? { configPath } : {}),
    ...(configFormat !== undefined ? { configFormat } : {}),
    ...(configSchema !== undefined ? { configSchema } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(serverName !== undefined ? { serverName } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(defaultToolsApprovalMode !== undefined ? { defaultToolsApprovalMode } : {}),
    ...(exposure !== undefined ? { exposure } : {}),
    ...(activationNotes !== undefined ? { activationNotes } : {}),
    ...(trustSemantics !== undefined ? { trustSemantics } : {}),
    ...(manualInstructions !== undefined ? { manualInstructions } : {}),
  };
}

function validateProjectActiveAgentSkillSettings(
  value: unknown,
  pathName: string,
): NexusProjectActiveAgentSkillSettings | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName);
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );
  const directory = optionalString(record, "directory", pathName);

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(directory !== undefined ? { directory } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
  };
}

function validateActiveAgentProvider(
  value: unknown,
  pathName: string,
): NexusProjectActiveAgentProvider {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(`${pathName} must be a non-empty string`);
  }
  const provider = value.trim().toLowerCase();
  if (
    provider === "codex" ||
    provider === "claude" ||
    provider === "opencode" ||
    provider === "manual" ||
    provider === "custom"
  ) {
    return provider;
  }

  throw new NexusConfigError(
    `${pathName} must be codex, claude, opencode, manual, or custom`,
  );
}

function validateProjectMcpAgentTarget(
  value: unknown,
  index: number,
): NexusProjectAgentMcpTarget {
  const pathName = `workspace config.mcp.agentTargets[${index}]`;
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName);
  const provider = optionalString(record, "provider", pathName);
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );
  const configPath = optionalString(record, "configPath", pathName);
  const serverName = optionalString(record, "serverName", pathName);
  const command = optionalString(record, "command", pathName);
  const args = optionalStringArray(record, "args", pathName);
  const defaultToolsApprovalMode = optionalString(
    record,
    "defaultToolsApprovalMode",
    pathName,
  );
  const exposure = validateMcpExposureMode(record.exposure, `${pathName}.exposure`);
  const gateway = validateMcpGatewayPolicyConfig(
    record.gateway,
    `${pathName}.gateway`,
  );
  const configFormat = validateAgentMcpConfigFormat(
    record.configFormat,
    `${pathName}.configFormat`,
  );
  const configSchema = optionalString(record, "configSchema", pathName);
  const activationNotes = optionalStringArray(
    record,
    "activationNotes",
    pathName,
  );
  const trustSemantics = optionalString(record, "trustSemantics", pathName);
  const manualInstructions = optionalStringArray(
    record,
    "manualInstructions",
    pathName,
  );

  return {
    agent: requiredString(record, "agent", pathName),
    ...(provider !== undefined ? { provider } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(configPath !== undefined ? { configPath } : {}),
    ...(configFormat !== undefined ? { configFormat } : {}),
    ...(configSchema !== undefined ? { configSchema } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(serverName !== undefined ? { serverName } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(defaultToolsApprovalMode !== undefined ? { defaultToolsApprovalMode } : {}),
    ...(exposure !== undefined ? { exposure } : {}),
    ...(gateway !== undefined ? { gateway } : {}),
    ...(activationNotes !== undefined ? { activationNotes } : {}),
    ...(trustSemantics !== undefined ? { trustSemantics } : {}),
    ...(manualInstructions !== undefined ? { manualInstructions } : {}),
  };
}

function validateAgentMcpConfigFormat(
  value: unknown,
  pathName: string,
): NexusProjectAgentMcpConfigFormat | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "toml" || value === "json" || value === "manual") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be toml, json, or manual`);
}

function validateProjectMcpConfig(
  value: unknown,
): NexusProjectMcpConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "workspace config.mcp");
  const enabled = optionalBoolean(record, "enabled", "workspace config.mcp");
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    "workspace config.mcp.sourceControl",
  );
  const serverName = optionalString(record, "serverName", "workspace config.mcp");
  const command = optionalString(record, "command", "workspace config.mcp");
  const args = optionalStringArray(record, "args", "workspace config.mcp");
  const defaultToolsApprovalMode = optionalString(
    record,
    "defaultToolsApprovalMode",
    "workspace config.mcp",
  );
  const exposure = validateMcpExposureMode(
    record.exposure,
    "workspace config.mcp.exposure",
  );
  const gateway = validateMcpGatewayPolicyConfig(
    record.gateway,
    "workspace config.mcp.gateway",
  );
  const agentTargets = record.agentTargets;
  if (agentTargets !== undefined && !Array.isArray(agentTargets)) {
    throw new NexusConfigError(
      "workspace config.mcp.agentTargets must be an array",
    );
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(serverName !== undefined ? { serverName } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(defaultToolsApprovalMode !== undefined ? { defaultToolsApprovalMode } : {}),
    ...(exposure !== undefined ? { exposure } : {}),
    ...(gateway !== undefined ? { gateway } : {}),
    ...(agentTargets
      ? {
          agentTargets: agentTargets.map((target, index) =>
            validateProjectMcpAgentTarget(target, index),
          ),
        }
      : {}),
  };
}

const legacyDefaultWorkTrackerId = "default";
const legacyDefaultWorkTrackerName = "Default";

function validateProjectHostingProviderName(
  value: unknown,
  pathName: string,
): NexusProjectHostingProviderName {
  if (value === "github") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be github`);
}

function validateProjectHostingRepositoryVisibility(
  value: unknown,
  pathName: string,
): NexusProjectHostingRepositoryVisibility {
  if (value === undefined) {
    return "private";
  }
  if (value === "public" || value === "private" || value === "internal") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be public, private, or internal`);
}

function validateProjectHostingRemoteProtocol(
  value: unknown,
  pathName: string,
): NexusProjectHostingRemoteProtocol {
  if (value === undefined) {
    return "ssh";
  }
  if (value === "ssh" || value === "https") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be ssh or https`);
}

function validateProjectHostingRemoteRole(
  value: unknown,
  pathName: string,
): NexusProjectHostingRemoteRole {
  if (value === undefined) {
    return "other";
  }
  if (value === "human" || value === "automation" || value === "other") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be human, automation, or other`);
}

function validateProjectHostingAccessPrincipalKind(
  value: unknown,
  pathName: string,
): NexusProjectHostingAccessPrincipalKind {
  if (
    value === "human" ||
    value === "machine_user" ||
    value === "team" ||
    value === "deploy_key" ||
    value === "app"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be human, machine_user, team, deploy_key, or app`,
  );
}

function validateProjectHostingAccessRole(
  value: unknown,
  pathName: string,
): NexusProjectHostingAccessRole {
  if (
    value === "human" ||
    value === "automation" ||
    value === "reviewer" ||
    value === "observer" ||
    value === "other"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be human, automation, reviewer, observer, or other`,
  );
}

function validateProjectHostingRequiredPermission(
  value: unknown,
  pathName: string,
): NexusProjectHostingRequiredPermission {
  if (
    value === "read" ||
    value === "write" ||
    value === "maintain" ||
    value === "admin"
  ) {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be read, write, maintain, or admin`);
}

function validateProjectHostingInvitationPolicy(
  value: unknown,
  pathName: string,
): NexusProjectHostingInvitationPolicy {
  if (value === undefined) {
    return "require_accepted";
  }
  if (
    value === "require_accepted" ||
    value === "allow_pending" ||
    value === "auto_accept" ||
    value === "manual"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be require_accepted, allow_pending, auto_accept, or manual`,
  );
}

function validateProjectHostingRepositoryConfig(
  value: unknown,
): NexusProjectHostingConfig["repository"] {
  const pathName = "workspace config.hosting.repository";
  const record =
    value === undefined ? {} : assertRecord(value, pathName);
  const name = optionalString(record, "name", pathName);
  const nameTemplate = optionalString(record, "nameTemplate", pathName);
  if (name !== undefined && nameTemplate !== undefined) {
    throw new NexusConfigError(
      `${pathName} must define either name or nameTemplate, not both`,
    );
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(nameTemplate !== undefined ? { nameTemplate } : {}),
    visibility: validateProjectHostingRepositoryVisibility(
      record.visibility,
      `${pathName}.visibility`,
    ),
    defaultBranch:
      optionalString(record, "defaultBranch", pathName) ?? "main",
  };
}

function validateProjectHostingRemoteConfig(
  value: unknown,
  index: number,
): NexusProjectHostingConfig["remotes"][number] {
  const pathName = `workspace config.hosting.remotes[${index}]`;
  const record = assertRecord(value, pathName);
  const protocol = validateProjectHostingRemoteProtocol(
    record.protocol,
    `${pathName}.protocol`,
  );
  const authProfile = optionalString(record, "authProfile", pathName);
  const host = optionalString(record, "host", pathName);
  const sshHost = optionalString(record, "sshHost", pathName);
  if (protocol === "https" && sshHost !== undefined) {
    throw new NexusConfigError(
      `${pathName}.sshHost is only valid for ssh remotes`,
    );
  }

  return {
    name: requiredString(record, "name", pathName),
    role: validateProjectHostingRemoteRole(record.role, `${pathName}.role`),
    protocol,
    ...(authProfile !== undefined ? { authProfile } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(sshHost !== undefined ? { sshHost } : {}),
  };
}

function validateProjectHostingRemotes(
  value: unknown,
): NexusProjectHostingConfig["remotes"] {
  if (value === undefined) {
    return [
      {
        name: "origin",
        role: "human",
        protocol: "ssh",
      },
    ];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.hosting.remotes must be an array");
  }
  if (value.length === 0) {
    throw new NexusConfigError(
      "workspace config.hosting.remotes must not be empty",
    );
  }

  const remotes = value.map((remote, index) =>
    validateProjectHostingRemoteConfig(remote, index),
  );
  const names = new Set<string>();
  for (const remote of remotes) {
    if (names.has(remote.name)) {
      throw new NexusConfigError(
        `workspace config.hosting.remotes contains duplicate name: ${remote.name}`,
      );
    }
    names.add(remote.name);
  }

  return remotes;
}

function validateProjectHostingAccessPrincipalConfig(
  value: unknown,
  index: number,
): NexusProjectHostingConfig["access"][number] {
  const pathName = `workspace config.hosting.access[${index}]`;
  const record = assertRecord(value, pathName);
  const authProfile = optionalString(record, "authProfile", pathName);
  const requiredProviderPermissions = optionalStringRecord(
    record,
    "requiredProviderPermissions",
    pathName,
  );

  return {
    kind: validateProjectHostingAccessPrincipalKind(
      record.kind,
      `${pathName}.kind`,
    ),
    providerIdentity: requiredString(record, "providerIdentity", pathName),
    role: validateProjectHostingAccessRole(record.role, `${pathName}.role`),
    requiredPermission: validateProjectHostingRequiredPermission(
      record.requiredPermission,
      `${pathName}.requiredPermission`,
    ),
    ...(requiredProviderPermissions !== undefined
      ? { requiredProviderPermissions }
      : {}),
    ...(authProfile !== undefined ? { authProfile } : {}),
    invitationPolicy: validateProjectHostingInvitationPolicy(
      record.invitationPolicy,
      `${pathName}.invitationPolicy`,
    ),
  };
}

function validateProjectHostingAccess(
  value: unknown,
): NexusProjectHostingConfig["access"] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.hosting.access must be an array");
  }

  const access = value.map((principal, index) =>
    validateProjectHostingAccessPrincipalConfig(principal, index),
  );
  const identities = new Set<string>();
  for (const principal of access) {
    const identityKey =
      `${principal.kind}:${principal.providerIdentity}`.toLowerCase();
    if (identities.has(identityKey)) {
      throw new NexusConfigError(
        `workspace config.hosting.access contains duplicate principal: ` +
          `${principal.kind}:${principal.providerIdentity}`,
      );
    }
    identities.add(identityKey);
  }

  return access;
}

function validateProjectHostingProvisioningConfig(
  value: unknown,
): NexusProjectHostingConfig["provisioning"] {
  const pathName = "workspace config.hosting.provisioning";
  const record =
    value === undefined ? {} : assertRecord(value, pathName);
  const providerMutationAuthProfile = optionalString(
    record,
    "providerMutationAuthProfile",
    pathName,
  );

  return {
    allowCreate: optionalBoolean(record, "allowCreate", pathName) ?? false,
    allowLocalRemoteRepair:
      optionalBoolean(record, "allowLocalRemoteRepair", pathName) ?? false,
    allowAccessRepair:
      optionalBoolean(record, "allowAccessRepair", pathName) ?? false,
    allowInvitationAcceptance:
      optionalBoolean(record, "allowInvitationAcceptance", pathName) ?? false,
    allowDefaultBranchRepair:
      optionalBoolean(record, "allowDefaultBranchRepair", pathName) ?? false,
    allowVisibilityRepair:
      optionalBoolean(record, "allowVisibilityRepair", pathName) ?? false,
    ...(providerMutationAuthProfile !== undefined
      ? { providerMutationAuthProfile }
      : {}),
  };
}

const sharedHostingSecretFieldNames = new Set([
  "token",
  "accessToken",
  "privateKey",
  "privateKeyPath",
  "sshPrivateKey",
  "githubCliConfigDir",
  "ghConfigDir",
  "browserSession",
  "sessionCookie",
  "credentialPath",
  "credentials",
]);

function rejectSharedHostingSecretFields(value: unknown, pathName: string): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectSharedHostingSecretFields(entry, `${pathName}[${index}]`),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const childPath = `${pathName}.${key}`;
    if (sharedHostingSecretFieldNames.has(key)) {
      throw new NexusConfigError(
        `${childPath} must not be stored in shared hosting config; ` +
          "use a host-local auth profile reference instead",
      );
    }
    rejectSharedHostingSecretFields(childValue, childPath);
  }
}

function validateProjectHostingConfig(
  value: unknown,
): NexusProjectHostingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = "workspace config.hosting";
  const record = assertRecord(value, pathName);
  rejectSharedHostingSecretFields(record, pathName);
  const authProfile = optionalString(record, "authProfile", pathName);

  return {
    provider: validateProjectHostingProviderName(
      record.provider,
      `${pathName}.provider`,
    ),
    namespace: requiredString(record, "namespace", pathName),
    repository: validateProjectHostingRepositoryConfig(record.repository),
    ...(authProfile !== undefined ? { authProfile } : {}),
    remotes: validateProjectHostingRemotes(record.remotes),
    access: validateProjectHostingAccess(record.access),
    provisioning: validateProjectHostingProvisioningConfig(record.provisioning),
  };
}

function validateWorkTrackingProviderName(
  value: unknown,
  pathName: string,
): WorkTrackingProviderName {
  if (
    value === "local" ||
    value === "vibe-kanban" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be local, vibe-kanban, github, gitlab, or jira`,
  );
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new NexusConfigError(`${pathName}.${key} must be an integer or null`);
  }

  return value;
}

function optionalStringRecord(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  const valueRecord = assertRecord(value, `${pathName}.${key}`);
  for (const [recordKey, recordValue] of Object.entries(valueRecord)) {
    if (typeof recordValue !== "string") {
      throw new NexusConfigError(
        `${pathName}.${key}.${recordKey} must be a string`,
      );
    }
  }

  return valueRecord as Record<string, string>;
}

function validateWorkTrackingRepositoryConfig(
  value: unknown,
  pathName: string,
): WorkTrackingRepositoryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const owner = optionalString(record, "owner", pathName);
  const name = optionalString(record, "name", pathName);
  const id = optionalString(record, "id", pathName);
  const repositoryPath = optionalString(record, "path", pathName);

  return {
    ...(owner ? { owner } : {}),
    ...(name ? { name } : {}),
    ...(id ? { id } : {}),
    ...(repositoryPath ? { path: repositoryPath } : {}),
  };
}

function validateRequiredWorkTrackingRepositoryConfig(
  value: unknown,
  pathName: string,
): WorkTrackingRepositoryConfig {
  const repository = validateWorkTrackingRepositoryConfig(value, pathName);
  if (!repository) {
    throw new NexusConfigError(`${pathName} must be an object`);
  }

  return repository;
}

function validateWorkTrackingBoardConfig(
  value: unknown,
  pathName: string,
): WorkTrackingBoardConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const record = assertRecord(value, pathName);
  const id = optionalNullableString(record, "id", pathName);
  const number = optionalInteger(record, "number", pathName);
  const owner = optionalNullableString(record, "owner", pathName);
  const ownerKind = optionalNullableString(record, "ownerKind", pathName);
  const projectId = optionalNullableString(record, "projectId", pathName);
  const statusFieldId = optionalNullableString(
    record,
    "statusFieldId",
    pathName,
  );
  const statusOptions = optionalStringRecord(record, "statusOptions", pathName);

  return {
    kind: requiredString(record, "kind", pathName),
    ...(id !== undefined ? { id } : {}),
    ...(number !== undefined ? { number } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(ownerKind !== undefined ? { ownerKind } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(statusFieldId !== undefined ? { statusFieldId } : {}),
    ...(statusOptions ? { statusOptions } : {}),
  };
}

function validateWorkTrackingConfig(
  value: unknown,
  pathName = "workTracking",
): WorkTrackingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const provider = validateWorkTrackingProviderName(
    record.provider,
    `${pathName}.provider`,
  );
  const host = optionalNullableString(record, "host", pathName);
  const repository = validateWorkTrackingRepositoryConfig(
    record.repository,
    `${pathName}.repository`,
  );
  const board = validateWorkTrackingBoardConfig(record.board, `${pathName}.board`);
  const common = {
    ...(host !== undefined ? { host } : {}),
    ...(repository ? { repository } : {}),
    ...(board !== undefined ? { board } : {}),
  };

  if (provider === "local") {
    const storePath = optionalNullableString(record, "storePath", pathName);

    return {
      provider,
      ...common,
      ...(storePath !== undefined ? { storePath } : {}),
    } satisfies LocalWorkTrackingConfig;
  }

  if (provider === "vibe-kanban") {
    const projectId = optionalNullableString(record, "projectId", pathName);
    const repoId = optionalNullableString(record, "repoId", pathName);

    return {
      provider,
      ...common,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(repoId !== undefined ? { repoId } : {}),
    } satisfies VibeKanbanWorkTrackingConfig;
  }

  if (provider === "github") {
    const githubRepository = validateRequiredWorkTrackingRepositoryConfig(
      record.repository,
      `${pathName}.repository`,
    );
    if (!githubRepository.owner) {
      throw new NexusConfigError(
        `${pathName}.repository.owner must be a non-empty string`,
      );
    }
    if (!githubRepository.name) {
      throw new NexusConfigError(
        `${pathName}.repository.name must be a non-empty string`,
      );
    }

    return {
      provider,
      ...common,
      repository: {
        ...githubRepository,
        owner: githubRepository.owner,
        name: githubRepository.name,
      },
    } satisfies GitHubWorkTrackingConfig;
  }

  if (provider === "gitlab") {
    const gitlabRepository = validateRequiredWorkTrackingRepositoryConfig(
      record.repository,
      `${pathName}.repository`,
    );
    if (!gitlabRepository.id) {
      throw new NexusConfigError(
        `${pathName}.repository.id must be a non-empty string`,
      );
    }

    return {
      provider,
      ...common,
      repository: {
        ...gitlabRepository,
        id: gitlabRepository.id,
      },
    } satisfies GitLabWorkTrackingConfig;
  }

  const issueType = optionalNullableString(record, "issueType", pathName);

  return {
    provider,
    ...common,
    projectKey: requiredString(record, "projectKey", pathName),
    ...(issueType !== undefined ? { issueType } : {}),
  } satisfies JiraWorkTrackingConfig;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new NexusConfigError(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName}.${key} must be an array`);
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusConfigError(
        `${pathName}.${key}[${index}] must be a non-empty string`,
      );
    }
  }

  return [...value];
}

function optionalUniqueStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const values = optionalStringArray(record, key, pathName);
  if (!values) {
    return undefined;
  }
  assertUniqueValues(values, `${pathName}.${key}`);

  return values;
}

function optionalNullablePositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a positive integer or null`,
    );
  }

  return value;
}

function assertUniqueValues(values: readonly string[], pathName: string): void {
  const uniqueValues = new Set<string>();
  for (const value of values) {
    if (uniqueValues.has(value)) {
      throw new NexusConfigError(`${pathName} contains duplicate value: ${value}`);
    }
    uniqueValues.add(value);
  }
}

const nexusProjectWorkTrackerRoles: readonly NexusProjectWorkTrackerRole[] = [
  "primary",
  "eligible_source",
  "external_inbox",
  "mirror",
  "coordination",
  "planning",
  "external_feedback",
  "migration",
  "archive",
];

function validateWorkTrackerRole(
  value: unknown,
  pathName: string,
): NexusProjectWorkTrackerRole {
  if (
    typeof value === "string" &&
    nexusProjectWorkTrackerRoles.includes(value as NexusProjectWorkTrackerRole)
  ) {
    return value as NexusProjectWorkTrackerRole;
  }

  throw new NexusConfigError(
    `${pathName} must be ${nexusProjectWorkTrackerRoles.join(", ")}`,
  );
}

function validateWorkTrackerRoles(
  value: unknown,
  pathName: string,
): NexusProjectWorkTrackerRole[] {
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName} must not be empty`);
  }

  const roles = value.map((role, index) =>
    validateWorkTrackerRole(role, `${pathName}[${index}]`),
  );
  const uniqueRoles = new Set<NexusProjectWorkTrackerRole>();
  for (const role of roles) {
    if (uniqueRoles.has(role)) {
      throw new NexusConfigError(`${pathName} contains duplicate role: ${role}`);
    }
    uniqueRoles.add(role);
  }

  return roles;
}

function optionalWorkTrackerRoles(
  value: unknown,
  pathName: string,
  fallback: NexusProjectWorkTrackerRole[],
): NexusProjectWorkTrackerRole[] {
  if (value === undefined) {
    return [...fallback];
  }

  return validateWorkTrackerRoles(value, pathName);
}

function validateTrackerCoordinationHandoffPolicy(
  value: unknown,
  pathName: string,
): NexusProjectTrackerCoordinationHandoffPolicy {
  if (value === "comment" || value === "silent") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be comment or silent`);
}

function validateTrackerCommunicationPolicy(
  value: unknown,
  pathName: string,
): NexusProjectTrackerCommunicationPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const coordinationHandoffs =
    record.coordinationHandoffs === undefined
      ? undefined
      : validateTrackerCoordinationHandoffPolicy(
          record.coordinationHandoffs,
          `${pathName}.coordinationHandoffs`,
        );

  return {
    ...(coordinationHandoffs !== undefined ? { coordinationHandoffs } : {}),
  };
}

function validateTrackerDiscoveryDirectExternalSelection(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryDirectExternalSelection {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.directExternalSelection;
  }
  if (value === "disabled" || value === "allowed") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be disabled or allowed`);
}

function validateTrackerDiscoveryConflictWinner(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryConflictWinner {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.conflictWinner;
  }
  if (
    value === "block" ||
    value === "default_tracker" ||
    value === "scanned_tracker"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be block, default_tracker, or scanned_tracker`,
  );
}

function validateTrackerDiscoveryMissingCredentialBehavior(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryMissingCredentialBehavior {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.missingCredentialBehavior;
  }
  if (value === "block" || value === "skip") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be block or skip`);
}

function validateTrackerDiscoveryProviderFilters(
  value: unknown,
  pathName: string,
): WorkTrackingProviderName[] {
  if (value === undefined) {
    return [...defaultNexusProjectTrackerDiscoveryPolicy.providerFilters];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }

  const providers = value.map((entry, index) =>
    validateWorkTrackingProviderName(entry, `${pathName}[${index}]`),
  );
  assertUniqueValues(providers, pathName);

  return providers;
}

function validateTrackerDiscoveryQueryLimit(
  value: unknown,
  pathName: string,
): number | null {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.queryLimit;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(`${pathName} must be a positive integer or null`);
  }

  return value;
}

function validateTrackerDiscoveryTrackerLimits(
  value: unknown,
  pathName: string,
): Record<string, number> {
  if (value === undefined) {
    return { ...defaultNexusProjectTrackerDiscoveryPolicy.trackerLimits };
  }
  const record = assertRecord(value, pathName);
  const limits: Record<string, number> = {};
  for (const [trackerId, limit] of Object.entries(record)) {
    if (trackerId.trim().length === 0) {
      throw new NexusConfigError(`${pathName} tracker id must be non-empty`);
    }
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw new NexusConfigError(
        `${pathName}.${trackerId} must be a positive integer`,
      );
    }
    limits[trackerId] = limit;
  }

  return limits;
}

function validateTrackerDiscoveryFinalLimit(
  value: unknown,
  pathName: string,
): number | null {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.finalLimit ?? null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(`${pathName} must be a positive integer or null`);
  }

  return value;
}

function validateTrackerDiscoveryStatuses(
  value: unknown,
  pathName: string,
): WorkStatus[] {
  if (value === undefined) {
    return [...(defaultNexusProjectTrackerDiscoveryPolicy.statuses ?? [])];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  const statuses = value.map((entry, index) =>
    validateWorkStatus(entry, `${pathName}[${index}]`),
  );
  assertUniqueValues(statuses, pathName);

  return statuses;
}

function validateWorkStatus(value: unknown, pathName: string): WorkStatus {
  if (
    value === "todo" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done" ||
    value === "wont_do"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
  );
}

function validateTrackerDiscoveryStringFilters(
  value: unknown,
  pathName: string,
  fallback: readonly string[],
): string[] {
  if (value === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  const values = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusConfigError(`${pathName}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
  assertUniqueValues(values, pathName);

  return values;
}

function validateTrackerDiscoveryProviderQuery(
  value: unknown,
  pathName: string,
): string | null {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.providerQuery ?? null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(`${pathName} must be a non-empty string or null`);
  }

  return value.trim();
}

function validateTrackerDiscoveryFingerprints(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryFingerprintConfig[] {
  if (value === undefined) {
    return [...(defaultNexusProjectTrackerDiscoveryPolicy.fingerprints ?? [])];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }

  const fingerprints = value.map((entry, index) => {
    const entryPath = `${pathName}[${index}]`;
    const record = assertRecord(entry, entryPath);
    const fingerprint: NexusProjectTrackerDiscoveryFingerprintConfig = {
      id: requiredString(record, "id", entryPath).trim(),
      ...(record.trackerId !== undefined
        ? { trackerId: requiredString(record, "trackerId", entryPath).trim() }
        : {}),
      ...(record.provider !== undefined
        ? {
            provider: validateWorkTrackingProviderName(
              record.provider,
              `${entryPath}.provider`,
            ),
          }
        : {}),
      ...(record.host !== undefined
        ? { host: nullableString(record, "host", entryPath) }
        : {}),
      ...(record.repositoryId !== undefined
        ? { repositoryId: nullableString(record, "repositoryId", entryPath) }
        : {}),
      ...(record.repositoryOwner !== undefined
        ? { repositoryOwner: nullableString(record, "repositoryOwner", entryPath) }
        : {}),
      ...(record.repositoryName !== undefined
        ? { repositoryName: nullableString(record, "repositoryName", entryPath) }
        : {}),
      ...(record.projectId !== undefined
        ? { projectId: nullableString(record, "projectId", entryPath) }
        : {}),
      ...(record.boardId !== undefined
        ? { boardId: nullableString(record, "boardId", entryPath) }
        : {}),
      ...(record.itemId !== undefined
        ? { itemId: requiredString(record, "itemId", entryPath).trim() }
        : {}),
      ...(record.itemNumber !== undefined
        ? {
            itemNumber: validatePositiveInteger(
              record.itemNumber,
              `${entryPath}.itemNumber`,
            ),
          }
        : {}),
      ...(record.itemKey !== undefined
        ? { itemKey: requiredString(record, "itemKey", entryPath).trim() }
        : {}),
      ...(record.nodeId !== undefined
        ? { nodeId: requiredString(record, "nodeId", entryPath).trim() }
        : {}),
    };
    if (
      fingerprint.itemId === undefined &&
      fingerprint.itemNumber === undefined &&
      fingerprint.itemKey === undefined &&
      fingerprint.nodeId === undefined
    ) {
      throw new NexusConfigError(
        `${entryPath} must include itemId, itemNumber, itemKey, or nodeId`,
      );
    }

    return fingerprint;
  });
  return fingerprints;
}

function validatePositiveInteger(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(`${pathName} must be a positive integer`);
  }

  return value;
}

function validateTrackerDiscoveryPolicy(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const policy: NexusProjectTrackerDiscoveryPolicyConfig = {
    scannedRoles: optionalWorkTrackerRoles(
      record.scannedRoles,
      `${pathName}.scannedRoles`,
      defaultNexusProjectTrackerDiscoveryPolicy.scannedRoles,
    ),
    directExternalSelection: validateTrackerDiscoveryDirectExternalSelection(
      record.directExternalSelection,
      `${pathName}.directExternalSelection`,
    ),
    importRequiredFirst: optionalBoolean(
      record,
      "importRequiredFirst",
      pathName,
    ) ?? defaultNexusProjectTrackerDiscoveryPolicy.importRequiredFirst,
    providerFilters: validateTrackerDiscoveryProviderFilters(
      record.providerFilters,
      `${pathName}.providerFilters`,
    ),
    queryLimit: validateTrackerDiscoveryQueryLimit(
      record.queryLimit,
      `${pathName}.queryLimit`,
    ),
    trackerLimits: validateTrackerDiscoveryTrackerLimits(
      record.trackerLimits,
      `${pathName}.trackerLimits`,
    ),
    finalLimit: validateTrackerDiscoveryFinalLimit(
      record.finalLimit,
      `${pathName}.finalLimit`,
    ),
    statuses: validateTrackerDiscoveryStatuses(
      record.statuses,
      `${pathName}.statuses`,
    ),
    labels: validateTrackerDiscoveryStringFilters(
      record.labels,
      `${pathName}.labels`,
      defaultNexusProjectTrackerDiscoveryPolicy.labels ?? [],
    ),
    milestones: validateTrackerDiscoveryStringFilters(
      record.milestones,
      `${pathName}.milestones`,
      defaultNexusProjectTrackerDiscoveryPolicy.milestones ?? [],
    ),
    assignees: validateTrackerDiscoveryStringFilters(
      record.assignees,
      `${pathName}.assignees`,
      defaultNexusProjectTrackerDiscoveryPolicy.assignees ?? [],
    ),
    providerQuery: validateTrackerDiscoveryProviderQuery(
      record.providerQuery,
      `${pathName}.providerQuery`,
    ),
    fingerprints: validateTrackerDiscoveryFingerprints(
      record.fingerprints,
      `${pathName}.fingerprints`,
    ),
    conflictWinner: validateTrackerDiscoveryConflictWinner(
      record.conflictWinner,
      `${pathName}.conflictWinner`,
    ),
    missingCredentialBehavior: validateTrackerDiscoveryMissingCredentialBehavior(
      record.missingCredentialBehavior,
      `${pathName}.missingCredentialBehavior`,
    ),
  };

  if (
    policy.directExternalSelection === "allowed" &&
    policy.importRequiredFirst
  ) {
    throw new NexusConfigError(
      `${pathName}.directExternalSelection cannot be allowed when importRequiredFirst is true`,
    );
  }

  return policy;
}

export function normalizeNexusProjectTrackerDiscoveryPolicy(
  policy: NexusProjectTrackerDiscoveryPolicyConfig | undefined,
): NormalizedNexusProjectTrackerDiscoveryPolicy {
  const normalized = policy ?? defaultNexusProjectTrackerDiscoveryPolicy;

  return {
    scannedRoles: [...normalized.scannedRoles],
    directExternalSelection: normalized.directExternalSelection,
    importRequiredFirst: normalized.importRequiredFirst,
    providerFilters: [...normalized.providerFilters],
    queryLimit: normalized.queryLimit,
    trackerLimits: { ...(normalized.trackerLimits ?? {}) },
    finalLimit: normalized.finalLimit ?? null,
    statuses: [...(normalized.statuses ?? [])],
    labels: [...(normalized.labels ?? [])],
    milestones: [...(normalized.milestones ?? [])],
    assignees: [...(normalized.assignees ?? [])],
    providerQuery: normalized.providerQuery ?? null,
    fingerprints: [...(normalized.fingerprints ?? [])],
    conflictWinner: normalized.conflictWinner,
    missingCredentialBehavior: normalized.missingCredentialBehavior,
    defaultTrackerOnly: policy === undefined,
  };
}

function validateComponentWorkTrackerBinding(
  value: unknown,
  index: number,
  componentPathName: string,
): NexusProjectWorkTrackerBindingConfig {
  const pathName = `${componentPathName}.workTrackers[${index}]`;
  const record = assertRecord(value, pathName);
  const workTracking = validateWorkTrackingConfig(
    record.workTracking,
    `${pathName}.workTracking`,
  );
  if (!workTracking) {
    throw new NexusConfigError(`${pathName}.workTracking must be an object`);
  }

  const id = requiredString(record, "id", pathName);
  const communication = validateTrackerCommunicationPolicy(
    record.communication,
    `${pathName}.communication`,
  );
  return {
    id,
    name: optionalString(record, "name", pathName) ?? id,
    enabled: optionalBoolean(record, "enabled", pathName) ?? true,
    roles: validateWorkTrackerRoles(record.roles, `${pathName}.roles`),
    ...(communication ? { communication } : {}),
    workTracking,
  };
}

function validateComponentWorkTrackers(
  record: Record<string, unknown>,
  pathName: string,
): Pick<NexusProjectComponentConfig, "defaultWorkTrackerId" | "workTrackers"> {
  const value = record.workTrackers;
  if (value === undefined) {
    if (record.defaultWorkTrackerId !== undefined) {
      optionalString(record, "defaultWorkTrackerId", pathName);
      throw new NexusConfigError(
        `${pathName}.defaultWorkTrackerId requires workTrackers`,
      );
    }
    return {};
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName}.workTrackers must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName}.workTrackers must not be empty`);
  }

  const workTrackers = value.map((entry, index) =>
    validateComponentWorkTrackerBinding(entry, index, pathName),
  );
  const trackerIds = new Set<string>();
  for (const tracker of workTrackers) {
    if (trackerIds.has(tracker.id)) {
      throw new NexusConfigError(
        `${pathName}.workTrackers contains duplicate id: ${tracker.id}`,
      );
    }
    trackerIds.add(tracker.id);
  }

  const enabledTrackerIds = new Set(
    workTrackers
      .filter((tracker) => tracker.enabled)
      .map((tracker) => tracker.id),
  );
  if (enabledTrackerIds.size === 0) {
    throw new NexusConfigError(
      `${pathName}.workTrackers must contain at least one enabled tracker`,
    );
  }

  const defaultWorkTrackerId = optionalString(
    record,
    "defaultWorkTrackerId",
    pathName,
  );
  if (!defaultWorkTrackerId) {
    throw new NexusConfigError(
      `${pathName}.defaultWorkTrackerId must reference a configured enabled tracker`,
    );
  }
  if (!trackerIds.has(defaultWorkTrackerId)) {
    throw new NexusConfigError(
      `${pathName}.defaultWorkTrackerId references unknown tracker: ${defaultWorkTrackerId}`,
    );
  }
  if (!enabledTrackerIds.has(defaultWorkTrackerId)) {
    throw new NexusConfigError(
      `${pathName}.defaultWorkTrackerId must reference an enabled tracker`,
    );
  }

  return {
    defaultWorkTrackerId,
    workTrackers,
  };
}

export function normalizeComponentWorkTrackers(
  component: Pick<
    NexusProjectComponentConfig,
    "defaultWorkTrackerId" | "trackerDiscovery" | "workTrackers" | "workTracking"
  >,
): NormalizedNexusProjectWorkTrackers {
  const explicitTrackers = component.workTrackers ?? [];
  const trackers =
    explicitTrackers.length > 0
      ? explicitTrackers
      : component.workTracking
        ? [
            {
              id: legacyDefaultWorkTrackerId,
              name: legacyDefaultWorkTrackerName,
              enabled: true,
              roles: ["primary" as const],
              workTracking: component.workTracking,
            },
          ]
        : [];
  const defaultTrackerId =
    component.defaultWorkTrackerId ??
    trackers.find((tracker) => tracker.enabled)?.id ??
    null;
  const defaultTracker =
    defaultTrackerId === null
      ? null
      : trackers.find(
          (tracker) => tracker.id === defaultTrackerId && tracker.enabled,
        ) ?? null;

  return {
    defaultTrackerId: defaultTracker?.id ?? null,
    defaultTracker,
    trackers,
    discoveryPolicy: normalizeNexusProjectTrackerDiscoveryPolicy(
      component.trackerDiscovery,
    ),
  };
}

function validateComponentRole(
  value: unknown,
  fallback: NexusProjectComponentRole,
  pathName: string,
): NexusProjectComponentRole {
  if (value === undefined) {
    return fallback;
  }

  if (
    value === "primary" ||
    value === "extension" ||
    value === "addon" ||
    value === "dependency" ||
    value === "optional"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be primary, extension, addon, dependency, or optional`,
  );
}

function validateComponentRelationshipKind(
  value: unknown,
  pathName: string,
): NexusProjectComponentRelationshipKind {
  if (
    value === "extends" ||
    value === "depends_on" ||
    value === "optional" ||
    value === "related"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be extends, depends_on, optional, or related`,
  );
}

function validateComponentRelationships(
  value: unknown,
  pathName: string,
): NexusProjectComponentRelationshipConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }

  return value.map((entry, index) => {
    const entryPath = `${pathName}[${index}]`;
    const record = assertRecord(entry, entryPath);
    return {
      kind: validateComponentRelationshipKind(record.kind, `${entryPath}.kind`),
      componentId: requiredString(record, "componentId", entryPath),
    };
  });
}

function validateComponentVerificationConfig(
  value: unknown,
  pathName: string,
): Partial<NexusAutomationVerificationConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const focusedCommands = optionalStringArray(record, "focusedCommands", pathName);
  const fullCommands = optionalStringArray(record, "fullCommands", pathName);
  const requirePassing = optionalBoolean(record, "requirePassing", pathName);
  const ciTiers = record.ciTiers === undefined
    ? undefined
    : validateNexusCiTierPolicyConfig(record.ciTiers, `${pathName}.ciTiers`);

  return {
    ...(focusedCommands !== undefined ? { focusedCommands } : {}),
    ...(fullCommands !== undefined ? { fullCommands } : {}),
    ...(requirePassing !== undefined ? { requirePassing } : {}),
    ...(ciTiers !== undefined ? { ciTiers } : {}),
  };
}

function validateComponentPublicationConfig(
  value: unknown,
  pathName: string,
): Partial<NexusAutomationPublicationConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return validatePartialNexusAutomationPublicationConfig(value, pathName);
}

function validateRepoConfig(value: unknown): NexusProjectRepoConfig {
  if (value === undefined) {
    return {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    };
  }

  const record = assertRecord(value, "repo");
  const kind = record.kind;
  if (kind !== "local" && kind !== "git") {
    throw new NexusConfigError("repo.kind must be local or git");
  }
  const sourceRoot = optionalString(record, "sourceRoot", "repo");

  return {
    kind,
    remoteUrl: nullableString(record, "remoteUrl", "repo"),
    defaultBranch: nullableString(record, "defaultBranch", "repo"),
    ...(sourceRoot ? { sourceRoot } : {}),
  };
}

function validateProjectComponent(
  value: unknown,
  index: number,
): NexusProjectComponentConfig {
  const pathName = `workspace config.components[${index}]`;
  const record = assertRecord(value, pathName);
  const id = requiredString(record, "id", pathName);
  const kind = record.kind;
  if (kind !== "local" && kind !== "git") {
    throw new NexusConfigError(`${pathName}.kind must be local or git`);
  }
  const sourceRoot = optionalString(record, "sourceRoot", pathName) ?? `components/${id}`;
  const worktreesRoot = optionalString(record, "worktreesRoot", pathName);
  const workTracking = validateWorkTrackingConfig(record.workTracking);
  const workTrackerBindings = validateComponentWorkTrackers(record, pathName);
  const trackerDiscovery = validateTrackerDiscoveryPolicy(
    record.trackerDiscovery,
    `${pathName}.trackerDiscovery`,
  );
  const review = validateNexusReviewPolicyConfig(
    record.review,
    `${pathName}.review`,
  );
  const verification = validateComponentVerificationConfig(
    record.verification,
    `${pathName}.verification`,
  );
  const publication = validateComponentPublicationConfig(
    record.publication,
    `${pathName}.publication`,
  );

  return {
    id,
    name: optionalString(record, "name", pathName) ?? id,
    kind,
    role: validateComponentRole(
      record.role,
      index === 0 ? "primary" : "dependency",
      `${pathName}.role`,
    ),
    remoteUrl: nullableString(record, "remoteUrl", pathName),
    defaultBranch: nullableString(record, "defaultBranch", pathName),
    ...(sourceRoot ? { sourceRoot } : {}),
    ...(worktreesRoot ? { worktreesRoot } : {}),
    ...(workTracking ? { workTracking } : {}),
    ...workTrackerBindings,
    ...(trackerDiscovery ? { trackerDiscovery } : {}),
    ...(review ? { review } : {}),
    ...(verification ? { verification } : {}),
    ...(publication ? { publication } : {}),
    relationships: validateComponentRelationships(
      record.relationships,
      `${pathName}.relationships`,
    ),
  };
}

function defaultPrimaryComponentFromRepo(
  config: Pick<NexusProjectConfig, "name" | "repo" | "workTracking">,
): NexusProjectComponentConfig {
  return {
    id: "primary",
    name: config.name,
    kind: config.repo.kind,
    role: "primary",
    remoteUrl: config.repo.remoteUrl,
    defaultBranch: config.repo.defaultBranch,
    sourceRoot: config.repo.sourceRoot ?? ".",
    ...(config.workTracking ? { workTracking: config.workTracking } : {}),
    relationships: [],
  };
}

function validateProjectComponentsConfig(
  value: unknown,
  fallback: Pick<NexusProjectConfig, "name" | "repo" | "workTracking">,
): NexusProjectComponentConfig[] {
  if (value === undefined) {
    return [defaultPrimaryComponentFromRepo(fallback)];
  }

  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.components must be an array");
  }
  if (value.length === 0) {
    throw new NexusConfigError("workspace config.components must not be empty");
  }

  const components = value.map((entry, index) =>
    validateProjectComponent(entry, index),
  );
  const ids = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) {
      throw new NexusConfigError(
        `workspace config.components contains duplicate id: ${component.id}`,
      );
    }
    ids.add(component.id);
  }
  const primaryComponents = components.filter(
    (component) => component.role === "primary",
  );
  if (primaryComponents.length !== 1) {
    throw new NexusConfigError(
      "workspace config.components must contain exactly one primary component",
    );
  }
  for (const component of components) {
    for (const relationship of component.relationships) {
      if (!ids.has(relationship.componentId)) {
        throw new NexusConfigError(
          `workspace config.components.${component.id} relationship references unknown component: ${relationship.componentId}`,
        );
      }
    }
  }

  return components;
}

function validatePluginDependencyProjectionSourceComponents(
  plugins: NexusProjectPluginsConfig | undefined,
  components: NexusProjectComponentConfig[],
): void {
  const componentIds = new Set(components.map((component) => component.id));
  for (const plugin of plugins ?? []) {
    for (const capability of plugin.capabilities) {
      if (
        capability.kind === "dependency_projection" &&
        capability.sourceComponentId &&
        !componentIds.has(capability.sourceComponentId)
      ) {
        throw new NexusConfigError(
          `workspace config.plugins.${plugin.id}.${capability.id} sourceComponentId references unknown component: ${capability.sourceComponentId}`,
        );
      }
    }
  }
}

function validatePluginMcpToolOwnership(
  plugins: NexusProjectPluginsConfig | undefined,
): void {
  const coreToolNames = new Set<string>(devNexusCoreMcpToolNames);
  const overlaps: Array<{
    pluginId: string;
    serverName: string;
    duplicateTools: string[];
  }> = [];

  for (const plugin of plugins ?? []) {
    for (const capability of plugin.capabilities) {
      if (capability.kind !== "mcp_server") {
        continue;
      }

      const duplicateTools = Array.from(new Set(
        (capability.tools ?? [])
          .map((tool) => tool.name.trim())
          .filter((toolName) => coreToolNames.has(toolName)),
      )).sort((left, right) => left.localeCompare(right));
      if (duplicateTools.length === 0) {
        continue;
      }

      overlaps.push({
        pluginId: plugin.id,
        serverName: capability.serverName,
        duplicateTools,
      });
    }
  }

  if (overlaps.length === 0) {
    return;
  }

  const details = overlaps
    .map((overlap) =>
      `plugin id ${overlap.pluginId} server ${overlap.serverName} duplicate tools: ${overlap.duplicateTools.join(", ")}`,
    )
    .join("; ");
  throw new NexusConfigError(
    `Plugin MCP server tool overlap is not allowed: ${details}. Generic DevNexus operations belong to ${devNexusCoreMcpServerName}.`,
  );
}

export function validateProjectConfig(value: unknown): NexusProjectConfig {
  const record = assertRecord(value, "workspace config");
  if (record.version !== 1) {
    throw new NexusConfigError("workspace config.version must be 1");
  }
  const agent = validateNexusAgentConfig(record.agent, "workspace config.agent");
  const workTracking = validateWorkTrackingConfig(record.workTracking);
  const workTrackerCommunication = validateTrackerCommunicationPolicy(
    record.workTrackerCommunication,
    "workspace config.workTrackerCommunication",
  );
  const extensions = validateProjectExtensionsConfig(record.extensions);
  const skills = validateProjectSkillsConfig(record.skills);
  const plugins = validateProjectPluginsConfig(record.plugins);
  const mcp = validateProjectMcpConfig(record.mcp);
  const agentTargets = validateProjectAgentTargetsConfig(record.agentTargets);
  const hosting = validateProjectHostingConfig(record.hosting);
  const automation = validateNexusAutomationConfig(record.automation);
  const hosts = validateProjectHostsConfig(record.hosts);
  const runnerProfiles = validateRunnerProfilesConfig(record.runnerProfiles);
  const authority = validateNexusAuthorityConfig(record.authority);
  const repo = validateRepoConfig(record.repo);
  const kanban = validateKanbanConfig(record.kanban);
  const worktreesRoot =
    optionalString(record, "worktreesRoot", "workspace config") ??
    nexusProjectWorktreesDirectoryName;
  const common = {
    version: 1 as const,
    id: requiredString(record, "id", "workspace config"),
    name: requiredString(record, "name", "workspace config"),
    home: nullableString(record, "home", "workspace config"),
    repo,
    worktreesRoot,
    ...(kanban ? { kanban } : {}),
    ...(workTracking ? { workTracking } : {}),
    ...(workTrackerCommunication ? { workTrackerCommunication } : {}),
  };
  const components = validateProjectComponentsConfig(record.components, common);
  const versionPlanning = validateNexusVersionPlanningConfig(
    record.versionPlanning,
    {
      componentIds: new Set(components.map((component) => component.id)),
      pathName: "workspace config.versionPlanning",
    },
  );
  validatePluginDependencyProjectionSourceComponents(plugins, components);
  validatePluginMcpToolOwnership(plugins);

  return {
    ...common,
    components,
    ...(extensions ? { extensions } : {}),
    ...(agent ? { agent } : {}),
    ...(agentTargets ? { agentTargets } : {}),
    ...(mcp ? { mcp } : {}),
    ...(skills ? { skills } : {}),
    ...(plugins ? { plugins } : {}),
    ...(hosting ? { hosting } : {}),
    ...(automation ? { automation } : {}),
    hosts,
    ...(runnerProfiles !== undefined ? { runnerProfiles } : {}),
    ...(authority ? { authority } : {}),
    ...(versionPlanning ? { versionPlanning } : {}),
  };
}

export function loadProjectConfig(projectRootPath: string): NexusProjectConfig {
  const configPath = projectConfigPath(projectRootPath);
  if (!fs.existsSync(configPath)) {
    throw new NexusConfigError(
      `DevNexus workspace is not initialized: ${configPath}`,
    );
  }

  return validateProjectConfig(
    JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function saveProjectConfig(
  projectRootPath: string,
  config: NexusProjectConfig,
): string {
  const configPath = projectConfigPath(projectRootPath);
  fs.mkdirSync(projectRootPath, { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(validateProjectConfig(config), null, 2)}\n`,
    "utf8",
  );
  return configPath;
}
