import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  LocalWorkTrackingConfig,
  WorkTrackingBoardConfig,
  WorkTrackingConfig,
  WorkTrackingProviderName,
  WorkTrackingRepositoryConfig,
  WorkStatus,
} from "../work-items/workTrackingTypes.js";
import {
  NexusConfigError,
  assertRecord,
  assertUniqueValues,
  nullableString,
  optionalBoolean,
  optionalInteger,
  optionalNullableString,
  optionalString,
  optionalStringArray,
  optionalStringRecord,
  requiredString,
} from "./nexusProjectConfigValidation.js";

export type NexusProjectWorkTrackerRole =
  | "primary"
  | "eligible_source"
  | "external_inbox"
  | "mirror"
  | "coordination"
  | "planning"
  | "external_feedback"
  | "migration"
  | "archive";

export type NexusProjectTrackerDiscoveryDirectExternalSelection =
  | "disabled"
  | "allowed";

export type NexusProjectTrackerDiscoveryConflictWinner =
  | "block"
  | "default_tracker"
  | "scanned_tracker";

export type NexusProjectTrackerDiscoveryMissingCredentialBehavior =
  | "block"
  | "skip";

export type NexusProjectTrackerCoordinationHandoffPolicy =
  | "comment"
  | "silent";

export interface NexusProjectTrackerCommunicationPolicyConfig {
  coordinationHandoffs?: NexusProjectTrackerCoordinationHandoffPolicy;
}

export interface NormalizedNexusProjectTrackerCommunicationPolicy {
  coordinationHandoffs: NexusProjectTrackerCoordinationHandoffPolicy;
}

export interface NexusProjectTrackerDiscoveryFingerprintConfig {
  id: string;
  trackerId?: string;
  provider?: WorkTrackingProviderName;
  host?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  itemId?: string;
  itemNumber?: number;
  itemKey?: string;
  nodeId?: string;
}

export interface NexusProjectTrackerDiscoveryPolicyConfig {
  scannedRoles: NexusProjectWorkTrackerRole[];
  directExternalSelection: NexusProjectTrackerDiscoveryDirectExternalSelection;
  importRequiredFirst: boolean;
  providerFilters: WorkTrackingProviderName[];
  queryLimit: number | null;
  trackerLimits?: Record<string, number>;
  finalLimit?: number | null;
  statuses?: WorkStatus[];
  labels?: string[];
  milestones?: string[];
  assignees?: string[];
  providerQuery?: string | null;
  fingerprints?: NexusProjectTrackerDiscoveryFingerprintConfig[];
  conflictWinner: NexusProjectTrackerDiscoveryConflictWinner;
  missingCredentialBehavior: NexusProjectTrackerDiscoveryMissingCredentialBehavior;
}

export interface NormalizedNexusProjectTrackerDiscoveryPolicy
  extends Omit<
    NexusProjectTrackerDiscoveryPolicyConfig,
    | "assignees"
    | "finalLimit"
    | "labels"
    | "milestones"
    | "providerQuery"
    | "statuses"
    | "fingerprints"
    | "trackerLimits"
  > {
  trackerLimits: Record<string, number>;
  finalLimit: number | null;
  statuses: WorkStatus[];
  labels: string[];
  milestones: string[];
  assignees: string[];
  providerQuery: string | null;
  fingerprints: NexusProjectTrackerDiscoveryFingerprintConfig[];
  defaultTrackerOnly: boolean;
}

export interface NexusProjectWorkTrackerBindingConfig {
  id: string;
  name: string;
  enabled: boolean;
  roles: NexusProjectWorkTrackerRole[];
  communication?: NexusProjectTrackerCommunicationPolicyConfig;
  workTracking: WorkTrackingConfig;
}

export interface NormalizedNexusProjectWorkTrackers {
  defaultTrackerId: string | null;
  defaultTracker: NexusProjectWorkTrackerBindingConfig | null;
  trackers: NexusProjectWorkTrackerBindingConfig[];
  discoveryPolicy: NormalizedNexusProjectTrackerDiscoveryPolicy;
}

