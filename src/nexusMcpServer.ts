import path from "node:path";
import process from "node:process";
import type { Readable, Writable } from "node:stream";
import {
  NexusAuthorityMutationError,
  nexusAuthorityMutationBlock,
  resolveNexusCurrentAutomationActor,
  resolveNexusEffectiveAuthorityForCurrentActor,
  unconfiguredNexusAuthorityAllowedResolution,
  type NexusAuthorityAction,
  type NexusAuthorityMutationBlock,
  type NexusEffectiveAuthorityResolution,
} from "./nexusAuthority.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  resolveNexusHome,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  applyNexusProjectHosting,
  planNexusProjectHosting,
  statusNexusProjectHosting,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingLocalRemoteCommand,
  type NexusProjectHostingLocalRemoteCommandResult,
  type NexusProjectHostingLocalRemoteRecord,
  type NexusProjectHostingProviderAdapter,
  type NexusProjectHostingStatusResult,
} from "./nexusProjectHosting.js";
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
  getNexusWorkItemDiscoveryStatus,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  createHostAuthProfileCredentialBroker,
  type NexusProviderCredentialCommandRunner,
} from "./nexusProviderCredentialBroker.js";
import {
  claimNexusEligibleWorkItem,
  type NexusEligibleWorkClaimProviderFactory,
  type NexusWorkItemStaleClaimPolicy,
} from "./nexusWorkItemClaim.js";
import {
  getNexusAutomationStatus,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  prepareNexusAutomationHeartbeat,
  type NexusAutomationHeartbeatStatus,
} from "./nexusAutomationHeartbeat.js";
import {
  getNexusAutomationAgentProfileSummary,
} from "./nexusAutomationAgentSurface.js";
import {
  loadNexusPublicationAuthProfiles,
  resolveNexusPublicationPolicy,
} from "./nexusPublicationPolicy.js";
import {
  getNexusEligibleWorkSummary,
  type NexusEligibleWorkMode,
} from "./nexusEligibleWorkSummary.js";
import {
  defaultNexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import {
  probeCodexAppServerInitialize,
} from "./codexAppServerInitializeProbe.js";
import {
  appendNexusAutomationTargetCycleRecord,
  maxNexusAutomationTargetCycleNoteLength,
  nexusAutomationTargetCycleLedgerPath,
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleRecord,
  type NexusAutomationTargetCycleStatus,
  type NexusAutomationTargetCycleWorkItemInput,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
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
  type NexusCoordinationStatus,
} from "./nexusCoordination.js";
import {
  createNexusCoordinationRequest,
  parseNexusCoordinationRequestIntent,
  parseNexusCoordinationRequestStatus,
} from "./nexusCoordinationRequest.js";
import {
  createNexusRemoteExecutionRequest,
  getNexusRemoteExecutionRecord,
  maxNexusRemoteExecutionOutputTailLength,
  recordNexusRemoteExecutionResult,
  type NexusRemoteExecutionAttachmentRef,
} from "./nexusRemoteExecution.js";
import {
  planNexusSshExecution,
} from "./nexusSshExecutionPlan.js";
import {
  checkNexusHostCapabilities,
  type NexusHostCheckMode,
  type NexusHostCheckMockFacts,
} from "./nexusHostCheck.js";
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
  summarizeNexusManualWorktreeResult,
} from "./nexusManualWorktree.js";
import {
  assertNexusSharedCheckoutMutationAllowed,
  NexusSharedCheckoutGuardError,
  type NexusCheckoutMutationClass,
  type NexusSharedCheckoutGuardOverride,
} from "./nexusSharedCheckoutGuard.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
  type WorkItemProjectSelector,
} from "./workItemService.js";
import {
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import {
  createWorkItemSyncPlan,
  defaultWorkItemSyncPolicy,
  executeWorkItemSync,
  parseWorkItemSyncCommentPolicyMode,
  parseWorkItemSyncConflictPolicyMode,
  parseWorkItemSyncCredentialPolicy,
  parseWorkItemSyncDirection,
  parseWorkItemSyncField,
  parseWorkItemSyncWriteDisposition,
  type WorkItemSyncPolicyConfig,
} from "./workItemSyncPlanner.js";
import {
  createWorkItemImportPlan,
  defaultWorkItemImportPolicy,
  executeWorkItemImport,
  parseWorkItemImportDirection,
  parseWorkItemImportFingerprint,
  type WorkItemImportExecutionAuthorityInput,
  type WorkItemImportPolicyConfig,
} from "./workItemImportPlanner.js";
import {
  createWorkItemTrackerLinkService,
} from "./workItemTrackerLinks.js";
import { providerCompatibleMcpTools } from "./nexusMcpSchemaCompatibility.js";
import { defaultGitRunner, type GitRunner } from "./gitWorktreeService.js";
import type {
  WorkItem,
  WorkItemPatch,
  WorkItemRef,
  WorkStatus,
  WorkStatusQuery,
} from "./workTrackingTypes.js";
import type { NexusRunnerMutationClass } from "./nexusRunnerProfile.js";
import type { NexusAutomationCommandRunner } from "./nexusAutomationCommandExecutor.js";

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
  commandRunner?: NexusAutomationCommandRunner;
  hostingProvider?: NexusProjectHostingProviderAdapter;
  currentPath?: string;
  mcpRuntimeStartedAt?: Date | string;
  sharedCheckoutGuard?: "enforce" | "disabled";
  sharedCheckoutGuardOverride?: NexusSharedCheckoutGuardOverride | null;
  workItemProviderOptions?: CreateWorkTrackerProviderOptions;
  workItemCredentialCommandRunner?: NexusProviderCredentialCommandRunner;
  workItemClaimProviderFactory?: NexusEligibleWorkClaimProviderFactory;
  workItemClaimLeaseTokenFactory?: () => string;
}

export interface DevNexusMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface NexusMcpRuntimeSummary {
  serverName: "dev-nexus";
  protocolVersion: string;
  startedAt: string;
  processId: number;
  nodeVersion: string;
  command: string | null;
  stale: boolean;
  warningCount: number;
  warnings: string[];
  source: {
    componentId: string;
    sourceRoot: string;
    sourceRootExists: boolean;
    headCommit: string | null;
    headCommitDate: string | null;
  } | null;
}

const devNexusMcpServerStartedAt = new Date();

