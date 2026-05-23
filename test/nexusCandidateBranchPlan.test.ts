import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultNexusAutomationConfig } from "../src/nexusAutomationConfig.js";
import { defaultNexusReleaseTrainCiTierPolicy } from "../src/nexusCiTierPolicy.js";
import {
  buildNexusCandidateBranchPlan,
} from "../src/nexusCandidateBranchPlan.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "../src/nexusProjectConfig.js";
import {
  nexusWorktreeLeaseKind,
  writeNexusWorktreeLeaseStore,
  type NexusWorktreeLeaseRecord,
  type NexusWorktreeLeaseStatus,
} from "../src/nexusWorktreeLease.js";

type VersionConfig = NonNullable<NexusProjectConfig["versionPlanning"]>["versions"][number];
type ScopeEntry = VersionConfig["scope"][number];

const tempDirs: string[] = [];
const now = "2026-05-21T10:00:00.000Z";
const recent = "2026-05-21T09:55:00.000Z";
const old = "2026-05-19T09:55:00.000Z";

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

describe("candidate branch planning", () => {
  it("reports wait when there is no candidate scope", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      versionId: "0.2.0",
      now,
    });

    expect(plan.summary).toMatchObject({
      selectedVersionId: null,
      includedCount: 0,
      deferredCount: 0,
      excludedCount: 0,
      blockedCount: 0,
    });
    expect(plan.nextAction).toBe("wait");
    expect(plan.mutatesSource).toBe(false);
  });

  it("plans an all-ready version candidate without mutating branches", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-120",
        workItemId: "github-120",
        branchName: "codex/release-train-readiness",
        changedAreas: ["src/nexusReleaseTrainReadiness.ts"],
      }),
      lease({
        id: "lease-121",
        workItemId: "github-121",
        branchName: "codex/candidate-plan",
        changedAreas: ["src/nexusCandidateBranchPlan.ts"],
      }),
    ]);

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      versionId: "0.2.0",
      now,
    });

    expect(plan.selectedVersion).toMatchObject({
      id: "0.2.0",
      targetBranch: "main",
    });
    expect(plan.branches).toEqual({
      integration: "integration/0.2.0",
      candidate: "candidate/0.2.0",
    });
    expect(plan.summary).toMatchObject({
      includedCount: 2,
      deferredCount: 0,
      blockedCount: 0,
      overlapCount: 0,
    });
    expect(plan.included.map((item) => item.workItemId)).toEqual([
      "github-120",
      "github-121",
    ]);
    expect(plan.candidateCiTier).toMatchObject({
      tier: {
        id: "candidate_matrix",
      },
    });
    expect(plan.nextAction).toBe("create_integration_branch");
  });

  it("keeps version planning optional for unscoped candidate batches", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, {
      ...projectConfig(),
      versionPlanning: undefined,
    });
    writeLeases(projectRoot, [
      lease({
        id: "lease-unscoped",
        workItemId: "github-quick",
        branchName: "codex/quick",
      }),
    ]);

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      now,
    });

    expect(plan.selectedVersion).toEqual({
      id: null,
      objective: null,
      targetBranch: null,
    });
    expect(plan.branches).toEqual({
      integration: "integration/manual",
      candidate: "candidate/manual",
    });
    expect(plan.summary).toMatchObject({
      includedCount: 1,
      excludedCount: 0,
    });
    expect(plan.nextAction).toBe("create_integration_branch");
  });

  it("plans partial ready scope with deferred work left out of the batch", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig({
      versionPlanning: {
        versions: [
          versionConfig("0.2.0", [
            scope("dev-nexus", "github-120"),
            scope("dev-nexus", "github-121", "stretch"),
            scope("dev-nexus", "github-122", "deferred"),
          ]),
        ],
      },
    }));
    writeLeases(projectRoot, [
      lease({ id: "lease-120", workItemId: "github-120" }),
      lease({ id: "lease-121", workItemId: "github-121" }),
      lease({ id: "lease-122", workItemId: "github-122" }),
    ]);

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      versionId: "0.2.0",
      now,
    });

    expect(plan.included.map((item) => item.workItemId)).toEqual(["github-120"]);
    expect(plan.deferred.map((item) => item.workItemId)).toEqual([
      "github-121",
      "github-122",
    ]);
    expect(plan.nextAction).toBe("create_integration_branch");
  });

  it("reports blocked and verification-needed work without creating a candidate action", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-blocked",
        workItemId: "github-120",
        status: "blocked",
      }),
      lease({
        id: "lease-dirty",
        workItemId: "github-121",
        dirty: true,
        pushed: false,
      }),
    ]);

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      versionId: "0.2.0",
      now,
    });

    expect(plan.summary).toMatchObject({
      includedCount: 0,
      blockedCount: 2,
    });
    expect(plan.blocked.map((item) => item.candidateEligibility)).toEqual([
      "blocked",
      "needs_verification",
    ]);
    expect(plan.nextAction).toBe("verify");
  });

  it("asks for a human decision when stale handoffs are the only candidate input", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      versionId: "0.2.0",
      now,
      handoffs: [
        {
          id: "handoff-stale",
          componentId: "dev-nexus",
          workItemId: "github-120",
          branchName: "codex/stale",
          status: "ready",
          stale: true,
          headCommit: "abc123",
          upstream: "origin/codex/stale",
          pushed: true,
        },
      ],
    });

    expect(plan.summary).toMatchObject({
      includedCount: 0,
      blockedCount: 1,
    });
    expect(plan.blocked[0]).toMatchObject({
      candidateEligibility: "needs_human",
      reasons: ["source readiness is stale"],
    });
    expect(plan.nextAction).toBe("request_human_decision");
  });

  it("plans cross-component candidates and reports changed-area overlap", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig({
      components: [
        componentConfig("dev-nexus", "DevNexus"),
        componentConfig("dev-nexus-typescript", "DevNexus TypeScript"),
      ],
      versionPlanning: {
        versions: [
          versionConfig("0.2.0", [
            scope("dev-nexus", "github-120"),
            scope("dev-nexus-typescript", "github-200"),
          ]),
        ],
      },
    }));
    writeLeases(projectRoot, [
      lease({
        id: "lease-core",
        componentId: "dev-nexus",
        workItemId: "github-120",
        branchName: "codex/core",
        changedAreas: ["src/shared.ts"],
      }),
      lease({
        id: "lease-plugin",
        componentId: "dev-nexus-typescript",
        workItemId: "github-200",
        branchName: "codex/plugin",
        changedAreas: ["src/shared.ts"],
      }),
    ]);

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      versionId: "0.2.0",
      now,
    });

    expect(plan.included.map((item) => item.componentId)).toEqual([
      "dev-nexus",
      "dev-nexus-typescript",
    ]);
    expect(plan.changedAreaOverlaps).toEqual([
      {
        changedArea: "src/shared.ts",
        workItemIds: ["github-120", "github-200"],
        branches: ["codex/core", "codex/plugin"],
      },
    ]);
    expect(plan.nextAction).toBe("request_human_decision");
  });

  it("asks for a version when multiple version groups are eligible", () => {
    const projectRoot = makeTempDir("dev-nexus-candidate-plan-");
    saveProjectConfig(projectRoot, projectConfig({
      versionPlanning: {
        versions: [
          versionConfig("0.2.0", [scope("dev-nexus", "github-120")]),
          versionConfig("0.3.0", [scope("dev-nexus", "github-121")]),
        ],
      },
    }));
    writeLeases(projectRoot, [
      lease({ id: "lease-120", workItemId: "github-120" }),
      lease({ id: "lease-121", workItemId: "github-121" }),
    ]);

    const plan = buildNexusCandidateBranchPlan({
      projectRoot,
      now,
    });

    expect(plan.summary).toMatchObject({
      selectedVersionId: null,
      includedCount: 0,
      excludedCount: 2,
    });
    expect(plan.nextAction).toBe("request_human_decision");
    expect(plan.warnings).toContain(
      "Multiple version groups have eligible branches; pass versionId or --version before planning a candidate branch.",
    );
  });
});

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "candidate-plan-demo",
    name: "Candidate Plan Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [componentConfig("dev-nexus", "DevNexus")],
    worktreesRoot: "worktrees",
    automation: {
      ...defaultNexusAutomationConfig,
      verification: {
        ...defaultNexusAutomationConfig.verification,
        ciTiers: defaultNexusReleaseTrainCiTierPolicy,
      },
    },
    versionPlanning: {
      versions: [
        versionConfig("0.2.0", [
          scope("dev-nexus", "github-120"),
          scope("dev-nexus", "github-121"),
        ]),
      ],
    },
    ...overrides,
  };
}

