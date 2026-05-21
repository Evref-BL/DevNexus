import path from "node:path";
import {
  defaultNexusCiTierPolicy,
  resolveNexusCiTierDecision,
  type NexusCiTierDecision,
  type NexusCiTierPolicyConfig,
} from "./nexusCiTierPolicy.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  classifyNexusPublicationProviderEvidenceChecks,
  findNexusPublicationProviderEvidence,
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderBranchPolicy,
  type NexusPublicationProviderCheckInput,
  type NexusPublicationProviderEvidenceInput,
  type NexusPublicationProviderEvidenceSourceKind,
  type NexusPublicationProviderMergeability,
  type NexusPublicationProviderReviewTarget,
} from "./nexusPublicationProviderEvidence.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  listNexusWorktreeLeases,
  type NexusWorktreeLeaseStatus,
} from "./nexusWorktreeLease.js";
import type {
  NexusVersionConfig,
  NexusVersionScopeStatus,
} from "./nexusVersionPlanningConfig.js";

export type NexusPublicationTrainSourceKind = "lease" | "handoff";

export type NexusPublicationTrainCandidateEligibility =
  | "eligible"
  | "wait"
  | "needs_scope"
  | "needs_verification"
  | "needs_human"
  | "blocked";

export type NexusPublicationTrainEvidenceStatus =
  | "not_required"
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unavailable";

export type NexusPublicationTrainCheckEvidenceStatus =
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unknown";

export type NexusPublicationTrainNextAction =
  | "wait"
  | "verify"
  | "resolve_blockers"
  | "create_candidate_branch"
  | "request_human_decision";

export type NexusPublicationTrainProviderCheckInput =
  NexusPublicationProviderCheckInput;

export type NexusPublicationTrainProviderEvidenceInput =
  NexusPublicationProviderEvidenceInput;

export interface NexusPublicationTrainHandoffInput {
  id: string;
  componentId: string;
  workItemId?: string | null;
  branchName?: string | null;
  status: "working" | "ready" | "blocked" | "merged";
  stale?: boolean | null;
  headCommit?: string | null;
  dirty?: boolean | null;
  upstream?: string | null;
  pushed?: boolean | null;
  changedAreas?: string[];
  blockers?: string[];
}

export interface BuildNexusPublicationTrainReadinessReportOptions {
  projectRoot: string;
  versionId?: string | null;
  fullMatrixBudgetAvailable?: boolean | null;
  providerEvidence?: NexusPublicationTrainProviderEvidenceInput[];
  handoffs?: NexusPublicationTrainHandoffInput[];
  now?: Date | string | (() => Date | string);
}

export interface NexusPublicationTrainSourceState {
  status: NexusWorktreeLeaseStatus | NexusPublicationTrainHandoffInput["status"];
  stale: boolean;
  blocked: boolean;
  dirty: boolean | null;
  pushed: boolean | null;
  missingHead: boolean;
  missingUpstream: boolean;
  warnings: string[];
}

export interface NexusPublicationTrainVersionScope {
  versionId: string;
  objective: string;
  targetBranch: string;
  scopeStatus: NexusVersionScopeStatus;
}

export interface NexusPublicationTrainCheckEvidence {
  name: string;
  status: NexusPublicationTrainCheckEvidenceStatus;
  url: string | null;
}

export interface NexusPublicationTrainEvidence {
  branchName: string | null;
  headCommit: string | null;
  provider: string | null;
  providerSourceKind: NexusPublicationProviderEvidenceSourceKind | null;
  reviewTarget: NexusPublicationProviderReviewTarget | null;
  headRef: string | null;
  targetBranch: string | null;
  intendedCiTier: string | null;
  mergeability: NexusPublicationProviderMergeability | null;
  branchPolicy: NexusPublicationProviderBranchPolicy | null;
  status: NexusPublicationTrainEvidenceStatus;
  requiredChecks: NexusPublicationTrainCheckEvidence[];
  message: string;
}

