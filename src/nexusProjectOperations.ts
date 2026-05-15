import fs from "node:fs";
import path from "node:path";
import type { NexusExtension } from "./nexusExtension.js";
import {
  nexusProjectWorktreesDirectoryName,
  projectConfigPath,
  projectWorktreesRootPath,
  saveProjectConfig,
  type NexusProjectConfig,
  type NexusProjectExtensionsConfig,
} from "./nexusProjectConfig.js";
import {
  assertFileDoesNotExist,
  assertGitRepository,
  defaultImportedProjectRoot,
  defaultProjectGitRunner,
  defaultSourceCheckoutDirectoryName,
  detectDefaultBranch,
  detectOriginUrl,
  directoryExistsAndIsNonEmpty,
  ensureUniqueProject,
  loadProjectConfigIfExists,
  NexusProjectError,
  optionalNonEmptyString,
  pathForProjectConfig,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  runProjectGitCommand,
  safeProjectDirectoryName,
  slugify,
} from "./nexusProjectLifecycle.js";
import {
  findNexusProjectReference,
  projectRootFromInput,
  upsertNexusProjectReference,
  type NexusProjectReference,
  type NexusProjectRegistry,
} from "./nexusProjectRegistry.js";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import type { WorkTrackingConfig } from "./workTrackingTypes.js";

export interface NexusProjectRegistryWithRoot extends NexusProjectRegistry {
  paths: {
    projectsRoot: string;
  };
}

export interface CreateNexusProjectInRegistryOptions {
  homePath: string;
  registry: NexusProjectRegistryWithRoot;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  vibeKanbanProjectId?: string;
  gitRunner?: ProjectGitRunner;
  extensions?: NexusProjectExtensionsConfig;
  scaffoldExtensions?: NexusExtension<NexusProjectConfig>[];
}

export interface ImportNexusProjectInRegistryOptions {
  homePath: string;
  registry: NexusProjectRegistryWithRoot;
  root: string;
  projectRoot?: string;
  name?: string;
  vibeKanbanProjectId?: string;
  gitRunner?: ProjectGitRunner;
  extensions?: NexusProjectExtensionsConfig;
  scaffoldExtensions?: NexusExtension<NexusProjectConfig>[];
}

export interface CreateNexusProjectInRegistryResult {
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  reference: NexusProjectReference;
  git: {
    operation: "clone" | "init";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: ProjectGitCommandResult[];
  };
}

export interface ImportNexusProjectInRegistryResult {
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  reference: NexusProjectReference;
  git: {
    operation: "import";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: ProjectGitCommandResult[];
  };
}

export type ConfigureNexusProjectTrackerProvider =
  | "local"
  | "github"
  | "gitlab"
  | "jira";

export interface ConfigureNexusProjectTrackerInRegistryOptions {
  registry: NexusProjectRegistry;
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

export interface ConfigureNexusProjectTrackerInRegistryResult {
  projectRoot: string;
  projectConfigPath: string;
  projectConfig: NexusProjectConfig;
  reference: NexusProjectReference;
  workTracking: WorkTrackingConfig;
}

export function buildProjectConfig(
  name: string,
  projectId: string,
  from: string | undefined,
  defaultBranch: string | null,
  vibeKanbanProjectId: string | null = null,
  sourceRoot?: string | null,
  forceGit = false,
  extensions?: NexusProjectExtensionsConfig,
): NexusProjectConfig {
  return {
    version: 1,
    id: projectId,
    name,
    home: null,
    repo: {
      kind: from || sourceRoot || forceGit ? "git" : "local",
      remoteUrl: from ?? null,
      defaultBranch,
      ...(sourceRoot ? { sourceRoot } : {}),
    },
    worktreesRoot: nexusProjectWorktreesDirectoryName,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId,
    },
    ...(extensions ? { extensions } : {}),
  };
}

