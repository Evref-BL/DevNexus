import {
  type NexusFeatureBranchDeliveryPolicySummary,
} from "./nexusFeatureBranchDeliveryPolicy.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  summarizeNexusReleaseTrainPolicy,
} from "./nexusReleaseTrainPolicy.js";

export interface NexusFeatureBranchDeliveryPlanItem {
  componentId: string;
  componentName: string;
  targetBranch: string;
  releaseTrainVersionId: string | null;
  feature: NexusFeatureBranchDeliveryPolicySummary;
}

export interface NexusFeatureBranchDeliveryPlan {
  version: 1;
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  componentId: string | null;
  featureId: string | null;
  itemCount: number;
  items: NexusFeatureBranchDeliveryPlanItem[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusFeatureBranchDeliveryPlan(options: {
  projectRoot: string;
  componentId?: string;
  featureId?: string | null;
}): NexusFeatureBranchDeliveryPlan {
  const projectConfig = loadProjectConfig(options.projectRoot);
  const components = selectedComponents({
    projectRoot: options.projectRoot,
    projectConfig,
    componentId: options.componentId,
  });
  const warnings: string[] = [];
  const items = components.flatMap((component) => {
    const train = summarizeNexusReleaseTrainPolicy({
      projectConfig,
      component,
    });
    if (!train?.featureBranchDelivery) {
      warnings.push(
        `component ${component.id} has no feature branch delivery policy configured`,
      );
      return [];
    }
    if (
      options.featureId &&
      train.featureBranchDelivery.activeScopeId !== options.featureId &&
      train.featureBranchDelivery.activeFeatureId !== options.featureId
    ) {
      return [];
    }
    return [{
      componentId: component.id,
      componentName: component.name,
      targetBranch: train.targetBranch,
      releaseTrainVersionId: train.activeVersionId,
      feature: train.featureBranchDelivery,
    }];
  });
  if (items.length === 0 && options.featureId) {
    warnings.push(`feature branch delivery policy was not found: ${options.featureId}`);
  }

  return {
    version: 1,
    projectRoot: options.projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    componentId: options.componentId ?? null,
    featureId: options.featureId ?? null,
    itemCount: items.length,
    items,
    warnings,
    mutatesSource: false,
  };
}

function selectedComponents(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  componentId?: string;
}): ResolvedNexusProjectComponent[] {
  const components = resolveProjectComponents(
    options.projectRoot,
    options.projectConfig,
  );
  if (!options.componentId) {
    return components;
  }
  const component = components.find((candidate) =>
    candidate.id === options.componentId
  );
  if (!component) {
    throw new Error(`Component ${options.componentId} was not found.`);
  }
  return [component];
}
