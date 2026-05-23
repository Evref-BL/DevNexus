import {
  defaultNexusAutomationReleaseTrainConfig,
  type NexusAutomationReleaseTrainConfig,
} from "./nexusAutomationConfig.js";
import {
  defaultNexusReleaseTrainCiTierPolicy,
  mergeNexusCiTierPolicy,
  type NexusCiTierPolicyConfig,
} from "./nexusCiTierPolicy.js";
import {
  summarizeNexusFeatureBranchDeliveryPolicy,
  type NexusFeatureBranchDeliveryPolicySummary,
} from "./nexusFeatureBranchDeliveryPolicy.js";
import { readNexusGitRemoteFacts } from "./nexusGitRemoteFacts.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type { ResolvedNexusProjectComponent } from "./nexusProjectLifecycle.js";
import { resolveNexusPublicationPolicy } from "./nexusPublicationPolicy.js";
import { stripTrailingSlashes } from "./nexusTextNormalization.js";
import type { NexusVersionConfig } from "./nexusVersionPlanningConfig.js";

export interface NexusReleaseTrainBranchPolicySummary {
  integrationPrefix: string;
  candidatePrefix: string;
  unscopedName: string;
  integrationBranch: string;
  candidateBranch: string;
}

export interface NexusReleaseTrainSelectorPolicySummary {
  statuses: string[];
  labels: string[];
  milestones: string[];
  assignees: string[];
  providerQuery: string | null;
  requiresPublicLabel: boolean;
}

export interface NexusReleaseTrainCiTierPolicySummary {
  defaultTier: string;
  tierCount: number;
  fullMatrixBudget: {
    minimumIntervalMinutes: number | null;
    minimumChangeCount: number | null;
  };
  source: "release_train" | "component_verification" | "workspace_verification" | "default_release_train";
}

export interface NexusReleaseTrainPolicySummary {
  enabled: boolean;
  componentId: string;
  activeVersionId: string | null;
  activeVersionFound: boolean;
  objective: string | null;
  targetBranch: string;
  branches: NexusReleaseTrainBranchPolicySummary;
  featureBranchDelivery: NexusFeatureBranchDeliveryPolicySummary | null;
  selector: NexusReleaseTrainSelectorPolicySummary;
  ciTiers: NexusReleaseTrainCiTierPolicySummary;
  warnings: string[];
}

export function summarizeNexusReleaseTrainPolicy(options: {
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): NexusReleaseTrainPolicySummary | null {
  const publication = resolveNexusPublicationPolicy(
    options.projectConfig,
    options.component,
  );
  if (!publication.releaseTrain) {
    return null;
  }

  const train = {
    ...defaultNexusAutomationReleaseTrainConfig,
    ...publication.releaseTrain,
    branchNaming: {
      ...defaultNexusAutomationReleaseTrainConfig.branchNaming,
      ...publication.releaseTrain.branchNaming,
    },
    selector: {
      ...defaultNexusAutomationReleaseTrainConfig.selector,
      ...publication.releaseTrain.selector,
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
  const remoteFacts = componentRemoteFacts(options.component, publication.remote);
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
    featureBranchDelivery: train.featureBranchDelivery
      ? summarizeNexusFeatureBranchDeliveryPolicy({
          config: train.featureBranchDelivery,
          fallbackScopeId: activeVersionId,
          unscopedName: train.branchNaming.unscopedName,
          targetBranch,
          pushRemote: publication.remote ?? null,
          remoteUrls: remoteFacts.urls,
          remotePushUrls: remoteFacts.pushUrls,
        })
      : null,
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

function componentRemoteFacts(
  component: ResolvedNexusProjectComponent,
  pushRemote: string | null,
): ReturnType<typeof readNexusGitRemoteFacts> {
  const facts = component.sourceRootExists
    ? readNexusGitRemoteFacts(component.sourceRoot)
    : { urls: {}, pushUrls: {} };
  const remote = pushRemote ?? "origin";
  if (component.remoteUrl && !facts.urls[remote]) {
    return {
      urls: {
        ...facts.urls,
        [remote]: component.remoteUrl,
      },
      pushUrls: facts.pushUrls,
    };
  }

  return facts;
}

function activeVersionFor(
  versions: readonly NexusVersionConfig[],
  train: NexusAutomationReleaseTrainConfig,
): NexusVersionConfig | null {
  if (train.activeVersionId) {
    return versions.find((version) => version.id === train.activeVersionId) ??
      null;
  }
  return null;
}

function resolveTrainCiTiers(options: {
  train: NexusAutomationReleaseTrainConfig;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): {
  policy: NexusCiTierPolicyConfig;
  source: NexusReleaseTrainCiTierPolicySummary["source"];
} {
  if (options.train.ciTiers) {
    return {
      policy: mergeNexusCiTierPolicy(
        defaultNexusReleaseTrainCiTierPolicy,
        options.train.ciTiers,
      ),
      source: "release_train",
    };
  }
  if (options.component.verification?.ciTiers) {
    return {
      policy: mergeNexusCiTierPolicy(
        defaultNexusReleaseTrainCiTierPolicy,
        options.component.verification.ciTiers,
      ),
      source: "component_verification",
    };
  }
  if (options.projectConfig.automation?.verification.ciTiers) {
    return {
      policy: mergeNexusCiTierPolicy(
        defaultNexusReleaseTrainCiTierPolicy,
        options.projectConfig.automation.verification.ciTiers,
      ),
      source: "workspace_verification",
    };
  }
  return {
    policy: mergeNexusCiTierPolicy(defaultNexusReleaseTrainCiTierPolicy),
    source: "default_release_train",
  };
}

function trainWarnings(options: {
  train: NexusAutomationReleaseTrainConfig;
  activeVersion: NexusVersionConfig | null;
  versionCount: number;
}): string[] {
  const warnings: string[] = [];
  if (options.train.activeVersionId && !options.activeVersion) {
    warnings.push(
      `active release train version was not found: ${options.train.activeVersionId}`,
    );
  }
  if (options.train.enabled && options.versionCount === 0) {
    warnings.push("release train is enabled but versionPlanning has no versions");
  }
  if (options.train.selector.labels.length > 0) {
    warnings.push("release train selector requires public labels");
  }
  return warnings;
}

function trainBranchName(
  prefix: string,
  activeVersionId: string | null,
  unscopedName: string,
): string {
  return `${stripTrailingSlashes(prefix)}/${activeVersionId ?? unscopedName}`;
}
