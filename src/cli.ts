#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createNexusAutomationCommandExecutor,
  type NexusAutomationCommandRunner,
} from "./nexusAutomationCommandExecutor.js";
import {
  createNexusAutomationAgentCommandLauncher,
  runNexusAutomationAgentLaunchOnce,
  type RunNexusAutomationAgentLaunchOnceResult,
} from "./nexusAutomationAgentLaunch.js";
import {
  resolveNexusAutomationAgentCommand,
} from "./nexusAutomationAgentProfile.js";
import {
  enqueueNexusAutomationWorkItem,
  type EnqueueNexusAutomationWorkItemResult,
} from "./nexusAutomationEnqueue.js";
import {
  runNexusAutomationOnce,
  type RunNexusAutomationOnceResult,
} from "./nexusAutomationRunOnce.js";
import {
  runNexusAutomationScheduler,
  type NexusAutomationSchedulerTick,
  type RunNexusAutomationSchedulerResult,
} from "./nexusAutomationScheduler.js";
import {
  getNexusAutomationStatus,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  getNexusAutomationAgentProfileSummary,
  getNexusAutomationEligibleWorkSummary,
  type NexusAutomationAgentProfileSummary,
  type NexusAutomationEligibleWorkSummary,
} from "./nexusAutomationAgentSurface.js";
import {
  appendNexusAutomationTargetCycleRecord,
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleRecordInput,
  type NexusAutomationTargetCycleStatus,
  type NexusAutomationTargetCycleWorkItemInput,
  type NexusAutomationTargetCycleWorkItemStatus,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  createNexusCoordinationHandoff,
  getNexusCoordinationStatus,
  parseNexusCoordinationHandoffStatus,
  type NexusCoordinationHandoffResult,
  type NexusCoordinationHandoffStatus,
  type NexusCoordinationStatus,
} from "./nexusCoordination.js";
import {
  materializeNexusProjectAgentMcpConfig,
  type MaterializeNexusProjectAgentMcpConfigResult,
} from "./nexusAgentMcpConfig.js";
import { runDevNexusMcpStdioServer } from "./nexusMcpServer.js";
import {
  createDefaultNexusHomeConfigBase,
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  nexusHomeConfigPath,
  resolveNexusHome,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  configureNexusProjectTracker,
  createNexusProject,
  getNexusProjectStatus,
  importNexusProject,
  linkNexusProjectTracker,
  listNexusProjects,
  type ConfigureNexusProjectTrackerResult,
  type CreateNexusProjectResult,
  type ImportNexusProjectResult,
  type LinkNexusProjectTrackerResult,
  type ListNexusProjectsResult,
  type NexusProjectHomeStore,
} from "./nexusProjectHomeService.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
} from "./nexusProjectLifecycle.js";
import {
  buildNexusProjectStatusForPath,
  type NexusProjectStatusBase,
} from "./nexusProjectRegistry.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "./workItemService.js";
import type { GitRunner } from "./gitWorktreeService.js";
import type { ProjectGitRunner } from "./nexusProjectLifecycle.js";
import type {
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkStatus,
} from "./workTrackingTypes.js";

interface TextWriter {
  write(chunk: string): unknown;
}

export interface DevNexusCliDependencies {
  stdout?: TextWriter;
  stderr?: TextWriter;
  commandRunner?: NexusAutomationCommandRunner;
  gitRunner?: GitRunner;
  projectGitRunner?: ProjectGitRunner;
  now?: () => Date | string;
}

interface ParsedHomeInitCommand {
  homePath: string;
  projectsRoot?: string;
  workspacesRoot?: string;
  json?: boolean;
}

interface ParsedProjectCreateCommand {
  homePath?: string;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  trackerProjectId?: string;
  json?: boolean;
}

interface ParsedProjectImportCommand {
  homePath?: string;
  root: string;
  projectRoot?: string;
  name?: string;
  trackerProjectId?: string;
  json?: boolean;
}

interface ParsedProjectListCommand {
  homePath?: string;
  json?: boolean;
}

interface ParsedProjectStatusCommand {
  homePath?: string;
  project: string;
  json?: boolean;
}

interface ParsedProjectMcpRefreshCommand {
  projectRoot: string;
  agents: string[];
  json?: boolean;
}

interface ParsedProjectTrackerConfigureCommand {
  homePath?: string;
  project: string;
  provider: "local" | "github" | "gitlab" | "jira";
  host?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryId?: string;
  projectKey?: string;
  issueType?: string;
  storePath?: string;
  json?: boolean;
}

interface ParsedProjectTrackerLinkCommand {
  homePath?: string;
  project: string;
  trackerProjectId: string;
  json?: boolean;
}

interface ParsedWorkItemCreateCommand {
  projectRoot: string;
  componentId?: string;
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels: string[];
  assignees: string[];
  milestone?: string | null;
  json?: boolean;
}

interface ParsedWorkItemListCommand {
  projectRoot: string;
  componentId?: string;
  statuses: WorkStatus[];
  labels: string[];
  assignees: string[];
  search?: string;
  limit?: number;
  json?: boolean;
}

interface ParsedWorkItemGetCommand {
  projectRoot: string;
  componentId?: string;
  itemId: string;
  json?: boolean;
}

interface ParsedWorkItemUpdateCommand {
  projectRoot: string;
  componentId?: string;
  itemId: string;
  patch: WorkItemPatch;
  json?: boolean;
}

interface ParsedWorkItemCommentCommand {
  projectRoot: string;
  componentId?: string;
  itemId: string;
  body: string;
  json?: boolean;
}

interface ParsedAutomationRunOnceCommand {
  projectRoot: string;
  command?: string;
  runId?: string;
  owner?: string;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string;
  timeoutMs?: number;
  runFullVerification?: boolean;
  json?: boolean;
}

interface ParsedAutomationStatusCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedAutomationEligibleWorkCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedAutomationAgentProfilesCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedAutomationEnqueueCommand {
  projectRoot: string;
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels: string[];
  assignees: string[];
  milestone?: string | null;
  json?: boolean;
}

interface ParsedAutomationTargetCycleListCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedAutomationTargetCycleRecordCommand {
  projectRoot: string;
  cycleId?: string;
  runId?: string;
  status: NexusAutomationTargetCycleStatus;
  summary?: string | null;
  eligibleWorkItemCount?: number | null;
  workItems: NexusAutomationTargetCycleWorkItemInput[];
  blockers: string[];
  notes: string[];
  json?: boolean;
}

interface ParsedAutomationTargetReportCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedCoordinationStatusCommand {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  currentPath?: string;
  json?: boolean;
}

interface ParsedCoordinationHandoffCommand {
  projectRoot: string;
  componentId?: string;
  workItemId: string;
  status: NexusCoordinationHandoffStatus;
  hostId?: string;
  agentId?: string;
  changedAreas: string[];
  decisions: string[];
  verificationSummary?: string | null;
  integrationPreference?: string | null;
  note?: string | null;
  currentPath?: string;
  json?: boolean;
}

interface ParsedAutomationScheduleCommand {
  projectRoot: string;
  command?: string;
  owner?: string;
  baseRef?: string;
  intervalMs?: number;
  maxTicks?: number;
  maxRuns?: number;
  runIdPrefix?: string;
  timeoutMs?: number;
  runFullVerification?: boolean;
  json?: boolean;
}

