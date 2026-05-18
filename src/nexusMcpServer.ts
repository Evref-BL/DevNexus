import path from "node:path";
import process from "node:process";
import type { Readable, Writable } from "node:stream";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  resolveNexusHome,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  getNexusProjectStatus,
  type NexusProjectHomeStore,
} from "./nexusProjectHomeService.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
} from "./nexusProjectLifecycle.js";
import {
  buildNexusProjectStatusForPath,
  type NexusProjectStatusBase,
} from "./nexusProjectRegistry.js";
import {
  getNexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  getNexusAutomationAgentProfileSummary,
  getNexusAutomationEligibleWorkSummary,
} from "./nexusAutomationAgentSurface.js";
import {
  appendNexusAutomationTargetCycleRecord,
  maxNexusAutomationTargetCycleNoteLength,
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleStatus,
  type NexusAutomationTargetCycleWorkItemInput,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  adoptNexusAutomationCurrentAgent,
  adoptNexusAutomationCurrentAgentFromCoordinatorLoop,
  recordNexusAutomationCurrentAgentAdoptionResult,
  type NexusAutomationCurrentAgentAdoptionResultInput,
} from "./nexusAutomationCurrentAgentAdoption.js";
import {
  createNexusCoordinationHandoff,
  getNexusCoordinationIntegrationPlan,
  getNexusCoordinationStatus,
  nexusCoordinationErrorPayload,
  parseNexusCoordinationHandoffStatus,
} from "./nexusCoordination.js";
import {
  createNexusCoordinationRequest,
  parseNexusCoordinationRequestIntent,
  parseNexusCoordinationRequestStatus,
} from "./nexusCoordinationRequest.js";
import {
  buildNexusSetupCheck,
  buildNexusSetupPlan,
  listNexusSetupFlows,
  recordNexusSetupStep,
  type NexusSetupRecordedStepStatus,
} from "./nexusSetupAssistant.js";
import {
  prepareNexusManualWorktree,
  resolveNexusManualWorktreeWorkItem,
} from "./nexusManualWorktree.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
  type WorkItemProjectSelector,
} from "./workItemService.js";
import { providerCompatibleMcpTools } from "./nexusMcpSchemaCompatibility.js";
import type { GitRunner } from "./gitWorktreeService.js";
import type {
  WorkItemPatch,
  WorkItemRef,
  WorkStatus,
} from "./workTrackingTypes.js";

export const devNexusMcpProtocolVersion = "2024-11-05";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DevNexusMcpToolContext {
  now?: () => Date | string;
  gitRunner?: GitRunner;
  currentPath?: string;
}

