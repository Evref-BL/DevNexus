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
  it("materializes the curated core skill pack as project support state", () => {
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
    const diagnose = result.installed.find((skill) => skill.id === "diagnose");
    expect(diagnose?.sourceControl).toBe("support");
    expect(fs.readFileSync(diagnose?.skillPath ?? "", "utf8")).toContain(
      "name: diagnose",
    );
    expect(
      JSON.parse(fs.readFileSync(diagnose?.manifestPath ?? "", "utf8")),
    ).toMatchObject({
      id: "diagnose",
      source: {
        type: "curated",
        uri: "dev-nexus:core",
      },
      materialization: "copy",
      sourceControl: "support",
    });
  });

  it("includes planning and documentation skills with expanded acronyms", () => {
    const skillIds = defaultCoreSkillPack.map((skill) => skill.manifest.id);

    expect(skillIds).toEqual([
      "diagnose",
      "tdd",
      "handoff",
      "triage",
      "architecture-review",
      "grill-with-docs",
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
    expect(skillMarkdown.tdd).toContain("Test-Driven Development (TDD)");
    expect(skillMarkdown["grill-with-docs"]).toContain(
      "Architecture Decision Records (ADRs)",
    );
    expect(skillMarkdown["to-issues"]).toContain(
      "Product Requirements Document (PRD)",
    );
    expect(skillMarkdown["to-issues"]).toContain("human-in-the-loop (HITL)");
    expect(skillMarkdown["to-issues"]).toContain(
      "autonomous agent-ready (AFK)",
    );
    expect(skillMarkdown["to-prd"]).toContain(
      "Product Requirements Document (PRD)",
    );
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
