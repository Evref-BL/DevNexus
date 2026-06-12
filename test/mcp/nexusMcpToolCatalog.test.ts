import { describe, expect, it } from "vitest";
import { devNexusCoreMcpToolNames } from "../../src/mcp/nexusCoreMcpTools.js";
import { listMcpInputSchemaProviderIssues } from "../../src/mcp/nexusMcpSchemaCompatibility.js";
import { listDevNexusMcpTools } from "../../src/mcp/nexusMcpToolCatalog.js";
import { maxNexusRemoteExecutionOutputTailLength } from "../../src/remote-execution/nexusRemoteExecution.js";

describe("DevNexus MCP tool catalog", () => {
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
      "coordination_start",
      "coordination_handoff",
      "coordination_integrate",
      "coordination_cleanup_execute",
      "coordination_request",
      "host_check",
      "remote_execution_request_create",
      "remote_execution_result_record",
      "remote_execution_result_get",
      "remote_execution_ssh_plan",
      "remote_execution_run",
      "work_item_create",
      "work_item_discovery_status",
      "work_item_claim_next",
      "work_item_claim_release",
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
    const claimRelease = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "work_item_claim_release",
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
    expect(claimRelease?.inputSchema).toMatchObject({
      properties: {
        itemId: { type: "string" },
        leaseToken: { type: "string" },
        fencingToken: { type: "number" },
      },
      required: ["itemId", "leaseToken"],
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
      "work_item_discovery_status",
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

  it("advertises cleanup execution with a bounded MCP schema", () => {
    const cleanupExecute = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "coordination_cleanup_execute",
    );

    expect(cleanupExecute?.inputSchema).toMatchObject({
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        candidateId: { type: "string" },
        includeProjectMeta: { type: "boolean" },
        targetBranch: { type: "string" },
        keepBranch: { type: "boolean" },
        force: { type: "boolean" },
        forceReason: { type: "string", maxLength: 500 },
        rescueBranch: { type: "string" },
        rescueReason: { type: "string", maxLength: 500 },
        archiveSummary: { type: "string", maxLength: 1000 },
        archiveUrl: { type: "string", maxLength: 1000 },
      },
      required: ["candidateId"],
      additionalProperties: false,
    });
  });

  it("advertises separate handoff paths for metadata writes and source Git facts", () => {
    const handoff = listDevNexusMcpTools().find(
      (candidate) => candidate.name === "coordination_handoff",
    );

    expect(handoff?.inputSchema).toMatchObject({
      properties: {
        currentPath: { type: "string" },
        repositoryPath: { type: "string" },
      },
    });
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


});
