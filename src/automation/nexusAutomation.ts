import fs from "node:fs";
import path from "node:path";
import type {
  NexusAutomationConfig,
  NexusAutomationSelectorConfig,
} from "./nexusAutomationConfig.js";
import type {
  WorkItem,
  WorkItemQuery,
} from "../work-items/workTrackingTypes.js";
import {
  normalizeWorktreeExecutionMetadata,
  type WorktreePublicationDecision,
  type WorktreeVerificationRecord,
} from "../worktrees/worktreeExecutionMetadata.js";
import type {
  NexusAutomationCodexAppServerGoalMetadata,
  NexusAutomationCodexAppServerGoalOperationStatus,
  NexusAutomationCodexAppServerLaunchMetadata,
  NexusAutomationProviderResultContractMetadata,
  NexusAutomationProviderResultContractResultStatus,
  NexusAutomationProviderResultContractStatus,
  NexusAutomationProviderSessionRecord,
  NexusAutomationProviderSessionStatus,
  NexusAutomationProviderTerminalStatus,
} from "./nexusAutomationAgentLaunchMetadata.js";
import { normalizeNexusCodexGoalsPolicyDecision } from "./nexusCodexGoalsPolicy.js";

export type NexusAutomationRunStatus =
  | "started"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export interface NexusAutomationRunRecord {
  id: string;
  projectId: string;
  componentId: string | null;
  status: NexusAutomationRunStatus;
  startedAt: string;
  finishedAt: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
  sourceRoot: string | null;
  worktreePath: string | null;
  branchName: string | null;
  baseRef: string | null;
  commitIds: string[];
  summary: string | null;
  verification: WorktreeVerificationRecord[];
  publicationDecision: WorktreePublicationDecision | null;
  error: string | null;
  codexAppServer: NexusAutomationCodexAppServerLaunchMetadata | null;
  providerSessions?: NexusAutomationProviderSessionRecord[];
  nextRunNotBefore: string | null;
}

export interface NexusAutomationRunRecordInput {
  id: string;
  projectId: string;
  componentId?: string | null;
  status: NexusAutomationRunStatus;
  startedAt?: string;
  finishedAt?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  sourceRoot?: string | null;
  worktreePath?: string | null;
  branchName?: string | null;
  baseRef?: string | null;
  commitIds?: string[];
  summary?: string | null;
  verification?: WorktreeVerificationRecord[];
  publicationDecision?: WorktreePublicationDecision | null;
  error?: string | null;
  codexAppServer?: NexusAutomationCodexAppServerLaunchMetadata | null;
  providerSessions?: NexusAutomationProviderSessionRecord[] | null;
  nextRunNotBefore?: string | null;
}

export interface NexusAutomationRunLedger {
  version: 1;
  runs: NexusAutomationRunRecord[];
  updatedAt: string | null;
}

export interface NexusAutomationRunLock {
  runId: string;
  owner: string | null;
  acquiredAt: string;
  expiresAt: string;
}

export interface AcquireNexusAutomationRunLockOptions {
  projectRoot: string;
  config: NexusAutomationConfig;
  runId: string;
  owner?: string | null;
  now?: Date | string;
}

export interface AcquireNexusAutomationRunLockResult {
  lockPath: string;
  lock: NexusAutomationRunLock;
  replacedStaleLock: boolean;
}

export interface ReleaseNexusAutomationRunLockOptions {
  projectRoot: string;
  config: NexusAutomationConfig;
  runId?: string;
}

export interface AppendNexusAutomationRunRecordOptions {
  projectRoot: string;
  config: NexusAutomationConfig;
  record: NexusAutomationRunRecordInput;
  now?: Date | string;
}

export interface NexusAutomationBackoffDecision {
  consecutiveFailures: number;
  shouldRun: boolean;
  retryAfter: string | null;
  delayMs: number | null;
  reason: string | null;
}

export class NexusAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationError";
  }
}

