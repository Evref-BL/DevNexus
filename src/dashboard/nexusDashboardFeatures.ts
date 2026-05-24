import {
  buildNexusFeatureBranchDeliveryPlan,
  type NexusFeatureBranchDeliveryPlanItem,
} from "../publication/nexusFeatureBranchDeliveryPlan.js";
import type { NexusProjectConfig } from "../project/nexusProjectConfig.js";
import { gitHistoryBranchReferences } from "./nexusDashboardGitHistory.js";
import type {
  NexusDashboardFeatureRecord,
  NexusDashboardFeatureStatus,
  NexusDashboardFeatureSummary,
  NexusDashboardSignalTone,
  NexusDashboardThreadSummary,
  NexusDashboardWorktreeSummary,
} from "./nexusDashboardTypes.js";
import type {
  NexusDashboardGitHistoryBranchReference,
  NexusDashboardGitHistorySummary,
} from "./nexusDashboardGitHistory.js";

export function summarizeFeatures(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  history: NexusDashboardGitHistorySummary;
  worktrees: NexusDashboardWorktreeSummary;
  threads: NexusDashboardThreadSummary;
}): NexusDashboardFeatureSummary {
  const plan = capture(() =>
    buildNexusFeatureBranchDeliveryPlan({
      projectRoot: options.projectRoot,
    }),
  );
  if (!plan.value) {
    return {
      totalCount: 0,
      activeCount: 0,
      needsAttentionCount: 0,
      records: [],
      incomplete: true,
      detail: plan.error?.message ?? "Feature branch delivery is unavailable.",
    };
  }

  const configuredRecords = plan.value.items.map((item) =>
    dashboardFeatureRecord(item, options.history, options.worktrees, options.threads),
  );
  const records = [
    ...configuredRecords,
    ...inferredFeatureRecords({
      configuredItems: plan.value.items,
      history: options.history,
      projectConfig: options.projectConfig,
      threads: options.threads,
      worktrees: options.worktrees,
    }),
  ];
  return {
    totalCount: records.length,
    activeCount: records.filter((record) =>
      record.status === "active" ||
      record.status === "needs-review" ||
      record.status === "blocked"
    ).length,
    needsAttentionCount: records.filter((record) =>
      record.status === "needs-review" || record.status === "blocked"
    ).length,
    records,
    incomplete: false,
    detail: plan.value.warnings.length > 0
      ? plan.value.warnings.join("; ")
      : null,
  };
}

