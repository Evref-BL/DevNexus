import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  appendNexusAutomationRunRecord,
  buildNexusAutomationWorkItemQuery,
  eligibleNexusAutomationWorkItems,
  evaluateNexusAutomationLedgerBackoff,
  readNexusAutomationRunLedger,
  releaseNexusAutomationRunLock,
  acquireNexusAutomationRunLock,
  type AcquireNexusAutomationRunLockResult,
  type NexusAutomationRunLedger,
  type NexusAutomationRunStatus,
} from "./nexusAutomation.js";
import {
  defaultNexusAutomationCommandRunner,
  type NexusAutomationCommandRunner,
  type NexusAutomationCommandRunResult,
} from "./nexusAutomationCommandExecutor.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  readNexusAutomationTargetContext,
  type NexusAutomationTargetContext,
} from "./nexusAutomationTarget.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import type {
  NexusAutomationPreflightCheck,
  NexusAutomationProviderContext,
  NexusAutomationPreflightStatus,
  NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import {
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import type {
  WorkItem,
  WorkItemQuery,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";
import type {
  WorktreePublicationDecisionInput,
  WorktreeVerificationInput,
  WorktreeVerificationStatus,
} from "./worktreeExecutionMetadata.js";

export type NexusAutomationAgentLaunchStatus =
  | "completed"
  | "failed"
  | "blocked";

export interface NexusAutomationAgentLaunchComponentContext {
  id: string;
  name: string;
  role: ResolvedNexusProjectComponent["role"];
  kind: ResolvedNexusProjectComponent["kind"];
  sourceRoot: string;
  sourceRootExists: boolean;
  worktreesRoot: string;
  worktreesRootExists: boolean;
  remoteUrl: string | null;
  defaultBranch: string | null;
  workTracker: {
    provider: string | null;
    configured: boolean;
  };
  relationships: ResolvedNexusProjectComponent["relationships"];
}

export interface NexusAutomationComponentEligibleWorkItems {
  componentId: string;
  workItems: WorkItem[];
}

export interface NexusAutomationAgentLaunchContext {
  version: 1;
  runId: string;
  startedAt: string;
  projectRoot: string;
  sourceRoot: string;
  project: {
    id: string;
    name: string;
    componentCount: number;
  };
  components: NexusAutomationAgentLaunchComponentContext[];
  automation: {
    mode: "agent_launch";
    selectorQuery: WorkItemQuery;
    eligibleWorkItemCount: number;
  };
  target: NexusAutomationTargetContext;
  agent: {
    maxConcurrentSubagents: number;
    profiles: NexusAutomationConfig["agent"]["profiles"];
  };
  eligibleWorkItems: WorkItem[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  safety: NexusAutomationConfig["safety"];
  publication: NexusAutomationConfig["publication"];
}

export interface NexusAutomationAgentLaunchInput {
  runId: string;
  startedAt: string;
  projectRoot: string;
  sourceRoot: string;
  components: ResolvedNexusProjectComponent[];
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  selectorQuery: WorkItemQuery;
  eligibleWorkItems: WorkItem[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  contextFile: string;
  resultFile: string;
}

export interface NexusAutomationAgentLaunchResult {
  status?: NexusAutomationAgentLaunchStatus;
  summary?: string | null;
  commitIds?: string[];
  verification?: WorktreeVerificationInput[];
  publicationDecision?: WorktreePublicationDecisionInput;
  error?: string | null;
}

export type NexusAutomationAgentLauncher = (
  input: NexusAutomationAgentLaunchInput,
) =>
  | NexusAutomationAgentLaunchResult
  | Promise<NexusAutomationAgentLaunchResult>;

export interface CreateNexusAutomationAgentCommandLauncherOptions {
  command: string;
  commandRunner?: NexusAutomationCommandRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface RunNexusAutomationAgentLaunchOnceOptions {
  projectRoot: string;
  homePath?: string;
  runId?: string;
  owner?: string | null;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  now?: () => Date | string;
  launcher: NexusAutomationAgentLauncher;
}

export interface RunNexusAutomationAgentLaunchOnceResult {
  runId: string;
  projectRoot: string;
  sourceRoot: string | null;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig | null;
  status: NexusAutomationRunStatus;
  summary: string;
  ledger: NexusAutomationRunLedger | null;
  lock: AcquireNexusAutomationRunLockResult | null;
  preflight: NexusAutomationPreflightCheck[];
  selectorQuery: WorkItemQuery | null;
  eligibleWorkItems: WorkItem[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  components: ResolvedNexusProjectComponent[];
  contextFile: string | null;
  resultFile: string | null;
  launch: NexusAutomationAgentLaunchResult | null;
}

export interface NexusAutomationAgentLaunchComponentProvider {
  component: ResolvedNexusProjectComponent;
  provider: WorkTrackerProvider;
}

export class NexusAutomationAgentLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationAgentLaunchError";
  }
}

export async function runNexusAutomationAgentLaunchOnce(
  options: RunNexusAutomationAgentLaunchOnceOptions,
): Promise<RunNexusAutomationAgentLaunchOnceResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const runId = options.runId ?? generateNexusAutomationAgentRunId(options.now);
  let sourceRoot: string | null = null;
  let components: ResolvedNexusProjectComponent[] = [];
  let lock: AcquireNexusAutomationRunLockResult | null = null;
  let ledger: NexusAutomationRunLedger | null = null;
  let componentProviders: NexusAutomationAgentLaunchComponentProvider[] = [];
  let preflight: NexusAutomationPreflightCheck[] = [];
  let selectorQuery: WorkItemQuery | null = null;
  let eligibleWorkItems: WorkItem[] = [];
  let componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[] = [];
  let contextFile: string | null = null;
  let resultFile: string | null = null;

  if (!automationConfig?.enabled) {
    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "skipped",
      summary: "Automation is not enabled for this project",
      ledger,
      lock,
      preflight: [],
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: null,
    });
  }

  if (automationConfig.mode !== "agent_launch") {
    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "blocked",
      summary: "Automation mode is not agent_launch",
      ledger,
      lock,
      preflight: [],
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: null,
    });
  }

  const startedAt = currentIso(options.now);
  lock = acquireNexusAutomationRunLock({
    projectRoot,
    config: automationConfig,
    runId,
    owner: options.owner ?? null,
    now: startedAt,
  });

  try {
    ledger = readNexusAutomationRunLedger(projectRoot, automationConfig);
    const backoff = evaluateNexusAutomationLedgerBackoff(
      automationConfig,
      ledger,
      startedAt,
    );
    if (!backoff.shouldRun) {
      const summary = backoff.reason ?? "Automation retry backoff is active";
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: startedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "skipped",
          startedAt,
          finishedAt: startedAt,
          summary,
          nextRunNotBefore: backoff.retryAfter,
        },
      });
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        launch: null,
      });
    }

    components = resolveProjectComponents(projectRoot, projectConfig);
    sourceRoot = resolvePrimaryProjectComponent(projectRoot, projectConfig).sourceRoot;
    componentProviders = createAgentLaunchComponentProviders({
      options,
      projectRoot,
      projectConfig,
      components,
    });
    if (componentProviders.length === 0) {
      const summary = "No project component has work tracking configured";
      preflight = [
        check(
          "workTracking",
          false,
          "At least one component has work tracking configured",
          summary,
        ),
      ];
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: startedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "blocked",
          startedAt,
          finishedAt: startedAt,
          sourceRoot,
          summary,
          error: summary,
        },
      });
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        launch: null,
      });
    }

    preflight = preflightNexusAutomationAgentLaunch({
      components,
      componentProviders,
    });
    const failedChecks = preflight.filter((check) => check.status === "failed");
    if (failedChecks.length > 0) {
      const summary = failedChecks.map((check) => check.message).join("; ");
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: startedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "blocked",
          startedAt,
          finishedAt: startedAt,
          sourceRoot,
          summary,
          error: summary,
        },
      });
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        launch: null,
      });
    }

    selectorQuery = buildNexusAutomationWorkItemQuery(automationConfig);
    componentEligibleWorkItems = await listEligibleWorkItemsByComponent(
      componentProviders,
      selectorQuery,
      automationConfig,
      projectRoot,
    );
    eligibleWorkItems = componentEligibleWorkItems.flatMap(
      (component) => component.workItems,
    );
    if (eligibleWorkItems.length === 0) {
      const summary = "No eligible work item matched the automation selector";
      const finishedAt = currentIso(options.now);
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: finishedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "skipped",
          startedAt,
          finishedAt,
          sourceRoot,
          summary,
        },
      });
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        launch: null,
      });
    }

    const launchFiles = writeNexusAutomationAgentLaunchContext({
      projectRoot,
      runId,
      context: buildAgentLaunchContext({
        runId,
        startedAt,
        projectRoot,
        sourceRoot,
        components,
        projectConfig,
        automationConfig,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
      }),
    });
    contextFile = launchFiles.contextFile;
    resultFile = launchFiles.resultFile;

    const agentResult = await options.launcher({
      runId,
      startedAt,
      projectRoot,
      sourceRoot,
      components,
      projectConfig,
      automationConfig,
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      contextFile,
      resultFile,
    });
    const status = normalizeAgentStatus(agentResult.status);
    const finishedAt = currentIso(options.now);
    const summary = agentResult.summary ?? defaultAgentSummary(status);
    ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config: automationConfig,
      now: finishedAt,
      record: {
        id: runId,
        projectId: projectConfig.id,
        status,
        startedAt,
        finishedAt,
        sourceRoot,
        commitIds: agentResult.commitIds ?? [],
        summary,
        verification: verificationRecords(agentResult.verification, finishedAt),
        publicationDecision: publicationDecisionRecord(
          agentResult.publicationDecision,
          finishedAt,
        ),
        error: agentResult.error ?? null,
      },
    });

    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status,
      summary,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: agentResult,
    });
  } catch (error) {
    if (!automationConfig) {
      throw error;
    }

    const finishedAt = currentIso(options.now);
    const summary = errorMessage(error);
    ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config: automationConfig,
      now: finishedAt,
      record: {
        id: runId,
        projectId: projectConfig.id,
        status: "failed",
        startedAt,
        finishedAt,
        sourceRoot,
        summary,
        error: summary,
      },
    });
    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "failed",
      summary,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: null,
    });
  } finally {
    if (automationConfig) {
      releaseNexusAutomationRunLock({
        projectRoot,
        config: automationConfig,
        runId,
      });
    }
  }
}

