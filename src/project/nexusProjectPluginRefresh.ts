import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  materializeNexusProjectAgentMcpConfig,
  type MaterializeNexusProjectAgentMcpConfigResult,
} from "../agents/nexusAgentMcpConfig.js";
import {
  resolveNexusMcpExposure,
  type NexusResolvedMcpExposureMode,
} from "../mcp/nexusMcpExposurePolicy.js";
import type {
  NexusPluginMcpServerCapability,
  NexusPluginMcpServerTransport,
  NexusPluginProjectedSkillCapability,
  NexusProjectPluginConfig,
} from "./nexusPluginCapabilities.js";
import {
  activeNexusProjectMcpAgentTargets,
  activeNexusProjectSkillAgentTargets,
  loadProjectConfig,
  validateProjectConfig,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  refreshNexusProjectSkills,
  type NexusSkillDefinition,
  type NexusSkillManifest,
  type NexusProjectSkillAgentTarget,
  type RefreshNexusProjectSkillsResult,
} from "../agents/nexusSkills.js";

export interface RefreshNexusProjectPluginOptions {
  projectRoot: string;
  from: string;
  exportName?: string;
  skillsExportName?: string;
  targetAgents?: string[];
  targetComponents?: string[];
  dryRun?: boolean;
}

export interface NexusProjectPluginRefreshSkippedMcpServer {
  serverName: string;
  capabilityIds: string[];
  reason:
    | "missing_command"
    | "no_matching_targets"
    | "hidden_exposure"
    | "gateway_pending"
    | "unsupported_transport";
  transport?: NexusPluginMcpServerTransport;
  exposureMode?: NexusResolvedMcpExposureMode;
}

export interface RefreshNexusProjectPluginResult {
  projectRoot: string;
  projectConfigPath: string;
  applied: boolean;
  module: {
    source: string;
    importUrl: string;
    packageRoot: string | null;
    pluginExportName: string;
    skillsExportName: string | null;
  };
  plugin: {
    id: string;
    name: string | null;
    version: string | null;
    created: boolean;
    enabled: boolean;
    changed: boolean;
    previousCapabilityCount: number | null;
    capabilityCount: number;
    projectedSkillCount: number;
    mcpServerCount: number;
  };
  configWritten: boolean;
  skillProjection: {
    requiredSkillIds: string[];
    availableSkillIds: string[];
    materializedSkillCount: number;
    materializedAgentSkillCount: number;
    result: RefreshNexusProjectSkillsResult | null;
  };
  mcpProjection: {
    materializedServerCount: number;
    materializedTargetCount: number;
    skippedServers: NexusProjectPluginRefreshSkippedMcpServer[];
    results: MaterializeNexusProjectAgentMcpConfigResult[];
  };
}

interface LoadedNexusProjectPluginModule {
  source: string;
  importUrl: string;
  packageRoot: string | null;
  pluginExportName: string;
  skillsExportName: string | null;
  plugin: NexusProjectPluginConfig;
  skillDefinitions: NexusSkillDefinition[];
}

interface ResolvedPluginModule {
  importUrl: string;
  packageRoot: string | null;
}

interface PluginMcpServerProjection {
  serverName: string;
  transport: NexusPluginMcpServerTransport | null;
  command: string | null;
  args: string[];
  url: string | null;
  targetAgents: string[] | null;
  exposure?: NexusPluginMcpServerCapability["exposure"];
  capabilityIds: string[];
}

