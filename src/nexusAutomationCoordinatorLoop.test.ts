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
import type { WorkTrackerProvider } from "./workTrackingTypes.js";

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
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
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
            eligibleWorkItemCount: 0,
            runId: "loop-20260517-t100000-000-z-1",
            workItems: [
              {
                componentId: "primary",
                id: "local-1",
                logicalItemId: "local-1",
                trackerId: "default",
                title: "Coordinator-selectable task",
                status: "done",
                cycleStatus: "completed",
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
    expect(await tracker.getWorkItem({ id: "local-1" })).toMatchObject({
      status: "done",
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
      workItems: [
        {
          componentId: "primary",
          id: "local-1",
          status: "done",
          cycleStatus: "completed",
        },
      ],
    });
    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      relaunchDecision: {
        type: "stop",
        eligibleWorkItemCount: 0,
        latestCycleId: "target-cycle-loop-20260517-t100000-000-z-1",
      },
    });
  });

  it("records partial multi-item completion without forcing skipped work done", async () => {
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
      title: "Completed item",
      status: "ready",
      labels: ["automation"],
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Skipped item",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: () => ({
        status: "completed",
        summary: "Coordinator completed one item and deferred one item",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            status: "completed",
            summary: "Implemented and verified.",
          },
          {
            componentId: "primary",
            id: "local-2",
            status: "skipped",
            summary: "Left for the next coordinator cycle.",
          },
        ],
      }),
    });

    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "completed",
      eligibleWorkItemCount: 1,
      workItems: [
        {
          componentId: "primary",
          id: "local-1",
          status: "done",
          cycleStatus: "completed",
          notes: "Implemented and verified.",
        },
        {
          componentId: "primary",
          id: "local-2",
          status: "ready",
          cycleStatus: "skipped",
          notes: "Left for the next coordinator cycle.",
        },
      ],
    });
    expect(await tracker.getWorkItem({ id: "local-1" })).toMatchObject({
      status: "done",
    });
    expect(await tracker.getWorkItem({ id: "local-2" })).toMatchObject({
      status: "ready",
    });
  });

  it("records blocked item results without closing every selected item", async () => {
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
      title: "Blocked item",
      status: "ready",
      labels: ["automation"],
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Unstarted item",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: () => ({
        status: "blocked",
        summary: "Coordinator needs credentials",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            status: "blocked",
            summary: "Missing credentials.",
          },
          {
            componentId: "primary",
            id: "local-2",
            status: "skipped",
            summary: "Not started.",
          },
        ],
      }),
    });

    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "blocked",
      blockers: ["Coordinator needs credentials"],
      eligibleWorkItemCount: 1,
      workItems: [
        {
          id: "local-1",
          status: "blocked",
          cycleStatus: "blocked",
          notes: "Missing credentials.",
        },
        {
          id: "local-2",
          status: "ready",
          cycleStatus: "skipped",
          notes: "Not started.",
        },
      ],
    });
    expect(await tracker.getWorkItem({ id: "local-1" })).toMatchObject({
      status: "blocked",
    });
    expect(await tracker.getWorkItem({ id: "local-2" })).toMatchObject({
      status: "ready",
    });
  });

  it("records failed item results distinctly from blocked and skipped work", async () => {
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
      title: "Failed item",
      status: "ready",
      labels: ["automation"],
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Skipped after failure",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: () => ({
        status: "failed",
        summary: "Coordinator verification failed",
        error: "Focused tests failed.",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            status: "failed",
            summary: "Focused tests failed.",
          },
          {
            componentId: "primary",
            id: "local-2",
            status: "skipped",
            summary: "Not attempted after failure.",
          },
        ],
      }),
    });

    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "failed",
      blockers: ["Coordinator verification failed"],
      eligibleWorkItemCount: 2,
      workItems: [
        {
          id: "local-1",
          status: "ready",
          cycleStatus: "failed",
          notes: "Focused tests failed.",
        },
        {
          id: "local-2",
          status: "ready",
          cycleStatus: "skipped",
          notes: "Not attempted after failure.",
        },
      ],
    });
  });

  it("records a reconciliation blocker when tracker completion update fails", async () => {
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
      title: "Completed but stale tracker item",
      status: "ready",
      labels: ["automation"],
    });
    const failingProvider: WorkTrackerProvider = {
      provider: tracker.provider,
      capabilities: tracker.capabilities,
      createWorkItem: tracker.createWorkItem.bind(tracker),
      listWorkItems: tracker.listWorkItems.bind(tracker),
      getWorkItem: tracker.getWorkItem.bind(tracker),
      updateWorkItem: tracker.updateWorkItem.bind(tracker),
      addComment: tracker.addComment.bind(tracker),
      setStatus: async () => {
        throw new Error("tracker store is locked");
      },
    };

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      providerFactory: () => failingProvider,
      launcher: () => ({
        status: "completed",
        summary: "Coordinator completed selected work",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            status: "completed",
            summary: "Implementation finished.",
          },
        ],
      }),
    });

    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "blocked",
      eligibleWorkItemCount: 1,
      blockers: expect.arrayContaining([
        expect.stringContaining('"itemId":"local-1"'),
      ]),
      workItems: [
        {
          componentId: "primary",
          trackerId: "default",
          trackerProvider: "local",
          id: "local-1",
          status: "ready",
          cycleStatus: "blocked",
          notes: expect.stringContaining("tracker store is locked"),
        },
      ],
    });
    const reconciliationBlocker = result.ticks[0]?.targetCycle?.blockers[0] ?? "";
    expect(reconciliationBlocker).toContain('"componentId":"primary"');
    expect(reconciliationBlocker).toContain('"trackerId":"default"');
    expect(reconciliationBlocker).toContain('"itemId":"local-1"');
    expect(await tracker.getWorkItem({ id: "local-1" })).toMatchObject({
      status: "ready",
    });
  });

  it("records app-server run facts in failed target cycles and reports", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordinator-loop-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const baseConfig = projectConfig();
    const config = projectConfig({
      automation: {
        ...baseConfig.automation!,
        agent: {
          ...baseConfig.automation!.agent,
          command: null,
          coordinatorProfileId: "codex-app-server",
          profiles: [
            {
              id: "codex-app-server",
              executor: "codex",
              executorMode: "app_server",
              model: "gpt-5.5",
              reasoning: "high",
              intendedUse: "coordinator",
              safety: {
                profile: "isolated",
                allowHostMutation: false,
                allowDependencyInstall: false,
                allowLiveServices: false,
              },
              command: null,
              args: ["--sandbox", "workspace-write"],
              appServer: {
                mode: "spawn",
                command: "codex",
                args: ["app-server"],
                endpoint: "ws://127.0.0.1:18080",
                ephemeralThreadDefault: true,
                localPolicy: {
                  allowNonLoopbackEndpoint: false,
                  hostLocalSafetyHints: ["spawns_local_process"],
                },
              },
            },
          ],
        },
      },
    });
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "App-server coordinator task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot,
      maxRuns: 1,
      runIdPrefix: "app-server-loop",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
      launcher: (input) => ({
        status: "failed",
        summary: "Codex app-server turn timed out",
        error: "turn timed out after 120000 ms",
        codexAppServer: {
          provider: "codex-app-server",
          status: "failed",
          action: "thread_start",
          runId: input.runId,
          profileId: "codex-app-server",
          threadId: "thread-timeout",
          turnId: "turn-timeout",
          sourceThreadId: null,
          sourceTurnId: null,
          ephemeral: true,
          threadPersistence: "ephemeral",
          cwd: input.sourceRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: input.resultFile,
          failureSummary: "turn timed out after 120000 ms",
        },
      }),
    });

    expect(result.ticks[0]?.targetCycle).toMatchObject({
      status: "failed",
      summary: "Codex app-server turn timed out",
      blockers: ["Codex app-server turn timed out"],
      notes: expect.arrayContaining([
        expect.stringContaining("agent-launch: provider=codex-app-server"),
        "agent-launch: failure=turn timed out after 120000 ms",
      ]),
    });
    expect(
      readNexusAutomationRunLedger(projectRoot, config.automation!).runs.at(-1),
    ).toMatchObject({
      status: "failed",
      codexAppServer: {
        profileId: "codex-app-server",
        threadId: "thread-timeout",
        turnId: "turn-timeout",
        resultFile: expect.stringContaining("result.json"),
        failureSummary: "turn timed out after 120000 ms",
      },
    });
    expect(
      buildNexusAutomationTargetReport({
        projectRoot,
        now: "2026-05-17T10:05:00.000Z",
      }),
    ).toMatchObject({
      status: "failed",
      executionSummary: {
        runs: [
          {
            status: "failed",
            codexAppServer: {
              profileId: "codex-app-server",
              threadId: "thread-timeout",
              turnId: "turn-timeout",
              failureSummary: "turn timed out after 120000 ms",
            },
          },
        ],
      },
      activeBlockers: [
        {
          source: "cycle",
          message: "Codex app-server turn timed out",
        },
        {
          source: "run",
          message: "turn timed out after 120000 ms",
        },
      ],
    });
  });
});
