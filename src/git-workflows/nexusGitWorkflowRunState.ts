import fs from "node:fs";
import path from "node:path";
import { gitDirectoryFromGitFileContent } from "../git/nexusGitFile.js";
import { secureRandomIdSuffix } from "../runtime/nexusSecureRandom.js";

export const nexusGitWorkflowRunKind = "dev-nexus.git-workflow.run";
export const nexusGitWorkflowRunStoreFileName = "git-workflow-runs.json";
export const nexusGitWorkflowRunRuntimeDirectoryName = "dev-nexus";
export const nexusGitWorkflowRunProjectRuntimeDirectoryName = "runtime";

export type NexusGitWorkflowRunStatus =
  | "working"
  | "ready_for_review"
  | "waiting"
  | "paused"
  | "blocked"
  | "completed"
  | "aborted"
  | "abandoned"
  | "archived"
  | "rescued"
  | "merged";

export type NexusGitWorkflowRunTerminalOutcome =
  | "completed"
  | "aborted"
  | "abandoned"
  | "archived"
  | "rescued"
  | "merged";

export type NexusGitWorkflowRunPreservationKind =
  | "archive_record"
  | "rescue_branch"
  | "merged"
  | "empty";

export type NexusGitWorkflowRunOwnerKind =
  | "agent"
  | "human"
  | "provider"
  | "ci"
  | "none";

export type NexusGitWorkflowRunNodeKind =
  | "observation"
  | "decision"
  | "action"
  | "gate"
  | "handoff"
  | "wait"
  | "terminal";

export interface NexusGitWorkflowRunOwner {
  kind: NexusGitWorkflowRunOwnerKind;
  id: string | null;
}

export interface NexusGitWorkflowProviderLink {
  provider: string;
  url: string;
  id: string | null;
}

export interface NexusGitWorkflowRunEvidence {
  id: string;
  kind: string;
  summary: string;
  observedAt: string;
}

export interface NexusGitWorkflowRunTransition {
  id: string;
  to: NexusGitWorkflowRunStatus;
  summary: string;
  requiresApproval: boolean;
}

export interface NexusGitWorkflowRunPreservation {
  kind: NexusGitWorkflowRunPreservationKind;
  summary: string;
  ref: string | null;
  url: string | null;
  recordedAt: string;
}

export interface NexusGitWorkflowRunNode {
  id: string;
  kind: NexusGitWorkflowRunNodeKind;
  summary: string;
  recordedAt: string;
}

export interface NexusGitWorkflowRunRecord {
  kind: typeof nexusGitWorkflowRunKind;
  version: 1;
  id: string;
  projectId: string;
  componentId: string | null;
  profileId: string;
  branchStrategy: string | null;
  status: NexusGitWorkflowRunStatus;
  terminalOutcome: NexusGitWorkflowRunTerminalOutcome | null;
  workItemId: string | null;
  branchName: string | null;
  currentRef: string | null;
  baseRef: string | null;
  baseCommit: string | null;
  targetBranch: string | null;
  owner: NexusGitWorkflowRunOwner;
  preservation: NexusGitWorkflowRunPreservation | null;
  providerLinks: NexusGitWorkflowProviderLink[];
  evidence: NexusGitWorkflowRunEvidence[];
  allowedTransitions: NexusGitWorkflowRunTransition[];
  nodes: NexusGitWorkflowRunNode[];
  createdAt: string;
  updatedAt: string;
}

export interface NexusGitWorkflowRunStore {
  version: 1;
  updatedAt: string | null;
  runs: NexusGitWorkflowRunRecord[];
}

export interface NexusGitWorkflowRunNodeInput {
  id: string;
  kind: NexusGitWorkflowRunNodeKind;
  summary: string;
  recordedAt?: string | null;
}

export interface NexusGitWorkflowRunEvidenceInput {
  id: string;
  kind: string;
  summary: string;
  observedAt?: string | null;
}

export interface NexusGitWorkflowRunPreservationInput {
  kind: NexusGitWorkflowRunPreservationKind;
  summary: string;
  ref?: string | null;
  url?: string | null;
  recordedAt?: string | null;
}

export interface NexusGitWorkflowRunTransitionInput {
  id: string;
  to: NexusGitWorkflowRunStatus;
  summary: string;
  requiresApproval?: boolean;
}