interface NexusProjectComponentWorkTrackingConfig {
  workTracking?: WorkTrackingConfig;
  defaultWorkTrackerId?: string;
  workTrackers?: NexusProjectWorkTrackerBindingConfig[];
  trackerDiscovery?: NexusProjectTrackerDiscoveryPolicyConfig;
}

export const defaultNexusProjectTrackerDiscoveryPolicy: NexusProjectTrackerDiscoveryPolicyConfig = {
  scannedRoles: ["primary"],
  directExternalSelection: "disabled",
  importRequiredFirst: true,
  providerFilters: [],
  queryLimit: 50,
  trackerLimits: {},
  finalLimit: null,
  statuses: [],
  labels: [],
  milestones: [],
  assignees: [],
  providerQuery: null,
  fingerprints: [],
  conflictWinner: "default_tracker",
  missingCredentialBehavior: "block",
};

export function defaultNexusProjectTrackerCommunicationPolicy(
  provider: WorkTrackingProviderName | string,
  roles: readonly NexusProjectWorkTrackerRole[] = [],
): NormalizedNexusProjectTrackerCommunicationPolicy {
  return {
    coordinationHandoffs:
      provider === "local" || roles.includes("coordination") ? "comment" : "silent",
  };
}

export function normalizeNexusProjectTrackerCommunicationPolicy(options: {
  provider: WorkTrackingProviderName | string;
  roles?: readonly NexusProjectWorkTrackerRole[];
  project?: NexusProjectTrackerCommunicationPolicyConfig;
  tracker?: NexusProjectTrackerCommunicationPolicyConfig;
}): NormalizedNexusProjectTrackerCommunicationPolicy {
  const fallback = defaultNexusProjectTrackerCommunicationPolicy(
    options.provider,
    options.roles,
  );

  return {
    coordinationHandoffs:
      options.tracker?.coordinationHandoffs ??
      options.project?.coordinationHandoffs ??
      fallback.coordinationHandoffs,
  };
}

