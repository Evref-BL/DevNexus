import fs from "node:fs";
import path from "node:path";

export type WorktreeVerificationStatus = "passed" | "failed" | "not_run";
export type WorktreePublicationDecisionType =
  | "not_decided"
  | "local_only"
  | "direct_integration"
  | "review_handoff"
  | "blocked";

export interface WorktreeVerificationInput {
  command: string;
  status?: WorktreeVerificationStatus;
  summary?: string | null;
}

export interface WorktreeVerificationRecord {
  command: string;
  status: WorktreeVerificationStatus;
  summary: string | null;
  recordedAt: string;
}

export interface WorktreePublicationDecisionInput {
  type: WorktreePublicationDecisionType;
  targetBranch?: string | null;
  remote?: string | null;
  prUrl?: string | null;
  reason?: string | null;
}

export interface WorktreePublicationDecision {
  type: WorktreePublicationDecisionType;
  targetBranch: string | null;
  remote: string | null;
  prUrl: string | null;
  reason: string | null;
  decidedAt: string;
}

export interface WorktreeOwnerWorkItem {
  id: string;
  title: string | null;
}

export interface WorktreeOwnershipMetadata {
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: WorktreeOwnerWorkItem | null;
}

export interface WorktreeExecutionMetadata {
  worktree: WorktreeOwnershipMetadata | null;
  commitIds: string[];
  verification: WorktreeVerificationRecord[];
  publicationDecision: WorktreePublicationDecision | null;
  updatedAt: string | null;
}

export interface WorktreeExecutionUpdate {
  worktree?: WorktreeOwnershipMetadata | null;
  commitIds?: string[];
  verification?: WorktreeVerificationInput;
  publicationDecision?: WorktreePublicationDecisionInput;
}

export const worktreeExecutionMetadataDirectoryName = ".dev-nexus";
export const worktreeExecutionMetadataFileName = "execution.json";

export class WorktreeExecutionMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeExecutionMetadataError";
  }
}

export function emptyWorktreeExecutionMetadata(): WorktreeExecutionMetadata {
  return {
    worktree: null,
    commitIds: [],
    verification: [],
    publicationDecision: null,
    updatedAt: null,
  };
}

export function worktreeExecutionMetadataPath(worktreePath: string): string {
  return path.join(
    path.resolve(requiredNonEmptyString(worktreePath, "worktreePath")),
    worktreeExecutionMetadataDirectoryName,
    worktreeExecutionMetadataFileName,
  );
}

