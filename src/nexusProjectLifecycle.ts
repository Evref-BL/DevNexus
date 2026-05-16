import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfig,
  projectConfigPath,
  projectWorktreesRootPath,
  validateProjectConfig,
  type NexusProjectComponentConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  workTrackerCapabilityReportForConfig,
  workTrackerCapabilitiesForConfig,
} from "./workTrackingProviderService.js";
import type {
  TrackerCapabilities,
  WorkTrackerCapabilityReport,
} from "./workTrackingTypes.js";

export interface ProjectGitCommandResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type ProjectGitRunner = (
  args: readonly string[],
  cwd?: string,
) => ProjectGitCommandResult;

export interface NexusProjectRegistryEntry {
  id: string;
  name?: string;
  projectRoot: string;
}

export interface NexusProjectRegistryConfig {
  paths: {
    projectsRoot: string;
  };
  projects: NexusProjectRegistryEntry[];
}

export class NexusProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusProjectError";
  }
}

export function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new NexusProjectError(`${name} must be a non-empty string`);
  }
}

export function optionalNonEmptyString(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertNonEmptyString(value, name);
  return value.trim();
}

export function slugify(value: string): string {
  const withWordBreaks = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
  const slug = withWordBreaks
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new NexusProjectError(
      "Project name must contain at least one filesystem-safe character",
    );
  }

  return slug;
}

export function safeProjectDirectoryName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || slugify(value);
}

export function directoryExistsAndIsNonEmpty(directoryPath: string): boolean {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    throw new NexusProjectError(
      `Project root exists and is not a directory: ${directoryPath}`,
    );
  }

  return fs.readdirSync(directoryPath).length > 0;
}

export function assertFileDoesNotExist(filePath: string): void {
  if (fs.existsSync(filePath)) {
    throw new NexusProjectError(`Refusing to overwrite existing file: ${filePath}`);
  }
}

export const defaultSourceCheckoutDirectoryName = "git";

export interface ResolvedNexusProjectComponent {
  id: string;
  name: string;
  kind: NexusProjectComponentConfig["kind"];
  role: NexusProjectComponentConfig["role"];
  remoteUrl: string | null;
  defaultBranch: string | null;
  sourceRoot: string;
  sourceRootExists: boolean;
  worktreesRoot: string;
  worktreesRootExists: boolean;
  workTracking: NexusProjectComponentConfig["workTracking"] | null;
  workTrackingCapabilities: TrackerCapabilities | null;
  workTrackingCapabilityReport: WorkTrackerCapabilityReport | null;
  verification: NexusProjectComponentConfig["verification"] | null;
  publication: NexusProjectComponentConfig["publication"] | null;
  relationships: NexusProjectComponentConfig["relationships"];
}

export function resolveProjectSourceRoot(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  return resolvePrimaryProjectComponent(projectRoot, projectConfig).sourceRoot;
}

export function resolvePrimaryProjectComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const primary =
    components.find((component) => component.role === "primary") ?? components[0];
  if (!primary) {
    throw new NexusProjectError("DevNexus project has no components");
  }

  return primary;
}

export function resolveProjectComponents(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): ResolvedNexusProjectComponent[] {
  const normalizedConfig = validateProjectConfig(projectConfig);
  return normalizedConfig.components.map((component) =>
    resolveProjectComponent(projectRoot, normalizedConfig, component),
  );
}

export function resolveProjectComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  component: NexusProjectComponentConfig,
): ResolvedNexusProjectComponent {
  const sourceRoot = resolveProjectPath(
    projectRoot,
    component.sourceRoot ?? `components/${component.id}`,
  );
  const worktreesRoot = resolveComponentWorktreesRoot(
    projectRoot,
    projectConfig,
    component,
  );

  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    role: component.role,
    remoteUrl: component.remoteUrl,
    defaultBranch: component.defaultBranch,
    sourceRoot,
    sourceRootExists: directoryExists(sourceRoot),
    worktreesRoot,
    worktreesRootExists: directoryExists(worktreesRoot),
    workTracking: component.workTracking ?? null,
    workTrackingCapabilities: component.workTracking
      ? workTrackerCapabilitiesForConfig(component.workTracking)
      : null,
    workTrackingCapabilityReport: component.workTracking
      ? workTrackerCapabilityReportForConfig(component.workTracking)
      : null,
    verification: component.verification ?? null,
    publication: component.publication ?? null,
    relationships: component.relationships,
  };
}

