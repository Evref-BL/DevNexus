import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationRunRecord,
} from "./nexusAutomation.js";
import {
  appendNexusAutomationTargetCycleRecord,
  writeNexusAutomationTargetCycleLedger,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  getNexusAutomationEligibleWorkSummary,
} from "./nexusAutomationAgentSurface.js";
import {
  defaultNexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  createLocalWorkTrackerProvider,
} from "./workTrackingLocalProvider.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "report-demo",
    name: "Report Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:report/demo.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Use this project until no eligible work remains.",
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation target report", () => {
  it("builds a factual report from target cycles and run ledger records", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "run-1",
        projectId: "report-demo",
        status: "completed",
        summary: "Coordinator launched.",
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:05:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-1",
        status: "dispatched",
        summary: "Dispatched one work item.",
        eligibleWorkItemCount: 2,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            title: "Implement report",
            cycleStatus: "dispatched",
            agentProfileId: "codex-heavy",
            notes: "Subagent launched.",
          },
        ],
        notes: ["Cycle remains active."],
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:30:00.000Z",
      record: {
        id: "cycle-2",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-2",
        status: "blocked",
        summary: "Waiting for credentials.",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            title: "Implement report",
            cycleStatus: "blocked",
          },
        ],
        blockers: ["Credentials are missing."],
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:40:00.000Z",
    });

    expect(report).toMatchObject({
      version: 1,
      generatedAt: "2026-05-16T10:40:00.000Z",
      project: {
        id: "report-demo",
        componentCount: 1,
      },
      target: {
        id: "dogfood",
        objective: "Use this project until no eligible work remains.",
      },
      status: "blocked",
      statusReason: "Latest target cycle cycle-2 is blocked",
      cycleSummary: {
        cycleCount: 2,
        activeCycleCount: 1,
        blockedCycleCount: 1,
      },
      runSummary: {
        runCount: 1,
        completedRunCount: 1,
      },
      workItemSummary: {
        totalReferences: 2,
        uniqueReferences: [
          {
            componentId: "primary",
            id: "local-1",
            latestCycleStatus: "blocked",
            latestCycleId: "cycle-2",
          },
        ],
        byComponent: [
          {
            componentId: "primary",
            totalReferences: 2,
            uniqueWorkItemCount: 1,
          },
        ],
        byCycleStatus: {
          dispatched: 1,
          blocked: 1,
        },
      },
      externalIssueVisibility: {
        componentCount: 1,
        defaultTrackerOnlyComponentCount: 1,
        importOnlyWorkItemCount: 0,
        providerAccessWarningCount: 0,
        providerAccessBlockerCount: 0,
        components: [
          {
            componentId: "primary",
            mode: "default_tracker_only",
          },
        ],
      },
      workspacePublication: {
        mode: "review_handoff",
        targetBranch: null,
      },
      relaunchDecision: {
        type: "report_blocked",
        reason: "Latest target cycle cycle-2 is blocked",
        latestCycleId: "cycle-2",
        latestRunId: "run-2",
      },
      blockers: ["Credentials are missing."],
      notes: ["Cycle remains active."],
    });
  });

  it("adds compact version planning readiness facts when configured", async () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: {
        ...defaultNexusAutomationConfig,
        target: {
          ...defaultNexusAutomationConfig.target,
          id: "dogfood",
          objective: "Use this project until no eligible work remains.",
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "local_only",
          targetBranch: "main",
          publicationTrain: {
            enabled: true,
            activeVersionId: "v-next",
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            ciTiers: {
              defaultTier: "remote_smoke",
              fullMatrixBudget: {
                minimumIntervalMinutes: 60,
                minimumChangeCount: 3,
              },
            },
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
      versionPlanning: {
        versions: [
          {
            id: "v-next",
            objective: "Ship the next DevNexus version.",
            owningComponents: ["primary"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                componentId: "primary",
                trackerId: null,
                workItemId: "local-1",
                status: "committed",
              },
              {
                kind: "work_item",
                componentId: "primary",
                trackerId: null,
                workItemId: "local-2",
                status: "deferred",
              },
            ],
            readinessGates: [
              {
                kind: "work_items_done",
                required: true,
                components: ["primary"],
              },
              {
                kind: "no_blockers",
                required: true,
                components: ["primary"],
              },
            ],
            releasePolicy: {
              tags: "none",
              packages: "none",
              providerRelease: "none",
              releaseNotes: "optional",
              changelog: "none",
            },
          },
          {
            id: "v-later",
            objective: "Future unrelated work.",
            owningComponents: ["primary"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                componentId: "primary",
                trackerId: null,
                workItemId: "local-99",
                status: "candidate",
              },
            ],
            readinessGates: [],
            releasePolicy: {
              tags: "none",
              packages: "none",
              providerRelease: "none",
              releaseNotes: "none",
              changelog: "none",
            },
          },
        ],
      },
    });
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: () => "2026-05-16T09:00:00.000Z",
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Committed work",
      status: "ready",
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Deferred work",
      status: "done",
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:05:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "report-demo",
        targetId: "dogfood",
        status: "completed",
        eligibleWorkItemCount: 1,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "eligible",
          },
          {
            componentId: "primary",
            id: "local-2",
            cycleStatus: "completed",
          },
        ],
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:10:00.000Z",
    });

    expect(report.versionPlanning).toMatchObject({
      versionCount: 2,
      shownVersionCount: 1,
      omittedVersionCount: 1,
      versions: [
        {
          id: "v-next",
          objective: "Ship the next DevNexus version.",
          targetBranch: "main",
          owningComponents: ["primary"],
          scopeCounts: {
            resolvedItemCount: 2,
            requiredResolvedItemCount: 1,
            configuredEntryCount: 2,
            byScopeStatus: {
              committed: 1,
              deferred: 1,
            },
          },
          readiness: {
            ready: false,
            state: "blocked",
            gateWarningCount: 1,
          },
          gateWarnings: [
            {
              kind: "work_items_done",
              status: "failed",
              message: "Some committed or candidate scope items are not done.",
            },
          ],
        },
      ],
    });
    expect(report.componentProgress[0]?.publicationTrain).toMatchObject({
      enabled: true,
      activeVersionId: "v-next",
      activeVersionFound: true,
      objective: "Ship the next DevNexus version.",
      targetBranch: "main",
      branches: {
        integrationBranch: "integration/v-next",
        candidateBranch: "candidate/v-next",
      },
      selector: {
        labels: [],
        requiresPublicLabel: false,
      },
      ciTiers: {
        defaultTier: "remote_smoke",
        source: "publication_train",
        fullMatrixBudget: {
          minimumIntervalMinutes: 60,
          minimumChangeCount: 3,
        },
      },
    });

    const eligibleWork = await getNexusAutomationEligibleWorkSummary({
      projectRoot,
    });
    expect(eligibleWork.versionPlanning).toMatchObject({
      versionCount: 2,
      shownVersionCount: 1,
      workItems: [
        {
          componentId: "primary",
          id: "local-1",
          unrelated: false,
          scopes: [
            {
              versionId: "v-next",
              scopeStatus: "committed",
              scopeStatuses: ["committed"],
              entryKinds: ["work_item"],
            },
          ],
        },
      ],
    });
    expect(eligibleWork.components[0]!.workItems[0]).toMatchObject({
      id: "local-1",
      versionScopes: [
        {
          versionId: "v-next",
          scopeStatus: "committed",
        },
      ],
    });
  });

  it("summarizes Codex Goal lifecycle facts from run metadata", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-goals-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);

    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "run-goal",
        projectId: "report-demo",
        componentId: "primary",
        status: "completed",
        workItemId: "local-1",
        workItemTitle: "Use Codex Goals",
        summary: "Run completed with Goal lifecycle evidence.",
        codexAppServer: {
          provider: "codex-app-server",
          status: "completed",
          action: "thread_start",
          runId: "run-goal",
          profileId: "codex-app-server",
          threadId: "thread-goal-report",
          turnId: "turn-goal-report",
          sourceThreadId: null,
          sourceTurnId: null,
          ephemeral: true,
          threadPersistence: "ephemeral",
          cwd: projectRoot,
          model: "gpt-5.5",
          reasoning: "high",
          resultFile: path.join(projectRoot, ".dev-nexus/result.json"),
          failureSummary: null,
          goal: {
            requested: true,
            setMethodAvailable: true,
            getMethodAvailable: true,
            setStatus: "set",
            readStatus: "read",
            goalId: "goal-1",
            threadId: "thread-goal-report",
            status: "budgetLimited",
            tokenBudget: 100,
            tokensUsed: 100,
            timeUsedSeconds: 11,
            failureSummary: null,
          },
        },
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:05:00.000Z",
    });

    expect(report.executionSummary.codexGoals).toMatchObject([
      {
        runId: "run-goal",
        componentId: "primary",
        workItemId: "local-1",
        workItemTitle: "Use Codex Goals",
        goalId: "goal-1",
        threadId: "thread-goal-report",
        status: "budgetLimited",
        tokenBudget: 100,
        tokensUsed: 100,
        timeUsedSeconds: 11,
        setStatus: "set",
        readStatus: "read",
        summary:
          "Codex Goal budgetLimited for thread thread-goal-report; tokens 100/100; time 11s.",
      },
    ]);
    expect(report.componentProgress[0]?.codexGoals).toMatchObject([
      {
        runId: "run-goal",
        status: "budgetLimited",
      },
    ]);
  });

  it("omits version planning from target reports when no version config exists", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    expect(
      buildNexusAutomationTargetReport({
        projectRoot,
        now: "2026-05-16T10:10:00.000Z",
      }).versionPlanning,
    ).toBeUndefined();
  });

  it("summarizes component progress and execution facts with local tracker work item details", async () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), {
      recursive: true,
    });
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    const config = projectConfig({
      workTracking: undefined,
      components: [
        {
          id: "primary",
          name: "Primary",
          kind: "git",
          role: "primary",
          remoteUrl: "git@example.invalid:report/demo.git",
          defaultBranch: "main",
          sourceRoot: "source",
          workTracking: {
            provider: "local",
            storePath: primaryStorePath,
          },
          relationships: [],
        },
        {
          id: "addon",
          name: "Addon",
          kind: "git",
          role: "addon",
          remoteUrl: "git@example.invalid:report/addon.git",
          defaultBranch: "main",
          sourceRoot: "components/addon",
          workTracking: {
            provider: "local",
            storePath: addonStorePath,
          },
          relationships: [],
        },
      ],
    });
    saveProjectConfig(projectRoot, config);
    const primaryTracker = createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-16T09:00:00.000Z",
    });
    await primaryTracker.createWorkItem({
      projectRoot,
      title: "Ready primary work",
      status: "ready",
    });
    await primaryTracker.createWorkItem({
      projectRoot,
      title: "Completed primary work",
      status: "done",
    });
    const addonTracker = createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: () => "2026-05-16T09:05:00.000Z",
    });
    await addonTracker.createWorkItem({
      projectRoot,
      title: "Waiting on human approval",
      status: "blocked",
    });
    await addonTracker.createWorkItem({
      projectRoot,
      title: "Skipped addon work",
      status: "wont_do",
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "run-primary",
        projectId: "report-demo",
        componentId: "primary",
        status: "completed",
        workItemId: "local-3",
        workItemTitle: "Dispatch target reporter",
        commitIds: ["abc123"],
        summary: "Primary implementation finished.",
        verification: [
          {
            command: "npm test -- nexusAutomationTargetReport.test.ts",
            status: "passed",
            summary: "Focused report tests passed.",
            recordedAt: "2026-05-16T10:10:00.000Z",
          },
        ],
        publicationDecision: {
          type: "direct_integration",
          remote: "origin",
          targetBranch: "main",
          prUrl: null,
          reason: "Ready for direct integration.",
          decidedAt: "2026-05-16T10:12:00.000Z",
        },
      },
    });
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:15:00.000Z",
      record: {
        id: "run-addon",
        projectId: "report-demo",
        componentId: "addon",
        status: "blocked",
        workItemId: "local-1",
        summary: "Addon work needs approval.",
        error: "Human approval is missing.",
      },
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:20:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-addon",
        status: "blocked",
        summary: "Blocked after component batch.",
        eligibleWorkItemCount: 1,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "eligible",
          },
          {
            componentId: "primary",
            id: "local-2",
            cycleStatus: "completed",
          },
          {
            componentId: "primary",
            id: "local-3",
            title: "Dispatch target reporter",
            status: "in_progress",
            cycleStatus: "dispatched",
            agentProfileId: "codex-local",
          },
          {
            componentId: "addon",
            id: "local-1",
            cycleStatus: "blocked",
            notes: "Needs human approval.",
          },
          {
            componentId: "addon",
            id: "local-2",
            cycleStatus: "skipped",
          },
        ],
        blockers: ["Human approval is missing."],
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:30:00.000Z",
    });

    expect(report.activeBlockers).toMatchObject([
      {
        source: "cycle",
        componentId: null,
        cycleId: "cycle-1",
        runId: "run-addon",
        workItemId: null,
        message: "Human approval is missing.",
      },
      {
        source: "work_item",
        componentId: "addon",
        cycleId: "cycle-1",
        runId: "run-addon",
        workItemId: "local-1",
        workItemTitle: "Waiting on human approval",
        message: "Needs human approval.",
      },
      {
        source: "run",
        componentId: "addon",
        cycleId: "cycle-1",
        runId: "run-addon",
        workItemId: "local-1",
        workItemTitle: "Waiting on human approval",
        message: "Human approval is missing.",
      },
    ]);
    expect(report.workItemSummary).toMatchObject({
      uniqueReferences: [
        {
          componentId: "primary",
          id: "local-1",
          title: "Ready primary work",
          status: "ready",
          latestCycleStatus: "eligible",
        },
        {
          componentId: "primary",
          id: "local-2",
          title: "Completed primary work",
          status: "done",
          latestCycleStatus: "completed",
        },
        {
          componentId: "primary",
          id: "local-3",
          title: "Dispatch target reporter",
          status: "in_progress",
          latestCycleStatus: "dispatched",
        },
        {
          componentId: "addon",
          id: "local-1",
          title: "Waiting on human approval",
          status: "blocked",
          latestCycleStatus: "blocked",
        },
        {
          componentId: "addon",
          id: "local-2",
          title: "Skipped addon work",
          status: "wont_do",
          latestCycleStatus: "skipped",
        },
      ],
      progress: {
        readyEligibleWork: [{ componentId: "primary", id: "local-1" }],
        selectedWork: [{ componentId: "primary", id: "local-3" }],
        blockedHitlWork: [{ componentId: "addon", id: "local-1" }],
        completedWork: [{ componentId: "primary", id: "local-2" }],
        skippedWork: [{ componentId: "addon", id: "local-2" }],
      },
    });
    expect(report.executionSummary).toMatchObject({
      commitIds: ["abc123"],
      verification: [
        {
          runId: "run-primary",
          componentId: "primary",
          workItemId: "local-3",
          command: "npm test -- nexusAutomationTargetReport.test.ts",
          status: "passed",
        },
      ],
      publicationDecisions: [
        {
          runId: "run-primary",
          componentId: "primary",
          workItemId: "local-3",
          type: "direct_integration",
          remote: "origin",
          targetBranch: "main",
        },
      ],
    });
    expect(report.componentProgress).toMatchObject([
      {
        componentId: "primary",
        componentName: "Primary",
        workItemCount: 3,
        commitIds: ["abc123"],
        workItems: {
          readyEligibleWork: [{ id: "local-1" }],
          selectedWork: [{ id: "local-3" }],
          completedWork: [{ id: "local-2" }],
        },
        runs: [
          {
            runId: "run-primary",
            status: "completed",
            workItemId: "local-3",
          },
        ],
      },
      {
        componentId: "addon",
        componentName: "Addon",
        workItemCount: 2,
        activeBlockers: [
          {
            source: "work_item",
            workItemId: "local-1",
          },
          {
            source: "run",
            workItemId: "local-1",
          },
        ],
        workItems: {
          blockedHitlWork: [{ id: "local-1" }],
          skippedWork: [{ id: "local-2" }],
        },
        runs: [
          {
            runId: "run-addon",
            status: "blocked",
            workItemId: "local-1",
          },
        ],
      },
    ]);
  });

  it("makes relaunch and stop decisions from latest recorded eligible work", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: {
        ...projectConfig().automation!,
        agent: {
          ...projectConfig().automation!.agent,
          relaunch: {
            whileEligible: true,
          },
        },
      },
    });
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:05:00.000Z",
      record: {
        id: "cycle-1",
        projectId: "report-demo",
        targetId: "dogfood",
        status: "completed",
        summary: "Completed one bounded batch.",
        eligibleWorkItemCount: 3,
      },
    });

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      relaunchDecision: {
        type: "relaunch",
        eligibleWorkItemCount: 3,
        latestCycleId: "cycle-1",
      },
    });

    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:30:00.000Z",
      record: {
        id: "cycle-2",
        projectId: "report-demo",
        targetId: "dogfood",
        status: "completed",
        summary: "No eligible work remains.",
        eligibleWorkItemCount: 0,
      },
    });

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      relaunchDecision: {
        type: "stop",
        eligibleWorkItemCount: 0,
        latestCycleId: "cycle-2",
      },
    });
  });

  it("includes authority summaries in reports and preserves recorded cycle authority facts", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: {
        ...projectConfig().automation!,
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "direct_integration",
          remote: "bot",
          targetBranch: "main",
          push: true,
          actor: {
            id: "example-bot-actor",
            kind: "machine_user",
            provider: "github",
            handle: "example-bot",
          },
        },
      },
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "example-bot",
            displayName: "Example Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["contributor"],
            scope: {
              component: "primary",
            },
          },
        ],
      },
    });
    saveProjectConfig(projectRoot, config);
    const authority = buildNexusAutomationTargetReport({ projectRoot }).authority!;
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "cycle-authority",
        projectId: "report-demo",
        targetId: "dogfood",
        status: "dispatched",
        authority,
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:05:00.000Z",
    });

    expect(report.authority).toMatchObject({
      components: [
        {
          componentId: "primary",
          actor: {
            actorId: "example-bot-actor",
          },
          roles: ["contributor"],
          blockedActions: expect.arrayContaining(["git.push_target_branch"]),
          fallbackActions: expect.arrayContaining([
            "provider.pull_request.open",
          ]),
        },
      ],
    });
    expect(report.cycleSummary?.lastCycle?.authority).toMatchObject({
      components: [
        {
          componentId: "primary",
          summary: expect.stringContaining("fallback=provider.pull_request.open"),
        },
      ],
    });
  });

  it("keeps currently done work out of ready eligible progress when cycle facts are stale", async () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local" },
      now: () => "2026-05-16T09:00:00.000Z",
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Already finished work",
      status: "done",
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "cycle-with-stale-eligible-fact",
        projectId: "report-demo",
        targetId: "dogfood",
        status: "completed",
        summary: "The selector used to consider this item eligible.",
        eligibleWorkItemCount: 0,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "eligible",
          },
        ],
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:10:00.000Z",
    });

    expect(report.workItemSummary?.progress).toMatchObject({
      readyEligibleWork: [],
      completedWork: [{ componentId: "primary", id: "local-1" }],
    });
    expect(report.componentProgress).toMatchObject([
      {
        componentId: "primary",
        workItems: {
          readyEligibleWork: [],
          completedWork: [{ id: "local-1" }],
        },
      },
    ]);
  });

  it("summarizes effective green-main publication policy in component progress", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      automation: {
        ...projectConfig().automation!,
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "green_main",
          targetBranch: "main",
          greenMain: {
            integrationPreference: "pull_request",
            integrationBranch: null,
            directTargetPush: "blocked",
            mergeAuthority: "handoff",
            requiredChecks: ["build"],
            staleChecks: "block",
          },
        },
      },
    }));

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:05:00.000Z",
    });

    expect(report.componentProgress[0]?.publication).toMatchObject({
      mode: "green_main",
      targetBranch: "main",
      integrationPreference: "pull_request",
      directTargetPush: "blocked",
      mergeAuthority: "handoff",
      requiredChecks: ["build"],
      staleChecks: "block",
    });
  });

  it("reports wait for active cycles and failed decisions", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:05:00.000Z",
      record: {
        id: "cycle-active",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-active",
        status: "dispatched",
        summary: "Coordinator still has a dispatched cycle.",
        eligibleWorkItemCount: 1,
      },
    });

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      status: "active",
      statusReason: "Latest target cycle cycle-active is dispatched",
      relaunchDecision: {
        type: "wait",
        reason: "Latest target cycle cycle-active is still dispatched",
        eligibleWorkItemCount: 1,
        latestCycleId: "cycle-active",
        latestRunId: "run-active",
      },
    });

    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:30:00.000Z",
      record: {
        id: "cycle-failed",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-failed",
        status: "failed",
        summary: "Coordinator failed verification.",
        eligibleWorkItemCount: 1,
      },
    });

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      status: "failed",
      statusReason: "Latest target cycle cycle-failed is failed",
      relaunchDecision: {
        type: "report_failed",
        reason: "Latest target cycle cycle-failed failed",
        eligibleWorkItemCount: 1,
        latestCycleId: "cycle-failed",
        latestRunId: "run-failed",
      },
    });
  });

  it("reports not started when no target cycle or run exists", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      status: "not_started",
      statusReason: "No target cycles or automation runs are recorded",
      cycleSummary: {
        cycleCount: 0,
      },
      runSummary: {
        runCount: 0,
      },
      relaunchDecision: {
        type: "not_ready",
        reason: "No target cycle is recorded",
      },
    });
  });

  it("surfaces stale in-progress coordinator-owned work in target and eligible-work reports", async () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Coordinator-owned stale item",
      status: "in_progress",
      labels: ["automation"],
    });
    appendNexusAutomationTargetCycleRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "cycle-completed-stale",
        projectId: "report-demo",
        targetId: "dogfood",
        runId: "run-completed-stale",
        status: "completed",
        summary: "Coordinator reported completion.",
        eligibleWorkItemCount: 0,
        workItems: [
          {
            componentId: "primary",
            trackerId: "default",
            trackerProvider: "local",
            id: "local-1",
            title: "Coordinator-owned stale item",
            cycleStatus: "completed",
          },
        ],
      },
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:30:00.000Z",
    });

    expect(report).toMatchObject({
      status: "completed",
      relaunchDecision: {
        type: "report_blocked",
        reason:
          "Latest target cycle cycle-completed-stale has 1 stale coordinator-owned in_progress work item(s)",
        eligibleWorkItemCount: 0,
        latestCycleId: "cycle-completed-stale",
        latestRunId: "run-completed-stale",
      },
      activeBlockers: [
        {
          source: "work_item",
          componentId: "primary",
          trackerId: "default",
          trackerProvider: "local",
          cycleId: "cycle-completed-stale",
          runId: "run-completed-stale",
          workItemId: "local-1",
          workItemTitle: "Coordinator-owned stale item",
          message:
            "Coordinator-owned work item is still in_progress after target cycle cycle-completed-stale completed.",
        },
      ],
      workItemSummary: {
        progress: {
          staleInProgressWork: [
            {
              componentId: "primary",
              trackerId: "default",
              trackerProvider: "local",
              id: "local-1",
              status: "in_progress",
              latestCycleStatus: "completed",
            },
          ],
        },
      },
    });

    const eligibleWork = await getNexusAutomationEligibleWorkSummary({
      projectRoot,
    });
    expect(eligibleWork).toMatchObject({
      eligibleWorkItemCount: 0,
      staleInProgressWorkItemCount: 1,
      components: [
        {
          componentId: "primary",
          workItems: [],
          staleInProgressWorkItems: [
            {
              componentId: "primary",
              id: "local-1",
              status: "in_progress",
              title: "Coordinator-owned stale item",
            },
          ],
        },
      ],
    });
  });

  it("ignores superseded pending placeholders from duplicate target-cycle records", async () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Concrete completed work",
      status: "done",
    });
    writeNexusAutomationTargetCycleLedger(projectRoot, config.automation!, {
      version: 1,
      updatedAt: "2026-05-16T10:30:00.000Z",
      cycles: [
        {
          id: "cycle-reconciled",
          projectId: "report-demo",
          targetId: "dogfood",
          runId: "run-reconciled",
          status: "started",
          startedAt: "2026-05-16T10:00:00.000Z",
          finishedAt: null,
          objective: null,
          summary: "Coordinator reserved placeholder work.",
          eligibleWorkItemCount: 1,
          workItems: [
            {
              componentId: "primary",
              trackerId: "local",
              trackerProvider: "local",
              id: "pending",
              logicalItemId: null,
              title: "Pending component work",
              status: "in_progress",
              cycleStatus: "in_progress",
              agentProfileId: null,
              notes: null,
            },
          ],
          authority: null,
          blockers: [],
          notes: [],
          nextCycleNotBefore: null,
        },
        {
          id: "cycle-reconciled",
          projectId: "report-demo",
          targetId: "dogfood",
          runId: "run-reconciled",
          status: "completed",
          startedAt: "2026-05-16T10:00:00.000Z",
          finishedAt: "2026-05-16T10:30:00.000Z",
          objective: null,
          summary: "Coordinator completed the concrete work item.",
          eligibleWorkItemCount: 0,
          workItems: [
            {
              componentId: "primary",
              trackerId: "local",
              trackerProvider: "local",
              id: "local-1",
              logicalItemId: null,
              title: "Concrete completed work",
              status: "done",
              cycleStatus: "completed",
              agentProfileId: null,
              notes: null,
            },
          ],
          authority: null,
          blockers: [],
          notes: [],
          nextCycleNotBefore: null,
        },
      ],
    });

    const report = buildNexusAutomationTargetReport({
      projectRoot,
      now: "2026-05-16T10:45:00.000Z",
    });

    expect(report.workItemSummary?.uniqueReferences).toMatchObject([
      {
        componentId: "primary",
        id: "local-1",
        latestCycleId: "cycle-reconciled",
        latestCycleStatus: "completed",
      },
    ]);
    expect(report.workItemSummary?.progress).toMatchObject({
      staleInProgressWork: [],
      completedWork: [{ componentId: "primary", id: "local-1" }],
    });

    const eligibleWork = await getNexusAutomationEligibleWorkSummary({
      projectRoot,
    });
    expect(eligibleWork).toMatchObject({
      eligibleWorkItemCount: 0,
      staleInProgressWorkItemCount: 0,
      components: [],
    });
  });

  it("keeps target status not started when only legacy run records exist", () => {
    const projectRoot = makeTempDir("dev-nexus-target-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    appendNexusAutomationRunRecord({
      projectRoot,
      config: config.automation!,
      now: "2026-05-16T10:00:00.000Z",
      record: {
        id: "run-1",
        projectId: "report-demo",
        status: "completed",
      },
    });

    expect(buildNexusAutomationTargetReport({ projectRoot })).toMatchObject({
      status: "not_started",
      statusReason:
        "No target cycle is recorded; latest automation run run-1 is completed",
      cycleSummary: {
        cycleCount: 0,
      },
      runSummary: {
        runCount: 1,
      },
    });
  });
});