function componentConfig(id: string, name: string): NexusProjectConfig["components"][number] {
  return {
    id,
    name,
    kind: "git",
    role: id === "dev-nexus" ? "primary" : "dependency",
    remoteUrl: `git@example.invalid:demo/${id}.git`,
    defaultBranch: "main",
    sourceRoot: `components/${id}`,
    relationships: [],
  };
}

function versionConfig(id: string, scopes: ScopeEntry[]): VersionConfig {
  return {
    id,
    objective: `Ship ${id}.`,
    owningComponents: ["dev-nexus"],
    targetBranch: "main",
    scope: scopes,
    readinessGates: [],
    releasePolicy: {
      tags: "none",
      packages: "none",
      providerRelease: "none",
      releaseNotes: "none",
      changelog: "none",
    },
  };
}

function scope(
  componentId: string,
  workItemId: string,
  status: ScopeEntry["status"] = "committed",
): ScopeEntry {
  return {
    kind: "work_item",
    status,
    componentId,
    trackerId: null,
    workItemId,
  };
}

function writeLeases(projectRoot: string, leases: NexusWorktreeLeaseRecord[]): void {
  writeNexusWorktreeLeaseStore(projectRoot, {
    version: 1,
    updatedAt: recent,
    leases,
  });
}

function lease(options: {
  id: string;
  componentId?: string;
  workItemId: string;
  branchName?: string;
  status?: NexusWorktreeLeaseStatus;
  lastSeenAt?: string;
  dirty?: boolean | null;
  pushed?: boolean | null;
  changedAreas?: string[];
}): NexusWorktreeLeaseRecord {
  const componentId = options.componentId ?? "dev-nexus";
  const branchName = options.branchName ?? `codex/${options.workItemId}`;
  return {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id: options.id,
    projectId: "candidate-plan-demo",
    scope: {
      kind: "component",
      componentId,
    },
    hostId: "host-1",
    agentId: null,
    workItemId: options.workItemId,
    branchName,
    baseRef: "main",
    worktree: {
      kind: "component_worktree",
      base: "componentWorktreesRoot",
      componentId,
      relativePath: branchName.replace(/\//gu, "-"),
    },
    writeScope: options.changedAreas ?? ["src/example.ts"],
    status: options.status ?? "ready",
    createdAt: recent,
    lastSeenAt: options.lastSeenAt ?? recent,
    updatedAt: options.lastSeenAt ?? recent,
    refreshCount: 0,
    lastObservedHeadCommit: "abc123",
    dirty: options.dirty ?? false,
    pushed: options.pushed ?? true,
    git: {
      repository: {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId,
        relativePath: branchName.replace(/\//gu, "-"),
      },
      upstream: `origin/${branchName}`,
      ahead: options.pushed === false ? 1 : 0,
      behind: 0,
      stagedCount: options.dirty ? 1 : 0,
      unstagedCount: 0,
      untrackedCount: 0,
      warnings: [],
    },
    notes: [],
  };
}
