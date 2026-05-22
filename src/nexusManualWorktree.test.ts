import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  defaultNexusInitiativeDeliveryConfig,
  materializeNexusProjectSkills,
  nexusWorkerContextJsonPath,
  prepareNexusManualWorktree,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      fs.mkdirSync(argsArray[4]!, { recursive: true });
    }
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

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "primary",
        name: "Primary",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/primary.git",
        defaultBranch: "main",
        sourceRoot: "source",
        worktreesRoot: "worktrees/primary",
      },
    ],
    automation: {
      ...defaultNexusAutomationConfig,
      setup: {
        dependencyLinks: [],
      },
    },
    ...overrides,
  };
}

function saveProjectConfig(projectRoot: string, config: NexusProjectConfig): void {
  fs.writeFileSync(
    path.join(projectRoot, "dev-nexus.project.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

function saveHomeConfig(homePath: string): void {
  fs.mkdirSync(homePath, { recursive: true });
  fs.writeFileSync(
    path.join(homePath, "dev-nexus.home.json"),
    JSON.stringify(
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        authProfiles: [
          {
            id: "bot-github",
            actorId: "example-bot-actor",
            provider: "github",
            kind: "automation",
            account: "example-bot",
            gitUserName: "Example Bot",
            gitUserEmail: "bot@example.invalid",
          },
        ],
        projects: [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

function prepareProject(
  overrides: Partial<NexusProjectConfig> = {},
): {
  projectRoot: string;
  sourceRoot: string;
  calls: Array<{ args: string[]; cwd?: string }>;
} {
  const projectRoot = makeTempDir("dev-nexus-manual-worktree-");
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  saveProjectConfig(projectRoot, projectConfig(overrides));
  const calls: Array<{ args: string[]; cwd?: string }> = [];

  return { projectRoot, sourceRoot, calls };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0).reverse()) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus manual worktree worker target preparation", () => {
  it("defaults a single active provider into worker context and skill projections", () => {
    const { projectRoot, calls } = prepareProject({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        defaultCorePack: true,
        sourceControl: "support",
        agentTargets: [{ agent: "codex" }, { agent: "claude" }],
      },
      plugins: [
        {
          id: "worker-fragments",
          enabled: true,
          capabilities: [
            {
              kind: "worker_briefing_fragment",
              id: "codex-note",
              title: "Codex Note",
              body: "Codex-only setup.",
              targetAgents: ["codex"],
              targetComponents: ["primary"],
              provenance: "test plugin",
            },
            {
              kind: "worker_briefing_fragment",
              id: "claude-note",
              title: "Claude Note",
              body: "Claude-only setup.",
              targetAgents: ["claude"],
              targetComponents: ["primary"],
              provenance: "test plugin",
            },
          ],
        },
      ],
    });
    materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: {
        defaultCorePack: true,
        sourceControl: "support",
        agentTargets: [{ agent: "codex" }, { agent: "claude" }],
      },
      excludeFromGit: false,
    });

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "single active codex",
      branchName: "codex/primary/single-active-codex",
      worktreeName: "single-active-codex",
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(result.setup.skillProjections.map((projection) => projection.agent))
      .toEqual(["codex"]);
    expect(fs.existsSync(path.join(result.worktree.worktreePath, ".agents")))
      .toBe(true);
    expect(fs.existsSync(path.join(result.worktree.worktreePath, ".claude")))
      .toBe(false);
    expect(context.agentTargetPolicy).toMatchObject({
      explicit: true,
      activeProviders: ["codex"],
      assignedProvider: "codex",
    });
    expect(context.pluginFragments.briefing.map((fragment: { id: string }) => fragment.id))
      .toEqual(["codex-note"]);
    expect(result.setup.context!.briefingMarkdown).toContain(
      "- assigned worker provider: codex",
    );
    expect(result.setup.context!.briefingMarkdown).not.toContain("Claude Note");
  });

  it("prepares distinct worker contexts for different active providers", () => {
    const { projectRoot, calls } = prepareProject({
      agentTargets: {
        active: [{ provider: "codex" }, { provider: "claude" }],
      },
      skills: {
        defaultCorePack: true,
        sourceControl: "support",
        agentTargets: [{ agent: "codex" }, { agent: "claude" }],
      },
    });
    materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: {
        defaultCorePack: true,
        sourceControl: "support",
        agentTargets: [{ agent: "codex" }, { agent: "claude" }],
      },
      excludeFromGit: false,
    });

    const codex = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "codex worker",
      branchName: "codex/primary/codex-worker",
      worktreeName: "codex-worker",
      workerAgentProvider: "codex",
      gitRunner: fakeGitRunner(calls),
    });
    const claude = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "claude worker",
      branchName: "codex/primary/claude-worker",
      worktreeName: "claude-worker",
      workerAgentProvider: "claude",
      gitRunner: fakeGitRunner(calls),
    });

    expect(codex.setup.skillProjections.map((projection) => projection.agent))
      .toEqual(["codex"]);
    expect(claude.setup.skillProjections.map((projection) => projection.agent))
      .toEqual(["claude"]);
    expect(fs.existsSync(path.join(codex.worktree.worktreePath, ".claude")))
      .toBe(false);
    expect(fs.existsSync(path.join(claude.worktree.worktreePath, ".agents")))
      .toBe(false);
    expect(
      JSON.parse(
        fs.readFileSync(nexusWorkerContextJsonPath(codex.worktree.worktreePath), "utf8"),
      ).agentTargetPolicy.assignedProvider,
    ).toBe("codex");
    expect(
      JSON.parse(
        fs.readFileSync(nexusWorkerContextJsonPath(claude.worktree.worktreePath), "utf8"),
      ).agentTargetPolicy.assignedProvider,
    ).toBe("claude");
  });

  it("rejects a worker provider outside the active workspace policy", () => {
    const { projectRoot, calls } = prepareProject({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        defaultCorePack: true,
        sourceControl: "support",
        agentTargets: [{ agent: "codex" }, { agent: "claude" }],
      },
    });
    materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: {
        defaultCorePack: true,
        sourceControl: "support",
        agentTargets: [{ agent: "codex" }, { agent: "claude" }],
      },
      excludeFromGit: false,
    });

    expect(() =>
      prepareNexusManualWorktree({
        projectRoot,
        componentId: "primary",
        topic: "unsupported provider",
        branchName: "codex/primary/unsupported-provider",
        worktreeName: "unsupported-provider",
        workerAgentProvider: "claude",
        gitRunner: fakeGitRunner(calls),
      }),
    ).toThrow(/Worker agent provider claude is not active/);
  });

  it("prepares worktrees with repo-local automation Git identity from auth profile", () => {
    const { projectRoot, calls } = prepareProject({
      home: "home",
      automation: {
        ...defaultNexusAutomationConfig,
        setup: {
          dependencyLinks: [],
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "direct_integration",
          remote: "bot",
          push: true,
          actor: {
            kind: "machine_user",
            provider: "github",
            handle: "example-bot",
            id: null,
          },
        },
      },
    });
    saveHomeConfig(path.join(projectRoot, "home"));

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "bot git identity",
      branchName: "codex/primary/bot-git-identity",
      worktreeName: "bot-git-identity",
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(result.worktree.gitIdentity).toEqual({
      name: "Example Bot",
      email: "bot@example.invalid",
    });
    expect(calls).toContainEqual({
      cwd: result.worktree.worktreePath,
      args: ["config", "--local", "user.name", "Example Bot"],
    });
    expect(calls).toContainEqual({
      cwd: result.worktree.worktreePath,
      args: ["config", "--local", "user.email", "bot@example.invalid"],
    });
    expect(context.gitIdentity).toMatchObject({
      name: "Example Bot",
      email: "bot@example.invalid",
      source: "authProfile:bot-github",
    });
    expect(result.setup.context!.briefingMarkdown).toContain(
      "- automation Git identity: Example Bot <bot@example.invalid>",
    );
  });

  it("derives branch, base ref, and worker context from initiative delivery policy", () => {
    const { projectRoot, calls } = prepareProject({
      automation: {
        ...defaultNexusAutomationConfig,
        setup: {
          dependencyLinks: [],
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "green_main",
          targetBranch: "main",
          publicationTrain: {
            enabled: true,
            activeVersionId: null,
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            initiativeDelivery: {
              ...defaultNexusInitiativeDeliveryConfig,
              enabled: true,
              activeInitiativeId: "codex-goals",
              defaultTopology: "hybrid",
            },
            selector: {
              statuses: ["ready"],
              labels: [],
              milestones: [],
              assignees: [],
              providerQuery: null,
            },
          },
        },
      },
    });

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      initiativeId: "codex-goals",
      initiativeSlice: "target projection",
      branchIntent: "feat",
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(result.worktree.branchName).toBe("feat/codex-goals/target-projection");
    expect(result.worktree.baseRef).toBe("feat/codex-goals");
    expect(context.initiativeDelivery).toMatchObject({
      initiativeId: "codex-goals",
      sliceSlug: "target-projection",
      topology: "hybrid",
      integrationBranch: "feat/codex-goals",
      branchTarget: "feat/codex-goals",
      finalPublicationTarget: "main",
      reviewMode: "slice_pr",
      providerNoise: "status_only",
    });
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Initiative: codex-goals",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Review target: feat/codex-goals",
    );
  });

  it("prepares worktrees with the project default automation Git identity", () => {
    const { projectRoot, calls } = prepareProject({
      home: "home",
      automation: {
        ...defaultNexusAutomationConfig,
        setup: {
          dependencyLinks: [],
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "direct_integration",
          remote: "bot",
          push: true,
          actor: {
            kind: "machine_user",
            provider: "github",
            handle: "example-bot",
            id: null,
          },
          gitIdentity: {
            name: "Project Bot",
            email: "project-bot@example.invalid",
          },
        },
      },
    });
    saveHomeConfig(path.join(projectRoot, "home"));

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "project bot git identity",
      branchName: "codex/primary/project-bot-git-identity",
      worktreeName: "project-bot-git-identity",
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(result.worktree.gitIdentity).toEqual({
      name: "Project Bot",
      email: "project-bot@example.invalid",
    });
    expect(calls).toContainEqual({
      cwd: result.worktree.worktreePath,
      args: ["config", "--local", "user.name", "Project Bot"],
    });
    expect(calls).toContainEqual({
      cwd: result.worktree.worktreePath,
      args: ["config", "--local", "user.email", "project-bot@example.invalid"],
    });
    expect(context.gitIdentity).toMatchObject({
      name: "Project Bot",
      email: "project-bot@example.invalid",
      source: "publication.gitIdentity",
    });
    expect(result.setup.context!.briefingMarkdown).toContain(
      "- raw git commit uses the prepared repo-local automation identity unless the worker overrides Git config.",
    );
  });
});
