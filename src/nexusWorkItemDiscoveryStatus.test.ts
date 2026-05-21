import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  getNexusWorkItemDiscoveryStatus,
  saveProjectConfig,
  type NexusProjectConfig,
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

function projectConfig(
  components: NexusProjectConfig["components"],
): NexusProjectConfig {
  return {
    version: 1,
    id: "discovery-demo",
    name: "Discovery Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components,
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
    },
  };
}

function saveHomeConfig(
  homePath: string,
  authProfiles: Array<Record<string, unknown>>,
): void {
  fs.mkdirSync(homePath, { recursive: true });
  fs.writeFileSync(
    path.join(homePath, "dev-nexus.home.json"),
    JSON.stringify(
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        authProfiles,
        projects: [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("work item discovery status", () => {
  it("reports defaults, configured trackers, roles, policy, capabilities, and readability", () => {
    const projectRoot = makeTempDir("dev-nexus-discovery-status-");
    saveProjectConfig(
      projectRoot,
      projectConfig([
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: "git@example.invalid:demo/core.git",
          defaultBranch: "main",
          sourceRoot: "source",
          defaultWorkTrackerId: "local",
          workTrackers: [
            {
              id: "local",
              name: "Local Work",
              enabled: true,
              roles: ["primary"],
              workTracking: { provider: "local" },
            },
            {
              id: "github-inbox",
              name: "GitHub Inbox",
              enabled: true,
              roles: ["external_inbox", "eligible_source"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "example",
                  name: "demo",
                },
              },
            },
          ],
          trackerDiscovery: {
            scannedRoles: ["primary", "eligible_source"],
            directExternalSelection: "disabled",
            importRequiredFirst: true,
            providerFilters: [],
            queryLimit: 25,
            conflictWinner: "default_tracker",
            missingCredentialBehavior: "skip",
          },
          relationships: [],
        },
      ]),
    );

    const result = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      env: {},
    });

    expect(result).toMatchObject({
      project: {
        id: "discovery-demo",
      },
      blockers: [],
      warnings: [
        expect.stringContaining("github-inbox skipped"),
      ],
      components: [
        {
          componentId: "core",
          defaultTracker: {
            id: "local",
            provider: "local",
          },
          effectiveDiscoveryPolicy: {
            scannedRoles: ["primary", "eligible_source"],
            queryLimit: 25,
            missingCredentialBehavior: "skip",
            defaultTrackerOnly: false,
          },
          discoveryTrackerIds: ["local", "github-inbox"],
          configuredTrackers: [
            {
              id: "local",
              provider: "local",
              roles: ["primary"],
              default: true,
              selectedForDiscovery: true,
              capabilityReport: {
                provider: "local",
                capabilities: {
                  list: true,
                },
              },
              credentials: {
                status: "not_required",
              },
              readable: {
                status: "readable",
              },
            },
            {
              id: "github-inbox",
              provider: "github",
              roles: ["external_inbox", "eligible_source"],
              selectedForDiscovery: true,
              credentials: {
                status: "missing",
                required: true,
              },
              readable: {
                status: "skipped",
              },
            },
          ],
        },
      ],
    });
  });

  it("reports required missing provider credentials as blockers without mutating local stores", () => {
    const projectRoot = makeTempDir("dev-nexus-discovery-status-");
    const storePath = path.join(projectRoot, ".dev-nexus", "work-items.json");
    const linkPath = path.join(projectRoot, ".dev-nexus", "work-item-links.json");
    saveProjectConfig(
      projectRoot,
      projectConfig([
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: "git@example.invalid:demo/core.git",
          defaultBranch: "main",
          sourceRoot: "source",
          defaultWorkTrackerId: "github-inbox",
          workTrackers: [
            {
              id: "github-inbox",
              name: "GitHub Inbox",
              enabled: true,
              roles: ["primary", "external_inbox"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "example",
                  name: "demo",
                },
              },
            },
          ],
          relationships: [],
        },
      ]),
    );

    const result = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      env: {},
    });

    expect(result.blockers).toEqual([
      expect.stringContaining("github-inbox blocked"),
    ]);
    expect(result.components[0]!.configuredTrackers[0]).toMatchObject({
      id: "github-inbox",
      selectedForDiscovery: true,
      readable: {
        status: "blocked",
      },
    });
    expect(fs.existsSync(storePath)).toBe(false);
    expect(fs.existsSync(linkPath)).toBe(false);
  });

  it("uses automation publication command environment for provider credential visibility", () => {
    const projectRoot = makeTempDir("dev-nexus-discovery-status-");
    saveProjectConfig(
      projectRoot,
      {
        ...projectConfig([
          {
            id: "core",
            name: "Core",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/core.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "local",
            workTrackers: [
              {
                id: "local",
                name: "Local Work",
                enabled: true,
                roles: ["primary"],
                workTracking: { provider: "local" },
              },
              {
                id: "github-inbox",
                name: "GitHub Inbox",
                enabled: true,
                roles: ["eligible_source"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "demo",
                  },
                },
              },
            ],
            trackerDiscovery: {
              scannedRoles: ["primary", "eligible_source"],
              directExternalSelection: "allowed",
              importRequiredFirst: false,
              providerFilters: ["local", "github"],
              queryLimit: 25,
              conflictWinner: "scanned_tracker",
              missingCredentialBehavior: "skip",
            },
            relationships: [],
          },
        ]),
        automation: {
          ...defaultNexusAutomationConfig,
          publication: {
            ...defaultNexusAutomationConfig.publication,
            commandEnvironment: {
              GH_CONFIG_DIR: "home:.config/gh-example-bot",
            },
          },
        },
      },
    );

    const result = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      env: {},
    });

    expect(result.warnings).toEqual([]);
    expect(result.components[0]!.configuredTrackers[1]).toMatchObject({
      id: "github-inbox",
      credentials: {
        status: "available",
      },
      readable: {
        status: "readable",
      },
    });
  });

  it("uses host auth profiles for GitHub tracker credential visibility", () => {
    const projectRoot = makeTempDir("dev-nexus-discovery-status-");
    const homePath = makeTempDir("dev-nexus-home-");
    const commandRuns: Array<{ command: string; args: string[] }> = [];
    saveHomeConfig(homePath, [
      {
        id: "dev-nexus-app",
        actorId: "dev-nexus-automation-app",
        provider: "github",
        kind: "app",
        credentialKind: "github_app",
        account: "devnexus-automation",
        host: "github.com",
        command: "home:secrets/github-app-token.mjs --format token",
        environmentKeys: ["GH_TOKEN"],
      },
    ]);
    saveProjectConfig(
      projectRoot,
      {
        ...projectConfig([
          {
            id: "core",
            name: "Core",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/core.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "github-inbox",
            workTrackers: [
              {
                id: "github-inbox",
                name: "GitHub Inbox",
                enabled: true,
                roles: ["primary", "eligible_source"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "demo",
                  },
                },
              },
            ],
            trackerDiscovery: {
              scannedRoles: ["primary", "eligible_source"],
              directExternalSelection: "allowed",
              importRequiredFirst: false,
              providerFilters: ["github"],
              queryLimit: 25,
              conflictWinner: "scanned_tracker",
              missingCredentialBehavior: "skip",
            },
            relationships: [],
          },
        ]),
        automation: {
          ...defaultNexusAutomationConfig,
          publication: {
            ...defaultNexusAutomationConfig.publication,
            actor: {
              id: "dev-nexus-automation-app",
              kind: "app",
              provider: "github",
              handle: "devnexus-automation",
            },
          },
        },
        authority: {
          actors: [
            {
              id: "dev-nexus-automation-app",
              kind: "service_account",
              provider: "github",
              providerIdentity: "devnexus-automation",
              displayName: "DevNexus Automation",
            },
          ],
          roleBindings: [
            {
              actorId: "dev-nexus-automation-app",
              roles: ["maintainer"],
              scope: { project: "discovery-demo" },
            },
          ],
        },
      },
    );

    const result = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      homePath,
      env: {},
      credentialCommandRunner: (command, args) => {
        commandRuns.push({ command, args });
        return {
          status: 0,
          stdout: "installation-token",
          stderr: "",
        };
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.components[0]!.configuredTrackers[0]).toMatchObject({
      id: "github-inbox",
      credentials: {
        status: "available",
        message: expect.stringContaining("auth profile dev-nexus-app"),
      },
      readable: {
        status: "readable",
      },
    });
    expect(commandRuns).toEqual([
      {
        command: path.join(homePath, "secrets/github-app-token.mjs"),
        args: ["--format", "token"],
      },
    ]);
  });

  it("keeps the default policy scoped to only the component default tracker", () => {
    const projectRoot = makeTempDir("dev-nexus-discovery-status-");
    saveProjectConfig(
      projectRoot,
      projectConfig([
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: "git@example.invalid:demo/core.git",
          defaultBranch: "main",
          sourceRoot: "source",
          defaultWorkTrackerId: "local",
          workTrackers: [
            {
              id: "local",
              name: "Local Work",
              enabled: true,
              roles: ["primary"],
              workTracking: { provider: "local" },
            },
            {
              id: "archive",
              name: "Archive",
              enabled: true,
              roles: ["archive"],
              workTracking: { provider: "local", storePath: "archive.json" },
            },
          ],
          relationships: [],
        },
      ]),
    );

    const result = getNexusWorkItemDiscoveryStatus({
      projectRoot,
      env: {},
    });

    expect(result.components[0]).toMatchObject({
      effectiveDiscoveryPolicy: {
        defaultTrackerOnly: true,
      },
      discoveryTrackerIds: ["local"],
      configuredTrackers: [
        {
          id: "local",
          selectedForDiscovery: true,
        },
        {
          id: "archive",
          selectedForDiscovery: false,
        },
      ],
    });
  });
});