export interface DevNexusMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const tools: McpTool[] = [
  {
    name: "project_status",
    description: "Show one DevNexus project by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "automation_status",
    description: "Read DevNexus automation readiness, target context, and eligible work without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "eligible_work",
    description: "List concise DevNexus eligible work grouped by component using the configured automation selector.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_profiles",
    description: "Inspect concise DevNexus coordinator and subagent profile policy without dumping full project config.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "setup_flow_list",
    description: "List guided DevNexus setup flows for project onboarding and new-machine setup.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "setup_plan",
    description: "Build a guided setup plan for a DevNexus project without reading secrets or mutating host state.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        flowId: { type: "string" },
        platform: {
          type: "string",
          enum: ["auto", "macos", "windows", "linux"],
        },
      },
      required: ["projectRoot", "flowId"],
      additionalProperties: false,
    },
  },
  {
    name: "setup_check",
    description: "Check safe local setup facts for a DevNexus project without contacting external providers.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        flowId: { type: "string" },
        platform: {
          type: "string",
          enum: ["auto", "macos", "windows", "linux"],
        },
      },
      required: ["projectRoot", "flowId"],
      additionalProperties: false,
    },
  },
  {
    name: "setup_record",
    description: "Record host-local progress for a DevNexus guided setup flow.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        flowId: { type: "string" },
        stepId: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "completed", "blocked", "skipped"],
        },
        note: { type: ["string", "null"] },
      },
      required: ["projectRoot", "flowId", "stepId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "target_cycle_list",
    description: "List recorded DevNexus target cycles without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "target_cycle_record",
    description: "Record caller-reported DevNexus target cycle progress.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        cycleId: { type: "string" },
        runId: { type: "string" },
        status: {
          type: "string",
          enum: ["started", "dispatched", "completed", "blocked", "failed", "skipped"],
        },
        summary: { type: ["string", "null"] },
        eligibleWorkItemCount: { type: ["number", "null"] },
        workItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              componentId: { type: ["string", "null"] },
              id: { type: "string" },
              title: { type: ["string", "null"] },
              status: { type: ["string", "null"] },
              cycleStatus: {
                type: ["string", "null"],
                enum: [
                  "eligible",
                  "selected",
                  "dispatched",
                  "in_progress",
                  "completed",
                  "blocked",
                  "skipped",
                  null,
                ],
              },
              agentProfileId: { type: ["string", "null"] },
              notes: {
                type: ["string", "null"],
                maxLength: maxNexusAutomationTargetCycleNoteLength,
              },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        blockers: { type: "array", items: { type: "string" } },
        notes: {
          type: "array",
          items: {
            type: "string",
            maxLength: maxNexusAutomationTargetCycleNoteLength,
          },
        },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "target_report",
    description: "Build a factual DevNexus target report from recorded target, cycle, run, and work-item facts.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "current_agent_adopt",
    description: "Create or reuse DevNexus agent-launch context for the current coordinator without spawning nested model execution.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        runId: { type: "string" },
        owner: { type: ["string", "null"] },
        coordinatorLoop: { type: "boolean" },
        runIdPrefix: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "current_agent_record",
    description: "Record the current coordinator's adopted DevNexus run result and release its adoption lock.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        runId: { type: "string" },
        result: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["completed", "blocked", "failed", "skipped"],
            },
            summary: { type: "string" },
            commitIds: { type: "array", items: { type: "string" } },
            verification: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  command: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["passed", "failed", "not_run"],
                  },
                  summary: { type: ["string", "null"] },
                },
                required: ["command"],
                additionalProperties: false,
              },
            },
            publicationDecision: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "not_decided",
                    "local_only",
                    "direct_integration",
                    "review_handoff",
                    "blocked",
                  ],
                },
                targetBranch: { type: ["string", "null"] },
                remote: { type: ["string", "null"] },
                prUrl: { type: ["string", "null"] },
                reason: { type: ["string", "null"] },
              },
              required: ["type"],
              additionalProperties: false,
            },
            error: { type: ["string", "null"] },
          },
          required: ["status", "summary"],
          additionalProperties: false,
        },
      },
      required: ["runId", "result"],
      additionalProperties: false,
    },
  },
  {
    name: "worktree_prepare",
    description: "Prepare an isolated Git worktree and branch for manual parallel agent work.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        projectMeta: { type: "boolean" },
        workItemId: { type: ["string", "null"] },
        workItemTitle: { type: ["string", "null"] },
        topic: { type: ["string", "null"] },
        branchName: { type: "string" },
        worktreeName: { type: "string" },
        baseRef: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "coordination_status",
    description: "Report advisory shared coordination status for a component worktree and optional work item.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        workItemId: { type: "string" },
        currentPath: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "coordination_handoff",
    description: "Record an advisory structured coordination handoff as a tracker-backed work-item comment.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        workItemId: { type: "string" },
        status: {
          type: "string",
          enum: ["working", "ready", "blocked", "merged"],
        },
        hostId: { type: "string" },
        agentId: { type: "string" },
        changedAreas: { type: "array", items: { type: "string" } },
        decisions: { type: "array", items: { type: "string" } },
        verificationSummary: { type: ["string", "null"] },
        integrationPreference: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
        currentPath: { type: "string" },
      },
      required: ["workItemId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "coordination_integrate",
    description: "Build a read-only integration plan from related handoff branches, Git merge analysis, and recorded decisions.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        workItemId: { type: "string" },
        targetBranch: { type: "string" },
        fetch: { type: "boolean" },
        currentPath: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "coordination_request",
    description: "Draft a provider-neutral external coordination request and summarize mocked provider responses without live provider posting.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        workItemId: { type: "string" },
        intent: {
          type: "string",
          enum: ["approval", "feedback", "choice", "review"],
        },
        question: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
        target: { type: ["string", "null"] },
        hostId: { type: "string" },
        agentId: { type: "string" },
        responseStatus: {
          type: "string",
          enum: [
            "waiting",
            "answered",
            "approved",
            "changes_requested",
            "timed_out",
            "blocked",
          ],
        },
        responseSummary: { type: ["string", "null"] },
        responder: { type: ["string", "null"] },
        requestedChanges: { type: "array", items: { type: "string" } },
        currentPath: { type: "string" },
      },
      required: ["intent"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_create",
    description: "Create a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        status: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        milestone: { type: ["string", "null"] },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_list",
    description: "List work items through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        status: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        search: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_get",
    description: "Get a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_update",
    description: "Update a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        status: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        milestone: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_comment",
    description: "Add a comment to a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        body: { type: "string" },
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_set_status",
    description: "Set a work item's status through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        status: { type: "string" },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
];

export function listDevNexusMcpTools(): McpTool[] {
  return providerCompatibleMcpTools(tools);
}

