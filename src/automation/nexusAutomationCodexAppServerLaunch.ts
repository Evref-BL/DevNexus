import {
  defaultCodexAppServerInitializeParams,
  initializeCodexAppServerCapabilityAdapter,
  type CodexAppServerCapabilityAdapter,
} from "../codex-app/codexAppServerCapabilityAdapter.js";
import {
  CodexAppServerJsonRpcError,
  CodexAppServerJsonRpcClient,
  createCodexAppServerStdioJsonRpcTransport,
  summarizeCodexAppServerJsonRpcFailure,
  type CodexAppServerJsonRpcTransport,
} from "../codex-app/codexAppServerJsonRpc.js";
import type {
  NexusAutomationAgentLaunchInput,
  NexusAutomationAgentLaunchResult,
  NexusAutomationAgentLaunchStatus,
  NexusAutomationAgentLauncher,
  NexusAutomationCodexAppServerLaunchMetadata,
} from "./nexusAutomationAgentLaunch.js";
import type {
  NexusAutomationCodexAppServerGoalMetadata,
} from "./nexusAutomationAgentLaunchMetadata.js";
import {
  evaluateNexusCodexGoalsAutomationPolicy,
  formatNexusCodexGoalsPolicyBlockers,
  type NexusCodexGoalsAutomationMode,
  type NexusCodexGoalsPolicyDecision,
} from "./nexusCodexGoalsPolicy.js";
import {
  readNexusAutomationAgentResultFile,
} from "./nexusAutomationAgentLaunch.js";
import {
  normalizeNexusAutomationAgentPolicy,
  type NexusAutomationAgentProfilePolicy,
} from "./nexusAutomationAgentProfile.js";
import type { NexusProjectConfig } from "../project/nexusProjectConfig.js";

export type NexusAutomationCodexAppServerThreadPersistence =
  | "profile_default"
  | "ephemeral"
  | "durable";

export interface NexusAutomationCodexAppServerForkOptions {
  threadId: string;
  turnId?: string | null;
}

export interface NexusAutomationCodexAppServerGoalOptions {
  enabled?: boolean;
  mode?: Exclude<NexusCodexGoalsAutomationMode, "disabled">;
  tokenBudget?: number | null;
}

export interface NexusAutomationCodexAppServerClientFactoryInput {
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
}

export interface NexusAutomationCodexAppServerAdapterFactoryInput
  extends NexusAutomationCodexAppServerClientFactoryInput {
  client: CodexAppServerJsonRpcClient;
}

export interface CreateNexusAutomationCodexAppServerLauncherOptions {
  profileId?: string;
  cwd?: string | ((input: NexusAutomationAgentLaunchInput) => string);
  turnInput?: string | ((input: NexusAutomationAgentLaunchInput) => string);
  threadPersistence?: NexusAutomationCodexAppServerThreadPersistence;
  fork?: NexusAutomationCodexAppServerForkOptions;
  goal?: NexusAutomationCodexAppServerGoalOptions | false;
  env?: NodeJS.ProcessEnv;
  adapter?: CodexAppServerCapabilityAdapter;
  client?: CodexAppServerJsonRpcClient;
  clientFactory?: (
    input: NexusAutomationCodexAppServerClientFactoryInput,
  ) => CodexAppServerJsonRpcClient | Promise<CodexAppServerJsonRpcClient>;
  transportFactory?: (
    input: NexusAutomationCodexAppServerClientFactoryInput,
  ) => CodexAppServerJsonRpcTransport | Promise<CodexAppServerJsonRpcTransport>;
  adapterFactory?: (
    input: NexusAutomationCodexAppServerAdapterFactoryInput,
  ) => CodexAppServerCapabilityAdapter | Promise<CodexAppServerCapabilityAdapter>;
  turnCompletionNotificationTimeoutMs?: number;
}

interface ResolvedCodexAppServerAdapter {
  adapter: CodexAppServerCapabilityAdapter;
  closeClient: boolean;
}

interface CodexLaunchPolicy {
  approvalPolicy: string | null;
  sandbox: string | null;
  permissionProfile: string;
  mcpDefaultToolsApprovalMode: string | null;
}

