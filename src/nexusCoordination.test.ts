import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coordinationHandoffCommentMarker,
  createLocalWorkTrackerProvider,
  createNexusCoordinationHandoff,
  getNexusCoordinationStatus,
  loadLocalWorkTrackingStore,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(
  sourceRoot: string,
  worktreesRoot: string,
  storePath: string,
): NexusProjectConfig {
  return {
    version: 1,
    id: "coordination-demo",
    name: "Coordination Demo",
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
        sourceRoot,
        worktreesRoot,
        workTracking: {
          provider: "local",
          storePath,
        },
        relationships: [],
      },
    ],
  };
}

function fakeGitRunner(
  repositoryPath: string,
  calls: Array<{ args: string[]; cwd?: string }>,
  overrides: {
    status?: string;
    aheadBehind?: string;
    upstreamExitCode?: number;
  } = {},
): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, "codex/shared-coordination\n");
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, "abc123def456\n");
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return {
        args: argsArray,
        stdout:
          overrides.upstreamExitCode === 1 ? "" : "origin/codex/shared-coordination\n",
        stderr: "",
        exitCode: overrides.upstreamExitCode ?? 0,
      };
    }
    if (joined === "status --porcelain=v1") {
      return ok(argsArray, overrides.status ?? "");
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, overrides.aheadBehind ?? "0\t0\n");
    }

    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus coordination", () => {
  it("records structured tracker-backed handoffs and reports current git status", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-14");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig(sourceRoot, "worktrees/dev-nexus", storePath));
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath },
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Shared coordination",
      status: "in_progress",
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      status: "ready",
      hostId: "windows-devbox",
      agentId: "codex",
      changedAreas: ["src/nexusCoordination.ts"],
      decisions: ["Use advisory handoffs instead of locks."],
      verificationSummary: "npm test passed",
      integrationPreference: "direct_integration",
      note: "Ready to merge.",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, gitCalls),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    expect(handoff.record).toMatchObject({
      kind: "dev-nexus.coordination.handoff",
      version: 1,
      projectId: "coordination-demo",
      componentId: "dev-nexus",
      workItemId: "local-1",
      hostId: "windows-devbox",
      agentId: "codex",
      status: "ready",
      branch: "codex/shared-coordination",
      upstream: "origin/codex/shared-coordination",
      headCommit: "abc123def456",
      dirty: false,
      pushed: true,
      changedAreas: ["src/nexusCoordination.ts"],
    });
    expect(handoff.comment.body).toContain(coordinationHandoffCommentMarker);
    const store = loadLocalWorkTrackingStore(path.join(projectRoot, storePath));
    expect(store.comments["local-1"]?.[0]?.body).toContain(
      coordinationHandoffCommentMarker,
    );

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(status).toMatchObject({
      project: {
        id: "coordination-demo",
      },
      component: {
        id: "dev-nexus",
      },
      workItem: {
        id: "local-1",
      },
      git: {
        repositoryPath: worktreePath,
        branch: "codex/shared-coordination",
        upstream: "origin/codex/shared-coordination",
        ahead: 0,
        behind: 0,
        dirty: false,
        pushed: true,
      },
      handoffs: {
        available: true,
        records: [
          {
            status: "ready",
            stale: false,
          },
        ],
      },
      nextAction: "Ready for review or integration.",
    });
  });

  it("treats stale handoffs as advisory warnings, not locks", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-14");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig(sourceRoot, "worktrees/dev-nexus", storePath));
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath },
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Shared coordination",
      status: "in_progress",
    });
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      status: "working",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(status.handoffs.records[0]).toMatchObject({
      status: "working",
      stale: true,
    });
    expect(status.handoffs.warnings).toContain(
      "Handoff for local-1 from 2026-05-16T10:00:00.000Z is stale.",
    );
    expect(status.blocking).toBe(false);
  });
});
