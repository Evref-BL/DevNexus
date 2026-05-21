import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNexusAutomationTargetCycleRecord,
  buildNexusDashboardSnapshot,
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  nexusWorktreeLeaseKind,
  renderNexusDashboardClientModule,
  saveProjectConfig,
  writeNexusWorktreeLeaseStore,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
  type NexusWorktreeLeaseRecord,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "dashboard-demo",
    name: "Dashboard Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:dashboard/demo.git",
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
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        limit: 5,
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
        targetBranch: "main",
      },
    },
    ...overrides,
  };
}

function fakeGitRunner(): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    const command = argsArray.join(" ");
    if (command === "rev-parse --show-toplevel") {
      return ok(argsArray, `${cwd ?? ""}\n`);
    }
    if (command === "rev-parse --abbrev-ref HEAD") {
      return ok(argsArray, "main\n");
    }
    if (command === "rev-parse HEAD") {
      return ok(argsArray, "abc1234567890\n");
    }
    if (command === "status --porcelain=v1") {
      return ok(argsArray, "");
    }
    if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return fail(argsArray, "fatal: no upstream configured\n");
    }
    if (command === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, "0\t0\n");
    }
    if (command.startsWith("config ")) {
      return ok(argsArray, "");
    }
    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function fail(args: string[], stderr: string): GitCommandResult {
  return {
    args,
    stdout: "",
    stderr,
    exitCode: 1,
  };
}

function worktreeLease(projectId: string): NexusWorktreeLeaseRecord {
  return {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id: "lease-dashboard",
    projectId,
    scope: {
      kind: "component",
      componentId: "primary",
    },
    hostId: "host-1",
    agentId: "agent-1",
    workItemId: "local-1",
    branchName: "codex/primary/dashboard",
    baseRef: "main",
    worktree: {
      kind: "component_worktree",
      base: "componentWorktreesRoot",
      componentId: "primary",
      relativePath: "dashboard",
    },
    writeScope: ["src/nexusDashboard.ts"],
    status: "working",
    createdAt: "2026-05-21T10:00:00.000Z",
    lastSeenAt: "2026-05-21T10:00:00.000Z",
    updatedAt: "2026-05-21T10:00:00.000Z",
    refreshCount: 0,
    lastObservedHeadCommit: "abc1234567890",
    dirty: false,
    pushed: false,
    git: {
      repository: {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId: "primary",
        relativePath: "dashboard",
      },
      upstream: null,
      ahead: null,
      behind: null,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      warnings: [],
    },
    notes: [],
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus dashboard", () => {
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
        summary: "Dispatched dashboard work.",
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
      leases: [worktreeLease(config.id)],
    });

    const snapshot = await buildNexusDashboardSnapshot({
      projectRoot,
      gitRunner: fakeGitRunner(),
      now: fixedClock("2026-05-21T10:05:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      version: 1,
      generatedAt: "2026-05-21T10:05:00.000Z",
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
      },
    });
    expect(snapshot.signals.map((signal) => signal.id)).toContain("eligible-work");
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
  });

  it("renders a client module with explicit light and dark mode controls", () => {
    const module = renderNexusDashboardClientModule();

    expect(module).toContain("dev-nexus-dashboard-theme");
    expect(module).toContain("data-dev-nexus-theme");
    expect(module).toContain("data-theme-mode=\"system\"");
    expect(module).toContain("data-theme-mode=\"light\"");
    expect(module).toContain("data-theme-mode=\"dark\"");
    expect(module).toContain(":root[data-dev-nexus-theme='light']");
    expect(module).toContain(":root[data-dev-nexus-theme='dark']");
    expect(module).toContain("color-scheme");
    expect(module).toContain("prefers-color-scheme");
    expect(module).toContain("data-select-id");
    expect(module).toContain("Work History");
    expect(module).toContain("Worktree lanes");
    expect(module).toContain("selectedDetail");
    expect(module).toContain("timelineLanes");
    expect(module).toContain("renderBranchGraph");
    expect(module).toContain("dn-branch-svg");
    expect(module).toContain("const rowHeight = 34");
    expect(module).toContain("data-row-height");
    expect(module).toContain("dn-history-chip");
    expect(module).toContain("left: calc(-115px + (var(--dn-lane) * 18px))");
    expect(module).toContain("-webkit-line-clamp: 3");
    expect(module).toContain("formatDisplayText");
    expect(module).toContain("signalIcon");
  });
});
