import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkItemSyncPlan,
  executeWorkItemSync,
  readWorkItemSyncRunStore,
  type WorkItemSyncPolicyConfig,
} from "../../src/work-items/workItemSyncPlanner.js";
import {
  createWorkItemTrackerLinkService,
} from "../../src/work-items/workItemTrackerLinks.js";
import type {
  ResolvedWorkItemProjectContext,
  WorkItemProviderFactory,
} from "../../src/work-items/workItemService.js";
import type {
  CreateWorkItemInput,
  TrackerCapabilities,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkTrackerProvider,
} from "../../src/work-items/workTrackingTypes.js";

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

const fullCapabilities: TrackerCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: true,
  board: false,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

function createProjectContext(
  projectRoot: string,
): ResolvedWorkItemProjectContext {
  return {
    homePath: makeTempDir("dev-nexus-home-"),
    projectRoot,
    projectId: "sync-project",
    projectName: "Sync Project",
    componentId: "core",
    componentName: "Core",
    sourceRoot: path.join(projectRoot, "source"),
    defaultTrackerId: "primary",
    workTracking: {
      provider: "local",
      storePath: ".dev-nexus/primary-items.json",
    },
    workTrackers: [
      {
        id: "primary",
        name: "Primary",
        enabled: true,
        roles: ["primary"],
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/primary-items.json",
        },
      },
      {
        id: "mirror",
        name: "Mirror",
        enabled: true,
        roles: ["mirror"],
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/mirror-items.json",
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

    throw new Error("project not found");
  };
}

class MemoryWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider: string;
  readonly capabilities: TrackerCapabilities;
  readonly mutations: string[] = [];
  readonly comments = new Map<string, WorkComment[]>();
  readonly patches: WorkItemPatch[] = [];
  private nextNumber = 1;

  constructor(
    private readonly items: WorkItem[],
    capabilities: Partial<TrackerCapabilities> = {},
    provider = "local",
  ) {
    this.provider = provider;
    this.capabilities = { ...fullCapabilities, ...capabilities };
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    this.mutations.push("create");
    const number = this.nextNumber;
    this.nextNumber += 1;
    const item = workItem(`${this.provider}-${number}`, {
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "todo",
      provider: this.provider,
      labels: input.labels ?? [],
      assignees: input.assignees ?? [],
      milestone: input.milestone ?? null,
      updatedAt: "2026-05-18T09:00:00.000Z",
      webUrl:
        this.provider === "github"
          ? `https://github.com/example/project/issues/${number}`
          : null,
      externalRef: {
        provider: this.provider,
        itemId: String(number),
        itemNumber: number,
        repositoryOwner: this.provider === "github" ? "example" : null,
        repositoryName: this.provider === "github" ? "project" : null,
        webUrl:
          this.provider === "github"
            ? `https://github.com/example/project/issues/${number}`
            : null,
      },
    });
    this.items.push(item);
    return item;
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    if (!this.capabilities.listItems) {
      throw new Error("listWorkItems should not be called without capability");
    }
    const statuses = query.status
      ? new Set(Array.isArray(query.status) ? query.status : [query.status])
      : null;
    const labels = query.labels ?? [];
    const filtered = this.items.filter((item) => {
      if (statuses && !statuses.has(item.status)) {
        return false;
      }
      if (labels.some((label) => !item.labels?.includes(label))) {
        return false;
      }

      return true;
    });

    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    if (!this.capabilities.getItem) {
      throw new Error("getWorkItem should not be called without capability");
    }
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) =>
        candidate.id === id || candidate.externalRef?.itemId === id,
    );
    if (!item) {
      throw new Error(`Local work item not found: ${id}`);
    }

    return item;
  }

  async updateWorkItem(
    ref: WorkItemRef,
    patch: WorkItemPatch,
  ): Promise<WorkItem> {
    this.mutations.push("update");
    this.patches.push(patch);
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) =>
        candidate.id === id || candidate.externalRef?.itemId === id,
    );
    if (!item) {
      throw new Error(`Local work item not found: ${id}`);
    }
    const updated: WorkItem = {
      ...item,
      ...patch,
      updatedAt: "2026-05-18T09:00:00.000Z",
    };
    this.items[this.items.indexOf(item)] = updated;
    return updated;
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    this.mutations.push("comment");
    const id = ref.id ?? ref.externalRef?.itemId ?? "unknown";
    const comment: WorkComment = {
      id: `${this.provider}-comment-${this.comments.size + 1}`,
      body,
      author: "dev-nexus",
      createdAt: "2026-05-18T09:00:00.000Z",
      updatedAt: "2026-05-18T09:00:00.000Z",
      externalRef: {
        provider: this.provider,
        itemId: `${this.comments.size + 1}`,
      },
    };
    this.comments.set(id, [...(this.comments.get(id) ?? []), comment]);
    return comment;
  }
}