export function nexusAutomationLedgerPath(
  projectRoot: string,
  config: NexusAutomationConfig,
): string {
  return resolveAutomationStatePath(
    projectRoot,
    config.ledger.path,
    "automation.ledger.path",
  );
}

export function nexusAutomationLockPath(
  projectRoot: string,
  config: NexusAutomationConfig,
): string {
  return resolveAutomationStatePath(
    projectRoot,
    config.lock.path,
    "automation.lock.path",
  );
}

export function emptyNexusAutomationRunLedger(): NexusAutomationRunLedger {
  return {
    version: 1,
    runs: [],
    updatedAt: null,
  };
}

export function readNexusAutomationRunLedger(
  projectRoot: string,
  config: NexusAutomationConfig,
): NexusAutomationRunLedger {
  const ledgerPath = nexusAutomationLedgerPath(projectRoot, config);
  if (!fs.existsSync(ledgerPath)) {
    return emptyNexusAutomationRunLedger();
  }

  return normalizeNexusAutomationRunLedger(
    JSON.parse(fs.readFileSync(ledgerPath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function writeNexusAutomationRunLedger(
  projectRoot: string,
  config: NexusAutomationConfig,
  ledger: NexusAutomationRunLedger,
): string {
  const ledgerPath = nexusAutomationLedgerPath(projectRoot, config);
  const normalized = normalizeNexusAutomationRunLedger(ledger);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return ledgerPath;
}

export function appendNexusAutomationRunRecord(
  options: AppendNexusAutomationRunRecordOptions,
): NexusAutomationRunLedger {
  const recordedAt = isoString(options.now ?? new Date());
  const record = normalizeRunRecordInput(options.record, recordedAt);
  const existing = readNexusAutomationRunLedger(options.projectRoot, options.config);
  const runs = [...existing.runs, record].slice(
    -options.config.ledger.retention,
  );
  const ledger: NexusAutomationRunLedger = {
    version: 1,
    runs,
    updatedAt: recordedAt,
  };
  writeNexusAutomationRunLedger(options.projectRoot, options.config, ledger);

  return ledger;
}

export function normalizeNexusAutomationRunLedger(
  value: unknown,
): NexusAutomationRunLedger {
  if (value === undefined || value === null) {
    return emptyNexusAutomationRunLedger();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError("automation run ledger must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new NexusAutomationError("automation run ledger.version must be 1");
  }
  if (!Array.isArray(record.runs)) {
    throw new NexusAutomationError("automation run ledger.runs must be an array");
  }

  return {
    version: 1,
    runs: record.runs.map(normalizeRunRecord),
    updatedAt: optionalNullableString(record.updatedAt) ?? null,
  };
}

export function acquireNexusAutomationRunLock(
  options: AcquireNexusAutomationRunLockOptions,
): AcquireNexusAutomationRunLockResult {
  const lockPath = nexusAutomationLockPath(options.projectRoot, options.config);
  const runId = requiredNonEmptyString(options.runId, "runId");
  const now = dateFrom(options.now ?? new Date(), "now");
  const lock: NexusAutomationRunLock = {
    runId,
    owner: optionalNullableString(options.owner) ?? null,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + options.config.lock.staleAfterMs)
      .toISOString(),
  };

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const initial = tryWriteLock(lockPath, lock);
  if (initial) {
    return { lockPath, lock, replacedStaleLock: false };
  }

  const existing = readExistingLock(lockPath);
  if (dateFrom(existing.expiresAt, "automation lock.expiresAt").getTime() > now.getTime()) {
    throw new NexusAutomationError(
      `Automation run lock is already held by ${existing.runId} until ${existing.expiresAt}`,
    );
  }

  fs.rmSync(lockPath, { force: true });
  if (!tryWriteLock(lockPath, lock)) {
    throw new NexusAutomationError(
      `Automation run lock could not be acquired: ${lockPath}`,
    );
  }

  return { lockPath, lock, replacedStaleLock: true };
}

export function releaseNexusAutomationRunLock(
  options: ReleaseNexusAutomationRunLockOptions,
): boolean {
  const lockPath = nexusAutomationLockPath(options.projectRoot, options.config);
  if (!fs.existsSync(lockPath)) {
    return false;
  }
  if (options.runId) {
    const existing = readExistingLock(lockPath);
    if (existing.runId !== options.runId) {
      return false;
    }
  }

  fs.rmSync(lockPath, { force: true });
  return true;
}

export function buildNexusAutomationWorkItemQuery(
  config: NexusAutomationConfig,
): WorkItemQuery {
  const selector = config.selector;
  return {
    status: selector.statuses,
    ...(selector.labels.length ? { labels: selector.labels } : {}),
    ...(selector.assignees.length ? { assignees: selector.assignees } : {}),
    ...(selector.search ? { search: selector.search } : {}),
    limit: selector.limit,
  };
}

export function selectNexusAutomationWorkItem(
  items: readonly WorkItem[],
  config: NexusAutomationConfig,
): WorkItem | undefined {
  return items.find((item) => matchesSelector(item, config.selector));
}

export function eligibleNexusAutomationWorkItems(
  items: readonly WorkItem[],
  config: NexusAutomationConfig,
): WorkItem[] {
  return items.filter((item) => matchesSelector(item, config.selector));
}

export function evaluateNexusAutomationBackoff(
  config: NexusAutomationConfig,
  consecutiveFailures: number,
  lastFailureAt: Date | string,
): NexusAutomationBackoffDecision {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 0) {
    throw new NexusAutomationError(
      "consecutiveFailures must be a non-negative integer",
    );
  }
  if (consecutiveFailures === 0) {
    return {
      consecutiveFailures,
      shouldRun: true,
      retryAfter: null,
      delayMs: null,
      reason: null,
    };
  }
  if (consecutiveFailures >= config.backoff.failureLimit) {
    return {
      consecutiveFailures,
      shouldRun: false,
      retryAfter: null,
      delayMs: null,
      reason: `automation failure limit reached: ${consecutiveFailures}`,
    };
  }

  const failedAt = dateFrom(lastFailureAt, "lastFailureAt");
  const delayMs = Math.min(
    config.backoff.maxDelayMs,
    config.backoff.baseDelayMs * 2 ** (consecutiveFailures - 1),
  );

  return {
    consecutiveFailures,
    shouldRun: false,
    retryAfter: new Date(failedAt.getTime() + delayMs).toISOString(),
    delayMs,
    reason: "automation retry backoff is active",
  };
}

export function countConsecutiveNexusAutomationFailures(
  ledger: NexusAutomationRunLedger,
): number {
  let failures = 0;
  for (let index = ledger.runs.length - 1; index >= 0; index -= 1) {
    const run = ledger.runs[index]!;
    if (run.status === "skipped") {
      continue;
    }
    if (run.status === "failed" || run.status === "blocked") {
      failures += 1;
      continue;
    }

    break;
  }

  return failures;
}

export function evaluateNexusAutomationLedgerBackoff(
  config: NexusAutomationConfig,
  ledger: NexusAutomationRunLedger,
  now: Date | string = new Date(),
): NexusAutomationBackoffDecision {
  const consecutiveFailures = countConsecutiveNexusAutomationFailures(ledger);
  if (consecutiveFailures === 0) {
    return {
      consecutiveFailures,
      shouldRun: true,
      retryAfter: null,
      delayMs: null,
      reason: null,
    };
  }

  const lastFailure = [...ledger.runs]
    .reverse()
    .find((run) => run.status === "failed" || run.status === "blocked");
  if (!lastFailure) {
    return {
      consecutiveFailures: 0,
      shouldRun: true,
      retryAfter: null,
      delayMs: null,
      reason: null,
    };
  }

  const decision = evaluateNexusAutomationBackoff(
    config,
    consecutiveFailures,
    lastFailure.finishedAt ?? lastFailure.startedAt,
  );
  if (!decision.retryAfter) {
    return decision;
  }

  const retryAt = dateFrom(decision.retryAfter, "retryAfter");
  if (dateFrom(now, "now").getTime() >= retryAt.getTime()) {
    return {
      ...decision,
      shouldRun: true,
      reason: null,
    };
  }

  return decision;
}

function resolveAutomationStatePath(
  projectRoot: string,
  configuredPath: string,
  fieldName: string,
): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, configuredPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationError(
      `${fieldName} must resolve inside the workspace root: ${target}`,
    );
  }

  return target;
}

function matchesSelector(
  item: WorkItem,
  selector: NexusAutomationSelectorConfig,
): boolean {
  return (
    selector.statuses.includes(item.status) &&
    includesAll(normalizeStringList(item.labels), selector.labels) &&
    includesNone(normalizeStringList(item.labels), selector.excludeLabels) &&
    includesAll(normalizeStringList(item.assignees), selector.assignees) &&
    matchesSearch(item, selector.search)
  );
}

function includesAll(values: Set<string>, expected: readonly string[]): boolean {
  return expected.every((value) => values.has(value.toLowerCase()));
}

function includesNone(values: Set<string>, blocked: readonly string[]): boolean {
  return blocked.every((value) => !values.has(value.toLowerCase()));
}

function normalizeStringList(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function matchesSearch(item: WorkItem, search: string | null): boolean {
  if (!search) {
    return true;
  }

  const needle = search.toLowerCase();
  return [item.id, item.title, item.description ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

function tryWriteLock(
  lockPath: string,
  lock: NexusAutomationRunLock,
): boolean {
  try {
    const handle = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(handle, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    } finally {
      fs.closeSync(handle);
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return false;
    }

    throw error;
  }
}

function readExistingLock(lockPath: string): NexusAutomationRunLock {
  return normalizeRunLock(
    JSON.parse(fs.readFileSync(lockPath, "utf8").replace(/^\uFEFF/, "")),
  );
}

function normalizeRunLock(value: unknown): NexusAutomationRunLock {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError("automation run lock must be an object");
  }

  const record = value as Record<string, unknown>;
  return {
    runId: requiredNonEmptyString(record.runId, "automation lock.runId"),
    owner: optionalNullableString(record.owner) ?? null,
    acquiredAt: requiredIsoString(record.acquiredAt, "automation lock.acquiredAt"),
    expiresAt: requiredIsoString(record.expiresAt, "automation lock.expiresAt"),
  };
}

function normalizeRunRecordInput(
  input: NexusAutomationRunRecordInput,
  recordedAt: string,
): NexusAutomationRunRecord {
  return normalizeRunRecord({
    ...input,
    startedAt: input.startedAt ?? recordedAt,
    finishedAt: input.finishedAt ?? null,
    componentId: input.componentId ?? null,
    workItemId: input.workItemId ?? null,
    workItemTitle: input.workItemTitle ?? null,
    sourceRoot: input.sourceRoot ?? null,
    worktreePath: input.worktreePath ?? null,
    branchName: input.branchName ?? null,
    baseRef: input.baseRef ?? null,
    commitIds: input.commitIds ?? [],
    summary: input.summary ?? null,
    verification: input.verification ?? [],
    publicationDecision: input.publicationDecision ?? null,
    error: input.error ?? null,
    codexAppServer: input.codexAppServer ?? null,
    providerSessions: input.providerSessions ?? null,
    nextRunNotBefore: input.nextRunNotBefore ?? null,
  });
}

function normalizeRunRecord(value: unknown): NexusAutomationRunRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError("automation run record must be an object");
  }

  const record = value as Record<string, unknown>;
  const id = requiredNonEmptyString(record.id, "automation run.id");
  const componentId = optionalNullableString(record.componentId) ?? null;
  const workItemId = optionalNullableString(record.workItemId) ?? null;
  const worktreePath = optionalNullableString(record.worktreePath) ?? null;
  const codexAppServer = normalizeCodexAppServerLaunchMetadata(
    record.codexAppServer,
  );
  const providerSessions = normalizeProviderSessions(record.providerSessions, {
    runId: id,
    componentId,
    workItemId,
    worktreeId: worktreeIdFromPath(worktreePath),
    codexAppServer,
  });

  return {
    id: requiredNonEmptyString(record.id, "automation run.id"),
    projectId: requiredNonEmptyString(record.projectId, "automation run.projectId"),
    componentId,
    status: normalizeRunStatus(record.status, "automation run.status"),
    startedAt: requiredIsoString(record.startedAt, "automation run.startedAt"),
    finishedAt: optionalIsoString(record.finishedAt, "automation run.finishedAt"),
    workItemId,
    workItemTitle: optionalNullableString(record.workItemTitle) ?? null,
    sourceRoot: optionalNullableString(record.sourceRoot) ?? null,
    worktreePath,
    branchName: optionalNullableString(record.branchName) ?? null,
    baseRef: optionalNullableString(record.baseRef) ?? null,
    commitIds: normalizeStringArray(record.commitIds, "automation run.commitIds"),
    summary: optionalNullableString(record.summary) ?? null,
    verification: normalizeVerificationRecords(record.verification),
    publicationDecision: normalizePublicationDecision(record.publicationDecision),
    error: optionalNullableString(record.error) ?? null,
    codexAppServer,
    ...(providerSessions.length > 0 ? { providerSessions } : {}),
    nextRunNotBefore: optionalIsoString(
      record.nextRunNotBefore,
      "automation run.nextRunNotBefore",
    ),
  };
}

function normalizeCodexAppServerLaunchMetadata(
  value: unknown,
): NexusAutomationCodexAppServerLaunchMetadata | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError(
      "automation run.codexAppServer must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  const ephemeral = requiredBoolean(
    record.ephemeral,
    "automation run.codexAppServer.ephemeral",
  );
  return {
    provider: requiredLiteral(
      record.provider,
      "codex-app-server",
      "automation run.codexAppServer.provider",
    ),
    status: normalizeCodexAppServerLaunchStatus(
      record.status,
      "automation run.codexAppServer.status",
    ),
    action: normalizeCodexAppServerAction(
      record.action,
      "automation run.codexAppServer.action",
    ),
    runId: requiredNonEmptyString(
      record.runId,
      "automation run.codexAppServer.runId",
    ),
    profileId: requiredNonEmptyString(
      record.profileId,
      "automation run.codexAppServer.profileId",
    ),
    threadId: optionalNullableString(record.threadId) ?? null,
    turnId: optionalNullableString(record.turnId) ?? null,
    sourceThreadId: optionalNullableString(record.sourceThreadId) ?? null,
    sourceTurnId: optionalNullableString(record.sourceTurnId) ?? null,
    ephemeral,
    threadPersistence: normalizeCodexAppServerThreadPersistence(
      record.threadPersistence ?? (ephemeral ? "ephemeral" : "durable"),
      "automation run.codexAppServer.threadPersistence",
    ),
    cwd: requiredNonEmptyString(record.cwd, "automation run.codexAppServer.cwd"),
    model: optionalNullableString(record.model) ?? null,
    reasoning: optionalNullableString(record.reasoning) ?? null,
    resultFile: requiredNonEmptyString(
      record.resultFile,
      "automation run.codexAppServer.resultFile",
    ),
    failureSummary: optionalNullableString(record.failureSummary) ?? null,
    goal: normalizeCodexAppServerGoalMetadata(record.goal),
  };
}

