import type {
  NexusAuthorityBranchPolicySignal,
  NexusAuthorityIssueDesignSignal,
  NexusAuthorityMergeabilitySignal,
  NexusAuthorityProviderChecksSignal,
  NexusAuthorityProviderState,
  NexusAuthorityPullRequestReviewSignal,
} from "./nexusAuthority.js";

export const nexusAuthorityProviderNeutralSignals = [
  "unknown",
  "waiting_for_approval",
  "approved",
  "changes_requested",
  "rejected",
  "timed_out",
  "checks_pending",
  "checks_stale",
  "checks_failed",
  "checks_passed",
  "branch_policy_blocked",
  "clear",
  "mergeable",
  "merge_conflict",
] as const;

export type NexusAuthorityProviderNeutralSignal =
  typeof nexusAuthorityProviderNeutralSignals[number];

export type NexusAuthorityProviderSignalCategory =
  | "pull_request_review"
  | "checks"
  | "mergeability"
  | "branch_policy"
  | "issue_design";

export interface NexusAuthorityProviderSignalRecord {
  category: NexusAuthorityProviderSignalCategory;
  signal: NexusAuthorityProviderNeutralSignal;
  source: string;
  detail?: string | null;
}

export interface NexusAuthorityProviderSignalOwnership {
  assignedActorIds: string[];
  expectedResponderIds: string[];
}

export interface NexusAuthorityProviderSignalSummary {
  provider: "github" | "gitlab" | "jira";
  providerState: NexusAuthorityProviderState;
  signals: NexusAuthorityProviderSignalRecord[];
  ownership: NexusAuthorityProviderSignalOwnership;
  warnings: string[];
}

export interface NexusMockAuthorityComment {
  body?: string | null;
  decision?: string | null;
  author?: string | null;
}

export interface NexusMockAuthorityIssueState {
  labels?: string[];
  assignees?: string[];
  expectedResponders?: string[];
  comments?: NexusMockAuthorityComment[];
  status?: string | null;
  statusCategory?: string | null;
  projectStatus?: string | null;
  decision?: string | null;
}

