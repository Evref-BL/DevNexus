import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  NexusConfigError,
  validateNexusAgentConfig,
  type NexusAgentConfig,
} from "./nexusProjectConfig.js";
import type {
  NexusHostingAuthProfileCredentialKind,
  NexusHostingAuthProfileCredentialPurpose,
  NexusHostingAuthProfileConfig,
  NexusHostingAuthProfileKind,
  NexusHostingGitHubAppCredentialConfig,
} from "./nexusProjectHosting.js";
import type {
  NexusHomeHostOverlayConfig,
  NexusHomeHostTransportConfig,
  NexusHomeHostTransportKind,
  NexusHomeHostWorkspaceRootsConfig,
} from "./nexusHostRegistry.js";
import type { NexusProjectReference } from "./nexusProjectReference.js";

export const devNexusHomeConfigFileName = "dev-nexus.home.json";
export const nexusLogsDirectoryName = "logs";
export const nexusGeneratedDirectoryName = "generated";

export interface NexusHomePathsConfig {
  projectsRoot: string;
  workspacesRoot: string;
}

export type NexusClaimAuthorityProfileBackend = "postgres";
export type NexusPostgresClaimAuthorityProfileDriver = "node_postgres";

export interface NexusClaimAuthorityProfileConfig {
  id: string;
  backend: NexusClaimAuthorityProfileBackend;
  driver: NexusPostgresClaimAuthorityProfileDriver;
  connectionStringEnv: string;
  schema: string | null;
}

export interface NexusHomeConfigBase {
  version: 1;
  paths: NexusHomePathsConfig;
  agent?: NexusAgentConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
  claimAuthorityProfiles?: NexusClaimAuthorityProfileConfig[];
  hostOverlays?: NexusHomeHostOverlayConfig[];
  projects: NexusProjectReference[];
}

export interface CreateDefaultNexusHomeConfigBaseOptions {
  projectsRoot?: string;
  workspacesRoot?: string;
  agent?: NexusAgentConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
  claimAuthorityProfiles?: NexusClaimAuthorityProfileConfig[];
  hostOverlays?: NexusHomeHostOverlayConfig[];
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

function optionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a positive integer`,
    );
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusConfigError(`${pathName}.${key} must be an object`);
  }

  const stringRecord: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (!entryKey.trim()) {
      throw new NexusConfigError(
        `${pathName}.${key} keys must be non-empty strings`,
      );
    }
    if (typeof entryValue !== "string" || entryValue.trim().length === 0) {
      throw new NexusConfigError(
        `${pathName}.${key}.${entryKey} must be a non-empty string`,
      );
    }
    stringRecord[entryKey] = entryValue;
  }

  return stringRecord;
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

  const values = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusConfigError(
        `${pathName}.${key}[${index}] must be a non-empty string`,
      );
    }
    return entry;
  });
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== values.length) {
    throw new NexusConfigError(`${pathName}.${key} contains duplicate values`);
  }

  return values;
}

function optionalStringList(
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

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusConfigError(
        `${pathName}.${key}[${index}] must be a non-empty string`,
      );
    }
    return entry;
  });
}

function validateHomeHostTransportKind(
  value: unknown,
  pathName: string,
): NexusHomeHostTransportKind {
  if (value === "local" || value === "ssh" || value === "manual") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be local, ssh, or manual`);
}

function validateHostingProviderName(
  value: unknown,
  pathName: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be a non-empty string`);
}

function validateHostingAuthProfileKind(
  value: unknown,
  pathName: string,
): NexusHostingAuthProfileKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "human" || value === "automation" || value === "app") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be human, automation, or app`);
}