function workItem(
  id: string,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  return {
    id,
    title: `Item ${id}`,
    description: null,
    status: "ready",
    provider: "local",
    labels: [],
    assignees: [],
    milestone: null,
    createdAt: "2026-05-18T08:00:00.000Z",
    updatedAt: "2026-05-18T08:00:00.000Z",
    closedAt: null,
    webUrl: null,
    externalRef: {
      provider: "local",
      itemId: id,
    },
    ...overrides,
  };
}

function createGitHubMirrorProjectContext(
  projectRoot: string,
): ResolvedWorkItemProjectContext {
  return {
    ...createProjectContext(projectRoot),
    workTrackers: [
      {
        id: "primary",
        name: "Primary",
        enabled: true,
        roles: ["primary"],
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/primary-items.json",
        },
      },
      {
        id: "github",
        name: "GitHub",
        enabled: true,
        roles: ["mirror"],
        workTracking: {
          provider: "github",
          repository: {
            owner: "example",
            name: "project",
          },
        },
      },
    ],
  };
}

const defaultPolicy: WorkItemSyncPolicyConfig = {
  sourceTrackerId: "primary",
  targetTrackerId: "mirror",
  direction: "source_to_target",
  filters: {
    status: ["ready", "in_progress"],
  },
  fieldSet: ["title", "description", "status", "labels"],
  commentPolicy: {
    mode: "ignore",
  },
  statusMapping: {},
  conflictPolicy: {
    mode: "block",
  },
  writePolicy: {
    mode: "dry_run",
    creates: "plan",
    updates: "plan",
    credentials: "not_required",
  },
};

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("work item sync planner", () => {
  it("plans creates, updates, skips, stale links, conflicts, and unlinked targets without mutation", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider([
      workItem("local-1", {
        title: "Create mirror",
        description: "Source only",
        status: "ready",
        labels: ["sync"],
      }),
      workItem("local-2", {
        title: "Update mirror",
        description: "Fresh source",
        status: "in_progress",
        labels: ["sync"],
      }),
      workItem("local-3", {
        title: "Already mirrored",
        description: "Same content",
        status: "ready",
        labels: ["sync"],
      }),
      workItem("local-4", {
        title: "Conflicting source",
        description: "Source value",
        status: "ready",
        labels: ["sync"],
      }),
      workItem("local-5", {
        title: "Stale link",
        description: "Missing target",
        status: "ready",
        labels: ["sync"],
      }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider([
      workItem("mirror-2", {
        title: "Update mirror old",
        description: "Target value",
        status: "ready",
        labels: ["old"],
        updatedAt: "2026-05-18T08:05:00.000Z",
      }),
      workItem("mirror-3", {
        title: "Already mirrored",
        description: "Same content",
        status: "ready",
        labels: ["sync"],
        updatedAt: "2026-05-18T08:05:00.000Z",
      }),
      workItem("mirror-4", {
        title: "Target changed",
        description: "Target value",
        status: "ready",
        labels: ["sync"],
        updatedAt: "2026-05-18T08:30:00.000Z",
      }),
      workItem("mirror-orphan", {
        title: "Unlinked target",
        description: "Not tied to a source item",
        status: "ready",
      }),
    ]);
    const providers = new Map([
      ["primary", sourceProvider],
      ["mirror", targetProvider],
    ]);
    const providerFactory: WorkItemProviderFactory = (context) =>
      providers.get(context.trackerId ?? "") ?? sourceProvider;
    const resolveProject = createProjectResolver(project);
    const linkService = createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:10:00.000Z"),
    });
    await linkService.linkReference({
      projectRoot,
      logicalItemId: "local-2",
      trackerId: "mirror",
      itemId: "mirror-2",
      observedAt: "2026-05-18T08:10:00.000Z",
    });
    await linkService.linkReference({
      projectRoot,
      logicalItemId: "local-3",
      trackerId: "mirror",
      itemId: "mirror-3",
      observedAt: "2026-05-18T08:10:00.000Z",
    });
    await linkService.linkReference({
      projectRoot,
      logicalItemId: "local-4",
      trackerId: "mirror",
      itemId: "mirror-4",
      observedAt: "2026-05-18T08:10:00.000Z",
    });
    await linkService.linkReference({
      projectRoot,
      logicalItemId: "local-5",
      trackerId: "mirror",
      itemId: "mirror-missing",
      observedAt: "2026-05-18T08:10:00.000Z",
    });

    const plan = await createWorkItemSyncPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });

    expect(plan.dryRun).toBe(true);
    expect(plan.creates).toMatchObject([
      {
        source: { id: "local-1" },
        targetTrackerId: "mirror",
        targetDetection: "unlinked",
      },
    ]);
    expect(plan.updates).toMatchObject([
      {
        source: { id: "local-2" },
        target: { id: "mirror-2" },
        targetDetection: "linked",
      },
    ]);
    expect(plan.skips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "up_to_date",
          source: expect.objectContaining({ id: "local-3" }),
        }),
        expect.objectContaining({
          reason: "stale_link",
          source: expect.objectContaining({ id: "local-5" }),
          targetReference: expect.objectContaining({ itemId: "mirror-missing" }),
        }),
      ]),
    );
    expect(plan.conflicts).toMatchObject([
      {
        source: { id: "local-4" },
        target: { id: "mirror-4" },
      },
    ]);
    expect(plan.conflicts[0]?.fields.map((field) => field.field)).toEqual([
      "title",
      "description",
    ]);
    expect(plan.unlinkedTargets).toMatchObject([
      {
        id: "mirror-orphan",
        title: "Unlinked target",
      },
    ]);
    expect(plan.counts).toMatchObject({
      creates: 1,
      updates: 1,
      skips: 2,
      conflicts: 1,
      unlinkedTargets: 1,
      staleLinks: 1,
    });
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual([]);
  });

  it("plans reverse linked updates from GitHub sources back to local archive items", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createGitHubMirrorProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider(
      [
        workItem("github-50", {
          title: "Quick fix",
          status: "done",
          provider: "github",
          labels: ["dogfood", "github"],
          updatedAt: "2026-05-18T09:00:00.000Z",
          webUrl: "https://github.com/example/project/issues/50",
          externalRef: {
            provider: "github",
            itemId: "50",
            itemNumber: 50,
            repositoryOwner: "example",
            repositoryName: "project",
            webUrl: "https://github.com/example/project/issues/50",
          },
        }),
      ],
      {},
      "github",
    );
    const targetProvider = new MemoryWorkTrackerProvider([
      workItem("local-173", {
        title: "Quick fix",
        status: "ready",
        labels: ["dogfood"],
        updatedAt: "2026-05-18T08:00:00.000Z",
      }),
      workItem("local-orphan", {
        title: "Unlinked local item",
        status: "ready",
      }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["primary", targetProvider],
    ]);
    const resolveProject = createProjectResolver(project);
    await createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:30:00.000Z"),
    }).linkReference({
      projectRoot,
      logicalItemId: "local-173",
      trackerId: "github",
      itemId: "50",
      itemNumber: 50,
      observedAt: "2026-05-18T08:30:00.000Z",
    });

    const plan = await createWorkItemSyncPlan({
      projectRoot,
      componentId: "core",
      policy: {
        ...defaultPolicy,
        sourceTrackerId: "github",
        targetTrackerId: "primary",
        filters: {
          status: "done",
          labels: ["dogfood"],
        },
        fieldSet: ["status", "labels"],
        writePolicy: {
          ...defaultPolicy.writePolicy,
          creates: "skip",
        },
      },
      resolveProject,
      providerFactory: (context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider,
      now: fixedClock("2026-05-18T09:05:00.000Z"),
    });

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toMatchObject([
      {
        source: { id: "github-50" },
        target: { id: "local-173" },
        targetReference: {
          trackerId: "primary",
          itemId: "local-173",
        },
        fields: [
          {
            field: "status",
            sourceValue: "done",
            targetValue: "ready",
            plannedValue: "done",
          },
          {
            field: "labels",
            sourceValue: ["dogfood", "github"],
            targetValue: ["dogfood"],
            plannedValue: ["dogfood", "github"],
          },
        ],
      },
    ]);
    expect(plan.linkedTargets).toMatchObject([
      {
        source: { id: "github-50" },
        target: { id: "local-173" },
      },
    ]);
    expect(plan.unlinkedTargets).toMatchObject([
      {
        id: "local-orphan",
      },
    ]);
    expect(plan.counts).toMatchObject({
      creates: 0,
      updates: 1,
      linkedTargets: 1,
      unlinkedTargets: 1,
    });
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual([]);
  });

  it("turns provider capability gaps into planned skips instead of calling mutations", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider([
      workItem("local-1", {
        title: "Needs mirror",
        labels: ["sync"],
      }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider([], {
      createItem: false,
    });
    const providers = new Map([
      ["primary", sourceProvider],
      ["mirror", targetProvider],
    ]);

    const plan = await createWorkItemSyncPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject: createProjectResolver(project),
      providerFactory: (context) =>
        providers.get(context.trackerId ?? "") ?? sourceProvider,
    });

    expect(plan.creates).toEqual([]);
    expect(plan.skips).toMatchObject([
      {
        reason: "missing_provider_capability",
        source: { id: "local-1" },
      },
    ]);
    expect(plan.missingProviderCapabilities).toMatchObject([
      {
        trackerId: "mirror",
        capability: "create",
        operation: "plan create work items",
        effect: "skip",
      },
    ]);
    expect(targetProvider.mutations).toEqual([]);
  });

  it("reports missing credentials and explicit write-policy blocks", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createProjectContext(projectRoot);
    const provider = new MemoryWorkTrackerProvider([
      workItem("local-1", { title: "Blocked by policy" }),
    ]);

    const credentialsPlan = await createWorkItemSyncPlan({
      projectRoot,
      componentId: "core",
      policy: {
        ...defaultPolicy,
        writePolicy: {
          ...defaultPolicy.writePolicy,
          credentials: "missing",
          reason: "GITHUB_TOKEN is not configured",
        },
      },
      resolveProject: createProjectResolver(project),
      providerFactory: () => provider,
    });
    const blockedPlan = await createWorkItemSyncPlan({
      projectRoot,
      componentId: "core",
      policy: {
        ...defaultPolicy,
        writePolicy: {
          ...defaultPolicy.writePolicy,
          creates: "block",
          reason: "Mirror writes require approval",
        },
      },
      resolveProject: createProjectResolver(project),
      providerFactory: () => provider,
    });

    expect(credentialsPlan.missingCredentials).toMatchObject([
      {
        trackerId: "mirror",
        provider: "local",
        operation: "read target tracker",
        message: "GITHUB_TOKEN is not configured",
      },
    ]);
    expect(credentialsPlan.blockers).toMatchObject([
      {
        kind: "missing_credentials",
        trackerId: "mirror",
      },
    ]);
    expect(blockedPlan.creates).toEqual([]);
    expect(blockedPlan.policyBlocks).toMatchObject([
      {
        operation: "create",
        reason: "Mirror writes require approval",
      },
    ]);
    expect(blockedPlan.skips).toMatchObject([
      {
        reason: "policy_block",
        source: { id: "local-1" },
      },
    ]);
    expect(provider.mutations).toEqual([]);
  });

  it("executes idempotent local-to-github creates with linked targets and stable comments", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createGitHubMirrorProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider([
      workItem("local-1", {
        title: "Create GitHub mirror",
        description: "Source only",
        status: "ready",
        labels: ["sync"],
      }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider([], {}, "github");
    const providers = new Map([
      ["primary", sourceProvider],
      ["github", targetProvider],
    ]);
    const providerFactory: WorkItemProviderFactory = (context) =>
      providers.get(context.trackerId ?? "") ?? sourceProvider;
    const policy: WorkItemSyncPolicyConfig = {
      ...defaultPolicy,
      targetTrackerId: "github",
      commentPolicy: {
        mode: "plan",
      },
      writePolicy: {
        mode: "execute",
        creates: "plan",
        updates: "plan",
        credentials: "available",
      },
    };

    const firstRun = await executeWorkItemSync({
      projectRoot,
      componentId: "core",
      policy,
      resolveProject: createProjectResolver(project),
      providerFactory,
      now: fixedClock(
        "2026-05-18T09:00:00.000Z",
        "2026-05-18T09:00:01.000Z",
      ),
    });
    const secondRun = await executeWorkItemSync({
      projectRoot,
      componentId: "core",
      policy,
      resolveProject: createProjectResolver(project),
      providerFactory,
      now: fixedClock(
        "2026-05-18T09:05:00.000Z",
        "2026-05-18T09:05:01.000Z",
      ),
    });

    expect(firstRun.summary.counts).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      conflicted: 0,
      blocked: 0,
      comments: 1,
      links: 1,
    });
    expect(firstRun.providerLinks).toMatchObject([
      {
        action: "created",
        source: { id: "local-1" },
        target: {
          provider: "github",
          webUrl: "https://github.com/example/project/issues/1",
        },
        linkAction: "linked",
      },
    ]);
    expect(targetProvider.mutations).toEqual(["create", "comment"]);
    expect(targetProvider.comments.get("1")?.[0]?.body).toContain(
      "<!-- dev-nexus-sync:",
    );
    expect(secondRun.summary.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 1,
      comments: 0,
    });
    expect(targetProvider.mutations).toEqual(["create", "comment"]);
    expect(readWorkItemSyncRunStore(projectRoot).runs).toHaveLength(2);
  });

  it("executes linked updates using only configured fields", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createGitHubMirrorProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider([
      workItem("local-1", {
        title: "Source title must not sync",
        status: "in_progress",
        labels: ["sync"],
      }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider(
      [
        workItem("github-7", {
          title: "Target title remains",
          status: "ready",
          provider: "github",
          updatedAt: "2026-05-18T08:00:00.000Z",
          externalRef: {
            provider: "github",
            itemId: "7",
            itemNumber: 7,
            repositoryOwner: "example",
            repositoryName: "project",
          },
        }),
      ],
      {},
      "github",
    );
    const providers = new Map([
      ["primary", sourceProvider],
      ["github", targetProvider],
    ]);
    const resolveProject = createProjectResolver(project);
    await createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:05:00.000Z"),
    }).linkReference({
      projectRoot,
      logicalItemId: "local-1",
      trackerId: "github",
      itemId: "7",
      itemNumber: 7,
      observedAt: "2026-05-18T08:05:00.000Z",
    });

    const run = await executeWorkItemSync({
      projectRoot,
      componentId: "core",
      policy: {
        ...defaultPolicy,
        targetTrackerId: "github",
        fieldSet: ["status"],
        writePolicy: {
          mode: "execute",
          creates: "plan",
          updates: "plan",
          credentials: "available",
        },
      },
      resolveProject,
      providerFactory: (context) =>
        providers.get(context.trackerId ?? "") ?? sourceProvider,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });

    expect(run.summary.counts).toMatchObject({
      created: 0,
      updated: 1,
      skipped: 0,
      blocked: 0,
    });
    expect(targetProvider.patches).toEqual([{ status: "in_progress" }]);
    expect(targetProvider.mutations).toEqual(["update"]);
    expect(targetProvider.items[0]).toMatchObject({
      title: "Target title remains",
      status: "in_progress",
    });
  });

  it("blocks execution without explicit execute policy and available external credentials", async () => {
    const projectRoot = makeTempDir("dev-nexus-sync-");
    const project = createGitHubMirrorProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider([
      workItem("local-1", {
        title: "Needs approval",
        labels: ["sync"],
      }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider([], {}, "github");
    const providers = new Map([
      ["primary", sourceProvider],
      ["github", targetProvider],
    ]);

    const run = await executeWorkItemSync({
      projectRoot,
      componentId: "core",
      policy: {
        ...defaultPolicy,
        targetTrackerId: "github",
        writePolicy: {
          mode: "dry_run",
          creates: "plan",
          updates: "plan",
          credentials: "not_required",
        },
      },
      resolveProject: createProjectResolver(project),
      providerFactory: (context) =>
        providers.get(context.trackerId ?? "") ?? sourceProvider,
    });

    expect(run.status).toBe("blocked");
    expect(run.summary.counts).toMatchObject({
      created: 0,
      updated: 0,
      blocked: 2,
    });
    expect(run.blockers.map((blocker) => blocker.operation)).toEqual([
      "write_policy",
      "credentials",
    ]);
    expect(targetProvider.mutations).toEqual([]);
  });
});
