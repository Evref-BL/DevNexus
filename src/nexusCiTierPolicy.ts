export type NexusCiTierId =
  | "local_focused"
  | "remote_smoke"
  | "candidate_matrix"
  | "protected_target"
  | "scheduled_drift";

export type NexusCiWorkflowMode =
  | "quick_fix"
  | "heartbeat"
  | "investigation"
  | "cleanup"
  | "release"
  | "manual";

export type NexusCiChangeRisk =
  | "documentation"
  | "metadata"
  | "source"
  | "cross_platform"
  | "release"
  | "hotfix";

export type NexusCiTierEventName =
  | "pull_request"
  | "push"
  | "merge_group"
  | "schedule"
  | "workflow_dispatch";

export type NexusCiTierCost = "none" | "low" | "high";

export type NexusCiTierDecisionStatus =
  | "required"
  | "optional"
  | "skipped";

export type NexusCiTierReasonCode =
  | "default_conservative_policy"
  | "documentation_only"
  | "metadata_only"
  | "ordinary_branch"
  | "candidate_branch"
  | "release_branch"
  | "target_branch"
  | "merge_queue"
  | "scheduled_drift"
  | "manual_override"
  | "hotfix_override"
  | "release_mode"
  | "cross_platform_risk"
  | "budget_available"
  | "budget_exhausted";

export interface NexusCiTierDefinition {
  id: NexusCiTierId;
  name: string;
  cost: NexusCiTierCost;
  requiredChecks: string[];
  optionalChecks: string[];
  branchPatterns: string[];
  eventNames: NexusCiTierEventName[];
}

export interface NexusCiFullMatrixBudgetConfig {
  minimumIntervalMinutes: number | null;
  minimumChangeCount: number | null;
}

export interface NexusCiTierPolicyConfig {
  enabled: boolean;
  defaultTier: NexusCiTierId;
  tiers: NexusCiTierDefinition[];
  fullMatrixBudget: NexusCiFullMatrixBudgetConfig;
}

export interface NexusCiTierResolutionInput {
  policy?: NexusCiTierPolicyConfig | null;
  eventName?: NexusCiTierEventName | null;
  branchName?: string | null;
  targetBranch?: string | null;
  changedPaths?: string[];
  workflowMode?: NexusCiWorkflowMode | null;
  changeRisk?: NexusCiChangeRisk | null;
  requestedTier?: NexusCiTierId | null;
  fullMatrixBudgetAvailable?: boolean | null;
}

export interface NexusCiTierDecision {
  status: NexusCiTierDecisionStatus;
  tier: NexusCiTierDefinition;
  requiredChecks: string[];
  optionalChecks: string[];
  skippedChecks: string[];
  reasonCodes: NexusCiTierReasonCode[];
  reason: string;
  budgetLimited: boolean;
  summary: string;
}

export class NexusCiTierPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusCiTierPolicyError";
  }
}

const node22FullChecks = [
  "Node 22 check (ubuntu-latest)",
  "Node 22 check (windows-latest)",
  "Node 22 check (macos-latest)",
];

export const defaultNexusCiTierDefinitions: NexusCiTierDefinition[] = [
  {
    id: "local_focused",
    name: "Local focused verification",
    cost: "none",
    requiredChecks: [],
    optionalChecks: [],
    branchPatterns: [],
    eventNames: [],
  },
  {
    id: "remote_smoke",
    name: "Cheap remote smoke",
    cost: "low",
    requiredChecks: ["Node 22 check (ubuntu-latest)"],
    optionalChecks: [],
    branchPatterns: [],
    eventNames: ["pull_request", "workflow_dispatch"],
  },
  {
    id: "candidate_matrix",
    name: "Candidate matrix",
    cost: "high",
    requiredChecks: [...node22FullChecks],
    optionalChecks: [],
    branchPatterns: ["candidate/**", "integration/**", "release/**"],
    eventNames: ["pull_request", "push", "workflow_dispatch"],
  },
  {
    id: "protected_target",
    name: "Protected target gate",
    cost: "high",
    requiredChecks: [...node22FullChecks],
    optionalChecks: [],
    branchPatterns: ["main"],
    eventNames: ["push", "merge_group", "workflow_dispatch"],
  },
  {
    id: "scheduled_drift",
    name: "Scheduled drift check",
    cost: "high",
    requiredChecks: [...node22FullChecks],
    optionalChecks: [],
    branchPatterns: [],
    eventNames: ["schedule"],
  },
];

