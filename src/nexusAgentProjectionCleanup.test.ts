import fs from "node:fs";
import childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyNexusAgentProjectionCleanup,
  planNexusAgentProjectionCleanup,
} from "./nexusAgentProjectionCleanup.js";
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
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "agent-projection-cleanup",
    name: "Agent Projection Cleanup",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
      sourceRoot: ".",
    },
    components: [
      {
        id: "primary",
        name: "Primary",
        kind: "local",
        role: "primary",
        remoteUrl: null,
        defaultBranch: "main",
        sourceRoot: ".",
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    ...overrides,
  };
}

function writeGeneratedSkillProjection(projectRoot: string, relativePath: string): void {
  const skillRoot = path.join(projectRoot, relativePath, "legacy");
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, "dev-nexus.skill.json"), "{}\n", "utf8");
}

describe("nexus agent projection cleanup", () => {
  it("plans cleanup-safe stale generated projections and refusal entries", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-projection-cleanup-");
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".agents", "skills", "README.md"),
      "active codex projection\n",
      "utf8",
    );
    writeGeneratedSkillProjection(projectRoot, path.join(".claude", "skills"));
    fs.mkdirSync(path.join(projectRoot, ".opencode", "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".opencode", "skills", "README.md"),
      "manual opencode notes\n",
      "utf8",
    );
    saveProjectConfig(projectRoot, projectConfig({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    }));

    const plan = planNexusAgentProjectionCleanup({ projectRoot });

    expect(plan).toMatchObject({
      status: "ready",
      removableCount: 1,
      skippedCount: 2,
    });
    expect(plan.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ".claude/skills",
        provider: "claude",
        state: "present-stale-generated",
        cleanupSafe: true,
        action: "remove",
        reason: expect.stringContaining("DevNexus skill manifest"),
        blocker: null,
      }),
      expect.objectContaining({
        path: ".agents/skills",
        provider: "codex",
        state: "expected-present",
        cleanupSafe: false,
        action: "skip",
        blocker: expect.stringContaining("active"),
      }),
      expect.objectContaining({
        path: ".opencode/skills",
        provider: "opencode",
        state: "present-manual",
        cleanupSafe: false,
        action: "skip",
        blocker: expect.stringContaining("manual"),
      }),
    ]));
  });

  it("applies cleanup only to cleanup-safe generated projections and is idempotent", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-projection-cleanup-");
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills"), { recursive: true });
    writeGeneratedSkillProjection(projectRoot, path.join(".claude", "skills"));
    fs.mkdirSync(path.join(projectRoot, ".opencode", "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".opencode", "skills", "README.md"),
      "manual opencode notes\n",
      "utf8",
    );
    saveProjectConfig(projectRoot, projectConfig({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    }));

    const result = applyNexusAgentProjectionCleanup({ projectRoot });

    expect(result.status).toBe("completed");
    expect(result.removed).toEqual([
      expect.objectContaining({
        path: ".claude/skills",
        action: "remove",
      }),
    ]);
    expect(fs.existsSync(path.join(projectRoot, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".agents", "skills"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".opencode", "skills"))).toBe(true);

    const rerun = applyNexusAgentProjectionCleanup({ projectRoot });

    expect(rerun.status).toBe("completed");
    expect(rerun.removed).toHaveLength(0);
    expect(rerun.plan.removableCount).toBe(0);
  });

  it("refuses source-controlled provider support even when it has generated markers", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-projection-cleanup-");
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills"), { recursive: true });
    writeGeneratedSkillProjection(projectRoot, path.join(".claude", "skills"));
    saveProjectConfig(projectRoot, projectConfig({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    }));
    childProcess.execFileSync("git", ["-C", projectRoot, "init"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    childProcess.execFileSync(
      "git",
      [
        "-C",
        projectRoot,
        "add",
        path.join(".claude", "skills", "legacy", "dev-nexus.skill.json"),
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    const plan = planNexusAgentProjectionCleanup({ projectRoot });

    expect(plan.removableCount).toBe(0);
    expect(plan.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ".claude/skills",
        state: "present-manual",
        sourceControl: "source",
        action: "skip",
        blocker: expect.stringContaining("source-controlled"),
      }),
    ]));
  });

  it("refuses generated support for unknown providers", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-projection-cleanup-");
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills"), { recursive: true });
    writeGeneratedSkillProjection(projectRoot, path.join(".custom-agent", "skills"));
    saveProjectConfig(projectRoot, projectConfig({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      skills: {
        agentTargets: [
          { agent: "codex" },
          { agent: "custom-agent", directory: path.join(".custom-agent", "skills") },
        ],
      },
    }));

    const plan = planNexusAgentProjectionCleanup({ projectRoot });

    expect(plan.removableCount).toBe(0);
    expect(plan.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ".custom-agent/skills",
        provider: "custom-agent",
        state: "present-stale-generated",
        action: "skip",
        blocker: expect.stringContaining("Unknown provider"),
      }),
    ]));
  });
});
