import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, usage } from "./cli.js";
import {
  createLocalWorkTrackerProvider,
  currentNexusCliScriptPath,
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  defaultNexusReleaseTrainCiTierPolicy,
  loadProjectConfig,
  loadLocalWorkTrackingStore,
  defaultLocalWorkTrackingStorePath,
  nexusWorktreeLeaseKind,
  readNexusAutomationRunLedger,
  readNexusAutomationTargetCycleLedger,
  saveProjectConfig,
  shellQuoteArgument,
  writeNexusWorktreeLeaseStore,
  type NexusEligibleWorkClaimProviderFactory,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectHostingProviderAdapter,
  type NexusAutomationCommandRunner,
  type NexusProjectConfig,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  type WorkComment,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkItemRef,
  type WorkTrackerProvider,
  type NexusWorktreeLeaseRecord,
} from "./index.js";

const tempDirs: string[] = [];
const originalDevNexusHome = process.env.DEV_NEXUS_HOME;

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function captureOutput() {
  let output = "";
  return {
    writer: {
      write(chunk: string): boolean {
        output += chunk;
        return true;
      },
    },
    output: () => output,
  };
}

function saveHomeConfig(
  homePath: string,
  authProfiles: Array<Record<string, unknown>>,
): void {
  fs.mkdirSync(homePath, { recursive: true });
  fs.writeFileSync(
    path.join(homePath, "dev-nexus.home.json"),
    JSON.stringify(
      {
        version: 1,
        paths: {
          projectsRoot: path.join(homePath, "projects"),
          workspacesRoot: path.join(homePath, "workspaces"),
        },
        authProfiles,
        projects: [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

function documentedDevNexusCommands(relativePath: string): string[] {
  return fs
    .readFileSync(path.join(process.cwd(), relativePath), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("dev-nexus "));
}

function commandPrefix(commandLine: string): string {
  const tokens = commandLine.trim().split(/\s+/);
  const prefix: string[] = [];
  for (const token of tokens) {
    if (
      prefix.length > 0 &&
      (token.startsWith("<") ||
        token.startsWith("[") ||
        token.startsWith("(") ||
        (token.startsWith("--") && token !== "--help"))
    ) {
      break;
    }
    prefix.push(token);
  }
  return prefix.join(" ");
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        limit: 5,
      },
      verification: {
        ...defaultNexusAutomationConfig.verification,
        focusedCommands: ["npm test"],
        fullCommands: [],
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
        targetBranch: "main",
      },
    },
    ...overrides,
  };
}

function releaseTrainLease(options: {
  projectId: string;
  componentId: string;
  workItemId: string;
  branchName: string;
  id?: string;
  writeScope?: string[];
}): NexusWorktreeLeaseRecord {
  return {
    kind: nexusWorktreeLeaseKind,
    version: 1,
    id: options.id ?? "lease-cli-train",
    projectId: options.projectId,
    scope: {
      kind: "component",
      componentId: options.componentId,
    },
    hostId: "host-1",
    agentId: null,
    workItemId: options.workItemId,
    branchName: options.branchName,
    baseRef: "main",
    worktree: {
      kind: "component_worktree",
      base: "componentWorktreesRoot",
      componentId: options.componentId,
      relativePath: "release-train-readiness",
    },
    writeScope: options.writeScope ?? ["src/nexusReleaseTrainReadiness.ts"],
    status: "ready",
    createdAt: "2026-05-21T10:00:00.000Z",
    lastSeenAt: "2026-05-21T10:00:00.000Z",
    updatedAt: "2026-05-21T10:00:00.000Z",
    refreshCount: 0,
    lastObservedHeadCommit: "abc123",
    dirty: false,
    pushed: true,
    git: {
      repository: {
        kind: "component_worktree",
        base: "componentWorktreesRoot",
        componentId: options.componentId,
        relativePath: "release-train-readiness",
      },
      upstream: `origin/${options.branchName}`,
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      warnings: [],
    },
    notes: [],
  };
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      fs.mkdirSync(argsArray[4]!, { recursive: true });
      return {
        args: argsArray,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
      return {
        args: argsArray,
        stdout: path.join(cwd ?? "", ".git", "info", "exclude"),
        stderr: "",
        exitCode: 0,
      };
    }
    if (argsArray[0] === "rev-list") {
      return {
        args: argsArray,
        stdout: "abc123\n",
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

function fakeProjectGitRunner(
  calls: string[][],
  options: { branch?: string; remoteUrl?: string | null } = {},
): ProjectGitRunner {
  return (args: readonly string[]): ProjectGitCommandResult => {
    const argsArray = [...args];
    calls.push(argsArray);

    if (argsArray[0] === "clone") {
      fs.mkdirSync(argsArray[2]!, { recursive: true });
    }
    if (argsArray.includes("rev-parse")) {
      return {
        args: argsArray,
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (argsArray.includes("remote.origin.url")) {
      return {
        args: argsArray,
        stdout: options.remoteUrl ? `${options.remoteUrl}\n` : "",
        stderr: "",
        exitCode: options.remoteUrl ? 0 : 1,
      };
    }
    if (argsArray.includes("symbolic-ref")) {
      return {
        args: argsArray,
        stdout: `${options.branch ?? "main"}\n`,
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

function fakeCoordinationIntegrationGitRunner(
  repositoryPath: string,
  calls: Array<{ args: string[]; cwd?: string }> = [],
): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, "codex/shared-coordination\n");
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, "feature123\n");
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return ok(argsArray, "origin/codex/shared-coordination\n");
    }
    if (joined === "status --porcelain=v1") {
      return ok(argsArray, "");
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, "0\t0\n");
    }
    if (joined === "rev-parse --verify main") {
      return ok(argsArray, "target123\n");
    }
    if (joined === "rev-parse --verify codex/shared-coordination") {
      return ok(argsArray, "feature123\n");
    }
    if (joined === "merge-base main codex/shared-coordination") {
      return ok(argsArray, "base123\n");
    }
    if (joined === "diff --name-only main...codex/shared-coordination") {
      return ok(argsArray, "src/nexusCoordination.ts\n");
    }
    if (joined === "merge-tree --write-tree --quiet main codex/shared-coordination") {
      return ok(argsArray, "");
    }
    if (
      joined ===
      "merge-tree --write-tree --name-only --messages main codex/shared-coordination"
    ) {
      return ok(argsArray, "src/nexusCoordination.ts\n");
    }
    if (joined === "range-diff base123..main base123..codex/shared-coordination") {
      return ok(argsArray, "");
    }

    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string, exitCode = 0): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
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

describe("dev-nexus cli", () => {
  it("prints usage", async () => {
    const output = captureOutput();

    await expect(main(["--help"], { stdout: output.writer })).resolves.toBe(0);

    expect(output.output()).toContain("dev-nexus home init");
    expect(output.output()).toContain("dev-nexus auth github-app user login");
    expect(output.output()).toContain("dev-nexus mcp-stdio");
    expect(output.output()).toContain("dev-nexus workspace status");
    expect(output.output()).toContain("dev-nexus workspace init");
    expect(output.output()).toContain("dev-nexus workspace component add");
    expect(output.output()).toContain("dev-nexus workspace hosting status");
    expect(output.output()).toContain("dev-nexus workspace hosting plan");
    expect(output.output()).toContain("dev-nexus workspace hosting apply");
    expect(output.output()).toContain("dev-nexus workspace mcp refresh");
    expect(output.output()).toContain("dev-nexus workspace plugin refresh");
    expect(output.output()).toContain("dev-nexus setup plan");
    expect(output.output()).toContain("dev-nexus diagnostics cli-version-skew");
    expect(output.output()).toContain("dev-nexus coordination status");
    expect(output.output()).toContain("dev-nexus coordination request");
    expect(output.output()).toContain("dev-nexus worktree prepare");
    expect(output.output()).toContain("dev-nexus publication green-main plan");
    expect(output.output()).toContain("dev-nexus quick-fix plan");
    expect(output.output()).toContain("dev-nexus quick-fix start");
    expect(output.output()).toContain("dev-nexus quick-fix finish");
    expect(output.output()).toContain("dev-nexus work-item create");
    expect(output.output()).toContain("dev-nexus automation enqueue");
    expect(output.output()).toContain("dev-nexus automation target-cycle record");
    expect(output.output()).toContain("dev-nexus automation target-report");
    expect(output.output()).toContain("dev-nexus automation run-once");
    expect(output.output()).toContain("dev-nexus automation schedule");
    expect(output.output()).toContain("dev-nexus automation coordinator-loop");
  });

  it("logs in, reports status, and logs out of GitHub App user auth", async () => {
    const homePath = makeTempDir("dev-nexus-home-");
    saveHomeConfig(homePath, [
      {
        id: "gabriel-devnexus-app-user",
        actorId: "gabriel",
        provider: "github",
        kind: "human",
        credentialKind: "github_app_user_token",
        account: "Gabriel-Darbord",
        host: "github.com",
        purposes: ["api", "git"],
        githubApp: {
          clientId: "Iv23client",
          slug: "devnexus-automation",
          installationAccount: "Evref-BL",
          repositories: ["DevNexus"],
        },
      },
    ]);
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({
        url,
        method: init.method ?? "GET",
        authorization: new Headers(init.headers).get("authorization"),
      });
      if (url === "https://github.com/login/device/code") {
        return jsonResponse({
          device_code: "device-code",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return jsonResponse({
          access_token: "ghu_access",
          expires_in: 28800,
          refresh_token: "ghr_refresh",
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        });
      }
      if (url === "https://api.github.com/user") {
        return jsonResponse({
          login: "Gabriel-Darbord",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const loginOutput = captureOutput();

    await expect(
      main(
        [
          "auth",
          "github-app",
          "user",
          "login",
          "--home",
          homePath,
          "--profile",
          "gabriel-devnexus-app-user",
          "--json",
        ],
        {
          stdout: loginOutput.writer,
          fetch: fetchImpl,
          now: fixedClock("2026-05-22T10:00:00.000Z"),
          sleep: async () => undefined,
        },
      ),
    ).resolves.toBe(0);

    expect(JSON.parse(loginOutput.output())).toMatchObject({
      ok: true,
      result: {
        profileId: "gabriel-devnexus-app-user",
        login: "Gabriel-Darbord",
        userCode: "WDJB-MJHT",
        status: {
          state: "authorized",
        },
      },
    });
    expect(requests).toHaveLength(3);

    const statusOutput = captureOutput();
    await expect(
      main(
        [
          "auth",
          "github-app",
          "user",
          "status",
          "--home",
          homePath,
          "--profile",
          "gabriel-devnexus-app-user",
          "--json",
        ],
        {
          stdout: statusOutput.writer,
          now: fixedClock("2026-05-22T11:00:00.000Z"),
        },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(statusOutput.output())).toMatchObject({
      ok: true,
      status: {
        state: "authorized",
        login: "Gabriel-Darbord",
      },
    });

    const logoutOutput = captureOutput();
    await expect(
      main(
        [
          "auth",
          "github-app",
          "user",
          "logout",
          "--home",
          homePath,
          "--profile",
          "gabriel-devnexus-app-user",
          "--json",
        ],
        { stdout: logoutOutput.writer },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(logoutOutput.output())).toMatchObject({
      ok: true,
      removed: true,
    });
  });

  it("prints focused workspace init help", async () => {
    const output = captureOutput();

    await expect(
      main(["workspace", "init", "--help"], { stdout: output.writer }),
    ).resolves.toBe(0);

    expect(output.output()).toContain("Usage:");
    expect(output.output()).toContain("dev-nexus workspace init [workspace-root] [options]");
    expect(output.output()).toContain("User quickstart:");
    expect(output.output()).toContain("dev-nexus workspace init");
    expect(output.output()).toContain("Run from the directory you want to use");
    expect(output.output()).toContain("DevNexus home defaults to");
    expect(output.output()).toContain("--answers <json-file>");
    expect(output.output()).toContain("--dry-run");
    expect(output.output()).toContain("--json");
    expect(output.output()).not.toContain("--yes");
    expect(output.output()).toContain("Provider mutations are not part of workspace init.");
  });

  it("prints focused workspace component add help", async () => {
    const output = captureOutput();

    await expect(
      main(["workspace", "component", "add", "--help"], { stdout: output.writer }),
    ).resolves.toBe(0);

    expect(output.output()).toContain("Usage:");
    expect(output.output()).toContain(
      "dev-nexus workspace component add <workspace-root> [options]",
    );
    expect(output.output()).toContain("--answers <json-file>");
    expect(output.output()).toContain("--dry-run");
    expect(output.output()).toContain("--json");
    expect(output.output()).not.toContain("--yes");
    expect(output.output()).toContain("Provider mutations are not part of component add.");
  });

  it("prints JSON errors when --json is present", async () => {
    const output = captureOutput();

    await expect(
      main(["workspace", "init", "--bad-option", "--json"], {
        stdout: output.writer,
      }),
    ).resolves.toBe(1);

    expect(JSON.parse(output.output())).toMatchObject({
      ok: false,
      error: {
        code: "cli_error",
        message: "Unknown workspace init option: --bad-option",
      },
    });
  });

  it("refreshes a local project plugin and materializes skills and MCP config", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-plugin-project-");
    const pluginRoot = makeTempDir("dev-nexus-cli-plugin-package-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        agentTargets: {
          active: [
            {
              provider: "codex",
              mcp: {},
              skills: {},
            },
          ],
        },
      }),
    );
    fs.writeFileSync(
      path.join(pluginRoot, "package.json"),
      JSON.stringify(
        {
          name: "demo-dev-nexus-plugin",
          type: "module",
          main: "./index.js",
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(pluginRoot, "index.js"),
      [
        "export function demoDevNexusPluginConfig(options = {}) {",
        "  return {",
        "    id: 'demo-typescript',",
        "    name: 'Demo TypeScript',",
        "    version: '1.2.3',",
        "    enabled: true,",
        "    capabilities: [",
        "      { kind: 'projected_skill', id: 'skill-demo-ts', description: 'Project the demo TypeScript skill.', skillId: 'demo-ts', targetAgents: options.targetAgents?.length ? options.targetAgents : ['codex'] },",
        "      { kind: 'mcp_server', id: 'mcp-demo-ts', description: 'Project the demo TypeScript MCP server.', serverName: 'demo_ts', command: 'node', args: ['demo-server.js'], targetAgents: ['codex'], tools: [{ name: 'demo.status' }] }",
        "    ]",
        "  };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const skillRoot = path.join(pluginRoot, "skills", "demo-ts");
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, "dev-nexus.skill.json"),
      JSON.stringify(
        {
          id: "demo-ts",
          name: "demo-ts",
          description: "Demo TypeScript workflow skill.",
          version: "1.0.0",
          license: "Apache-2.0",
          source: {
            type: "local",
            uri: "demo-dev-nexus-plugin/skills/demo-ts",
          },
          supportedAgents: ["codex"],
          materialization: "copy",
          sourceControl: "support",
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: demo-ts\ndescription: Demo TypeScript workflow skill.\n---\n\n# Demo\n",
      "utf8",
    );
    const output = captureOutput();

    await expect(
      main(
        [
          "workspace",
          "plugin",
          "refresh",
          projectRoot,
          "--from",
          pluginRoot,
          "--json",
        ],
        { stdout: output.writer },
      ),
    ).resolves.toBe(0);

    const payload = JSON.parse(output.output());
    expect(payload.plugin).toMatchObject({
      id: "demo-typescript",
      created: true,
      capabilityCount: 2,
      projectedSkillCount: 1,
      mcpServerCount: 1,
    });
    expect(payload.skillProjection).toMatchObject({
      materializedSkillCount: 1,
      materializedAgentSkillCount: 1,
    });
    expect(payload.mcpProjection).toMatchObject({
      materializedServerCount: 1,
      materializedTargetCount: 1,
      skippedServers: [],
    });
    expect(loadProjectConfig(projectRoot).plugins?.[0]).toMatchObject({
      id: "demo-typescript",
      version: "1.2.3",
    });
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "demo-ts", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".agents", "skills", "demo-ts", "SKILL.md"),
      ),
    ).toBe(true);
    const codexConfig = fs.readFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "utf8",
    );
    expect(codexConfig).toContain("[mcp_servers.demo_ts]");
    expect(codexConfig).toContain('command = "node"');
    expect(codexConfig).toContain('args = ["demo-server.js"]');
  });

  it("does not directly materialize hidden or gateway-routed plugin MCP servers", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-plugin-exposure-");
    const pluginRoot = makeTempDir("dev-nexus-cli-plugin-exposure-package-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        agentTargets: {
          active: [
            {
              provider: "codex",
              mcp: {},
              skills: {},
            },
          ],
        },
      }),
    );
    fs.writeFileSync(
      path.join(pluginRoot, "package.json"),
      JSON.stringify(
        {
          name: "demo-mcp-exposure-plugin",
          type: "module",
          main: "./index.js",
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(pluginRoot, "index.js"),
      [
        "export function demoDevNexusPluginConfig() {",
        "  return {",
        "    id: 'demo-mcp-exposure',",
        "    enabled: true,",
        "    capabilities: [",
        "      { kind: 'mcp_server', id: 'direct-mcp', serverName: 'direct_mcp', command: 'node', args: ['direct.js'], targetAgents: ['codex'], exposure: 'direct' },",
        "      { kind: 'mcp_server', id: 'gateway-mcp', serverName: 'gateway_mcp', command: 'node', args: ['gateway.js'], targetAgents: ['codex'], exposure: 'gateway' },",
        "      { kind: 'mcp_server', id: 'hidden-mcp', serverName: 'hidden_mcp', command: 'node', args: ['hidden.js'], targetAgents: ['codex'], exposure: 'hidden' }",
        "    ]",
        "  };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const output = captureOutput();

    await main(
      [
        "workspace",
        "plugin",
        "refresh",
        projectRoot,
        "--from",
        pluginRoot,
        "--json",
      ],
      { stdout: output.writer },
    );

    const payload = JSON.parse(output.output());
    expect(payload.mcpProjection).toMatchObject({
      materializedServerCount: 1,
      materializedTargetCount: 1,
      skippedServers: [
        {
          serverName: "gateway_mcp",
          reason: "gateway_pending",
          exposureMode: "gateway",
        },
        {
          serverName: "hidden_mcp",
          reason: "hidden_exposure",
          exposureMode: "hidden",
        },
      ],
    });
    const codexConfig = fs.readFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "utf8",
    );
    expect(codexConfig).toContain("[mcp_servers.direct_mcp]");
    expect(codexConfig).not.toContain("gateway_mcp");
    expect(codexConfig).not.toContain("hidden_mcp");
  });

  it("prints a quick-fix plan for one provider-native GitHub issue", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "github",
            workTrackers: [
              {
                id: "github",
                name: "GitHub Issues",
                enabled: true,
                roles: ["primary", "eligible_source"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "demo",
                  },
                },
              },
            ],
            verification: {
              focusedCommands: ["npm test -- src/nexusQuickFix.test.ts"],
              fullCommands: ["npm run check"],
              requirePassing: true,
            },
            publication: {
              ...defaultNexusAutomationConfig.publication,
              strategy: "green_main",
              remote: "bot",
              targetBranch: "main",
              commandEnvironment: {
                GH_CONFIG_DIR: "home:.config/gh-automation-github",
              },
              greenMain: {
                integrationPreference: "pull_request",
                directTargetPush: "blocked",
                mergeAuthority: "authorized_merge",
                requiredChecks: ["Node 22 check (ubuntu-latest)"],
                staleChecks: "block",
              },
            },
            relationships: [],
          },
        ],
      }),
    );
    const output = captureOutput();

    await main(
      [
        "quick-fix",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--work-item",
        "github-50",
        "--topic",
        "quick fix",
        "--write-scope",
        "src/nexusQuickFix.ts",
      ],
      { stdout: output.writer },
    );

    expect(output.output()).toContain("DevNexus quick-fix plan.");
    expect(output.output()).toContain("Issue: example/demo#50 (github-50)");
    expect(output.output()).toContain("Validate automation forge actor");
    expect(output.output()).toContain("worktree prepare");
    expect(output.output()).toContain("Skipped bookkeeping:");

    const jsonOutput = captureOutput();
    await main(
      [
        "quick-fix",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--work-item",
        "github-50",
        "--json",
      ],
      { stdout: jsonOutput.writer },
    );
    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      issue: {
        repository: "example/demo",
        number: 50,
      },
      publication: {
        remote: "bot",
      },
    });

    const startOutput = captureOutput();
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    await main(
      [
        "quick-fix",
        "start",
        projectRoot,
        "--component",
        "primary",
        "--work-item",
        "github-50",
        "--topic",
        "quick fix start",
        "--json",
      ],
      {
        stdout: startOutput.writer,
        gitRunner: fakeGitRunner(gitCalls),
      },
    );
    expect(JSON.parse(startOutput.output())).toMatchObject({
      ok: true,
      mode: "start",
      issue: {
        repository: "example/demo",
        number: 50,
      },
      preparedWorktree: {
        worktree: {
          branchName: "codex/primary/quick-fix-start",
        },
      },
    });
    expect(gitCalls.map((call) => call.args.slice(0, 2))).toContainEqual([
      "worktree",
      "add",
    ]);

    const finishOutput = captureOutput();
    await main(
      [
        "quick-fix",
        "finish",
        projectRoot,
        "--component",
        "primary",
        "--work-item",
        "github-50",
        "--pr-url",
        "https://github.com/example/demo/pull/12",
        "--merge-commit",
        "abc123",
        "--verification",
        "npm run check passed",
        "--cleanup-action",
        "removed disposable worktree",
        "--json",
      ],
      { stdout: finishOutput.writer },
    );
    expect(JSON.parse(finishOutput.output())).toMatchObject({
      ok: true,
      mode: "finish",
      issue: {
        repository: "example/demo",
        number: 50,
      },
      result: {
        prUrl: "https://github.com/example/demo/pull/12",
        mergeCommit: "abc123",
        verification: "npm run check passed",
        cleanupActions: ["removed disposable worktree"],
      },
    });
  });

  it("prints a green-main publication plan from mocked PR checks", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const checksFile = path.join(projectRoot, "checks.json");
    fs.writeFileSync(
      checksFile,
      JSON.stringify(
        {
          checks: [
            {
              name: "Node 22 check (ubuntu-latest)",
              bucket: "pass",
            },
            {
              name: "Node 22 check (windows-latest)",
              bucket: "fail",
              link: "https://github.com/example/demo/actions/runs/1002/job/2",
              failure: {
                step: "Run npm test",
                test: "green-main publication plan",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "github",
            workTrackers: [
              {
                id: "github",
                name: "GitHub Issues",
                enabled: true,
                roles: ["primary", "eligible_source"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "demo",
                  },
                },
              },
            ],
            verification: {
              focusedCommands: [],
              fullCommands: [],
              requirePassing: true,
            },
            publication: {
              ...defaultNexusAutomationConfig.publication,
              strategy: "green_main",
              remote: "bot",
              targetBranch: "main",
              commandEnvironment: {
                GH_CONFIG_DIR: "home:.config/gh-automation-github",
              },
              greenMain: {
                integrationPreference: "pull_request",
                directTargetPush: "blocked",
                mergeAuthority: "authorized_merge",
                requiredChecks: [
                  "Node 22 check (ubuntu-latest)",
                  "Node 22 check (windows-latest)",
                ],
                staleChecks: "block",
              },
            },
            relationships: [],
          },
        ],
      }),
    );

    const output = captureOutput();
    await main(
      [
        "publication",
        "green-main",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--pr",
        "12",
        "--checks-file",
        checksFile,
      ],
      { stdout: output.writer },
    );

    expect(output.output()).toContain("DevNexus green-main publication plan.");
    expect(output.output()).toContain("Pull request: example/demo#12");
    expect(output.output()).toContain("Status: failed");
    expect(output.output()).toContain("Merge: blocked");
    expect(output.output()).toContain("Node 22 check (windows-latest):");
    expect(output.output()).toContain("Step: Run npm test");

    const jsonOutput = captureOutput();
    await main(
      [
        "publication",
        "green-main",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--pr",
        "12",
        "--checks-file",
        checksFile,
        "--allow-rerun",
        "--rerun-reason",
        "transient hosted runner failure",
        "--json",
      ],
      { stdout: jsonOutput.writer },
    );

    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      pullRequest: {
        repository: "example/demo",
        number: 12,
      },
      status: "failed",
      rerun: {
        decision: "rerun_once",
      },
    });

    const utf16ChecksFile = path.join(projectRoot, "checks-utf16.json");
    const greenChecksJson = JSON.stringify({
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          bucket: "pass",
        },
        {
          name: "Node 22 check (windows-latest)",
          bucket: "pass",
        },
      ],
    });
    fs.writeFileSync(
      utf16ChecksFile,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(greenChecksJson, "utf16le"),
      ]),
    );

    const utf16Output = captureOutput();
    await main(
      [
        "publication",
        "green-main",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--pr",
        "12",
        "--checks-file",
        utf16ChecksFile,
        "--json",
      ],
      { stdout: utf16Output.writer },
    );

    expect(JSON.parse(utf16Output.output())).toMatchObject({
      ok: true,
      status: "green",
      merge: {
        allowed: true,
      },
    });

    const utf16BeChecksFile = path.join(projectRoot, "checks-utf16be.json");
    const utf16BeBody = Buffer.from(greenChecksJson, "utf16le");
    for (let index = 0; index < utf16BeBody.length; index += 2) {
      const low = utf16BeBody[index]!;
      utf16BeBody[index] = utf16BeBody[index + 1]!;
      utf16BeBody[index + 1] = low;
    }
    fs.writeFileSync(
      utf16BeChecksFile,
      Buffer.concat([Buffer.from([0xfe, 0xff]), utf16BeBody]),
    );

    const utf16BeOutput = captureOutput();
    await main(
      [
        "publication",
        "green-main",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--pr",
        "12",
        "--checks-file",
        utf16BeChecksFile,
        "--json",
      ],
      { stdout: utf16BeOutput.writer },
    );

    expect(JSON.parse(utf16BeOutput.output())).toMatchObject({
      ok: true,
      status: "green",
    });

    const invalidChecksFile = path.join(projectRoot, "checks-invalid.json");
    fs.writeFileSync(invalidChecksFile, "{not-json", "utf8");
    const invalidOutput = captureOutput();
    await main(
      [
        "publication",
        "green-main",
        "plan",
        projectRoot,
        "--component",
        "primary",
        "--pr",
        "12",
        "--checks-file",
        invalidChecksFile,
        "--json",
      ],
      { stdout: invalidOutput.writer },
    );

    expect(JSON.parse(invalidOutput.output())).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("must contain valid JSON"),
      },
    });
    expect(JSON.parse(invalidOutput.output()).error.message).toContain(
      invalidChecksFile,
    );
  });

  it("normalizes publication provider evidence from a saved JSON fixture", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-evidence-");
    const evidenceFile = path.join(projectRoot, "evidence.json");
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        evidence: [
          {
            provider: "github",
            sourceKind: "pull_request",
            reviewTarget: {
              kind: "pull_request",
              number: 130,
              url: "https://github.com/example/demo/pull/130",
            },
            headBranch: "codex/evidence",
            headSha: "abc123",
            targetBranch: "main",
            intendedCiTier: "remote_smoke",
            mergeability: "mergeable",
            branchPolicy: "clear",
            checks: [
              {
                name: "Node 22 check (ubuntu-latest)",
                bucket: "pass",
                workflow: "CI",
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    const textOutput = captureOutput();
    await main(
      [
        "publication",
        "evidence",
        "normalize",
        evidenceFile,
        "--required-check",
        "Node 22 check (ubuntu-latest)",
      ],
      { stdout: textOutput.writer },
    );

    expect(textOutput.output()).toContain(
      "DevNexus publication provider evidence.",
    );
    expect(textOutput.output()).toContain("github pull_request codex/evidence");
    expect(textOutput.output()).toContain(
      "checks=success: all required checks are successful",
    );

    const jsonOutput = captureOutput();
    await main(
      [
        "publication",
        "evidence",
        "normalize",
        evidenceFile,
        "--required-check",
        "Node 22 check (ubuntu-latest)",
        "--json",
      ],
      { stdout: jsonOutput.writer },
    );

    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      evidence: [
        {
          provider: "github",
          sourceKind: "pull_request",
          headBranch: "codex/evidence",
          headSha: "abc123",
          intendedCiTier: "remote_smoke",
          mergeability: "mergeable",
          branchPolicy: "clear",
        },
      ],
      classifications: [
        {
          status: "success",
        },
      ],
    });
  });

  it("prints merge queue readiness from mocked provider and workflow evidence", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-merge-queue-");
    const evidenceFile = path.join(projectRoot, "merge-queue-evidence.json");
    const workflowTriggersFile = path.join(projectRoot, "workflow-triggers.json");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            relationships: [],
          },
        ],
        automation: {
          ...defaultNexusAutomationConfig,
          verification: {
            ...defaultNexusAutomationConfig.verification,
            ciTiers: defaultNexusReleaseTrainCiTierPolicy,
          },
          publication: {
            ...defaultNexusAutomationConfig.publication,
            strategy: "green_main",
            targetBranch: "main",
            greenMain: {
              integrationPreference: "pull_request",
              featureBranch: null,
              directTargetPush: "blocked",
              mergeAuthority: "authorized_merge",
              requiredChecks: [
                "Node 22 check (ubuntu-latest)",
                "Node 22 check (windows-latest)",
                "Node 22 check (macos-latest)",
              ],
              staleChecks: "block",
            },
          },
        },
      }),
    );
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        evidence: [
          {
            provider: "github",
            sourceKind: "candidate_branch",
            headRef: "candidate/0.2.0",
            targetBranch: "main",
            intendedCiTier: "candidate_matrix",
            checks: [
              { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
              { name: "Node 22 check (windows-latest)", bucket: "pass" },
              { name: "Node 22 check (macos-latest)", bucket: "pass" },
            ],
          },
          {
            provider: "github",
            sourceKind: "merge_queue_group",
            headRef: "refs/heads/gh-readonly-queue/main/pr-130",
            targetBranch: "main",
            intendedCiTier: "protected_target",
            checks: [
              { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
              { name: "Node 22 check (windows-latest)", bucket: "pass" },
              { name: "Node 22 check (macos-latest)", bucket: "pass" },
            ],
          },
        ],
      }),
      "utf8",
    );
    fs.writeFileSync(
      workflowTriggersFile,
      JSON.stringify({
        workflowTriggers: [
          {
            workflowName: "CI",
            events: ["pull_request", "merge_group"],
          },
        ],
      }),
      "utf8",
    );

    const textOutput = captureOutput();
    await main(
      [
        "publication",
        "merge-queue-readiness",
        projectRoot,
        "--component",
        "primary",
        "--merge-queue-enabled",
        "--evidence-file",
        evidenceFile,
        "--workflow-triggers-file",
        workflowTriggersFile,
      ],
      { stdout: textOutput.writer, now: () => "2026-05-21T11:30:00.000Z" },
    );

    expect(textOutput.output()).toContain("DevNexus merge queue readiness.");
    expect(textOutput.output()).toContain(
      "Merge queue: enabled workflowTrigger=present",
    );
    expect(textOutput.output()).toContain("Next action: wait");
    expect(textOutput.output()).toContain("Protected target gate: success");

    const jsonOutput = captureOutput();
    await main(
      [
        "publication",
        "merge-queue-readiness",
        projectRoot,
        "--component",
        "primary",
        "--merge-queue-enabled",
        "--evidence-file",
        evidenceFile,
        "--workflow-triggers-file",
        workflowTriggersFile,
        "--json",
      ],
      { stdout: jsonOutput.writer, now: () => "2026-05-21T11:30:00.000Z" },
    );

    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      nextAction: "wait",
      report: {
        mergeQueue: {
          enabled: true,
          workflowTriggerStatus: "present",
        },
        candidateMatrixEvidence: [
          {
            sourceKind: "candidate_branch",
            status: "success",
          },
        ],
        protectedTargetGate: {
          sourceKind: "merge_queue_group",
          status: "success",
        },
      },
    });
  });

  it("prints release train readiness in text and JSON", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-release-train-readiness-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            relationships: [],
          },
        ],
        automation: {
          ...defaultNexusAutomationConfig,
          verification: {
            ...defaultNexusAutomationConfig.verification,
            ciTiers: defaultNexusReleaseTrainCiTierPolicy,
          },
          publication: {
            ...defaultNexusAutomationConfig.publication,
            strategy: "green_main",
            targetBranch: "main",
          },
        },
        versionPlanning: {
          versions: [
            {
              id: "0.2.0",
              objective: "Ship train readiness.",
              owningComponents: ["primary"],
              targetBranch: "main",
              scope: [
                {
                  kind: "work_item",
                  status: "committed",
                  componentId: "primary",
                  trackerId: null,
                  workItemId: "github-120",
                },
              ],
              readinessGates: [],
              releasePolicy: {
                tags: "none",
                packages: "none",
                providerRelease: "none",
                releaseNotes: "none",
                changelog: "none",
              },
            },
          ],
        },
      }),
    );
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        releaseTrainLease({
          projectId: "demo-project",
          componentId: "primary",
          workItemId: "github-120",
          branchName: "codex/release-train-readiness",
        }),
      ],
    });
    const evidenceFile = path.join(projectRoot, "train-evidence.json");
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        evidence: [
          {
            branchName: "candidate/0.2.0",
            checks: [
              { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
              { name: "Node 22 check (windows-latest)", bucket: "pass" },
              { name: "Node 22 check (macos-latest)", bucket: "pass" },
            ],
          },
        ],
      }),
      "utf8",
    );

    const textOutput = captureOutput();
    await main(
      [
        "publication",
        "release-train-readiness",
        projectRoot,
        "--evidence-file",
        evidenceFile,
      ],
      {
        stdout: textOutput.writer,
        now: () => "2026-05-21T10:05:00.000Z",
      },
    );

    expect(textOutput.output()).toContain(
      "DevNexus release train readiness.",
    );
    expect(textOutput.output()).toContain("Next action: create_candidate_branch");
    expect(textOutput.output()).toContain("Version 0.2.0: 1 branch(es), 1 eligible");
    expect(textOutput.output()).toContain(
      "primary github-120 codex/release-train-readiness -> eligible",
    );
    expect(textOutput.output()).toContain(
      "next=candidate_matrix evidence=success",
    );

    const jsonOutput = captureOutput();
    await main(
      [
        "publication",
        "release-train-readiness",
        projectRoot,
        "--full-matrix-budget-exhausted",
        "--json",
      ],
      {
        stdout: jsonOutput.writer,
        now: () => "2026-05-21T10:05:00.000Z",
      },
    );

    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      nextAction: "wait",
      summary: {
        itemCount: 1,
        eligibleCount: 0,
        budgetLimitedCount: 1,
      },
      report: {
        components: [
          {
            items: [
              {
                workItemId: "github-120",
                candidateEligibility: "wait",
                ciTier: {
                  tier: {
                    id: "remote_smoke",
                  },
                  budgetLimited: true,
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("prints publication candidate branch planning dry-runs in text and JSON", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-candidate-plan-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            relationships: [],
          },
        ],
        automation: {
          ...defaultNexusAutomationConfig,
          verification: {
            ...defaultNexusAutomationConfig.verification,
            ciTiers: defaultNexusReleaseTrainCiTierPolicy,
          },
          publication: {
            ...defaultNexusAutomationConfig.publication,
            strategy: "green_main",
            targetBranch: "main",
          },
        },
        versionPlanning: {
          versions: [
            {
              id: "0.2.0",
              objective: "Ship candidate planning.",
              owningComponents: ["primary"],
              targetBranch: "main",
              scope: [
                {
                  kind: "work_item",
                  status: "committed",
                  componentId: "primary",
                  trackerId: null,
                  workItemId: "github-120",
                },
                {
                  kind: "work_item",
                  status: "committed",
                  componentId: "primary",
                  trackerId: null,
                  workItemId: "github-121",
                },
              ],
              readinessGates: [],
              releasePolicy: {
                tags: "none",
                packages: "none",
                providerRelease: "none",
                releaseNotes: "none",
                changelog: "none",
              },
            },
          ],
        },
      }),
    );
    writeNexusWorktreeLeaseStore(projectRoot, {
      version: 1,
      updatedAt: "2026-05-21T10:00:00.000Z",
      leases: [
        releaseTrainLease({
          id: "lease-cli-candidate-120",
          projectId: "demo-project",
          componentId: "primary",
          workItemId: "github-120",
          branchName: "codex/release-train-readiness",
        }),
        releaseTrainLease({
          id: "lease-cli-candidate-121",
          projectId: "demo-project",
          componentId: "primary",
          workItemId: "github-121",
          branchName: "codex/candidate-plan",
          writeScope: ["src/nexusCandidateBranchPlan.ts"],
        }),
      ],
    });

    const textOutput = captureOutput();
    await main(
      ["publication", "candidate-plan", projectRoot, "--version", "0.2.0"],
      {
        stdout: textOutput.writer,
        now: () => "2026-05-21T10:05:00.000Z",
      },
    );

    expect(textOutput.output()).toContain("DevNexus candidate branch plan.");
    expect(textOutput.output()).toContain("Selected version: 0.2.0");
    expect(textOutput.output()).toContain("Next action: create_integration_branch");
    expect(textOutput.output()).toContain("Integration branch: integration/0.2.0");
    expect(textOutput.output()).toContain("Candidate branch: candidate/0.2.0");
    expect(textOutput.output()).toContain(
      "Items: included=2; deferred=0; blocked=0; excluded=0",
    );
    expect(textOutput.output()).toContain(
      "primary github-121 codex/candidate-plan -> eligible",
    );

    const jsonOutput = captureOutput();
    await main(
      [
        "publication",
        "candidate-plan",
        projectRoot,
        "--full-matrix-budget-exhausted",
        "--json",
      ],
      {
        stdout: jsonOutput.writer,
        now: () => "2026-05-21T10:05:00.000Z",
      },
    );

    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      nextAction: "wait",
      summary: {
        selectedVersionId: "0.2.0",
        includedCount: 0,
        deferredCount: 2,
        blockedCount: 0,
      },
      plan: {
        mutatesSource: false,
        branches: {
          integration: "integration/0.2.0",
          candidate: "candidate/0.2.0",
        },
        deferred: [
          {
            workItemId: "github-120",
            candidateEligibility: "wait",
            reasons: expect.arrayContaining([
              "full matrix CI budget is exhausted",
            ]),
          },
          {
            workItemId: "github-121",
            candidateEligibility: "wait",
          },
        ],
      },
    });
  });

  it("keeps onboarding documentation command examples on the CLI surface", () => {
    const usagePrefixes = new Set(
      usage()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("dev-nexus "))
        .map(commandPrefix),
    );
    const documented = ["README.md", path.join("docs", "user", "getting-started.md")]
      .flatMap((relativePath) =>
        documentedDevNexusCommands(relativePath).map((command) => ({
          relativePath,
          command,
        })),
      );

    const missing = documented.filter(
      ({ command }) =>
        ![...usagePrefixes].some(
          (prefix) => command === prefix || command.startsWith(`${prefix} `),
        ),
    );

    expect(missing).toEqual([]);
  });

  it("reports installed CLI and documentation command skew without network access", async () => {
    const tempDir = makeTempDir("dev-nexus-cli-skew-");
    const olderHelpPath = path.join(tempDir, "older-help.txt");
    fs.writeFileSync(
      olderHelpPath,
      [
        "Usage:",
        "  dev-nexus --help",
        "  dev-nexus workspace status <workspace-id-or-root> [options]",
      ].join("\n"),
      "utf8",
    );
    const output = captureOutput();

    await expect(
      main(
        [
          "diagnostics",
          "cli-version-skew",
          "--installed-help-file",
          olderHelpPath,
          "--expected-command",
          "dev-nexus workspace status <workspace-id-or-root>",
          "--expected-command",
          "dev-nexus workspace init <workspace-root> --answers <answers.json>",
          "--package-version",
          "0.1.0-alpha.10",
          "--json",
        ],
        { stdout: output.writer },
      ),
    ).resolves.toBe(1);

    const parsed = JSON.parse(output.output());
    expect(parsed).toMatchObject({
      ok: false,
      diagnostic: {
        status: "skew_detected",
        installedPackageVersion: "0.1.0-alpha.10",
        missingDocumentedCommands: ["dev-nexus workspace init"],
        remediation: {
          action: "upgrade_npm_package",
        },
      },
    });
  });

  it("prints a human CLI skew remediation when installed help misses documented commands", async () => {
    const tempDir = makeTempDir("dev-nexus-cli-skew-human-");
    const olderHelpPath = path.join(tempDir, "older-help.txt");
    fs.writeFileSync(
      olderHelpPath,
      "Usage:\n  dev-nexus workspace status <workspace-id-or-root> [options]\n",
      "utf8",
    );
    const output = captureOutput();

    await expect(
      main(
        [
          "diagnostics",
          "cli-version-skew",
          "--installed-help-file",
          olderHelpPath,
          "--expected-command",
          "dev-nexus workspace init <workspace-root>",
        ],
        { stdout: output.writer },
      ),
    ).resolves.toBe(1);

    expect(output.output()).toContain("DevNexus CLI version skew: skew_detected.");
    expect(output.output()).toContain("Missing documented commands:");
    expect(output.output()).toContain("dev-nexus workspace init");
    expect(output.output()).toContain("Remediation:");
  });

  it("can inspect a dev-nexus command on PATH for skew", async () => {
    const output = captureOutput();
    const commands: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commands.push(command);
      return {
        command,
        cwd: options.cwd,
        stdout: "Usage:\n  dev-nexus workspace status <workspace-id-or-root> [options]\n",
        stderr: "",
        exitCode: 0,
      };
    };

    await expect(
      main(
        [
          "diagnostics",
          "cli-version-skew",
          "--installed-command",
          "dev-nexus",
          "--expected-command",
          "dev-nexus diagnostics cli-version-skew",
          "--json",
        ],
        { stdout: output.writer, commandRunner },
      ),
    ).resolves.toBe(1);

    expect(commands).toEqual(["dev-nexus --help"]);
    const parsed = JSON.parse(output.output());
    expect(parsed).toMatchObject({
      ok: false,
      diagnostic: {
        status: "skew_detected",
        missingDocumentedCommands: ["dev-nexus diagnostics cli-version-skew"],
      },
    });
  });

  it("prints workspace hosting status and plan through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-hosting-");
    const homePath = path.join(makeTempDir("dev-nexus-cli-hosting-home-"), "missing-home");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosting: {
          provider: "github",
          namespace: "ExampleOrg",
          repository: {
            name: "demo-project",
            visibility: "private",
            defaultBranch: "main",
          },
          remotes: [
            {
              name: "origin",
              role: "human",
              protocol: "ssh",
              authProfile: "human-github",
            },
          ],
          access: [
            {
              kind: "machine_user",
              providerIdentity: "ExampleBot",
              role: "automation",
              requiredPermission: "write",
              authProfile: "bot-github",
              invitationPolicy: "require_accepted",
            },
          ],
          provisioning: {
            allowCreate: false,
            allowLocalRemoteRepair: true,
            allowAccessRepair: false,
            allowInvitationAcceptance: false,
            allowDefaultBranchRepair: false,
            allowVisibilityRepair: false,
          },
        },
      }),
    );
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
      if (argsArray.join(" ") === "remote -v") {
        return ok(
          argsArray,
          "origin\tgit@github.com:WrongOrg/demo-project.git (fetch)\n" +
            "origin\tgit@github.com:WrongOrg/demo-project.git (push)\n",
        );
      }

      return ok(argsArray, "", 1);
    };

    const statusOutput = captureOutput();
    await expect(
      main(["workspace", "hosting", "status", projectRoot, "--home", homePath, "--json"], {
        stdout: statusOutput.writer,
        gitRunner,
      }),
    ).resolves.toBe(0);
    const statusPayload = JSON.parse(statusOutput.output());
    expect(statusPayload.status.remotes).toMatchObject([
      {
        name: "origin",
        status: "mismatch",
        expectedUrl: "git@github.com:ExampleOrg/demo-project.git",
        currentUrl: "git@github.com:WrongOrg/demo-project.git",
      },
    ]);
    expect(statusPayload.status.authProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "human-github", status: "missing" }),
        expect.objectContaining({ id: "bot-github", status: "missing" }),
      ]),
    );
    expect(statusPayload.status.issues.map((issue: any) => issue.code)).toEqual(
      expect.arrayContaining([
        "local_remote_url_mismatch",
        "auth_profile_missing",
        "provider_unavailable",
      ]),
    );

    const planOutput = captureOutput();
    await expect(
      main(["workspace", "hosting", "plan", projectRoot, "--home", homePath, "--json"], {
        stdout: planOutput.writer,
        gitRunner,
      }),
    ).resolves.toBe(0);
    const planPayload = JSON.parse(planOutput.output());
    expect(planPayload.plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "update_local_remote",
          disposition: "allowed",
          authProfile: "human-github",
        }),
      ]),
    );
  });

  it("applies workspace hosting local remote repairs through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-hosting-apply-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosting: {
          provider: "github",
          namespace: "ExampleOrg",
          repository: {
            name: "demo-project",
            visibility: "private",
            defaultBranch: "main",
          },
          remotes: [
            {
              name: "origin",
              role: "human",
              protocol: "ssh",
            },
            {
              name: "bot",
              role: "automation",
              protocol: "ssh",
              sshHost: "github.com-bot",
            },
          ],
          access: [],
          provisioning: {
            allowCreate: false,
            allowLocalRemoteRepair: true,
            allowAccessRepair: false,
            allowInvitationAcceptance: false,
            allowDefaultBranchRepair: false,
            allowVisibilityRepair: false,
          },
        },
      }),
    );
    const remotes = new Map<string, string>([
      ["origin", "git@github.com:WrongOrg/demo-project.git"],
      ["upstream", "git@github.com:ExampleOrg/upstream.git"],
    ]);
    const calls: string[][] = [];
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
      calls.push(argsArray);
      if (argsArray.join(" ") === "remote -v") {
        return ok(
          argsArray,
          [...remotes]
            .flatMap(([name, url]) => [
              `${name}\t${url} (fetch)`,
              `${name}\t${url} (push)`,
            ])
            .join("\n") + "\n",
        );
      }
      if (argsArray[0] === "remote" && argsArray[1] === "set-url") {
        remotes.set(argsArray[2]!, argsArray[3]!);
        return ok(argsArray, "");
      }
      if (argsArray[0] === "remote" && argsArray[1] === "add") {
        remotes.set(argsArray[2]!, argsArray[3]!);
        return ok(argsArray, "");
      }

      return ok(argsArray, "", 1);
    };
    const output = captureOutput();

    await expect(
      main(["workspace", "hosting", "apply", projectRoot, "--json"], {
        stdout: output.writer,
        gitRunner,
      }),
    ).resolves.toBe(0);

    const payload = JSON.parse(output.output());
    expect(payload.apply).toMatchObject({
      ok: true,
      status: "passed",
    });
    expect(payload.apply.actions.map((action: any) => action.command.args)).toEqual([
      [
        "remote",
        "set-url",
        "origin",
        "git@github.com:ExampleOrg/demo-project.git",
      ],
      [
        "remote",
        "add",
        "bot",
        "git@github.com-bot:ExampleOrg/demo-project.git",
      ],
    ]);
    expect(remotes.get("upstream")).toBe("git@github.com:ExampleOrg/upstream.git");
    expect(calls.filter((call) => call.join(" ") === "remote -v")).toHaveLength(2);
    expect(payload.apply.finalPlan.actions).toEqual([]);
  });

  it("applies workspace hosting repository creation through an injected provider", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-hosting-create-");
    const homePath = makeTempDir("dev-nexus-cli-hosting-create-home-");
    saveHomeConfig(homePath, [
      {
        id: "bot-github",
        provider: "github",
        kind: "automation",
        account: "example-bot",
        sshHost: "github.com-bot",
      },
    ]);
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosting: {
          provider: "github",
          namespace: "ExampleOrg",
          repository: {
            name: "demo-project",
            visibility: "private",
            defaultBranch: "main",
          },
          remotes: [
            {
              name: "bot",
              role: "automation",
              protocol: "ssh",
              authProfile: "bot-github",
            },
          ],
          access: [],
          provisioning: {
            allowCreate: true,
            allowLocalRemoteRepair: false,
            allowAccessRepair: false,
            allowInvitationAcceptance: false,
            allowDefaultBranchRepair: false,
            allowVisibilityRepair: false,
            providerMutationAuthProfile: "bot-github",
          },
        },
      }),
    );
    let repositoryCreated = false;
    const hostingProvider: NexusProjectHostingProviderAdapter = {
      provider: "github",
      async getRepository() {
        return repositoryCreated
          ? {
              namespace: "ExampleOrg",
              name: "demo-project",
              visibility: "private",
              defaultBranch: "main",
            }
          : null;
      },
      async getPermissions() {
        return {
          read: true,
          write: true,
          maintain: true,
          admin: true,
        };
      },
      async getAuthenticatedAccount(input) {
        return input.authProfile.account ?? null;
      },
      async createRepository(input) {
        repositoryCreated = true;
        return {
          status: "created",
          repository: {
            namespace: input.namespace,
            name: input.repositoryName,
            visibility: input.visibility,
            defaultBranch: input.defaultBranch,
          },
          webUrl: "https://github.com/ExampleOrg/demo-project",
          remoteUrl: "git@github.com-bot:ExampleOrg/demo-project.git",
        };
      },
    };
    const output = captureOutput();

    await expect(
      main(["workspace", "hosting", "apply", projectRoot, "--home", homePath, "--json"], {
        stdout: output.writer,
        hostingProvider,
      }),
    ).resolves.toBe(0);

    const payload = JSON.parse(output.output());
    expect(payload.apply).toMatchObject({
      ok: true,
      status: "passed",
      actions: [
        {
          actionId: "repository:create",
          disposition: "applied",
          providerResult: {
            status: "created",
            webUrl: "https://github.com/ExampleOrg/demo-project",
            remoteUrl: "git@github.com-bot:ExampleOrg/demo-project.git",
          },
        },
      ],
      finalPlan: {
        actions: [],
      },
    });
  });

  it("fails shared-checkout work-item mutations before writing local state", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      const joined = argsArray.join(" ");
      if (joined === "rev-parse --show-toplevel") {
        return ok(argsArray, `${path.resolve(cwd ?? projectRoot)}\n`);
      }
      if (joined === "worktree list --porcelain") {
        return ok(argsArray, `worktree ${projectRoot}\nHEAD abc123\nbranch refs/heads/main\n`);
      }

      return ok(argsArray, "");
    };

    await expect(
      main(
        ["work-item", "set-status", projectRoot, "local-1", "--status", "done"],
        {
          gitRunner,
          sharedCheckoutGuard: "enforce",
        },
      ),
    ).rejects.toThrow(/shared_checkout_mutation_refused/u);
    expect(fs.existsSync(defaultLocalWorkTrackingStorePath(projectRoot))).toBe(false);
  });

  it("fails guarded inbound import execution from a shared checkout before writing local state", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const generatedMetaWorktree = path.join(
      projectRoot,
      "worktrees",
      "demo-project",
      "worker",
    );
    fs.mkdirSync(generatedMetaWorktree, { recursive: true });
    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      const joined = argsArray.join(" ");
      if (joined === "rev-parse --show-toplevel") {
        return ok(argsArray, `${path.resolve(cwd ?? projectRoot)}\n`);
      }
      if (joined === "worktree list --porcelain") {
        return ok(argsArray, `worktree ${projectRoot}\nHEAD abc123\nbranch refs/heads/main\n`);
      }

      return ok(argsArray, "");
    };
    const originalCwd = process.cwd();
    process.chdir(generatedMetaWorktree);
    try {
      await expect(
        main(
          [
            "work-item",
            "import-execute",
            projectRoot,
            "--source-tracker",
            "github",
            "--target-tracker",
            "local",
            "--direction",
            "external_to_local",
            "--credentials",
            "available",
          ],
          {
            gitRunner,
            sharedCheckoutGuard: "enforce",
          },
        ),
      ).rejects.toThrow(/shared_project_checkout/u);
    } finally {
      process.chdir(originalCwd);
    }
    expect(fs.existsSync(defaultLocalWorkTrackingStorePath(projectRoot))).toBe(false);
  });

  it("allows guarded bootstrap worktree preparation", async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();

    await expect(
      main(["worktree", "prepare", projectRoot, "--topic", "guard bootstrap", "--json"], {
        stdout: output.writer,
        gitRunner: fakeGitRunner(calls),
        sharedCheckoutGuard: "enforce",
      }),
    ).resolves.toBe(0);

    const payload = JSON.parse(output.output());
    expect(payload.worktree.branchName).toBe("codex/primary/guard-bootstrap");
  });

  it("prepares manual component and workspace-meta worktrees through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-worktree-");
    const sourceRoot = path.join(projectRoot, "source");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(sourceDependency, { recursive: true });
    fs.writeFileSync(path.join(sourceDependency, "tool.txt"), "ready\n", "utf8");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        plugins: [
          {
            id: "typescript",
            enabled: true,
            name: "TypeScript Tooling",
            capabilities: [
              {
                kind: "dependency_projection",
                id: "node-modules",
                source: "node_modules",
                target: "node_modules",
                required: true,
                reason: "Resolve local npm binaries from prepared JS/TS worktrees.",
                targetComponents: ["primary"],
              },
            ],
          },
        ],
      }),
    );
    const output = captureOutput();
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    await main(
      [
        "worktree",
        "prepare",
        projectRoot,
        "--component",
        "primary",
        "--work-item",
        "local-42",
        "--topic",
        "Parallel chat isolation",
        "--host",
        "windows-devbox",
        "--agent",
        "codex",
        "--worker-agent",
        "codex",
        "--write-scope",
        "src",
        "--lease-note",
        "Preparing component worktree.",
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner: fakeGitRunner(gitCalls),
        now: fixedClock("2026-05-17T08:00:00.000Z"),
      },
    );

    const componentPayload = JSON.parse(output.output());
    expect(componentPayload).toMatchObject({
      ok: true,
      scope: "component",
      component: {
        id: "primary",
      },
      worktree: {
        componentId: "primary",
        branchName: "codex/primary/local-42",
        baseRef: "main",
        workItem: {
          id: "local-42",
        },
      },
      lease: {
        hostId: "windows-devbox",
        agentId: "codex",
        workItemId: "local-42",
        branchName: "codex/primary/local-42",
        status: "working",
        worktree: {
          kind: "component_worktree",
          relativePath: "codex-primary-local-42",
        },
        writeScope: ["src"],
        notes: ["Preparing component worktree."],
      },
      setup: {
        dependencyProjections: {
          total: 1,
          linked: 1,
          items: [
            {
              id: "node-modules",
              status: "linked",
              pluginId: "typescript",
              warningCount: 1,
              warnings: [
                expect.stringContaining("Projected node_modules is shared"),
              ],
            },
          ],
        },
        skillProjections: {
          agentCount: 0,
          skillCount: 0,
        },
        context: {
          contextJsonPath: path.join(
            projectRoot,
            "worktrees",
            "primary",
            "codex-primary-local-42",
            ".dev-nexus",
            "context",
            "context.json",
          ),
        },
      },
    });
    expect(componentPayload.setup.context.context).toBeUndefined();
    expect(componentPayload.setup.context.briefingMarkdown).toBeUndefined();
    const componentContext = JSON.parse(
      fs.readFileSync(componentPayload.setup.context.contextJsonPath, "utf8"),
    );
    expect(componentContext.agentTargetPolicy).toMatchObject({
      activeProviders: ["codex"],
      assignedProvider: "codex",
    });
    expect(componentPayload.worktree.worktreePath).toBe(
      path.join(projectRoot, "worktrees", "primary", "codex-primary-local-42"),
    );
    expect(
      fs.existsSync(
        path.join(componentPayload.worktree.worktreePath, "node_modules", "tool.txt"),
      ),
    ).toBe(true);
    let worktreeAddCalls = gitCalls.filter(
      (call) => call.args[0] === "worktree" && call.args[1] === "add",
    );
    expect(worktreeAddCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/primary/local-42",
        path.join(projectRoot, "worktrees", "primary", "codex-primary-local-42"),
        "main",
      ],
      cwd: sourceRoot,
    });

    const metaOutput = captureOutput();
    await main(
      [
        "worktree",
        "prepare",
        projectRoot,
        "--workspace-meta",
        "--topic",
        "Project state cleanup",
        "--worktree-name",
        "project-state-cleanup",
        "--json",
      ],
      {
        stdout: metaOutput.writer,
        gitRunner: fakeGitRunner(gitCalls),
        now: fixedClock("2026-05-17T08:00:00.000Z"),
      },
    );

    const metaPayload = JSON.parse(metaOutput.output());
    expect(metaPayload).toMatchObject({
      ok: true,
      scope: "project",
      component: null,
      worktree: {
        componentId: "demo-project",
        branchName: "codex/demo-project/project-state-cleanup",
        baseRef: "main",
        workItem: null,
      },
      lease: {
        scope: {
          kind: "project_meta",
          componentId: null,
        },
        branchName: "codex/demo-project/project-state-cleanup",
        status: "working",
        worktree: {
          kind: "project_meta_worktree",
          relativePath: "demo-project/project-state-cleanup",
        },
      },
    });
    expect(metaPayload.worktree.worktreePath).toBe(
      path.join(projectRoot, "worktrees", "demo-project", "project-state-cleanup"),
    );
    worktreeAddCalls = gitCalls.filter(
      (call) => call.args[0] === "worktree" && call.args[1] === "add",
    );
    expect(worktreeAddCalls[1]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/demo-project/project-state-cleanup",
        path.join(projectRoot, "worktrees", "demo-project", "project-state-cleanup"),
        "main",
      ],
      cwd: projectRoot,
    });
  });

  it("prints a Mac new-machine setup plan through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-setup-");
    fs.writeFileSync(
      path.join(projectRoot, "dev-nexus.project.json"),
      `${JSON.stringify(
        projectConfig({
          id: "mac-demo",
          name: "Mac Demo",
          repo: {
            kind: "git",
            remoteUrl: "git@github.com-bot:ExampleOrg/mac-demo.git",
            defaultBranch: "main",
          },
          components: [
            {
              id: "dev-nexus",
              name: "DevNexus",
              kind: "git",
              role: "primary",
              remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
              defaultBranch: "main",
              sourceRoot: "components/DevNexus",
              relationships: [],
            },
          ],
        }),
        null,
        2,
      )}\n`,
    );
    const output = captureOutput();

    await main(
      [
        "setup",
        "plan",
        projectRoot,
        "join-existing-project",
        "--platform",
        "macos",
        "--json",
      ],
      {
        stdout: output.writer,
      },
    );

    const parsed = JSON.parse(output.output());
    expect(parsed).toMatchObject({
      ok: true,
      plan: {
        flow: {
          id: "join-existing-project",
        },
        project: {
          id: "mac-demo",
        },
      },
    });
    expect(parsed.plan.steps.map((step: { id: string }) => step.id)).toContain(
      "configure-automation-auth-profile",
    );
  });

  it("reports required workspace init answers in non-interactive JSON mode", async () => {
    const output = captureOutput();

    await expect(
      main(["workspace", "init", "--json"], { stdout: output.writer }),
    ).resolves.toBe(2);

    expect(JSON.parse(output.output())).toMatchObject({
      ok: false,
      error: "project_setup_answers_required",
      requiredAnswers: expect.arrayContaining([
        "project.id",
        "components[0].source.path|remoteUrl",
      ]),
    });
    expect(JSON.parse(output.output()).requiredAnswers).not.toContain("home.path");
  });

  it("defaults workspace init home when answers omit home path", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-setup-default-home-");
    const defaultHomePath = path.join(makeTempDir("dev-nexus-default-home-"), "home");
    const componentRoot = path.join(projectRoot, "components", "core");
    fs.mkdirSync(componentRoot, { recursive: true });
    process.env.DEV_NEXUS_HOME = defaultHomePath;
    const answersPath = path.join(projectRoot, "answers.json");
    fs.writeFileSync(
      answersPath,
      `${JSON.stringify({
        project: {
          id: "default-home-demo",
          name: "Default Home Demo",
          root: projectRoot,
        },
        components: [
          {
            id: "core",
            role: "primary",
            source: {
              kind: "reference_existing",
              path: "components/core",
            },
          },
        ],
      }, null, 2)}\n`,
    );

    const previewOutput = captureOutput();
    await expect(
      main(
        [
          "workspace",
          "init",
          projectRoot,
          "--answers",
          answersPath,
          "--dry-run",
          "--json",
        ],
        { stdout: previewOutput.writer },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(previewOutput.output())).toMatchObject({
      ok: true,
      applied: false,
      proposal: {
        answers: {
          home: {
            path: defaultHomePath,
          },
        },
      },
    });

    const applyOutput = captureOutput();
    await expect(
      main(
        [
          "workspace",
          "init",
          projectRoot,
          "--answers",
          answersPath,
          "--json",
        ],
        { stdout: applyOutput.writer },
      ),
    ).resolves.toBe(0);

    expect(JSON.parse(
      fs.readFileSync(path.join(defaultHomePath, "dev-nexus.home.json"), "utf8"),
    ).projects).toEqual([
      expect.objectContaining({
        id: "default-home-demo",
        projectRoot,
      }),
    ]);
  });

  it("previews and applies workspace init from an answer file without provider mutations", async () => {
    const projectRoot = makeTempDir("dev-nexus-project-setup-");
    const homePath = makeTempDir("dev-nexus-project-setup-home-");
    const componentRoot = path.join(projectRoot, "components", "core");
    fs.mkdirSync(componentRoot, { recursive: true });
    const answersPath = path.join(projectRoot, "answers.json");
    fs.writeFileSync(
      answersPath,
      `${JSON.stringify({
        home: {
          path: homePath,
        },
        project: {
          id: "guided-demo",
          name: "Guided Demo",
          root: projectRoot,
          initializeGit: true,
          defaultBranch: "main",
        },
        components: [
          {
            id: "core",
            name: "Core",
            role: "primary",
            source: {
              kind: "reference_existing",
              path: "components/core",
              defaultBranch: "main",
            },
          },
        ],
        agentTargets: [
          {
            provider: "codex",
            configPath: ".codex/config.toml",
          },
        ],
        localWorkTracking: {
          enabled: true,
          provider: "local",
          storePath: ".dev-nexus/work-items/core.json",
        },
        authProfiles: [
          {
            id: "human-github",
            provider: "github",
            actorKind: "human",
            account: "alice",
            credentialMethod: {
              kind: "provider_cli",
              cli: "gh",
              configDir: "home:.config/gh",
            },
          },
          {
            id: "bot-github",
            provider: "github",
            actorKind: "machine_user",
            account: "guided-bot",
            credentialMethod: {
              kind: "provider_cli",
              cli: "gh",
              configDir: "home:.config/gh-bot",
            },
          },
        ],
        workTrackers: [
          {
            id: "github",
            provider: "github",
            role: "eligible_source",
            repositoryOwner: "ExampleOrg",
            repositoryName: "guided-demo",
            authProfileId: "bot-github",
          },
        ],
        hostingIntent: {
          provider: "github",
          namespace: "ExampleOrg",
          repositoryName: "guided-demo-meta",
          humanAuthProfileId: "human-github",
          automationAuthProfileId: "bot-github",
          providerMutationAuthProfileId: "bot-github",
        },
        publication: {
          posture: "review_handoff",
          remote: "bot",
          targetBranch: "main",
          automationAuthProfileId: "bot-github",
        },
      }, null, 2)}\n`,
    );
    const previewOutput = captureOutput();

    await expect(
      main(
        [
          "workspace",
          "init",
          projectRoot,
          "--answers",
          answersPath,
          "--dry-run",
          "--json",
        ],
        { stdout: previewOutput.writer },
      ),
    ).resolves.toBe(0);

    const preview = JSON.parse(previewOutput.output());
    expect(preview).toMatchObject({
      ok: true,
      applied: false,
      proposal: {
        authInventory: {
          requiredNowProfileIds: expect.arrayContaining([
            "human-github",
            "bot-github",
          ]),
          missingProfiles: [],
        },
        hostingHandoff: {
          status: "planned",
          provider: "github",
          repositoryName: "guided-demo-meta",
          providerMutationsDeferred: true,
          commands: expect.arrayContaining([
            expect.objectContaining({
              id: "hosting-status",
              providerMutation: false,
              authProfileId: "human-github",
            }),
            expect.objectContaining({
              id: "hosting-apply",
              providerMutation: true,
              allowedDuringProjectSetup: false,
              authProfileId: "bot-github",
            }),
          ]),
        },
        nextPhaseActions: [
          expect.objectContaining({
            id: "apply-hosting-intent",
            mutationClass: "provider_mutation",
            allowedDuringLocalSetup: false,
          }),
        ],
      },
    });
    expect(fs.existsSync(path.join(projectRoot, "dev-nexus.project.json"))).toBe(false);

    const applyOutput = captureOutput();
    await expect(
      main(
        [
          "workspace",
          "init",
          projectRoot,
          "--answers",
          answersPath,
          "--json",
        ],
        { stdout: applyOutput.writer },
      ),
    ).resolves.toBe(0);

    const applied = JSON.parse(applyOutput.output());
    expect(applied).toMatchObject({
      ok: true,
      applied: true,
      projectRoot,
      proposal: {
        nextPhaseActions: [
          expect.objectContaining({
            id: "apply-hosting-intent",
          }),
        ],
      },
    });
    expect(applied.nextActions).toEqual([
      `Open the DevNexus workspace root in Codex or your configured agent: ${projectRoot}`,
      `Run dev-nexus setup check ${shellQuoteArgument(projectRoot)} join-existing-project --json to verify local readiness.`,
      `Run dev-nexus workspace status ${shellQuoteArgument(projectRoot)} --json to inspect configured components.`,
      "Create or triage the first work item for component core with tracker local.",
      `Run dev-nexus workspace hosting status ${shellQuoteArgument(projectRoot)} --json when hosting intent is configured. Add --home only if you used a custom DevNexus home.`,
    ]);
    expect(fs.existsSync(path.join(projectRoot, "AGENTS.md"))).toBe(true);
    const agentsText = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    expect(agentsText).toContain("## Workspace And Components");
    expect(agentsText).toContain("The DevNexus workspace root contains orchestration files");
    expect(agentsText).toContain("Components are the source roots listed in `dev-nexus.project.json`");
    expect(agentsText).toContain("## First-Run Checklist");
    expect(agentsText).toContain("Run `dev-nexus setup check <workspace-root> join-existing-project --json`");
    expect(agentsText).toContain("Create or triage the first component work item");
    expect(agentsText).toContain("Before editing a Git checkout");
    expect(agentsText).toContain("Fetch configured remotes when policy allows");
    expect(agentsText).toContain("branches and worktrees proven merged");
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(true);
    expect(loadProjectConfig(projectRoot)).toMatchObject({
      id: "guided-demo",
      components: [
        expect.objectContaining({
          id: "core",
          defaultWorkTrackerId: "local",
          workTrackers: expect.arrayContaining([
            expect.objectContaining({
              id: "local",
              workTracking: {
                provider: "local",
                storePath: ".dev-nexus/work-items/core.json",
              },
            }),
            expect.objectContaining({
              id: "github",
              roles: ["eligible_source"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "ExampleOrg",
                  name: "guided-demo",
                },
              },
            }),
          ]),
        }),
      ],
      hosting: {
        provider: "github",
        namespace: "ExampleOrg",
        repository: {
          name: "guided-demo-meta",
        },
      },
    });
    expect(
      loadLocalWorkTrackingStore(
        path.join(projectRoot, ".dev-nexus", "work-items", "core.json"),
      ).items,
    ).toEqual([]);
    const homeConfig = JSON.parse(
      fs.readFileSync(path.join(homePath, "dev-nexus.home.json"), "utf8"),
    );
    expect(homeConfig.projects).toEqual([
      expect.objectContaining({
        id: "guided-demo",
        projectRoot,
      }),
    ]);
    expect(homeConfig.authProfiles).toEqual([
      expect.objectContaining({
        id: "human-github",
        actorId: "alice",
        provider: "github",
        kind: "human",
        account: "alice",
        command: "gh",
        githubCliConfigDir: "home:.config/gh",
      }),
      expect.objectContaining({
        id: "bot-github",
        actorId: "guided-bot",
        provider: "github",
        kind: "automation",
        account: "guided-bot",
        command: "gh",
        githubCliConfigDir: "home:.config/gh-bot",
      }),
    ]);
  });

  it("previews and applies an embedded workspace whose primary component is the workspace root", async () => {
    const projectRoot = makeTempDir("dev-nexus-embedded-project-setup-");
    const homePath = makeTempDir("dev-nexus-embedded-project-setup-home-");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
    const answersPath = path.join(projectRoot, "answers.json");
    fs.writeFileSync(
      answersPath,
      `${JSON.stringify({
        home: {
          path: homePath,
        },
        project: {
          id: "embedded-demo",
          name: "Embedded Demo",
          root: projectRoot,
          initializeGit: false,
          defaultBranch: "main",
        },
        components: [
          {
            id: "embedded-demo",
            name: "Embedded Demo",
            role: "primary",
            source: {
              kind: "reference_existing",
              path: ".",
              defaultBranch: "main",
            },
          },
        ],
        agentTargets: [
          {
            provider: "codex",
            configPath: ".codex/config.toml",
          },
        ],
        localWorkTracking: {
          enabled: true,
          provider: "local",
        },
      }, null, 2)}\n`,
    );

    const applyOutput = captureOutput();
    await expect(
      main(
        [
          "workspace",
          "init",
          projectRoot,
          "--answers",
          answersPath,
          "--json",
        ],
        { stdout: applyOutput.writer },
      ),
    ).resolves.toBe(0);

    expect(JSON.parse(applyOutput.output())).toMatchObject({
      ok: true,
      applied: true,
      projectRoot,
    });
    expect(loadProjectConfig(projectRoot)).toMatchObject({
      id: "embedded-demo",
      components: [
        expect.objectContaining({
          id: "embedded-demo",
          sourceRoot: ".",
          defaultWorkTrackerId: "local",
        }),
      ],
    });
  });

  it("previews and applies component add from an answer file", async () => {
    const projectRoot = makeTempDir("dev-nexus-component-add-");
    const homePath = makeTempDir("dev-nexus-component-add-home-");
    const primaryRoot = path.join(projectRoot, "components", "primary");
    const addonRoot = path.join(projectRoot, "components", "addon");
    fs.mkdirSync(primaryRoot, { recursive: true });
    fs.mkdirSync(addonRoot, { recursive: true });
    const setupAnswersPath = path.join(projectRoot, "setup.json");
    fs.writeFileSync(
      setupAnswersPath,
      `${JSON.stringify({
        home: {
          path: homePath,
        },
        project: {
          id: "component-add-demo",
          name: "Component Add Demo",
          root: projectRoot,
        },
        components: [
          {
            id: "primary",
            role: "primary",
            source: {
              kind: "reference_existing",
              path: "components/primary",
            },
          },
        ],
        agentTargets: [
          {
            provider: "codex",
          },
        ],
        localWorkTracking: {
          enabled: true,
          provider: "local",
        },
      }, null, 2)}\n`,
    );
    const componentAnswersPath = path.join(projectRoot, "component-add.json");
    fs.writeFileSync(
      componentAnswersPath,
      `${JSON.stringify({
        components: [
          {
            id: "addon",
            name: "Addon",
            role: "addon",
            source: {
              kind: "reference_existing",
              path: "components/addon",
            },
          },
        ],
        localWorkTracking: {
          enabled: true,
          provider: "local",
        },
      }, null, 2)}\n`,
    );

    const setupOutput = captureOutput();
    await expect(
      main([
        "workspace",
        "init",
        projectRoot,
        "--answers",
        setupAnswersPath,
        "--json",
      ], { stdout: setupOutput.writer }),
    ).resolves.toBe(0);

    const previewOutput = captureOutput();
    await expect(
      main(
        [
          "workspace",
          "component",
          "add",
          projectRoot,
          "--answers",
          componentAnswersPath,
          "--dry-run",
          "--json",
        ],
        { stdout: previewOutput.writer },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(previewOutput.output())).toMatchObject({
      ok: true,
      applied: false,
      proposal: {
        addedComponentIds: ["addon"],
      },
    });
    expect(loadProjectConfig(projectRoot).components.map((component) => component.id))
      .toEqual(["primary"]);

    const applyOutput = captureOutput();
    await expect(
      main(
        [
          "workspace",
          "component",
          "add",
          projectRoot,
          "--answers",
          componentAnswersPath,
          "--json",
        ],
        { stdout: applyOutput.writer },
      ),
    ).resolves.toBe(0);

    expect(JSON.parse(applyOutput.output())).toMatchObject({
      ok: true,
      applied: true,
      addedComponentIds: ["addon"],
    });
    expect(loadProjectConfig(projectRoot).components.map((component) => component.id))
      .toEqual(["primary", "addon"]);
    expect(
      loadLocalWorkTrackingStore(
        path.join(projectRoot, ".dev-nexus", "work-items", "addon.json"),
      ).items,
    ).toEqual([]);
  });

  it("initializes a home and manages projects through the CLI", async () => {
    const homePath = makeTempDir("dev-nexus-cli-home-");
    const initOutput = captureOutput();
    const createOutput = captureOutput();
    const listOutput = captureOutput();
    const registryStatusOutput = captureOutput();
    const pathStatusOutput = captureOutput();
    const gitCalls: string[][] = [];

    await main(
      [
        "home",
        "init",
        homePath,
        "--projects-root",
        "projects",
        "--workspaces-root",
        "workspaces",
        "--json",
      ],
      {
        stdout: initOutput.writer,
      },
    );
    await main(["workspace", "create", "HomeTool", "--home", homePath, "--json"], {
      stdout: createOutput.writer,
      projectGitRunner: fakeProjectGitRunner(gitCalls),
    });
    await main(["workspace", "list", "--home", homePath, "--json"], {
      stdout: listOutput.writer,
    });

    const created = JSON.parse(createOutput.output());
    await main(
      ["workspace", "status", "home-tool", "--home", homePath, "--json"],
      {
        stdout: registryStatusOutput.writer,
      },
    );
    await main(["workspace", "status", created.projectRoot, "--json"], {
      stdout: pathStatusOutput.writer,
    });

    expect(JSON.parse(initOutput.output())).toMatchObject({
      ok: true,
      homePath,
      config: {
        projects: [],
      },
    });
    expect(created).toMatchObject({
      ok: true,
      projectConfig: {
        id: "home-tool",
        name: "HomeTool",
      },
      reference: {
        id: "home-tool",
      },
    });
    expect(JSON.parse(listOutput.output()).projects).toMatchObject([
      {
        id: "home-tool",
        projectConfigExists: true,
      },
    ]);
    expect(JSON.parse(registryStatusOutput.output()).project).toMatchObject({
      id: "home-tool",
      projectRoot: created.projectRoot,
    });
    expect(JSON.parse(pathStatusOutput.output()).project).toMatchObject({
      id: "home-tool",
      projectRoot: created.projectRoot,
    });
    expect(gitCalls).toEqual([
      ["init", created.projectRoot],
      ["-C", created.projectRoot, "symbolic-ref", "--short", "HEAD"],
    ]);
  });

  it("imports projects and configures trackers through the CLI", async () => {
    const homePath = makeTempDir("dev-nexus-cli-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-cli-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const importOutput = captureOutput();
    const configureOutput = captureOutput();
    const linkOutput = captureOutput();
    const gitCalls: string[][] = [];

    await main(["home", "init", homePath], {
      stdout: captureOutput().writer,
    });
    await main(
      [
        "workspace",
        "import",
        sourceRoot,
        "--home",
        homePath,
        "--name",
        "Imported",
        "--json",
      ],
      {
        stdout: importOutput.writer,
        projectGitRunner: fakeProjectGitRunner(gitCalls, {
          branch: "trunk",
          remoteUrl: "https://example.invalid/imported.git",
        }),
      },
    );
    await main(
      [
        "workspace",
        "tracker",
        "configure",
        "imported",
        "--home",
        homePath,
        "--provider",
        "local",
        "--store-path",
        ".dev-nexus/work-items.json",
        "--json",
      ],
      {
        stdout: configureOutput.writer,
      },
    );
    await main(
      [
        "workspace",
        "tracker",
        "link",
        "imported",
        "--home",
        homePath,
        "--tracker-project-id",
        "tracker-1",
        "--json",
      ],
      {
        stdout: linkOutput.writer,
      },
    );

    expect(JSON.parse(importOutput.output())).toMatchObject({
      ok: true,
      projectConfig: {
        id: "imported",
        repo: {
          kind: "git",
          remoteUrl: "https://example.invalid/imported.git",
          defaultBranch: "trunk",
          sourceRoot,
        },
      },
    });
    expect(JSON.parse(configureOutput.output())).toMatchObject({
      ok: true,
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items.json",
      },
    });
    expect(JSON.parse(linkOutput.output())).toMatchObject({
      ok: true,
      vibeKanbanProjectId: "tracker-1",
      project: {
        id: "imported",
      },
    });
    expect(gitCalls).toContainEqual([
      "-C",
      sourceRoot,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
  });

  it("creates and lists local work items", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const createOutput = captureOutput();
    const listOutput = captureOutput();

    await main(
      [
        "work-item",
        "create",
        projectRoot,
        "--title",
        "Wire CLI",
        "--status",
        "ready",
        "--label",
        "automation",
        "--json",
      ],
      {
        stdout: createOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      ["work-item", "list", projectRoot, "--status", "ready", "--json"],
      {
        stdout: listOutput.writer,
      },
    );

    expect(JSON.parse(createOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Wire CLI",
    });
    expect(JSON.parse(listOutput.output()).workItems).toMatchObject([
      {
        id: "local-1",
        title: "Wire CLI",
      },
    ]);
  });

  it("targets component-scoped local work items through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), {
      recursive: true,
    });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items-primary.json",
            },
            relationships: [],
          },
          {
            id: "addon",
            name: "Addon",
            kind: "git",
            role: "addon",
            remoteUrl: "git@example.invalid:demo/addon.git",
            defaultBranch: "main",
            sourceRoot: "components/addon",
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items-addon.json",
            },
            relationships: [
              {
                kind: "extends",
                componentId: "primary",
              },
            ],
          },
        ],
      }),
    );
    const createOutput = captureOutput();
    const addonListOutput = captureOutput();
    const primaryListOutput = captureOutput();
    const getOutput = captureOutput();
    const updateOutput = captureOutput();
    const commentOutput = captureOutput();

    await main(
      [
        "work-item",
        "create",
        projectRoot,
        "--component",
        "addon",
        "--title",
        "Addon task",
        "--status",
        "ready",
        "--json",
      ],
      {
        stdout: createOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      ["work-item", "list", projectRoot, "--component", "addon", "--json"],
      {
        stdout: addonListOutput.writer,
      },
    );
    await main(["work-item", "list", projectRoot, "--json"], {
      stdout: primaryListOutput.writer,
    });
    await main(
      ["work-item", "get", projectRoot, "addon:local-1", "--json"],
      {
        stdout: getOutput.writer,
      },
    );
    await main(
      [
        "work-item",
        "update",
        projectRoot,
        "addon:local-1",
        "--status",
        "done",
        "--json",
      ],
      {
        stdout: updateOutput.writer,
      },
    );
    await main(
      [
        "work-item",
        "comment",
        projectRoot,
        "addon:local-1",
        "--body",
        "Component-qualified reference worked.",
        "--json",
      ],
      {
        stdout: commentOutput.writer,
      },
    );

    expect(JSON.parse(createOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Addon task",
      status: "ready",
    });
    expect(JSON.parse(addonListOutput.output()).workItems).toMatchObject([
      {
        id: "local-1",
        title: "Addon task",
      },
    ]);
    expect(JSON.parse(primaryListOutput.output()).workItems).toEqual([]);
    expect(JSON.parse(getOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Addon task",
    });
    expect(JSON.parse(updateOutput.output()).workItem).toMatchObject({
      id: "local-1",
      status: "done",
    });
    expect(JSON.parse(commentOutput.output()).comment).toMatchObject({
      body: "Component-qualified reference worked.",
    });
  });

  it("targets explicit and tracker-qualified work trackers through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-primary.json",
                },
              },
              {
                id: "mirror",
                name: "Mirror",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-mirror.json",
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );
    const defaultCreateOutput = captureOutput();
    const mirrorCreateOutput = captureOutput();
    const defaultListOutput = captureOutput();
    const mirrorListOutput = captureOutput();
    const qualifiedGetOutput = captureOutput();
    const statusOutput = captureOutput();

    await main(
      [
        "work-item",
        "create",
        projectRoot,
        "--title",
        "Default tracker task",
        "--json",
      ],
      {
        stdout: defaultCreateOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      [
        "work-item",
        "create",
        projectRoot,
        "--tracker",
        "mirror",
        "--title",
        "Mirror tracker task",
        "--json",
      ],
      {
        stdout: mirrorCreateOutput.writer,
        now: fixedClock("2026-05-16T10:01:00.000Z"),
      },
    );
    await main(["work-item", "list", projectRoot, "--json"], {
      stdout: defaultListOutput.writer,
    });
    await main(
      ["work-item", "list", projectRoot, "--tracker", "mirror", "--json"],
      {
        stdout: mirrorListOutput.writer,
      },
    );
    await main(["work-item", "get", projectRoot, "mirror:local-1", "--json"], {
      stdout: qualifiedGetOutput.writer,
    });
    await main(
      [
        "work-item",
        "set-status",
        projectRoot,
        "mirror:local-1",
        "--status",
        "done",
        "--json",
      ],
      {
        stdout: statusOutput.writer,
      },
    );

    expect(JSON.parse(defaultCreateOutput.output()).workItem).toMatchObject({
      title: "Default tracker task",
      trackerRef: {
        trackerId: "primary",
        default: true,
      },
    });
    expect(JSON.parse(mirrorCreateOutput.output()).workItem).toMatchObject({
      title: "Mirror tracker task",
      trackerRef: {
        trackerId: "mirror",
        default: false,
      },
    });
    expect(JSON.parse(defaultListOutput.output()).workItems).toMatchObject([
      {
        title: "Default tracker task",
        trackerRef: {
          trackerId: "primary",
        },
      },
    ]);
    expect(JSON.parse(mirrorListOutput.output()).workItems).toMatchObject([
      {
        title: "Mirror tracker task",
        trackerRef: {
          trackerId: "mirror",
        },
      },
    ]);
    expect(JSON.parse(qualifiedGetOutput.output()).workItem).toMatchObject({
      title: "Mirror tracker task",
      trackerRef: {
        trackerId: "mirror",
      },
    });
    expect(JSON.parse(statusOutput.output()).workItem).toMatchObject({
      id: "local-1",
      status: "done",
      trackerRef: {
        trackerId: "mirror",
      },
    });
  });

  it("links, shows, and unlinks work-item tracker references through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-primary.json",
                },
              },
              {
                id: "github",
                name: "GitHub",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "github",
                  host: "github.com",
                  repository: {
                    owner: "example",
                    name: "project",
                    id: "repo-1",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );
    const firstLinkOutput = captureOutput();
    const secondLinkOutput = captureOutput();
    const showOutput = captureOutput();
    const unlinkOutput = captureOutput();
    const finalShowOutput = captureOutput();

    await main(
      [
        "work-item",
        "link",
        projectRoot,
        "local-46",
        "--tracker",
        "github",
        "--item-id",
        "github-issue-42",
        "--item-number",
        "42",
        "--web-url",
        "https://github.com/example/project/issues/42",
        "--json",
      ],
      {
        stdout: firstLinkOutput.writer,
        now: fixedClock("2026-05-18T08:00:00.000Z"),
      },
    );
    await main(
      [
        "work-item",
        "link",
        projectRoot,
        "local-46",
        "--tracker",
        "github",
        "--item-id",
        "github-issue-42",
        "--item-number",
        "42",
        "--node-id",
        "I_kwDOUpdated",
        "--web-url",
        "https://github.com/example/project/issues/42#updated",
        "--json",
      ],
      {
        stdout: secondLinkOutput.writer,
        now: fixedClock("2026-05-18T08:01:00.000Z"),
      },
    );
    await main(["work-item", "show-links", projectRoot, "local-46", "--json"], {
      stdout: showOutput.writer,
    });
    await main(
      [
        "work-item",
        "unlink",
        projectRoot,
        "local-46",
        "--tracker",
        "github",
        "--item-id",
        "github-issue-42",
        "--reason",
        "Wrong external issue",
        "--json",
      ],
      {
        stdout: unlinkOutput.writer,
        now: fixedClock("2026-05-18T08:05:00.000Z"),
      },
    );
    await main(["work-item", "show-links", projectRoot, "local-46", "--json"], {
      stdout: finalShowOutput.writer,
    });

    expect(JSON.parse(firstLinkOutput.output())).toMatchObject({
      ok: true,
      action: "linked",
      reference: {
        trackerId: "github",
        provider: "github",
        repositoryOwner: "example",
        repositoryName: "project",
        itemId: "github-issue-42",
        itemNumber: 42,
      },
    });
    expect(JSON.parse(secondLinkOutput.output())).toMatchObject({
      ok: true,
      action: "updated",
      record: {
        references: [
          {
            itemId: "github-issue-42",
            nodeId: "I_kwDOUpdated",
          },
        ],
      },
    });
    expect(JSON.parse(showOutput.output())).toMatchObject({
      ok: true,
      references: [
        {
          trackerId: "github",
          itemId: "github-issue-42",
          webUrl: "https://github.com/example/project/issues/42#updated",
        },
      ],
    });
    expect(JSON.parse(unlinkOutput.output())).toMatchObject({
      ok: true,
      removedReference: {
        trackerId: "github",
        itemId: "github-issue-42",
      },
      audit: {
        action: "unlinked",
        reason: "Wrong external issue",
      },
    });
    expect(JSON.parse(finalShowOutput.output())).toMatchObject({
      ok: true,
      references: [],
      record: {
        audit: [
          { action: "linked" },
          { action: "updated" },
          { action: "unlinked" },
        ],
      },
    });
  });

  it("prints dry-run work-item sync plans through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/primary-items.json",
                },
              },
              {
                id: "mirror",
                name: "Mirror",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/mirror-items.json",
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: {
        provider: "local",
        storePath: ".dev-nexus/primary-items.json",
      },
    }).createWorkItem({
      projectRoot,
      title: "Mirror through CLI",
      status: "ready",
      labels: ["sync"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: {
        provider: "local",
        storePath: ".dev-nexus/primary-items.json",
      },
    }).createWorkItem({
      projectRoot,
      title: "Completed source",
      status: "done",
      labels: ["sync"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: {
        provider: "local",
        storePath: ".dev-nexus/mirror-items.json",
      },
    }).createWorkItem({
      projectRoot,
      title: "Unlinked target",
      status: "ready",
    });

    const output = captureOutput();
    await main(
      [
        "work-item",
        "sync-plan",
        projectRoot,
        "--component",
        "primary",
        "--source-tracker",
        "primary",
        "--target-tracker",
        "mirror",
        "--open",
        "--label",
        "sync",
        "--field",
        "title",
        "--field",
        "status",
        "--json",
      ],
      {
        stdout: output.writer,
        now: fixedClock("2026-05-18T09:00:00.000Z"),
      },
    );

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      plan: {
        dryRun: true,
        sourceTracker: {
          trackerId: "primary",
        },
        targetTracker: {
          trackerId: "mirror",
        },
        creates: [
          {
            source: {
              title: "Mirror through CLI",
            },
            targetDetection: "unlinked",
          },
        ],
        counts: {
          creates: 1,
          unlinkedTargets: 1,
        },
      },
    });
  });

  it("rejects ambiguous sync open and explicit status filters", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");

    await expect(
      main([
        "work-item",
        "sync-plan",
        projectRoot,
        "--source-tracker",
        "primary",
        "--target-tracker",
        "mirror",
        "--open",
        "--status",
        "ready",
      ]),
    ).rejects.toThrow(/cannot combine --open with --status/u);
  });

  it("gets, updates, and comments on local work items", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Draft task",
      description: "Initial",
      status: "todo",
      labels: ["draft"],
      assignees: ["agent-a"],
      milestone: "m1",
    });
    const getOutput = captureOutput();
    const updateOutput = captureOutput();
    const commentOutput = captureOutput();

    await main(["work-item", "get", projectRoot, "local-1", "--json"], {
      stdout: getOutput.writer,
    });
    await main(
      [
        "work-item",
        "update",
        projectRoot,
        "local-1",
        "--title",
        "Ready task",
        "--clear-description",
        "--status",
        "ready",
        "--label",
        "automation",
        "--clear-assignees",
        "--clear-milestone",
        "--json",
      ],
      {
        stdout: updateOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      [
        "work-item",
        "comment",
        projectRoot,
        "local-1",
        "--body",
        "Ready for scheduler pickup.",
        "--json",
      ],
      {
        stdout: commentOutput.writer,
        now: fixedClock("2026-05-16T10:05:00.000Z"),
      },
    );

    expect(JSON.parse(getOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Draft task",
      status: "todo",
    });
    expect(JSON.parse(updateOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Ready task",
      description: null,
      status: "ready",
      labels: ["automation"],
      assignees: [],
      milestone: null,
      closedAt: null,
    });
    expect(JSON.parse(commentOutput.output()).comment).toMatchObject({
      id: "local-comment-1",
      body: "Ready for scheduler pickup.",
    });
    const store = loadLocalWorkTrackingStore(
      defaultLocalWorkTrackingStorePath(projectRoot),
    );
    expect(store.comments["local-1"]).toHaveLength(1);
  });

  it("allows local work-item CLI mutations with a provider-scoped automation auth profile", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const homePath = path.join(projectRoot, "home");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveHomeConfig(homePath, [
      {
        id: "bot-github",
        kind: "automation",
        provider: "github",
        actorId: "local-tracker-bot",
        account: "local-tracker-bot",
      },
    ]);
    saveProjectConfig(
      projectRoot,
      projectConfig({
        home: homePath,
        automation: {
          ...defaultNexusAutomationConfig,
          publication: {
            ...defaultNexusAutomationConfig.publication,
            strategy: "local_only",
            actor: {
              id: "local-tracker-bot",
              kind: "machine_user",
              provider: "github",
              handle: "local-tracker-bot",
            },
          },
        },
        authority: {
          actors: [
            {
              id: "local-tracker-bot",
              kind: "machine_user",
              provider: "github",
              providerIdentity: "local-tracker-bot",
              displayName: "Local Tracker Bot",
            },
          ],
          roleBindings: [
            {
              actorId: "local-tracker-bot",
              roles: ["contributor"],
              scope: { component: "primary" },
            },
          ],
        },
      }),
    );
    const createOutput = captureOutput();
    const updateOutput = captureOutput();
    const commentOutput = captureOutput();
    const statusOutput = captureOutput();

    const createExit = await main(
      [
        "work-item",
        "create",
        projectRoot,
        "--component",
        "primary",
        "--title",
        "Local profile mismatch regression",
        "--status",
        "todo",
        "--json",
      ],
      {
        stdout: createOutput.writer,
        now: fixedClock("2026-05-19T10:00:00.000Z"),
      },
    );
    expect(createExit).toBe(0);
    const itemId = JSON.parse(createOutput.output()).workItem.id;
    const updateExit = await main(
      [
        "work-item",
        "update",
        projectRoot,
        itemId,
        "--component",
        "primary",
        "--title",
        "Local profile mismatch fixed",
        "--status",
        "ready",
        "--label",
        "dogfood",
        "--json",
      ],
      {
        stdout: updateOutput.writer,
        now: fixedClock("2026-05-19T10:01:00.000Z"),
      },
    );
    const commentExit = await main(
      [
        "work-item",
        "comment",
        projectRoot,
        itemId,
        "--component",
        "primary",
        "--body",
        "Local tracker comment.",
        "--json",
      ],
      {
        stdout: commentOutput.writer,
        now: fixedClock("2026-05-19T10:02:00.000Z"),
      },
    );
    const statusExit = await main(
      [
        "work-item",
        "set-status",
        projectRoot,
        itemId,
        "--component",
        "primary",
        "--status",
        "done",
        "--json",
      ],
      {
        stdout: statusOutput.writer,
        now: fixedClock("2026-05-19T10:03:00.000Z"),
      },
    );

    expect([createExit, updateExit, commentExit, statusExit]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(JSON.parse(updateOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Local profile mismatch fixed",
      status: "ready",
      labels: ["dogfood"],
    });
    expect(JSON.parse(commentOutput.output()).comment).toMatchObject({
      id: "local-comment-1",
      body: "Local tracker comment.",
    });
    expect(JSON.parse(statusOutput.output()).workItem).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("prints machine-readable authority blocks for provider work-item CLI mutations", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...defaultNexusAutomationConfig,
          publication: {
            ...defaultNexusAutomationConfig.publication,
            strategy: "local_only",
            actor: {
              id: "contributor-bot",
              kind: "machine_user",
              provider: "github",
              handle: "contributor-bot",
            },
          },
        },
        authority: {
          actors: [
            {
              id: "contributor-bot",
              kind: "machine_user",
              provider: "github",
              providerIdentity: "contributor-bot",
              displayName: "Contributor Bot",
            },
          ],
          roleBindings: [
            {
              actorId: "contributor-bot",
              roles: ["contributor"],
              scope: { component: "primary" },
            },
          ],
        },
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary",
                enabled: true,
                roles: ["primary"],
                workTracking: { provider: "local" },
              },
              {
                id: "github",
                name: "GitHub",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "project",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );
    const output = captureOutput();

    const exitCode = await main(
      [
        "work-item",
        "update",
        projectRoot,
        "42",
        "--tracker",
        "github",
        "--label",
        "blocked",
        "--json",
      ],
      { stdout: output.writer },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(output.output())).toMatchObject({
      ok: false,
      error: "authority_mutation_blocked",
      blockedMutation: {
        action: "provider.label",
        fallbackAction: "coordination.handoff",
      },
    });
  });

  it("records and reports coordination handoffs through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-14");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate shared work",
      status: "in_progress",
    });
    const handoffOutput = captureOutput();
    const statusOutput = captureOutput();
    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      const joined = argsArray.join(" ");
      if (joined === "rev-parse --show-toplevel") {
        return {
          args: argsArray,
          stdout: `${worktreePath}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "symbolic-ref --short HEAD") {
        return {
          args: argsArray,
          stdout: "codex/shared-coordination\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "rev-parse HEAD") {
        return {
          args: argsArray,
          stdout: "abc123\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return {
          args: argsArray,
          stdout: "origin/codex/shared-coordination\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "status --porcelain=v1") {
        return {
          args: argsArray,
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "rev-list --left-right --count HEAD...@{u}") {
        return {
          args: argsArray,
          stdout: "0\t0\n",
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

    await main(
      [
        "coordination",
        "handoff",
        projectRoot,
        "local-1",
        "--status",
        "ready",
        "--host",
        "windows-devbox",
        "--agent",
        "codex",
        "--changed-area",
        "src/nexusCoordination.ts",
        "--decision",
        "Use advisory records.",
        "--verification",
        "focused tests passed",
        "--integration-preference",
        "direct_integration",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: handoffOutput.writer,
        gitRunner,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      [
        "coordination",
        "status",
        projectRoot,
        "--work-item",
        "local-1",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: statusOutput.writer,
        gitRunner,
        now: fixedClock("2026-05-16T10:15:00.000Z"),
      },
    );

    expect(JSON.parse(handoffOutput.output())).toMatchObject({
      ok: true,
      record: {
        status: "ready",
        hostId: "windows-devbox",
        agentId: "codex",
        branch: "codex/shared-coordination",
      },
      comment: {
        id: "local-comment-1",
      },
    });
    expect(JSON.parse(statusOutput.output())).toMatchObject({
      ok: true,
      status: {
        workItem: {
          id: "local-1",
        },
        git: {
          dirty: false,
          pushed: true,
        },
        handoffs: {
          records: [
            {
              status: "ready",
              stale: false,
            },
          ],
        },
      },
    });
  });

  it("reports provider-backed coordination handoffs as incomplete through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-179");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot,
            worktreesRoot: "worktrees/primary",
            defaultWorkTrackerId: "local",
            workTrackers: [
              {
                id: "local",
                name: "Local",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                },
              },
              {
                id: "gitlab",
                name: "GitLab",
                enabled: true,
                roles: ["coordination"],
                workTracking: {
                  provider: "gitlab",
                  repository: {
                    id: "example/demo",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );
    const jsonOutput = captureOutput();
    const textOutput = captureOutput();

    await main(
      [
        "coordination",
        "status",
        projectRoot,
        "--tracker-role",
        "coordination",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: jsonOutput.writer,
        gitRunner: fakeCoordinationIntegrationGitRunner(worktreePath),
        now: fixedClock("2026-05-18T08:15:00.000Z"),
      },
    );
    await main(
      [
        "coordination",
        "status",
        projectRoot,
        "--tracker-role",
        "coordination",
        "--worktree",
        worktreePath,
      ],
      {
        stdout: textOutput.writer,
        gitRunner: fakeCoordinationIntegrationGitRunner(worktreePath),
        now: fixedClock("2026-05-18T08:15:00.000Z"),
      },
    );

    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      status: {
        handoffs: {
          available: false,
          capability: {
            read: false,
            write: false,
          },
          diagnostics: [
            {
              kind: "coordination_provider_capability_unavailable",
              capability: "read_handoffs",
            },
          ],
        },
        nextAction: expect.stringContaining("Use a local coordination tracker"),
      },
    });
    expect(textOutput.output()).toContain("Handoff storage: incomplete");
    expect(textOutput.output()).toContain("Use a local coordination tracker");
  });

  it("records coordination requests through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-17");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Ask for external coordination",
      status: "in_progress",
    });
    const output = captureOutput();
    const gitRunner = fakeCoordinationIntegrationGitRunner(worktreePath);

    await main(
      [
        "coordination",
        "request",
        projectRoot,
        "--work-item",
        "local-1",
        "--intent",
        "choice",
        "--question",
        "Which provider target shape should this change use?",
        "--target",
        "gitlab-mr:7",
        "--response-status",
        "approved",
        "--response-summary",
        "Use the neutral target record with provider-specific mock flow.",
        "--responder",
        "reviewer-a",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner,
        now: fixedClock("2026-05-17T10:00:00.000Z"),
      },
    );

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      record: {
        intent: "choice",
        status: "approved",
        workItemId: "local-1",
        target: {
          kind: "gitlab_merge_request",
          provider: "gitlab",
          value: "7",
        },
        provider: {
          provider: "gitlab",
          surface: "merge_request",
          mode: "draft",
          posted: false,
          credentialsUsed: false,
        },
        response: {
          status: "approved",
          responder: "reviewer-a",
        },
      },
      comment: {
        id: "local-comment-1",
      },
    });
  });

  it("uses coordination handoff --worktree for shared-checkout guard classification", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-118");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-20T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate guarded handoff",
      status: "in_progress",
    });
    const output = captureOutput();

    await expect(
      main(
        [
          "coordination",
          "handoff",
          projectRoot,
          "local-1",
          "--status",
          "ready",
          "--changed-area",
          "src/cli.ts",
          "--worktree",
          worktreePath,
          "--json",
        ],
        {
          stdout: output.writer,
          gitRunner: fakeCoordinationIntegrationGitRunner(worktreePath),
          sharedCheckoutGuard: "enforce",
          now: fixedClock("2026-05-20T10:00:00.000Z"),
        },
      ),
    ).resolves.toBe(1);

    expect(JSON.parse(output.output())).toMatchObject({
      ok: false,
      error: "shared_checkout_mutation_refused",
      guard: {
        ok: false,
        classification: "generated_component_worktree",
        mutationClass: "coordination_record",
        targetPath: worktreePath,
        recoveryAction: {
          kind: "prepare_workspace_meta_worktree",
        },
      },
    });
  });

  it("prints coordination integration plans through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-15");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Plan shared coordination integration",
      status: "in_progress",
    });
    const output = captureOutput();
    const gitRunner = fakeCoordinationIntegrationGitRunner(worktreePath);

    await main(
      [
        "coordination",
        "handoff",
        projectRoot,
        "local-1",
        "--status",
        "ready",
        "--changed-area",
        "src/nexusCoordination.ts",
        "--decision",
        "Keep integration planning read-only.",
        "--integration-preference",
        "direct_integration",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: captureOutput().writer,
        gitRunner,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      [
        "coordination",
        "integrate",
        projectRoot,
        "--work-item",
        "local-1",
        "--target-branch",
        "main",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner,
        now: fixedClock("2026-05-16T10:15:00.000Z"),
      },
    );

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      plan: {
        mutatesSource: false,
        target: {
          ref: "main",
          commit: "target123",
        },
        branches: [
          {
            branch: "codex/shared-coordination",
            merge: {
              status: "clean",
              changedFiles: ["src/nexusCoordination.ts"],
            },
          },
        ],
        suggestedOrder: [
          {
            branch: "codex/shared-coordination",
            direction: "codex/shared-coordination -> main",
          },
        ],
      },
    });
  });

  it("prints coordination cleanup dry-run plans through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-cleanup-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
      const joined = argsArray.join(" ");
      if (joined === "worktree list --porcelain") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (joined === "for-each-ref --format=%(refname:short) refs/heads/codex") {
        return {
          args: argsArray,
          stdout: "codex/primary/local-7\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (joined === "rev-parse --verify main") {
        return { args: argsArray, stdout: "target123\n", stderr: "", exitCode: 0 };
      }
      if (joined === "rev-parse codex/primary/local-7") {
        return { args: argsArray, stdout: "branch123\n", stderr: "", exitCode: 0 };
      }
      if (joined === "merge-base --is-ancestor codex/primary/local-7 main") {
        return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
      }
      if (
        joined ===
        "rev-parse --abbrev-ref --symbolic-full-name codex/primary/local-7@{u}"
      ) {
        return {
          args: argsArray,
          stdout: "origin/codex/primary/local-7\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        joined ===
        "rev-list --left-right --count codex/primary/local-7...origin/codex/primary/local-7"
      ) {
        return { args: argsArray, stdout: "0\t0\n", stderr: "", exitCode: 0 };
      }

      return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
    };

    await main(
      [
        "coordination",
        "cleanup-plan",
        projectRoot,
        "--component",
        "primary",
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner,
        now: fixedClock("2026-05-18T10:00:00.000Z"),
      },
    );

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      plan: {
        mutatesSource: false,
        summary: {
          total: 1,
          safe: 1,
        },
        candidates: [
          {
            branch: "codex/primary/local-7",
            classifications: ["merged", "safe"],
          },
        ],
      },
    });
  });

  it("returns actionable JSON when coordination integration cannot parse a local tracker store", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-61");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{ malformed local tracker store\n", "utf8");
    const output = captureOutput();
    const gitRunner = fakeCoordinationIntegrationGitRunner(worktreePath);

    const exitCode = await main(
      [
        "coordination",
        "integrate",
        projectRoot,
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner,
        now: fixedClock("2026-05-17T10:15:00.000Z"),
      },
    );

    const payload = JSON.parse(output.output());
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      diagnostics: [
        {
          kind: "coordination_tracker_read_failure",
          severity: "error",
          componentId: "primary",
          trackerId: "default",
          provider: "local",
          storePath: path.resolve(storePath),
          localStorePath: path.resolve(storePath),
          operation: "readCoordinationHandoffs",
          stage: "parse",
          workItemId: null,
          commentId: null,
        },
      ],
    });
    expect(payload.error).toContain("Coordination handoff read failed");
    expect(payload.diagnostics[0].message).toContain("component \"primary\"");
    expect(payload.diagnostics[0].message).toContain("tracker \"default\"");
    expect(payload.diagnostics[0].message).toContain("provider \"local\"");
    expect(payload.diagnostics[0].message).toContain(path.resolve(storePath));
    expect(payload.diagnostics[0].recovery).toContain("Repair the JSON store");
    expect(payload.diagnostics[0].cause).toContain("SyntaxError");
  });

  it("reports malformed handoff comments without hiding valid coordination handoffs", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-61");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock(
        "2026-05-16T09:00:00.000Z",
        "2026-05-16T09:05:00.000Z",
        "2026-05-16T09:10:00.000Z",
      ),
    });
    const validItem = await tracker.createWorkItem({
      title: "Valid handoff",
      status: "in_progress",
    });
    const malformedItem = await tracker.createWorkItem({
      title: "Malformed handoff",
      status: "in_progress",
    });
    const output = captureOutput();
    const gitRunner = fakeCoordinationIntegrationGitRunner(worktreePath);

    await main(
      [
        "coordination",
        "handoff",
        projectRoot,
        validItem.id,
        "--status",
        "ready",
        "--changed-area",
        "src/nexusCoordination.ts",
        "--decision",
        "Keep integration planning read-only.",
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: captureOutput().writer,
        gitRunner,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T10:05:00.000Z"),
    }).addComment(
      { id: malformedItem.id },
      "DevNexus coordination handoff\n\n```json\n{ malformed handoff\n```",
    );
    await main(
      [
        "coordination",
        "integrate",
        projectRoot,
        "--worktree",
        worktreePath,
        "--json",
      ],
      {
        stdout: output.writer,
        gitRunner,
        now: fixedClock("2026-05-16T10:15:00.000Z"),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      plan: {
        handoffs: {
          totalCount: 1,
          diagnostics: [
            {
              kind: "coordination_handoff_comment_malformed",
              severity: "warning",
              componentId: "primary",
              trackerId: "default",
              provider: "local",
              workItemId: malformedItem.id,
              commentId: "local-comment-2",
              operation: "readCoordinationHandoffs",
              stage: "handoff_comment_json_parse",
            },
          ],
        },
        branches: [
          {
            workItemId: validItem.id,
            branch: "codex/shared-coordination",
            merge: {
              status: "clean",
            },
          },
        ],
      },
    });
    expect(payload.plan.handoffs.warnings[0]).toContain("local-comment-2");
    expect(payload.plan.handoffs.warnings[0]).toContain(malformedItem.id);
    expect(payload.plan.warnings[0]).toContain("local-comment-2");
  });

  it("prints read-only automation status", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Runnable task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();

    await main(["automation", "status", projectRoot, "--json"], {
      stdout: output.writer,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "ready",
      candidateCount: 1,
      selectedWorkItem: {
        id: "local-1",
        title: "Runnable task",
      },
      lock: {
        status: "none",
      },
      externalIssueVisibility: {
        componentCount: 1,
        defaultTrackerOnlyComponentCount: 1,
        importOnlyWorkItemCount: 0,
        components: [
          {
            componentId: "primary",
            mode: "default_tracker_only",
          },
        ],
      },
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("prepares a Codex heartbeat automation recipe", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-heartbeat-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();

    await main(
      [
        "automation",
        "heartbeat",
        "prepare",
        projectRoot,
        "--interval-minutes",
        "20",
        "--paused",
        "--json",
      ],
      {
        stdout: output.writer,
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      project: {
        id: "demo-project",
      },
      codexAutomation: {
        kind: "heartbeat",
        destination: "thread",
        rrule: "FREQ=MINUTELY;INTERVAL=20",
        status: "PAUSED",
      },
    });
    expect(payload.codexAutomation.prompt).toContain(
      "automation status, eligible work, agent profiles, target report",
    );
    expect(payload.codexAutomation.prompt).toContain(
      "provider-native issue directly without importing or copying",
    );
  });

  it("prints concise eligible work grouped by component", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "components", "addon"), {
      recursive: true,
    });
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            workTrackers: [
              {
                id: "primary",
                name: "Primary Local",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: primaryStorePath,
                },
              },
              {
                id: "mirror",
                name: "Mirror",
                enabled: true,
                roles: ["mirror"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/work-items-mirror.json",
                },
              },
            ],
            relationships: [],
          },
          {
            id: "addon",
            name: "Addon",
            kind: "git",
            role: "addon",
            remoteUrl: "git@example.invalid:demo/addon.git",
            defaultBranch: "main",
            sourceRoot: "components/addon",
            workTracking: {
              provider: "local",
              storePath: addonStorePath,
            },
            relationships: [],
          },
        ],
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Primary task",
      status: "ready",
      labels: ["automation"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: fixedClock("2026-05-16T09:05:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Addon task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();

    await main(["automation", "eligible-work", projectRoot, "--json"], {
      stdout: output.writer,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      project: {
        id: "demo-project",
        name: "Demo Project",
      },
      status: "ready",
      eligibleWorkItemCount: 2,
      externalIssueVisibility: {
        componentCount: 2,
        defaultTrackerOnlyComponentCount: 2,
        importOnlyWorkItemCount: 0,
        components: [
          {
            componentId: "primary",
            mode: "default_tracker_only",
          },
          {
            componentId: "addon",
            mode: "default_tracker_only",
          },
        ],
      },
      selector: {
        statuses: ["ready"],
        labels: ["automation"],
        limit: 5,
      },
      components: [
        {
          componentId: "primary",
          componentName: "Primary",
          defaultTrackerId: "primary",
          workTrackers: [
            {
              id: "primary",
              provider: "local",
              enabled: true,
              roles: ["primary"],
              default: true,
              capabilityReport: {
                provider: "local",
                capabilities: {
                  list: true,
                  update: true,
                },
              },
            },
            {
              id: "mirror",
              provider: "local",
              enabled: true,
              roles: ["mirror"],
              default: false,
            },
          ],
          workItems: [
            {
              componentId: "primary",
              id: "local-1",
              logicalItemId: "local-1",
              title: "Primary task",
              status: "ready",
              trackerRef: {
                componentId: "primary",
                trackerId: "primary",
                provider: "local",
                default: true,
              },
            },
          ],
        },
        {
          componentId: "addon",
          componentName: "Addon",
          workItems: [
            {
              componentId: "addon",
              id: "local-1",
              title: "Addon task",
              status: "ready",
            },
          ],
        },
      ],
    });
    expect(payload.projectConfig).toBeUndefined();
  });

  it("prints opt-in discovery eligible work with import candidates", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const inboxStorePath = ".dev-nexus/work-items-inbox.json";
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "primary",
            trackerDiscovery: {
              scannedRoles: ["primary", "eligible_source"],
              directExternalSelection: "disabled",
              importRequiredFirst: true,
              providerFilters: ["local"],
              queryLimit: 10,
              conflictWinner: "default_tracker",
              missingCredentialBehavior: "skip",
            },
            workTrackers: [
              {
                id: "primary",
                name: "Primary Local",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                  storePath: primaryStorePath,
                },
              },
              {
                id: "inbox",
                name: "Inbox",
                enabled: true,
                roles: ["eligible_source"],
                workTracking: {
                  provider: "local",
                  storePath: inboxStorePath,
                },
              },
            ],
            relationships: [],
          },
        ],
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
        },
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Primary task",
      status: "ready",
      labels: ["automation"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: fixedClock("2026-05-16T09:02:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Todo task",
      status: "todo",
      labels: ["automation"],
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: inboxStorePath },
      now: fixedClock("2026-05-16T09:05:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Inbox task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();

    await main(
      ["automation", "eligible-work", projectRoot, "--discovery", "--json"],
      {
        stdout: output.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      mode: "discovery",
      eligibleWorkItemCount: 1,
      importCandidateWorkItemCount: 1,
      excludedWorkItemCount: 1,
      excludedReasonCounts: {
        "status todo not selected": 1,
      },
      excludedCategoryCounts: {
        status: 1,
      },
      externalIssueVisibility: {
        componentCount: 1,
        importRequiredComponentCount: 1,
        importOnlyWorkItemCount: 1,
        components: [
          {
            componentId: "primary",
            mode: "external_import_required",
            selectedExternalTrackerCount: 1,
            importOnlyWorkItemCount: 1,
          },
        ],
      },
      components: [
        {
          componentId: "primary",
          workItems: [
            {
              id: "local-1",
              selectable: true,
              importOnly: false,
              canonicalTrackerRef: {
                trackerId: "primary",
              },
              sourceTrackerRef: {
                trackerId: "primary",
              },
            },
          ],
          importCandidateWorkItems: [
            {
              id: "local-1",
              selectable: false,
              importOnly: true,
              canonicalTrackerRef: null,
              sourceTrackerRef: {
                trackerId: "inbox",
              },
            },
          ],
          excludedWorkItemCount: 1,
          excludedReasonCounts: {
            "status todo not selected": 1,
          },
          excludedCategoryCounts: {
            status: 1,
          },
          excludedWorkItems: [
            {
              id: "local-2",
              status: "todo",
              reasons: ["status todo not selected"],
              exclusionFindings: [
                {
                  category: "status",
                  reason: "status todo not selected",
                  value: "todo",
                },
              ],
            },
          ],
        },
      ],
    });
    const textOutput = captureOutput();
    await main(["automation", "eligible-work", projectRoot, "--discovery"], {
      stdout: textOutput.writer,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });
    expect(textOutput.output()).toContain("External issue visibility:");
    expect(textOutput.output()).toContain("1 import-required");
    expect(textOutput.output()).toContain("Visible excluded: 1");
    expect(textOutput.output()).toContain("Excluded categories: status: 1");
    expect(textOutput.output()).toContain(
      "local-2 [todo] excluded Todo task (status todo not selected)",
    );
  });

  it("prints read-only work item discovery status as json", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        workTracking: undefined,
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:demo/project.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "local",
            workTrackers: [
              {
                id: "local",
                name: "Local",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "local",
                },
              },
              {
                id: "github-inbox",
                name: "GitHub Inbox",
                enabled: true,
                roles: ["external_inbox", "eligible_source"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "demo",
                  },
                },
              },
            ],
            trackerDiscovery: {
              scannedRoles: ["primary", "eligible_source"],
              directExternalSelection: "disabled",
              importRequiredFirst: true,
              providerFilters: [],
              queryLimit: 10,
              conflictWinner: "default_tracker",
              missingCredentialBehavior: "skip",
            },
            relationships: [],
          },
        ],
      }),
    );
    const output = captureOutput();

    await main(["work-item", "discovery-status", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      project: {
        id: "demo-project",
      },
      warnings: [expect.stringContaining("github-inbox skipped")],
      blockers: [],
      components: [
        {
          componentId: "primary",
          defaultTracker: {
            id: "local",
          },
          effectiveDiscoveryPolicy: {
            scannedRoles: ["primary", "eligible_source"],
            missingCredentialBehavior: "skip",
          },
          configuredTrackers: [
            {
              id: "local",
              selectedForDiscovery: true,
              readable: {
                status: "readable",
              },
            },
            {
              id: "github-inbox",
              selectedForDiscovery: true,
              readable: {
                status: "skipped",
              },
              capabilityReport: {
                provider: "github",
                capabilities: {
                  list: true,
                },
              },
            },
          ],
        },
      ],
    });
    expect(payload.projectConfig).toBeUndefined();
  });

  it("prints concise agent profile policy", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
          agent: {
            ...projectConfig().automation!.agent,
            coordinatorProfileId: "codex-deep",
            maxConcurrentSubagents: 2,
            profiles: [
              {
                id: "codex-deep",
                executor: "codex",
                model: "gpt-5.5",
                version: "2026-05",
                variant: "pro",
                reasoning: "xhigh",
                intelligence: "deep",
                intendedUse: "coordinator",
                safety: {
                  profile: "isolated",
                  allowHostMutation: false,
                  allowDependencyInstall: false,
                  allowLiveServices: false,
                },
                command: "codex",
                args: ["exec"],
              },
            ],
          },
          safety: {
            profile: "host-authorized",
            allowHostMutation: true,
            allowDependencyInstall: false,
            allowLiveServices: false,
          },
        },
      }),
    );
    const output = captureOutput();

    await main(["automation", "agent-profiles", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      project: {
        id: "demo-project",
      },
      automationMode: "agent_launch",
      coordinatorProfileId: "codex-deep",
      maxConcurrentSubagents: 2,
      safety: {
        profile: "host-authorized",
        allowHostMutation: true,
        allowDependencyInstall: false,
        allowLiveServices: false,
      },
      profiles: [
        {
          id: "codex-deep",
          executor: "codex",
          model: "gpt-5.5",
          version: "2026-05",
          variant: "pro",
          reasoning: "xhigh",
          intelligence: "deep",
          intendedUse: "coordinator",
          safety: {
            profile: "isolated",
            allowHostMutation: false,
            allowDependencyInstall: false,
            allowLiveServices: false,
          },
          commandConfigured: true,
          argsCount: 1,
        },
      ],
    });
    expect(payload.projectConfig).toBeUndefined();
  });

  it("summarizes codex app-server profiles without local command or endpoint values", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          mode: "agent_launch",
          agent: {
            ...projectConfig().automation!.agent,
            profiles: [
              {
                id: "codex-app-server",
                executor: "codex",
                executorMode: "app_server",
                intendedUse: "subagent",
                model: "gpt-5.5",
                reasoning: "high",
                command: null,
                args: [],
                appServer: {
                  mode: "spawn",
                  command: "C:\\Users\\example\\Codex\\codex-app-server.exe",
                  args: ["--profile", "dogfood"],
                  endpoint: "http://127.0.0.1:17655",
                  ephemeralThreadDefault: true,
                  localPolicy: {
                    hostLocalSafetyHints: [
                      "requires_local_codex_account",
                      "spawns_local_process",
                    ],
                  },
                },
              },
            ],
          },
        },
      }),
    );
    const output = captureOutput();

    await main(["automation", "agent-profiles", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const rawOutput = output.output();
    const payload = JSON.parse(rawOutput);
    expect(payload.profiles).toEqual([
      expect.objectContaining({
        id: "codex-app-server",
        executor: "codex",
        executorMode: "app_server",
        appServer: {
          mode: "spawn",
          commandConfigured: true,
          argsCount: 2,
          endpointScope: "loopback",
          ephemeralThreadDefault: true,
          allowNonLoopbackEndpoint: false,
          hostLocalSafetyHints: [
            "requires_local_codex_account",
            "spawns_local_process",
          ],
        },
      }),
    ]);
    expect(rawOutput).not.toContain("C:\\Users\\example");
    expect(rawOutput).not.toContain("127.0.0.1:17655");
  });

  it("refreshes project agent MCP config through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();

    await main(
      [
        "workspace",
        "mcp",
        "refresh",
        projectRoot,
        "--agent",
        "codex",
        "--agent",
        "claude",
        "--agent",
        "opencode",
        "--json",
      ],
      {
        stdout: output.writer,
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      agentTargets: [
        {
          agent: "codex",
          serverName: "dev_nexus",
        },
        {
          agent: "claude",
          serverName: "dev_nexus",
        },
        {
          agent: "opencode",
          serverName: "dev_nexus",
          configSchema: "opencode.mcp.local",
        },
      ],
    });
    const expectedCommand = "node";
    const expectedArgs = [currentNexusCliScriptPath(), "mcp-stdio"];
    expect(
      fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8"),
    ).toContain("[mcp_servers.dev_nexus]");
    expect(
      JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"))
        .mcpServers.dev_nexus,
    ).toEqual({
      command: expectedCommand,
      args: expectedArgs,
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))
        .mcp.dev_nexus,
    ).toEqual({
      type: "local",
      command: [expectedCommand, ...expectedArgs],
      enabled: true,
    });
  });

  it("refreshes only active project MCP targets by default", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const output = captureOutput();
    saveProjectConfig(projectRoot, projectConfig({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      mcp: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    }));

    await main(["workspace", "mcp", "refresh", projectRoot], {
      stdout: output.writer,
    });

    expect(
      fs.existsSync(path.join(projectRoot, ".codex", "config.toml")),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".mcp.json"))).toBe(false);
  });

  it("refreshes an explicitly selected MCP target without touching others", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const output = captureOutput();
    saveProjectConfig(projectRoot, projectConfig({
      agentTargets: {
        active: [{ provider: "codex" }],
      },
      mcp: {
        agentTargets: [
          { agent: "codex" },
          { agent: "claude" },
        ],
      },
    }));

    await main(["workspace", "mcp", "refresh", projectRoot, "--agent", "claude"], {
      stdout: output.writer,
    });

    expect(fs.existsSync(path.join(projectRoot, ".mcp.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".codex", "config.toml")),
    ).toBe(false);
  });

  it("dry-runs project MCP refresh with effective exposure planning", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-dry-run-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        exposure: "gateway",
        agentTargets: [
          {
            agent: "codex",
            exposure: "direct",
          },
        ],
      },
      plugins: [
        {
          id: "workflow-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "workflow-mcp",
              serverName: "workflow_mcp",
              command: "node",
              args: ["workflow-server.js"],
              targetAgents: ["codex"],
            },
            {
              kind: "mcp_server",
              id: "hidden-mcp",
              serverName: "hidden_mcp",
              command: "node",
              args: ["hidden-server.js"],
              exposure: "hidden",
            },
          ],
        },
      ],
    }));
    const output = captureOutput();

    await main(
      ["workspace", "mcp", "refresh", projectRoot, "--dry-run", "--json"],
      {
        stdout: output.writer,
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      applied: false,
      exposurePlan: {
        directTargets: [
          {
            agent: "codex",
            serverName: "dev_nexus",
            mode: "direct",
            source: "agent_target",
          },
          {
            agent: "codex",
            serverName: "dev_nexus_gateway",
            mode: "direct",
            source: "agent_target",
          },
        ],
        pluginServers: [
          {
            pluginId: "workflow-plugin",
            capabilityId: "workflow-mcp",
            serverName: "workflow_mcp",
            mode: "gateway",
            source: "plugin",
          },
          {
            pluginId: "workflow-plugin",
            capabilityId: "hidden-mcp",
            serverName: "hidden_mcp",
            mode: "hidden",
            source: "server",
          },
        ],
      },
    });
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(false);
  });

  it("projects the gateway MCP server alongside direct targets when needed", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-gateway-refresh-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        agentTargets: [
          {
            agent: "codex",
            exposure: "direct",
          },
        ],
      },
      plugins: [
        {
          id: "workflow-plugin",
          enabled: true,
          mcpExposure: "gateway",
          capabilities: [
            {
              kind: "mcp_server",
              id: "workflow-mcp",
              serverName: "workflow_mcp",
              command: "node",
              args: ["workflow-server.js"],
              targetAgents: ["codex"],
              tools: [{ name: "workflow_search" }],
            },
          ],
        },
      ],
    }));
    const output = captureOutput();

    await main(["workspace", "mcp", "refresh", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const payload = JSON.parse(output.output());
    expect(payload.agentTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "codex",
          serverName: "dev_nexus",
          effectiveExposure: "direct",
        }),
        expect.objectContaining({
          agent: "codex",
          serverName: "dev_nexus_gateway",
          effectiveExposure: "direct",
        }),
      ]),
    );
    const codexConfig = fs.readFileSync(
      path.join(projectRoot, ".codex", "config.toml"),
      "utf8",
    );
    expect(codexConfig).toContain("[mcp_servers.dev_nexus]");
    expect(codexConfig).toContain("[mcp_servers.dev_nexus_gateway]");
    expect(codexConfig).toContain(`args = ["${currentNexusCliScriptPath()}", "mcp-gateway-stdio"]`);
    expect(codexConfig).not.toContain("workflow_mcp");
  });

  it("reports project MCP context budget without writing agent config", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-budget-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();

    await main(["workspace", "mcp", "budget", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      totals: {
        directTargetCount: 1,
        directServerCount: 1,
        pluginDeclaredServerCount: 0,
      },
      directServers: [
        {
          source: "direct",
          serverName: "dev_nexus",
          agent: "codex",
          metadataStatus: "known",
        },
      ],
    });
    expect(payload.totals.knownToolCount).toBeGreaterThan(20);
    expect(payload.totals.estimatedBytes).toBeGreaterThan(1000);
    expect(payload.topTools[0].estimatedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(false);
  });

  it("reports an empty MCP context budget when MCP projection is disabled", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-budget-empty-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      mcp: {
        enabled: false,
      },
    }));
    const output = captureOutput();

    await main(["workspace", "mcp", "budget", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      totals: {
        directTargetCount: 0,
        directServerCount: 0,
        pluginDeclaredServerCount: 0,
        knownToolCount: 0,
        estimatedBytes: 0,
        estimatedTokens: 0,
      },
      directServers: [],
      pluginDeclaredServers: [],
      topServers: [],
      topTools: [],
    });
  });

  it("includes plugin-declared MCP servers in the context budget report", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-plugin-budget-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      plugins: [
        {
          id: "workflow-plugin",
          enabled: true,
          capabilities: [
            {
              kind: "mcp_server",
              id: "workflow-mcp",
              serverName: "workflow_mcp",
              command: "node",
              args: ["workflow-server.js"],
              exposure: "gateway",
              targetAgents: ["codex"],
              tools: [
                {
                  name: "workflow.status",
                  description: "Read workflow status.",
                },
              ],
            },
          ],
        },
      ],
    }));
    const output = captureOutput();

    await main(["workspace", "mcp", "budget", projectRoot, "--json"], {
      stdout: output.writer,
    });

    const payload = JSON.parse(output.output());
    expect(payload.pluginDeclaredServers).toEqual([
      expect.objectContaining({
        source: "plugin",
        pluginId: "workflow-plugin",
        capabilityId: "workflow-mcp",
        serverName: "workflow_mcp",
        declaredToolCount: 1,
        materializationStatus: "declared",
        effectiveExposure: "gateway",
        exposureSource: "server",
        declaredTools: [
          expect.objectContaining({
            source: "plugin",
            serverName: "workflow_mcp",
            toolName: "workflow.status",
          }),
        ],
      }),
    ]);
  });

  it("prints a concise text MCP context budget report", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-budget-text-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const output = captureOutput();

    await main(["workspace", "mcp", "budget", projectRoot], {
      stdout: output.writer,
    });

    expect(output.output()).toContain("DevNexus MCP context budget");
    expect(output.output()).toContain("Direct MCP targets: 1");
    expect(output.output()).toContain("Plugin-declared MCP servers: 0");
    expect(output.output()).toContain("Visible MCP context:");
    expect(output.output()).toContain("Top MCP servers:");
  });

  it("reports malformed MCP budget project config as a JSON error", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-budget-invalid-");
    fs.writeFileSync(
      path.join(projectRoot, "dev-nexus.project.json"),
      "{",
      "utf8",
    );
    const output = captureOutput();

    const exitCode = await main(
      ["workspace", "mcp", "budget", projectRoot, "--json"],
      {
        stdout: output.writer,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(output.output())).toMatchObject({
      ok: false,
    });
  });

  it("reports missing MCP budget project config as a JSON error", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-mcp-budget-missing-");
    const output = captureOutput();

    const exitCode = await main(
      ["workspace", "mcp", "budget", projectRoot, "--json"],
      {
        stdout: output.writer,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(output.output())).toMatchObject({
      ok: false,
    });
  });

  it("cleans up stale generated agent workspaceions through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-agent-projection-cleanup-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".claude", "skills", "legacy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectRoot, ".claude", "skills", "legacy", "dev-nexus.skill.json"),
      "{}\n",
      "utf8",
    );
    fs.mkdirSync(path.join(projectRoot, ".opencode", "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".opencode", "skills", "README.md"),
      "manual support\n",
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
    const dryRunOutput = captureOutput();
    const applyOutput = captureOutput();

    await main(["workspace", "agent-projection", "cleanup", projectRoot, "--json"], {
      stdout: dryRunOutput.writer,
    });

    const dryRunPayload = JSON.parse(dryRunOutput.output());
    expect(dryRunPayload).toMatchObject({
      ok: true,
      mode: "dry-run",
      plan: {
        removableCount: 1,
        skippedCount: 2,
      },
    });
    expect(
      fs.existsSync(path.join(projectRoot, ".claude", "skills")),
    ).toBe(true);

    await main(
      ["workspace", "agent-projection", "cleanup", projectRoot, "--apply", "--json"],
      {
        stdout: applyOutput.writer,
      },
    );

    const applyPayload = JSON.parse(applyOutput.output());
    expect(applyPayload).toMatchObject({
      ok: true,
      mode: "apply",
      result: {
        status: "completed",
        removed: [
          expect.objectContaining({
            path: ".claude/skills",
          }),
        ],
      },
    });
    expect(
      fs.existsSync(path.join(projectRoot, ".claude", "skills")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(projectRoot, ".agents", "skills")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills")),
    ).toBe(true);
  });

  it("records and lists target cycles through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(),
      automation: {
        ...projectConfig().automation!,
        mode: "agent_launch",
        target: {
          ...projectConfig().automation!.target,
          id: "dogfood",
          objective: "Use the project until no eligible work remains.",
        },
      },
    });
    const recordOutput = captureOutput();
    const listOutput = captureOutput();
    const listFullOutput = captureOutput();

    await main(
      [
        "automation",
        "target-cycle",
        "record",
        projectRoot,
        "--cycle-id",
        "cycle-1",
        "--run-id",
        "run-1",
        "--status",
        "dispatched",
        "--summary",
        "Dispatched one subagent.",
        "--eligible-work-items",
        "1",
        "--work-item",
        "primary:local-1",
        "--work-item-tracker",
        "primary",
        "--work-item-logical-id",
        "local-1",
        "--note",
        "Coordinator selected the work item.",
        "--json",
      ],
      {
        stdout: recordOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      ["automation", "target-cycle", "list", projectRoot, "--json"],
      {
        stdout: listOutput.writer,
      },
    );
    await main(
      ["automation", "target-cycle", "list", projectRoot, "--json", "--full"],
      {
        stdout: listFullOutput.writer,
      },
    );

    expect(JSON.parse(recordOutput.output())).toMatchObject({
      ok: true,
      detail: "summary",
      record: {
        id: "cycle-1",
        targetId: "dogfood",
        runId: "run-1",
        status: "dispatched",
        summary: "Dispatched one subagent.",
        eligibleWorkItemCount: 1,
        workItemCount: 1,
      },
    });
    expect(JSON.parse(recordOutput.output()).record.workItems).toBeUndefined();
    expect(JSON.parse(listOutput.output()).ledger.cycles).toHaveLength(1);
    expect(JSON.parse(listOutput.output()).ledger.cycles[0].workItemRefs).toHaveLength(
      1,
    );
    expect(JSON.parse(listFullOutput.output()).ledger.cycles[0].workItems).toEqual([
      expect.objectContaining({
        componentId: "primary",
        id: "local-1",
        logicalItemId: "local-1",
        trackerId: "primary",
        cycleStatus: "selected",
      }),
    ]);
  });

  it("rejects duplicate explicit target cycle ids through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const firstOutput = captureOutput();

    await main(
      [
        "automation",
        "target-cycle",
        "record",
        projectRoot,
        "--cycle-id",
        "cycle-1",
        "--status",
        "started",
        "--json",
      ],
      {
        stdout: firstOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );

    const duplicateOutput = captureOutput();
    await expect(
      main(
        [
          "automation",
          "target-cycle",
          "record",
          projectRoot,
          "--cycle-id",
          "cycle-1",
          "--status",
          "completed",
          "--json",
        ],
        {
          stdout: duplicateOutput.writer,
          now: fixedClock("2026-05-16T10:10:00.000Z"),
        },
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(duplicateOutput.output())).toMatchObject({
      ok: false,
      error: {
        message: expect.stringMatching(
          /target cycle id already exists: cycle-1\. Choose a new --cycle-id or inspect the existing record/,
        ),
      },
    });
    expect(
      readNexusAutomationTargetCycleLedger(
        projectRoot,
        projectConfig().automation!,
      ).cycles,
    ).toMatchObject([
      {
        id: "cycle-1",
        status: "started",
      },
    ]);
  });

  it("records coordinator subagent dispatch progress through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(),
      automation: {
        ...projectConfig().automation!,
        mode: "agent_launch",
        target: {
          ...projectConfig().automation!.target,
          id: "dogfood",
        },
      },
    });
    const output = captureOutput();

    await main(
      [
        "automation",
        "target-cycle",
        "record",
        projectRoot,
        "--cycle-id",
        "cycle-dispatch",
        "--status",
        "dispatched",
        "--work-item",
        "primary:local-1",
        "--work-item-status",
        "selected",
        "--work-item-agent-profile",
        "codex-coordinator",
        "--work-item-note",
        "Selected for the bounded batch.",
        "--work-item",
        "primary:local-2",
        "--work-item-status",
        "dispatched",
        "--work-item-agent-profile",
        "codex-local",
        "--work-item-note",
        "Subagent launched.",
        "--work-item",
        "addon:local-3",
        "--work-item-status",
        "in_progress",
        "--work-item-agent-profile",
        "codex-local",
        "--work-item-note",
        "Focused tests running.",
        "--work-item",
        "addon:local-4",
        "--work-item-status",
        "completed",
        "--work-item-agent-profile",
        "codex-local",
        "--work-item-note",
        "Verification passed.",
        "--work-item",
        "tools:local-5",
        "--work-item-status",
        "blocked",
        "--work-item-agent-profile",
        "codex-local",
        "--work-item-note",
        "Waiting for credentials.",
        "--work-item",
        "tools:local-6",
        "--work-item-status",
        "skipped",
        "--work-item-agent-profile",
        "codex-local",
        "--work-item-note",
        "Dependency remained blocked.",
        "--json",
      ],
      {
        stdout: output.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      detail: "summary",
      record: {
        id: "cycle-dispatch",
        status: "dispatched",
        workItemCount: 6,
      },
    });
    expect(JSON.parse(output.output()).record.workItems).toBeUndefined();
  });

  it("builds target reports through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(),
      automation: {
        ...projectConfig().automation!,
        mode: "agent_launch",
        target: {
          ...projectConfig().automation!.target,
          id: "dogfood",
          objective: "Use the project until no eligible work remains.",
        },
      },
    });
    const recordOutput = captureOutput();
    const reportOutput = captureOutput();

    await main(
      [
        "automation",
        "target-cycle",
        "record",
        projectRoot,
        "--cycle-id",
        "cycle-1",
        "--status",
        "completed",
        "--summary",
        "Target completed.",
        "--eligible-work-items",
        "0",
        "--work-item",
        "primary:local-1",
        "--json",
      ],
      {
        stdout: recordOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(["automation", "target-report", projectRoot, "--json"], {
      stdout: reportOutput.writer,
      now: fixedClock("2026-05-16T10:05:00.000Z"),
    });

    expect(JSON.parse(reportOutput.output())).toMatchObject({
      ok: true,
      report: {
        status: "completed",
        statusReason: "Latest target cycle cycle-1 is completed",
        project: {
          id: "demo-project",
        },
        target: {
          id: "dogfood",
        },
        cycleSummary: {
          cycleCount: 1,
          completedCycleCount: 1,
        },
        externalIssueVisibility: {
          componentCount: 1,
          defaultTrackerOnlyComponentCount: 1,
          components: [
            {
              componentId: "primary",
              mode: "default_tracker_only",
            },
          ],
        },
        workItemSummary: {
          uniqueReferences: [
            {
              componentId: "primary",
              id: "local-1",
            },
          ],
        },
        relaunchDecision: {
          type: "stop",
          eligibleWorkItemCount: 0,
          latestCycleId: "cycle-1",
          latestRunId: null,
        },
      },
    });
  });

  it("prints compact version planning in target report text and json output", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const baseConfig = projectConfig();
    saveProjectConfig(projectRoot, {
      ...baseConfig,
      automation: {
        ...baseConfig.automation!,
        publication: {
          ...baseConfig.automation!.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: "v-next",
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            featureBranchDelivery: {
              enabled: true,
              activeFeatureId: "codex-goals",
              defaultBranchStrategy: "hybrid",
              branchNaming: {
                defaultIntentPrefix: "feat",
              },
            },
            ciTiers: defaultNexusReleaseTrainCiTierPolicy,
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
      versionPlanning: {
        versions: [
          {
            id: "v-next",
            objective: "Expose version planning surfaces.",
            owningComponents: ["primary"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                componentId: "primary",
                trackerId: null,
                workItemId: "local-1",
                status: "committed",
              },
            ],
            readinessGates: [
              {
                kind: "work_items_done",
                required: true,
                components: ["primary"],
              },
            ],
            releasePolicy: {
              tags: "none",
              packages: "none",
              providerRelease: "none",
              releaseNotes: "none",
              changelog: "none",
            },
          },
        ],
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Surface version planning",
      status: "ready",
    });
    const recordOutput = captureOutput();
    const textOutput = captureOutput();
    const jsonOutput = captureOutput();

    await main(
      [
        "automation",
        "target-cycle",
        "record",
        projectRoot,
        "--cycle-id",
        "cycle-1",
        "--status",
        "completed",
        "--eligible-work-items",
        "1",
        "--work-item",
        "primary:local-1",
      ],
      {
        stdout: recordOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(["automation", "target-report", projectRoot], {
      stdout: textOutput.writer,
      now: fixedClock("2026-05-16T10:05:00.000Z"),
    });
    await main(["automation", "target-report", projectRoot, "--json"], {
      stdout: jsonOutput.writer,
      now: fixedClock("2026-05-16T10:05:00.000Z"),
    });

    expect(textOutput.output()).toContain(
      "Release trains: 1 configured, 1 enabled.",
    );
    expect(textOutput.output()).toContain(
      "primary: active=v-next candidate=candidate/v-next integration=integration/v-next tier=remote_smoke",
    );
    expect(textOutput.output()).toContain(
      "Feature branch delivery: branchStrategy=hybrid active=codex-goals feature=feat/codex-goals changes=feat/codex-goals/{change}",
    );
    expect(textOutput.output()).toContain("Selector labels: none");
    expect(textOutput.output()).toContain("Version planning: 1 shown");
    expect(textOutput.output()).toContain(
      "v-next: blocked; scope 1/1 resolved",
    );
    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      report: {
        versionPlanning: {
          versions: [
            {
              id: "v-next",
              readiness: {
                ready: false,
                state: "blocked",
              },
              gateWarnings: [
                {
                  kind: "work_items_done",
                  status: "failed",
                },
              ],
            },
          ],
        },
        componentProgress: [
          {
            componentId: "primary",
            releaseTrain: {
              enabled: true,
              activeVersionId: "v-next",
              candidateBranch: "candidate/v-next",
              integrationBranch: "integration/v-next",
              featureBranchDelivery: {
                activeScopeId: "codex-goals",
                branchStrategy: "hybrid",
                featureBranch: "feat/codex-goals",
                reviewBranchPattern: "feat/codex-goals/{change}",
                finalPublicationTarget: "main",
                commentPolicy: "status_only",
              },
              ciTierDefault: "remote_smoke",
              selectorLabels: [],
              requiresPublicLabel: false,
            },
          },
        ],
      },
    });
  });

  it("prints read-only feature branch delivery plans", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const baseConfig = projectConfig();
    saveProjectConfig(projectRoot, {
      ...baseConfig,
      automation: {
        ...baseConfig.automation!,
        publication: {
          ...baseConfig.automation!.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: "v-next",
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            featureBranchDelivery: {
              ...defaultNexusFeatureBranchDeliveryConfig,
              enabled: true,
              activeFeatureId: "codex-goals",
              defaultBranchStrategy: "hybrid",
            },
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
    });
    const textOutput = captureOutput();
    const jsonOutput = captureOutput();

    await main(
      ["publication", "feature-plan", projectRoot, "--component", "primary"],
      {
        stdout: textOutput.writer,
      },
    );
    await main(
      [
        "publication",
        "feature-plan",
        projectRoot,
        "--component",
        "primary",
        "--json",
      ],
      {
        stdout: jsonOutput.writer,
      },
    );

    expect(textOutput.output()).toContain("DevNexus feature branch delivery plan.");
    expect(textOutput.output()).toContain(
      "primary: active=codex-goals branchStrategy=hybrid",
    );
    expect(textOutput.output()).toContain(
      "feature=feat/codex-goals changes=feat/codex-goals/{change}",
    );
    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      plan: {
        itemCount: 1,
        mutatesSource: false,
        items: [
          {
            componentId: "primary",
            feature: {
              activeScopeId: "codex-goals",
              defaultBranchStrategy: "hybrid",
              branchPlan: {
                featureBranch: "feat/codex-goals",
                reviewBranchPattern: "feat/codex-goals/{change}",
                finalPublicationTarget: "main",
              },
            },
          },
        ],
      },
    });
  });

  it("prints read-only feature branch delivery reports", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const baseConfig = projectConfig();
    saveProjectConfig(projectRoot, {
      ...baseConfig,
      automation: {
        ...baseConfig.automation!,
        publication: {
          ...baseConfig.automation!.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: "v-next",
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            featureBranchDelivery: {
              ...defaultNexusFeatureBranchDeliveryConfig,
              enabled: true,
              activeFeatureId: "codex-goals",
              defaultBranchStrategy: "hybrid",
            },
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
    });
    const evidenceFile = path.join(projectRoot, "feature-evidence.json");
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        evidence: [
          {
            provider: "github",
            sourceKind: "pull_request",
            reviewTarget: {
              kind: "pull_request",
              number: 243,
              url: "https://github.com/Evref-BL/DevNexus/pull/243",
            },
            headBranch: "feat/codex-goals",
            targetBranch: "main",
            intendedCiTier: "remote_smoke",
            reviewState: "waiting_for_approval",
            mergeability: "mergeable",
            branchPolicy: "clear",
            baseStatus: "current",
            checks: [
              { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
            ],
          },
        ],
      }),
      "utf8",
    );
    const textOutput = captureOutput();
    const jsonOutput = captureOutput();
    const finalizationTextOutput = captureOutput();
    const finalizationJsonOutput = captureOutput();
    const finalizationCreateTextOutput = captureOutput();

    await main(
      [
        "publication",
        "feature-report",
        projectRoot,
        "--component",
        "primary",
        "--evidence-file",
        evidenceFile,
      ],
      {
        stdout: textOutput.writer,
        now: () => "2026-05-22T10:00:00.000Z",
      },
    );
    await main(
      [
        "publication",
        "feature-report",
        projectRoot,
        "--component",
        "primary",
        "--evidence-file",
        evidenceFile,
        "--json",
      ],
      {
        stdout: jsonOutput.writer,
        now: () => "2026-05-22T10:00:00.000Z",
      },
    );
    await main(
      [
        "publication",
        "feature-finalization",
        projectRoot,
        "--component",
        "primary",
        "--evidence-file",
        evidenceFile,
      ],
      {
        stdout: finalizationTextOutput.writer,
        now: () => "2026-05-22T10:00:00.000Z",
      },
    );
    await main(
      [
        "publication",
        "feature-finalization",
        projectRoot,
        "--component",
        "primary",
        "--evidence-file",
        evidenceFile,
        "--json",
      ],
      {
        stdout: finalizationJsonOutput.writer,
        now: () => "2026-05-22T10:00:00.000Z",
      },
    );
    await main(
      [
        "publication",
        "feature-finalization",
        projectRoot,
        "--component",
        "primary",
      ],
      {
        stdout: finalizationCreateTextOutput.writer,
        now: () => "2026-05-22T10:00:00.000Z",
      },
    );

    expect(textOutput.output()).toContain("DevNexus feature branch delivery report.");
    expect(textOutput.output()).toContain("Next action: request_review");
    expect(textOutput.output()).toContain(
      "primary: active=codex-goals branchStrategy=hybrid -> review_needed",
    );
    expect(textOutput.output()).toContain(
      "checks=success review=waiting_for_approval merge=mergeable base=current policy=clear",
    );
    expect(JSON.parse(jsonOutput.output())).toMatchObject({
      ok: true,
      nextAction: "request_review",
      summary: {
        itemCount: 1,
        reviewNeededCount: 1,
      },
      report: {
        mutatesSource: false,
        items: [
          {
            componentId: "primary",
            status: "review_needed",
            providerEvidence: {
              reviewTarget: {
                number: 243,
              },
              checksStatus: "success",
              reviewState: "waiting_for_approval",
              baseStatus: "current",
            },
          },
        ],
      },
    });
    expect(finalizationTextOutput.output()).toContain(
      "DevNexus feature finalization plan.",
    );
    expect(finalizationTextOutput.output()).toContain(
      "primary: active=codex-goals review=ready_for_review publication=needs_review",
    );
    expect(finalizationCreateTextOutput.output()).toContain(
      "finalPRAction=create_at_review_gate",
    );
    expect(finalizationCreateTextOutput.output()).toContain(
      "dev-nexus publication pull-request upsert",
    );
    expect(finalizationCreateTextOutput.output()).toContain("--head feat/codex-goals");
    expect(JSON.parse(finalizationJsonOutput.output())).toMatchObject({
      ok: true,
      nextAction: "request_review",
      summary: {
        itemCount: 1,
        safeToReviewCount: 1,
        needsReviewCount: 1,
      },
      plan: {
        mutatesSource: false,
        items: [
          {
            componentId: "primary",
            reviewReadiness: {
              status: "ready_for_review",
              safeToReview: true,
            },
            publicationReadiness: {
              status: "needs_review",
              authorizedToMerge: false,
            },
          },
        ],
      },
    });
  });

  it("prints feature branch update decision reasons in text and JSON", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const baseConfig = projectConfig();
    saveProjectConfig(projectRoot, {
      ...baseConfig,
      automation: {
        ...baseConfig.automation!,
        publication: {
          ...baseConfig.automation!.publication,
          strategy: "green_main",
          targetBranch: "main",
          releaseTrain: {
            enabled: true,
            activeVersionId: "v-next",
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            featureBranchDelivery: {
              ...defaultNexusFeatureBranchDeliveryConfig,
              enabled: true,
              activeFeatureId: "codex-goals",
              defaultBranchStrategy: "hybrid",
            },
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
    });
    const evidenceFile = path.join(projectRoot, "feature-evidence.json");
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify({
        evidence: [
          {
            provider: "github",
            sourceKind: "pull_request",
            reviewTarget: {
              kind: "pull_request",
              number: 243,
              url: "https://github.com/Evref-BL/DevNexus/pull/243",
            },
            headBranch: "feat/codex-goals",
            targetBranch: "main",
            intendedCiTier: "remote_smoke",
            reviewState: "approved",
            mergeability: "mergeable",
            branchPolicy: "clear",
            baseStatus: "behind",
            checks: [
              { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
            ],
          },
        ],
      }),
      "utf8",
    );
    const textOutput = captureOutput();
    const jsonOutput = captureOutput();

    await main(
      [
        "publication",
        "feature-report",
        projectRoot,
        "--component",
        "primary",
        "--evidence-file",
        evidenceFile,
      ],
      { stdout: textOutput.writer },
    );
    await main(
      [
        "publication",
        "feature-report",
        projectRoot,
        "--component",
        "primary",
        "--evidence-file",
        evidenceFile,
        "--json",
      ],
      { stdout: jsonOutput.writer },
    );

    expect(textOutput.output()).toContain(
      "branchUpdate=behind recommendation=merge_update forceWithLease=false",
    );
    expect(textOutput.output()).toContain(
      "branchUpdate reasons: review branch base status is behind; CI may be stale until the review branch includes the current base branch",
    );
    expect(textOutput.output()).toContain(
      "branchUpdate command: git checkout feat/codex-goals && git merge --no-ff main && git push origin feat/codex-goals",
    );
    const payload = JSON.parse(jsonOutput.output());
    expect(payload).toMatchObject({
      ok: true,
      nextAction: "update_branch",
      report: {
        items: [
          {
            branchUpdateDecision: {
              status: "behind",
              recommendation: "merge_update",
              pushRemote: "origin",
              publicBranch: true,
            },
          },
        ],
      },
    });
    const decision = payload.report.items[0].branchUpdateDecision;
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "review branch base status is behind",
      "CI may be stale until the review branch includes the current base branch",
      "avoid direct pushes to the protected base branch",
    ]));
    expect(decision.choices.find((choice: { id: string }) =>
      choice.id === "merge_update"
    )).toMatchObject({
      command:
        "git checkout feat/codex-goals && git merge --no-ff main && git push origin feat/codex-goals",
    });
  });

  it("enqueues work items that match the automation selector", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        selector: {
          ...config.automation!.selector,
          statuses: ["ready"],
          labels: ["automation"],
          assignees: ["agent-a"],
          search: "queue",
        },
      },
    });
    const enqueueOutput = captureOutput();
    const statusOutput = captureOutput();

    await main(
      [
        "automation",
        "enqueue",
        projectRoot,
        "--title",
        "Queue runnable task",
        "--description",
        "Created by automation enqueue.",
        "--label",
        "dogfood",
        "--json",
      ],
      {
        stdout: enqueueOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(["automation", "status", projectRoot, "--json"], {
      stdout: statusOutput.writer,
      now: fixedClock("2026-05-16T10:05:00.000Z"),
    });

    expect(JSON.parse(enqueueOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Queue runnable task",
      status: "ready",
      labels: ["automation", "dogfood"],
      assignees: ["agent-a"],
    });
    expect(JSON.parse(statusOutput.output())).toMatchObject({
      ok: true,
      status: "ready",
      selectedWorkItem: {
        id: "local-1",
        title: "Queue runnable task",
      },
    });
  });

  it("refuses to enqueue work items outside the automation selector", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        selector: {
          ...config.automation!.selector,
          statuses: ["ready"],
          excludeLabels: ["blocked"],
        },
      },
    });

    const badStatusOutput = captureOutput();
    await expect(
      main(
        [
          "automation",
          "enqueue",
          projectRoot,
          "--title",
          "Bad task",
          "--status",
          "todo",
          "--json",
        ],
        {
          stdout: badStatusOutput.writer,
        },
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(badStatusOutput.output())).toMatchObject({
      ok: false,
      error: {
        message: "--status must match automation selector statuses: ready",
      },
    });

    const excludedLabelOutput = captureOutput();
    await expect(
      main(
        [
          "automation",
          "enqueue",
          projectRoot,
          "--title",
          "Blocked task",
          "--label",
          "blocked",
          "--json",
        ],
        {
          stdout: excludedLabelOutput.writer,
        },
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(excludedLabelOutput.output())).toMatchObject({
      ok: false,
      error: {
        message: "labels conflict with automation selector exclusions: blocked",
      },
    });
  });

  it("runs automation once through the command executor", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Runnable task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.env.DEV_NEXUS_RUN_ID).toBe("run-cli");
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    await main(
      [
        "automation",
        "run-once",
        projectRoot,
        "--command",
        "node task.js",
        "--run-id",
        "run-cli",
        "--json",
      ],
      {
        stdout: output.writer,
        commandRunner,
        gitRunner: fakeGitRunner(gitCalls),
        now: fixedClock(
          "2026-05-16T10:00:00.000Z",
          "2026-05-16T10:01:00.000Z",
          "2026-05-16T10:02:00.000Z",
          "2026-05-16T10:03:00.000Z",
        ),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      status: "completed",
      runId: "run-cli",
      workItem: {
        id: "local-1",
      },
      execution: {
        commitIds: ["abc123"],
      },
    });
    expect(commandRuns).toEqual(["node task.js", "npm test"]);
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/demo-project/local-1/run-cli",
        path.join(
          projectRoot,
          "worktrees",
          "primary",
          "codex-demo-project-local-1-run-cli",
        ),
        "main",
      ],
      cwd: path.join(projectRoot, "source"),
    });
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("uses the configured automation executor command when omitted", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        executor: {
          command: "node configured-task.js",
          timeoutMs: 1234,
          runFullVerification: true,
        },
        verification: {
          ...config.automation!.verification,
          fullCommands: ["npm run check"],
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Configured task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.timeoutMs).toBe(1234);
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(["automation", "run-once", projectRoot, "--json"], {
      stdout: output.writer,
      commandRunner,
      gitRunner: fakeGitRunner([]),
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
        "2026-05-16T10:02:00.000Z",
        "2026-05-16T10:03:00.000Z",
      ),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "completed",
      workItem: {
        id: "local-1",
      },
    });
    expect(commandRuns).toEqual([
      "node configured-task.js",
      "npm test",
      "npm run check",
    ]);
  });

  it("runs agent launch automation through the command launcher", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        workItemClaims: {
          ...config.automation!.workItemClaims,
          enabled: false,
        },
        agent: {
          command: "codex run",
          timeoutMs: 4321,
          relaunch: {
            whileEligible: false,
          },
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Agent-launch task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.cwd).toBe(projectRoot);
      expect(options.timeoutMs).toBe(4321);
      expect(options.env.DEV_NEXUS_AUTOMATION_MODE).toBe("agent_launch");
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "blocked",
          summary: "Agent recorded a blocker",
          error: "needs user decision",
        })}\n`,
        "utf8",
      );
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(["automation", "run-once", projectRoot, "--json"], {
      stdout: output.writer,
      commandRunner,
      mcpRuntimeProcesses: false,
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "blocked",
      summary: "Agent recorded a blocker",
      eligibleWorkItems: [
        {
          id: "local-1",
        },
      ],
    });
    expect(commandRuns).toEqual(["codex run"]);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "ready",
    });
  });

  it("runs agent launch automation through a coordinator profile command", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        agent: {
          ...config.automation!.agent,
          command: null,
          timeoutMs: 8765,
          coordinatorProfileId: "codex-deep",
          profiles: [
            {
              id: "codex-deep",
              executor: "codex",
              model: "gpt-5.5",
              reasoning: "xhigh",
              command: "codex",
              args: [
                "exec",
                "--model",
                "gpt-5.5",
                "--reasoning-effort",
                "xhigh",
                "Use DEV_NEXUS_AGENT_CONTEXT_FILE.",
              ],
            },
          ],
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Profile-launched task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.timeoutMs).toBe(8765);
      expect(options.env.DEV_NEXUS_COORDINATOR_PROFILE_ID).toBe("codex-deep");
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Coordinator profile launched",
        })}\n`,
        "utf8",
      );
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(["automation", "run-once", projectRoot, "--json"], {
      stdout: output.writer,
      commandRunner,
      mcpRuntimeProcesses: false,
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "completed",
      summary: "Coordinator profile launched",
    });
    expect(commandRuns).toHaveLength(1);
    expect(commandRuns[0]).toMatch(
      /(?:^codex|codex\.exe") exec --model gpt-5\.5 --reasoning-effort xhigh "Use DEV_NEXUS_AGENT_CONTEXT_FILE\."$/u,
    );
  });

  it("adopts and records current-agent automation through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        agent: {
          ...config.automation!.agent,
          maxConcurrentSubagents: 2,
        },
      },
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Current-agent CLI task",
      status: "ready",
      labels: ["automation"],
    });
    const adoptOutput = captureOutput();
    const recordOutput = captureOutput();

    await main(
      [
        "automation",
        "current-agent",
        "adopt",
        projectRoot,
        "--run-id",
        "current-cli-1",
        "--owner",
        "heartbeat",
        "--json",
      ],
      {
        stdout: adoptOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );

    const adoption = JSON.parse(adoptOutput.output());
    expect(adoption).toMatchObject({
      ok: true,
      status: "started",
      shouldProceed: true,
      environment: {
        DEV_NEXUS_CURRENT_AGENT_ADOPTION: "true",
        DEV_NEXUS_RUN_ID: "current-cli-1",
        DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS: "2",
      },
      result: {
        statuses: ["completed", "failed", "blocked", "skipped"],
      },
    });

    await main(
      [
        "automation",
        "current-agent",
        "record",
        projectRoot,
        "--run-id",
        "current-cli-1",
        "--status",
        "skipped",
        "--summary",
        "Current coordinator skipped after review",
        "--verification-command",
        "npm test",
        "--verification-status",
        "not_run",
        "--verification-summary",
        "not needed",
        "--json",
      ],
      {
        stdout: recordOutput.writer,
        now: fixedClock("2026-05-16T10:05:00.000Z"),
      },
    );

    expect(JSON.parse(recordOutput.output())).toMatchObject({
      ok: true,
      status: "skipped",
      summary: "Current coordinator skipped after review",
      resultFile: adoption.resultFile,
    });
    expect(
      readNexusAutomationRunLedger(
        projectRoot,
        loadProjectConfig(projectRoot).automation!,
      ).runs.at(-1),
    ).toMatchObject({
      id: "current-cli-1",
      status: "skipped",
      verification: [
        {
          command: "npm test",
          status: "not_run",
        },
      ],
    });
  });

  it("schedules bounded automation through the command executor", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        executor: {
          ...config.automation!.executor,
          command: "node scheduled-task.js",
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Scheduled CLI task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.env.DEV_NEXUS_WORK_ITEM_ID).toBe("local-1");
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    await main(
      [
        "automation",
        "schedule",
        projectRoot,
        "--max-runs",
        "1",
        "--json",
      ],
      {
        stdout: output.writer,
        commandRunner,
        gitRunner: fakeGitRunner(gitCalls),
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      stoppedReason: "max_runs",
      ticks: [
        {
          action: "ran",
          status: {
            status: "ready",
          },
          run: {
            status: "completed",
            workItem: {
              id: "local-1",
            },
          },
        },
      ],
      runs: [
        {
          status: "completed",
          workItem: {
            id: "local-1",
          },
        },
      ],
    });
    expect(commandRuns).toEqual(["node scheduled-task.js", "npm test"]);
    expect(
      gitCalls.find(
        (call) => call.args[0] === "worktree" && call.args[1] === "add",
      ),
    ).toMatchObject({
      args: [
        "worktree",
          "add",
          "-b",
          "codex/demo-project/local-1/scheduled-20260516-t100000-000-z-1",
          path.join(
            projectRoot,
            "worktrees",
            "primary",
            "codex-demo-project-local-1-scheduled-20260516-t100000-000-z-1",
          ),
        "main",
      ],
      cwd: path.join(projectRoot, "source"),
    });
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("runs a managed coordinator loop through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        agent: {
          ...config.automation!.agent,
          command: "codex run",
          timeoutMs: 2468,
          relaunch: {
            whileEligible: true,
          },
        },
        target: {
          ...config.automation!.target,
          id: "dogfood",
          objective: "Launch coordinators while work remains eligible.",
        },
      },
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinator-loop task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.cwd).toBe(projectRoot);
      expect(options.timeoutMs).toBe(2468);
      expect(options.env.DEV_NEXUS_AUTOMATION_MODE).toBe("agent_launch");
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Coordinator loop completed",
          commitIds: ["abc123"],
        })}\n`,
        "utf8",
      );

      return {
        command,
        cwd: options.cwd,
        stdout: "coordinator done",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(
      [
        "automation",
        "coordinator-loop",
        projectRoot,
        "--max-runs",
        "1",
        "--run-id-prefix",
        "cli-loop",
        "--json",
      ],
      {
        stdout: output.writer,
        commandRunner,
        mcpRuntimeProcesses: false,
        now: fixedClock("2026-05-17T10:00:00.000Z"),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      stoppedReason: "max_runs",
      ticks: [
        {
          action: "launched",
          decision: {
            type: "launch",
          },
          run: {
            status: "completed",
            summary: "Coordinator loop completed",
          },
          targetCycle: {
            id: "target-cycle-cli-loop-20260517-t100000-000-z-1",
            runId: "cli-loop-20260517-t100000-000-z-1",
            status: "completed",
            eligibleWorkItemCount: 0,
            workItems: [
              {
                id: "local-1",
                status: "done",
                cycleStatus: "completed",
              },
            ],
          },
        },
      ],
    });
    expect(commandRuns).toEqual(["codex run"]);
    expect(
      readNexusAutomationTargetCycleLedger(
        projectRoot,
        projectConfig().automation!,
      ).cycles.at(-1),
    ).toMatchObject({
      id: "target-cycle-cli-loop-20260517-t100000-000-z-1",
      status: "completed",
      runId: "cli-loop-20260517-t100000-000-z-1",
    });
  });

  it("streams coordinator loop progress JSON Lines without changing final JSON output", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        agent: {
          ...config.automation!.agent,
          command: "codex run",
          timeoutMs: 2468,
          relaunch: {
            whileEligible: true,
          },
        },
      },
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinator-loop task",
      status: "ready",
      labels: ["automation"],
    });
    const stdout = captureOutput();
    const stderr = captureOutput();
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "completed",
          summary: "Coordinator loop completed",
          commitIds: ["abc123"],
        })}\n`,
        "utf8",
      );

      return {
        command,
        cwd: options.cwd,
        stdout: "coordinator done",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(
      [
        "automation",
        "coordinator-loop",
        projectRoot,
        "--max-runs",
        "1",
        "--run-id-prefix",
        "cli-loop",
        "--json",
        "--progress-jsonl",
      ],
      {
        stdout: stdout.writer,
        stderr: stderr.writer,
        commandRunner,
        mcpRuntimeProcesses: false,
        now: fixedClock("2026-05-17T10:00:00.000Z"),
      },
    );

    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      stoppedReason: "max_runs",
      runs: [
        {
          status: "completed",
          summary: "Coordinator loop completed",
        },
      ],
    });
    const events = stderr
      .output()
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "loop_started",
        "decision",
        "launch_dispatched",
        "run_started",
        "run_finished",
        "loop_stopped",
      ]),
    );
    expect(events.find((event) => event.type === "run_finished")).toMatchObject({
      status: "completed",
      summary: "Coordinator loop completed",
    });
  });

  it("claims the next eligible GitHub work item through the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-claim-");
    saveProjectConfig(projectRoot, githubWorkItemProjectConfig());
    const provider = new ClaimMemoryProvider([
      githubWorkItem("github-7", "Claim through CLI", {
        labels: ["automation", "dogfood"],
      }),
    ]);
    const stdout = captureOutput();

    const exitCode = await main(
      [
        "work-item",
        "claim-next",
        projectRoot,
        "--component",
        "core",
        "--tracker",
        "github",
        "--host",
        "host-a",
        "--agent",
        "agent-a",
        "--lease-ms",
        "600000",
        "--json",
      ],
      {
        stdout: stdout.writer,
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: claimProviderFactory(provider),
        workItemClaimLeaseTokenFactory: () => "cli-token-1",
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      claim: {
        status: "claimed",
        workItem: {
          id: "github-7",
          status: "in_progress",
        },
        owner: {
          hostId: "host-a",
          agentId: "agent-a",
          leaseToken: "cli-token-1",
          expiresAt: "2026-05-20T10:10:00.000Z",
        },
      },
    });
  });

  it("reports no eligible work through claim-next without failing the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-claim-");
    saveProjectConfig(projectRoot, githubWorkItemProjectConfig());
    const provider = new ClaimMemoryProvider([
      githubWorkItem("github-8", "Not selected", {
        labels: ["other"],
      }),
    ]);
    const stdout = captureOutput();

    const exitCode = await main(
      [
        "work-item",
        "claim-next",
        projectRoot,
        "--host",
        "host-a",
        "--json",
      ],
      {
        stdout: stdout.writer,
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: claimProviderFactory(provider),
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toEqual({
      ok: true,
      claim: {
        status: "no_claim",
        reason: "no_eligible_candidate",
        skippedCandidates: [],
      },
    });
    expect(provider.updates).toEqual([]);
  });

  it("reports stale in-progress claims through claim-next text output", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-claim-");
    saveProjectConfig(projectRoot, githubWorkItemProjectConfig());
    const provider = new ClaimMemoryProvider([
      githubWorkItem("github-10", "Expired CLI claim", {
        status: "in_progress",
        labels: ["automation"],
        description: claimBlock("expired-token", {
          expiresAt: "2026-05-20T09:30:00.000Z",
        }),
      }),
    ]);
    const stdout = captureOutput();

    const exitCode = await main(
      [
        "work-item",
        "claim-next",
        projectRoot,
        "--host",
        "host-a",
      ],
      {
        stdout: stdout.writer,
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: claimProviderFactory(provider),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.output()).toContain("Reason: stale_claims");
    expect(stdout.output()).toContain("Stale claims: 1");
    expect(stdout.output()).toContain("expired-token");
    expect(stdout.output()).toContain("2026-05-20T09:30:00.000Z");
    expect(provider.updates).toEqual([]);
  });

  it("reclaims stale in-progress claims through claim-next when enabled", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-claim-");
    saveProjectConfig(projectRoot, githubWorkItemProjectConfig());
    const provider = new ClaimMemoryProvider([
      githubWorkItem("github-11", "Reclaim through CLI", {
        status: "in_progress",
        labels: ["automation"],
        description: claimBlock("expired-token", {
          expiresAt: "2026-05-20T09:30:00.000Z",
        }),
      }),
    ]);
    const stdout = captureOutput();

    const exitCode = await main(
      [
        "work-item",
        "claim-next",
        projectRoot,
        "--host",
        "host-a",
        "--agent",
        "agent-a",
        "--reclaim-stale",
        "--json",
      ],
      {
        stdout: stdout.writer,
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: claimProviderFactory(provider),
        workItemClaimLeaseTokenFactory: () => "cli-token-2",
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      claim: {
        status: "claimed",
        workItem: {
          id: "github-11",
          status: "in_progress",
        },
        owner: {
          hostId: "host-a",
          agentId: "agent-a",
          leaseToken: "cli-token-2",
        },
        reclaimedFrom: {
          owner: {
            leaseToken: "expired-token",
            expiresAt: "2026-05-20T09:30:00.000Z",
          },
        },
      },
    });
    expect(provider.items[0]?.description).toContain("cli-token-2");
    expect(provider.items[0]?.description).not.toContain("expired-token");
  });

  it("reports lost races through claim-next without crashing the CLI", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-claim-");
    saveProjectConfig(projectRoot, githubWorkItemProjectConfig());
    const provider = new ClaimMemoryProvider([
      githubWorkItem("github-12", "Race through CLI", {
        labels: ["automation"],
      }),
    ]);
    provider.afterUpdate = (item) => {
      item.description = claimBlock("other-token");
    };
    const stdout = captureOutput();

    const exitCode = await main(
      [
        "work-item",
        "claim-next",
        projectRoot,
        "--host",
        "host-a",
        "--agent",
        "agent-a",
        "--json",
      ],
      {
        stdout: stdout.writer,
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: claimProviderFactory(provider),
        workItemClaimLeaseTokenFactory: () => "cli-token-1",
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      claim: {
        status: "lost_race",
        reason: "verification_failed",
        owner: {
          leaseToken: "cli-token-1",
        },
      },
    });
  });
});

function githubWorkItemProjectConfig(): NexusProjectConfig {
  return projectConfig({
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: null,
        defaultBranch: "main",
        sourceRoot: "source",
        defaultWorkTrackerId: "github",
        workTrackers: [
          {
            id: "github",
            name: "GitHub",
            enabled: true,
            roles: ["primary", "eligible_source"],
            workTracking: {
              provider: "github",
              repository: {
                owner: "example",
                name: "demo",
              },
            },
          },
        ],
        relationships: [],
      },
    ],
  });
}

function githubWorkItem(
  id: string,
  title: string,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  const itemNumber = Number(id.replace(/^github-/, ""));
  return {
    id,
    title,
    description: overrides.description ?? null,
    status: overrides.status ?? "ready",
    provider: "github",
    labels: overrides.labels ?? [],
    assignees: overrides.assignees ?? [],
    milestone: null,
    createdAt: "2026-05-20T09:00:00.000Z",
    updatedAt: "2026-05-20T09:00:00.000Z",
    closedAt: null,
    webUrl: `https://github.com/example/demo/issues/${itemNumber}`,
    externalRef: {
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: String(itemNumber),
      itemNumber,
    },
    ...overrides,
  };
}