export function usage(): string {
  return [
    "Usage:",
    "  dev-nexus --help",
    "  dev-nexus mcp-stdio",
    "  dev-nexus home init [home-path] [options]",
    "  dev-nexus project create <name> [options]",
    "  dev-nexus project import <source-root> [options]",
    "  dev-nexus project list [options]",
    "  dev-nexus project status <project-id-or-root> [options]",
    "  dev-nexus project mcp refresh <project-root> [options]",
    "  dev-nexus project tracker configure <project> --provider <provider> [options]",
    "  dev-nexus project tracker link <project> --tracker-project-id <id> [options]",
    "  dev-nexus coordination status <project-root> [options]",
    "  dev-nexus coordination handoff <project-root> <work-item-id> --status <status> [options]",
    "  dev-nexus work-item create <project-root> --title <title> [options]",
    "  dev-nexus work-item list <project-root> [options]",
    "  dev-nexus work-item get <project-root> <work-item-id> [options]",
    "  dev-nexus work-item update <project-root> <work-item-id> [options]",
    "  dev-nexus work-item comment <project-root> <work-item-id> --body <text> [options]",
    "  dev-nexus automation status <project-root> [options]",
    "  dev-nexus automation eligible-work <project-root> [options]",
    "  dev-nexus automation agent-profiles <project-root> [options]",
    "  dev-nexus automation enqueue <project-root> --title <title> [options]",
    "  dev-nexus automation target-cycle list <project-root> [options]",
    "  dev-nexus automation target-cycle record <project-root> --status <status> [options]",
    "  dev-nexus automation target-report <project-root> [options]",
    "  dev-nexus automation run-once <project-root> [--command <command>] [options]",
    "  dev-nexus automation schedule <project-root> [--command <command>] [options]",
    "",
    "Options for home init:",
    "  --projects-root <path>",
    "  --workspaces-root <path>",
    "  --json",
    "",
    "Options for project commands:",
    "  --home <path>             defaults to DEV_NEXUS_HOME or ~/.dev-nexus",
    "  --json",
    "",
    "Options for project create:",
    "  --home <path>",
    "  --root <path>",
    "  --from <git-url>",
    "  --git-init",
    "  --tracker-project-id <id>",
    "  --json",
    "",
    "Options for project import:",
    "  --home <path>",
    "  --project-root <path>",
    "  --name <name>",
    "  --tracker-project-id <id>",
    "  --json",
    "",
    "Options for project mcp refresh:",
    "  --agent <codex|claude>    repeatable; defaults to project mcp.agentTargets or codex",
    "  --json",
    "",
    "Options for project tracker configure:",
    "  --home <path>",
    "  --provider <local|github|gitlab|jira>",
    "  --host <host>",
    "  --repository-owner <owner>",
    "  --repository-name <name>",
    "  --repository-id <id>",
    "  --project-key <key>",
    "  --issue-type <type>",
    "  --store-path <path>",
    "  --json",
    "",
    "Options for project tracker link:",
    "  --home <path>",
    "  --tracker-project-id <id>",
    "  --json",
    "",
    "Options for coordination status:",
    "  --component <id>          defaults to component inferred from --worktree or current directory",
    "  --work-item <id>",
    "  --worktree <path>         git worktree or source checkout used for status",
    "  --json",
    "",
    "Options for coordination handoff:",
    "  --component <id>          defaults to component inferred from --worktree or current directory",
    "  --status <working|ready|blocked|merged>",
    "  --host <id>",
    "  --agent <id>",
    "  --changed-area <path>      repeatable",
    "  --decision <text>          repeatable",
    "  --verification <text>",
    "  --integration-preference <text>",
    "  --note <text>",
    "  --worktree <path>         git worktree or source checkout used for status",
    "  --json",
    "",
    "Options for work-item create:",
    "  --component <id>          defaults to the primary component",
    "  --title <title>",
    "  --description <text>",
    "  --status <todo|ready|in_progress|blocked|done|wont_do>",
    "  --label <label>            repeatable",
    "  --assignee <assignee>      repeatable",
    "  --milestone <text>",
    "  --json",
    "",
    "Options for work-item list:",
    "  --component <id>          defaults to the primary component",
    "  --status <todo|ready|in_progress|blocked|done|wont_do>  repeatable",
    "  --label <label>            repeatable",
    "  --assignee <assignee>      repeatable",
    "  --search <text>",
    "  --limit <count>",
    "  --json",
    "",
    "Options for work-item get:",
    "  --component <id>          defaults to the primary component",
    "  --json",
    "",
    "Options for work-item update:",
    "  --component <id>          defaults to the primary component",
    "  --title <title>",
    "  --description <text>",
    "  --clear-description",
    "  --status <todo|ready|in_progress|blocked|done|wont_do>",
    "  --label <label>            repeatable, replaces labels when provided",
    "  --clear-labels",
    "  --assignee <assignee>      repeatable, replaces assignees when provided",
    "  --clear-assignees",
    "  --milestone <text>",
    "  --clear-milestone",
    "  --json",
    "",
    "Options for work-item comment:",
    "  --component <id>          defaults to the primary component",
    "  --body <text>",
    "  --json",
    "",
    "Options for automation status:",
    "  --json",
    "",
    "Options for automation eligible-work:",
    "  --json",
    "",
    "Options for automation agent-profiles:",
    "  --json",
    "",
    "Options for automation enqueue:",
    "  --title <title>",
    "  --description <text>",
    "  --status <todo|ready|in_progress|blocked|done|wont_do>",
    "  --label <label>            repeatable, added after selector labels",
    "  --assignee <assignee>      repeatable, added after selector assignees",
    "  --milestone <text>",
    "  --json",
    "",
    "Options for automation target-cycle list:",
    "  --json",
    "",
    "Options for automation target-cycle record:",
    "  --cycle-id <id>",
    "  --run-id <id>",
    "  --status <started|dispatched|completed|blocked|failed|skipped>",
    "  --summary <text>",
    "  --eligible-work-items <count>",
    "  --work-item <component-id:id>  repeatable",
    "  --work-item-status <selected|dispatched|in_progress|completed|blocked|skipped>",
    "  --work-item-agent-profile <id>",
    "  --work-item-note <text>",
    "  --blocker <text>              repeatable",
    "  --note <text>                 repeatable",
    "  --json",
    "",
    "Options for automation target-report:",
    "  --json",
    "",
    "Options for automation run-once:",
    "  --command <command>        shell command to run; overrides automation.executor.command, automation.agent.command, or coordinator profile command",
    "  --run-id <id>",
    "  --owner <name>",
    "  --branch <name>",
    "  --worktree-name <name>",
    "  --base-ref <ref>",
    "  --full                     also run configured full verification commands",
    "  --timeout-ms <ms>          applies to each command",
    "  --json",
    "",
    "Options for automation schedule:",
    "  --command <command>        shell command to run; overrides automation.executor.command, automation.agent.command, or coordinator profile command",
    "  --owner <name>",
    "  --base-ref <ref>",
    "  --interval-ms <ms>         overrides project automation.schedule.intervalMs",
    "  --max-ticks <count>        stop after this many scheduler polls",
    "  --max-runs <count>         stop after this many run-once executions",
    "  --run-id-prefix <prefix>",
    "  --full                     also run configured full verification commands",
    "  --timeout-ms <ms>          applies to each command",
    "  --json",
  ].join("\n");
}

export async function main(
  argv: string[],
  dependencies: DevNexusCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    writeLine(stdout, usage());
    return 0;
  }

  if (argv[0] === "home") {
    return handleHomeCommand(argv, dependencies);
  }
  if (argv[0] === "project") {
    return handleProjectCommand(argv, dependencies);
  }
  if (argv[0] === "coordination") {
    return handleCoordinationCommand(argv, dependencies);
  }
  if (argv[0] === "work-item") {
    return handleWorkItemCommand(argv, dependencies);
  }
  if (argv[0] === "automation") {
    return handleAutomationCommand(argv, dependencies);
  }
  if (argv[0] === "mcp-stdio") {
    await runDevNexusMcpStdioServer();
    return 0;
  }

  throw new Error(
    "dev-nexus requires home, project, coordination, work-item, automation, mcp-stdio, or --help",
  );
}

async function handleHomeCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  if (argv[1] !== "init") {
    throw new Error("home requires init");
  }

  const parsed = parseHomeInitCommand(argv);
  const homePath = resolveNexusHome(parsed.homePath);
  const configPath = nexusHomeConfigPath(homePath);
  if (fs.existsSync(configPath)) {
    throw new Error(`DevNexus home already exists: ${configPath}`);
  }

  const config = createDefaultNexusHomeConfigBase(homePath, {
    ...(parsed.projectsRoot !== undefined ? { projectsRoot: parsed.projectsRoot } : {}),
    ...(parsed.workspacesRoot !== undefined ? { workspacesRoot: parsed.workspacesRoot } : {}),
  });
  const savedPath = saveNexusHomeConfigFile(
    homePath,
    config,
    validateNexusHomeConfigBase,
  );
  printHomeInitResult(
    { homePath, configPath: savedPath, config },
    parsed,
    dependencies.stdout ?? process.stdout,
  );
  return 0;
}