function normalizeCodexAppServerGoalMetadata(
  value: unknown,
): NexusAutomationCodexAppServerGoalMetadata | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError(
      "automation run.codexAppServer.goal must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    requested: requiredBoolean(
      record.requested,
      "automation run.codexAppServer.goal.requested",
    ),
    setMethodAvailable: requiredBoolean(
      record.setMethodAvailable,
      "automation run.codexAppServer.goal.setMethodAvailable",
    ),
    getMethodAvailable: requiredBoolean(
      record.getMethodAvailable,
      "automation run.codexAppServer.goal.getMethodAvailable",
    ),
    setStatus: normalizeCodexAppServerGoalOperationStatus(
      record.setStatus,
      "automation run.codexAppServer.goal.setStatus",
    ),
    readStatus: normalizeCodexAppServerGoalOperationStatus(
      record.readStatus,
      "automation run.codexAppServer.goal.readStatus",
    ),
    goalId: optionalNullableString(record.goalId) ?? null,
    threadId: optionalNullableString(record.threadId) ?? null,
    status: optionalNullableString(record.status) ?? null,
    tokenBudget: optionalNullableNumber(record.tokenBudget),
    tokensUsed: optionalNullableNumber(record.tokensUsed),
    timeUsedSeconds: optionalNullableNumber(record.timeUsedSeconds),
    failureSummary: optionalNullableString(record.failureSummary) ?? null,
    policy: normalizeNexusCodexGoalsPolicyDecision(record.policy),
  };
}

