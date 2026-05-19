import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeNexusProjectSetupComponentTopology,
  findNestedGitRepositories,
} from "./nexusProjectComponentTopology.js";
import type { NexusProjectSetupAnswers } from "./nexusProjectSetupModel.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function makeGitRepo(root: string, branch = "main", remoteUrl?: string): void {
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), `ref: refs/heads/${branch}\n`, "utf8");
  fs.writeFileSync(
    path.join(root, ".git", "config"),
    remoteUrl
      ? `[remote "origin"]\n\turl = ${remoteUrl}\n`
      : "",
    "utf8",
  );
}

function answers(projectRoot: string, componentPath: string): NexusProjectSetupAnswers {
  return {
    home: {
      path: path.join(projectRoot, ".home"),
    },
    project: {
      id: "demo",
      name: "Demo",
      root: projectRoot,
    },
    components: [
      {
        id: "core",
        role: "primary",
        source: {
          kind: "reference_existing",
          path: componentPath,
          defaultBranch: "main",
        },
      },
    ],
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("project component topology analysis", () => {
  it("detects container folders with nested repositories", () => {
    const projectRoot = makeTempDir("dev-nexus-topology-");
    const container = path.join(projectRoot, "GraphRag-Projects");
    makeGitRepo(path.join(container, "json-java-moose"));
    makeGitRepo(path.join(container, "json-java-no-moose"));

    const analysis = analyzeNexusProjectSetupComponentTopology(
      answers(projectRoot, container),
    );

    expect(findNestedGitRepositories(container)).toEqual([
      "json-java-moose",
      "json-java-no-moose",
    ]);
    expect(analysis.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        componentId: "core",
        message: expect.stringContaining("container folder"),
      }),
    ]);
  });

  it("reports branch and remote drift for existing Git repositories", () => {
    const projectRoot = makeTempDir("dev-nexus-topology-");
    const sourceRoot = path.join(projectRoot, "component");
    makeGitRepo(sourceRoot, "develop", "git@github.com:Example/other.git");
    const setupAnswers = answers(projectRoot, sourceRoot);
    setupAnswers.components[0]!.source.remoteUrl = "git@github.com:Example/demo.git";

    const analysis = analyzeNexusProjectSetupComponentTopology(setupAnswers);

    expect(analysis.components[0]).toMatchObject({
      isGitRepository: true,
      currentBranch: "develop",
      remotes: {
        origin: "git@github.com:Example/other.git",
      },
    });
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "components[0].source.path.defaultBranch",
        "components[0].source.path.remoteUrl",
      ]),
    );
  });

  it("rejects stable source roots under generated worktrees", () => {
    const projectRoot = makeTempDir("dev-nexus-topology-");
    const sourceRoot = path.join(projectRoot, "worktrees", "core");
    makeGitRepo(sourceRoot);

    const analysis = analyzeNexusProjectSetupComponentTopology(
      answers(projectRoot, sourceRoot),
    );

    expect(analysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining("generated worktrees"),
        }),
      ]),
    );
  });
});
