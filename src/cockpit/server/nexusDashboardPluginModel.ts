
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import {
  listDevNexusPluginCatalogue,
  nexusPluginCatalogueRefreshCommand,
  projectPluginCapabilityProjections,
  type NexusPluginCatalogueEntry,
  type NexusPluginCapabilityProjection,
} from "../../project/nexusPluginCapabilities.js";
import type {
  NexusDashboardPluginRecord,
  NexusDashboardPluginSummary,
} from "./nexusDashboardTypes.js";

type DashboardPluginCapability =
  | NexusPluginCapabilityProjection["capabilities"][number]
  | NonNullable<NexusProjectConfig["plugins"]>[number]["capabilities"][number];

export function summarizePlugins(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusDashboardPluginSummary {
  const configured = summarizeConfiguredPlugins(projectConfig);
  const configuredRecords = configured.records;
  const configuredKeys = new Set(
    configuredRecords.flatMap((record) => pluginRecordKeys(record)),
  );
  const availableRecords = listDevNexusPluginCatalogue()
    .filter((candidate) =>
      pluginRecordKeys(candidate).every((key) => !configuredKeys.has(key))
    )
    .map((candidate) => cataloguePluginDashboardRecord(projectRoot, candidate));
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

export function summarizeConfiguredPlugins(
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
    repositoryUrl: null,
    configExportName: null,
    installCommand: null,
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

function cataloguePluginDashboardRecord(
  projectRoot: string,
  entry: NexusPluginCatalogueEntry,
): NexusDashboardPluginRecord {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    enabled: false,
    state: "available",
    source: "catalogue",
    packageName: entry.packageName,
    sourcePath: entry.sourcePath,
    repositoryUrl: entry.repositoryUrl,
    configExportName: entry.configExportName,
    installCommand: entry.installCommand,
    refreshCommand: nexusPluginCatalogueRefreshCommand(projectRoot, entry),
    detail: entry.description,
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
  record: Pick<NexusDashboardPluginRecord, "id" | "name" | "packageName"> | NexusPluginCatalogueEntry,
): string[] {
  const values = [record.id, record.name, record.packageName ?? null]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.map(normalizePluginKey);
}

function normalizePluginKey(value: string): string {
  return value.trim().toLowerCase().replace(/^@[^/]+\//u, "");
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