export function buildConfiguredWorkTracking(
  options: ConfigureNexusProjectTrackerInRegistryOptions,
): WorkTrackingConfig {
  if (options.provider === "local") {
    const storePath = optionalNonEmptyString(options.storePath, "storePath");
    return {
      provider: "local",
      ...(storePath !== undefined ? { storePath } : {}),
    };
  }

  if (options.provider === "github") {
    const owner = optionalNonEmptyString(
      options.repositoryOwner,
      "repositoryOwner",
    );
    const name = optionalNonEmptyString(options.repositoryName, "repositoryName");
    if (!owner) {
      throw new NexusProjectError(
        "repositoryOwner is required for github tracker configuration",
      );
    }
    if (!name) {
      throw new NexusProjectError(
        "repositoryName is required for github tracker configuration",
      );
    }

    const host = optionalNonEmptyString(options.host, "host");
    return {
      provider: "github",
      ...(host !== undefined ? { host } : {}),
      repository: {
        owner,
        name,
      },
    };
  }

  if (options.provider === "gitlab") {
    const id = optionalNonEmptyString(options.repositoryId, "repositoryId");
    if (!id) {
      throw new NexusProjectError(
        "repositoryId is required for gitlab tracker configuration",
      );
    }

    const host = optionalNonEmptyString(options.host, "host");
    return {
      provider: "gitlab",
      ...(host !== undefined ? { host } : {}),
      repository: {
        id,
      },
    };
  }

  if (options.provider === "jira") {
    const host = optionalNonEmptyString(options.host, "host");
    const projectKey = optionalNonEmptyString(options.projectKey, "projectKey");
    const issueType = optionalNonEmptyString(options.issueType, "issueType");
    if (!host) {
      throw new NexusProjectError(
        "host is required for jira tracker configuration",
      );
    }
    if (!projectKey) {
      throw new NexusProjectError(
        "projectKey is required for jira tracker configuration",
      );
    }

    return {
      provider: "jira",
      host,
      projectKey,
      ...(issueType !== undefined ? { issueType } : {}),
    };
  }

  throw new NexusProjectError(
    `Unsupported tracker provider: ${options.provider}`,
  );
}

