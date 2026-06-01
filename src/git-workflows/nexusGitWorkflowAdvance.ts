import {
  defaultNexusAutomationConfig,
  type NexusGitWorkflowGate,
  type NexusGitWorkflowProfileConfig,
  type NexusGitWorkflowUpdateAction,
} from "../automation/nexusAutomationConfig.js";
import { shellQuoteArgument } from "../automation/nexusAutomationAgentProfile.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "../worktrees/gitWorktreeService.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  buildNexusGitWorkflowBranchFreshnessDecision,
  type NexusGitWorkflowBranchFreshnessDecision,
  type NexusGitWorkflowBranchFreshnessGitEvidence,
  type NexusGitWorkflowBranchFreshnessProviderEvidence,
} from "./nexusGitWorkflowBranchFreshness.js";
import {
  readNexusGitWorkflowRunStore,
  summarizeNexusGitWorkflowRun,
  updateNexusGitWorkflowRun,
  type NexusGitWorkflowRunEvidenceInput,
  type NexusGitWorkflowRunNodeInput,
  type NexusGitWorkflowRunOwner,
  type NexusGitWorkflowRunRecord,
  type NexusGitWorkflowRunStatus,
  type NexusGitWorkflowRunSummary,
  type NexusGitWorkflowRunTransitionInput,
} from "./nexusGitWorkflowRunState.js";

export type NexusGitWorkflowProviderReviewStatus =
  | "approved"
  | "changes_requested"
  | "pending"
  | "missing"
  | "unknown";

export type NexusGitWorkflowPublicationEvidenceStatus =
  | "completed"
  | "pending"
  | "missing"
  | "unknown";

export type NexusGitWorkflowAdvanceAction =
  | "advance"
  | "handoff"
  | "block"
  | "complete"
  | "noop";

export type NexusGitWorkflowAdvanceHumanGate =
  | NexusGitWorkflowGate
  | "public_history_rewrite"
  | "blocked_by_policy";

export interface NexusGitWorkflowAdvanceProviderEvidence
  extends NexusGitWorkflowBranchFreshnessProviderEvidence {
  review?: NexusGitWorkflowProviderReviewStatus | null;
  publication?: NexusGitWorkflowPublicationEvidenceStatus | null;
}

export interface NexusGitWorkflowAdvanceAuthority {
  gitMutation?: boolean | null;
  providerWrite?: boolean | null;
  finalPublication?: boolean | null;
  forceWithLease?: boolean | null;
}

export interface AdvanceNexusGitWorkflowRunOptions {
  projectRoot: string;
  componentId?: string | null;
  profileId?: string | null;
  workItemId?: string | null;
  branchName?: string | null;
  runId?: string | null;
  repositoryPath?: string | null;
  provider?: NexusGitWorkflowAdvanceProviderEvidence | null;
  git?: NexusGitWorkflowBranchFreshnessGitEvidence | null;
  authority?: NexusGitWorkflowAdvanceAuthority | null;
  executeBranchUpdate?: boolean | null;
  dryRun?: boolean | null;
  gitRunner?: GitRunner;
  now?: Date | string | (() => Date | string);
}

export interface NexusGitWorkflowAdvanceDecision {
  action: NexusGitWorkflowAdvanceAction;
  status: NexusGitWorkflowRunStatus;
  nextOwner: NexusGitWorkflowRunOwner;
  reasons: string[];
  blockers: string[];
  humanGates: NexusGitWorkflowAdvanceHumanGate[];
  commands: string[];
  providerActions: string[];
}

export type NexusGitWorkflowBranchUpdateExecutionStatus =
  | "planned"
  | "executed"
  | "blocked"
  | "failed"
  | "not_applicable";

export type NexusGitWorkflowBranchUpdateVerificationRequirement =
  | "required_checks"
  | null;

export interface NexusGitWorkflowBranchUpdateForceWithLeaseEvidence {
  required: boolean;
  approved: boolean;
  expectedCommit: string | null;
}

