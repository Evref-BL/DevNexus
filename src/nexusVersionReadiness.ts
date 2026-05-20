import type {
  NexusAutomationTargetCycleRecord,
  NexusAutomationTargetCycleWorkItem,
} from "./nexusAutomationTargetCycle.js";
import type {
  NexusAuthorityAction,
  NexusAuthorityComponentSummary,
  NexusAuthorityProjectSummary,
} from "./nexusAuthority.js";
import type {
  NexusGreenMainChecksStatus,
  NexusPublicationStatus,
} from "./nexusPublicationPolicy.js";
import type {
  NexusVersionConfig,
  NexusVersionReadinessGate,
  NexusVersionReadinessGateKind,
  NexusVersionReleaseActionPolicy,
  NexusVersionReleaseArtifactPolicy,
  NexusVersionScopeStatus,
} from "./nexusVersionPlanningConfig.js";
import type {
  NexusVersionResolvedScopeItem,
  NexusVersionScopeResult,
} from "./nexusVersionScopeResolver.js";
import type { WorkStatus } from "./workTrackingTypes.js";
import type {
  WorktreePublicationDecision,
  WorktreeVerificationRecord,
} from "./worktreeExecutionMetadata.js";

export type NexusVersionReadinessGateStatus =
  | "passed"
  | "failed"
  | "warning"
  | "not_applicable";

export type NexusVersionReadinessWarningCode =
  | "scope_warning"
  | "gate_no_evidence"
  | "release_authority_missing"
  | "release_artifact_missing";

export type NexusVersionReleaseReadinessState =
  | "ready"
  | "blocked"
  | "warning"
  | "not_required";

export type NexusVersionReleaseActionName =
  | "tags"
  | "packages"
  | "providerRelease";

export type NexusVersionReleaseArtifactName = "releaseNotes" | "changelog";

export type NexusVersionGateEvidenceStatus =
  | "passed"
  | "failed"
  | "unknown";

export interface NexusVersionGreenMainValidationEvidence {
  componentId: string;
  source: "branch" | "pull_request";
  status: NexusGreenMainChecksStatus;
  checkNames: string[];
  targetBranch?: string | null;
  message?: string | null;
}

export interface NexusVersionReadinessGateEvidence {
  kind: NexusVersionReadinessGateKind;
  componentId?: string | null;
  status: NexusVersionGateEvidenceStatus;
  name?: string | null;
  message?: string | null;
}

export interface NexusVersionReleaseArtifactEvidence {
  kind: NexusVersionReleaseArtifactName;
  componentId?: string | null;
  status: "ready" | "missing" | "not_required";
  message?: string | null;
}

export interface NexusVersionReadinessFacts {
  targetCycles?: readonly NexusAutomationTargetCycleRecord[];
  verification?: readonly WorktreeVerificationRecord[];
  publicationDecisions?: readonly WorktreePublicationDecision[];
  authority?: NexusAuthorityProjectSummary | null;
  publicationStatuses?: readonly NexusPublicationStatus[];
  greenMainValidation?: readonly NexusVersionGreenMainValidationEvidence[];
  gateEvidence?: readonly NexusVersionReadinessGateEvidence[];
  releaseArtifacts?: readonly NexusVersionReleaseArtifactEvidence[];
}

export interface NexusVersionReadinessWarning {
  code: NexusVersionReadinessWarningCode;
  message: string;
  gateKind: NexusVersionReadinessGateKind | null;
  componentId: string | null;
}

export type NexusVersionCountMap<T extends string> = Record<T, number>;

export interface NexusVersionComponentProgressCounts {
  componentId: string;
  totalScopeItemCount: number;
  requiredScopeItemCount: number;
  byWorkStatus: NexusVersionCountMap<WorkStatus>;
  byScopeStatus: NexusVersionCountMap<NexusVersionScopeStatus>;
  blockedWorkItemCount: number;
  failedWorkItemCount: number;
  deferredWorkItemCount: number;
  stretchWorkItemCount: number;
}

