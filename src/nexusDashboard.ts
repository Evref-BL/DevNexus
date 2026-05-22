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
  type NexusWorktreeLeaseCollection,
  type NexusWorktreeLeaseSummary,
} from "./nexusWorktreeLease.js";

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
  componentId: string;
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
  | "review"
  | "archive"
  | "forget"
  | "rescue";

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
  records: NexusDashboardThreadRecord[];
}

export interface NexusDashboardPluginRecord {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  capabilityCount: number;
  projectedSkillCount: number;
  mcpServerCount: number;
  setupActionCount: number;
  dependencyProjectionCount: number;
}

export interface NexusDashboardPluginSummary {
  totalCount: number;
  enabledCount: number;
  capabilityCount: number;
  records: NexusDashboardPluginRecord[];
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
  publication: NexusDashboardPublicationSummary[];
  authority: NexusDashboardAuthoritySummary | null;
  blockers: string[];
  events: NexusDashboardEvent[];
  weave: NexusDashboardWeave;
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
}

export interface NexusDashboardHostWorkspaceRecord {
  id: string;
  name: string;
  root: string;
  registered: boolean;
  current: boolean;
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
  updatedAt: string | null;
  error: NexusDashboardDataError | null;
}

export type NexusDashboardHostActionKind =
  | "workspace-error"
  | "approval"
  | "blocker"
  | "thread"
  | "dirty";

export interface NexusDashboardHostPrimaryAction {
  label: string;
  kind: "open-workspace" | "review" | "rescue";
  workspaceId: string;
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
  generatedAt: string;
  homePath: string;
  homeError: NexusDashboardDataError | null;
  currentProjectRoot: string | null;
  workspaceCount: number;
  needsAttentionCount: number;
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
  const worktrees = summarizeWorktrees(worktreeCollection.value);
  const plugins = summarizePlugins(projectConfig);
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
  );
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
    publication,
    authority,
    blockers,
    events,
    weave,
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
  const currentProjectRoot = options.projectRoot
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

  return {
    version: 1,
    generatedAt,
    homePath,
    homeError: home.error,
    currentProjectRoot,
    workspaceCount: workspaces.length,
    needsAttentionCount: workspaces.filter((workspace) =>
      dashboardHostWorkspaceNeedsAttention(workspace),
    ).length,
    actionQueue,
    workspaces,
  };
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
    const worktreeCollection = capture(() =>
      listNexusWorktreeLeases({
        projectRoot: root,
        includeProjectMeta: true,
        now: options.now,
      }),
    );
    const runs = readRuns(root, projectConfig);
    const worktrees = summarizeWorktrees(worktreeCollection.value);
    const threads = summarizeThreads(
      worktrees,
      providerUrls,
      [],
      runs,
    );
    const plugins = summarizePlugins(projectConfig);
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
  const updatedAt = latestIsoString([
    ...value.threads.records.map((thread) => thread.updatedAt),
    generatedAt,
  ]);
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
      eligibleWorkCount: eligibleWork.value?.eligibleWorkItemCount ?? null,
    }),
    tone: dashboardHostWorkspaceTone({
      automationStatus: automation.value?.status ?? null,
      blockerCount,
      dirtyComponentCount: value.dirtyComponentCount,
      needsDecisionCount: value.threads.needsDecisionCount,
      threadCount: value.threads.totalCount,
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
    eligibleWorkCount: eligibleWork.value?.eligibleWorkItemCount ?? null,
    updatedAt,
    error: null,
  };
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
    ? `${value.threads.needsDecisionCount} need review`
    : "no review needed";
  const dirty = value.dirtyComponentCount > 0
    ? `${value.dirtyComponentCount} dirty`
    : "clean";
  const warnings = value.warningCount > 0
    ? `${value.warningCount} warnings`
    : "no warnings";
  const approvals = value.approvalCount > 0
    ? `${value.approvalCount} approvals`
    : "no approvals";
  const blockers = value.blockerCount > 0
    ? `${value.blockerCount} blockers`
    : "no blockers";
  const ready = value.eligibleWorkCount && value.eligibleWorkCount > 0
    ? `${value.eligibleWorkCount} ready`
    : "no ready work";
  return `${value.componentSummaries.length} components, ${value.threads.totalCount} active threads, ${review}, ${approvals}, ${blockers}, ${dirty}, ${ready}, ${warnings}, ${value.plugins.enabledCount} plugins`;
}

