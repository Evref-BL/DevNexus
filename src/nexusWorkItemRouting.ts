import path from "node:path";
import {
  loadLocalWorkTrackingStore,
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type { LocalWorkTrackingConfig } from "./workTrackingTypes.js";

export interface ResolvedComponentWorkItemRoute {
  component: ResolvedNexusProjectComponent;
  itemId: string;
  qualified: boolean;
}

export function resolveComponentWorkItemRoute(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  componentId?: string;
  workItemId: string;
  currentPath?: string;
}): ResolvedComponentWorkItemRoute {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const components = resolveProjectComponents(projectRoot, options.projectConfig);
  const requestedComponentId = optionalTrimmedString(options.componentId);
  const rawWorkItemId = requiredNonEmptyString(
    options.workItemId,
    "workItemId",
  );
  const qualified = componentQualifiedWorkItemId(components, rawWorkItemId);
  if (qualified) {
    const requestedComponent = requestedComponentId
      ? componentById(components, requestedComponentId)
      : null;
    if (requestedComponentId && !requestedComponent) {
      throw new Error(`Project component is not configured: ${requestedComponentId}`);
    }
    if (requestedComponent && requestedComponent.id !== qualified.component.id) {
      throw new Error(
        `Work item id component "${qualified.component.id}" conflicts with requested component "${requestedComponent.id}" for provider-local id "${qualified.itemId}" ` +
          `(requested tracker: ${componentTrackerLabel(requestedComponent)}; id tracker: ${componentTrackerLabel(qualified.component)}).`,
      );
    }

    return {
      component: qualified.component,
      itemId: qualified.itemId,
      qualified: true,
    };
  }

  if (requestedComponentId) {
    const component = componentById(components, requestedComponentId);
    if (!component) {
      throw new Error(`Project component is not configured: ${requestedComponentId}`);
    }

    return {
      component,
      itemId: rawWorkItemId,
      qualified: false,
    };
  }

  const inferredComponent = options.currentPath
    ? inferComponentFromPath(components, options.currentPath)
    : null;
  if (inferredComponent) {
    return {
      component: inferredComponent,
      itemId: rawWorkItemId,
      qualified: false,
    };
  }

  const localMatches = localComponentsContainingWorkItem({
    projectRoot,
    components,
    itemId: rawWorkItemId,
  });
  if (localMatches.length > 1) {
    throw new Error(
      `Provider-local work item id "${rawWorkItemId}" is ambiguous across components: ` +
        `${localMatches.map((component) => componentTrackerSummary(component)).join(", ")}. ` +
        "Provide --component or use a component-qualified work item id.",
    );
  }
  if (localMatches.length === 1) {
    return {
      component: localMatches[0]!,
      itemId: rawWorkItemId,
      qualified: false,
    };
  }

  return {
    component: resolvePrimaryProjectComponent(projectRoot, options.projectConfig),
    itemId: rawWorkItemId,
    qualified: false,
  };
}

export function resolveComponentForCurrentPath(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  componentId?: string;
  currentPath?: string;
}): ResolvedNexusProjectComponent {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const components = resolveProjectComponents(projectRoot, options.projectConfig);
  const requestedComponentId = optionalTrimmedString(options.componentId);
  if (requestedComponentId) {
    const component = componentById(components, requestedComponentId);
    if (!component) {
      throw new Error(`Project component is not configured: ${requestedComponentId}`);
    }

    return component;
  }

  const inferredComponent = options.currentPath
    ? inferComponentFromPath(components, options.currentPath)
    : null;
  return inferredComponent ?? resolvePrimaryProjectComponent(projectRoot, options.projectConfig);
}

export function workItemLookupFailureMessage(options: {
  component: ResolvedNexusProjectComponent;
  itemId: string;
  cause: unknown;
}): string {
  return (
    `Work item lookup failed for requested component "${options.component.id}" ` +
    `provider-local id "${options.itemId}" using tracker "${componentTrackerLabel(options.component)}": ` +
    errorMessage(options.cause)
  );
}

export function throwWorkItemLookupFailure(options: {
  component: ResolvedNexusProjectComponent;
  itemId: string;
  cause: unknown;
}): never {
  throw new Error(workItemLookupFailureMessage(options));
}

function componentQualifiedWorkItemId(
  components: ResolvedNexusProjectComponent[],
  workItemId: string,
): { component: ResolvedNexusProjectComponent; itemId: string } | null {
  const split = workItemId.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/u);
  if (!split) {
    return null;
  }

  const component = componentById(components, split[1]!);
  if (!component) {
    return null;
  }
  const itemId = split[2]!.trim();
  if (!itemId) {
    throw new Error(
      `Component-qualified work item id for component "${component.id}" must include a provider-local id.`,
    );
  }

  return { component, itemId };
}

function localComponentsContainingWorkItem(options: {
  projectRoot: string;
  components: ResolvedNexusProjectComponent[];
  itemId: string;
}): ResolvedNexusProjectComponent[] {
  return options.components.filter((component) => {
    if (component.workTracking?.provider !== "local") {
      return false;
    }

    try {
      const storePath = resolveLocalWorkTrackingStorePath(
        options.projectRoot,
        component.workTracking as LocalWorkTrackingConfig,
      );
      const store = loadLocalWorkTrackingStore(storePath);
      return store.items.some((item) => item.id === options.itemId);
    } catch (error) {
      throw new Error(
        `Could not inspect tracker "${componentTrackerLabel(component)}" for component "${component.id}" while resolving provider-local id "${options.itemId}": ${errorMessage(error)}`,
      );
    }
  });
}

function inferComponentFromPath(
  components: ResolvedNexusProjectComponent[],
  currentPath: string,
): ResolvedNexusProjectComponent | null {
  const inferred = components
    .flatMap((component) => [
      { component, root: component.sourceRoot },
      { component, root: component.worktreesRoot },
    ])
    .filter((candidate) => samePathOrDescendant(currentPath, candidate.root))
    .sort((a, b) => b.root.length - a.root.length)[0];

  return inferred?.component ?? null;
}

function componentById(
  components: ResolvedNexusProjectComponent[],
  componentId: string,
): ResolvedNexusProjectComponent | null {
  return components.find((component) => component.id === componentId) ?? null;
}

function componentTrackerSummary(
  component: ResolvedNexusProjectComponent,
): string {
  return `${component.id} (tracker: ${componentTrackerLabel(component)})`;
}

function componentTrackerLabel(component: ResolvedNexusProjectComponent): string {
  return component.workTracking?.provider ?? "unconfigured";
}

function samePathOrDescendant(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requiredNonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