export interface NexusVersionProgressCounts {
  totalScopeItemCount: number;
  requiredScopeItemCount: number;
  byComponent: Record<string, NexusVersionComponentProgressCounts>;
  byWorkStatus: NexusVersionCountMap<WorkStatus>;
  byScopeStatus: NexusVersionCountMap<NexusVersionScopeStatus>;
  byBlockerState: {
    blocked: number;
    unblocked: number;
  };
  blockedWorkItemCount: number;
  blockedWorkItemIds: string[];
  failedWorkItemCount: number;
  failedWorkItemIds: string[];
  deferredWorkItemCount: number;
  stretchWorkItemCount: number;
}

export interface NexusVersionReadinessGateReport {
  kind: NexusVersionReadinessGateKind;
  required: boolean;
  components: string[];
  status: NexusVersionReadinessGateStatus;
  message: string;
  checkedWorkItemIds: string[];
  failingWorkItemIds: string[];
  evidence: string[];
  evidenceOnly: boolean;
  grantsAuthority: false;
}

export interface NexusVersionAuthorityActionSummary {
  allowed: boolean;
  blocked: boolean;
  waiting: boolean;
}

export interface NexusVersionAuthorityComponentReadiness {
  componentId: string;
  allowedActions: NexusAuthorityAction[];
  blockedActions: NexusAuthorityAction[];
  waitingActions: NexusAuthorityAction[];
}

export interface NexusVersionAuthorityReadinessSummary {
  directTargetPushAllowed: boolean;
  mergeAllowed: boolean;
  packagePublishAllowed: boolean;
  releasePublishAllowed: boolean;
  byComponent: Record<string, NexusVersionAuthorityComponentReadiness>;
}

export interface NexusVersionReleaseActionReadiness {
  name: NexusVersionReleaseActionName;
  policy: NexusVersionReleaseActionPolicy;
  authorityAction: NexusAuthorityAction | null;
  state: NexusVersionReleaseReadinessState;
  message: string;
}

export interface NexusVersionReleaseArtifactReadiness {
  name: NexusVersionReleaseArtifactName;
  policy: NexusVersionReleaseArtifactPolicy;
  state: NexusVersionReleaseReadinessState;
  message: string;
}

export interface NexusVersionReleaseReadinessReport {
  state: NexusVersionReleaseReadinessState;
  actions: NexusVersionReleaseActionReadiness[];
  artifacts: NexusVersionReleaseArtifactReadiness[];
  publicationDecisionEvidence: string[];
  warnings: NexusVersionReadinessWarning[];
}

export interface NexusVersionReadinessReport {
  versionId: string;
  objective: string;
  targetBranch: string;
  ready: boolean;
  progress: NexusVersionProgressCounts;
  gates: NexusVersionReadinessGateReport[];
  gateByKind: Partial<
    Record<NexusVersionReadinessGateKind, NexusVersionReadinessGateReport>
  >;
  release: NexusVersionReleaseReadinessReport;
  authority: NexusVersionAuthorityReadinessSummary;
  warnings: NexusVersionReadinessWarning[];
}

export interface ReportNexusVersionReadinessOptions {
  version: NexusVersionConfig;
  scope: NexusVersionScopeResult;
  facts?: NexusVersionReadinessFacts;
}

const workStatuses: WorkStatus[] = [
  "todo",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "wont_do",
];

const scopeStatuses: NexusVersionScopeStatus[] = [
  "committed",
  "candidate",
  "stretch",
  "deferred",
  "excluded",
];

