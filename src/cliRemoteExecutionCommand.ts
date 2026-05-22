import path from "node:path";
import process from "node:process";
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";
import {
  createNexusRemoteExecutionRequest,
  getNexusRemoteExecutionRecord,
  recordNexusRemoteExecutionResult,
  type NexusRemoteExecutionAttachmentRef,
  type NexusRemoteExecutionCleanupStatus,
  type NexusRemoteExecutionRequestRecord,
  type NexusRemoteExecutionRequestStatus,
  type NexusRemoteExecutionResultRecord,
  type NexusRemoteExecutionVerificationOutcome,
} from "./nexusRemoteExecution.js";
import {
  planNexusSshExecution,
  type NexusSshExecutionPlan,
} from "./nexusSshExecutionPlan.js";
import type { NexusRunnerMutationClass } from "./nexusRunnerProfile.js";

export interface ParsedRemoteExecutionRequestCreateCommand {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  requestingHostId: string;
  requestingAgentId?: string | null;
  targetHostId?: string | null;
  requiredCapabilities: string[];
  runnerProfileId: string;
  repository: string;
  ref: string;
  commandProfileId: string;
  timeoutMs: number;
  expectedArtifacts: string[];
  mutationClass: NexusRunnerMutationClass;
  initialStatus?: NexusRemoteExecutionRequestStatus;
  coordinationRecordIds: string[];
  json?: boolean;
}

interface ParsedRemoteExecutionResultRecordCommand {
  projectRoot: string;
  requestId: string;
  status: NexusRemoteExecutionRequestStatus;
  hostId: string;
  runnerProfileId: string;
  actualRef?: string | null;
  actualCommit?: string | null;
  commands: string[];
  exitCode?: number | null;
  verificationOutcome: NexusRemoteExecutionVerificationOutcome;
  outputTail?: string | null;
  artifactRefs: string[];
  cleanupStatus: NexusRemoteExecutionCleanupStatus;
  blockerSafetyReason?: string | null;
  json?: boolean;
}

interface ParsedRemoteExecutionResultGetCommand {
  projectRoot: string;
  requestId: string;
  json?: boolean;
}

interface ParsedRemoteExecutionSshPlanCommand {
  projectRoot: string;
  requestId: string;
  homePath?: string;
  json?: boolean;
}

export interface RemoteExecutionMutationGuardOptions {
  projectRoot: string;
  command: string;
  mutationClass: "coordination_record";
  componentId?: string;
}

interface RemoteExecutionCliDependencies {
  stdout?: TextWriter;
  now?: () => Date | string;
  assertMutationAllowed: (options: RemoteExecutionMutationGuardOptions) => void;
  coordinationAttachmentRefs: (
    parsed: ParsedRemoteExecutionRequestCreateCommand,
  ) => NexusRemoteExecutionAttachmentRef[];
}

export async function handleRemoteExecutionCommand(
  argv: string[],
  dependencies: RemoteExecutionCliDependencies,
): Promise<number> {
  const scope = argv[1];
  const command = argv[2];
  const stdout = dependencies.stdout ?? process.stdout;

  if (scope === "request" && command === "create") {
    const parsed = parseRemoteExecutionRequestCreateCommand(argv);
    dependencies.assertMutationAllowed({
      projectRoot: path.resolve(parsed.projectRoot),
      command: "remote-execution request create",
      mutationClass: "coordination_record",
      componentId: parsed.componentId,
    });
    const request = createNexusRemoteExecutionRequest({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      requestingHostId: parsed.requestingHostId,
      requestingAgentId: parsed.requestingAgentId,
      targetHostId: parsed.targetHostId,
      requiredCapabilities: parsed.requiredCapabilities,
      runnerProfileId: parsed.runnerProfileId,
      repository: parsed.repository,
      ref: parsed.ref,
      commandProfileId: parsed.commandProfileId,
      timeoutMs: parsed.timeoutMs,
      expectedArtifacts: parsed.expectedArtifacts,
      mutationClass: parsed.mutationClass,
      initialStatus: parsed.initialStatus,
      attachmentRefs: dependencies.coordinationAttachmentRefs(parsed),
      now: dependencies.now,
    });
    printRemoteExecutionRequestCreateResult(request, parsed, stdout);
    return 0;
  }

  if (scope === "result" && command === "record") {
    const parsed = parseRemoteExecutionResultRecordCommand(argv);
    dependencies.assertMutationAllowed({
      projectRoot: path.resolve(parsed.projectRoot),
      command: "remote-execution result record",
      mutationClass: "coordination_record",
    });
    const result = recordNexusRemoteExecutionResult({
      projectRoot: parsed.projectRoot,
      requestId: parsed.requestId,
      status: parsed.status,
      hostId: parsed.hostId,
      runnerProfileId: parsed.runnerProfileId,
      actualRef: parsed.actualRef,
      actualCommit: parsed.actualCommit,
      commands: parsed.commands,
      exitCode: parsed.exitCode,
      verificationOutcome: parsed.verificationOutcome,
      outputTail: parsed.outputTail,
      artifactRefs: parsed.artifactRefs,
      cleanupStatus: parsed.cleanupStatus,
      blockerSafetyReason: parsed.blockerSafetyReason,
      now: dependencies.now,
    });
    printRemoteExecutionResultRecordResult(result, parsed, stdout);
    return 0;
  }

  if (scope === "result" && command === "get") {
    const parsed = parseRemoteExecutionResultGetCommand(argv);
    const record = getNexusRemoteExecutionRecord({
      projectRoot: parsed.projectRoot,
      requestId: parsed.requestId,
    });
    printRemoteExecutionResultGetResult(record, parsed, stdout);
    return 0;
  }

  if (scope === "ssh-plan") {
    const parsed = parseRemoteExecutionSshPlanCommand(argv);
    const plan = planNexusSshExecution({
      projectRoot: parsed.projectRoot,
      requestId: parsed.requestId,
      homePath: parsed.homePath,
    });
    printRemoteExecutionSshPlanResult(plan, parsed, stdout);
    return 0;
  }

  throw new Error(
    "remote-execution requires request create, result record, result get, or ssh-plan",
  );
}