export function createNexusProjectInRegistry(
  options: CreateNexusProjectInRegistryOptions,
): CreateNexusProjectInRegistryResult {
  if (options.name.trim().length === 0) {
    throw new NexusProjectError("name must be a non-empty string");
  }
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  if (options.from && options.gitInit) {
    throw new NexusProjectError("--from and --git-init are mutually exclusive");
  }

  const projectId = slugify(options.name);
  const projectRoot = path.resolve(
    options.root ??
      path.join(options.registry.paths.projectsRoot, safeProjectDirectoryName(options.name)),
  );
  ensureUniqueProject(options.registry, projectId, projectRoot);

  const creatingFromRemote = Boolean(options.from);
  if (directoryExistsAndIsNonEmpty(projectRoot)) {
    throw new NexusProjectError(
      `Project root already exists and is not empty: ${projectRoot}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultProjectGitRunner;
  const gitCommands: ProjectGitCommandResult[] = [];
  let sourceRoot: string | null = null;
  if (creatingFromRemote) {
    fs.mkdirSync(projectRoot, { recursive: true });
    runProjectGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
    sourceRoot = path.join(projectRoot, defaultSourceCheckoutDirectoryName);
    runProjectGitCommand(gitRunner, gitCommands, [
      "clone",
      options.from as string,
      sourceRoot,
    ]);
  } else {
    fs.mkdirSync(projectRoot, { recursive: true });
    runProjectGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
  }

  const defaultBranch = detectDefaultBranch(
    gitRunner,
    gitCommands,
    sourceRoot ?? projectRoot,
  );
  const projectConfig = buildProjectConfig(
    options.name,
    projectId,
    options.from,
    defaultBranch,
    vibeKanbanProjectId,
    sourceRoot ? pathForProjectConfig(projectRoot, sourceRoot) : null,
    false,
    options.extensions,
  );
  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);

  assertFileDoesNotExist(devNexusProjectConfigPath);
  saveProjectConfig(projectRoot, projectConfig);
  scaffoldNexusProject({
    homePath: options.homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    extensions: options.scaffoldExtensions,
  });

  const reference = upsertNexusProjectReference(
    options.registry,
    projectRoot,
    projectConfig,
    { vibeKanbanProjectId },
  );

  return {
    projectRoot,
    projectConfigPath: devNexusProjectConfigPath,
    worktreesRoot,
    projectConfig,
    reference,
    git: {
      operation: creatingFromRemote ? "clone" : "init",
      remoteUrl: options.from ?? null,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export function importNexusProjectInRegistry(
  options: ImportNexusProjectInRegistryOptions,
): ImportNexusProjectInRegistryResult {
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  const sourceRoot = path.resolve(options.root);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new NexusProjectError(
      `Project source root must be an existing directory: ${sourceRoot}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultProjectGitRunner;
  const gitCommands: ProjectGitCommandResult[] = [];
  assertGitRepository(gitRunner, gitCommands, sourceRoot);
  const remoteUrl = detectOriginUrl(gitRunner, gitCommands, sourceRoot);
  const defaultBranch = detectDefaultBranch(gitRunner, gitCommands, sourceRoot);
  const existingProjectConfig = loadProjectConfigIfExists(sourceRoot);
  const projectName =
    existingProjectConfig?.name ?? options.name ?? path.basename(sourceRoot);
  const projectId = existingProjectConfig?.id ?? slugify(projectName);
  const projectRoot = existingProjectConfig
    ? sourceRoot
    : path.resolve(
        options.projectRoot ??
          defaultImportedProjectRoot(options.registry, projectName, sourceRoot),
      );
  ensureUniqueProject(options.registry, projectId, projectRoot);
  if (!existingProjectConfig && directoryExistsAndIsNonEmpty(projectRoot)) {
    throw new NexusProjectError(
      `Project root already exists and is not empty: ${projectRoot}`,
    );
  }
  if (!existingProjectConfig) {
    fs.mkdirSync(projectRoot, { recursive: true });
    runProjectGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
  }

  const projectConfig =
    existingProjectConfig ??
    buildProjectConfig(
      projectName,
      projectId,
      remoteUrl ?? undefined,
      defaultBranch,
      vibeKanbanProjectId,
      pathForProjectConfig(projectRoot, sourceRoot),
      true,
      options.extensions,
    );
  if (existingProjectConfig && vibeKanbanProjectId) {
    projectConfig.kanban = {
      ...projectConfig.kanban,
      projectId: vibeKanbanProjectId,
    };
  }

  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  if (!existingProjectConfig || vibeKanbanProjectId) {
    saveProjectConfig(projectRoot, projectConfig);
  }

  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  scaffoldNexusProject({
    homePath: options.homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    extensions: options.scaffoldExtensions,
  });

  const reference = upsertNexusProjectReference(
    options.registry,
    projectRoot,
    projectConfig,
    { vibeKanbanProjectId: projectConfig.kanban.projectId },
  );

  return {
    projectRoot,
    projectConfigPath: devNexusProjectConfigPath,
    worktreesRoot,
    projectConfig,
    reference,
    git: {
      operation: "import",
      remoteUrl,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export function configureNexusProjectTrackerInRegistry(
  options: ConfigureNexusProjectTrackerInRegistryOptions,
): ConfigureNexusProjectTrackerInRegistryResult {
  const existingReference = findNexusProjectReference(
    options.registry,
    options.project,
  );
  const projectRoot = existingReference
    ? path.resolve(existingReference.projectRoot)
    : projectRootFromInput(options.project);
  const projectConfig = loadProjectConfigIfExists(projectRoot);
  if (!projectConfig) {
    throw new NexusProjectError(
      `DevNexus project is not initialized: ${projectConfigPath(projectRoot)}`,
    );
  }
  const workTracking = buildConfiguredWorkTracking(options);
  const updatedProjectConfig: NexusProjectConfig = {
    ...projectConfig,
    workTracking,
  };
  const projectConfigFilePath = saveProjectConfig(projectRoot, updatedProjectConfig);
  const reference = upsertNexusProjectReference(
    options.registry,
    projectRoot,
    updatedProjectConfig,
    { vibeKanbanProjectId: null },
  );

  return {
    projectRoot,
    projectConfigPath: projectConfigFilePath,
    projectConfig: updatedProjectConfig,
    reference,
    workTracking,
  };
}