export function reportNexusVersionReadiness(
  options: ReportNexusVersionReadinessOptions,
): NexusVersionReadinessReport {
  const facts = options.facts ?? {};
  const warnings: NexusVersionReadinessWarning[] = options.scope.warnings.map(
    (warning) => ({
      code: "scope_warning",
      gateKind: null,
      componentId: warning.componentId,
      message: warning.message,
    }),
  );
  const progress = summarizeProgress({
    version: options.version,
    scopeItems: options.scope.items,
    targetCycles: facts.targetCycles ?? [],
  });
  const authority = summarizeAuthority(
    options.version,
    facts.authority ?? null,
  );
  const release = summarizeRelease({
    version: options.version,
    authority,
    publicationDecisions: facts.publicationDecisions ?? [],
    releaseArtifacts: facts.releaseArtifacts ?? [],
  });
  const gates: NexusVersionReadinessGateReport[] = [];
  let releaseWarningsAdded = false;

  for (const gate of options.version.readinessGates) {
    if (gate.kind === "release_authority" && !releaseWarningsAdded) {
      warnings.push(...release.warnings);
      releaseWarningsAdded = true;
    }
    const report = evaluateGate({
      gate,
      version: options.version,
      scopeItems: options.scope.items,
      progress,
      facts,
      release,
    });
    gates.push(report);
    if (report.status === "warning") {
      warnings.push({
        code: "gate_no_evidence",
        gateKind: gate.kind,
        componentId: report.components.length === 1 ? report.components[0]! : null,
        message: report.message,
      });
    }
  }
  if (!releaseWarningsAdded) {
    warnings.push(...release.warnings);
  }

  const gateByKind: Partial<
    Record<NexusVersionReadinessGateKind, NexusVersionReadinessGateReport>
  > = {};
  for (const gate of gates) {
    gateByKind[gate.kind] = gate;
  }

  const requiredGatesReady = gates
    .filter((gate) => gate.required)
    .every((gate) => gate.status === "passed" || gate.status === "not_applicable");

  return {
    versionId: options.version.id,
    objective: options.version.objective,
    targetBranch: options.version.targetBranch,
    ready: requiredGatesReady,
    progress,
    gates,
    gateByKind,
    release,
    authority,
    warnings,
  };
}

function summarizeProgress(options: {
  version: NexusVersionConfig;
  scopeItems: readonly NexusVersionResolvedScopeItem[];
  targetCycles: readonly NexusAutomationTargetCycleRecord[];
}): NexusVersionProgressCounts {
  const byComponent: Record<string, NexusVersionComponentProgressCounts> = {};
  for (const componentId of unique([
    ...options.version.owningComponents,
    ...options.scopeItems.map((item) => item.componentId),
  ])) {
    byComponent[componentId] = emptyComponentProgress(componentId);
  }

  const progress: NexusVersionProgressCounts = {
    totalScopeItemCount: 0,
    requiredScopeItemCount: 0,
    byComponent,
    byWorkStatus: emptyCountMap(workStatuses),
    byScopeStatus: emptyCountMap(scopeStatuses),
    byBlockerState: {
      blocked: 0,
      unblocked: 0,
    },
    blockedWorkItemCount: 0,
    blockedWorkItemIds: [],
    failedWorkItemCount: 0,
    failedWorkItemIds: [],
    deferredWorkItemCount: 0,
    stretchWorkItemCount: 0,
  };

  for (const item of options.scopeItems) {
    const component = byComponent[item.componentId] ??
      (byComponent[item.componentId] = emptyComponentProgress(item.componentId));
    const statusMemberships = itemScopeStatuses(item);
    const required = isRequiredScopeItem(item);
    const blocked = item.workItem.status === "blocked";
    const failed = hasFailedCycleHistory(item, options.targetCycles);

    progress.totalScopeItemCount += 1;
    component.totalScopeItemCount += 1;
    if (required) {
      progress.requiredScopeItemCount += 1;
      component.requiredScopeItemCount += 1;
    }
    increment(progress.byWorkStatus, item.workItem.status);
    increment(component.byWorkStatus, item.workItem.status);
    for (const scopeStatus of statusMemberships) {
      increment(progress.byScopeStatus, scopeStatus);
      increment(component.byScopeStatus, scopeStatus);
    }
    if (blocked) {
      progress.blockedWorkItemCount += 1;
      component.blockedWorkItemCount += 1;
      progress.byBlockerState.blocked += 1;
      progress.blockedWorkItemIds.push(item.workItem.id);
    } else {
      progress.byBlockerState.unblocked += 1;
    }
    if (failed) {
      progress.failedWorkItemCount += 1;
      component.failedWorkItemCount += 1;
      progress.failedWorkItemIds.push(item.workItem.id);
    }
    if (statusMemberships.includes("deferred")) {
      progress.deferredWorkItemCount += 1;
      component.deferredWorkItemCount += 1;
    }
    if (statusMemberships.includes("stretch")) {
      progress.stretchWorkItemCount += 1;
      component.stretchWorkItemCount += 1;
    }
  }

  return progress;
}