export const defaultNexusCiTierPolicy: NexusCiTierPolicyConfig = {
  enabled: true,
  defaultTier: "protected_target",
  tiers: defaultNexusCiTierDefinitions,
  fullMatrixBudget: {
    minimumIntervalMinutes: null,
    minimumChangeCount: null,
  },
};

export const defaultNexusReleaseTrainCiTierPolicy:
  NexusCiTierPolicyConfig = {
    ...defaultNexusCiTierPolicy,
    defaultTier: "remote_smoke",
    fullMatrixBudget: {
      minimumIntervalMinutes: 60,
      minimumChangeCount: 3,
    },
  };

export function validateNexusCiTierPolicyConfig(
  value: unknown,
  pathName = "ciTiers",
): NexusCiTierPolicyConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const record = assertRecord(value, pathName);
  const enabled = optionalBoolean(record.enabled, `${pathName}.enabled`) ?? true;
  const tiers = validateTierDefinitions(record.tiers, `${pathName}.tiers`);
  const defaultTier = validateTierId(
    record.defaultTier,
    `${pathName}.defaultTier`,
  ) ?? defaultNexusCiTierPolicy.defaultTier;
  if (!tiers.some((tier) => tier.id === defaultTier)) {
    throw new NexusCiTierPolicyError(
      `${pathName}.defaultTier must reference a configured tier`,
    );
  }

  return {
    enabled,
    defaultTier,
    tiers,
    fullMatrixBudget: validateFullMatrixBudget(
      record.fullMatrixBudget,
      `${pathName}.fullMatrixBudget`,
    ),
  };
}

export function mergeNexusCiTierPolicy(
  base: NexusCiTierPolicyConfig = defaultNexusCiTierPolicy,
  override?: NexusCiTierPolicyConfig | null,
): NexusCiTierPolicyConfig {
  if (!override) {
    return clonePolicy(base);
  }
  return {
    enabled: override.enabled,
    defaultTier: override.defaultTier,
    tiers: override.tiers.map(cloneTier),
    fullMatrixBudget: {
      ...override.fullMatrixBudget,
    },
  };
}

