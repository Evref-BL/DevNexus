import type { WorkStatus } from "./workTrackingTypes.js";

export type NexusAutomationMode = "run_once";
export type NexusAutomationSafetyProfile =
  | "local"
  | "isolated"
  | "host-authorized";
export type NexusAutomationPublicationStrategy =
  | "local_only"
  | "direct_integration"
  | "review_handoff";

export interface NexusAutomationSelectorConfig {
  statuses: WorkStatus[];
  labels: string[];
  excludeLabels: string[];
  assignees: string[];
  search: string | null;
  limit: number;
}

export interface NexusAutomationVerificationConfig {
  focusedCommands: string[];
  fullCommands: string[];
  requirePassing: boolean;
}

export interface NexusAutomationLedgerConfig {
  path: string;
  retention: number;
}

export interface NexusAutomationLockConfig {
  path: string;
  staleAfterMs: number;
}

export interface NexusAutomationBackoffConfig {
  failureLimit: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface NexusAutomationSafetyConfig {
  profile: NexusAutomationSafetyProfile;
  allowHostMutation: boolean;
  allowDependencyInstall: boolean;
  allowLiveServices: boolean;
}

export interface NexusAutomationPublicationConfig {
  strategy: NexusAutomationPublicationStrategy;
  remote: string | null;
  targetBranch: string | null;
  push: boolean;
}

export interface NexusAutomationConfig {
  enabled: boolean;
  mode: NexusAutomationMode;
  selector: NexusAutomationSelectorConfig;
  verification: NexusAutomationVerificationConfig;
  ledger: NexusAutomationLedgerConfig;
  lock: NexusAutomationLockConfig;
  backoff: NexusAutomationBackoffConfig;
  safety: NexusAutomationSafetyConfig;
  publication: NexusAutomationPublicationConfig;
}

export const defaultNexusAutomationConfig: NexusAutomationConfig = {
  enabled: true,
  mode: "run_once",
  selector: {
    statuses: ["ready", "todo"],
    labels: [],
    excludeLabels: [],
    assignees: [],
    search: null,
    limit: 10,
  },
  verification: {
    focusedCommands: [],
    fullCommands: [],
    requirePassing: true,
  },
  ledger: {
    path: ".dev-nexus/automation/runs.json",
    retention: 200,
  },
  lock: {
    path: ".dev-nexus/automation/run.lock",
    staleAfterMs: 60 * 60 * 1000,
  },
  backoff: {
    failureLimit: 3,
    baseDelayMs: 5 * 60 * 1000,
    maxDelayMs: 60 * 60 * 1000,
  },
  safety: {
    profile: "local",
    allowHostMutation: false,
    allowDependencyInstall: false,
    allowLiveServices: false,
  },
  publication: {
    strategy: "review_handoff",
    remote: "origin",
    targetBranch: null,
    push: false,
  },
};

export class NexusAutomationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationConfigError";
  }
}

export function validateNexusAutomationConfig(
  value: unknown,
): NexusAutomationConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "project config.automation");
  const enabled = optionalBoolean(
    record,
    "enabled",
    "project config.automation",
  );
  const mode = validateMode(record.mode, "project config.automation.mode");
  const selector = validateSelectorConfig(record.selector);
  const verification = validateVerificationConfig(record.verification);
  const ledger = validateLedgerConfig(record.ledger);
  const lock = validateLockConfig(record.lock);
  const backoff = validateBackoffConfig(record.backoff);
  const safety = validateSafetyConfig(record.safety);
  const publication = validatePublicationConfig(record.publication);

  return {
    enabled: enabled ?? defaultNexusAutomationConfig.enabled,
    mode: mode ?? defaultNexusAutomationConfig.mode,
    selector: {
      ...defaultNexusAutomationConfig.selector,
      ...selector,
    },
    verification: {
      ...defaultNexusAutomationConfig.verification,
      ...verification,
    },
    ledger: {
      ...defaultNexusAutomationConfig.ledger,
      ...ledger,
    },
    lock: {
      ...defaultNexusAutomationConfig.lock,
      ...lock,
    },
    backoff: {
      ...defaultNexusAutomationConfig.backoff,
      ...backoff,
    },
    safety: {
      ...defaultNexusAutomationConfig.safety,
      ...safety,
    },
    publication: {
      ...defaultNexusAutomationConfig.publication,
      ...publication,
    },
  };
}

