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

describe("nexus dashboard model workflow summaries", () => {  it("builds a feature overview from feature branch delivery policy and related threads", async () => {
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


});
