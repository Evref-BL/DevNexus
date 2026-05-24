import path from "node:path";
import { shellQuoteArgument } from "../automation/nexusAutomationAgentProfile.js";
import {
  defaultNexusAutomationGreenMainConfig,
  type NexusAutomationGreenMainConfig,
  type NexusAutomationPublicationConfig,
} from "../automation/nexusAutomationConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  buildNexusForgePublicationOperationPlan,
  type NexusForgePublicationCapability,
  type NexusForgePublicationOperationArgument,
  type NexusForgePublicationOperationPlan,
  type NexusForgeRepositoryRef,
} from "./nexusForgePublication.js";
import {
  nexusForgeRepositoryFromGitHubRepository,
  resolveNexusGitHubRepository,
  selectNexusGitHubPrimaryTracker,
} from "./nexusForgeRepositoryResolver.js";
import { resolveNexusPublicationPolicy } from "./nexusPublicationPolicy.js";

export type NexusGreenMainPublicationPlanStatus =
  | "green"
  | "pending"
  | "failed"
  | "stale"
  | "unknown";

export type NexusGreenMainRequiredCheckStatus =
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unknown";

export type NexusGreenMainFailureClassification =
  | "classified_failure"
  | "manual_investigation_required";

export type NexusGreenMainRerunDecision =
  | "not_needed"
  | "rerun_once"
  | "blocked_policy"
  | "blocked_reason_required"
  | "blocked_already_attempted"
  | "blocked_missing_run_id";

export interface NexusGreenMainCheckFailureInput {
  step?: string | null;
  test?: string | null;
  message?: string | null;
}

export interface NexusGreenMainCheckOutputInput {
  title?: string | null;
  summary?: string | null;
  text?: string | null;
}

export interface NexusGreenMainCheckAnnotationInput {
  path?: string | null;
  title?: string | null;
  message?: string | null;
  annotationLevel?: string | null;
}

export interface NexusGreenMainCheckRunInput {
  name: string;
  status?: string | null;
  state?: string | null;
  bucket?: string | null;
  conclusion?: string | null;
  workflow?: string | null;
  url?: string | null;
  link?: string | null;
  detailsUrl?: string | null;
  runId?: string | number | null;
  workflowRunId?: string | number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  stale?: boolean | null;
  failure?: NexusGreenMainCheckFailureInput | null;
  output?: NexusGreenMainCheckOutputInput | null;
  annotations?: NexusGreenMainCheckAnnotationInput[] | null;
}

export interface NexusGreenMainRerunPolicyInput {
  allowed?: boolean;
  alreadyAttempted?: boolean;
  reason?: string | null;
}

export interface NexusGreenMainPublicationPlanOptions {
  projectRoot: string;
  componentId?: string;
  prNumber: number;
  prUrl?: string | null;
  headBranch?: string | null;
  checks: NexusGreenMainCheckRunInput[];
  rerunPolicy?: NexusGreenMainRerunPolicyInput;
}

export interface NexusGreenMainRequiredCheck {
  name: string;
  status: NexusGreenMainRequiredCheckStatus;
  sourceState: string | null;
  sourceConclusion: string | null;
  url: string | null;
  message: string;
}

export interface NexusGreenMainFailedJob {
  name: string;
  platform: string | null;
  workflow: string | null;
  url: string | null;
  runId: string | null;
  failingStep: string | null;
  failingTest: string | null;
  message: string | null;
  classification: NexusGreenMainFailureClassification;
}

export interface NexusGreenMainCommandStep {
  id: string;
  title: string;
  enabled: boolean;
  command: string | null;
  operation?: NexusForgePublicationOperationPlan | null;
  environment: Record<string, string>;
  note: string | null;
}

export interface NexusGreenMainMergeDecision {
  allowed: boolean;
  reason: string;
  blockers: string[];
}

export interface NexusGreenMainRerunPlan {
  decision: NexusGreenMainRerunDecision;
  reason: string | null;
  command: string | null;
}