interface ResolvedCodexThreadGoalProjection {
  enabled: boolean;
  mode: NexusCodexGoalsAutomationMode;
  tokenBudget?: number | null;
}

const defaultTurnCompletionNotificationTimeoutMs = 120_000;

export class NexusAutomationCodexAppServerLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationCodexAppServerLaunchError";
  }
}

export function createNexusAutomationCodexAppServerLauncher(
  options: CreateNexusAutomationCodexAppServerLauncherOptions = {},
): NexusAutomationAgentLauncher {
  return async (
    input: NexusAutomationAgentLaunchInput,
  ): Promise<NexusAutomationAgentLaunchResult> => {
    let profile: NexusAutomationAgentProfilePolicy | null = null;
    let cwd = "";
    let ephemeral = true;
    let threadId: string | null = null;
    let turnId: string | null = null;
    let goal: NexusAutomationCodexAppServerGoalMetadata | null = null;
    const fork = options.fork ?? null;
    const action = fork ? "thread_fork" : "thread_start";

    try {
      profile = resolveCodexAppServerProfile(input, options.profileId);
      cwd = resolveLaunchCwd(input, options.cwd);
      ephemeral = resolveThreadEphemeral(profile, options.threadPersistence);
      const policy = codexLaunchPolicy(input.projectConfig, profile);
      const goalProjection = resolveCodexThreadGoalProjection(options.goal);
      const goalPolicy = evaluateNexusCodexGoalsAutomationPolicy({
        mode: goalProjection.mode,
        approvalPolicy: policy.approvalPolicy,
        sandbox: policy.sandbox,
        permissionProfile: policy.permissionProfile,
        allowHostMutation: profile.safety.allowHostMutation,
        allowDependencyInstall: profile.safety.allowDependencyInstall,
        allowLiveServices: profile.safety.allowLiveServices,
        tokenBudget: goalProjection.tokenBudget ?? null,
        devNexusRelaunchWhileEligible:
          input.automationConfig.agent.relaunch.whileEligible,
        mcpDefaultToolsApprovalMode: policy.mcpDefaultToolsApprovalMode,
      });
      if (goalPolicy.status === "blocked") {
        throw new NexusAutomationCodexAppServerLaunchError(
          `Codex Goals automation policy blocked ${goalPolicy.mode}: ${formatNexusCodexGoalsPolicyBlockers(goalPolicy)}`,
        );
      }
      const { adapter, closeClient } = await resolveCodexAppServerAdapter({
        input,
        profile,
        cwd,
        options,
      });

      try {
        const threadResult = await adapter.client.request(
          fork ? "thread/fork" : "thread/start",
          fork
            ? {
                sourceThreadId: requiredNonEmptyString(
                  fork.threadId,
                  "fork.threadId",
                ),
                ...(fork.turnId
                  ? { sourceTurnId: requiredNonEmptyString(fork.turnId, "fork.turnId") }
                  : {}),
                ...codexThreadParams({
                  input,
                  profile,
                  cwd,
                  ephemeral,
                  policy,
                }),
              }
            : codexThreadParams({
                input,
                profile,
                cwd,
                ephemeral,
                policy,
              }),
        );
        threadId = extractId(threadResult, [
          "threadId",
          "thread_id",
          "id",
          "thread.id",
        ], "thread id");
        goal = await maybeSetCodexThreadGoal({
          adapter,
          input,
          threadId,
          projection: goalProjection,
          policy: goalPolicy,
        });
        const turnResult = await adapter.client.request(
          "turn/start",
          codexTurnParams({
            input,
            profile,
            cwd,
            ephemeral,
            policy,
            threadId,
            turnInput: resolveTurnInput(input, options.turnInput),
          }),
        );
        turnId = extractId(turnResult, [
          "turnId",
          "turn_id",
          "id",
          "turn.id",
        ], "turn id");

        await waitForCodexAppServerTurnCompletionNotification({
          client: adapter.client,
          threadId,
          turnId,
          timeoutMs:
            options.turnCompletionNotificationTimeoutMs ??
            defaultTurnCompletionNotificationTimeoutMs,
        });
        goal = await maybeReadCodexThreadGoal({
          adapter,
          threadId,
          goal,
        });

        const reported = readNexusAutomationAgentResultFile(input.resultFile);
        if (reported.status !== "loaded") {
          return {
            status: "failed",
            summary: reported.summary,
            error: reported.error,
            codexAppServer: codexAppServerMetadata({
              status: "failed",
              action,
              input,
              profile,
              fork,
              threadId,
              turnId,
              ephemeral,
              cwd,
              failureSummary: reported.error,
              goal,
            }),
          };
        }

        const status = reported.result?.status ?? "completed";
        const summary = reported.result?.summary ?? defaultAgentSummary(status);
        const resultFailureSummary =
          status === "completed"
            ? null
            : reported.result?.error ?? summary;
        return {
          status,
          summary,
          commitIds: reported.result?.commitIds ?? [],
          verification: reported.result?.verification ?? [],
          publicationDecision: reported.result?.publicationDecision,
          error: reported.result?.error ?? null,
          codexAppServer: codexAppServerMetadata({
            status,
            action,
            input,
            profile,
            fork,
            threadId,
            turnId,
            ephemeral,
            cwd,
            failureSummary: resultFailureSummary,
            goal,
          }),
        };
      } finally {
        if (closeClient) {
          await adapter.client.close();
        }
      }
    } catch (error) {
      const failureSummary = summarizeCodexAppServerJsonRpcFailure(error);
      return {
        status: "failed",
        summary: `Codex app-server launch failed: ${failureSummary}`,
        error: failureSummary,
        ...(profile
          ? {
              codexAppServer: codexAppServerMetadata({
                status: "failed",
                action,
                input,
                profile,
                fork,
                threadId,
                turnId,
                ephemeral,
                cwd: cwd || input.projectRoot,
                failureSummary,
                goal,
              }),
            }
          : {}),
      };
    }
  };
}