function evaluateGate(options: {
  gate: NexusVersionReadinessGate;
  version: NexusVersionConfig;
  scopeItems: readonly NexusVersionResolvedScopeItem[];
  progress: NexusVersionProgressCounts;
  facts: NexusVersionReadinessFacts;
  release: NexusVersionReleaseReadinessReport;
}): NexusVersionReadinessGateReport {
  switch (options.gate.kind) {
    case "work_items_done":
      return evaluateWorkItemsDoneGate(options);
    case "no_blockers":
      return evaluateNoBlockersGate(options);
    case "checks_green":
      return evaluateChecksGreenGate(options);
    case "docs_ready":
    case "migration_ready":
      return evaluateGenericEvidenceGate(options);
    case "release_authority":
      return evaluateReleaseAuthorityGate(options);
  }
}

function evaluateWorkItemsDoneGate(options: {
  gate: NexusVersionReadinessGate;
  version: NexusVersionConfig;
  scopeItems: readonly NexusVersionResolvedScopeItem[];
  progress: NexusVersionProgressCounts;
}): NexusVersionReadinessGateReport {
  const components = gateComponents(options.gate, options.version);
  const checkedItems = options.scopeItems.filter((item) =>
    components.includes(item.componentId) && isRequiredScopeItem(item)
  );
  if (checkedItems.length === 0) {
    return gateReport({
      gate: options.gate,
      components,
      status: "warning",
      message: "No committed or candidate scope items are available to evaluate.",
    });
  }

  const failedIds = new Set(options.progress.failedWorkItemIds);
  const failing = checkedItems.filter((item) =>
    item.workItem.status !== "done" || failedIds.has(item.workItem.id)
  );

  return gateReport({
    gate: options.gate,
    components,
    status: failing.length === 0 ? "passed" : "failed",
    message: failing.length === 0
      ? "All committed and candidate scope items are done."
      : "Some committed or candidate scope items are not done.",
    checkedWorkItemIds: checkedItems.map((item) => item.workItem.id),
    failingWorkItemIds: failing.map((item) => item.workItem.id),
    evidence: [
      `${checkedItems.length - failing.length}/${checkedItems.length} required work item(s) done`,
    ],
  });
}

function evaluateNoBlockersGate(options: {
  gate: NexusVersionReadinessGate;
  version: NexusVersionConfig;
  scopeItems: readonly NexusVersionResolvedScopeItem[];
  facts: NexusVersionReadinessFacts;
}): NexusVersionReadinessGateReport {
  const components = gateComponents(options.gate, options.version);
  const scopedItems = options.scopeItems.filter((item) =>
    components.includes(item.componentId)
  );
  const blockedItems = scopedItems.filter((item) =>
    item.workItem.status === "blocked"
  );
  const activeBlockers = (options.facts.targetCycles ?? []).flatMap((cycle) =>
    cycle.blockers,
  );

  return gateReport({
    gate: options.gate,
    components,
    status: blockedItems.length === 0 && activeBlockers.length === 0
      ? "passed"
      : "failed",
    message: blockedItems.length === 0 && activeBlockers.length === 0
      ? "No scoped work items or target cycles report active blockers."
      : "Scoped work or target-cycle facts report active blockers.",
    checkedWorkItemIds: scopedItems.map((item) => item.workItem.id),
    failingWorkItemIds: blockedItems.map((item) => item.workItem.id),
    evidence: activeBlockers,
  });
}

