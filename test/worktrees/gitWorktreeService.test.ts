import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitWorktreeServiceError,
  type GitCommandResult,
  type GitRunner,
  normalizeBranchName,
  prepareGitWorktree,
  removeGitWorktree,
  safeDirectoryName,
} from "../../src/worktrees/gitWorktreeService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "for-each-ref") {
      return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
    }
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      const pathArgument = argsArray[2] === "-b" ? argsArray[4] : argsArray[2];
      fs.mkdirSync(pathArgument!, { recursive: true });
    }
    if (argsArray[0] === "worktree" && argsArray[1] === "remove") {
      fs.rmSync(argsArray[2], { recursive: true, force: true });
    }

    return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("git worktree service", () => {
  it("prepares a branch-backed worktree under the worktrees root", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = prepareGitWorktree({
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      branchName: "codex/demo/FCD-1",
      baseRef: "main",
      workItemId: "local-7",
      workItemTitle: "Support component-scoped parallel worktree records",
      gitRunner: fakeGitRunner(calls),
    });

    const expectedWorktreePath = path.join(
      worktreesRoot,
      "codex-demo-fcd-1",
    );
    expect(result).toMatchObject({
      sourceRoot,
      worktreesRoot,
      worktreePath: expectedWorktreePath,
      componentId: "core",
      branchName: "codex/demo/FCD-1",
      baseRef: "main",
      workItem: {
        id: "local-7",
        title: "Support component-scoped parallel worktree records",
      },
    });
    expect(calls).toEqual([
      {
        cwd: sourceRoot,
        args: [
          "for-each-ref",
          "--format=%(refname)",
          "refs/heads/codex/demo/FCD-1",
        ],
      },
      {
        cwd: sourceRoot,
        args: [
          "worktree",
          "add",
          "-b",
          "codex/demo/FCD-1",
          expectedWorktreePath,
          "main",
        ],
      },
    ]);
  });

  it("adopts an existing local branch when it is not checked out", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const branchName = "codex/demo/existing-branch";

    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      calls.push({ args: argsArray, cwd });
      if (argsArray.join(" ") === `for-each-ref --format=%(refname) refs/heads/${branchName}`) {
        return {
          args: argsArray,
          stdout: `refs/heads/${branchName}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (argsArray.join(" ") === "worktree list --porcelain") {
        return {
          args: argsArray,
          stdout: [
            `worktree ${sourceRoot}`,
            "HEAD 1111111111111111111111111111111111111111",
            "branch refs/heads/main",
            "",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        argsArray[0] === "worktree" &&
        argsArray[1] === "add" &&
        argsArray[2] !== "-b"
      ) {
        fs.mkdirSync(argsArray[2]!, { recursive: true });
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }

      return {
        args: argsArray,
        stdout: "",
        stderr: `fatal: a branch named '${branchName}' already exists`,
        exitCode: 128,
      };
    };

    const result = prepareGitWorktree({
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      branchName,
      baseRef: "main",
      gitRunner,
    });

    expect(result.worktreePath).toBe(
      path.join(worktreesRoot, "codex-demo-existing-branch"),
    );
    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: ["worktree", "add", result.worktreePath, branchName],
    });
  });

  it("reports the reusable worktree when an existing branch is already checked out", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    const existingWorktree = path.join(worktreesRoot, "already-open");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const branchName = "codex/demo/already-open";

    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      calls.push({ args: argsArray, cwd });
      if (argsArray.join(" ") === `for-each-ref --format=%(refname) refs/heads/${branchName}`) {
        return {
          args: argsArray,
          stdout: `refs/heads/${branchName}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (argsArray.join(" ") === "worktree list --porcelain") {
        return {
          args: argsArray,
          stdout: [
            `worktree ${sourceRoot}`,
            "HEAD 1111111111111111111111111111111111111111",
            "branch refs/heads/main",
            "",
            `worktree ${existingWorktree}`,
            "HEAD 2222222222222222222222222222222222222222",
            `branch refs/heads/${branchName}`,
            "",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }

      return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
    };

    expect(() =>
      prepareGitWorktree({
        componentId: "core",
        sourceRoot,
        worktreesRoot,
        branchName,
        baseRef: "main",
        gitRunner,
      }),
    ).toThrow(new RegExp(`already checked out.*${existingWorktree.replaceAll("\\", "\\\\")}`, "u"));
    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: ["worktree", "list", "--porcelain"],
    });
    expect(calls.some((call) =>
      call.args[0] === "worktree" && call.args[1] === "add"
    )).toBe(false);
  });

  it("sets repo-local Git identity when a prepared identity is provided", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = prepareGitWorktree({
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      branchName: "codex/demo/local-154",
      gitIdentity: {
        name: "Example Bot",
        email: "bot@example.invalid",
      },
      gitRunner: fakeGitRunner(calls),
    });

    expect(result.gitIdentity).toEqual({
      name: "Example Bot",
      email: "bot@example.invalid",
    });
    expect(calls).toEqual([
      {
        cwd: sourceRoot,
        args: [
          "for-each-ref",
          "--format=%(refname)",
          "refs/heads/codex/demo/local-154",
        ],
      },
      {
        cwd: sourceRoot,
        args: [
          "worktree",
          "add",
          "-b",
          "codex/demo/local-154",
          result.worktreePath,
        ],
      },
      {
        cwd: result.worktreePath,
        args: ["config", "--local", "user.name", "Example Bot"],
      },
      {
        cwd: result.worktreePath,
        args: ["config", "--local", "user.email", "bot@example.invalid"],
      },
    ]);
  });

  it("uses an explicit worktree name and removes worktrees", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner = fakeGitRunner(calls);

    const prepared = prepareGitWorktree({
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      branchName: "feature/one",
      worktreeName: "explicit-name",
      gitRunner,
    });
    const removed = removeGitWorktree({
      sourceRoot,
      worktreePath: prepared.worktreePath,
      gitRunner,
    });

    expect(prepared.worktreePath).toBe(path.join(worktreesRoot, "explicit-name"));
    expect(removed.git.commands.at(-1)).toMatchObject({
      args: ["worktree", "remove", prepared.worktreePath],
    });
    expect(fs.existsSync(prepared.worktreePath)).toBe(false);
  });

  it("normalizes names and rejects unsafe branch or worktree paths", () => {
    expect(normalizeBranchName(" feature\\one ")).toBe("feature/one");
    expect(safeDirectoryName("Feature/FCD 42")).toBe("feature-fcd-42");
    expect(() => normalizeBranchName("../bad")).toThrow(
      GitWorktreeServiceError,
    );

    const sourceRoot = makeTempDir("dev-nexus-source-");
    const worktreesRoot = makeTempDir("dev-nexus-worktrees-");
    expect(() =>
      prepareGitWorktree({
        componentId: "core",
        sourceRoot,
        worktreesRoot,
        branchName: "feature/one",
        worktreeName: "..",
        gitRunner: fakeGitRunner([]),
      }),
    ).toThrow(/worktreeName/);
    expect(() =>
      prepareGitWorktree({
        componentId: "core",
        sourceRoot,
        worktreesRoot,
        branchName: "feature/one",
        worktreeName: "nested/feature",
        gitRunner: fakeGitRunner([]),
      }),
    ).toThrow(/worktreeName/);
  });
});
