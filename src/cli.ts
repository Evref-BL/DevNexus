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
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { resolveProjectSourceRoot } from "./nexusProjectLifecycle.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "./workItemService.js";
import type { GitRunner } from "./gitWorktreeService.js";
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
  now?: () => Date | string;
}

interface ParsedWorkItemCreateCommand {
  projectRoot: string;
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
  statuses: WorkStatus[];
  labels: string[];
  assignees: string[];
  search?: string;
  limit?: number;
  json?: boolean;
}

interface ParsedWorkItemGetCommand {
  projectRoot: string;
  itemId: string;
  json?: boolean;
}

interface ParsedWorkItemUpdateCommand {
  projectRoot: string;
  itemId: string;
  patch: WorkItemPatch;
  json?: boolean;
}

interface ParsedWorkItemCommentCommand {
  projectRoot: string;
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
    "  dev-nexus work-item create <project-root> --title <title> [options]",
    "  dev-nexus work-item list <project-root> [options]",
    "  dev-nexus work-item get <project-root> <work-item-id> [options]",
    "  dev-nexus work-item update <project-root> <work-item-id> [options]",
    "  dev-nexus work-item comment <project-root> <work-item-id> --body <text> [options]",
    "  dev-nexus automation status <project-root> [options]",
    "  dev-nexus automation run-once <project-root> [--command <command>] [options]",
    "  dev-nexus automation schedule <project-root> [--command <command>] [options]",
    "",
    "Options for work-item create:",
    "  --title <title>",
    "  --description <text>",
    "  --status <todo|ready|in_progress|blocked|done|wont_do>",
    "  --label <label>            repeatable",
    "  --assignee <assignee>      repeatable",
    "  --milestone <text>",
    "  --json",
    "",
    "Options for work-item list:",
    "  --status <todo|ready|in_progress|blocked|done|wont_do>  repeatable",
    "  --label <label>            repeatable",
    "  --assignee <assignee>      repeatable",
    "  --search <text>",
    "  --limit <count>",
    "  --json",
    "",
    "Options for work-item get:",
    "  --json",
    "",
    "Options for work-item update:",
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
    "  --body <text>",
    "  --json",
    "",
    "Options for automation status:",
    "  --json",
    "",
    "Options for automation run-once:",
    "  --command <command>        shell command to run; overrides automation.executor.command",
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
    "  --command <command>        shell command to run; overrides automation.executor.command",
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

  if (argv[0] === "work-item") {
    return handleWorkItemCommand(argv, dependencies);
  }
  if (argv[0] === "automation") {
    return handleAutomationCommand(argv, dependencies);
  }

  throw new Error("dev-nexus requires work-item, automation, or --help");
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

  if (argv[1] === "schedule") {
    const parsed = parseAutomationScheduleCommand(argv);
    const executorOptions = resolveAutomationExecutorCliOptions(
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
      executor: createNexusAutomationCommandExecutor({
        command: executorOptions.command,
        commandRunner: dependencies.commandRunner,
        gitRunner: dependencies.gitRunner,
        runFullVerification: executorOptions.runFullVerification,
        timeoutMs: executorOptions.timeoutMs,
      }),
    });
    printAutomationScheduleResult(result, parsed, stdout);
    return 0;
  }

  if (argv[1] !== "run-once") {
    throw new Error("automation requires status, run-once, or schedule");
  }

  const parsed = parseAutomationRunOnceCommand(argv);
  const executorOptions = resolveAutomationExecutorCliOptions("run-once", parsed);
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
      command: executorOptions.command,
      commandRunner: dependencies.commandRunner,
      gitRunner: dependencies.gitRunner,
      runFullVerification: executorOptions.runFullVerification,
      timeoutMs: executorOptions.timeoutMs,
    }),
  });
  printAutomationRunOnceResult(
    result,
    parsed,
    dependencies.stdout ?? process.stdout,
  );
  return 0;
}

function resolveAutomationExecutorCliOptions(
  commandName: "run-once" | "schedule",
  parsed: ParsedAutomationRunOnceCommand | ParsedAutomationScheduleCommand,
): {
  command: string;
  runFullVerification: boolean;
  timeoutMs?: number;
} {
  const config = loadProjectConfig(path.resolve(parsed.projectRoot));
  const configuredExecutor = config.automation?.executor;
  const command = parsed.command ?? configuredExecutor?.command ?? undefined;
  if (!command) {
    throw new Error(
      `automation ${commandName} requires --command or project config automation.executor.command`,
    );
  }

  return {
    command,
    runFullVerification:
      parsed.runFullVerification ??
      configuredExecutor?.runFullVerification ??
      false,
    ...(parsed.timeoutMs ?? configuredExecutor?.timeoutMs
      ? { timeoutMs: parsed.timeoutMs ?? configuredExecutor?.timeoutMs ?? undefined }
      : {}),
  };
}

function workItemService(
  projectRoot: string,
  dependencies: DevNexusCliDependencies,
) {
  return createWorkItemService({
    resolveProject: () => resolveDirectProject(projectRoot),
    now: dependencies.now,
  });
}

function resolveDirectProject(projectRoot: string): ResolvedWorkItemProjectContext {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = loadProjectConfig(resolvedProjectRoot);
  if (!config.workTracking) {
    throw new Error("Project work tracking is not configured");
  }

  return {
    homePath: config.home ?? "",
    projectRoot: resolvedProjectRoot,
    projectId: config.id,
    projectName: config.name,
    sourceRoot: resolveProjectSourceRoot(resolvedProjectRoot, config),
    workTracking: config.workTracking,
  };
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
  for (const arg of rest) {
    switch (arg) {
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
  if (result.selectedWorkItem) {
    writeLine(
      stdout,
      `  Selected work item: ${result.selectedWorkItem.id} ${result.selectedWorkItem.title}`,
    );
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

function projectLabel(config: NexusProjectConfig): string {
  return `${config.id} (${config.name})`;
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

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
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
