import path from "node:path";
import {
  defaultNexusAutomationGreenMainConfig,
} from "./nexusAutomationConfig.js";
import {
  defaultNexusCiTierPolicy,
  resolveNexusCiTierDecision,
  type NexusCiTierDecision,
  type NexusCiTierPolicyConfig,
} from "./nexusCiTierPolicy.js";
import {
  classifyNexusPublicationProviderEvidenceChecks,
  findNexusPublicationProviderEvidence,
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidenceCheckClassification,
  type NexusPublicationProviderEvidenceInput,
} from "./nexusPublicationProviderEvidence.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import { resolveNexusPublicationPolicy } from "./nexusPublicationPolicy.js";

export type NexusMergeQueueWorkflowTriggerStatus =
  | "not_configured"
  | "present"
  | "missing"
  | "unknown";

export type NexusMergeQueueReadinessNextAction =
  | "not_required"
  | "wait"
  | "enter_merge_queue"
  | "resolve_blockers"
  | "update_workflow"
  | "request_human_decision";

export interface NexusMergeQueueWorkflowTriggerInput {
  workflowName: string;
  path?: string | null;
  events: string[];
}

export interface BuildNexusMergeQueueReadinessReportOptions {
  projectRoot: string;
  componentId?: string;
  mergeQueueEnabled?: boolean | null;
  workflowTriggers?: NexusMergeQueueWorkflowTriggerInput[];
  providerEvidence?: NexusPublicationProviderEvidenceInput[];
  now?: Date | string | (() => Date | string);
}

export interface NexusMergeQueueEvidenceSummary {
  sourceKind: NexusPublicationProviderEvidence["sourceKind"] | null;
  provider: string | null;
  headRef: string | null;
  headSha: string | null;
  targetBranch: string | null;
  intendedCiTier: string | null;
  status: NexusPublicationProviderEvidenceCheckClassification["status"];
  message: string;
  requiredChecks: NexusPublicationProviderEvidenceCheckClassification["requiredChecks"];
}