async function waitForCodexAppServerTurnCompletionNotification(options: {
  client: CodexAppServerJsonRpcClient;
  threadId: string;
  turnId: string;
  timeoutMs: number;
}): Promise<void> {
  if (!options.client.supportsNotifications()) {
    return;
  }

  const notification = options.client.waitForNotification((candidate) =>
    isTerminalCodexAppServerTurnNotification(candidate, {
      threadId: options.threadId,
      turnId: options.turnId,
    }),
  );
  if (options.timeoutMs <= 0) {
    await notification;
    return;
  }

  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      notification,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new NexusAutomationCodexAppServerLaunchError(
                `Timed out waiting for Codex app-server terminal notification for turn ${options.turnId}`,
              ),
            ),
          options.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isTerminalCodexAppServerTurnNotification(
  notification: { method: string; params?: unknown },
  expected: { threadId: string; turnId: string },
): boolean {
  const method = notification.method.toLowerCase();
  if (!method.includes("turn")) {
    return false;
  }

  const params = isRecord(notification.params)
    ? notification.params
    : {};
  const turnId = firstStringAtPath(params, [
    "turnId",
    "turn_id",
    "turn.id",
    "turn.turnId",
    "turn.turn_id",
  ]);
  if (turnId !== expected.turnId) {
    return false;
  }

  const threadId = firstStringAtPath(params, [
    "threadId",
    "thread_id",
    "thread.id",
    "thread.threadId",
    "thread.thread_id",
  ]);
  if (threadId && threadId !== expected.threadId) {
    return false;
  }

  if (/completed|complete|finished|finish|failed|failure|cancelled|canceled|done/.test(method)) {
    return true;
  }

  const status = firstStringAtPath(params, [
    "status",
    "state",
    "turn.status",
    "turn.state",
  ])?.toLowerCase();
  return status
    ? ["completed", "failed", "blocked", "cancelled", "canceled", "done"].includes(status)
    : false;
}

