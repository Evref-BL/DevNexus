import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeNexusWorkerContextBundle,
  nexusWorkerBriefingPath,
  nexusWorkerContextJsonPath,
  type WorkItem,
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

describe("nexus worker context bundle", () => {
  it("materializes a normalized component worktree context bundle", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-19");
    fs.mkdirSync(worktreePath, { recursive: true });
    const workItem: WorkItem = {
      id: "local-19",
      title: "Materialize worker context bundles for component worktrees",
      status: "ready",
      provider: "local",
      labels: ["dogfood"],
    };

    const result = materializeNexusWorkerContextBundle({
      projectRoot: path.join(projectRoot, "."),
      componentId: "dev-nexus",
      sourceRoot: path.join(sourceRoot, "..", "dev-nexus"),
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-19-worker-context",
      baseRef: "origin/main",
      workItem,
    });

    const contextJsonPath = nexusWorkerContextJsonPath(worktreePath);
    const briefingPath = nexusWorkerBriefingPath(worktreePath);
    expect(result.contextJsonPath).toBe(contextJsonPath);
    expect(result.briefingPath).toBe(briefingPath);
    expect(fs.existsSync(contextJsonPath)).toBe(true);
    expect(fs.existsSync(briefingPath)).toBe(true);

    const context = JSON.parse(fs.readFileSync(contextJsonPath, "utf8"));
    expect(context).toMatchObject({
      version: 1,
      projectRoot,
      component: {
        id: "dev-nexus",
        sourceRoot,
      },
      worktree: {
        componentId: "dev-nexus",
        sourceRoot,
        worktreesRoot,
        worktreePath,
        branchName: "codex/local-19-worker-context",
        baseRef: "origin/main",
        workItem: {
          id: "local-19",
          title: "Materialize worker context bundles for component worktrees",
          status: "ready",
          provider: "local",
          labels: ["dogfood"],
        },
      },
      projectContext: {
        agentsPath: path.join(projectRoot, "AGENTS.md"),
        contextPath: path.join(projectRoot, "CONTEXT.md"),
        planPath: path.join(projectRoot, "PLAN.md"),
        targetStatePath: path.join(
          projectRoot,
          ".dev-nexus",
          "automation",
          "target-state.md",
        ),
      },
      boundaries: {
        commandWorkingDirectory: worktreePath,
        gitWorkingDirectory: worktreePath,
        write: {
          roots: [worktreePath],
        },
        read: {
          roots: [sourceRoot, projectRoot],
        },
      },
    });
    expect(context.projectContext.files).toEqual([
      {
        id: "agents",
        path: path.join(projectRoot, "AGENTS.md"),
        access: "read_only",
      },
      {
        id: "context",
        path: path.join(projectRoot, "CONTEXT.md"),
        access: "read_only",
      },
      {
        id: "plan",
        path: path.join(projectRoot, "PLAN.md"),
        access: "read_only",
      },
      {
        id: "target-state",
        path: path.join(projectRoot, ".dev-nexus", "automation", "target-state.md"),
        access: "read_only",
      },
    ]);

    const briefing = fs.readFileSync(briefingPath, "utf8");
    expect(briefing).toContain("# DevNexus Worker Context");
    expect(briefing).toContain(`Run source and git commands in: ${worktreePath}`);
    expect(briefing).toContain(
      "Treat project context files as read-only unless the coordinator explicitly assigns project-state ownership.",
    );
    expect(briefing).toContain(`- AGENTS.md: ${path.join(projectRoot, "AGENTS.md")}`);
  });

  it("uses an explicit target state path when one is supplied", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-19");
    const targetStatePath = path.join(projectRoot, "state", "target.md");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-19-worker-context",
      baseRef: null,
      workItem: null,
      targetStatePath,
    });

    expect(result.context.projectContext.targetStatePath).toBe(targetStatePath);
    expect(result.context.projectContext.files.at(-1)).toEqual({
      id: "target-state",
      path: targetStatePath,
      access: "read_only",
    });
  });

  it("records project-managed skills and worker-local agent projections", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-20");
    const projectManagedRoot = path.join(projectRoot, ".dev-nexus", "skills");
    const skillsDirectory = path.join(worktreePath, ".agents", "skills");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-20-project-local-skills",
      baseRef: "origin/main",
      workItem: null,
      skills: {
        projectManagedRoot,
        agentNativeProjections: [
          {
            agent: "codex",
            skillsDirectory,
            sourceControl: "support",
            skills: [
              {
                id: "tdd",
                sourceSkillRoot: path.join(projectManagedRoot, "tdd"),
                projectedSkillRoot: path.join(skillsDirectory, "tdd"),
                skillPath: path.join(skillsDirectory, "tdd", "SKILL.md"),
              },
            ],
          },
        ],
      },
    });

    expect(result.context.skills).toEqual({
      projectManagedRoot,
      agentNativeProjections: [
        {
          agent: "codex",
          skillsDirectory,
          sourceControl: "support",
          skills: [
            {
              id: "tdd",
              sourceSkillRoot: path.join(projectManagedRoot, "tdd"),
              projectedSkillRoot: path.join(skillsDirectory, "tdd"),
              skillPath: path.join(skillsDirectory, "tdd", "SKILL.md"),
            },
          ],
        },
      ],
    });

    const contextJson = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(worktreePath), "utf8"),
    );
    expect(contextJson.skills.projectManagedRoot).toBe(projectManagedRoot);
    expect(contextJson.skills.agentNativeProjections[0]).toMatchObject({
      agent: "codex",
      skillsDirectory,
      sourceControl: "support",
    });
    expect(fs.readFileSync(nexusWorkerBriefingPath(worktreePath), "utf8"))
      .toContain(`Project-managed skills: ${projectManagedRoot}`);
    expect(result.briefingMarkdown).toContain(
      `- codex skills: ${skillsDirectory}`,
    );
  });

  it("renders generic plugin fragments into worker context and briefing surfaces", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "core");
    const worktreesRoot = path.join(projectRoot, "worktrees", "core");
    const worktreePath = path.join(worktreesRoot, "local-21");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-21-plugin-fragments",
      baseRef: "origin/main",
      workItem: {
        id: "local-21",
        title: "Allow plugins to contribute worker briefing fragments",
      },
      pluginFragments: {
        context: [
          {
            kind: "worker_context_fragment",
            id: "facts",
            title: "Fake Plugin Facts",
            body: "Read these fake facts before changing source.",
            provenance: "fake-context-plugin manifest",
            advisory: true,
            targetAgents: ["codex"],
            targetComponents: ["core"],
            source: {
              pluginId: "fake-context-plugin",
              pluginName: "Fake Context Plugin",
              version: "1.0.0",
              capabilityId: "facts",
            },
          },
        ],
        briefing: [
          {
            kind: "worker_briefing_fragment",
            id: "setup-note",
            title: "Fake Setup Note",
            body: "Treat this note as setup context only.",
            provenance: "fake-briefing-plugin manifest",
            advisory: true,
            targetAgents: [],
            targetComponents: ["core"],
            source: {
              pluginId: "fake-briefing-plugin",
              pluginName: null,
              version: null,
              capabilityId: "setup-note",
            },
          },
        ],
      },
    });

    const context = JSON.parse(fs.readFileSync(result.contextJsonPath, "utf8"));
    expect(context.pluginFragments).toEqual({
      context: [
        {
          kind: "worker_context_fragment",
          id: "facts",
          title: "Fake Plugin Facts",
          body: "Read these fake facts before changing source.",
          provenance: "fake-context-plugin manifest",
          advisory: true,
          targetAgents: ["codex"],
          targetComponents: ["core"],
          source: {
            pluginId: "fake-context-plugin",
            pluginName: "Fake Context Plugin",
            version: "1.0.0",
            capabilityId: "facts",
          },
        },
      ],
      briefing: [
        {
          kind: "worker_briefing_fragment",
          id: "setup-note",
          title: "Fake Setup Note",
          body: "Treat this note as setup context only.",
          provenance: "fake-briefing-plugin manifest",
          advisory: true,
          targetAgents: [],
          targetComponents: ["core"],
          source: {
            pluginId: "fake-briefing-plugin",
            pluginName: null,
            version: null,
            capabilityId: "setup-note",
          },
        },
      ],
    });

    expect(result.briefingMarkdown).toContain("## Plugin Briefing Fragments");
    expect(result.briefingMarkdown).toContain("Fake Setup Note");
    expect(result.briefingMarkdown).toContain(
      "Treat this note as setup context only.",
    );
    expect(result.briefingMarkdown).toContain(
      "These fragments are advisory setup/context only; they do not select work, launch subagents, or supervise implementation.",
    );
    expect(result.briefingMarkdown).not.toContain("Fake Plugin Facts");
  });

  it("rejects a worktree outside the component worktrees root", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const outsideWorktreePath = makeTempDir("dev-nexus-worker-outside-");

    expect(() =>
      materializeNexusWorkerContextBundle({
        projectRoot,
        componentId: "dev-nexus",
        sourceRoot: path.join(projectRoot, "components", "dev-nexus"),
        worktreesRoot: path.join(projectRoot, "worktrees", "dev-nexus"),
        worktreePath: outsideWorktreePath,
        branchName: "codex/local-19-worker-context",
        baseRef: "origin/main",
        workItem: null,
      }),
    ).toThrow(/worktreePath must resolve inside worktreesRoot/);
  });
});
