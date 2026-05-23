import {
  buildNexusReleaseTrainReadinessReport,
  type BuildNexusReleaseTrainReadinessReportOptions,
  type NexusReleaseTrainReadinessItem,
  type NexusReleaseTrainReadinessReport,
  type NexusReleaseTrainVersionGroup,
} from "./nexusReleaseTrainReadiness.js";
import type { NexusCiTierDecision } from "./nexusCiTierPolicy.js";

export type NexusCandidateBranchPlanNextAction =
  | "wait"
  | "verify"
  | "resolve_blockers"
  | "create_integration_branch"
  | "request_human_decision";

export type NexusCandidateBranchPlanItemCategory =
  | "included"
  | "deferred"
  | "excluded"
  | "blocked";

export interface NexusCandidateBranchNamingPolicy {
  integrationPrefix?: string;
  candidatePrefix?: string;
  unscopedName?: string;
}

export interface BuildNexusCandidateBranchPlanOptions
  extends BuildNexusReleaseTrainReadinessReportOptions {
  integrationBranchName?: string | null;
  candidateBranchName?: string | null;
  branchNaming?: NexusCandidateBranchNamingPolicy;
}

export interface NexusCandidateBranchPlanItem {
  category: NexusCandidateBranchPlanItemCategory;
  componentId: string;
  componentName: string;
  workItemId: string | null;
  branchName: string | null;
  sourceId: string;
  scopeStatus: string | null;
  candidateEligibility: NexusReleaseTrainReadinessItem["candidateEligibility"];
  changedAreas: string[];
  reasons: string[];
}

export interface NexusCandidateBranchChangedAreaOverlap {
  changedArea: string;
  workItemIds: string[];
  branches: string[];
}

export interface NexusCandidateBranchPlanSummary {
  selectedVersionId: string | null;
  includedCount: number;
  deferredCount: number;
  excludedCount: number;
  blockedCount: number;
  overlapCount: number;
}

export interface NexusCandidateBranchPlan {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: NexusReleaseTrainReadinessReport["project"];
  selectedVersion: {
    id: string | null;
    objective: string | null;
    targetBranch: string | null;
  };
  branches: {
    integration: string;
    candidate: string;
  };
  summary: NexusCandidateBranchPlanSummary;
  included: NexusCandidateBranchPlanItem[];
  deferred: NexusCandidateBranchPlanItem[];
  excluded: NexusCandidateBranchPlanItem[];
  blocked: NexusCandidateBranchPlanItem[];
  changedAreaOverlaps: NexusCandidateBranchChangedAreaOverlap[];
  candidateCiTier: NexusCiTierDecision | null;
  nextAction: NexusCandidateBranchPlanNextAction;
  warnings: string[];
  readiness: NexusReleaseTrainReadinessReport;
  mutatesSource: false;
}

const defaultBranchNaming: Required<NexusCandidateBranchNamingPolicy> = {
  integrationPrefix: "integration",
  candidatePrefix: "candidate",
  unscopedName: "manual",
};

export function buildNexusCandidateBranchPlan(
  options: BuildNexusCandidateBranchPlanOptions,
): NexusCandidateBranchPlan {
  const readiness = buildNexusReleaseTrainReadinessReport(options);
  const warnings = [...readiness.warnings];
  const selectedGroup = selectVersionGroup(readiness, options.versionId ?? null);
  if (!selectedGroup && readiness.versions.filter((group) => group.eligibleCount > 0).length > 1) {
    warnings.push(
      "Multiple version groups have eligible branches; pass versionId or --version before planning a candidate branch.",
    );
  }
  const selectedItems = selectedGroup?.items ?? [];
  const planItems = selectedItems.map(planItem);
  const included = planItems.filter((item) => item.category === "included");
  const deferred = planItems.filter((item) => item.category === "deferred");
  const excluded = [
    ...planItems.filter((item) => item.category === "excluded"),
    ...itemsExcludedBySelection(readiness, selectedGroup).map(planItem),
  ];
  const blocked = planItems.filter((item) => item.category === "blocked");
  const changedAreaOverlaps = overlaps(included);
  const naming = { ...defaultBranchNaming, ...(options.branchNaming ?? {}) };
  const selectedVersionId = selectedGroup?.versionId ?? null;
  const branches = {
    integration: options.integrationBranchName ??
      branchName(naming.integrationPrefix, selectedVersionId, naming.unscopedName),
    candidate: options.candidateBranchName ??
      branchName(naming.candidatePrefix, selectedVersionId, naming.unscopedName),
  };
  const candidateCiTier = selectedItems.find((item) => item.ciTier)?.ciTier ?? null;
  const summary = {
    selectedVersionId,
    includedCount: included.length,
    deferredCount: deferred.length,
    excludedCount: excluded.length,
    blockedCount: blocked.length,
    overlapCount: changedAreaOverlaps.length,
  };

  return {
    version: 1,
    generatedAt: readiness.generatedAt,
    projectRoot: readiness.projectRoot,
    project: readiness.project,
    selectedVersion: {
      id: selectedVersionId,
      objective: selectedGroup?.objective ?? null,
      targetBranch: selectedGroup?.targetBranch ?? null,
    },
    branches,
    summary,
    included,
    deferred,
    excluded,
    blocked,
    changedAreaOverlaps,
    candidateCiTier,
    nextAction: planNextAction({
      included,
      deferred,
      excluded,
      blocked,
      changedAreaOverlaps,
      selectedGroup,
      readiness,
    }),
    warnings,
    readiness,
    mutatesSource: false,
  };
}

