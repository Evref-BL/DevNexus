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

describe("nexus dashboard client action surfaces", () => {  it("makes HITL threads selectable with the same chat actions as the queue", async () => {
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