function validateHostingAuthProfileCredentialKind(
  value: unknown,
  pathName: string,
): NexusHostingAuthProfileCredentialKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "environment_token" ||
    value === "provider_cli" ||
    value === "git_credential" ||
    value === "command_token" ||
    value === "github_app" ||
    value === "github_app_user_token" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be environment_token, provider_cli, git_credential, command_token, github_app, github_app_user_token, or unknown`,
  );
}

function validateHostingAuthProfileCredentialPurpose(
  value: unknown,
  pathName: string,
): NexusHostingAuthProfileCredentialPurpose {
  if (value === "api" || value === "git" || value === "cli") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be api, git, or cli`);
}

function optionalCredentialPurposes(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusHostingAuthProfileCredentialPurpose[] | undefined {
  const values = optionalStringArray(record, key, pathName);
  if (values === undefined) {
    return undefined;
  }

  return values.map((value, index) =>
    validateHostingAuthProfileCredentialPurpose(
      value,
      `${pathName}.${key}[${index}]`,
    ),
  );
}

function validateHostingGitHubAppCredentialConfig(
  value: unknown,
  profilePathName: string,
  credentialKind?: NexusHostingAuthProfileCredentialKind,
): NexusHostingGitHubAppCredentialConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = `${profilePathName}.githubApp`;
  const record = assertRecord(value, pathName);
  const appId = optionalString(record, "appId", pathName);
  const clientId = optionalString(record, "clientId", pathName);
  const slug = optionalString(record, "slug", pathName);
  const installationAccount = optionalString(
    record,
    "installationAccount",
    pathName,
  );
  const repositories = optionalStringArray(record, "repositories", pathName);
  const apiBaseUrl = optionalString(record, "apiBaseUrl", pathName);
  const privateKeyPath = optionalString(record, "privateKeyPath", pathName);
  const tokenRefreshBufferSeconds = optionalPositiveInteger(
    record,
    "tokenRefreshBufferSeconds",
    pathName,
  );

  if (appId === undefined && clientId === undefined) {
    throw new NexusConfigError(
      `${pathName}.appId or ${pathName}.clientId must be set`,
    );
  }
  if (
    credentialKind !== "github_app_user_token" &&
    privateKeyPath === undefined
  ) {
    throw new NexusConfigError(`${pathName}.privateKeyPath must be set`);
  }

  return {
    ...(appId !== undefined ? { appId } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(slug !== undefined ? { slug } : {}),
    ...(privateKeyPath !== undefined ? { privateKeyPath } : {}),
    ...(installationAccount !== undefined ? { installationAccount } : {}),
    ...(repositories !== undefined ? { repositories } : {}),
    ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
    ...(tokenRefreshBufferSeconds !== undefined
      ? { tokenRefreshBufferSeconds }
      : {}),
  };
}

function validateHostingAuthProfile(
  value: unknown,
  index: number,
): NexusHostingAuthProfileConfig {
  const pathName = `authProfiles[${index}]`;
  const record = assertRecord(value, pathName);
  const actorId = optionalString(record, "actorId", pathName);
  const kind = validateHostingAuthProfileKind(record.kind, `${pathName}.kind`);
  const credentialKind = validateHostingAuthProfileCredentialKind(
    record.credentialKind,
    `${pathName}.credentialKind`,
  );
  const account = optionalString(record, "account", pathName);
  const host = optionalString(record, "host", pathName);
  const sshHost = optionalString(record, "sshHost", pathName);
  const githubCliConfigDir = optionalString(
    record,
    "githubCliConfigDir",
    pathName,
  );
  const gitUserName = optionalString(record, "gitUserName", pathName);
  const gitUserEmail = optionalString(record, "gitUserEmail", pathName);
  const command = optionalString(record, "command", pathName);
  const commandArgs = optionalStringList(record, "commandArgs", pathName);
  const environmentKeys = optionalStringArray(
    record,
    "environmentKeys",
    pathName,
  );
  const purposes = optionalCredentialPurposes(record, "purposes", pathName);
  const repositoryScopes = optionalStringArray(
    record,
    "repositoryScopes",
    pathName,
  );
  const githubApp = validateHostingGitHubAppCredentialConfig(
    record.githubApp,
    pathName,
    credentialKind,
  );

  return {
    id: requiredString(record, "id", pathName),
    ...(actorId !== undefined ? { actorId } : {}),
    provider: validateHostingProviderName(record.provider, `${pathName}.provider`),
    ...(kind !== undefined ? { kind } : {}),
    ...(credentialKind !== undefined ? { credentialKind } : {}),
    ...(account !== undefined ? { account } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(sshHost !== undefined ? { sshHost } : {}),
    ...(githubCliConfigDir !== undefined ? { githubCliConfigDir } : {}),
    ...(gitUserName !== undefined ? { gitUserName } : {}),
    ...(gitUserEmail !== undefined ? { gitUserEmail } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(commandArgs !== undefined ? { commandArgs } : {}),
    ...(environmentKeys !== undefined ? { environmentKeys } : {}),
    ...(purposes !== undefined ? { purposes } : {}),
    ...(repositoryScopes !== undefined ? { repositoryScopes } : {}),
    ...(githubApp !== undefined ? { githubApp } : {}),
  };
}

function validateHostingAuthProfiles(
  value: unknown,
): NexusHostingAuthProfileConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("authProfiles must be an array");
  }

  const authProfiles = value.map((item, index) =>
    validateHostingAuthProfile(item, index),
  );
  const ids = new Set<string>();
  for (const profile of authProfiles) {
    if (ids.has(profile.id)) {
      throw new NexusConfigError(`Auth profile id is duplicated: ${profile.id}`);
    }
    ids.add(profile.id);
  }

  return authProfiles;
}

function validateClaimAuthorityProfileBackend(
  value: unknown,
  pathName: string,
): NexusClaimAuthorityProfileBackend {
  if (value === "postgres") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be postgres`);
}

function validatePostgresClaimAuthorityProfileDriver(
  value: unknown,
  pathName: string,
): NexusPostgresClaimAuthorityProfileDriver {
  if (value === "node_postgres") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be node_postgres`);
}

