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
  type GitCommandResult,
  type GitRunner,
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
  fixture: { sourceRoot: string },
  calls: Array<{ args: string[]; cwd?: string }>,
  options: {
    branches?: string[];
    worktrees?: Array<{ path: string; branch: string; head: string }>;
    statuses?: Record<string, string>;
    targetExists?: boolean;
    mergedRefs?: string[];
    upstreams?: Record<string, string>;
    aheadBehind?: Record<string, { ahead: number; behind: number }>;
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
    for (const worktree of options.worktrees ?? []) {
      branchHeads.set(worktree.branch, worktree.head);
    }

    if (joined === "worktree list --porcelain") {
      return gitResult(argsArray, [
        `worktree ${fixture.sourceRoot}`,
        "HEAD target123",
        "branch refs/heads/main",
        "",
        ...(options.worktrees ?? []).flatMap((worktree) => [
          `worktree ${worktree.path}`,
          `HEAD ${worktree.head}`,
          `branch refs/heads/${worktree.branch}`,
          "",
        ]),
      ].join("\n"));
    }
    if (joined === "for-each-ref --format=%(refname:short) refs/heads/codex") {
      return gitResult(argsArray, (options.branches ?? []).join("\n"));
    }
    if (joined === "rev-parse --verify main") {
      return options.targetExists === false
        ? gitResult(argsArray, "", 1)
        : gitResult(argsArray, "target123\n");
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--is-inside-work-tree") {
      return gitResult(argsArray, "true\n");
    }
    if (argsArray[0] === "symbolic-ref" && argsArray[1] === "--short") {
      const worktree = (options.worktrees ?? []).find((entry) => entry.path === cwd);
      return worktree
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
