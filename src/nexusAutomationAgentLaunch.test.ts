import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalWorkTrackerProvider,
  createDefaultNexusHomeConfigBase,
  createNexusAutomationAgentCommandLauncher,
  defaultLocalWorkTrackingStorePath,
  defaultNexusAutomationConfig,
  loadLocalWorkTrackingStore,
  loadProjectConfig,
  readNexusAutomationRunLedger,
  runNexusAutomationAgentLaunchOnce as runNexusAutomationAgentLaunchOnceBase,
  saveNexusHomeConfigFile,
  saveProjectConfig,
  validateNexusHomeConfigBase,
  type GitCommandResult,
  type GitRunner,
  type NexusAutomationCommandRunner,
  type NexusProjectConfig,
  type NexusPublicationActorRunner,
} from "./index.js";

const tempDirs: string[] = [];

function runNexusAutomationAgentLaunchOnce(
  options: Parameters<typeof runNexusAutomationAgentLaunchOnceBase>[0],
): ReturnType<typeof runNexusAutomationAgentLaunchOnceBase> {
  return runNexusAutomationAgentLaunchOnceBase({
    mcpRuntimeProcesses: false,
    ...options,
  });
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
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
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: ["blocked"],
        limit: 5,
      },
      agent: {
        ...defaultNexusAutomationConfig.agent,
        command: "codex run",
        timeoutMs: 120000,
        relaunch: {
          whileEligible: true,
        },
      },
    },
    ...overrides,
  };
}

