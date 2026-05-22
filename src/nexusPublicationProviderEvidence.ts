import type { NexusCiTierId } from "./nexusCiTierPolicy.js";

export type NexusPublicationProviderEvidenceSourceKind =
  | "branch"
  | "pull_request"
  | "candidate_branch"
  | "merge_queue_group"
  | "scheduled_validation"
  | "unknown";

export type NexusPublicationProviderCheckStatus =
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "unknown";

export type NexusPublicationProviderRequiredCheckStatus =
  | NexusPublicationProviderCheckStatus
  | "missing";

export type NexusPublicationProviderEvidenceStatus =
  | "not_required"
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unavailable";

export type NexusPublicationProviderMergeability =
  | "mergeable"
  | "conflicting"
  | "blocked"
  | "unknown";

export type NexusPublicationProviderBranchPolicy =
  | "clear"
  | "pending"
  | "blocked"
  | "unknown";

export type NexusPublicationProviderReviewState =
  | "approved"
  | "waiting_for_approval"
  | "changes_requested"
  | "rejected"
  | "timed_out"
  | "unknown";

export type NexusPublicationProviderBaseStatus =
  | "current"
  | "behind"
  | "diverged"
  | "unknown";

export interface NexusPublicationProviderReviewTargetInput {
  kind?: string | null;
  id?: string | number | null;
  number?: string | number | null;
  url?: string | null;
  title?: string | null;
}

export interface NexusPublicationProviderReviewTarget {
  kind: string;
  id: string | null;
  number: number | null;
  url: string | null;
  title: string | null;
}

export interface NexusPublicationProviderCheckInput {
  name: string;
  status?: string | null;
  state?: string | null;
  conclusion?: string | null;
  bucket?: string | null;
  workflow?: string | null;
  workflowName?: string | null;
  jobName?: string | null;
  url?: string | null;
  link?: string | null;
  detailsUrl?: string | null;
  runId?: string | number | null;
  workflowRunId?: string | number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  stale?: boolean | null;
  unknown?: boolean | null;
}

