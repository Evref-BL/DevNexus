import type {
  NexusPublicationProviderCheckStatus,
  NexusPublicationProviderEvidence,
  NexusPublicationProviderReviewState,
} from "./nexusPublicationProviderEvidence.js";

export type NexusReviewTransport =
  | "local"
  | "pull_request"
  | "merge_request"
  | "issue"
  | "agent_review"
  | "none";

export type NexusReviewGate =
  | "none"
  | "human_required"
  | "agent_allowed"
  | "provider_approval_required"
  | "code_owner_required"
  | "ci_required"
  | "final_human_approval_required";

export interface NexusReviewRuleMatchConfig {
  branchRole?: string;
  paths?: string[];
  labels?: string[];
  requestedAction?: string;
}

export interface NexusReviewPolicyEntryConfig {
  transport?: NexusReviewTransport;
  gates?: NexusReviewGate[];
}

export interface NexusReviewRuleConfig extends NexusReviewPolicyEntryConfig {
  match?: NexusReviewRuleMatchConfig;
}

export interface NexusReviewPolicyConfig {
  default?: NexusReviewPolicyEntryConfig;
  rules?: NexusReviewRuleConfig[];
}

export interface NexusResolvedReviewPolicyEntry {
  transport: NexusReviewTransport;
  gates: NexusReviewGate[];
}

export interface NexusResolvedReviewRule extends NexusResolvedReviewPolicyEntry {
  match: NexusReviewRuleMatchConfig;
}

export interface NexusResolvedReviewPolicy {
  default: NexusResolvedReviewPolicyEntry;
  rules: NexusResolvedReviewRule[];
}

export interface NexusReviewLocalAuthorization {
  authorized: boolean;
  authorizedAt: string | null;
  branchName: string | null;
  headSha: string | null;
  requestedAction: string | null;
  summary: string | null;
}

export type NexusReviewGateEvidenceSource =
  | "none"
  | "local_authorization"
  | "provider_review"
  | "provider_code_owner_review"
  | "provider_ci"
  | "agent_review";

export type NexusReviewGateStatus =
  | "satisfied"
  | "missing"
  | "blocked"
  | "not_required";

export interface NexusReviewGateResult {
  gate: NexusReviewGate;
  status: NexusReviewGateStatus;
  evidenceSource: NexusReviewGateEvidenceSource;
  message: string;
}

export type NexusReviewPlanStatus =
  | "ready"
  | "review_required"
  | "blocked";

export type NexusReviewPlanNextAction =
  | "proceed"
  | "collect_local_authorization"
  | "open_provider_review"
  | "request_provider_review"
  | "wait_for_ci"
  | "collect_code_owner_review"
  | "run_agent_review"
  | "none";

export interface NexusReviewPlanInput {
  componentId: string;
  policy?: NexusReviewPolicyConfig | NexusResolvedReviewPolicy | null;
  branchRole?: string | null;
  paths?: string[];
  labels?: string[];
  requestedAction?: string | null;
  branchName?: string | null;
  headSha?: string | null;
  localAuthorization?: Partial<NexusReviewLocalAuthorization> | null;
  providerEvidence?: NexusPublicationProviderEvidence | null;
}

export interface NexusReviewPlan {
  componentId: string;
  status: NexusReviewPlanStatus;
  nextAction: NexusReviewPlanNextAction;
  transport: NexusReviewTransport;
  gates: NexusReviewGate[];
  matchedRuleIndex: number | null;
  matchedRule: NexusReviewRuleMatchConfig | null;
  gateResults: NexusReviewGateResult[];
  requiredEvidence: NexusReviewGateEvidenceSource[];
  providerMutations: string[];
  blockedActions: string[];
  context: {
    branchRole: string | null;
    paths: string[];
    labels: string[];
    requestedAction: string | null;
    branchName: string | null;
    headSha: string | null;
  };
}

export class NexusReviewPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusReviewPolicyError";
  }
}

export const defaultNexusReviewPolicyConfig: NexusResolvedReviewPolicy = {
  default: {
    transport: "local",
    gates: ["human_required"],
  },
  rules: [],
};

export function validateNexusReviewPolicyConfig(
  value: unknown,
  pathName = "review",
): NexusReviewPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const defaultEntry = validateReviewPolicyEntry(
    record.default,
    `${pathName}.default`,
  );
  const rules = validateReviewRules(record.rules, `${pathName}.rules`);

  return {
    ...(defaultEntry ? { default: defaultEntry } : {}),
    ...(rules ? { rules } : {}),
  };
}