export async function refreshNexusProjectPlugin(
  options: RefreshNexusProjectPluginOptions,
): Promise<RefreshNexusProjectPluginResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const rawProjectConfig = readRawProjectConfig(projectRoot);
  const loaded = await loadNexusProjectPluginModule({
    source: options.from,
    projectRoot,
    exportName: options.exportName,
    skillsExportName: options.skillsExportName,
    targetAgents: options.targetAgents ?? [],
    targetComponents: options.targetComponents ?? [],
  });
  const nextPlugin = pluginConfigPreservingEnablement(
    loaded.plugin,
    projectConfig.plugins ?? [],
  );
  const previousPlugin =
    (projectConfig.plugins ?? []).find((plugin) => plugin.id === nextPlugin.id) ??
    null;
  const nextConfig = upsertProjectPlugin(projectConfig, nextPlugin);
  const nextRawConfig = upsertRawProjectPlugin(rawProjectConfig, nextPlugin);
  validateProjectConfig(nextRawConfig);
  const projectedSkillCapabilities = projectedSkillCapabilitiesForPlugin(nextPlugin);
  const projectedSkillDefinitions = skillDefinitionsForProjectedCapabilities(
    loaded.skillDefinitions,
    projectedSkillCapabilities,
  );
  const skillAgentTargets = filteredSkillAgentTargets(
    nextConfig,
    options.targetAgents ?? [],
  );
  const mcpProjectionPlan = pluginMcpServerProjections(nextPlugin);
  const mcpTargets = filteredMcpAgentTargets(nextConfig, options.targetAgents ?? []);

  const dryRun = options.dryRun === true;
  const projectConfigPath = saveProjectConfigPath(projectRoot);
  let skillProjectionResult: RefreshNexusProjectSkillsResult | null = null;
  const mcpProjectionResults: MaterializeNexusProjectAgentMcpConfigResult[] = [];
  const skippedMcpServers: NexusProjectPluginRefreshSkippedMcpServer[] = [];

  if (!dryRun) {
    writeRawProjectPluginConfig(projectRoot, nextRawConfig, nextPlugin);
    if (nextPlugin.enabled !== false && projectedSkillDefinitions.length > 0) {
      skillProjectionResult = refreshNexusProjectSkills({
        projectRoot,
        skillsConfig: {
          defaultCorePack: false,
          items: projectedSkillDefinitions.map((definition) => ({
            id: definition.manifest.id,
          })),
        },
        skillDefinitions: projectedSkillDefinitions,
        agentTargets: skillAgentTargets,
      });
    }

    if (nextPlugin.enabled !== false) {
      for (const server of mcpProjectionPlan) {
        const matchingTargets = mcpTargetsForProjection(mcpTargets, server);
        if (matchingTargets.length === 0) {
          skippedMcpServers.push({
            serverName: server.serverName,
            capabilityIds: server.capabilityIds,
            reason: "no_matching_targets",
          });
          continue;
        }
        const directTargets = directMcpTargetsForProjection(
          nextConfig,
          nextPlugin,
          server,
          matchingTargets,
        );
        if (directTargets.length === 0) {
          skippedMcpServers.push(skipForExposure(server, nextConfig, nextPlugin, matchingTargets[0]!));
          continue;
        }
        if (pluginMcpProjectionTransport(server) !== "stdio") {
          skippedMcpServers.push({
            serverName: server.serverName,
            capabilityIds: server.capabilityIds,
            reason: "unsupported_transport",
            transport: pluginMcpProjectionTransport(server),
          });
          continue;
        }
        if (!server.command) {
          skippedMcpServers.push({
            serverName: server.serverName,
            capabilityIds: server.capabilityIds,
            reason: "missing_command",
          });
          continue;
        }
        const command = server.command;

        mcpProjectionResults.push(
          materializeNexusProjectAgentMcpConfig({
            projectRoot,
            mcpConfig: nextConfig.mcp,
            agentTargets: directTargets.map((target) => ({
              ...target,
              serverName: server.serverName,
              command,
              args: server.args,
            })),
          }),
        );
      }
    }
  } else {
    for (const server of mcpProjectionPlan) {
      const matchingTargets = mcpTargetsForProjection(mcpTargets, server);
      if (matchingTargets.length === 0) {
        skippedMcpServers.push({
          serverName: server.serverName,
          capabilityIds: server.capabilityIds,
          reason: "no_matching_targets",
        });
        continue;
      }
      if (
        directMcpTargetsForProjection(
          nextConfig,
          nextPlugin,
          server,
          matchingTargets,
        ).length === 0
      ) {
        skippedMcpServers.push(skipForExposure(server, nextConfig, nextPlugin, matchingTargets[0]!));
        continue;
      }
      if (pluginMcpProjectionTransport(server) !== "stdio") {
        skippedMcpServers.push({
          serverName: server.serverName,
          capabilityIds: server.capabilityIds,
          reason: "unsupported_transport",
          transport: pluginMcpProjectionTransport(server),
        });
        continue;
      }
      if (!server.command) {
        skippedMcpServers.push({
          serverName: server.serverName,
          capabilityIds: server.capabilityIds,
          reason: "missing_command",
        });
      }
    }
  }

  const created = previousPlugin === null;
  const changed =
    previousPlugin === null ||
    JSON.stringify(previousPlugin) !== JSON.stringify(nextPlugin);

  return {
    projectRoot,
    projectConfigPath,
    applied: !dryRun,
    module: {
      source: loaded.source,
      importUrl: loaded.importUrl,
      packageRoot: loaded.packageRoot,
      pluginExportName: loaded.pluginExportName,
      skillsExportName: loaded.skillsExportName,
    },
    plugin: {
      id: nextPlugin.id,
      name: nextPlugin.name ?? null,
      version: nextPlugin.version ?? null,
      created,
      enabled: nextPlugin.enabled !== false,
      changed,
      previousCapabilityCount: previousPlugin?.capabilities.length ?? null,
      capabilityCount: nextPlugin.capabilities.length,
      projectedSkillCount: projectedSkillCapabilities.length,
      mcpServerCount: mcpProjectionPlan.length,
    },
    configWritten: !dryRun,
    skillProjection: {
      requiredSkillIds: projectedSkillCapabilities.map(
        (capability) => capability.skillId,
      ),
      availableSkillIds: projectedSkillDefinitions.map(
        (definition) => definition.manifest.id,
      ),
      materializedSkillCount:
        skillProjectionResult?.materialized.installed.length ?? 0,
      materializedAgentSkillCount:
        skillProjectionResult?.materialized.agentTargets.reduce(
          (count, target) => count + target.installed.length,
          0,
        ) ?? 0,
      result: skillProjectionResult,
    },
    mcpProjection: {
      materializedServerCount: mcpProjectionResults.length,
      materializedTargetCount: mcpProjectionResults.reduce(
        (count, result) => count + result.agentTargets.length,
        0,
      ),
      skippedServers: skippedMcpServers,
      results: mcpProjectionResults,
    },
  };
}

