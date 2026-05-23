import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNexusAutomationWorkItemQuery } from "../src/nexusAutomation.js";
import { defaultNexusAutomationConfig } from "../src/nexusAutomationConfig.js";
import { listNexusEligibleWorkByComponent } from "../src/nexusEligibleWork.js";
import { resolveProjectComponents } from "../src/nexusProjectLifecycle.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  saveProjectConfig,
  saveWorkItemTrackerLinkStore,
  type NexusProjectConfig,
  type WorkItem,
  type WorkItemQuery,
  type WorkItemRef,
  type WorkTrackerProvider,
} from "../src/index.js";
import {
  resolveNexusVersionScope,
  type NexusVersionScopeProviderFactory,
} from "../src/nexusVersionScopeResolver.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("version scope resolver", () => {
  it("resolves explicit refs, labels, milestones, and tracker queries", async () => {
    const projectRoot = makeTempDir("dev-nexus-version-scope-");
    const config = projectConfig({
      versionPlanning: {
        versions: [
          {
            id: "0.2.0",
            objective: "Ship version planning.",
            owningComponents: ["core"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                status: "committed",
                componentId: "core",
                workItemId: "local-1",
              },
              {
                kind: "label",
                status: "candidate",
                componentId: "core",
                label: "release-scope",
              },
              {
                kind: "milestone",
                status: "stretch",
                componentId: "core",
                milestone: "0.2.0",
              },
              {
                kind: "tracker_query",
                status: "deferred",
                componentId: "core",
                trackerId: "inbox",
                query: {
                  provider: "github",
                  text: "release planning",
                  statuses: ["ready"],
                  labels: ["github-scope"],
                  milestones: ["0.2.0"],
                  assignees: ["bot"],
                },
              },
            ],
          },
        ],
      },
    });
    const providers = providerFactory({
      local: [
        workItem("local-1", "Explicit", { status: "done" }),
        workItem("local-2", "Labeled", { labels: ["release-scope"] }),
        workItem("local-3", "Milestoned", { milestone: "0.2.0" }),
      ],
      inbox: [
        workItem("github-42", "GitHub scoped", {
          provider: "github",
          description: "release planning follow-up",
          labels: ["github-scope"],
          assignees: ["bot"],
          milestone: "0.2.0",
          externalRef: githubRef("42", 42),
        }),
      ],
    });

    const result = await resolveNexusVersionScope({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      version: config.versionPlanning!.versions[0]!,
      providerFactory: providers.factory,
    });

    expect(providers.operations).toMatchObject([
      {
        trackerId: "local",
        method: "get",
        ref: {
          id: "local-1",
        },
      },
      {
        trackerId: "local",
        method: "list",
        query: {
          labels: ["release-scope"],
        },
      },
      {
        trackerId: "local",
        method: "list",
        query: {},
      },
      {
        trackerId: "inbox",
        method: "list",
        query: {
          status: ["ready"],
          labels: ["github-scope"],
          assignees: ["bot"],
          search: "release planning",
        },
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.items.map(scopeSummary)).toEqual([
      {
        id: "local-1",
        componentId: "core",
        scopeStatus: "committed",
        scopeStatuses: ["committed"],
        workStatus: "done",
        sourceTrackerId: "local",
        canonicalTrackerId: "local",
        logicalItemId: "local-1",
        dedupeReason: null,
      },
      {
        id: "local-2",
        componentId: "core",
        scopeStatus: "candidate",
        scopeStatuses: ["candidate"],
        workStatus: "ready",
        sourceTrackerId: "local",
        canonicalTrackerId: "local",
        logicalItemId: "local-2",
        dedupeReason: null,
      },
      {
        id: "local-3",
        componentId: "core",
        scopeStatus: "stretch",
        scopeStatuses: ["stretch"],
        workStatus: "ready",
        sourceTrackerId: "local",
        canonicalTrackerId: "local",
        logicalItemId: "local-3",
        dedupeReason: null,
      },
      {
        id: "github-42",
        componentId: "core",
        scopeStatus: "deferred",
        scopeStatuses: ["deferred"],
        workStatus: "ready",
        sourceTrackerId: "inbox",
        canonicalTrackerId: "inbox",
        logicalItemId: "42",
        dedupeReason: null,
      },
    ]);
  });

  it("deduplicates linked local and provider-native scope entries", async () => {
    const projectRoot = makeTempDir("dev-nexus-version-scope-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "allowed",
        importRequiredFirst: false,
        providerFilters: [],
        queryLimit: 25,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
      },
      versionPlanning: {
        versions: [
          {
            id: "0.2.0",
            objective: "Ship linked scope.",
            owningComponents: ["core"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                status: "committed",
                componentId: "core",
                workItemId: "local-7",
              },
              {
                kind: "label",
                status: "candidate",
                componentId: "core",
                trackerId: "inbox",
                label: "version-scope",
              },
            ],
          },
        ],
      },
    });
    saveWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot), {
      version: 1,
      nextAuditNumber: 1,
      updatedAt: "2026-05-19T10:00:00.000Z",
      records: [
        {
          projectId: "version-scope-demo",
          componentId: "core",
          logicalItemId: "local-7",
          createdAt: "2026-05-19T10:00:00.000Z",
          updatedAt: "2026-05-19T10:00:00.000Z",
          references: [
            trackerReference("local", "local", "local-7"),
            trackerReference("inbox", "github", "42", 42),
          ],
          audit: [],
        },
      ],
    });
    const providers = providerFactory({
      local: [
        workItem("local-7", "Local canonical", {
          labels: ["version-scope"],
        }),
      ],
      inbox: [
        workItem("github-42", "GitHub mirror", {
          provider: "github",
          labels: ["version-scope"],
          externalRef: githubRef("42", 42),
        }),
      ],
    });

    const result = await resolveNexusVersionScope({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      version: config.versionPlanning!.versions[0]!,
      providerFactory: providers.factory,
    });

    expect(result.warnings).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      workItem: {
        id: "local-7",
      },
      logicalItemId: "local-7",
      scopeStatus: "committed",
      scopeStatuses: ["committed", "candidate"],
      canonicalTrackerRef: {
        trackerId: "local",
      },
      dedupe: {
        reason: "tracker_link",
        logicalItemId: "local-7",
        collapsedCount: 2,
      },
    });
  });

  it("reports unsupported milestones, missing milestones, and unresolved refs as warnings", async () => {
    const projectRoot = makeTempDir("dev-nexus-version-scope-");
    const config = projectConfig({
      versionPlanning: {
        versions: [
          {
            id: "0.2.0",
            objective: "Report warnings.",
            owningComponents: ["core"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                status: "committed",
                componentId: "core",
                workItemId: "missing-local",
              },
              {
                kind: "milestone",
                status: "candidate",
                componentId: "core",
                trackerId: "inbox",
                milestone: "missing-milestone",
              },
            ],
          },
        ],
      },
    });
    const components = resolveProjectComponents(projectRoot, config);
    const inbox = components[0]!.workTrackers.find((tracker) => tracker.id === "inbox")!;
    inbox.workTrackingCapabilityReport.capabilities.milestones = false;
    inbox.workTrackingCapabilityReport.unsupported.push("milestones");
    const providers = providerFactory({
      local: [],
      inbox: [],
    });

    const result = await resolveNexusVersionScope({
      projectRoot,
      projectConfig: config,
      components,
      version: config.versionPlanning!.versions[0]!,
      providerFactory: providers.factory,
    });

    expect(result.items).toEqual([]);
    expect(result.warnings).toMatchObject([
      {
        code: "unresolved_work_item",
        componentId: "core",
        trackerId: "local",
      },
      {
        code: "unsupported_milestones",
        componentId: "core",
        trackerId: "inbox",
      },
      {
        code: "no_scope_matches",
        componentId: "core",
        trackerId: "inbox",
      },
    ]);
  });

  it("does not change eligible-work discovery when no version config exists", async () => {
    const projectRoot = makeTempDir("dev-nexus-version-scope-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const providers = providerFactory({
      local: [
        workItem("local-ready", "Ready task", {
          labels: ["automation"],
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: config.automation!,
      selectorQuery: buildNexusAutomationWorkItemQuery(config.automation!),
      mode: "default",
      providerFactory: providers.factory,
    });

    expect(config.versionPlanning).toBeUndefined();
    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "local-ready",
        componentId: "core",
      },
    ]);
  });
});

