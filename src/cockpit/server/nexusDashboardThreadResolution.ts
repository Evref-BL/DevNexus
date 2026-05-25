import fs from "node:fs";
import path from "node:path";
import { nexusWorktreeLeaseStorePath } from "../../worktrees/nexusWorktreeLease.js";
import type { NexusDashboardThreadRecord } from "./nexusDashboardTypes.js";

export type NexusDashboardThreadResolutionAction = "archive" | "forget";

export interface NexusDashboardThreadResolutionRecord {
  id: string;
  action: NexusDashboardThreadResolutionAction;
  threadId: string;
  threadKey: string;
  title: string;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
  decidedAt: string;
  source: "dashboard";
}

export interface NexusDashboardThreadResolutionStore {
  version: 1;
  updatedAt: string | null;
  records: NexusDashboardThreadResolutionRecord[];
}

export function nexusDashboardThreadResolutionStorePath(projectRoot: string): string {
  return path.join(
    path.dirname(nexusWorktreeLeaseStorePath(projectRoot)),
    "dashboard-thread-resolutions.json",
  );
}

export function emptyNexusDashboardThreadResolutionStore(): NexusDashboardThreadResolutionStore {
  return {
    version: 1,
    updatedAt: null,
    records: [],
  };
}

export function readNexusDashboardThreadResolutionStore(
  projectRoot: string,
): NexusDashboardThreadResolutionStore {
  const storePath = nexusDashboardThreadResolutionStorePath(projectRoot);
  if (!fs.existsSync(storePath)) {
    return emptyNexusDashboardThreadResolutionStore();
  }

  return normalizeNexusDashboardThreadResolutionStore(
    JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/u, "")),
  );
}

export function writeNexusDashboardThreadResolutionStore(
  projectRoot: string,
  store: NexusDashboardThreadResolutionStore,
): string {
  const storePath = nexusDashboardThreadResolutionStorePath(projectRoot);
  const normalized = normalizeNexusDashboardThreadResolutionStore(store);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return storePath;
}

export function recordNexusDashboardThreadResolution(options: {
  projectRoot: string;
  action: NexusDashboardThreadResolutionAction;
  thread: NexusDashboardThreadRecord;
  now?: () => Date | string;
}): NexusDashboardThreadResolutionRecord {
  const decidedAt = isoString(options.now?.() ?? new Date());
  const threadKey = threadRecordKey(options.thread);
  const record: NexusDashboardThreadResolutionRecord = {
    id: `${options.action}:${options.thread.id}`,
    action: options.action,
    threadId: options.thread.id,
    threadKey,
    title: options.thread.title,
    componentId: options.thread.componentId,
    workItemId: options.thread.workItemId,
    branchName: options.thread.branchName,
    decidedAt,
    source: "dashboard",
  };
  const previous = readNexusDashboardThreadResolutionStore(options.projectRoot);
  const records = previous.records.filter((candidate) =>
    candidate.threadId !== record.threadId && candidate.threadKey !== record.threadKey
  );
  const nextStore: NexusDashboardThreadResolutionStore = {
    version: 1,
    updatedAt: decidedAt,
    records: [...records, record],
  };
  writeNexusDashboardThreadResolutionStore(options.projectRoot, nextStore);
  return record;
}

export function threadRecordKey(record: NexusDashboardThreadRecord): string {
  return [
    record.componentId ?? "workspace",
    record.branchName ?? record.workItemId ?? record.title ?? record.id,
  ].join(":");
}

function normalizeNexusDashboardThreadResolutionStore(
  value: unknown,
): NexusDashboardThreadResolutionStore {
  const record = objectRecord(value, "thread resolution store");
  const records = Array.isArray(record.records)
    ? record.records.map(normalizeNexusDashboardThreadResolutionRecord)
    : [];
  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    records,
  };
}

function normalizeNexusDashboardThreadResolutionRecord(
  value: unknown,
): NexusDashboardThreadResolutionRecord {
  const record = objectRecord(value, "thread resolution");
  const action = dashboardThreadResolutionAction(record.action);
  const threadId = stringField(record.threadId, "threadId");
  const threadKey = stringField(record.threadKey, "threadKey");
  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : `${action}:${threadId}`,
    action,
    threadId,
    threadKey,
    title: stringField(record.title, "title"),
    componentId: nullableStringField(record.componentId),
    workItemId: nullableStringField(record.workItemId),
    branchName: nullableStringField(record.branchName),
    decidedAt: stringField(record.decidedAt, "decidedAt"),
    source: "dashboard",
  };
}

function dashboardThreadResolutionAction(
  value: unknown,
): NexusDashboardThreadResolutionAction {
  if (value === "archive" || value === "forget") {
    return value;
  }
  throw new Error("thread resolution action must be archive or forget");
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function nullableStringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
