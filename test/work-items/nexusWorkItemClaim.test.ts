import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultNexusAutomationConfig } from "../../src/automation/nexusAutomationConfig.js";
import {
  claimNexusEligibleWorkItem,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityClaimCandidateOptions,
  type NexusWorkItemClaimAuthorityRecord,
  type NexusEligibleWorkClaimProviderFactory,
} from "../../src/work-items/nexusWorkItemClaim.js";
import type {
  NexusNodePostgresModule,
} from "../../src/work-items/nexusNodePostgresClaimSqlClient.js";
import type {
  NexusPostgresClaimAuthorityRow,
} from "../../src/work-items/nexusPostgresWorkItemClaimAuthority.js";
import {
  resolveProjectComponents,
} from "../../src/project/nexusProjectLifecycle.js";
import {
  createDefaultNexusHomeConfigBase,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusProjectConfig,
  type WorkComment,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkItemRef,
  type WorkTrackerProvider,
} from "../../src/index.js";

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

  it("delegates ready candidate acquisition to an injected claim authority", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-16", "Authority claim", {
        labels: ["automation"],
        description: "Issue body.",
      }),
    ]);
    const authorityCalls: string[] = [];
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate(input) {
        authorityCalls.push(
          `${input.tracker.id}:${input.candidate.id}:${input.owner.leaseToken}`,
        );
        expect(input.provider).toBe(provider);
        expect(input.ref).toMatchObject({
          provider: "github",
          id: "github-16",
        });
        expect(input.freshWorkItem).toMatchObject({
          id: "github-16",
          status: "ready",
        });

        return {
          status: "claimed",
          workItem: {
            ...input.freshWorkItem,
            status: "in_progress",
          },
        };
      },
    };

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      claimAuthority,
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
      },
      leaseDurationMs: 30 * 60 * 1000,
      leaseTokenFactory: () => "authority-token",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "claimed",
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
        leaseToken: "authority-token",
      },
      workItem: {
        id: "github-16",
        status: "in_progress",
      },
    });
    expect(authorityCalls).toEqual(["github:github-16:authority-token"]);
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("rejects an authority-backed claim when post-claim verification fails", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-19", "Authority claim verification", {
        labels: ["automation"],
        description: "Issue body.",
      }),
    ]);
    let authorityClaim: NexusWorkItemClaimAuthorityRecord | null = null;
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate(input) {
        authorityClaim = testAuthorityClaim(input);
        return {
          status: "claimed",
          workItem: {
            ...input.freshWorkItem,
            status: "in_progress",
          },
          authorityClaim,
        };
      },
      async verifyClaim() {
        return {
          status: "token_mismatch",
          claim: authorityClaim ?? undefined,
        };
      },
    };

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      claimAuthority,
      owner: {
        hostId: "host-a",
      },
      leaseTokenFactory: () => "authority-token",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "lost_race",
      reason: "verification_failed",
      authorityClaim: {
        authorityKind: "test-authority",
        fencingToken: 41,
      },
      owner: {
        leaseToken: "authority-token",
      },
    });
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("does not fall back to optimistic claims when PostgreSQL authority is configured", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const homePath = makeTempDir("dev-nexus-claim-home-");
    const config = projectConfig();
    const postgresAutomationConfig = {
      ...automationConfig(),
      workItemClaims: {
        ...automationConfig().workItemClaims,
        authority: {
          backend: "postgres" as const,
          postgres: {
            connectionProfileId: "shared-claims",
          },
        },
      },
    };
    saveProjectConfig(projectRoot, {
      ...config,
      automation: postgresAutomationConfig,
    });
    const provider = new ClaimMemoryProvider([
      workItem("github-17", "PostgreSQL authority only", {
        labels: ["automation"],
        description: "Issue body.",
      }),
    ]);

    await expect(
      claimNexusEligibleWorkItem({
        projectRoot,
        projectConfig: {
          ...config,
          automation: postgresAutomationConfig,
        },
        components: resolveProjectComponents(projectRoot, {
          ...config,
          automation: postgresAutomationConfig,
        }),
        automationConfig: postgresAutomationConfig,
        homePath,
        providerFactory: providerFactory(provider),
        owner: {
          hostId: "host-a",
        },
        now: () => "2026-05-20T10:00:00.000Z",
      }),
    ).rejects.toThrow(
      /PostgreSQL claim authority profile shared-claims was not found in DevNexus home config/,
    );
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
  });

  it("uses host-local PostgreSQL profiles with an optional node-postgres adapter", async () => {
    const root = makeTempDir("dev-nexus-claim-");
    const projectRoot = path.join(root, "workspace");
    const homePath = path.join(root, "home");
    const config = projectConfig();
    const postgresAutomationConfig = {
      ...automationConfig(),
      workItemClaims: {
        ...automationConfig().workItemClaims,
        authority: {
          backend: "postgres" as const,
          postgres: {
            connectionProfileId: "shared-claims",
          },
        },
      },
    };
    saveProjectConfig(projectRoot, {
      ...config,
      home: homePath,
      automation: postgresAutomationConfig,
    });
    saveNexusHomeConfigFile(
      homePath,
      createDefaultNexusHomeConfigBase(homePath, {
        claimAuthorityProfiles: [
          {
            id: "shared-claims",
            backend: "postgres",
            driver: "node_postgres",
            connectionStringEnv: "DEV_NEXUS_CLAIMS_DATABASE_URL",
            schema: "dev_nexus",
          },
        ],
      }),
      validateNexusHomeConfigBase,
    );
    const provider = new ClaimMemoryProvider([
      workItem("github-18", "PostgreSQL adapter claim", {
        labels: ["automation"],
        description: "Issue body.",
      }),
    ]);
    const nodePostgres = new ClaimNodePostgresHarness();

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: {
        ...config,
        home: homePath,
        automation: postgresAutomationConfig,
      },
      components: resolveProjectComponents(projectRoot, {
        ...config,
        home: homePath,
        automation: postgresAutomationConfig,
      }),
      automationConfig: postgresAutomationConfig,
      providerFactory: providerFactory(provider),
      owner: {
        hostId: "host-a",
      },
      leaseTokenFactory: () => "postgres-token-1",
      env: {
        DEV_NEXUS_CLAIMS_DATABASE_URL: "postgres://claims@example.invalid/db",
      },
      nodePostgresModule: nodePostgres.module,
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "claimed",
      authorityClaim: {
        authorityKind: "postgres",
        fencingToken: 1,
        owner: {
          leaseToken: "postgres-token-1",
        },
      },
      workItem: {
        id: "github-18",
        status: "in_progress",
      },
    });
    expect(nodePostgres.events).toEqual([
      "connect",
      "BEGIN",
      'SET LOCAL search_path TO "dev_nexus", public',
      "lock",
      "select",
      "upsert",
      "COMMIT",
      "end",
      "connect",
      "BEGIN",
      'SET LOCAL search_path TO "dev_nexus", public',
      "select",
      "COMMIT",
      "end",
    ]);
    expect(provider.updates).toEqual([
      {
        ref: {
          provider: "github",
          id: "github-18",
          externalRef: workItem("github-18").externalRef,
        },
        patch: {
          status: "in_progress",
        },
      },
    ]);
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

  it("delegates stale reclaim to an injected claim authority", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-");
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const provider = new ClaimMemoryProvider([
      workItem("github-17", "Authority reclaim", {
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
    const authorityCalls: string[] = [];
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not be used for stale reclaim");
      },
      async reclaimExpiredClaim(input) {
        authorityCalls.push(
          `${input.tracker.id}:${input.candidate.id}:` +
            `${input.previousOwner.leaseToken}:${input.owner.leaseToken}`,
        );
        expect(input.provider).toBe(provider);
        expect(input.ref).toMatchObject({
          provider: "github",
          id: "github-17",
        });
        expect(input.freshWorkItem).toMatchObject({
          id: "github-17",
          status: "in_progress",
        });

        return {
          status: "claimed",
          workItem: {
            ...input.freshWorkItem,
            status: "in_progress",
          },
        };
      },
    };

    const result = await claimNexusEligibleWorkItem({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      providerFactory: providerFactory(provider),
      claimAuthority,
      owner: { hostId: "host-a", agentId: "agent-a" },
      leaseTokenFactory: () => "new-token",
      staleClaimPolicy: "reclaim",
      now: () => "2026-05-20T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      status: "claimed",
      workItem: {
        id: "github-17",
        status: "in_progress",
      },
      owner: {
        hostId: "host-a",
        agentId: "agent-a",
        leaseToken: "new-token",
      },
      reclaimedFrom: {
        owner: {
          leaseToken: "expired-token",
        },
      },
    });
    expect(authorityCalls).toEqual([
      "github:github-17:expired-token:new-token",
    ]);
    expect(provider.updates).toEqual([]);
    expect(provider.comments).toEqual([]);
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

class ClaimNodePostgresHarness {
  readonly rows = new Map<string, NexusPostgresClaimAuthorityRow>();
  readonly events: string[] = [];
  private nextFencingToken = 1;
  readonly module: NexusNodePostgresModule = {
    Client: class {
      constructor(
        readonly config: object,
        private readonly harness: ClaimNodePostgresHarness =
          activeClaimNodePostgresHarness!,
      ) {}

      async connect(): Promise<void> {
        this.harness.events.push("connect");
      }

      async query(
        sql: string,
        params: readonly unknown[] = [],
      ): Promise<{ rows: unknown[] }> {
        return this.harness.query(sql, params);
      }

      async end(): Promise<void> {
        this.harness.events.push("end");
      }
    },
  };

  constructor() {
    activeClaimNodePostgresHarness = this;
  }

  async query(
    sql: string,
    params: readonly unknown[],
  ): Promise<{ rows: unknown[] }> {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      this.events.push(sql);
      return { rows: [] };
    }
    if (sql.startsWith("SET LOCAL search_path")) {
      this.events.push(sql);
      return { rows: [] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:lock")) {
      this.events.push("lock");
      return { rows: [] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:select")) {
      this.events.push("select");
      const row = this.rows.get(String(params[0]));
      return { rows: row ? [cloneClaimRow(row)] : [] };
    }
    if (sql.includes("dev-nexus-postgres-claim-authority:upsert")) {
      this.events.push("upsert");
      const input = params[0] as NexusPostgresClaimAuthorityRow;
      const row = {
        ...cloneClaimRow(input),
        fencingToken: this.nextFencingToken,
      };
      this.nextFencingToken += 1;
      this.rows.set(row.keyHash, row);
      return { rows: [cloneClaimRow(row)] };
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

let activeClaimNodePostgresHarness: ClaimNodePostgresHarness | null = null;

function cloneClaimRow(
  row: NexusPostgresClaimAuthorityRow,
): NexusPostgresClaimAuthorityRow {
  return {
    ...row,
    key: { ...row.key },
    owner: { ...row.owner },
    providerMirrorWarnings: [...row.providerMirrorWarnings],
    ...(row.reclaimedFrom ? { reclaimedFrom: { ...row.reclaimedFrom } } : {}),
  };
}

function testAuthorityClaim(
  input: NexusWorkItemClaimAuthorityClaimCandidateOptions,
): NexusWorkItemClaimAuthorityRecord {
  return {
    authorityKind: "test-authority",
    key: {
      projectId: input.projectId,
      componentId: input.candidate.componentId,
      trackerId: input.tracker.id,
      provider: input.ref.provider ?? input.candidate.provider,
      workItemId: input.ref.id ?? input.candidate.id,
      ...(input.ref.externalRef?.repositoryOwner
        ? { repositoryOwner: input.ref.externalRef.repositoryOwner }
        : {}),
      ...(input.ref.externalRef?.repositoryName
        ? { repositoryName: input.ref.externalRef.repositoryName }
        : {}),
      ...(input.ref.externalRef?.itemNumber
        ? { itemNumber: input.ref.externalRef.itemNumber }
        : {}),
    },
    owner: input.owner,
    fencingToken: 41,
    state: "active",
    claimedAt: input.owner.claimedAt,
    expiresAt: input.owner.expiresAt,
    lastHeartbeatAt: input.now.toISOString(),
  };
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