async function handleProjectCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseProjectCreateCommand(argv);
    const result = createNexusProject({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      name: parsed.name,
      ...(parsed.root !== undefined ? { root: parsed.root } : {}),
      ...(parsed.from !== undefined ? { from: parsed.from } : {}),
      ...(parsed.gitInit !== undefined ? { gitInit: parsed.gitInit } : {}),
      ...(parsed.trackerProjectId !== undefined
        ? { vibeKanbanProjectId: parsed.trackerProjectId }
        : {}),
      ...(dependencies.projectGitRunner ? { gitRunner: dependencies.projectGitRunner } : {}),
    });
    printProjectCreateResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "import") {
    const parsed = parseProjectImportCommand(argv);
    const result = importNexusProject({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      root: parsed.root,
      ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.trackerProjectId !== undefined
        ? { vibeKanbanProjectId: parsed.trackerProjectId }
        : {}),
      ...(dependencies.projectGitRunner ? { gitRunner: dependencies.projectGitRunner } : {}),
    });
    printProjectImportResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "list") {
    const parsed = parseProjectListCommand(argv);
    const result = listNexusProjects({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
    });
    printProjectListResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "status") {
    const parsed = parseProjectStatusCommand(argv);
    const result = resolveProjectStatusForCli(parsed);
    printProjectStatusResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "mcp") {
    return handleProjectMcpCommand(argv, dependencies);
  }

  if (command === "tracker") {
    return handleProjectTrackerCommand(argv, dependencies);
  }

  throw new Error("project requires create, import, list, status, mcp, or tracker");
}

async function handleProjectMcpCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command !== "refresh") {
    throw new Error("project mcp requires refresh");
  }

  const parsed = parseProjectMcpRefreshCommand(argv);
  const projectRoot = path.resolve(parsed.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const result = materializeNexusProjectAgentMcpConfig({
    projectRoot,
    mcpConfig: projectConfig.mcp,
    ...(parsed.agents.length > 0
      ? { agentTargets: parsed.agents.map((agent) => ({ agent })) }
      : {}),
  });
  printProjectMcpRefreshResult(result, parsed, dependencies.stdout ?? process.stdout);
  return 0;
}

async function handleProjectTrackerCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command === "configure") {
    const parsed = parseProjectTrackerConfigureCommand(argv);
    const result = configureNexusProjectTracker({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      project: parsed.project,
      provider: parsed.provider,
      ...(parsed.host !== undefined ? { host: parsed.host } : {}),
      ...(parsed.repositoryOwner !== undefined
        ? { repositoryOwner: parsed.repositoryOwner }
        : {}),
      ...(parsed.repositoryName !== undefined
        ? { repositoryName: parsed.repositoryName }
        : {}),
      ...(parsed.repositoryId !== undefined ? { repositoryId: parsed.repositoryId } : {}),
      ...(parsed.projectKey !== undefined ? { projectKey: parsed.projectKey } : {}),
      ...(parsed.issueType !== undefined ? { issueType: parsed.issueType } : {}),
      ...(parsed.storePath !== undefined ? { storePath: parsed.storePath } : {}),
    });
    printProjectTrackerConfigureResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "link") {
    const parsed = parseProjectTrackerLinkCommand(argv);
    const result = linkNexusProjectTracker({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      project: parsed.project,
      trackerProjectId: parsed.trackerProjectId,
    });
    printProjectTrackerLinkResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("project tracker requires configure or link");
}

