import {
  type NexusInitiativeDeliveryPolicySummary,
} from "./nexusInitiativeDeliveryPolicy.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  summarizeNexusPublicationTrainPolicy,
} from "./nexusPublicationTrainPolicy.js";

export interface NexusInitiativeDeliveryPlanItem {
  componentId: string;
  componentName: string;
  targetBranch: string;
  publicationTrainVersionId: string | null;
  initiative: NexusInitiativeDeliveryPolicySummary;
}

export interface NexusInitiativeDeliveryPlan {
  version: 1;
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  componentId: string | null;
  initiativeId: string | null;
  itemCount: number;
  items: NexusInitiativeDeliveryPlanItem[];
  warnings: string[];
  mutatesSource: false;
}

export function buildNexusInitiativeDeliveryPlan(options: {
  projectRoot: string;
  componentId?: string;
  initiativeId?: string | null;
}): NexusInitiativeDeliveryPlan {
  const projectConfig = loadProjectConfig(options.projectRoot);
  const components = selectedComponents({
    projectRoot: options.projectRoot,
    projectConfig,
    componentId: options.componentId,
  });
  const warnings: string[] = [];
  const items = components.flatMap((component) => {
    const train = summarizeNexusPublicationTrainPolicy({
      projectConfig,
      component,
    });
    if (!train?.initiativeDelivery) {
      warnings.push(
        `component ${component.id} has no initiative delivery policy configured`,
      );
      return [];
    }
    if (
      options.initiativeId &&
      train.initiativeDelivery.activeScopeId !== options.initiativeId &&
      train.initiativeDelivery.activeInitiativeId !== options.initiativeId
    ) {
      return [];
    }
    return [{
      componentId: component.id,
      componentName: component.name,
      targetBranch: train.targetBranch,
      publicationTrainVersionId: train.activeVersionId,
      initiative: train.initiativeDelivery,
    }];
  });
  if (items.length === 0 && options.initiativeId) {
    warnings.push(`initiative delivery policy was not found: ${options.initiativeId}`);
  }

  return {
    version: 1,
    projectRoot: options.projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    componentId: options.componentId ?? null,
    initiativeId: options.initiativeId ?? null,
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