export interface NexusGitWorkflowBranchUpdateExecutionResult {
  requested: boolean;
  dryRun: boolean;
  status: NexusGitWorkflowBranchUpdateExecutionStatus;
  action: NexusGitWorkflowUpdateAction;
  branch: string | null;
  baseRef: string;
  pushRemote: string;
  beforeCommit: string | null;
  baseCommit: string | null;
  afterCommit: string | null;
  expectedRemoteCommit: string | null;
  forceWithLease: NexusGitWorkflowBranchUpdateForceWithLeaseEvidence;
  verificationRequired: NexusGitWorkflowBranchUpdateVerificationRequirement;
  commands: string[];
  blockers: string[];
  summary: string;
  git: {
    commands: GitCommandResult[];
  };
}

export interface NexusGitWorkflowAdvanceResult {
  mutates: boolean;
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
  profile: {
    id: string;
    branchStrategy: string;
  };
  runBefore: NexusGitWorkflowRunSummary;
  runAfter: NexusGitWorkflowRunSummary;
  branchFreshness: NexusGitWorkflowBranchFreshnessDecision | null;
  branchUpdate: NexusGitWorkflowBranchUpdateExecutionResult | null;
  decision: NexusGitWorkflowAdvanceDecision;
}

interface GitWorkflowAdvanceContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  repositoryPath: string;
  profile: NexusGitWorkflowProfileConfig;
  run: NexusGitWorkflowRunRecord;
}

export function advanceNexusGitWorkflowRun(
  options: AdvanceNexusGitWorkflowRunOptions,
): NexusGitWorkflowAdvanceResult {
  const context = resolveAdvanceContext(options);
  const timestamp = isoString(options.now);
  const provider = options.provider ?? {};
  const authority = options.authority ?? {};
  const runBefore = summarizeNexusGitWorkflowRun(context.run);
  const evidence = providerEvidence(provider, timestamp);
  const branchFreshness = branchFreshnessDecision(context, provider, options.git);
  const decision = advanceDecision({
    context,
    provider,
    authority,
    branchFreshness,
  });
  const branchUpdate = options.executeBranchUpdate
    ? executeBranchUpdate({
        branchFreshness,
        authority,
        repositoryPath: context.repositoryPath,
        dryRun: options.dryRun === true,
        gitRunner: options.gitRunner ?? defaultGitRunner,
      })
    : null;
  const effectiveDecision = applyBranchUpdateResult(decision, branchUpdate);
  const mutates = options.dryRun !== true;
  const updated = mutates
    ? updateNexusGitWorkflowRun({
        projectRoot: context.repositoryPath,
        id: context.run.id,
        status: effectiveDecision.status,
        terminalOutcome: effectiveDecision.status === "completed" ? "completed" : null,
        owner: effectiveDecision.nextOwner,
        evidence: [
          ...evidence,
          ...providerActionEvidence(effectiveDecision.providerActions, timestamp),
          ...branchUpdateEvidence(branchUpdate, timestamp),
          ...verificationRequiredEvidence(branchUpdate, timestamp),
        ],
        allowedTransitions: allowedTransitionsForDecision(
          effectiveDecision,
          branchUpdate,
        ),
        nodes: [
          nodeForDecision(effectiveDecision, branchUpdate, timestamp),
        ],
        now: timestamp,
      })
    : context.run;

  return {
    mutates,
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
    profile: {
      id: context.profile.id,
      branchStrategy: context.profile.branchStrategy,
    },
    runBefore,
    runAfter: summarizeNexusGitWorkflowRun(updated),
    branchFreshness,
    branchUpdate,
    decision: effectiveDecision,
  };
}

function resolveAdvanceContext(
  options: AdvanceNexusGitWorkflowRunOptions,
): GitWorkflowAdvanceContext {
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
  const repositoryPath = options.repositoryPath ?? component.sourceRoot;
  const run = selectRun({
    repositoryPath,
    componentId: component.id,
    runId: options.runId ?? null,
    workItemId: options.workItemId ?? null,
    branchName: options.branchName ?? null,
  });
  const profile = selectProfile(projectConfig, options.profileId ?? run.profileId);
  return {
    projectRoot,
    projectConfig,
    component,
    repositoryPath,
    profile,
    run,
  };
}