export interface NexusGreenMainPublicationPlan {
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  component: {
    id: string;
    name: string;
    sourceRoot: string;
  };
  pullRequest: {
    repository: string;
    number: number;
    url: string;
    headBranch: string | null;
    targetBranch: string;
  };
  publication: {
    strategy: NexusAutomationPublicationConfig["strategy"];
    remote: string | null;
    commandEnvironment: Record<string, string>;
    requiredChecks: string[];
    staleChecks: NexusAutomationGreenMainConfig["staleChecks"];
    mergeAuthority: NexusAutomationGreenMainConfig["mergeAuthority"];
  };
  status: NexusGreenMainPublicationPlanStatus;
  requiredChecks: NexusGreenMainRequiredCheck[];
  failedJobs: NexusGreenMainFailedJob[];
  merge: NexusGreenMainMergeDecision;
  rerun: NexusGreenMainRerunPlan;
  commands: {
    openOrUpdatePullRequest: NexusGreenMainCommandStep;
    waitRequiredChecks: NexusGreenMainCommandStep;
    rerunFailedRun: NexusGreenMainCommandStep;
    merge: NexusGreenMainCommandStep;
    syncLocalMain: NexusGreenMainCommandStep;
  };
  warnings: string[];
}

export function buildNexusGreenMainPublicationPlan(
  options: NexusGreenMainPublicationPlanOptions,
): NexusGreenMainPublicationPlan {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const component = resolveGreenMainComponent(
    projectRoot,
    projectConfig,
    options.componentId,
  );
  const tracker = selectNexusGitHubPrimaryTracker(
    component,
    "green-main publication",
  );
  const repository = resolveNexusGitHubRepository(
    tracker,
    "green-main publication",
  );
  const repoArg = `${repository.owner}/${repository.name}`;
  const forgeRepository = nexusForgeRepositoryFromGitHubRepository(repository);
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const greenMain = {
    ...defaultNexusAutomationGreenMainConfig,
    ...(publication.greenMain ?? {}),
  };
  const targetBranch =
    publication.targetBranch ?? component.defaultBranch ?? "main";
  const requiredChecks = greenMain.requiredChecks;
  const evaluatedChecks = requiredChecks.map((name) =>
    evaluateRequiredCheck(name, options.checks),
  );
  const status = summarizeCheckStatus(evaluatedChecks, requiredChecks);
  const failedJobs = options.checks
    .filter((check) => checkStatus(check) === "failed")
    .map((check) => failedJob(check));
  const merge = mergeDecision({
    publication,
    greenMain,
    status,
    requiredChecks,
    evaluatedChecks,
  });
  const rerun = rerunPlan({
    failedJobs,
    status,
    policy: options.rerunPolicy,
    repoArg,
  });
  const prUrl =
    options.prUrl?.trim() ||
    `https://github.com/${repoArg}/pull/${String(options.prNumber)}`;
  const commandEnvironment = { ...publication.commandEnvironment };
  const commands = commandSteps({
    repoArg,
    repository: forgeRepository,
    prNumber: options.prNumber,
    headBranch: options.headBranch ?? null,
    targetBranch,
    publication,
    merge,
    rerun,
    commandEnvironment,
  });

  return {
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    component: {
      id: component.id,
      name: component.name,
      sourceRoot: component.sourceRoot,
    },
    pullRequest: {
      repository: repoArg,
      number: options.prNumber,
      url: prUrl,
      headBranch: options.headBranch ?? null,
      targetBranch,
    },
    publication: {
      strategy: publication.strategy,
      remote: publication.remote ?? null,
      commandEnvironment,
      requiredChecks: [...requiredChecks],
      staleChecks: greenMain.staleChecks,
      mergeAuthority: greenMain.mergeAuthority,
    },
    status,
    requiredChecks: evaluatedChecks,
    failedJobs,
    merge,
    rerun,
    commands,
    warnings: warnings(publication, greenMain),
  };
}

function resolveGreenMainComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string | undefined,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (!componentId) {
    return components[0] ?? missingComponent(componentId);
  }

  return (
    components.find((component) => component.id === componentId) ??
    missingComponent(componentId)
  );
}

function missingComponent(componentId: string | undefined): never {
  throw new Error(`Component ${componentId ?? "<default>"} was not found.`);
}