async function resolveCodexAppServerAdapter(options: {
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
  options: CreateNexusAutomationCodexAppServerLauncherOptions;
}): Promise<ResolvedCodexAppServerAdapter> {
  if (options.options.adapter) {
    return {
      adapter: options.options.adapter,
      closeClient: false,
    };
  }

  const client = await resolveCodexAppServerClient(options);
  const adapter = options.options.adapterFactory
    ? await options.options.adapterFactory({
        input: options.input,
        profile: options.profile,
        cwd: options.cwd,
        client,
      })
    : await initializeCodexAppServerCapabilityAdapter({
        client,
        initializeParams: defaultCodexAppServerInitializeParams({
          title: "DevNexus automation app-server launcher",
          version: options.input.projectConfig.version,
        }),
      });

  return {
    adapter,
    closeClient: shouldCloseResolvedClient(options.options),
  };
}

async function resolveCodexAppServerClient(options: {
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
  options: CreateNexusAutomationCodexAppServerLauncherOptions;
}): Promise<CodexAppServerJsonRpcClient> {
  if (options.options.client) {
    return options.options.client;
  }
  if (options.options.clientFactory) {
    return options.options.clientFactory({
      input: options.input,
      profile: options.profile,
      cwd: options.cwd,
    });
  }
  if (options.options.transportFactory) {
    const transport = await options.options.transportFactory({
      input: options.input,
      profile: options.profile,
      cwd: options.cwd,
    });
    return new CodexAppServerJsonRpcClient({ transport });
  }

  const appServer = options.profile.appServer;
  if (!appServer) {
    throw new NexusAutomationCodexAppServerLaunchError(
      `Profile ${options.profile.id} does not configure Codex app-server policy`,
    );
  }
  if (appServer.mode !== "spawn") {
    throw new NexusAutomationCodexAppServerLaunchError(
      "Codex app-server connect mode requires a configured JSON-RPC client or adapter",
    );
  }
  if (!appServer.command) {
    throw new NexusAutomationCodexAppServerLaunchError(
      `Profile ${options.profile.id} app-server command is required for spawn mode`,
    );
  }

  return new CodexAppServerJsonRpcClient({
    transport: createCodexAppServerStdioJsonRpcTransport({
      command: appServer.command,
      args: appServer.args,
      cwd: options.cwd,
      env: codexAppServerProcessEnvironment(
        options.options.env ?? process.env,
        options.input,
      ),
    }),
  });
}

function defaultClientWillBeCreated(
  options: CreateNexusAutomationCodexAppServerLauncherOptions,
): boolean {
  return !options.client && !options.clientFactory && !options.adapter;
}

function shouldCloseResolvedClient(
  options: CreateNexusAutomationCodexAppServerLauncherOptions,
): boolean {
  if (options.client || options.clientFactory || options.adapter) {
    return false;
  }

  return options.transportFactory !== undefined || defaultClientWillBeCreated(options);
}

function resolveCodexAppServerProfile(
  input: NexusAutomationAgentLaunchInput,
  profileId: string | undefined,
): NexusAutomationAgentProfilePolicy {
  const policy = normalizeNexusAutomationAgentPolicy(input.automationConfig);
  const resolvedProfileId = profileId ?? policy.coordinatorProfileId;
  if (!resolvedProfileId) {
    throw new NexusAutomationCodexAppServerLaunchError(
      "Codex app-server launch requires a profile id or automation.agent.coordinatorProfileId",
    );
  }

  const profile = policy.profiles.find((item) => item.id === resolvedProfileId);
  if (!profile) {
    throw new NexusAutomationCodexAppServerLaunchError(
      `Codex app-server profile was not found: ${resolvedProfileId}`,
    );
  }
  if (profile.executor.toLowerCase() !== "codex") {
    throw new NexusAutomationCodexAppServerLaunchError(
      `Profile ${profile.id} executor must be codex for app-server launch`,
    );
  }
  if (profile.executorMode !== "app_server" || !profile.appServer) {
    throw new NexusAutomationCodexAppServerLaunchError(
      `Profile ${profile.id} must configure executorMode app_server and appServer policy`,
    );
  }

  return profile;
}

