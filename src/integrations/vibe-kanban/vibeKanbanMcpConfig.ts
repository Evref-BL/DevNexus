import { vibeKanbanApiBaseUrl, type VibeKanbanApiOptions } from "./vibeKanbanApi.js";

export const vibeKanbanExecutors = [
  "CLAUDE_CODE",
  "AMP",
  "GEMINI",
  "CODEX",
  "OPENCODE",
  "CURSOR_AGENT",
  "QWEN_CODE",
  "COPILOT",
  "DROID",
] as const;

export type VibeKanbanExecutor = (typeof vibeKanbanExecutors)[number];

export interface VibeKanbanMcpServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface VibeKanbanMcpConfig {
  servers: Record<string, VibeKanbanMcpServerConfig>;
  serversPath?: string[];
  configPath?: string;
}

export interface VibeKanbanMcpConfigResponse {
  mcpConfig: VibeKanbanMcpConfig;
  raw: unknown;
}

export class VibeKanbanMcpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanMcpConfigError";
  }
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VibeKanbanMcpConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalStringArray(
  value: unknown,
  pathName: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new VibeKanbanMcpConfigError(`${pathName} must be an array of strings`);
  }

  return value;
}

function optionalNonEmptyString(
  value: unknown,
  pathName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VibeKanbanMcpConfigError(`${pathName} must be a non-empty string`);
  }

  return value;
}

function optionalStringRecord(
  value: unknown,
  pathName: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return stringRecord(value, pathName);
}

function stringRecord(value: unknown, pathName: string): Record<string, string> {
  const record = assertRecord(value, pathName);
  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throw new VibeKanbanMcpConfigError(`${pathName}.${key} must be a string`);
    }

    normalized[key] = entry;
  }

  return normalized;
}

export function normalizeVibeKanbanExecutor(
  executor: string,
): VibeKanbanExecutor {
  const normalized = executor.trim().replaceAll("-", "_").toUpperCase();
  if (normalized === "CURSOR") {
    return "CURSOR_AGENT";
  }

  if (vibeKanbanExecutors.includes(normalized as VibeKanbanExecutor)) {
    return normalized as VibeKanbanExecutor;
  }

  throw new VibeKanbanMcpConfigError(
    `Unsupported Vibe Kanban executor: ${executor}`,
  );
}

export function validateMcpServerConfig(
  value: unknown,
  pathName: string,
): VibeKanbanMcpServerConfig {
  const record = assertRecord(value, pathName);
  const command = optionalNonEmptyString(record.command, `${pathName}.command`);
  const url = optionalNonEmptyString(record.url, `${pathName}.url`);
  if (!command && !url) {
    throw new VibeKanbanMcpConfigError(
      `${pathName}.command or ${pathName}.url must be a non-empty string`,
    );
  }

  const args =
    optionalStringArray(record.args, `${pathName}.args`) ??
    (command ? [] : undefined);
  const env = optionalStringRecord(record.env, `${pathName}.env`);
  const headers = optionalStringRecord(record.headers, `${pathName}.headers`);

  return {
    ...record,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(url ? { url } : {}),
    ...(headers ? { headers } : {}),
  };
}

export function validateMcpServers(
  value: unknown,
): Record<string, VibeKanbanMcpServerConfig> {
  const record = assertRecord(value, "servers");
  const servers: Record<string, VibeKanbanMcpServerConfig> = {};

  for (const [name, serverConfig] of Object.entries(record)) {
    if (!name.trim()) {
      throw new VibeKanbanMcpConfigError("MCP server names must be non-empty");
    }

    servers[name] = validateMcpServerConfig(
      serverConfig,
      `servers.${name}`,
    );
  }

  return servers;
}

export function normalizeExistingMcpServers(
  value: unknown,
): Record<string, VibeKanbanMcpServerConfig> {
  const record = assertRecord(value, "servers");
  const servers: Record<string, VibeKanbanMcpServerConfig> = {};

  for (const [name, serverConfig] of Object.entries(record)) {
    if (!name.trim()) {
      throw new VibeKanbanMcpConfigError("MCP server names must be non-empty");
    }

    const serverRecord = assertRecord(serverConfig, `servers.${name}`);
    const command = serverRecord.command;
    const args = serverRecord.args;
    const hasValidCommand =
      typeof command === "string" && command.trim().length > 0;
    const hasMissingArgs = args === undefined;

    servers[name] =
      hasValidCommand && hasMissingArgs
        ? {
            ...serverRecord,
            args: [],
          }
        : serverRecord;
  }

  return servers;
}

function parseMcpConfigResponse(value: unknown): VibeKanbanMcpConfigResponse {
  const response = assertRecord(value, "response");
  if (response.success !== true) {
    throw new VibeKanbanMcpConfigError("Vibe Kanban MCP config request failed");
  }

  const data = assertRecord(response.data, "response.data");
  const mcpConfig = assertRecord(data.mcp_config, "response.data.mcp_config");
  const configPath =
    typeof data.config_path === "string" ? data.config_path : undefined;

  return {
    raw: value,
    mcpConfig: {
      servers: normalizeExistingMcpServers(mcpConfig.servers ?? {}),
      serversPath: optionalStringArray(
        mcpConfig.servers_path,
        "response.data.mcp_config.servers_path",
      ),
      ...(configPath ? { configPath } : {}),
    },
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, init);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new VibeKanbanMcpConfigError(
      `Vibe Kanban request failed with HTTP ${response.status}`,
    );
  }

  return body;
}

export async function getVibeKanbanMcpConfig(
  options: VibeKanbanApiOptions & { executor: string },
): Promise<VibeKanbanMcpConfigResponse> {
  const executor = normalizeVibeKanbanExecutor(options.executor);
  const url = new URL("/api/mcp-config", vibeKanbanApiBaseUrl(options));
  url.searchParams.set("executor", executor);

  return parseMcpConfigResponse(
    await requestJson(options.fetch ?? fetch, url.toString()),
  );
}

export async function updateVibeKanbanMcpConfig(
  options: VibeKanbanApiOptions & {
    executor: string;
    servers: Record<string, VibeKanbanMcpServerConfig>;
  },
): Promise<unknown> {
  const executor = normalizeVibeKanbanExecutor(options.executor);
  const url = new URL("/api/mcp-config", vibeKanbanApiBaseUrl(options));
  url.searchParams.set("executor", executor);

  return requestJson(options.fetch ?? fetch, url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      servers: normalizeExistingMcpServers(options.servers),
    }),
  });
}

export function mergeMcpServerConfig(
  servers: Record<string, VibeKanbanMcpServerConfig>,
  serverName: string,
  server: VibeKanbanMcpServerConfig,
): Record<string, VibeKanbanMcpServerConfig> {
  if (serverName.trim().length === 0) {
    throw new VibeKanbanMcpConfigError("serverName must be non-empty");
  }

  return normalizeExistingMcpServers({
    ...servers,
    [serverName]: validateMcpServerConfig(server, `servers.${serverName}`),
  });
}