export async function callDevNexusMcpTool(
  name: string,
  argsValue: unknown,
  context: DevNexusMcpToolContext = {},
): Promise<DevNexusMcpToolResult> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "project_status":
        return toolResult({
          ok: true,
          project: projectStatusFromArgs(args),
        });
      case "automation_status":
        return toolResult({
          ok: true,
          ...(await getNexusAutomationStatus({
            projectRoot: projectRootFromArgs(args),
            now: context.now,
          })),
        });
      case "eligible_work":
        return toolResult({
          ok: true,
          ...(await getNexusAutomationEligibleWorkSummary({
            projectRoot: projectRootFromArgs(args),
            now: context.now,
          })),
        });
      case "agent_profiles":
        return toolResult({
          ok: true,
          ...getNexusAutomationAgentProfileSummary(projectRootFromArgs(args)),
        });
      case "setup_flow_list":
        return toolResult({
          ok: true,
          flows: listNexusSetupFlows(),
        });
      case "setup_plan":
        return toolResult({
          ok: true,
          plan: buildNexusSetupPlan({
            projectRoot: projectRootFromArgs(args),
            flowId: requiredString(args, "flowId", "arguments"),
            platform: optionalString(args, "platform", "arguments"),
          }),
        });
      case "setup_check":
        return toolResult({
          ok: true,
          check: buildNexusSetupCheck({
            projectRoot: projectRootFromArgs(args),
            flowId: requiredString(args, "flowId", "arguments"),
            platform: optionalString(args, "platform", "arguments"),
          }),
        });
      case "setup_record":
        return toolResult({
          ok: true,
          ...recordNexusSetupStep({
            projectRoot: projectRootFromArgs(args),
            flowId: requiredString(args, "flowId", "arguments"),
            stepId: requiredString(args, "stepId", "arguments"),
            status: parseNexusSetupRecordedStepStatus(
              requiredString(args, "status", "arguments"),
              "arguments.status",
            ),
            note: optionalNullableString(args, "note", "arguments"),
            now: context.now,
          }),
        });
      case "target_cycle_list":
        return toolResult({
          ok: true,
          ...targetCycleLedgerFromArgs(args),
        });
      case "target_cycle_record":
        return toolResult({
          ok: true,
          ...appendTargetCycleFromArgs(args, context),
        });
      case "target_report":
        return toolResult({
          ok: true,
          report: buildNexusAutomationTargetReport({
            projectRoot: projectRootFromArgs(args),
            now: context.now?.(),
          }),
        });
      case "current_agent_adopt": {
        const coordinatorLoop =
          optionalBoolean(args, "coordinatorLoop", "arguments") ?? false;
        const adoptOptions = {
          projectRoot: projectRootFromArgs(args),
          runId: optionalString(args, "runId", "arguments"),
          owner: optionalNullableString(args, "owner", "arguments"),
          now: context.now,
        };
        return toolResult({
          ok: true,
          ...(coordinatorLoop
            ? await adoptNexusAutomationCurrentAgentFromCoordinatorLoop({
                ...adoptOptions,
                runIdPrefix: optionalString(args, "runIdPrefix", "arguments"),
              })
            : await adoptNexusAutomationCurrentAgent(adoptOptions)),
        });
      }
      case "current_agent_record":
        return toolResult({
          ok: true,
          ...recordNexusAutomationCurrentAgentAdoptionResult({
            projectRoot: projectRootFromArgs(args),
            runId: requiredString(args, "runId", "arguments"),
            result: currentAgentResultFromArgs(args),
            now: context.now,
          }),
        });
      case "worktree_prepare": {
        const projectRoot = projectRootFromArgs(args);
        const componentId = optionalString(args, "componentId", "arguments");
        const projectMeta = optionalBoolean(args, "projectMeta", "arguments");
        const workItemId = optionalNullableString(
          args,
          "workItemId",
          "arguments",
        );
        const workItemTitle = optionalNullableString(
          args,
          "workItemTitle",
          "arguments",
        );
        const topic = optionalNullableString(args, "topic", "arguments");
        const resolvedWorkItem = await resolveNexusManualWorktreeWorkItem({
          projectRoot,
          componentId,
          projectMeta,
          workItemId,
          workItemTitle,
          topic,
          now: context.now,
        });
        return toolResult({
          ok: true,
          ...prepareNexusManualWorktree({
            projectRoot,
            componentId: resolvedWorkItem.componentId ?? componentId,
            projectMeta,
            workItemId: resolvedWorkItem.itemId ?? workItemId,
            workItemTitle:
              workItemTitle ?? resolvedWorkItem.workItem?.title ?? null,
            workItemDescription: resolvedWorkItem.workItem?.description ?? null,
            topic,
            branchName: optionalString(args, "branchName", "arguments"),
            worktreeName: optionalString(args, "worktreeName", "arguments"),
            baseRef: optionalNullableString(args, "baseRef", "arguments"),
            gitRunner: context.gitRunner,
            now: context.now,
          }),
        });
      }
      case "coordination_status":
        return toolResult({
          ok: true,
          status: await getNexusCoordinationStatus({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: optionalString(args, "workItemId", "arguments"),
            currentPath:
              optionalString(args, "currentPath", "arguments") ??
              context.currentPath ??
              process.cwd(),
            gitRunner: context.gitRunner,
            now: context.now,
          }),
        });
      case "coordination_handoff":
        return toolResult({
          ok: true,
          ...(await createNexusCoordinationHandoff({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: requiredString(args, "workItemId", "arguments"),
            status: parseNexusCoordinationHandoffStatus(
              requiredString(args, "status", "arguments"),
              "arguments.status",
            ),
            hostId: optionalString(args, "hostId", "arguments"),
            agentId: optionalString(args, "agentId", "arguments"),
            changedAreas:
              optionalStringArray(args, "changedAreas", "arguments") ?? [],
            decisions: optionalStringArray(args, "decisions", "arguments") ?? [],
            verificationSummary: optionalNullableString(
              args,
              "verificationSummary",
              "arguments",
            ),
            integrationPreference: optionalNullableString(
              args,
              "integrationPreference",
              "arguments",
            ),
            note: optionalNullableString(args, "note", "arguments"),
            currentPath:
              optionalString(args, "currentPath", "arguments") ??
              context.currentPath ??
              process.cwd(),
            gitRunner: context.gitRunner,
            now: context.now,
          })),
        });
      case "coordination_integrate":
        return toolResult({
          ok: true,
          plan: await getNexusCoordinationIntegrationPlan({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: optionalString(args, "workItemId", "arguments"),
            targetBranch: optionalString(args, "targetBranch", "arguments"),
            fetch: optionalBoolean(args, "fetch", "arguments"),
            currentPath:
              optionalString(args, "currentPath", "arguments") ??
              context.currentPath ??
              process.cwd(),
            gitRunner: context.gitRunner,
            now: context.now,
          }),
        });
      case "coordination_request":
        return toolResult({
          ok: true,
          ...(await createNexusCoordinationRequest({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: optionalString(args, "workItemId", "arguments"),
            intent: parseNexusCoordinationRequestIntent(
              requiredString(args, "intent", "arguments"),
              "arguments.intent",
            ),
            question: optionalNullableString(args, "question", "arguments"),
            note: optionalNullableString(args, "note", "arguments"),
            target: optionalNullableString(args, "target", "arguments"),
            hostId: optionalString(args, "hostId", "arguments"),
            agentId: optionalString(args, "agentId", "arguments"),
            responseStatus: hasOwn(args, "responseStatus")
              ? parseNexusCoordinationRequestStatus(
                  requiredString(args, "responseStatus", "arguments"),
                  "arguments.responseStatus",
                )
              : undefined,
            responseSummary: optionalNullableString(
              args,
              "responseSummary",
              "arguments",
            ),
            responder: optionalNullableString(args, "responder", "arguments"),
            requestedChanges:
              optionalStringArray(args, "requestedChanges", "arguments") ?? [],
            currentPath:
              optionalString(args, "currentPath", "arguments") ??
              context.currentPath ??
              process.cwd(),
            gitRunner: context.gitRunner,
            now: context.now,
          })),
        });
      case "work_item_create":
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).createWorkItem({
            ...projectSelectorFromArgs(args),
            title: requiredString(args, "title", "arguments"),
            description: optionalNullableString(args, "description", "arguments"),
            status: optionalWorkStatus(args, "status", "arguments"),
            labels: optionalStringArray(args, "labels", "arguments") ?? [],
            assignees: optionalStringArray(args, "assignees", "arguments") ?? [],
            milestone: optionalNullableString(args, "milestone", "arguments"),
          }),
        });
      case "work_item_list":
        return toolResult({
          ok: true,
          workItems: await workItemServiceFromArgs(args, context).listWorkItems({
            ...projectSelectorFromArgs(args),
            status: optionalWorkStatusQuery(args, "status", "arguments"),
            labels: optionalStringArray(args, "labels", "arguments"),
            assignees: optionalStringArray(args, "assignees", "arguments"),
            search: optionalString(args, "search", "arguments"),
            limit: optionalPositiveInteger(args, "limit", "arguments"),
          }),
        });
      case "work_item_get": {
        const { selector, ref } = workItemSelectorRefFromArgs(args);
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).getWorkItem({
            ...selector,
            ...ref,
          }),
        });
      }
      case "work_item_update": {
        const { selector, ref } = workItemSelectorRefFromArgs(args);
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).updateWorkItem({
            ...selector,
            ref,
            patch: workItemPatchFromArgs(args),
          }),
        });
      }
      case "work_item_comment": {
        const { selector, ref } = workItemSelectorRefFromArgs(args);
        return toolResult({
          ok: true,
          comment: await workItemServiceFromArgs(args, context).addComment({
            ...selector,
            ref,
            body: requiredString(args, "body", "arguments"),
          }),
        });
      }
      case "work_item_set_status": {
        const { selector, ref } = workItemSelectorRefFromArgs(args);
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).setStatus({
            ...selector,
            ref,
            status: parseWorkStatus(
              requiredString(args, "status", "arguments"),
              "arguments.status",
            ),
          }),
        });
      }
      default:
        return toolResult(
          {
            ok: false,
            error: `Unknown DevNexus MCP tool: ${name}`,
          },
          true,
        );
    }
  } catch (error) {
    return toolResult(
      {
        ok: false,
        ...nexusCoordinationErrorPayload(error),
      },
      true,
    );
  }
}

