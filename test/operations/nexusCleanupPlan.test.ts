import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusCleanupPlan,
  createOrRefreshNexusWorktreeLease,
  defaultNexusAutomationConfig,
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

describe("nexus cleanup plan", () => {
  it("classifies a clean merged branch as safe", () => {
    const fixture = initCleanupFixture();
    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      gitRunner: cleanupGitRunner(fixture, {
        branches: ["codex/primary/local-1"],
        mergedRefs: ["codex/primary/local-1"],
        upstreams: {
          "codex/primary/local-1": "origin/codex/primary/local-1",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(plan).toMatchObject({
      mutatesSource: false,
      summary: {
        safe: 1,
        blocked: 0,
      },
    });
    expect(plan.candidates[0]).toMatchObject({
      kind: "branch",
      branch: "codex/primary/local-1",
      safeToDelete: true,
      classifications: ["merged", "safe"],
    });
  });

  it("blocks dirty and untracked worktrees and marks them for rescue", () => {
    const fixture = initCleanupFixture();
    const dirtyWorktree = path.join(fixture.worktreesRoot, "dirty");
    const untrackedWorktree = path.join(fixture.worktreesRoot, "untracked");
    fs.mkdirSync(dirtyWorktree, { recursive: true });
    fs.mkdirSync(untrackedWorktree, { recursive: true });

    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      gitRunner: cleanupGitRunner(fixture, {
        worktrees: [
          { path: dirtyWorktree, branch: "codex/primary/dirty", head: "dirty123" },
          { path: untrackedWorktree, branch: "codex/primary/untracked", head: "untracked123" },
        ],
        statuses: {
          [dirtyWorktree]: " M src/file.ts\n",
          [untrackedWorktree]: "?? scratch.txt\n",
        },
        upstreams: {
          "codex/primary/dirty": "origin/codex/primary/dirty",
          "codex/primary/untracked": "origin/codex/primary/untracked",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    const dirty = plan.candidates.find((candidate) =>
      candidate.id.includes("dirty"),
    );
    const untracked = plan.candidates.find((candidate) =>
      candidate.id.includes("untracked"),
    );

    expect(dirty).toMatchObject({
      safeToDelete: false,
      rescue: { needed: true },
      classifications: expect.arrayContaining(["dirty", "blocked"]),
    });
    expect(untracked).toMatchObject({
      safeToDelete: false,
      rescue: { needed: true },
      classifications: expect.arrayContaining(["needs_rescue", "blocked"]),
    });
  });

  it("deduplicates worktrees by normalized path and keeps worktree-specific ids", () => {
    const fixture = initCleanupFixture();
    const worktreePath = path.join(fixture.worktreesRoot, "duplicate");
    const listedPath = process.platform === "win32"
      ? worktreePath.replace(/\\/gu, "/")
      : worktreePath;
    fs.mkdirSync(worktreePath, { recursive: true });

    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      gitRunner: cleanupGitRunner(fixture, {
        worktrees: [
          { path: listedPath, branch: "codex/primary/duplicate", head: "duplicate123" },
        ],
        upstreams: {
          "codex/primary/duplicate": "origin/codex/primary/duplicate",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    const duplicateCandidates = plan.candidates.filter((candidate) =>
      candidate.worktreePath &&
      path.basename(path.normalize(candidate.worktreePath)) === "duplicate",
    );

    expect(duplicateCandidates).toHaveLength(1);
    expect(duplicateCandidates[0]).toMatchObject({
      id: "component:primary:worktree:duplicate",
      branch: "codex/primary/duplicate",
      worktreePath: listedPath,
    });
  });

  it("blocks unpushed commits, missing upstreams, and unknown target branches", () => {
    const fixture = initCleanupFixture();
    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      targetBranch: "missing-main",
      gitRunner: cleanupGitRunner(fixture, {
        targetExists: false,
        branches: [
          "codex/primary/unpushed",
          "codex/primary/no-upstream",
        ],
        upstreams: {
          "codex/primary/unpushed": "origin/codex/primary/unpushed",
        },
        aheadBehind: {
          "codex/primary/unpushed": { ahead: 2, behind: 0 },
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(plan.warnings[0]).toContain("missing-main");
    expect(
      plan.candidates.find((candidate) => candidate.branch === "codex/primary/unpushed"),
    ).toMatchObject({
      classifications: expect.arrayContaining(["unpushed", "unknown_merge_state", "blocked"]),
    });
    expect(
      plan.candidates.find((candidate) => candidate.branch === "codex/primary/no-upstream"),
    ).toMatchObject({
      classifications: expect.arrayContaining(["unknown_merge_state", "blocked"]),
    });
  });

  it("uses lease evidence for stale, ready, abandoned, and superseded work", () => {
    const fixture = initCleanupFixture();
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/stale",
      worktreePath: path.join(fixture.worktreesRoot, "stale"),
      status: "working",
      now: () => "2026-05-16T10:00:00.000Z",
      gitFacts: { headCommit: "stale123" },
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/stale-merged",
      worktreePath: path.join(fixture.worktreesRoot, "stale-merged"),
      status: "working",
      now: () => "2026-05-16T10:00:00.000Z",
      gitFacts: { headCommit: "staleMerged123" },
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/ready",
      worktreePath: path.join(fixture.worktreesRoot, "ready"),
      status: "ready",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "ready123" },
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/abandoned",
      worktreePath: path.join(fixture.worktreesRoot, "abandoned"),
      status: "abandoned",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "abandoned123" },
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      branchName: "codex/primary/superseded",
      worktreePath: path.join(fixture.worktreesRoot, "superseded"),
      status: "merged",
      now: () => "2026-05-18T09:00:00.000Z",
      gitFacts: { headCommit: "recordedMerged123" },
    });

    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      gitRunner: cleanupGitRunner(fixture, {
        branches: [
          "codex/primary/stale",
          "codex/primary/stale-merged",
          "codex/primary/ready",
          "codex/primary/abandoned",
          "codex/primary/superseded",
        ],
        upstreams: {
          "codex/primary/stale": "origin/codex/primary/stale",
          "codex/primary/stale-merged": "origin/codex/primary/stale-merged",
          "codex/primary/ready": "origin/codex/primary/ready",
          "codex/primary/abandoned": "origin/codex/primary/abandoned",
          "codex/primary/superseded": "origin/codex/primary/superseded",
        },
        mergedRefs: ["codex/primary/stale-merged", "recordedMerged123"],
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(candidateFor(plan, "codex/primary/stale")).toMatchObject({
      classifications: expect.arrayContaining(["stale", "blocked"]),
    });
    expect(candidateFor(plan, "codex/primary/stale-merged")).toMatchObject({
      safeToDelete: true,
      classifications: expect.arrayContaining(["stale", "merged", "safe"]),
    });
    expect(candidateFor(plan, "codex/primary/stale-merged").classifications)
      .not.toContain("blocked");
    expect(candidateFor(plan, "codex/primary/ready")).toMatchObject({
      classifications: expect.arrayContaining(["active_lease", "blocked"]),
    });
    expect(candidateFor(plan, "codex/primary/abandoned")).toMatchObject({
      rescue: { needed: true },
      classifications: expect.arrayContaining(["abandoned", "blocked"]),
    });
    expect(candidateFor(plan, "codex/primary/superseded")).toMatchObject({
      safeToDelete: true,
      classifications: expect.arrayContaining(["superseded", "safe"]),
    });
  });
});

function candidateFor(
  plan: ReturnType<typeof buildNexusCleanupPlan>,
  branch: string,
) {
  const candidate = plan.candidates.find((entry) => entry.branch === branch);
  expect(candidate).toBeTruthy();
  return candidate!;
}

function initCleanupFixture() {
  const projectRoot = makeTempDir("dev-nexus-cleanup-plan-");
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
    if (joined === "rev-parse --verify main" || joined === "rev-parse --verify missing-main") {
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
