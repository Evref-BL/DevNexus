import {
  summarizeNexusManualWorktreeResult,
  type PrepareNexusManualWorktreeResult,
} from "../worktrees/nexusManualWorktree.js";
import type { NexusQuickFixPlan } from "../operations/nexusQuickFix.js";
import {
  parsePositiveInteger,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";

export interface ParsedQuickFixPlanCommand {
  command: "plan" | "start" | "finish";
  projectRoot: string;
  componentId?: string;
  workItemId: string;
  topic?: string | null;
  branchName?: string | null;
  worktreeName?: string | null;
  writeScope: string[];
  verificationCommands: string[];
  prUrl?: string | null;
  mergeCommit?: string | null;
  verificationSummary?: string | null;
  cleanupActions: string[];
  json?: boolean;
}

export function parseQuickFixPlanCommand(argv: string[]): ParsedQuickFixPlanCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "plan" && command !== "start" && command !== "finish") {
    throw new Error("quick-fix requires plan, start, or finish");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error(`quick-fix ${command} requires a workspace root`);
  }

  const parsed: Partial<ParsedQuickFixPlanCommand> = {
    command,
    projectRoot,
    writeScope: [],
    verificationCommands: [],
    cleanupActions: [],
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
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--topic":
        parsed.topic = next();
        break;
      case "--branch":
        parsed.branchName = next();
        break;
      case "--worktree-name":
        parsed.worktreeName = next();
        break;
      case "--write-scope":
        parsed.writeScope!.push(next());
        break;
      case "--verification-command":
        parsed.verificationCommands!.push(next());
        break;
      case "--pr-url":
        parsed.prUrl = next();
        break;
      case "--merge-commit":
        parsed.mergeCommit = next();
        break;
      case "--verification":
        parsed.verificationSummary = next();
        break;
      case "--cleanup-action":
        parsed.cleanupActions!.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown quick-fix plan option: ${arg}`);
    }
  }
  if (!parsed.workItemId) {
    throw new Error(`quick-fix ${command} requires --work-item`);
  }
  if (command === "finish") {
    if (!parsed.prUrl) {
      throw new Error("quick-fix finish requires --pr-url");
    }
    if (!parsed.mergeCommit) {
      throw new Error("quick-fix finish requires --merge-commit");
    }
    if (!parsed.verificationSummary) {
      throw new Error("quick-fix finish requires --verification");
    }
  }

  return parsed as ParsedQuickFixPlanCommand;
}

export function printQuickFixPlan(
  plan: NexusQuickFixPlan,
  parsed: ParsedQuickFixPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus quick-fix plan.");
  writeLine(
    stdout,
    `  Issue: ${plan.issue.repository}#${plan.issue.number} (${plan.issue.workItemId})`,
  );
  writeLine(stdout, `  Component: ${plan.component.id}`);
  writeLine(stdout, `  Branch: ${plan.branch.name}`);
  writeLine(stdout, `  Worktree name: ${plan.branch.worktreeName}`);
  writeLine(
    stdout,
    `  Publication: ${plan.publication.strategy} remote=${plan.publication.remote ?? "none"} target=${plan.publication.targetBranch ?? "none"}`,
  );
  if (plan.warnings.length > 0) {
    for (const warning of plan.warnings) {
      writeLine(stdout, `  Warning: ${warning}`);
    }
  }
  writeLine(stdout, "  Start:");
  for (const step of plan.startSteps) {
    writeLine(stdout, `    ${step.title}: ${formatQuickFixStep(step)}`);
  }
  writeLine(stdout, "  Finish:");
  for (const step of plan.finishSteps) {
    writeLine(stdout, `    ${step.title}: ${formatQuickFixStep(step)}`);
  }
  writeLine(stdout, "  Skipped bookkeeping:");
  for (const item of plan.skippedBookkeeping) {
    writeLine(stdout, `    ${item}`);
  }
}

export function printQuickFixStart(
  plan: NexusQuickFixPlan,
  prepared: PrepareNexusManualWorktreeResult,
  parsed: ParsedQuickFixPlanCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    mode: "start",
    ...plan,
    preparedWorktree: summarizeNexusManualWorktreeResult(prepared),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus quick-fix started.");
  writeLine(
    stdout,
    `  Issue: ${plan.issue.repository}#${plan.issue.number} (${plan.issue.workItemId})`,
  );
  writeLine(stdout, `  Worktree: ${prepared.worktree.worktreePath}`);
  writeLine(stdout, `  Branch: ${prepared.worktree.branchName}`);
  writeLine(stdout, `  Lease: ${prepared.lease.id}`);
  writeLine(stdout, "  Next:");
  for (const step of plan.startSteps.filter((step) => step.id !== "prepare-worktree")) {
    writeLine(stdout, `    ${step.title}: ${formatQuickFixStep(step)}`);
  }
  writeLine(stdout, "  Finish:");
  for (const step of plan.finishSteps) {
    writeLine(stdout, `    ${step.title}: ${formatQuickFixStep(step)}`);
  }
  writeLine(stdout, "  Skipped bookkeeping:");
  for (const item of plan.skippedBookkeeping) {
    writeLine(stdout, `    ${item}`);
  }
}

export function printQuickFixFinish(
  plan: NexusQuickFixPlan,
  parsed: ParsedQuickFixPlanCommand,
  stdout: TextWriter,
): void {
  const result = {
    prUrl: parsed.prUrl!,
    mergeCommit: parsed.mergeCommit!,
    verification: parsed.verificationSummary!,
    cleanupActions: parsed.cleanupActions,
    skippedBookkeeping: plan.skippedBookkeeping,
  };
  const payload = {
    ok: true,
    mode: "finish",
    issue: plan.issue,
    component: plan.component,
    branch: plan.branch,
    result,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus quick-fix finished.");
  writeLine(
    stdout,
    `  Issue: ${plan.issue.repository}#${plan.issue.number} (${plan.issue.workItemId})`,
  );
  writeLine(stdout, `  PR: ${result.prUrl}`);
  writeLine(stdout, `  Merge commit: ${result.mergeCommit}`);
  writeLine(stdout, `  Verification: ${result.verification}`);
  if (result.cleanupActions.length > 0) {
    writeLine(stdout, "  Cleanup:");
    for (const action of result.cleanupActions) {
      writeLine(stdout, `    ${action}`);
    }
  }
  writeLine(stdout, "  Skipped bookkeeping:");
  for (const item of result.skippedBookkeeping) {
    writeLine(stdout, `    ${item}`);
  }
}

function formatQuickFixStep(step: NexusQuickFixCommandStepLike): string {
  const environment = Object.entries(step.environment);
  const envPrefix =
    environment.length === 0
      ? ""
      : `${environment
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")} `;
  return `${envPrefix}${step.command}${step.note ? ` (${step.note})` : ""}`;
}

interface NexusQuickFixCommandStepLike {
  command: string;
  environment: Record<string, string>;
  note: string | null;
}
