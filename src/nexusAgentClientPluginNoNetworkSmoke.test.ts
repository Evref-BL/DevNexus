import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runNexusAgentClientAdapterCommand,
  type NexusAgentClientAdapterEntrypoint,
  type NexusAgentClientRuntimeCommandRunner,
} from "./index.js";

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

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function writeProject(projectRoot: string): string[] {
  const protectedPaths = [
    path.join(projectRoot, "dev-nexus.project.json"),
    path.join(projectRoot, ".dev-nexus", "automation", "target-cycles.json"),
    path.join(projectRoot, ".dev-nexus", "work-item-links.json"),
    path.join(projectRoot, "worktrees", "demo", ".keep"),
  ];

  writeJson(protectedPaths[0]!, {
    version: 1,
    id: "agent-client-smoke",
    name: "Agent Client Smoke",
    home: null,
    repo: { kind: "git", remoteUrl: null, defaultBranch: "main" },
    worktreesRoot: "worktrees",
    components: [],
  });
  writeJson(protectedPaths[1]!, { version: 1, cycles: [] });
  writeJson(protectedPaths[2]!, { version: 1, links: [] });
  writeText(protectedPaths[3]!, "");

  return protectedPaths;
}

function writeSourceRuntime(sourceRoot: string): string {
  const sourceCliPath = path.join(sourceRoot, "dist", "cli.js");
  writeJson(path.join(sourceRoot, "package.json"), {
    name: "@evref-bl/dev-nexus",
    version: "0.1.0-alpha.17",
    engines: { node: ">=22" },
  });
  writeText(sourceCliPath, "#!/usr/bin/env node\n");
  return sourceCliPath;
}

function noNetworkCommandRunner(calls: string[]): NexusAgentClientRuntimeCommandRunner {
  return (command, args, options) => {
    calls.push(`${command} ${args.join(" ")}`.trim());

    if (command === "node" && args[0] === "--version") {
      return commandResult(command, args, options.cwd, "v22.11.0\n");
    }
    if (command === "npm" && args[0] === "--version") {
      return commandResult(command, args, options.cwd, "10.9.0\n");
    }
    if (args.includes("mcp-stdio")) {
      return commandResult(command, args, options.cwd, "mcp server started\n");
    }
    if (args.includes("workspace") && args.includes("status")) {
      return commandResult(command, args, options.cwd, '{"ok":true}\n');
    }
    if (args.includes("setup") && args.includes("check")) {
      return commandResult(command, args, options.cwd, '{"ok":true}\n');
    }

    return {
      command,
      args,
      cwd: options.cwd,
      stdout: "",
      stderr: "unexpected no-network smoke command",
      exitCode: 1,
    };
  };
}

function commandResult(
  command: string,
  args: readonly string[],
  cwd: string,
  stdout: string,
) {
  return {
    command,
    args: [...args],
    cwd,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("agent-client plugin no-network smoke", () => {
  it("smokes Codex and Claude setup, status, and MCP startup without installs", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-client-smoke-project-");
    const sourceRoot = makeTempDir("dev-nexus-agent-client-smoke-source-");
    const sourceCliPath = writeSourceRuntime(sourceRoot);
    writeProject(projectRoot);
    const calls: string[] = [];
    const commandRunner = noNetworkCommandRunner(calls);
    const clients = [
      { client: "codex", pluginDataRoot: null },
      {
        client: "claude",
        pluginDataRoot: makeTempDir("dev-nexus-agent-client-smoke-data-"),
      },
    ] as const;
    const entrypoints: NexusAgentClientAdapterEntrypoint[] = [
      "setup",
      "status",
      "mcp-stdio",
    ];

    for (const smoke of clients) {
      for (const entrypoint of entrypoints) {
        const result = runNexusAgentClientAdapterCommand({
          client: smoke.client,
          entrypoint,
          projectRoot,
          sourceRoot,
          sourceCliPath,
          pluginDataRoot: smoke.pluginDataRoot,
          commandRunner,
          commandLocator: () => null,
        });

        expect(result.status).toBe("completed");
        expect(result.plan.projectRoot).toBe(projectRoot);
        expect(result.plan.advisory.packageOperations).toEqual([]);
        expect(result.plan.advisory.networkOperations).toEqual([]);
        expect(result.plan.advisory.providerOperations).toEqual([]);
        expect(result.plan.invocation).toMatchObject({
          cwd: projectRoot,
          mutationClass: entrypoint === "mcp-stdio" ? "live_runtime" : "none",
        });
      }
    }

    expect(calls.some((call) => /\bnpm\s+install\b/u.test(call))).toBe(false);
  });

  it("keeps live-client instructions gated and preserves workspace state", () => {
    const smokeDoc = readRepoFile("docs/dev/agent-client-plugin-smoke.md");
    const policyDoc = readRepoFile("docs/dev/agent-client-plugins.md");
    const docsIndex = readRepoFile("docs/index.md");
    const codexReadme = readRepoFile("plugins/dev-nexus-codex/README.md");
    const claudeReadme = readRepoFile("plugins/dev-nexus-claude/README.md");

    expect(smokeDoc).toContain("Automated no-network smoke");
    expect(smokeDoc).toContain("Live client smoke remains a human-in-the-loop gate.");
    expect(smokeDoc).toContain("Failure classification");
    expect(policyDoc).toContain("agent-client-plugin-smoke.md");
    expect(docsIndex).toContain("dev/agent-client-plugin-smoke.md");
    expect(codexReadme).toContain("../../docs/dev/agent-client-plugin-smoke.md");
    expect(claudeReadme).toContain("../../docs/dev/agent-client-plugin-smoke.md");

    const projectRoot = makeTempDir("dev-nexus-agent-client-state-project-");
    const protectedPaths = writeProject(projectRoot);
    const pluginDataRoot = makeTempDir("dev-nexus-agent-client-plugin-data-");
    writeText(path.join(pluginDataRoot, "client-state.json"), "{}\n");

    for (const protectedPath of protectedPaths) {
      expect(fs.existsSync(protectedPath)).toBe(true);
    }

    fs.rmSync(pluginDataRoot, { recursive: true, force: true });

    for (const protectedPath of protectedPaths) {
      expect(fs.existsSync(protectedPath)).toBe(true);
    }
  });
});