function dashboardHostWorkspaceTone(options: {
  automationStatus: string | null;
  blockerCount: number;
  dirtyComponentCount: number;
  needsDecisionCount: number;
  threadCount: number;
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
  if (options.threadCount > 0 || options.automationStatus === "ready") {
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
      updatedAt: workspace.updatedAt ?? workspace.generatedAt,
      primaryAction: {
        label,
        kind: kind === "dirty" ? "rescue" : "review",
        workspaceId: workspace.id,
      },
      providerAction: null,
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
      `${workspace.needsDecisionCount} ${plural(workspace.needsDecisionCount, "thread", "threads")} need review`,
      "Unfinished work needs continue, archive, forget, or rescue.",
      workspace.staleThreadCount > 0 ? "stale threads" : "review needed",
      "warn",
      "Review threads",
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

function summarizeThreads(
  worktrees: NexusDashboardWorktreeSummary,
  providerUrls: NexusDashboardProviderUrls,
  cleanupCandidates: NexusCleanupCandidate[],
  runs: NexusAutomationRunRecord[],
): NexusDashboardThreadSummary {
  const matchedCleanupIds = new Set<string>();
  const assistantThreads = assistantThreadIndex(runs);
  const leaseRecords = worktrees.records
    .map((worktree): NexusDashboardThreadRecord => {
      const cleanup = cleanupCandidateForThread(cleanupCandidates, worktree);
      if (cleanup) {
        matchedCleanupIds.add(cleanup.id);
      }
      const decision = threadDecision(worktree, cleanup);
      const actions = providerActionsFromText(
        `${worktree.workItemId ?? ""} ${worktree.branchName ?? ""} ${worktree.id}`,
        providerUrls,
        worktree.componentId,
      );
      const assistantThread = assistantThreadForWork({
        index: assistantThreads,
        componentId: worktree.componentId,
        workItemId: worktree.workItemId,
        branchName: worktree.branchName,
      });
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
  const records = uniqueThreadRecords([...leaseRecords, ...cleanupRecords]).sort((left, right) => {
    const priority = threadDecisionPriority(left.decision) - threadDecisionPriority(right.decision);
    return priority !== 0 ? priority : right.updatedAt.localeCompare(left.updatedAt);
  });

  const needsDecision = records.filter((record) =>
    ["review", "archive", "rescue"].includes(record.decision),
  );
  return {
    totalCount: records.length,
    activeCount: records.filter((record) => record.decision === "continue").length,
    needsDecisionCount: needsDecision.length,
    archiveCandidateCount: records.filter((record) => record.decision === "archive").length,
    forgetCandidateCount: records.filter((record) => record.decision === "forget").length,
    records,
  };
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
  const decision = cleanupThreadDecision(candidate);
  const actionText = `${candidate.branch ?? ""} ${candidate.id}`;
  const assistantThread = assistantThreadForWork({
    index: assistantThreads,
    componentId: candidate.componentId,
    workItemId: candidate.lease?.workItemId ?? null,
    branchName: candidate.branch,
  });
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
  if (candidate.safeToDelete) {
    return "forget";
  }
  if (candidate.rescue.needed) {
    return "rescue";
  }
  return "review";
}

function threadDecision(
  worktree: NexusDashboardWorktreeSummary["records"][number],
  cleanup: NexusCleanupCandidate | null,
): NexusDashboardThreadDecision {
  const status = worktree.effectiveStatus || worktree.status;
  if (worktree.dirty) {
    return "rescue";
  }
  if (cleanup?.safeToDelete) {
    return "forget";
  }
  if (status === "abandoned") {
    return "archive";
  }
  if (
    worktree.stale ||
    status === "stale" ||
    status === "blocked" ||
    status === "ready" ||
    status === "merged"
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
    case "forget":
      return "Forget";
    case "rescue":
      return "Rescue";
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
    case "forget":
      return "Clean merged work can leave the active cockpit after cleanup proof.";
    case "rescue":
      return "Local changes need inspection before this can be archived or forgotten.";
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
    case "review":
      return 1;
    case "continue":
      return 2;
    case "archive":
      return 3;
    case "forget":
      return 4;
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

function summarizePlugins(
  projectConfig: NexusProjectConfig,
): NexusDashboardPluginSummary {
  const projections = projectPluginCapabilityProjections(projectConfig);
  const records = projections.map(pluginDashboardRecord);
  return {
    totalCount: records.length,
    enabledCount: records.filter((record) => record.enabled).length,
    capabilityCount: records.reduce((count, record) => count + record.capabilityCount, 0),
    records,
  };
}

function pluginDashboardRecord(
  plugin: NexusPluginCapabilityProjection,
): NexusDashboardPluginRecord {
  return {
    id: plugin.pluginId,
    name: plugin.pluginName ?? plugin.pluginId,
    version: plugin.version,
    enabled: true,
    capabilityCount: plugin.capabilityCount,
    projectedSkillCount: plugin.capabilities.filter((capability) => capability.kind === "projected_skill").length,
    mcpServerCount: plugin.capabilities.filter((capability) => capability.kind === "mcp_server").length,
    setupActionCount: plugin.capabilities.filter((capability) =>
      capability.kind === "setup_obligation" ||
      capability.kind === "environment_hint" ||
      capability.kind === "cleanup_hook",
    ).length,
    dependencyProjectionCount: plugin.capabilities.filter((capability) => capability.kind === "dependency_projection").length,
  };
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
    return `${threads.needsDecisionCount} needs review`;
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
      ? `${threads.needsDecisionCount} need review`
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
