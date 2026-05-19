import type {
  WorkStatus,
  WorkTrackingProviderName,
} from "./workTrackingTypes.js";

export type NexusVersionScopeStatus =
  | "committed"
  | "candidate"
  | "stretch"
  | "deferred"
  | "excluded";

export type NexusVersionScopeKind =
  | "work_item"
  | "label"
  | "milestone"
  | "tracker_query";

export type NexusVersionReadinessGateKind =
  | "work_items_done"
  | "no_blockers"
  | "checks_green"
  | "docs_ready"
  | "migration_ready"
  | "release_authority";

export type NexusVersionReleaseActionPolicy = "none" | "manual";
export type NexusVersionReleaseArtifactPolicy =
  | "none"
  | "optional"
  | "required";

export interface NexusVersionTrackerQueryDescriptor {
  provider: WorkTrackingProviderName | null;
  text: string | null;
  statuses: WorkStatus[];
  labels: string[];
  milestones: string[];
  assignees: string[];
}

export interface NexusVersionScopeEntryBase {
  kind: NexusVersionScopeKind;
  status: NexusVersionScopeStatus;
  componentId: string;
  trackerId: string | null;
}

export interface NexusVersionWorkItemScopeEntry
  extends NexusVersionScopeEntryBase {
  kind: "work_item";
  workItemId: string;
}

export interface NexusVersionLabelScopeEntry
  extends NexusVersionScopeEntryBase {
  kind: "label";
  label: string;
}

export interface NexusVersionMilestoneScopeEntry
  extends NexusVersionScopeEntryBase {
  kind: "milestone";
  milestone: string;
}

export interface NexusVersionTrackerQueryScopeEntry
  extends NexusVersionScopeEntryBase {
  kind: "tracker_query";
  query: NexusVersionTrackerQueryDescriptor;
}

export type NexusVersionScopeEntry =
  | NexusVersionWorkItemScopeEntry
  | NexusVersionLabelScopeEntry
  | NexusVersionMilestoneScopeEntry
  | NexusVersionTrackerQueryScopeEntry;

export interface NexusVersionReadinessGate {
  kind: NexusVersionReadinessGateKind;
  required: boolean;
  components: string[];
  checkNames?: string[];
}

export interface NexusVersionReleasePolicy {
  tags: NexusVersionReleaseActionPolicy;
  packages: NexusVersionReleaseActionPolicy;
  providerRelease: NexusVersionReleaseActionPolicy;
  releaseNotes: NexusVersionReleaseArtifactPolicy;
  changelog: NexusVersionReleaseArtifactPolicy;
}

export interface NexusVersionConfig {
  id: string;
  objective: string;
  owningComponents: string[];
  targetBranch: string;
  scope: NexusVersionScopeEntry[];
  readinessGates: NexusVersionReadinessGate[];
  releasePolicy: NexusVersionReleasePolicy;
}

export interface NexusVersionPlanningConfig {
  versions: NexusVersionConfig[];
}

export interface NexusVersionPlanningValidationOptions {
  componentIds?: ReadonlySet<string>;
  pathName?: string;
}

export class NexusVersionPlanningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusVersionPlanningConfigError";
  }
}

const versionScopeStatuses: NexusVersionScopeStatus[] = [
  "committed",
  "candidate",
  "stretch",
  "deferred",
  "excluded",
];

const readinessGateKinds: NexusVersionReadinessGateKind[] = [
  "work_items_done",
  "no_blockers",
  "checks_green",
  "docs_ready",
  "migration_ready",
  "release_authority",
];

const releasePolicyKeys = [
  "tags",
  "packages",
  "providerRelease",
  "releaseNotes",
  "changelog",
];

const defaultReleasePolicy: NexusVersionReleasePolicy = {
  tags: "none",
  packages: "none",
  providerRelease: "none",
  releaseNotes: "none",
  changelog: "none",
};

export function validateNexusVersionPlanningConfig(
  value: unknown,
  options: NexusVersionPlanningValidationOptions = {},
): NexusVersionPlanningConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = options.pathName ?? "versionPlanning";
  const record = assertRecord(value, pathName);
  const versionsValue = record.versions;
  if (!Array.isArray(versionsValue)) {
    throw new NexusVersionPlanningConfigError(
      `${pathName}.versions must be an array`,
    );
  }

  const versions = versionsValue.map((entry, index) =>
    validateVersionConfig(entry, `${pathName}.versions[${index}]`, options),
  );
  const ids = new Set<string>();
  for (const version of versions) {
    if (ids.has(version.id)) {
      throw new NexusVersionPlanningConfigError(
        `${pathName}.versions contains duplicate id: ${version.id}`,
      );
    }
    ids.add(version.id);
  }

  return { versions };
}