export interface NexusPublicationTrainReadinessItem {
  sourceKind: NexusPublicationTrainSourceKind;
  sourceId: string;
  componentId: string;
  componentName: string;
  workItemId: string | null;
  branchName: string | null;
  candidateBranchName: string | null;
  version: NexusPublicationTrainVersionScope | null;
  state: NexusPublicationTrainSourceState;
  candidateEligibility: NexusPublicationTrainCandidateEligibility;
  reasons: string[];
  ciTier: NexusCiTierDecision;
  evidence: NexusPublicationTrainEvidence;
  changedAreas: string[];
}

export interface NexusPublicationTrainComponentGroup {
  componentId: string;
  componentName: string;
  itemCount: number;
  eligibleCount: number;
  items: NexusPublicationTrainReadinessItem[];
}

export interface NexusPublicationTrainVersionGroup {
  versionId: string | null;
  objective: string | null;
  targetBranch: string | null;
  itemCount: number;
  eligibleCount: number;
  items: NexusPublicationTrainReadinessItem[];
}

export interface NexusPublicationTrainReadinessSummary {
  itemCount: number;
  readyCount: number;
  eligibleCount: number;
  blockedCount: number;
  needsVerificationCount: number;
  needsHumanCount: number;
  needsScopeCount: number;
  waitCount: number;
  staleCount: number;
  dirtyCount: number;
  unpushedCount: number;
  missingHeadCount: number;
  missingUpstreamCount: number;
  missingEvidenceCount: number;
  budgetLimitedCount: number;
}

export interface NexusPublicationTrainReadinessReport {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: {
    id: string;
    name: string;
    componentCount: number;
  };
  summary: NexusPublicationTrainReadinessSummary;
  components: NexusPublicationTrainComponentGroup[];
  versions: NexusPublicationTrainVersionGroup[];
  nextAction: NexusPublicationTrainNextAction;
  warnings: string[];
}

interface ReadinessSource {
  sourceKind: NexusPublicationTrainSourceKind;
  sourceId: string;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
  status: NexusWorktreeLeaseStatus | NexusPublicationTrainHandoffInput["status"];
  stale: boolean;
  dirty: boolean | null;
  pushed: boolean | null;
  upstream: string | null;
  headCommit: string | null;
  warnings: string[];
  changedAreas: string[];
}

interface ClassifiedReadiness {
  eligibility: NexusPublicationTrainCandidateEligibility;
  reasons: string[];
}

export function buildNexusPublicationTrainReadinessReport(
  options: BuildNexusPublicationTrainReadinessReportOptions,
): NexusPublicationTrainReadinessReport {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const generatedAt = isoString(options.now ?? new Date());
  const sources = [
    ...leaseSources({
      projectRoot,
      now: options.now,
    }),
    ...(options.handoffs ?? []).map(handoffSource),
  ];
  const warnings: string[] = [];
  const items = sources
    .filter((source) => source.status !== "merged" && source.status !== "abandoned")
    .map((source) =>
      readinessItem({
        projectConfig,
        components,
        source,
        options,
        warnings,
      }),
    )
    .filter((item): item is NexusPublicationTrainReadinessItem => item !== null);

  return {
    version: 1,
    generatedAt,
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
      componentCount: components.length,
    },
    summary: summarizeItems(items),
    components: groupByComponent(items),
    versions: groupByVersion(items),
    nextAction: nextAction(items),
    warnings: uniqueStrings(warnings),
  };
}