function selectVersionGroup(
  readiness: NexusReleaseTrainReadinessReport,
  requestedVersionId: string | null,
): NexusReleaseTrainVersionGroup | null {
  if (requestedVersionId) {
    return readiness.versions.find((group) => group.versionId === requestedVersionId) ??
      null;
  }
  if (readiness.versions.length === 1) {
    return readiness.versions[0]!;
  }
  const eligibleGroups = readiness.versions.filter((group) => group.eligibleCount > 0);
  if (eligibleGroups.length === 1) {
    return eligibleGroups[0]!;
  }
  return null;
}

function planItem(item: NexusReleaseTrainReadinessItem): NexusCandidateBranchPlanItem {
  const category = itemCategory(item);
  return {
    category,
    componentId: item.componentId,
    componentName: item.componentName,
    workItemId: item.workItemId,
    branchName: item.branchName,
    sourceId: item.sourceId,
    scopeStatus: item.version?.scopeStatus ?? null,
    candidateEligibility: item.candidateEligibility,
    changedAreas: [...item.changedAreas],
    reasons: itemReasons(item, category),
  };
}

function itemCategory(
  item: NexusReleaseTrainReadinessItem,
): NexusCandidateBranchPlanItemCategory {
  if (item.version?.scopeStatus === "excluded" || item.candidateEligibility === "needs_scope") {
    return "excluded";
  }
  if (
    item.version?.scopeStatus === "deferred" ||
    item.version?.scopeStatus === "stretch" ||
    item.candidateEligibility === "wait"
  ) {
    return "deferred";
  }
  if (
    item.candidateEligibility === "blocked" ||
    item.candidateEligibility === "needs_verification" ||
    item.candidateEligibility === "needs_human"
  ) {
    return "blocked";
  }
  return "included";
}

function itemReasons(
  item: NexusReleaseTrainReadinessItem,
  category: NexusCandidateBranchPlanItemCategory,
): string[] {
  const reasons = [...item.reasons];
  if (item.version?.scopeStatus === "excluded") {
    reasons.push("work item is excluded from this version");
  }
  if (item.version?.scopeStatus === "deferred") {
    reasons.push("work item is deferred from this version");
  }
  if (item.version?.scopeStatus === "stretch") {
    reasons.push("work item is stretch scope");
  }
  if (category === "included" && reasons.length === 0) {
    reasons.push("ready for candidate batching");
  }
  return uniqueStrings(reasons);
}

function itemsExcludedBySelection(
  readiness: NexusReleaseTrainReadinessReport,
  selectedGroup: NexusReleaseTrainVersionGroup | null,
): NexusReleaseTrainReadinessItem[] {
  if (!selectedGroup) {
    return readiness.versions.flatMap((group) => group.items);
  }
  return readiness.versions
    .filter((group) => group !== selectedGroup)
    .flatMap((group) => group.items);
}

function overlaps(
  items: NexusCandidateBranchPlanItem[],
): NexusCandidateBranchChangedAreaOverlap[] {
  const byArea = new Map<string, NexusCandidateBranchPlanItem[]>();
  for (const item of items) {
    for (const changedArea of item.changedAreas) {
      byArea.set(changedArea, [...(byArea.get(changedArea) ?? []), item]);
    }
  }
  return [...byArea.entries()]
    .filter(([, areaItems]) => areaItems.length > 1)
    .map(([changedArea, areaItems]) => ({
      changedArea,
      workItemIds: uniqueStrings(areaItems.map((item) => item.workItemId ?? item.sourceId)),
      branches: uniqueStrings(
        areaItems
          .map((item) => item.branchName)
          .filter((branch): branch is string => branch !== null),
      ),
    }));
}

function planNextAction(options: {
  included: NexusCandidateBranchPlanItem[];
  deferred: NexusCandidateBranchPlanItem[];
  excluded: NexusCandidateBranchPlanItem[];
  blocked: NexusCandidateBranchPlanItem[];
  changedAreaOverlaps: NexusCandidateBranchChangedAreaOverlap[];
  selectedGroup: NexusReleaseTrainVersionGroup | null;
  readiness: NexusReleaseTrainReadinessReport;
}): NexusCandidateBranchPlanNextAction {
  if (
    !options.selectedGroup &&
    options.readiness.versions.filter((group) => group.eligibleCount > 0).length > 1
  ) {
    return "request_human_decision";
  }
  if (options.included.length > 0 && options.changedAreaOverlaps.length === 0) {
    return "create_integration_branch";
  }
  if (options.changedAreaOverlaps.length > 0) {
    return "request_human_decision";
  }
  if (
    options.blocked.some((item) =>
      item.candidateEligibility === "needs_verification"
    )
  ) {
    return "verify";
  }
  if (options.blocked.some((item) => item.candidateEligibility === "blocked")) {
    return "resolve_blockers";
  }
  if (
    options.blocked.some((item) => item.candidateEligibility === "needs_human") ||
    options.excluded.length > 0
  ) {
    return "request_human_decision";
  }
  return "wait";
}

function branchName(prefix: string, versionId: string | null, unscopedName: string): string {
  return `${prefix.replace(/\/+$/u, "")}/${versionId ?? unscopedName}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