async function handleCoordinationCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "status") {
    const parsed = parseCoordinationStatusCommand(argv);
    const status = await getNexusCoordinationStatus({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      currentPath: parsed.currentPath ?? process.cwd(),
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printCoordinationStatusResult(
      status,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "handoff") {
    const parsed = parseCoordinationHandoffCommand(argv);
    const result = await createNexusCoordinationHandoff({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      status: parsed.status,
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      changedAreas: parsed.changedAreas,
      decisions: parsed.decisions,
      verificationSummary: parsed.verificationSummary,
      integrationPreference: parsed.integrationPreference,
      note: parsed.note,
      currentPath: parsed.currentPath ?? process.cwd(),
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printCoordinationHandoffResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("coordination requires status or handoff");
}

async function handleWorkItemCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseWorkItemCreateCommand(argv);
    const item = await workItemService(parsed.projectRoot, dependencies)
      .createWorkItem({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        title: parsed.title,
        description: parsed.description,
        status: parsed.status,
        labels: parsed.labels,
        assignees: parsed.assignees,
        milestone: parsed.milestone,
      });
    printWorkItemCreateResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "list") {
    const parsed = parseWorkItemListCommand(argv);
    const items = await workItemService(parsed.projectRoot, dependencies)
      .listWorkItems({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        status: statusQuery(parsed.statuses),
        labels: parsed.labels,
        assignees: parsed.assignees,
        search: parsed.search,
        limit: parsed.limit,
      });
    printWorkItemListResult(items, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "get") {
    const parsed = parseWorkItemGetCommand(argv);
    const item = await workItemService(parsed.projectRoot, dependencies)
      .getWorkItem({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        id: parsed.itemId,
      });
    printWorkItemGetResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "update") {
    const parsed = parseWorkItemUpdateCommand(argv);
    const item = await workItemService(parsed.projectRoot, dependencies)
      .updateWorkItem({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        ref: { id: parsed.itemId },
        patch: parsed.patch,
      });
    printWorkItemUpdateResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "comment") {
    const parsed = parseWorkItemCommentCommand(argv);
    const comment = await workItemService(parsed.projectRoot, dependencies)
      .addComment({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        ref: { id: parsed.itemId },
        body: parsed.body,
      });
    printWorkItemCommentResult(
      comment,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("work-item requires create, list, get, update, or comment");
}

async function handleAutomationCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  if (argv[1] === "status") {
    const parsed = parseAutomationStatusCommand(argv);
    const result = await getNexusAutomationStatus({
      projectRoot: parsed.projectRoot,
      now: dependencies.now,
    });
    printAutomationStatusResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "eligible-work") {
    const parsed = parseAutomationEligibleWorkCommand(argv);
    const result = await getNexusAutomationEligibleWorkSummary({
      projectRoot: parsed.projectRoot,
      now: dependencies.now,
    });
    printAutomationEligibleWorkResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "agent-profiles") {
    const parsed = parseAutomationAgentProfilesCommand(argv);
    const result = getNexusAutomationAgentProfileSummary(parsed.projectRoot);
    printAutomationAgentProfilesResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "enqueue") {
    const parsed = parseAutomationEnqueueCommand(argv);
    const result = await enqueueNexusAutomationWorkItem({
      projectRoot: parsed.projectRoot,
      title: parsed.title,
      description: parsed.description,
      status: parsed.status,
      labels: parsed.labels,
      assignees: parsed.assignees,
      milestone: parsed.milestone,
      now: dependencies.now,
    });
    printAutomationEnqueueResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "target-cycle") {
    return handleAutomationTargetCycleCommand(argv, dependencies);
  }

  if (argv[1] === "target-report") {
    const parsed = parseAutomationTargetReportCommand(argv);
    const result = buildNexusAutomationTargetReport({
      projectRoot: parsed.projectRoot,
      now: dependencies.now?.(),
    });
    printAutomationTargetReportResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "schedule") {
    const parsed = parseAutomationScheduleCommand(argv);
    const commandOptions = resolveAutomationCommandCliOptions(
      "schedule",
      parsed,
    );
    const stdout = dependencies.stdout ?? process.stdout;
    const result = await runNexusAutomationScheduler({
      projectRoot: parsed.projectRoot,
      owner: parsed.owner,
      baseRef: parsed.baseRef,
      intervalMs: parsed.intervalMs,
      maxTicks: parsed.maxTicks,
      maxRuns: parsed.maxRuns,
      runIdPrefix: parsed.runIdPrefix,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
      onTick: parsed.json
        ? undefined
        : (tick) => printAutomationScheduleTick(tick, stdout),
      ...(commandOptions.mode === "agent_launch"
        ? {
            agentLauncher: createNexusAutomationAgentCommandLauncher({
              command: commandOptions.command,
              commandRunner: dependencies.commandRunner,
              timeoutMs: commandOptions.timeoutMs,
            }),
          }
        : {
            executor: createNexusAutomationCommandExecutor({
              command: commandOptions.command,
              commandRunner: dependencies.commandRunner,
              gitRunner: dependencies.gitRunner,
              runFullVerification: commandOptions.runFullVerification,
              timeoutMs: commandOptions.timeoutMs,
            }),
          }),
    });
    printAutomationScheduleResult(result, parsed, stdout);
    return 0;
  }

  if (argv[1] !== "run-once") {
    throw new Error(
      "automation requires status, eligible-work, agent-profiles, enqueue, target-cycle, target-report, run-once, or schedule",
    );
  }

  const parsed = parseAutomationRunOnceCommand(argv);
  const commandOptions = resolveAutomationCommandCliOptions("run-once", parsed);
  if (commandOptions.mode === "agent_launch") {
    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot: parsed.projectRoot,
      runId: parsed.runId,
      owner: parsed.owner,
      now: dependencies.now,
      launcher: createNexusAutomationAgentCommandLauncher({
        command: commandOptions.command,
        commandRunner: dependencies.commandRunner,
        timeoutMs: commandOptions.timeoutMs,
      }),
    });
    printAutomationAgentLaunchResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
  } else {
    const result = await runNexusAutomationOnce({
      projectRoot: parsed.projectRoot,
      runId: parsed.runId,
      owner: parsed.owner,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      baseRef: parsed.baseRef,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
      executor: createNexusAutomationCommandExecutor({
        command: commandOptions.command,
        commandRunner: dependencies.commandRunner,
        gitRunner: dependencies.gitRunner,
        runFullVerification: commandOptions.runFullVerification,
        timeoutMs: commandOptions.timeoutMs,
      }),
    });
    printAutomationRunOnceResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
  }
  return 0;
}

async function handleAutomationTargetCycleCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command === "list") {
    const parsed = parseAutomationTargetCycleListCommand(argv);
    const { projectConfig, automationConfig } = automationConfigForProjectRoot(
      parsed.projectRoot,
    );
    const ledger = readNexusAutomationTargetCycleLedger(
      path.resolve(parsed.projectRoot),
      automationConfig,
    );
    printAutomationTargetCycleListResult(
      {
        projectConfig,
        ledger,
      },
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "record") {
    const parsed = parseAutomationTargetCycleRecordCommand(argv);
    const { projectConfig, automationConfig } = automationConfigForProjectRoot(
      parsed.projectRoot,
    );
    const ledger = appendNexusAutomationTargetCycleRecord({
      projectRoot: path.resolve(parsed.projectRoot),
      config: automationConfig,
      now: dependencies.now?.(),
      record: {
        ...(parsed.cycleId ? { id: parsed.cycleId } : {}),
        projectId: projectConfig.id,
        targetId: automationConfig.target.id,
        objective: automationConfig.target.objective,
        ...(parsed.runId ? { runId: parsed.runId } : {}),
        status: parsed.status,
        summary: parsed.summary ?? null,
        eligibleWorkItemCount: parsed.eligibleWorkItemCount ?? null,
        workItems: parsed.workItems,
        blockers: parsed.blockers,
        notes: parsed.notes,
      },
    });
    printAutomationTargetCycleRecordResult(
      {
        projectConfig,
        record: ledger.cycles.at(-1)!,
        ledger,
      },
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("automation target-cycle requires list or record");
}

function resolveAutomationCommandCliOptions(
  commandName: "run-once" | "schedule",
  parsed: ParsedAutomationRunOnceCommand | ParsedAutomationScheduleCommand,
): {
  mode: "run_once" | "agent_launch";
  command: string;
  runFullVerification: boolean;
  timeoutMs?: number;
} {
  const config = loadProjectConfig(path.resolve(parsed.projectRoot));
  const mode = config.automation?.mode ?? "run_once";
  const automationConfig = config.automation;
  const configuredCommand =
    mode === "agent_launch"
      ? automationConfig
        ? resolveNexusAutomationAgentCommand({
            automationConfig,
            overrideCommand: parsed.command,
            commandName,
          }).command
        : parsed.command
      : parsed.command ?? automationConfig?.executor.command;
  const configuredTimeoutMs =
    mode === "agent_launch"
      ? automationConfig?.agent.timeoutMs
      : automationConfig?.executor.timeoutMs;
  const command = configuredCommand ?? undefined;
  if (!command) {
    throw new Error(
      mode === "agent_launch"
        ? `automation ${commandName} requires --command or project config automation.agent.command`
        : `automation ${commandName} requires --command or project config automation.executor.command`,
    );
  }

  return {
    mode,
    command,
    runFullVerification:
      parsed.runFullVerification ??
      config.automation?.executor.runFullVerification ??
      false,
    ...(parsed.timeoutMs ?? configuredTimeoutMs
      ? { timeoutMs: parsed.timeoutMs ?? configuredTimeoutMs ?? undefined }
      : {}),
  };
}

function workItemService(
  projectRoot: string,
  dependencies: DevNexusCliDependencies,
) {
  return createWorkItemService({
    resolveProject: (selector) =>
      resolveDirectProject(projectRoot, selector.componentId),
    now: dependencies.now,
  });
}

function resolveDirectProject(
  projectRoot: string,
  componentId?: string,
): ResolvedWorkItemProjectContext {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = loadProjectConfig(resolvedProjectRoot);
  const component = componentId
    ? resolveProjectComponents(resolvedProjectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(resolvedProjectRoot, config);
  if (!component) {
    throw new Error(`Project component is not configured: ${componentId}`);
  }
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    homePath: config.home ?? "",
    projectRoot: resolvedProjectRoot,
    projectId: config.id,
    projectName: config.name,
    componentId: component.id,
    componentName: component.name,
    sourceRoot: component.sourceRoot,
    workTracking: component.workTracking,
  };
}

function parseHomeInitCommand(argv: string[]): ParsedHomeInitCommand {
  const rest = argv.slice(2);
  const parsed: ParsedHomeInitCommand = {
    homePath: defaultNexusHomePath(),
  };
  let homePathProvided = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--projects-root":
        parsed.projectsRoot = next();
        break;
      case "--workspaces-root":
        parsed.workspacesRoot = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown home init option: ${arg}`);
        }
        if (homePathProvided) {
          throw new Error("home init accepts at most one home path");
        }
        homePathProvided = true;
        parsed.homePath = arg;
        break;
    }
  }

  return parsed;
}

function parseProjectCreateCommand(argv: string[]): ParsedProjectCreateCommand {
  const [, , name, ...rest] = argv;
  if (!name || name.startsWith("--")) {
    throw new Error("project create requires a name");
  }

  const parsed: ParsedProjectCreateCommand = { name };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--root":
        parsed.root = next();
        break;
      case "--from":
        parsed.from = next();
        break;
      case "--git-init":
        parsed.gitInit = true;
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project create option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectImportCommand(argv: string[]): ParsedProjectImportCommand {
  const [, , root, ...rest] = argv;
  if (!root || root.startsWith("--")) {
    throw new Error("project import requires a source root");
  }

  const parsed: ParsedProjectImportCommand = { root };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--project-root":
        parsed.projectRoot = next();
        break;
      case "--name":
        parsed.name = next();
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project import option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectListCommand(argv: string[]): ParsedProjectListCommand {
  const rest = argv.slice(2);
  const parsed: ParsedProjectListCommand = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project list option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectStatusCommand(argv: string[]): ParsedProjectStatusCommand {
  const [, , project, ...rest] = argv;
  if (!project || project.startsWith("--")) {
    throw new Error("project status requires a project id or root");
  }

  const parsed: ParsedProjectStatusCommand = { project };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project status option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectMcpRefreshCommand(
  argv: string[],
): ParsedProjectMcpRefreshCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("project mcp refresh requires a project root");
  }

  const parsed: ParsedProjectMcpRefreshCommand = {
    projectRoot,
    agents: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--agent":
        parsed.agents.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project mcp refresh option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectTrackerConfigureCommand(
  argv: string[],
): ParsedProjectTrackerConfigureCommand {
  const [, , , project, ...rest] = argv;
  if (!project || project.startsWith("--")) {
    throw new Error("project tracker configure requires a project");
  }

  const parsed: Partial<ParsedProjectTrackerConfigureCommand> = { project };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--provider":
        parsed.provider = parseTrackerProvider(next(), arg);
        break;
      case "--host":
        parsed.host = next();
        break;
      case "--repository-owner":
        parsed.repositoryOwner = next();
        break;
      case "--repository-name":
        parsed.repositoryName = next();
        break;
      case "--repository-id":
        parsed.repositoryId = next();
        break;
      case "--project-key":
        parsed.projectKey = next();
        break;
      case "--issue-type":
        parsed.issueType = next();
        break;
      case "--store-path":
        parsed.storePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project tracker configure option: ${arg}`);
    }
  }

  if (!parsed.provider) {
    throw new Error("project tracker configure requires --provider");
  }

  return parsed as ParsedProjectTrackerConfigureCommand;
}

function parseProjectTrackerLinkCommand(
  argv: string[],
): ParsedProjectTrackerLinkCommand {
  const [, , , project, ...rest] = argv;
  if (!project || project.startsWith("--")) {
    throw new Error("project tracker link requires a project");
  }

  const parsed: Partial<ParsedProjectTrackerLinkCommand> = { project };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project tracker link option: ${arg}`);
    }
  }

  if (!parsed.trackerProjectId) {
    throw new Error("project tracker link requires --tracker-project-id");
  }

  return parsed as ParsedProjectTrackerLinkCommand;
}

function parseCoordinationStatusCommand(
  argv: string[],
): ParsedCoordinationStatusCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination status requires a project root");
  }

  const parsed: ParsedCoordinationStatusCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--worktree":
        parsed.currentPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown coordination status option: ${arg}`);
    }
  }

  return parsed;
}

