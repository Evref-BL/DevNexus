import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalWorkTrackerProvider,
  defaultLocalWorkTrackingStorePath,
  loadLocalWorkTrackingStore,
  localWorkTrackingStoreVersion,
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";

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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function holdStoreLock(storePath: string): () => void {
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const handle = fs.openSync(lockPath, "wx");
  try {
    fs.writeFileSync(handle, "external test lock\n", "utf8");
  } finally {
    fs.closeSync(handle);
  }

  return () => fs.rmSync(lockPath, { force: true });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("local work tracker provider", () => {
  it("creates and persists work items under the default project store", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const provider = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-15T09:00:00.000Z"),
    });

    const item = await provider.createWorkItem({
      title: "  First local task  ",
      description: "Offline work item",
      labels: ["bug", " bug ", "triage"],
      assignees: ["alice"],
      milestone: "M1",
    });

    expect(item).toMatchObject({
      id: "local-1",
      title: "First local task",
      description: "Offline work item",
      status: "todo",
      provider: "local",
      labels: ["bug", "triage"],
      assignees: ["alice"],
      milestone: "M1",
      createdAt: "2026-05-15T09:00:00.000Z",
      externalRef: {
        provider: "local",
        itemId: "local-1",
        itemNumber: 1,
      },
    });

    const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
    expect(fs.existsSync(storePath)).toBe(true);
    expect(loadLocalWorkTrackingStore(storePath)).toMatchObject({
      version: localWorkTrackingStoreVersion,
      nextNumber: 2,
      items: [
        {
          id: "local-1",
          title: "First local task",
        },
      ],
    });

    const reloadedProvider = createLocalWorkTrackerProvider({ projectRoot });
    await expect(reloadedProvider.getWorkItem({ id: "local-1" })).resolves.toMatchObject({
      id: "local-1",
      title: "First local task",
    });
  });

  it("lists, filters, updates, and changes status locally", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const provider = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock(
        "2026-05-15T09:00:00.000Z",
        "2026-05-15T09:01:00.000Z",
        "2026-05-15T09:02:00.000Z",
        "2026-05-15T09:03:00.000Z",
        "2026-05-15T09:04:00.000Z",
      ),
    });

    await provider.createWorkItem({
      title: "Fix local provider",
      description: "Needs a filterable body",
      labels: ["bug"],
    });
    await provider.createWorkItem({
      title: "Document tracker",
      status: "ready",
      labels: ["docs"],
      assignees: ["bob"],
    });

    await expect(
      provider.updateWorkItem(
        { id: "local-1" },
        {
          status: "in_progress",
          labels: ["bug", "triaged"],
          assignees: ["alice"],
        },
      ),
    ).resolves.toMatchObject({
      id: "local-1",
      status: "in_progress",
      labels: ["bug", "triaged"],
      assignees: ["alice"],
    });

    await expect(provider.listWorkItems({ status: "in_progress" })).resolves.toHaveLength(1);
    await expect(
      provider.listWorkItems({
        labels: ["bug"],
        assignees: ["alice"],
        search: "filterable",
      }),
    ).resolves.toMatchObject([{ id: "local-1" }]);
    await expect(provider.listWorkItems({ limit: 1 })).resolves.toHaveLength(1);

    const closed = await provider.setStatus(
      { externalRef: { provider: "local", itemId: "local-1" } },
      "done",
    );
    expect(closed).toMatchObject({
      id: "local-1",
      status: "done",
    });
    expect(closed.closedAt).toBeTruthy();

    await expect(provider.setStatus({ id: "local-1" }, "todo")).resolves.toMatchObject({
      id: "local-1",
      status: "todo",
      closedAt: null,
    });
  });

  it("adds durable comments and updates the item timestamp", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const provider = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock(
        "2026-05-15T09:00:00.000Z",
        "2026-05-15T09:01:00.000Z",
      ),
    });
    const item = await provider.createWorkItem({ title: "Needs a note" });

    const comment = await provider.addComment({ id: item.id }, "  Investigated locally.  ");

    expect(comment).toEqual({
      id: "local-comment-1",
      body: "Investigated locally.",
      author: null,
      createdAt: "2026-05-15T09:01:00.000Z",
      updatedAt: "2026-05-15T09:01:00.000Z",
      externalRef: {
        provider: "local",
        itemId: "local-comment-1",
      },
    });

    const store = loadLocalWorkTrackingStore(
      defaultLocalWorkTrackingStorePath(projectRoot),
    );
    expect(store.comments[item.id]).toEqual([comment]);
    await expect(provider.getWorkItem({ id: item.id })).resolves.toMatchObject({
      id: item.id,
      updatedAt: comment.updatedAt,
    });
  });

  it("supports configured store paths, detection, and actionable errors", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const provider = createLocalWorkTrackerProvider({
      projectRoot,
      config: {
        provider: "local",
        storePath: path.join(".custom", "items.json"),
      },
    });

    expect(
      resolveLocalWorkTrackingStorePath(projectRoot, {
        storePath: path.join(".custom", "items.json"),
      }),
    ).toBe(path.join(projectRoot, ".custom", "items.json"));

    await provider.ensureProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      projectId: "project-1",
      projectName: "Project One",
    });
    expect(fs.existsSync(path.join(projectRoot, ".custom", "items.json"))).toBe(true);

    await expect(provider.detect({ projectRoot })).resolves.toMatchObject({
      confidence: "high",
      config: {
        provider: "local",
        storePath: path.join(".custom", "items.json"),
      },
    });

    await expect(
      createLocalWorkTrackerProvider().createWorkItem({ title: "No root" }),
    ).rejects.toThrow(/projectRoot is required/);
    await expect(provider.getWorkItem({ id: "missing" })).rejects.toThrow(
      /Local work item not found/,
    );
    await expect(provider.createWorkItem({ title: "   " })).rejects.toThrow(
      /title must be a non-empty string/,
    );
  });

  it("serializes concurrent create, comment, and update mutations against one store", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const provider = createLocalWorkTrackerProvider({ projectRoot });
    const seedItems = [];
    for (let index = 0; index < 4; index += 1) {
      seedItems.push(await provider.createWorkItem({ title: `Seed ${index}` }));
    }

    const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
    const releaseLock = holdStoreLock(storePath);
    let completed = false;
    const mutations = Promise.all([
      ...Array.from({ length: 4 }, (_, index) =>
        createLocalWorkTrackerProvider({ projectRoot }).createWorkItem({
          title: `Created ${index}`,
          labels: [`created-${index}`],
        }),
      ),
      ...seedItems.map((item, index) =>
        createLocalWorkTrackerProvider({ projectRoot }).addComment(
          { id: item.id },
          `Comment ${index}`,
        ),
      ),
      ...seedItems.map((item, index) =>
        createLocalWorkTrackerProvider({ projectRoot }).updateWorkItem(
          { id: item.id },
          { labels: [`updated-${index}`] },
        ),
      ),
    ]).then((result) => {
      completed = true;
      return result;
    });

    try {
      await sleep(25);
      expect(completed).toBe(false);
    } finally {
      releaseLock();
    }

    const results = await mutations;
    const created = results.slice(0, 4).map((item) => item.id);
    expect(new Set(created).size).toBe(4);

    const rawStore = fs.readFileSync(storePath, "utf8");
    expect(() => JSON.parse(rawStore)).not.toThrow();
    const store = loadLocalWorkTrackingStore(storePath);
    expect(store.items).toHaveLength(8);
    expect(store.nextNumber).toBe(9);
    expect(store.nextCommentNumber).toBe(5);
    expect(new Set(store.items.map((item) => item.id)).size).toBe(8);

    for (const [index, item] of seedItems.entries()) {
      expect(store.comments[item.id]).toHaveLength(1);
      expect(store.comments[item.id]?.[0]?.id).toMatch(/^local-comment-\d+$/u);
      expect(store.comments[item.id]?.[0]?.body).toBe(`Comment ${index}`);
      expect(store.items.find((candidate) => candidate.id === item.id)).toMatchObject({
        id: item.id,
        labels: [`updated-${index}`],
      });
    }
  });

  it("keeps a corrupted store unchanged and reports parse recovery context", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const provider = createLocalWorkTrackerProvider({ projectRoot });
    const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
    const corruptedStore = `${JSON.stringify({
      version: localWorkTrackingStoreVersion,
      nextNumber: 1,
      nextCommentNumber: 1,
      updatedAt: "2026-05-15T09:00:00.000Z",
      items: [],
      comments: {},
    })}\n{\"duplicated\":\"tail\"}\n`;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, corruptedStore, "utf8");

    let caught: unknown;
    try {
      await provider.createWorkItem({ title: "Should not overwrite" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(path.resolve(storePath));
    expect(message).toContain("createWorkItem");
    expect(message).toContain("Recovery:");
    expect(message).toContain("Original error:");
    expect((caught as { cause?: unknown }).cause).toBeInstanceOf(SyntaxError);
    expect(fs.readFileSync(storePath, "utf8")).toBe(corruptedStore);
  });
});
