import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { callDevNexusMcpTool } from "../../src/mcp/nexusMcpServer.js";
import {
  createNexusRemoteExecutionRequest,
  getNexusRemoteExecutionRecord,
} from "../../src/remote-execution/nexusRemoteExecution.js";
import {
  runNexusSshRemoteExecution,
  type NexusSshRemoteExecutionTransport,
  type NexusSshRemoteExecutionTransportInput,
} from "../../src/remote-execution/nexusSshRemoteExecution.js";
import type { NexusHomeConfigBase } from "../../src/project/nexusHomeConfig.js";

class CapturingWriter {
  private readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  output(): string {
    return this.chunks.join("");
  }
}

function makeTempProject(options: {
  runnerOverrides?: Record<string, unknown>;
} = {}): string {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dev-nexus-ssh-run-"),
  );
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "dev-nexus.project.json"),
    `${JSON.stringify(
      {
        version: 1,
        id: "ssh-run-demo",
        name: "SSH Run Demo",
        repo: {
          kind: "git",
          remoteUrl: "git@example.invalid:dev/ssh-run-demo.git",
          defaultBranch: "main",
        },
        worktreesRoot: "worktrees",
        components: [
          {
            id: "dev-nexus",
            name: "DevNexus",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:dev/nexus.git",
            defaultBranch: "main",
            sourceRoot: "src",
            relationships: [],
          },
        ],
        hosts: [
          {
            id: "mac-runner",
            displayName: "Mac Runner",
            platformTags: ["macos"],
            capabilityTags: ["macos", "node", "git", "ssh"],
          },
        ],
        runnerProfiles: [
          {
            id: "mac-verify",
            requiredCapabilities: ["macos", "node"],
            allowedOperationClasses: ["read_only", "verification"],
            commandProfileRefs: ["npm-check"],
            limits: {
              timeoutMs: 300000,
              outputLineLimit: 200,
              outputByteLimit: 50000,
            },
            artifactRetention: {
              mode: "logs",
              ttlDays: 7,
            },
            credentialIdentity: {
              kind: "automation",
              identityRef: "github-bot",
            },
            mutationClass: "verification",
            ...(options.runnerOverrides ?? {}),
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

function homeConfig(options: {
  command?: string;
} = {}): NexusHomeConfigBase {
  return {
    version: 1,
    paths: {
      projectsRoot: "/Users/alice/dev/projects",
      workspacesRoot: "/Users/alice/dev/workspaces",
    },
    remoteExecution: {
      commandProfiles: [
        {
          id: "npm-check",
          command: options.command ?? "npm run check",
        },
      ],
    },
    hostOverlays: [
      {
        hostId: "mac-runner",
        transport: {
          kind: "ssh",
          sshHost: "mac-runner.tailnet.example",
          sshUser: "alice",
          shell: "zsh",
          authProfile: "mac-runner-ssh-key",
        },
        workspaceRoots: {
          componentRoots: {
            "dev-nexus": "/Users/alice/dev/sources/dev-nexus",
          },
        },
      },
    ],
    projects: [],
  };
}

function createRequest(projectRoot: string, options: {
  commandProfileId?: string;
  initialStatus?: string;
} = {}): string {
  return createNexusRemoteExecutionRequest({
    projectRoot,
    componentId: "dev-nexus",
    workItemId: "github-34",
    requestingHostId: "windows-devbox",
    targetHostId: "mac-runner",
    runnerProfileId: "mac-verify",
    repository: "git@example.invalid:dev/nexus.git",
    ref: "codex/dev-nexus/34-remote-execution-runner",
    commandProfileId: options.commandProfileId ?? "npm-check",
    timeoutMs: 300000,
    expectedArtifacts: ["vitest-log"],
    mutationClass: "verification",
    initialStatus: options.initialStatus,
    now: () => "2026-06-01T10:00:00.000Z",
  }).id;
}

function transportReturning(
  result: Awaited<ReturnType<NexusSshRemoteExecutionTransport>>,
): {
  transport: NexusSshRemoteExecutionTransport;
  calls: NexusSshRemoteExecutionTransportInput[];
} {
  const calls: NexusSshRemoteExecutionTransportInput[] = [];
  return {
    calls,
    transport: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

function mcpPayload(result: Awaited<ReturnType<typeof callDevNexusMcpTool>>): any {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]!.text);
}

describe("Nexus SSH remote execution runner", () => {
  it("runs an approved command profile and records a passed verification result", async () => {
    const projectRoot = makeTempProject();
    const requestId = createRequest(projectRoot);
    const { transport, calls } = transportReturning({
      exitCode: 0,
      stdout: "checks passed\n",
      stderr: "",
      actualRef: "codex/dev-nexus/34-remote-execution-runner",
      actualCommit: "abc1234",
      credentialIdentityRef: "github-bot",
      artifactRefs: ["artifact://remote-exec-1/vitest-log"],
    });

    const run = await runNexusSshRemoteExecution({
      projectRoot,
      requestId,
      homeConfig: homeConfig(),
      transport,
      now: () => "2026-06-01T10:05:00.000Z",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      requestId,
      hostId: "mac-runner",
      runnerProfileId: "mac-verify",
      commandProfile: {
        id: "npm-check",
        command: "npm run check",
        argv: ["npm", "run", "check"],
      },
      repository: "git@example.invalid:dev/nexus.git",
      ref: "codex/dev-nexus/34-remote-execution-runner",
      timeoutMs: 300000,
      expectedCredentialIdentityRef: "github-bot",
    });
    expect(run.result).toMatchObject({
      status: "completed",
      verificationOutcome: "passed",
      actualCommit: "abc1234",
      commands: ["npm run check"],
      outputTail: "stdout:\nchecks passed",
    });
    expect(getNexusRemoteExecutionRecord({ projectRoot, requestId }).request.status)
      .toBe("completed");
  });

  it("records failed and timed-out command outcomes without weakening policy", async () => {
    const failedProjectRoot = makeTempProject();
    const failedRequestId = createRequest(failedProjectRoot);
    const failed = await runNexusSshRemoteExecution({
      projectRoot: failedProjectRoot,
      requestId: failedRequestId,
      homeConfig: homeConfig(),
      transport: transportReturning({
        exitCode: 1,
        stdout: "ok before failure\n",
        stderr: "test failed\n",
        actualRef: "codex/dev-nexus/34-remote-execution-runner",
        actualCommit: "def5678",
        credentialIdentityRef: "github-bot",
      }).transport,
      now: () => "2026-06-01T10:06:00.000Z",
    });

    expect(failed.result).toMatchObject({
      status: "failed",
      verificationOutcome: "failed",
      exitCode: 1,
    });

    const timedOutProjectRoot = makeTempProject();
    const timedOutRequestId = createRequest(timedOutProjectRoot);
    const timedOut = await runNexusSshRemoteExecution({
      projectRoot: timedOutProjectRoot,
      requestId: timedOutRequestId,
      homeConfig: homeConfig(),
      transport: transportReturning({
        exitCode: null,
        timedOut: true,
        stdout: "still running\n",
        stderr: "",
        actualRef: "codex/dev-nexus/34-remote-execution-runner",
        actualCommit: "fed4321",
        credentialIdentityRef: "github-bot",
      }).transport,
      now: () => "2026-06-01T10:07:00.000Z",
    });

    expect(timedOut.result).toMatchObject({
      status: "timed_out",
      verificationOutcome: "timed_out",
      exitCode: null,
    });
  });

  it("blocks refused command profiles and missing command definitions before transport execution", async () => {
    const refusedProjectRoot = makeTempProject();
    const refusedRequestId = createRequest(refusedProjectRoot, {
      commandProfileId: "npm-publish",
    });
    const refusedTransport = transportReturning({ exitCode: 0 });

    const refused = await runNexusSshRemoteExecution({
      projectRoot: refusedProjectRoot,
      requestId: refusedRequestId,
      homeConfig: homeConfig(),
      transport: refusedTransport.transport,
      now: () => "2026-06-01T10:08:00.000Z",
    });

    expect(refusedTransport.calls).toHaveLength(0);
    expect(refused.result).toMatchObject({
      status: "blocked",
      verificationOutcome: "blocked",
    });
    expect(refused.result.blockerSafetyReason).toContain(
      "Command profile npm-publish is not allowed by runner profile mac-verify.",
    );

    const missingProjectRoot = makeTempProject();
    const missingRequestId = createRequest(missingProjectRoot);
    const missingTransport = transportReturning({ exitCode: 0 });
    const missing = await runNexusSshRemoteExecution({
      projectRoot: missingProjectRoot,
      requestId: missingRequestId,
      homeConfig: {
        ...homeConfig(),
        remoteExecution: { commandProfiles: [] },
      },
      transport: missingTransport.transport,
      now: () => "2026-06-01T10:09:00.000Z",
    });

    expect(missingTransport.calls).toHaveLength(0);
    expect(missing.result.blockerSafetyReason).toContain(
      "Command profile is not configured in home remoteExecution.commandProfiles: npm-check.",
    );
  });

  it("blocks missing ref evidence and wrong credential identity results", async () => {
    const missingRefProjectRoot = makeTempProject();
    const missingRefRequestId = createRequest(missingRefProjectRoot);
    const missingRef = await runNexusSshRemoteExecution({
      projectRoot: missingRefProjectRoot,
      requestId: missingRefRequestId,
      homeConfig: homeConfig(),
      transport: transportReturning({
        exitCode: 0,
        stdout: "passed without proof\n",
        actualRef: "codex/dev-nexus/34-remote-execution-runner",
        credentialIdentityRef: "github-bot",
      }).transport,
      now: () => "2026-06-01T10:10:00.000Z",
    });

    expect(missingRef.result).toMatchObject({
      status: "blocked",
      verificationOutcome: "blocked",
    });
    expect(missingRef.result.blockerSafetyReason).toContain(
      "Remote execution transport did not report an actual commit for the requested ref.",
    );

    const wrongActorProjectRoot = makeTempProject();
    const wrongActorRequestId = createRequest(wrongActorProjectRoot);
    const wrongActor = await runNexusSshRemoteExecution({
      projectRoot: wrongActorProjectRoot,
      requestId: wrongActorRequestId,
      homeConfig: homeConfig(),
      transport: transportReturning({
        exitCode: 0,
        stdout: "passed as wrong actor\n",
        actualRef: "codex/dev-nexus/34-remote-execution-runner",
        actualCommit: "abc1234",
        credentialIdentityRef: "human",
      }).transport,
      now: () => "2026-06-01T10:11:00.000Z",
    });

    expect(wrongActor.result).toMatchObject({
      status: "blocked",
      verificationOutcome: "blocked",
    });
    expect(wrongActor.result.blockerSafetyReason).toContain(
      "Remote execution used credential identity human but runner profile mac-verify requires github-bot.",
    );
  });

  it("applies runner output limits before recording the result", async () => {
    const projectRoot = makeTempProject({
      runnerOverrides: {
        limits: {
          timeoutMs: 300000,
          outputLineLimit: 2,
          outputByteLimit: 80,
        },
      },
    });
    const requestId = createRequest(projectRoot);
    const run = await runNexusSshRemoteExecution({
      projectRoot,
      requestId,
      homeConfig: homeConfig(),
      transport: transportReturning({
        exitCode: 0,
        stdout: "line 1\nline 2\nline 3\nline 4\n",
        stderr: "warning 1\nwarning 2\n",
        actualRef: "codex/dev-nexus/34-remote-execution-runner",
        actualCommit: "abc1234",
        credentialIdentityRef: "github-bot",
      }).transport,
      now: () => "2026-06-01T10:12:00.000Z",
    });

    expect(run.result.outputTail).not.toContain("line 1");
    expect(run.result.outputTail).toContain("warning 2");
    expect(Buffer.byteLength(run.result.outputTail ?? "", "utf8")).toBeLessThanOrEqual(80);
  });

  it("exposes execution through the CLI with configured command profiles", async () => {
    const projectRoot = makeTempProject();
    const requestId = createRequest(projectRoot);
    const homePath = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-run-home-"));
    fs.writeFileSync(
      path.join(homePath, "dev-nexus.home.json"),
      `${JSON.stringify(homeConfig(), null, 2)}\n`,
      "utf8",
    );
    const output = new CapturingWriter();

    await expect(
      main(
        [
          "remote-execution",
          "run",
          projectRoot,
          requestId,
          "--home",
          homePath,
          "--json",
        ],
        {
          stdout: output,
          remoteExecutionTransport: transportReturning({
            exitCode: 0,
            stdout: "checks passed\n",
            stderr: "",
            actualRef: "codex/dev-nexus/34-remote-execution-runner",
            actualCommit: "abc1234",
            credentialIdentityRef: "github-bot",
          }).transport,
          now: () => "2026-06-01T10:13:00.000Z",
        },
      ),
    ).resolves.toBe(0);

    const payload = JSON.parse(output.output());
    expect(payload.result.status).toBe("completed");
    expect(payload.result.verificationOutcome).toBe("passed");
    expect(payload.localOnly).toBe(true);
  });

  it("exposes execution through the MCP tool surface", async () => {
    const projectRoot = makeTempProject();
    const requestId = createRequest(projectRoot);
    const homePath = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-run-home-"));
    fs.writeFileSync(
      path.join(homePath, "dev-nexus.home.json"),
      `${JSON.stringify(homeConfig(), null, 2)}\n`,
      "utf8",
    );
    const payload = mcpPayload(
      await callDevNexusMcpTool(
        "remote_execution_run",
        {
          projectRoot,
          requestId,
          homePath,
        },
        {
          remoteExecutionTransport: transportReturning({
            exitCode: 0,
            stdout: "checks passed\n",
            stderr: "",
            actualRef: "codex/dev-nexus/34-remote-execution-runner",
            actualCommit: "abc1234",
            credentialIdentityRef: "github-bot",
          }).transport,
          now: () => "2026-06-01T10:14:00.000Z",
        },
      ),
    );

    expect(payload.result.status).toBe("completed");
    expect(payload.result.verificationOutcome).toBe("passed");
  });
});
