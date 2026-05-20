import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeNexusProjectAgentMcpConfig,
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

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      platform: "linux",
    });
    const refreshed = fs.readFileSync(codexConfigPath, "utf8");

    expect(result.agentTargets).toMatchObject([
      {
        agent: "codex",
        serverName: "dev_nexus",
        command: "dev-nexus",
        args: ["mcp-stdio"],
        sourceControl: "support",
        configPath: codexConfigPath,
        provider: "codex",
        configFormat: "toml",
        configSchema: "codex.mcp_servers",
        configStatus: "materialized",
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
      platform: "linux",
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
      platform: "linux",
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
        configSchema: "claude.mcpServers",
        configStatus: "materialized",
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

  it("materializes OpenCode MCP config using the documented workspace config shape", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    initGitInfo(projectRoot);
    const opencodeConfigPath = path.join(projectRoot, "opencode.json");
    fs.writeFileSync(
      opencodeConfigPath,
      `${JSON.stringify({
        tools: {
          existing: false,
        },
        mcp: {
          other: {
            type: "local",
            command: ["other-tool"],
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      platform: "linux",
      mcpConfig: {
        agentTargets: [
          {
            agent: "opencode",
          },
        ],
      },
    });
    const refreshed = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf8"));

    expect(result.agentTargets).toMatchObject([
      {
        agent: "opencode",
        provider: "opencode",
        serverName: "dev_nexus",
        configPath: opencodeConfigPath,
        configPathRelative: "opencode.json",
        configFormat: "json",
        configSchema: "opencode.mcp.local",
        configStatus: "materialized",
        trustSemantics: {
          mode: "opencode_permission_config",
        },
      },
    ]);
    expect(refreshed.tools.existing).toBe(false);
    expect(refreshed.mcp.other).toMatchObject({
      type: "local",
      command: ["other-tool"],
    });
    expect(refreshed.mcp.dev_nexus).toEqual({
      type: "local",
      command: ["dev-nexus", "mcp-stdio"],
      enabled: true,
    });
    expect(fs.readFileSync(path.join(projectRoot, ".git", "info", "exclude"), "utf8"))
      .toContain("opencode.json");
  });

  it("reports custom provider targets as manual capability gaps", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      platform: "linux",
      mcpConfig: {
        agentTargets: [
          {
            agent: "custom-agent",
            provider: "custom",
            configPath: "docs/custom-agent-mcp.md",
            configFormat: "manual",
            configSchema: "custom.manual",
          },
        ],
      },
    });

    expect(result.agentTargets).toMatchObject([
      {
        agent: "custom-agent",
        provider: "custom",
        configPath: path.join(projectRoot, "docs", "custom-agent-mcp.md"),
        configFormat: "manual",
        configSchema: "custom.manual",
        configStatus: "manual",
        capabilityGaps: [
          {
            id: "manual-provider-config-required",
            severity: "warning",
          },
        ],
      },
    ]);
    expect(result.capabilityGaps).toMatchObject([
      {
        agent: "custom-agent",
        provider: "custom",
        id: "manual-provider-config-required",
      },
    ]);
    expect(fs.existsSync(path.join(projectRoot, "docs", "custom-agent-mcp.md")))
      .toBe(false);
  });

  it("reports unsupported provider config combinations without writing files", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      platform: "linux",
      mcpConfig: {
        agentTargets: [
          {
            agent: "codex-json",
            provider: "codex",
            configFormat: "json",
            configPath: ".codex/config.json",
          },
        ],
      },
    });

    expect(result.agentTargets).toMatchObject([
      {
        agent: "codex-json",
        provider: "codex",
        configStatus: "unsupported",
        capabilityGaps: [
          {
            id: "unsupported-provider-config",
            severity: "blocked",
          },
        ],
      },
    ]);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.json")))
      .toBe(false);
  });

  it("uses the Windows cmd shim form for the DevNexus MCP command", () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const codexConfigPath = path.join(projectRoot, ".codex", "config.toml");

    const result = materializeNexusProjectAgentMcpConfig({
      projectRoot,
      platform: "win32",
    });
    const refreshed = fs.readFileSync(codexConfigPath, "utf8");

    expect(result.agentTargets[0]).toMatchObject({
      command: "dev-nexus.cmd",
      commandResolution: {
        originalCommand: "dev-nexus",
        command: "dev-nexus.cmd",
        strategy: "windows_cmd_shim",
      },
    });
    expect(refreshed).toContain('command = "dev-nexus.cmd"');
  });
});
