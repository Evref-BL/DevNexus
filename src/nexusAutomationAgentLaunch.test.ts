import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalWorkTrackerProvider,
  createNexusAutomationAgentCommandLauncher,
  defaultLocalWorkTrackingStorePath,
  defaultNexusAutomationConfig,
  loadLocalWorkTrackingStore,
  loadProjectConfig,
  readNexusAutomationRunLedger,
  runNexusAutomationAgentLaunchOnce,
  saveProjectConfig,
  type NexusAutomationCommandRunner,
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
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: ["blocked"],
        limit: 5,
      },
      agent: {
        command: "codex run",
        timeoutMs: 120000,
        relaunch: {
          whileEligible: true,
        },
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

describe("nexus automation agent launch", () => {
  it("launches a configured agent with context without selecting or mutating work", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Let an agent choose",
      status: "ready",
      labels: ["automation"],
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Excluded task",
      status: "ready",
      labels: ["automation", "blocked"],
    });
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      expect(command).toBe("codex run");
      expect(options.cwd).toBe(projectRoot);
      expect(options.timeoutMs).toBe(120000);
      expect(options.env.DEV_NEXUS_AUTOMATION_MODE).toBe("agent_launch");
      expect(options.env.DEV_NEXUS_ELIGIBLE_WORK_ITEM_IDS).toBe("local-1");
      const context = JSON.parse(
        fs.readFileSync(options.env.DEV_NEXUS_AGENT_CONTEXT_FILE!, "utf8"),
      );
      expect(context).toMatchObject({
        runId: "agent-run-1",
        projectRoot,
        automation: {
          mode: "agent_launch",
          eligibleWorkItemCount: 1,
        },
        eligibleWorkItems: [
          {
            id: "local-1",
            title: "Let an agent choose",
          },
        ],
      });
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Agent reported completion",
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
            reason: "agent reported a review handoff",
          },
        })}\n`,
        "utf8",
      );

      return {
        command,
        cwd: options.cwd,
        stdout: "launched",
        stderr: "",
        exitCode: 0,
      };
    };

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-run-1",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner,
        timeoutMs: 120000,
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      summary: "Agent reported completion",
      eligibleWorkItems: [
        {
          id: "local-1",
        },
      ],
      launch: {
        commitIds: ["abc123"],
        verification: [
          {
            command: "codex run",
            status: "passed",
          },
          {
            command: "npm test",
            status: "passed",
          },
        ],
      },
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items,
    ).toMatchObject([
      {
        id: "local-1",
        status: "ready",
      },
      {
        id: "local-2",
        status: "ready",
      },
    ]);
    expect(
      readNexusAutomationRunLedger(projectRoot, loadProjectConfig(projectRoot).automation!),
    ).toMatchObject({
      runs: [
        {
          id: "agent-run-1",
          status: "completed",
          workItemId: null,
          worktreePath: null,
          commitIds: ["abc123"],
          summary: "Agent reported completion",
          verification: [
            {
              command: "codex run",
              status: "passed",
            },
            {
              command: "npm test",
              status: "passed",
            },
          ],
          publicationDecision: {
            type: "review_handoff",
            remote: "origin",
            targetBranch: "main",
          },
        },
      ],
    });
  });
});
