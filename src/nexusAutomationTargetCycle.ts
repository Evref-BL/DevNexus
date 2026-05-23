import fs from "node:fs";
import path from "node:path";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  normalizeNexusAuthorityProjectSummary,
  type NexusAuthorityProjectSummary,
} from "./nexusAuthority.js";
import { secureRandomIdSuffix } from "./nexusSecureRandom.js";
import type { WorkStatus } from "./workTrackingTypes.js";

export const maxNexusAutomationTargetCycleNoteLength = 1000;

export type NexusAutomationTargetCycleStatus =
  | "started"
  | "dispatched"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type NexusAutomationTargetCycleWorkItemStatus =
  | "eligible"
  | "selected"
  | "dispatched"
  | "in_progress"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export interface NexusAutomationTargetCycleWorkItem {
  componentId: string | null;
  trackerId: string | null;
  trackerProvider: string | null;
  id: string;
  logicalItemId: string | null;
  title: string | null;
  status: WorkStatus | null;
  cycleStatus: NexusAutomationTargetCycleWorkItemStatus | null;
  agentProfileId: string | null;
  notes: string | null;
}

export interface NexusAutomationTargetCycleRecord {
  id: string;
  projectId: string;
  targetId: string | null;
  runId: string | null;
  status: NexusAutomationTargetCycleStatus;
  startedAt: string;
  finishedAt: string | null;
  objective: string | null;
  summary: string | null;
  eligibleWorkItemCount: number | null;
  workItems: NexusAutomationTargetCycleWorkItem[];
  authority: NexusAuthorityProjectSummary | null;
  blockers: string[];
  notes: string[];
  nextCycleNotBefore: string | null;
}

export interface NexusAutomationTargetCycleRecordInput {
  id?: string;
  projectId: string;
  targetId?: string | null;
  runId?: string | null;
  status: NexusAutomationTargetCycleStatus;
  startedAt?: string;
  finishedAt?: string | null;
  objective?: string | null;
  summary?: string | null;
  eligibleWorkItemCount?: number | null;
  workItems?: NexusAutomationTargetCycleWorkItemInput[];
  authority?: NexusAuthorityProjectSummary | null;
  blockers?: string[];
  notes?: string[];
  nextCycleNotBefore?: string | null;
}

export interface NexusAutomationTargetCycleWorkItemInput {
  componentId?: string | null;
  trackerId?: string | null;
  trackerProvider?: string | null;
  id: string;
  logicalItemId?: string | null;
  title?: string | null;
  status?: WorkStatus | null;
  cycleStatus?: NexusAutomationTargetCycleWorkItemStatus | null;
  agentProfileId?: string | null;
  notes?: string | null;
}

export interface NexusAutomationTargetCycleLedger {
  version: 1;
  cycles: NexusAutomationTargetCycleRecord[];
  updatedAt: string | null;
}

export interface AppendNexusAutomationTargetCycleRecordOptions {
  projectRoot: string;
  config: NexusAutomationConfig;
  record: NexusAutomationTargetCycleRecordInput;
  now?: Date | string;
}

export interface RecordNexusAutomationTargetCycleRecordOptions {
  projectRoot: string;
  config: NexusAutomationConfig;
  record: NexusAutomationTargetCycleRecordInput;
  now?: Date | string;
}

export interface NexusAutomationTargetCycleSummary {
  ledgerPath: string;
  cycleCount: number;
  activeCycleCount: number;
  completedCycleCount: number;
  blockedCycleCount: number;
  failedCycleCount: number;
  skippedCycleCount: number;
  lastCycle: NexusAutomationTargetCycleRecord | null;
}

export class NexusAutomationTargetCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationTargetCycleError";
  }
}

export function nexusAutomationTargetCycleLedgerPath(
  projectRoot: string,
  config: NexusAutomationConfig,
): string {
  return resolveProjectRelativePath(
    projectRoot,
    config.target.cycleLedgerPath,
    "automation.target.cycleLedgerPath",
  );
}

export function emptyNexusAutomationTargetCycleLedger():
  NexusAutomationTargetCycleLedger {
  return {
    version: 1,
    cycles: [],
    updatedAt: null,
  };
}