function readinessItem(options: {
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  source: ReadinessSource;
  options: BuildNexusPublicationTrainReadinessReportOptions;
  warnings: string[];
}): NexusPublicationTrainReadinessItem | null {
  const component = options.components.find(
    (candidate) => candidate.id === options.source.componentId,
  );
  if (!component) {
    options.warnings.push(
      `Publication train source ${options.source.sourceId} references unknown component ${options.source.componentId ?? "none"}.`,
    );
    return null;
  }
  const version = versionScope({
    projectConfig: options.projectConfig,
    source: options.source,
    requestedVersionId: options.options.versionId ?? null,
  });
  const candidateBranchName = version
    ? `candidate/${version.versionId}`
    : options.source.branchName;
  const ciTier = resolveNexusCiTierDecision({
    policy: ciTierPolicy(options.projectConfig, component),
    eventName: "pull_request",
    branchName: candidateBranchName,
    targetBranch: version?.targetBranch ?? component.defaultBranch ?? "main",
    changedPaths: [],
    fullMatrixBudgetAvailable: options.options.fullMatrixBudgetAvailable ?? true,
  });
  const evidence = evidenceForSource({
    source: options.source,
    branchName: candidateBranchName,
    ciTier,
    providerEvidence: options.options.providerEvidence ?? [],
  });
  const state = sourceState(options.source);
  const classification = classifyReadiness({
    source: options.source,
    state,
    version,
    hasVersionPlanning: Boolean(options.projectConfig.versionPlanning),
    ciTier,
  });

  return {
    sourceKind: options.source.sourceKind,
    sourceId: options.source.sourceId,
    componentId: component.id,
    componentName: component.name,
    workItemId: options.source.workItemId,
    branchName: options.source.branchName,
    candidateBranchName,
    version,
    state,
    candidateEligibility: classification.eligibility,
    reasons: classification.reasons,
    ciTier,
    evidence,
    changedAreas: [...options.source.changedAreas],
  };
}

function leaseSources(options: {
  projectRoot: string;
  now?: Date | string | (() => Date | string);
}): ReadinessSource[] {
  return listNexusWorktreeLeases({
    projectRoot: options.projectRoot,
    includeProjectMeta: false,
    now: options.now,
  }).records
    .filter((lease) => lease.scope.kind === "component")
    .map((lease) => ({
      sourceKind: "lease",
      sourceId: lease.id,
      componentId: lease.scope.componentId,
      workItemId: lease.workItemId,
      branchName: lease.branchName,
      status: lease.effectiveStatus,
      stale: lease.stale,
      dirty: lease.dirty,
      pushed: lease.pushed,
      upstream: lease.git.upstream,
      headCommit: lease.lastObservedHeadCommit,
      warnings: lease.git.warnings,
      changedAreas: [...lease.writeScope],
    }));
}

function handoffSource(handoff: NexusPublicationTrainHandoffInput): ReadinessSource {
  return {
    sourceKind: "handoff",
    sourceId: handoff.id,
    componentId: handoff.componentId,
    workItemId: handoff.workItemId ?? null,
    branchName: handoff.branchName ?? null,
    status: handoff.status,
    stale: handoff.stale ?? false,
    dirty: handoff.dirty ?? null,
    pushed: handoff.pushed ?? null,
    upstream: handoff.upstream ?? null,
    headCommit: handoff.headCommit ?? null,
    warnings: handoff.blockers ?? [],
    changedAreas: handoff.changedAreas ?? [],
  };
}

function sourceState(source: ReadinessSource): NexusPublicationTrainSourceState {
  return {
    status: source.status,
    stale: source.stale,
    blocked: source.status === "blocked",
    dirty: source.dirty,
    pushed: source.pushed,
    missingHead: !source.headCommit,
    missingUpstream: !source.upstream,
    warnings: [...source.warnings],
  };
}

function classifyReadiness(options: {
  source: ReadinessSource;
  state: NexusPublicationTrainSourceState;
  version: NexusPublicationTrainVersionScope | null;
  hasVersionPlanning: boolean;
  ciTier: NexusCiTierDecision;
}): ClassifiedReadiness {
  const reasons: string[] = [];
  if (options.state.blocked) {
    reasons.push("source is blocked");
  }
  if (options.state.stale) {
    reasons.push("source readiness is stale");
  }
  if (options.source.status === "working" || options.source.status === "integrating") {
    reasons.push(`source is still ${options.source.status}`);
  }
  if (options.state.dirty) {
    reasons.push("worktree has uncommitted changes");
  }
  if (options.state.missingHead) {
    reasons.push("head commit is missing");
  }
  if (options.state.missingUpstream) {
    reasons.push("upstream branch is missing");
  }
  if (options.state.pushed === false) {
    reasons.push("branch has unpushed commits");
  }
  if (options.hasVersionPlanning && !options.version) {
    reasons.push("work item is not in version scope");
  }
  if (options.ciTier.budgetLimited) {
    reasons.push("full matrix CI budget is exhausted");
  }

  if (options.state.blocked) {
    return { eligibility: "blocked", reasons };
  }
  if (options.ciTier.budgetLimited) {
    return { eligibility: "wait", reasons };
  }
  if (options.state.stale) {
    return { eligibility: "needs_human", reasons };
  }
  if (options.hasVersionPlanning && !options.version) {
    return { eligibility: "needs_scope", reasons };
  }
  if (
    options.source.status === "working" ||
    options.source.status === "integrating"
  ) {
    return { eligibility: "wait", reasons };
  }
  if (
    options.state.dirty ||
    options.state.missingHead ||
    options.state.missingUpstream ||
    options.state.pushed === false
  ) {
    return { eligibility: "needs_verification", reasons };
  }
  if (options.source.status === "ready") {
    return { eligibility: "eligible", reasons };
  }

  return {
    eligibility: "wait",
    reasons: reasons.length > 0 ? reasons : [`source is ${options.source.status}`],
  };
}

