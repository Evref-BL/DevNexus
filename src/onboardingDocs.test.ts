import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyNexusProjectSetup,
  buildNexusProjectSetupReadinessReport,
  loadLocalWorkTrackingStore,
  loadNexusProjectSetupAnswers,
  loadProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];
const originalDevNexusHome = process.env.DEV_NEXUS_HOME;

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function ttyInput(): NodeJS.ReadStream {
  const stream = new PassThrough() as NodeJS.ReadStream;
  Object.defineProperty(stream, "isTTY", {
    value: true,
  });
  return stream;
}

function promptAnsweringOutput(answers: string[], input: NodeJS.ReadStream): {
  stream: NodeJS.WriteStream;
  output: () => string;
} {
  let output = "";
  const stream = new PassThrough() as NodeJS.WriteStream;
  stream.write = (chunk: string | Buffer): boolean => {
    const text = chunk.toString();
    output += text;
    if (text.includes(": ") && answers.length > 0) {
      const answer = answers.shift()!;
      queueMicrotask(() => {
        input.write(`${answer}\n`);
      });
    }
    return true;
  };
  return {
    stream,
    output: () => output,
  };
}

function markdownLinks(text: string): string[] {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]!);
}

function assertLocalMarkdownLinksExist(relativePath: string): void {
  const text = repoFile(relativePath);
  for (const target of markdownLinks(text)) {
    if (/^[a-z]+:|^#/u.test(target)) {
      continue;
    }

    const [targetPath] = target.split("#");
    const resolved = path.resolve(path.dirname(relativePath), targetPath!);
    expect(fs.existsSync(resolved), `${relativePath} links to ${target}`).toBe(true);
  }
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalDevNexusHome === undefined) {
    delete process.env.DEV_NEXUS_HOME;
  } else {
    process.env.DEV_NEXUS_HOME = originalDevNexusHome;
  }
});

describe("README onboarding guardrails", () => {
  it("defines core onboarding terms before the quickstart", () => {
    const readme = repoFile("README.md");
    const installStart = readme.indexOf("## Install");
    const termsStart = readme.indexOf("## Terms");
    const quickStart = readme.indexOf("## Quick Start");
    expect(installStart).toBeGreaterThan(-1);
    expect(termsStart).toBeGreaterThan(-1);
    expect(installStart).toBeLessThan(termsStart);
    expect(quickStart).toBeGreaterThan(termsStart);

    const requiredDefinitions = [
      { term: "DevNexus workspace", marker: "**DevNexus workspace**" },
      { term: "component", marker: "**component**" },
      { term: "provider", marker: "**provider**" },
      { term: "work item", marker: "**work item**" },
      { term: "DevNexus home", marker: "**DevNexus home**" },
      { term: "Agent files", marker: "**Agent files**" },
      { term: "worktree", marker: "**worktree**" },
    ];

    for (const definition of requiredDefinitions) {
      const marker = readme.indexOf(definition.marker);
      expect(marker, `${definition.term} definition is missing`).toBeGreaterThan(termsStart);
      expect(marker, `${definition.term} must be defined before Quick Start`).toBeLessThan(quickStart);
    }

    expect(readme.indexOf("Model Context Protocol, or MCP")).toBeGreaterThan(termsStart);
    expect(readme.indexOf("Model Context Protocol, or MCP")).toBeLessThan(quickStart);
  });

  it("keeps the user quickstart before automation-only setup examples", () => {
    const readme = repoFile("README.md");
    const userSetup = readme.indexOf("dev-nexus workspace init");
    const answerFileSetup = readme.indexOf("--answers ./dev-nexus.setup.json");
    expect(userSetup).toBeGreaterThan(-1);
    expect(answerFileSetup).toBeGreaterThan(userSetup);

    const firstSetupLine = readme
      .split(/\r?\n/u)
      .find((line) => line.includes("dev-nexus workspace init"))!;
    expect(firstSetupLine.trim()).toBe("dev-nexus workspace init");
    expect(firstSetupLine).not.toContain("--answers");
    expect(firstSetupLine).not.toContain("--json");
    expect(firstSetupLine).not.toContain("--yes");
    expect(readme).not.toContain("dev-nexus workspace import");
    expect(readme).not.toContain("dev-nexus workspace create");
    expect(readme).not.toContain("gh pr checks");
    expect(readme).not.toContain("github-50");
  });

  it("includes an agent prompt and concrete readiness criteria in Quick Start", () => {
    const readme = repoFile("README.md");
    const quickStartStart = readme.indexOf("## Quick Start");
    const exampleStart = readme.indexOf("## Example");
    const quickStart = readme.slice(quickStartStart, exampleStart);

    expect(quickStart).toContain("Copy-paste prompt");
    expect(quickStart).toContain("Codex or Claude");
    expect(quickStart).toContain("DevNexus workspace root");
    expect(quickStart).toContain("asks what you are setting up");
    expect(quickStart).toContain("Choose `project`");
    expect(quickStart).toContain("Choose `workspace`");
    expect(quickStart).toContain("existing Git repository");
    expect(quickStart).toContain("primary component");
    expect(quickStart).toContain("components/<id>");
    expect(quickStart).toContain("AGENTS.md");
    expect(quickStart).toContain("dev-nexus workspace status");
    expect(quickStart).toContain("dev-nexus setup check");
    expect(quickStart).toContain("inspect the components");
    expect(quickStart).toContain("create or triage the first component work item");
    expect(quickStart).toContain(".codex/config.toml");
    expect(quickStart).toContain(".mcp.json");
    expect(quickStart).not.toContain("gh pr checks");
  });

  it("documents embedded and coordination workspace layouts in the user guide", () => {
    const concepts = repoFile("docs/user/concepts.md");
    const gettingStarted = repoFile("docs/user/getting-started.md");
    const combined = `${concepts}\n${gettingStarted}`;

    expect(combined).toContain("Embedded project layout");
    expect(combined).toContain("Coordination workspace layout");
    expect(combined).toContain("Choose what you are setting up");
    expect(combined).toContain("accept `.` as the primary component source path");
    expect(combined).toContain("Unrelated dirty product files still block readiness");
  });

  it("uses a general industry example instead of dogfood or research-specific names", () => {
    const readme = repoFile("README.md");
    const firstWorkspaceGuide = repoFile("docs/user/first-workspace-existing-components.md");
    const combined = `${readme}\n${firstWorkspaceGuide}`;

    for (const expected of ["rocket-shop-suite", "checkout-api", "storefront", "shared-kernel"]) {
      expect(combined).toContain(expected);
    }

    for (const stale of ["graphrag", "GraphRAG", "json-java-moose", "iwst-paper"]) {
      expect(combined).not.toContain(stale);
    }
  });

  it("keeps the general workflow guide provider-neutral by default", () => {
    const guide = repoFile("docs/user/agent-workflows.md");
    expect(guide).toContain("keep the default workflow provider-neutral");
    expect(guide).toContain("A user request to lead");
    expect(guide).toContain("as the routing map");
    expect(guide).toContain("choose the delivery topology before preparing");
    expect(guide).toContain("initiative integration branch only after");
    expect(guide).toContain("provider-specific until DevNexus has a neutral collector adapter");
    expect(guide).toContain("--tracker forge");
    expect(guide).toContain("The older `quick-fix` helper is a specialized GitHub path.");
    expect(guide).not.toContain("gh pr checks");
    expect(guide).not.toContain("github-50");
  });

  it("keeps README local documentation links valid", () => {
    for (const file of [
      "README.md",
      "docs/user/getting-started.md",
      "docs/user/concepts.md",
      "docs/user/agent-targets.md",
      "docs/user/first-workspace-existing-components.md",
      "docs/user/providers-auth-hosting.md",
    ]) {
      assertLocalMarkdownLinksExist(file);
    }
  });

  it("documents opt-in agent targets and projection cleanup", () => {
    const guide = repoFile("docs/user/agent-targets.md");
    const gettingStarted = repoFile("docs/user/getting-started.md");
    const readme = repoFile("README.md");

    for (const required of [
      "supported agent providers",
      "active agent targets",
      "agentTargets.active",
      "Codex-only",
      "Claude-only",
      "OpenCode",
      "Multi-provider",
      "MCP configuration",
      "Agent-native skill directories",
      "present-stale-generated",
      "present-manual",
      "workspace status",
      "setup check",
    ]) {
      expect(guide, `agent target guide must mention ${required}`).toContain(required);
    }

    expect(guide).toContain("Do not delete provider-global files");
    expect(guide).toContain("manual provider configuration");
    expect(gettingStarted).toContain("Agent targets and projection cleanup");
    expect(readme).toContain("docs/user/agent-targets.md");
  });
});