export function resolveNexusReviewPolicy(
  policy?: NexusReviewPolicyConfig | NexusResolvedReviewPolicy | null,
): NexusResolvedReviewPolicy {
  if (!policy) {
    return cloneResolvedReviewPolicy(defaultNexusReviewPolicyConfig);
  }

  const defaultEntry = mergeReviewEntry(
    defaultNexusReviewPolicyConfig.default,
    policy.default,
  );
  const rules = (policy.rules ?? []).map((rule) => ({
    ...mergeReviewEntry(defaultEntry, rule),
    match: { ...(rule.match ?? {}) },
  }));

  return {
    default: defaultEntry,
    rules,
  };
}

export function buildNexusReviewPlan(input: NexusReviewPlanInput): NexusReviewPlan {
  const policy = resolveNexusReviewPolicy(input.policy);
  const matchContext = {
    branchRole: clean(input.branchRole),
    paths: [...(input.paths ?? [])],
    labels: [...(input.labels ?? [])],
    requestedAction: clean(input.requestedAction),
    branchName: clean(input.branchName),
    headSha: clean(input.headSha),
  };
  const matchedRuleIndex = policy.rules.findIndex((rule) =>
    reviewRuleMatches(rule.match, matchContext),
  );
  const selected =
    matchedRuleIndex >= 0 ? policy.rules[matchedRuleIndex]! : policy.default;
  const gateResults = selected.gates.map((gate) =>
    evaluateReviewGate(gate, {
      requestedAction: matchContext.requestedAction,
      branchName: matchContext.branchName,
      headSha: matchContext.headSha,
      localAuthorization: input.localAuthorization ?? null,
      providerEvidence: input.providerEvidence ?? null,
    }),
  );
  const status = reviewPlanStatus(gateResults);
  const nextAction = reviewPlanNextAction(selected.transport, gateResults);
  const requiredEvidence = unique(
    gateResults
      .filter((result) => result.status !== "satisfied")
      .map((result) => result.evidenceSource)
      .filter((source) => source !== "none"),
  );
  const blockedActions =
    status === "ready"
      ? []
      : [matchContext.requestedAction ?? "publication"];

  return {
    componentId: input.componentId,
    status,
    nextAction,
    transport: selected.transport,
    gates: [...selected.gates],
    matchedRuleIndex: matchedRuleIndex >= 0 ? matchedRuleIndex : null,
    matchedRule:
      matchedRuleIndex >= 0 ? { ...policy.rules[matchedRuleIndex]!.match } : null,
    gateResults,
    requiredEvidence,
    providerMutations: providerMutationsForTransport(selected.transport),
    blockedActions,
    context: matchContext,
  };
}

function evaluateReviewGate(
  gate: NexusReviewGate,
  options: {
    requestedAction: string | null;
    branchName: string | null;
    headSha: string | null;
    localAuthorization: Partial<NexusReviewLocalAuthorization> | null;
    providerEvidence: NexusPublicationProviderEvidence | null;
  },
): NexusReviewGateResult {
  if (gate === "none") {
    return {
      gate,
      status: "not_required",
      evidenceSource: "none",
      message: "review gate is not required",
    };
  }
  if (gate === "agent_allowed") {
    return {
      gate,
      status: "satisfied",
      evidenceSource: "agent_review",
      message: "agent review is allowed by policy",
    };
  }
  if (gate === "human_required" || gate === "final_human_approval_required") {
    return evaluateLocalAuthorizationGate(gate, options);
  }
  if (gate === "provider_approval_required") {
    return evaluateProviderReviewGate(gate, options.providerEvidence?.reviewState ?? null);
  }
  if (gate === "code_owner_required") {
    return evaluateProviderReviewGate(
      gate,
      options.providerEvidence?.reviewState ?? null,
      "provider_code_owner_review",
    );
  }
  return evaluateCiGate(gate, options.providerEvidence);
}

function evaluateLocalAuthorizationGate(
  gate: NexusReviewGate,
  options: {
    requestedAction: string | null;
    branchName: string | null;
    headSha: string | null;
    localAuthorization: Partial<NexusReviewLocalAuthorization> | null;
  },
): NexusReviewGateResult {
  const authorization = options.localAuthorization;
  if (!authorization?.authorized) {
    return {
      gate,
      status: "missing",
      evidenceSource: "local_authorization",
      message: "human authorization is required for the current action",
    };
  }

  const mismatch = authorizationMismatch(authorization, options);
  if (mismatch) {
    return {
      gate,
      status: "blocked",
      evidenceSource: "local_authorization",
      message: mismatch,
    };
  }

  return {
    gate,
    status: "satisfied",
    evidenceSource: "local_authorization",
    message: authorization.authorizedAt
      ? `human authorized this action at ${authorization.authorizedAt}`
      : "human authorized this action",
  };
}

