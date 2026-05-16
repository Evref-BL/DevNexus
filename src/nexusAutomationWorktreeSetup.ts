import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  defaultGitRunner,
  type GitRunner,
} from "./gitWorktreeService.js";
import type {
  NexusAutomationConfig,
  NexusAutomationDependencyLinkConfig,
} from "./nexusAutomationConfig.js";
import {
  materializeNexusWorkerContextBundle,
  type MaterializeNexusWorkerContextBundleResult,
  type NexusWorkerContextAgentSkillProjection,
  type NexusWorkerContextSkillReference,
  type NexusWorkerContextBundleWorktree,
} from "./nexusWorkerContextBundle.js";
import {
  nexusSkillManifestFileName,
  nexusSkillMarkdownFileName,
  nexusSkillsDirectoryName,
  nexusSkillSupportDirectoryName,
  type NexusProjectSkillAgentTarget,
  type NexusProjectSkillsConfig,
  type NexusSkillManifest,
  type NexusSkillMaterializationMode,
  type NexusSkillSourceControl,
} from "./nexusSkills.js";

export type NexusAutomationWorktreeSetupLinkStatus =
  | "linked"
  | "present"
  | "skipped";

export interface NexusAutomationWorktreeSetupPreflightCheck {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface NexusAutomationWorktreeSetupLinkResult {
  source: string;
  target: string;
  sourcePath: string;
  targetPath: string;
  required: boolean;
  status: NexusAutomationWorktreeSetupLinkStatus;
  message: string;
}

export type NexusAutomationWorktreeSkillProjectionStatus =
  | "missing"
  | "stale"
  | "present";

export interface NexusAutomationWorktreeSkillProjectionSkillResult {
  id: string;
  name: string;
  version: string;
  materialization: NexusSkillMaterializationMode;
  sourceSkillRoot: string;
  projectedSkillRoot: string;
  skillPath: string | null;
  beforeStatus: NexusAutomationWorktreeSkillProjectionStatus;
  afterStatus: NexusAutomationWorktreeSkillProjectionStatus;
  refreshed: boolean;
  reasons: string[];
}

export interface NexusAutomationWorktreeSkillProjectionResult {
  agent: string;
  projectManagedSkillsRoot: string;
  skillsDirectory: string;
  sourceControl: NexusSkillSourceControl;
  skills: NexusAutomationWorktreeSkillProjectionSkillResult[];
}

export interface NexusAutomationWorktreeSetupResult {
  links: NexusAutomationWorktreeSetupLinkResult[];
  skillProjections: NexusAutomationWorktreeSkillProjectionResult[];
  context?: MaterializeNexusWorkerContextBundleResult;
}

export interface NexusAutomationWorktreeSetupContextInput {
  project: {
    id?: string | null;
    name?: string | null;
    root: string;
  };
  ownership: NexusWorkerContextBundleWorktree;
  targetStatePath?: string | null;
}

export interface NexusAutomationWorktreeSetupOptions {
  sourceRoot: string;
  worktreesRoot?: string;
  worktreePath: string;
  automationConfig: NexusAutomationConfig;
  skillsConfig?: NexusProjectSkillsConfig;
  context?: NexusAutomationWorktreeSetupContextInput;
  gitRunner?: GitRunner;
  platform?: NodeJS.Platform;
}

export class NexusAutomationWorktreeSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationWorktreeSetupError";
  }
}

export function preflightNexusAutomationWorktreeSetup(options: {
  sourceRoot: string;
  automationConfig: NexusAutomationConfig;
}): NexusAutomationWorktreeSetupPreflightCheck[] {
  const sourceRoot = path.resolve(
    requiredNonEmptyString(options.sourceRoot, "sourceRoot"),
  );

  return options.automationConfig.setup.dependencyLinks.map((link, index) => {
      const name = `dependencyLink:${index}`;
      try {
        const sourcePath = resolveInsideRoot(sourceRoot, link.source, "source");
      resolveInsideRoot(sourceRoot, link.target, "target");
      if (!fs.existsSync(sourcePath)) {
        if (link.required) {
          return {
            name,
            status: "failed",
            message: `Required dependency link source does not exist: ${sourcePath}`,
          };
        }

        return {
          name,
          status: "passed",
          message: `Optional dependency link source is absent and will be skipped: ${sourcePath}`,
        };
      }

      return {
        name,
        status: "passed",
        message: `Dependency link ${link.source} -> ${link.target} is safe to materialize`,
      };
    } catch (error) {
      return {
        name,
        status: "failed",
        message: errorMessage(error),
      };
    }
  });
}

