import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNexusAutomationWorkItemQuery } from "./nexusAutomation.js";
import { defaultNexusAutomationConfig } from "./nexusAutomationConfig.js";
import type { NexusAuthorityConfig } from "./nexusAuthority.js";
import {
  listNexusEligibleWorkByComponent,
  type NexusEligibleWorkProviderFactory,
} from "./nexusEligibleWork.js";
import { resolveProjectComponents } from "./nexusProjectLifecycle.js";
import { getNexusWorkItemDiscoveryStatus } from "./nexusWorkItemDiscoveryStatus.js";
import {
  createWorkItemImportPlan,
  executeWorkItemImport,
  type WorkItemImportPolicyConfig,
} from "./workItemImportPlanner.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  loadWorkItemTrackerLinkStore,
} from "./workItemTrackerLinks.js";
import type {
  ResolvedWorkItemProjectContext,
  WorkItemProviderFactory,
} from "./workItemService.js";
import {
  saveProjectConfig,
  type CreateWorkItemInput,
  type NexusProjectConfig,
  type TrackerCapabilities,
  type WorkComment,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkItemRef,
  type WorkTrackerProvider,
} from "./index.js";

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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("fake GitHub inbox import smoke", () => {
  it("discovers, plans, imports, and reruns a fake GitHub issue without live provider mutation", async () => {
    const projectRoot = makeTempDir("dev-nexus-fake-github-inbox-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);

    const sourceProvider = new MemoryWorkTrackerProvider("github", [
      githubIssue(41, {
        title: "Import fake GitHub inbox issue",
        description: "Create a canonical local work item from a fake GitHub issue.",
        labels: ["automation"],
      }),
    ]);
    const targetProvider = new MemoryWorkTrackerProvider("local", []);
    const providers = new Map([
      ["github-inbox", sourceProvider],
      ["local", targetProvider],
    ]);
    const discoveryCredentialResolver = ({ provider }: { provider: string }) =>
      provider === "github"
        ? {
            status: "available" as const,
            required: true,
            message: "fake GitHub credentials are available",
          }
        : {
            status: "not_required" as const,
            required: false,
            message: "local tracker files do not need credentials",
          };

    const defaultCredentialStatus = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      env: {},
    });
    const discoveryStatus = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      credentialResolver: discoveryCredentialResolver,
    });

    expect(defaultCredentialStatus.warnings).toEqual([
      expect.stringContaining("github-inbox skipped"),
    ]);
    expect(discoveryStatus).toMatchObject({
      warnings: [],
      blockers: [],
      components: [
        {
          componentId: "core",
          discoveryTrackerIds: ["local", "github-inbox"],
          configuredTrackers: [
            {
              id: "local",
              readable: { status: "readable" },
            },
            {
              id: "github-inbox",
              provider: "github",
              readable: { status: "readable" },
            },
          ],
        },
      ],
    });

    const eligibleWork = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: (({ tracker }) =>
        providers.get(tracker.id) ?? targetProvider) as NexusEligibleWorkProviderFactory,
      credentialResolver: discoveryCredentialResolver,
    });

    expect(eligibleWork.eligibleWorkItems).toEqual([]);
    expect(eligibleWork.importCandidateWorkItems).toMatchObject([
      {
        id: "github-41",
        title: "Import fake GitHub inbox issue",
        sourceTrackerRef: {
          trackerId: "github-inbox",
          provider: "github",
        },
        canonicalTrackerRef: null,
        selectable: false,
        importOnly: true,
        warnings: ["External work item must be imported before local assignment."],
      },
    ]);

    const resolveProject = createProjectResolver(
      resolvedProjectContext(projectRoot, config),
    );
    const providerFactory = ((context) =>
      providers.get(context.trackerId ?? "") ?? targetProvider) as WorkItemProviderFactory;
    const policy = importPolicy();
    const plan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy,
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-19T09:00:00.000Z"),
    });
    const wrongFilterPlan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: {
        ...policy,
        filters: { status: ["ready"], labels: ["not-importable"] },
      },
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-19T09:01:00.000Z"),
    });
    const missingCredentialsPlan = await createWorkItemImportPlan({
      projectRoot,
      componentId: "core",
      policy: {
        ...policy,
        writePolicy: {
          ...policy.writePolicy!,
          credentials: "missing",
          reason: "fake GitHub token withheld",
        },
      },
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-19T09:02:00.000Z"),
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.counts).toMatchObject({
      sourceItems: 1,
      targetItems: 0,
      creates: 1,
      updates: 0,
    });
    expect(plan.creates[0]).toMatchObject({
      source: {
        id: "github-41",
        provider: "github",
      },
      targetTrackerId: "local",
      plannedLink: {
        logicalItemId: "local-from-github-41",
        trackerId: "github-inbox",
        reference: {
          provider: "github",
          repositoryOwner: "example",
          repositoryName: "project",
          itemId: "41",
          itemNumber: 41,
        },
      },
    });
    expect(wrongFilterPlan.counts).toMatchObject({
      sourceItems: 0,
      creates: 0,
      updates: 0,
    });
    expect(missingCredentialsPlan.missingCredentials).toMatchObject([
      {
        trackerId: "github-inbox",
        provider: "github",
        operation: "read source tracker",
      },
    ]);

    const executePolicy: WorkItemImportPolicyConfig = {
      ...policy,
      writePolicy: {
        mode: "execute",
        creates: "plan",
        updates: "plan",
        links: "plan",
        credentials: "available",
      },
    };
    const firstRun = await executeWorkItemImport({
      projectRoot,
      componentId: "core",
      policy: executePolicy,
      authority: allowedImportAuthority(),
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-19T09:03:00.000Z"),
    });
    const secondRun = await executeWorkItemImport({
      projectRoot,
      componentId: "core",
      policy: executePolicy,
      authority: allowedImportAuthority(),
      resolveProject,
      providerFactory,
      now: fixedClock("2026-05-19T09:04:00.000Z"),
    });

    expect(firstRun.status).toBe("completed");
    expect(firstRun.summary.counts).toMatchObject({
      created: 1,
      updated: 0,
      blocked: 0,
      links: 1,
    });
    expect(secondRun.status).toBe("completed");
    expect(secondRun.summary.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 1,
      links: 0,
    });
    expect(sourceProvider.mutations).toEqual([]);
    expect(targetProvider.mutations).toEqual(["create"]);
    expect(targetProvider.items).toMatchObject([
      {
        id: "local-1",
        title: "Import fake GitHub inbox issue",
        description: "Create a canonical local work item from a fake GitHub issue.",
        status: "todo",
        labels: ["automation"],
      },
    ]);
    expect(
      loadWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot)).records,
    ).toMatchObject([
      {
        logicalItemId: "local-1",
        references: [
          {
            trackerId: "github-inbox",
            provider: "github",
            itemId: "41",
            itemNumber: 41,
          },
        ],
      },
    ]);
  });
});

