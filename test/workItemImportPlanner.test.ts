import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkItemImportPlan,
  executeWorkItemImport,
  type WorkItemImportPolicyConfig,
} from "../src/workItemImportPlanner.js";
import {
  createWorkItemTrackerLinkService,
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
} from "../src/workItemTrackerLinks.js";
import type {
  ResolvedWorkItemProjectContext,
  WorkItemProviderFactory,
} from "../src/workItemService.js";
import {
  resolveLocalWorkTrackingStorePath,
} from "../src/workTrackingLocalProvider.js";
import type { NexusAuthorityConfig } from "../src/nexusAuthority.js";
import type {
  CreateWorkItemInput,
  TrackerCapabilities,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkTrackerProvider,
} from "../src/workTrackingTypes.js";

const tempDirs: string[] = [];

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

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

class MemoryWorkTrackerProvider implements WorkTrackerProvider {
  readonly capabilities: TrackerCapabilities;
  readonly mutations: string[] = [];
  readonly patches: WorkItemPatch[] = [];
  private nextNumber = 1;

  constructor(
    readonly provider: string,
    private readonly items: WorkItem[],
    capabilities: Partial<TrackerCapabilities> = {},
    private readonly listError?: Error,
  ) {
    this.capabilities = { ...fullCapabilities, ...capabilities };
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    this.mutations.push("create");
    const number = this.nextNumber;
    this.nextNumber += 1;
    const id = `local-${number}`;
    const item = workItem(id, {
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "todo",
      labels: input.labels ?? [],
      assignees: input.assignees ?? [],
      milestone: input.milestone ?? null,
      updatedAt: "2026-05-18T09:00:00.000Z",
      externalRef: {
        provider: "local",
        itemId: id,
        itemNumber: number,
      },
    });
    this.items.push(item);
    return item;
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    if (this.listError) {
      throw this.listError;
    }
    const statuses = query.status
      ? new Set(Array.isArray(query.status) ? query.status : [query.status])
      : null;
    const labels = query.labels ?? [];
    const assignees = query.assignees ?? [];
    const search = query.search?.toLowerCase();
    const filtered = this.items.filter((item) => {
      if (statuses && !statuses.has(item.status)) {
        return false;
      }
      if (labels.some((label) => !item.labels?.includes(label))) {
        return false;
      }
      if (assignees.some((assignee) => !item.assignees?.includes(assignee))) {
        return false;
      }
      if (
        search &&
        ![item.id, item.title, item.description ?? ""].some((value) =>
          value.toLowerCase().includes(search),
        )
      ) {
        return false;
      }

      return true;
    });
    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) => candidate.id === id || candidate.externalRef?.itemId === id,
    );
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    return item;
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    this.mutations.push("update");
    this.patches.push(patch);
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) => candidate.id === id || candidate.externalRef?.itemId === id,
    );
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }
    const updated = {
      ...item,
      ...patch,
      updatedAt: "2026-05-18T09:00:00.000Z",
    };
    this.items[this.items.indexOf(item)] = updated;
    return updated;
  }

  async addComment(_ref: WorkItemRef, _body: string): Promise<WorkComment> {
    this.mutations.push("comment");
    throw new Error("addComment should not be called by import planning");
  }
}

function workItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
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

function githubIssue(number: number, overrides: Partial<WorkItem> = {}): WorkItem {
  return workItem(`github-${number}`, {
    provider: "github",
    title: `GitHub issue ${number}`,
    description: `Issue ${number} body`,
    status: "ready",
    labels: ["import"],
    webUrl: `https://github.com/example/project/issues/${number}`,
    externalRef: {
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "project",
      itemId: String(number),
      itemNumber: number,
      nodeId: `I_node_${number}`,
      webUrl: `https://github.com/example/project/issues/${number}`,
    },
    ...overrides,
  });
}

