import os from "node:os";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "./workItemService.js";
import {
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import type {
  LocalWorkTrackingConfig,
  WorkComment,
  WorkItem,
} from "./workTrackingTypes.js";

export const coordinationHandoffCommentMarker = "DevNexus coordination handoff";
export const coordinationHandoffKind = "dev-nexus.coordination.handoff";
export const defaultCoordinationHandoffStaleAfterMs = 24 * 60 * 60 * 1000;

export type NexusCoordinationHandoffStatus =
  | "working"
  | "ready"
  | "blocked"
  | "merged";

export interface NexusCoordinationGitStatus {
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  baseRef: string | null;
  headCommit: string | null;
  dirty: boolean | null;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  ahead: number | null;
  behind: number | null;
  pushed: boolean | null;
  warnings: string[];
}

export interface NexusCoordinationHandoffRecord {
  kind: typeof coordinationHandoffKind;
  version: 1;
  createdAt: string;
  projectId: string;
  projectRoot: string;
  componentId: string;
  componentName: string;
  workItemId: string;
  hostId: string;
  agentId: string | null;
  status: NexusCoordinationHandoffStatus;
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  baseRef: string | null;
  headCommit: string | null;
  dirty: boolean | null;
  ahead: number | null;
  behind: number | null;
  pushed: boolean | null;
  changedAreas: string[];
  decisions: string[];
  verificationSummary: string | null;
  integrationPreference: string | null;
  note: string | null;
}

export interface NexusCoordinationHandoffSummary
  extends NexusCoordinationHandoffRecord {
  commentId: string | null;
  commentCreatedAt: string | null;
  stale: boolean;
  ageMs: number | null;
}

export interface NexusCoordinationHandoffCollection {
  available: boolean;
  provider: string | null;
  records: NexusCoordinationHandoffSummary[];
  warnings: string[];
}

export interface NexusCoordinationStatus {
  project: {
    id: string;
    name: string;
    projectRoot: string;
  };
  component: {
    id: string;
    name: string;
    role: string;
    sourceRoot: string;
    worktreesRoot: string;
    workTrackingProvider: string | null;
  };
  workItem: WorkItem | null;
  git: NexusCoordinationGitStatus;
  handoffs: NexusCoordinationHandoffCollection;
  nextAction: string;
  blocking: boolean;
  warnings: string[];
}

export interface NexusCoordinationStatusOptions {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  currentPath?: string;
  gitRunner?: GitRunner;
  now?: () => Date | string;
  maxHandoffAgeMs?: number;
}

export interface NexusCoordinationHandoffOptions
  extends NexusCoordinationStatusOptions {
  workItemId: string;
  status: NexusCoordinationHandoffStatus;
  hostId?: string;
  agentId?: string;
  changedAreas?: string[];
  decisions?: string[];
  verificationSummary?: string | null;
  integrationPreference?: string | null;
  note?: string | null;
}

export interface NexusCoordinationHandoffResult {
  project: NexusCoordinationStatus["project"];
  component: NexusCoordinationStatus["component"];
  record: NexusCoordinationHandoffRecord;
  comment: WorkComment;
  git: NexusCoordinationGitStatus;
}

interface ResolvedCoordinationContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  currentPath: string;
}

const handoffStatuses = new Set<NexusCoordinationHandoffStatus>([
  "working",
  "ready",
  "blocked",
  "merged",
]);

export async function getNexusCoordinationStatus(
  options: NexusCoordinationStatusOptions,
): Promise<NexusCoordinationStatus> {
  const context = resolveCoordinationContext(options);
  const git = getCoordinationGitStatus(context, options.gitRunner);
  const workItem = options.workItemId
    ? await workItemServiceForContext(context, options.now).getWorkItem({
        projectRoot: context.projectRoot,
        componentId: context.component.id,
        id: options.workItemId,
      })
    : null;
  const now = currentTimestamp(options.now);
  const handoffs = readCoordinationHandoffs({
    context,
    workItemId: options.workItemId,
    now,
    maxHandoffAgeMs:
      options.maxHandoffAgeMs ?? defaultCoordinationHandoffStaleAfterMs,
  });
  const warnings = [...git.warnings, ...handoffs.warnings];

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    workItem,
    git,
    handoffs,
    nextAction: coordinationNextAction(git),
    blocking: false,
    warnings,
  };
}