export function materializeNexusAutomationWorktreeSetup(
  options: NexusAutomationWorktreeSetupOptions,
): NexusAutomationWorktreeSetupResult {
  const sourceRoot = path.resolve(
    requiredNonEmptyString(options.sourceRoot, "sourceRoot"),
  );
  const worktreePath = path.resolve(
    requiredNonEmptyString(options.worktreePath, "worktreePath"),
  );
  if (options.worktreesRoot) {
    assertWorktreePathInsideRoot(options.worktreesRoot, worktreePath);
  }
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const platform = options.platform ?? process.platform;

  const links = options.automationConfig.setup.dependencyLinks.map((link) =>
    materializeDependencyLink({
      link,
      sourceRoot,
      worktreePath,
      gitRunner,
      platform,
    }),
  );
  const skillProjections = options.context
    ? materializeWorkerSkillProjections({
        projectRoot: options.context.project.root,
        worktreePath,
        skillsConfig: options.skillsConfig,
        gitRunner,
        platform,
      })
    : [];
  const context = options.context
    ? materializeWorkerContext({
        context: options.context,
        automationConfig: options.automationConfig,
        sourceRoot,
        worktreesRoot: options.worktreesRoot,
        worktreePath,
        gitRunner,
        skillProjections,
      })
    : undefined;

  return {
    links,
    skillProjections,
    ...(context ? { context } : {}),
  };
}

function materializeWorkerContext(options: {
  context: NexusAutomationWorktreeSetupContextInput;
  automationConfig: NexusAutomationConfig;
  sourceRoot: string;
  worktreesRoot?: string;
  worktreePath: string;
  gitRunner: GitRunner;
  skillProjections: NexusAutomationWorktreeSkillProjectionResult[];
}): MaterializeNexusWorkerContextBundleResult {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.context.project.root, "context.project.root"),
  );
  const ownership = options.context.ownership;
  const ownershipSourceRoot = path.resolve(
    requiredNonEmptyString(ownership.sourceRoot, "context.ownership.sourceRoot"),
  );
  const ownershipWorktreesRoot = path.resolve(
    requiredNonEmptyString(
      ownership.worktreesRoot,
      "context.ownership.worktreesRoot",
    ),
  );
  const ownershipWorktreePath = path.resolve(
    requiredNonEmptyString(
      ownership.worktreePath,
      "context.ownership.worktreePath",
    ),
  );

  if (ownershipSourceRoot !== options.sourceRoot) {
    throw new NexusAutomationWorktreeSetupError(
      `context.ownership.sourceRoot must match sourceRoot: ${ownershipSourceRoot}`,
    );
  }
  if (options.worktreesRoot) {
    const setupWorktreesRoot = path.resolve(options.worktreesRoot);
    if (ownershipWorktreesRoot !== setupWorktreesRoot) {
      throw new NexusAutomationWorktreeSetupError(
        `context.ownership.worktreesRoot must match worktreesRoot: ${ownershipWorktreesRoot}`,
      );
    }
  }
  if (ownershipWorktreePath !== options.worktreePath) {
    throw new NexusAutomationWorktreeSetupError(
      `context.ownership.worktreePath must match worktreePath: ${ownershipWorktreePath}`,
    );
  }

  const result = materializeNexusWorkerContextBundle({
    projectRoot,
    projectId: options.context.project.id ?? null,
    projectName: options.context.project.name ?? null,
    componentId: ownership.componentId,
    sourceRoot: ownershipSourceRoot,
    worktreesRoot: ownershipWorktreesRoot,
    worktreePath: ownershipWorktreePath,
    branchName: ownership.branchName,
    baseRef: ownership.baseRef,
    workItem: ownership.workItem,
    targetStatePath:
      options.context.targetStatePath ?? options.automationConfig.target.statePath,
    skills: workerContextSkillsFromProjections(
      projectRoot,
      options.skillProjections,
    ),
  });
  addGitInfoExclude({
    worktreePath: options.worktreePath,
    targetPath: result.contextDirectoryPath,
    isDirectory: true,
    gitRunner: options.gitRunner,
  });

  return result;
}