export interface CreateNexusGitWorkflowRunOptions {
  projectRoot: string;
  id?: string | null;
  projectId: string;
  componentId?: string | null;
  profileId: string;
  branchStrategy?: string | null;
  workItemId?: string | null;
  branchName?: string | null;
  currentRef?: string | null;
  baseRef?: string | null;
  baseCommit?: string | null;
  targetBranch?: string | null;
  owner?: NexusGitWorkflowRunOwner | null;
  preservation?: NexusGitWorkflowRunPreservationInput | null;
  providerLinks?: NexusGitWorkflowProviderLink[];
  evidence?: NexusGitWorkflowRunEvidenceInput[];
  allowedTransitions?: NexusGitWorkflowRunTransitionInput[];
  nodes?: NexusGitWorkflowRunNodeInput[];
  now?: Date | string | (() => Date | string);
}

export interface UpdateNexusGitWorkflowRunOptions {
  projectRoot: string;
  id: string;
  status?: NexusGitWorkflowRunStatus;
  terminalOutcome?: NexusGitWorkflowRunTerminalOutcome | null;
  currentRef?: string | null;
  owner?: NexusGitWorkflowRunOwner | null;
  preservation?: NexusGitWorkflowRunPreservationInput | null;
  providerLinks?: NexusGitWorkflowProviderLink[];
  evidence?: NexusGitWorkflowRunEvidenceInput[];
  allowedTransitions?: NexusGitWorkflowRunTransitionInput[];
  nodes?: NexusGitWorkflowRunNodeInput[];
  now?: Date | string | (() => Date | string);
}

export interface ListNexusGitWorkflowRunsOptions {
  projectRoot: string;
  componentId?: string | null;
  workItemId?: string | null;
  status?: NexusGitWorkflowRunStatus | null;
}

export interface NexusGitWorkflowRunSummary {
  id: string;
  projectId: string;
  componentId: string | null;
  profileId: string;
  branchStrategy: string | null;
  status: NexusGitWorkflowRunStatus;
  terminalOutcome: NexusGitWorkflowRunTerminalOutcome | null;
  branchName: string | null;
  currentRef: string | null;
  targetBranch: string | null;
  workItemId: string | null;
  currentNodeId: string | null;
  nextOwner: NexusGitWorkflowRunOwner;
  preservation: NexusGitWorkflowRunPreservation | null;
  evidenceCount: number;
  allowedTransitionCount: number;
  updatedAt: string;
}

export interface ListNexusGitWorkflowRunsResult {
  storePath: string;
  runs: NexusGitWorkflowRunSummary[];
}

export class NexusGitWorkflowRunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusGitWorkflowRunStateError";
  }
}

const terminalStatuses = new Set<NexusGitWorkflowRunStatus>([
  "completed",
  "aborted",
  "abandoned",
  "archived",
  "rescued",
  "merged",
]);

const runStatuses = new Set<NexusGitWorkflowRunStatus>([
  "working",
  "ready_for_review",
  "waiting",
  "paused",
  "blocked",
  "completed",
  "aborted",
  "abandoned",
  "archived",
  "rescued",
  "merged",
]);

const terminalOutcomes = new Set<NexusGitWorkflowRunTerminalOutcome>([
  "completed",
  "aborted",
  "abandoned",
  "archived",
  "rescued",
  "merged",
]);

const preservationKinds = new Set<NexusGitWorkflowRunPreservationKind>([
  "archive_record",
  "rescue_branch",
  "merged",
  "empty",
]);

const ownerKinds = new Set<NexusGitWorkflowRunOwnerKind>([
  "agent",
  "human",
  "provider",
  "ci",
  "none",
]);

const nodeKinds = new Set<NexusGitWorkflowRunNodeKind>([
  "observation",
  "decision",
  "action",
  "gate",
  "handoff",
  "wait",
  "terminal",
]);

export function nexusGitWorkflowRunStorePath(projectRoot: string): string {
  const resolvedProjectRoot = path.resolve(
    requiredNonEmptyString(projectRoot, "projectRoot"),
  );
  const gitDir = projectGitDirectory(resolvedProjectRoot);
  if (gitDir) {
    return path.join(
      gitDir,
      nexusGitWorkflowRunRuntimeDirectoryName,
      nexusGitWorkflowRunStoreFileName,
    );
  }

  return path.join(
    resolvedProjectRoot,
    ".dev-nexus",
    nexusGitWorkflowRunProjectRuntimeDirectoryName,
    nexusGitWorkflowRunStoreFileName,
  );
}

export function emptyNexusGitWorkflowRunStore(): NexusGitWorkflowRunStore {
  return {
    version: 1,
    updatedAt: null,
    runs: [],
  };
}