export async function createNexusCoordinationHandoff(
  options: NexusCoordinationHandoffOptions,
): Promise<NexusCoordinationHandoffResult> {
  const context = resolveCoordinationContext(options);
  const status = parseNexusCoordinationHandoffStatus(options.status, "status");
  const git = getCoordinationGitStatus(context, options.gitRunner);
  const timestamp = currentTimestamp(options.now);
  const record: NexusCoordinationHandoffRecord = {
    kind: coordinationHandoffKind,
    version: 1,
    createdAt: timestamp,
    projectId: context.projectConfig.id,
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    componentName: context.component.name,
    workItemId: requiredNonEmptyString(options.workItemId, "workItemId"),
    hostId: optionalTrimmedString(options.hostId) ?? os.hostname(),
    agentId: optionalTrimmedString(options.agentId) ?? null,
    status,
    repositoryPath: git.repositoryPath,
    branch: git.branch,
    upstream: git.upstream,
    baseRef: git.baseRef,
    headCommit: git.headCommit,
    dirty: git.dirty,
    ahead: git.ahead,
    behind: git.behind,
    pushed: git.pushed,
    changedAreas: normalizedStringArray(options.changedAreas, "changedAreas"),
    decisions: normalizedStringArray(options.decisions, "decisions"),
    verificationSummary:
      optionalNullableTrimmedString(options.verificationSummary) ?? null,
    integrationPreference:
      optionalNullableTrimmedString(options.integrationPreference) ?? null,
    note: optionalNullableTrimmedString(options.note) ?? null,
  };
  const comment = await workItemServiceForContext(context, options.now).addComment({
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    ref: { id: record.workItemId },
    body: formatCoordinationHandoffComment(record),
  });

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    record,
    comment,
    git,
  };
}

export function parseNexusCoordinationHandoffStatus(
  value: string,
  pathName: string,
): NexusCoordinationHandoffStatus {
  if (handoffStatuses.has(value as NexusCoordinationHandoffStatus)) {
    return value as NexusCoordinationHandoffStatus;
  }

  throw new Error(`${pathName} must be working, ready, blocked, or merged`);
}

export function formatCoordinationHandoffComment(
  record: NexusCoordinationHandoffRecord,
): string {
  const lines = [
    coordinationHandoffCommentMarker,
    "",
    `Status: ${record.status}`,
    `Host: ${record.hostId}`,
    `Branch: ${record.branch ?? "unknown"}`,
    `Head: ${record.headCommit ?? "unknown"}`,
    "",
    "```json",
    JSON.stringify(record, null, 2),
    "```",
  ];
  return lines.join("\n");
}

function resolveCoordinationContext(
  options: NexusCoordinationStatusOptions,
): ResolvedCoordinationContext {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const currentPath = path.resolve(options.currentPath ?? process.cwd());
  const component = resolveCoordinationComponent(
    projectRoot,
    projectConfig,
    options.componentId,
    currentPath,
  );
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    projectRoot,
    projectConfig,
    component,
    currentPath,
  };
}

function resolveCoordinationComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string | undefined,
  currentPath: string,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (componentId) {
    const component = components.find((candidate) => candidate.id === componentId);
    if (!component) {
      throw new Error(`Project component is not configured: ${componentId}`);
    }

    return component;
  }

  const inferred = components
    .flatMap((component) => [
      { component, root: component.sourceRoot },
      { component, root: component.worktreesRoot },
    ])
    .filter((candidate) => samePathOrDescendant(currentPath, candidate.root))
    .sort((a, b) => b.root.length - a.root.length)[0];

  return inferred?.component ?? resolvePrimaryProjectComponent(projectRoot, projectConfig);
}

function workItemServiceForContext(
  context: ResolvedCoordinationContext,
  now?: () => Date | string,
) {
  return createWorkItemService({
    resolveProject: () => workItemProjectContext(context),
    now,
  });
}

function workItemProjectContext(
  context: ResolvedCoordinationContext,
): ResolvedWorkItemProjectContext {
  const workTracking = context.component.workTracking;
  if (!workTracking) {
    throw new Error(`Component ${context.component.id} work tracking is not configured`);
  }

  return {
    homePath: context.projectConfig.home ?? "",
    projectRoot: context.projectRoot,
    projectId: context.projectConfig.id,
    projectName: context.projectConfig.name,
    componentId: context.component.id,
    componentName: context.component.name,
    sourceRoot: context.component.sourceRoot,
    workTracking,
  };
}