interface ProjectManagedSkillEntry {
  id: string;
  manifest: NexusSkillManifest;
  skillRoot: string;
}

function materializeWorkerSkillProjections(options: {
  projectRoot: string;
  worktreePath: string;
  skillsConfig?: NexusProjectSkillsConfig;
  gitRunner: GitRunner;
  platform: NodeJS.Platform;
}): NexusAutomationWorktreeSkillProjectionResult[] {
  const enabledTargets = (options.skillsConfig?.agentTargets ?? []).filter(
    (target) => target.enabled !== false,
  );
  if (enabledTargets.length === 0) {
    return [];
  }

  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const worktreePath = path.resolve(
    requiredNonEmptyString(options.worktreePath, "worktreePath"),
  );
  const projectManagedSkillsRoot = path.join(
    projectRoot,
    nexusSkillSupportDirectoryName,
    nexusSkillsDirectoryName,
  );
  if (!fs.existsSync(projectManagedSkillsRoot)) {
    throw new NexusAutomationWorktreeSetupError(
      `Project-managed skills root does not exist: ${projectManagedSkillsRoot}`,
    );
  }

  const installedSkills = readProjectManagedSkills(projectManagedSkillsRoot);
  const selectedSkillIds = selectedProjectSkillIds(
    installedSkills.map((skill) => skill.id),
    options.skillsConfig,
  );
  const installedById = new Map(
    installedSkills.map((skill) => [skill.id, skill] as const),
  );

  return enabledTargets.map((target) => {
    const skillsDirectory = resolveWorkerAgentSkillsDirectory(
      worktreePath,
      target,
    );
    const sourceControl =
      target.sourceControl ?? options.skillsConfig?.sourceControl ?? "support";
    const skills = selectedSkillIds
      .map((skillId) => installedById.get(skillId))
      .filter((skill): skill is ProjectManagedSkillEntry => Boolean(skill))
      .filter((skill) => skill.manifest.supportedAgents.includes(target.agent))
      .map((skill) =>
        materializeProjectedWorkerSkill({
          skill,
          skillsDirectory,
          platform: options.platform,
        }),
      );

    if (sourceControl === "support" && skills.length > 0) {
      addGitInfoExclude({
        worktreePath,
        targetPath: skillsDirectory,
        isDirectory: true,
        gitRunner: options.gitRunner,
      });
    }

    return {
      agent: target.agent,
      projectManagedSkillsRoot,
      skillsDirectory,
      sourceControl,
      skills,
    };
  });
}

function workerContextSkillsFromProjections(
  projectRoot: string,
  skillProjections: NexusAutomationWorktreeSkillProjectionResult[],
): {
  projectManagedRoot: string;
  agentNativeProjections: NexusWorkerContextAgentSkillProjection[];
} {
  const projectManagedRoot =
    skillProjections[0]?.projectManagedSkillsRoot ??
    path.join(
      projectRoot,
      nexusSkillSupportDirectoryName,
      nexusSkillsDirectoryName,
    );

  return {
    projectManagedRoot,
    agentNativeProjections: skillProjections.map((projection) => ({
      agent: projection.agent,
      skillsDirectory: projection.skillsDirectory,
      sourceControl: projection.sourceControl,
      skills: projection.skills.map(
        (skill): NexusWorkerContextSkillReference => ({
          id: skill.id,
          sourceSkillRoot: skill.sourceSkillRoot,
          projectedSkillRoot: skill.projectedSkillRoot,
          skillPath: skill.skillPath,
        }),
      ),
    })),
  };
}

