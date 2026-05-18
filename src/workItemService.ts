import {
  assertWorkTrackerCapability,
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
  WorkTrackingProviderServiceError,
} from "./workTrackingProviderService.js";
import type {
  CreateWorkItemInput,
  ExternalRef,
  NexusProjectContext,
  NexusProjectWorkTrackerContext,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerRef,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export interface WorkItemProjectSelector {
  project?: string;
  projectRoot?: string;
  componentId?: string;
  trackerId?: string;
}

export interface ResolvedWorkItemProjectContext
  extends Omit<NexusProjectContext, "workTracking"> {
  workTracking: WorkTrackingConfig;
}

export interface ResolvedWorkItemProviderContext {
  projectContext: ResolvedWorkItemProjectContext;
  projectRoot: string;
  workTracking: WorkTrackingConfig;
  trackerId: string;
  trackerName: string;
  trackerRoles: string[];
  defaultTrackerId: string | null;
  resolvedRef?: WorkItemRef;
  provider: WorkTrackerProvider;
}

export type WorkItemProjectResolver = (
  selector: WorkItemProjectSelector,
) => ResolvedWorkItemProjectContext | Promise<ResolvedWorkItemProjectContext>;

export type WorkItemProviderFactory = (
  context: ResolvedWorkItemProjectContext,
) => WorkTrackerProvider;

export interface WorkItemServiceOptions {
  resolveProject: WorkItemProjectResolver;
  providerFactory?: WorkItemProviderFactory;
  providerOptions?: Omit<CreateWorkTrackerProviderOptions, "projectRoot" | "now">;
  now?: () => Date | string;
}

export type CreateProjectWorkItemInput = WorkItemProjectSelector &
  Omit<CreateWorkItemInput, "projectRoot">;

export type ListProjectWorkItemsInput = WorkItemProjectSelector &
  Omit<WorkItemQuery, "projectRoot">;

export type GetProjectWorkItemInput = WorkItemProjectSelector & WorkItemRef;

export interface UpdateProjectWorkItemInput extends WorkItemProjectSelector {
  ref: WorkItemRef;
  patch: WorkItemPatch;
}

export interface AddProjectWorkItemCommentInput extends WorkItemProjectSelector {
  ref: WorkItemRef;
  body: string;
}

export interface SetProjectWorkItemStatusInput extends WorkItemProjectSelector {
  ref: WorkItemRef;
  status: WorkStatus;
}

export class WorkItemServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkItemServiceError";
  }
}

export function createWorkItemService(
  options: WorkItemServiceOptions,
): WorkItemService {
  return new WorkItemService(options);
}

export class WorkItemService {
  private readonly resolveProject: WorkItemProjectResolver;
  private readonly providerFactory?: WorkItemProviderFactory;
  private readonly providerOptions?: Omit<
    CreateWorkTrackerProviderOptions,
    "projectRoot" | "now"
  >;
  private readonly now?: () => Date | string;

  constructor(options: WorkItemServiceOptions) {
    this.resolveProject = options.resolveProject;
    this.providerFactory = options.providerFactory;
    this.providerOptions = options.providerOptions;
    this.now = options.now;
  }

  async resolveProviderContext(
    selector: WorkItemProjectSelector,
    ref?: WorkItemRef,
  ): Promise<ResolvedWorkItemProviderContext> {
    const normalizedSelector = normalizeProjectSelectorObject(selector);
    const projectContext = await this.resolveProject(normalizedSelector);
    const selectedTracker = resolveWorkTrackerSelection({
      projectContext,
      selector: normalizedSelector,
      ref,
    });
    const selectedProjectContext = {
      ...projectContext,
      defaultTrackerId: selectedTracker.defaultTrackerId,
      trackerId: selectedTracker.tracker.id,
      trackerName: selectedTracker.tracker.name ?? selectedTracker.tracker.id,
      trackerRoles: selectedTracker.tracker.roles ?? [],
      workTracking: selectedTracker.tracker.workTracking,
    };
    const workTracking = selectedProjectContext.workTracking;

    try {
      return {
        projectContext: selectedProjectContext,
        projectRoot: selectedProjectContext.projectRoot,
        workTracking,
        trackerId: selectedTracker.tracker.id,
        trackerName: selectedTracker.tracker.name ?? selectedTracker.tracker.id,
        trackerRoles: selectedTracker.tracker.roles ?? [],
        defaultTrackerId: selectedTracker.defaultTrackerId,
        ...(selectedTracker.resolvedRef
          ? { resolvedRef: selectedTracker.resolvedRef }
          : {}),
        provider: this.createProvider(selectedProjectContext),
      };
    } catch (error) {
      if (error instanceof WorkTrackingProviderServiceError) {
        throw new WorkItemServiceError(
          `Project "${projectContext.projectId}" component ` +
            `"${projectContext.componentId ?? "primary"}" tracker ` +
            `"${selectedTracker.tracker.id}" uses work tracking provider ` +
            `"${workTracking.provider}", but it is not available: ${error.message}`,
        );
      }

      throw error;
    }
  }