function parseCoordinationHandoffCommand(
  argv: string[],
): ParsedCoordinationHandoffCommand {
  const [, , projectRoot, workItemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination handoff requires a project root");
  }
  if (!workItemId || workItemId.startsWith("--")) {
    throw new Error("coordination handoff requires a work item id");
  }

  const parsed: Partial<ParsedCoordinationHandoffCommand> = {
    projectRoot,
    workItemId,
    changedAreas: [],
    decisions: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--status":
        parsed.status = parseNexusCoordinationHandoffStatus(next(), arg);
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--agent":
        parsed.agentId = next();
        break;
      case "--changed-area":
        parsed.changedAreas?.push(next());
        break;
      case "--decision":
        parsed.decisions?.push(next());
        break;
      case "--verification":
        parsed.verificationSummary = next();
        break;
      case "--integration-preference":
        parsed.integrationPreference = next();
        break;
      case "--note":
        parsed.note = next();
        break;
      case "--worktree":
        parsed.currentPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown coordination handoff option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("coordination handoff requires --status");
  }

  return parsed as ParsedCoordinationHandoffCommand;
}

function parseWorkItemCreateCommand(argv: string[]): ParsedWorkItemCreateCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item create requires a project root");
  }

  const parsed: Partial<ParsedWorkItemCreateCommand> = {
    projectRoot,
    labels: [],
    assignees: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--title":
        parsed.title = next();
        break;
      case "--description":
        parsed.description = next();
        break;
      case "--status":
        parsed.status = parseWorkStatus(next(), arg);
        break;
      case "--label":
        parsed.labels?.push(next());
        break;
      case "--assignee":
        parsed.assignees?.push(next());
        break;
      case "--milestone":
        parsed.milestone = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item create option: ${arg}`);
    }
  }

  if (!parsed.title) {
    throw new Error("work-item create requires --title");
  }

  return parsed as ParsedWorkItemCreateCommand;
}

function parseWorkItemListCommand(argv: string[]): ParsedWorkItemListCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item list requires a project root");
  }

  const parsed: ParsedWorkItemListCommand = {
    projectRoot,
    statuses: [],
    labels: [],
    assignees: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--status":
        parsed.statuses.push(parseWorkStatus(next(), arg));
        break;
      case "--label":
        parsed.labels.push(next());
        break;
      case "--assignee":
        parsed.assignees.push(next());
        break;
      case "--search":
        parsed.search = next();
        break;
      case "--limit":
        parsed.limit = parsePositiveInteger(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item list option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemGetCommand(argv: string[]): ParsedWorkItemGetCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item get requires a project root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item get requires a work item id");
  }

  const parsed: ParsedWorkItemGetCommand = { projectRoot, itemId };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item get option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemUpdateCommand(argv: string[]): ParsedWorkItemUpdateCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item update requires a project root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item update requires a work item id");
  }

  const parsed: ParsedWorkItemUpdateCommand = {
    projectRoot,
    itemId,
    patch: {},
  };
  let replaceLabels: string[] | undefined;
  let replaceAssignees: string[] | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--title":
        parsed.patch.title = next();
        break;
      case "--description":
        if (parsed.patch.description === null) {
          throw new Error("--description conflicts with --clear-description");
        }
        parsed.patch.description = next();
        break;
      case "--clear-description":
        if (parsed.patch.description !== undefined) {
          throw new Error("--clear-description conflicts with --description");
        }
        parsed.patch.description = null;
        break;
      case "--status":
        parsed.patch.status = parseWorkStatus(next(), arg);
        break;
      case "--label":
        if (replaceLabels === undefined) {
          replaceLabels = [];
        }
        replaceLabels.push(next());
        break;
      case "--clear-labels":
        if (replaceLabels && replaceLabels.length > 0) {
          throw new Error("--clear-labels conflicts with --label");
        }
        replaceLabels = [];
        break;
      case "--assignee":
        if (replaceAssignees === undefined) {
          replaceAssignees = [];
        }
        replaceAssignees.push(next());
        break;
      case "--clear-assignees":
        if (replaceAssignees && replaceAssignees.length > 0) {
          throw new Error("--clear-assignees conflicts with --assignee");
        }
        replaceAssignees = [];
        break;
      case "--milestone":
        if (parsed.patch.milestone === null) {
          throw new Error("--milestone conflicts with --clear-milestone");
        }
        parsed.patch.milestone = next();
        break;
      case "--clear-milestone":
        if (parsed.patch.milestone !== undefined) {
          throw new Error("--clear-milestone conflicts with --milestone");
        }
        parsed.patch.milestone = null;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item update option: ${arg}`);
    }
  }

  if (replaceLabels !== undefined) {
    parsed.patch.labels = replaceLabels;
  }
  if (replaceAssignees !== undefined) {
    parsed.patch.assignees = replaceAssignees;
  }
  if (Object.keys(parsed.patch).length === 0) {
    throw new Error("work-item update requires at least one field to update");
  }

  return parsed;
}

function parseWorkItemCommentCommand(argv: string[]): ParsedWorkItemCommentCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item comment requires a project root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item comment requires a work item id");
  }

  const parsed: Partial<ParsedWorkItemCommentCommand> = {
    projectRoot,
    itemId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--body":
        parsed.body = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item comment option: ${arg}`);
    }
  }

  if (!parsed.body) {
    throw new Error("work-item comment requires --body");
  }

  return parsed as ParsedWorkItemCommentCommand;
}

function parseAutomationEnqueueCommand(
  argv: string[],
): ParsedAutomationEnqueueCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation enqueue requires a project root");
  }

  const parsed: Partial<ParsedAutomationEnqueueCommand> = {
    projectRoot,
    labels: [],
    assignees: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--title":
        parsed.title = next();
        break;
      case "--description":
        parsed.description = next();
        break;
      case "--status":
        parsed.status = parseWorkStatus(next(), arg);
        break;
      case "--label":
        parsed.labels?.push(next());
        break;
      case "--assignee":
        parsed.assignees?.push(next());
        break;
      case "--milestone":
        parsed.milestone = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation enqueue option: ${arg}`);
    }
  }

  if (!parsed.title) {
    throw new Error("automation enqueue requires --title");
  }

  return parsed as ParsedAutomationEnqueueCommand;
}