function evaluateProviderReviewGate(
  gate: NexusReviewGate,
  reviewState: NexusPublicationProviderReviewState | null,
  evidenceSource: NexusReviewGateEvidenceSource = "provider_review",
): NexusReviewGateResult {
  if (reviewState === "approved") {
    return {
      gate,
      status: "satisfied",
      evidenceSource,
      message: "provider review is approved",
    };
  }
  if (reviewState === "changes_requested" || reviewState === "rejected") {
    return {
      gate,
      status: "blocked",
      evidenceSource,
      message: `provider review state is ${reviewState}`,
    };
  }

  return {
    gate,
    status: "missing",
    evidenceSource,
    message: reviewState
      ? `provider review state is ${reviewState}`
      : "provider review evidence is required",
  };
}

function evaluateCiGate(
  gate: NexusReviewGate,
  evidence: NexusPublicationProviderEvidence | null,
): NexusReviewGateResult {
  if (!evidence || evidence.checks.length === 0) {
    return {
      gate,
      status: "missing",
      evidenceSource: "provider_ci",
      message: "CI evidence is required",
    };
  }

  const statuses = evidence.checks.map((check) => check.status);
  if (statuses.every((status) => status === "success")) {
    return {
      gate,
      status: "satisfied",
      evidenceSource: "provider_ci",
      message: "all observed provider checks succeeded",
    };
  }
  if (statuses.some(isBlockingCheckStatus)) {
    return {
      gate,
      status: "blocked",
      evidenceSource: "provider_ci",
      message: "one or more provider checks failed or became stale",
    };
  }

  return {
    gate,
    status: "missing",
    evidenceSource: "provider_ci",
    message: "provider checks are pending or unknown",
  };
}

function isBlockingCheckStatus(status: NexusPublicationProviderCheckStatus): boolean {
  return status === "failed" || status === "stale";
}

function reviewPlanStatus(
  gateResults: NexusReviewGateResult[],
): NexusReviewPlanStatus {
  if (gateResults.some((result) => result.status === "blocked")) {
    return "blocked";
  }
  if (gateResults.some((result) => result.status === "missing")) {
    return "review_required";
  }
  return "ready";
}

function reviewPlanNextAction(
  transport: NexusReviewTransport,
  gateResults: NexusReviewGateResult[],
): NexusReviewPlanNextAction {
  if (gateResults.every((result) => result.status !== "missing")) {
    return gateResults.some((result) => result.status === "blocked")
      ? "none"
      : "proceed";
  }
  const missing = gateResults.find((result) => result.status === "missing");
  if (!missing) {
    return "none";
  }
  if (missing.evidenceSource === "local_authorization") {
    return "collect_local_authorization";
  }
  if (missing.evidenceSource === "provider_ci") {
    return "wait_for_ci";
  }
  if (missing.evidenceSource === "provider_code_owner_review") {
    return "collect_code_owner_review";
  }
  if (missing.evidenceSource === "agent_review") {
    return "run_agent_review";
  }
  return transport === "pull_request" || transport === "merge_request"
    ? "request_provider_review"
    : "open_provider_review";
}

function providerMutationsForTransport(transport: NexusReviewTransport): string[] {
  if (transport === "pull_request") {
    return ["create_or_update_pull_request"];
  }
  if (transport === "merge_request") {
    return ["create_or_update_merge_request"];
  }
  if (transport === "issue") {
    return ["create_or_update_issue"];
  }
  return [];
}

function authorizationMismatch(
  authorization: Partial<NexusReviewLocalAuthorization>,
  options: {
    requestedAction: string | null;
    branchName: string | null;
    headSha: string | null;
  },
): string | null {
  if (
    authorization.requestedAction &&
    options.requestedAction &&
    authorization.requestedAction !== options.requestedAction
  ) {
    return `authorization was for action ${authorization.requestedAction}, not ${options.requestedAction}`;
  }
  if (
    authorization.branchName &&
    options.branchName &&
    authorization.branchName !== options.branchName
  ) {
    return `authorization was for branch ${authorization.branchName}, not ${options.branchName}`;
  }
  if (
    authorization.headSha &&
    options.headSha &&
    authorization.headSha !== options.headSha
  ) {
    return `authorization was for head ${authorization.headSha}, not ${options.headSha}`;
  }
  return null;
}

function reviewRuleMatches(
  match: NexusReviewRuleMatchConfig,
  context: {
    branchRole: string | null;
    paths: string[];
    labels: string[];
    requestedAction: string | null;
  },
): boolean {
  if (match.branchRole && match.branchRole !== context.branchRole) {
    return false;
  }
  if (match.requestedAction && match.requestedAction !== context.requestedAction) {
    return false;
  }
  if (match.labels && !match.labels.every((label) => context.labels.includes(label))) {
    return false;
  }
  if (
    match.paths &&
    !context.paths.some((filePath) =>
      match.paths!.some((pattern) => globMatches(pattern, filePath)),
    )
  ) {
    return false;
  }
  return true;
}

