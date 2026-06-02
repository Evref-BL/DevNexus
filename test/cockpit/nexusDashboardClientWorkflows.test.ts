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
import {
  gitHistoryPopoverConnectorY,
  gitHistoryPopoverPixelValue,
  gitHistoryNodePopoverContent,
  isGitHistoryPopoverColor,
  renderGitHistoryNodePopoverContent,
} from "../../src/cockpit/client/history/nexusCockpitHistoryInteractions.js";
import { cockpitStyles } from "../../src/cockpit/client/nexusCockpitStyles.js";

afterEach(cleanupDashboardTestTempDirs);

describe("nexus dashboard client workflow surfaces", () => {  it("labels parallel work-map lanes without repeating branch names as row titles", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      project: {
        defaultBranch: "main",
        name: "Dashboard Demo",
        root: "/tmp/dashboard-demo",
      },
      weave: {
        nodes: [
          {
            id: "branch:main",
            kind: "branch",
            label: "main",
            detail: "origin/main",
            status: "clean",
            timestamp: null,
          },
          {
            id: "worktree:alpha",
            kind: "worktree",
            label: "codex/dev-nexus/alpha-branch",
            detail: "working on Mac.lan",
            status: "working",
            timestamp: "2026-05-21T10:00:00.000Z",
          },
          {
            id: "worktree:beta",
            kind: "worktree",
            label: "codex/dev-nexus/beta-branch",
            detail: "working on Mac.lan",
            status: "working",
            timestamp: "2026-05-21T09:00:00.000Z",
          },
          {
            id: "worktree:gamma",
            kind: "worktree",
            label: "codex/dev-nexus/gamma-branch",
            detail: "working on Mac.lan",
            status: "working",
            timestamp: "2026-05-21T08:00:00.000Z",
          },
          {
            id: "target-cycle:cycle-1",
            kind: "target-cycle",
            label: "cycle-1",
            detail: "Completed provider links.",
            status: "completed",
            timestamp: "2026-05-21T07:00:00.000Z",
          },
          {
            id: "authority",
            kind: "authority",
            label: "Approval",
            detail: "One provider action needs approval.",
            status: "blocked",
            timestamp: null,
          },
        ],
      },
      worktrees: {
        records: [
          {
            id: "alpha",
            branchName: "codex/dev-nexus/alpha-branch",
            componentId: "dev-nexus",
            workItemId: "github-114",
            hostId: "Mac.lan",
            updatedAt: "2026-05-21T10:00:00.000Z",
          },
          {
            id: "beta",
            branchName: "codex/dev-nexus/beta-branch",
            componentId: "dev-nexus",
            workItemId: "github-115",
            hostId: "Mac.lan",
            updatedAt: "2026-05-21T09:00:00.000Z",
          },
          {
            id: "gamma",
            branchName: "codex/dev-nexus/gamma-branch",
            componentId: "dev-nexus",
            workItemId: "github-116",
            hostId: "Mac.lan",
            updatedAt: "2026-05-21T08:00:00.000Z",
          },
        ],
      },
    };

    const lanes = hooks.timelineLanes(snapshot);
    expect(lanes.map((lane) => [lane.label, lane.detail])).toEqual([
      ["Source checkout", "main component heads"],
      ["Active branch", "dev-nexus/alpha-branch"],
      ["Active branch", "dev-nexus/beta-branch"],
      ["More branches", "1 grouped branch"],
      ["Automation", "Runs and target cycles"],
      ["Decisions", "Approvals and blockers"],
    ]);

    const laneKey = hooks.renderLaneKey(lanes);
    expect(laneKey).toContain("<strong>Active branch</strong>");
    expect(laneKey).toContain("dev-nexus/alpha-branch");
    expect(laneKey).toContain("Approvals and blockers");

    const timeline = hooks.historyRows(snapshot);
    const alphaRow = timeline.rows.find((row) => row.node.id === "worktree:alpha");
    const gammaRow = timeline.rows.find((row) => row.node.id === "worktree:gamma");
    expect(alphaRow).toMatchObject({
      title: "github-114",
      lane: 1,
    });
    expect(alphaRow?.title).not.toContain("alpha-branch");
    expect(alphaRow?.detail).toContain("dev-nexus/alpha-branch");
    expect(gammaRow).toMatchObject({
      title: "dev-nexus/gamma-branch",
      lane: 3,
    });

    const graph = hooks.renderBranchGraph(timeline.rows, timeline.lanes);
    expect(graph).toContain(" H 118");
    expect(graph).not.toContain(" C ");
  });

  it("renders active features as the primary project workflow surface", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      features: {
        activeCount: 1,
        needsAttentionCount: 0,
        records: [
          {
            id: "feature:primary:codex-goals",
            title: "codex-goals",
            featureId: "codex-goals",
            componentIds: ["primary"],
            componentNames: ["DevNexus"],
            releaseTrainVersionId: "v-next",
            branchStrategy: "hybrid",
            status: "active",
            statusLabel: "Active",
            tone: "active",
            detail: "hybrid branch strategy, feature branch feat/codex-goals, 2 branches, 2 threads, targeting main.",
            featureBranch: "feat/codex-goals",
            reviewBranchPattern: "feat/codex-goals/{change}",
            defaultChangeBaseBranch: "feat/codex-goals",
            finalReviewTarget: "main",
            finalPublicationTarget: "main",
            reviewMode: "review_branch_pr",
            finalPullRequestCreation: "at_review_gate",
            commentPolicy: "status_only",
            threadCount: 2,
            activeThreadCount: 2,
            needsDecisionCount: 0,
            branchCount: 2,
            branches: ["feat/codex-goals", "feat/codex-goals/header-card"],
            updatedAt: "2026-05-23T09:00:00.000Z",
            warnings: [],
          },
        ],
      },
      events: [],
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderFeatureOverview(
      snapshot,
      "feature:primary:codex-goals",
    );
    const detail = hooks.selectedDetail(snapshot, "feature:primary:codex-goals");

    expect(rendered).toContain("Active Features");
    expect(rendered).toContain("codex-goals");
    expect(rendered).toContain("hybrid");
    expect(rendered).toContain("feat/codex-goals");
    expect(rendered).toContain("2 branches");
    expect(rendered).toContain("data-select-id=\"feature:primary:codex-goals\"");
    expect(detail).toMatchObject({
      title: "codex-goals",
      facts: expect.arrayContaining([
        ["Type", "feature"],
        ["Branch strategy", "hybrid"],
        ["Feature branch", "feat/codex-goals"],
        ["Target branch", "main"],
      ]),
    });
  });

  it("renders Git workflow state as compact read-only cockpit context", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      features: {
        activeCount: 0,
        needsAttentionCount: 0,
        records: [],
      },
      gitWorkflows: {
        activeProfileId: "protected-main",
        profileCount: 1,
        runCount: 2,
        activeRunCount: 1,
        waitingRunCount: 1,
        blockedRunCount: 0,
        terminalRunCount: 1,
        profiles: [
          {
            id: "protected-main",
            name: "Protected main",
            source: "configured",
            branchStrategy: "hybrid",
            targetBranch: "main",
            activeFeatureId: "codex-goals",
            reviewMode: "review_branch_pr",
            finalPullRequest: true,
            gateCount: 6,
          },
        ],
        runs: [
          {
            id: "run-review",
            componentId: "primary",
            profileId: "protected-main",
            branchStrategy: "hybrid",
            status: "ready_for_review",
            statusLabel: "Ready for review",
            terminalOutcome: null,
            branchName: "codex/dev-nexus/123-cockpit",
            currentRef: "codex/dev-nexus/123-cockpit",
            targetBranch: "main",
            workItemId: "github-123",
            nextOwnerLabel: "Human: Gabriel",
            evidenceCount: 1,
            allowedTransitionCount: 1,
            updatedAt: "2026-05-23T09:04:00.000Z",
          },
          {
            id: "run-merged",
            componentId: "primary",
            profileId: "protected-main",
            branchStrategy: "hybrid",
            status: "merged",
            statusLabel: "Merged",
            terminalOutcome: "merged",
            branchName: "codex/dev-nexus/122-done",
            currentRef: "main",
            targetBranch: "main",
            workItemId: null,
            nextOwnerLabel: "No owner",
            evidenceCount: 0,
            allowedTransitionCount: 0,
            updatedAt: "2026-05-23T08:30:00.000Z",
          },
        ],
      },
      events: [],
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderFeatureOverview(snapshot, null);

    expect(rendered).toContain("Git workflows");
    expect(rendered).toContain("Protected main");
    expect(rendered).toContain("hybrid");
    expect(rendered).toContain("main");
    expect(rendered).toContain("1 active");
    expect(rendered).toContain("1 waiting");
    expect(rendered).toContain("Ready for review");
    expect(rendered).toContain("codex/dev-nexus/123-cockpit");
    expect(rendered).not.toContain("activeProfileId");
    expect(rendered).not.toContain("{");
  });

  it("renders a compact Git workflow empty state without raw configuration", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const rendered = hooks.renderFeatureOverview(
      {
        features: {
          activeCount: 0,
          needsAttentionCount: 0,
          records: [],
        },
        gitWorkflows: {
          activeProfileId: null,
          profileCount: 0,
          runCount: 0,
          activeRunCount: 0,
          waitingRunCount: 0,
          blockedRunCount: 0,
          terminalRunCount: 0,
          profiles: [],
          runs: [],
        },
        events: [],
        project: {
          name: "Dashboard Demo",
        },
        signals: [],
        weave: {
          nodes: [],
          lanes: [],
        },
      },
      null,
    );

    expect(rendered).toContain("Git workflows");
    expect(rendered).toContain("No profile configured");
    expect(rendered).toContain("No workflow runs recorded yet.");
    expect(rendered).not.toContain("gitWorkflows");
    expect(rendered).not.toContain("automation.gitWorkflows");
  });

  it("renders compact provider chips with provider and external-link affordances", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderActionStrip([
      {
        label: "Open issue #42",
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
        provider: "github",
        kind: "issue",
        title: null,
      },
      {
        label: "PR #66: provider links",
        href: "https://github.com/Evref-BL/DevNexus/pull/66",
        provider: "github",
        kind: "pull-request",
        title: "provider links",
      },
    ]);

    expect(html).toContain("provider-github kind-issue");
    expect(html).toContain("provider-github kind-pull-request");
    expect(html).toContain('<span class="dn-action-label">#42</span>');
    expect(html).toContain('<span class="dn-action-label">PR #66: provider links</span>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
    expect(html).toContain("M9 2h5v5");
  });

  it("renders tracked work as compact issue cards", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const snapshot = {
      trackedWork: {
        readyCount: 1,
        importCandidateCount: 1,
        staleCount: 0,
        excludedCount: 0,
        records: [
          {
            id: "github-42",
            title: "Add cockpit issue lane",
            componentId: "dev-nexus",
            componentName: "DevNexus",
            status: "ready",
            kind: "ready",
            kindLabel: "ready",
            detail: "Ready for automation or a human to pick up.",
            provider: "github",
            trackerId: "github",
            updatedAt: "2026-05-21T10:00:00.000Z",
            actions: [
              {
                label: "#42: cockpit issue lane",
                href: "https://github.com/Evref-BL/DevNexus/issues/42",
                provider: "github",
                kind: "issue",
                title: "cockpit issue lane",
              },
            ],
          },
        ],
      },
    };
    const html = hooks.renderTrackedWork(snapshot, "tracked-work:dev-nexus:github-42");

    expect(html).toContain("Issues and Work Items");
    expect(html).toContain("1 ready item · 1 import candidate · 0 stale items");
    expect(html).toContain("Add cockpit issue lane");
    expect(html).toContain("kind-ready");
    expect(html).toContain("selected");
    expect(html).toContain('data-select-id="tracked-work:dev-nexus:github-42"');
    expect(html).toContain("provider-github kind-issue");
    expect(html).toContain("#42: cockpit issue lane");

    const detail = hooks.selectedDetail({
      ...snapshot,
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      events: [],
      weave: {
        nodes: [],
      },
    }, "tracked-work:dev-nexus:github-42");
    expect(detail.title).toBe("Add cockpit issue lane");
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
    expect(detail.chat).toMatchObject({
      targetId: "tracked-work:dev-nexus:github-42",
      title: "Continue Add cockpit issue lane",
    });
    expect(detail.chat?.prompt).toContain("Continue cockpit item: Add cockpit issue lane.");
  });

  it("surfaces related issue and PR actions from selected feature details", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      events: [],
      weave: {
        nodes: [],
      },
      features: {
        records: [
          {
            id: "feature:cockpit-graph",
            title: "Cockpit graph",
            status: "needs-review",
            statusLabel: "Needs review",
            branchStrategy: "feature branch",
            featureBranch: "codex/dev-nexus/dashboard-cockpit-kit",
            branches: ["codex/dev-nexus/dashboard-cockpit-kit"],
            reviewBranchPattern: "codex/dev-nexus/dashboard-*",
            finalPublicationTarget: "main",
            detail: "Feature needs review before publication.",
          },
        ],
      },
      threads: {
        records: [
          {
            id: "thread-graph",
            branchName: "codex/dev-nexus/dashboard-cockpit-kit",
            actions: [
              {
                label: "Open PR #263",
                href: "https://github.com/Evref-BL/DevNexus/pull/263",
                provider: "github",
                kind: "pull-request",
                title: "dashboard graph",
              },
            ],
          },
        ],
      },
      trackedWork: {
        records: [
          {
            id: "github-42",
            logicalItemId: null,
            title: "dashboard-cockpit-kit issue follow-up",
            detail: "Review the dashboard-cockpit-kit provider action.",
            webUrl: "https://github.com/Evref-BL/DevNexus/issues/42",
            actions: [
              {
                label: "Open issue #42",
                href: "https://github.com/Evref-BL/DevNexus/issues/42",
                provider: "github",
                kind: "issue",
                title: "provider action",
              },
            ],
          },
        ],
      },
    };

    const detail = hooks.selectedDetail(snapshot, "feature:cockpit-graph");

    expect(detail.title).toBe("Cockpit graph");
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/pull/263",
      }),
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
    expect(detail.chat).toMatchObject({
      targetId: "feature:cockpit-graph",
      title: "Continue Cockpit graph",
    });
  });


});
