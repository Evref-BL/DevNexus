import path from "node:path";
import {
  defaultGitRunner,
  type GitRunner,
} from "./gitWorktreeService.js";
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
  getNexusEligibleWorkSummary,
  type NexusEligibleWorkSummary,
  type NexusEligibleWorkMode,
} from "./nexusEligibleWorkSummary.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
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

export interface NexusDashboardEvent {
  id: string;
  time: string;
  source: NexusDashboardEventSource;
  severity: NexusDashboardEventSeverity;
  title: string;
  body: string;
  relatedNodeIds: string[];
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
  publication: NexusDashboardPublicationSummary[];
  authority: NexusDashboardAuthoritySummary | null;
  blockers: string[];
  events: NexusDashboardEvent[];
  weave: NexusDashboardWeave;
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
  const cycles = readTargetCycles(projectRoot, projectConfig);
  const runs = readRuns(projectRoot, projectConfig);
  const worktrees = summarizeWorktrees(worktreeCollection.value);
  const publication = summarizePublication(automation.value);
  const authority = summarizeAuthority(
    automation.value?.authority ?? targetReport.value?.authority ?? null,
  );
  const blockers = dashboardBlockers({
    automation,
    eligibleWork,
    targetReport,
    worktreeWarnings: worktrees.warnings,
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
  });