const tools: McpTool[] = [
  {
    name: "project_status",
    description: "Show one DevNexus workspace by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "project_hosting_status",
    description: "Report read-only DevNexus workspace hosting status without mutating local remotes or provider state.",
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
    name: "project_hosting_plan",
    description: "Build a deterministic dry-run DevNexus workspace hosting plan without applying repairs.",
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
    name: "project_hosting_apply",
    description: "Apply policy-gated DevNexus workspace hosting repairs.",
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
    name: "automation_status",
    description: "Read DevNexus automation readiness, target context, and eligible work without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
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
        mode: { enum: ["default", "discovery"] },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_profiles",
    description: "Inspect concise DevNexus coordinator and subagent profile policy without dumping full workspace config.",
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
    name: "codex_app_server_probe",
    description: "Safely initialize the configured Codex app-server and report advertised methods and capability blockers without starting turns.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        profileId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "automation_heartbeat_prepare",
    description: "Prepare a Codex heartbeat automation recipe and prompt for a DevNexus workspace without mutating Codex or provider state.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: ["string", "null"] },
        intervalMinutes: { type: ["number", "null"] },
        status: {
          type: ["string", "null"],
          enum: ["ACTIVE", "PAUSED", null],
        },
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
    description: "Build a guided setup plan for a DevNexus workspace without reading secrets or mutating host state.",
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
    description: "Check safe local setup facts for a DevNexus workspace without contacting external providers.",
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
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
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
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
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
                  "failed",
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
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
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
    description: "Prepare an isolated Git worktree and branch for manual parallel agent work. Returns a compact summary with paths to generated context files.",
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
        hostId: { type: ["string", "null"] },
        agentId: { type: ["string", "null"] },
        workerAgentProvider: { type: ["string", "null"] },
        writeScope: { type: "array", items: { type: "string" } },
        leaseNotes: { type: "array", items: { type: "string" } },
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
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        workItemId: { type: "string" },
        trackerId: { type: "string" },
        trackerRole: { type: "string" },
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
        trackerId: { type: "string" },
        trackerRole: { type: "string" },
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
        trackerId: { type: "string" },
        trackerRole: { type: "string" },
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
        trackerId: { type: "string" },
        trackerRole: { type: "string" },
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
    name: "host_check",
    description: "Run a read-only local or mocked remote host capability check.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        hostId: { type: "string" },
        mode: { type: "string", enum: ["local", "mock-remote"] },
        mockFacts: { type: "object" },
      },
      required: ["projectRoot"],
      additionalProperties: false,
    },
  },
  {
    name: "remote_execution_request_create",
    description: "Create a draft/local durable remote execution request without running commands.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        workItemId: { type: ["string", "null"] },
        requestingHostId: { type: "string" },
        requestingAgentId: { type: ["string", "null"] },
        targetHostId: { type: ["string", "null"] },
        requiredCapabilities: { type: "array", items: { type: "string" } },
        runnerProfileId: { type: "string" },
        repository: { type: "string" },
        ref: { type: "string" },
        commandProfileId: { type: "string" },
        timeoutMs: { type: "number" },
        expectedArtifacts: { type: "array", items: { type: "string" } },
        mutationClass: {
          type: "string",
          enum: ["none", "verification", "project_local", "live_runtime", "destructive"],
        },
        initialStatus: {
          type: "string",
          enum: [
            "queued",
            "accepted",
            "running",
            "completed",
            "failed",
            "blocked",
            "timed_out",
            "cancelled",
          ],
        },
        attachmentRefs: { type: "array", items: { type: "object" } },
      },
      required: [
        "projectRoot",
        "requestingHostId",
        "runnerProfileId",
        "repository",
        "ref",
        "commandProfileId",
        "timeoutMs",
        "mutationClass",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "remote_execution_result_record",
    description: "Record a draft/local remote execution result without running commands.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        status: {
          type: "string",
          enum: [
            "queued",
            "accepted",
            "running",
            "completed",
            "failed",
            "blocked",
            "timed_out",
            "cancelled",
          ],
        },
        hostId: { type: "string" },
        runnerProfileId: { type: "string" },
        actualRef: { type: ["string", "null"] },
        actualCommit: { type: ["string", "null"] },
        commands: { type: "array", items: { type: "string" } },
        exitCode: { type: ["number", "null"] },
        verificationOutcome: {
          type: "string",
          enum: ["passed", "failed", "not_run", "blocked", "timed_out", "cancelled"],
        },
        outputTail: {
          type: ["string", "null"],
          maxLength: maxNexusRemoteExecutionOutputTailLength,
        },
        artifactRefs: { type: "array", items: { type: "string" } },
        cleanupStatus: {
          type: "string",
          enum: ["not_required", "completed", "failed", "blocked", "unknown"],
        },
        blockerSafetyReason: { type: ["string", "null"] },
      },
      required: [
        "projectRoot",
        "requestId",
        "status",
        "hostId",
        "runnerProfileId",
        "verificationOutcome",
        "cleanupStatus",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "remote_execution_result_get",
    description: "Read a draft/local remote execution request and recorded result by request id.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        requestId: { type: "string" },
      },
      required: ["projectRoot", "requestId"],
      additionalProperties: false,
    },
  },
  {
    name: "remote_execution_ssh_plan",
    description: "Build a sanitized SSH/Tailscale execution plan for a recorded request without running network commands.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        homePath: { type: "string" },
      },
      required: ["projectRoot", "requestId"],
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
    name: "work_item_discovery_status",
    description: "Report read-only tracker discovery status and provider readability without mutating tracker or provider state.",
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
    name: "work_item_claim_next",
    description: "Claim the next eligible work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        trackerId: { type: "string" },
        mode: { type: "string", enum: ["default", "discovery"] },
        hostId: { type: "string" },
        agentId: { type: ["string", "null"] },
        ownerId: { type: ["string", "null"] },
        leaseDurationMs: { type: "number" },
        staleClaimPolicy: {
          type: "string",
          enum: ["report", "reclaim"],
        },
      },
      required: ["hostId"],
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
        limit: { type: "number", default: 50, maximum: 100 },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
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
  {
    name: "work_item_link",
    description: "Link a logical work item to a configured tracker reference.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        logicalItemId: { type: "string" },
        trackerId: { type: "string" },
        provider: { type: "string" },
        host: { type: ["string", "null"] },
        repositoryId: { type: ["string", "null"] },
        repositoryOwner: { type: ["string", "null"] },
        repositoryName: { type: ["string", "null"] },
        projectId: { type: ["string", "null"] },
        boardId: { type: ["string", "null"] },
        itemId: { type: "string" },
        itemNumber: { type: ["number", "null"] },
        itemKey: { type: ["string", "null"] },
        nodeId: { type: ["string", "null"] },
        webUrl: { type: ["string", "null"] },
        observedAt: { type: ["string", "null"] },
      },
      required: ["logicalItemId", "trackerId", "itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_show_links",
    description: "Show tracker references linked to one logical work item.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        logicalItemId: { type: "string" },
      },
      required: ["logicalItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_unlink",
    description: "Unlink a tracker reference from one logical work item and record audit metadata.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        logicalItemId: { type: "string" },
        trackerId: { type: "string" },
        itemId: { type: "string" },
        reason: { type: ["string", "null"] },
      },
      required: ["logicalItemId", "trackerId", "itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_sync_plan",
    description: "Build a mutation-free dry-run plan for syncing work items from one configured tracker to another.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        sourceTrackerId: { type: "string" },
        targetTrackerId: { type: "string" },
        direction: { type: "string", enum: ["source_to_target"] },
        filters: { type: "object" },
        fieldSet: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "title",
              "description",
              "status",
              "labels",
              "assignees",
              "milestone",
            ],
          },
        },
        commentPolicy: { type: "string", enum: ["ignore", "plan"] },
        statusMapping: { type: "object" },
        conflictPolicy: {
          type: "string",
          enum: ["block", "source_wins", "target_wins"],
        },
        writePolicy: { type: "object" },
      },
      required: ["sourceTrackerId", "targetTrackerId"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_import_plan",
    description: "Build a strictly read-only inbound GitHub-to-local work-item import plan.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        sourceTrackerId: { type: "string" },
        targetTrackerId: { type: "string" },
        direction: { type: "string", enum: ["external_to_local"] },
        filters: { type: "object" },
        fieldSet: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "title",
              "description",
              "status",
              "labels",
              "assignees",
              "milestone",
            ],
          },
        },
        statusMapping: { type: "object" },
        conflictPolicy: {
          type: "string",
          enum: ["block", "source_wins", "target_wins"],
        },
        writePolicy: { type: "object" },
        fingerprints: {
          type: "array",
          items: {
            type: "string",
            enum: ["external_ref", "web_url", "title"],
          },
        },
      },
      required: ["sourceTrackerId", "targetTrackerId"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_import_execute",
    description: "Execute a policy-gated inbound GitHub-to-local work-item import without provider writes.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        sourceTrackerId: { type: "string" },
        targetTrackerId: { type: "string" },
        direction: { type: "string", enum: ["external_to_local"] },
        filters: { type: "object" },
        fieldSet: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "title",
              "description",
              "status",
              "labels",
              "assignees",
              "milestone",
            ],
          },
        },
        statusMapping: { type: "object" },
        conflictPolicy: {
          type: "string",
          enum: ["block", "source_wins", "target_wins"],
        },
        writePolicy: { type: "object" },
        fingerprints: {
          type: "array",
          items: {
            type: "string",
            enum: ["external_ref", "web_url", "title"],
          },
        },
      },
      required: [
        "sourceTrackerId",
        "targetTrackerId",
        "direction",
        "writePolicy",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_sync_execute",
    description: "Execute an explicitly policy-gated one-way local-to-GitHub work-item sync and record a run summary.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        sourceTrackerId: { type: "string" },
        targetTrackerId: { type: "string" },
        direction: { type: "string", enum: ["source_to_target"] },
        filters: { type: "object" },
        fieldSet: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "title",
              "description",
              "status",
              "labels",
              "assignees",
              "milestone",
            ],
          },
        },
        commentPolicy: { type: "string", enum: ["ignore", "plan"] },
        statusMapping: { type: "object" },
        conflictPolicy: {
          type: "string",
          enum: ["block", "source_wins", "target_wins"],
        },
        writePolicy: { type: "object" },
        recordRun: { type: "boolean" },
      },
      required: ["sourceTrackerId", "targetTrackerId"],
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
      case "project_status": {
        const detail = mcpDetailFromArgs(args);
        const project = projectStatusFromArgs(args);
        return toolResult({
          ok: true,
          detail,
          project: detail === "full" ? project : summarizeProjectStatus(project),
        });
      }
      case "project_hosting_status":
        return toolResult({
          ok: true,
          ...(await projectHostingStatusFromArgs(args, context)),
        });
      case "project_hosting_plan": {
        const hostingStatus = await projectHostingStatusFromArgs(args, context);
        const config = loadProjectConfig(hostingStatus.projectRoot);
        return toolResult({
          ok: true,
          ...hostingStatus,
          plan: planNexusProjectHosting({
            hosting: config.hosting,
            status: hostingStatus.status,
          }),
        });
      }
      case "project_hosting_apply": {
        const hostingStatus = await projectHostingStatusFromArgs(args, context);
        assertMcpMutationAllowed(args, context, {
          command: "project_hosting_apply",
          mutationClass: "local_remote_repair",
        });
        const config = loadProjectConfig(hostingStatus.projectRoot);
        const authProfiles = projectHostingAuthProfiles(
          config,
          optionalString(args, "homePath", "arguments"),
        );
        const apply = await applyNexusProjectHosting({
          hosting: config.hosting,
          status: hostingStatus.status,
          ...(authProfiles.length > 0 ? { authProfiles } : {}),
          ...(context.hostingProvider ? { provider: context.hostingProvider } : {}),
          runLocalRemoteCommand: projectHostingLocalRemoteCommandRunner(
            hostingStatus.projectRoot,
            context.gitRunner,
          ),
          refreshStatus: () =>
            projectHostingStatusFromArgs(args, context).then(
              (result) => result.status,
            ),
        });
        return toolResult({
          ok: apply.ok,
          ...hostingStatus,
          apply,
        });
      }
      case "automation_status": {
        const detail = mcpDetailFromArgs(args);
        const projectRoot = projectRootFromArgs(args);
        const status = await getNexusAutomationStatus({
          projectRoot,
          homePath: optionalString(args, "homePath", "arguments"),
          now: context.now,
        });
        return toolResult({
          ok: true,
          detail,
          mcpRuntime: mcpRuntimeSummaryForProject(projectRoot, context),
          ...(detail === "full" ? status : summarizeAutomationStatus(status)),
        });
      }
      case "eligible_work": {
        const projectRoot = projectRootFromArgs(args);
        return toolResult({
          ok: true,
          mcpRuntime: mcpRuntimeSummaryForProject(projectRoot, context),
          ...(await getNexusEligibleWorkSummary({
            projectRoot,
            eligibleWorkMode: optionalEligibleWorkMode(args, "mode", "arguments"),
            now: context.now,
          })),
        });
      }
      case "agent_profiles":
        return toolResult({
          ok: true,
          ...getNexusAutomationAgentProfileSummary(projectRootFromArgs(args)),
        });
      case "codex_app_server_probe": {
        const probe = await probeCodexAppServerInitialize({
          projectRoot: projectRootFromArgs(args),
          profileId: optionalString(args, "profileId", "arguments"),
        });
        return toolResult({
          ok: probe.status === "ready",
          probe,
        });
      }
      case "automation_heartbeat_prepare":
        return toolResult({
          ok: true,
          ...prepareNexusAutomationHeartbeat({
            projectRoot: projectRootFromArgs(args),
            name: optionalNullableString(args, "name", "arguments"),
            intervalMinutes: optionalPositiveInteger(
              args,
              "intervalMinutes",
              "arguments",
            ),
            status: optionalHeartbeatStatus(args, "status", "arguments"),
          }),
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
        assertMcpMutationAllowed(args, context, {
          command: "setup_record",
          mutationClass: "project_state",
        });
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
        {
          const detail = mcpDetailFromArgs(args);
          return toolResult({
            ok: true,
            detail,
            ...targetCycleLedgerFromArgs(args, detail),
          });
        }
      case "target_cycle_record": {
        const detail = mcpDetailFromArgs(args);
        assertMcpMutationAllowed(args, context, {
          command: "target_cycle_record",
          mutationClass: "target_state",
        });
        const result = appendTargetCycleFromArgs(args, context);
        return toolResult({
          ok: true,
          detail,
          ...summarizeTargetCycleRecordResult(result, detail),
        });
      }
      case "target_report": {
        const detail = mcpDetailFromArgs(args);
        const projectRoot = projectRootFromArgs(args);
        const report = buildNexusAutomationTargetReport({
          projectRoot,
          now: context.now?.(),
        });
        return toolResult({
          ok: true,
          detail,
          mcpRuntime: mcpRuntimeSummaryForProject(projectRoot, context),
          report: detail === "full" ? report : summarizeTargetReport(report),
        });
      }
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
        assertMcpMutationAllowed(args, context, {
          command: "current_agent_record",
          mutationClass: "target_state",
        });
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
        assertMcpMutationAllowed(args, context, {
          command: "worktree_prepare",
          mutationClass: "worktree_bootstrap",
          componentId,
        });
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
        const prepared = prepareNexusManualWorktree({
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
          hostId: optionalNullableString(args, "hostId", "arguments"),
          agentId: optionalNullableString(args, "agentId", "arguments"),
          workerAgentProvider: optionalNullableString(
            args,
            "workerAgentProvider",
            "arguments",
          ),
          writeScope: optionalStringArray(args, "writeScope", "arguments") ?? [],
          leaseNotes: optionalStringArray(args, "leaseNotes", "arguments") ?? [],
          gitRunner: context.gitRunner,
          now: context.now,
        });
        return toolResult({
          ok: true,
          ...summarizeNexusManualWorktreeResult(prepared),
        });
      }
      case "coordination_status": {
        const detail = mcpDetailFromArgs(args);
        const status = await getNexusCoordinationStatus({
          projectRoot: projectRootFromArgs(args),
          componentId: optionalString(args, "componentId", "arguments"),
          workItemId: optionalString(args, "workItemId", "arguments"),
          trackerId: optionalString(args, "trackerId", "arguments"),
          trackerRole: optionalString(args, "trackerRole", "arguments"),
          currentPath: optionalString(args, "currentPath", "arguments"),
          gitRunner: context.gitRunner,
          now: context.now,
        });
        return toolResult({
          ok: true,
          detail,
          status: detail === "full" ? status : summarizeCoordinationStatus(status),
        });
      }
      case "coordination_handoff":
        assertMcpMutationAllowed(args, context, {
          command: "coordination_handoff",
          mutationClass: "coordination_record",
          targetPath: optionalString(args, "currentPath", "arguments"),
          componentId: optionalString(args, "componentId", "arguments"),
        });
        return toolResult({
          ok: true,
          ...(await createNexusCoordinationHandoff({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: requiredString(args, "workItemId", "arguments"),
            trackerId: optionalString(args, "trackerId", "arguments"),
            trackerRole: optionalString(args, "trackerRole", "arguments"),
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
            currentPath: optionalString(args, "currentPath", "arguments"),
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
            trackerId: optionalString(args, "trackerId", "arguments"),
            trackerRole: optionalString(args, "trackerRole", "arguments"),
            targetBranch: optionalString(args, "targetBranch", "arguments"),
            fetch: optionalBoolean(args, "fetch", "arguments"),
            currentPath: optionalString(args, "currentPath", "arguments"),
            gitRunner: context.gitRunner,
            now: context.now,
          }),
        });
      case "coordination_request":
        assertMcpMutationAllowed(args, context, {
          command: "coordination_request",
          mutationClass: "coordination_record",
          targetPath: optionalString(args, "currentPath", "arguments"),
          componentId: optionalString(args, "componentId", "arguments"),
        });
        return toolResult({
          ok: true,
          ...(await createNexusCoordinationRequest({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: optionalString(args, "workItemId", "arguments"),
            trackerId: optionalString(args, "trackerId", "arguments"),
            trackerRole: optionalString(args, "trackerRole", "arguments"),
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
            currentPath: optionalString(args, "currentPath", "arguments"),
            gitRunner: context.gitRunner,
            now: context.now,
          })),
        });
      case "host_check":
        return toolResult({
          ok: true,
          result: checkNexusHostCapabilities({
            projectRoot: projectRootFromArgs(args),
            hostId: optionalString(args, "hostId", "arguments"),
            mode: hostCheckModeFromArgs(args),
            mockFacts: hostCheckMockFactsFromArgs(args),
            commandRunner: context.commandRunner,
            now: context.now,
          }),
        });
      case "remote_execution_request_create":
        assertMcpMutationAllowed(args, context, {
          command: "remote_execution_request_create",
          mutationClass: "coordination_record",
          componentId: optionalString(args, "componentId", "arguments"),
        });
        return toolResult({
          ok: true,
          localOnly: true,
          request: createNexusRemoteExecutionRequest({
            projectRoot: projectRootFromArgs(args),
            componentId: optionalString(args, "componentId", "arguments"),
            workItemId: optionalNullableString(args, "workItemId", "arguments"),
            requestingHostId: requiredString(
              args,
              "requestingHostId",
              "arguments",
            ),
            requestingAgentId: optionalNullableString(
              args,
              "requestingAgentId",
              "arguments",
            ),
            targetHostId: optionalNullableString(
              args,
              "targetHostId",
              "arguments",
            ),
            requiredCapabilities:
              optionalStringArray(args, "requiredCapabilities", "arguments") ??
              [],
            runnerProfileId: requiredString(
              args,
              "runnerProfileId",
              "arguments",
            ),
            repository: requiredString(args, "repository", "arguments"),
            ref: requiredString(args, "ref", "arguments"),
            commandProfileId: requiredString(
              args,
              "commandProfileId",
              "arguments",
            ),
            timeoutMs: requiredPositiveInteger(args, "timeoutMs", "arguments"),
            expectedArtifacts:
              optionalStringArray(args, "expectedArtifacts", "arguments") ?? [],
            mutationClass: remoteExecutionMutationClassFromArgs(args),
            initialStatus: optionalString(args, "initialStatus", "arguments"),
            attachmentRefs: remoteExecutionAttachmentRefsFromArgs(args),
            now: context.now,
          }),
        });
      case "remote_execution_result_record":
        assertMcpMutationAllowed(args, context, {
          command: "remote_execution_result_record",
          mutationClass: "coordination_record",
          componentId: optionalString(args, "componentId", "arguments"),
        });
        return toolResult({
          ok: true,
          localOnly: true,
          result: recordNexusRemoteExecutionResult({
            projectRoot: projectRootFromArgs(args),
            requestId: requiredString(args, "requestId", "arguments"),
            status: requiredString(args, "status", "arguments"),
            hostId: requiredString(args, "hostId", "arguments"),
            runnerProfileId: requiredString(
              args,
              "runnerProfileId",
              "arguments",
            ),
            actualRef: optionalNullableString(args, "actualRef", "arguments"),
            actualCommit: optionalNullableString(
              args,
              "actualCommit",
              "arguments",
            ),
            commands:
              optionalStringArray(args, "commands", "arguments") ?? [],
            exitCode: optionalNullableInteger(args, "exitCode", "arguments"),
            verificationOutcome: requiredString(
              args,
              "verificationOutcome",
              "arguments",
            ),
            outputTail: optionalNullableString(args, "outputTail", "arguments"),
            artifactRefs:
              optionalStringArray(args, "artifactRefs", "arguments") ?? [],
            cleanupStatus: requiredString(
              args,
              "cleanupStatus",
              "arguments",
            ),
            blockerSafetyReason: optionalNullableString(
              args,
              "blockerSafetyReason",
              "arguments",
            ),
            now: context.now,
          }),
        });
      case "remote_execution_result_get":
        return toolResult({
          ok: true,
          localOnly: true,
          record: getNexusRemoteExecutionRecord({
            projectRoot: projectRootFromArgs(args),
            requestId: requiredString(args, "requestId", "arguments"),
          }),
        });
      case "remote_execution_ssh_plan":
        return toolResult({
          ok: true,
          localOnly: true,
          plan: planNexusSshExecution({
            projectRoot: projectRootFromArgs(args),
            requestId: requiredString(args, "requestId", "arguments"),
            homePath: optionalString(args, "homePath", "arguments"),
          }),
        });
      case "work_item_create":
        assertMcpMutationAllowed(args, context, {
          command: "work_item_create",
          mutationClass: "local_tracker",
          componentId: optionalString(args, "componentId", "arguments"),
        });
        assertMcpWorkItemAuthorityAllowed(args, [
          ...workItemCreateAuthorityActions(
            args,
            workItemTrackerProviderFromArgs(args),
          ),
        ]);
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
      case "work_item_discovery_status":
        return toolResult({
          ok: true,
          ...getNexusWorkItemDiscoveryStatus({
            projectRoot: projectRootFromArgs(args),
            homePath: optionalString(args, "homePath", "arguments"),
          }),
        });
      case "work_item_claim_next": {
        assertMcpMutationAllowed(args, context, {
          command: "work_item_claim_next",
          mutationClass: "local_tracker",
          componentId: optionalString(args, "componentId", "arguments"),
        });
        const provider = workItemTrackerProviderFromArgs(args, {
          ...projectSelectorFromArgs(args),
          trackerId: optionalString(args, "trackerId", "arguments"),
        });
        assertMcpWorkItemAuthorityAllowed(args, [
          ...workItemPatchAuthorityActions(
            {
              status: "in_progress",
              description: "DevNexus optimistic claim metadata",
            },
            provider,
          ),
          workItemCommentAuthorityAction(provider),
        ]);
        const projectRoot = projectRootFromArgs(args);
        const projectConfig = loadProjectConfig(projectRoot);
        return toolResult({
          ok: true,
          claim: await claimNexusEligibleWorkItem({
            projectRoot,
            projectConfig,
            components: resolveProjectComponents(projectRoot, projectConfig),
            automationConfig:
              projectConfig.automation ?? defaultNexusAutomationConfig,
            componentId: optionalString(args, "componentId", "arguments"),
            trackerId: optionalString(args, "trackerId", "arguments"),
            mode: optionalEligibleWorkMode(args, "mode", "arguments"),
            owner: {
              hostId: requiredString(args, "hostId", "arguments"),
              agentId: optionalNullableString(args, "agentId", "arguments"),
              ownerId: optionalNullableString(args, "ownerId", "arguments"),
            },
            leaseDurationMs: optionalPositiveInteger(
              args,
              "leaseDurationMs",
              "arguments",
            ),
            staleClaimPolicy: optionalStaleClaimPolicy(
              args,
              "staleClaimPolicy",
              "arguments",
            ),
            providerFactory: context.workItemClaimProviderFactory,
            leaseTokenFactory: context.workItemClaimLeaseTokenFactory,
            now: context.now,
          }),
        });
      }
      case "work_item_list": {
        const detail = optionalString(args, "detail", "arguments") ?? "summary";
        if (detail !== "summary" && detail !== "full") {
          throw new Error("arguments.detail must be summary or full");
        }
        const limit = optionalPositiveInteger(args, "limit", "arguments") ?? 50;
        if (limit > 100) {
          throw new Error("arguments.limit must be at most 100");
        }
        const workItems = await workItemServiceFromArgs(args, context).listWorkItems({
          ...projectSelectorFromArgs(args),
          status: optionalWorkStatusQuery(args, "status", "arguments"),
          labels: optionalStringArray(args, "labels", "arguments"),
          assignees: optionalStringArray(args, "assignees", "arguments"),
          search: optionalString(args, "search", "arguments"),
          limit,
        });
        return toolResult({
          ok: true,
          detail,
          limit,
          workItems:
            detail === "full" ? workItems : workItems.map(summarizeWorkItem),
        });
      }
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
        const patch = workItemPatchFromArgs(args);
        assertMcpMutationAllowed(args, context, {
          command: "work_item_update",
          mutationClass: "local_tracker",
          componentId: selector.componentId,
        });
        assertMcpWorkItemAuthorityAllowed(args, [
          ...workItemPatchAuthorityActions(
            patch,
            workItemTrackerProviderFromArgs(args, selector),
          ),
        ]);
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).updateWorkItem({
            ...selector,
            ref,
            patch,
          }),
        });
      }
      case "work_item_comment": {
        const { selector, ref } = workItemSelectorRefFromArgs(args);
        assertMcpMutationAllowed(args, context, {
          command: "work_item_comment",
          mutationClass: "local_tracker",
          componentId: selector.componentId,
        });
        assertMcpWorkItemAuthorityAllowed(args, [
          workItemCommentAuthorityAction(workItemTrackerProviderFromArgs(args, selector)),
        ]);
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
        assertMcpMutationAllowed(args, context, {
          command: "work_item_set_status",
          mutationClass: "local_tracker",
          componentId: selector.componentId,
        });
        assertMcpWorkItemAuthorityAllowed(args, [
          workItemStatusAuthorityAction(workItemTrackerProviderFromArgs(args, selector)),
        ]);
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
      case "work_item_link": {
        const { selector, logicalItemId } = logicalWorkItemFromArgs(args);
        assertMcpMutationAllowed(args, context, {
          command: "work_item_link",
          mutationClass: "local_tracker",
          componentId: selector.componentId,
        });
        return toolResult({
          ok: true,
          ...(await workItemTrackerLinkServiceFromArgs(
            args,
            context,
          ).linkReference({
            ...selector,
            logicalItemId,
            trackerId: requiredString(args, "trackerId", "arguments"),
            provider: optionalString(args, "provider", "arguments"),
            host: optionalNullableString(args, "host", "arguments"),
            repositoryId: optionalNullableString(
              args,
              "repositoryId",
              "arguments",
            ),
            repositoryOwner: optionalNullableString(
              args,
              "repositoryOwner",
              "arguments",
            ),
            repositoryName: optionalNullableString(
              args,
              "repositoryName",
              "arguments",
            ),
            projectId: optionalNullableString(args, "projectId", "arguments"),
            boardId: optionalNullableString(args, "boardId", "arguments"),
            itemId: requiredString(args, "itemId", "arguments"),
            itemNumber:
              optionalPositiveInteger(args, "itemNumber", "arguments") ?? null,
            itemKey: optionalNullableString(args, "itemKey", "arguments"),
            nodeId: optionalNullableString(args, "nodeId", "arguments"),
            webUrl: optionalNullableString(args, "webUrl", "arguments"),
            observedAt: optionalNullableString(args, "observedAt", "arguments"),
          })),
        });
      }
      case "work_item_show_links": {
        const { selector, logicalItemId } = logicalWorkItemFromArgs(args);
        return toolResult({
          ok: true,
          ...(await workItemTrackerLinkServiceFromArgs(
            args,
            context,
          ).showLinks({
            ...selector,
            logicalItemId,
          })),
        });
      }
      case "work_item_unlink": {
        const { selector, logicalItemId } = logicalWorkItemFromArgs(args);
        assertMcpMutationAllowed(args, context, {
          command: "work_item_unlink",
          mutationClass: "local_tracker",
          componentId: selector.componentId,
        });
        return toolResult({
          ok: true,
          ...(await workItemTrackerLinkServiceFromArgs(
            args,
            context,
          ).unlinkReference({
            ...selector,
            logicalItemId,
            trackerId: requiredString(args, "trackerId", "arguments"),
            itemId: requiredString(args, "itemId", "arguments"),
            reason: optionalNullableString(args, "reason", "arguments"),
          })),
        });
      }
      case "work_item_sync_plan": {
        const homePath = homePathFromArgs(args);
        return toolResult({
          ok: true,
          plan: await createWorkItemSyncPlan({
            ...projectSelectorFromArgs(args),
            policy: workItemSyncPolicyFromArgs(args),
            resolveProject: (selector) =>
              resolveWorkItemProject(selector, homePath),
            now: context.now,
          }),
        });
      }
      case "work_item_import_plan": {
        const homePath = homePathFromArgs(args);
        return toolResult({
          ok: true,
          plan: await createWorkItemImportPlan({
            ...projectSelectorFromArgs(args),
            policy: workItemImportPolicyFromArgs(args),
            resolveProject: (selector) =>
              resolveWorkItemProject(selector, homePath),
            now: context.now,
          }),
        });
      }
      case "work_item_import_execute": {
        const homePath = homePathFromArgs(args);
        requiredString(args, "direction", "arguments");
        assertMcpMutationAllowed(args, context, {
          command: "work_item_import_execute",
          mutationClass: "local_tracker",
          componentId: optionalString(args, "componentId", "arguments"),
        });
        return toolResult({
          ok: true,
          run: await executeWorkItemImport({
            ...projectSelectorFromArgs(args),
            policy: workItemImportPolicyFromArgs(args),
            authority: workItemImportExecutionAuthorityFromArgs(args, homePath),
            resolveProject: (selector) =>
              resolveWorkItemProject(selector, homePath),
            now: context.now,
          }),
        });
      }
      case "work_item_sync_execute": {
        const homePath = homePathFromArgs(args);
        assertMcpMutationAllowed(args, context, {
          command: "work_item_sync_execute",
          mutationClass: "provider_sync",
          componentId: optionalString(args, "componentId", "arguments"),
        });
        return toolResult({
          ok: true,
          run: await executeWorkItemSync({
            ...projectSelectorFromArgs(args),
            policy: workItemSyncPolicyFromArgs(args),
            resolveProject: (selector) =>
              resolveWorkItemProject(selector, homePath),
            recordRun: optionalBoolean(args, "recordRun", "arguments"),
            now: context.now,
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
        ...(error instanceof NexusSharedCheckoutGuardError
          ? { guard: error.decision }
          : {}),
      },
      true,
    );
  }
}

function assertMcpMutationAllowed(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
  options: {
    command: string;
    mutationClass: NexusCheckoutMutationClass;
    targetPath?: string | null;
    componentId?: string | null;
  },
): void {
  if (context.sharedCheckoutGuard !== "enforce") {
    return;
  }

  assertNexusSharedCheckoutMutationAllowed({
    projectRoot: projectRootFromArgs(args),
    command: options.command,
    mutationClass: options.mutationClass,
    targetPath: options.targetPath,
    componentId: options.componentId,
    gitRunner: context.gitRunner,
    override: context.sharedCheckoutGuardOverride,
  });
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
        await callDevNexusMcpTool(params.name, params.arguments, {
          sharedCheckoutGuard: "enforce",
        }),
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
    providerFactory: (projectContext) =>
      createMcpWorkItemProvider(projectContext, projectContext.homePath, context),
    now: context.now,
  });
}

