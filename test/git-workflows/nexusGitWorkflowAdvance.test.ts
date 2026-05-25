import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceNexusGitWorkflowRun,
  createNexusGitWorkflowRun,
  defaultNexusAutomationConfig,
  readNexusGitWorkflowRunStore,
  saveProjectConfig,
  updateNexusGitWorkflowRun,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus Git workflow advance", () => {
  it("advances provider-approved runs to a final human publication gate", () => {
    const fixture = initAdvanceFixture();
    createRun(fixture.sourceRoot, {
      status: "waiting",
      owner: {
        kind: "provider",
        id: "github",
      },
    });

    const result = advanceNexusGitWorkflowRun({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      repositoryPath: fixture.sourceRoot,
      runId: "run-1",
      provider: {
        review: "approved",
        requiredChecks: "passed",
        baseStatus: "up_to_date",
        mergeable: "mergeable",
        validationMode: "strict_checks",
      },
      now: "2026-05-25T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      mutates: true,
      decision: {
        action: "handoff",
        status: "waiting",
        nextOwner: {
          kind: "human",
          id: null,
        },
        humanGates: ["human_approval", "publication_authority"],
        blockers: [],
        reasons: expect.arrayContaining([
          "Provider review is approved.",
          "Required checks passed.",
          "Final publication requires human approval or explicit authority.",
        ]),
      },
      runAfter: {
        status: "waiting",
        nextOwner: {
          kind: "human",
          id: null,
        },
      },
    });
    expect(readNexusGitWorkflowRunStore(fixture.sourceRoot).runs[0])
      .toMatchObject({
        status: "waiting",
        owner: {
          kind: "human",
          id: null,
        },
        evidence: expect.arrayContaining([
          expect.objectContaining({
            id: "provider-review",
            summary: "Provider review is approved.",
          }),
          expect.objectContaining({
            id: "required-checks",
            summary: "Required checks passed.",
          }),
        ]),
      });
  });

  it("blocks failed checks before suggesting publication or branch updates", () => {
    const fixture = initAdvanceFixture();
    createRun(fixture.sourceRoot, {
      status: "waiting",
      owner: {
        kind: "ci",
        id: "github-actions",
      },
    });

    const result = advanceNexusGitWorkflowRun({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      repositoryPath: fixture.sourceRoot,
      runId: "run-1",
      provider: {
        review: "approved",
        requiredChecks: "failed",
        baseStatus: "up_to_date",
        mergeable: "mergeable",
        validationMode: "strict_checks",
      },
      now: "2026-05-25T12:05:00.000Z",
    });

    expect(result).toMatchObject({
      decision: {
        action: "block",
        status: "blocked",
        nextOwner: {
          kind: "agent",
          id: null,
        },
        blockers: ["Required checks failed."],
      },
      runAfter: {
        status: "blocked",
      },
    });
  });

  it("hands off stale branch updates unless Git mutation authority is supplied", () => {
    const fixture = initAdvanceFixture();
    createRun(fixture.sourceRoot, {
      status: "waiting",
      owner: {
        kind: "agent",
        id: "codex",
      },
    });

    const result = advanceNexusGitWorkflowRun({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      repositoryPath: fixture.sourceRoot,
      runId: "run-1",
      provider: {
        review: "approved",
        requiredChecks: "passed",
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "strict_checks",
      },
      now: "2026-05-25T12:10:00.000Z",
    });

    expect(result).toMatchObject({
      branchFreshness: {
        freshness: "behind",
        action: "merge",
        command:
          "git checkout feat/git-workflows/change && git merge --no-ff origin/main && git push origin feat/git-workflows/change",
      },
      decision: {
        action: "handoff",
        status: "waiting",
        nextOwner: {
          kind: "human",
          id: null,
        },
        blockers: ["Branch update requires Git mutation authority: merge."],
        commands: [
          "git checkout feat/git-workflows/change && git merge --no-ff origin/main && git push origin feat/git-workflows/change",
        ],
      },
    });
  });

  it("requires human force-with-lease approval for public rebase updates", () => {
    const fixture = initAdvanceFixture({
      update: {
        diverged: "rebase",
        publicRewrite: "with_human_approval",
      },
    });
    createRun(fixture.sourceRoot, {
      status: "waiting",
      owner: {
        kind: "agent",
        id: "codex",
      },
    });

    const result = advanceNexusGitWorkflowRun({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      repositoryPath: fixture.sourceRoot,
      runId: "run-1",
      authority: {
        gitMutation: true,
      },
      provider: {
        review: "approved",
        requiredChecks: "passed",
        baseStatus: "diverged",
        mergeable: "mergeable",
        validationMode: "strict_checks",
      },
      now: "2026-05-25T12:15:00.000Z",
    });

    expect(result).toMatchObject({
      branchFreshness: {
        action: "rebase",
        forceWithLeaseRequired: true,
        hitlRequired: true,
      },
      decision: {
        action: "handoff",
        status: "waiting",
        nextOwner: {
          kind: "human",
          id: null,
        },
        humanGates: ["public_history_rewrite"],
        blockers: [
          "Branch update requires force-with-lease approval before rebase.",
        ],
      },
    });
  });

  it("hands off provider actions when provider-write authority is missing", () => {
    const fixture = initAdvanceFixture({ branchStrategy: "direct" });
    createRun(fixture.sourceRoot, {
      status: "waiting",
      owner: {
        kind: "agent",
        id: "codex",
      },
    });

    const result = advanceNexusGitWorkflowRun({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      repositoryPath: fixture.sourceRoot,
      runId: "run-1",
      provider: {
        review: "approved",
        requiredChecks: "passed",
        baseStatus: "behind",
        mergeable: "mergeable",
        validationMode: "merge_queue",
        mergeQueue: "available",
      },
      now: "2026-05-25T12:18:00.000Z",
    });

    expect(result).toMatchObject({
      branchFreshness: {
        action: "none",
        providerAction: "enter_merge_queue",
      },
      decision: {
        action: "handoff",
        status: "waiting",
        nextOwner: {
          kind: "human",
          id: null,
        },
        blockers: [
          "Provider action requires provider-write authority: enter_merge_queue.",
        ],
        providerActions: ["enter_merge_queue"],
      },
    });
  });

  it("records terminal completion when publication completion evidence is present", () => {
    const fixture = initAdvanceFixture();
    createRun(fixture.sourceRoot, {
      status: "waiting",
      owner: {
        kind: "human",
        id: "maintainer",
      },
    });

    const result = advanceNexusGitWorkflowRun({
      projectRoot: fixture.projectRoot,
      componentId: "primary",
      repositoryPath: fixture.sourceRoot,
      runId: "run-1",
      provider: {
        review: "approved",
        requiredChecks: "passed",
        baseStatus: "up_to_date",
        mergeable: "mergeable",
        validationMode: "strict_checks",
        publication: "completed",
      },
      now: "2026-05-25T12:20:00.000Z",
    });

    expect(result).toMatchObject({
      decision: {
        action: "complete",
        status: "completed",
        nextOwner: {
          kind: "none",
          id: null,
        },
      },
      runAfter: {
        status: "completed",
        terminalOutcome: "completed",
      },
    });
  });
});