export function createNexusAutomationAgentCommandLauncher(
  options: CreateNexusAutomationAgentCommandLauncherOptions,
): NexusAutomationAgentLauncher {
  const command = requiredNonEmptyString(options.command, "command");
  const commandRunner = options.commandRunner ?? defaultNexusAutomationCommandRunner;

  return (input: NexusAutomationAgentLaunchInput): NexusAutomationAgentLaunchResult => {
    const commandResult = commandRunner(command, {
      cwd: input.projectRoot,
      env: agentLaunchEnvironment(options.env ?? process.env, input),
      timeoutMs: options.timeoutMs,
    });
    const commandVerification = verificationFromCommandResult(commandResult);
    const reported = readAgentResultFile(input.resultFile);

    if (reported.status === "failed") {
      return {
        status: "failed",
        summary: reported.summary,
        verification: [commandVerification],
        error: reported.error,
      };
    }

    const verification = [
      commandVerification,
      ...(reported.result?.verification ?? []),
    ];
    if (!commandSucceeded(commandResult)) {
      return {
        status: "failed",
        summary: `Agent command failed: ${commandSummary(commandResult)}`,
        verification,
        commitIds: reported.result?.commitIds ?? [],
        publicationDecision: reported.result?.publicationDecision,
        error: commandSummary(commandResult),
      };
    }

    const status = normalizeAgentStatus(reported.result?.status);
    return {
      status,
      summary: reported.result?.summary ?? defaultAgentSummary(status),
      verification,
      commitIds: reported.result?.commitIds ?? [],
      publicationDecision: reported.result?.publicationDecision,
      error: reported.result?.error ?? null,
    };
  };
}

