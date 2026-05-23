import {
  CodexAppServerJsonRpcClient,
  createCodexAppServerStdioJsonRpcTransport,
  summarizeCodexAppServerJsonRpcFailure,
  type CodexAppServerJsonRpcTransport,
} from "../codex-app/codexAppServerJsonRpc.js";
import {
  createCodexAppServerHttpJsonRpcTransport,
} from "../codex-app/codexAppServerInitializeProbe.js";
import {
  codexAppServerEndpointScope,
} from "../automation/nexusAutomationConfig.js";
import {
  normalizeNexusAutomationAgentPolicy,
  type NexusAutomationAgentProfilePolicy,
} from "../automation/nexusAutomationAgentProfile.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";

export interface NexusDashboardCodexChatStartOptions {
  projectRoot: string;
  prompt: string;
  title?: string | null;
  profileId?: string | null;
  cwd?: string | null;
  threadId?: string | null;
}

export interface NexusDashboardCodexChatStartResult {
  status: "started" | "resumed";
  profileId: string;
  threadId: string;
  turnId: string;
  cwd: string;
  model: string | null;
  reasoning: string | null;
  threadPersistence: "durable";
}

export interface NexusDashboardCodexChatClientFactoryInput {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
}

export interface CreateNexusDashboardCodexChatStarterOptions {
  clientFactory?: (
    input: NexusDashboardCodexChatClientFactoryInput,
  ) => CodexAppServerJsonRpcClient | Promise<CodexAppServerJsonRpcClient>;
  transportFactory?: (
    input: NexusDashboardCodexChatClientFactoryInput,
  ) => CodexAppServerJsonRpcTransport | Promise<CodexAppServerJsonRpcTransport>;
  env?: NodeJS.ProcessEnv;
}

export interface NexusDashboardCodexChatStarter {
  start(
    options: NexusDashboardCodexChatStartOptions,
  ): Promise<NexusDashboardCodexChatStartResult>;
  close(): Promise<void>;
}

interface CachedCodexChatClient {
  client: CodexAppServerJsonRpcClient;
  profile: NexusAutomationAgentProfilePolicy;
  cwd: string;
}

export class NexusDashboardCodexChatError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "NexusDashboardCodexChatError";
    this.statusCode = statusCode;
  }
}

export function createNexusDashboardCodexChatStarter(
  options: CreateNexusDashboardCodexChatStarterOptions = {},
): NexusDashboardCodexChatStarter {
  return new NexusDashboardCodexChatStarterImpl(options);
}

