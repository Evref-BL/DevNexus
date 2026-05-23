import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectNexusWorktreeLeaseGitFacts,
  createOrRefreshNexusWorktreeLease,
  listNexusWorktreeLeases,
  nexusWorktreeLeaseLegacyStorePath,
  nexusWorktreeLeaseStorePath,
  parseNexusWorktreeLeaseStatus,
  readNexusWorktreeLeaseStore,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
} from "../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(options: {
  sourceRoot: string;
  worktreesRoot: string;
}): NexusProjectConfig {
  return {
    version: 1,
    id: "lease-demo",
    name: "Lease Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/dev-nexus.git",
        defaultBranch: "main",
        sourceRoot: options.sourceRoot,
        worktreesRoot: options.worktreesRoot,
        workTracking: {
          provider: "local",
        },
        relationships: [],
      },
    ],
  };
}

function initLeaseFixture(): {
  projectRoot: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
} {
  const projectRoot = makeTempDir("dev-nexus-lease-project-");
  const sourceRoot = path.join(projectRoot, "source");
  const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
  const worktreePath = path.join(worktreesRoot, "local-99");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  saveProjectConfig(projectRoot, projectConfig({ sourceRoot, worktreesRoot }));

  return { projectRoot, sourceRoot, worktreesRoot, worktreePath };
}

