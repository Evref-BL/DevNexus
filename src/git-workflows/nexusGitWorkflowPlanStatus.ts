import fs from "node:fs";
import {
  defaultNexusAutomationConfig,
  type NexusGitWorkflowProfileConfig,
  type NexusGitWorkflowGate,
} from "../automation/nexusAutomationConfig.js";
import { shellQuoteArgument } from "../automation/nexusAutomationAgentProfile.js";
import { defaultGitRunner, type GitRunner } from "../worktrees/gitWorktreeService.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import { resolveNexusPublicationPolicy } from "../publication/nexusPublicationPolicy.js";
import {
  readNexusGitWorkflowRunStore,
  summarizeNexusGitWorkflowRun,
  type NexusGitWorkflowRunOwner,
  type NexusGitWorkflowRunRecord,
  type NexusGitWorkflowRunSummary,
} from "./nexusGitWorkflowRunState.js";

export type NexusGitWorkflowPlanStatusMode = "plan" | "status";
export type NexusGitWorkflowEvidenceStatus = "present" | "missing" | "warning";

export interface NexusGitWorkflowPlanStatusOptions {
  projectRoot: string;
  componentId?: string | null;
  profileId?: string | null;
  workItemId?: string | null;
  branchName?: string | null;
  runId?: string | null;
  repositoryPath?: string | null;
  gitRunner?: GitRunner;
}

export interface NexusGitWorkflowPlanStatusEvidence {
  id: string;
  status: NexusGitWorkflowEvidenceStatus;
  summary: string;
}

export interface NexusGitWorkflowAllowedCommand {
  id: string;
  command: string;
  summary: string;
  mutates: boolean;
  requiresApproval: boolean;
}

export interface NexusGitWorkflowPlanStatusProfileSummary {
  id: string | null;
  name: string | null;
  source: string | null;
  branchStrategy: string | null;
  activeFeatureId: string | null;
  reviewMode: string | null;
  finalPullRequest: boolean | null;
}

export interface NexusGitWorkflowPlanStatusRefs {
  branchName: string | null;
  currentRef: string | null;
  currentBranch: string | null;
  currentCommit: string | null;
  baseRef: string | null;
  baseCommit: string | null;
  targetBranch: string | null;
}

export interface NexusGitWorkflowPlanStatusResult {
  mode: NexusGitWorkflowPlanStatusMode;
  mutates: false;
  project: {
    id: string;
    name: string;
    root: string;
  };
  component: {
    id: string;
    name: string;
    sourceRoot: string;
  };
  profile: NexusGitWorkflowPlanStatusProfileSummary;
  run: NexusGitWorkflowRunSummary | null;
  refs: NexusGitWorkflowPlanStatusRefs;
  nextOwner: NexusGitWorkflowRunOwner;
  evidence: NexusGitWorkflowPlanStatusEvidence[];
  evidenceGaps: string[];
  blockers: string[];
  humanGates: NexusGitWorkflowGate[];
  allowedNextCommands: NexusGitWorkflowAllowedCommand[];
}

interface NexusGitWorkflowContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  repositoryPath: string;
  publication: ReturnType<typeof resolveNexusPublicationPolicy>;
}

interface GitEvidence {
  currentBranch: string | null;
  currentCommit: string | null;
  baseCommit: string | null;
  evidence: NexusGitWorkflowPlanStatusEvidence[];
  gaps: string[];
  blockers: string[];
}

export function buildNexusGitWorkflowPlan(
  options: NexusGitWorkflowPlanStatusOptions,
): NexusGitWorkflowPlanStatusResult {
  return buildNexusGitWorkflowPlanStatus("plan", options);
}

export function buildNexusGitWorkflowStatus(
  options: NexusGitWorkflowPlanStatusOptions,
): NexusGitWorkflowPlanStatusResult {
  return buildNexusGitWorkflowPlanStatus("status", options);
}