class NexusDashboardCodexChatStarterImpl
  implements NexusDashboardCodexChatStarter
{
  private readonly clients = new Map<string, Promise<CachedCodexChatClient>>();

  constructor(
    private readonly options: CreateNexusDashboardCodexChatStarterOptions,
  ) {}

  async start(
    options: NexusDashboardCodexChatStartOptions,
  ): Promise<NexusDashboardCodexChatStartResult> {
    const projectRoot = requiredNonEmptyString(options.projectRoot, "projectRoot");
    const prompt = requiredNonEmptyString(options.prompt, "prompt");
    const requestedThreadId = optionalNonEmptyString(options.threadId, "threadId");
    const projectConfig = loadProjectConfig(projectRoot);
    const profile = resolveCodexAppServerProfile(projectConfig, options.profileId);
    const cwd = requiredNonEmptyString(options.cwd ?? projectRoot, "cwd");
    const cacheKey = `${projectRoot}\0${profile.id}\0${cwd}`;

    try {
      const cached = await this.cachedClient(cacheKey, {
        projectRoot,
        projectConfig,
        profile,
        cwd,
      });
      const threadId = requestedThreadId ??
        extractId(
          await cached.client.request(
            "thread/start",
            codexThreadStartParams({
              profile,
              projectConfig,
              cwd,
            }),
          ),
          [
            "threadId",
            "thread_id",
            "id",
            "thread.id",
          ],
          "thread id",
        );
      if (requestedThreadId) {
        await cached.client.request(
          "thread/resume",
          codexThreadResumeParams({
            profile,
            projectConfig,
            cwd,
            threadId: requestedThreadId,
          }),
        );
      }
      const turnResult = await cached.client.request(
        "turn/start",
        codexTurnStartParams({
          profile,
          projectConfig,
          cwd,
          threadId,
          prompt,
        }),
      );
      const turnId = extractId(turnResult, [
        "turnId",
        "turn_id",
        "id",
        "turn.id",
      ], "turn id");

      return {
        status: requestedThreadId ? "resumed" : "started",
        profileId: profile.id,
        threadId,
        turnId,
        cwd,
        model: profile.model,
        reasoning: profile.reasoning,
        threadPersistence: "durable",
      };
    } catch (error) {
      this.clients.delete(cacheKey);
      if (error instanceof NexusDashboardCodexChatError) {
        throw error;
      }
      throw new NexusDashboardCodexChatError(
        summarizeCodexAppServerJsonRpcFailure(error),
        502,
      );
    }
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(this.clients.values());
    this.clients.clear();
    await Promise.allSettled(
      clients.flatMap((entry) =>
        entry.status === "fulfilled" ? [entry.value.client.close()] : [],
      ),
    );
  }

  private cachedClient(
    key: string,
    input: NexusDashboardCodexChatClientFactoryInput,
  ): Promise<CachedCodexChatClient> {
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }
    const created = this.createClient(input);
    this.clients.set(key, created);
    return created;
  }

  private async createClient(
    input: NexusDashboardCodexChatClientFactoryInput,
  ): Promise<CachedCodexChatClient> {
    const client = await dashboardCodexChatClient(input, this.options);
    try {
      await client.request("initialize", {
        clientInfo: {
          name: "dev-nexus",
          title: "DevNexus cockpit",
          version: String(input.projectConfig.version),
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [],
        },
      });
    } catch (error) {
      try {
        await client.close();
      } catch {
        // Preserve the original initialize failure.
      }
      throw new NexusDashboardCodexChatError(
        summarizeCodexAppServerJsonRpcFailure(error),
        502,
      );
    }

    return {
      client,
      profile: input.profile,
      cwd: input.cwd,
    };
  }
}

async function dashboardCodexChatClient(
  input: NexusDashboardCodexChatClientFactoryInput,
  options: CreateNexusDashboardCodexChatStarterOptions,
): Promise<CodexAppServerJsonRpcClient> {
  if (options.clientFactory) {
    return options.clientFactory(input);
  }
  if (options.transportFactory) {
    return new CodexAppServerJsonRpcClient({
      transport: await options.transportFactory(input),
    });
  }

  const appServer = input.profile.appServer;
  if (!appServer) {
    throw new NexusDashboardCodexChatError(
      `Profile ${input.profile.id} does not configure Codex app-server policy`,
    );
  }
  if (appServer.mode === "spawn") {
    if (!appServer.command) {
      throw new NexusDashboardCodexChatError(
        `Profile ${input.profile.id} app-server command is required for spawn mode`,
      );
    }
    return new CodexAppServerJsonRpcClient({
      transport: createCodexAppServerStdioJsonRpcTransport({
        command: appServer.command,
        args: appServer.args,
        cwd: input.cwd,
        env: options.env,
      }),
    });
  }

  if (
    codexAppServerEndpointScope(appServer.endpoint) === "non_loopback" &&
    !appServer.localPolicy.allowNonLoopbackEndpoint
  ) {
    throw new NexusDashboardCodexChatError(
      "Codex app-server endpoint is non-loopback; host-local policy must explicitly allow it",
    );
  }
  if (!/^https?:\/\//iu.test(appServer.endpoint)) {
    throw new NexusDashboardCodexChatError(
      "Dashboard Codex chat connect mode currently supports http(s) app-server proxy endpoints only; use spawn mode until ws:// or unix:// transport is implemented.",
    );
  }

  return new CodexAppServerJsonRpcClient({
    transport: createCodexAppServerHttpJsonRpcTransport({
      endpoint: appServer.endpoint,
    }),
  });
}

