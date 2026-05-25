import process from "node:process";
import {
  buildNexusGitWorkflowPlan,
  buildNexusGitWorkflowStatus,
  type NexusGitWorkflowPlanStatusResult,
} from "../git-workflows/nexusGitWorkflowPlanStatus.js";
import type { DevNexusCliDependencies } from "./cliCommandContext.js";
import { writeJson, writeLine, type TextWriter } from "./cliSupport.js";

export interface ParsedGitWorkflowCommand {
  command: "plan" | "status";
  projectRoot: string;
  componentId?: string | null;
  profileId?: string | null;
  workItemId?: string | null;
  branchName?: string | null;
  runId?: string | null;
  repositoryPath?: string | null;
  json?: boolean;
}

export async function handleGitWorkflowCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const parsed = parseGitWorkflowCommand(argv);
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
  if (command !== "plan" && command !== "status") {
    throw new Error("git-workflow requires plan or status");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error(`git-workflow ${command} requires a workspace root`);
  }

  const parsed: ParsedGitWorkflowCommand = {
    command,
    projectRoot,
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
      case "--branch":
        parsed.branchName = next();
        break;
      case "--run":
        parsed.runId = next();
        break;
      case "--repository-path":
        parsed.repositoryPath = next();
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