function evaluateRequiredCheck(
  name: string,
  checks: NexusGreenMainCheckRunInput[],
): NexusGreenMainRequiredCheck {
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) {
    return {
      name,
      status: "missing",
      sourceState: null,
      sourceConclusion: null,
      url: null,
      message: "Required check is missing from provider data.",
    };
  }

  const status = checkStatus(check);
  return {
    name,
    status,
    sourceState: check.state ?? check.status ?? check.bucket ?? null,
    sourceConclusion: check.conclusion ?? null,
    url: checkUrl(check),
    message: requiredCheckMessage(status),
  };
}

function checkStatus(
  check: NexusGreenMainCheckRunInput,
): NexusGreenMainRequiredCheckStatus {
  if (check.stale || normalized(check.status) === "stale") {
    return "stale";
  }

  const tokens = [
    normalized(check.bucket),
    normalized(check.conclusion),
    normalized(check.state),
    normalized(check.status),
  ];
  if (tokens.some((token) => token === "pass" || token === "success")) {
    return "success";
  }
  if (
    tokens.some((token) =>
      [
        "fail",
        "failure",
        "failed",
        "cancel",
        "cancelled",
        "canceled",
        "timed_out",
        "action_required",
        "startup_failure",
      ].includes(token),
    )
  ) {
    return "failed";
  }
  if (
    tokens.some((token) =>
      [
        "pending",
        "queued",
        "in_progress",
        "waiting",
        "requested",
        "expected",
      ].includes(token),
    )
  ) {
    return "pending";
  }
  if (tokens.some((token) => token === "stale")) {
    return "stale";
  }

  return "unknown";
}

function summarizeCheckStatus(
  checks: NexusGreenMainRequiredCheck[],
  requiredChecks: string[],
): NexusGreenMainPublicationPlanStatus {
  if (requiredChecks.length === 0 || checks.some((check) => check.status === "missing")) {
    return "unknown";
  }
  if (checks.some((check) => check.status === "failed")) {
    return "failed";
  }
  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }
  if (checks.some((check) => check.status === "stale")) {
    return "stale";
  }
  if (checks.every((check) => check.status === "success")) {
    return "green";
  }

  return "unknown";
}

function mergeDecision(options: {
  publication: NexusAutomationPublicationConfig;
  greenMain: NexusAutomationGreenMainConfig;
  status: NexusGreenMainPublicationPlanStatus;
  requiredChecks: string[];
  evaluatedChecks: NexusGreenMainRequiredCheck[];
}): NexusGreenMainMergeDecision {
  const blockers: string[] = [];
  if (options.publication.strategy !== "green_main") {
    blockers.push(`publication strategy is ${options.publication.strategy}, not green_main`);
  }
  if (options.requiredChecks.length === 0) {
    blockers.push("no required checks are configured");
  }
  if (options.evaluatedChecks.some((check) => check.status === "missing")) {
    blockers.push("one or more required checks are missing from provider data");
  }
  if (options.status === "failed") {
    blockers.push("required checks failed");
  }
  if (options.status === "pending") {
    blockers.push("required checks are pending");
  }
  if (options.status === "unknown") {
    blockers.push("required check state is unknown");
  }
  if (options.status === "stale" && options.greenMain.staleChecks === "block") {
    blockers.push("required checks are stale and staleChecks=block");
  }
  if (options.greenMain.mergeAuthority !== "authorized_merge") {
    blockers.push(
      `green-main mergeAuthority is ${options.greenMain.mergeAuthority}, not authorized_merge`,
    );
  }
  if (!options.publication.remote) {
    blockers.push("publication policy does not configure an automation remote");
  }

  const allowed = blockers.length === 0;
  return {
    allowed,
    blockers,
    reason: allowed
      ? "Required checks are green and policy authorizes merge."
      : blockers.join("; "),
  };
}

