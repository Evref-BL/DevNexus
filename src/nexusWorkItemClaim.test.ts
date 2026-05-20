import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultNexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  claimNexusEligibleWorkItem,
  type NexusEligibleWorkClaimProviderFactory,
} from "./nexusWorkItemClaim.js";
import {
  resolveProjectComponents,
} from "./nexusProjectLifecycle.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
  type WorkComment,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkItemRef,
  type WorkTrackerProvider,
} from "./index.js";

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

describe("optimistic work item claims", () => {
  it("claims a verified eligible GitHub work item and preserves labels and assignees", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-7", "Claim me", {
        labels: ["automation", "dogfood"],
        assignees: ["alice"],
        description: "Issue body.",
      }),
    ]);

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
      },
      leaseDurationMs: 30 * 60 * 1000,
      leaseTokenFactory: () => "lease-token-1",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "claimed",
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
        leaseToken: "lease-token-1",
        claimedAt: "2026-05-20T10:00:00.000Z",
        expiresAt: "2026-05-20T10:30:00.000Z",
      },
      workItem: {
        id: "github-7",
        status: "in_progress",
        labels: ["automation", "dogfood"],
        assignees: ["alice"],
      },
    });
    expect(provider.updates).toMatchObject([
      {
        ref: { provider: "github", id: "github-7" },
        patch: {
          status: "in_progress",
        },
      },
    ]);
    expect(provider.updates[0]?.patch.labels).toBeUndefined();
    expect(provider.updates[0]?.patch.assignees).toBeUndefined();
    expect(provider.items[0]?.description).toContain("dev-nexus-work-item-claim");
    expect(provider.items[0]?.description).toContain("lease-token-1");
    expect(provider.comments).toHaveLength(1);
    expect(provider.comments[0]?.body).toContain("host-a");
    expect(provider.comments[0]?.body).toContain("lease-token-1");
  });

  it("returns no-claim when no candidate matches the configured selector", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-8", "Wrong label", {
        labels: ["other"],
      }),
    ]);

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a" },
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toEqual({
      status: "no_claim",
      reason: "no_eligible_candidate",
      skippedCandidates: [],
    });
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("skips a candidate that is no longer ready when re-read", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-9", "Went stale", {
        labels: ["automation"],
      }),
    ]);
    provider.beforeGet = (item) => {
      item.status = "todo";
    };

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a" },
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "no_claim",
      reason: "candidates_not_claimable",
      skippedCandidates: [
        {
          id: "github-9",
          reason: "no_longer_ready",
          observedStatus: "todo",
        },
      ],
    });
    expect(provider.updates).toEqual([]);
  });

  it("skips a candidate that is already in progress when re-read", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-10", "Already owned", {
        labels: ["automation"],
      }),
    ]);
    provider.beforeGet = (item) => {
      item.status = "in_progress";
    };

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a" },
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "no_claim",
      reason: "candidates_not_claimable",
      skippedCandidates: [
        {
          id: "github-10",
          reason: "already_in_progress",
          observedStatus: "in_progress",
        },
      ],
    });
    expect(provider.updates).toEqual([]);
  });

  it("reports active in-progress claims without selecting them for another owner", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-12", "Actively claimed", {
        status: "in_progress",
        labels: ["automation"],
        description: claimBlock({
          leaseToken: "active-token",
          hostId: "host-b",
          agentId: "agent-b",
          claimedAt: "2026-05-20T09:55:00.000Z",
          expiresAt: "2026-05-20T10:25:00.000Z",
        }),
      }),
    ]);

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a", agentId: "agent-a" },
      leaseTokenFactory: () => "new-token",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "no_claim",
      reason: "active_claims",
      activeClaims: [
        {
          id: "github-12",
          title: "Actively claimed",
          owner: {
            hostId: "host-b",
            agentId: "agent-b",
            leaseToken: "active-token",
            expiresAt: "2026-05-20T10:25:00.000Z",
          },
        },
      ],
    });
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("reports expired in-progress claims without reclaiming by default", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-13", "Expired claim", {
        status: "in_progress",
        labels: ["automation"],
        description: claimBlock({
          leaseToken: "expired-token",
          hostId: "host-b",
          agentId: "agent-b",
          claimedAt: "2026-05-20T09:00:00.000Z",
          expiresAt: "2026-05-20T09:30:00.000Z",
        }),
      }),
    ]);

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a", agentId: "agent-a" },
      leaseTokenFactory: () => "new-token",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "no_claim",
      reason: "stale_claims",
      staleClaims: [
        {
          id: "github-13",
          title: "Expired claim",
          owner: {
            hostId: "host-b",
            agentId: "agent-b",
            leaseToken: "expired-token",
            expiresAt: "2026-05-20T09:30:00.000Z",
          },
        },
      ],
    });
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("reclaims an expired in-progress claim when the reclaim policy is enabled", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-14", "Expired reclaim", {
        status: "in_progress",
        labels: ["automation", "dogfood"],
        assignees: ["alice"],
        description: [
          "Issue body.",
          "",
          claimBlock({
            leaseToken: "expired-token",
            hostId: "host-b",
            agentId: "agent-b",
            claimedAt: "2026-05-20T09:00:00.000Z",
            expiresAt: "2026-05-20T09:30:00.000Z",
          }),
        ].join("\n"),
      }),
    ]);

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a", agentId: "agent-a" },
      leaseTokenFactory: () => "new-token",
      staleClaimPolicy: "reclaim",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "claimed",
      workItem: {
        id: "github-14",
        status: "in_progress",
        labels: ["automation", "dogfood"],
        assignees: ["alice"],
      },
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
        leaseToken: "new-token",
        expiresAt: "2026-05-20T11:00:00.000Z",
      },
      reclaimedFrom: {
        owner: {
          hostId: "host-b",
          agentId: "agent-b",
          leaseToken: "expired-token",
        },
      },
    });
    expect(provider.updates).toMatchObject([
      {
        patch: {
          status: "in_progress",
        },
      },
    ]);
    expect(provider.updates[0]?.patch.labels).toBeUndefined();
    expect(provider.updates[0]?.patch.assignees).toBeUndefined();
    expect(provider.items[0]?.description).toContain("new-token");
    expect(provider.items[0]?.description).not.toContain("expired-token");
    expect(provider.comments[0]?.body).toContain("reclaimed");
    expect(provider.comments[0]?.body).toContain("expired-token");
  });

  it("refuses to reclaim active claims even when reclaim is enabled", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-15", "Active reclaim refusal", {
        status: "in_progress",
        labels: ["automation"],
        description: claimBlock({
          leaseToken: "active-token",
          hostId: "host-b",
          agentId: "agent-b",
          claimedAt: "2026-05-20T09:55:00.000Z",
          expiresAt: "2026-05-20T10:25:00.000Z",
        }),
      }),
    ]);

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: { hostId: "host-a", agentId: "agent-a" },
      leaseTokenFactory: () => "new-token",
      staleClaimPolicy: "reclaim",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "no_claim",
      reason: "active_claims",
      activeClaims: [
        {
          id: "github-15",
          owner: {
            leaseToken: "active-token",
          },
        },
      ],
    });
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("returns lost-race when the verification read does not show our lease token", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-11", "Race me", {
        labels: ["automation"],
      }),
    ]);
    provider.afterUpdate = (item) => {
      item.description = claimBlock({
        leaseToken: "other-token",
        hostId: "host-b",
        agentId: "agent-b",
        claimedAt: "2026-05-20T10:00:01.000Z",
        expiresAt: "2026-05-20T10:30:01.000Z",
      });
    };

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
      },
      leaseTokenFactory: () => "lease-token-1",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "lost_race",
      reason: "verification_failed",
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
        leaseToken: "lease-token-1",
      },
      observedWorkItem: {
        id: "github-11",
        status: "in_progress",
      },
    });
    expect(provider.comments).toEqual([]);
  });
});

