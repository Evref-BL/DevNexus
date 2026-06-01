import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compactNexusTargetState,
  compactTargetStateMarkdown,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0).reverse()) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus target-state compaction", () => {
  it("removes completed history while preserving active target-state sections", () => {
    const markdown = [
      "# DevNexus Dogfood Target State",
      "",
      "Current target: keep the dogfood workspace current.",
      "",
      "## Current Decisions",
      "",
      "- GitHub Issues is the first shared coordination provider.",
      "",
      "## Completed Cycles",
      "",
      "- Cycle 1 merged old work.",
      "- Cycle 2 merged more old work.",
      "",
      "## Active Blockers",
      "",
      "- Missing host-local remote runner overlay.",
      "",
      "## Run History",
      "",
      "- Historical run details live elsewhere.",
      "",
      "## Next Direction",
      "",
      "- Configure the first read-only smoke.",
      "",
    ].join("\n");

    const result = compactTargetStateMarkdown(markdown);

    expect(result.afterMarkdown).toContain("## Current Decisions");
    expect(result.afterMarkdown).toContain("## Active Blockers");
    expect(result.afterMarkdown).toContain("## Next Direction");
    expect(result.afterMarkdown).not.toContain("## Completed Cycles");
    expect(result.afterMarkdown).not.toContain("## Run History");
    expect(result.removedSections.map((section) => section.title)).toEqual([
      "Completed Cycles",
      "Run History",
    ]);
  });

  it("removes subsections nested below completed history headings", () => {
    const markdown = [
      "# Demo Target State",
      "",
      "Current target: demo.",
      "",
      "## Completed Cycles",
      "",
      "### Cycle 1",
      "",
      "- Old generated detail.",
      "",
      "## Active Blockers",
      "",
      "- Current blocker.",
      "",
    ].join("\n");

    const result = compactTargetStateMarkdown(markdown);

    expect(result.afterMarkdown).not.toContain("## Completed Cycles");
    expect(result.afterMarkdown).not.toContain("### Cycle 1");
    expect(result.afterMarkdown).not.toContain("Old generated detail");
    expect(result.afterMarkdown).toContain("## Active Blockers");
    expect(result.removedSections.map((section) => section.title)).toEqual([
      "Completed Cycles",
      "Cycle 1",
    ]);
  });

  it("previews then applies compacted target state to the configured path", () => {
    const projectRoot = makeTempDir("dev-nexus-target-state-");
    const statePath = path.join(projectRoot, ".dev-nexus", "automation", "target-state.md");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      [
        "# Demo Target State",
        "",
        "Current target: demo.",
        "",
        "## Active Blockers",
        "",
        "- None.",
        "",
        "## Completed History",
        "",
        "- Old fact.",
        "",
      ].join("\n"),
      "utf8",
    );
    saveProjectConfig(projectRoot, projectConfig());

    const preview = compactNexusTargetState({ projectRoot });

    expect(preview.changed).toBe(true);
    expect(fs.readFileSync(statePath, "utf8")).toContain("Completed History");

    const applied = compactNexusTargetState({ projectRoot, apply: true });

    expect(applied.changed).toBe(true);
    expect(fs.readFileSync(statePath, "utf8")).not.toContain("Completed History");
  });
});

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "target-state-demo",
    name: "Target State Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/target-state.git",
      defaultBranch: "main",
      sourceRoot: ".",
    },
    worktreesRoot: "worktrees",
    automation: {
      ...defaultNexusAutomationConfig,
      target: {
        ...defaultNexusAutomationConfig.target,
        objective: "Demo target.",
        statePath: ".dev-nexus/automation/target-state.md",
      },
    },
  };
}