function mergeReviewEntry(
  fallback: NexusResolvedReviewPolicyEntry,
  entry?: NexusReviewPolicyEntryConfig,
): NexusResolvedReviewPolicyEntry {
  return {
    transport: entry?.transport ?? fallback.transport,
    gates:
      entry?.gates !== undefined
        ? normalizeGates(entry.gates)
        : [...fallback.gates],
  };
}

function normalizeGates(gates: NexusReviewGate[]): NexusReviewGate[] {
  const uniqueGates = unique(gates);
  if (uniqueGates.includes("none") && uniqueGates.length > 1) {
    throw new NexusReviewPolicyError("review gates must not combine none with other gates");
  }
  return uniqueGates;
}

function validateReviewPolicyEntry(
  value: unknown,
  pathName: string,
): NexusReviewPolicyEntryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = assertRecord(value, pathName);
  const transport = validateReviewTransport(record.transport, `${pathName}.transport`);
  const gates = validateReviewGates(record.gates, `${pathName}.gates`);
  return {
    ...(transport ? { transport } : {}),
    ...(gates ? { gates } : {}),
  };
}

function validateReviewRules(
  value: unknown,
  pathName: string,
): NexusReviewRuleConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusReviewPolicyError(`${pathName} must be an array`);
  }
  return value.map((entry, index) => {
    const entryPath = `${pathName}[${index}]`;
    const record = assertRecord(entry, entryPath);
    return {
      ...validateReviewPolicyEntry(record, entryPath),
      match: validateReviewRuleMatch(record.match, `${entryPath}.match`),
    };
  });
}

function validateReviewRuleMatch(
  value: unknown,
  pathName: string,
): NexusReviewRuleMatchConfig {
  if (value === undefined) {
    return {};
  }
  const record = assertRecord(value, pathName);
  const branchRole = optionalString(record, "branchRole", pathName);
  const paths = optionalStringArray(record, "paths", pathName);
  const labels = optionalStringArray(record, "labels", pathName);
  const requestedAction = optionalString(record, "requestedAction", pathName);
  return {
    ...(branchRole ? { branchRole } : {}),
    ...(paths ? { paths } : {}),
    ...(labels ? { labels } : {}),
    ...(requestedAction ? { requestedAction } : {}),
  };
}

function validateReviewTransport(
  value: unknown,
  pathName: string,
): NexusReviewTransport | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "local" ||
    value === "pull_request" ||
    value === "merge_request" ||
    value === "issue" ||
    value === "agent_review" ||
    value === "none"
  ) {
    return value;
  }
  throw new NexusReviewPolicyError(
    `${pathName} must be local, pull_request, merge_request, issue, agent_review, or none`,
  );
}

function validateReviewGates(
  value: unknown,
  pathName: string,
): NexusReviewGate[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusReviewPolicyError(`${pathName} must be an array`);
  }
  return normalizeGates(
    value.map((entry, index) =>
      validateReviewGate(entry, `${pathName}[${index}]`),
    ),
  );
}

function validateReviewGate(value: unknown, pathName: string): NexusReviewGate {
  if (
    value === "none" ||
    value === "human_required" ||
    value === "agent_allowed" ||
    value === "provider_approval_required" ||
    value === "code_owner_required" ||
    value === "ci_required" ||
    value === "final_human_approval_required"
  ) {
    return value;
  }
  throw new NexusReviewPolicyError(
    `${pathName} must be none, human_required, agent_allowed, provider_approval_required, code_owner_required, ci_required, or final_human_approval_required`,
  );
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusReviewPolicyError(`${pathName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusReviewPolicyError(`${pathName}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NexusReviewPolicyError(`${pathName}.${key} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusReviewPolicyError(
        `${pathName}.${key}[${index}] must be a non-empty string`,
      );
    }
    return entry.trim();
  });
}

function globMatches(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(filePath);
  const regex = new RegExp(`^${globToRegexSource(normalizedPattern)}$`, "u");
  return regex.test(normalizedPath);
}

function globToRegexSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegex(char);
    }
  }
  return source;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/u, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function cloneResolvedReviewPolicy(
  policy: NexusResolvedReviewPolicy,
): NexusResolvedReviewPolicy {
  return {
    default: {
      transport: policy.default.transport,
      gates: [...policy.default.gates],
    },
    rules: policy.rules.map((rule) => ({
      transport: rule.transport,
      gates: [...rule.gates],
      match: {
        ...rule.match,
        ...(rule.match.paths ? { paths: [...rule.match.paths] } : {}),
        ...(rule.match.labels ? { labels: [...rule.match.labels] } : {}),
      },
    })),
  };
}

function clean(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