function dashboardFeatureRecord(
  item: NexusFeatureBranchDeliveryPlanItem,
  history: NexusDashboardGitHistorySummary,
  worktrees: NexusDashboardWorktreeSummary,
  threads: NexusDashboardThreadSummary,
): NexusDashboardFeatureRecord {
  const feature = item.feature;
  const relatedWorktrees = worktrees.records.filter((worktree) =>
    branchBelongsToFeature(worktree.branchName, item),
  );
  const relatedGitBranches = gitHistoryBranchReferences(history).filter((branch) =>
    branchBelongsToFeature(branch.branchName, item),
  );
  const relatedThreads = threads.records.filter((thread) =>
    branchBelongsToFeature(thread.branchName, item),
  );
  const branches = uniqueNonEmptyStrings(
    [
      ...relatedGitBranches.map((branch) => branch.branchName),
      ...relatedWorktrees.flatMap((worktree) => [worktree.branchName ?? ""]),
    ],
  );
  const needsDecisionCount = relatedThreads.filter((thread) =>
    thread.decision === "review" ||
    thread.decision === "rescue" ||
    thread.decision === "blocked"
  ).length;
  const activeThreadCount = relatedThreads.filter((thread) =>
    thread.decision === "continue" || thread.decision === "resume"
  ).length;
  const warnings = uniqueNonEmptyStrings([
    ...feature.warnings,
    ...worktrees.warnings.filter((warning) =>
      branches.some((branch) => warning.includes(branch)),
    ),
  ]);
  const status = dashboardFeatureStatus({
    relatedWorktreeCount: relatedWorktrees.length,
    relatedBranchCount: branches.length,
    needsDecisionCount,
    warnings,
  });
  const branchPlan = feature.branchPlan;

  return {
    id: `feature:${item.componentId}:${feature.activeScopeId}`,
    title: feature.activeScopeId,
    featureId: feature.activeScopeId,
    componentIds: [item.componentId],
    componentNames: [item.componentName],
    releaseTrainVersionId: item.releaseTrainVersionId,
    branchStrategy: feature.defaultBranchStrategy,
    status,
    statusLabel: dashboardFeatureStatusLabel(status),
    tone: dashboardFeatureTone(status),
    detail: dashboardFeatureDetail({
      branchStrategy: feature.defaultBranchStrategy,
      featureBranch: branchPlan.featureBranch,
      reviewBranchPattern: branchPlan.reviewBranchPattern,
      finalPublicationTarget: branchPlan.finalPublicationTarget,
      threadCount: relatedThreads.length,
      branchCount: branches.length,
    }),
    featureBranch: branchPlan.featureBranch,
    reviewBranchPattern: branchPlan.reviewBranchPattern,
    defaultChangeBaseBranch: branchPlan.defaultChangeBaseBranch,
    finalReviewTarget: branchPlan.finalReviewTarget,
    finalPublicationTarget: branchPlan.finalPublicationTarget,
    reviewMode: feature.reviewMode,
    finalPullRequestCreation: feature.finalPullRequestCreation,
    commentPolicy: feature.commentPolicy,
    threadCount: relatedThreads.length,
    activeThreadCount,
    needsDecisionCount,
    branchCount: branches.length,
    branches,
    updatedAt: latestIsoString([
      ...relatedGitBranches.map((branch) => branch.updatedAt),
      ...relatedWorktrees.map((worktree) => worktree.updatedAt),
      ...relatedThreads.map((thread) => thread.updatedAt),
    ]),
    warnings,
  };
}

function inferredFeatureRecords(options: {
  configuredItems: NexusFeatureBranchDeliveryPlanItem[];
  history: NexusDashboardGitHistorySummary;
  projectConfig: NexusProjectConfig;
  worktrees: NexusDashboardWorktreeSummary;
  threads: NexusDashboardThreadSummary;
}): NexusDashboardFeatureRecord[] {
  const gitBranches = gitHistoryBranchReferences(options.history);
  const matchedBranches = new Set(
    [
      ...gitBranches.map((branch) => branch.branchName),
      ...options.worktrees.records.map((worktree) => worktree.branchName),
    ]
      .filter((branchName): branchName is string =>
        Boolean(branchName) &&
        options.configuredItems.some((item) =>
          branchBelongsToFeature(branchName, item),
        )
      ),
  );
  const groups = new Map<string, InferredFeatureGroup>();
  addInferredGitBranches(groups, gitBranches, matchedBranches);
  addInferredWorktreeBranches(groups, options.worktrees.records, matchedBranches);
  addInferredThreadBranches(groups, options.threads.records, matchedBranches);

  return [...groups.values()]
    .map((group) =>
      inferredFeatureRecord(
        group,
        options.projectConfig.repo.defaultBranch ?? "main",
      ),
    )
    .sort((left, right) =>
      (new Date(right.updatedAt ?? 0).getTime() || 0) -
      (new Date(left.updatedAt ?? 0).getTime() || 0)
    );
}

type DashboardFeatureBranchReference = NexusDashboardGitHistoryBranchReference;

interface InferredFeatureGroup {
  family: InferredFeatureFamily;
  branches: DashboardFeatureBranchReference[];
  worktrees: NexusDashboardWorktreeSummary["records"];
  threads: NexusDashboardThreadSummary["records"];
}