function resolveComponentWorktreesRoot(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  component: NexusProjectComponentConfig,
): string {
  if (component.worktreesRoot) {
    return resolveProjectPath(projectRoot, component.worktreesRoot);
  }

  return path.join(projectWorktreesRootPath(projectRoot, projectConfig), component.id);
}

function resolveProjectPath(projectRoot: string, value: string): string {
  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(projectRoot, value);
}

function directoryExists(directoryPath: string): boolean {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

export function defaultProjectGitRunner(
  args: readonly string[],
  cwd?: string,
): ProjectGitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new NexusProjectError(
      `Failed to run git ${args.join(" ")}: ${result.error.message}`,
    );
  }

  const commandResult: ProjectGitCommandResult = {
    args: [...args],
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };

  if (result.status !== 0) {
    throw new NexusProjectError(
      `git ${args.join(" ")} failed with exit code ${result.status}: ${
        commandResult.stderr.trim() || commandResult.stdout.trim()
      }`,
    );
  }

  return commandResult;
}

export function runProjectGitCommand(
  gitRunner: ProjectGitRunner,
  commands: ProjectGitCommandResult[],
  args: readonly string[],
  cwd?: string,
): ProjectGitCommandResult {
  const result = gitRunner(args, cwd);
  commands.push(result);

  if (result.exitCode !== 0) {
    throw new NexusProjectError(
      `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  return result;
}

function tryGitCommand(
  gitRunner: ProjectGitRunner,
  commands: ProjectGitCommandResult[],
  args: readonly string[],
  cwd?: string,
): ProjectGitCommandResult | undefined {
  try {
    return runProjectGitCommand(gitRunner, commands, args, cwd);
  } catch {
    return undefined;
  }
}

export function detectDefaultBranch(
  gitRunner: ProjectGitRunner,
  commands: ProjectGitCommandResult[],
  projectRoot: string,
): string | null {
  const result = tryGitCommand(
    gitRunner,
    commands,
    ["-C", projectRoot, "symbolic-ref", "--short", "HEAD"],
  );
  const branch = result?.stdout.trim();

  return branch && branch !== "HEAD" ? branch : null;
}

export function assertGitRepository(
  gitRunner: ProjectGitRunner,
  commands: ProjectGitCommandResult[],
  projectRoot: string,
): void {
  const result = runProjectGitCommand(
    gitRunner,
    commands,
    ["-C", projectRoot, "rev-parse", "--is-inside-work-tree"],
  );

  if (result.stdout.trim() !== "true") {
    throw new NexusProjectError(
      `Path is not inside a Git work tree: ${projectRoot}`,
    );
  }
}

export function detectOriginUrl(
  gitRunner: ProjectGitRunner,
  commands: ProjectGitCommandResult[],
  projectRoot: string,
): string | null {
  const result = tryGitCommand(
    gitRunner,
    commands,
    ["-C", projectRoot, "config", "--get", "remote.origin.url"],
  );
  const remoteUrl = result?.stdout.trim();

  return remoteUrl || null;
}

function normalizedPathForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function samePath(left: string, right: string): boolean {
  return normalizedPathForCompare(left) === normalizedPathForCompare(right);
}

export function ensureUniqueProject(
  config: Pick<NexusProjectRegistryConfig, "projects">,
  projectId: string,
  projectRoot: string,
): void {
  const duplicate = config.projects.find(
    (project) =>
      project.id === projectId || samePath(project.projectRoot, projectRoot),
  );

  if (duplicate) {
    throw new NexusProjectError(
      `Project is already registered: ${duplicate.id}`,
    );
  }
}

export function pathForProjectConfig(
  projectRoot: string,
  targetPath: string,
): string {
  const relative = path.relative(projectRoot, targetPath);
  if (
    relative &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  ) {
    return relative;
  }

  return path.resolve(targetPath);
}

export function defaultImportedProjectRoot(
  homeConfig: NexusProjectRegistryConfig,
  projectName: string,
  sourceRoot: string,
): string {
  const directoryName = safeProjectDirectoryName(projectName);
  const candidate = path.join(homeConfig.paths.projectsRoot, directoryName);
  return samePath(candidate, sourceRoot)
    ? path.join(homeConfig.paths.projectsRoot, `${directoryName}-DevNexus`)
    : candidate;
}

export function loadProjectConfigIfExists(
  projectRoot: string,
): NexusProjectConfig | undefined {
  if (!fs.existsSync(projectConfigPath(projectRoot))) {
    return undefined;
  }

  return loadProjectConfig(projectRoot);
}
