import fs from "node:fs";
import {
  defaultNexusAutomationConfig,
  type NexusGitWorkflowDecisionGraphConfig,
  type NexusGitWorkflowDecisionGraphNodeConfig,
  type NexusGitWorkflowDecisionGraphTransitionConfig,
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
  NexusForgePublicationError,
  type NexusForgePullRequestResult,
} from "../publication/nexusForgePublication.js";
import {
  inspectNexusPublicationPullRequestForBranch,
} from "../publication/nexusPublicationOperations.js";
import {
  classifyNexusPublicationProviderEvidenceChecks,
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidenceInput,
} from "../publication/nexusPublicationProviderEvidence.js";
import {
  NexusProviderCredentialBrokerError,
  type NexusProviderCredentialCommandRunner,
} from "../providers/nexusProviderCredentialBroker.js";
import {
  readNexusGitWorkflowRunStore,
  summarizeNexusGitWorkflowRun,
  type NexusGitWorkflowRunOwner,
  type NexusGitWorkflowRunRecord,
  type NexusGitWorkflowRunSummary,
} from "./nexusGitWorkflowRunState.js";
import {
  buildNexusGitWorkflowBranchFreshnessDecision,
  type NexusGitWorkflowBranchFreshnessDecision,
  type NexusGitWorkflowMergeQueueStatus,
  type NexusGitWorkflowProviderBaseStatus,
  type NexusGitWorkflowProviderMergeability,
  type NexusGitWorkflowRequiredChecksStatus,
  type NexusGitWorkflowValidationMode,
} from "./nexusGitWorkflowBranchFreshness.js";
import type { NexusGitWorkflowProviderReviewStatus } from "./nexusGitWorkflowAdvance.js";

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
  providerEvidence?: NexusGitWorkflowProviderEvidenceAttachment | null;
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

export interface NexusGitWorkflowPlanStatusDecisionGraphTransition
  extends NexusGitWorkflowDecisionGraphTransitionConfig {
  missingEvidence: string[];
}

export interface NexusGitWorkflowPlanStatusDecisionGraph {
  id: string;
  source: NexusGitWorkflowDecisionGraphConfig["source"];
  template: NexusGitWorkflowDecisionGraphConfig["template"];
  currentNode: NexusGitWorkflowDecisionGraphNodeConfig | null;
  allowedTransitions: NexusGitWorkflowPlanStatusDecisionGraphTransition[];
  missingEvidence: string[];
  nextOwner: NexusGitWorkflowRunOwner;
}

export type NexusGitWorkflowProviderEvidenceStatus =
  | "not_required"
  | "attached"
  | "missing_pull_request"
  | "credential_error"
  | "rate_limited"
  | "provider_error"
  | "insufficient_context";

export interface NexusGitWorkflowProviderEvidenceAttachment {
  requested: boolean;
  status: NexusGitWorkflowProviderEvidenceStatus;
  summary: string;
  pullRequest: Pick<
    NexusForgePullRequestResult,
    "number" | "url" | "state" | "title"
  > | null;
  evidence: NexusPublicationProviderEvidenceInput | NexusPublicationProviderEvidence | null;
}

export interface NexusGitWorkflowProviderEvidenceFacts {
  review: NexusGitWorkflowProviderReviewStatus;
  requiredChecks: NexusGitWorkflowRequiredChecksStatus;
  baseStatus: NexusGitWorkflowProviderBaseStatus;
  mergeability: NexusGitWorkflowProviderMergeability;
  mergeQueue: NexusGitWorkflowMergeQueueStatus;
  validationMode: NexusGitWorkflowValidationMode;
}

export interface NexusGitWorkflowPlanStatusProviderEvidence
  extends NexusGitWorkflowProviderEvidenceAttachment {
  facts: NexusGitWorkflowProviderEvidenceFacts | null;
}