function parseAutomationTargetCycleListCommand(
  argv: string[],
): ParsedAutomationTargetCycleListCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation target-cycle list requires a project root");
  }

  const parsed: ParsedAutomationTargetCycleListCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation target-cycle list option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationTargetCycleRecordCommand(
  argv: string[],
): ParsedAutomationTargetCycleRecordCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation target-cycle record requires a project root");
  }

  const parsed: Partial<ParsedAutomationTargetCycleRecordCommand> = {
    projectRoot,
    workItems: [],
    blockers: [],
    notes: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--cycle-id":
        parsed.cycleId = next();
        break;
      case "--run-id":
        parsed.runId = next();
        break;
      case "--status":
        parsed.status = parseTargetCycleStatus(next(), arg);
        break;
      case "--summary":
        parsed.summary = next();
        break;
      case "--eligible-work-items":
        parsed.eligibleWorkItemCount = parseNonNegativeInteger(next(), arg);
        break;
      case "--work-item":
        parsed.workItems?.push(parseTargetCycleWorkItem(next(), arg));
        break;
      case "--work-item-status":
        lastParsedTargetCycleWorkItem(parsed, arg).cycleStatus =
          parseTargetCycleWorkItemStatus(next(), arg);
        break;
      case "--work-item-agent-profile":
        lastParsedTargetCycleWorkItem(parsed, arg).agentProfileId = next();
        break;
      case "--work-item-note":
        lastParsedTargetCycleWorkItem(parsed, arg).notes = next();
        break;
      case "--blocker":
        parsed.blockers?.push(next());
        break;
      case "--note":
        parsed.notes?.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation target-cycle record option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("automation target-cycle record requires --status");
  }

  return parsed as ParsedAutomationTargetCycleRecordCommand;
}

function parseAutomationTargetReportCommand(
  argv: string[],
): ParsedAutomationTargetReportCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation target-report requires a project root");
  }

  const parsed: ParsedAutomationTargetReportCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation target-report option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationRunOnceCommand(
  argv: string[],
): ParsedAutomationRunOnceCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation run-once requires a project root");
  }

  const parsed: Partial<ParsedAutomationRunOnceCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--command":
        parsed.command = next();
        break;
      case "--run-id":
        parsed.runId = next();
        break;
      case "--owner":
        parsed.owner = next();
        break;
      case "--branch":
        parsed.branchName = next();
        break;
      case "--worktree-name":
        parsed.worktreeName = next();
        break;
      case "--base-ref":
        parsed.baseRef = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--full":
        parsed.runFullVerification = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation run-once option: ${arg}`);
    }
  }

  return parsed as ParsedAutomationRunOnceCommand;
}

function parseAutomationStatusCommand(
  argv: string[],
): ParsedAutomationStatusCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation status requires a project root");
  }

  const parsed: ParsedAutomationStatusCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation status option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationEligibleWorkCommand(
  argv: string[],
): ParsedAutomationEligibleWorkCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation eligible-work requires a project root");
  }

  const parsed: ParsedAutomationEligibleWorkCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation eligible-work option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationAgentProfilesCommand(
  argv: string[],
): ParsedAutomationAgentProfilesCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation agent-profiles requires a project root");
  }

  const parsed: ParsedAutomationAgentProfilesCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation agent-profiles option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationScheduleCommand(
  argv: string[],
): ParsedAutomationScheduleCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation schedule requires a project root");
  }

  const parsed: Partial<ParsedAutomationScheduleCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--command":
        parsed.command = next();
        break;
      case "--owner":
        parsed.owner = next();
        break;
      case "--base-ref":
        parsed.baseRef = next();
        break;
      case "--interval-ms":
        parsed.intervalMs = parsePositiveInteger(next(), arg);
        break;
      case "--max-ticks":
        parsed.maxTicks = parsePositiveInteger(next(), arg);
        break;
      case "--max-runs":
        parsed.maxRuns = parsePositiveInteger(next(), arg);
        break;
      case "--run-id-prefix":
        parsed.runIdPrefix = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--full":
        parsed.runFullVerification = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation schedule option: ${arg}`);
    }
  }

  return parsed as ParsedAutomationScheduleCommand;
}

function printHomeInitResult(
  result: {
    homePath: string;
    configPath: string;
    config: NexusHomeConfigBase;
  },
  parsed: ParsedHomeInitCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus home initialized.");
  writeLine(stdout, `  Home: ${result.homePath}`);
  writeLine(stdout, `  Config: ${result.configPath}`);
  writeLine(stdout, `  Projects root: ${result.config.paths.projectsRoot}`);
}

function printProjectCreateResult(
  result: CreateNexusProjectResult,
  parsed: ParsedProjectCreateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus project created.");
  printProjectStatusText(result.reference, stdout);
  writeLine(stdout, `  Config: ${result.projectConfigPath}`);
}

function printProjectImportResult(
  result: ImportNexusProjectResult,
  parsed: ParsedProjectImportCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus project imported.");
  printProjectStatusText(result.reference, stdout);
  writeLine(stdout, `  Config: ${result.projectConfigPath}`);
}

function printProjectListResult(
  result: ListNexusProjectsResult,
  parsed: ParsedProjectListCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus projects: ${result.projects.length}`);
  for (const project of result.projects) {
    writeLine(stdout, `  ${project.id} ${project.projectRoot}`);
  }
}

function printProjectStatusResult(
  project: NexusProjectStatusBase,
  parsed: ParsedProjectStatusCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, project };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus project ${project.id}.`);
  printProjectStatusText(project, stdout);
  writeLine(
    stdout,
    `  Work tracking: ${project.workTracking?.provider ?? "not configured"}`,
  );
  writeLine(stdout, `  Components: ${project.components.length}`);
  for (const component of project.components) {
    writeLine(
      stdout,
      `    ${component.id} [${component.role}] ${component.sourceRoot}`,
    );
  }
  writeLine(stdout, `  Config exists: ${project.projectConfigExists}`);
  writeLine(stdout, `  Worktrees root: ${project.worktreesRoot}`);
}

function printProjectMcpRefreshResult(
  result: MaterializeNexusProjectAgentMcpConfigResult,
  parsed: ParsedProjectMcpRefreshCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus MCP agent config refreshed.");
  writeLine(stdout, `  Agent targets: ${result.agentTargets.length}`);
  for (const target of result.agentTargets) {
    writeLine(
      stdout,
      `    ${target.agent}: ${target.configPath} (${target.serverName})`,
    );
  }
  if (result.gitExcludeEntries.length > 0) {
    writeLine(stdout, `  Git exclude entries: ${result.gitExcludeEntries.length}`);
  }
}

function printProjectTrackerConfigureResult(
  result: ConfigureNexusProjectTrackerResult,
  parsed: ParsedProjectTrackerConfigureCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus project tracker configured.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Provider: ${result.workTracking.provider}`);
}

function printProjectTrackerLinkResult(
  result: LinkNexusProjectTrackerResult,
  parsed: ParsedProjectTrackerLinkCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus project tracker linked.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Tracker project: ${result.vibeKanbanProjectId}`);
}

function printCoordinationStatusResult(
  status: NexusCoordinationStatus,
  parsed: ParsedCoordinationStatusCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, status };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination status.");
  writeLine(stdout, `  Project: ${status.project.id}`);
  writeLine(stdout, `  Component: ${status.component.id}`);
  if (status.workItem) {
    writeLine(stdout, `  Work item: ${status.workItem.id} ${status.workItem.title}`);
  }
  writeLine(stdout, `  Repository: ${status.git.repositoryPath ?? "not resolved"}`);
  writeLine(stdout, `  Branch: ${status.git.branch ?? "unknown"}`);
  writeLine(
    stdout,
    `  Dirty: ${status.git.dirty === null ? "unknown" : String(status.git.dirty)}`,
  );
  writeLine(
    stdout,
    `  Pushed: ${status.git.pushed === null ? "unknown" : String(status.git.pushed)}`,
  );
  writeLine(stdout, `  Handoffs: ${status.handoffs.records.length}`);
  writeLine(stdout, `  Next action: ${status.nextAction}`);
}

