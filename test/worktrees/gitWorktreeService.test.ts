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
const defaultBaseCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet" &&
      argsArray[3]?.endsWith("^{commit}")
    ) {
      const ref = argsArray[3].slice(0, -"^{commit}".length);
      const commit = /^[0-9a-f]{40}$/iu.test(ref) ? ref : defaultBaseCommit;
      return { args: argsArray, stdout: `${commit}\n`, stderr: "", exitCode: 0 };
    }
    if (
      argsArray[0] === "show-ref" &&
      argsArray[1] === "--verify" &&
      argsArray[2] === "--quiet"
    ) {
      return {
        args: argsArray,
        stdout: "",
        stderr: "",
        exitCode:
          argsArray[3] === "refs/heads/main" ||
          argsArray[3] === "refs/heads/feature/parent"
            ? 0
            : 1,
      };
    }
    if (
      argsArray.join(" ") ===
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}"
    ) {
      return { args: argsArray, stdout: "", stderr: "", exitCode: 1 };
    }
    if (
      argsArray.join(" ") ===
      "rev-parse --abbrev-ref --symbolic-full-name feature/parent@{upstream}"
    ) {
      return { args: argsArray, stdout: "", stderr: "", exitCode: 1 };
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
      requestedBaseRef: "main",
      resolvedBaseCommit: defaultBaseCommit,
      baseRefKind: "branch",
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
        args: ["show-ref", "--verify", "--quiet", "refs/heads/main"],
      },
      {
        cwd: sourceRoot,
        args: [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "main@{upstream}",
        ],
      },
      {
        cwd: sourceRoot,
        args: ["rev-parse", "--verify", "--quiet", "main^{commit}"],
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

  it("records an explicit branch base and resolved commit before creating the worktree", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = prepareGitWorktree({
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      branchName: "codex/demo/child",
      baseRef: "feature/parent",
      gitRunner: fakeGitRunner(calls),
    });

    expect(result).toMatchObject({
      baseRef: "feature/parent",
      requestedBaseRef: "feature/parent",
      resolvedBaseCommit: defaultBaseCommit,
      baseRefKind: "branch",
      baseRefFreshness: {
        status: "unchecked",
        comparedRef: null,
        comparedCommit: null,
      },
    });
    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: ["rev-parse", "--verify", "--quiet", "feature/parent^{commit}"],
    });
    expect(calls).toContainEqual({
      cwd: sourceRoot,
      args: [
        "worktree",
        "add",
        "-b",
        "codex/demo/child",
        result.worktreePath,
        "feature/parent",
      ],
    });
  });

  it("records a pinned commit base without mutable-ref freshness checks", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const baseCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = prepareGitWorktree({
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      branchName: "codex/demo/pinned-base",
      baseRef: baseCommit,
      gitRunner: fakeGitRunner(calls),
    });

    expect(result).toMatchObject({
      baseRef: baseCommit,
      requestedBaseRef: baseCommit,
      resolvedBaseCommit: baseCommit,
      baseRefKind: "commit",
      baseRefFreshness: {
        status: "immutable",
        comparedRef: null,
        comparedCommit: null,
      },
    });
    expect(calls.some((call) => call.args[0] === "fetch")).toBe(false);
    expect(calls.some((call) => call.args[0] === "show-ref")).toBe(false);
  });

  it("blocks a stale local branch base before creating the worktree", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const localMain = "1111111111111111111111111111111111111111";
    const remoteMain = "2222222222222222222222222222222222222222";

    const gitRunner: GitRunner = (args: readonly string[], cwd?: string): GitCommandResult => {
      const argsArray = [...args];
      calls.push({ args: argsArray, cwd });
      const joined = argsArray.join(" ");
      if (argsArray[0] === "for-each-ref") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "show-ref --verify --quiet refs/heads/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}") {
        return { args: argsArray, stdout: "origin/main\n", stderr: "", exitCode: 0 };
      }
      if (joined === "fetch --prune origin refs/heads/main:refs/remotes/origin/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --verify --quiet main^{commit}") {
        return { args: argsArray, stdout: `${localMain}\n`, stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --verify --quiet origin/main^{commit}") {
        return { args: argsArray, stdout: `${remoteMain}\n`, stderr: "", exitCode: 0 };
      }

      return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
    };

    expect(() =>
      prepareGitWorktree({
        componentId: "core",
        sourceRoot,
        worktreesRoot,
        branchName: "codex/demo/stale-base",
        baseRef: "main",
        gitRunner,
      }),
    ).toThrow(/Base ref main is stale relative to origin\/main/u);
    expect(calls.some((call) =>
      call.args[0] === "worktree" && call.args[1] === "add"
    )).toBe(false);
  });

  it("blocks a mutable branch base when refreshing its upstream ref fails", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const currentCommit = "1111111111111111111111111111111111111111";

    const gitRunner: GitRunner = (args: readonly string[], cwd?: string): GitCommandResult => {
      const argsArray = [...args];
      calls.push({ args: argsArray, cwd });
      const joined = argsArray.join(" ");
      if (argsArray[0] === "for-each-ref") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "show-ref --verify --quiet refs/heads/main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}") {
        return { args: argsArray, stdout: "origin/main\n", stderr: "", exitCode: 0 };
      }
      if (joined === "fetch --prune origin refs/heads/main:refs/remotes/origin/main") {
        return {
          args: argsArray,
          stdout: "",
          stderr: "! [rejected] main -> origin/main (non-fast-forward)",
          exitCode: 1,
        };
      }
      if (joined === "rev-parse --verify --quiet main^{commit}") {
        return { args: argsArray, stdout: `${currentCommit}\n`, stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse --verify --quiet origin/main^{commit}") {
        return { args: argsArray, stdout: `${currentCommit}\n`, stderr: "", exitCode: 0 };
      }

      return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
    };

    expect(() =>
      prepareGitWorktree({
        componentId: "core",
        sourceRoot,
        worktreesRoot,
        branchName: "codex/demo/failed-base-fetch",
        baseRef: "main",
        gitRunner,
      }),
    ).toThrow(/Fetch for base ref main from origin\/main failed/u);
    expect(calls.some((call) =>
      call.args[0] === "worktree" && call.args[1] === "add"
    )).toBe(false);
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
