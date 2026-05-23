import fs from "node:fs";
import path from "node:path";
import {
  assertWorkStatus as assertSharedWorkStatus,
  expandWorkStatusQuery,
  isClosedWorkStatus,
  isWorkStatus,
  matchesRequiredStrings,
  matchesWorkItemSearch,
  matchesWorkStatusFilter,
  normalizeWorkItemLimit,
  normalizeWorkItemSearch,
  normalizeWorkItemStringArray,
  requiredNonEmptyWorkItemString,
} from "./workTrackingQuery.js";
import type {
  CreateWorkItemInput,
  DetectedTracker,
  DetectTrackerInput,
  LocalWorkTrackingConfig,
  NexusProjectContext,
  TrackerCapabilities,
  TrackerProjectRef,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkStatusQuery,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";
import { temporaryStoreNonce } from "./nexusSecureRandom.js";

export const localWorkTrackingDirectoryName = ".dev-nexus";
export const localWorkTrackingStoreFileName = "work-items.json";
export const localWorkTrackingStoreVersion = 1;
const localWorkTrackingStoreLockTimeoutMs = 30_000;
const localWorkTrackingStoreLockRetryMs = 10;

export interface LocalWorkTrackingStore {
  version: typeof localWorkTrackingStoreVersion;
  nextNumber: number;
  nextCommentNumber: number;
  updatedAt: string;
  items: WorkItem[];
  comments: Record<string, WorkComment[]>;
}

export interface LocalWorkTrackerProviderOptions {
  projectRoot?: string;
  config?: LocalWorkTrackingConfig;
  storePath?: string | null;
  now?: () => Date | string;
}

export type LocalWorkTrackingStoreFailureStage =
  | "lock"
  | "read"
  | "parse"
  | "validate"
  | "write";

export interface LocalWorkTrackingStoreDiagnostic {
  provider: "local";
  storePath: string;
  operation: string;
  stage: LocalWorkTrackingStoreFailureStage;
  recovery: string;
  cause: string;
}

export class LocalWorkTrackerProviderError extends Error {
  readonly diagnostic?: LocalWorkTrackingStoreDiagnostic;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      diagnostic?: LocalWorkTrackingStoreDiagnostic;
    } = {},
  ) {
    super(message);
    this.name = "LocalWorkTrackerProviderError";
    this.diagnostic = options.diagnostic;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

const localWorkStatusValidationOptions = {
  errorFactory: localProviderError,
  invalidStatusMessage: invalidLocalWorkStatusMessage,
};

export const localWorkTrackerCapabilities: TrackerCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: true,
  board: false,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

export function defaultLocalWorkTrackingStorePath(projectRoot: string): string {
  return path.join(
    resolveProjectRoot(projectRoot),
    localWorkTrackingDirectoryName,
    localWorkTrackingStoreFileName,
  );
}

export function resolveLocalWorkTrackingStorePath(
  projectRoot: string,
  config?: Pick<LocalWorkTrackingConfig, "storePath"> | string | null,
): string {
  const configuredStorePath =
    typeof config === "string" || config === null
      ? config
      : config?.storePath;

  if (!configuredStorePath) {
    return defaultLocalWorkTrackingStorePath(projectRoot);
  }

  return path.isAbsolute(configuredStorePath)
    ? path.resolve(configuredStorePath)
    : path.resolve(resolveProjectRoot(projectRoot), configuredStorePath);
}

export function createLocalWorkTrackerProvider(
  options: LocalWorkTrackerProviderOptions = {},
): LocalWorkTrackerProvider {
  return new LocalWorkTrackerProvider(options);
}

export class LocalWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider = "local";
  readonly capabilities = localWorkTrackerCapabilities;

  private readonly projectRoot?: string;
  private readonly config?: LocalWorkTrackingConfig;
  private readonly storePath?: string | null;
  private readonly nowProvider: () => Date | string;

  constructor(options: LocalWorkTrackerProviderOptions = {}) {
    this.projectRoot = options.projectRoot;
    this.config = options.config;
    this.storePath = options.storePath;
    this.nowProvider = options.now ?? (() => new Date());
  }

  async detect(input: DetectTrackerInput): Promise<DetectedTracker | undefined> {
    const storePath = this.storePathFor(input.projectRoot);
    if (!fs.existsSync(storePath)) {
      return undefined;
    }

    return {
      confidence: "high",
      config: {
        provider: "local",
        storePath: path.relative(resolveProjectRoot(input.projectRoot), storePath),
      },
      reason: "Found local DevNexus work item store",
    };
  }

  async ensureProject(
    context: NexusProjectContext,
  ): Promise<TrackerProjectRef> {
    const projectRoot = this.resolveProjectRoot(context.projectRoot);
    await this.mutateStore(projectRoot, "ensureProject", () => undefined);

    return {
      provider: "local",
      id: context.projectId,
      name: context.projectName,
      externalRef: {
        provider: "local",
        itemId: context.projectId,
        projectId: context.projectId,
      },
    };
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    const projectRoot = this.resolveProjectRoot(input.projectRoot);
    return this.mutateStore(projectRoot, "createWorkItem", (store) => {
      const number = store.nextNumber;
      const id = `local-${number}`;
      const timestamp = this.now();
      const status = input.status ?? "todo";
      assertWorkStatus(status);

      const item: WorkItem = {
        id,
        title: requiredNonEmptyString(input.title, "title"),
        description: input.description ?? null,
        status,
        provider: "local",
        labels: normalizeStringArray(input.labels, "labels"),
        assignees: normalizeStringArray(input.assignees, "assignees"),
        milestone: optionalNullableString(input.milestone, "milestone") ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        closedAt: isClosedStatus(status) ? timestamp : null,
        webUrl: null,
        externalRef: {
          provider: "local",
          itemId: id,
          itemNumber: number,
        },
      };

      store.items.push(item);
      store.comments[item.id] = [];
      store.nextNumber += 1;
      return item;
    });
  }

  async listWorkItems(query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const projectRoot = this.resolveProjectRoot(query.projectRoot);
    const statuses = normalizeStatusFilter(query.status);

    const labels = normalizeStringArray(query.labels, "labels");
    const assignees = normalizeStringArray(query.assignees, "assignees");
    const search = normalizeWorkItemSearch(query.search);
    const limit = normalizeLimit(query.limit);

    let items = this.loadStore(projectRoot, "listWorkItems").items.filter((item) => {
      if (!matchesWorkStatusFilter(item, statuses)) {
        return false;
      }
      if (!matchesRequiredStrings(item.labels, labels)) {
        return false;
      }
      if (!matchesRequiredStrings(item.assignees, assignees)) {
        return false;
      }
      if (search && !matchesWorkItemSearch(item, search)) {
        return false;
      }

      return true;
    });

    if (limit !== undefined) {
      items = items.slice(0, limit);
    }

    return items;
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    const store = this.loadStore(this.resolveProjectRoot(), "getWorkItem");
    return findWorkItem(store, ref);
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    const projectRoot = this.resolveProjectRoot();
    return this.mutateStore(projectRoot, "updateWorkItem", (store) => {
      const item = findWorkItem(store, ref);
      const timestamp = this.now();

      const updated: WorkItem = {
        ...item,
        updatedAt: timestamp,
      };

      if (patch.title !== undefined) {
        updated.title = requiredNonEmptyString(patch.title, "title");
      }
      if (patch.description !== undefined) {
        updated.description = patch.description;
      }
      if (patch.status !== undefined) {
        assertWorkStatus(patch.status);
        updated.status = patch.status;
        updated.closedAt = isClosedStatus(patch.status)
          ? item.closedAt ?? timestamp
          : null;
      }
      if (patch.labels !== undefined) {
        updated.labels = normalizeStringArray(patch.labels, "labels");
      }
      if (patch.assignees !== undefined) {
        updated.assignees = normalizeStringArray(patch.assignees, "assignees");
      }
      if (patch.milestone !== undefined) {
        updated.milestone = optionalNullableString(patch.milestone, "milestone");
      }

      store.items[store.items.indexOf(item)] = updated;
      return updated;
    });
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    const projectRoot = this.resolveProjectRoot();
    return this.mutateStore(projectRoot, "addComment", (store) => {
      const item = findWorkItem(store, ref);
      const timestamp = this.now();
      const id = `local-comment-${store.nextCommentNumber}`;
      const comment: WorkComment = {
        id,
        body: requiredNonEmptyString(body, "body"),
        author: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        externalRef: {
          provider: "local",
          itemId: id,
        },
      };

      store.nextCommentNumber += 1;
      store.comments[item.id] = [...(store.comments[item.id] ?? []), comment];
      item.updatedAt = timestamp;
      return comment;
    });
  }

  async listComments(ref: WorkItemRef): Promise<WorkComment[]> {
    const projectRoot = this.resolveProjectRoot();
    const store = this.loadStore(projectRoot, "listComments");
    const item = findWorkItem(store, ref);
    return [...(store.comments[item.id] ?? [])];
  }

  async setStatus(ref: WorkItemRef, status: WorkStatus): Promise<WorkItem> {
    return this.updateWorkItem(ref, { status });
  }

  private resolveProjectRoot(projectRoot?: string): string {
    return resolveProjectRoot(projectRoot ?? this.projectRoot);
  }

  private storePathFor(projectRoot: string): string {
    return resolveLocalWorkTrackingStorePath(
      projectRoot,
      this.storePath ?? this.config,
    );
  }

  private loadStore(
    projectRoot: string,
    operation: string,
  ): LocalWorkTrackingStore {
    return loadLocalWorkTrackingStore(
      this.storePathFor(projectRoot),
      this.now(),
      operation,
    );
  }

  private async mutateStore<T>(
    projectRoot: string,
    operation: string,
    mutate: (store: LocalWorkTrackingStore) => T,
  ): Promise<T> {
    return mutateLocalWorkTrackingStore(
      this.storePathFor(projectRoot),
      operation,
      this.now(),
      (store) => {
        const result = mutate(store);
        return {
          store: {
            ...store,
            updatedAt: this.now(),
          },
          result,
        };
      },
    );
  }

  private now(): string {
    const value = this.nowProvider();
    return typeof value === "string" ? value : value.toISOString();
  }
}