function selectRun(options: {
  repositoryPath: string;
  componentId: string;
  runId: string | null;
  workItemId: string | null;
  branchName: string | null;
}): NexusGitWorkflowRunRecord {
  const candidates = readNexusGitWorkflowRunStore(options.repositoryPath).runs
    .filter((run) =>
      (options.runId ? run.id === options.runId : true) &&
      (run.componentId ? run.componentId === options.componentId : true) &&
      (options.workItemId ? run.workItemId === options.workItemId : true) &&
      (options.branchName ? run.branchName === options.branchName : true)
    )
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const run = candidates.at(-1);
  if (!run) {
    throw new Error("No matching Git workflow run was recorded.");
  }
  return run;
}

function selectProfile(
  projectConfig: NexusProjectConfig,
  profileId: string | null,
): NexusGitWorkflowProfileConfig {
  const automationConfig = projectConfig.automation ?? defaultNexusAutomationConfig;
  const selectedProfileId = profileId ??
    automationConfig.gitWorkflows.activeProfileId ??
    null;
  const profile = automationConfig.gitWorkflows.profiles.find((candidate) =>
    candidate.id === selectedProfileId
  );
  if (!profile) {
    throw new Error(`Git workflow profile is not configured: ${selectedProfileId}`);
  }
  return profile;
}

function branchFreshnessDecision(
  context: GitWorkflowAdvanceContext,
  provider: NexusGitWorkflowAdvanceProviderEvidence,
  git: NexusGitWorkflowBranchFreshnessGitEvidence | null | undefined,
): NexusGitWorkflowBranchFreshnessDecision {
  return buildNexusGitWorkflowBranchFreshnessDecision({
    profile: context.profile,
    headBranch: context.run.branchName,
    baseBranch:
      context.run.baseRef ??
      context.run.targetBranch ??
      context.profile.targetBranch ??
      "HEAD",
    pushRemote: context.profile.branchPublication.fallbackRemote ?? "origin",
    publicBranch: true,
    git,
    provider,
  });
}

