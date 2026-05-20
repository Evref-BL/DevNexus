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
    const termsStart = readme.indexOf("## Terms");
    const quickStart = readme.indexOf("## Quick Start");
    expect(termsStart).toBeGreaterThan(-1);
    expect(quickStart).toBeGreaterThan(termsStart);

    const requiredDefinitions = [
      { term: "DevNexus project", marker: "**DevNexus project**" },
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

  it("keeps the human quickstart before automation-only setup examples", () => {
    const readme = repoFile("README.md");
    const humanSetup = readme.indexOf('dev-nexus project setup "$HOME/dev-nexus/example-suite"');
    const answerFileSetup = readme.indexOf("--answers ./dev-nexus.setup.json");
    expect(humanSetup).toBeGreaterThan(-1);
    expect(answerFileSetup).toBeGreaterThan(humanSetup);

    const firstSetupLine = readme
      .split(/\r?\n/u)
      .find((line) => line.includes("dev-nexus project setup"))!;
    expect(firstSetupLine).not.toContain("--answers");
    expect(firstSetupLine).not.toContain("--json");
    expect(firstSetupLine).not.toContain("--yes");
    expect(readme).not.toContain("dev-nexus project import");
    expect(readme).not.toContain("dev-nexus project create");
  });

  it("keeps README local documentation links valid", () => {
    for (const file of [
      "README.md",
      "docs/user/getting-started.md",
      "docs/user/concepts.md",
      "docs/user/first-project-existing-components.md",
      "docs/user/providers-auth-hosting.md",
    ]) {
      assertLocalMarkdownLinksExist(file);
    }
  });
});

describe("first-project quickstart smoke", () => {
  it("creates a ready local project from the no-answer-file human setup path", async () => {
    const projectRoot = makeTempDir("dev-nexus-quickstart-project-");
    const homePath = makeTempDir("dev-nexus-quickstart-home-");
    fs.mkdirSync(path.join(projectRoot, "packages", "api"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "docs", "paper"), { recursive: true });
    process.env.DEV_NEXUS_HOME = homePath;

    const stdin = ttyInput();
    const stdout = promptAnsweringOutput([
      "",
      "Quickstart Smoke",
      "",
      "core",
      ".",
      "yes",
      "api",
      "packages/api",
      "dependency",
      "yes",
      "paper",
      "docs/paper",
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

    expect(stdout.output()).toContain("DevNexus human quickstart");
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
      { id: "paper", role: "optional", defaultWorkTrackerId: "local" },
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
        path.join(projectRoot, ".dev-nexus", "work-items", "paper.json"),
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
