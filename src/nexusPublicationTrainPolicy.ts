import {
  defaultNexusAutomationPublicationTrainConfig,
  type NexusAutomationPublicationTrainConfig,
} from "./nexusAutomationConfig.js";
import {
  defaultNexusPublicationTrainCiTierPolicy,
  mergeNexusCiTierPolicy,
  type NexusCiTierPolicyConfig,
} from "./nexusCiTierPolicy.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type { ResolvedNexusProjectComponent } from "./nexusProjectLifecycle.js";
import { resolveNexusPublicationPolicy } from "./nexusPublicationPolicy.js";
import type { NexusVersionConfig } from "./nexusVersionPlanningConfig.js";

export interface NexusPublicationTrainBranchPolicySummary {
  integrationPrefix: string;
  candidatePrefix: string;
  unscopedName: string;
  integrationBranch: string;
  candidateBranch: string;
}

export interface NexusPublicationTrainSelectorPolicySummary {
  statuses: string[];
  labels: string[];
  milestones: string[];
  assignees: string[];
  providerQuery: string | null;
  requiresPublicLabel: boolean;
}

export interface NexusPublicationTrainCiTierPolicySummary {
  defaultTier: string;
  tierCount: number;
  fullMatrixBudget: {
    minimumIntervalMinutes: number | null;
    minimumChangeCount: number | null;
  };
  source: "publication_train" | "component_verification" | "workspace_verification" | "default_publication_train";
}

export interface NexusPublicationTrainPolicySummary {
  enabled: boolean;
  componentId: string;
  activeVersionId: string | null;
  activeVersionFound: boolean;
  objective: string | null;
  targetBranch: string;
  branches: NexusPublicationTrainBranchPolicySummary;
  selector: NexusPublicationTrainSelectorPolicySummary;
  ciTiers: NexusPublicationTrainCiTierPolicySummary;
  warnings: string[];
}

export function summarizeNexusPublicationTrainPolicy(options: {
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): NexusPublicationTrainPolicySummary | null {
  const publication = resolveNexusPublicationPolicy(
    options.projectConfig,
    options.component,
  );
  if (!publication.publicationTrain) {
    return null;
  }

  const train = {
    ...defaultNexusAutomationPublicationTrainConfig,
    ...publication.publicationTrain,
    branchNaming: {
      ...defaultNexusAutomationPublicationTrainConfig.branchNaming,
      ...publication.publicationTrain.branchNaming,
    },
    selector: {
      ...defaultNexusAutomationPublicationTrainConfig.selector,
      ...publication.publicationTrain.selector,
    },
  };
  const activeVersion = activeVersionFor(
    options.projectConfig.versionPlanning?.versions ?? [],
    train,
  );
  const activeVersionId = train.activeVersionId ?? activeVersion?.id ?? null;
  const targetBranch =
    activeVersion?.targetBranch ??
    publication.targetBranch ??
    options.component.defaultBranch ??
    options.projectConfig.repo.defaultBranch ??
    "main";
  const ciTiers = resolveTrainCiTiers({
    train,
    projectConfig: options.projectConfig,
    component: options.component,
  });
  const warnings = trainWarnings({
    train,
    activeVersion,
    versionCount: options.projectConfig.versionPlanning?.versions.length ?? 0,
  });

  return {
    enabled: train.enabled,
    componentId: options.component.id,
    activeVersionId,
    activeVersionFound: Boolean(activeVersion),
    objective: activeVersion?.objective ?? null,
    targetBranch,
    branches: {
      integrationPrefix: train.branchNaming.integrationPrefix,
      candidatePrefix: train.branchNaming.candidatePrefix,
      unscopedName: train.branchNaming.unscopedName,
      integrationBranch: trainBranchName(
        train.branchNaming.integrationPrefix,
        activeVersionId,
        train.branchNaming.unscopedName,
      ),
      candidateBranch: trainBranchName(
        train.branchNaming.candidatePrefix,
        activeVersionId,
        train.branchNaming.unscopedName,
      ),
    },
    selector: {
      statuses: [...train.selector.statuses],
      labels: [...train.selector.labels],
      milestones: [...train.selector.milestones],
      assignees: [...train.selector.assignees],
      providerQuery: train.selector.providerQuery,
      requiresPublicLabel: train.selector.labels.length > 0,
    },
    ciTiers: {
      defaultTier: ciTiers.policy.defaultTier,
      tierCount: ciTiers.policy.tiers.length,
      fullMatrixBudget: { ...ciTiers.policy.fullMatrixBudget },
      source: ciTiers.source,
    },
    warnings,
  };
}

function activeVersionFor(
  versions: readonly NexusVersionConfig[],
  train: NexusAutomationPublicationTrainConfig,
): NexusVersionConfig | null {
  if (train.activeVersionId) {
    return versions.find((version) => version.id === train.activeVersionId) ??
      null;
  }
  return null;
}

function resolveTrainCiTiers(options: {
  train: NexusAutomationPublicationTrainConfig;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): {
  policy: NexusCiTierPolicyConfig;
  source: NexusPublicationTrainCiTierPolicySummary["source"];
} {
  if (options.train.ciTiers) {
    return {
      policy: mergeNexusCiTierPolicy(
        defaultNexusPublicationTrainCiTierPolicy,
        options.train.ciTiers,
      ),
      source: "publication_train",
    };
  }
  if (options.component.verification?.ciTiers) {
    return {
      policy: mergeNexusCiTierPolicy(
        defaultNexusPublicationTrainCiTierPolicy,
        options.component.verification.ciTiers,
      ),
      source: "component_verification",
    };
  }
  if (options.projectConfig.automation?.verification.ciTiers) {
    return {
      policy: mergeNexusCiTierPolicy(
        defaultNexusPublicationTrainCiTierPolicy,
        options.projectConfig.automation.verification.ciTiers,
      ),
      source: "workspace_verification",
    };
  }
  return {
    policy: mergeNexusCiTierPolicy(defaultNexusPublicationTrainCiTierPolicy),
    source: "default_publication_train",
  };
}

function trainWarnings(options: {
  train: NexusAutomationPublicationTrainConfig;
  activeVersion: NexusVersionConfig | null;
  versionCount: number;
}): string[] {
  const warnings: string[] = [];
  if (options.train.activeVersionId && !options.activeVersion) {
    warnings.push(
      `active publication train version was not found: ${options.train.activeVersionId}`,
    );
  }
  if (options.train.enabled && options.versionCount === 0) {
    warnings.push("publication train is enabled but versionPlanning has no versions");
  }
  if (options.train.selector.labels.length > 0) {
    warnings.push("publication train selector requires public labels");
  }
  return warnings;
}

function trainBranchName(
  prefix: string,
  activeVersionId: string | null,
  unscopedName: string,
): string {
  return `${prefix.replace(/\/+$/u, "")}/${activeVersionId ?? unscopedName}`;
}
