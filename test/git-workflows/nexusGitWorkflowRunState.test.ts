import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNexusGitWorkflowRun,
  listNexusGitWorkflowRuns,
  nexusGitWorkflowRunStorePath,
  normalizeNexusGitWorkflowRun,
  readNexusGitWorkflowRunStore,
  updateNexusGitWorkflowRun,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function minimalRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "dev-nexus.git-workflow.run",
    version: 1,
    id: "run-1",
    projectId: "demo-project",
    componentId: "core",
    profileId: "protected-feature",
    status: "working",
    terminalOutcome: null,
    workItemId: "github-1",
    branchName: "feat/demo/change",
    currentRef: "feat/demo/change",
    baseRef: "origin/main",
    baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    targetBranch: "main",
    owner: {
      kind: "agent",
      id: "codex",
    },
    providerLinks: [],
    evidence: [],
    allowedTransitions: [],
    nodes: [
      {
        id: "start",
        kind: "action",
        summary: "Prepared the worktree.",
        recordedAt: "2026-05-25T10:00:00.000Z",
      },
    ],
    createdAt: "2026-05-25T10:00:00.000Z",
    updatedAt: "2026-05-25T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus Git workflow run state", () => {
  it("stores runs in Git runtime metadata outside tracked workspace state", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-runs-");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    const run = createNexusGitWorkflowRun({
      projectRoot,
      id: "run-1",
      projectId: "demo-project",
      componentId: "core",
      profileId: "protected-feature",
      workItemId: "github-1",
      branchName: "feat/demo/change",
      currentRef: "feat/demo/change",
      baseRef: "origin/main",
      baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      targetBranch: "main",
      owner: {
        kind: "agent",
        id: "codex",
      },
      nodes: [
        {
          id: "start",
          kind: "action",
          summary: "Prepared the worktree.",
        },
        {
          id: "observe",
          kind: "observation",
          summary: "Read provider evidence.",
        },
        {
          id: "decide",
          kind: "decision",
          summary: "Selected pull request review.",
        },
        {
          id: "gate",
          kind: "gate",
          summary: "Human approval is required.",
        },
        {
          id: "handoff",
          kind: "handoff",
          summary: "Returned control to the maintainer.",
        },
      ],
      now: "2026-05-25T10:00:00.000Z",
    });

    expect(run).toMatchObject({
      id: "run-1",
      status: "working",
      branchName: "feat/demo/change",
      owner: {
        kind: "agent",
        id: "codex",
      },
    });
    expect(nexusGitWorkflowRunStorePath(projectRoot)).toBe(
      path.join(projectRoot, ".git", "dev-nexus", "git-workflow-runs.json"),
    );
    expect(fs.existsSync(nexusGitWorkflowRunStorePath(projectRoot))).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "git-workflow-runs.json")),
    ).toBe(false);
    expect(readNexusGitWorkflowRunStore(projectRoot).runs).toMatchObject([
      {
        id: "run-1",
        status: "working",
        nodes: [
          { id: "start", kind: "action" },
          { id: "observe", kind: "observation" },
          { id: "decide", kind: "decision" },
          { id: "gate", kind: "gate" },
          { id: "handoff", kind: "handoff" },
        ],
      },
    ]);
  });

  it("stores worktree runs under the linked Git directory", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-runs-");
    const linkedGitDir = makeTempDir("dev-nexus-linked-git-dir-");
    fs.writeFileSync(
      path.join(projectRoot, ".git"),
      `# worktree metadata\ngitdir: ${linkedGitDir}\n`,
      "utf8",
    );

    createNexusGitWorkflowRun({
      projectRoot,
      id: "run-linked",
      projectId: "demo-project",
      componentId: "core",
      profileId: "protected-feature",
      now: "2026-05-25T10:00:00.000Z",
    });

    expect(nexusGitWorkflowRunStorePath(projectRoot)).toBe(
      path.join(linkedGitDir, "dev-nexus", "git-workflow-runs.json"),
    );
    expect(fs.existsSync(nexusGitWorkflowRunStorePath(projectRoot))).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "runtime", "git-workflow-runs.json"),
      ),
    ).toBe(false);
  });

  it("updates and summarizes resumable run state", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-runs-");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    createNexusGitWorkflowRun({
      projectRoot,
      id: "run-1",
      projectId: "demo-project",
      componentId: "core",
      profileId: "protected-feature",
      branchName: "feat/demo/change",
      currentRef: "feat/demo/change",
      targetBranch: "main",
      owner: {
        kind: "agent",
        id: "codex",
      },
      now: "2026-05-25T10:00:00.000Z",
    });

    const updated = updateNexusGitWorkflowRun({
      projectRoot,
      id: "run-1",
      status: "waiting",
      owner: {
        kind: "ci",
        id: "github-actions",
      },
      evidence: [
        {
          id: "checks",
          kind: "provider_checks",
          summary: "CI is pending.",
        },
      ],
      allowedTransitions: [
        {
          id: "checks-green",
          to: "ready_for_review",
          summary: "Continue after required checks pass.",
        },
      ],
      nodes: [
        {
          id: "wait-ci",
          kind: "wait",
          summary: "Waiting for CI.",
        },
      ],
      now: "2026-05-25T10:05:00.000Z",
    });

    expect(updated).toMatchObject({
      status: "waiting",
      owner: {
        kind: "ci",
        id: "github-actions",
      },
      evidence: [
        {
          id: "checks",
          kind: "provider_checks",
          summary: "CI is pending.",
          observedAt: "2026-05-25T10:05:00.000Z",
        },
      ],
      allowedTransitions: [
        {
          id: "checks-green",
          to: "ready_for_review",
        },
      ],
    });

    expect(listNexusGitWorkflowRuns({ projectRoot }).runs).toMatchObject([
      {
        id: "run-1",
        status: "waiting",
        currentNodeId: "wait-ci",
        nextOwner: {
          kind: "ci",
          id: "github-actions",
        },
        allowedTransitionCount: 1,
      },
    ]);
  });

  it("rejects impossible terminal and rewrite transitions", () => {
    expect(() =>
      normalizeNexusGitWorkflowRun(
        minimalRun({
          status: "completed",
          terminalOutcome: null,
        }),
      ),
    ).toThrow(/terminalOutcome is required for terminal status completed/);

    expect(() =>
      normalizeNexusGitWorkflowRun(
        minimalRun({
          status: "working",
          terminalOutcome: "completed",
        }),
      ),
    ).toThrow(/terminalOutcome requires a terminal status/);

    expect(() =>
      normalizeNexusGitWorkflowRun(
        minimalRun({
          status: "merged",
          terminalOutcome: "merged",
          allowedTransitions: [
            {
              id: "resume",
              to: "working",
              summary: "Resume after merge.",
            },
          ],
        }),
      ),
    ).toThrow(/terminal runs must not have allowed transitions/);

    expect(() =>
      normalizeNexusGitWorkflowRun(
        minimalRun({
          allowedTransitions: [
            {
              id: "teleport",
              to: "teleport",
              summary: "Invalid transition target.",
            },
          ],
        }),
      ),
    ).toThrow(/must be a known run status/);
  });
});