function advanceDecision(options: {
  context: GitWorkflowAdvanceContext;
  provider: NexusGitWorkflowAdvanceProviderEvidence;
  authority: NexusGitWorkflowAdvanceAuthority;
  branchFreshness: NexusGitWorkflowBranchFreshnessDecision;
}): NexusGitWorkflowAdvanceDecision {
  const reasons: string[] = [];
  const review = options.provider.review ?? "unknown";
  const checks = options.provider.requiredChecks ?? "unknown";

  if (options.context.run.terminalOutcome) {
    return {
      action: "noop",
      status: options.context.run.status,
      nextOwner: { kind: "none", id: null },
      reasons: ["Git workflow run is already terminal."],
      blockers: [],
      humanGates: [],
      commands: [],
      providerActions: [],
    };
  }

  if (options.provider.publication === "completed") {
    return {
      action: "complete",
      status: "completed",
      nextOwner: { kind: "none", id: null },
      reasons: ["Publication completion evidence is present."],
      blockers: [],
      humanGates: [],
      commands: [],
      providerActions: [],
    };
  }

  if (review === "approved") {
    reasons.push("Provider review is approved.");
  } else if (review === "changes_requested") {
    return blockedDecision("Provider requested changes.", "human");
  } else if (options.context.profile.review.mode === "review_branch_pr") {
    return waitingDecision({
      nextOwner: { kind: "provider", id: null },
      reasons: ["Waiting for provider review approval."],
    });
  }

  if (checks === "passed") {
    reasons.push("Required checks passed.");
  } else if (checks === "failed") {
    return blockedDecision("Required checks failed.", "agent");
  } else {
    return waitingDecision({
      nextOwner: { kind: "ci", id: null },
      reasons: ["Waiting for required checks to pass."],
    });
  }

  const freshness = options.branchFreshness;
  if (freshness.action === "block") {
    return {
      action: "block",
      status: "blocked",
      nextOwner: { kind: "agent", id: null },
      reasons: [...reasons, ...freshness.reasons],
      blockers: freshness.blockers,
      humanGates: freshness.humanGate ? [freshness.humanGate] : [],
      commands: freshness.command ? [freshness.command] : [],
      providerActions: freshness.providerAction ? [freshness.providerAction] : [],
    };
  }
  if (freshness.action !== "none") {
    return branchUpdateDecision({
      reasons,
      freshness,
      authority: options.authority,
    });
  }
  if (freshness.providerAction && !options.authority.providerWrite) {
    return {
      action: "handoff",
      status: "waiting",
      nextOwner: { kind: "human", id: null },
      reasons: [...reasons, ...freshness.reasons],
      blockers: [
        `Provider action requires provider-write authority: ${freshness.providerAction}.`,
      ],
      humanGates: [],
      commands: [],
      providerActions: [freshness.providerAction],
    };
  }

  if (options.context.profile.gates.publication.includes("human_approval")) {
    return {
      action: "handoff",
      status: "waiting",
      nextOwner: { kind: "human", id: null },
      reasons: [
        ...reasons,
        "Final publication requires human approval or explicit authority.",
      ],
      blockers: [],
      humanGates: ["human_approval", "publication_authority"],
      commands: [],
      providerActions: [],
    };
  }

  if (!options.authority.finalPublication) {
    return {
      action: "handoff",
      status: "waiting",
      nextOwner: { kind: "human", id: null },
      reasons: [...reasons, "Final publication authority was not supplied."],
      blockers: ["Final publication requires explicit authority."],
      humanGates: ["publication_authority"],
      commands: [],
      providerActions: [],
    };
  }

  return {
    action: "advance",
    status: "ready_for_review",
    nextOwner: { kind: "agent", id: null },
    reasons: [...reasons, "Final publication authority is available."],
    blockers: [],
    humanGates: [],
    commands: [],
    providerActions: [],
  };
}

function branchUpdateDecision(options: {
  reasons: string[];
  freshness: NexusGitWorkflowBranchFreshnessDecision;
  authority: NexusGitWorkflowAdvanceAuthority;
}): NexusGitWorkflowAdvanceDecision {
  if (options.freshness.action === "wait") {
    return {
      action: "handoff",
      status: "waiting",
      nextOwner: { kind: "agent", id: null },
      reasons: [...options.reasons, ...options.freshness.reasons],
      blockers: [],
      humanGates: [],
      commands: [],
      providerActions: options.freshness.providerAction
        ? [options.freshness.providerAction]
        : [],
    };
  }
  const blockers: string[] = [];
  const humanGates: NexusGitWorkflowAdvanceHumanGate[] = [];
  if (!options.authority.gitMutation) {
    blockers.push(
      `Branch update requires Git mutation authority: ${options.freshness.action}.`,
    );
  }
  if (
    options.freshness.forceWithLeaseRequired &&
    !options.authority.forceWithLease
  ) {
    blockers.push(
      `Branch update requires force-with-lease approval before ${options.freshness.action}.`,
    );
    humanGates.push("public_history_rewrite");
  }
  if (options.freshness.humanGate) {
    humanGates.push(options.freshness.humanGate);
  }
  const command = options.freshness.command;
  return {
    action: blockers.length > 0 ? "handoff" : "advance",
    status: "waiting",
    nextOwner: blockers.length > 0
      ? { kind: "human", id: null }
      : { kind: "agent", id: null },
    reasons: [...options.reasons, ...options.freshness.reasons],
    blockers: uniqueStrings(blockers),
    humanGates: uniqueStrings(humanGates),
    commands: command ? [command] : [],
    providerActions: options.freshness.providerAction
      ? [options.freshness.providerAction]
      : [],
  };
}