function saveAutomationHomeConfig(homePath: string): void {
  saveNexusHomeConfigFile(
    homePath,
    createDefaultNexusHomeConfigBase(homePath, {
      projectsRoot: path.join(homePath, "projects"),
      workspacesRoot: path.join(homePath, "workspaces"),
      authProfiles: [
        {
          id: "bot-github",
          actorId: "example-bot-actor",
          provider: "github",
          kind: "automation",
          account: "example-bot",
          sshHost: "github.com-bot",
          githubCliConfigDir: "home:.config/gh-example-bot",
          gitUserName: "Example Bot",
          gitUserEmail: "bot@example.invalid",
          environmentKeys: ["GH_CONFIG_DIR"],
        },
      ],
    }),
    validateNexusHomeConfigBase,
  );
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
    if (key === "config --local --get user.name") {
      return gitResult(args, "Example Bot\n", cwd);
    }
    if (key === "config --local --get user.email") {
      return gitResult(args, "bot@example.invalid\n", cwd);
    }
    if (key === "config --get user.name") {
      return gitResult(args, "Example Bot\n", cwd);
    }
    if (key === "config --get user.email") {
      return gitResult(args, "bot@example.invalid\n", cwd);
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

describe("nexus automation agent launch", () => {
  it("launches a configured agent with context without selecting or mutating work", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const targetStatePath = path.join(
      projectRoot,
      ".dev-nexus",
      "automation",
      "dogfood-target.md",
    );
    fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
    fs.writeFileSync(
      targetStatePath,
      "Current target state: split the plan into implementation issues.\n",
      "utf8",
    );
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosts: [
          {
            id: "linux-verifier",
            capabilityTags: ["node", "git"],
          },
        ],
        runnerProfiles: [
          {
            id: "verify-node",
            requiredCapabilities: ["node"],
            allowedOperationClasses: ["verification"],
            commandProfileRefs: ["npm-check"],
            mutationClass: "verification",
          },
          {
            id: "runtime-smoke",
            requiredCapabilities: ["runtime"],
            allowedOperationClasses: ["live_runtime"],
            mutationClass: "live_runtime",
            approval: {
              required: true,
              policyGateIds: ["runner.runtime.approved"],
            },
          },
        ],
        plugins: [
          {
            id: "analysis-tools",
            name: "Analysis Tools",
            capabilities: [
              {
                kind: "projected_skill",
                id: "deep-review-skill",
                skillId: "deep-review",
                description: "Project a review skill into configured agents.",
                targetAgents: ["codex"],
              },
              {
                kind: "mcp_server",
                id: "analysis-mcp",
                serverName: "analysis_tools",
                tools: [
                  {
                    name: "inspect_facts",
                    description: "Read plugin-supplied facts.",
                  },
                ],
              },
            ],
          },
          {
            id: "workspace-policy",
            capabilities: [
              {
                kind: "setup_obligation",
                id: "review-local-docs",
                description: "Review workspace-local setup notes before editing.",
                required: true,
              },
              {
                kind: "cleanup_hook",
                id: "remove-temporary-cache",
                description: "Remove temporary cache files created by plugin tools.",
                trigger: "after_run",
              },
            ],
          },
        ],
        automation: {
          ...projectConfig().automation!,
          agent: {
            ...projectConfig().automation!.agent,
            coordinatorProfileId: "codex-deep",
            maxConcurrentSubagents: 3,
            profiles: [
              {
                id: "codex-deep",
                executor: "codex",
                model: "gpt-5.5",
                version: "2026-05",
                variant: "pro",
                reasoning: "xhigh",
                intelligence: "deep",
                intendedUse: "coordinator",
                safety: {
                  profile: "isolated",
                  allowHostMutation: false,
                  allowDependencyInstall: false,
                  allowLiveServices: false,
                },
                command: "codex",
                args: ["exec", "--model", "gpt-5.5"],
              },
            ],
          },
          target: {
            ...defaultNexusAutomationConfig.target,
            id: "dogfood",
            objective: "Use DevNexus to work on itself until no eligible issue remains.",
            statePath: ".dev-nexus/automation/dogfood-target.md",
            maxCycles: 8,
            maxWorkItems: 25,
          },
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
        versionPlanning: {
          versions: [
            {
              id: "v-next",
              objective: "Ship agent-visible version scope.",
              owningComponents: ["primary"],
              targetBranch: "main",
              scope: [
                {
                  kind: "label",
                  componentId: "primary",
                  trackerId: null,
                  label: "automation",
                  status: "committed",
                },
              ],
              readinessGates: [],
              releasePolicy: {
                tags: "none",
                packages: "none",
                providerRelease: "none",
                releaseNotes: "none",
                changelog: "none",
              },
            },
          ],
        },
      }),
    );
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Let an agent choose",
      status: "ready",
      labels: ["automation"],
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Excluded task",
      status: "ready",
      labels: ["automation", "blocked"],
    });
    const homePath = makeTempDir("dev-nexus-home-");
    saveAutomationHomeConfig(homePath);
    const githubConfigDir = path.join(os.homedir(), ".config", "gh-example-bot");
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      expect(command).toBe("codex run");
      expect(options.cwd).toBe(projectRoot);
      expect(options.timeoutMs).toBe(120000);
      expect(options.env.DEV_NEXUS_AUTOMATION_MODE).toBe("agent_launch");
      expect(options.env.DEV_NEXUS_ELIGIBLE_WORK_ITEM_IDS).toBe("local-1");
      expect(options.env.DEV_NEXUS_TARGET_ID).toBe("dogfood");
      expect(options.env.DEV_NEXUS_TARGET_STATE_FILE).toBe(targetStatePath);
      expect(options.env.DEV_NEXUS_TARGET_CYCLE_LEDGER_FILE).toBe(
        path.join(projectRoot, ".dev-nexus", "automation", "target-cycles.json"),
      );
      expect(options.env.DEV_NEXUS_COORDINATOR_PROFILE_ID).toBe("codex-deep");
      expect(options.env.DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS).toBe("3");
      expect(options.env.DEV_NEXUS_AGENT_RESULT_REQUIRED_FIELDS).toBe(
        "status,summary",
      );
      expect(options.env.DEV_NEXUS_AGENT_RESULT_OPTIONAL_FIELDS).toBe(
        "commitIds,verification,publicationDecision,workItems,error",
      );
      expect(options.env.GH_CONFIG_DIR).toBe(githubConfigDir);
      expect(options.env.GIT_AUTHOR_NAME).toBe("Example Bot");
      expect(options.env.GIT_AUTHOR_EMAIL).toBe("bot@example.invalid");
      expect(options.env.GIT_COMMITTER_NAME).toBe("Example Bot");
      expect(options.env.GIT_COMMITTER_EMAIL).toBe("bot@example.invalid");
      expect(options.env.DEV_NEXUS_PUBLICATION_REMOTE).toBe("bot");
      expect(options.env.DEV_NEXUS_PUBLICATION_ACTOR_KIND).toBe("machine_user");
      expect(options.env.DEV_NEXUS_PUBLICATION_ACTOR_PROVIDER).toBe("github");
      expect(options.env.DEV_NEXUS_PUBLICATION_ACTOR_HANDLE).toBe("example-bot");
      expect(options.env.DEV_NEXUS_PUBLICATION_MANUAL_REMOTE).toBe("origin");
      expect(options.env.DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_HANDLE).toBe(
        "example-human",
      );
      expect(options.env.DEV_NEXUS_PUBLICATION_COMMAND_ENV_KEYS).toBe(
        "GH_CONFIG_DIR",
      );
      expect(options.env.GH_TOKEN).toBeUndefined();
      expect(options.env.GITHUB_TOKEN).toBeUndefined();
      const context = JSON.parse(
        fs.readFileSync(options.env.DEV_NEXUS_AGENT_CONTEXT_FILE!, "utf8"),
      );
      expect(context).toMatchObject({
        runId: "agent-run-1",
        projectRoot,
        automation: {
          mode: "agent_launch",
          eligibleWorkItemCount: 1,
        },
        components: [
          {
            id: "primary",
            publication: {
              remote: "bot",
              actor: {
                kind: "machine_user",
                provider: "github",
                handle: "example-bot",
              },
              manualRemote: "origin",
              manualActor: {
                kind: "human",
                provider: "github",
                handle: "example-human",
              },
            },
            authority: {
              componentId: "primary",
              actor: {
                actorId: "example-bot-actor",
              },
              roles: ["maintainer"],
            },
          },
        ],
        target: {
          id: "dogfood",
          objective: "Use DevNexus to work on itself until no eligible issue remains.",
          statePath: targetStatePath,
          stateExists: true,
          stateMarkdown:
            "Current target state: split the plan into implementation issues.\n",
          maxCycles: 8,
          maxWorkItems: 25,
        },
        agent: {
          coordinatorProfileId: "codex-deep",
          maxConcurrentSubagents: 3,
          safety: {
            profile: "local",
            allowHostMutation: false,
            allowDependencyInstall: false,
            allowLiveServices: false,
          },
          coordinatorProfile: {
            id: "codex-deep",
            executor: "codex",
            model: "gpt-5.5",
            version: "2026-05",
            variant: "pro",
            reasoning: "xhigh",
            intelligence: "deep",
            intendedUse: "coordinator",
            safety: {
              profile: "isolated",
              allowHostMutation: false,
              allowDependencyInstall: false,
              allowLiveServices: false,
            },
            command: "codex",
            args: ["exec", "--model", "gpt-5.5"],
          },
          profiles: [
            {
              id: "codex-deep",
              executor: "codex",
              model: "gpt-5.5",
              version: "2026-05",
              variant: "pro",
              reasoning: "xhigh",
              intelligence: "deep",
              intendedUse: "coordinator",
              safety: {
                profile: "isolated",
                allowHostMutation: false,
                allowDependencyInstall: false,
                allowLiveServices: false,
              },
              command: "codex",
              args: ["exec", "--model", "gpt-5.5"],
            },
          ],
        },
        runnerProfiles: [
          {
            id: "verify-node",
            mutationClass: "verification",
            approvalState: "not_required",
            requiredCapabilities: ["node"],
            commandProfileRefs: ["npm-check"],
            missingHostCapabilities: [],
          },
          {
            id: "runtime-smoke",
            mutationClass: "live_runtime",
            approvalState: "policy_gated",
            policyGateIds: ["runner.runtime.approved"],
            missingHostCapabilities: ["runtime"],
          },
        ],
        pluginCapabilities: [
          {
            pluginId: "analysis-tools",
            pluginName: "Analysis Tools",
            version: null,
            capabilityCount: 2,
            capabilities: [
              {
                kind: "projected_skill",
                id: "deep-review-skill",
                description: "Project a review skill into configured agents.",
                skillId: "deep-review",
                targetAgents: ["codex"],
              },
              {
                kind: "mcp_server",
                id: "analysis-mcp",
                description: null,
                serverName: "analysis_tools",
                targetAgents: [],
                tools: [
                  {
                    name: "inspect_facts",
                    description: "Read plugin-supplied facts.",
                  },
                ],
              },
            ],
          },
          {
            pluginId: "workspace-policy",
            pluginName: null,
            version: null,
            capabilityCount: 2,
            capabilities: [
              {
                kind: "setup_obligation",
                id: "review-local-docs",
                description: "Review workspace-local setup notes before editing.",
                required: true,
              },
              {
                kind: "cleanup_hook",
                id: "remove-temporary-cache",
                description: "Remove temporary cache files created by plugin tools.",
                trigger: "after_run",
                required: false,
              },
            ],
          },
        ],
        authority: {
          projectId: "demo-project",
          components: [
            {
              componentId: "primary",
              keyAllowedActions: expect.arrayContaining([
                "git.push_target_branch",
              ]),
              authProfile: {
                id: "bot-github",
                kind: "automation",
              },
              summary: expect.stringContaining("actor=example-bot-actor"),
            },
          ],
        },
        result: {
          file: options.env.DEV_NEXUS_AGENT_RESULT_FILE,
          requiredFields: ["status", "summary"],
          optionalFields: [
            "commitIds",
            "verification",
            "publicationDecision",
            "workItems",
            "error",
          ],
          statuses: ["completed", "failed", "blocked"],
          workItemStatuses: ["completed", "blocked", "failed", "skipped"],
          verificationStatuses: ["passed", "failed", "not_run"],
          publicationDecisionTypes: [
            "not_decided",
            "local_only",
            "direct_integration",
            "review_handoff",
            "blocked",
          ],
        },
        eligibleWorkItems: [
          {
            id: "local-1",
            title: "Let an agent choose",
          },
        ],
        versionPlanning: {
          versionCount: 1,
          shownVersionCount: 1,
          workItems: [
            {
              componentId: "primary",
              id: "local-1",
              unrelated: false,
              scopes: [
                {
                  versionId: "v-next",
                  scopeStatus: "committed",
                  scopeStatuses: ["committed"],
                  entryKinds: ["label"],
                },
              ],
            },
          ],
        },
        externalIssueVisibility: {
          componentCount: 1,
          defaultTrackerOnlyComponentCount: 1,
          importOnlyWorkItemCount: 0,
          providerAccessWarningCount: 0,
          providerAccessBlockerCount: 0,
          components: [
            {
              componentId: "primary",
              mode: "default_tracker_only",
            },
          ],
        },
        publication: {
          remote: "bot",
          actor: {
            kind: "machine_user",
            provider: "github",
            handle: "example-bot",
          },
          manualRemote: "origin",
          manualActor: {
            kind: "human",
            provider: "github",
            handle: "example-human",
          },
        },
      });
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Agent reported completion",
          commitIds: ["abc123"],
          verification: [
            {
              command: "npm test",
              status: "passed",
              summary: "focused tests passed",
            },
          ],
          publicationDecision: {
            type: "review_handoff",
            remote: "origin",
            targetBranch: "main",
            reason: "agent reported a review handoff",
          },
        })}\n`,
        "utf8",
      );

      return {
        command,
        cwd: options.cwd,
        stdout: "launched",
        stderr: "",
        exitCode: 0,
      };
    };

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      homePath,
      runId: "agent-run-1",
      gitRunner: publicationGitRunner(path.join(projectRoot, "source")),
      publicationActorRunner: actorRunnerWithHandle("example-bot"),
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        env: {
          GH_TOKEN: "ambient-gh-token",
          GITHUB_TOKEN: "ambient-github-token",
        },
        commandRunner,
        timeoutMs: 120000,
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      summary: "Agent reported completion",
      eligibleWorkItems: [
        {
          id: "local-1",
        },
      ],
      launch: {
        commitIds: ["abc123"],
        verification: [
          {
            command: "codex run",
            status: "passed",
          },
          {
            command: "npm test",
            status: "passed",
          },
        ],
      },
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items,
    ).toMatchObject([
      {
        id: "local-1",
        status: "ready",
      },
      {
        id: "local-2",
        status: "ready",
      },
    ]);
    expect(
      readNexusAutomationRunLedger(projectRoot, loadProjectConfig(projectRoot).automation!),
    ).toMatchObject({
      runs: [
        {
          id: "agent-run-1",
          status: "completed",
          workItemId: null,
          worktreePath: null,
          commitIds: ["abc123"],
          summary: "Agent reported completion",
          verification: [
            {
              command: "codex run",
              status: "passed",
            },
            {
              command: "npm test",
              status: "passed",
            },
          ],
          publicationDecision: {
            type: "review_handoff",
            remote: "origin",
            targetBranch: "main",
          },
        },
      ],
    });
  });

  it("adds noninteractive Git defaults to launched agent environments", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs noninteractive Git",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-git-env-defaults",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        env: {},
        commandRunner: (command, options) => {
          expect(options.env.GIT_EDITOR).toBe("true");
          expect(options.env.GIT_SEQUENCE_EDITOR).toBe("true");
          expect(options.env.GIT_MERGE_AUTOEDIT).toBe("no");
          fs.writeFileSync(
            options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
            `${JSON.stringify({
              status: "completed",
              summary: "Git prompt defaults were present",
            })}\n`,
            "utf8",
          );

          return {
            command,
            cwd: options.cwd,
            stdout: "launched",
            stderr: "",
            exitCode: 0,
          };
        },
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      summary: "Git prompt defaults were present",
    });
  });

  it("preserves explicit Git prompt environment values for launched agents", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs custom Git env",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-git-env-custom",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        env: {
          GIT_EDITOR: "custom-editor",
          GIT_SEQUENCE_EDITOR: "custom-sequence-editor",
          GIT_MERGE_AUTOEDIT: "yes",
        },
        commandRunner: (command, options) => {
          expect(options.env.GIT_EDITOR).toBe("custom-editor");
          expect(options.env.GIT_SEQUENCE_EDITOR).toBe("custom-sequence-editor");
          expect(options.env.GIT_MERGE_AUTOEDIT).toBe("yes");
          fs.writeFileSync(
            options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
            `${JSON.stringify({
              status: "completed",
              summary: "Git prompt env was preserved",
            })}\n`,
            "utf8",
          );

          return {
            command,
            cwd: options.cwd,
            stdout: "launched",
            stderr: "",
            exitCode: 0,
          };
        },
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      summary: "Git prompt env was preserved",
    });
  });

  it("blocks incomplete coordinator profile policy before launching", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          agent: {
            ...projectConfig().automation!.agent,
            coordinatorProfileId: "codex-worker",
            profiles: [
              {
                id: "codex-worker",
                executor: "codex",
                model: "gpt-5.5",
                reasoning: "high",
                intendedUse: "subagent",
                command: null,
                args: [],
              },
            ],
          },
        },
      }),
    );

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-profile-preflight",
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: expect.stringContaining("codex-worker"),
      contextFile: null,
      resultFile: null,
      launch: null,
    });
    expect(result.preflight).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agentProfile:codex-worker:intendedUse",
          status: "failed",
          message: expect.stringContaining("intendedUse"),
        }),
        expect.objectContaining({
          name: "agentProfile:codex-worker:command",
          status: "failed",
          message: expect.stringContaining("command"),
        }),
      ]),
    );
  });

  it("blocks coordinator launch when projected MCP command lines are stale", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"old-dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );
    saveProjectConfig(
      projectRoot,
      projectConfig({
        mcp: {
          agentTargets: [{ agent: "codex" }],
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs fresh MCP runtime",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-mcp-freshness-preflight",
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: expect.stringContaining("stale or unexpected"),
      contextFile: null,
      resultFile: null,
      launch: null,
    });
    expect(result.preflight).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "mcpRuntime:agent-mcp-server-codex-dev_nexus",
          status: "failed",
          message: expect.stringContaining(
            `Expected: "${process.platform === "win32" ? "dev-nexus.cmd" : "dev-nexus"}" "mcp-stdio"`,
          ),
        }),
      ]),
    );
  });

  it("blocks coordinator launch when live MCP processes are stale", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );
    saveProjectConfig(
      projectRoot,
      projectConfig({
        mcp: {
          agentTargets: [{ agent: "codex" }],
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs fresh live MCP runtime",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-live-mcp-freshness-preflight",
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      mcpRuntimeProcesses: [
        {
          pid: 4242,
          commandLine: "old-dev-nexus mcp-stdio",
        },
      ],
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: expect.stringContaining("live MCP process 4242"),
      contextFile: null,
      resultFile: null,
      launch: null,
    });
    expect(result.preflight).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "mcpRuntime:agent-mcp-live-codex-dev_nexus-4242",
          status: "failed",
          message: expect.stringContaining("Reload or restart"),
        }),
      ]),
    );
  });

  it("blocks before launching when workspace-local runtime npm packages are damaged and repair is not approved", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          safety: {
            ...projectConfig().automation!.safety,
            allowDependencyInstall: false,
          },
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs runtime tools",
      status: "ready",
      labels: ["automation"],
    });
    const runtimeRoot = path.join(projectRoot, ".dev-nexus", "runtime", "npm-tools");
    fs.mkdirSync(path.join(runtimeRoot, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(runtimeRoot, "package.json"),
      `${JSON.stringify({
        dependencies: {
          "@evref-bl/dev-nexus-pharo": "0.1.0-alpha.9",
        },
      })}\n`,
      "utf8",
    );

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-runtime-npm-preflight",
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      launcher: () => {
        throw new Error("launcher should not run");
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      summary: expect.stringContaining("Damaged local npm runtime install state"),
      contextFile: null,
      resultFile: null,
      launch: null,
    });
    expect(result.preflight).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "npmRuntimeInstall:npm-tools",
          status: "failed",
          message: expect.stringContaining("missing installed package"),
        }),
      ]),
    );
  });

  it("launches with component-scoped work items across multiple components", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
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

    const commandRunner: NexusAutomationCommandRunner = (_command, options) => {
      expect(options.env.DEV_NEXUS_COMPONENT_COUNT).toBe("2");
      expect(options.env.DEV_NEXUS_COMPONENT_IDS).toBe("primary,addon");
      expect(options.env.DEV_NEXUS_PRIMARY_COMPONENT_ID).toBe("primary");
      const context = JSON.parse(
        fs.readFileSync(options.env.DEV_NEXUS_AGENT_CONTEXT_FILE!, "utf8"),
      );
      expect(context.project).toMatchObject({
        id: "demo-project",
        componentCount: 2,
      });
      expect(context.components).toMatchObject([
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
              default: true,
              capabilityReport: {
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
              default: false,
            },
          ],
          workTracker: {
            provider: "local",
            configured: true,
          },
        },
        {
          id: "addon",
          role: "addon",
          relationships: [
            {
              kind: "extends",
              componentId: "primary",
            },
          ],
        },
      ]);
      expect(context.componentEligibleWorkItems).toMatchObject([
        {
          componentId: "primary",
          workItems: [
            {
              id: "local-1",
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
              id: "local-1",
              title: "Addon work",
            },
          ],
        },
      ]);
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Component-aware launch complete",
        })}\n`,
        "utf8",
      );

      return {
        command: "codex run",
        cwd: options.cwd,
        stdout: "launched",
        stderr: "",
        exitCode: 0,
      };
    };

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-components-1",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner,
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      components: [
        {
          id: "primary",
          workTracking: {
            provider: "local",
          },
        },
        {
          id: "addon",
          workTracking: {
            provider: "local",
          },
        },
      ],
      componentEligibleWorkItems: [
        {
          componentId: "primary",
          workItems: [{ title: "Primary work" }],
        },
        {
          componentId: "addon",
          workItems: [{ title: "Addon work" }],
        },
      ],
    });
  });

  it("fails a successful agent command that does not write a result file", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs durable result",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-missing-result",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner: (command, options) => ({
          command,
          cwd: options.cwd,
          stdout: "agent exited",
          stderr: "",
          exitCode: 0,
        }),
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      summary: expect.stringContaining("Agent result file was not written"),
      launch: {
        error: expect.stringContaining("Agent result file was not written"),
        verification: [
          {
            command: "codex run",
            status: "passed",
          },
        ],
      },
    });
  });

  it("keeps stdout and stderr tails when an agent command fails", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs coordinator diagnostics",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-failed-command",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner: (command, options) => ({
          command,
          cwd: options.cwd,
          stdout: "stdout first\nstdout tail\n",
          stderr: "stderr first\nstderr tail\n",
          exitCode: 2,
        }),
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      summary:
        "Agent command failed: exit 2: stderr tail: stderr tail; stdout tail: stdout tail",
      launch: {
        error: "exit 2: stderr tail: stderr tail; stdout tail: stdout tail",
        verification: [
          {
            command: "codex run",
            status: "failed",
            summary:
              "exit 2: stderr tail: stderr tail; stdout tail: stdout tail",
          },
        ],
      },
    });
  });

  it("fails malformed agent result files before recording completion", async () => {
    const projectRoot = makeTempDir("dev-nexus-agent-launch-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Needs valid result",
      status: "ready",
      labels: ["automation"],
    });

    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot,
      runId: "agent-invalid-result",
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
      launcher: createNexusAutomationAgentCommandLauncher({
        command: "codex run",
        commandRunner: (command, options) => {
          fs.writeFileSync(
            options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
            `${JSON.stringify({ summary: "missing status" })}\n`,
            "utf8",
          );

          return {
            command,
            cwd: options.cwd,
            stdout: "agent exited",
            stderr: "",
            exitCode: 0,
          };
        },
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      summary: "Agent result file is invalid: agent result.status must be a non-empty string",
      launch: {
        error: "Agent result file is invalid: agent result.status must be a non-empty string",
        verification: [
          {
            command: "codex run",
            status: "passed",
          },
        ],
      },
    });
  });
});
