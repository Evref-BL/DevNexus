import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";
import {
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";

export const nexusWorktreeLeaseKind = "dev-nexus.worktree.lease";
export const nexusWorktreeLeaseStoreFileName = "worktree-leases.json";
export const defaultNexusWorktreeLeaseStaleAfterMs = 24 * 60 * 60 * 1000;

export type NexusWorktreeLeaseStatus =
  | "working"
  | "ready"
  | "blocked"
  | "integrating"
  | "merged"
  | "abandoned"
  | "stale";

export type NexusWorktreeLeaseScopeKind = "component" | "project_meta";

export interface NexusWorktreeLeaseScope {
  kind: NexusWorktreeLeaseScopeKind;
  componentId: string | null;
}

export type NexusWorktreeLeaseLocationKind =
  | "project_root"
  | "project_relative"
  | "project_meta_worktree"
  | "component_source"
  | "component_worktree"
  | "external";

export type NexusWorktreeLeaseLocationBase =
  | "projectRoot"
  | "projectWorktreesRoot"
  | "componentSourceRoot"
  | "componentWorktreesRoot"
  | "external";

export interface NexusWorktreeLeaseLocation {
  kind: NexusWorktreeLeaseLocationKind;
  base: NexusWorktreeLeaseLocationBase;
  componentId: string | null;
  relativePath: string | null;
}

export interface NexusWorktreeLeaseGitFactsInput {
  repositoryPath?: string | null;
  upstream?: string | null;
  headCommit?: string | null;
  dirty?: boolean | null;
  stagedCount?: number;
  unstagedCount?: number;
  untrackedCount?: number;
  ahead?: number | null;
  behind?: number | null;
  pushed?: boolean | null;
  warnings?: string[];
}

export interface NexusWorktreeLeaseGitFacts {
  repository: NexusWorktreeLeaseLocation | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  warnings: string[];
}

export interface NexusWorktreeLeaseRecord {
  kind: typeof nexusWorktreeLeaseKind;
  version: 1;
  id: string;
  projectId: string;
  scope: NexusWorktreeLeaseScope;
  hostId: string;
  agentId: string | null;
  workItemId: string | null;
  branchName: string | null;
  baseRef: string | null;
  worktree: NexusWorktreeLeaseLocation;
  writeScope: string[];
  status: NexusWorktreeLeaseStatus;
  createdAt: string;
  lastSeenAt: string;
  updatedAt: string;
  refreshCount: number;
  lastObservedHeadCommit: string | null;
  dirty: boolean | null;
  pushed: boolean | null;
  git: NexusWorktreeLeaseGitFacts;
  notes: string[];
}

export interface NexusWorktreeLeaseSummary extends NexusWorktreeLeaseRecord {
  stale: boolean;
  effectiveStatus: NexusWorktreeLeaseStatus;
  ageMs: number | null;
}

export interface NexusWorktreeLeaseStore {
  version: 1;
  updatedAt: string | null;
  leases: NexusWorktreeLeaseRecord[];
}

export interface NexusWorktreeLeaseCollection {
  storePath: string;
  records: NexusWorktreeLeaseSummary[];
  activeCount: number;
  staleCount: number;
  warnings: string[];
  blocking: false;
}

export interface CreateOrRefreshNexusWorktreeLeaseOptions {
  projectRoot: string;
  componentId?: string | null;
  projectMeta?: boolean;
  hostId?: string | null;
  agentId?: string | null;
  workItemId?: string | null;
  branchName?: string | null;
  baseRef?: string | null;
  worktreePath?: string | null;
  writeScope?: string[];
  status?: NexusWorktreeLeaseStatus;
  notes?: string[];
  gitFacts?: NexusWorktreeLeaseGitFactsInput | null;
  gitRunner?: GitRunner;
  now?: Date | string | (() => Date | string);
}

export interface ListNexusWorktreeLeasesOptions {
  projectRoot: string;
  componentId?: string | null;
  workItemId?: string | null;
  includeProjectMeta?: boolean;
  now?: Date | string | (() => Date | string);
  staleAfterMs?: number;
}

interface ResolvedLeaseContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  scope: NexusWorktreeLeaseScope;
  component: ResolvedNexusProjectComponent | null;
}