function claimProviderFactory(
  provider: ClaimMemoryProvider,
): NexusEligibleWorkClaimProviderFactory {
  return () => provider;
}

class ClaimMemoryProvider implements WorkTrackerProvider {
  readonly provider = "github";
  readonly capabilities = {
    createItem: true,
    listItems: true,
    getItem: true,
    updateItem: true,
    comment: true,
    labels: true,
    assignees: true,
    milestones: true,
    board: false,
    boardStatus: false,
    draftItems: false,
    webhooks: false,
  };
  readonly updates: Array<{ ref: WorkItemRef; patch: WorkItemPatch }> = [];
  readonly comments: Array<{ ref: WorkItemRef; body: string }> = [];
  afterUpdate?: (item: WorkItem) => void;

  constructor(readonly items: WorkItem[]) {}

  async createWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    return this.items.filter((item) => claimMatchesQuery(item, query)).map(cloneClaimItem);
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    return cloneClaimItem(this.findItem(ref));
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    this.updates.push({ ref, patch });
    const item = this.findItem(ref);
    if (patch.status !== undefined) {
      item.status = patch.status;
    }
    if (patch.description !== undefined) {
      item.description = patch.description;
    }
    this.afterUpdate?.(item);
    return cloneClaimItem(item);
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    this.comments.push({ ref, body });
    return {
      id: `comment-${this.comments.length}`,
      body,
    };
  }

  private findItem(ref: WorkItemRef): WorkItem {
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) =>
        candidate.id === id ||
        candidate.externalRef?.itemId === id ||
        candidate.externalRef?.itemNumber === Number(id),
    );
    if (!item) {
      throw new Error(`missing item ${id}`);
    }

    return item;
  }
}

