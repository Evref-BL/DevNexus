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
  createNexusGitWorkflowRun,
  createNexusDashboardCodexChatStarter,
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  defaultNexusGitWorkflowGateConfig,
  defaultNexusGitWorkflowUpdatePolicyConfig,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  startNexusDashboardServer,
  stopVerifiedNexusDashboardServerRecord,
  updateNexusGitWorkflowRun,
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

describe("nexus dashboard model host summaries", () => {  it("classifies thread lifecycle states and resumable assistant chats", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-thread-lifecycle-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-resume",
          workItemId: "local-1",
          branchName: "codex/dev-nexus/github-114-dashboard",
          status: "working",
          updatedAt: "2026-05-21T10:00:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-blocked",
          workItemId: "github-120",
          branchName: "codex/dev-nexus/github-120-blocked",
          status: "blocked",
          updatedAt: "2026-05-21T09:00:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-merged",
          workItemId: "github-121",
          branchName: "codex/dev-nexus/github-121-merged",
          status: "merged",
          updatedAt: "2026-05-21T08:00:00.000Z",
        }),
      ],
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-21T10:02:00.000Z",
      record: {
        id: "run-chat-1",
        projectId: config.id,
        componentId: "primary",
        status: "completed",
        startedAt: "2026-05-21T10:01:00.000Z",
        finishedAt: "2026-05-21T10:02:00.000Z",
        workItemId: "local-1",
        branchName: "codex/dev-nexus/github-114-dashboard",
        codexAppServer: {
          provider: "codex-app-server",
          status: "completed",
          action: "thread_start",
          runId: "run-chat-1",
          profileId: "codex-app-server",
          threadId: "existing-thread",
          turnId: "turn-old",
          sourceThreadId: null,
          sourceTurnId: null,
          ephemeral: false,
          threadPersistence: "durable",
          cwd: projectRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: path.join(projectRoot, ".dev-nexus", "automation", "result.json"),
          failureSummary: null,
        },
      },
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot.threads).toMatchObject({
      activeCount: 1,
      needsDecisionCount: 2,
    });
    expect(snapshot.threads.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lease-resume",
          decision: "resume",
          decisionLabel: "Resume",
          assistantThreadId: "existing-thread",
        }),
        expect.objectContaining({
          id: "lease-blocked",
          decision: "blocked",
          decisionLabel: "Blocked",
        }),
        expect.objectContaining({
          id: "lease-merged",
          decision: "merged",
          decisionLabel: "Merged",
        }),
      ]),
    );
  });

  it("summarizes enabled and disabled plugins for cockpit cards", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-plugins-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      plugins: [
        ...(projectConfig().plugins ?? []),
        {
          id: "dev-nexus-research",
          name: "DevNexus Research",
          version: "0.1.0-test",
          enabled: false,
          capabilities: [
            {
              kind: "setup_obligation",
              id: "research-corpus",
              description: "Prepare research corpus",
              required: true,
            },
            {
              kind: "dependency_projection",
              id: "research-node-modules",
              source: "node_modules",
              target: "node_modules",
              required: true,
            },
          ],
        },
      ],
    });
    saveProjectConfig(projectRoot, config);

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot.plugins).toMatchObject({
      totalCount: 3,
      enabledCount: 1,
      configuredCount: 2,
      availableCount: 1,
      capabilityCount: 4,
    });
    expect(snapshot.plugins.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dev-nexus-research",
          enabled: false,
          setupActionCount: 1,
          dependencyProjectionCount: 1,
          setupHints: ["Prepare research corpus"],
          dependencyHints: ["node_modules -> node_modules"],
        }),
      ]),
    );
  });

  it("surfaces curated catalogue plugins as available cockpit plugins", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-catalogue-plugins-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({ plugins: [] }));

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot.plugins).toMatchObject({
      totalCount: 3,
      enabledCount: 0,
      configuredCount: 0,
      availableCount: 3,
      capabilityCount: 0,
    });
    expect(snapshot.plugins.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dev-nexus-typescript",
          name: "DevNexus TypeScript",
          source: "catalogue",
          state: "available",
          enabled: false,
          packageName: "@evref-bl/dev-nexus-typescript",
          sourcePath: null,
        }),
        expect.objectContaining({
          id: "dev-nexus-pharo",
          name: "DevNexus-Pharo",
          source: "catalogue",
          state: "available",
          enabled: false,
          packageName: "@evref-bl/dev-nexus-pharo",
          sourcePath: null,
        }),
        expect.objectContaining({
          id: "dev-nexus-research",
          name: "DevNexus Research",
          source: "catalogue",
          state: "available",
          enabled: false,
          packageName: "@evref-bl/dev-nexus-research",
          sourcePath: null,
          detail: "Research and LaTeX paper-writing workflow plugin for DevNexus.",
        }),
      ]),
    );
    const research = snapshot.plugins.records.find((record) => record.id === "dev-nexus-research");
    expect(research?.refreshCommand).toContain("dev-nexus workspace plugin refresh");
    expect(research?.refreshCommand).toContain("--from '@evref-bl/dev-nexus-research'");
    expect(research?.refreshCommand).toContain("--export devNexusResearchDevNexusPluginConfig");
    expect(research?.refreshCommand).not.toContain(path.join(projectRoot, "source"));
  });

  it("builds a host snapshot from registered workspaces plus the current project", async () => {
    const homePath = makeTempDir("dev-nexus-dashboard-home-");
    const registeredRoot = makeTempDir("dev-nexus-dashboard-registered-");
    const currentRoot = makeTempDir("dev-nexus-dashboard-current-");
    fs.mkdirSync(path.join(registeredRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(currentRoot, "source"), { recursive: true });
    const registeredConfig = projectConfig({
      id: "registered-project",
      name: "Registered Project",
    });
    const currentConfig = projectConfig({
      id: "current-project",
      name: "Current Project",
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

    const host = await buildNexusDashboardHostSnapshot({
      projectRoot: currentRoot,
      homePath,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:10:00.000Z"),
    });

    expect(host).toMatchObject({
      version: 1,
      generatedAt: "2026-05-21T10:10:00.000Z",
      homePath,
      currentProjectRoot: currentRoot,
      selectedWorkspaceId: "current-project",
      workspaceCount: 2,
      homeError: null,
      contract: {
        scope: "host",
        selection: {
          selectedWorkspaceId: "current-project",
          workspaceQueryParam: "workspace",
        },
        surfaces: {
          hostSummary: {
            field: "workspaces",
          },
          workspaceSummary: {
            field: "workspaces[]",
          },
          selectedWorkspaceSnapshot: {
            endpoint: "/api/cockpit?workspace=:workspaceId",
          },
          actionQueue: {
            field: "actionQueue",
          },
          providerActions: {
            field: "actionQueue[].providerAction",
          },
          plugins: {
            field: "workspaces[].pluginCount",
          },
          threadActions: {
            field: "workspaces[].needsDecisionCount",
          },
        },
      },
    });
    expect(host.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "current-project",
          name: "Current Project",
          root: currentRoot,
          current: true,
          registered: false,
          componentCount: 1,
          pluginCount: 1,
        }),
        expect.objectContaining({
          id: "registered-project",
          name: "Registered Project",
          root: registeredRoot,
          current: false,
          registered: true,
          componentCount: 1,
          pluginCount: 1,
        }),
      ]),
    );
  });

  it("builds a ranked host action queue from workspace attention signals", () => {
    const actions = buildNexusDashboardHostActionQueue([
      hostWorkspace({
        id: "dirty",
        name: "Dirty Workspace",
        dirtyComponentCount: 2,
        tone: "warn",
      }),
      hostWorkspace({
        id: "approval",
        name: "Approval Workspace",
        approvalCount: 3,
        actionUpdatedAt: {
          approval: "2026-05-21T09:30:00.000Z",
        },
        tone: "warn",
      }),
      hostWorkspace({
        id: "thread",
        name: "Thread Workspace",
        threadCount: 4,
        needsDecisionCount: 2,
        staleThreadCount: 1,
        actionUpdatedAt: {
          thread: "2026-05-21T08:15:00.000Z",
        },
        tone: "warn",
      }),
      hostWorkspace({
        id: "ready",
        name: "Ready Workspace",
        eligibleWorkCount: 2,
        actionUpdatedAt: {
          "ready-work": "2026-05-21T09:45:00.000Z",
        },
        firstReadyWorkSelectionId: "tracked-work:primary:github-42",
        firstReadyWorkProviderAction: {
          label: "#42: ready work",
          href: "https://github.com/Evref-BL/DevNexus/issues/42",
          provider: "github",
          kind: "issue",
          title: "ready work",
        },
        tone: "active",
      }),
      hostWorkspace({
        id: "blocked",
        name: "Blocked Workspace",
        blockerCount: 1,
        automationStatus: "blocked",
        actionUpdatedAt: {
          blocker: "2026-05-21T09:50:00.000Z",
        },
        tone: "danger",
      }),
      hostWorkspace({
        id: "broken",
        name: "Broken Workspace",
        summary: "Workspace snapshot is unavailable.",
        actionUpdatedAt: {
          "workspace-error": "2026-05-21T09:55:00.000Z",
        },
        tone: "danger",
        error: {
          name: "Error",
          message: "Missing project config",
        },
      }),
    ]);

    expect(actions.map((action) => action.kind)).toEqual([
      "workspace-error",
      "blocker",
      "approval",
      "ready-work",
      "thread",
      "dirty",
    ]);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "host-action:broken:workspace-error",
          workspaceId: "broken",
          reason: "Workspace unavailable",
          state: "unavailable",
          updatedAt: "2026-05-21T09:55:00.000Z",
          primaryAction: {
            label: "Review workspace",
            kind: "review",
            workspaceId: "broken",
            targetSelectionId: null,
          },
        }),
        expect.objectContaining({
          id: "host-action:approval:approval",
          reason: "3 approvals needed",
          updatedAt: "2026-05-21T09:30:00.000Z",
          primaryAction: expect.objectContaining({
            label: "Review approval",
          }),
        }),
        expect.objectContaining({
          id: "host-action:thread:thread",
          reason: "2 threads need action",
          state: "stale threads",
          updatedAt: "2026-05-21T08:15:00.000Z",
        }),
        expect.objectContaining({
          id: "host-action:ready:ready-work",
          reason: "2 ready items",
          updatedAt: "2026-05-21T09:45:00.000Z",
          primaryAction: {
            label: "Review work",
            kind: "start-work",
            workspaceId: "ready",
            targetSelectionId: "tracked-work:primary:github-42",
          },
          providerAction: expect.objectContaining({
            href: "https://github.com/Evref-BL/DevNexus/issues/42",
          }),
        }),
        expect.objectContaining({
          id: "host-action:dirty:dirty",
          reason: "2 dirty components",
          updatedAt: null,
          primaryAction: {
            label: "Rescue changes",
            kind: "rescue",
            workspaceId: "dirty",
            targetSelectionId: null,
          },
        }),
      ]),
    );
  });
});
