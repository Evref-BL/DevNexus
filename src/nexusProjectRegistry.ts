import fs from "node:fs";
import path from "node:path";
import {
  devNexusProjectConfigFileName,
  loadProjectConfig,
  projectConfigPath,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  ensureUniqueProject,
  loadProjectConfigIfExists,
  NexusProjectError,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
  type ResolvedNexusProjectWorkTracker,
  samePath,
} from "./nexusProjectLifecycle.js";
import type {
  TrackerCapabilities,
  WorkTrackerCapabilityReport,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export interface NexusProjectReference {
  id: string;
  name: string;
  projectRoot: string;
  vibeKanbanProjectId?: string;
  vibeKanbanRepoId?: string;
}

export interface NexusProjectRegistry {
  projects: NexusProjectReference[];
}

export interface NexusProjectStatusBase {
  id: string;
  name: string;
  projectRoot: string;
  repo: NexusProjectConfig["repo"] | null;
  components: ResolvedNexusProjectComponent[];
  defaultTrackerId: string | null;
  workTrackers: ResolvedNexusProjectWorkTracker[];
  workTracking: WorkTrackingConfig | null;
  workTrackingCapabilities: TrackerCapabilities | null;
  workTrackingCapabilityReport: WorkTrackerCapabilityReport | null;
  vibeKanbanProjectId: string | null;
  vibeKanbanRepoId: string | null;
  projectConfigPath: string;
  projectConfigExists: boolean;
  worktreesRoot: string;
  worktreesRootExists: boolean;
}

export interface BuildNexusProjectStatusOptions {
  projectConfig?: NexusProjectConfig;
}

export interface UpsertNexusProjectReferenceOptions {
  vibeKanbanProjectId?: string | null;
  vibeKanbanRepoId?: string | null;
}

export function projectRootFromInput(input: string): string {
  const resolved = path.resolve(input);
  return path.basename(resolved) === devNexusProjectConfigFileName
    ? path.dirname(resolved)
    : resolved;
}

export function findNexusProjectReferenceById(
  registry: NexusProjectRegistry,
  id: string,
): NexusProjectReference | undefined {
  return (
    registry.projects.find((project) => project.id === id) ??
    registry.projects.find(
      (project) =>
        loadProjectConfigIfExists(path.resolve(project.projectRoot))?.id === id,
    )
  );
}

export function findNexusProjectReferenceByPath(
  registry: NexusProjectRegistry,
  projectPath: string,
): NexusProjectReference | undefined {
  const projectRoot = projectRootFromInput(projectPath);
  return registry.projects.find((project) =>
    samePath(project.projectRoot, projectRoot),
  );
}

export function findNexusProjectReference(
  registry: NexusProjectRegistry,
  idOrPath: string,
): NexusProjectReference | undefined {
  return (
    findNexusProjectReferenceById(registry, idOrPath) ??
    findNexusProjectReferenceByPath(registry, idOrPath)
  );
}

export function buildNexusProjectStatus(
  reference: NexusProjectReference,
  options: BuildNexusProjectStatusOptions = {},
): NexusProjectStatusBase {
  const projectRoot = path.resolve(reference.projectRoot);
  const config = options.projectConfig ?? loadProjectConfigIfExists(projectRoot);
  const resolvedProjectConfigPath = projectConfigPath(projectRoot);
  const resolvedWorktreesRoot = projectWorktreesRootPath(projectRoot, config);
  const components = config ? resolveProjectComponents(projectRoot, config) : [];
  const primaryComponent =
    components.find((component) => component.role === "primary") ??
    components[0] ??
    null;

  return {
    id: config?.id ?? reference.id,
    name: config?.name ?? reference.name,
    projectRoot,
    repo: config?.repo ?? null,
    components,
    defaultTrackerId: primaryComponent?.defaultTrackerId ?? null,
    workTrackers: primaryComponent?.workTrackers ?? [],
    workTracking: primaryComponent?.workTracking ?? config?.workTracking ?? null,
    workTrackingCapabilities:
      primaryComponent?.workTrackingCapabilities ?? null,
    workTrackingCapabilityReport:
      primaryComponent?.workTrackingCapabilityReport ?? null,
    vibeKanbanProjectId:
      config?.kanban?.projectId ?? reference.vibeKanbanProjectId ?? null,
    vibeKanbanRepoId: reference.vibeKanbanRepoId ?? null,
    projectConfigPath: resolvedProjectConfigPath,
    projectConfigExists: Boolean(config),
    worktreesRoot: resolvedWorktreesRoot,
    worktreesRootExists: fs.existsSync(resolvedWorktreesRoot),
  };
}

export function buildNexusProjectStatusForPath(
  projectRoot: string,
): NexusProjectStatusBase {
  const config = loadProjectConfigIfExists(projectRoot);
  if (!config) {
    throw new NexusProjectError(
      `DevNexus project is not initialized: ${projectConfigPath(projectRoot)}`,
    );
  }

  return buildNexusProjectStatus({
    id: config.id,
    name: config.name,
    projectRoot,
    ...(config.kanban?.projectId
      ? { vibeKanbanProjectId: config.kanban.projectId }
      : {}),
  }, { projectConfig: config });
}

export function upsertNexusProjectReference(
  registry: NexusProjectRegistry,
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  options: UpsertNexusProjectReferenceOptions = {},
): NexusProjectReference {
  const existingIndex = registry.projects.findIndex((project) =>
    samePath(project.projectRoot, projectRoot),
  );
  const existing =
    existingIndex >= 0 ? registry.projects[existingIndex] : undefined;
  const resolvedVibeKanbanProjectId =
    options.vibeKanbanProjectId ??
    projectConfig.kanban?.projectId ??
    existing?.vibeKanbanProjectId ??
    null;
  const resolvedVibeKanbanRepoId =
    options.vibeKanbanRepoId ?? existing?.vibeKanbanRepoId ?? null;
  const reference: NexusProjectReference = {
    id: projectConfig.id,
    name: projectConfig.name,
    projectRoot,
    ...(resolvedVibeKanbanProjectId
      ? { vibeKanbanProjectId: resolvedVibeKanbanProjectId }
      : {}),
    ...(resolvedVibeKanbanRepoId
      ? { vibeKanbanRepoId: resolvedVibeKanbanRepoId }
      : {}),
  };

  if (existingIndex >= 0) {
    registry.projects[existingIndex] = reference;
    return reference;
  }

  const duplicateId = registry.projects.find(
    (project) => project.id === projectConfig.id,
  );
  if (duplicateId) {
    throw new NexusProjectError(
      `Project id is already registered at another root: ${duplicateId.id}`,
    );
  }

  ensureUniqueProject(registry, projectConfig.id, projectRoot);
  registry.projects.push(reference);
  return reference;
}

export function loadRequiredProjectConfig(projectRoot: string): NexusProjectConfig {
  return loadProjectConfig(projectRoot);
}
