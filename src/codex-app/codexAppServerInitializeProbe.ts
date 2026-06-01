import {
  CodexAppServerCapabilityError,
  defaultCodexAppServerInitializeParams,
  detectCodexAppServerCapabilities,
  missingCodexAppServerCapabilities,
  resolveCodexAppServerMethodNames,
  type CodexAppServerMethodSource,
} from "./codexAppServerCapabilityAdapter.js";
import {
  CodexAppServerJsonRpcClient,
  CodexAppServerJsonRpcError,
  createCodexAppServerStdioJsonRpcTransport,
  type CodexAppServerJsonRpcRequest,
  type CodexAppServerJsonRpcResponse,
  type CodexAppServerJsonRpcTransport,
} from "./codexAppServerJsonRpc.js";
import {
  codexAppServerEndpointScope,
  type NexusAutomationCodexAppServerConfig,
} from "../automation/nexusAutomationConfig.js";
import {
  normalizeNexusAutomationAgentPolicy,
  type NexusAutomationAgentProfilePolicy,
} from "../automation/nexusAutomationAgentProfile.js";
import {
  evaluateNexusCodexGoalsAutomationProfilePolicy,
  type NexusCodexGoalsPolicyDecision,
} from "../automation/nexusCodexGoalsPolicy.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";

export type CodexAppServerInitializeProbeStatus =
  | "ready"
  | "blocked"
  | "failed";

export type CodexAppServerInitializeProbeBlockerKind =
  | "auth_failure"
  | "goal_runtime_failure"
  | "missing_required_method"
  | "non_loopback_endpoint_blocked"
  | "profile_not_app_server"
  | "unsupported_transport"
  | "unsupported_wire_protocol"
  | "transport_failure"
  | "remote_failure"
  | "unknown_failure";

export type CodexAppServerGoalRuntimeStatus =
  | "enabled"
  | "disabled"
  | "unsupported"
  | "not_checked"
  | "failed";

export type CodexAppServerGoalRuntimeCheckKind =
  | "feature_gate"
  | "storage_smoke"
  | "not_checked";

export interface CodexAppServerGoalRuntimeCheck {
  status: CodexAppServerGoalRuntimeStatus;
  check: CodexAppServerGoalRuntimeCheckKind;
  method: string | null;
  summary: string | null;
  threadId?: string | null;
}

export interface CodexAppServerCapabilityStatus {
  capability: string;
  required: boolean;
  status: "supported" | "missing" | "optional";
  method: string | null;
  alternatives: string[];
}

export interface CodexAppServerInitializeProbeReport {
  status: CodexAppServerInitializeProbeStatus;
  profileId: string;
  transportMode: NexusAutomationCodexAppServerConfig["mode"];
  endpointScope: "loopback" | "non_loopback";
  clientIdentity: {
    name: "dev-nexus";
    version: string | null;
  };
  codexVersion: string | null;
  advertisedMethods: string[];
  effectiveMethods: string[];
  methodSource: CodexAppServerMethodSource | null;
  capabilities: CodexAppServerCapabilityStatus[];
  requiredCapabilities: CodexAppServerCapabilityStatus[];
  optionalCapabilities: CodexAppServerCapabilityStatus[];
  goalPolicy: NexusCodexGoalsPolicyDecision | null;
  goalRuntime: CodexAppServerGoalRuntimeCheck;
  blockerKind: CodexAppServerInitializeProbeBlockerKind | null;
  blockerSummary: string | null;
  initializeResult: unknown;
}

export interface ProbeCodexAppServerInitializeOptions {
  projectRoot: string;
  profileId?: string;
  goalStorageSmoke?: boolean;
  client?: CodexAppServerJsonRpcClient;
  clientFactory?: (
    input: ProbeCodexAppServerInitializeClientFactoryInput,
  ) => CodexAppServerJsonRpcClient | Promise<CodexAppServerJsonRpcClient>;
  transportFactory?: (
    input: ProbeCodexAppServerInitializeClientFactoryInput,
  ) => CodexAppServerJsonRpcTransport | Promise<CodexAppServerJsonRpcTransport>;
}

export interface ProbeCodexAppServerInitializeClientFactoryInput {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  profile: NexusAutomationAgentProfilePolicy;
  appServer: NexusAutomationCodexAppServerConfig;
}