function versionScope(options: {
  projectConfig: NexusProjectConfig;
  source: ReadinessSource;
  requestedVersionId: string | null;
}): NexusPublicationTrainVersionScope | null {
  const versions = options.projectConfig.versionPlanning?.versions ?? [];
  for (const version of versions) {
    if (options.requestedVersionId && version.id !== options.requestedVersionId) {
      continue;
    }
    const entry = version.scope.find((candidate) =>
      candidate.kind === "work_item" &&
      candidate.componentId === options.source.componentId &&
      candidate.workItemId === options.source.workItemId
    );
    if (entry) {
      return {
        versionId: version.id,
        objective: version.objective,
        targetBranch: version.targetBranch,
        scopeStatus: entry.status,
      };
    }
  }

  return null;
}

function ciTierPolicy(
  projectConfig: NexusProjectConfig,
  component: ResolvedNexusProjectComponent,
): NexusCiTierPolicyConfig {
  return (
    component.verification?.ciTiers ??
    projectConfig.automation?.verification.ciTiers ??
    defaultNexusCiTierPolicy
  );
}

function evidenceForSource(options: {
  source: ReadinessSource;
  branchName: string | null;
  ciTier: NexusCiTierDecision;
  providerEvidence: NexusPublicationTrainProviderEvidenceInput[];
}): NexusPublicationTrainEvidence {
  const requiredChecks = options.ciTier.requiredChecks;
  const evidence = findNexusPublicationProviderEvidence(
    normalizeNexusPublicationProviderEvidence(options.providerEvidence),
    {
      branchName: options.branchName,
      headSha: options.source.headCommit,
    },
  );
  const classification = classifyNexusPublicationProviderEvidenceChecks({
    evidence,
    requiredChecks,
  });

  if (requiredChecks.length === 0) {
    return {
      branchName: options.branchName,
      headCommit: options.source.headCommit,
      provider: evidence?.provider ?? null,
      providerSourceKind: evidence?.sourceKind ?? null,
      reviewTarget: evidence?.reviewTarget ?? null,
      headRef: evidence?.headRef ?? null,
      targetBranch: evidence?.targetBranch ?? null,
      intendedCiTier: evidence?.intendedCiTier ?? null,
      mergeability: evidence?.mergeability ?? null,
      branchPolicy: evidence?.branchPolicy ?? null,
      status: "not_required",
      requiredChecks: [],
      message: "selected CI tier has no required provider checks",
    };
  }

  if (!evidence) {
    return {
      branchName: options.branchName,
      headCommit: options.source.headCommit,
      provider: null,
      providerSourceKind: null,
      reviewTarget: null,
      headRef: null,
      targetBranch: null,
      intendedCiTier: null,
      mergeability: null,
      branchPolicy: null,
      status: "unavailable",
      requiredChecks: classification.requiredChecks.map((check) => ({
        name: check.name,
        status: check.status,
        url: check.url,
      })),
      message: "provider check evidence is unavailable",
    };
  }

  return {
    branchName: evidence.headBranch ?? options.branchName,
    headCommit: evidence.headSha ?? options.source.headCommit,
    provider: evidence.provider,
    providerSourceKind: evidence.sourceKind,
    reviewTarget: evidence.reviewTarget,
    headRef: evidence.headRef,
    targetBranch: evidence.targetBranch,
    intendedCiTier: evidence.intendedCiTier,
    mergeability: evidence.mergeability,
    branchPolicy: evidence.branchPolicy,
    status: classification.status,
    requiredChecks: classification.requiredChecks.map((check) => ({
      name: check.name,
      status: check.status,
      url: check.url,
    })),
    message: classification.message,
  };
}