function getCoordinationGitStatus(
  context: ResolvedCoordinationContext,
  gitRunner: GitRunner | undefined,
): NexusCoordinationGitStatus {
  const runner = gitRunner ?? defaultGitRunner;
  const repositoryPath = findGitRepositoryPath(runner, [
    context.currentPath,
    context.component.sourceRoot,
  ]);
  const baseRefFallback = context.component.defaultBranch;
  if (!repositoryPath) {
    return {
      repositoryPath: null,
      branch: null,
      upstream: null,
      baseRef: baseRefFallback,
      headCommit: null,
      dirty: null,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      ahead: null,
      behind: null,
      pushed: null,
      warnings: ["No git repository could be resolved for the coordination path."],
    };
  }

  const branch = gitStdout(
    runOptionalGit(runner, ["symbolic-ref", "--short", "HEAD"], repositoryPath),
  );
  const headCommit = gitStdout(
    runOptionalGit(runner, ["rev-parse", "HEAD"], repositoryPath),
  );
  const upstream = gitStdout(
    runOptionalGit(
      runner,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      repositoryPath,
    ),
  );
  const parsedStatus = parsePorcelainStatus(
    gitStdout(runOptionalGit(runner, ["status", "--porcelain=v1"], repositoryPath)) ??
      "",
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
  const warnings: string[] = [];
  if (!upstream) {
    warnings.push("Current branch has no upstream configured.");
  }

  return {
    repositoryPath,
    branch,
    upstream,
    baseRef: upstream ?? baseRefFallback,
    headCommit,
    dirty: parsedStatus.dirty,
    stagedCount: parsedStatus.stagedCount,
    unstagedCount: parsedStatus.unstagedCount,
    untrackedCount: parsedStatus.untrackedCount,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    pushed: upstream && aheadBehind.ahead !== null ? aheadBehind.ahead === 0 : null,
    warnings,
  };
}

function findGitRepositoryPath(
  gitRunner: GitRunner,
  candidates: string[],
): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    const result = runOptionalGit(gitRunner, ["rev-parse", "--show-toplevel"], resolved);
    const repositoryPath = gitStdout(result);
    if (repositoryPath) {
      return path.resolve(repositoryPath);
    }
  }

  return null;
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

    const staged = line[0];
    const unstaged = line[1];
    if (staged && staged !== " ") {
      stagedCount += 1;
    }
    if (unstaged && unstaged !== " ") {
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

function parseAheadBehind(
  output: string | null,
): { ahead: number | null; behind: number | null } {
  if (!output) {
    return { ahead: null, behind: null };
  }
  const [aheadValue, behindValue] = output.split(/\s+/u);
  const ahead = Number(aheadValue);
  const behind = Number(behindValue);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return { ahead: null, behind: null };
  }

  return { ahead, behind };
}

function readCoordinationHandoffs(options: {
  context: ResolvedCoordinationContext;
  workItemId?: string;
  now: string;
  maxHandoffAgeMs: number;
}): NexusCoordinationHandoffCollection {
  const provider = options.context.component.workTracking?.provider ?? null;
  if (provider !== "local") {
    return {
      available: false,
      provider,
      records: [],
      warnings: [
        "Related handoffs cannot be read because the configured provider does not expose comments through DevNexus core.",
      ],
    };
  }

  const workTracking = options.context.component
    .workTracking as LocalWorkTrackingConfig;
  const storePath = resolveLocalWorkTrackingStorePath(
    options.context.projectRoot,
    workTracking,
  );
  const store = loadLocalWorkTrackingStore(storePath);
  const comments = options.workItemId
    ? (store.comments[options.workItemId] ?? []).map((comment) => ({
        workItemId: options.workItemId!,
        comment,
      }))
    : Object.entries(store.comments).flatMap(([workItemId, itemComments]) =>
        itemComments.map((comment) => ({ workItemId, comment })),
      );
  const nowMs = Date.parse(options.now);
  const warnings: string[] = [];
  const records = comments
    .map(({ workItemId, comment }) =>
      handoffSummaryFromComment({
        comment,
        fallbackWorkItemId: workItemId,
        projectId: options.context.projectConfig.id,
        componentId: options.context.component.id,
        nowMs,
        maxHandoffAgeMs: options.maxHandoffAgeMs,
      }),
    )
    .filter((record): record is NexusCoordinationHandoffSummary => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const record of records) {
    if (record.stale) {
      warnings.push(
        `Handoff for ${record.workItemId} from ${record.createdAt} is stale.`,
      );
    }
  }

  return {
    available: true,
    provider,
    records,
    warnings,
  };
}

function handoffSummaryFromComment(options: {
  comment: WorkComment;
  fallbackWorkItemId: string;
  projectId: string;
  componentId: string;
  nowMs: number;
  maxHandoffAgeMs: number;
}): NexusCoordinationHandoffSummary | null {
  const record = parseCoordinationHandoffComment(options.comment.body);
  if (!record) {
    return null;
  }
  if (
    record.projectId !== options.projectId ||
    record.componentId !== options.componentId
  ) {
    return null;
  }

  const createdMs = Date.parse(record.createdAt);
  const ageMs =
    Number.isFinite(createdMs) && Number.isFinite(options.nowMs)
      ? Math.max(0, options.nowMs - createdMs)
      : null;

  return {
    ...record,
    workItemId: record.workItemId || options.fallbackWorkItemId,
    commentId: options.comment.id ?? null,
    commentCreatedAt: options.comment.createdAt ?? null,
    stale:
      ageMs !== null && options.maxHandoffAgeMs >= 0
        ? ageMs > options.maxHandoffAgeMs
        : false,
    ageMs,
  };
}