function evaluateChecksGreenGate(options: {
  gate: NexusVersionReadinessGate;
  version: NexusVersionConfig;
  facts: NexusVersionReadinessFacts;
}): NexusVersionReadinessGateReport {
  const components = gateComponents(options.gate, options.version);
  const greenMainEvidence = collectGreenMainEvidence(options.facts);
  const evidence: string[] = [];
  let failed = false;
  let warning = false;

  for (const componentId of components) {
    const componentEvidence = greenMainEvidence.filter((candidate) =>
      candidate.componentId === componentId &&
      candidate.targetBranch !== null &&
      coversRequiredChecks(candidate.checkNames, options.gate.checkNames ?? [])
    );
    const passedVerification = checksPassedByVerification(
      options.facts.verification ?? [],
      options.gate.checkNames ?? [],
    );
    if (
      componentEvidence.some((candidate) =>
        candidate.status === "green" ||
        candidate.status === "not_required"
      ) ||
      passedVerification
    ) {
      evidence.push(
        `${componentId}: green-main ${componentEvidence[0]?.status ?? "verification_passed"}`,
      );
      continue;
    }
    if (
      componentEvidence.some((candidate) =>
        candidate.status === "failed" || candidate.status === "stale"
      )
    ) {
      failed = true;
      evidence.push(`${componentId}: checks failed or stale`);
      continue;
    }
    warning = true;
    evidence.push(`${componentId}: no green check evidence`);
  }

  return gateReport({
    gate: options.gate,
    components,
    status: failed ? "failed" : warning ? "warning" : "passed",
    message: failed
      ? "Configured checks are not green."
      : warning
        ? "Configured checks cannot be evaluated from available facts."
        : "Configured checks are green from validation evidence.",
    evidence,
    evidenceOnly: true,
  });
}

function evaluateGenericEvidenceGate(options: {
  gate: NexusVersionReadinessGate;
  version: NexusVersionConfig;
  facts: NexusVersionReadinessFacts;
}): NexusVersionReadinessGateReport {
  const components = gateComponents(options.gate, options.version);
  const evidence = (options.facts.gateEvidence ?? []).filter((candidate) =>
    candidate.kind === options.gate.kind &&
    (!candidate.componentId || components.includes(candidate.componentId))
  );
  if (evidence.length === 0) {
    return gateReport({
      gate: options.gate,
      components,
      status: "warning",
      message: `No ${options.gate.kind} evidence is available.`,
    });
  }
  if (evidence.some((candidate) => candidate.status === "failed")) {
    return gateReport({
      gate: options.gate,
      components,
      status: "failed",
      message: `${options.gate.kind} evidence reports a failure.`,
      evidence: evidence.map(evidenceMessage),
    });
  }
  if (evidence.some((candidate) => candidate.status === "unknown")) {
    return gateReport({
      gate: options.gate,
      components,
      status: "warning",
      message: `${options.gate.kind} evidence is incomplete.`,
      evidence: evidence.map(evidenceMessage),
    });
  }

  return gateReport({
    gate: options.gate,
    components,
    status: "passed",
    message: `${options.gate.kind} evidence is ready.`,
    evidence: evidence.map(evidenceMessage),
  });
}

function evaluateReleaseAuthorityGate(options: {
  gate: NexusVersionReadinessGate;
  version: NexusVersionConfig;
  release: NexusVersionReleaseReadinessReport;
}): NexusVersionReadinessGateReport {
  const components = gateComponents(options.gate, options.version);
  const status: NexusVersionReadinessGateStatus = options.release.state ===
      "blocked"
    ? "failed"
    : options.release.state === "warning"
      ? "warning"
      : "passed";

  return gateReport({
    gate: options.gate,
    components,
    status,
    message: status === "passed"
      ? "Release policy and authority facts are ready or not required."
      : status === "failed"
        ? "Release policy requires authority that is blocked."
        : "Release policy or authority facts cannot be fully evaluated.",
    evidence: [
      ...options.release.actions.map((action) => action.message),
      ...options.release.artifacts.map((artifact) => artifact.message),
      ...options.release.publicationDecisionEvidence,
    ],
  });
}

