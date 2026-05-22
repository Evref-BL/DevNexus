import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import {
  aggregateNexusProjectSetupReadinessVerdict,
  buildNexusProjectSetupReadinessReport,
} from "./nexusProjectSetupReadiness.js";
import {
  defaultLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";
import {
  defaultNexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import {
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  recordNexusSetupStep,
} from "./nexusSetupAssistant.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function captureOutput() {
  let output = "";
  return {
    writer: {
      write(chunk: string): boolean {
        output += chunk;
        return true;
      },
    },
    output: () => output,
  };
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "demo",
        name: "Demo",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/source.git",
        defaultBranch: "main",
        sourceRoot: "source",
        workTracking: {
          provider: "local",
        },
        relationships: [],
      },
    ],
    mcp: {
      enabled: false,
      command: "dev-nexus",
      args: ["mcp-stdio"],
      agentTargets: [],
    },
    skills: {
      defaultCorePack: false,
      agentTargets: [],
    },
    hosting: {
      provider: "github",
      namespace: "ExampleOrg",
      repository: {
        name: "demo-project",
        visibility: "private",
        defaultBranch: "main",
      },
      remotes: [
        {
          name: "origin",
          role: "human",
          protocol: "ssh",
        },
      ],
      access: [],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
      },
    },
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
      },
    },
    ...overrides,
  };
}

function writeReadySupport(projectRoot: string): void {
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Agent Guide\n", "utf8");
  fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), "", "utf8");
  fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "worktrees"), { recursive: true });
  const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify(
      {
        version: 1,
        nextNumber: 1,
        nextCommentNumber: 1,
        updatedAt: "2026-05-19T00:00:00.000Z",
        items: [],
        comments: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  recordNexusSetupStep({
    projectRoot,
    flowId: "join-existing-project",
    stepId: "open-agent-project-session",
    status: "completed",
    now: () => "2026-05-19T00:00:00.000Z",
  });
}

describe("nexus workspace setup readiness", () => {
  it("aggregates readiness verdicts", () => {
    expect(aggregateNexusProjectSetupReadinessVerdict([
      { status: "passed" },
      { status: "passed" },
    ])).toBe("ready");
    expect(aggregateNexusProjectSetupReadinessVerdict([
      { status: "passed" },
      { status: "warning" },
    ])).toBe("ready_with_warnings");
    expect(aggregateNexusProjectSetupReadinessVerdict([
      { status: "warning" },
      { status: "blocked" },
    ])).toBe("blocked");
  });

  it("reports missing support files and concrete actions", () => {
    const projectRoot = makeTempDir("dev-nexus-readiness-missing-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusProjectSetupReadinessReport({ projectRoot });

    expect(report.verdict).toBe("blocked");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agents-md",
          status: "blocked",
          nextAction: expect.stringContaining("Add AGENTS.md"),
        }),
        expect.objectContaining({
          id: "component-demo-source-root",
          status: "blocked",
        }),
        expect.objectContaining({
          id: "worktrees-root",
          status: "warning",
        }),
        expect.objectContaining({
          id: "local-tracker-store-demo",
          status: "warning",
        }),
      ]),
    );
    expect(report.actions.map((action) => action.checkId)).toEqual(
      expect.arrayContaining(["agents-md", "component-demo-source-root"]),
    );
  });

  it("reports a ready project when post-setup support state is present", () => {
    const projectRoot = makeTempDir("dev-nexus-readiness-ready-");
    saveProjectConfig(projectRoot, projectConfig());
    writeReadySupport(projectRoot);

    const report = buildNexusProjectSetupReadinessReport({ projectRoot });

    expect(report.verdict).toBe("ready");
    expect(report.actions).toEqual([]);
  });

  it("warns when GitHub App user-to-server profiles still need host-local authorization checks", () => {
    const projectRoot = makeTempDir("dev-nexus-readiness-app-user-");
    const homePath = makeTempDir("dev-nexus-readiness-app-user-home-");
    saveNexusHomeConfigFile(
      homePath,
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        authProfiles: [
          {
            id: "gabriel-devnexus-app-user",
            actorId: "gabriel",
            provider: "github",
            kind: "human",
            credentialKind: "github_app_user_token",
            account: "Gabriel-Darbord",
            host: "github.com",
            purposes: ["api", "git"],
            command: "/secrets/github-app-user-token.mjs",
          },
        ],
        projects: [],
      },
      validateNexusHomeConfigBase,
    );
    const config = projectConfig({ home: homePath });
    config.hosting!.remotes = [
      {
        name: "origin",
        role: "human",
        protocol: "https",
        authProfile: "gabriel-devnexus-app-user",
      },
    ];
    saveProjectConfig(projectRoot, config);
    writeReadySupport(projectRoot);

    const report = buildNexusProjectSetupReadinessReport({ projectRoot });

    expect(report.verdict).toBe("ready_with_warnings");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "auth-inventory",
          status: "warning",
          summary: expect.stringContaining("gabriel-devnexus-app-user"),
          nextAction: expect.stringContaining("dev-nexus auth github-app user login"),
        }),
      ]),
    );
  });

  it("prints CLI JSON for missing support files", async () => {
    const projectRoot = makeTempDir("dev-nexus-readiness-cli-missing-");
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();

    const exitCode = await main(
      ["setup", "readiness", projectRoot, "--json"],
      { stdout: output.writer },
    );

    expect(exitCode).toBe(2);
    const payload = JSON.parse(output.output()) as {
      ok: boolean;
      report: { verdict: string; actions: Array<{ checkId: string }> };
    };
    expect(payload.ok).toBe(false);
    expect(payload.report.verdict).toBe("blocked");
    expect(payload.report.actions.map((action) => action.checkId)).toContain("agents-md");
  });

  it("prints short CLI output for a ready project", async () => {
    const projectRoot = makeTempDir("dev-nexus-readiness-cli-ready-");
    saveProjectConfig(projectRoot, projectConfig());
    writeReadySupport(projectRoot);
    const output = captureOutput();

    const exitCode = await main(
      ["setup", "readiness", projectRoot],
      { stdout: output.writer },
    );

    expect(exitCode).toBe(0);
    expect(output.output()).toContain("DevNexus setup readiness: ready.");
  });
});
