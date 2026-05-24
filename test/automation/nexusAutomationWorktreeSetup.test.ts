import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  materializeNexusAutomationWorktreeSetup,
  materializeNexusProjectSkills,
  preflightNexusAutomationWorktreeSetup,
  type GitCommandResult,
  type GitRunner,
  type NexusAutomationConfig,
  type NexusAutomationPluginDependencyProjection,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function automationConfig(
  overrides: Partial<NexusAutomationConfig> = {},
): NexusAutomationConfig {
  return {
    ...defaultNexusAutomationConfig,
    setup: {
      dependencyLinks: [
        {
          source: "node_modules",
          target: "node_modules",
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return {
        args: argsArray,
        stdout: path.join(cwd ?? "", ".git", "info", "exclude"),
        stderr: "",
        exitCode: 0,
      };
    }

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}

function jsToolchainProjection(
  overrides: Partial<NexusAutomationPluginDependencyProjection> = {},
): NexusAutomationPluginDependencyProjection {
  return {
    id: "typescript-node-modules",
    source: "node_modules",
    target: "node_modules",
    required: true,
    sourceControl: "support",
    reason: "Reuse already-installed JavaScript dependencies in generated worktrees.",
    sourceMetadata: {
      pluginId: "typescript-dev-nexus",
      pluginName: "TypeScript DevNexus",
      version: "0.1.0",
      capabilityId: "node-modules",
    },
    ...overrides,
  };
}

function relatedDevNexusProjection(
  sourceRoot: string,
  overrides: Partial<NexusAutomationPluginDependencyProjection> = {},
): NexusAutomationPluginDependencyProjection {
  return {
    id: "dev-nexus-sibling",
    sourceComponent: {
      id: "dev-nexus",
      sourceRoot,
    },
    source: ".",
    target: "../DevNexus",
    required: true,
    sourceControl: "support",
    reason: "Pharo baselines resolve the sibling DevNexus checkout.",
    sourceMetadata: {
      pluginId: "pharo-tools",
      pluginName: "Pharo Tools",
      version: "0.1.0",
      capabilityId: "dev-nexus-sibling",
    },
    ...overrides,
  };
}

function resolveLocalBinFromWorktree(
  worktreePath: string,
  command: string,
): string | null {
  const binDirectory = path.join(worktreePath, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? [
          command,
          ...((process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .filter(Boolean)
            .map((extension) => `${command}${extension.toLowerCase()}`)),
        ]
      : [command];

  for (const candidate of candidates) {
    const candidatePath = path.join(binDirectory, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function writePlaywrightBrowserToolingFixture(options: {
  sourceRoot: string;
  scripts?: Record<string, string>;
}): void {
  writeJson(path.join(options.sourceRoot, "package.json"), {
    scripts: options.scripts ?? {},
  });
  writeJson(
    path.join(options.sourceRoot, "node_modules", "playwright-core", "package.json"),
    {
      name: "playwright-core",
      version: "1.2.3",
    },
  );
  writeJson(
    path.join(options.sourceRoot, "node_modules", "playwright-core", "browsers.json"),
    {
      browsers: [
        {
          name: "chromium",
          revision: "1234",
          installByDefault: true,
        },
      ],
    },
  );
  writeJson(
    path.join(
      options.sourceRoot,
      "node_modules",
      "@vitest",
      "browser-playwright",
      "package.json",
    ),
    {
      name: "@vitest/browser-playwright",
      version: "1.2.3",
    },
  );
}

function withPlaywrightBrowserPath<T>(browserPath: string, fn: () => T): T {
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = previous;
    }
  }
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus automation worktree setup", () => {
  it("preflights dependency link safety before worktree mutation", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"), { recursive: true });

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig(),
      }),
    ).toEqual([
      {
        name: "dependencyLink:0",
        status: "passed",
        message: "Dependency link node_modules -> node_modules is safe to materialize",
      },
    ]);

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [
              {
                source: "..",
                target: "node_modules",
                required: true,
              },
            ],
          },
        }),
      })[0],
    ).toMatchObject({
      name: "dependencyLink:0",
      status: "failed",
    });
  });

  it("links dependencies into a generated worktree and excludes them", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ok\n", "utf8");
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreePath,
      automationConfig: automationConfig(),
      gitRunner: fakeGitRunner(gitCalls),
    });

    expect(result.links).toMatchObject([
      {
        source: "node_modules",
        target: "node_modules",
        sourcePath: sourceDependency,
        targetPath: path.join(worktreePath, "node_modules"),
        status: "linked",
      },
    ]);
    expect(fs.readFileSync(path.join(worktreePath, "node_modules", "tool.txt"), "utf8"))
      .toBe("ok\n");
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe("node_modules/\n");
    expect(gitCalls).toEqual([
      {
        args: ["rev-parse", "--git-path", "info/exclude"],
        cwd: worktreePath,
      },
    ]);
  });

  it("materializes plugin dependency projections and applies source-control policy", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    const sourceFixture = path.join(sourceRoot, "fixtures");
    const sourceCache = path.join(sourceRoot, ".dev-cache");
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.mkdirSync(sourceFixture, { recursive: true });
    fs.mkdirSync(sourceCache, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ok\n", "utf8");
    fs.writeFileSync(path.join(sourceFixture, "fixture.txt"), "fixture\n", "utf8");
    fs.writeFileSync(path.join(sourceCache, "cache.txt"), "cache\n", "utf8");
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [
            {
              source: ".dev-cache",
              target: ".dev-cache",
              required: true,
            },
          ],
        },
      }),
      pluginDependencyProjections: [
        jsToolchainProjection(),
        jsToolchainProjection({
          id: "typescript-fixtures",
          source: "fixtures",
          target: "fixtures",
          sourceControl: "source",
          reason: null,
          sourceMetadata: {
            pluginId: "typescript-dev-nexus",
            pluginName: "TypeScript DevNexus",
            version: "0.1.0",
            capabilityId: "fixtures",
          },
        }),
      ],
      gitRunner: fakeGitRunner(gitCalls),
    });

    expect(result.links).toMatchObject([
      {
        source: ".dev-cache",
        target: ".dev-cache",
        status: "linked",
      },
    ]);
    expect(result.dependencyProjections).toMatchObject([
      {
        id: "typescript-node-modules",
        source: "node_modules",
        target: "node_modules",
        sourcePath: sourceDependency,
        targetPath: path.join(worktreePath, "node_modules"),
        required: true,
        sourceControl: "support",
        reason: "Reuse already-installed JavaScript dependencies in generated worktrees.",
        status: "linked",
        sourceMetadata: {
          pluginId: "typescript-dev-nexus",
          pluginName: "TypeScript DevNexus",
          version: "0.1.0",
          capabilityId: "node-modules",
        },
      },
      {
        id: "typescript-fixtures",
        source: "fixtures",
        target: "fixtures",
        sourcePath: sourceFixture,
        targetPath: path.join(worktreePath, "fixtures"),
        required: true,
        sourceControl: "source",
        reason: null,
        status: "linked",
      },
    ]);
    expect(fs.readFileSync(path.join(worktreePath, "node_modules", "tool.txt"), "utf8"))
      .toBe("ok\n");
    expect(fs.readFileSync(path.join(worktreePath, "fixtures", "fixture.txt"), "utf8"))
      .toBe("fixture\n");
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe(".dev-cache/\nnode_modules/\n");
  });

  it("materializes related component projections at sibling support paths", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "components", "DevNexus-Pharo");
    const relatedSourceRoot = path.join(projectRoot, "components", "DevNexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus-pharo");
    const worktreePath = path.join(worktreesRoot, "local-24");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(relatedSourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.writeFileSync(
      path.join(relatedSourceRoot, "BaselineOfDevNexus.st"),
      "baseline\n",
      "utf8",
    );
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreesRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [
          relatedDevNexusProjection(relatedSourceRoot),
        ],
      }),
    ).toEqual([
      {
        name: "pluginDependencyProjection:dev-nexus-sibling",
        status: "passed",
        message: "Plugin dependency projection . -> ../DevNexus is safe to materialize",
      },
    ]);

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      pluginDependencyProjections: [relatedDevNexusProjection(relatedSourceRoot)],
      gitRunner: fakeGitRunner(gitCalls),
    });

    const targetPath = path.join(worktreesRoot, "DevNexus");
    expect(result.dependencyProjections).toMatchObject([
      {
        id: "dev-nexus-sibling",
        source: ".",
        target: "../DevNexus",
        sourcePath: relatedSourceRoot,
        targetPath,
        required: true,
        sourceControl: "support",
        status: "linked",
        sourceComponent: {
          id: "dev-nexus",
          sourceRoot: relatedSourceRoot,
        },
      },
    ]);
    expect(
      fs.readFileSync(
        path.join(worktreePath, "..", "DevNexus", "BaselineOfDevNexus.st"),
        "utf8",
      ),
    ).toBe("baseline\n");
    expect(fs.existsSync(path.join(worktreePath, ".git", "info", "exclude")))
      .toBe(false);
    expect(gitCalls).toEqual([]);
  });

  it("rejects undeclared outside plugin projection targets in preflight", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreesRoot = makeTempDir("dev-nexus-setup-worktrees-");
    fs.mkdirSync(path.join(sourceRoot, "DevNexus"), { recursive: true });

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreesRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [
          jsToolchainProjection({
            id: "undeclared-sibling",
            source: "DevNexus",
            target: "../DevNexus",
            required: true,
          }),
        ],
      }),
    ).toEqual([
      {
        name: "pluginDependencyProjection:undeclared-sibling",
        status: "failed",
        message: "plugin dependency projection target outside the worker worktree requires sourceComponent: ../DevNexus",
      },
    ]);
  });

  it("rejects missing required related component sources in preflight", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreesRoot = makeTempDir("dev-nexus-setup-worktrees-");
    const missingSourceRoot = path.join(sourceRoot, "..", "missing-DevNexus");

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreesRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [
          relatedDevNexusProjection(missingSourceRoot),
        ],
      }),
    ).toEqual([
      {
        name: "pluginDependencyProjection:dev-nexus-sibling",
        status: "failed",
        message: `Required plugin dependency projection source component dev-nexus source root does not exist: ${path.resolve(
          missingSourceRoot,
        )}`,
      },
    ]);
  });

  it("skips optional missing plugin projections and records them in worker context", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const worktreePath = path.join(worktreesRoot, "codex-demo-project-local-23-run-1");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const ownership = {
      componentId: "primary",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/demo-project/local-23/run-1",
      baseRef: "main",
      workItem: {
        id: "local-23",
        title: "Let toolchain plugins project dependencies into worker worktrees",
      },
    };

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      pluginDependencyProjections: [
        jsToolchainProjection({
          required: false,
          source: "node_modules",
          target: "node_modules",
        }),
      ],
      gitRunner: fakeGitRunner(gitCalls),
      context: {
        project: {
          id: "demo-project",
          name: "Demo Project",
          root: projectRoot,
        },
        ownership,
      },
    });

    expect(result.dependencyProjections).toMatchObject([
      {
        id: "typescript-node-modules",
        required: false,
        status: "skipped",
        message: expect.stringContaining("Optional plugin dependency projection source is absent"),
      },
    ]);
    const context = JSON.parse(fs.readFileSync(result.context!.contextJsonPath, "utf8"));
    expect(context.dependencySupport.pluginDependencyProjections).toMatchObject([
      {
        id: "typescript-node-modules",
        required: false,
        status: "skipped",
        sourceMetadata: {
          pluginId: "typescript-dev-nexus",
          capabilityId: "node-modules",
        },
      },
    ]);
    expect(result.context!.briefingMarkdown).toContain("Dependency support:");
    expect(result.context!.briefingMarkdown).toContain(
      "- skipped typescript-node-modules: node_modules",
    );
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe(".dev-nexus/guardrails/\n.dev-nexus/context/\n");
  });

  it("fails preflight and materialization for required missing plugin projections", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const projection = jsToolchainProjection({
      id: "missing-node-modules",
      source: "node_modules",
      target: "node_modules",
      required: true,
    });

    expect(
      preflightNexusAutomationWorktreeSetup({
        sourceRoot,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [projection],
      }),
    ).toEqual([
      {
        name: "pluginDependencyProjection:missing-node-modules",
        status: "failed",
        message: `Required plugin dependency projection source does not exist: ${path.join(
          sourceRoot,
          "node_modules",
        )}`,
      },
    ]);

    expect(() =>
      materializeNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreePath,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [projection],
        gitRunner: fakeGitRunner([]),
      }),
    ).toThrow(/Required plugin dependency projection source does not exist/);
  });

  it("projects JavaScript toolchain dependencies so local binaries resolve from the worktree", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const sourceBin = path.join(sourceRoot, "node_modules", ".bin");
    fs.mkdirSync(sourceBin, { recursive: true });
    const vitestBinName = process.platform === "win32" ? "vitest.cmd" : "vitest";
    const sourceVitest = path.join(sourceBin, vitestBinName);
    fs.writeFileSync(sourceVitest, "echo local vitest\n", "utf8");

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      pluginDependencyProjections: [jsToolchainProjection()],
      gitRunner: fakeGitRunner([]),
    });

    const resolvedVitest = resolveLocalBinFromWorktree(worktreePath, "vitest");
    expect(result.dependencyProjections[0]).toMatchObject({
      id: "typescript-node-modules",
      status: "linked",
      warnings: [
        expect.stringContaining("Projected node_modules is shared"),
      ],
    });
    expect(result.dependencyProjections[0]?.warnings?.[0]).toContain(sourceRoot);
    expect(result.dependencyProjections[0]?.warnings?.[0]).toContain(worktreePath);
    expect(resolvedVitest).toBe(path.join(worktreePath, "node_modules", ".bin", vitestBinName));
    expect(fs.realpathSync(resolvedVitest!)).toBe(fs.realpathSync(sourceVitest));
  });

  it("does not report browser readiness when projected node_modules has no Playwright tooling", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"), { recursive: true });

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      pluginDependencyProjections: [jsToolchainProjection()],
      gitRunner: fakeGitRunner([]),
    });

    expect(result.dependencyProjections[0]).not.toHaveProperty("setupBlockers");
    expect(result.dependencyProjections[0]).not.toHaveProperty("setupNotes");
  });

  it("reports missing Playwright browser binaries as setup blockers in worker context", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const worktreePath = path.join(worktreesRoot, "codex-demo-project-github-218");
    const browserCachePath = makeTempDir("dev-nexus-empty-browser-cache-");
    fs.mkdirSync(worktreePath, { recursive: true });
    writePlaywrightBrowserToolingFixture({ sourceRoot });

    const result = withPlaywrightBrowserPath(browserCachePath, () =>
      materializeNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreesRoot,
        worktreePath,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [jsToolchainProjection()],
        gitRunner: fakeGitRunner([]),
        context: {
          project: {
            id: "demo-project",
            name: "Demo Project",
            root: projectRoot,
          },
          ownership: {
            componentId: "primary",
            sourceRoot,
            worktreesRoot,
            worktreePath,
            branchName: "codex/demo-project/github-218",
            baseRef: "main",
            workItem: {
              id: "github-218",
              title: "Make prepared JS worktrees explicit about Playwright browser readiness",
            },
          },
        },
      }),
    );

    expect(result.dependencyProjections[0]?.setupBlockers).toEqual([
      expect.stringContaining("Playwright browser tooling detected"),
    ]);
    expect(result.dependencyProjections[0]?.setupBlockers?.[0]).toContain(
      "@vitest/browser-playwright",
    );
    expect(result.dependencyProjections[0]?.setupBlockers?.[0]).toContain(
      "chromium-1234",
    );
    expect(result.dependencyProjections[0]?.setupBlockers?.[0]).toContain(
      "npm exec playwright install",
    );
    expect(result.context!.briefingMarkdown).toContain("Setup blocker:");
    expect(result.context!.briefingMarkdown).toContain("chromium-1234");
  });

  it("reports configured Playwright browser install scripts as the setup action", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const worktreePath = makeTempDir("dev-nexus-setup-worktree-");
    const browserCachePath = makeTempDir("dev-nexus-empty-browser-cache-");
    fs.mkdirSync(worktreePath, { recursive: true });
    writePlaywrightBrowserToolingFixture({
      sourceRoot,
      scripts: {
        "test:browser:install": "playwright install chromium",
      },
    });

    const result = withPlaywrightBrowserPath(browserCachePath, () =>
      materializeNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreePath,
        automationConfig: automationConfig({
          setup: {
            dependencyLinks: [],
          },
        }),
        pluginDependencyProjections: [jsToolchainProjection()],
        gitRunner: fakeGitRunner([]),
      }),
    );

    expect(result.dependencyProjections[0]?.setupBlockers?.[0]).toContain(
      "npm run test:browser:install",
    );
    expect(result.dependencyProjections[0]?.setupBlockers?.[0]).toContain(
      "DevNexus did not run this action automatically",
    );
  });

  it("materializes a generated worker context bundle and excludes it", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const worktreePath = path.join(worktreesRoot, "codex-demo-project-local-19-run-1");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const ownership = {
      componentId: "primary",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/demo-project/local-19/run-1",
      baseRef: "main",
      workItem: {
        id: "local-19",
        title: "Materialize worker context bundles for component worktrees",
      },
    };

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      gitRunner: fakeGitRunner(gitCalls),
      context: {
        project: {
          id: "demo-project",
          name: "Demo Project",
          root: projectRoot,
        },
        ownership,
      },
    });

    const contextDir = path.join(worktreePath, ".dev-nexus", "context");
    const contextJsonPath = path.join(contextDir, "context.json");
    const briefingPath = path.join(contextDir, "briefing.md");
    expect(result.context).toMatchObject({
      contextJsonPath,
      briefingPath,
    });
    expect(result.guardrails).toHaveLength(1);
    expect(result.guardrails?.[0]).toMatchObject({
      id: "publication-command-guard",
      status: "materialized",
      rootDirectoryPath: path.join(worktreePath, ".dev-nexus", "guardrails"),
      binDirectoryPath: path.join(
        worktreePath,
        ".dev-nexus",
        "guardrails",
        "bin",
      ),
    });
    expect(JSON.parse(fs.readFileSync(contextJsonPath, "utf8"))).toMatchObject({
      project: {
        id: "demo-project",
        name: "Demo Project",
        root: projectRoot,
      },
      ownership,
    });
    expect(fs.readFileSync(briefingPath, "utf8")).toContain(
      "Source and Git commands run from the component checkout root",
    );
    expect(
      fs.readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8"),
    ).toBe(".dev-nexus/guardrails/\n.dev-nexus/context/\n");
    expect(gitCalls).toEqual([
      {
        args: ["rev-parse", "--git-path", "info/exclude"],
        cwd: worktreePath,
      },
      {
        args: ["rev-parse", "--git-path", "info/exclude"],
        cwd: worktreePath,
      },
    ]);
  });

  it("refreshes missing and stale worker skill projections from workspace-managed skills", () => {
    const projectRoot = makeTempDir("dev-nexus-setup-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const worktreePath = path.join(worktreesRoot, "codex-demo-project-local-20-run-1");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    const selectedSkills = {
      defaultCorePack: false,
      items: [{ id: "tdd" }, { id: "handoff" }],
    };
    materializeNexusProjectSkills({
      projectRoot,
      skillsConfig: selectedSkills,
      excludeFromGit: false,
    });
    const staleSkillPath = path.join(
      worktreePath,
      ".agents",
      "skills",
      "tdd",
      "SKILL.md",
    );
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true });
    fs.writeFileSync(staleSkillPath, "# stale local projection\n", "utf8");
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const ownership = {
      componentId: "primary",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/demo-project/local-20/run-1",
      baseRef: "main",
      workItem: {
        id: "local-20",
        title: "Project local skills into prepared worker contexts",
      },
    };

    const result = materializeNexusAutomationWorktreeSetup({
      sourceRoot,
      worktreesRoot,
      worktreePath,
      automationConfig: automationConfig({
        setup: {
          dependencyLinks: [],
        },
      }),
      skillsConfig: {
        ...selectedSkills,
        agentTargets: [{ agent: "codex" }],
      },
      gitRunner: fakeGitRunner(gitCalls),
      context: {
        project: {
          id: "demo-project",
          name: "Demo Project",
          root: projectRoot,
        },
        ownership,
      },
    });

    expect(result.skillProjections).toHaveLength(1);
    expect(result.skillProjections[0]).toMatchObject({
      agent: "codex",
      projectManagedSkillsRoot: path.join(projectRoot, ".dev-nexus", "skills"),
      skillsDirectory: path.join(worktreePath, ".agents", "skills"),
      sourceControl: "support",
    });
    expect(result.skillProjections[0].skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tdd",
          beforeStatus: "stale",
          afterStatus: "present",
          refreshed: true,
        }),
        expect.objectContaining({
          id: "handoff",
          beforeStatus: "missing",
          afterStatus: "present",
          refreshed: true,
        }),
      ]),
    );
    expect(fs.readFileSync(staleSkillPath, "utf8")).toContain(
      "Test-Driven Development (TDD)",
    );
    expect(
      fs.readFileSync(
        path.join(worktreePath, ".agents", "skills", "handoff", "SKILL.md"),
        "utf8",
      ),
    ).toContain("Continuation workflow");
    expect(
      fs.existsSync(
        path.join(
          worktreePath,
          ".agents",
          "skills",
          "tdd",
          "dev-nexus.skill.json",
        ),
      ),
    ).toBe(false);
    expect(JSON.parse(fs.readFileSync(result.context!.contextJsonPath, "utf8")))
      .toMatchObject({
        skills: {
          projectManagedRoot: path.join(projectRoot, ".dev-nexus", "skills"),
          agentNativeProjections: [
            {
              agent: "codex",
              skillsDirectory: path.join(worktreePath, ".agents", "skills"),
              sourceControl: "support",
              skills: [
                {
                  id: "tdd",
                  sourceSkillRoot: path.join(projectRoot, ".dev-nexus", "skills", "tdd"),
                  projectedSkillRoot: path.join(
                    worktreePath,
                    ".agents",
                    "skills",
                    "tdd",
                  ),
                  skillPath: staleSkillPath,
                },
                {
                  id: "handoff",
                  sourceSkillRoot: path.join(
                    projectRoot,
                    ".dev-nexus",
                    "skills",
                    "handoff",
                  ),
                  projectedSkillRoot: path.join(
                    worktreePath,
                    ".agents",
                    "skills",
                    "handoff",
                  ),
                  skillPath: path.join(
                    worktreePath,
                    ".agents",
                    "skills",
                    "handoff",
                    "SKILL.md",
                  ),
                },
              ],
            },
          ],
        },
      });
    const excludeEntries = fs
      .readFileSync(path.join(worktreePath, ".git", "info", "exclude"), "utf8")
      .trim()
      .split(/\r?\n/u);
    expect(excludeEntries).toContain(".dev-nexus/context/");
    expect(excludeEntries).toContain(".agents/skills/");
    expect(fs.existsSync(path.join(sourceRoot, ".agents"))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, ".dev-nexus"))).toBe(false);
  });

  it("rejects setup for a worktree outside the component worktrees root", () => {
    const sourceRoot = makeTempDir("dev-nexus-setup-source-");
    const componentWorktreesRoot = path.join(
      makeTempDir("dev-nexus-component-worktrees-"),
      "dev-nexus",
    );
    const outsideWorktreePath = makeTempDir("dev-nexus-setup-outside-");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"), { recursive: true });

    expect(() =>
      materializeNexusAutomationWorktreeSetup({
        sourceRoot,
        worktreesRoot: componentWorktreesRoot,
        worktreePath: outsideWorktreePath,
        automationConfig: automationConfig(),
        gitRunner: fakeGitRunner([]),
      }),
    ).toThrow(/inside worktreesRoot/);
  });
});
