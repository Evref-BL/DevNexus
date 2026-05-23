import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultCoreSkillPack,
  inspectNexusProjectSkills,
  materializeNexusProjectSkills,
  NexusSkillError,
  nexusSkillMarkdownFileName,
  nexusSkillManifestFileName,
  refreshNexusProjectSkills,
} from "./nexusSkills.js";

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

describe("nexus skills", () => {
  it("materializes the curated core skill pack as workspace support state", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    fs.mkdirSync(path.join(projectRoot, ".git", "info"), { recursive: true });

    const result = materializeNexusProjectSkills({ projectRoot });

    expect(result.installed.map((skill) => skill.id)).toEqual(
      defaultCoreSkillPack.map((skill) => skill.manifest.id),
    );
    expect(result.gitExcludePath).toBe(
      path.join(projectRoot, ".git", "info", "exclude"),
    );
    expect(result.gitExcludeEntries).toEqual([".dev-nexus/skills/"]);
    expect(
      fs.readFileSync(path.join(projectRoot, ".git", "info", "exclude"), "utf8"),
    ).toContain(".dev-nexus/skills/");
    const devNexus = result.installed.find((skill) => skill.id === "dev-nexus");
    expect(devNexus?.sourceControl).toBe("support");
    expect(fs.readFileSync(devNexus?.skillPath ?? "", "utf8")).toContain(
      "name: dev-nexus",
    );
    expect(
      JSON.parse(fs.readFileSync(devNexus?.manifestPath ?? "", "utf8")),
    ).toMatchObject({
      id: "dev-nexus",
      source: {
        type: "curated",
        uri: "dev-nexus:core",
      },
      materialization: "copy",
      sourceControl: "support",
    });
    const humanizer = result.installed.find((skill) => skill.id === "humanizer");
    expect(humanizer?.sourceControl).toBe("support");
    expect(
      fs.readFileSync(path.join(humanizer?.skillRoot ?? "", "LICENSE"), "utf8"),
    ).toContain("Copyright (c) 2025 Siqi Chen");
    expect(
      JSON.parse(fs.readFileSync(humanizer?.manifestPath ?? "", "utf8")),
    ).toMatchObject({
      id: "humanizer",
      license: "MIT",
      source: {
        type: "git",
        uri: "https://github.com/blader/humanizer",
        commit: "8b3a17889fbf12bedae20974a3c9f9de746ed754",
      },
    });
    const designWithUser = result.installed.find(
      (skill) => skill.id === "design-with-user",
    );
    expect(designWithUser?.sourceControl).toBe("support");
    expect(
      fs.readFileSync(path.join(designWithUser?.skillRoot ?? "", "LICENSE"), "utf8"),
    ).toContain("Copyright (c) 2025 Jesse Vincent");
    expect(
      JSON.parse(fs.readFileSync(designWithUser?.manifestPath ?? "", "utf8")),
    ).toMatchObject({
      id: "design-with-user",
      license: "MIT",
      source: {
        type: "git",
        uri: "https://github.com/obra/superpowers",
        tag: "v5.1.0",
        commit: "f2cbfbefebbfef77321e4c9abc9e949826bea9d7",
        paths: ["skills/brainstorming/SKILL.md"],
      },
    });
    const grillMe = result.installed.find((skill) => skill.id === "grill-me");
    expect(grillMe?.sourceControl).toBe("support");
    expect(
      fs.readFileSync(path.join(grillMe?.skillRoot ?? "", "LICENSE"), "utf8"),
    ).toContain("Copyright (c) 2026 Matt Pocock");
    expect(
      JSON.parse(fs.readFileSync(grillMe?.manifestPath ?? "", "utf8")),
    ).toMatchObject({
      id: "grill-me",
      license: "MIT",
      source: {
        type: "git",
        uri: "https://github.com/mattpocock/skills",
        commit: "b8be62ffacb0118fa3eaa29a0923c87c8c11985c",
        paths: ["skills/productivity/grill-me/SKILL.md"],
      },
    });
    for (const [id, sourcePaths] of [
      ["write-implementation-plan", ["skills/writing-plans/SKILL.md"]],
      ["execute-feature-plan", ["skills/executing-plans/SKILL.md"]],
      ["prepare-dev-nexus-worktree", ["skills/using-git-worktrees/SKILL.md"]],
      [
        "parallel-work-dispatch",
        [
          "skills/dispatching-parallel-agents/SKILL.md",
          "skills/subagent-driven-development/SKILL.md",
        ],
      ],
      ["request-work-review", ["skills/requesting-code-review/SKILL.md"]],
      ["receive-review-feedback", ["skills/receiving-code-review/SKILL.md"]],
      ["verify-before-completion", ["skills/verification-before-completion/SKILL.md"]],
      ["finish-dev-nexus-branch", ["skills/finishing-a-development-branch/SKILL.md"]],
      ["diagnose", ["skills/systematic-debugging/SKILL.md"]],
      ["tdd", ["skills/test-driven-development/SKILL.md"]],
      ["write-agent-skill", ["skills/writing-skills/SKILL.md"]],
    ] as const) {
      const skill = result.installed.find((entry) => entry.id === id);
      expect(skill?.sourceControl).toBe("support");
      expect(
        fs.readFileSync(path.join(skill?.skillRoot ?? "", "LICENSE"), "utf8"),
      ).toContain("Copyright (c) 2025 Jesse Vincent");
      expect(
        JSON.parse(fs.readFileSync(skill?.manifestPath ?? "", "utf8")),
      ).toMatchObject({
        id,
        license: "MIT",
        source: {
          type: "git",
          uri: "https://github.com/obra/superpowers",
          tag: "v5.1.0",
          commit: "f2cbfbefebbfef77321e4c9abc9e949826bea9d7",
          paths: sourcePaths,
        },
      });
    }
  });

  it("projects selected skills into configured agent-native directories", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    fs.mkdirSync(path.join(projectRoot, ".git", "info"), { recursive: true });

    const result = materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: {
        defaultCorePack: false,
        sourceControl: "support",
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
          { agent: "other", directory: ".other-agent/skills", enabled: false },
        ],
        items: [{ id: "grill-with-docs" }],
      },
    });

    expect(result.installed.map((skill) => skill.id)).toEqual([
      "grill-with-docs",
    ]);
    expect(result.agentTargets).toHaveLength(2);
    expect(result.agentTargets.map((target) => target.agent)).toEqual([
      "codex",
      "claude",
    ]);
    expect(result.gitExcludeEntries).toEqual([
      ".dev-nexus/skills/",
      ".agents/skills/",
      ".claude/skills/",
    ]);
    expect(
      fs.readFileSync(
        path.join(
          projectRoot,
          ".agents",
          "skills",
          "grill-with-docs",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toContain("name: grill-with-docs");
    expect(
      fs.readFileSync(
        path.join(
          projectRoot,
          ".claude",
          "skills",
          "grill-with-docs",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toContain("Architecture Decision Records (ADRs)");
    expect(
      fs.existsSync(
        path.join(
          projectRoot,
          ".agents",
          "skills",
          "grill-with-docs",
          nexusSkillManifestFileName,
        ),
      ),
    ).toBe(false);
  });

  it("projects skills only into the selected agent-native target set", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");

    const result = materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: {
        defaultCorePack: false,
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
        items: [{ id: "handoff" }],
      },
      agentTargets: [{ agent: "codex" }],
    });

    expect(result.agentTargets.map((target) => target.agent)).toEqual([
      "codex",
    ]);
    expect(
      fs.existsSync(path.join(projectRoot, ".agents", "skills", "handoff")),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".claude"))).toBe(false);
  });

  it("includes core workflow skills with expanded acronyms and synthetic user-facing text", () => {
    const skillIds = defaultCoreSkillPack.map((skill) => skill.manifest.id);

    expect(skillIds).toEqual([
      "dev-nexus",
      "feature-workflow",
      "take-the-lead",
      "design-with-user",
      "grill-me",
      "write-implementation-plan",
      "execute-feature-plan",
      "prepare-dev-nexus-worktree",
      "parallel-work-dispatch",
      "request-work-review",
      "receive-review-feedback",
      "verify-before-completion",
      "finish-dev-nexus-branch",
      "diagnose",
      "tdd",
      "handoff",
      "triage",
      "architecture-review",
      "setup-agent-skills",
      "write-agent-skill",
      "grill-with-docs",
      "documentation",
      "humanizer",
      "to-issues",
      "to-prd",
      "prototype",
      "zoom-out",
      "architecture-deepening",
    ]);

    const skillMarkdown = Object.fromEntries(
      defaultCoreSkillPack.map((skill) => [
        skill.manifest.id,
        skill.files[nexusSkillMarkdownFileName],
      ]),
    );
    expect(skillMarkdown["dev-nexus"]).toContain(
      "Product Requirements Document (PRD)",
    );
    expect(skillMarkdown["dev-nexus"]).toContain(
      "Test-Driven Development (TDD)",
    );
    expect(skillMarkdown["dev-nexus"]).toContain(
      "component-qualified work-item ids",
    );
    expect(skillMarkdown["dev-nexus"]).toContain("Git freshness preflight");
    expect(skillMarkdown["dev-nexus"]).toContain(
      "Fetch configured remotes when policy allows",
    );
    expect(skillMarkdown["dev-nexus"]).toContain(
      "delete merged local and remote review branches",
    );
    expect(skillMarkdown["dev-nexus"]).toContain("worktree_prepare");
    expect(skillMarkdown["dev-nexus"]).toContain("workspace/meta worktree");
    expect(skillMarkdown["dev-nexus"]).toContain("dependency_projection");
    expect(skillMarkdown["feature-workflow"]).toContain(
      "one tracker anchor",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "Git Branch Strategy",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "Direct branchStrategy",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "Stacked branchStrategy",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "Feature branchStrategy",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "Temporary integration branchStrategy",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "groups related work under one goal",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "user decides",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "should become a separate",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "independently reviewable vertical progress",
    );
    expect(skillMarkdown["feature-workflow"]).toContain(
      "do not force all work into a programming model",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "Agent leads the process; the user decides",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "human-in-the-loop",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "choose the current skill chain",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "End every substantive response",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "Route through the relevant skill chain",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "routing map for substantial led work",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "Sizing And Routing Call",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "largest coherent vertical change",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "Product Backlog Item or story",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "Estimate the shape of the work",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "recommended next action",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "choose the Git branchStrategy before",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "parallel-work-dispatch",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "Do not wait for the user to say \"use subagents\" again",
    );
    expect(skillMarkdown["take-the-lead"]).toContain(
      "docs/user/skill-chains.md",
    );
    expect(skillMarkdown["design-with-user"]).toContain(
      "use `grill-me` or",
    );
    expect(skillMarkdown["grill-me"]).toContain(
      "general-purpose interview",
    );
    expect(skillMarkdown["grill-with-docs"]).toContain(
      "general \"grill me\" interview mode",
    );
    expect(skillMarkdown["write-implementation-plan"]).toContain(
      "one feature, release, or output path",
    );
    expect(skillMarkdown["write-implementation-plan"]).toContain(
      "selected branchStrategy",
    );
    expect(skillMarkdown["write-implementation-plan"]).toContain(
      "bounded vertical changes",
    );
    expect(skillMarkdown["write-implementation-plan"]).toContain(
      "human-in-the-loop gates",
    );
    expect(skillMarkdown["execute-feature-plan"]).toContain(
      "feature, release, or output path",
    );
    expect(skillMarkdown["execute-feature-plan"]).toContain(
      "lacks a branchStrategy",
    );
    expect(skillMarkdown["prepare-dev-nexus-worktree"]).toContain(
      "worktree_prepare",
    );
    expect(skillMarkdown["prepare-dev-nexus-worktree"]).toContain(
      "workspace/meta worktree",
    );
    expect(skillMarkdown["prepare-dev-nexus-worktree"]).toContain(
      "selected branchStrategy",
    );
    expect(skillMarkdown["prepare-dev-nexus-worktree"]).toContain(
      "approved feature branch",
    );
    expect(skillMarkdown["parallel-work-dispatch"]).toContain(
      "agent-led coordination through",
    );
    expect(skillMarkdown["parallel-work-dispatch"]).toContain(
      "Check delegation fit",
    );
    expect(skillMarkdown["parallel-work-dispatch"]).toContain(
      "must not revert edits made by others",
    );
    expect(skillMarkdown["request-work-review"]).toContain(
      "severity with concrete file",
    );
    expect(skillMarkdown["receive-review-feedback"]).toContain(
      "External feedback is input to evaluate",
    );
    expect(skillMarkdown["verify-before-completion"]).toContain(
      "fresh verification",
    );
    expect(skillMarkdown["finish-dev-nexus-branch"]).toContain(
      "green-main policy",
    );
    expect(skillMarkdown["finish-dev-nexus-branch"]).toContain(
      "selected branchStrategy",
    );
    expect(skillMarkdown["finish-dev-nexus-branch"]).toContain(
      "feature branchStrategy",
    );
    expect(skillMarkdown["finish-dev-nexus-branch"]).toContain(
      "Do not silently",
    );
    expect(skillMarkdown.diagnose).toContain("root cause");
    expect(skillMarkdown.tdd).toContain("Test-Driven Development (TDD)");
    expect(skillMarkdown["grill-with-docs"]).toContain(
      "Architecture Decision Records (ADRs)",
    );
    expect(skillMarkdown.documentation).toContain(
      "README files, getting-started guides, user docs",
    );
    expect(skillMarkdown.documentation).toContain(
      "If a wizard asks for a value, do not also require it in the quick-start command",
    );
    expect(skillMarkdown.documentation).toContain(
      "using the `humanizer` companion skill",
    );
    expect(skillMarkdown.documentation).toContain("GitHub Docs");
    expect(skillMarkdown.documentation).toContain("Write the Docs");
    expect(skillMarkdown.documentation).toContain(
      "Google developer documentation style guide",
    );
    expect(skillMarkdown.humanizer).toContain("name: humanizer");
    expect(skillMarkdown.humanizer).toContain("Preserve commands exactly");
    expect(skillMarkdown["setup-agent-skills"]).toContain(
      "Architecture Decision Records (ADRs)",
    );
    expect(skillMarkdown["setup-agent-skills"]).toContain(
      "autonomous agent-ready (AFK)",
    );
    expect(skillMarkdown["setup-agent-skills"]).not.toContain("matt");
    expect(skillMarkdown["write-agent-skill"]).toContain(
      "Store provenance and license metadata in DevNexus manifests",
    );
    expect(skillMarkdown["to-issues"]).toContain(
      "Product Requirements Document (PRD)",
    );
    expect(skillMarkdown["to-issues"]).toContain(
      "Split the work into independently reviewable changes",
    );
    expect(skillMarkdown["to-issues"]).toContain("human-in-the-loop (HITL)");
    expect(skillMarkdown["to-issues"]).toContain(
      "autonomous agent-ready (AFK)",
    );
    expect(skillMarkdown["to-prd"]).toContain(
      "Product Requirements Document (PRD)",
    );
    const userFacingSourceMarkers = [
      "## Attribution",
      "Adapted from",
      "adapted from",
      "Vendored from",
      "Source path",
      "Source paths",
      "DevNexus adaptation",
      "DevNexus-compatible source attribution",
      "obra/superpowers",
      "mattpocock/skills",
      "blader/humanizer",
      "Prime Radiant",
      "Jesse Vincent",
      "Matt Pocock",
      "Siqi Chen",
      "human_in_the_loop.md",
      "openai-agents-python",
      "45effb4b7d7de1226ebba7ba304bccfcf0a37fdf",
      "b8be62ffacb0118fa3eaa29a0923c87c8c11985c",
      "f2cbfbefebbfef77321e4c9abc9e949826bea9d7",
      "8b3a17889fbf12bedae20974a3c9f9de746ed754",
    ];
    for (const [id, markdown] of Object.entries(skillMarkdown)) {
      for (const marker of userFacingSourceMarkers) {
        expect(markdown, `${id} should not expose ${marker}`).not.toContain(
          marker,
        );
      }
    }
    for (const skill of defaultCoreSkillPack) {
      expect(skill.manifest.supportedAgents).toEqual(["codex", "claude"]);
    }
  });

  it("lets projects disable defaults and select extension skills", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");

    const result = materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: {
        defaultCorePack: false,
        items: [
          {
            id: "custom-review",
            version: "2026.05.15",
          },
        ],
      },
      skillDefinitions: [
        {
          manifest: {
            id: "custom-review",
            name: "custom-review",
            description: "Custom project review workflow.",
            version: "0.1.0",
            license: "Apache-2.0",
            source: {
              type: "curated",
              uri: "example:custom",
            },
            supportedAgents: ["codex"],
            materialization: "copy",
            sourceControl: "support",
          },
          files: {
            "SKILL.md": "---\nname: custom-review\ndescription: Custom project review workflow.\n---\n",
          },
        },
      ],
    });

    expect(result.installed).toHaveLength(1);
    expect(result.installed[0]).toMatchObject({
      id: "custom-review",
      version: "2026.05.15",
    });
    expect(
      fs.existsSync(
        path.join(
          projectRoot,
          ".dev-nexus",
          "skills",
          "diagnose",
          nexusSkillManifestFileName,
        ),
      ),
    ).toBe(false);
  });

  it("rejects unknown configured skills", () => {
    expect(() =>
      materializeNexusProjectSkills({
        projectRoot: makeTempDir("dev-nexus-project-"),
        skillsConfig: {
          items: [
            {
              id: "missing-skill",
            },
          ],
        },
      }),
    ).toThrow(NexusSkillError);
  });

  it("inspects missing, stale, and unexpected project skills", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    materializeNexusProjectSkills({ projectRoot });
    const diagnosePath = path.join(
      projectRoot,
      ".dev-nexus",
      "skills",
      "diagnose",
      "SKILL.md",
    );
    fs.writeFileSync(diagnosePath, "# locally edited\n", "utf8");
    fs.rmSync(path.join(projectRoot, ".dev-nexus", "skills", "tdd"), {
      recursive: true,
      force: true,
    });
    const unexpectedRoot = path.join(projectRoot, ".dev-nexus", "skills", "local-only");
    fs.mkdirSync(unexpectedRoot, { recursive: true });
    fs.writeFileSync(
      path.join(unexpectedRoot, nexusSkillManifestFileName),
      JSON.stringify(
        {
          id: "local-only",
          name: "local-only",
          description: "Local-only skill.",
          version: "0.1.0",
          license: "Apache-2.0",
          source: {
            type: "local",
          },
          supportedAgents: ["codex"],
          materialization: "reference",
          sourceControl: "support",
        },
        null,
        2,
      ),
      "utf8",
    );

    const status = inspectNexusProjectSkills({ projectRoot });

    expect(status.summary).toMatchObject({
      expected: defaultCoreSkillPack.length,
      installed: defaultCoreSkillPack.length,
      missing: 1,
      stale: 1,
      unexpected: 1,
    });
    expect(status.skills.find((skill) => skill.id === "diagnose")).toMatchObject({
      state: "stale",
      reasons: ["skill file differs from the expected definition: SKILL.md"],
    });
    expect(status.skills.find((skill) => skill.id === "tdd")).toMatchObject({
      state: "missing",
      installed: false,
    });
    expect(status.skills.find((skill) => skill.id === "local-only")).toMatchObject({
      state: "unexpected",
      expected: false,
      skillPath: null,
    });
  });

  it("refreshes selected project skills and preserves explicit local additions", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    materializeNexusProjectSkills({ projectRoot });
    fs.rmSync(path.join(projectRoot, ".dev-nexus", "skills", "handoff"), {
      recursive: true,
      force: true,
    });
    const unexpectedRoot = path.join(projectRoot, ".dev-nexus", "skills", "local-only");
    fs.mkdirSync(unexpectedRoot, { recursive: true });
    fs.writeFileSync(
      path.join(unexpectedRoot, nexusSkillManifestFileName),
      "{ not json",
      "utf8",
    );

    const result = refreshNexusProjectSkills({ projectRoot });

    expect(result.before.summary).toMatchObject({
      missing: 1,
      invalid: 1,
    });
    expect(result.after.summary).toMatchObject({
      missing: 0,
      stale: 0,
      invalid: 1,
    });
    expect(result.after.skills.find((skill) => skill.id === "handoff")).toMatchObject({
      state: "installed",
      installed: true,
    });
    expect(result.after.skills.find((skill) => skill.id === "local-only")).toMatchObject({
      state: "invalid",
      expected: false,
    });
  });
});