function validateMode(
  value: unknown,
  pathName: string,
): NexusAutomationMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "run_once") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be run_once`);
}

function validateSelectorConfig(
  value: unknown,
): Partial<NexusAutomationSelectorConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.selector";
  const record = assertRecord(value, pathName);
  return {
    ...optionalArrayField(record, "statuses", pathName, validateWorkStatus),
    ...optionalArrayField(record, "labels", pathName, requiredNonEmptyString),
    ...optionalArrayField(
      record,
      "excludeLabels",
      pathName,
      requiredNonEmptyString,
    ),
    ...optionalArrayField(record, "assignees", pathName, requiredNonEmptyString),
    ...optionalNullableStringField(record, "search", pathName),
    ...optionalPositiveIntegerField(record, "limit", pathName),
  };
}

function validateVerificationConfig(
  value: unknown,
): Partial<NexusAutomationVerificationConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.verification";
  const record = assertRecord(value, pathName);
  return {
    ...optionalArrayField(
      record,
      "focusedCommands",
      pathName,
      requiredNonEmptyString,
    ),
    ...optionalArrayField(
      record,
      "fullCommands",
      pathName,
      requiredNonEmptyString,
    ),
    ...optionalBooleanField(record, "requirePassing", pathName),
  };
}

function validateLedgerConfig(
  value: unknown,
): Partial<NexusAutomationLedgerConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.ledger";
  const record = assertRecord(value, pathName);
  return {
    ...optionalStringField(record, "path", pathName),
    ...optionalPositiveIntegerField(record, "retention", pathName),
  };
}

function validateLockConfig(value: unknown): Partial<NexusAutomationLockConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.lock";
  const record = assertRecord(value, pathName);
  return {
    ...optionalStringField(record, "path", pathName),
    ...optionalPositiveIntegerField(record, "staleAfterMs", pathName),
  };
}

function validateBackoffConfig(
  value: unknown,
): Partial<NexusAutomationBackoffConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.backoff";
  const record = assertRecord(value, pathName);
  return {
    ...optionalPositiveIntegerField(record, "failureLimit", pathName),
    ...optionalPositiveIntegerField(record, "baseDelayMs", pathName),
    ...optionalPositiveIntegerField(record, "maxDelayMs", pathName),
  };
}

function validateSafetyConfig(
  value: unknown,
): Partial<NexusAutomationSafetyConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.safety";
  const record = assertRecord(value, pathName);
  return {
    ...optionalSafetyProfileField(record, "profile", pathName),
    ...optionalBooleanField(record, "allowHostMutation", pathName),
    ...optionalBooleanField(record, "allowDependencyInstall", pathName),
    ...optionalBooleanField(record, "allowLiveServices", pathName),
  };
}

function validatePublicationConfig(
  value: unknown,
): Partial<NexusAutomationPublicationConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.publication";
  const record = assertRecord(value, pathName);
  return {
    ...optionalPublicationStrategyField(record, "strategy", pathName),
    ...optionalNullableStringField(record, "remote", pathName),
    ...optionalNullableStringField(record, "targetBranch", pathName),
    ...optionalBooleanField(record, "push", pathName),
  };
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new NexusAutomationConfigError(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function optionalBooleanField<
  Key extends string,
  OutputKey extends Key = Key,
>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
  outputKey: OutputKey = key as OutputKey,
): Partial<Record<OutputKey, boolean>> {
  const value = optionalBoolean(record, key, pathName);
  return value === undefined ? {} : { [outputKey]: value } as Record<OutputKey, boolean>;
}

function optionalStringField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, string>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }

  return {
    [key]: requiredNonEmptyString(value, `${pathName}.${key}`),
  } as Record<Key, string>;
}

function optionalNullableStringField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, string | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }

  return {
    [key]: requiredNonEmptyString(value, `${pathName}.${key}`),
  } as Record<Key, string>;
}

function optionalPositiveIntegerField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, number>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusAutomationConfigError(
      `${pathName}.${key} must be a positive integer`,
    );
  }

  return { [key]: value } as Record<Key, number>;
}

function optionalArrayField<Key extends string, Item>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
  normalizeItem: (value: unknown, pathName: string) => Item,
): Partial<Record<Key, Item[]>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName}.${key} must be an array`);
  }

  return {
    [key]: value.map((item, index) =>
      normalizeItem(item, `${pathName}.${key}[${index}]`),
    ),
  } as Record<Key, Item[]>;
}

function optionalSafetyProfileField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationSafetyProfile>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === "local" || value === "isolated" || value === "host-authorized") {
    return { [key]: value } as Record<Key, NexusAutomationSafetyProfile>;
  }

  throw new NexusAutomationConfigError(
    `${pathName}.${key} must be local, isolated, or host-authorized`,
  );
}

function optionalPublicationStrategyField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, NexusAutomationPublicationStrategy>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff"
  ) {
    return { [key]: value } as Record<Key, NexusAutomationPublicationStrategy>;
  }

  throw new NexusAutomationConfigError(
    `${pathName}.${key} must be local_only, direct_integration, or review_handoff`,
  );
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

  throw new NexusAutomationConfigError(
    `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
  );
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationConfigError(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}