export interface NexusPublicationProviderEvidenceInput {
  provider?: string | null;
  sourceKind?: string | null;
  reviewTarget?:
    | NexusPublicationProviderReviewTargetInput
    | string
    | number
    | null;
  branchName?: string | null;
  headBranch?: string | null;
  headRef?: string | null;
  headCommit?: string | null;
  headSha?: string | null;
  targetBranch?: string | null;
  sourceUrl?: string | null;
  url?: string | null;
  intendedCiTier?: NexusCiTierId | string | null;
  reviewState?: string | null;
  reviewDecision?: string | null;
  review?: string | null;
  checks?: NexusPublicationProviderCheckInput[];
  mergeability?: string | boolean | null;
  branchPolicy?: string | boolean | null;
  baseStatus?: string | boolean | null;
  baseStale?: boolean | null;
  behindBase?: boolean | null;
  stale?: boolean | null;
  unknown?: boolean | null;
  collectedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NexusPublicationProviderCheckEvidence {
  name: string;
  status: NexusPublicationProviderCheckStatus;
  sourceState: string | null;
  sourceConclusion: string | null;
  bucket: string | null;
  workflowName: string | null;
  jobName: string | null;
  runId: string | null;
  url: string | null;
  stale: boolean;
  unknown: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface NexusPublicationProviderEvidence {
  provider: string;
  sourceKind: NexusPublicationProviderEvidenceSourceKind;
  sourceUrl: string | null;
  reviewTarget: NexusPublicationProviderReviewTarget | null;
  headBranch: string | null;
  headRef: string | null;
  headSha: string | null;
  targetBranch: string | null;
  intendedCiTier: NexusCiTierId | string | null;
  reviewState: NexusPublicationProviderReviewState | null;
  checks: NexusPublicationProviderCheckEvidence[];
  mergeability: NexusPublicationProviderMergeability | null;
  branchPolicy: NexusPublicationProviderBranchPolicy | null;
  baseStatus: NexusPublicationProviderBaseStatus | null;
  stale: boolean;
  unknown: boolean;
  collectedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface NexusPublicationProviderRequiredCheckEvidence {
  name: string;
  status: NexusPublicationProviderRequiredCheckStatus;
  sourceState: string | null;
  sourceConclusion: string | null;
  workflowName: string | null;
  jobName: string | null;
  runId: string | null;
  url: string | null;
}

export interface NexusPublicationProviderEvidenceCheckClassification {
  status: NexusPublicationProviderEvidenceStatus;
  requiredChecks: NexusPublicationProviderRequiredCheckEvidence[];
  message: string;
  evidence: NexusPublicationProviderEvidence | null;
}

export interface NexusPublicationProviderEvidenceMatch {
  sourceKind?: NexusPublicationProviderEvidenceSourceKind | null;
  branchName?: string | null;
  headRef?: string | null;
  headSha?: string | null;
  targetBranch?: string | null;
  intendedCiTier?: NexusCiTierId | string | null;
}

const knownSourceKinds: NexusPublicationProviderEvidenceSourceKind[] = [
  "branch",
  "pull_request",
  "candidate_branch",
  "merge_queue_group",
  "scheduled_validation",
  "unknown",
];

export function normalizeNexusPublicationProviderEvidence(
  inputs: NexusPublicationProviderEvidenceInput[] = [],
): NexusPublicationProviderEvidence[] {
  return inputs.map((input) => ({
    provider: clean(input.provider) ?? "generic",
    sourceKind: sourceKind(input),
    sourceUrl: clean(input.sourceUrl) ?? clean(input.url),
    reviewTarget: reviewTarget(input.reviewTarget),
    headBranch: clean(input.headBranch) ?? clean(input.branchName),
    headRef: clean(input.headRef) ?? clean(input.headBranch) ?? clean(input.branchName),
    headSha: clean(input.headSha) ?? clean(input.headCommit),
    targetBranch: clean(input.targetBranch),
    intendedCiTier: clean(input.intendedCiTier),
    reviewState: reviewState(input),
    checks: (input.checks ?? []).map(checkEvidence),
    mergeability: mergeability(input.mergeability),
    branchPolicy: branchPolicy(input.branchPolicy),
    baseStatus: baseStatus(input),
    stale: input.stale === true,
    unknown: input.unknown === true,
    collectedAt: clean(input.collectedAt),
    metadata: input.metadata ? { ...input.metadata } : {},
  }));
}

export function findNexusPublicationProviderEvidence(
  evidence: NexusPublicationProviderEvidence[],
  match: NexusPublicationProviderEvidenceMatch,
): NexusPublicationProviderEvidence | null {
  const candidates = evidence.filter((candidate) => {
    if (match.sourceKind && candidate.sourceKind !== match.sourceKind) {
      return false;
    }
    if (match.targetBranch && candidate.targetBranch !== match.targetBranch) {
      return false;
    }
    if (
      match.intendedCiTier &&
      candidate.intendedCiTier &&
      candidate.intendedCiTier !== match.intendedCiTier
    ) {
      return false;
    }
    return true;
  });

  if (!match.branchName && !match.headRef && !match.headSha) {
    return candidates[0] ?? null;
  }

  return candidates.find((candidate) => matchesRef(candidate, match)) ?? null;
}

export function classifyNexusPublicationProviderEvidenceChecks(options: {
  evidence: NexusPublicationProviderEvidence | null;
  requiredChecks: string[];
}): NexusPublicationProviderEvidenceCheckClassification {
  if (options.requiredChecks.length === 0) {
    return {
      status: "not_required",
      requiredChecks: [],
      message: "selected CI tier has no required provider checks",
      evidence: options.evidence,
    };
  }
  if (!options.evidence) {
    return {
      status: "unavailable",
      requiredChecks: options.requiredChecks.map((name) => ({
        name,
        status: "unknown",
        sourceState: null,
        sourceConclusion: null,
        workflowName: null,
        jobName: null,
        runId: null,
        url: null,
      })),
      message: "provider check evidence is unavailable",
      evidence: null,
    };
  }

  const requiredChecks = options.requiredChecks.map((name) => {
    const check = options.evidence?.checks.find((candidate) =>
      candidate.name === name
    );
    if (!check) {
      return missingRequiredCheck(name);
    }
    return {
      name,
      status: options.evidence?.stale ? "stale" : check.status,
      sourceState: check.sourceState,
      sourceConclusion: check.sourceConclusion,
      workflowName: check.workflowName,
      jobName: check.jobName,
      runId: check.runId,
      url: check.url,
    } satisfies NexusPublicationProviderRequiredCheckEvidence;
  });
  const status = evidenceStatus(requiredChecks, options.evidence);

  return {
    status,
    requiredChecks,
    message: evidenceMessage(status),
    evidence: options.evidence,
  };
}

function matchesRef(
  evidence: NexusPublicationProviderEvidence,
  match: NexusPublicationProviderEvidenceMatch,
): boolean {
  if (
    match.headSha &&
    evidence.headSha &&
    evidence.headSha === match.headSha
  ) {
    return true;
  }
  const branchName = clean(match.branchName);
  if (
    branchName &&
    (evidence.headBranch === branchName || evidence.headRef === branchName)
  ) {
    return true;
  }
  const headRef = clean(match.headRef);
  return Boolean(
    headRef &&
      (evidence.headRef === headRef || evidence.headBranch === headRef),
  );
}

function checkEvidence(
  input: NexusPublicationProviderCheckInput,
): NexusPublicationProviderCheckEvidence {
  const sourceState = clean(input.state) ?? clean(input.status);
  const sourceConclusion = clean(input.conclusion);
  return {
    name: input.name,
    status: checkStatus(input),
    sourceState,
    sourceConclusion,
    bucket: clean(input.bucket),
    workflowName: clean(input.workflowName) ?? clean(input.workflow),
    jobName: clean(input.jobName),
    runId: runId(input),
    url: checkUrl(input),
    stale: input.stale === true,
    unknown: input.unknown === true,
    startedAt: clean(input.startedAt),
    completedAt: clean(input.completedAt),
  };
}

function checkStatus(
  input: NexusPublicationProviderCheckInput,
): NexusPublicationProviderCheckStatus {
  if (input.stale || normalized(input.status) === "stale") {
    return "stale";
  }
  if (input.unknown) {
    return "unknown";
  }

  const tokens = [
    normalized(input.bucket),
    normalized(input.conclusion),
    normalized(input.state),
    normalized(input.status),
  ];
  if (
    tokens.some((token) =>
      token === "pass" ||
      token === "success" ||
      token === "neutral" ||
      token === "skipped"
    )
  ) {
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
      ].includes(token ?? ""),
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
      ].includes(token ?? ""),
    )
  ) {
    return "pending";
  }
  if (tokens.some((token) => token === "stale")) {
    return "stale";
  }