function executeBranchUpdate(options: {
  branchFreshness: NexusGitWorkflowBranchFreshnessDecision;
  authority: NexusGitWorkflowAdvanceAuthority;
  repositoryPath: string;
  dryRun: boolean;
  gitRunner: GitRunner;
}): NexusGitWorkflowBranchUpdateExecutionResult {
  const freshness = options.branchFreshness;
  const action = freshness.action;
  const gitCommands: GitCommandResult[] = [];
  const blocked = (summary: string): NexusGitWorkflowBranchUpdateExecutionResult => ({
    requested: true,
    dryRun: options.dryRun,
    status: "blocked",
    action,
    branch: freshness.headBranch,
    baseRef: freshness.baseBranch,
    pushRemote: freshness.pushRemote,
    beforeCommit: null,
    baseCommit: null,
    afterCommit: null,
    expectedRemoteCommit: null,
    forceWithLease: {
      required: freshness.forceWithLeaseRequired,
      approved: options.authority.forceWithLease === true,
      expectedCommit: null,
    },
    verificationRequired: null,
    commands: [],
    blockers: [summary],
    summary,
    git: {
      commands: gitCommands,
    },
  });

  if (action === "none" || action === "wait") {
    return {
      requested: true,
      dryRun: options.dryRun,
      status: "not_applicable",
      action,
      branch: freshness.headBranch,
      baseRef: freshness.baseBranch,
      pushRemote: freshness.pushRemote,
      beforeCommit: null,
      baseCommit: null,
      afterCommit: null,
      expectedRemoteCommit: null,
      forceWithLease: {
        required: false,
        approved: options.authority.forceWithLease === true,
        expectedCommit: null,
      },
      verificationRequired: null,
      commands: [],
      blockers: [],
      summary: `Branch update action ${action} does not require Git execution.`,
      git: {
        commands: gitCommands,
      },
    };
  }
  if (action === "block") {
    return blocked("Branch freshness decision blocked branch update execution.");
  }
  if (!freshness.headBranch) {
    return blocked("Branch update execution requires a head branch.");
  }
  if (!options.authority.gitMutation) {
    return blocked(`Branch update requires Git mutation authority: ${action}.`);
  }
  if (freshness.forceWithLeaseRequired && !options.authority.forceWithLease) {
    return blocked(
      `Branch update requires force-with-lease approval before ${action}.`,
    );
  }
  if (!isExecutableBranchUpdateAction(action)) {
    return blocked(
      `Branch update action ${action} requires manual orchestration before DevNexus can execute it.`,
    );
  }

  const beforeCommit = readCommit({
    gitRunner: options.gitRunner,
    commands: gitCommands,
    repositoryPath: options.repositoryPath,
    ref: freshness.headBranch,
  });
  const baseCommit = readCommit({
    gitRunner: options.gitRunner,
    commands: gitCommands,
    repositoryPath: options.repositoryPath,
    ref: freshness.baseBranch,
  });
  const forceWithLease = {
    required: freshness.forceWithLeaseRequired,
    approved: options.authority.forceWithLease === true,
    expectedCommit: freshness.forceWithLeaseRequired ? beforeCommit : null,
  };
  const commandArgs = branchUpdateCommandArgs({
    action,
    branch: freshness.headBranch,
    baseRef: freshness.baseBranch,
    pushRemote: freshness.pushRemote,
    expectedCommit: forceWithLease.expectedCommit,
  });
  const commands = commandArgs.map(commandString);
  if (options.dryRun) {
    return {
      requested: true,
      dryRun: true,
      status: "planned",
      action,
      branch: freshness.headBranch,
      baseRef: freshness.baseBranch,
      pushRemote: freshness.pushRemote,
      beforeCommit,
      baseCommit,
      afterCommit: null,
      expectedRemoteCommit: forceWithLease.expectedCommit,
      forceWithLease,
      verificationRequired: "required_checks",
      commands,
      blockers: [],
      summary:
        `Dry-run planned ${action} update for ${freshness.headBranch}.`,
      git: {
        commands: gitCommands,
      },
    };
  }

  const mutationCommands = commandArgs.slice(0, -1);
  const pushCommand = commandArgs.at(-1)!;
  for (const args of mutationCommands) {
    const result = runGit({
      gitRunner: options.gitRunner,
      commands: gitCommands,
      repositoryPath: options.repositoryPath,
      args,
    });
    if (result.exitCode !== 0) {
      return {
        requested: true,
        dryRun: false,
        status: "failed",
        action,
        branch: freshness.headBranch,
        baseRef: freshness.baseBranch,
        pushRemote: freshness.pushRemote,
        beforeCommit,
        baseCommit,
        afterCommit: null,
        expectedRemoteCommit: forceWithLease.expectedCommit,
        forceWithLease,
        verificationRequired: null,
        commands,
        blockers: [
          `Branch update command failed: ${commandString(args)}`,
        ],
        summary:
          `Branch update ${action} failed for ${freshness.headBranch}.`,
        git: {
          commands: gitCommands,
        },
      };
    }
  }
  const afterCommit = readHeadCommit({
    gitRunner: options.gitRunner,
    commands: gitCommands,
    repositoryPath: options.repositoryPath,
  });
  const pushResult = runGit({
    gitRunner: options.gitRunner,
    commands: gitCommands,
    repositoryPath: options.repositoryPath,
    args: pushCommand,
  });
  if (pushResult.exitCode !== 0) {
    return {
      requested: true,
      dryRun: false,
      status: "failed",
      action,
      branch: freshness.headBranch,
      baseRef: freshness.baseBranch,
      pushRemote: freshness.pushRemote,
      beforeCommit,
      baseCommit,
      afterCommit,
      expectedRemoteCommit: forceWithLease.expectedCommit,
      forceWithLease,
      verificationRequired: null,
      commands,
      blockers: [
        `Branch update command failed: ${commandString(pushCommand)}`,
      ],
      summary:
        `Branch update ${action} failed while pushing ${freshness.headBranch}.`,
      git: {
        commands: gitCommands,
      },
    };
  }
  return {
    requested: true,
    dryRun: false,
    status: "executed",
    action,
    branch: freshness.headBranch,
    baseRef: freshness.baseBranch,
    pushRemote: freshness.pushRemote,
    beforeCommit,
    baseCommit,
    afterCommit,
    expectedRemoteCommit: forceWithLease.expectedCommit,
    forceWithLease,
    verificationRequired: "required_checks",
    commands,
    blockers: [],
    summary:
      `Branch update ${action} updated ${freshness.headBranch}` +
      `${beforeCommit || afterCommit ? ` from ${beforeCommit ?? "unknown"} to ${afterCommit ?? "unknown"}` : ""}.`,
    git: {
      commands: gitCommands,
    },
  };
}