  async createWorkItem(input: CreateProjectWorkItemInput): Promise<WorkItem> {
    const {
      project: _project,
      projectRoot: _projectRoot,
      componentId: _componentId,
      trackerId: _trackerId,
      ...item
    } = input;
    const context = await this.resolveProviderContext(input);
    assertWorkTrackerCapability(
      context.provider,
      "create",
      "create work items",
    );
    assertCreateFieldCapabilities(context.provider, item);
    return annotateWorkItem(
      await context.provider.createWorkItem({
        ...item,
        projectRoot: context.projectRoot,
      }),
      context,
    );
  }

  async listWorkItems(input: ListProjectWorkItemsInput): Promise<WorkItem[]> {
    const {
      project: _project,
      projectRoot: _projectRoot,
      componentId: _componentId,
      trackerId: _trackerId,
      ...query
    } = input;
    const context = await this.resolveProviderContext(input);
    assertWorkTrackerCapability(
      context.provider,
      "list",
      "list work items",
    );
    return (
      await context.provider.listWorkItems({
        ...query,
        projectRoot: context.projectRoot,
      })
    ).map((item) => annotateWorkItem(item, context));
  }

  async getWorkItem(input: GetProjectWorkItemInput): Promise<WorkItem> {
    const {
      project: _project,
      projectRoot: _projectRoot,
      componentId: _componentId,
      trackerId: _trackerId,
      ...ref
    } = input;
    const context = await this.resolveProviderContext(input, ref);
    assertWorkTrackerCapability(context.provider, "get", "get work items");
    return annotateWorkItem(
      await context.provider.getWorkItem(
        normalizeWorkItemRef(
          context.resolvedRef ?? ref,
          context.provider.provider,
        ),
      ),
      context,
    );
  }

  async updateWorkItem(input: UpdateProjectWorkItemInput): Promise<WorkItem> {
    const context = await this.resolveProviderContext(input, input.ref);
    assertWorkTrackerCapability(
      context.provider,
      "update",
      "update work items",
    );
    assertPatchFieldCapabilities(context.provider, input.patch);
    return annotateWorkItem(
      await context.provider.updateWorkItem(
        normalizeWorkItemRef(
          context.resolvedRef ?? input.ref,
          context.provider.provider,
        ),
        input.patch,
      ),
      context,
    );
  }

  async addComment(
    input: AddProjectWorkItemCommentInput,
  ): Promise<WorkComment> {
    const context = await this.resolveProviderContext(input, input.ref);
    assertWorkTrackerCapability(
      context.provider,
      "comment",
      "add comments",
    );
    return annotateWorkComment(
      await context.provider.addComment(
        normalizeWorkItemRef(
          context.resolvedRef ?? input.ref,
          context.provider.provider,
        ),
        input.body,
      ),
      context,
    );
  }

  async setStatus(input: SetProjectWorkItemStatusInput): Promise<WorkItem> {
    const context = await this.resolveProviderContext(input, input.ref);
    assertWorkTrackerCapability(
      context.provider,
      "update",
      "set work item status",
    );
    const ref = normalizeWorkItemRef(
      context.resolvedRef ?? input.ref,
      context.provider.provider,
    );
    if (context.provider.setStatus) {
      return annotateWorkItem(
        await context.provider.setStatus(ref, input.status),
        context,
      );
    }

    return annotateWorkItem(
      await context.provider.updateWorkItem(ref, { status: input.status }),
      context,
    );
  }

  private createProvider(
    context: ResolvedWorkItemProjectContext,
  ): WorkTrackerProvider {
    if (this.providerFactory) {
      return this.providerFactory(context);
    }

    return createWorkTrackerProvider(context.workTracking, {
      ...this.providerOptions,
      projectRoot: context.projectRoot,
      now: this.now,
    });
  }
}

export function normalizeProjectSelector(
  selector: WorkItemProjectSelector,
): string {
  const normalizedSelector = normalizeProjectSelectorObject(selector);
  return normalizedSelector.project ?? normalizedSelector.projectRoot!;
}

export function normalizeWorkItemRef(
  ref: WorkItemRef,
  provider: string,
): WorkItemRef {
  const refProvider = ref.provider ?? ref.externalRef?.provider;
  if (refProvider && refProvider !== provider) {
    throw new WorkItemServiceError(
      `work item ref provider "${refProvider}" does not match configured provider "${provider}"`,
    );
  }
  if (!ref.id && !ref.externalRef?.itemId) {
    throw new WorkItemServiceError("work item id or externalRef.itemId is required");
  }

  return {
    ...ref,
    provider: refProvider ?? provider,
  };
}

