import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultCoreSkillPack,
  materializeNexusProjectSkills,
  NexusSkillError,
  nexusSkillManifestFileName,
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
});
