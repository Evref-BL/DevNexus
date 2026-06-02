import path from "node:path";
import { buildNexusAutomationTargetReport } from "../../automation/nexusAutomationTargetReport.js";
import { buildNexusCleanupPlan } from "../../operations/nexusCleanupPlan.js";
import { loadProjectConfig } from "../../project/nexusProjectConfig.js";
import { resolveProjectComponents } from "../../project/nexusProjectLifecycle.js";
import { getNexusAutomationStatus } from "../../automation/nexusAutomationStatus.js";
import { getNexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import { defaultGitRunner } from "../../worktrees/gitWorktreeService.js";
import { listNexusWorktreeLeases } from "../../worktrees/nexusWorktreeLease.js";
import { readNexusDashboardThreadResolutionStore } from "./nexusDashboardThreadResolution.js";
import { summarizeGitHistory } from "./nexusDashboardGitHistory.js";
import { summarizeGitWorkflows } from "./nexusDashboardGitWorkflows.js";
import { summarizeFeatures } from "./nexusDashboardFeatures.js";
import type {
  BuildNexusDashboardSnapshotOptions,
  NexusDashboardSnapshot,
  NexusDashboardWorkspaceSectionId,
  NexusDashboardWorkspaceSectionPayload,
} from "./nexusDashboardTypes.js";
import { dashboardProviderUrls } from "./nexusDashboardProviderActions.js";
import { nexusDashboardEmbeddingContract } from "./nexusDashboardHost.js";
import { buildNexusDashboardWeave } from "./nexusDashboardWeaveModel.js";
import { statusOptions } from "./nexusDashboardStatusOptions.js";
import {
  projectSummary,
  summarizeComponent,
  summarizeComponentShell,
  summarizeWorkspaceGitHistoryComponent,
} from "./nexusDashboardProjectModel.js";
import {
  dashboardShellSignals,
  emptyGitHistorySummary,
  emptyThreadSummary,
  emptyTrackedWorkSummary,
  emptyWorktreeSummary,
  pendingDashboardResult,
  workspaceShellWeave,
} from "./nexusDashboardShellModel.js";
import { summarizeWorktrees } from "./nexusDashboardWorktreeModel.js";
import { summarizeThreads } from "./nexusDashboardThreadModel.js";
import { summarizeConfiguredPlugins, summarizePlugins } from "./nexusDashboardPluginModel.js";
import {
  dashboardBlockers,
  readRuns,
  readTargetCycles,
  summarizeAuthority,
  summarizePublication,
} from "./nexusDashboardAutomationModel.js";
import { summarizeLocalTrackedWork, summarizeTrackedWork } from "./nexusDashboardTrackedWorkModel.js";
import { buildDashboardEvents } from "./nexusDashboardEvents.js";
import { dashboardSignals, dashboardSummary } from "./nexusDashboardSignals.js";
import { capture, captureAsync, isoString, nonEmptyString } from "./nexusDashboardModelUtils.js";

export {
  buildNexusDashboardHostActionQueue,
  buildNexusDashboardHostProjectIndex,
  buildNexusDashboardHostSnapshot,
  nexusDashboardHostWorkspaceReferenceMatches,
} from "./nexusDashboardHost.js";
export { buildNexusDashboardWeave } from "./nexusDashboardWeaveModel.js";
export { nexusDashboardEmbeddingContract } from "./nexusDashboardHost.js";

export {
  emptyNexusDashboardThreadResolutionStore,
  nexusDashboardThreadResolutionStorePath,
  readNexusDashboardThreadResolutionStore,
  recordNexusDashboardThreadResolution,
  threadRecordKey,
  writeNexusDashboardThreadResolutionStore,
} from "./nexusDashboardThreadResolution.js";
export type {
  NexusDashboardThreadResolutionAction,
  NexusDashboardThreadResolutionRecord,
  NexusDashboardThreadResolutionStore,
} from "./nexusDashboardThreadResolution.js";
export type {
  NexusDashboardGitHistoryCommit,
  NexusDashboardGitHistoryRef,
  NexusDashboardGitHistoryRefKind,
  NexusDashboardGitHistoryRepository,
  NexusDashboardGitHistorySummary,
} from "./nexusDashboardGitHistory.js";
export type {
  NexusDashboardProviderAction,
  NexusDashboardProviderActionKind,
} from "./nexusDashboardProviderActions.js";
export type {
  NexusDashboardSignalTone,
  NexusDashboardEventSource,
  NexusDashboardEventSeverity,
  NexusDashboardWeaveNodeKind,
  NexusDashboardWeaveEdgeKind,
  NexusDashboardContractScope,
  NexusDashboardContractOwner,
  NexusDashboardContractSurfaceId,
  NexusDashboardContractSurface,
  NexusDashboardContractSelection,
  NexusDashboardEmbeddingContract,
  BuildNexusDashboardSnapshotOptions,
  NexusDashboardDataError,
  NexusDashboardDataResult,
  NexusDashboardSignal,
  NexusDashboardGitState,
  NexusDashboardComponentSummary,
  NexusDashboardProjectSummary,
  NexusDashboardPublicationSummary,
  NexusDashboardAuthoritySummary,
  NexusDashboardWorktreeSummary,
  NexusDashboardThreadDecision,
  NexusDashboardThreadRecord,
  NexusDashboardThreadSummary,
  NexusDashboardPluginRecord,
  NexusDashboardPluginSummary,
  NexusDashboardTrackedWorkKind,
  NexusDashboardTrackedWorkItem,
  NexusDashboardTrackedWorkSummary,
  NexusDashboardFeatureStatus,
  NexusDashboardFeatureRecord,
  NexusDashboardFeatureSummary,
  NexusDashboardEvent,
  NexusDashboardWeaveLane,
  NexusDashboardWeaveNode,
  NexusDashboardWeaveEdge,
  NexusDashboardWeave,
  NexusDashboardSnapshot,
  NexusDashboardWorkspaceSectionId,
  NexusDashboardWorkspaceSectionPayload,
  BuildNexusDashboardHostSnapshotOptions,
  NexusDashboardHostActionKind,
  NexusDashboardHostWorkspaceRecord,
  NexusDashboardHostPrimaryAction,
  NexusDashboardHostActionItem,
  NexusDashboardHostSnapshot,
} from "./nexusDashboardTypes.js";

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
  const workspaceHistory = summarizeWorkspaceGitHistoryComponent(
    projectRoot,
    projectConfig,
    componentSummaries,
    gitRunner,
  );
  const history = summarizeGitHistory({
    components: componentSummaries,
    defaultBranch: projectConfig.repo.defaultBranch,
    gitRunner,
    branches: options.historyBranches,
    maxCommits: options.historyMaxCommits,
    workspace: workspaceHistory,
  });
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
  const plugins = summarizePlugins(projectRoot, projectConfig);
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
  const gitWorkflows = summarizeGitWorkflows(projectRoot, projectConfig);
  const features = summarizeFeatures({
    projectRoot,
    projectConfig,
    history,
    worktrees,
    threads,
  });
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
    history,
    automation,
    eligibleWork,
    targetReport,
    worktrees,
    threads,
    features,
    gitWorkflows,
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
  const history = emptyGitHistorySummary();
  const features = summarizeFeatures({
    projectRoot,
    projectConfig,
    history,
    worktrees: emptyWorktreeSummary(),
    threads: emptyThreadSummary(),
  });
  const gitWorkflows = summarizeGitWorkflows(projectRoot, projectConfig);

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
    history,
    automation: pendingDashboardResult("Loading automation status."),
    eligibleWork: pendingDashboardResult("Loading tracked work."),
    targetReport: pendingDashboardResult("Loading target report."),
    worktrees: emptyWorktreeSummary(),
    threads: emptyThreadSummary(),
    features,
    gitWorkflows,
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
    const workspaceHistory = summarizeWorkspaceGitHistoryComponent(
      projectRoot,
      projectConfig,
      componentSummaries,
      gitRunner,
    );
    const history = summarizeGitHistory({
      components: componentSummaries,
      defaultBranch: projectConfig.repo.defaultBranch,
      gitRunner,
      branches: options.historyBranches,
      maxCommits: options.historyMaxCommits,
      workspace: workspaceHistory,
    });
    return {
      version: 1,
      generatedAt,
      projectRoot,
      section,
      patch: {
        ...basePatch,
        components: componentSummaries,
        history,
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
        plugins: summarizePlugins(projectRoot, projectConfig),
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
    const features = summarizeFeatures({
      projectRoot,
      projectConfig,
      history: emptyGitHistorySummary(),
      worktrees,
      threads,
    });
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
        features,
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