function projectConfig(
  overrides: Partial<NexusProjectConfig["components"][number]> &
    Pick<Partial<NexusProjectConfig>, "versionPlanning"> = {},
): NexusProjectConfig {
  const { versionPlanning, ...componentOverrides } = overrides;
  return {
    version: 1,
    id: "version-scope-demo",
    name: "Version Scope Demo",
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
          tracker("local", "Local", true, ["primary"], {
            provider: "local",
          }),
          tracker("inbox", "Inbox", true, ["eligible_source", "external_inbox"], {
            provider: "github",
            repository: {
              owner: "example",
              name: "demo",
            },
          }),
        ],
        relationships: [],
        ...componentOverrides,
      },
    ],
    worktreesRoot: "worktrees",
    automation: {
      ...defaultNexusAutomationConfig,
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
      },
    },
    ...(versionPlanning ? { versionPlanning } : {}),
  };
}

function tracker(
  id: string,
  name: string,
  enabled: boolean,
  roles: NexusProjectConfig["components"][number]["workTrackers"][number]["roles"],
  workTracking: NexusProjectConfig["components"][number]["workTrackers"][number]["workTracking"],
): NexusProjectConfig["components"][number]["workTrackers"][number] {
  return {
    id,
    name,
    enabled,
    roles,
    workTracking,
  };
}

