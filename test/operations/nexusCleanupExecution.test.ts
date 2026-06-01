import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOrRefreshNexusWorktreeLease,
  defaultNexusAutomationConfig,
  executeNexusCleanup,
  NexusCleanupExecutionError,
  readNexusWorktreeLeaseStore,
  saveProjectConfig,
  selectNexusCleanupCandidate,
  type GitCommandResult,
  type GitRunner,
  type NexusAuthorityConfig,
  type NexusProjectConfig,
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

describe("nexus cleanup execution", () => {
  it("removes a safe generated worktree, deletes its merged branch, and records lease cleanup", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "merged");
    fs.mkdirSync(worktreePath, { recursive: true });
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/merged",
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "merged123", dirty: false, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:worktree:merged",
      gitRunner: cleanupGitRunner(fixture, calls, {
        branches: ["codex/primary/merged"],
        worktrees: [
          { path: worktreePath, branch: "codex/primary/merged", head: "merged123" },
        ],
        mergedRefs: ["codex/primary/merged"],
        upstreams: {
          "codex/primary/merged": "origin/codex/primary/merged",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      mutatesSource: true,
      forced: false,
      candidate: {
        id: "component:primary:worktree:merged",
        safeToDelete: true,
      },
      actions: {
        removedWorktree: worktreePath,
        deletedBranch: "codex/primary/merged",
        updatedLeaseIds: [lease.id],
      },
    });
    expect(cleanupCommands(calls)).toEqual([
      { cwd: fixture.sourceRoot, args: ["worktree", "remove", worktreePath] },
      { cwd: fixture.sourceRoot, args: ["branch", "-d", "codex/primary/merged"] },
    ]);
    expect(readNexusWorktreeLeaseStore(fixture.projectRoot).leases[0])
      .toMatchObject({
        id: lease.id,
        status: "merged",
        updatedAt: "2026-05-18T10:00:00.000Z",
        notes: expect.arrayContaining([
          "Cleaned up by DevNexus cleanup execution: component:primary:worktree:merged.",
        ]),
      });
  });

  it("removes a safe generated workspace-meta worktree by default", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(
      fixture.projectRoot,
      "worktrees",
      "cleanup-demo",
      "metadata-merged",
    );
    const branchName = "codex/cleanup-demo/metadata-merged";
    fs.mkdirSync(worktreePath, { recursive: true });
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      projectMeta: true,
      branchName,
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "metadataMerged123", dirty: false, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      candidateId: "project_meta:project:worktree:metadata-merged",
      gitRunner: cleanupGitRunner(fixture, calls, {
        projectBranches: [branchName],
        projectMetaWorktrees: [
          { path: worktreePath, branch: branchName, head: "metadataMerged123" },
        ],
        mergedRefs: [branchName],
        upstreams: {
          [branchName]: `origin/${branchName}`,
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      mutatesSource: true,
      candidate: {
        id: "project_meta:project:worktree:metadata-merged",
        scope: "project_meta",
        safeToDelete: true,
      },
      actions: {
        removedWorktree: worktreePath,
        deletedBranch: branchName,
        updatedLeaseIds: [lease.id],
      },
    });
    expect(cleanupCommands(calls)).toEqual([
      { cwd: fixture.projectRoot, args: ["worktree", "remove", worktreePath] },
      { cwd: fixture.projectRoot, args: ["branch", "-d", branchName] },
    ]);
    expect(readNexusWorktreeLeaseStore(fixture.projectRoot).leases[0])
      .toMatchObject({
        id: lease.id,
        status: "merged",
        updatedAt: "2026-05-18T10:00:00.000Z",
      });
  });

  it("finalizes a safe lease-only candidate when the branch is already absent", () => {
    const fixture = initCleanupFixture();
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "fix/primary/orphan-merged",
      worktreePath: path.join(fixture.worktreesRoot, "orphan-merged"),
      status: "working",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "orphanMerged123", dirty: false, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:branch:fix/primary/orphan-merged",
      gitRunner: cleanupGitRunner(fixture, calls, {
        missingRefs: ["fix/primary/orphan-merged"],
        mergedRefs: ["orphanMerged123"],
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      candidate: {
        id: "component:primary:branch:fix/primary/orphan-merged",
        safeToDelete: true,
      },
      actions: {
        removedWorktree: null,
        deletedBranch: null,
        updatedLeaseIds: [lease.id],
        skipped: [
          {
            candidateId: "component:primary:branch:fix/primary/orphan-merged",
            action: "branch_delete",
            reason: "Branch is already absent from the local repository.",
          },
        ],
      },
    });
    expect(cleanupCommands(calls)).toEqual([]);
    expect(readNexusWorktreeLeaseStore(fixture.projectRoot).leases[0])
      .toMatchObject({
        id: lease.id,
        status: "merged",
        updatedAt: "2026-05-18T10:00:00.000Z",
      });
  });

  it("finalizes a stale duplicate lease when another scope already finalized the same head", () => {
    const fixture = initCleanupFixture();
    const metadataWorktree = path.join(
      fixture.projectRoot,
      "worktrees",
      "metadata",
      "duplicate",
    );
    const mergedLease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      projectMeta: true,
      branchName: "codex/metadata/duplicate",
      worktreePath: metadataWorktree,
      status: "merged",
      now: () => "2026-05-18T09:55:00.000Z",
      gitFacts: { headCommit: "metadataHead123", dirty: false, pushed: true },
    });
    const duplicateLease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/metadata/duplicate",
      worktreePath: metadataWorktree,
      status: "ready",
      now: () => "2026-05-16T09:55:00.000Z",
      gitFacts: { headCommit: "metadataHead123", dirty: false, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:branch:codex/metadata/duplicate",
      gitRunner: cleanupGitRunner(fixture, calls, {
        missingRefs: ["codex/metadata/duplicate"],
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      candidate: {
        id: "component:primary:branch:codex/metadata/duplicate",
        safeToDelete: true,
      },
      actions: {
        removedWorktree: null,
        deletedBranch: null,
        updatedLeaseIds: [duplicateLease.id],
        skipped: [
          {
            candidateId: "component:primary:branch:codex/metadata/duplicate",
            action: "branch_delete",
            reason: "Branch is already absent from the local repository.",
          },
        ],
      },
    });
    expect(cleanupCommands(calls)).toEqual([]);
    expect(readNexusWorktreeLeaseStore(fixture.projectRoot).leases)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: mergedLease.id,
          status: "merged",
        }),
        expect.objectContaining({
          id: duplicateLease.id,
          status: "merged",
          updatedAt: "2026-05-18T10:00:00.000Z",
        }),
      ]));
  });

  it("refuses dirty or unpushed candidates without mutating git or lease state", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "dirty");
    fs.mkdirSync(worktreePath, { recursive: true });
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/dirty",
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "dirty123", dirty: true, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner = cleanupGitRunner(fixture, calls, {
      branches: ["codex/primary/dirty", "codex/primary/unpushed"],
      worktrees: [
        { path: worktreePath, branch: "codex/primary/dirty", head: "dirty123" },
      ],
      statuses: {
        [worktreePath]: " M src/file.ts\n",
      },
      mergedRefs: ["codex/primary/dirty"],
      upstreams: {
        "codex/primary/dirty": "origin/codex/primary/dirty",
        "codex/primary/unpushed": "origin/codex/primary/unpushed",
      },
      aheadBehind: {
        "codex/primary/unpushed": { ahead: 1, behind: 0 },
      },
    });

    expect(() =>
      executeNexusCleanup({
        projectRoot: fixture.projectRoot,
        componentId: "primary",
        candidateId: "component:primary:worktree:dirty",
        gitRunner,
        now: () => "2026-05-18T10:00:00.000Z",
      }),
    ).toThrow(NexusCleanupExecutionError);
    expect(() =>
      executeNexusCleanup({
        projectRoot: fixture.projectRoot,
        componentId: "primary",
        candidateId: "component:primary:branch:codex/primary/unpushed",
        gitRunner,
        now: () => "2026-05-18T10:00:00.000Z",
      }),
    ).toThrow(NexusCleanupExecutionError);

    expect(cleanupCommands(calls)).toEqual([]);
    expect(readNexusWorktreeLeaseStore(fixture.projectRoot).leases[0])
      .toMatchObject({
        id: lease.id,
        status: "merged",
        updatedAt: "2026-05-18T09:00:00.000Z",
      });
  });

  it("allows explicit forced cleanup with a reason and marks the lease abandoned", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "dirty");
    fs.mkdirSync(worktreePath, { recursive: true });
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/dirty",
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "dirty123", dirty: true, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:worktree:dirty",
      force: true,
      forceReason: "Human confirmed scratch work can be discarded.",
      gitRunner: cleanupGitRunner(fixture, calls, {
        branches: ["codex/primary/dirty"],
        worktrees: [
          { path: worktreePath, branch: "codex/primary/dirty", head: "dirty123" },
        ],
        statuses: {
          [worktreePath]: " M src/file.ts\n",
        },
        mergedRefs: ["codex/primary/dirty"],
        upstreams: {
          "codex/primary/dirty": "origin/codex/primary/dirty",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result.forced).toBe(true);
    expect(cleanupCommands(calls)).toEqual([
      {
        cwd: fixture.sourceRoot,
        args: ["worktree", "remove", "--force", worktreePath],
      },
      { cwd: fixture.sourceRoot, args: ["branch", "-D", "codex/primary/dirty"] },
    ]);
    expect(readNexusWorktreeLeaseStore(fixture.projectRoot).leases[0])
      .toMatchObject({
        id: lease.id,
        status: "abandoned",
        notes: expect.arrayContaining([
          "Forced cleanup reason: Human confirmed scratch work can be discarded.",
        ]),
      });
  });

  it("creates a rescue branch before force-cleaning an abandoned worktree when authority allows it", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "abandoned");
    fs.mkdirSync(worktreePath, { recursive: true });
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/abandoned",
      worktreePath,
      status: "abandoned",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "abandoned123", dirty: false, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:worktree:abandoned",
      force: true,
      forceReason: "Maintainer confirmed abandoned work can be cleaned after rescue.",
      rescue: {
        mode: "branch",
        branchName: "rescue/primary/abandoned",
        reason: "Preserve the abandoned head before cleanup.",
      },
      authority: {
        authority: cleanupAuthorityConfig("maintainer"),
        actor: {
          id: "maintainer",
          kind: "human",
        },
      },
      gitRunner: cleanupGitRunner(fixture, calls, {
        branches: ["codex/primary/abandoned"],
        worktrees: [
          {
            path: worktreePath,
            branch: "codex/primary/abandoned",
            head: "abandoned123",
          },
        ],
        upstreams: {
          "codex/primary/abandoned": "origin/codex/primary/abandoned",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      forced: true,
      rescue: {
        mode: "branch",
        createdBranch: "rescue/primary/abandoned",
        startPoint: "abandoned123",
      },
      authority: {
        worktreeDelete: {
          allowed: true,
          requestedAction: "worktree.delete",
        },
        branchDelete: {
          allowed: true,
          requestedAction: "git.branch.delete",
        },
        rescueBranch: {
          allowed: true,
          requestedAction: "git.branch.create",
        },
      },
      actions: {
        removedWorktree: worktreePath,
        deletedBranch: "codex/primary/abandoned",
        updatedLeaseIds: [lease.id],
      },
    });
    expect(cleanupCommands(calls)).toEqual([
      {
        cwd: fixture.sourceRoot,
        args: ["branch", "rescue/primary/abandoned", "abandoned123"],
      },
      {
        cwd: fixture.sourceRoot,
        args: ["worktree", "remove", "--force", worktreePath],
      },
      { cwd: fixture.sourceRoot, args: ["branch", "-D", "codex/primary/abandoned"] },
    ]);
  });

  it("refuses cleanup before mutation when effective authority does not allow deletion", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "merged");
    fs.mkdirSync(worktreePath, { recursive: true });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/merged",
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "merged123", dirty: false, pushed: true },
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    expect(() =>
      executeNexusCleanup({
        projectRoot: fixture.projectRoot,
        componentId: "primary",
        candidateId: "component:primary:worktree:merged",
        authority: {
          authority: cleanupAuthorityConfig("observer"),
          actor: {
            id: "observer",
            kind: "human",
          },
        },
        gitRunner: cleanupGitRunner(fixture, calls, {
          branches: ["codex/primary/merged"],
          worktrees: [
            { path: worktreePath, branch: "codex/primary/merged", head: "merged123" },
          ],
          mergedRefs: ["codex/primary/merged"],
          upstreams: {
            "codex/primary/merged": "origin/codex/primary/merged",
          },
        }),
      }),
    ).toThrow(/lacks action worktree\.delete/u);
    expect(cleanupCommands(calls)).toEqual([]);
  });

  it("refuses execution when a planned candidate snapshot is stale", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "merged");
    fs.mkdirSync(worktreePath, { recursive: true });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/merged",
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "old123", dirty: false, pushed: true },
    });
    const planned = selectNexusCleanupCandidate({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:worktree:merged",
      gitRunner: cleanupGitRunner(fixture, [], {
        branches: ["codex/primary/merged"],
        worktrees: [
          { path: worktreePath, branch: "codex/primary/merged", head: "old123" },
        ],
        mergedRefs: ["codex/primary/merged"],
        upstreams: {
          "codex/primary/merged": "origin/codex/primary/merged",
        },
      }),
    }).candidate;
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    expect(() =>
      executeNexusCleanup({
        projectRoot: fixture.projectRoot,
        componentId: "primary",
        candidateId: "component:primary:worktree:merged",
        plannedCandidate: planned,
        gitRunner: cleanupGitRunner(fixture, calls, {
          branches: ["codex/primary/merged"],
          worktrees: [
            { path: worktreePath, branch: "codex/primary/merged", head: "new123" },
          ],
          mergedRefs: ["codex/primary/merged"],
          upstreams: {
            "codex/primary/merged": "origin/codex/primary/merged",
          },
        }),
      }),
    ).toThrow(/stale cleanup plan/u);
    expect(cleanupCommands(calls)).toEqual([]);
  });

  it("treats a missing planned candidate as an idempotent already-clean rerun", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "merged");
    fs.mkdirSync(worktreePath, { recursive: true });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/merged",
      worktreePath,
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "merged123", dirty: false, pushed: true },
    });
    const planned = selectNexusCleanupCandidate({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:worktree:merged",
      gitRunner: cleanupGitRunner(fixture, [], {
        branches: ["codex/primary/merged"],
        worktrees: [
          { path: worktreePath, branch: "codex/primary/merged", head: "merged123" },
        ],
        mergedRefs: ["codex/primary/merged"],
        upstreams: {
          "codex/primary/merged": "origin/codex/primary/merged",
        },
      }),
    }).candidate;
    fs.rmSync(worktreePath, { recursive: true, force: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = executeNexusCleanup({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      candidateId: "component:primary:worktree:merged",
      plannedCandidate: planned,
      allowAlreadyClean: true,
      gitRunner: cleanupGitRunner(fixture, calls, {
        branches: [],
        worktrees: [],
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      candidate: {
        id: "component:primary:worktree:merged",
      },
      actions: {
        removedWorktree: null,
        deletedBranch: null,
        skipped: [
          {
            candidateId: "component:primary:worktree:merged",
            reason: "Candidate is absent from the recomputed cleanup plan.",
          },
        ],
      },
      recoveryGuidance: expect.arrayContaining([
        "No source mutation was needed; the planned candidate is already absent.",
      ]),
    });
    expect(cleanupCommands(calls)).toEqual([]);
  });
});

