import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  materializeNexusAutomationWorktreeSetup,
  preflightNexusAutomationWorktreeSetup,
  type GitCommandResult,
  type GitRunner,
  type NexusAutomationConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function automationConfig(
  overrides: Partial<NexusAutomationConfig> = {},
): NexusAutomationConfig {
  return {
    ...defaultNexusAutomationConfig,
    setup: {
      dependencyLinks: [
        {
          source: "node_modules",
          target: "node_modules",
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return {
        args: argsArray,
        stdout: path.join(cwd ?? "", ".git", "info", "exclude"),
        stderr: "",
        exitCode: 0,
      };
    }

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation worktree setup", () => {
  it("preflights dependency link safety before worktree mutation", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"), { recursive: true });

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig(),
      }),
    ).toEqual([
      {
        name: "dependencyLink:0",
        status: "passed",
        message: "Dependency link node_modules -> node_modules is safe to materialize",
      },
    ]);

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [
              {
                source: "..",
                target: "node_modules",
                required: true,
              },
            ],
          },
        }),
      })[0],
    ).toMatchObject({
      name: "dependencyLink:0",
      status: "failed",
    });
  });

  it("links dependencies into a generated worktree and excludes them", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ok\n", "utf8");
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreePath,
      automationConfig: automationConfig(),
      gitRunner: fakeGitRunner(gitCalls),
    });

    expect(result.links).toMatchObject([
      {
        source: "node_modules",
        target: "node_modules",
        sourcePath: sourceDependency,
        targetPath: path.join(worktreePath, "node_modules"),
        status: "linked",
      },
    ]);
    expect(fs.readFileSync(path.join(worktreePath, "node_modules", "tool.txt"), "utf8"))
      .toBe("ok\n");
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe("node_modules/\n");
    expect(gitCalls).toEqual([
      {
        args: ["rev-parse", "--git-path", "info/exclude"],
        cwd: worktreePath,
      },
    ]);
  });
});
