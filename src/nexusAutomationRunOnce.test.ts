import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationRunRecord,
  createLocalWorkTrackerProvider,
  defaultLocalWorkTrackingStorePath,
  loadLocalWorkTrackingStore,
  loadProjectConfig,
  readNexusAutomationRunLedger,
  readWorktreeExecutionMetadata,
  runNexusAutomationOnce,
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

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      fs.mkdirSync(argsArray[4]!, { recursive: true });
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return {
        args: argsArray,
        stdout: path.join(cwd ?? "", ".git", "info", "exclude"),
        stderr: "",
        exitCode: 0,
      };
    }

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
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
      enabled: true,
      mode: "run_once",
      selector: {
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: ["blocked"],
        assignees: [],
        search: null,
        limit: 5,
      },
      verification: {
        focusedCommands: ["npm test"],
        fullCommands: ["npm run check"],
        requirePassing: true,
      },
      ledger: {
        path: ".dev-nexus/automation/runs.json",
        retention: 20,
      },
      lock: {
        path: ".dev-nexus/automation/run.lock",
        staleAfterMs: 60_000,
      },
      backoff: {
        failureLimit: 3,
        baseDelayMs: 60_000,
        maxDelayMs: 300_000,
      },
      safety: {
        profile: "local",
        allowHostMutation: false,
        allowDependencyInstall: false,
        allowLiveServices: false,
      },
      publication: {
        strategy: "review_handoff",
        remote: "origin",
        targetBranch: "main",
        push: false,
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation run once", () => {
  it("selects work, prepares a worktree, records execution, and updates the tracker", async () => {
    const projectRoot = makeTempDir("dev-nexus-run-once-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Implement run once",
      status: "ready",
      labels: ["automation"],
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = await runNexusAutomationOnce({
      projectRoot,
      runId: "run-1",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
        "2026-05-16T10:02:00.000Z",
        "2026-05-16T10:03:00.000Z",
        "2026-05-16T10:04:00.000Z",
      ),
      gitRunner: fakeGitRunner(gitCalls),
      executor: ({ workItem, worktree }) => ({
        status: "completed",
        summary: `Finished ${workItem.id} in ${path.basename(worktree.worktreePath)}`,
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "passed",
            summary: "focused tests passed",
          },
        ],
        publicationDecision: {
          type: "local_only",
          reason: "test run",
        },
      }),
    });

    expect(result.status).toBe("completed");
    expect(result.workItem).toMatchObject({
      id: "local-1",
      title: "Implement run once",
    });
    expect(result.worktree).toMatchObject({
      componentId: "primary",
      branchName: "codex/demo-project/local-1/run-1",
      baseRef: "main",
      workItem: {
        id: "local-1",
        title: "Implement run once",
      },
    });
    expect(gitCalls).toEqual([
      {
        cwd: path.join(projectRoot, "source"),
        args: [
          "worktree",
          "add",
          "-b",
          "codex/demo-project/local-1/run-1",
          path.join(
            projectRoot,
            "worktrees",
            "primary",
            "codex-demo-project-local-1-run-1",
          ),
          "main",
        ],
      },
    ]);
    expect(result.execution).toMatchObject({
      worktree: {
        componentId: "primary",
        sourceRoot: path.join(projectRoot, "source"),
        worktreesRoot: path.join(projectRoot, "worktrees", "primary"),
        worktreePath: result.worktree!.worktreePath,
        branchName: "codex/demo-project/local-1/run-1",
        baseRef: "main",
        workItem: {
          id: "local-1",
          title: "Implement run once",
        },
      },
      commitIds: ["abc123"],
      verification: [
        {
          command: "npm test",
          status: "passed",
          summary: "focused tests passed",
        },
      ],
      publicationDecision: {
        type: "local_only",
        reason: "test run",
      },
    });
    expect(readWorktreeExecutionMetadata(result.worktree!.worktreePath)).toEqual(
      result.execution,
    );
    expect(readNexusAutomationRunLedger(projectRoot, loadProjectConfig(projectRoot).automation!))
      .toMatchObject({
        runs: [
          {
            id: "run-1",
            componentId: "primary",
            status: "completed",
            workItemId: "local-1",
            worktreePath: result.worktree!.worktreePath,
            branchName: "codex/demo-project/local-1/run-1",
            commitIds: ["abc123"],
          },
        ],
      });
    const store = loadLocalWorkTrackingStore(
      defaultLocalWorkTrackingStorePath(projectRoot),
    );
    expect(store.items[0]).toMatchObject({
      id: "local-1",
      status: "done",
    });
    expect(store.comments["local-1"]).toHaveLength(2);
  });

  it("materializes configured dependency links before executor work", async () => {
    const projectRoot = makeTempDir("dev-nexus-run-once-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ready\n", "utf8");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          setup: {
            dependencyLinks: [
              {
                source: "node_modules",
                target: "node_modules",
                required: true,
              },
            ],
          },
        },
      }),
    );
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Run with dependencies",
      status: "ready",
      labels: ["automation"],
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = await runNexusAutomationOnce({
      projectRoot,
      runId: "run-deps",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
        "2026-05-16T10:02:00.000Z",
        "2026-05-16T10:03:00.000Z",
      ),
      gitRunner: fakeGitRunner(gitCalls),
      executor: ({ setup, worktree }) => {
        expect(setup.links).toMatchObject([
          {
            source: "node_modules",
            target: "node_modules",
            required: true,
            status: "linked",
          },
        ]);
        expect(
          fs.existsSync(path.join(worktree.worktreePath, "node_modules", "tool.txt")),
        ).toBe(true);

        return {
          status: "completed",
          summary: "Dependencies linked",
        };
      },
    });

    expect(result.status).toBe("completed");
    expect(result.setup?.links).toMatchObject([
      {
        sourcePath: sourceDependency,
        targetPath: path.join(result.worktree!.worktreePath, "node_modules"),
        status: "linked",
      },
    ]);
    expect(
      fs
        .readFileSync(
          path.join(result.worktree!.worktreePath, ".git", "info", "exclude"),
          "utf8",
        )
        .trim(),
    ).toBe("node_modules/");
    expect(gitCalls.some((call) => call.args[0] === "rev-parse")).toBe(true);
  });

  it("blocks before worktree preparation when project work tracking is missing", async () => {
    const projectRoot = makeTempDir("dev-nexus-run-once-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      workTracking: undefined,
    });
    saveProjectConfig(projectRoot, config);
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = await runNexusAutomationOnce({
      projectRoot,
      runId: "run-missing-tracker",
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      gitRunner: fakeGitRunner(gitCalls),
      executor: () => {
        throw new Error("executor should not run");
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: "Primary component work tracking is not configured",
      worktree: null,
      workItem: null,
    });
    expect(result.preflight).toEqual([
      {
        name: "workTracking",
        status: "failed",
        message: "Primary component work tracking is not configured",
      },
    ]);
    expect(gitCalls).toEqual([]);
  });

  it("skips runs while retry backoff is active", async () => {
    const projectRoot = makeTempDir("dev-nexus-run-once-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const config = loadProjectConfig(projectRoot).automation!;
    appendNexusAutomationRunRecord({
      projectRoot,
      config,
      now: "2026-05-16T09:00:00.000Z",
      record: {
        id: "failed-run",
        projectId: "demo-project",
        status: "failed",
        startedAt: "2026-05-16T09:00:00.000Z",
        finishedAt: "2026-05-16T09:00:00.000Z",
        error: "previous failure",
      },
    });

    const result = await runNexusAutomationOnce({
      projectRoot,
      runId: "run-backoff",
      now: fixedClock("2026-05-16T09:00:30.000Z"),
      executor: () => {
        throw new Error("executor should not run");
      },
    });

    expect(result.status).toBe("skipped");
    expect(result.summary).toBe("automation retry backoff is active");
    expect(result.ledger?.runs.at(-1)).toMatchObject({
      id: "run-backoff",
      status: "skipped",
      nextRunNotBefore: "2026-05-16T09:01:00.000Z",
    });
  });
});
