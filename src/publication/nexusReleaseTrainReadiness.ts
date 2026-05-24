import path from "node:path";
import {
  defaultNexusCiTierPolicy,
  resolveNexusCiTierDecision,
  type NexusCiTierDecision,
  type NexusCiTierPolicyConfig,
} from "../operations/nexusCiTierPolicy.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
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
} from "../project/nexusProjectLifecycle.js";
import {
  listNexusWorktreeLeases,
  type NexusWorktreeLeaseStatus,
} from "../worktrees/nexusWorktreeLease.js";
import type {
  NexusVersionConfig,
  NexusVersionScopeStatus,
} from "../operations/nexusVersionPlanningConfig.js";

export type NexusReleaseTrainSourceKind = "lease" | "handoff";

export type NexusReleaseTrainCandidateEligibility =
  | "eligible"
  | "wait"
  | "needs_scope"
  | "needs_verification"
  | "needs_human"
  | "blocked";

export type NexusReleaseTrainEvidenceStatus =
  | "not_required"
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unavailable";

export type NexusReleaseTrainCheckEvidenceStatus =
  | "success"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unknown";

export type NexusReleaseTrainNextAction =
  | "wait"
  | "verify"
  | "resolve_blockers"
  | "create_candidate_branch"
  | "request_human_decision";

export type NexusReleaseTrainProviderCheckInput =
  NexusPublicationProviderCheckInput;

export type NexusReleaseTrainProviderEvidenceInput =
  NexusPublicationProviderEvidenceInput;