function validateClaimAuthorityProfile(
  value: unknown,
  index: number,
): NexusClaimAuthorityProfileConfig {
  const pathName = `claimAuthorityProfiles[${index}]`;
  const record = assertRecord(value, pathName);
  if (record.connectionString !== undefined) {
    throw new NexusConfigError(
      `${pathName}.connectionString must not be stored in DevNexus home config; use ${pathName}.connectionStringEnv`,
    );
  }
  return {
    id: requiredString(record, "id", pathName),
    backend: validateClaimAuthorityProfileBackend(
      record.backend,
      `${pathName}.backend`,
    ),
    driver: validatePostgresClaimAuthorityProfileDriver(
      record.driver,
      `${pathName}.driver`,
    ),
    connectionStringEnv: requiredString(record, "connectionStringEnv", pathName),
    schema: optionalString(record, "schema", pathName) ?? null,
  };
}

function validateClaimAuthorityProfiles(
  value: unknown,
): NexusClaimAuthorityProfileConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("claimAuthorityProfiles must be an array");
  }

  const profiles = value.map((item, index) =>
    validateClaimAuthorityProfile(item, index),
  );
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new NexusConfigError(
        `Claim authority profile id is duplicated: ${profile.id}`,
      );
    }
    ids.add(profile.id);
  }

  return profiles;
}