function rerunPlan(options: {
  failedJobs: NexusGreenMainFailedJob[];
  status: NexusGreenMainPublicationPlanStatus;
  policy: NexusGreenMainRerunPolicyInput | undefined;
  repoArg: string;
}): NexusGreenMainRerunPlan {
  if (options.status !== "failed" || options.failedJobs.length === 0) {
    return {
      decision: "not_needed",
      reason: "No failed required jobs need rerun.",
      command: null,
    };
  }

  if (!options.policy?.allowed) {
    return {
      decision: "blocked_policy",
      reason: "Automatic rerun is disabled unless policy input explicitly allows one rerun.",
      command: null,
    };
  }
  if (options.policy.alreadyAttempted) {
    return {
      decision: "blocked_already_attempted",
      reason: "The configured one rerun has already been attempted.",
      command: null,
    };
  }
  const reason = options.policy.reason?.trim();
  if (!reason) {
    return {
      decision: "blocked_reason_required",
      reason: "A rerun reason is required before rerunning failed checks.",
      command: null,
    };
  }
  const runId = options.failedJobs.find((job) => job.runId)?.runId ?? null;
  if (!runId) {
    return {
      decision: "blocked_missing_run_id",
      reason: "Failed check data does not include a GitHub Actions run id.",
      command: null,
    };
  }

  return {
    decision: "rerun_once",
    reason,
    command: greenMainCommand([
      "gh",
      "run",
      "rerun",
      runId,
      "--repo",
      options.repoArg,
      "--failed",
    ]),
  };
}

function commandSteps(options: {
  repoArg: string;
  repository: NexusForgeRepositoryRef;
  prNumber: number;
  headBranch: string | null;
  targetBranch: string;
  publication: NexusAutomationPublicationConfig;
  merge: NexusGreenMainMergeDecision;
  rerun: NexusGreenMainRerunPlan;
  commandEnvironment: Record<string, string>;
}): NexusGreenMainPublicationPlan["commands"] {
  const prRef = String(options.prNumber);
  const openOrUpdate = options.prNumber
    ? greenMainForgeOperation({
        repository: options.repository,
        capability: "pull_request.upsert",
        args: {
          number: options.prNumber,
          bodyFile: "<body-file>",
        },
        cliArgs: [
          "pr",
          "edit",
          prRef,
          "--repo",
          options.repoArg,
          "--body-file",
          "<body-file>",
        ],
      })
    : options.headBranch
      ? greenMainForgeOperation({
          repository: options.repository,
          capability: "pull_request.upsert",
          args: {
            head: options.headBranch,
            base: options.targetBranch,
            title: "<title>",
            bodyFile: "<body-file>",
          },
          cliArgs: [
            "pr",
            "create",
            "--repo",
            options.repoArg,
            "--head",
            options.headBranch,
            "--base",
            options.targetBranch,
            "--title",
            "<title>",
            "--body-file",
            "<body-file>",
          ],
        })
      : null;
  const waitRequiredChecks = greenMainForgeOperation({
    repository: options.repository,
    capability: "pull_request.checks",
    args: {
      number: options.prNumber,
      required: true,
      watch: true,
    },
    cliArgs: [
      "pr",
      "checks",
      prRef,
      "--repo",
      options.repoArg,
      "--required",
      "--watch",
    ],
  });
  const merge = options.merge.allowed
    ? greenMainForgeOperation({
        repository: options.repository,
        capability: "pull_request.merge",
        args: {
          number: options.prNumber,
          method: "merge",
          deleteBranch: true,
        },
        cliArgs: [
          "pr",
          "merge",
          prRef,
          "--repo",
          options.repoArg,
          "--merge",
          "--delete-branch",
        ],
      })
    : null;

  return {
    openOrUpdatePullRequest: {
      id: "open-or-update-pr",
      title: "Open or update pull request",
      enabled: openOrUpdate !== null,
      command: openOrUpdate?.command ?? null,
      operation: openOrUpdate,
      environment: options.commandEnvironment,
      note: "Use the configured automation identity for provider writes.",
    },
    waitRequiredChecks: {
      id: "wait-required-checks",
      title: "Wait for required checks",
      enabled: true,
      command: waitRequiredChecks.command,
      operation: waitRequiredChecks,
      environment: options.commandEnvironment,
      note: "Read-only check watch; exit code 8 means checks are still pending.",
    },
    rerunFailedRun: {
      id: "rerun-failed-run",
      title: "Rerun failed GitHub Actions run",
      enabled: options.rerun.decision === "rerun_once" && options.rerun.command !== null,
      command: options.rerun.command,
      operation: null,
      environment: options.commandEnvironment,
      note: options.rerun.reason,
    },
    merge: {
      id: "merge-pr",
      title: "Merge pull request",
      enabled: options.merge.allowed,
      command: merge?.command ?? null,
      operation: merge,
      environment: options.commandEnvironment,
      note: options.merge.reason,
    },
    syncLocalMain: {
      id: "sync-local-main",
      title: "Sync local target branch",
      enabled: options.merge.allowed,
      command: options.merge.allowed
        ? greenMainCommand([
            "git",
            "pull",
            "--ff-only",
            options.publication.remote ?? "origin",
            options.targetBranch,
          ])
        : null,
      operation: null,
      environment: {},
      note: options.merge.allowed
        ? "Run from the component source checkout after provider merge."
        : options.merge.reason,
    },
  };
}

