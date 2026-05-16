import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  callDevNexusMcpTool,
  defaultNexusAutomationConfig,
  handleDevNexusMcpJsonRpcMessage,
  listDevNexusMcpTools,
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
      "work_item_create",
      "work_item_list",
      "work_item_get",
      "work_item_update",
      "work_item_comment",
      "work_item_set_status",
    ]);
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
