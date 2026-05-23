import { describe, expect, it } from "vitest";
import type {
  NexusEligibleWorkItem,
} from "./nexusEligibleWork.js";
import {
  createNexusNodePostgresClaimSqlClient,
  detectNexusNodePostgresAdapterStatus,
  NexusPostgresWorkItemClaimAuthority,
  nexusPostgresClaimAuthoritySchemaSql,
} from "./index.js";
import type {
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import type {
  NexusWorkItemClaimAuthorityClaimCandidateResult,
  NexusWorkItemClaimAuthorityRecord,
  NexusWorkItemClaimOwner,
} from "./nexusWorkItemClaimAuthority.js";
import type {
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

const smokeEnabled =
  process.env.DEV_NEXUS_POSTGRES_CLAIM_AUTHORITY_SMOKE === "1";
const describeLive = smokeEnabled ? describe : describe.skip;

describeLive("postgres work item claim authority live smoke", () => {
  it("claims one winner and verifies its fencing token in PostgreSQL", async () => {
    const connectionString = requiredEnv("DEV_NEXUS_CLAIMS_DATABASE_URL");
    const schema = optionalEnv("DEV_NEXUS_CLAIMS_SCHEMA") ?? "dev_nexus_smoke";

    if (detectNexusNodePostgresAdapterStatus() !== "available") {
      throw new Error(
        "PostgreSQL claim authority live smoke requires optional pg package",
      );
    }

    const client = await createNexusNodePostgresClaimSqlClient({
      connectionString,
      schema,
      applicationName: "dev-nexus-postgres-claim-authority-smoke",
    });
    await client.transaction(async (transaction) => {
      await transaction.query(
        `CREATE SCHEMA IF NOT EXISTS ${quotePostgresIdentifier(schema)}`,
      );
      await transaction.query(nexusPostgresClaimAuthoritySchemaSql);
    });

    const authority = new NexusPostgresWorkItemClaimAuthority({ client });
    const provider = new SmokeMirrorProvider();
    const workItemId = `postgres-smoke-${Date.now()}`;
    const firstOwner = owner("postgres-smoke-token-1", {
      claimedAt: "2026-05-23T10:00:00.000Z",
      expiresAt: "2026-05-23T10:30:00.000Z",
    });

    const first = await authority.claimCandidate(
      claimInput({
        id: workItemId,
        provider,
        owner: firstOwner,
        now: "2026-05-23T10:00:00.000Z",
      }),
    );
    const firstClaim = claimedRecord(first);
    const second = await authority.claimCandidate(
      claimInput({
        id: workItemId,
        provider,
        owner: owner("postgres-smoke-token-2", {
          claimedAt: "2026-05-23T10:05:00.000Z",
          expiresAt: "2026-05-23T10:35:00.000Z",
        }),
        now: "2026-05-23T10:05:00.000Z",
      }),
    );

    expect(first).toMatchObject({
      status: "claimed",
      authorityClaim: {
        authorityKind: "postgres",
        state: "active",
        owner: {
          leaseToken: "postgres-smoke-token-1",
        },
      },
    });
    expect(firstClaim.fencingToken).toBeGreaterThan(0);
    expect(second).toMatchObject({
      status: "lost_race",
      authorityClaim: {
        fencingToken: firstClaim.fencingToken,
        owner: {
          leaseToken: "postgres-smoke-token-1",
        },
      },
    });
    await expect(
      authority.verifyClaim({
        key: firstClaim.key,
        leaseToken: "postgres-smoke-token-1",
        now: date("2026-05-23T10:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "verified",
      claim: {
        fencingToken: firstClaim.fencingToken,
      },
    });
    await expect(
      authority.releaseClaim({
        key: firstClaim.key,
        leaseToken: "postgres-smoke-token-1",
        now: date("2026-05-23T10:15:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "released",
      claim: {
        state: "released",
      },
    });
    expect(provider.updates).toHaveLength(1);
    expect(provider.comments).toHaveLength(1);
  });
});

function claimedRecord(
  result: NexusWorkItemClaimAuthorityClaimCandidateResult,
): NexusWorkItemClaimAuthorityRecord {
  if (result.status !== "claimed" || !result.authorityClaim) {
    throw new Error("expected claimed authority record");
  }

  return result.authorityClaim;
}

function claimInput(options: {
  id: string;
  provider: WorkTrackerProvider;
  owner: NexusWorkItemClaimOwner;
  now: string;
}) {
  const item = workItem(options.id);
  const candidate = eligibleWorkItem(item);
  return {
    projectId: "postgres-live-smoke",
    candidate,
    tracker: githubTracker(),
    provider: options.provider,
    ref: {
      provider: "github",
      id: item.id,
      externalRef: item.externalRef,
    },
    freshWorkItem: item,
    owner: options.owner,
    now: date(options.now),
  };
}

function owner(
  leaseToken: string,
  options: {
    claimedAt: string;
    expiresAt: string;
  },
): NexusWorkItemClaimOwner {
  return {
    version: 1,
    hostId: "postgres-live-smoke-host",
    agentId: "postgres-live-smoke-agent",
    ownerId: null,
    leaseToken,
    claimedAt: options.claimedAt,
    expiresAt: options.expiresAt,
  };
}

function workItem(id: string): WorkItem {
  return {
    id,
    title: `PostgreSQL claim authority live smoke ${id}`,
    description: "Synthetic live smoke work item.",
    status: "ready",
    provider: "github",
    labels: ["automation"],
    assignees: [],
    milestone: null,
    createdAt: "2026-05-23T09:00:00.000Z",
    updatedAt: "2026-05-23T09:00:00.000Z",
    closedAt: null,
    webUrl: `https://github.com/example/demo/issues/${id}`,
    externalRef: {
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: id,
    },
  };
}

function eligibleWorkItem(item: WorkItem): NexusEligibleWorkItem {
  return {
    ...item,
    componentId: "core",
    logicalItemId: null,
    canonicalTrackerRef: {
      trackerId: "github",
      provider: "github",
      componentId: "core",
    },
    sourceTrackerRef: {
      trackerId: "github",
      provider: "github",
      componentId: "core",
    },
    dedupe: null,
    warnings: [],
    selectable: true,
    importOnly: false,
  };
}

function githubTracker(): ResolvedNexusProjectWorkTracker {
  return {
    id: "github",
    name: "GitHub",
    provider: "github",
    enabled: true,
    roles: ["primary", "eligible_source"],
    default: true,
    workTracking: {
      provider: "github",
      repository: {
        owner: "example",
        name: "demo",
      },
    },
  } as ResolvedNexusProjectWorkTracker;
}

class SmokeMirrorProvider implements WorkTrackerProvider {
  readonly provider = "github";
  readonly capabilities = {
    createItem: false,
    listItems: false,
    getItem: false,
    updateItem: true,
    comment: true,
    labels: false,
    assignees: false,
    milestones: false,
    board: false,
    boardStatus: false,
    draftItems: false,
    webhooks: false,
  };
  readonly updates: Array<{ ref: WorkItemRef; patch: WorkItemPatch }> = [];
  readonly comments: Array<{ ref: WorkItemRef; body: string }> = [];

  async createWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async listWorkItems(_query: WorkItemQuery): Promise<WorkItem[]> {
    throw new Error("not implemented");
  }

  async getWorkItem(_ref: WorkItemRef): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async updateWorkItem(
    ref: WorkItemRef,
    patch: WorkItemPatch,
  ): Promise<WorkItem> {
    this.updates.push({ ref, patch });
    return {
      ...workItem(ref.id ?? "postgres-smoke-unknown"),
      status: patch.status ?? "ready",
    };
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    this.comments.push({ ref, body });
    return {
      id: `comment-${this.comments.length}`,
      body,
      author: "claim-bot",
    };
  }
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`${name} must be set for PostgreSQL claim authority smoke`);
  }

  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function quotePostgresIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function date(value: string): Date {
  return new Date(value);
}
