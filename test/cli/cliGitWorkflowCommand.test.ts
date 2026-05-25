import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import {
  createNexusGitWorkflowRun,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  updateNexusGitWorkflowRun,
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

function captureOutput() {
  let output = "";
  return {
    writer: {
      write(chunk: string): boolean {
        output += chunk;
        return true;
      },
    },
    output: () => output,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("git-workflow CLI", () => {
  it("prints a read-only JSON plan for a direct profile", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-git-workflow-plan-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig("direct-protected", "direct"));
    const output = captureOutput();

    const exitCode = await main(
      [
        "git-workflow",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--profile",
        "direct-protected",
        "--work-item",
        "github-356",
        "--repository-path",
        sourceRoot,
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner: readOnlyGitRunner(),
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      result: {
        mode: "plan",
        mutates: false,
        profile: {
          id: "direct-protected",
          branchStrategy: "direct",
        },
        refs: {
          baseRef: "origin/main",
          targetBranch: "main",
        },
      },
    });
    expect(payload.result.allowedNextCommands).toContainEqual(
      expect.objectContaining({
        id: "prepare-worktree",
        command: expect.stringContaining("worktree prepare"),
      }),
    );
  });

  it("prints concise text status for a recorded feature-branch run", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-git-workflow-status-");
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
      now: "2026-05-25T10:00:00.000Z",
    });
    const output = captureOutput();

    const exitCode = await main(
      [
        "git-workflow",
        "status",
        projectRoot,
        "--component",
        "primary",
        "--run",
        "run-1",
        "--repository-path",
        sourceRoot,
      ],
      {
        stdout: output.writer,
        gitRunner: readOnlyGitRunner("feat/git-workflows/plan-status"),
      },
    );

    expect(exitCode).toBe(0);
    expect(output.output()).toContain("DevNexus Git workflow status.");
    expect(output.output()).toContain("Run: run-1 status=working");
    expect(output.output()).toContain("Profile: feature-delivery (feature_branch)");
    expect(output.output()).toContain("Next owner: agent/codex");
  });

  it("starts a workflow and reports the prepared worktree and run", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-git-workflow-start-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig("direct-protected", "direct"));
    const output = captureOutput();

    const exitCode = await main(
      [
        "git-workflow",
        "start",
        projectRoot,
        "--component",
        "primary",
        "--profile",
        "direct-protected",
        "--work-item",
        "github-357",
        "--work-item-title",
        "Start workflows",
        "--branch",
        "codex/primary/github-357-start",
        "--worktree-name",
        "workflow-start",
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner: startGitRunner(),
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      result: {
        profile: {
          id: "direct-protected",
          branchStrategy: "direct",
        },
        preparedWorktree: {
          worktree: {
            branchName: "codex/primary/github-357-start",
            baseRef: "origin/main",
            resolvedBaseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
        run: {
          profileId: "direct-protected",
          branchStrategy: "direct",
          workItemId: "github-357",
          baseRef: "origin/main",
          baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    });
  });

  it("advances a recorded workflow run from provider evidence", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-git-workflow-advance-");
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
      branchStrategy: "feature_branch",
      workItemId: "github-360",
      branchName: "feat/git-workflows/advance",
      currentRef: "feat/git-workflows/advance",
      baseRef: "origin/main",
      targetBranch: "main",
      owner: {
        kind: "provider",
        id: "github",
      },
      now: "2026-05-25T10:00:00.000Z",
    });
    updateNexusGitWorkflowRun({
      projectRoot: sourceRoot,
      id: "run-1",
      status: "waiting",
      owner: {
        kind: "provider",
        id: "github",
      },
      now: "2026-05-25T10:05:00.000Z",
    });
    const output = captureOutput();

    const exitCode = await main(
      [
        "git-workflow",
        "advance",
        projectRoot,
        "--component",
        "primary",
        "--run",
        "run-1",
        "--repository-path",
        sourceRoot,
        "--provider-review",
        "approved",
        "--required-checks",
        "passed",
        "--base-status",
        "up_to_date",
        "--mergeable",
        "mergeable",
        "--validation-mode",
        "strict_checks",
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner: readOnlyGitRunner("feat/git-workflows/advance"),
        now: fixedClock("2026-05-25T10:10:00.000Z"),
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      result: {
        decision: {
          action: "handoff",
          status: "waiting",
          nextOwner: {
            kind: "human",
            id: null,
          },
        },
        runAfter: {
          status: "waiting",
          nextOwner: {
            kind: "human",
            id: null,
          },
        },
      },
    });
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

function readOnlyGitRunner(currentBranch = "main"): GitRunner {
  return (args) => gitResult([...args], currentBranch);
}

function startGitRunner(): GitRunner {
  return (args, cwd) => {
    const argsArray = [...args];
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      const worktreePath = argsArray.includes("-b") ? argsArray[4]! : argsArray[2]!;
      fs.mkdirSync(path.join(worktreePath, ".git"), { recursive: true });
      return success(argsArray, "");
    }
    if (
      argsArray[0] === "show-ref" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet"
    ) {
      return {
        args: argsArray,
        stdout: "",
        stderr: "not found",
        exitCode: 1,
      };
    }
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--abbrev-ref" &&
      argsArray[2] === "--symbolic-full-name" &&
      argsArray[3]?.endsWith("@{upstream}")
    ) {
      return {
        args: argsArray,
        stdout: "",
        stderr: "not found",
        exitCode: 1,
      };
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return success(argsArray, path.join(cwd ?? "", ".git", "info", "exclude"));
    }
    if (argsArray[0] === "for-each-ref") {
      return success(argsArray, "");
    }
    return gitResult(argsArray, "main");
  };
}

function gitResult(args: string[], currentBranch: string): GitCommandResult {
  if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
    return success(args, `${currentBranch}\n`);
  }
  if (args.join(" ") === "rev-parse HEAD") {
    return success(args, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n");
  }
  if (args.join(" ") === "rev-parse --verify --quiet origin/main^{commit}") {
    return success(args, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
  }
  if (args.join(" ") === "status --short --branch") {
    return success(args, `## ${currentBranch}\n`);
  }
  return {
    args,
    stdout: "",
    stderr: "not found",
    exitCode: 1,
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

function fixedClock(value: string): () => string {
  return () => value;
}
