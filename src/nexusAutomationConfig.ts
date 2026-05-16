import type { WorkStatus } from "./workTrackingTypes.js";

export type NexusAutomationMode = "run_once" | "agent_launch";
export type NexusAutomationSafetyProfile =
  | "local"
  | "isolated"
  | "host-authorized";
export type NexusAutomationPublicationStrategy =
  | "local_only"
  | "direct_integration"
  | "review_handoff";
export type NexusAutomationAgentProfileIntendedUse =
  | "any"
  | "coordinator"
  | "subagent";

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

export interface NexusAutomationScheduleConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface NexusAutomationDependencyLinkConfig {
  source: string;
  target: string;
  required: boolean;
}

export interface NexusAutomationSetupConfig {
  dependencyLinks: NexusAutomationDependencyLinkConfig[];
}

export interface NexusAutomationExecutorConfig {
  command: string | null;
  timeoutMs: number | null;
  runFullVerification: boolean;
}

export interface NexusAutomationAgentRelaunchConfig {
  whileEligible: boolean;
}

export interface NexusAutomationAgentProfileConfig {
  id: string;
  executor: string;
  model: string | null;
  version?: string | null;
  variant?: string | null;
  reasoning: string | null;
  intelligence?: string | null;
  intendedUse?: NexusAutomationAgentProfileIntendedUse;
  safety?: NexusAutomationSafetyConfig | null;
  command: string | null;
  args: string[];
}

export interface NexusAutomationAgentConfig {
  command: string | null;
  timeoutMs: number | null;
  coordinatorProfileId: string | null;
  maxConcurrentSubagents: number;
  profiles: NexusAutomationAgentProfileConfig[];
  relaunch: NexusAutomationAgentRelaunchConfig;
}

export interface NexusAutomationTargetConfig {
  id: string | null;
  objective: string | null;
  statePath: string;
  cycleLedgerPath: string;
  stopWhenNoEligibleWork: boolean;
  maxCycles: number | null;
  maxWorkItems: number | null;
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
  schedule: NexusAutomationScheduleConfig;
  setup: NexusAutomationSetupConfig;
  executor: NexusAutomationExecutorConfig;
  agent: NexusAutomationAgentConfig;
  target: NexusAutomationTargetConfig;
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
  schedule: {
    enabled: true,
    intervalMs: 15 * 60 * 1000,
  },
  setup: {
    dependencyLinks: [],
  },
  executor: {
    command: null,
    timeoutMs: null,
    runFullVerification: false,
  },
  agent: {
    command: null,
    timeoutMs: null,
    coordinatorProfileId: null,
    maxConcurrentSubagents: 1,
    profiles: [],
    relaunch: {
      whileEligible: false,
    },
  },
  target: {
    id: null,
    objective: null,
    statePath: ".dev-nexus/automation/target-state.md",
    cycleLedgerPath: ".dev-nexus/automation/target-cycles.json",
    stopWhenNoEligibleWork: true,
    maxCycles: null,
    maxWorkItems: null,
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
  const schedule = validateScheduleConfig(record.schedule);
  const setup = validateSetupConfig(record.setup);
  const executor = validateExecutorConfig(record.executor);
  const agent = validateAgentConfig(record.agent);
  const target = validateTargetConfig(record.target);
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
    schedule: {
      ...defaultNexusAutomationConfig.schedule,
      ...schedule,
    },
    setup: {
      ...defaultNexusAutomationConfig.setup,
      ...setup,
    },
    executor: {
      ...defaultNexusAutomationConfig.executor,
      ...executor,
    },
    agent: {
      ...defaultNexusAutomationConfig.agent,
      ...agent,
      relaunch: {
        ...defaultNexusAutomationConfig.agent.relaunch,
        ...agent.relaunch,
      },
    },
    target: {
      ...defaultNexusAutomationConfig.target,
      ...target,
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
  if (value === "run_once" || value === "agent_launch") {
    return value;
  }

  throw new NexusAutomationConfigError(`${pathName} must be run_once or agent_launch`);
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

function validateScheduleConfig(
  value: unknown,
): Partial<NexusAutomationScheduleConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.schedule";
  const record = assertRecord(value, pathName);
  return {
    ...optionalBooleanField(record, "enabled", pathName),
    ...optionalPositiveIntegerField(record, "intervalMs", pathName),
  };
}

function validateSetupConfig(
  value: unknown,
): Partial<NexusAutomationSetupConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.setup";
  const record = assertRecord(value, pathName);
  const dependencyLinks = record.dependencyLinks;
  if (dependencyLinks === undefined) {
    return {};
  }
  if (!Array.isArray(dependencyLinks)) {
    throw new NexusAutomationConfigError(
      `${pathName}.dependencyLinks must be an array`,
    );
  }

  return {
    dependencyLinks: dependencyLinks.map((link, index) =>
      validateDependencyLinkConfig(
        link,
        `${pathName}.dependencyLinks[${index}]`,
      ),
    ),
  };
}

function validateExecutorConfig(
  value: unknown,
): Partial<NexusAutomationExecutorConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.executor";
  const record = assertRecord(value, pathName);
  return {
    ...optionalNullableStringField(record, "command", pathName),
    ...optionalNullablePositiveIntegerField(record, "timeoutMs", pathName),
    ...optionalBooleanField(record, "runFullVerification", pathName),
  };
}

