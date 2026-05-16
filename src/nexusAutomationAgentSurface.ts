import path from "node:path";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import { normalizeNexusAutomationAgentPolicy } from "./nexusAutomationAgentProfile.js";
import {
  getNexusAutomationStatus,
  type GetNexusAutomationStatusOptions,
} from "./nexusAutomationStatus.js";
import {
  projectPluginCapabilityProjections,
  type NexusPluginCapabilityProjection,
} from "./nexusPluginCapabilities.js";
import { loadProjectConfig } from "./nexusProjectConfig.js";
import type { WorkItem } from "./workTrackingTypes.js";

export interface NexusAutomationProjectSummary {
  id: string;
  name: string;
}

export interface NexusAutomationEligibleWorkItemSummary {
  componentId: string;
  id: string;
  title: string;
  status: WorkItem["status"];
  labels: string[];
  assignees: string[];
  milestone: string | null;
  updatedAt: string | null;
  webUrl: string | null;
}

export interface NexusAutomationEligibleWorkComponentSummary {
  componentId: string;
  componentName: string;
  role: string;
  sourceRoot: string | null;
  workTrackingProvider: string | null;
  workItems: NexusAutomationEligibleWorkItemSummary[];
}

export interface NexusAutomationEligibleWorkSummary {
  projectRoot: string;
  project: NexusAutomationProjectSummary;
  status: string;
  summary: string;
  selector: NexusAutomationConfig["selector"] | null;
  eligibleWorkItemCount: number;
  components: NexusAutomationEligibleWorkComponentSummary[];
}

export interface NexusAutomationAgentProfilePolicySummary {
  id: string;
  executor: string;
  model: string | null;
  version: string | null;
  variant: string | null;
  reasoning: string | null;
  intelligence: string | null;
  intendedUse: string;
  safety: NexusAutomationConfig["safety"];
  commandConfigured: boolean;
  argsCount: number;
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
  pluginCapabilities: NexusPluginCapabilityProjection[];
}

export async function getNexusAutomationEligibleWorkSummary(
  options: GetNexusAutomationStatusOptions,
): Promise<NexusAutomationEligibleWorkSummary> {
  const status = await getNexusAutomationStatus(options);
  const componentById = new Map(
    status.components.map((component) => [component.id, component]),
  );
  const grouped =
    status.componentEligibleWorkItems ??
    (status.selectedWorkItem
      ? [
          {
            componentId: status.components[0]?.id ?? "primary",
            workItems: [status.selectedWorkItem],
          },
        ]
      : []);
  const components = grouped
    .filter((component) => component.workItems.length > 0)
    .map((component) => {
      const resolved = componentById.get(component.componentId);
      return {
        componentId: component.componentId,
        componentName: resolved?.name ?? component.componentId,
        role: resolved?.role ?? "primary",
        sourceRoot: resolved?.sourceRoot ?? null,
        workTrackingProvider: resolved?.workTracking?.provider ?? null,
        workItems: component.workItems.map((item) =>
          summarizeEligibleWorkItem(component.componentId, item),
        ),
      };
    });

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
    components,
  };
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
        model: profile.model,
        version: profile.version,
        variant: profile.variant,
        reasoning: profile.reasoning,
        intelligence: profile.intelligence,
        intendedUse: profile.intendedUse,
        safety: profile.safety,
        commandConfigured: profile.command !== null,
        argsCount: profile.args.length,
      })) ?? [],
    pluginCapabilities: projectPluginCapabilityProjections(projectConfig),
  };
}

function summarizeEligibleWorkItem(
  componentId: string,
  item: WorkItem,
): NexusAutomationEligibleWorkItemSummary {
  return {
    componentId,
    id: item.id,
    title: item.title,
    status: item.status,
    labels: item.labels ?? [],
    assignees: item.assignees ?? [],
    milestone: item.milestone ?? null,
    updatedAt: item.updatedAt ?? null,
    webUrl: item.webUrl ?? null,
  };
}
