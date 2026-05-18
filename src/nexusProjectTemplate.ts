import fs from "node:fs";
import path from "node:path";
import type { NexusProjectMcpConfig } from "./nexusProjectConfig.js";
import {
  activeNexusProjectMcpAgentTargets,
  activeNexusProjectSkillAgentTargets,
  devNexusProjectConfigFileName,
  projectWorktreesRootPath,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { resolveProjectComponents } from "./nexusProjectLifecycle.js";
import type {
  NexusProjectSkillAgentTarget,
  NexusProjectSkillsConfig,
  NexusSkillSourceControl,
} from "./nexusSkills.js";
import { defaultLocalWorkTrackingStorePath } from "./workTrackingLocalProvider.js";
import type { WorkTrackingConfig } from "./workTrackingTypes.js";

export type NexusProjectTemplateArea =
  | "project_state"
  | "component_configuration"
  | "target_state"
  | "skills"
  | "agent_mcp_projection";

export type NexusProjectTemplateOwner =
  | "generated"
  | "user_authored"
  | "local_runtime";

export interface NexusProjectTemplateEntry {
  area: NexusProjectTemplateArea;
  owner: NexusProjectTemplateOwner;
  path: string;
  sourceControl: NexusSkillSourceControl | "local";
  description: string;
}

export interface NexusProjectTemplateLayout {
  entries: NexusProjectTemplateEntry[];
  migrationNotes: string[];
}

export interface MaterializeNexusProjectTemplateOptions {
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  skillsConfig?: NexusProjectSkillsConfig | false;
  mcpConfig?: NexusProjectMcpConfig | false;
  excludeFromGit?: boolean;
}

export interface MaterializeNexusProjectTemplateResult
  extends NexusProjectTemplateLayout {
  supportReadmePath: string;
  targetStatePath: string | null;
  componentWorktreesRoots: string[];
  gitExcludePath: string | null;
  gitExcludeEntries: string[];
}

export function buildNexusProjectTemplateLayout(
  options: Omit<MaterializeNexusProjectTemplateOptions, "excludeFromGit">,
): NexusProjectTemplateLayout {
  const projectRoot = path.resolve(options.projectRoot);
  const components = resolveProjectComponents(projectRoot, options.projectConfig);
  const automationConfig = options.projectConfig.automation;
  const entries: NexusProjectTemplateEntry[] = [
    {
      area: "component_configuration",
      owner: "user_authored",
      path: devNexusProjectConfigFileName,
      sourceControl: "source",
      description:
        "Project, component, work-item service, automation, skills, plugins, and agent MCP configuration.",
    },
    {
      area: "project_state",
      owner: "generated",
      path: ".dev-nexus/README.md",
      sourceControl: "support",
      description:
        "Generated map of project support state, runtime state, and migration boundaries.",
    },
  ];

  for (const component of components) {
    entries.push({
      area: "component_configuration",
      owner: "user_authored",
      path: displayPath(projectRoot, component.sourceRoot),
      sourceControl: "source",
      description: `Source root for component ${component.id}.`,
    });
    entries.push({
      area: "project_state",
      owner: "local_runtime",
      path: displayPath(projectRoot, component.worktreesRoot, true),
      sourceControl: "local",
      description: `Generated implementation worktrees for component ${component.id}.`,
    });
  }

  if (automationConfig) {
    entries.push({
      area: "target_state",
      owner: "user_authored",
      path: normalizedProjectRelativePath(automationConfig.target.statePath),
      sourceControl: "support",
      description:
        "Concise target memory maintained by humans or launched agents as current direction changes.",
    });
    entries.push({
      area: "project_state",
      owner: "local_runtime",
      path: normalizedProjectRelativePath(automationConfig.target.cycleLedgerPath),
      sourceControl: "local",
      description:
        "Caller-reported target cycle facts used for reports and relaunch decisions.",
    });
    entries.push({
      area: "project_state",
      owner: "local_runtime",
      path: normalizedProjectRelativePath(automationConfig.ledger.path),
      sourceControl: "local",
      description: "Automation run ledger written by DevNexus.",
    });
    entries.push({
      area: "project_state",
      owner: "local_runtime",
      path: normalizedProjectRelativePath(automationConfig.lock.path),
      sourceControl: "local",
      description: "Automation lock file used to prevent overlapping runs.",
    });
    entries.push({
      area: "project_state",
      owner: "local_runtime",
      path: ".dev-nexus/automation/agent-launches/",
      sourceControl: "local",
      description:
        "Per-run agent context and result files produced during agent-launch automation.",
    });
  }

  if (options.skillsConfig !== false) {
    entries.push({
      area: "skills",
      owner: "generated",
      path: ".dev-nexus/skills/",
      sourceControl: "support",
      description: "DevNexus-owned curated skill definitions.",
    });
    for (const target of resolvedSkillAgentTargets({
      ...options.projectConfig,
      ...(options.skillsConfig !== undefined
        ? { skills: options.skillsConfig || undefined }
        : {}),
    })) {
      entries.push({
        area: "skills",
        owner: "generated",
        path: withTrailingSlash(normalizedProjectRelativePath(target.directory)),
        sourceControl: target.sourceControl,
        description: `Agent-native skill projection for ${target.agent}.`,
      });
    }
  }

  if (options.mcpConfig && options.mcpConfig.enabled !== false) {
    for (const target of resolvedMcpAgentTargets({
      ...options.projectConfig,
      mcp: options.mcpConfig,
    })) {
      entries.push({
        area: "agent_mcp_projection",
        owner: "generated",
        path: normalizedProjectRelativePath(target.configPath),
        sourceControl: target.sourceControl,
        description: `Agent MCP server projection for ${target.agent}.`,
      });
    }
  }

  for (const storePath of localWorkItemStorePaths(projectRoot, options.projectConfig)) {
    entries.push({
      area: "project_state",
      owner: "local_runtime",
      path: displayPath(projectRoot, storePath),
      sourceControl: "local",
      description: "Local work-item store for a configured component tracker.",
    });
  }

  return {
    entries,
    migrationNotes: nexusProjectTemplateMigrationNotes(),
  };
}

export function materializeNexusProjectTemplate(
  options: MaterializeNexusProjectTemplateOptions,
): MaterializeNexusProjectTemplateResult {
  const projectRoot = path.resolve(options.projectRoot);
  const layout = buildNexusProjectTemplateLayout(options);
  const components = resolveProjectComponents(projectRoot, options.projectConfig);
  const componentWorktreesRoots = components.map(
    (component) => component.worktreesRoot,
  );

  fs.mkdirSync(options.worktreesRoot, { recursive: true });
  for (const componentWorktreesRoot of componentWorktreesRoots) {
    fs.mkdirSync(componentWorktreesRoot, { recursive: true });
  }

  const supportReadmePath = path.join(projectRoot, ".dev-nexus", "README.md");
  fs.mkdirSync(path.dirname(supportReadmePath), { recursive: true });
  fs.writeFileSync(
    supportReadmePath,
    renderNexusProjectSupportReadme(layout),
    "utf8",
  );

  const targetStatePath = options.projectConfig.automation
    ? path.resolve(projectRoot, options.projectConfig.automation.target.statePath)
    : null;
  if (targetStatePath && !fs.existsSync(targetStatePath)) {
    fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
    fs.writeFileSync(targetStatePath, defaultTargetStateMarkdown(), "utf8");
  }

  const gitExclude =
    options.excludeFromGit === false
      ? { gitExcludePath: null, gitExcludeEntries: [] }
      : addGitExcludeEntries(
          projectRoot,
          templateGitExcludeEntries(projectRoot, options.projectConfig),
        );

  return {
    ...layout,
    supportReadmePath,
    targetStatePath,
    componentWorktreesRoots,
    gitExcludePath: gitExclude.gitExcludePath,
    gitExcludeEntries: gitExclude.gitExcludeEntries,
  };
}

export function nexusProjectTemplateMigrationNotes(): string[] {
  return [
    "Historical staging roots are migration-only evidence; production templates must not inherit source-specific paths, tracker ids, agent launch commands, or component names from them.",
    "Generated state can be refreshed by DevNexus and must stay separate from user-authored project config, component source, and target notes.",
    "Local runtime state records locks, ledgers, local tracker files, and generated worktrees; keep it out of component source roots unless the project explicitly configures that boundary.",
  ];
}

function resolvedSkillAgentTargets(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
): Array<{
  agent: string;
  directory: string;
  sourceControl: NexusSkillSourceControl;
}> {
  return activeNexusProjectSkillAgentTargets(config)
    .map((target) => ({
      agent: target.agent,
      directory: skillAgentTargetDirectory(target),
      sourceControl: target.sourceControl ?? config.skills?.sourceControl ?? "support",
    }));
}

function skillAgentTargetDirectory(target: NexusProjectSkillAgentTarget): string {
  if (target.directory) {
    return target.directory;
  }
  if (target.agent === "codex") {
    return path.join(".agents", "skills");
  }
  if (target.agent === "claude") {
    return path.join(".claude", "skills");
  }

  return path.join(`.${target.agent}`, "skills");
}

function resolvedMcpAgentTargets(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
): Array<{
  agent: string;
  configPath: string;
  sourceControl: NexusSkillSourceControl;
}> {
  return activeNexusProjectMcpAgentTargets(config)
    .map((target) => ({
      agent: target.agent,
      configPath: mcpAgentTargetConfigPath(target),
      sourceControl: target.sourceControl ?? config.mcp?.sourceControl ?? "support",
    }));
}

function mcpAgentTargetConfigPath(target: NexusProjectAgentMcpTarget): string {
  if (target.configPath) {
    return target.configPath;
  }
  const provider = target.provider ?? target.agent;
  if (provider === "codex") {
    return path.join(".codex", "config.toml");
  }
  if (provider === "claude") {
    return ".mcp.json";
  }
  if (provider === "opencode") {
    return "opencode.json";
  }

  return path.join(`.${target.agent}`, "mcp.json");
}

function localWorkItemStorePaths(
  projectRoot: string,
  config: NexusProjectConfig,
): string[] {
  const paths = new Set<string>();
  collectLocalWorkTrackingPath(projectRoot, paths, config.workTracking ?? null);
  for (const component of resolveProjectComponents(projectRoot, config)) {
    collectLocalWorkTrackingPath(
      projectRoot,
      paths,
      component.workTracking ?? null,
    );
  }

  return [...paths];
}

function collectLocalWorkTrackingPath(
  projectRoot: string,
  paths: Set<string>,
  config: WorkTrackingConfig | null,
): void {
  if (config?.provider !== "local") {
    return;
  }

  paths.add(
    config.storePath
      ? path.resolve(projectRoot, config.storePath)
      : defaultLocalWorkTrackingStorePath(projectRoot),
  );
}

function templateGitExcludeEntries(
  projectRoot: string,
  config: NexusProjectConfig,
): string[] {
  const entries = new Set<string>([".dev-nexus/README.md"]);
  const worktreesEntry = gitExcludeEntryForPath(
    projectRoot,
    projectWorktreesRootPath(projectRoot, config),
    true,
  );
  if (worktreesEntry) {
    entries.add(worktreesEntry);
  }

  const automationConfig = config.automation;
  if (automationConfig) {
    addRelativeEntry(entries, automationConfig.ledger.path);
    addRelativeEntry(entries, automationConfig.lock.path);
    addRelativeEntry(entries, automationConfig.target.cycleLedgerPath);
    entries.add(".dev-nexus/automation/agent-launches/");
  }
  for (const storePath of localWorkItemStorePaths(projectRoot, config)) {
    const entry = gitExcludeEntryForPath(projectRoot, storePath, false);
    if (entry) {
      entries.add(entry);
    }
  }

  return [...entries];
}

function addRelativeEntry(entries: Set<string>, entry: string): void {
  if (isProjectRelativePath(entry)) {
    entries.add(normalizedProjectRelativePath(entry));
  }
}

function renderNexusProjectSupportReadme(
  layout: NexusProjectTemplateLayout,
): string {
  const lines = [
    "# DevNexus Project Support",
    "",
    "## Project Template Layout",
    "",
    "DevNexus keeps generic project support state separate from component source, target memory, curated skills, agent MCP projection, and local runtime records.",
    "",
    "## Ownership Classes",
    "",
    "- `user_authored`: Maintained by humans or launched agents as durable project intent.",
    "- `generated`: Written or refreshed by DevNexus from project configuration.",
    "- `local_runtime`: Machine-local state created while checking, launching, or recording work.",
    "",
    "## Paths",
    "",
    ...layout.entries.map(
      (entry) =>
        `- \`${entry.path}\` - ${entry.area}, ${entry.owner}, ${entry.sourceControl}: ${entry.description}`,
    ),
    "",
    "## Migration Notes",
    "",
    ...layout.migrationNotes.map((note) => `- ${note}`),
    "",
  ];

  return `${lines.join("\n")}`;
}

function defaultTargetStateMarkdown(): string {
  return [
    "# Target State",
    "",
    "Current direction:",
    "- No target state recorded yet.",
    "",
    "Decisions:",
    "- None recorded.",
    "",
    "Blockers:",
    "- None recorded.",
    "",
  ].join("\n");
}

function addGitExcludeEntries(
  projectRoot: string,
  entries: readonly string[],
): { gitExcludePath: string | null; gitExcludeEntries: string[] } {
  const gitInfoDir = path.join(projectRoot, ".git", "info");
  if (!fs.existsSync(gitInfoDir) || !fs.statSync(gitInfoDir).isDirectory()) {
    return {
      gitExcludePath: null,
      gitExcludeEntries: [],
    };
  }

  const excludePath = path.join(gitInfoDir, "exclude");
  const existing = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8")
    : "";
  const existingLines = new Set(
    existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const appended: string[] = [];
  for (const entry of entries) {
    if (!existingLines.has(entry)) {
      appended.push(entry);
      existingLines.add(entry);
    }
  }

  if (appended.length > 0) {
    fs.mkdirSync(gitInfoDir, { recursive: true });
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(excludePath, `${prefix}${appended.join("\n")}\n`, "utf8");
  }

  return {
    gitExcludePath: excludePath,
    gitExcludeEntries: appended,
  };
}

function displayPath(
  projectRoot: string,
  targetPath: string,
  directory = false,
): string {
  const resolved = path.resolve(projectRoot, targetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative === "") {
    return directory ? "./" : ".";
  }
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return directory
      ? withTrailingSlash(normalizedProjectRelativePath(relative))
      : normalizedProjectRelativePath(relative);
  }

  return directory
    ? withTrailingSlash(path.resolve(targetPath))
    : path.resolve(targetPath);
}

function gitExcludeEntryForPath(
  projectRoot: string,
  targetPath: string,
  directory: boolean,
): string | null {
  const relative = path.relative(projectRoot, path.resolve(targetPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  const normalized = normalizedProjectRelativePath(relative);
  return directory ? withTrailingSlash(normalized) : normalized;
}

function normalizedProjectRelativePath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isProjectRelativePath(value: string): boolean {
  return (
    value.trim().length > 0 &&
    !path.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    !value
      .split(/[\\/]/u)
      .some((part) => part === ".." || part === "")
  );
}
