import {
  NexusGitWorkflowRunStateError,
  updateNexusGitWorkflowRun,
  type NexusGitWorkflowRunEvidenceInput,
  type NexusGitWorkflowRunOwner,
  type NexusGitWorkflowRunPreservationInput,
  type NexusGitWorkflowRunRecord,
  type NexusGitWorkflowRunStatus,
  type NexusGitWorkflowRunTerminalOutcome,
  type NexusGitWorkflowRunTransitionInput,
} from "./nexusGitWorkflowRunState.js";

export type NexusGitWorkflowLifecycleAction =
  | "pause"
  | "abort"
  | "abandon"
  | "archive"
  | "rescue"
  | "merge";

export interface NexusGitWorkflowLifecycleGitFacts {
  dirty?: boolean | null;
  unpushedCommits?: boolean | null;
}

export interface TransitionNexusGitWorkflowRunLifecycleOptions {
  projectRoot: string;
  id: string;
  action: NexusGitWorkflowLifecycleAction;
  reason: string;
  owner?: NexusGitWorkflowRunOwner | null;
  git?: NexusGitWorkflowLifecycleGitFacts | null;
  preservation?: NexusGitWorkflowRunPreservationInput | null;
  now?: Date | string | (() => Date | string);
}

export function transitionNexusGitWorkflowRunLifecycle(
  options: TransitionNexusGitWorkflowRunLifecycleOptions,
): NexusGitWorkflowRunRecord {
  validateLifecycleTransition(options);
  const timestamp = isoString(options.now);
  const status = lifecycleStatus(options.action);
  const terminal = isTerminalLifecycleStatus(status);
  return updateNexusGitWorkflowRun({
    projectRoot: options.projectRoot,
    id: options.id,
    status,
    terminalOutcome: terminal ? terminalOutcomeForLifecycle(options.action) : null,
    owner: terminal
      ? { kind: "none", id: null }
      : options.owner ?? { kind: "human", id: null },
    preservation: options.preservation ?? null,
    allowedTransitions: terminal ? [] : pausedAllowedTransitions(),
    evidence: lifecycleEvidence(options.action, options.reason, timestamp),
    nodes: [
      {
        id: options.action,
        kind: terminal ? "terminal" : "handoff",
        summary: options.reason,
        recordedAt: timestamp,
      },
    ],
    now: timestamp,
  });
}

function validateLifecycleTransition(
  options: TransitionNexusGitWorkflowRunLifecycleOptions,
): void {
  const git = options.git ?? {};
  if (options.action === "abort") {
    if (git.dirty === true || git.unpushedCommits === true) {
      throw new NexusGitWorkflowRunStateError(
        "Aborting a Git workflow run requires clean work and no unpushed commits.",
      );
    }
    return;
  }
  if (options.action === "abandon") {
    if (
      (git.dirty === true || git.unpushedCommits === true) &&
      !options.preservation
    ) {
      throw new NexusGitWorkflowRunStateError(
        "Abandoning a Git workflow run with dirty files or unpushed commits requires a rescue branch or archive record.",
      );
    }
    return;
  }
  if (options.action === "archive") {
    if (options.preservation?.kind !== "archive_record") {
      throw new NexusGitWorkflowRunStateError(
        "Archiving a Git workflow run requires archive_record preservation.",
      );
    }
    return;
  }
  if (options.action === "rescue") {
    if (options.preservation?.kind !== "rescue_branch") {
      throw new NexusGitWorkflowRunStateError(
        "Rescuing a Git workflow run requires rescue_branch preservation.",
      );
    }
    return;
  }
  if (options.action === "merge") {
    if (options.preservation?.kind !== "merged") {
      throw new NexusGitWorkflowRunStateError(
        "Marking a Git workflow run merged requires merged preservation.",
      );
    }
  }
}

function lifecycleStatus(
  action: NexusGitWorkflowLifecycleAction,
): NexusGitWorkflowRunStatus {
  if (action === "pause") {
    return "paused";
  }
  if (action === "abort") {
    return "aborted";
  }
  if (action === "abandon") {
    return "abandoned";
  }
  if (action === "archive") {
    return "archived";
  }
  if (action === "rescue") {
    return "rescued";
  }
  return "merged";
}

function terminalOutcomeForLifecycle(
  action: NexusGitWorkflowLifecycleAction,
): NexusGitWorkflowRunTerminalOutcome {
  if (action === "pause") {
    throw new NexusGitWorkflowRunStateError(
      "Paused Git workflow runs are not terminal outcomes.",
    );
  }
  if (action === "abort") {
    return "aborted";
  }
  if (action === "abandon") {
    return "abandoned";
  }
  if (action === "archive") {
    return "archived";
  }
  if (action === "rescue") {
    return "rescued";
  }
  return "merged";
}

function pausedAllowedTransitions(): NexusGitWorkflowRunTransitionInput[] {
  return [
    {
      id: "resume",
      to: "working",
      summary: "Resume the paused workflow run.",
    },
    {
      id: "abandon",
      to: "abandoned",
      summary: "Abandon the paused workflow after preserving required work.",
      requiresApproval: true,
    },
    {
      id: "archive",
      to: "archived",
      summary: "Archive the paused workflow before cleanup.",
      requiresApproval: true,
    },
    {
      id: "rescue",
      to: "rescued",
      summary: "Copy the paused workflow to a rescue branch or record.",
      requiresApproval: true,
    },
  ];
}

function lifecycleEvidence(
  action: NexusGitWorkflowLifecycleAction,
  reason: string,
  timestamp: string,
): NexusGitWorkflowRunEvidenceInput[] {
  return [
    {
      id: `lifecycle-${action}`,
      kind: "git_workflow_lifecycle",
      summary: reason,
      observedAt: timestamp,
    },
  ];
}

function isTerminalLifecycleStatus(status: NexusGitWorkflowRunStatus): boolean {
  return status !== "paused";
}

function isoString(value: Date | string | (() => Date | string) | undefined): string {
  const resolved = typeof value === "function" ? value() : value ?? new Date();
  return typeof resolved === "string" ? resolved : resolved.toISOString();
}
