import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  callDevNexusMcpTool,
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  defaultNexusFeatureBranchDeliveryConfig,
  defaultLocalWorkTrackingStorePath,
  devNexusCoreMcpToolNames,
  handleDevNexusMcpJsonRpcMessage,
  listDevNexusMcpTools,
  listMcpInputSchemaProviderIssues,
  maxNexusRemoteExecutionOutputTailLength,
  nexusWorkerContextJsonPath,
  readNexusAutomationRunLedger,
  saveProjectConfig,
  StdioJsonRpcTransport,
  type GitCommandResult,
  type GitRunner,
  type NexusEligibleWorkClaimProviderFactory,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityRecord,
  type NexusProjectHostingProviderAdapter,
  type NexusProjectConfig,
  type WorkComment,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkItemRef,
  type WorkTrackerProvider,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
}

function jsonRpcFrame(message: unknown): Buffer {
  const body = JSON.stringify(message);
  return Buffer.from(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    "utf8",
  );
}

function parseJsonRpcFrame(frame: Buffer): unknown {
  const headerEnd = frame.indexOf("\r\n\r\n");
  expect(headerEnd).toBeGreaterThanOrEqual(0);
  const header = frame.slice(0, headerEnd).toString("utf8");
  const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
  expect(lengthMatch).not.toBeNull();
  const bodyStart = headerEnd + 4;
  return JSON.parse(
    frame.slice(bodyStart, bodyStart + Number(lengthMatch![1])).toString("utf8"),
  );
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

async function nextChunk(stream: PassThrough): Promise<Buffer> {
  return new Promise((resolve) => {
    stream.once("data", (chunk: Buffer | string) => {
      resolve(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
    });
  });
}

async function waitForMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "mcp-demo",
    name: "MCP Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:mcp/demo.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [
      {
        id: "primary",
        name: "MCP Demo",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:mcp/demo.git",
        defaultBranch: "main",
        sourceRoot: "source",
        workTracking: {
          provider: "local",
        },
        relationships: [],
      },
    ],
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
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
      },
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Use DevNexus to work on itself until no eligible issue remains.",
      },
    },
    ...overrides,
  };
}

function featureProjectConfig(): NexusProjectConfig {
  return projectConfig({
    automation: {
      ...defaultNexusAutomationConfig,
      mode: "agent_launch",
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
      },
      target: {
        ...defaultNexusAutomationConfig.target,
        id: "dogfood",
        objective: "Use DevNexus to work on itself until no eligible issue remains.",
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
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
            labels: [],
          },
        },
      },
    },
  });
}

function createMcpPublicationProject(): {
  projectRoot: string;
  homePath: string;
  sourceRoot: string;
} {
  const projectRoot = makeTempDir("dev-nexus-mcp-publication-");
  const homePath = path.join(projectRoot, "home");
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  saveHomeConfig(homePath, [
    {
      id: "dev-nexus-app",
      actorId: "dev-nexus-automation-app",
      provider: "github",
      kind: "app",
      credentialKind: "github_app",
      account: "devnexus-automation",
      host: "github.com",
      purposes: ["api", "git"],
      command: "home:secrets/github-app-token.mjs --format token",
      environmentKeys: ["GH_TOKEN"],
    },
  ]);
  saveProjectConfig(
    projectRoot,
    projectConfig({
      home: homePath,
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
        defaultBranch: "main",
        sourceRoot: "source",
      },
      workTracking: {
        provider: "github",
        repository: {
          owner: "Evref-BL",
          name: "DevNexus",
        },
      },
      automation: {
        ...defaultNexusAutomationConfig,
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "green_main",
          remote: "app",
          targetBranch: "main",
          push: false,
          actor: {
            id: "dev-nexus-automation-app",
            kind: "app",
            provider: "github",
            handle: "devnexus-automation",
          },
        },
      },
      components: [
        {
          id: "primary",
          name: "MCP Publication Demo",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
          defaultBranch: "main",
          sourceRoot: "source",
          workTracking: {
            provider: "github",
            repository: {
              owner: "Evref-BL",
              name: "DevNexus",
            },
          },
          relationships: [],
        },
      ],
    }),
  );
  return { projectRoot, homePath, sourceRoot };
}

function toolJson(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0]!.text);
}

