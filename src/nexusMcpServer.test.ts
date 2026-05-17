import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  callDevNexusMcpTool,
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  handleDevNexusMcpJsonRpcMessage,
  listDevNexusMcpTools,
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

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "mcp-demo",
    name: "MCP Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:mcp/demo.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [
      {
        id: "primary",
        name: "MCP Demo",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:mcp/demo.git",
        defaultBranch: "main",
        sourceRoot: "source",
        workTracking: {
          provider: "local",
        },
        relationships: [],
      },
    ],
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
      },
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Use DevNexus to work on itself until no eligible issue remains.",
      },
    },
    ...overrides,
  };
}

function toolJson(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0]!.text);
}

function fakeGitRunner(repositoryPath: string): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, "codex/shared-coordination\n");
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, "abc123def456\n");
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return ok(argsArray, "origin/codex/shared-coordination\n");
    }
    if (joined === "status --porcelain=v1") {
      return ok(argsArray, "");
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, "0\t0\n");
    }
    if (joined === "rev-parse --verify main") {
      return ok(argsArray, "target123\n");
    }
    if (joined === "rev-parse --verify codex/shared-coordination") {
      return ok(argsArray, "abc123def456\n");
    }
    if (joined === "merge-base main codex/shared-coordination") {
      return ok(argsArray, "base123\n");
    }
    if (joined === "diff --name-only main...codex/shared-coordination") {
      return ok(argsArray, "src/nexusCoordination.ts\n");
    }
    if (joined === "merge-tree --write-tree --quiet main codex/shared-coordination") {
      return ok(argsArray, "");
    }
    if (
      joined ===
      "merge-tree --write-tree --name-only --messages main codex/shared-coordination"
    ) {
      return ok(argsArray, "src/nexusCoordination.ts\n");
    }
    if (joined === "range-diff base123..main base123..codex/shared-coordination") {
      return ok(argsArray, "");
    }

    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("DevNexus MCP server", () => {
  it("lists generic project, automation, and work-item tools", () => {
    expect(listDevNexusMcpTools().map((tool) => tool.name)).toEqual([
      "project_status",
      "automation_status",
      "eligible_work",
      "agent_profiles",
      "target_cycle_list",
      "target_cycle_record",
      "target_report",
      "coordination_status",
      "coordination_handoff",
      "coordination_integrate",
      "work_item_create",
      "work_item_list",
      "work_item_get",
      "work_item_update",
      "work_item_comment",
      "work_item_set_status",
    ]);
  });

  it("reports generic plugin capabilities through the agent profile surface", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        plugins: [
          {
            id: "analysis-tools",
            capabilities: [
              {
                kind: "projected_skill",
                id: "deep-review-skill",
                skillId: "deep-review",
                description: "Project a review skill into configured agents.",
                targetAgents: ["codex"],
              },
              {
                kind: "environment_hint",
                id: "cache-dir",
                variable: "EXAMPLE_CACHE_DIR",
                description: "Optional cache directory used by plugin tools.",
              },
            ],
          },
        ],
      }),
    );

    const result = toolJson(
      await callDevNexusMcpTool("agent_profiles", { projectRoot }),
    );

    expect(result).toMatchObject({
      ok: true,
      pluginCapabilities: [
        {
          pluginId: "analysis-tools",
          capabilityCount: 2,
          capabilities: [
            {
              kind: "projected_skill",
              id: "deep-review-skill",
              skillId: "deep-review",
              targetAgents: ["codex"],
            },
            {
              kind: "environment_hint",
              id: "cache-dir",
              variable: "EXAMPLE_CACHE_DIR",
              required: false,
            },
          ],
        },
      ],
    });
  });

  it("records and reports coordination handoffs through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-14");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate shared work",
      status: "in_progress",
    });

    const handoff = toolJson(
      await callDevNexusMcpTool(
        "coordination_handoff",
        {
          projectRoot,
          workItemId: "local-1",
          status: "ready",
          hostId: "windows-devbox",
          agentId: "codex",
          changedAreas: ["src/nexusCoordination.ts"],
          decisions: ["Use advisory records."],
          verificationSummary: "focused tests passed",
          integrationPreference: "direct_integration",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:00:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );
    const status = toolJson(
      await callDevNexusMcpTool(
        "coordination_status",
        {
          projectRoot,
          workItemId: "local-1",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(handoff).toMatchObject({
      ok: true,
      record: {
        status: "ready",
        branch: "codex/shared-coordination",
        pushed: true,
      },
      comment: {
        id: "local-comment-1",
      },
    });
    expect(status).toMatchObject({
      ok: true,
      status: {
        git: {
          dirty: false,
          pushed: true,
        },
        handoffs: {
          records: [
            {
              status: "ready",
              stale: false,
            },
          ],
        },
      },
    });
  });

  it("returns coordination integration plan shape through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-15");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Plan coordination integration",
      status: "in_progress",
    });

    await callDevNexusMcpTool(
      "coordination_handoff",
      {
        projectRoot,
        workItemId: "local-1",
        status: "ready",
        changedAreas: ["src/nexusCoordination.ts"],
        decisions: ["Keep integration planning read-only."],
        currentPath: worktreePath,
      },
      {
        now: fixedClock("2026-05-16T10:00:00.000Z"),
        gitRunner: fakeGitRunner(worktreePath),
      },
    );
    const plan = toolJson(
      await callDevNexusMcpTool(
        "coordination_integrate",
        {
          projectRoot,
          workItemId: "local-1",
          targetBranch: "main",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(plan).toMatchObject({
      ok: true,
      plan: {
        mutatesSource: false,
        target: {
          ref: "main",
          commit: "target123",
        },
        branches: [
          {
            branch: "codex/shared-coordination",
            merge: {
              status: "clean",
              changedFiles: ["src/nexusCoordination.ts"],
            },
          },
        ],
        suggestedOrder: [
          {
            branch: "codex/shared-coordination",
          },
        ],
      },
    });
  });

  it("serves project, automation, and work-item calls without specialization adapters", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const projectStatus = toolJson(
      await callDevNexusMcpTool("project_status", {
        project: projectRoot,
      }),
    );
    expect(projectStatus).toMatchObject({
      ok: true,
      project: {
        id: "mcp-demo",
        projectRoot,
        components: [
          {
            id: "primary",
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
        ],
      },
    });

    const created = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          title: "Split the plan",
          status: "ready",
          labels: ["automation"],
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    expect(created.workItem).toMatchObject({
      id: "local-1",
      title: "Split the plan",
      status: "ready",
    });

    const automationStatus = toolJson(
      await callDevNexusMcpTool(
        "automation_status",
        {
          projectRoot,
        },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    expect(automationStatus).toMatchObject({
      ok: true,
      status: "ready",
      target: {
        id: "dogfood",
      },
      eligibleWorkItems: [
        {
          id: "local-1",
        },
      ],
    });

    const eligibleWork = toolJson(
      await callDevNexusMcpTool(
        "eligible_work",
        {
          projectRoot,
        },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    expect(eligibleWork).toMatchObject({
      ok: true,
      project: {
        id: "mcp-demo",
      },
      eligibleWorkItemCount: 1,
      components: [
        {
          componentId: "primary",
          workItems: [
            {
              id: "local-1",
              title: "Split the plan",
            },
          ],
        },
      ],
    });
    expect(eligibleWork.projectConfig).toBeUndefined();

    const agentProfiles = toolJson(
      await callDevNexusMcpTool("agent_profiles", {
        projectRoot,
      }),
    );
    expect(agentProfiles).toMatchObject({
      ok: true,
      automationMode: "agent_launch",
      coordinatorProfileId: null,
      maxConcurrentSubagents: 1,
      safety: {
        profile: "local",
      },
      profiles: [],
    });
    expect(agentProfiles.projectConfig).toBeUndefined();

    const updated = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        id: "local-1",
        status: "in_progress",
      }),
    );
    expect(updated.workItem).toMatchObject({
      id: "local-1",
      status: "in_progress",
    });

    const comment = toolJson(
      await callDevNexusMcpTool("work_item_comment", {
        projectRoot,
        id: "local-1",
        body: "Issue slicing started.",
      }),
    );
    expect(comment.comment).toMatchObject({
      id: "local-comment-1",
      body: "Issue slicing started.",
    });

    const listed = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        status: "in_progress",
      }),
    );
    expect(listed.workItems).toMatchObject([
      {
        id: "local-1",
        status: "in_progress",
      },
    ]);
  });

  it("records target cycle facts through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const recorded = toolJson(
      await callDevNexusMcpTool(
        "target_cycle_record",
        {
          projectRoot,
          cycleId: "cycle-1",
          runId: "run-1",
          status: "dispatched",
          summary: "Coordinator dispatched work.",
          eligibleWorkItemCount: 2,
          workItems: [
            {
              componentId: "primary",
              id: "local-1",
              cycleStatus: "selected",
              agentProfileId: "codex-coordinator",
              notes: "Selected for the bounded batch.",
            },
            {
              componentId: "primary",
              id: "local-2",
              cycleStatus: "dispatched",
              agentProfileId: "codex-local",
              notes: "Subagent launched.",
            },
            {
              componentId: "addon",
              id: "local-3",
              cycleStatus: "in_progress",
              agentProfileId: "codex-local",
              notes: "Focused tests running.",
            },
            {
              componentId: "addon",
              id: "local-4",
              cycleStatus: "completed",
              agentProfileId: "codex-local",
              notes: "Verification passed.",
            },
            {
              componentId: "tools",
              id: "local-5",
              cycleStatus: "blocked",
              agentProfileId: "codex-local",
              notes: "Waiting for credentials.",
            },
            {
              componentId: "tools",
              id: "local-6",
              cycleStatus: "skipped",
              agentProfileId: "codex-local",
              notes: "Dependency remained blocked.",
            },
          ],
          notes: ["One subagent launched."],
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    const listed = toolJson(
      await callDevNexusMcpTool("target_cycle_list", {
        projectRoot,
      }),
    );

    expect(recorded).toMatchObject({
      ok: true,
      record: {
        id: "cycle-1",
        targetId: "dogfood",
        runId: "run-1",
        status: "dispatched",
        finishedAt: null,
        eligibleWorkItemCount: 2,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "selected",
            agentProfileId: "codex-coordinator",
            notes: "Selected for the bounded batch.",
          },
          {
            componentId: "primary",
            id: "local-2",
            cycleStatus: "dispatched",
            agentProfileId: "codex-local",
          },
          {
            componentId: "addon",
            id: "local-3",
            cycleStatus: "in_progress",
            agentProfileId: "codex-local",
          },
          {
            componentId: "addon",
            id: "local-4",
            cycleStatus: "completed",
            agentProfileId: "codex-local",
          },
          {
            componentId: "tools",
            id: "local-5",
            cycleStatus: "blocked",
            agentProfileId: "codex-local",
          },
          {
            componentId: "tools",
            id: "local-6",
            cycleStatus: "skipped",
            agentProfileId: "codex-local",
          },
        ],
      },
    });
    expect(listed.ledger.cycles).toHaveLength(1);
  });

  it("builds target reports through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    await callDevNexusMcpTool(
      "target_cycle_record",
      {
        projectRoot,
        cycleId: "cycle-1",
        status: "completed",
        summary: "Target completed.",
        eligibleWorkItemCount: 0,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "completed",
          },
        ],
      },
      { now: fixedClock("2026-05-16T10:00:00.000Z") },
    );
    const report = toolJson(
      await callDevNexusMcpTool(
        "target_report",
        {
          projectRoot,
        },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );

    expect(report).toMatchObject({
      ok: true,
      report: {
        status: "completed",
        statusReason: "Latest target cycle cycle-1 is completed",
        project: {
          id: "mcp-demo",
        },
        workItemSummary: {
          uniqueReferences: [
            {
              componentId: "primary",
              id: "local-1",
              latestCycleStatus: "completed",
            },
          ],
        },
        relaunchDecision: {
          type: "stop",
          eligibleWorkItemCount: 0,
          latestCycleId: "cycle-1",
          latestRunId: null,
        },
      },
    });
  });

  it("targets component-scoped work items through MCP tool arguments", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), {
      recursive: true,
    });
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
            remoteUrl: "git@example.invalid:mcp/demo.git",
            defaultBranch: "main",
            sourceRoot: "source",
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items-primary.json",
            },
            relationships: [],
          },
          {
            id: "addon",
            name: "Addon",
            kind: "git",
            role: "addon",
            remoteUrl: "git@example.invalid:mcp/addon.git",
            defaultBranch: "main",
            sourceRoot: "components/addon",
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items-addon.json",
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

    const created = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          componentId: "addon",
          title: "Addon MCP task",
          status: "ready",
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    const addonList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        componentId: "addon",
      }),
    );
    const primaryList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
      }),
    );
    const qualifiedGet = toolJson(
      await callDevNexusMcpTool("work_item_get", {
        projectRoot,
        id: "addon:local-1",
      }),
    );
    const qualifiedUpdate = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        id: "addon:local-1",
        title: "Updated addon MCP task",
      }),
    );
    const qualifiedComment = toolJson(
      await callDevNexusMcpTool("work_item_comment", {
        projectRoot,
        id: "addon:local-1",
        body: "Component-qualified reference worked.",
      }),
    );
    const qualifiedStatus = toolJson(
      await callDevNexusMcpTool("work_item_set_status", {
        projectRoot,
        id: "addon:local-1",
        status: "done",
      }),
    );

    expect(created.workItem).toMatchObject({
      id: "local-1",
      title: "Addon MCP task",
    });
    expect(qualifiedGet.workItem).toMatchObject({
      id: "local-1",
      title: "Addon MCP task",
    });
    expect(qualifiedUpdate.workItem).toMatchObject({
      id: "local-1",
      title: "Updated addon MCP task",
    });
    expect(qualifiedComment.comment).toMatchObject({
      body: "Component-qualified reference worked.",
    });
    expect(qualifiedStatus.workItem).toMatchObject({
      id: "local-1",
      status: "done",
    });
    expect(addonList.workItems).toMatchObject([
      {
        id: "local-1",
        title: "Addon MCP task",
      },
    ]);
    expect(primaryList.workItems).toEqual([]);
  });

  it("handles MCP JSON-RPC initialize, tools/list, and tools/call", async () => {
    const initialized = await handleDevNexusMcpJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "dev-nexus",
        },
      },
    });

    const listed = await handleDevNexusMcpJsonRpcMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(listed).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "project_status",
          }),
        ]),
      },
    });

    const called = await handleDevNexusMcpJsonRpcMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "unknown",
        arguments: {},
      },
    });
    expect(called).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: true,
      },
    });
  });
});