function createMcpWorkItemProvider(
  projectContext: ResolvedWorkItemProjectContext,
  homePath: string,
  context: DevNexusMcpToolContext,
) {
  return createWorkTrackerProviderAsync(projectContext.workTracking, {
    ...mcpWorkItemProviderOptions(projectContext, homePath, context),
    projectRoot: projectContext.projectRoot,
    now: context.now,
  });
}

function mcpWorkItemProviderOptions(
  projectContext: ResolvedWorkItemProjectContext,
  homePath: string,
  context: DevNexusMcpToolContext,
): CreateWorkTrackerProviderOptions | undefined {
  const credentials =
    context.workItemProviderOptions?.credentials ??
    mcpWorkItemCredentialOptions(projectContext, homePath, context);
  return {
    ...context.workItemProviderOptions,
    ...(credentials ? { credentials } : {}),
  };
}

function mcpWorkItemCredentialOptions(
  projectContext: ResolvedWorkItemProjectContext,
  homePath: string,
  context: DevNexusMcpToolContext,
): CreateWorkTrackerProviderOptions["credentials"] | undefined {
  const projectConfig = loadProjectConfig(projectContext.projectRoot);
  const component = resolveProjectComponents(
    projectContext.projectRoot,
    projectConfig,
  ).find((candidate) => candidate.id === projectContext.componentId);
  if (!component) {
    return undefined;
  }
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot: projectContext.projectRoot,
    projectConfig,
    homePath,
  });
  if (authProfiles.length === 0) {
    return undefined;
  }
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: projectConfig.authority,
    componentId: component.id,
    publication,
    authProfiles,
  });
  if (!currentActor.profileId && !currentActor.expectedActorId) {
    return undefined;
  }

  return {
    broker: createHostAuthProfileCredentialBroker({
      authProfiles,
      projectRoot: projectContext.projectRoot,
      homePath,
      now: context.now,
      ...(context.workItemCredentialCommandRunner
        ? { commandRunner: context.workItemCredentialCommandRunner }
        : {}),
    }),
    profileId: currentActor.profileId,
    actorId: currentActor.expectedActorId,
    providerIdentity: currentActor.expectedHandle,
    host: projectContext.workTracking.host ?? null,
    repository: projectContext.workTracking.repository ?? null,
  };
}

