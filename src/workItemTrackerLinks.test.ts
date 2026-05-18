import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkItemTrackerLinkService,
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
  WorkItemTrackerLinkError,
} from "./workItemTrackerLinks.js";
import type { ResolvedWorkItemProjectContext } from "./workItemService.js";

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
): ResolvedWorkItemProjectContext {
  return {
    homePath: makeTempDir("dev-nexus-home-"),
    projectRoot,
    projectId: "tracked-project",
    projectName: "Tracked Project",
    componentId: "core",
    componentName: "Core",
    sourceRoot: path.join(projectRoot, "src"),
    defaultTrackerId: "primary",
    workTracking: {
      provider: "local",
      storePath: ".dev-nexus/work-items-primary.json",
    },
    workTrackers: [
      {
        id: "primary",
        name: "Primary",
        enabled: true,
        roles: ["primary"],
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/work-items-primary.json",
        },
      },
      {
        id: "github",
        name: "GitHub",
        enabled: true,
        roles: ["mirror", "coordination"],
        workTracking: {
          provider: "github",
          host: "github.com",
          repository: {
            owner: "example",
            name: "tracked-project",
            id: "repo-1",
          },
        },
      },
    ],
  };
}

function createProjectResolver(project: ResolvedWorkItemProjectContext) {
  return ({ projectRoot }: { projectRoot?: string }) => {
    if (projectRoot === project.projectRoot) {
      return project;
    }

    throw new WorkItemTrackerLinkError("project not found");
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("work item tracker links", () => {
  it("links and shows tracker references for a logical work item", async () => {
    const projectRoot = makeTempDir("dev-nexus-links-");
    const project = createProjectContext(projectRoot);
    const service = createWorkItemTrackerLinkService({
      resolveProject: createProjectResolver(project),
      now: fixedClock("2026-05-18T08:00:00.000Z"),
    });

    const linked = await service.linkReference({
      projectRoot,
      logicalItemId: "local-46",
      trackerId: "github",
      itemId: "github-issue-42",
      itemNumber: 42,
      nodeId: "I_kwDOExample",
      webUrl: "https://github.com/example/tracked-project/issues/42",
    });
    const shown = await service.showLinks({
      projectRoot,
      logicalItemId: "local-46",
    });

    expect(linked).toMatchObject({
      projectId: "tracked-project",
      componentId: "core",
      logicalItemId: "local-46",
      action: "linked",
      reference: {
        trackerId: "github",
        provider: "github",
        host: "github.com",
        repositoryId: "repo-1",
        repositoryOwner: "example",
        repositoryName: "tracked-project",
        itemId: "github-issue-42",
        itemNumber: 42,
        nodeId: "I_kwDOExample",
      },
    });
    expect(shown.references).toMatchObject([
      {
        trackerId: "github",
        itemId: "github-issue-42",
      },
    ]);
    expect(fs.existsSync(defaultWorkItemTrackerLinkStorePath(projectRoot))).toBe(
      true,
    );
  });

  it("updates duplicate link metadata without duplicating references", async () => {
    const projectRoot = makeTempDir("dev-nexus-links-");
    const project = createProjectContext(projectRoot);
    const service = createWorkItemTrackerLinkService({
      resolveProject: createProjectResolver(project),
      now: fixedClock(
        "2026-05-18T08:00:00.000Z",
        "2026-05-18T08:01:00.000Z",
        "2026-05-18T08:01:00.000Z",
      ),
    });

    await service.linkReference({
      projectRoot,
      logicalItemId: "local-46",
      trackerId: "github",
      itemId: "github-issue-42",
      itemNumber: 42,
      webUrl: "https://github.com/example/tracked-project/issues/42",
    });
    const updated = await service.linkReference({
      projectRoot,
      logicalItemId: "local-46",
      trackerId: "github",
      itemId: "github-issue-42",
      itemNumber: 42,
      nodeId: "I_kwDOUpdated",
      webUrl: "https://github.com/example/tracked-project/issues/42#updated",
    });
    const unchanged = await service.linkReference({
      projectRoot,
      logicalItemId: "local-46",
      trackerId: "github",
      itemId: "github-issue-42",
      itemNumber: 42,
      nodeId: "I_kwDOUpdated",
      webUrl: "https://github.com/example/tracked-project/issues/42#updated",
    });
    const store = loadWorkItemTrackerLinkStore(
      defaultWorkItemTrackerLinkStorePath(projectRoot),
    );

    expect(updated.action).toBe("updated");
    expect(unchanged.action).toBe("unchanged");
    expect(store.records[0]?.references).toHaveLength(1);
    expect(store.records[0]?.references[0]).toMatchObject({
      itemId: "github-issue-42",
      nodeId: "I_kwDOUpdated",
      webUrl: "https://github.com/example/tracked-project/issues/42#updated",
      firstObservedAt: "2026-05-18T08:00:00.000Z",
      lastObservedAt: "2026-05-18T08:01:00.000Z",
    });
    expect(store.records[0]?.audit.map((entry) => entry.action)).toEqual([
      "linked",
      "updated",
    ]);
  });

  it("rejects invalid tracker references", async () => {
    const projectRoot = makeTempDir("dev-nexus-links-");
    const project = createProjectContext(projectRoot);
    const service = createWorkItemTrackerLinkService({
      resolveProject: createProjectResolver(project),
    });

    await expect(
      service.linkReference({
        projectRoot,
        logicalItemId: "local-46",
        trackerId: "missing",
        itemId: "1",
      }),
    ).rejects.toThrow(/work tracker is not configured: missing/);
    await expect(
      service.linkReference({
        projectRoot,
        logicalItemId: "local-46",
        trackerId: "github",
        provider: "gitlab",
        itemId: "1",
      }),
    ).rejects.toThrow(/provider "gitlab" does not match tracker "github"/);
    await expect(
      service.linkReference({
        projectRoot,
        logicalItemId: "local-46",
        trackerId: "github",
      } as any),
    ).rejects.toThrow(/itemId must be a non-empty string/);
  });

  it("unlinks references and records removed reference audit metadata", async () => {
    const projectRoot = makeTempDir("dev-nexus-links-");
    const project = createProjectContext(projectRoot);
    const service = createWorkItemTrackerLinkService({
      resolveProject: createProjectResolver(project),
      now: fixedClock(
        "2026-05-18T08:00:00.000Z",
        "2026-05-18T08:05:00.000Z",
      ),
    });
    await service.linkReference({
      projectRoot,
      logicalItemId: "local-46",
      trackerId: "github",
      itemId: "github-issue-42",
      itemNumber: 42,
      webUrl: "https://github.com/example/tracked-project/issues/42",
    });

    const unlinked = await service.unlinkReference({
      projectRoot,
      logicalItemId: "local-46",
      trackerId: "github",
      itemId: "github-issue-42",
      reason: "Wrong external issue",
    });
    const shown = await service.showLinks({
      projectRoot,
      logicalItemId: "local-46",
    });

    expect(unlinked.removedReference).toMatchObject({
      trackerId: "github",
      itemId: "github-issue-42",
      webUrl: "https://github.com/example/tracked-project/issues/42",
    });
    expect(unlinked.audit).toMatchObject({
      action: "unlinked",
      reason: "Wrong external issue",
      removedReference: {
        trackerId: "github",
        itemId: "github-issue-42",
      },
    });
    expect(shown.references).toEqual([]);
    expect(shown.record?.audit.map((entry) => entry.action)).toEqual([
      "linked",
      "unlinked",
    ]);
  });
});
