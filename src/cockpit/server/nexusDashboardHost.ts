
import os from "node:os";
import path from "node:path";
import { defaultGitRunner } from "../../worktrees/gitWorktreeService.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "../../project/nexusHomeConfig.js";
import { getNexusAutomationStatus, type NexusAutomationStatus } from "../../automation/nexusAutomationStatus.js";
import { getNexusEligibleWorkSummary, type NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import { loadProjectConfig } from "../../project/nexusProjectConfig.js";
import { resolveProjectComponents, samePath } from "../../project/nexusProjectLifecycle.js";
import type { NexusProjectReference } from "../../project/nexusProjectRegistry.js";
import { listNexusWorktreeLeases } from "../../worktrees/nexusWorktreeLease.js";
import { readNexusDashboardThreadResolutionStore } from "./nexusDashboardThreadResolution.js";
import {
  dashboardProviderUrls,
  providerActionsForHref,
  providerActionsFromText,
  uniqueProviderActions,
} from "./nexusDashboardProviderActions.js";
import type { NexusDashboardProviderAction, NexusDashboardProviderUrls } from "./nexusDashboardProviderActions.js";
import type {
  BuildNexusDashboardHostSnapshotOptions,
  NexusDashboardContractScope,
  NexusDashboardComponentSummary,
  NexusDashboardEmbeddingContract,
  NexusDashboardHostActionItem,
  NexusDashboardHostActionKind,
  NexusDashboardHostSnapshot,
  NexusDashboardHostWorkspaceRecord,
  NexusDashboardPluginSummary,
  NexusDashboardSignalTone,
  NexusDashboardThreadSummary,
} from "./nexusDashboardTypes.js";
import {
  capture,
  captureAsync,
  isoString,
  latestIsoString,
  nonEmptyString,
  plural,
  uniqueNonEmptyStrings,
} from "./nexusDashboardModelUtils.js";
import { statusOptions } from "./nexusDashboardStatusOptions.js";
import { projectSummary, summarizeComponent } from "./nexusDashboardProjectModel.js";
import { summarizeWorktrees } from "./nexusDashboardWorktreeModel.js";
import { summarizeThreads } from "./nexusDashboardThreadModel.js";
import { summarizePlugins } from "./nexusDashboardPluginModel.js";
import { readRuns, summarizeAuthority } from "./nexusDashboardAutomationModel.js";

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
  const cockpitEndpoint = hostMode
    ? "/api/cockpit?workspace=:workspaceId"
    : "/api/cockpit";
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
        endpoint: options.scope === "host" ? "/api/host" : cockpitEndpoint,
        owner: "dev-nexus",
        defaultPayload: true,
        action: "read",
      },
      selectedWorkspaceSnapshot: {
        field: "project",
        endpoint: cockpitEndpoint,
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
        endpoint: options.scope === "host" ? "/api/host" : cockpitEndpoint,
        owner: "provider",
        defaultPayload: true,
        action: "open-provider",
      },
      plugins: {
        field: options.scope === "host" ? "workspaces[].pluginCount" : "plugins",
        endpoint: options.scope === "host" ? "/api/host" : cockpitEndpoint,
        owner: "dev-nexus",
        defaultPayload: true,
        action: "read",
      },
      threadActions: {
        field: options.scope === "host"
          ? "workspaces[].needsDecisionCount"
          : "threads.records",
        endpoint: options.scope === "host" ? "/api/host" : cockpitEndpoint,
        owner: "assistant-provider",
        defaultPayload: true,
        action: "start-chat",
      },
      trackedWork: {
        field: options.scope === "host"
          ? "workspaces[].eligibleWorkCount"
          : "trackedWork",
        endpoint: options.scope === "host" ? "/api/host" : cockpitEndpoint,
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
      cockpit: cockpitEndpoint,
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
        ? "/api/cockpit/thread-action?workspace=:workspaceId"
        : "/api/cockpit/thread-action",
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
    const plugins = summarizePlugins(root, projectConfig);
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
        ...statusOptions(options, root, gitRunner),
      }),
    ),
    captureAsync(() =>
      getNexusEligibleWorkSummary({
        ...statusOptions(options, root, gitRunner),
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
