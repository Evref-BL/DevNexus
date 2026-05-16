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
  validateNexusAutomationConfig,
  type NexusAutomationConfig,
  type NexusAutomationPublicationConfig,
  type NexusAutomationVerificationConfig,
} from "./nexusAutomationConfig.js";

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

export interface NexusProjectAgentMcpTarget {
  agent: string;
  enabled?: boolean;
  configPath?: string;
  sourceControl?: NexusSkillSourceControl;
  serverName?: string;
  command?: string;
  args?: string[];
}

export interface NexusProjectMcpConfig {
  enabled?: boolean;
  sourceControl?: NexusSkillSourceControl;
  serverName?: string;
  command?: string;
  args?: string[];
  agentTargets?: NexusProjectAgentMcpTarget[];
}

export interface NexusProjectConfig {
  version: 1;
  id: string;
  name: string;
  home: string | null;
  repo: NexusProjectRepoConfig;
  components: NexusProjectComponentConfig[];
  worktreesRoot: string;
  kanban: NexusProjectKanbanConfig;
  workTracking?: WorkTrackingConfig;
  extensions?: NexusProjectExtensionsConfig;
  agent?: NexusAgentConfig;
  mcp?: NexusProjectMcpConfig;
  skills?: NexusProjectSkillsConfig;
  plugins?: NexusProjectPluginsConfig;
  automation?: NexusAutomationConfig;
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

export function projectConfigPath(projectRootPath: string): string {
  return path.join(path.resolve(projectRootPath), devNexusProjectConfigFileName);
}

function resolveFromProject(projectRootPath: string, value: string): string {
  return path.resolve(projectRootPath, value);
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

function validateKanbanConfig(value: unknown): NexusProjectKanbanConfig {
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

  const record = assertRecord(value, "project config.extensions");
  const extensions: NexusProjectExtensionsConfig = {};
  for (const [key, extensionValue] of Object.entries(record)) {
    if (!key.trim()) {
      throw new NexusConfigError(
        "project config.extensions keys must be non-empty strings",
      );
    }
    if (
      !extensionValue ||
      typeof extensionValue !== "object" ||
      Array.isArray(extensionValue)
    ) {
      throw new NexusConfigError(
        `project config.extensions.${key} must be an object`,
      );
    }

    extensions[key] = { ...(extensionValue as Record<string, unknown>) };
  }

  return extensions;
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
  const pathName = `project config.skills.items[${index}]`;
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
  const pathName = `project config.skills.agentTargets[${index}]`;
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

  const record = assertRecord(value, "project config.skills");
  const defaultCorePack = record.defaultCorePack;
  if (defaultCorePack !== undefined && typeof defaultCorePack !== "boolean") {
    throw new NexusConfigError(
      "project config.skills.defaultCorePack must be a boolean",
    );
  }
  const items = record.items;
  if (items !== undefined && !Array.isArray(items)) {
    throw new NexusConfigError("project config.skills.items must be an array");
  }
  const agentTargets = record.agentTargets;
  if (agentTargets !== undefined && !Array.isArray(agentTargets)) {
    throw new NexusConfigError(
      "project config.skills.agentTargets must be an array",
    );
  }
  const materialization = validateSkillMaterialization(
    record.materialization,
    "project config.skills.materialization",
  );
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    "project config.skills.sourceControl",
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
    const tools = validatePluginMcpTools(record.tools, `${pathName}.tools`);
    return {
      kind,
      id,
      ...(description !== undefined ? { description } : {}),
      serverName: requiredString(record, "serverName", pathName),
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
      source: requiredProjectRelativePath(record, "source", pathName),
      target: requiredProjectRelativePath(record, "target", pathName),
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
  const pathName = `project config.plugins[${index}]`;
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName) ?? true;
  const name = optionalString(record, "name", pathName);
  const version = optionalString(record, "version", pathName);
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
    throw new NexusConfigError("project config.plugins must be an array");
  }

  const plugins = value.map((plugin, index) =>
    validateProjectPluginConfig(plugin, index),
  );
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) {
      throw new NexusConfigError(
        `project config.plugins contains duplicate id: ${plugin.id}`,
      );
    }
    ids.add(plugin.id);
  }

  return plugins;
}

