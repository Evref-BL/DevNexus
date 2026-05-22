import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverNexusAgentClientProjectRoot,
  planNexusAgentClientAdapterCommand,
  runNexusAgentClientAdapterCommand,
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

function writeProject(projectRoot: string): void {
  writeJson(path.join(projectRoot, "dev-nexus.project.json"), {
    version: 1,
    id: "adapter-demo",
    name: "Adapter Demo",
    home: null,
    repo: { kind: "git", remoteUrl: null, defaultBranch: "main" },
    worktreesRoot: "worktrees",
    components: [],
  });
}

function writeSourceRuntime(sourceRoot: string): string {
  const sourceCliPath = path.join(sourceRoot, "dist", "cli.js");
  writeJson(path.join(sourceRoot, "package.json"), {
    name: "@evref-bl/dev-nexus",
    version: "0.1.0-alpha.17",
    engines: { node: ">=22" },
  });
  fs.mkdirSync(path.dirname(sourceCliPath), { recursive: true });
  fs.writeFileSync(sourceCliPath, "#!/usr/bin/env node\n", "utf8");
  return sourceCliPath;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("agent-client adapter wrapper", () => {
  it("runs mcp-stdio through the selected source-current runtime", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-wrapper-project-");
    const sourceRoot = makeTempDir("dev-nexus-agent-wrapper-source-");
    const sourceCliPath = writeSourceRuntime(sourceRoot);
    writeProject(projectRoot);
    const calls: string[] = [];
    const commandRunner: NexusAgentClientRuntimeCommandRunner = (
      command,
      args,
      options,
    ) => {
      calls.push(`${command} ${args.join(" ")} @ ${options.cwd}`.trim());
      if (command === "node" && args[0] === "--version") {
        return {
          command,
          args,
          cwd: options.cwd,
          stdout: "v22.11.0\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (command === "npm") {
        return {
          command,
          args,
          cwd: options.cwd,
          stdout: "10.9.0\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        command,
        args,
        cwd: options.cwd,
        stdout: "mcp server started\n",
        stderr: "",
        exitCode: 0,
      };
    };

    const result = runNexusAgentClientAdapterCommand({
      client: "codex",
      entrypoint: "mcp-stdio",
      projectRoot,
      sourceRoot,
      sourceCliPath,
      commandRunner,
      commandLocator: () => null,
    });

    expect(result.status).toBe("completed");
    expect(result.plan.invocation).toMatchObject({
      command: "node",
      args: [sourceCliPath, "mcp-stdio"],
      cwd: projectRoot,
      mutationClass: "live_runtime",
    });
    expect(result.run).toMatchObject({
      command: "node",
      args: [sourceCliPath, "mcp-stdio"],
      stdout: "mcp server started\n",
    });
    expect(calls).toEqual([
      `node --version @ ${projectRoot}`,
      `npm --version @ ${projectRoot}`,
      `node ${sourceCliPath} mcp-stdio @ ${projectRoot}`,
    ]);
  });

  it("returns advisory setup operations without installing a missing runtime", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-wrapper-missing-");
    writeProject(projectRoot);
    const calls: string[] = [];

    const plan = planNexusAgentClientAdapterCommand({
      client: "claude",
      entrypoint: "setup",
      projectRoot,
      commandRunner: (command, args, options) => {
        calls.push(`${command} ${args.join(" ")} @ ${options.cwd}`.trim());
        return {
          command,
          args,
          cwd: options.cwd,
          stdout: "",
          stderr: `${command} not found`,
          exitCode: 127,
        };
      },
      commandLocator: () => null,
    });

    expect(plan.status).toBe("blocked");
    expect(plan.invocation).toBeNull();
    expect(plan.advisory.packageOperations).toEqual([
      expect.objectContaining({
        command: "npm install -g @evref-bl/dev-nexus",
        requiresApproval: true,
      }),
    ]);
    expect(plan.advisory.fileMutations).toEqual([]);
    expect(plan.advisory.providerOperations).toEqual([]);
    expect(plan.advisory.networkOperations).toEqual([
      expect.objectContaining({ summary: expect.stringContaining("npm registry") }),
    ]);
    expect(calls).toEqual([
      `node --version @ ${projectRoot}`,
      `npm --version @ ${projectRoot}`,
    ]);
  });

  it("routes doctor to setup check so adapter readiness appears in output", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-wrapper-doctor-");
    const sourceRoot = makeTempDir("dev-nexus-agent-wrapper-doctor-source-");
    const sourceCliPath = writeSourceRuntime(sourceRoot);
    writeProject(projectRoot);

    const plan = planNexusAgentClientAdapterCommand({
      client: "claude",
      entrypoint: "doctor",
      projectRoot,
      sourceRoot,
      sourceCliPath,
      commandRunner: (command, args, options) => ({
        command,
        args,
        cwd: options.cwd,
        stdout: command === "node" ? "v22.11.0\n" : "10.9.0\n",
        stderr: "",
        exitCode: 0,
      }),
      commandLocator: () => null,
    });

    expect(plan.invocation).toMatchObject({
      command: "node",
      args: [
        sourceCliPath,
        "setup",
        "check",
        projectRoot,
        "join-existing-project",
        "--json",
      ],
      mutationClass: "none",
    });
  });

  it("discovers the project root from MCP roots before the process cwd", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-wrapper-root-");
    const childRoot = path.join(projectRoot, "packages", "demo");
    fs.mkdirSync(childRoot, { recursive: true });
    writeProject(projectRoot);

    const discovery = discoverNexusAgentClientProjectRoot({
      startDirectory: makeTempDir("dev-nexus-agent-wrapper-other-"),
      mcpRoots: [childRoot],
    });

    expect(discovery).toMatchObject({
      projectRoot,
      source: "mcp_roots",
      projectConfigFound: true,
    });
  });

  it("plans Windows status invocations without relying on shell parsing", () => {
    const projectRoot = "C:\\Users\\Ada\\Dev Nexus";
    const runtimeRoot =
      "C:\\Users\\Ada\\Dev Nexus\\.dev-nexus\\runtime\\npm-tools";
    const runtimeBin = path.win32.join(
      runtimeRoot,
      "node_modules",
      ".bin",
      "dev-nexus.cmd",
    );

    const plan = planNexusAgentClientAdapterCommand({
      client: "codex",
      entrypoint: "status",
      projectRoot,
      platform: "windows",
      projectLocalRuntimeRoot: runtimeRoot,
      commandRunner: (command, args, options) => ({
        command,
        args,
        cwd: options.cwd,
        stdout: command === "node" ? "v22.11.0\n" : "10.9.0\n",
        stderr: "",
        exitCode: 0,
      }),
      fileExists: (filePath) => filePath === runtimeBin,
      commandLocator: () => null,
    });

    expect(plan.invocation).toMatchObject({
      command: runtimeBin,
      args: ["workspace", "status", projectRoot, "--json"],
      cwd: projectRoot,
      mutationClass: "none",
    });
    expect(plan.invocation?.commandLine).toBe([
      '"C:\\Users\\Ada\\Dev Nexus\\.dev-nexus\\runtime\\npm-tools\\',
      'node_modules\\.bin\\dev-nexus.cmd" "workspace" "status" ',
      '"C:\\Users\\Ada\\Dev Nexus" "--json"',
    ].join(""));
  });
});
