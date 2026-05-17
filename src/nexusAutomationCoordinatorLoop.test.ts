import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireNexusAutomationRunLock,
  appendNexusAutomationRunRecord,
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  readNexusAutomationRunLedger,
  readNexusAutomationTargetCycleLedger,
  buildNexusAutomationTargetReport,
  runNexusAutomationCoordinatorLoop,
  saveProjectConfig,
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

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "loop-demo",
    name: "Loop Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:loop/demo.git",
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
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: ["blocked"],
        limit: 5,
      },
      schedule: {
        enabled: true,
        intervalMs: 1000,
      },
      backoff: {
        failureLimit: 3,
        baseDelayMs: 60_000,
        maxDelayMs: 300_000,
      },
      agent: {
        ...defaultNexusAutomationConfig.agent,
        command: "codex run",
        timeoutMs: 120000,
        relaunch: {
          whileEligible: true,
        },
      },
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Keep launching coordinators while eligible work remains.",
        stopWhenNoEligibleWork: true,
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

describe("nexus automation coordinator loop", () => {
  it("records a skipped target cycle without launching when no work is eligible", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordinator-loop-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxTicks: 1,
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result).toMatchObject({
      stoppedReason: "no_work",
      runs: [],
      ticks: [
        {
          action: "skipped",
          waitMs: null,
          decision: {
            type: "skip",
            reason: "No eligible work item matched the automation selector",
          },
        },
      ],
    });
    expect(fs.existsSync(path.join(projectRoot, ".dev-nexus", "automation", "runs.json")))
      .toBe(false);
    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "skipped",
      eligibleWorkItemCount: 0,
      summary: "No eligible work item matched the automation selector",
      notes: expect.arrayContaining([
        "managed-loop: decision=skip",
        "managed-loop: no coordinator launched",
        "managed-loop: target-report=not_ready",
      ]),
    });
    expect(
      readNexusAutomationTargetCycleLedger(
        projectRoot,
        projectConfig().automation!,
      ).cycles,
    ).toHaveLength(1);
  });

  it("waits without launching while retry backoff is active", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordinator-loop-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-17T09:59:30.000Z",
      record: {
        id: "failed-run",
        projectId: "loop-demo",
        status: "failed",
        startedAt: "2026-05-17T09:59:30.000Z",
        finishedAt: "2026-05-17T09:59:30.000Z",
        error: "previous coordinator failed",
      },
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxTicks: 1,
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result).toMatchObject({
      stoppedReason: "max_ticks",
      runs: [],
      ticks: [
        {
          action: "waited",
          waitMs: 30000,
          decision: {
            type: "wait",
            reason: "automation retry backoff is active",
            nextTickNotBefore: "2026-05-17T10:00:30.000Z",
          },
          targetCycle: {
            status: "skipped",
            nextCycleNotBefore: "2026-05-17T10:00:30.000Z",
          },
        },
      ],
    });
  });

  it("waits without launching while another run owns the lock", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordinator-loop-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    acquireNexusAutomationRunLock({
      projectRoot,
      config: config.automation!,
      runId: "other-run",
      owner: "other-agent",
      now: "2026-05-17T10:00:00.000Z",
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxTicks: 1,
      now: fixedClock("2026-05-17T10:00:30.000Z"),
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result.runs).toEqual([]);
    expect(result.ticks[0]).toMatchObject({
      action: "waited",
      waitMs: 3570000,
      decision: {
        type: "wait",
        reason: "Automation run lock is held by other-run until 2026-05-17T11:00:00.000Z",
        nextTickNotBefore: "2026-05-17T11:00:00.000Z",
      },
      targetCycle: {
        status: "skipped",
        summary: "Automation run lock is held by other-run until 2026-05-17T11:00:00.000Z",
      },
    });
  });

  it("launches one coordinator for eligible work and finalizes the target cycle", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordinator-loop-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinator-selectable task",
      status: "ready",
      labels: ["automation"],
    });
    let launchCount = 0;

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: ({ eligibleWorkItems }) => {
        launchCount += 1;
        expect(eligibleWorkItems).toHaveLength(1);
        return {
          status: "completed",
          summary: "Coordinator completed a bounded batch",
          commitIds: ["abc123"],
        };
      },
    });

    expect(launchCount).toBe(1);
    expect(result).toMatchObject({
      stoppedReason: "max_runs",
      runs: [
        {
          status: "completed",
          summary: "Coordinator completed a bounded batch",
        },
      ],
      ticks: [
        {
          action: "launched",
          decision: {
            type: "launch",
            reason: "Agent launch ready with 1 eligible work item(s)",
          },
          run: {
            status: "completed",
          },
          targetCycle: {
            status: "completed",
            eligibleWorkItemCount: 1,
            runId: "loop-20260517-t100000-000-z-1",
            workItems: [
              {
                componentId: "primary",
                id: "local-1",
                title: "Coordinator-selectable task",
                status: "ready",
                cycleStatus: "eligible",
              },
            ],
            notes: expect.arrayContaining([
              "managed-loop: decision=launch",
              "managed-loop: coordinator launched",
              "managed-loop: coordinator completed",
              "managed-loop: target-report=not_ready",
            ]),
          },
        },
      ],
    });
    expect(
      readNexusAutomationRunLedger(projectRoot, config.automation!).runs.at(-1),
    ).toMatchObject({
      id: "loop-20260517-t100000-000-z-1",
      status: "completed",
      commitIds: ["abc123"],
    });
    expect(
      readNexusAutomationTargetCycleLedger(projectRoot, config.automation!).cycles,
    ).toMatchObject([
      {
        id: "target-cycle-loop-20260517-t100000-000-z-1",
        status: "completed",
        runId: "loop-20260517-t100000-000-z-1",
      },
    ]);
  });

  it("records no eligible work after a completed coordinator closes selected work", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordinator-loop-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Coordinator-completed task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: async ({ eligibleWorkItems }) => {
        expect(eligibleWorkItems).toHaveLength(1);
        await tracker.updateWorkItem(
          { id: eligibleWorkItems[0]!.id },
          { status: "done" },
        );
        return {
          status: "completed",
          summary: "Coordinator completed all selected work",
        };
      },
    });

    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "completed",
      eligibleWorkItemCount: 0,
      workItems: [],
    });
    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      relaunchDecision: {
        type: "stop",
        eligibleWorkItemCount: 0,
        latestCycleId: "target-cycle-loop-20260517-t100000-000-z-1",
      },
    });
  });
});
