import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeNexusProjectAgentMcpConfig,
  NexusAgentMcpConfigError,
} from "./nexusAgentMcpConfig.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function initGitInfo(projectRoot: string): void {
  fs.mkdirSync(path.join(projectRoot, ".git", "info"), { recursive: true });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus agent MCP config", () => {
  it("materializes Codex MCP config while preserving unrelated TOML", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    initGitInfo(projectRoot);
    const codexConfigPath = path.join(projectRoot, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
    fs.writeFileSync(
      codexConfigPath,
      [
        "[profiles.default]",
        'model = "gpt-example"',
        "",
        "[mcp_servers.other]",
        'command = "other-tool"',
        "",
        "[mcp_servers.dev_nexus]",
        'command = "old-dev-nexus"',
        "args = []",
        'default_tools_approval_mode = "approve"',
        "",
        "[tools]",
        "web_search = true",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = materializeNexusProjectAgentMcpConfig({ projectRoot });
    const refreshed = fs.readFileSync(codexConfigPath, "utf8");

    expect(result.agentTargets).toMatchObject([
      {
        agent: "codex",
        serverName: "dev_nexus",
        command: "dev-nexus",
        args: ["mcp-stdio"],
        sourceControl: "support",
        configPath: codexConfigPath,
      },
    ]);
    expect(refreshed).toContain("[profiles.default]");
    expect(refreshed).toContain("[mcp_servers.other]");
    expect(refreshed).toContain("[tools]");
    expect(refreshed).not.toContain("old-dev-nexus");
    expect(refreshed).toContain("[mcp_servers.dev_nexus]");
    expect(refreshed).toContain('command = "dev-nexus"');
    expect(refreshed).toContain('args = ["mcp-stdio"]');
    expect(refreshed).toContain('default_tools_approval_mode = "approve"');
    expect(fs.readFileSync(path.join(projectRoot, ".git", "info", "exclude"), "utf8"))
      .toContain(".codex/config.toml");
  });

  it("writes configured Codex MCP approval defaults", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const codexConfigPath = path.join(projectRoot, ".codex", "config.toml");

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      mcpConfig: {
        defaultToolsApprovalMode: "approve",
      },
    });
    const refreshed = fs.readFileSync(codexConfigPath, "utf8");

    expect(result.agentTargets).toMatchObject([
      {
        agent: "codex",
        defaultToolsApprovalMode: "approve",
      },
    ]);
    expect(refreshed).toContain('default_tools_approval_mode = "approve"');
  });

  it("materializes Claude MCP config while preserving unrelated servers", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    initGitInfo(projectRoot);
    const claudeConfigPath = path.join(projectRoot, ".mcp.json");
    fs.writeFileSync(
      claudeConfigPath,
      `${JSON.stringify({
        mcpServers: {
          other: {
            command: "other-tool",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      mcpConfig: {
        agentTargets: [
          {
            agent: "claude",
            sourceControl: "source",
          },
        ],
      },
    });
    const refreshed = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));

    expect(result.agentTargets).toMatchObject([
      {
        agent: "claude",
        serverName: "dev_nexus",
        configPath: claudeConfigPath,
        sourceControl: "source",
        configFormat: "json",
      },
    ]);
    expect(refreshed.mcpServers.other).toMatchObject({
      command: "other-tool",
    });
    expect(refreshed.mcpServers.dev_nexus).toEqual({
      command: "dev-nexus",
      args: ["mcp-stdio"],
    });
    expect(fs.existsSync(path.join(projectRoot, ".git", "info", "exclude")))
      .toBe(false);
  });

  it("rejects unsupported agent MCP targets", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");

    expect(() =>
      materializeNexusProjectAgentMcpConfig({
        projectRoot,
        mcpConfig: {
          agentTargets: [
            {
              agent: "unknown-agent",
            },
          ],
        },
      }),
    ).toThrow(NexusAgentMcpConfigError);
  });
});