function resolveLaunchCwd(
  input: NexusAutomationAgentLaunchInput,
  cwd: CreateNexusAutomationCodexAppServerLauncherOptions["cwd"],
): string {
  const resolved = typeof cwd === "function" ? cwd(input) : cwd;
  return requiredNonEmptyString(resolved ?? input.projectRoot, "cwd");
}

function resolveTurnInput(
  input: NexusAutomationAgentLaunchInput,
  turnInput: CreateNexusAutomationCodexAppServerLauncherOptions["turnInput"],
): string {
  const resolved = typeof turnInput === "function" ? turnInput(input) : turnInput;
  return requiredNonEmptyString(
    resolved ??
      [
        `DevNexus agent launch ${input.runId}.`,
        `Read context from ${input.contextFile}.`,
        `Write result JSON to ${input.resultFile}.`,
      ].join("\n"),
    "turnInput",
  );
}

function resolveThreadEphemeral(
  profile: NexusAutomationAgentProfilePolicy,
  persistence: NexusAutomationCodexAppServerThreadPersistence | undefined,
): boolean {
  if (persistence === "durable") {
    return false;
  }
  if (persistence === "ephemeral") {
    return true;
  }

  return profile.appServer?.ephemeralThreadDefault ?? true;
}

function codexThreadParams(options: {
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
  ephemeral: boolean;
  policy: CodexLaunchPolicy;
}): Record<string, unknown> {
  return compactRecord({
    ephemeral: options.ephemeral,
    ...codexExecutionParams(options),
  });
}

function codexTurnParams(options: {
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
  ephemeral: boolean;
  policy: CodexLaunchPolicy;
  threadId: string;
  turnInput: string;
}): Record<string, unknown> {
  return compactRecord({
    threadId: options.threadId,
    input: [
      {
        type: "text",
        text: options.turnInput,
      },
    ],
    ...codexExecutionParams(options),
  });
}

async function maybeSetCodexThreadGoal(options: {
  adapter: CodexAppServerCapabilityAdapter;
  input: NexusAutomationAgentLaunchInput;
  threadId: string;
  projection: ResolvedCodexThreadGoalProjection;
  policy: NexusCodexGoalsPolicyDecision;
}): Promise<NexusAutomationCodexAppServerGoalMetadata | null> {
  if (!options.projection.enabled) {
    return null;
  }

  const metadata = initialCodexThreadGoalMetadata({
    adapter: options.adapter,
    threadId: options.threadId,
    tokenBudget: options.projection.tokenBudget,
    policy: options.policy,
  });
  if (!options.adapter.capabilities.threadGoalSet.available) {
    return metadata;
  }

  try {
    await options.adapter.client.request(
      options.adapter.capabilities.threadGoalSet.method,
      codexThreadGoalSetParams({
        input: options.input,
        threadId: options.threadId,
        tokenBudget: options.projection.tokenBudget,
      }),
    );
    return {
      ...metadata,
      setStatus: "set",
    };
  } catch (error) {
    if (isCodexThreadGoalUnavailableError(error)) {
      return {
        ...metadata,
        setStatus: "unavailable",
        readStatus: "unavailable",
        failureSummary: summarizeCodexAppServerJsonRpcFailure(error),
      };
    }
    throw error;
  }
}

async function maybeReadCodexThreadGoal(options: {
  adapter: CodexAppServerCapabilityAdapter;
  threadId: string;
  goal: NexusAutomationCodexAppServerGoalMetadata | null;
}): Promise<NexusAutomationCodexAppServerGoalMetadata | null> {
  if (!options.goal || options.goal.setStatus !== "set") {
    return options.goal;
  }
  if (!options.adapter.capabilities.threadGoalGet.available) {
    return {
      ...options.goal,
      readStatus: "unsupported",
    };
  }

  try {
    const result = await options.adapter.client.request(
      options.adapter.capabilities.threadGoalGet.method,
      { threadId: options.threadId },
    );
    return codexThreadGoalReadMetadata(options.goal, result);
  } catch (error) {
    return {
      ...options.goal,
      readStatus: isCodexThreadGoalUnavailableError(error)
        ? "unavailable"
        : "failed",
      failureSummary: summarizeCodexAppServerJsonRpcFailure(error),
    };
  }
}

