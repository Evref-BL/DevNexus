import {
  createWorkTrackerProvider,
  type CreateWorkTrackerProviderOptions,
  WorkTrackingProviderServiceError,
} from "./workTrackingProviderService.js";
import type {
  CreateWorkItemInput,
  NexusProjectContext,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export interface WorkItemProjectSelector {
  project?: string;
  projectRoot?: string;
}

export interface ResolvedWorkItemProjectContext
  extends Omit<NexusProjectContext, "workTracking"> {
  workTracking: WorkTrackingConfig;
}

export interface ResolvedWorkItemProviderContext {
  projectContext: ResolvedWorkItemProjectContext;
  projectRoot: string;
  workTracking: WorkTrackingConfig;
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
  ): Promise<ResolvedWorkItemProviderContext> {
    const normalizedSelector = normalizeProjectSelectorObject(selector);
    const projectContext = await this.resolveProject(normalizedSelector);
    const workTracking = projectContext.workTracking;

    try {
      return {
        projectContext,
        projectRoot: projectContext.projectRoot,
        workTracking,
        provider: this.createProvider(projectContext),
      };
    } catch (error) {
      if (error instanceof WorkTrackingProviderServiceError) {
        throw new WorkItemServiceError(
          `Project "${projectContext.projectId}" uses work tracking provider ` +
            `"${workTracking.provider}", but it is not available: ${error.message}`,
        );
      }

      throw error;
    }
  }

  async createWorkItem(input: CreateProjectWorkItemInput): Promise<WorkItem> {
    const { project: _project, projectRoot: _projectRoot, ...item } = input;
    const context = await this.resolveProviderContext(input);
    return context.provider.createWorkItem({
      ...item,
      projectRoot: context.projectRoot,
    });
  }

  async listWorkItems(input: ListProjectWorkItemsInput): Promise<WorkItem[]> {
    const { project: _project, projectRoot: _projectRoot, ...query } = input;
    const context = await this.resolveProviderContext(input);
    return context.provider.listWorkItems({
      ...query,
      projectRoot: context.projectRoot,
    });
  }

  async getWorkItem(input: GetProjectWorkItemInput): Promise<WorkItem> {
    const { project: _project, projectRoot: _projectRoot, ...ref } = input;
    const context = await this.resolveProviderContext(input);
    return context.provider.getWorkItem(
      normalizeWorkItemRef(ref, context.provider.provider),
    );
  }

  async updateWorkItem(input: UpdateProjectWorkItemInput): Promise<WorkItem> {
    const context = await this.resolveProviderContext(input);
    return context.provider.updateWorkItem(
      normalizeWorkItemRef(input.ref, context.provider.provider),
      input.patch,
    );
  }

  async addComment(
    input: AddProjectWorkItemCommentInput,
  ): Promise<WorkComment> {
    const context = await this.resolveProviderContext(input);
    return context.provider.addComment(
      normalizeWorkItemRef(input.ref, context.provider.provider),
      input.body,
    );
  }

  async setStatus(input: SetProjectWorkItemStatusInput): Promise<WorkItem> {
    const context = await this.resolveProviderContext(input);
    const ref = normalizeWorkItemRef(input.ref, context.provider.provider);
    if (context.provider.setStatus) {
      return context.provider.setStatus(ref, input.status);
    }

    return context.provider.updateWorkItem(ref, { status: input.status });
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
  if (project && projectRoot) {
    throw new WorkItemServiceError("Provide either project or projectRoot, not both");
  }
  if (!project && !projectRoot) {
    throw new WorkItemServiceError("project or projectRoot is required");
  }

  return project ? { project } : { projectRoot };
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
