import {
  defaultNexusAutomationConfig,
  type NexusGitWorkflowGate,
  type NexusGitWorkflowProfileConfig,
} from "../automation/nexusAutomationConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
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

export interface NexusGitWorkflowAdvanceResult {
  mutates: true;
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
  const updated = updateNexusGitWorkflowRun({
    projectRoot: context.repositoryPath,
    id: context.run.id,
    status: decision.status,
    terminalOutcome: decision.status === "completed" ? "completed" : null,
    owner: decision.nextOwner,
    evidence,
    allowedTransitions: allowedTransitionsForDecision(decision),
    nodes: [
      {
        id: decision.action,
        kind: decision.action === "complete"
          ? "terminal"
          : decision.action === "block"
            ? "gate"
            : "handoff",
        summary: decisionSummary(decision),
        recordedAt: timestamp,
      },
    ],
    now: timestamp,
  });

  return {
    mutates: true,
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
    decision,
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

function checksSummary(
  status: NonNullable<NexusGitWorkflowAdvanceProviderEvidence["requiredChecks"]>,
): string {
  return status === "passed" || status === "failed"
    ? status
    : `are ${status}`;
}

function allowedTransitionsForDecision(
  decision: NexusGitWorkflowAdvanceDecision,
): NexusGitWorkflowRunTransitionInput[] {
  if (decision.status === "completed") {
    return [];
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