function addInferredGitBranches(
  groups: Map<string, InferredFeatureGroup>,
  branches: DashboardFeatureBranchReference[],
  matchedBranches: Set<string>,
): void {
  for (const branch of branches) {
    const group = inferredFeatureGroupForBranch(groups, branch.branchName, matchedBranches);
    if (group) {
      addInferredFeatureBranch(group, branch);
    }
  }
}

function addInferredWorktreeBranches(
  groups: Map<string, InferredFeatureGroup>,
  worktrees: NexusDashboardWorktreeSummary["records"],
  matchedBranches: Set<string>,
): void {
  for (const worktree of worktrees) {
    if (!worktree.branchName) {
      continue;
    }
    const group = inferredFeatureGroupForBranch(groups, worktree.branchName, matchedBranches);
    if (group) {
      addInferredFeatureBranch(group, dashboardFeatureBranchFromWorktree(worktree));
      group.worktrees.push(worktree);
    }
  }
}

function addInferredThreadBranches(
  groups: Map<string, InferredFeatureGroup>,
  threads: NexusDashboardThreadSummary["records"],
  matchedBranches: Set<string>,
): void {
  for (const thread of threads) {
    if (!thread.branchName) {
      continue;
    }
    const group = inferredFeatureGroupForBranch(groups, thread.branchName, matchedBranches);
    if (group) {
      addInferredFeatureBranch(group, dashboardFeatureBranchFromThread(thread));
      addUniqueInferredFeatureThread(group, thread);
    }
  }
}

function inferredFeatureGroupForBranch(
  groups: Map<string, InferredFeatureGroup>,
  branchName: string,
  matchedBranches: Set<string>,
): InferredFeatureGroup | null {
  if (matchedBranches.has(branchName)) {
    return null;
  }
  const family = inferFeatureFamilyFromBranch(branchName);
  return family ? inferredFeatureGroup(groups, family) : null;
}

function dashboardFeatureBranchFromWorktree(
  worktree: NexusDashboardWorktreeSummary["records"][number],
): DashboardFeatureBranchReference {
  return {
    branchName: worktree.branchName ?? "",
    componentId: worktree.componentId,
    componentName: worktree.componentId,
    updatedAt: worktree.updatedAt,
  };
}

function dashboardFeatureBranchFromThread(
  thread: NexusDashboardThreadSummary["records"][number],
): DashboardFeatureBranchReference {
  return {
    branchName: thread.branchName ?? "",
    componentId: thread.componentId,
    componentName: thread.componentId,
    updatedAt: thread.updatedAt,
  };
}

function addUniqueInferredFeatureThread(
  group: InferredFeatureGroup,
  thread: NexusDashboardThreadSummary["records"][number],
): void {
  if (!group.threads.some((candidate) => candidate.id === thread.id)) {
    group.threads.push(thread);
  }
}

function inferredFeatureGroup(
  groups: Map<string, InferredFeatureGroup>,
  family: InferredFeatureFamily,
): InferredFeatureGroup {
  const group = groups.get(family.key) ?? {
    family,
    branches: [],
    worktrees: [],
    threads: [],
  };
  groups.set(family.key, group);
  return group;
}

function addInferredFeatureBranch(
  group: {
    branches: DashboardFeatureBranchReference[];
  },
  branch: DashboardFeatureBranchReference,
): void {
  if (group.branches.some((candidate) =>
    candidate.branchName === branch.branchName &&
    candidate.componentId === branch.componentId
  )) {
    return;
  }
  group.branches.push(branch);
}

interface InferredFeatureFamily {
  key: string;
  title: string;
  featureBranch: string;
  reviewBranchPattern: string;
}