const leaseStatuses = new Set<NexusWorktreeLeaseStatus>([
  "working",
  "ready",
  "blocked",
  "integrating",
  "merged",
  "abandoned",
  "stale",
]);

const terminalLeaseStatuses = new Set<NexusWorktreeLeaseStatus>([
  "merged",
  "abandoned",
]);

export class NexusWorktreeLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusWorktreeLeaseError";
  }
}

export function nexusWorktreeLeaseStorePath(projectRoot: string): string {
  return path.join(
    path.resolve(requiredNonEmptyString(projectRoot, "projectRoot")),
    ".dev-nexus",
    nexusWorktreeLeaseStoreFileName,
  );
}

export function emptyNexusWorktreeLeaseStore(): NexusWorktreeLeaseStore {
  return {
    version: 1,
    updatedAt: null,
    leases: [],
  };
}

export function readNexusWorktreeLeaseStore(
  projectRoot: string,
): NexusWorktreeLeaseStore {
  const storePath = nexusWorktreeLeaseStorePath(projectRoot);
  if (!fs.existsSync(storePath)) {
    return emptyNexusWorktreeLeaseStore();
  }

  return normalizeNexusWorktreeLeaseStore(
    JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function writeNexusWorktreeLeaseStore(
  projectRoot: string,
  store: NexusWorktreeLeaseStore,
): string {
  const storePath = nexusWorktreeLeaseStorePath(projectRoot);
  const normalized = normalizeNexusWorktreeLeaseStore(store);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );

  return storePath;
}

export function createOrRefreshNexusWorktreeLease(
  options: CreateOrRefreshNexusWorktreeLeaseOptions,
): NexusWorktreeLeaseRecord {
  const context = resolveLeaseContext(options);
  const timestamp = currentTimestamp(options.now);
  const hostId = optionalTrimmedString(options.hostId) ?? os.hostname();
  const agentId = optionalNullableTrimmedString(options.agentId) ?? null;
  const workItemId = optionalNullableTrimmedString(options.workItemId) ?? null;
  const status = parseNexusWorktreeLeaseStatus(
    options.status ?? "working",
    "status",
  );
  const worktreePath = optionalNullableTrimmedString(options.worktreePath);
  const gitFactsInput =
    options.gitFacts ??
    collectNexusWorktreeLeaseGitFacts({
      worktreePath,
      gitRunner: options.gitRunner,
    });
  const branchName =
    optionalNullableTrimmedString(options.branchName) ??
    null;
  const baseRef = optionalNullableTrimmedString(options.baseRef) ?? null;
  const worktree = classifyLeaseLocation({
    context,
    value: worktreePath,
  });
  const git = normalizeGitFacts({
    context,
    facts: gitFactsInput,
  });
  const writeScope = normalizedStringArray(options.writeScope, "writeScope");
  const notes = normalizedStringArray(options.notes, "notes");
  const leaseIdentity = [
    context.projectConfig.id,
    context.scope.kind,
    context.scope.componentId ?? "project",
    hostId,
    agentId ?? "no-agent",
    workItemId ?? "no-work-item",
    branchName ?? "no-branch",
    locationKey(worktree),
  ].join("\u0000");
  const id = `lease-${crypto
    .createHash("sha256")
    .update(leaseIdentity)
    .digest("hex")
    .slice(0, 16)}`;
  const existing = readNexusWorktreeLeaseStore(context.projectRoot);
  const previous = existing.leases.find((lease) => lease.id === id);
  const record: NexusWorktreeLeaseRecord = {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id,
    projectId: context.projectConfig.id,
    scope: context.scope,
    hostId,
    agentId,
    workItemId,
    branchName,
    baseRef,
    worktree,
    writeScope,
    status,
    createdAt: previous?.createdAt ?? timestamp,
    lastSeenAt: timestamp,
    updatedAt: timestamp,
    refreshCount: previous ? previous.refreshCount + 1 : 0,
    lastObservedHeadCommit:
      optionalNullableTrimmedString(gitFactsInput?.headCommit) ?? null,
    dirty: normalizeNullableBoolean(gitFactsInput?.dirty, "gitFacts.dirty"),
    pushed: normalizeNullableBoolean(gitFactsInput?.pushed, "gitFacts.pushed"),
    git,
    notes,
  };
  const leases = [
    ...existing.leases.filter((lease) => lease.id !== id),
    record,
  ].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  writeNexusWorktreeLeaseStore(context.projectRoot, {
    version: 1,
    updatedAt: timestamp,
    leases,
  });

  return record;
}

export function listNexusWorktreeLeases(
  options: ListNexusWorktreeLeasesOptions,
): NexusWorktreeLeaseCollection {
  const context = resolveLeaseContext({
    projectRoot: options.projectRoot,
    componentId: options.componentId,
    projectMeta: false,
  });
  const storePath = nexusWorktreeLeaseStorePath(context.projectRoot);
  const now = currentTimestamp(options.now);
  const staleAfterMs =
    options.staleAfterMs ?? defaultNexusWorktreeLeaseStaleAfterMs;
  const records = readNexusWorktreeLeaseStore(context.projectRoot).leases
    .filter((lease) =>
      leaseAppliesToFilter(lease, {
        componentId: options.componentId ?? null,
        workItemId: options.workItemId ?? null,
        includeProjectMeta: options.includeProjectMeta !== false,
      }),
    )
    .map((lease) => summarizeLease(lease, now, staleAfterMs));
  const activeRecords = records.filter(
    (lease) => !terminalLeaseStatuses.has(lease.status),
  );
  const warnings = [
    ...records
      .filter((lease) => lease.stale)
      .map(
        (lease) =>
          `Worktree lease ${lease.id} for ${leaseLabel(lease)} last refreshed at ${lease.lastSeenAt} is stale.`,
      ),
    ...activeRecords
      .filter((lease) => !lease.stale)
      .map(
        (lease) =>
          `Active advisory worktree lease ${lease.id} for ${leaseLabel(lease)} by ${lease.hostId}${lease.agentId ? `/${lease.agentId}` : ""}; this is not a hard lock.`,
      ),
  ];

  return {
    storePath,
    records,
    activeCount: activeRecords.filter((lease) => !lease.stale).length,
    staleCount: records.filter((lease) => lease.stale).length,
    warnings,
    blocking: false,
  };
}

export function parseNexusWorktreeLeaseStatus(
  value: string,
  pathName: string,
): NexusWorktreeLeaseStatus {
  if (leaseStatuses.has(value as NexusWorktreeLeaseStatus)) {
    return value as NexusWorktreeLeaseStatus;
  }

  throw new NexusWorktreeLeaseError(
    `${pathName} must be working, ready, blocked, integrating, merged, abandoned, or stale`,
  );
}

export function collectNexusWorktreeLeaseGitFacts(options: {
  worktreePath?: string | null;
  gitRunner?: GitRunner;
}): NexusWorktreeLeaseGitFactsInput | null {
  const worktreePath = optionalNullableTrimmedString(options.worktreePath);
  if (!worktreePath) {
    return null;
  }
  const runner = options.gitRunner ?? defaultGitRunner;
  const repositoryPath = gitStdout(
    runOptionalGit(runner, ["rev-parse", "--show-toplevel"], worktreePath),
  );
  if (!repositoryPath) {
    return {
      repositoryPath: null,
      warnings: ["No git repository could be resolved for the worktree lease."],
    };
  }
  const upstream = gitStdout(
    runOptionalGit(
      runner,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      repositoryPath,
    ),
  );
  const status = parsePorcelainStatus(
    gitRawStdout(
      runOptionalGit(runner, ["status", "--porcelain=v1"], repositoryPath),
    ) ?? "",
  );
  const aheadBehind = upstream
    ? parseAheadBehind(
        gitStdout(
          runOptionalGit(
            runner,
            ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            repositoryPath,
          ),
        ),
      )
    : { ahead: null, behind: null };

  return {
    repositoryPath,
    upstream,
    headCommit: gitStdout(runOptionalGit(runner, ["rev-parse", "HEAD"], repositoryPath)),
    dirty: status.dirty,
    stagedCount: status.stagedCount,
    unstagedCount: status.unstagedCount,
    untrackedCount: status.untrackedCount,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    pushed: upstream && aheadBehind.ahead !== null ? aheadBehind.ahead === 0 : null,
    warnings: upstream ? [] : ["Current branch has no upstream configured."],
  };
}

export function normalizeNexusWorktreeLeaseStore(
  value: unknown,
): NexusWorktreeLeaseStore {
  if (value === undefined || value === null) {
    return emptyNexusWorktreeLeaseStore();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusWorktreeLeaseError("worktree lease store must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new NexusWorktreeLeaseError("worktree lease store.version must be 1");
  }

  return {
    version: 1,
    updatedAt: optionalNullableTrimmedString(record.updatedAt) ?? null,
    leases: normalizeArray(record.leases, "worktree lease store.leases").map(
      normalizeLeaseRecord,
    ),
  };
}

function resolveLeaseContext(options: {
  projectRoot: string;
  componentId?: string | null;
  projectMeta?: boolean;
}): ResolvedLeaseContext {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  if (options.projectMeta && options.componentId) {
    throw new NexusWorktreeLeaseError(
      "worktree lease accepts either projectMeta or componentId, not both",
    );
  }
  if (options.projectMeta) {
    return {
      projectRoot,
      projectConfig,
      scope: {
        kind: "project_meta",
        componentId: null,
      },
      component: null,
    };
  }

  const component = resolveLeaseComponent(
    projectRoot,
    projectConfig,
    options.componentId,
  );
  return {
    projectRoot,
    projectConfig,
    scope: {
      kind: "component",
      componentId: component.id,
    },
    component,
  };
}

function resolveLeaseComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId?: string | null,
): ResolvedNexusProjectComponent {
  if (componentId) {
    const component = resolveProjectComponents(projectRoot, projectConfig).find(
      (candidate) => candidate.id === componentId,
    );
    if (!component) {
      throw new NexusWorktreeLeaseError(
        `Workspace component is not configured: ${componentId}`,
      );
    }
    return component;
  }

  return resolvePrimaryProjectComponent(projectRoot, projectConfig);
}

function classifyLeaseLocation(options: {
  context: ResolvedLeaseContext;
  value?: string | null;
}): NexusWorktreeLeaseLocation {
  const value = optionalNullableTrimmedString(options.value);
  if (!value) {
    return {
      kind: "external",
      base: "external",
      componentId: options.context.scope.componentId,
      relativePath: null,
    };
  }
  const target = path.resolve(value);
  const projectRootRelative = relativePathInside(options.context.projectRoot, target);
  const projectWorktreesRoot = projectWorktreesRootPath(
    options.context.projectRoot,
    options.context.projectConfig,
  );
  const projectWorktreeRelative = relativePathInside(projectWorktreesRoot, target);
  if (options.context.scope.kind === "project_meta" && projectWorktreeRelative) {
    return {
      kind: "project_meta_worktree",
      base: "projectWorktreesRoot",
      componentId: null,
      relativePath: projectWorktreeRelative,
    };
  }
  const component = options.context.component;
  if (component) {
    const componentWorktreeRelative = relativePathInside(
      component.worktreesRoot,
      target,
    );
    if (componentWorktreeRelative && componentWorktreeRelative !== ".") {
      return {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId: component.id,
        relativePath: componentWorktreeRelative,
      };
    }
    const componentSourceRelative = relativePathInside(component.sourceRoot, target);
    if (componentSourceRelative) {
      return {
        kind: "component_source",
        base: "componentSourceRoot",
        componentId: component.id,
        relativePath: componentSourceRelative,
      };
    }
  }
  if (projectRootRelative === ".") {
    return {
      kind: "project_root",
      base: "projectRoot",
      componentId: options.context.scope.componentId,
      relativePath: ".",
    };
  }
  if (projectRootRelative) {
    return {
      kind: "project_relative",
      base: "projectRoot",
      componentId: options.context.scope.componentId,
      relativePath: projectRootRelative,
    };
  }

  return {
    kind: "external",
    base: "external",
    componentId: options.context.scope.componentId,
    relativePath: null,
  };
}

function normalizeGitFacts(options: {
  context: ResolvedLeaseContext;
  facts: NexusWorktreeLeaseGitFactsInput | null | undefined;
}): NexusWorktreeLeaseGitFacts {
  const facts = options.facts ?? {};
  return {
    repository: facts.repositoryPath
      ? classifyLeaseLocation({
          context: options.context,
          value: facts.repositoryPath,
        })
      : null,
    upstream: optionalNullableTrimmedString(facts.upstream) ?? null,
    ahead: normalizeNullableInteger(facts.ahead, "gitFacts.ahead"),
    behind: normalizeNullableInteger(facts.behind, "gitFacts.behind"),
    stagedCount: normalizeNonNegativeInteger(
      facts.stagedCount ?? 0,
      "gitFacts.stagedCount",
    ),
    unstagedCount: normalizeNonNegativeInteger(
      facts.unstagedCount ?? 0,
      "gitFacts.unstagedCount",
    ),
    untrackedCount: normalizeNonNegativeInteger(
      facts.untrackedCount ?? 0,
      "gitFacts.untrackedCount",
    ),
    warnings: normalizedStringArray(facts.warnings, "gitFacts.warnings"),
  };
}

function normalizeLeaseRecord(value: unknown): NexusWorktreeLeaseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusWorktreeLeaseError("worktree lease record must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== nexusWorktreeLeaseKind || record.version !== 1) {
    throw new NexusWorktreeLeaseError(
      "worktree lease record must be a version 1 DevNexus lease",
    );
  }

  return {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id: requiredNonEmptyString(record.id, "lease.id"),
    projectId: requiredNonEmptyString(record.projectId, "lease.projectId"),
    scope: normalizeLeaseScope(record.scope),
    hostId: requiredNonEmptyString(record.hostId, "lease.hostId"),
    agentId: optionalNullableTrimmedString(record.agentId) ?? null,
    workItemId: optionalNullableTrimmedString(record.workItemId) ?? null,
    branchName: optionalNullableTrimmedString(record.branchName) ?? null,
    baseRef: optionalNullableTrimmedString(record.baseRef) ?? null,
    worktree: normalizeLeaseLocation(record.worktree, "lease.worktree"),
    writeScope: normalizedStringArray(record.writeScope, "lease.writeScope"),
    status: parseNexusWorktreeLeaseStatus(
      requiredNonEmptyString(record.status, "lease.status"),
      "lease.status",
    ),
    createdAt: requiredNonEmptyString(record.createdAt, "lease.createdAt"),
    lastSeenAt: requiredNonEmptyString(record.lastSeenAt, "lease.lastSeenAt"),
    updatedAt: requiredNonEmptyString(record.updatedAt, "lease.updatedAt"),
    refreshCount: normalizeNonNegativeInteger(
      record.refreshCount,
      "lease.refreshCount",
    ),
    lastObservedHeadCommit:
      optionalNullableTrimmedString(record.lastObservedHeadCommit) ?? null,
    dirty: normalizeNullableBoolean(record.dirty, "lease.dirty"),
    pushed: normalizeNullableBoolean(record.pushed, "lease.pushed"),
    git: normalizeLeaseGitFacts(record.git),
    notes: normalizedStringArray(record.notes, "lease.notes"),
  };
}

