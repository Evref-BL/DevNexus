import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  projectConfigPath,
  saveProjectConfig,
  type NexusProjectConfig,
} from "../../src/project/nexusProjectConfig.js";
import {
  applyNexusProjectConfigMutation,
  previewNexusProjectConfigMutation,
} from "../../src/project/nexusProjectConfigMutation.js";
import { loadLocalWorkTrackingStore } from "../../src/work-items/workTrackingLocalProvider.js";

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

describe("project config mutation service", () => {
  it("previews component edits as typed deltas without writing the config file", () => {
    const projectRoot = initializedProject();
    const sourceRoot = path.join(projectRoot, "components", "core-renamed");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const original = fs.readFileSync(projectConfigPath(projectRoot), "utf8");

    const proposal = previewNexusProjectConfigMutation({
      projectRoot,
      intent: {
        kind: "edit_component",
        componentId: "core",
        patch: {
          name: "Core Renamed",
          sourceRoot: "components/core-renamed",
          defaultBranch: "trunk",
        },
      },
    });

    expect(proposal).toMatchObject({
      status: "ready",
      mutation: {
        kind: "edit_component",
        componentIds: ["core"],
      },
      summary: "Edit component core.",
      changedComponentIds: ["core"],
    });
    expect(proposal.diagnostics.filter((diagnostic) => diagnostic.severity === "error"))
      .toEqual([]);
    expect(proposal.revision.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(projectConfigPath(projectRoot), "utf8")).toBe(original);
  });

  it("refuses to apply a stale component edit preview", async () => {
    const projectRoot = initializedProject();
    const proposal = previewNexusProjectConfigMutation({
      projectRoot,
      intent: {
        kind: "edit_component",
        componentId: "core",
        patch: {
          name: "Core Renamed",
        },
      },
    });
    const externalConfig = loadProjectConfig(projectRoot);
    saveProjectConfig(projectRoot, {
      ...externalConfig,
      name: "Changed Elsewhere",
    });

    await expect(
      applyNexusProjectConfigMutation({
        projectRoot,
        expectedRevision: proposal.revision,
        intent: proposal.intent,
      }),
    ).rejects.toThrow(/project config changed since preview/);
    expect(loadProjectConfig(projectRoot).components[0]?.name).toBe("Core");
  });

  it("removes component config records without deleting source directories", async () => {
    const projectRoot = initializedProject({ includeAddon: true });
    const addonRoot = path.join(projectRoot, "components", "addon");
    const proposal = previewNexusProjectConfigMutation({
      projectRoot,
      intent: {
        kind: "remove_component",
        componentId: "addon",
      },
    });

    expect(proposal).toMatchObject({
      status: "ready",
      mutation: {
        kind: "remove_component",
        componentIds: ["addon"],
      },
      changedComponentIds: ["addon"],
    });

    const result = await applyNexusProjectConfigMutation({
      projectRoot,
      expectedRevision: proposal.revision,
      intent: proposal.intent,
    });

    expect(loadProjectConfig(projectRoot).components.map((component) => component.id))
      .toEqual(["core"]);
    expect(fs.existsSync(addonRoot)).toBe(true);
    expect(result.writtenFiles).toContain(projectConfigPath(projectRoot));
    expect(result.skippedSideEffects).toContain("Source directories are never deleted by project config mutation.");
  });

  it("delegates component add apply to existing setup side effects", async () => {
    const projectRoot = initializedProject();
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), { recursive: true });
    const proposal = previewNexusProjectConfigMutation({
      projectRoot,
      intent: {
        kind: "add_component",
        answers: {
          components: [
            {
              id: "addon",
              name: "Addon",
              role: "addon",
              source: {
                kind: "reference_existing",
                path: "components/addon",
              },
            },
          ],
          localWorkTracking: {
            enabled: true,
            provider: "local",
          },
        },
      },
    });

    expect(proposal).toMatchObject({
      status: "ready",
      mutation: {
        kind: "add_component",
        componentIds: ["addon"],
      },
      changedComponentIds: ["addon"],
    });

    const result = await applyNexusProjectConfigMutation({
      projectRoot,
      expectedRevision: proposal.revision,
      intent: proposal.intent,
    });

    expect(loadProjectConfig(projectRoot).components.map((component) => component.id))
      .toEqual(["core", "addon"]);
    expect(
      loadLocalWorkTrackingStore(
        path.join(projectRoot, ".dev-nexus", "work-items", "addon.json"),
      ).items,
    ).toEqual([]);
    expect(result.ensuredLocalTrackerStores.length).toBeGreaterThan(0);
  });
});

function initializedProject(options: { includeAddon?: boolean } = {}): string {
  const projectRoot = makeTempDir("dev-nexus-config-mutation-");
  fs.mkdirSync(path.join(projectRoot, "components", "core"), { recursive: true });
  if (options.includeAddon) {
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), { recursive: true });
  }
  saveProjectConfig(projectRoot, projectConfig(options));
  return projectRoot;
}

function projectConfig(options: { includeAddon?: boolean } = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "config-mutation-demo",
    name: "Config Mutation Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    },
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: "https://github.com/example/core.git",
        defaultBranch: "main",
        sourceRoot: "components/core",
        relationships: [],
      },
      ...(options.includeAddon
        ? [
          {
            id: "addon",
            name: "Addon",
            kind: "local" as const,
            role: "addon" as const,
            remoteUrl: null,
            defaultBranch: null,
            sourceRoot: "components/addon",
            relationships: [
              {
                kind: "extends" as const,
                componentId: "core",
              },
            ],
          },
        ]
        : []),
    ],
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
    },
  };
}