function initAdvanceFixture(
  options: {
    branchStrategy?: "feature_branch" | "direct";
    update?: {
      diverged?: string;
      publicRewrite?: string;
    };
  } = {},
): { projectRoot: string; sourceRoot: string } {
  const projectRoot = makeTempDir("dev-nexus-git-workflow-advance-");
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
  saveProjectConfig(projectRoot, projectConfig(options));
  return { projectRoot, sourceRoot };
}

function createRun(
  projectRoot: string,
  options: {
    status: "waiting";
    owner: {
      kind: "agent" | "ci" | "human" | "provider";
      id: string | null;
    };
  },
): void {
  createNexusGitWorkflowRun({
    projectRoot,
    id: "run-1",
    projectId: "demo-project",
    componentId: "primary",
    profileId: "feature-delivery",
    branchStrategy: "feature_branch",
    workItemId: "github-360",
    branchName: "feat/git-workflows/change",
    currentRef: "feat/git-workflows/change",
    baseRef: "origin/main",
    baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    targetBranch: "main",
    owner: options.owner,
    now: "2026-05-25T11:00:00.000Z",
  });
  if (options.status === "waiting") {
    updateNexusGitWorkflowRun({
      projectRoot,
      id: "run-1",
      status: "waiting",
      owner: options.owner,
      now: "2026-05-25T11:30:00.000Z",
    });
  }
}

function projectConfig(
  options: {
    branchStrategy?: "feature_branch" | "direct";
    update?: {
      diverged?: string;
      publicRewrite?: string;
    };
  },
): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "primary",
        name: "Primary",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/project.git",
        defaultBranch: "main",
        sourceRoot: "source",
        relationships: [],
      },
    ],
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        remote: "origin",
        targetBranch: "main",
      },
      gitWorkflows: {
        activeProfileId: "feature-delivery",
        profiles: [
          {
            id: "feature-delivery",
            branchStrategy: options.branchStrategy ?? "feature_branch",
            targetBranch: "main",
            review: {
              mode: "review_branch_pr",
              finalPullRequest: true,
            },
            update: {
              behind: "merge",
              diverged: options.update?.diverged ?? "block",
              wrongBase: "recreate",
              publicRewrite: options.update?.publicRewrite ?? "with_human_approval",
            },
            gates: {
              start: [],
              review: ["provider_review", "required_checks"],
              publication: [
                "human_approval",
                "provider_review",
                "required_checks",
                "publication_authority",
              ],
              cleanup: ["manual_cleanup"],
            },
          },
        ],
      },
    },
  };
}