function summarizeRelease(options: {
  version: NexusVersionConfig;
  authority: NexusVersionAuthorityReadinessSummary;
  publicationDecisions: readonly WorktreePublicationDecision[];
  releaseArtifacts: readonly NexusVersionReleaseArtifactEvidence[];
}): NexusVersionReleaseReadinessReport {
  const warnings: NexusVersionReadinessWarning[] = [];
  const actions: NexusVersionReleaseActionReadiness[] = [
    releaseActionReadiness({
      name: "tags",
      policy: options.version.releasePolicy.tags,
      authorityAction: "release.publish",
      authority: options.authority,
    }),
    releaseActionReadiness({
      name: "packages",
      policy: options.version.releasePolicy.packages,
      authorityAction: "package.publish",
      authority: options.authority,
    }),
    releaseActionReadiness({
      name: "providerRelease",
      policy: options.version.releasePolicy.providerRelease,
      authorityAction: "release.publish",
      authority: options.authority,
    }),
  ];
  if (
    actions.some((action) =>
      action.policy === "manual" && action.state === "warning"
    )
  ) {
    warnings.push({
      code: "release_authority_missing",
      gateKind: "release_authority",
      componentId: null,
      message: "Manual release action authority cannot be evaluated.",
    });
  }

  const artifacts: NexusVersionReleaseArtifactReadiness[] = [
    releaseArtifactReadiness({
      name: "releaseNotes",
      policy: options.version.releasePolicy.releaseNotes,
      evidence: options.releaseArtifacts,
      warnings,
    }),
    releaseArtifactReadiness({
      name: "changelog",
      policy: options.version.releasePolicy.changelog,
      evidence: options.releaseArtifacts,
      warnings,
    }),
  ];
  const states = [...actions.map((action) => action.state), ...artifacts.map(
    (artifact) => artifact.state,
  )];
  const state: NexusVersionReleaseReadinessState = states.every((candidate) =>
      candidate === "not_required"
    )
    ? "not_required"
    : states.some((candidate) => candidate === "blocked")
      ? "blocked"
      : states.some((candidate) => candidate === "warning")
        ? "warning"
        : "ready";

  return {
    state,
    actions,
    artifacts,
    publicationDecisionEvidence: options.publicationDecisions.map(
      publicationDecisionMessage,
    ),
    warnings,
  };
}

function releaseActionReadiness(options: {
  name: NexusVersionReleaseActionName;
  policy: NexusVersionReleaseActionPolicy;
  authorityAction: NexusAuthorityAction;
  authority: NexusVersionAuthorityReadinessSummary;
}): NexusVersionReleaseActionReadiness {
  if (options.policy === "none") {
    return {
      name: options.name,
      policy: options.policy,
      authorityAction: null,
      state: "not_required",
      message: `${options.name}: no release action required.`,
    };
  }

  const action = authorityAction(options.authority, options.authorityAction);
  if (action.blocked) {
    return {
      name: options.name,
      policy: options.policy,
      authorityAction: options.authorityAction,
      state: "blocked",
      message: `${options.name}: ${options.authorityAction} is blocked.`,
    };
  }
  if (action.allowed) {
    return {
      name: options.name,
      policy: options.policy,
      authorityAction: options.authorityAction,
      state: "ready",
      message: `${options.name}: ${options.authorityAction} is available for manual release work.`,
    };
  }

  return {
    name: options.name,
    policy: options.policy,
    authorityAction: options.authorityAction,
    state: "warning",
    message: `${options.name}: ${options.authorityAction} authority is unknown.`,
  };
}

function releaseArtifactReadiness(options: {
  name: NexusVersionReleaseArtifactName;
  policy: NexusVersionReleaseArtifactPolicy;
  evidence: readonly NexusVersionReleaseArtifactEvidence[];
  warnings: NexusVersionReadinessWarning[];
}): NexusVersionReleaseArtifactReadiness {
  if (options.policy === "none" || options.policy === "optional") {
    return {
      name: options.name,
      policy: options.policy,
      state: "not_required",
      message: `${options.name}: ${options.policy} artifact policy.`,
    };
  }

  const evidence = options.evidence.find((candidate) =>
    candidate.kind === options.name
  );
  if (evidence?.status === "ready") {
    return {
      name: options.name,
      policy: options.policy,
      state: "ready",
      message: `${options.name}: required artifact is ready.`,
    };
  }

  options.warnings.push({
    code: "release_artifact_missing",
    gateKind: "release_authority",
    componentId: evidence?.componentId ?? null,
    message: `${options.name}: required artifact evidence is missing.`,
  });
  return {
    name: options.name,
    policy: options.policy,
    state: "warning",
    message: `${options.name}: required artifact evidence is missing.`,
  };
}

