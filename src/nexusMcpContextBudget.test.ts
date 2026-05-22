import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusMcpContextBudgetReport,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "budget-demo",
    name: "Budget Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:budget/demo.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [
      {
        id: "primary",
        name: "Budget Demo",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:budget/demo.git",
        defaultBranch: "main",
        sourceRoot: "source",
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    automation: defaultNexusAutomationConfig,
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("DevNexus MCP context budget", () => {
  it("reports gateway visible impact and saved-token delta", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-budget-impact-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        exposure: "gateway",
        agentTargets: [{ agent: "codex" }],
      },
    }));

    const report = buildNexusMcpContextBudgetReport({ projectRoot });

    expect(report.contextImpact.gatewaySurfaceToolCount).toBe(5);
    expect(report.contextImpact.gatewayRoutedToolCount).toBeGreaterThan(20);
    expect(report.contextImpact.visibleEstimatedTokens).toBeLessThan(
      report.contextImpact.withoutGatewayEstimatedTokens,
    );
    expect(report.contextImpact.savedTokens).toBeGreaterThan(0);
  });

  it("applies gateway grouping policy to plugin budget impact", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-budget-groups-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        gateway: {
          includedTools: ["workflow_runtime.workflow_search"],
          excludedTools: ["workflow_runtime.workflow_delete"],
        },
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "workflow-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "workflow-mcp",
              serverName: "workflow_runtime",
              command: "node",
              args: ["workflow-server.js"],
              tools: [
                {
                  name: "workflow_search",
                  description: "Search workflow records.",
                },
                {
                  name: "workflow_delete",
                  description: "Delete workflow records.",
                },
              ],
            },
          ],
        },
      ],
    }));

    const report = buildNexusMcpContextBudgetReport({ projectRoot });
    const workflowServer = report.pluginDeclaredServers.find(
      (server) => server.serverName === "workflow_runtime",
    );

    expect(workflowServer?.toolCount).toBe(1);
    expect(workflowServer?.declaredTools.map((tool) => tool.toolName)).toEqual([
      "workflow_search",
    ]);
    expect(report.contextImpact.gatewayRoutedToolCount).toBe(1);
  });
});
