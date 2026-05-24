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
  NexusProjectError,
  type NexusExtension,
  type NexusProjectConfig,
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

const sampleExtension: NexusExtension<NexusProjectConfig> = {
  id: "sample-extension",
  name: "Sample Extension",
  installProjectFiles: ({ projectRoot }) => ({
    markerPath: path.join(projectRoot, "sample-extension.marker"),
  }),
};

const throwingExtension: NexusExtension<NexusProjectConfig> = {
  id: "throwing-extension",
  name: "Throwing Extension",
  installProjectFiles: ({ projectRoot }) => {
    fs.writeFileSync(
      path.join(projectRoot, "throwing-extension.partial"),
      "partial scaffold output\n",
      "utf8",
    );
    throw new Error("throwing-extension installProjectFiles failed");
  },
};

function captureError(action: () => unknown): unknown {
  try {
    action();
    return null;
  } catch (error) {
    return error;
  }
}

function writeInitializedProjectConfig(
  projectRoot: string,
  extensions: NexusProjectConfig["extensions"],
): void {
  fs.writeFileSync(
    path.join(projectRoot, devNexusProjectConfigFileName),
    `${JSON.stringify(
      {
        version: 1,
        id: "initialized",
        name: "Initialized",
        home: null,
        repo: {
          kind: "git",
          remoteUrl: null,
          defaultBranch: "main",
        },
        worktreesRoot: "worktrees",
        extensions,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
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
        components: [
          {
            id: "primary",
            role: "primary",
            sourceRoot: ".",
          },
        ],
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

  it("creates projects with configured extensions and exposes scaffold results", () => {
    const projectRegistry = registry();
    const result = createNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      name: "ExtendedTool",
      gitRunner: fakeGitRunner([], { branch: "main" }),
      extensions: {
        "sample-extension": {
          enabled: true,
        },
      },
      scaffoldExtensions: [sampleExtension],
    });

    expect(result.projectConfig.extensions).toEqual({
      "sample-extension": {
        enabled: true,
      },
    });
    expect(result.scaffold.extensionResults["sample-extension"]).toEqual({
      markerPath: path.join(result.projectRoot, "sample-extension.marker"),
    });
  });

  it("removes the partial workspace root when create scaffold extension setup fails", () => {
    const projectRegistry = registry();
    const projectRoot = path.join(makeTempDir("dev-nexus-managed-"), "BrokenTool");

    const error = captureError(() =>
      createNexusProjectInRegistry({
        homePath: makeTempDir("dev-nexus-home-"),
        registry: projectRegistry,
        name: "BrokenTool",
        root: projectRoot,
        gitRunner: fakeGitRunner([], { branch: "main" }),
        scaffoldExtensions: [throwingExtension],
      }),
    );

    expect(error).toBeInstanceOf(NexusProjectError);
    expect((error as Error).message).toMatch(/Workspace scaffold failed/u);
    expect((error as Error).message).toMatch(/throwing-extension/u);
    expect((error as Error).message).toMatch(/Safe next action/u);
    expect(fs.existsSync(projectRoot)).toBe(false);
    expect(projectRegistry.projects).toEqual([]);
  });

  it("creates a managed workspace root and clones a remote source under it", () => {
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
    expect(result.projectConfig.components).toMatchObject([
      {
        id: "primary",
        role: "primary",
        remoteUrl: "https://github.com/example/remote-project.git",
        defaultBranch: "trunk",
        sourceRoot: "git",
      },
    ]);
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
      components: [
        {
          id: "primary",
          role: "primary",
          sourceRoot,
        },
      ],
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

  it("removes the managed workspace root but preserves the source checkout when import scaffold extension setup fails", () => {
    const projectRegistry = registry();
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Imported");
    const projectRoot = path.join(makeTempDir("dev-nexus-managed-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "source.txt"), "source checkout\n", "utf8");

    const error = captureError(() =>
      importNexusProjectInRegistry({
        homePath: makeTempDir("dev-nexus-home-"),
        registry: projectRegistry,
        root: sourceRoot,
        projectRoot,
        name: "Imported",
        gitRunner: fakeGitRunner([], {
          branch: "main",
          remoteUrl: "https://github.com/example/imported.git",
        }),
        scaffoldExtensions: [throwingExtension],
      }),
    );

    expect(error).toBeInstanceOf(NexusProjectError);
    expect((error as Error).message).toMatch(/Workspace scaffold failed/u);
    expect((error as Error).message).toMatch(/throwing-extension/u);
    expect((error as Error).message).toMatch(/Safe next action/u);
    expect(fs.existsSync(projectRoot)).toBe(false);
    expect(fs.readFileSync(path.join(sourceRoot, "source.txt"), "utf8")).toBe(
      "source checkout\n",
    );
    expect(fs.existsSync(path.join(sourceRoot, devNexusProjectConfigFileName))).toBe(false);
    expect(projectRegistry.projects).toEqual([]);
  });

  it("merges extension metadata when importing an initialized project", () => {
    const projectRegistry = registry();
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Initialized");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, devNexusProjectConfigFileName),
      `${JSON.stringify(
        {
          version: 1,
          id: "initialized",
          name: "Initialized",
          home: null,
          repo: {
            kind: "git",
            remoteUrl: null,
            defaultBranch: "main",
          },
          worktreesRoot: "worktrees",
          extensions: {
            existing: {
              retained: true,
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = importNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      root: sourceRoot,
      gitRunner: fakeGitRunner([], {
        branch: "main",
        remoteUrl: "https://github.com/example/initialized.git",
      }),
      extensions: {
        "sample-extension": {
          enabled: true,
        },
      },
      scaffoldExtensions: [sampleExtension],
    });

    expect(result.projectRoot).toBe(sourceRoot);
    expect(loadProjectConfig(sourceRoot).extensions).toEqual({
      existing: {
        retained: true,
      },
      "sample-extension": {
        enabled: true,
      },
    });
    expect(result.scaffold.extensionResults["sample-extension"]).toEqual({
      markerPath: path.join(sourceRoot, "sample-extension.marker"),
    });
  });

  it("preserves same-key DevNexus-Pharo extension metadata when importing with an empty marker", () => {
    const projectRegistry = registry();
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Initialized");
    fs.mkdirSync(sourceRoot, { recursive: true });
    writeInitializedProjectConfig(sourceRoot, {
      "dev-nexus-pharo": {
        plexusProjectConfig: "plexus.project.json",
        imageExecution: {
          mode: "disabled",
          requireDisposableImage: true,
        },
      },
    });

    importNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      root: sourceRoot,
      gitRunner: fakeGitRunner([], {
        branch: "main",
        remoteUrl: "https://github.com/example/initialized.git",
      }),
      extensions: {
        "dev-nexus-pharo": {},
      },
    });

    expect(loadProjectConfig(sourceRoot).extensions).toEqual({
      "dev-nexus-pharo": {
        plexusProjectConfig: "plexus.project.json",
        imageExecution: {
          mode: "disabled",
          requireDisposableImage: true,
        },
      },
    });
  });

  it("merges same-key extension metadata when importing with override fields", () => {
    const projectRegistry = registry();
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Initialized");
    fs.mkdirSync(sourceRoot, { recursive: true });
    writeInitializedProjectConfig(sourceRoot, {
      "sample-extension": {
        enabled: true,
        mode: "old",
      },
    });

    importNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      root: sourceRoot,
      gitRunner: fakeGitRunner([], {
        branch: "main",
        remoteUrl: "https://github.com/example/initialized.git",
      }),
      extensions: {
        "sample-extension": {
          mode: "new",
        },
      },
    });

    expect(loadProjectConfig(sourceRoot).extensions).toEqual({
      "sample-extension": {
        enabled: true,
        mode: "new",
      },
    });
  });

  it("replaces and clears extension metadata when importing with explicit options", () => {
    const projectRegistry = registry();
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Initialized");
    fs.mkdirSync(sourceRoot, { recursive: true });
    writeInitializedProjectConfig(sourceRoot, {
      cleared: {
        enabled: true,
      },
      "sample-extension": {
        enabled: true,
        mode: "old",
      },
    });

    importNexusProjectInRegistry({
      homePath: makeTempDir("dev-nexus-home-"),
      registry: projectRegistry,
      root: sourceRoot,
      gitRunner: fakeGitRunner([], {
        branch: "main",
        remoteUrl: "https://github.com/example/initialized.git",
      }),
      replaceExtensions: {
        "sample-extension": {
          replacement: true,
        },
      },
      clearExtensions: ["cleared"],
    });

    expect(loadProjectConfig(sourceRoot).extensions).toEqual({
      "sample-extension": {
        replacement: true,
      },
    });
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
    expect(loadProjectConfig(projectRoot).components).toMatchObject([
      {
        id: "primary",
        workTracking: result.workTracking,
      },
    ]);
    expect(projectRegistry.projects).toEqual([
      {
        id: "tracked",
        name: "Tracked",
        projectRoot,
      },
    ]);
  });
});
