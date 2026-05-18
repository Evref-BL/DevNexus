import {
  CodexAppServerJsonRpcError,
  type CodexAppServerJsonRpcClient,
} from "./codexAppServerJsonRpc.js";

export const codexAppServerMcpStatusListMethod = "mcpServerStatus/list";
export const codexAppServerMcpToolCallMethod = "mcpServer/tool/call";

export interface CodexAppServerMcpMethodAvailability {
  method: string;
  available: boolean;
}

export interface CodexAppServerMcpCapabilitySet {
  statusList: CodexAppServerMcpMethodAvailability;
  toolCall: CodexAppServerMcpMethodAvailability;
}

export interface CodexAppServerMcpRelayOptions {
  client: CodexAppServerJsonRpcClient;
  advertisedMethods?: readonly string[] | null;
  maxArgumentsJsonBytes?: number;
}

export interface CodexAppServerMcpThreadOptions {
  threadId?: string | null;
}

export interface CodexAppServerMcpServerStatusCheckOptions
  extends CodexAppServerMcpThreadOptions {
  serverName: string;
}

export interface CodexAppServerMcpToolCallOptions
  extends CodexAppServerMcpServerStatusCheckOptions {
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface CodexAppServerMcpToolSummary {
  name: string;
  description?: string;
}

export interface CodexAppServerMcpServerStatus {
  name: string;
  status: string;
  tools: CodexAppServerMcpToolSummary[];
  error?: string;
  raw: unknown;
}

export interface CodexAppServerMcpServerStatusListResult {
  servers: CodexAppServerMcpServerStatus[];
  raw: unknown;
}

export type CodexAppServerMcpContent =
  Record<string, unknown> & { type: string };

export interface CodexAppServerMcpToolCallResult {
  content: CodexAppServerMcpContent[];
  structuredContent?: unknown;
  isError: boolean;
  raw: unknown;
}

export type CodexAppServerMcpRelayAction =
  | "list_status"
  | "check_status"
  | "call_tool";

export type CodexAppServerMcpInfrastructureFailureKind =
  | "capability"
  | "approval"
  | "permission"
  | "missing_server"
  | "missing_tool"
  | "protocol"
  | "remote"
  | "transport";

export interface CodexAppServerMcpRelayErrorOptions {
  kind: CodexAppServerMcpInfrastructureFailureKind;
  action: CodexAppServerMcpRelayAction;
  method: string;
  summary: string;
  serverName?: string;
  toolName?: string;
  cause?: unknown;
}

export class CodexAppServerMcpRelayError extends Error {
  readonly kind: CodexAppServerMcpInfrastructureFailureKind;
  readonly action: CodexAppServerMcpRelayAction;
  readonly method: string;
  readonly summary: string;
  readonly serverName?: string;
  readonly toolName?: string;

  constructor(options: CodexAppServerMcpRelayErrorOptions) {
    super(options.summary);
    this.name = "CodexAppServerMcpRelayError";
    this.kind = options.kind;
    this.action = options.action;
    this.method = options.method;
    this.summary = options.summary;
    this.serverName = options.serverName;
    this.toolName = options.toolName;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface CodexAppServerMcpRelay {
  readonly capabilities: CodexAppServerMcpCapabilitySet | null;
  listServerStatus(
    options?: CodexAppServerMcpThreadOptions,
  ): Promise<CodexAppServerMcpServerStatusListResult>;
  checkServerStatus(
    options: CodexAppServerMcpServerStatusCheckOptions,
  ): Promise<CodexAppServerMcpServerStatus>;
  callTool(
    options: CodexAppServerMcpToolCallOptions,
  ): Promise<CodexAppServerMcpToolCallResult>;
}

interface RelayContext {
  action: CodexAppServerMcpRelayAction;
  method: string;
  serverName?: string;
  toolName?: string;
}

const defaultMaxArgumentsJsonBytes = 32 * 1024;

export function detectCodexAppServerMcpCapabilities(
  methodNames: readonly string[],
): CodexAppServerMcpCapabilitySet {
  const methods = new Set(methodNames);
  return {
    statusList: availability(codexAppServerMcpStatusListMethod, methods),
    toolCall: availability(codexAppServerMcpToolCallMethod, methods),
  };
}

export function createCodexAppServerMcpRelay(
  options: CodexAppServerMcpRelayOptions,
): CodexAppServerMcpRelay {
  return new CodexAppServerMcpRelayImpl(options);
}

class CodexAppServerMcpRelayImpl implements CodexAppServerMcpRelay {
  readonly capabilities: CodexAppServerMcpCapabilitySet | null;
  private readonly client: CodexAppServerJsonRpcClient;
  private readonly advertisedMethods: Set<string> | null;
  private readonly maxArgumentsJsonBytes: number;

  constructor(options: CodexAppServerMcpRelayOptions) {
    this.client = options.client;
    this.advertisedMethods = options.advertisedMethods
      ? new Set(options.advertisedMethods)
      : null;
    this.capabilities = options.advertisedMethods
      ? detectCodexAppServerMcpCapabilities(options.advertisedMethods)
      : null;
    this.maxArgumentsJsonBytes =
      options.maxArgumentsJsonBytes ?? defaultMaxArgumentsJsonBytes;
  }

  async listServerStatus(
    options: CodexAppServerMcpThreadOptions = {},
  ): Promise<CodexAppServerMcpServerStatusListResult> {
    const context: RelayContext = {
      action: "list_status",
      method: codexAppServerMcpStatusListMethod,
    };
    this.assertMethodAvailable(context);

    try {
      const result = await this.client.request(
        codexAppServerMcpStatusListMethod,
        compactRecord({
          threadId: optionalNonEmptyString(options.threadId, "threadId", context),
        }),
      );
      return normalizeStatusListResult(result, context);
    } catch (error) {
      throw relayFailure(error, context);
    }
  }

  async checkServerStatus(
    options: CodexAppServerMcpServerStatusCheckOptions,
  ): Promise<CodexAppServerMcpServerStatus> {
    const serverName = requiredNonEmptyString(options.serverName, "serverName", {
      action: "check_status",
      method: codexAppServerMcpStatusListMethod,
    });
    const statusList = await this.listServerStatus({
      threadId: options.threadId,
    });
    const status = statusList.servers.find((server) => server.name === serverName);
    if (!status) {
      throw relayError({
        kind: "missing_server",
        action: "check_status",
        method: codexAppServerMcpStatusListMethod,
        serverName,
        summary: missingServerSummary(serverName),
      });
    }

    return status;
  }

  async callTool(
    options: CodexAppServerMcpToolCallOptions,
  ): Promise<CodexAppServerMcpToolCallResult> {
    const context: RelayContext = {
      action: "call_tool",
      method: codexAppServerMcpToolCallMethod,
      serverName: requiredNonEmptyString(options.serverName, "serverName", {
        action: "call_tool",
        method: codexAppServerMcpToolCallMethod,
      }),
      toolName: requiredNonEmptyString(options.toolName, "toolName", {
        action: "call_tool",
        method: codexAppServerMcpToolCallMethod,
      }),
    };
    this.assertMethodAvailable(context);
    const toolArguments = structuredArguments(
      options.arguments,
      this.maxArgumentsJsonBytes,
      context,
    );

    try {
      const result = await this.client.request(
        codexAppServerMcpToolCallMethod,
        compactRecord({
          threadId: optionalNonEmptyString(options.threadId, "threadId", context),
          serverName: context.serverName,
          toolName: context.toolName,
          arguments: toolArguments,
        }),
      );
      return normalizeToolCallResult(result, context);
    } catch (error) {
      throw relayFailure(error, context);
    }
  }

  private assertMethodAvailable(context: RelayContext): void {
    if (
      this.advertisedMethods &&
      !this.advertisedMethods.has(context.method)
    ) {
      throw relayError({
        kind: "capability",
        action: context.action,
        method: context.method,
        serverName: context.serverName,
        toolName: context.toolName,
        summary: missingMethodSummary(context.method),
      });
    }
  }
}

function normalizeStatusListResult(
  value: unknown,
  context: RelayContext,
): CodexAppServerMcpServerStatusListResult {
  const servers = statusArray(value);
  if (!servers) {
    throw malformedStatusListError(context);
  }

  return {
    servers: servers.map((server) => normalizeServerStatus(server, context)),
    raw: value,
  };
}

function statusArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["servers", "mcpServers", "statuses", "serverStatuses"]) {
    const child = value[key];
    if (Array.isArray(child)) {
      return child;
    }
  }

  return null;
}

function normalizeServerStatus(
  value: unknown,
  context: RelayContext,
): CodexAppServerMcpServerStatus {
  if (!isRecord(value)) {
    throw malformedStatusListError(context);
  }

  const name = firstNonEmptyString(value, ["name", "serverName", "id"]);
  if (!name) {
    throw malformedStatusListError(context);
  }
  const status = firstNonEmptyString(value, ["status", "state"]) ?? "unknown";
  const toolsValue = Array.isArray(value.tools) ? value.tools : [];
  const tools = toolsValue.map((tool) => normalizeToolSummary(tool, context));
  const error = optionalString(value.error);

  return {
    name,
    status,
    tools,
    ...(error ? { error } : {}),
    raw: value,
  };
}

function normalizeToolSummary(
  value: unknown,
  context: RelayContext,
): CodexAppServerMcpToolSummary {
  if (!isRecord(value)) {
    throw malformedStatusListError(context);
  }

  const name = firstNonEmptyString(value, ["name", "toolName", "id"]);
  if (!name) {
    throw malformedStatusListError(context);
  }
  const description = optionalString(value.description);

  return {
    name,
    ...(description ? { description } : {}),
  };
}

function normalizeToolCallResult(
  value: unknown,
  context: RelayContext,
): CodexAppServerMcpToolCallResult {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw malformedToolResultError(context);
  }

  const content = value.content.map((item) => normalizeContent(item, context));
  const isError = typeof value.isError === "boolean" ? value.isError : false;

  return {
    content,
    ...(hasOwn(value, "structuredContent")
      ? { structuredContent: value.structuredContent }
      : {}),
    isError,
    raw: value,
  };
}