function summarizeAuthority(
  version: NexusVersionConfig,
  authority: NexusAuthorityProjectSummary | null,
): NexusVersionAuthorityReadinessSummary {
  const components = version.owningComponents;
  const summaries = components.map((componentId) =>
    authority?.components.find((candidate) => candidate.componentId === componentId)
  ).filter((summary): summary is NexusAuthorityComponentSummary => Boolean(summary));
  const byComponent: Record<string, NexusVersionAuthorityComponentReadiness> = {};

  for (const componentId of components) {
    const summary = summaries.find((candidate) =>
      candidate.componentId === componentId
    );
    byComponent[componentId] = {
      componentId,
      allowedActions: summary?.keyAllowedActions ?? [],
      blockedActions: summary?.blockedActions ?? [],
      waitingActions: summary?.waitingActions ?? [],
    };
  }

  return {
    directTargetPushAllowed: authorityActionFromSummaries(
      summaries,
      "git.push_target_branch",
    ).allowed,
    mergeAllowed: authorityActionFromSummaries(
      summaries,
      "provider.pull_request.merge",
    ).allowed,
    packagePublishAllowed: authorityActionFromSummaries(
      summaries,
      "package.publish",
    ).allowed,
    releasePublishAllowed: authorityActionFromSummaries(
      summaries,
      "release.publish",
    ).allowed,
    byComponent,
  };
}

function authorityAction(
  authority: NexusVersionAuthorityReadinessSummary,
  action: NexusAuthorityAction,
): NexusVersionAuthorityActionSummary {
  const components = Object.values(authority.byComponent);
  if (components.length === 0) {
    return {
      allowed: false,
      blocked: false,
      waiting: false,
    };
  }
  return {
    allowed: components.every((component) =>
      component.allowedActions.includes(action) &&
      !component.blockedActions.includes(action) &&
      !component.waitingActions.includes(action)
    ),
    blocked: components.some((component) =>
      component.blockedActions.includes(action)
    ),
    waiting: components.some((component) =>
      component.waitingActions.includes(action)
    ),
  };
}

function authorityActionFromSummaries(
  summaries: readonly NexusAuthorityComponentSummary[],
  action: NexusAuthorityAction,
): NexusVersionAuthorityActionSummary {
  if (summaries.length === 0) {
    return {
      allowed: false,
      blocked: false,
      waiting: false,
    };
  }
  return {
    allowed: summaries.every((summary) =>
      summary.keyAllowedActions.includes(action) &&
      !summary.blockedActions.includes(action) &&
      !summary.waitingActions.includes(action)
    ),
    blocked: summaries.some((summary) => summary.blockedActions.includes(action)),
    waiting: summaries.some((summary) => summary.waitingActions.includes(action)),
  };
}

function collectGreenMainEvidence(
  facts: NexusVersionReadinessFacts,
): NexusVersionGreenMainValidationEvidence[] {
  return [
    ...(facts.greenMainValidation ?? []),
    ...(facts.publicationStatuses ?? []).flatMap((status) => {
      if (!status.greenMain) {
        return [];
      }

      return [{
        componentId: status.componentId,
        source: status.greenMain.checks.source,
        status: status.greenMain.checks.status,
        checkNames: status.greenMain.checks.requiredChecks,
        targetBranch: status.policy.targetBranch,
        message: status.greenMain.checks.message,
      }];
    }),
  ];
}

function checksPassedByVerification(
  verification: readonly WorktreeVerificationRecord[],
  checkNames: readonly string[],
): boolean {
  const passed = verification.filter((record) => record.status === "passed");
  if (checkNames.length === 0) {
    return passed.length > 0;
  }

  return checkNames.every((checkName) =>
    passed.some((record) =>
      record.command.includes(checkName) ||
      (record.summary ?? "").includes(checkName)
    )
  );
}

function coversRequiredChecks(
  evidenceCheckNames: readonly string[],
  requiredCheckNames: readonly string[],
): boolean {
  if (requiredCheckNames.length === 0) {
    return true;
  }

  return requiredCheckNames.every((checkName) =>
    evidenceCheckNames.includes(checkName)
  );
}

