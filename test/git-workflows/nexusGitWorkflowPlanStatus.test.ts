import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusGitWorkflowPlan,
  buildNexusGitWorkflowStatus,
  createNexusGitWorkflowRun,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
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

describe("nexus Git workflow plan and status", () => {
  it("plans a direct workflow without mutating Git or runtime state", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-plan-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig("direct-protected", "direct"));
    const git = readOnlyGitRunner({
      currentBranch: "main",
      currentCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      baseCommits: {
        "origin/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      status: "## main...origin/main\n",
    });

    const plan = buildNexusGitWorkflowPlan({
      projectRoot,
      componentId: "primary",
      profileId: "direct-protected",
      workItemId: "github-356",
      repositoryPath: sourceRoot,
      gitRunner: git.runner,
    });

    expect(plan).toMatchObject({
      mode: "plan",
      mutates: false,
      profile: {
        id: "direct-protected",
        branchStrategy: "direct",
      },
      decisionGraph: {
        id: "builtin:direct",
        template: "direct",
        currentNode: {
          id: "observe",
          kind: "observation",
        },
        allowedTransitions: expect.arrayContaining([
          expect.objectContaining({
            id: "prepare-worktree",
            from: "observe",
            to: "prepare-worktree",
            missingEvidence: [],
            authority: expect.arrayContaining(["git_mutation"]),
          }),
        ]),
        missingEvidence: [],
        nextOwner: {
          kind: "agent",
          id: null,
        },
      },
      refs: {
        baseRef: "origin/main",
        baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetBranch: "main",
        currentBranch: "main",
      },
      nextOwner: {
        kind: "agent",
        id: null,
      },
      blockers: [],
    });
    expect(plan.evidence).toContainEqual(
      expect.objectContaining({
        id: "base-ref",
        status: "present",
      }),
    );
    expect(plan.allowedNextCommands).toContainEqual(
      expect.objectContaining({
        id: "prepare-worktree",
        mutates: true,
        command: expect.stringContaining("--base-ref origin/main"),
      }),
    );
    expect(fs.existsSync(path.join(sourceRoot, ".git", "dev-nexus"))).toBe(false);
    expect(git.commands.map((command) => command.args[0])).toEqual([
      "rev-parse",
      "rev-parse",
      "rev-parse",
      "status",
    ]);
  });

  it("reports a feature-branch workflow status from a recorded run and fresh Git facts", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-status-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig("feature-delivery", "feature_branch", {
        activeFeatureId: "git-workflows",
      }),
    );
    createNexusGitWorkflowRun({
      projectRoot: sourceRoot,
      id: "run-1",
      projectId: "demo-project",
      componentId: "primary",
      profileId: "feature-delivery",
      workItemId: "github-356",
      branchName: "feat/git-workflows/plan-status",
      currentRef: "feat/git-workflows/plan-status",
      baseRef: "origin/main",
      targetBranch: "main",
      owner: {
        kind: "agent",
        id: "codex",
      },
      nodes: [
        {
          id: "wait-for-review",
          kind: "gate",
          summary: "Waiting for provider review.",
          recordedAt: "2026-05-25T10:05:00.000Z",
        },
      ],
      now: "2026-05-25T10:00:00.000Z",
    });
    const updatedRun = buildNexusGitWorkflowStatus({
      projectRoot,
      componentId: "primary",
      workItemId: "github-356",
      branchName: "feat/git-workflows/plan-status",
      repositoryPath: sourceRoot,
      gitRunner: readOnlyGitRunner({
        currentBranch: "feat/git-workflows/plan-status",
        currentCommit: "cccccccccccccccccccccccccccccccccccccccc",
        baseCommits: {
          "origin/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        status: "## feat/git-workflows/plan-status...origin/feat/git-workflows/plan-status\n",
      }).runner,
    });

    expect(updatedRun).toMatchObject({
      mode: "status",
      mutates: false,
      profile: {
        id: "feature-delivery",
        branchStrategy: "feature_branch",
        activeFeatureId: "git-workflows",
      },
      run: {
        id: "run-1",
        status: "working",
        workItemId: "github-356",
        branchName: "feat/git-workflows/plan-status",
        currentNodeId: "wait-for-review",
      },
      decisionGraph: {
        id: "builtin:feature_branch",
        currentNode: {
          id: "wait-for-review",
          kind: "gate",
        },
        allowedTransitions: expect.arrayContaining([
          expect.objectContaining({
            id: "checks-after-review",
            from: "wait-for-review",
            missingEvidence: ["provider-review"],
            nextOwner: {
              kind: "provider",
              id: null,
            },
          }),
        ]),
        missingEvidence: ["provider-review"],
      },
      refs: {
        baseRef: "origin/main",
        baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        currentBranch: "feat/git-workflows/plan-status",
      },
      nextOwner: {
        kind: "agent",
        id: "codex",
      },
      blockers: [],
    });
    expect(updatedRun.allowedNextCommands).toContainEqual(
      expect.objectContaining({
        id: "refresh-status",
        mutates: false,
        command: expect.stringContaining("git-workflow status"),
      }),
    );
  });

  it("attaches provider pull request evidence to status decisions", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-provider-status-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig("feature-delivery", "feature_branch", {
        activeFeatureId: "git-workflows",
      }),
    );
    createNexusGitWorkflowRun({
      projectRoot: sourceRoot,
      id: "run-1",
      projectId: "demo-project",
      componentId: "primary",
      profileId: "feature-delivery",
      workItemId: "github-383",
      branchName: "feat/git-workflows/provider-evidence",
      currentRef: "feat/git-workflows/provider-evidence",
      baseRef: "origin/main",
      targetBranch: "main",
      owner: {
        kind: "provider",
        id: "github",
      },
      nodes: [
        {
          id: "wait-for-review",
          kind: "gate",
          summary: "Waiting for provider review.",
          recordedAt: "2026-05-25T10:05:00.000Z",
        },
      ],
      now: "2026-05-25T10:00:00.000Z",
    });

    const status = buildNexusGitWorkflowStatus({
      projectRoot,
      componentId: "primary",
      runId: "run-1",
      repositoryPath: sourceRoot,
      providerEvidence: {
        requested: true,
        status: "attached",
        summary: "Attached provider evidence from pull request #12.",
        pullRequest: {
          number: 12,
          url: "https://github.com/example/project/pull/12",
          state: "open",
          title: "Provider evidence",
        },
        evidence: {
          provider: "github",
          sourceKind: "pull_request",
          reviewTarget: {
            kind: "pull_request",
            number: 12,
            url: "https://github.com/example/project/pull/12",
            title: "Provider evidence",
          },
          headBranch: "feat/git-workflows/provider-evidence",
          headSha: "cccccccccccccccccccccccccccccccccccccccc",
          targetBranch: "main",
          reviewState: "approved",
          checks: [
            {
              name: "Node 22 check",
              status: "success",
              conclusion: "success",
            },
          ],
          mergeability: "mergeable",
          baseStatus: "current",
          metadata: {
            mergeQueue: "queued",
          },
        },
      },
      gitRunner: readOnlyGitRunner({
        currentBranch: "feat/git-workflows/provider-evidence",
        currentCommit: "cccccccccccccccccccccccccccccccccccccccc",
        baseCommits: {
          "origin/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        status: "## feat/git-workflows/provider-evidence\n",
      }).runner,
    });

    expect(status.providerEvidence).toMatchObject({
      requested: true,
      status: "attached",
      pullRequest: {
        number: 12,
      },
      facts: {
        review: "approved",
        requiredChecks: "passed",
        baseStatus: "up_to_date",
        mergeability: "mergeable",
        mergeQueue: "queued",
      },
    });
    expect(status.branchFreshness).toMatchObject({
      freshness: "fresh",
      action: "none",
    });
    expect(status.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "provider-pull-request",
          status: "present",
        }),
        expect.objectContaining({
          id: "provider-review",
          status: "present",
        }),
        expect.objectContaining({
          id: "required-checks",
          status: "present",
        }),
      ]),
    );
    expect(status.evidenceGaps).not.toContain(
      "Provider review evidence has not been attached.",
    );
    expect(status.decisionGraph).toMatchObject({
      allowedTransitions: expect.arrayContaining([
        expect.objectContaining({
          id: "checks-after-review",
          missingEvidence: [],
        }),
      ]),
      missingEvidence: [],
    });
  });

  it("reports a missing provider pull request distinctly", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-missing-pr-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig("feature-delivery", "feature_branch"));

    const status = buildNexusGitWorkflowStatus({
      projectRoot,
      componentId: "primary",
      branchName: "feat/git-workflows/no-pr",
      repositoryPath: sourceRoot,
      providerEvidence: {
        requested: true,
        status: "missing_pull_request",
        summary:
          "No open provider pull request found for feat/git-workflows/no-pr targeting main.",
        pullRequest: null,
        evidence: null,
      },
      gitRunner: readOnlyGitRunner({
        currentBranch: "feat/git-workflows/no-pr",
        currentCommit: "cccccccccccccccccccccccccccccccccccccccc",
        baseCommits: {
          "origin/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        status: "## feat/git-workflows/no-pr\n",
      }).runner,
    });

    expect(status.providerEvidence).toMatchObject({
      requested: true,
      status: "missing_pull_request",
      pullRequest: null,
      facts: null,
    });
    expect(status.evidence).toContainEqual(
      expect.objectContaining({
        id: "provider-pull-request",
        status: "missing",
      }),
    );
    expect(status.evidenceGaps).toContain(
      "No open provider pull request found for feat/git-workflows/no-pr targeting main.",
    );
  });

  it("reports unknown provider states as distinct status facts", () => {
    const projectRoot = makeTempDir("dev-nexus-git-workflow-unknown-provider-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig("feature-delivery", "feature_branch"));

    const status = buildNexusGitWorkflowStatus({
      projectRoot,
      componentId: "primary",
      branchName: "feat/git-workflows/unknown-provider",
      repositoryPath: sourceRoot,
      providerEvidence: {
        requested: true,
        status: "attached",
        summary: "Attached provider evidence from pull request #13.",
        pullRequest: {
          number: 13,
          url: "https://github.com/example/project/pull/13",
          state: "open",
          title: "Unknown provider state",
        },
        evidence: {
          provider: "github",
          sourceKind: "pull_request",
          headBranch: "feat/git-workflows/unknown-provider",
          targetBranch: "main",
          checks: [],
        },
      },
      gitRunner: readOnlyGitRunner({
        currentBranch: "feat/git-workflows/unknown-provider",
        currentCommit: "cccccccccccccccccccccccccccccccccccccccc",
        baseCommits: {
          "origin/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        status: "## feat/git-workflows/unknown-provider\n",
      }).runner,
    });

    expect(status.providerEvidence).toMatchObject({
      status: "attached",
      facts: {
        review: "unknown",
        requiredChecks: "missing",
        baseStatus: "unknown",
        mergeability: "unknown",
        mergeQueue: "unknown",
      },
    });
    expect(status.evidenceGaps).toEqual(
      expect.arrayContaining([
        "Provider review is unknown.",
        "Required checks are missing.",
        "Provider base status is unknown.",
        "Provider mergeability is unknown.",
        "Provider merge queue status is unknown.",
      ]),
    );
  });
});

