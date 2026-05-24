import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NexusProjectConfig } from "../../src/project/nexusProjectConfig.js";
import { resolveComponentWorkItemRoute } from "../../src/work-items/nexusWorkItemRouting.js";

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

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "routing-demo",
    name: "Routing Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:routing/demo.git",
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:routing/core.git",
        defaultBranch: "main",
        sourceRoot: "components/core",
        relationships: [],
      },
      {
        id: "docs",
        name: "Docs",
        kind: "git",
        role: "addon",
        remoteUrl: "git@example.invalid:routing/docs.git",
        defaultBranch: "main",
        sourceRoot: "components/docs",
        relationships: [],
      },
    ],
  };
}

describe("work item routing", () => {
  it("routes component-qualified work item ids", () => {
    const projectRoot = makeTempDir("dev-nexus-routing-");
    const route = resolveComponentWorkItemRoute({
      projectRoot,
      projectConfig: projectConfig(),
      workItemId: "docs:123",
    });

    expect(route).toMatchObject({
      component: { id: "docs" },
      itemId: "123",
      qualified: true,
    });
  });

  it("rejects conflicting requested and qualified components", () => {
    const projectRoot = makeTempDir("dev-nexus-routing-");

    expect(() =>
      resolveComponentWorkItemRoute({
        projectRoot,
        projectConfig: projectConfig(),
        componentId: "core",
        workItemId: "docs:123",
      }),
    ).toThrow(/conflicts with requested component "core"/u);
  });

  it("infers the component from the current path for unqualified ids", () => {
    const projectRoot = makeTempDir("dev-nexus-routing-");
    const route = resolveComponentWorkItemRoute({
      projectRoot,
      projectConfig: projectConfig(),
      workItemId: "123",
      currentPath: path.join(projectRoot, "components", "docs", "README.md"),
    });

    expect(route).toMatchObject({
      component: { id: "docs" },
      itemId: "123",
      qualified: false,
    });
  });
});