function initialCodexThreadGoalMetadata(options: {
  adapter: CodexAppServerCapabilityAdapter;
  threadId: string;
  tokenBudget?: number | null;
  policy: NexusCodexGoalsPolicyDecision;
}): NexusAutomationCodexAppServerGoalMetadata {
  const getMethodAvailable = options.adapter.capabilities.threadGoalGet.available;
  return {
    requested: true,
    setMethodAvailable: options.adapter.capabilities.threadGoalSet.available,
    getMethodAvailable,
    setStatus: options.adapter.capabilities.threadGoalSet.available
      ? "not_requested"
      : "unsupported",
    readStatus: getMethodAvailable ? "not_requested" : "unsupported",
    goalId: null,
    threadId: options.threadId,
    status: null,
    tokenBudget: options.tokenBudget ?? null,
    tokensUsed: null,
    timeUsedSeconds: null,
    failureSummary: null,
    policy: options.policy,
  };
}

function codexThreadGoalReadMetadata(
  existing: NexusAutomationCodexAppServerGoalMetadata,
  value: unknown,
): NexusAutomationCodexAppServerGoalMetadata {
  const goal = codexThreadGoalRecord(value);
  return {
    ...existing,
    readStatus: "read",
    goalId: firstStringAtPath(goal, ["goalId", "goal_id", "id"]) ?? null,
    threadId: firstStringAtPath(goal, ["threadId", "thread_id"]) ??
      existing.threadId,
    status: firstStringAtPath(goal, ["status", "state"]) ?? existing.status,
    tokenBudget: optionalNumberAtPath(goal, ["tokenBudget", "token_budget"]),
    tokensUsed: optionalNumberAtPath(goal, ["tokensUsed", "tokens_used"]),
    timeUsedSeconds: optionalNumberAtPath(goal, [
      "timeUsedSeconds",
      "time_used_seconds",
    ]),
    failureSummary: null,
  };
}

function codexThreadGoalRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const nestedGoal = value.goal;
  return isRecord(nestedGoal) ? nestedGoal : value;
}

function codexThreadGoalSetParams(options: {
  input: NexusAutomationAgentLaunchInput;
  threadId: string;
  tokenBudget?: number | null;
}): Record<string, unknown> {
  return compactRecord({
    threadId: options.threadId,
    objective: codexThreadGoalObjective(options.input),
    tokenBudget: options.tokenBudget,
  });
}

function codexThreadGoalObjective(
  input: NexusAutomationAgentLaunchInput,
): string {
  const targetId = input.automationConfig.target.id;
  const targetObjective =
    input.automationConfig.target.objective?.trim() ||
    `Advance eligible DevNexus work for ${input.projectConfig.name}.`;
  const workScope = codexThreadGoalWorkScope(input);

  return [
    targetId
      ? `Target ${targetId}: ${targetObjective}`
      : `Target: ${targetObjective}`,
    workScope,
    `Run ${input.runId} starts from context ${input.contextFile}.`,
    `Write result JSON to ${input.resultFile}. The result must include status and summary; include verification, commitIds, workItems, publicationDecision, and error when relevant.`,
    "Completion requires concrete evidence from the repository, commands, tests, logs, or generated artifacts.",
    "Stop and report blocked if human approval, credentials, provider review, unsafe mutation, missing access, or a publication decision is required.",
    "Preserve DevNexus work-item, worktree, authority, verification, and publication gates.",
  ].join("\n");
}

function codexThreadGoalWorkScope(
  input: NexusAutomationAgentLaunchInput,
): string {
  const claim = input.workItemClaim;
  if (claim?.workItemId) {
    const title = claim.workItemTitle ? `: ${claim.workItemTitle}` : "";
    return `Selected work item ${claim.workItemId}${title}.`;
  }

  const items = input.eligibleWorkItems.slice(0, 5).map((item) =>
    `${item.id}: ${item.title}`
  );
  if (items.length === 0) {
    return "No specific work item is claimed yet; use the DevNexus context to select the bounded eligible work.";
  }

  const suffix =
    input.eligibleWorkItems.length > items.length
      ? ` plus ${input.eligibleWorkItems.length - items.length} more`
      : "";
  return `Eligible work: ${items.join("; ")}${suffix}.`;
}

