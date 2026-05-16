import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationRunRecord,
} from "./nexusAutomation.js";
import {
  appendNexusAutomationTargetCycleRecord,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  defaultNexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "report-demo",
    name: "Report Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:report/demo.git",
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
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Use this project until no eligible work remains.",
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

describe("nexus automation target report", () => {
  it("builds a factual report from target cycles and run ledger records", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "run-1",
        projectId: "report-demo",
        status: "completed",
        summary: "Coordinator launched.",
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:05:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-1",
        status: "dispatched",
        summary: "Dispatched one work item.",
        eligibleWorkItemCount: 2,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            title: "Implement report",
            cycleStatus: "dispatched",
            agentProfileId: "codex-heavy",
            notes: "Subagent launched.",
          },
        ],
        notes: ["Cycle remains active."],
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:30:00.000Z",
      record: {
        id: "cycle-2",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-2",
        status: "blocked",
        summary: "Waiting for credentials.",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            title: "Implement report",
            cycleStatus: "blocked",
          },
        ],
        blockers: ["Credentials are missing."],
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:40:00.000Z",
    });

    expect(report).toMatchObject({
      version: 1,
      generatedAt: "2026-05-16T10:40:00.000Z",
      project: {
        id: "report-demo",
        componentCount: 1,
      },
      target: {
        id: "dogfood",
        objective: "Use this project until no eligible work remains.",
      },
      status: "blocked",
      statusReason: "Latest target cycle cycle-2 is blocked",
      cycleSummary: {
        cycleCount: 2,
        activeCycleCount: 1,
        blockedCycleCount: 1,
      },
      runSummary: {
        runCount: 1,
        completedRunCount: 1,
      },
      workItemSummary: {
        totalReferences: 2,
        uniqueReferences: [
          {
            componentId: "primary",
            id: "local-1",
            latestCycleStatus: "blocked",
            latestCycleId: "cycle-2",
          },
        ],
        byComponent: [
          {
            componentId: "primary",
            totalReferences: 2,
            uniqueWorkItemCount: 1,
          },
        ],
        byCycleStatus: {
          dispatched: 1,
          blocked: 1,
        },
      },
      blockers: ["Credentials are missing."],
      notes: ["Cycle remains active."],
    });
  });

  it("reports not started when no target cycle or run exists", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      status: "not_started",
      statusReason: "No target cycles or automation runs are recorded",
      cycleSummary: {
        cycleCount: 0,
      },
      runSummary: {
        runCount: 0,
      },
    });
  });

  it("keeps target status not started when only legacy run records exist", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "run-1",
        projectId: "report-demo",
        status: "completed",
      },
    });

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      status: "not_started",
      statusReason:
        "No target cycle is recorded; latest automation run run-1 is completed",
      cycleSummary: {
        cycleCount: 0,
      },
      runSummary: {
        runCount: 1,
      },
    });
  });
});