function fakeGitRunner(repositoryPath: string): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, "codex/shared-coordination\n");
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, "abc123def456\n");
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
      return ok(argsArray, "abc123def456\n");
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

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function githubIssueResponse(options: {
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  labels?: string[];
}): Record<string, unknown> {
  return {
    id: options.number,
    number: options.number,
    title: options.title,
    body: null,
    state: options.state,
    state_reason:
      options.stateReason ?? (options.state === "closed" ? "completed" : null),
    labels: options.labels ?? [],
    assignees: [],
    created_at: "2026-05-20T09:00:00.000Z",
    updated_at: "2026-05-20T10:00:00.000Z",
    closed_at:
      options.state === "closed" ? "2026-05-20T10:00:00.000Z" : null,
    html_url: `https://github.com/example/demo/issues/${options.number}`,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("DevNexus MCP server", () => {
  it("lists generic project, automation, and work-item tools", () => {
    expect(listDevNexusMcpTools().map((tool) => tool.name)).toEqual([
      "project_status",
      "project_hosting_status",
      "project_hosting_plan",
      "project_hosting_apply",
      "automation_status",
      "eligible_work",
      "agent_profiles",
      "codex_app_server_probe",
      "automation_heartbeat_prepare",
      "setup_flow_list",
      "setup_plan",
      "setup_check",
      "setup_record",
      "target_cycle_list",
      "target_cycle_record",
      "target_report",
      "publication_feature_plan",
      "publication_feature_report",
      "publication_feature_finalization",
      "publication_actor_verify",
      "publication_branch_push",
      "publication_pull_request_upsert",
      "publication_review_handoff",
      "publication_pull_request_evidence",
      "publication_pull_request_merge",
      "review_plan",
      "current_agent_adopt",
      "current_agent_heartbeat",
      "current_agent_record",
      "worktree_prepare",
      "coordination_status",
      "coordination_handoff",
      "coordination_integrate",
      "coordination_request",
      "host_check",
      "remote_execution_request_create",
      "remote_execution_result_record",
      "remote_execution_result_get",
      "remote_execution_ssh_plan",
      "work_item_create",
      "work_item_discovery_status",
      "work_item_claim_next",
      "work_item_list",
      "work_item_get",
      "work_item_update",
      "work_item_comment",
      "work_item_set_status",
      "work_item_link",
      "work_item_show_links",
      "work_item_unlink",
      "work_item_sync_plan",
      "work_item_import_plan",
      "work_item_import_execute",
      "work_item_sync_execute",
    ]);
  });

  it("keeps the core MCP ownership list aligned with the advertised tools", () => {
    expect(devNexusCoreMcpToolNames).toEqual(
      listDevNexusMcpTools().map((tool) => tool.name),
    );
  });

  it("advertises bounded MCP inputs for large text fields", () => {
    const tool = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "remote_execution_result_record",
    );

    expect(tool?.inputSchema).toMatchObject({
      properties: {
        outputTail: {
          type: "string",
          maxLength: maxNexusRemoteExecutionOutputTailLength,
        },
      },
    });
  });

  it("advertises eligible work mode on the matching MCP tool", () => {
    const hostingStatus = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "project_hosting_status",
    );
    const hostingPlan = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "project_hosting_plan",
    );
    const eligibleWork = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "eligible_work",
    );
    const claimNext = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "work_item_claim_next",
    );
    const targetCycleRecord = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "target_cycle_record",
    );

    expect(hostingStatus?.inputSchema).not.toMatchObject({
      properties: {
        mode: expect.anything(),
      },
    });
    expect(hostingPlan?.inputSchema).not.toMatchObject({
      properties: {
        mode: expect.anything(),
      },
    });
    expect(eligibleWork?.inputSchema).toMatchObject({
      properties: {
        mode: {
          enum: ["default", "discovery"],
        },
      },
    });
    expect(claimNext?.inputSchema).toMatchObject({
      properties: {
        mode: {
          enum: ["default", "discovery"],
        },
        hostId: {
          type: "string",
        },
        leaseDurationMs: {
          type: "number",
        },
        staleClaimPolicy: {
          enum: ["report", "reclaim"],
        },
      },
      required: ["hostId"],
    });
    expect(targetCycleRecord?.inputSchema).toMatchObject({
      properties: {
        workItems: {
          items: {
            properties: {
              cycleStatus: {
                enum: expect.arrayContaining(["failed"]),
              },
            },
          },
        },
      },
    });
  });

  it("advertises compact detail controls only on tools with full-output opt-in", () => {
    const toolsByName = new Map(
      listDevNexusMcpTools().map((tool) => [tool.name, tool]),
    );
    for (const toolName of [
      "project_status",
      "automation_status",
      "target_report",
      "coordination_status",
      "target_cycle_list",
      "target_cycle_record",
      "work_item_list",
    ]) {
      expect(toolsByName.get(toolName)?.inputSchema).toMatchObject({
        properties: {
          detail: {
            enum: ["summary", "full"],
            default: "summary",
          },
        },
      });
    }
    for (const toolName of [
      "project_hosting_status",
      "project_hosting_plan",
      "project_hosting_apply",
      "agent_profiles",
    ]) {
      expect(
        (toolsByName.get(toolName)?.inputSchema.properties as Record<string, unknown>)
          .detail,
      ).toBeUndefined();
    }
  });

  it("exposes read-only feature branch delivery plan and report tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, featureProjectConfig());

    const plan = toolJson(
      await callDevNexusMcpTool("publication_feature_plan", {
        projectRoot,
        componentId: "primary",
      }),
    );
    const report = toolJson(
      await callDevNexusMcpTool(
        "publication_feature_report",
        {
          projectRoot,
          componentId: "primary",
          providerEvidence: [
            {
              provider: "github",
              sourceKind: "pull_request",
              reviewTarget: 243,
              headBranch: "feat/codex-goals",
              targetBranch: "main",
              intendedCiTier: "remote_smoke",
              reviewState: "waiting_for_approval",
              mergeability: "mergeable",
              branchPolicy: "blocked",
              baseStatus: "current",
              metadata: {
                draft: true,
              },
              checks: [
                { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
              ],
            },
          ],
        },
        { now: fixedClock("2026-05-22T21:10:00.000Z") },
      ),
    );
    const finalization = toolJson(
      await callDevNexusMcpTool(
        "publication_feature_finalization",
        {
          projectRoot,
          componentId: "primary",
          providerEvidence: [
            {
              provider: "github",
              sourceKind: "pull_request",
              reviewTarget: 243,
              headBranch: "feat/codex-goals",
              targetBranch: "main",
              intendedCiTier: "remote_smoke",
              reviewState: "waiting_for_approval",
              mergeability: "mergeable",
              branchPolicy: "blocked",
              baseStatus: "current",
              metadata: {
                draft: true,
              },
              checks: [
                { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
              ],
            },
          ],
        },
        { now: fixedClock("2026-05-22T21:10:00.000Z") },
      ),
    );

    expect(plan).toMatchObject({
      ok: true,
      plan: {
        mutatesSource: false,
        itemCount: 1,
        items: [
          {
            componentId: "primary",
            feature: {
              activeScopeId: "codex-goals",
              defaultBranchStrategy: "hybrid",
              branchPlan: {
                featureBranch: "feat/codex-goals",
                finalPublicationTarget: "main",
              },
            },
          },
        ],
      },
    });
    expect(report).toMatchObject({
      ok: true,
      report: {
        generatedAt: "2026-05-22T21:10:00.000Z",
        mutatesSource: false,
        nextAction: "request_review",
        summary: {
          itemCount: 1,
          reviewNeededCount: 1,
        },
        items: [
          {
            componentId: "primary",
            status: "review_needed",
            nextAction: "request_review",
            providerEvidence: {
              branchPolicy: "blocked",
              draft: true,
            },
          },
        ],
      },
    });
    expect(finalization).toMatchObject({
      ok: true,
      plan: {
        nextAction: "request_review",
        summary: {
          safeToReviewCount: 1,
          needsReviewCount: 1,
        },
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

  it("dry-runs publication review handoffs through configured App credentials", async () => {
    const { projectRoot, homePath, sourceRoot } = createMcpPublicationProject();
    const commandRuns: Array<{ command: string; args: string[] }> = [];

    const result = toolJson(
      await callDevNexusMcpTool(
        "publication_review_handoff",
        {
          projectRoot,
          componentId: "primary",
          repositoryPath: sourceRoot,
          branch: "codex/dev-nexus/mcp-publication-facade",
          title: "Expose publication facade through MCP",
          body: "Use the configured App identity.",
          dryRun: true,
        },
        {
          publicationCredentialCommandRunner: (command, args) => {
            commandRuns.push({ command, args });
            return {
              status: 0,
              stdout: "installation-token",
              stderr: "",
            };
          },
        },
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      componentId: "primary",
      repository: {
        owner: "Evref-BL",
        name: "DevNexus",
      },
      branchPush: {
        ok: true,
        dryRun: true,
        credential: {
          profileId: "dev-nexus-app",
          kind: "github_app",
        },
        push: {
          git: {
            exitCode: null,
            stderr: "dry-run: git push was not executed",
          },
          plan: {
            transport: "https_token",
            remote: "https://github.com/Evref-BL/DevNexus.git",
            refspec: "codex/dev-nexus/mcp-publication-facade",
          },
        },
      },
      pullRequest: {
        ok: true,
        dryRun: true,
        pullRequest: null,
        plan: {
          head: "codex/dev-nexus/mcp-publication-facade",
          base: "main",
          title: "Expose publication facade through MCP",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("installation-token");
    expect(commandRuns).toEqual([
      {
        command: path.join(homePath, "secrets/github-app-token.mjs"),
        args: ["--format", "token"],
      },
      {
        command: path.join(homePath, "secrets/github-app-token.mjs"),
        args: ["--format", "token"],
      },
    ]);
  });

  it("verifies publication actors through MCP before provider mutations", async () => {
    const { projectRoot, homePath } = createMcpPublicationProject();
    const commandRuns: Array<{ command: string; args: string[] }> = [];

    const result = toolJson(
      await callDevNexusMcpTool(
        "publication_actor_verify",
        {
          projectRoot,
          componentId: "primary",
        },
        {
          publicationCredentialCommandRunner: (command, args) => {
            commandRuns.push({ command, args });
            return {
              status: 0,
              stdout: "installation-token",
              stderr: "",
            };
          },
        },
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      componentId: "primary",
      credential: {
        profileId: "dev-nexus-app",
        kind: "github_app",
      },
      actor: {
        expected: {
          handle: "devnexus-automation",
          kind: "app",
        },
        observed: {
          handle: "devnexus-automation",
          source: "credential:dev-nexus-app",
        },
        matched: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("installation-token");
    expect(commandRuns).toEqual([
      {
        command: path.join(homePath, "secrets/github-app-token.mjs"),
        args: ["--format", "token"],
      },
    ]);
  });

  it("upserts publication pull requests through MCP with configured App API credentials", async () => {
    const { projectRoot, homePath, sourceRoot } = createMcpPublicationProject();
    const commandRuns: Array<{ command: string; args: string[] }> = [];
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];

    const result = toolJson(
      await callDevNexusMcpTool(
        "publication_pull_request_upsert",
        {
          projectRoot,
          componentId: "primary",
          repositoryPath: sourceRoot,
          head: "codex/dev-nexus/mcp-publication-facade",
          title: "Expose publication facade through MCP",
          body: "Use the configured App identity.",
          draft: true,
        },
        {
          publicationCredentialCommandRunner: (command, args) => {
            commandRuns.push({ command, args });
            return {
              status: 0,
              stdout: "installation-token",
              stderr: "",
            };
          },
          publicationFetch: (async (input, init = {}) => {
            requests.push({
              url: String(input),
              authorization:
                ((init.headers as Record<string, string> | undefined)
                  ?.Authorization ?? null),
              body: init.body ? JSON.parse(String(init.body)) : null,
            });
            return new Response(
              JSON.stringify({
                number: 311,
                html_url: "https://github.com/Evref-BL/DevNexus/pull/311",
                state: "open",
                title: "Expose publication facade through MCP",
              }),
              { status: 201 },
            );
          }) as typeof fetch,
        },
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      credential: {
        profileId: "dev-nexus-app",
        kind: "github_app",
      },
      plan: {
        operation: "create",
        head: "codex/dev-nexus/mcp-publication-facade",
        base: "main",
        title: "Expose publication facade through MCP",
        draft: true,
      },
      pullRequest: {
        number: 311,
        url: "https://github.com/Evref-BL/DevNexus/pull/311",
      },
    });
    expect(JSON.stringify(result)).not.toContain("installation-token");
    expect(commandRuns).toEqual([
      {
        command: path.join(homePath, "secrets/github-app-token.mjs"),
        args: ["--format", "token"],
      },
    ]);
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dev-nexus/mcp-publication-facade",
          base: "main",
          title: "Expose publication facade through MCP",
          body: "Use the configured App identity.",
          draft: true,
        },
      },
    ]);
  });

  it("exposes read-only review plans through MCP", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-review-plan-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "MCP Demo",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
            defaultBranch: "main",
            sourceRoot: "source",
            workTracking: {
              provider: "local",
            },
            review: {
              default: {
                transport: "pull_request",
                gates: ["provider_approval_required"],
              },
              rules: [
                {
                  match: {
                    paths: ["docs/**"],
                  },
                  transport: "local",
                  gates: ["human_required"],
                },
                {
                  match: {
                    branchRole: "feature_finalization",
                  },
                  transport: "pull_request",
                  gates: [
                    "provider_approval_required",
                    "ci_required",
                    "final_human_approval_required",
                  ],
                },
              ],
            },
            relationships: [],
          },
        ],
      }),
    );

    const localPlan = toolJson(
      await callDevNexusMcpTool("review_plan", {
        projectRoot,
        componentId: "primary",
        paths: ["docs/dev/review-policy.md"],
        requestedAction: "merge",
        branchName: "docs/review-policy",
        headSha: "abc123",
        localAuthorization: {
          authorized: true,
          authorizedAt: "2026-05-23T10:00:00Z",
          requestedAction: "merge",
          branchName: "docs/review-policy",
          headSha: "abc123",
        },
      }),
    );
    const providerPlan = toolJson(
      await callDevNexusMcpTool("review_plan", {
        projectRoot,
        componentId: "primary",
        branchRole: "feature_finalization",
        requestedAction: "merge",
        branchName: "feat/review-policy",
        headSha: "def456",
        localAuthorization: {
          authorized: true,
          requestedAction: "merge",
          branchName: "feat/review-policy",
          headSha: "def456",
        },
        providerEvidence: [
          {
            reviewState: "approved",
            checks: [
              { name: "Node 24 check (ubuntu-latest)", conclusion: "success" },
            ],
          },
        ],
      }),
    );

    expect(localPlan).toMatchObject({
      ok: true,
      plan: {
        componentId: "primary",
        status: "ready",
        transport: "local",
        matchedRuleIndex: 0,
        providerMutations: [],
      },
    });
    expect(providerPlan).toMatchObject({
      ok: true,
      plan: {
        componentId: "primary",
        status: "ready",
        transport: "pull_request",
        matchedRuleIndex: 1,
        providerMutations: ["create_or_update_pull_request"],
      },
    });
  });

  it("defaults oversized status tools to compact summaries with full detail opt-in", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-14");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Compact surface task",
      status: "ready",
      labels: ["automation"],
      description: "Long description that should not appear in summary lists.",
    });
    await callDevNexusMcpTool(
      "target_cycle_record",
      {
        projectRoot,
        cycleId: "cycle-1",
        status: "completed",
        summary: "Target completed.",
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "completed",
            notes: "Detailed cycle note.",
          },
        ],
        notes: ["Detailed cycle-level note."],
      },
      { now: fixedClock("2026-05-16T10:00:00.000Z") },
    );
    await callDevNexusMcpTool(
      "coordination_handoff",
      {
        projectRoot,
        workItemId: "local-1",
        status: "ready",
        changedAreas: ["src/nexusMcpServer.ts"],
        decisions: ["Summaries are default."],
        currentPath: worktreePath,
      },
      {
        now: fixedClock("2026-05-16T10:00:00.000Z"),
        gitRunner: fakeGitRunner(worktreePath),
      },
    );

    const projectSummary = toolJson(
      await callDevNexusMcpTool("project_status", { project: projectRoot }),
    );
    const projectFull = toolJson(
      await callDevNexusMcpTool("project_status", {
        project: projectRoot,
        detail: "full",
      }),
    );
    expect(projectSummary).toMatchObject({
      detail: "summary",
      project: {
        componentCount: 1,
        workItemClaimAuthority: {
          backend: "optimistic_tracker",
          enabled: true,
          postgresConnectionProfileId: null,
        },
        components: [
          {
            id: "primary",
            workTrackerCount: 1,
          },
        ],
      },
    });
    expect(projectSummary.project.components[0].trackerDiscovery).toBeUndefined();
    expect(projectSummary.project.components[0].workTrackers).toBeUndefined();
    expect(
      projectSummary.project.components[0].workTrackingCapabilityReport,
    ).toBeUndefined();
    expect(projectFull.project.components[0].trackerDiscovery).toBeDefined();

    const automationSummary = toolJson(
      await callDevNexusMcpTool(
        "automation_status",
        { projectRoot },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    const automationFull = toolJson(
      await callDevNexusMcpTool(
        "automation_status",
        { projectRoot, detail: "full" },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    expect(automationSummary).toMatchObject({
      detail: "summary",
      status: "ready",
      project: {
        id: "mcp-demo",
      },
      eligibleWorkItemCount: 1,
      target: {
        id: "dogfood",
        stateMarkdownLength: null,
      },
    });
    expect(automationSummary.projectConfig).toBeUndefined();
    expect(automationSummary.automationConfig).toBeUndefined();
    expect(automationSummary.eligibleWorkItems[0].labels).toBeUndefined();
    expect(automationSummary.eligibleWorkItems[0].warningCount).toBe(0);
    expect(automationFull.projectConfig).toBeDefined();
    expect(automationFull.automationConfig).toBeDefined();

    const targetSummary = toolJson(
      await callDevNexusMcpTool(
        "target_report",
        { projectRoot },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    const targetFull = toolJson(
      await callDevNexusMcpTool(
        "target_report",
        { projectRoot, detail: "full" },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    expect(targetSummary).toMatchObject({
      detail: "summary",
      report: {
        status: "completed",
        workItemSummary: {
          uniqueReferenceCount: 1,
          uniqueReferences: [
            {
              id: "local-1",
              latestCycleStatus: "completed",
            },
          ],
        },
      },
    });
    expect(targetSummary.report.target.stateMarkdown).toBeUndefined();
    expect(targetSummary.report.authority.summary).toBeUndefined();
    expect(targetFull.report.workItemSummary.uniqueReferences[0].notes).toBe(
      "Detailed cycle note.",
    );

    const coordinationSummary = toolJson(
      await callDevNexusMcpTool(
        "coordination_status",
        {
          projectRoot,
          workItemId: "local-1",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );
    const coordinationFull = toolJson(
      await callDevNexusMcpTool(
        "coordination_status",
        {
          projectRoot,
          workItemId: "local-1",
          currentPath: worktreePath,
          detail: "full",
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );
    expect(coordinationSummary).toMatchObject({
      detail: "summary",
      status: {
        leases: {
          totalCount: expect.any(Number),
        },
        handoffs: {
          totalCount: 1,
          records: [
            {
              status: "ready",
              stale: false,
            },
          ],
        },
      },
    });
    expect(coordinationSummary.status.leases.records[0]?.git).toBeUndefined();
    expect(coordinationSummary.status.handoffs.records[0]?.decisions).toBeUndefined();
    expect(coordinationSummary.status.handoffs.records[0]?.decisionCount).toBe(1);
    expect(coordinationSummary.status.git.warnings).toBeUndefined();
    expect(coordinationFull.status.leases.records[0]?.git).toBeDefined();

    for (const payload of [
      projectSummary,
      automationSummary,
      targetSummary,
      coordinationSummary,
    ]) {
      expect(JSON.stringify(payload).length).toBeLessThan(20000);
    }
  });

  it("warns when the MCP server started before the project DevNexus source head", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-runtime-stale-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner: GitRunner = (args, cwd): GitCommandResult => {
      const joined = args.join(" ");
      if (cwd === sourceRoot && joined === "rev-parse --verify HEAD") {
        return ok([...args], "newer-source-head\n");
      }
      if (cwd === sourceRoot && joined === "log -1 --format=%cI HEAD") {
        return ok([...args], "2026-05-16T10:00:00+00:00\n");
      }

      return ok([...args], "");
    };

    const targetReport = toolJson(
      await callDevNexusMcpTool(
        "target_report",
        { projectRoot },
        {
          now: fixedClock("2026-05-16T10:05:00.000Z"),
          gitRunner,
          mcpRuntimeStartedAt: "2026-05-16T09:00:00.000Z",
        },
      ),
    );

    expect(targetReport.mcpRuntime).toMatchObject({
      serverName: "dev-nexus",
      stale: true,
      warningCount: 1,
      source: {
        componentId: "primary",
        sourceRoot,
        headCommit: "newer-source-head",
        headCommitDate: "2026-05-16T10:00:00.000Z",
      },
    });
    expect(targetReport.mcpRuntime.warnings[0]).toContain(
      "started before primary source HEAD",
    );
  });

  it("rejects invalid detail values on compactable MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    saveProjectConfig(projectRoot, projectConfig());

    const response = await callDevNexusMcpTool("project_status", {
      project: projectRoot,
      detail: "everything",
    });

    expect(response.isError).toBe(true);
    expect(toolJson(response)).toMatchObject({
      ok: false,
      error: "arguments.detail must be summary or full",
    });
  });

  it("loads default-home auth profiles for path-selected project status", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const homePath = makeTempDir("dev-nexus-home-");
    const previousHome = process.env.DEV_NEXUS_HOME;
    saveHomeConfig(homePath, [
      {
        id: "dev-nexus-app",
        actorId: "dev-nexus-automation-app",
        provider: "github",
        kind: "app",
        account: "devnexus-automation",
      },
    ]);
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...defaultNexusAutomationConfig,
          publication: {
            ...defaultNexusAutomationConfig.publication,
            actor: {
              id: "dev-nexus-automation-app",
              kind: "app",
              provider: "github",
              handle: "devnexus-automation",
            },
          },
        },
        authority: {
          actors: [
            {
              id: "dev-nexus-automation-app",
              kind: "service_account",
              provider: "github",
              providerIdentity: "devnexus-automation",
              displayName: "DevNexus Automation",
            },
          ],
          roleBindings: [
            {
              actorId: "dev-nexus-automation-app",
              roles: ["maintainer"],
              scope: { project: "mcp-demo" },
            },
          ],
        },
      }),
    );

    try {
      process.env.DEV_NEXUS_HOME = homePath;
      const result = toolJson(
        await callDevNexusMcpTool("project_status", {
          project: projectRoot,
        }),
      );

      expect(result.project.authority.problemComponents[0].actor).toMatchObject({
        status: "matched",
        actorId: "dev-nexus-automation-app",
        handle: "devnexus-automation",
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.DEV_NEXUS_HOME;
      } else {
        process.env.DEV_NEXUS_HOME = previousHome;
      }
    }
  });

  it("returns project hosting status and plan through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-hosting-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosting: {
          provider: "github",
          namespace: "ExampleOrg",
          repository: {
            name: "mcp-demo",
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
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
      if (argsArray.join(" ") === "remote -v") {
        return ok(
          argsArray,
          "origin\tgit@github.com:WrongOrg/mcp-demo.git (fetch)\n" +
            "origin\tgit@github.com:WrongOrg/mcp-demo.git (push)\n",
        );
      }

      return ok(argsArray, "");
    };

    const status = toolJson(
      await callDevNexusMcpTool(
        "project_hosting_status",
        { projectRoot },
        { gitRunner },
      ),
    );
    expect(status.status.remotes).toMatchObject([
      {
        name: "origin",
        status: "mismatch",
        expectedUrl: "git@github.com:ExampleOrg/mcp-demo.git",
      },
    ]);

    const plan = toolJson(
      await callDevNexusMcpTool(
        "project_hosting_plan",
        { projectRoot },
        { gitRunner },
      ),
    );
    expect(plan.plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "update_local_remote",
          disposition: "allowed",
        }),
      ]),
    );
  });

  it("applies project hosting local remote repairs through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-hosting-apply-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        hosting: {
          provider: "github",
          namespace: "ExampleOrg",
          repository: {
            name: "mcp-demo",
            visibility: "private",
            defaultBranch: "main",
          },
          remotes: [
            {
              name: "origin",
              role: "human",
              protocol: "ssh",
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
      ["origin", "git@github.com:WrongOrg/mcp-demo.git"],
    ]);
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
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
      }
      return ok(argsArray, "");
    };

    const result = toolJson(
      await callDevNexusMcpTool(
        "project_hosting_apply",
        { projectRoot },
        { gitRunner },
      ),
    );

    expect(result.apply).toMatchObject({
      ok: true,
      status: "passed",
      actions: [
        expect.objectContaining({
          actionId: "remote:origin:update",
          disposition: "applied",
        }),
      ],
    });
    expect(remotes.get("origin")).toBe(
      "git@github.com:ExampleOrg/mcp-demo.git",
    );
    expect(result.apply.finalPlan.actions).toEqual([]);
  });

  it("applies project hosting repository creation through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-hosting-create-");
    const homePath = makeTempDir("dev-nexus-mcp-hosting-create-home-");
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
            name: "mcp-demo",
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
              name: "mcp-demo",
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
          webUrl: "https://github.com/ExampleOrg/mcp-demo",
          remoteUrl: "git@github.com-bot:ExampleOrg/mcp-demo.git",
        };
      },
    };

    const result = toolJson(
      await callDevNexusMcpTool(
        "project_hosting_apply",
        { projectRoot, homePath },
        { hostingProvider },
      ),
    );

    expect(result.apply).toMatchObject({
      ok: true,
      status: "passed",
      actions: [
        {
          actionId: "repository:create",
          disposition: "applied",
          providerResult: {
            status: "created",
            webUrl: "https://github.com/ExampleOrg/mcp-demo",
            remoteUrl: "git@github.com-bot:ExampleOrg/mcp-demo.git",
          },
        },
      ],
      finalPlan: {
        actions: [],
      },
    });
  });

  it("returns guard details for guarded shared-checkout MCP mutations", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const result = await callDevNexusMcpTool(
      "work_item_set_status",
      {
        projectRoot,
        id: "local-1",
        status: "done",
      },
      {
        gitRunner: fakeGitRunner(projectRoot),
        sharedCheckoutGuard: "enforce",
      },
    );
    const payload = toolJson(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      ok: false,
      guard: {
        ok: false,
        classification: "shared_project_checkout",
        mutationClass: "local_tracker",
      },
    });
    expect(fs.existsSync(defaultLocalWorkTrackingStorePath(projectRoot))).toBe(false);
  });

  it("allows guarded provider-backed MCP work-item mutations from shared checkouts", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, githubClaimProjectConfig());
    const requests: Array<{
      method: string;
      url: string;
      body: Record<string, unknown> | null;
    }> = [];
    const githubFetch = (async (input, init = {}) => {
      const request = {
        method: init.method ?? "GET",
        url: String(input),
        body: init.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : null,
      };
      requests.push(request);

      if (
        request.method === "POST" &&
        request.url === "https://api.github.com/repos/example/demo/issues/7/comments"
      ) {
        return jsonResponse({
          id: 101,
          body: "Provider-backed comment.",
          html_url: "https://github.com/example/demo/issues/7#issuecomment-101",
        });
      }

      if (
        request.method === "GET" &&
        request.url === "https://api.github.com/repos/example/demo/issues/7"
      ) {
        return jsonResponse(githubIssueResponse({
          number: 7,
          title: "Provider-backed issue",
          state: "open",
          labels: ["ready"],
        }));
      }

      if (
        request.method === "PATCH" &&
        request.url === "https://api.github.com/repos/example/demo/issues/7"
      ) {
        return jsonResponse(githubIssueResponse({
          number: 7,
          title: String(request.body?.title ?? "Provider-backed issue"),
          state: String(request.body?.state ?? "open"),
          labels: request.body?.labels as string[] | undefined,
        }));
      }

      return jsonResponse(
        { message: `unexpected ${request.method} ${request.url}` },
        500,
      );
    }) as typeof fetch;

    const context = {
      gitRunner: fakeGitRunner(projectRoot),
      sharedCheckoutGuard: "enforce" as const,
      workItemProviderOptions: {
        github: {
          credentialRunner: false,
          fetch: githubFetch,
        },
      },
    };

    const comment = toolJson(
      await callDevNexusMcpTool(
        "work_item_comment",
        {
          projectRoot,
          componentId: "core",
          trackerId: "github",
          id: "github-7",
          body: "Provider-backed comment.",
        },
        context,
      ),
    );
    const updated = toolJson(
      await callDevNexusMcpTool(
        "work_item_update",
        {
          projectRoot,
          componentId: "core",
          trackerId: "github",
          id: "github-7",
          title: "Provider-backed issue renamed",
        },
        context,
      ),
    );
    const closed = toolJson(
      await callDevNexusMcpTool(
        "work_item_set_status",
        {
          projectRoot,
          componentId: "core",
          trackerId: "github",
          id: "github-7",
          status: "done",
        },
        context,
      ),
    );

    expect(comment.comment).toMatchObject({
      id: "github-comment-101",
      body: "Provider-backed comment.",
    });
    expect(updated.workItem).toMatchObject({
      id: "github-7",
      title: "Provider-backed issue renamed",
    });
    expect(closed.workItem).toMatchObject({
      id: "github-7",
      status: "done",
    });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://api.github.com/repos/example/demo/issues/7/comments",
      "PATCH https://api.github.com/repos/example/demo/issues/7",
      "GET https://api.github.com/repos/example/demo/issues/7",
      "PATCH https://api.github.com/repos/example/demo/issues/7",
    ]);
  });

  it("allows guarded work-item comments from generated workspace-meta worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const generatedMetaWorktree = path.join(
      projectRoot,
      "worktrees",
      "mcp-demo",
      "comment-meta",
    );
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(generatedMetaWorktree, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-20T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Comment from meta worktree",
      status: "in_progress",
    });

    const result = await callDevNexusMcpTool(
      "work_item_comment",
      {
        projectRoot,
        id: "local-1",
        body: "Ready for review.",
        currentPath: generatedMetaWorktree,
      },
      {
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        gitRunner: fakeGitRunner(generatedMetaWorktree),
        sharedCheckoutGuard: "enforce",
      },
    );
    const payload = toolJson(result);

    expect(result.isError).not.toBe(true);
    expect(payload.comment).toMatchObject({
      id: "local-comment-1",
      body: "Ready for review.",
    });
  });

  it("returns guard details for guarded inbound import execution", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const generatedMetaWorktree = path.join(
      projectRoot,
      "worktrees",
      "mcp-demo",
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

    const result = await callDevNexusMcpTool(
      "work_item_import_execute",
      {
        projectRoot,
        sourceTrackerId: "github",
        targetTrackerId: "local",
        direction: "external_to_local",
        writePolicy: {
          mode: "execute",
          credentials: "available",
        },
      },
      {
        gitRunner,
        sharedCheckoutGuard: "enforce",
        currentPath: generatedMetaWorktree,
      },
    );
    const payload = toolJson(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      ok: false,
      guard: {
        ok: false,
        classification: "shared_project_checkout",
        mutationClass: "local_tracker",
      },
    });
    expect(fs.existsSync(defaultLocalWorkTrackingStorePath(projectRoot))).toBe(false);
  });

  it("allows guarded coordination handoffs from generated workspace-meta worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const generatedMetaWorktree = path.join(
      projectRoot,
      "worktrees",
      "mcp-demo",
      "coordination-meta",
    );
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(generatedMetaWorktree, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-20T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate from meta worktree",
      status: "in_progress",
    });

    const result = await callDevNexusMcpTool(
      "coordination_handoff",
      {
        projectRoot,
        workItemId: "local-1",
        status: "ready",
        changedAreas: ["src/nexusMcpServer.ts"],
        verificationSummary: "focused tests passed",
        currentPath: generatedMetaWorktree,
      },
      {
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        gitRunner: fakeGitRunner(generatedMetaWorktree),
        sharedCheckoutGuard: "enforce",
      },
    );
    const payload = toolJson(result);

    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      ok: true,
      record: {
        status: "ready",
        workItemId: "local-1",
        branch: "codex/shared-coordination",
      },
      comment: {
        id: "local-comment-1",
      },
    });
  });

  it("classifies guarded coordination handoff currentPath component worktrees", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const componentWorktree = path.join(
      projectRoot,
      "worktrees",
      "primary",
      "component-handoff",
    );
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(componentWorktree, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-20T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate from component worktree",
      status: "in_progress",
    });

    const result = await callDevNexusMcpTool(
      "coordination_handoff",
      {
        projectRoot,
        workItemId: "local-1",
        status: "ready",
        changedAreas: ["src/nexusMcpServer.ts"],
        currentPath: componentWorktree,
      },
      {
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        gitRunner: fakeGitRunner(componentWorktree),
        sharedCheckoutGuard: "enforce",
      },
    );
    const payload = toolJson(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      ok: false,
      guard: {
        ok: false,
        classification: "generated_component_worktree",
        mutationClass: "coordination_record",
        targetPath: componentWorktree,
        recoveryAction: {
          kind: "prepare_workspace_meta_worktree",
          mcpTool: {
            name: "worktree_prepare",
            arguments: {
              projectRoot,
              projectMeta: true,
            },
          },
        },
      },
    });
    expect(payload.guard.saferNextAction).toContain(
      "coordination_record requires a workspace/meta worktree",
    );
  });

  it("lists provider-compatible tool input schemas", () => {
    const issues = listDevNexusMcpTools().flatMap((tool) =>
      listMcpInputSchemaProviderIssues(tool.inputSchema).map((issue) => ({
        tool: tool.name,
        ...issue,
      })),
    );

    expect(issues).toEqual([]);
  });

  it("prepares workspace-meta worktrees through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-worktree-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner: GitRunner = (args, cwd) => {
      const argsArray = [...args];
      gitCalls.push({ args: argsArray, cwd });
      if (argsArray[0] === "worktree" && argsArray[1] === "add") {
        fs.mkdirSync(argsArray[4]!, { recursive: true });
      }
      if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
        return ok(argsArray, path.join(cwd ?? "", ".git", "info", "exclude"));
      }
      return ok(argsArray, "");
    };

    const prepared = toolJson(
      await callDevNexusMcpTool(
        "worktree_prepare",
        {
          projectRoot,
          projectMeta: true,
          topic: "parallel chat",
          worktreeName: "parallel-chat",
        },
        {
          gitRunner,
          now: fixedClock("2026-05-17T08:00:00.000Z"),
        },
      ),
    );

    expect(prepared).toMatchObject({
      ok: true,
      scope: "project",
      component: null,
      worktree: {
        componentId: "mcp-demo",
        branchName: "codex/mcp-demo/parallel-chat",
        baseRef: "main",
      },
    });
    expect(prepared.worktree.worktreePath).toBe(
      path.join(projectRoot, "worktrees", "mcp-demo", "parallel-chat"),
    );
    expect(prepared.setup.context.contextJsonPath).toBe(
      path.join(
        projectRoot,
        "worktrees",
        "mcp-demo",
        "parallel-chat",
        ".dev-nexus",
        "context",
        "context.json",
      ),
    );
    expect(prepared.setup.context.context).toBeUndefined();
    expect(prepared.setup.context.briefingMarkdown).toBeUndefined();
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/mcp-demo/parallel-chat",
        path.join(projectRoot, "worktrees", "mcp-demo", "parallel-chat"),
        "main",
      ],
      cwd: projectRoot,
    });
  });

  it("prepares component worktrees from component-qualified MCP work item ids with metadata", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-worktree-");
    const primarySourceRoot = path.join(projectRoot, "source");
    const addonSourceRoot = path.join(projectRoot, "components", "addon");
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    fs.mkdirSync(primarySourceRoot, { recursive: true });
    fs.mkdirSync(addonSourceRoot, { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "Primary",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
            defaultBranch: "main",
            sourceRoot: "source",
            worktreesRoot: "worktrees/primary",
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
            remoteUrl: "git@example.invalid:mcp/addon.git",
            defaultBranch: "main",
            sourceRoot: "components/addon",
            worktreesRoot: "worktrees/addon",
            workTracking: {
              provider: "local",
              storePath: addonStorePath,
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
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Prepare addon worker",
      description: "Carry this description into worker context.",
      status: "ready",
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner: GitRunner = (args, cwd) => {
      const argsArray = [...args];
      gitCalls.push({ args: argsArray, cwd });
      if (argsArray[0] === "worktree" && argsArray[1] === "add") {
        fs.mkdirSync(argsArray[4]!, { recursive: true });
      }
      if (argsArray[0] === "rev-parse" && argsArray[1] === "--git-path") {
        return ok(argsArray, path.join(cwd ?? "", ".git", "info", "exclude"));
      }
      return ok(argsArray, "");
    };

    const prepared = toolJson(
      await callDevNexusMcpTool(
        "worktree_prepare",
        {
          projectRoot,
          workItemId: "addon:local-1",
          workerAgentProvider: "codex",
        },
        {
          gitRunner,
          now: fixedClock("2026-05-17T08:00:00.000Z"),
        },
      ),
    );

    expect(prepared).toMatchObject({
      ok: true,
      scope: "component",
      component: {
        id: "addon",
      },
      worktree: {
        componentId: "addon",
        branchName: "codex/addon/local-1",
        baseRef: "main",
        workItem: {
          id: "local-1",
          title: "Prepare addon worker",
        },
      },
    });
    expect(prepared.worktree.worktreePath).toBe(
      path.join(projectRoot, "worktrees", "addon", "codex-addon-local-1"),
    );
    expect(prepared.component).toMatchObject({
      id: "addon",
      name: "Addon",
      role: "addon",
      sourceRoot: addonSourceRoot,
    });
    expect(prepared.component.workTrackers).toBeUndefined();
    expect(prepared.setup.context.contextJsonPath).toBe(
      nexusWorkerContextJsonPath(prepared.worktree.worktreePath),
    );
    expect(prepared.setup.context.context).toBeUndefined();
    expect(prepared.setup.context.briefingMarkdown).toBeUndefined();
    const context = JSON.parse(
      fs.readFileSync(
        nexusWorkerContextJsonPath(prepared.worktree.worktreePath),
        "utf8",
      ),
    );
    expect(context.worktree.workItem).toMatchObject({
      id: "local-1",
      title: "Prepare addon worker",
      description: "Carry this description into worker context.",
    });
    expect(context.agentTargetPolicy).toMatchObject({
      activeProviders: ["codex"],
      assignedProvider: "codex",
    });
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/addon/local-1",
        path.join(projectRoot, "worktrees", "addon", "codex-addon-local-1"),
        "main",
      ],
      cwd: addonSourceRoot,
    });
  });

  it("blocks MCP worktree preparation when an agent-launch authority claim is stale", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-worktree-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = mcpAuthorityClaim();
    const contextFile = writeMcpAgentContext(projectRoot, authorityClaim);
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner: GitRunner = (args, cwd) => {
      const argsArray = [...args];
      gitCalls.push({ args: argsArray, cwd });
      return ok(argsArray, "");
    };
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async verifyClaim() {
        return {
          status: "released",
          claim: authorityClaim,
        };
      },
    };
    const previousAutomationMode = process.env.DEV_NEXUS_AUTOMATION_MODE;
    const previousClaimStatus = process.env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS;
    const previousContextFile = process.env.DEV_NEXUS_AGENT_CONTEXT_FILE;
    try {
      process.env.DEV_NEXUS_AUTOMATION_MODE = "agent_launch";
      process.env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS = "claimed";
      process.env.DEV_NEXUS_AGENT_CONTEXT_FILE = contextFile;
      const result = await callDevNexusMcpTool(
        "worktree_prepare",
        {
          projectRoot,
          workItemId: "local-1",
          workItemTitle: "Claimed issue",
        },
        {
          gitRunner,
          workItemClaimAuthority: claimAuthority,
          now: fixedClock("2026-05-23T10:00:00.000Z"),
        },
      );

      expect(result.isError).toBe(true);
      expect(toolJson(result)).toMatchObject({
        ok: false,
        error: "DevNexus claim verification failed before mutation: released",
      });
      expect(gitCalls).toEqual([]);
    } finally {
      restoreOptionalEnv("DEV_NEXUS_AUTOMATION_MODE", previousAutomationMode);
      restoreOptionalEnv("DEV_NEXUS_WORK_ITEM_CLAIM_STATUS", previousClaimStatus);
      restoreOptionalEnv("DEV_NEXUS_AGENT_CONTEXT_FILE", previousContextFile);
    }
  });

  it("builds guided setup plans through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-setup-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        id: "mac-demo",
        name: "Mac Demo",
        repo: {
          kind: "git",
          remoteUrl: "git@github.com-bot:ExampleOrg/mac-demo.git",
          defaultBranch: "main",
        },
      }),
    );

    const listed = toolJson(await callDevNexusMcpTool("setup_flow_list", {}));
    const planned = toolJson(
      await callDevNexusMcpTool("setup_plan", {
        projectRoot,
        flowId: "join-existing-project",
        platform: "macos",
      }),
    );

    expect(listed.flows).toContainEqual(
      expect.objectContaining({
        id: "join-existing-project",
      }),
    );
    expect(planned).toMatchObject({
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
    expect(planned.plan.steps.map((step: { id: string }) => step.id)).toContain(
      "configure-automation-auth-profile",
    );
  });

  it("adopts and records current-agent runs through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: {
        ...projectConfig().automation!,
        agent: {
          ...projectConfig().automation!.agent,
          maxConcurrentSubagents: 2,
        },
      },
    });
    saveProjectConfig(projectRoot, config);
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "MCP adoptable task",
      status: "ready",
      labels: ["automation"],
    });

    const adopted = toolJson(
      await callDevNexusMcpTool(
        "current_agent_adopt",
        {
          projectRoot,
          runId: "mcp-current-1",
          owner: "mcp-host",
        },
        { now: fixedClock("2026-05-17T10:00:00.000Z") },
      ),
    );

    expect(adopted).toMatchObject({
      ok: true,
      status: "started",
      shouldProceed: true,
      environment: {
        DEV_NEXUS_CURRENT_AGENT_ADOPTION: "true",
        DEV_NEXUS_RUN_ID: "mcp-current-1",
        DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS: "2",
      },
      result: {
        statuses: ["completed", "failed", "blocked", "skipped"],
      },
    });

    const recorded = toolJson(
      await callDevNexusMcpTool(
        "current_agent_record",
        {
          projectRoot,
          runId: "mcp-current-1",
          result: {
            status: "completed",
            summary: "MCP current agent completed",
            commitIds: ["abc123"],
            verification: [
              {
                command: "npm test",
                status: "passed",
                summary: "focused tests passed",
              },
            ],
          },
        },
        { now: fixedClock("2026-05-17T10:10:00.000Z") },
      ),
    );

    expect(recorded).toMatchObject({
      ok: true,
      status: "completed",
      result: {
        commitIds: ["abc123"],
      },
    });
    expect(
      readNexusAutomationRunLedger(projectRoot, config.automation!).runs.at(-1),
    ).toMatchObject({
      id: "mcp-current-1",
      status: "completed",
      commitIds: ["abc123"],
    });
  });

  it("blocks completed MCP current-agent records when an authority claim is stale", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = mcpAuthorityClaim();
    const contextFile = writeMcpAgentContext(projectRoot, authorityClaim);
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async verifyClaim() {
        return {
          status: "expired",
          claim: authorityClaim,
        };
      },
    };
    const previousAutomationMode = process.env.DEV_NEXUS_AUTOMATION_MODE;
    const previousClaimStatus = process.env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS;
    const previousContextFile = process.env.DEV_NEXUS_AGENT_CONTEXT_FILE;
    try {
      process.env.DEV_NEXUS_AUTOMATION_MODE = "agent_launch";
      process.env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS = "claimed";
      process.env.DEV_NEXUS_AGENT_CONTEXT_FILE = contextFile;
      const result = await callDevNexusMcpTool(
        "current_agent_record",
        {
          projectRoot,
          runId: "mcp-current-stale",
          result: {
            status: "completed",
            summary: "Stale worker should not complete",
          },
        },
        {
          workItemClaimAuthority: claimAuthority,
          now: fixedClock("2026-05-23T10:00:00.000Z"),
        },
      );

      expect(result.isError).toBe(true);
      expect(toolJson(result)).toMatchObject({
        ok: false,
        error: "DevNexus claim verification failed before mutation: expired",
      });
    } finally {
      restoreOptionalEnv("DEV_NEXUS_AUTOMATION_MODE", previousAutomationMode);
      restoreOptionalEnv("DEV_NEXUS_WORK_ITEM_CLAIM_STATUS", previousClaimStatus);
      restoreOptionalEnv("DEV_NEXUS_AGENT_CONTEXT_FILE", previousContextFile);
    }
  });

  it("heartbeats current-agent authority claims through MCP", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const authorityClaim = mcpAuthorityClaim();
    const heartbeatClaim: NexusWorkItemClaimAuthorityRecord = {
      ...authorityClaim,
      expiresAt: "2026-05-23T11:00:00.000Z",
      lastHeartbeatAt: "2026-05-23T10:00:00.000Z",
      owner: {
        ...authorityClaim.owner,
        expiresAt: "2026-05-23T11:00:00.000Z",
      },
    };
    const contextFile = writeMcpAgentContext(projectRoot, authorityClaim);
    const heartbeats: number[] = [];
    const claimAuthority: NexusWorkItemClaimAuthority = {
      kind: "test-authority",
      async claimCandidate() {
        throw new Error("claimCandidate should not run");
      },
      async heartbeatClaim(input) {
        heartbeats.push(input.leaseDurationMs);
        return {
          status: "heartbeat",
          claim: heartbeatClaim,
        };
      },
    };
    const previousAutomationMode = process.env.DEV_NEXUS_AUTOMATION_MODE;
    const previousClaimStatus = process.env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS;
    const previousContextFile = process.env.DEV_NEXUS_AGENT_CONTEXT_FILE;
    try {
      process.env.DEV_NEXUS_AUTOMATION_MODE = "agent_launch";
      process.env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS = "claimed";
      process.env.DEV_NEXUS_AGENT_CONTEXT_FILE = contextFile;
      const result = toolJson(
        await callDevNexusMcpTool(
          "current_agent_heartbeat",
          {
            projectRoot,
            leaseDurationMs: 1800000,
          },
          {
            workItemClaimAuthority: claimAuthority,
            now: fixedClock("2026-05-23T10:00:00.000Z"),
          },
        ),
      );

      expect(result).toMatchObject({
        ok: true,
        status: "heartbeat",
        authorityClaim: {
          expiresAt: "2026-05-23T11:00:00.000Z",
          lastHeartbeatAt: "2026-05-23T10:00:00.000Z",
        },
      });
      expect(heartbeats).toEqual([1800000]);
    } finally {
      restoreOptionalEnv("DEV_NEXUS_AUTOMATION_MODE", previousAutomationMode);
      restoreOptionalEnv("DEV_NEXUS_WORK_ITEM_CLAIM_STATUS", previousClaimStatus);
      restoreOptionalEnv("DEV_NEXUS_AGENT_CONTEXT_FILE", previousContextFile);
    }
  });

  it("reports generic plugin capabilities through the agent profile surface", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        plugins: [
          {
            id: "analysis-tools",
            capabilities: [
              {
                kind: "projected_skill",
                id: "deep-review-skill",
                skillId: "deep-review",
                description: "Project a review skill into configured agents.",
                targetAgents: ["codex"],
              },
              {
                kind: "environment_hint",
                id: "cache-dir",
                variable: "EXAMPLE_CACHE_DIR",
                description: "Optional cache directory used by plugin tools.",
              },
            ],
          },
        ],
      }),
    );

    const result = toolJson(
      await callDevNexusMcpTool("agent_profiles", { projectRoot }),
    );

    expect(result).toMatchObject({
      ok: true,
      pluginCapabilities: [
        {
          pluginId: "analysis-tools",
          capabilityCount: 2,
          capabilities: [
            {
              kind: "projected_skill",
              id: "deep-review-skill",
              skillId: "deep-review",
              targetAgents: ["codex"],
            },
            {
              kind: "environment_hint",
              id: "cache-dir",
              variable: "EXAMPLE_CACHE_DIR",
              required: false,
            },
          ],
        },
      ],
    });
  });

  it("reports codex app-server profiles through MCP without host-local values", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig({
        automation: {
          ...projectConfig().automation!,
          agent: {
            ...projectConfig().automation!.agent,
            profiles: [
              {
                id: "codex-app-server",
                executor: "codex",
                executorMode: "app_server",
                intendedUse: "subagent",
                model: null,
                reasoning: null,
                command: null,
                args: [],
                appServer: {
                  mode: "connect",
                  command: null,
                  args: [],
                  endpoint: "http://127.0.0.1:17655",
                  ephemeralThreadDefault: false,
                  localPolicy: {
                    hostLocalSafetyHints: ["connects_to_local_service"],
                  },
                },
              },
            ],
          },
        },
      }),
    );

    const response = await callDevNexusMcpTool("agent_profiles", { projectRoot });
    const rawOutput = response.content[0]!.text;
    const result = toolJson(response);

    expect(result.profiles).toEqual([
      expect.objectContaining({
        id: "codex-app-server",
        executorMode: "app_server",
        appServer: {
          mode: "connect",
          commandConfigured: false,
          argsCount: 0,
          endpointScope: "loopback",
          ephemeralThreadDefault: false,
          allowNonLoopbackEndpoint: false,
          hostLocalSafetyHints: ["connects_to_local_service"],
        },
      }),
    ]);
    expect(rawOutput).not.toContain("127.0.0.1:17655");
  });

  it("reports read-only work item discovery status through MCP", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    saveProjectConfig(
      projectRoot,
      projectConfig({
        components: [
          {
            id: "primary",
            name: "MCP Demo",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
                roles: ["eligible_source", "external_inbox"],
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

    const result = toolJson(
      await callDevNexusMcpTool("work_item_discovery_status", { projectRoot }),
    );

    expect(result).toMatchObject({
      ok: true,
      project: {
        id: "mcp-demo",
      },
      warnings: [expect.stringContaining("github-inbox skipped")],
      components: [
        {
          componentId: "primary",
          discoveryTrackerIds: ["local", "github-inbox"],
          configuredTrackers: [
            {
              id: "local",
              readable: {
                status: "readable",
              },
            },
            {
              id: "github-inbox",
              readable: {
                status: "skipped",
              },
            },
          ],
        },
      ],
    });
  });

  it("reports opt-in discovery eligible work through MCP", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
            name: "MCP Demo",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
      config: { provider: "local", storePath: inboxStorePath },
      now: fixedClock("2026-05-16T09:05:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Inbox task",
      status: "ready",
      labels: ["automation"],
    });

    const result = toolJson(
      await callDevNexusMcpTool(
        "eligible_work",
        {
          projectRoot,
          mode: "discovery",
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      mode: "discovery",
      eligibleWorkItemCount: 1,
      importCandidateWorkItemCount: 1,
      components: [
        {
          componentId: "primary",
          workItems: [
            {
              id: "local-1",
              canonicalTrackerRef: {
                trackerId: "primary",
              },
              sourceTrackerRef: {
                trackerId: "primary",
              },
              selectable: true,
            },
          ],
          importCandidateWorkItems: [
            {
              id: "local-1",
              canonicalTrackerRef: null,
              sourceTrackerRef: {
                trackerId: "inbox",
              },
              importOnly: true,
              selectable: false,
            },
          ],
        },
      ],
    });
  });

  it("records and reports coordination handoffs through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-14");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
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

    const handoff = toolJson(
      await callDevNexusMcpTool(
        "coordination_handoff",
        {
          projectRoot,
          workItemId: "local-1",
          status: "ready",
          hostId: "windows-devbox",
          agentId: "codex",
          changedAreas: ["src/nexusCoordination.ts"],
          decisions: ["Use advisory records."],
          verificationSummary: "focused tests passed",
          integrationPreference: "direct_integration",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:00:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );
    const status = toolJson(
      await callDevNexusMcpTool(
        "coordination_status",
        {
          projectRoot,
          workItemId: "local-1",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(handoff).toMatchObject({
      ok: true,
      record: {
        status: "ready",
        branch: "codex/shared-coordination",
        pushed: true,
      },
      comment: {
        id: "local-comment-1",
      },
    });
    expect(status).toMatchObject({
      ok: true,
      status: {
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

  it("reports provider-backed coordination handoffs as incomplete through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
                    id: "mcp/demo",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );

    const status = toolJson(
      await callDevNexusMcpTool(
        "coordination_status",
        {
          projectRoot,
          trackerRole: "coordination",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-18T08:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(status).toMatchObject({
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
  });

  it("records coordination requests through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-17");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-17T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Coordinate external review",
      status: "in_progress",
    });

    const request = toolJson(
      await callDevNexusMcpTool(
        "coordination_request",
        {
          projectRoot,
          workItemId: "local-1",
          intent: "approval",
          question: "Approve the mocked external request change?",
          target: "github-issue:22",
          responseStatus: "approved",
          responseSummary: "Approved by reviewer comment.",
          responder: "reviewer-a",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-17T10:00:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(request).toMatchObject({
      ok: true,
      record: {
        intent: "approval",
        status: "approved",
        target: {
          kind: "github_issue",
          provider: "github",
          value: "22",
        },
        provider: {
          provider: "github",
          surface: "issue",
          mode: "draft",
          posted: false,
          credentialsUsed: false,
        },
        response: {
          status: "approved",
          summary: "Approved by reviewer comment.",
        },
      },
      comment: {
        id: "local-comment-1",
      },
    });
  });

  it("returns coordination integration plan shape through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-15");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    await createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Plan coordination integration",
      status: "in_progress",
    });

    await callDevNexusMcpTool(
      "coordination_handoff",
      {
        projectRoot,
        workItemId: "local-1",
        status: "ready",
        changedAreas: ["src/nexusCoordination.ts"],
        decisions: ["Keep integration planning read-only."],
        currentPath: worktreePath,
      },
      {
        now: fixedClock("2026-05-16T10:00:00.000Z"),
        gitRunner: fakeGitRunner(worktreePath),
      },
    );
    const plan = toolJson(
      await callDevNexusMcpTool(
        "coordination_integrate",
        {
          projectRoot,
          workItemId: "local-1",
          targetBranch: "main",
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(plan).toMatchObject({
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
          },
        ],
      },
    });
  });

  it("returns coordination integration tracker diagnostics through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "local-61");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const storePath = defaultLocalWorkTrackingStorePath(projectRoot);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{ malformed local tracker store\n", "utf8");

    const result = toolJson(
      await callDevNexusMcpTool(
        "coordination_integrate",
        {
          projectRoot,
          currentPath: worktreePath,
        },
        {
          now: fixedClock("2026-05-16T10:15:00.000Z"),
          gitRunner: fakeGitRunner(worktreePath),
        },
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          kind: "coordination_tracker_read_failure",
          componentId: "primary",
          trackerId: "default",
          provider: "local",
          storePath: path.resolve(storePath),
          operation: "readCoordinationHandoffs",
          stage: "parse",
        },
      ],
    });
  });

  it("serves project, automation, and work-item calls without specialization adapters", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const projectStatus = toolJson(
      await callDevNexusMcpTool("project_status", {
        project: projectRoot,
      }),
    );
    expect(projectStatus).toMatchObject({
      ok: true,
      project: {
        id: "mcp-demo",
        projectRoot,
        components: [
          {
            id: "primary",
            workTracking: {
              provider: "local",
            },
          },
        ],
      },
    });
    expect(
      projectStatus.project.components[0].workTrackingCapabilities,
    ).toBeUndefined();

    const created = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          title: "Split the plan",
          description: "Write PRD",
          status: "ready",
          labels: ["automation"],
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    expect(created.workItem).toMatchObject({
      id: "local-1",
      title: "Split the plan",
      status: "ready",
    });
    await callDevNexusMcpTool(
      "work_item_create",
      {
        projectRoot,
        title: "Parked plan",
        status: "todo",
        labels: ["automation"],
      },
      { now: fixedClock("2026-05-16T10:01:00.000Z") },
    );

    const automationStatus = toolJson(
      await callDevNexusMcpTool(
        "automation_status",
        {
          projectRoot,
        },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    expect(automationStatus).toMatchObject({
      ok: true,
      status: "ready",
      target: {
        id: "dogfood",
      },
      eligibleWorkItems: [
        {
          id: "local-1",
        },
      ],
      componentEligibleWorkItems: [
        {
          componentId: "primary",
          workItemCount: 1,
          excludedWorkItemCount: 1,
          excludedCategoryCounts: {
            status: 1,
          },
          excludedReasonCounts: {
            "status todo not selected": 1,
          },
          excludedWorkItems: [
            {
              id: "local-2",
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
          trackerResults: [
            {
              excludedCount: 1,
              exclusionCategoryCounts: {
                status: 1,
              },
            },
          ],
        },
      ],
    });

    const eligibleWork = toolJson(
      await callDevNexusMcpTool(
        "eligible_work",
        {
          projectRoot,
        },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );
    expect(eligibleWork).toMatchObject({
      ok: true,
      project: {
        id: "mcp-demo",
      },
      eligibleWorkItemCount: 1,
      excludedWorkItemCount: 1,
      excludedCategoryCounts: {
        status: 1,
      },
      components: [
        {
          componentId: "primary",
          excludedWorkItemCount: 1,
          excludedCategoryCounts: {
            status: 1,
          },
          workItems: [
            {
              id: "local-1",
              title: "Split the plan",
            },
          ],
          excludedWorkItems: [
            {
              id: "local-2",
              reasons: ["status todo not selected"],
            },
          ],
        },
      ],
    });
    expect(eligibleWork.projectConfig).toBeUndefined();

    const agentProfiles = toolJson(
      await callDevNexusMcpTool("agent_profiles", {
        projectRoot,
      }),
    );
    expect(agentProfiles).toMatchObject({
      ok: true,
      automationMode: "agent_launch",
      coordinatorProfileId: null,
      maxConcurrentSubagents: 1,
      safety: {
        profile: "local",
      },
      profiles: [],
    });
    expect(agentProfiles.projectConfig).toBeUndefined();

    const heartbeat = toolJson(
      await callDevNexusMcpTool("automation_heartbeat_prepare", {
        projectRoot,
        intervalMinutes: 45,
        status: "PAUSED",
      }),
    );
    expect(heartbeat).toMatchObject({
      ok: true,
      project: {
        id: "mcp-demo",
      },
      codexAutomation: {
        kind: "heartbeat",
        destination: "thread",
        rrule: "FREQ=MINUTELY;INTERVAL=45",
        status: "PAUSED",
      },
    });
    expect(heartbeat.codexAutomation.prompt).toContain(
      "provider-native issue directly without importing or copying",
    );
    expect(heartbeat.projectConfig).toBeUndefined();

    const updated = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        id: "local-1",
        status: "in_progress",
      }),
    );
    expect(updated.workItem).toMatchObject({
      id: "local-1",
      status: "in_progress",
    });

    const comment = toolJson(
      await callDevNexusMcpTool("work_item_comment", {
        projectRoot,
        id: "local-1",
        body: "Issue slicing started.",
      }),
    );
    expect(comment.comment).toMatchObject({
      id: "local-comment-1",
      body: "Issue slicing started.",
    });

    const listed = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        status: "in_progress",
      }),
    );
    expect(listed).toMatchObject({
      detail: "summary",
      limit: 50,
    });
    expect(listed.workItems).toMatchObject([
      {
        id: "local-1",
        status: "in_progress",
        descriptionLength: "Write PRD".length,
      },
    ]);
    expect(listed.workItems[0].description).toBeUndefined();

    const localOpenList = await callDevNexusMcpTool("work_item_list", {
      projectRoot,
      status: "open",
    });
    expect(toolJson(localOpenList)).toMatchObject({
      ok: true,
      workItems: expect.arrayContaining([
        expect.objectContaining({
          id: "local-1",
          status: "in_progress",
        }),
      ]),
    });

    const fullList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        status: "in_progress",
        detail: "full",
      }),
    );
    expect(fullList).toMatchObject({
      detail: "full",
      limit: 50,
    });
    expect(fullList.workItems[0]).toMatchObject({
      id: "local-1",
      description: "Write PRD",
    });

    const oversizedList = await callDevNexusMcpTool("work_item_list", {
      projectRoot,
      limit: 101,
    });
    expect(oversizedList.isError).toBe(true);
    expect(toolJson(oversizedList)).toMatchObject({
      ok: false,
      error: "arguments.limit must be at most 100",
    });
  });

  it("uses host auth profiles when MCP opens GitHub work-item providers", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    const homePath = path.join(projectRoot, "home");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const commandRuns: Array<{ command: string; args: string[] }> = [];
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    saveHomeConfig(homePath, [
      {
        id: "dev-nexus-app",
        actorId: "dev-nexus-automation-app",
        provider: "github",
        kind: "app",
        credentialKind: "github_app",
        account: "devnexus-automation",
        host: "github.com",
        command: "home:secrets/github-app-token.mjs --format token",
        environmentKeys: ["GH_TOKEN"],
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
            actor: {
              id: "dev-nexus-automation-app",
              kind: "app",
              provider: "github",
              handle: "devnexus-automation",
            },
          },
        },
        authority: {
          actors: [
            {
              id: "dev-nexus-automation-app",
              kind: "service_account",
              provider: "github",
              providerIdentity: "devnexus-automation",
              displayName: "DevNexus Automation",
            },
          ],
          roleBindings: [
            {
              actorId: "dev-nexus-automation-app",
              roles: ["maintainer"],
              scope: { project: "mcp-demo" },
            },
          ],
        },
        components: [
          {
            id: "primary",
            name: "MCP Demo",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
            defaultBranch: "main",
            sourceRoot: "source",
            defaultWorkTrackerId: "github",
            workTrackers: [
              {
                id: "github",
                name: "GitHub",
                enabled: true,
                roles: ["primary"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "mcp-demo",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );

    const result = toolJson(
      await callDevNexusMcpTool(
        "work_item_get",
        {
          projectRoot,
          componentId: "primary",
          trackerId: "github",
          id: "github-7",
        },
        {
          workItemCredentialCommandRunner: (command, args) => {
            commandRuns.push({ command, args });
            return {
              status: 0,
              stdout: "installation-token",
              stderr: "",
            };
          },
          workItemProviderOptions: {
            github: {
              credentialRunner: false,
              fetch: (async (input, init = {}) => {
                requests.push({
                  url: String(input),
                  headers: init.headers as Record<string, string>,
                });
                return new Response(
                  JSON.stringify({
                    id: 7,
                    number: 7,
                    title: "Credentialed GitHub issue",
                    state: "open",
                    labels: [],
                  }),
                  {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  },
                );
              }) as typeof fetch,
            },
          },
        },
      ),
    );

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true });
    expect(result.workItem).toMatchObject({
      id: "github-7",
      title: "Credentialed GitHub issue",
    });
    expect(commandRuns).toEqual([
      {
        command: path.join(homePath, "secrets/github-app-token.mjs"),
        args: ["--format", "token"],
      },
    ]);
    expect(requests[0]).toMatchObject({
      url: "https://api.github.com/repos/example/mcp-demo/issues/7",
      headers: {
        Authorization: "Bearer installation-token",
      },
    });
  });

  it("allows local work-item MCP mutations with a provider-scoped automation auth profile", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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

    const created = toolJson(
      await callDevNexusMcpTool("work_item_create", {
        projectRoot,
        homePath,
        componentId: "primary",
        title: "Local profile mismatch regression",
        status: "todo",
      }),
    );
    expect(created).toMatchObject({
      ok: true,
      workItem: {
        id: "local-1",
      },
    });
    const updated = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        homePath,
        componentId: "primary",
        id: created.workItem.id,
        title: "Local profile mismatch fixed",
        status: "ready",
        labels: ["dogfood"],
      }),
    );
    const comment = toolJson(
      await callDevNexusMcpTool("work_item_comment", {
        projectRoot,
        homePath,
        componentId: "primary",
        id: created.workItem.id,
        body: "Local tracker comment.",
      }),
    );
    const closed = toolJson(
      await callDevNexusMcpTool("work_item_set_status", {
        projectRoot,
        homePath,
        componentId: "primary",
        id: created.workItem.id,
        status: "done",
      }),
    );

    expect(updated.workItem).toMatchObject({
      id: "local-1",
      title: "Local profile mismatch fixed",
      status: "ready",
      labels: ["dogfood"],
    });
    expect(comment.comment).toMatchObject({
      id: "local-comment-1",
      body: "Local tracker comment.",
    });
    expect(closed.workItem).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("blocks provider work-item MCP mutations when the current actor lacks provider authority", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
        components: [
          {
            id: "primary",
            name: "MCP Demo",
            kind: "git",
            role: "primary",
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
                    name: "mcp-demo",
                  },
                },
              },
            ],
            relationships: [],
          },
        ],
      }),
    );

    const blockedLabels = await callDevNexusMcpTool("work_item_update", {
      projectRoot,
      componentId: "primary",
      trackerId: "github",
      id: "42",
      labels: ["blocked"],
    });
    const blockedAssignments = await callDevNexusMcpTool("work_item_update", {
      projectRoot,
      componentId: "primary",
      trackerId: "github",
      id: "42",
      assignees: ["maintainer"],
    });
    const blockedTransition = await callDevNexusMcpTool("work_item_set_status", {
      projectRoot,
      componentId: "primary",
      trackerId: "github",
      id: "42",
      status: "done",
    });

    expect(blockedLabels.isError).toBe(true);
    expect(toolJson(blockedLabels)).toMatchObject({
      ok: false,
      blockedMutation: {
        action: "provider.label",
        reason: expect.stringContaining("provider.label"),
        fallbackAction: "coordination.handoff",
      },
    });
    expect(blockedAssignments.isError).toBe(true);
    expect(toolJson(blockedAssignments)).toMatchObject({
      blockedMutation: {
        action: "provider.assign",
      },
    });
    expect(blockedTransition.isError).toBe(true);
    expect(toolJson(blockedTransition)).toMatchObject({
      blockedMutation: {
        action: "provider.transition",
      },
    });

    const item = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local" },
      now: fixedClock("2026-05-18T08:30:00.000Z"),
    }).createWorkItem({
      projectRoot,
      title: "Local comment is allowed",
      status: "ready",
    });
    const localComment = toolJson(
      await callDevNexusMcpTool("work_item_comment", {
        projectRoot,
        componentId: "primary",
        id: item.id,
        body: "Contributor comment.",
      }),
    );

    expect(localComment).toMatchObject({
      ok: true,
      comment: {
        body: "Contributor comment.",
      },
    });
  });

  it("records target cycle facts through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const recorded = toolJson(
      await callDevNexusMcpTool(
        "target_cycle_record",
        {
          projectRoot,
          cycleId: "cycle-1",
          runId: "run-1",
          status: "dispatched",
          summary: "Coordinator dispatched work.",
          eligibleWorkItemCount: 2,
          workItems: [
            {
              componentId: "primary",
              id: "local-1",
              cycleStatus: "selected",
              agentProfileId: "codex-coordinator",
              notes: "Selected for the bounded batch.",
            },
            {
              componentId: "primary",
              id: "local-2",
              cycleStatus: "dispatched",
              agentProfileId: "codex-local",
              notes: "Subagent launched.",
            },
            {
              componentId: "addon",
              id: "local-3",
              cycleStatus: "in_progress",
              agentProfileId: "codex-local",
              notes: "Focused tests running.",
            },
            {
              componentId: "addon",
              id: "local-4",
              cycleStatus: "completed",
              agentProfileId: "codex-local",
              notes: "Verification passed.",
            },
            {
              componentId: "tools",
              id: "local-5",
              cycleStatus: "blocked",
              agentProfileId: "codex-local",
              notes: "Waiting for credentials.",
            },
            {
              componentId: "tools",
              id: "local-6",
              cycleStatus: "skipped",
              agentProfileId: "codex-local",
              notes: "Dependency remained blocked.",
            },
          ],
          notes: ["One subagent launched."],
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    const listed = toolJson(
      await callDevNexusMcpTool("target_cycle_list", {
        projectRoot,
      }),
    );

    expect(recorded).toMatchObject({
      ok: true,
      detail: "summary",
      record: {
        id: "cycle-1",
        targetId: "dogfood",
        runId: "run-1",
        status: "dispatched",
        finishedAt: null,
        eligibleWorkItemCount: 2,
        workItemCount: 6,
        workItemRefs: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "selected",
            agentProfileId: "codex-coordinator",
          },
          {
            componentId: "primary",
            id: "local-2",
            cycleStatus: "dispatched",
            agentProfileId: "codex-local",
          },
        ],
        omittedWorkItemRefCount: 4,
      },
    });
    expect(recorded.record.workItems).toBeUndefined();
    expect(listed.ledger).toMatchObject({
      version: 1,
      cycleCount: 1,
      cycles: [
        {
          id: "cycle-1",
          status: "dispatched",
          runId: "run-1",
          targetId: "dogfood",
          eligibleWorkItemCount: 2,
          workItemCount: 6,
          workItemStatusCounts: {
            selected: 1,
            dispatched: 1,
            in_progress: 1,
            completed: 1,
            blocked: 1,
            skipped: 1,
          },
          noteCount: 1,
          blockerCount: 0,
          workItemRefs: [
            {
              componentId: "primary",
              id: "local-1",
              cycleStatus: "selected",
              agentProfileId: "codex-coordinator",
            },
            {
              componentId: "primary",
              id: "local-2",
              cycleStatus: "dispatched",
              agentProfileId: "codex-local",
            },
          ],
          omittedWorkItemRefCount: 4,
        },
      ],
    });
    expect(listed.ledger.cycles[0].workItems).toBeUndefined();
    expect(listed.ledger.cycles[0].notes).toBeUndefined();
    expect(listed.ledger.cycles[0].authority).toBeUndefined();
  });

  it("builds target reports through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    await callDevNexusMcpTool(
      "target_cycle_record",
      {
        projectRoot,
        cycleId: "cycle-1",
        status: "completed",
        summary: "Target completed.",
        eligibleWorkItemCount: 0,
        workItems: [
          {
            componentId: "primary",
            id: "local-1",
            cycleStatus: "completed",
          },
        ],
      },
      { now: fixedClock("2026-05-16T10:00:00.000Z") },
    );
    const report = toolJson(
      await callDevNexusMcpTool(
        "target_report",
        {
          projectRoot,
        },
        { now: fixedClock("2026-05-16T10:05:00.000Z") },
      ),
    );

    expect(report).toMatchObject({
      ok: true,
      report: {
        status: "completed",
        statusReason: "Latest target cycle cycle-1 is completed",
        project: {
          id: "mcp-demo",
        },
        workItemSummary: {
          uniqueReferences: [
            {
              componentId: "primary",
              id: "local-1",
              latestCycleStatus: "completed",
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

  it("returns workspace status diagnostics for plugin MCP core tool overlap", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-plugin-overlap-");
    const missingHomePath = path.join(
      makeTempDir("dev-nexus-mcp-missing-home-"),
      "missing",
    );
    const previousHome = process.env.DEV_NEXUS_HOME;
    fs.writeFileSync(
      path.join(projectRoot, "dev-nexus.project.json"),
      `${JSON.stringify({
        version: 1,
        id: "overlap-demo",
        name: "Overlap Demo",
        home: null,
        plugins: [
          {
            id: "workflow-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "workflow-mcp",
                serverName: "workflow_tools",
                tools: [{ name: "work_item_list" }],
              },
            ],
          },
        ],
      }, null, 2)}\n`,
    );

    try {
      process.env.DEV_NEXUS_HOME = missingHomePath;
      const result = toolJson(
        await callDevNexusMcpTool("project_status", {
          project: projectRoot,
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining(
          "plugin id workflow-tools server workflow_tools duplicate tools: work_item_list",
        ),
      });
      expect(result.error).toContain(
        "Generic DevNexus operations belong to dev_nexus",
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.DEV_NEXUS_HOME;
      } else {
        process.env.DEV_NEXUS_HOME = previousHome;
      }
    }
  });

  it("targets component-scoped work items through MCP tool arguments", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
            remoteUrl: "git@example.invalid:mcp/addon.git",
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

    const created = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          componentId: "addon",
          title: "Addon MCP task",
          status: "ready",
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    const addonList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        componentId: "addon",
      }),
    );
    const primaryList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
      }),
    );
    const qualifiedGet = toolJson(
      await callDevNexusMcpTool("work_item_get", {
        projectRoot,
        id: "addon:local-1",
      }),
    );
    const qualifiedUpdate = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        id: "addon:local-1",
        title: "Updated addon MCP task",
      }),
    );
    const qualifiedComment = toolJson(
      await callDevNexusMcpTool("work_item_comment", {
        projectRoot,
        id: "addon:local-1",
        body: "Component-qualified reference worked.",
      }),
    );
    const qualifiedStatus = toolJson(
      await callDevNexusMcpTool("work_item_set_status", {
        projectRoot,
        id: "addon:local-1",
        status: "done",
      }),
    );

    expect(created.workItem).toMatchObject({
      id: "local-1",
      title: "Addon MCP task",
    });
    expect(qualifiedGet.workItem).toMatchObject({
      id: "local-1",
      title: "Addon MCP task",
    });
    expect(qualifiedUpdate.workItem).toMatchObject({
      id: "local-1",
      title: "Updated addon MCP task",
    });
    expect(qualifiedComment.comment).toMatchObject({
      body: "Component-qualified reference worked.",
    });
    expect(qualifiedStatus.workItem).toMatchObject({
      id: "local-1",
      status: "done",
    });
    expect(addonList.workItems).toMatchObject([
      {
        id: "local-1",
        title: "Addon MCP task",
      },
    ]);
    expect(primaryList.workItems).toEqual([]);
  });

  it("targets explicit and tracker-qualified work trackers through MCP tool arguments", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
            remoteUrl: "git@example.invalid:mcp/demo.git",
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

    const defaultCreated = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          title: "Default MCP task",
        },
        { now: fixedClock("2026-05-16T10:00:00.000Z") },
      ),
    );
    const mirrorCreated = toolJson(
      await callDevNexusMcpTool(
        "work_item_create",
        {
          projectRoot,
          trackerId: "mirror",
          title: "Mirror MCP task",
        },
        { now: fixedClock("2026-05-16T10:01:00.000Z") },
      ),
    );
    const defaultList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
      }),
    );
    const mirrorList = toolJson(
      await callDevNexusMcpTool("work_item_list", {
        projectRoot,
        trackerId: "mirror",
      }),
    );
    const qualifiedGet = toolJson(
      await callDevNexusMcpTool("work_item_get", {
        projectRoot,
        id: "mirror:local-1",
      }),
    );
    const explicitUpdate = toolJson(
      await callDevNexusMcpTool("work_item_update", {
        projectRoot,
        trackerId: "mirror",
        id: "local-1",
        title: "Updated mirror MCP task",
      }),
    );
    const externalRefStatus = toolJson(
      await callDevNexusMcpTool("work_item_set_status", {
        projectRoot,
        trackerId: "mirror",
        externalRef: {
          provider: "local",
          itemId: "local-1",
        },
        status: "done",
      }),
    );

    expect(defaultCreated.workItem).toMatchObject({
      title: "Default MCP task",
      trackerRef: {
        trackerId: "primary",
        default: true,
      },
    });
    expect(mirrorCreated.workItem).toMatchObject({
      title: "Mirror MCP task",
      trackerRef: {
        trackerId: "mirror",
        default: false,
      },
    });
    expect(defaultList.workItems).toMatchObject([
      {
        title: "Default MCP task",
        trackerRef: {
          trackerId: "primary",
        },
      },
    ]);
    expect(mirrorList.workItems).toMatchObject([
      {
        title: "Mirror MCP task",
        trackerRef: {
          trackerId: "mirror",
        },
      },
    ]);
    expect(qualifiedGet.workItem).toMatchObject({
      title: "Mirror MCP task",
      trackerRef: {
        trackerId: "mirror",
      },
    });
    expect(explicitUpdate.workItem).toMatchObject({
      title: "Updated mirror MCP task",
      trackerRef: {
        trackerId: "mirror",
      },
    });
    expect(externalRefStatus.workItem).toMatchObject({
      id: "local-1",
      status: "done",
      trackerRef: {
        trackerId: "mirror",
      },
    });
  });

  it("links, shows, and unlinks work-item tracker references through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
                roles: ["mirror", "coordination"],
                workTracking: {
                  provider: "github",
                  host: "github.com",
                  repository: {
                    owner: "example",
                    name: "mcp-demo",
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

    const linked = toolJson(
      await callDevNexusMcpTool(
        "work_item_link",
        {
          projectRoot,
          logicalItemId: "local-46",
          trackerId: "github",
          itemId: "github-issue-42",
          itemNumber: 42,
          webUrl: "https://github.com/example/mcp-demo/issues/42",
        },
        { now: fixedClock("2026-05-18T08:00:00.000Z") },
      ),
    );
    const updated = toolJson(
      await callDevNexusMcpTool(
        "work_item_link",
        {
          projectRoot,
          logicalItemId: "local-46",
          trackerId: "github",
          itemId: "github-issue-42",
          itemNumber: 42,
          nodeId: "I_kwDOMcpUpdated",
          webUrl: "https://github.com/example/mcp-demo/issues/42#updated",
        },
        { now: fixedClock("2026-05-18T08:01:00.000Z") },
      ),
    );
    const shown = toolJson(
      await callDevNexusMcpTool("work_item_show_links", {
        projectRoot,
        logicalItemId: "local-46",
      }),
    );
    const unlinked = toolJson(
      await callDevNexusMcpTool(
        "work_item_unlink",
        {
          projectRoot,
          logicalItemId: "local-46",
          trackerId: "github",
          itemId: "github-issue-42",
          reason: "Wrong external issue",
        },
        { now: fixedClock("2026-05-18T08:05:00.000Z") },
      ),
    );
    const afterUnlink = toolJson(
      await callDevNexusMcpTool("work_item_show_links", {
        projectRoot,
        logicalItemId: "local-46",
      }),
    );

    expect(linked).toMatchObject({
      ok: true,
      action: "linked",
      reference: {
        trackerId: "github",
        provider: "github",
        repositoryOwner: "example",
        repositoryName: "mcp-demo",
        itemId: "github-issue-42",
      },
    });
    expect(updated).toMatchObject({
      ok: true,
      action: "updated",
      record: {
        references: [
          {
            itemId: "github-issue-42",
            nodeId: "I_kwDOMcpUpdated",
          },
        ],
      },
    });
    expect(shown).toMatchObject({
      ok: true,
      references: [
        {
          trackerId: "github",
          itemId: "github-issue-42",
          webUrl: "https://github.com/example/mcp-demo/issues/42#updated",
        },
      ],
    });
    expect(unlinked).toMatchObject({
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
    expect(afterUnlink).toMatchObject({
      ok: true,
      references: [],
    });
  });

  it("returns dry-run work-item sync plans through MCP tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-project-");
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
            remoteUrl: "git@example.invalid:mcp/demo.git",
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
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: {
        provider: "local",
        storePath: ".dev-nexus/work-items-primary.json",
      },
    }).createWorkItem({
      projectRoot,
      title: "Mirror through MCP",
      status: "ready",
      labels: ["sync"],
    });

    const toolNames = listDevNexusMcpTools().map((tool) => tool.name);
    const result = toolJson(
      await callDevNexusMcpTool(
        "work_item_sync_plan",
        {
          projectRoot,
          componentId: "primary",
          sourceTrackerId: "primary",
          targetTrackerId: "mirror",
          filters: {
            status: ["ready"],
            labels: ["sync"],
          },
          fieldSet: ["title", "status"],
        },
        { now: fixedClock("2026-05-18T09:00:00.000Z") },
      ),
    );

    expect(toolNames).toContain("work_item_sync_plan");
    expect(result).toMatchObject({
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
              title: "Mirror through MCP",
            },
            targetDetection: "unlinked",
          },
        ],
        counts: {
          creates: 1,
        },
      },
    });
  });

  it("handles MCP JSON-RPC initialize, tools/list, and tools/call", async () => {
    const initialized = await handleDevNexusMcpJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "dev-nexus",
        },
      },
    });

    const listed = await handleDevNexusMcpJsonRpcMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(listed).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "project_status",
          }),
        ]),
      },
    });

    const called = await handleDevNexusMcpJsonRpcMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "unknown",
        arguments: {},
      },
    });
    expect(called).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: true,
      },
    });
  });

  it("waits for a split stdio frame body without recursively reprocessing the header", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioJsonRpcTransport(
      async (message) => ({
        jsonrpc: "2.0",
        id: message.id,
        result: { method: message.method },
      }),
      { stdin, stdout },
    );
    const started = transport.start();
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`);
    await waitForMicrotask();
    expect(stdout.read()).toBeNull();

    const response = nextChunk(stdout);
    stdin.write(body);

    expect(parseJsonRpcFrame(await response)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { method: "tools/list" },
    });
    stdin.end();
    await started;
  });

  it("handles newline-delimited JSON-RPC over stdio", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioJsonRpcTransport(
      async (message) => ({
        jsonrpc: "2.0",
        id: message.id,
        result: { method: message.method },
      }),
      { stdin, stdout },
    );
    const started = transport.start();
    const response = nextChunk(stdout);

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    })}\n`);

    expect(JSON.parse((await response).toString("utf8"))).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { method: "initialize" },
    });
    stdin.end();
    await started;
  });

  it("claims the next eligible GitHub work item through MCP", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-claim-");
    saveProjectConfig(projectRoot, githubClaimProjectConfig());
    const provider = new McpClaimMemoryProvider([
      mcpGithubWorkItem("github-7", "Claim through MCP", {
        labels: ["automation"],
      }),
    ]);

    const result = await callDevNexusMcpTool(
      "work_item_claim_next",
      {
        projectRoot,
        componentId: "core",
        trackerId: "github",
        hostId: "host-a",
        agentId: "agent-a",
        leaseDurationMs: 600000,
      },
      {
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: mcpClaimProviderFactory(provider),
        workItemClaimLeaseTokenFactory: () => "mcp-token-1",
      },
    );

    expect(toolJson(result)).toMatchObject({
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
          leaseToken: "mcp-token-1",
          expiresAt: "2026-05-20T10:10:00.000Z",
        },
      },
    });
  });

  it("reports blocked claim provider capabilities through MCP", async () => {
    const projectRoot = makeTempDir("dev-nexus-mcp-claim-");
    saveProjectConfig(projectRoot, githubClaimProjectConfig());
    const provider = new McpClaimMemoryProvider([
      mcpGithubWorkItem("github-8", "Cannot update", {
        labels: ["automation"],
      }),
    ]);
    provider.capabilities.updateItem = false;

    const result = await callDevNexusMcpTool(
      "work_item_claim_next",
      {
        projectRoot,
        hostId: "host-a",
      },
      {
        now: fixedClock("2026-05-20T10:00:00.000Z"),
        workItemClaimProviderFactory: mcpClaimProviderFactory(provider),
      },
    );

    expect(result.isError).toBe(true);
    expect(toolJson(result)).toMatchObject({
      ok: false,
    });
    expect(toolJson(result).error).toContain("claim work items");
    expect(provider.updates).toEqual([]);
  });
});

