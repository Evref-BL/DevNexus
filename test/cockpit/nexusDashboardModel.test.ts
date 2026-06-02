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

describe("nexus dashboard model", () => {  it("builds a typed snapshot and weave from project facts", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-21T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Build cockpit",
      status: "ready",
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-21T09:30:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "dashboard-demo",
        targetId: "dashboard",
        status: "dispatched",
        summary: "Completed via DevNexus PR #66: provider links.",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            title: "Build cockpit",
            cycleStatus: "dispatched",
          },
        ],
      },
    });
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        worktreeLease(config.id),
        worktreeLease(config.id, {
          id: "lease-stale-notes",
          branchName: "codex/dev-nexus/github-115-stale-notes",
          lastSeenAt: "2026-05-19T10:00:00.000Z",
          updatedAt: "2026-05-19T10:00:00.000Z",
          notes: ["Interesting research notes; park this before cleanup."],
        }),
      ],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      version: 1,
      generatedAt: "2026-05-21T10:05:00.000Z",
      contract: {
        scope: "workspace",
        diagnostics: {
          defaultPayload: false,
          endpoint: "/api/diagnostics",
        },
        surfaces: {
          workspaceSummary: {
            field: "summary",
          },
          selectedWorkspaceSnapshot: {
            field: "project",
          },
          actionQueue: {
            defaultPayload: false,
          },
          providerActions: {
            field: "actions",
          },
          plugins: {
            field: "plugins",
          },
          threadActions: {
            field: "threads.records",
          },
        },
      },
      project: {
        id: "dashboard-demo",
        componentCount: 1,
      },
      eligibleWork: {
        ok: true,
        value: {
          eligibleWorkItemCount: 1,
        },
      },
      worktrees: {
        activeCount: 1,
        staleCount: 1,
      },
      threads: {
        totalCount: 2,
        activeCount: 1,
        needsDecisionCount: 1,
      },
      plugins: {
        enabledCount: 1,
        totalCount: 3,
        capabilityCount: 2,
      },
    });
    expect(snapshot.threads.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lease-dashboard",
          decision: "continue",
          decisionLabel: "Continue",
        }),
        expect.objectContaining({
          id: "lease-stale-notes",
          decision: "review",
          decisionLabel: "Review",
          actions: [
            expect.objectContaining({
              label: "#115: stale notes",
              href: "https://github.com/Evref-BL/DevNexus/issues/115",
            }),
          ],
        }),
      ]),
    );
    expect(snapshot.signals.map((signal) => signal.id)).toContain("eligible-work");
    expect(snapshot.signals.find((signal) => signal.id === "worktrees")).toMatchObject({
      label: "Threads",
      value: "2",
      detail: "1 thread needs action",
    });
    expect(snapshot.signals.find((signal) => signal.id === "plugins")).toMatchObject({
      label: "Plugins",
      value: "1",
      detail: "2 capabilities",
    });
    expect(snapshot.plugins.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "dev-nexus-typescript",
        name: "DevNexus TypeScript",
        capabilityCount: 2,
        mcpServerCount: 1,
        projectedSkillCount: 1,
        projectedSkills: ["typescript-diagnose"],
        mcpServers: ["dev-nexus-typescript"],
      }),
      expect.objectContaining({
        id: "dev-nexus-pharo",
        source: "catalogue",
        state: "available",
      }),
    ]));
    expect(snapshot.weave.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "project",
        "component:primary",
        "work-item:primary-local-1",
        "worktree:lease-dashboard",
        "target-cycle:cycle-1",
      ]),
    );
    expect(snapshot.weave.edges.some((edge) => edge.kind === "selected")).toBe(true);
    expect(snapshot.weave.nodes.find((node) => node.id === "target-cycle:cycle-1")).toMatchObject({
      href: "https://github.com/Evref-BL/DevNexus/pull/66",
      actions: [
        {
          label: "PR #66: provider links",
          href: "https://github.com/Evref-BL/DevNexus/pull/66",
          provider: "github",
          kind: "pull-request",
        },
      ],
    });
    expect(snapshot.weave.nodes.find((node) => node.id === "worktree:lease-dashboard")).toMatchObject({
      href: "https://github.com/Evref-BL/DevNexus/issues/114",
      actions: [
        {
          label: "#114: dashboard",
          href: "https://github.com/Evref-BL/DevNexus/issues/114",
          provider: "github",
          kind: "issue",
        },
      ],
    });
    expect(snapshot.events.find((event) => event.id === "target-cycle-cycle-1")).toMatchObject({
      href: "https://github.com/Evref-BL/DevNexus/pull/66",
    });
  });

  it("builds git history from refs and commit parent relationships", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-git-history-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "show-ref -d --head") {
        return ok(args as string[], [
          "merge000000000000000000000000000000000000000 HEAD",
          "merge000000000000000000000000000000000000000 refs/heads/main",
          "feature000000000000000000000000000000000000 refs/heads/feat/cockpit-graph",
          "merge000000000000000000000000000000000000000 refs/remotes/app/main",
          "tag0000000000000000000000000000000000000000 refs/tags/v1.0.0",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log")) {
        expect(command).toContain("--all");
        return ok(args as string[], [
          [
            "merge000000000000000000000000000000000000000",
            "main10000000000000000000000000000000000000 feature000000000000000000000000000000000000",
            "Gabriel",
            "gabriel@example.com",
            "1779537600",
            "Merge feature graph",
          ].join(field),
          [
            "feature000000000000000000000000000000000000",
            "main10000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537300",
            "Add graph data",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      now: fixedClock("2026-05-23T10:00:00.000Z"),
    });

    expect(snapshot.history).toMatchObject({
      totalCommitCount: 2,
      incomplete: false,
      repositories: [
        expect.objectContaining({
          componentId: "primary",
          head: "merge000000000000000000000000000000000000000",
          scope: {
            kind: "all",
            branches: [],
          },
          branchNames: [
            "main",
            "feat/cockpit-graph",
            "app/main",
          ],
          tagNames: ["v1.0.0"],
          moreAvailable: false,
          commits: [
            expect.objectContaining({
              hash: "merge000000000000000000000000000000000000000",
              shortHash: "merge00",
              parents: [
                "main10000000000000000000000000000000000000",
                "feature000000000000000000000000000000000000",
              ],
              subject: "Merge feature graph",
              refs: expect.arrayContaining([
                expect.objectContaining({ kind: "head", name: "HEAD" }),
                expect.objectContaining({ kind: "branch", name: "main" }),
                expect.objectContaining({ kind: "remote", name: "app/main" }),
              ]),
            }),
            expect.objectContaining({
              hash: "feature000000000000000000000000000000000000",
              parents: ["main10000000000000000000000000000000000000"],
              committedAt: "2026-05-23T11:55:00.000Z",
              subject: "Add graph data",
              refs: [
                expect.objectContaining({
                  kind: "branch",
                  name: "feat/cockpit-graph",
                }),
              ],
            }),
          ],
        }),
      ],
    });
  });

  it("includes workspace git history when the workspace repo is separate from component repos", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-workspace-git-history-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:Gabot-Darbot/dev-nexus-dogfood.git",
        defaultBranch: "main",
        sourceRoot: "source",
      },
      components: [
        {
          id: "primary",
          name: "Dashboard Demo",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
          defaultBranch: "main",
          sourceRoot: "source",
          defaultWorkTrackerId: "local",
          workTrackers: [
            {
              id: "local",
              name: "Local",
              enabled: true,
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        },
      ],
    }));
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") {
        return ok(args as string[], `${cwd === sourceRoot ? sourceRoot : projectRoot}\n`);
      }
      if (command === "rev-parse HEAD") {
        return ok(
          args as string[],
          cwd === sourceRoot
            ? "component00000000000000000000000000000000000\n"
            : "workspace000000000000000000000000000000000\n",
        );
      }
      if (command === "show-ref -d --head" && cwd === sourceRoot) {
        return ok(args as string[], [
          "component00000000000000000000000000000000000 HEAD",
          "component00000000000000000000000000000000000 refs/heads/main",
          "",
        ].join("\n"));
      }
      if (command === "show-ref -d --head" && cwd === projectRoot) {
        return ok(args as string[], [
          "workspace000000000000000000000000000000000 HEAD",
          "workspace000000000000000000000000000000000 refs/heads/main",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log") && cwd === sourceRoot) {
        return ok(args as string[], [
          [
            "component00000000000000000000000000000000000",
            "",
            "Codex",
            "codex@example.com",
            "1779537600",
            "Component write",
          ].join(field),
          record,
        ].join(record));
      }
      if (command.startsWith("-c log.showSignature=false log") && cwd === projectRoot) {
        return ok(args as string[], [
          [
            "workspace000000000000000000000000000000000",
            "",
            "Gabriel",
            "gabriel@example.com",
            "1779537300",
            "Workspace metadata write",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      now: fixedClock("2026-05-23T10:00:00.000Z"),
    });

    expect(snapshot.history.totalCommitCount).toBe(2);
    expect(snapshot.history.repositories.map((repository) => repository.componentId)).toEqual([
      "primary",
      "workspace",
    ]);
    expect(snapshot.history.repositories[1]).toMatchObject({
      componentId: "workspace",
      componentName: "Workspace",
      repositoryPath: projectRoot,
      commits: [
        expect.objectContaining({
          hash: "workspace000000000000000000000000000000000",
          subject: "Workspace metadata write",
        }),
      ],
    });
  });

  it("can scope git history to selected branches", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-filtered-git-history-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "show-ref -d --head") {
        return ok(args as string[], [
          "feature100000000000000000000000000000000000 refs/heads/feat/cockpit-graph",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log")) {
        expect(command).toContain("feat/cockpit-graph");
        expect(command).not.toContain("--all");
        return ok(args as string[], [
          [
            "feature100000000000000000000000000000000000",
            "main10000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537600",
            "Add graph data",
          ].join(field),
          [
            "feature000000000000000000000000000000000000",
            "main00000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537300",
            "Start graph data",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      historyBranches: ["feat/cockpit-graph"],
      historyMaxCommits: 1,
      now: fixedClock("2026-05-23T10:00:00.000Z"),
    });

    expect(snapshot.history.repositories[0]).toMatchObject({
      scope: {
        kind: "branches",
        branches: ["feat/cockpit-graph"],
      },
      moreAvailable: true,
      commits: [
        expect.objectContaining({
          hash: "feature100000000000000000000000000000000000",
        }),
      ],
    });
  });


});