function projectConfig(
  profileId: string,
  branchStrategy: "direct" | "feature_branch",
  profileOverrides: Record<string, unknown> = {},
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
        greenMain: {
          integrationPreference: "pull_request",
          integrationBranch: null,
          directTargetPush: "blocked",
          mergeAuthority: "handoff",
          requiredChecks: ["Node 22 check"],
          staleChecks: "block",
        },
      },
      gitWorkflows: {
        activeProfileId: profileId,
        profiles: [
          {
            id: profileId,
            branchStrategy,
            targetBranch: "main",
            ...profileOverrides,
          },
        ],
      },
    },
  };
}

function readOnlyGitRunner(options: {
  currentBranch: string;
  currentCommit: string;
  baseCommits: Record<string, string>;
  status: string;
}): { runner: GitRunner; commands: GitCommandResult[] } {
  const commands: GitCommandResult[] = [];
  const runner: GitRunner = (args) => {
    const command = [...args];
    const result = gitResult(command, options);
    commands.push(result);
    return result;
  };
  return { runner, commands };
}

function gitResult(
  args: string[],
  options: {
    currentBranch: string;
    currentCommit: string;
    baseCommits: Record<string, string>;
    status: string;
  },
): GitCommandResult {
  if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
    return success(args, `${options.currentBranch}\n`);
  }
  if (args.join(" ") === "rev-parse HEAD") {
    return success(args, `${options.currentCommit}\n`);
  }
  if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "--quiet") {
    const ref = args[3]?.replace(/\^\{commit\}$/u, "") ?? "";
    const commit = options.baseCommits[ref];
    return commit ? success(args, `${commit}\n`) : failure(args);
  }
  if (args.join(" ") === "status --short --branch") {
    return success(args, options.status);
  }
  return failure(args);
}

function success(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function failure(args: string[]): GitCommandResult {
  return {
    args,
    stdout: "",
    stderr: "not found",
    exitCode: 1,
  };
}