function parseRemoteExecutionRequestCreateCommand(
  argv: string[],
): ParsedRemoteExecutionRequestCreateCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("remote-execution request create requires a workspace root");
  }

  const parsed: Partial<ParsedRemoteExecutionRequestCreateCommand> = {
    projectRoot,
    requiredCapabilities: [],
    expectedArtifacts: [],
    coordinationRecordIds: [],
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
      case "--requesting-host":
        parsed.requestingHostId = next();
        break;
      case "--requesting-agent":
        parsed.requestingAgentId = next();
        break;
      case "--target-host":
        parsed.targetHostId = next();
        break;
      case "--capability":
        parsed.requiredCapabilities?.push(next());
        break;
      case "--runner-profile":
        parsed.runnerProfileId = next();
        break;
      case "--repository":
        parsed.repository = next();
        break;
      case "--ref":
        parsed.ref = next();
        break;
      case "--command-profile":
        parsed.commandProfileId = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--expected-artifact":
        parsed.expectedArtifacts?.push(next());
        break;
      case "--mutation-class":
        parsed.mutationClass = parseRemoteExecutionMutationClass(next(), arg);
        break;
      case "--status":
        parsed.initialStatus = parseRemoteExecutionRequestStatus(next(), arg);
        break;
      case "--attach-coordination-record":
        parsed.coordinationRecordIds?.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown remote-execution request create option: ${arg}`);
    }
  }

  if (!parsed.requestingHostId) {
    throw new Error("remote-execution request create requires --requesting-host");
  }
  if (!parsed.runnerProfileId) {
    throw new Error("remote-execution request create requires --runner-profile");
  }
  if (!parsed.repository) {
    throw new Error("remote-execution request create requires --repository");
  }
  if (!parsed.ref) {
    throw new Error("remote-execution request create requires --ref");
  }
  if (!parsed.commandProfileId) {
    throw new Error("remote-execution request create requires --command-profile");
  }
  if (!parsed.timeoutMs) {
    throw new Error("remote-execution request create requires --timeout-ms");
  }
  if (!parsed.mutationClass) {
    throw new Error("remote-execution request create requires --mutation-class");
  }

  return parsed as ParsedRemoteExecutionRequestCreateCommand;
}

function parseRemoteExecutionResultRecordCommand(
  argv: string[],
): ParsedRemoteExecutionResultRecordCommand {
  const [, , , projectRoot, requestId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("remote-execution result record requires a workspace root");
  }
  if (!requestId || requestId.startsWith("--")) {
    throw new Error("remote-execution result record requires a request id");
  }

  const parsed: Partial<ParsedRemoteExecutionResultRecordCommand> = {
    projectRoot,
    requestId,
    commands: [],
    artifactRefs: [],
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
        parsed.status = parseRemoteExecutionRequestStatus(next(), arg);
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--runner-profile":
        parsed.runnerProfileId = next();
        break;
      case "--actual-ref":
        parsed.actualRef = next();
        break;
      case "--actual-commit":
        parsed.actualCommit = next();
        break;
      case "--command":
        parsed.commands?.push(next());
        break;
      case "--exit-code":
        parsed.exitCode = parseNonNegativeInteger(next(), arg);
        break;
      case "--verification-outcome":
        parsed.verificationOutcome = parseRemoteExecutionVerificationOutcome(
          next(),
          arg,
        );
        break;
      case "--output-tail":
        parsed.outputTail = next();
        break;
      case "--artifact":
        parsed.artifactRefs?.push(next());
        break;
      case "--cleanup-status":
        parsed.cleanupStatus = parseRemoteExecutionCleanupStatus(next(), arg);
        break;
      case "--blocker-safety-reason":
        parsed.blockerSafetyReason = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown remote-execution result record option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("remote-execution result record requires --status");
  }
  if (!parsed.hostId) {
    throw new Error("remote-execution result record requires --host");
  }
  if (!parsed.runnerProfileId) {
    throw new Error("remote-execution result record requires --runner-profile");
  }
  if (!parsed.verificationOutcome) {
    throw new Error(
      "remote-execution result record requires --verification-outcome",
    );
  }
  if (!parsed.cleanupStatus) {
    throw new Error("remote-execution result record requires --cleanup-status");
  }

  return parsed as ParsedRemoteExecutionResultRecordCommand;
}

function parseRemoteExecutionResultGetCommand(
  argv: string[],
): ParsedRemoteExecutionResultGetCommand {
  const [, , , projectRoot, requestId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("remote-execution result get requires a workspace root");
  }
  if (!requestId || requestId.startsWith("--")) {
    throw new Error("remote-execution result get requires a request id");
  }

  const parsed: ParsedRemoteExecutionResultGetCommand = {
    projectRoot,
    requestId,
  };
  for (const arg of rest) {
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown remote-execution result get option: ${arg}`);
  }

  return parsed;
}

