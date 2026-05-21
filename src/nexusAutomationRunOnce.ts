import fs from "node:fs";
import path from "node:path";
import {
  prepareGitWorktree,
  safeDirectoryName,
  type GitRunner,
  type PrepareGitWorktreeResult,
} from "./gitWorktreeService.js";
import {
  acquireNexusAutomationRunLock,
  appendNexusAutomationRunRecord,
  buildNexusAutomationWorkItemQuery,
  evaluateNexusAutomationLedgerBackoff,
  readNexusAutomationRunLedger,
  releaseNexusAutomationRunLock,
  selectNexusAutomationWorkItem,
  type AcquireNexusAutomationRunLockResult,
  type NexusAutomationRunLedger,
  type NexusAutomationRunStatus,
} from "./nexusAutomation.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  materializeNexusAutomationWorktreeSetup,
  preflightNexusAutomationWorktreeSetup,
  type NexusAutomationPluginDependencyProjection,
  type NexusAutomationWorktreeSetupResult,
} from "./nexusAutomationWorktreeSetup.js";
import {
  activeNexusProjectAgentProviders,
  activeNexusProjectSkillAgentTargets,
  loadProjectConfig,
  normalizeNexusProjectAgentTargets,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  projectPluginDependencyProjections,
  projectPluginWorkerFragments,
} from "./nexusPluginCapabilities.js";
import {
  getNexusPublicationStatus,
  publicationPolicyRequiresGuard,
  publicationPreflightChecks,
  resolveNexusPublicationPolicy,
  type NexusPublicationActorRunner,
} from "./nexusPublicationPolicy.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  applyWorktreeExecutionUpdate,
  emptyWorktreeExecutionMetadata,
  writeWorktreeExecutionMetadata,
  worktreeOwnershipMetadataFromPreparedWorktree,
  type WorktreeExecutionMetadata,
  type WorktreeOwnershipMetadata,
  type WorktreePublicationDecisionInput,
  type WorktreeVerificationInput,
} from "./worktreeExecutionMetadata.js";
import {
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import {
  automationWorkTrackerProviderOptions,
} from "./nexusAutomationWorkTrackingCredentials.js";
import type {
  WorkComment,
  WorkItem,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export type NexusAutomationExecutorStatus =
  | "completed"
  | "failed"
  | "blocked";

export interface NexusAutomationExecutorInput {
  runId: string;
  startedAt: string;
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  workItem: WorkItem;
  worktree: PrepareGitWorktreeResult;
  setup: NexusAutomationWorktreeSetupResult;
}

export interface NexusAutomationExecutorResult {
  status?: NexusAutomationExecutorStatus;
  summary?: string | null;
  commitIds?: string[];
  verification?: WorktreeVerificationInput[];
  publicationDecision?: WorktreePublicationDecisionInput;
  error?: string | null;
}

export type NexusAutomationExecutor = (
  input: NexusAutomationExecutorInput,
) => NexusAutomationExecutorResult | Promise<NexusAutomationExecutorResult>;

export interface NexusAutomationProviderContext {
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  component?: ResolvedNexusProjectComponent;
  workTracking: WorkTrackingConfig;
}

export type NexusAutomationWorkTrackerProviderFactory = (
  context: NexusAutomationProviderContext,
) => WorkTrackerProvider | Promise<WorkTrackerProvider>;

export type NexusAutomationPreflightStatus = "passed" | "failed";

export interface NexusAutomationPreflightCheck {
  name: string;
  status: NexusAutomationPreflightStatus;
  message: string;
}

export interface RunNexusAutomationOnceOptions {
  projectRoot: string;
  homePath?: string;
  runId?: string;
  owner?: string | null;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string | null;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  publicationActorRunner?: NexusPublicationActorRunner;
  now?: () => Date | string;
  executor: NexusAutomationExecutor;
}

export interface RunNexusAutomationOnceResult {
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
  workItem: WorkItem | null;
  worktree: PrepareGitWorktreeResult | null;
  setup: NexusAutomationWorktreeSetupResult | null;
  execution: WorktreeExecutionMetadata | null;
  comments: WorkComment[];
  updatedWorkItem: WorkItem | null;
}

export class NexusAutomationRunOnceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationRunOnceError";
  }
}

