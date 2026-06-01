import { describe, expect, it } from "vitest";
import {
  normalizeComponentWorkTrackers,
  validateProjectConfig,
} from "../../src/project/nexusProjectConfig.js";

describe("workspace work tracking config", () => {
  it("accepts supported work tracking providers", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "local-tracked-project",
        name: "Local Tracked Project",
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/work-items.json",
        },
      }).workTracking,
    ).toEqual({
      provider: "local",
      storePath: ".dev-nexus/work-items.json",
    });

    expect(
      validateProjectConfig({
        version: 1,
        id: "jira-tracked-project",
        name: "Jira Tracked Project",
        workTracking: {
          provider: "jira",
          host: "example.atlassian.net",
          projectKey: "NEX",
          issueType: "Bug",
          board: {
            kind: "jira-workflow",
            statusOptions: {
              blocked: "31",
              done: "41",
            },
          },
        },
      }).workTracking,
    ).toEqual({
      provider: "jira",
      host: "example.atlassian.net",
      projectKey: "NEX",
      issueType: "Bug",
      board: {
        kind: "jira-workflow",
        statusOptions: {
          blocked: "31",
          done: "41",
        },
      },
    });
  });

  it("accepts component work tracker bindings with an explicit default", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "multi-tracker-project",
        name: "Multi Tracker Project",
        components: [
          {
            id: "core",
            name: "Core",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
            sourceRoot: "components/core",
            defaultWorkTrackerId: "issues",
            workTrackers: [
              {
                id: "issues",
                name: "Issue Tracker",
                enabled: true,
                roles: ["primary", "planning"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "core",
                  },
                },
              },
              {
                id: "audit",
                enabled: false,
                roles: ["archive"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/audit-items.json",
                },
              },
            ],
          },
        ],
      }).components[0],
    ).toMatchObject({
      defaultWorkTrackerId: "issues",
      workTrackers: [
        {
          id: "issues",
          name: "Issue Tracker",
          enabled: true,
          roles: ["primary", "planning"],
          workTracking: {
            provider: "github",
            repository: {
              owner: "example",
              name: "core",
            },
          },
        },
        {
          id: "audit",
          name: "audit",
          enabled: false,
          roles: ["archive"],
          workTracking: {
            provider: "local",
            storePath: ".dev-nexus/audit-items.json",
          },
        },
      ],
    });
  });

  it("accepts project and tracker communication policy", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "tracker-policy-project",
        name: "Tracker Policy Project",
        workTrackerCommunication: {
          coordinationHandoffs: "silent",
        },
        components: [
          {
            id: "core",
            name: "Core",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
            defaultWorkTrackerId: "github",
            workTrackers: [
              {
                id: "github",
                roles: ["primary", "coordination"],
                communication: {
                  coordinationHandoffs: "comment",
                },
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "core",
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      workTrackerCommunication: {
        coordinationHandoffs: "silent",
      },
      components: [
        {
          workTrackers: [
            {
              id: "github",
              communication: {
                coordinationHandoffs: "comment",
              },
            },
          ],
        },
      ],
    });
  });

  it("rejects invalid tracker communication policy", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "bad-tracker-policy-project",
        name: "Bad Tracker Policy Project",
        workTrackerCommunication: {
          coordinationHandoffs: "shout",
        },
        components: [],
      }),
    ).toThrow(/workTrackerCommunication\.coordinationHandoffs/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "bad-tracker-policy-project",
        name: "Bad Tracker Policy Project",
        components: [
          {
            id: "core",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
            defaultWorkTrackerId: "github",
            workTrackers: [
              {
                id: "github",
                roles: ["coordination"],
                communication: {
                  coordinationHandoffs: "external",
                },
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "core",
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(/workTrackers\[0\]\.communication\.coordinationHandoffs/);
  });

  it("normalizes tracker discovery roles and effective default policy", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "tracker-discovery-project",
      name: "Tracker Discovery Project",
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          defaultWorkTrackerId: "local",
          trackerDiscovery: {
            scannedRoles: ["eligible_source", "external_inbox"],
            directExternalSelection: "allowed",
            importRequiredFirst: false,
            providerFilters: ["github", "jira"],
            queryLimit: 25,
            conflictWinner: "scanned_tracker",
            missingCredentialBehavior: "skip",
          },
          workTrackers: [
            {
              id: "local",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
            {
              id: "github-inbox",
              roles: ["eligible_source", "external_inbox"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "example",
                  name: "core",
                },
              },
            },
          ],
        },
      ],
    });

    expect(config.components[0].trackerDiscovery).toEqual({
      scannedRoles: ["eligible_source", "external_inbox"],
      directExternalSelection: "allowed",
      importRequiredFirst: false,
      providerFilters: ["github", "jira"],
      queryLimit: 25,
      trackerLimits: {},
      finalLimit: null,
      statuses: [],
      labels: [],
      milestones: [],
      assignees: [],
      providerQuery: null,
      fingerprints: [],
      conflictWinner: "scanned_tracker",
      missingCredentialBehavior: "skip",
    });
    expect(normalizeComponentWorkTrackers(config.components[0]).discoveryPolicy).toEqual({
      scannedRoles: ["eligible_source", "external_inbox"],
      directExternalSelection: "allowed",
      importRequiredFirst: false,
      providerFilters: ["github", "jira"],
      queryLimit: 25,
      trackerLimits: {},
      finalLimit: null,
      statuses: [],
      labels: [],
      milestones: [],
      assignees: [],
      providerQuery: null,
      fingerprints: [],
      conflictWinner: "scanned_tracker",
      missingCredentialBehavior: "skip",
      defaultTrackerOnly: false,
    });
  });

  it("preserves default-tracker-only discovery when no discovery policy is declared", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "legacy-discovery-project",
      name: "Legacy Discovery Project",
      components: [
        {
          id: "core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          workTracking: {
            provider: "local",
          },
        },
      ],
    });

    expect(config.components[0].trackerDiscovery).toBeUndefined();
    expect(normalizeComponentWorkTrackers(config.components[0]).discoveryPolicy).toEqual({
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
    });
  });

  it("rejects invalid component work tracker bindings", () => {
    const configWithComponentTracker = (
      componentPatch: Record<string, unknown>,
    ) => ({
      version: 1,
      id: "invalid-component-tracker-project",
      name: "Invalid Component Tracker Project",
      components: [
        {
          id: "core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          ...componentPatch,
        },
      ],
    });

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [],
        }),
      ),
    ).toThrow(/workTrackers must not be empty/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [
            {
              id: "issues",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
            {
              id: "issues",
              roles: ["mirror"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/workTrackers contains duplicate id: issues/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          workTrackers: [
            {
              id: "issues",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/defaultWorkTrackerId must reference/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "missing",
          workTrackers: [
            {
              id: "issues",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/defaultWorkTrackerId references unknown tracker: missing/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [
            {
              id: "issues",
              enabled: false,
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/workTrackers must contain at least one enabled tracker/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [
            {
              id: "issues",
              roles: ["external-sync"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/roles\[0\]/);
  });

  it("rejects invalid tracker discovery policies", () => {
    const configWithDiscovery = (
      trackerDiscovery: Record<string, unknown>,
    ) => ({
      version: 1,
      id: "invalid-discovery-project",
      name: "Invalid Discovery Project",
      components: [
        {
          id: "core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          workTracking: {
            provider: "local",
          },
          trackerDiscovery,
        },
      ],
    });

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          scannedRoles: ["external-sync"],
        }),
      ),
    ).toThrow(/trackerDiscovery\.scannedRoles\[0\]/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          directExternalSelection: "allowed",
          importRequiredFirst: true,
        }),
      ),
    ).toThrow(/directExternalSelection cannot be allowed when importRequiredFirst is true/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          providerFilters: ["github", "trello"],
        }),
      ),
    ).toThrow(/trackerDiscovery\.providerFilters\[1\]/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          queryLimit: 0,
        }),
      ),
    ).toThrow(/trackerDiscovery\.queryLimit/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          conflictWinner: "latest_update",
        }),
      ),
    ).toThrow(/trackerDiscovery\.conflictWinner/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          missingCredentialBehavior: "prompt",
        }),
      ),
    ).toThrow(/trackerDiscovery\.missingCredentialBehavior/);
  });


});
