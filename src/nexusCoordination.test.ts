import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coordinationHandoffCommentMarker,
  createLocalWorkTrackerProvider,
  createNexusCoordinationHandoff,
  defaultNexusAutomationConfig,
  defaultGitRunner,
  getNexusCoordinationStatus,
  getNexusCoordinationIntegrationPlan,
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

function runGit(cwd: string, args: string[]): string {
  const result = defaultGitRunner(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }

  return result.stdout.trim();
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function holdStoreLock(storePath: string): () => void {
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const handle = fs.openSync(lockPath, "wx");
  try {
    fs.writeFileSync(handle, "external test lock\n", "utf8");
  } finally {
    fs.closeSync(handle);
  }

  return () => fs.rmSync(lockPath, { force: true });
}

function commitAll(repositoryPath: string, message: string): string {
  runGit(repositoryPath, ["add", "."]);
  runGit(repositoryPath, ["commit", "-m", message]);
  return runGit(repositoryPath, ["rev-parse", "HEAD"]);
}

function initGitProjectFixture(name: string): {
  projectRoot: string;
  sourceRoot: string;
  storePath: string;
} {
  const projectRoot = makeTempDir(`dev-nexus-${name}-project-`);
  const sourceRoot = path.join(projectRoot, "source");
  const storePath = ".dev-nexus/work-items-dev-nexus.json";
  fs.mkdirSync(sourceRoot, { recursive: true });
  runGit(sourceRoot, ["init", "-b", "main"]);
  runGit(sourceRoot, ["config", "user.email", "dev-nexus@example.invalid"]);
  runGit(sourceRoot, ["config", "user.name", "DevNexus Test"]);
  runGit(sourceRoot, ["config", "core.autocrlf", "false"]);
  writeText(path.join(sourceRoot, "README.md"), "base\n");
  commitAll(sourceRoot, "base");
  saveProjectConfig(
    projectRoot,
    projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
  );

  return { projectRoot, sourceRoot, storePath };
}

async function createFixtureWorkItem(
  projectRoot: string,
  storePath: string,
  title: string,
): Promise<string> {
  const item = await createLocalWorkTrackerProvider({
    projectRoot,
    config: { provider: "local", storePath },
    now: () => "2026-05-16T09:00:00.000Z",
  }).createWorkItem({
    projectRoot,
    title,
    status: "in_progress",
  });

  return item.id;
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

  it("serializes concurrent local-provider coordination handoffs", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-59");
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
      title: "Concurrent handoffs",
      status: "in_progress",
    });

    const absoluteStorePath = path.join(projectRoot, storePath);
    const releaseLock = holdStoreLock(absoluteStorePath);
    const statuses = ["working", "ready", "blocked", "merged"] as const;
    let completed = false;
    const handoffs = Promise.all(
      statuses.map((status, index) =>
        createNexusCoordinationHandoff({
          projectRoot,
          componentId: "dev-nexus",
          workItemId: "local-1",
          status,
          hostId: `host-${index}`,
          agentId: "codex",
          changedAreas: [`src/area-${index}.ts`],
          decisions: [`Decision ${index}`],
          currentPath: worktreePath,
          gitRunner: fakeGitRunner(worktreePath, []),
          now: () => `2026-05-16T10:0${index}:00.000Z`,
        }),
      ),
    ).then((result) => {
      completed = true;
      return result;
    });

    try {
      await sleep(25);
      expect(completed).toBe(false);
    } finally {
      releaseLock();
    }

    const results = await handoffs;
    const commentIds = results.map((result) => result.comment.id);
    expect(new Set(commentIds).size).toBe(4);

    const rawStore = fs.readFileSync(absoluteStorePath, "utf8");
    expect(() => JSON.parse(rawStore)).not.toThrow();
    const store = loadLocalWorkTrackingStore(absoluteStorePath);
    const comments = store.comments["local-1"] ?? [];
    expect(comments).toHaveLength(4);
    expect(new Set(comments.map((comment) => comment.id)).size).toBe(4);
    expect(comments.every((comment) =>
      comment.body.includes(coordinationHandoffCommentMarker),
    )).toBe(true);

    const coordinationStatus = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(coordinationStatus.handoffs.records).toHaveLength(4);
    expect(coordinationStatus.handoffs.records.map((record) => record.status))
      .toEqual(expect.arrayContaining([...statuses]));
  });

  it("plans a clean handoff branch merge without mutating the source checkout", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initGitProjectFixture("coordination-clean");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Clean integration",
    );
    runGit(sourceRoot, ["switch", "-c", "codex/clean-branch"]);
    writeText(path.join(sourceRoot, "src", "clean.ts"), "export const clean = true;\n");
    const featureCommit = commitAll(sourceRoot, "clean branch change");
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      hostId: "windows-devbox",
      agentId: "codex",
      changedAreas: ["src/clean.ts"],
      decisions: ["Keep the integration planner read-only."],
      verificationSummary: "focused tests passed",
      integrationPreference: "direct_integration",
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:00:00.000Z",
    });
    runGit(sourceRoot, ["switch", "main"]);

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.mutatesSource).toBe(false);
    expect(plan.target.ref).toBe("main");
    expect(plan.branches).toMatchObject([
      {
        branch: "codex/clean-branch",
        headCommit: featureCommit,
        merge: {
          status: "clean",
          changedFiles: ["src/clean.ts"],
          conflictFiles: [],
        },
        handoff: {
          decisions: ["Keep the integration planner read-only."],
          integrationPreference: "direct_integration",
          stale: false,
        },
      },
    ]);
    expect(plan.suggestedOrder.map((step) => step.branch)).toEqual([
      "codex/clean-branch",
    ]);
    expect(runGit(sourceRoot, ["branch", "--show-current"])).toBe("main");
  }, 15000);

  it("reports concise textual conflicts from merge-tree", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initGitProjectFixture("coordination-conflict");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Conflicting integration",
    );
    writeText(path.join(sourceRoot, "settings.txt"), "mode=base\n");
    commitAll(sourceRoot, "add settings");
    runGit(sourceRoot, ["switch", "-c", "codex/conflicting-branch"]);
    writeText(path.join(sourceRoot, "settings.txt"), "mode=feature\n");
    commitAll(sourceRoot, "feature settings change");
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      changedAreas: ["settings.txt"],
      decisions: ["Feature branch owns the settings mode."],
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:00:00.000Z",
    });
    runGit(sourceRoot, ["switch", "main"]);
    writeText(path.join(sourceRoot, "settings.txt"), "mode=main\n");
    commitAll(sourceRoot, "main settings change");

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.branches).toMatchObject([
      {
        branch: "codex/conflicting-branch",
        merge: {
          status: "conflict",
          conflictFiles: ["settings.txt"],
        },
      },
    ]);
    expect(plan.branches[0]!.merge.summary).toContain("settings.txt");
    expect(plan.branches[0]!.merge.messages.join("\n").length).toBeLessThan(800);
    expect(plan.nextAction).toContain("Resolve textual conflicts");
  }, 15000);

  it("surfaces competing recorded decisions before recommending merge order", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initGitProjectFixture("coordination-decisions");
    const firstWorkItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "First decision",
    );
    const secondWorkItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Second decision",
    );
    runGit(sourceRoot, ["switch", "-c", "codex/use-json"]);
    writeText(path.join(sourceRoot, "src", "json.ts"), "export const format = 'json';\n");
    commitAll(sourceRoot, "json decision");
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: firstWorkItemId,
      status: "ready",
      changedAreas: ["src/contracts.ts"],
      decisions: ["Represent integration facts as JSON records."],
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:00:00.000Z",
    });
    runGit(sourceRoot, ["switch", "main"]);
    runGit(sourceRoot, ["switch", "-c", "codex/use-yaml"]);
    writeText(path.join(sourceRoot, "src", "yaml.ts"), "export const format = 'yaml';\n");
    commitAll(sourceRoot, "yaml decision");
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: secondWorkItemId,
      status: "ready",
      changedAreas: ["src/contracts.ts"],
      decisions: ["Represent integration facts as YAML records."],
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:05:00.000Z",
    });
    runGit(sourceRoot, ["switch", "main"]);

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.decisionConflicts).toMatchObject([
      {
        kind: "changed_area",
        changedArea: "src/contracts.ts",
        branches: expect.arrayContaining(["codex/use-json", "codex/use-yaml"]),
      },
    ]);
    expect(plan.suggestedOrder).toEqual([]);
    expect(plan.nextAction).toContain("Resolve competing handoff decisions");
  }, 15000);

  it("keeps stale handoffs visible but excludes them from the suggested order", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initGitProjectFixture("coordination-stale");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Stale integration",
    );
    runGit(sourceRoot, ["switch", "-c", "codex/stale-branch"]);
    writeText(path.join(sourceRoot, "src", "stale.ts"), "export const stale = true;\n");
    commitAll(sourceRoot, "stale branch change");
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      changedAreas: ["src/stale.ts"],
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-16T10:00:00.000Z",
    });
    runGit(sourceRoot, ["switch", "main"]);

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: defaultGitRunner,
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(plan.handoffs.staleCount).toBe(1);
    expect(plan.branches).toMatchObject([
      {
        branch: "codex/stale-branch",
        stale: true,
        merge: {
          status: "skipped",
        },
      },
    ]);
    expect(plan.suggestedOrder).toEqual([]);
    expect(plan.warnings).toContain(
      "Handoff for local-1 from 2026-05-16T10:00:00.000Z is stale.",
    );
  }, 15000);

  it("fetches configured remotes only when automation safety allows host mutation", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-fetch-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-15");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
      automation: {
        ...defaultNexusAutomationConfig,
        safety: {
          ...defaultNexusAutomationConfig.safety,
          allowHostMutation: true,
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          remote: "origin",
          targetBranch: "main",
        },
      },
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      currentPath: worktreePath,
      fetch: true,
      gitRunner: fakeGitRunner(worktreePath, gitCalls),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.fetch).toMatchObject({
      requested: true,
      allowed: true,
      remote: "origin",
      targetBranch: "main",
      ran: true,
      exitCode: 0,
    });
    expect(plan.target.ref).toBe("origin/main");
    expect(gitCalls.map((call) => call.args)).toContainEqual([
      "fetch",
      "--prune",
      "origin",
      "main",
    ]);
    expect(plan.mutatesSource).toBe(false);
  });
});
