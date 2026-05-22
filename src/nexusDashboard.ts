import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultGitRunner,
  type GitRunner,
} from "./gitWorktreeService.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  readNexusAutomationRunLedger,
} from "./nexusAutomation.js";
import type { NexusAutomationRunRecord } from "./nexusAutomation.js";
import type { NexusAutomationStatus } from "./nexusAutomationStatus.js";
import {
  getNexusAutomationStatus,
  type GetNexusAutomationStatusOptions,
} from "./nexusAutomationStatus.js";
import {
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleRecord,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  buildNexusCleanupPlan,
  type NexusCleanupCandidate,
} from "./nexusCleanupPlan.js";
import {
  getNexusEligibleWorkSummary,
  type NexusEligibleWorkSummary,
  type NexusEligibleWorkMode,
} from "./nexusEligibleWorkSummary.js";
import {
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  projectPluginCapabilityProjections,
  type NexusPluginCapabilityProjection,
} from "./nexusPluginCapabilities.js";
import {
  resolveProjectComponents,
  samePath,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import type { NexusProjectReference } from "./nexusProjectRegistry.js";
import {
  listNexusWorktreeLeases,
  nexusWorktreeLeaseStorePath,
  type NexusWorktreeLeaseCollection,
  type NexusWorktreeLeaseSummary,
} from "./nexusWorktreeLease.js";
import {
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import type {
  WorkItem,
  WorkTrackerRef,
} from "./workTrackingTypes.js";

export type NexusDashboardSignalTone =
  | "good"
  | "active"
  | "warn"
  | "danger"
  | "neutral";

export type NexusDashboardEventSource =
  | "actual"
  | "derived"
  | "warning";

export type NexusDashboardEventSeverity =
  | "info"
  | "success"
  | "warning"
  | "danger";

export type NexusDashboardWeaveNodeKind =
  | "project"
  | "component"
  | "tracker"
  | "source"
  | "branch"
  | "commit"
  | "worktree"
  | "work-item"
  | "target-cycle"
  | "run"
  | "authority"
  | "blocker";

export type NexusDashboardWeaveEdgeKind =
  | "contains"
  | "tracks"
  | "owns"
  | "checks-out"
  | "points-to"
  | "records"
  | "selected"
  | "blocked-by"
  | "published-by";

export type NexusDashboardProviderActionKind =
  | "issue"
  | "pull-request"
  | "provider-link";

export interface NexusDashboardProviderAction {
  label: string;
  href: string;
  provider: "github" | "web";
  kind: NexusDashboardProviderActionKind;
  title: string | null;
}

export type NexusDashboardContractScope = "host" | "workspace" | "diagnostics";

export type NexusDashboardContractOwner =
  | "dev-nexus"
  | "host-app"
  | "provider"
  | "assistant-provider";

export type NexusDashboardContractSurfaceId =
  | "hostSummary"
  | "workspaceSummary"
  | "selectedWorkspaceSnapshot"
  | "actionQueue"
  | "providerActions"
  | "plugins"
  | "threadActions"
  | "trackedWork";

export interface NexusDashboardContractSurface {
  field: string;
  endpoint: string;
  owner: NexusDashboardContractOwner;
  defaultPayload: boolean;
  action: "read" | "open-provider" | "start-chat" | "local-thread-action";
}

export interface NexusDashboardContractSelection {
  hostMode: boolean;
  workspaceQueryParam: "workspace";
  selectedWorkspaceId: string | null;
  selectedWorkspaceRoot: string | null;
}

export interface NexusDashboardEmbeddingContract {
  version: 1;
  scope: NexusDashboardContractScope;
  ownership: {
    devNexus: string[];
    hostApp: string[];
  };
  selection: NexusDashboardContractSelection;
  surfaces: Record<
    NexusDashboardContractSurfaceId,
    NexusDashboardContractSurface
  >;
  diagnostics: {
    defaultPayload: boolean;
    endpoint: string;
  };
  routes: {
    host: string;
    dashboard: string;
    diagnostics: string;
    projects: string;
    weave: string;
    events: string;
    threadAction: string;
    threadResolution: string;
  };
}

export interface BuildNexusDashboardSnapshotOptions
  extends Pick<
    GetNexusAutomationStatusOptions,
    "homePath" | "env" | "credentialResolver" | "provider" | "providerFactory" | "providerOptions"
  > {
  projectRoot: string;
  eligibleWorkMode?: NexusEligibleWorkMode;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface NexusDashboardDataError {
  name: string;
  message: string;
}

export interface NexusDashboardDataResult<T> {
  ok: boolean;
  value: T | null;
  error: NexusDashboardDataError | null;
}

export interface NexusDashboardSignal {
  id: string;
  label: string;
  value: string;
  tone: NexusDashboardSignalTone;
  detail: string;
}

export interface NexusDashboardGitState {
  repositoryPath: string;
  branch: string | null;
  upstream: string | null;
  headCommit: string | null;
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  ahead: number | null;
  behind: number | null;
  warnings: string[];
}

export interface NexusDashboardComponentSummary {
  id: string;
  name: string;
  kind: ResolvedNexusProjectComponent["kind"];
  role: ResolvedNexusProjectComponent["role"];
  remoteUrl: string | null;
  sourceRoot: string;
  sourceRootExists: boolean;
  worktreesRoot: string;
  defaultTrackerId: string | null;
  trackerProviders: string[];
  verificationRequired: boolean;
  publicationStrategy: string | null;
  git: NexusDashboardGitState | null;
}

export interface NexusDashboardProjectSummary {
  id: string;
  name: string;
  root: string;
  componentCount: number;
  defaultBranch: string | null;
  remoteUrl: string | null;
}

interface NexusDashboardProviderUrls {
  project: string | null;
  components: Map<string, string | null>;
}

export interface NexusDashboardPublicationSummary {
  componentId: string | null;
  strategy: string;
  targetBranch: string | null;
  remote: string | null;
  blocking: boolean;
  actorStatus: string | null;
  authorityStatus: string | null;
  warnings: string[];
}

export interface NexusDashboardAuthoritySummary {
  summary: string;
  warningCount: number;
  blockedActionCount: number;
  waitingActionCount: number;
  fallbackActionCount: number;
  components: Array<{
    componentId: string;
    actorStatus: string;
    roles: string[];
    blockedActions: string[];
    warnings: string[];
  }>;
}

export interface NexusDashboardWorktreeSummary {
  activeCount: number;
  staleCount: number;
  warnings: string[];
  records: Array<{
    id: string;
    componentId: string | null;
    workItemId: string | null;
    status: string;
    effectiveStatus: string;
    branchName: string | null;
    worktreePath: string | null;
    hostId: string;
    agentId: string | null;
    stale: boolean;
    dirty: boolean | null;
    pushed: boolean | null;
    updatedAt: string;
    writeScope: string[];
  }>;
}

export type NexusDashboardThreadDecision =
  | "continue"
  | "resume"
  | "review"
  | "archive"
  | "forget"
  | "rescue"
  | "merged"
  | "blocked";

export interface NexusDashboardThreadRecord {
  id: string;
  title: string;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
  hostId: string;
  agentId: string | null;
  state: string;
  decision: NexusDashboardThreadDecision;
  decisionLabel: string;
  decisionDetail: string;
  stale: boolean;
  dirty: boolean | null;
  pushed: boolean | null;
  cleanupSafe: boolean | null;
  cleanupBlockers: string[];
  assistantProvider: "codex" | null;
  assistantThreadId: string | null;
  updatedAt: string;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardThreadSummary {
  totalCount: number;
  activeCount: number;
  needsDecisionCount: number;
  archiveCandidateCount: number;
  forgetCandidateCount: number;
  source?: "cleanup" | "local";
  incomplete?: boolean;
  detail?: string | null;
  records: NexusDashboardThreadRecord[];
}

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

export function nexusDashboardThreadResolutionStorePath(
  projectRoot: string,
): string {
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

export interface NexusDashboardPluginRecord {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  state: "enabled" | "disabled" | "available";
  source: "configured" | "local";
  packageName: string | null;
  sourcePath: string | null;
  refreshCommand: string | null;
  detail: string;
  capabilityCount: number;
  projectedSkillCount: number;
  mcpServerCount: number;
  setupActionCount: number;
  dependencyProjectionCount: number;
  projectedSkills: string[];
  mcpServers: string[];
  setupHints: string[];
  dependencyHints: string[];
}

export interface NexusDashboardPluginSummary {
  totalCount: number;
  enabledCount: number;
  configuredCount: number;
  availableCount: number;
  capabilityCount: number;
  records: NexusDashboardPluginRecord[];
}

export type NexusDashboardTrackedWorkKind =
  | "blocked"
  | "ready"
  | "import-candidate"
  | "stale"
  | "excluded";

export interface NexusDashboardTrackedWorkItem {
  id: string;
  logicalItemId: string | null;
  componentId: string;
  componentName: string;
  title: string;
  status: string;
  kind: NexusDashboardTrackedWorkKind;
  kindLabel: string;
  detail: string;
  provider: string | null;
  trackerId: string | null;
  updatedAt: string | null;
  webUrl: string | null;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardTrackedWorkSummary {
  totalCount: number;
  blockedCount?: number;
  readyCount: number;
  importCandidateCount: number;
  staleCount: number;
  excludedCount: number;
  source?: "provider" | "local";
  incomplete?: boolean;
  detail?: string | null;
  records: NexusDashboardTrackedWorkItem[];
}

export interface NexusDashboardEvent {
  id: string;
  time: string;
  source: NexusDashboardEventSource;
  severity: NexusDashboardEventSeverity;
  title: string;
  body: string;
  relatedNodeIds: string[];
  href: string | null;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardWeaveLane {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface NexusDashboardWeaveNode {
  id: string;
  kind: NexusDashboardWeaveNodeKind;
  laneId: string;
  label: string;
  detail: string;
  status: string;
  timestamp: string | null;
  href: string | null;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardWeaveEdge {
  id: string;
  kind: NexusDashboardWeaveEdgeKind;
  from: string;
  to: string;
  label: string;
}

export interface NexusDashboardWeave {
  version: 1;
  generatedAt: string;
  lanes: NexusDashboardWeaveLane[];
  nodes: NexusDashboardWeaveNode[];
  edges: NexusDashboardWeaveEdge[];
}

export interface NexusDashboardSnapshot {
  version: 1;
  contract: NexusDashboardEmbeddingContract;
  partial?: boolean;
  loadedSections?: string[];
  generatedAt: string;
  projectRoot: string;
  project: NexusDashboardProjectSummary;
  summary: string;
  signals: NexusDashboardSignal[];
  components: NexusDashboardComponentSummary[];
  automation: NexusDashboardDataResult<NexusAutomationStatus>;
  eligibleWork: NexusDashboardDataResult<NexusEligibleWorkSummary>;
  targetReport: NexusDashboardDataResult<NexusAutomationTargetReport>;
  worktrees: NexusDashboardWorktreeSummary;
  threads: NexusDashboardThreadSummary;
  plugins: NexusDashboardPluginSummary;
  trackedWork: NexusDashboardTrackedWorkSummary;
  publication: NexusDashboardPublicationSummary[];
  authority: NexusDashboardAuthoritySummary | null;
  blockers: string[];
  events: NexusDashboardEvent[];
  weave: NexusDashboardWeave;
}

export type NexusDashboardWorkspaceSectionId =
  | "components"
  | "plugins"
  | "threads"
  | "tracked-work";

export interface NexusDashboardWorkspaceSectionPayload {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  section: NexusDashboardWorkspaceSectionId;
  patch: Partial<NexusDashboardSnapshot>;
}

export interface BuildNexusDashboardHostSnapshotOptions
  extends Pick<
    BuildNexusDashboardSnapshotOptions,
    | "homePath"
    | "env"
    | "credentialResolver"
    | "provider"
    | "providerFactory"
    | "providerOptions"
    | "eligibleWorkMode"
    | "gitRunner"
    | "now"
  > {
  projectRoot?: string;
  currentProjectRoot?: string | null;
}

export type NexusDashboardHostActionKind =
  | "workspace-error"
  | "approval"
  | "blocker"
  | "thread"
  | "dirty"
  | "ready-work";

export interface NexusDashboardHostWorkspaceRecord {
  id: string;
  name: string;
  root: string;
  registered: boolean;
  current: boolean;
  loading?: boolean;
  generatedAt: string | null;
  summary: string;
  tone: NexusDashboardSignalTone;
  componentCount: number;
  dirtyComponentCount: number;
  threadCount: number;
  needsDecisionCount: number;
  staleThreadCount: number;
  approvalCount: number;
  blockerCount: number;
  pluginCount: number;
  automationStatus: string | null;
  eligibleWorkCount: number | null;
  firstReadyWorkSelectionId: string | null;
  firstReadyWorkProviderAction: NexusDashboardProviderAction | null;
  actionUpdatedAt: Partial<Record<NexusDashboardHostActionKind, string | null>>;
  updatedAt: string | null;
  error: NexusDashboardDataError | null;
}

export interface NexusDashboardHostPrimaryAction {
  label: string;
  kind: "open-workspace" | "review" | "rescue" | "start-work";
  workspaceId: string;
  targetSelectionId: string | null;
}

export interface NexusDashboardHostActionItem {
  id: string;
  kind: NexusDashboardHostActionKind;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  reason: string;
  detail: string;
  state: string;
  tone: NexusDashboardSignalTone;
  updatedAt: string | null;
  primaryAction: NexusDashboardHostPrimaryAction;
  providerAction: NexusDashboardProviderAction | null;
}

export interface NexusDashboardHostSnapshot {
  version: 1;
  contract: NexusDashboardEmbeddingContract;
  generatedAt: string;
  hostId: string;
  homePath: string;
  homeError: NexusDashboardDataError | null;
  currentProjectRoot: string | null;
  selectedWorkspaceId: string | null;
  workspaceCount: number;
  needsAttentionCount: number;
  partial?: boolean;
  actionQueue: NexusDashboardHostActionItem[];
  workspaces: NexusDashboardHostWorkspaceRecord[];
}

export async function buildNexusDashboardSnapshot(
  options: BuildNexusDashboardSnapshotOptions,
): Promise<NexusDashboardSnapshot> {
  const projectRoot = path.resolve(nonEmptyString(options.projectRoot, "projectRoot"));
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const generatedAt = isoString(options.now?.() ?? new Date());
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const [automation, eligibleWork] = await Promise.all([
    captureAsync(() =>
      getNexusAutomationStatus({
        ...statusOptions(options, projectRoot, gitRunner),
      }),
    ),
    captureAsync(() =>
      getNexusEligibleWorkSummary({
        ...statusOptions(options, projectRoot, gitRunner),
      }),
    ),
  ]);
  const targetReport = capture(() =>
    buildNexusAutomationTargetReport({
      projectRoot,
      now: options.now?.(),
    }),
  );
  const worktreeCollection = capture(() =>
    listNexusWorktreeLeases({
      projectRoot,
      includeProjectMeta: true,
      now: options.now,
    }),
  );
  const componentSummaries = components.map((component) =>
    summarizeComponent(component, gitRunner),
  );
  const providerUrls = dashboardProviderUrls(projectConfig, componentSummaries);
  const cycles = readTargetCycles(projectRoot, projectConfig);
  const runs = readRuns(projectRoot, projectConfig);
  const threadResolutions = readNexusDashboardThreadResolutionStore(projectRoot);
  const worktrees = summarizeWorktrees(
    projectRoot,
    projectConfig,
    componentSummaries,
    worktreeCollection.value,
  );
  const plugins = summarizePlugins(projectRoot, projectConfig, components);
  const cleanupPlan = capture(() =>
    buildNexusCleanupPlan({
      projectRoot,
      includeProjectMeta: true,
      gitRunner,
      now: options.now,
    }),
  );
  const threads = summarizeThreads(
    worktrees,
    providerUrls,
    cleanupPlan.value?.candidates ?? [],
    runs,
    threadResolutions,
    {
      source: "cleanup",
      incomplete: !cleanupPlan.ok,
      detail: cleanupPlan.ok ? null : "Cleanup proof is unavailable.",
    },
  );
  const trackedWork = summarizeTrackedWork(eligibleWork.value, providerUrls);
  const publication = summarizePublication(automation.value);
  const authority = summarizeAuthority(
    automation.value?.authority ?? targetReport.value?.authority ?? null,
  );
  const blockers = dashboardBlockers({
    automation,
    eligibleWork,
    targetReport,
  });
  const events = buildDashboardEvents({
    generatedAt,
    automation: automation.value,
    eligibleWork: eligibleWork.value,
    targetReport: targetReport.value,
    worktrees,
    cycles,
    runs,
    blockers,
    providerUrls,
  });
  const weave = buildNexusDashboardWeave({
    generatedAt,
    projectConfig,
    projectRoot,
    components: componentSummaries,
    eligibleWork: eligibleWork.value,
    worktrees,
    cycles,
    runs,
    authority,
    blockers,
    providerUrls,
  });

  return {
    version: 1,
    contract: nexusDashboardEmbeddingContract({
      scope: "workspace",
      selectedWorkspaceId: projectConfig.id,
      selectedWorkspaceRoot: projectRoot,
      hostMode: false,
    }),
    generatedAt,
    projectRoot,
    project: projectSummary(projectRoot, projectConfig, componentSummaries),
    summary: dashboardSummary(componentSummaries, automation.value, eligibleWork.value, threads, blockers),
    signals: dashboardSignals(componentSummaries, automation.value, eligibleWork.value, threads, plugins, blockers),
    components: componentSummaries,
    automation,
    eligibleWork,
    targetReport,
    worktrees,
    threads,
    plugins,
    trackedWork,
    publication,
    authority,
    blockers,
    events,
    weave,
  };
}

export async function buildNexusDashboardWorkspaceShell(
  options: BuildNexusDashboardSnapshotOptions,
): Promise<NexusDashboardSnapshot> {
  const projectRoot = path.resolve(nonEmptyString(options.projectRoot, "projectRoot"));
  const generatedAt = isoString(options.now?.() ?? new Date());
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const componentSummaries = components.map(summarizeComponentShell);
  const project = projectSummary(projectRoot, projectConfig, componentSummaries);
  const plugins = summarizeConfiguredPlugins(projectConfig);

  return {
    version: 1,
    contract: nexusDashboardEmbeddingContract({
      scope: "workspace",
      selectedWorkspaceId: projectConfig.id,
      selectedWorkspaceRoot: projectRoot,
      hostMode: false,
    }),
    partial: true,
    loadedSections: ["shell"],
    generatedAt,
    projectRoot,
    project,
    summary: "Loading workspace signals.",
    signals: dashboardShellSignals(componentSummaries, plugins),
    components: componentSummaries,
    automation: pendingDashboardResult("Loading automation status."),
    eligibleWork: pendingDashboardResult("Loading tracked work."),
    targetReport: pendingDashboardResult("Loading target report."),
    worktrees: emptyWorktreeSummary(),
    threads: emptyThreadSummary(),
    plugins,
    trackedWork: emptyTrackedWorkSummary(),
    publication: [],
    authority: null,
    blockers: [],
    events: [],
    weave: workspaceShellWeave(generatedAt, project, componentSummaries),
  };
}

export async function buildNexusDashboardWorkspaceSection(
  options: BuildNexusDashboardSnapshotOptions,
  section: NexusDashboardWorkspaceSectionId,
): Promise<NexusDashboardWorkspaceSectionPayload> {
  const projectRoot = path.resolve(nonEmptyString(options.projectRoot, "projectRoot"));
  const generatedAt = isoString(options.now?.() ?? new Date());
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const componentShellSummaries = components.map(summarizeComponentShell);
  const providerUrls = dashboardProviderUrls(projectConfig, componentShellSummaries);
  const basePatch = {
    generatedAt,
    projectRoot,
    project: projectSummary(projectRoot, projectConfig, componentShellSummaries),
    loadedSections: [section],
  };

  if (section === "components") {
    const componentSummaries = components.map((component) =>
      summarizeComponent(component, gitRunner),
    );
    return {
      version: 1,
      generatedAt,
      projectRoot,
      section,
      patch: {
        ...basePatch,
        components: componentSummaries,
      },
    };
  }

  if (section === "plugins") {
    return {
      version: 1,
      generatedAt,
      projectRoot,
      section,
      patch: {
        ...basePatch,
        plugins: summarizePlugins(projectRoot, projectConfig, components),
      },
    };
  }

  if (section === "threads") {
    const componentSummaries = components.map((component) =>
      summarizeComponent(component, gitRunner),
    );
    const threadProviderUrls = dashboardProviderUrls(projectConfig, componentSummaries);
    const worktreeCollection = capture(() =>
      listNexusWorktreeLeases({
        projectRoot,
        includeProjectMeta: true,
        now: options.now,
      }),
    );
    const worktrees = summarizeWorktrees(
      projectRoot,
      projectConfig,
      componentSummaries,
      worktreeCollection.value,
    );
    const runs = readRuns(projectRoot, projectConfig);
    const threads = summarizeThreads(
      worktrees,
      threadProviderUrls,
      [],
      runs,
      readNexusDashboardThreadResolutionStore(projectRoot),
      {
        source: "local",
        incomplete: true,
        detail: "Showing active lease and chat records while cleanup proof loads.",
      },
    );
    return {
      version: 1,
      generatedAt,
      projectRoot,
      section,
      patch: {
        ...basePatch,
        components: componentSummaries,
        worktrees,
        threads,
        events: buildDashboardEvents({
          generatedAt,
          automation: null,
          eligibleWork: null,
          targetReport: null,
          worktrees,
          cycles: [],
          runs,
          blockers: [],
          providerUrls: threadProviderUrls,
        }),
        weave: buildNexusDashboardWeave({
          generatedAt,
          projectRoot,
          projectConfig,
          components: componentSummaries,
          eligibleWork: null,
          worktrees,
          cycles: [],
          runs,
          authority: null,
          blockers: [],
          providerUrls: threadProviderUrls,
        }),
      },
    };
  }

  const localTrackedWork = summarizeLocalTrackedWork({
    generatedAt,
    projectRoot,
  projectConfig,
  components,
  providerUrls,
});
  return {
    version: 1,
    generatedAt,
    projectRoot,
    section,
    patch: {
      ...basePatch,
      trackedWork: localTrackedWork,
      targetReport: pendingDashboardResult(
        "Target report is loading in the full workspace snapshot.",
      ),
      eligibleWork: pendingDashboardResult(
        "Provider work items are loading in the full workspace snapshot.",
      ),
      blockers: [],
    },
  };
}

export async function buildNexusDashboardHostSnapshot(
  options: BuildNexusDashboardHostSnapshotOptions = {},
): Promise<NexusDashboardHostSnapshot> {
  const generatedAt = isoString(options.now?.() ?? new Date());
  const homePath = path.resolve(options.homePath ?? defaultNexusHomePath());
  const home = capture(() =>
    loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
  );
  const currentProjectRoot =
    options.currentProjectRoot !== undefined
      ? options.currentProjectRoot
        ? path.resolve(
            nonEmptyString(options.currentProjectRoot, "currentProjectRoot"),
          )
        : null
      : options.projectRoot
        ? path.resolve(nonEmptyString(options.projectRoot, "projectRoot"))
        : null;
  const workspaceReferences = dashboardHostWorkspaceReferences(
    home.value,
    currentProjectRoot,
  );
  const workspaces = await Promise.all(
    workspaceReferences.map((workspace) =>
      dashboardHostWorkspaceRecord({
        ...options,
        homePath,
        reference: workspace.reference,
        registered: workspace.registered,
        current: workspace.current,
      }),
    ),
  );
  const actionQueue = buildNexusDashboardHostActionQueue(workspaces);
  const selectedWorkspace = selectedDashboardHostWorkspace(workspaces);

  return {
    version: 1,
    contract: nexusDashboardEmbeddingContract({
      scope: "host",
      selectedWorkspaceId: selectedWorkspace?.id ?? null,
      selectedWorkspaceRoot: selectedWorkspace?.root ?? null,
      hostMode: true,
    }),
    generatedAt,
    hostId: dashboardHostId(),
    homePath,
    homeError: home.error,
    currentProjectRoot,
    selectedWorkspaceId: selectedWorkspace?.id ?? null,
    workspaceCount: workspaces.length,
    needsAttentionCount: workspaces.filter((workspace) =>
      dashboardHostWorkspaceNeedsAttention(workspace),
    ).length,
    actionQueue,
    workspaces,
  };
}

export async function buildNexusDashboardHostProjectIndex(
  options: BuildNexusDashboardHostSnapshotOptions = {},
): Promise<NexusDashboardHostSnapshot> {
  const generatedAt = isoString(options.now?.() ?? new Date());
  const homePath = path.resolve(options.homePath ?? defaultNexusHomePath());
  const home = capture(() =>
    loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
  );
  const currentProjectRoot =
    options.currentProjectRoot !== undefined
      ? options.currentProjectRoot
        ? path.resolve(
            nonEmptyString(options.currentProjectRoot, "currentProjectRoot"),
          )
        : null
      : options.projectRoot
        ? path.resolve(nonEmptyString(options.projectRoot, "projectRoot"))
        : null;
  const workspaceReferences = dashboardHostWorkspaceReferences(
    home.value,
    currentProjectRoot,
  );
  const workspaces = workspaceReferences.map((workspace) =>
    dashboardHostWorkspaceShellRecord({
      generatedAt,
      reference: workspace.reference,
      registered: workspace.registered,
      current: workspace.current,
    }),
  );
  const selectedWorkspace = selectedDashboardHostWorkspace(workspaces);

  return {
    version: 1,
    contract: nexusDashboardEmbeddingContract({
      scope: "host",
      selectedWorkspaceId: selectedWorkspace?.id ?? null,
      selectedWorkspaceRoot: selectedWorkspace?.root ?? null,
      hostMode: true,
    }),
    generatedAt,
    hostId: dashboardHostId(),
    homePath,
    homeError: home.error,
    currentProjectRoot,
    selectedWorkspaceId: selectedWorkspace?.id ?? null,
    workspaceCount: workspaces.length,
    needsAttentionCount: workspaces.filter((workspace) =>
      dashboardHostWorkspaceNeedsAttention(workspace),
    ).length,
    partial: true,
    actionQueue: [],
    workspaces,
  };
}

function dashboardHostId(): string {
  return process.env.DEV_NEXUS_HOST_ID?.trim() || os.hostname() || "local";
}

export function nexusDashboardHostWorkspaceReferenceMatches(
  options: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string,
): Array<{
  reference: NexusProjectReference;
  registered: boolean;
  current: boolean;
}> {
  const homePath = path.resolve(options.homePath ?? defaultNexusHomePath());
  const home = capture(() =>
    loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
  );
  const currentProjectRoot =
    options.currentProjectRoot !== undefined
      ? options.currentProjectRoot
        ? path.resolve(
            nonEmptyString(options.currentProjectRoot, "currentProjectRoot"),
          )
        : null
      : options.projectRoot
        ? path.resolve(nonEmptyString(options.projectRoot, "projectRoot"))
        : null;
  return dashboardHostWorkspaceReferences(home.value, currentProjectRoot)
    .filter((workspace) => workspace.reference.id === workspaceId);
}

export function nexusDashboardEmbeddingContract(options: {
  scope: NexusDashboardContractScope;
  selectedWorkspaceId?: string | null;
  selectedWorkspaceRoot?: string | null;
  hostMode?: boolean;
  diagnosticsDefaultPayload?: boolean;
}): NexusDashboardEmbeddingContract {
  const hostMode = options.hostMode ?? options.scope === "host";
  const diagnosticsDefaultPayload =
    options.diagnosticsDefaultPayload ?? options.scope === "diagnostics";
  const dashboardEndpoint = hostMode
    ? "/api/dashboard?workspace=:workspaceId"
    : "/api/dashboard";
  return {
    version: 1,
    scope: options.scope,
    ownership: {
      devNexus: [
        "workspace facts",
        "provider action links",
        "plugin projections",
        "thread action hints",
      ],
      hostApp: [
        "tenant selection",
        "auth shell",
        "global navigation",
        "persistence policy",
      ],
    },
    selection: {
      hostMode,
      workspaceQueryParam: "workspace",
      selectedWorkspaceId: options.selectedWorkspaceId ?? null,
      selectedWorkspaceRoot: options.selectedWorkspaceRoot ?? null,
    },
    surfaces: {
      hostSummary: {
        field: "workspaces",
        endpoint: "/api/host",
        owner: "dev-nexus",
        defaultPayload: options.scope === "host",
        action: "read",
      },
      workspaceSummary: {
        field: options.scope === "host" ? "workspaces[]" : "summary",
        endpoint: options.scope === "host" ? "/api/host" : dashboardEndpoint,
        owner: "dev-nexus",
        defaultPayload: true,
        action: "read",
      },
      selectedWorkspaceSnapshot: {
        field: "project",
        endpoint: dashboardEndpoint,
        owner: "dev-nexus",
        defaultPayload: options.scope !== "host",
        action: "read",
      },
      actionQueue: {
        field: "actionQueue",
        endpoint: "/api/host",
        owner: "dev-nexus",
        defaultPayload: options.scope === "host",
        action: "read",
      },
      providerActions: {
        field: options.scope === "host"
          ? "actionQueue[].providerAction"
          : "actions",
        endpoint: options.scope === "host" ? "/api/host" : dashboardEndpoint,
        owner: "provider",
        defaultPayload: true,
        action: "open-provider",
      },
      plugins: {
        field: options.scope === "host" ? "workspaces[].pluginCount" : "plugins",
        endpoint: options.scope === "host" ? "/api/host" : dashboardEndpoint,
        owner: "dev-nexus",
        defaultPayload: true,
        action: "read",
      },
      threadActions: {
        field: options.scope === "host"
          ? "workspaces[].needsDecisionCount"
          : "threads.records",
        endpoint: options.scope === "host" ? "/api/host" : dashboardEndpoint,
        owner: "assistant-provider",
        defaultPayload: true,
        action: "start-chat",
      },
      trackedWork: {
        field: options.scope === "host"
          ? "workspaces[].eligibleWorkCount"
          : "trackedWork",
        endpoint: options.scope === "host" ? "/api/host" : dashboardEndpoint,
        owner: "dev-nexus",
        defaultPayload: true,
        action: "read",
      },
    },
    diagnostics: {
      defaultPayload: diagnosticsDefaultPayload,
      endpoint: "/api/diagnostics",
    },
    routes: {
      host: "/api/host",
      dashboard: dashboardEndpoint,
      diagnostics: "/api/diagnostics",
      projects: "/api/projects",
      weave: hostMode
        ? "/api/weave?workspace=:workspaceId"
        : "/api/weave",
      events: hostMode
        ? "/api/events?workspace=:workspaceId"
        : "/api/events",
      threadAction: hostMode
        ? "/api/codex/thread?workspace=:workspaceId"
        : "/api/codex/thread",
      threadResolution: hostMode
        ? "/api/dashboard/thread-action?workspace=:workspaceId"
        : "/api/dashboard/thread-action",
    },
  };
}

function selectedDashboardHostWorkspace(
  workspaces: NexusDashboardHostWorkspaceRecord[],
): NexusDashboardHostWorkspaceRecord | null {
  return workspaces.find((workspace) => workspace.current) ?? null;
}

function dashboardHostWorkspaceReferences(
  homeConfig: NexusHomeConfigBase | null,
  currentProjectRoot: string | null,
): Array<{
  reference: NexusProjectReference;
  registered: boolean;
  current: boolean;
}> {
  const references = (homeConfig?.projects ?? []).map((reference) => ({
    reference: {
      ...reference,
      projectRoot: path.resolve(reference.projectRoot),
    },
    registered: true,
    current: Boolean(currentProjectRoot && samePath(reference.projectRoot, currentProjectRoot)),
  }));
  if (
    currentProjectRoot &&
    !references.some((workspace) =>
      samePath(workspace.reference.projectRoot, currentProjectRoot),
    )
  ) {
    const currentConfig = capture(() => loadProjectConfig(currentProjectRoot));
    references.unshift({
      reference: {
        id: currentConfig.value?.id ?? path.basename(currentProjectRoot),
        name: currentConfig.value?.name ?? path.basename(currentProjectRoot),
        projectRoot: currentProjectRoot,
      },
      registered: false,
      current: true,
    });
  }

  return references;
}

async function dashboardHostWorkspaceRecord(options: {
  reference: NexusProjectReference;
  registered: boolean;
  current: boolean;
} & BuildNexusDashboardHostSnapshotOptions): Promise<NexusDashboardHostWorkspaceRecord> {
  const root = path.resolve(options.reference.projectRoot);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const generatedAt = isoString(options.now?.() ?? new Date());
  const localFacts = capture(() => {
    const projectConfig = loadProjectConfig(root);
    const components = resolveProjectComponents(root, projectConfig);
    const componentSummaries = components.map((component) =>
      summarizeComponent(component, gitRunner),
    );
    const providerUrls = dashboardProviderUrls(projectConfig, componentSummaries);
    const threadResolutions = readNexusDashboardThreadResolutionStore(root);
    const worktreeCollection = capture(() =>
      listNexusWorktreeLeases({
        projectRoot: root,
        includeProjectMeta: true,
        now: options.now,
      }),
    );
    const runs = readRuns(root, projectConfig);
    const worktrees = summarizeWorktrees(
      root,
      projectConfig,
      componentSummaries,
      worktreeCollection.value,
    );
    const threads = summarizeThreads(
      worktrees,
      providerUrls,
      [],
      runs,
      threadResolutions,
    );
    const plugins = summarizePlugins(root, projectConfig, components);
    const dirtyComponentCount = componentSummaries.filter((component) =>
      Boolean(component.git?.dirty),
    ).length;
    return {
      projectConfig,
      componentSummaries,
      threads,
      plugins,
      blockerCount: 0,
      warningCount: worktrees.warnings.length,
      dirtyComponentCount,
    };
  });

  if (!localFacts.value) {
    return {
      id: options.reference.id,
      name: options.reference.name,
      root,
      registered: options.registered,
      current: options.current,
      generatedAt: null,
      summary: localFacts.error?.message ?? "Workspace snapshot is unavailable.",
      tone: "danger",
      componentCount: 0,
      dirtyComponentCount: 0,
      threadCount: 0,
      needsDecisionCount: 0,
      staleThreadCount: 0,
      approvalCount: 0,
      blockerCount: 0,
      pluginCount: 0,
      automationStatus: null,
      eligibleWorkCount: null,
      firstReadyWorkSelectionId: null,
      firstReadyWorkProviderAction: null,
      actionUpdatedAt: {
        "workspace-error": generatedAt,
      },
      updatedAt: null,
      error: localFacts.error,
    };
  }

  const value = localFacts.value;
  const [automation, eligibleWork] = await Promise.all([
    captureAsync(() =>
      getNexusAutomationStatus({
        ...statusOptions({ ...options, projectRoot: root }, root, gitRunner),
      }),
    ),
    captureAsync(() =>
      getNexusEligibleWorkSummary({
        ...statusOptions({ ...options, projectRoot: root }, root, gitRunner),
      }),
    ),
  ]);
  const authority = summarizeAuthority(automation.value?.authority ?? null);
  const approvalCount = authority
    ? authority.blockedActionCount +
      authority.waitingActionCount +
      authority.fallbackActionCount
    : 0;
  const eligibleBlockerCount = uniqueNonEmptyStrings([
    ...(automation.value?.eligibleWorkBlockers ?? []),
    ...(eligibleWork.value?.blockers ?? []),
  ]).length;
  const blockerCount =
    eligibleBlockerCount > 0 || automation.value?.status === "blocked"
      ? Math.max(eligibleBlockerCount, 1)
      : 0;
  const eligibleWorkCount = eligibleWork.value?.eligibleWorkItemCount ?? null;
  const actionUpdatedAt = dashboardHostWorkspaceActionUpdatedAt({
    threads: value.threads,
    automation: automation.value,
    eligibleWork: eligibleWork.value,
    approvalCount,
    blockerCount,
    eligibleWorkCount,
  });
  const updatedAt = latestIsoString(Object.values(actionUpdatedAt));
  const project = projectSummary(
    root,
    value.projectConfig,
    value.componentSummaries,
  );
  return {
    id: project.id,
    name: project.name,
    root: project.root,
    registered: options.registered,
    current: options.current,
    generatedAt,
    summary: dashboardHostWorkspaceSummary({
      ...value,
      approvalCount,
      blockerCount,
      eligibleWorkCount,
    }),
    tone: dashboardHostWorkspaceTone({
      automationStatus: automation.value?.status ?? null,
      blockerCount,
      dirtyComponentCount: value.dirtyComponentCount,
      needsDecisionCount: value.threads.needsDecisionCount,
      threadCount: value.threads.totalCount,
      eligibleWorkCount,
      hasError: false,
    }),
    componentCount: value.componentSummaries.length,
    dirtyComponentCount: value.dirtyComponentCount,
    threadCount: value.threads.totalCount,
    needsDecisionCount: value.threads.needsDecisionCount,
    staleThreadCount: value.threads.archiveCandidateCount + value.threads.forgetCandidateCount,
    approvalCount,
    blockerCount,
    pluginCount: value.plugins.enabledCount,
    automationStatus: automation.value?.status ?? null,
    eligibleWorkCount,
    firstReadyWorkSelectionId: firstReadyWorkSelectionId(eligibleWork.value),
    firstReadyWorkProviderAction: firstReadyWorkProviderAction(eligibleWork.value, dashboardProviderUrls(value.projectConfig, value.componentSummaries)),
    actionUpdatedAt,
    updatedAt,
    error: null,
  };
}

function dashboardHostWorkspaceShellRecord(options: {
  generatedAt: string;
  reference: NexusProjectReference;
  registered: boolean;
  current: boolean;
}): NexusDashboardHostWorkspaceRecord {
  const root = path.resolve(options.reference.projectRoot);
  const localFacts = capture(() => {
    const projectConfig = loadProjectConfig(root);
    const components = resolveProjectComponents(root, projectConfig);
    return {
      projectConfig,
      components,
    };
  });

  if (!localFacts.value) {
    return {
      id: options.reference.id,
      name: options.reference.name,
      root,
      registered: options.registered,
      current: options.current,
      loading: false,
      generatedAt: null,
      summary: localFacts.error?.message ?? "Workspace project record is unavailable.",
      tone: "danger",
      componentCount: 0,
      dirtyComponentCount: 0,
      threadCount: 0,
      needsDecisionCount: 0,
      staleThreadCount: 0,
      approvalCount: 0,
      blockerCount: 0,
      pluginCount: 0,
      automationStatus: null,
      eligibleWorkCount: null,
      firstReadyWorkSelectionId: null,
      firstReadyWorkProviderAction: null,
      actionUpdatedAt: {
        "workspace-error": options.generatedAt,
      },
      updatedAt: null,
      error: localFacts.error,
    };
  }

  return {
    id: localFacts.value.projectConfig.id,
    name: localFacts.value.projectConfig.name,
    root,
    registered: options.registered,
    current: options.current,
    loading: true,
    generatedAt: options.generatedAt,
    summary: "Loading workspace signals.",
    tone: "neutral",
    componentCount: localFacts.value.components.length,
    dirtyComponentCount: 0,
    threadCount: 0,
    needsDecisionCount: 0,
    staleThreadCount: 0,
    approvalCount: 0,
    blockerCount: 0,
    pluginCount: (localFacts.value.projectConfig.plugins ?? []).filter(
      (plugin) => plugin.enabled !== false,
    ).length,
    automationStatus: null,
    eligibleWorkCount: null,
    firstReadyWorkSelectionId: null,
    firstReadyWorkProviderAction: null,
    actionUpdatedAt: {},
    updatedAt: null,
    error: null,
  };
}

function dashboardHostWorkspaceActionUpdatedAt(options: {
  threads: NexusDashboardThreadSummary;
  automation: NexusAutomationStatus | null;
  eligibleWork: NexusEligibleWorkSummary | null;
  approvalCount: number;
  blockerCount: number;
  eligibleWorkCount: number | null;
}): Partial<Record<NexusDashboardHostActionKind, string | null>> {
  const automationAt = latestAutomationEventAt(options.automation);
  return {
    approval: options.approvalCount > 0 ? automationAt : null,
    blocker: options.blockerCount > 0 || options.automation?.status === "blocked"
      ? automationAt
      : null,
    thread: options.threads.needsDecisionCount > 0
      ? latestIsoString(options.threads.records.map((thread) => thread.updatedAt))
      : null,
    "ready-work": options.eligibleWorkCount && options.eligibleWorkCount > 0
      ? latestEligibleWorkEventAt(options.eligibleWork)
      : null,
    dirty: null,
    "workspace-error": null,
  };
}

function latestAutomationEventAt(status: NexusAutomationStatus | null): string | null {
  if (!status) {
    return null;
  }
  const lastCycle = status.targetCycles?.lastCycle ?? null;
  return latestIsoString([
    status.ledger?.updatedAt,
    lastCycle?.finishedAt,
    lastCycle?.startedAt,
  ]);
}

function latestEligibleWorkEventAt(summary: NexusEligibleWorkSummary | null): string | null {
  if (!summary) {
    return null;
  }
  return latestIsoString(
    summary.components.flatMap((component) => [
      ...component.workItems.map((item) => item.updatedAt),
      ...component.importCandidateWorkItems.map((item) => item.updatedAt),
      ...component.staleInProgressWorkItems.map((item) => item.updatedAt),
      ...component.excludedWorkItems.map((item) => item.updatedAt),
    ]),
  );
}

function firstReadyWorkSelectionId(
  eligibleWork: NexusEligibleWorkSummary | null,
): string | null {
  const firstItem = eligibleWork?.components
    .flatMap((component) => component.workItems)
    .find((item) => item.selectable !== false) ??
    eligibleWork?.components.flatMap((component) => component.workItems)[0];
  return firstItem
    ? `tracked-work:${firstItem.componentId}:${firstItem.id}`
    : null;
}

function firstReadyWorkProviderAction(
  eligibleWork: NexusEligibleWorkSummary | null,
  providerUrls: NexusDashboardProviderUrls,
): NexusDashboardProviderAction | null {
  const firstItem = eligibleWork?.components
    .flatMap((component) => component.workItems)
    .find((item) => item.webUrl || /\b#\d+\b/u.test(`${item.id} ${item.title}`));
  if (!firstItem) {
    return null;
  }
  return uniqueProviderActions([
    ...providerActionsForHref(firstItem.webUrl),
    ...providerActionsFromText(
      `${firstItem.id} ${firstItem.title}`,
      providerUrls,
      firstItem.componentId,
    ),
  ])[0] ?? null;
}

function dashboardHostWorkspaceSummary(value: {
  componentSummaries: NexusDashboardComponentSummary[];
  threads: NexusDashboardThreadSummary;
  plugins: NexusDashboardPluginSummary;
  blockerCount: number;
  warningCount: number;
  dirtyComponentCount: number;
  approvalCount: number;
  eligibleWorkCount: number | null;
}): string {
  const review = value.threads.needsDecisionCount > 0
    ? `${value.threads.needsDecisionCount} ${plural(value.threads.needsDecisionCount, "action", "actions")} needed`
    : "no review needed";
  const dirty = value.dirtyComponentCount > 0
    ? `${value.dirtyComponentCount} dirty`
    : "clean";
  const warnings = value.warningCount > 0
    ? `${value.warningCount} ${plural(value.warningCount, "warning", "warnings")}`
    : "no warnings";
  const approvals = value.approvalCount > 0
    ? `${value.approvalCount} ${plural(value.approvalCount, "approval", "approvals")}`
    : "no approvals";
  const blockers = value.blockerCount > 0
    ? `${value.blockerCount} ${plural(value.blockerCount, "blocker", "blockers")}`
    : "no blockers";
  const ready = value.eligibleWorkCount && value.eligibleWorkCount > 0
    ? `${value.eligibleWorkCount} ready`
    : "no ready work";
  return `${value.componentSummaries.length} ${plural(value.componentSummaries.length, "component", "components")}, ${value.threads.totalCount} active ${plural(value.threads.totalCount, "thread", "threads")}, ${review}, ${approvals}, ${blockers}, ${dirty}, ${ready}, ${warnings}, ${value.plugins.enabledCount} ${plural(value.plugins.enabledCount, "plugin", "plugins")}`;
}

function dashboardHostWorkspaceTone(options: {
  automationStatus: string | null;
  blockerCount: number;
  dirtyComponentCount: number;
  needsDecisionCount: number;
  threadCount: number;
  eligibleWorkCount: number | null;
  hasError: boolean;
}): NexusDashboardSignalTone {
  if (
    options.blockerCount > 0 ||
    options.automationStatus === "blocked" ||
    options.hasError
  ) {
    return "danger";
  }
  if (options.needsDecisionCount > 0 || options.dirtyComponentCount > 0) {
    return "warn";
  }
  if (
    options.threadCount > 0 ||
    options.automationStatus === "ready" ||
    (options.eligibleWorkCount ?? 0) > 0
  ) {
    return "active";
  }
  return "good";
}

function dashboardHostWorkspaceNeedsAttention(
  workspace: NexusDashboardHostWorkspaceRecord,
): boolean {
  return workspace.tone === "danger" || workspace.tone === "warn";
}

export function buildNexusDashboardHostActionQueue(
  workspaces: NexusDashboardHostWorkspaceRecord[],
): NexusDashboardHostActionItem[] {
  return workspaces
    .flatMap((workspace) => dashboardHostActionItems(workspace))
    .sort(compareDashboardHostActions);
}

function dashboardHostActionItems(
  workspace: NexusDashboardHostWorkspaceRecord,
): NexusDashboardHostActionItem[] {
  const items: NexusDashboardHostActionItem[] = [];
  const add = (
    kind: NexusDashboardHostActionKind,
    reason: string,
    detail: string,
    state: string,
    tone: NexusDashboardSignalTone,
    label: string,
  ): void => {
    items.push({
      id: `host-action:${workspace.id}:${kind}`,
      kind,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRoot: workspace.root,
      reason,
      detail,
      state,
      tone,
      updatedAt: hostActionUpdatedAt(workspace, kind),
      primaryAction: {
        label,
        kind: kind === "dirty"
          ? "rescue"
          : kind === "ready-work"
            ? "start-work"
            : "review",
        workspaceId: workspace.id,
        targetSelectionId: kind === "ready-work"
          ? workspace.firstReadyWorkSelectionId
          : null,
      },
      providerAction: kind === "ready-work"
        ? workspace.firstReadyWorkProviderAction
        : null,
    });
  };

  if (workspace.error) {
    add(
      "workspace-error",
      "Workspace unavailable",
      workspace.summary,
      "unavailable",
      "danger",
      "Review workspace",
    );
    return items;
  }
  if (workspace.approvalCount > 0) {
    add(
      "approval",
      `${workspace.approvalCount} ${plural(workspace.approvalCount, "approval", "approvals")} needed`,
      "Provider automation needs approval before it can continue.",
      "approval needed",
      "warn",
      "Review approval",
    );
  }
  if (workspace.blockerCount > 0 || workspace.automationStatus === "blocked") {
    add(
      "blocker",
      `${Math.max(workspace.blockerCount, 1)} ${plural(Math.max(workspace.blockerCount, 1), "blocker", "blockers")}`,
      "Automation or tracked work is blocked.",
      "blocked",
      "danger",
      "Review blocker",
    );
  }
  if (workspace.needsDecisionCount > 0) {
    add(
      "thread",
      `${workspace.needsDecisionCount} ${plural(workspace.needsDecisionCount, "thread", "threads")} ${workspace.needsDecisionCount === 1 ? "needs" : "need"} action`,
      "Unfinished work needs continue, archive, forget, or rescue.",
      workspace.staleThreadCount > 0 ? "stale threads" : "review needed",
      "warn",
      "Review threads",
    );
  }
  if (workspace.eligibleWorkCount && workspace.eligibleWorkCount > 0) {
    add(
      "ready-work",
      `${workspace.eligibleWorkCount} ready ${plural(workspace.eligibleWorkCount, "item", "items")}`,
      "Tracked work is ready for automation or a human to pick up.",
      "ready",
      "active",
      "Review work",
    );
  }
  if (workspace.dirtyComponentCount > 0) {
    add(
      "dirty",
      `${workspace.dirtyComponentCount} dirty ${plural(workspace.dirtyComponentCount, "component", "components")}`,
      "Local component checkouts have uncommitted changes.",
      "dirty",
      "warn",
      "Rescue changes",
    );
  }

  return items;
}

function hostActionUpdatedAt(
  workspace: NexusDashboardHostWorkspaceRecord,
  kind: NexusDashboardHostActionKind,
): string | null {
  return workspace.actionUpdatedAt[kind] ?? null;
}

function compareDashboardHostActions(
  left: NexusDashboardHostActionItem,
  right: NexusDashboardHostActionItem,
): number {
  return dashboardHostActionScore(right) - dashboardHostActionScore(left) ||
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
    left.workspaceName.localeCompare(right.workspaceName) ||
    left.kind.localeCompare(right.kind);
}

function dashboardHostActionScore(item: NexusDashboardHostActionItem): number {
  switch (item.kind) {
    case "workspace-error":
      return 100;
    case "blocker":
      return 90;
    case "approval":
      return 80;
    case "ready-work":
      return 70;
    case "thread":
      return 60;
    case "dirty":
      return 50;
  }
}

export function buildNexusDashboardWeave(options: {
  generatedAt: string;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: NexusDashboardComponentSummary[];
  eligibleWork: NexusEligibleWorkSummary | null;
  worktrees: NexusDashboardWorktreeSummary;
  cycles: NexusAutomationTargetCycleRecord[];
  runs: NexusAutomationRunRecord[];
  authority: NexusDashboardAuthoritySummary | null;
  blockers: string[];
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardWeave {
  const lanes: NexusDashboardWeaveLane[] = [
    { id: "project", label: "Project", nodeIds: [] },
    { id: "components", label: "Components", nodeIds: [] },
    { id: "work", label: "Work", nodeIds: [] },
    { id: "branches", label: "Branches", nodeIds: [] },
    { id: "cycles", label: "Cycles", nodeIds: [] },
    { id: "authority", label: "Approvals", nodeIds: [] },
  ];
  const nodes: NexusDashboardWeaveNode[] = [];
  const edges: NexusDashboardWeaveEdge[] = [];
  const addNode = (node: NexusDashboardWeaveNode): void => {
    if (nodes.some((candidate) => candidate.id === node.id)) {
      return;
    }
    nodes.push(node);
    const lane = lanes.find((candidate) => candidate.id === node.laneId);
    lane?.nodeIds.push(node.id);
  };
  const addEdge = (edge: NexusDashboardWeaveEdge): void => {
    if (!edges.some((candidate) => candidate.id === edge.id)) {
      edges.push(edge);
    }
  };
  const projectNodeId = "project";

  addNode({
    id: projectNodeId,
    kind: "project",
    laneId: "project",
    label: options.projectConfig.name,
    detail: options.projectRoot,
    status: "active",
    timestamp: null,
    href: options.providerUrls.project,
    actions: providerActionsForHref(options.providerUrls.project, "Open repository"),
  });

  for (const component of options.components) {
    const componentNodeId = nodeId("component", component.id);
    const repositoryUrl = componentProviderUrl(options.providerUrls, component.id);
    addNode({
      id: componentNodeId,
      kind: "component",
      laneId: "components",
      label: component.name,
      detail: `${component.role} component`,
      status: component.sourceRootExists ? "ready" : "missing",
      timestamp: null,
      href: repositoryUrl,
      actions: providerActionsForHref(repositoryUrl, "Open repository"),
    });
    addEdge({
      id: edgeId(projectNodeId, componentNodeId, "contains"),
      kind: "contains",
      from: projectNodeId,
      to: componentNodeId,
      label: "contains",
    });

    if (component.defaultTrackerId) {
      const trackerNodeId = nodeId("tracker", `${component.id}-${component.defaultTrackerId}`);
      addNode({
        id: trackerNodeId,
        kind: "tracker",
        laneId: "work",
        label: component.defaultTrackerId,
        detail: component.trackerProviders.join(", ") || "tracker",
        status: "configured",
        timestamp: null,
        href: null,
        actions: [],
      });
      addEdge({
        id: edgeId(componentNodeId, trackerNodeId, "tracks"),
        kind: "tracks",
        from: componentNodeId,
        to: trackerNodeId,
        label: "tracks",
      });
    }

    if (component.git?.headCommit) {
      const branchNodeId = nodeId("branch", `${component.id}-${component.git.branch ?? "detached"}`);
      const commitNodeId = nodeId("commit", `${component.id}-${component.git.headCommit.slice(0, 12)}`);
      addNode({
        id: branchNodeId,
        kind: "branch",
        laneId: "branches",
        label: component.git.branch ?? "detached",
        detail: component.git.upstream ?? "no upstream",
        status: component.git.dirty ? "dirty" : "clean",
        timestamp: null,
        href: null,
        actions: providerActionsFromText(component.git.branch ?? "", options.providerUrls, component.id),
      });
      addNode({
        id: commitNodeId,
        kind: "commit",
        laneId: "branches",
        label: component.git.headCommit.slice(0, 12),
        detail: component.sourceRoot,
        status: "head",
        timestamp: null,
        href: null,
        actions: [],
      });
      addEdge({
        id: edgeId(componentNodeId, branchNodeId, "owns"),
        kind: "owns",
        from: componentNodeId,
        to: branchNodeId,
        label: "branch",
      });
      addEdge({
        id: edgeId(branchNodeId, commitNodeId, "points-to"),
        kind: "points-to",
        from: branchNodeId,
        to: commitNodeId,
        label: "HEAD",
      });
    }
  }

  for (const item of eligibleWorkItems(options.eligibleWork)) {
    const workItemNodeId = nodeId("work-item", `${item.componentId}-${item.id}`);
    const actions = uniqueProviderActions([
      ...providerActionsForHref(item.webUrl),
      ...providerActionsFromText(`${item.id} ${item.title}`, options.providerUrls, item.componentId),
    ]);
    addNode({
      id: workItemNodeId,
      kind: "work-item",
      laneId: "work",
      label: item.title,
      detail: item.id,
      status: item.status,
      timestamp: item.updatedAt,
      href: item.webUrl ?? firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(nodeId("component", item.componentId), workItemNodeId, "owns"),
      kind: "owns",
      from: nodeId("component", item.componentId),
      to: workItemNodeId,
      label: "owns",
    });
  }

  for (const worktree of options.worktrees.records) {
    const worktreeNodeId = nodeId("worktree", worktree.id);
    const actions = providerActionsFromText(
      `${worktree.workItemId ?? ""} ${worktree.branchName ?? worktree.id}`,
      options.providerUrls,
      worktree.componentId,
    );
    addNode({
      id: worktreeNodeId,
      kind: "worktree",
      laneId: "branches",
      label: worktree.branchName ?? worktree.id,
      detail: `${worktree.effectiveStatus} on ${worktree.hostId}`,
      status: worktree.effectiveStatus,
      timestamp: worktree.updatedAt,
      href: firstActionHref(actions),
      actions,
    });
    if (worktree.componentId) {
      addEdge({
        id: edgeId(nodeId("component", worktree.componentId), worktreeNodeId, "checks-out"),
        kind: "checks-out",
        from: nodeId("component", worktree.componentId),
        to: worktreeNodeId,
        label: "worktree",
      });
    }
    if (worktree.workItemId && worktree.componentId) {
      addEdge({
        id: edgeId(nodeId("work-item", `${worktree.componentId}-${worktree.workItemId}`), worktreeNodeId, "selected"),
        kind: "selected",
        from: nodeId("work-item", `${worktree.componentId}-${worktree.workItemId}`),
        to: worktreeNodeId,
        label: "selected",
      });
    }
  }

  for (const cycle of options.cycles.slice(-8)) {
    const cycleNodeId = nodeId("target-cycle", cycle.id);
    const actions = providerActionsFromText(cycleActionText(cycle), options.providerUrls);
    addNode({
      id: cycleNodeId,
      kind: "target-cycle",
      laneId: "cycles",
      label: cycle.id,
      detail: cycle.summary ?? cycle.status,
      status: cycle.status,
      timestamp: cycle.finishedAt ?? cycle.startedAt,
      href: firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(projectNodeId, cycleNodeId, "records"),
      kind: "records",
      from: projectNodeId,
      to: cycleNodeId,
      label: "cycle",
    });
    for (const item of cycle.workItems.slice(0, 8)) {
      const workItemNodeId = nodeId("work-item", `${item.componentId}-${item.id}`);
      const cycleStatus = item.cycleStatus ?? "referenced";
      const actions = providerActionsFromText(
        `${item.id} ${item.title ?? ""}`,
        options.providerUrls,
        item.componentId,
      );
      addNode({
        id: workItemNodeId,
        kind: "work-item",
        laneId: "work",
        label: item.title ?? item.id,
        detail: item.id,
        status: cycleStatus,
        timestamp: cycle.finishedAt ?? cycle.startedAt,
        href: firstActionHref(actions),
        actions,
      });
      addEdge({
        id: edgeId(cycleNodeId, workItemNodeId, "selected"),
        kind: "selected",
        from: cycleNodeId,
        to: workItemNodeId,
        label: cycleStatus,
      });
    }
  }

  for (const run of options.runs.slice(-6)) {
    const runNodeId = nodeId("run", run.id);
    const actions = providerActionsFromText(
      `${run.summary ?? ""} ${run.error ?? ""} ${run.workItemId ?? ""} ${run.branchName ?? ""}`,
      options.providerUrls,
      run.componentId,
    );
    addNode({
      id: runNodeId,
      kind: "run",
      laneId: "cycles",
      label: run.id,
      detail: run.summary ?? run.status,
      status: run.status,
      timestamp: run.finishedAt ?? run.startedAt,
      href: firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(projectNodeId, runNodeId, "records"),
      kind: "records",
      from: projectNodeId,
      to: runNodeId,
      label: "run",
    });
  }

  if (options.authority) {
    const authorityNodeId = "authority";
    addNode({
      id: authorityNodeId,
      kind: "authority",
      laneId: "authority",
      label: "Approval",
      detail: authorityDashboardSummary(options.authority),
      status: options.authority.blockedActionCount > 0 ? "blocked" : "ready",
      timestamp: null,
      href: null,
      actions: authorityProviderActions(options.authority, options.providerUrls),
    });
    addEdge({
      id: edgeId(projectNodeId, authorityNodeId, "published-by"),
      kind: "published-by",
      from: projectNodeId,
      to: authorityNodeId,
      label: "policy",
    });
  }

  options.blockers.slice(0, 8).forEach((blocker, index) => {
    const blockerNodeId = nodeId("blocker", String(index));
    const actions = providerActionsFromText(blocker, options.providerUrls);
    addNode({
      id: blockerNodeId,
      kind: "blocker",
      laneId: "authority",
      label: "Blocker",
      detail: blocker,
      status: "blocked",
      timestamp: null,
      href: firstActionHref(actions),
      actions,
    });
    addEdge({
      id: edgeId(projectNodeId, blockerNodeId, "blocked-by"),
      kind: "blocked-by",
      from: projectNodeId,
      to: blockerNodeId,
      label: "blocked",
    });
  });

  return {
    version: 1,
    generatedAt: options.generatedAt,
    lanes,
    nodes,
    edges,
  };
}

function authorityDashboardSummary(authority: NexusDashboardAuthoritySummary): string {
  const componentCount = authority.components.length;
  const blocked = authority.blockedActionCount;
  const fallbacks = authority.fallbackActionCount;
  if (blocked > 0) {
    return `${blocked} provider ${plural(blocked, "action", "actions")} need approval. Review or open the provider item manually.`;
  }
  if (fallbacks > 0) {
    return `${fallbacks} provider ${plural(fallbacks, "action", "actions")} need an approval path.`;
  }
  return `Publication permissions are ready for ${componentCount} ${plural(componentCount, "component", "components")}.`;
}

function dashboardProviderUrls(
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
): NexusDashboardProviderUrls {
  const project = githubRepositoryUrl(projectConfig.repo.remoteUrl);
  return {
    project,
    components: new Map(
      components.map((component) => [
        component.id,
        githubRepositoryUrl(component.remoteUrl) ?? project,
      ]),
    ),
  };
}

function componentProviderUrl(
  providerUrls: NexusDashboardProviderUrls,
  componentId: string | null | undefined,
): string | null {
  return componentId ? providerUrls.components.get(componentId) ?? providerUrls.project : providerUrls.project;
}

function githubRepositoryUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) {
    return null;
  }
  const trimmed = remoteUrl.trim();
  const direct = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/iu.exec(trimmed);
  if (direct) {
    return `https://github.com/${direct[1]}/${stripGitSuffix(direct[2] ?? "")}`;
  }
  const ssh = /^git@github(?:-[^:]+)?\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/iu.exec(trimmed);
  if (ssh) {
    return `https://github.com/${ssh[1]}/${stripGitSuffix(ssh[2] ?? "")}`;
  }
  const sshUrl = /^ssh:\/\/git@github(?:-[^/]+)?\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/iu.exec(trimmed);
  if (sshUrl) {
    return `https://github.com/${sshUrl[1]}/${stripGitSuffix(sshUrl[2] ?? "")}`;
  }
  return null;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/iu, "");
}

function providerActionsForHref(
  href: string | null | undefined,
  labelOverride?: string,
): NexusDashboardProviderAction[] {
  if (!href) {
    return [];
  }
  const normalized = normalizeProviderHref(href);
  if (!normalized) {
    return [];
  }
  const pull = /\/pull\/(\d+)(?:[/?#].*)?$/iu.exec(normalized);
  if (pull) {
    return [
      {
        label: labelOverride ?? `Open PR #${pull[1]}`,
        href: normalized,
        provider: "github",
        kind: "pull-request",
        title: null,
      },
    ];
  }
  const issue = /\/issues\/(\d+)(?:[/?#].*)?$/iu.exec(normalized);
  if (issue) {
    return [
      {
        label: labelOverride ?? `Open issue #${issue[1]}`,
        href: normalized,
        provider: "github",
        kind: "issue",
        title: null,
      },
    ];
  }
  return [
    {
      label: labelOverride ?? "Open provider",
      href: normalized,
      provider: normalized.startsWith("https://github.com/") ? "github" : "web",
      kind: "provider-link",
      title: null,
    },
  ];
}

function providerActionsFromText(
  value: string | null | undefined,
  providerUrls: NexusDashboardProviderUrls,
  componentId?: string | null,
): NexusDashboardProviderAction[] {
  const text = value ?? "";
  const repositoryUrl = componentProviderUrl(
    providerUrls,
    componentId ?? inferComponentIdFromText(text, providerUrls),
  );
  const actions: NexusDashboardProviderAction[] = [];
  for (const match of text.matchAll(/https:\/\/github\.com\/[^\s<>()"'`]+/giu)) {
    actions.push(...providerActionsForHref(match[0].replace(/[.,;:]+$/u, "")));
  }
  if (repositoryUrl) {
    for (const match of text.matchAll(/\b(?:PR|pull request)\s*#(\d+)\b/giu)) {
      const number = match[1];
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("pull-request", number, title),
        href: `${repositoryUrl}/pull/${number}`,
        provider: "github",
        kind: "pull-request",
        title,
      });
    }
    for (const match of text.matchAll(/\b(?:issue|GitHub)\s*#(\d+)\b/giu)) {
      const number = match[1];
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("issue", number, title),
        href: `${repositoryUrl}/issues/${number}`,
        provider: "github",
        kind: "issue",
        title,
      });
    }
    for (const match of text.matchAll(/\bgithub-(\d+)\b/giu)) {
      const number = match[1];
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("issue", number, title),
        href: `${repositoryUrl}/issues/${number}`,
        provider: "github",
        kind: "issue",
        title,
      });
    }
    for (const match of text.matchAll(/#(\d+)\b/gu)) {
      const number = match[1];
      const index = match.index ?? 0;
      const prefix = text.slice(Math.max(0, index - 20), index);
      if (/\b(?:PR|pull request|issue|GitHub)\s*$/iu.test(prefix)) {
        continue;
      }
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("issue", number, title),
        href: `${repositoryUrl}/issues/${number}`,
        provider: "github",
        kind: "issue",
        title,
      });
    }
  }
  return uniqueProviderActions(actions).slice(0, 3);
}

function actionLabel(
  kind: NexusDashboardProviderActionKind,
  number: string,
  title: string | null,
): string {
  const prefix = kind === "pull-request" ? `PR #${number}` : `#${number}`;
  return title ? `${prefix}: ${title}` : prefix;
}

function actionTitleFromText(text: string, number: string): string | null {
  const branch = new RegExp(
    `(?:github-${escapeRegExp(number)}|#${escapeRegExp(number)})(?:[-_/])([A-Za-z0-9][A-Za-z0-9/_-]{2,80})`,
    "iu",
  ).exec(text);
  if (branch?.[1]) {
    return compactActionTitle(branch[1]);
  }
  const providerTitle = new RegExp(
    `(?:\\b(?:PR|pull request|issue|GitHub)\\s*)?#${escapeRegExp(number)}\\s*[:\\-]\\s*([^.;\\n]{3,80})`,
    "iu",
  ).exec(text);
  if (providerTitle?.[1]) {
    return compactActionTitle(providerTitle[1]);
  }
  const completed = new RegExp(
    `Completed\\s+([^.;\\n]{1,80}?)\\s+(?:via|in)\\s+[^.;\\n]*#${escapeRegExp(number)}`,
    "iu",
  ).exec(text);
  if (completed?.[1]) {
    return compactActionTitle(completed[1]);
  }
  return null;
}

function compactActionTitle(value: string): string | null {
  const text = value
    .replace(/[/_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) {
    return null;
  }
  return text.length > 54 ? `${text.slice(0, 51)}...` : text;
}

function inferComponentIdFromText(
  text: string,
  providerUrls: NexusDashboardProviderUrls,
): string | null {
  const componentIds = [...providerUrls.components.keys()].sort(
    (left, right) => right.length - left.length,
  );
  for (const componentId of componentIds) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(componentId)}([^A-Za-z0-9_-]|$)`, "u");
    if (pattern.test(text)) {
      return componentId;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function authorityProviderActions(
  authority: NexusDashboardAuthoritySummary,
  providerUrls: NexusDashboardProviderUrls,
): NexusDashboardProviderAction[] {
  return uniqueProviderActions(
    [
      ...authority.components.flatMap((component) =>
        providerActionsFromText(
          [...component.blockedActions, ...component.warnings].join(" "),
          providerUrls,
          component.componentId,
        ),
      ),
      ...authority.components.flatMap((component) =>
        providerActionsForHref(
          componentProviderUrl(providerUrls, component.componentId),
          `Open ${component.componentId} repo`,
        ),
      ),
    ],
  ).slice(0, 3);
}

function uniqueProviderActions(
  actions: NexusDashboardProviderAction[],
): NexusDashboardProviderAction[] {
  const seen = new Set<string>();
  const unique: NexusDashboardProviderAction[] = [];
  for (const action of actions) {
    if (!action.href || seen.has(action.href)) {
      continue;
    }
    seen.add(action.href);
    unique.push(action);
  }
  return unique;
}

function firstActionHref(actions: NexusDashboardProviderAction[]): string | null {
  return actions[0]?.href ?? null;
}

function normalizeProviderHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function statusOptions(
  options: BuildNexusDashboardSnapshotOptions,
  projectRoot: string,
  gitRunner: GitRunner,
): GetNexusAutomationStatusOptions {
  return {
    projectRoot,
    homePath: options.homePath,
    eligibleWorkMode: options.eligibleWorkMode,
    env: options.env,
    credentialResolver: options.credentialResolver,
    provider: options.provider,
    providerFactory: options.providerFactory,
    providerOptions: options.providerOptions,
    gitRunner,
    now: options.now,
  };
}

function projectSummary(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
): NexusDashboardProjectSummary {
  return {
    id: projectConfig.id,
    name: projectConfig.name,
    root: projectRoot,
    componentCount: components.length,
    defaultBranch: projectConfig.repo.defaultBranch,
    remoteUrl: projectConfig.repo.remoteUrl,
  };
}

function summarizeComponent(
  component: ResolvedNexusProjectComponent,
  gitRunner: GitRunner,
): NexusDashboardComponentSummary {
  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    role: component.role,
    remoteUrl: component.remoteUrl,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    defaultTrackerId: component.defaultTrackerId,
    trackerProviders: component.workTrackers.map((tracker) => tracker.provider),
    verificationRequired: component.verification?.requirePassing ?? false,
    publicationStrategy: component.publication?.strategy ?? null,
    git: component.sourceRootExists
      ? collectDashboardGitState(component.sourceRoot, gitRunner)
      : null,
  };
}

function summarizeComponentShell(
  component: ResolvedNexusProjectComponent,
): NexusDashboardComponentSummary {
  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    role: component.role,
    remoteUrl: component.remoteUrl,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    defaultTrackerId: component.defaultTrackerId,
    trackerProviders: component.workTrackers.map((tracker) => tracker.provider),
    verificationRequired: component.verification?.requirePassing ?? false,
    publicationStrategy: component.publication?.strategy ?? null,
    git: null,
  };
}

function pendingDashboardResult<T>(
  message: string,
): NexusDashboardDataResult<T> {
  return {
    ok: false,
    value: null,
    error: {
      name: "Pending",
      message,
    },
  };
}

function emptyWorktreeSummary(): NexusDashboardWorktreeSummary {
  return {
    activeCount: 0,
    staleCount: 0,
    warnings: [],
    records: [],
  };
}

function emptyThreadSummary(): NexusDashboardThreadSummary {
  return {
    totalCount: 0,
    activeCount: 0,
    needsDecisionCount: 0,
    archiveCandidateCount: 0,
    forgetCandidateCount: 0,
    source: "local",
    incomplete: true,
    detail: null,
    records: [],
  };
}

function emptyTrackedWorkSummary(): NexusDashboardTrackedWorkSummary {
  return {
    totalCount: 0,
    blockedCount: 0,
    readyCount: 0,
    importCandidateCount: 0,
    staleCount: 0,
    excludedCount: 0,
    records: [],
  };
}

function dashboardShellSignals(
  components: NexusDashboardComponentSummary[],
  plugins: NexusDashboardPluginSummary,
): NexusDashboardSignal[] {
  return [
    {
      id: "components",
      label: "Components",
      value: String(components.length),
      tone: "good",
      detail: "Component list loaded.",
    },
    {
      id: "automation",
      label: "Automation",
      value: "...",
      tone: "neutral",
      detail: "Loading automation status.",
    },
    {
      id: "eligible-work",
      label: "Tracked work",
      value: "...",
      tone: "neutral",
      detail: "Loading issues and work items.",
    },
    {
      id: "worktrees",
      label: "Threads",
      value: "...",
      tone: "neutral",
      detail: "Loading active thread state.",
    },
    {
      id: "blockers",
      label: "Blockers",
      value: "...",
      tone: "neutral",
      detail: "Loading approvals and blockers.",
    },
    {
      id: "plugins",
      label: "Plugins",
      value: String(plugins.enabledCount),
      tone: "neutral",
      detail: "Configured plugins loaded; local candidates are still loading.",
    },
  ];
}

function workspaceShellWeave(
  generatedAt: string,
  project: NexusDashboardProjectSummary,
  components: NexusDashboardComponentSummary[],
): NexusDashboardWeave {
  const projectNode: NexusDashboardWeaveNode = {
    id: "project",
    kind: "project",
    laneId: "project",
    label: project.name,
    detail: project.root,
    status: "loading",
    timestamp: generatedAt,
    href: project.remoteUrl,
    actions: [],
  };
  const componentNodes = components.map((component) => ({
    id: `component:${component.id}`,
    kind: "component" as const,
    laneId: "components",
    label: component.name,
    detail: `${component.role} component`,
    status: component.sourceRootExists ? "loading" : "missing",
    timestamp: generatedAt,
    href: component.remoteUrl,
    actions: [],
  }));
  return {
    version: 1,
    generatedAt,
    lanes: [
      {
        id: "project",
        label: "Workspace",
        nodeIds: ["project"],
      },
      {
        id: "components",
        label: "Components",
        nodeIds: componentNodes.map((node) => node.id),
      },
    ],
    nodes: [projectNode, ...componentNodes],
    edges: componentNodes.map((node) => ({
      id: `project-${node.id}`,
      kind: "contains",
      from: "project",
      to: node.id,
      label: "contains",
    })),
  };
}

function collectDashboardGitState(
  repositoryPath: string,
  gitRunner: GitRunner,
): NexusDashboardGitState | null {
  const root = gitStdout(gitRunner, ["rev-parse", "--show-toplevel"], repositoryPath);
  if (!root) {
    return null;
  }
  const branch = gitStdout(gitRunner, ["rev-parse", "--abbrev-ref", "HEAD"], root);
  const headCommit = gitStdout(gitRunner, ["rev-parse", "HEAD"], root);
  const upstream = gitStdout(
    gitRunner,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    root,
  );
  const status = parseDashboardPorcelainStatus(
    gitRawStdout(gitRunner, ["status", "--porcelain=v1"], root) ?? "",
  );
  const aheadBehind = upstream
    ? parseAheadBehind(
        gitStdout(gitRunner, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], root),
      )
    : { ahead: null, behind: null };

  return {
    repositoryPath: root,
    branch,
    upstream,
    headCommit,
    dirty: status.dirty,
    stagedCount: status.stagedCount,
    unstagedCount: status.unstagedCount,
    untrackedCount: status.untrackedCount,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    warnings: upstream ? [] : ["Current branch has no upstream configured."],
  };
}

function parseDashboardPorcelainStatus(output: string): {
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
} {
  const changes = output.split(/\r?\n/u).filter(Boolean);
  return {
    dirty: changes.length > 0,
    stagedCount: changes.filter((line) => !line.startsWith("??") && line[0] !== " ").length,
    unstagedCount: changes.filter((line) => !line.startsWith("??") && line[1] !== " ").length,
    untrackedCount: changes.filter((line) => line.startsWith("??")).length,
  };
}

function parseAheadBehind(value: string | null): {
  ahead: number | null;
  behind: number | null;
} {
  if (!value) {
    return { ahead: null, behind: null };
  }
  const [ahead, behind] = value.split(/\s+/u).map((part) => Number(part));
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

function gitStdout(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  const stdout = gitRawStdout(gitRunner, args, cwd);
  const trimmed = stdout?.trim();
  return trimmed ? trimmed : null;
}

function gitRawStdout(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

function summarizeWorktrees(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
  collection: NexusWorktreeLeaseCollection | null,
): NexusDashboardWorktreeSummary {
  return {
    activeCount: collection?.activeCount ?? 0,
    staleCount: collection?.staleCount ?? 0,
    warnings: collection?.warnings ?? [],
    records:
      collection?.records.map((record) => ({
        id: record.id,
        componentId:
          record.scope.kind === "component" ? record.scope.componentId : null,
        workItemId: record.workItemId,
        status: record.status,
        effectiveStatus: record.effectiveStatus,
        branchName: record.branchName,
        worktreePath: dashboardLeaseWorktreePath(
          projectRoot,
          projectConfig,
          components,
          record,
        ),
        hostId: record.hostId,
        agentId: record.agentId,
        stale: record.stale,
        dirty: record.dirty,
        pushed: record.pushed,
        updatedAt: record.updatedAt,
        writeScope: record.writeScope,
      })) ?? [],
  };
}

function dashboardLeaseWorktreePath(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: NexusDashboardComponentSummary[],
  lease: NexusWorktreeLeaseSummary,
): string | null {
  const relativePath = lease.worktree.relativePath ?? "";
  if (lease.worktree.base === "projectRoot") {
    return path.resolve(projectRoot, relativePath);
  }
  if (lease.worktree.base === "projectWorktreesRoot") {
    return path.resolve(
      projectWorktreesRootPath(projectRoot, projectConfig),
      relativePath,
    );
  }
  const componentId = lease.worktree.componentId ?? lease.scope.componentId;
  const component = componentId
    ? components.find((candidate) => candidate.id === componentId)
    : null;
  if (lease.worktree.base === "componentWorktreesRoot" && component) {
    return path.resolve(component.worktreesRoot, relativePath);
  }
  if (lease.worktree.base === "componentSourceRoot" && component) {
    return path.resolve(component.sourceRoot, relativePath);
  }
  return null;
}

function summarizeThreads(
  worktrees: NexusDashboardWorktreeSummary,
  providerUrls: NexusDashboardProviderUrls,
  cleanupCandidates: NexusCleanupCandidate[],
  runs: NexusAutomationRunRecord[],
  threadResolutions: NexusDashboardThreadResolutionStore = emptyNexusDashboardThreadResolutionStore(),
  metadata: Pick<NexusDashboardThreadSummary, "source" | "incomplete" | "detail"> = {},
): NexusDashboardThreadSummary {
  const matchedCleanupIds = new Set<string>();
  const assistantThreads = assistantThreadIndex(runs);
  const leaseRecords = worktrees.records
    .map((worktree): NexusDashboardThreadRecord => {
      const cleanup = cleanupCandidateForThread(cleanupCandidates, worktree);
      if (cleanup) {
        matchedCleanupIds.add(cleanup.id);
      }
      const assistantThread = assistantThreadForWork({
        index: assistantThreads,
        componentId: worktree.componentId,
        workItemId: worktree.workItemId,
        branchName: worktree.branchName,
      });
      const decision = threadDecision(worktree, cleanup, assistantThread);
      const actions = providerActionsFromText(
        `${worktree.workItemId ?? ""} ${worktree.branchName ?? ""} ${worktree.id}`,
        providerUrls,
        worktree.componentId,
      );
      return {
        id: worktree.id,
        title: threadTitle(worktree),
        componentId: worktree.componentId,
        workItemId: worktree.workItemId,
        branchName: worktree.branchName,
        hostId: worktree.hostId,
        agentId: worktree.agentId,
        state: worktree.effectiveStatus,
        decision,
        decisionLabel: threadDecisionLabel(decision),
        decisionDetail: threadDecisionDetail(decision, cleanup),
        stale: worktree.stale,
        dirty: worktree.dirty,
        pushed: worktree.pushed,
        cleanupSafe: cleanup?.safeToDelete ?? null,
        cleanupBlockers: cleanup?.blockers ?? [],
        assistantProvider: assistantThread ? "codex" : null,
        assistantThreadId: assistantThread?.threadId ?? null,
        updatedAt: worktree.updatedAt,
        actions,
      };
    });
  const cleanupRecords = cleanupCandidates
    .filter((candidate) => !matchedCleanupIds.has(candidate.id))
    .map((candidate) => cleanupThreadRecord(candidate, providerUrls, assistantThreads));
  const records = uniqueThreadRecords([...leaseRecords, ...cleanupRecords])
    .filter((record) => !threadResolutionForRecord(threadResolutions, record))
    .sort((left, right) => {
      const priority = threadDecisionPriority(left.decision) - threadDecisionPriority(right.decision);
      return priority !== 0 ? priority : right.updatedAt.localeCompare(left.updatedAt);
    });

  const needsDecision = records.filter((record) =>
    !["continue", "resume"].includes(record.decision),
  );
  return {
    totalCount: records.length,
    activeCount: records.filter((record) =>
      ["continue", "resume"].includes(record.decision)
    ).length,
    needsDecisionCount: needsDecision.length,
    archiveCandidateCount: records.filter((record) => record.decision === "archive").length,
    forgetCandidateCount: records.filter((record) => record.decision === "forget").length,
    source: metadata.source ?? (cleanupCandidates.length > 0 ? "cleanup" : "local"),
    incomplete: metadata.incomplete ?? cleanupCandidates.length === 0,
    detail: metadata.detail ?? null,
    records,
  };
}

function threadResolutionForRecord(
  store: NexusDashboardThreadResolutionStore,
  record: NexusDashboardThreadRecord,
): NexusDashboardThreadResolutionRecord | null {
  const key = threadRecordKey(record);
  return store.records.find((resolution) =>
    resolution.threadId === record.id ||
    resolution.threadKey === key ||
    threadResolutionScopeMatches(resolution, record)
  ) ?? null;
}

function threadResolutionScopeMatches(
  resolution: NexusDashboardThreadResolutionRecord,
  record: NexusDashboardThreadRecord,
): boolean {
  const sameComponent =
    !resolution.componentId ||
    !record.componentId ||
    resolution.componentId === record.componentId;
  if (!sameComponent) {
    return false;
  }
  if (resolution.branchName && record.branchName === resolution.branchName) {
    return true;
  }
  return Boolean(resolution.workItemId && record.workItemId === resolution.workItemId);
}

function uniqueThreadRecords(
  records: NexusDashboardThreadRecord[],
): NexusDashboardThreadRecord[] {
  const byKey = new Map<string, NexusDashboardThreadRecord>();
  for (const record of records) {
    const key = threadRecordKey(record);
    const previous = byKey.get(key);
    if (!previous || preferThreadRecord(record, previous) === record) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()];
}

function threadRecordKey(record: NexusDashboardThreadRecord): string {
  return [
    record.componentId ?? "workspace",
    record.branchName ?? record.workItemId ?? record.title ?? record.id,
  ].join(":");
}

function preferThreadRecord(
  left: NexusDashboardThreadRecord,
  right: NexusDashboardThreadRecord,
): NexusDashboardThreadRecord {
  const priority = threadDecisionPriority(left.decision) - threadDecisionPriority(right.decision);
  if (priority !== 0) {
    return priority < 0 ? left : right;
  }
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  return left.cleanupBlockers.length >= right.cleanupBlockers.length ? left : right;
}

function cleanupThreadRecord(
  candidate: NexusCleanupCandidate,
  providerUrls: NexusDashboardProviderUrls,
  assistantThreads: Map<string, AssistantThreadReference>,
): NexusDashboardThreadRecord {
  const actionText = `${candidate.branch ?? ""} ${candidate.id}`;
  const assistantThread = assistantThreadForWork({
    index: assistantThreads,
    componentId: candidate.componentId,
    workItemId: candidate.lease?.workItemId ?? null,
    branchName: candidate.branch,
  });
  const decision = cleanupThreadDecision(candidate);
  return {
    id: candidate.id,
    title: cleanupThreadTitle(candidate),
    componentId: candidate.componentId,
    workItemId: candidate.lease?.workItemId ?? null,
    branchName: candidate.branch,
    hostId: "local",
    agentId: null,
    state: candidate.classifications.join(", "),
    decision,
    decisionLabel: threadDecisionLabel(decision),
    decisionDetail: threadDecisionDetail(decision, candidate),
    stale: candidate.classifications.includes("stale"),
    dirty: candidate.classifications.includes("dirty"),
    pushed: candidate.git.ahead === 0 ? true : candidate.git.ahead ? false : null,
    cleanupSafe: candidate.safeToDelete,
    cleanupBlockers: candidate.blockers,
    assistantProvider: assistantThread ? "codex" : null,
    assistantThreadId: assistantThread?.threadId ?? null,
    updatedAt: "",
    actions: providerActionsFromText(actionText, providerUrls, candidate.componentId),
  };
}

interface AssistantThreadReference {
  threadId: string;
  finishedAt: string | null;
  startedAt: string;
}

function assistantThreadIndex(
  runs: NexusAutomationRunRecord[],
): Map<string, AssistantThreadReference> {
  const index = new Map<string, AssistantThreadReference>();
  for (const run of runs) {
    const appServer = run.codexAppServer;
    const threadId = appServer?.threadId;
    if (!threadId || appServer.ephemeral || appServer.threadPersistence !== "durable") {
      continue;
    }
    const reference: AssistantThreadReference = {
      threadId,
      finishedAt: run.finishedAt,
      startedAt: run.startedAt,
    };
    for (const key of assistantThreadKeys({
      componentId: run.componentId,
      workItemId: run.workItemId,
      branchName: run.branchName,
    })) {
      const previous = index.get(key);
      if (!previous || assistantThreadReferenceTime(reference) > assistantThreadReferenceTime(previous)) {
        index.set(key, reference);
      }
    }
  }

  return index;
}

function assistantThreadForWork(options: {
  index: Map<string, AssistantThreadReference>;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
}): AssistantThreadReference | null {
  for (const key of assistantThreadKeys(options)) {
    const reference = options.index.get(key);
    if (reference) {
      return reference;
    }
  }

  return null;
}

function assistantThreadKeys(options: {
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
}): string[] {
  const componentId = options.componentId ?? "workspace";
  return [
    options.branchName ? `branch:${componentId}:${options.branchName}` : null,
    options.workItemId ? `work:${componentId}:${options.workItemId}` : null,
  ].filter((key): key is string => Boolean(key));
}

function assistantThreadReferenceTime(reference: AssistantThreadReference): number {
  const time = new Date(reference.finishedAt ?? reference.startedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function cleanupThreadDecision(
  candidate: NexusCleanupCandidate,
): NexusDashboardThreadDecision {
  if (candidate.rescue.needed) {
    return "rescue";
  }
  if (candidate.classifications.includes("merged")) {
    return "merged";
  }
  if (candidate.safeToDelete) {
    return "forget";
  }
  if (candidate.classifications.includes("blocked")) {
    return "blocked";
  }
  return "review";
}

function threadDecision(
  worktree: NexusDashboardWorktreeSummary["records"][number],
  cleanup: NexusCleanupCandidate | null,
  assistantThread: AssistantThreadReference | null,
): NexusDashboardThreadDecision {
  const status = worktree.effectiveStatus || worktree.status;
  if (worktree.dirty) {
    return "rescue";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "merged") {
    return "merged";
  }
  if (cleanup?.safeToDelete) {
    return "forget";
  }
  if (status === "abandoned") {
    return "archive";
  }
  if (assistantThread) {
    return "resume";
  }
  if (
    worktree.stale ||
    status === "stale" ||
    status === "ready"
  ) {
    return "review";
  }
  return "continue";
}

function cleanupCandidateForThread(
  candidates: NexusCleanupCandidate[],
  worktree: NexusDashboardWorktreeSummary["records"][number],
): NexusCleanupCandidate | null {
  return candidates.find((candidate) =>
    candidate.lease?.id === worktree.id ||
    (Boolean(worktree.branchName) && candidate.branch === worktree.branchName)
  ) ?? null;
}

function threadDecisionLabel(decision: NexusDashboardThreadDecision): string {
  switch (decision) {
    case "archive":
      return "Archive";
    case "blocked":
      return "Blocked";
    case "forget":
      return "Forget";
    case "merged":
      return "Merged";
    case "rescue":
      return "Rescue";
    case "resume":
      return "Resume";
    case "review":
      return "Review";
    case "continue":
      return "Continue";
  }
}

function threadDecisionDetail(
  decision: NexusDashboardThreadDecision,
  cleanup: NexusCleanupCandidate | null,
): string {
  switch (decision) {
    case "archive":
      return "Park the thread outside the active flow, keeping its notes and branch context.";
    case "blocked":
      if (cleanup && !cleanup.safeToDelete && cleanup.blockers.length > 0) {
        return cleanup.blockers[0];
      }
      return "A blocker needs a human decision before this thread can continue or be cleaned up.";
    case "forget":
      return "Clean merged work can leave the active cockpit after cleanup proof.";
    case "merged":
      return "Merged work can leave the active cockpit after cleanup proof.";
    case "rescue":
      return "Local changes need inspection before this can be archived or forgotten.";
    case "resume":
      return "A previous assistant chat is available for this thread.";
    case "review":
      if (cleanup && !cleanup.safeToDelete && cleanup.blockers.length > 0) {
        return cleanup.blockers[0];
      }
      return "Decide whether to continue, archive the useful parts, or forget the thread.";
    case "continue":
      return "Active work; keep it visible in the cockpit.";
  }
}

function threadDecisionPriority(decision: NexusDashboardThreadDecision): number {
  switch (decision) {
    case "rescue":
      return 0;
    case "blocked":
      return 1;
    case "review":
      return 2;
    case "merged":
      return 3;
    case "resume":
      return 4;
    case "continue":
      return 5;
    case "archive":
      return 6;
    case "forget":
      return 7;
  }
}

function threadTitle(worktree: NexusDashboardWorktreeSummary["records"][number]): string {
  const branch = worktree.branchName ?? worktree.workItemId ?? worktree.id;
  return compactThreadBranch(branch);
}

function cleanupThreadTitle(candidate: NexusCleanupCandidate): string {
  return compactThreadBranch(
    candidate.branch ??
    (candidate.worktreePath ? path.basename(candidate.worktreePath) : candidate.id),
  );
}

function compactThreadBranch(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : value;
}

type DashboardPluginCapability =
  | NexusPluginCapabilityProjection["capabilities"][number]
  | NonNullable<NexusProjectConfig["plugins"]>[number]["capabilities"][number];

function summarizePlugins(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  components: ResolvedNexusProjectComponent[],
): NexusDashboardPluginSummary {
  const configured = summarizeConfiguredPlugins(projectConfig);
  const configuredRecords = configured.records;
  const configuredKeys = new Set(
    configuredRecords.flatMap((record) => pluginRecordKeys(record)),
  );
  const availableRecords = localPluginCandidates(projectRoot, components)
    .filter((candidate) =>
      pluginRecordKeys(candidate).every((key) => !configuredKeys.has(key))
    )
    .map((candidate) => localPluginDashboardRecord(projectRoot, candidate));
  const records = [...configuredRecords, ...availableRecords];
  return {
    totalCount: records.length,
    enabledCount: configured.enabledCount,
    configuredCount: configuredRecords.length,
    availableCount: availableRecords.length,
    capabilityCount: records.reduce((count, record) => count + record.capabilityCount, 0),
    records,
  };
}

function summarizeConfiguredPlugins(
  projectConfig: NexusProjectConfig,
): NexusDashboardPluginSummary {
  const projections = projectPluginCapabilityProjections(projectConfig);
  const projectionsById = new Map(projections.map((projection) => [projection.pluginId, projection]));
  const records = (projectConfig.plugins ?? []).map((plugin) =>
    pluginDashboardRecord(plugin, projectionsById.get(plugin.id))
  );
  return {
    totalCount: records.length,
    enabledCount: records.filter((record) => record.enabled).length,
    configuredCount: records.length,
    availableCount: 0,
    capabilityCount: records.reduce((count, record) => count + record.capabilityCount, 0),
    records,
  };
}

function pluginDashboardRecord(
  plugin: NonNullable<NexusProjectConfig["plugins"]>[number],
  projection: NexusPluginCapabilityProjection | undefined,
): NexusDashboardPluginRecord {
  const capabilities = projection?.capabilities ?? plugin.capabilities;
  return {
    id: plugin.id,
    name: plugin.name ?? plugin.id,
    version: plugin.version ?? null,
    enabled: plugin.enabled !== false,
    state: plugin.enabled !== false ? "enabled" : "disabled",
    source: "configured",
    packageName: null,
    sourcePath: null,
    refreshCommand: null,
    detail: plugin.enabled !== false ? "Configured for this workspace." : "Configured but disabled.",
    capabilityCount: capabilities.length,
    projectedSkillCount: capabilities.filter((capability) => capability.kind === "projected_skill").length,
    mcpServerCount: capabilities.filter((capability) => capability.kind === "mcp_server").length,
    setupActionCount: capabilities.filter((capability) =>
      capability.kind === "setup_obligation" ||
      capability.kind === "environment_hint" ||
      capability.kind === "cleanup_hook",
    ).length,
    dependencyProjectionCount: capabilities.filter((capability) => capability.kind === "dependency_projection").length,
    projectedSkills: capabilities
      .filter((capability) => capability.kind === "projected_skill")
      .map((capability) => capability.skillId)
      .slice(0, 3),
    mcpServers: capabilities
      .filter((capability) => capability.kind === "mcp_server")
      .map((capability) => capability.serverName)
      .slice(0, 3),
    setupHints: capabilities
      .filter((capability) =>
        capability.kind === "setup_obligation" ||
        capability.kind === "environment_hint" ||
        capability.kind === "cleanup_hook"
      )
      .map(pluginSetupHint)
      .slice(0, 2),
    dependencyHints: capabilities
      .filter((capability) => capability.kind === "dependency_projection")
      .map((capability) => `${capability.source} -> ${capability.target}`)
      .slice(0, 2),
  };
}

interface LocalPluginCandidate {
  id: string;
  name: string;
  version: string | null;
  packageName: string | null;
  sourcePath: string;
  detail: string;
}

function localPluginCandidates(
  projectRoot: string,
  components: ResolvedNexusProjectComponent[],
): LocalPluginCandidate[] {
  const candidates: LocalPluginCandidate[] = [];
  const seenPaths = new Set<string>();
  for (const component of components) {
    if (!component.sourceRootExists) {
      continue;
    }
    const pluginsRoot = path.join(component.sourceRoot, "plugins");
    if (!isDirectory(pluginsRoot)) {
      continue;
    }
    for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pluginRoot = path.resolve(pluginsRoot, entry.name);
      if (seenPaths.has(pluginRoot) || samePath(pluginRoot, projectRoot)) {
        continue;
      }
      seenPaths.add(pluginRoot);
      const candidate = readLocalPluginCandidate(pluginRoot, entry.name);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

function readLocalPluginCandidate(
  pluginRoot: string,
  fallbackId: string,
): LocalPluginCandidate | null {
  const packagePath = path.join(pluginRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(packagePath, "utf8")) as Record<string, unknown>;
    const packageName = typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : null;
    const id = pluginIdFromPackageName(packageName, fallbackId);
    const description = typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : "Local DevNexus plugin package.";
    return {
      id,
      name: titleCasePluginId(id),
      version: typeof raw.version === "string" && raw.version.trim()
        ? raw.version.trim()
        : null,
      packageName,
      sourcePath: pluginRoot,
      detail: description,
    };
  } catch {
    return null;
  }
}

function localPluginDashboardRecord(
  projectRoot: string,
  candidate: LocalPluginCandidate,
): NexusDashboardPluginRecord {
  return {
    id: candidate.id,
    name: candidate.name,
    version: candidate.version,
    enabled: false,
    state: "available",
    source: "local",
    packageName: candidate.packageName,
    sourcePath: candidate.sourcePath,
    refreshCommand:
      `dev-nexus workspace plugin refresh ${shellQuote(projectRoot)} --from ${shellQuote(candidate.sourcePath)}`,
    detail: candidate.detail,
    capabilityCount: 0,
    projectedSkillCount: 0,
    mcpServerCount: 0,
    setupActionCount: 0,
    dependencyProjectionCount: 0,
    projectedSkills: [],
    mcpServers: [],
    setupHints: [],
    dependencyHints: [],
  };
}

function pluginRecordKeys(
  record: Pick<NexusDashboardPluginRecord, "id" | "name" | "packageName"> | LocalPluginCandidate,
): string[] {
  const values = [record.id, record.name, record.packageName ?? null]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.map(normalizePluginKey);
}

function normalizePluginKey(value: string): string {
  return value.trim().toLowerCase().replace(/^@[^/]+\//u, "");
}

function pluginIdFromPackageName(packageName: string | null, fallbackId: string): string {
  return normalizePluginKey(packageName ?? fallbackId);
}

function titleCasePluginId(id: string): string {
  const words = id.split(/[-_]+/u).filter(Boolean).map((word) => {
    const lower = word.toLowerCase();
    if (lower === "dev") {
      return "Dev";
    }
    if (lower === "nexus") {
      return "Nexus";
    }
    return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
  });
  return words.join(" ").replace(/^Dev Nexus/u, "DevNexus");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function pluginSetupHint(capability: DashboardPluginCapability): string {
  if (capability.kind === "environment_hint") {
    return capability.required ? `${capability.variable} required` : capability.variable;
  }
  if (capability.kind === "cleanup_hook") {
    return capability.trigger ? `${capability.trigger} cleanup` : "cleanup hook";
  }
  if (capability.kind === "setup_obligation") {
    return capability.description;
  }
  return capability.id;
}

function summarizePublication(
  automationStatus: NexusAutomationStatus | null,
): NexusDashboardPublicationSummary[] {
  return (
    automationStatus?.publication.map((status) => ({
      componentId: status.componentId,
      strategy: status.policy.strategy,
      targetBranch: status.policy.targetBranch ?? null,
      remote: status.policy.remote ?? null,
      blocking: status.blocking,
      actorStatus: status.actor.status,
      authorityStatus: status.authority?.status ?? null,
      warnings: status.warnings,
    })) ?? []
  );
}

function summarizeAuthority(
  authority: NexusAutomationStatus["authority"] | null,
): NexusDashboardAuthoritySummary | null {
  if (!authority) {
    return null;
  }
  return {
    summary: authority.summary,
    warningCount: authority.warnings.length,
    blockedActionCount: authority.components.reduce(
      (count, component) => count + component.blockedActions.length,
      0,
    ),
    waitingActionCount: authority.components.reduce(
      (count, component) => count + component.waitingActions.length,
      0,
    ),
    fallbackActionCount: authority.components.reduce(
      (count, component) => count + component.fallbackActions.length,
      0,
    ),
    components: authority.components.map((component) => ({
      componentId: component.componentId,
      actorStatus: component.actor.status,
      roles: component.roles,
      blockedActions: component.blockedActions,
      warnings: component.warnings,
    })),
  };
}

function dashboardBlockers(options: {
  automation: NexusDashboardDataResult<NexusAutomationStatus>;
  eligibleWork: NexusDashboardDataResult<NexusEligibleWorkSummary>;
  targetReport: NexusDashboardDataResult<NexusAutomationTargetReport>;
}): string[] {
  const blockers = [
    ...(options.automation.ok ? [] : [`Automation status unavailable: ${options.automation.error?.message ?? "unknown error"}`]),
    ...(options.eligibleWork.ok ? [] : [`Eligible work unavailable: ${options.eligibleWork.error?.message ?? "unknown error"}`]),
    ...(options.targetReport.ok ? [] : [`Target report unavailable: ${options.targetReport.error?.message ?? "unknown error"}`]),
    ...(options.automation.value?.eligibleWorkBlockers ?? []),
    ...(options.eligibleWork.value?.blockers ?? []),
    ...(options.targetReport.value?.activeBlockers.map(activeBlockerText) ?? []),
    ...(options.targetReport.value?.blockers ?? []),
  ];
  return [...new Set(blockers)].slice(0, 20);
}

function activeBlockerText(
  blocker: NexusAutomationTargetReport["activeBlockers"][number],
): string {
  const work = [blocker.workItemTitle, blocker.workItemId].filter(Boolean).join(" ");
  const source = [blocker.componentId, blocker.trackerProvider, blocker.trackerId]
    .filter(Boolean)
    .join(" · ");
  return [work || blocker.source, blocker.message, source].filter(Boolean).join(" · ");
}

function cycleActionText(cycle: NexusAutomationTargetCycleRecord): string {
  return [
    cycle.id,
    cycle.summary,
    ...cycle.notes,
    ...cycle.blockers,
    ...cycle.workItems.flatMap((item) => [
      item.componentId,
      item.id,
      item.title,
      item.notes,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

function summarizeTrackedWork(
  summary: NexusEligibleWorkSummary | null,
  providerUrls: NexusDashboardProviderUrls,
): NexusDashboardTrackedWorkSummary {
  const records: NexusDashboardTrackedWorkItem[] = [];
  for (const component of summary?.components ?? []) {
    for (const item of component.workItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "ready",
        kindLabel: "ready",
        detail: item.importOnly
          ? "Ready to import before automation can select it."
          : "Ready for automation or a human to pick up.",
        providerUrls,
      }));
    }
    for (const item of component.importCandidateWorkItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "import-candidate",
        kindLabel: "import",
        detail: "Provider work can be linked or imported into this workspace.",
        providerUrls,
      }));
    }
    for (const item of component.staleInProgressWorkItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "stale",
        kindLabel: "stale",
        detail: "In progress, but no recent cycle has advanced it.",
        providerUrls,
      }));
    }
    for (const item of component.excludedWorkItems) {
      records.push(trackedWorkItem({
        item,
        component,
        kind: "excluded",
        kindLabel: "hidden",
        detail: item.reasons.length > 0
          ? item.reasons.slice(0, 2).join(", ")
          : "Visible to the tracker, but not selectable right now.",
        providerUrls,
      }));
    }
  }
  records.sort(compareTrackedWorkItems);
  return {
    totalCount:
      (summary?.eligibleWorkItemCount ?? 0) +
      (summary?.importCandidateWorkItemCount ?? 0) +
      (summary?.staleInProgressWorkItemCount ?? 0) +
      (summary?.excludedWorkItemCount ?? 0),
    blockedCount: trackedWorkBlockedCount(records),
    readyCount: trackedWorkReadyCount(records),
    importCandidateCount: summary?.importCandidateWorkItemCount ?? 0,
    staleCount: summary?.staleInProgressWorkItemCount ?? 0,
    excludedCount: summary?.excludedWorkItemCount ?? 0,
    source: "provider",
    incomplete: false,
    detail: null,
    records: records.slice(0, 30),
  };
}

function summarizeLocalTrackedWork(options: {
  generatedAt: string;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardTrackedWorkSummary {
  const records: NexusDashboardTrackedWorkItem[] = [];
  const seen = new Set<string>();
  const add = (item: NexusDashboardTrackedWorkItem): void => {
    const key = `${item.componentId}:${item.id}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    records.push(item);
  };

  for (const component of options.components) {
    for (const tracker of component.workTrackers) {
      const localWorkTracking = tracker.workTracking;
      if (!tracker.enabled || localWorkTracking.provider !== "local") {
        continue;
      }
      const store = capture(() =>
        loadLocalWorkTrackingStore(
          resolveLocalWorkTrackingStorePath(options.projectRoot, localWorkTracking),
          options.generatedAt,
          "dashboardTrackedWorkLocalFallback",
        ),
      );
      if (!store.ok) {
        continue;
      }
      for (const item of store.value?.items ?? []) {
        if (item.status === "done" || item.status === "wont_do") {
          continue;
        }
        add(trackedWorkLocalItem({
          item,
          component,
          trackerRef: {
            componentId: component.id,
            componentName: component.name,
            trackerId: tracker.id,
            trackerName: tracker.name,
            provider: tracker.provider,
            roles: tracker.roles,
            default: tracker.default,
          },
          providerUrls: options.providerUrls,
        }));
      }
    }
  }

  records.sort(compareTrackedWorkItems);
  return {
    totalCount: records.length,
    blockedCount: trackedWorkBlockedCount(records),
    readyCount: trackedWorkReadyCount(records),
    importCandidateCount: 0,
    staleCount: records.filter((item) => item.kind === "stale").length,
    excludedCount: 0,
    source: "local",
    incomplete: true,
    detail: "Showing local tracker records while provider work items finish loading.",
    records: records.slice(0, 30),
  };
}

function trackedWorkLocalItem(options: {
  item: WorkItem;
  component: ResolvedNexusProjectComponent;
  trackerRef: WorkTrackerRef;
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardTrackedWorkItem {
  const status = options.item.status;
  const kind: NexusDashboardTrackedWorkKind =
    status === "blocked" ? "blocked" : status === "in_progress" ? "stale" : "ready";
  const kindLabel =
    status === "blocked" ? "blocked" : status === "in_progress" ? "active" : "local";
  const detail =
    status === "blocked"
      ? "Blocked local work item. Review before automation can continue."
      : status === "in_progress"
        ? "Local item is in progress; provider scan is still loading."
        : "Local work item is visible while provider scan finishes.";
  const actions = uniqueProviderActions([
    ...providerActionsForHref(options.item.webUrl),
    ...providerActionsFromText(
      `${options.item.id} ${options.item.title}`,
      options.providerUrls,
      options.component.id,
    ),
  ]);
  return {
    id: options.item.id,
    logicalItemId: options.item.externalRef?.itemId ?? options.item.id,
    componentId: options.component.id,
    componentName: options.component.name,
    title: options.item.title,
    status,
    kind,
    kindLabel,
    detail,
    provider: options.trackerRef.provider,
    trackerId: options.trackerRef.trackerId,
    updatedAt: options.item.updatedAt ?? null,
    webUrl: options.item.webUrl ?? null,
    actions,
  };
}

function trackedWorkItem(options: {
  item:
    | NexusEligibleWorkSummary["components"][number]["workItems"][number]
    | NexusEligibleWorkSummary["components"][number]["excludedWorkItems"][number];
  component: NexusEligibleWorkSummary["components"][number];
  kind: NexusDashboardTrackedWorkKind;
  kindLabel: string;
  detail: string;
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardTrackedWorkItem {
  const item = options.item;
  const trackerRef =
    "sourceTrackerRef" in item && item.sourceTrackerRef
      ? item.sourceTrackerRef
      : "canonicalTrackerRef" in item && item.canonicalTrackerRef
        ? item.canonicalTrackerRef
        : "trackerRef" in item
          ? item.trackerRef
          : null;
  const actions = uniqueProviderActions([
    ...providerActionsForHref(item.webUrl),
    ...providerActionsFromText(
      `${item.id} ${"logicalItemId" in item ? item.logicalItemId ?? "" : ""} ${item.title}`,
      options.providerUrls,
      options.component.componentId,
    ),
  ]);
  return {
    id: item.id,
    logicalItemId: "logicalItemId" in item ? item.logicalItemId : item.id,
    componentId: options.component.componentId,
    componentName: options.component.componentName,
    title: item.title,
    status: item.status,
    kind: options.kind,
    kindLabel: options.kindLabel,
    detail: options.detail,
    provider: trackerRef?.provider ?? null,
    trackerId: trackerRef?.trackerId ?? null,
    updatedAt: item.updatedAt,
    webUrl: item.webUrl,
    actions,
  };
}

function compareTrackedWorkItems(
  left: NexusDashboardTrackedWorkItem,
  right: NexusDashboardTrackedWorkItem,
): number {
  return trackedWorkScore(right) - trackedWorkScore(left) ||
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
    left.componentName.localeCompare(right.componentName) ||
    left.title.localeCompare(right.title);
}

function trackedWorkScore(item: NexusDashboardTrackedWorkItem): number {
  if (item.status === "blocked") {
    return 95;
  }
  switch (item.kind) {
    case "blocked":
      return 95;
    case "ready":
      return 90;
    case "import-candidate":
      return 70;
    case "stale":
      return 60;
    case "excluded":
      return 20;
  }
}

function trackedWorkBlockedCount(records: NexusDashboardTrackedWorkItem[]): number {
  return records.filter((item) => item.kind === "blocked" || item.status === "blocked").length;
}

function trackedWorkReadyCount(records: NexusDashboardTrackedWorkItem[]): number {
  return records.filter((item) =>
    item.kind === "ready" && item.status !== "blocked"
  ).length;
}

function buildDashboardEvents(options: {
  generatedAt: string;
  automation: NexusAutomationStatus | null;
  eligibleWork: NexusEligibleWorkSummary | null;
  targetReport: NexusAutomationTargetReport | null;
  worktrees: NexusDashboardWorktreeSummary;
  cycles: NexusAutomationTargetCycleRecord[];
  runs: NexusAutomationRunRecord[];
  blockers: string[];
  providerUrls: NexusDashboardProviderUrls;
}): NexusDashboardEvent[] {
  const events: NexusDashboardEvent[] = [
    {
      id: "snapshot-generated",
      time: options.generatedAt,
      source: "actual",
      severity: "info",
      title: "Snapshot refreshed",
      body: "Read local DevNexus state.",
      relatedNodeIds: ["project"],
      href: options.providerUrls.project,
      actions: providerActionsForHref(options.providerUrls.project, "Open repository"),
    },
  ];

  if (options.automation) {
    const actions = providerActionsFromText(options.automation.summary, options.providerUrls);
    events.push({
      id: "automation-status",
      time: options.generatedAt,
      source: "actual",
      severity: options.automation.status === "blocked" ? "warning" : "info",
      title: `Automation ${options.automation.status}`,
      body: compactDetail(options.automation.summary),
      relatedNodeIds: ["project"],
      href: firstActionHref(actions),
      actions,
    });
  }

  if (options.eligibleWork) {
    const actions = providerActionsFromText(options.eligibleWork.summary, options.providerUrls);
    events.push({
      id: "eligible-work",
      time: options.generatedAt,
      source: "actual",
      severity: options.eligibleWork.eligibleWorkItemCount > 0 ? "success" : "info",
      title: `${options.eligibleWork.eligibleWorkItemCount} ready ${plural(options.eligibleWork.eligibleWorkItemCount, "item", "items")}`,
      body: compactDetail(options.eligibleWork.summary),
      relatedNodeIds: ["project"],
      href: firstActionHref(actions),
      actions,
    });
  }

  for (const cycle of options.cycles.slice(-8).reverse()) {
    const actions = providerActionsFromText(cycleActionText(cycle), options.providerUrls);
    events.push({
      id: `target-cycle-${cycle.id}`,
      time: cycle.finishedAt ?? cycle.startedAt,
      source: "actual",
      severity: cycle.status === "blocked" || cycle.status === "failed" ? "warning" : "info",
      title: `Target cycle ${cycle.status}`,
      body: cycle.summary ?? cycle.id,
      relatedNodeIds: [nodeId("target-cycle", cycle.id)],
      href: firstActionHref(actions),
      actions,
    });
  }

  for (const run of options.runs.slice(-5).reverse()) {
    const actions = providerActionsFromText(`${run.summary ?? ""} ${run.error ?? ""} ${run.workItemId ?? ""} ${run.branchName ?? ""}`, options.providerUrls, run.componentId);
    events.push({
      id: `run-${run.id}`,
      time: run.finishedAt ?? run.startedAt,
      source: "actual",
      severity: run.status === "failed" || run.status === "blocked" ? "warning" : "info",
      title: `Run ${run.status}`,
      body: run.summary ?? run.id,
      relatedNodeIds: [nodeId("run", run.id)],
      href: firstActionHref(actions),
      actions,
    });
  }

  for (const worktree of options.worktrees.records.slice(0, 8)) {
    const actions = providerActionsFromText(`${worktree.workItemId ?? ""} ${worktree.branchName ?? worktree.id}`, options.providerUrls, worktree.componentId);
    events.push({
      id: `worktree-${worktree.id}`,
      time: worktree.updatedAt,
      source: "actual",
      severity: worktree.stale ? "warning" : "info",
      title: `Worktree ${worktree.effectiveStatus}`,
      body: `${worktree.branchName ?? worktree.id} on ${worktree.hostId}`,
      relatedNodeIds: [nodeId("worktree", worktree.id)],
      href: firstActionHref(actions),
      actions,
    });
  }

  options.blockers.slice(0, 8).forEach((blocker, index) => {
    const actions = providerActionsFromText(blocker, options.providerUrls);
    events.push({
      id: `blocker-${index}`,
      time: options.generatedAt,
      source: "warning",
      severity: "warning",
      title: "Active blocker",
      body: compactDetail(blocker),
      relatedNodeIds: [nodeId("blocker", String(index))],
      href: firstActionHref(actions),
      actions,
    });
  });

  return events;
}

function dashboardSignals(
  components: NexusDashboardComponentSummary[],
  automation: NexusAutomationStatus | null,
  eligibleWork: NexusEligibleWorkSummary | null,
  threads: NexusDashboardThreadSummary,
  plugins: NexusDashboardPluginSummary,
  blockers: string[],
): NexusDashboardSignal[] {
  return [
    {
      id: "components",
      label: "Components",
      value: String(components.length),
      tone: components.every((component) => component.sourceRootExists) ? "good" : "danger",
      detail: "Ready",
    },
    {
      id: "automation",
      label: "Automation",
      value: automation?.status ?? "unknown",
      tone: automationTone(automation?.status),
      detail: automationDetail(automation),
    },
    {
      id: "eligible-work",
      label: "Eligible Work",
      value: String(eligibleWork?.eligibleWorkItemCount ?? 0),
      tone: eligibleWork && eligibleWork.eligibleWorkItemCount > 0 ? "active" : "neutral",
      detail: eligibleWork?.eligibleWorkItemCount
        ? `${eligibleWork.eligibleWorkItemCount} ready`
        : "No ready items",
    },
    {
      id: "worktrees",
      label: "Threads",
      value: String(threads.totalCount),
      tone: threads.needsDecisionCount > 0
        ? "warn"
        : threads.activeCount > 0
          ? "active"
          : "neutral",
      detail: threadSignalDetail(threads),
    },
    {
      id: "blockers",
      label: "Blockers",
      value: String(blockers.length),
      tone: blockers.length > 0 ? "warn" : "good",
      detail: blockers.length > 0 ? "Needs attention" : "Clear",
    },
    {
      id: "plugins",
      label: "Plugins",
      value: String(plugins.enabledCount),
      tone: plugins.enabledCount > 0 ? "active" : "neutral",
      detail: plugins.capabilityCount > 0
        ? `${plugins.capabilityCount} ${plural(plugins.capabilityCount, "capability", "capabilities")}`
        : "No plugins",
    },
  ];
}

function threadSignalDetail(threads: NexusDashboardThreadSummary): string {
  if (threads.needsDecisionCount > 0) {
    return `${threads.needsDecisionCount} ${plural(threads.needsDecisionCount, "thread", "threads")} ${threads.needsDecisionCount === 1 ? "needs" : "need"} action`;
  }
  if (threads.forgetCandidateCount > 0) {
    return `${threads.forgetCandidateCount} ready to forget`;
  }
  if (threads.activeCount > 0) {
    return `${threads.activeCount} active`;
  }
  return "No open threads";
}

function automationDetail(automation: NexusAutomationStatus | null): string {
  if (!automation) {
    return "Status unavailable";
  }
  if (automation.status === "blocked" && /github|token|credential|auth/iu.test(automation.summary)) {
    return "GitHub auth blocked";
  }
  return compactDetail(automation.summary);
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}

function compactDetail(value: string): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function dashboardSummary(
  components: NexusDashboardComponentSummary[],
  automation: NexusAutomationStatus | null,
  eligibleWork: NexusEligibleWorkSummary | null,
  threads: NexusDashboardThreadSummary,
  blockers: string[],
): string {
  const readyCount = eligibleWork?.eligibleWorkItemCount ?? 0;
  return [
    `${components.length} ${plural(components.length, "component", "components")}`,
    readyCount > 0 ? `${readyCount} ready ${plural(readyCount, "item", "items")}` : "no ready items",
    `${threads.totalCount} ${plural(threads.totalCount, "thread", "threads")}`,
    threads.needsDecisionCount > 0
      ? `${threads.needsDecisionCount} ${plural(threads.needsDecisionCount, "thread", "threads")} ${threads.needsDecisionCount === 1 ? "needs" : "need"} action`
      : "threads current",
    blockers.length > 0 ? `${blockers.length} ${plural(blockers.length, "blocker", "blockers")}` : "no blockers",
    automation ? `automation ${automation.status}` : "automation unknown",
  ].join(", ");
}

function automationTone(status: string | undefined): NexusDashboardSignalTone {
  switch (status) {
    case "ready":
      return "good";
    case "locked":
    case "idle":
      return "active";
    case "blocked":
    case "backoff":
      return "warn";
    case "disabled":
      return "neutral";
    default:
      return "danger";
  }
}

function readTargetCycles(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusAutomationTargetCycleRecord[] {
  if (!projectConfig.automation) {
    return [];
  }
  try {
    return readNexusAutomationTargetCycleLedger(
      projectRoot,
      projectConfig.automation,
    ).cycles;
  } catch {
    return [];
  }
}

function readRuns(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusAutomationRunRecord[] {
  if (!projectConfig.automation) {
    return [];
  }
  try {
    return readNexusAutomationRunLedger(projectRoot, projectConfig.automation).runs;
  } catch {
    return [];
  }
}

function eligibleWorkItems(
  summary: NexusEligibleWorkSummary | null,
): Array<NexusEligibleWorkSummary["components"][number]["workItems"][number]> {
  return summary?.components.flatMap((component) => component.workItems) ?? [];
}

function capture<T>(producer: () => T): NexusDashboardDataResult<T> {
  try {
    return { ok: true, value: producer(), error: null };
  } catch (error) {
    return { ok: false, value: null, error: dataError(error) };
  }
}

async function captureAsync<T>(
  producer: () => Promise<T>,
): Promise<NexusDashboardDataResult<T>> {
  try {
    return { ok: true, value: await producer(), error: null };
  } catch (error) {
    return { ok: false, value: null, error: dataError(error) };
  }
}

function dataError(error: unknown): NexusDashboardDataError {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function latestIsoString(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length ? present.sort().at(-1) ?? null : null;
}

function nodeId(kind: string, id: string): string {
  return `${kind}:${id.replace(/[^A-Za-z0-9_.:-]+/gu, "-")}`;
}

function edgeId(from: string, to: string, kind: string): string {
  return `${from}->${to}:${kind}`;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nonEmptyString(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be non-empty`);
  }
  return trimmed;
}
