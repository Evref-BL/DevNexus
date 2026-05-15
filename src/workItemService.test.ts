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
});