function readProjectManagedSkills(
  projectManagedSkillsRoot: string,
): ProjectManagedSkillEntry[] {
  return fs
    .readdirSync(projectManagedSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readProjectManagedSkill(
        path.join(projectManagedSkillsRoot, entry.name),
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readProjectManagedSkill(skillRoot: string): ProjectManagedSkillEntry {
  const manifestPath = path.join(skillRoot, nexusSkillManifestFileName);
  if (!fs.existsSync(manifestPath)) {
    throw new NexusAutomationWorktreeSetupError(
      `Project-managed skill manifest is missing: ${manifestPath}`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!isNexusSkillManifest(parsed)) {
    throw new NexusAutomationWorktreeSetupError(
      `Project-managed skill manifest is invalid: ${manifestPath}`,
    );
  }

  return {
    id: parsed.id,
    manifest: parsed,
    skillRoot,
  };
}

function selectedProjectSkillIds(
  installedSkillIds: string[],
  skillsConfig: NexusProjectSkillsConfig | undefined,
): string[] {
  const selected =
    skillsConfig?.defaultCorePack === false ? new Set<string>() : new Set(installedSkillIds);
  const order =
    skillsConfig?.defaultCorePack === false ? [] : [...installedSkillIds].sort();

  for (const item of skillsConfig?.items ?? []) {
    if (item.enabled === false) {
      selected.delete(item.id);
      continue;
    }

    if (!selected.has(item.id)) {
      order.push(item.id);
    }
    selected.add(item.id);
  }

  return order.filter((skillId) => selected.has(skillId));
}

function materializeProjectedWorkerSkill(options: {
  skill: ProjectManagedSkillEntry;
  skillsDirectory: string;
  platform: NodeJS.Platform;
}): NexusAutomationWorktreeSkillProjectionSkillResult {
  const projectedSkillRoot = path.join(
    options.skillsDirectory,
    options.skill.manifest.id,
  );
  const skillPath =
    options.skill.manifest.materialization === "reference"
      ? null
      : path.join(projectedSkillRoot, nexusSkillMarkdownFileName);
  const before = inspectProjectedWorkerSkill({
    skill: options.skill,
    projectedSkillRoot,
  });

  if (before.status !== "present") {
    refreshProjectedWorkerSkill({
      sourceSkillRoot: options.skill.skillRoot,
      projectedSkillRoot,
      materialization: options.skill.manifest.materialization,
      platform: options.platform,
    });
  }

  const after = inspectProjectedWorkerSkill({
    skill: options.skill,
    projectedSkillRoot,
  });

  return {
    id: options.skill.manifest.id,
    name: options.skill.manifest.name,
    version: options.skill.manifest.version,
    materialization: options.skill.manifest.materialization,
    sourceSkillRoot: options.skill.skillRoot,
    projectedSkillRoot,
    skillPath,
    beforeStatus: before.status,
    afterStatus: after.status,
    refreshed: before.status !== "present",
    reasons: before.reasons,
  };
}

function inspectProjectedWorkerSkill(options: {
  skill: ProjectManagedSkillEntry;
  projectedSkillRoot: string;
}): {
  status: NexusAutomationWorktreeSkillProjectionStatus;
  reasons: string[];
} {
  if (!fs.existsSync(options.projectedSkillRoot)) {
    return {
      status: "missing",
      reasons: ["projected skill is missing"],
    };
  }

  const reasons: string[] = [];
  if (options.skill.manifest.materialization === "symlink") {
    const stat = fs.lstatSync(options.projectedSkillRoot);
    if (!stat.isSymbolicLink()) {
      reasons.push("projected skill root is not a symlink");
    } else {
      const actual = fs.realpathSync(options.projectedSkillRoot);
      const expected = fs.realpathSync(options.skill.skillRoot);
      if (actual !== expected) {
        reasons.push("projected skill symlink points at a different source");
      }
    }
  } else if (options.skill.manifest.materialization === "copy") {
    const sourceFiles = relativeSkillFiles(options.skill.skillRoot, false);
    const targetFiles = relativeSkillFiles(options.projectedSkillRoot, true);
    const expectedFiles = new Set(sourceFiles);
    for (const filePath of sourceFiles) {
      const sourcePath = path.join(options.skill.skillRoot, filePath);
      const targetPath = path.join(options.projectedSkillRoot, filePath);
      if (!fs.existsSync(targetPath)) {
        reasons.push(`projected skill file is missing: ${filePath}`);
        continue;
      }
      if (fs.readFileSync(targetPath, "utf8") !== fs.readFileSync(sourcePath, "utf8")) {
        reasons.push(`projected skill file differs: ${filePath}`);
      }
    }
    for (const filePath of targetFiles) {
      if (!expectedFiles.has(filePath)) {
        reasons.push(`projected skill has an unexpected file: ${filePath}`);
      }
    }
  }

  return {
    status: reasons.length > 0 ? "stale" : "present",
    reasons,
  };
}

function refreshProjectedWorkerSkill(options: {
  sourceSkillRoot: string;
  projectedSkillRoot: string;
  materialization: NexusSkillMaterializationMode;
  platform: NodeJS.Platform;
}): void {
  fs.rmSync(options.projectedSkillRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(options.projectedSkillRoot), { recursive: true });
  if (options.materialization === "symlink") {
    fs.symlinkSync(
      options.sourceSkillRoot,
      options.projectedSkillRoot,
      options.platform === "win32" ? "junction" : "dir",
    );
    return;
  }

  if (options.materialization === "reference") {
    fs.mkdirSync(options.projectedSkillRoot, { recursive: true });
    return;
  }

  copySkillProjectionFiles(options.sourceSkillRoot, options.projectedSkillRoot);
}

function copySkillProjectionFiles(sourceRoot: string, targetRoot: string): void {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === nexusSkillManifestFileName) {
      continue;
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      copySkillProjectionFiles(sourcePath, targetPath);
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function relativeSkillFiles(root: string, includeManifest: boolean): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  collectRelativeSkillFiles(root, root, includeManifest, files);
  return files.sort();
}

function collectRelativeSkillFiles(
  root: string,
  current: string,
  includeManifest: boolean,
  files: string[],
): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    const relative = path.relative(root, entryPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      collectRelativeSkillFiles(root, entryPath, includeManifest, files);
      continue;
    }
    if (!includeManifest && relative === nexusSkillManifestFileName) {
      continue;
    }

    files.push(relative);
  }
}

function resolveWorkerAgentSkillsDirectory(
  worktreePath: string,
  target: NexusProjectSkillAgentTarget,
): string {
  const directory = target.directory ?? defaultWorkerAgentSkillsDirectory(target.agent);
  if (!directory) {
    throw new NexusAutomationWorktreeSetupError(
      `Agent skill target ${target.agent} must define directory`,
    );
  }

  return resolveInsideRoot(worktreePath, directory, "skills agent target directory");
}

function defaultWorkerAgentSkillsDirectory(agent: string): string | null {
  if (agent === "codex") {
    return path.join(".agents", "skills");
  }
  if (agent === "claude") {
    return path.join(".claude", "skills");
  }

  return null;
}

function isNexusSkillManifest(value: unknown): value is NexusSkillManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.version === "string" &&
    typeof record.license === "string" &&
    record.source !== null &&
    typeof record.source === "object" &&
    !Array.isArray(record.source) &&
    Array.isArray(record.supportedAgents) &&
    record.supportedAgents.every((agent) => typeof agent === "string") &&
    (record.materialization === "copy" ||
      record.materialization === "symlink" ||
      record.materialization === "reference") &&
    (record.sourceControl === "support" || record.sourceControl === "source")
  );
}

