import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = path.resolve("plugins", "dev-nexus-codex");

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n");
}

describe("Codex DevNexus local plugin prototype", () => {
  it("declares a valid local Codex plugin manifest shape", () => {
    const manifest = readJson(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    );

    expect(manifest).toMatchObject({
      name: "dev-nexus-codex",
      version: "0.1.0-alpha.0",
      skills: "./skills",
      mcpServers: "./.mcp.json",
      license: "Apache-2.0",
      interface: {
        displayName: "DevNexus",
        category: "Productivity",
        developerName: "Evref BL",
      },
    });
    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest.interface.defaultPrompt).toHaveLength(3);
  });

  it("bundles the expected Codex workflow skills", () => {
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
      expect(contents).not.toContain("[TODO:");
    }
  });

  it("uses the adapter wrapper for MCP instead of a silent global dev-nexus", () => {
    const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
    expect(mcp).toEqual({
      mcpServers: {
        dev_nexus: {
          command: "node",
          args: [
            "./scripts/dev-nexus-codex-wrapper.mjs",
            "mcp-stdio",
          ],
          env: {
            DEV_NEXUS_AGENT_CLIENT: "codex",
          },
        },
      },
    });
  });

  it("includes repo-local marketplace fixture metadata", () => {
    const marketplace = readJson(
      path.join(pluginRoot, "fixtures", "codex-marketplace.json"),
    );

    expect(marketplace).toMatchObject({
      name: "dev-nexus-local",
      plugins: [
        {
          name: "dev-nexus-codex",
          source: {
            source: "local",
            path: "./plugins/dev-nexus-codex",
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
      ],
    });
  });

  it("keeps the prototype wrapper script syntactically valid", () => {
    const scriptPath = path.join(
      pluginRoot,
      "scripts",
      "dev-nexus-codex-wrapper.mjs",
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