export function resolveNexusCiTierDecision(
  input: NexusCiTierResolutionInput = {},
): NexusCiTierDecision {
  const configuredPolicy = input.policy?.enabled === false
    ? null
    : input.policy;
  const policy = mergeNexusCiTierPolicy(
    defaultNexusCiTierPolicy,
    configuredPolicy,
  );
  const eventName = input.eventName ?? null;
  const branchName = input.branchName ?? null;
  const targetBranch = input.targetBranch ?? "main";
  const changedPaths = input.changedPaths ?? [];
  const workflowMode = input.workflowMode ?? null;
  const changeRisk = input.changeRisk ?? inferChangeRisk(changedPaths);
  const budgetAvailable = input.fullMatrixBudgetAvailable ?? true;

  const reasonCodes: NexusCiTierReasonCode[] = [];
  let selectedTierId = policy.defaultTier;
  let status: NexusCiTierDecisionStatus = "required";

  if (!configuredPolicy) {
    reasonCodes.push("default_conservative_policy");
  }
  if (input.requestedTier) {
    selectedTierId = input.requestedTier;
    reasonCodes.push("manual_override");
  } else if (eventName === "merge_group") {
    selectedTierId = "protected_target";
    reasonCodes.push("merge_queue");
  } else if (eventName === "schedule") {
    selectedTierId = "scheduled_drift";
    reasonCodes.push("scheduled_drift");
  } else if (workflowMode === "release" || changeRisk === "release") {
    selectedTierId = "candidate_matrix";
    reasonCodes.push("release_mode");
  } else if (changeRisk === "hotfix") {
    selectedTierId = "protected_target";
    reasonCodes.push("hotfix_override");
  } else if (changeRisk === "cross_platform") {
    selectedTierId = "candidate_matrix";
    reasonCodes.push("cross_platform_risk");
  } else if (branchName && matchesBranch(branchName, targetBranch)) {
    selectedTierId = "protected_target";
    reasonCodes.push("target_branch");
  } else if (branchName && matchesAnyBranch(branchName, ["release/**"])) {
    selectedTierId = "candidate_matrix";
    reasonCodes.push("release_branch");
  } else if (
    branchName &&
    matchesAnyBranch(branchName, ["candidate/**", "integration/**"])
  ) {
    selectedTierId = "candidate_matrix";
    reasonCodes.push("candidate_branch");
  } else if (changeRisk === "documentation") {
    selectedTierId = "local_focused";
    status = "skipped";
    reasonCodes.push("documentation_only");
  } else if (changeRisk === "metadata") {
    selectedTierId = "remote_smoke";
    reasonCodes.push("metadata_only");
  } else {
    selectedTierId = policy.defaultTier;
    reasonCodes.push("ordinary_branch");
  }

  let tier = requireTier(policy, selectedTierId, "selected CI tier");
  let budgetLimited = false;
  if (
    tier.cost === "high" &&
    !budgetAvailable &&
    !isFinalGate(eventName, branchName, targetBranch)
  ) {
    tier = requireTier(policy, "remote_smoke", "budget fallback tier");
    budgetLimited = true;
    reasonCodes.push("budget_exhausted");
  } else if (tier.cost === "high") {
    reasonCodes.push("budget_available");
  }

  const requiredChecks = status === "skipped" ? [] : [...tier.requiredChecks];
  const optionalChecks = status === "skipped" ? [] : [...tier.optionalChecks];
  const activeChecks = new Set([...requiredChecks, ...optionalChecks]);
  const skippedChecks = status === "skipped"
    ? allKnownChecks(policy)
    : policy.tiers
      .filter((candidate) => candidate.id !== tier.id)
      .flatMap((candidate) => [
        ...candidate.requiredChecks,
        ...candidate.optionalChecks,
      ])
      .filter((check) => !activeChecks.has(check));
  const dedupedReasonCodes = unique(reasonCodes);
  const reason = reasonFromCodes(dedupedReasonCodes);

  return {
    status,
    tier: cloneTier(tier),
    requiredChecks,
    optionalChecks,
    skippedChecks: unique(skippedChecks),
    reasonCodes: dedupedReasonCodes,
    reason,
    budgetLimited,
    summary: `${tier.id}: ${status}; ${reason}`,
  };
}

function validateTierDefinitions(
  value: unknown,
  pathName: string,
): NexusCiTierDefinition[] {
  if (value === undefined) {
    return defaultNexusCiTierDefinitions.map(cloneTier);
  }
  if (!Array.isArray(value)) {
    throw new NexusCiTierPolicyError(`${pathName} must be an array`);
  }
  const tiers = value.map((entry, index) =>
    validateTierDefinition(entry, `${pathName}[${index}]`),
  );
  const ids = new Set<NexusCiTierId>();
  for (const tier of tiers) {
    if (ids.has(tier.id)) {
      throw new NexusCiTierPolicyError(
        `${pathName} contains duplicate tier id: ${tier.id}`,
      );
    }
    ids.add(tier.id);
  }
  return tiers;
}

