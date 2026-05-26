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

describe("nexus dashboard history graph", () => {
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
    const expandedMergeGraph = rows
      ? hooks.gitHistoryVisualGraph(
          rows,
          "history:primary:merge000000000000000000000000000000000000000",
        )
      : null;
    const expandedMergeParentPath = expandedMergeGraph?.paths.find(
      (path) => path.fromLane === 0 && path.toLane === 1,
    );
    expect(expandedMergeParentPath?.points).toEqual([
      { lane: 0, index: 0 },
      { lane: 1, index: 1 },
      { lane: 1, index: 10 },
    ]);
    expect(rendered).toContain("Project Events");
    expect(rendered).toContain('data-git-history-search');
    expect(rendered).toContain('data-git-history-search-input');
    expect(rendered).toContain('data-git-detail-open="true"');
    expect(rendered).toContain('data-history-search-text="');
    expect(rendered).toContain("feature000");
    expect(rendered).toContain("Event details");
    expect(rendered).toContain("data-history-detail-for=\"history:primary:feature000000000000000000000000000000000000\"");
    const selectedRowIndex = rendered.indexOf(
      "dn-git-history-row selected\" type=\"button\" data-select-id=\"history:primary:feature000000000000000000000000000000000000\"",
    );
    const inlineDetailIndex = rendered.indexOf(
      "dn-git-detail-panel dn-git-inline-detail",
    );
    const nextRowIndex = rendered.indexOf(
      "dn-git-history-row\" type=\"button\" data-select-id=\"history:primary:main10000000000000000000000000000000000000\"",
    );
    expect(selectedRowIndex).toBeGreaterThan(-1);
    expect(inlineDetailIndex).toBeGreaterThan(selectedRowIndex);
    expect(inlineDetailIndex).toBeLessThan(nextRowIndex);
    expect(rendered.slice(selectedRowIndex, inlineDetailIndex)).not.toContain(
      'data-scroll-target="selected-item"',
    );
    expect(rendered).toContain('data-history-row-count="12"');
    expect(rendered).toContain("data-git-board");
    expect(rendered).toContain('<span class="dn-git-graph-detail-edge" aria-hidden="true" style="top:82px;height:234px;"></span>');
    expect(rendered).toContain("data-git-column-menu");
    expect(rendered).toContain("data-git-column-toggle=\"graph\"");
    expect(rendered).toContain("data-git-column-graph=\"visible\"");
    expect(rendered).toContain("data-git-column=\"graph\"");
    expect(rendered).toContain("data-git-column=\"description\"");
    expect(rendered).toContain("data-git-column=\"date\"");
    expect(rendered).toContain("data-git-column=\"author\"");
    expect(rendered).toContain("data-git-column=\"commit\"");
    expect(rendered).toContain("data-git-resize-column=\"graph\"");
    expect(rendered).toContain("data-git-resize-column=\"description\"");
    expect(rendered).toContain("data-git-resize-column=\"date\"");
    expect(rendered).toContain("data-git-resize-column=\"author\"");
    expect(rendered).toContain("data-git-resize-next-column=\"description\"");
    expect(rendered).toContain("data-git-resize-next-column=\"date\"");
    expect(rendered).toContain("data-git-resize-next-column=\"author\"");
    expect(rendered).toContain("data-git-resize-next-column=\"commit\"");
    expect(rendered).not.toContain("data-git-resize-column=\"commit\"");
    expect(rendered).toContain("Resize Graph and Description columns");
    expect(rendered).toContain("<span class=\"dn-git-date\"");
    expect(rendered).toContain("<span class=\"dn-git-author\"");
    expect(rendered).toContain("Codex</span>");
    expect(rendered).toContain("<span class=\"dn-git-sha\"");
    expect(rendered).toContain("dn-git-history-row merge");
    expect(rendered).toContain("<span class=\"dn-git-description\"");
    expect(rendered.slice(selectedRowIndex, inlineDetailIndex)).not.toContain(
      "<strong title=\"Add graph data\"",
    );
    expect(rendered).toContain(">feature</span>");
    expect(rendered).not.toContain("dn-git-component");
    expect(rendered).toContain("<svg");
    expect(rendered).toContain("dn-git-row-hit");
    expect(rendered).toContain("role=\"button\" tabindex=\"0\"");
    expect(rendered).toContain("dn-git-row-menu");
    expect(rendered).toContain("Copy commit");
    expect(rendered).toContain("Copy branch");
    expect(rendered).toContain("feat/cockpit-graph");
    expect(rendered).toContain("Add graph data");
    expect(rendered).toContain("data-select-id=\"history:primary:feature000000000000000000000000000000000000\"");
    expect(detail).toMatchObject({
      title: "Add graph data",
      facts: expect.arrayContaining([
        ["Type", "event"],
        ["Component", "DevNexus"],
        ["Commit", "feature"],
        ["Parents", "1"],
      ]),
    });
  });

  it("keeps project histories separate by default while retaining an internal all-project graph", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
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
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "core100000000000000000000000000000000000000",
                  },
                ],
              },
            ],
          },
          {
            componentId: "plugin",
            componentName: "DevNexus-TypeScript",
            repositoryPath: "/workspace/typescript",
            head: "plug100000000000000000000000000000000000000",
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
                hash: "plug100000000000000000000000000000000000000",
                shortHash: "plug100",
                parents: [],
                authorName: "Codex",
                authorEmail: "codex@example.com",
                committedAt: "2026-05-23T11:55:00.000Z",
                subject: "Update TypeScript setup",
                refs: [
                  {
                    name: "main",
                    kind: "branch",
                    remote: null,
                    hash: "plug100000000000000000000000000000000000000",
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

    const rows = hooks.gitHistoryRows(snapshot);
    const allRows = hooks.gitHistoryRows(snapshot, "all");
    const rendered = hooks.renderGitHistory(snapshot);
    const pluginRows = hooks.gitHistoryRows(snapshot, "component:plugin");
    const pluginRendered = hooks.renderGitHistory(snapshot, null, "component:plugin");

    expect(rows?.rows.map((row) => row.selectId)).toEqual([
      "history:primary:core100000000000000000000000000000000000000",
    ]);
    expect(allRows?.rows.map((row) => row.selectId)).toEqual([
      "history:primary:core100000000000000000000000000000000000000",
      "history:plugin:plug100000000000000000000000000000000000000",
    ]);
    expect(pluginRows?.rows.map((row) => row.selectId)).toEqual([
      "history:plugin:plug100000000000000000000000000000000000000",
    ]);
    expect(rendered).toContain("1 event");
    expect(rendered).toContain("1 repo");
    expect(rendered).toContain('data-git-history-project-select');
    expect(rendered).toContain('data-git-history-branch-select');
    expect(rendered).toContain('data-git-history-fetch-remotes');
    expect(rendered).not.toContain("All events");
    expect(rendered).toContain("Update core cockpit");
    expect(rendered).not.toContain("Update TypeScript setup");
    expect(rendered).toContain("DevNexus-TypeScript");
    expect(pluginRendered).toContain("1 event");
    expect(pluginRendered).toContain("1 repo");
    expect(pluginRendered).toContain("Update TypeScript setup");
    expect(pluginRendered).not.toContain("Update core cockpit");
  });

  it("does not default-select an event when history is available", async () => {
    const hooks = await loadDashboardClientTestHooks();
    const snapshot = {
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
      features: {
        records: [],
      },
      project: {
        name: "Dashboard Demo",
      },
      signals: [],
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
      },
    };

    expect(hooks.defaultSelectedId(snapshot)).toBe("project");
  });

  it("toggles a selected event closed when clicked again", async () => {
    const hooks = await loadDashboardClientTestHooks();

    expect(
      hooks.nextDashboardSelectedId(
        "history:primary:core100000000000000000000000000000000000000",
        "history:primary:core100000000000000000000000000000000000000",
      ),
    ).toBeNull();
    expect(
      hooks.nextDashboardSelectedId(
        "history:primary:core100000000000000000000000000000000000000",
        "history:primary:core200000000000000000000000000000000000000",
      ),
    ).toBe("history:primary:core200000000000000000000000000000000000000");
  });

  it("routes cross-lane git graph links through visible curves", async () => {
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
    expect(rendered).toContain("M 28 13 C 28 31.72, 43 20.28, 43 39");
    expect(rendered).toContain("V 91");
    expect(rendered).not.toContain("H 44 V 91");
    expect(delayedCrossLanePaths).toEqual([]);
  });

  it("anchors side-branch git graph connectors at the base event", async () => {
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
    const feature = graph?.rows.find((row) => row.commit.hash.startsWith("feature"));
    const base = graph?.rows.find((row) => row.commit.hash.startsWith("base"));
    const sideToBase = graph?.paths.find(
      (path) =>
        path.fromLane === feature?.lane &&
        path.fromIndex === feature?.index &&
        path.toLane === base?.lane &&
        path.toIndex === base?.index,
    );
    const lastFeatureLanePoint = sideToBase?.points
      ?.filter((point) => point.lane === feature?.lane)
      .slice(-1)[0];

    expect(graph?.paths.length).toBeGreaterThan(0);
    expect(feature).toBeDefined();
    expect(base).toBeDefined();
    expect(sideToBase?.points?.slice(-1)[0]).toEqual({
      lane: base?.lane,
      index: base?.index,
    });
    expect(lastFeatureLanePoint?.index).toBe(feature?.index);
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

  it("keeps git graph side branches parallel until their shared base", async () => {
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

    expect(sideB?.lane).toBe(2);
    expect(Math.max(...(rows?.rows.map((row) => row.lane) ?? []))).toBe(2);
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
    expect(rendered).toContain('height="104"');
    expect(rendered).toContain('viewBox="0 0 148 104"');
    expect(rendered).toContain('data-history-row-count="4"');
    expect(rendered).toContain('data-history-lane-count="1"');
    expect(rendered).toContain('data-history-event-class="source-change"');
    expect(rendered).toContain('class="dn-git-row-hit"');
    expect(rendered).toContain(
      'data-select-id="history:primary:head000000000000000000000000000000000000"',
    );
    expect(rendered).toContain('data-dn-tooltip-mode="always"');
    expect(rendered).toContain(
      'data-history-event-id="history:primary:head000000000000000000000000000000000000"',
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

    const rows = hooks.gitHistoryRows(snapshot, "component:primary|branch:feat/cockpit-graph");
    const rendered = hooks.renderGitHistory(snapshot, null, "component:primary|branch:feat/cockpit-graph");

    expect(rows?.rows.map((row) => row.commit.hash)).toEqual([
      "feature000000000000000000000000000000000000",
      "base0000000000000000000000000000000000000",
    ]);
    expect(rendered).toContain('data-git-history-branch-select');
    expect(rendered).toContain('value="component:primary|branch:feat/cockpit-graph" selected');
    expect(rendered).toContain("dn-history-scope-token");
    expect(rendered).toContain('data-dn-tooltip="feat/cockpit-graph" data-dn-tooltip-mode="always"');
    expect(rendered).not.toContain("dn-history-scope-kind");
    expect(rendered).not.toContain("dn-git-ref");
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
});
