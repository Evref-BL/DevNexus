import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { callDevNexusMcpTool } from "../../src/mcp/nexusMcpServer.js";
import {
  createNexusRemoteExecutionRequest,
  getNexusRemoteExecutionRecord,
  maxNexusRemoteExecutionOutputTailLength,
  nexusRemoteExecutionRequestStatuses,
  readNexusRemoteExecutionStore,
  recordNexusRemoteExecutionResult,
} from "../../src/remote-execution/nexusRemoteExecution.js";

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

function makeTempProject(): string {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dev-nexus-remote-execution-"),
  );
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "dev-nexus.project.json"),
    `${JSON.stringify(
      {
        version: 1,
        id: "remote-demo",
        name: "Remote Demo",
        repo: {
          kind: "git",
          remoteUrl: "git@example.invalid:dev/remote-demo.git",
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
            workTracking: {
              provider: "local",
              storePath: ".dev-nexus/work-items/dev-nexus.json",
            },
            relationships: [],
          },
        ],
        hosts: [
          {
            id: "mac-runner",
            platformTags: ["macos"],
            capabilityTags: ["macos", "node"],
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

function makeTempHome(): string {
  const homePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "dev-nexus-remote-home-"),
  );
  fs.writeFileSync(
    path.join(homePath, "dev-nexus.home.json"),
    `${JSON.stringify(
      {
        version: 1,
        paths: {
          projectsRoot: "/Users/alice/dev/projects",
          workspacesRoot: "/Users/alice/dev/workspaces",
        },
        hostOverlays: [
          {
            hostId: "mac-runner",
            transport: {
              kind: "ssh",
              sshHost: "mac-runner.tailnet.example",
              sshUser: "alice",
              shell: "zsh",
            },
            workspaceRoots: {
              componentRoots: {
                "dev-nexus": "/Users/alice/dev/sources/dev-nexus",
              },
            },
          },
        ],
        projects: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return homePath;
}

function parsedJson(writer: CapturingWriter): any {
  return JSON.parse(writer.output());
}

function mcpPayload(result: Awaited<ReturnType<typeof callDevNexusMcpTool>>): any {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]!.text);
}