export interface CollectNexusGitWorkflowProviderEvidenceOptions
  extends NexusGitWorkflowPlanStatusOptions {
  baseEnv?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  credentialCommandRunner?: NexusProviderCredentialCommandRunner;
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
  providerEvidence: NexusGitWorkflowPlanStatusProviderEvidence | null;
  branchFreshness: NexusGitWorkflowBranchFreshnessDecision | null;
  decisionGraph: NexusGitWorkflowPlanStatusDecisionGraph | null;
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

export async function collectNexusGitWorkflowProviderEvidence(
  options: CollectNexusGitWorkflowProviderEvidenceOptions,
): Promise<NexusGitWorkflowProviderEvidenceAttachment> {
  const context = resolveGitWorkflowContext(options);
  const run = selectGitWorkflowRun(context, options);
  const profileSelection = selectGitWorkflowProfile(
    context.projectConfig,
    options.profileId ?? run?.profileId ?? null,
  );
  const profile = profileSelection.profile;
  if (!profile || profile.review.mode !== "review_branch_pr") {
    return {
      requested: true,
      status: "not_required",
      summary: "Selected Git workflow profile does not require provider pull request evidence.",
      pullRequest: null,
      evidence: null,
    };
  }

  const targetBranch = resolveTargetBranch(context, profile, run);
  const baseRef = run?.baseRef ?? defaultBaseRef(context, targetBranch);
  const gitEvidence = collectGitEvidence({
    repositoryPath: context.repositoryPath,
    baseRef,
    gitRunner: options.gitRunner ?? defaultGitRunner,
  });
  const branchName =
    options.branchName ??
    run?.branchName ??
    run?.currentRef ??
    gitEvidence.currentBranch;
  if (!branchName || !targetBranch) {
    return {
      requested: true,
      status: "insufficient_context",
      summary:
        "Provider evidence requires a branch name and target branch before a pull request can be located.",
      pullRequest: null,
      evidence: null,
    };
  }

  try {
    const result = await inspectNexusPublicationPullRequestForBranch({
      projectRoot: context.projectRoot,
      componentId: context.component.id,
      head: branchName,
      base: targetBranch,
      baseEnv: options.baseEnv,
      fetch: options.fetch,
      credentialCommandRunner: options.credentialCommandRunner,
    });
    if (!result.pullRequest) {
      return {
        requested: true,
        status: "missing_pull_request",
        summary:
          `No open provider pull request found for ${branchName} targeting ${targetBranch}.`,
        pullRequest: null,
        evidence: null,
      };
    }
    return {
      requested: true,
      status: "attached",
      summary: `Attached provider evidence from pull request #${result.pullRequest.number}.`,
      pullRequest: summarizePullRequest(result.pullRequest),
      evidence: result.evidence,
    };
  } catch (error) {
    return providerEvidenceErrorAttachment(error);
  }
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
  const providerStatus = buildProviderEvidenceStatus({
    context,
    profile,
    run,
    branchName,
    targetBranch,
    attachment: options.providerEvidence ?? null,
  });
  const branchFreshness = buildProviderBranchFreshness({
    context,
    profile,
    run,
    branchName,
    targetBranch,
    providerEvidence: providerStatus.providerEvidence,
  });
  const evidence = [
    profileEvidence(profile),
    ...profileSelection.evidence,
    ...gitEvidence.evidence,
    ...providerStatus.evidence,
  ];
  const evidenceGaps = [
    ...profileSelection.gaps,
    ...gitEvidence.gaps,
    ...providerStatus.gaps,
  ];
  const blockers = [
    ...profileSelection.blockers,
    ...gitEvidence.blockers,
    ...providerStatus.blockers,
    ...targetBlockers(targetBranch),
    ...(mode === "status" && !run ? ["No matching Git workflow run was recorded."] : []),
  ];
  const nextOwner = run?.owner ?? { kind: "agent", id: null };
  const decisionGraph = buildDecisionGraphStatus({
    profile,
    run,
    evidence,
    fallbackOwner: nextOwner,
  });

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
    providerEvidence: providerStatus.providerEvidence,
    branchFreshness,
    decisionGraph,
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

function buildDecisionGraphStatus(options: {
  profile: NexusGitWorkflowProfileConfig | null;
  run: NexusGitWorkflowRunRecord | null;
  evidence: NexusGitWorkflowPlanStatusEvidence[];
  fallbackOwner: NexusGitWorkflowRunOwner;
}): NexusGitWorkflowPlanStatusDecisionGraph | null {
  const graph = options.profile?.decisionGraph;
  if (!graph) {
    return null;
  }

  const currentNodeId = options.run?.nodes.at(-1)?.id ?? graph.startNodeId;
  const currentNode =
    graph.nodes.find((candidate) => candidate.id === currentNodeId) ??
    graph.nodes.find((candidate) => candidate.id === graph.startNodeId) ??
    null;
  const presentEvidenceIds = new Set([
    ...options.evidence
      .filter((item) => item.status === "present")
      .map((item) => item.id),
    ...(options.run?.evidence.map((item) => item.id) ?? []),
  ]);
  const allowedTransitions = currentNode
    ? graph.transitions
        .filter((transition) => transition.from === currentNode.id)
        .map((transition) => ({
          ...transition,
          missingEvidence: transition.requiredEvidence.filter(
            (evidenceId) => !presentEvidenceIds.has(evidenceId),
          ),
        }))
    : [];
  const missingEvidence = uniqueStrings(
    allowedTransitions.flatMap((transition) => transition.missingEvidence),
  );
  const nextOwner =
    allowedTransitions.find((transition) => transition.missingEvidence.length > 0)
      ?.nextOwner ??
    allowedTransitions[0]?.nextOwner ??
    options.fallbackOwner;

  return {
    id: graph.id,
    source: graph.source,
    template: graph.template,
    currentNode,
    allowedTransitions,
    missingEvidence,
    nextOwner,
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

function buildProviderEvidenceStatus(options: {
  context: NexusGitWorkflowContext;
  profile: NexusGitWorkflowProfileConfig | null;
  run: NexusGitWorkflowRunRecord | null;
  branchName: string | null;
  targetBranch: string | null;
  attachment: NexusGitWorkflowProviderEvidenceAttachment | null;
}): {
  providerEvidence: NexusGitWorkflowPlanStatusProviderEvidence | null;
  evidence: NexusGitWorkflowPlanStatusEvidence[];
  gaps: string[];
  blockers: string[];
} {
  if (!options.profile || options.profile.review.mode !== "review_branch_pr") {
    return {
      providerEvidence: options.attachment
        ? { ...options.attachment, facts: null }
        : null,
      evidence: [],
      gaps: [],
      blockers: [],
    };
  }
  if (!options.attachment) {
    return {
      providerEvidence: null,
      evidence: [
        {
          id: "provider-review",
          status: "missing",
          summary:
            "Provider review evidence is not loaded by read-only plan/status without a pull request evidence input.",
        },
      ],
      gaps: ["Provider review evidence has not been attached."],
      blockers: [],
    };
  }
  if (options.attachment.status !== "attached" || !options.attachment.evidence) {
    const evidenceStatus: NexusGitWorkflowEvidenceStatus =
      options.attachment.status === "missing_pull_request" ? "missing" : "warning";
    return {
      providerEvidence: {
        ...options.attachment,
        facts: null,
      },
      evidence: [
        {
          id: "provider-pull-request",
          status: evidenceStatus,
          summary: options.attachment.summary,
        },
        {
          id: "provider-review",
          status: "missing",
          summary: "Provider review evidence is unavailable.",
        },
      ],
      gaps: [options.attachment.summary],
      blockers: providerEvidenceAttachmentBlockers(options.attachment),
    };
  }

  const evidence = normalizeNexusPublicationProviderEvidence([
    options.attachment.evidence,
  ])[0]!;
  const facts = providerEvidenceFacts({
    context: options.context,
    evidence,
  });
  const providerEvidence: NexusGitWorkflowPlanStatusProviderEvidence = {
    ...options.attachment,
    evidence,
    facts,
  };
  const evidenceItems = providerEvidenceItems({
    context: options.context,
    attachment: options.attachment,
    evidence,
    facts,
  });
  return {
    providerEvidence,
    evidence: evidenceItems,
    gaps: providerEvidenceGaps(evidenceItems),
    blockers: providerEvidenceBlockers(facts),
  };
}

function buildProviderBranchFreshness(options: {
  context: NexusGitWorkflowContext;
  profile: NexusGitWorkflowProfileConfig | null;
  run: NexusGitWorkflowRunRecord | null;
  branchName: string | null;
  targetBranch: string | null;
  providerEvidence: NexusGitWorkflowPlanStatusProviderEvidence | null;
}): NexusGitWorkflowBranchFreshnessDecision | null {
  const facts = options.providerEvidence?.facts ?? null;
  if (!options.profile || !facts || !options.targetBranch) {
    return null;
  }

  return buildNexusGitWorkflowBranchFreshnessDecision({
    profile: options.profile,
    headBranch: options.branchName ?? options.run?.branchName ?? null,
    baseBranch: options.run?.baseRef ?? options.targetBranch,
    pushRemote: options.profile.branchPublication.fallbackRemote ??
      options.context.publication.remote ??
      "origin",
    publicBranch: true,
    provider: {
      baseStatus: facts.baseStatus,
      mergeable: facts.mergeability,
      validationMode: facts.validationMode,
      requiredChecks: facts.requiredChecks,
      mergeQueue: facts.mergeQueue,
    },
  });
}

function providerEvidenceFacts(options: {
  context: NexusGitWorkflowContext;
  evidence: NexusPublicationProviderEvidence;
}): NexusGitWorkflowProviderEvidenceFacts {
  const checkClassification = classifyNexusPublicationProviderEvidenceChecks({
    evidence: options.evidence,
    requiredChecks: options.context.publication.greenMain?.requiredChecks ?? [],
  });
  const mergeQueue = workflowMergeQueueStatus(options.evidence);
  return {
    review: workflowReviewStatus(options.evidence.reviewState),
    requiredChecks: workflowRequiredChecksStatus(checkClassification.status),
    baseStatus: workflowBaseStatus(options.evidence.baseStatus),
    mergeability: workflowMergeability(options.evidence.mergeability),
    mergeQueue,
    validationMode:
      mergeQueue === "available" || mergeQueue === "queued"
        ? "merge_queue"
        : "strict_checks",
  };
}

function providerEvidenceItems(options: {
  context: NexusGitWorkflowContext;
  attachment: NexusGitWorkflowProviderEvidenceAttachment;
  evidence: NexusPublicationProviderEvidence;
  facts: NexusGitWorkflowProviderEvidenceFacts;
}): NexusGitWorkflowPlanStatusEvidence[] {
  const checkClassification = classifyNexusPublicationProviderEvidenceChecks({
    evidence: options.evidence,
    requiredChecks: options.context.publication.greenMain?.requiredChecks ?? [],
  });
  const items: NexusGitWorkflowPlanStatusEvidence[] = [
    {
      id: "provider-pull-request",
      status: "present",
      summary: options.attachment.summary,
    },
    providerReviewEvidence(options.facts.review),
    {
      id: "required-checks",
      status: requiredChecksEvidenceStatus(options.facts.requiredChecks),
      summary: requiredChecksEvidenceSummary(options.facts.requiredChecks),
    },
    {
      id: "provider-base-status",
      status: providerFactEvidenceStatus(options.facts.baseStatus),
      summary: `Provider base status is ${options.facts.baseStatus}.`,
    },
    {
      id: "provider-mergeability",
      status: providerFactEvidenceStatus(options.facts.mergeability),
      summary: `Provider mergeability is ${options.facts.mergeability}.`,
    },
    {
      id: "merge-queue",
      status: options.facts.mergeQueue === "unknown" ? "warning" : "present",
      summary: `Provider merge queue status is ${options.facts.mergeQueue}.`,
    },
  ];
  return items.map((item) =>
    item.id === "required-checks" && options.facts.requiredChecks === "passed"
      ? {
          ...item,
          summary: checkClassification.message,
        }
      : item
  );
}

function providerReviewEvidence(
  review: NexusGitWorkflowProviderEvidenceFacts["review"],
): NexusGitWorkflowPlanStatusEvidence {
  if (review === "approved") {
    return {
      id: "provider-review",
      status: "present",
      summary: "Provider review is approved.",
    };
  }
  if (review === "changes_requested") {
    return {
      id: "provider-review",
      status: "warning",
      summary: "Provider review requested changes.",
    };
  }
  return {
    id: "provider-review",
    status: "missing",
    summary: `Provider review is ${review}.`,
  };
}

function providerEvidenceGaps(
  evidence: NexusGitWorkflowPlanStatusEvidence[],
): string[] {
  return evidence
    .filter((item) => item.status !== "present")
    .map((item) => item.summary);
}

function providerEvidenceBlockers(
  facts: NexusGitWorkflowProviderEvidenceFacts,
): string[] {
  const blockers: string[] = [];
  if (facts.review === "changes_requested") {
    blockers.push("Provider review requested changes.");
  }
  if (facts.requiredChecks === "failed") {
    blockers.push("Required checks failed.");
  }
  if (facts.requiredChecks === "stale") {
    blockers.push("Required checks are stale.");
  }
  return blockers;
}

function providerEvidenceAttachmentBlockers(
  attachment: NexusGitWorkflowProviderEvidenceAttachment,
): string[] {
  return attachment.status === "credential_error" ||
    attachment.status === "rate_limited" ||
    attachment.status === "provider_error" ||
    attachment.status === "insufficient_context"
    ? [attachment.summary]
    : [];
}

function workflowReviewStatus(
  reviewState: NexusPublicationProviderEvidence["reviewState"],
): NexusGitWorkflowProviderEvidenceFacts["review"] {
  if (reviewState === "approved") {
    return "approved";
  }
  if (reviewState === "changes_requested" || reviewState === "rejected") {
    return "changes_requested";
  }
  if (reviewState === "waiting_for_approval" || reviewState === "timed_out") {
    return "pending";
  }
  return "unknown";
}

function workflowRequiredChecksStatus(
  status: ReturnType<typeof classifyNexusPublicationProviderEvidenceChecks>["status"],
): NexusGitWorkflowRequiredChecksStatus {
  if (status === "success" || status === "not_required") {
    return "passed";
  }
  if (status === "pending") {
    return "pending";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "stale") {
    return "stale";
  }
  if (status === "missing") {
    return "missing";
  }
  return "unknown";
}

function workflowBaseStatus(
  status: NexusPublicationProviderEvidence["baseStatus"],
): NexusGitWorkflowProviderBaseStatus {
  if (status === "current") {
    return "up_to_date";
  }
  if (status === "behind" || status === "diverged") {
    return status;
  }
  return "unknown";
}

function workflowMergeability(
  mergeability: NexusPublicationProviderEvidence["mergeability"],
): NexusGitWorkflowProviderMergeability {
  if (mergeability === "mergeable") {
    return "mergeable";
  }
  if (mergeability === "conflicting" || mergeability === "blocked") {
    return "conflicting";
  }
  return "unknown";
}

function workflowMergeQueueStatus(
  evidence: NexusPublicationProviderEvidence,
): NexusGitWorkflowMergeQueueStatus {
  const value = stringMetadata(evidence.metadata.mergeQueue) ??
    stringMetadata(evidence.metadata.mergeQueueStatus) ??
    stringMetadata(evidence.metadata.mergeableState);
  const normalized = value?.trim().toLowerCase();
  if (normalized === "queued" || normalized === "has_queue") {
    return "queued";
  }
  if (normalized === "available" || normalized === "enabled") {
    return "available";
  }
  if (normalized === "unavailable" || normalized === "disabled") {
    return "unavailable";
  }
  return "unknown";
}

function requiredChecksEvidenceStatus(
  status: NexusGitWorkflowRequiredChecksStatus,
): NexusGitWorkflowEvidenceStatus {
  if (status === "passed") {
    return "present";
  }
  return status === "failed" || status === "stale" ? "warning" : "missing";
}

function requiredChecksEvidenceSummary(
  status: NexusGitWorkflowRequiredChecksStatus,
): string {
  if (status === "passed") {
    return "Required checks passed.";
  }
  if (status === "failed") {
    return "Required checks failed.";
  }
  if (status === "stale") {
    return "Required checks are stale.";
  }
  return `Required checks are ${status}.`;
}

function providerFactEvidenceStatus(value: string): NexusGitWorkflowEvidenceStatus {
  return value === "unknown" ? "warning" : "present";
}

function summarizePullRequest(
  pullRequest: NexusForgePullRequestResult,
): NexusGitWorkflowProviderEvidenceAttachment["pullRequest"] {
  return {
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    title: pullRequest.title,
  };
}

function providerEvidenceErrorAttachment(
  error: unknown,
): NexusGitWorkflowProviderEvidenceAttachment {
  if (error instanceof NexusProviderCredentialBrokerError) {
    return {
      requested: true,
      status: "credential_error",
      summary: `Provider evidence credentials are unavailable: ${error.message}`,
      pullRequest: null,
      evidence: null,
    };
  }
  if (error instanceof NexusForgePublicationError) {
    const rateLimited = error.code === "provider_request_failed" &&
      /rate limit/iu.test(error.message);
    return {
      requested: true,
      status: rateLimited
        ? "rate_limited"
        : error.code === "missing_credential"
          ? "credential_error"
          : "provider_error",
      summary: `Provider evidence collection failed: ${error.message}`,
      pullRequest: null,
      evidence: null,
    };
  }
  return {
    requested: true,
    status: "provider_error",
    summary: `Provider evidence collection failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    pullRequest: null,
    evidence: null,
  };
}

function stringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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
  if (options.mode === "status" && options.run) {
    commands.push({
      id: "advance-workflow",
      command: gitWorkflowAdvanceCommand(options),
      summary:
        "Advance the recorded workflow run after attaching fresh provider and branch evidence.",
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

function gitWorkflowAdvanceCommand(options: {
  context: NexusGitWorkflowContext;
  run: NexusGitWorkflowRunRecord | null;
  workItemId: string | null;
  branchName: string | null;
}): string {
  return [
    "dev-nexus",
    "git-workflow",
    "advance",
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

function uniqueGates(gates: NexusGitWorkflowGate[]): NexusGitWorkflowGate[] {
  return [...new Set(gates)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}
