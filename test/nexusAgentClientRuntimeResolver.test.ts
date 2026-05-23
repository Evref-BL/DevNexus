import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatNexusAgentClientRuntimeCommand,
  resolveNexusAgentClientRuntime,
  type NexusAgentClientRuntimeCommandRunner,
} from "../src/index.js";

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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("agent-client runtime resolver", () => {
  it("prefers source-current in dogfood workspaces and reports stale PATH skew", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-runtime-project-");
    const sourceRoot = makeTempDir("dev-nexus-agent-runtime-source-");
    const sourceCliPath = path.join(sourceRoot, "dist", "cli.js");
    writeJson(path.join(sourceRoot, "package.json"), {
      name: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.17",
      engines: { node: ">=22" },
    });
    fs.mkdirSync(path.dirname(sourceCliPath), { recursive: true });
    fs.writeFileSync(sourceCliPath, "#!/usr/bin/env node\n", "utf8");
    const commands: string[] = [];
    const commandRunner: NexusAgentClientRuntimeCommandRunner = (
      command,
      args,
      options,
    ) => {
      commands.push(`${command} ${args.join(" ")}`.trim());
      if (command === "node") {
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
        stdout: "Usage:\n  dev-nexus workspace status <workspace-id-or-root>\n",
        stderr: "",
        exitCode: 0,
      };
    };

    const resolution = resolveNexusAgentClientRuntime({
      projectRoot,
      sourceRoot,
      sourceCliPath,
      expectedCommands: [
        "dev-nexus workspace status <workspace-id-or-root>",
        "dev-nexus workspace plugin refresh <workspace-root>",
      ],
      commandRunner,
      commandLocator: (command) =>
        command === "dev-nexus" ? "/usr/local/bin/dev-nexus" : null,
    });

    expect(resolution.selected).toMatchObject({
      mode: "source_current",
      status: "available",
      command: "node",
      args: [sourceCliPath],
      packageVersion: "0.1.0-alpha.17",
    });
    expect(resolution.node).toMatchObject({
      available: true,
      version: "v22.11.0",
      satisfiesRequirement: true,
    });
    expect(resolution.npm).toMatchObject({
      available: true,
      version: "10.9.0",
    });
    expect(
      resolution.candidates.find((candidate) => candidate.mode === "path"),
    ).toMatchObject({
      mode: "path",
      status: "warning",
      skew: {
        status: "skew_detected",
        missingDocumentedCommands: ["dev-nexus workspace plugin refresh"],
      },
    });
    expect(resolution.setupPlan.actions).toEqual([]);
    expect(commands).toEqual([
      "node --version",
      "npm --version",
      "/usr/local/bin/dev-nexus --help",
    ]);
  });

  it("formats project-local Windows command lines without shell parsing", () => {
    const projectRoot = "C:\\Users\\Ada\\Dev Nexus";
    const runtimeRoot =
      "C:\\Users\\Ada\\Dev Nexus\\.dev-nexus\\runtime\\npm-tools";
    const runtimeBin = path.win32.join(
      runtimeRoot,
      "node_modules",
      ".bin",
      "dev-nexus.cmd",
    );

    const resolution = resolveNexusAgentClientRuntime({
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

    expect(resolution.selected).toMatchObject({
      mode: "project_local",
      status: "available",
      command: runtimeBin,
      args: [],
    });
    expect(
      formatNexusAgentClientRuntimeCommand({
        command: resolution.selected!.command,
        args: [...resolution.selected!.args, "mcp-stdio"],
        platform: "windows",
      }),
    ).toBe([
      '"C:\\Users\\Ada\\Dev Nexus\\.dev-nexus\\runtime\\npm-tools\\',
      'node_modules\\.bin\\dev-nexus.cmd" "mcp-stdio"',
    ].join(""));
  });

  it("returns advisory setup actions when no runtime is available", () => {
    const projectRoot = makeTempDir("dev-nexus-agent-runtime-missing-");

    const resolution = resolveNexusAgentClientRuntime({
      projectRoot,
      commandRunner: (command, args, options) => ({
        command,
        args,
        cwd: options.cwd,
        stdout: "",
        stderr: `${command} not found`,
        exitCode: 127,
      }),
      commandLocator: () => null,
    });

    expect(resolution.selected).toBeNull();
    expect(resolution.status).toBe("blocked");
    expect(resolution.node).toMatchObject({ available: false });
    expect(resolution.npm).toMatchObject({ available: false });
    expect(resolution.setupPlan.actions).toEqual([
      expect.objectContaining({
        kind: "install_node",
        mutationClass: "host_local",
        requiresApproval: true,
      }),
      expect.objectContaining({
        kind: "install_dev_nexus",
        mutationClass: "host_local",
        requiresApproval: true,
      }),
    ]);
  });
});