function automationConfig() {
  return {
    ...defaultNexusAutomationConfig,
    selector: {
      ...defaultNexusAutomationConfig.selector,
      statuses: ["ready"],
      labels: ["automation"],
      limit: 5,
    },
  };
}

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "claim-demo",
    name: "Claim Demo",
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
        defaultWorkTrackerId: "github",
        workTrackers: [
          {
            id: "github",
            name: "GitHub",
            enabled: true,
            roles: ["primary", "eligible_source"],
            workTracking: {
              provider: "github",
              repository: {
                owner: "example",
                name: "demo",
              },
            },
          },
        ],
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    automation: automationConfig(),
  };
}

function workItem(
  id: string,
  title: string,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  return {
    id,
    title,
    description: overrides.description ?? null,
    status: overrides.status ?? "ready",
    provider: "github",
    labels: overrides.labels ?? [],
    assignees: overrides.assignees ?? [],
    milestone: null,
    createdAt: "2026-05-20T09:00:00.000Z",
    updatedAt: "2026-05-20T09:00:00.000Z",
    closedAt: null,
    webUrl: `https://github.com/example/demo/issues/${id.replace(/^github-/, "")}`,
    externalRef: {
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: id.replace(/^github-/, ""),
      itemNumber: Number(id.replace(/^github-/, "")),
    },
    ...overrides,
  };
}