export interface NexusReleaseTrainHandoffInput {
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

export interface BuildNexusReleaseTrainReadinessReportOptions {
  projectRoot: string;
  versionId?: string | null;
  fullMatrixBudgetAvailable?: boolean | null;
  providerEvidence?: NexusReleaseTrainProviderEvidenceInput[];
  handoffs?: NexusReleaseTrainHandoffInput[];
  now?: Date | string | (() => Date | string);
}

export interface NexusReleaseTrainSourceState {
  status: NexusWorktreeLeaseStatus | NexusReleaseTrainHandoffInput["status"];
  stale: boolean;
  blocked: boolean;
  dirty: boolean | null;
  pushed: boolean | null;
  missingHead: boolean;
  missingUpstream: boolean;
  warnings: string[];
}

export interface NexusReleaseTrainVersionScope {
  versionId: string;
  objective: string;
  targetBranch: string;
  scopeStatus: NexusVersionScopeStatus;
}

export interface NexusReleaseTrainCheckEvidence {
  name: string;
  status: NexusReleaseTrainCheckEvidenceStatus;
  url: string | null;
}

export interface NexusReleaseTrainEvidence {
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
  status: NexusReleaseTrainEvidenceStatus;
  requiredChecks: NexusReleaseTrainCheckEvidence[];
  message: string;
}

export interface NexusReleaseTrainReadinessItem {
  sourceKind: NexusReleaseTrainSourceKind;
  sourceId: string;
  componentId: string;
  componentName: string;
  workItemId: string | null;
  branchName: string | null;
  candidateBranchName: string | null;
  version: NexusReleaseTrainVersionScope | null;
  state: NexusReleaseTrainSourceState;
  candidateEligibility: NexusReleaseTrainCandidateEligibility;
  reasons: string[];
  ciTier: NexusCiTierDecision;
  evidence: NexusReleaseTrainEvidence;
  changedAreas: string[];
}

export interface NexusReleaseTrainComponentGroup {
  componentId: string;
  componentName: string;
  itemCount: number;
  eligibleCount: number;
  items: NexusReleaseTrainReadinessItem[];
}

export interface NexusReleaseTrainVersionGroup {
  versionId: string | null;
  objective: string | null;
  targetBranch: string | null;
  itemCount: number;
  eligibleCount: number;
  items: NexusReleaseTrainReadinessItem[];
}

export interface NexusReleaseTrainReadinessSummary {
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

export interface NexusReleaseTrainReadinessReport {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: {
    id: string;
    name: string;
    componentCount: number;
  };
  summary: NexusReleaseTrainReadinessSummary;
  components: NexusReleaseTrainComponentGroup[];
  versions: NexusReleaseTrainVersionGroup[];
  nextAction: NexusReleaseTrainNextAction;
  warnings: string[];
}

interface ReadinessSource {
  sourceKind: NexusReleaseTrainSourceKind;
  sourceId: string;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
  status: NexusWorktreeLeaseStatus | NexusReleaseTrainHandoffInput["status"];
  stale: boolean;
  dirty: boolean | null;
  pushed: boolean | null;
  upstream: string | null;
  headCommit: string | null;
  warnings: string[];
  changedAreas: string[];
}

interface ClassifiedReadiness {
  eligibility: NexusReleaseTrainCandidateEligibility;
  reasons: string[];
}

export function buildNexusReleaseTrainReadinessReport(
  options: BuildNexusReleaseTrainReadinessReportOptions,
): NexusReleaseTrainReadinessReport {
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
    .filter((item): item is NexusReleaseTrainReadinessItem => item !== null);

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
  options: BuildNexusReleaseTrainReadinessReportOptions;
  warnings: string[];
}): NexusReleaseTrainReadinessItem | null {
  const component = options.components.find(
    (candidate) => candidate.id === options.source.componentId,
  );
  if (!component) {
    options.warnings.push(
      `Release train source ${options.source.sourceId} references unknown component ${options.source.componentId ?? "none"}.`,
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

function handoffSource(handoff: NexusReleaseTrainHandoffInput): ReadinessSource {
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

function sourceState(source: ReadinessSource): NexusReleaseTrainSourceState {
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
  state: NexusReleaseTrainSourceState;
  version: NexusReleaseTrainVersionScope | null;
  hasVersionPlanning: boolean;
  ciTier: NexusCiTierDecision;
}): ClassifiedReadiness {
  const reasons = readinessReasons(options);
  const eligibility = readinessEligibility(options);

  return eligibility === "wait" && reasons.length === 0
    ? { eligibility, reasons: [`source is ${options.source.status}`] }
    : { eligibility, reasons };
}

function readinessReasons(options: {
  source: ReadinessSource;
  state: NexusReleaseTrainSourceState;
  version: NexusReleaseTrainVersionScope | null;
  hasVersionPlanning: boolean;
  ciTier: NexusCiTierDecision;
}): string[] {
  return [
    options.state.blocked ? "source is blocked" : null,
    options.state.stale ? "source readiness is stale" : null,
    sourceInProgress(options.source)
      ? `source is still ${options.source.status}`
      : null,
    options.state.dirty ? "worktree has uncommitted changes" : null,
    options.state.missingHead ? "head commit is missing" : null,
    options.state.missingUpstream ? "upstream branch is missing" : null,
    options.state.pushed === false ? "branch has unpushed commits" : null,
    options.hasVersionPlanning && !options.version
      ? "work item is not in version scope"
      : null,
    options.ciTier.budgetLimited ? "full matrix CI budget is exhausted" : null,
  ].filter((reason): reason is string => Boolean(reason));
}

function readinessEligibility(options: {
  source: ReadinessSource;
  state: NexusReleaseTrainSourceState;
  version: NexusReleaseTrainVersionScope | null;
  hasVersionPlanning: boolean;
  ciTier: NexusCiTierDecision;
}): NexusReleaseTrainCandidateEligibility {
  if (options.state.blocked) {
    return "blocked";
  }
  if (options.ciTier.budgetLimited || sourceInProgress(options.source)) {
    return "wait";
  }
  if (options.state.stale) {
    return "needs_human";
  }
  if (options.hasVersionPlanning && !options.version) {
    return "needs_scope";
  }
  if (needsVerification(options.state)) {
    return "needs_verification";
  }
  return options.source.status === "ready" ? "eligible" : "wait";
}

function sourceInProgress(source: ReadinessSource): boolean {
  return source.status === "working" || source.status === "integrating";
}

function needsVerification(state: NexusReleaseTrainSourceState): boolean {
  return (
    state.dirty === true ||
    state.missingHead ||
    state.missingUpstream ||
    state.pushed === false
  );
}

function versionScope(options: {
  projectConfig: NexusProjectConfig;
  source: ReadinessSource;
  requestedVersionId: string | null;
}): NexusReleaseTrainVersionScope | null {
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
  providerEvidence: NexusReleaseTrainProviderEvidenceInput[];
}): NexusReleaseTrainEvidence {
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
  items: NexusReleaseTrainReadinessItem[],
): NexusReleaseTrainReadinessSummary {
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
  items: NexusReleaseTrainReadinessItem[],
  eligibility: NexusReleaseTrainCandidateEligibility,
): number {
  return items.filter((item) => item.candidateEligibility === eligibility).length;
}

function groupByComponent(
  items: NexusReleaseTrainReadinessItem[],
): NexusReleaseTrainComponentGroup[] {
  const groups = new Map<string, NexusReleaseTrainReadinessItem[]>();
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
  items: NexusReleaseTrainReadinessItem[],
): NexusReleaseTrainVersionGroup[] {
  const groups = new Map<string, NexusReleaseTrainReadinessItem[]>();
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
  items: NexusReleaseTrainReadinessItem[],
): NexusReleaseTrainNextAction {
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