function printCoordinationHandoffResult(
  result: NexusCoordinationHandoffResult,
  parsed: ParsedCoordinationHandoffCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination handoff recorded.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Component: ${result.component.id}`);
  writeLine(stdout, `  Work item: ${result.record.workItemId}`);
  writeLine(stdout, `  Status: ${result.record.status}`);
  writeLine(stdout, `  Branch: ${result.record.branch ?? "unknown"}`);
  writeLine(stdout, `  Comment: ${result.comment.id}`);
}

function printWorkItemCreateResult(
  item: WorkItem,
  parsed: ParsedWorkItemCreateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItem: item };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item created.");
  writeLine(stdout, `  Id: ${item.id}`);
  writeLine(stdout, `  Title: ${item.title}`);
  writeLine(stdout, `  Status: ${item.status}`);
}

function printWorkItemListResult(
  items: WorkItem[],
  parsed: ParsedWorkItemListCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItems: items };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus work items: ${items.length}`);
  for (const item of items) {
    writeLine(stdout, `  ${item.id} [${item.status}] ${item.title}`);
  }
}

function printWorkItemGetResult(
  item: WorkItem,
  parsed: ParsedWorkItemGetCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItem: item };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus work item ${item.id}.`);
  writeLine(stdout, `  Title: ${item.title}`);
  writeLine(stdout, `  Status: ${item.status}`);
}

function printWorkItemUpdateResult(
  item: WorkItem,
  parsed: ParsedWorkItemUpdateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItem: item };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item updated.");
  writeLine(stdout, `  Id: ${item.id}`);
  writeLine(stdout, `  Title: ${item.title}`);
  writeLine(stdout, `  Status: ${item.status}`);
}

function printWorkItemCommentResult(
  comment: WorkComment,
  parsed: ParsedWorkItemCommentCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, comment };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item comment added.");
  writeLine(stdout, `  Id: ${comment.id}`);
}

function printAutomationScheduleTick(
  tick: NexusAutomationSchedulerTick,
  stdout: TextWriter,
): void {
  const runStatus = tick.run ? ` run=${tick.run.status}` : "";
  const wait = tick.waitMs === null ? "" : ` waitMs=${tick.waitMs}`;
  writeLine(
    stdout,
    `DevNexus scheduler tick ${tick.index}: ${tick.status.status} action=${tick.action}${runStatus}${wait}`,
  );
}

function printAutomationEnqueueResult(
  result: EnqueueNexusAutomationWorkItemResult,
  parsed: ParsedAutomationEnqueueCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus automation work item enqueued.");
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Id: ${result.workItem.id}`);
  writeLine(stdout, `  Title: ${result.workItem.title}`);
  writeLine(stdout, `  Status: ${result.workItem.status}`);
}

function printAutomationTargetCycleListResult(
  result: {
    projectConfig: NexusProjectConfig;
    ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
  },
  parsed: ParsedAutomationTargetCycleListCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus target cycles.");
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Cycles: ${result.ledger.cycles.length}`);
  const lastCycle = result.ledger.cycles.at(-1);
  if (lastCycle) {
    writeLine(stdout, `  Last cycle: ${lastCycle.id} ${lastCycle.status}`);
    if (lastCycle.summary) {
      writeLine(stdout, `  Summary: ${lastCycle.summary}`);
    }
  }
}

function printAutomationTargetCycleRecordResult(
  result: {
    projectConfig: NexusProjectConfig;
    record: NexusAutomationTargetCycleRecordInput;
    ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
  },
  parsed: ParsedAutomationTargetCycleRecordCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus target cycle recorded.");
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Cycle: ${result.record.id}`);
  writeLine(stdout, `  Status: ${result.record.status}`);
  writeLine(stdout, `  Cycles recorded: ${result.ledger.cycles.length}`);
}

function printAutomationTargetReportResult(
  result: NexusAutomationTargetReport,
  parsed: ParsedAutomationTargetReportCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, report: result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus target report: ${result.status}.`);
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Reason: ${result.statusReason}`);
  if (result.target?.objective) {
    writeLine(stdout, `  Objective: ${result.target.objective}`);
  }
  if (result.cycleSummary) {
    writeLine(stdout, `  Target cycles: ${result.cycleSummary.cycleCount}`);
  }
  if (result.runSummary) {
    writeLine(stdout, `  Automation runs: ${result.runSummary.runCount}`);
  }
  writeLine(
    stdout,
    `  Relaunch decision: ${result.relaunchDecision.type} (${result.relaunchDecision.reason})`,
  );
  if (result.workItemSummary) {
    writeLine(
      stdout,
      `  Work item refs: ${result.workItemSummary.uniqueReferences.length}`,
    );
  }
  if (result.blockers.length > 0) {
    writeLine(stdout, `  Blockers: ${result.blockers.length}`);
  }
}

function printAutomationScheduleResult(
  result: RunNexusAutomationSchedulerResult,
  parsed: ParsedAutomationScheduleCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus automation scheduler stopped.");
  writeLine(stdout, `  Reason: ${result.stoppedReason}`);
  writeLine(stdout, `  Ticks: ${result.ticks.length}`);
  writeLine(stdout, `  Runs: ${result.runs.length}`);
  const lastTick = result.ticks.at(-1);
  if (lastTick) {
    writeLine(stdout, `  Last status: ${lastTick.status.status}`);
    writeLine(stdout, `  Last action: ${lastTick.action}`);
  }
}

function printAutomationRunOnceResult(
  result: RunNexusAutomationOnceResult,
  parsed: ParsedAutomationRunOnceCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus automation run ${result.status}.`);
  writeLine(stdout, `  Run: ${result.runId}`);
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  if (result.workItem) {
    writeLine(stdout, `  Work item: ${result.workItem.id} ${result.workItem.title}`);
  }
  if (result.worktree) {
    writeLine(stdout, `  Worktree: ${result.worktree.worktreePath}`);
    writeLine(stdout, `  Branch: ${result.worktree.branchName}`);
  }
  if (result.execution) {
    writeLine(
      stdout,
      `  Verification: ${result.execution.verification.length} record(s)`,
    );
    writeLine(stdout, `  Commits: ${result.execution.commitIds.length}`);
  }
}

function printAutomationAgentLaunchResult(
  result: RunNexusAutomationAgentLaunchOnceResult,
  parsed: ParsedAutomationRunOnceCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus automation agent launch ${result.status}.`);
  writeLine(stdout, `  Run: ${result.runId}`);
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  writeLine(stdout, `  Eligible work items: ${result.eligibleWorkItems.length}`);
  if (result.contextFile) {
    writeLine(stdout, `  Context: ${result.contextFile}`);
  }
  if (result.resultFile) {
    writeLine(stdout, `  Result file: ${result.resultFile}`);
  }
  if (result.launch?.verification) {
    writeLine(stdout, `  Verification: ${result.launch.verification.length} record(s)`);
  }
  if (result.launch?.commitIds) {
    writeLine(stdout, `  Commits: ${result.launch.commitIds.length}`);
  }
}

