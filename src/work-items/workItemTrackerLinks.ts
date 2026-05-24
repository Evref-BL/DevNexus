import fs from "node:fs";
import path from "node:path";
import type {
  ExternalRef,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";
import type {
  ResolvedWorkItemProjectContext,
  WorkItemProjectResolver,
  WorkItemProjectSelector,
} from "./workItemService.js";
import { temporaryStoreNonce } from "../runtime/nexusSecureRandom.js";

export const workItemTrackerLinkStoreVersion = 1;
export const workItemTrackerLinkStoreFileName = "work-item-links.json";

export interface WorkItemTrackerReference extends ExternalRef {
  trackerId: string;
  trackerName?: string;
  firstObservedAt: string;
  lastObservedAt: string;
}

export type WorkItemTrackerLinkAuditAction = "linked" | "updated" | "unlinked";

export interface WorkItemTrackerLinkAuditEntry {
  id: string;
  action: WorkItemTrackerLinkAuditAction;
  at: string;
  trackerId: string;
  itemId: string;
  reference?: WorkItemTrackerReference;
  previousReference?: WorkItemTrackerReference;
  removedReference?: WorkItemTrackerReference;
  reason?: string | null;
}

export interface WorkItemTrackerLinkRecord {
  projectId: string;
  componentId: string;
  logicalItemId: string;
  createdAt: string;
  updatedAt: string;
  references: WorkItemTrackerReference[];
  audit: WorkItemTrackerLinkAuditEntry[];
}

export interface WorkItemTrackerLinkStore {
  version: typeof workItemTrackerLinkStoreVersion;
  nextAuditNumber: number;
  updatedAt: string;
  records: WorkItemTrackerLinkRecord[];
}

export interface WorkItemTrackerLinkServiceOptions {
  resolveProject: WorkItemProjectResolver;
  now?: () => Date | string;
}

export type WorkItemTrackerLinkProjectSelector = Omit<
  WorkItemProjectSelector,
  "trackerId"
>;

export interface WorkItemTrackerReferenceInput {
  trackerId: string;
  provider?: string;
  host?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  itemId: string;
  itemNumber?: number | null;
  itemKey?: string | null;
  nodeId?: string | null;
  webUrl?: string | null;
  observedAt?: string | null;
}

export interface LinkWorkItemTrackerReferenceInput
  extends WorkItemTrackerLinkProjectSelector,
    WorkItemTrackerReferenceInput {
  logicalItemId: string;
}

export interface ShowWorkItemTrackerLinksInput
  extends WorkItemTrackerLinkProjectSelector {
  logicalItemId: string;
}

export interface UnlinkWorkItemTrackerReferenceInput
  extends WorkItemTrackerLinkProjectSelector {
  logicalItemId: string;
  trackerId: string;
  itemId: string;
  reason?: string | null;
}

export interface LinkWorkItemTrackerReferenceResult {
  projectRoot: string;
  projectId: string;
  componentId: string;
  logicalItemId: string;
  action: "linked" | "updated" | "unchanged";
  reference: WorkItemTrackerReference;
  record: WorkItemTrackerLinkRecord;
  storePath: string;
}

export interface ShowWorkItemTrackerLinksResult {
  projectRoot: string;
  projectId: string;
  componentId: string;
  logicalItemId: string;
  record: WorkItemTrackerLinkRecord | null;
  references: WorkItemTrackerReference[];
  storePath: string;
}

export interface UnlinkWorkItemTrackerReferenceResult {
  projectRoot: string;
  projectId: string;
  componentId: string;
  logicalItemId: string;
  removedReference: WorkItemTrackerReference;
  audit: WorkItemTrackerLinkAuditEntry;
  record: WorkItemTrackerLinkRecord;
  storePath: string;
}

interface ResolvedLinkContext {
  projectContext: ResolvedWorkItemProjectContext;
  projectRoot: string;
  projectId: string;
  componentId: string;
}

interface NormalizedTrackerContext {
  id: string;
  name: string;
  enabled: boolean;
  roles: string[];
  workTracking: WorkTrackingConfig;
}

export class WorkItemTrackerLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkItemTrackerLinkError";
  }
}

