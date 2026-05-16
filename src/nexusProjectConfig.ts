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
  validateNexusAutomationConfig,
  type NexusAutomationConfig,
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

export interface NexusProjectConfig {
  version: 1;
  id: string;
  name: string;
  home: string | null;
  repo: NexusProjectRepoConfig;
  worktreesRoot: string;
  kanban: NexusProjectKanbanConfig;
  workTracking?: WorkTrackingConfig;
  extensions?: NexusProjectExtensionsConfig;
  agent?: NexusAgentConfig;
  skills?: NexusProjectSkillsConfig;
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

export function validateProjectConfig(value: unknown): NexusProjectConfig {
  const record = assertRecord(value, "project config");
  if (record.version !== 1) {
    throw new NexusConfigError("project config.version must be 1");
  }
  const agent = validateNexusAgentConfig(record.agent, "project config.agent");
  const workTracking = validateWorkTrackingConfig(record.workTracking);
  const extensions = validateProjectExtensionsConfig(record.extensions);
  const skills = validateProjectSkillsConfig(record.skills);
  const automation = validateNexusAutomationConfig(record.automation);

  return {
    version: 1,
    id: requiredString(record, "id", "project config"),
    name: requiredString(record, "name", "project config"),
    home: nullableString(record, "home", "project config"),
    repo: validateRepoConfig(record.repo),
    worktreesRoot:
      optionalString(record, "worktreesRoot", "project config") ??
      nexusProjectWorktreesDirectoryName,
    kanban: validateKanbanConfig(record.kanban),
    ...(workTracking ? { workTracking } : {}),
    ...(extensions ? { extensions } : {}),
    ...(agent ? { agent } : {}),
    ...(skills ? { skills } : {}),
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