export function preflightNexusAutomationAgentLaunch(options: {
  components: ResolvedNexusProjectComponent[];
  componentProviders: NexusAutomationAgentLaunchComponentProvider[];
}): NexusAutomationPreflightCheck[] {
  return [
    check(
      "workTracking",
      options.componentProviders.length > 0,
      "At least one component has work tracking configured",
      "No project component has work tracking configured",
    ),
    ...options.componentProviders.map(({ component, provider }) =>
      check(
        `component:${component.id}:trackerListItems`,
        provider.capabilities.listItems,
        `Component ${component.id} tracker can list work items`,
        `Component ${component.id} tracker provider ${provider.provider} cannot list work items`,
      ),
    ),
    ...options.components.map((component) =>
      check(
        `component:${component.id}:sourceRoot`,
        component.sourceRootExists,
        `Component ${component.id} source root exists`,
        `Component ${component.id} source root does not exist: ${component.sourceRoot}`,
      ),
    ),
  ];
}

export function generateNexusAutomationAgentRunId(
  now?: () => Date | string,
): string {
  const timestamp = currentIso(now)
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "-");
  const suffix = Math.random().toString(36).slice(2, 8);

  return `agent-${timestamp}-${suffix}`;
}

function createAgentLaunchComponentProviders(options: {
  options: RunNexusAutomationAgentLaunchOnceOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
}): NexusAutomationAgentLaunchComponentProvider[] {
  return options.components
    .filter((component) => component.workTracking)
    .map((component) => ({
      component,
      provider: createAgentLaunchProvider({
        options: options.options,
        projectRoot: options.projectRoot,
        projectConfig: options.projectConfig,
        component,
      }),
    }));
}