export interface NexusMergeQueueReadinessReport {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  component: {
    id: string;
    name: string;
    sourceRoot: string;
  };
  targetBranch: string;
  mergeQueue: {
    enabled: boolean;
    workflowTriggerStatus: NexusMergeQueueWorkflowTriggerStatus;
    workflowTriggers: NexusMergeQueueWorkflowTriggerInput[];
  };
  ciTiers: {
    candidateMatrix: NexusCiTierDecision;
    protectedTarget: NexusCiTierDecision;
  };
  candidateMatrixEvidence: NexusMergeQueueEvidenceSummary[];
  protectedTargetGate: NexusMergeQueueEvidenceSummary;
  nextAction: NexusMergeQueueReadinessNextAction;
  blockers: string[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusMergeQueueReadinessReport(
  options: BuildNexusMergeQueueReadinessReportOptions,
): NexusMergeQueueReadinessReport {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const component = resolveComponent(
    projectRoot,
    projectConfig,
    options.componentId,
  );
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const greenMain = {
    ...defaultNexusAutomationGreenMainConfig,
    ...(publication.greenMain ?? {}),
  };
  const targetBranch =
    publication.targetBranch ?? component.defaultBranch ?? "main";
  const ciPolicy = ciTierPolicy(projectConfig, component);
  const candidateMatrix = resolveNexusCiTierDecision({
    policy: ciPolicy,
    eventName: "pull_request",
    branchName: `candidate/${targetBranch}`,
    targetBranch,
    fullMatrixBudgetAvailable: true,
  });
  const protectedTarget = resolveNexusCiTierDecision({
    policy: ciPolicy,
    eventName: "merge_group",
    branchName: targetBranch,
    targetBranch,
    fullMatrixBudgetAvailable: true,
  });
  const normalizedEvidence = normalizeNexusPublicationProviderEvidence(
    options.providerEvidence ?? [],
  );
  const candidateEvidence = normalizedEvidence
    .filter((evidence) =>
      evidence.sourceKind === "candidate_branch" ||
      evidence.intendedCiTier === candidateMatrix.tier.id
    )
    .map((evidence) =>
      evidenceSummary(
        evidence,
        classifyNexusPublicationProviderEvidenceChecks({
          evidence,
          requiredChecks: candidateMatrix.requiredChecks,
        }),
      )
    );
  const protectedEvidence = findNexusPublicationProviderEvidence(
    normalizedEvidence,
    {
      sourceKind: "merge_queue_group",
      targetBranch,
      intendedCiTier: protectedTarget.tier.id,
    },
  );
  const protectedClassification = classifyNexusPublicationProviderEvidenceChecks({
    evidence: protectedEvidence,
    requiredChecks: protectedTarget.requiredChecks,
  });
  const protectedTargetGate = evidenceSummary(
    protectedEvidence,
    protectedClassification,
  );
  const mergeQueueEnabled = options.mergeQueueEnabled === true;
  const workflowTriggers = options.workflowTriggers ?? [];
  const workflowTriggerStatus = mergeQueueEnabled
    ? mergeGroupTriggerStatus(workflowTriggers)
    : "not_configured";
  const blockers = reportBlockers({
    mergeQueueEnabled,
    workflowTriggerStatus,
    protectedTargetGate,
    protectedEvidence,
  });
  const warnings = reportWarnings({
    mergeQueueEnabled,
    workflowTriggerStatus,
    protectedTargetGate,
    protectedEvidence,
    greenMainRequiredChecks: greenMain.requiredChecks,
    protectedRequiredChecks: protectedTarget.requiredChecks,
  });

  return {
    version: 1,
    generatedAt: isoString(options.now ?? new Date()),
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    component: {
      id: component.id,
      name: component.name,
      sourceRoot: component.sourceRoot,
    },
    targetBranch,
    mergeQueue: {
      enabled: mergeQueueEnabled,
      workflowTriggerStatus,
      workflowTriggers: workflowTriggers.map((trigger) => ({
        workflowName: trigger.workflowName,
        path: trigger.path ?? null,
        events: [...trigger.events],
      })),
    },
    ciTiers: {
      candidateMatrix,
      protectedTarget,
    },
    candidateMatrixEvidence: candidateEvidence,
    protectedTargetGate,
    nextAction: nextAction({
      mergeQueueEnabled,
      workflowTriggerStatus,
      protectedTargetGate,
      protectedEvidence,
      blockers,
    }),
    blockers,
    warnings,
    mutatesSource: false,
  };
}

function resolveComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string | undefined,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (!componentId) {
    return components[0] ?? missingComponent(componentId);
  }
  return components.find((component) => component.id === componentId) ??
    missingComponent(componentId);
}

function missingComponent(componentId: string | undefined): never {
  throw new Error(`Component ${componentId ?? "<default>"} was not found.`);
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

function evidenceSummary(
  evidence: NexusPublicationProviderEvidence | null,
  classification: NexusPublicationProviderEvidenceCheckClassification,
): NexusMergeQueueEvidenceSummary {
  return {
    sourceKind: evidence?.sourceKind ?? null,
    provider: evidence?.provider ?? null,
    headRef: evidence?.headRef ?? null,
    headSha: evidence?.headSha ?? null,
    targetBranch: evidence?.targetBranch ?? null,
    intendedCiTier: evidence?.intendedCiTier ?? null,
    status: classification.status,
    message: classification.message,
    requiredChecks: classification.requiredChecks.map((check) => ({
      ...check,
    })),
  };
}

function mergeGroupTriggerStatus(
  workflowTriggers: NexusMergeQueueWorkflowTriggerInput[],
): NexusMergeQueueWorkflowTriggerStatus {
  if (workflowTriggers.length === 0) {
    return "unknown";
  }
  return workflowTriggers.some((workflow) =>
    workflow.events.some((event) => normalizedEvent(event) === "merge_group")
  )
    ? "present"
    : "missing";
}

function reportBlockers(options: {
  mergeQueueEnabled: boolean;
  workflowTriggerStatus: NexusMergeQueueWorkflowTriggerStatus;
  protectedTargetGate: NexusMergeQueueEvidenceSummary;
  protectedEvidence: NexusPublicationProviderEvidence | null;
}): string[] {
  if (!options.mergeQueueEnabled) {
    return [];
  }
  const blockers: string[] = [];
  if (options.workflowTriggerStatus === "missing") {
    blockers.push("configured merge queue lacks workflow trigger evidence for merge_group");
  }
  if (options.protectedTargetGate.status === "failed") {
    blockers.push("merge queue protected target checks failed");
  }
  if (options.protectedTargetGate.status === "stale") {
    blockers.push("merge queue protected target checks are stale");
  }
  if (options.protectedTargetGate.status === "missing") {
    blockers.push("merge queue protected target checks are missing");
  }
  if (
    options.protectedTargetGate.status === "unavailable" &&
    options.protectedEvidence
  ) {
    blockers.push("merge queue protected target check state is unknown");
  }
  return blockers;
}

function reportWarnings(options: {
  mergeQueueEnabled: boolean;
  workflowTriggerStatus: NexusMergeQueueWorkflowTriggerStatus;
  protectedTargetGate: NexusMergeQueueEvidenceSummary;
  protectedEvidence: NexusPublicationProviderEvidence | null;
  greenMainRequiredChecks: string[];
  protectedRequiredChecks: string[];
}): string[] {
  if (!options.mergeQueueEnabled) {
    return ["merge queue is not configured for this readiness check"];
  }
  const warnings: string[] = [];
  if (options.workflowTriggerStatus === "unknown") {
    warnings.push("workflow trigger evidence is unavailable; cannot confirm merge_group coverage");
  }
  if (options.workflowTriggerStatus === "missing") {
    warnings.push("required workflows appear to lack a merge_group trigger");
  }
  if (
    options.protectedTargetGate.status === "unavailable" &&
    !options.protectedEvidence
  ) {
    warnings.push("merge queue group evidence is unavailable");
  }
  if (options.protectedTargetGate.status === "pending") {
    warnings.push("merge queue protected target checks are still pending");
  }
  if (
    options.greenMainRequiredChecks.length > 0 &&
    options.protectedRequiredChecks.join("\u0000") !==
      options.greenMainRequiredChecks.join("\u0000")
  ) {
    warnings.push(
      "green-main required checks differ from the protected target CI tier checks",
    );
  }
  return warnings;
}

function nextAction(options: {
  mergeQueueEnabled: boolean;
  workflowTriggerStatus: NexusMergeQueueWorkflowTriggerStatus;
  protectedTargetGate: NexusMergeQueueEvidenceSummary;
  protectedEvidence: NexusPublicationProviderEvidence | null;
  blockers: string[];
}): NexusMergeQueueReadinessNextAction {
  if (!options.mergeQueueEnabled) {
    return "not_required";
  }
  if (options.workflowTriggerStatus === "missing") {
    return "update_workflow";
  }
  if (options.blockers.length > 0) {
    return "resolve_blockers";
  }
  if (
    options.protectedTargetGate.status === "success" ||
    options.protectedTargetGate.status === "pending" ||
    options.protectedTargetGate.status === "not_required"
  ) {
    return "wait";
  }
  if (
    options.workflowTriggerStatus === "present" &&
    (options.protectedTargetGate.status === "unavailable" &&
      !options.protectedEvidence)
  ) {
    return "enter_merge_queue";
  }
  return "request_human_decision";
}

function normalizedEvent(event: string): string {
  return event.trim().toLowerCase().replace(/[\s-]+/gu, "_");
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