  return {
    version: 1,
    generatedAt,
    projectRoot,
    project: projectSummary(projectRoot, projectConfig, componentSummaries),
    summary: dashboardSummary(componentSummaries, automation.value, eligibleWork.value, worktrees, blockers),
    signals: dashboardSignals(componentSummaries, automation.value, eligibleWork.value, worktrees, blockers),
    components: componentSummaries,
    automation,
    eligibleWork,
    targetReport,
    worktrees,
    publication,
    authority,
    blockers,
    events,
    weave,
  };
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
}): NexusDashboardWeave {
  const lanes: NexusDashboardWeaveLane[] = [
    { id: "project", label: "Project", nodeIds: [] },
    { id: "components", label: "Components", nodeIds: [] },
    { id: "work", label: "Work", nodeIds: [] },
    { id: "branches", label: "Branches", nodeIds: [] },
    { id: "cycles", label: "Cycles", nodeIds: [] },
    { id: "authority", label: "Authority", nodeIds: [] },
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
    href: null,
  });

  for (const component of options.components) {
    const componentNodeId = nodeId("component", component.id);
    addNode({
      id: componentNodeId,
      kind: "component",
      laneId: "components",
      label: component.name,
      detail: `${component.role} component`,
      status: component.sourceRootExists ? "ready" : "missing",
      timestamp: null,
      href: null,
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
    addNode({
      id: workItemNodeId,
      kind: "work-item",
      laneId: "work",
      label: item.title,
      detail: item.id,
      status: item.status,
      timestamp: item.updatedAt,
      href: item.webUrl,
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
    addNode({
      id: worktreeNodeId,
      kind: "worktree",
      laneId: "branches",
      label: worktree.branchName ?? worktree.id,
      detail: `${worktree.effectiveStatus} on ${worktree.hostId}`,
      status: worktree.effectiveStatus,
      timestamp: worktree.updatedAt,
      href: null,
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
    addNode({
      id: cycleNodeId,
      kind: "target-cycle",
      laneId: "cycles",
      label: cycle.id,
      detail: cycle.summary ?? cycle.status,
      status: cycle.status,
      timestamp: cycle.finishedAt ?? cycle.startedAt,
      href: null,
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
      addNode({
        id: workItemNodeId,
        kind: "work-item",
        laneId: "work",
        label: item.title ?? item.id,
        detail: item.id,
        status: cycleStatus,
        timestamp: cycle.finishedAt ?? cycle.startedAt,
        href: null,
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
    addNode({
      id: runNodeId,
      kind: "run",
      laneId: "cycles",
      label: run.id,
      detail: run.summary ?? run.status,
      status: run.status,
      timestamp: run.finishedAt ?? run.startedAt,
      href: null,
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
      label: "Bot permissions",
      detail: authorityDashboardSummary(options.authority),
      status: options.authority.blockedActionCount > 0 ? "blocked" : "ready",
      timestamp: null,
      href: null,
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
    addNode({
      id: blockerNodeId,
      kind: "blocker",
      laneId: "authority",
      label: "Blocker",
      detail: blocker,
      status: "blocked",
      timestamp: null,
      href: null,
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
    return `${blocked} provider ${plural(blocked, "action", "actions")} blocked. The automation bot needs a human handoff for publication.`;
  }
  if (fallbacks > 0) {
    return `${fallbacks} provider ${plural(fallbacks, "action", "actions")} use handoff instead of direct automation.`;
  }
  return `Publication permissions are ready for ${componentCount} ${plural(componentCount, "component", "components")}.`;
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
  worktreeWarnings: string[];
}): string[] {
  const blockers = [
    ...(options.automation.ok ? [] : [`Automation status unavailable: ${options.automation.error?.message ?? "unknown error"}`]),
    ...(options.eligibleWork.ok ? [] : [`Eligible work unavailable: ${options.eligibleWork.error?.message ?? "unknown error"}`]),
    ...(options.targetReport.ok ? [] : [`Target report unavailable: ${options.targetReport.error?.message ?? "unknown error"}`]),
    ...(options.automation.value?.eligibleWorkBlockers ?? []),
    ...(options.eligibleWork.value?.blockers ?? []),
    ...(options.targetReport.value?.blockers ?? []),
    ...options.worktreeWarnings,
  ];
  return [...new Set(blockers)].slice(0, 20);
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
    },
  ];

  if (options.automation) {
    events.push({
      id: "automation-status",
      time: options.generatedAt,
      source: "actual",
      severity: options.automation.status === "blocked" ? "warning" : "info",
      title: `Automation ${options.automation.status}`,
      body: compactDetail(options.automation.summary),
      relatedNodeIds: ["project"],
    });
  }

  if (options.eligibleWork) {
    events.push({
      id: "eligible-work",
      time: options.generatedAt,
      source: "actual",
      severity: options.eligibleWork.eligibleWorkItemCount > 0 ? "success" : "info",
      title: `${options.eligibleWork.eligibleWorkItemCount} ready ${plural(options.eligibleWork.eligibleWorkItemCount, "item", "items")}`,
      body: compactDetail(options.eligibleWork.summary),
      relatedNodeIds: ["project"],
    });
  }

  for (const cycle of options.cycles.slice(-8).reverse()) {
    events.push({
      id: `target-cycle-${cycle.id}`,
      time: cycle.finishedAt ?? cycle.startedAt,
      source: "actual",
      severity: cycle.status === "blocked" || cycle.status === "failed" ? "warning" : "info",
      title: `Target cycle ${cycle.status}`,
      body: cycle.summary ?? cycle.id,
      relatedNodeIds: [nodeId("target-cycle", cycle.id)],
    });
  }

  for (const run of options.runs.slice(-5).reverse()) {
    events.push({
      id: `run-${run.id}`,
      time: run.finishedAt ?? run.startedAt,
      source: "actual",
      severity: run.status === "failed" || run.status === "blocked" ? "warning" : "info",
      title: `Run ${run.status}`,
      body: run.summary ?? run.id,
      relatedNodeIds: [nodeId("run", run.id)],
    });
  }

  for (const worktree of options.worktrees.records.slice(0, 8)) {
    events.push({
      id: `worktree-${worktree.id}`,
      time: worktree.updatedAt,
      source: "actual",
      severity: worktree.stale ? "warning" : "info",
      title: `Worktree ${worktree.effectiveStatus}`,
      body: `${worktree.branchName ?? worktree.id} on ${worktree.hostId}`,
      relatedNodeIds: [nodeId("worktree", worktree.id)],
    });
  }

  options.blockers.slice(0, 8).forEach((blocker, index) => {
    events.push({
      id: `blocker-${index}`,
      time: options.generatedAt,
      source: "warning",
      severity: "warning",
      title: "Active blocker",
      body: compactDetail(blocker),
      relatedNodeIds: [nodeId("blocker", String(index))],
    });
  });

  return events;
}

function dashboardSignals(
  components: NexusDashboardComponentSummary[],
  automation: NexusAutomationStatus | null,
  eligibleWork: NexusEligibleWorkSummary | null,
  worktrees: NexusDashboardWorktreeSummary,
  blockers: string[],
): NexusDashboardSignal[] {
  const dirtyComponents = components.filter((component) => component.git?.dirty).length;
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
      label: "Worktrees",
      value: String(worktrees.activeCount),
      tone: worktrees.activeCount > 0 ? "active" : "neutral",
      detail: worktrees.staleCount > 0
        ? `${worktrees.staleCount} stale ${plural(worktrees.staleCount, "lease", "leases")}`
        : "Current",
    },
    {
      id: "blockers",
      label: "Blockers",
      value: String(blockers.length),
      tone: blockers.length > 0 ? "warn" : "good",
      detail: blockers.length > 0 ? "Needs attention" : "Clear",
    },
    {
      id: "git",
      label: "Dirty Components",
      value: String(dirtyComponents),
      tone: dirtyComponents > 0 ? "warn" : "good",
      detail: dirtyComponents > 0 ? `${dirtyComponents} dirty` : "Clean",
    },
  ];
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
  worktrees: NexusDashboardWorktreeSummary,
  blockers: string[],
): string {
  const readyCount = eligibleWork?.eligibleWorkItemCount ?? 0;
  return [
    `${components.length} ${plural(components.length, "component", "components")}`,
    readyCount > 0 ? `${readyCount} ready ${plural(readyCount, "item", "items")}` : "no ready items",
    `${worktrees.activeCount} ${plural(worktrees.activeCount, "worktree", "worktrees")}`,
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