function createAgentLaunchProvider(options: {
  options: RunNexusAutomationAgentLaunchOnceOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): WorkTrackerProvider {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationAgentLaunchError(
      `Component ${options.component.id} work tracking is not configured`,
    );
  }
  if (options.options.provider) {
    return options.options.provider;
  }
  if (options.options.providerFactory) {
    return options.options.providerFactory({
      projectRoot: options.projectRoot,
      sourceRoot: options.component.sourceRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      workTracking,
    } satisfies NexusAutomationProviderContext);
  }

  return createWorkTrackerProvider(workTracking as WorkTrackingConfig, {
    ...options.options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

async function listEligibleWorkItemsByComponent(
  componentProviders: NexusAutomationAgentLaunchComponentProvider[],
  selectorQuery: WorkItemQuery,
  automationConfig: NexusAutomationConfig,
  projectRoot: string,
): Promise<NexusAutomationComponentEligibleWorkItems[]> {
  const grouped: NexusAutomationComponentEligibleWorkItems[] = [];
  for (const { component, provider } of componentProviders) {
    grouped.push({
      componentId: component.id,
      workItems: eligibleNexusAutomationWorkItems(
        await provider.listWorkItems({
          ...selectorQuery,
          projectRoot,
        }),
        automationConfig,
      ),
    });
  }

  return grouped;
}

function buildAgentLaunchContext(
  input: Omit<
    NexusAutomationAgentLaunchInput,
    "contextFile" | "resultFile"
  >,
): NexusAutomationAgentLaunchContext {
  return {
    version: 1,
    runId: input.runId,
    startedAt: input.startedAt,
    projectRoot: input.projectRoot,
    sourceRoot: input.sourceRoot,
    project: {
      id: input.projectConfig.id,
      name: input.projectConfig.name,
      componentCount: input.components.length,
    },
    components: input.components.map(componentContext),
    automation: {
      mode: "agent_launch",
      selectorQuery: input.selectorQuery,
      eligibleWorkItemCount: input.eligibleWorkItems.length,
    },
    target: readNexusAutomationTargetContext({
      projectRoot: input.projectRoot,
      config: input.automationConfig,
    }),
    agent: {
      maxConcurrentSubagents: input.automationConfig.agent.maxConcurrentSubagents,
      profiles: input.automationConfig.agent.profiles,
    },
    eligibleWorkItems: input.eligibleWorkItems,
    componentEligibleWorkItems: input.componentEligibleWorkItems,
    safety: input.automationConfig.safety,
    publication: input.automationConfig.publication,
  };
}

function componentContext(
  component: ResolvedNexusProjectComponent,
): NexusAutomationAgentLaunchComponentContext {
  return {
    id: component.id,
    name: component.name,
    role: component.role,
    kind: component.kind,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    worktreesRootExists: component.worktreesRootExists,
    remoteUrl: component.remoteUrl,
    defaultBranch: component.defaultBranch,
    workTracker: {
      provider: component.workTracking?.provider ?? null,
      configured: Boolean(component.workTracking),
    },
    relationships: component.relationships,
  };
}

function writeNexusAutomationAgentLaunchContext(options: {
  projectRoot: string;
  runId: string;
  context: NexusAutomationAgentLaunchContext;
}): { contextFile: string; resultFile: string } {
  const launchDir = path.join(
    options.projectRoot,
    ".dev-nexus",
    "automation",
    "agent-launches",
    safePathSegment(options.runId),
  );
  const contextFile = path.join(launchDir, "context.json");
  const resultFile = path.join(launchDir, "result.json");
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(
    contextFile,
    `${JSON.stringify(options.context, null, 2)}\n`,
    "utf8",
  );

  return { contextFile, resultFile };
}

function agentLaunchEnvironment(
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
    DEV_NEXUS_COMPONENT_COUNT: input.components.length.toString(),
    DEV_NEXUS_COMPONENT_IDS: input.components
      .map((component) => component.id)
      .join(","),
    DEV_NEXUS_PRIMARY_COMPONENT_ID:
      input.components.find((component) => component.role === "primary")?.id ??
      input.components[0]?.id ??
      "",
    DEV_NEXUS_AGENT_CONTEXT_FILE: input.contextFile,
    DEV_NEXUS_AGENT_RESULT_FILE: input.resultFile,
    DEV_NEXUS_TARGET_ID: input.automationConfig.target.id ?? "",
    DEV_NEXUS_TARGET_STATE_FILE: readNexusAutomationTargetContext({
      projectRoot: input.projectRoot,
      config: input.automationConfig,
    }).statePath,
    DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS:
      input.automationConfig.agent.maxConcurrentSubagents.toString(),
    DEV_NEXUS_ELIGIBLE_WORK_ITEM_COUNT: input.eligibleWorkItems.length.toString(),
    DEV_NEXUS_ELIGIBLE_WORK_ITEM_IDS: input.eligibleWorkItems
      .map((item) => item.id)
      .join(","),
  };
}

function readAgentResultFile(resultFile: string): {
  status: "missing" | "loaded" | "failed";
  summary?: string;
  error?: string;
  result?: NexusAutomationAgentLaunchResult;
} {
  if (!fs.existsSync(resultFile)) {
    return { status: "missing" };
  }

  try {
    return {
      status: "loaded",
      result: normalizeAgentResult(
        JSON.parse(fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, "")),
      ),
    };
  } catch (error) {
    const message = `Agent result file is invalid: ${errorMessage(error)}`;
    return {
      status: "failed",
      summary: message,
      error: message,
    };
  }
}

function normalizeAgentResult(value: unknown): NexusAutomationAgentLaunchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError("agent result must be an object");
  }

  const record = value as Record<string, unknown>;
  return {
    ...(record.status === undefined
      ? {}
      : { status: normalizeAgentStatus(record.status) }),
    ...(record.summary === undefined
      ? {}
      : { summary: optionalNullableString(record.summary) ?? null }),
    ...(record.commitIds === undefined
      ? {}
      : { commitIds: normalizeStringArray(record.commitIds, "agent result.commitIds") }),
    ...(record.verification === undefined
      ? {}
      : { verification: normalizeVerificationInputList(record.verification) }),
    ...(record.publicationDecision === undefined
      ? {}
      : {
          publicationDecision: normalizePublicationDecisionInput(
            record.publicationDecision,
          ),
        }),
    ...(record.error === undefined
      ? {}
      : { error: optionalNullableString(record.error) ?? null }),
  };
}

