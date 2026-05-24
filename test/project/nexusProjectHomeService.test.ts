import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureNexusProjectTracker,
  createNexusProject,
  getNexusProjectStatus,
  linkNexusProjectTracker,
  listNexusProjects,
  loadProjectConfig,
  type NexusProjectHomeStore,
  type NexusProjectRegistryWithRoot,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
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

function fakeGitRunner(calls: string[][]): ProjectGitRunner {
  return (args: readonly string[]): ProjectGitCommandResult => {
    const argsArray = [...args];
    calls.push(argsArray);

    if (argsArray.includes("symbolic-ref")) {
      return {
        args: argsArray,
        stdout: "main\n",
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

function createHome(): {
  homePath: string;
  registry: NexusProjectRegistryWithRoot;
  homeStore: NexusProjectHomeStore;
  saved: () => number;
} {
  const homePath = makeTempDir("dev-nexus-home-");
  const registry: NexusProjectRegistryWithRoot = {
    paths: {
      projectsRoot: path.join(homePath, "projects"),
    },
    projects: [],
  };
  let saveCount = 0;
  const homeStore: NexusProjectHomeStore = {
    resolveHomePath: (value) => path.resolve(value),
    loadHomeConfig: () => registry,
    saveHomeConfig: () => {
      saveCount += 1;
      return path.join(homePath, "dev-nexus.home.json");
    },
  };

  return {
    homePath,
    registry,
    homeStore,
    saved: () => saveCount,
  };
}

describe("project home service", () => {
  it("creates a project through an injected home store", () => {
    const home = createHome();
    const gitCalls: string[][] = [];

    const result = createNexusProject({
      homePath: home.homePath,
      homeStore: home.homeStore,
      name: "HomeTool",
      gitRunner: fakeGitRunner(gitCalls),
    });

    expect(home.saved()).toBe(1);
    expect(result.homePath).toBe(home.homePath);
    expect(result.projectConfig).toMatchObject({
      id: "home-tool",
      name: "HomeTool",
    });
    expect(home.registry.projects).toEqual([
      {
        id: "home-tool",
        name: "HomeTool",
        projectRoot: result.projectRoot,
      },
    ]);
    expect(gitCalls).toEqual([
      ["init", result.projectRoot],
      ["-C", result.projectRoot, "symbolic-ref", "--short", "HEAD"],
    ]);
  });

  it("lists projects and resolves status by registry id before path fallback", () => {
    const home = createHome();
    const result = createNexusProject({
      homePath: home.homePath,
      homeStore: home.homeStore,
      name: "LookupTool",
      gitRunner: fakeGitRunner([]),
    });

    expect(listNexusProjects({
      homePath: home.homePath,
      homeStore: home.homeStore,
    }).projects).toMatchObject([
      {
        id: "lookup-tool",
        projectRoot: result.projectRoot,
        projectConfigExists: true,
      },
    ]);
    expect(getNexusProjectStatus({
      homePath: home.homePath,
      homeStore: home.homeStore,
      project: "lookup-tool",
    }).project.projectRoot).toBe(result.projectRoot);
  });

  it("links the legacy tracker id and configures provider-neutral tracking", () => {
    const home = createHome();
    const project = createNexusProject({
      homePath: home.homePath,
      homeStore: home.homeStore,
      name: "TrackedTool",
      gitRunner: fakeGitRunner([]),
    });

    const linked = linkNexusProjectTracker({
      homePath: home.homePath,
      homeStore: home.homeStore,
      project: "tracked-tool",
      trackerProjectId: "tracker-1",
    });

    expect(linked).toMatchObject({
      vibeKanbanProjectId: "tracker-1",
      vibeKanbanRepoId: null,
      projectRoot: project.projectRoot,
    });
    expect(loadProjectConfig(project.projectRoot).kanban.projectId).toBe(
      "tracker-1",
    );

    const configured = configureNexusProjectTracker({
      homePath: home.homePath,
      homeStore: home.homeStore,
      project: "tracked-tool",
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "tracked-tool",
    });

    expect(configured.workTracking).toEqual({
      provider: "github",
      repository: {
        owner: "example",
        name: "tracked-tool",
      },
    });
    expect(loadProjectConfig(project.projectRoot).workTracking).toEqual(
      configured.workTracking,
    );
  });
});
