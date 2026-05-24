import path from "node:path";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import {
  assertNonEmptyString,
  NexusProjectError,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
} from "./nexusProjectLifecycle.js";
import {
  configureNexusProjectTrackerInRegistry,
  createNexusProjectInRegistry,
  importNexusProjectInRegistry,
  type ConfigureNexusProjectTrackerProvider,
  type NexusProjectRegistryWithRoot,
} from "./nexusProjectOperations.js";
import {
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
  findNexusProjectReferenceById,
  findNexusProjectReferenceByPath,
  projectRootFromInput,
  type NexusProjectReference,
  type NexusProjectStatusBase,
} from "./nexusProjectRegistry.js";
import type { ScaffoldNexusProjectResult } from "./nexusProjectScaffold.js";
import type { WorkTrackingConfig } from "../work-items/workTrackingTypes.js";

export interface NexusProjectHomeStore<
  Registry extends NexusProjectRegistryWithRoot = NexusProjectRegistryWithRoot,
> {
  resolveHomePath(homePath: string): string;
  loadHomeConfig(homePath: string): Registry;
  saveHomeConfig(homePath: string, registry: Registry): string;
}

export interface CreateNexusProjectOptions {
  homePath: string;
  homeStore: NexusProjectHomeStore;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  gitRunner?: ProjectGitRunner;
}

export interface ImportNexusProjectOptions {
  homePath: string;
  homeStore: NexusProjectHomeStore;
  root: string;
  projectRoot?: string;
  name?: string;
  gitRunner?: ProjectGitRunner;
}

export interface CreateNexusProjectResult {
  homePath: string;
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  reference: NexusProjectReference;
  scaffold: ScaffoldNexusProjectResult;
  git: {
    operation: "clone" | "init";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: ProjectGitCommandResult[];
  };
}

export interface ImportNexusProjectResult {
  homePath: string;
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  reference: NexusProjectReference;
  scaffold: ScaffoldNexusProjectResult;
  git: {
    operation: "import";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: ProjectGitCommandResult[];
  };
}

export interface ListNexusProjectsOptions {
  homePath: string;
  homeStore: NexusProjectHomeStore;
}

export interface ListNexusProjectsResult {
  homePath: string;
  projects: NexusProjectStatusBase[];
}

export interface GetNexusProjectStatusOptions {
  homePath: string;
  homeStore: NexusProjectHomeStore;
  project: string;
}

export interface GetNexusProjectStatusResult {
  homePath: string;
  project: NexusProjectStatusBase;
}

export interface ConfigureNexusProjectTrackerOptions {
  homePath: string;
  homeStore: NexusProjectHomeStore;
  project: string;
  provider: ConfigureNexusProjectTrackerProvider;
  host?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryId?: string;
  projectKey?: string;
  issueType?: string;
  storePath?: string;
}

export interface ConfigureNexusProjectTrackerResult {
  homePath: string;
  project: NexusProjectStatusBase;
  projectRoot: string;
  projectConfigPath: string;
  projectConfig: NexusProjectConfig;
  reference: NexusProjectReference;
  workTracking: WorkTrackingConfig;
}

interface LoadedProjectHome {
  homePath: string;
  registry: NexusProjectRegistryWithRoot;
}

function loadProjectHome(options: {
  homePath: string;
  homeStore: NexusProjectHomeStore;
}): LoadedProjectHome {
  const homePath = options.homeStore.resolveHomePath(options.homePath);
  return {
    homePath,
    registry: options.homeStore.loadHomeConfig(homePath),
  };
}

function saveProjectHome(
  homeStore: NexusProjectHomeStore,
  homePath: string,
  registry: NexusProjectRegistryWithRoot,
): void {
  homeStore.saveHomeConfig(homePath, registry);
}

export function statusForNexusProjectReference(
  reference: NexusProjectReference,
  homeConfig?: NexusProjectRegistryWithRoot,
): NexusProjectStatusBase {
  return buildNexusProjectStatus(reference, { homeConfig });
}