function inferredFeatureRecord(
  group: InferredFeatureGroup,
  targetBranch: string,
): NexusDashboardFeatureRecord {
  const branches = uniqueNonEmptyStrings(
    [
      ...group.branches.map((branch) => branch.branchName),
      ...group.worktrees.flatMap((worktree) => [worktree.branchName ?? ""]),
    ],
  );
  const needsDecisionCount = group.threads.filter((thread) =>
    thread.decision === "review" ||
    thread.decision === "rescue" ||
    thread.decision === "blocked"
  ).length;
  const activeThreadCount = group.threads.filter((thread) =>
    thread.decision === "continue" || thread.decision === "resume"
  ).length;
  const status = dashboardFeatureStatus({
    relatedWorktreeCount: group.worktrees.length,
    relatedBranchCount: branches.length,
    needsDecisionCount,
    warnings: [],
  });
  const updatedAt = latestIsoString([
    ...group.branches.map((branch) => branch.updatedAt),
    ...group.worktrees.map((worktree) => worktree.updatedAt),
    ...group.threads.map((thread) => thread.updatedAt),
  ]);

  return {
    id: `feature:inferred:${dashboardFeatureSlug(group.family.key)}`,
    title: group.family.title,
    featureId: group.family.key,
    componentIds: uniqueNonEmptyStrings(
      [
        ...group.branches.map((branch) => branch.componentId ?? ""),
        ...group.worktrees.flatMap((worktree) => [worktree.componentId ?? ""]),
      ],
    ),
    componentNames: uniqueNonEmptyStrings(
      [
        ...group.branches.map((branch) => branch.componentName ?? ""),
        ...group.worktrees.flatMap((worktree) => [worktree.componentId ?? ""]),
      ],
    ),
    releaseTrainVersionId: null,
    branchStrategy: "inferred",
    status,
    statusLabel: dashboardFeatureStatusLabel(status),
    tone: dashboardFeatureTone(status),
    detail: `${branches.length} ${plural(branches.length, "branch", "branches")} inferred from Git refs and active worktree branches. Configure feature branch delivery to make this workflow explicit.`,
    featureBranch: group.family.featureBranch,
    reviewBranchPattern: group.family.reviewBranchPattern,
    defaultChangeBaseBranch: group.family.featureBranch,
    finalReviewTarget: targetBranch,
    finalPublicationTarget: targetBranch,
    reviewMode: "branch_family",
    finalPullRequestCreation: "unknown",
    commentPolicy: "unknown",
    threadCount: group.threads.length,
    activeThreadCount,
    needsDecisionCount,
    branchCount: branches.length,
    branches,
    updatedAt,
    warnings: [],
  };
}

function inferFeatureFamilyFromBranch(
  branchName: string,
): InferredFeatureFamily | null {
  const intentPrefixes = featureIntentPrefixes();
  const rawParts = branchName.split("/").filter(Boolean);
  const parts =
    rawParts[1] && intentPrefixes.has(rawParts[1])
      ? rawParts.slice(1)
      : rawParts;
  const normalizedBranchName = parts.join("/");
  if (
    parts.length === 0 ||
    normalizedBranchName === "main" ||
    branchName.endsWith("/HEAD") ||
    branchName.endsWith("/main")
  ) {
    return null;
  }
  if (parts[0] && intentPrefixes.has(parts[0]) && parts[1]) {
    const key = parts[1];
    return {
      key,
      title: key,
      featureBranch: `${parts[0]}/${key}`,
      reviewBranchPattern: `${parts[0]}/${key}/{change}`,
    };
  }
  if (parts[0] === "codex" && parts.length >= 3) {
    const key = parts.slice(2).join("/");
    return {
      key,
      title: parts.at(-1) ?? key,
      featureBranch: normalizedBranchName,
      reviewBranchPattern: `${normalizedBranchName}/{change}`,
    };
  }
  if (parts.length >= 2 && /^dev-nexus(?:-|$)/u.test(parts[0] ?? "")) {
    const key = parts.slice(1).join("/");
    return {
      key,
      title: parts.at(-1) ?? key,
      featureBranch: normalizedBranchName,
      reviewBranchPattern: `${normalizedBranchName}/{change}`,
    };
  }
  return {
    key: normalizedBranchName,
    title: parts.at(-1) ?? normalizedBranchName,
    featureBranch: normalizedBranchName,
    reviewBranchPattern: `${normalizedBranchName}/{change}`,
  };
}

