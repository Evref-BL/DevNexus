import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationTargetCycleRecord,
  emptyNexusAutomationTargetCycleLedger,
  nexusAutomationTargetCycleLedgerPath,
  readNexusAutomationTargetCycleLedger,
  summarizeNexusAutomationTargetCycles,
} from "./nexusAutomationTargetCycle.js";
import {
  validateNexusAutomationConfig,
  type NexusAutomationConfig,
} from "./nexusAutomationConfig.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function automationConfig(value: unknown = {}): NexusAutomationConfig {
  const config = validateNexusAutomationConfig(value);
  if (!config) {
    throw new Error("Expected automation config");
  }

  return config;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation target cycles", () => {
  it("records target cycle facts with retention inside the project root", () => {
    const projectRoot = makeTempDir("dev-nexus-target-cycles-");
    const config = automationConfig({
      ledger: {
        retention: 2,
      },
      target: {
        id: "dogfood",
        objective: "Use the project until no eligible work remains.",
      },
    });

    expect(readNexusAutomationTargetCycleLedger(projectRoot, config)).toEqual(
      emptyNexusAutomationTargetCycleLedger(),
    );
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "demo",
        targetId: "dogfood",
        status: "started",
        eligibleWorkItemCount: 3,
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config,
      now: "2026-05-16T10:10:00.000Z",
      record: {
        id: "cycle-2",
        projectId: "demo",
        targetId: "dogfood",
        status: "dispatched",
        workItems: [
          {
            componentId: "core",
            id: "work-1",
            cycleStatus: "dispatched",
            agentProfileId: "codex-heavy",
          },
        ],
        notes: ["Coordinator dispatched one subagent."],
      },
    });
    const ledger = appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config,
      now: "2026-05-16T10:30:00.000Z",
      record: {
        id: "cycle-3",
        projectId: "demo",
        targetId: "dogfood",
        status: "blocked",
        blockers: ["Needs user decision."],
      },
    });

    expect(nexusAutomationTargetCycleLedgerPath(projectRoot, config)).toBe(
      path.join(projectRoot, ".dev-nexus", "automation", "target-cycles.json"),
    );
    expect(ledger.cycles.map((cycle) => cycle.id)).toEqual([
      "cycle-2",
      "cycle-3",
    ]);
    expect(readNexusAutomationTargetCycleLedger(projectRoot, config)).toMatchObject({
      updatedAt: "2026-05-16T10:30:00.000Z",
      cycles: [
        {
          id: "cycle-2",
          status: "dispatched",
          finishedAt: null,
          workItems: [
            {
              componentId: "core",
              id: "work-1",
              cycleStatus: "dispatched",
              agentProfileId: "codex-heavy",
            },
          ],
        },
        {
          id: "cycle-3",
          status: "blocked",
          finishedAt: "2026-05-16T10:30:00.000Z",
          blockers: ["Needs user decision."],
        },
      ],
    });
  });

  it("summarizes active and terminal target cycles", () => {
    const projectRoot = makeTempDir("dev-nexus-target-cycles-");
    const config = automationConfig();

    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "demo",
        status: "started",
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config,
      now: "2026-05-16T11:00:00.000Z",
      record: {
        id: "cycle-2",
        projectId: "demo",
        status: "completed",
      },
    });

    expect(summarizeNexusAutomationTargetCycles({ projectRoot, config }))
      .toMatchObject({
        cycleCount: 2,
        activeCycleCount: 1,
        completedCycleCount: 1,
        blockedCycleCount: 0,
        lastCycle: {
          id: "cycle-2",
          status: "completed",
        },
      });
  });

  it("rejects cycle ledger paths outside the project root", () => {
    expect(() =>
      automationConfig({
        target: {
          cycleLedgerPath: "../target-cycles.json",
        },
      }),
    ).toThrow(/cycleLedgerPath must be a project-relative path/);
  });
});