function normalizeProviderSessions(
  value: unknown,
  context: {
    runId: string;
    componentId: string | null;
    workItemId: string | null;
    worktreeId: string | null;
    codexAppServer: NexusAutomationCodexAppServerLaunchMetadata | null;
  },
): NexusAutomationProviderSessionRecord[] {
  const sessions: NexusAutomationProviderSessionRecord[] = [];
  if (value !== undefined && value !== null) {
    if (!Array.isArray(value)) {
      throw new NexusAutomationError(
        "automation run.providerSessions must be an array",
      );
    }
    sessions.push(
      ...value.map((item, index) =>
        normalizeProviderSessionRecord(
          item,
          `automation run.providerSessions[${index}]`,
          context,
        )
      ),
    );
  }

  if (context.codexAppServer) {
    sessions.push(
      providerSessionFromCodexAppServer({
        ...context,
        codexAppServer: context.codexAppServer,
      }),
    );
  }

  return uniqueProviderSessions(sessions);
}

function normalizeProviderSessionRecord(
  value: unknown,
  name: string,
  context: {
    runId: string;
    componentId: string | null;
    workItemId: string | null;
    worktreeId: string | null;
  },
): NexusAutomationProviderSessionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError(`${name} must be an object`);
  }

  const record = value as Record<string, unknown>;
  return {
    providerId: requiredNonEmptyString(record.providerId, `${name}.providerId`),
    executorMode: optionalNullableString(record.executorMode) ?? null,
    status: normalizeProviderSessionStatus(record.status, `${name}.status`),
    purpose: optionalNullableString(record.purpose) ?? null,
    runId: optionalNullableString(record.runId) ?? context.runId,
    componentId: optionalNullableString(record.componentId) ?? context.componentId,
    workItemId: optionalNullableString(record.workItemId) ?? context.workItemId,
    worktreeId: optionalNullableString(record.worktreeId) ?? context.worktreeId,
    cwd: optionalNullableString(record.cwd) ?? null,
    profileId: optionalNullableString(record.profileId) ?? null,
    model: optionalNullableString(record.model) ?? null,
    reasoning: optionalNullableString(record.reasoning) ?? null,
    sessionId: optionalNullableString(record.sessionId) ?? null,
    turnId: optionalNullableString(record.turnId) ?? null,
    sourceSessionId: optionalNullableString(record.sourceSessionId) ?? null,
    sourceTurnId: optionalNullableString(record.sourceTurnId) ?? null,
    persistenceMode: optionalNullableString(record.persistenceMode) ?? null,
    sandbox: optionalNullableString(record.sandbox) ?? null,
    approvalPolicy: optionalNullableString(record.approvalPolicy) ?? null,
    permissionProfile: optionalNullableString(record.permissionProfile) ?? null,
    terminalStatus: normalizeProviderTerminalStatus(
      record.terminalStatus ?? "not_observed",
      `${name}.terminalStatus`,
    ),
    resultContract: normalizeProviderResultContractMetadata(
      record.resultContract,
      `${name}.resultContract`,
    ),
    failureSummary: optionalNullableString(record.failureSummary) ?? null,
  };
}

