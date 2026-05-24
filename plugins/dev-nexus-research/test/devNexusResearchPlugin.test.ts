import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  devNexusResearchArtifactHints,
  devNexusResearchPlugin,
  devNexusResearchSkillIds,
} from "../src/index.js";
import {
  projectPluginCapabilityProjections,
  projectPluginWorkerFragments,
} from "../../../src/project/nexusPluginCapabilities.js";
import { validateProjectConfig } from "../../../src/project/nexusProjectConfig.js";

const fixturePath = new URL(
  "../fixtures/dev-nexus-research.project.json",
  import.meta.url,
);

function fixtureConfig(): unknown {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

describe("DevNexus Research plugin skeleton", () => {
  it("exports only generic DevNexus plugin capability records", () => {
    expect(devNexusResearchSkillIds).toEqual(["research-workflow-router"]);
    expect(
      devNexusResearchPlugin.capabilities.map((capability) => capability.kind),
    ).toEqual([
      "projected_skill",
      "setup_obligation",
      "environment_hint",
      "environment_hint",
      "worker_context_fragment",
      "worker_context_fragment",
      "worker_briefing_fragment",
    ]);
  });

  it("validates the static project-config fixture through DevNexus core", () => {
    const config = validateProjectConfig(fixtureConfig());

    expect(config.plugins?.[0]).toEqual(devNexusResearchPlugin);
    expect(projectPluginCapabilityProjections(config)).toMatchObject([
      {
        pluginId: "dev-nexus-research",
        pluginName: "DevNexus Research",
        version: "0.1.0-alpha.0",
        capabilityCount: devNexusResearchPlugin.capabilities.length,
      },
    ]);
  });

  it("projects scoped research worker fragments without core behavior", () => {
    const config = validateProjectConfig(fixtureConfig());

    expect(
      projectPluginWorkerFragments(config, {
        componentId: "research-project",
        agent: "codex",
      }),
    ).toMatchObject({
      context: [
        {
          id: "context-evidence-integrity",
          source: {
            pluginId: "dev-nexus-research",
            capabilityId: "context-evidence-integrity",
          },
        },
        {
          id: "context-human-research-boundary",
          source: {
            pluginId: "dev-nexus-research",
            capabilityId: "context-human-research-boundary",
          },
        },
      ],
      briefing: [
        {
          id: "briefing-research-artifacts",
          source: {
            pluginId: "dev-nexus-research",
            capabilityId: "briefing-research-artifacts",
          },
        },
      ],
    });
  });

  it("keeps the baseline artifact conventions no-network friendly", () => {
    expect(devNexusResearchArtifactHints.map((hint) => hint.defaultPath))
      .toEqual([
        "research-brief.md",
        "source-manifest.yaml",
        "claim-register.yaml",
      ]);

    const skillText = fs.readFileSync(
      new URL("../skills/research-workflow-router/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(skillText).toContain("Do not fabricate citations");
  });
});