function assertMcpWorkItemAuthorityAllowed(
  args: Record<string, unknown>,
  actions: NexusAuthorityAction[],
): void {
  for (const action of uniqueNexusAuthorityActions(actions)) {
    const authority = resolveMcpWorkItemAuthority(args, action);
    if (!authority.allowed) {
      throw new NexusAuthorityMutationError(
        nexusAuthorityMutationBlock(authority),
      );
    }
  }
}

function resolveMcpWorkItemAuthority(
  args: Record<string, unknown>,
  requestedAction: NexusAuthorityAction,
): NexusEffectiveAuthorityResolution {
  const homePath = homePathFromArgs(args);
  const selector = projectSelectorFromArgs(args);
  const resolved = resolveWorkItemProject(selector, homePath);
  const config = loadProjectConfig(resolved.projectRoot);
  if (!config.authority) {
    return unconfiguredNexusAuthorityAllowedResolution(requestedAction);
  }
  const component = resolveProjectComponents(resolved.projectRoot, config).find(
    (candidate) => candidate.id === resolved.componentId,
  );
  if (!component) {
    throw new Error(`Workspace component is not configured: ${resolved.componentId}`);
  }
  const publication = resolveNexusPublicationPolicy(config, component);
  const authProfiles = projectHostingAuthProfiles(config, resolved.homePath);
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: config.authority,
    componentId: component.id,
    publication,
    authProfiles,
  });

  return resolveNexusEffectiveAuthorityForCurrentActor({
    authority: config.authority,
    currentActor,
    authProfiles,
    project: config.id,
    component: component.id,
    provider: workItemAuthorityProvider(
      requestedAction,
      workItemTrackerProviderFromResolved(resolved, selector),
    ),
    tracker: selector.trackerId ?? resolved.defaultTrackerId ?? null,
    remote: publication.remote,
    repository: component.remoteUrl,
    targetBranch: publication.targetBranch,
    requestedAction,
    publication,
    safety: config.automation?.safety ?? null,
  });
}

function workItemAuthorityProvider(
  requestedAction: NexusAuthorityAction,
  trackerProvider: string,
): string | null {
  return requestedAction.startsWith("provider.") ? trackerProvider : null;
}

function workItemTrackerProviderFromArgs(
  args: Record<string, unknown>,
  selector: WorkItemProjectSelector = projectSelectorFromArgs(args),
): string {
  return workItemTrackerProviderFromResolved(
    resolveWorkItemProject(selector, homePathFromArgs(args)),
    selector,
  );
}

function workItemTrackerProviderFromResolved(
  resolved: ResolvedWorkItemProjectContext,
  selector: WorkItemProjectSelector,
): string {
  const trackerId = selector.trackerId ?? resolved.defaultTrackerId ?? null;
  const tracker = trackerId
    ? resolved.workTrackers?.find((candidate) => candidate.id === trackerId)
    : null;
  return tracker?.workTracking.provider ?? resolved.workTracking?.provider ?? "local";
}

function workItemCreateAuthorityActions(
  args: Record<string, unknown>,
  provider: string,
): NexusAuthorityAction[] {
  return workItemPatchAuthorityActions(
    {
      title: requiredString(args, "title", "arguments"),
      status: optionalWorkStatus(args, "status", "arguments"),
      labels: optionalStringArray(args, "labels", "arguments"),
      assignees: optionalStringArray(args, "assignees", "arguments"),
      milestone: optionalNullableString(args, "milestone", "arguments"),
    },
    provider,
  );
}

function workItemPatchAuthorityActions(
  patch: WorkItemPatch,
  provider: string,
): NexusAuthorityAction[] {
  const actions: NexusAuthorityAction[] = [];
  const providerBacked = provider !== "local";
  if (
    patch.title !== undefined ||
    patch.description !== undefined ||
    patch.milestone !== undefined ||
    (!providerBacked &&
      (patch.status !== undefined ||
        patch.labels !== undefined ||
        patch.assignees !== undefined))
  ) {
    actions.push("work_item.update");
  }
  if (providerBacked && patch.status !== undefined) {
    actions.push("provider.transition");
  }
  if (providerBacked && patch.labels !== undefined) {
    actions.push("provider.label");
  }
  if (providerBacked && patch.assignees !== undefined) {
    actions.push("provider.assign");
  }

  return actions;
}

function workItemCommentAuthorityAction(provider: string): NexusAuthorityAction {
  return provider === "local" ? "work_item.comment" : "provider.comment";
}

function workItemStatusAuthorityAction(provider: string): NexusAuthorityAction {
  return provider === "local" ? "work_item.update" : "provider.transition";
}

function uniqueNexusAuthorityActions(
  actions: NexusAuthorityAction[],
): NexusAuthorityAction[] {
  return [...new Set(actions)];
}

function workItemTrackerLinkServiceFromArgs(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
) {
  const homePath = homePathFromArgs(args);
  return createWorkItemTrackerLinkService({
    resolveProject: (selector) => resolveWorkItemProject(selector, homePath),
    now: context.now,
  });
}

function logicalWorkItemFromArgs(args: Record<string, unknown>): {
  selector: WorkItemProjectSelector;
  logicalItemId: string;
} {
  const selector = projectSelectorFromArgs(args);
  const logicalItemId = requiredString(args, "logicalItemId", "arguments");
  const qualified = qualifiedWorkItemId(args, logicalItemId);
  if (!qualified) {
    return { selector, logicalItemId };
  }
  if (selector.componentId && selector.componentId !== qualified.componentId) {
    throw new Error(
      `Work item id component "${qualified.componentId}" conflicts with componentId "${selector.componentId}"`,
    );
  }

  return {
    selector: {
      ...selector,
      componentId: qualified.componentId,
    },
    logicalItemId: qualified.id,
  };
}

function targetCycleLedgerFromArgs(args: Record<string, unknown>, detail: McpDetail): {
  projectRoot: string;
  projectId: string;
  ledger:
    | ReturnType<typeof summarizeTargetCycleLedger>
    | ReturnType<typeof readNexusAutomationTargetCycleLedger>;
} {
  const { projectRoot, projectConfig, automationConfig } =
    targetCycleProjectFromArgs(args);
  const ledger = readNexusAutomationTargetCycleLedger(projectRoot, automationConfig);
  return {
    projectRoot,
    projectId: projectConfig.id,
    ledger:
      detail === "full"
        ? ledger
        : summarizeTargetCycleLedger(
            ledger,
            nexusAutomationTargetCycleLedgerPath(projectRoot, automationConfig),
          ),
  };
}