function resolveCodexThreadGoalProjection(
  options: CreateNexusAutomationCodexAppServerLauncherOptions["goal"],
): ResolvedCodexThreadGoalProjection {
  if (options === false || options?.enabled === false) {
    return { enabled: false, mode: "disabled" };
  }

  const tokenBudget = normalizeCodexThreadGoalTokenBudget(
    options?.tokenBudget,
  );
  const mode = options?.mode ?? "goal_projection";
  return tokenBudget === undefined
    ? { enabled: true, mode }
    : { enabled: true, mode, tokenBudget };
}

function normalizeCodexThreadGoalTokenBudget(
  value: number | null | undefined,
): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new NexusAutomationCodexAppServerLaunchError(
      "goal.tokenBudget must be a positive safe integer when provided",
    );
  }

  return value;
}

function isCodexThreadGoalUnavailableError(error: unknown): boolean {
  if (!(error instanceof CodexAppServerJsonRpcError)) {
    return false;
  }
  if (!error.method.startsWith("thread/goal/")) {
    return false;
  }
  if (error.code === -32601) {
    return true;
  }

  const message = error.message.toLowerCase();
  return /goals? feature is disabled/.test(message) ||
    /ephemeral thread does not support goals?/.test(message) ||
    /goals? (are|is) (disabled|unavailable|unsupported)/.test(message);
}

function codexExecutionParams(options: {
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
  policy: CodexLaunchPolicy;
}): Record<string, unknown> {
  return compactRecord({
    cwd: options.cwd,
    model: options.profile.model ?? undefined,
    reasoning: options.profile.reasoning ?? undefined,
    approvalPolicy: options.policy.approvalPolicy ?? undefined,
    sandbox: options.policy.sandbox ?? undefined,
    permissionProfile: options.policy.permissionProfile,
    permissions: compactRecord({
      profile: options.policy.permissionProfile,
      approvalPolicy: options.policy.approvalPolicy ?? undefined,
      sandbox: options.policy.sandbox ?? undefined,
      allowHostMutation: options.profile.safety.allowHostMutation,
      allowDependencyInstall: options.profile.safety.allowDependencyInstall,
      allowLiveServices: options.profile.safety.allowLiveServices,
    }),
    mcp: options.policy.mcpDefaultToolsApprovalMode
      ? {
          defaultToolsApprovalMode: options.policy.mcpDefaultToolsApprovalMode,
        }
      : undefined,
    devNexus: devNexusLaunchContract(options.input),
    metadata: {
      source: "dev-nexus",
      projectId: options.input.projectConfig.id,
      runId: options.input.runId,
      profileId: options.profile.id,
    },
  });
}

function codexLaunchPolicy(
  projectConfig: NexusProjectConfig,
  profile: NexusAutomationAgentProfilePolicy,
): CodexLaunchPolicy {
  return {
    approvalPolicy:
      codexProfileConfigValue(profile.args, "approval_policy") ??
      codexProfileOptionValue(profile.args, "--approval-policy"),
    sandbox:
      codexProfileOptionValue(profile.args, "--sandbox") ??
      codexProfileConfigValue(profile.args, "sandbox_mode") ??
      codexProfileConfigValue(profile.args, "sandbox"),
    permissionProfile: profile.safety.profile,
    mcpDefaultToolsApprovalMode:
      codexMcpDefaultToolsApprovalMode(projectConfig),
  };
}

function codexMcpDefaultToolsApprovalMode(
  projectConfig: NexusProjectConfig,
): string | null {
  const targetValue = projectConfig.mcp?.agentTargets?.find((target) => {
    const provider = (target.provider ?? target.agent).toLowerCase();
    return target.enabled !== false &&
      provider === "codex" &&
      target.defaultToolsApprovalMode;
  })?.defaultToolsApprovalMode;

  return targetValue ?? projectConfig.mcp?.defaultToolsApprovalMode ?? null;
}