export function readWorktreeExecutionMetadata(
  worktreePath: string,
): WorktreeExecutionMetadata {
  const metadataPath = worktreeExecutionMetadataPath(worktreePath);
  if (!fs.existsSync(metadataPath)) {
    return emptyWorktreeExecutionMetadata();
  }

  return normalizeWorktreeExecutionMetadata(
    JSON.parse(fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function writeWorktreeExecutionMetadata(
  worktreePath: string,
  metadata: WorktreeExecutionMetadata,
): string {
  const metadataPath = worktreeExecutionMetadataPath(worktreePath);
  const normalized = normalizeWorktreeExecutionMetadata(metadata);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );

  return metadataPath;
}

export function updateWorktreeExecutionMetadata(
  worktreePath: string,
  update: WorktreeExecutionUpdate,
  now: Date | string = new Date(),
): WorktreeExecutionMetadata {
  const updated = applyWorktreeExecutionUpdate(
    readWorktreeExecutionMetadata(worktreePath),
    update,
    isoString(now),
  );
  writeWorktreeExecutionMetadata(worktreePath, updated);

  return updated;
}

export function hasWorktreeExecutionUpdate(
  update: WorktreeExecutionUpdate,
): boolean {
  return Boolean(
    Object.prototype.hasOwnProperty.call(update, "worktree") ||
      update.commitIds?.length ||
      update.verification ||
      update.publicationDecision,
  );
}

export function applyWorktreeExecutionUpdate(
  existing: unknown,
  update: WorktreeExecutionUpdate,
  updatedAt: string,
): WorktreeExecutionMetadata {
  if (!hasWorktreeExecutionUpdate(update)) {
    throw new WorktreeExecutionMetadataError(
      "At least one execution field is required",
    );
  }

  const execution = normalizeWorktreeExecutionMetadata(existing);
  const worktree = Object.prototype.hasOwnProperty.call(update, "worktree")
    ? normalizeWorktreeOwnership(update.worktree)
    : execution.worktree;
  const commitIds = [...execution.commitIds];
  for (const commitId of update.commitIds ?? []) {
    const normalized = requiredNonEmptyString(commitId, "commitId");
    if (!commitIds.includes(normalized)) {
      commitIds.push(normalized);
    }
  }

  const verification = [...execution.verification];
  if (update.verification) {
    verification.push({
      command: requiredNonEmptyString(
        update.verification.command,
        "verification.command",
      ),
      status: update.verification.status ?? "passed",
      summary: optionalNullableString(update.verification.summary) ?? null,
      recordedAt: requiredNonEmptyString(updatedAt, "updatedAt"),
    });
  }

  const publicationDecision = update.publicationDecision
    ? {
        type: normalizePublicationDecisionType(
          update.publicationDecision.type,
          "publicationDecision.type",
        ),
        targetBranch:
          optionalNullableString(update.publicationDecision.targetBranch) ?? null,
        remote: optionalNullableString(update.publicationDecision.remote) ?? null,
        prUrl: optionalNullableString(update.publicationDecision.prUrl) ?? null,
        reason: optionalNullableString(update.publicationDecision.reason) ?? null,
        decidedAt: requiredNonEmptyString(updatedAt, "updatedAt"),
      }
    : execution.publicationDecision;

  return {
    worktree,
    commitIds,
    verification,
    publicationDecision,
    updatedAt: requiredNonEmptyString(updatedAt, "updatedAt"),
  };
}

export function normalizeWorktreeExecutionMetadata(
  value: unknown,
): WorktreeExecutionMetadata {
  if (value === undefined || value === null) {
    return emptyWorktreeExecutionMetadata();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new WorktreeExecutionMetadataError(
      "worktree execution metadata must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    worktree: normalizeWorktreeOwnership(record.worktree),
    commitIds: normalizeStringArray(record.commitIds, "execution.commitIds"),
    verification: normalizeVerificationRecords(record.verification),
    publicationDecision: normalizePublicationDecision(record.publicationDecision),
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : null,
  };
}

export function worktreeOwnershipMetadataFromPreparedWorktree(value: {
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: WorktreeOwnerWorkItem | null;
}): WorktreeOwnershipMetadata {
  const normalized = normalizeWorktreeOwnership(value);
  if (!normalized) {
    throw new WorktreeExecutionMetadataError(
      "prepared worktree ownership metadata is required",
    );
  }

  return normalized;
}

function normalizeWorktreeOwnership(
  value: unknown,
): WorktreeOwnershipMetadata | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new WorktreeExecutionMetadataError(
      "execution.worktree must be an object or null",
    );
  }

  const record = value as Record<string, unknown>;
  const sourceRoot = path.resolve(
    requiredNonEmptyString(record.sourceRoot, "execution.worktree.sourceRoot"),
  );
  const worktreesRoot = path.resolve(
    requiredNonEmptyString(
      record.worktreesRoot,
      "execution.worktree.worktreesRoot",
    ),
  );
  const worktreePath = path.resolve(
    requiredNonEmptyString(
      record.worktreePath,
      "execution.worktree.worktreePath",
    ),
  );
  assertWorktreePathInsideRoot(worktreesRoot, worktreePath);

  return {
    componentId: requiredNonEmptyString(
      record.componentId,
      "execution.worktree.componentId",
    ),
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName: requiredNonEmptyString(
      record.branchName,
      "execution.worktree.branchName",
    ),
    baseRef: optionalNullableString(record.baseRef) ?? null,
    workItem: normalizeWorktreeOwnerWorkItem(record.workItem),
  };
}

function normalizeWorktreeOwnerWorkItem(
  value: unknown,
): WorktreeOwnerWorkItem | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new WorktreeExecutionMetadataError(
      "execution.worktree.workItem must be an object or null",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    id: requiredNonEmptyString(
      record.id,
      "execution.worktree.workItem.id",
    ),
    title: optionalNullableString(record.title) ?? null,
  };
}

function assertWorktreePathInsideRoot(
  worktreesRoot: string,
  worktreePath: string,
): void {
  const relative = path.relative(worktreesRoot, worktreePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WorktreeExecutionMetadataError(
      `execution.worktree.worktreePath must resolve inside worktreesRoot: ${worktreePath}`,
    );
  }
}

function normalizeVerificationRecords(
  value: unknown,
): WorktreeVerificationRecord[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WorktreeExecutionMetadataError(
      "execution.verification must be an array",
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new WorktreeExecutionMetadataError(
        `execution.verification[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      command: requiredNonEmptyString(
        record.command,
        `execution.verification[${index}].command`,
      ),
      status: normalizeVerificationStatus(
        record.status,
        `execution.verification[${index}].status`,
      ),
      summary: optionalNullableString(record.summary) ?? null,
      recordedAt: requiredNonEmptyString(
        record.recordedAt,
        `execution.verification[${index}].recordedAt`,
      ),
    };
  });
}

function normalizePublicationDecision(
  value: unknown,
): WorktreePublicationDecision | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new WorktreeExecutionMetadataError(
      "execution.publicationDecision must be an object or null",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    type: normalizePublicationDecisionType(
      record.type,
      "execution.publicationDecision.type",
    ),
    targetBranch: optionalNullableString(record.targetBranch) ?? null,
    remote: optionalNullableString(record.remote) ?? null,
    prUrl: optionalNullableString(record.prUrl) ?? null,
    reason: optionalNullableString(record.reason) ?? null,
    decidedAt: requiredNonEmptyString(
      record.decidedAt,
      "execution.publicationDecision.decidedAt",
    ),
  };
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WorktreeExecutionMetadataError(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${name}[${index}]`),
  );
}

function normalizeVerificationStatus(
  value: unknown,
  name: string,
): WorktreeVerificationStatus {
  if (value === "passed" || value === "failed" || value === "not_run") {
    return value;
  }

  throw new WorktreeExecutionMetadataError(
    `${name} must be passed, failed, or not_run`,
  );
}

function normalizePublicationDecisionType(
  value: unknown,
  name: string,
): WorktreePublicationDecisionType {
  if (
    value === "not_decided" ||
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new WorktreeExecutionMetadataError(
    `${name} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
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

function isoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new WorktreeExecutionMetadataError("now must be a valid date");
  }

  return date.toISOString();
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorktreeExecutionMetadataError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
