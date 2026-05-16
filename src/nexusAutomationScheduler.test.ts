import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalWorkTrackerProvider,
  defaultLocalWorkTrackingStorePath,
  defaultNexusAutomationConfig,
  loadLocalWorkTrackingStore,
  nextNexusAutomationSchedulerDelayMs,
  runNexusAutomationScheduler,
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

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
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
    if (argsArray[0] === "rev-list") {
      return {
        args: argsArray,
        stdout: "abc123\n",
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
      ...defaultNexusAutomationConfig,
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        limit: 5,
      },
      schedule: {
        enabled: true,
        intervalMs: 1234,
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

describe("nexus automation scheduler", () => {
  it("polls idle projects without mutating worktrees or run ledgers", async () => {
    const projectRoot = makeTempDir("dev-nexus-scheduler-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const waits: number[] = [];

    const result = await runNexusAutomationScheduler({
      projectRoot,
      maxTicks: 1,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      sleep: async (ms) => {
        waits.push(ms);
      },
      executor: () => {
        throw new Error("executor should not run");
      },
    });

    expect(result).toMatchObject({
      stoppedReason: "max_ticks",
      runs: [],
      ticks: [
        {
          action: "waited",
          waitMs: 1234,
          status: {
            status: "idle",
            candidateCount: 0,
          },
        },
      ],
    });
    expect(waits).toEqual([]);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".dev-nexus", "automation")))
      .toBe(false);
  });

  it("runs ready work through run-once and stops at the configured run bound", async () => {
    const projectRoot = makeTempDir("dev-nexus-scheduler-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Scheduled task",
      status: "ready",
      labels: ["automation"],
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = await runNexusAutomationScheduler({
      projectRoot,
      maxRuns: 1,
      gitRunner: fakeGitRunner(gitCalls),
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      executor: ({ workItem }) => ({
        status: "completed",
        summary: `Finished ${workItem.id}`,
      }),
    });

    expect(result).toMatchObject({
      stoppedReason: "max_runs",
      ticks: [
        {
          action: "ran",
          status: {
            status: "ready",
            selectedWorkItem: {
              id: "local-1",
            },
          },
          run: {
            status: "completed",
            workItem: {
              id: "local-1",
            },
          },
        },
      ],
      runs: [
        {
          status: "completed",
          workItem: {
            id: "local-1",
          },
        },
      ],
    });
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
          "add",
          "-b",
          "codex/demo-project/local-1/scheduled-20260516-t100000-000-z-1",
          path.join(
            projectRoot,
            "worktrees",
            "primary",
            "codex-demo-project-local-1-scheduled-20260516-t100000-000-z-1",
          ),
        "main",
      ],
      cwd: path.join(projectRoot, "source"),
    });
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("schedules agent launches without preparing worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-scheduler-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        agent: {
          command: "codex run",
          timeoutMs: null,
          relaunch: {
            whileEligible: true,
          },
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Agent launch task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationScheduler({
      projectRoot,
      maxRuns: 1,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      agentLauncher: ({ eligibleWorkItems }) => ({
        status: "completed",
        summary: `Agent saw ${eligibleWorkItems.length} item(s)`,
      }),
    });

    expect(result).toMatchObject({
      stoppedReason: "max_runs",
      ticks: [
        {
          action: "ran",
          waitMs: 0,
          status: {
            status: "ready",
            selectedWorkItem: null,
            eligibleWorkItems: [
              {
                id: "local-1",
              },
            ],
          },
          run: {
            status: "completed",
            summary: "Agent saw 1 item(s)",
            eligibleWorkItems: [
              {
                id: "local-1",
              },
            ],
          },
        },
      ],
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "ready",
    });
  });

  it("uses retry and lock timestamps as the next scheduler delay", () => {
    expect(
      nextNexusAutomationSchedulerDelayMs(
        {
          status: "backoff",
          backoff: {
            consecutiveFailures: 1,
            shouldRun: false,
            retryAfter: "2026-05-16T10:05:00.000Z",
            delayMs: 300000,
            reason: "backoff",
          },
        } as never,
        1000,
        "2026-05-16T10:00:00.000Z",
      ),
    ).toBe(300000);

    expect(
      nextNexusAutomationSchedulerDelayMs(
        {
          status: "locked",
          lock: {
            expiresAt: "2026-05-16T10:01:00.000Z",
          },
        } as never,
        1000,
        "2026-05-16T10:00:00.000Z",
      ),
    ).toBe(60000);
  });
});