function githubClaimProjectConfig(): NexusProjectConfig {
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

function mcpGithubWorkItem(
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

function mcpClaimProviderFactory(
  provider: McpClaimMemoryProvider,
): NexusEligibleWorkClaimProviderFactory {
  return () => provider;
}

function writeMcpAgentContext(
  projectRoot: string,
  authorityClaim: NexusWorkItemClaimAuthorityRecord,
): string {
  const contextFile = path.join(projectRoot, ".dev-nexus", "context.json");
  fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  fs.writeFileSync(
    contextFile,
    `${JSON.stringify({
      workItemClaim: {
        status: "claimed",
        componentId: "primary",
        trackerId: "default",
        workItemId: "local-1",
        logicalWorkItemId: "local-1",
        authorityClaim,
      },
    })}\n`,
    "utf8",
  );

  return contextFile;
}

function restoreOptionalEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function mcpAuthorityClaim(): NexusWorkItemClaimAuthorityRecord {
  return {
    authorityKind: "test-authority",
    key: {
      projectId: "mcp-demo",
      componentId: "primary",
      trackerId: "default",
      provider: "local",
      workItemId: "local-1",
    },
    owner: {
      version: 1,
      hostId: "host-a",
      agentId: "agent-a",
      ownerId: null,
      leaseToken: "lease-1",
      claimedAt: "2026-05-23T09:00:00.000Z",
      expiresAt: "2026-05-23T10:30:00.000Z",
    },
    fencingToken: 12,
    state: "active",
    claimedAt: "2026-05-23T09:00:00.000Z",
    expiresAt: "2026-05-23T10:30:00.000Z",
    lastHeartbeatAt: "2026-05-23T09:00:00.000Z",
  };
}

class McpClaimMemoryProvider implements WorkTrackerProvider {
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

  constructor(readonly items: WorkItem[]) {}

  async createWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    return this.items.filter((item) => mcpClaimMatchesQuery(item, query)).map(cloneMcpClaimItem);
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    return cloneMcpClaimItem(this.findItem(ref));
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
    return cloneMcpClaimItem(item);
  }

  async addComment(_ref: WorkItemRef, body: string): Promise<WorkComment> {
    return {
      id: "comment-1",
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

function mcpClaimMatchesQuery(item: WorkItem, query: WorkItemQuery): boolean {
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

function cloneMcpClaimItem(item: WorkItem): WorkItem {
  return {
    ...item,
    labels: item.labels ? [...item.labels] : undefined,
    assignees: item.assignees ? [...item.assignees] : undefined,
    externalRef: item.externalRef ? { ...item.externalRef } : undefined,
  };
}
