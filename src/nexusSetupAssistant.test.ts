import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
      remoteUrl: "git@github.com-gabot:Gabot-Darbot/mac-demo.git",
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
      "git clone git@github.com:Gabot-Darbot/mac-demo.git $HOME/dev-nexus/mac-demo",
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
    fs.mkdirSync(path.join(projectRoot, "components", "DevNexus"), {
      recursive: true,
    });

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
    expect(check.status).toBe("warning");
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
    fs.mkdirSync(path.join(projectRoot, "components", "DevNexus"), {
      recursive: true,
    });

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
          id: "dev-nexus-pharo",
          enabled: true,
          name: "DevNexus-Pharo",
          version: "0.1.0-alpha.0",
          capabilities: [
            {
              kind: "projected_skill",
              id: "skill-pharo-ci-repro",
              skillId: "pharo-ci-repro",
              targetAgents: ["codex"],
            },
            {
              kind: "mcp_server",
              id: "mcp-plexus",
              serverName: "plexus",
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
    fs.mkdirSync(path.join(projectRoot, "components", "DevNexus"), {
      recursive: true,
    });
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
        id: "plugin-dev-nexus-pharo-skill-pharo-ci-repro-managed",
        status: "warning",
        summary: expect.stringContaining("not materialized"),
      }),
    );
    expect(warningCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-dev-nexus-pharo-skill-pharo-ci-repro-codex",
        status: "warning",
        summary: expect.stringContaining("missing from the codex skill directory"),
      }),
    );
    expect(warningCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-dev-nexus-pharo-mcp-plexus-codex",
        status: "warning",
        summary: expect.stringContaining("not configured for codex"),
      }),
    );

    fs.mkdirSync(
      path.join(projectRoot, ".dev-nexus", "skills", "pharo-ci-repro"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(projectRoot, ".dev-nexus", "skills", "pharo-ci-repro", "SKILL.md"),
      "# Pharo CI Repro\n",
    );
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills", "pharo-ci-repro"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectRoot, ".agents", "skills", "pharo-ci-repro", "SKILL.md"),
      "# Pharo CI Repro\n",
    );
    fs.appendFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "\n[mcp_servers.plexus]\ncommand = \"plexus\"\nargs = [\"mcp-stdio\"]\n",
    );

    const passedCheck = buildNexusSetupCheck({
      projectRoot,
      flowId: "join-existing-project",
      platform: "windows",
    });

    expect(passedCheck.status).toBe("passed");
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-dev-nexus-pharo-skill-pharo-ci-repro-managed",
        status: "passed",
      }),
    );
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-dev-nexus-pharo-skill-pharo-ci-repro-codex",
        status: "passed",
      }),
    );
    expect(passedCheck.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-dev-nexus-pharo-mcp-plexus-codex",
        status: "passed",
      }),
    );
  });

  it("checks safe local Mac setup facts without contacting GitHub", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-check-");
    writeProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, ".git"));
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), "");

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
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), "");
    fs.mkdirSync(path.join(projectRoot, "components", "DevNexus"), {
      recursive: true,
    });

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