function summarizeItems(
  items: NexusPublicationTrainReadinessItem[],
): NexusPublicationTrainReadinessSummary {
  return {
    itemCount: items.length,
    readyCount: items.filter((item) => item.state.status === "ready").length,
    eligibleCount: countByEligibility(items, "eligible"),
    blockedCount: countByEligibility(items, "blocked"),
    needsVerificationCount: countByEligibility(items, "needs_verification"),
    needsHumanCount: countByEligibility(items, "needs_human"),
    needsScopeCount: countByEligibility(items, "needs_scope"),
    waitCount: countByEligibility(items, "wait"),
    staleCount: items.filter((item) => item.state.stale).length,
    dirtyCount: items.filter((item) => item.state.dirty).length,
    unpushedCount: items.filter((item) => item.state.pushed === false).length,
    missingHeadCount: items.filter((item) => item.state.missingHead).length,
    missingUpstreamCount: items.filter((item) => item.state.missingUpstream)
      .length,
    missingEvidenceCount: items.filter(
      (item) =>
        item.evidence.status === "missing" ||
        item.evidence.status === "unavailable",
    ).length,
    budgetLimitedCount: items.filter((item) => item.ciTier.budgetLimited).length,
  };
}

function countByEligibility(
  items: NexusPublicationTrainReadinessItem[],
  eligibility: NexusPublicationTrainCandidateEligibility,
): number {
  return items.filter((item) => item.candidateEligibility === eligibility).length;
}

function groupByComponent(
  items: NexusPublicationTrainReadinessItem[],
): NexusPublicationTrainComponentGroup[] {
  const groups = new Map<string, NexusPublicationTrainReadinessItem[]>();
  for (const item of items) {
    groups.set(item.componentId, [...(groups.get(item.componentId) ?? []), item]);
  }
  return [...groups.entries()].map(([componentId, groupItems]) => ({
    componentId,
    componentName: groupItems[0]?.componentName ?? componentId,
    itemCount: groupItems.length,
    eligibleCount: countByEligibility(groupItems, "eligible"),
    items: groupItems,
  }));
}

function groupByVersion(
  items: NexusPublicationTrainReadinessItem[],
): NexusPublicationTrainVersionGroup[] {
  const groups = new Map<string, NexusPublicationTrainReadinessItem[]>();
  for (const item of items) {
    groups.set(item.version?.versionId ?? "", [
      ...(groups.get(item.version?.versionId ?? "") ?? []),
      item,
    ]);
  }
  return [...groups.entries()].map(([versionId, groupItems]) => ({
    versionId: versionId || null,
    objective: groupItems[0]?.version?.objective ?? null,
    targetBranch: groupItems[0]?.version?.targetBranch ?? null,
    itemCount: groupItems.length,
    eligibleCount: countByEligibility(groupItems, "eligible"),
    items: groupItems,
  }));
}

function nextAction(
  items: NexusPublicationTrainReadinessItem[],
): NexusPublicationTrainNextAction {
  if (countByEligibility(items, "eligible") > 0) {
    return "create_candidate_branch";
  }
  if (countByEligibility(items, "needs_verification") > 0) {
    return "verify";
  }
  if (countByEligibility(items, "blocked") > 0) {
    return "resolve_blockers";
  }
  if (
    countByEligibility(items, "needs_scope") > 0 ||
    countByEligibility(items, "needs_human") > 0
  ) {
    return "request_human_decision";
  }
  return "wait";
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function isoString(value: Date | string | (() => Date | string)): string {
  const actual = typeof value === "function" ? value() : value;
  const date = actual instanceof Date ? actual : new Date(actual);
  if (Number.isNaN(date.getTime())) {
    throw new Error("now must be a valid date");
  }
  return date.toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