function normalizeLeaseScope(value: unknown): NexusWorktreeLeaseScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusWorktreeLeaseError("lease.scope must be an object");
  }
  const record = value as Record<string, unknown>;
  const kind = requiredNonEmptyString(record.kind, "lease.scope.kind");
  if (kind !== "component" && kind !== "project_meta") {
    throw new NexusWorktreeLeaseError(
      "lease.scope.kind must be component or project_meta",
    );
  }
  return {
    kind,
    componentId: optionalNullableTrimmedString(record.componentId) ?? null,
  };
}

function normalizeLeaseLocation(
  value: unknown,
  pathName: string,
): NexusWorktreeLeaseLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusWorktreeLeaseError(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const kind = requiredNonEmptyString(record.kind, `${pathName}.kind`);
  const base = requiredNonEmptyString(record.base, `${pathName}.base`);
  if (
    kind !== "project_root" &&
    kind !== "project_relative" &&
    kind !== "project_meta_worktree" &&
    kind !== "component_source" &&
    kind !== "component_worktree" &&
    kind !== "external"
  ) {
    throw new NexusWorktreeLeaseError(
      `${pathName}.kind must be a known worktree lease location kind`,
    );
  }
  if (
    base !== "projectRoot" &&
    base !== "projectWorktreesRoot" &&
    base !== "componentSourceRoot" &&
    base !== "componentWorktreesRoot" &&
    base !== "external"
  ) {
    throw new NexusWorktreeLeaseError(
      `${pathName}.base must be a known worktree lease location base`,
    );
  }
  const relativePath =
    optionalNullableTrimmedString(record.relativePath) ?? null;
  if (relativePath && path.isAbsolute(relativePath)) {
    throw new NexusWorktreeLeaseError(
      `${pathName}.relativePath must not be absolute`,
    );
  }

  return {
    kind,
    base,
    componentId: optionalNullableTrimmedString(record.componentId) ?? null,
    relativePath,
  };
}

