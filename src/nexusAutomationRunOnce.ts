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
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { resolveProjectSourceRoot } from "./nexusProjectLifecycle.js";
import {
  applyWorktreeExecutionUpdate,
  emptyWorktreeExecutionMetadata,
  writeWorktreeExecutionMetadata,
  type WorktreeExecutionMetadata,
  type WorktreePublicationDecisionInput,
  type WorktreeVerificationInput,
} from "./worktreeExecutionMetadata.js";
import {
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
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
  workTracking: WorkTrackingConfig;
}

export type NexusAutomationWorkTrackerProviderFactory = (
  context: NexusAutomationProviderContext,
) => WorkTrackerProvider;

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
  let ledger: NexusAutomationRunLedger | null = null;
  let provider: WorkTrackerProvider | null = null;
  let preflight: NexusAutomationPreflightCheck[] = [];

  if (!automationConfig?.enabled) {
    return {
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
      workItem,
      worktree,
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
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    sourceRoot = resolveProjectSourceRoot(projectRoot, projectConfig);
    if (!projectConfig.workTracking) {
      const summary = "Project work tracking is not configured";
      preflight = [
        check(
          "workTracking",
          false,
          "Project has work tracking configured",
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
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    provider = createAutomationProvider({
      options,
      projectRoot,
      sourceRoot,
      projectConfig,
    });
    preflight = preflightNexusAutomationRunOnce({
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      provider,
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
        execution: null,
        comments,
        updatedWorkItem,
      });
    }

    const baseRef = options.baseRef ?? projectConfig.repo.defaultBranch ?? null;
    const branchName =
      options.branchName ?? defaultAutomationBranchName(projectConfig.id, workItem.id, runId);
    worktree = prepareGitWorktree({
      sourceRoot,
      worktreesRoot: projectWorktreesRootPath(projectRoot, projectConfig),
      branchName,
      ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
      ...(baseRef ? { baseRef } : {}),
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
    });
    const finishedAt = currentIso(options.now);
    const execution = executionMetadataFromExecutorResult(
      executorResult,
      finishedAt,
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
  automationConfig: NexusAutomationConfig;
  provider: WorkTrackerProvider;
}): NexusAutomationPreflightCheck[] {
  const worktreesRoot = projectWorktreesRootPath(
    options.projectRoot,
    options.projectConfig,
  );

  return [
    check(
      "workTracking",
      Boolean(options.projectConfig.workTracking),
      "Project has work tracking configured",
      "Project work tracking is not configured",
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
      options.projectConfig.repo.kind === "git",
      "Project source is Git-backed",
      "Automation worktree preparation requires repo.kind to be git",
    ),
    check(
      "sourceRoot",
      fs.existsSync(options.sourceRoot) && fs.statSync(options.sourceRoot).isDirectory(),
      "Project source root exists",
      `Project source root does not exist: ${options.sourceRoot}`,
    ),
    check(
      "worktreesRoot",
      pathIsInside(options.projectRoot, worktreesRoot),
      "Project worktrees root stays inside the project root",
      `Automation worktreesRoot must resolve inside the project root: ${worktreesRoot}`,
    ),
  ];
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

function createAutomationProvider(options: {
  options: RunNexusAutomationOnceOptions;
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
}): WorkTrackerProvider {
  const workTracking = options.projectConfig.workTracking;
  if (!workTracking) {
    throw new NexusAutomationRunOnceError(
      "Project work tracking is not configured",
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
      workTracking,
    });
  }

  return createWorkTrackerProvider(workTracking, {
    ...options.options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

function executionMetadataFromExecutorResult(
  result: NexusAutomationExecutorResult,
  finishedAt: string,
): WorktreeExecutionMetadata {
  let metadata = emptyWorktreeExecutionMetadata();
  const verification = result.verification ?? [];
  const initialUpdate = {
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
  commitIds?: string[];
  verification?: WorktreeVerificationInput;
  publicationDecision?: WorktreePublicationDecisionInput;
}): boolean {
  return Boolean(
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
