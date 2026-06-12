import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "../worktrees/gitWorktreeService.js";
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
} from "../worktrees/worktreeExecutionMetadata.js";
import { nonInteractiveGitEnvironment } from "./nexusAutomationEnvironment.js";
import { resolveNexusCommandPath } from "../runtime/nexusCommandPath.js";
import {
  filterNexusSubprocessOutput,
  type NexusSubprocessOutputFilterPolicy,
  type NexusSubprocessOutputFilterRecord,
} from "../runtime/nexusSubprocessOutputFilter.js";
import {
  nexusPublicationCommandGuardrailId,
  publicationGuardrailEnvironment,
} from "./nexusWorktreePublicationGuardrails.js";

export interface NexusAutomationCommandRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  outputFilter?: NexusSubprocessOutputFilterPolicy;
  timeoutMs?: number;
}

export interface NexusAutomationCommandSpec {
  command: string;
  args: string[];
  display: string;
}

export interface NexusAutomationCommandRunResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  outputFiltering?: NexusAutomationCommandOutputFiltering;
}

export interface NexusAutomationCommandOutputFiltering {
  stdout: NexusSubprocessOutputFilterRecord;
  stderr: NexusSubprocessOutputFilterRecord;
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
  outputFilter?: NexusSubprocessOutputFilterPolicy;
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
      outputFilter: options.outputFilter,
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
            outputFilter: options.outputFilter,
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
  const commandSpec = safeParseNexusAutomationCommandExpression(command);
  if ("error" in commandSpec) {
    return {
      command: commandSpec.display,
      cwd: options.cwd,
      stdout: "",
      stderr: "",
      exitCode: null,
      error: commandSpec.error,
    };
  }