export interface NexusMockProviderCheck {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

export interface NexusMockGitHubReview {
  state?: string | null;
  author?: string | null;
  submittedAt?: string | null;
}

export interface NexusMockGitHubBranchProtection {
  status?: string | null;
  blocked?: boolean | null;
  blocksMerge?: boolean | null;
  requiresStatusChecks?: boolean | null;
  requiredApprovingReviewCount?: number | null;
}

export interface NexusMockGitHubPullRequestState {
  reviewDecision?: string | null;
  reviews?: NexusMockGitHubReview[];
  requiredChecks?: NexusMockProviderCheck[];
  mergeable?: boolean | null;
  mergeStateStatus?: string | null;
  branchProtection?: NexusMockGitHubBranchProtection | null;
  labels?: string[];
  projectStatus?: string | null;
}

export interface NexusMockGitHubAuthorityState {
  pullRequest?: NexusMockGitHubPullRequestState | null;
  issue?: NexusMockAuthorityIssueState | null;
}

export interface NexusMockGitLabPipelineState {
  status?: string | null;
}

export interface NexusMockGitLabMergeRequestState {
  approvalState?: string | null;
  approvalsRequired?: number | null;
  approvedBy?: string[];
  pipeline?: string | NexusMockGitLabPipelineState | null;
  mergeStatus?: string | null;
  detailedMergeStatus?: string | null;
  hasConflicts?: boolean | null;
  blockingDiscussionsResolved?: boolean | null;
  protectedBranchBlocked?: boolean | null;
  labels?: string[];
  status?: string | null;
}

export interface NexusMockGitLabAuthorityState {
  mergeRequest?: NexusMockGitLabMergeRequestState | null;
  issue?: NexusMockAuthorityIssueState | null;
}

export interface NexusMockJiraIssueState extends NexusMockAuthorityIssueState {
  transitions?: string[];
}

export interface NexusMockJiraAuthorityState {
  issue?: NexusMockJiraIssueState | null;
}

export function mapGitHubAuthoritySignals(
  state: NexusMockGitHubAuthorityState,
): NexusAuthorityProviderSignalSummary {
  const pullRequest = state.pullRequest ?? null;
  const issue = state.issue ?? null;
  const review = githubReviewSignal(pullRequest);
  const checks = providerChecksSignal(
    pullRequest?.requiredChecks,
    pullRequest?.branchProtection?.requiresStatusChecks ?? null,
  );
  const mergeability = githubMergeabilitySignal(pullRequest);
  const issueDesign = issueDesignSignal(issue);
  const branchPolicy = githubBranchPolicySignal({
    pullRequest,
    review,
    checks,
    mergeability,
  });
  const signals = compactSignals([
    signalRecord("pull_request_review", review, "github.pull_request.reviews"),
    signalRecord("checks", checks, "github.pull_request.required_checks"),
    signalRecord("mergeability", mergeability, "github.pull_request.mergeable"),
    signalRecord("branch_policy", branchPolicy, "github.branch_protection"),
    signalRecord("issue_design", issueDesign, "github.issue"),
  ]);
  const ownership = issueOwnership(issue);

  return {
    provider: "github",
    providerState: {
      pullRequest: {
        review,
        checks,
        mergeability,
        branchPolicy,
      },
      issue: {
        designApproval: issueDesign,
        assignedActorIds: ownership.assignedActorIds,
        casualCommentCount: casualCommentCount(issue?.comments),
        silent: !issue?.comments?.length,
      },
      branchPolicy,
    },
    signals,
    ownership,
    warnings: [],
  };
}

export function mapGitLabAuthoritySignals(
  state: NexusMockGitLabAuthorityState,
): NexusAuthorityProviderSignalSummary {
  const mergeRequest = state.mergeRequest ?? null;
  const issue = state.issue ?? null;
  const review = gitLabApprovalSignal(mergeRequest);
  const checks = gitLabChecksSignal(mergeRequest?.pipeline);
  const mergeability = gitLabMergeabilitySignal(mergeRequest);
  const issueDesign = issueDesignSignal(issue);
  const branchPolicy = gitLabBranchPolicySignal({
    mergeRequest,
    review,
    checks,
    mergeability,
  });
  const signals = compactSignals([
    signalRecord("pull_request_review", review, "gitlab.merge_request.approvals"),
    signalRecord("checks", checks, "gitlab.merge_request.pipeline"),
    signalRecord("mergeability", mergeability, "gitlab.merge_request.merge_status"),
    signalRecord("branch_policy", branchPolicy, "gitlab.protected_branch"),
    signalRecord("issue_design", issueDesign, "gitlab.issue"),
  ]);
  const ownership = issueOwnership(issue);

  return {
    provider: "gitlab",
    providerState: {
      pullRequest: {
        review,
        checks,
        mergeability,
        branchPolicy,
      },
      issue: {
        designApproval: issueDesign,
        assignedActorIds: ownership.assignedActorIds,
        casualCommentCount: casualCommentCount(issue?.comments),
        silent: !issue?.comments?.length,
      },
      branchPolicy,
    },
    signals,
    ownership,
    warnings: [],
  };
}

export function mapJiraAuthoritySignals(
  state: NexusMockJiraAuthorityState,
): NexusAuthorityProviderSignalSummary {
  const issue = state.issue ?? null;
  const issueDesign = jiraIssueDesignSignal(issue);
  const ownership = issueOwnership(issue);
  const signals = compactSignals([
    signalRecord("issue_design", issueDesign, "jira.issue.workflow"),
  ]);

  return {
    provider: "jira",
    providerState: {
      issue: {
        designApproval: issueDesign,
        assignedActorIds: ownership.assignedActorIds,
        casualCommentCount: casualCommentCount(issue?.comments),
        silent: !issue?.comments?.length,
      },
    },
    signals,
    ownership,
    warnings: [],
  };
}

function githubReviewSignal(
  pullRequest: NexusMockGitHubPullRequestState | null,
): NexusAuthorityPullRequestReviewSignal {
  const decision = pullRequestReviewSignalFromToken(pullRequest?.reviewDecision);
  if (decision !== "unknown") {
    return decision;
  }

  const reviewSignals = (pullRequest?.reviews ?? [])
    .map((review) => pullRequestReviewSignalFromToken(review.state))
    .filter((signal) => signal !== "unknown");
  const blocking = firstSignal(reviewSignals, [
    "rejected",
    "changes_requested",
    "timed_out",
  ]);
  if (blocking) {
    return blocking;
  }

  const approvalCount = reviewSignals.filter((signal) => signal === "approved").length;
  const requiredCount = pullRequest?.branchProtection?.requiredApprovingReviewCount;
  if (approvalCount > 0) {
    return requiredCount && approvalCount < requiredCount
      ? "waiting_for_approval"
      : "approved";
  }
  if (requiredCount && requiredCount > 0) {
    return "waiting_for_approval";
  }
  return reviewSignals.length > 0 ? "waiting_for_approval" : "unknown";
}

function gitLabApprovalSignal(
  mergeRequest: NexusMockGitLabMergeRequestState | null,
): NexusAuthorityPullRequestReviewSignal {
  const explicit = pullRequestReviewSignalFromToken(mergeRequest?.approvalState);
  if (explicit !== "unknown") {
    return explicit;
  }

  const required = mergeRequest?.approvalsRequired ?? null;
  const approvedCount = mergeRequest?.approvedBy?.length ?? 0;
  if (required !== null && required <= 0) {
    return "approved";
  }
  if (required !== null && approvedCount >= required) {
    return "approved";
  }
  if (required !== null && approvedCount < required) {
    return "waiting_for_approval";
  }
  return approvedCount > 0 ? "approved" : "unknown";
}

function providerChecksSignal(
  checks: NexusMockProviderCheck[] | undefined,
  requiresStatusChecks: boolean | null,
): NexusAuthorityProviderChecksSignal {
  if (!checks || checks.length === 0) {
    return requiresStatusChecks === false ? "checks_passed" : "unknown";
  }

  const signals = checks.map(checkSignal);
  if (signals.includes("checks_failed")) {
    return "checks_failed";
  }
  if (signals.includes("checks_stale")) {
    return "checks_stale";
  }
  if (signals.includes("checks_pending")) {
    return "checks_pending";
  }
  return "checks_passed";
}

function checkSignal(check: NexusMockProviderCheck): NexusAuthorityProviderChecksSignal {
  const token = normalizedToken(check.conclusion ?? check.status ?? check.state);
  if (
    [
      "failure",
      "failed",
      "error",
      "cancelled",
      "canceled",
      "timed_out",
      "action_required",
    ].includes(token)
  ) {
    return "checks_failed";
  }
  if (
    [
      "stale",
      "outdated",
      "expired",
    ].includes(token)
  ) {
    return "checks_stale";
  }
  if (
    [
      "pending",
      "queued",
      "requested",
      "waiting",
      "in_progress",
      "running",
      "created",
    ].includes(token)
  ) {
    return "checks_pending";
  }
  if (["success", "passed", "ok", "neutral", "skipped"].includes(token)) {
    return "checks_passed";
  }
  return "checks_pending";
}

function gitLabChecksSignal(
  pipeline: string | NexusMockGitLabPipelineState | null | undefined,
): NexusAuthorityProviderChecksSignal {
  const raw = typeof pipeline === "string" ? pipeline : pipeline?.status;
  const token = normalizedToken(raw);
  if (["success", "passed"].includes(token)) {
    return "checks_passed";
  }
  if (["failed", "failure", "canceled", "cancelled", "skipped"].includes(token)) {
    return "checks_failed";
  }
  if (["pending", "running", "created", "waiting_for_resource", "manual"].includes(token)) {
    return "checks_pending";
  }
  return "unknown";
}

function githubMergeabilitySignal(
  pullRequest: NexusMockGitHubPullRequestState | null,
): NexusAuthorityMergeabilitySignal {
  if (pullRequest?.mergeable === true) {
    return "mergeable";
  }
  if (pullRequest?.mergeable === false) {
    return "merge_conflict";
  }
  const token = normalizedToken(pullRequest?.mergeStateStatus);
  if (["clean", "has_hooks", "unstable"].includes(token)) {
    return "mergeable";
  }
  if (["dirty", "conflicting", "cannot_be_merged"].includes(token)) {
    return "merge_conflict";
  }
  return "unknown";
}

function gitLabMergeabilitySignal(
  mergeRequest: NexusMockGitLabMergeRequestState | null,
): NexusAuthorityMergeabilitySignal {
  if (mergeRequest?.hasConflicts === true) {
    return "merge_conflict";
  }
  const token = normalizedToken(
    mergeRequest?.detailedMergeStatus ?? mergeRequest?.mergeStatus,
  );
  if (["mergeable", "can_be_merged", "not_open", "unchecked"].includes(token)) {
    return "mergeable";
  }
  if (["cannot_be_merged", "conflict", "conflicts"].includes(token)) {
    return "merge_conflict";
  }
  return "unknown";
}

function githubBranchPolicySignal(options: {
  pullRequest: NexusMockGitHubPullRequestState | null;
  review: NexusAuthorityPullRequestReviewSignal;
  checks: NexusAuthorityProviderChecksSignal;
  mergeability: NexusAuthorityMergeabilitySignal;
}): NexusAuthorityBranchPolicySignal {
  const branchProtection = options.pullRequest?.branchProtection ?? null;
  const status = branchPolicySignalFromToken(branchProtection?.status);
  if (status !== "unknown") {
    return status;
  }
  const labels = options.pullRequest?.labels ?? [];
  if (
    branchProtection?.blocked === true ||
    branchProtection?.blocksMerge === true ||
    hasDecisionLabel(labels, "branch_policy_blocked") ||
    ["blocked", "behind"].includes(normalizedToken(options.pullRequest?.mergeStateStatus))
  ) {
    return "branch_policy_blocked";
  }
  if (
    options.review === "approved" &&
    options.checks === "checks_passed" &&
    options.mergeability === "mergeable"
  ) {
    return "clear";
  }
  return "unknown";
}

function gitLabBranchPolicySignal(options: {
  mergeRequest: NexusMockGitLabMergeRequestState | null;
  review: NexusAuthorityPullRequestReviewSignal;
  checks: NexusAuthorityProviderChecksSignal;
  mergeability: NexusAuthorityMergeabilitySignal;
}): NexusAuthorityBranchPolicySignal {
  const labels = options.mergeRequest?.labels ?? [];
  if (
    options.mergeRequest?.protectedBranchBlocked === true ||
    options.mergeRequest?.blockingDiscussionsResolved === false ||
    hasDecisionLabel(labels, "branch_policy_blocked")
  ) {
    return "branch_policy_blocked";
  }
  if (
    options.review === "approved" &&
    options.checks === "checks_passed" &&
    options.mergeability === "mergeable"
  ) {
    return "clear";
  }
  return "unknown";
}

function issueDesignSignal(
  issue: NexusMockAuthorityIssueState | null | undefined,
): NexusAuthorityIssueDesignSignal {
  const candidates = [
    issue?.decision,
    issue?.projectStatus,
    issue?.status,
    issue?.statusCategory,
    ...decisionLabels(issue?.labels ?? []),
    ...decisionComments(issue?.comments ?? []),
  ];
  for (const candidate of candidates) {
    const signal = issueDesignSignalFromToken(candidate);
    if (signal !== "unknown") {
      return signal;
    }
  }
  return "unknown";
}

function jiraIssueDesignSignal(
  issue: NexusMockJiraIssueState | null | undefined,
): NexusAuthorityIssueDesignSignal {
  const candidates = [
    issue?.decision,
    ...decisionLabels(issue?.labels ?? []),
    ...decisionComments(issue?.comments ?? []),
    ...(issue?.transitions ?? []).slice().reverse(),
    issue?.status,
    issue?.statusCategory,
  ];
  for (const candidate of candidates) {
    const signal = issueDesignSignalFromToken(candidate);
    if (signal !== "unknown") {
      return signal;
    }
  }

  return statusCategoryDesignSignal(issue?.statusCategory);
}

function issueOwnership(
  issue: NexusMockAuthorityIssueState | null | undefined,
): NexusAuthorityProviderSignalOwnership {
  return {
    assignedActorIds: dedupeStrings(issue?.assignees ?? []),
    expectedResponderIds: dedupeStrings(issue?.expectedResponders ?? []),
  };
}

function statusCategoryDesignSignal(
  statusCategory: string | null | undefined,
): NexusAuthorityIssueDesignSignal {
  const token = normalizedToken(statusCategory);
  if (token === "done") {
    return "approved";
  }
  if (token === "indeterminate" || token === "in_progress") {
    return "waiting_for_approval";
  }
  return "unknown";
}

function pullRequestReviewSignalFromToken(
  value: string | null | undefined,
): NexusAuthorityPullRequestReviewSignal {
  const token = normalizedToken(value);
  if (["approved", "approve", "approval_approved"].includes(token)) {
    return "approved";
  }
  if (["changes_requested", "change_requested", "request_changes"].includes(token)) {
    return "changes_requested";
  }
  if (["rejected", "reject", "declined"].includes(token)) {
    return "rejected";
  }
  if (["timed_out", "timeout", "expired"].includes(token)) {
    return "timed_out";
  }
  if (
    [
      "review_required",
      "required",
      "pending",
      "waiting",
      "waiting_for_approval",
      "unapproved",
      "needs_approval",
    ].includes(token)
  ) {
    return "waiting_for_approval";
  }
  return "unknown";
}

function issueDesignSignalFromToken(
  value: string | null | undefined,
): NexusAuthorityIssueDesignSignal {
  const token = normalizedToken(value);
  if (["approved", "approve", "accepted", "done"].includes(token)) {
    return "approved";
  }
  if (["changes_requested", "change_requested", "revision_requested"].includes(token)) {
    return "changes_requested";
  }
  if (["rejected", "reject", "declined", "wont_do", "not_approved"].includes(token)) {
    return "rejected";
  }
  if (["timed_out", "timeout", "expired"].includes(token)) {
    return "timed_out";
  }
  if (
    [
      "waiting",
      "pending",
      "in_review",
      "review",
      "waiting_for_approval",
      "needs_approval",
      "to_do",
    ].includes(token)
  ) {
    return "waiting_for_approval";
  }
  return "unknown";
}

function branchPolicySignalFromToken(
  value: string | null | undefined,
): NexusAuthorityBranchPolicySignal {
  const token = normalizedToken(value);
  if (["clear", "passed", "ok"].includes(token)) {
    return "clear";
  }
  if (["blocked", "branch_policy_blocked", "policy_blocked"].includes(token)) {
    return "branch_policy_blocked";
  }
  return "unknown";
}

function decisionLabels(labels: string[]): string[] {
  return labels
    .map((label) => labelDecisionValue(label))
    .filter((value): value is string => Boolean(value));
}

function labelDecisionValue(label: string): string | null {
  const match = label.trim().match(/^(approval|design|decision)[:/_ -](.+)$/i);
  return match?.[2] ?? null;
}

function hasDecisionLabel(labels: string[], expected: string): boolean {
  const expectedToken = normalizedToken(expected);
  return labels.some((label) => normalizedToken(labelDecisionValue(label)) === expectedToken);
}

function decisionComments(comments: NexusMockAuthorityComment[]): string[] {
  return comments
    .map((comment) => {
      if (comment.decision) {
        return comment.decision;
      }
      const match = comment.body?.match(
        /\b(?:approval|design|decision)\s*[:=]\s*([a-z_ -]+)/i,
      );
      return match?.[1] ?? null;
    })
    .filter((value): value is string => Boolean(value));
}

function casualCommentCount(
  comments: NexusMockAuthorityComment[] | undefined,
): number {
  return comments?.length ?? 0;
}

function signalRecord(
  category: NexusAuthorityProviderSignalCategory,
  signal: NexusAuthorityProviderNeutralSignal,
  source: string,
): NexusAuthorityProviderSignalRecord | null {
  return signal === "unknown" ? null : { category, signal, source };
}

function compactSignals(
  values: Array<NexusAuthorityProviderSignalRecord | null>,
): NexusAuthorityProviderSignalRecord[] {
  return values.filter(
    (value): value is NexusAuthorityProviderSignalRecord => value !== null,
  );
}

function firstSignal<T extends string>(values: T[], preference: T[]): T | null {
  return preference.find((value) => values.includes(value)) ?? null;
}

function normalizedToken(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