function providerSessionFromCodexAppServer(options: {
  runId: string;
  componentId: string | null;
  workItemId: string | null;
  worktreeId: string | null;
  codexAppServer: NexusAutomationCodexAppServerLaunchMetadata;
}): NexusAutomationProviderSessionRecord {
  const appServer = options.codexAppServer;
  return {
    providerId: appServer.provider,
    executorMode: null,
    status: appServer.status,
    purpose: null,
    runId: options.runId,
    componentId: options.componentId,
    workItemId: options.workItemId,
    worktreeId: options.worktreeId,
    cwd: appServer.cwd,
    profileId: appServer.profileId,
    model: appServer.model,
    reasoning: appServer.reasoning,
    sessionId: appServer.threadId,
    turnId: appServer.turnId,
    sourceSessionId: appServer.sourceThreadId,
    sourceTurnId: appServer.sourceTurnId,
    persistenceMode: appServer.threadPersistence,
    sandbox: null,
    approvalPolicy: null,
    permissionProfile: null,
    terminalStatus: "not_observed",
    resultContract: providerResultContractFromCodexAppServer(appServer),
    failureSummary: appServer.failureSummary,
  };
}

function providerResultContractFromCodexAppServer(
  appServer: NexusAutomationCodexAppServerLaunchMetadata,
): NexusAutomationProviderResultContractMetadata {
  if (appServer.status === "completed" || appServer.status === "blocked") {
    return {
      status: "valid",
      file: appServer.resultFile,
      resultStatus: appServer.status,
      failureSummary: appServer.failureSummary,
    };
  }

  const failure = appServer.failureSummary ?? "";
  if (failure.includes("Agent result file was not written")) {
    return {
      status: "missing",
      file: appServer.resultFile,
      resultStatus: null,
      failureSummary: appServer.failureSummary,
    };
  }
  if (failure.includes("Agent result file is invalid")) {
    return {
      status: "invalid",
      file: appServer.resultFile,
      resultStatus: null,
      failureSummary: appServer.failureSummary,
    };
  }

  return {
    status: "not_read",
    file: appServer.resultFile,
    resultStatus: null,
    failureSummary: null,
  };
}