export async function runNexusAutomationOnce(
  options: RunNexusAutomationOnceOptions,
): Promise<RunNexusAutomationOnceResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const runId = options.runId ?? generateNexusAutomationRunId(options.now);
  const comments: WorkComment[] = [];
  let sourceRoot: string | null = null;
  let lock: AcquireNexusAutomationRunLockResult | null = null;
  let workItem: WorkItem | null = null;
  let updatedWorkItem: WorkItem | null = null;
  let worktree: PrepareGitWorktreeResult | null = null;
  let setup: NexusAutomationWorktreeSetupResult | null = null;
  let ledger: NexusAutomationRunLedger | null = null;
  let provider: WorkTrackerProvider | null = null;
  let primaryComponent: ResolvedNexusProjectComponent | null = null;
  let preflight: NexusAutomationPreflightCheck[] = [];
  let pluginDependencyProjections: NexusAutomationPluginDependencyProjection[] =
    [];

  if (!automationConfig?.enabled) {
    return {
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "skipped",
      summary: "Automation is not enabled for this workspace",
      ledger,
      lock,
      preflight: [],
      workItem,
      worktree,
      setup,
      execution: null,
      comments,
      updatedWorkItem,
    };
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
      return runResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
        summary,
        ledger,
        lock,
        preflight: [],
        workItem,
        worktree,
        setup,
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    primaryComponent = resolvePrimaryProjectComponent(projectRoot, projectConfig);
    sourceRoot = primaryComponent.sourceRoot;
    if (!primaryComponent.workTracking) {
      const summary = "Primary component work tracking is not configured";
      preflight = [
        check(
          "workTracking",
          false,
          "Primary component has work tracking configured",
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
          componentId: primaryComponent.id,
          status: "blocked",
          startedAt,
          finishedAt: startedAt,
          sourceRoot,
          summary,
          error: summary,
        },
      });
      return runResult({
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
        workItem,
        worktree,
        setup,
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    pluginDependencyProjections = automationPluginDependencyProjections(
      projectRoot,
      projectConfig,
      primaryComponent.id,
    );
    provider = await createAutomationProvider({
      options,
      projectRoot,
      sourceRoot,
      projectConfig,
      component: primaryComponent,
    });
    preflight = preflightNexusAutomationRunOnce({
      projectRoot,
      sourceRoot,
      projectConfig,
      component: primaryComponent,
      automationConfig,
      provider,
      pluginDependencyProjections,
      homePath: options.homePath,
      gitRunner: options.gitRunner,
      publicationActorRunner: options.publicationActorRunner,
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
          componentId: primaryComponent.id,
          status: "blocked",
          startedAt,
          finishedAt: startedAt,
          sourceRoot,
          summary,
          error: summary,
        },
      });
      return runResult({
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
        workItem,
        worktree,
        setup,
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    const candidates = await provider.listWorkItems({
      ...buildNexusAutomationWorkItemQuery(automationConfig),
      projectRoot,
    });
    workItem = selectNexusAutomationWorkItem(candidates, automationConfig) ?? null;
    if (!workItem) {
      const summary = "No eligible work item matched the automation selector";
      const finishedAt = currentIso(options.now);
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: finishedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          componentId: primaryComponent.id,
          status: "skipped",
          startedAt,
          finishedAt,
          sourceRoot,
          summary,
        },
      });
      return runResult({
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
        workItem,
        worktree,
        setup,
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    const baseRef =
      options.baseRef ??
      primaryComponent.defaultBranch ??
      projectConfig.repo.defaultBranch ??
      null;
    const branchName =
      options.branchName ?? defaultAutomationBranchName(projectConfig.id, workItem.id, runId);
    worktree = prepareGitWorktree({
      componentId: primaryComponent.id,
      sourceRoot,
      worktreesRoot: primaryComponent.worktreesRoot,
      branchName,
      ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
      ...(baseRef ? { baseRef } : {}),
      workItemId: workItem.id,
      workItemTitle: workItem.title,
      ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
    });
    const normalizedAgentTargets =
      normalizeNexusProjectAgentTargets(projectConfig);
    const activeAgentProviders = activeNexusProjectAgentProviders(projectConfig);
    const assignedAgentProvider =
      activeAgentProviders.length === 1 ? activeAgentProviders[0]! : null;
    setup = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot: primaryComponent.worktreesRoot,
      worktreePath: worktree.worktreePath,
      automationConfig,
      pluginDependencyProjections,
      skillsConfig: projectConfig.skills,
      skillAgentTargets: activeNexusProjectSkillAgentTargets(projectConfig),
      context: {
        project: {
          id: projectConfig.id,
          name: projectConfig.name,
          root: projectRoot,
        },
        ownership: {
          componentId: worktree.componentId,
          sourceRoot: worktree.sourceRoot,
          worktreesRoot: worktree.worktreesRoot,
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
          baseRef: worktree.baseRef,
          workItem,
        },
        agentTargetPolicy: {
          explicit: normalizedAgentTargets.explicit,
          activeProviders: activeAgentProviders,
          assignedProvider: assignedAgentProvider,
          recommendations: normalizedAgentTargets.recommendations,
          warnings:
            assignedAgentProvider === null && activeAgentProviders.length > 1
              ? [
                  "No assigned worker provider was selected; worktree setup includes all active provider projections.",
                ]
              : [],
        },
        pluginFragments: projectPluginWorkerFragments(projectConfig, {
          componentId: primaryComponent.id,
          ...(assignedAgentProvider
            ? { agent: assignedAgentProvider }
            : { activeAgents: activeAgentProviders }),
        }),
        publication: resolveNexusPublicationPolicy(
          projectConfig,
          primaryComponent,
        ),
      },
      ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
    });

    updatedWorkItem = await setTrackerStatus(provider, workItem, "in_progress");
    comments.push(
      await provider.addComment(
        workItemRef(workItem),
        startedTrackerComment(runId, worktree),
      ),
    );

    const executorResult = await options.executor({
      runId,
      startedAt,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      workItem,
      worktree,
      setup,
    });
    const finishedAt = currentIso(options.now);
    const execution = executionMetadataFromExecutorResult(
      executorResult,
      finishedAt,
      worktree,
    );
    writeWorktreeExecutionMetadata(worktree.worktreePath, execution);
    const status = normalizeExecutorStatus(executorResult.status);

    if (status === "completed") {
      updatedWorkItem = await setTrackerStatus(provider, workItem, "done");
    } else if (status === "blocked") {
      updatedWorkItem = await setTrackerStatus(provider, workItem, "blocked");
    }

    const summary = executorResult.summary ?? defaultRunSummary(status);
    comments.push(
      await provider.addComment(
        workItemRef(workItem),
        finishedTrackerComment(runId, status, summary),
      ),
    );
    ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config: automationConfig,
      now: finishedAt,
      record: {
        id: runId,
        projectId: projectConfig.id,
        componentId: primaryComponent.id,
        status,
        startedAt,
        finishedAt,
        workItemId: workItem.id,
        workItemTitle: workItem.title,
        sourceRoot,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseRef: worktree.baseRef,
        commitIds: execution.commitIds,
        summary,
        verification: execution.verification,
        publicationDecision: execution.publicationDecision,
        error: executorResult.error ?? null,
      },
    });

    return runResult({
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
      workItem,
      worktree,
      setup,
      execution,
      comments,
      updatedWorkItem,
    });
  } catch (error) {
    if (!automationConfig) {
      throw error;
    }

    const finishedAt = currentIso(options.now);
    const summary = errorMessage(error);
    await tryAddFailureComment(provider ?? undefined, workItem, runId, summary);
    ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config: automationConfig,
      now: finishedAt,
      record: {
        id: runId,
        projectId: projectConfig.id,
        componentId: primaryComponent?.id ?? null,
        status: "failed",
        startedAt,
        finishedAt,
        workItemId: workItem?.id ?? null,
        workItemTitle: workItem?.title ?? null,
        sourceRoot,
        worktreePath: worktree?.worktreePath ?? null,
        branchName: worktree?.branchName ?? null,
        baseRef: worktree?.baseRef ?? null,
        summary,
        error: summary,
      },
    });

    return runResult({
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
      workItem,
      worktree,
      setup,
      execution: null,
      comments,
      updatedWorkItem,
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

export function preflightNexusAutomationRunOnce(options: {
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  automationConfig: NexusAutomationConfig;
  provider: WorkTrackerProvider;
  pluginDependencyProjections?: NexusAutomationPluginDependencyProjection[];
  homePath?: string;
  gitRunner?: GitRunner;
  publicationActorRunner?: NexusPublicationActorRunner;
}): NexusAutomationPreflightCheck[] {
  const worktreesRoot = options.component.worktreesRoot;
  const publicationPolicy = resolveNexusPublicationPolicy(
    options.projectConfig,
    options.component,
  );
  const publicationAction =
    options.provider.provider === "local" ? "status" : "provider_write";
  const publicationChecks = publicationPolicyRequiresGuard(
    publicationPolicy,
    publicationAction,
  )
    ? publicationPreflightChecks([
        getNexusPublicationStatus({
          projectRoot: options.projectRoot,
          projectConfig: options.projectConfig,
          component: options.component,
          action: publicationAction,
          homePath: options.homePath,
          gitRunner: options.gitRunner,
          actorRunner: options.publicationActorRunner,
        }),
      ])
    : [];

  return [
    check(
      "workTracking",
      Boolean(options.component.workTracking),
      "Primary component has work tracking configured",
      "Primary component work tracking is not configured",
    ),
    check(
      "trackerListItems",
      options.provider.capabilities.listItems,
      "Tracker can list work items",
      `Tracker provider ${options.provider.provider} cannot list work items`,
    ),
    check(
      "trackerUpdateItems",
      options.provider.capabilities.updateItem,
      "Tracker can update work items",
      `Tracker provider ${options.provider.provider} cannot update work items`,
    ),
    check(
      "trackerComments",
      options.provider.capabilities.comment,
      "Tracker can record run comments",
      `Tracker provider ${options.provider.provider} cannot record comments`,
    ),
    check(
      "gitRepository",
      options.component.kind === "git",
      "Primary component source is Git-backed",
      "Automation worktree preparation requires the primary component to be Git-backed",
    ),
    check(
      "sourceRoot",
      fs.existsSync(options.sourceRoot) && fs.statSync(options.sourceRoot).isDirectory(),
      "Primary component source root exists",
      `Primary component source root does not exist: ${options.sourceRoot}`,
    ),
    check(
      "worktreesRoot",
      pathIsInside(options.projectRoot, worktreesRoot),
      "Workspace worktrees root stays inside the workspace root",
      `Automation worktreesRoot must resolve inside the workspace root: ${worktreesRoot}`,
    ),
    ...preflightNexusAutomationWorktreeSetup({
      sourceRoot: options.sourceRoot,
      worktreesRoot: options.component.worktreesRoot,
      automationConfig: options.automationConfig,
      pluginDependencyProjections: options.pluginDependencyProjections,
    }),
    ...publicationChecks,
  ];
}

function automationPluginDependencyProjections(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string,
): NexusAutomationPluginDependencyProjection[] {
  const componentsById = new Map(
    resolveProjectComponents(projectRoot, projectConfig).map((component) => [
      component.id,
      component,
    ]),
  );

  return projectPluginDependencyProjections(projectConfig, {
    componentId,
    activeAgents: activeNexusProjectAgentProviders(projectConfig),
  }).map((projection) => {
    const sourceComponent = projection.sourceComponentId
      ? componentsById.get(projection.sourceComponentId)
      : null;
    if (projection.sourceComponentId && !sourceComponent) {
      throw new NexusAutomationRunOnceError(
        `Plugin dependency projection ${projection.id} sourceComponentId references unknown component: ${projection.sourceComponentId}`,
      );
    }

    return {
      id: projection.id,
      ...(sourceComponent
        ? {
            sourceComponent: {
              id: sourceComponent.id,
              sourceRoot: sourceComponent.sourceRoot,
            },
          }
        : {}),
      source: projection.source,
      target: projection.target,
      required: projection.required,
      sourceControl: projection.sourceControl,
      reason: projection.reason,
      sourceMetadata: {
        pluginId: projection.pluginSource.pluginId,
        pluginName: projection.pluginSource.pluginName,
        version: projection.pluginSource.version,
        capabilityId: projection.pluginSource.capabilityId,
      },
    };
  });
}

export function generateNexusAutomationRunId(
  now?: () => Date | string,
): string {
  const timestamp = currentIso(now)
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "-");
  const suffix = Math.random().toString(36).slice(2, 8);

  return `run-${timestamp}-${suffix}`;
}

async function createAutomationProvider(options: {
  options: RunNexusAutomationOnceOptions;
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): Promise<WorkTrackerProvider> {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationRunOnceError(
      "Primary component work tracking is not configured",
    );
  }
  if (options.options.provider) {
    return options.options.provider;
  }
  if (options.options.providerFactory) {
    return options.options.providerFactory({
      projectRoot: options.projectRoot,
      sourceRoot: options.sourceRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      workTracking,
    });
  }

  return createWorkTrackerProviderAsync(workTracking, {
    ...automationWorkTrackerProviderOptions({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      baseOptions: options.options.providerOptions,
      homePath: options.options.homePath,
      now: options.options.now,
    }),
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

function executionMetadataFromExecutorResult(
  result: NexusAutomationExecutorResult,
  finishedAt: string,
  worktree: PrepareGitWorktreeResult,
): WorktreeExecutionMetadata {
  let metadata = emptyWorktreeExecutionMetadata();
  const verification = result.verification ?? [];
  const initialUpdate = {
    worktree: worktreeOwnershipMetadataFromPreparedWorktree(worktree),
    ...(result.commitIds?.length ? { commitIds: result.commitIds } : {}),
    ...(result.publicationDecision
      ? { publicationDecision: result.publicationDecision }
      : {}),
    ...(verification[0] ? { verification: verification[0] } : {}),
  };

  if (hasExecutionUpdate(initialUpdate)) {
    metadata = applyWorktreeExecutionUpdate(metadata, initialUpdate, finishedAt);
  }
  for (const verificationRecord of verification.slice(1)) {
    metadata = applyWorktreeExecutionUpdate(
      metadata,
      { verification: verificationRecord },
      finishedAt,
    );
  }

  return metadata;
}

function hasExecutionUpdate(update: {
  worktree?: WorktreeOwnershipMetadata | null;
  commitIds?: string[];
  verification?: WorktreeVerificationInput;
  publicationDecision?: WorktreePublicationDecisionInput;
}): boolean {
  return Boolean(
    Object.prototype.hasOwnProperty.call(update, "worktree") ||
      update.commitIds?.length ||
      update.verification ||
      update.publicationDecision,
  );
}

async function setTrackerStatus(
  provider: WorkTrackerProvider,
  item: WorkItem,
  status: WorkStatus,
): Promise<WorkItem> {
  if (provider.setStatus) {
    return provider.setStatus(workItemRef(item), status);
  }

  return provider.updateWorkItem(workItemRef(item), { status });
}

async function tryAddFailureComment(
  provider: WorkTrackerProvider | undefined,
  item: WorkItem | null,
  runId: string,
  summary: string,
): Promise<void> {
  if (!provider || !item || !provider.capabilities.comment) {
    return;
  }

  try {
    await provider.addComment(
      workItemRef(item),
      finishedTrackerComment(runId, "failed", summary),
    );
  } catch {
    // Failure recording must not be masked by a best-effort tracker comment.
  }
}

function workItemRef(item: WorkItem): WorkItemRef {
  return {
    id: item.id,
    provider: item.provider,
    ...(item.externalRef ? { externalRef: item.externalRef } : {}),
  };
}

function startedTrackerComment(
  runId: string,
  worktree: PrepareGitWorktreeResult,
): string {
  return [
    `DevNexus automation run ${runId} started.`,
    `Worktree: ${worktree.worktreePath}`,
    `Branch: ${worktree.branchName}`,
  ].join("\n");
}

function finishedTrackerComment(
  runId: string,
  status: NexusAutomationExecutorStatus,
  summary: string,
): string {
  return [
    `DevNexus automation run ${runId} ${status}.`,
    `Summary: ${summary}`,
  ].join("\n");
}

function normalizeExecutorStatus(
  status: NexusAutomationExecutorResult["status"],
): NexusAutomationExecutorStatus {
  return status ?? "completed";
}

function defaultRunSummary(status: NexusAutomationExecutorStatus): string {
  if (status === "completed") {
    return "Automation executor completed";
  }
  if (status === "blocked") {
    return "Automation executor reported a blocker";
  }

  return "Automation executor failed";
}

function defaultAutomationBranchName(
  projectId: string,
  workItemId: string,
  runId: string,
): string {
  return [
    "codex",
    safeDirectoryName(projectId),
    safeDirectoryName(workItemId),
    safeDirectoryName(runId),
  ].join("/");
}

function check(
  name: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): NexusAutomationPreflightCheck {
  return {
    name,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : failedMessage,
  };
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function runResult(
  result: RunNexusAutomationOnceResult,
): RunNexusAutomationOnceResult {
  return result;
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationRunOnceError("now must return a valid date");
  }

  return date.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationRunOnceError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