export function readNexusGitWorkflowRunStore(
  projectRoot: string,
): NexusGitWorkflowRunStore {
  const storePath = nexusGitWorkflowRunStorePath(projectRoot);
  if (!fs.existsSync(storePath)) {
    return emptyNexusGitWorkflowRunStore();
  }

  return normalizeNexusGitWorkflowRunStore(
    JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/u, "")),
  );
}

export function writeNexusGitWorkflowRunStore(
  projectRoot: string,
  store: NexusGitWorkflowRunStore,
): string {
  const storePath = nexusGitWorkflowRunStorePath(projectRoot);
  const normalized = normalizeNexusGitWorkflowRunStore(store);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return storePath;
}

export function createNexusGitWorkflowRun(
  options: CreateNexusGitWorkflowRunOptions,
): NexusGitWorkflowRunRecord {
  const timestamp = isoString(options.now);
  const id = options.id
    ? requiredNonEmptyString(options.id, "id")
    : `git-workflow-${timestamp.replace(/[^0-9A-Za-z]/gu, "")}-${secureRandomIdSuffix()}`;
  const run = normalizeNexusGitWorkflowRun({
    kind: nexusGitWorkflowRunKind,
    version: 1,
    id,
    projectId: options.projectId,
    componentId: options.componentId ?? null,
    profileId: options.profileId,
    branchStrategy: options.branchStrategy ?? null,
    status: "working",
    terminalOutcome: null,
    workItemId: options.workItemId ?? null,
    branchName: options.branchName ?? null,
    currentRef: options.currentRef ?? options.branchName ?? null,
    baseRef: options.baseRef ?? null,
    baseCommit: options.baseCommit ?? null,
    targetBranch: options.targetBranch ?? null,
    owner: options.owner ?? { kind: "none", id: null },
    preservation: normalizePreservationInput(options.preservation ?? null, timestamp),
    providerLinks: options.providerLinks ?? [],
    evidence: normalizeEvidenceInputs(options.evidence ?? [], timestamp),
    allowedTransitions: normalizeTransitionInputs(
      options.allowedTransitions ?? [],
    ),
    nodes: normalizeNodeInputs(options.nodes ?? [], timestamp),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const store = readNexusGitWorkflowRunStore(options.projectRoot);
  if (store.runs.some((existing) => existing.id === run.id)) {
    throw new NexusGitWorkflowRunStateError(
      `Git workflow run already exists: ${run.id}`,
    );
  }
  writeNexusGitWorkflowRunStore(options.projectRoot, {
    version: 1,
    updatedAt: timestamp,
    runs: [...store.runs, run],
  });
  return run;
}

export function updateNexusGitWorkflowRun(
  options: UpdateNexusGitWorkflowRunOptions,
): NexusGitWorkflowRunRecord {
  const timestamp = isoString(options.now);
  const store = readNexusGitWorkflowRunStore(options.projectRoot);
  const id = requiredNonEmptyString(options.id, "id");
  const index = store.runs.findIndex((run) => run.id === id);
  if (index < 0) {
    throw new NexusGitWorkflowRunStateError(`Git workflow run not found: ${id}`);
  }
  const existing = store.runs[index]!;
  const status = options.status ?? existing.status;
  if (isTerminalStatus(existing.status) && status !== existing.status) {
    throw new NexusGitWorkflowRunStateError(
      `Terminal Git workflow run ${id} cannot transition from ${existing.status} to ${status}`,
    );
  }
  const terminalOutcome = options.terminalOutcome === undefined
    ? status === existing.status
      ? existing.terminalOutcome
      : isTerminalStatus(status)
        ? status
        : null
    : options.terminalOutcome;
  const updated = normalizeNexusGitWorkflowRun({
    ...existing,
    status,
    terminalOutcome,
    currentRef: Object.prototype.hasOwnProperty.call(options, "currentRef")
      ? options.currentRef
      : existing.currentRef,
    owner: options.owner === undefined
      ? existing.owner
      : options.owner ?? { kind: "none", id: null },
    preservation: Object.prototype.hasOwnProperty.call(options, "preservation")
      ? normalizePreservationInput(options.preservation ?? null, timestamp)
      : existing.preservation,
    providerLinks: options.providerLinks ?? existing.providerLinks,
    evidence: [
      ...existing.evidence,
      ...normalizeEvidenceInputs(options.evidence ?? [], timestamp),
    ],
    allowedTransitions: options.allowedTransitions === undefined
      ? existing.allowedTransitions
      : normalizeTransitionInputs(options.allowedTransitions),
    nodes: [
      ...existing.nodes,
      ...normalizeNodeInputs(options.nodes ?? [], timestamp),
    ],
    updatedAt: timestamp,
  });
  const runs = [...store.runs];
  runs[index] = updated;
  writeNexusGitWorkflowRunStore(options.projectRoot, {
    version: 1,
    updatedAt: timestamp,
    runs,
  });
  return updated;
}

export function listNexusGitWorkflowRuns(
  options: ListNexusGitWorkflowRunsOptions,
): ListNexusGitWorkflowRunsResult {
  const store = readNexusGitWorkflowRunStore(options.projectRoot);
  const runs = store.runs
    .filter((run) =>
      (options.componentId ? run.componentId === options.componentId : true) &&
      (options.workItemId ? run.workItemId === options.workItemId : true) &&
      (options.status ? run.status === options.status : true)
    )
    .map(summarizeNexusGitWorkflowRun);
  return {
    storePath: nexusGitWorkflowRunStorePath(options.projectRoot),
    runs,
  };
}

export function summarizeNexusGitWorkflowRun(
  run: NexusGitWorkflowRunRecord,
): NexusGitWorkflowRunSummary {
  const currentNode = run.nodes.at(-1) ?? null;
  return {
    id: run.id,
    projectId: run.projectId,
    componentId: run.componentId,
    profileId: run.profileId,
    branchStrategy: run.branchStrategy,
    status: run.status,
    terminalOutcome: run.terminalOutcome,
    branchName: run.branchName,
    currentRef: run.currentRef,
    targetBranch: run.targetBranch,
    workItemId: run.workItemId,
    currentNodeId: currentNode?.id ?? null,
    nextOwner: run.owner,
    preservation: run.preservation,
    evidenceCount: run.evidence.length,
    allowedTransitionCount: run.allowedTransitions.length,
    updatedAt: run.updatedAt,
  };
}

export function normalizeNexusGitWorkflowRunStore(
  value: unknown,
): NexusGitWorkflowRunStore {
  if (value === undefined || value === null) {
    return emptyNexusGitWorkflowRunStore();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(
      "Git workflow run store must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  const version = record.version;
  if (version !== 1) {
    throw new NexusGitWorkflowRunStateError(
      "Git workflow run store.version must be 1",
    );
  }
  return {
    version: 1,
    updatedAt: optionalNullableString(record.updatedAt, "store.updatedAt") ?? null,
    runs: normalizeArray(record.runs, "store.runs", normalizeNexusGitWorkflowRun),
  };
}

export function normalizeNexusGitWorkflowRun(
  value: unknown,
): NexusGitWorkflowRunRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError("Git workflow run must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== nexusGitWorkflowRunKind) {
    throw new NexusGitWorkflowRunStateError(
      `Git workflow run.kind must be ${nexusGitWorkflowRunKind}`,
    );
  }
  if (record.version !== 1) {
    throw new NexusGitWorkflowRunStateError("Git workflow run.version must be 1");
  }
  const status = normalizeRunStatus(record.status, "run.status");
  const terminalOutcome = normalizeTerminalOutcome(
    record.terminalOutcome,
    "run.terminalOutcome",
  );
  const allowedTransitions = normalizeArray(
    record.allowedTransitions,
    "run.allowedTransitions",
    normalizeTransition,
  );
  assertTerminalState(status, terminalOutcome, allowedTransitions);
  return {
    kind: nexusGitWorkflowRunKind,
    version: 1,
    id: requiredNonEmptyString(record.id, "run.id"),
    projectId: requiredNonEmptyString(record.projectId, "run.projectId"),
    componentId:
      optionalNullableString(record.componentId, "run.componentId") ?? null,
    profileId: requiredNonEmptyString(record.profileId, "run.profileId"),
    branchStrategy:
      optionalNullableString(record.branchStrategy, "run.branchStrategy") ?? null,
    status,
    terminalOutcome,
    workItemId:
      optionalNullableString(record.workItemId, "run.workItemId") ?? null,
    branchName:
      optionalNullableString(record.branchName, "run.branchName") ?? null,
    currentRef:
      optionalNullableString(record.currentRef, "run.currentRef") ?? null,
    baseRef: optionalNullableString(record.baseRef, "run.baseRef") ?? null,
    baseCommit:
      optionalNullableString(record.baseCommit, "run.baseCommit") ?? null,
    targetBranch:
      optionalNullableString(record.targetBranch, "run.targetBranch") ?? null,
    owner: normalizeOwner(record.owner, "run.owner"),
    preservation: normalizePreservation(record.preservation, "run.preservation"),
    providerLinks: normalizeArray(
      record.providerLinks,
      "run.providerLinks",
      normalizeProviderLink,
    ),
    evidence: normalizeArray(record.evidence, "run.evidence", normalizeEvidence),
    allowedTransitions,
    nodes: normalizeArray(record.nodes, "run.nodes", normalizeNode),
    createdAt: requiredNonEmptyString(record.createdAt, "run.createdAt"),
    updatedAt: requiredNonEmptyString(record.updatedAt, "run.updatedAt"),
  };
}

function assertTerminalState(
  status: NexusGitWorkflowRunStatus,
  terminalOutcome: NexusGitWorkflowRunTerminalOutcome | null,
  allowedTransitions: NexusGitWorkflowRunTransition[],
): void {
  if (isTerminalStatus(status)) {
    if (!terminalOutcome) {
      throw new NexusGitWorkflowRunStateError(
        `run.terminalOutcome is required for terminal status ${status}`,
      );
    }
    if (terminalOutcome !== status) {
      throw new NexusGitWorkflowRunStateError(
        `run.terminalOutcome must match terminal status ${status}`,
      );
    }
    if (allowedTransitions.length > 0) {
      throw new NexusGitWorkflowRunStateError(
        "terminal runs must not have allowed transitions",
      );
    }
    return;
  }
  if (terminalOutcome) {
    throw new NexusGitWorkflowRunStateError(
      "run.terminalOutcome requires a terminal status",
    );
  }
}

function normalizeEvidenceInputs(
  values: NexusGitWorkflowRunEvidenceInput[],
  timestamp: string,
): NexusGitWorkflowRunEvidence[] {
  return values.map((value, index) =>
    normalizeEvidence(
      {
        ...value,
        observedAt: value.observedAt ?? timestamp,
      },
      `evidence[${index}]`,
    )
  );
}

function normalizeTransitionInputs(
  values: NexusGitWorkflowRunTransitionInput[],
): NexusGitWorkflowRunTransition[] {
  return values.map((value, index) =>
    normalizeTransition(
      {
        ...value,
        requiresApproval: value.requiresApproval ?? false,
      },
      `transition[${index}]`,
    )
  );
}

function normalizePreservationInput(
  value: NexusGitWorkflowRunPreservationInput | null,
  timestamp: string,
): NexusGitWorkflowRunPreservation | null {
  if (!value) {
    return null;
  }
  return normalizePreservation(
    {
      ...value,
      recordedAt: value.recordedAt ?? timestamp,
    },
    "preservation",
  );
}

function normalizeNodeInputs(
  values: NexusGitWorkflowRunNodeInput[],
  timestamp: string,
): NexusGitWorkflowRunNode[] {
  return values.map((value, index) =>
    normalizeNode(
      {
        ...value,
        recordedAt: value.recordedAt ?? timestamp,
      },
      `node[${index}]`,
    )
  );
}

function normalizeOwner(value: unknown, pathName: string): NexusGitWorkflowRunOwner {
  if (value === undefined || value === null) {
    return { kind: "none", id: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const kind = normalizeOwnerKind(record.kind, `${pathName}.kind`);
  const id = optionalNullableString(record.id, `${pathName}.id`) ?? null;
  if (kind === "none" && id) {
    throw new NexusGitWorkflowRunStateError(
      `${pathName}.id must be null when owner kind is none`,
    );
  }
  return { kind, id };
}

function normalizeProviderLink(
  value: unknown,
  pathName: string,
): NexusGitWorkflowProviderLink {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    provider: requiredNonEmptyString(record.provider, `${pathName}.provider`),
    url: requiredNonEmptyString(record.url, `${pathName}.url`),
    id: optionalNullableString(record.id, `${pathName}.id`) ?? null,
  };
}

function normalizeEvidence(
  value: unknown,
  pathName: string,
): NexusGitWorkflowRunEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    kind: requiredNonEmptyString(record.kind, `${pathName}.kind`),
    summary: requiredNonEmptyString(record.summary, `${pathName}.summary`),
    observedAt: requiredNonEmptyString(record.observedAt, `${pathName}.observedAt`),
  };
}

function normalizeTransition(
  value: unknown,
  pathName: string,
): NexusGitWorkflowRunTransition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    to: normalizeRunStatus(record.to, `${pathName}.to`),
    summary: requiredNonEmptyString(record.summary, `${pathName}.summary`),
    requiresApproval: optionalBoolean(record.requiresApproval, `${pathName}.requiresApproval`) ??
      false,
  };
}