function normalizeProviderResultContractMetadata(
  value: unknown,
  name: string,
): NexusAutomationProviderResultContractMetadata {
  if (value === undefined || value === null) {
    return {
      status: "not_read",
      file: null,
      resultStatus: null,
      failureSummary: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationError(`${name} must be an object`);
  }

  const record = value as Record<string, unknown>;
  return {
    status: normalizeProviderResultContractStatus(
      record.status,
      `${name}.status`,
    ),
    file: optionalNullableString(record.file) ?? null,
    resultStatus:
      record.resultStatus === undefined || record.resultStatus === null
        ? null
        : normalizeProviderResultContractResultStatus(
            record.resultStatus,
            `${name}.resultStatus`,
          ),
    failureSummary: optionalNullableString(record.failureSummary) ?? null,
  };
}

function uniqueProviderSessions(
  sessions: NexusAutomationProviderSessionRecord[],
): NexusAutomationProviderSessionRecord[] {
  const unique = new Map<string, NexusAutomationProviderSessionRecord>();
  for (const session of sessions) {
    const key = providerSessionKey(session);
    if (!unique.has(key)) {
      unique.set(key, session);
    }
  }

  return [...unique.values()];
}

function providerSessionKey(
  session: NexusAutomationProviderSessionRecord,
): string {
  return [
    session.providerId,
    session.runId,
    session.sessionId ?? "",
    session.turnId ?? "",
  ].join("\0");
}

function worktreeIdFromPath(worktreePath: string | null): string | null {
  if (!worktreePath) {
    return null;
  }

  return path.basename(worktreePath);
}

function normalizeVerificationRecords(
  value: unknown,
): WorktreeVerificationRecord[] {
  return normalizeWorktreeExecutionMetadata({
    verification: value,
  }).verification;
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationError(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${name}[${index}]`),
  );
}

function normalizePublicationDecision(
  value: unknown,
): WorktreePublicationDecision | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeWorktreeExecutionMetadata({
    publicationDecision: value,
  }).publicationDecision;
}

function normalizeRunStatus(
  value: unknown,
  name: string,
): NexusAutomationRunStatus {
  if (
    value === "started" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be started, completed, failed, blocked, or skipped`,
  );
}

function normalizeCodexAppServerLaunchStatus(
  value: unknown,
  name: string,
): NexusAutomationCodexAppServerLaunchMetadata["status"] {
  if (
    value === "started" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be started, completed, failed, or blocked`,
  );
}

function normalizeCodexAppServerAction(
  value: unknown,
  name: string,
): NexusAutomationCodexAppServerLaunchMetadata["action"] {
  if (value === "thread_start" || value === "thread_fork") {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be thread_start or thread_fork`,
  );
}

function normalizeCodexAppServerThreadPersistence(
  value: unknown,
  name: string,
): NexusAutomationCodexAppServerLaunchMetadata["threadPersistence"] {
  if (value === "ephemeral" || value === "durable") {
    return value;
  }

  throw new NexusAutomationError(`${name} must be ephemeral or durable`);
}

function normalizeProviderSessionStatus(
  value: unknown,
  name: string,
): NexusAutomationProviderSessionStatus {
  if (
    value === "started" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "interrupted"
  ) {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be started, completed, failed, blocked, or interrupted`,
  );
}

function normalizeProviderTerminalStatus(
  value: unknown,
  name: string,
): NexusAutomationProviderTerminalStatus {
  if (
    value === "not_observed" ||
    value === "observed" ||
    value === "failed"
  ) {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be not_observed, observed, or failed`,
  );
}

function normalizeProviderResultContractStatus(
  value: unknown,
  name: string,
): NexusAutomationProviderResultContractStatus {
  if (
    value === "not_read" ||
    value === "valid" ||
    value === "missing" ||
    value === "invalid"
  ) {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be not_read, valid, missing, or invalid`,
  );
}

function normalizeProviderResultContractResultStatus(
  value: unknown,
  name: string,
): NexusAutomationProviderResultContractResultStatus {
  if (value === "completed" || value === "failed" || value === "blocked") {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be completed, failed, or blocked`,
  );
}

function normalizeCodexAppServerGoalOperationStatus(
  value: unknown,
  name: string,
): NexusAutomationCodexAppServerGoalOperationStatus {
  if (
    value === "not_requested" ||
    value === "unsupported" ||
    value === "set" ||
    value === "read" ||
    value === "unavailable" ||
    value === "failed"
  ) {
    return value;
  }

  throw new NexusAutomationError(
    `${name} must be not_requested, unsupported, set, read, unavailable, or failed`,
  );
}

function requiredLiteral<T extends string>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value === expected) {
    return expected;
  }

  throw new NexusAutomationError(`${name} must be ${expected}`);
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new NexusAutomationError(`${name} must be a boolean`);
}

function optionalIsoString(value: unknown, name: string): string | null {
  const stringValue = optionalNullableString(value);
  if (stringValue === undefined || stringValue === null) {
    return null;
  }

  return requiredIsoString(stringValue, name);
}

function requiredIsoString(value: unknown, name: string): string {
  const stringValue = requiredNonEmptyString(value, name);
  dateFrom(stringValue, name);

  return stringValue;
}

function isoString(value: Date | string): string {
  return dateFrom(value, "date").toISOString();
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationError(`${name} must be a valid date`);
  }

  return date;
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

function optionalNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new NexusAutomationError("value must be a finite number");
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
