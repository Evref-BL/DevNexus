import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type NexusSubprocessOutputFilterTool = "rtk" | "snip";
export type NexusSubprocessOutputStream = "stdout" | "stderr";

export interface NexusSubprocessOutputFilterPolicy {
  enabled: boolean;
  commandExecutables?: string[];
  commandPrefixes?: string[];
  preferTools?: NexusSubprocessOutputFilterTool[];
  preserveRawOutputDirectory?: string;
  toolRunner?: NexusSubprocessOutputFilterToolRunner;
}

export interface NexusSubprocessOutputFilterCommand {
  display: string;
  executable: string;
}

export interface NexusSubprocessOutputFilterToolRequest {
  tool: NexusSubprocessOutputFilterTool;
  args: string[];
  inputPath: string;
  stream: NexusSubprocessOutputStream;
  command: NexusSubprocessOutputFilterCommand;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface NexusSubprocessOutputFilterToolResult {
  status: "filtered" | "unavailable" | "failed";
  output?: string;
  diagnostic?: string;
}

export type NexusSubprocessOutputFilterToolRunner = (
  request: NexusSubprocessOutputFilterToolRequest,
) => NexusSubprocessOutputFilterToolResult;

export interface NexusSubprocessOutputFilterRecord {
  status:
    | "not_requested"
    | "not_selected"
    | "applied"
    | "unavailable"
    | "failed";
  stream: NexusSubprocessOutputStream;
  tool?: NexusSubprocessOutputFilterTool;
  reason?: string;
  rawOutputPath?: string;
}

export interface NexusSubprocessOutputFilterInput {
  command: NexusSubprocessOutputFilterCommand;
  cwd: string;
  env: NodeJS.ProcessEnv;
  inputPath: string;
  rawOutputPath?: string;
  stream: NexusSubprocessOutputStream;
  timeoutMs?: number;
  policy?: NexusSubprocessOutputFilterPolicy;
  readRawOutput: () => string;
}

export interface NexusSubprocessOutputFilterResult {
  text: string;
  record: NexusSubprocessOutputFilterRecord;
}

export function filterNexusSubprocessOutput(
  input: NexusSubprocessOutputFilterInput,
): NexusSubprocessOutputFilterResult {
  const rawRecord = baseFilterRecord(input);
  const policy = input.policy;
  if (!policy?.enabled) {
    return {
      text: input.readRawOutput(),
      record: {
        ...rawRecord,
        status: "not_requested",
      },
    };
  }

  if (isEmptyOutputFile(input.inputPath)) {
    return {
      text: input.readRawOutput(),
      record: {
        ...rawRecord,
        status: "not_selected",
        reason: "stream was empty",
      },
    };
  }

  if (!policyMatchesCommand(policy, input.command)) {
    return {
      text: input.readRawOutput(),
      record: {
        ...rawRecord,
        status: "not_selected",
        reason: "command was not selected by output filter policy",
      },
    };
  }

  const tools = policy.preferTools?.length
    ? policy.preferTools
    : (["rtk", "snip"] as const);
  const toolRunner =
    policy.toolRunner ?? defaultNexusSubprocessOutputFilterToolRunner;
  let fallbackRecord: NexusSubprocessOutputFilterRecord | null = null;

  for (const tool of tools) {
    const result = toolRunner({
      tool,
      args: outputFilterToolArgs(tool, input.inputPath),
      inputPath: input.inputPath,
      stream: input.stream,
      command: input.command,
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs,
    });
    if (result.status === "filtered") {
      return {
        text: result.output ?? "",
        record: {
          ...rawRecord,
          status: "applied",
          tool,
        },
      };
    }

    fallbackRecord = {
      ...rawRecord,
      status: result.status,
      tool,
      reason: result.diagnostic,
    };
  }

  return {
    text: input.readRawOutput(),
    record:
      fallbackRecord ??
      ({
        ...rawRecord,
        status: "unavailable",
        reason: "no output filter tools were configured",
      } satisfies NexusSubprocessOutputFilterRecord),
  };
}

export function defaultNexusSubprocessOutputFilterToolRunner(
  request: NexusSubprocessOutputFilterToolRequest,
): NexusSubprocessOutputFilterToolResult {
  const command = outputFilterToolCommand(request.tool);
  const result = spawnSync(command, request.args, {
    cwd: request.cwd,
    env: request.env,
    encoding: "utf8",
    shell: false,
    timeout: request.timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    return {
      status: isMissingExecutableError(result.error) ? "unavailable" : "failed",
      diagnostic: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      status: "failed",
      diagnostic:
        result.stderr.trim() ||
        result.stdout.trim() ||
        `output filter exited ${result.status ?? "without a status"}`,
    };
  }

  return {
    status: "filtered",
    output: result.stdout,
  };
}

function baseFilterRecord(
  input: NexusSubprocessOutputFilterInput,
): Omit<NexusSubprocessOutputFilterRecord, "status"> {
  return {
    stream: input.stream,
    ...(input.rawOutputPath ? { rawOutputPath: input.rawOutputPath } : {}),
  };
}

function policyMatchesCommand(
  policy: NexusSubprocessOutputFilterPolicy,
  command: NexusSubprocessOutputFilterCommand,
): boolean {
  const executableSelectors = policy.commandExecutables ?? [];
  const prefixSelectors = policy.commandPrefixes ?? [];
  if (executableSelectors.length === 0 && prefixSelectors.length === 0) {
    return false;
  }

  return (
    executableSelectors.some((selector) =>
      commandExecutableMatches(selector, command.executable),
    ) ||
    prefixSelectors.some((selector) =>
      command.display === selector || command.display.startsWith(`${selector} `),
    )
  );
}

function commandExecutableMatches(selector: string, executable: string): boolean {
  if (selector === "*") {
    return true;
  }

  const executableBase = path.basename(executable).toLowerCase();
  return (
    selector === executable ||
    selector.toLowerCase() === executableBase ||
    path.basename(selector).toLowerCase() === executableBase
  );
}

function outputFilterToolCommand(tool: NexusSubprocessOutputFilterTool): string {
  return tool;
}

function outputFilterToolArgs(
  tool: NexusSubprocessOutputFilterTool,
  inputPath: string,
): string[] {
  return tool === "rtk" ? ["log", inputPath] : [inputPath];
}

function isMissingExecutableError(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function isEmptyOutputFile(filePath: string): boolean {
  return fs.statSync(filePath).size === 0;
}