describe("first-workspace quickstart smoke", () => {
  it("creates a ready local workspace from the no-answer-file user setup path", async () => {
    const projectRoot = makeTempDir("dev-nexus-quickstart-project-");
    const homePath = makeTempDir("dev-nexus-quickstart-home-");
    fs.mkdirSync(path.join(projectRoot, "packages", "api"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "docs", "runbooks"), { recursive: true });
    process.env.DEV_NEXUS_HOME = homePath;

    const stdin = ttyInput();
    const stdout = promptAnsweringOutput([
      "",
      "Quickstart Smoke",
      "",
      "",
      "core",
      "",
      "yes",
      "api",
      "packages/api",
      "dependency",
      "yes",
      "runbooks",
      "docs/runbooks",
      "optional",
      "",
      "",
      "",
      "",
    ], stdin);

    const answers = await loadNexusProjectSetupAnswers({
      projectRoot,
      stdin,
      stdout: stdout.stream,
    });
    stdin.destroy();

    const result = await applyNexusProjectSetup({ answers });
    const projectConfig = loadProjectConfig(projectRoot);
    const readiness = buildNexusProjectSetupReadinessReport({ projectRoot });

    expect(stdout.output()).toContain("DevNexus user quickstart");
    expect(result.projectConfigPath).toBe(path.join(projectRoot, "dev-nexus.project.json"));
    expect(projectConfig.id).toBe("quickstart-smoke");
    expect(
      projectConfig.components.map((component) => ({
        id: component.id,
        role: component.role,
        defaultWorkTrackerId: component.defaultWorkTrackerId,
      })),
    ).toEqual([
      { id: "core", role: "primary", defaultWorkTrackerId: "local" },
      { id: "api", role: "dependency", defaultWorkTrackerId: "local" },
      { id: "runbooks", role: "optional", defaultWorkTrackerId: "local" },
    ]);
    expect(fs.existsSync(path.join(projectRoot, "AGENTS.md"))).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8")).toContain(
      "## First-Run Checklist",
    );
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(true);
    expect(
      loadLocalWorkTrackingStore(
        path.join(projectRoot, ".dev-nexus", "work-items", "core.json"),
      ).items,
    ).toEqual([]);
    expect(
      loadLocalWorkTrackingStore(
        path.join(projectRoot, ".dev-nexus", "work-items", "api.json"),
      ).items,
    ).toEqual([]);
    expect(
      loadLocalWorkTrackingStore(
        path.join(projectRoot, ".dev-nexus", "work-items", "runbooks.json"),
      ).items,
    ).toEqual([]);
    expect(readiness.verdict).not.toBe("blocked");
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "project-config", status: "passed" }),
        expect.objectContaining({ id: "agents-md", status: "passed" }),
      ]),
    );
  });
});
