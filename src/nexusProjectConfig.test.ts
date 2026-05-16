import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  devNexusProjectConfigFileName,
  loadProjectConfig,
  NexusConfigError,
  projectConfigPath,
  projectWorktreesRootPath,
  resolveNexusAgentConfig,
  saveProjectConfig,
  validateProjectConfig,
} from "./nexusProjectConfig.js";

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

describe("project config", () => {
  it("validates and persists project config files", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "project");
    const config = {
      version: 1 as const,
      id: "my-project",
      name: "My Project",
      home: "C:\\dev\\code\\.dev-nexus",
      repo: {
        kind: "git" as const,
        remoteUrl: "https://github.com/example/my-project.git",
        defaultBranch: "main",
        sourceRoot: "source",
      },
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git" as const,
          role: "primary" as const,
          remoteUrl: "https://github.com/example/my-project.git",
          defaultBranch: "main",
          sourceRoot: "source",
          worktreesRoot: "worktrees/core",
          workTracking: {
            provider: "github" as const,
            repository: {
              owner: "example",
              name: "my-project",
            },
          },
          verification: {
            focusedCommands: ["npm test"],
            requirePassing: true,
          },
          publication: {
            strategy: "review_handoff" as const,
            remote: "origin",
            targetBranch: "main",
          },
          relationships: [],
        },
        {
          id: "addon",
          name: "Addon",
          kind: "local" as const,
          role: "addon" as const,
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: "components/addon",
          relationships: [
            {
              kind: "extends" as const,
              componentId: "core",
            },
          ],
        },
      ],
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: "vk-project-1",
      },
      workTracking: {
        provider: "github" as const,
        repository: {
          owner: "example",
          name: "my-project",
        },
      },
      extensions: {
        "example-module": {
          enabled: true,
        },
      },
      agent: {
        executor: "CODEX",
        model: "gpt-5.4",
        reasoning: "high",
      },
      skills: {
        materialization: "copy" as const,
        sourceControl: "support" as const,
        agentTargets: [
          {
            agent: "codex",
          },
          {
            agent: "claude",
            directory: ".claude/skills",
            sourceControl: "source" as const,
          },
        ],
        items: [
          {
            id: "diagnose",
            enabled: true,
          },
          {
            id: "experimental-review",
            enabled: false,
            version: "0.2.0",
            materialization: "reference" as const,
          },
        ],
      },
    };

    expect(validateProjectConfig(config)).toEqual(config);
    expect(saveProjectConfig(projectRoot, config)).toBe(
      path.join(projectRoot, devNexusProjectConfigFileName),
    );
    expect(loadProjectConfig(projectRoot)).toEqual(config);
    expect(projectConfigPath(projectRoot)).toBe(
      path.join(projectRoot, devNexusProjectConfigFileName),
    );
  });

  it("defaults legacy project configs to the current explicit JSON shape", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "legacy-project",
        name: "Legacy Project",
        kanban: {
          provider: "vibe-kanban",
        },
      }),
    ).toEqual({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      components: [
        {
          id: "primary",
          name: "Legacy Project",
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
    });
  });

  it("resolves agent configuration using issue, project, home, then fallback precedence", () => {
    expect(
      resolveNexusAgentConfig({
        fallback: {
          executor: "CODEX",
          model: "profile-default",
          reasoning: "medium",
        },
        home: {
          agent: {
            model: "gpt-5.4",
          },
        },
        project: {
          agent: {
            reasoning: "high",
          },
        },
        issue: {
          model: "gpt-5.5",
        },
      }),
    ).toEqual({
      executor: "CODEX",
      model: "gpt-5.5",
      reasoning: "high",
    });
  });

  it("accepts supported work tracking providers", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "local-tracked-project",
        name: "Local Tracked Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/work-items.json",
        },
      }).workTracking,
    ).toEqual({
      provider: "local",
      storePath: ".dev-nexus/work-items.json",
    });

    expect(
      validateProjectConfig({
        version: 1,
        id: "jira-tracked-project",
        name: "Jira Tracked Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "jira",
          host: "example.atlassian.net",
          projectKey: "NEX",
          issueType: "Bug",
          board: {
            kind: "jira-workflow",
            statusOptions: {
              blocked: "31",
              done: "41",
            },
          },
        },
      }).workTracking,
    ).toEqual({
      provider: "jira",
      host: "example.atlassian.net",
      projectKey: "NEX",
      issueType: "Bug",
      board: {
        kind: "jira-workflow",
        statusOptions: {
          blocked: "31",
          done: "41",
        },
      },
    });
  });

  it("accepts generic automation policy with safe defaults", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "automated-project",
        name: "Automated Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          selector: {
            statuses: ["ready"],
            labels: ["automation"],
            limit: 3,
          },
          verification: {
            focusedCommands: ["npm test"],
            fullCommands: ["npm run check"],
          },
          setup: {
            dependencyLinks: [
              {
                source: "node_modules",
                target: "node_modules",
                required: false,
              },
            ],
          },
          executor: {
            command: "node task.js",
            timeoutMs: 120000,
            runFullVerification: true,
          },
          publication: {
            strategy: "direct_integration",
            targetBranch: "main",
            push: true,
          },
        },
      }).automation,
    ).toEqual({
      enabled: true,
      mode: "run_once",
      selector: {
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: [],
        assignees: [],
        search: null,
        limit: 3,
      },
      verification: {
        focusedCommands: ["npm test"],
        fullCommands: ["npm run check"],
        requirePassing: true,
      },
      ledger: {
        path: ".dev-nexus/automation/runs.json",
        retention: 200,
      },
      lock: {
        path: ".dev-nexus/automation/run.lock",
        staleAfterMs: 3600000,
      },
      backoff: {
        failureLimit: 3,
        baseDelayMs: 300000,
        maxDelayMs: 3600000,
      },
      schedule: {
        enabled: true,
        intervalMs: 900000,
      },
      setup: {
        dependencyLinks: [
          {
            source: "node_modules",
            target: "node_modules",
            required: false,
          },
        ],
      },
      executor: {
        command: "node task.js",
        timeoutMs: 120000,
        runFullVerification: true,
      },
      agent: {
        command: null,
        timeoutMs: null,
        relaunch: {
          whileEligible: false,
        },
      },
      safety: {
        profile: "local",
        allowHostMutation: false,
        allowDependencyInstall: false,
        allowLiveServices: false,
      },
      publication: {
        strategy: "direct_integration",
        remote: "origin",
        targetBranch: "main",
        push: true,
      },
    });
  });

  it("accepts agent launch automation mode", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "agent-launch-project",
        name: "Agent Launch Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          mode: "agent_launch",
          agent: {
            command: "codex run",
            timeoutMs: 600000,
            relaunch: {
              whileEligible: true,
            },
          },
        },
      }).automation,
    ).toMatchObject({
      mode: "agent_launch",
      agent: {
        command: "codex run",
        timeoutMs: 600000,
        relaunch: {
          whileEligible: true,
        },
      },
    });
  });

  it("rejects invalid project and work tracking config", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-repo",
        name: "Invalid Repo",
        repo: {
          kind: "svn",
        },
        kanban: {
          provider: "vibe-kanban",
        },
      }),
    ).toThrow(/repo\.kind/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-provider",
        name: "Invalid Provider",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "trello",
        },
      }),
    ).toThrow(/workTracking\.provider/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-github",
        name: "Invalid GitHub",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "github",
          repository: {
            owner: "example",
          },
        },
      }),
    ).toThrow(/workTracking\.repository\.name/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-skills",
        name: "Invalid Skills",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        skills: {
          materialization: "install",
        },
      }),
    ).toThrow(/project config\.skills\.materialization/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-skill-agent-targets",
        name: "Invalid Skill Agent Targets",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        skills: {
          agentTargets: "codex",
        },
      }),
    ).toThrow(/project config\.skills\.agentTargets must be an array/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-skill-agent-target",
        name: "Invalid Skill Agent Target",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        skills: {
          agentTargets: [
            {
              agent: "codex",
              sourceControl: "shared",
            },
          ],
        },
      }),
    ).toThrow(/project config\.skills\.agentTargets\[0\]\.sourceControl/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-automation",
        name: "Invalid Automation",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          selector: {
            statuses: ["open"],
          },
        },
      }),
    ).toThrow(/project config\.automation\.selector\.statuses/);
  });

  it("resolves configured worktree roots from the project directory", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "project");
    const config = validateProjectConfig({
      version: 1,
      id: "custom-worktrees",
      name: "Custom Worktrees",
      worktreesRoot: path.join(".nexus", "worktrees"),
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });

    expect(projectWorktreesRootPath(projectRoot, config)).toBe(
      path.join(projectRoot, ".nexus", "worktrees"),
    );
  });

  it("reports missing project config with the generic project name", () => {
    const projectRoot = makeTempDir("dev-nexus-missing-project-");

    expect(() => loadProjectConfig(projectRoot)).toThrow(NexusConfigError);
    expect(() => loadProjectConfig(projectRoot)).toThrow(
      `DevNexus project is not initialized: ${path.join(
        projectRoot,
        devNexusProjectConfigFileName,
      )}`,
    );
  });
});