function normalizeProjectSelectorObject(
  selector: WorkItemProjectSelector,
): WorkItemProjectSelector {
  const project = optionalNonEmptyString(selector.project, "project");
  const projectRoot = optionalNonEmptyString(selector.projectRoot, "projectRoot");
  const componentId = optionalNonEmptyString(selector.componentId, "componentId");
  const trackerId = optionalNonEmptyString(selector.trackerId, "trackerId");
  if (project && projectRoot) {
    throw new WorkItemServiceError("Provide either project or projectRoot, not both");
  }
  if (!project && !projectRoot) {
    throw new WorkItemServiceError("project or projectRoot is required");
  }

  return {
    ...(project ? { project } : { projectRoot }),
    ...(componentId ? { componentId } : {}),
    ...(trackerId ? { trackerId } : {}),
  };
}

interface WorkTrackerSelection {
  tracker: Required<NexusProjectWorkTrackerContext>;
  defaultTrackerId: string | null;
  resolvedRef?: WorkItemRef;
}

function resolveWorkTrackerSelection(options: {
  projectContext: ResolvedWorkItemProjectContext;
  selector: WorkItemProjectSelector;
  ref?: WorkItemRef;
}): WorkTrackerSelection {
  const trackers = normalizedProjectContextTrackers(options.projectContext);
  const componentLabel = options.projectContext.componentId ?? "primary";
  if (trackers.length === 0) {
    throw new WorkItemServiceError(
      `Component "${componentLabel}" work tracking is not configured`,
    );
  }

  const defaultTrackerId =
    options.projectContext.defaultTrackerId ??
    options.projectContext.trackerId ??
    trackers.find((tracker) => tracker.enabled)?.id ??
    null;
  const qualifiedRef = trackerQualifiedRef(trackers, options.ref);
  if (
    options.selector.trackerId &&
    qualifiedRef &&
    options.selector.trackerId !== qualifiedRef.trackerId
  ) {
    throw new WorkItemServiceError(
      `Work item id tracker "${qualifiedRef.trackerId}" conflicts with requested tracker "${options.selector.trackerId}"`,
    );
  }

  const selectedTrackerId =
    options.selector.trackerId ??
    qualifiedRef?.trackerId ??
    externalRefTrackerId({
      trackers,
      defaultTrackerId,
      externalRef: options.ref?.externalRef,
      componentId: componentLabel,
    }) ??
    defaultTrackerId;

  if (!selectedTrackerId) {
    throw new WorkItemServiceError(
      `Component "${componentLabel}" default work tracker is not configured`,
    );
  }

  const tracker = trackers.find((candidate) => candidate.id === selectedTrackerId);
  if (!tracker) {
    throw new WorkItemServiceError(
      `Component "${componentLabel}" work tracker is not configured: ${selectedTrackerId}`,
    );
  }
  if (!tracker.enabled) {
    throw new WorkItemServiceError(
      `Component "${componentLabel}" work tracker "${tracker.id}" is disabled`,
    );
  }

  return {
    tracker,
    defaultTrackerId,
    ...(qualifiedRef
      ? {
          resolvedRef: {
            ...options.ref,
            id: qualifiedRef.itemId,
          },
        }
      : {}),
  };
}

function normalizedProjectContextTrackers(
  projectContext: ResolvedWorkItemProjectContext,
): Array<Required<NexusProjectWorkTrackerContext>> {
  const configured = projectContext.workTrackers ?? [];
  if (configured.length > 0) {
    return configured.map((tracker) => ({
      id: requiredNonEmptyString(tracker.id, "tracker.id"),
      name: tracker.name ?? tracker.id,
      enabled: tracker.enabled ?? true,
      roles: tracker.roles ?? [],
      workTracking: tracker.workTracking,
    }));
  }

  return [
    {
      id:
        projectContext.trackerId ??
        projectContext.defaultTrackerId ??
        "default",
      name:
        projectContext.trackerName ??
        projectContext.trackerId ??
        projectContext.defaultTrackerId ??
        "Default",
      enabled: true,
      roles: projectContext.trackerRoles ?? ["primary"],
      workTracking: projectContext.workTracking,
    },
  ];
}

function trackerQualifiedRef(
  trackers: Array<Required<NexusProjectWorkTrackerContext>>,
  ref: WorkItemRef | undefined,
): { trackerId: string; itemId: string } | null {
  const id = ref?.id;
  if (!id) {
    return null;
  }

  const split = id.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/u);
  if (!split) {
    return null;
  }

  const trackerId = split[1]!;
  if (!trackers.some((tracker) => tracker.id === trackerId)) {
    return null;
  }

  const itemId = split[2]!.trim();
  if (!itemId) {
    throw new WorkItemServiceError(
      `Tracker-qualified work item id for tracker "${trackerId}" must include a provider-local id.`,
    );
  }

  return { trackerId, itemId };
}

