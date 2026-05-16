import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  getNexusAutomationStatus,
  nexusAutomationLockPath,
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
      lock: {
        ...defaultNexusAutomationConfig.lock,
        staleAfterMs: 60_000,
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

describe("nexus automation status", () => {
  it("reports selected work without creating run state or worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Check automation readiness",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      candidateCount: 1,
      selectedWorkItem: {
        id: "local-1",
        title: "Check automation readiness",
      },
      lock: {
        status: "none",
      },
      ledger: {
        runs: [],
      },
    });
    expect(result.preflight.every((check) => check.status === "passed")).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "automation")),
    ).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("reports agent launch readiness without selecting one work item", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const targetStatePath = path.join(
      projectRoot,
      ".dev-nexus",
      "automation",
      "target-state.md",
    );
    fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
    fs.writeFileSync(targetStatePath, "Current target state.\n", "utf8");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
          agent: {
            ...projectConfig().automation!.agent,
            maxConcurrentSubagents: 2,
          },
          target: {
            ...projectConfig().automation!.target,
            objective: "Keep working until all selected issues are resolved.",
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
      title: "Agent should choose",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      summary: "Agent launch ready with 1 eligible work item(s)",
      candidateCount: 1,
      eligibleWorkItems: [
        {
          id: "local-1",
          title: "Agent should choose",
        },
      ],
      target: {
        objective: "Keep working until all selected issues are resolved.",
        statePath: targetStatePath,
        stateExists: true,
        stateMarkdown: "Current target state.\n",
      },
      agent: {
        maxConcurrentSubagents: 2,
      },
      selectedWorkItem: null,
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("reports agent launch readiness grouped by configured components", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), { recursive: true });
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            workTracking: {
              provider: "local",
              storePath: primaryStorePath,
            },
            relationships: [],
          },
          {
            id: "addon",
            name: "Addon",
            kind: "git",
            role: "addon",
            remoteUrl: "git@example.invalid:demo/addon.git",
            defaultBranch: "main",
            sourceRoot: "components/addon",
            workTracking: {
              provider: "local",
              storePath: addonStorePath,
            },
            relationships: [
              {
                kind: "extends",
                componentId: "primary",
              },
            ],
          },
        ],
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Primary work",
      status: "ready",
      labels: ["automation"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: fixedClock("2026-05-16T09:05:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Addon work",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      candidateCount: 2,
      selectedWorkItem: null,
      components: [
        {
          id: "primary",
          role: "primary",
          workTracking: {
            provider: "local",
          },
          workTrackingCapabilities: {
            createItem: true,
            listItems: true,
            updateItem: true,
            comment: true,
          },
        },
        {
          id: "addon",
          role: "addon",
          workTrackingCapabilities: {
            createItem: true,
            listItems: true,
          },
          relationships: [
            {
              kind: "extends",
              componentId: "primary",
            },
          ],
        },
      ],
      componentEligibleWorkItems: [
        {
          componentId: "primary",
          workItems: [
            {
              title: "Primary work",
            },
          ],
        },
        {
          componentId: "addon",
          workItems: [
            {
              title: "Addon work",
            },
          ],
        },
      ],
    });
  });

  it("reports an active run lock before listing candidate work", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    const config = projectConfig();
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, config);
    const lockPath = nexusAutomationLockPath(projectRoot, config.automation!);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify(
        {
          runId: "run-active",
          owner: "scheduler",
          acquiredAt: "2026-05-16T09:59:00.000Z",
          expiresAt: "2026-05-16T10:30:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "locked",
      candidateCount: null,
      selectedWorkItem: null,
      lock: {
        status: "active",
        runId: "run-active",
        owner: "scheduler",
      },
    });
  });

  it("blocks readiness when a required dependency link source is missing", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
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
      title: "Blocked dependency task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "blocked",
      candidateCount: null,
      selectedWorkItem: null,
    });
    expect(result.preflight.at(-1)).toMatchObject({
      name: "dependencyLink:0",
      status: "failed",
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });
});