function greenMainForgeOperation(options: {
  repository: NexusForgeRepositoryRef;
  capability: NexusForgePublicationCapability;
  args: Record<string, NexusForgePublicationOperationArgument>;
  cliArgs: string[];
}): NexusForgePublicationOperationPlan {
  return buildNexusForgePublicationOperationPlan({
    repository: options.repository,
    capability: options.capability,
    backendPreference: "auto",
    arguments: options.args,
    cliArgs: options.cliArgs,
  });
}

function failedJob(check: NexusGreenMainCheckRunInput): NexusGreenMainFailedJob {
  const annotation = check.annotations?.[0] ?? null;
  const failingStep =
    clean(check.failure?.step) ??
    clean(check.output?.title) ??
    clean(annotation?.title);
  const failingTest = clean(check.failure?.test);
  const message =
    clean(check.failure?.message) ??
    clean(check.output?.summary) ??
    clean(check.output?.text) ??
    clean(annotation?.message);
  const classification: NexusGreenMainFailureClassification =
    failingStep || failingTest || message
      ? "classified_failure"
      : "manual_investigation_required";

  return {
    name: check.name,
    platform: platformFromCheckName(check.name),
    workflow: clean(check.workflow),
    url: checkUrl(check),
    runId: runId(check),
    failingStep,
    failingTest,
    message,
    classification,
  };
}

function platformFromCheckName(name: string): string | null {
  const match = /\(([^()]+)\)\s*$/.exec(name);
  return match?.[1] ?? null;
}

function checkUrl(check: NexusGreenMainCheckRunInput): string | null {
  return clean(check.detailsUrl) ?? clean(check.link) ?? clean(check.url);
}

function runId(check: NexusGreenMainCheckRunInput): string | null {
  const explicit = check.workflowRunId ?? check.runId;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return String(explicit).trim();
  }
  const url = checkUrl(check);
  const match = url ? /\/actions\/runs\/([0-9]+)/.exec(url) : null;
  return match?.[1] ?? null;
}

function requiredCheckMessage(status: NexusGreenMainRequiredCheckStatus): string {
  switch (status) {
    case "success":
      return "Required check passed.";
    case "pending":
      return "Required check is pending.";
    case "failed":
      return "Required check failed.";
    case "stale":
      return "Required check is stale.";
    case "missing":
      return "Required check was not present in provider data.";
    case "unknown":
      return "Required check state is unknown.";
  }
}

function warnings(
  publication: NexusAutomationPublicationConfig,
  greenMain: NexusAutomationGreenMainConfig,
): string[] {
  const result: string[] = [];
  if (publication.strategy !== "green_main") {
    result.push("Publication policy is not green_main.");
  }
  if (greenMain.requiredChecks.length === 0) {
    result.push("Green-main policy does not configure required checks.");
  }
  if (greenMain.mergeAuthority !== "authorized_merge") {
    result.push("Green-main policy requires handoff instead of automation merge.");
  }

  return result;
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function greenMainCommand(args: string[]): string {
  return args.map(shellQuoteArgument).join(" ");
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