function validateTierDefinition(
  value: unknown,
  pathName: string,
): NexusCiTierDefinition {
  const record = assertRecord(value, pathName);
  return {
    id: validateTierId(record.id, `${pathName}.id`) ??
      fail(`${pathName}.id is required`),
    name: requiredString(record.name, `${pathName}.name`),
    cost: validateTierCost(record.cost, `${pathName}.cost`),
    requiredChecks: stringArray(record.requiredChecks, `${pathName}.requiredChecks`),
    optionalChecks: stringArray(record.optionalChecks, `${pathName}.optionalChecks`),
    branchPatterns: stringArray(record.branchPatterns, `${pathName}.branchPatterns`),
    eventNames: eventNameArray(record.eventNames, `${pathName}.eventNames`),
  };
}

function validateFullMatrixBudget(
  value: unknown,
  pathName: string,
): NexusCiFullMatrixBudgetConfig {
  if (value === undefined) {
    return { ...defaultNexusCiTierPolicy.fullMatrixBudget };
  }
  const record = assertRecord(value, pathName);
  return {
    minimumIntervalMinutes: nullablePositiveInteger(
      record.minimumIntervalMinutes,
      `${pathName}.minimumIntervalMinutes`,
    ),
    minimumChangeCount: nullablePositiveInteger(
      record.minimumChangeCount,
      `${pathName}.minimumChangeCount`,
    ),
  };
}

function inferChangeRisk(paths: string[]): NexusCiChangeRisk {
  if (paths.length === 0) {
    return "source";
  }
  if (paths.every((file) => docsOnlyPath(file))) {
    return "documentation";
  }
  if (paths.every((file) => metadataOnlyPath(file))) {
    return "metadata";
  }
  if (paths.some((file) => crossPlatformPath(file))) {
    return "cross_platform";
  }
  if (paths.some((file) => releasePath(file))) {
    return "release";
  }
  return "source";
}

function docsOnlyPath(file: string): boolean {
  if (file.startsWith(".dev-nexus/") || file.startsWith(".agents/")) {
    return false;
  }
  return file.startsWith("docs/") || file.endsWith(".md");
}

function metadataOnlyPath(file: string): boolean {
  return (
    docsOnlyPath(file) ||
    file.startsWith(".github/ISSUE_TEMPLATE/") ||
    file.startsWith(".github/PULL_REQUEST_TEMPLATE/") ||
    file.startsWith(".dev-nexus/")
  );
}

function crossPlatformPath(file: string): boolean {
  return (
    /(?:^|\/)(windows|win32|macos|darwin|linux|platform|host|runner)\b/iu.test(file) ||
    file.startsWith("scripts/") ||
    file === "package.json" ||
    file === "package-lock.json" ||
    file === "tsconfig.json"
  );
}

function releasePath(file: string): boolean {
  return (
    file.startsWith(".github/workflows/") ||
    file.startsWith("scripts/release") ||
    file === "CHANGELOG.md"
  );
}

function isFinalGate(
  eventName: NexusCiTierEventName | null,
  branchName: string | null,
  targetBranch: string,
): boolean {
  return (
    eventName === "merge_group" ||
    eventName === "schedule" ||
    Boolean(branchName && matchesBranch(branchName, targetBranch))
  );
}

function matchesAnyBranch(branchName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesBranch(branchName, pattern));
}

function matchesBranch(branchName: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return branchName.startsWith(pattern.slice(0, -2));
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return branchName.startsWith(prefix) &&
      !branchName.slice(prefix.length).includes("/");
  }
  return branchName === pattern;
}

function requireTier(
  policy: NexusCiTierPolicyConfig,
  id: NexusCiTierId,
  label: string,
): NexusCiTierDefinition {
  const tier = policy.tiers.find((candidate) => candidate.id === id);
  if (!tier) {
    throw new NexusCiTierPolicyError(`${label} is not configured: ${id}`);
  }
  return tier;
}