describe("Nexus remote execution records", () => {
  it("creates durable draft requests with bounded source-of-truth references", () => {
    const projectRoot = makeTempProject();

    const request = createNexusRemoteExecutionRequest({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-81",
      requestingHostId: "windows-devbox",
      requestingAgentId: "codex-agent-1",
      requiredCapabilities: ["macos", "node", "macos"],
      runnerProfileId: "mac-verify",
      repository: "git@example.invalid:dev/nexus.git",
      ref: "codex/dev-nexus-local-81-remote-records",
      commandProfileId: "npm-check",
      timeoutMs: 300000,
      expectedArtifacts: ["vitest-log"],
      mutationClass: "verification",
      attachmentRefs: [
        {
          kind: "coordination_record",
          componentId: "dev-nexus",
          recordId: "coordreq-123",
          workItemId: "local-81",
        },
      ],
      now: () => "2026-05-18T21:00:00.000Z",
    });

    expect(nexusRemoteExecutionRequestStatuses).toEqual([
      "queued",
      "accepted",
      "running",
      "completed",
      "failed",
      "blocked",
      "timed_out",
      "cancelled",
    ]);
    expect(request).toMatchObject({
      kind: "dev-nexus.remote-execution.request",
      id: "remote-exec-1",
      projectId: "remote-demo",
      componentId: "dev-nexus",
      workItemId: "local-81",
      requestingHostId: "windows-devbox",
      requestingAgentId: "codex-agent-1",
      targetHostId: null,
      requiredCapabilities: ["macos", "node"],
      runnerProfileId: "mac-verify",
      repository: "git@example.invalid:dev/nexus.git",
      ref: "codex/dev-nexus-local-81-remote-records",
      commandProfileId: "npm-check",
      timeoutMs: 300000,
      expectedArtifacts: ["vitest-log"],
      mutationClass: "verification",
      status: "queued",
      attachmentRefs: [
        {
          kind: "work_item",
          componentId: "dev-nexus",
          workItemId: "local-81",
        },
        {
          kind: "coordination_record",
          componentId: "dev-nexus",
          recordId: "coordreq-123",
          workItemId: "local-81",
        },
      ],
    });
    expect(JSON.stringify(request.attachmentRefs)).not.toContain(
      "Record remote execution requests",
    );
    expect(readNexusRemoteExecutionStore(projectRoot).requests).toHaveLength(1);
  });

  it("records results, advances request status, and rejects malformed output tails", () => {
    const projectRoot = makeTempProject();
    const request = createNexusRemoteExecutionRequest({
      projectRoot,
      componentId: "dev-nexus",
      requestingHostId: "windows-devbox",
      targetHostId: "mac-runner",
      runnerProfileId: "mac-verify",
      repository: "git@example.invalid:dev/nexus.git",
      ref: "codex/dev-nexus-local-81-remote-records",
      commandProfileId: "npm-check",
      timeoutMs: 300000,
      expectedArtifacts: ["vitest-log"],
      mutationClass: "verification",
      now: () => "2026-05-18T21:00:00.000Z",
    });

    const result = recordNexusRemoteExecutionResult({
      projectRoot,
      requestId: request.id,
      status: "completed",
      hostId: "mac-runner",
      runnerProfileId: "mac-verify",
      actualRef: "codex/dev-nexus-local-81-remote-records",
      actualCommit: "abc1234",
      commands: ["npm test -- src/nexusRemoteExecution.test.ts"],
      exitCode: 0,
      verificationOutcome: "passed",
      outputTail: "2 tests passed",
      artifactRefs: ["artifact://remote-exec-1/vitest-log"],
      cleanupStatus: "completed",
      blockerSafetyReason: null,
      now: () => "2026-05-18T21:05:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "dev-nexus.remote-execution.result",
      requestId: "remote-exec-1",
      status: "completed",
      hostId: "mac-runner",
      runnerProfileId: "mac-verify",
      actualCommit: "abc1234",
      exitCode: 0,
      verificationOutcome: "passed",
      outputTail: "2 tests passed",
      cleanupStatus: "completed",
      blockerSafetyReason: null,
    });

    const record = getNexusRemoteExecutionRecord({
      projectRoot,
      requestId: request.id,
    });
    expect(record.request.status).toBe("completed");
    expect(record.result?.commands).toEqual([
      "npm test -- src/nexusRemoteExecution.test.ts",
    ]);

    expect(() =>
      recordNexusRemoteExecutionResult({
        projectRoot,
        requestId: request.id,
        status: "failed",
        hostId: "mac-runner",
        runnerProfileId: "mac-verify",
        actualRef: "codex/dev-nexus-local-81-remote-records",
        actualCommit: "abc1234",
        commands: ["npm test"],
        exitCode: 1,
        verificationOutcome: "failed",
        outputTail: "x".repeat(maxNexusRemoteExecutionOutputTailLength + 1),
        artifactRefs: [],
        cleanupStatus: "completed",
        blockerSafetyReason: null,
      }),
    ).toThrow(/outputTail/);
  });

  it("exposes draft/local request and result operations through the CLI", async () => {
    const projectRoot = makeTempProject();
    const requestOutput = new CapturingWriter();

    await expect(
      main(
        [
          "remote-execution",
          "request",
          "create",
          projectRoot,
          "--component",
          "dev-nexus",
          "--work-item",
          "local-81",
          "--requesting-host",
          "windows-devbox",
          "--requesting-agent",
          "codex-agent-1",
          "--capability",
          "macos",
          "--runner-profile",
          "mac-verify",
          "--repository",
          "git@example.invalid:dev/nexus.git",
          "--ref",
          "codex/dev-nexus-local-81-remote-records",
          "--command-profile",
          "npm-check",
          "--timeout-ms",
          "300000",
          "--expected-artifact",
          "vitest-log",
          "--mutation-class",
          "verification",
          "--attach-coordination-record",
          "coordreq-123",
          "--json",
        ],
        {
          stdout: requestOutput,
          now: () => "2026-05-18T21:00:00.000Z",
        },
      ),
    ).resolves.toBe(0);

    const requestPayload = parsedJson(requestOutput);
    expect(requestPayload.request.id).toBe("remote-exec-1");
    expect(requestPayload.request.status).toBe("queued");
    expect(requestPayload.localOnly).toBe(true);

    const planOutput = new CapturingWriter();
    await expect(
      main(
        [
          "remote-execution",
          "ssh-plan",
          projectRoot,
          "remote-exec-1",
          "--home",
          makeTempHome(),
          "--json",
        ],
        { stdout: planOutput },
      ),
    ).resolves.toBe(0);
    const planPayload = parsedJson(planOutput);
    expect(planPayload.plan.status).toBe("ready");
    expect(planPayload.plan.command.sshArgvShape).toEqual([
      "ssh",
      "<ssh-user>@<ssh-host>",
      "--",
      "sh",
      "-lc",
      "<command-profile:npm-check>",
    ]);
    expect(JSON.stringify(planPayload.plan)).not.toContain("/Users/alice");

    const resultOutput = new CapturingWriter();
    await expect(
      main(
        [
          "remote-execution",
          "result",
          "record",
          projectRoot,
          "remote-exec-1",
          "--status",
          "completed",
          "--host",
          "mac-runner",
          "--runner-profile",
          "mac-verify",
          "--actual-ref",
          "codex/dev-nexus-local-81-remote-records",
          "--actual-commit",
          "abc1234",
          "--command",
          "npm test -- src/nexusRemoteExecution.test.ts",
          "--exit-code",
          "0",
          "--verification-outcome",
          "passed",
          "--output-tail",
          "2 tests passed",
          "--artifact",
          "artifact://remote-exec-1/vitest-log",
          "--cleanup-status",
          "completed",
          "--json",
        ],
        {
          stdout: resultOutput,
          now: () => "2026-05-18T21:05:00.000Z",
        },
      ),
    ).resolves.toBe(0);
    expect(parsedJson(resultOutput).result.status).toBe("completed");

    const getOutput = new CapturingWriter();
    await expect(
      main(
        [
          "remote-execution",
          "result",
          "get",
          projectRoot,
          "remote-exec-1",
          "--json",
        ],
        { stdout: getOutput },
      ),
    ).resolves.toBe(0);

    const getPayload = parsedJson(getOutput);
    expect(getPayload.record.request.status).toBe("completed");
    expect(getPayload.record.result.commands).toEqual([
      "npm test -- src/nexusRemoteExecution.test.ts",
    ]);
  });

  it("exposes draft/local request and result operations through MCP", async () => {
    const projectRoot = makeTempProject();
    const context = { now: () => "2026-05-18T21:00:00.000Z" };

    const createPayload = mcpPayload(
      await callDevNexusMcpTool(
        "remote_execution_request_create",
        {
          projectRoot,
          componentId: "dev-nexus",
          workItemId: "local-81",
          requestingHostId: "windows-devbox",
          requestingAgentId: "codex-agent-1",
          requiredCapabilities: ["macos"],
          runnerProfileId: "mac-verify",
          repository: "git@example.invalid:dev/nexus.git",
          ref: "codex/dev-nexus-local-81-remote-records",
          commandProfileId: "npm-check",
          timeoutMs: 300000,
          expectedArtifacts: ["vitest-log"],
          mutationClass: "verification",
          initialStatus: "accepted",
          attachmentRefs: [
            {
              kind: "coordination_record",
              componentId: "dev-nexus",
              recordId: "coordreq-123",
              workItemId: "local-81",
            },
          ],
        },
        context,
      ),
    );
    expect(createPayload.request.status).toBe("accepted");
    expect(createPayload.localOnly).toBe(true);

    const planPayload = mcpPayload(
      await callDevNexusMcpTool("remote_execution_ssh_plan", {
        projectRoot,
        requestId: "remote-exec-1",
        homePath: makeTempHome(),
      }),
    );
    expect(planPayload.plan.status).toBe("ready");
    expect(planPayload.localOnly).toBe(true);

    const recordPayload = mcpPayload(
      await callDevNexusMcpTool(
        "remote_execution_result_record",
        {
          projectRoot,
          requestId: "remote-exec-1",
          status: "completed",
          hostId: "mac-runner",
          runnerProfileId: "mac-verify",
          actualRef: "codex/dev-nexus-local-81-remote-records",
          actualCommit: "abc1234",
          commands: ["npm test -- src/nexusRemoteExecution.test.ts"],
          exitCode: 0,
          verificationOutcome: "passed",
          outputTail: "2 tests passed",
          artifactRefs: ["artifact://remote-exec-1/vitest-log"],
          cleanupStatus: "completed",
          blockerSafetyReason: null,
        },
        { now: () => "2026-05-18T21:05:00.000Z" },
      ),
    );
    expect(recordPayload.result.status).toBe("completed");

    const getPayload = mcpPayload(
      await callDevNexusMcpTool("remote_execution_result_get", {
        projectRoot,
        requestId: "remote-exec-1",
      }),
    );
    expect(getPayload.record.request.status).toBe("completed");
    expect(getPayload.record.result.verificationOutcome).toBe("passed");
  });
});
