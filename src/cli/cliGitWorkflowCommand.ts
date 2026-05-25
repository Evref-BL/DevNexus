import process from "node:process";
import {
  buildNexusGitWorkflowPlan,
  buildNexusGitWorkflowStatus,
  type NexusGitWorkflowPlanStatusResult,
} from "../git-workflows/nexusGitWorkflowPlanStatus.js";
import {
  startNexusGitWorkflow,
  type StartNexusGitWorkflowResult,
} from "../git-workflows/nexusGitWorkflowStart.js";
import type { DevNexusCliDependencies } from "./cliCommandContext.js";
import { writeJson, writeLine, type TextWriter } from "./cliSupport.js";

export interface ParsedGitWorkflowCommand {
  command: "plan" | "status" | "start";
  projectRoot: string;
  componentId?: string | null;
  profileId?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  workItemDescription?: string | null;
  branchName?: string | null;
  worktreeName?: string | null;
  baseRef?: string | null;
  runId?: string | null;
  repositoryPath?: string | null;
  hostId?: string | null;
  agentId?: string | null;
  workerAgentProvider?: string | null;
  writeScope: string[];
  leaseNotes: string[];
  json?: boolean;
}

export async function handleGitWorkflowCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const parsed = parseGitWorkflowCommand(argv);
  if (parsed.command === "start") {
    const result = startNexusGitWorkflow({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      profileId: parsed.profileId,
      runId: parsed.runId,
      workItemId: parsed.workItemId,
      workItemTitle: parsed.workItemTitle,
      workItemDescription: parsed.workItemDescription,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      baseRef: parsed.baseRef,
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      workerAgentProvider: parsed.workerAgentProvider,
      writeScope: parsed.writeScope,
      leaseNotes: parsed.leaseNotes,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printGitWorkflowStartResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }
  const result = parsed.command === "plan"
    ? buildNexusGitWorkflowPlan({
        projectRoot: parsed.projectRoot,
        componentId: parsed.componentId,
        profileId: parsed.profileId,
        workItemId: parsed.workItemId,
        branchName: parsed.branchName,
        runId: parsed.runId,
        repositoryPath: parsed.repositoryPath,
        gitRunner: dependencies.gitRunner,
      })
    : buildNexusGitWorkflowStatus({
        projectRoot: parsed.projectRoot,
        componentId: parsed.componentId,
        profileId: parsed.profileId,
        workItemId: parsed.workItemId,
        branchName: parsed.branchName,
        runId: parsed.runId,
        repositoryPath: parsed.repositoryPath,
        gitRunner: dependencies.gitRunner,
      });
  printGitWorkflowResult(result, parsed, dependencies.stdout ?? process.stdout);
  return 0;
}

export function parseGitWorkflowCommand(argv: string[]): ParsedGitWorkflowCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "plan" && command !== "status" && command !== "start") {
    throw new Error("git-workflow requires plan, status, or start");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error(`git-workflow ${command} requires a workspace root`);
  }

  const parsed: ParsedGitWorkflowCommand = {
    command,
    projectRoot,
    writeScope: [],
    leaseNotes: [],
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
      case "--profile":
        parsed.profileId = next();
        break;
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--work-item-title":
        parsed.workItemTitle = next();
        break;
      case "--work-item-description":
        parsed.workItemDescription = next();
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
      case "--run":
        parsed.runId = next();
        break;
      case "--repository-path":
        parsed.repositoryPath = next();
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--agent":
        parsed.agentId = next();
        break;
      case "--worker-agent":
        parsed.workerAgentProvider = next();
        break;
      case "--write-scope":
        parsed.writeScope.push(next());
        break;
      case "--lease-note":
        parsed.leaseNotes.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown git-workflow ${command} option: ${arg}`);
    }
  }
  return parsed;
}

export function printGitWorkflowStartResult(
  result: StartNexusGitWorkflowResult,
  parsed: ParsedGitWorkflowCommand,
  stdout: TextWriter,
): void {
  const payload = {
    profile: result.profile,
    preparedWorktree: result.preparedSummary,
    run: result.run,
    nextActions: result.nextActions,
  };
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      result: payload,
    });
    return;
  }

  writeLine(stdout, "DevNexus Git workflow started.");
  writeLine(stdout, `  Component: ${result.prepared.worktree.componentId}`);
  writeLine(
    stdout,
    `  Profile: ${result.profile.id ?? "none"} (${result.profile.branchStrategy ?? "none"})`,
  );
  writeLine(stdout, `  Worktree: ${result.prepared.worktree.worktreePath}`);
  writeLine(stdout, `  Branch: ${result.prepared.worktree.branchName}`);
  writeLine(stdout, `  Base ref: ${result.prepared.worktree.baseRef ?? "none"}`);
  writeLine(stdout, `  Run: ${result.run.id} status=${result.run.status}`);
  writeLine(stdout, `  Lease: ${result.prepared.lease.id}`);
  writeLine(stdout, "  Next:");
  for (const action of result.nextActions) {
    writeLine(stdout, `    ${action}`);
  }
}

export function printGitWorkflowResult(
  result: NexusGitWorkflowPlanStatusResult,
  parsed: ParsedGitWorkflowCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      result,
    });
    return;
  }

  writeLine(
    stdout,
    result.mode === "plan"
      ? "DevNexus Git workflow plan."
      : "DevNexus Git workflow status.",
  );
  writeLine(stdout, `  Component: ${result.component.id}`);
  writeLine(
    stdout,
    `  Profile: ${result.profile.id ?? "none"} (${result.profile.branchStrategy ?? "none"})`,
  );
  if (result.run) {
    writeLine(stdout, `  Run: ${result.run.id} status=${result.run.status}`);
  } else {
    writeLine(stdout, "  Run: none");
  }
  writeLine(stdout, `  Target branch: ${result.refs.targetBranch ?? "none"}`);
  writeLine(
    stdout,
    `  Base ref: ${result.refs.baseRef ?? "none"}${result.refs.baseCommit ? ` @ ${result.refs.baseCommit}` : ""}`,
  );
  writeLine(stdout, `  Current branch: ${result.refs.currentBranch ?? "unknown"}`);
  writeLine(stdout, `  Next owner: ${formatOwner(result.nextOwner)}`);
  writeLine(stdout, "  Evidence gaps:");
  if (result.evidenceGaps.length === 0) {
    writeLine(stdout, "    none");
  } else {
    for (const gap of result.evidenceGaps) {
      writeLine(stdout, `    ${gap}`);
    }
  }
  writeLine(stdout, "  Blockers:");
  if (result.blockers.length === 0) {
    writeLine(stdout, "    none");
  } else {
    for (const blocker of result.blockers) {
      writeLine(stdout, `    ${blocker}`);
    }
  }
  writeLine(stdout, "  Allowed next commands:");
  for (const command of result.allowedNextCommands) {
    const mutation = command.mutates ? "mutates" : "read-only";
    writeLine(stdout, `    ${command.id}: ${command.command} (${mutation})`);
  }
}

function formatOwner(owner: NexusGitWorkflowPlanStatusResult["nextOwner"]): string {
  return owner.id ? `${owner.kind}/${owner.id}` : owner.kind;
}
