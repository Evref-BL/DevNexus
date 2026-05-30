import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationRunRecord,
  appendNexusAutomationTargetCycleRecord,
  auditNexusDashboardClientVisuals,
  buildNexusDashboardHostActionQueue,
  buildNexusDashboardHostSnapshot,
  buildNexusDashboardSnapshot,
  CodexAppServerJsonRpcClient,
  createLocalWorkTrackerProvider,
  createNexusDashboardCodexChatStarter,
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  startNexusDashboardServer,
  stopVerifiedNexusDashboardServerRecord,
  validateNexusHomeConfigBase,
  writeNexusWorktreeLeaseStore,
  type GitRunner,
  type NexusDashboardServerRecord,
  type StopProcessByPidResult,
} from "../../src/index.js";
import {
  appServerAutomationConfig,
  cleanupDashboardTestTempDirs,
  extractDashboardActionToken,
  fakeGitRunner,
  fail,
  fixedClock,
  hostWorkspace,
  loadDashboardClientTestHooks,
  makeTempDir,
  MockCodexAppServerTransport,
  ok,
  projectConfig,
  RecordingCodexChatStarter,
  worktreeLease,
} from "./nexusDashboardTestHelpers.js";

afterEach(cleanupDashboardTestTempDirs);

describe("nexus dashboard server hydration", () => {
  it("shares provider freshness across cockpit server routes", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-provider-freshness-");
    const homePath = makeTempDir("dev-nexus-dashboard-provider-freshness-home-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [],
        authProfiles: [
          {
            id: "bot-github",
            actorId: "example-bot-actor",
            provider: "github",
            kind: "app",
            credentialKind: "github_app",
            account: "example-bot",
            host: "github.com",
            sshHost: "github.com-bot",
            githubCliConfigDir: "home:.config/gh-example-bot",
            gitUserName: "Example Bot",
            gitUserEmail: "bot@example.invalid",
            environmentKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    saveProjectConfig(projectRoot, projectConfig({
      automation: {
        ...defaultNexusAutomationConfig,
        selector: {
          ...defaultNexusAutomationConfig.selector,
          statuses: ["ready"],
          limit: 5,
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
            kind: "app",
            provider: "github",
            handle: "example-bot",
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
            kind: "service_account",
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
      components: [
        {
          id: "primary",
          name: "Dashboard Demo",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:example/project.git",
          defaultBranch: "main",
          sourceRoot: "source",
          defaultWorkTrackerId: "github",
          workTrackers: [
            {
              id: "github",
              name: "GitHub Issues",
              enabled: true,
              roles: ["primary", "eligible_source"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "example",
                  name: "project",
                },
              },
            },
          ],
          trackerDiscovery: {
            scannedRoles: ["primary", "eligible_source"],
            directExternalSelection: "allowed",
            importRequiredFirst: false,
            providerFilters: ["github"],
            queryLimit: 5,
            conflictWinner: "scanned_tracker",
            missingCredentialBehavior: "skip",
          },
          relationships: [],
        },
      ],
    }));
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "remote get-url bot") {
        return ok([...args], "git@github.com-bot:example/project.git\n");
      }
      if (command === "remote get-url --push bot") {
        return ok([...args], "git@github.com-bot:example/project.git\n");
      }
      if (
        command === "config --local --get user.name" ||
        command === "config --get user.name"
      ) {
        return ok([...args], "Example Bot\n");
      }
      if (
        command === "config --local --get user.email" ||
        command === "config --get user.email"
      ) {
        return ok([...args], "bot@example.invalid\n");
      }
      return baseGitRunner(args, cwd);
    };
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url: String(input), headers });
      if (headers["If-None-Match"] === "\"dashboard-issues\"") {
        return new Response(null, { status: 304 });
      }
      return new Response(
        JSON.stringify([
          {
            id: 42,
            number: 42,
            title: "Ready cockpit task",
            body: "Provider-backed task",
            state: "open",
            labels: [{ name: "status:ready" }],
            assignees: [],
            created_at: "2026-05-21T09:40:00.000Z",
            updated_at: "2026-05-21T09:45:00.000Z",
            html_url: "https://github.com/example/project/issues/42",
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            etag: "\"dashboard-issues\"",
          },
        },
      );
    };
    const server = await startNexusDashboardServer({
      projectRoot,
      homePath,
      gitRunner,
      env: {
        GH_TOKEN: "github-token",
        GITHUB_TOKEN: "github-token",
      },
      providerOptions: {
        github: {
          fetch: fetcher,
          token: "github-token",
          apiBaseUrl: "https://api.github.test",
        },
      },
      now: fixedClock("2026-05-21T10:26:45.000Z"),
    });

    try {
      const host = await fetch(
        `${server.url}api/host?workspace=dashboard-demo`,
      ).then((response) => response.json());
      const cockpit = await fetch(
        `${server.url}api/cockpit?workspace=dashboard-demo`,
      ).then((response) => response.json());

      expect(host.actionQueue).toEqual(expect.any(Array));
      expect(cockpit.project.id).toBe("dashboard-demo");
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.slice(1).some((call) =>
        call.headers["If-None-Match"] === "\"dashboard-issues\""
      )).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("reuses full workspace snapshots across dashboard endpoints", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-cache-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const baseGitRunner = fakeGitRunner();
    let allowGit = true;
    let gitCalls = 0;
    const server = await startNexusDashboardServer({
      projectRoot,
      gitRunner: (args, cwd) => {
        if (!allowGit) {
          throw new Error("workspace refresh should use the cached snapshot");
        }
        gitCalls += 1;
        return baseGitRunner(args, cwd);
      },
      now: fixedClock("2026-05-21T10:26:00.000Z"),
    });

    try {
      const first = await fetch(`${server.url}api/cockpit`).then((response) =>
        response.json(),
      );
      expect(first.project.id).toBe("dashboard-demo");
      expect(gitCalls).toBeGreaterThan(0);

      allowGit = false;

      const diagnostics = await fetch(`${server.url}api/diagnostics`).then(
        (response) => response.json(),
      );
      const weave = await fetch(`${server.url}api/weave`).then((response) =>
        response.json(),
      );
      const events = await fetch(`${server.url}api/events`).then((response) =>
        response.json(),
      );
      const second = await fetch(`${server.url}api/cockpit`).then((response) =>
        response.json(),
      );

      expect(diagnostics.projectRoot).toBe(projectRoot);
      expect(weave.nodes).toEqual(expect.any(Array));
      expect(events.events).toEqual(expect.any(Array));
      expect(second.project.id).toBe("dashboard-demo");
    } finally {
      await server.close();
    }
  });

  it("reuses host snapshots across refresh requests", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-host-cache-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-host-cache-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-host-cache-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "host-cache-registered",
      name: "Host Cache Registered",
    });
    const currentConfig = projectConfig({
      id: "host-cache-current",
      name: "Host Cache Current",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveProjectConfig(currentRoot, currentConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const baseGitRunner = fakeGitRunner();
    let allowGit = true;
    let gitCalls = 0;
    const server = await startNexusDashboardServer({
      projectRoot: currentRoot,
      homePath,
      gitRunner: (args, cwd) => {
        if (!allowGit) {
          throw new Error("host refresh should use the cached snapshot");
        }
        gitCalls += 1;
        return baseGitRunner(args, cwd);
      },
      now: fixedClock("2026-05-21T10:26:30.000Z"),
    });

    try {
      const first = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      expect(first.workspaceCount).toBe(2);
      expect(gitCalls).toBeGreaterThan(0);

      allowGit = false;

      const second = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      expect(second.workspaceCount).toBe(2);
      expect(second.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
        "host-cache-current",
        "host-cache-registered",
      ]);
    } finally {
      await server.close();
    }
  });

  it("serves a host project shell without probing workspace Git state", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-project-shell-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-project-shell-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "project-shell",
      name: "Project Shell",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: () => {
        throw new Error("project shell must not run Git");
      },
      now: fixedClock("2026-05-21T10:24:00.000Z"),
    });

    try {
      const response = await fetch(`${server.url}api/projects`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.host).toMatchObject({
        version: 1,
        workspaceCount: 1,
        partial: true,
      });
      expect(payload.projects).toEqual([
        expect.objectContaining({
          id: "project-shell",
          name: "Project Shell",
          root: registeredRoot,
          loading: true,
          componentCount: 1,
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("resolves selected workspace dashboard data without probing unrelated workspaces", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-selected-shell-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-selected-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-selected-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "selected-registered",
      name: "Selected Registered",
    });
    const currentConfig = projectConfig({
      id: "selected-current",
      name: "Selected Current",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveProjectConfig(currentRoot, currentConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const baseGitRunner = fakeGitRunner();
    const server = await startNexusDashboardServer({
      projectRoot: currentRoot,
      homePath,
      gitRunner: (args, cwd) => {
        if (cwd?.startsWith(registeredRoot)) {
          throw new Error("selected workspace lookup must not probe registered Git");
        }
        return baseGitRunner(args, cwd);
      },
      now: fixedClock("2026-05-21T10:24:30.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit?workspace=selected-current`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.project).toMatchObject({
        id: "selected-current",
        root: currentRoot,
      });
    } finally {
      await server.close();
    }
  });

  it("serves a workspace shell without probing Git or provider state", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-workspace-shell-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-workspace-shell-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "workspace-shell",
      name: "Workspace Shell",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: () => {
        throw new Error("workspace shell must not run Git");
      },
      now: fixedClock("2026-05-21T10:24:45.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/shell?workspace=workspace-shell`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        version: 1,
        partial: true,
        project: {
          id: "workspace-shell",
          name: "Workspace Shell",
          root: registeredRoot,
        },
        summary: "Loading workspace signals.",
      });
      expect(payload.components).toHaveLength(1);
      expect(payload.components[0].git).toBeNull();
      expect(payload.signals.map((signal: { value: string }) => signal.value)).toContain("...");
      expect(payload.threads.records).toEqual([]);
      expect(payload.trackedWork.records).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("serves workspace sections independently for card hydration", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-section-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-section-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "workspace-section",
      name: "Workspace Section",
      plugins: [
        {
          id: "configured-plugin",
          enabled: true,
          capabilities: [],
        },
      ],
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: () => {
        throw new Error("plugin section must not run Git");
      },
      now: fixedClock("2026-05-21T10:24:50.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/section?workspace=workspace-section&section=plugins`,
      );
      const payload = await response.json();
      const invalidResponse = await fetch(
        `${server.url}api/cockpit/section?workspace=workspace-section&section=unknown`,
      );

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        version: 1,
        section: "plugins",
        patch: {
          loadedSections: ["plugins"],
          plugins: {
            enabledCount: 1,
            availableCount: 3,
            records: expect.arrayContaining([
              expect.objectContaining({
                id: "configured-plugin",
                state: "enabled",
              }),
              expect.objectContaining({
                id: "dev-nexus-research",
                source: "catalogue",
                state: "available",
              }),
            ]),
          },
        },
      });
      expect(invalidResponse.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("serves local tracked work without provider hydration", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-tracked-local-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-tracked-local-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "tracked-local",
      name: "Tracked Local",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot: registeredRoot,
      now: fixedClock("2026-05-21T10:24:55.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot: registeredRoot,
      title: "Keep local work visible",
      status: "ready",
    });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      providerFactory: () => {
        throw new Error("tracked-work section must not hydrate provider work");
      },
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:25:00.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/section?workspace=tracked-local&section=tracked-work`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        section: "tracked-work",
        patch: {
          loadedSections: ["tracked-work"],
          trackedWork: {
            source: "local",
            incomplete: true,
            readyCount: 1,
            records: [
              expect.objectContaining({
                title: "Keep local work visible",
                provider: "local",
              }),
            ],
          },
          eligibleWork: {
            ok: false,
            error: {
              name: "Pending",
            },
          },
          blockers: [],
        },
      });
    } finally {
      await server.close();
    }
  });

  it("serves local thread state without cleanup planning", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-thread-local-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-thread-local-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "thread-local",
      name: "Thread Local",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    writeNexusWorktreeLeaseStore(registeredRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(registeredConfig.id, {
          id: "lease-thread-local",
          status: "working",
          branchName: "codex/dev-nexus/thread-local",
        }),
      ],
    });
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: (args, cwd) => {
        const command = args.join(" ");
        if (command.includes("worktree") || command.startsWith("branch ")) {
          throw new Error(`thread section must not run cleanup planner: ${command} in ${cwd}`);
        }
        return fakeGitRunner()(args, cwd);
      },
      now: fixedClock("2026-05-21T10:25:00.000Z"),
    });

    try {
      const response = await fetch(
        `${server.url}api/cockpit/section?workspace=thread-local&section=threads`,
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        section: "threads",
        patch: {
          loadedSections: ["threads"],
          threads: {
            source: "local",
            incomplete: true,
            totalCount: 1,
            records: [
              expect.objectContaining({
                id: "lease-thread-local",
                branchName: "codex/dev-nexus/thread-local",
                decision: "continue",
              }),
            ],
          },
        },
      });
    } finally {
      await server.close();
    }
  });

  it("serves host cockpit data without a current workspace root", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-host-only-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-host-only-registered-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "host-only-registered",
      name: "Host Only Registered",
    });
    saveProjectConfig(registeredRoot, registeredConfig);
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        projects: [
          {
            id: registeredConfig.id,
            name: registeredConfig.name,
            projectRoot: registeredRoot,
          },
        ],
      },
      validateNexusHomeConfigBase,
    );
    const server = await startNexusDashboardServer({
      homePath,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:25:00.000Z"),
    });

    try {
      const host = await fetch(`${server.url}api/host`).then((response) =>
        response.json(),
      );
      const workspaceResponse = await fetch(`${server.url}api/cockpit`);

      expect(server.projectRoot).toBeNull();
      expect(host).toMatchObject({
        version: 1,
        currentProjectRoot: null,
        selectedWorkspaceId: null,
        workspaceCount: 1,
        contract: {
          scope: "host",
          selection: {
            hostMode: true,
            selectedWorkspaceId: null,
          },
        },
      });
      expect(host.workspaces[0]).toMatchObject({
        id: "host-only-registered",
        current: false,
        registered: true,
      });
      expect(workspaceResponse.status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
