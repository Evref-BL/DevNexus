import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";
import type {
  NexusAutomationExecutor,
  NexusAutomationExecutorInput,
  NexusAutomationExecutorResult,
  NexusAutomationExecutorStatus,
} from "./nexusAutomationRunOnce.js";
import type {
  WorktreePublicationDecisionInput,
  WorktreeVerificationInput,
  WorktreeVerificationStatus,
} from "./worktreeExecutionMetadata.js";

export interface NexusAutomationCommandRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface NexusAutomationCommandRunResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export type NexusAutomationCommandRunner = (
  command: string,
  options: NexusAutomationCommandRunOptions,
) => NexusAutomationCommandRunResult;

export interface CreateNexusAutomationCommandExecutorOptions {
  command: string;
  runFullVerification?: boolean;
  commandRunner?: NexusAutomationCommandRunner;
  gitRunner?: GitRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class NexusAutomationCommandExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationCommandExecutorError";
  }
}

export function createNexusAutomationCommandExecutor(
  options: CreateNexusAutomationCommandExecutorOptions,
): NexusAutomationExecutor {
  const command = requiredNonEmptyString(options.command, "command");
  const commandRunner = options.commandRunner ?? defaultNexusAutomationCommandRunner;
  const gitRunner = options.gitRunner ?? defaultGitRunner;

  return async (
    input: NexusAutomationExecutorInput,
  ): Promise<NexusAutomationExecutorResult> => {
    const env = executorEnvironment(options.env ?? process.env, input);
    const commandResult = commandRunner(command, {
      cwd: input.worktree.worktreePath,
      env,
      timeoutMs: options.timeoutMs,
    });
    const verification: WorktreeVerificationInput[] = [
      verificationFromCommandResult(commandResult),
    ];

    if (!commandSucceeded(commandResult)) {
      return {
        status: "failed",
        summary: `Executor command failed: ${commandSummary(commandResult)}`,
        verification,
        commitIds: newCommitIds(input, gitRunner),
        publicationDecision: publicationDecision(input, "failed"),
        error: commandSummary(commandResult),
      };
    }

    const verificationCommands = [
      ...input.automationConfig.verification.focusedCommands,
      ...(options.runFullVerification
        ? input.automationConfig.verification.fullCommands
        : []),
    ];
    for (const verificationCommand of verificationCommands) {
      verification.push(
        verificationFromCommandResult(
          commandRunner(verificationCommand, {
            cwd: input.worktree.worktreePath,
            env,
            timeoutMs: options.timeoutMs,
          }),
        ),
      );
    }

    const failedVerification = verification.filter(
      (record) => record.status === "failed",
    );
    const status: NexusAutomationExecutorStatus =
      input.automationConfig.verification.requirePassing &&
      failedVerification.length > 0
        ? "failed"
        : "completed";

    return {
      status,
      summary: executorSummary(status, verification),
      verification,
      commitIds: newCommitIds(input, gitRunner),
      publicationDecision: publicationDecision(input, status),
      ...(status === "failed"
        ? { error: `${failedVerification.length} command(s) failed` }
        : {}),
    };
  };
}

export function defaultNexusAutomationCommandRunner(
  command: string,
  options: NexusAutomationCommandRunOptions,
): NexusAutomationCommandRunResult {
  const capture = createCommandCaptureFiles();
  let result: ReturnType<typeof spawnSync> | null = null;
  try {
    result = spawnSync(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      stdio: ["ignore", capture.stdoutFd, capture.stderrFd],
      timeout: options.timeoutMs,
      windowsHide: true,
    });
  } finally {
    capture.close();
  }

  try {
    return {
      command,
      cwd: options.cwd,
      stdout: readOutputPreview(capture.stdoutPath),
      stderr: readOutputPreview(capture.stderrPath),
      exitCode: result?.status ?? null,
      ...(result?.error ? { error: result.error.message } : {}),
    };
  } finally {
    capture.remove();
  }
}

export function summarizeNexusAutomationCommandRunResult(
  result: NexusAutomationCommandRunResult,
): string {
  if (result.error) {
    return result.error;
  }

  const exit = result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
  const output = commandOutputDiagnostic(result);
  return output ? `${exit}: ${truncate(output, 240)}` : exit;
}

function createCommandCaptureFiles(): {
  stdoutPath: string;
  stderrPath: string;
  stdoutFd: number;
  stderrFd: number;
  close: () => void;
  remove: () => void;
} {
  const captureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dev-nexus-command-"),
  );
  const stdoutPath = path.join(captureDir, "stdout.log");
  const stderrPath = path.join(captureDir, "stderr.log");
  const stdoutFd = fs.openSync(stdoutPath, "w");
  const stderrFd = fs.openSync(stderrPath, "w");
  let closed = false;

  return {
    stdoutPath,
    stderrPath,
    stdoutFd,
    stderrFd,
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    },
    remove: () => {
      fs.rmSync(captureDir, { recursive: true, force: true });
    },
  };
}

function executorEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  input: NexusAutomationExecutorInput,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    DEV_NEXUS_RUN_ID: input.runId,
    DEV_NEXUS_STARTED_AT: input.startedAt,
    DEV_NEXUS_PROJECT_ROOT: input.projectRoot,
    DEV_NEXUS_SOURCE_ROOT: input.sourceRoot,
    DEV_NEXUS_WORKTREE_PATH: input.worktree.worktreePath,
    DEV_NEXUS_WORKTREE_BRANCH: input.worktree.branchName,
    DEV_NEXUS_WORK_ITEM_ID: input.workItem.id,
    DEV_NEXUS_WORK_ITEM_TITLE: input.workItem.title,
    ...(input.setup.context
      ? {
          DEV_NEXUS_CONTEXT_FILE: input.setup.context.contextJsonPath,
          DEV_NEXUS_BRIEFING_FILE: input.setup.context.briefingPath,
        }
      : {}),
  };
}

function verificationFromCommandResult(
  result: NexusAutomationCommandRunResult,
): WorktreeVerificationInput {
  return {
    command: result.command,
    status: commandStatus(result),
    summary: commandSummary(result),
  };
}

function commandStatus(
  result: NexusAutomationCommandRunResult,
): WorktreeVerificationStatus {
  return commandSucceeded(result) ? "passed" : "failed";
}

function commandSucceeded(result: NexusAutomationCommandRunResult): boolean {
  return result.exitCode === 0 && !result.error;
}

function commandSummary(result: NexusAutomationCommandRunResult): string {
  return summarizeNexusAutomationCommandRunResult(result);
}

function executorSummary(
  status: NexusAutomationExecutorStatus,
  verification: WorktreeVerificationInput[],
): string {
  const failed = verification.filter((record) => record.status === "failed").length;
  const passed = verification.filter((record) => record.status === "passed").length;

  if (status === "failed") {
    return `Command executor failed: ${failed} failed, ${passed} passed`;
  }

  return `Command executor completed: ${passed} passed, ${failed} failed`;
}

function publicationDecision(
  input: NexusAutomationExecutorInput,
  status: NexusAutomationExecutorStatus,
): WorktreePublicationDecisionInput {
  const publication = input.automationConfig.publication;
  if (status !== "completed") {
    return {
      type: "blocked",
      remote: publication.remote,
      targetBranch: publication.targetBranch,
      reason: "Command executor did not complete cleanly",
    };
  }

  return {
    type: publication.strategy,
    remote: publication.remote,
    targetBranch: publication.targetBranch,
    reason: publication.push
      ? "Configured publication policy requests push; the CLI executor did not publish automatically"
      : "Recorded configured publication policy; push is disabled",
  };
}

function newCommitIds(
  input: NexusAutomationExecutorInput,
  gitRunner: GitRunner,
): string[] {
  if (!input.worktree.baseRef) {
    return [];
  }

  try {
    const result: GitCommandResult = gitRunner(
      ["rev-list", "--reverse", `${input.worktree.baseRef}..HEAD`],
      input.worktree.worktreePath,
    );
    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function outputText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  return value?.toString("utf8") ?? "";
}

function readOutputPreview(filePath: string): string {
  const maxOutputBytes = 256 * 1024;
  const stats = fs.statSync(filePath);
  if (stats.size <= maxOutputBytes) {
    return outputText(fs.readFileSync(filePath));
  }

  const chunkBytes = maxOutputBytes / 2;
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(chunkBytes);
    const tail = Buffer.alloc(chunkBytes);
    const headBytes = fs.readSync(fd, head, 0, chunkBytes, 0);
    const tailBytes = fs.readSync(
      fd,
      tail,
      0,
      chunkBytes,
      stats.size - chunkBytes,
    );
    const omittedBytes = stats.size - headBytes - tailBytes;
    return [
      head.subarray(0, headBytes).toString("utf8"),
      `\n[dev-nexus output truncated: ${omittedBytes} bytes omitted]\n`,
      tail.subarray(0, tailBytes).toString("utf8"),
    ].join("");
  } finally {
    fs.closeSync(fd);
  }
}

function commandOutputDiagnostic(
  result: NexusAutomationCommandRunResult,
): string | null {
  const stderrTail = lastNonEmptyLine(result.stderr);
  const stdoutTail = lastNonEmptyLine(result.stdout);
  if (stderrTail && stdoutTail) {
    return `stderr tail: ${stderrTail}; stdout tail: ${stdoutTail}`;
  }

  return stderrTail ?? stdoutTail ?? null;
}

function lastNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationCommandExecutorError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
