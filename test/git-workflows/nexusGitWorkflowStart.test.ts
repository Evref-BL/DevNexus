import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  readNexusGitWorkflowRunStore,
  saveProjectConfig,
  startNexusGitWorkflow,
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
  for (const tempDir of tempDirs.splice(0).reverse()) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus Git workflow start", () => {
  it("prepares a worktree and records the initial workflow run", () => {
    const { projectRoot, calls } = prepareProject();

    const result = startNexusGitWorkflow({
      projectRoot,
      componentId: "primary",
      profileId: "protected-main",
      workItemId: "github-357",
      workItemTitle: "Start workflow runs",
      branchName: "codex/primary/github-357-start",
      worktreeName: "workflow-start",
      gitRunner: fakeGitRunner(calls),
      now: () => "2026-05-25T10:00:00.000Z",
    });

    expect(result.prepared.worktree).toMatchObject({
      branchName: "codex/primary/github-357-start",
      baseRef: "origin/main",
      requestedBaseRef: "origin/main",
      resolvedBaseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.run).toMatchObject({
      projectId: "demo-project",
      componentId: "primary",
      profileId: "protected-main",
      branchStrategy: "direct",
      workItemId: "github-357",
      branchName: "codex/primary/github-357-start",
      baseRef: "origin/main",
      baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      targetBranch: "main",
      owner: {
        kind: "agent",
        id: null,
      },
      nodes: [
        expect.objectContaining({
          id: "start",
          kind: "action",
        }),
      ],
    });
    expect(readNexusGitWorkflowRunStore(result.prepared.worktree.worktreePath).runs)
      .toContainEqual(expect.objectContaining({ id: result.run.id }));
    expect(calls).toContainEqual(
      expect.objectContaining({
        args: ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"],
      }),
    );
    expect(calls).not.toContainEqual(
      expect.objectContaining({
        args: ["rev-parse", "--verify", "--quiet", "main^{commit}"],
      }),
    );
  });

  it("honors an explicit base ref instead of blocking on the workflow default", () => {
    const { projectRoot, calls } = prepareProject();

    const result = startNexusGitWorkflow({
      projectRoot,
      componentId: "primary",
      profileId: "protected-main",
      workItemId: "github-357",
      branchName: "codex/primary/github-357-release",
      worktreeName: "workflow-start-release",
      baseRef: "release/v1",
      gitRunner: fakeGitRunner(calls, {
        "release/v1": "cccccccccccccccccccccccccccccccccccccccc",
      }),
      now: () => "2026-05-25T10:00:00.000Z",
    });

    expect(result.prepared.worktree).toMatchObject({
      baseRef: "release/v1",
      resolvedBaseCommit: "cccccccccccccccccccccccccccccccccccccccc",
    });
    expect(result.run).toMatchObject({
      baseRef: "release/v1",
      baseCommit: "cccccccccccccccccccccccccccccccccccccccc",
    });
  });
});

function prepareProject(): {
  projectRoot: string;
  calls: Array<{ args: string[]; cwd?: string }>;
} {
  const projectRoot = makeTempDir("dev-nexus-git-workflow-start-");
  fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
  saveProjectConfig(projectRoot, projectConfig());
  return { projectRoot, calls: [] };
}

function projectConfig(): NexusProjectConfig {
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
        worktreesRoot: "worktrees/primary",
        relationships: [],
      },
    ],
    automation: {
      ...defaultNexusAutomationConfig,
      setup: {
        dependencyLinks: [],
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        remote: "origin",
        targetBranch: "main",
      },
      gitWorkflows: {
        activeProfileId: "protected-main",
        profiles: [
          {
            id: "protected-main",
            branchStrategy: "direct",
            targetBranch: "main",
          },
        ],
      },
    },
  };
}

function fakeGitRunner(
  calls: Array<{ args: string[]; cwd?: string }>,
  baseCommits: Record<string, string> = {
    "origin/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    main: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      const worktreePath = argsArray.includes("-b") ? argsArray[4]! : argsArray[2]!;
      fs.mkdirSync(path.join(worktreePath, ".git"), { recursive: true });
    }
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet" &&
      argsArray[3]?.endsWith("^{commit}")
    ) {
      const ref = argsArray[3].replace(/\^\{commit\}$/u, "");
      const commit = baseCommits[ref];
      return commit ? success(argsArray, `${commit}\n`) : failure(argsArray);
    }
    if (
      argsArray[0] === "show-ref" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet"
    ) {
      return failure(argsArray);
    }
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--abbrev-ref" &&
      argsArray[2] === "--symbolic-full-name" &&
      argsArray[3]?.endsWith("@{upstream}")
    ) {
      return failure(argsArray);
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return success(argsArray, path.join(cwd ?? "", ".git", "info", "exclude"));
    }
    return success(argsArray, "");
  };
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
