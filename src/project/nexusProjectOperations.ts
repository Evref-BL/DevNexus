import fs from "node:fs";
import path from "node:path";
import type {
  NexusExtension,
  NexusProjectScaffoldContext,
  NexusProjectSkillsContext,
} from "../extensions/nexusExtension.js";
import type { NexusHomeHostOverlayConfig } from "../hosts/nexusHostRegistry.js";
import {
  nexusProjectWorktreesDirectoryName,
  loadProjectConfig,
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
import {
  scaffoldNexusProject,
  type ScaffoldNexusProjectResult,
} from "./nexusProjectScaffold.js";
import type { WorkTrackingConfig } from "../work-items/workTrackingTypes.js";

export interface NexusProjectRegistryWithRoot extends NexusProjectRegistry {
  paths: {
    projectsRoot: string;
  };
  hostOverlays?: NexusHomeHostOverlayConfig[];
}

export interface CreateNexusProjectInRegistryOptions {
  homePath: string;
  registry: NexusProjectRegistryWithRoot;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
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
  gitRunner?: ProjectGitRunner;
  extensions?: NexusProjectExtensionsConfig;
  replaceExtensions?: NexusProjectExtensionsConfig;
  clearExtensions?: readonly string[];
  scaffoldExtensions?: NexusExtension<NexusProjectConfig>[];
}

export interface CreateNexusProjectInRegistryResult {
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

export interface ImportNexusProjectInRegistryResult {
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
  sourceRoot?: string | null,
  forceGit = false,
  extensions?: NexusProjectExtensionsConfig,
): NexusProjectConfig {
  const repo = {
    kind: from || sourceRoot || forceGit ? "git" as const : "local" as const,
    remoteUrl: from ?? null,
    defaultBranch,
    ...(sourceRoot ? { sourceRoot } : {}),
  };
  return {
    version: 1,
    id: projectId,
    name,
    home: null,
    repo,
    components: [
      {
        id: "primary",
        name,
        kind: repo.kind,
        role: "primary",
        remoteUrl: repo.remoteUrl,
        defaultBranch: repo.defaultBranch,
        sourceRoot: sourceRoot ?? ".",
        relationships: [],
      },
    ],
    worktreesRoot: nexusProjectWorktreesDirectoryName,
    ...(extensions ? { extensions } : {}),
  };
}

function hasExtensionUpdates(
  options: Pick<
    ImportNexusProjectInRegistryOptions,
    "extensions" | "replaceExtensions" | "clearExtensions"
  >,
): boolean {
  return Boolean(
    options.extensions ||
      options.replaceExtensions ||
      (options.clearExtensions?.length ?? 0) > 0,
  );
}

function mergeProjectExtensionUpdates(
  existingExtensions: NexusProjectExtensionsConfig | undefined,
  options: Pick<
    ImportNexusProjectInRegistryOptions,
    "extensions" | "replaceExtensions" | "clearExtensions"
  >,
): NexusProjectExtensionsConfig | undefined {
  const extensions: NexusProjectExtensionsConfig = {};
  for (const [key, value] of Object.entries(existingExtensions ?? {})) {
    extensions[key] = { ...value };
  }

  for (const key of options.clearExtensions ?? []) {
    const extensionKey = optionalNonEmptyString(key, "clearExtensions entry");
    if (extensionKey) {
      delete extensions[extensionKey];
    }
  }

  for (const [key, value] of Object.entries(options.extensions ?? {})) {
    extensions[key] = {
      ...(extensions[key] ?? {}),
      ...value,
    };
  }

  for (const [key, value] of Object.entries(options.replaceExtensions ?? {})) {
    extensions[key] = { ...value };
  }

  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

function mergeExistingProjectExtensions(
  projectConfig: NexusProjectConfig,
  options: Pick<
    ImportNexusProjectInRegistryOptions,
    "extensions" | "replaceExtensions" | "clearExtensions"
  >,
): NexusProjectConfig {
  const { extensions: _extensions, ...projectConfigWithoutExtensions } = projectConfig;
  const extensions = mergeProjectExtensionUpdates(projectConfig.extensions, options);
  return {
    ...projectConfigWithoutExtensions,
    ...(extensions ? { extensions } : {}),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function scaffoldExtensionsWithFailureContext(
  extensions: NexusExtension<NexusProjectConfig>[] | undefined,
): NexusExtension<NexusProjectConfig>[] | undefined {
  if (!extensions) {
    return undefined;
  }

  return extensions.map((extension) => {
    const projectSkills = extension.projectSkills;
    const installProjectFiles = extension.installProjectFiles;
    return {
      ...extension,
      ...(projectSkills
        ? {
            projectSkills: (
              context: NexusProjectSkillsContext<NexusProjectConfig>,
            ) => {
              try {
                return projectSkills(context);
              } catch (error) {
                throw new NexusProjectError(
                  `extension "${extension.id}" projectSkills failed: ${errorMessage(error)}`,
                );
              }
            },
          }
        : {}),
      ...(installProjectFiles
        ? {
            installProjectFiles: (
              context: NexusProjectScaffoldContext<NexusProjectConfig>,
            ) => {
              try {
                return installProjectFiles(context);
              } catch (error) {
                throw new NexusProjectError(
                  `extension "${extension.id}" installProjectFiles failed: ${errorMessage(error)}`,
                );
              }
            },
          }
        : {}),
    };
  });
}

function cleanupPartialProjectRoot(
  projectRoot: string,
  options: { preserveRootDirectory: boolean },
): void {
  if (!fs.existsSync(projectRoot)) {
    return;
  }

  if (!options.preserveRootDirectory) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    return;
  }

  for (const entry of fs.readdirSync(projectRoot)) {
    fs.rmSync(path.join(projectRoot, entry), { recursive: true, force: true });
  }
}

function restoreProjectConfigFile(
  configPath: string,
  previousContents: string | null,
): void {
  if (previousContents === null) {
    fs.rmSync(configPath, { force: true });
    return;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, previousContents, "utf8");
}

function scaffoldNexusProjectWithRecovery(options: {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  skills: NexusProjectConfig["skills"];
  mcp: NexusProjectConfig["mcp"];
  extensions?: NexusExtension<NexusProjectConfig>[];
  recover: () => void;
  safeNextAction: string;
}): ScaffoldNexusProjectResult {
  try {
    return scaffoldNexusProject({
      homePath: options.homePath,
      projectRoot: options.projectRoot,
      worktreesRoot: options.worktreesRoot,
      projectConfig: options.projectConfig,
      skills: options.skills,
      mcp: options.mcp,
      extensions: scaffoldExtensionsWithFailureContext(options.extensions),
    });
  } catch (error) {
    let recoveryFailure: string | null = null;
    try {
      options.recover();
    } catch (recoverError) {
      recoveryFailure = errorMessage(recoverError);
    }

    throw new NexusProjectError(
      [
      `Workspace scaffold failed during extension/template setup: ${errorMessage(error)}.`,
        recoveryFailure ? `Recovery also failed: ${recoveryFailure}.` : null,
        `Safe next action: ${options.safeNextAction}`,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" "),
    );
  }
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
  const projectRootExistedBeforeCreate = fs.existsSync(projectRoot);
  if (directoryExistsAndIsNonEmpty(projectRoot)) {
    throw new NexusProjectError(
      `Workspace root already exists and is not empty: ${projectRoot}`,
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
    sourceRoot ? pathForProjectConfig(projectRoot, sourceRoot) : null,
    false,
    options.extensions,
  );
  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);

  assertFileDoesNotExist(devNexusProjectConfigPath);
  saveProjectConfig(projectRoot, projectConfig);
  const scaffold = scaffoldNexusProjectWithRecovery({
    homePath: options.homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    skills: projectConfig.skills,
    mcp: projectConfig.mcp,
    extensions: options.scaffoldExtensions,
    recover: () =>
      cleanupPartialProjectRoot(projectRoot, {
        preserveRootDirectory: projectRootExistedBeforeCreate,
      }),
    safeNextAction:
      "fix the scaffold extension failure and rerun project create; the partial workspace root was cleaned up.",
  });

  const reference = upsertNexusProjectReference(
    options.registry,
    projectRoot,
    projectConfig,
  );

  return {
    projectRoot,
    projectConfigPath: devNexusProjectConfigPath,
    worktreesRoot,
    projectConfig,
    reference,
    scaffold,
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
  const sourceRoot = path.resolve(options.root);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new NexusProjectError(
      `Workspace source root must be an existing directory: ${sourceRoot}`,
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
  const projectRootExistedBeforeImport = fs.existsSync(projectRoot);
  if (!existingProjectConfig && directoryExistsAndIsNonEmpty(projectRoot)) {
    throw new NexusProjectError(
      `Workspace root already exists and is not empty: ${projectRoot}`,
    );
  }
  if (!existingProjectConfig) {
    fs.mkdirSync(projectRoot, { recursive: true });
    runProjectGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
  }

  const projectExtensionUpdates = hasExtensionUpdates(options);
  const projectConfig = existingProjectConfig
    ? projectExtensionUpdates
      ? mergeExistingProjectExtensions(existingProjectConfig, options)
      : existingProjectConfig
    : buildProjectConfig(
        projectName,
        projectId,
        remoteUrl ?? undefined,
        defaultBranch,
        pathForProjectConfig(projectRoot, sourceRoot),
        true,
        mergeProjectExtensionUpdates(undefined, options),
      );
  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  const previousProjectConfigContents = fs.existsSync(devNexusProjectConfigPath)
    ? fs.readFileSync(devNexusProjectConfigPath, "utf8")
    : null;
  let savedProjectConfig = false;
  if (!existingProjectConfig || projectExtensionUpdates) {
    saveProjectConfig(projectRoot, projectConfig);
    savedProjectConfig = true;
  }

  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const scaffold = scaffoldNexusProjectWithRecovery({
    homePath: options.homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    skills: projectConfig.skills,
    mcp: projectConfig.mcp,
    extensions: options.scaffoldExtensions,
    recover: () => {
      if (existingProjectConfig) {
        if (savedProjectConfig) {
          restoreProjectConfigFile(
            devNexusProjectConfigPath,
            previousProjectConfigContents,
          );
        }
        return;
      }

      cleanupPartialProjectRoot(projectRoot, {
        preserveRootDirectory: projectRootExistedBeforeImport,
      });
    },
    safeNextAction: existingProjectConfig
      ? "fix the scaffold extension failure and rerun project import; the existing project checkout was not deleted and its workspace config was restored."
      : "fix the scaffold extension failure and rerun project import; the partial managed workspace root was cleaned up and the source checkout was left intact.",
  });

  const reference = upsertNexusProjectReference(
    options.registry,
    projectRoot,
    projectConfig,
  );

  return {
    projectRoot,
    projectConfigPath: devNexusProjectConfigPath,
    worktreesRoot,
    projectConfig,
    reference,
    scaffold,
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
      `DevNexus workspace is not initialized: ${projectConfigPath(projectRoot)}`,
    );
  }
  const workTracking = buildConfiguredWorkTracking(options);
  const updatedProjectConfig: NexusProjectConfig = {
    ...projectConfig,
    workTracking,
    components: projectConfig.components.map((component) =>
      component.role === "primary"
        ? {
            ...component,
            workTracking,
          }
        : component,
    ),
  };
  const projectConfigFilePath = saveProjectConfig(projectRoot, updatedProjectConfig);
  const reference = upsertNexusProjectReference(
    options.registry,
    projectRoot,
    updatedProjectConfig,
  );

  return {
    projectRoot,
    projectConfigPath: projectConfigFilePath,
    projectConfig: updatedProjectConfig,
    reference,
    workTracking,
  };
}
