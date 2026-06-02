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

describe("nexus dashboard client host surfaces", () => {  it("routes signal cards to the relevant cockpit section", async () => {
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


});