function featureIntentPrefixes(): Set<string> {
  return new Set([
    "feat",
    "feature",
    "fix",
    "chore",
    "docs",
    "refactor",
    "test",
    "ci",
  ]);
}

function dashboardFeatureSlug(value: string): string {
  let slug = "";
  for (const char of value.trim().toLowerCase()) {
    if (isDashboardFeatureSlugChar(char)) {
      slug += char;
    } else if (slug && !slug.endsWith("-")) {
      slug += "-";
    }
  }
  return trimEdgeDashes(slug) || "manual";
}

function isDashboardFeatureSlugChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "." ||
    char === "_" ||
    char === "-"
  );
}

function trimEdgeDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") {
    start += 1;
  }
  while (end > start && value[end - 1] === "-") {
    end -= 1;
  }
  return value.slice(start, end);
}

function branchBelongsToFeature(
  branchName: string | null,
  item: NexusFeatureBranchDeliveryPlanItem,
): boolean {
  if (!branchName) {
    return false;
  }
  const plan = item.feature.branchPlan;
  const reviewPrefix = plan.reviewBranchPattern.split("{change}")[0] ?? "";
  const prefixes = uniqueNonEmptyStrings([
    plan.featureBranch ?? "",
    trimTrailingSlash(reviewPrefix),
  ]);
  const normalizedBranchName = normalizeFeatureBranchForMatching(branchName);
  return prefixes.some((prefix) =>
    branchName === prefix ||
    branchName.startsWith(`${prefix}/`) ||
    normalizedBranchName === prefix ||
    normalizedBranchName.startsWith(`${prefix}/`),
  );
}

function normalizeFeatureBranchForMatching(branchName: string): string {
  const parts = branchName.split("/").filter(Boolean);
  const intentPrefixes = featureIntentPrefixes();
  if (parts[1] && intentPrefixes.has(parts[1])) {
    return parts.slice(1).join("/");
  }
  return branchName;
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

function dashboardFeatureStatus(options: {
  relatedWorktreeCount: number;
  relatedBranchCount: number;
  needsDecisionCount: number;
  warnings: string[];
}): NexusDashboardFeatureStatus {
  if (options.warnings.some((warning) => /blocked|failed|conflict/iu.test(warning))) {
    return "blocked";
  }
  if (options.needsDecisionCount > 0) {
    return "needs-review";
  }
  if (options.relatedWorktreeCount > 0 || options.relatedBranchCount > 0) {
    return "active";
  }
  return "planned";
}

function dashboardFeatureStatusLabel(
  status: NexusDashboardFeatureStatus,
): string {
  if (status === "needs-review") {
    return "Needs review";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function dashboardFeatureTone(
  status: NexusDashboardFeatureStatus,
): NexusDashboardSignalTone {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "needs-review") {
    return "warn";
  }
  if (status === "active" || status === "ready") {
    return "active";
  }
  return "neutral";
}

function dashboardFeatureDetail(options: {
  branchStrategy: string;
  featureBranch: string | null;
  reviewBranchPattern: string;
  finalPublicationTarget: string;
  threadCount: number;
  branchCount: number;
}): string {
  const branch = options.featureBranch
    ? `feature branch ${options.featureBranch}`
    : `review branches ${options.reviewBranchPattern}`;
  return `${displayBranchStrategy(options.branchStrategy)} branch strategy, ${branch}, ${options.branchCount} ${plural(options.branchCount, "branch", "branches")}, ${options.threadCount} ${plural(options.threadCount, "thread", "threads")}, targeting ${options.finalPublicationTarget}.`;
}

function displayBranchStrategy(value: string): string {
  return value.replace(/[_-]+/gu, " ");
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function latestIsoString(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length
    ? present.sort((left, right) => left.localeCompare(right)).at(-1) ?? null
    : null;
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}

function capture<T>(producer: () => T): { value: T | null; error: { message: string } | null } {
  try {
    return { value: producer(), error: null };
  } catch (error) {
    return {
      value: null,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}