function validateWorkTrackingProviderName(
  value: unknown,
  pathName: string,
): WorkTrackingProviderName {
  if (
    value === "local" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be local, github, gitlab, or jira`,
  );
}

function validateWorkTrackingRepositoryConfig(
  value: unknown,
  pathName: string,
): WorkTrackingRepositoryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const owner = optionalString(record, "owner", pathName);
  const name = optionalString(record, "name", pathName);
  const id = optionalString(record, "id", pathName);
  const repositoryPath = optionalString(record, "path", pathName);

  return {
    ...(owner ? { owner } : {}),
    ...(name ? { name } : {}),
    ...(id ? { id } : {}),
    ...(repositoryPath ? { path: repositoryPath } : {}),
  };
}

function validateRequiredWorkTrackingRepositoryConfig(
  value: unknown,
  pathName: string,
): WorkTrackingRepositoryConfig {
  const repository = validateWorkTrackingRepositoryConfig(value, pathName);
  if (!repository) {
    throw new NexusConfigError(`${pathName} must be an object`);
  }

  return repository;
}

function validateWorkTrackingBoardConfig(
  value: unknown,
  pathName: string,
): WorkTrackingBoardConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const record = assertRecord(value, pathName);
  const id = optionalNullableString(record, "id", pathName);
  const number = optionalInteger(record, "number", pathName);
  const owner = optionalNullableString(record, "owner", pathName);
  const ownerKind = optionalNullableString(record, "ownerKind", pathName);
  const projectId = optionalNullableString(record, "projectId", pathName);
  const statusFieldId = optionalNullableString(
    record,
    "statusFieldId",
    pathName,
  );
  const statusOptions = optionalStringRecord(record, "statusOptions", pathName);

  return {
    kind: requiredString(record, "kind", pathName),
    ...(id !== undefined ? { id } : {}),
    ...(number !== undefined ? { number } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(ownerKind !== undefined ? { ownerKind } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(statusFieldId !== undefined ? { statusFieldId } : {}),
    ...(statusOptions ? { statusOptions } : {}),
  };
}

export function validateWorkTrackingConfig(
  value: unknown,
  pathName = "workTracking",
): WorkTrackingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const provider = validateWorkTrackingProviderName(
    record.provider,
    `${pathName}.provider`,
  );
  const host = optionalNullableString(record, "host", pathName);
  const repository = validateWorkTrackingRepositoryConfig(
    record.repository,
    `${pathName}.repository`,
  );
  const board = validateWorkTrackingBoardConfig(record.board, `${pathName}.board`);
  const common = {
    ...(host !== undefined ? { host } : {}),
    ...(repository ? { repository } : {}),
    ...(board !== undefined ? { board } : {}),
  };

  if (provider === "local") {
    const storePath = optionalNullableString(record, "storePath", pathName);

    return {
      provider,
      ...common,
      ...(storePath !== undefined ? { storePath } : {}),
    } satisfies LocalWorkTrackingConfig;
  }

  if (provider === "github") {
    const githubRepository = validateRequiredWorkTrackingRepositoryConfig(
      record.repository,
      `${pathName}.repository`,
    );
    if (!githubRepository.owner) {
      throw new NexusConfigError(
        `${pathName}.repository.owner must be a non-empty string`,
      );
    }
    if (!githubRepository.name) {
      throw new NexusConfigError(
        `${pathName}.repository.name must be a non-empty string`,
      );
    }

    return {
      provider,
      ...common,
      repository: {
        ...githubRepository,
        owner: githubRepository.owner,
        name: githubRepository.name,
      },
    } satisfies GitHubWorkTrackingConfig;
  }

  if (provider === "gitlab") {
    const gitlabRepository = validateRequiredWorkTrackingRepositoryConfig(
      record.repository,
      `${pathName}.repository`,
    );
    if (!gitlabRepository.id) {
      throw new NexusConfigError(
        `${pathName}.repository.id must be a non-empty string`,
      );
    }

    return {
      provider,
      ...common,
      repository: {
        ...gitlabRepository,
        id: gitlabRepository.id,
      },
    } satisfies GitLabWorkTrackingConfig;
  }

  const issueType = optionalNullableString(record, "issueType", pathName);

  return {
    provider,
    ...common,
    projectKey: requiredString(record, "projectKey", pathName),
    ...(issueType !== undefined ? { issueType } : {}),
  } satisfies JiraWorkTrackingConfig;
}

const legacyDefaultWorkTrackerId = "default";
const legacyDefaultWorkTrackerName = "Default";

const nexusProjectWorkTrackerRoles: readonly NexusProjectWorkTrackerRole[] = [
  "primary",
  "eligible_source",
  "external_inbox",
  "mirror",
  "coordination",
  "planning",
  "external_feedback",
  "migration",
  "archive",
];

function validateWorkTrackerRole(
  value: unknown,
  pathName: string,
): NexusProjectWorkTrackerRole {
  if (
    typeof value === "string" &&
    nexusProjectWorkTrackerRoles.includes(value as NexusProjectWorkTrackerRole)
  ) {
    return value as NexusProjectWorkTrackerRole;
  }

  throw new NexusConfigError(
    `${pathName} must be ${nexusProjectWorkTrackerRoles.join(", ")}`,
  );
}

function validateWorkTrackerRoles(
  value: unknown,
  pathName: string,
): NexusProjectWorkTrackerRole[] {
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName} must not be empty`);
  }

  const roles = value.map((role, index) =>
    validateWorkTrackerRole(role, `${pathName}[${index}]`),
  );
  const uniqueRoles = new Set<NexusProjectWorkTrackerRole>();
  for (const role of roles) {
    if (uniqueRoles.has(role)) {
      throw new NexusConfigError(`${pathName} contains duplicate role: ${role}`);
    }
    uniqueRoles.add(role);
  }

  return roles;
}