export function readNexusAutomationTargetCycleLedger(
  projectRoot: string,
  config: NexusAutomationConfig,
): NexusAutomationTargetCycleLedger {
  const ledgerPath = nexusAutomationTargetCycleLedgerPath(projectRoot, config);
  if (!fs.existsSync(ledgerPath)) {
    return emptyNexusAutomationTargetCycleLedger();
  }

  return normalizeNexusAutomationTargetCycleLedger(
    JSON.parse(fs.readFileSync(ledgerPath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function writeNexusAutomationTargetCycleLedger(
  projectRoot: string,
  config: NexusAutomationConfig,
  ledger: NexusAutomationTargetCycleLedger,
): string {
  const ledgerPath = nexusAutomationTargetCycleLedgerPath(projectRoot, config);
  const normalized = normalizeNexusAutomationTargetCycleLedger(ledger);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(
    ledgerPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );

  return ledgerPath;
}

export function appendNexusAutomationTargetCycleRecord(
  options: AppendNexusAutomationTargetCycleRecordOptions,
): NexusAutomationTargetCycleLedger {
  const recordedAt = isoString(options.now ?? new Date());
  const record = normalizeTargetCycleRecordInput(options.record, recordedAt);
  const existing = readNexusAutomationTargetCycleLedger(
    options.projectRoot,
    options.config,
  );
  assertTargetCycleIdIsAvailable(existing, record.id);
  const cycles = [...existing.cycles, record].slice(
    -options.config.ledger.retention,
  );
  const ledger: NexusAutomationTargetCycleLedger = {
    version: 1,
    cycles,
    updatedAt: recordedAt,
  };
  writeNexusAutomationTargetCycleLedger(
    options.projectRoot,
    options.config,
    ledger,
  );

  return ledger;
}

function assertTargetCycleIdIsAvailable(
  ledger: NexusAutomationTargetCycleLedger,
  cycleId: string,
): void {
  if (!ledger.cycles.some((cycle) => cycle.id === cycleId)) {
    return;
  }

  throw new NexusAutomationTargetCycleError(
    `target cycle id already exists: ${cycleId}. Choose a new --cycle-id or inspect the existing record with automation target-cycle list before retrying.`,
  );
}

export function recordNexusAutomationTargetCycleRecord(
  options: RecordNexusAutomationTargetCycleRecordOptions,
): NexusAutomationTargetCycleLedger {
  const recordedAt = isoString(options.now ?? new Date());
  const record = normalizeTargetCycleRecordInput(options.record, recordedAt);
  const existing = readNexusAutomationTargetCycleLedger(
    options.projectRoot,
    options.config,
  );
  const cycles = [
    ...existing.cycles.filter((cycle) => cycle.id !== record.id),
    record,
  ].slice(-options.config.ledger.retention);
  const ledger: NexusAutomationTargetCycleLedger = {
    version: 1,
    cycles,
    updatedAt: recordedAt,
  };
  writeNexusAutomationTargetCycleLedger(
    options.projectRoot,
    options.config,
    ledger,
  );

  return ledger;
}

export function summarizeNexusAutomationTargetCycles(options: {
  projectRoot: string;
  config: NexusAutomationConfig;
}): NexusAutomationTargetCycleSummary {
  const ledgerPath = nexusAutomationTargetCycleLedgerPath(
    options.projectRoot,
    options.config,
  );
  const ledger = readNexusAutomationTargetCycleLedger(
    options.projectRoot,
    options.config,
  );

  return {
    ledgerPath,
    cycleCount: ledger.cycles.length,
    activeCycleCount: ledger.cycles.filter(isActiveCycle).length,
    completedCycleCount: ledger.cycles.filter(
      (cycle) => cycle.status === "completed",
    ).length,
    blockedCycleCount: ledger.cycles.filter(
      (cycle) => cycle.status === "blocked",
    ).length,
    failedCycleCount: ledger.cycles.filter((cycle) => cycle.status === "failed")
      .length,
    skippedCycleCount: ledger.cycles.filter(
      (cycle) => cycle.status === "skipped",
    ).length,
    lastCycle: ledger.cycles.at(-1) ?? null,
  };
}

export function normalizeNexusAutomationTargetCycleLedger(
  value: unknown,
): NexusAutomationTargetCycleLedger {
  if (value === undefined || value === null) {
    return emptyNexusAutomationTargetCycleLedger();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationTargetCycleError(
      "target cycle ledger must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new NexusAutomationTargetCycleError(
      "target cycle ledger.version must be 1",
    );
  }
  if (!Array.isArray(record.cycles)) {
    throw new NexusAutomationTargetCycleError(
      "target cycle ledger.cycles must be an array",
    );
  }

  return {
    version: 1,
    cycles: record.cycles.map(normalizeTargetCycleRecord),
    updatedAt: optionalIsoString(record.updatedAt, "target cycle ledger.updatedAt"),
  };
}

export function generateNexusAutomationTargetCycleId(
  now: Date | string = new Date(),
): string {
  const timestamp = isoString(now)
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "-");
  const suffix = secureRandomIdSuffix();

  return `target-cycle-${timestamp}-${suffix}`;
}

function normalizeTargetCycleRecordInput(
  input: NexusAutomationTargetCycleRecordInput,
  recordedAt: string,
): NexusAutomationTargetCycleRecord {
  const status = normalizeCycleStatus(input.status, "target cycle.status");
  return normalizeTargetCycleRecord({
    ...input,
    id: input.id ?? generateNexusAutomationTargetCycleId(recordedAt),
    targetId: input.targetId ?? null,
    runId: input.runId ?? null,
    startedAt: input.startedAt ?? recordedAt,
    finishedAt:
      input.finishedAt === undefined
        ? defaultFinishedAt(status, recordedAt)
        : input.finishedAt,
    objective: input.objective ?? null,
    summary: input.summary ?? null,
    eligibleWorkItemCount: input.eligibleWorkItemCount ?? null,
    workItems: input.workItems ?? [],
    authority: input.authority ?? null,
    blockers: input.blockers ?? [],
    notes: input.notes ?? [],
    nextCycleNotBefore: input.nextCycleNotBefore ?? null,
  });
}

function normalizeTargetCycleRecord(
  value: unknown,
): NexusAutomationTargetCycleRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationTargetCycleError(
      "target cycle record must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    id: requiredNonEmptyString(record.id, "target cycle.id"),
    projectId: requiredNonEmptyString(record.projectId, "target cycle.projectId"),
    targetId: optionalNullableString(record.targetId) ?? null,
    runId: optionalNullableString(record.runId) ?? null,
    status: normalizeCycleStatus(record.status, "target cycle.status"),
    startedAt: requiredIsoString(record.startedAt, "target cycle.startedAt"),
    finishedAt: optionalIsoString(record.finishedAt, "target cycle.finishedAt"),
    objective: optionalNullableString(record.objective) ?? null,
    summary: optionalNullableString(record.summary) ?? null,
    eligibleWorkItemCount: optionalNullableNonNegativeInteger(
      record.eligibleWorkItemCount,
      "target cycle.eligibleWorkItemCount",
    ),
    workItems: normalizeWorkItems(record.workItems),
    authority: optionalAuthoritySummary(record.authority),
    blockers: normalizeStringArray(record.blockers, "target cycle.blockers"),
    notes: normalizeStringArray(
      record.notes,
      "target cycle.notes",
      maxNexusAutomationTargetCycleNoteLength,
    ),
    nextCycleNotBefore: optionalIsoString(
      record.nextCycleNotBefore,
      "target cycle.nextCycleNotBefore",
    ),
  };
}

function normalizeWorkItems(
  value: unknown,
): NexusAutomationTargetCycleWorkItem[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationTargetCycleError(
      "target cycle.workItems must be an array",
    );
  }

  return value.map((item, index) => normalizeWorkItem(item, index));
}

function normalizeWorkItem(
  value: unknown,
  index: number,
): NexusAutomationTargetCycleWorkItem {
  const pathName = `target cycle.workItems[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationTargetCycleError(`${pathName} must be an object`);
  }

  const record = value as Record<string, unknown>;
  return {
    componentId: optionalNullableString(record.componentId) ?? null,
    trackerId: optionalNullableString(record.trackerId) ?? null,
    trackerProvider: optionalNullableString(record.trackerProvider) ?? null,
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    logicalItemId: optionalNullableString(record.logicalItemId) ?? null,
    title: optionalNullableString(record.title) ?? null,
    status: optionalWorkStatus(record.status, `${pathName}.status`),
    cycleStatus: optionalCycleWorkItemStatus(
      record.cycleStatus,
      `${pathName}.cycleStatus`,
    ),
    agentProfileId: optionalNullableString(record.agentProfileId) ?? null,
    notes:
      boundedOptionalNullableString(
        record.notes,
        `${pathName}.notes`,
        maxNexusAutomationTargetCycleNoteLength,
      ) ?? null,
  };
}

function isActiveCycle(cycle: NexusAutomationTargetCycleRecord): boolean {
  return cycle.status === "started" || cycle.status === "dispatched";
}

function defaultFinishedAt(
  status: NexusAutomationTargetCycleStatus,
  recordedAt: string,
): string | null {
  return status === "started" || status === "dispatched" ? null : recordedAt;
}

function resolveProjectRelativePath(
  projectRoot: string,
  configuredPath: string,
  fieldName: string,
): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, configuredPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationTargetCycleError(
      `${fieldName} must resolve inside the workspace root: ${target}`,
    );
  }

  return target;
}

function normalizeCycleStatus(
  value: unknown,
  name: string,
): NexusAutomationTargetCycleStatus {
  if (
    value === "started" ||
    value === "dispatched" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new NexusAutomationTargetCycleError(
    `${name} must be started, dispatched, completed, blocked, failed, or skipped`,
  );
}

function optionalCycleWorkItemStatus(
  value: unknown,
  name: string,
): NexusAutomationTargetCycleWorkItemStatus | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    value === "eligible" ||
    value === "selected" ||
    value === "dispatched" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new NexusAutomationTargetCycleError(
    `${name} must be eligible, selected, dispatched, in_progress, completed, blocked, failed, or skipped`,
  );
}

function optionalWorkStatus(value: unknown, name: string): WorkStatus | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    value === "todo" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done" ||
    value === "wont_do"
  ) {
    return value;
  }

  throw new NexusAutomationTargetCycleError(
    `${name} must be todo, ready, in_progress, blocked, done, or wont_do`,
  );
}

function optionalAuthoritySummary(
  value: unknown,
): NexusAuthorityProjectSummary | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeNexusAuthorityProjectSummary(value, "target cycle.authority");
}

function normalizeStringArray(
  value: unknown,
  name: string,
  maxLength?: number,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationTargetCycleError(`${name} must be an array`);
  }

  return value.map((item, index) => {
    const stringValue = requiredNonEmptyString(item, `${name}[${index}]`);
    if (maxLength !== undefined && stringValue.length > maxLength) {
      throw new NexusAutomationTargetCycleError(
        `${name}[${index}] must be at most ${maxLength} characters`,
      );
    }

    return stringValue;
  });
}

function optionalNullableNonNegativeInteger(
  value: unknown,
  name: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new NexusAutomationTargetCycleError(
      `${name} must be a non-negative integer or null`,
    );
  }

  return value;
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
    throw new NexusAutomationTargetCycleError(`${name} must be a valid date`);
  }

  return date;
}

function boundedOptionalNullableString(
  value: unknown,
  name: string,
  maxLength: number,
): string | null | undefined {
  const stringValue = optionalNullableString(value, name);
  if (stringValue === undefined || stringValue === null) {
    return stringValue;
  }
  if (stringValue.length > maxLength) {
    throw new NexusAutomationTargetCycleError(
      `${name} must be at most ${maxLength} characters`,
    );
  }

  return stringValue;
}

function optionalNullableString(
  value: unknown,
  name = "value",
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationTargetCycleError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
