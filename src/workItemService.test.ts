import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkItemService,
  normalizeProjectSelector,
  normalizeWorkItemRef,
  type ResolvedWorkItemProjectContext,
  WorkItemServiceError,
} from "./workItemService.js";
import type {
  TrackerCapabilities,
  WorkComment,
  WorkItem,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

function createProjectContext(
  projectRoot: string,
  overrides: Partial<ResolvedWorkItemProjectContext> = {},
): ResolvedWorkItemProjectContext {
  return {
    homePath: makeTempDir("dev-nexus-home-"),
    projectRoot,
    projectId: "tracked-project",
    projectName: "Tracked Project",
    sourceRoot: path.join(projectRoot, "src"),
    workTracking: {
      provider: "local",
      storePath: path.join(".tracker", "items.json"),
    },
    ...overrides,
  };
}

function createProjectResolver(project: ResolvedWorkItemProjectContext) {
  return ({ project: projectId, projectRoot }: { project?: string; projectRoot?: string }) => {
    if (projectId === project.projectId || projectRoot === project.projectRoot) {
      return project;
    }

    throw new WorkItemServiceError("project not found");
  };
}

const noWorkItemCapabilities: TrackerCapabilities = {
  createItem: false,
  listItems: false,
  getItem: false,
  updateItem: false,
  comment: false,
  labels: false,
  assignees: false,
  milestones: false,
  board: true,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

function unsupportedProvider(): WorkTrackerProvider {
  const shouldNotRun = async (): Promise<never> => {
    throw new Error("provider method should not run");
  };

  return {
    provider: "vibe-kanban",
    capabilities: noWorkItemCapabilities,
    createWorkItem: shouldNotRun,
    listWorkItems: shouldNotRun,
    getWorkItem: shouldNotRun,
    updateWorkItem: shouldNotRun,
    addComment: shouldNotRun,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("work item service", () => {
  it("resolves projects and delegates work item operations", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const project = createProjectContext(projectRoot);
    const service = createWorkItemService({
      resolveProject: createProjectResolver(project),
      now: fixedClock(
        "2026-05-15T10:00:00.000Z",
        "2026-05-15T10:01:00.000Z",
        "2026-05-15T10:02:00.000Z",
        "2026-05-15T10:03:00.000Z",
      ),
    });

    const created = await service.createWorkItem({
      project: "tracked-project",
      title: "Create via app service",
      labels: ["local"],
    });
    expect(created).toMatchObject({
      id: "local-1",
      title: "Create via app service",
      provider: "local",
    });
    expect(fs.existsSync(path.join(projectRoot, ".tracker", "items.json"))).toBe(
      true,
    );

    await expect(
      service.listWorkItems({
        project: "tracked-project",
        labels: ["local"],
      }),
    ).resolves.toMatchObject([{ id: "local-1" }]);
    await expect(
      service.updateWorkItem({
        project: "tracked-project",
        ref: { id: "local-1" },
        patch: {
          status: "in_progress",
        },
      }),
    ).resolves.toMatchObject({
      id: "local-1",
      status: "in_progress",
    });
    await expect(
      service.addComment({
        project: "tracked-project",
        ref: { id: "local-1" },
        body: "Recorded by service",
      }),
    ).resolves.toMatchObject({
      id: "local-comment-1",
      body: "Recorded by service",
    });
    await expect(
      service.setStatus({
        project: "tracked-project",
        ref: { externalRef: { provider: "local", itemId: "local-1" } },
        status: "done",
      }),
    ).resolves.toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("supports projectRoot selectors and exposes provider context", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const project = createProjectContext(projectRoot);
    const service = createWorkItemService({
      resolveProject: createProjectResolver(project),
    });

    const context = await service.resolveProviderContext({ projectRoot });

    expect(context.projectContext).toMatchObject({
      homePath: project.homePath,
      projectRoot,
      projectId: "tracked-project",
      projectName: "Tracked Project",
      sourceRoot: path.join(projectRoot, "src"),
      workTracking: {
        provider: "local",
      },
    });
    await expect(
      service.createWorkItem({
        projectRoot,
        title: "Path-selected item",
      }),
    ).resolves.toMatchObject({
      id: "local-1",
      title: "Path-selected item",
    });
    await expect(
      service.getWorkItem({
        projectRoot,
        id: "local-1",
      }),
    ).resolves.toMatchObject({
      id: "local-1",
    });
  });

  it("normalizes project selectors and item refs with clear errors", () => {
    expect(normalizeProjectSelector({ project: "  tracked-project " })).toBe(
      "tracked-project",
    );
    expect(() => normalizeProjectSelector({})).toThrow(
      /project or projectRoot is required/,
    );
    expect(() =>
      normalizeProjectSelector({
        project: "tracked-project",
        projectRoot: "C:\\dev\\project",
      }),
    ).toThrow(/either project or projectRoot/);

    expect(normalizeWorkItemRef({ id: "local-1" }, "local")).toEqual({
      id: "local-1",
      provider: "local",
    });
    expect(() => normalizeWorkItemRef({}, "local")).toThrow(
      /work item id or externalRef\.itemId is required/,
    );
    expect(() =>
      normalizeWorkItemRef({ provider: "github", id: "1" }, "local"),
    ).toThrow(/does not match configured provider/);
  });

  it("wraps unavailable provider diagnostics with project context", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const project = createProjectContext(projectRoot, {
      workTracking: {
        provider: "vibe-kanban",
        projectId: "legacy-vibe-project",
      },
    });
    const service = createWorkItemService({
      resolveProject: createProjectResolver(project),
    });

    await expect(
      service.resolveProviderContext({ project: "tracked-project" }),
    ).rejects.toThrow(WorkItemServiceError);
    await expect(
      service.resolveProviderContext({ project: "tracked-project" }),
    ).rejects.toThrow(/tracked-project.*vibe-kanban.*not available/);
  });

  it("fails before provider calls when neutral capabilities are disabled", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const project = createProjectContext(projectRoot, {
      workTracking: {
        provider: "vibe-kanban",
        projectId: "legacy-vibe-project",
      },
    });
    const service = createWorkItemService({
      resolveProject: createProjectResolver(project),
      providerFactory: unsupportedProvider,
    });

    await expect(
      service.createWorkItem({
        project: "tracked-project",
        title: "Unsupported create",
      }),
    ).rejects.toThrow(
      /provider "vibe-kanban" cannot create work items; required capability "create" is disabled/,
    );
    await expect(
      service.listWorkItems({ project: "tracked-project" }),
    ).rejects.toThrow(
      /provider "vibe-kanban" cannot list work items; required capability "list" is disabled/,
    );
    await expect(
      service.addComment({
        project: "tracked-project",
        ref: { id: "vibe-1" },
        body: "Unsupported comment",
      }),
    ).rejects.toThrow(
      /provider "vibe-kanban" cannot add comments; required capability "comment" is disabled/,
    );
  });

  it("reports field-level capability gaps before writing unsupported metadata", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const project = createProjectContext(projectRoot);
    const provider: WorkTrackerProvider = {
      provider: "minimal",
      capabilities: {
        ...noWorkItemCapabilities,
        createItem: true,
        listItems: true,
        getItem: true,
        updateItem: true,
        comment: true,
        board: false,
      },
      createWorkItem: async (): Promise<WorkItem> => ({
        id: "minimal-1",
        title: "Created",
        status: "todo",
        provider: "minimal",
      }),
      listWorkItems: async (): Promise<WorkItem[]> => [],
      getWorkItem: async (): Promise<WorkItem> => ({
        id: "minimal-1",
        title: "Created",
        status: "todo",
        provider: "minimal",
      }),
      updateWorkItem: async (): Promise<WorkItem> => ({
        id: "minimal-1",
        title: "Created",
        status: "todo",
        provider: "minimal",
      }),
      addComment: async (): Promise<WorkComment> => ({
        id: "minimal-comment-1",
        body: "Comment",
      }),
    };
    const service = createWorkItemService({
      resolveProject: createProjectResolver(project),
      providerFactory: () => provider,
    });

    await expect(
      service.createWorkItem({
        project: "tracked-project",
        title: "Needs labels",
        labels: ["bug"],
      }),
    ).rejects.toThrow(
      /provider "minimal" cannot set labels on created work items; required capability "labels" is disabled/,
    );
    await expect(
      service.updateWorkItem({
        project: "tracked-project",
        ref: { id: "minimal-1" },
        patch: {
          assignees: ["alice"],
        },
      }),
    ).rejects.toThrow(
      /provider "minimal" cannot set assignees on updated work items; required capability "assignees" is disabled/,
    );
  });
});
