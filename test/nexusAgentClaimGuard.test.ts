import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  heartbeatNexusAgentClaim,
  saveProjectConfig,
  verifyNexusAgentClaimForMutation,
  type NexusProjectConfig,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityRecord,
} from "../src/index.js";

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

describe("agent claim guard", () => {
  it("verifies authority-backed launch claims before guarded mutations", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-guard-");
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = testAuthorityClaim();
    const contextFile = writeAgentContext(projectRoot, authorityClaim);
    const verifiedClaims: string[] = [];
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async verifyClaim(input) {
        verifiedClaims.push(`${input.key.workItemId}:${input.leaseToken}`);
        return {
          status: "verified",
          claim: authorityClaim,
        };
      },
    };

    await expect(
      verifyNexusAgentClaimForMutation({
        projectRoot,
        componentId: "primary",
        workItemId: "local-1",
        env: agentEnv(contextFile),
        claimAuthority,
        now: () => "2026-05-23T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "verified",
      authorityClaim: {
        authorityKind: "test-authority",
        fencingToken: 9,
      },
    });
    expect(verifiedClaims).toEqual(["local-1:lease-1"]);
  });

  it("blocks guarded mutations when launch claim verification fails", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-guard-");
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = testAuthorityClaim();
    const contextFile = writeAgentContext(projectRoot, authorityClaim);
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async verifyClaim() {
        return {
          status: "token_mismatch",
          claim: authorityClaim,
        };
      },
    };

    await expect(
      verifyNexusAgentClaimForMutation({
        projectRoot,
        componentId: "primary",
        workItemId: "local-1",
        env: agentEnv(contextFile),
        claimAuthority,
        now: () => "2026-05-23T10:00:00.000Z",
      }),
    ).rejects.toThrow(/claim verification failed before mutation: token_mismatch/);
  });

  it("heartbeats authority-backed launch claims for long-running agents", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-heartbeat-");
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = testAuthorityClaim();
    const contextFile = writeAgentContext(projectRoot, authorityClaim);
    const heartbeats: Array<{
      workItemId: string;
      leaseToken: string;
      leaseDurationMs: number;
      now: string;
    }> = [];
    const heartbeatClaim: NexusWorkItemClaimAuthorityRecord = {
      ...authorityClaim,
      expiresAt: "2026-05-23T11:00:00.000Z",
      lastHeartbeatAt: "2026-05-23T10:00:00.000Z",
      owner: {
        ...authorityClaim.owner,
        expiresAt: "2026-05-23T11:00:00.000Z",
      },
    };
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async heartbeatClaim(input) {
        heartbeats.push({
          workItemId: input.key.workItemId,
          leaseToken: input.leaseToken,
          leaseDurationMs: input.leaseDurationMs,
          now: input.now.toISOString(),
        });
        return {
          status: "heartbeat",
          claim: heartbeatClaim,
        };
      },
    };

    await expect(
      heartbeatNexusAgentClaim({
        projectRoot,
        componentId: "primary",
        workItemId: "local-1",
        env: agentEnv(contextFile),
        claimAuthority,
        leaseDurationMs: 30 * 60 * 1000,
        now: () => "2026-05-23T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "heartbeat",
      authorityClaim: {
        expiresAt: "2026-05-23T11:00:00.000Z",
        lastHeartbeatAt: "2026-05-23T10:00:00.000Z",
      },
    });
    expect(heartbeats).toEqual([
      {
        workItemId: "local-1",
        leaseToken: "lease-1",
        leaseDurationMs: 30 * 60 * 1000,
        now: "2026-05-23T10:00:00.000Z",
      },
    ]);
  });

  it("blocks claim heartbeat when the authority rejects the lease token", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-heartbeat-rejected-");
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = testAuthorityClaim();
    const contextFile = writeAgentContext(projectRoot, authorityClaim);
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async heartbeatClaim() {
        return {
          status: "rejected",
          reason: "token_mismatch",
          claim: authorityClaim,
        };
      },
    };

    await expect(
      heartbeatNexusAgentClaim({
        projectRoot,
        env: agentEnv(contextFile),
        claimAuthority,
        now: () => "2026-05-23T10:00:00.000Z",
      }),
    ).rejects.toThrow(/claim heartbeat failed: token_mismatch/);
  });

  it("blocks guarded mutations for a different work item", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-guard-");
    saveProjectConfig(projectRoot, projectConfig());
    const contextFile = writeAgentContext(projectRoot, testAuthorityClaim());

    await expect(
      verifyNexusAgentClaimForMutation({
        projectRoot,
        componentId: "primary",
        workItemId: "local-2",
        env: agentEnv(contextFile),
        now: () => "2026-05-23T10:00:00.000Z",
      }),
    ).rejects.toThrow(/claimed work item local-1 does not match requested work item local-2/);
  });

  it("preserves optimistic launch behavior when no authority record is present", async () => {
    const projectRoot = makeTempDir("dev-nexus-claim-guard-");
    saveProjectConfig(projectRoot, projectConfig());
    const contextFile = writeAgentContext(projectRoot, null);

    await expect(
      verifyNexusAgentClaimForMutation({
        projectRoot,
        componentId: "primary",
        workItemId: "local-1",
        env: agentEnv(contextFile),
        now: () => "2026-05-23T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "not_applicable",
      reason: "current claim has no authority-backed fencing record",
    });
  });
});

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      mode: "agent_launch",
    },
  };
}

function writeAgentContext(
  projectRoot: string,
  authorityClaim: NexusWorkItemClaimAuthorityRecord | null,
): string {
  const contextFile = path.join(projectRoot, ".dev-nexus", "context.json");
  fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  fs.writeFileSync(
    contextFile,
    `${JSON.stringify({
      workItemClaim: {
        status: "claimed",
        componentId: "primary",
        trackerId: "default",
        workItemId: "local-1",
        logicalWorkItemId: "local-1",
        ...(authorityClaim ? { authorityClaim } : {}),
      },
    })}\n`,
    "utf8",
  );

  return contextFile;
}

function agentEnv(contextFile: string): NodeJS.ProcessEnv {
  return {
    DEV_NEXUS_AUTOMATION_MODE: "agent_launch",
    DEV_NEXUS_WORK_ITEM_CLAIM_STATUS: "claimed",
    DEV_NEXUS_AGENT_CONTEXT_FILE: contextFile,
  };
}

function testAuthorityClaim(): NexusWorkItemClaimAuthorityRecord {
  return {
    authorityKind: "test-authority",
    key: {
      projectId: "demo-project",
      componentId: "primary",
      trackerId: "default",
      provider: "local",
      workItemId: "local-1",
    },
    owner: {
      version: 1,
      hostId: "host-a",
      agentId: "agent-a",
      ownerId: null,
      leaseToken: "lease-1",
      claimedAt: "2026-05-23T09:00:00.000Z",
      expiresAt: "2026-05-23T10:30:00.000Z",
    },
    fencingToken: 9,
    state: "active",
    claimedAt: "2026-05-23T09:00:00.000Z",
    expiresAt: "2026-05-23T10:30:00.000Z",
    lastHeartbeatAt: "2026-05-23T09:00:00.000Z",
  };
}
