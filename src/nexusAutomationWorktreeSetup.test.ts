import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  materializeNexusAutomationWorktreeSetup,
  materializeNexusProjectSkills,
  preflightNexusAutomationWorktreeSetup,
  type GitCommandResult,
  type GitRunner,
  type NexusAutomationConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function automationConfig(
  overrides: Partial<NexusAutomationConfig> = {},
): NexusAutomationConfig {
  return {
    ...defaultNexusAutomationConfig,
    setup: {
      dependencyLinks: [
        {
          source: "node_modules",
          target: "node_modules",
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return {
        args: argsArray,
        stdout: path.join(cwd ?? "", ".git", "info", "exclude"),
        stderr: "",
        exitCode: 0,
      };
    }

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation worktree setup", () => {
  it("preflights dependency link safety before worktree mutation", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"), { recursive: true });

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig(),
      }),
    ).toEqual([
      {
        name: "dependencyLink:0",
        status: "passed",
        message: "Dependency link node_modules -> node_modules is safe to materialize",
      },
    ]);

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [
              {
                source: "..",
                target: "node_modules",
                required: true,
              },
            ],
          },
        }),
      })[0],
    ).toMatchObject({
      name: "dependencyLink:0",
      status: "failed",
    });
  });

  it("links dependencies into a generated worktree and excludes them", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ok\n", "utf8");
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreePath,
      automationConfig: automationConfig(),
      gitRunner: fakeGitRunner(gitCalls),
    });

    expect(result.links).toMatchObject([
      {
        source: "node_modules",
        target: "node_modules",
        sourcePath: sourceDependency,
        targetPath: path.join(worktreePath, "node_modules"),
        status: "linked",
      },
    ]);
    expect(fs.readFileSync(path.join(worktreePath, "node_modules", "tool.txt"), "utf8"))
      .toBe("ok\n");
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe("node_modules/\n");
    expect(gitCalls).toEqual([
      {
        args: ["rev-parse", "--git-path", "info/exclude"],
        cwd: worktreePath,
      },
    ]);
  });

  it("materializes a generated worker context bundle and excludes it", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const worktreePath = path.join(worktreesRoot, "codex-demo-project-local-19-run-1");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const ownership = {
      componentId: "primary",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/demo-project/local-19/run-1",
      baseRef: "main",
      workItem: {
        id: "local-19",
        title: "Materialize worker context bundles for component worktrees",
      },
    };

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      gitRunner: fakeGitRunner(gitCalls),
      context: {
        project: {
          id: "demo-project",
          name: "Demo Project",
          root: projectRoot,
        },
        ownership,
      },
    });

    const contextDir = path.join(worktreePath, ".dev-nexus", "context");
    const contextJsonPath = path.join(contextDir, "context.json");
    const briefingPath = path.join(contextDir, "briefing.md");
    expect(result.context).toMatchObject({
      contextJsonPath,
      briefingPath,
    });
    expect(JSON.parse(fs.readFileSync(contextJsonPath, "utf8"))).toMatchObject({
      project: {
        id: "demo-project",
        name: "Demo Project",
        root: projectRoot,
      },
      ownership,
    });
    expect(fs.readFileSync(briefingPath, "utf8")).toContain(
      "Source and Git commands run from the component checkout root",
    );
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe(".dev-nexus/context/\n");
    expect(gitCalls).toEqual([
      {
        args: ["rev-parse", "--git-path", "info/exclude"],
        cwd: worktreePath,
      },
    ]);
  });

  it("refreshes missing and stale worker skill projections from project-managed skills", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const worktreePath = path.join(worktreesRoot, "codex-demo-project-local-20-run-1");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    const selectedSkills = {
      defaultCorePack: false,
      items: [{ id: "tdd" }, { id: "handoff" }],
    };
    materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: selectedSkills,
      excludeFromGit: false,
    });
    const staleSkillPath = path.join(
      worktreePath,
      ".agents",
      "skills",
      "tdd",
      "SKILL.md",
    );
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true });
    fs.writeFileSync(staleSkillPath, "# stale local projection\n", "utf8");
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const ownership = {
      componentId: "primary",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/demo-project/local-20/run-1",
      baseRef: "main",
      workItem: {
        id: "local-20",
        title: "Project local skills into prepared worker contexts",
      },
    };

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      skillsConfig: {
        ...selectedSkills,
        agentTargets: [{ agent: "codex" }],
      },
      gitRunner: fakeGitRunner(gitCalls),
      context: {
        project: {
          id: "demo-project",
          name: "Demo Project",
          root: projectRoot,
        },
        ownership,
      },
    });

    expect(result.skillProjections).toHaveLength(1);
    expect(result.skillProjections[0]).toMatchObject({
      agent: "codex",
      projectManagedSkillsRoot: path.join(projectRoot, ".dev-nexus", "skills"),
      skillsDirectory: path.join(worktreePath, ".agents", "skills"),
      sourceControl: "support",
    });
    expect(result.skillProjections[0].skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tdd",
          beforeStatus: "stale",
          afterStatus: "present",
          refreshed: true,
        }),
        expect.objectContaining({
          id: "handoff",
          beforeStatus: "missing",
          afterStatus: "present",
          refreshed: true,
        }),
      ]),
    );
    expect(fs.readFileSync(staleSkillPath, "utf8")).toContain(
      "Test-Driven Development (TDD)",
    );
    expect(
      fs.readFileSync(
        path.join(worktreePath, ".agents", "skills", "handoff", "SKILL.md"),
        "utf8",
      ),
    ).toContain("Continuation workflow");
    expect(
      fs.existsSync(
        path.join(
          worktreePath,
          ".agents",
          "skills",
          "tdd",
          "dev-nexus.skill.json",
        ),
      ),
    ).toBe(false);
    expect(JSON.parse(fs.readFileSync(result.context!.contextJsonPath, "utf8")))
      .toMatchObject({
        skills: {
          projectManagedRoot: path.join(projectRoot, ".dev-nexus", "skills"),
          agentNativeProjections: [
            {
              agent: "codex",
              skillsDirectory: path.join(worktreePath, ".agents", "skills"),
              sourceControl: "support",
              skills: [
                {
                  id: "tdd",
                  sourceSkillRoot: path.join(projectRoot, ".dev-nexus", "skills", "tdd"),
                  projectedSkillRoot: path.join(
                    worktreePath,
                    ".agents",
                    "skills",
                    "tdd",
                  ),
                  skillPath: staleSkillPath,
                },
                {
                  id: "handoff",
                  sourceSkillRoot: path.join(
                    projectRoot,
                    ".dev-nexus",
                    "skills",
                    "handoff",
                  ),
                  projectedSkillRoot: path.join(
                    worktreePath,
                    ".agents",
                    "skills",
                    "handoff",
                  ),
                  skillPath: path.join(
                    worktreePath,
                    ".agents",
                    "skills",
                    "handoff",
                    "SKILL.md",
                  ),
                },
              ],
            },
          ],
        },
      });
    const excludeEntries = fs
      .readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8")
      .trim()
      .split(/\r?\n/u);
    expect(excludeEntries).toContain(".dev-nexus/context/");
    expect(excludeEntries).toContain(".agents/skills/");
    expect(fs.existsSync(path.join(sourceRoot, ".agents"))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, ".dev-nexus"))).toBe(false);
  });

  it("rejects setup for a worktree outside the component worktrees root", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const componentWorktreesRoot = path.join(
      makeTempDir("dev-nexus-component-worktrees-"),
      "dev-nexus",
    );
    const outsideWorktreePath = makeTempDir("dev-nexus-setup-outside-");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"), { recursive: true });

    expect(() =>
      materializeNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreesRoot: componentWorktreesRoot,
        worktreePath: outsideWorktreePath,
        automationConfig: automationConfig(),
        gitRunner: fakeGitRunner([]),
      }),
    ).toThrow(/inside worktreesRoot/);
  });
});