function parseRemoteExecutionSshPlanCommand(
  argv: string[],
): ParsedRemoteExecutionSshPlanCommand {
  const [, , projectRoot, requestId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("remote-execution ssh-plan requires a workspace root");
  }
  if (!requestId || requestId.startsWith("--")) {
    throw new Error("remote-execution ssh-plan requires a request id");
  }

  const parsed: ParsedRemoteExecutionSshPlanCommand = {
    projectRoot,
    requestId,
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
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown remote-execution ssh-plan option: ${arg}`);
    }
  }

  return parsed;
}

function printRemoteExecutionRequestCreateResult(
  request: NexusRemoteExecutionRequestRecord,
  parsed: ParsedRemoteExecutionRequestCreateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, localOnly: true, request };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus remote execution request recorded locally.");
  writeLine(stdout, `  Request: ${request.id}`);
  writeLine(stdout, `  Component: ${request.componentId}`);
  if (request.workItemId) {
    writeLine(stdout, `  Work item: ${request.workItemId}`);
  }
  writeLine(stdout, `  Status: ${request.status}`);
  writeLine(stdout, `  Runner profile: ${request.runnerProfileId}`);
  writeLine(stdout, `  Command profile: ${request.commandProfileId}`);
}

function printRemoteExecutionResultRecordResult(
  result: NexusRemoteExecutionResultRecord,
  parsed: ParsedRemoteExecutionResultRecordCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, localOnly: true, result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus remote execution result recorded locally.");
  writeLine(stdout, `  Request: ${result.requestId}`);
  writeLine(stdout, `  Status: ${result.status}`);
  writeLine(stdout, `  Host: ${result.hostId}`);
  writeLine(stdout, `  Verification: ${result.verificationOutcome}`);
}

function printRemoteExecutionResultGetResult(
  record: ReturnType<typeof getNexusRemoteExecutionRecord>,
  parsed: ParsedRemoteExecutionResultGetCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, localOnly: true, record };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus remote execution record.");
  writeLine(stdout, `  Request: ${record.request.id}`);
  writeLine(stdout, `  Component: ${record.request.componentId}`);
  writeLine(stdout, `  Status: ${record.request.status}`);
  writeLine(
    stdout,
    `  Result: ${record.result ? record.result.verificationOutcome : "none"}`,
  );
}

function printRemoteExecutionSshPlanResult(
  plan: NexusSshExecutionPlan,
  parsed: ParsedRemoteExecutionSshPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, localOnly: true, plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus SSH execution plan: ${plan.status}.`);
  writeLine(stdout, `  Request: ${plan.requestId}`);
  writeLine(stdout, `  Host: ${plan.target.hostId ?? "unresolved"}`);
  writeLine(stdout, `  Command profile: ${plan.command.commandProfileId}`);
  writeLine(
    stdout,
    `  Working directory: ${plan.workingDirectory.sanitizedPath ?? "unresolved"}`,
  );
  for (const blocker of plan.blockers) {
    writeLine(stdout, `  Blocker: ${blocker}`);
  }
}

function parseRemoteExecutionRequestStatus(
  value: string,
  optionName: string,
): NexusRemoteExecutionRequestStatus {
  if (
    value === "queued" ||
    value === "accepted" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "timed_out" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be a valid remote execution status`);
}

function parseRemoteExecutionVerificationOutcome(
  value: string,
  optionName: string,
): NexusRemoteExecutionVerificationOutcome {
  if (
    value === "passed" ||
    value === "failed" ||
    value === "not_run" ||
    value === "blocked" ||
    value === "timed_out" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(
    `${optionName} must be passed, failed, not_run, blocked, timed_out, or cancelled`,
  );
}

function parseRemoteExecutionCleanupStatus(
  value: string,
  optionName: string,
): NexusRemoteExecutionCleanupStatus {
  if (
    value === "not_required" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new Error(
    `${optionName} must be not_required, completed, failed, blocked, or unknown`,
  );
}

function parseRemoteExecutionMutationClass(
  value: string,
  optionName: string,
): NexusRunnerMutationClass {
  if (
    value === "none" ||
    value === "verification" ||
    value === "project_local" ||
    value === "live_runtime" ||
    value === "destructive"
  ) {
    return value;
  }

  throw new Error(
    `${optionName} must be none, verification, project_local, live_runtime, or destructive`,
  );
}