function optionalWorkTrackerRoles(
  value: unknown,
  pathName: string,
  fallback: NexusProjectWorkTrackerRole[],
): NexusProjectWorkTrackerRole[] {
  if (value === undefined) {
    return [...fallback];
  }

  return validateWorkTrackerRoles(value, pathName);
}

function validateTrackerCoordinationHandoffPolicy(
  value: unknown,
  pathName: string,
): NexusProjectTrackerCoordinationHandoffPolicy {
  if (value === "comment" || value === "silent") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be comment or silent`);
}

export function validateTrackerCommunicationPolicy(
  value: unknown,
  pathName: string,
): NexusProjectTrackerCommunicationPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const coordinationHandoffs =
    record.coordinationHandoffs === undefined
      ? undefined
      : validateTrackerCoordinationHandoffPolicy(
          record.coordinationHandoffs,
          `${pathName}.coordinationHandoffs`,
        );

  return {
    ...(coordinationHandoffs !== undefined ? { coordinationHandoffs } : {}),
  };
}

function validateTrackerDiscoveryDirectExternalSelection(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryDirectExternalSelection {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.directExternalSelection;
  }
  if (value === "disabled" || value === "allowed") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be disabled or allowed`);
}

function validateTrackerDiscoveryConflictWinner(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryConflictWinner {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.conflictWinner;
  }
  if (
    value === "block" ||
    value === "default_tracker" ||
    value === "scanned_tracker"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be block, default_tracker, or scanned_tracker`,
  );
}

function validateTrackerDiscoveryMissingCredentialBehavior(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryMissingCredentialBehavior {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.missingCredentialBehavior;
  }
  if (value === "block" || value === "skip") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be block or skip`);
}

function validateTrackerDiscoveryProviderFilters(
  value: unknown,
  pathName: string,
): WorkTrackingProviderName[] {
  if (value === undefined) {
    return [...defaultNexusProjectTrackerDiscoveryPolicy.providerFilters];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }

  const providers = value.map((entry, index) =>
    validateWorkTrackingProviderName(entry, `${pathName}[${index}]`),
  );
  assertUniqueValues(providers, pathName);

  return providers;
}

function validateTrackerDiscoveryQueryLimit(
  value: unknown,
  pathName: string,
): number | null {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.queryLimit;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(`${pathName} must be a positive integer or null`);
  }

  return value;
}

function validateTrackerDiscoveryTrackerLimits(
  value: unknown,
  pathName: string,
): Record<string, number> {
  if (value === undefined) {
    return { ...defaultNexusProjectTrackerDiscoveryPolicy.trackerLimits };
  }
  const record = assertRecord(value, pathName);
  const limits: Record<string, number> = {};
  for (const [trackerId, limit] of Object.entries(record)) {
    if (trackerId.trim().length === 0) {
      throw new NexusConfigError(`${pathName} tracker id must be non-empty`);
    }
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw new NexusConfigError(
        `${pathName}.${trackerId} must be a positive integer`,
      );
    }
    limits[trackerId] = limit;
  }

  return limits;
}

function validateTrackerDiscoveryFinalLimit(
  value: unknown,
  pathName: string,
): number | null {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.finalLimit ?? null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(`${pathName} must be a positive integer or null`);
  }

  return value;
}