function buildNexusGitWorkflowPlanStatus(
  mode: NexusGitWorkflowPlanStatusMode,
  options: NexusGitWorkflowPlanStatusOptions,
): NexusGitWorkflowPlanStatusResult {
  const context = resolveGitWorkflowContext(options);
  const run = mode === "status" ? selectGitWorkflowRun(context, options) : null;
  const profileSelection = selectGitWorkflowProfile(
    context.projectConfig,
    options.profileId ?? run?.profileId ?? null,
  );
  const profile = profileSelection.profile;
  const targetBranch = resolveTargetBranch(context, profile, run);
  const baseRef = run?.baseRef ?? defaultBaseRef(context, targetBranch);
  const branchName = options.branchName ?? run?.branchName ?? null;
  const gitEvidence = collectGitEvidence({
    repositoryPath: context.repositoryPath,
    baseRef,
    gitRunner: options.gitRunner ?? defaultGitRunner,
  });
  const refs = {
    branchName,
    currentRef:
      run?.currentRef ?? branchName ?? gitEvidence.currentBranch ?? null,
    currentBranch: gitEvidence.currentBranch,
    currentCommit: gitEvidence.currentCommit,
    baseRef,
    baseCommit: run?.baseCommit ?? gitEvidence.baseCommit,
    targetBranch,
  };
  const evidence = [
    profileEvidence(profile),
    ...profileSelection.evidence,
    ...gitEvidence.evidence,
    ...providerEvidence(profile),
  ];
  const evidenceGaps = [
    ...profileSelection.gaps,
    ...gitEvidence.gaps,
    ...providerEvidenceGaps(profile),
  ];
  const blockers = [
    ...profileSelection.blockers,
    ...gitEvidence.blockers,
    ...targetBlockers(targetBranch),
    ...(mode === "status" && !run ? ["No matching Git workflow run was recorded."] : []),
  ];
  const nextOwner = run?.owner ?? { kind: "agent", id: null };

  return {
    mode,
    mutates: false,
    project: {
      id: context.projectConfig.id,
      name: context.projectConfig.name,
      root: context.projectRoot,
    },
    component: {
      id: context.component.id,
      name: context.component.name,
      sourceRoot: context.component.sourceRoot,
    },
    profile: summarizeProfile(profile),
    run: run ? summarizeNexusGitWorkflowRun(run) : null,
    refs,
    nextOwner,
    evidence,
    evidenceGaps,
    blockers,
    humanGates: profile ? uniqueGates([
      ...profile.gates.start,
      ...profile.gates.review,
      ...profile.gates.publication,
      ...profile.gates.cleanup,
    ]) : [],
    allowedNextCommands: allowedNextCommands({
      mode,
      context,
      profile,
      run,
      workItemId: options.workItemId ?? run?.workItemId ?? null,
      branchName,
      baseRef,
    }),
  };
}