export function loadLocalWorkTrackingStore(
  storePath: string,
  timestamp: string = new Date().toISOString(),
  operation = "loadLocalWorkTrackingStore",
): LocalWorkTrackingStore {
  if (!fs.existsSync(storePath)) {
    return emptyStore(timestamp);
  }

  let text: string;
  try {
    text = fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    throw localStoreReadError(storePath, operation, error);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw localStoreParseError(storePath, operation, error);
  }

  try {
    return validateStore(raw);
  } catch (error) {
    throw localStoreValidateError(storePath, operation, error);
  }
}

export function saveLocalWorkTrackingStore(
  storePath: string,
  store: LocalWorkTrackingStore,
  operation = "saveLocalWorkTrackingStore",
): void {
  const normalized = validateStore(store);
  const temporaryPath = temporaryStorePath(storePath);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  try {
    writeTextFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`);
    fs.renameSync(temporaryPath, storePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw localStoreWriteError(storePath, operation, error);
  }
}

async function mutateLocalWorkTrackingStore<T>(
  storePath: string,
  operation: string,
  timestamp: string,
  mutate: (
    store: LocalWorkTrackingStore,
  ) => { store: LocalWorkTrackingStore; result: T },
): Promise<T> {
  const release = await acquireLocalWorkTrackingStoreLock(storePath, operation);
  try {
    const store = loadLocalWorkTrackingStore(storePath, timestamp, operation);
    const mutation = mutate(store);
    saveLocalWorkTrackingStore(storePath, mutation.store, operation);
    return mutation.result;
  } finally {
    release();
  }
}

async function acquireLocalWorkTrackingStoreLock(
  storePath: string,
  operation: string,
): Promise<() => void> {
  const lockPath = localWorkTrackingStoreLockPath(storePath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    if (tryWriteStoreLock(lockPath, storePath, operation)) {
      return () => {
        fs.rmSync(lockPath, { force: true });
      };
    }

    if (Date.now() - startedAt >= localWorkTrackingStoreLockTimeoutMs) {
      throw new LocalWorkTrackerProviderError(
        `Failed to acquire local work item store lock at ${path.resolve(lockPath)} for ${path.resolve(storePath)} during ${operation}. Recovery: confirm no DevNexus process is writing this store, remove the stale lock file if it is safe, and retry.`,
      );
    }

    await delay(localWorkTrackingStoreLockRetryMs);
  }
}

function tryWriteStoreLock(
  lockPath: string,
  storePath: string,
  operation: string,
): boolean {
  try {
    const handle = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(
        handle,
        `${JSON.stringify(
          {
            pid: process.pid,
            operation,
            storePath: path.resolve(storePath),
            acquiredAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
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

function localWorkTrackingStoreLockPath(storePath: string): string {
  return `${storePath}.lock`;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localStoreParseError(
  storePath: string,
  operation: string,
  error: unknown,
): LocalWorkTrackerProviderError {
  const recovery =
    "Repair the JSON store or restore it from backup before retrying.";
  return new LocalWorkTrackerProviderError(
    `Failed to parse local work item store at ${path.resolve(storePath)} during ${operation}. DevNexus did not write changes to this store. Recovery: ${recovery} Original error: ${errorDetail(error)}`,
    {
      cause: error,
      diagnostic: localStoreDiagnostic(storePath, operation, "parse", recovery, error),
    },
  );
}

function localStoreReadError(
  storePath: string,
  operation: string,
  error: unknown,
): LocalWorkTrackerProviderError {
  const recovery =
    "Verify the store path exists and is readable, then retry.";
  return new LocalWorkTrackerProviderError(
    `Failed to read local work item store at ${path.resolve(storePath)} during ${operation}. Recovery: ${recovery} Original error: ${errorDetail(error)}`,
    {
      cause: error,
      diagnostic: localStoreDiagnostic(storePath, operation, "read", recovery, error),
    },
  );
}

function localStoreValidateError(
  storePath: string,
  operation: string,
  error: unknown,
): LocalWorkTrackerProviderError {
  const recovery =
    "Repair the local work item store schema or restore it from backup before retrying.";
  return new LocalWorkTrackerProviderError(
    `Failed to validate local work item store at ${path.resolve(storePath)} during ${operation}. Recovery: ${recovery} Original error: ${errorDetail(error)}`,
    {
      cause: error,
      diagnostic: localStoreDiagnostic(storePath, operation, "validate", recovery, error),
    },
  );
}

function localStoreWriteError(
  storePath: string,
  operation: string,
  error: unknown,
): LocalWorkTrackerProviderError {
  const recovery =
    "Verify filesystem permissions and free space, then retry.";
  return new LocalWorkTrackerProviderError(
    `Failed to write local work item store at ${path.resolve(storePath)} during ${operation}. Recovery: ${recovery} Original error: ${errorDetail(error)}`,
    {
      cause: error,
      diagnostic: localStoreDiagnostic(storePath, operation, "write", recovery, error),
    },
  );
}

function localStoreDiagnostic(
  storePath: string,
  operation: string,
  stage: LocalWorkTrackingStoreFailureStage,
  recovery: string,
  error: unknown,
): LocalWorkTrackingStoreDiagnostic {
  return {
    provider: "local",
    storePath: path.resolve(storePath),
    operation,
    stage,
    recovery,
    cause: errorDetail(error),
  };
}

function errorDetail(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function emptyStore(timestamp: string): LocalWorkTrackingStore {
  return {
    version: localWorkTrackingStoreVersion,
    nextNumber: 1,
    nextCommentNumber: 1,
    updatedAt: timestamp,
    items: [],
    comments: {},
  };
}

function resolveProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot || projectRoot.trim().length === 0) {
    throw new LocalWorkTrackerProviderError("projectRoot is required");
  }

  return path.resolve(projectRoot);
}

function validateStore(value: unknown): LocalWorkTrackingStore {
  const record = assertRecord(value, "local work tracking store");
  if (record.version !== localWorkTrackingStoreVersion) {
    throw new LocalWorkTrackerProviderError(
      `local work tracking store.version must be ${localWorkTrackingStoreVersion}`,
    );
  }

  const items = record.items;
  if (!Array.isArray(items)) {
    throw new LocalWorkTrackerProviderError(
      "local work tracking store.items must be an array",
    );
  }

  return {
    version: localWorkTrackingStoreVersion,
    nextNumber: positiveInteger(record.nextNumber, "nextNumber"),
    nextCommentNumber: positiveInteger(
      record.nextCommentNumber,
      "nextCommentNumber",
    ),
    updatedAt: requiredNonEmptyString(record.updatedAt, "updatedAt"),
    items: items.map((item, index) => validateWorkItem(item, index)),
    comments: validateComments(record.comments),
  };
}

function validateWorkItem(value: unknown, index: number): WorkItem {
  const record = assertRecord(value, `items[${index}]`);
  if (record.provider !== "local") {
    throw new LocalWorkTrackerProviderError(
      `items[${index}].provider must be local`,
    );
  }

  const status = workStatus(record.status, `items[${index}].status`);
  return {
    id: requiredNonEmptyString(record.id, `items[${index}].id`),
    title: requiredNonEmptyString(record.title, `items[${index}].title`),
    description:
      optionalNullableText(record.description, `items[${index}].description`) ??
      null,
    status,
    provider: "local",
    labels: stringArray(record.labels, `items[${index}].labels`),
    assignees: stringArray(record.assignees, `items[${index}].assignees`),
    milestone:
      optionalNullableString(record.milestone, `items[${index}].milestone`) ??
      null,
    createdAt:
      optionalNullableString(record.createdAt, `items[${index}].createdAt`) ??
      null,
    updatedAt:
      optionalNullableString(record.updatedAt, `items[${index}].updatedAt`) ??
      null,
    closedAt:
      optionalNullableString(record.closedAt, `items[${index}].closedAt`) ??
      null,
    webUrl:
      optionalNullableString(record.webUrl, `items[${index}].webUrl`) ?? null,
    externalRef: {
      provider: "local",
      itemId: requiredNonEmptyString(record.id, `items[${index}].id`),
      itemNumber: localItemNumber(record),
    },
  };
}

function validateComments(value: unknown): Record<string, WorkComment[]> {
  if (value === undefined) {
    return {};
  }

  const record = assertRecord(value, "comments");
  const comments: Record<string, WorkComment[]> = {};
  for (const [itemId, itemComments] of Object.entries(record)) {
    if (!Array.isArray(itemComments)) {
      throw new LocalWorkTrackerProviderError(
        `comments.${itemId} must be an array`,
      );
    }

    comments[itemId] = itemComments.map((comment, index) =>
      validateComment(comment, `comments.${itemId}[${index}]`),
    );
  }

  return comments;
}

function validateComment(value: unknown, pathName: string): WorkComment {
  const record = assertRecord(value, pathName);
  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    body: requiredNonEmptyString(record.body, `${pathName}.body`),
    author: optionalNullableString(record.author, `${pathName}.author`) ?? null,
    createdAt:
      optionalNullableString(record.createdAt, `${pathName}.createdAt`) ?? null,
    updatedAt:
      optionalNullableString(record.updatedAt, `${pathName}.updatedAt`) ?? null,
    externalRef: {
      provider: "local",
      itemId: requiredNonEmptyString(record.id, `${pathName}.id`),
    },
  };
}

function findWorkItem(store: LocalWorkTrackingStore, ref: WorkItemRef): WorkItem {
  if (ref.provider && ref.provider !== "local") {
    throw new LocalWorkTrackerProviderError(
      `local provider cannot resolve ${ref.provider} work item refs`,
    );
  }
  if (ref.externalRef?.provider && ref.externalRef.provider !== "local") {
    throw new LocalWorkTrackerProviderError(
      `local provider cannot resolve ${ref.externalRef.provider} external refs`,
    );
  }

  const id = ref.id ?? ref.externalRef?.itemId;
  if (!id) {
    throw new LocalWorkTrackerProviderError("work item id is required");
  }

  const item = store.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new LocalWorkTrackerProviderError(`Local work item not found: ${id}`);
  }

  return item;
}

function localItemNumber(record: Record<string, unknown>): number | null {
  const externalRef =
    record.externalRef && typeof record.externalRef === "object"
      ? (record.externalRef as Record<string, unknown>)
      : undefined;
  const itemNumber = externalRef?.itemNumber;
  return typeof itemNumber === "number" && Number.isInteger(itemNumber)
    ? itemNumber
    : null;
}

function isClosedStatus(status: WorkStatus): boolean {
  return isClosedWorkStatus(status);
}

function assertWorkStatus(status: string): asserts status is WorkStatus {
  assertSharedWorkStatus(status, localWorkStatusValidationOptions);
}

function normalizeStatusFilter(
  status: WorkStatusQuery | WorkStatusQuery[] | undefined,
): Set<WorkStatus> | undefined {
  return expandWorkStatusQuery(status, localWorkStatusValidationOptions);
}

function workStatus(value: unknown, pathName: string): WorkStatus {
  if (!isWorkStatus(value)) {
    throw new LocalWorkTrackerProviderError(`${pathName} must be a valid status`);
  }

  return value as WorkStatus;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  return normalizeWorkItemLimit(limit, { errorFactory: localProviderError });
}

function normalizeStringArray(
  values: string[] | undefined,
  pathName: string,
): string[] {
  return normalizeWorkItemStringArray(values, pathName, {
    errorFactory: localProviderError,
  });
}

function stringArray(value: unknown, pathName: string): string[] {
  return normalizeWorkItemStringArray(value, pathName, {
    errorFactory: localProviderError,
  });
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

function optionalNullableText(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new LocalWorkTrackerProviderError(`${pathName} must be a string`);
  }

  return value;
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  return requiredNonEmptyWorkItemString(value, pathName, {
    errorFactory: localProviderError,
  });
}

function positiveInteger(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new LocalWorkTrackerProviderError(
      `${pathName} must be a positive integer`,
    );
  }

  return value;
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalWorkTrackerProviderError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function localProviderError(message: string): LocalWorkTrackerProviderError {
  return new LocalWorkTrackerProviderError(message);
}

function invalidLocalWorkStatusMessage(status: string): string {
  return `Invalid local work status: ${status}; expected todo, ready, in_progress, blocked, done, or wont_do`;
}