  return "unknown";
}

function evidenceStatus(
  checks: NexusPublicationProviderRequiredCheckEvidence[],
  evidence: NexusPublicationProviderEvidence,
): NexusPublicationProviderEvidenceStatus {
  if (checks.some((check) => check.status === "failed")) {
    return "failed";
  }
  if (evidence.stale || checks.some((check) => check.status === "stale")) {
    return "stale";
  }
  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }
  if (checks.some((check) => check.status === "missing")) {
    return "missing";
  }
  if (
    evidence.unknown ||
    checks.some((check) => check.status === "unknown")
  ) {
    return "unavailable";
  }
  return "success";
}

function evidenceMessage(status: NexusPublicationProviderEvidenceStatus): string {
  if (status === "success") {
    return "all required checks are successful";
  }
  if (status === "failed") {
    return "one or more required checks failed";
  }
  if (status === "stale") {
    return "one or more required checks are stale";
  }
  if (status === "pending") {
    return "one or more required checks are pending";
  }
  if (status === "missing") {
    return "one or more required checks are missing";
  }
  return "required check evidence is incomplete";
}

function sourceKind(
  input: NexusPublicationProviderEvidenceInput,
): NexusPublicationProviderEvidenceSourceKind {
  const explicit = normalizeSourceKind(input.sourceKind);
  if (explicit !== "unknown") {
    return explicit;
  }
  const target = reviewTarget(input.reviewTarget);
  if (target?.kind === "pull_request" || target?.kind === "merge_request") {
    return "pull_request";
  }
  const branch = clean(input.headBranch) ?? clean(input.branchName);
  if (branch && /^candidate\//u.test(branch)) {
    return "candidate_branch";
  }
  return branch ? "branch" : "unknown";
}

function normalizeSourceKind(
  value: string | null | undefined,
): NexusPublicationProviderEvidenceSourceKind {
  const token = normalized(value);
  if (!token) {
    return "unknown";
  }
  if (token === "pr" || token === "pullrequest") {
    return "pull_request";
  }
  if (token === "merge_request" || token === "mr") {
    return "pull_request";
  }
  if (token === "merge_group" || token === "merge_queue") {
    return "merge_queue_group";
  }
  if (token === "schedule" || token === "scheduled") {
    return "scheduled_validation";
  }
  return knownSourceKinds.includes(token as NexusPublicationProviderEvidenceSourceKind)
    ? (token as NexusPublicationProviderEvidenceSourceKind)
    : "unknown";
}