export async function probeCodexAppServerInitialize(
  options: ProbeCodexAppServerInitializeOptions,
): Promise<CodexAppServerInitializeProbeReport> {
  const projectConfig = loadProjectConfig(options.projectRoot);
  const automationConfig = projectConfig.automation;
  if (!automationConfig) {
    throw new Error("Workspace automation is not configured");
  }
  const policy = normalizeNexusAutomationAgentPolicy(automationConfig);
  const profileId = options.profileId ?? policy.coordinatorProfileId;
  if (!profileId) {
    throw new Error(
      "Codex app-server initialize probe requires --profile or automation.agent.coordinatorProfileId",
    );
  }
  const profile = policy.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`Codex app-server profile was not found: ${profileId}`);
  }
  if (profile.executor.toLowerCase() !== "codex" || !profile.appServer) {
    return emptyBlockedProbeReport({
      profileId: profile.id,
      transportMode: "connect",
      endpointScope: "loopback",
      blockerKind: "profile_not_app_server",
      blockerSummary:
        `Profile ${profile.id} must use executor codex and configure appServer policy`,
    });
  }

  return probeCodexAppServerInitializeForProfile({
    ...options,
    projectConfig,
    profile,
    appServer: profile.appServer,
  });
}

export async function probeCodexAppServerInitializeForProfile(
  options: ProbeCodexAppServerInitializeOptions & {
    projectConfig: NexusProjectConfig;
    profile: NexusAutomationAgentProfilePolicy;
    appServer: NexusAutomationCodexAppServerConfig;
  },
): Promise<CodexAppServerInitializeProbeReport> {
  const endpointScope = codexAppServerEndpointScope(options.appServer.endpoint);
  const goalPolicy = evaluateNexusCodexGoalsAutomationProfilePolicy({
    projectConfig: options.projectConfig,
    automationConfig: options.projectConfig.automation!,
    profile: options.profile,
    mode: "goal_projection",
    tokenBudget: null,
  });
  if (
    endpointScope === "non_loopback" &&
    !options.appServer.localPolicy.allowNonLoopbackEndpoint
  ) {
    return emptyBlockedProbeReport({
      profileId: options.profile.id,
      transportMode: options.appServer.mode,
      endpointScope,
      blockerKind: "non_loopback_endpoint_blocked",
      blockerSummary:
        "Codex app-server endpoint is non-loopback; host-local policy must explicitly allow it before probing",
      goalPolicy,
    });
  }

  let closeClient = false;
  let client: CodexAppServerJsonRpcClient;
  try {
    if (options.client) {
      client = options.client;
    } else if (options.clientFactory) {
      client = await options.clientFactory(options);
    } else if (options.transportFactory) {
      client = new CodexAppServerJsonRpcClient({
        transport: await options.transportFactory(options),
      });
      closeClient = true;
    } else {
      client = defaultCodexAppServerProbeClient(options);
      closeClient = true;
    }
  } catch (error) {
    return emptyBlockedProbeReport({
      profileId: options.profile.id,
      transportMode: options.appServer.mode,
      endpointScope,
      blockerKind: "unsupported_transport",
      blockerSummary: errorMessage(error),
    });
  }

  try {
    const initializeResult = await client.request(
      "initialize",
      defaultCodexAppServerInitializeParams({
        title: "DevNexus Codex app-server initialize probe",
        version: options.projectConfig.version,
      }),
    );
    await client.notify("initialized", {});
    const methodNames = resolveCodexAppServerMethodNames(initializeResult);
    const detectedCapabilities = detectCodexAppServerCapabilities(
      methodNames.effectiveMethods,
    );
    const capabilities = capabilityStatuses(methodNames.effectiveMethods);
    const missingRequired =
      missingCodexAppServerCapabilities(detectedCapabilities);
    const blockerSummary = missingRequired.length > 0
      ? `Codex app-server is missing required JSON-RPC capabilities: ${missingRequired.join(", ")}`
      : null;
    const goalRuntime = await probeCodexAppServerGoalRuntime({
      client,
      capabilities: detectedCapabilities,
      goalPolicy,
      goalStorageSmoke: options.goalStorageSmoke ?? false,
      profile: options.profile,
      projectRoot: options.projectRoot,
    });
    const goalRuntimeBlocker = goalRuntimeBlockerSummary({
      goalRuntime,
      goalStorageSmoke: options.goalStorageSmoke ?? false,
    });

    return {
      status: missingRequired.length > 0 || goalRuntimeBlocker
        ? "blocked"
        : "ready",
      profileId: options.profile.id,
      transportMode: options.appServer.mode,
      endpointScope,
      clientIdentity: {
        name: "dev-nexus",
        version: String(options.projectConfig.version),
      },
      codexVersion: extractCodexVersion(initializeResult),
      advertisedMethods: methodNames.advertisedMethods,
      effectiveMethods: methodNames.effectiveMethods,
      methodSource: methodNames.methodSource,
      capabilities,
      requiredCapabilities: capabilities.filter((item) => item.required),
      optionalCapabilities: capabilities.filter((item) => !item.required),
      goalPolicy,
      goalRuntime,
      blockerKind: missingRequired.length > 0
        ? "missing_required_method"
        : goalRuntimeBlocker ? "goal_runtime_failure" : null,
      blockerSummary: blockerSummary ?? goalRuntimeBlocker,
      initializeResult,
    };
  } catch (error) {
    return failureProbeReport({
      error,
      profileId: options.profile.id,
      transportMode: options.appServer.mode,
      endpointScope,
      goalPolicy,
    });
  } finally {
    if (closeClient) {
      await client.close();
    }
  }
}