function printAutomationStatusResult(
  result: NexusAutomationStatus,
  parsed: ParsedAutomationStatusCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus automation status: ${result.status}.`);
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  if (result.target) {
    writeLine(stdout, `  Target state: ${result.target.statePath}`);
    if (result.target.objective) {
      writeLine(stdout, `  Target objective: ${result.target.objective}`);
    }
  }
  if (result.agent) {
    if (result.agent.coordinatorProfileId) {
      writeLine(
        stdout,
        `  Coordinator profile: ${result.agent.coordinatorProfileId}`,
      );
    }
    writeLine(
      stdout,
      `  Max concurrent subagents: ${result.agent.maxConcurrentSubagents}`,
    );
  }
  if (result.selectedWorkItem) {
    writeLine(
      stdout,
      `  Selected work item: ${result.selectedWorkItem.id} ${result.selectedWorkItem.title}`,
    );
  }
  if (result.eligibleWorkItems) {
    writeLine(stdout, `  Eligible work items: ${result.eligibleWorkItems.length}`);
  }
  if (result.targetCycles) {
    writeLine(stdout, `  Target cycles: ${result.targetCycles.cycleCount}`);
    if (result.targetCycles.lastCycle) {
      writeLine(
        stdout,
        `  Last target cycle: ${result.targetCycles.lastCycle.id} ${result.targetCycles.lastCycle.status}`,
      );
    }
  }
  if (result.candidateCount !== null) {
    writeLine(stdout, `  Candidates: ${result.candidateCount}`);
  }
  if (result.lock) {
    writeLine(stdout, `  Lock: ${result.lock.status}`);
  }
  if (result.ledger) {
    writeLine(stdout, `  Runs recorded: ${result.ledger.runs.length}`);
    const lastRun = result.ledger.runs.at(-1);
    if (lastRun) {
      writeLine(
        stdout,
        `  Last run: ${lastRun.id} ${lastRun.status} ${lastRun.summary ?? ""}`.trimEnd(),
      );
    }
  }
}

function printAutomationEligibleWorkResult(
  result: NexusAutomationEligibleWorkSummary,
  parsed: ParsedAutomationEligibleWorkCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus eligible work: ${result.eligibleWorkItemCount}.`);
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Status: ${result.status}`);
  if (result.selector) {
    writeLine(stdout, `  Selector: ${formatAutomationSelector(result.selector)}`);
  }
  for (const component of result.components) {
    writeLine(
      stdout,
      `  ${component.componentId} (${component.componentName}): ${component.workItems.length}`,
    );
    for (const item of component.workItems) {
      writeLine(stdout, `    ${item.id} [${item.status}] ${item.title}`);
    }
  }
}

function printAutomationAgentProfilesResult(
  result: NexusAutomationAgentProfileSummary,
  parsed: ParsedAutomationAgentProfilesCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus agent profiles.");
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(
    stdout,
    `  Automation: ${result.automationEnabled ? result.automationMode : "disabled"}`,
  );
  if (result.coordinatorProfileId) {
    writeLine(stdout, `  Coordinator profile: ${result.coordinatorProfileId}`);
  }
  if (result.maxConcurrentSubagents !== null) {
    writeLine(
      stdout,
      `  Max concurrent subagents: ${result.maxConcurrentSubagents}`,
    );
  }
  if (result.safety) {
    writeLine(
      stdout,
      `  Safety: ${result.safety.profile} hostMutation=${result.safety.allowHostMutation} dependencyInstall=${result.safety.allowDependencyInstall} liveServices=${result.safety.allowLiveServices}`,
    );
  }
  writeLine(stdout, `  Profiles: ${result.profiles.length}`);
  for (const profile of result.profiles) {
    writeLine(
      stdout,
      `    ${profile.id} executor=${profile.executor} model=${profile.model ?? "none"} version=${profile.version ?? "none"} variant=${profile.variant ?? "none"} reasoning=${profile.reasoning ?? "none"} intelligence=${profile.intelligence ?? "none"} intendedUse=${profile.intendedUse} safety=${profile.safety.profile} command=${profile.commandConfigured ? "yes" : "no"} args=${profile.argsCount}`,
    );
  }
}

function formatAutomationSelector(
  selector: NonNullable<NexusAutomationEligibleWorkSummary["selector"]>,
): string {
  const parts: string[] = [];
  if (selector.statuses.length > 0) {
    parts.push(`status=${selector.statuses.join(",")}`);
  }
  if (selector.labels.length > 0) {
    parts.push(`label=${selector.labels.join(",")}`);
  }
  if (selector.excludeLabels.length > 0) {
    parts.push(`excludeLabel=${selector.excludeLabels.join(",")}`);
  }
  if (selector.assignees.length > 0) {
    parts.push(`assignee=${selector.assignees.join(",")}`);
  }
  if (selector.search) {
    parts.push(`search=${selector.search}`);
  }
  parts.push(`limit=${selector.limit}`);

  return parts.length > 0 ? parts.join(" ") : "none";
}

function projectLabel(config: NexusProjectConfig): string {
  return `${config.id} (${config.name})`;
}

function automationConfigForProjectRoot(projectRoot: string): {
  projectConfig: NexusProjectConfig;
  automationConfig: NonNullable<NexusProjectConfig["automation"]>;
} {
  const projectConfig = loadProjectConfig(path.resolve(projectRoot));
  const automationConfig = projectConfig.automation;
  if (!automationConfig) {
    throw new Error("Project automation is not configured");
  }

  return {
    projectConfig,
    automationConfig,
  };
}

function printProjectStatusText(
  project: Pick<NexusProjectStatusBase, "id" | "name" | "projectRoot">,
  stdout: TextWriter,
): void {
  writeLine(stdout, `  Id: ${project.id}`);
  writeLine(stdout, `  Name: ${project.name}`);
  writeLine(stdout, `  Root: ${project.projectRoot}`);
}

function fileProjectHomeStore(): NexusProjectHomeStore<NexusHomeConfigBase> {
  return {
    resolveHomePath: resolveNexusHome,
    loadHomeConfig: (homePath) =>
      loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
    saveHomeConfig: (homePath, registry) =>
      saveNexusHomeConfigFile(
        homePath,
        registry,
        validateNexusHomeConfigBase,
      ),
  };
}

function resolvedCommandHomePath(homePath: string | undefined): string {
  return resolveNexusHome(homePath ?? defaultNexusHomePath());
}

function resolveProjectStatusForCli(
  parsed: ParsedProjectStatusCommand,
): NexusProjectStatusBase {
  if (parsed.homePath) {
    return getNexusProjectStatus({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      project: parsed.project,
    }).project;
  }

  try {
    return buildNexusProjectStatusForPath(parsed.project);
  } catch (pathError) {
    try {
      return getNexusProjectStatus({
        homePath: resolvedCommandHomePath(undefined),
        homeStore: fileProjectHomeStore(),
        project: parsed.project,
      }).project;
    } catch {
      throw pathError;
    }
  }
}

function statusQuery(statuses: WorkStatus[]): WorkStatus | WorkStatus[] | undefined {
  if (statuses.length === 0) {
    return undefined;
  }

  return statuses.length === 1 ? statuses[0] : statuses;
}

function parseWorkStatus(value: string, optionName: string): WorkStatus {
  if (
    value === "todo" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done" ||
    value === "wont_do"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be a valid work status`);
}

function parseTargetCycleStatus(
  value: string,
  optionName: string,
): NexusAutomationTargetCycleStatus {
  if (
    value === "started" ||
    value === "dispatched" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be a valid target cycle status`);
}

function parseTargetCycleWorkItemStatus(
  value: string,
  optionName: string,
): NexusAutomationTargetCycleWorkItemStatus {
  if (
    value === "eligible" ||
    value === "selected" ||
    value === "dispatched" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be a valid target cycle work item status`);
}

function parseTargetCycleWorkItem(
  value: string,
  optionName: string,
): NexusAutomationTargetCycleWorkItemInput {
  const separator = value.indexOf(":");
  if (separator < 0) {
    if (!value.trim()) {
      throw new Error(`${optionName} must be a non-empty work item id`);
    }

    return {
      id: value.trim(),
      cycleStatus: "selected",
    };
  }

  const componentId = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!componentId || !id) {
    throw new Error(`${optionName} must be <component-id:id> or <id>`);
  }

  return {
    componentId,
    id,
    cycleStatus: "selected",
  };
}

function lastParsedTargetCycleWorkItem(
  parsed: Partial<ParsedAutomationTargetCycleRecordCommand>,
  optionName: string,
): NexusAutomationTargetCycleWorkItemInput {
  const item = parsed.workItems?.at(-1);
  if (!item) {
    throw new Error(`${optionName} requires a preceding --work-item`);
  }

  return item;
}

function parseTrackerProvider(
  value: string,
  optionName: string,
): ParsedProjectTrackerConfigureCommand["provider"] {
  if (
    value === "local" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be local, github, gitlab, or jira`);
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }

  return parsed;
}

function writeLine(stdout: TextWriter, line = ""): void {
  stdout.write(`${line}\n`);
}

function writeJson(stdout: TextWriter, value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  const normalize = (filePath: string): string => {
    const resolved = path.resolve(filePath);
    try {
      return fs.realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  };

  return normalize(entrypoint) === normalize(fileURLToPath(import.meta.url));
}

if (isCliEntrypoint()) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
