import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureNexusProjectTrackerInRegistry,
  createNexusProjectInRegistry,
  devNexusProjectConfigFileName,
  importNexusProjectInRegistry,
  loadProjectConfig,
  type NexusProjectRegistryWithRoot,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
} from "./index.js";

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

function registry(root = makeTempDir("dev-nexus-projects-")): NexusProjectRegistryWithRoot {
  return {
    paths: {
      projectsRoot: root,
    },
    projects: [],
  };
}

function fakeGitRunner(
  calls: string[][],
  options: { branch?: string; remoteUrl?: string | null } = {},
): ProjectGitRunner {
  return (args: readonly string[]): ProjectGitCommandResult => {
    const argsArray = [...args];
    calls.push(argsArray);

    if (argsArray[0] === "clone") {
      fs.mkdirSync(argsArray[2]!, { recursive: true });
    }

    if (argsArray.includes("rev-parse")) {
      return {
        args: argsArray,
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (argsArray.includes("remote.origin.url")) {
      return {
        args: argsArray,
        stdout: options.remoteUrl ? `${options.remoteUrl}\n` : "",
        stderr: "",
        exitCode: options.remoteUrl ? 0 : 1,
      };
    }

    if (argsArray.includes("symbolic-ref")) {
      return {
        args: argsArray,
        stdout: `${options.branch ?? "main"}\n`,
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

describe("project operations", () => {
  it("creates a generic project and registers it", () => {
    const projectRegistry = registry();
    const gitCalls: string[][] = [];
    const result = createNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      name: "PlainTool",
      gitRunner: fakeGitRunner(gitCalls, { branch: "main" }),
    });

    expect(result).toMatchObject({
      projectRoot: path.join(projectRegistry.paths.projectsRoot, "PlainTool"),
      projectConfigPath: path.join(
        projectRegistry.paths.projectsRoot,
        "PlainTool",
        devNexusProjectConfigFileName,
      ),
      worktreesRoot: path.join(projectRegistry.paths.projectsRoot, "PlainTool", "worktrees"),
      projectConfig: {
        id: "plain-tool",
        name: "PlainTool",
      },
      reference: {
        id: "plain-tool",
        name: "PlainTool",
      },
      git: {
        operation: "init",
        remoteUrl: null,
        defaultBranch: "main",
      },
    });
    expect(projectRegistry.projects).toEqual([
      {
        id: "plain-tool",
        name: "PlainTool",
        projectRoot: result.projectRoot,
      },
    ]);
    expect(gitCalls).toEqual([
      ["init", result.projectRoot],
      ["-C", result.projectRoot, "symbolic-ref", "--short", "HEAD"],
    ]);
  });

  it("creates a managed project root and clones a remote source under it", () => {
    const projectRegistry = registry();
    const projectRoot = path.join(makeTempDir("dev-nexus-managed-"), "RemoteProject");
    const gitCalls: string[][] = [];

    const result = createNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      name: "RemoteProject",
      root: projectRoot,
      from: "https://github.com/example/remote-project.git",
      gitRunner: fakeGitRunner(gitCalls, { branch: "trunk" }),
    });

    expect(gitCalls[0]).toEqual(["init", projectRoot]);
    expect(gitCalls[1]).toEqual([
      "clone",
      "https://github.com/example/remote-project.git",
      path.join(projectRoot, "git"),
    ]);
    expect(result.projectConfig.repo).toEqual({
      kind: "git",
      remoteUrl: "https://github.com/example/remote-project.git",
      defaultBranch: "trunk",
      sourceRoot: "git",
    });
  });

  it("imports an existing Git repository into a separate managed root", () => {
    const projectRegistry = registry();
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Imported");
    const gitCalls: string[][] = [];
    fs.mkdirSync(sourceRoot, { recursive: true });

    const result = importNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      root: sourceRoot,
      name: "Imported",
      gitRunner: fakeGitRunner(gitCalls, {
        branch: "main",
        remoteUrl: "https://github.com/example/imported.git",
      }),
    });

    expect(result.projectConfig).toMatchObject({
      id: "imported",
      repo: {
        kind: "git",
        remoteUrl: "https://github.com/example/imported.git",
        defaultBranch: "main",
        sourceRoot,
      },
    });
    expect(fs.existsSync(path.join(result.projectRoot, devNexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, devNexusProjectConfigFileName))).toBe(false);
    expect(projectRegistry.projects).toEqual([
      {
        id: "imported",
        name: "Imported",
        projectRoot: result.projectRoot,
      },
    ]);
  });

  it("configures provider-neutral tracking and registers an unregistered project", () => {
    const projectRegistry = registry();
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "Tracked");
    createNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      name: "Tracked",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });
    projectRegistry.projects.length = 0;

    const result = configureNexusProjectTrackerInRegistry({
      registry: projectRegistry,
      project: projectRoot,
      provider: "github",
      host: "github.enterprise.test",
      repositoryOwner: "example",
      repositoryName: "tracked",
    });

    expect(result.workTracking).toEqual({
      provider: "github",
      host: "github.enterprise.test",
      repository: {
        owner: "example",
        name: "tracked",
      },
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(result.workTracking);
    expect(projectRegistry.projects).toEqual([
      {
        id: "tracked",
        name: "Tracked",
        projectRoot,
      },
    ]);
  });
});