function normalizeContent(
  value: unknown,
  context: RelayContext,
): CodexAppServerMcpContent {
  if (!isRecord(value) || typeof value.type !== "string" || value.type.trim() === "") {
    throw malformedToolResultError(context);
  }

  return {
    ...value,
    type: value.type.trim(),
  } as CodexAppServerMcpContent;
}

function structuredArguments(
  value: Record<string, unknown> | undefined,
  maxArgumentsJsonBytes: number,
  context: RelayContext,
): Record<string, unknown> {
  const result = value ?? {};
  if (!isRecord(result)) {
    throw relayError({
      kind: "protocol",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: "MCP tool arguments must be a JSON object.",
    });
  }

  let json = "";
  try {
    json = JSON.stringify(result);
  } catch (error) {
    throw relayError({
      kind: "protocol",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: `MCP tool arguments must be JSON serializable: ${errorMessage(error)}`,
      cause: error,
    });
  }
  if (Buffer.byteLength(json, "utf8") > maxArgumentsJsonBytes) {
    throw relayError({
      kind: "protocol",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: `MCP tool arguments exceed ${maxArgumentsJsonBytes} bytes; reduce arguments before relaying through Codex app-server.`,
    });
  }

  return result;
}

function relayFailure(error: unknown, context: RelayContext): CodexAppServerMcpRelayError {
  if (error instanceof CodexAppServerMcpRelayError) {
    return error;
  }
  if (error instanceof CodexAppServerJsonRpcError) {
    return jsonRpcRelayFailure(error, context);
  }

  return relayError({
    kind: "transport",
    action: context.action,
    method: context.method,
    serverName: context.serverName,
    toolName: context.toolName,
    summary: `Codex app-server MCP relay transport failed for ${context.method}: ${errorMessage(error)}`,
    cause: error,
  });
}

