import process from "node:process";
import {
  advanceNexusGitWorkflowRun,
  type NexusGitWorkflowAdvanceAuthority,
  type NexusGitWorkflowAdvanceProviderEvidence,
  type NexusGitWorkflowAdvanceResult,
  type NexusGitWorkflowProviderReviewStatus,
  type NexusGitWorkflowPublicationEvidenceStatus,
} from "../git-workflows/nexusGitWorkflowAdvance.js";
import type {
  NexusGitWorkflowMergeQueueStatus,
  NexusGitWorkflowProviderBaseStatus,
  NexusGitWorkflowProviderMergeability,
  NexusGitWorkflowRequiredChecksStatus,
  NexusGitWorkflowValidationMode,
} from "../git-workflows/nexusGitWorkflowBranchFreshness.js";
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
  command: "plan" | "status" | "start" | "advance" | "resume";
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
  provider: NexusGitWorkflowAdvanceProviderEvidence;
  authority: NexusGitWorkflowAdvanceAuthority;
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
  if (parsed.command === "advance" || parsed.command === "resume") {
    const result = advanceNexusGitWorkflowRun({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      profileId: parsed.profileId,
      workItemId: parsed.workItemId,
      branchName: parsed.branchName,
      runId: parsed.runId,
      repositoryPath: parsed.repositoryPath,
      provider: parsed.provider,
      authority: parsed.authority,
      now: dependencies.now,
    });
    printGitWorkflowAdvanceResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
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
  if (
    command !== "plan" &&
    command !== "status" &&
    command !== "start" &&
    command !== "advance" &&
    command !== "resume"
  ) {
    throw new Error("git-workflow requires plan, status, start, advance, or resume");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error(`git-workflow ${command} requires a workspace root`);
  }

  const parsed: ParsedGitWorkflowCommand = {
    command,
    projectRoot,
    writeScope: [],
    leaseNotes: [],
    provider: {},
    authority: {},
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
      case "--provider-review":
        parsed.provider.review = parseProviderReviewStatus(next(), arg);
        break;
      case "--required-checks":
        parsed.provider.requiredChecks = parseRequiredChecksStatus(next(), arg);
        break;
      case "--base-status":
        parsed.provider.baseStatus = parseProviderBaseStatus(next(), arg);
        break;
      case "--mergeable":
        parsed.provider.mergeable = parseProviderMergeability(next(), arg);
        break;
      case "--validation-mode":
        parsed.provider.validationMode = parseValidationMode(next(), arg);
        break;
      case "--merge-queue":
        parsed.provider.mergeQueue = parseMergeQueueStatus(next(), arg);
        break;
      case "--publication":
        parsed.provider.publication = parsePublicationStatus(next(), arg);
        break;
      case "--allow-git-mutation":
        parsed.authority.gitMutation = true;
        break;
      case "--allow-provider-write":
        parsed.authority.providerWrite = true;
        break;
      case "--allow-final-publication":
        parsed.authority.finalPublication = true;
        break;
      case "--allow-force-with-lease":
        parsed.authority.forceWithLease = true;
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
  if (result.decisionGraph) {
    writeLine(
      stdout,
      `  Decision graph: ${result.decisionGraph.id} node=${result.decisionGraph.currentNode?.id ?? "unknown"}`,
    );
    writeLine(stdout, "  Graph transitions:");
    if (result.decisionGraph.allowedTransitions.length === 0) {
      writeLine(stdout, "    none");
    } else {
      for (const transition of result.decisionGraph.allowedTransitions) {
        const missing = transition.missingEvidence.length > 0
          ? `missing ${transition.missingEvidence.join(", ")}`
          : "ready";
        writeLine(stdout, `    ${transition.id}: ${missing}`);
      }
    }
  }
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

export function printGitWorkflowAdvanceResult(
  result: NexusGitWorkflowAdvanceResult,
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

  writeLine(stdout, "DevNexus Git workflow advanced.");
  writeLine(stdout, `  Component: ${result.component.id}`);
  writeLine(stdout, `  Profile: ${result.profile.id} (${result.profile.branchStrategy})`);
  writeLine(stdout, `  Run: ${result.runAfter.id} status=${result.runAfter.status}`);
  writeLine(stdout, `  Action: ${result.decision.action}`);
  writeLine(stdout, `  Next owner: ${formatOwner(result.decision.nextOwner)}`);
  writeLine(stdout, "  Reasons:");
  for (const reason of result.decision.reasons) {
    writeLine(stdout, `    ${reason}`);
  }
  writeLine(stdout, "  Blockers:");
  if (result.decision.blockers.length === 0) {
    writeLine(stdout, "    none");
  } else {
    for (const blocker of result.decision.blockers) {
      writeLine(stdout, `    ${blocker}`);
    }
  }
  if (result.decision.commands.length > 0) {
    writeLine(stdout, "  Commands:");
    for (const command of result.decision.commands) {
      writeLine(stdout, `    ${command}`);
    }
  }
}

function formatOwner(owner: NexusGitWorkflowPlanStatusResult["nextOwner"]): string {
  return owner.id ? `${owner.kind}/${owner.id}` : owner.kind;
}

function parseProviderReviewStatus(
  value: string,
  option: string,
): NexusGitWorkflowProviderReviewStatus {
  if (
    value === "approved" ||
    value === "changes_requested" ||
    value === "pending" ||
    value === "missing" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`${option} must be approved, changes_requested, pending, missing, or unknown`);
}

function parseRequiredChecksStatus(
  value: string,
  option: string,
): NexusGitWorkflowRequiredChecksStatus {
  if (
    value === "passed" ||
    value === "pending" ||
    value === "failed" ||
    value === "stale" ||
    value === "missing" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`${option} must be passed, pending, failed, stale, missing, or unknown`);
}

function parseProviderBaseStatus(
  value: string,
  option: string,
): NexusGitWorkflowProviderBaseStatus {
  if (
    value === "up_to_date" ||
    value === "behind" ||
    value === "diverged" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`${option} must be up_to_date, behind, diverged, or unknown`);
}

function parseProviderMergeability(
  value: string,
  option: string,
): NexusGitWorkflowProviderMergeability {
  if (value === "mergeable" || value === "conflicting" || value === "unknown") {
    return value;
  }
  throw new Error(`${option} must be mergeable, conflicting, or unknown`);
}

function parseValidationMode(
  value: string,
  option: string,
): NexusGitWorkflowValidationMode {
  if (
    value === "strict_checks" ||
    value === "loose_checks" ||
    value === "merge_queue"
  ) {
    return value;
  }
  throw new Error(`${option} must be strict_checks, loose_checks, or merge_queue`);
}

function parseMergeQueueStatus(
  value: string,
  option: string,
): NexusGitWorkflowMergeQueueStatus {
  if (
    value === "available" ||
    value === "queued" ||
    value === "unavailable" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`${option} must be available, queued, unavailable, or unknown`);
}

function parsePublicationStatus(
  value: string,
  option: string,
): NexusGitWorkflowPublicationEvidenceStatus {
  if (
    value === "completed" ||
    value === "pending" ||
    value === "missing" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`${option} must be completed, pending, missing, or unknown`);
}
