import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = path.resolve("plugins", "dev-nexus-claude");

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("Claude Code DevNexus local plugin prototype", () => {
  it("declares a valid local Claude Code plugin manifest shape", () => {
    const manifest = readJson(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    );

    expect(manifest).toMatchObject({
      name: "dev-nexus-claude",
      displayName: "DevNexus",
      version: "0.1.0-alpha.0",
      description: "Local Claude Code plugin prototype for DevNexus workspaces.",
      skills: "./skills",
      mcpServers: "./.mcp.json",
      license: "Apache-2.0",
    });
    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest.keywords).toContain("claude-code");
  });

  it("bundles the expected Claude Code workflow skills", () => {
    const expectedSkills = [
      "dev-nexus-setup",
      "dev-nexus-status",
      "dev-nexus-refresh-agent-support",
      "dev-nexus-prepare-worktree",
      "dev-nexus-handoff",
    ];

    for (const skillId of expectedSkills) {
      const skillPath = path.join(pluginRoot, "skills", skillId, "SKILL.md");
      const contents = readText(skillPath);
      expect(contents).toContain("---\nname: ");
      expect(contents).toContain("description: ");
      expect(contents).toContain("Claude Code");
      expect(contents).not.toContain("[TODO:");
    }
  });

  it("uses the adapter wrapper and Claude plugin variables for MCP", () => {
    const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
    expect(mcp).toEqual({
      mcpServers: {
        dev_nexus: {
          command: "node",
          args: [
            "${CLAUDE_PLUGIN_ROOT}/scripts/dev-nexus-claude-wrapper.mjs",
            "mcp-stdio",
          ],
          env: {
            DEV_NEXUS_AGENT_CLIENT: "claude",
          },
        },
      },
    });
  });

  it("documents local Claude Code loading and plugin data behavior", () => {
    const readme = readText(path.join(pluginRoot, "README.md"));

    expect(readme).toContain("claude --plugin-dir ./plugins/dev-nexus-claude");
    expect(readme).toContain("${CLAUDE_PLUGIN_DATA}");
    expect(readme).toContain("does not install packages");
  });

  it("keeps the prototype wrapper script syntactically valid", () => {
    const scriptPath = path.join(
      pluginRoot,
      "scripts",
      "dev-nexus-claude-wrapper.mjs",
    );
    const result = childProcess.spawnSync(
      process.execPath,
      ["--check", scriptPath],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