function normalizeVerificationInputList(
  value: unknown,
): WorktreeVerificationInput[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError(
      "agent result.verification must be an array",
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new NexusAutomationAgentLaunchError(
        `agent result.verification[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      command: requiredNonEmptyString(
        record.command,
        `agent result.verification[${index}].command`,
      ),
      ...(record.status === undefined
        ? {}
        : {
            status: normalizeVerificationStatus(
              record.status,
              `agent result.verification[${index}].status`,
            ),
          }),
      ...(record.summary === undefined
        ? {}
        : { summary: optionalNullableString(record.summary) ?? null }),
    };
  });
}

function normalizePublicationDecisionInput(
  value: unknown,
): WorktreePublicationDecisionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError(
      "agent result.publicationDecision must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    type: normalizePublicationDecisionType(
      record.type,
      "agent result.publicationDecision.type",
    ),
    targetBranch: optionalNullableString(record.targetBranch) ?? null,
    remote: optionalNullableString(record.remote) ?? null,
    prUrl: optionalNullableString(record.prUrl) ?? null,
    reason: optionalNullableString(record.reason) ?? null,
  };
}

function verificationRecords(
  values: WorktreeVerificationInput[] | undefined,
  recordedAt: string,
) {
  return (values ?? []).map((value) => ({
    command: requiredNonEmptyString(value.command, "verification.command"),
    status: value.status ?? "passed",
    summary: optionalNullableString(value.summary) ?? null,
    recordedAt,
  }));
}

function publicationDecisionRecord(
  value: WorktreePublicationDecisionInput | undefined,
  decidedAt: string,
) {
  if (!value) {
    return null;
  }

  return {
    type: value.type,
    targetBranch: value.targetBranch ?? null,
    remote: value.remote ?? null,
    prUrl: value.prUrl ?? null,
    reason: value.reason ?? null,
    decidedAt,
  };
}

function verificationFromCommandResult(
  result: NexusAutomationCommandRunResult,
): WorktreeVerificationInput {
  return {
    command: result.command,
    status: commandSucceeded(result) ? "passed" : "failed",
    summary: commandSummary(result),
  };
}

function commandSucceeded(result: NexusAutomationCommandRunResult): boolean {
  return result.exitCode === 0 && !result.error;
}

function commandSummary(result: NexusAutomationCommandRunResult): string {
  if (result.error) {
    return result.error;
  }

  const exit = result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
  const output = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout);
  return output ? `${exit}: ${truncate(output, 180)}` : exit;
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

function normalizeAgentStatus(
  status: unknown,
): NexusAutomationAgentLaunchStatus {
  if (status === undefined || status === null) {
    return "completed";
  }
  if (status === "completed" || status === "failed" || status === "blocked") {
    return status;
  }

  throw new NexusAutomationAgentLaunchError(
    "agent launch status must be completed, failed, or blocked",
  );
}

function normalizeVerificationStatus(
  status: unknown,
  name: string,
): WorktreeVerificationStatus {
  if (status === "passed" || status === "failed" || status === "not_run") {
    return status;
  }

  throw new NexusAutomationAgentLaunchError(
    `${name} must be passed, failed, or not_run`,
  );
}

function normalizePublicationDecisionType(
  value: unknown,
  name: string,
): WorktreePublicationDecisionInput["type"] {
  if (
    value === "not_decided" ||
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new NexusAutomationAgentLaunchError(
    `${name} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
  );
}

function check(
  name: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): NexusAutomationPreflightCheck {
  return {
    name,
    status: (passed ? "passed" : "failed") satisfies NexusAutomationPreflightStatus,
    message: passed ? passedMessage : failedMessage,
  };
}

type AgentLaunchResultInput = Omit<
  RunNexusAutomationAgentLaunchOnceResult,
  "componentEligibleWorkItems" | "components"
> &
  Partial<
    Pick<
      RunNexusAutomationAgentLaunchOnceResult,
      "componentEligibleWorkItems" | "components"
    >
  >;

function launchResult(
  result: AgentLaunchResultInput,
): RunNexusAutomationAgentLaunchOnceResult {
  return {
    ...result,
    componentEligibleWorkItems: result.componentEligibleWorkItems ?? [],
    components: result.components ?? [],
  };
}

function safePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new NexusAutomationAgentLaunchError(
      "runId must contain at least one safe character",
    );
  }

  return normalized;
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationAgentLaunchError("now must return a valid date");
  }

  return date.toISOString();
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${name}[${index}]`),
  );
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, "value");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationAgentLaunchError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
