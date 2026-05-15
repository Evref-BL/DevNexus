import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  NexusConfigError,
  validateNexusAgentConfig,
  type NexusAgentConfig,
} from "./nexusProjectConfig.js";
import type { NexusProjectReference } from "./nexusProjectRegistry.js";

export const devNexusHomeConfigFileName = "dev-nexus.home.json";
export const nexusLogsDirectoryName = "logs";
export const nexusGeneratedDirectoryName = "generated";

export interface NexusHomePathsConfig {
  projectsRoot: string;
  workspacesRoot: string;
}

export interface NexusHomeConfigBase {
  version: 1;
  paths: NexusHomePathsConfig;
  agent?: NexusAgentConfig;
  projects: NexusProjectReference[];
}

export interface CreateDefaultNexusHomeConfigBaseOptions {
  projectsRoot?: string;
  workspacesRoot?: string;
  agent?: NexusAgentConfig;
}

export interface DefaultNexusHomePathOptions {
  envVarName?: string;
  directoryName?: string;
}

export interface LoadNexusHomeConfigFileOptions {
  missingMessage?: string | ((configPath: string) => string);
}

type NexusHomeConfigValidator<T> = (
  value: unknown,
  homePathForDefaults: string,
) => T;

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

function validateNexusProjectReference(
  value: unknown,
  index: number,
): NexusProjectReference {
  const pathName = `projects[${index}]`;
  const record = assertRecord(value, pathName);
  const trackerProjectId = optionalString(
    record,
    "vibeKanbanProjectId",
    pathName,
  );
  const trackerRepoId = optionalString(record, "vibeKanbanRepoId", pathName);

  return {
    id: requiredString(record, "id", pathName),
    name: requiredString(record, "name", pathName),
    projectRoot: requiredString(record, "projectRoot", pathName),
    ...(trackerProjectId ? { vibeKanbanProjectId: trackerProjectId } : {}),
    ...(trackerRepoId ? { vibeKanbanRepoId: trackerRepoId } : {}),
  };
}

function validateNexusProjectReferences(value: unknown): NexusProjectReference[] {
  if (!Array.isArray(value)) {
    throw new NexusConfigError("projects must be an array");
  }

  const projects = value.map(validateNexusProjectReference);
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (projectIds.has(project.id)) {
      throw new NexusConfigError(`Project id is duplicated: ${project.id}`);
    }

    projectIds.add(project.id);
  }

  return projects;
}

export function defaultNexusHomePath(
  options: DefaultNexusHomePathOptions = {},
): string {
  const envVarName = options.envVarName ?? "DEV_NEXUS_HOME";
  return (
    process.env[envVarName] ??
    path.join(os.homedir(), options.directoryName ?? ".dev-nexus")
  );
}

export function resolveNexusHome(homePath: string): string {
  if (!homePath.trim()) {
    throw new NexusConfigError("Nexus home path is required");
  }

  return path.resolve(homePath);
}

export function nexusHomeConfigPath(homePath: string): string {
  return path.join(resolveNexusHome(homePath), devNexusHomeConfigFileName);
}

export const devNexusHomeConfigPath = nexusHomeConfigPath;

export function resolveNexusHomePath(
  homePath: string,
  value: string | undefined,
  fallback: string,
): string {
  return path.resolve(homePath, value ?? fallback);
}

export function createDefaultNexusHomeConfigBase(
  homePath: string,
  options: CreateDefaultNexusHomeConfigBaseOptions = {},
): NexusHomeConfigBase {
  const resolvedHomePath = resolveNexusHome(homePath);
  const config: NexusHomeConfigBase = {
    version: 1,
    paths: {
      projectsRoot: resolveNexusHomePath(
        resolvedHomePath,
        options.projectsRoot,
        "projects",
      ),
      workspacesRoot: resolveNexusHomePath(
        resolvedHomePath,
        options.workspacesRoot,
        "workspaces",
      ),
    },
    projects: [],
  };

  if (options.agent) {
    config.agent = validateNexusAgentConfig(options.agent, "agent");
  }

  return validateNexusHomeConfigBase(config, resolvedHomePath);
}

export function validateNexusHomeConfigBase(
  value: unknown,
  _homePathForDefaults?: string,
): NexusHomeConfigBase {
  const record = assertRecord(value, "config");
  if (record.version !== 1) {
    throw new NexusConfigError("config.version must be 1");
  }

  const paths = assertRecord(record.paths, "paths");
  const agent = validateNexusAgentConfig(record.agent, "agent");
  const config: NexusHomeConfigBase = {
    version: 1,
    paths: {
      projectsRoot: requiredString(paths, "projectsRoot", "paths"),
      workspacesRoot: requiredString(paths, "workspacesRoot", "paths"),
    },
    projects: validateNexusProjectReferences(record.projects),
  };

  if (agent) {
    config.agent = agent;
  }

  return config;
}

function missingHomeConfigMessage(
  configPath: string,
  options: LoadNexusHomeConfigFileOptions,
): string {
  if (typeof options.missingMessage === "function") {
    return options.missingMessage(configPath);
  }

  return (
    options.missingMessage ??
    `DevNexus home is not initialized: ${configPath}`
  );
}

export function loadNexusHomeConfigFile<T>(
  homePath: string,
  validate: NexusHomeConfigValidator<T>,
  options: LoadNexusHomeConfigFileOptions = {},
): T {
  const resolvedHomePath = resolveNexusHome(homePath);
  const configPath = nexusHomeConfigPath(resolvedHomePath);
  if (!fs.existsSync(configPath)) {
    throw new NexusConfigError(missingHomeConfigMessage(configPath, options));
  }

  return validate(
    JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")),
    resolvedHomePath,
  );
}

export function saveNexusHomeConfigFile<T>(
  homePath: string,
  config: T,
  validate: NexusHomeConfigValidator<T>,
): string {
  const resolvedHomePath = resolveNexusHome(homePath);
  const configPath = nexusHomeConfigPath(resolvedHomePath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(validate(config, resolvedHomePath), null, 2)}\n`,
    "utf8",
  );
  return configPath;
}
