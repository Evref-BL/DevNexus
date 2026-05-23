import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { callDevNexusMcpTool } from "../src/nexusMcpServer.js";
import {
  checkNexusHostCapabilities,
  type NexusHostCheckMockFacts,
} from "../src/nexusHostCheck.js";
import type { NexusAutomationCommandRunner } from "../src/nexusAutomationCommandExecutor.js";

class CapturingWriter {
  private outputText = "";

  write(chunk: string): boolean {
    this.outputText += chunk;
    return true;
  }

  output(): string {
    return this.outputText;
  }
}

function makeTempProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-host-check-"));
  fs.writeFileSync(
    path.join(projectRoot, "dev-nexus.project.json"),
    `${JSON.stringify(
      {
        version: 1,
        id: "host-check-demo",
        name: "Host Check Demo",
        repo: {
          kind: "git",
          remoteUrl: "git@example.invalid:dev/host-check-demo.git",
          defaultBranch: "main",
        },
        worktreesRoot: "worktrees",
        mcp: {
          serverName: "dev_nexus",
        },
        plugins: [
          {
            id: "dev-nexus-pharo",
            enabled: true,
            capabilities: [
              {
                kind: "mcp_server",
                id: "pharo-launcher",
                serverName: "pharo_launcher",
              },
            ],
          },
        ],
        hosts: [
          {
            id: "windows-devbox",
            displayName: "Windows Devbox",
            platformTags: ["windows"],
            capabilityTags: ["windows", "node", "git", "mcp"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return projectRoot;
}

function commandRunner(results: Record<string, { exitCode: number | null; stdout?: string; stderr?: string }>): NexusAutomationCommandRunner {
  return (command, options) => {
    const result = results[command] ?? { exitCode: 1, stderr: "missing command" };
    return {
      command,
      cwd: options.cwd,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode,
    };
  };
}

function successfulToolRunner(): NexusAutomationCommandRunner {
  return commandRunner({
    "git --version": {
      exitCode: 0,
      stdout: "git version 2.51.0\n",
    },
    "node --version": {
      exitCode: 0,
      stdout: "v24.11.1\n",
    },
  });
}

function parsedOutput(writer: CapturingWriter): any {
  return JSON.parse(writer.output());
}

function mcpPayload(result: Awaited<ReturnType<typeof callDevNexusMcpTool>>): any {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]!.text);
}

describe("Nexus host capability checks", () => {
  it("returns a small read-only local host capability result", () => {
    const projectRoot = makeTempProject();

    const result = checkNexusHostCapabilities({
      projectRoot,
      hostId: "windows-devbox",
      commandRunner: successfulToolRunner(),
      now: () => "2026-05-20T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "dev-nexus.host-check.result",
      version: 1,
      status: "passed",
      target: {
        mode: "local",
        hostId: "windows-devbox",
        displayName: "Windows Devbox",
      },
      mutationClass: "none",
      verificationOutcome: "passed",
      cleanupStatus: "not_required",
      configuredCapabilities: ["windows", "node", "git", "mcp"],
      mcp: {
        status: "present",
        serverNames: ["dev_nexus", "pharo_launcher"],
      },
    });
    expect(result.commandChecks.map((check) => [check.id, check.status])).toEqual([
      ["dev-nexus-cli", "present"],
      ["git", "present"],
      ["node", "present"],
    ]);
    expect(JSON.stringify(result)).not.toContain(projectRoot);
  });

  it("reports missing tools as blocked facts with a recommended next action", () => {
    const projectRoot = makeTempProject();

    const result = checkNexusHostCapabilities({
      projectRoot,
      hostId: "windows-devbox",
      commandRunner: commandRunner({
        "git --version": {
          exitCode: 1,
          stderr: "git is not recognized",
        },
        "node --version": {
          exitCode: 0,
          stdout: "v24.11.1\n",
        },
      }),
    });

    expect(result.status).toBe("blocked");
    expect(result.verificationOutcome).toBe("blocked");
    expect(result.commandChecks.find((check) => check.id === "git")).toMatchObject({
      status: "missing",
      nextAction: "Install git or add it to the host-local runner path.",
    });
    expect(result.nextActions).toContain(
      "Install git or add it to the host-local runner path.",
    );
  });

  it("keeps unavailable mocked remote hosts structured", () => {
    const projectRoot = makeTempProject();
    const mockFacts: NexusHostCheckMockFacts = {
      available: false,
      unavailableReason: "mock transport refused connection",
    };

    const result = checkNexusHostCapabilities({
      projectRoot,
      hostId: "windows-devbox",
      mode: "mock-remote",
      mockFacts,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      verificationOutcome: "blocked",
      target: {
        mode: "mock-remote",
        hostId: "windows-devbox",
      },
    });
    expect(result.summary).toContain("mock transport refused connection");
    expect(result.nextActions).toEqual([
      "Check host availability or retry when the mocked transport is available.",
    ]);
  });

  it("redacts host-local details from command output summaries", () => {
    const projectRoot = makeTempProject();

    const result = checkNexusHostCapabilities({
      projectRoot,
      hostId: "windows-devbox",
      commandRunner: commandRunner({
        "git --version": {
          exitCode: 1,
          stderr:
            "failed reading C:\\Users\\alice\\.ssh\\id_ed25519 for 100.99.88.77:2222",
        },
        "node --version": {
          exitCode: 0,
          stdout: "v24.11.1\n",
        },
      }),
    });
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("[host-local-path]");
    expect(serialized).toContain("[tailscale-address]");
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("100.99.88.77");
  });

  it("exposes host check through the CLI", async () => {
    const projectRoot = makeTempProject();
    const writer = new CapturingWriter();

    await main(["host", "check", projectRoot, "--host", "windows-devbox", "--json"], {
      stdout: writer,
      commandRunner: successfulToolRunner(),
      now: () => "2026-05-20T12:00:00.000Z",
    });

    expect(parsedOutput(writer)).toMatchObject({
      ok: true,
      result: {
        status: "passed",
        target: {
          hostId: "windows-devbox",
        },
      },
    });
  });

  it("exposes host check through MCP with mocked remote facts", async () => {
    const projectRoot = makeTempProject();

    const payload = mcpPayload(
      await callDevNexusMcpTool("host_check", {
        projectRoot,
        hostId: "windows-devbox",
        mode: "mock-remote",
        mockFacts: {
          available: true,
          platform: "windows",
          shellKind: "powershell",
          commands: {
            git: "present",
            node: "missing",
            "dev-nexus-cli": "present",
          },
          mcpServerNames: ["dev_nexus"],
        },
      }),
    );

    expect(payload).toMatchObject({
      ok: true,
      result: {
        status: "blocked",
        target: {
          mode: "mock-remote",
          hostId: "windows-devbox",
        },
        commandChecks: [
          { id: "dev-nexus-cli", status: "present" },
          { id: "git", status: "present" },
          { id: "node", status: "missing" },
        ],
      },
    });
  });
});
