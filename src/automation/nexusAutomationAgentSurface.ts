import path from "node:path";
import {
  codexAppServerEndpointScope,
  type NexusAutomationAgentProfileExecutorMode,
  type NexusAutomationCodexAppServerSafetyHint,
  type NexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import { normalizeNexusAutomationAgentPolicy } from "./nexusAutomationAgentProfile.js";
import {
  getNexusAutomationStatus,
  type GetNexusAutomationStatusOptions,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import type {
  NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationEligibleWorkItems.js";
import {
  buildNexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  buildNexusExternalIssueVisibilitySummary,
  type NexusExternalIssueVisibilitySummary,
} from "../operations/nexusExternalIssueVisibility.js";
import {
  summarizeNexusAutomationWorkTrackers,
  type NexusAutomationWorkTrackerSummary,
} from "./nexusAutomationWorkTrackerSummary.js";
import {
  projectPluginCapabilityProjections,
  type NexusPluginCapabilityProjection,
} from "../project/nexusPluginCapabilities.js";
import { loadProjectConfig } from "../project/nexusProjectConfig.js";
import {
  buildNexusRunnerProfilePolicySummary,
  type NexusRunnerProfilePolicySummary,
} from "../remote-execution/nexusRunnerProfile.js";
import {
  buildNexusVersionPlanningSurface,
  type NexusVersionPlanningSurface,
  type NexusVersionPlanningSurfaceWorkItemInput,
  type NexusVersionPlanningWorkItemVersionScope,
} from "../operations/nexusVersionPlanningSurface.js";
import type { WorkItem, WorkTrackerRef } from "../work-items/workTrackingTypes.js";

export interface NexusAutomationProjectSummary {
  id: string;
  name: string;
}

export interface NexusAutomationEligibleWorkItemSummary {
  componentId: string;
  id: string;
  logicalItemId: string;
  title: string;
  status: WorkItem["status"];
  labels: string[];
  assignees: string[];
  milestone: string | null;
  updatedAt: string | null;
  webUrl: string | null;
  trackerRef: WorkTrackerRef | null;
  versionScopes?: NexusVersionPlanningWorkItemVersionScope[];
}

export interface NexusAutomationEligibleWorkComponentSummary {
  componentId: string;
  componentName: string;
  role: string;
  sourceRoot: string | null;
  workTrackingProvider: string | null;
  defaultTrackerId: string | null;
  workTrackers: NexusAutomationWorkTrackerSummary[];
  workItems: NexusAutomationEligibleWorkItemSummary[];
  staleInProgressWorkItems: NexusAutomationEligibleWorkItemSummary[];
}

export interface NexusAutomationEligibleWorkSummary {
  projectRoot: string;
  project: NexusAutomationProjectSummary;
  status: string;
  summary: string;
  selector: NexusAutomationConfig["selector"] | null;
  eligibleWorkItemCount: number;
  staleInProgressWorkItemCount: number;
  externalIssueVisibility: NexusExternalIssueVisibilitySummary;
  components: NexusAutomationEligibleWorkComponentSummary[];
  versionPlanning?: NexusVersionPlanningSurface;
}

export interface NexusAutomationAgentProfilePolicySummary {
  id: string;
  executor: string;
  executorMode: NexusAutomationAgentProfileExecutorMode | null;
  model: string | null;
  version: string | null;
  variant: string | null;
  reasoning: string | null;
  intelligence: string | null;
  intendedUse: string;
  safety: NexusAutomationConfig["safety"];
  commandConfigured: boolean;
  argsCount: number;
  appServer: NexusAutomationCodexAppServerPolicySummary | null;
}

export interface NexusAutomationCodexAppServerPolicySummary {
  mode: "connect" | "spawn";
  commandConfigured: boolean;
  argsCount: number;
  endpointScope: "loopback" | "non_loopback";
  ephemeralThreadDefault: boolean;
  allowNonLoopbackEndpoint: boolean;
  hostLocalSafetyHints: NexusAutomationCodexAppServerSafetyHint[];
}

export interface NexusAutomationAgentProfileSummary {
  projectRoot: string;
  project: NexusAutomationProjectSummary;
  automationEnabled: boolean;
  automationMode: NexusAutomationConfig["mode"] | null;
  coordinatorProfileId: string | null;
  maxConcurrentSubagents: number | null;
  safety: NexusAutomationConfig["safety"] | null;
  profiles: NexusAutomationAgentProfilePolicySummary[];
  runnerProfiles: NexusRunnerProfilePolicySummary[];
  pluginCapabilities: NexusPluginCapabilityProjection[];
}

type NexusStaleInProgressWorkItem = NonNullable<
  NonNullable<
    ReturnType<typeof buildNexusAutomationTargetReport>["workItemSummary"]
  >["progress"]["staleInProgressWork"]
>[number];

export async function getNexusAutomationEligibleWorkSummary(
  options: GetNexusAutomationStatusOptions,
): Promise<NexusAutomationEligibleWorkSummary> {
  const status = await getNexusAutomationStatus(options);
  const componentById = new Map(
    status.components.map((component) => [component.id, component]),
  );
  const grouped = groupedEligibleWorkItems(status);
  const targetReport = buildNexusAutomationTargetReport({
    projectRoot: status.projectRoot,
  });
  const staleInProgressWorkItems =
    targetReport.workItemSummary?.progress.staleInProgressWork ?? [];
  const summariesByComponent = new Map<
    string,
    NexusAutomationEligibleWorkComponentSummary
  >();
  addGroupedEligibleWorkItems({
    summariesByComponent,
    componentById,
    grouped,
  });
  addStaleInProgressWorkItems({
    summariesByComponent,
    componentById,
    staleInProgressWorkItems,
    fallbackComponentId: status.components[0]?.id ?? "primary",
  });

  const components = eligibleWorkComponents(summariesByComponent);
  const versionPlanning = buildNexusVersionPlanningSurface({
    projectConfig: status.projectConfig,
    components: status.components,
    workItems: components.flatMap((component) =>
      component.workItems.map((item) =>
        versionSurfaceWorkItemInput(component.componentId, item),
      )
    ),
    includeWorkItems: true,
    includeUnrelatedWorkItems: true,
  });
  attachVersionScopes(components, versionPlanning);

  return {
    projectRoot: status.projectRoot,
    project: {
      id: status.projectConfig.id,
      name: status.projectConfig.name,
    },
    status: status.status,
    summary: status.summary,
    selector: status.automationConfig?.selector ?? null,
    eligibleWorkItemCount: components.reduce(
      (total, component) => total + component.workItems.length,
      0,
    ),
    staleInProgressWorkItemCount: components.reduce(
      (total, component) => total + component.staleInProgressWorkItems.length,
      0,
    ),
    externalIssueVisibility:
      status.externalIssueVisibility ??
      buildNexusExternalIssueVisibilitySummary({
        components: status.components,
        componentEligibleWorkItems: grouped,
      }),
    components,
    ...(versionPlanning ? { versionPlanning } : {}),
  };
}

function groupedEligibleWorkItems(
  status: NexusAutomationStatus,
): NexusAutomationComponentEligibleWorkItems[] {
  if (status.componentEligibleWorkItems) {
    return status.componentEligibleWorkItems;
  }
  if (!status.selectedWorkItem) {
    return [];
  }
  return [
    {
      componentId: status.components[0]?.id ?? "primary",
      workItems: [status.selectedWorkItem],
    },
  ];
}

function addGroupedEligibleWorkItems(options: {
  summariesByComponent: Map<
    string,
    NexusAutomationEligibleWorkComponentSummary
  >;
  componentById: Map<string, NexusAutomationStatus["components"][number]>;
  grouped: NexusAutomationComponentEligibleWorkItems[];
}): void {
  for (const component of options.grouped) {
    if (component.workItems.length === 0) {
      continue;
    }
    ensureComponentSummary(
      options.summariesByComponent,
      options.componentById,
      component.componentId,
    ).workItems.push(
      ...component.workItems.map((item) =>
        summarizeEligibleWorkItem(component.componentId, item),
      ),
    );
  }
}

function addStaleInProgressWorkItems(options: {
  summariesByComponent: Map<
    string,
    NexusAutomationEligibleWorkComponentSummary
  >;
  componentById: Map<string, NexusAutomationStatus["components"][number]>;
  staleInProgressWorkItems: NexusStaleInProgressWorkItem[];
  fallbackComponentId: string;
}): void {
  for (const item of options.staleInProgressWorkItems) {
    const componentId = item.componentId ?? options.fallbackComponentId;
    ensureComponentSummary(
      options.summariesByComponent,
      options.componentById,
      componentId,
    ).staleInProgressWorkItems.push(
      summarizeStaleInProgressWorkItem(componentId, item),
    );
  }
}

function ensureComponentSummary(
  summariesByComponent: Map<
    string,
    NexusAutomationEligibleWorkComponentSummary
  >,
  componentById: Map<string, NexusAutomationStatus["components"][number]>,
  componentId: string,
): NexusAutomationEligibleWorkComponentSummary {
  const existing = summariesByComponent.get(componentId);
  if (existing) {
    return existing;
  }

  const resolved = componentById.get(componentId);
  const summary = {
    componentId,
    componentName: resolved?.name ?? componentId,
    role: resolved?.role ?? "primary",
    sourceRoot: resolved?.sourceRoot ?? null,
    workTrackingProvider: resolved?.workTracking?.provider ?? null,
    defaultTrackerId: resolved?.defaultTrackerId ?? null,
    workTrackers: resolved
      ? summarizeNexusAutomationWorkTrackers(resolved)
      : [],
    workItems: [],
    staleInProgressWorkItems: [],
  };
  summariesByComponent.set(componentId, summary);
  return summary;
}

function eligibleWorkComponents(
  summariesByComponent: Map<
    string,
    NexusAutomationEligibleWorkComponentSummary
  >,
): NexusAutomationEligibleWorkComponentSummary[] {
  return [...summariesByComponent.values()].filter(
    (component) =>
      component.workItems.length > 0 ||
      component.staleInProgressWorkItems.length > 0,
  );
}

function attachVersionScopes(
  components: NexusAutomationEligibleWorkComponentSummary[],
  versionPlanning: NexusVersionPlanningSurface | undefined,
): void {
  if (!versionPlanning?.workItems) {
    return;
  }

  const scopesByWorkItem = new Map(
    versionPlanning.workItems.map((item) => [
      `${item.componentId}\0${item.id}`,
      item.scopes,
    ]),
  );
  for (const component of components) {
    for (const item of component.workItems) {
      const scopes = scopesByWorkItem.get(
        `${component.componentId}\0${item.id}`,
      );
      if (scopes) {
        item.versionScopes = scopes;
      }
    }
  }
}

export function getNexusAutomationAgentProfileSummary(
  projectRoot: string,
): NexusAutomationAgentProfileSummary {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const projectConfig = loadProjectConfig(resolvedProjectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const agentPolicy = automationConfig
    ? normalizeNexusAutomationAgentPolicy(automationConfig)
    : null;

  return {
    projectRoot: resolvedProjectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    automationEnabled: automationConfig?.enabled ?? false,
    automationMode: automationConfig?.mode ?? null,
    coordinatorProfileId: agentPolicy?.coordinatorProfileId ?? null,
    maxConcurrentSubagents: agentPolicy?.maxConcurrentSubagents ?? null,
    safety: automationConfig?.safety ?? null,
    profiles:
      agentPolicy?.profiles.map((profile) => ({
        id: profile.id,
        executor: profile.executor,
        executorMode: summarizeExecutorMode(profile),
        model: profile.model,
        version: profile.version,
        variant: profile.variant,
        reasoning: profile.reasoning,
        intelligence: profile.intelligence,
        intendedUse: profile.intendedUse,
        safety: profile.safety,
        commandConfigured: profile.command !== null,
        argsCount: profile.args.length,
        appServer: profile.appServer
          ? {
              mode: profile.appServer.mode,
              commandConfigured: profile.appServer.command !== null,
              argsCount: profile.appServer.args.length,
              endpointScope: codexAppServerEndpointScope(
                profile.appServer.endpoint,
              ),
              ephemeralThreadDefault: profile.appServer.ephemeralThreadDefault,
              allowNonLoopbackEndpoint:
                profile.appServer.localPolicy.allowNonLoopbackEndpoint,
              hostLocalSafetyHints: [
                ...profile.appServer.localPolicy.hostLocalSafetyHints,
              ],
            }
          : null,
      })) ?? [],
    runnerProfiles: buildNexusRunnerProfilePolicySummary(
      projectConfig.runnerProfiles,
      projectConfig.hosts,
    ),
    pluginCapabilities: projectPluginCapabilityProjections(projectConfig),
  };
}

function summarizeExecutorMode(profile: {
  executor: string;
  executorMode?: NexusAutomationAgentProfileExecutorMode;
}): NexusAutomationAgentProfileExecutorMode | null {
  if (profile.executorMode) {
    return profile.executorMode;
  }
  return profile.executor.toLowerCase() === "codex" ? "exec" : null;
}

function summarizeEligibleWorkItem(
  componentId: string,
  item: WorkItem,
): NexusAutomationEligibleWorkItemSummary {
  return {
    componentId,
    id: item.id,
    logicalItemId: item.externalRef?.itemId ?? item.id,
    title: item.title,
    status: item.status,
    labels: item.labels ?? [],
    assignees: item.assignees ?? [],
    milestone: item.milestone ?? null,
    updatedAt: item.updatedAt ?? null,
    webUrl: item.webUrl ?? null,
    trackerRef: item.trackerRef ?? null,
  };
}

function summarizeStaleInProgressWorkItem(
  componentId: string,
  item: NexusStaleInProgressWorkItem,
): NexusAutomationEligibleWorkItemSummary {
  return {
    componentId,
    id: item.id,
    title: item.title ?? item.id,
    status: item.status ?? "in_progress",
    labels: [],
    assignees: [],
    milestone: null,
    updatedAt: null,
    webUrl: null,
    logicalItemId: item.id,
    trackerRef:
      item.trackerId && item.trackerProvider
        ? {
            trackerId: item.trackerId,
            provider: item.trackerProvider,
          }
        : null,
  };
}

function versionSurfaceWorkItemInput(
  componentId: string,
  item: NexusAutomationEligibleWorkItemSummary,
): NexusVersionPlanningSurfaceWorkItemInput {
  return {
    componentId,
    trackerId: item.trackerRef?.trackerId ?? null,
    trackerProvider: item.trackerRef?.provider ?? null,
    logicalItemId: item.logicalItemId,
    workItem: {
      id: item.id,
      title: item.title,
      status: item.status,
      provider: item.trackerRef?.provider ?? "local",
      labels: item.labels,
      assignees: item.assignees,
      milestone: item.milestone,
      updatedAt: item.updatedAt,
      webUrl: item.webUrl,
      ...(item.trackerRef ? { trackerRef: item.trackerRef } : {}),
      externalRef: {
        provider: item.trackerRef?.provider ?? "local",
        itemId: item.logicalItemId,
      },
    },
  };
}
