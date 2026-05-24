import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireNexusAutomationRunLock,
  appendNexusAutomationRunRecord,
  buildNexusAutomationWorkItemQuery,
  emptyNexusAutomationRunLedger,
  evaluateNexusAutomationBackoff,
  nexusAutomationLedgerPath,
  NexusAutomationError,
  readNexusAutomationRunLedger,
  releaseNexusAutomationRunLock,
  selectNexusAutomationWorkItem,
} from "../../src/automation/nexusAutomation.js";
import {
  validateNexusAutomationConfig,
  type NexusAutomationConfig,
} from "../../src/automation/nexusAutomationConfig.js";
import type { WorkItem } from "../../src/work-items/workTrackingTypes.js";

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

function workItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: "work-1",
    title: "Default work",
    status: "todo",
    provider: "local",
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation", () => {
  it("accepts configured eligible-work discovery mode", () => {
    expect(automationConfig({}).eligibleWorkMode).toBe("default");
    expect(automationConfig({ eligibleWorkMode: "discovery" }).eligibleWorkMode).toBe(
      "discovery",
    );
    expect(() => automationConfig({ eligibleWorkMode: "external" })).toThrow(
      /eligibleWorkMode must be default or discovery/,
    );
  });

  it("normalizes work item claim authority backend config", () => {
    expect(automationConfig({}).workItemClaims).toMatchObject({
      leaseDurationMs: 60 * 60 * 1000,
      heartbeatIntervalMs: 20 * 60 * 1000,
    });
    expect(automationConfig({}).workItemClaims.authority).toEqual({
      backend: "optimistic_tracker",
      postgres: {
        connectionProfileId: null,
      },
    });

    expect(
      automationConfig({
        workItemClaims: {
          authority: {
            backend: "postgres",
            postgres: {
              connectionProfileId: "shared-claims",
            },
          },
        },
      }).workItemClaims.authority,
    ).toEqual({
      backend: "postgres",
      postgres: {
        connectionProfileId: "shared-claims",
      },
    });

    expect(() =>
      automationConfig({
        workItemClaims: {
          authority: {
            backend: "sqlite",
          },
        },
      }),
    ).toThrow(
      /project config\.automation\.workItemClaims\.authority\.backend/,
    );
    expect(() =>
      automationConfig({
        workItemClaims: {
          leaseDurationMs: 60000,
          heartbeatIntervalMs: 45000,
        },
      }),
    ).toThrow(/heartbeatIntervalMs must be no more than half leaseDurationMs/);
  });

  it("builds a bounded tracker query and selects the first eligible work item", () => {
    const config = automationConfig({
      selector: {
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: ["blocked"],
        assignees: ["agent-1"],
        search: "import",
        limit: 5,
      },
    });

    expect(buildNexusAutomationWorkItemQuery(config)).toEqual({
      status: ["ready"],
      labels: ["automation"],
      assignees: ["agent-1"],
      search: "import",
      limit: 5,
    });
    expect(
      selectNexusAutomationWorkItem(
        [
          workItem({
            id: "work-1",
            title: "Import blocked item",
            status: "ready",
            labels: ["automation", "blocked"],
            assignees: ["agent-1"],
          }),
          workItem({
            id: "work-2",
            title: "Import workspace config",
            status: "ready",
            labels: ["automation"],
            assignees: ["agent-1"],
          }),
        ],
        config,
      )?.id,
    ).toBe("work-2");
  });

  it("records run ledger entries with retention inside the workspace root", () => {
    const projectRoot = makeTempDir("dev-nexus-automation-project-");
    const config = automationConfig({
      ledger: {
        retention: 2,
      },
    });

    expect(readNexusAutomationRunLedger(projectRoot, config)).toEqual(
      emptyNexusAutomationRunLedger(),
    );
    appendNexusAutomationRunRecord({
      projectRoot,
      config,
      now: "2026-05-15T09:00:00.000Z",
      record: {
        id: "run-1",
        projectId: "demo",
        status: "completed",
      },
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config,
      now: "2026-05-15T10:00:00.000Z",
      record: {
        id: "run-2",
        projectId: "demo",
        status: "failed",
        error: "Verification failed",
      },
    });
    const ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config,
      now: "2026-05-15T11:00:00.000Z",
      record: {
        id: "run-3",
        projectId: "demo",
        componentId: "addon",
        status: "blocked",
        nextRunNotBefore: "2026-05-15T12:00:00.000Z",
      },
    });

    expect(nexusAutomationLedgerPath(projectRoot, config)).toBe(
      path.join(projectRoot, ".dev-nexus", "automation", "runs.json"),
    );
    expect(ledger.runs.map((run) => run.id)).toEqual(["run-2", "run-3"]);
    expect(readNexusAutomationRunLedger(projectRoot, config)).toMatchObject({
      updatedAt: "2026-05-15T11:00:00.000Z",
      runs: [
        {
          id: "run-2",
          status: "failed",
          error: "Verification failed",
        },
        {
          id: "run-3",
          componentId: "addon",
          status: "blocked",
          nextRunNotBefore: "2026-05-15T12:00:00.000Z",
        },
      ],
    });
  });

  it("rejects automation state paths outside the workspace root", () => {
    const projectRoot = makeTempDir("dev-nexus-automation-project-");
    const config = automationConfig({
      ledger: {
        path: "../runs.json",
      },
    });

    expect(() => nexusAutomationLedgerPath(projectRoot, config)).toThrow(
      /must resolve inside the workspace root/,
    );
  });

  it("acquires, protects, releases, and replaces stale run locks", () => {
    const projectRoot = makeTempDir("dev-nexus-automation-project-");
    const config = automationConfig({
      lock: {
        staleAfterMs: 1000,
      },
    });

    const first = acquireNexusAutomationRunLock({
      projectRoot,
      config,
      runId: "run-1",
      owner: "agent",
      now: "2026-05-15T09:00:00.000Z",
    });
    expect(first).toMatchObject({
      replacedStaleLock: false,
      lock: {
        runId: "run-1",
        owner: "agent",
        expiresAt: "2026-05-15T09:00:01.000Z",
      },
    });
    expect(() =>
      acquireNexusAutomationRunLock({
        projectRoot,
        config,
        runId: "run-2",
        now: "2026-05-15T09:00:00.500Z",
      }),
    ).toThrow(NexusAutomationError);
    expect(releaseNexusAutomationRunLock({ projectRoot, config, runId: "run-2" }))
      .toBe(false);
    expect(releaseNexusAutomationRunLock({ projectRoot, config, runId: "run-1" }))
      .toBe(true);

    acquireNexusAutomationRunLock({
      projectRoot,
      config,
      runId: "run-3",
      now: "2026-05-15T10:00:00.000Z",
    });
    expect(
      acquireNexusAutomationRunLock({
        projectRoot,
        config,
        runId: "run-4",
        now: "2026-05-15T10:00:02.000Z",
      }),
    ).toMatchObject({
      replacedStaleLock: true,
      lock: {
        runId: "run-4",
      },
    });
  });

  it("computes bounded retry backoff and stops at the failure limit", () => {
    const config = automationConfig({
      backoff: {
        failureLimit: 3,
        baseDelayMs: 1000,
        maxDelayMs: 1500,
      },
    });

    expect(
      evaluateNexusAutomationBackoff(
        config,
        0,
        "2026-05-15T09:00:00.000Z",
      ),
    ).toMatchObject({
      shouldRun: true,
      retryAfter: null,
    });
    expect(
      evaluateNexusAutomationBackoff(
        config,
        1,
        "2026-05-15T09:00:00.000Z",
      ),
    ).toMatchObject({
      shouldRun: false,
      delayMs: 1000,
      retryAfter: "2026-05-15T09:00:01.000Z",
    });
    expect(
      evaluateNexusAutomationBackoff(
        config,
        2,
        "2026-05-15T09:00:00.000Z",
      ),
    ).toMatchObject({
      shouldRun: false,
      delayMs: 1500,
      retryAfter: "2026-05-15T09:00:01.500Z",
    });
    expect(
      evaluateNexusAutomationBackoff(
        config,
        3,
        "2026-05-15T09:00:00.000Z",
      ),
    ).toMatchObject({
      shouldRun: false,
      retryAfter: null,
      reason: "automation failure limit reached: 3",
    });
  });
});
