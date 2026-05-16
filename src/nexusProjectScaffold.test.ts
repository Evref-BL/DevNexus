import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus project scaffold", () => {
  it("creates the worktrees root and runs extension project-file hooks", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");

    const result = scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig: {
        id: "project-1",
      },
      extensions: [
        {
          id: "example",
          name: "Example",
          installProjectFiles(context) {
            return {
              projectRoot: context.projectRoot,
              projectId: context.projectConfig.id,
            };
          },
        },
      ],
    });

    expect(fs.existsSync(worktreesRoot)).toBe(true);
    expect(result).toMatchObject({
      projectRoot,
      worktreesRoot,
      extensionResults: {
        example: {
          projectRoot,
          projectId: "project-1",
        },
      },
    });
    expect(result.skills.installed.map((skill) => skill.id)).toContain(
      "diagnose",
    );
  });

  it("materializes extension-contributed skills", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");

    const result = scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig: {
        id: "project-1",
      },
      skills: {
        defaultCorePack: false,
      },
      extensions: [
        {
          id: "example",
          name: "Example",
          projectSkills() {
            return [
              {
                manifest: {
                  id: "example-skill",
                  name: "example-skill",
                  description: "Example extension skill.",
                  version: "0.1.0",
                  license: "Apache-2.0",
                  source: {
                    type: "curated",
                    uri: "example:skills",
                  },
                  supportedAgents: ["codex"],
                  materialization: "copy",
                  sourceControl: "support",
                },
                files: {
                  "SKILL.md":
                    "---\nname: example-skill\ndescription: Example extension skill.\n---\n",
                },
              },
            ];
          },
        },
      ],
    });

    expect(result.skills.installed.map((skill) => skill.id)).toEqual([
      "example-skill",
    ]);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "example-skill", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("materializes configured agent MCP files", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    fs.mkdirSync(path.join(projectRoot, ".git", "info"), { recursive: true });

    const result = scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig: {
        id: "project-1",
      },
      mcp: {
        agentTargets: [
          {
            agent: "codex",
          },
        ],
      },
    });

    expect(result.agentMcp.agentTargets).toMatchObject([
      {
        agent: "codex",
      },
    ]);
    expect(
      fs.existsSync(path.join(projectRoot, ".codex", "config.toml")),
    ).toBe(true);
  });
});
