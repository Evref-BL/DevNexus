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
  renderNexusDashboardClientModule,
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

describe("nexus dashboard client", () => {
  it("renders a client module with explicit light and dark mode controls", () => {
    const module = renderNexusDashboardClientModule();

    expect(module).toContain("dev-nexus-cockpit-theme");
    expect(module).toContain("data-dev-nexus-theme");
    expect(module).toContain("data-theme-mode=\"system\"");
    expect(module).toContain("data-theme-mode=\"light\"");
    expect(module).toContain("data-theme-mode=\"dark\"");
    expect(module).toContain(":root[data-dev-nexus-theme='light']");
    expect(module).toContain(":root[data-dev-nexus-theme='dark']");
    expect(module).toContain("color-scheme");
    expect(module).toContain("prefers-color-scheme");
    expect(module).toContain("data-select-id");
    expect(module).toContain("Activity Lanes");
    expect(module).toContain("Host cockpit");
    expect(module).toContain("Workspaces");
    expect(module).toContain("Action Needed");
    expect(module).toContain("HITL queue");
    expect(module).toContain("Plugins");
    expect(module).toContain("renderThreadInbox");
    expect(module).toContain("renderHostOverview");
    expect(module).toContain("renderWorkspaceCard");
    expect(module).toContain("renderHostDashboard");
    expect(module).toContain("renderHostActionQueue");
    expect(module).toContain("Host Cockpit");
    expect(module).toContain("Host HITL");
    expect(module).toContain("Action Queue");
    expect(module).toContain("renderLoading");
    expect(module).toContain("dn-loading-panel");
    expect(module).toContain("dn-loader");
    expect(module).toContain("dn-skeleton");
    expect(module).toMatch(/if \(!workspaceId\) \{\s+if \(!latestHost\) \{/u);
    expect(module).toContain("@keyframes dn-spin");
    expect(module).toContain("@keyframes dn-shimmer");
    expect(module).toContain("Loading host cockpit");
    expect(module).toContain("Switching workspace");
    expect(module).toContain("hostRefreshMs");
    expect(module).toContain("hostInFlight");
    expect(module).toContain("workspaceQuery");
    expect(module).toContain("?workspace=");
    expect(module).toContain("selectedWorkspaceId");
    expect(module).toContain("readWorkspaceIdFromLocation");
    expect(module).toContain("writeWorkspaceIdToLocation");
    expect(module).toContain("bindWorkspaceControls");
    expect(module).toContain("bindHostSignalControls");
    expect(module).toContain("data-host-focus");
    expect(module).toContain("data-scroll-target");
    expect(module).toContain("scrollToDashboardSection");
    expect(module).toContain("signalPanelTarget");
    expect(module).toContain("filteredHostActions");
    expect(module).toContain("filteredHostWorkspaces");
    expect(module).toContain("host-action-queue");
    expect(module).toContain("dn-host-action-shell");
    expect(module).toContain("host-workspaces");
    expect(module).not.toContain("dn-host-sticky-panel");
    expect(module).toContain("data-workspace-id");
    expect(module).toContain("data-workspace-selection-id");
    expect(module).toContain("targetSelectionId");
    expect(module).toContain("renderCurrent();");
    expect(module).toContain("renderThreadActions");
    expect(module).toContain("threadSelectId");
    expect(module).toContain("threadDetail");
    expect(module).toContain("id=\"hitl-queue\"");
    expect(module).toContain("renderThreadPolicyAction");
    expect(module).toContain("renderPlugins");
    expect(module).toContain("pluginPills");
    expect(module).toContain("renderPluginPolicyAction");
    expect(module).toContain("renderDisabledAction");
    expect(module).toContain("dn-policy-action");
    expect(module).toContain("data-thread-action");
    expect(module).toContain("/api/cockpit/thread-action");
    expect(module).toContain("Needs plugin enable policy");
    expect(module).toContain("Curated plugin catalogue entries copy a refresh command");
    expect(module).toContain("data-copy-text");
    expect(module).toContain("bindLocalActions");
    expect(module).toContain("data-copy-prompt");
    expect(module).toContain("Copy prompt");
    expect(module).toContain("renderOpenMenu");
    expect(module).toContain("chevronDownIcon");
    expect(module).toContain("dn-open-chevron");
    expect(module).toContain("dn-open-chevron-shell");
    expect(module).toContain("min-width: 94px");
    expect(module).toContain(".dn-open-menu[open] .dn-open-chevron");
    expect(module).toContain("/api/local/open");
    expect(module).toContain("data-open-target");
    expect(module).toContain("data-open-app");
    expect(module).toContain("/api/local/app-icon?app=");
    expect(module).toContain("dn-app-icon-img");
    expect(module).toContain(".dn-header-path-menu { flex: 0 1 auto; width: fit-content; min-width: min(100%, 320px); max-width: min(100%, 520px); }");
    expect(module).toContain("@media (max-width: 860px) { .dn-header { grid-template-columns: 1fr; } .dn-header-actions { justify-content: flex-end; width: 100%; } .dn-header-strip { width: 100%; } }");
    expect(module).toContain("@media (max-width: 560px) { .dn-header-actions { justify-content: stretch; } .dn-header-strip { justify-content: stretch; } .dn-header-path-menu { width: 100%; max-width: 100%; } }");
    expect(module).not.toContain(".dn-header-strip, .dn-header-path-menu { width: 100%; }");
    expect(module).toContain("Finder");
    expect(module).toContain("VS Code");
    expect(module).toContain("Terminal");
    expect(module).not.toContain("<span aria-hidden=\"true\">v</span>");
    expect(module).not.toContain("min-width: 116px");
    expect(module).not.toContain("Copy brief");
    expect(module).toContain("Start chat");
    expect(module).toContain("Resume chat");
    expect(module).toContain("data-start-chat-prompt");
    expect(module).toContain("data-chat-target-id");
    expect(module).toContain("/api/codex/thread");
    expect(module).toContain("/api/codex/thread${workspaceQuery(workspaceId)}");
    expect(module).toContain("/api/host");
    expect(module).toContain("x-dev-nexus-action-token");
    expect(module).toContain("renderChatActionStrip");
    expect(module).toContain("detailPrompt");
    expect(module).toContain("sentenceLine");
    expect(module).toContain("stripTerminalPunctuation");
    expect(module).not.toContain("Copy Codex brief");
    expect(module).not.toContain("Start Codex chat");
    expect(module).not.toContain("data-start-codex-prompt");
    expect(module).toContain("Workspace map");
    expect(module).toContain("dn-work-stack");
    expect(module).toContain("dn-plugin-row");
    expect(module).toContain("dn-workspace-card");
    expect(module).toContain("Extensions");
    expect(module).not.toContain("Capability layer");
    expect(module).not.toContain("dn-side-stack");
    expect(module).toContain("Approval");
    expect(module).not.toContain("Human approval");
    expect(module).toContain("selectedDetail");
    expect(module).toContain("renderSelectedItem");
    expect(module).toContain("dn-selected-panel");
    expect(module).toContain("id=\"selected-item\"");
    expect(module).toContain("id=\"tracked-work-panel\"");
    expect(module).toContain("id=\"plugins-panel\"");
    expect(module).toContain("id=\"components-panel\"");
    expect(module).toContain("id=\"blockers-panel\"");
    expect(module).toContain("Selected item");
    expect(module).toContain("Summary");
    expect(module).toContain("Actions");
    expect(module).toContain("Evidence");
    expect(module).toContain("Diagnostics");
    expect(module).not.toContain("dn-inspector");
    expect(module).toContain("timelineLanes");
    expect(module).toContain("renderBranchGraph");
    expect(module).toContain("dn-branch-svg");
    expect(module).toContain("const rowHeight = 34");
    expect(module).toContain("data-row-height");
    expect(module).toContain("--dn-project-accent");
    expect(module).toContain("projectAccentStyle");
    expect(module).toContain("projectAccentCount = 7");
    expect(module).toContain("workspaceAccentMap");
    expect(module).toContain("--dn-branch-6");
    expect(module).toContain("stableAccentIndex");
    expect(module).not.toContain("--dn-warn: #9a641c");
    expect(module).toContain("providerIcon");
    expect(module).toContain("externalLinkIcon");
    expect(module).toContain("clipboardIcon");
    expect(module).toContain("signal-components");
    expect(module).toContain("Not Git history");
    expect(module).toContain("Each rail is a workspace category");
    expect(module).toContain("Source checkout");
    expect(module).toContain("Active branch");
    expect(module).toContain("More branches");
    expect(module).toContain("Automation");
    expect(module).toContain("Decisions");
    expect(module).toContain("rowGuides");
    expect(module).not.toContain("tonebox");
    expect(module).not.toContain("renderRailLabels");
    expect(module).toContain("threadDetail");
    expect(module).toContain("left: calc(-115px + (var(--dn-lane) * 18px))");
    expect(module).toContain("-webkit-line-clamp: 3");
    expect(module).toContain("dn-action-strip");
    expect(module).toContain("target=\"_blank\"");
    expect(module).toContain("formatDisplayText");
    expect(module).toContain("signalIcon");
    expect(module.indexOf("await sectionRefresh;")).toBeGreaterThan(
      module.indexOf("sectionRefresh = refreshWorkspaceSections"),
    );
    expect(module.indexOf("const snapshot = await fetchDevNexusDashboard")).toBeGreaterThan(
      module.indexOf("await sectionRefresh;"),
    );
  });

  it("shows cockpit tooltip copy only for clipped title-backed text", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const truncatedTarget = {
      clientHeight: 20,
      clientWidth: 120,
      scrollHeight: 20,
      scrollWidth: 180,
      getAttribute: (name: string) => (name === "title" ? "Merge pull request #314 from Evref-BL/codex/dev-nexus/272-gateway" : null),
    };
    const fittingTarget = {
      clientHeight: 20,
      clientWidth: 180,
      scrollHeight: 20,
      scrollWidth: 180,
      getAttribute: (name: string) => (name === "title" ? "Short label" : null),
    };

    expect(hooks.cockpitTooltipText(truncatedTarget)).toBe(
      "Merge pull request #314 from Evref-BL/codex/dev-nexus/272-gateway",
    );
    expect(hooks.isCockpitTooltipTargetTruncated(truncatedTarget)).toBe(true);
    expect(hooks.isCockpitTooltipTargetTruncated(fittingTarget)).toBe(false);
  });

  it("keeps visible dashboard content stable during background refresh", () => {
    const module = renderNexusDashboardClientModule();

    expect(module).toContain("lastRenderSignature");
    expect(module).toContain("dashboardRenderSignature");
    expect(module).toContain("stripVolatileDashboardFields");
    expect(module).toContain("if (signature && signature === lastRenderSignature) return;");
    expect(module).toContain("const hasVisibleData = selectedWorkspaceId ? Boolean(latestSnapshot) : Boolean(latestHost);");
    expect(module).toContain("if (!hasVisibleData) {");
    expect(module).toContain("latestSnapshot = null;");
    expect(module).not.toContain("catch (error) {\n      latestSnapshot = null;");
    expect(module).not.toContain("catch {\n      latestHost = null;");
  });

  it("ignores refresh-clock activity timestamps in dashboard render signatures", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const firstSnapshot = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      events: [
        {
          id: "snapshot-generated",
          time: "2026-05-21T10:00:00.000Z",
          title: "Snapshot refreshed",
        },
        {
          id: "automation-status",
          time: "2026-05-21T10:00:00.000Z",
          title: "Automation blocked",
        },
        {
          id: "worktree-lease-1",
          time: "2026-05-21T09:45:00.000Z",
          title: "Worktree working",
        },
      ],
    };
    const secondSnapshot = {
      ...firstSnapshot,
      generatedAt: "2026-05-21T10:00:15.000Z",
      events: [
        {
          id: "snapshot-generated",
          time: "2026-05-21T10:00:15.000Z",
          title: "Snapshot refreshed",
        },
        {
          id: "automation-status",
          time: "2026-05-21T10:00:15.000Z",
          title: "Automation blocked",
        },
        {
          id: "worktree-lease-1",
          time: "2026-05-21T09:45:00.000Z",
          title: "Worktree working",
        },
      ],
    };
    const actualWorkChange = {
      ...secondSnapshot,
      events: [
        ...secondSnapshot.events.slice(0, 2),
        {
          id: "worktree-lease-1",
          time: "2026-05-21T10:00:10.000Z",
          title: "Worktree working",
        },
      ],
    };

    expect(hooks.dashboardRenderSignature(firstSnapshot)).toBe(
      hooks.dashboardRenderSignature(secondSnapshot),
    );
    expect(hooks.dashboardRenderSignature(secondSnapshot)).not.toBe(
      hooks.dashboardRenderSignature(actualWorkChange),
    );
  });

  it("audits static visual guardrails for light and dark cockpit modes", () => {
    const audit = auditNexusDashboardClientVisuals();

    expect(audit.ok).toBe(true);
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "theme-modes", status: "passed" }),
        expect.objectContaining({ id: "signal-accents", status: "passed" }),
        expect.objectContaining({ id: "branch-accents", status: "passed" }),
        expect.objectContaining({ id: "host-smart-cards", status: "passed" }),
        expect.objectContaining({ id: "text-fitting", status: "passed" }),
        expect.objectContaining({ id: "neutral-surfaces", status: "passed" }),
        expect.objectContaining({ id: "lane-labels", status: "passed" }),
        expect.objectContaining({ id: "selected-details", status: "passed" }),
        expect.objectContaining({ id: "action-buttons", status: "passed" }),
        expect.objectContaining({ id: "plugin-cards", status: "passed" }),
        expect.objectContaining({ id: "tracked-work", status: "passed" }),
        expect.objectContaining({ id: "responsive-layout", status: "passed" }),
      ]),
    );
    expect(audit.limitations).toEqual(
      expect.arrayContaining([
        "Pixel screenshots still require a browser renderer and human review.",
      ]),
    );
  });

  it("labels parallel work-map lanes without repeating branch names as row titles", async () => {
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

  it("renders project git history as a graph with selectable commits", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        totalCommitCount: 3,
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/cockpit-graph"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main10000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature graph",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "merge000000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["main00000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Add graph data",
                refs: [
                  {
                    name: "feat/cockpit-graph",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main10000000000000000000000000000000000000",
                shortHash: "main100",
                parents: ["main00000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Prepare base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
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

    const rows = hooks.gitHistoryRows(snapshot);
    const rendered = hooks.renderGitHistory(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    );
    const detail = hooks.selectedDetail(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    );

    expect(rows?.rows).toHaveLength(3);
    expect(rows?.paths.some((path) => path.fromLane !== path.toLane)).toBe(true);
    expect(rendered).toContain("Project Writes");
    expect(rendered).toContain("Selected write event");
    expect(rendered).toContain("data-history-detail-for=\"history:primary:feature000000000000000000000000000000000000\"");
    const selectedRowIndex = rendered.indexOf(
      "dn-git-history-row selected\" type=\"button\" data-select-id=\"history:primary:feature000000000000000000000000000000000000\"",
    );
    const inlineDetailIndex = rendered.indexOf(
      "dn-git-detail-panel dn-git-inline-detail",
    );
    const nextRowIndex = rendered.indexOf(
      "data-select-id=\"history:primary:main10000000000000000000000000000000000000\"",
    );
    expect(selectedRowIndex).toBeGreaterThan(-1);
    expect(inlineDetailIndex).toBeGreaterThan(selectedRowIndex);
    expect(inlineDetailIndex).toBeLessThan(nextRowIndex);
    expect(rendered.slice(selectedRowIndex, inlineDetailIndex)).not.toContain(
      'data-scroll-target="selected-item"',
    );
    expect(rendered).toContain('data-history-row-count="10"');
    expect(rendered).toContain("data-git-board");
    expect(rendered).toContain("data-git-column=\"graph\"");
    expect(rendered).toContain("data-git-column=\"description\"");
    expect(rendered).toContain("data-git-column=\"date\"");
    expect(rendered).toContain("data-git-column=\"author\"");
    expect(rendered).toContain("data-git-column=\"commit\"");
    expect(rendered).toContain("data-git-resize-column=\"graph\"");
    expect(rendered).toContain("data-git-resize-column=\"description\"");
    expect(rendered).toContain("data-git-resize-column=\"date\"");
    expect(rendered).toContain("data-git-resize-column=\"author\"");
    expect(rendered).toContain("data-git-resize-column=\"commit\"");
    expect(rendered).toContain("<span class=\"dn-git-date\"");
    expect(rendered).toContain("<span class=\"dn-git-author\"");
    expect(rendered).toContain("Codex</span>");
    expect(rendered).toContain("<span class=\"dn-git-sha\"");
    expect(rendered).toContain(">feature</span>");
    expect(rendered).toContain("<svg");
    expect(rendered).toContain("feat/cockpit-graph");
    expect(rendered).toContain("Add graph data");
    expect(rendered).toContain("data-select-id=\"history:primary:feature000000000000000000000000000000000000\"");
    expect(detail).toMatchObject({
      title: "Add graph data",
      facts: expect.arrayContaining([
        ["Type", "write event"],
        ["Component", "DevNexus"],
        ["Commit", "feature"],
        ["Parents", "1"],
      ]),
    });
  });

  it("routes cross-lane git graph links through row corridors", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/corridor"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main20000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature branch",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "merge000000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main20000000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main10000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Main corridor step",
                refs: [],
              },
              {
                hash: "main10000000000000000000000000000000000000",
                shortHash: "main100",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:56:00.000Z",
                subject: "Main base step",
                refs: [],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Feature branch step",
                refs: [
                  {
                    name: "feat/corridor",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "base0000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderGitHistory(snapshot);
    const graph = hooks.gitHistoryRows(snapshot);
    const delayedCrossLanePaths = graph?.paths.filter(
      (path) => {
        if (path.fromLane === path.toLane) return false;
        const points = path.points ?? [];
        const firstCrossLanePoint = points.find((point) => point.lane !== path.fromLane);
        return firstCrossLanePoint
          ? Math.abs(firstCrossLanePoint.index - (path.fromIndex ?? 0)) > 1.5
          : false;
      },
    );

    expect(rendered).toContain("dn-git-line-shadow");
    expect(rendered).toContain("V 28.5");
    expect(rendered).toContain("V 105");
    expect(rendered).not.toContain("H 50 V 105");
    expect(rendered).not.toMatch(/M 28 15 C .*50 .*105/);
    expect(delayedCrossLanePaths).toEqual([]);
  });

  it("anchors fractional git graph connector endpoints on routed lanes", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/corridor"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main20000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature branch",
                refs: [],
              },
              {
                hash: "main20000000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main10000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Main corridor step",
                refs: [],
              },
              {
                hash: "main10000000000000000000000000000000000000",
                shortHash: "main100",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:56:00.000Z",
                subject: "Main base step",
                refs: [],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Feature branch step",
                refs: [],
              },
              {
                hash: "base0000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Base",
                refs: [],
              },
            ],
          },
        ],
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const graph = hooks.gitHistoryRows(snapshot);
    const allPoints =
      graph?.paths.flatMap((path) => path.points ?? []) ?? [];
    const fractionalEndpoints =
      graph?.paths.flatMap((path) => {
        const points = path.points ?? [];
        const last = points.at(-1);
        return last && !Number.isInteger(last.index) ? [last] : [];
      }) ?? [];

    expect(graph?.paths.length).toBeGreaterThan(0);
    expect(fractionalEndpoints.length).toBeGreaterThan(0);
    for (const endpoint of fractionalEndpoints) {
      const matches = allPoints.filter(
        (point) => point.lane === endpoint.lane && point.index === endpoint.index,
      );
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("reuses git graph lanes for side branches with separate lifetimes", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "mergeB0000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/a", "feat/b"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "mergeB0000000000000000000000000000000000",
                shortHash: "mergeB0",
                parents: [
                  "main300000000000000000000000000000000000",
                  "sideB00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge second side branch",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "mergeB0000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "sideB00000000000000000000000000000000000",
                shortHash: "sideB00",
                parents: ["main300000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Second side branch work",
                refs: [
                  {
                    name: "feat/b",
                    kind: "branch",
                    remote: null,
                    hash: "sideB00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main300000000000000000000000000000000000",
                shortHash: "main300",
                parents: ["mergeA0000000000000000000000000000000000"],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:56:00.000Z",
                subject: "Main after first merge",
                refs: [],
              },
              {
                hash: "mergeA0000000000000000000000000000000000",
                shortHash: "mergeA0",
                parents: [
                  "main200000000000000000000000000000000000",
                  "sideA00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:54:00.000Z",
                subject: "Merge first side branch",
                refs: [],
              },
              {
                hash: "sideA00000000000000000000000000000000000",
                shortHash: "sideA00",
                parents: ["main200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:52:00.000Z",
                subject: "First side branch work",
                refs: [
                  {
                    name: "feat/a",
                    kind: "branch",
                    remote: null,
                    hash: "sideA00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main200000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main100000000000000000000000000000000000"],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Shared base",
                refs: [],
              },
              {
                hash: "main100000000000000000000000000000000000",
                shortHash: "main100",
                parents: [],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:45:00.000Z",
                subject: "Root",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);
    const sideA = rows?.rows.find((row) => row.commit.hash.startsWith("sideA"));
    const sideB = rows?.rows.find((row) => row.commit.hash.startsWith("sideB"));

    expect(sideA?.lane).toBe(1);
    expect(sideB?.lane).toBe(1);
    expect(rows?.maxLane).toBe(1);
  });

  it("compacts git graph lanes after side branches rejoin active history", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "top0000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/a", "feat/b"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "top0000000000000000000000000000000000000",
                shortHash: "top0000",
                parents: [
                  "main300000000000000000000000000000000000",
                  "sideA00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge first side branch",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "top0000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main300000000000000000000000000000000000",
                shortHash: "main300",
                parents: [
                  "main200000000000000000000000000000000000",
                  "sideB00000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:58:00.000Z",
                subject: "Merge second side branch",
                refs: [],
              },
              {
                hash: "sideA00000000000000000000000000000000000",
                shortHash: "sideA00",
                parents: ["main200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:57:00.000Z",
                subject: "First side branch work",
                refs: [
                  {
                    name: "feat/a",
                    kind: "branch",
                    remote: null,
                    hash: "sideA00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "sideB00000000000000000000000000000000000",
                shortHash: "sideB00",
                parents: ["main200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Second side branch work",
                refs: [
                  {
                    name: "feat/b",
                    kind: "branch",
                    remote: null,
                    hash: "sideB00000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "main200000000000000000000000000000000000",
                shortHash: "main200",
                parents: ["main100000000000000000000000000000000000"],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Shared base",
                refs: [],
              },
              {
                hash: "main100000000000000000000000000000000000",
                shortHash: "main100",
                parents: [],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T11:45:00.000Z",
                subject: "Root",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);
    const sideB = rows?.rows.find((row) => row.commit.hash.startsWith("sideB"));

    expect(sideB?.lane).toBe(1);
    expect(Math.max(...(rows?.rows.map((row) => row.lane) ?? []))).toBe(1);
    expect(rows?.maxLane).toBe(2);
    expect(rows?.paths.some((path) => path.points?.some((point) => point.lane > 2))).toBe(false);
  });

  it("keeps every loaded git history row visible in the graph", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const commits = Array.from({ length: 82 }, (_, index) => {
      const hash = `commit${String(index).padStart(34, "0")}`;
      const parent =
        index + 1 < 82 ? `commit${String(index + 1).padStart(34, "0")}` : null;
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parent ? [parent] : [],
        authorName: "Codex",
        authorEmail: "codex@example.com",
        committedAt: "2026-05-23T12:00:00.000Z",
        subject: `Commit ${index}`,
        refs:
          index === 0
            ? [
                {
                  name: "main",
                  kind: "branch",
                  remote: null,
                  hash,
                },
              ]
            : [],
      };
    });
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: commits[0].hash,
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main"],
            tagNames: [],
            moreAvailable: true,
            warnings: [],
            commits,
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot);

    expect(rows?.rows).toHaveLength(82);
  });

  it("renders git graph svg at the same height as its commit rows", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "head000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "head000000000000000000000000000000000000",
                shortHash: "head000",
                parents: ["step200000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Head",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "head000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "step200000000000000000000000000000000000",
                shortHash: "step200",
                parents: ["step100000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Step 2",
                refs: [],
              },
              {
                hash: "step100000000000000000000000000000000000",
                shortHash: "step100",
                parents: ["base000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Step 1",
                refs: [],
              },
              {
                hash: "base000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:45:00.000Z",
                subject: "Base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderGitHistory(snapshot);

    expect(rendered).toContain('width="148"');
    expect(rendered).toContain('height="120"');
    expect(rendered).toContain('viewBox="0 0 148 120"');
    expect(rendered).toContain('data-history-row-count="4"');
    expect(rendered).toContain('data-history-lane-count="1"');
    expect(rendered).toContain('data-history-event-class="write"');
    expect(rendered).toContain(
      'data-history-write-event-id="history:primary:head000000000000000000000000000000000000"',
    );
  });

  it("filters project git history by branch head ancestors", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      features: {
        records: [
          {
            id: "feature:primary:feat-cockpit-graph",
            title: "Cockpit graph",
            featureBranch: "feat/cockpit-graph",
          },
        ],
      },
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "merge000000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/cockpit-graph", "feat/other-work"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "merge000000000000000000000000000000000000000",
                shortHash: "merge00",
                parents: [
                  "main10000000000000000000000000000000000000",
                  "feature000000000000000000000000000000000000",
                ],
                authorName: "Gabriel",
                authorEmail: "gabriel@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Merge feature graph",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "merge000000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Add graph data",
                refs: [
                  {
                    name: "feat/cockpit-graph",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "other0000000000000000000000000000000000000",
                shortHash: "other00",
                parents: ["base0000000000000000000000000000000000000"],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:53:00.000Z",
                subject: "Other feature work",
                refs: [
                  {
                    name: "feat/other-work",
                    kind: "branch",
                    remote: null,
                    hash: "other0000000000000000000000000000000000000",
                  },
                ],
              },
              {
                hash: "base0000000000000000000000000000000000000",
                shortHash: "base000",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:50:00.000Z",
                subject: "Prepare base",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rows = hooks.gitHistoryRows(snapshot, "branch:feat/cockpit-graph");
    const rendered = hooks.renderGitHistory(snapshot, null, "branch:feat/cockpit-graph");

    expect(rows?.rows.map((row) => row.commit.hash)).toEqual([
      "feature000000000000000000000000000000000000",
      "base0000000000000000000000000000000000000",
    ]);
    expect(rendered).toContain("data-git-history-filter=\"branch:feat/cockpit-graph\"");
    expect(rendered).toContain("aria-pressed=\"true\"");
    expect(rendered).toContain("Add graph data");
    expect(rendered).toContain("Prepare base");
    expect(rendered).not.toContain("Merge feature graph");
    expect(rendered).not.toContain("Other feature work");
  });

  it("annotates git history with feature status and provider actions", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const action = {
      label: "Open issue #42",
      href: "https://github.com/Evref-BL/DevNexus/issues/42",
      provider: "github",
      kind: "issue",
      title: "Review cockpit graph",
    };
    const snapshot = {
      features: {
        records: [
          {
            id: "feature:primary:feat-cockpit-graph",
            title: "Cockpit graph",
            status: "needs-review",
            statusLabel: "Needs review",
            featureBranch: "feat/cockpit-graph",
            branches: ["feat/cockpit-graph"],
          },
        ],
      },
      threads: {
        records: [
          {
            id: "thread-1",
            title: "Review graph UX",
            componentId: "primary",
            workItemId: "github-42",
            branchName: "feat/cockpit-graph",
            hostId: "Mac.lan",
            decision: "review",
            decisionLabel: "Review",
            decisionDetail: "Human review is needed.",
            updatedAt: "2026-05-23T12:00:00.000Z",
            actions: [action],
          },
        ],
      },
      trackedWork: {
        records: [],
      },
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "feature000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: {
              kind: "all",
              branches: [],
            },
            branchNames: ["main", "feat/cockpit-graph"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "feature000000000000000000000000000000000000",
                shortHash: "feature",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Add graph annotations",
                refs: [
                  {
                    name: "feat/cockpit-graph",
                    kind: "branch",
                    remote: null,
                    hash: "feature000000000000000000000000000000000000",
                  },
                ],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
      weave: {
        nodes: [],
        lanes: [],
      },
    };

    const rendered = hooks.renderGitHistory(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    );
    const detail = hooks.selectedDetail(
      snapshot,
      "history:primary:feature000000000000000000000000000000000000",
    ) as {
      actions: Array<{ href: string }>;
      facts: Array<[string, string]>;
    };

    expect(rendered).toContain("Needs review");
    expect(rendered).toContain("1 thread");
    expect(rendered).toContain("Attached details");
    expect(rendered).toContain("Open issue #42");
    expect(detail.facts).toEqual(
      expect.arrayContaining([
        ["Feature", "Cockpit graph"],
        ["Threads", "1"],
      ]),
    );
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
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

  it("routes signal cards to the relevant cockpit section", async () => {
    const hooks = await loadDashboardClientTestHooks();

    expect(hooks.signalPanelTarget("components")).toBe("components-panel");
    expect(hooks.signalPanelTarget("eligible-work")).toBe("tracked-work-panel");
    expect(hooks.signalPanelTarget("worktrees")).toBe("hitl-queue");
    expect(hooks.signalPanelTarget("blockers")).toBe("blockers-panel");
    expect(hooks.signalPanelTarget("plugins")).toBe("plugins-panel");

    const html = hooks.renderSignal({
      id: "eligible-work",
      label: "Tracked work",
      value: "2",
      detail: "Ready issues",
    }, "signal:eligible-work");

    expect(html).toContain('data-select-id="signal:eligible-work"');
    expect(html).toContain('data-scroll-target="tracked-work-panel"');
    expect(html).toContain("selected");
  });

  it("uses singular nouns for one-count cockpit labels", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const hostHtml = hooks.renderHostOverview({
      partial: false,
      workspaceCount: 1,
      needsAttentionCount: 1,
      workspaces: [
        {
          id: "workspace-one",
          name: "Workspace One",
          root: "/tmp/workspace-one",
          registered: true,
          current: false,
          loading: false,
          tone: "active",
          summary: "Workspace has one plugin.",
          componentCount: 1,
          needsDecisionCount: 1,
          threadCount: 1,
          pluginCount: 1,
          blockerCount: 0,
          automationStatus: "idle",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
      ],
    }, null, "", { hostMode: false });

    expect(hostHtml).toContain("1 needs attention · 1 workspace");
    expect(hostHtml).toContain("1 component");
    expect(hostHtml).toContain("1 active HITL");
    expect(hostHtml).toContain("1 active thread");
    expect(hostHtml).toContain("1 plugin");
    expect(hostHtml).not.toContain("1 components");
    expect(hostHtml).not.toContain("1 active threads");
    expect(hostHtml).not.toContain("1 plugins");

    const pluginHtml = hooks.renderPlugins({
      enabledCount: 1,
      availableCount: 1,
      capabilityCount: 1,
      records: [],
    });

    expect(pluginHtml).toContain("1 enabled plugin · 1 available plugin · 1 capability");
    expect(pluginHtml).not.toContain("1 enabled plugins");
    expect(pluginHtml).not.toContain("1 available plugins");
    expect(pluginHtml).not.toContain("1 capabilities");
  });

  it("does not badge registered workspace cards and highlights the current workspace", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const hostHtml = hooks.renderHostOverview({
      partial: false,
      workspaceCount: 2,
      needsAttentionCount: 0,
      workspaces: [
        {
          id: "registered-workspace",
          name: "Registered Workspace",
          root: "/tmp/registered-workspace",
          registered: true,
          current: false,
          loading: false,
          tone: "good",
          summary: "Registered workspace is clear.",
          componentCount: 2,
          needsDecisionCount: 0,
          threadCount: 0,
          pluginCount: 1,
          blockerCount: 0,
          automationStatus: "idle",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
        {
          id: "current-workspace",
          name: "Current Workspace",
          root: "/tmp/current-workspace",
          registered: true,
          current: true,
          loading: false,
          tone: "active",
          summary: "Current workspace is selected.",
          componentCount: 1,
          needsDecisionCount: 1,
          threadCount: 1,
          pluginCount: 1,
          blockerCount: 0,
          automationStatus: "idle",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
      ],
    }, null, "current-workspace", { hostMode: false });

    expect(hostHtml).not.toContain(">registered<");
    expect(hostHtml).toContain("dn-workspace-card current-workspace");
    expect(hostHtml).toContain("dn-workspace-current-badge");
    expect(hostHtml).toContain(">current<");
    expect(hostHtml).not.toContain("decision-rescue\">registered");
    expect(hostHtml).not.toContain("decision-continue\">registered");
  });

  it("renders a compact host header with colocated path actions and host identity", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderHostDashboard({
      version: 1,
      generatedAt: "2026-05-23T08:15:00.000Z",
      hostId: "Mac.lan",
      homePath: "/Users/gabriel.darbord/.dev-nexus",
      workspaceCount: 1,
      needsAttentionCount: 0,
      partial: false,
      actionQueue: [],
      workspaces: [],
    }, "dark");

    expect(html).toContain("dn-host-identity");
    expect(html).toContain("Mac.lan");
    expect(html).toContain("dn-header-path-menu");
    expect(html).toContain("dn-header-path-control");
    expect(html).toContain("dn-header-path-value");
    expect(html).toContain("dn-app-icon-img");
    expect(html).toContain("dn-app-icon-finder");
    expect(html).toContain("/api/local/app-icon?app=file");
    expect(html).toContain("/Users/gabriel.darbord/.dev-nexus");
    expect(html).toContain('data-open-target="home"');
    expect(html).toContain("dn-header-stamp");
    expect(html).toContain("Generated");
    expect(html).not.toContain('class="dn-meta"');
    expect(html).not.toContain("dn-header-path-row");
    expect(html.indexOf("dn-header-path-value")).toBeLessThan(
      html.indexOf("data-open-target=\"home\""),
    );
  });

  it("renders workspace headers with the compact project path controls", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderProjectHeaderActions({
      generatedAt: "2026-05-23T09:15:00.000Z",
      project: {
        name: "DevNexus PLexus",
        root: "/Users/gabriel.darbord/dev-nexus/dev-nexus-plexus",
      },
    }, "dark", "dev-nexus-plexus");

    expect(html).toContain("dn-project-header-actions");
    expect(html).toContain("Host cockpit");
    expect(html).toContain("dn-header-strip");
    expect(html).toContain("dn-header-stamp");
    expect(html).toContain("Generated");
    expect(html).toContain("dn-header-path-menu");
    expect(html).toContain("dn-header-path-control");
    expect(html).toContain("dn-header-path-value");
    expect(html).toContain("dn-app-icon-finder");
    expect(html).toContain("/api/local/app-icon?app=file");
    expect(html).toContain("Project");
    expect(html).toContain("/Users/gabriel.darbord/dev-nexus/dev-nexus-plexus");
    expect(html).toContain('data-open-target="project"');
    expect(html).not.toContain('class="dn-meta"');
    expect(html).not.toContain("Root</span>");
  });

  it("keeps host workspaces above the action queue like project pages", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderHostDashboard({
      version: 1,
      generatedAt: "2026-05-23T08:15:00.000Z",
      hostId: "Mac.lan",
      homePath: "/Users/gabriel.darbord/.dev-nexus",
      workspaceCount: 1,
      needsAttentionCount: 1,
      partial: false,
      actionQueue: [],
      workspaces: [
        {
          id: "dev-nexus-dogfood",
          name: "DevNexus Dogfood",
          root: "/Users/gabriel.darbord/dev-nexus/dev-nexus-dogfood",
          registered: true,
          current: true,
          loading: false,
          tone: "danger",
          summary: "Workspace needs attention.",
          componentCount: 5,
          needsDecisionCount: 1,
          threadCount: 2,
          pluginCount: 1,
          blockerCount: 1,
          automationStatus: "blocked",
          dirtyComponentCount: 0,
          eligibleWorkCount: 0,
        },
      ],
    }, "dark");

    expect(html).toContain('id="host-workspaces"');
    expect(html).toContain('aria-label="Host signals"');
    expect(html).toContain('id="host-action-queue"');
    expect(html).not.toContain("dn-host-main-grid");
    expect(html).not.toContain("dn-host-sticky-panel");
    expect(html.indexOf('id="host-workspaces"')).toBeLessThan(
      html.indexOf('aria-label="Host signals"'),
    );
    expect(html.indexOf('aria-label="Host signals"')).toBeLessThan(
      html.indexOf('id="host-action-queue"'),
    );
  });

  it("makes HITL threads selectable with the same chat actions as the queue", async () => {
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
      threads: {
        records: [
          {
            id: "thread-1",
            title: "Review dashboard thread",
            decision: "archive",
            decisionLabel: "Archive",
            decisionDetail: "Useful notes, but not active work.",
            branchName: "codex/dev-nexus/dashboard-thread",
            componentId: "dev-nexus",
            hostId: "local",
            workItemId: "github-42",
            updatedAt: "2026-05-21T10:00:00.000Z",
            assistantThreadId: "codex-thread-1",
            actions: [
              {
                label: "Open issue #42",
                href: "https://github.com/Evref-BL/DevNexus/issues/42",
                provider: "github",
                kind: "issue",
                title: "Dashboard thread",
              },
            ],
          },
        ],
        needsDecisionCount: 1,
        incomplete: false,
      },
    };

    const html = hooks.renderThreadInbox(snapshot, "thread:thread-1");
    expect(html).toContain('id="hitl-queue"');
    expect(html).toContain('data-select-id="thread:thread-1"');
    expect(html).toContain('data-scroll-target="selected-item"');
    expect(html).toContain("selected");
    expect(html).toContain("Resume chat");

    const detail = hooks.selectedDetail(snapshot, "thread:thread-1");
    expect(detail.title).toBe("Review dashboard thread");
    expect(detail.actions).toEqual([
      expect.objectContaining({
        href: "https://github.com/Evref-BL/DevNexus/issues/42",
      }),
    ]);
    expect(detail.chat).toMatchObject({
      resumeThreadId: "codex-thread-1",
      targetId: "thread:thread-1",
      title: "Continue Review dashboard thread",
    });
  });

  it("renders compact next-action labels for HITL thread decisions", async () => {
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
      threads: {
        records: [
          {
            id: "archive-thread",
            title: "Archive completed notes",
            decision: "archive",
            decisionLabel: "Archive",
            decisionDetail: "Notes were captured elsewhere.",
            updatedAt: "2026-05-21T10:00:00.000Z",
          },
          {
            id: "rescue-thread",
            title: "Rescue local branch",
            decision: "rescue",
            decisionLabel: "Rescue",
            decisionDetail: "Local changes need inspection.",
            updatedAt: "2026-05-21T09:00:00.000Z",
          },
          {
            id: "blocked-thread",
            title: "Resolve provider permission",
            decision: "blocked",
            decisionLabel: "Blocked",
            decisionDetail: "Provider approval is required.",
            updatedAt: "2026-05-21T08:00:00.000Z",
          },
        ],
        needsDecisionCount: 3,
        incomplete: false,
      },
    };

    const html = hooks.renderThreadInbox(snapshot, "thread:rescue-thread");

    expect(html).toContain("dn-thread-next");
    expect(html).toContain("Archive local record");
    expect(html).toContain("Inspect before cleanup");
    expect(html).toContain("Resolve blocker");
  });

  it("generates provider-neutral thread prompts without duplicate punctuation", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const prompt = hooks.cockpitThreadPrompt({
      title: "main.",
      decisionLabel: "Rescue",
      decisionDetail: "Local changes need inspection before this can be archived or forgotten.",
      branchName: "main",
      componentId: "dev-nexus",
      hostId: "local",
      workItemId: null,
    });

    expect(prompt).toContain("Continue cockpit thread: main.");
    expect(prompt).toContain(
      "Reason: Local changes need inspection before this can be archived or forgotten.",
    );
    expect(prompt).not.toContain("..");
    expect(prompt).not.toContain("Codex");
  });

  it("renders approved local thread cleanup actions", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderThreadActions({
      id: "thread-archive",
      title: "Archive old branch",
      decision: "archive",
      decisionLabel: "Archive",
      decisionDetail: "Done enough to archive.",
      assistantThreadId: null,
      actions: [],
    });

    expect(html).toContain("Archive");
    expect(html).toContain('data-thread-action="archive"');
    expect(html).toContain('data-thread-id="thread-archive"');
    expect(html).toContain("Start chat");
    expect(html).toContain("Copy prompt");
    expect(html).not.toContain("Needs archive policy");
  });

  it("renders plugin cards with policy-gated setup actions", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderPlugins({
      totalCount: 2,
      enabledCount: 1,
      capabilityCount: 4,
      records: [
        {
          id: "dev-nexus-typescript",
          name: "DevNexus TypeScript",
          version: "0.1.0-test",
          enabled: true,
          capabilityCount: 2,
          projectedSkillCount: 1,
          mcpServerCount: 1,
          setupActionCount: 0,
          dependencyProjectionCount: 0,
          projectedSkills: ["typescript-diagnose"],
          mcpServers: ["dev-nexus-typescript"],
          setupHints: [],
          dependencyHints: [],
        },
        {
          id: "dev-nexus-research",
          name: "DevNexus Research",
          version: null,
          enabled: false,
          capabilityCount: 2,
          projectedSkillCount: 0,
          mcpServerCount: 0,
          setupActionCount: 1,
          dependencyProjectionCount: 1,
          projectedSkills: [],
          mcpServers: [],
          setupHints: ["Prepare research corpus"],
          dependencyHints: ["node_modules -> node_modules"],
        },
      ],
    });

    expect(html).toContain("1 enabled plugin · 1 disabled plugin · 4 capabilities");
    expect(html).toContain("Skill: typescript-diagnose");
    expect(html).toContain("MCP: dev-nexus-typescript");
    expect(html).toContain("Setup: Prepare research corpus");
    expect(html).toContain("Deps: node_modules -&gt; node_modules");
    expect(html).toContain("Curated plugin catalogue entries copy a refresh command");
    expect(html).toContain("Enable unavailable");
    expect(html).toContain("Needs plugin enable policy");
    expect(html).toContain("dn-policy-action");
    expect(html).toContain("disabled");
    expect(html).not.toContain("data-install-plugin");
    expect(html).not.toContain("data-enable-plugin");
  });

  it("renders catalogue plugin entries with a copyable refresh command", async () => {
    const hooks = await loadDashboardClientTestHooks();

    const html = hooks.renderPlugins({
      totalCount: 1,
      enabledCount: 0,
      configuredCount: 0,
      availableCount: 1,
      capabilityCount: 0,
      records: [
        {
          id: "dev-nexus-research",
          name: "DevNexus Research",
          version: "0.1.0-alpha.0",
          enabled: false,
          state: "available",
          source: "catalogue",
          packageName: "@evref-bl/dev-nexus-research",
          sourcePath: null,
          refreshCommand:
            "dev-nexus workspace plugin refresh '/tmp/project' --from '@evref-bl/dev-nexus-research' --export devNexusResearchDevNexusPluginConfig",
          capabilityCount: 0,
          projectedSkillCount: 0,
          mcpServerCount: 0,
          setupActionCount: 0,
          dependencyProjectionCount: 0,
          projectedSkills: [],
          mcpServers: [],
          setupHints: [],
          dependencyHints: [],
          detail: "Research workflow support for DevNexus.",
        },
      ],
    });

    expect(html).toContain("0 enabled plugins · 1 available plugin");
    expect(html).toContain("available");
    expect(html).toContain("@evref-bl/dev-nexus-research");
    expect(html).toContain("Research workflow support for DevNexus.");
    expect(html).toContain("Copy command");
    expect(html).toContain("data-copy-text=");
    expect(html).toContain("Copied command");
    expect(html).not.toContain("Enable unavailable");
    expect(html).not.toContain("data-install-plugin");
  });

  it("extracts GitHub provider actions from bare issue references", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-provider-actions-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-21T09:00:00.000Z"),
    });
    const item = await tracker.createWorkItem({
      projectRoot,
      title:
        "Review HTTPS://GITHUB.COM/Evref-BL/DevNexus/pull/66, then #42: provider routing",
      status: "ready",
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(
      snapshot.weave.nodes.find((node) => node.id === `work-item:primary-${item.id}`),
    ).toMatchObject({
      actions: [
        expect.objectContaining({
          label: "Open PR #66",
          href: "https://github.com/Evref-BL/DevNexus/pull/66",
          provider: "github",
          kind: "pull-request",
        }),
        expect.objectContaining({
          href: "https://github.com/Evref-BL/DevNexus/issues/42",
          provider: "github",
          kind: "issue",
        }),
      ],
    });
    expect(snapshot.trackedWork).toMatchObject({
      totalCount: 1,
      readyCount: 1,
      records: [
        expect.objectContaining({
          id: item.id,
          title:
            "Review HTTPS://GITHUB.COM/Evref-BL/DevNexus/pull/66, then #42: provider routing",
          kind: "ready",
          actions: [
            expect.objectContaining({
              label: "Open PR #66",
              href: "https://github.com/Evref-BL/DevNexus/pull/66",
            }),
            expect.objectContaining({
              href: "https://github.com/Evref-BL/DevNexus/issues/42",
            }),
          ],
        }),
      ],
    });
  });
});