function createProjectContext(
  projectRoot: string,
): ResolvedWorkItemProjectContext {
  return {
    homePath: makeTempDir("dev-nexus-home-"),
    projectRoot,
    projectId: "import-project",
    projectName: "Import Project",
    componentId: "core",
    componentName: "Core",
    sourceRoot: path.join(projectRoot, "source"),
    defaultTrackerId: "local",
    workTracking: {
      provider: "local",
      storePath: ".dev-nexus/local-items.json",
    },
    workTrackers: [
      {
        id: "github",
        name: "GitHub",
        enabled: true,
        roles: ["source"],
        workTracking: {
          provider: "github",
          repository: {
            owner: "example",
            name: "project",
          },
        },
      },
      {
        id: "local",
        name: "Local",
        enabled: true,
        roles: ["primary"],
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/local-items.json",
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

const defaultPolicy: WorkItemImportPolicyConfig = {
  sourceTrackerId: "github",
  targetTrackerId: "local",
  direction: "external_to_local",
  filters: {
    status: ["ready", "in_progress"],
    labels: ["import"],
  },
  fieldSet: ["title", "description", "status", "labels"],
  statusMapping: {
    ready: "todo",
  },
  conflictPolicy: {
    mode: "block",
  },
  writePolicy: {
    mode: "dry_run",
    creates: "plan",
    updates: "plan",
    links: "plan",
    credentials: "not_required",
  },
  fingerprints: ["external_ref", "web_url"],
};

const importAuthority: NexusAuthorityConfig = {
  actors: [
    {
      id: "import-bot",
      kind: "machine_user",
      provider: "github",
      providerIdentity: "import-bot",
      displayName: "Import Bot",
    },
  ],
  roles: [
    {
      id: "importer",
      actions: ["provider.state.read", "work_item.update"],
    },
  ],
  roleBindings: [
    {
      actorId: "import-bot",
      roles: ["importer"],
      scope: {
        project: "import-project",
        component: "core",
      },
    },
  ],
};

function allowedImportAuthority() {
  return {
    authority: importAuthority,
    actor: {
      id: "import-bot",
      kind: "machine_user" as const,
      provider: "github",
      providerIdentity: "import-bot",
    },
    authProfile: {
      id: "bot-github",
      actorId: "import-bot",
      kind: "automation" as const,
      provider: "github",
      account: "import-bot",
    },
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("work item import planner", () => {
  it("plans inbound GitHub-to-local creates, updates, conflicts, duplicates, stale links, mappings, and files without mutation", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(7, { title: "Linked update", description: "Fresh body" }),
      githubIssue(8, { title: "Fingerprint update", description: "Matched body" }),
      githubIssue(9, { title: "Duplicate fingerprint" }),
      githubIssue(10, { title: "Stale link" }),
      githubIssue(11, { title: "Create local" }),
      githubIssue(12, { title: "Already imported", description: "Same" }),
      githubIssue(13, { title: "Conflicting linked", description: "Source value" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", [
      workItem("local-7", {
        title: "Old linked update",
        description: "Old body",
        status: "todo",
        labels: ["old"],
        updatedAt: "2026-05-18T08:00:00.000Z",
      }),
      workItem("local-8", {
        title: "Old fingerprint update",
        description: "Imported from https://github.com/example/project/issues/8",
        status: "todo",
        labels: ["old"],
      }),
      workItem("local-9a", {
        title: "Duplicate A",
        labels: ["github:example/project#9"],
      }),
      workItem("local-9b", {
        title: "Duplicate B",
        description: "github:example/project#9",
      }),
      workItem("local-12", {
        title: "Already imported",
        description: "Same",
        status: "todo",
        labels: ["import"],
      }),
      workItem("local-13", {
        title: "Local conflicting",
        description: "Target value",
        status: "todo",
        labels: ["import"],
        updatedAt: "2026-05-18T08:30:00.000Z",
      }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);
    const providerFactory: WorkItemProviderFactory = (context) =>
      providers.get(context.trackerId ?? "") ?? targetProvider;
    const resolveProject = createProjectResolver(project);
    const linkService = createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:10:00.000Z"),
    });
    for (const [logicalItemId, itemId] of [
      ["local-7", "7"],
      ["local-missing", "10"],
      ["local-12", "12"],
      ["local-13", "13"],
    ] as const) {
      await linkService.linkReference({
        projectRoot,
        logicalItemId,
        trackerId: "github",
        itemId,
        itemNumber: Number(itemId),
        nodeId: `I_node_${itemId}`,
        webUrl: `https://github.com/example/project/issues/${itemId}`,
      });
    }

    const plan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });

    expect(plan.dryRun).toBe(true);
    expect(plan.providerFilters).toEqual({
      sourceTrackerId: "github",
      query: defaultPolicy.filters,
    });
    expect(plan.fieldMapping).toEqual({
      fields: ["title", "description", "status", "labels"],
      statusMapping: { ready: "todo" },
    });
    expect(plan.creates).toMatchObject([
      {
        source: { id: "github-11" },
        targetDetection: "unlinked",
        plannedLink: {
          trackerId: "github",
          reference: {
            itemId: "11",
            itemNumber: 11,
          },
        },
      },
    ]);
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ id: "github-7" }),
          target: expect.objectContaining({ id: "local-7" }),
          targetDetection: "linked",
        }),
        expect.objectContaining({
          source: expect.objectContaining({ id: "github-8" }),
          target: expect.objectContaining({ id: "local-8" }),
          targetDetection: "fingerprint",
          fingerprints: expect.arrayContaining([
            "https://github.com/example/project/issues/8",
            "github:example/project#8",
          ]),
        }),
      ]),
    );
    expect(plan.skips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "stale_link",
          source: expect.objectContaining({ id: "github-10" }),
        }),
        expect.objectContaining({
          reason: "up_to_date",
          source: expect.objectContaining({ id: "github-12" }),
        }),
      ]),
    );
    expect(plan.conflicts).toMatchObject([
      {
        source: { id: "github-13" },
        target: { id: "local-13" },
      },
    ]);
    expect(plan.ambiguousDuplicates).toMatchObject([
      {
        source: { id: "github-9" },
        candidates: [{ id: "local-9a" }, { id: "local-9b" }],
      },
    ]);
    expect(plan.staleLinks).toMatchObject([
      {
        source: { id: "github-10" },
        targetReference: { itemId: "10" },
      },
    ]);
    expect(plan.wouldChangeFiles).toEqual([
      resolveLocalWorkTrackingStorePath(projectRoot, project.workTracking),
      defaultWorkItemTrackerLinkStorePath(projectRoot),
    ]);
    expect(plan.counts).toMatchObject({
      sourceItems: 7,
      targetItems: 6,
      creates: 1,
      updates: 2,
      skips: 2,
      conflicts: 1,
      ambiguousDuplicates: 1,
      staleLinks: 1,
      fingerprintMatches: 1,
    });
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual([]);
  });

  it("keeps linked and fingerprint-detected plans stable on repeated runs", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(7, { title: "Linked update" }),
      githubIssue(8, { title: "Fingerprint update" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", [
      workItem("local-7", { title: "Old linked update" }),
      workItem("local-8", {
        title: "Old fingerprint update",
        description: "https://github.com/example/project/issues/8",
      }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);
    const resolveProject = createProjectResolver(project);
    await createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:10:00.000Z"),
    }).linkReference({
      projectRoot,
      logicalItemId: "local-7",
      trackerId: "github",
      itemId: "7",
      itemNumber: 7,
    });

    const input = {
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject,
      providerFactory: ((context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory,
    };
    const first = await createWorkItemImportPlan({
      ...input,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });
    const second = await createWorkItemImportPlan({
      ...input,
      now: fixedClock("2026-05-18T09:05:00.000Z"),
    });

    expect(first.updates.map((update) => [update.source.id, update.target.id])).toEqual([
      ["github-7", "local-7"],
      ["github-8", "local-8"],
    ]);
    expect(second.updates.map((update) => [update.source.id, update.target.id])).toEqual([
      ["github-7", "local-7"],
      ["github-8", "local-8"],
    ]);
  });

  it("does not fingerprint-match repo-scoped external refs by substring", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(1, { title: "Create issue one" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", [
      workItem("local-10", {
        title: "Imported issue ten",
        description: "Imported from github:example/project#10",
      }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);

    const plan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject: createProjectResolver(project),
      providerFactory: ((context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });

    expect(plan.fingerprintMatches).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toMatchObject([
      {
        source: { id: "github-1" },
        targetDetection: "unlinked",
      },
    ]);
  });

  it("does not treat repo-scoped issue ids as linked when repository context differs", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(42, { title: "Repo scoped source" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", [
      workItem("local-42", { title: "Wrong repo linked target" }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);
    const resolveProject = createProjectResolver(project);
    await createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:10:00.000Z"),
    }).linkReference({
      projectRoot,
      logicalItemId: "local-42",
      trackerId: "github",
      itemId: "42",
      itemNumber: 42,
      webUrl: "https://github.com/example/other-project/issues/42",
    });
    const storePath = defaultWorkItemTrackerLinkStorePath(projectRoot);
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    store.records[0].references[0].repositoryName = "other-project";
    fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

    const plan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject,
      providerFactory: ((context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });

    expect(plan.updates).toEqual([]);
    expect(plan.staleLinks).toEqual([]);
    expect(plan.creates).toMatchObject([
      {
        source: { id: "github-42" },
        targetDetection: "unlinked",
      },
    ]);
  });

  it("reports source credential and provider-path blockers without reading local files", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider(
      "github",
      [],
      {},
      new Error("GitHub request failed: 401. No GitHub token or git credential was available"),
    );
    const targetProvider = new MemoryWorkTrackerProvider("local", []);

    const credentialsPlan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject: createProjectResolver(project),
      providerFactory: (context) =>
        context.trackerId === "github" ? sourceProvider : targetProvider,
    });
    const unsupportedPlan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: defaultPolicy,
      resolveProject: createProjectResolver(project),
      providerFactory: (context) =>
        context.trackerId === "github"
          ? new MemoryWorkTrackerProvider("gitlab", [])
          : targetProvider,
    });

    expect(credentialsPlan.missingCredentials).toMatchObject([
      {
        trackerId: "github",
        provider: "github",
        operation: "read source tracker",
      },
    ]);
    expect(credentialsPlan.creates).toEqual([]);
    expect(credentialsPlan.updates).toEqual([]);
    expect(credentialsPlan.wouldChangeFiles).toEqual([]);
    expect(unsupportedPlan.blockers).toMatchObject([
      {
        kind: "unsupported_provider_path",
        trackerId: "github",
        provider: "gitlab",
      },
    ]);
  });

  it("executes allowed inbound imports idempotently without provider writes", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(1, { title: "Create local", description: "New body" }),
      githubIssue(2, { title: "Update local", description: "Fresh body" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", [
      workItem("local-2", {
        title: "Old local",
        description: "Old body",
        status: "todo",
        labels: ["old"],
      }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);
    const resolveProject = createProjectResolver(project);
    await createWorkItemTrackerLinkService({
      resolveProject,
      now: fixedClock("2026-05-18T08:10:00.000Z"),
    }).linkReference({
      projectRoot,
      logicalItemId: "local-2",
      trackerId: "github",
      itemId: "2",
      itemNumber: 2,
      nodeId: "I_node_2",
    });
    const policy: WorkItemImportPolicyConfig = {
      ...defaultPolicy,
      filters: {},
      writePolicy: {
        mode: "execute",
        creates: "plan",
        updates: "plan",
        links: "plan",
        credentials: "available",
      },
    };
    const input = {
      projectRoot,
      componentId: "core",
      policy,
      authority: allowedImportAuthority(),
      resolveProject,
      providerFactory: ((context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory,
    };

    const firstRun = await executeWorkItemImport({
      ...input,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });
    const secondRun = await executeWorkItemImport({
      ...input,
      now: fixedClock("2026-05-18T09:05:00.000Z"),
    });

    expect(firstRun.blockers).toEqual([]);
    expect(firstRun.status).toBe("completed");
    expect(firstRun.summary.counts).toMatchObject({
      created: 1,
      updated: 1,
      blocked: 0,
      links: 2,
    });
    expect(secondRun.status).toBe("completed");
    expect(secondRun.summary.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 2,
      links: 0,
    });
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual(["create", "update"]);
    expect(targetProvider.items.map((item) => item.title).sort()).toEqual([
      "Create local",
      "Update local",
    ]);
    expect(
      loadWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot)).records,
    ).toHaveLength(2);
  });

  it("blocks execution without execute policy, available credentials, and write authority", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(1, { title: "Needs approval" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", []);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);

    const { direction: _direction, ...noDirectionPolicy } = defaultPolicy;
    const run = await executeWorkItemImport({
      projectRoot,
      componentId: "core",
      policy: noDirectionPolicy,
      resolveProject: createProjectResolver(project),
      providerFactory: ((context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory,
    });

    expect(run.status).toBe("blocked");
    expect(run.blockers.map((blocker) => blocker.operation)).toEqual(
      expect.arrayContaining([
        "write_policy",
        "direction",
        "credentials",
        "authority.work_item_update",
      ]),
    );
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual([]);
  });

  it("blocks execution when write dispositions are configured to block", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(1, { title: "Blocked create" }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", []);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);

    const run = await executeWorkItemImport({
      projectRoot,
      componentId: "core",
      policy: {
        ...defaultPolicy,
        filters: {},
        writePolicy: {
          mode: "execute",
          creates: "block",
          updates: "plan",
          links: "plan",
          credentials: "available",
        },
      },
      authority: allowedImportAuthority(),
      resolveProject: createProjectResolver(project),
      providerFactory: ((context) =>
        providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory,
    });

    expect(run.status).toBe("blocked");
    expect(run.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "create",
          message: "Write policy is configured to block create plans.",
        }),
      ]),
    );
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual([]);
  });

  it("refuses stale, conflicting, and ambiguous execution plans before mutation", async () => {
    const projectRoot = makeTempDir("dev-nexus-import-");
    const project = createProjectContext(projectRoot);
    const sourceItems = [
      githubIssue(1, { title: "Create one" }),
    ];
    const sourceProvider = new MemoryWorkTrackerProvider("github", sourceItems);
    const targetProvider = new MemoryWorkTrackerProvider("local", [
      workItem("local-a", { title: "github:example/project#2" }),
      workItem("local-b", { description: "github:example/project#2" }),
    ]);
    const providers = new Map([
      ["github", sourceProvider],
      ["local", targetProvider],
    ]);
    const resolveProject = createProjectResolver(project);
    const providerFactory = ((context) =>
      providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory;
    const executePolicy: WorkItemImportPolicyConfig = {
      ...defaultPolicy,
      filters: {},
      writePolicy: {
        mode: "execute",
        creates: "plan",
        updates: "plan",
        links: "plan",
        credentials: "available",
      },
    };
    const plan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: {
        ...executePolicy,
        writePolicy: { ...executePolicy.writePolicy!, mode: "dry_run" },
      },
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-18T09:00:00.000Z"),
    });
    sourceItems.push(githubIssue(2, { title: "Ambiguous two" }));

    const run = await executeWorkItemImport({
      projectRoot,
      componentId: "core",
      policy: executePolicy,
      plan,
      authority: allowedImportAuthority(),
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-18T09:05:00.000Z"),
    });

    expect(run.status).toBe("blocked");
    expect(run.blockers.map((blocker) => blocker.operation)).toEqual(
      expect.arrayContaining(["stale_plan", "ambiguous_duplicate"]),
    );
    expect(targetProvider.mutations).toEqual([]);
  });
});