function materializeDependencyLink(options: {
  link: NexusAutomationDependencyLinkConfig;
  sourceRoot: string;
  worktreePath: string;
  gitRunner: GitRunner;
  platform: NodeJS.Platform;
}): NexusAutomationWorktreeSetupLinkResult {
  const sourcePath = resolveInsideRoot(
    options.sourceRoot,
    options.link.source,
    "source",
  );
  const targetPath = resolveInsideRoot(
    options.worktreePath,
    options.link.target,
    "target",
  );

  if (!fs.existsSync(sourcePath)) {
    if (options.link.required) {
      throw new NexusAutomationWorktreeSetupError(
        `Required dependency link source does not exist: ${sourcePath}`,
      );
    }

    return linkResult({
      link: options.link,
      sourcePath,
      targetPath,
      status: "skipped",
      message: `Optional dependency link source is absent: ${sourcePath}`,
    });
  }

  if (fs.existsSync(targetPath)) {
    return linkResult({
      link: options.link,
      sourcePath,
      targetPath,
      status: "present",
      message: `Dependency link target already exists: ${targetPath}`,
    });
  }

  const sourceStats = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.symlinkSync(
    sourcePath,
    targetPath,
    symlinkType(sourceStats, options.platform),
  );
  addGitInfoExclude({
    worktreePath: options.worktreePath,
    targetPath,
    isDirectory: sourceStats.isDirectory(),
    gitRunner: options.gitRunner,
  });

  return linkResult({
    link: options.link,
    sourcePath,
    targetPath,
    status: "linked",
    message: `Linked dependency ${sourcePath} -> ${targetPath}`,
  });
}

