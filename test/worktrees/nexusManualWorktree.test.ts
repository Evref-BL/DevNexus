import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  materializeNexusProjectSkills,
  nexusWorkerContextJsonPath,
  prepareNexusManualWorktree,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
} from "../../src/index.js";

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
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet" &&
      argsArray[3]?.endsWith("^{commit}")
    ) {
      return {
        args: argsArray,
        stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (
      argsArray[0] === "show-ref" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet"
    ) {
      return {
        args: argsArray,
        stdout: "",
        stderr: "",
        exitCode: argsArray[3]?.startsWith("refs/heads/") ? 0 : 1,
      };
    }
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--abbrev-ref" &&
      argsArray[2] === "--symbolic-full-name" &&
      argsArray[3]?.endsWith("@{upstream}")
    ) {
      return {
        args: argsArray,
        stdout: "",
        stderr: "",
        exitCode: 1,
      };
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

function workspaceFreshnessGitRunner(options: {
  projectRoot: string;
  ahead: number;
  behind: number;
  metadataStatus?: string;
  fetchExitCode?: number;
  calls: Array<{ args: string[]; cwd?: string }>;
}): GitRunner {
  const baseGitRunner = fakeGitRunner(options.calls);
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    const joined = argsArray.join(" ");

    if (cwd === options.projectRoot) {
      if (joined === "rev-parse --show-toplevel") {
        options.calls.push({ args: argsArray, cwd });
        return {
          args: argsArray,
          stdout: `${options.projectRoot}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "symbolic-ref --short HEAD") {
        options.calls.push({ args: argsArray, cwd });
        return { args: argsArray, stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
        options.calls.push({ args: argsArray, cwd });
        return {
          args: argsArray,
          stdout: "origin/main\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "fetch --prune origin refs/heads/main:refs/remotes/origin/main") {
        options.calls.push({ args: argsArray, cwd });
        return {
          args: argsArray,
          stdout: "",
          stderr:
            options.fetchExitCode && options.fetchExitCode !== 0
              ? "fatal: fetch failed"
              : "",
          exitCode: options.fetchExitCode ?? 0,
        };
      }
      if (joined === "rev-list --left-right --count HEAD...@{upstream}") {
        options.calls.push({ args: argsArray, cwd });
        return {
          args: argsArray,
          stdout: `${options.ahead}\t${options.behind}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        joined ===
        "status --porcelain=v1 -- dev-nexus.project.json .dev-nexus .agents AGENTS.md CONTEXT.md PLAN.md"
      ) {
        options.calls.push({ args: argsArray, cwd });
        return {
          args: argsArray,
          stdout: options.metadataStatus ?? "",
          stderr: "",
          exitCode: 0,
        };
      }
    }

    return baseGitRunner(args, cwd);
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
  it("blocks worktree preparation when workspace metadata is behind upstream", () => {
    const { projectRoot, calls } = prepareProject();
    const gitRunner = workspaceFreshnessGitRunner({
      projectRoot,
      ahead: 0,
      behind: 1,
      calls,
    });

    expect(() =>
      prepareNexusManualWorktree({
        projectRoot,
        componentId: "primary",
        topic: "stale metadata",
        branchName: "codex/primary/stale-metadata",
        worktreeName: "stale-metadata",
        gitRunner,
      }),
    ).toThrow(/Workspace metadata checkout is behind origin\/main/u);
    expect(calls.some((call) => call.args[0] === "worktree")).toBe(false);
  });

  it("reports dirty workspace metadata paths when blocking stale preparation", () => {
    const { projectRoot, calls } = prepareProject();
    const gitRunner = workspaceFreshnessGitRunner({
      projectRoot,
      ahead: 0,
      behind: 2,
      metadataStatus:
        " M dev-nexus.project.json\n?? .dev-nexus/automation/target-state.md\n",
      calls,
    });

    try {
      prepareNexusManualWorktree({
        projectRoot,
        componentId: "primary",
        topic: "dirty stale metadata",
        branchName: "codex/primary/dirty-stale-metadata",
        worktreeName: "dirty-stale-metadata",
        gitRunner,
      });
      throw new Error("expected stale workspace metadata to block");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Workspace metadata checkout is behind origin/main",
      );
      expect((error as { payload?: unknown }).payload).toMatchObject({
        ok: false,
        error: {
          code: "stale_workspace_metadata",
        },
        workspaceMetadataFreshness: {
          status: "behind",
          ahead: 0,
          behind: 2,
          changedMetadataPaths: [
            "dev-nexus.project.json",
            ".dev-nexus/automation/target-state.md",
          ],
        },
      });
    }
    expect(calls.some((call) => call.args[0] === "worktree")).toBe(false);
  });

  it("records current workspace metadata freshness on prepared worktrees", () => {
    const { projectRoot, calls } = prepareProject();
    const gitRunner = workspaceFreshnessGitRunner({
      projectRoot,
      ahead: 0,
      behind: 0,
      calls,
    });

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "current metadata",
      branchName: "codex/primary/current-metadata",
      worktreeName: "current-metadata",
      gitRunner,
    });

    expect(result.workspaceMetadataFreshness).toMatchObject({
      status: "current",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      changedMetadataPaths: [],
    });
    expect(fs.existsSync(result.worktree.worktreePath)).toBe(true);
  });

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

  it("prepares a worktree when work item text references a missing doc", () => {
    const { projectRoot, calls } = prepareProject();
    const relativePath = "docs/dev/source-quality.md";

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "missing doc reference",
      branchName: "codex/primary/missing-doc-reference",
      worktreeName: "missing-doc-reference",
      workItemId: "30",
      workItemTitle: "Audit source quality",
      workItemDescription: `See \`${relativePath}\` for the local audit notes.`,
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(fs.existsSync(result.worktree.worktreePath)).toBe(true);
    expect(context.projectContext.referencedFiles).toEqual([]);
    expect(context.projectContext.missingReferencedFiles).toEqual([
      {
        relativePath,
        projectPath: path.join(projectRoot, relativePath),
        componentPath: path.join(projectRoot, "source", relativePath),
      },
    ]);
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Skipped missing referenced docs:",
    );
  });

  it("applies setup projections when preparing an existing local branch", () => {
    const { projectRoot, sourceRoot, calls } = prepareProject({
      plugins: [
        {
          id: "typescript",
          enabled: true,
          name: "TypeScript Tooling",
          capabilities: [
            {
              kind: "dependency_projection",
              id: "node-modules",
              source: "node_modules",
              target: "node_modules",
              required: true,
              reason: "Resolve local npm binaries from prepared JS/TS worktrees.",
              targetComponents: ["primary"],
            },
          ],
        },
      ],
    });
    const sourceDependency = path.join(sourceRoot, "node_modules");
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ready\n", "utf8");
    const branchName = "codex/primary/existing-branch";
    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      calls.push({ args: argsArray, cwd });
      if (argsArray.join(" ") === `for-each-ref --format=%(refname) refs/heads/${branchName}`) {
        return {
          args: argsArray,
          stdout: `refs/heads/${branchName}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (argsArray.join(" ") === "worktree list --porcelain") {
        return {
          args: argsArray,
          stdout: [
            `worktree ${sourceRoot}`,
            "HEAD 1111111111111111111111111111111111111111",
            "branch refs/heads/main",
            "",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        argsArray[0] === "worktree" &&
        argsArray[1] === "add" &&
        argsArray[2] !== "-b"
      ) {
        fs.mkdirSync(argsArray[2]!, { recursive: true });
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
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
        stderr: `fatal: a branch named '${branchName}' already exists`,
        exitCode: 128,
      };
    };

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "existing branch",
      branchName,
      worktreeName: "existing-branch",
      gitRunner,
    });

    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: ["worktree", "add", result.worktree.worktreePath, branchName],
    });
    expect(result.setup.dependencyProjections).toMatchObject([
      {
        id: "node-modules",
        status: "linked",
        sourcePath: sourceDependency,
        targetPath: path.join(result.worktree.worktreePath, "node_modules"),
      },
    ]);
    expect(
      fs.existsSync(path.join(result.worktree.worktreePath, "node_modules", "tool.txt")),
    ).toBe(true);
  });

  it("defaults component worktree base to the configured publication target remote branch", () => {
    const { projectRoot, sourceRoot, calls } = prepareProject({
      automation: {
        ...defaultNexusAutomationConfig,
        setup: {
          dependencyLinks: [],
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "green_main",
          remote: "app",
          targetBranch: "main",
          push: false,
        },
      },
    });
    const baseCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const gitRunner: GitRunner = (args: readonly string[], cwd?: string): GitCommandResult => {
      const argsArray = [...args];
      calls.push({ args: argsArray, cwd });
      const joined = argsArray.join(" ");
      if (argsArray[0] === "for-each-ref") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "show-ref --verify --quiet refs/heads/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "show-ref --verify --quiet refs/heads/app/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 1 };
      }
      if (joined === "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 1 };
      }
      if (joined === "rev-parse --verify --quiet main^{commit}") {
        return { args: argsArray, stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", stderr: "", exitCode: 0 };
      }
      if (joined === "show-ref --verify --quiet refs/remotes/app/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "show-ref --verify --quiet refs/tags/app/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 1 };
      }
      if (joined === "fetch --prune app refs/heads/main:refs/remotes/app/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --verify --quiet app/main^{commit}") {
        return { args: argsArray, stdout: `${baseCommit}\n`, stderr: "", exitCode: 0 };
      }
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

      return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
    };

    const result = prepareNexusManualWorktree({
      projectRoot,
      componentId: "primary",
      topic: "publication target base",
      branchName: "codex/primary/publication-target-base",
      worktreeName: "publication-target-base",
      gitRunner,
    });

    expect(result.worktree).toMatchObject({
      baseRef: "app/main",
      requestedBaseRef: "app/main",
      resolvedBaseCommit: baseCommit,
      baseRefKind: "remote_branch",
      baseRefFreshness: {
        status: "fresh",
      },
    });
    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: ["fetch", "--prune", "app", "refs/heads/main:refs/remotes/app/main"],
    });
    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: [
        "worktree",
        "add",
        "-b",
        "codex/primary/publication-target-base",
        result.worktree.worktreePath,
        "app/main",
      ],
    });
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

  it("prepares worktrees with repo-local configured Git identity from auth profile", () => {
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
      "- configured Git identity: Example Bot <bot@example.invalid>",
    );
  });

  it("derives branch, base ref, and worker context from feature branch delivery policy", () => {
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
          releaseTrain: {
            enabled: true,
            activeVersionId: null,
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            featureBranchDelivery: {
              ...defaultNexusFeatureBranchDeliveryConfig,
              enabled: true,
              activeFeatureId: "codex-goals",
              defaultBranchStrategy: "hybrid",
              branchPublication: {
                strategy: "push_remote_then_fallback",
                fallbackRemote: "fork",
              },
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
      featureId: "codex-goals",
      featureChange: "target projection",
      branchIntent: "feat",
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(result.worktree.branchName).toBe("feat/codex-goals/target-projection");
    expect(result.worktree.baseRef).toBe("feat/codex-goals");
    expect(context.featureBranchDelivery).toMatchObject({
      featureId: "codex-goals",
      changeSlug: "target-projection",
      branchStrategy: "hybrid",
      featureBranch: "feat/codex-goals",
      branchTarget: "feat/codex-goals",
      parentBranch: "feat/codex-goals",
      stackPosition: 1,
      childBranches: [],
      stackPublicationEligible: true,
      finalPublicationTarget: "main",
      reviewMode: "review_branch_pr",
      finalPullRequestCreation: "at_review_gate",
      commentPolicy: "status_only",
      branchPublication: {
        strategy: "push_remote_then_fallback",
        pushRemote: "origin",
        fallbackRemote: "fork",
        selectedRemote: "origin",
        requiresFallbackApproval: true,
      },
    });
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Feature: codex-goals",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Review target: feat/codex-goals",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Stack position: 1",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Final PR creation: at_review_gate",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "Branch push remote: origin (fallback: fork)",
    );
  });

  it("records selected stack parent and position in feature worktree context", () => {
    const { projectRoot, calls } = prepareProject({
      home: "home",
      automation: {
        ...defaultNexusAutomationConfig,
        setup: {
          dependencyLinks: [],
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: null,
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            featureBranchDelivery: {
              ...defaultNexusFeatureBranchDeliveryConfig,
              enabled: true,
              activeFeatureId: "codex-goals",
              defaultBranchStrategy: "stacked",
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
      featureId: "codex-goals",
      featureChange: "worker context",
      featureParentBranch: "feat/codex-goals/target-projection",
      featureStackPosition: 2,
      branchIntent: "feat",
      gitRunner: fakeGitRunner(calls),
    });
    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(result.worktree.worktreePath), "utf8"),
    );

    expect(result.worktree.baseRef).toBe("feat/codex-goals/target-projection");
    expect(context.featureBranchDelivery).toMatchObject({
      branchStrategy: "stacked",
      branchTarget: "feat/codex-goals/target-projection",
      parentBranch: "feat/codex-goals/target-projection",
      stackPosition: 2,
      stackPublicationEligible: true,
    });
  });

  it("prepares worktrees with the project default configured Git identity", () => {
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
            coAuthors: [
              {
                name: "Codex",
                email: "267193182+codex@users.noreply.github.com",
              },
              {
                name: "Pair Reviewer",
                email: "pair@example.invalid",
              },
            ],
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
      coAuthors: [
        {
          name: "Codex",
          email: "267193182+codex@users.noreply.github.com",
        },
        {
          name: "Pair Reviewer",
          email: "pair@example.invalid",
        },
      ],
      source: "publication.gitIdentity",
    });
    expect(result.setup.context!.briefingMarkdown).toContain(
      "- raw git commit uses the prepared repo-local configured identity unless the worker overrides Git config.",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "- configured Git co-author trailer: Co-authored-by: Codex <267193182+codex@users.noreply.github.com>",
    );
    expect(result.setup.context!.briefingMarkdown).toContain(
      "- configured Git co-author trailer: Co-authored-by: Pair Reviewer <pair@example.invalid>",
    );
  });
});