function workItem(
  id: string,
  title: string,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  const provider = overrides.provider ?? "local";
  return {
    id,
    title,
    description: overrides.description ?? null,
    status: overrides.status ?? "ready",
    provider,
    labels: overrides.labels ?? [],
    assignees: overrides.assignees ?? [],
    milestone: overrides.milestone ?? null,
    createdAt: "2026-05-19T09:00:00.000Z",
    updatedAt: "2026-05-19T09:00:00.000Z",
    closedAt: null,
    webUrl: null,
    externalRef:
      overrides.externalRef ??
      (provider === "local"
        ? {
            provider: "local",
            itemId: id,
          }
        : {
            provider,
            itemId: id,
          }),
    ...overrides,
  };
}

function githubRef(itemId: string, itemNumber: number) {
  return {
    provider: "github" as const,
    host: "github.com",
    repositoryOwner: "example",
    repositoryName: "demo",
    itemId,
    itemNumber,
  };
}

function trackerReference(
  trackerId: string,
  provider: string,
  itemId: string,
  itemNumber: number | null = null,
) {
  return {
    trackerId,
    trackerName: trackerId,
    provider,
    host: provider === "github" ? "github.com" : null,
    repositoryId: null,
    repositoryOwner: provider === "github" ? "example" : null,
    repositoryName: provider === "github" ? "demo" : null,
    projectId: null,
    boardId: null,
    itemId,
    itemNumber,
    itemKey: null,
    nodeId: null,
    webUrl: null,
    firstObservedAt: "2026-05-19T10:00:00.000Z",
    lastObservedAt: "2026-05-19T10:00:00.000Z",
  };
}

function providerFactory(itemsByTrackerId: Record<string, WorkItem[]>): {
  factory: NexusVersionScopeProviderFactory;
  operations: Array<{
    trackerId: string;
    method: "get" | "list";
    ref?: WorkItemRef;
    query?: WorkItemQuery;
  }>;
} {
  const operations: Array<{
    trackerId: string;
    method: "get" | "list";
    ref?: WorkItemRef;
    query?: WorkItemQuery;
  }> = [];
  return {
    operations,
    factory: ({ tracker }) =>
      new MemoryProvider(
        tracker.provider,
        itemsByTrackerId[tracker.id] ?? [],
        (operation) => operations.push({ trackerId: tracker.id, ...operation }),
      ),
  };
}

class MemoryProvider implements WorkTrackerProvider {
  readonly capabilities = {
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

  constructor(
    readonly provider: string,
    private readonly items: WorkItem[],
    private readonly record: (operation: {
      method: "get" | "list";
      ref?: WorkItemRef;
      query?: WorkItemQuery;
    }) => void,
  ) {}

  async createWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    this.record({ method: "list", query });
    return this.items.filter((item) => matchesQuery(item, query)).slice(
      0,
      query.limit,
    );
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    this.record({ method: "get", ref });
    const item = this.items.find((candidate) =>
      ref.id
        ? candidate.id === ref.id
        : candidate.externalRef?.itemId === ref.externalRef?.itemId,
    );
    if (!item) {
      throw new Error(`work item not found: ${ref.id ?? ref.externalRef?.itemId}`);
    }

    return item;
  }

  async updateWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async addComment(): Promise<never> {
    throw new Error("not implemented");
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

function scopeSummary(
  item: Awaited<ReturnType<typeof resolveNexusVersionScope>>["items"][number],
) {
  return {
    id: item.workItem.id,
    componentId: item.componentId,
    scopeStatus: item.scopeStatus,
    scopeStatuses: item.scopeStatuses,
    workStatus: item.workItem.status,
    sourceTrackerId: item.sourceTrackerRef.trackerId,
    canonicalTrackerId: item.canonicalTrackerRef?.trackerId ?? null,
    logicalItemId: item.logicalItemId,
    dedupeReason: item.dedupe?.reason ?? null,
  };
}