function validateProjectMcpAgentTarget(
  value: unknown,
  index: number,
): NexusProjectAgentMcpTarget {
  const pathName = `project config.mcp.agentTargets[${index}]`;
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record, "enabled", pathName);
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    `${pathName}.sourceControl`,
  );
  const configPath = optionalString(record, "configPath", pathName);
  const serverName = optionalString(record, "serverName", pathName);
  const command = optionalString(record, "command", pathName);
  const args = optionalStringArray(record, "args", pathName);

  return {
    agent: requiredString(record, "agent", pathName),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(configPath !== undefined ? { configPath } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(serverName !== undefined ? { serverName } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
  };
}

function validateProjectMcpConfig(
  value: unknown,
): NexusProjectMcpConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "project config.mcp");
  const enabled = optionalBoolean(record, "enabled", "project config.mcp");
  const sourceControl = validateSkillSourceControl(
    record.sourceControl,
    "project config.mcp.sourceControl",
  );
  const serverName = optionalString(record, "serverName", "project config.mcp");
  const command = optionalString(record, "command", "project config.mcp");
  const args = optionalStringArray(record, "args", "project config.mcp");
  const agentTargets = record.agentTargets;
  if (agentTargets !== undefined && !Array.isArray(agentTargets)) {
    throw new NexusConfigError(
      "project config.mcp.agentTargets must be an array",
    );
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(sourceControl !== undefined ? { sourceControl } : {}),
    ...(serverName !== undefined ? { serverName } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(agentTargets
      ? {
          agentTargets: agentTargets.map((target, index) =>
            validateProjectMcpAgentTarget(target, index),
          ),
        }
      : {}),
  };
}