export async function handleDevNexusMcpJsonRpcMessage(
  message: JsonRpcRequest,
): Promise<unknown | undefined> {
  switch (message.method) {
    case "initialize":
      return jsonRpcResult(message.id, {
        protocolVersion: devNexusMcpProtocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "dev-nexus",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listDevNexusMcpTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callDevNexusMcpTool(params.name, params.arguments),
      );
    }
    default:
      if (message.id === undefined) {
        return undefined;
      }

      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export async function runDevNexusMcpStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(handleDevNexusMcpJsonRpcMessage);
  await transport.start();
}

function workItemServiceFromArgs(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
) {
  const homePath = homePathFromArgs(args);
  return createWorkItemService({
    resolveProject: (selector) => resolveWorkItemProject(selector, homePath),
    now: context.now,
  });
}

function targetCycleLedgerFromArgs(args: Record<string, unknown>): {
  projectRoot: string;
  projectId: string;
  ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
} {
  const { projectRoot, projectConfig, automationConfig } =
    targetCycleProjectFromArgs(args);
  return {
    projectRoot,
    projectId: projectConfig.id,
    ledger: readNexusAutomationTargetCycleLedger(projectRoot, automationConfig),
  };
}

function appendTargetCycleFromArgs(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
): {
  projectRoot: string;
  projectId: string;
  record: ReturnType<typeof readNexusAutomationTargetCycleLedger>["cycles"][number];
  ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
} {
  const { projectRoot, projectConfig, automationConfig } =
    targetCycleProjectFromArgs(args);
  const cycleId = optionalString(args, "cycleId", "arguments");
  const ledger = appendNexusAutomationTargetCycleRecord({
    projectRoot,
    config: automationConfig,
    now: context.now?.(),
    record: {
      ...(cycleId ? { id: cycleId } : {}),
      projectId: projectConfig.id,
      targetId: automationConfig.target.id,
      objective: automationConfig.target.objective,
      runId: optionalNullableString(args, "runId", "arguments") ?? null,
      status: parseTargetCycleStatus(
        requiredString(args, "status", "arguments"),
        "arguments.status",
      ),
      summary: optionalNullableString(args, "summary", "arguments") ?? null,
      eligibleWorkItemCount: optionalNullableNonNegativeInteger(
        args,
        "eligibleWorkItemCount",
        "arguments",
      ),
      workItems: optionalTargetCycleWorkItems(args, "workItems", "arguments") ?? [],
      blockers: optionalStringArray(args, "blockers", "arguments") ?? [],
      notes: optionalStringArray(args, "notes", "arguments") ?? [],
    },
  });

  return {
    projectRoot,
    projectId: projectConfig.id,
    record: ledger.cycles.at(-1)!,
    ledger,
  };
}

function currentAgentResultFromArgs(
  args: Record<string, unknown>,
): NexusAutomationCurrentAgentAdoptionResultInput {
  const result = asRecord(args.result, "arguments.result");
  return {
    status: parseCurrentAgentResultStatus(
      requiredString(result, "status", "arguments.result"),
      "arguments.result.status",
    ),
    summary: requiredString(result, "summary", "arguments.result"),
    ...(hasOwn(result, "commitIds")
      ? {
          commitIds:
            optionalStringArray(result, "commitIds", "arguments.result") ?? [],
        }
      : {}),
    ...(hasOwn(result, "verification")
      ? {
          verification:
            currentAgentVerificationFromArgs(
              result,
              "verification",
              "arguments.result",
            ) ?? [],
        }
      : {}),
    ...(hasOwn(result, "publicationDecision")
      ? {
          publicationDecision: currentAgentPublicationDecisionFromArgs(
            asRecord(
              result.publicationDecision,
              "arguments.result.publicationDecision",
            ),
          ),
        }
      : {}),
    ...(hasOwn(result, "error")
      ? { error: optionalNullableString(result, "error", "arguments.result") ?? null }
      : {}),
  };
}

function currentAgentVerificationFromArgs(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NonNullable<NexusAutomationCurrentAgentAdoptionResultInput["verification"]> | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an array`);
  }

  return value.map((item, index) => {
    const itemPath = `${pathName}.${key}[${index}]`;
    const verification = asRecord(item, itemPath);
    return {
      command: requiredString(verification, "command", itemPath),
      ...(hasOwn(verification, "status")
        ? {
            status: parseVerificationStatus(
              requiredString(verification, "status", itemPath),
              `${itemPath}.status`,
            ),
          }
        : {}),
      ...(hasOwn(verification, "summary")
        ? {
            summary:
              optionalNullableString(verification, "summary", itemPath) ?? null,
          }
        : {}),
    };
  });
}

function currentAgentPublicationDecisionFromArgs(
  record: Record<string, unknown>,
): NonNullable<NexusAutomationCurrentAgentAdoptionResultInput["publicationDecision"]> {
  return {
    type: parsePublicationDecisionType(
      requiredString(record, "type", "arguments.result.publicationDecision"),
      "arguments.result.publicationDecision.type",
    ),
    targetBranch:
      optionalNullableString(
        record,
        "targetBranch",
        "arguments.result.publicationDecision",
      ) ?? null,
    remote:
      optionalNullableString(
        record,
        "remote",
        "arguments.result.publicationDecision",
      ) ?? null,
    prUrl:
      optionalNullableString(
        record,
        "prUrl",
        "arguments.result.publicationDecision",
      ) ?? null,
    reason:
      optionalNullableString(
        record,
        "reason",
        "arguments.result.publicationDecision",
      ) ?? null,
  };
}

function targetCycleProjectFromArgs(args: Record<string, unknown>): {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NonNullable<NexusProjectConfig["automation"]>;
} {
  const projectRoot = projectRootFromArgs(args);
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation;
  if (!automationConfig) {
    throw new Error("Project automation is not configured");
  }

  return { projectRoot, projectConfig, automationConfig };
}

function resolveWorkItemProject(
  selector: WorkItemProjectSelector,
  homePath: string,
): ResolvedWorkItemProjectContext {
  const projectRoot = selector.projectRoot
    ? path.resolve(selector.projectRoot)
    : getNexusProjectStatus({
        homePath,
        homeStore: fileProjectHomeStore(),
        project: requiredPlainString(selector.project, "project"),
      }).project.projectRoot;
  const config = loadProjectConfig(projectRoot);
  const componentId = selector.componentId;
  const component = componentId
    ? resolveProjectComponents(projectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(projectRoot, config);
  if (!component) {
    throw new Error(`Project component is not configured: ${componentId}`);
  }
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    homePath: config.home ?? homePath,
    projectRoot,
    projectId: config.id,
    projectName: config.name,
    componentId: component.id,
    componentName: component.name,
    sourceRoot: component.sourceRoot,
    defaultTrackerId: component.defaultTrackerId,
    workTrackers: component.workTrackers.map((tracker) => ({
      id: tracker.id,
      name: tracker.name,
      enabled: tracker.enabled,
      roles: tracker.roles,
      workTracking: tracker.workTracking,
    })),
    workTracking: component.workTracking,
  };
}

function projectRootFromArgs(args: Record<string, unknown>): string {
  const projectRoot = optionalString(args, "projectRoot", "arguments");
  if (projectRoot) {
    return path.resolve(projectRoot);
  }

  return projectStatusFromArgs(args).projectRoot;
}

function projectStatusFromArgs(args: Record<string, unknown>): NexusProjectStatusBase {
  const project = requiredString(args, "project", "arguments");
  const homePath = optionalString(args, "homePath", "arguments");
  if (homePath) {
    return getNexusProjectStatus({
      homePath,
      homeStore: fileProjectHomeStore(),
      project,
    }).project;
  }

  try {
    return buildNexusProjectStatusForPath(project);
  } catch (pathError) {
    try {
      return getNexusProjectStatus({
        homePath: defaultNexusHomePath(),
        homeStore: fileProjectHomeStore(),
        project,
      }).project;
    } catch {
      throw pathError;
    }
  }
}

function fileProjectHomeStore(): NexusProjectHomeStore<NexusHomeConfigBase> {
  return {
    resolveHomePath: resolveNexusHome,
    loadHomeConfig: (homePath) =>
      loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
    saveHomeConfig: (homePath, registry) =>
      saveNexusHomeConfigFile(homePath, registry, validateNexusHomeConfigBase),
  };
}

function homePathFromArgs(args: Record<string, unknown>): string {
  return optionalString(args, "homePath", "arguments") ?? defaultNexusHomePath();
}

function projectSelectorFromArgs(args: Record<string, unknown>): WorkItemProjectSelector {
  const project = optionalString(args, "project", "arguments");
  const projectRoot = optionalString(args, "projectRoot", "arguments");
  const componentId = optionalString(args, "componentId", "arguments");
  const trackerId = optionalString(args, "trackerId", "arguments");
  return {
    ...(project ? { project } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(componentId ? { componentId } : {}),
    ...(trackerId ? { trackerId } : {}),
  };
}

function workItemSelectorRefFromArgs(args: Record<string, unknown>): {
  selector: WorkItemProjectSelector;
  ref: WorkItemRef;
} {
  const selector = projectSelectorFromArgs(args);
  const ref = workItemRefFromArgs(args);
  const qualified = qualifiedWorkItemId(args, ref.id);
  if (!qualified) {
    const trackerQualified = trackerQualifiedWorkItemId(
      args,
      selector.componentId,
      ref.id,
    );
    if (!trackerQualified) {
      return { selector, ref };
    }
    if (
      selector.trackerId &&
      selector.trackerId !== trackerQualified.trackerId
    ) {
      throw new Error(
        `Work item id tracker "${trackerQualified.trackerId}" conflicts with trackerId "${selector.trackerId}"`,
      );
    }

    return {
      selector: {
        ...selector,
        trackerId: trackerQualified.trackerId,
      },
      ref: {
        ...ref,
        id: trackerQualified.id,
      },
    };
  }

  if (selector.componentId && selector.componentId !== qualified.componentId) {
    throw new Error(
      `Work item id component "${qualified.componentId}" conflicts with componentId "${selector.componentId}"`,
    );
  }

  const componentSelector = {
    ...selector,
    componentId: qualified.componentId,
  };
  const trackerQualified = trackerQualifiedWorkItemId(
    args,
    componentSelector.componentId,
    qualified.id,
  );
  if (!trackerQualified) {
    return {
      selector: componentSelector,
      ref: {
        ...ref,
        id: qualified.id,
      },
    };
  }
  if (
    componentSelector.trackerId &&
    componentSelector.trackerId !== trackerQualified.trackerId
  ) {
    throw new Error(
      `Work item id tracker "${trackerQualified.trackerId}" conflicts with trackerId "${componentSelector.trackerId}"`,
    );
  }

  return {
    selector: {
      ...componentSelector,
      trackerId: trackerQualified.trackerId,
    },
    ref: {
      ...ref,
      id: trackerQualified.id,
    },
  };
}

function qualifiedWorkItemId(
  args: Record<string, unknown>,
  id: string | undefined,
): { componentId: string; id: string } | null {
  if (!id) {
    return null;
  }

  const split = id.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/);
  if (!split) {
    return null;
  }

  const componentId = split[1]!;
  const itemId = split[2]!.trim();
  if (!itemId) {
    return null;
  }

  const projectRoot = projectRootFromArgs(args);
  const componentIds = new Set(
    resolveProjectComponents(projectRoot, loadProjectConfig(projectRoot)).map(
      (component) => component.id,
    ),
  );
  if (!componentIds.has(componentId)) {
    return null;
  }

  return { componentId, id: itemId };
}

function trackerQualifiedWorkItemId(
  args: Record<string, unknown>,
  componentId: string | undefined,
  id: string | undefined,
): { trackerId: string; id: string } | null {
  if (!id) {
    return null;
  }

  const split = id.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/);
  if (!split) {
    return null;
  }

  const trackerId = split[1]!;
  const itemId = split[2]!.trim();
  if (!itemId) {
    return null;
  }

  const projectRoot = projectRootFromArgs(args);
  const config = loadProjectConfig(projectRoot);
  const component = componentId
    ? resolveProjectComponents(projectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(projectRoot, config);
  if (!component?.workTrackers.some((tracker) => tracker.id === trackerId)) {
    return null;
  }

  return { trackerId, id: itemId };
}

function workItemRefFromArgs(args: Record<string, unknown>): WorkItemRef {
  const ref = args.ref;
  if (ref !== undefined && ref !== null) {
    return workItemRefFromRecord(asRecord(ref, "arguments.ref"), "arguments.ref");
  }

  return workItemRefFromRecord(args, "arguments");
}

function workItemRefFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): WorkItemRef {
  const provider = optionalString(record, "provider", pathName);
  const id = optionalString(record, "id", pathName);
  const externalRef = record.externalRef;
  return {
    ...(provider ? { provider } : {}),
    ...(id ? { id } : {}),
    ...(externalRef !== undefined && externalRef !== null
      ? {
          externalRef: externalRefFromRecord(
            asRecord(externalRef, `${pathName}.externalRef`),
            `${pathName}.externalRef`,
          ),
        }
      : {}),
  };
}

function externalRefFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): NonNullable<WorkItemRef["externalRef"]> {
  const itemNumber = optionalPositiveInteger(record, "itemNumber", pathName);
  return {
    provider: requiredString(record, "provider", pathName),
    host: optionalNullableString(record, "host", pathName),
    repositoryId: optionalNullableString(record, "repositoryId", pathName),
    repositoryOwner: optionalNullableString(record, "repositoryOwner", pathName),
    repositoryName: optionalNullableString(record, "repositoryName", pathName),
    projectId: optionalNullableString(record, "projectId", pathName),
    boardId: optionalNullableString(record, "boardId", pathName),
    itemId: requiredString(record, "itemId", pathName),
    itemNumber,
    itemKey: optionalNullableString(record, "itemKey", pathName),
    nodeId: optionalNullableString(record, "nodeId", pathName),
    webUrl: optionalNullableString(record, "webUrl", pathName),
  };
}

function workItemPatchFromArgs(args: Record<string, unknown>): WorkItemPatch {
  const patch: WorkItemPatch = {};
  if (hasOwn(args, "title")) {
    patch.title = requiredString(args, "title", "arguments");
  }
  if (hasOwn(args, "description")) {
    patch.description = optionalNullableString(args, "description", "arguments") ?? null;
  }
  if (hasOwn(args, "status")) {
    patch.status = optionalWorkStatus(args, "status", "arguments");
  }
  if (hasOwn(args, "labels")) {
    patch.labels = optionalStringArray(args, "labels", "arguments") ?? [];
  }
  if (hasOwn(args, "assignees")) {
    patch.assignees = optionalStringArray(args, "assignees", "arguments") ?? [];
  }
  if (hasOwn(args, "milestone")) {
    patch.milestone = optionalNullableString(args, "milestone", "arguments") ?? null;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("arguments must include at least one work item field to update");
  }

  return patch;
}

function parseToolCallParams(value: unknown): { name: string; arguments?: unknown } {
  const params = asRecord(value, "params");
  return {
    name: requiredString(params, "name", "params"),
    arguments: params.arguments,
  };
}

function toolResult(value: unknown, isError = false): DevNexusMcpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

export interface StdioJsonRpcTransportStreams {
  stdin: Readable;
  stdout: Writable;
}

export class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);
  private processing = false;

  constructor(
    private readonly onMessage: (
      message: JsonRpcRequest,
    ) => Promise<unknown | undefined>,
    private readonly streams: StdioJsonRpcTransportStreams = {
      stdin: process.stdin,
      stdout: process.stdout,
    },
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.streams.stdin.on("data", (chunk: Buffer | string) => {
        const bufferChunk = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf8");
        this.buffer = Buffer.concat([this.buffer, bufferChunk]);
        void this.processBuffer().catch((error: unknown) => {
          this.send(
            jsonRpcError(
              undefined,
              -32603,
              error instanceof Error ? error.message : String(error),
            ),
          );
        });
      });
      this.streams.stdin.once("end", resolve);
    });
  }

  private async processBuffer(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (true) {
        const headerEnd = this.headerEndIndex();
        if (!headerEnd) {
          return;
        }

        const [endIndex, separatorLength] = headerEnd;
        const header = this.buffer.slice(0, endIndex).toString("utf8");
        const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
        if (!lengthMatch) {
          throw new Error("Missing Content-Length header");
        }

        const contentLength = Number(lengthMatch[1]);
        const messageStart = endIndex + separatorLength;
        const messageEnd = messageStart + contentLength;
        if (this.buffer.length < messageEnd) {
          return;
        }

        const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
        this.buffer = this.buffer.slice(messageEnd);
        const response = await this.onMessage(JSON.parse(body) as JsonRpcRequest);
        if (response) {
          this.send(response);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private headerEndIndex(): [number, number] | undefined {
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    if (crlfIndex >= 0) {
      return [crlfIndex, 4];
    }

    const lfIndex = this.buffer.indexOf("\n\n");
    return lfIndex >= 0 ? [lfIndex, 2] : undefined;
  }

  private send(message: unknown): void {
    const body = JSON.stringify(message);
    this.streams.stdout.write(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    );
  }
}

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string`);
  }

  return value.trim();
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string or null`);
  }

  return value.trim();
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an array of strings`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${pathName}.${key}[${index}] must be a non-empty string`);
    }

    return item.trim();
  });
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${pathName}.${key} must be a positive integer`);
  }

  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = optionalString(record, key, pathName);
  if (!value) {
    throw new Error(`${pathName}.${key} is required`);
  }

  return value;
}

