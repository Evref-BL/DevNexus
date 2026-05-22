import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultNexusHomeConfigBase,
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  getNexusAutomationStatus,
  nexusAutomationLockPath,
  saveNexusHomeConfigFile,
  saveProjectConfig,
  validateNexusHomeConfigBase,
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
      workItemClaimAuthority: {
        backend: "optimistic_tracker",
        status: "ready",
        postgresConnectionProfileId: null,
        blockers: [],
      },
    });
    expect(result.preflight.every((check) => check.status === "passed")).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "automation")),
    ).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("blocks PostgreSQL claim authority without a connection profile", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        workItemClaims: {
          ...config.automation!.workItemClaims,
          authority: {
            ...config.automation!.workItemClaims.authority,
            backend: "postgres",
          },
        },
      },
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "blocked",
      workItemClaimAuthority: {
        backend: "postgres",
        status: "blocked",
        postgresConnectionProfileId: null,
        blockers: [
          "PostgreSQL claim authority requires project config.automation.workItemClaims.authority.postgres.connectionProfileId",
        ],
      },
      selectedWorkItem: null,
    });
    expect(result.summary).toContain(
      "PostgreSQL claim authority requires project config.automation.workItemClaims.authority.postgres.connectionProfileId",
    );
  });

  it("reports PostgreSQL claim authority profile and runtime blockers", async () => {
    const root = makeTempDir("dev-nexus-status-project-");
    const projectRoot = path.join(root, "workspace");
    const homePath = path.join(root, "home");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      home: homePath,
    });
    const postgresAutomationConfig = {
      ...config.automation!,
      workItemClaims: {
        ...config.automation!.workItemClaims,
        authority: {
          ...config.automation!.workItemClaims.authority,
          backend: "postgres" as const,
          postgres: {
            connectionProfileId: "shared-claims",
          },
        },
      },
    };
    saveProjectConfig(projectRoot, {
      ...config,
      automation: postgresAutomationConfig,
    });

    const missingProfile = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      env: {},
    });

    expect(missingProfile.workItemClaimAuthority).toMatchObject({
      backend: "postgres",
      status: "blocked",
      postgresConnectionProfileId: "shared-claims",
      postgresProfile: {
        profileStatus: "missing",
        profileId: "shared-claims",
        connectionStringEnv: null,
        connectionStringEnvPresent: null,
        adapterStatus: "not_checked",
      },
      blockers: [
        "PostgreSQL claim authority profile shared-claims was not found in DevNexus home config",
      ],
    });

    saveNexusHomeConfigFile(
      homePath,
      createDefaultNexusHomeConfigBase(homePath, {
        claimAuthorityProfiles: [
          {
            id: "shared-claims",
            backend: "postgres",
            driver: "node_postgres",
            connectionStringEnv: "DEV_NEXUS_CLAIMS_DATABASE_URL",
            schema: "dev_nexus",
          },
        ],
      }),
      validateNexusHomeConfigBase,
    );

    const missingEnv = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      env: {},
    });

    expect(missingEnv.workItemClaimAuthority).toMatchObject({
      status: "blocked",
      postgresProfile: {
        profileStatus: "available",
        profileId: "shared-claims",
        driver: "node_postgres",
        schema: "dev_nexus",
        connectionStringEnv: "DEV_NEXUS_CLAIMS_DATABASE_URL",
        connectionStringEnvPresent: false,
        adapterStatus: "not_checked",
      },
      blockers: [
        "PostgreSQL claim authority profile shared-claims requires environment variable DEV_NEXUS_CLAIMS_DATABASE_URL",
      ],
    });

    const missingAdapter = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
      env: {
        DEV_NEXUS_CLAIMS_DATABASE_URL: "postgres://claims@example.invalid/db",
      },
    });

    expect(missingAdapter.workItemClaimAuthority).toMatchObject({
      status: "blocked",
      postgresProfile: {
        profileStatus: "available",
        profileId: "shared-claims",
        driver: "node_postgres",
        connectionStringEnv: "DEV_NEXUS_CLAIMS_DATABASE_URL",
        connectionStringEnvPresent: true,
        adapterStatus: "missing",
      },
      blockers: [
        "PostgreSQL claim authority profile shared-claims requires optional node-postgres runtime adapter support",
      ],
    });
    expect(JSON.stringify(missingAdapter.workItemClaimAuthority)).not.toContain(
      "postgres://claims@example.invalid/db",
    );
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

  it("uses configured discovery mode for agent launch readiness", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const inboxStorePath = ".dev-nexus/work-items-inbox.json";
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
            trackerDiscovery: {
              scannedRoles: ["primary", "eligible_source"],
              directExternalSelection: "allowed",
              importRequiredFirst: false,
              providerFilters: ["local"],
              queryLimit: 10,
              conflictWinner: "scanned_tracker",
              missingCredentialBehavior: "skip",
            },
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
                id: "inbox",
                name: "Inbox",
                enabled: true,
                roles: ["eligible_source"],
                workTracking: {
                  provider: "local",
                  storePath: inboxStorePath,
                },
              },
            ],
            relationships: [],
          },
        ],
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
          eligibleWorkMode: "discovery",
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: inboxStorePath },
      now: fixedClock("2026-05-16T09:05:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Inbox work",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      eligibleWorkMode: "discovery",
      candidateCount: 1,
      eligibleWorkItems: [
        {
          title: "Inbox work",
          trackerRef: {
            componentId: "primary",
            trackerId: "inbox",
            default: false,
          },
          selectable: true,
          importOnly: false,
        },
      ],
    });
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
            trackerDiscovery: {
              scannedRoles: ["eligible_source", "external_inbox"],
              directExternalSelection: "allowed",
              importRequiredFirst: false,
              providerFilters: ["github", "local"],
              queryLimit: 10,
              conflictWinner: "scanned_tracker",
              missingCredentialBehavior: "skip",
            },
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
          trackerDiscovery: {
            scannedRoles: ["eligible_source", "external_inbox"],
            directExternalSelection: "allowed",
            importRequiredFirst: false,
            providerFilters: ["github", "local"],
            queryLimit: 10,
            conflictWinner: "scanned_tracker",
            missingCredentialBehavior: "skip",
            defaultTrackerOnly: false,
          },
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
          trackerDiscovery: {
            scannedRoles: ["primary"],
            directExternalSelection: "disabled",
            importRequiredFirst: true,
            providerFilters: [],
            queryLimit: 50,
            conflictWinner: "default_tracker",
            missingCredentialBehavior: "block",
            defaultTrackerOnly: true,
          },
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
      externalIssueVisibility: {
        componentCount: 2,
        defaultTrackerOnlyComponentCount: 1,
        externalIgnoredComponentCount: 1,
        importRequiredComponentCount: 0,
        directSelectableComponentCount: 0,
        importOnlyWorkItemCount: 0,
        providerAccessWarningCount: 0,
        providerAccessBlockerCount: 0,
        components: [
          {
            componentId: "primary",
            mode: "external_ignored",
            sourceRoles: ["eligible_source", "external_inbox"],
          },
          {
            componentId: "addon",
            mode: "default_tracker_only",
            sourceRoles: ["primary"],
          },
        ],
      },
    });
  });

  it("includes runner profile safety status without running profiles", async () => {
    const projectRoot = makeTempDir("dev-nexus-status-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosts: [
          {
            id: "linux-verifier",
            displayName: "Linux Verifier",
            platformTags: ["linux"],
            capabilityTags: ["node", "git"],
            enabled: true,
          },
        ],
        runnerProfiles: [
          {
            id: "verify-node",
            requiredCapabilities: ["node"],
            allowedOperationClasses: ["verification"],
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
      }),
    );

    const result = await getNexusAutomationStatus({
      projectRoot,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(result.runnerProfiles).toMatchObject([
      {
        id: "verify-node",
        mutationClass: "verification",
        approvalState: "not_required",
        missingHostCapabilities: [],
      },
      {
        id: "runtime-smoke",
        mutationClass: "live_runtime",
        approvalState: "policy_gated",
        missingHostCapabilities: ["runtime"],
      },
    ]);
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
              id: "example-bot-actor",
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
      authProfiles: [
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
      ],
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
      currentActors: [
        {
          componentId: "primary",
          status: "matched",
          expectedActorId: "example-bot-actor",
          profileId: "bot-github",
          roles: ["maintainer"],
        },
      ],
      authority: {
        components: [
          {
            componentId: "primary",
            actor: {
              actorId: "example-bot-actor",
              status: "matched",
            },
            authProfile: {
              id: "bot-github",
              kind: "automation",
            },
            roleBindings: [
              {
                roles: ["maintainer"],
                scope: {
                  component: "primary",
                },
              },
            ],
          },
        ],
      },
    });
    expect(result.authority.components[0]?.keyAllowedActions).toContain(
      "git.push_target_branch",
    );
    expect(result.authority.components[0]?.summary).toContain(
      "profile=bot-github",
    );
    expect(JSON.stringify(result.authority)).not.toContain("home:.config");
    expect(result.preflight).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:actor",
        status: "failed",
      }),
    );
  });

  it("blocks readiness when automation commit identity is incomplete", async () => {
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
              id: "example-bot-actor",
            },
            gitIdentity: {
              name: "Example Bot",
              email: null,
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
      }),
    );
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Blocked identity task",
      status: "ready",
      labels: ["automation"],
    });

    const result = await getNexusAutomationStatus({
      projectRoot,
      authProfiles: [
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
      ],
      gitRunner: publicationGitRunner(sourceRoot),
      publicationActorRunner: actorRunnerWithHandle("example-bot"),
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
          gitIdentity: {
            status: "unchecked",
          },
        },
      ],
    });
    expect(result.summary).toContain("Expected Git email is not configured");
    expect(result.preflight).toContainEqual(
      expect.objectContaining({
        name: "publication:primary:gitIdentity",
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