function claimMatchesQuery(item: WorkItem, query: WorkItemQuery): boolean {
  const statuses = Array.isArray(query.status)
    ? query.status
    : query.status
      ? [query.status]
      : [];
  if (statuses.length > 0 && !statuses.includes(item.status)) {
    return false;
  }
  if (query.labels?.some((label) => !item.labels?.includes(label))) {
    return false;
  }
  return true;
}

function cloneClaimItem(item: WorkItem): WorkItem {
  return {
    ...item,
    labels: item.labels ? [...item.labels] : undefined,
    assignees: item.assignees ? [...item.assignees] : undefined,
    externalRef: item.externalRef ? { ...item.externalRef } : undefined,
  };
}

function claimBlock(
  leaseToken: string,
  overrides: {
    claimedAt?: string;
    expiresAt?: string;
  } = {},
): string {
  return [
    "<!-- dev-nexus-work-item-claim",
    JSON.stringify({
      version: 1,
      hostId: "other-host",
      agentId: "other-agent",
      ownerId: null,
      leaseToken,
      claimedAt: overrides.claimedAt ?? "2026-05-20T10:00:01.000Z",
      expiresAt: overrides.expiresAt ?? "2026-05-20T10:30:01.000Z",
    }),
    "-->",
  ].join("\n");
}
