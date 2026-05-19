import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNexusPublicationGuard,
  defaultNexusAutomationConfig,
  getNexusPublicationStatus,
  loadProjectConfig,
  resolveProjectComponents,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusHostingAuthProfileConfig,
  type NexusProjectConfig,
  type NexusPublicationActorRunner,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "publication-project",
    name: "Publication Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:example/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "github",
      repository: {
        owner: "example",
        name: "project",
      },
    },
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "direct_integration",
        remote: "bot",
        remoteUrl: "git@github.com-bot:example/project.git",
        sshHostAlias: "github.com-bot",
        targetBranch: "main",
        push: true,
        actor: {
          kind: "machine_user",
          provider: "github",
          handle: "example-bot",
          id: null,
        },
        manualRemote: "origin",
        manualActor: {
          kind: "human",
          provider: "github",
          handle: "example-human",
          id: null,
        },
        commandEnvironment: {
          GH_CONFIG_DIR: "home:.config/gh-example-bot",
        },
      },
    },
    authority: {
      actors: [
        {
          id: "example-bot-actor",
          kind: "machine_user",
          provider: "github",
          providerIdentity: "example-bot",
          displayName: "Example Bot",
        },
      ],
      roleBindings: [
        {
          actorId: "example-bot-actor",
          roles: ["maintainer"],
          scope: {
            component: "primary",
          },
        },
      ],
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus publication policy", () => {
  it("reports matching remote and actor guardrail status with mocked git and gh", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;
    const actorCommands: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const githubConfigDir = path.join(os.homedir(), ".config", "gh-example-bot");

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "git_push",
      authProfiles: automationAuthProfiles(),
      gitRunner: publicationGitRunner(sourceRoot, {
        remoteUrl: "git@github.com-bot:example/project.git",
        pushUrl: "git@github.com-bot:example/project.git",
      }),
      env: {
        GH_TOKEN: "ambient-gh-token",
        GITHUB_TOKEN: "ambient-github-token",
        PATH: process.env.PATH,
      },
      actorRunner: (command, args, options) => {
        actorCommands.push({ command, args, env: options.env });
        return { status: 0, stdout: "example-bot\n", stderr: "" };
      },
    });

    expect(status).toMatchObject({
      componentId: "primary",
      blocking: false,
      git: {
        repositoryPath: sourceRoot,
        branch: "feature/local-38",
        upstream: "bot/main",
        remoteName: "bot",
        remoteUrl: "git@github.com-bot:example/project.git",
        pushUrl: "git@github.com-bot:example/project.git",
        targetBranch: "main",
      },
      actor: {
        status: "matched",
        observed: {
          provider: "github",
          handle: "example-bot",
        },
        commandEnvironment: {
          GH_CONFIG_DIR: githubConfigDir,
        },
      },
    });
    expect(status.checks.every((check) => check.status === "passed")).toBe(true);
    expect(actorCommands).toEqual([
      {
        command: "gh",
        args: ["api", "user", "--jq", ".login", "--hostname", "github.com"],
        env: expect.objectContaining({
          GH_CONFIG_DIR: githubConfigDir,
        }),
      },
    ]);
    expect(actorCommands[0]!.env.GH_TOKEN).toBeUndefined();
    expect(actorCommands[0]!.env.GITHUB_TOKEN).toBeUndefined();
    expect(() => assertNexusPublicationGuard(status)).not.toThrow();
  });

  it("blocks when the observed automation actor does not match policy", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "provider_write",
      authProfiles: automationAuthProfiles(),
      gitRunner: publicationGitRunner(sourceRoot),
      actorRunner: actorRunnerWithHandle("example-human"),
    });

    expect(status.blocking).toBe(true);
    expect(status.checks).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:actor",
        status: "failed",
      }),
    );
    expect(() => assertNexusPublicationGuard(status)).toThrow(
      /example-human.*example-bot/u,
    );
  });

  it("blocks when the effective publication remote does not match policy", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "git_push",
      authProfiles: automationAuthProfiles(),
      gitRunner: publicationGitRunner(sourceRoot, {
        remoteUrl: "git@github.com:example/project.git",
        pushUrl: "git@github.com:example/project.git",
      }),
      actorRunner: actorRunnerWithHandle("example-bot"),
    });

    expect(status.blocking).toBe(true);
    expect(status.checks).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:remoteUrl",
        status: "failed",
      }),
    );
    expect(status.checks).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:sshHostAlias",
      status: "failed",
      }),
    );
  });

  it("blocks direct target branch push without a resolved automation auth profile and suggests pull request fallback", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "example-bot",
            displayName: "Example Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["contributor"],
            scope: {
              component: "primary",
            },
          },
        ],
      },
    }));
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "git_push",
      authProfiles: [],
      gitRunner: publicationGitRunner(sourceRoot),
      actorRunner: actorRunnerWithHandle("example-bot"),
    });

    expect(status.blocking).toBe(true);
    expect(status.authority).toMatchObject({
      requestedAction: "git.push_target_branch",
      allowed: false,
      recommendedFallbackAction: "provider.pull_request.open",
    });
    expect(status.warnings).toContain(
      "Open a pull request or merge request for review instead of pushing the target branch directly.",
    );
    expect(status.checks).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:authority:git.push_target_branch",
        status: "failed",
      }),
    );
  });

  it("allows contributor-style pull request publication when policy and auth profile match", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      automation: {
        ...projectConfig().automation!,
        publication: {
          ...projectConfig().automation!.publication,
          strategy: "review_handoff",
          push: false,
        },
      },
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "example-bot",
            displayName: "Example Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["contributor"],
            scope: {
              component: "primary",
            },
          },
        ],
      },
    }));
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "provider_write",
      authProfiles: automationAuthProfiles(),
      gitRunner: publicationGitRunner(sourceRoot),
      actorRunner: actorRunnerWithHandle("example-bot"),
    });

    expect(status.blocking).toBe(false);
    expect(status.authority).toMatchObject({
      requestedAction: "provider.pull_request.open",
      allowed: true,
    });
  });

  it("blocks pull request merge until provider approval checks and branch policy are clear", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "provider_pull_request_merge",
      authProfiles: automationAuthProfiles(),
      providerState: {
        pullRequest: {
          review: "waiting_for_approval",
          checks: "checks_failed",
          mergeability: "mergeable",
          branchPolicy: "branch_policy_blocked",
        },
      },
      gitRunner: publicationGitRunner(sourceRoot),
      actorRunner: actorRunnerWithHandle("example-bot"),
    });

    expect(status.blocking).toBe(true);
    expect(status.authority).toMatchObject({
      requestedAction: "provider.pull_request.merge",
      allowed: false,
      missingProviderSignals: expect.arrayContaining([
        "pull_request_review.approved",
        "checks.passed",
        "branch_policy.clear",
      ]),
    });
    expect(status.checks).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:authority:provider.pull_request.merge",
        status: "failed",
      }),
    );
  });

  it("gates package publication separately from merge authority and publication policy", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "example-bot",
            displayName: "Example Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["maintainer"],
            scope: {
              component: "primary",
            },
          },
        ],
      },
    }));
    const config = loadProjectConfig(projectRoot);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const status = getNexusPublicationStatus({
      projectRoot,
      projectConfig: config,
      component,
      action: "package_publish",
      authProfiles: automationAuthProfiles(),
      gitRunner: publicationGitRunner(sourceRoot),
      actorRunner: actorRunnerWithHandle("example-bot"),
    });

    expect(status.blocking).toBe(true);
    expect(status.authority).toMatchObject({
      requestedAction: "package.publish",
      allowed: false,
      missingRequiredActions: ["package.publish"],
    });
    expect(status.authority?.blockingReasons).toEqual(
      expect.arrayContaining([
        "Component publication policy does not allow package publication.",
        "Actor example-bot-actor lacks action package.publish.",
      ]),
    );
  });
});

