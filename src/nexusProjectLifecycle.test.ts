import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFileDoesNotExist,
  assertGitRepository,
  defaultImportedProjectRoot,
  detectDefaultBranch,
  detectOriginUrl,
  directoryExistsAndIsNonEmpty,
  ensureUniqueProject,
  loadProjectConfigIfExists,
  NexusProjectError,
  pathForProjectConfig,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  resolveProjectComponents,
  resolveProjectSourceRoot,
  runProjectGitCommand,
  safeProjectDirectoryName,
  saveProjectConfig,
  slugify,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fakeGitRunner(
  calls: string[][],
  options: { branch?: string; remoteUrl?: string | null; insideWorkTree?: boolean } = {},
): ProjectGitRunner {
  return (args: readonly string[]): ProjectGitCommandResult => {
    const argsArray = [...args];
    calls.push(argsArray);

    if (argsArray.includes("rev-parse")) {
      return {
        args: argsArray,
        stdout: options.insideWorkTree === false ? "false\n" : "true\n",
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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("project lifecycle helpers", () => {
  it("normalizes project identifiers and directory names", () => {
    expect(slugify("HTTPServer Tool")).toBe("http-server-tool");
    expect(safeProjectDirectoryName("My Tool: Windows?")).toBe("My-Tool-Windows");
    expect(() => slugify("   !!!   ")).toThrow(NexusProjectError);
  });

  it("detects non-empty roots and refuses file overwrites", () => {
    const root = makeTempDir("dev-nexus-lifecycle-");
    expect(directoryExistsAndIsNonEmpty(path.join(root, "missing"))).toBe(false);
    expect(directoryExistsAndIsNonEmpty(root)).toBe(false);

    const filePath = path.join(root, "existing.txt");
    fs.writeFileSync(filePath, "content", "utf8");
    expect(directoryExistsAndIsNonEmpty(root)).toBe(true);
    expect(() => assertFileDoesNotExist(filePath)).toThrow(
      /Refusing to overwrite/,
    );
  });

  it("records and validates Git command results", () => {
    const calls: string[][] = [];
    const commands: ProjectGitCommandResult[] = [];
    const runner = fakeGitRunner(calls, {
      branch: "trunk",
      remoteUrl: "https://example.invalid/project.git",
    });

    expect(detectDefaultBranch(runner, commands, "repo")).toBe("trunk");
    expect(detectOriginUrl(runner, commands, "repo")).toBe(
      "https://example.invalid/project.git",
    );
    expect(() => assertGitRepository(runner, commands, "repo")).not.toThrow();
    expect(calls).toEqual([
      ["-C", "repo", "symbolic-ref", "--short", "HEAD"],
      ["-C", "repo", "config", "--get", "remote.origin.url"],
      ["-C", "repo", "rev-parse", "--is-inside-work-tree"],
    ]);
  });

  it("throws when a Git command fails", () => {
    const commands: ProjectGitCommandResult[] = [];
    expect(() =>
      runProjectGitCommand(
        () => ({
          args: ["status"],
          stdout: "",
          stderr: "not a repository",
          exitCode: 128,
        }),
        commands,
        ["status"],
      ),
    ).toThrow(/git status failed/);
  });

  it("resolves project paths and config-relative source roots", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "project");
    const sourceRoot = path.join(projectRoot, "source");

    expect(pathForProjectConfig(projectRoot, sourceRoot)).toBe("source");
    expect(pathForProjectConfig(projectRoot, path.dirname(projectRoot))).toBe(
      path.dirname(projectRoot),
    );
    expect(
      resolveProjectSourceRoot(projectRoot, {
        version: 1,
        id: "project",
        name: "Project",
        home: null,
        repo: {
          kind: "git",
          remoteUrl: null,
          defaultBranch: "main",
          sourceRoot: "source",
        },
        worktreesRoot: "worktrees",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
      }),
    ).toBe(sourceRoot);
  });

  it("resolves component source and worktree roots independently", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "project");
    const primaryRoot = path.join(projectRoot, "components", "primary");
    const addonRoot = path.join(projectRoot, "components", "addon");
    fs.mkdirSync(primaryRoot, { recursive: true });

    expect(
      resolveProjectComponents(projectRoot, {
        version: 1,
        id: "project",
        name: "Project",
        home: null,
        repo: {
          kind: "git",
          remoteUrl: null,
          defaultBranch: "main",
        },
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
            sourceRoot: "components/primary",
            relationships: [],
          },
          {
            id: "addon",
            name: "Addon",
            kind: "git",
            role: "addon",
            remoteUrl: null,
            defaultBranch: "main",
            sourceRoot: "components/addon",
            relationships: [
              {
                kind: "extends",
                componentId: "primary",
              },
            ],
          },
        ],
        worktreesRoot: "worktrees",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
      }),
    ).toMatchObject([
      {
        id: "primary",
        sourceRoot: primaryRoot,
        sourceRootExists: true,
        worktreesRoot: path.join(projectRoot, "worktrees", "primary"),
      },
      {
        id: "addon",
        sourceRoot: addonRoot,
        sourceRootExists: false,
        worktreesRoot: path.join(projectRoot, "worktrees", "addon"),
        relationships: [
          {
            kind: "extends",
            componentId: "primary",
          },
        ],
      },
    ]);
  });

  it("loads project config only when one exists", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    expect(loadProjectConfigIfExists(projectRoot)).toBeUndefined();

    saveProjectConfig(projectRoot, {
      version: 1,
      id: "configured",
      name: "Configured",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });

    expect(loadProjectConfigIfExists(projectRoot)).toMatchObject({
      id: "configured",
      name: "Configured",
    });
  });

  it("detects duplicate registry ids and source-root collisions", () => {
    const projectsRoot = makeTempDir("dev-nexus-projects-");
    const config = {
      paths: {
        projectsRoot,
      },
      projects: [
        {
          id: "existing",
          projectRoot: path.join(projectsRoot, "Existing"),
        },
      ],
    };

    expect(() =>
      ensureUniqueProject(config, "existing", path.join(projectsRoot, "Other")),
    ).toThrow(/Project is already registered/);

    const sourceRoot = path.join(projectsRoot, "Imported");
    expect(defaultImportedProjectRoot(config, "Imported", sourceRoot)).toBe(
      path.join(projectsRoot, "Imported-DevNexus"),
    );
  });
});
