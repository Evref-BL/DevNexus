import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adoptNexusAutomationCurrentAgent,
  adoptNexusAutomationCurrentAgentFromCoordinatorLoop,
  createLocalWorkTrackerProvider,
  defaultLocalWorkTrackingStorePath,
  defaultNexusAutomationConfig,
  loadLocalWorkTrackingStore,
  readNexusAutomationRunLedger,
  readNexusAutomationStatusLock,
  readNexusAutomationTargetCycleLedger,
  recordNexusAutomationCurrentAgentAdoptionResult,
  saveProjectConfig,
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

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "current-agent-demo",
    name: "Current Agent Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/current-agent.git",
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
      agent: {
        ...defaultNexusAutomationConfig.agent,
        maxConcurrentSubagents: 2,
        relaunch: {
          whileEligible: true,
        },
      },
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Let the current coordinator continue only when ready.",
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

describe("current-agent automation adoption", () => {
  it("creates and reuses launch context without spawning a nested command", async () => {
    const projectRoot = makeTempDir("dev-nexus-current-agent-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Adoptable task",
      status: "ready",
      labels: ["automation"],
    });

    const first = await adoptNexusAutomationCurrentAgent({
      projectRoot,
      runId: "current-agent-1",
      owner: "heartbeat",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
    });
    const second = await adoptNexusAutomationCurrentAgent({
      projectRoot,
      runId: "current-agent-1",
      owner: "heartbeat",
      now: fixedClock("2026-05-17T10:00:30.000Z"),
    });

    expect(first).toMatchObject({
      status: "started",
      shouldProceed: true,
      reused: false,
      runId: "current-agent-1",
      eligibleWorkItems: [
        {
          id: "local-1",
          title: "Adoptable task",
        },
      ],
      environment: {
        DEV_NEXUS_AUTOMATION_MODE: "agent_launch",
        DEV_NEXUS_RUN_ID: "current-agent-1",
        DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS: "2",
        DEV_NEXUS_ELIGIBLE_WORK_ITEM_IDS: "local-1",
      },
      result: {
        file: expect.stringContaining("result.json"),
        statuses: ["completed", "failed", "blocked", "skipped"],
      },
    });
    expect(second).toMatchObject({
      status: "started",
      shouldProceed: true,
      reused: true,
      contextFile: first.contextFile,
      resultFile: first.resultFile,
    });
    expect(
      JSON.parse(fs.readFileSync(first.contextFile!, "utf8")),
    ).toMatchObject({
      runId: "current-agent-1",
      automation: {
        mode: "agent_launch",
        eligibleWorkItemCount: 1,
      },
      result: {
        file: first.resultFile,
        statuses: ["completed", "failed", "blocked", "skipped"],
      },
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);

    const recorded = recordNexusAutomationCurrentAgentAdoptionResult({
      projectRoot,
      runId: "current-agent-1",
      now: fixedClock("2026-05-17T10:20:00.000Z"),
      result: {
        status: "completed",
        summary: "Current coordinator completed a bounded batch",
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "passed",
            summary: "focused tests passed",
          },
        ],
        publicationDecision: {
          type: "review_handoff",
          remote: "origin",
          targetBranch: "main",
          reason: "ready for review",
        },
      },
    });

    expect(recorded).toMatchObject({
      status: "completed",
      summary: "Current coordinator completed a bounded batch",
      resultFile: first.resultFile,
      result: {
        commitIds: ["abc123"],
      },
    });
    expect(
      readNexusAutomationRunLedger(projectRoot, projectConfig().automation!).runs,
    ).toMatchObject([
      {
        id: "current-agent-1",
        status: "completed",
        sourceRoot: path.join(projectRoot, "source"),
        worktreePath: null,
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "passed",
            summary: "focused tests passed",
          },
        ],
        publicationDecision: {
          type: "review_handoff",
          remote: "origin",
          targetBranch: "main",
        },
      },
    ]);
    expect(
      readNexusAutomationStatusLock(
        projectRoot,
        projectConfig().automation!,
        "2026-05-17T10:20:00.000Z",
      ).status,
    ).toBe("none");
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "ready",
    });
  });

  it("uses coordinator-loop gates before allowing current-agent adoption", async () => {
    const projectRoot = makeTempDir("dev-nexus-current-agent-loop-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Loop-adoptable task",
      status: "ready",
      labels: ["automation"],
    });

    const adoption = await adoptNexusAutomationCurrentAgentFromCoordinatorLoop({
      projectRoot,
      runIdPrefix: "heartbeat",
      owner: "restricted-scheduler",
      now: fixedClock("2026-05-17T10:00:00.000Z"),
    });

    expect(adoption).toMatchObject({
      shouldProceed: true,
      decision: {
        type: "launch",
      },
      action: "adopted",
      adoption: {
        status: "started",
        shouldProceed: true,
        runId: "heartbeat-20260517-t100000-000-z-1",
      },
      targetCycle: {
        id: "target-cycle-heartbeat-20260517-t100000-000-z-1",
        status: "dispatched",
        runId: "heartbeat-20260517-t100000-000-z-1",
        authority: {
          projectId: "current-agent-demo",
          components: [
            {
              componentId: "primary",
            },
          ],
        },
        notes: expect.arrayContaining([
          "managed-loop: decision=launch",
          "managed-loop: current agent adopted",
          "managed-loop: target-report=not_ready",
        ]),
      },
    });

    const recorded = recordNexusAutomationCurrentAgentAdoptionResult({
      projectRoot,
      runId: "heartbeat-20260517-t100000-000-z-1",
      now: fixedClock("2026-05-17T10:30:00.000Z"),
      result: {
        status: "blocked",
        summary: "Current coordinator needs a user decision",
        error: "missing publication preference",
      },
    });

    expect(recorded).toMatchObject({
      status: "blocked",
      targetCycle: {
        id: "target-cycle-heartbeat-20260517-t100000-000-z-1",
        status: "blocked",
        runId: "heartbeat-20260517-t100000-000-z-1",
        authority: {
          projectId: "current-agent-demo",
          components: [
            {
              componentId: "primary",
            },
          ],
        },
        blockers: ["Current coordinator needs a user decision"],
        notes: expect.arrayContaining([
          "managed-loop: current agent blocked",
        ]),
      },
    });
    expect(
      readNexusAutomationTargetCycleLedger(projectRoot, config.automation!)
        .cycles,
    ).toMatchObject([
      {
        id: "target-cycle-heartbeat-20260517-t100000-000-z-1",
        status: "blocked",
        runId: "heartbeat-20260517-t100000-000-z-1",
        authority: {
          projectId: "current-agent-demo",
          components: [
            {
              componentId: "primary",
            },
          ],
        },
      },
    ]);
  });
});