function summarizeTargetCycleRecordResult(
  result: ReturnType<typeof appendTargetCycleFromArgs>,
  detail: McpDetail,
) {
  if (detail === "full") {
    return result;
  }
  const ledgerPath = nexusAutomationTargetCycleLedgerPath(
    result.projectRoot,
    targetCycleProjectFromArgs({ projectRoot: result.projectRoot }).automationConfig,
  );
  return {
    projectRoot: result.projectRoot,
    projectId: result.projectId,
    record: summarizeTargetCycleRecord(result.record),
    ledger: summarizeTargetCycleLedger(result.ledger, ledgerPath),
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
    throw new Error("Workspace automation is not configured");
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
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    homePath: config.home
      ? resolveNexusProjectPath({ projectRoot, value: config.home })
      : homePath,
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

function mcpRuntimeSummaryForProject(
  projectRoot: string,
  context: DevNexusMcpToolContext,
): NexusMcpRuntimeSummary {
  const startedAtDate =
    dateFromMcpRuntimeValue(context.mcpRuntimeStartedAt) ??
    devNexusMcpServerStartedAt;
  const startedAt = startedAtDate.toISOString();
  const source = mcpRuntimeSourceIdentity(projectRoot, context);
  const warnings: string[] = [];
  let stale = false;
  const headCommitDate = source?.headCommitDate
    ? dateFromMcpRuntimeValue(source.headCommitDate)
    : null;

  if (source && headCommitDate && headCommitDate.getTime() > startedAtDate.getTime()) {
    stale = true;
    warnings.push(
      `DevNexus MCP server started before ${source.componentId} source HEAD ` +
        `${source.headCommit ?? "unknown"} at ${source.headCommitDate}; reload or ` +
        "restart the agent MCP session, or use the workspace-local DevNexus CLI for source-current results.",
    );
  }

  return {
    serverName: "dev-nexus",
    protocolVersion: devNexusMcpProtocolVersion,
    startedAt,
    processId: process.pid,
    nodeVersion: process.version,
    command: process.argv.length > 0 ? process.argv.join(" ") : null,
    stale,
    warningCount: warnings.length,
    warnings,
    source,
  };
}

function mcpRuntimeSourceIdentity(
  projectRoot: string,
  context: DevNexusMcpToolContext,
): NexusMcpRuntimeSummary["source"] {
  const projectConfig = loadProjectConfig(projectRoot);
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const component =
    components.find((candidate) => candidate.id === "dev-nexus") ??
    components.find((candidate) => candidate.role === "primary") ??
    components[0];
  if (!component) {
    return null;
  }

  let headCommit: string | null = null;
  let headCommitDate: string | null = null;
  if (component.sourceRootExists) {
    const gitRunner = context.gitRunner ?? defaultGitRunner;
    headCommit = mcpRuntimeGitStdout(
      gitRunner,
      ["rev-parse", "--verify", "HEAD"],
      component.sourceRoot,
    );
    headCommitDate = isoDateFromMcpRuntimeValue(
      mcpRuntimeGitStdout(
        gitRunner,
        ["log", "-1", "--format=%cI", "HEAD"],
        component.sourceRoot,
      ),
    );
  }

  return {
    componentId: component.id,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    headCommit,
    headCommitDate,
  };
}

function mcpRuntimeGitStdout(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  try {
    const result = gitRunner(args, cwd);
    if (result.exitCode !== 0) {
      return null;
    }
    const stdout = result.stdout.trim();
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

function isoDateFromMcpRuntimeValue(value: Date | string | null): string | null {
  return dateFromMcpRuntimeValue(value)?.toISOString() ?? null;
}

function dateFromMcpRuntimeValue(
  value: Date | string | null | undefined,
): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function projectHostingStatusFromArgs(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
): Promise<{
  projectRoot: string;
  status: NexusProjectHostingStatusResult;
}> {
  const projectRoot = projectRootFromArgs(args);
  const config = loadProjectConfig(projectRoot);
  const authProfiles = projectHostingAuthProfiles(
    config,
    optionalString(args, "homePath", "arguments"),
  );
  const localRemotes = projectHostingLocalGitRemotes(
    projectRoot,
    context.gitRunner,
  );
  const status = await statusNexusProjectHosting({
    project: {
      id: config.id,
      name: config.name,
    },
    hosting: config.hosting,
    ...(authProfiles.length > 0 ? { authProfiles } : {}),
    ...(localRemotes ? { localRemotes } : {}),
    ...(context.hostingProvider ? { provider: context.hostingProvider } : {}),
  });

  return {
    projectRoot,
    status,
  };
}

function projectStatusFromArgs(args: Record<string, unknown>): NexusProjectStatusBase {
  const project = requiredString(args, "project", "arguments");
  const homePath = optionalString(args, "homePath", "arguments") ?? defaultNexusHomePath();
  try {
    return getNexusProjectStatus({
      homePath,
      homeStore: fileProjectHomeStore(),
      project,
    }).project;
  } catch (homeError) {
    if (optionalString(args, "homePath", "arguments")) {
      throw homeError;
    }
    try {
      return buildNexusProjectStatusForPath(project);
    } catch (pathError) {
      if (
        path.isAbsolute(project) ||
        project.startsWith(".") ||
        project.includes(path.sep)
      ) {
        throw pathError;
      }
      throw homeError;
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

function projectHostingAuthProfiles(
  projectConfig: NexusProjectConfig,
  homePath: string | undefined,
): NexusHostingAuthProfileConfig[] {
  try {
    return loadNexusHomeConfigFile(
      homePath ?? projectConfig.home ?? defaultNexusHomePath(),
      validateNexusHomeConfigBase,
    ).authProfiles ?? [];
  } catch {
    return [];
  }
}

function projectHostingLocalGitRemotes(
  projectRoot: string,
  gitRunner: GitRunner | undefined,
): NexusProjectHostingLocalRemoteRecord[] | undefined {
  const runner = gitRunner ?? defaultGitRunner;
  const result = runner(["remote", "-v"], projectRoot);
  if (result.exitCode !== 0) {
    return undefined;
  }

  return parseGitRemoteVerboseOutput(result.stdout);
}

function projectHostingLocalRemoteCommandRunner(
  projectRoot: string,
  gitRunner: GitRunner | undefined,
): (
  command: NexusProjectHostingLocalRemoteCommand,
) => NexusProjectHostingLocalRemoteCommandResult {
  const runner = gitRunner ?? defaultGitRunner;
  return (command) => {
    const result = runner(command.args, projectRoot);
    return {
      args: result.args,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  };
}

function parseGitRemoteVerboseOutput(
  stdout: string,
): NexusProjectHostingLocalRemoteRecord[] {
  const remotes = new Map<string, string | null>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/u.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, name, url, direction] = match;
    if (direction === "fetch" || !remotes.has(name!)) {
      remotes.set(name!, url!);
    }
  }

  return [...remotes.entries()].map(([name, url]) => ({ name, url }));
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

function remoteExecutionAttachmentRefsFromArgs(
  args: Record<string, unknown>,
): NexusRemoteExecutionAttachmentRef[] {
  const values = args.attachmentRefs;
  if (values === undefined || values === null) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error("arguments.attachmentRefs must be an array");
  }

  return values.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`arguments.attachmentRefs[${index}] must be an object`);
    }
    return value as NexusRemoteExecutionAttachmentRef;
  });
}

function remoteExecutionMutationClassFromArgs(
  args: Record<string, unknown>,
): NexusRunnerMutationClass {
  const value = requiredString(args, "mutationClass", "arguments");
  if (
    value === "none" ||
    value === "verification" ||
    value === "project_local" ||
    value === "live_runtime" ||
    value === "destructive"
  ) {
    return value;
  }

  throw new Error(
    "arguments.mutationClass must be none, verification, project_local, live_runtime, or destructive",
  );
}

function hostCheckModeFromArgs(args: Record<string, unknown>): NexusHostCheckMode {
  const value = optionalString(args, "mode", "arguments") ?? "local";
  if (value === "local" || value === "mock-remote") {
    return value;
  }

  throw new Error("arguments.mode must be local or mock-remote");
}

function hostCheckMockFactsFromArgs(
  args: Record<string, unknown>,
): NexusHostCheckMockFacts | null {
  const value = args.mockFacts;
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments.mockFacts must be an object");
  }

  return value as NexusHostCheckMockFacts;
}

function workItemSyncPolicyFromArgs(
  args: Record<string, unknown>,
): WorkItemSyncPolicyConfig {
  const direction = optionalString(args, "direction", "arguments");
  const commentPolicy = optionalString(args, "commentPolicy", "arguments");
  const conflictPolicy = optionalString(args, "conflictPolicy", "arguments");
  const fieldSet = optionalStringArray(args, "fieldSet", "arguments")?.map(
    (field) => parseWorkItemSyncField(field, "arguments.fieldSet"),
  );

  return defaultWorkItemSyncPolicy({
    sourceTrackerId: requiredString(args, "sourceTrackerId", "arguments"),
    targetTrackerId: requiredString(args, "targetTrackerId", "arguments"),
    ...(direction
      ? { direction: parseWorkItemSyncDirection(direction, "arguments.direction") }
      : {}),
    filters: workItemSyncFiltersFromArgs(args),
    ...(fieldSet ? { fieldSet } : {}),
    ...(commentPolicy
      ? {
          commentPolicy: {
            mode: parseWorkItemSyncCommentPolicyMode(
              commentPolicy,
              "arguments.commentPolicy",
            ),
          },
        }
      : {}),
    statusMapping: workItemSyncStatusMappingFromArgs(args),
    ...(conflictPolicy
      ? {
          conflictPolicy: {
            mode: parseWorkItemSyncConflictPolicyMode(
              conflictPolicy,
              "arguments.conflictPolicy",
            ),
          },
        }
      : {}),
    writePolicy: workItemSyncWritePolicyFromArgs(args),
  });
}

function workItemImportPolicyFromArgs(
  args: Record<string, unknown>,
): WorkItemImportPolicyConfig {
  const direction = optionalString(args, "direction", "arguments");
  const conflictPolicy = optionalString(args, "conflictPolicy", "arguments");
  const fieldSet = optionalStringArray(args, "fieldSet", "arguments")?.map(
    (field) => parseWorkItemSyncField(field, "arguments.fieldSet"),
  );
  const fingerprints = optionalStringArray(
    args,
    "fingerprints",
    "arguments",
  )?.map((fingerprint) =>
    parseWorkItemImportFingerprint(fingerprint, "arguments.fingerprints"),
  );

  return defaultWorkItemImportPolicy({
    sourceTrackerId: requiredString(args, "sourceTrackerId", "arguments"),
    targetTrackerId: requiredString(args, "targetTrackerId", "arguments"),
    ...(direction
      ? { direction: parseWorkItemImportDirection(direction, "arguments.direction") }
      : {}),
    filters: workItemSyncFiltersFromArgs(args),
    ...(fieldSet ? { fieldSet } : {}),
    statusMapping: workItemSyncStatusMappingFromArgs(args),
    ...(conflictPolicy
      ? {
          conflictPolicy: {
            mode: parseWorkItemSyncConflictPolicyMode(
              conflictPolicy,
              "arguments.conflictPolicy",
            ),
          },
        }
      : {}),
    writePolicy: workItemImportWritePolicyFromArgs(args),
    ...(fingerprints ? { fingerprints } : {}),
  });
}

function workItemSyncFiltersFromArgs(
  args: Record<string, unknown>,
): NonNullable<WorkItemSyncPolicyConfig["filters"]> {
  const filters = hasOwn(args, "filters")
    ? asRecord(args.filters, "arguments.filters")
    : args;
  return {
    status: optionalNeutralWorkStatusQuery(
      filters,
      "status",
      "arguments.filters",
    ),
    labels: optionalStringArray(filters, "labels", "arguments.filters"),
    assignees: optionalStringArray(filters, "assignees", "arguments.filters"),
    search: optionalString(filters, "search", "arguments.filters"),
    limit: optionalPositiveInteger(filters, "limit", "arguments.filters"),
  };
}

function workItemSyncStatusMappingFromArgs(
  args: Record<string, unknown>,
): NonNullable<WorkItemSyncPolicyConfig["statusMapping"]> {
  if (!hasOwn(args, "statusMapping")) {
    return {};
  }
  const mapping = asRecord(args.statusMapping, "arguments.statusMapping");
  const parsed: Partial<Record<WorkStatus, WorkStatus>> = {};
  for (const [source, target] of Object.entries(mapping)) {
    parsed[parseWorkStatus(source, "arguments.statusMapping key")] =
      parseWorkStatus(
        requiredPlainString(target, `arguments.statusMapping.${source}`),
        `arguments.statusMapping.${source}`,
      );
  }

  return parsed;
}

function workItemSyncWritePolicyFromArgs(
  args: Record<string, unknown>,
): NonNullable<WorkItemSyncPolicyConfig["writePolicy"]> {
  if (!hasOwn(args, "writePolicy")) {
    return {
      mode: "dry_run",
    };
  }
  const writePolicy = asRecord(args.writePolicy, "arguments.writePolicy");
  const mode = optionalString(writePolicy, "mode", "arguments.writePolicy");
  const creates = optionalString(writePolicy, "creates", "arguments.writePolicy");
  const updates = optionalString(writePolicy, "updates", "arguments.writePolicy");
  const credentials = optionalString(
    writePolicy,
    "credentials",
    "arguments.writePolicy",
  );
  return {
    mode: mode ?? "dry_run",
    ...(creates
      ? {
          creates: parseWorkItemSyncWriteDisposition(
            creates,
            "arguments.writePolicy.creates",
          ),
        }
      : {}),
    ...(updates
      ? {
          updates: parseWorkItemSyncWriteDisposition(
            updates,
            "arguments.writePolicy.updates",
          ),
        }
      : {}),
    ...(credentials
      ? {
          credentials: parseWorkItemSyncCredentialPolicy(
            credentials,
            "arguments.writePolicy.credentials",
          ),
        }
      : {}),
    ...(hasOwn(writePolicy, "reason")
      ? {
          reason:
            optionalNullableString(
              writePolicy,
              "reason",
              "arguments.writePolicy",
            ) ?? null,
        }
      : {}),
  };
}

function workItemImportWritePolicyFromArgs(
  args: Record<string, unknown>,
): NonNullable<WorkItemImportPolicyConfig["writePolicy"]> {
  const syncPolicy = workItemSyncWritePolicyFromArgs(args);
  if (!hasOwn(args, "writePolicy")) {
    return syncPolicy;
  }
  const writePolicy = asRecord(args.writePolicy, "arguments.writePolicy");
  const links = optionalString(writePolicy, "links", "arguments.writePolicy");
  return {
    ...syncPolicy,
    ...(links
      ? {
          links: parseWorkItemSyncWriteDisposition(
            links,
            "arguments.writePolicy.links",
          ),
        }
      : {}),
  };
}

function workItemImportExecutionAuthorityFromArgs(
  args: Record<string, unknown>,
  homePath: string,
): WorkItemImportExecutionAuthorityInput {
  const projectRoot = projectRootFromArgs(args);
  const projectConfig = loadProjectConfig(projectRoot);
  const componentId = optionalString(args, "componentId", "arguments");
  const component = componentId
    ? resolveProjectComponents(projectRoot, projectConfig).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(projectRoot, projectConfig);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot,
    projectConfig,
    homePath,
  });
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: projectConfig.authority,
    componentId: component.id,
    publication,
    authProfiles,
  });
  const authProfile = currentActor.profileId
    ? authProfiles.find((profile) => profile.id === currentActor.profileId) ?? null
    : null;

  return {
    authority: projectConfig.authority,
    actor: {
      id: currentActor.expectedActorId,
      kind: currentActor.expectedActorKind,
      provider: currentActor.expectedProvider,
      providerIdentity: currentActor.expectedHandle,
    },
    authProfile: authProfile
      ? {
          id: authProfile.id,
          actorId: authProfile.actorId ?? null,
          kind: authProfile.kind ?? null,
          provider: authProfile.provider,
          account: authProfile.account ?? null,
        }
      : null,
  };
}

function parseToolCallParams(value: unknown): { name: string; arguments?: unknown } {
  const params = asRecord(value, "params");
  return {
    name: requiredString(params, "name", "params"),
    arguments: params.arguments,
  };
}

type McpDetail = "summary" | "full";
const MCP_SUMMARY_ITEM_LIMIT = 2;
const MCP_SUMMARY_TEXT_LIMIT = 360;

function mcpDetailFromArgs(args: Record<string, unknown>): McpDetail {
  const detail = optionalString(args, "detail", "arguments") ?? "summary";
  if (detail === "summary" || detail === "full") {
    return detail;
  }
  throw new Error("arguments.detail must be summary or full");
}

function summaryItems<T>(
  values: readonly T[],
  limit = MCP_SUMMARY_ITEM_LIMIT,
): T[] {
  return values.slice(0, limit);
}

function omittedCount(values: readonly unknown[], limit = MCP_SUMMARY_ITEM_LIMIT) {
  return Math.max(0, values.length - limit);
}

function summaryText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value.length <= MCP_SUMMARY_TEXT_LIMIT) {
    return value;
  }
  return `${value.slice(0, MCP_SUMMARY_TEXT_LIMIT - 3)}...`;
}

export function summarizeProjectStatus(project: NexusProjectStatusBase) {
  return {
    id: project.id,
    name: project.name,
    projectRoot: project.projectRoot,
    projectConfigPath: project.projectConfigPath,
    projectConfigExists: project.projectConfigExists,
    repo: project.repo,
    componentCount: project.components.length,
    components: project.components.map(summarizeProjectComponent),
    defaultTrackerId: project.defaultTrackerId,
    workTrackerCount: project.workTrackers.length,
    workTrackerProviders: uniqueStrings(
      project.workTrackers.map((tracker) => tracker.provider),
    ),
    workTrackers: project.workTrackers.map(summarizeResolvedWorkTracker),
    workTracking: summarizeWorkTracking(project.workTracking ?? null),
    unsupportedWorkTrackingCapabilities:
      project.workTrackingCapabilityReport?.unsupported ?? null,
    vibeKanbanProjectId: project.vibeKanbanProjectId,
    vibeKanbanRepoId: project.vibeKanbanRepoId,
    hostCount: project.hosts.length,
    runnerProfileCount: project.runnerProfiles.length,
    agentTargets: project.agentTargets
      ? {
          explicit: project.agentTargets.explicit,
          activeProviders: project.agentTargets.activeProviders,
          targetCount: project.agentTargets.targets.length,
          missingMcpConfigCount: project.agentTargets.expectedMcpConfigFiles.filter(
            (target) => target.state === "expected-missing",
          ).length,
          missingSkillDirectoryCount:
            project.agentTargets.expectedSkillDirectories.filter(
              (target) => target.state === "expected-missing",
            ).length,
          staleGeneratedDirectoryCount:
            project.agentTargets.staleGeneratedProviderDirectories.length,
          manualDirectoryCount: project.agentTargets.manualProviderDirectories.length,
          unsupportedTargetCount: project.agentTargets.unsupportedTargets.length,
          locallySelectedButNotAllowedCount:
            project.agentTargets.locallySelectedButNotAllowed.length,
          recommendations: project.agentTargets.recommendations,
          summary: project.agentTargets.summary,
        }
      : null,
    authority: summarizeAuthorityProject(project.authority),
  };
}

function summarizeProjectComponent(
  component: NexusProjectStatusBase["components"][number],
) {
  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    role: component.role,
    remoteUrl: component.remoteUrl,
    defaultBranch: component.defaultBranch,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    worktreesRootExists: component.worktreesRootExists,
    defaultTrackerId: component.defaultTrackerId,
    workTrackerCount: component.workTrackers.length,
    workTrackerProviders: uniqueStrings(
      component.workTrackers.map((tracker) => tracker.provider),
    ),
    workTracking: summarizeWorkTracking(component.workTracking ?? null),
    unsupportedWorkTrackingCapabilities:
      component.workTrackingCapabilityReport?.unsupported ?? null,
    relationshipCount: component.relationships.length,
    verification: component.verification
      ? {
          focusedCommandCount: component.verification.focusedCommands?.length ?? 0,
          fullCommandCount: component.verification.fullCommands?.length ?? 0,
          requirePassing: component.verification.requirePassing ?? null,
        }
      : null,
    publication: component.publication
      ? {
          strategy: component.publication.strategy,
          remote: component.publication.remote,
          targetBranch: component.publication.targetBranch,
          push: component.publication.push,
        }
      : null,
  };
}