function normalizeLeaseGitFacts(value: unknown): NexusWorktreeLeaseGitFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      repository: null,
      upstream: null,
      ahead: null,
      behind: null,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      warnings: [],
    };
  }
  const record = value as Record<string, unknown>;
  return {
    repository: record.repository
      ? normalizeLeaseLocation(record.repository, "lease.git.repository")
      : null,
    upstream: optionalNullableTrimmedString(record.upstream) ?? null,
    ahead: normalizeNullableInteger(record.ahead, "lease.git.ahead"),
    behind: normalizeNullableInteger(record.behind, "lease.git.behind"),
    stagedCount: normalizeNonNegativeInteger(
      record.stagedCount,
      "lease.git.stagedCount",
    ),
    unstagedCount: normalizeNonNegativeInteger(
      record.unstagedCount,
      "lease.git.unstagedCount",
    ),
    untrackedCount: normalizeNonNegativeInteger(
      record.untrackedCount,
      "lease.git.untrackedCount",
    ),
    warnings: normalizedStringArray(record.warnings, "lease.git.warnings"),
  };
}

function summarizeLease(
  lease: NexusWorktreeLeaseRecord,
  now: string,
  staleAfterMs: number,
): NexusWorktreeLeaseSummary {
  const nowMs = Date.parse(now);
  const lastSeenMs = Date.parse(lease.lastSeenAt);
  const ageMs =
    Number.isFinite(nowMs) && Number.isFinite(lastSeenMs)
      ? Math.max(0, nowMs - lastSeenMs)
      : null;
  const stale =
    lease.status === "stale" ||
    (!terminalLeaseStatuses.has(lease.status) &&
      ageMs !== null &&
      staleAfterMs >= 0 &&
      ageMs > staleAfterMs);

  return {
    ...lease,
    stale,
    effectiveStatus: stale ? "stale" : lease.status,
    ageMs,
  };
}