async function loadNexusProjectPluginModule(options: {
  source: string;
  projectRoot: string;
  exportName?: string;
  skillsExportName?: string;
  targetAgents: string[];
  targetComponents: string[];
}): Promise<LoadedNexusProjectPluginModule> {
  const resolved = resolvePluginModule(options.source, options.projectRoot);
  const namespace = await import(resolved.importUrl) as Record<string, unknown>;
  const pluginExport = selectPluginExport(namespace, options.exportName);
  const plugin = await pluginConfigFromExport(pluginExport.value, {
    targetAgents: options.targetAgents,
    targetComponents: options.targetComponents,
  });
  const skillsExport = selectSkillsExport(namespace, options.skillsExportName);
  const exportedSkillDefinitions = skillsExport
    ? await skillDefinitionsFromExport(skillsExport.value)
    : [];
  const discoveredSkillDefinitions = resolved.packageRoot
    ? discoverPackagedSkillDefinitions(resolved.packageRoot)
    : [];
  const skillDefinitions = mergeSkillDefinitions([
    ...discoveredSkillDefinitions,
    ...exportedSkillDefinitions,
  ]);

  return {
    source: options.source,
    importUrl: resolved.importUrl,
    packageRoot: resolved.packageRoot,
    pluginExportName: pluginExport.name,
    skillsExportName: skillsExport?.name ?? null,
    plugin,
    skillDefinitions,
  };
}

function resolvePluginModule(source: string, projectRoot: string): ResolvedPluginModule {
  if (isPathLikeSpecifier(source)) {
    const resolvedPath = path.resolve(projectRoot, expandHomePath(source));
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
      return {
        importUrl: pathToFileURL(packageEntryPoint(resolvedPath)).href,
        packageRoot: resolvedPath,
      };
    }

    return {
      importUrl: pathToFileURL(resolvedPath).href,
      packageRoot: findPackageRoot(path.dirname(resolvedPath)),
    };
  }

  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
  const resolvedPath = requireFromProject.resolve(source);
  return {
    importUrl: pathToFileURL(resolvedPath).href,
    packageRoot: findPackageRoot(path.dirname(resolvedPath)),
  };
}

function isPathLikeSpecifier(source: string): boolean {
  return (
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.startsWith("~") ||
    source.includes(path.sep)
  );
}