function summarizeResolvedWorkTracker(
  tracker: NexusProjectStatusBase["workTrackers"][number],
) {
  return {
    id: tracker.id,
    name: tracker.name,
    provider: tracker.provider,
    enabled: tracker.enabled,
    roles: tracker.roles,
    default: tracker.default,
    workTracking: summarizeWorkTracking(tracker.workTracking),
    unsupportedCapabilities: tracker.workTrackingCapabilityReport.unsupported,
  };
}

function summarizeWorkTracking(value: { provider: string } | null): { provider: string } | null {
  return value ? { provider: value.provider } : null;
}

export function summarizeAutomationStatus(status: NexusAutomationStatus) {
  return {
    projectRoot: status.projectRoot,
    sourceRoot: status.sourceRoot,
    project: {
      id: status.projectConfig.id,
      name: status.projectConfig.name,
      componentCount: status.projectConfig.components.length,
    },
    componentCount: status.components.length,
    components: summaryItems(status.components).map((component) => ({
      id: component.id,
      name: component.name,
      role: component.role,
      kind: component.kind,
      sourceRoot: component.sourceRoot,
      defaultTrackerId: component.defaultTrackerId,
      workTrackerCount: component.workTrackers.length,
    })),
    omittedComponentCount: omittedCount(status.components),
    status: status.status,
    summary: summaryText(status.summary),
    lock: status.lock
      ? {
          status: status.lock.status,
          path: status.lock.path,
          runId: status.lock.runId,
          owner: status.lock.owner,
          acquiredAt: status.lock.acquiredAt,
          expiresAt: status.lock.expiresAt,
          message: status.lock.message,
        }
      : null,
    ledger: summarizeRunLedger(status.ledger),
    backoff: status.backoff,
    preflight: summarizePreflight(status.preflight),
    target: summarizeAutomationTarget(status.target),
    targetCycles: summarizeTargetCycleSummary(status.targetCycles),
    agent: status.agent
      ? {
          coordinatorProfileId: status.agent.coordinatorProfileId,
          maxConcurrentSubagents: status.agent.maxConcurrentSubagents,
          safety: status.agent.safety,
          profileCount: status.agent.profiles.length,
          profiles: status.agent.profiles.map((profile) => ({
            id: profile.id,
            executor: profile.executor,
            executorMode: profile.executorMode,
            model: profile.model,
            reasoning: profile.reasoning,
            intendedUse: profile.intendedUse,
          })),
        }
      : null,
    runnerProfileCount: status.runnerProfiles.length,
    publication: summarizePublicationStatuses(status.publication),
    currentActorCount: status.currentActors.length,
    currentActors: summaryItems(status.currentActors).map((actor) => ({
      componentId: actor.componentId,
      status: actor.status,
      profileId: actor.profileId,
      expectedActorId: actor.expectedActorId,
      expectedProvider: actor.expectedProvider,
      warningCount: actor.warnings.length,
      warnings: summaryItems(actor.warnings),
    })),
    omittedCurrentActorCount: omittedCount(status.currentActors),
    authority: summarizeAuthorityProject(status.authority),
    selectorQuery: status.selectorQuery,
    candidateCount: status.candidateCount,
    eligibleWorkMode: status.eligibleWorkMode,
    eligibleWorkItemCount: status.eligibleWorkItems?.length ?? null,
    eligibleWorkItems:
      status.eligibleWorkItems
        ? summaryItems(status.eligibleWorkItems).map(summarizeEligibleWorkItem)
        : null,
    omittedEligibleWorkItemCount: status.eligibleWorkItems
      ? omittedCount(status.eligibleWorkItems)
      : null,
    importCandidateWorkItemCount: status.importCandidateWorkItems?.length ?? null,
    importCandidateWorkItems:
      status.importCandidateWorkItems
        ? summaryItems(status.importCandidateWorkItems).map(summarizeEligibleWorkItem)
        : null,
    omittedImportCandidateWorkItemCount: status.importCandidateWorkItems
      ? omittedCount(status.importCandidateWorkItems)
      : null,
    eligibleWorkWarnings: status.eligibleWorkWarnings,
    eligibleWorkBlockers: status.eligibleWorkBlockers,
    externalIssueVisibility: summarizeExternalIssueVisibility(
      status.externalIssueVisibility,
    ),
    componentEligibleWorkItems:
      status.componentEligibleWorkItems?.map((component) => ({
        componentId: component.componentId,
        workItemCount: component.workItems.length,
        importCandidateWorkItemCount:
          component.importCandidateWorkItems?.length ?? 0,
        excludedWorkItemCount: countAutomationStatusExcludedWorkItems(component),
        excludedReasonCounts: automationStatusExcludedReasonCounts(component),
        excludedCategoryCounts: automationStatusExcludedCategoryCounts(component),
        warningCount: component.warnings?.length ?? 0,
        blockerCount: component.blockers?.length ?? 0,
        trackerResultCount: component.trackerResults?.length ?? 0,
        trackerResults:
          component.trackerResults
            ? summaryItems(component.trackerResults).map((trackerResult) => ({
            trackerId: trackerResult.trackerId,
            provider: trackerResult.provider,
            selected: trackerResult.selected,
            selectableCount: trackerResult.selectableCount,
            importCandidateCount: trackerResult.importCandidateCount,
            excludedCount: trackerResult.excludedCount,
            exclusionReasonCounts: trackerResult.exclusionReasonCounts,
            exclusionCategoryCounts:
              trackerResult.exclusionCategoryCounts ?? {},
            warningCount: trackerResult.warnings.length,
            blockerCount: trackerResult.blockers.length,
          }))
            : [],
        omittedTrackerResultCount: component.trackerResults
          ? omittedCount(component.trackerResults)
          : 0,
        workItems: summaryItems(component.workItems).map(
          summarizeWorkItemReference,
        ),
        omittedWorkItemCount: omittedCount(component.workItems),
        importCandidateWorkItems:
          component.importCandidateWorkItems
            ? summaryItems(component.importCandidateWorkItems).map(
                summarizeEligibleWorkItem,
              )
            : [],
        omittedImportCandidateWorkItemCount: component.importCandidateWorkItems
          ? omittedCount(component.importCandidateWorkItems)
          : 0,
        excludedWorkItems:
          component.excludedWorkItems
            ? summaryItems(component.excludedWorkItems).map(
                summarizeExcludedWorkItem,
              )
            : [],
        omittedExcludedWorkItemCount: component.excludedWorkItems
          ? omittedCount(component.excludedWorkItems)
          : 0,
      })) ?? null,
    selectedWorkItem: status.selectedWorkItem
      ? summarizeWorkItemReference(status.selectedWorkItem)
      : null,
  };
}

export function summarizeTargetReport(report: NexusAutomationTargetReport) {
  const activeComponentProgress = report.componentProgress.filter(
    (component) =>
      component.workItemCount > 0 ||
      component.activeBlockers.length > 0 ||
      component.commitIds.length > 0 ||
      component.verification.length > 0 ||
      component.publicationDecisions.length > 0 ||
      component.runs.length > 0 ||
      component.publicationTrain !== null,
  );
  return {
    version: report.version,
    generatedAt: report.generatedAt,
    projectRoot: report.projectRoot,
    project: report.project,
    target: summarizeAutomationTarget(report.target),
    status: report.status,
    statusReason: report.statusReason,
    cycleSummary: summarizeTargetCycleSummary(report.cycleSummary),
    runSummary: report.runSummary
      ? {
          runCount: report.runSummary.runCount,
          completedRunCount: report.runSummary.completedRunCount,
          blockedRunCount: report.runSummary.blockedRunCount,
          failedRunCount: report.runSummary.failedRunCount,
          skippedRunCount: report.runSummary.skippedRunCount,
          lastRun: report.runSummary.lastRun
            ? summarizeAutomationRun(report.runSummary.lastRun)
            : null,
        }
      : null,
    workItemSummary: report.workItemSummary
      ? {
          totalReferences: report.workItemSummary.totalReferences,
          uniqueReferenceCount:
            report.workItemSummary.uniqueReferences.length,
          uniqueReferences: summaryItems(
            report.workItemSummary.uniqueReferences,
          ).map(summarizeTargetWorkItemReference),
          omittedUniqueReferenceCount: omittedCount(
            report.workItemSummary.uniqueReferences,
          ),
          byComponent: report.workItemSummary.byComponent,
          byCycleStatus: report.workItemSummary.byCycleStatus,
          progress: countTargetWorkItemProgress(report.workItemSummary.progress),
        }
      : null,
    executionSummary: report.executionSummary
      ? {
          runCount: report.executionSummary.runCount,
          commitCount: report.executionSummary.commitIds.length,
          commitIds: report.executionSummary.commitIds.slice(
            -MCP_SUMMARY_ITEM_LIMIT,
          ),
          verificationCount: report.executionSummary.verification.length,
          failedVerificationCount: report.executionSummary.verification.filter(
            (record) => record.status === "failed",
          ).length,
          publicationDecisionCount:
            report.executionSummary.publicationDecisions.length,
          runSummaries: report.executionSummary.runs
            .slice(-MCP_SUMMARY_ITEM_LIMIT)
            .map(summarizeTargetExecutionRun),
        }
      : null,
    externalIssueVisibility: summarizeExternalIssueVisibility(
      report.externalIssueVisibility,
    ),
    authority: summarizeAuthorityProject(report.authority),
    componentProgressCount: report.componentProgress.length,
    componentProgress: summaryItems(activeComponentProgress).map((component) => ({
      componentId: component.componentId,
      componentName: component.componentName,
      role: component.role,
      workTrackingProvider: component.workTrackingProvider,
      workItemCount: component.workItemCount,
      workItems: countTargetWorkItemProgress(component.workItems),
      activeBlockerCount: component.activeBlockers.length,
      activeBlockers: summaryItems(component.activeBlockers),
      commitCount: component.commitIds.length,
      commitIds: component.commitIds.slice(-MCP_SUMMARY_ITEM_LIMIT),
      verificationCount: component.verification.length,
      failedVerificationCount: component.verification.filter(
        (record) => record.status === "failed",
      ).length,
      publicationDecisionCount: component.publicationDecisions.length,
      runCount: component.runs.length,
      publication: component.publication
        ? {
            mode: component.publication.mode,
            targetBranch: component.publication.targetBranch,
            integrationPreference: component.publication.integrationPreference,
          }
        : null,
      publicationTrain: component.publicationTrain
        ? {
            enabled: component.publicationTrain.enabled,
            activeVersionId: component.publicationTrain.activeVersionId,
            activeVersionFound: component.publicationTrain.activeVersionFound,
            targetBranch: component.publicationTrain.targetBranch,
            candidateBranch: component.publicationTrain.branches.candidateBranch,
            integrationBranch:
              component.publicationTrain.branches.integrationBranch,
            ciTierDefault: component.publicationTrain.ciTiers.defaultTier,
            fullMatrixBudget:
              component.publicationTrain.ciTiers.fullMatrixBudget,
            selectorLabels: component.publicationTrain.selector.labels,
            requiresPublicLabel:
              component.publicationTrain.selector.requiresPublicLabel,
            warningCount: component.publicationTrain.warnings.length,
            warnings: summaryItems(component.publicationTrain.warnings),
          }
        : null,
      authority: component.authority
        ? {
            actorStatus: component.authority.actor.status,
            provider: component.authority.actor.provider,
            handle: component.authority.actor.handle,
            blockedActionCount: component.authority.blockedActions.length,
            blockedDecisionCount: component.authority.decisions.filter(
              (decision) => !decision.allowed,
            ).length,
            warningCount: component.authority.warnings.length,
        }
        : null,
    })),
    omittedComponentProgressCount:
      omittedCount(activeComponentProgress) +
      (report.componentProgress.length - activeComponentProgress.length),
    relaunchDecision: report.relaunchDecision,
    activeBlockerCount: report.activeBlockers.length,
    activeBlockers: summaryItems(report.activeBlockers),
    omittedActiveBlockerCount: omittedCount(report.activeBlockers),
    blockerCount: report.blockers.length,
    blockers: summaryItems(report.blockers),
    omittedBlockerCount: omittedCount(report.blockers),
    noteCount: report.notes.length,
    notes: summaryItems(report.notes).map(summaryText),
    omittedNoteCount: omittedCount(report.notes),
    ...(report.versionPlanning
      ? { versionPlanning: summarizeVersionPlanning(report.versionPlanning) }
      : {}),
  };
}

