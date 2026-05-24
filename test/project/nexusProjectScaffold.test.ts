import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  scaffoldNexusProject,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function minimalProjectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "project-1",
    name: "Project 1",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    },
    components: [
      {
        id: "primary",
        name: "Project 1",
        kind: "local",
        role: "primary",
        remoteUrl: null,
        defaultBranch: null,
        sourceRoot: ".",
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    ...overrides,
  };
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
      projectConfig: minimalProjectConfig({
        id: "project-1",
      }),
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
      projectConfig: minimalProjectConfig({
        id: "project-1",
      }),
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
      projectConfig: minimalProjectConfig({
        id: "project-1",
      }),
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

  it("materializes only Codex support for a Codex active target", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const projectConfig = minimalProjectConfig({
      id: "project-1",
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        defaultCorePack: false,
        items: [{ id: "handoff" }],
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
      mcp: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    });

    scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig,
      skills: projectConfig.skills,
      mcp: projectConfig.mcp,
    });

    expect(
      fs.existsSync(path.join(projectRoot, ".agents", "skills", "handoff")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".codex", "config.toml")),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".mcp.json"))).toBe(false);
  });

  it("materializes both native providers when both are active", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const projectConfig = minimalProjectConfig({
      id: "project-1",
      agentTargets: {
        active: [
          { provider: "codex" },
          { provider: "claude" },
        ],
      },
      skills: {
        defaultCorePack: false,
        items: [{ id: "handoff" }],
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
      mcp: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    });

    scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig,
      skills: projectConfig.skills,
      mcp: projectConfig.mcp,
    });

    expect(
      fs.existsSync(path.join(projectRoot, ".agents", "skills", "handoff")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".claude", "skills", "handoff")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".codex", "config.toml")),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".mcp.json"))).toBe(true);
  });

  it("materializes the generic project template layout without arity-one worktree special casing", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    fs.mkdirSync(path.join(projectRoot, ".git", "info"), { recursive: true });
    const projectConfig: NexusProjectConfig = {
      version: 1,
      id: "template-project",
      name: "Template Project",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: null,
        defaultBranch: "main",
      },
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          sourceRoot: "components/core",
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      automation: {
        ...defaultNexusAutomationConfig,
        mode: "agent_launch",
        target: {
          ...defaultNexusAutomationConfig.target,
          statePath: ".dev-nexus/automation/target-state.md",
        },
      },
      skills: {
        defaultCorePack: false,
        items: [{ id: "diagnose" }],
        agentTargets: [{ agent: "codex" }],
      },
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
    };

    const result = scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig,
      skills: projectConfig.skills,
      mcp: projectConfig.mcp,
    });

    expect(fs.existsSync(path.join(worktreesRoot, "core"))).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "README.md")),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(projectRoot, ".dev-nexus", "README.md"), "utf8"),
    ).toContain("Workspace Template Layout");
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "automation", "target-state.md"),
      ),
    ).toBe(true);
    expect(result.template.entries.map((entry) => entry.area)).toEqual(
      expect.arrayContaining([
        "workspace_state",
        "component_configuration",
        "target_state",
        "skills",
        "agent_mcp_projection",
      ]),
    );
    expect(result.template.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "component_configuration",
          owner: "user_authored",
          path: "components/core",
        }),
        expect.objectContaining({
          area: "workspace_state",
          owner: "local_runtime",
          path: "worktrees/core/",
        }),
        expect.objectContaining({
          area: "target_state",
          owner: "user_authored",
          path: ".dev-nexus/automation/target-state.md",
        }),
        expect.objectContaining({
          area: "skills",
          owner: "generated",
          path: ".agents/skills/",
        }),
        expect.objectContaining({
          area: "agent_mcp_projection",
          owner: "generated",
          path: ".codex/config.toml",
        }),
      ]),
    );
    expect(result.template.migrationNotes.join("\n")).toContain(
      "migration-only evidence",
    );
    expect(result.template.gitExcludeEntries).toEqual(
      expect.arrayContaining([
        ".dev-nexus/README.md",
        ".dev-nexus/runtime/",
        ".dev-nexus/host-setup/",
        ".dev-nexus/worktree-leases.json",
        ".dev-nexus/work-item-sync-runs.json",
        ".dev-nexus/automation/runs.json",
        ".dev-nexus/automation/run.lock",
        ".dev-nexus/automation/target-cycles.json",
        ".dev-nexus/automation/agent-launches/",
        "worktrees/",
      ]),
    );
  });

  it("writes local runtime excludes through Git worktree metadata", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const gitDir = makeTempDir("dev-nexus-gitdir-");
    fs.writeFileSync(path.join(projectRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");
    const worktreesRoot = path.join(projectRoot, "worktrees");

    const result = scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig: minimalProjectConfig({
        automation: defaultNexusAutomationConfig,
      }),
      skills: false,
      mcp: false,
    });

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = fs.readFileSync(excludePath, "utf8");
    expect(result.template.gitExcludePath).toBe(excludePath);
    expect(exclude).toContain(".dev-nexus/runtime/");
    expect(exclude).toContain(".dev-nexus/host-setup/");
    expect(exclude).toContain(".dev-nexus/worktree-leases.json");
    expect(exclude).toContain(".dev-nexus/work-item-sync-runs.json");
  });

  it("preserves existing target state when refreshing the template", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const targetStatePath = path.join(
      projectRoot,
      ".dev-nexus",
      "automation",
      "target-state.md",
    );
    fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
    fs.writeFileSync(targetStatePath, "Current target direction.\n", "utf8");
    const projectConfig: NexusProjectConfig = {
      version: 1,
      id: "template-project",
      name: "Template Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      components: [
        {
          id: "primary",
          name: "Primary",
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: ".",
          relationships: [],
        },
        {
          id: "addon",
          name: "Addon",
          kind: "local",
          role: "addon",
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: "components/addon",
          relationships: [
            {
              kind: "related",
              componentId: "primary",
            },
          ],
        },
      ],
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      automation: {
        ...defaultNexusAutomationConfig,
        target: {
          ...defaultNexusAutomationConfig.target,
          statePath: ".dev-nexus/automation/target-state.md",
        },
      },
    };

    scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig,
      skills: false,
      mcp: false,
    });

    expect(fs.readFileSync(targetStatePath, "utf8")).toBe(
      "Current target direction.\n",
    );
    expect(fs.existsSync(path.join(worktreesRoot, "primary"))).toBe(true);
    expect(fs.existsSync(path.join(worktreesRoot, "addon"))).toBe(true);
  });
});