function requiredPlainString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

const workStatuses = new Set<WorkStatus>([
  "todo",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "wont_do",
]);

function parseWorkStatus(value: string, pathName: string): WorkStatus {
  if (!workStatuses.has(value as WorkStatus)) {
    throw new Error(
      `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
    );
  }

  return value as WorkStatus;
}

function parseNexusSetupRecordedStepStatus(
  value: string,
  pathName: string,
): NexusSetupRecordedStepStatus {
  if (
    value === "pending" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be pending, completed, blocked, or skipped`);
}

function optionalWorkStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | undefined {
  const value = optionalString(record, key, pathName);
  return value === undefined ? undefined : parseWorkStatus(value, `${pathName}.${key}`);
}

function optionalWorkStatusQuery(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | WorkStatus[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return parseWorkStatus(value, `${pathName}.${key}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be a status or array of statuses`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${pathName}.${key}[${index}] must be a status`);
    }

    return parseWorkStatus(item, `${pathName}.${key}[${index}]`);
  });
}

function parseTargetCycleStatus(
  value: string,
  pathName: string,
): NexusAutomationTargetCycleStatus {
  if (
    value === "started" ||
    value === "dispatched" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a valid target cycle status`);
}

function parseCurrentAgentResultStatus(
  value: string,
  pathName: string,
): NexusAutomationCurrentAgentAdoptionResultInput["status"] {
  if (
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a valid current-agent result status`);
}

function parseVerificationStatus(
  value: string,
  pathName: string,
): NonNullable<
  NonNullable<NexusAutomationCurrentAgentAdoptionResultInput["verification"]>[number]["status"]
> {
  if (value === "passed" || value === "failed" || value === "not_run") {
    return value;
  }

  throw new Error(`${pathName} must be a valid verification status`);
}

function parsePublicationDecisionType(
  value: string,
  pathName: string,
): NonNullable<
  NexusAutomationCurrentAgentAdoptionResultInput["publicationDecision"]
>["type"] {
  if (
    value === "not_decided" ||
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a valid publication decision type`);
}

function optionalNullableNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${pathName}.${key} must be a non-negative integer or null`);
  }

  return value;
}

function optionalTargetCycleWorkItems(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusAutomationTargetCycleWorkItemInput[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an array`);
  }

  return value.map((item, index) =>
    targetCycleWorkItemFromRecord(
      asRecord(item, `${pathName}.${key}[${index}]`),
      `${pathName}.${key}[${index}]`,
    ),
  );
}

function targetCycleWorkItemFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): NexusAutomationTargetCycleWorkItemInput {
  return {
    componentId: optionalNullableString(record, "componentId", pathName) ?? null,
    id: requiredString(record, "id", pathName),
    title: optionalNullableString(record, "title", pathName) ?? null,
    status: nullableWorkStatus(record, "status", pathName),
    cycleStatus: nullableTargetCycleWorkItemStatus(
      record,
      "cycleStatus",
      pathName,
    ),
    agentProfileId:
      optionalNullableString(record, "agentProfileId", pathName) ?? null,
    notes: optionalNullableString(record, "notes", pathName) ?? null,
  };
}

function nullableWorkStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | null {
  const value = optionalString(record, key, pathName);
  return value === undefined ? null : parseWorkStatus(value, `${pathName}.${key}`);
}

function nullableTargetCycleWorkItemStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusAutomationTargetCycleWorkItemInput["cycleStatus"] {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return null;
  }
  if (
    value === "eligible" ||
    value === "selected" ||
    value === "dispatched" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName}.${key} must be a valid target cycle work item status`);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
