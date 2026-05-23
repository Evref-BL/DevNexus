import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNexusRemoteExecutionRequest,
} from "../../src/remote-execution/nexusRemoteExecution.js";
import {
  planNexusSshExecution,
} from "../../src/remote-execution/nexusSshExecutionPlan.js";
import type { NexusHomeConfigBase } from "../../src/project/nexusHomeConfig.js";

function makeTempProject(options: {
  extraHosts?: unknown[];
  runnerOverrides?: Record<string, unknown>;
} = {}): string {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dev-nexus-ssh-plan-"),
  );
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "dev-nexus.project.json"),
    `${JSON.stringify(
      {
        version: 1,
        id: "ssh-plan-demo",
        name: "SSH Plan Demo",
        repo: {
          kind: "git",
          remoteUrl: "git@example.invalid:dev/ssh-plan-demo.git",
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
          ...(options.extraHosts ?? []),
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

function homeConfig(
  overlayOverrides: Record<string, unknown> = {},
): NexusHomeConfigBase {
  return {
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
          port: 2222,
          tailscaleAddress: "100.99.88.77",
          shell: "zsh",
          authProfile: "mac-runner-ssh-key",
          commandPaths: {
            "dev-nexus": "/Users/alice/.npm/bin/dev-nexus",
          },
        },
        workspaceRoots: {
          projectRoot: "/Users/alice/dev/dev-nexus-dogfood",
          componentsRoot: "/Users/alice/dev/sources",
          componentRoots: {
            "dev-nexus": "/Users/alice/dev/sources/dev-nexus",
          },
        },
        ...overlayOverrides,
      },
    ],
    projects: [],
  };
}

function createRequest(
  projectRoot: string,
  options: {
    targetHostId?: string | null;
    requiredCapabilities?: string[];
    commandProfileId?: string;
    timeoutMs?: number;
  } = {},
): string {
  const targetHostId = Object.hasOwn(options, "targetHostId")
    ? options.targetHostId
    : "mac-runner";
  return createNexusRemoteExecutionRequest({
    projectRoot,
    componentId: "dev-nexus",
    workItemId: "local-83",
    requestingHostId: "windows-devbox",
    targetHostId,
    requiredCapabilities: options.requiredCapabilities ?? ["ssh"],
    runnerProfileId: "mac-verify",
    repository: "git@example.invalid:dev/nexus.git",
    ref: "codex/dev-nexus-local-83-ssh-plan",
    commandProfileId: options.commandProfileId ?? "npm-check",
    timeoutMs: options.timeoutMs ?? 300000,
    expectedArtifacts: ["vitest-log"],
    mutationClass: "verification",
    now: () => "2026-05-20T10:00:00.000Z",
  }).id;
}

describe("Nexus SSH execution planning", () => {
  it("builds a redacted SSH plan for an approved host-local overlay", () => {
    const projectRoot = makeTempProject();
    const requestId = createRequest(projectRoot);

    const plan = planNexusSshExecution({
      projectRoot,
      requestId,
      homeConfig: homeConfig(),
    });
    const serialized = JSON.stringify(plan);

    expect(plan).toMatchObject({
      kind: "dev-nexus.remote-execution.ssh-plan",
      status: "ready",
      projectId: "ssh-plan-demo",
      componentId: "dev-nexus",
      requestId: "remote-exec-1",
      runnerProfileId: "mac-verify",
      mutationClass: "verification",
      target: {
        hostId: "mac-runner",
        platformTags: ["macos"],
      },
      transport: {
        kind: "ssh",
        host: "configured",
        user: "configured",
        port: "configured",
        credentialProfile: "configured",
        addressSource: "sshHost",
      },
      workingDirectory: {
        classification: "component_root",
        sanitizedPath: "[host-local-component-root]",
      },
      command: {
        shellKind: "posix",
        commandProfileId: "npm-check",
        sshArgvShape: [
          "ssh",
          "-p",
          "<ssh-port>",
          "<ssh-user>@<ssh-host>",
          "--",
          "sh",
          "-lc",
          "<command-profile:npm-check>",
        ],
      },
      timeout: {
        requestedMs: 300000,
        profileLimitMs: 300000,
        effectiveMs: 300000,
      },
      outputPolicy: {
        outputLineLimit: 200,
        outputByteLimit: 50000,
      },
      requiredEnvironmentKeys: [
        "DEV_NEXUS_REMOTE_EXECUTION_REQUEST_ID",
        "DEV_NEXUS_REMOTE_EXECUTION_COMMAND_PROFILE",
        "DEV_NEXUS_REMOTE_EXECUTION_REPOSITORY",
        "DEV_NEXUS_REMOTE_EXECUTION_REF",
      ],
      blockers: [],
    });
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("mac-runner.tailnet.example");
    expect(serialized).not.toContain("100.99.88.77");
    expect(serialized).not.toContain("mac-runner-ssh-key");
  });

  it("plans PowerShell command shape without exposing Windows host-local paths", () => {
    const projectRoot = makeTempProject({
      runnerOverrides: {
        requiredCapabilities: ["windows", "node"],
      },
      extraHosts: [
        {
          id: "windows-runner",
          platformTags: ["windows"],
          capabilityTags: ["windows", "node", "git", "ssh"],
        },
      ],
    });
    const requestId = createNexusRemoteExecutionRequest({
      projectRoot,
      componentId: "dev-nexus",
      requestingHostId: "mac-devbox",
      targetHostId: "windows-runner",
      runnerProfileId: "mac-verify",
      repository: "git@example.invalid:dev/nexus.git",
      ref: "codex/windows-plan",
      commandProfileId: "npm-check",
      timeoutMs: 120000,
      mutationClass: "verification",
      now: () => "2026-05-20T10:00:00.000Z",
    }).id;

    const plan = planNexusSshExecution({
      projectRoot,
      requestId,
      homeConfig: {
        version: 1,
        paths: {
          projectsRoot: "C:\\Users\\alice\\dev\\projects",
          workspacesRoot: "C:\\Users\\alice\\dev\\workspaces",
        },
        hostOverlays: [
          {
            hostId: "windows-runner",
            transport: {
              kind: "ssh",
              host: "windows-runner.tailnet.example",
              sshUser: "alice",
              shell: "pwsh",
            },
            workspaceRoots: {
              componentsRoot: "C:\\Users\\alice\\dev\\sources",
            },
          },
        ],
        projects: [],
      },
    });

    expect(plan).toMatchObject({
      status: "ready",
      command: {
        shellKind: "powershell",
        sshArgvShape: [
          "ssh",
          "<ssh-user>@<ssh-host>",
          "--",
          "pwsh",
          "-NoProfile",
          "-Command",
          "<command-profile:npm-check>",
        ],
      },
      workingDirectory: {
        classification: "components_root_child",
        sanitizedPath: "[host-local-components-root]/<component-id>",
      },
    });
    expect(JSON.stringify(plan)).not.toContain("C:\\Users\\alice");
    expect(JSON.stringify(plan)).not.toContain("windows-runner.tailnet.example");
  });

  it("blocks when no host-local SSH overlay is configured", () => {
    const projectRoot = makeTempProject();
    const requestId = createRequest(projectRoot);

    const plan = planNexusSshExecution({
      projectRoot,
      requestId,
      homeConfig: {
        version: 1,
        paths: {
          projectsRoot: "/tmp/projects",
          workspacesRoot: "/tmp/workspaces",
        },
        projects: [],
      },
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "Host mac-runner needs a host-local SSH transport overlay.",
        "Host mac-runner needs sshHost, host, or tailscaleAddress in its host-local overlay.",
        "Host mac-runner needs a host-local projectRoot, componentsRoot, or componentRoots.dev-nexus.",
      ]),
    );
  });

  it("blocks missing address, workspace root, unsupported shell, and refused command profile", () => {
    const projectRoot = makeTempProject();
    const requestId = createRequest(projectRoot, {
      commandProfileId: "npm-publish",
    });

    const plan = planNexusSshExecution({
      projectRoot,
      requestId,
      homeConfig: homeConfig({
        transport: {
          kind: "ssh",
          sshUser: "alice",
          shell: "fish",
        },
        workspaceRoots: {},
      }),
    });

    expect(plan.status).toBe("blocked");
    expect(plan.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "commandProfile",
          status: "failed",
        }),
        expect.objectContaining({
          name: "sshAddress",
          status: "failed",
        }),
        expect.objectContaining({
          name: "workspaceRoot",
          status: "failed",
        }),
        expect.objectContaining({
          name: "shell",
          status: "failed",
        }),
      ]),
    );
  });

  it("requires an explicit target host when capability selection is ambiguous", () => {
    const projectRoot = makeTempProject({
      extraHosts: [
        {
          id: "mac-runner-2",
          platformTags: ["macos"],
          capabilityTags: ["macos", "node", "git", "ssh"],
        },
      ],
    });
    const requestId = createRequest(projectRoot, {
      targetHostId: null,
      requiredCapabilities: ["macos", "ssh"],
    });

    const plan = planNexusSshExecution({
      projectRoot,
      requestId,
      homeConfig: homeConfig(),
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers[0]).toContain("Multiple enabled hosts");
    expect(plan.blockers[0]).toContain("mac-runner");
    expect(plan.blockers[0]).toContain("mac-runner-2");
  });
});
