import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusCleanupPlan,
  createNexusGitWorkflowRun,
  createOrRefreshNexusWorktreeLease,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  transitionNexusGitWorkflowRunLifecycle,
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

  it("uses workflow run state to block paused and dirty abandoned cleanup", () => {
    const fixture = initCleanupFixture();
    const pausedWorktree = path.join(fixture.worktreesRoot, "paused");
    const abandonedWorktree = path.join(fixture.worktreesRoot, "abandoned-run");
    fs.mkdirSync(pausedWorktree, { recursive: true });
    fs.mkdirSync(abandonedWorktree, { recursive: true });
    createWorkflowRun(pausedWorktree, {
      id: "run-paused",
      branchName: "codex/primary/paused",
      status: "paused",
    });
    createWorkflowRun(abandonedWorktree, {
      id: "run-abandoned",
      branchName: "codex/primary/abandoned-run",
      status: "abandoned",
    });

    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      gitRunner: cleanupGitRunner(fixture, {
        worktrees: [
          {
            path: pausedWorktree,
            branch: "codex/primary/paused",
            head: "paused123",
          },
          {
            path: abandonedWorktree,
            branch: "codex/primary/abandoned-run",
            head: "abandonedRun123",
          },
        ],
        statuses: {
          [abandonedWorktree]: " M src/file.ts\n",
        },
        upstreams: {
          "codex/primary/paused": "origin/codex/primary/paused",
          "codex/primary/abandoned-run": "origin/codex/primary/abandoned-run",
        },
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(candidateFor(plan, "codex/primary/paused")).toMatchObject({
      safeToDelete: false,
      workflowRun: {
        id: "run-paused",
        status: "paused",
        nextOwner: {
          kind: "human",
          id: "maintainer",
        },
      },
      classifications: expect.arrayContaining(["workflow_paused", "blocked"]),
      blockers: expect.arrayContaining([
        "Git workflow run run-paused is paused for human maintainer; resume it or choose abandon, archive, or rescue before cleanup.",
      ]),
    });
    expect(candidateFor(plan, "codex/primary/abandoned-run")).toMatchObject({
      safeToDelete: false,
      rescue: { needed: true },
      workflowRun: {
        id: "run-abandoned",
        status: "abandoned",
      },
      classifications: expect.arrayContaining([
        "dirty",
        "workflow_abandoned",
        "needs_rescue",
        "blocked",
      ]),
    });
  });

  it("uses terminal workflow preservation proof for cleanup safety", () => {
    const fixture = initCleanupFixture();
    const abortWorktree = path.join(fixture.worktreesRoot, "clean-abort");
    const archivedWorktree = path.join(fixture.worktreesRoot, "archived");
    const rescuedWorktree = path.join(fixture.worktreesRoot, "rescued");
    const mergedWorktree = path.join(fixture.worktreesRoot, "workflow-merged");
    fs.mkdirSync(abortWorktree, { recursive: true });
    fs.mkdirSync(archivedWorktree, { recursive: true });
    fs.mkdirSync(rescuedWorktree, { recursive: true });
    fs.mkdirSync(mergedWorktree, { recursive: true });
    createWorkflowRun(abortWorktree, {
      id: "run-abort",
      branchName: null,
      status: "aborted",
    });
    createWorkflowRun(archivedWorktree, {
      id: "run-archive",
      branchName: "codex/primary/archived",
      status: "archived",
    });
    createWorkflowRun(rescuedWorktree, {
      id: "run-rescue",
      branchName: "codex/primary/rescued",
      status: "rescued",
    });
    createWorkflowRun(mergedWorktree, {
      id: "run-merged",
      branchName: "codex/primary/workflow-merged",
      status: "merged",
    });

    const plan = buildNexusCleanupPlan({
      projectRoot: fixture.projectRoot,
      gitRunner: cleanupGitRunner(fixture, {
        worktrees: [
          {
            path: abortWorktree,
            branch: null,
            head: "abort123",
          },
          {
            path: archivedWorktree,
            branch: "codex/primary/archived",
            head: "archived123",
          },
          {
            path: rescuedWorktree,
            branch: "codex/primary/rescued",
            head: "rescued123",
          },
          {
            path: mergedWorktree,
            branch: "codex/primary/workflow-merged",
            head: "merged123",
          },
        ],
        upstreams: {
          "codex/primary/archived": "origin/codex/primary/archived",
          "codex/primary/rescued": "origin/codex/primary/rescued",
          "codex/primary/workflow-merged": "origin/codex/primary/workflow-merged",
        },
        mergedRefs: ["codex/primary/workflow-merged"],
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(plan.candidates.find((candidate) =>
      candidate.worktreePath === abortWorktree,
    )).toMatchObject({
      safeToDelete: true,
      workflowRun: {
        id: "run-abort",
        status: "aborted",
      },
      classifications: expect.arrayContaining(["workflow_aborted", "safe"]),
    });
    expect(candidateFor(plan, "codex/primary/archived")).toMatchObject({
      safeToDelete: true,
      workflowRun: {
        id: "run-archive",
        status: "archived",
        preservation: {
          kind: "archive_record",
        },
      },
      classifications: expect.arrayContaining(["workflow_archived", "safe"]),
    });
    expect(candidateFor(plan, "codex/primary/rescued")).toMatchObject({
      safeToDelete: true,
      workflowRun: {
        id: "run-rescue",
        status: "rescued",
        preservation: {
          kind: "rescue_branch",
        },
      },
      classifications: expect.arrayContaining(["workflow_rescued", "safe"]),
    });
    expect(candidateFor(plan, "codex/primary/workflow-merged")).toMatchObject({
      safeToDelete: true,
      workflowRun: {
        id: "run-merged",
        status: "merged",
      },
      proof: expect.arrayContaining([
        "Matched Git workflow run run-merged with status merged.",
      ]),
      classifications: expect.arrayContaining(["merged", "safe"]),
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

function createWorkflowRun(
  projectRoot: string,
  options: {
    id: string;
    branchName: string | null;
    status: "paused" | "abandoned" | "aborted" | "archived" | "rescued" | "merged";
  },
): void {
  createNexusGitWorkflowRun({
    projectRoot,
    id: options.id,
    projectId: "cleanup-demo",
    componentId: "primary",
    profileId: "protected-feature",
    branchName: options.branchName,
    currentRef: options.branchName,
    baseRef: "main",
    baseCommit: "target123",
    targetBranch: "main",
    owner: {
      kind: "agent",
      id: "codex",
    },
    now: "2026-05-18T09:00:00.000Z",
  });
  if (options.status === "paused") {
    transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: options.id,
      action: "pause",
      reason: "Waiting for maintainer.",
      owner: {
        kind: "human",
        id: "maintainer",
      },
      now: "2026-05-18T09:30:00.000Z",
    });
  } else if (options.status === "abandoned") {
    transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: options.id,
      action: "abandon",
      reason: "Work was abandoned without preservation.",
      now: "2026-05-18T09:30:00.000Z",
    });
  } else if (options.status === "aborted") {
    transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: options.id,
      action: "abort",
      reason: "No durable work was created.",
      git: {
        dirty: false,
        unpushedCommits: false,
      },
      now: "2026-05-18T09:30:00.000Z",
    });
  } else if (options.status === "archived") {
    transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: options.id,
      action: "archive",
      reason: "Archived before cleanup.",
      preservation: {
        kind: "archive_record",
        url: "https://github.example.invalid/archive",
        summary: "Archived work in a provider record.",
      },
      now: "2026-05-18T09:30:00.000Z",
    });
  } else if (options.status === "rescued") {
    transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: options.id,
      action: "rescue",
      reason: "Copied to rescue branch.",
      preservation: {
        kind: "rescue_branch",
        ref: "rescue/github-359",
        summary: "Copied work to a rescue branch.",
      },
      now: "2026-05-18T09:30:00.000Z",
    });
  } else if (options.status === "merged") {
    transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: options.id,
      action: "merge",
      reason: "Merged into target branch.",
      preservation: {
        kind: "merged",
        ref: "main",
        summary: "Target branch contains this workflow.",
      },
      now: "2026-05-18T09:30:00.000Z",
    });
  }
}

function cleanupGitRunner(
  fixture: { sourceRoot: string },
  options: {
    branches?: string[];
    worktrees?: Array<{ path: string; branch: string | null; head: string }>;
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
      if (worktree.branch) {
        branchHeads.set(worktree.branch, worktree.head);
      }
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
          ...(worktree.branch ? [`branch refs/heads/${worktree.branch}`] : []),
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