function automationConfig() {
  return {
    ...defaultNexusAutomationConfig,
    selector: {
      ...defaultNexusAutomationConfig.selector,
      statuses: ["ready"],
      labels: ["automation"],
      limit: 10,
    },
  };
}

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "fake-github-inbox-demo",
    name: "Fake GitHub Inbox Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: null,
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: null,
        defaultBranch: "main",
        sourceRoot: "source",
        defaultWorkTrackerId: "local",
        workTrackers: [
          {
            id: "local",
            name: "Local",
            enabled: true,
            roles: ["primary"],
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items-local.json",
            },
          },
          {
            id: "github-inbox",
            name: "GitHub Inbox",
            enabled: true,
            roles: ["eligible_source", "external_inbox"],
            workTracking: {
              provider: "github",
              repository: {
                owner: "example",
                name: "project",
              },
            },
          },
        ],
        trackerDiscovery: {
          scannedRoles: ["primary", "eligible_source"],
          directExternalSelection: "disabled",
          importRequiredFirst: true,
          providerFilters: ["local", "github"],
          queryLimit: 10,
          conflictWinner: "default_tracker",
          missingCredentialBehavior: "skip",
        },
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    automation: automationConfig(),
  };
}

function resolvedProjectContext(
  projectRoot: string,
  config: NexusProjectConfig,
): ResolvedWorkItemProjectContext {
  const component = config.components[0]!;
  const localTracker = component.workTrackers!.find((tracker) => tracker.id === "local")!;
  return {
    homePath: makeTempDir("dev-nexus-home-"),
    projectRoot,
    projectId: config.id,
    projectName: config.name,
    componentId: component.id,
    componentName: component.name,
    sourceRoot: path.join(projectRoot, component.sourceRoot ?? "source"),
    defaultTrackerId: component.defaultWorkTrackerId ?? null,
    workTracking: localTracker.workTracking,
    workTrackers: component.workTrackers!.map((tracker) => ({
      id: tracker.id,
      name: tracker.name,
      enabled: tracker.enabled,
      roles: tracker.roles,
      workTracking: tracker.workTracking,
    })),
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

function importPolicy(): WorkItemImportPolicyConfig {
  return {
    sourceTrackerId: "github-inbox",
    targetTrackerId: "local",
    direction: "external_to_local",
    filters: {
      status: ["ready"],
      labels: ["automation"],
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
}

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
        project: "fake-github-inbox-demo",
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

function githubIssue(number: number, overrides: Partial<WorkItem> = {}): WorkItem {
  return workItem(`github-${number}`, {
    provider: "github",
    title: `GitHub issue ${number}`,
    description: `Issue ${number} body`,
    status: "ready",
    labels: ["automation"],
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

function workItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  const provider = overrides.provider ?? "local";
  return {
    id,
    title: `Item ${id}`,
    description: null,
    status: "ready",
    provider,
    labels: [],
    assignees: [],
    milestone: null,
    createdAt: "2026-05-19T08:00:00.000Z",
    updatedAt: "2026-05-19T08:00:00.000Z",
    closedAt: null,
    webUrl: null,
    externalRef: {
      provider,
      itemId: id,
    },
    ...overrides,
  };
}

class MemoryWorkTrackerProvider implements WorkTrackerProvider {
  readonly capabilities = fullCapabilities;
  readonly mutations: string[] = [];
  readonly queries: WorkItemQuery[] = [];
  private nextNumber = 1;

  constructor(
    readonly provider: string,
    readonly items: WorkItem[],
  ) {}

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
      updatedAt: "2026-05-19T09:03:00.000Z",
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
    this.queries.push(query);
    const filtered = this.items.filter((item) => matchesQuery(item, query));
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
    const item = await this.getWorkItem(ref);
    const updated = {
      ...item,
      ...patch,
      updatedAt: "2026-05-19T09:03:00.000Z",
    };
    this.items[this.items.indexOf(item)] = updated;
    return updated;
  }

  async addComment(_ref: WorkItemRef, _body: string): Promise<WorkComment> {
    this.mutations.push("comment");
    throw new Error("addComment should not be called by import smoke tests");
  }
}

function matchesQuery(item: WorkItem, query: WorkItemQuery): boolean {
  const statuses = Array.isArray(query.status)
    ? query.status
    : query.status
      ? [query.status]
      : [];
  if (statuses.length > 0 && !statuses.includes(item.status)) {
    return false;
  }
  if (query.labels?.some((label) => !item.labels?.includes(label))) {
    return false;
  }
  if (query.assignees?.some((assignee) => !item.assignees?.includes(assignee))) {
    return false;
  }
  const search = query.search?.toLowerCase();
  if (
    search &&
    ![item.id, item.title, item.description ?? ""].some((value) =>
      value.toLowerCase().includes(search),
    )
  ) {
    return false;
  }

  return true;
}