function parseCoordinationHandoffComment(
  body: string,
): NexusCoordinationHandoffRecord | null {
  if (!body.includes(coordinationHandoffCommentMarker)) {
    return null;
  }

  const match = /```json\s*([\s\S]*?)```/u.exec(body);
  if (!match) {
    return null;
  }

  try {
    return handoffRecordFromUnknown(JSON.parse(match[1]!));
  } catch {
    return null;
  }
}

function handoffRecordFromUnknown(
  value: unknown,
): NexusCoordinationHandoffRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== coordinationHandoffKind || record.version !== 1) {
    return null;
  }

  return {
    kind: coordinationHandoffKind,
    version: 1,
    createdAt: requiredRecordString(record, "createdAt"),
    projectId: requiredRecordString(record, "projectId"),
    projectRoot: requiredRecordString(record, "projectRoot"),
    componentId: requiredRecordString(record, "componentId"),
    componentName: requiredRecordString(record, "componentName"),
    workItemId: requiredRecordString(record, "workItemId"),
    hostId: requiredRecordString(record, "hostId"),
    agentId: nullableRecordString(record, "agentId"),
    status: parseNexusCoordinationHandoffStatus(
      requiredRecordString(record, "status"),
      "handoff.status",
    ),
    repositoryPath: nullableRecordString(record, "repositoryPath"),
    branch: nullableRecordString(record, "branch"),
    upstream: nullableRecordString(record, "upstream"),
    baseRef: nullableRecordString(record, "baseRef"),
    headCommit: nullableRecordString(record, "headCommit"),
    dirty: nullableRecordBoolean(record, "dirty"),
    ahead: nullableRecordInteger(record, "ahead"),
    behind: nullableRecordInteger(record, "behind"),
    pushed: nullableRecordBoolean(record, "pushed"),
    changedAreas: recordStringArray(record, "changedAreas"),
    decisions: recordStringArray(record, "decisions"),
    verificationSummary: nullableRecordString(record, "verificationSummary"),
    integrationPreference: nullableRecordString(record, "integrationPreference"),
    note: nullableRecordString(record, "note"),
  };
}

function coordinationNextAction(git: NexusCoordinationGitStatus): string {
  if (!git.repositoryPath) {
    return "Open the component source or a git worktree before integration.";
  }
  if (git.dirty) {
    return "Review, commit, or explicitly hand off local changes before integration.";
  }
  if (!git.upstream) {
    return "Push the branch and set upstream, or tell the integration host where to fetch it.";
  }
  if (git.behind !== null && git.behind > 0) {
    return "Rebase or merge upstream before integration.";
  }
  if (git.ahead !== null && git.ahead > 0) {
    return "Push the branch or ask the integration host to fetch it.";
  }

  return "Ready for review or integration.";
}

function projectSummary(
  context: ResolvedCoordinationContext,
): NexusCoordinationStatus["project"] {
  return {
    id: context.projectConfig.id,
    name: context.projectConfig.name,
    projectRoot: context.projectRoot,
  };
}

function componentSummary(
  component: ResolvedNexusProjectComponent,
): NexusCoordinationStatus["component"] {
  return {
    id: component.id,
    name: component.name,
    role: component.role,
    sourceRoot: component.sourceRoot,
    worktreesRoot: component.worktreesRoot,
    workTrackingProvider: component.workTracking?.provider ?? null,
  };
}

function samePathOrDescendant(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function currentTimestamp(now?: () => Date | string): string {
  const value = now?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizedStringArray(
  values: string[] | undefined,
  pathName: string,
): string[] {
  if (!values) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = requiredNonEmptyString(value, pathName);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableTrimmedString(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return optionalTrimmedString(value) ?? null;
}

function requiredNonEmptyString(value: string, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}

function requiredRecordString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`handoff.${key} must be a non-empty string`);
  }

  return value;
}

function nullableRecordString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`handoff.${key} must be a string or null`);
  }

  return value;
}

function nullableRecordBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`handoff.${key} must be a boolean or null`);
  }

  return value;
}

function nullableRecordInteger(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`handoff.${key} must be an integer or null`);
  }

  return value;
}

function recordStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`handoff.${key} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`handoff.${key}[${index}] must be a non-empty string`);
    }

    return entry;
  });
}
