import { describe, expect, it } from "vitest";
import type {
  NexusEligibleWorkItem,
} from "../src/nexusEligibleWork.js";
import {
  NexusPostgresWorkItemClaimAuthority,
  nexusPostgresClaimAuthoritySchemaSql,
  type NexusPostgresClaimAuthorityRow,
  type NexusPostgresClaimSqlClient,
  type NexusPostgresClaimSqlQueryResult,
  type NexusPostgresClaimSqlTransaction,
} from "../src/nexusPostgresWorkItemClaimAuthority.js";
import type {
  NexusWorkItemClaimAuthorityClaimCandidateResult,
  NexusWorkItemClaimAuthorityRecord,
  NexusWorkItemClaimOwner,
} from "../src/nexusWorkItemClaimAuthority.js";
import type {
  ResolvedNexusProjectWorkTracker,
} from "../src/nexusProjectLifecycle.js";
import type {
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkTrackerProvider,
} from "../src/workTrackingTypes.js";

describe("postgres work item claim authority", () => {
  it("claims inside a transaction and returns a database fencing token", async () => {
    const client = new FakePostgresClaimClient();
    const provider = new MirrorProvider();
    const authority = new NexusPostgresWorkItemClaimAuthority({ client });

    const result = await authority.claimCandidate(
      claimInput({
        id: "github-21",
        provider,
        owner: owner("token-1", {
          claimedAt: "2026-05-22T10:00:00.000Z",
          expiresAt: "2026-05-22T10:30:00.000Z",
        }),
        now: "2026-05-22T10:00:00.000Z",
      }),
    );
    const claim = claimedRecord(result);

    expect(nexusPostgresClaimAuthoritySchemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS dev_nexus_work_item_claims",
    );
    expect(nexusPostgresClaimAuthoritySchemaSql).toContain(
      "CREATE SEQUENCE IF NOT EXISTS dev_nexus_work_item_claim_fencing_seq",
    );
    expect(client.events).toEqual([
      "begin",
      "lock",
      "select",
      "upsert",
      "commit",
    ]);
    expect(result).toMatchObject({
      status: "claimed",
      workItem: {
        id: "github-21",
        status: "in_progress",
      },
    });
    expect(claim).toMatchObject({
      authorityKind: "postgres",
      fencingToken: 1,
      state: "active",
      owner: {
        leaseToken: "token-1",
      },
      key: {
        projectId: "project-a",
        componentId: "core",
        trackerId: "github",
        provider: "github",
        workItemId: "github-21",
        repositoryOwner: "example",
        repositoryName: "demo",
      },
    });
    expect(provider.updates).toEqual([
      {
        ref: {
          provider: "github",
          id: "github-21",
          externalRef: workItem("github-21").externalRef,
        },
        patch: {
          status: "in_progress",
        },
      },
    ]);
  });

  it("rejects duplicate active claims without mirroring a second worker", async () => {
    const client = new FakePostgresClaimClient();
    const provider = new MirrorProvider();
    const authority = new NexusPostgresWorkItemClaimAuthority({ client });
    const first = await authority.claimCandidate(
      claimInput({
        id: "github-22",
        provider,
        owner: owner("token-1", {
          claimedAt: "2026-05-22T10:00:00.000Z",
          expiresAt: "2026-05-22T10:30:00.000Z",
        }),
        now: "2026-05-22T10:00:00.000Z",
      }),
    );
    const firstClaim = claimedRecord(first);

    const second = await authority.claimCandidate(
      claimInput({
        id: "github-22",
        provider,
        owner: owner("token-2", {
          claimedAt: "2026-05-22T10:05:00.000Z",
          expiresAt: "2026-05-22T10:35:00.000Z",
        }),
        now: "2026-05-22T10:05:00.000Z",
      }),
    );

    expect(second).toMatchObject({
      status: "lost_race",
      observedWorkItem: {
        id: "github-22",
        status: "in_progress",
      },
      authorityClaim: {
        fencingToken: firstClaim.fencingToken,
        owner: {
          leaseToken: "token-1",
        },
      },
    });
    expect(provider.updates).toHaveLength(1);
  });

  it("heartbeats, releases, inspects, and reclaims claims through SQL rows", async () => {
    const client = new FakePostgresClaimClient();
    const provider = new MirrorProvider();
    const authority = new NexusPostgresWorkItemClaimAuthority({ client });
    const firstClaim = claimedRecord(
      await authority.claimCandidate(
        claimInput({
          id: "github-23",
          provider,
          owner: owner("expired-token", {
            claimedAt: "2026-05-22T10:00:00.000Z",
            expiresAt: "2026-05-22T10:30:00.000Z",
          }),
          now: "2026-05-22T10:00:00.000Z",
        }),
      ),
    );

    await expect(
      authority.heartbeatClaim({
        key: firstClaim.key,
        leaseToken: "expired-token",
        leaseDurationMs: 30 * 60 * 1000,
        now: date("2026-05-22T10:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "heartbeat",
      claim: {
        owner: {
          expiresAt: "2026-05-22T10:40:00.000Z",
        },
        lastHeartbeatAt: "2026-05-22T10:10:00.000Z",
      },
    });

    await expect(
      authority.releaseClaim({
        key: firstClaim.key,
        leaseToken: "expired-token",
        now: date("2026-05-22T10:15:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "released",
      claim: {
        state: "released",
        releasedAt: "2026-05-22T10:15:00.000Z",
      },
    });

    const staleClaim = claimedRecord(
      await authority.claimCandidate(
        claimInput({
          id: "github-24",
          provider,
          owner: owner("stale-token", {
            claimedAt: "2026-05-22T10:00:00.000Z",
            expiresAt: "2026-05-22T10:30:00.000Z",
          }),
          now: "2026-05-22T10:00:00.000Z",
        }),
      ),
    );

    await expect(
      authority.inspectClaims({
        now: date("2026-05-22T10:31:00.000Z"),
      }),
    ).resolves.toMatchObject({
      activeClaims: [],
      staleClaims: [
        {
          owner: {
            leaseToken: "stale-token",
          },
        },
      ],
      releasedClaims: [
        {
          owner: {
            leaseToken: "expired-token",
          },
        },
      ],
    });

    await expect(
      authority.reclaimExpiredClaim({
        ...claimInput({
          id: "github-24",
          provider,
          owner: owner("new-token", {
            claimedAt: "2026-05-22T10:31:00.000Z",
            expiresAt: "2026-05-22T11:01:00.000Z",
          }),
          now: "2026-05-22T10:31:00.000Z",
        }),
        previousOwner: staleClaim.owner,
      }),
    ).resolves.toMatchObject({
      status: "claimed",
      authorityClaim: {
        fencingToken: 3,
        owner: {
          leaseToken: "new-token",
        },
        reclaimedFrom: {
          owner: {
            leaseToken: "stale-token",
          },
        },
      },
    });
  });

  it("keeps the database claim when provider mirroring fails", async () => {
    const client = new FakePostgresClaimClient();
    const provider = new MirrorProvider({ updateError: new Error("network down") });
    const authority = new NexusPostgresWorkItemClaimAuthority({ client });

    const result = await authority.claimCandidate(
      claimInput({
        id: "github-25",
        provider,
        owner: owner("token-1", {
          claimedAt: "2026-05-22T10:00:00.000Z",
          expiresAt: "2026-05-22T10:30:00.000Z",
        }),
        now: "2026-05-22T10:00:00.000Z",
      }),
    );
    const claim = claimedRecord(result);

    expect(result).toMatchObject({
      status: "claimed",
      authorityClaim: {
        providerMirrorWarnings: [
          "Failed to mirror claim status to work tracker: network down",
        ],
      },
    });
    await expect(
      authority.verifyClaim({
        key: claim.key,
        leaseToken: "token-1",
        now: date("2026-05-22T10:05:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "verified",
      claim: {
        providerMirrorWarnings: [
          "Failed to mirror claim status to work tracker: network down",
        ],
      },
    });
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
    projectId: "project-a",
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
    hostId: "host-a",
    agentId: "agent-a",
    ownerId: null,
    leaseToken,
    claimedAt: options.claimedAt,
    expiresAt: options.expiresAt,
  };
}

function workItem(id: string): WorkItem {
  return {
    id,
    title: `Work item ${id}`,
    description: "Issue body.",
    status: "ready",
    provider: "github",
    labels: ["automation"],
    assignees: [],
    milestone: null,
    createdAt: "2026-05-22T09:00:00.000Z",
    updatedAt: "2026-05-22T09:00:00.000Z",
    closedAt: null,
    webUrl: `https://github.com/example/demo/issues/${id.replace(/^github-/, "")}`,
    externalRef: {
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: id,
      itemNumber: Number(id.replace(/^github-/, "")),
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

class MirrorProvider implements WorkTrackerProvider {
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

  constructor(private readonly options: { updateError?: Error } = {}) {}

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
    if (this.options.updateError) {
      throw this.options.updateError;
    }
    this.updates.push({ ref, patch });
    return {
      ...workItem(ref.id ?? "github-0"),
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

class FakePostgresClaimClient implements NexusPostgresClaimSqlClient {
  readonly rows = new Map<string, NexusPostgresClaimAuthorityRow>();
  readonly events: string[] = [];
  private nextFencingToken = 1;

  async transaction<T>(
    callback: (transaction: NexusPostgresClaimSqlTransaction) => Promise<T>,
  ): Promise<T> {
    this.events.push("begin");
    try {
      const result = await callback(new FakePostgresClaimTransaction(this));
      this.events.push("commit");
      return result;
    } catch (error) {
      this.events.push("rollback");
      throw error;
    }
  }

  nextToken(): number {
    const token = this.nextFencingToken;
    this.nextFencingToken += 1;
    return token;
  }
}

class FakePostgresClaimTransaction
  implements NexusPostgresClaimSqlTransaction
{
  constructor(private readonly client: FakePostgresClaimClient) {}

  async query<Row = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<NexusPostgresClaimSqlQueryResult<Row>> {
    if (sql.includes("dev-nexus-postgres-claim-authority:lock")) {
      this.client.events.push("lock");
      return { rows: [] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:select")) {
      this.client.events.push("select");
      const keyHash = String(params[0]);
      const row = this.client.rows.get(keyHash);
      return { rows: (row ? [cloneRow(row)] : []) as Row[] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:upsert")) {
      this.client.events.push("upsert");
      const input = params[0] as NexusPostgresClaimAuthorityRow;
      const row = {
        ...cloneRow(input),
        fencingToken: this.client.nextToken(),
      };
      this.client.rows.set(row.keyHash, row);
      return { rows: [cloneRow(row) as Row] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:heartbeat")) {
      this.client.events.push("heartbeat");
      const [keyHash, owner, expiresAt, lastHeartbeatAt] = params as [
        string,
        NexusWorkItemClaimOwner,
        string,
        string,
      ];
      const row = requiredRow(this.client.rows, keyHash);
      const updated = {
        ...row,
        owner,
        expiresAt,
        lastHeartbeatAt,
      };
      this.client.rows.set(keyHash, updated);
      return { rows: [cloneRow(updated) as Row] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:release")) {
      this.client.events.push("release");
      const [keyHash, releasedAt] = params as [string, string];
      const row = requiredRow(this.client.rows, keyHash);
      const updated = {
        ...row,
        state: "released",
        releasedAt,
      };
      this.client.rows.set(keyHash, updated);
      return { rows: [cloneRow(updated) as Row] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:warnings")) {
      this.client.events.push("warnings");
      const [keyHash, providerMirrorWarnings] = params as [string, string[]];
      const row = requiredRow(this.client.rows, keyHash);
      const updated = {
        ...row,
        providerMirrorWarnings: [...providerMirrorWarnings],
      };
      this.client.rows.set(keyHash, updated);
      return { rows: [cloneRow(updated) as Row] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:inspect")) {
      this.client.events.push("inspect");
      const keyHash = params[0] as string | null;
      const rows = [...this.client.rows.values()]
        .filter((row) => (keyHash ? row.keyHash === keyHash : true))
        .map(cloneRow);
      return { rows: rows as Row[] };
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function requiredRow(
  rows: Map<string, NexusPostgresClaimAuthorityRow>,
  keyHash: string,
): NexusPostgresClaimAuthorityRow {
  const row = rows.get(keyHash);
  if (!row) {
    throw new Error(`missing row ${keyHash}`);
  }

  return row;
}

function cloneRow(
  row: NexusPostgresClaimAuthorityRow,
): NexusPostgresClaimAuthorityRow {
  return {
    ...row,
    key: { ...row.key },
    owner: { ...row.owner },
    providerMirrorWarnings: [...row.providerMirrorWarnings],
    ...(row.reclaimedFrom
      ? { reclaimedFrom: { ...row.reclaimedFrom } }
      : {}),
  };
}

function date(value: string): Date {
  return new Date(value);
}