export function summarizeCoordinationStatus(status: NexusCoordinationStatus) {
  return {
    project: status.project,
    component: {
      id: status.component.id,
      name: status.component.name,
      role: status.component.role,
      sourceRoot: status.component.sourceRoot,
      workTrackingProvider: status.component.workTrackingProvider,
    },
    workItem: status.workItem ? summarizeWorkItemReference(status.workItem) : null,
    coordinationTracker: {
      trackerId: status.coordinationTracker.trackerId,
      provider: status.coordinationTracker.provider,
      selection: status.coordinationTracker.selection,
    },
    git: {
      repositoryPath: status.git.repositoryPath,
      branch: status.git.branch,
      upstream: status.git.upstream,
      baseRef: status.git.baseRef,
      headCommit: status.git.headCommit,
      dirty: status.git.dirty,
      stagedCount: status.git.stagedCount,
      unstagedCount: status.git.unstagedCount,
      untrackedCount: status.git.untrackedCount,
      ahead: status.git.ahead,
      behind: status.git.behind,
      pushed: status.git.pushed,
      warningCount: status.git.warnings.length,
    },
    authority: summarizeAuthorityComponent(status.authority),
    leases: {
      storePath: status.leases.storePath,
      totalCount: status.leases.records.length,
      activeCount: status.leases.activeCount,
      staleCount: status.leases.staleCount,
      byStatus: countBy(status.leases.records, (record) => record.effectiveStatus),
      records: summaryItems(status.leases.records).map((record) => ({
        id: record.id,
        status: record.status,
        effectiveStatus: record.effectiveStatus,
        stale: record.stale,
        branchName: record.branchName,
        baseRef: record.baseRef,
        workItemId: record.workItemId,
        hostId: record.hostId,
        agentId: record.agentId,
        componentId: record.scope.componentId ?? null,
        worktree: record.worktree.relativePath,
        dirty: record.dirty,
        pushed: record.pushed,
        ahead: record.git.ahead,
        behind: record.git.behind,
        updatedAt: record.updatedAt,
        lastSeenAt: record.lastSeenAt,
        noteCount: record.notes.length,
        writeScopeCount: record.writeScope.length,
      })),
      omittedRecordCount: omittedCount(status.leases.records),
      warningCount: status.leases.warnings.length,
      warnings: summaryItems(status.leases.warnings),
      blocking: status.leases.blocking,
    },
    handoffs: {
      available: status.handoffs.available,
      capability: status.handoffs.capability,
      tracker: status.handoffs.tracker,
      trackerId: status.handoffs.trackerId,
      provider: status.handoffs.provider,
      totalCount: status.handoffs.records.length,
      activeCount: status.handoffs.records.filter((record) => !record.stale)
        .length,
      staleCount: status.handoffs.records.filter((record) => record.stale)
        .length,
      records: summaryItems(status.handoffs.records).map((record) => ({
        workItemId: record.workItemId,
        status: record.status,
        branch: record.branch,
        upstream: record.upstream,
        baseRef: record.baseRef,
        headCommit: record.headCommit,
        dirty: record.dirty,
        ahead: record.ahead,
        behind: record.behind,
        pushed: record.pushed,
        stale: record.stale,
        ageMs: record.ageMs,
        changedAreaCount: record.changedAreas.length,
        decisionCount: record.decisions.length,
        hasVerificationSummary: Boolean(record.verificationSummary),
        integrationPreference: record.integrationPreference,
      })),
      omittedRecordCount: omittedCount(status.handoffs.records),
      diagnosticCount: status.handoffs.diagnostics.length,
      diagnostics: summaryItems(status.handoffs.diagnostics),
      warningCount: status.handoffs.warnings.length,
      warnings: summaryItems(status.handoffs.warnings),
    },
    nextAction: status.nextAction,
    blocking: status.blocking,
    warningCount: status.warnings.length,
    warnings: summaryItems(status.warnings),
  };
}

function summarizeWorkItem(item: WorkItem): Omit<WorkItem, "description"> & {
  descriptionLength: number | null;
} {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    provider: item.provider,
    labels: item.labels ?? [],
    assignees: item.assignees ?? [],
    milestone: item.milestone ?? null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
    closedAt: item.closedAt ?? null,
    webUrl: item.webUrl ?? null,
    ...(item.externalRef === undefined ? {} : { externalRef: item.externalRef }),
    ...(item.trackerRef === undefined ? {} : { trackerRef: item.trackerRef }),
    descriptionLength:
      item.description === undefined || item.description === null
        ? null
        : item.description.length,
  };
}

function summarizeWorkItemReference(item: WorkItem) {
  return {
    id: item.id,
    title: summaryText(item.title),
    status: item.status,
    provider: item.provider,
    webUrl: item.webUrl ?? null,
    trackerRef: summarizeTrackerRef(item.trackerRef),
    externalRef: item.externalRef
      ? {
          provider: item.externalRef.provider,
          repositoryOwner: item.externalRef.repositoryOwner ?? null,
          repositoryName: item.externalRef.repositoryName ?? null,
          itemId: item.externalRef.itemId,
          itemNumber: item.externalRef.itemNumber ?? null,
          itemKey: item.externalRef.itemKey ?? null,
          webUrl: item.externalRef.webUrl ?? null,
        }
      : null,
  };
}

function summarizeTrackerRef(ref: NonNullable<WorkItem["trackerRef"]> | null | undefined) {
  return ref
    ? {
        componentId: ref.componentId,
        trackerId: ref.trackerId,
        provider: ref.provider,
        roles: ref.roles ?? [],
        default: ref.default ?? false,
      }
    : null;
}

export function summarizeTargetCycleLedger(
  ledger: NexusAutomationTargetCycleLedger,
  ledgerPath: string,
): {
  version: NexusAutomationTargetCycleLedger["version"];
  ledgerPath: string;
  updatedAt: string | null;
  cycleCount: number;
  cycles: Array<{
    id: string;
    status: NexusAutomationTargetCycleStatus;
    startedAt: string;
    finishedAt: string | null;
    runId: string | null;
    targetId: string | null;
    summary: string | null;
    eligibleWorkItemCount: number | null;
    workItemCount: number;
    workItemStatusCounts: Record<string, number>;
    blockerCount: number;
    noteCount: number;
    nextCycleNotBefore: string | null;
    workItemRefs: Array<{
      componentId: string | null;
      id: string;
      cycleStatus: string | null;
      agentProfileId: string | null;
    }>;
    omittedWorkItemRefCount: number;
  }>;
} {
  return {
    version: ledger.version,
    ledgerPath,
    updatedAt: ledger.updatedAt,
    cycleCount: ledger.cycles.length,
    cycles: ledger.cycles.map(summarizeTargetCycleRecord),
  };
}

function summarizeTargetCycleRecord(record: NexusAutomationTargetCycleRecord) {
  return {
    id: record.id,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    runId: record.runId,
    targetId: record.targetId,
    summary: summaryText(record.summary),
    eligibleWorkItemCount: record.eligibleWorkItemCount,
    workItemCount: record.workItems.length,
    workItemStatusCounts: countTargetCycleWorkItemStatuses(record),
    blockerCount: record.blockers.length,
    noteCount: record.notes.length,
    nextCycleNotBefore: record.nextCycleNotBefore,
    workItemRefs: summaryItems(record.workItems).map((item) => ({
      componentId: item.componentId,
      id: item.id,
      cycleStatus: item.cycleStatus,
      agentProfileId: item.agentProfileId,
    })),
    omittedWorkItemRefCount: omittedCount(record.workItems),
  };
}

function countTargetCycleWorkItemStatuses(
  record: NexusAutomationTargetCycleRecord,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of record.workItems) {
    const key = item.cycleStatus ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function summarizeAutomationTarget(
  target: NexusAutomationStatus["target"],
) {
  return target
    ? {
        id: target.id,
        objective: target.objective,
        statePath: target.statePath,
        cycleLedgerPath: target.cycleLedgerPath,
        stateExists: target.stateExists,
        stateMarkdownLength: target.stateMarkdown?.length ?? null,
        stopWhenNoEligibleWork: target.stopWhenNoEligibleWork,
        maxCycles: target.maxCycles,
        maxWorkItems: target.maxWorkItems,
      }
    : null;
}

function summarizeTargetCycleSummary(
  summary: NexusAutomationStatus["targetCycles"],
) {
  return summary
    ? {
        cycleCount: summary.cycleCount,
        activeCycleCount: summary.activeCycleCount,
        completedCycleCount: summary.completedCycleCount,
        blockedCycleCount: summary.blockedCycleCount,
        failedCycleCount: summary.failedCycleCount,
        skippedCycleCount: summary.skippedCycleCount,
        lastCycle: summary.lastCycle
          ? {
              id: summary.lastCycle.id,
              status: summary.lastCycle.status,
              startedAt: summary.lastCycle.startedAt,
              finishedAt: summary.lastCycle.finishedAt,
              runId: summary.lastCycle.runId,
              targetId: summary.lastCycle.targetId,
              summary: summaryText(summary.lastCycle.summary),
              eligibleWorkItemCount: summary.lastCycle.eligibleWorkItemCount,
              workItemCount: summary.lastCycle.workItems.length,
              blockerCount: summary.lastCycle.blockers.length,
              noteCount: summary.lastCycle.notes.length,
              nextCycleNotBefore: summary.lastCycle.nextCycleNotBefore,
            }
          : null,
      }
    : null;
}

function summarizeRunLedger(ledger: NexusAutomationStatus["ledger"]) {
  return ledger
    ? {
        version: ledger.version,
        updatedAt: ledger.updatedAt,
        runCount: ledger.runs.length,
        byStatus: countBy(ledger.runs, (run) => run.status),
        lastRun: ledger.runs.at(-1)
          ? summarizeAutomationRun(ledger.runs.at(-1)!)
          : null,
      }
    : null;
}

function summarizeAutomationRun(
  run: NonNullable<NexusAutomationStatus["ledger"]>["runs"][number],
) {
  return {
    id: run.id,
    projectId: run.projectId,
    componentId: run.componentId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    workItemId: run.workItemId,
    workItemTitle: run.workItemTitle,
    branchName: run.branchName,
    baseRef: run.baseRef,
    commitCount: run.commitIds.length,
    commitIds: run.commitIds.slice(-MCP_SUMMARY_ITEM_LIMIT),
    summary: summaryText(run.summary),
    verificationCount: run.verification.length,
    failedVerificationCount: run.verification.filter(
      (record) => record.status === "failed",
    ).length,
    publicationDecision: run.publicationDecision
      ? {
          type: run.publicationDecision.type,
          remote: run.publicationDecision.remote,
          targetBranch: run.publicationDecision.targetBranch,
          prUrl: run.publicationDecision.prUrl,
          reason: summaryText(run.publicationDecision.reason),
        }
      : null,
    error: summaryText(run.error),
    nextRunNotBefore: run.nextRunNotBefore,
  };
}

function summarizePreflight(preflight: NexusAutomationStatus["preflight"]) {
  return {
    checkCount: preflight.length,
    passedCount: preflight.filter((check) => check.status === "passed").length,
    failedCount: preflight.filter((check) => check.status === "failed").length,
    checks: preflight
      .filter((check) => check.status !== "passed")
      .slice(0, MCP_SUMMARY_ITEM_LIMIT)
      .map((check) => ({
        name: check.name,
        status: check.status,
        message: summaryText(check.message),
      })),
  };
}

function summarizePublicationStatus(
  publication: NexusAutomationStatus["publication"][number],
) {
  return {
    componentId: publication.componentId,
    policy: {
      strategy: publication.policy.strategy,
      remote: publication.policy.remote,
      targetBranch: publication.policy.targetBranch,
      push: publication.policy.push,
    },
    actor: {
      status: publication.actor.status,
      expected: publication.actor.expected
        ? {
            kind: publication.actor.expected.kind,
            provider: publication.actor.expected.provider,
            handle: publication.actor.expected.handle,
            id: publication.actor.expected.id,
          }
        : null,
      observed: publication.actor.observed,
      message: publication.actor.message,
    },
    git: {
      repositoryPath: publication.git.repositoryPath,
      branch: publication.git.branch,
      upstream: publication.git.upstream,
      remoteName: publication.git.remoteName,
      warningCount: publication.git.warnings.length,
    },
    authority: publication.authority
      ? {
          status: publication.authority.status,
          allowed: publication.authority.allowed,
          reason: publication.authority.explanation,
          blockingReasons: publication.authority.blockingReasons,
        }
      : null,
    warningCount: publication.warnings.length,
    warnings: publication.warnings.slice(0, 5),
    blocking: publication.blocking,
  };
}

function summarizePublicationStatuses(
  publications: NexusAutomationStatus["publication"],
) {
  return {
    componentCount: publications.length,
    blockedCount: publications.filter((publication) => publication.blocking)
      .length,
    warningCount: publications.reduce(
      (count, publication) => count + publication.warnings.length,
      0,
    ),
    actorProblemCount: publications.filter(
      (publication) => publication.actor.status !== "matched",
    ).length,
    components: summaryItems(publications).map((publication) => ({
      componentId: publication.componentId,
      strategy: publication.policy.strategy,
      remote: publication.policy.remote,
      targetBranch: publication.policy.targetBranch,
      actorStatus: publication.actor.status,
      authorityStatus: publication.authority?.status ?? null,
      blocking: publication.blocking,
      warningCount: publication.warnings.length,
      warnings: summaryItems(publication.warnings),
    })),
    omittedComponentCount: omittedCount(publications),
  };
}

function summarizeEligibleWorkItem(
  item: NonNullable<NexusAutomationStatus["eligibleWorkItems"]>[number],
) {
  return {
    componentId: item.componentId,
    logicalItemId: item.logicalItemId,
    canonicalTrackerRef: summarizeTrackerRef(item.canonicalTrackerRef),
    sourceTrackerRef: summarizeTrackerRef(item.sourceTrackerRef),
    id: item.id,
    title: item.title,
    status: item.status,
    webUrl: item.webUrl,
    dedupe: item.dedupe
      ? {
          reason: item.dedupe.reason,
          collapsedCount: item.dedupe.collapsedCount,
          logicalItemId: item.dedupe.logicalItemId ?? null,
        }
      : null,
    warningCount: item.warnings.length,
    warnings: summaryItems(item.warnings),
    selectable: item.selectable,
    importOnly: item.importOnly,
  };
}

function summarizeExcludedWorkItem(
  item: NonNullable<
    NonNullable<NexusAutomationStatus["componentEligibleWorkItems"]>[number][
      "excludedWorkItems"
    ]
  >[number],
) {
  return {
    id: item.id,
    title: summaryText(item.title),
    status: item.status,
    provider: item.provider,
    webUrl: item.webUrl ?? item.externalRef?.webUrl ?? null,
    sourceTrackerRef: summarizeTrackerRef(item.sourceTrackerRef),
    reasons: summaryItems(item.reasons),
    reasonCount: item.reasons.length,
    exclusionFindings: summaryItems(item.exclusionFindings).map((finding) => ({
      category: finding.category,
      reason: finding.reason,
      value: finding.value,
    })),
    omittedExclusionFindingCount: omittedCount(item.exclusionFindings),
  };
}

function countAutomationStatusExcludedWorkItems(
  component: NonNullable<NexusAutomationStatus["componentEligibleWorkItems"]>[number],
): number {
  const visibleExcludedCount = (component.trackerResults ?? []).reduce(
    (total, tracker) => total + tracker.excludedCount,
    0,
  );
  const finalLimitExcludedCount = (component.excludedWorkItems ?? []).filter(
    (item) => item.reasons.includes("final limit reached"),
  ).length;

  return visibleExcludedCount + finalLimitExcludedCount;
}

function automationStatusExcludedReasonCounts(
  component: NonNullable<NexusAutomationStatus["componentEligibleWorkItems"]>[number],
): Record<string, number> {
  const counts = mergeSummaryCountRecords(
    (component.trackerResults ?? []).map(
      (tracker) => tracker.exclusionReasonCounts,
    ),
  );
  for (const item of finalLimitExcludedWorkItems(component)) {
    for (const reason of item.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }

  return counts;
}

function automationStatusExcludedCategoryCounts(
  component: NonNullable<NexusAutomationStatus["componentEligibleWorkItems"]>[number],
): Record<string, number> {
  const counts = mergeSummaryCountRecords(
    (component.trackerResults ?? []).map(
      (tracker) => tracker.exclusionCategoryCounts ?? {},
    ),
  );
  for (const item of finalLimitExcludedWorkItems(component)) {
    for (const finding of item.exclusionFindings) {
      counts[finding.category] = (counts[finding.category] ?? 0) + 1;
    }
  }

  return counts;
}

function finalLimitExcludedWorkItems(
  component: NonNullable<NexusAutomationStatus["componentEligibleWorkItems"]>[number],
) {
  return (component.excludedWorkItems ?? []).filter((item) =>
    item.reasons.includes("final limit reached"),
  );
}

function mergeSummaryCountRecords(
  records: Array<Record<string, number> | undefined>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record ?? {})) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

function summarizeExternalIssueVisibility(value: unknown) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const components = Array.isArray(record.components) ? record.components : [];
  return {
    summary: record.summary,
    componentCount: record.componentCount,
    defaultTrackerOnlyComponentCount: record.defaultTrackerOnlyComponentCount,
    externalIgnoredComponentCount: record.externalIgnoredComponentCount,
    importRequiredComponentCount: record.importRequiredComponentCount,
    directSelectableComponentCount: record.directSelectableComponentCount,
    selectedTrackerCount: record.selectedTrackerCount,
    ignoredTrackerCount: record.ignoredTrackerCount,
    importOnlyWorkItemCount: record.importOnlyWorkItemCount,
    providerAccessWarningCount: record.providerAccessWarningCount,
    providerAccessBlockerCount: record.providerAccessBlockerCount,
    components: summaryItems(components).map((componentValue) => {
      const component = componentValue as Record<string, unknown>;
      const providerAccessBlockers = Array.isArray(
        component.providerAccessBlockers,
      )
        ? component.providerAccessBlockers.slice(0, 3)
        : [];
      return {
        componentId: component.componentId,
        mode: component.mode,
        selectedTrackerCount: component.selectedTrackerCount,
        ignoredTrackerCount: component.ignoredTrackerCount,
        selectedExternalTrackerCount: component.selectedExternalTrackerCount,
        importOnlyWorkItemCount: component.importOnlyWorkItemCount,
        providerAccessWarningCount: component.providerAccessWarningCount,
        providerAccessBlockerCount: component.providerAccessBlockerCount,
        ...(providerAccessBlockers.length > 0 ? { providerAccessBlockers } : {}),
      };
    }),
    omittedComponentCount: omittedCount(components),
  };
}

