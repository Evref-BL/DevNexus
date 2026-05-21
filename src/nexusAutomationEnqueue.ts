import path from "node:path";
import { selectNexusAutomationWorkItem } from "./nexusAutomation.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import type {
  WorkItem,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export interface EnqueueNexusAutomationWorkItemProviderContext {
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  workTracking: NonNullable<ResolvedNexusProjectComponent["workTracking"]>;
}

export type EnqueueNexusAutomationWorkItemProviderFactory = (
  context: EnqueueNexusAutomationWorkItemProviderContext,
) => WorkTrackerProvider | Promise<WorkTrackerProvider>;

export interface EnqueueNexusAutomationWorkItemOptions {
  projectRoot: string;
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
  provider?: WorkTrackerProvider;
  providerFactory?: EnqueueNexusAutomationWorkItemProviderFactory;
  providerOptions?: Omit<CreateWorkTrackerProviderOptions, "projectRoot" | "now">;
  now?: () => Date | string;
}

export interface EnqueueNexusAutomationWorkItemResult {
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  workItem: WorkItem;
}

export class NexusAutomationEnqueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationEnqueueError";
  }
}

export async function enqueueNexusAutomationWorkItem(
  options: EnqueueNexusAutomationWorkItemOptions,
): Promise<EnqueueNexusAutomationWorkItemResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation;
  if (!automationConfig?.enabled) {
    throw new NexusAutomationEnqueueError(
      "Workspace automation is not enabled",
    );
  }
  const primaryComponent = resolvePrimaryProjectComponent(projectRoot, projectConfig);
  if (!primaryComponent.workTracking) {
    throw new NexusAutomationEnqueueError(
      "Primary component work tracking is not configured",
    );
  }

  const sourceRoot = primaryComponent.sourceRoot;
  const status = resolveEnqueueStatus(automationConfig, options.status);
  const labels = resolveSelectorStrings(
    "labels",
    automationConfig.selector.labels,
    options.labels,
  );
  const assignees = resolveSelectorStrings(
    "assignees",
    automationConfig.selector.assignees,
    options.assignees,
  );
  assertNoExcludedLabels(labels, automationConfig.selector.excludeLabels);
  assertSearchMatches(
    automationConfig,
    options.title,
    options.description ?? null,
  );

  const provider = await resolveProvider({
    options,
    projectRoot,
    sourceRoot,
    projectConfig,
    component: primaryComponent,
  });
  const workItem = await provider.createWorkItem({
    projectRoot,
    title: requiredNonEmptyString(options.title, "title"),
    description: options.description,
    status,
    labels,
    assignees,
    milestone: options.milestone,
  });

  if (!selectNexusAutomationWorkItem([workItem], automationConfig)) {
    throw new NexusAutomationEnqueueError(
      `Created work item ${workItem.id} did not match the automation selector`,
    );
  }

  return {
    projectRoot,
    sourceRoot,
    projectConfig,
    automationConfig,
    workItem,
  };
}

async function resolveProvider(options: {
  options: EnqueueNexusAutomationWorkItemOptions;
  projectRoot: string;
  sourceRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): Promise<WorkTrackerProvider> {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationEnqueueError(
      "Primary component work tracking is not configured",
    );
  }
  if (options.options.provider) {
    return options.options.provider;
  }
  if (options.options.providerFactory) {
    return options.options.providerFactory({
      projectRoot: options.projectRoot,
      sourceRoot: options.sourceRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      workTracking,
    });
  }

  return createWorkTrackerProviderAsync(workTracking, {
    ...options.options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

function resolveEnqueueStatus(
  config: NexusAutomationConfig,
  requested: WorkStatus | undefined,
): WorkStatus {
  if (requested) {
    if (!config.selector.statuses.includes(requested)) {
      throw new NexusAutomationEnqueueError(
        `--status must match automation selector statuses: ${config.selector.statuses.join(", ")}`,
      );
    }

    return requested;
  }

  const status = config.selector.statuses[0];
  if (!status) {
    throw new NexusAutomationEnqueueError(
      "Automation selector must include at least one status",
    );
  }

  return status;
}

function resolveSelectorStrings(
  name: string,
  selectorValues: readonly string[],
  requestedValues: readonly string[] | undefined,
): string[] {
  const values = [...selectorValues, ...(requestedValues ?? [])];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = requiredNonEmptyString(value, name);
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

function assertNoExcludedLabels(
  labels: readonly string[],
  excludedLabels: readonly string[],
): void {
  const labelSet = new Set(labels.map((label) => label.toLowerCase()));
  const conflicts = excludedLabels.filter((label) =>
    labelSet.has(label.toLowerCase()),
  );
  if (conflicts.length > 0) {
    throw new NexusAutomationEnqueueError(
      `labels conflict with automation selector exclusions: ${conflicts.join(", ")}`,
    );
  }
}

function assertSearchMatches(
  config: NexusAutomationConfig,
  title: string,
  description: string | null,
): void {
  const search = config.selector.search?.trim().toLowerCase();
  if (!search) {
    return;
  }

  const haystack = [title, description ?? ""].join("\n").toLowerCase();
  if (!haystack.includes(search)) {
    throw new NexusAutomationEnqueueError(
      "title or description must match automation selector search",
    );
  }
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationEnqueueError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