function validateVersionConfig(
  value: unknown,
  pathName: string,
  options: NexusVersionPlanningValidationOptions,
): NexusVersionConfig {
  const record = assertRecord(value, pathName);
  const id = requiredNonEmptyString(record.id, `${pathName}.id`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)) {
    throw new NexusVersionPlanningConfigError(
      `${pathName}.id must start with a letter or digit and contain only letters, digits, dots, underscores, or dashes`,
    );
  }

  return {
    id,
    objective: requiredNonEmptyString(record.objective, `${pathName}.objective`),
    owningComponents: validateComponentRefs(
      record.owningComponents,
      `${pathName}.owningComponents`,
      options.componentIds,
    ),
    targetBranch: requiredNonEmptyString(
      record.targetBranch,
      `${pathName}.targetBranch`,
    ),
    scope: validateScopeEntries(
      record.scope,
      `${pathName}.scope`,
      options.componentIds,
    ),
    readinessGates: validateReadinessGates(
      record.readinessGates,
      `${pathName}.readinessGates`,
      options.componentIds,
    ),
    releasePolicy: validateReleasePolicy(
      record.releasePolicy,
      `${pathName}.releasePolicy`,
    ),
  };
}

function validateScopeEntries(
  value: unknown,
  pathName: string,
  componentIds: ReadonlySet<string> | undefined,
): NexusVersionScopeEntry[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusVersionPlanningConfigError(`${pathName} must be an array`);
  }

  return value.map((entry, index) =>
    validateScopeEntry(entry, `${pathName}[${index}]`, componentIds),
  );
}

function validateScopeEntry(
  value: unknown,
  pathName: string,
  componentIds: ReadonlySet<string> | undefined,
): NexusVersionScopeEntry {
  const record = assertRecord(value, pathName);
  const kind = validateScopeKind(record.kind, `${pathName}.kind`);
  const common = {
    kind,
    status: validateScopeStatus(record.status, `${pathName}.status`),
    componentId: validateComponentRef(
      record.componentId,
      `${pathName}.componentId`,
      componentIds,
    ),
    trackerId: optionalNullableString(record.trackerId, `${pathName}.trackerId`) ??
      null,
  };

  switch (kind) {
    case "work_item":
      return {
        ...common,
        kind,
        workItemId: requiredNonEmptyString(
          record.workItemId,
          `${pathName}.workItemId`,
        ),
      };
    case "label":
      return {
        ...common,
        kind,
        label: requiredNonEmptyString(record.label, `${pathName}.label`),
      };
    case "milestone":
      return {
        ...common,
        kind,
        milestone: requiredNonEmptyString(
          record.milestone,
          `${pathName}.milestone`,
        ),
      };
    case "tracker_query":
      return {
        ...common,
        kind,
        query: validateTrackerQueryDescriptor(
          record.query,
          `${pathName}.query`,
        ),
      };
  }
}

function validateTrackerQueryDescriptor(
  value: unknown,
  pathName: string,
): NexusVersionTrackerQueryDescriptor {
  const record = assertRecord(value, pathName);
  const query = {
    provider: validateProvider(record.provider, `${pathName}.provider`),
    text: optionalNullableString(record.text, `${pathName}.text`) ?? null,
    statuses: validateWorkStatuses(record.statuses, `${pathName}.statuses`),
    labels: optionalStringArray(record.labels, `${pathName}.labels`),
    milestones: optionalStringArray(record.milestones, `${pathName}.milestones`),
    assignees: optionalStringArray(record.assignees, `${pathName}.assignees`),
  };

  if (
    !query.provider &&
    !query.text &&
    query.statuses.length === 0 &&
    query.labels.length === 0 &&
    query.milestones.length === 0 &&
    query.assignees.length === 0
  ) {
    throw new NexusVersionPlanningConfigError(
      `${pathName} must define provider, text, statuses, labels, milestones, or assignees`,
    );
  }

  return query;
}

function validateReadinessGates(
  value: unknown,
  pathName: string,
  componentIds: ReadonlySet<string> | undefined,
): NexusVersionReadinessGate[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusVersionPlanningConfigError(`${pathName} must be an array`);
  }

  return value.map((entry, index) => {
    const gatePath = `${pathName}[${index}]`;
    const record = assertRecord(entry, gatePath);
    const gate: NexusVersionReadinessGate = {
      kind: validateReadinessGateKind(record.kind, `${gatePath}.kind`),
      required: optionalBoolean(record.required, `${gatePath}.required`) ?? true,
      components: validateOptionalComponentRefs(
        record.components,
        `${gatePath}.components`,
        componentIds,
      ),
    };
    const checkNames = optionalStringArray(
      record.checkNames,
      `${gatePath}.checkNames`,
    );
    return checkNames.length > 0 ? { ...gate, checkNames } : gate;
  });
}

