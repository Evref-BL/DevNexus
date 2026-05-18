import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  getNexusAutomationStatus,
  nexusAutomationLockPath,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
  type NexusPublicationActorRunner,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
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
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        limit: 5,
      },
      lock: {
        ...defaultNexusAutomationConfig.lock,
        staleAfterMs: 60_000,
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation status", () => {
  it("reports selected work without creating run state or worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Check automation readiness",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      candidateCount: 1,
      selectedWorkItem: {
        id: "local-1",
        title: "Check automation readiness",
      },
      lock: {
        status: "none",
      },
      ledger: {
        runs: [],
      },
    });
    expect(result.preflight.every((check) => check.status === "passed")).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "automation")),
    ).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("reports agent launch readiness without selecting one work item", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const targetStatePath = path.join(
      projectRoot,
      ".dev-nexus",
      "automation",
      "target-state.md",
    );
    fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
    fs.writeFileSync(targetStatePath, "Current target state.\n", "utf8");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
          agent: {
            ...projectConfig().automation!.agent,
            coordinatorProfileId: "codex-deep",
            maxConcurrentSubagents: 2,
            profiles: [
              {
                id: "codex-deep",
                executor: "codex",
                model: "gpt-5.5",
                reasoning: "xhigh",
                command: "codex",
                args: ["exec"],
              },
            ],
          },
          target: {
            ...projectConfig().automation!.target,
            objective: "Keep working until all selected issues are resolved.",
          },
        },
      }),
    );
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Agent should choose",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      summary: "Agent launch ready with 1 eligible work item(s)",
      candidateCount: 1,
      eligibleWorkItems: [
        {
          id: "local-1",
          title: "Agent should choose",
        },
      ],
      target: {
        objective: "Keep working until all selected issues are resolved.",
        statePath: targetStatePath,
        stateExists: true,
        stateMarkdown: "Current target state.\n",
      },
      agent: {
        coordinatorProfileId: "codex-deep",
        maxConcurrentSubagents: 2,
      },
      selectedWorkItem: null,
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("reports agent launch readiness grouped by configured components", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), { recursive: true });
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary Local",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: primaryStorePath,
                },
              },
              {
                id: "mirror",
                name: "Mirror",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-mirror.json",
                },
              },
            ],
            relationships: [],
          },
          {
            id: "addon",
            name: "Addon",
            kind: "git",
            role: "addon",
            remoteUrl: "git@example.invalid:demo/addon.git",
            defaultBranch: "main",
            sourceRoot: "components/addon",
            workTracking: {
              provider: "local",
              storePath: addonStorePath,
            },
            relationships: [
              {
                kind: "extends",
                componentId: "primary",
              },
            ],
          },
        ],
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Primary work",
      status: "ready",
      labels: ["automation"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: fixedClock("2026-05-16T09:05:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Addon work",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      candidateCount: 2,
      selectedWorkItem: null,
      components: [
        {
          id: "primary",
          role: "primary",
          defaultTrackerId: "primary",
          workTrackers: [
            {
              id: "primary",
              provider: "local",
              enabled: true,
              roles: ["primary"],
              workTrackingCapabilityReport: {
                provider: "local",
                capabilities: {
                  list: true,
                  update: true,
                },
              },
            },
            {
              id: "mirror",
              provider: "local",
              enabled: true,
              roles: ["mirror"],
            },
          ],
          workTracking: {
            provider: "local",
          },
          workTrackingCapabilities: {
            createItem: true,
            listItems: true,
            updateItem: true,
            comment: true,
          },
        },
        {
          id: "addon",
          role: "addon",
          workTrackingCapabilities: {
            createItem: true,
            listItems: true,
          },
          relationships: [
            {
              kind: "extends",
              componentId: "primary",
            },
          ],
        },
      ],
      componentEligibleWorkItems: [
        {
          componentId: "primary",
          workItems: [
            {
              title: "Primary work",
              trackerRef: {
                componentId: "primary",
                trackerId: "primary",
                provider: "local",
                default: true,
              },
            },
          ],
        },
        {
          componentId: "addon",
          workItems: [
            {
              title: "Addon work",
            },
          ],
        },
      ],
    });
  });

  it("reports an active run lock before listing candidate work", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    const config = projectConfig();
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, config);
    const lockPath = nexusAutomationLockPath(projectRoot, config.automation!);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify(
        {
          runId: "run-active",
          owner: "scheduler",
          acquiredAt: "2026-05-16T09:59:00.000Z",
          expiresAt: "2026-05-16T10:30:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "locked",
      candidateCount: null,
      selectedWorkItem: null,
      lock: {
        status: "active",
        runId: "run-active",
        owner: "scheduler",
      },
    });
  });

  it("blocks readiness when a required dependency link source is missing", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          setup: {
            dependencyLinks: [
              {
                source: "node_modules",
                target: "node_modules",
                required: true,
              },
            ],
          },
        },
      }),
    );
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Blocked dependency task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "blocked",
      candidateCount: null,
      selectedWorkItem: null,
    });
    expect(result.preflight.at(-1)).toMatchObject({
      name: "dependencyLink:0",
      status: "failed",
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("blocks readiness when publication actor guardrails do not match", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
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
            commandEnvironment: {
              GH_CONFIG_DIR: "home:.config/gh-example-bot",
            },
          },
        },
      }),
    );
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Blocked publication task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      gitRunner: publicationGitRunner(sourceRoot),
      publicationActorRunner: actorRunnerWithHandle("example-human"),
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "blocked",
      candidateCount: null,
      selectedWorkItem: null,
      publication: [
        {
          componentId: "primary",
          blocking: true,
          actor: {
            status: "mismatched",
            observed: {
              handle: "example-human",
            },
          },
        },
      ],
    });
    expect(result.preflight).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:actor",
        status: "failed",
      }),
    );
  });
});

function publicationGitRunner(repositoryPath: string): GitRunner {
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
      return gitResult(args, "git@github.com-bot:example/project.git\n", cwd);
    }
    if (key === "remote get-url --push bot") {
      return gitResult(args, "git@github.com-bot:example/project.git\n", cwd);
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
