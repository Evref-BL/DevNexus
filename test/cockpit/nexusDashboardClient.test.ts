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

describe("nexus dashboard client", () => {  it("renders graph node popovers as structured escaped commit cards", () => {
    const node = {
      getAttribute(name: string): string | null {
        if (name === "data-dn-tooltip") {
          return [
            "Classify Git workflow branch freshness",
            "Event: Source change",
            "Component: DevNexus",
            "Source: Commit 8c61c96",
            "Actor: devnexus-automation[bot]",
            "Time: 25 mai, 14:52",
            "Scopes: codex/dev-nexus/358-git-workflow-freshness, app/codex/dev-nexus/358-git-workflow-freshness",
            "Attached: Needs review, Active, 1 thread, 28 issues",
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
      event: "Source change",
      component: "DevNexus",
      source: "Commit 8c61c96",
      actor: "devnexus-automation[bot]",
      time: "25 mai, 14:52",
      scopes: [
        "codex/dev-nexus/358-git-workflow-freshness",
        "app/codex/dev-nexus/358-git-workflow-freshness",
      ],
      attached: ["Needs review", "Active", "1 thread", "28 issues"],
    });
    expect(html).toContain("Event preview");
    expect(html).toContain("Source change");
    expect(html).toContain("Commit 8c61c96");
    expect(html).toContain("Scopes");
    expect(html).toContain("Attached");
    expect(html).toContain("dn-history-popover-field");
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

  it("renders cockpit controls and styles through direct client modules", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const headerActions = hooks.renderProjectHeaderActions(
      {
        generatedAt: "2026-05-23T12:00:00.000Z",
        project: { root: "/workspace/source" },
      },
      "system",
      "dev-nexus-dogfood",
    );
    const host = {
      generatedAt: "2026-05-23T12:00:00.000Z",
      workspaces: [
        {
          id: "dev-nexus-dogfood",
          projectRoot: "/workspace",
          name: "DevNexus Dogfood",
          status: "active",
          summary: "Current workspace",
        },
      ],
      actions: [
        {
          id: "review-1",
          title: "Review queued change",
          decision: "review",
          decisionLabel: "Needs review",
          decisionDetail: "Provider action requires approval.",
          hostId: "host",
        },
      ],
      plugins: {
        configured: [
          {
            id: "github",
            name: "GitHub",
            summary: "Provider integration",
            enabled: true,
          },
        ],
        local: [],
        curated: [
          {
            id: "browser",
            name: "Browser",
            summary: "Inspect local cockpit pages",
            enabled: false,
          },
        ],
      },
    };
    const hostRendered = hooks.renderHostDashboard(host, "dark", "actions");
    const pluginRendered = hooks.renderPlugins(host.plugins);
    const threadActions = hooks.renderThreadActions({
      id: "thread-1",
      title: "Review queued change",
      decision: "review",
      decisionLabel: "Needs review",
      decisionDetail: "Provider action requires approval.",
    });

    expect(headerActions).toContain("data-theme-mode=\"system\"");
    expect(headerActions).toContain("data-theme-mode=\"light\"");
    expect(headerActions).toContain("data-theme-mode=\"dark\"");
    expect(headerActions).toContain("data-open-target");
    expect(headerActions).toContain("Finder");
    expect(headerActions).toContain("VS Code");
    expect(headerActions).toContain("Terminal");
    expect(headerActions).not.toContain("Copy brief");
    expect(hostRendered).toContain("Host cockpit");
    expect(hostRendered).toContain("Workspaces");
    expect(hostRendered).toContain("Action Queue");
    expect(hostRendered).toContain("data-workspace-id");
    expect(pluginRendered).toContain("Plugins");
    expect(pluginRendered).toContain("Curated plugin catalogue entries copy a refresh command");
    expect(threadActions).toContain("Start chat");
    expect(cockpitStyles).toContain(":root[data-dev-nexus-theme='light']");
    expect(cockpitStyles).toContain(":root[data-dev-nexus-theme='dark']");
    expect(cockpitStyles).toContain("prefers-color-scheme");
    expect(cockpitStyles).toContain(".dn-git-topbar { display: grid; grid-template-columns:");
    expect(cockpitStyles).toContain(".dn-git-board { --dn-git-graph-width: 230px;");
    expect(cockpitStyles).toContain(".dn-git-panel { container-type: inline-size;");
    expect(cockpitStyles).toContain(".dn-git-line-shadow { stroke: var(--dn-bg); stroke-width: 3.6;");
    expect(cockpitStyles).toContain(".dn-git-line { stroke-width: 2.1;");
    expect(cockpitStyles).toContain(".dn-cockpit-layout { grid-template-columns: minmax(0, 1fr) auto;");
    expect(cockpitStyles).toContain(".dn-cockpit-main { grid-column: 1; grid-row: 1;");
    expect(cockpitStyles).toContain(".dn-left-rail { position: relative; top: auto; grid-column: 1 / -1; grid-row: 2;");
    expect(cockpitStyles).toContain(".dn-ops-panel { grid-column: 2; grid-row: 1;");
    expect(cockpitStyles).toContain(".dn-left-rail { grid-column: 1; grid-row: 3;");
    expect(cockpitStyles).toContain("@container (max-width: 900px) { .dn-git-topbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
    expect(cockpitStyles).toContain("@media (max-width: 1000px) { .dn-git-topbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
    expect(cockpitStyles).toContain(".dn-git-search { grid-column: 1; min-width: 0;");
    expect(cockpitStyles).toContain("dn-history-node-hovered");
    expect(cockpitStyles).toContain("transform: scale(1.24)");
    expect(cockpitStyles).toContain("--dn-branch-11");
    expect(cockpitStyles).not.toContain("dn-git-ref");
    expect(cockpitStyles).not.toContain("tonebox");
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

    expect(rendered).toContain("dn-project-cockpit");
    expect(rendered).toContain('class="dn-cockpit-topbar"');
    expect(rendered).toContain('id="project-git-history"');
    expect(rendered).toContain('id="cockpit-ops-panel"');
    expect(rendered).toContain('data-panel-state="closed"');
    expect(rendered).toContain('data-ops-pending-count="0"');
    expect(rendered).toContain('id="cockpit-left-rail"');
    expect(rendered).not.toContain('id="selected-item"');
    expect(rendered).not.toContain('id="parallel-work-map"');
    expect(rendered).not.toContain('aria-label="Current workspace signals"');
    expect(rendered.indexOf('id="project-git-history"')).toBeLessThan(
      rendered.indexOf('id="cockpit-ops-panel"'),
    );
  });

  it("keeps pending decisions as a closed side-panel indicator", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      generatedAt: "2026-05-23T12:00:00.000Z",
      summary: "Needs decisions",
      project: {
        name: "Dashboard Demo",
        root: "/workspace/source",
      },
      signals: [],
      events: [],
      blockers: ["Provider token approval needed"],
      components: [
        {
          id: "primary",
          name: "DevNexus",
          role: "primary",
          sourceRootExists: true,
          defaultTrackerId: "github",
          git: { branch: "main", dirty: false },
        },
      ],
      weave: { nodes: [], lanes: [] },
      worktrees: { records: [] },
      features: { activeCount: 0, needsAttentionCount: 0, records: [] },
      gitWorkflows: { profiles: [], runs: [], activeRunCount: 0, waitingRunCount: 0, blockedRunCount: 0 },
      plugins: { enabledCount: 1, capabilityCount: 2, records: [] },
      trackedWork: {
        readyCount: 2,
        blockedCount: 1,
        importCandidateCount: 0,
        staleCount: 0,
        records: [],
      },
      threads: {
        totalCount: 3,
        activeCount: 3,
        needsDecisionCount: 2,
        records: [
          {
            id: "thread-1",
            title: "Review provider action",
            decision: "review",
            decisionLabel: "Needs review",
            decisionDetail: "Provider action requires approval.",
            updatedAt: "2026-05-23T11:00:00.000Z",
          },
        ],
      },
      history: {
        totalCommitCount: 0,
        repositories: [],
        incomplete: false,
        detail: null,
      },
    };

    const rendered = hooks.renderDashboard(snapshot, "dark", null, null, "dev-nexus-dogfood");

    expect(rendered).toContain('id="cockpit-ops-panel"');
    expect(rendered).toContain('data-panel-state="closed"');
    expect(rendered).toContain('data-ops-pending-count="2"');
    expect(rendered).toContain("2 pending");
    expect(rendered).toContain('id="hitl-queue"');
    expect(rendered).toContain('id="tracked-work-panel"');
    expect(rendered).toContain('id="activity-panel"');
    expect(rendered).toContain('id="blockers-panel"');
    expect(rendered).toContain("Provider token approval needed");
  });

  it("lets left rail components drive the event history project filter", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      generatedAt: "2026-05-23T12:00:00.000Z",
      summary: "Two component histories",
      project: { name: "Dashboard Demo", root: "/workspace/source" },
      signals: [],
      events: [],
      blockers: [],
      components: [
        {
          id: "primary",
          name: "DevNexus",
          role: "primary",
          sourceRootExists: true,
          defaultTrackerId: "github",
          git: { branch: "main", dirty: false },
        },
        {
          id: "secondary",
          name: "DevNexus-Pharo",
          role: "component",
          sourceRootExists: true,
          defaultTrackerId: "github",
          git: { branch: "main", dirty: false },
        },
      ],
      weave: { nodes: [], lanes: [] },
      worktrees: { records: [] },
      features: { activeCount: 0, needsAttentionCount: 0, records: [] },
      gitWorkflows: { profiles: [], runs: [], activeRunCount: 0, waitingRunCount: 0, blockedRunCount: 0 },
      plugins: { enabledCount: 0, capabilityCount: 0, records: [] },
      trackedWork: { readyCount: 0, blockedCount: 0, importCandidateCount: 0, staleCount: 0, records: [] },
      threads: { totalCount: 0, activeCount: 0, needsDecisionCount: 0, records: [] },
      history: {
        totalCommitCount: 2,
        repositories: [
          {
            componentId: "primary",
            componentName: "DevNexus",
            repositoryPath: "/workspace/source",
            head: "primary0000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: { kind: "all", branches: [] },
            branchNames: ["main"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "primary0000000000000000000000000000000000000",
                shortHash: "primary",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T12:00:00.000Z",
                subject: "Primary event",
                refs: [],
              },
            ],
          },
          {
            componentId: "secondary",
            componentName: "DevNexus-Pharo",
            repositoryPath: "/workspace/pharo",
            head: "second00000000000000000000000000000000000000",
            defaultBranch: "main",
            scope: { kind: "all", branches: [] },
            branchNames: ["main"],
            tagNames: [],
            moreAvailable: false,
            warnings: [],
            commits: [
              {
                hash: "second00000000000000000000000000000000000000",
                shortHash: "second",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:00:00.000Z",
                subject: "Secondary event",
                refs: [],
              },
            ],
          },
        ],
        incomplete: false,
        detail: null,
      },
    };

    const rendered = hooks.renderDashboard(snapshot, "dark", null, null, "dev-nexus-dogfood", "component:secondary");

    expect(rendered).toContain('data-select-id="component:secondary" data-git-history-filter="component:secondary"');
    expect(rendered).toContain('data-scroll-target="project-git-history" aria-pressed="true"');
    expect(rendered).toContain('<option value="component:secondary" selected');
    expect(rendered).toContain("Secondary event");
    expect(rendered).not.toContain("Primary event");
  });

  it("surfaces component management actions in an overlapping configuration window", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      generatedAt: "2026-05-23T12:00:00.000Z",
      summary: "Manage components",
      project: { name: "Dashboard Demo", root: "/workspace/source" },
      signals: [],
      events: [],
      blockers: [],
      components: [
        {
          id: "primary",
          name: "DevNexus",
          role: "primary",
          sourceRootExists: true,
          defaultTrackerId: "github",
          git: { branch: "main", dirty: false },
        },
      ],
      weave: { nodes: [], lanes: [] },
      worktrees: { records: [] },
      features: { activeCount: 0, needsAttentionCount: 0, records: [] },
      gitWorkflows: { profiles: [], runs: [], activeRunCount: 0, waitingRunCount: 0, blockedRunCount: 0 },
      plugins: { enabledCount: 0, capabilityCount: 0, records: [] },
      settings: {
        totalCategoryCount: 3,
        editableCategoryCount: 1,
        blockedCategoryCount: 1,
        redactedSecretCount: 1,
        categories: [
          {
            id: "components",
            label: "Components",
            summary: "Component registration is writable through typed preview and apply routes.",
            primaryScope: "project",
            mutationState: "editable",
            itemCount: 1,
            editableCount: 1,
            blockedCount: 0,
            readOnlyCount: 0,
            secretCount: 0,
            items: [],
          },
          {
            id: "auth-profiles",
            label: "Auth Profiles",
            summary: "Account references are visible as redacted profiles, not raw credentials.",
            primaryScope: "auth-profile",
            mutationState: "blocked",
            itemCount: 1,
            editableCount: 0,
            blockedCount: 1,
            readOnlyCount: 0,
            secretCount: 0,
            items: [
              {
                id: "auth-profiles.records",
                label: "Configured auth profiles",
                scope: "auth-profile",
                source: "DevNexus home config",
                effectiveValue: "1 profiles",
                sensitivity: "sensitive",
                mutationState: "blocked",
                mutationContract: "auth-profile mutation contract",
                detail: "Profile ids and capability state only.",
                blocker: "Auth profile writes need local account selection.",
              },
            ],
          },
          {
            id: "secrets",
            label: "Secrets",
            summary: "Secret values are write-only or external to the cockpit payload.",
            primaryScope: "secret-store",
            mutationState: "read-only",
            itemCount: 1,
            editableCount: 0,
            blockedCount: 0,
            readOnlyCount: 1,
            secretCount: 1,
            items: [
              {
                id: "secrets.values",
                label: "Credential material",
                scope: "secret-store",
                source: "host credential store",
                effectiveValue: "redacted",
                sensitivity: "secret",
                mutationState: "read-only",
                mutationContract: null,
                detail: "Tokens and private keys are never serialized to the browser.",
                blocker: null,
              },
            ],
          },
        ],
      },
      trackedWork: { readyCount: 0, blockedCount: 0, importCandidateCount: 0, staleCount: 0, records: [] },
      threads: { totalCount: 0, activeCount: 0, needsDecisionCount: 0, records: [] },
      history: { totalCommitCount: 0, repositories: [], incomplete: false, detail: null },
    };

    const rendered = hooks.renderDashboard(snapshot, "dark", null, null, "dev-nexus-dogfood");

    expect(rendered).toContain('data-cockpit-config-action="add-component"');
    expect(rendered).toContain('data-cockpit-config-action="edit-component"');
    expect(rendered).toContain('data-cockpit-config-action="remove-component"');
    expect(rendered).toContain('data-config-window-preview');
    expect(rendered).toContain('data-config-window-apply disabled');
    expect(rendered).toContain('Source files stay untouched.');
    expect(rendered).toContain('Preview required before apply.');
    expect(rendered).toContain('data-cockpit-config-window hidden aria-hidden="true"');
    expect(rendered).toContain('role="dialog"');
    expect(rendered).toContain('id="cockpit-config-window-title"');
    expect(rendered).toContain("Preview component configuration changes before writing the project config.");
    expect(rendered).toContain('data-config-window-preview');
    expect(rendered).toContain('data-config-window-apply disabled');
    expect(rendered).toContain('data-config-window-input-id');
    expect(rendered).toContain('data-config-window-remove-confirm');
    expect(rendered).toContain("Save changes");
    expect(rendered).toContain("Remove component");
    expect(rendered).toContain('id="settings-panel"');
    expect(rendered).toContain('data-cockpit-config-action="settings-category" data-config-category-id="auth-profiles"');
    expect(rendered).toContain('data-config-category-tab="auth-profiles"');
    expect(rendered).toContain('data-config-category-pane="auth-profiles"');
    expect(rendered).toContain("Account references are visible as redacted profiles, not raw credentials.");
    expect(rendered).toContain("Credential material");
    expect(rendered).toContain("redacted");
    expect(rendered).toContain("Auth profile writes need local account selection.");
  });

  it("keeps visible dashboard content stable during background refresh", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
      generatedAt: "2026-05-21T10:00:00.000Z",
      summary: "Ready",
      events: [
        {
          id: "snapshot-generated",
          time: "2026-05-21T10:00:00.000Z",
          title: "Snapshot refreshed",
        },
      ],
      project: {
        root: "/workspace/source",
        name: "DevNexus",
      },
    };
    const refreshed = {
      ...snapshot,
      generatedAt: "2026-05-21T10:00:15.000Z",
      events: [
        {
          id: "snapshot-generated",
          time: "2026-05-21T10:00:15.000Z",
          title: "Snapshot refreshed",
        },
      ],
    };
    const changed = {
      ...refreshed,
      summary: "Blocked",
    };

    expect(hooks.dashboardRenderSignature(snapshot)).toBe(
      hooks.dashboardRenderSignature(refreshed),
    );
    expect(hooks.dashboardRenderSignature(changed)).not.toBe(
      hooks.dashboardRenderSignature(refreshed),
    );
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


});