function reviewTarget(
  input:
    | NexusPublicationProviderReviewTargetInput
    | string
    | number
    | null
    | undefined,
): NexusPublicationProviderReviewTarget | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === "number" || typeof input === "string") {
    const text = String(input).trim();
    if (!text) {
      return null;
    }
    return {
      kind: "pull_request",
      id: text,
      number: parseNumber(text),
      url: text.startsWith("http") ? text : null,
      title: null,
    };
  }

  return {
    kind: clean(input.kind) ?? "unknown",
    id: input.id === null || input.id === undefined
      ? null
      : String(input.id).trim() || null,
    number: parseNumber(input.number),
    url: clean(input.url),
    title: clean(input.title),
  };
}

function mergeability(
  value: string | boolean | null | undefined,
): NexusPublicationProviderMergeability | null {
  if (value === true) {
    return "mergeable";
  }
  if (value === false) {
    return "blocked";
  }
  const token = normalized(value);
  if (!token) {
    return null;
  }
  if (["mergeable", "clean", "can_be_merged"].includes(token)) {
    return "mergeable";
  }
  if (["conflicting", "conflict", "dirty"].includes(token)) {
    return "conflicting";
  }
  if (["blocked", "behind", "draft"].includes(token)) {
    return "blocked";
  }
  return "unknown";
}

function branchPolicy(
  value: string | boolean | null | undefined,
): NexusPublicationProviderBranchPolicy | null {
  if (value === true) {
    return "clear";
  }
  if (value === false) {
    return "blocked";
  }
  const token = normalized(value);
  if (!token) {
    return null;
  }
  if (["clear", "pass", "passed", "success", "satisfied"].includes(token)) {
    return "clear";
  }
  if (["pending", "waiting", "expected"].includes(token)) {
    return "pending";
  }
  if (["blocked", "fail", "failed", "failure", "missing"].includes(token)) {
    return "blocked";
  }
  return "unknown";
}

function reviewState(
  input: NexusPublicationProviderEvidenceInput,
): NexusPublicationProviderReviewState | null {
  const token = normalized(
    input.reviewState ?? input.reviewDecision ?? input.review,
  );
  if (!token) {
    return null;
  }
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

function baseStatus(
  input: NexusPublicationProviderEvidenceInput,
): NexusPublicationProviderBaseStatus | null {
  if (input.behindBase === true || input.baseStale === true) {
    return "behind";
  }
  if (input.behindBase === false || input.baseStale === false) {
    return "current";
  }
  const value = input.baseStatus;
  if (value === true) {
    return "current";
  }
  if (value === false) {
    return "behind";
  }
  const token = normalized(value);
  if (!token) {
    return null;
  }
  if (["current", "up_to_date", "up_to_base", "fresh"].includes(token)) {
    return "current";
  }
  if (["behind", "stale", "out_of_date", "base_stale"].includes(token)) {
    return "behind";
  }
  if (["diverged", "ahead_and_behind"].includes(token)) {
    return "diverged";
  }
  return "unknown";
}

function missingRequiredCheck(
  name: string,
): NexusPublicationProviderRequiredCheckEvidence {
  return {
    name,
    status: "missing",
    sourceState: null,
    sourceConclusion: null,
    workflowName: null,
    jobName: null,
    runId: null,
    url: null,
  };
}

function checkUrl(input: NexusPublicationProviderCheckInput): string | null {
  return clean(input.detailsUrl) ?? clean(input.link) ?? clean(input.url);
}

function runId(input: NexusPublicationProviderCheckInput): string | null {
  const explicit = input.workflowRunId ?? input.runId;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return String(explicit).trim();
  }
  const url = checkUrl(input);
  const match = url ? /\/actions\/runs\/([0-9]+)/u.exec(url) : null;
  return match?.[1] ?? null;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clean(value: string | number | null | undefined): string | null {
  const text = value === null || value === undefined ? null : String(value).trim();
  return text ? text : null;
}

function normalized(value: string | boolean | null | undefined): string | null {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value?.trim().toLowerCase().replace(/[\s-]+/gu, "_") || null;
}