function validateTrackerDiscoveryStatuses(
  value: unknown,
  pathName: string,
): WorkStatus[] {
  if (value === undefined) {
    return [...(defaultNexusProjectTrackerDiscoveryPolicy.statuses ?? [])];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  const statuses = value.map((entry, index) =>
    validateWorkStatus(entry, `${pathName}[${index}]`),
  );
  assertUniqueValues(statuses, pathName);

  return statuses;
}

function validateWorkStatus(value: unknown, pathName: string): WorkStatus {
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

  throw new NexusConfigError(
    `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
  );
}

function validateTrackerDiscoveryStringFilters(
  value: unknown,
  pathName: string,
  fallback: readonly string[],
): string[] {
  if (value === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }
  const values = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusConfigError(`${pathName}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
  assertUniqueValues(values, pathName);

  return values;
}

function validateTrackerDiscoveryProviderQuery(
  value: unknown,
  pathName: string,
): string | null {
  if (value === undefined) {
    return defaultNexusProjectTrackerDiscoveryPolicy.providerQuery ?? null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(`${pathName} must be a non-empty string or null`);
  }

  return value.trim();
}

function validateTrackerDiscoveryFingerprints(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryFingerprintConfig[] {
  if (value === undefined) {
    return [...(defaultNexusProjectTrackerDiscoveryPolicy.fingerprints ?? [])];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an array`);
  }

  const fingerprints = value.map((entry, index) => {
    const entryPath = `${pathName}[${index}]`;
    const record = assertRecord(entry, entryPath);
    const fingerprint: NexusProjectTrackerDiscoveryFingerprintConfig = {
      id: requiredString(record, "id", entryPath).trim(),
      ...(record.trackerId !== undefined
        ? { trackerId: requiredString(record, "trackerId", entryPath).trim() }
        : {}),
      ...(record.provider !== undefined
        ? {
            provider: validateWorkTrackingProviderName(
              record.provider,
              `${entryPath}.provider`,
            ),
          }
        : {}),
      ...(record.host !== undefined
        ? { host: nullableString(record, "host", entryPath) }
        : {}),
      ...(record.repositoryId !== undefined
        ? { repositoryId: nullableString(record, "repositoryId", entryPath) }
        : {}),
      ...(record.repositoryOwner !== undefined
        ? { repositoryOwner: nullableString(record, "repositoryOwner", entryPath) }
        : {}),
      ...(record.repositoryName !== undefined
        ? { repositoryName: nullableString(record, "repositoryName", entryPath) }
        : {}),
      ...(record.projectId !== undefined
        ? { projectId: nullableString(record, "projectId", entryPath) }
        : {}),
      ...(record.boardId !== undefined
        ? { boardId: nullableString(record, "boardId", entryPath) }
        : {}),
      ...(record.itemId !== undefined
        ? { itemId: requiredString(record, "itemId", entryPath).trim() }
        : {}),
      ...(record.itemNumber !== undefined
        ? {
            itemNumber: validatePositiveInteger(
              record.itemNumber,
              `${entryPath}.itemNumber`,
            ),
          }
        : {}),
      ...(record.itemKey !== undefined
        ? { itemKey: requiredString(record, "itemKey", entryPath).trim() }
        : {}),
      ...(record.nodeId !== undefined
        ? { nodeId: requiredString(record, "nodeId", entryPath).trim() }
        : {}),
    };
    if (
      fingerprint.itemId === undefined &&
      fingerprint.itemNumber === undefined &&
      fingerprint.itemKey === undefined &&
      fingerprint.nodeId === undefined
    ) {
      throw new NexusConfigError(
        `${entryPath} must include itemId, itemNumber, itemKey, or nodeId`,
      );
    }

    return fingerprint;
  });
  return fingerprints;
}

function validatePositiveInteger(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(`${pathName} must be a positive integer`);
  }

  return value;
}

export function validateTrackerDiscoveryPolicy(
  value: unknown,
  pathName: string,
): NexusProjectTrackerDiscoveryPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const policy: NexusProjectTrackerDiscoveryPolicyConfig = {
    scannedRoles: optionalWorkTrackerRoles(
      record.scannedRoles,
      `${pathName}.scannedRoles`,
      defaultNexusProjectTrackerDiscoveryPolicy.scannedRoles,
    ),
    directExternalSelection: validateTrackerDiscoveryDirectExternalSelection(
      record.directExternalSelection,
      `${pathName}.directExternalSelection`,
    ),
    importRequiredFirst: optionalBoolean(
      record,
      "importRequiredFirst",
      pathName,
    ) ?? defaultNexusProjectTrackerDiscoveryPolicy.importRequiredFirst,
    providerFilters: validateTrackerDiscoveryProviderFilters(
      record.providerFilters,
      `${pathName}.providerFilters`,
    ),
    queryLimit: validateTrackerDiscoveryQueryLimit(
      record.queryLimit,
      `${pathName}.queryLimit`,
    ),
    trackerLimits: validateTrackerDiscoveryTrackerLimits(
      record.trackerLimits,
      `${pathName}.trackerLimits`,
    ),
    finalLimit: validateTrackerDiscoveryFinalLimit(
      record.finalLimit,
      `${pathName}.finalLimit`,
    ),
    statuses: validateTrackerDiscoveryStatuses(
      record.statuses,
      `${pathName}.statuses`,
    ),
    labels: validateTrackerDiscoveryStringFilters(
      record.labels,
      `${pathName}.labels`,
      defaultNexusProjectTrackerDiscoveryPolicy.labels ?? [],
    ),
    milestones: validateTrackerDiscoveryStringFilters(
      record.milestones,
      `${pathName}.milestones`,
      defaultNexusProjectTrackerDiscoveryPolicy.milestones ?? [],
    ),
    assignees: validateTrackerDiscoveryStringFilters(
      record.assignees,
      `${pathName}.assignees`,
      defaultNexusProjectTrackerDiscoveryPolicy.assignees ?? [],
    ),
    providerQuery: validateTrackerDiscoveryProviderQuery(
      record.providerQuery,
      `${pathName}.providerQuery`,
    ),
    fingerprints: validateTrackerDiscoveryFingerprints(
      record.fingerprints,
      `${pathName}.fingerprints`,
    ),
    conflictWinner: validateTrackerDiscoveryConflictWinner(
      record.conflictWinner,
      `${pathName}.conflictWinner`,
    ),
    missingCredentialBehavior: validateTrackerDiscoveryMissingCredentialBehavior(
      record.missingCredentialBehavior,
      `${pathName}.missingCredentialBehavior`,
    ),
  };

  if (
    policy.directExternalSelection === "allowed" &&
    policy.importRequiredFirst
  ) {
    throw new NexusConfigError(
      `${pathName}.directExternalSelection cannot be allowed when importRequiredFirst is true`,
    );
  }

  return policy;
}

export function normalizeNexusProjectTrackerDiscoveryPolicy(
  policy: NexusProjectTrackerDiscoveryPolicyConfig | undefined,
): NormalizedNexusProjectTrackerDiscoveryPolicy {
  const normalized = policy ?? defaultNexusProjectTrackerDiscoveryPolicy;

  return {
    scannedRoles: [...normalized.scannedRoles],
    directExternalSelection: normalized.directExternalSelection,
    importRequiredFirst: normalized.importRequiredFirst,
    providerFilters: [...normalized.providerFilters],
    queryLimit: normalized.queryLimit,
    trackerLimits: { ...(normalized.trackerLimits ?? {}) },
    finalLimit: normalized.finalLimit ?? null,
    statuses: [...(normalized.statuses ?? [])],
    labels: [...(normalized.labels ?? [])],
    milestones: [...(normalized.milestones ?? [])],
    assignees: [...(normalized.assignees ?? [])],
    providerQuery: normalized.providerQuery ?? null,
    fingerprints: [...(normalized.fingerprints ?? [])],
    conflictWinner: normalized.conflictWinner,
    missingCredentialBehavior: normalized.missingCredentialBehavior,
    defaultTrackerOnly: policy === undefined,
  };
}

function validateComponentWorkTrackerBinding(
  value: unknown,
  index: number,
  componentPathName: string,
): NexusProjectWorkTrackerBindingConfig {
  const pathName = `${componentPathName}.workTrackers[${index}]`;
  const record = assertRecord(value, pathName);
  const workTracking = validateWorkTrackingConfig(
    record.workTracking,
    `${pathName}.workTracking`,
  );
  if (!workTracking) {
    throw new NexusConfigError(`${pathName}.workTracking must be an object`);
  }

  const id = requiredString(record, "id", pathName);
  const communication = validateTrackerCommunicationPolicy(
    record.communication,
    `${pathName}.communication`,
  );
  return {
    id,
    name: optionalString(record, "name", pathName) ?? id,
    enabled: optionalBoolean(record, "enabled", pathName) ?? true,
    roles: validateWorkTrackerRoles(record.roles, `${pathName}.roles`),
    ...(communication ? { communication } : {}),
    workTracking,
  };
}

export function validateComponentWorkTrackers(
  record: Record<string, unknown>,
  pathName: string,
): Pick<
  NexusProjectComponentWorkTrackingConfig,
  "defaultWorkTrackerId" | "workTrackers"
> {
  const value = record.workTrackers;
  if (value === undefined) {
    if (record.defaultWorkTrackerId !== undefined) {
      optionalString(record, "defaultWorkTrackerId", pathName);
      throw new NexusConfigError(
        `${pathName}.defaultWorkTrackerId requires workTrackers`,
      );
    }
    return {};
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName}.workTrackers must be an array`);
  }
  if (value.length === 0) {
    throw new NexusConfigError(`${pathName}.workTrackers must not be empty`);
  }

  const workTrackers = value.map((entry, index) =>
    validateComponentWorkTrackerBinding(entry, index, pathName),
  );
  const trackerIds = new Set<string>();
  for (const tracker of workTrackers) {
    if (trackerIds.has(tracker.id)) {
      throw new NexusConfigError(
        `${pathName}.workTrackers contains duplicate id: ${tracker.id}`,
      );
    }
    trackerIds.add(tracker.id);
  }

  const enabledTrackerIds = new Set(
    workTrackers
      .filter((tracker) => tracker.enabled)
      .map((tracker) => tracker.id),
  );
  if (enabledTrackerIds.size === 0) {
    throw new NexusConfigError(
      `${pathName}.workTrackers must contain at least one enabled tracker`,
    );
  }

  const defaultWorkTrackerId = optionalString(
    record,
    "defaultWorkTrackerId",
    pathName,
  );
  if (!defaultWorkTrackerId) {
    throw new NexusConfigError(
      `${pathName}.defaultWorkTrackerId must reference a configured enabled tracker`,
    );
  }
  if (!trackerIds.has(defaultWorkTrackerId)) {
    throw new NexusConfigError(
      `${pathName}.defaultWorkTrackerId references unknown tracker: ${defaultWorkTrackerId}`,
    );
  }
  if (!enabledTrackerIds.has(defaultWorkTrackerId)) {
    throw new NexusConfigError(
      `${pathName}.defaultWorkTrackerId must reference an enabled tracker`,
    );
  }

  return {
    defaultWorkTrackerId,
    workTrackers,
  };
}

export function normalizeComponentWorkTrackers(
  component: Pick<
    NexusProjectComponentWorkTrackingConfig,
    "defaultWorkTrackerId" | "trackerDiscovery" | "workTrackers" | "workTracking"
  >,
): NormalizedNexusProjectWorkTrackers {
  const explicitTrackers = component.workTrackers ?? [];
  const trackers =
    explicitTrackers.length > 0
      ? explicitTrackers
      : component.workTracking
        ? [
            {
              id: legacyDefaultWorkTrackerId,
              name: legacyDefaultWorkTrackerName,
              enabled: true,
              roles: ["primary" as const],
              workTracking: component.workTracking,
            },
          ]
        : [];
  const defaultTrackerId =
    component.defaultWorkTrackerId ??
    trackers.find((tracker) => tracker.enabled)?.id ??
    null;
  const defaultTracker =
    defaultTrackerId === null
      ? null
      : trackers.find(
          (tracker) => tracker.id === defaultTrackerId && tracker.enabled,
        ) ?? null;

  return {
    defaultTrackerId: defaultTracker?.id ?? null,
    defaultTracker,
    trackers,
    discoveryPolicy: normalizeNexusProjectTrackerDiscoveryPolicy(
      component.trackerDiscovery,
    ),
  };
}