function initCleanupFixture() {
  const projectRoot = makeTempDir("dev-nexus-cleanup-execute-");
  const sourceRoot = path.join(projectRoot, "source");
  const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const config: NexusProjectConfig = {
    version: 1,
    id: "cleanup-demo",
    name: "Cleanup Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:cleanup/demo.git",
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        targetBranch: "main",
      },
    },
    components: [
      {
        id: "primary",
        name: "Primary",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:cleanup/primary.git",
        defaultBranch: "main",
        sourceRoot: "source",
        worktreesRoot: "worktrees/primary",
        publication: {
          ...defaultNexusAutomationConfig.publication,
          targetBranch: "main",
        },
        relationships: [],
      },
    ],
  };
  saveProjectConfig(projectRoot, config);
  return { projectRoot, sourceRoot, worktreesRoot };
}

function cleanupGitRunner(
  fixture: { projectRoot?: string; sourceRoot: string },
  calls: Array<{ args: string[]; cwd?: string }>,
  options: {
    branches?: string[];
    projectBranches?: string[];
    worktrees?: Array<{ path: string; branch: string | null; head: string }>;
    projectMetaWorktrees?: Array<{ path: string; branch: string | null; head: string }>;
    statuses?: Record<string, string>;
    targetExists?: boolean;
    mergedRefs?: string[];
    upstreams?: Record<string, string>;
    aheadBehind?: Record<string, { ahead: number; behind: number }>;
    missingRefs?: string[];
  } = {},
): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    const joined = argsArray.join(" ");
    const branchHeads = new Map<string, string>();
    for (const branch of options.branches ?? []) {
      branchHeads.set(branch, `${safeHead(branch)}123`);
    }
    for (const branch of options.projectBranches ?? []) {
      branchHeads.set(branch, `${safeHead(branch)}123`);
    }
    for (const worktree of options.worktrees ?? []) {
      if (worktree.branch) {
        branchHeads.set(worktree.branch, worktree.head);
      }
    }
    for (const worktree of options.projectMetaWorktrees ?? []) {
      if (worktree.branch) {
        branchHeads.set(worktree.branch, worktree.head);
      }
    }

    if (joined === "worktree list --porcelain") {
      const useProjectRepo = isProjectRepositoryCwd(fixture, cwd);
      const root = useProjectRepo ? fixture.projectRoot! : fixture.sourceRoot;
      const worktrees = useProjectRepo
        ? options.projectMetaWorktrees ?? []
        : options.worktrees ?? [];
      return gitResult(argsArray, [
        `worktree ${root}`,
        "HEAD target123",
        "branch refs/heads/main",
        "",
        ...worktrees.flatMap((worktree) => [
          `worktree ${worktree.path}`,
          `HEAD ${worktree.head}`,
          ...(worktree.branch ? [`branch refs/heads/${worktree.branch}`] : []),
          "",
        ]),
      ].join("\n"));
    }
    if (joined === "for-each-ref --format=%(refname:short) refs/heads/codex") {
      return gitResult(
        argsArray,
        (isProjectRepositoryCwd(fixture, cwd)
          ? options.projectBranches ?? []
          : options.branches ?? []
        ).join("\n"),
      );
    }
    if (joined === "rev-parse --verify main") {
      return options.targetExists === false
        ? gitResult(argsArray, "", 1)
        : gitResult(argsArray, "target123\n");
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--show-toplevel") {
      const allWorktrees = [
        ...(options.worktrees ?? []),
        ...(options.projectMetaWorktrees ?? []),
      ];
      const worktree = allWorktrees.find((entry) => samePath(entry.path, cwd ?? ""));
      if (worktree) {
        return gitResult(argsArray, `${worktree.path}\n`);
      }
      if (samePath(fixture.sourceRoot, cwd ?? "")) {
        return gitResult(argsArray, `${fixture.sourceRoot}\n`);
      }
      if (fixture.projectRoot && pathContainsOrSame(fixture.projectRoot, cwd ?? "")) {
        return gitResult(argsArray, `${fixture.projectRoot}\n`);
      }
      return gitResult(argsArray, "", 1);
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--is-inside-work-tree") {
      return gitResult(argsArray, "true\n");
    }
    if (argsArray[0] === "symbolic-ref" && argsArray[1] === "--short") {
      const worktree = [
        ...(options.worktrees ?? []),
        ...(options.projectMetaWorktrees ?? []),
      ].find((entry) => samePath(entry.path, cwd ?? ""));
      return worktree?.branch
        ? gitResult(argsArray, `${worktree.branch}\n`)
        : gitResult(argsArray, "", 1);
    }
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--abbrev-ref" &&
      argsArray[2] === "--symbolic-full-name"
    ) {
      const branch = argsArray[3]!.replace(/@\{u\}$/u, "");
      const upstream = options.upstreams?.[branch];
      return upstream ? gitResult(argsArray, `${upstream}\n`) : gitResult(argsArray, "", 1);
    }
    if (argsArray[0] === "rev-parse") {
      const ref = argsArray[1]!;
      if (options.missingRefs?.includes(ref)) {
        return gitResult(argsArray, "", 1);
      }
      return gitResult(argsArray, `${branchHeads.get(ref) ?? ref}\n`);
    }
    if (argsArray[0] === "status") {
      return gitResult(argsArray, options.statuses?.[cwd ?? ""] ?? "");
    }
    if (argsArray[0] === "rev-list") {
      const branch = argsArray[3]!.split("...")[0]!;
      const counts = options.aheadBehind?.[branch] ?? { ahead: 0, behind: 0 };
      return gitResult(argsArray, `${counts.ahead}\t${counts.behind}\n`);
    }
    if (argsArray[0] === "merge-base" && argsArray[1] === "--is-ancestor") {
      return (options.mergedRefs ?? []).includes(argsArray[2]!)
        ? gitResult(argsArray, "", 0)
        : gitResult(argsArray, "", 1);
    }

    return gitResult(argsArray, "", 0);
  };
}

function cleanupCommands(
  calls: Array<{ args: string[]; cwd?: string }>,
): Array<{ args: string[]; cwd?: string }> {
  return calls.filter(({ args }) =>
    args[0] === "branch" ||
    (args[0] === "worktree" && args[1] === "remove"),
  );
}

function isProjectRepositoryCwd(
  fixture: { projectRoot?: string; sourceRoot: string },
  cwd: string | undefined,
): boolean {
  return Boolean(fixture.projectRoot && samePath(fixture.projectRoot, cwd ?? ""));
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

function pathContainsOrSame(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function safeHead(branch: string): string {
  return branch.replace(/[^a-z0-9]/giu, "").slice(-8) || "head";
}

function gitResult(
  args: string[],
  stdout: string,
  exitCode = 0,
): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode,
  };
}

function cleanupAuthorityConfig(actorId: "maintainer" | "observer"): NexusAuthorityConfig {
  return {
    actors: [
      {
        id: actorId,
        kind: "human",
        provider: null,
        providerIdentity: actorId,
        displayName: actorId,
      },
    ],
    roleBindings: [
      {
        actorId,
        roles: [actorId],
        scope: {
          project: "cleanup-demo",
          component: "primary",
        },
      },
    ],
  };
}
