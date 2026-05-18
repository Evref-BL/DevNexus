import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusSetupCheck,
  buildNexusSetupPlan,
  listNexusSetupFlows,
  recordNexusSetupStep,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeProject(root: string, overrides: Partial<NexusProjectConfig> = {}) {
  const config: NexusProjectConfig = {
    version: 1,
    id: "mac-demo",
    name: "Mac Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@github.com-bot:ExampleOrg/mac-demo.git",
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
        defaultBranch: "main",
        sourceRoot: "components/DevNexus",
        relationships: [],
      },
    ],
    ...overrides,
  };
  fs.writeFileSync(
    path.join(root, "dev-nexus.project.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

function writeHome(root: string, authProfiles: unknown[] = []) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "dev-nexus.home.json"),
    `${JSON.stringify({
      version: 1,
      paths: {
        projectsRoot: path.join(root, "projects"),
        workspacesRoot: path.join(root, "workspaces"),
      },
      authProfiles,
      projects: [],
    }, null, 2)}\n`,
  );
}

function createComponentGitCheckout(projectRoot: string) {
  const componentRoot = path.join(projectRoot, "components", "DevNexus");
  fs.mkdirSync(componentRoot, { recursive: true });
  childProcess.execFileSync("git", ["init"], { cwd: componentRoot });
  childProcess.execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:Evref-BL/DevNexus.git"],
    { cwd: componentRoot },
  );
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus setup assistant", () => {
  it("lists setup flows with the Mac new-machine flow", () => {
    expect(listNexusSetupFlows()).toContainEqual(
      expect.objectContaining({
        id: "join-existing-project",
        title: "Join an existing DevNexus project on this machine",
      }),
    );
  });

  it("builds a GitHub meta-project setup plan without automatic creation or secrets", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-github-meta-");
    writeProject(projectRoot, {
      hosting: {
        provider: "github",
        namespace: "ExampleOrg",
        repository: {
          nameTemplate: "{projectNameSlug}-meta",
          visibility: "private",
          defaultBranch: "main",
        },
        authProfile: "human-github",
        remotes: [
          {
            name: "origin",
            role: "human",
            protocol: "ssh",
          },
          {
            name: "bot",
            role: "automation",
            protocol: "ssh",
            authProfile: "bot-github",
            sshHost: "github.com-example-bot",
          },
        ],
        provisioning: {
          allowCreate: false,
        },
      },
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "github-meta-project",
      platform: "macos",
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      "choose-hosting-namespace",
      "configure-auth-profile",
      "connect-meta-repository",
      "configure-publication-guardrails",
      "write-setup-report",
    ]);
    const namespaceStep = plan.steps.find(
      (step) => step.id === "choose-hosting-namespace",
    )!;
    expect(namespaceStep.summary).toContain("recommended organization namespace");
    expect(namespaceStep.manualInstructions.join("\n")).toContain(
      "DevNexus must not automate account or organization creation",
    );
    const authStep = plan.steps.find((step) => step.id === "configure-auth-profile")!;
    expect(authStep.commands).toContain(
      'GH_CONFIG_DIR="$HOME/.config/gh-bot-github" gh auth login --hostname github.com --git-protocol ssh --web',
    );
    expect(authStep.checks).toContain("ssh -T git@github.com-example-bot");
    const connectStep = plan.steps.find((step) => step.id === "connect-meta-repository")!;
    expect(connectStep.commands).toContain("gh repo view ExampleOrg/mac-demo-meta");
    expect(connectStep.commands.some((command) => command.includes("gh repo create")))
      .toBe(false);
    expect(connectStep.commands).not.toContain("git push bot main");
    expect(connectStep.commands).toContain(
      "git remote set-url origin git@github.com:ExampleOrg/mac-demo-meta.git",
    );
    expect(connectStep.commands).toContain(
      "git remote get-url bot >/dev/null 2>&1 && git remote set-url bot git@github.com-example-bot:ExampleOrg/mac-demo-meta.git || git remote add bot git@github.com-example-bot:ExampleOrg/mac-demo-meta.git",
    );
    expect(JSON.stringify(plan)).not.toContain("gho_");
    expect(JSON.stringify(plan)).not.toContain("PRIVATE KEY");
  });

  it("marks GitHub meta-project repository creation as approval-required when policy allows creation", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-github-create-");
    writeProject(projectRoot, {
      hosting: {
        provider: "github",
        namespace: "ExampleOrg",
        repository: {
          name: "shared-meta",
          visibility: "private",
          defaultBranch: "main",
        },
        remotes: [
          {
            name: "origin",
            role: "human",
            protocol: "ssh",
            authProfile: "human-github",
          },
          {
            name: "bot",
            role: "automation",
            protocol: "ssh",
            authProfile: "bot-github",
          },
        ],
        provisioning: {
          allowCreate: true,
        },
      },
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "github-meta-project",
      platform: "macos",
    });
    const connectStep = plan.steps.find((step) => step.id === "connect-meta-repository")!;

    expect(connectStep.commands).toContain(
      'GH_CONFIG_DIR="$HOME/.config/gh-bot-github" gh repo create ExampleOrg/shared-meta --private --disable-wiki --disable-issues',
    );
    expect(connectStep.summary).toContain("requires explicit approval");
    expect(connectStep.manualInstructions.join("\n")).toContain(
      "approval-required proposal",
    );
    expect(connectStep.commands).not.toContain("git push bot main");
  });

  it("builds a Mac setup plan from project metadata without secrets", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-plan-");
    writeProject(projectRoot);

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });

    expect(plan.project).toMatchObject({
      id: "mac-demo",
      root: projectRoot,
    });
    expect(plan.steps.map((step) => step.id)).toEqual([
      "install-prerequisites",
      "clone-or-update-meta-repo",
      "configure-human-github-auth",
      "configure-automation-auth-profile",
      "configure-meta-remotes",
      "prepare-component-checkouts",
      "refresh-agent-mcp-and-skills",
      "open-agent-project-session",
      "run-final-preflight",
    ]);
    const installStep = plan.steps.find((step) => step.id === "install-prerequisites")!;
    expect(installStep.manualInstructions.join("\n")).toContain(
      "For freshly published dogfood packages, setup should wait for npm packument and dist-tag visibility with bounded retry/backoff before installing.",
    );
    expect(plan.steps.find((step) => step.id === "configure-automation-auth-profile"))
      .toMatchObject({
        kind: "manual",
        scope: "host-local",
      });
    const cloneStep = plan.steps.find((step) => step.id === "clone-or-update-meta-repo")!;
    expect(cloneStep.summary).toContain("DevNexus project root");
    expect(cloneStep.summary).toContain("not a component source checkout");
    expect(cloneStep.commands).toContain("mkdir -p $HOME/dev-nexus");
    expect(cloneStep.commands).toContain(
      "git clone git@github.com:ExampleOrg/mac-demo.git $HOME/dev-nexus/mac-demo",
    );
    expect(cloneStep.manualInstructions).toContain(
      "The cloned meta repository root becomes the DevNexus project root for later setup, MCP refresh, automation, and work-item commands.",
    );
    const refreshStep = plan.steps.find(
      (step) => step.id === "refresh-agent-mcp-and-skills",
    )!;
    expect(refreshStep.commands).toContain("dev-nexus project mcp refresh .");
    expect(refreshStep.checks).toContain("test -f .codex/config.toml");
    expect(refreshStep.checks.join("\n")).not.toContain(".codex\\config.toml");
    const agentStep = plan.steps.find(
      (step) => step.id === "open-agent-project-session",
    )!;
    expect(agentStep).toMatchObject({
      kind: "manual",
      scope: "host-local",
    });
    expect(agentStep.summary).toContain("does not mutate private agent app state");
    expect(agentStep.commands).toContain(
      'dev-nexus setup record . join-existing-project open-agent-project-session --status completed --note "DevNexus MCP tools visible in the configured agent application."',
    );
    expect(agentStep.manualInstructions.join("\n")).toContain(
      "create, open, or select a project/session rooted at $HOME/dev-nexus/mac-demo",
    );
    expect(agentStep.manualInstructions.join("\n")).toContain(
      "other providers may use a different project/session model",
    );
    expect(agentStep.manualInstructions.join("\n")).toContain(
      "Do not edit provider global state or app databases directly",
    );
    expect(JSON.stringify(plan)).not.toContain("gho_");
    expect(JSON.stringify(plan)).not.toContain("PRIVATE KEY");
    expect(plan.nextActions[0]).toContain("fresh DevNexus project root");
  });

  it("resolves automatic platform selection to the current host", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-auto-platform-");
    writeProject(projectRoot);

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
    });

    expect(plan.platform).not.toBe("auto");
  });

  it("uses configured meta-project hosting remotes in setup guidance", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-hosting-remotes-");
    writeProject(projectRoot, {
      hosting: {
        provider: "github",
        namespace: "ExampleOrg",
        repository: {
          nameTemplate: "{projectId}",
          visibility: "private",
          defaultBranch: "main",
        },
        remotes: [
          {
            name: "origin",
            role: "human",
            protocol: "ssh",
          },
          {
            name: "bot",
            role: "automation",
            protocol: "ssh",
            authProfile: "bot-github",
            sshHost: "github.com-example-bot",
          },
        ],
        provisioning: {
          allowCreate: false,
        },
      },
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });
    const cloneStep = plan.steps.find((step) => step.id === "clone-or-update-meta-repo")!;
    const remotesStep = plan.steps.find((step) => step.id === "configure-meta-remotes")!;

    expect(cloneStep.commands).toContain(
      "git clone git@github.com:ExampleOrg/mac-demo.git $HOME/dev-nexus/mac-demo",
    );
    expect(remotesStep.commands).toContain(
      "git remote set-url origin git@github.com:ExampleOrg/mac-demo.git",
    );
    expect(remotesStep.commands).toContain(
      "git remote get-url bot >/dev/null 2>&1 && git remote set-url bot git@github.com-example-bot:ExampleOrg/mac-demo.git || git remote add bot git@github.com-example-bot:ExampleOrg/mac-demo.git",
    );
  });

  it("reports GitHub meta-project remote and host-local auth profile readiness", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-github-check-");
    const homeRoot = path.join(projectRoot, "home");
    writeHome(homeRoot, [
      {
        id: "human-github",
        provider: "github",
        kind: "human",
        account: "alice",
        host: "github.com",
      },
    ]);
    writeProject(projectRoot, {
      home: homeRoot,
      hosting: {
        provider: "github",
        namespace: "ExampleOrg",
        repository: {
          name: "mac-demo",
          visibility: "private",
          defaultBranch: "main",
        },
        authProfile: "human-github",
        remotes: [
          {
            name: "origin",
            role: "human",
            protocol: "ssh",
          },
          {
            name: "bot",
            role: "automation",
            protocol: "ssh",
            authProfile: "bot-github",
            sshHost: "github.com-example-bot",
          },
        ],
        provisioning: {
          allowCreate: false,
        },
      },
    });
    childProcess.execFileSync("git", ["init"], { cwd: projectRoot });
    childProcess.execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:WrongOrg/mac-demo.git"],
      { cwd: projectRoot },
    );
    childProcess.execFileSync(
      "git",
      ["remote", "add", "bot", "git@github.com-example-bot:ExampleOrg/mac-demo.git"],
      { cwd: projectRoot },
    );

    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "github-meta-project",
      platform: "windows",
    });

    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "meta-remote-origin",
        status: "blocked",
        summary: expect.stringContaining("WrongOrg"),
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "meta-remote-bot",
        status: "passed",
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "github-hosting-auth-profile-human-github",
        status: "passed",
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "github-hosting-auth-profile-bot-github",
        status: "blocked",
        summary: expect.stringContaining("does not define auth profile bot-github"),
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "github-hosting-provider-live-preflight",
        status: "warning",
      }),
    );

    const joinCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });
    expect(joinCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "meta-remote-origin",
        status: "blocked",
        summary: expect.stringContaining("WrongOrg"),
      }),
    );
    expect(joinCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "github-hosting-auth-profile-bot-github",
        status: "blocked",
        summary: expect.stringContaining("does not define auth profile bot-github"),
      }),
    );
    expect(joinCheck.checks).not.toContainEqual(
      expect.objectContaining({
        id: "github-meta-final-report",
      }),
    );
  });

  it("blocks setup when an existing component source root is not a clean expected Git checkout", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-component-git-");
    writeProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );
    const componentRoot = path.join(projectRoot, "components", "DevNexus");
    fs.mkdirSync(componentRoot, { recursive: true });

    const notGitCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(notGitCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-git-checkout",
        status: "blocked",
        summary: expect.stringContaining("not a Git checkout"),
      }),
    );

    fs.rmSync(componentRoot, { recursive: true, force: true });
    fs.mkdirSync(componentRoot, { recursive: true });
    childProcess.execFileSync("git", ["init"], { cwd: componentRoot });
    childProcess.execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:WrongOrg/DevNexus.git"],
      { cwd: componentRoot },
    );
    const wrongRemoteCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(wrongRemoteCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-origin-remote",
        status: "blocked",
        summary: expect.stringContaining("WrongOrg"),
      }),
    );

    childProcess.execFileSync(
      "git",
      ["remote", "set-url", "origin", "git@github.com:Evref-BL/DevNexus.git"],
      { cwd: componentRoot },
    );
    fs.writeFileSync(path.join(componentRoot, "local-change.txt"), "dirty\n");

    const dirtyCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(dirtyCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-dirty-state",
        status: "blocked",
        summary: expect.stringContaining("dirty local changes"),
      }),
    );
  });

  it("keeps OS-local Windows component paths out of Mac setup commands", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-mac-paths-");
    writeProject(projectRoot, {
      components: [
        {
          id: "dev-nexus",
          name: "DevNexus",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
          defaultBranch: "main",
          sourceRoot: "C:\\dev\\code\\DevNexus",
          relationships: [],
        },
      ],
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });
    const prepareStep = plan.steps.find(
      (step) => step.id === "prepare-component-checkouts",
    )!;
    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });

    expect(prepareStep.commands.join("\n")).toContain(
      "$HOME/dev-nexus/sources/dev-nexus",
    );
    expect(prepareStep.commands.join("\n")).not.toContain("C:\\dev\\code\\DevNexus");
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-source-root",
        status: "blocked",
        summary: expect.stringContaining("another OS"),
      }),
    );
  });

  it("uses portable component source roots in Mac setup commands", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-portable-paths-");
    writeProject(projectRoot, {
      components: [
        {
          id: "dev-nexus",
          name: "DevNexus",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
          defaultBranch: "main",
          sourceRoot: "sourcesRoot:dev-nexus",
          relationships: [],
        },
      ],
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });
    const prepareStep = plan.steps.find(
      (step) => step.id === "prepare-component-checkouts",
    )!;
    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });

    expect(prepareStep.commands.join("\n")).toContain("sources/dev-nexus");
    expect(prepareStep.commands.join("\n")).not.toContain("sourcesRoot:");
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-source-root",
        status: "blocked",
        summary: expect.stringContaining("sources"),
      }),
    );
    expect(check.checks).not.toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-source-root",
        summary: expect.stringContaining("another OS"),
      }),
    );
  });

  it("uses configured agent MCP targets in setup guidance and checks", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-agent-targets-");
    writeProject(projectRoot, {
      mcp: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });
    const refreshStep = plan.steps.find(
      (step) => step.id === "refresh-agent-mcp-and-skills",
    )!;

    const normalizedChecks = refreshStep.checks.map((check) =>
      check.replace(/\\/gu, "/"),
    );
    expect(refreshStep.commands).toContain("dev-nexus project mcp refresh .");
    expect(normalizedChecks).toContain("test -f .codex/config.toml");
    expect(normalizedChecks).toContain("test -f .mcp.json");

    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), "");
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), "{}");
    createComponentGitCheckout(projectRoot);

    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-config-codex",
        status: "passed",
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-config-claude",
        status: "passed",
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-server-codex-dev_nexus",
        status: "warning",
        summary: expect.stringContaining("missing from .codex"),
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-server-claude-dev_nexus",
        status: "warning",
        summary: expect.stringContaining("missing from .mcp.json"),
      }),
    );
    expect(check.status).toBe("warning");
  });

  it("passes the agent MCP server check when the expected server is configured", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-agent-server-");
    writeProject(projectRoot, {
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
    });
    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );
    createComponentGitCheckout(projectRoot);

    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-server-codex-dev_nexus",
        status: "passed",
      }),
    );
  });

  it("lists OpenCode and manual provider MCP targets in setup guidance and checks", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-provider-targets-");
    writeProject(projectRoot, {
      mcp: {
        agentTargets: [
          { agent: "opencode" },
          {
            agent: "custom-agent",
            provider: "custom",
            configPath: "docs/custom-agent-mcp.md",
            configFormat: "manual",
            configSchema: "custom.manual",
          },
        ],
      },
    });

    const plan = buildNexusSetupPlan({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });
    const refreshStep = plan.steps.find(
      (step) => step.id === "refresh-agent-mcp-and-skills",
    )!;
    const agentStep = plan.steps.find(
      (step) => step.id === "open-agent-project-session",
    )!;

    expect(refreshStep.checks).toContain("test -f opencode.json");
    expect(refreshStep.checks).toContain("test -f docs/custom-agent-mcp.md");
    expect(refreshStep.manualInstructions.join("\n")).toContain(
      "opencode/opencode materialized opencode.json json/opencode.mcp.local",
    );
    expect(agentStep.manualInstructions.join("\n")).toContain(
      "custom-agent/custom manual docs/custom-agent-mcp.md manual/custom.manual",
    );

    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.writeFileSync(
      path.join(projectRoot, "opencode.json"),
      `${JSON.stringify({
        mcp: {
          dev_nexus: {
            type: "local",
            command: ["dev-nexus", "mcp-stdio"],
          },
        },
      }, null, 2)}\n`,
    );
    createComponentGitCheckout(projectRoot);

    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-config-opencode",
        status: "passed",
        summary: expect.stringContaining("opencode.json"),
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-mcp-gap-custom-agent-manual-provider-config-required",
        status: "warning",
        summary: expect.stringContaining("manual MCP config is required"),
      }),
    );
  });

  it("warns when plugin-projected skills and MCP servers are not materialized", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-plugin-projection-");
    writeProject(projectRoot, {
      mcp: {
        agentTargets: [{ agent: "codex" }],
      },
      skills: {
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [
        {
          id: "example-runtime-plugin",
          enabled: true,
          name: "Example Runtime Plugin",
          version: "0.1.0-alpha.0",
          capabilities: [
            {
              kind: "projected_skill",
              id: "skill-example-diagnostic",
              skillId: "example-diagnostic",
              targetAgents: ["codex"],
            },
            {
              kind: "mcp_server",
              id: "mcp-example-runtime",
              serverName: "example_runtime",
            },
          ],
        },
      ],
    });
    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );
    createComponentGitCheckout(projectRoot);
    recordNexusSetupStep({
      projectRoot,
      flowId: "join-existing-project",
      stepId: "open-agent-project-session",
      status: "completed",
      note: "DevNexus MCP visible in fresh agent session.",
      now: () => "2026-05-17T16:00:00.000Z",
    });

    const warningCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(warningCheck.status).toBe("warning");
    expect(warningCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-skill-example-diagnostic-managed",
        status: "warning",
        summary: expect.stringContaining("not materialized"),
      }),
    );
    expect(warningCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-skill-example-diagnostic-codex",
        status: "warning",
        summary: expect.stringContaining("missing from the codex skill directory"),
      }),
    );
    expect(warningCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-mcp-example_runtime-codex",
        status: "warning",
        summary: expect.stringContaining("not configured for codex"),
      }),
    );

    fs.mkdirSync(
      path.join(projectRoot, ".dev-nexus", "skills", "example-diagnostic"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(projectRoot, ".dev-nexus", "skills", "example-diagnostic", "SKILL.md"),
      "# Example Diagnostic\n",
    );
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills", "example-diagnostic"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectRoot, ".agents", "skills", "example-diagnostic", "SKILL.md"),
      "# Example Diagnostic\n",
    );
    fs.appendFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "\n[mcp_servers.example_runtime]\ncommand = \"missing-dev-nexus-mcp-command\"\nargs = [\"mcp-stdio\"]\n",
    );

    const missingCommandCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(missingCommandCheck.status).toBe("warning");
    expect(missingCommandCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-mcp-example_runtime-codex",
        status: "warning",
        summary: expect.stringContaining("command missing-dev-nexus-mcp-command is not available on PATH"),
      }),
    );
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n\n[mcp_servers.example_runtime]\ncommand = \"node\"\nargs = [\"mcp-stdio\"]\n",
    );

    const passedCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(passedCheck.status).toBe("passed");
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-skill-example-diagnostic-managed",
        status: "passed",
      }),
    );
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-skill-example-diagnostic-codex",
        status: "passed",
      }),
    );
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-example-runtime-plugin-mcp-example_runtime-codex",
        status: "passed",
      }),
    );
  });

  it("checks safe local Mac setup facts without contacting GitHub", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-check-");
    writeProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );

    const check = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "macos",
    });

    expect(check.status).toBe("blocked");
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "project-config",
        status: "passed",
      }),
    );
    expect(check.checks).toContainEqual(
      expect.objectContaining({
        id: "component-dev-nexus-source-root",
        status: "blocked",
      }),
    );
  });

  it("warns until agent MCP visibility is recorded for the host", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-agent-session-");
    writeProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "[mcp_servers.dev_nexus]\ncommand = \"dev-nexus\"\nargs = [\"mcp-stdio\"]\n",
    );
    createComponentGitCheckout(projectRoot);

    const warningCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(warningCheck.status).toBe("warning");
    expect(warningCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-project-session",
        status: "warning",
        summary: expect.stringContaining("has not been recorded"),
      }),
    );
    expect(warningCheck.nextActions.join("\n")).toContain(
      "open-agent-project-session",
    );

    recordNexusSetupStep({
      projectRoot,
      flowId: "join-existing-project",
      stepId: "open-agent-project-session",
      status: "completed",
      note: "DevNexus MCP visible in fresh agent session.",
      now: () => "2026-05-17T16:00:00.000Z",
    });

    const passedCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(passedCheck.status).toBe("passed");
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-project-session",
        status: "passed",
      }),
    );
  });

  it("records host-local setup progress outside shared project config", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-record-");
    writeProject(projectRoot);

    const result = recordNexusSetupStep({
      projectRoot,
      flowId: "join-existing-project",
      stepId: "configure-human-github-auth",
      status: "completed",
      note: "Personal gh auth verified.",
      now: () => "2026-05-17T14:00:00.000Z",
    });

    expect(result.statePath).toBe(
      path.join(projectRoot, ".dev-nexus", "host-setup", "setup-state.json"),
    );
    expect(result.state.flows["join-existing-project"]?.steps[
      "configure-human-github-auth"
    ]).toMatchObject({
      status: "completed",
      note: "Personal gh auth verified.",
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(projectRoot, "dev-nexus.project.json"), "utf8")),
    ).toMatchObject({
      id: "mac-demo",
    });
  });
});