function validateWorkTrackingProviderName(
  value: unknown,
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
    "workTracking.provider must be local, vibe-kanban, github, gitlab, or jira",
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
): WorkTrackingBoardConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const pathName = "workTracking.board";
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
): WorkTrackingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "workTracking");
  const provider = validateWorkTrackingProviderName(record.provider);
  const host = optionalNullableString(record, "host", "workTracking");
  const repository = validateWorkTrackingRepositoryConfig(
    record.repository,
    "workTracking.repository",
  );
  const board = validateWorkTrackingBoardConfig(record.board);
  const common = {
    ...(host !== undefined ? { host } : {}),
    ...(repository ? { repository } : {}),
    ...(board !== undefined ? { board } : {}),
  };

  if (provider === "local") {
    const storePath = optionalNullableString(record, "storePath", "workTracking");

    return {
      provider,
      ...common,
      ...(storePath !== undefined ? { storePath } : {}),
    } satisfies LocalWorkTrackingConfig;
  }

  if (provider === "vibe-kanban") {
    const projectId = optionalNullableString(record, "projectId", "workTracking");
    const repoId = optionalNullableString(record, "repoId", "workTracking");

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
      "workTracking.repository",
    );
    if (!githubRepository.owner) {
      throw new NexusConfigError(
        "workTracking.repository.owner must be a non-empty string",
      );
    }
    if (!githubRepository.name) {
      throw new NexusConfigError(
        "workTracking.repository.name must be a non-empty string",
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
      "workTracking.repository",
    );
    if (!gitlabRepository.id) {
      throw new NexusConfigError(
        "workTracking.repository.id must be a non-empty string",
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

  const issueType = optionalNullableString(record, "issueType", "workTracking");

  return {
    provider,
    ...common,
    projectKey: requiredString(record, "projectKey", "workTracking"),
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

  return {
    ...(focusedCommands !== undefined ? { focusedCommands } : {}),
    ...(fullCommands !== undefined ? { fullCommands } : {}),
    ...(requirePassing !== undefined ? { requirePassing } : {}),
  };
}

function validatePublicationStrategy(
  value: unknown,
  pathName: string,
): NexusAutomationPublicationConfig["strategy"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be local_only, direct_integration, or review_handoff`,
  );
}

function validateComponentPublicationConfig(
  value: unknown,
  pathName: string,
): Partial<NexusAutomationPublicationConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const strategy = validatePublicationStrategy(record.strategy, `${pathName}.strategy`);
  const remote = optionalNullableString(record, "remote", pathName);
  const targetBranch = optionalNullableString(record, "targetBranch", pathName);
  const push = optionalBoolean(record, "push", pathName);

  return {
    ...(strategy !== undefined ? { strategy } : {}),
    ...(remote !== undefined ? { remote } : {}),
    ...(targetBranch !== undefined ? { targetBranch } : {}),
    ...(push !== undefined ? { push } : {}),
  };
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
  const pathName = `project config.components[${index}]`;
  const record = assertRecord(value, pathName);
  const id = requiredString(record, "id", pathName);
  const kind = record.kind;
  if (kind !== "local" && kind !== "git") {
    throw new NexusConfigError(`${pathName}.kind must be local or git`);
  }
  const sourceRoot = optionalString(record, "sourceRoot", pathName) ?? `components/${id}`;
  const worktreesRoot = optionalString(record, "worktreesRoot", pathName);
  const workTracking = validateWorkTrackingConfig(record.workTracking);
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
    throw new NexusConfigError("project config.components must be an array");
  }
  if (value.length === 0) {
    throw new NexusConfigError("project config.components must not be empty");
  }

  const components = value.map((entry, index) =>
    validateProjectComponent(entry, index),
  );
  const ids = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) {
      throw new NexusConfigError(
        `project config.components contains duplicate id: ${component.id}`,
      );
    }
    ids.add(component.id);
  }
  const primaryComponents = components.filter(
    (component) => component.role === "primary",
  );
  if (primaryComponents.length !== 1) {
    throw new NexusConfigError(
      "project config.components must contain exactly one primary component",
    );
  }
  for (const component of components) {
    for (const relationship of component.relationships) {
      if (!ids.has(relationship.componentId)) {
        throw new NexusConfigError(
          `project config.components.${component.id} relationship references unknown component: ${relationship.componentId}`,
        );
      }
    }
  }

  return components;
}

export function validateProjectConfig(value: unknown): NexusProjectConfig {
  const record = assertRecord(value, "project config");
  if (record.version !== 1) {
    throw new NexusConfigError("project config.version must be 1");
  }
  const agent = validateNexusAgentConfig(record.agent, "project config.agent");
  const workTracking = validateWorkTrackingConfig(record.workTracking);
  const extensions = validateProjectExtensionsConfig(record.extensions);
  const skills = validateProjectSkillsConfig(record.skills);
  const plugins = validateProjectPluginsConfig(record.plugins);
  const mcp = validateProjectMcpConfig(record.mcp);
  const automation = validateNexusAutomationConfig(record.automation);
  const repo = validateRepoConfig(record.repo);
  const worktreesRoot =
    optionalString(record, "worktreesRoot", "project config") ??
    nexusProjectWorktreesDirectoryName;
  const common = {
    version: 1 as const,
    id: requiredString(record, "id", "project config"),
    name: requiredString(record, "name", "project config"),
    home: nullableString(record, "home", "project config"),
    repo,
    worktreesRoot,
    kanban: validateKanbanConfig(record.kanban),
    ...(workTracking ? { workTracking } : {}),
  };

  return {
    ...common,
    components: validateProjectComponentsConfig(record.components, common),
    ...(extensions ? { extensions } : {}),
    ...(agent ? { agent } : {}),
    ...(mcp ? { mcp } : {}),
    ...(skills ? { skills } : {}),
    ...(plugins ? { plugins } : {}),
    ...(automation ? { automation } : {}),
  };
}

export function loadProjectConfig(projectRootPath: string): NexusProjectConfig {
  const configPath = projectConfigPath(projectRootPath);
  if (!fs.existsSync(configPath)) {
    throw new NexusConfigError(
      `DevNexus project is not initialized: ${configPath}`,
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