function statusForNexusProjectPath(
  projectRoot: string,
  homeConfig?: NexusProjectRegistryWithRoot,
): NexusProjectStatusBase {
  const baseStatus = buildNexusProjectStatusForPath(projectRoot, { homeConfig });
  return statusForNexusProjectReference({
    id: baseStatus.id,
    name: baseStatus.name,
    projectRoot: baseStatus.projectRoot,
  }, homeConfig);
}

export function createNexusProject(
  options: CreateNexusProjectOptions,
): CreateNexusProjectResult {
  const { homePath, registry } = loadProjectHome(options);
  const result = createNexusProjectInRegistry({
    homePath,
    registry,
    name: options.name,
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.gitInit !== undefined ? { gitInit: options.gitInit } : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });
  saveProjectHome(options.homeStore, homePath, registry);

  return {
    homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    worktreesRoot: result.worktreesRoot,
    projectConfig: result.projectConfig,
    reference: result.reference,
    scaffold: result.scaffold,
    git: result.git,
  };
}

export function importNexusProject(
  options: ImportNexusProjectOptions,
): ImportNexusProjectResult {
  const { homePath, registry } = loadProjectHome(options);
  const result = importNexusProjectInRegistry({
    homePath,
    registry,
    root: options.root,
    ...(options.projectRoot !== undefined
      ? { projectRoot: options.projectRoot }
      : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });
  saveProjectHome(options.homeStore, homePath, registry);

  return {
    homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    worktreesRoot: result.worktreesRoot,
    projectConfig: result.projectConfig,
    reference: result.reference,
    scaffold: result.scaffold,
    git: result.git,
  };
}

export function listNexusProjects(
  options: ListNexusProjectsOptions,
): ListNexusProjectsResult {
  const { homePath, registry } = loadProjectHome(options);

  return {
    homePath,
    projects: registry.projects.map((reference) =>
      statusForNexusProjectReference(reference, registry),
    ),
  };
}

export function getNexusProjectStatus(
  options: GetNexusProjectStatusOptions,
): GetNexusProjectStatusResult {
  assertNonEmptyString(options.project, "project");

  const { homePath, registry } = loadProjectHome(options);
  const projectSelector = options.project.trim();
  const reference =
    findNexusProjectReferenceById(registry, projectSelector) ??
    findNexusProjectReferenceByPath(registry, projectSelector);
  let project: NexusProjectStatusBase;
  if (reference) {
    project = statusForNexusProjectReference(reference, registry);
  } else {
    const projectRoot = projectRootFromInput(projectSelector);
    try {
      project = statusForNexusProjectPath(projectRoot, registry);
    } catch (error) {
      if (error instanceof NexusProjectError) {
        throw new NexusProjectError(
          `No registered project matched "${projectSelector}". ` +
            `Path fallback checked "${path.resolve(projectRoot)}" and failed: ${error.message}`,
        );
      }

      throw error;
    }
  }

  return {
    homePath,
    project,
  };
}

export function configureNexusProjectTracker(
  options: ConfigureNexusProjectTrackerOptions,
): ConfigureNexusProjectTrackerResult {
  assertNonEmptyString(options.project, "project");
  assertNonEmptyString(options.provider, "provider");

  const { homePath, registry } = loadProjectHome(options);
  const result = configureNexusProjectTrackerInRegistry({
    registry,
    project: options.project,
    provider: options.provider,
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.repositoryOwner !== undefined
      ? { repositoryOwner: options.repositoryOwner }
      : {}),
    ...(options.repositoryName !== undefined
      ? { repositoryName: options.repositoryName }
      : {}),
    ...(options.repositoryId !== undefined
      ? { repositoryId: options.repositoryId }
      : {}),
    ...(options.projectKey !== undefined ? { projectKey: options.projectKey } : {}),
    ...(options.issueType !== undefined ? { issueType: options.issueType } : {}),
    ...(options.storePath !== undefined ? { storePath: options.storePath } : {}),
  });
  saveProjectHome(options.homeStore, homePath, registry);

  return {
    homePath,
    project: statusForNexusProjectReference(result.reference),
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    projectConfig: result.projectConfig,
    reference: result.reference,
    workTracking: result.workTracking,
  };
}
