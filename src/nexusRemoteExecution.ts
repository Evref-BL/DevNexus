import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import type { NexusRunnerMutationClass } from "./nexusRunnerProfile.js";
import { temporaryStoreNonce } from "./nexusSecureRandom.js";

export const nexusRemoteExecutionRequestKind =
  "dev-nexus.remote-execution.request";
export const nexusRemoteExecutionResultKind =
  "dev-nexus.remote-execution.result";
export const nexusRemoteExecutionStoreFileName =
  "remote-execution-records.json";
export const maxNexusRemoteExecutionOutputTailLength = 12000;

export const nexusRemoteExecutionRequestStatuses = [
  "queued",
  "accepted",
  "running",
  "completed",
  "failed",
  "blocked",
  "timed_out",
  "cancelled",
] as const;

export type NexusRemoteExecutionRequestStatus =
  typeof nexusRemoteExecutionRequestStatuses[number];

export type NexusRemoteExecutionVerificationOutcome =
  | "passed"
  | "failed"
  | "not_run"
  | "blocked"
  | "timed_out"
  | "cancelled";

export type NexusRemoteExecutionCleanupStatus =
  | "not_required"
  | "completed"
  | "failed"
  | "blocked"
  | "unknown";

export interface NexusRemoteExecutionWorkItemAttachmentRef {
  kind: "work_item";
  componentId: string;
  workItemId: string;
}

export interface NexusRemoteExecutionCoordinationAttachmentRef {
  kind: "coordination_record";
  componentId: string;
  recordId: string;
  workItemId: string | null;
}

export type NexusRemoteExecutionAttachmentRef =
  | NexusRemoteExecutionWorkItemAttachmentRef
  | NexusRemoteExecutionCoordinationAttachmentRef;

export interface NexusRemoteExecutionRequestRecord {
  kind: typeof nexusRemoteExecutionRequestKind;
  version: 1;
  id: string;
  projectId: string;
  projectRoot: string;
  componentId: string;
  componentName: string;
  workItemId: string | null;
  requestingHostId: string;
  requestingAgentId: string | null;
  targetHostId: string | null;
  requiredCapabilities: string[];
  runnerProfileId: string;
  repository: string;
  ref: string;
  commandProfileId: string;
  timeoutMs: number;
  expectedArtifacts: string[];
  mutationClass: NexusRunnerMutationClass;
  status: NexusRemoteExecutionRequestStatus;
  attachmentRefs: NexusRemoteExecutionAttachmentRef[];
  createdAt: string;
  updatedAt: string;
}

export interface NexusRemoteExecutionResultRecord {
  kind: typeof nexusRemoteExecutionResultKind;
  version: 1;
  id: string;
  requestId: string;
  projectId: string;
  componentId: string;
  recordedAt: string;
  status: NexusRemoteExecutionRequestStatus;
  hostId: string;
  runnerProfileId: string;
  actualRef: string | null;
  actualCommit: string | null;
  commands: string[];
  exitCode: number | null;
  verificationOutcome: NexusRemoteExecutionVerificationOutcome;
  outputTail: string | null;
  artifactRefs: string[];
  cleanupStatus: NexusRemoteExecutionCleanupStatus;
  blockerSafetyReason: string | null;
}

export interface NexusRemoteExecutionStore {
  version: 1;
  updatedAt: string | null;
  nextRequestNumber: number;
  requests: NexusRemoteExecutionRequestRecord[];
  results: NexusRemoteExecutionResultRecord[];
}

export interface CreateNexusRemoteExecutionRequestOptions {
  projectRoot: string;
  componentId?: string | null;
  workItemId?: string | null;
  requestingHostId: string;
  requestingAgentId?: string | null;
  targetHostId?: string | null;
  requiredCapabilities?: string[];
  runnerProfileId: string;
  repository: string;
  ref: string;
  commandProfileId: string;
  timeoutMs: number;
  expectedArtifacts?: string[];
  mutationClass: NexusRunnerMutationClass;
  initialStatus?: string;
  attachmentRefs?: NexusRemoteExecutionAttachmentRef[];
  now?: Date | string | (() => Date | string);
}

export interface RecordNexusRemoteExecutionResultOptions {
  projectRoot: string;
  requestId: string;
  status: string;
  hostId: string;
  runnerProfileId: string;
  actualRef?: string | null;
  actualCommit?: string | null;
  commands?: string[];
  exitCode?: number | null;
  verificationOutcome: string;
  outputTail?: string | null;
  artifactRefs?: string[];
  cleanupStatus: string;
  blockerSafetyReason?: string | null;
  now?: Date | string | (() => Date | string);
}

