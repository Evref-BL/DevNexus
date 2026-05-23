import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  prepareNexusAutomationHeartbeat,
  saveProjectConfig,
  type NexusProjectConfig,
} from "../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
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
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["dogfood"],
        excludeLabels: ["blocked"],
        limit: 7,
      },
      agent: {
        ...defaultNexusAutomationConfig.agent,
        maxConcurrentSubagents: 3,
      },
      target: {
        ...defaultNexusAutomationConfig.target,
        statePath: ".dev-nexus/automation/dogfood-target.md",
      },
    },
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/core.git",
        defaultBranch: "main",
        sourceRoot: "components/core",
        worktreesRoot: "worktrees/core",
        defaultWorkTrackerId: "local",
        workTrackers: [
          {
            id: "local",
            name: "Local",
            enabled: true,
            roles: ["primary"],
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items/core.json",
            },
          },
          {
            id: "github",
            name: "GitHub",
            enabled: true,
            roles: ["eligible_source"],
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
      {
        id: "plugin",
        name: "Plugin",
        kind: "git",
        role: "addon",
        remoteUrl: null,
        defaultBranch: "main",
        sourceRoot: "components/plugin",
        worktreesRoot: "worktrees/plugin",
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation heartbeat preparation", () => {
  it("renders a Codex heartbeat recipe from DevNexus workspace metadata", () => {
    const projectRoot = makeTempDir("dev-nexus-heartbeat-project-");
    saveProjectConfig(projectRoot, projectConfig());

    const preparation = prepareNexusAutomationHeartbeat({
      projectRoot,
      intervalMinutes: 30,
      status: "PAUSED",
      name: "Dogfood heartbeat",
    });

    expect(preparation.project).toEqual({
      id: "demo-project",
      name: "Demo Project",
    });
    expect(preparation.automation).toMatchObject({
      configured: true,
      mode: "agent_launch",
      maxConcurrentSubagents: 3,
      targetStatePath: path.join(
        projectRoot,
        ".dev-nexus",
        "automation",
        "dogfood-target.md",
      ),
    });
    expect(preparation.components).toMatchObject([
      {
        id: "core",
        defaultTrackerId: "local",
        trackerCount: 2,
      },
      {
        id: "plugin",
      },
    ]);
    expect(preparation.codexAutomation).toMatchObject({
      kind: "heartbeat",
      destination: "thread",
      name: "Dogfood heartbeat",
      rrule: "FREQ=MINUTELY;INTERVAL=30",
      status: "PAUSED",
    });
    expect(preparation.codexAutomation.prompt).toContain(
      "Read DEV_NEXUS_AGENT_CONTEXT_FILE",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "automation status, eligible work, agent profiles, target report",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "Git freshness preflight",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "delete merged local and remote review branches",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "provider-native issue directly without importing or copying",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "Max concurrent subagents: 3",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "Prepare isolated DevNexus worktrees",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "Record target-cycle facts",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "When no eligible work is available",
    );
    expect(preparation.codexAutomation.prompt).toContain(
      "bounded read-only or policy-safe component probing",
    );
  });

  it("warns but still prepares a prompt for projects without automation config", () => {
    const projectRoot = makeTempDir("dev-nexus-heartbeat-no-automation-");
    saveProjectConfig(projectRoot, projectConfig({ automation: undefined }));

    const preparation = prepareNexusAutomationHeartbeat({ projectRoot });

    expect(preparation.automation).toMatchObject({
      configured: false,
      mode: null,
      maxConcurrentSubagents: null,
    });
    expect(preparation.codexAutomation).toMatchObject({
      name: "DevNexus workspace heartbeat: Demo Project",
      rrule: "FREQ=MINUTELY;INTERVAL=60",
      status: "ACTIVE",
    });
    expect(preparation.warnings).toEqual([
      "Workspace automation is not configured; heartbeat should record that blocker before launching work.",
    ]);
    expect(preparation.codexAutomation.prompt).toContain(
      "Automation mode: not configured",
    );
  });
});