function leaseAppliesToFilter(
  lease: NexusWorktreeLeaseRecord,
  filter: {
    componentId: string | null;
    workItemId: string | null;
    includeProjectMeta: boolean;
  },
): boolean {
  if (!filter.componentId && !filter.workItemId) {
    return true;
  }
  if (lease.scope.kind === "project_meta") {
    return filter.includeProjectMeta;
  }
  if (filter.componentId && lease.scope.componentId !== filter.componentId) {
    return false;
  }
  if (filter.workItemId && lease.workItemId && lease.workItemId !== filter.workItemId) {
    return false;
  }

  return true;
}

function leaseLabel(lease: NexusWorktreeLeaseRecord): string {
  const scope =
    lease.scope.kind === "project_meta"
      ? "workspace-meta"
      : `component ${lease.scope.componentId ?? "unknown"}`;
  const workItem = lease.workItemId ? ` ${lease.workItemId}` : "";
  const branch = lease.branchName ? ` ${lease.branchName}` : "";
  return `${scope}${workItem}${branch}`.trim();
}

function locationKey(location: NexusWorktreeLeaseLocation): string {
  return [
    location.kind,
    location.base,
    location.componentId ?? "",
    location.relativePath ?? "",
  ].join(":");
}

function relativePathInside(basePath: string, targetPath: string): string | null {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return normalizeRelativePath(relative || ".");
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function currentTimestamp(now?: Date | string | (() => Date | string)): string {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusWorktreeLeaseError("now must be a valid date");
  }

  return date.toISOString();
}