function allKnownChecks(policy: NexusCiTierPolicyConfig): string[] {
  return unique(policy.tiers.flatMap((tier) => [
    ...tier.requiredChecks,
    ...tier.optionalChecks,
  ]));
}

function reasonFromCodes(codes: NexusCiTierReasonCode[]): string {
  if (codes.includes("documentation_only")) {
    return "documentation-only change";
  }
  if (codes.includes("metadata_only")) {
    return "metadata-only change";
  }
  if (codes.includes("budget_exhausted")) {
    return "full matrix budget exhausted; falling back to cheap remote smoke";
  }
  if (codes.includes("merge_queue")) {
    return "merge queue requires protected target validation";
  }
  if (codes.includes("scheduled_drift")) {
    return "scheduled drift validation";
  }
  if (codes.includes("candidate_branch")) {
    return "candidate or integration branch";
  }
  if (codes.includes("release_branch") || codes.includes("release_mode")) {
    return "release validation";
  }
  if (codes.includes("target_branch")) {
    return "target branch validation";
  }
  if (codes.includes("cross_platform_risk")) {
    return "cross-platform source risk";
  }
  if (codes.includes("hotfix_override")) {
    return "hotfix override";
  }
  if (codes.includes("manual_override")) {
    return "manual tier override";
  }
  return "ordinary branch validation";
}

function validateTierId(
  value: unknown,
  pathName: string,
): NexusCiTierId | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "local_focused" ||
    value === "remote_smoke" ||
    value === "candidate_matrix" ||
    value === "protected_target" ||
    value === "scheduled_drift"
  ) {
    return value;
  }
  throw new NexusCiTierPolicyError(
    `${pathName} must be local_focused, remote_smoke, candidate_matrix, protected_target, or scheduled_drift`,
  );
}

function validateTierCost(value: unknown, pathName: string): NexusCiTierCost {
  if (value === "none" || value === "low" || value === "high") {
    return value;
  }
  throw new NexusCiTierPolicyError(`${pathName} must be none, low, or high`);
}

function eventNameArray(
  value: unknown,
  pathName: string,
): NexusCiTierEventName[] {
  return stringArray(value, pathName).map((item, index) =>
    validateEventName(item, `${pathName}[${index}]`),
  );
}

function validateEventName(
  value: unknown,
  pathName: string,
): NexusCiTierEventName {
  if (
    value === "pull_request" ||
    value === "push" ||
    value === "merge_group" ||
    value === "schedule" ||
    value === "workflow_dispatch"
  ) {
    return value;
  }
  throw new NexusCiTierPolicyError(
    `${pathName} must be pull_request, push, merge_group, schedule, or workflow_dispatch`,
  );
}

function stringArray(value: unknown, pathName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusCiTierPolicyError(`${pathName} must be an array`);
  }
  return value.map((item, index) =>
    requiredString(item, `${pathName}[${index}]`),
  );
}

function nullablePositiveInteger(value: unknown, pathName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusCiTierPolicyError(
      `${pathName} must be a positive integer or null`,
    );
  }
  return value;
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new NexusCiTierPolicyError(`${pathName} must be a boolean`);
  }
  return value;
}

function requiredString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusCiTierPolicyError(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusCiTierPolicyError(`${pathName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function clonePolicy(policy: NexusCiTierPolicyConfig): NexusCiTierPolicyConfig {
  return {
    enabled: policy.enabled,
    defaultTier: policy.defaultTier,
    tiers: policy.tiers.map(cloneTier),
    fullMatrixBudget: { ...policy.fullMatrixBudget },
  };
}

function cloneTier(tier: NexusCiTierDefinition): NexusCiTierDefinition {
  return {
    ...tier,
    requiredChecks: [...tier.requiredChecks],
    optionalChecks: [...tier.optionalChecks],
    branchPatterns: [...tier.branchPatterns],
    eventNames: [...tier.eventNames],
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function fail(message: string): never {
  throw new NexusCiTierPolicyError(message);
}