function providerFactory(
  provider: ClaimMemoryProvider,
): NexusEligibleWorkClaimProviderFactory {
  return () => provider;
}

class ClaimMemoryProvider implements WorkTrackerProvider {
  readonly provider = "github";
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
  readonly updates: Array<{ ref: WorkItemRef; patch: WorkItemPatch }> = [];
  readonly comments: Array<{ ref: WorkItemRef; body: string }> = [];
  beforeGet?: (item: WorkItem) => void;
  afterUpdate?: (item: WorkItem) => void;

  constructor(readonly items: WorkItem[]) {}

  async createWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    return this.items.filter((item) => matchesQuery(item, query)).map(cloneItem);
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    const item = this.findItem(ref);
    this.beforeGet?.(item);
    return cloneItem(item);
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    this.updates.push({ ref, patch });
    const item = this.findItem(ref);
    if (patch.status !== undefined) {
      item.status = patch.status;
    }
    if (patch.description !== undefined) {
      item.description = patch.description;
    }
    if (patch.labels !== undefined) {
      item.labels = [...patch.labels];
    }
    if (patch.assignees !== undefined) {
      item.assignees = [...patch.assignees];
    }
    this.afterUpdate?.(item);
    return cloneItem(item);
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    this.comments.push({ ref, body });
    return {
      id: `comment-${this.comments.length}`,
      body,
      author: "claim-bot",
    };
  }

  private findItem(ref: WorkItemRef): WorkItem {
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) =>
        candidate.id === id ||
        candidate.externalRef?.itemId === id ||
        candidate.externalRef?.itemNumber === Number(id),
    );
    if (!item) {
      throw new Error(`missing item ${id}`);
    }

    return item;
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

  return true;
}

function cloneItem(item: WorkItem): WorkItem {
  return {
    ...item,
    labels: item.labels ? [...item.labels] : undefined,
    assignees: item.assignees ? [...item.assignees] : undefined,
    externalRef: item.externalRef ? { ...item.externalRef } : undefined,
  };
}

function claimBlock(input: {
  leaseToken: string;
  hostId: string;
  agentId: string;
  claimedAt: string;
  expiresAt: string;
}): string {
  return [
    "<!-- dev-nexus-work-item-claim",
    JSON.stringify({
      version: 1,
      ...input,
    }),
    "-->",
  ].join("\n");
}