function resolveGitWorkflowContext(
  options: NexusGitWorkflowPlanStatusOptions,
): NexusGitWorkflowContext {
  const projectRoot = requiredNonEmptyString(options.projectRoot, "projectRoot");
  const projectConfig = loadProjectConfig(projectRoot);
  const component = options.componentId
    ? resolveProjectComponents(projectRoot, projectConfig).find(
        (candidate) => candidate.id === options.componentId,
      )
    : resolvePrimaryProjectComponent(projectRoot, projectConfig);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${options.componentId}`);
  }
  return {
    projectRoot,
    projectConfig,
    component,
    repositoryPath: options.repositoryPath ?? component.sourceRoot,
    publication: resolveNexusPublicationPolicy(projectConfig, component),
  };
}

function selectGitWorkflowRun(
  context: NexusGitWorkflowContext,
  options: NexusGitWorkflowPlanStatusOptions,
): NexusGitWorkflowRunRecord | null {
  const store = readNexusGitWorkflowRunStore(context.repositoryPath);
  const runId = options.runId ?? null;
  const candidates = store.runs.filter((run) =>
    (runId ? run.id === runId : true) &&
    (run.componentId ? run.componentId === context.component.id : true) &&
    (options.workItemId ? run.workItemId === options.workItemId : true) &&
    (options.branchName ? run.branchName === options.branchName : true)
  );
  return candidates.sort((left, right) =>
    left.updatedAt.localeCompare(right.updatedAt)
  ).at(-1) ?? null;
}

function selectGitWorkflowProfile(
  projectConfig: NexusProjectConfig,
  requestedProfileId: string | null,
): {
  profile: NexusGitWorkflowProfileConfig | null;
  evidence: NexusGitWorkflowPlanStatusEvidence[];
  gaps: string[];
  blockers: string[];
} {
  const automationConfig = projectConfig.automation ?? defaultNexusAutomationConfig;
  const profiles = automationConfig.gitWorkflows.profiles;
  const profileId = requestedProfileId ??
    automationConfig.gitWorkflows.activeProfileId ??
    (profiles.length === 1 ? profiles[0]!.id : null);
  if (!profileId) {
    return {
      profile: null,
      evidence: [],
      gaps: ["No Git workflow profile was selected."],
      blockers: ["Configure automation.gitWorkflows.activeProfileId or pass --profile."],
    };
  }
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  if (!profile) {
    return {
      profile: null,
      evidence: [],
      gaps: [`Git workflow profile ${profileId} was not found.`],
      blockers: [`Git workflow profile ${profileId} is not configured.`],
    };
  }
  return {
    profile,
    evidence: [],
    gaps: [],
    blockers: [],
  };
}

function collectGitEvidence(options: {
  repositoryPath: string;
  baseRef: string | null;
  gitRunner: GitRunner;
}): GitEvidence {
  if (!fs.existsSync(options.repositoryPath)) {
    return {
      currentBranch: null,
      currentCommit: null,
      baseCommit: null,
      evidence: [
        {
          id: "repository",
          status: "missing",
          summary: `Repository path does not exist: ${options.repositoryPath}`,
        },
      ],
      gaps: ["Repository path is missing."],
      blockers: ["Cannot inspect Git facts until the repository path exists."],
    };
  }

  const currentBranch = runGitReadOnly(
    options.gitRunner,
    options.repositoryPath,
    ["rev-parse", "--abbrev-ref", "HEAD"],
  );
  const currentCommit = runGitReadOnly(
    options.gitRunner,
    options.repositoryPath,
    ["rev-parse", "HEAD"],
  );
  const baseCommit = options.baseRef
    ? runGitReadOnly(
        options.gitRunner,
        options.repositoryPath,
        ["rev-parse", "--verify", "--quiet", `${options.baseRef}^{commit}`],
      )
    : null;
  const status = runGitReadOnly(
    options.gitRunner,
    options.repositoryPath,
    ["status", "--short", "--branch"],
  );
  const evidence: NexusGitWorkflowPlanStatusEvidence[] = [
    gitCommandEvidence("current-branch", currentBranch, "current Git branch"),
    gitCommandEvidence("current-commit", currentCommit, "current Git commit"),
    options.baseRef
      ? gitCommandEvidence("base-ref", baseCommit, `base ref ${options.baseRef}`)
      : {
          id: "base-ref",
          status: "missing",
          summary: "No base ref is selected.",
        },
    gitCommandEvidence("working-tree", status, "working tree status"),
  ];
  const gaps = evidence
    .filter((item) => item.status === "missing")
    .map((item) => item.summary);
  const blockers = options.baseRef && !baseCommit
    ? [`Base ref could not be resolved: ${options.baseRef}`]
    : [];

  return {
    currentBranch: currentBranch?.stdout.trim() || null,
    currentCommit: currentCommit?.stdout.trim() || null,
    baseCommit: baseCommit?.stdout.trim() || null,
    evidence,
    gaps,
    blockers,
  };
}

function runGitReadOnly(
  gitRunner: GitRunner,
  repositoryPath: string,
  args: string[],
): ReturnType<GitRunner> | null {
  const result = gitRunner(args, repositoryPath);
  return result.exitCode === 0 ? result : null;
}

function gitCommandEvidence(
  id: string,
  result: ReturnType<GitRunner> | null,
  label: string,
): NexusGitWorkflowPlanStatusEvidence {
  if (!result) {
    return {
      id,
      status: "missing",
      summary: `Could not read ${label}.`,
    };
  }
  return {
    id,
    status: "present",
    summary: `Read ${label}.`,
  };
}

function profileEvidence(
  profile: NexusGitWorkflowProfileConfig | null,
): NexusGitWorkflowPlanStatusEvidence {
  if (!profile) {
    return {
      id: "selected-profile",
      status: "missing",
      summary: "No Git workflow profile is selected.",
    };
  }
  return {
    id: "selected-profile",
    status: "present",
    summary: `Selected Git workflow profile ${profile.id}.`,
  };
}

function providerEvidence(
  profile: NexusGitWorkflowProfileConfig | null,
): NexusGitWorkflowPlanStatusEvidence[] {
  if (!profile || profile.review.mode !== "review_branch_pr") {
    return [];
  }
  return [
    {
      id: "provider-review",
      status: "missing",
      summary:
        "Provider review evidence is not loaded by read-only plan/status without a pull request evidence input.",
    },
  ];
}

function providerEvidenceGaps(
  profile: NexusGitWorkflowProfileConfig | null,
): string[] {
  return profile?.review.mode === "review_branch_pr"
    ? ["Provider review evidence has not been attached."]
    : [];
}

function resolveTargetBranch(
  context: NexusGitWorkflowContext,
  profile: NexusGitWorkflowProfileConfig | null,
  run: NexusGitWorkflowRunRecord | null,
): string | null {
  return run?.targetBranch ??
    profile?.targetBranch ??
    context.publication.targetBranch ??
    context.component.defaultBranch ??
    context.projectConfig.repo.defaultBranch ??
    null;
}

function defaultBaseRef(
  context: NexusGitWorkflowContext,
  targetBranch: string | null,
): string | null {
  if (
    context.publication.strategy !== "local_only" &&
    context.publication.remote &&
    targetBranch
  ) {
    return `${context.publication.remote}/${targetBranch}`;
  }

  return targetBranch;
}

function targetBlockers(targetBranch: string | null): string[] {
  return targetBranch ? [] : ["No target branch could be resolved."];
}

function summarizeProfile(
  profile: NexusGitWorkflowProfileConfig | null,
): NexusGitWorkflowPlanStatusProfileSummary {
  if (!profile) {
    return {
      id: null,
      name: null,
      source: null,
      branchStrategy: null,
      activeFeatureId: null,
      reviewMode: null,
      finalPullRequest: null,
    };
  }
  return {
    id: profile.id,
    name: profile.name,
    source: profile.source,
    branchStrategy: profile.branchStrategy,
    activeFeatureId: profile.activeFeatureId,
    reviewMode: profile.review.mode,
    finalPullRequest: profile.review.finalPullRequest,
  };
}

function allowedNextCommands(options: {
  mode: NexusGitWorkflowPlanStatusMode;
  context: NexusGitWorkflowContext;
  profile: NexusGitWorkflowProfileConfig | null;
  run: NexusGitWorkflowRunRecord | null;
  workItemId: string | null;
  branchName: string | null;
  baseRef: string | null;
}): NexusGitWorkflowAllowedCommand[] {
  const commands: NexusGitWorkflowAllowedCommand[] = [
    {
      id: "refresh-status",
      command: gitWorkflowStatusCommand(options),
      summary: "Refresh the read-only Git workflow status.",
      mutates: false,
      requiresApproval: false,
    },
  ];
  if (options.mode === "plan" && options.profile) {
    commands.push({
      id: "prepare-worktree",
      command: worktreePrepareCommand(options),
      summary:
        "Prepare an isolated worktree from the selected workflow base ref. This creates Git/worktree state.",
      mutates: true,
      requiresApproval: false,
    });
  }
  return commands;
}

function gitWorkflowStatusCommand(options: {
  context: NexusGitWorkflowContext;
  run: NexusGitWorkflowRunRecord | null;
  workItemId: string | null;
  branchName: string | null;
}): string {
  return [
    "dev-nexus",
    "git-workflow",
    "status",
    shellQuoteArgument(options.context.projectRoot),
    "--component",
    shellQuoteArgument(options.context.component.id),
    ...(options.run ? ["--run", shellQuoteArgument(options.run.id)] : []),
    ...(options.workItemId
      ? ["--work-item", shellQuoteArgument(options.workItemId)]
      : []),
    ...(options.branchName ? ["--branch", shellQuoteArgument(options.branchName)] : []),
    "--json",
  ].join(" ");
}

function worktreePrepareCommand(options: {
  context: NexusGitWorkflowContext;
  workItemId: string | null;
  branchName: string | null;
  baseRef: string | null;
}): string {
  return [
    "dev-nexus",
    "worktree",
    "prepare",
    shellQuoteArgument(options.context.projectRoot),
    "--component",
    shellQuoteArgument(options.context.component.id),
    ...(options.workItemId
      ? ["--work-item", shellQuoteArgument(options.workItemId)]
      : []),
    ...(options.branchName ? ["--branch", shellQuoteArgument(options.branchName)] : []),
    ...(options.baseRef ? ["--base-ref", shellQuoteArgument(options.baseRef)] : []),
  ].join(" ");
}

function uniqueGates(gates: NexusGitWorkflowGate[]): NexusGitWorkflowGate[] {
  return [...new Set(gates)];
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}