function validateAgentConfig(
  value: unknown,
): Partial<NexusAutomationAgentConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.agent";
  const record = assertRecord(value, pathName);
  const coordinatorProfileId = optionalNullableStringField(
    record,
    "coordinatorProfileId",
    pathName,
  );
  const profiles = optionalArrayField(
    record,
    "profiles",
    pathName,
    validateAgentProfileConfig,
  );
  if (profiles.profiles) {
    assertUniqueAgentProfileIds(profiles.profiles, `${pathName}.profiles`);
  }
  if (coordinatorProfileId.coordinatorProfileId) {
    const profile = profiles.profiles?.find(
      (item) => item.id === coordinatorProfileId.coordinatorProfileId,
    );
    if (!profile) {
      throw new NexusAutomationConfigError(
        `${pathName}.coordinatorProfileId must reference a configured agent profile`,
      );
    }
  }

  return {
    ...optionalNullableStringField(record, "command", pathName),
    ...optionalNullablePositiveIntegerField(record, "timeoutMs", pathName),
    ...coordinatorProfileId,
    ...optionalPositiveIntegerField(record, "maxConcurrentSubagents", pathName),
    ...profiles,
    ...validateAgentRelaunchConfig(record.relaunch),
  };
}

function validateAgentProfileConfig(
  value: unknown,
  pathName: string,
): NexusAutomationAgentProfileConfig {
  const record = assertRecord(value, pathName);

  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    executor: requiredNonEmptyString(record.executor, `${pathName}.executor`),
    model: optionalNullableString(record.model, `${pathName}.model`) ?? null,
    version:
      optionalNullableString(record.version, `${pathName}.version`) ?? null,
    variant:
      optionalNullableString(record.variant, `${pathName}.variant`) ?? null,
    reasoning:
      optionalNullableString(record.reasoning, `${pathName}.reasoning`) ?? null,
    intelligence:
      optionalNullableString(record.intelligence, `${pathName}.intelligence`) ??
      null,
    intendedUse: validateAgentProfileIntendedUse(
      record.intendedUse,
      `${pathName}.intendedUse`,
    ),
    safety: validateAgentProfileSafetyConfig(
      record.safety,
      `${pathName}.safety`,
    ),
    command: optionalNullableString(record.command, `${pathName}.command`) ?? null,
    args: optionalStringArray(record.args, `${pathName}.args`) ?? [],
  };
}

function validateAgentProfileIntendedUse(
  value: unknown,
  pathName: string,
): NexusAutomationAgentProfileIntendedUse {
  if (value === undefined) {
    return "any";
  }
  if (value === "any" || value === "coordinator" || value === "subagent") {
    return value;
  }

  throw new NexusAutomationConfigError(
    `${pathName} must be any, coordinator, or subagent`,
  );
}

function validateAgentProfileSafetyConfig(
  value: unknown,
  pathName: string,
): NexusAutomationSafetyConfig | null {
  if (value === undefined || value === null) {
    return null;
  }

  return {
    ...defaultNexusAutomationConfig.safety,
    ...validateSafetyConfigAt(value, pathName),
  };
}

function assertUniqueAgentProfileIds(
  profiles: NexusAutomationAgentProfileConfig[],
  pathName: string,
): void {
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new NexusAutomationConfigError(
        `${pathName} contains duplicate id: ${profile.id}`,
      );
    }
    ids.add(profile.id);
  }
}

function validateAgentRelaunchConfig(
  value: unknown,
): Partial<Pick<NexusAutomationAgentConfig, "relaunch">> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.agent.relaunch";
  const record = assertRecord(value, pathName);
  return {
    relaunch: {
      ...defaultNexusAutomationConfig.agent.relaunch,
      ...optionalBooleanField(record, "whileEligible", pathName),
    },
  };
}

function validateTargetConfig(
  value: unknown,
): Partial<NexusAutomationTargetConfig> {
  if (value === undefined) {
    return {};
  }

  const pathName = "project config.automation.target";
  const record = assertRecord(value, pathName);
  return {
    ...optionalNullableStringField(record, "id", pathName),
    ...optionalNullableStringField(record, "objective", pathName),
    ...optionalRelativePathField(record, "statePath", pathName),
    ...optionalRelativePathField(record, "cycleLedgerPath", pathName),
    ...optionalBooleanField(record, "stopWhenNoEligibleWork", pathName),
    ...optionalNullablePositiveIntegerField(record, "maxCycles", pathName),
    ...optionalNullablePositiveIntegerField(record, "maxWorkItems", pathName),
  };
}

function validateDependencyLinkConfig(
  value: unknown,
  pathName: string,
): NexusAutomationDependencyLinkConfig {
  const record = assertRecord(value, pathName);

  return {
    source: requiredNonEmptyString(record.source, `${pathName}.source`),
    target: requiredNonEmptyString(record.target, `${pathName}.target`),
    required: optionalBoolean(record, "required", pathName) ?? false,
  };
}

function validateSafetyConfig(
  value: unknown,
): Partial<NexusAutomationSafetyConfig> {
  return validateSafetyConfigAt(value, "project config.automation.safety");
}

function validateSafetyConfigAt(
  value: unknown,
  pathName: string,
): Partial<NexusAutomationSafetyConfig> {
  if (value === undefined) {
    return {};
  }

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

function optionalRelativePathField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, string>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  const normalized = requiredNonEmptyString(value, `${pathName}.${key}`);
  if (
    normalized.split(/[\\/]/u).some((part) => part === "..") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\")
  ) {
    throw new NexusAutomationConfigError(
      `${pathName}.${key} must be a project-relative path`,
    );
  }

  return { [key]: normalized } as Record<Key, string>;
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

function optionalNullablePositiveIntegerField<Key extends string>(
  record: Record<string, unknown>,
  key: Key,
  pathName: string,
): Partial<Record<Key, number | null>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: null } as Record<Key, null>;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusAutomationConfigError(
      `${pathName}.${key} must be a positive integer or null`,
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

function optionalStringArray(
  value: unknown,
  pathName: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusAutomationConfigError(`${pathName} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${pathName}[${index}]`),
  );
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