function isExecutableBranchUpdateAction(
  action: NexusGitWorkflowUpdateAction,
): action is "merge" | "rebase" | "cherry_pick" {
  return action === "merge" || action === "rebase" || action === "cherry_pick";
}

function branchUpdateCommandArgs(options: {
  action: "merge" | "rebase" | "cherry_pick";
  branch: string;
  baseRef: string;
  pushRemote: string;
  expectedCommit: string | null;
}): string[][] {
  const pushArgs = options.action === "rebase"
    ? [
        "push",
        options.expectedCommit
          ? `--force-with-lease=refs/heads/${options.branch}:${options.expectedCommit}`
          : "--force-with-lease",
        options.pushRemote,
        options.branch,
      ]
    : ["push", options.pushRemote, options.branch];
  return [
    ["checkout", options.branch],
    branchMutationArgs(options.action, options.baseRef),
    pushArgs,
  ];
}

function branchMutationArgs(
  action: "merge" | "rebase" | "cherry_pick",
  baseRef: string,
): string[] {
  if (action === "merge") {
    return ["merge", "--no-ff", baseRef];
  }
  if (action === "rebase") {
    return ["rebase", baseRef];
  }
  return ["cherry-pick", baseRef];
}

function readCommit(options: {
  gitRunner: GitRunner;
  commands: GitCommandResult[];
  repositoryPath: string;
  ref: string;
}): string | null {
  const result = runGit({
    gitRunner: options.gitRunner,
    commands: options.commands,
    repositoryPath: options.repositoryPath,
    args: ["rev-parse", "--verify", "--quiet", `${options.ref}^{commit}`],
  });
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

function readHeadCommit(options: {
  gitRunner: GitRunner;
  commands: GitCommandResult[];
  repositoryPath: string;
}): string | null {
  const result = runGit({
    gitRunner: options.gitRunner,
    commands: options.commands,
    repositoryPath: options.repositoryPath,
    args: ["rev-parse", "HEAD"],
  });
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

function runGit(options: {
  gitRunner: GitRunner;
  commands: GitCommandResult[];
  repositoryPath: string;
  args: string[];
}): GitCommandResult {
  const result = options.gitRunner(options.args, options.repositoryPath);
  options.commands.push(result);
  return result;
}

function commandString(args: string[]): string {
  return `git ${args.map(shellQuoteArgument).join(" ")}`;
}

function applyBranchUpdateResult(
  decision: NexusGitWorkflowAdvanceDecision,
  branchUpdate: NexusGitWorkflowBranchUpdateExecutionResult | null,
): NexusGitWorkflowAdvanceDecision {
  if (!branchUpdate || branchUpdate.status === "planned") {
    return decision;
  }
  if (branchUpdate.status === "executed") {
    return {
      ...decision,
      status: "waiting",
      nextOwner: { kind: "ci", id: null },
      reasons: [
        ...decision.reasons,
        branchUpdate.summary,
        "Required checks must pass after the branch update before publication.",
      ],
      blockers: [],
      humanGates: [],
      commands: branchUpdate.commands,
    };
  }
  if (branchUpdate.status === "not_applicable") {
    return decision;
  }
  return {
    ...decision,
    action: "block",
    status: "blocked",
    nextOwner: { kind: "agent", id: null },
    blockers: uniqueStrings([
      ...decision.blockers,
      ...branchUpdate.blockers,
    ]),
    commands: branchUpdate.commands.length > 0
      ? branchUpdate.commands
      : decision.commands,
  };
}

function blockedDecision(
  blocker: string,
  ownerKind: NexusGitWorkflowRunOwner["kind"],
): NexusGitWorkflowAdvanceDecision {
  return {
    action: "block",
    status: "blocked",
    nextOwner: { kind: ownerKind, id: null },
    reasons: [],
    blockers: [blocker],
    humanGates: [],
    commands: [],
    providerActions: [],
  };
}

function waitingDecision(options: {
  nextOwner: NexusGitWorkflowRunOwner;
  reasons: string[];
}): NexusGitWorkflowAdvanceDecision {
  return {
    action: "handoff",
    status: "waiting",
    nextOwner: options.nextOwner,
    reasons: options.reasons,
    blockers: [],
    humanGates: [],
    commands: [],
    providerActions: [],
  };
}

function providerEvidence(
  provider: NexusGitWorkflowAdvanceProviderEvidence,
  timestamp: string,
): NexusGitWorkflowRunEvidenceInput[] {
  const evidence: NexusGitWorkflowRunEvidenceInput[] = [];
  if (provider.review) {
    evidence.push({
      id: "provider-review",
      kind: "provider_review",
      summary: `Provider review is ${provider.review.replace(/_/gu, " ")}.`,
      observedAt: timestamp,
    });
  }
  if (provider.requiredChecks) {
    evidence.push({
      id: "required-checks",
      kind: "provider_checks",
      summary: `Required checks ${checksSummary(provider.requiredChecks)}.`,
      observedAt: timestamp,
    });
  }
  if (provider.baseStatus) {
    evidence.push({
      id: "branch-freshness",
      kind: "branch_freshness",
      summary: `Provider base status is ${provider.baseStatus.replace(/_/gu, " ")}.`,
      observedAt: timestamp,
    });
  }
  if (provider.publication) {
    evidence.push({
      id: "publication",
      kind: "publication",
      summary: `Publication is ${provider.publication}.`,
      observedAt: timestamp,
    });
  }
  return evidence;
}

function branchUpdateEvidence(
  branchUpdate: NexusGitWorkflowBranchUpdateExecutionResult | null,
  timestamp: string,
): NexusGitWorkflowRunEvidenceInput[] {
  if (
    !branchUpdate ||
    branchUpdate.status === "planned" ||
    branchUpdate.status === "not_applicable"
  ) {
    return [];
  }
  return [
    {
      id: "branch-update",
      kind: "branch_update",
      summary: branchUpdate.summary,
      observedAt: timestamp,
    },
  ];
}

function verificationRequiredEvidence(
  branchUpdate: NexusGitWorkflowBranchUpdateExecutionResult | null,
  timestamp: string,
): NexusGitWorkflowRunEvidenceInput[] {
  if (branchUpdate?.verificationRequired !== "required_checks") {
    return [];
  }
  return [
    {
      id: "verification-required",
      kind: "verification_required",
      summary: "Required checks must pass after the branch update before publication.",
      observedAt: timestamp,
    },
  ];
}

function providerActionEvidence(
  providerActions: string[],
  timestamp: string,
): NexusGitWorkflowRunEvidenceInput[] {
  return providerActions.map((action) => ({
    id: `provider-action:${action}`,
    kind: "provider_action",
    summary: `Provider action required: ${action}.`,
    observedAt: timestamp,
  }));
}

function checksSummary(
  status: NonNullable<NexusGitWorkflowAdvanceProviderEvidence["requiredChecks"]>,
): string {
  return status === "passed" || status === "failed"
    ? status
    : `are ${status}`;
}

function allowedTransitionsForDecision(
  decision: NexusGitWorkflowAdvanceDecision,
  branchUpdate: NexusGitWorkflowBranchUpdateExecutionResult | null = null,
): NexusGitWorkflowRunTransitionInput[] {
  if (decision.status === "completed") {
    return [];
  }
  if (branchUpdate?.status === "executed") {
    return [
      {
        id: "advance-after-required-checks",
        to: decision.status,
        summary: "Advance again after required checks pass on the updated branch.",
        requiresApproval: false,
      },
    ];
  }
  if (decision.action === "block") {
    return [
      {
        id: "resume-after-blocker",
        to: "waiting",
        summary: "Resume after the blocker is resolved.",
        requiresApproval: true,
      },
    ];
  }
  return [
    {
      id: "advance",
      to: decision.status,
      summary: "Advance again after new evidence is available.",
      requiresApproval: decision.humanGates.length > 0,
    },
  ];
}

function nodeForDecision(
  decision: NexusGitWorkflowAdvanceDecision,
  branchUpdate: NexusGitWorkflowBranchUpdateExecutionResult | null,
  timestamp: string,
): NexusGitWorkflowRunNodeInput {
  if (branchUpdate?.status === "executed") {
    return {
      id: `branch-update-${branchUpdate.action}`,
      kind: "action",
      summary: branchUpdate.summary,
      recordedAt: timestamp,
    };
  }
  if (branchUpdate?.status === "failed" || branchUpdate?.status === "blocked") {
    return {
      id: `branch-update-${branchUpdate.status}`,
      kind: "gate",
      summary: branchUpdate.blockers[0] ?? branchUpdate.summary,
      recordedAt: timestamp,
    };
  }
  return {
    id: decision.action,
    kind: decision.action === "complete"
      ? "terminal"
      : decision.action === "block"
        ? "gate"
        : "handoff",
    summary: decisionSummary(decision),
    recordedAt: timestamp,
  };
}

function decisionSummary(decision: NexusGitWorkflowAdvanceDecision): string {
  return decision.reasons[0] ??
    decision.blockers[0] ??
    `Git workflow advance selected ${decision.action}.`;
}

function isoString(value: Date | string | (() => Date | string) | undefined): string {
  const resolved = typeof value === "function" ? value() : value ?? new Date();
  return typeof resolved === "string" ? resolved : resolved.toISOString();
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}