function validateReleasePolicy(
  value: unknown,
  pathName: string,
): NexusVersionReleasePolicy {
  if (value === undefined) {
    return { ...defaultReleasePolicy };
  }
  const record = assertRecord(value, pathName);
  for (const key of Object.keys(record)) {
    if (!releasePolicyKeys.includes(key)) {
      throw new NexusVersionPlanningConfigError(
        `${pathName}.${key} is not supported`,
      );
    }
  }

  return {
    tags: validateReleaseActionPolicy(record.tags, `${pathName}.tags`),
    packages: validateReleaseActionPolicy(
      record.packages,
      `${pathName}.packages`,
    ),
    providerRelease: validateReleaseActionPolicy(
      record.providerRelease,
      `${pathName}.providerRelease`,
    ),
    releaseNotes: validateReleaseArtifactPolicy(
      record.releaseNotes,
      `${pathName}.releaseNotes`,
    ),
    changelog: validateReleaseArtifactPolicy(
      record.changelog,
      `${pathName}.changelog`,
    ),
  };
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusVersionPlanningConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusVersionPlanningConfigError(
      `${pathName} must be a non-empty string`,
    );
  }

  return value.trim();
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

function optionalStringArray(value: unknown, pathName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusVersionPlanningConfigError(`${pathName} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${pathName}[${index}]`),
  );
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new NexusVersionPlanningConfigError(`${pathName} must be a boolean`);
  }

  return value;
}

function validateComponentRefs(
  value: unknown,
  pathName: string,
  componentIds: ReadonlySet<string> | undefined,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NexusVersionPlanningConfigError(
      `${pathName} must be a non-empty array`,
    );
  }

  return value.map((entry, index) =>
    validateComponentRef(entry, `${pathName}[${index}]`, componentIds),
  );
}

function validateOptionalComponentRefs(
  value: unknown,
  pathName: string,
  componentIds: ReadonlySet<string> | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusVersionPlanningConfigError(`${pathName} must be an array`);
  }

  return value.map((entry, index) =>
    validateComponentRef(entry, `${pathName}[${index}]`, componentIds),
  );
}

function validateComponentRef(
  value: unknown,
  pathName: string,
  componentIds: ReadonlySet<string> | undefined,
): string {
  const componentId = requiredNonEmptyString(value, pathName);
  if (componentIds && !componentIds.has(componentId)) {
    throw new NexusVersionPlanningConfigError(
      `${pathName} references unknown component: ${componentId}`,
    );
  }

  return componentId;
}

function validateScopeKind(
  value: unknown,
  pathName: string,
): NexusVersionScopeKind {
  if (
    value === "work_item" ||
    value === "label" ||
    value === "milestone" ||
    value === "tracker_query"
  ) {
    return value;
  }

  throw new NexusVersionPlanningConfigError(
    `${pathName} must be work_item, label, milestone, or tracker_query`,
  );
}

function validateScopeStatus(
  value: unknown,
  pathName: string,
): NexusVersionScopeStatus {
  if (versionScopeStatuses.includes(value as NexusVersionScopeStatus)) {
    return value as NexusVersionScopeStatus;
  }

  throw new NexusVersionPlanningConfigError(
    `${pathName} must be ${humanList(versionScopeStatuses)}`,
  );
}

function validateReadinessGateKind(
  value: unknown,
  pathName: string,
): NexusVersionReadinessGateKind {
  if (readinessGateKinds.includes(value as NexusVersionReadinessGateKind)) {
    return value as NexusVersionReadinessGateKind;
  }

  throw new NexusVersionPlanningConfigError(
    `${pathName} must be ${humanList(readinessGateKinds)}`,
  );
}

function validateProvider(
  value: unknown,
  pathName: string,
): WorkTrackingProviderName | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    value === "local" ||
    value === "vibe-kanban" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new NexusVersionPlanningConfigError(
    `${pathName} must be local, vibe-kanban, github, gitlab, or jira`,
  );
}

function validateWorkStatuses(value: unknown, pathName: string): WorkStatus[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusVersionPlanningConfigError(`${pathName} must be an array`);
  }

  return value.map((entry, index) =>
    validateWorkStatus(entry, `${pathName}[${index}]`),
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

  throw new NexusVersionPlanningConfigError(
    `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
  );
}

function validateReleaseActionPolicy(
  value: unknown,
  pathName: string,
): NexusVersionReleaseActionPolicy {
  if (value === undefined) {
    return "none";
  }
  if (value === "none" || value === "manual") {
    return value;
  }

  throw new NexusVersionPlanningConfigError(`${pathName} must be none or manual`);
}

function validateReleaseArtifactPolicy(
  value: unknown,
  pathName: string,
): NexusVersionReleaseArtifactPolicy {
  if (value === undefined) {
    return "none";
  }
  if (value === "none" || value === "optional" || value === "required") {
    return value;
  }

  throw new NexusVersionPlanningConfigError(
    `${pathName} must be none, optional, or required`,
  );
}

function humanList(values: readonly string[]): string {
  if (values.length <= 1) {
    return values.join("");
  }

  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}