function expandHomePath(source: string): string {
  if (source === "~") {
    return process.env.HOME ?? source;
  }
  if (source.startsWith("~/")) {
    return path.join(process.env.HOME ?? "~", source.slice(2));
  }
  return source;
}

function packageEntryPoint(packageRoot: string): string {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return path.join(packageRoot, "dist", "index.js");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as
    Record<string, unknown>;
  const exportsField = packageJson.exports;
  const exportEntry = packageExportEntry(exportsField);
  const mainEntry =
    exportEntry ??
    (typeof packageJson.main === "string" ? packageJson.main : null) ??
    "dist/index.js";

  return path.resolve(packageRoot, mainEntry);
}

function packageExportEntry(exportsField: unknown): string | null {
  if (typeof exportsField === "string") {
    return exportsField;
  }
  if (!isRecord(exportsField)) {
    return null;
  }

  const dotExport = exportsField["."];
  if (typeof dotExport === "string") {
    return dotExport;
  }
  if (isRecord(dotExport)) {
    for (const key of ["import", "default", "node"]) {
      const value = dotExport[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }

  return null;
}

function findPackageRoot(startDirectory: string): string | null {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function selectPluginExport(
  namespace: Record<string, unknown>,
  exportName: string | undefined,
): { name: string; value: unknown } {
  if (exportName) {
    if (!(exportName in namespace)) {
      throw new Error(`Plugin export not found: ${exportName}`);
    }
    return { name: exportName, value: namespace[exportName] };
  }

  const candidates = Object.entries(namespace)
    .filter(([name, value]) =>
      name === "default" ||
      name.endsWith("DevNexusPluginConfig") ||
      looksLikeProjectPluginConfig(value))
    .filter(([, value]) =>
      typeof value === "function" || looksLikeProjectPluginConfig(value));

  if (candidates.length === 1) {
    const [name, value] = candidates[0]!;
    return { name, value };
  }

  throw new Error(
    candidates.length === 0
      ? "No DevNexus plugin config export found; pass --export <name>"
      : "Multiple DevNexus plugin config exports found; pass --export <name>",
  );
}

async function pluginConfigFromExport(
  value: unknown,
  options: {
    targetAgents: string[];
    targetComponents: string[];
  },
): Promise<NexusProjectPluginConfig> {
  const factoryOptions = {
    ...(options.targetAgents.length > 0
      ? { targetAgents: options.targetAgents }
      : {}),
    ...(options.targetComponents.length > 0
      ? { targetComponents: options.targetComponents }
      : {}),
  };
  const plugin = typeof value === "function"
    ? await (value as (options: Record<string, unknown>) => unknown)(factoryOptions)
    : value;

  if (!looksLikeProjectPluginConfig(plugin)) {
    throw new Error("Selected export did not produce a DevNexus plugin config");
  }

  return plugin as NexusProjectPluginConfig;
}

function selectSkillsExport(
  namespace: Record<string, unknown>,
  exportName: string | undefined,
): { name: string; value: unknown } | null {
  if (exportName) {
    if (!(exportName in namespace)) {
      throw new Error(`Plugin skills export not found: ${exportName}`);
    }
    return { name: exportName, value: namespace[exportName] };
  }

  const candidates = Object.entries(namespace)
    .filter(([name]) => name.endsWith("SkillDefinitions"))
    .filter(([, value]) => typeof value === "function" || Array.isArray(value));

  if (candidates.length === 1) {
    const [name, value] = candidates[0]!;
    return { name, value };
  }

  return null;
}

async function skillDefinitionsFromExport(
  value: unknown,
): Promise<NexusSkillDefinition[]> {
  const definitions = typeof value === "function"
    ? await (value as () => unknown)()
    : value;
  if (!Array.isArray(definitions)) {
    throw new Error("Selected skills export did not produce skill definitions");
  }

  return definitions.map((definition, index) =>
    normalizeSkillDefinition(definition, `skills export[${index}]`),
  );
}

function discoverPackagedSkillDefinitions(
  packageRoot: string,
): NexusSkillDefinition[] {
  const skillsRoot = path.join(packageRoot, "skills");
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name))
    .filter((skillRoot) =>
      fs.existsSync(path.join(skillRoot, "dev-nexus.skill.json")))
    .map((skillRoot) => ({
      manifest: JSON.parse(
        fs.readFileSync(path.join(skillRoot, "dev-nexus.skill.json"), "utf8"),
      ) as NexusSkillManifest,
      files: readSkillFiles(skillRoot),
      sourcePath: skillRoot,
    }))
    .map((definition, index) =>
      normalizeSkillDefinition(definition, `skills/${index}`),
    );
}

function readSkillFiles(skillRoot: string): Record<string, string> {
  return Object.fromEntries(readSkillFileEntries(skillRoot, skillRoot));
}

function readSkillFileEntries(
  skillRoot: string,
  currentDirectory: string,
): Array<[string, string]> {
  return fs
    .readdirSync(currentDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        return readSkillFileEntries(skillRoot, entryPath);
      }

      const relativePath = path.relative(skillRoot, entryPath)
        .split(path.sep)
        .join("/");
      return [[relativePath, fs.readFileSync(entryPath, "utf8")] as
        [string, string]];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function normalizeSkillDefinition(
  value: unknown,
  pathName: string,
): NexusSkillDefinition {
  if (!isRecord(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  if (!isRecord(value.manifest)) {
    throw new Error(`${pathName}.manifest must be an object`);
  }
  if (!isRecord(value.files)) {
    throw new Error(`${pathName}.files must be an object`);
  }
  if (typeof value.manifest.id !== "string") {
    throw new Error(`${pathName}.manifest.id must be a string`);
  }
  const files: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(value.files)) {
    if (typeof content !== "string") {
      throw new Error(`${pathName}.files.${filePath} must be a string`);
    }
    files[filePath] = content;
  }

  return {
    manifest: value.manifest as unknown as NexusSkillManifest,
    files,
    ...(typeof value.sourcePath === "string"
      ? { sourcePath: value.sourcePath }
      : {}),
  };
}

function mergeSkillDefinitions(
  definitions: readonly NexusSkillDefinition[],
): NexusSkillDefinition[] {
  const merged = new Map<string, NexusSkillDefinition>();
  for (const definition of definitions) {
    merged.set(definition.manifest.id, definition);
  }
  return [...merged.values()].sort((left, right) =>
    left.manifest.id.localeCompare(right.manifest.id),
  );
}

function pluginConfigPreservingEnablement(
  plugin: NexusProjectPluginConfig,
  existingPlugins: readonly NexusProjectPluginConfig[],
): NexusProjectPluginConfig {
  const existing = existingPlugins.find((item) => item.id === plugin.id);
  return {
    ...plugin,
    enabled: existing?.enabled ?? plugin.enabled ?? true,
  };
}

function upsertProjectPlugin(
  config: NexusProjectConfig,
  plugin: NexusProjectPluginConfig,
): NexusProjectConfig {
  const existingPlugins = config.plugins ?? [];
  const plugins = existingPlugins.some((item) => item.id === plugin.id)
    ? existingPlugins.map((item) => item.id === plugin.id ? plugin : item)
    : [...existingPlugins, plugin];

  return {
    ...config,
    plugins,
  };
}

function readRawProjectConfig(projectRoot: string): Record<string, unknown> {
  const configPath = saveProjectConfigPath(projectRoot);
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, ""));
  if (!isRecord(parsed)) {
    throw new Error(`DevNexus workspace config must be a JSON object: ${configPath}`);
  }

  return parsed;
}

function writeRawProjectPluginConfig(
  projectRoot: string,
  config: Record<string, unknown>,
  plugin: NexusProjectPluginConfig,
): string {
  const configPath = saveProjectConfigPath(projectRoot);
  const existing = fs.readFileSync(configPath, "utf8");
  const targeted = replacePluginConfigInJsonText(existing, plugin);
  fs.writeFileSync(
    configPath,
    targeted ?? `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  return configPath;
}

function upsertRawProjectPlugin(
  config: Record<string, unknown>,
  plugin: NexusProjectPluginConfig,
): Record<string, unknown> {
  const rawPlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const pluginRecord = JSON.parse(JSON.stringify(plugin)) as Record<string, unknown>;
  const plugins = rawPlugins.some(
    (item) => isRecord(item) && item.id === plugin.id,
  )
    ? rawPlugins.map((item) =>
        isRecord(item) && item.id === plugin.id ? pluginRecord : item,
      )
    : [...rawPlugins, pluginRecord];

  return {
    ...config,
    plugins,
  };
}

function replacePluginConfigInJsonText(
  content: string,
  plugin: NexusProjectPluginConfig,
): string | null {
  const pluginsRange = findJsonPropertyArrayRange(content, "plugins");
  if (!pluginsRange) {
    return null;
  }

  const pluginRange = findPluginObjectRange(content, pluginsRange, plugin.id);
  const baseIndent = pluginRange
    ? lineIndentAt(content, pluginRange.start)
    : arrayItemIndent(content, pluginsRange);
  const formatted = formatJsonObjectAtIndent(
    plugin,
    baseIndent,
    pluginRange === null,
  );
  if (pluginRange) {
    return `${content.slice(0, pluginRange.start)}${formatted}${content.slice(pluginRange.end)}`;
  }

  return appendPluginObjectToArray(content, pluginsRange, formatted);
}

function findJsonPropertyArrayRange(
  content: string,
  propertyName: string,
): { start: number; end: number } | null {
  const propertyPattern = new RegExp(`"${escapeRegExp(propertyName)}"\\s*:`, "gu");
  let match: RegExpExecArray | null;
  while ((match = propertyPattern.exec(content)) !== null) {
    const colonIndex = content.indexOf(":", match.index);
    const arrayStart = skipJsonWhitespace(content, colonIndex + 1);
    if (content[arrayStart] !== "[") {
      continue;
    }
    const arrayRange = findBalancedJsonRange(content, arrayStart);
    if (arrayRange) {
      return arrayRange;
    }
  }

  return null;
}

function findPluginObjectRange(
  content: string,
  pluginsRange: { start: number; end: number },
  pluginId: string,
): { start: number; end: number } | null {
  let index = pluginsRange.start + 1;
  while (index < pluginsRange.end - 1) {
    index = skipJsonWhitespaceAndCommas(content, index);
    if (index >= pluginsRange.end - 1) {
      return null;
    }
    if (content[index] !== "{") {
      index += 1;
      continue;
    }
    const objectRange = findBalancedJsonRange(content, index);
    if (!objectRange) {
      return null;
    }
    try {
      const parsed = JSON.parse(content.slice(objectRange.start, objectRange.end)) as
        unknown;
      if (isRecord(parsed) && parsed.id === pluginId) {
        return objectRange;
      }
    } catch {
      return null;
    }
    index = objectRange.end;
  }

  return null;
}

function appendPluginObjectToArray(
  content: string,
  pluginsRange: { start: number; end: number },
  formattedPlugin: string,
): string {
  const beforeClose = content.slice(pluginsRange.start + 1, pluginsRange.end - 1);
  const closingIndent = lineIndentAt(content, pluginsRange.end - 1);
  const insertion = beforeClose.trim().length === 0
    ? `\n${formattedPlugin}\n${closingIndent}`
    : `,\n${formattedPlugin}`;

  return `${content.slice(0, pluginsRange.end - 1)}${insertion}${content.slice(pluginsRange.end - 1)}`;
}

function formatJsonObjectAtIndent(
  value: unknown,
  baseIndent: string,
  indentFirstLine: boolean,
): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, index) =>
      index === 0 && !indentFirstLine ? line : `${baseIndent}${line}`)
    .join("\n");
}

function arrayItemIndent(
  content: string,
  arrayRange: { start: number; end: number },
): string {
  let index = skipJsonWhitespaceAndCommas(content, arrayRange.start + 1);
  if (index < arrayRange.end - 1 && content[index] === "{") {
    return lineIndentAt(content, index);
  }
  return `${lineIndentAt(content, arrayRange.start)}  `;
}

function lineIndentAt(content: string, index: number): string {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const match = /^[ \t]*/u.exec(content.slice(lineStart, index));
  return match?.[0] ?? "";
}

function findBalancedJsonRange(
  content: string,
  start: number,
): { start: number; end: number } | null {
  const open = content[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index + 1 };
      }
    }
  }

  return null;
}

function skipJsonWhitespace(content: string, start: number): number {
  let index = start;
  while (index < content.length && /\s/u.test(content[index]!)) {
    index += 1;
  }
  return index;
}

function skipJsonWhitespaceAndCommas(content: string, start: number): number {
  let index = start;
  while (index < content.length && (/[\s,]/u.test(content[index]!))) {
    index += 1;
  }
  return index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function projectedSkillCapabilitiesForPlugin(
  plugin: NexusProjectPluginConfig,
): NexusPluginProjectedSkillCapability[] {
  return plugin.capabilities.filter(
    (capability): capability is NexusPluginProjectedSkillCapability =>
      capability.kind === "projected_skill",
  );
}

function skillDefinitionsForProjectedCapabilities(
  definitions: readonly NexusSkillDefinition[],
  capabilities: readonly NexusPluginProjectedSkillCapability[],
): NexusSkillDefinition[] {
  const definitionsById = new Map(
    definitions.map((definition) => [definition.manifest.id, definition]),
  );
  const capabilitiesBySkillId = new Map<
    string,
    NexusPluginProjectedSkillCapability[]
  >();
  for (const capability of capabilities) {
    const existing = capabilitiesBySkillId.get(capability.skillId) ?? [];
    existing.push(capability);
    capabilitiesBySkillId.set(capability.skillId, existing);
  }

  const missing = [...capabilitiesBySkillId.keys()]
    .filter((skillId) => !definitionsById.has(skillId))
    .sort((left, right) => left.localeCompare(right));
  if (missing.length > 0) {
    throw new Error(
      `Plugin declares projected skills without packaged definitions: ${missing.join(", ")}`,
    );
  }

  return [...capabilitiesBySkillId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([skillId, skillCapabilities]) =>
      skillDefinitionForCapabilityTargets(
        definitionsById.get(skillId)!,
        skillCapabilities,
      ),
    );
}

function skillDefinitionForCapabilityTargets(
  definition: NexusSkillDefinition,
  capabilities: readonly NexusPluginProjectedSkillCapability[],
): NexusSkillDefinition {
  if (capabilities.some((capability) => !capability.targetAgents)) {
    return definition;
  }

  const targetAgents = new Set(
    capabilities.flatMap((capability) => capability.targetAgents ?? []),
  );
  return {
    ...definition,
    manifest: {
      ...definition.manifest,
      supportedAgents: definition.manifest.supportedAgents.filter((agent) =>
        targetAgents.has(agent),
      ),
    },
  };
}

function filteredSkillAgentTargets(
  config: NexusProjectConfig,
  targetAgents: readonly string[],
): NexusProjectSkillAgentTarget[] {
  const selected = normalizedSelection(targetAgents);
  return activeNexusProjectSkillAgentTargets(config).filter((target) =>
    selected.size === 0 || selected.has(target.agent.trim().toLowerCase()),
  );
}

function filteredMcpAgentTargets(
  config: NexusProjectConfig,
  targetAgents: readonly string[],
): NexusProjectAgentMcpTarget[] {
  const selected = normalizedSelection(targetAgents);
  return activeNexusProjectMcpAgentTargets(config).filter((target) => {
    const provider = (target.provider ?? target.agent).trim().toLowerCase();
    const agent = target.agent.trim().toLowerCase();
    return selected.size === 0 || selected.has(agent) || selected.has(provider);
  });
}

function pluginMcpServerProjections(
  plugin: NexusProjectPluginConfig,
): PluginMcpServerProjection[] {
  const projections = new Map<string, PluginMcpServerProjection>();
  for (const capability of plugin.capabilities.filter(
    (item): item is NexusPluginMcpServerCapability => item.kind === "mcp_server",
  )) {
    const existing = projections.get(capability.serverName) ?? {
      serverName: capability.serverName,
      transport: null,
      command: null,
      args: [],
      url: null,
      targetAgents: null,
      exposure: undefined,
      capabilityIds: [],
    };
    const declaredTransport = declaredPluginMcpServerTransport(capability);
    if (
      existing.transport &&
      declaredTransport &&
      existing.transport !== declaredTransport
    ) {
      throw new Error(
        `Plugin MCP server ${capability.serverName} declares conflicting transports`,
      );
    }
    existing.transport = existing.transport ?? declaredTransport ?? null;
    if (capability.command) {
      if (
        existing.command &&
        (existing.command !== capability.command ||
          !stringArraysEqual(existing.args, capability.args ?? []))
      ) {
        throw new Error(
          `Plugin MCP server ${capability.serverName} declares conflicting command lines`,
        );
      }
      existing.command = capability.command;
      existing.args = capability.args ?? [];
    }
    if (capability.url) {
      if (existing.url && existing.url !== capability.url) {
        throw new Error(
          `Plugin MCP server ${capability.serverName} declares conflicting URLs`,
        );
      }
      existing.url = capability.url;
    }
    existing.targetAgents = mergeTargetAgentSelectors(
      existing.targetAgents,
      capability.targetAgents,
    );
    if (
      existing.exposure &&
      capability.exposure &&
      existing.exposure !== capability.exposure
    ) {
      throw new Error(
        `Plugin MCP server ${capability.serverName} declares conflicting exposure modes`,
      );
    }
    existing.exposure = existing.exposure ?? capability.exposure;
    existing.capabilityIds.push(capability.id);
    projections.set(capability.serverName, existing);
  }

  return [...projections.values()].sort((left, right) =>
    left.serverName.localeCompare(right.serverName),
  );
}

function mergeTargetAgentSelectors(
  existing: string[] | null,
  next: string[] | undefined,
): string[] | null {
  if (!existing || !next) {
    return null;
  }
  return [...new Set([...existing, ...next])].sort((left, right) =>
    left.localeCompare(right),
  );
}

function mcpTargetsForProjection(
  targets: readonly NexusProjectAgentMcpTarget[],
  projection: PluginMcpServerProjection,
): NexusProjectAgentMcpTarget[] {
  const selected = projection.targetAgents
    ? normalizedSelection(projection.targetAgents)
    : new Set<string>();
  return targets.filter((target) => {
    const agent = target.agent.trim().toLowerCase();
    const provider = (target.provider ?? target.agent).trim().toLowerCase();
    return selected.size === 0 || selected.has(agent) || selected.has(provider);
  });
}

function directMcpTargetsForProjection(
  config: NexusProjectConfig,
  plugin: NexusProjectPluginConfig,
  projection: PluginMcpServerProjection,
  targets: readonly NexusProjectAgentMcpTarget[],
): NexusProjectAgentMcpTarget[] {
  return targets.filter(
    (target) =>
      resolveNexusMcpExposure({
        workspaceExposure: config.mcp?.exposure,
        agentTarget: target,
        plugin,
        server: projectionToMcpServerCapability(projection),
      }).mode === "direct",
  );
}

function skipForExposure(
  projection: PluginMcpServerProjection,
  config: NexusProjectConfig,
  plugin: NexusProjectPluginConfig,
  target: NexusProjectAgentMcpTarget,
): NexusProjectPluginRefreshSkippedMcpServer {
  const resolution = resolveNexusMcpExposure({
    workspaceExposure: config.mcp?.exposure,
    agentTarget: target,
    plugin,
    server: projectionToMcpServerCapability(projection),
  });
  return {
    serverName: projection.serverName,
    capabilityIds: projection.capabilityIds,
    reason: resolution.mode === "gateway" ? "gateway_pending" : "hidden_exposure",
    exposureMode: resolution.mode,
  };
}

function projectionToMcpServerCapability(
  projection: PluginMcpServerProjection,
): NexusPluginMcpServerCapability {
  const transport = pluginMcpProjectionTransport(projection);
  return {
    kind: "mcp_server",
    id: projection.capabilityIds[0] ?? projection.serverName,
    serverName: projection.serverName,
    transport,
    ...(transport === "stdio" && projection.command
      ? { command: projection.command }
      : {}),
    ...(transport === "stdio" ? { args: projection.args } : {}),
    ...(projection.url ? { url: projection.url } : {}),
    ...(projection.targetAgents ? { targetAgents: projection.targetAgents } : {}),
    ...(projection.exposure ? { exposure: projection.exposure } : {}),
  };
}

function declaredPluginMcpServerTransport(
  capability: NexusPluginMcpServerCapability,
): NexusPluginMcpServerTransport | null {
  return capability.transport ??
    (capability.url ? "http" : capability.command ? "stdio" : null);
}

function pluginMcpProjectionTransport(
  projection: PluginMcpServerProjection,
): NexusPluginMcpServerTransport {
  return projection.transport ?? (projection.url ? "http" : "stdio");
}

function normalizedSelection(values: readonly string[]): Set<string> {
  return new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function saveProjectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, "dev-nexus.project.json");
}

function looksLikeProjectPluginConfig(
  value: unknown,
): value is NexusProjectPluginConfig {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.capabilities)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