function validateHomeHostTransport(
  value: unknown,
  overlayPathName: string,
): NexusHomeHostTransportConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = `${overlayPathName}.transport`;
  const record = assertRecord(value, pathName);
  const host = optionalString(record, "host", pathName);
  const sshHost = optionalString(record, "sshHost", pathName);
  const sshUser = optionalString(record, "sshUser", pathName);
  const port = optionalPositiveInteger(record, "port", pathName);
  const tailscaleAddress = optionalString(record, "tailscaleAddress", pathName);
  const shell = optionalString(record, "shell", pathName);
  const authProfile = optionalString(record, "authProfile", pathName);
  const commandPaths = optionalStringRecord(record, "commandPaths", pathName);

  return {
    kind: validateHomeHostTransportKind(record.kind, `${pathName}.kind`),
    ...(host !== undefined ? { host } : {}),
    ...(sshHost !== undefined ? { sshHost } : {}),
    ...(sshUser !== undefined ? { sshUser } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(tailscaleAddress !== undefined ? { tailscaleAddress } : {}),
    ...(shell !== undefined ? { shell } : {}),
    ...(authProfile !== undefined ? { authProfile } : {}),
    ...(commandPaths !== undefined ? { commandPaths } : {}),
  };
}

function validateHomeHostWorkspaceRoots(
  value: unknown,
  overlayPathName: string,
): NexusHomeHostWorkspaceRootsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = `${overlayPathName}.workspaceRoots`;
  const record = assertRecord(value, pathName);
  const projectRoot = optionalString(record, "projectRoot", pathName);
  const componentsRoot = optionalString(record, "componentsRoot", pathName);
  const worktreesRoot = optionalString(record, "worktreesRoot", pathName);
  const componentRoots = optionalStringRecord(record, "componentRoots", pathName);

  return {
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    ...(componentsRoot !== undefined ? { componentsRoot } : {}),
    ...(worktreesRoot !== undefined ? { worktreesRoot } : {}),
    ...(componentRoots !== undefined ? { componentRoots } : {}),
  };
}

function validateHomeHostOverlay(
  value: unknown,
  index: number,
): NexusHomeHostOverlayConfig {
  const pathName = `hostOverlays[${index}]`;
  const record = assertRecord(value, pathName);
  const transport = validateHomeHostTransport(record.transport, pathName);
  const workspaceRoots = validateHomeHostWorkspaceRoots(
    record.workspaceRoots,
    pathName,
  );
  const notes = optionalString(record, "notes", pathName);

  return {
    hostId: requiredString(record, "hostId", pathName),
    ...(transport !== undefined ? { transport } : {}),
    ...(workspaceRoots !== undefined ? { workspaceRoots } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function validateHomeHostOverlays(
  value: unknown,
): NexusHomeHostOverlayConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("hostOverlays must be an array");
  }

  const hostOverlays = value.map((item, index) =>
    validateHomeHostOverlay(item, index),
  );
  const hostIds = new Set<string>();
  for (const overlay of hostOverlays) {
    if (hostIds.has(overlay.hostId)) {
      throw new NexusConfigError(
        `Host overlay id is duplicated: ${overlay.hostId}`,
      );
    }
    hostIds.add(overlay.hostId);
  }

  return hostOverlays;
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

  const projects = value.map((item, index) =>
    validateNexusProjectReference(item, index),
  );
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (projectIds.has(project.id)) {
      throw new NexusConfigError(`Workspace id is duplicated: ${project.id}`);
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
  if (options.authProfiles) {
    config.authProfiles = validateHostingAuthProfiles(options.authProfiles);
  }
  if (options.claimAuthorityProfiles) {
    config.claimAuthorityProfiles = validateClaimAuthorityProfiles(
      options.claimAuthorityProfiles,
    );
  }
  if (options.hostOverlays) {
    config.hostOverlays = validateHomeHostOverlays(options.hostOverlays);
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
  const authProfiles = validateHostingAuthProfiles(record.authProfiles);
  const claimAuthorityProfiles = validateClaimAuthorityProfiles(
    record.claimAuthorityProfiles,
  );
  const hostOverlays = validateHomeHostOverlays(record.hostOverlays);
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
  if (authProfiles) {
    config.authProfiles = authProfiles;
  }
  if (claimAuthorityProfiles) {
    config.claimAuthorityProfiles = claimAuthorityProfiles;
  }
  if (hostOverlays) {
    config.hostOverlays = hostOverlays;
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