function addGitInfoExclude(options: {
  worktreePath: string;
  targetPath: string;
  isDirectory: boolean;
  gitRunner: GitRunner;
}): void {
  const result = options.gitRunner(
    ["rev-parse", "--git-path", "info/exclude"],
    options.worktreePath,
  );
  if (result.exitCode !== 0) {
    throw new NexusAutomationWorktreeSetupError(
      `git rev-parse --git-path info/exclude failed: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  const rawPath = result.stdout.trim();
  if (!rawPath) {
    throw new NexusAutomationWorktreeSetupError(
      "git rev-parse --git-path info/exclude returned an empty path",
    );
  }

  const excludePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(options.worktreePath, rawPath);
  const entry = gitExcludeEntry(
    options.worktreePath,
    options.targetPath,
    options.isDirectory,
  );
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8").split(/\r?\n/u)
    : [];
  if (!existing.includes(entry)) {
    fs.appendFileSync(excludePath, `${entry}\n`, "utf8");
  }
}

function gitExcludeEntry(
  worktreePath: string,
  targetPath: string,
  isDirectory: boolean,
): string {
  const relative = path.relative(path.resolve(worktreePath), path.resolve(targetPath));
  const normalized = relative.split(path.sep).join("/");
  return isDirectory && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function symlinkType(
  sourceStats: fs.Stats,
  platform: NodeJS.Platform,
): fs.symlink.Type {
  if (!sourceStats.isDirectory()) {
    return "file";
  }

  return platform === "win32" ? "junction" : "dir";
}

function linkResult(options: {
  link: NexusAutomationDependencyLinkConfig;
  sourcePath: string;
  targetPath: string;
  status: NexusAutomationWorktreeSetupLinkStatus;
  message: string;
}): NexusAutomationWorktreeSetupLinkResult {
  return {
    source: options.link.source,
    target: options.link.target,
    sourcePath: options.sourcePath,
    targetPath: options.targetPath,
    required: options.link.required,
    status: options.status,
    message: options.message,
  };
}

function resolveInsideRoot(root: string, value: string, name: string): string {
  const trimmed = requiredNonEmptyString(value, name);
  if (path.isAbsolute(trimmed)) {
    throw new NexusAutomationWorktreeSetupError(
      `${name} must be relative: ${trimmed}`,
    );
  }

  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, trimmed);
  const relative = path.relative(rootPath, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationWorktreeSetupError(
      `${name} must resolve inside ${rootPath}: ${trimmed}`,
    );
  }

  return resolved;
}

function assertWorktreePathInsideRoot(
  worktreesRoot: string,
  worktreePath: string,
): void {
  const rootPath = path.resolve(
    requiredNonEmptyString(worktreesRoot, "worktreesRoot"),
  );
  const resolvedWorktreePath = path.resolve(worktreePath);
  const relative = path.relative(rootPath, resolvedWorktreePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationWorktreeSetupError(
      `worktreePath must resolve inside worktreesRoot: ${resolvedWorktreePath}`,
    );
  }
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationWorktreeSetupError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
