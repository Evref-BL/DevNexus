import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
  devNexusProjectConfigFileName,
  findNexusProjectReference,
  findNexusProjectReferenceById,
  findNexusProjectReferenceByPath,
  NexusProjectError,
  projectRootFromInput,
  saveProjectConfig,
  upsertNexusProjectReference,
  type NexusProjectRegistry,
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

function projectConfig(id: string, name: string) {
  return {
    version: 1 as const,
    id,
    name,
    home: null,
    repo: {
      kind: "local" as const,
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
  };
}

const localWorkTrackingCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: true,
  board: false,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

const localWorkTrackingCapabilityReport = {
  provider: "local",
  capabilities: {
    create: true,
    list: true,
    get: true,
    update: true,
    comment: true,
    labels: true,
    assignees: true,
    milestones: true,
    board: false,
    boardStatus: false,
  },
  unsupported: ["board", "boardStatus"],
};

describe("project registry helpers", () => {
  it("normalizes workspace config file input to the workspace root", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");

    expect(projectRootFromInput(path.join(root, devNexusProjectConfigFileName))).toBe(root);
    expect(projectRootFromInput(root)).toBe(root);
  });

  it("finds workspace references by registry id, config id, or path", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");
    fs.mkdirSync(root, { recursive: true });
    saveProjectConfig(root, projectConfig("config-id", "Config Project"));
    const registry: NexusProjectRegistry = {
      projects: [
        {
          id: "registry-id",
          name: "Registry Project",
          projectRoot: root,
        },
      ],
    };

    expect(findNexusProjectReferenceById(registry, "registry-id")).toMatchObject({
      id: "registry-id",
    });
    expect(findNexusProjectReferenceById(registry, "config-id")).toMatchObject({
      id: "registry-id",
    });
    expect(findNexusProjectReferenceByPath(registry, root)).toMatchObject({
      id: "registry-id",
    });
    expect(
      findNexusProjectReference(
        registry,
        path.join(root, devNexusProjectConfigFileName),
      ),
    ).toMatchObject({
      id: "registry-id",
    });
  });

  it("builds status from workspace config when present", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");
    fs.mkdirSync(path.join(root, "worktrees"), { recursive: true });
    saveProjectConfig(root, {
      ...projectConfig("config-id", "Config Project"),
      workTracking: {
        provider: "local",
      },
    });

    expect(
      buildNexusProjectStatus({
        id: "registry-id",
        name: "Registry Project",
        projectRoot: root,
      }),
    ).toMatchObject({
      id: "config-id",
      name: "Config Project",
      projectRoot: root,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      components: [
        {
          id: "primary",
          name: "Config Project",
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          sourceRoot: root,
          sourceRootExists: true,
          worktreesRoot: path.join(root, "worktrees", "primary"),
          worktreesRootExists: false,
          defaultTrackerId: "default",
          trackerDiscovery: {
            scannedRoles: ["primary"],
            directExternalSelection: "disabled",
            importRequiredFirst: true,
            providerFilters: [],
            queryLimit: 50,
            trackerLimits: {},
            finalLimit: null,
            statuses: [],
            labels: [],
            milestones: [],
            assignees: [],
            providerQuery: null,
            fingerprints: [],
            conflictWinner: "default_tracker",
            missingCredentialBehavior: "block",
            defaultTrackerOnly: true,
          },
          workTrackers: [
            {
              id: "default",
              name: "Default",
              provider: "local",
              enabled: true,
              roles: ["primary"],
              default: true,
              workTracking: {
                provider: "local",
              },
              workTrackingCapabilities: localWorkTrackingCapabilities,
              workTrackingCapabilityReport: localWorkTrackingCapabilityReport,
            },
          ],
          workTracking: {
            provider: "local",
          },
          workTrackingCapabilities: localWorkTrackingCapabilities,
          workTrackingCapabilityReport: localWorkTrackingCapabilityReport,
          verification: null,
          publication: null,
          relationships: [],
        },
      ],
      defaultTrackerId: "default",
      workTrackers: [
        {
          id: "default",
          name: "Default",
          provider: "local",
          enabled: true,
          roles: ["primary"],
          default: true,
          workTracking: {
            provider: "local",
          },
          workTrackingCapabilities: localWorkTrackingCapabilities,
          workTrackingCapabilityReport: localWorkTrackingCapabilityReport,
        },
      ],
      workTracking: {
        provider: "local",
      },
      workTrackingCapabilities: localWorkTrackingCapabilities,
      workTrackingCapabilityReport: localWorkTrackingCapabilityReport,
      hosts: [],
      runnerProfiles: [],
      agentTargets: expect.objectContaining({
        activeProviders: ["codex"],
        expectedMcpConfigFiles: [
          expect.objectContaining({
            provider: "codex",
            path: ".codex/config.toml",
            state: "expected-missing",
          }),
        ],
      }),
      authority: expect.objectContaining({
        projectId: "config-id",
        components: [
          expect.objectContaining({
            componentId: "primary",
            actor: expect.objectContaining({
              actorId: null,
              status: "unknown",
            }),
            keyAllowedActions: expect.arrayContaining([
              "project.read",
              "coordination.handoff",
            ]),
          }),
        ],
      }),
      projectConfigPath: path.join(root, devNexusProjectConfigFileName),
      projectConfigExists: true,
      worktreesRoot: path.join(root, "worktrees"),
      worktreesRootExists: true,
    });
  });

  it("reports runner profile approval and missing host capability status", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");
    fs.mkdirSync(root, { recursive: true });
    saveProjectConfig(root, {
      ...projectConfig("config-id", "Config Project"),
      hosts: [
        {
          id: "linux-verifier",
          capabilityTags: ["node", "git"],
        },
        {
          id: "mac-runtime",
          capabilityTags: ["node", "runtime"],
          enabled: false,
        },
      ],
      runnerProfiles: [
        {
          id: "verify-node",
          requiredCapabilities: ["node"],
          allowedOperationClasses: ["verification"],
          mutationClass: "verification",
        },
        {
          id: "runtime-smoke",
          requiredCapabilities: ["runtime", "tailscale"],
          allowedOperationClasses: ["live_runtime"],
          mutationClass: "live_runtime",
          approval: {
            required: true,
            policyGateIds: ["runner.runtime.approved"],
          },
        },
      ],
    });

    expect(
      buildNexusProjectStatus({
        id: "registry-id",
        name: "Registry Project",
        projectRoot: root,
      }).runnerProfiles,
    ).toMatchObject([
      {
        id: "verify-node",
        mutationClass: "verification",
        approvalState: "not_required",
        missingHostCapabilities: [],
        runnableHostIds: ["linux-verifier"],
      },
      {
        id: "runtime-smoke",
        mutationClass: "live_runtime",
        approvalState: "policy_gated",
        policyGateIds: ["runner.runtime.approved"],
        missingHostCapabilities: ["runtime", "tailscale"],
        runnableHostIds: [],
        hostCapabilities: [
          {
            hostId: "linux-verifier",
            missingCapabilities: ["runtime", "tailscale"],
          },
          {
            hostId: "mac-runtime",
            enabled: false,
            missingCapabilities: ["tailscale"],
          },
        ],
      },
    ]);
  });

  it("reports host overlay readiness in workspace status", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");
    fs.mkdirSync(root, { recursive: true });
    saveProjectConfig(root, {
      ...projectConfig("config-id", "Config Project"),
      hosts: [
        {
          id: "mac-builder",
          displayName: "Mac Builder",
          platformTags: ["macos"],
          capabilityTags: ["dev-nexus", "node"],
          enabled: true,
        },
        {
          id: "win-builder",
          displayName: "Windows Builder",
          platformTags: ["windows"],
          capabilityTags: ["dev-nexus", "powershell"],
          enabled: true,
        },
      ],
    });

    expect(
      buildNexusProjectStatus(
        {
          id: "registry-id",
          name: "Registry Project",
          projectRoot: root,
        },
        {
          homeConfig: {
            hostOverlays: [
              {
                hostId: "mac-builder",
                transport: {
                  kind: "ssh",
                  host: "mac-builder.tailnet.example",
                },
                workspaceRoots: {
                  projectRoot: "/Users/alice/dev/dev-nexus-dogfood",
                },
              },
            ],
          },
        },
      ).hosts,
    ).toEqual([
      {
        id: "mac-builder",
        displayName: "Mac Builder",
        enabled: true,
        platformTags: ["macos"],
        capabilityTags: ["dev-nexus", "node"],
        overlayConfigured: true,
        transportConfigured: true,
        workspaceRootsConfigured: true,
        warnings: [],
      },
      {
        id: "win-builder",
        displayName: "Windows Builder",
        enabled: true,
        platformTags: ["windows"],
        capabilityTags: ["dev-nexus", "powershell"],
        overlayConfigured: false,
        transportConfigured: false,
        workspaceRootsConfigured: false,
        warnings: [
          "Host win-builder is enabled but no host-local overlay is configured.",
        ],
      },
    ]);
  });

  it("summarizes active agent target projections in workspace status", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");
    fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(root, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(root, ".claude", "skills", "legacy"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, ".codex", "config.toml"), "");
    fs.writeFileSync(
      path.join(root, ".claude", "skills", "legacy", "dev-nexus.skill.json"),
      "{}\n",
    );
    fs.mkdirSync(path.join(root, ".opencode", "skills"), { recursive: true });
    fs.writeFileSync(path.join(root, ".opencode", "skills", "README.md"), "manual\n");
    saveProjectConfig(root, {
      ...projectConfig("agent-projection-project", "Agent Projection Project"),
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      mcp: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
      skills: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
      plugins: [
        {
          id: "runtime-plugin",
          enabled: true,
          capabilities: [
            {
              kind: "projected_skill",
              id: "skill-codex",
              skillId: "codex-diagnostic",
              targetAgents: ["codex"],
            },
            {
              kind: "mcp_server",
              id: "mcp-claude",
              serverName: "claude_runtime",
              targetAgents: ["claude"],
            },
          ],
        },
      ],
    });

    const status = buildNexusProjectStatusForPath(root).agentTargets!;

    expect(status).toMatchObject({
      explicit: true,
      activeProviders: ["codex"],
      expectedMcpConfigFiles: [
        expect.objectContaining({
          provider: "codex",
          path: ".codex/config.toml",
          state: "expected-present",
        }),
      ],
      expectedSkillDirectories: [
        expect.objectContaining({
          provider: "codex",
          path: ".agents/skills",
          state: "expected-present",
        }),
      ],
      staleGeneratedProviderDirectories: [
        expect.objectContaining({
          provider: "claude",
          path: ".claude/skills",
          state: "present-stale-generated",
          cleanupSafe: true,
        }),
      ],
      manualProviderDirectories: [
        expect.objectContaining({
          provider: "opencode",
          path: ".opencode/skills",
          state: "present-manual",
          cleanupSafe: false,
        }),
      ],
      locallySelectedButNotAllowed: [
        expect.objectContaining({
          provider: "claude",
          state: "locally-selected-but-not-allowed",
        }),
      ],
      selectedPluginCapabilities: [
        {
          pluginId: "runtime-plugin",
          capabilityId: "skill-codex",
          kind: "projected_skill",
          targetProviders: ["codex"],
        },
      ],
    });
    expect(status.summary).toContain("active=codex");
    expect(status.summary).toContain("staleGenerated=1");
    expect(status.summary).toContain("manual=1");
  });

  it("resolves portable component source roots from the sibling sources root", () => {
    const root = path.join(makeTempDir("dev-nexus-project-"), "Project");
    fs.mkdirSync(root, { recursive: true });
    saveProjectConfig(root, {
      ...projectConfig("config-id", "Config Project"),
      components: [
        {
          id: "dev-nexus",
          name: "DevNexus",
          kind: "git",
          role: "primary",
          remoteUrl: "git@example.invalid:example/dev-nexus.git",
          defaultBranch: "main",
          sourceRoot: "sourcesRoot:dev-nexus",
          relationships: [],
        },
      ],
    });

    expect(buildNexusProjectStatusForPath(root).components[0]).toMatchObject({
      id: "dev-nexus",
      sourceRoot: path.join(path.dirname(root), "sources", "dev-nexus"),
      sourceRootTopology: expect.objectContaining({
        layout: "explicit-external",
        state: "missing",
        configuredBase: "sourcesRoot",
        exists: false,
      }),
    });
  });

  it("reports missing path status with a generic initialization error", () => {
    const root = makeTempDir("dev-nexus-missing-project-");

    expect(() => buildNexusProjectStatusForPath(root)).toThrow(NexusProjectError);
    expect(() => buildNexusProjectStatusForPath(root)).toThrow(
      `DevNexus workspace is not initialized: ${path.join(
        root,
        devNexusProjectConfigFileName,
      )}`,
    );
  });

  it("upserts references and rejects duplicate ids", () => {
    const firstRoot = path.join(makeTempDir("dev-nexus-project-"), "First");
    const secondRoot = path.join(makeTempDir("dev-nexus-project-"), "Second");
    const registry: NexusProjectRegistry = {
      projects: [
        {
          id: "first",
          name: "First",
          projectRoot: firstRoot,
        },
      ],
    };

    expect(
      upsertNexusProjectReference(
        registry,
        firstRoot,
        projectConfig("first", "First Renamed"),
      ),
    ).toEqual({
      id: "first",
      name: "First Renamed",
      projectRoot: firstRoot,
    });

    expect(() =>
      upsertNexusProjectReference(
        registry,
        secondRoot,
        projectConfig("first", "Duplicate"),
      ),
    ).toThrow(/Workspace id is already registered/);
  });
});