function jsonRpcRelayFailure(
  error: CodexAppServerJsonRpcError,
  context: RelayContext,
): CodexAppServerMcpRelayError {
  if (error.kind === "protocol") {
    return relayError({
      kind: "protocol",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: `Codex app-server JSON-RPC protocol failure during MCP relay: ${error.message}`,
      cause: error,
    });
  }
  if (error.kind === "transport") {
    return relayError({
      kind: "transport",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: `Codex app-server MCP relay transport failed for ${context.method}: ${error.message}`,
      cause: error,
    });
  }

  const text = `${error.message} ${formatUnknown(error.data)}`.toLowerCase();
  if (error.code === -32601 || /method not found|unknown method/.test(text)) {
    return relayError({
      kind: "capability",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: missingMethodSummary(context.method),
      cause: error,
    });
  }
  if (/approval|approve|consent/.test(text)) {
    return relayError({
      kind: "approval",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: approvalSummary(context),
      cause: error,
    });
  }
  if (/permission|sandbox|forbidden|unauthorized|denied|trust/.test(text)) {
    return relayError({
      kind: "permission",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: permissionSummary(context),
      cause: error,
    });
  }
  if (/mcp tool.*(not found|missing|unknown)|(?:not found|missing|unknown).*mcp tool/.test(text)) {
    return relayError({
      kind: "missing_tool",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: missingToolSummary(context.toolName, context.serverName),
      cause: error,
    });
  }
  if (/mcp server.*(not found|missing|unknown)|(?:not found|missing|unknown).*mcp server/.test(text)) {
    return relayError({
      kind: "missing_server",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: missingServerSummary(context.serverName),
      cause: error,
    });
  }

  return relayError({
    kind: "remote",
    action: context.action,
    method: context.method,
    serverName: context.serverName,
    toolName: context.toolName,
    summary: `Codex app-server MCP relay failed for ${relayTarget(context)}: ${error.message}`,
    cause: error,
  });
}