function codexProfileConfigValue(
  args: readonly string[],
  key: string,
): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "-c" && arg !== "--config") {
      continue;
    }
    const value = args[index + 1];
    if (!value) {
      continue;
    }
    const [configKey, ...rest] = value.split("=");
    if (configKey === key && rest.length > 0) {
      return rest.join("=");
    }
  }

  return null;
}

function codexProfileOptionValue(
  args: readonly string[],
  optionName: string,
): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === optionName) {
      return args[index + 1] ?? null;
    }
    if (arg.startsWith(`${optionName}=`)) {
      return arg.slice(optionName.length + 1);
    }
  }

  return null;
}

function devNexusLaunchContract(
  input: NexusAutomationAgentLaunchInput,
): Record<string, unknown> {
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    projectRoot: input.projectRoot,
    sourceRoot: input.sourceRoot,
    contextFile: input.contextFile,
    resultFile: input.resultFile,
    result: {
      file: input.resultFile,
      requiredFields: ["status", "summary"],
      optionalFields: [
        "commitIds",
        "verification",
        "publicationDecision",
        "workItems",
        "error",
      ],
      statuses: ["completed", "failed", "blocked"],
      workItemStatuses: ["completed", "blocked", "failed", "skipped"],
    },
  };
}

function codexAppServerProcessEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  input: NexusAutomationAgentLaunchInput,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    DEV_NEXUS_AUTOMATION_MODE: "agent_launch",
    DEV_NEXUS_RUN_ID: input.runId,
    DEV_NEXUS_STARTED_AT: input.startedAt,
    DEV_NEXUS_PROJECT_ROOT: input.projectRoot,
    DEV_NEXUS_SOURCE_ROOT: input.sourceRoot,
    DEV_NEXUS_AGENT_CONTEXT_FILE: input.contextFile,
    DEV_NEXUS_AGENT_RESULT_FILE: input.resultFile,
  };
}

function codexAppServerMetadata(options: {
  status: NexusAutomationCodexAppServerLaunchMetadata["status"];
  action: "thread_start" | "thread_fork";
  input: NexusAutomationAgentLaunchInput;
  profile: NexusAutomationAgentProfilePolicy;
  fork: NexusAutomationCodexAppServerForkOptions | null;
  threadId: string | null;
  turnId: string | null;
  ephemeral: boolean;
  cwd: string;
  failureSummary: string | null;
  goal: NexusAutomationCodexAppServerGoalMetadata | null;
}): NexusAutomationCodexAppServerLaunchMetadata {
  return {
    provider: "codex-app-server",
    status: options.status,
    action: options.action,
    runId: options.input.runId,
    profileId: options.profile.id,
    threadId: options.threadId,
    turnId: options.turnId,
    sourceThreadId: options.fork?.threadId ?? null,
    sourceTurnId: options.fork?.turnId ?? null,
    ephemeral: options.ephemeral,
    threadPersistence: options.ephemeral ? "ephemeral" : "durable",
    cwd: options.cwd,
    model: options.profile.model,
    reasoning: options.profile.reasoning,
    resultFile: options.input.resultFile,
    failureSummary: options.failureSummary,
    goal: options.goal,
  };
}

function defaultAgentSummary(status: NexusAutomationAgentLaunchStatus): string {
  if (status === "completed") {
    return "Agent launch completed";
  }
  if (status === "blocked") {
    return "Agent launch reported a blocker";
  }

  return "Agent launch failed";
}

function extractId(
  value: unknown,
  paths: readonly string[],
  name: string,
): string {
  for (const candidatePath of paths) {
    const candidate = valueAtPath(value, candidatePath);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  throw new NexusAutomationCodexAppServerLaunchError(
    `Codex app-server response did not include ${name}`,
  );
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

function firstStringAtPath(
  value: Record<string, unknown>,
  paths: readonly string[],
): string | null {
  for (const path of paths) {
    const candidate = valueAtPath(value, path);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function optionalNumberAtPath(
  value: Record<string, unknown>,
  paths: readonly string[],
): number | null {
  for (const path of paths) {
    const candidate = valueAtPath(value, path);
    if (candidate === null) {
      return null;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationCodexAppServerLaunchError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
