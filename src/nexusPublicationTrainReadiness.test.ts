import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultNexusAutomationConfig } from "./nexusAutomationConfig.js";
import { defaultNexusPublicationTrainCiTierPolicy } from "./nexusCiTierPolicy.js";
import {
  buildNexusPublicationTrainReadinessReport,
  type NexusPublicationTrainProviderEvidenceInput,
} from "./nexusPublicationTrainReadiness.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  nexusWorktreeLeaseKind,
  writeNexusWorktreeLeaseStore,
  type NexusWorktreeLeaseRecord,
  type NexusWorktreeLeaseStatus,
} from "./nexusWorktreeLease.js";

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

describe("publication train readiness", () => {
  it("reports wait when no ready branches are recorded", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      now,
    });

    expect(report.summary).toMatchObject({
      itemCount: 0,
      eligibleCount: 0,
    });
    expect(report.components).toEqual([]);
    expect(report.nextAction).toBe("wait");
  });

  it("groups one clean ready branch by component and version", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-ready",
        workItemId: "github-120",
        branchName: "codex/dev-nexus/github-120-publication-train-readiness",
        lastObservedHeadCommit: "abc123",
        pushed: true,
        upstream: "origin/codex/dev-nexus/github-120-publication-train-readiness",
      }),
    ]);

    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      now,
    });

    expect(report.summary).toMatchObject({
      itemCount: 1,
      readyCount: 1,
      eligibleCount: 1,
      missingEvidenceCount: 1,
    });
    expect(report.nextAction).toBe("create_candidate_branch");
    expect(report.components).toMatchObject([
      {
        componentId: "dev-nexus",
        itemCount: 1,
        eligibleCount: 1,
      },
    ]);
    expect(report.versions).toMatchObject([
      {
        versionId: "0.2.0",
        targetBranch: "main",
        itemCount: 1,
        eligibleCount: 1,
      },
    ]);
    expect(report.components[0]?.items[0]).toMatchObject({
      workItemId: "github-120",
      candidateBranchName: "candidate/0.2.0",
      candidateEligibility: "eligible",
      ciTier: {
        tier: {
          id: "candidate_matrix",
        },
        requiredChecks: [
          "Node 24 check (ubuntu-latest)",
          "Node 24 check (windows-latest)",
          "Node 24 check (macos-latest)",
        ],
      },
      evidence: {
        status: "unavailable",
        message: "provider check evidence is unavailable",
      },
    });
  });

  it("groups ready branches across multiple components and versions", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
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
          versionConfig("0.3.0", [
            scope("dev-nexus", "github-121"),
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
        lastObservedHeadCommit: "abc123",
        pushed: true,
        upstream: "origin/codex/core",
      }),
      lease({
        id: "lease-plugin",
        componentId: "dev-nexus-typescript",
        workItemId: "github-200",
        branchName: "codex/plugin",
        lastObservedHeadCommit: "def456",
        pushed: true,
        upstream: "origin/codex/plugin",
      }),
      lease({
        id: "lease-next",
        componentId: "dev-nexus",
        workItemId: "github-121",
        branchName: "codex/next",
        lastObservedHeadCommit: "ghi789",
        pushed: true,
        upstream: "origin/codex/next",
      }),
    ]);

    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      now,
    });

    expect(report.summary.eligibleCount).toBe(3);
    expect(report.components.map((component) => component.componentId)).toEqual([
      "dev-nexus",
      "dev-nexus-typescript",
    ]);
    expect(report.versions.map((version) => version.versionId)).toEqual([
      "0.2.0",
      "0.3.0",
    ]);
    expect(report.versions[0]).toMatchObject({
      versionId: "0.2.0",
      itemCount: 2,
      eligibleCount: 2,
    });
  });

  it("surfaces stale, blocked, dirty, unpushed, missing-head, and missing-upstream states", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-stale",
        workItemId: "github-120",
        branchName: "codex/stale",
        lastSeenAt: old,
        lastObservedHeadCommit: "abc123",
        upstream: "origin/codex/stale",
        pushed: true,
      }),
      lease({
        id: "lease-blocked",
        workItemId: "github-120",
        branchName: "codex/blocked",
        status: "blocked",
        lastObservedHeadCommit: "abc123",
        upstream: "origin/codex/blocked",
        pushed: true,
      }),
      lease({
        id: "lease-dirty",
        workItemId: "github-120",
        branchName: "codex/dirty",
        lastObservedHeadCommit: null,
        upstream: null,
        dirty: true,
        pushed: false,
      }),
    ]);

    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      now,
    });

    expect(report.summary).toMatchObject({
      staleCount: 1,
      blockedCount: 1,
      dirtyCount: 1,
      unpushedCount: 1,
      missingHeadCount: 1,
      missingUpstreamCount: 1,
      needsVerificationCount: 1,
      needsHumanCount: 1,
    });
    expect(report.components[0]?.items.map((item) => item.candidateEligibility))
      .toEqual(["needs_human", "blocked", "needs_verification"]);
    expect(report.nextAction).toBe("verify");
  });

  it("reports provider evidence status when checks are supplied", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-ready",
        workItemId: "github-120",
        branchName: "codex/ready",
        lastObservedHeadCommit: "abc123",
        pushed: true,
        upstream: "origin/codex/ready",
      }),
    ]);

    const providerEvidence: NexusPublicationTrainProviderEvidenceInput[] = [
      {
        branchName: "candidate/0.2.0",
        checks: [
          { name: "Node 24 check (ubuntu-latest)", bucket: "pass" },
          { name: "Node 24 check (windows-latest)", bucket: "pending" },
          { name: "Node 24 check (macos-latest)", bucket: "pass" },
        ],
      },
    ];
    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      providerEvidence,
      now,
    });

    expect(report.components[0]?.items[0]?.evidence).toMatchObject({
      branchName: "candidate/0.2.0",
      status: "pending",
      message: "one or more required checks are pending",
    });
  });

  it("accepts normalized provider evidence metadata from generic providers", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-ready",
        workItemId: "github-120",
        branchName: "codex/ready",
        lastObservedHeadCommit: "abc123",
        pushed: true,
        upstream: "origin/codex/ready",
      }),
    ]);

    const providerEvidence: NexusPublicationTrainProviderEvidenceInput[] = [
      {
        provider: "generic",
        sourceKind: "candidate_branch",
        headBranch: "candidate/0.2.0",
        headSha: "abc123",
        targetBranch: "main",
        intendedCiTier: "candidate_matrix",
        mergeability: true,
        branchPolicy: "clear",
        checks: [
          { name: "Node 24 check (ubuntu-latest)", bucket: "pass" },
          { name: "Node 24 check (windows-latest)", bucket: "pass" },
          { name: "Node 24 check (macos-latest)", bucket: "pass" },
        ],
      },
    ];
    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      providerEvidence,
      now,
    });

    expect(report.components[0]?.items[0]?.evidence).toMatchObject({
      branchName: "candidate/0.2.0",
      headCommit: "abc123",
      provider: "generic",
      providerSourceKind: "candidate_branch",
      targetBranch: "main",
      intendedCiTier: "candidate_matrix",
      mergeability: "mergeable",
      branchPolicy: "clear",
      status: "success",
      message: "all required checks are successful",
    });
  });

  it("marks high-cost candidate tiers as waiting when CI budget is exhausted", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());
    writeLeases(projectRoot, [
      lease({
        id: "lease-ready",
        workItemId: "github-120",
        branchName: "codex/ready",
        lastObservedHeadCommit: "abc123",
        pushed: true,
        upstream: "origin/codex/ready",
      }),
    ]);

    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      fullMatrixBudgetAvailable: false,
      now,
    });

    expect(report.summary).toMatchObject({
      eligibleCount: 0,
      waitCount: 1,
      budgetLimitedCount: 1,
    });
    expect(report.components[0]?.items[0]).toMatchObject({
      candidateEligibility: "wait",
      reasons: ["full matrix CI budget is exhausted"],
      ciTier: {
        tier: {
          id: "remote_smoke",
        },
        budgetLimited: true,
      },
    });
    expect(report.nextAction).toBe("wait");
  });

  it("uses handoff inputs when lease data is unavailable", () => {
    const projectRoot = makeTempDir("dev-nexus-train-readiness-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusPublicationTrainReadinessReport({
      projectRoot,
      now,
      handoffs: [
        {
          id: "handoff-ready",
          componentId: "dev-nexus",
          workItemId: "github-120",
          branchName: "codex/handoff",
          status: "ready",
          headCommit: "abc123",
          upstream: "origin/codex/handoff",
          pushed: true,
          changedAreas: ["src/nexusPublicationTrainReadiness.ts"],
        },
      ],
    });

    expect(report.summary).toMatchObject({
      itemCount: 1,
      eligibleCount: 1,
    });
    expect(report.components[0]?.items[0]).toMatchObject({
      sourceKind: "handoff",
      sourceId: "handoff-ready",
      changedAreas: ["src/nexusPublicationTrainReadiness.ts"],
    });
  });
});

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "train-readiness-demo",
    name: "Train Readiness Demo",
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
        ciTiers: defaultNexusPublicationTrainCiTierPolicy,
      },
    },
    versionPlanning: {
      versions: [
        versionConfig("0.2.0", [scope("dev-nexus", "github-120")]),
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

function versionConfig(
  id: string,
  scopes: NexusProjectConfig["versionPlanning"]["versions"][number]["scope"],
): NexusProjectConfig["versionPlanning"]["versions"][number] {
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
): NexusProjectConfig["versionPlanning"]["versions"][number]["scope"][number] {
  return {
    kind: "work_item",
    status: "committed",
    componentId,
    trackerId: null,
    workItemId,
  };
}

function writeLeases(
  projectRoot: string,
  leases: NexusWorktreeLeaseRecord[],
): void {
  writeNexusWorktreeLeaseStore(projectRoot, {
    version: 1,
    updatedAt: recent,
    leases,
  });
}

function lease(options: {
  id: string;
  componentId?: string;
  workItemId?: string | null;
  branchName?: string | null;
  status?: NexusWorktreeLeaseStatus;
  lastSeenAt?: string;
  lastObservedHeadCommit?: string | null;
  dirty?: boolean | null;
  pushed?: boolean | null;
  upstream?: string | null;
}): NexusWorktreeLeaseRecord {
  const componentId = options.componentId ?? "dev-nexus";
  const branchName = options.branchName ?? "codex/branch";
  const upstream =
    options.upstream === undefined ? `origin/${branchName}` : options.upstream;
  return {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id: options.id,
    projectId: "train-readiness-demo",
    scope: {
      kind: "component",
      componentId,
    },
    hostId: "host-1",
    agentId: null,
    workItemId: options.workItemId ?? null,
    branchName,
    baseRef: "main",
    worktree: {
      kind: "component_worktree",
      base: "componentWorktreesRoot",
      componentId,
      relativePath: branchName.replace(/\//gu, "-"),
    },
    writeScope: ["src/example.ts"],
    status: options.status ?? "ready",
    createdAt: recent,
    lastSeenAt: options.lastSeenAt ?? recent,
    updatedAt: options.lastSeenAt ?? recent,
    refreshCount: 0,
    lastObservedHeadCommit:
      options.lastObservedHeadCommit === undefined
        ? "abc123"
        : options.lastObservedHeadCommit,
    dirty: options.dirty ?? false,
    pushed: options.pushed ?? true,
    git: {
      repository: {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId,
        relativePath: branchName.replace(/\//gu, "-"),
      },
      upstream,
      ahead: options.pushed === false ? 1 : 0,
      behind: 0,
      stagedCount: options.dirty ? 1 : 0,
      unstagedCount: 0,
      untrackedCount: 0,
      warnings: upstream ? [] : ["Current branch has no upstream configured."],
    },
    notes: [],
  };
}