function normalizePreservation(
  value: unknown,
  pathName: string,
): NexusGitWorkflowRunPreservation | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    kind: normalizePreservationKind(record.kind, `${pathName}.kind`),
    summary: requiredNonEmptyString(record.summary, `${pathName}.summary`),
    ref: optionalNullableString(record.ref, `${pathName}.ref`) ?? null,
    url: optionalNullableString(record.url, `${pathName}.url`) ?? null,
    recordedAt: requiredNonEmptyString(record.recordedAt, `${pathName}.recordedAt`),
  };
}

function normalizeNode(value: unknown, pathName: string): NexusGitWorkflowRunNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    kind: normalizeNodeKind(record.kind, `${pathName}.kind`),
    summary: requiredNonEmptyString(record.summary, `${pathName}.summary`),
    recordedAt: requiredNonEmptyString(record.recordedAt, `${pathName}.recordedAt`),
  };
}

function normalizeRunStatus(value: unknown, pathName: string): NexusGitWorkflowRunStatus {
  if (runStatuses.has(value as NexusGitWorkflowRunStatus)) {
    return value as NexusGitWorkflowRunStatus;
  }
  throw new NexusGitWorkflowRunStateError(`${pathName} must be a known run status`);
}

function normalizeTerminalOutcome(
  value: unknown,
  pathName: string,
): NexusGitWorkflowRunTerminalOutcome | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (terminalOutcomes.has(value as NexusGitWorkflowRunTerminalOutcome)) {
    return value as NexusGitWorkflowRunTerminalOutcome;
  }
  throw new NexusGitWorkflowRunStateError(
    `${pathName} must be a known terminal outcome`,
  );
}