function runOptionalGit(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result : null;
  } catch {
    return null;
  }
}

function gitStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout.trim();
  return value ? value : null;
}

function gitRawStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout;
  return value && value.length > 0 ? value : null;
}

function parsePorcelainStatus(output: string): {
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
} {
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  for (const line of output.split(/\r?\n/u)) {
    if (!line) {
      continue;
    }
    if (line.startsWith("??")) {
      untrackedCount += 1;
      continue;
    }
    const staged = line[0] ?? " ";
    const unstaged = line[1] ?? " ";
    if (staged !== " ") {
      stagedCount += 1;
    }
    if (unstaged !== " ") {
      unstagedCount += 1;
    }
  }

  return {
    dirty: stagedCount + unstagedCount + untrackedCount > 0,
    stagedCount,
    unstagedCount,
    untrackedCount,
  };
}

function parseAheadBehind(value: string | null): {
  ahead: number | null;
  behind: number | null;
} {
  const parts = value?.trim().split(/\s+/u);
  if (!parts || parts.length < 2) {
    return { ahead: null, behind: null };
  }
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  return {
    ahead: Number.isInteger(ahead) ? ahead : null,
    behind: Number.isInteger(behind) ? behind : null,
  };
}

function normalizedStringArray(
  values: unknown,
  pathName: string,
): string[] {
  if (values === undefined || values === null) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new NexusWorktreeLeaseError(`${pathName} must be an array`);
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
    throw new NexusWorktreeLeaseError(`${pathName} must be an array`);
  }

  return value;
}

function normalizeNullableBoolean(
  value: unknown,
  pathName: string,
): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new NexusWorktreeLeaseError(`${pathName} must be a boolean or null`);
  }

  return value;
}

function normalizeNullableInteger(
  value: unknown,
  pathName: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new NexusWorktreeLeaseError(`${pathName} must be an integer or null`);
  }

  return value;
}

function normalizeNonNegativeInteger(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new NexusWorktreeLeaseError(
      `${pathName} must be a non-negative integer`,
    );
  }

  return value;
}

function optionalTrimmedString(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, "value");
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusWorktreeLeaseError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