function gateReport(options: {
  gate: NexusVersionReadinessGate;
  components: string[];
  status: NexusVersionReadinessGateStatus;
  message: string;
  checkedWorkItemIds?: string[];
  failingWorkItemIds?: string[];
  evidence?: string[];
  evidenceOnly?: boolean;
}): NexusVersionReadinessGateReport {
  return {
    kind: options.gate.kind,
    required: options.gate.required,
    components: options.components,
    status: options.status,
    message: options.message,
    checkedWorkItemIds: options.checkedWorkItemIds ?? [],
    failingWorkItemIds: options.failingWorkItemIds ?? [],
    evidence: options.evidence ?? [],
    evidenceOnly: options.evidenceOnly ?? false,
    grantsAuthority: false,
  };
}

function gateComponents(
  gate: NexusVersionReadinessGate,
  version: NexusVersionConfig,
): string[] {
  return gate.components.length > 0
    ? [...gate.components]
    : [...version.owningComponents];
}

function itemScopeStatuses(
  item: NexusVersionResolvedScopeItem,
): NexusVersionScopeStatus[] {
  return unique(item.scopeStatuses.length > 0
    ? item.scopeStatuses
    : [item.scopeStatus]);
}

function isRequiredScopeItem(item: NexusVersionResolvedScopeItem): boolean {
  const statuses = itemScopeStatuses(item);
  return statuses.includes("committed") || statuses.includes("candidate");
}

function hasFailedCycleHistory(
  item: NexusVersionResolvedScopeItem,
  cycles: readonly NexusAutomationTargetCycleRecord[],
): boolean {
  return cycles.some((cycle) =>
    cycle.workItems.some((workItem) =>
      workItem.cycleStatus === "failed" && matchesCycleWorkItem(item, workItem)
    )
  );
}

function matchesCycleWorkItem(
  item: NexusVersionResolvedScopeItem,
  workItem: NexusAutomationTargetCycleWorkItem,
): boolean {
  if (workItem.componentId && workItem.componentId !== item.componentId) {
    return false;
  }
  const ids = new Set([
    item.workItem.id,
    item.logicalItemId ?? "",
    item.workItem.externalRef?.itemId ?? "",
    item.workItem.externalRef?.itemNumber === undefined ||
      item.workItem.externalRef.itemNumber === null
      ? ""
      : String(item.workItem.externalRef.itemNumber),
    item.workItem.externalRef?.itemKey ?? "",
  ].filter(Boolean));

  return ids.has(workItem.id) ||
    Boolean(workItem.logicalItemId && ids.has(workItem.logicalItemId));
}

function evidenceMessage(evidence: NexusVersionReadinessGateEvidence): string {
  return evidence.message ??
    `${evidence.componentId ?? "version"}:${evidence.name ?? evidence.kind}:${evidence.status}`;
}

function publicationDecisionMessage(
  decision: WorktreePublicationDecision,
): string {
  const target = decision.targetBranch ? ` to ${decision.targetBranch}` : "";
  const remote = decision.remote ? ` via ${decision.remote}` : "";
  return `publication decision: ${decision.type}${target}${remote}`;
}

function emptyComponentProgress(
  componentId: string,
): NexusVersionComponentProgressCounts {
  return {
    componentId,
    totalScopeItemCount: 0,
    requiredScopeItemCount: 0,
    byWorkStatus: emptyCountMap(workStatuses),
    byScopeStatus: emptyCountMap(scopeStatuses),
    blockedWorkItemCount: 0,
    failedWorkItemCount: 0,
    deferredWorkItemCount: 0,
    stretchWorkItemCount: 0,
  };
}

function emptyCountMap<T extends string>(
  values: readonly T[],
): NexusVersionCountMap<T> {
  const result = {} as NexusVersionCountMap<T>;
  for (const value of values) {
    result[value] = 0;
  }

  return result;
}

function increment<T extends string>(
  counts: NexusVersionCountMap<T>,
  key: T,
): void {
  counts[key] += 1;
}

function unique<T>(values: readonly T[]): T[] {
  const result: T[] = [];
  for (const value of values) {
    if (!result.includes(value)) {
      result.push(value);
    }
  }

  return result;
}
