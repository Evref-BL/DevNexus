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

describe("nexus dashboard model", () => {
  it("builds a typed snapshot and weave from project facts", async () => {
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

  it("builds a feature overview from feature branch delivery policy and related threads", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-features-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const baseConfig = projectConfig();
    const config = {
      ...baseConfig,
      automation: {
        ...baseConfig.automation!,
        publication: {
          ...baseConfig.automation!.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: "v-next",
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
            },
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
    };
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-23T09:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-feature-branch",
          branchName: "feat/codex-goals",
          lastSeenAt: "2026-05-23T08:30:00.000Z",
          updatedAt: "2026-05-23T08:30:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-review-branch",
          branchName: "feat/codex-goals/header-card",
          lastSeenAt: "2026-05-23T08:45:00.000Z",
          updatedAt: "2026-05-23T08:45:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-unrelated",
          branchName: "fix/other-thing",
          lastSeenAt: "2026-05-23T08:50:00.000Z",
          updatedAt: "2026-05-23T08:50:00.000Z",
        }),
      ],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.features).toMatchObject({
      activeCount: 2,
      needsAttentionCount: 0,
      records: expect.arrayContaining([
        expect.objectContaining({
          id: "feature:primary:codex-goals",
          title: "codex-goals",
          componentIds: ["primary"],
          branchStrategy: "hybrid",
          status: "active",
          statusLabel: "Active",
          featureBranch: "feat/codex-goals",
          reviewBranchPattern: "feat/codex-goals/{change}",
          finalPublicationTarget: "main",
          threadCount: 2,
          branchCount: 2,
          branches: ["feat/codex-goals", "feat/codex-goals/header-card"],
        }),
      ]),
    });
  });

  it("summarizes configured Git workflow profiles and recorded runs", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-git-workflows-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: {
        ...defaultNexusAutomationConfig,
        gitWorkflows: {
          activeProfileId: "protected-main",
          profiles: [
            {
              id: "protected-main",
              name: "Protected main",
              source: "configured",
              branchStrategy: "hybrid",
              targetBranch: "main",
              activeFeatureId: "codex-goals",
              allowedBranchStrategies: [
                ...defaultNexusFeatureBranchDeliveryConfig.allowedBranchStrategies,
              ],
              branchNaming: {
                ...defaultNexusFeatureBranchDeliveryConfig.branchNaming,
                allowedIntentPrefixes: [
                  ...defaultNexusFeatureBranchDeliveryConfig.branchNaming
                    .allowedIntentPrefixes,
                ],
              },
              review: {
                ...defaultNexusFeatureBranchDeliveryConfig.review,
              },
              provider: {
                ...defaultNexusFeatureBranchDeliveryConfig.provider,
              },
              branchPublication: {
                ...defaultNexusFeatureBranchDeliveryConfig.branchPublication,
              },
              update: {
                ...defaultNexusGitWorkflowUpdatePolicyConfig,
                behind: "restack",
              },
              gates: {
                ...defaultNexusGitWorkflowGateConfig,
                review: ["provider_review"],
                publication: [
                  "human_approval",
                  "provider_review",
                  "publication_authority",
                ],
              },
              release: null,
              environment: null,
            },
          ],
        },
      },
    });
    saveProjectConfig(projectRoot, config);
    createNexusGitWorkflowRun({
      projectRoot,
      id: "run-review",
      projectId: config.id,
      componentId: "primary",
      profileId: "protected-main",
      branchStrategy: "hybrid",
      workItemId: "github-123",
      branchName: "codex/dev-nexus/123-cockpit",
      currentRef: "codex/dev-nexus/123-cockpit",
      targetBranch: "main",
      owner: {
        kind: "human",
        id: "Gabriel",
      },
      evidence: [
        {
          id: "checks",
          kind: "verification",
          summary: "Focused checks passed.",
        },
      ],
      allowedTransitions: [
        {
          id: "approve",
          to: "completed",
          summary: "Approve publication.",
          requiresApproval: true,
        },
      ],
      now: "2026-05-23T09:03:00.000Z",
    });
    updateNexusGitWorkflowRun({
      projectRoot,
      id: "run-review",
      status: "ready_for_review",
      owner: {
        kind: "human",
        id: "Gabriel",
      },
      now: "2026-05-23T09:04:00.000Z",
    });
    createNexusGitWorkflowRun({
      projectRoot,
      id: "run-merged",
      projectId: config.id,
      componentId: "primary",
      profileId: "protected-main",
      branchStrategy: "hybrid",
      branchName: "codex/dev-nexus/122-done",
      currentRef: "main",
      targetBranch: "main",
      now: "2026-05-23T08:00:00.000Z",
    });
    updateNexusGitWorkflowRun({
      projectRoot,
      id: "run-merged",
      status: "merged",
      terminalOutcome: "merged",
      now: "2026-05-23T08:30:00.000Z",
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.gitWorkflows).toMatchObject({
      activeProfileId: "protected-main",
      profileCount: 1,
      runCount: 2,
      activeRunCount: 1,
      waitingRunCount: 1,
      blockedRunCount: 0,
      terminalRunCount: 1,
      profiles: [
        expect.objectContaining({
          id: "protected-main",
          name: "Protected main",
          branchStrategy: "hybrid",
          targetBranch: "main",
          activeFeatureId: "codex-goals",
          reviewMode: "review_branch_pr",
          finalPullRequest: true,
          gateCount: 5,
        }),
      ],
      runs: [
        expect.objectContaining({
          id: "run-review",
          status: "ready_for_review",
          statusLabel: "Ready for review",
          branchName: "codex/dev-nexus/123-cockpit",
          nextOwnerLabel: "Human: Gabriel",
          evidenceCount: 1,
          allowedTransitionCount: 1,
        }),
        expect.objectContaining({
          id: "run-merged",
          status: "merged",
          statusLabel: "Merged",
        }),
      ],
    });
  });

  it("infers active feature groups from branch families when no feature policy is configured", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-inferred-features-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-23T09:00:00.000Z",
      leases: [
        worktreeLease(config.id, {
          id: "lease-feature-api",
          branchName: "feat/codex-goals/api",
          lastSeenAt: "2026-05-23T08:30:00.000Z",
          updatedAt: "2026-05-23T08:30:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-feature-ui",
          branchName: "feat/codex-goals/ui",
          lastSeenAt: "2026-05-23T08:45:00.000Z",
          updatedAt: "2026-05-23T08:45:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-dashboard",
          branchName: "codex/dev-nexus/dashboard-cockpit-kit",
          lastSeenAt: "2026-05-23T08:50:00.000Z",
          updatedAt: "2026-05-23T08:50:00.000Z",
        }),
        worktreeLease(config.id, {
          id: "lease-quality-audit",
          branchName: "codex/dev-nexus/---quality+++audit---",
          lastSeenAt: "2026-05-23T08:55:00.000Z",
          updatedAt: "2026-05-23T08:55:00.000Z",
        }),
      ],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.features.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "feature:inferred:codex-goals",
          title: "codex-goals",
          branchStrategy: "inferred",
          status: "active",
          branchCount: 2,
          branches: ["feat/codex-goals/api", "feat/codex-goals/ui"],
        }),
        expect.objectContaining({
          id: "feature:inferred:dashboard-cockpit-kit",
          title: "dashboard-cockpit-kit",
          branchStrategy: "inferred",
          status: "active",
          branchCount: 1,
          branches: ["codex/dev-nexus/dashboard-cockpit-kit"],
        }),
        expect.objectContaining({
          id: "feature:inferred:quality-audit",
          title: "---quality+++audit---",
          branchStrategy: "inferred",
          status: "active",
          branchCount: 1,
          branches: ["codex/dev-nexus/---quality+++audit---"],
        }),
      ]),
    );
  });

  it("infers active feature groups from Git refs without worktree leases", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-inferred-git-features-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const field = "\x1f";
    const record = "\x1e";
    const baseGitRunner = fakeGitRunner();
    const gitRunner: GitRunner = (args, cwd) => {
      const command = args.join(" ");
      if (command === "show-ref -d --head") {
        return ok(args as string[], [
          "main000000000000000000000000000000000000000 refs/heads/main",
          "api0000000000000000000000000000000000000000 refs/remotes/origin/feat/codex-goals/api",
          "ui00000000000000000000000000000000000000000 refs/heads/feat/codex-goals/ui",
          "",
        ].join("\n"));
      }
      if (command.startsWith("-c log.showSignature=false log")) {
        return ok(args as string[], [
          [
            "ui00000000000000000000000000000000000000000",
            "main000000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537600",
            "Add UI branch",
          ].join(field),
          [
            "api0000000000000000000000000000000000000000",
            "main000000000000000000000000000000000000000",
            "Codex",
            "codex@example.com",
            "1779537300",
            "Add API branch",
          ].join(field),
          record,
        ].join(record));
      }
      return baseGitRunner(args, cwd);
    };

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner,
      now: fixedClock("2026-05-23T09:05:00.000Z"),
    });

    expect(snapshot.features.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "feature:inferred:codex-goals",
          title: "codex-goals",
          branchStrategy: "inferred",
          status: "active",
          featureBranch: "feat/codex-goals",
          branchCount: 2,
          branches: [
            "origin/feat/codex-goals/api",
            "feat/codex-goals/ui",
          ],
          componentIds: ["primary"],
          componentNames: ["Dashboard Demo"],
        }),
      ]),
    );
    expect(
      snapshot.features.records.find(
        (feature) => feature.id === "feature:inferred:codex-goals",
      )?.detail,
    ).toContain("Git refs");
  });

  it("classifies thread lifecycle states and resumable assistant chats", async () => {
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