export function createWorkItemTrackerLinkService(
  options: WorkItemTrackerLinkServiceOptions,
): WorkItemTrackerLinkService {
  return new WorkItemTrackerLinkService(options);
}

export function defaultWorkItemTrackerLinkStorePath(projectRoot: string): string {
  return path.join(
    resolveProjectRoot(projectRoot),
    ".dev-nexus",
    workItemTrackerLinkStoreFileName,
  );
}

export function loadWorkItemTrackerLinkStore(
  storePath: string,
  timestamp: string = new Date().toISOString(),
): WorkItemTrackerLinkStore {
  if (!fs.existsSync(storePath)) {
    return emptyStore(timestamp);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new WorkItemTrackerLinkError(
      `Failed to parse work-item tracker link store at ${path.resolve(storePath)}: ${errorDetail(error)}`,
    );
  }

  return validateStore(raw);
}

export function saveWorkItemTrackerLinkStore(
  storePath: string,
  store: WorkItemTrackerLinkStore,
): void {
  const normalized = validateStore(store);
  const temporaryPath = temporaryStorePath(storePath);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  try {
    writeTextFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`);
    fs.renameSync(temporaryPath, storePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw new WorkItemTrackerLinkError(
      `Failed to write work-item tracker link store at ${path.resolve(storePath)}: ${errorDetail(error)}`,
    );
  }
}

export class WorkItemTrackerLinkService {
  private readonly resolveProject: WorkItemProjectResolver;
  private readonly nowProvider: () => Date | string;

  constructor(options: WorkItemTrackerLinkServiceOptions) {
    this.resolveProject = options.resolveProject;
    this.nowProvider = options.now ?? (() => new Date());
  }

  async linkReference(
    input: LinkWorkItemTrackerReferenceInput,
  ): Promise<LinkWorkItemTrackerReferenceResult> {
    const timestamp = this.now();
    const context = await this.resolveContext(input);
    const tracker = resolveTracker(context.projectContext, input.trackerId);
    const logicalItemId = requiredNonEmptyString(
      input.logicalItemId,
      "logicalItemId",
    );
    const reference = normalizeTrackerReference({
      input,
      tracker,
      timestamp,
    });
    const storePath = defaultWorkItemTrackerLinkStorePath(context.projectRoot);
    const store = loadWorkItemTrackerLinkStore(storePath, timestamp);
    const record = findOrCreateRecord({
      store,
      context,
      logicalItemId,
      timestamp,
    });
    const existingIndex = record.references.findIndex(
      (candidate) => trackerReferenceKey(candidate) === trackerReferenceKey(reference),
    );

    let action: LinkWorkItemTrackerReferenceResult["action"] = "linked";
    let previousReference: WorkItemTrackerReference | undefined;
    if (existingIndex >= 0) {
      previousReference = record.references[existingIndex]!;
      const updatedReference: WorkItemTrackerReference = {
        ...previousReference,
        ...reference,
        firstObservedAt: previousReference.firstObservedAt,
      };
      action = deepEqual(previousReference, updatedReference)
        ? "unchanged"
        : "updated";
      record.references[existingIndex] = updatedReference;
    } else {
      record.references.push(reference);
    }

    const savedReference =
      existingIndex >= 0 ? record.references[existingIndex]! : reference;
    if (action !== "unchanged") {
      record.audit.push(
        nextAuditEntry(store, {
          action,
          at: timestamp,
          trackerId: savedReference.trackerId,
          itemId: savedReference.itemId,
          reference: savedReference,
          previousReference,
        }),
      );
      record.updatedAt = timestamp;
      store.updatedAt = timestamp;
      saveWorkItemTrackerLinkStore(storePath, store);
    }

    return {
      projectRoot: context.projectRoot,
      projectId: context.projectId,
      componentId: context.componentId,
      logicalItemId,
      action,
      reference: savedReference,
      record,
      storePath,
    };
  }

  async showLinks(
    input: ShowWorkItemTrackerLinksInput,
  ): Promise<ShowWorkItemTrackerLinksResult> {
    const timestamp = this.now();
    const context = await this.resolveContext(input);
    const logicalItemId = requiredNonEmptyString(
      input.logicalItemId,
      "logicalItemId",
    );
    const storePath = defaultWorkItemTrackerLinkStorePath(context.projectRoot);
    const store = loadWorkItemTrackerLinkStore(storePath, timestamp);
    const record =
      store.records.find(
        (candidate) =>
          candidate.projectId === context.projectId &&
          candidate.componentId === context.componentId &&
          candidate.logicalItemId === logicalItemId,
      ) ?? null;

    return {
      projectRoot: context.projectRoot,
      projectId: context.projectId,
      componentId: context.componentId,
      logicalItemId,
      record,
      references: record?.references ?? [],
      storePath,
    };
  }

  async unlinkReference(
    input: UnlinkWorkItemTrackerReferenceInput,
  ): Promise<UnlinkWorkItemTrackerReferenceResult> {
    const timestamp = this.now();
    const context = await this.resolveContext(input);
    resolveTracker(context.projectContext, input.trackerId);
    const logicalItemId = requiredNonEmptyString(
      input.logicalItemId,
      "logicalItemId",
    );
    const itemId = requiredNonEmptyString(input.itemId, "itemId");
    const trackerId = requiredNonEmptyString(input.trackerId, "trackerId");
    const storePath = defaultWorkItemTrackerLinkStorePath(context.projectRoot);
    const store = loadWorkItemTrackerLinkStore(storePath, timestamp);
    const record = store.records.find(
      (candidate) =>
        candidate.projectId === context.projectId &&
        candidate.componentId === context.componentId &&
        candidate.logicalItemId === logicalItemId,
    );
    if (!record) {
      throw new WorkItemTrackerLinkError(
        `Work-item tracker link record was not found for ${context.componentId}:${logicalItemId}`,
      );
    }

    const referenceIndex = record.references.findIndex(
      (candidate) =>
        candidate.trackerId === trackerId && candidate.itemId === itemId,
    );
    if (referenceIndex < 0) {
      throw new WorkItemTrackerLinkError(
        `Tracker reference was not found for tracker "${trackerId}" item "${itemId}"`,
      );
    }

    const [removedReference] = record.references.splice(referenceIndex, 1);
    const audit = nextAuditEntry(store, {
      action: "unlinked",
      at: timestamp,
      trackerId,
      itemId,
      removedReference,
      reason: optionalNullableString(input.reason, "reason") ?? null,
    });
    record.audit.push(audit);
    record.updatedAt = timestamp;
    store.updatedAt = timestamp;
    saveWorkItemTrackerLinkStore(storePath, store);

    return {
      projectRoot: context.projectRoot,
      projectId: context.projectId,
      componentId: context.componentId,
      logicalItemId,
      removedReference,
      audit,
      record,
      storePath,
    };
  }

  private async resolveContext(
    selector: WorkItemTrackerLinkProjectSelector,
  ): Promise<ResolvedLinkContext> {
    const normalized = normalizeProjectSelectorObject(selector);
    const projectContext = await this.resolveProject(normalized);
    return {
      projectContext,
      projectRoot: path.resolve(projectContext.projectRoot),
      projectId: requiredNonEmptyString(projectContext.projectId, "projectId"),
      componentId: requiredNonEmptyString(
        projectContext.componentId ?? "primary",
        "componentId",
      ),
    };
  }

  private now(): string {
    const value = this.nowProvider();
    return typeof value === "string" ? value : value.toISOString();
  }
}

function normalizeTrackerReference(options: {
  input: WorkItemTrackerReferenceInput;
  tracker: NormalizedTrackerContext;
  timestamp: string;
}): WorkItemTrackerReference {
  const { input, tracker, timestamp } = options;
  const config = tracker.workTracking;
  const provider = optionalNonEmptyString(input.provider, "provider") ?? config.provider;
  if (provider !== config.provider) {
    throw new WorkItemTrackerLinkError(
      `Tracker reference provider "${provider}" does not match tracker "${tracker.id}" provider "${config.provider}"`,
    );
  }

  const host = chooseNullableMetadata({
    name: "host",
    observed: input.host,
    configured: config.host,
    trackerId: tracker.id,
  });
  const repositoryId = chooseNullableMetadata({
    name: "repositoryId",
    observed: input.repositoryId,
    configured: config.repository?.id,
    trackerId: tracker.id,
  });
  const repositoryOwner = chooseNullableMetadata({
    name: "repositoryOwner",
    observed: input.repositoryOwner,
    configured: config.repository?.owner,
    trackerId: tracker.id,
  });
  const repositoryName = chooseNullableMetadata({
    name: "repositoryName",
    observed: input.repositoryName,
    configured: config.repository?.name,
    trackerId: tracker.id,
  });
  const projectId = chooseNullableMetadata({
    name: "projectId",
    observed: input.projectId,
    configured: configuredProjectIdentity(config),
    trackerId: tracker.id,
  });
  const boardId = chooseNullableMetadata({
    name: "boardId",
    observed: input.boardId,
    configured: config.board?.id ?? undefined,
    trackerId: tracker.id,
  });
  const itemId = requiredNonEmptyString(input.itemId, "itemId");
  const observedAt =
    optionalNullableString(input.observedAt, "observedAt") ?? timestamp;

  return {
    trackerId: tracker.id,
    trackerName: tracker.name,
    provider,
    host,
    repositoryId,
    repositoryOwner,
    repositoryName,
    projectId,
    boardId,
    itemId,
    itemNumber: optionalPositiveIntegerOrNull(input.itemNumber, "itemNumber"),
    itemKey: optionalNullableString(input.itemKey, "itemKey") ?? null,
    nodeId: optionalNullableString(input.nodeId, "nodeId") ?? null,
    webUrl: optionalNullableString(input.webUrl, "webUrl") ?? null,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
  };
}

function resolveTracker(
  projectContext: ResolvedWorkItemProjectContext,
  trackerIdValue: string,
): NormalizedTrackerContext {
  const trackerId = requiredNonEmptyString(trackerIdValue, "trackerId");
  const trackers = normalizedProjectContextTrackers(projectContext);
  const tracker = trackers.find((candidate) => candidate.id === trackerId);
  if (!tracker) {
    throw new WorkItemTrackerLinkError(
      `Component "${projectContext.componentId ?? "primary"}" work tracker is not configured: ${trackerId}`,
    );
  }
  if (!tracker.enabled) {
    throw new WorkItemTrackerLinkError(
      `Component "${projectContext.componentId ?? "primary"}" work tracker "${tracker.id}" is disabled`,
    );
  }

  return tracker;
}

function normalizedProjectContextTrackers(
  projectContext: ResolvedWorkItemProjectContext,
): NormalizedTrackerContext[] {
  const configured = projectContext.workTrackers ?? [];
  if (configured.length > 0) {
    return configured.map((tracker) => ({
      id: requiredNonEmptyString(tracker.id, "tracker.id"),
      name: tracker.name ?? tracker.id,
      enabled: tracker.enabled ?? true,
      roles: tracker.roles ?? [],
      workTracking: tracker.workTracking,
    }));
  }

  return [
    {
      id:
        projectContext.trackerId ??
        projectContext.defaultTrackerId ??
        "default",
      name:
        projectContext.trackerName ??
        projectContext.trackerId ??
        projectContext.defaultTrackerId ??
        "Default",
      enabled: true,
      roles: projectContext.trackerRoles ?? ["primary"],
      workTracking: projectContext.workTracking,
    },
  ];
}

function configuredProjectIdentity(
  config: WorkTrackingConfig,
): string | null | undefined {
  if (config.provider === "vibe-kanban") {
    return config.projectId;
  }
  if (config.provider === "jira") {
    return config.projectKey;
  }

  return undefined;
}

function chooseNullableMetadata(options: {
  name: string;
  observed: string | null | undefined;
  configured: string | null | undefined;
  trackerId: string;
}): string | null {
  const observed = optionalNullableString(options.observed, options.name);
  const configured = optionalNullableString(options.configured, options.name);
  if (observed && configured && observed !== configured) {
    throw new WorkItemTrackerLinkError(
      `Tracker reference ${options.name} "${observed}" does not match tracker "${options.trackerId}" configured ${options.name} "${configured}"`,
    );
  }

  return observed ?? configured ?? null;
}

function findOrCreateRecord(options: {
  store: WorkItemTrackerLinkStore;
  context: ResolvedLinkContext;
  logicalItemId: string;
  timestamp: string;
}): WorkItemTrackerLinkRecord {
  const existing = options.store.records.find(
    (candidate) =>
      candidate.projectId === options.context.projectId &&
      candidate.componentId === options.context.componentId &&
      candidate.logicalItemId === options.logicalItemId,
  );
  if (existing) {
    return existing;
  }

  const record: WorkItemTrackerLinkRecord = {
    projectId: options.context.projectId,
    componentId: options.context.componentId,
    logicalItemId: options.logicalItemId,
    createdAt: options.timestamp,
    updatedAt: options.timestamp,
    references: [],
    audit: [],
  };
  options.store.records.push(record);
  return record;
}

function nextAuditEntry(
  store: WorkItemTrackerLinkStore,
  entry: Omit<WorkItemTrackerLinkAuditEntry, "id">,
): WorkItemTrackerLinkAuditEntry {
  const audit: WorkItemTrackerLinkAuditEntry = {
    id: `link-audit-${store.nextAuditNumber}`,
    ...entry,
  };
  store.nextAuditNumber += 1;
  return audit;
}

function trackerReferenceKey(reference: WorkItemTrackerReference): string {
  return [reference.trackerId, reference.provider, reference.itemId].join("\u0000");
}

function normalizeProjectSelectorObject(
  selector: WorkItemTrackerLinkProjectSelector,
): WorkItemTrackerLinkProjectSelector {
  const project = optionalNonEmptyString(selector.project, "project");
  const projectRoot = optionalNonEmptyString(selector.projectRoot, "projectRoot");
  const componentId = optionalNonEmptyString(selector.componentId, "componentId");
  if (project && projectRoot) {
    throw new WorkItemTrackerLinkError("Provide either project or projectRoot, not both");
  }
  if (!project && !projectRoot) {
    throw new WorkItemTrackerLinkError("project or projectRoot is required");
  }

  return {
    ...(project ? { project } : { projectRoot }),
    ...(componentId ? { componentId } : {}),
  };
}

function emptyStore(timestamp: string): WorkItemTrackerLinkStore {
  return {
    version: workItemTrackerLinkStoreVersion,
    nextAuditNumber: 1,
    updatedAt: timestamp,
    records: [],
  };
}

function validateStore(value: unknown): WorkItemTrackerLinkStore {
  const record = assertRecord(value, "work-item tracker link store");
  if (record.version !== workItemTrackerLinkStoreVersion) {
    throw new WorkItemTrackerLinkError(
      `work-item tracker link store.version must be ${workItemTrackerLinkStoreVersion}`,
    );
  }
  const records = record.records;
  if (!Array.isArray(records)) {
    throw new WorkItemTrackerLinkError(
      "work-item tracker link store.records must be an array",
    );
  }

  return {
    version: workItemTrackerLinkStoreVersion,
    nextAuditNumber: positiveInteger(record.nextAuditNumber, "nextAuditNumber"),
    updatedAt: requiredNonEmptyString(record.updatedAt, "updatedAt"),
    records: records.map((item, index) => validateLinkRecord(item, index)),
  };
}

function validateLinkRecord(value: unknown, index: number): WorkItemTrackerLinkRecord {
  const record = assertRecord(value, `records[${index}]`);
  const references = record.references;
  if (!Array.isArray(references)) {
    throw new WorkItemTrackerLinkError(
      `records[${index}].references must be an array`,
    );
  }
  const audit = record.audit;
  if (!Array.isArray(audit)) {
    throw new WorkItemTrackerLinkError(`records[${index}].audit must be an array`);
  }

  return {
    projectId: requiredNonEmptyString(record.projectId, `records[${index}].projectId`),
    componentId: requiredNonEmptyString(
      record.componentId,
      `records[${index}].componentId`,
    ),
    logicalItemId: requiredNonEmptyString(
      record.logicalItemId,
      `records[${index}].logicalItemId`,
    ),
    createdAt: requiredNonEmptyString(record.createdAt, `records[${index}].createdAt`),
    updatedAt: requiredNonEmptyString(record.updatedAt, `records[${index}].updatedAt`),
    references: references.map((item, index) => validateReference(item, index)),
    audit: audit.map((item, index) => validateAuditEntry(item, index)),
  };
}

function validateReference(value: unknown, index: number): WorkItemTrackerReference {
  const pathName = `references[${index}]`;
  const record = assertRecord(value, pathName);
  return {
    trackerId: requiredNonEmptyString(record.trackerId, `${pathName}.trackerId`),
    trackerName: optionalNonEmptyString(record.trackerName, `${pathName}.trackerName`),
    provider: requiredNonEmptyString(record.provider, `${pathName}.provider`),
    host: optionalNullableString(record.host, `${pathName}.host`) ?? null,
    repositoryId:
      optionalNullableString(record.repositoryId, `${pathName}.repositoryId`) ?? null,
    repositoryOwner:
      optionalNullableString(record.repositoryOwner, `${pathName}.repositoryOwner`) ??
      null,
    repositoryName:
      optionalNullableString(record.repositoryName, `${pathName}.repositoryName`) ??
      null,
    projectId:
      optionalNullableString(record.projectId, `${pathName}.projectId`) ?? null,
    boardId: optionalNullableString(record.boardId, `${pathName}.boardId`) ?? null,
    itemId: requiredNonEmptyString(record.itemId, `${pathName}.itemId`),
    itemNumber: optionalPositiveIntegerOrNull(record.itemNumber, `${pathName}.itemNumber`),
    itemKey: optionalNullableString(record.itemKey, `${pathName}.itemKey`) ?? null,
    nodeId: optionalNullableString(record.nodeId, `${pathName}.nodeId`) ?? null,
    webUrl: optionalNullableString(record.webUrl, `${pathName}.webUrl`) ?? null,
    firstObservedAt: requiredNonEmptyString(
      record.firstObservedAt,
      `${pathName}.firstObservedAt`,
    ),
    lastObservedAt: requiredNonEmptyString(
      record.lastObservedAt,
      `${pathName}.lastObservedAt`,
    ),
  };
}

function validateAuditEntry(
  value: unknown,
  index: number,
): WorkItemTrackerLinkAuditEntry {
  const pathName = `audit[${index}]`;
  const record = assertRecord(value, pathName);
  const action = record.action;
  if (action !== "linked" && action !== "updated" && action !== "unlinked") {
    throw new WorkItemTrackerLinkError(
      `${pathName}.action must be linked, updated, or unlinked`,
    );
  }

  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    action,
    at: requiredNonEmptyString(record.at, `${pathName}.at`),
    trackerId: requiredNonEmptyString(record.trackerId, `${pathName}.trackerId`),
    itemId: requiredNonEmptyString(record.itemId, `${pathName}.itemId`),
    ...(record.reference !== undefined
      ? { reference: validateReference(record.reference, index) }
      : {}),
    ...(record.previousReference !== undefined
      ? { previousReference: validateReference(record.previousReference, index) }
      : {}),
    ...(record.removedReference !== undefined
      ? { removedReference: validateReference(record.removedReference, index) }
      : {}),
    ...(record.reason !== undefined
      ? { reason: optionalNullableString(record.reason, `${pathName}.reason`) ?? null }
      : {}),
  };
}

function resolveProjectRoot(projectRoot: string): string {
  return path.resolve(requiredNonEmptyString(projectRoot, "projectRoot"));
}

function temporaryStorePath(storePath: string): string {
  const directory = path.dirname(storePath);
  const basename = path.basename(storePath);
  return path.join(directory, `.${basename}.${temporaryStoreNonce()}.tmp`);
}

function writeTextFileSync(filePath: string, content: string): void {
  const handle = fs.openSync(filePath, "w");
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorDetail(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function optionalNonEmptyString(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredNonEmptyString(value, name);
}

function optionalNullableString(
  value: unknown,
  name: string,
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
    throw new WorkItemTrackerLinkError(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function optionalPositiveIntegerOrNull(
  value: unknown,
  name: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new WorkItemTrackerLinkError(`${name} must be a positive integer`);
  }

  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new WorkItemTrackerLinkError(`${name} must be a positive integer`);
  }

  return value;
}

function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkItemTrackerLinkError(`${name} must be an object`);
  }

  return value as Record<string, unknown>;
}