function summarizeAuthorityProject(
  authority: NexusAutomationStatus["authority"] | null,
) {
  if (!authority) {
    return null;
  }
  const blockedDecisionCount = authority.components.reduce(
    (count, component) =>
      count + component.decisions.filter((decision) => !decision.allowed).length,
    0,
  );
  const blockedActionCount = authority.components.reduce(
    (count, component) => count + component.blockedActions.length,
    0,
  );
  const componentsWithProblems = authority.components.filter(
    (component) =>
      component.actor.status !== "matched" ||
      component.blockedActions.length > 0 ||
      component.warnings.length > 0,
  );
  return authority
    ? {
        version: authority.version,
        projectId: authority.projectId,
        componentCount: authority.components.length,
        blockedActionCount,
        blockedDecisionCount,
        problemComponentCount: componentsWithProblems.length,
        problemComponents: summaryItems(componentsWithProblems).map(
          summarizeAuthorityComponent,
        ),
        omittedProblemComponentCount: omittedCount(componentsWithProblems),
        warningCount: authority.warnings.length,
        warnings: summaryItems(authority.warnings),
      }
    : null;
}

function summarizeAuthorityComponent(
  component: NexusAutomationStatus["authority"]["components"][number] | null,
) {
  return component
    ? {
        componentId: component.componentId,
        componentName: component.componentName,
        actor: {
          status: component.actor.status,
          actorId: component.actor.actorId,
          provider: component.actor.provider,
          handle: component.actor.handle,
        },
        blockedActionCount: component.blockedActions.length,
        blockedActions: summaryItems(component.blockedActions),
        omittedBlockedActionCount: omittedCount(component.blockedActions),
        decisionCount: component.decisions.length,
        blockedDecisionCount: component.decisions.filter(
          (decision) => !decision.allowed,
        ).length,
        warningCount: component.warnings.length,
        warnings: summaryItems(component.warnings),
      }
    : null;
}

function summarizeTargetWorkItemReference(
  item: NonNullable<
    NexusAutomationTargetReport["workItemSummary"]
  >["uniqueReferences"][number],
) {
  return {
    componentId: item.componentId,
    trackerId: item.trackerId,
    trackerProvider: item.trackerProvider,
    id: item.id,
    title: summaryText(item.title),
    status: item.status,
    latestCycleStatus: item.latestCycleStatus,
    latestCycleId: item.latestCycleId,
    agentProfileId: item.agentProfileId,
    hasNotes: Boolean(item.notes),
  };
}

function summarizeTargetExecutionRun(
  run: NonNullable<NexusAutomationTargetReport["executionSummary"]>["runs"][number],
) {
  return {
    runId: run.runId,
    componentId: run.componentId,
    status: run.status,
    workItemId: run.workItemId,
    workItemTitle: summaryText(run.workItemTitle),
    commitCount: run.commitIds.length,
    commitIds: run.commitIds.slice(-MCP_SUMMARY_ITEM_LIMIT),
    summary: summaryText(run.summary),
    error: summaryText(run.error),
  };
}

function summarizeVersionPlanning(
  versionPlanning: NonNullable<NexusAutomationTargetReport["versionPlanning"]>,
) {
  return {
    versionCount: versionPlanning.versionCount,
    shownVersionCount: versionPlanning.shownVersionCount,
    omittedVersionCount: versionPlanning.omittedVersionCount,
    versions: summaryItems(versionPlanning.versions).map((version) => ({
      id: version.id,
      targetBranch: version.targetBranch,
      owningComponents: version.owningComponents,
      scopeCounts: version.scopeCounts,
      readiness: version.readiness,
      blockerCount: version.blockers.length,
      blockers: summaryItems(version.blockers),
      gateWarningCount: version.gateWarnings.length,
      gateWarnings: summaryItems(version.gateWarnings).map((warning) => ({
        kind: warning.kind,
        required: warning.required,
        status: warning.status,
        message: summaryText(warning.message),
      })),
      warningCount: version.warnings.length,
      warnings: summaryItems(version.warnings),
    })),
  };
}

function countTargetWorkItemProgress(
  progress: NexusAutomationTargetReport["componentProgress"][number]["workItems"],
) {
  return {
    readyEligibleWorkCount: progress.readyEligibleWork.length,
    selectedWorkCount: progress.selectedWork.length,
    blockedHitlWorkCount: progress.blockedHitlWork.length,
    completedWorkCount: progress.completedWork.length,
    failedWorkCount: progress.failedWork.length,
    skippedWorkCount: progress.skippedWork.length,
    staleInProgressWorkCount: progress.staleInProgressWork.length,
    readyEligibleWork: summaryItems(progress.readyEligibleWork).map(
      summarizeTargetWorkItemReference,
    ),
    omittedReadyEligibleWorkCount: omittedCount(progress.readyEligibleWork),
    selectedWork: summaryItems(progress.selectedWork).map(
      summarizeTargetWorkItemReference,
    ),
    omittedSelectedWorkCount: omittedCount(progress.selectedWork),
    blockedHitlWork: summaryItems(progress.blockedHitlWork).map(
      summarizeTargetWorkItemReference,
    ),
    omittedBlockedHitlWorkCount: omittedCount(progress.blockedHitlWork),
  };
}

function countBy<T>(
  values: readonly T[],
  keyForValue: (value: T) => string | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyForValue(value) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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
        if (this.buffer.length === 0) {
          return;
        }

        if (this.startsWithContentLengthFrame()) {
          const processed = await this.processContentLengthFrame();
          if (!processed) {
            return;
          }
          continue;
        }

        const processed = await this.processJsonLine();
        if (!processed) {
          return;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processContentLengthFrame(): Promise<boolean> {
    const headerEnd = this.headerEndIndex();
    if (!headerEnd) {
      return false;
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
      return false;
    }

    const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
    this.buffer = this.buffer.slice(messageEnd);
    await this.handleMessageBody(body, "content-length");
    return true;
  }

  private async processJsonLine(): Promise<boolean> {
    const newlineIndex = this.buffer.indexOf("\n");
    if (newlineIndex < 0) {
      return false;
    }

    const line = this.buffer.slice(0, newlineIndex).toString("utf8").trim();
    this.buffer = this.buffer.slice(newlineIndex + 1);
    if (!line) {
      return true;
    }

    await this.handleMessageBody(line, "json-line");
    return true;
  }

  private async handleMessageBody(
    body: string,
    responseFormat: "content-length" | "json-line",
  ): Promise<void> {
    const response = await this.onMessage(JSON.parse(body) as JsonRpcRequest);
    if (response) {
      this.send(response, responseFormat);
    }
  }

  private startsWithContentLengthFrame(): boolean {
    return this.buffer
      .subarray(0, Math.min(this.buffer.length, "Content-Length:".length))
      .toString("utf8")
      .toLowerCase() === "content-length:".toLowerCase();
  }

  private headerEndIndex(): [number, number] | undefined {
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    if (crlfIndex >= 0) {
      return [crlfIndex, 4];
    }

    const lfIndex = this.buffer.indexOf("\n\n");
    return lfIndex >= 0 ? [lfIndex, 2] : undefined;
  }

  private send(
    message: unknown,
    responseFormat: "content-length" | "json-line" = "content-length",
  ): void {
    const body = JSON.stringify(message);
    if (responseFormat === "json-line") {
      this.streams.stdout.write(`${body}\n`);
      return;
    }

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

function optionalEligibleWorkMode(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusEligibleWorkMode | undefined {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return undefined;
  }
  if (value === "default" || value === "discovery") {
    return value;
  }

  throw new Error(`${pathName}.${key} must be default or discovery`);
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

function requiredPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number {
  const value = optionalPositiveInteger(record, key, pathName);
  if (value === undefined) {
    throw new Error(`${pathName}.${key} is required`);
  }

  return value;
}

function optionalNullableInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${pathName}.${key} must be an integer or null`);
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

function parseWorkStatusQuery(value: string, pathName: string): WorkStatusQuery {
  if (value === "open" || value === "closed") {
    return value;
  }

  return parseWorkStatus(value, pathName);
}

function optionalStaleClaimPolicy(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusWorkItemStaleClaimPolicy | undefined {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return undefined;
  }
  if (value === "report" || value === "reclaim") {
    return value;
  }

  throw new Error(`${pathName}.${key} must be report or reclaim`);
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

function optionalHeartbeatStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusAutomationHeartbeatStatus | undefined {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return undefined;
  }
  if (value === "ACTIVE" || value === "PAUSED") {
    return value;
  }

  throw new Error(`${pathName}.${key} must be ACTIVE or PAUSED`);
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
): WorkStatusQuery | WorkStatusQuery[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return parseWorkStatusQuery(value, `${pathName}.${key}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be a status or array of statuses`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${pathName}.${key}[${index}] must be a status`);
    }

    return parseWorkStatusQuery(item, `${pathName}.${key}[${index}]`);
  });
}

function optionalNeutralWorkStatusQuery(
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
    trackerId: optionalNullableString(record, "trackerId", pathName) ?? null,
    trackerProvider:
      optionalNullableString(record, "trackerProvider", pathName) ?? null,
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
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName}.${key} must be a valid target cycle work item status`);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
