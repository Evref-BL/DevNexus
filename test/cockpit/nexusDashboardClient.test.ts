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
import {
  gitHistoryPopoverConnectorY,
  gitHistoryPopoverPixelValue,
  gitHistoryNodePopoverContent,
  isGitHistoryPopoverColor,
  renderGitHistoryNodePopoverContent,
} from "../../src/cockpit/client/history/nexusCockpitHistoryInteractions.js";

afterEach(cleanupDashboardTestTempDirs);

describe("nexus dashboard client", () => {
  it("renders graph node popovers as structured escaped commit cards", () => {
    const node = {
      getAttribute(name: string): string | null {
        if (name === "data-dn-tooltip") {
          return [
            "Classify Git workflow branch freshness",
            "DevNexus · 8c61c96",
            "Refs: codex/dev-nexus/358-git-workflow-freshness, app/codex/dev-nexus/358-git-workflow-freshness",
            "devnexus-automation[bot] · 25 mai, 14:52",
            "Details: Needs review, Active, 1 thread, 28 issues",
          ].join("\n");
        }
        return null;
      },
    } as Element;

    const content = gitHistoryNodePopoverContent(node);
    const html = renderGitHistoryNodePopoverContent({
      ...content,
      title: `${content.title} <script>`,
    });

    expect(content).toEqual({
      title: "Classify Git workflow branch freshness",
      component: "DevNexus",
      commit: "8c61c96",
      refs: [
        "codex/dev-nexus/358-git-workflow-freshness",
        "app/codex/dev-nexus/358-git-workflow-freshness",
      ],
      meta: "devnexus-automation[bot] · 25 mai, 14:52",
      details: ["Needs review", "Active", "1 thread", "28 issues"],
    });
    expect(html).toContain("Commit 8c61c96");
    expect(html).toContain("Branches");
    expect(html).toContain("Details");
    expect(html).toContain("codex/dev-nexus/358-git-workflow-freshness");
    expect(html).toContain("Needs review");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(isGitHistoryPopoverColor("var(--dn-branch-4)")).toBe(true);
    expect(isGitHistoryPopoverColor("rgb(53, 221, 84)")).toBe(true);
    expect(isGitHistoryPopoverColor("url(javascript:alert(1))")).toBe(false);
    expect(gitHistoryPopoverConnectorY(500, 400, 180)).toBe(100);
    expect(gitHistoryPopoverConnectorY(500, 492, 180)).toBe(12);
    expect(gitHistoryPopoverConnectorY(500, 300, 180)).toBe(168);
    expect(gitHistoryPopoverConnectorY(500, 402, 176)).toBe(98);
    expect(gitHistoryPopoverPixelValue("2px")).toBe(2);
    expect(gitHistoryPopoverPixelValue("")).toBe(0);
  });

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
    expect(module).toContain("data-git-history-search");
    expect(module).toContain("applyGitHistorySearch");
    expect(module).toContain("dn-history-popover");
    expect(module).toContain("--dn-history-popover-accent");
    expect(module).toContain("--dn-history-popover-border-width");
    expect(module).toContain("--dn-history-popover-radius");
    expect(module).toContain("border-top-left-radius: calc(var(--dn-history-popover-radius) - var(--dn-history-popover-border-width))");
    expect(module).toContain("data-edge-side='left'");
    expect(module).toContain("height: var(--dn-history-popover-border-width)");
    expect(module).toContain("gitHistoryNodeAccentColor");
    expect(module).toContain("showGitHistoryNodePopover");
    expect(module).toContain("transform-box: fill-box");
    expect(module).toContain("vector-effect: non-scaling-stroke");
    expect(module).toContain("dn-history-node-hovered");
    expect(module).toContain("transform: scale(1.24)");
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
    expect(module).toContain("@media (max-width: 860px) { .dn-header { grid-template-columns: 1fr; } .dn-header-actions { justify-content: flex-end; width: 100%; } .dn-header-strip { width: 100%; } .dn-git-topbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }");
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
    expect(module).toContain("data-git-history-project-select");
    expect(module).toContain("data-git-history-branch-select");
    expect(module).toContain("data-git-history-fetch-remotes");
    expect(module).toContain("cloudFetchIcon");
    expect(module).toContain("gearIcon");
    expect(module).toContain(".dn-git-topbar { display: grid; grid-template-columns: minmax(160px, 0.32fr) minmax(220px, 0.48fr) minmax(260px, 1fr) auto;");
    expect(module).not.toContain(".dn-git-filters { display: flex;");
    expect(module).not.toContain("All events");
    expect(module).toContain("--dn-git-row-height: 26px; --dn-git-table-min-width: calc(var(--dn-git-description-width) + var(--dn-git-date-width) + var(--dn-git-author-width) + var(--dn-git-commit-width) + 12px);");
    expect(module).toContain(".dn-git-board { --dn-git-graph-width: 230px; --dn-git-description-width: 360px; --dn-git-date-width: 124px; --dn-git-author-width: 170px; --dn-git-commit-width: 78px;");
    expect(module).toContain("grid-template-columns: minmax(96px, var(--dn-git-graph-width)) minmax(0, 1fr); gap: 0; width: 100%; overflow: auto;");
    expect(module).toContain(".dn-git-graph-column { position: relative; display: grid; grid-template-rows: 30px auto; grid-template-columns: minmax(0, 1fr); min-width: 0; overflow: hidden; border-right: 0;");
    expect(module).toContain(".dn-git-graph-detail-edge { position: absolute; right: 0; z-index: 1; width: 1px; background: var(--dn-border-muted); pointer-events: none; }");
    expect(module).not.toContain(".dn-git-board[data-git-detail-open='true'] .dn-git-graph-column { border-right:");
    expect(module).toContain(".dn-git-graph-column > .dn-git-column-header { box-sizing: border-box; width: 100%; max-width: 100%;");
    expect(module).toContain(".dn-git-table { display: grid; grid-template-rows: 30px auto; min-width: var(--dn-git-table-min-width); overflow: visible; }");
    expect(module).toContain(".dn-git-column-row, .dn-git-history-row { display: grid; grid-template-columns: minmax(var(--dn-git-description-width), 1fr) var(--dn-git-date-width) var(--dn-git-author-width) var(--dn-git-commit-width);");
    expect(module).toContain("align-items: center; gap: 4px; width: 100%;");
    expect(module).toContain("width: 100%; min-width: var(--dn-git-table-min-width);");
    expect(module).toContain(".dn-git-column-header { position: relative; display: flex; align-items: center; justify-content: center;");
    expect(module).toContain(".dn-git-description { min-width: 0; overflow: hidden; color: var(--dn-strong); font-size: 0.82rem; font-weight: 460;");
    expect(module).toContain(".dn-git-history-row.merge:not(.selected) .dn-git-description");
    expect(module).toContain(".dn-git-detail-band { fill: color-mix(in srgb, var(--dn-surface-raised) 58%, var(--dn-control-active)); pointer-events: none; }");
    expect(module).toContain(".dn-git-detail-band-divider { stroke: var(--dn-border-strong); stroke-width: 1;");
    expect(module).toContain(".dn-git-history-row.selected { background: var(--dn-control-active); box-shadow: none; }");
    expect(module).toContain(".dn-git-inline-detail { height: 234px; min-width: var(--dn-git-table-min-width); margin: 0; overflow: auto; border-width: 0 0 1px;");
    expect(module).not.toContain(".dn-history-item.selected, .dn-git-history-row.selected { border-color: var(--dn-active);");
    expect(module).toContain(".dn-git-date, .dn-git-author, .dn-git-sha { min-width: 0; overflow: hidden; color: var(--dn-muted); font-size: 0.76rem; text-align: left;");
    expect(module).not.toContain(".dn-git-column-header[data-git-column='commit'] { justify-content: flex-end; }");
    expect(module).not.toContain(".dn-git-sha { color: var(--dn-label); font-weight: 850; text-align: right; }");
    expect(module).not.toContain("grid-template-columns: minmax(96px, var(--dn-git-graph-width)) max-content;");
    expect(module).not.toContain("width: max-content; min-width: 100%;");
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
    const alwaysTarget = {
      clientHeight: 20,
      clientWidth: 180,
      scrollHeight: 20,
      scrollWidth: 180,
      getAttribute: (name: string) => {
        if (name === "data-dn-tooltip") return "Event node context";
        if (name === "data-dn-tooltip-mode") return "always";
        return null;
      },
    };

    expect(hooks.cockpitTooltipText(truncatedTarget)).toBe(
      "Merge pull request #314 from Evref-BL/codex/dev-nexus/272-gateway",
    );
    expect(hooks.isCockpitTooltipTargetTruncated(truncatedTarget)).toBe(true);
    expect(hooks.isCockpitTooltipTargetTruncated(fittingTarget)).toBe(false);
    expect(hooks.cockpitTooltipText(alwaysTarget)).toBe("Event node context");
    expect(hooks.shouldShowCockpitTooltipTarget(alwaysTarget)).toBe(true);
    expect(hooks.shouldShowCockpitTooltipTarget(fittingTarget)).toBe(false);
  });

  it("keeps the event history board before generic selected details", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      generatedAt: "2026-05-24T12:00:00.000Z",
      summary: "Dashboard demo summary.",
      project: {
        name: "Dashboard Demo",
        root: "/workspace",
      },
      signals: [],
      components: [],
      events: [],
      blockers: [],
      features: {
        records: [],
      },
      threads: {
        records: [],
      },
      trackedWork: {
        records: [],
      },
      plugins: {
        enabled: [],
        available: [],
        disabled: [],
      },
      worktrees: {
        records: [],
      },
      weave: {
        lanes: [
          {
            id: "project",
            label: "Project",
          },
        ],
        nodes: [
          {
            id: "project",
            kind: "project",
            laneId: "project",
            label: "Dashboard Demo",
            status: "active",
          },
        ],
        edges: [],
      },
      history: {
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "core100000000000000000000000000000000000000",
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
                hash: "core100000000000000000000000000000000000000",
                shortHash: "core100",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Update core cockpit",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
    };

    const rendered = hooks.renderDashboard(snapshot, "dark", null, null, "dev-nexus-dogfood");

    expect(rendered.indexOf('id="project-git-history"')).toBeLessThan(
      rendered.indexOf('id="selected-item"'),
    );
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
