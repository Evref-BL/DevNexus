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
        ...defaultNexusAutomationConfig.agent,
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
    const targetStatePath = path.join(
      projectRoot,
      ".dev-nexus",
      "automation",
      "dogfood-target.md",
    );
    fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
    fs.writeFileSync(
      targetStatePath,
      "Current target state: split the plan into implementation issues.\n",
      "utf8",
    );
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          agent: {
            ...projectConfig().automation!.agent,
            coordinatorProfileId: "codex-deep",
            maxConcurrentSubagents: 3,
            profiles: [
              {
                id: "codex-deep",
                executor: "codex",
                model: "gpt-5.5",
                reasoning: "xhigh",
                command: "codex",
                args: ["exec", "--model", "gpt-5.5"],
              },
            ],
          },
          target: {
            ...defaultNexusAutomationConfig.target,
            id: "dogfood",
            objective: "Use DevNexus to work on itself until no eligible issue remains.",
            statePath: ".dev-nexus/automation/dogfood-target.md",
            maxCycles: 8,
            maxWorkItems: 25,
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
      expect(options.env.DEV_NEXUS_TARGET_ID).toBe("dogfood");
      expect(options.env.DEV_NEXUS_TARGET_STATE_FILE).toBe(targetStatePath);
      expect(options.env.DEV_NEXUS_TARGET_CYCLE_LEDGER_FILE).toBe(
        path.join(projectRoot, ".dev-nexus", "automation", "target-cycles.json"),
      );
      expect(options.env.DEV_NEXUS_COORDINATOR_PROFILE_ID).toBe("codex-deep");
      expect(options.env.DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS).toBe("3");
      expect(options.env.DEV_NEXUS_AGENT_RESULT_REQUIRED_FIELDS).toBe(
        "status,summary",
      );
      expect(options.env.DEV_NEXUS_AGENT_RESULT_OPTIONAL_FIELDS).toBe(
        "commitIds,verification,publicationDecision,error",
      );
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
        target: {
          id: "dogfood",
          objective: "Use DevNexus to work on itself until no eligible issue remains.",
          statePath: targetStatePath,
          stateExists: true,
          stateMarkdown:
            "Current target state: split the plan into implementation issues.\n",
          maxCycles: 8,
          maxWorkItems: 25,
        },
        agent: {
          coordinatorProfileId: "codex-deep",
          maxConcurrentSubagents: 3,
          profiles: [
            {
              id: "codex-deep",
              executor: "codex",
              model: "gpt-5.5",
              reasoning: "xhigh",
              command: "codex",
              args: ["exec", "--model", "gpt-5.5"],
            },
          ],
        },
        result: {
          file: options.env.DEV_NEXUS_AGENT_RESULT_FILE,
          requiredFields: ["status", "summary"],
          optionalFields: [
            "commitIds",
            "verification",
            "publicationDecision",
            "error",
          ],
          statuses: ["completed", "failed", "blocked"],
          verificationStatuses: ["passed", "failed", "not_run"],
          publicationDecisionTypes: [
            "not_decided",
            "local_only",
            "direct_integration",
            "review_handoff",
            "blocked",
          ],
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

  it("launches with component-scoped work items across multiple components", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
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

    const commandRunner: NexusAutomationCommandRunner = (_command, options) => {
      expect(options.env.DEV_NEXUS_COMPONENT_COUNT).toBe("2");
      expect(options.env.DEV_NEXUS_COMPONENT_IDS).toBe("primary,addon");
      expect(options.env.DEV_NEXUS_PRIMARY_COMPONENT_ID).toBe("primary");
      const context = JSON.parse(
        fs.readFileSync(options.env.DEV_NEXUS_AGENT_CONTEXT_FILE!, "utf8"),
      );
      expect(context.project).toMatchObject({
        id: "demo-project",
        componentCount: 2,
      });
      expect(context.components).toMatchObject([
        {
          id: "primary",
          role: "primary",
          workTracker: {
            provider: "local",
            configured: true,
          },
        },
        {
          id: "addon",
          role: "addon",
          relationships: [
            {
              kind: "extends",
              componentId: "primary",
            },
          ],
        },
      ]);
      expect(context.componentEligibleWorkItems).toMatchObject([
        {
          componentId: "primary",
          workItems: [
            {
              id: "local-1",
              title: "Primary work",
            },
          ],
        },
        {
          componentId: "addon",
          workItems: [
            {
              id: "local-1",
              title: "Addon work",
            },
          ],
        },
      ]);
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Component-aware launch complete",
        })}\n`,
        "utf8",
      );

      return {
        command: "codex run",
        cwd: options.cwd,
        stdout: "launched",
        stderr: "",
        exitCode: 0,
      };
    };

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-components-1",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner,
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      components: [
        {
          id: "primary",
          workTracking: {
            provider: "local",
          },
        },
        {
          id: "addon",
          workTracking: {
            provider: "local",
          },
        },
      ],
      componentEligibleWorkItems: [
        {
          componentId: "primary",
          workItems: [{ title: "Primary work" }],
        },
        {
          componentId: "addon",
          workItems: [{ title: "Addon work" }],
        },
      ],
    });
  });

  it("fails a successful agent command that does not write a result file", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs durable result",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-missing-result",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner: (command, options) => ({
          command,
          cwd: options.cwd,
          stdout: "agent exited",
          stderr: "",
          exitCode: 0,
        }),
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      summary: expect.stringContaining("Agent result file was not written"),
      launch: {
        error: expect.stringContaining("Agent result file was not written"),
        verification: [
          {
            command: "codex run",
            status: "passed",
          },
        ],
      },
    });
  });

  it("fails malformed agent result files before recording completion", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs valid result",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-invalid-result",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner: (command, options) => {
          fs.writeFileSync(
            options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
            `${JSON.stringify({ summary: "missing status" })}\n`,
            "utf8",
          );

          return {
            command,
            cwd: options.cwd,
            stdout: "agent exited",
            stderr: "",
            exitCode: 0,
          };
        },
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      summary: "Agent result file is invalid: agent result.status must be a non-empty string",
      launch: {
        error: "Agent result file is invalid: agent result.status must be a non-empty string",
        verification: [
          {
            command: "codex run",
            status: "passed",
          },
        ],
      },
    });
  });
});