  const capture = createCommandCaptureFiles();
  let result: ReturnType<typeof spawnSync> | null = null;
  const spawnTarget = resolveCommandSpawnTarget(commandSpec, options.env);
  try {
    result = spawnSync(spawnTarget.command, spawnTarget.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", capture.stdoutFd, capture.stderrFd],
      timeout: options.timeoutMs,
      windowsHide: true,
    });
  } finally {
    capture.close();
  }

  try {
    const output = readCommandOutputPreviews(commandSpec, capture, options);
    return {
      command: commandSpec.display,
      cwd: options.cwd,
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: result?.status ?? null,
      ...(result?.error ? { error: result.error.message } : {}),
      ...(output.outputFiltering
        ? { outputFiltering: output.outputFiltering }
        : {}),
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

export function parseNexusAutomationCommandExpression(
  command: string,
): NexusAutomationCommandSpec {
  const display = requiredNonEmptyString(command, "command");
  const words = splitNexusAutomationCommandExpression(display);
  if (words.length === 0 || words[0]!.trim().length === 0) {
    throw new NexusAutomationCommandExecutorError(
      "command must contain an executable",
    );
  }

  return {
    command: words[0]!,
    args: words.slice(1),
    display,
  };
}

function safeParseNexusAutomationCommandExpression(command: string):
  | NexusAutomationCommandSpec
  | { display: string; error: string } {
  try {
    return parseNexusAutomationCommandExpression(command);
  } catch (error) {
    return {
      display: typeof command === "string" && command.trim()
        ? command.trim()
        : "<invalid command>",
      error: errorMessage(error),
    };
  }
}

// Legacy CLI/config values stay string-compatible, but DevNexus treats them as
// argv expressions, not shell scripts. Unquoted shell control syntax is rejected
// so callers must choose a shell executable explicitly when they really need one.
function splitNexusAutomationCommandExpression(command: string): string[] {
  const state: CommandExpressionParserState = {
    words: [],
    current: "",
    tokenStarted: false,
    quote: null,
  };

  for (let index = 0; index < command.length; index += 1) {
    index = readCommandExpressionCharacter(command, index, state);
  }

  return finishCommandExpressionParse(state);
}

interface CommandExpressionParserState {
  words: string[];
  current: string;
  tokenStarted: boolean;
  quote: "'" | "\"" | null;
}

function readCommandExpressionCharacter(
  command: string,
  index: number,
  state: CommandExpressionParserState,
): number {
  const char = command[index]!;
  assertCommandExpressionCharacterAllowed(char, state.quote);

  if (isCommandExpressionWhitespace(char, state.quote)) {
    flushCommandExpressionToken(state);
    return index;
  }
  if (isCommandExpressionQuoteToggle(char, state.quote)) {
    toggleCommandExpressionQuote(state, char);
    return index;
  }
  if (isCommandExpressionEscapeStart(char, state.quote)) {
    return appendCommandExpressionEscape(command, index, state);
  }

  appendCommandExpressionCharacter(state, char);
  return index;
}

function assertCommandExpressionCharacterAllowed(
  char: string,
  quote: "'" | "\"" | null,
): void {
  if (char === "\r" || char === "\n") {
    throw new NexusAutomationCommandExecutorError(
      "command must not contain line breaks",
    );
  }
  if (!quote && isUnsupportedShellControlCharacter(char)) {
    throw new NexusAutomationCommandExecutorError(
      `command uses unsupported shell control syntax: ${char}`,
    );
  }
}

function isCommandExpressionWhitespace(
  char: string,
  quote: "'" | "\"" | null,
): boolean {
  return !quote && /\s/u.test(char);
}

function isCommandExpressionQuoteToggle(
  char: string,
  quote: "'" | "\"" | null,
): boolean {
  return (char === "'" && quote !== "\"") ||
    (char === "\"" && quote !== "'");
}

function toggleCommandExpressionQuote(
  state: CommandExpressionParserState,
  char: string,
): void {
  const quote = char === "'" ? "'" : "\"";
  state.tokenStarted = true;
  state.quote = state.quote === quote ? null : quote;
}

function isCommandExpressionEscapeStart(
  char: string,
  quote: "'" | "\"" | null,
): boolean {
  return char === "\\" && quote !== "'";
}

function appendCommandExpressionEscape(
  command: string,
  index: number,
  state: CommandExpressionParserState,
): number {
  const escaped = command[index + 1];
  if (!escaped) {
    throw new NexusAutomationCommandExecutorError(
      "command must not end with a trailing escape",
    );
  }

  if (shouldEscapeCommandCharacter(escaped, state.quote)) {
    appendCommandExpressionCharacter(state, escaped);
    return index + 1;
  }

  appendCommandExpressionCharacter(state, "\\");
  return index;
}

function appendCommandExpressionCharacter(
  state: CommandExpressionParserState,
  char: string,
): void {
  state.current += char;
  state.tokenStarted = true;
}

function flushCommandExpressionToken(
  state: CommandExpressionParserState,
): void {
  if (!state.tokenStarted) {
    return;
  }

  state.words.push(state.current);
  state.current = "";
  state.tokenStarted = false;
}

function finishCommandExpressionParse(
  state: CommandExpressionParserState,
): string[] {
  if (state.quote) {
    throw new NexusAutomationCommandExecutorError(
      "command contains an unterminated quoted argument",
    );
  }

  flushCommandExpressionToken(state);
  return state.words;
}

function resolveCommandSpawnTarget(
  commandSpec: NexusAutomationCommandSpec,
  env: NodeJS.ProcessEnv,
): NexusAutomationCommandSpec {
  if (process.platform !== "win32") {
    return commandSpec;
  }

  const executable = resolveWindowsCommandExecutable(commandSpec.command, env);
  if (!isWindowsCommandScript(executable)) {
    return {
      ...commandSpec,
      command: executable,
    };
  }

  return {
    ...commandSpec,
    command: windowsCommandShell(env),
    args: ["/d", "/s", "/c", executable, ...commandSpec.args],
  };
}

function resolveWindowsCommandExecutable(
  command: string,
  env: NodeJS.ProcessEnv,
): string {
  if (path.isAbsolute(command) || isPathQualifiedCommand(command)) {
    return command;
  }

  try {
    return resolveNexusCommandPath(command, env);
  } catch {
    return command;
  }
}

function isPathQualifiedCommand(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function isWindowsCommandScript(command: string): boolean {
  const extension = path.extname(command).toLowerCase();
  return extension === ".bat" || extension === ".cmd";
}

function windowsCommandShell(env: NodeJS.ProcessEnv): string {
  return caseInsensitiveEnvValue(env, "COMSPEC") ?? "cmd.exe";
}

function caseInsensitiveEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const match = Object.entries(env).find(
    ([envKey]) => envKey.toLowerCase() === key.toLowerCase(),
  );

  return match?.[1];
}

function isUnsupportedShellControlCharacter(char: string): boolean {
  return char === "&" ||
    char === "|" ||
    char === ";" ||
    char === "<" ||
    char === ">" ||
    char === "(" ||
    char === ")";
}

function shouldEscapeCommandCharacter(
  escaped: string,
  quote: "'" | "\"" | null,
): boolean {
  if (quote === "\"") {
    return escaped === "\"" || escaped === "\\";
  }

  return /\s/u.test(escaped) ||
    escaped === "'" ||
    escaped === "\"" ||
    escaped === "\\";
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
    ...nonInteractiveGitEnvironment(baseEnv),
    ...executorPublicationGuardrailEnvironment(baseEnv, input),
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

function executorPublicationGuardrailEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  input: NexusAutomationExecutorInput,
): Record<string, string> {
  const guardrail = input.setup.guardrails?.find(
    (candidate) =>
      candidate.id === nexusPublicationCommandGuardrailId &&
      candidate.status === "materialized",
  );
  if (!guardrail) {
    return {};
  }

  return publicationGuardrailEnvironment(guardrail.binDirectoryPath, baseEnv);
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
    type: publication.strategy === "green_main"
      ? "review_handoff"
      : publication.strategy,
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

function readCommandOutputPreviews(
  commandSpec: NexusAutomationCommandSpec,
  capture: ReturnType<typeof createCommandCaptureFiles>,
  options: NexusAutomationCommandRunOptions,
): {
  stdout: string;
  stderr: string;
  outputFiltering?: NexusAutomationCommandOutputFiltering;
} {
  const rawOutputPaths = preserveRawCommandOutput(
    capture,
    options.cwd,
    options.outputFilter,
  );
  const stdout = filterNexusSubprocessOutput({
    command: {
      display: commandSpec.display,
      executable: commandSpec.command,
    },
    cwd: options.cwd,
    env: options.env,
    inputPath: capture.stdoutPath,
    rawOutputPath: rawOutputPaths.stdoutPath,
    stream: "stdout",
    timeoutMs: options.timeoutMs,
    policy: options.outputFilter,
    readRawOutput: () => readOutputPreview(capture.stdoutPath),
  });
  const stderr = filterNexusSubprocessOutput({
    command: {
      display: commandSpec.display,
      executable: commandSpec.command,
    },
    cwd: options.cwd,
    env: options.env,
    inputPath: capture.stderrPath,
    rawOutputPath: rawOutputPaths.stderrPath,
    stream: "stderr",
    timeoutMs: options.timeoutMs,
    policy: options.outputFilter,
    readRawOutput: () => readOutputPreview(capture.stderrPath),
  });

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    ...(options.outputFilter
      ? {
          outputFiltering: {
            stdout: stdout.record,
            stderr: stderr.record,
          },
        }
      : {}),
  };
}

function preserveRawCommandOutput(
  capture: ReturnType<typeof createCommandCaptureFiles>,
  cwd: string,
  outputFilter?: NexusSubprocessOutputFilterPolicy,
): { stdoutPath?: string; stderrPath?: string } {
  const directory = outputFilter?.preserveRawOutputDirectory;
  if (!directory) {
    return {};
  }

  const artifactRoot = path.resolve(cwd, directory);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactDirectory = fs.mkdtempSync(
    path.join(artifactRoot, "command-output-"),
  );
  const stdoutPath = path.join(artifactDirectory, "stdout.log");
  const stderrPath = path.join(artifactDirectory, "stderr.log");
  fs.copyFileSync(capture.stdoutPath, stdoutPath);
  fs.copyFileSync(capture.stderrPath, stderrPath);
  return { stdoutPath, stderrPath };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