export interface GetNexusRemoteExecutionRecordOptions {
  projectRoot: string;
  requestId: string;
}

export interface NexusRemoteExecutionRecordLookup {
  storePath: string;
  request: NexusRemoteExecutionRequestRecord;
  result: NexusRemoteExecutionResultRecord | null;
}

interface ResolvedRemoteExecutionContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  workItemId: string | null;
}

const terminalRequestStatuses = new Set<NexusRemoteExecutionRequestStatus>([
  "completed",
  "failed",
  "blocked",
  "timed_out",
  "cancelled",
]);

export class NexusRemoteExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusRemoteExecutionError";
  }
}

export function nexusRemoteExecutionStorePath(projectRoot: string): string {
  return path.join(
    path.resolve(requiredNonEmptyString(projectRoot, "projectRoot")),
    ".dev-nexus",
    nexusRemoteExecutionStoreFileName,
  );
}

export function emptyNexusRemoteExecutionStore():
  NexusRemoteExecutionStore {
  return {
    version: 1,
    updatedAt: null,
    nextRequestNumber: 1,
    requests: [],
    results: [],
  };
}

export function readNexusRemoteExecutionStore(
  projectRoot: string,
): NexusRemoteExecutionStore {
  const storePath = nexusRemoteExecutionStorePath(projectRoot);
  if (!fs.existsSync(storePath)) {
    return emptyNexusRemoteExecutionStore();
  }

  return normalizeNexusRemoteExecutionStore(
    JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function writeNexusRemoteExecutionStore(
  projectRoot: string,
  store: NexusRemoteExecutionStore,
): string {
  const storePath = nexusRemoteExecutionStorePath(projectRoot);
  const normalized = normalizeNexusRemoteExecutionStore(store);
  const temporaryPath = temporaryStorePath(storePath);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(temporaryPath, storePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw new NexusRemoteExecutionError(
      `Failed to write remote execution store at ${path.resolve(storePath)}: ${errorDetail(error)}`,
    );
  }

  return storePath;
}

export function createNexusRemoteExecutionRequest(
  options: CreateNexusRemoteExecutionRequestOptions,
): NexusRemoteExecutionRequestRecord {
  const context = resolveRemoteExecutionContext(options);
  const timestamp = currentTimestamp(options.now);
  const targetHostId =
    optionalNullableTrimmedString(options.targetHostId, "targetHostId") ??
    null;
  const requiredCapabilities = normalizedStringArray(
    options.requiredCapabilities,
    "requiredCapabilities",
  );
  if (!targetHostId && requiredCapabilities.length === 0) {
    throw new NexusRemoteExecutionError(
      "remote execution request requires targetHostId or requiredCapabilities",
    );
  }

  const store = readNexusRemoteExecutionStore(context.projectRoot);
  const id = `remote-exec-${store.nextRequestNumber}`;
  const request: NexusRemoteExecutionRequestRecord = {
    kind: nexusRemoteExecutionRequestKind,
    version: 1,
    id,
    projectId: context.projectConfig.id,
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    componentName: context.component.name,
    workItemId: context.workItemId,
    requestingHostId: requiredNonEmptyString(
      options.requestingHostId,
      "requestingHostId",
    ),
    requestingAgentId:
      optionalNullableTrimmedString(
        options.requestingAgentId,
        "requestingAgentId",
      ) ?? null,
    targetHostId,
    requiredCapabilities,
    runnerProfileId: requiredNonEmptyString(
      options.runnerProfileId,
      "runnerProfileId",
    ),
    repository: requiredNonEmptyString(options.repository, "repository"),
    ref: requiredNonEmptyString(options.ref, "ref"),
    commandProfileId: requiredNonEmptyString(
      options.commandProfileId,
      "commandProfileId",
    ),
    timeoutMs: positiveInteger(options.timeoutMs, "timeoutMs"),
    expectedArtifacts: normalizedStringArray(
      options.expectedArtifacts,
      "expectedArtifacts",
    ),
    mutationClass: parseMutationClass(options.mutationClass, "mutationClass"),
    status: parseNexusRemoteExecutionRequestStatus(
      options.initialStatus ?? "queued",
      "initialStatus",
    ),
    attachmentRefs: normalizeAttachmentRefs({
      componentId: context.component.id,
      workItemId: context.workItemId,
      attachmentRefs: options.attachmentRefs,
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeNexusRemoteExecutionStore(context.projectRoot, {
    version: 1,
    updatedAt: timestamp,
    nextRequestNumber: store.nextRequestNumber + 1,
    requests: [...store.requests, request],
    results: store.results,
  });

  return request;
}

export function recordNexusRemoteExecutionResult(
  options: RecordNexusRemoteExecutionResultOptions,
): NexusRemoteExecutionResultRecord {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const timestamp = currentTimestamp(options.now);
  const status = parseNexusRemoteExecutionRequestStatus(
    options.status,
    "status",
  );
  const resultInput = {
    hostId: requiredNonEmptyString(options.hostId, "hostId"),
    runnerProfileId: requiredNonEmptyString(
      options.runnerProfileId,
      "runnerProfileId",
    ),
    actualRef:
      optionalNullableTrimmedString(options.actualRef, "actualRef") ?? null,
    actualCommit:
      optionalNullableTrimmedString(options.actualCommit, "actualCommit") ??
      null,
    commands: normalizedStringArray(options.commands, "commands"),
    exitCode: optionalNullableInteger(options.exitCode, "exitCode"),
    verificationOutcome: parseVerificationOutcome(
      options.verificationOutcome,
      "verificationOutcome",
    ),
    outputTail: boundedOutputTail(options.outputTail),
    artifactRefs: normalizedStringArray(options.artifactRefs, "artifactRefs"),
    cleanupStatus: parseCleanupStatus(options.cleanupStatus, "cleanupStatus"),
    blockerSafetyReason:
      optionalNullableTrimmedString(
        options.blockerSafetyReason,
        "blockerSafetyReason",
      ) ?? null,
  };
  if (status === "blocked" && !resultInput.blockerSafetyReason) {
    throw new NexusRemoteExecutionError(
      "blocked remote execution results require blockerSafetyReason",
    );
  }

  const requestId = requiredNonEmptyString(options.requestId, "requestId");
  const store = readNexusRemoteExecutionStore(projectRoot);
  const requestIndex = store.requests.findIndex(
    (request) => request.id === requestId,
  );
  if (requestIndex < 0) {
    throw new NexusRemoteExecutionError(
      `remote execution request was not found: ${requestId}`,
    );
  }
  const request = store.requests[requestIndex]!;
  assertStatusTransition(request.status, status);
  const result: NexusRemoteExecutionResultRecord = {
    kind: nexusRemoteExecutionResultKind,
    version: 1,
    id: `remote-result-${requestId}`,
    requestId,
    projectId: request.projectId,
    componentId: request.componentId,
    recordedAt: timestamp,
    status,
    ...resultInput,
  };
  const updatedRequest: NexusRemoteExecutionRequestRecord = {
    ...request,
    status,
    updatedAt: timestamp,
  };
  const requests = [...store.requests];
  requests[requestIndex] = updatedRequest;
  const results = [
    ...store.results.filter((candidate) => candidate.requestId !== requestId),
    result,
  ];

  writeNexusRemoteExecutionStore(projectRoot, {
    version: 1,
    updatedAt: timestamp,
    nextRequestNumber: store.nextRequestNumber,
    requests,
    results,
  });

  return result;
}

export function getNexusRemoteExecutionRecord(
  options: GetNexusRemoteExecutionRecordOptions,
): NexusRemoteExecutionRecordLookup {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const requestId = requiredNonEmptyString(options.requestId, "requestId");
  const storePath = nexusRemoteExecutionStorePath(projectRoot);
  const store = readNexusRemoteExecutionStore(projectRoot);
  const request = store.requests.find((candidate) => candidate.id === requestId);
  if (!request) {
    throw new NexusRemoteExecutionError(
      `remote execution request was not found: ${requestId}`,
    );
  }

  return {
    storePath,
    request,
    result:
      store.results.find((candidate) => candidate.requestId === requestId) ??
      null,
  };
}

export function parseNexusRemoteExecutionRequestStatus(
  value: string,
  pathName: string,
): NexusRemoteExecutionRequestStatus {
  if (
    nexusRemoteExecutionRequestStatuses.includes(
      value as NexusRemoteExecutionRequestStatus,
    )
  ) {
    return value as NexusRemoteExecutionRequestStatus;
  }

  throw new NexusRemoteExecutionError(
    `${pathName} must be queued, accepted, running, completed, failed, blocked, timed_out, or cancelled`,
  );
}

export function parseNexusRemoteExecutionVerificationOutcome(
  value: string,
  pathName: string,
): NexusRemoteExecutionVerificationOutcome {
  return parseVerificationOutcome(value, pathName);
}

export function parseNexusRemoteExecutionCleanupStatus(
  value: string,
  pathName: string,
): NexusRemoteExecutionCleanupStatus {
  return parseCleanupStatus(value, pathName);
}

export function normalizeNexusRemoteExecutionStore(
  value: unknown,
): NexusRemoteExecutionStore {
  if (value === undefined || value === null) {
    return emptyNexusRemoteExecutionStore();
  }
  const record = assertRecord(value, "remote execution store");
  if (record.version !== 1) {
    throw new NexusRemoteExecutionError(
      "remote execution store.version must be 1",
    );
  }

  return {
    version: 1,
    updatedAt:
      optionalNullableTrimmedString(record.updatedAt, "store.updatedAt") ??
      null,
    nextRequestNumber: positiveInteger(
      record.nextRequestNumber,
      "store.nextRequestNumber",
    ),
    requests: normalizeArray(record.requests, "store.requests").map(
      normalizeRequestRecord,
    ),
    results: normalizeArray(record.results, "store.results").map(
      normalizeResultRecord,
    ),
  };
}

function resolveRemoteExecutionContext(
  options: Pick<
    CreateNexusRemoteExecutionRequestOptions,
    "projectRoot" | "componentId" | "workItemId"
  >,
): ResolvedRemoteExecutionContext {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const qualifiedWorkItem = parseComponentQualifiedWorkItemId(
    options.workItemId,
    components,
  );
  const componentId =
    optionalNullableTrimmedString(options.componentId, "componentId") ??
    qualifiedWorkItem?.componentId ??
    null;
  if (
    componentId &&
    qualifiedWorkItem &&
    componentId !== qualifiedWorkItem.componentId
  ) {
    throw new NexusRemoteExecutionError(
      `Work item id component "${qualifiedWorkItem.componentId}" conflicts with component "${componentId}"`,
    );
  }
  const component = componentId
    ? components.find((candidate) => candidate.id === componentId)
    : resolvePrimaryProjectComponent(projectRoot, projectConfig);
  if (!component) {
    throw new NexusRemoteExecutionError(
      `Workspace component is not configured: ${componentId}`,
    );
  }

  return {
    projectRoot,
    projectConfig,
    component,
    workItemId:
      qualifiedWorkItem?.itemId ??
      optionalNullableTrimmedString(options.workItemId, "workItemId") ??
      null,
  };
}

function parseComponentQualifiedWorkItemId(
  value: string | null | undefined,
  components: ResolvedNexusProjectComponent[],
): { componentId: string; itemId: string } | null {
  const raw = optionalNullableTrimmedString(value, "workItemId");
  if (!raw) {
    return null;
  }
  const split = raw.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/u);
  if (!split) {
    return null;
  }
  const componentId = split[1]!;
  const itemId = split[2]!.trim();
  if (!itemId) {
    return null;
  }
  if (!components.some((component) => component.id === componentId)) {
    return null;
  }

  return { componentId, itemId };
}

function normalizeAttachmentRefs(options: {
  componentId: string;
  workItemId: string | null;
  attachmentRefs?: NexusRemoteExecutionAttachmentRef[];
}): NexusRemoteExecutionAttachmentRef[] {
  const refs: NexusRemoteExecutionAttachmentRef[] = [];
  if (options.workItemId) {
    refs.push({
      kind: "work_item",
      componentId: options.componentId,
      workItemId: options.workItemId,
    });
  }
  for (const ref of options.attachmentRefs ?? []) {
    refs.push(normalizeAttachmentRef(ref));
  }

  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = attachmentRefKey(ref);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeAttachmentRef(
  value: unknown,
): NexusRemoteExecutionAttachmentRef {
  const record = assertRecord(value, "attachmentRef");
  const kind = requiredNonEmptyString(record.kind, "attachmentRef.kind");
  if (kind === "work_item") {
    return {
      kind,
      componentId: requiredNonEmptyString(
        record.componentId,
        "attachmentRef.componentId",
      ),
      workItemId: requiredNonEmptyString(
        record.workItemId,
        "attachmentRef.workItemId",
      ),
    };
  }
  if (kind === "coordination_record") {
    return {
      kind,
      componentId: requiredNonEmptyString(
        record.componentId,
        "attachmentRef.componentId",
      ),
      recordId: requiredNonEmptyString(
        record.recordId,
        "attachmentRef.recordId",
      ),
      workItemId:
        optionalNullableTrimmedString(
          record.workItemId,
          "attachmentRef.workItemId",
        ) ?? null,
    };
  }

  throw new NexusRemoteExecutionError(
    "attachmentRef.kind must be work_item or coordination_record",
  );
}

function attachmentRefKey(ref: NexusRemoteExecutionAttachmentRef): string {
  if (ref.kind === "work_item") {
    return [ref.kind, ref.componentId, ref.workItemId].join("\u0000");
  }

  return [
    ref.kind,
    ref.componentId,
    ref.recordId,
    ref.workItemId ?? "",
  ].join("\u0000");
}

function normalizeRequestRecord(value: unknown): NexusRemoteExecutionRequestRecord {
  const record = assertRecord(value, "remote execution request");
  if (record.kind !== nexusRemoteExecutionRequestKind || record.version !== 1) {
    throw new NexusRemoteExecutionError(
      "remote execution request must be a version 1 DevNexus remote execution request",
    );
  }

  return {
    kind: nexusRemoteExecutionRequestKind,
    version: 1,
    id: requiredNonEmptyString(record.id, "request.id"),
    projectId: requiredNonEmptyString(record.projectId, "request.projectId"),
    projectRoot: requiredNonEmptyString(record.projectRoot, "request.projectRoot"),
    componentId: requiredNonEmptyString(
      record.componentId,
      "request.componentId",
    ),
    componentName: requiredNonEmptyString(
      record.componentName,
      "request.componentName",
    ),
    workItemId:
      optionalNullableTrimmedString(record.workItemId, "request.workItemId") ??
      null,
    requestingHostId: requiredNonEmptyString(
      record.requestingHostId,
      "request.requestingHostId",
    ),
    requestingAgentId:
      optionalNullableTrimmedString(
        record.requestingAgentId,
        "request.requestingAgentId",
      ) ?? null,
    targetHostId:
      optionalNullableTrimmedString(record.targetHostId, "request.targetHostId") ??
      null,
    requiredCapabilities: normalizedStringArray(
      record.requiredCapabilities,
      "request.requiredCapabilities",
    ),
    runnerProfileId: requiredNonEmptyString(
      record.runnerProfileId,
      "request.runnerProfileId",
    ),
    repository: requiredNonEmptyString(record.repository, "request.repository"),
    ref: requiredNonEmptyString(record.ref, "request.ref"),
    commandProfileId: requiredNonEmptyString(
      record.commandProfileId,
      "request.commandProfileId",
    ),
    timeoutMs: positiveInteger(record.timeoutMs, "request.timeoutMs"),
    expectedArtifacts: normalizedStringArray(
      record.expectedArtifacts,
      "request.expectedArtifacts",
    ),
    mutationClass: parseMutationClass(record.mutationClass, "request.mutationClass"),
    status: parseNexusRemoteExecutionRequestStatus(
      requiredNonEmptyString(record.status, "request.status"),
      "request.status",
    ),
    attachmentRefs: normalizeArray(
      record.attachmentRefs,
      "request.attachmentRefs",
    ).map(normalizeAttachmentRef),
    createdAt: requiredNonEmptyString(record.createdAt, "request.createdAt"),
    updatedAt: requiredNonEmptyString(record.updatedAt, "request.updatedAt"),
  };
}

function normalizeResultRecord(value: unknown): NexusRemoteExecutionResultRecord {
  const record = assertRecord(value, "remote execution result");
  if (record.kind !== nexusRemoteExecutionResultKind || record.version !== 1) {
    throw new NexusRemoteExecutionError(
      "remote execution result must be a version 1 DevNexus remote execution result",
    );
  }

  return {
    kind: nexusRemoteExecutionResultKind,
    version: 1,
    id: requiredNonEmptyString(record.id, "result.id"),
    requestId: requiredNonEmptyString(record.requestId, "result.requestId"),
    projectId: requiredNonEmptyString(record.projectId, "result.projectId"),
    componentId: requiredNonEmptyString(record.componentId, "result.componentId"),
    recordedAt: requiredNonEmptyString(record.recordedAt, "result.recordedAt"),
    status: parseNexusRemoteExecutionRequestStatus(
      requiredNonEmptyString(record.status, "result.status"),
      "result.status",
    ),
    hostId: requiredNonEmptyString(record.hostId, "result.hostId"),
    runnerProfileId: requiredNonEmptyString(
      record.runnerProfileId,
      "result.runnerProfileId",
    ),
    actualRef:
      optionalNullableTrimmedString(record.actualRef, "result.actualRef") ??
      null,
    actualCommit:
      optionalNullableTrimmedString(
        record.actualCommit,
        "result.actualCommit",
      ) ?? null,
    commands: normalizedStringArray(record.commands, "result.commands"),
    exitCode: optionalNullableInteger(record.exitCode, "result.exitCode"),
    verificationOutcome: parseVerificationOutcome(
      requiredNonEmptyString(
        record.verificationOutcome,
        "result.verificationOutcome",
      ),
      "result.verificationOutcome",
    ),
    outputTail: boundedOutputTail(record.outputTail),
    artifactRefs: normalizedStringArray(record.artifactRefs, "result.artifactRefs"),
    cleanupStatus: parseCleanupStatus(
      requiredNonEmptyString(record.cleanupStatus, "result.cleanupStatus"),
      "result.cleanupStatus",
    ),
    blockerSafetyReason:
      optionalNullableTrimmedString(
        record.blockerSafetyReason,
        "result.blockerSafetyReason",
      ) ?? null,
  };
}

function assertStatusTransition(
  current: NexusRemoteExecutionRequestStatus,
  next: NexusRemoteExecutionRequestStatus,
): void {
  if (current === next) {
    return;
  }
  if (terminalRequestStatuses.has(current)) {
    throw new NexusRemoteExecutionError(
      `remote execution request ${current} status is terminal and cannot transition to ${next}`,
    );
  }
  if (current === "queued") {
    return;
  }
  if (current === "accepted" && next !== "queued") {
    return;
  }
  if (
    current === "running" &&
    (next === "completed" ||
      next === "failed" ||
      next === "blocked" ||
      next === "timed_out" ||
      next === "cancelled")
  ) {
    return;
  }

  throw new NexusRemoteExecutionError(
    `remote execution request cannot transition from ${current} to ${next}`,
  );
}

function parseMutationClass(
  value: unknown,
  pathName: string,
): NexusRunnerMutationClass {
  if (
    value === "none" ||
    value === "verification" ||
    value === "project_local" ||
    value === "live_runtime" ||
    value === "destructive"
  ) {
    return value;
  }

  throw new NexusRemoteExecutionError(
    `${pathName} must be none, verification, project_local, live_runtime, or destructive`,
  );
}

function parseVerificationOutcome(
  value: string,
  pathName: string,
): NexusRemoteExecutionVerificationOutcome {
  if (
    value === "passed" ||
    value === "failed" ||
    value === "not_run" ||
    value === "blocked" ||
    value === "timed_out" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new NexusRemoteExecutionError(
    `${pathName} must be passed, failed, not_run, blocked, timed_out, or cancelled`,
  );
}

function parseCleanupStatus(
  value: string,
  pathName: string,
): NexusRemoteExecutionCleanupStatus {
  if (
    value === "not_required" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new NexusRemoteExecutionError(
    `${pathName} must be not_required, completed, failed, blocked, or unknown`,
  );
}

function boundedOutputTail(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new NexusRemoteExecutionError("outputTail must be a string or null");
  }
  if (value.length > maxNexusRemoteExecutionOutputTailLength) {
    throw new NexusRemoteExecutionError(
      `outputTail must be at most ${maxNexusRemoteExecutionOutputTailLength} characters`,
    );
  }

  return value;
}

function currentTimestamp(now?: Date | string | (() => Date | string)): string {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusRemoteExecutionError("now must be a valid date");
  }

  return date.toISOString();
}

function normalizedStringArray(
  values: unknown,
  pathName: string,
): string[] {
  if (values === undefined || values === null) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new NexusRemoteExecutionError(`${pathName} must be an array`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const normalized = requiredNonEmptyString(value, `${pathName}[${index}]`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });

  return result;
}

function normalizeArray(value: unknown, pathName: string): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusRemoteExecutionError(`${pathName} must be an array`);
  }

  return value;
}

function optionalNullableInteger(value: unknown, pathName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new NexusRemoteExecutionError(`${pathName} must be an integer or null`);
  }

  return value;
}

function positiveInteger(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusRemoteExecutionError(`${pathName} must be a positive integer`);
  }

  return value;
}

function optionalNullableTrimmedString(
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

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusRemoteExecutionError(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusRemoteExecutionError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function temporaryStorePath(storePath: string): string {
  const directory = path.dirname(storePath);
  const basename = path.basename(storePath);
  return path.join(directory, `.${basename}.${temporaryStoreNonce()}.tmp`);
}

function errorDetail(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