function automationAuthProfiles(): NexusHostingAuthProfileConfig[] {
  return [
    {
      id: "bot-github",
      actorId: "example-bot-actor",
      provider: "github",
      kind: "automation",
      account: "example-bot",
      sshHost: "github.com-bot",
      githubCliConfigDir: "home:.config/gh-example-bot",
      environmentKeys: ["GH_CONFIG_DIR"],
    },
  ];
}

function publicationGitRunner(
  repositoryPath: string,
  options: {
    remoteUrl?: string;
    pushUrl?: string;
  } = {},
): GitRunner {
  const remoteUrl =
    options.remoteUrl ?? "git@github.com-bot:example/project.git";
  const pushUrl = options.pushUrl ?? remoteUrl;

  return (args, cwd) => {
    const key = args.join(" ");
    if (key === "rev-parse --show-toplevel") {
      return gitResult(args, repositoryPath, cwd);
    }
    if (key === "symbolic-ref --short HEAD") {
      return gitResult(args, "feature/local-38\n", cwd);
    }
    if (key === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return gitResult(args, "bot/main\n", cwd);
    }
    if (key === "remote get-url bot") {
      return gitResult(args, `${remoteUrl}\n`, cwd);
    }
    if (key === "remote get-url --push bot") {
      return gitResult(args, `${pushUrl}\n`, cwd);
    }

    return {
      args: [...args],
      stdout: "",
      stderr: `unexpected git command ${key} from ${cwd ?? ""}`,
      exitCode: 1,
    };
  };
}

function actorRunnerWithHandle(handle: string): NexusPublicationActorRunner {
  return () => ({ status: 0, stdout: `${handle}\n`, stderr: "" });
}

function gitResult(
  args: readonly string[],
  stdout: string,
  _cwd: string | undefined,
): GitCommandResult {
  return {
    args: [...args],
    stdout,
    stderr: "",
    exitCode: 0,
  };
}