function defaultCodexAppServerProbeClient(options: {
  projectRoot: string;
  appServer: NexusAutomationCodexAppServerConfig;
}): CodexAppServerJsonRpcClient {
  if (options.appServer.mode === "spawn") {
    if (!options.appServer.command) {
      throw new Error("Codex app-server spawn mode requires a command");
    }
    return new CodexAppServerJsonRpcClient({
      transport: createCodexAppServerStdioJsonRpcTransport({
        command: options.appServer.command,
        args: options.appServer.args,
        cwd: options.projectRoot,
      }),
    });
  }

  return new CodexAppServerJsonRpcClient({
    transport: createCodexAppServerHttpJsonRpcTransport({
      endpoint: options.appServer.endpoint,
    }),
  });
}

export function createCodexAppServerHttpJsonRpcTransport(options: {
  endpoint: string;
  fetch?: typeof fetch;
}): CodexAppServerJsonRpcTransport {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error(
      "Codex app-server connect probe currently supports http and https endpoints only",
    );
  }
  const fetchImpl = options.fetch ?? fetch;

  return {
    async send(
      request: CodexAppServerJsonRpcRequest,
    ): Promise<CodexAppServerJsonRpcResponse> {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      if (response.status === 401 || response.status === 403) {
        throw new CodexAppServerJsonRpcError({
          kind: "transport",
          method: request.method,
          message:
            `Codex app-server endpoint rejected initialize authentication: HTTP ${response.status}`,
          code: response.status,
        });
      }
      if (!response.ok) {
        throw new Error(`Codex app-server endpoint returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Codex app-server HTTP response must be a JSON object");
      }

      return payload as CodexAppServerJsonRpcResponse;
    },
    async sendNotification(notification) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(notification),
      });
      if (response.status === 401 || response.status === 403) {
        throw new CodexAppServerJsonRpcError({
          kind: "transport",
          method: notification.method,
          message:
            `Codex app-server endpoint rejected notification authentication: HTTP ${response.status}`,
          code: response.status,
        });
      }
      if (!response.ok) {
        throw new Error(`Codex app-server endpoint returned HTTP ${response.status}`);
      }
    },
  };
}

function capabilityStatuses(
  advertisedMethods: readonly string[],
): CodexAppServerCapabilityStatus[] {
  const capabilities = detectCodexAppServerCapabilities(advertisedMethods);
  const required = [
    status("thread_control", true, capabilities.threadStart.available, "thread/start"),
    status("thread_fork", true, capabilities.threadFork.available, "thread/fork"),
    status("turn_control", true, capabilities.turnStart.available, "turn/start"),
    status(
      "turn_interrupt",
      true,
      capabilities.turnInterrupt.available,
      "turn/interrupt",
    ),
    {
      capability: "thread_read",
      required: true,
      status: capabilities.threadReadOrList.available ? "supported" : "missing",
      method: capabilities.threadReadOrList.method,
      alternatives: [...capabilities.threadReadOrList.alternatives],
    } satisfies CodexAppServerCapabilityStatus,
  ];

  return [
    ...required,
    status(
      "thread_goal_set",
      false,
      capabilities.threadGoalSet.available,
      capabilities.threadGoalSet.method,
    ),
    status(
      "thread_goal_get",
      false,
      capabilities.threadGoalGet.available,
      capabilities.threadGoalGet.method,
    ),
    status(
      "thread_goal_clear",
      false,
      capabilities.threadGoalClear.available,
      capabilities.threadGoalClear.method,
    ),
    status(
      "mcp_status",
      false,
      capabilities.mcp.statusList.available,
      capabilities.mcp.statusList.method,
    ),
    status(
      "mcp_tool_call",
      false,
      capabilities.mcp.toolCall.available,
      capabilities.mcp.toolCall.method,
    ),
    optionalMethodStatus("skills", advertisedMethods, ["skill/list", "skills/list"]),
    optionalMethodStatus("plugins", advertisedMethods, ["plugin/list", "plugins/list"]),
    optionalMethodStatus("hooks", advertisedMethods, ["hook/list", "hooks/list"]),
    optionalMethodStatus("filesystem", advertisedMethods, [
      "fs/readFile",
      "filesystem/read",
      "fs/read",
    ]),
    optionalMethodStatus("command_execution", advertisedMethods, [
      "command/exec",
      "command/execute",
      "exec",
    ]),
    optionalMethodStatus("remote_control", advertisedMethods, [
      "remote/status",
      "remote/control",
    ]),
    optionalMethodStatus("schema_generation", advertisedMethods, [
      "schema/generate",
      "protocol/schema",
    ]),
  ];
}

function optionalMethodStatus(
  capability: string,
  advertisedMethods: readonly string[],
  alternatives: readonly string[],
): CodexAppServerCapabilityStatus {
  const methods = new Set(advertisedMethods);
  const method = alternatives.find((candidate) => methods.has(candidate)) ?? null;
  return {
    capability,
    required: false,
    status: method ? "supported" : "optional",
    method,
    alternatives: [...alternatives],
  };
}

function status(
  capability: string,
  required: boolean,
  available: boolean,
  method: string,
): CodexAppServerCapabilityStatus {
  return {
    capability,
    required,
    status: available ? "supported" : required ? "missing" : "optional",
    method: available ? method : null,
    alternatives: [method],
  };
}

function failureProbeReport(options: {
  error: unknown;
  profileId: string;
  transportMode: NexusAutomationCodexAppServerConfig["mode"];
  endpointScope: "loopback" | "non_loopback";
  goalPolicy?: NexusCodexGoalsPolicyDecision | null;
}): CodexAppServerInitializeProbeReport {
  let blockerKind: CodexAppServerInitializeProbeBlockerKind = "unknown_failure";
  if (options.error instanceof CodexAppServerCapabilityError) {
    blockerKind = "missing_required_method";
  } else if (options.error instanceof CodexAppServerJsonRpcError) {
    if (options.error.kind === "protocol") {
      blockerKind = "unsupported_wire_protocol";
    } else if (isAuthFailure(options.error)) {
      blockerKind = "auth_failure";
    } else if (options.error.kind === "remote") {
      blockerKind = "remote_failure";
    } else {
      blockerKind = /newline-delimited JSON|jsonrpc|protocol/iu.test(
        options.error.message,
      )
        ? "unsupported_wire_protocol"
        : "transport_failure";
    }
  }

  return emptyBlockedProbeReport({
    profileId: options.profileId,
    transportMode: options.transportMode,
    endpointScope: options.endpointScope,
    blockerKind,
    blockerSummary: errorMessage(options.error),
    goalPolicy: options.goalPolicy ?? null,
  });
}

function emptyBlockedProbeReport(options: {
  profileId: string;
  transportMode: NexusAutomationCodexAppServerConfig["mode"];
  endpointScope: "loopback" | "non_loopback";
  blockerKind: CodexAppServerInitializeProbeBlockerKind;
  blockerSummary: string;
  goalPolicy?: NexusCodexGoalsPolicyDecision | null;
}): CodexAppServerInitializeProbeReport {
  return {
    status: "blocked",
    profileId: options.profileId,
    transportMode: options.transportMode,
    endpointScope: options.endpointScope,
    clientIdentity: {
      name: "dev-nexus",
      version: null,
    },
    codexVersion: null,
    advertisedMethods: [],
    effectiveMethods: [],
    methodSource: null,
    capabilities: capabilityStatuses([]),
    requiredCapabilities: capabilityStatuses([]).filter((item) => item.required),
    optionalCapabilities: capabilityStatuses([]).filter((item) => !item.required),
    goalPolicy: options.goalPolicy ?? null,
    goalRuntime: {
      status: "not_checked",
      check: "not_checked",
      method: null,
      summary: null,
    },
    blockerKind: options.blockerKind,
    blockerSummary: options.blockerSummary,
    initializeResult: null,
  };
}

function extractCodexVersion(value: unknown): string | null {
  for (const path of [
    "serverInfo.version",
    "server.version",
    "codex.version",
    "codexVersion",
    "version",
  ]) {
    const candidate = valueAtPath(value, path);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const userAgent = valueAtPath(value, "userAgent");
  if (typeof userAgent === "string") {
    const match = /\bCodex(?: Desktop)?\/(?<version>\d+\.\d+\.\d+)\b/u.exec(
      userAgent,
    );
    if (match?.groups?.version) {
      return match.groups.version;
    }
  }

  return null;
}

function valueAtPath(value: unknown, dottedPath: string): unknown {
  let current = value;
  for (const segment of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function isAuthFailure(error: CodexAppServerJsonRpcError): boolean {
  return error.code === 401 ||
    error.code === 403 ||
    /auth|unauthorized|forbidden|permission denied/iu.test(error.message);
}

async function probeCodexAppServerGoalRuntime(options: {
  client: CodexAppServerJsonRpcClient;
  capabilities: ReturnType<typeof detectCodexAppServerCapabilities>;
  goalPolicy: NexusCodexGoalsPolicyDecision | null;
  goalStorageSmoke: boolean;
  profile: NexusAutomationAgentProfilePolicy;
  projectRoot: string;
}): Promise<CodexAppServerGoalRuntimeCheck> {
  if (!options.goalPolicy || options.goalPolicy.mode === "disabled") {
    return {
      status: "not_checked",
      check: "not_checked",
      method: null,
      summary: "Codex Goals policy is disabled.",
    };
  }

  if (options.goalStorageSmoke) {
    return probeCodexAppServerGoalStorage(options);
  }

  if (!options.capabilities.threadGoalGet.available) {
    return {
      status: "unsupported",
      check: "feature_gate",
      method: null,
      summary: "thread/goal/get is not available in the app-server protocol.",
    };
  }

  const method = options.capabilities.threadGoalGet.method;
  try {
    await options.client.request(method, {
      threadId: "00000000-0000-4000-8000-000000000001",
    });
    return {
      status: "enabled",
      check: "feature_gate",
      method,
      summary: "thread/goal/get accepted a read-only probe request.",
    };
  } catch (error) {
    if (error instanceof CodexAppServerJsonRpcError) {
      const message = error.message.toLowerCase();
      if (error.code === -32601) {
        return {
          status: "unsupported",
          check: "feature_gate",
          method,
          summary: error.message,
        };
      }
      if (/goals? feature is disabled/.test(message)) {
        return {
          status: "disabled",
          check: "feature_gate",
          method,
          summary: error.message,
        };
      }
      if (/thread not found/.test(message)) {
        return {
          status: "enabled",
          check: "feature_gate",
          method,
          summary: "thread/goal/get reached thread lookup; Goals are enabled.",
        };
      }
    }

    return {
      status: "failed",
      check: "feature_gate",
      method,
      summary: errorMessage(error),
    };
  }
}

async function probeCodexAppServerGoalStorage(options: {
  client: CodexAppServerJsonRpcClient;
  capabilities: ReturnType<typeof detectCodexAppServerCapabilities>;
  profile: NexusAutomationAgentProfilePolicy;
  projectRoot: string;
}): Promise<CodexAppServerGoalRuntimeCheck> {
  if (!options.capabilities.threadStart.available) {
    return unsupportedGoalStorageSmoke(
      "thread/start is required for the Goal storage smoke.",
    );
  }
  if (!options.capabilities.threadGoalSet.available) {
    return unsupportedGoalStorageSmoke(
      "thread/goal/set is required for the Goal storage smoke.",
    );
  }
  if (!options.capabilities.threadGoalGet.available) {
    return unsupportedGoalStorageSmoke(
      "thread/goal/get is required for the Goal storage smoke.",
    );
  }
  if (!options.capabilities.threadGoalClear.available) {
    return unsupportedGoalStorageSmoke(
      "thread/goal/clear is required for the Goal storage smoke.",
    );
  }

  let threadId: string | null = null;
  let goalCleared = false;
  let threadArchived = false;
  const objective = `DevNexus app-server Goal storage smoke ${new Date().toISOString()}`;
  try {
    const threadStartResult = await options.client.request("thread/start", {
      cwd: options.projectRoot,
      ephemeral: false,
      ...(options.profile.model ? { model: options.profile.model } : {}),
    });
    threadId = extractCodexAppServerThreadId(threadStartResult);
    if (!threadId) {
      return {
        status: "failed",
        check: "storage_smoke",
        method: "thread/start",
        summary:
          `thread/start did not return a materialized thread id: ${JSON.stringify(threadStartResult)}`,
      };
    }

    await options.client.request(options.capabilities.threadGoalSet.method, {
      threadId,
      objective,
      tokenBudget: 1,
    });
    const getResult = await options.client.request(
      options.capabilities.threadGoalGet.method,
      { threadId },
    );
    const readObjective = extractCodexAppServerGoalObjective(getResult);
    if (readObjective !== objective) {
      return {
        status: "failed",
        check: "storage_smoke",
        method: options.capabilities.threadGoalGet.method,
        threadId,
        summary:
          `thread/goal/get returned ${JSON.stringify(readObjective)} instead of the storage smoke objective.`,
      };
    }

    await options.client.request(options.capabilities.threadGoalClear.method, {
      threadId,
    });
    goalCleared = true;
    await archiveCodexAppServerProbeThread(options.client, threadId);
    threadArchived = true;
    return {
      status: "enabled",
      check: "storage_smoke",
      method: options.capabilities.threadGoalSet.method,
      threadId,
      summary:
        "Goal storage smoke set, read, cleared, and archived a materialized thread without starting a turn.",
    };
  } catch (error) {
    const status = goalRuntimeStatusForError(error);
    return {
      status,
      check: "storage_smoke",
      method: goalStorageSmokeFailureMethod(error),
      threadId,
      summary: goalStorageSmokeFailureSummary(error),
    };
  } finally {
    if (threadId) {
      if (!goalCleared) {
        await ignoreCodexAppServerCleanupError(
          options.client.request(options.capabilities.threadGoalClear.method, {
            threadId,
          }),
        );
      }
      if (!threadArchived) {
        await ignoreCodexAppServerCleanupError(
          archiveCodexAppServerProbeThread(options.client, threadId),
        );
      }
    }
  }
}

function unsupportedGoalStorageSmoke(
  summary: string,
): CodexAppServerGoalRuntimeCheck {
  return {
    status: "unsupported",
    check: "storage_smoke",
    method: null,
    summary,
  };
}

function goalRuntimeStatusForError(
  error: unknown,
): CodexAppServerGoalRuntimeStatus {
  if (error instanceof CodexAppServerJsonRpcError) {
    const message = error.message.toLowerCase();
    if (error.code === -32601) {
      return "unsupported";
    }
    if (/goals? feature is disabled/.test(message)) {
      return "disabled";
    }
  }

  return "failed";
}

function goalStorageSmokeFailureMethod(error: unknown): string | null {
  return error instanceof CodexAppServerJsonRpcError ? error.method : null;
}

function goalStorageSmokeFailureSummary(error: unknown): string {
  const message = errorMessage(error);
  return /no such table:\s*thread_goals/iu.test(message)
    ? `Goal storage smoke failed because the local Codex runtime queried a missing thread_goals table: ${message}`
    : `Goal storage smoke failed: ${message}`;
}

function goalRuntimeBlockerSummary(options: {
  goalRuntime: CodexAppServerGoalRuntimeCheck;
  goalStorageSmoke: boolean;
}): string | null {
  if (!options.goalStorageSmoke) {
    return null;
  }
  return options.goalRuntime.status === "enabled"
    ? null
    : options.goalRuntime.summary ??
      `Codex Goals storage smoke reported ${options.goalRuntime.status}`;
}

function extractCodexAppServerThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id.trim().length > 0) {
    return record.id;
  }
  const thread = record.thread;
  if (thread && typeof thread === "object" && !Array.isArray(thread)) {
    const id = (thread as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim().length > 0) {
      return id;
    }
  }

  return null;
}

function extractCodexAppServerGoalObjective(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const objective = record.objective;
  if (typeof objective === "string") {
    return objective;
  }
  const goal = record.goal;
  if (goal && typeof goal === "object" && !Array.isArray(goal)) {
    const goalObjective = (goal as Record<string, unknown>).objective;
    if (typeof goalObjective === "string") {
      return goalObjective;
    }
  }

  return null;
}

async function archiveCodexAppServerProbeThread(
  client: CodexAppServerJsonRpcClient,
  threadId: string,
): Promise<void> {
  await client.request("thread/archive", { threadId });
}

async function ignoreCodexAppServerCleanupError(
  promise: Promise<unknown>,
): Promise<void> {
  try {
    await promise;
  } catch {
    // Probe cleanup is best effort; preserve the primary storage-smoke result.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