function relayError(
  options: CodexAppServerMcpRelayErrorOptions,
): CodexAppServerMcpRelayError {
  return new CodexAppServerMcpRelayError(options);
}

function malformedStatusListError(context: RelayContext): CodexAppServerMcpRelayError {
  return relayError({
    kind: "protocol",
    action: context.action,
    method: context.method,
    serverName: context.serverName,
    toolName: context.toolName,
    summary:
      "Codex app-server returned malformed MCP server status for mcpServerStatus/list; update Codex app-server or the DevNexus relay schema.",
  });
}

function malformedToolResultError(context: RelayContext): CodexAppServerMcpRelayError {
  return relayError({
    kind: "protocol",
    action: context.action,
    method: context.method,
    serverName: context.serverName,
    toolName: context.toolName,
    summary:
      "Codex app-server returned malformed MCP tool result for mcpServer/tool/call; update Codex app-server or the DevNexus relay schema.",
  });
}

function missingMethodSummary(method: string): string {
  return `Codex app-server does not advertise ${method}; update Codex app-server or disable this optional MCP relay.`;
}

function approvalSummary(context: RelayContext): string {
  return `Codex app-server requires approval before relaying MCP tool ${relayTarget(context)}; approve the tool in Codex or adjust the selected profile MCP approval policy.`;
}

function permissionSummary(context: RelayContext): string {
  return `Codex app-server denied MCP tool ${relayTarget(context)} by permission or sandbox policy; use a profile with the required permission or choose a safer tool.`;
}

function missingServerSummary(serverName: string | undefined): string {
  const name = serverName ?? "the requested server";
  return `MCP server ${name} is not available in this Codex app-server thread; refresh MCP configuration or choose a configured server.`;
}

function missingToolSummary(
  toolName: string | undefined,
  serverName: string | undefined,
): string {
  const tool = toolName ?? "the requested tool";
  const server = serverName ?? "the requested server";
  return `MCP tool ${tool} is not available on server ${server}; list server status and choose an advertised tool.`;
}

function relayTarget(context: RelayContext): string {
  if (context.serverName && context.toolName) {
    return `${context.serverName}/${context.toolName}`;
  }
  return context.serverName ?? context.method;
}

function requiredNonEmptyString(
  value: unknown,
  name: string,
  context: RelayContext,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw relayError({
      kind: "protocol",
      action: context.action,
      method: context.method,
      serverName: context.serverName,
      toolName: context.toolName,
      summary: `${name} must be a non-empty string for Codex app-server MCP relay.`,
    });
  }

  return value.trim();
}

function optionalNonEmptyString(
  value: string | null | undefined,
  name: string,
  context: RelayContext,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return requiredNonEmptyString(value, name, context);
}

function availability(
  method: string,
  methods: ReadonlySet<string>,
): CodexAppServerMcpMethodAvailability {
  return {
    method,
    available: methods.has(method),
  };
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function firstNonEmptyString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = optionalString(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function formatUnknown(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