function resolveCodexAppServerProfile(
  projectConfig: NexusProjectConfig,
  profileId: string | null | undefined,
): NexusAutomationAgentProfilePolicy {
  if (!projectConfig.automation) {
    throw new NexusDashboardCodexChatError(
      "Workspace automation is not configured",
    );
  }
  const policy = normalizeNexusAutomationAgentPolicy(projectConfig.automation);
  const requestedProfile = profileId
    ? policy.profiles.find((profile) => profile.id === profileId)
    : null;
  const profile =
    requestedProfile ??
    (policy.coordinatorProfile?.executorMode === "app_server"
      ? policy.coordinatorProfile
      : null) ??
    policy.profiles.find((candidate) =>
      candidate.executor.toLowerCase() === "codex" &&
      candidate.executorMode === "app_server" &&
      candidate.appServer
    );
  if (!profile) {
    throw new NexusDashboardCodexChatError(
      "No Codex app-server profile is configured. Add an automation agent profile with executorMode app_server before starting chats from the cockpit.",
    );
  }
  if (profile.executor.toLowerCase() !== "codex" || !profile.appServer) {
    throw new NexusDashboardCodexChatError(
      `Profile ${profile.id} must use executor codex and configure appServer policy`,
    );
  }

  return profile;
}

function codexThreadStartParams(options: {
  profile: NexusAutomationAgentProfilePolicy;
  projectConfig: NexusProjectConfig;
  cwd: string;
}): Record<string, unknown> {
  return compactRecord({
    ephemeral: false,
    cwd: options.cwd,
    model: options.profile.model ?? undefined,
    approvalPolicy: codexApprovalPolicy(options.profile) ?? undefined,
    sandbox: codexSandboxMode(options.profile) ?? undefined,
    threadSource: "user",
    config: codexMcpConfig(options.projectConfig),
  });
}

function codexThreadResumeParams(options: {
  profile: NexusAutomationAgentProfilePolicy;
  projectConfig: NexusProjectConfig;
  cwd: string;
  threadId: string;
}): Record<string, unknown> {
  return compactRecord({
    threadId: options.threadId,
    cwd: options.cwd,
    model: options.profile.model ?? undefined,
    approvalPolicy: codexApprovalPolicy(options.profile) ?? undefined,
    sandbox: codexSandboxMode(options.profile) ?? undefined,
    config: codexMcpConfig(options.projectConfig),
  });
}

function codexTurnStartParams(options: {
  profile: NexusAutomationAgentProfilePolicy;
  projectConfig: NexusProjectConfig;
  cwd: string;
  threadId: string;
  prompt: string;
}): Record<string, unknown> {
  return compactRecord({
    threadId: options.threadId,
    input: [
      {
        type: "text",
        text: options.prompt,
        text_elements: [],
      },
    ],
    cwd: options.cwd,
    model: options.profile.model ?? undefined,
    effort: options.profile.reasoning ?? undefined,
    approvalPolicy: codexApprovalPolicy(options.profile) ?? undefined,
  });
}

function codexMcpConfig(projectConfig: NexusProjectConfig): Record<string, unknown> | undefined {
  const defaultToolsApprovalMode =
    projectConfig.mcp?.agentTargets?.find((target) => {
      const provider = (target.provider ?? target.agent).toLowerCase();
      return target.enabled !== false &&
        provider === "codex" &&
        target.defaultToolsApprovalMode;
    })?.defaultToolsApprovalMode ??
    projectConfig.mcp?.defaultToolsApprovalMode;

  return defaultToolsApprovalMode
    ? { mcp: { defaultToolsApprovalMode } }
    : undefined;
}

function codexApprovalPolicy(
  profile: NexusAutomationAgentProfilePolicy,
): string | null {
  return codexProfileConfigValue(profile.args, "approval_policy") ??
    codexProfileOptionValue(profile.args, "--approval-policy") ??
    codexProfileOptionValue(profile.args, "--ask-for-approval") ??
    codexProfileOptionValue(profile.args, "-a");
}

function codexSandboxMode(
  profile: NexusAutomationAgentProfilePolicy,
): string | null {
  return codexProfileOptionValue(profile.args, "--sandbox") ??
    codexProfileOptionValue(profile.args, "-s") ??
    codexProfileConfigValue(profile.args, "sandbox_mode") ??
    codexProfileConfigValue(profile.args, "sandbox");
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

function extractId(
  value: unknown,
  paths: readonly string[],
  name: string,
): string {
  for (const path of paths) {
    const candidate = valueAtPath(value, path);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  throw new NexusDashboardCodexChatError(
    `Codex app-server response did not include ${name}`,
    502,
  );
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusDashboardCodexChatError(`${name} must be a non-empty string`, 400);
  }

  return value.trim();
}

function optionalNonEmptyString(
  value: unknown,
  name: string,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusDashboardCodexChatError(`${name} must be a string`, 400);
  }

  return value.trim();
}