function normalizePreservationKind(
  value: unknown,
  pathName: string,
): NexusGitWorkflowRunPreservationKind {
  if (preservationKinds.has(value as NexusGitWorkflowRunPreservationKind)) {
    return value as NexusGitWorkflowRunPreservationKind;
  }
  throw new NexusGitWorkflowRunStateError(
    `${pathName} must be a known preservation kind`,
  );
}

function normalizeOwnerKind(
  value: unknown,
  pathName: string,
): NexusGitWorkflowRunOwnerKind {
  if (ownerKinds.has(value as NexusGitWorkflowRunOwnerKind)) {
    return value as NexusGitWorkflowRunOwnerKind;
  }
  throw new NexusGitWorkflowRunStateError(`${pathName} must be a known owner kind`);
}

function normalizeNodeKind(value: unknown, pathName: string): NexusGitWorkflowRunNodeKind {
  if (nodeKinds.has(value as NexusGitWorkflowRunNodeKind)) {
    return value as NexusGitWorkflowRunNodeKind;
  }
  throw new NexusGitWorkflowRunStateError(`${pathName} must be a known node kind`);
}

function normalizeArray<Item>(
  value: unknown,
  pathName: string,
  normalizeItem: (item: unknown, pathName: string) => Item,
): Item[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be an array`);
  }
  return value.map((item, index) => normalizeItem(item, `${pathName}[${index}]`));
}

function optionalNullableString(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return requiredNonEmptyString(value, pathName);
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be a boolean`);
  }
  return value;
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusGitWorkflowRunStateError(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}

function isTerminalStatus(status: NexusGitWorkflowRunStatus): boolean {
  return terminalStatuses.has(status);
}

function isoString(value: Date | string | (() => Date | string) | undefined): string {
  const resolved = typeof value === "function" ? value() : value ?? new Date();
  return typeof resolved === "string" ? resolved : resolved.toISOString();
}

function projectGitDirectory(projectRoot: string): string | null {
  const dotGit = path.join(projectRoot, ".git");
  if (!fs.existsSync(dotGit)) {
    return null;
  }
  const stats = fs.statSync(dotGit);
  if (stats.isDirectory()) {
    return dotGit;
  }
  if (!stats.isFile()) {
    return null;
  }
  const gitDir = gitDirectoryFromGitFileContent(fs.readFileSync(dotGit, "utf8"));
  return gitDir ? path.resolve(projectRoot, gitDir) : null;
}
