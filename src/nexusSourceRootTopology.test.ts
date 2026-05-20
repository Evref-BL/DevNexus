import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyNexusComponentSourceRootTopology,
} from "./nexusSourceRootTopology.js";
import type { NexusProjectComponentConfig } from "./nexusProjectConfig.js";

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

function component(
  sourceRoot?: string,
): NexusProjectComponentConfig {
  return {
    id: "dev-nexus",
    name: "DevNexus",
    kind: "git",
    role: "primary",
    remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
    defaultBranch: "main",
    ...(sourceRoot ? { sourceRoot } : {}),
    relationships: [],
  };
}

describe("nexus source root topology", () => {
  it("classifies project-local, sourcesRoot, absolute, missing, and incompatible roots", () => {
    const fixtureRoot = makeTempDir("dev-nexus-source-root-topology-");
    const projectRoot = path.join(fixtureRoot, "Project");
    const projectLocal = path.join(projectRoot, "components", "dev-nexus");
    const sourcesRoot = path.join(path.dirname(projectRoot), "sources", "dev-nexus");
    const absoluteExternal = path.join(path.dirname(projectRoot), "external", "dev-nexus");
    fs.mkdirSync(projectLocal, { recursive: true });
    fs.mkdirSync(sourcesRoot, { recursive: true });
    fs.mkdirSync(absoluteExternal, { recursive: true });

    expect(classifyNexusComponentSourceRootTopology({
      projectRoot,
      component: component("componentsRoot:dev-nexus"),
    })).toMatchObject({
      layout: "project-local",
      state: "present",
      configuredBase: "componentsRoot",
      exists: true,
      insideProjectRoot: true,
    });
    expect(classifyNexusComponentSourceRootTopology({
      projectRoot,
      component: component("sourcesRoot:dev-nexus"),
    })).toMatchObject({
      layout: "explicit-external",
      state: "present",
      configuredBase: "sourcesRoot",
      exists: true,
      insideProjectRoot: false,
    });
    expect(classifyNexusComponentSourceRootTopology({
      projectRoot,
      component: component(absoluteExternal),
    })).toMatchObject({
      layout: "legacy-external",
      state: "present",
      configuredBase: "absolute",
      exists: true,
      insideProjectRoot: false,
    });
    expect(classifyNexusComponentSourceRootTopology({
      projectRoot,
      component: component("componentsRoot:missing"),
    })).toMatchObject({
      layout: "project-local",
      state: "missing",
      exists: false,
    });
    expect(classifyNexusComponentSourceRootTopology({
      projectRoot,
      component: component("C:\\dev\\code\\DevNexus"),
      platform: "macos",
    })).toMatchObject({
      layout: "incompatible-platform",
      state: "incompatible-platform",
      configuredBase: "absolute",
      compatible: false,
      effectivePath: expect.stringContaining("components"),
    });
  });

  it("warns when project-local-looking roots resolve outside the project", () => {
    const fixtureRoot = makeTempDir("dev-nexus-source-root-topology-");
    const projectRoot = path.join(fixtureRoot, "Project");
    const externalRoot = path.join(path.dirname(projectRoot), "external", "dev-nexus");
    const linkRoot = path.join(projectRoot, "components", "dev-nexus");
    fs.mkdirSync(externalRoot, { recursive: true });
    fs.mkdirSync(path.dirname(linkRoot), { recursive: true });
    try {
      fs.symlinkSync(
        externalRoot,
        linkRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      return;
    }

    const topology = classifyNexusComponentSourceRootTopology({
      projectRoot,
      component: component("componentsRoot:dev-nexus"),
    });

    expect(topology).toMatchObject({
      layout: "project-local",
      state: "project-local-escape",
      exists: true,
      insideProjectRoot: true,
      realInsideProjectRoot: false,
    });
    expect(topology.summary).toContain("resolves outside");
  });
});
