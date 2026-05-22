import { describe, expect, it } from "vitest";
import type {
  NexusEligibleWorkItem,
} from "./nexusEligibleWork.js";
import {
  NexusMemoryWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityClaimCandidateResult,
  type NexusWorkItemClaimAuthorityRecord,
  type NexusWorkItemClaimOwner,
} from "./nexusWorkItemClaimAuthority.js";
import type {
  ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import type {
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

describe("memory work item claim authority", () => {
  it("claims and verifies an active claim with a fencing token", async () => {
    const authority = new NexusMemoryWorkItemClaimAuthority();

    const result = await authority.claimCandidate(
      claimInput({
        id: "github-1",
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
      workItem: {
        id: "github-1",
        status: "in_progress",
      },
    });
    expect(claim).toMatchObject({
      authorityKind: "memory",
      key: {
        projectId: "project-a",
        componentId: "core",
        trackerId: "github",
        provider: "github",
        workItemId: "github-1",
        repositoryOwner: "example",
        repositoryName: "demo",
      },
      owner: {
        leaseToken: "token-1",
      },
      state: "active",
      fencingToken: 1,
    });

    await expect(
      authority.verifyClaim({
        key: claim.key,
        leaseToken: "token-1",
        now: date("2026-05-22T10:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "verified",
      claim: {
        fencingToken: 1,
        owner: {
          leaseToken: "token-1",
        },
      },
    });
  });

  it("rejects a second active claimant for the same authority key", async () => {
    const authority = new NexusMemoryWorkItemClaimAuthority();
    const first = await authority.claimCandidate(
      claimInput({
        id: "github-2",
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
        id: "github-2",
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
        id: "github-2",
        status: "in_progress",
      },
      authorityClaim: {
        fencingToken: firstClaim.fencingToken,
        owner: {
          leaseToken: "token-1",
        },
      },
    });
  });

  it("heartbeats and releases only the current lease token", async () => {
    const authority = new NexusMemoryWorkItemClaimAuthority();
    const claim = claimedRecord(
      await authority.claimCandidate(
        claimInput({
          id: "github-3",
          owner: owner("token-1", {
            claimedAt: "2026-05-22T10:00:00.000Z",
            expiresAt: "2026-05-22T10:30:00.000Z",
          }),
          now: "2026-05-22T10:00:00.000Z",
        }),
      ),
    );

    await expect(
      authority.heartbeatClaim({
        key: claim.key,
        leaseToken: "other-token",
        leaseDurationMs: 30 * 60 * 1000,
        now: date("2026-05-22T10:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "token_mismatch",
    });

    const heartbeat = await authority.heartbeatClaim({
      key: claim.key,
      leaseToken: "token-1",
      leaseDurationMs: 30 * 60 * 1000,
      now: date("2026-05-22T10:10:00.000Z"),
    });

    expect(heartbeat).toMatchObject({
      status: "heartbeat",
      claim: {
        owner: {
          leaseToken: "token-1",
          expiresAt: "2026-05-22T10:40:00.000Z",
        },
        lastHeartbeatAt: "2026-05-22T10:10:00.000Z",
      },
    });

    await expect(
      authority.releaseClaim({
        key: claim.key,
        leaseToken: "token-1",
        now: date("2026-05-22T10:15:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "released",
      claim: {
        state: "released",
        releasedAt: "2026-05-22T10:15:00.000Z",
      },
    });

    await expect(
      authority.verifyClaim({
        key: claim.key,
        leaseToken: "token-1",
        now: date("2026-05-22T10:16:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "released",
    });
  });

  it("reclaims expired claims with a new fencing token and inspectable stale state", async () => {
    const authority = new NexusMemoryWorkItemClaimAuthority();
    const stale = claimedRecord(
      await authority.claimCandidate(
        claimInput({
          id: "github-4",
          owner: owner("expired-token", {
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
            leaseToken: "expired-token",
          },
        },
      ],
    });

    await expect(
      authority.reclaimExpiredClaim({
        key: stale.key,
        owner: owner("new-token", {
          claimedAt: "2026-05-22T10:31:00.000Z",
          expiresAt: "2026-05-22T11:01:00.000Z",
        }),
        workItem: workItem("github-4"),
        now: date("2026-05-22T10:31:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "claimed",
      claim: {
        owner: {
          leaseToken: "new-token",
        },
        fencingToken: 2,
        reclaimedFrom: {
          owner: {
            leaseToken: "expired-token",
          },
        },
      },
      workItem: {
        id: "github-4",
        status: "in_progress",
      },
    });

    await expect(
      authority.verifyClaim({
        key: stale.key,
        leaseToken: "expired-token",
        now: date("2026-05-22T10:32:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "token_mismatch",
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
  owner: NexusWorkItemClaimOwner;
  now: string;
}) {
  const item = workItem(options.id);
  const candidate = eligibleWorkItem(item);
  return {
    projectId: "project-a",
    candidate,
    tracker: githubTracker(),
    provider: testProvider(),
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

function testProvider(): WorkTrackerProvider {
  return {
    provider: "github",
    capabilities: {
      createItem: false,
      listItems: false,
      getItem: false,
      updateItem: false,
      comment: false,
      labels: false,
      assignees: false,
      milestones: false,
      board: false,
      boardStatus: false,
      draftItems: false,
      webhooks: false,
    },
    async createWorkItem(): Promise<WorkItem> {
      throw new Error("not implemented");
    },
    async listWorkItems(_query: WorkItemQuery): Promise<WorkItem[]> {
      throw new Error("not implemented");
    },
    async getWorkItem(_ref: WorkItemRef): Promise<WorkItem> {
      throw new Error("not implemented");
    },
    async updateWorkItem(
      _ref: WorkItemRef,
      _patch: WorkItemPatch,
    ): Promise<WorkItem> {
      throw new Error("not implemented");
    },
    async addComment(
      _ref: WorkItemRef,
      _body: string,
    ): Promise<WorkComment> {
      throw new Error("not implemented");
    },
  };
}

function date(value: string): Date {
  return new Date(value);
}
