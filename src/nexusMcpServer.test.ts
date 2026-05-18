import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  callDevNexusMcpTool,
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  defaultLocalWorkTrackingStorePath,
  devNexusCoreMcpToolNames,
  handleDevNexusMcpJsonRpcMessage,
  listDevNexusMcpTools,
  listMcpInputSchemaProviderIssues,
  nexusWorkerContextJsonPath,
  readNexusAutomationRunLedger,
  saveProjectConfig,
  StdioJsonRpcTransport,
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

function jsonRpcFrame(message: unknown): Buffer {
  const body = JSON.stringify(message);
  return Buffer.from(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    "utf8",
  );
}

function parseJsonRpcFrame(frame: Buffer): unknown {
  const headerEnd = frame.indexOf("\r\n\r\n");
  expect(headerEnd).toBeGreaterThanOrEqual(0);
  const header = frame.slice(0, headerEnd).toString("utf8");
  const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
  expect(lengthMatch).not.toBeNull();
  const bodyStart = headerEnd + 4;
  return JSON.parse(
    frame.slice(bodyStart, bodyStart + Number(lengthMatch![1])).toString("utf8"),
  );
}

async function nextChunk(stream: PassThrough): Promise<Buffer> {
  return new Promise((resolve) => {
    stream.once("data", (chunk: Buffer | string) => {
      resolve(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
    });
  });
}

async function waitForMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
      "setup_flow_list",
      "setup_plan",
      "setup_check",
      "setup_record",
      "target_cycle_list",
      "target_cycle_record",
      "target_report",
      "current_agent_adopt",
      "current_agent_record",
      "worktree_prepare",
      "coordination_status",
      "coordination_handoff",
      "coordination_integrate",
      "coordination_request",
      "work_item_create",
      "work_item_list",
      "work_item_get",
      "work_item_update",
      "work_item_comment",
      "work_item_set_status",
      "work_item_link",
      "work_item_show_links",
      "work_item_unlink",
      "work_item_sync_plan",
      "work_item_sync_execute",
    ]);
  });

  it("keeps the core MCP ownership list aligned with the advertised tools", () => {
    expect(devNexusCoreMcpToolNames).toEqual(
      listDevNexusMcpTools().map((tool) => tool.name),
    );
  });

  it("returns guard details for guarded shared-checkout MCP mutations", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const result = await callDevNexusMcpTool(
      "work_item_set_status",
      {
        projectRoot,
        id: "local-1",
        status: "done",
      },
      {
        gitRunner: fakeGitRunner(projectRoot),
        sharedCheckoutGuard: "enforce",
      },
    );
    const payload = toolJson(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      ok: false,
      guard: {
        ok: false,
        classification: "shared_project_checkout",
        mutationClass: "local_tracker",
      },
    });
    expect(fs.existsSync(defaultLocalWorkTrackingStorePath(projectRoot))).toBe(false);
  });

  it("lists provider-compatible tool input schemas", () => {
    const issues = listDevNexusMcpTools().flatMap((tool) =>
      listMcpInputSchemaProviderIssues(tool.inputSchema).map((issue) => ({
        tool: tool.name,
        ...issue,
      })),
    );

    expect(issues).toEqual([]);
  });

  it("prepares project-meta worktrees through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-worktree-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner: GitRunner = (args, cwd) => {
      const argsArray = [...args];
      gitCalls.push({ args: argsArray, cwd });
      if (argsArray[0] === "worktree" && argsArray[1] === "add") {
        fs.mkdirSync(argsArray[4]!, { recursive: true });
      }
      if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
        return ok(argsArray, path.join(cwd ?? "", ".git", "info", "exclude"));
      }
      return ok(argsArray, "");
    };

    const prepared = toolJson(
      await callDevNexusMcpTool(
        "worktree_prepare",
        {
          projectRoot,
          projectMeta: true,
          topic: "parallel chat",
          worktreeName: "parallel-chat",
        },
        {
          gitRunner,
          now: fixedClock("2026-05-17T08:00:00.000Z"),
        },
      ),
    );

    expect(prepared).toMatchObject({
      ok: true,
      scope: "project",
      component: null,
      worktree: {
        componentId: "mcp-demo",
        branchName: "codex/mcp-demo/parallel-chat",
        baseRef: "main",
      },
    });
    expect(prepared.worktree.worktreePath).toBe(
      path.join(projectRoot, "worktrees", "mcp-demo", "parallel-chat"),
    );
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/mcp-demo/parallel-chat",
        path.join(projectRoot, "worktrees", "mcp-demo", "parallel-chat"),
        "main",
      ],
      cwd: projectRoot,
    });
  });

  it("prepares component worktrees from component-qualified MCP work item ids with metadata", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-worktree-");
    const primarySourceRoot = path.join(projectRoot, "source");
    const addonSourceRoot = path.join(projectRoot, "components", "addon");
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    fs.mkdirSync(primarySourceRoot, { recursive: true });
    fs.mkdirSync(addonSourceRoot, { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
            defaultBranch: "main",
            sourceRoot: "source",
            worktreesRoot: "worktrees/primary",
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
            worktreesRoot: "worktrees/addon",
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
      config: { provider: "local", storePath: addonStorePath },
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Prepare addon worker",
      description: "Carry this description into worker context.",
      status: "ready",
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner: GitRunner = (args, cwd) => {
      const argsArray = [...args];
      gitCalls.push({ args: argsArray, cwd });
      if (argsArray[0] === "worktree" && argsArray[1] === "add") {
        fs.mkdirSync(argsArray[4]!, { recursive: true });
      }
      if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
        return ok(argsArray, path.join(cwd ?? "", ".git", "info", "exclude"));
      }
      return ok(argsArray, "");
    };

    const prepared = toolJson(
      await callDevNexusMcpTool(
        "worktree_prepare",
        {
          projectRoot,
          workItemId: "addon:local-1",
        },
        {
          gitRunner,
          now: fixedClock("2026-05-17T08:00:00.000Z"),
        },
      ),
    );

    expect(prepared).toMatchObject({
      ok: true,
      scope: "component",
      component: {
        id: "addon",
      },
      worktree: {
        componentId: "addon",
        branchName: "codex/addon/local-1",
        baseRef: "main",
        workItem: {
          id: "local-1",
          title: "Prepare addon worker",
        },
      },
    });
    expect(prepared.worktree.worktreePath).toBe(
      path.join(projectRoot, "worktrees", "addon", "codex-addon-local-1"),
    );
    const context = JSON.parse(
      fs.readFileSync(
        nexusWorkerContextJsonPath(prepared.worktree.worktreePath),
        "utf8",
      ),
    );
    expect(context.worktree.workItem).toMatchObject({
      id: "local-1",
      title: "Prepare addon worker",
      description: "Carry this description into worker context.",
    });
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/addon/local-1",
        path.join(projectRoot, "worktrees", "addon", "codex-addon-local-1"),
        "main",
      ],
      cwd: addonSourceRoot,
    });
  });

  it("builds guided setup plans through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-setup-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        id: "mac-demo",
        name: "Mac Demo",
        repo: {
          kind: "git",
          remoteUrl: "git@github.com-bot:ExampleOrg/mac-demo.git",
          defaultBranch: "main",
        },
      }),
    );

    const listed = toolJson(await callDevNexusMcpTool("setup_flow_list", {}));
    const planned = toolJson(
      await callDevNexusMcpTool("setup_plan", {
        projectRoot,
        flowId: "join-existing-project",
        platform: "macos",
      }),
    );

    expect(listed.flows).toContainEqual(
      expect.objectContaining({
        id: "join-existing-project",
      }),
    );
    expect(planned).toMatchObject({
      ok: true,
      plan: {
        flow: {
          id: "join-existing-project",
        },
        project: {
          id: "mac-demo",
        },
      },
    });
    expect(planned.plan.steps.map((step: { id: string }) => step.id)).toContain(
      "configure-automation-auth-profile",
    );
  });

  it("adopts and records current-agent runs through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: {
        ...projectConfig().automation!,
        agent: {
          ...projectConfig().automation!.agent,
          maxConcurrentSubagents: 2,
        },
      },
    });
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "MCP adoptable task",
      status: "ready",
      labels: ["automation"],
    });

    const adopted = toolJson(
      await callDevNexusMcpTool(
        "current_agent_adopt",
        {
          projectRoot,
          runId: "mcp-current-1",
          owner: "mcp-host",
        },
        { now: fixedClock("2026-05-17T10:00:00.000Z") },
      ),
    );

    expect(adopted).toMatchObject({
      ok: true,
      status: "started",
      shouldProceed: true,
      environment: {
        DEV_NEXUS_CURRENT_AGENT_ADOPTION: "true",
        DEV_NEXUS_RUN_ID: "mcp-current-1",
        DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS: "2",
      },
      result: {
        statuses: ["completed", "failed", "blocked", "skipped"],
      },
    });

    const recorded = toolJson(
      await callDevNexusMcpTool(
        "current_agent_record",
        {
          projectRoot,
          runId: "mcp-current-1",
          result: {
            status: "completed",
            summary: "MCP current agent completed",
            commitIds: ["abc123"],
            verification: [
              {
                command: "npm test",
                status: "passed",
                summary: "focused tests passed",
              },
            ],
          },
        },
        { now: fixedClock("2026-05-17T10:10:00.000Z") },
      ),
    );

    expect(recorded).toMatchObject({
      ok: true,
      status: "completed",
      result: {
        commitIds: ["abc123"],
      },
    });
    expect(
      readNexusAutomationRunLedger(projectRoot, config.automation!).runs.at(-1),
    ).toMatchObject({
      id: "mcp-current-1",
      status: "completed",
      commitIds: ["abc123"],
    });
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

  it("reports codex app-server profiles through MCP without host-local values", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          agent: {
            ...projectConfig().automation!.agent,
            profiles: [
              {
                id: "codex-app-server",
                executor: "codex",
                executorMode: "app_server",
                intendedUse: "subagent",
                model: null,
                reasoning: null,
                command: null,
                args: [],
                appServer: {
                  mode: "connect",
                  command: null,
                  args: [],
                  endpoint: "http://127.0.0.1:17655",
                  ephemeralThreadDefault: false,
                  localPolicy: {
                    hostLocalSafetyHints: ["connects_to_local_service"],
                  },
                },
              },
            ],
          },
        },
      }),
    );

    const response = await callDevNexusMcpTool("agent_profiles", { projectRoot });
    const rawOutput = response.content[0]!.text;
    const result = toolJson(response);

    expect(result.profiles).toEqual([
      expect.objectContaining({
        id: "codex-app-server",
        executorMode: "app_server",
        appServer: {
          mode: "connect",
          commandConfigured: false,
          argsCount: 0,
          endpointScope: "loopback",
          ephemeralThreadDefault: false,
          allowNonLoopbackEndpoint: false,
          hostLocalSafetyHints: ["connects_to_local_service"],
        },
      }),
    ]);
    expect(rawOutput).not.toContain("127.0.0.1:17655");
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

  it("records coordination requests through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-17");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate external review",
      status: "in_progress",
    });

    const request = toolJson(
      await callDevNexusMcpTool(
        "coordination_request",
        {
          projectRoot,
          workItemId: "local-1",
          intent: "approval",
          question: "Approve the mocked external request slice?",
          target: "github-issue:22",
          responseStatus: "approved",
          responseSummary: "Approved by reviewer comment.",
          responder: "reviewer-a",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-17T10:00:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(request).toMatchObject({
      ok: true,
      record: {
        intent: "approval",
        status: "approved",
        target: {
          kind: "github_issue",
          provider: "github",
          value: "22",
        },
        provider: {
          provider: "github",
          surface: "issue",
          mode: "draft",
          posted: false,
          credentialsUsed: false,
        },
        response: {
          status: "approved",
          summary: "Approved by reviewer comment.",
        },
      },
      comment: {
        id: "local-comment-1",
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

  it("returns coordination integration tracker diagnostics through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-61");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{ malformed local tracker store\n", "utf8");

    const result = toolJson(
      await callDevNexusMcpTool(
        "coordination_integrate",
        {
          projectRoot,
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          kind: "coordination_tracker_read_failure",
          componentId: "primary",
          trackerId: "default",
          provider: "local",
          storePath: path.resolve(storePath),
          operation: "readCoordinationHandoffs",
          stage: "parse",
        },
      ],
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

  it("returns project status diagnostics for plugin MCP core tool overlap", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-plugin-overlap-");
    fs.writeFileSync(
      path.join(projectRoot, "dev-nexus.project.json"),
      `${JSON.stringify({
        version: 1,
        id: "overlap-demo",
        name: "Overlap Demo",
        home: null,
        plugins: [
          {
            id: "workflow-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "workflow-mcp",
                serverName: "workflow_tools",
                tools: [{ name: "work_item_list" }],
              },
            ],
          },
        ],
      }, null, 2)}\n`,
    );

    const result = toolJson(
      await callDevNexusMcpTool("project_status", {
        project: projectRoot,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "plugin id workflow-tools server workflow_tools duplicate tools: work_item_list",
      ),
    });
    expect(result.error).toContain(
      "Generic DevNexus operations belong to dev_nexus",
    );
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

  it("targets explicit and tracker-qualified work trackers through MCP tool arguments", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
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
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-primary.json",
                },
              },
              {
                id: "mirror",
                name: "Mirror",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-mirror.json",
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );

    const defaultCreated = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          title: "Default MCP task",
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    const mirrorCreated = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          trackerId: "mirror",
          title: "Mirror MCP task",
        },
        { now: fixedClock("2026-05-16T10:01:00.000Z") },
      ),
    );
    const defaultList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
      }),
    );
    const mirrorList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        trackerId: "mirror",
      }),
    );
    const qualifiedGet = toolJson(
      await callDevNexusMcpTool("work_item_get", {
        projectRoot,
        id: "mirror:local-1",
      }),
    );
    const explicitUpdate = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        trackerId: "mirror",
        id: "local-1",
        title: "Updated mirror MCP task",
      }),
    );
    const externalRefStatus = toolJson(
      await callDevNexusMcpTool("work_item_set_status", {
        projectRoot,
        trackerId: "mirror",
        externalRef: {
          provider: "local",
          itemId: "local-1",
        },
        status: "done",
      }),
    );

    expect(defaultCreated.workItem).toMatchObject({
      title: "Default MCP task",
      trackerRef: {
        trackerId: "primary",
        default: true,
      },
    });
    expect(mirrorCreated.workItem).toMatchObject({
      title: "Mirror MCP task",
      trackerRef: {
        trackerId: "mirror",
        default: false,
      },
    });
    expect(defaultList.workItems).toMatchObject([
      {
        title: "Default MCP task",
        trackerRef: {
          trackerId: "primary",
        },
      },
    ]);
    expect(mirrorList.workItems).toMatchObject([
      {
        title: "Mirror MCP task",
        trackerRef: {
          trackerId: "mirror",
        },
      },
    ]);
    expect(qualifiedGet.workItem).toMatchObject({
      title: "Mirror MCP task",
      trackerRef: {
        trackerId: "mirror",
      },
    });
    expect(explicitUpdate.workItem).toMatchObject({
      title: "Updated mirror MCP task",
      trackerRef: {
        trackerId: "mirror",
      },
    });
    expect(externalRefStatus.workItem).toMatchObject({
      id: "local-1",
      status: "done",
      trackerRef: {
        trackerId: "mirror",
      },
    });
  });

  it("links, shows, and unlinks work-item tracker references through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
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
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-primary.json",
                },
              },
              {
                id: "github",
                name: "GitHub",
                enabled: true,
                roles: ["mirror", "coordination"],
                workTracking: {
                  provider: "github",
                  host: "github.com",
                  repository: {
                    owner: "example",
                    name: "mcp-demo",
                    id: "repo-1",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );

    const linked = toolJson(
      await callDevNexusMcpTool(
        "work_item_link",
        {
          projectRoot,
          logicalItemId: "local-46",
          trackerId: "github",
          itemId: "github-issue-42",
          itemNumber: 42,
          webUrl: "https://github.com/example/mcp-demo/issues/42",
        },
        { now: fixedClock("2026-05-18T08:00:00.000Z") },
      ),
    );
    const updated = toolJson(
      await callDevNexusMcpTool(
        "work_item_link",
        {
          projectRoot,
          logicalItemId: "local-46",
          trackerId: "github",
          itemId: "github-issue-42",
          itemNumber: 42,
          nodeId: "I_kwDOMcpUpdated",
          webUrl: "https://github.com/example/mcp-demo/issues/42#updated",
        },
        { now: fixedClock("2026-05-18T08:01:00.000Z") },
      ),
    );
    const shown = toolJson(
      await callDevNexusMcpTool("work_item_show_links", {
        projectRoot,
        logicalItemId: "local-46",
      }),
    );
    const unlinked = toolJson(
      await callDevNexusMcpTool(
        "work_item_unlink",
        {
          projectRoot,
          logicalItemId: "local-46",
          trackerId: "github",
          itemId: "github-issue-42",
          reason: "Wrong external issue",
        },
        { now: fixedClock("2026-05-18T08:05:00.000Z") },
      ),
    );
    const afterUnlink = toolJson(
      await callDevNexusMcpTool("work_item_show_links", {
        projectRoot,
        logicalItemId: "local-46",
      }),
    );

    expect(linked).toMatchObject({
      ok: true,
      action: "linked",
      reference: {
        trackerId: "github",
        provider: "github",
        repositoryOwner: "example",
        repositoryName: "mcp-demo",
        itemId: "github-issue-42",
      },
    });
    expect(updated).toMatchObject({
      ok: true,
      action: "updated",
      record: {
        references: [
          {
            itemId: "github-issue-42",
            nodeId: "I_kwDOMcpUpdated",
          },
        ],
      },
    });
    expect(shown).toMatchObject({
      ok: true,
      references: [
        {
          trackerId: "github",
          itemId: "github-issue-42",
          webUrl: "https://github.com/example/mcp-demo/issues/42#updated",
        },
      ],
    });
    expect(unlinked).toMatchObject({
      ok: true,
      removedReference: {
        trackerId: "github",
        itemId: "github-issue-42",
      },
      audit: {
        action: "unlinked",
        reason: "Wrong external issue",
      },
    });
    expect(afterUnlink).toMatchObject({
      ok: true,
      references: [],
    });
  });

  it("returns dry-run work-item sync plans through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
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
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-primary.json",
                },
              },
              {
                id: "mirror",
                name: "Mirror",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-mirror.json",
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: {
        provider: "local",
        storePath: ".dev-nexus/work-items-primary.json",
      },
    }).createWorkItem({
      projectRoot,
      title: "Mirror through MCP",
      status: "ready",
      labels: ["sync"],
    });

    const toolNames = listDevNexusMcpTools().map((tool) => tool.name);
    const result = toolJson(
      await callDevNexusMcpTool(
        "work_item_sync_plan",
        {
          projectRoot,
          componentId: "primary",
          sourceTrackerId: "primary",
          targetTrackerId: "mirror",
          filters: {
            status: ["ready"],
            labels: ["sync"],
          },
          fieldSet: ["title", "status"],
        },
        { now: fixedClock("2026-05-18T09:00:00.000Z") },
      ),
    );

    expect(toolNames).toContain("work_item_sync_plan");
    expect(result).toMatchObject({
      ok: true,
      plan: {
        dryRun: true,
        sourceTracker: {
          trackerId: "primary",
        },
        targetTracker: {
          trackerId: "mirror",
        },
        creates: [
          {
            source: {
              title: "Mirror through MCP",
            },
            targetDetection: "unlinked",
          },
        ],
        counts: {
          creates: 1,
        },
      },
    });
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

  it("waits for a split stdio frame body without recursively reprocessing the header", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioJsonRpcTransport(
      async (message) => ({
        jsonrpc: "2.0",
        id: message.id,
        result: { method: message.method },
      }),
      { stdin, stdout },
    );
    const started = transport.start();
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`);
    await waitForMicrotask();
    expect(stdout.read()).toBeNull();

    const response = nextChunk(stdout);
    stdin.write(body);

    expect(parseJsonRpcFrame(await response)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { method: "tools/list" },
    });
    stdin.end();
    await started;
  });

  it("handles newline-delimited JSON-RPC over stdio", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioJsonRpcTransport(
      async (message) => ({
        jsonrpc: "2.0",
        id: message.id,
        result: { method: message.method },
      }),
      { stdin, stdout },
    );
    const started = transport.start();
    const response = nextChunk(stdout);

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    })}\n`);

    expect(JSON.parse((await response).toString("utf8"))).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { method: "initialize" },
    });
    stdin.end();
    await started;
  });
});