function ok(args: readonly string[], stdout: string): GitCommandResult {
  return {
    args: [...args],
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function fakeLeaseGitRunner(repositoryPath: string, status: string): GitRunner {
  return (args: readonly string[]): GitCommandResult => {
    const joined = [...args].join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(args, `${repositoryPath}\n`);
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return ok(args, "origin/codex/dev-nexus/status\n");
    }
    if (joined === "status --porcelain=v1") {
      return ok(args, status);
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(args, "0\t0\n");
    }
    if (joined === "rev-parse HEAD") {
      return ok(args, "1111111111111111111111111111111111111111\n");
    }
    return ok(args, "");
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus worktree leases", () => {
  it("stores leases in runtime Git metadata instead of the tracked workspace store", () => {
    const { projectRoot, worktreePath } = initLeaseFixture();
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "mac-mini",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "working",
      gitFacts: {},
      now: "2026-05-18T10:00:00.000Z",
    });

    expect(nexusWorktreeLeaseStorePath(projectRoot)).toBe(
      path.join(projectRoot, ".git", "dev-nexus", "worktree-leases.json"),
    );
    expect(fs.existsSync(nexusWorktreeLeaseStorePath(projectRoot))).toBe(true);
    expect(fs.existsSync(nexusWorktreeLeaseLegacyStorePath(projectRoot))).toBe(false);
  });

  it("stores leases under a linked gitdir for Git worktree checkouts", () => {
    const { projectRoot } = initLeaseFixture();
    const gitDir = path.join(projectRoot, "..", "linked-git-dir");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".git"),
      `gitdir: ${path.relative(projectRoot, gitDir)}\n`,
      "utf8",
    );

    expect(nexusWorktreeLeaseStorePath(projectRoot)).toBe(
      path.join(gitDir, "dev-nexus", "worktree-leases.json"),
    );
  });

  it("reads legacy tracked lease stores without continuing to write them", () => {
    const { projectRoot, worktreePath } = initLeaseFixture();
    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "working",
      gitFacts: {},
      now: "2026-05-18T10:00:00.000Z",
    });
    const runtimeStore = fs.readFileSync(nexusWorktreeLeaseStorePath(projectRoot), "utf8");
    fs.rmSync(nexusWorktreeLeaseStorePath(projectRoot), { force: true });
    fs.mkdirSync(path.dirname(nexusWorktreeLeaseLegacyStorePath(projectRoot)), {
      recursive: true,
    });
    fs.writeFileSync(nexusWorktreeLeaseLegacyStorePath(projectRoot), runtimeStore, "utf8");

    expect(readNexusWorktreeLeaseStore(projectRoot).leases).toMatchObject([
      { id: lease.id, status: "working" },
    ]);

    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "ready",
      gitFacts: {},
      now: "2026-05-18T10:05:00.000Z",
    });

    expect(readNexusWorktreeLeaseStore(projectRoot).leases).toMatchObject([
      { id: lease.id, status: "ready", refreshCount: 1 },
    ]);
    expect(
      JSON.parse(fs.readFileSync(nexusWorktreeLeaseLegacyStorePath(projectRoot), "utf8"))
        .leases[0].status,
    ).toBe("working");
  });

  it("creates and refreshes advisory component lease records without absolute paths", () => {
    const { projectRoot, sourceRoot, worktreePath } = initLeaseFixture();

    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      agentId: "codex-chat-1",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      baseRef: "main",
      worktreePath,
      writeScope: ["src/nexusWorktreeLease.ts", "src/nexusCoordination.ts"],
      status: "working",
      notes: ["Implement advisory leases."],
      gitFacts: {
        repositoryPath: worktreePath,
        upstream: "origin/codex/dev-nexus/local-99",
        headCommit: "1111111111111111111111111111111111111111",
        dirty: false,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        ahead: 0,
        behind: 0,
        pushed: true,
      },
      now: "2026-05-18T10:00:00.000Z",
    });
    const refreshed = createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      agentId: "codex-chat-1",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      baseRef: "main",
      worktreePath,
      writeScope: ["src/nexusWorktreeLease.ts"],
      status: "ready",
      notes: ["Focused tests passed."],
      gitFacts: {
        repositoryPath: worktreePath,
        upstream: "origin/codex/dev-nexus/local-99",
        headCommit: "2222222222222222222222222222222222222222",
        dirty: true,
        stagedCount: 1,
        unstagedCount: 0,
        untrackedCount: 0,
        ahead: 1,
        behind: 0,
        pushed: false,
      },
      now: "2026-05-18T10:05:00.000Z",
    });

    expect(refreshed).toMatchObject({
      id: lease.id,
      projectId: "lease-demo",
      scope: {
        kind: "component",
        componentId: "dev-nexus",
      },
      hostId: "windows-devbox",
      agentId: "codex-chat-1",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      baseRef: "main",
      worktree: {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId: "dev-nexus",
        relativePath: "local-99",
      },
      status: "ready",
      createdAt: "2026-05-18T10:00:00.000Z",
      lastSeenAt: "2026-05-18T10:05:00.000Z",
      refreshCount: 1,
      lastObservedHeadCommit: "2222222222222222222222222222222222222222",
      dirty: true,
      pushed: false,
      git: {
        repository: {
          kind: "component_worktree",
          relativePath: "local-99",
        },
        upstream: "origin/codex/dev-nexus/local-99",
        ahead: 1,
        stagedCount: 1,
      },
      writeScope: ["src/nexusWorktreeLease.ts"],
      notes: ["Focused tests passed."],
    });
    expect(readNexusWorktreeLeaseStore(projectRoot).leases).toHaveLength(1);

    const rawStore = fs.readFileSync(nexusWorktreeLeaseStorePath(projectRoot), "utf8");
    expect(rawStore).not.toContain(projectRoot);
    expect(rawStore).not.toContain(sourceRoot);
  });

  it("preserves porcelain status columns when collecting lease Git facts", () => {
    const { worktreePath } = initLeaseFixture();
    const gitFacts = collectNexusWorktreeLeaseGitFacts({
      worktreePath,
      gitRunner: fakeLeaseGitRunner(
        worktreePath,
        " M src/unstaged.ts\nM  src/staged.ts\nMM src/both.ts\n?? src/new.ts\n",
      ),
    });

    expect(gitFacts).toMatchObject({
      repositoryPath: worktreePath,
      dirty: true,
      stagedCount: 2,
      unstagedCount: 2,
      untrackedCount: 1,
      pushed: true,
    });
  });

  it("detects stale leases and keeps them advisory", () => {
    const { projectRoot, worktreePath } = initLeaseFixture();
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      agentId: "codex",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "working",
      gitFacts: {},
      now: "2026-05-18T10:00:00.000Z",
    });

    const leases = listNexusWorktreeLeases({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-99",
      now: "2026-05-19T10:00:01.000Z",
      staleAfterMs: 24 * 60 * 60 * 1000,
    });

    expect(leases.records[0]).toMatchObject({
      status: "working",
      effectiveStatus: "stale",
      stale: true,
    });
    expect(leases.staleCount).toBe(1);
    expect(leases.blocking).toBe(false);
    expect(leases.warnings[0]).toContain("is stale");
  });

  it("supports lease status transitions including integrating, merged, abandoned, and stale", () => {
    const { projectRoot, worktreePath } = initLeaseFixture();
    for (const status of [
      "working",
      "ready",
      "blocked",
      "integrating",
      "merged",
      "abandoned",
      "stale",
    ]) {
      expect(parseNexusWorktreeLeaseStatus(status, "status")).toBe(status);
    }

    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "working",
      gitFacts: {},
      now: "2026-05-18T10:00:00.000Z",
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "integrating",
      gitFacts: {},
      now: "2026-05-18T10:05:00.000Z",
    });
    const merged = createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99",
      worktreePath,
      status: "merged",
      gitFacts: {},
      now: "2026-05-18T10:10:00.000Z",
    });

    expect(merged).toMatchObject({
      status: "merged",
      refreshCount: 2,
      lastSeenAt: "2026-05-18T10:10:00.000Z",
    });
    expect(
      listNexusWorktreeLeases({
        projectRoot,
        componentId: "dev-nexus",
        workItemId: "local-99",
        now: "2026-05-20T10:10:00.000Z",
        staleAfterMs: 1,
      }).records[0],
    ).toMatchObject({
      status: "merged",
      effectiveStatus: "merged",
      stale: false,
    });
  });

  it("records workspace-meta leases and defaults missing host and agent ids", () => {
    const { projectRoot } = initLeaseFixture();
    const worktreePath = path.join(projectRoot, "worktrees", "lease-demo", "meta");
    fs.mkdirSync(worktreePath, { recursive: true });

    const lease = createOrRefreshNexusWorktreeLease({
      projectRoot,
      projectMeta: true,
      branchName: "codex/lease-demo/project-state",
      baseRef: "main",
      worktreePath,
      writeScope: [".dev-nexus/automation/target-state.md"],
      status: "working",
      gitFacts: {},
      now: "2026-05-18T11:00:00.000Z",
    });

    expect(lease).toMatchObject({
      scope: {
        kind: "project_meta",
        componentId: null,
      },
      hostId: os.hostname(),
      agentId: null,
      workItemId: null,
      worktree: {
        kind: "project_meta_worktree",
        base: "projectWorktreesRoot",
        componentId: null,
        relativePath: "lease-demo/meta",
      },
    });
  });

  it("reports overlapping active leases as warnings instead of locks", () => {
    const { projectRoot, worktreesRoot } = initLeaseFixture();
    const firstWorktree = path.join(worktreesRoot, "local-99-a");
    const secondWorktree = path.join(worktreesRoot, "local-99-b");
    fs.mkdirSync(firstWorktree, { recursive: true });
    fs.mkdirSync(secondWorktree, { recursive: true });
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "windows-devbox",
      agentId: "codex-a",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99-a",
      worktreePath: firstWorktree,
      status: "working",
      gitFacts: {},
      now: "2026-05-18T12:00:00.000Z",
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "mac-mini",
      agentId: "codex-b",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/local-99-b",
      worktreePath: secondWorktree,
      status: "working",
      gitFacts: {},
      now: "2026-05-18T12:01:00.000Z",
    });

    const leases = listNexusWorktreeLeases({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-99",
      now: "2026-05-18T12:02:00.000Z",
    });

    expect(leases.records).toHaveLength(2);
    expect(leases.activeCount).toBe(2);
    expect(leases.blocking).toBe(false);
    expect(leases.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("this is not a hard lock"),
      ]),
    );
  });
});