function externalRefTrackerId(options: {
  trackers: Array<Required<NexusProjectWorkTrackerContext>>;
  defaultTrackerId: string | null;
  externalRef: ExternalRef | undefined;
  componentId: string;
}): string | null {
  if (!options.externalRef) {
    return null;
  }

  const defaultTracker = options.trackers.find(
    (tracker) => tracker.id === options.defaultTrackerId,
  );
  if (defaultTracker && externalRefMatchesTracker(options.externalRef, defaultTracker)) {
    return defaultTracker.id;
  }

  const matches = options.trackers.filter(
    (tracker) =>
      tracker.enabled && externalRefMatchesTracker(options.externalRef!, tracker),
  );
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new WorkItemServiceError(
      `External ref provider "${options.externalRef.provider}" is ambiguous across component "${options.componentId}" trackers: ` +
        matches.map((tracker) => tracker.id).join(", "),
    );
  }

  return matches[0]!.id;
}

function externalRefMatchesTracker(
  externalRef: ExternalRef,
  tracker: Pick<NexusProjectWorkTrackerContext, "workTracking">,
): boolean {
  const config = tracker.workTracking;
  if (externalRef.provider !== config.provider) {
    return false;
  }
  if (externalRef.host && config.host && externalRef.host !== config.host) {
    return false;
  }

  const repository = config.repository;
  if (externalRef.repositoryId && repository?.id) {
    return externalRef.repositoryId === repository.id;
  }
  if (externalRef.repositoryOwner && repository?.owner) {
    if (externalRef.repositoryOwner !== repository.owner) {
      return false;
    }
  }
  if (externalRef.repositoryName && repository?.name) {
    if (externalRef.repositoryName !== repository.name) {
      return false;
    }
  }
  if (externalRef.projectId) {
    if (config.provider === "vibe-kanban") {
      return !config.projectId || externalRef.projectId === config.projectId;
    }
    if (config.provider === "jira") {
      return externalRef.projectId === config.projectKey;
    }
  }
  if (externalRef.boardId && config.board?.id) {
    return externalRef.boardId === config.board.id;
  }

  return true;
}

function annotateWorkItem(
  item: WorkItem,
  context: ResolvedWorkItemProviderContext,
): WorkItem {
  return {
    ...item,
    trackerRef: trackerRefForContext(context),
  };
}

function annotateWorkComment(
  comment: WorkComment,
  context: ResolvedWorkItemProviderContext,
): WorkComment {
  return {
    ...comment,
    trackerRef: trackerRefForContext(context),
  };
}

function trackerRefForContext(
  context: ResolvedWorkItemProviderContext,
): WorkTrackerRef {
  return {
    ...(context.projectContext.componentId
      ? { componentId: context.projectContext.componentId }
      : {}),
    ...(context.projectContext.componentName
      ? { componentName: context.projectContext.componentName }
      : {}),
    trackerId: context.trackerId,
    trackerName: context.trackerName,
    provider: context.workTracking.provider,
    roles: context.trackerRoles,
    default: context.defaultTrackerId === context.trackerId,
  };
}

function assertCreateFieldCapabilities(
  provider: WorkTrackerProvider,
  input: Omit<CreateWorkItemInput, "projectRoot">,
): void {
  if (input.labels && input.labels.length > 0) {
    assertWorkTrackerCapability(
      provider,
      "labels",
      "set labels on created work items",
    );
  }
  if (input.assignees && input.assignees.length > 0) {
    assertWorkTrackerCapability(
      provider,
      "assignees",
      "set assignees on created work items",
    );
  }
  if (input.milestone !== undefined && input.milestone !== null) {
    assertWorkTrackerCapability(
      provider,
      "milestones",
      "set milestones on created work items",
    );
  }
}

function assertPatchFieldCapabilities(
  provider: WorkTrackerProvider,
  patch: WorkItemPatch,
): void {
  if (patch.labels !== undefined) {
    assertWorkTrackerCapability(
      provider,
      "labels",
      "set labels on updated work items",
    );
  }
  if (patch.assignees !== undefined) {
    assertWorkTrackerCapability(
      provider,
      "assignees",
      "set assignees on updated work items",
    );
  }
  if (patch.milestone !== undefined) {
    assertWorkTrackerCapability(
      provider,
      "milestones",
      "set milestones on updated work items",
    );
  }
}

function optionalNonEmptyString(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkItemServiceError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
