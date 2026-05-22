import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultNexusHomeConfigBase,
  defaultNexusHomePath,
  devNexusHomeConfigFileName,
  loadNexusHomeConfigFile,
  NexusConfigError,
  nexusGeneratedDirectoryName,
  nexusHomeConfigPath,
  nexusLogsDirectoryName,
  resolveNexusHome,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./index.js";

const tempDirs: string[] = [];
const originalDevNexusHome = process.env.DEV_NEXUS_HOME;
const originalNexusTestHome = process.env.NEXUS_TEST_HOME;

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  restoreEnv("DEV_NEXUS_HOME", originalDevNexusHome);
  restoreEnv("NEXUS_TEST_HOME", originalNexusTestHome);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("home config primitives", () => {
  it("resolves default, explicit, and file paths without provider settings", () => {
    const homePath = path.join(makeTempDir("dev-nexus-parent-"), "home");
    const relativeHomePath = path.relative(process.cwd(), homePath);

    process.env.NEXUS_TEST_HOME = homePath;

    expect(
      defaultNexusHomePath({
        envVarName: "NEXUS_TEST_HOME",
        directoryName: ".nexus-test",
      }),
    ).toBe(homePath);
    expect(defaultNexusHomePath()).toBe(path.join(os.homedir(), ".dev-nexus"));
    expect(resolveNexusHome(relativeHomePath)).toBe(path.resolve(homePath));
    expect(nexusHomeConfigPath(relativeHomePath)).toBe(
      path.join(path.resolve(homePath), devNexusHomeConfigFileName),
    );
    expect(nexusLogsDirectoryName).toBe("logs");
    expect(nexusGeneratedDirectoryName).toBe("generated");
    expect(() => resolveNexusHome("   ")).toThrow(NexusConfigError);
  });

  it("creates provider-neutral home defaults", () => {
    const homePath = path.join(makeTempDir("dev-nexus-parent-"), "home");

    expect(
      createDefaultNexusHomeConfigBase(homePath, {
        projectsRoot: "custom-projects",
        workspacesRoot: "custom-workspaces",
        agent: {
          executor: "CODEX",
        },
      }),
    ).toEqual({
      version: 1,
      paths: {
        projectsRoot: path.resolve(homePath, "custom-projects"),
        workspacesRoot: path.resolve(homePath, "custom-workspaces"),
      },
      agent: {
        executor: "CODEX",
      },
      projects: [],
    });
  });

  it("validates host-local hosting auth profiles without storing shared secrets", () => {
    const homePath = path.join(makeTempDir("dev-nexus-home-"), "home");

    expect(
      createDefaultNexusHomeConfigBase(homePath, {
        authProfiles: [
          {
            id: "human-github",
            provider: "github",
            kind: "human",
            account: "alice",
            host: "github.com",
          },
          {
            id: "bot-github",
            actorId: "example-bot-actor",
            provider: "github",
            kind: "automation",
            account: "example-bot",
            sshHost: "github.com-example-bot",
            githubCliConfigDir: path.join(homePath, "gh-example-bot"),
            command: "gh-example-bot",
            environmentKeys: ["GH_CONFIG_DIR"],
            repositoryScopes: ["Evref-BL/DevNexus"],
          },
          {
            id: "dev-nexus-app",
            actorId: "dev-nexus-automation-app",
            provider: "github",
            kind: "app",
            credentialKind: "github_app",
            account: "devnexus-automation",
            host: "github.com",
            environmentKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
            purposes: ["api", "cli"],
            githubApp: {
              appId: "12345",
              clientId: "Iv23example",
              slug: "devnexus-automation",
              privateKeyPath: path.join(homePath, "app.private-key.pem"),
              installationAccount: "Evref-BL",
              repositories: ["DevNexus"],
              tokenRefreshBufferSeconds: 300,
            },
          },
          {
            id: "alice-devnexus-app-user",
            actorId: "alice",
            provider: "github",
            kind: "human",
            credentialKind: "github_app_user_token",
            account: "alice",
            host: "github.com",
            environmentKeys: ["GH_TOKEN"],
            purposes: ["api", "git"],
            command: path.join(homePath, "github-app-user-token.mjs"),
          },
        ],
      }).authProfiles,
    ).toEqual([
      {
        id: "human-github",
        provider: "github",
        kind: "human",
        account: "alice",
        host: "github.com",
      },
      {
        id: "bot-github",
        actorId: "example-bot-actor",
        provider: "github",
        kind: "automation",
        account: "example-bot",
        sshHost: "github.com-example-bot",
        githubCliConfigDir: path.join(homePath, "gh-example-bot"),
        command: "gh-example-bot",
        environmentKeys: ["GH_CONFIG_DIR"],
        repositoryScopes: ["Evref-BL/DevNexus"],
      },
      {
        id: "dev-nexus-app",
        actorId: "dev-nexus-automation-app",
        provider: "github",
        kind: "app",
        credentialKind: "github_app",
        account: "devnexus-automation",
        host: "github.com",
        environmentKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
        purposes: ["api", "cli"],
        githubApp: {
          appId: "12345",
          clientId: "Iv23example",
          slug: "devnexus-automation",
          privateKeyPath: path.join(homePath, "app.private-key.pem"),
          installationAccount: "Evref-BL",
          repositories: ["DevNexus"],
          tokenRefreshBufferSeconds: 300,
        },
      },
      {
        id: "alice-devnexus-app-user",
        actorId: "alice",
        provider: "github",
        kind: "human",
        credentialKind: "github_app_user_token",
        account: "alice",
        host: "github.com",
        environmentKeys: ["GH_TOKEN"],
        purposes: ["api", "git"],
        command: path.join(homePath, "github-app-user-token.mjs"),
      },
    ]);

    expect(() =>
      validateNexusHomeConfigBase({
        version: 1,
        paths: {
          projectsRoot: "projects",
          workspacesRoot: "workspaces",
        },
        authProfiles: [
          {
            id: "bot-github",
            provider: "github",
          },
          {
            id: "bot-github",
            provider: "github",
          },
        ],
        projects: [],
      }),
    ).toThrow(/Auth profile id is duplicated/);

    expect(() =>
      validateNexusHomeConfigBase({
        version: 1,
        paths: {
          projectsRoot: "projects",
          workspacesRoot: "workspaces",
        },
        authProfiles: [
          {
            id: "github-app",
            provider: "github",
            githubApp: {
              privateKeyPath: path.join(homePath, "app.private-key.pem"),
            },
          },
        ],
        projects: [],
      }),
    ).toThrow(/githubApp\.appId or authProfiles\[0\]\.githubApp\.clientId/);
  });

  it("allows GitHub App user-token profiles to carry app metadata without a private key", () => {
    const homePath = path.join(makeTempDir("dev-nexus-home-"), "home");

    expect(
      validateNexusHomeConfigBase({
        version: 1,
        paths: {
          projectsRoot: "projects",
          workspacesRoot: "workspaces",
        },
        authProfiles: [
          {
            id: "alice-devnexus-app-user",
            provider: "github",
            kind: "human",
            credentialKind: "github_app_user_token",
            account: "alice",
            host: "github.com",
            command: path.join(homePath, "github-app-user-token.mjs"),
            purposes: ["api", "git"],
            githubApp: {
              clientId: "Iv23example",
              slug: "devnexus-automation",
              installationAccount: "Evref-BL",
              repositories: ["DevNexus"],
              tokenRefreshBufferSeconds: 300,
            },
          },
        ],
        projects: [],
      }).authProfiles?.[0],
    ).toEqual({
      id: "alice-devnexus-app-user",
      provider: "github",
      kind: "human",
      credentialKind: "github_app_user_token",
      account: "alice",
      host: "github.com",
      command: path.join(homePath, "github-app-user-token.mjs"),
      purposes: ["api", "git"],
      githubApp: {
        clientId: "Iv23example",
        slug: "devnexus-automation",
        installationAccount: "Evref-BL",
        repositories: ["DevNexus"],
        tokenRefreshBufferSeconds: 300,
      },
    });
  });

  it("validates host-local host overlays by stable host id", () => {
    const homePath = path.join(makeTempDir("dev-nexus-home-"), "home");

    expect(
      validateNexusHomeConfigBase({
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        hostOverlays: [
          {
            hostId: "mac-builder",
            transport: {
              kind: "ssh",
              host: "mac-builder.tailnet.example",
              sshUser: "alice",
              port: 22,
              shell: "zsh",
              authProfile: "mac-builder-ssh",
              commandPaths: {
                "dev-nexus": "/Users/alice/.npm/bin/dev-nexus",
              },
            },
            workspaceRoots: {
              projectRoot: "/Users/alice/dev/dev-nexus-dogfood",
              componentsRoot: "/Users/alice/dev/sources",
              worktreesRoot: "/Users/alice/dev/worktrees",
              componentRoots: {
                "dev-nexus": "/Users/alice/dev/sources/dev-nexus",
              },
            },
            notes: "Host-local transport and path details.",
          },
        ],
        projects: [],
      }).hostOverlays,
    ).toEqual([
      {
        hostId: "mac-builder",
        transport: {
          kind: "ssh",
          host: "mac-builder.tailnet.example",
          sshUser: "alice",
          port: 22,
          shell: "zsh",
          authProfile: "mac-builder-ssh",
          commandPaths: {
            "dev-nexus": "/Users/alice/.npm/bin/dev-nexus",
          },
        },
        workspaceRoots: {
          projectRoot: "/Users/alice/dev/dev-nexus-dogfood",
          componentsRoot: "/Users/alice/dev/sources",
          worktreesRoot: "/Users/alice/dev/worktrees",
          componentRoots: {
            "dev-nexus": "/Users/alice/dev/sources/dev-nexus",
          },
        },
        notes: "Host-local transport and path details.",
      },
    ]);

    expect(() =>
      validateNexusHomeConfigBase({
        version: 1,
        paths: {
          projectsRoot: "projects",
          workspacesRoot: "workspaces",
        },
        hostOverlays: [
          { hostId: "mac-builder" },
          { hostId: "mac-builder" },
        ],
        projects: [],
      }),
    ).toThrow(/Host overlay id is duplicated: mac-builder/);
  });

  it("validates project registry entries and rejects duplicate ids", () => {
    const config = createDefaultNexusHomeConfigBase(makeTempDir("dev-nexus-home-"));
    config.projects = [
      {
        id: "tool-a",
        name: "Tool A",
        projectRoot: "C:\\dev\\tools\\a",
        vibeKanbanProjectId: "tracker-a",
      },
      {
        id: "tool-b",
        name: "Tool B",
        projectRoot: "C:\\dev\\tools\\b",
      },
    ];

    expect(validateNexusHomeConfigBase(config).projects).toEqual(config.projects);

    config.projects[1] = {
      id: "tool-a",
      name: "Tool A Duplicate",
      projectRoot: "C:\\dev\\tools\\a-duplicate",
    };

    expect(() => validateNexusHomeConfigBase(config)).toThrow(NexusConfigError);
  });

  it("loads and saves normalized JSON through an injected validator", () => {
    const homePath = path.join(makeTempDir("dev-nexus-parent-"), "nested", "home");
    const config = createDefaultNexusHomeConfigBase(homePath, {
      projectsRoot: "projects-custom",
      workspacesRoot: "workspaces-custom",
    });

    const configPath = saveNexusHomeConfigFile(
      homePath,
      config,
      validateNexusHomeConfigBase,
    );
    const rawConfig = fs.readFileSync(configPath, "utf8");

    expect(configPath).toBe(path.join(homePath, devNexusHomeConfigFileName));
    expect(rawConfig.startsWith("\uFEFF")).toBe(false);
    expect(rawConfig.endsWith("\n")).toBe(true);
    expect(JSON.parse(rawConfig)).toEqual(config);
    expect(
      loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
    ).toEqual(config);
  });

  it("reports a configurable missing home error", () => {
    const homePath = path.join(makeTempDir("dev-nexus-parent-"), "missing");

    expect(() =>
      loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase, {
        missingMessage: (configPath) => `Missing test home: ${configPath}`,
      }),
    ).toThrow(/Missing test home/);
  });
});
