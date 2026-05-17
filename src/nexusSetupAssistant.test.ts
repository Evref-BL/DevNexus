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
      "run-final-preflight",
    ]);
    expect(plan.steps.find((step) => step.id === "configure-automation-auth-profile"))
      .toMatchObject({
        kind: "manual",
        scope: "host-local",
      });
    expect(JSON.stringify(plan)).not.toContain("gho_");
    expect(JSON.stringify(plan)).not.toContain("PRIVATE KEY");
    expect(plan.nextActions[0]).toContain("Install prerequisites");
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
