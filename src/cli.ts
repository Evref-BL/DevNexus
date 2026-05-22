#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";
import {
  assertCliMutationAllowed,
  type DevNexusCliDependencies,
} from "./cliCommandContext.js";
export type { DevNexusCliDependencies } from "./cliCommandContext.js";
import { handleCiFailureIntakeCommand } from "./cliCiFailureIntakeCommand.js";
import {
  projectComponentAddUsage,
  projectSetupUsage,
  usage,
} from "./cliUsage.js";
export {
  projectComponentAddUsage,
  projectSetupUsage,
  usage,
} from "./cliUsage.js";
import { handleDiagnosticsCommand } from "./cliDiagnosticsCommand.js";
import { handleAuthCommand } from "./cliAuthCommand.js";
import { handleHostCommand } from "./cliHostCommand.js";
import { handlePublicationCommand } from "./cliPublicationCommand.js";
import { isCliEntrypoint } from "./cliRuntime.js";
import {
  parseQuickFixPlanCommand,
  printQuickFixFinish,
  printQuickFixPlan,
  printQuickFixStart,
} from "./cliQuickFixCommand.js";
import {
  handleRemoteExecutionCommand,
  type ParsedRemoteExecutionRequestCreateCommand,
} from "./cliRemoteExecutionCommand.js";
import {
  createNexusAutomationCommandExecutor,
} from "./nexusAutomationCommandExecutor.js";
import {
  createNexusAutomationAgentCommandLauncher,
  runNexusAutomationAgentLaunchOnce,
  type RunNexusAutomationAgentLaunchOnceResult,
} from "./nexusAutomationAgentLaunch.js";
import {
  resolveNexusAutomationAgentCommand,
  shellQuoteArgument,
} from "./nexusAutomationAgentProfile.js";
import {
  probeCodexAppServerInitialize,
  type CodexAppServerInitializeProbeReport,
} from "./codexAppServerInitializeProbe.js";
import {
  enqueueNexusAutomationWorkItem,
  type EnqueueNexusAutomationWorkItemResult,
} from "./nexusAutomationEnqueue.js";
import {
  prepareNexusAutomationHeartbeat,
  type NexusAutomationHeartbeatPreparation,
  type NexusAutomationHeartbeatStatus,
} from "./nexusAutomationHeartbeat.js";
import {
  runNexusAutomationOnce,
  type RunNexusAutomationOnceResult,
} from "./nexusAutomationRunOnce.js";
import {
  runNexusAutomationScheduler,
  type NexusAutomationSchedulerTick,
  type RunNexusAutomationSchedulerResult,
} from "./nexusAutomationScheduler.js";
import {
  runNexusAutomationCoordinatorLoop,
  type NexusAutomationCoordinatorLoopProgressEvent,
  type NexusAutomationCoordinatorLoopTick,
  type RunNexusAutomationCoordinatorLoopResult,
} from "./nexusAutomationCoordinatorLoop.js";
import {
  adoptNexusAutomationCurrentAgent,
  adoptNexusAutomationCurrentAgentFromCoordinatorLoop,
  recordNexusAutomationCurrentAgentAdoptionResult,
  type AdoptNexusAutomationCurrentAgentFromCoordinatorLoopResult,
  type AdoptNexusAutomationCurrentAgentResult,
  type NexusAutomationCurrentAgentAdoptionResultInput,
  type NexusAutomationCurrentAgentAdoptionResultStatus,
} from "./nexusAutomationCurrentAgentAdoption.js";
import {
  getNexusAutomationStatus,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  summarizeAutomationStatus,
  summarizeCoordinationStatus,
  summarizeProjectStatus,
  summarizeTargetCycleLedger,
  summarizeTargetReport,
} from "./nexusMcpServer.js";
import type {
  NexusAuthorityComponentSummary,
  NexusAuthorityProjectSummary,
} from "./nexusAuthority.js";
import {
  loadNexusPublicationAuthProfiles,
  resolveNexusPublicationPolicy,
  NexusPublicationActorStatus,
  NexusPublicationStatus,
} from "./nexusPublicationPolicy.js";
import type { NexusGitIdentityStatus } from "./nexusGitIdentity.js";
import {
  getNexusAutomationAgentProfileSummary,
  type NexusAutomationAgentProfileSummary,
} from "./nexusAutomationAgentSurface.js";
import {
  getNexusEligibleWorkSummary,
  type NexusEligibleWorkMode,
  type NexusEligibleWorkSummary,
} from "./nexusEligibleWorkSummary.js";
import {
  defaultNexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import type {
  NexusExternalIssueVisibilitySummary,
} from "./nexusExternalIssueVisibility.js";
import {
  appendNexusAutomationTargetCycleRecord,
  nexusAutomationTargetCycleLedgerPath,
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleRecordInput,
  type NexusAutomationTargetCycleStatus,
  type NexusAutomationTargetCycleWorkItemInput,
  type NexusAutomationTargetCycleWorkItemStatus,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  createNexusCoordinationHandoff,
  getNexusCoordinationIntegrationPlan,
  getNexusCoordinationStatus,
  nexusCoordinationErrorPayload,
  parseNexusCoordinationHandoffStatus,
  parseNexusCoordinationTrackerRole,
  type NexusCoordinationHandoffResult,
  type NexusCoordinationHandoffStatus,
  type NexusCoordinationIntegrationPlan,
  type NexusCoordinationStatus,
} from "./nexusCoordination.js";
import {
  createNexusCoordinationRequest,
  parseNexusCoordinationRequestIntent,
  parseNexusCoordinationRequestStatus,
  type NexusCoordinationRequestIntent,
  type NexusCoordinationRequestResult,
  type NexusCoordinationRequestStatus,
} from "./nexusCoordinationRequest.js";
import type { NexusRemoteExecutionAttachmentRef } from "./nexusRemoteExecution.js";
import {
  buildNexusCleanupPlan,
  type NexusCleanupPlan,
} from "./nexusCleanupPlan.js";
import {
  buildNexusSetupCheck,
  buildNexusSetupPlan,
  listNexusSetupFlows,
  recordNexusSetupStep,
  type NexusSetupCheck,
  type NexusSetupFlowSummary,
  type NexusSetupPlan,
  type NexusSetupPlatform,
  type NexusSetupRecordedStepStatus,
  type RecordNexusSetupStepResult,
} from "./nexusSetupAssistant.js";
import {
  materializeNexusProjectAgentMcpConfig,
  resolveNexusProjectAgentMcpTargets,
  type MaterializeNexusProjectAgentMcpConfigResult,
  type MaterializedNexusAgentMcpTarget,
} from "./nexusAgentMcpConfig.js";
import {
  buildNexusMcpContextBudgetReport,
  type NexusMcpContextBudgetReport,
} from "./nexusMcpContextBudget.js";
import {
  resolveNexusMcpExposure,
  resolveNexusPluginMcpServerExposures,
  type NexusPluginMcpServerExposureResolution,
} from "./nexusMcpExposurePolicy.js";
import {
  refreshNexusProjectPlugin,
  type RefreshNexusProjectPluginResult,
} from "./nexusProjectPluginRefresh.js";
import {
  applyNexusAgentProjectionCleanup,
  planNexusAgentProjectionCleanup,
  type NexusAgentProjectionCleanupApplyResult,
  type NexusAgentProjectionCleanupPlan,
} from "./nexusAgentProjectionCleanup.js";
import { runDevNexusMcpStdioServer } from "./nexusMcpServer.js";
import { runDevNexusMcpGatewayStdioServer } from "./nexusMcpGateway.js";
import {
  nexusMcpGatewayAgentTargets,
} from "./nexusMcpGatewayProjection.js";
import {
  prepareNexusManualWorktree,
  resolveNexusManualWorktreeWorkItem,
  summarizeNexusManualWorktreeResult,
  type PrepareNexusManualWorktreeResult,
} from "./nexusManualWorktree.js";
import { buildNexusQuickFixPlan } from "./nexusQuickFix.js";
import {
  nexusAuthorityMutationBlock,
  resolveNexusCurrentAutomationActor,
  resolveNexusEffectiveAuthorityForCurrentActor,
  unconfiguredNexusAuthorityAllowedResolution,
  type NexusAuthorityAction,
  type NexusAuthorityMutationBlock,
  type NexusEffectiveAuthorityResolution,
} from "./nexusAuthority.js";
import {
  createDefaultNexusHomeConfigBase,
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  nexusHomeConfigPath,
  resolveNexusHome,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  loadProjectConfig,
  selectNexusProjectMcpAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  applyNexusProjectSetup,
  buildNexusProjectSetupApplyNextActions,
  loadNexusProjectSetupAnswers,
  previewNexusProjectSetup,
  renderNexusProjectSetupRequiredAnswers,
  renderNexusProjectSetupProposalSummary,
  nexusProjectSetupRequiredAnswerPaths,
  type NexusProjectSetupApplyResult,
  type NexusProjectSetupProposal,
} from "./nexusProjectSetupWizard.js";
import {
  buildNexusProjectSetupReadinessReport,
  type NexusProjectSetupReadinessReport,
} from "./nexusProjectSetupReadiness.js";
import {
  applyNexusProjectComponentAdd,
  previewNexusProjectComponentAdd,
  readNexusProjectComponentAddAnswersFile,
  type NexusProjectComponentAddApplyResult,
  type NexusProjectComponentAddProposal,
} from "./nexusProjectComponentAdd.js";
import {
  applyNexusProjectHosting,
  planNexusProjectHosting,
  statusNexusProjectHosting,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingApplyResult,
  type NexusProjectHostingLocalRemoteRecord,
  type NexusProjectHostingLocalRemoteCommand,
  type NexusProjectHostingLocalRemoteCommandResult,
  type NexusProjectHostingPlanResult,
  type NexusProjectHostingStatusResult,
} from "./nexusProjectHosting.js";
import {
  configureNexusProjectTracker,
  createNexusProject,
  getNexusProjectStatus,
  importNexusProject,
  linkNexusProjectTracker,
  listNexusProjects,
  type ConfigureNexusProjectTrackerResult,
  type CreateNexusProjectResult,
  type ImportNexusProjectResult,
  type LinkNexusProjectTrackerResult,
  type ListNexusProjectsResult,
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
  type NexusWorkItemDiscoveryStatus,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  claimNexusEligibleWorkItem,
  type NexusWorkItemClaimResult,
  type NexusWorkItemStaleClaimPolicy,
} from "./nexusWorkItemClaim.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "./workItemService.js";
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
  type WorkItemSyncCommentPolicyMode,
  type WorkItemSyncConflictPolicyMode,
  type WorkItemSyncCredentialPolicy,
  type WorkItemSyncField,
  type WorkItemSyncPlan,
  type WorkItemSyncPolicyConfig,
  type WorkItemSyncRun,
  type WorkItemSyncWriteDisposition,
} from "./workItemSyncPlanner.js";
import {
  createWorkItemImportPlan,
  defaultWorkItemImportPolicy,
  executeWorkItemImport,
  parseWorkItemImportDirection,
  parseWorkItemImportFingerprint,
  type WorkItemImportExecutionAuthorityInput,
  type WorkItemImportDirection,
  type WorkItemImportFingerprint,
  type WorkItemImportPlan,
  type WorkItemImportPolicyConfig,
  type WorkItemImportRun,
} from "./workItemImportPlanner.js";
import {
  createWorkItemTrackerLinkService,
  type LinkWorkItemTrackerReferenceResult,
  type ShowWorkItemTrackerLinksResult,
  type UnlinkWorkItemTrackerReferenceResult,
} from "./workItemTrackerLinks.js";
import { defaultGitRunner, type GitRunner } from "./gitWorktreeService.js";
import type {
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkStatus,
  WorkStatusQuery,
} from "./workTrackingTypes.js";

interface ProjectHostingStatusCliResult {
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  status: NexusProjectHostingStatusResult;
}

interface ProjectHostingPlanCliResult extends ProjectHostingStatusCliResult {
  plan: NexusProjectHostingPlanResult;
}

interface ProjectHostingApplyCliResult extends ProjectHostingStatusCliResult {
  apply: NexusProjectHostingApplyResult;
}

type CliOutputDetail = "summary" | "full";

interface ParsedHomeInitCommand {
  homePath: string;
  projectsRoot?: string;
  workspacesRoot?: string;
  json?: boolean;
}

interface ParsedProjectCreateCommand {
  homePath?: string;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  trackerProjectId?: string;
  json?: boolean;
}

interface ParsedProjectSetupCommand {
  projectRoot?: string;
  homePath?: string;
  answersPath?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface ParsedProjectComponentAddCommand {
  projectRoot: string;
  homePath?: string;
  answersPath: string;
  dryRun?: boolean;
  json?: boolean;
}

interface ParsedProjectImportCommand {
  homePath?: string;
  root: string;
  projectRoot?: string;
  name?: string;
  trackerProjectId?: string;
  json?: boolean;
}

interface ParsedProjectListCommand {
  homePath?: string;
  json?: boolean;
}

interface ParsedProjectStatusCommand {
  homePath?: string;
  project: string;
  json?: boolean;
  detail?: CliOutputDetail;
}

interface ParsedProjectHostingCommand {
  command: "status" | "plan" | "apply";
  projectRoot: string;
  homePath?: string;
  json?: boolean;
}

interface ParsedProjectMcpRefreshCommand {
  projectRoot: string;
  agents: string[];
  dryRun?: boolean;
  json?: boolean;
}

interface ProjectMcpRefreshExposurePlan {
  directTargets: Array<{
    agent: string;
    provider: string;
    serverName: string;
    mode: string;
    source: string;
    path: string | null;
    reason: string;
  }>;
  pluginServers: NexusPluginMcpServerExposureResolution[];
}

interface ProjectMcpRefreshDryRunResult {
  agentTargets: MaterializedNexusAgentMcpTarget[];
  capabilityGaps: MaterializeNexusProjectAgentMcpConfigResult["capabilityGaps"];
  gitExcludePath: null;
  gitExcludeEntries: [];
  exposurePlan: ProjectMcpRefreshExposurePlan;
}

interface ParsedProjectMcpBudgetCommand {
  projectRoot: string;
  agents: string[];
  topLimit?: number;
  json?: boolean;
}

interface ParsedProjectPluginRefreshCommand {
  projectRoot: string;
  from: string;
  exportName?: string;
  skillsExportName?: string;
  agents: string[];
  components: string[];
  dryRun?: boolean;
  json?: boolean;
}

interface ParsedProjectAgentProjectionCleanupCommand {
  projectRoot: string;
  apply?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

interface ParsedProjectTrackerConfigureCommand {
  homePath?: string;
  project: string;
  provider: "local" | "github" | "gitlab" | "jira";
  host?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryId?: string;
  projectKey?: string;
  issueType?: string;
  storePath?: string;
  json?: boolean;
}

interface ParsedProjectTrackerLinkCommand {
  homePath?: string;
  project: string;
  trackerProjectId: string;
  json?: boolean;
}

interface ParsedSetupListCommand {
  json?: boolean;
}

interface ParsedSetupPlanCommand {
  projectRoot: string;
  flowId: string;
  platform?: NexusSetupPlatform;
  json?: boolean;
}

interface ParsedSetupCheckCommand {
  projectRoot: string;
  flowId: string;
  platform?: NexusSetupPlatform;
  json?: boolean;
}

interface ParsedSetupReadinessCommand {
  projectRoot: string;
  platform?: NexusSetupPlatform;
  json?: boolean;
}

interface ParsedSetupRecordCommand {
  projectRoot: string;
  flowId: string;
  stepId: string;
  status: NexusSetupRecordedStepStatus;
  note?: string | null;
  json?: boolean;
}

interface ParsedWorkItemCreateCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels: string[];
  assignees: string[];
  milestone?: string | null;
  json?: boolean;
}

interface ParsedWorkItemDiscoveryStatusCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedWorkItemClaimNextCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  mode?: NexusEligibleWorkMode;
  hostId: string;
  agentId?: string | null;
  ownerId?: string | null;
  leaseDurationMs?: number;
  staleClaimPolicy?: NexusWorkItemStaleClaimPolicy;
  json?: boolean;
}

interface ParsedWorkItemListCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  statuses: WorkStatusQuery[];
  labels: string[];
  assignees: string[];
  search?: string;
  limit?: number;
  json?: boolean;
}

interface ParsedWorkItemGetCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  itemId: string;
  json?: boolean;
}

interface ParsedWorkItemUpdateCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  itemId: string;
  patch: WorkItemPatch;
  json?: boolean;
}

interface ParsedWorkItemCommentCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  itemId: string;
  body: string;
  json?: boolean;
}

interface ParsedWorkItemSetStatusCommand {
  projectRoot: string;
  componentId?: string;
  trackerId?: string;
  itemId: string;
  status: WorkStatus;
  json?: boolean;
}

interface ParsedWorkItemLinkCommand {
  projectRoot: string;
  componentId?: string;
  logicalItemId: string;
  trackerId: string;
  provider?: string;
  host?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  itemId: string;
  itemNumber?: number | null;
  itemKey?: string | null;
  nodeId?: string | null;
  webUrl?: string | null;
  observedAt?: string | null;
  json?: boolean;
}

interface ParsedWorkItemShowLinksCommand {
  projectRoot: string;
  componentId?: string;
  logicalItemId: string;
  json?: boolean;
}

interface ParsedWorkItemUnlinkCommand {
  projectRoot: string;
  componentId?: string;
  logicalItemId: string;
  trackerId: string;
  itemId: string;
  reason?: string | null;
  json?: boolean;
}

interface ParsedWorkItemSyncPlanCommand {
  projectRoot: string;
  componentId?: string;
  sourceTrackerId: string;
  targetTrackerId: string;
  direction?: "source_to_target";
  openOnly?: boolean;
  statuses: WorkStatus[];
  labels: string[];
  assignees: string[];
  search?: string;
  limit?: number;
  fields: WorkItemSyncField[];
  commentPolicy?: WorkItemSyncCommentPolicyMode;
  statusMapping: Partial<Record<WorkStatus, WorkStatus>>;
  conflictPolicy?: WorkItemSyncConflictPolicyMode;
  writeCreates?: WorkItemSyncWriteDisposition;
  writeUpdates?: WorkItemSyncWriteDisposition;
  credentials?: WorkItemSyncCredentialPolicy;
  policyReason?: string | null;
  json?: boolean;
}

interface ParsedWorkItemImportPlanCommand {
  projectRoot: string;
  componentId?: string;
  sourceTrackerId: string;
  targetTrackerId: string;
  direction?: WorkItemImportDirection;
  statuses: WorkStatus[];
  labels: string[];
  assignees: string[];
  search?: string;
  limit?: number;
  fields: WorkItemSyncField[];
  statusMapping: Partial<Record<WorkStatus, WorkStatus>>;
  conflictPolicy?: WorkItemSyncConflictPolicyMode;
  writeCreates?: WorkItemSyncWriteDisposition;
  writeUpdates?: WorkItemSyncWriteDisposition;
  writeLinks?: WorkItemSyncWriteDisposition;
  credentials?: WorkItemSyncCredentialPolicy;
  policyReason?: string | null;
  fingerprints: WorkItemImportFingerprint[];
  json?: boolean;
}

interface ParsedAutomationRunOnceCommand {
  projectRoot: string;
  command?: string;
  runId?: string;
  owner?: string;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string;
  timeoutMs?: number;
  runFullVerification?: boolean;
  json?: boolean;
}

interface ParsedAutomationStatusCommand {
  projectRoot: string;
  homePath?: string;
  json?: boolean;
  detail?: CliOutputDetail;
}

interface ParsedAutomationEligibleWorkCommand {
  projectRoot: string;
  mode?: NexusEligibleWorkMode;
  json?: boolean;
}

interface ParsedAutomationAgentProfilesCommand {
  projectRoot: string;
  json?: boolean;
}

interface ParsedAutomationAppServerProbeCommand {
  projectRoot: string;
  profileId?: string;
  json?: boolean;
}

interface ParsedAutomationEnqueueCommand {
  projectRoot: string;
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels: string[];
  assignees: string[];
  milestone?: string | null;
  json?: boolean;
}

interface ParsedAutomationHeartbeatPrepareCommand {
  projectRoot: string;
  name?: string | null;
  intervalMinutes?: number | null;
  status?: NexusAutomationHeartbeatStatus | null;
  json?: boolean;
}

interface ParsedAutomationTargetCycleListCommand {
  projectRoot: string;
  json?: boolean;
  detail?: CliOutputDetail;
}

interface ParsedAutomationTargetCycleRecordCommand {
  projectRoot: string;
  cycleId?: string;
  runId?: string;
  status: NexusAutomationTargetCycleStatus;
  summary?: string | null;
  eligibleWorkItemCount?: number | null;
  workItems: NexusAutomationTargetCycleWorkItemInput[];
  blockers: string[];
  notes: string[];
  json?: boolean;
  detail?: CliOutputDetail;
}

interface ParsedAutomationTargetReportCommand {
  projectRoot: string;
  json?: boolean;
  detail?: CliOutputDetail;
}

interface ParsedCoordinationStatusCommand {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  trackerId?: string;
  trackerRole?: string;
  currentPath?: string;
  json?: boolean;
  detail?: CliOutputDetail;
}

interface ParsedCoordinationHandoffCommand {
  projectRoot: string;
  componentId?: string;
  workItemId: string;
  trackerId?: string;
  trackerRole?: string;
  status: NexusCoordinationHandoffStatus;
  hostId?: string;
  agentId?: string;
  changedAreas: string[];
  decisions: string[];
  verificationSummary?: string | null;
  integrationPreference?: string | null;
  note?: string | null;
  currentPath?: string;
  json?: boolean;
}

interface ParsedCoordinationIntegrateCommand {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  trackerId?: string;
  trackerRole?: string;
  targetBranch?: string;
  fetch?: boolean;
  currentPath?: string;
  json?: boolean;
}

interface ParsedCoordinationCleanupPlanCommand {
  projectRoot: string;
  componentId?: string;
  includeProjectMeta?: boolean;
  targetBranch?: string;
  json?: boolean;
}

interface ParsedCoordinationRequestCommand {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  trackerId?: string;
  trackerRole?: string;
  intent: NexusCoordinationRequestIntent;
  question?: string | null;
  note?: string | null;
  target?: string | null;
  hostId?: string;
  agentId?: string;
  responseStatus?: NexusCoordinationRequestStatus;
  responseSummary?: string | null;
  responder?: string | null;
  requestedChanges: string[];
  currentPath?: string;
  json?: boolean;
}

interface ParsedWorktreePrepareCommand {
  projectRoot: string;
  componentId?: string;
  projectMeta?: boolean;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string | null;
  initiativeId?: string | null;
  initiativeSlice?: string | null;
  initiativeParentBranch?: string | null;
  initiativeStackPosition?: number | null;
  branchIntent?: string | null;
  topic?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  hostId?: string | null;
  agentId?: string | null;
  workerAgentProvider?: string | null;
  writeScope: string[];
  leaseNotes: string[];
  json?: boolean;
}

interface ParsedAutomationScheduleCommand {
  projectRoot: string;
  command?: string;
  owner?: string;
  baseRef?: string;
  intervalMs?: number;
  maxTicks?: number;
  maxRuns?: number;
  runIdPrefix?: string;
  timeoutMs?: number;
  runFullVerification?: boolean;
  json?: boolean;
}

interface ParsedAutomationCoordinatorLoopCommand {
  projectRoot: string;
  command?: string;
  owner?: string;
  intervalMs?: number;
  maxTicks?: number;
  maxRuns?: number;
  runIdPrefix?: string;
  timeoutMs?: number;
  runFullVerification?: boolean;
  adoptCurrent?: boolean;
  runId?: string;
  progressJsonl?: boolean;
  json?: boolean;
}

interface ParsedAutomationCurrentAgentAdoptCommand {
  projectRoot: string;
  runId?: string;
  owner?: string;
  json?: boolean;
}

interface ParsedAutomationCurrentAgentRecordCommand {
  projectRoot: string;
  runId: string;
  result: NexusAutomationCurrentAgentAdoptionResultInput;
  json?: boolean;
}

export async function main(
  argv: string[],
  dependencies: DevNexusCliDependencies = {},
): Promise<number> {
  try {
    return await mainUnchecked(argv, dependencies);
  } catch (error) {
    if (!argvRequestsJson(argv)) {
      throw error;
    }
    writeJson(dependencies.stdout ?? process.stdout, cliErrorPayload(error));
    return 1;
  }
}

async function mainUnchecked(
  argv: string[],
  dependencies: DevNexusCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    writeLine(stdout, usage());
    return 0;
  }

  if (argv[0] === "home") {
    return handleHomeCommand(argv, dependencies);
  }
  if (argv[0] === "auth") {
    return handleAuthCommand(argv, dependencies);
  }
  if (argv[0] === "workspace") {
    return handleProjectCommand(argv, dependencies);
  }
  if (argv[0] === "setup") {
    return handleSetupCommand(argv, dependencies);
  }
  if (argv[0] === "diagnostics") {
    return handleDiagnosticsCommand(argv, { ...dependencies, usage });
  }
  if (argv[0] === "host") {
    return handleHostCommand(argv, dependencies);
  }
  if (argv[0] === "coordination") {
    return handleCoordinationCommand(argv, dependencies);
  }
  if (argv[0] === "remote-execution") {
    return handleRemoteExecutionCommand(argv, {
      stdout: dependencies.stdout,
      now: dependencies.now,
      assertMutationAllowed: (options) =>
        assertCliMutationAllowed(dependencies, options),
      coordinationAttachmentRefs: remoteExecutionCoordinationAttachmentRefs,
    });
  }
  if (argv[0] === "worktree") {
    return handleWorktreeCommand(argv, dependencies);
  }
  if (argv[0] === "publication") {
    return handlePublicationCommand(argv, dependencies);
  }
  if (argv[0] === "quick-fix") {
    return handleQuickFixCommand(argv, dependencies);
  }
  if (argv[0] === "work-item") {
    return handleWorkItemCommand(argv, dependencies);
  }
  if (argv[0] === "ci-failure-intake") {
    return handleCiFailureIntakeCommand(argv, dependencies);
  }
  if (argv[0] === "automation") {
    return handleAutomationCommand(argv, dependencies);
  }
  if (argv[0] === "mcp-stdio") {
    await runDevNexusMcpStdioServer();
    return 0;
  }
  if (argv[0] === "mcp-gateway-stdio") {
    await runDevNexusMcpGatewayStdioServer();
    return 0;
  }

  throw new Error(
    "dev-nexus requires home, auth, workspace, setup, diagnostics, host, coordination, remote-execution, worktree, publication, quick-fix, work-item, ci-failure-intake, automation, mcp-stdio, mcp-gateway-stdio, or --help",
  );
}

async function handleHomeCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  if (argv[1] !== "init") {
    throw new Error("home requires init");
  }

  const parsed = parseHomeInitCommand(argv);
  const homePath = resolveNexusHome(parsed.homePath);
  const configPath = nexusHomeConfigPath(homePath);
  if (fs.existsSync(configPath)) {
    throw new Error(`DevNexus home already exists: ${configPath}`);
  }

  const config = createDefaultNexusHomeConfigBase(homePath, {
    ...(parsed.projectsRoot !== undefined ? { projectsRoot: parsed.projectsRoot } : {}),
    ...(parsed.workspacesRoot !== undefined ? { workspacesRoot: parsed.workspacesRoot } : {}),
  });
  const savedPath = saveNexusHomeConfigFile(
    homePath,
    config,
    validateNexusHomeConfigBase,
  );
  printHomeInitResult(
    { homePath, configPath: savedPath, config },
    parsed,
    dependencies.stdout ?? process.stdout,
  );
  return 0;
}

async function handleProjectCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseProjectCreateCommand(argv);
    const result = createNexusProject({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      name: parsed.name,
      ...(parsed.root !== undefined ? { root: parsed.root } : {}),
      ...(parsed.from !== undefined ? { from: parsed.from } : {}),
      ...(parsed.gitInit !== undefined ? { gitInit: parsed.gitInit } : {}),
      ...(parsed.trackerProjectId !== undefined
        ? { vibeKanbanProjectId: parsed.trackerProjectId }
        : {}),
      ...(dependencies.projectGitRunner ? { gitRunner: dependencies.projectGitRunner } : {}),
    });
    printProjectCreateResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "init") {
    if (argvRequestsHelp(argv)) {
      writeLine(dependencies.stdout ?? process.stdout, projectSetupUsage());
      return 0;
    }

    const parsed = parseProjectSetupCommand(argv);
    const answers = await loadNexusProjectSetupAnswers({
      ...(parsed.answersPath ? { answersPath: parsed.answersPath } : {}),
      ...(parsed.projectRoot ? { projectRoot: parsed.projectRoot } : {}),
      ...(parsed.homePath ? { homePath: resolvedCommandHomePath(parsed.homePath) } : {}),
    });
    if (!answers) {
      printProjectSetupMissingAnswers(parsed, dependencies.stdout ?? process.stdout);
      return parsed.json ? 2 : Promise.reject(new Error(renderNexusProjectSetupRequiredAnswers()));
    }

    const proposal = previewNexusProjectSetup(answers);
    if (parsed.dryRun) {
      printProjectSetupPreviewResult(proposal, parsed, dependencies.stdout ?? process.stdout);
      return proposal.status === "ready" ? 0 : 2;
    }

    assertCliMutationAllowed(dependencies, {
      projectRoot: proposal.answers.project.root,
      command: "workspace init",
      mutationClass: "worktree_bootstrap",
      targetPath: proposal.answers.project.root,
    });
    const result = await applyNexusProjectSetup({
      answers,
      ...(dependencies.projectGitRunner
        ? { projectGitRunner: dependencies.projectGitRunner }
        : {}),
    });
    printProjectSetupApplyResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "component") {
    return handleProjectComponentCommand(argv, dependencies);
  }

  if (command === "import") {
    const parsed = parseProjectImportCommand(argv);
    const result = importNexusProject({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      root: parsed.root,
      ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.trackerProjectId !== undefined
        ? { vibeKanbanProjectId: parsed.trackerProjectId }
        : {}),
      ...(dependencies.projectGitRunner ? { gitRunner: dependencies.projectGitRunner } : {}),
    });
    printProjectImportResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "list") {
    const parsed = parseProjectListCommand(argv);
    const result = listNexusProjects({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
    });
    printProjectListResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "status") {
    const parsed = parseProjectStatusCommand(argv);
    const result = resolveProjectStatusForCli(parsed);
    printProjectStatusResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "hosting") {
    return await handleProjectHostingCommand(argv, dependencies);
  }

  if (command === "mcp") {
    return handleProjectMcpCommand(argv, dependencies);
  }

  if (command === "plugin") {
    return await handleProjectPluginCommand(argv, dependencies);
  }

  if (command === "agent-projection") {
    return handleProjectAgentProjectionCommand(argv, dependencies);
  }

  if (command === "tracker") {
    return handleProjectTrackerCommand(argv, dependencies);
  }

  throw new Error("workspace requires create, init, component, import, list, status, hosting, mcp, plugin, agent-projection, or tracker");
}

async function handleProjectComponentCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const subcommand = argv[2];
  if (subcommand !== "add") {
    throw new Error("workspace component requires add");
  }

  if (argvRequestsHelp(argv)) {
    writeLine(dependencies.stdout ?? process.stdout, projectComponentAddUsage());
    return 0;
  }

  const parsed = parseProjectComponentAddCommand(argv);
  const answers = readNexusProjectComponentAddAnswersFile(parsed.answersPath);
  const proposal = previewNexusProjectComponentAdd({
    projectRoot: parsed.projectRoot,
    answers,
  });
  if (parsed.dryRun) {
    printProjectComponentAddPreviewResult(proposal, parsed, dependencies.stdout ?? process.stdout);
    return proposal.status === "ready" ? 0 : 2;
  }

  assertCliMutationAllowed(dependencies, {
    projectRoot: parsed.projectRoot,
    command: "workspace component add",
    mutationClass: "project_state",
    targetPath: parsed.projectRoot,
  });
  const result = await applyNexusProjectComponentAdd({
    projectRoot: parsed.projectRoot,
    answers,
    ...(parsed.homePath ? { homePath: resolvedCommandHomePath(parsed.homePath) } : {}),
  });
  printProjectComponentAddApplyResult(result, parsed, dependencies.stdout ?? process.stdout);
  return 0;
}

async function handleProjectHostingCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const parsed = parseProjectHostingCommand(argv);
  const statusResult = await resolveProjectHostingStatusForCli(parsed, dependencies);
  if (parsed.command === "status") {
    printProjectHostingStatusResult(
      statusResult,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  const projectConfig = loadProjectConfig(statusResult.projectRoot);
  if (parsed.command === "apply") {
    assertCliMutationAllowed(dependencies, {
      projectRoot: statusResult.projectRoot,
      command: "workspace hosting apply",
      mutationClass: "local_remote_repair",
      targetPath: statusResult.projectRoot,
    });
    const authProfiles = hostingAuthProfilesForCli(
      projectConfig,
      parsed.homePath,
    );
    const apply = await applyNexusProjectHosting({
      hosting: projectConfig.hosting,
      status: statusResult.status,
      ...(authProfiles.length > 0 ? { authProfiles } : {}),
      ...(dependencies.hostingProvider
        ? { provider: dependencies.hostingProvider }
        : {}),
      runLocalRemoteCommand: hostingLocalRemoteCommandRunner(
        statusResult.projectRoot,
        dependencies.gitRunner,
      ),
      refreshStatus: () => resolveProjectHostingStatusForCli(parsed, dependencies)
        .then((result) => result.status),
    });
    printProjectHostingApplyResult(
      {
        ...statusResult,
        apply,
      },
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  const plan = planNexusProjectHosting({
    hosting: projectConfig.hosting,
    status: statusResult.status,
  });
  printProjectHostingPlanResult(
    {
      ...statusResult,
      plan,
    },
    parsed,
    dependencies.stdout ?? process.stdout,
  );
  return 0;
}

async function handleProjectMcpCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command === "budget") {
    const parsed = parseProjectMcpBudgetCommand(argv);
    const report = buildNexusMcpContextBudgetReport({
      projectRoot: parsed.projectRoot,
      agents: parsed.agents,
      topLimit: parsed.topLimit,
    });
    printProjectMcpBudgetResult(
      report,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }
  if (command !== "refresh") {
    throw new Error("workspace mcp requires refresh or budget");
  }

  const parsed = parseProjectMcpRefreshCommand(argv);
  const projectRoot = path.resolve(parsed.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const selectedTargets = selectNexusProjectMcpAgentTargets(
    projectConfig,
    parsed.agents,
  );
  const gatewayTargets = nexusMcpGatewayAgentTargets({
    projectConfig,
    selectedTargets,
  });
  if (parsed.dryRun) {
    const agentTargets = resolveNexusProjectAgentMcpTargets({
      projectRoot,
      mcpConfig: projectConfig.mcp,
      agentTargets: [...selectedTargets, ...gatewayTargets],
    });
    const result: ProjectMcpRefreshDryRunResult = {
      agentTargets,
      capabilityGaps: [],
      gitExcludePath: null,
      gitExcludeEntries: [],
      exposurePlan: buildProjectMcpRefreshExposurePlan({
        projectConfig,
        selectedTargets,
        materializedTargets: agentTargets,
      }),
    };
    printProjectMcpRefreshResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  assertCliMutationAllowed(dependencies, {
    projectRoot,
    command: "workspace mcp refresh",
    mutationClass: "skill_mcp_projection",
  });
  const result = materializeNexusProjectAgentMcpConfig({
    projectRoot,
    mcpConfig: projectConfig.mcp,
    agentTargets: [...selectedTargets, ...gatewayTargets],
  });
  printProjectMcpRefreshResult(result, parsed, dependencies.stdout ?? process.stdout);
  return 0;
}

async function handleProjectPluginCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command !== "refresh") {
    throw new Error("workspace plugin requires refresh");
  }

  const parsed = parseProjectPluginRefreshCommand(argv);
  const projectRoot = path.resolve(parsed.projectRoot);
  assertCliMutationAllowed(dependencies, {
    projectRoot,
    command: "workspace plugin refresh",
    mutationClass: "skill_mcp_projection",
  });
  const result = await refreshNexusProjectPlugin({
    projectRoot,
    from: parsed.from,
    ...(parsed.exportName ? { exportName: parsed.exportName } : {}),
    ...(parsed.skillsExportName
      ? { skillsExportName: parsed.skillsExportName }
      : {}),
    targetAgents: parsed.agents,
    targetComponents: parsed.components,
    dryRun: parsed.dryRun === true,
  });
  printProjectPluginRefreshResult(
    result,
    parsed,
    dependencies.stdout ?? process.stdout,
  );
  return 0;
}

async function handleProjectAgentProjectionCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command !== "cleanup") {
    throw new Error("workspace agent-projection requires cleanup");
  }

  const parsed = parseProjectAgentProjectionCleanupCommand(argv);
  const projectRoot = path.resolve(parsed.projectRoot);
  if (parsed.apply) {
    assertCliMutationAllowed(dependencies, {
      projectRoot,
      command: "workspace agent-projection cleanup",
      mutationClass: "cleanup_execution",
      targetPath: projectRoot,
    });
    const result = applyNexusAgentProjectionCleanup({ projectRoot });
    printProjectAgentProjectionCleanupApplyResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return result.status === "completed" ? 0 : 2;
  }

  const plan = planNexusAgentProjectionCleanup({ projectRoot });
  printProjectAgentProjectionCleanupPlanResult(
    plan,
    parsed,
    dependencies.stdout ?? process.stdout,
  );
  return plan.status === "ready" ? 0 : 2;
}

async function handleProjectTrackerCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command === "configure") {
    const parsed = parseProjectTrackerConfigureCommand(argv);
    const result = configureNexusProjectTracker({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      project: parsed.project,
      provider: parsed.provider,
      ...(parsed.host !== undefined ? { host: parsed.host } : {}),
      ...(parsed.repositoryOwner !== undefined
        ? { repositoryOwner: parsed.repositoryOwner }
        : {}),
      ...(parsed.repositoryName !== undefined
        ? { repositoryName: parsed.repositoryName }
        : {}),
      ...(parsed.repositoryId !== undefined ? { repositoryId: parsed.repositoryId } : {}),
      ...(parsed.projectKey !== undefined ? { projectKey: parsed.projectKey } : {}),
      ...(parsed.issueType !== undefined ? { issueType: parsed.issueType } : {}),
      ...(parsed.storePath !== undefined ? { storePath: parsed.storePath } : {}),
    });
    printProjectTrackerConfigureResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "link") {
    const parsed = parseProjectTrackerLinkCommand(argv);
    const result = linkNexusProjectTracker({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      project: parsed.project,
      trackerProjectId: parsed.trackerProjectId,
    });
    printProjectTrackerLinkResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("workspace tracker requires configure or link");
}

async function handleSetupCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  const stdout = dependencies.stdout ?? process.stdout;
  if (command === "list") {
    const parsed = parseSetupListCommand(argv);
    printSetupFlowListResult(listNexusSetupFlows(), parsed, stdout);
    return 0;
  }

  if (command === "plan") {
    const parsed = parseSetupPlanCommand(argv);
    const plan = buildNexusSetupPlan({
      projectRoot: parsed.projectRoot,
      flowId: parsed.flowId,
      platform: parsed.platform,
    });
    printSetupPlanResult(plan, parsed, stdout);
    return 0;
  }

  if (command === "check") {
    const parsed = parseSetupCheckCommand(argv);
    const check = buildNexusSetupCheck({
      projectRoot: parsed.projectRoot,
      flowId: parsed.flowId,
      platform: parsed.platform,
    });
    printSetupCheckResult(check, parsed, stdout);
    return 0;
  }

  if (command === "readiness") {
    const parsed = parseSetupReadinessCommand(argv);
    const report = buildNexusProjectSetupReadinessReport({
      projectRoot: parsed.projectRoot,
      platform: parsed.platform,
    });
    printSetupReadinessResult(report, parsed, stdout);
    return report.verdict === "blocked" ? 2 : 0;
  }

  if (command === "record") {
    const parsed = parseSetupRecordCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "setup record",
      mutationClass: "project_state",
    });
    const result = recordNexusSetupStep({
      projectRoot: parsed.projectRoot,
      flowId: parsed.flowId,
      stepId: parsed.stepId,
      status: parsed.status,
      note: parsed.note,
      now: dependencies.now,
    });
    printSetupRecordResult(result, parsed, stdout);
    return 0;
  }

  throw new Error("setup requires list, plan, check, readiness, or record");
}

async function handleCoordinationCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "status") {
    const parsed = parseCoordinationStatusCommand(argv);
    const status = await getNexusCoordinationStatus({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      trackerId: parsed.trackerId,
      trackerRole: parsed.trackerRole,
      currentPath: parsed.currentPath,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printCoordinationStatusResult(
      status,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "handoff") {
    const parsed = parseCoordinationHandoffCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "coordination handoff",
      mutationClass: "coordination_record",
      targetPath: parsed.currentPath,
      componentId: parsed.componentId,
    });
    const result = await createNexusCoordinationHandoff({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      trackerId: parsed.trackerId,
      trackerRole: parsed.trackerRole,
      status: parsed.status,
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      changedAreas: parsed.changedAreas,
      decisions: parsed.decisions,
      verificationSummary: parsed.verificationSummary,
      integrationPreference: parsed.integrationPreference,
      note: parsed.note,
      currentPath: parsed.currentPath,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printCoordinationHandoffResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "integrate") {
    const parsed = parseCoordinationIntegrateCommand(argv);
    if (parsed.fetch) {
      assertCliMutationAllowed(dependencies, {
        projectRoot: path.resolve(parsed.projectRoot),
        command: "coordination integrate --fetch",
        mutationClass: "publication_integration",
        targetPath: parsed.currentPath ?? process.cwd(),
        componentId: parsed.componentId,
      });
    }
    try {
      const plan = await getNexusCoordinationIntegrationPlan({
        projectRoot: parsed.projectRoot,
        componentId: parsed.componentId,
        workItemId: parsed.workItemId,
        trackerId: parsed.trackerId,
        trackerRole: parsed.trackerRole,
        targetBranch: parsed.targetBranch,
        fetch: parsed.fetch,
        currentPath: parsed.currentPath,
        gitRunner: dependencies.gitRunner,
        now: dependencies.now,
      });
      printCoordinationIntegrationPlan(
        plan,
        parsed,
        dependencies.stdout ?? process.stdout,
      );
      return 0;
    } catch (error) {
      printCoordinationIntegrationError(
        error,
        parsed,
        dependencies.stdout ?? process.stdout,
        dependencies.stderr ?? process.stderr,
      );
      return 1;
    }
  }

  if (command === "cleanup-plan") {
    const parsed = parseCoordinationCleanupPlanCommand(argv);
    const plan = buildNexusCleanupPlan({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      includeProjectMeta: parsed.includeProjectMeta,
      targetBranch: parsed.targetBranch,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printCoordinationCleanupPlan(
      plan,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "request") {
    const parsed = parseCoordinationRequestCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "coordination request",
      mutationClass: "coordination_record",
      targetPath: parsed.currentPath,
      componentId: parsed.componentId,
    });
    const result = await createNexusCoordinationRequest({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      trackerId: parsed.trackerId,
      trackerRole: parsed.trackerRole,
      intent: parsed.intent,
      question: parsed.question,
      note: parsed.note,
      target: parsed.target,
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      responseStatus: parsed.responseStatus,
      responseSummary: parsed.responseSummary,
      responder: parsed.responder,
      requestedChanges: parsed.requestedChanges,
      currentPath: parsed.currentPath,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printCoordinationRequestResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("coordination requires status, handoff, integrate, cleanup-plan, or request");
}

async function handleWorktreeCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "prepare") {
    const parsed = parseWorktreePrepareCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "worktree prepare",
      mutationClass: "worktree_bootstrap",
      componentId: parsed.componentId,
    });
    const resolvedWorkItem = await resolveWorktreePrepareWorkItem(
      parsed,
      dependencies,
    );
    const result = prepareNexusManualWorktree({
      projectRoot: parsed.projectRoot,
      componentId: resolvedWorkItem.componentId ?? parsed.componentId,
      projectMeta: parsed.projectMeta,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      baseRef: parsed.baseRef,
      initiativeId: parsed.initiativeId,
      initiativeSlice: parsed.initiativeSlice,
      initiativeParentBranch: parsed.initiativeParentBranch,
      initiativeStackPosition: parsed.initiativeStackPosition,
      branchIntent: parsed.branchIntent,
      topic: parsed.topic,
      workItemId: resolvedWorkItem.itemId ?? parsed.workItemId,
      workItemTitle:
        parsed.workItemTitle ?? resolvedWorkItem.workItem?.title ?? null,
      workItemDescription: resolvedWorkItem.workItem?.description ?? null,
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      workerAgentProvider: parsed.workerAgentProvider,
      writeScope: parsed.writeScope,
      leaseNotes: parsed.leaseNotes,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printWorktreePrepareResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("worktree requires prepare");
}

async function handleQuickFixCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  if (argv[1] === "plan" || argv[1] === "start" || argv[1] === "finish") {
    const parsed = parseQuickFixPlanCommand(argv);
    const plan = buildNexusQuickFixPlan({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      workItemId: parsed.workItemId,
      topic: parsed.topic,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      writeScope: parsed.writeScope,
      verificationCommands: parsed.verificationCommands,
    });
    if (parsed.command === "start") {
      assertCliMutationAllowed(dependencies, {
        projectRoot: path.resolve(parsed.projectRoot),
        command: "quick-fix start",
        mutationClass: "worktree_bootstrap",
        componentId: parsed.componentId,
      });
      const prepared = prepareNexusManualWorktree({
        projectRoot: parsed.projectRoot,
        componentId: parsed.componentId,
        workItemId: parsed.workItemId,
        topic: plan.branch.topic,
        branchName: plan.branch.name,
        worktreeName: plan.branch.worktreeName,
        writeScope: parsed.writeScope,
        leaseNotes: [`Quick-fix work for ${plan.issue.repository}#${plan.issue.number}.`],
        gitRunner: dependencies.gitRunner,
        now: dependencies.now,
      });
      printQuickFixStart(
        plan,
        prepared,
        parsed,
        dependencies.stdout ?? process.stdout,
      );
      return 0;
    }
    if (parsed.command === "finish") {
      printQuickFixFinish(plan, parsed, dependencies.stdout ?? process.stdout);
      return 0;
    }

    printQuickFixPlan(plan, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  throw new Error("quick-fix requires plan, start, or finish");
}

async function resolveWorktreePrepareWorkItem(
  parsed: ParsedWorktreePrepareCommand,
  dependencies: DevNexusCliDependencies,
): Promise<{
  componentId?: string;
  itemId?: string;
  workItem?: WorkItem | null;
}> {
  return resolveNexusManualWorktreeWorkItem({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectMeta: parsed.projectMeta,
    workItemId: parsed.workItemId,
    workItemTitle: parsed.workItemTitle,
    topic: parsed.topic,
    now: dependencies.now,
  });
}

async function handleWorkItemCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseWorkItemCreateCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item create",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const authorityBlock = cliWorkItemAuthorityBlock(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
      workItemPatchAuthorityActions(
        {
          title: parsed.title,
          status: parsed.status,
          labels: parsed.labels.length > 0 ? parsed.labels : undefined,
          assignees:
            parsed.assignees.length > 0 ? parsed.assignees : undefined,
          milestone: parsed.milestone,
        },
        cliWorkItemTrackerProvider(
          parsed.projectRoot,
          parsed.componentId,
          parsed.trackerId,
        ),
      ),
    );
    if (authorityBlock) {
      return printCliAuthorityBlock(authorityBlock, parsed, dependencies);
    }
    const item = await workItemService(parsed.projectRoot, dependencies)
      .createWorkItem({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        trackerId: parsed.trackerId,
        title: parsed.title,
        description: parsed.description,
        status: parsed.status,
        labels: parsed.labels,
        assignees: parsed.assignees,
        milestone: parsed.milestone,
      });
    printWorkItemCreateResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "discovery-status") {
    const parsed = parseWorkItemDiscoveryStatusCommand(argv);
    const result = getNexusWorkItemDiscoveryStatus({
      projectRoot: parsed.projectRoot,
    });
    printWorkItemDiscoveryStatusResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "claim-next") {
    const parsed = parseWorkItemClaimNextCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item claim-next",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const provider = cliWorkItemTrackerProvider(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
    );
    const authorityBlock = cliWorkItemAuthorityBlock(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
      [
        ...workItemPatchAuthorityActions(
          {
            status: "in_progress",
            description: "DevNexus optimistic claim metadata",
          },
          provider,
        ),
        workItemCommentAuthorityAction(provider),
      ],
    );
    if (authorityBlock) {
      return printCliAuthorityBlock(authorityBlock, parsed, dependencies);
    }
    const claim = await claimNextWorkItem(parsed, dependencies);
    printWorkItemClaimNextResult(
      claim,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "list") {
    const parsed = parseWorkItemListCommand(argv);
    const items = await workItemService(parsed.projectRoot, dependencies)
      .listWorkItems({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: parsed.componentId,
        trackerId: parsed.trackerId,
        status: statusQuery(parsed.statuses),
        labels: parsed.labels,
        assignees: parsed.assignees,
        search: parsed.search,
        limit: parsed.limit,
      });
    printWorkItemListResult(items, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "get") {
    const parsed = parseWorkItemGetCommand(argv);
    const reference = resolveCliWorkItemReference(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
      parsed.itemId,
    );
    const item = await workItemService(parsed.projectRoot, dependencies)
      .getWorkItem({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: reference.componentId,
        trackerId: reference.trackerId,
        id: reference.itemId,
      });
    printWorkItemGetResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "update") {
    const parsed = parseWorkItemUpdateCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item update",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const reference = resolveCliWorkItemReference(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
      parsed.itemId,
    );
    const authorityBlock = cliWorkItemAuthorityBlock(
      parsed.projectRoot,
      reference.componentId,
      reference.trackerId,
      workItemPatchAuthorityActions(
        parsed.patch,
        cliWorkItemTrackerProvider(
          parsed.projectRoot,
          reference.componentId,
          reference.trackerId,
        ),
      ),
    );
    if (authorityBlock) {
      return printCliAuthorityBlock(authorityBlock, parsed, dependencies);
    }
    const item = await workItemService(parsed.projectRoot, dependencies)
      .updateWorkItem({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: reference.componentId,
        trackerId: reference.trackerId,
        ref: { id: reference.itemId },
        patch: parsed.patch,
      });
    printWorkItemUpdateResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "comment") {
    const parsed = parseWorkItemCommentCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item comment",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const reference = resolveCliWorkItemReference(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
      parsed.itemId,
    );
    const authorityBlock = cliWorkItemAuthorityBlock(
      parsed.projectRoot,
      reference.componentId,
      reference.trackerId,
      [
        workItemCommentAuthorityAction(
          cliWorkItemTrackerProvider(
            parsed.projectRoot,
            reference.componentId,
            reference.trackerId,
          ),
        ),
      ],
    );
    if (authorityBlock) {
      return printCliAuthorityBlock(authorityBlock, parsed, dependencies);
    }
    const comment = await workItemService(parsed.projectRoot, dependencies)
      .addComment({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: reference.componentId,
        trackerId: reference.trackerId,
        ref: { id: reference.itemId },
        body: parsed.body,
      });
    printWorkItemCommentResult(
      comment,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "set-status") {
    const parsed = parseWorkItemSetStatusCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item set-status",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const reference = resolveCliWorkItemReference(
      parsed.projectRoot,
      parsed.componentId,
      parsed.trackerId,
      parsed.itemId,
    );
    const authorityBlock = cliWorkItemAuthorityBlock(
      parsed.projectRoot,
      reference.componentId,
      reference.trackerId,
      [
        workItemStatusAuthorityAction(
          cliWorkItemTrackerProvider(
            parsed.projectRoot,
            reference.componentId,
            reference.trackerId,
          ),
        ),
      ],
    );
    if (authorityBlock) {
      return printCliAuthorityBlock(authorityBlock, parsed, dependencies);
    }
    const item = await workItemService(parsed.projectRoot, dependencies)
      .setStatus({
        projectRoot: path.resolve(parsed.projectRoot),
        componentId: reference.componentId,
        trackerId: reference.trackerId,
        ref: { id: reference.itemId },
        status: parsed.status,
      });
    printWorkItemUpdateResult(item, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "link") {
    const parsed = parseWorkItemLinkCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item link",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const logical = resolveCliLogicalWorkItemId(
      parsed.projectRoot,
      parsed.componentId,
      parsed.logicalItemId,
    );
    const result = await workItemTrackerLinkService(
      parsed.projectRoot,
      dependencies,
    ).linkReference({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: logical.componentId,
      logicalItemId: logical.logicalItemId,
      trackerId: parsed.trackerId,
      provider: parsed.provider,
      host: parsed.host,
      repositoryId: parsed.repositoryId,
      repositoryOwner: parsed.repositoryOwner,
      repositoryName: parsed.repositoryName,
      projectId: parsed.projectId,
      boardId: parsed.boardId,
      itemId: parsed.itemId,
      itemNumber: parsed.itemNumber,
      itemKey: parsed.itemKey,
      nodeId: parsed.nodeId,
      webUrl: parsed.webUrl,
      observedAt: parsed.observedAt,
    });
    printWorkItemLinkResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "show-links") {
    const parsed = parseWorkItemShowLinksCommand(argv);
    const logical = resolveCliLogicalWorkItemId(
      parsed.projectRoot,
      parsed.componentId,
      parsed.logicalItemId,
    );
    const result = await workItemTrackerLinkService(
      parsed.projectRoot,
      dependencies,
    ).showLinks({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: logical.componentId,
      logicalItemId: logical.logicalItemId,
    });
    printWorkItemShowLinksResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "unlink") {
    const parsed = parseWorkItemUnlinkCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item unlink",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const logical = resolveCliLogicalWorkItemId(
      parsed.projectRoot,
      parsed.componentId,
      parsed.logicalItemId,
    );
    const result = await workItemTrackerLinkService(
      parsed.projectRoot,
      dependencies,
    ).unlinkReference({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: logical.componentId,
      logicalItemId: logical.logicalItemId,
      trackerId: parsed.trackerId,
      itemId: parsed.itemId,
      reason: parsed.reason,
    });
    printWorkItemUnlinkResult(result, parsed, dependencies.stdout ?? process.stdout);
    return 0;
  }

  if (command === "sync-plan") {
    const parsed = parseWorkItemSyncPlanCommand(argv);
    const plan = await createWorkItemSyncPlan({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: parsed.componentId,
      policy: workItemSyncPolicyFromParsed(parsed, "dry_run"),
      resolveProject: (selector) =>
        resolveDirectProject(parsed.projectRoot, selector.componentId),
      now: dependencies.now,
    });
    printWorkItemSyncPlanResult(
      plan,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "import-plan") {
    const parsed = parseWorkItemImportPlanCommand(argv);
    const plan = await createWorkItemImportPlan({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: parsed.componentId,
      policy: workItemImportPolicyFromParsed(parsed, "dry_run"),
      resolveProject: (selector) =>
        resolveDirectProject(parsed.projectRoot, selector.componentId),
      now: dependencies.now,
    });
    printWorkItemImportPlanResult(
      plan,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "import-execute") {
    const parsed = parseWorkItemImportPlanCommand(argv);
    if (!parsed.direction) {
      throw new Error("work-item import-execute requires --direction external_to_local");
    }
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item import-execute",
      mutationClass: "local_tracker",
      componentId: parsed.componentId,
    });
    const run = await executeWorkItemImport({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: parsed.componentId,
      policy: workItemImportPolicyFromParsed(parsed, "execute"),
      authority: workItemImportExecutionAuthorityFromProject(
        parsed.projectRoot,
        parsed.componentId,
      ),
      resolveProject: (selector) =>
        resolveDirectProject(parsed.projectRoot, selector.componentId),
      now: dependencies.now,
    });
    printWorkItemImportExecuteResult(
      run,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "sync-execute") {
    const parsed = parseWorkItemSyncPlanCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "work-item sync-execute",
      mutationClass: "provider_sync",
      componentId: parsed.componentId,
    });
    const run = await executeWorkItemSync({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: parsed.componentId,
      policy: workItemSyncPolicyFromParsed(parsed, "execute"),
      resolveProject: (selector) =>
        resolveDirectProject(parsed.projectRoot, selector.componentId),
      now: dependencies.now,
    });
    printWorkItemSyncExecuteResult(
      run,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error(
    "work-item requires create, discovery-status, claim-next, list, get, update, comment, set-status, link, show-links, unlink, import-plan, import-execute, sync-plan, or sync-execute",
  );
}

async function handleAutomationCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  if (argv[1] === "status") {
    const parsed = parseAutomationStatusCommand(argv);
    const result = await getNexusAutomationStatus({
      projectRoot: parsed.projectRoot,
      ...(parsed.homePath !== undefined
        ? { homePath: resolvedCommandHomePath(parsed.homePath) }
        : {}),
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printAutomationStatusResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "eligible-work") {
    const parsed = parseAutomationEligibleWorkCommand(argv);
    const result = await getNexusEligibleWorkSummary({
      projectRoot: parsed.projectRoot,
      eligibleWorkMode: parsed.mode,
      now: dependencies.now,
    });
    printAutomationEligibleWorkResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "agent-profiles") {
    const parsed = parseAutomationAgentProfilesCommand(argv);
    const result = getNexusAutomationAgentProfileSummary(parsed.projectRoot);
    printAutomationAgentProfilesResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "app-server-probe") {
    const parsed = parseAutomationAppServerProbeCommand(argv);
    const result = await probeCodexAppServerInitialize({
      projectRoot: parsed.projectRoot,
      profileId: parsed.profileId,
    });
    printAutomationAppServerProbeResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "enqueue") {
    const parsed = parseAutomationEnqueueCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "automation enqueue",
      mutationClass: "local_tracker",
    });
    const result = await enqueueNexusAutomationWorkItem({
      projectRoot: parsed.projectRoot,
      title: parsed.title,
      description: parsed.description,
      status: parsed.status,
      labels: parsed.labels,
      assignees: parsed.assignees,
      milestone: parsed.milestone,
      now: dependencies.now,
    });
    printAutomationEnqueueResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "heartbeat") {
    const parsed = parseAutomationHeartbeatPrepareCommand(argv);
    const result = prepareNexusAutomationHeartbeat({
      projectRoot: parsed.projectRoot,
      name: parsed.name,
      intervalMinutes: parsed.intervalMinutes,
      status: parsed.status,
    });
    printAutomationHeartbeatPrepareResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "target-cycle") {
    return handleAutomationTargetCycleCommand(argv, dependencies);
  }

  if (argv[1] === "target-report") {
    const parsed = parseAutomationTargetReportCommand(argv);
    const result = buildNexusAutomationTargetReport({
      projectRoot: parsed.projectRoot,
      now: dependencies.now?.(),
    });
    printAutomationTargetReportResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (argv[1] === "current-agent") {
    return handleAutomationCurrentAgentCommand(argv, dependencies);
  }

  if (argv[1] === "schedule") {
    const parsed = parseAutomationScheduleCommand(argv);
    const commandOptions = resolveAutomationCommandCliOptions(
      "schedule",
      parsed,
    );
    const stdout = dependencies.stdout ?? process.stdout;
    const result = await runNexusAutomationScheduler({
      projectRoot: parsed.projectRoot,
      owner: parsed.owner,
      baseRef: parsed.baseRef,
      intervalMs: parsed.intervalMs,
      maxTicks: parsed.maxTicks,
      maxRuns: parsed.maxRuns,
      runIdPrefix: parsed.runIdPrefix,
      gitRunner: dependencies.gitRunner,
      mcpRuntimeProcesses: dependencies.mcpRuntimeProcesses,
      now: dependencies.now,
      onTick: parsed.json
        ? undefined
        : (tick) => printAutomationScheduleTick(tick, stdout),
      ...(commandOptions.mode === "agent_launch"
        ? {
            agentLauncher: createNexusAutomationAgentCommandLauncher({
              command: commandOptions.command,
              commandRunner: dependencies.commandRunner,
              timeoutMs: commandOptions.timeoutMs,
            }),
          }
        : {
            executor: createNexusAutomationCommandExecutor({
              command: commandOptions.command,
              commandRunner: dependencies.commandRunner,
              gitRunner: dependencies.gitRunner,
              runFullVerification: commandOptions.runFullVerification,
              timeoutMs: commandOptions.timeoutMs,
            }),
          }),
    });
    printAutomationScheduleResult(result, parsed, stdout);
    return 0;
  }

  if (argv[1] === "coordinator-loop") {
    const parsed = parseAutomationCoordinatorLoopCommand(argv);
    const stdout = dependencies.stdout ?? process.stdout;
    const stderr = dependencies.stderr ?? process.stderr;
    if (parsed.adoptCurrent) {
      if (parsed.command) {
        throw new Error(
          "automation coordinator-loop --adopt-current does not accept --command",
        );
      }
      const result = await adoptNexusAutomationCurrentAgentFromCoordinatorLoop({
        projectRoot: parsed.projectRoot,
        owner: parsed.owner,
        runId: parsed.runId,
        intervalMs: parsed.intervalMs,
        runIdPrefix: parsed.runIdPrefix,
        gitRunner: dependencies.gitRunner,
        now: dependencies.now,
      });
      printAutomationCurrentAgentCoordinatorLoopAdoptionResult(
        result,
        parsed,
        stdout,
      );
      return 0;
    }
    const result = await runNexusAutomationCoordinatorLoop({
      projectRoot: parsed.projectRoot,
      owner: parsed.owner,
      intervalMs: parsed.intervalMs,
      maxTicks: parsed.maxTicks,
      maxRuns: parsed.maxRuns,
      runIdPrefix: parsed.runIdPrefix,
      gitRunner: dependencies.gitRunner,
      mcpRuntimeProcesses: dependencies.mcpRuntimeProcesses,
      now: dependencies.now,
      onTick: parsed.json
        ? undefined
        : (tick) => printAutomationCoordinatorLoopTick(tick, stdout),
      onProgress: parsed.progressJsonl
        ? (event) => printAutomationCoordinatorLoopProgressEvent(event, stderr)
        : undefined,
      launcher: createAutomationCoordinatorLoopCliLauncher(parsed, dependencies),
    });
    printAutomationCoordinatorLoopResult(result, parsed, stdout);
    return 0;
  }

  if (argv[1] !== "run-once") {
    throw new Error(
      "automation requires status, eligible-work, agent-profiles, app-server-probe, enqueue, heartbeat, target-cycle, target-report, run-once, schedule, coordinator-loop, or current-agent",
    );
  }

  const parsed = parseAutomationRunOnceCommand(argv);
  const commandOptions = resolveAutomationCommandCliOptions("run-once", parsed);
  if (commandOptions.mode === "agent_launch") {
    const result = await runNexusAutomationAgentLaunchOnce({
      projectRoot: parsed.projectRoot,
      runId: parsed.runId,
      owner: parsed.owner,
      gitRunner: dependencies.gitRunner,
      mcpRuntimeProcesses: dependencies.mcpRuntimeProcesses,
      now: dependencies.now,
      launcher: createNexusAutomationAgentCommandLauncher({
        command: commandOptions.command,
        commandRunner: dependencies.commandRunner,
        timeoutMs: commandOptions.timeoutMs,
      }),
    });
    printAutomationAgentLaunchResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
  } else {
    const result = await runNexusAutomationOnce({
      projectRoot: parsed.projectRoot,
      runId: parsed.runId,
      owner: parsed.owner,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      baseRef: parsed.baseRef,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
      executor: createNexusAutomationCommandExecutor({
        command: commandOptions.command,
        commandRunner: dependencies.commandRunner,
        gitRunner: dependencies.gitRunner,
        runFullVerification: commandOptions.runFullVerification,
        timeoutMs: commandOptions.timeoutMs,
      }),
    });
    printAutomationRunOnceResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
  }
  return 0;
}

async function handleAutomationTargetCycleCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  if (command === "list") {
    const parsed = parseAutomationTargetCycleListCommand(argv);
    const { projectConfig, automationConfig } = automationConfigForProjectRoot(
      parsed.projectRoot,
    );
    const ledger = readNexusAutomationTargetCycleLedger(
      path.resolve(parsed.projectRoot),
      automationConfig,
    );
    printAutomationTargetCycleListResult(
      {
        projectConfig,
        ledger,
      },
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  if (command === "record") {
    const parsed = parseAutomationTargetCycleRecordCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "automation target-cycle record",
      mutationClass: "target_state",
    });
    const { projectConfig, automationConfig } = automationConfigForProjectRoot(
      parsed.projectRoot,
    );
    const ledger = appendNexusAutomationTargetCycleRecord({
      projectRoot: path.resolve(parsed.projectRoot),
      config: automationConfig,
      now: dependencies.now?.(),
      record: {
        ...(parsed.cycleId ? { id: parsed.cycleId } : {}),
        projectId: projectConfig.id,
        targetId: automationConfig.target.id,
        objective: automationConfig.target.objective,
        ...(parsed.runId ? { runId: parsed.runId } : {}),
        status: parsed.status,
        summary: parsed.summary ?? null,
        eligibleWorkItemCount: parsed.eligibleWorkItemCount ?? null,
        workItems: parsed.workItems,
        blockers: parsed.blockers,
        notes: parsed.notes,
      },
    });
    printAutomationTargetCycleRecordResult(
      {
        projectConfig,
        record: ledger.cycles.at(-1)!,
        ledger,
      },
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("automation target-cycle requires list or record");
}

async function handleAutomationCurrentAgentCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[2];
  const stdout = dependencies.stdout ?? process.stdout;
  if (command === "adopt") {
    const parsed = parseAutomationCurrentAgentAdoptCommand(argv);
    const result = await adoptNexusAutomationCurrentAgent({
      projectRoot: parsed.projectRoot,
      runId: parsed.runId,
      owner: parsed.owner,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printAutomationCurrentAgentAdoptionResult(result, parsed, stdout);
    return 0;
  }

  if (command === "record") {
    const parsed = parseAutomationCurrentAgentRecordCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "automation current-agent record",
      mutationClass: "target_state",
    });
    const result = recordNexusAutomationCurrentAgentAdoptionResult({
      projectRoot: parsed.projectRoot,
      runId: parsed.runId,
      result: parsed.result,
      now: dependencies.now,
    });
    printAutomationCurrentAgentRecordResult(result, parsed, stdout);
    return 0;
  }

  throw new Error("automation current-agent requires adopt or record");
}

function resolveAutomationCommandCliOptions(
  commandName: "run-once" | "schedule" | "coordinator-loop",
  parsed:
    | ParsedAutomationRunOnceCommand
    | ParsedAutomationScheduleCommand
    | ParsedAutomationCoordinatorLoopCommand,
): {
  mode: "run_once" | "agent_launch";
  command: string;
  runFullVerification: boolean;
  timeoutMs?: number;
} {
  const config = loadProjectConfig(path.resolve(parsed.projectRoot));
  const mode = config.automation?.mode ?? "run_once";
  const automationConfig = config.automation;
  const configuredCommand =
    mode === "agent_launch"
        ? automationConfig
          ? resolveNexusAutomationAgentCommand({
              automationConfig,
              overrideCommand: parsed.command,
              commandName,
              projectRoot: path.resolve(parsed.projectRoot),
            }).command
          : parsed.command
      : parsed.command ?? automationConfig?.executor.command;
  const configuredTimeoutMs =
    mode === "agent_launch"
      ? automationConfig?.agent.timeoutMs
      : automationConfig?.executor.timeoutMs;
  const command = configuredCommand ?? undefined;
  if (!command) {
    throw new Error(
      mode === "agent_launch"
        ? `automation ${commandName} requires --command or workspace config automation.agent.command`
        : `automation ${commandName} requires --command or workspace config automation.executor.command`,
    );
  }

  return {
    mode,
    command,
    runFullVerification:
      parsed.runFullVerification ??
      config.automation?.executor.runFullVerification ??
      false,
    ...(parsed.timeoutMs ?? configuredTimeoutMs
      ? { timeoutMs: parsed.timeoutMs ?? configuredTimeoutMs ?? undefined }
      : {}),
  };
}

function createAutomationCoordinatorLoopCliLauncher(
  parsed: ParsedAutomationCoordinatorLoopCommand,
  dependencies: DevNexusCliDependencies,
) {
  let launcher: ReturnType<typeof createNexusAutomationAgentCommandLauncher> | null =
    null;

  return (
    input: Parameters<ReturnType<typeof createNexusAutomationAgentCommandLauncher>>[0],
  ) => {
    if (!launcher) {
      const commandOptions = resolveAutomationCommandCliOptions(
        "coordinator-loop",
        parsed,
      );
      if (commandOptions.mode !== "agent_launch") {
        throw new Error(
          "automation coordinator-loop requires workspace config automation.mode agent_launch",
        );
      }
      launcher = createNexusAutomationAgentCommandLauncher({
        command: commandOptions.command,
        commandRunner: dependencies.commandRunner,
        timeoutMs: commandOptions.timeoutMs,
      });
    }

    return launcher(input);
  };
}

function workItemService(
  projectRoot: string,
  dependencies: DevNexusCliDependencies,
) {
  return createWorkItemService({
    resolveProject: (selector) =>
      resolveDirectProject(projectRoot, selector.componentId),
    now: dependencies.now,
  });
}

async function claimNextWorkItem(
  parsed: ParsedWorkItemClaimNextCommand,
  dependencies: DevNexusCliDependencies,
): Promise<NexusWorkItemClaimResult> {
  const projectRoot = path.resolve(parsed.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  return claimNexusEligibleWorkItem({
    projectRoot,
    projectConfig,
    components: resolveProjectComponents(projectRoot, projectConfig),
    automationConfig: projectConfig.automation ?? defaultNexusAutomationConfig,
    componentId: parsed.componentId,
    trackerId: parsed.trackerId,
    mode: parsed.mode,
    owner: {
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      ownerId: parsed.ownerId,
    },
    leaseDurationMs: parsed.leaseDurationMs,
    staleClaimPolicy: parsed.staleClaimPolicy,
    providerFactory: dependencies.workItemClaimProviderFactory,
    leaseTokenFactory: dependencies.workItemClaimLeaseTokenFactory,
    now: dependencies.now,
  });
}

function cliWorkItemAuthorityBlock(
  projectRoot: string,
  componentId: string | undefined,
  trackerId: string | undefined,
  actions: NexusAuthorityAction[],
): NexusAuthorityMutationBlock | null {
  for (const action of uniqueNexusAuthorityActions(actions)) {
    const authority = resolveCliWorkItemAuthority(
      projectRoot,
      componentId,
      trackerId,
      action,
    );
    if (!authority.allowed) {
      return nexusAuthorityMutationBlock(authority);
    }
  }

  return null;
}

function resolveCliWorkItemAuthority(
  projectRoot: string,
  componentId: string | undefined,
  trackerId: string | undefined,
  requestedAction: NexusAuthorityAction,
): NexusEffectiveAuthorityResolution {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = loadProjectConfig(resolvedProjectRoot);
  if (!config.authority) {
    return unconfiguredNexusAuthorityAllowedResolution(requestedAction);
  }
  const component = componentId
    ? resolveProjectComponents(resolvedProjectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(resolvedProjectRoot, config);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  const publication = resolveNexusPublicationPolicy(config, component);
  const authProfiles = hostingAuthProfilesForCli(config, undefined);
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: config.authority,
    componentId: component.id,
    publication,
    authProfiles,
    repository: component.remoteUrl,
  });

  return resolveNexusEffectiveAuthorityForCurrentActor({
    authority: config.authority,
    currentActor,
    authProfiles,
    project: config.id,
    component: component.id,
    provider: cliWorkItemAuthorityProvider(
      requestedAction,
      cliWorkItemTrackerProvider(projectRoot, component.id, trackerId),
    ),
    tracker: trackerId ?? component.defaultTrackerId,
    remote: publication.remote,
    repository: component.remoteUrl,
    targetBranch: publication.targetBranch,
    requestedAction,
    publication,
    safety: config.automation?.safety ?? null,
  });
}

function cliWorkItemAuthorityProvider(
  requestedAction: NexusAuthorityAction,
  trackerProvider: string,
): string | null {
  return requestedAction.startsWith("provider.") ? trackerProvider : null;
}

function cliWorkItemTrackerProvider(
  projectRoot: string,
  componentId: string | undefined,
  trackerId: string | undefined,
): string {
  const context = resolveDirectProject(projectRoot, componentId);
  const selectedTrackerId = trackerId ?? context.defaultTrackerId ?? null;
  const tracker = selectedTrackerId
    ? context.workTrackers?.find((candidate) => candidate.id === selectedTrackerId)
    : null;
  return tracker?.workTracking.provider ?? context.workTracking?.provider ?? "local";
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

function workItemTrackerLinkService(
  projectRoot: string,
  dependencies: DevNexusCliDependencies,
) {
  return createWorkItemTrackerLinkService({
    resolveProject: (selector) =>
      resolveDirectProject(projectRoot, selector.componentId),
    now: dependencies.now,
  });
}

function remoteExecutionCoordinationAttachmentRefs(
  parsed: ParsedRemoteExecutionRequestCreateCommand,
): NexusRemoteExecutionAttachmentRef[] {
  if (parsed.coordinationRecordIds.length === 0) {
    return [];
  }

  const resolvedProjectRoot = path.resolve(parsed.projectRoot);
  const config = loadProjectConfig(resolvedProjectRoot);
  const qualifiedWorkItem = parsed.workItemId
    ? componentQualifiedWorkItemId(resolvedProjectRoot, parsed.workItemId)
    : null;
  const componentId = parsed.componentId ?? qualifiedWorkItem?.componentId;
  const component = componentId
    ? resolveProjectComponents(resolvedProjectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(resolvedProjectRoot, config);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  const workItemId =
    qualifiedWorkItem?.itemId ??
    (parsed.workItemId && parsed.workItemId.trim().length > 0
      ? parsed.workItemId.trim()
      : null);

  return parsed.coordinationRecordIds.map((recordId) => ({
    kind: "coordination_record" as const,
    componentId: component.id,
    recordId,
    workItemId,
  }));
}

function resolveDirectProject(
  projectRoot: string,
  componentId?: string,
): ResolvedWorkItemProjectContext {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = loadProjectConfig(resolvedProjectRoot);
  const component = componentId
    ? resolveProjectComponents(resolvedProjectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(resolvedProjectRoot, config);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    homePath: config.home ?? "",
    projectRoot: resolvedProjectRoot,
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

function resolveCliWorkItemReference(
  projectRoot: string,
  componentId: string | undefined,
  trackerId: string | undefined,
  itemId: string,
): { componentId?: string; trackerId?: string; itemId: string } {
  const qualified = componentQualifiedWorkItemId(projectRoot, itemId);
  let resolvedComponentId = componentId;
  let resolvedItemId = itemId;
  if (qualified) {
    if (componentId && componentId !== qualified.componentId) {
      throw new Error(
        `Work item id component "${qualified.componentId}" conflicts with --component "${componentId}"`,
      );
    }
    resolvedComponentId = qualified.componentId;
    resolvedItemId = qualified.itemId;
  }

  const trackerQualified = trackerQualifiedWorkItemId(
    projectRoot,
    resolvedComponentId,
    resolvedItemId,
  );
  if (
    trackerId &&
    trackerQualified &&
    trackerId !== trackerQualified.trackerId
  ) {
    throw new Error(
      `Work item id tracker "${trackerQualified.trackerId}" conflicts with --tracker "${trackerId}"`,
    );
  }

  if (!trackerQualified) {
    return {
      ...(resolvedComponentId ? { componentId: resolvedComponentId } : {}),
      ...(trackerId ? { trackerId } : {}),
      itemId: resolvedItemId,
    };
  }

  return {
    ...(resolvedComponentId ? { componentId: resolvedComponentId } : {}),
    trackerId: trackerQualified.trackerId,
    itemId: trackerQualified.itemId,
  };
}

function resolveCliLogicalWorkItemId(
  projectRoot: string,
  componentId: string | undefined,
  logicalItemId: string,
): { componentId?: string; logicalItemId: string } {
  const qualified = componentQualifiedWorkItemId(projectRoot, logicalItemId);
  if (!qualified) {
    return {
      ...(componentId ? { componentId } : {}),
      logicalItemId,
    };
  }

  if (componentId && componentId !== qualified.componentId) {
    throw new Error(
      `Work item id component "${qualified.componentId}" conflicts with --component "${componentId}"`,
    );
  }

  return {
    componentId: qualified.componentId,
    logicalItemId: qualified.itemId,
  };
}

function componentQualifiedWorkItemId(
  projectRoot: string,
  itemId: string,
): { componentId: string; itemId: string } | null {
  const split = itemId.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/);
  if (!split) {
    return null;
  }

  const componentId = split[1]!;
  const qualifiedItemId = split[2]!.trim();
  if (!qualifiedItemId) {
    return null;
  }

  const resolvedProjectRoot = path.resolve(projectRoot);
  const componentIds = new Set(
    resolveProjectComponents(
      resolvedProjectRoot,
      loadProjectConfig(resolvedProjectRoot),
    ).map((component) => component.id),
  );
  if (!componentIds.has(componentId)) {
    return null;
  }

  return { componentId, itemId: qualifiedItemId };
}

function trackerQualifiedWorkItemId(
  projectRoot: string,
  componentId: string | undefined,
  itemId: string,
): { trackerId: string; itemId: string } | null {
  const split = itemId.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(.+)$/);
  if (!split) {
    return null;
  }

  const trackerId = split[1]!;
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = loadProjectConfig(resolvedProjectRoot);
  const component = componentId
    ? resolveProjectComponents(resolvedProjectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(resolvedProjectRoot, config);
  if (!component?.workTrackers.some((tracker) => tracker.id === trackerId)) {
    return null;
  }

  const qualifiedItemId = split[2]!.trim();
  if (!qualifiedItemId) {
    return null;
  }

  return { trackerId, itemId: qualifiedItemId };
}

function parseHomeInitCommand(argv: string[]): ParsedHomeInitCommand {
  const rest = argv.slice(2);
  const parsed: ParsedHomeInitCommand = {
    homePath: defaultNexusHomePath(),
  };
  let homePathProvided = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--projects-root":
        parsed.projectsRoot = next();
        break;
      case "--workspaces-root":
        parsed.workspacesRoot = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown home init option: ${arg}`);
        }
        if (homePathProvided) {
          throw new Error("home init accepts at most one home path");
        }
        homePathProvided = true;
        parsed.homePath = arg;
        break;
    }
  }

  return parsed;
}

function parseProjectCreateCommand(argv: string[]): ParsedProjectCreateCommand {
  const [, , name, ...rest] = argv;
  if (!name || name.startsWith("--")) {
    throw new Error("workspace create requires a name");
  }

  const parsed: ParsedProjectCreateCommand = { name };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--root":
        parsed.root = next();
        break;
      case "--from":
        parsed.from = next();
        break;
      case "--git-init":
        parsed.gitInit = true;
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace create option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectSetupCommand(argv: string[]): ParsedProjectSetupCommand {
  const rest = argv.slice(2);
  const parsed: ParsedProjectSetupCommand = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    if (!arg.startsWith("--") && !parsed.projectRoot) {
      parsed.projectRoot = arg;
      continue;
    }

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--answers":
        parsed.answersPath = next();
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace init option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectComponentAddCommand(argv: string[]): ParsedProjectComponentAddCommand {
  const rest = argv.slice(3);
  const parsed: Partial<ParsedProjectComponentAddCommand> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    if (!arg.startsWith("--") && !parsed.projectRoot) {
      parsed.projectRoot = arg;
      continue;
    }

    switch (arg) {
      case "--answers":
        parsed.answersPath = next();
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace component add option: ${arg}`);
    }
  }

  if (!parsed.projectRoot) {
    throw new Error("workspace component add requires <workspace-root>");
  }
  if (!parsed.answersPath) {
    throw new Error("workspace component add requires --answers <json-file>");
  }
  return parsed as ParsedProjectComponentAddCommand;
}

function parseProjectImportCommand(argv: string[]): ParsedProjectImportCommand {
  const [, , root, ...rest] = argv;
  if (!root || root.startsWith("--")) {
    throw new Error("workspace import requires a source root");
  }

  const parsed: ParsedProjectImportCommand = { root };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--project-root":
      case "--workspace-root":
        parsed.projectRoot = next();
        break;
      case "--name":
        parsed.name = next();
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace import option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectListCommand(argv: string[]): ParsedProjectListCommand {
  const rest = argv.slice(2);
  const parsed: ParsedProjectListCommand = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace list option: ${arg}`);
    }
  }

  return parsed;
}

function parseCliOutputDetail(value: string, option: string): CliOutputDetail {
  if (value === "summary" || value === "full") {
    return value;
  }
  throw new Error(`${option} must be summary or full`);
}

function parseProjectStatusCommand(argv: string[]): ParsedProjectStatusCommand {
  const [, , project, ...rest] = argv;
  if (!project || project.startsWith("--")) {
    throw new Error("workspace status requires a workspace id or root");
  }

  const parsed: ParsedProjectStatusCommand = { project };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--full":
        parsed.detail = "full";
        break;
      case "--detail":
        parsed.detail = parseCliOutputDetail(next(), arg);
        break;
      default:
        throw new Error(`Unknown workspace status option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectHostingCommand(argv: string[]): ParsedProjectHostingCommand {
  const [, , command, projectRoot, ...rest] = argv;
  if (command !== "status" && command !== "plan" && command !== "apply") {
    throw new Error("workspace hosting requires status, plan, or apply");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error(`workspace hosting ${command} requires a workspace root`);
  }

  const parsed: ParsedProjectHostingCommand = { command, projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace hosting ${command} option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectMcpRefreshCommand(
  argv: string[],
): ParsedProjectMcpRefreshCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("workspace mcp refresh requires a workspace root");
  }

  const parsed: ParsedProjectMcpRefreshCommand = {
    projectRoot,
    agents: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--agent":
        parsed.agents.push(next());
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace mcp refresh option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectMcpBudgetCommand(
  argv: string[],
): ParsedProjectMcpBudgetCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("workspace mcp budget requires a workspace root");
  }

  const parsed: ParsedProjectMcpBudgetCommand = {
    projectRoot,
    agents: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--agent":
        parsed.agents.push(next());
        break;
      case "--top":
        parsed.topLimit = parsePositiveInteger(next(), "--top");
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace mcp budget option: ${arg}`);
    }
  }

  return parsed;
}

function parseProjectPluginRefreshCommand(
  argv: string[],
): ParsedProjectPluginRefreshCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("workspace plugin refresh requires a workspace root");
  }

  const parsed: ParsedProjectPluginRefreshCommand = {
    projectRoot,
    from: "",
    agents: [],
    components: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--from":
        parsed.from = next();
        break;
      case "--export":
        parsed.exportName = next();
        break;
      case "--skills-export":
        parsed.skillsExportName = next();
        break;
      case "--agent":
        parsed.agents.push(next());
        break;
      case "--component":
        parsed.components.push(next());
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace plugin refresh option: ${arg}`);
    }
  }

  if (!parsed.from) {
    throw new Error("workspace plugin refresh requires --from <package|path>");
  }

  return parsed;
}

function parseProjectAgentProjectionCleanupCommand(
  argv: string[],
): ParsedProjectAgentProjectionCleanupCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("workspace agent-projection cleanup requires a workspace root");
  }

  const parsed: ParsedProjectAgentProjectionCleanupCommand = {
    projectRoot,
  };
  for (const arg of rest) {
    switch (arg) {
      case "--apply":
        parsed.apply = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace agent-projection cleanup option: ${arg}`);
    }
  }
  if (parsed.apply && parsed.dryRun) {
    throw new Error("workspace agent-projection cleanup cannot combine --apply and --dry-run");
  }

  return parsed;
}

function parseProjectTrackerConfigureCommand(
  argv: string[],
): ParsedProjectTrackerConfigureCommand {
  const [, , , project, ...rest] = argv;
  if (!project || project.startsWith("--")) {
    throw new Error("workspace tracker configure requires a workspace");
  }

  const parsed: Partial<ParsedProjectTrackerConfigureCommand> = { project };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--provider":
        parsed.provider = parseTrackerProvider(next(), arg);
        break;
      case "--host":
        parsed.host = next();
        break;
      case "--repository-owner":
        parsed.repositoryOwner = next();
        break;
      case "--repository-name":
        parsed.repositoryName = next();
        break;
      case "--repository-id":
        parsed.repositoryId = next();
        break;
      case "--project-key":
        parsed.projectKey = next();
        break;
      case "--issue-type":
        parsed.issueType = next();
        break;
      case "--store-path":
        parsed.storePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace tracker configure option: ${arg}`);
    }
  }

  if (!parsed.provider) {
    throw new Error("workspace tracker configure requires --provider");
  }

  return parsed as ParsedProjectTrackerConfigureCommand;
}

function parseProjectTrackerLinkCommand(
  argv: string[],
): ParsedProjectTrackerLinkCommand {
  const [, , , project, ...rest] = argv;
  if (!project || project.startsWith("--")) {
    throw new Error("workspace tracker link requires a workspace");
  }

  const parsed: Partial<ParsedProjectTrackerLinkCommand> = { project };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown workspace tracker link option: ${arg}`);
    }
  }

  if (!parsed.trackerProjectId) {
    throw new Error("workspace tracker link requires --tracker-project-id");
  }

  return parsed as ParsedProjectTrackerLinkCommand;
}

function parseSetupListCommand(argv: string[]): ParsedSetupListCommand {
  const rest = argv.slice(2);
  const parsed: ParsedSetupListCommand = {};
  for (const arg of rest) {
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown setup list option: ${arg}`);
  }

  return parsed;
}

function parseSetupPlanCommand(argv: string[]): ParsedSetupPlanCommand {
  const [, , projectRoot, flowId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("setup plan requires a workspace root");
  }
  if (!flowId || flowId.startsWith("--")) {
    throw new Error("setup plan requires a flow id");
  }

  const parsed: ParsedSetupPlanCommand = { projectRoot, flowId };
  parseSetupPlanOrCheckOptions(rest, parsed, "setup plan");
  return parsed;
}

function parseSetupCheckCommand(argv: string[]): ParsedSetupCheckCommand {
  const [, , projectRoot, flowId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("setup check requires a workspace root");
  }
  if (!flowId || flowId.startsWith("--")) {
    throw new Error("setup check requires a flow id");
  }

  const parsed: ParsedSetupCheckCommand = { projectRoot, flowId };
  parseSetupPlanOrCheckOptions(rest, parsed, "setup check");
  return parsed;
}

function parseSetupReadinessCommand(argv: string[]): ParsedSetupReadinessCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("setup readiness requires a workspace root");
  }

  const parsed: ParsedSetupReadinessCommand = { projectRoot };
  parseSetupReadinessOptions(rest, parsed);
  return parsed;
}

function parseSetupPlanOrCheckOptions(
  rest: string[],
  parsed: ParsedSetupPlanCommand | ParsedSetupCheckCommand,
  commandName: string,
): void {
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--platform":
        parsed.platform = parseSetupPlatform(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown ${commandName} option: ${arg}`);
    }
  }
}

function parseSetupReadinessOptions(
  rest: string[],
  parsed: ParsedSetupReadinessCommand,
): void {
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--platform":
        parsed.platform = parseSetupPlatform(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown setup readiness option: ${arg}`);
    }
  }
}

function parseSetupRecordCommand(argv: string[]): ParsedSetupRecordCommand {
  const [, , projectRoot, flowId, stepId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("setup record requires a workspace root");
  }
  if (!flowId || flowId.startsWith("--")) {
    throw new Error("setup record requires a flow id");
  }
  if (!stepId || stepId.startsWith("--")) {
    throw new Error("setup record requires a step id");
  }

  const parsed: Partial<ParsedSetupRecordCommand> = {
    projectRoot,
    flowId,
    stepId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--status":
        parsed.status = parseSetupRecordedStepStatus(next(), arg);
        break;
      case "--note":
        parsed.note = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown setup record option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("setup record requires --status");
  }

  return parsed as ParsedSetupRecordCommand;
}

function parseCoordinationStatusCommand(
  argv: string[],
): ParsedCoordinationStatusCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination status requires a workspace root");
  }

  const parsed: ParsedCoordinationStatusCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--tracker-role":
        parsed.trackerRole = parseNexusCoordinationTrackerRole(next(), arg);
        break;
      case "--worktree":
        parsed.currentPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--full":
        parsed.detail = "full";
        break;
      case "--detail":
        parsed.detail = parseCliOutputDetail(next(), arg);
        break;
      default:
        throw new Error(`Unknown coordination status option: ${arg}`);
    }
  }

  return parsed;
}

function parseCoordinationHandoffCommand(
  argv: string[],
): ParsedCoordinationHandoffCommand {
  const [, , projectRoot, workItemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination handoff requires a workspace root");
  }
  if (!workItemId || workItemId.startsWith("--")) {
    throw new Error("coordination handoff requires a work item id");
  }

  const parsed: Partial<ParsedCoordinationHandoffCommand> = {
    projectRoot,
    workItemId,
    changedAreas: [],
    decisions: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--status":
        parsed.status = parseNexusCoordinationHandoffStatus(next(), arg);
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--tracker-role":
        parsed.trackerRole = parseNexusCoordinationTrackerRole(next(), arg);
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--agent":
        parsed.agentId = next();
        break;
      case "--changed-area":
        parsed.changedAreas?.push(next());
        break;
      case "--decision":
        parsed.decisions?.push(next());
        break;
      case "--verification":
        parsed.verificationSummary = next();
        break;
      case "--integration-preference":
        parsed.integrationPreference = next();
        break;
      case "--note":
        parsed.note = next();
        break;
      case "--worktree":
        parsed.currentPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown coordination handoff option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("coordination handoff requires --status");
  }

  return parsed as ParsedCoordinationHandoffCommand;
}

function parseCoordinationIntegrateCommand(
  argv: string[],
): ParsedCoordinationIntegrateCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination integrate requires a workspace root");
  }

  const parsed: ParsedCoordinationIntegrateCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--tracker-role":
        parsed.trackerRole = parseNexusCoordinationTrackerRole(next(), arg);
        break;
      case "--target-branch":
        parsed.targetBranch = next();
        break;
      case "--fetch":
        parsed.fetch = true;
        break;
      case "--worktree":
        parsed.currentPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown coordination integrate option: ${arg}`);
    }
  }

  return parsed;
}

function parseCoordinationCleanupPlanCommand(
  argv: string[],
): ParsedCoordinationCleanupPlanCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination cleanup-plan requires a workspace root");
  }

  const parsed: ParsedCoordinationCleanupPlanCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--include-workspace-meta":
      case "--include-project-meta":
        parsed.includeProjectMeta = true;
        break;
      case "--target-branch":
        parsed.targetBranch = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown coordination cleanup-plan option: ${arg}`);
    }
  }

  return parsed;
}

function parseCoordinationRequestCommand(
  argv: string[],
): ParsedCoordinationRequestCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("coordination request requires a workspace root");
  }

  const parsed: Partial<ParsedCoordinationRequestCommand> = {
    projectRoot,
    requestedChanges: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--tracker-role":
        parsed.trackerRole = parseNexusCoordinationTrackerRole(next(), arg);
        break;
      case "--intent":
        parsed.intent = parseNexusCoordinationRequestIntent(next(), arg);
        break;
      case "--question":
        parsed.question = next();
        break;
      case "--note":
        parsed.note = next();
        break;
      case "--target":
        parsed.target = next();
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--agent":
        parsed.agentId = next();
        break;
      case "--response-status":
        parsed.responseStatus = parseNexusCoordinationRequestStatus(next(), arg);
        break;
      case "--response-summary":
        parsed.responseSummary = next();
        break;
      case "--responder":
        parsed.responder = next();
        break;
      case "--requested-change":
        parsed.requestedChanges?.push(next());
        break;
      case "--worktree":
        parsed.currentPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown coordination request option: ${arg}`);
    }
  }

  if (!parsed.intent) {
    throw new Error("coordination request requires --intent");
  }
  if (!parsed.question && !parsed.note) {
    throw new Error("coordination request requires --question or --note");
  }

  return parsed as ParsedCoordinationRequestCommand;
}

function parseWorktreePrepareCommand(
  argv: string[],
): ParsedWorktreePrepareCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("worktree prepare requires a workspace root");
  }

  const parsed: ParsedWorktreePrepareCommand = {
    projectRoot,
    writeScope: [],
    leaseNotes: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--workspace-meta":
      case "--project-meta":
        parsed.projectMeta = true;
        break;
      case "--work-item":
        parsed.workItemId = next();
        break;
      case "--work-item-title":
        parsed.workItemTitle = next();
        break;
      case "--topic":
        parsed.topic = next();
        break;
      case "--branch":
        parsed.branchName = next();
        break;
      case "--worktree-name":
        parsed.worktreeName = next();
        break;
      case "--base-ref":
        parsed.baseRef = next();
        break;
      case "--no-base-ref":
        parsed.baseRef = null;
        break;
      case "--initiative":
        parsed.initiativeId = next();
        break;
      case "--initiative-slice":
        parsed.initiativeSlice = next();
        break;
      case "--initiative-parent":
        parsed.initiativeParentBranch = next();
        break;
      case "--initiative-stack-position":
        parsed.initiativeStackPosition = parsePositiveInteger(next(), arg);
        break;
      case "--branch-intent":
        parsed.branchIntent = next();
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--agent":
        parsed.agentId = next();
        break;
      case "--worker-agent":
        parsed.workerAgentProvider = next();
        break;
      case "--write-scope":
        parsed.writeScope.push(next());
        break;
      case "--lease-note":
        parsed.leaseNotes.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown worktree prepare option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemCreateCommand(argv: string[]): ParsedWorkItemCreateCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item create requires a workspace root");
  }

  const parsed: Partial<ParsedWorkItemCreateCommand> = {
    projectRoot,
    labels: [],
    assignees: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--title":
        parsed.title = next();
        break;
      case "--description":
        parsed.description = next();
        break;
      case "--status":
        parsed.status = parseWorkStatus(next(), arg);
        break;
      case "--label":
        parsed.labels?.push(next());
        break;
      case "--assignee":
        parsed.assignees?.push(next());
        break;
      case "--milestone":
        parsed.milestone = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item create option: ${arg}`);
    }
  }

  if (!parsed.title) {
    throw new Error("work-item create requires --title");
  }

  return parsed as ParsedWorkItemCreateCommand;
}

function parseWorkItemDiscoveryStatusCommand(
  argv: string[],
): ParsedWorkItemDiscoveryStatusCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item discovery-status requires a workspace root");
  }

  const parsed: ParsedWorkItemDiscoveryStatusCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item discovery-status option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemClaimNextCommand(
  argv: string[],
): ParsedWorkItemClaimNextCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item claim-next requires a workspace root");
  }

  const parsed: Partial<ParsedWorkItemClaimNextCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--mode":
        parsed.mode = parseEligibleWorkMode(next(), arg);
        break;
      case "--discovery":
        parsed.mode = "discovery";
        break;
      case "--host":
        parsed.hostId = next();
        break;
      case "--agent":
        parsed.agentId = next();
        break;
      case "--owner":
        parsed.ownerId = next();
        break;
      case "--lease-ms":
      case "--lease-duration-ms":
        parsed.leaseDurationMs = parsePositiveInteger(next(), arg);
        break;
      case "--reclaim-stale":
        parsed.staleClaimPolicy = "reclaim";
        break;
      case "--stale-claim-policy":
        parsed.staleClaimPolicy = parseStaleClaimPolicy(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item claim-next option: ${arg}`);
    }
  }
  if (!parsed.hostId) {
    throw new Error("work-item claim-next requires --host");
  }

  return parsed as ParsedWorkItemClaimNextCommand;
}

function parseWorkItemListCommand(argv: string[]): ParsedWorkItemListCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item list requires a workspace root");
  }

  const parsed: ParsedWorkItemListCommand = {
    projectRoot,
    statuses: [],
    labels: [],
    assignees: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--status":
        parsed.statuses.push(parseWorkStatusQuery(next(), arg));
        break;
      case "--label":
        parsed.labels.push(next());
        break;
      case "--assignee":
        parsed.assignees.push(next());
        break;
      case "--search":
        parsed.search = next();
        break;
      case "--limit":
        parsed.limit = parsePositiveInteger(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item list option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemGetCommand(argv: string[]): ParsedWorkItemGetCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item get requires a workspace root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item get requires a work item id");
  }

  const parsed: ParsedWorkItemGetCommand = { projectRoot, itemId };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item get option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemUpdateCommand(argv: string[]): ParsedWorkItemUpdateCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item update requires a workspace root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item update requires a work item id");
  }

  const parsed: ParsedWorkItemUpdateCommand = {
    projectRoot,
    itemId,
    patch: {},
  };
  let replaceLabels: string[] | undefined;
  let replaceAssignees: string[] | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--title":
        parsed.patch.title = next();
        break;
      case "--description":
        if (parsed.patch.description === null) {
          throw new Error("--description conflicts with --clear-description");
        }
        parsed.patch.description = next();
        break;
      case "--clear-description":
        if (parsed.patch.description !== undefined) {
          throw new Error("--clear-description conflicts with --description");
        }
        parsed.patch.description = null;
        break;
      case "--status":
        parsed.patch.status = parseWorkStatus(next(), arg);
        break;
      case "--label":
        if (replaceLabels === undefined) {
          replaceLabels = [];
        }
        replaceLabels.push(next());
        break;
      case "--clear-labels":
        if (replaceLabels && replaceLabels.length > 0) {
          throw new Error("--clear-labels conflicts with --label");
        }
        replaceLabels = [];
        break;
      case "--assignee":
        if (replaceAssignees === undefined) {
          replaceAssignees = [];
        }
        replaceAssignees.push(next());
        break;
      case "--clear-assignees":
        if (replaceAssignees && replaceAssignees.length > 0) {
          throw new Error("--clear-assignees conflicts with --assignee");
        }
        replaceAssignees = [];
        break;
      case "--milestone":
        if (parsed.patch.milestone === null) {
          throw new Error("--milestone conflicts with --clear-milestone");
        }
        parsed.patch.milestone = next();
        break;
      case "--clear-milestone":
        if (parsed.patch.milestone !== undefined) {
          throw new Error("--clear-milestone conflicts with --milestone");
        }
        parsed.patch.milestone = null;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item update option: ${arg}`);
    }
  }

  if (replaceLabels !== undefined) {
    parsed.patch.labels = replaceLabels;
  }
  if (replaceAssignees !== undefined) {
    parsed.patch.assignees = replaceAssignees;
  }
  if (Object.keys(parsed.patch).length === 0) {
    throw new Error("work-item update requires at least one field to update");
  }

  return parsed;
}

function parseWorkItemCommentCommand(argv: string[]): ParsedWorkItemCommentCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item comment requires a workspace root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item comment requires a work item id");
  }

  const parsed: Partial<ParsedWorkItemCommentCommand> = {
    projectRoot,
    itemId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--body":
        parsed.body = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item comment option: ${arg}`);
    }
  }

  if (!parsed.body) {
    throw new Error("work-item comment requires --body");
  }

  return parsed as ParsedWorkItemCommentCommand;
}

function parseWorkItemSetStatusCommand(
  argv: string[],
): ParsedWorkItemSetStatusCommand {
  const [, , projectRoot, itemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item set-status requires a workspace root");
  }
  if (!itemId || itemId.startsWith("--")) {
    throw new Error("work-item set-status requires a work item id");
  }

  const parsed: Partial<ParsedWorkItemSetStatusCommand> = {
    projectRoot,
    itemId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--status":
        parsed.status = parseWorkStatus(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item set-status option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("work-item set-status requires --status");
  }

  return parsed as ParsedWorkItemSetStatusCommand;
}

function parseWorkItemLinkCommand(argv: string[]): ParsedWorkItemLinkCommand {
  const [, , projectRoot, logicalItemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item link requires a workspace root");
  }
  if (!logicalItemId || logicalItemId.startsWith("--")) {
    throw new Error("work-item link requires a logical work item id");
  }

  const parsed: Partial<ParsedWorkItemLinkCommand> = {
    projectRoot,
    logicalItemId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--provider":
        parsed.provider = next();
        break;
      case "--host":
        parsed.host = next();
        break;
      case "--repository-id":
        parsed.repositoryId = next();
        break;
      case "--repository-owner":
        parsed.repositoryOwner = next();
        break;
      case "--repository-name":
        parsed.repositoryName = next();
        break;
      case "--project-id":
        parsed.projectId = next();
        break;
      case "--board-id":
        parsed.boardId = next();
        break;
      case "--item-id":
        parsed.itemId = next();
        break;
      case "--item-number":
        parsed.itemNumber = parsePositiveInteger(next(), arg);
        break;
      case "--item-key":
        parsed.itemKey = next();
        break;
      case "--node-id":
        parsed.nodeId = next();
        break;
      case "--web-url":
        parsed.webUrl = next();
        break;
      case "--observed-at":
        parsed.observedAt = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item link option: ${arg}`);
    }
  }

  if (!parsed.trackerId) {
    throw new Error("work-item link requires --tracker");
  }
  if (!parsed.itemId) {
    throw new Error("work-item link requires --item-id");
  }

  return parsed as ParsedWorkItemLinkCommand;
}

function parseWorkItemShowLinksCommand(
  argv: string[],
): ParsedWorkItemShowLinksCommand {
  const [, , projectRoot, logicalItemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item show-links requires a workspace root");
  }
  if (!logicalItemId || logicalItemId.startsWith("--")) {
    throw new Error("work-item show-links requires a logical work item id");
  }

  const parsed: ParsedWorkItemShowLinksCommand = {
    projectRoot,
    logicalItemId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item show-links option: ${arg}`);
    }
  }

  return parsed;
}

function parseWorkItemUnlinkCommand(
  argv: string[],
): ParsedWorkItemUnlinkCommand {
  const [, , projectRoot, logicalItemId, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item unlink requires a workspace root");
  }
  if (!logicalItemId || logicalItemId.startsWith("--")) {
    throw new Error("work-item unlink requires a logical work item id");
  }

  const parsed: Partial<ParsedWorkItemUnlinkCommand> = {
    projectRoot,
    logicalItemId,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--tracker":
        parsed.trackerId = next();
        break;
      case "--item-id":
        parsed.itemId = next();
        break;
      case "--reason":
        parsed.reason = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item unlink option: ${arg}`);
    }
  }

  if (!parsed.trackerId) {
    throw new Error("work-item unlink requires --tracker");
  }
  if (!parsed.itemId) {
    throw new Error("work-item unlink requires --item-id");
  }

  return parsed as ParsedWorkItemUnlinkCommand;
}

function parseWorkItemSyncPlanCommand(
  argv: string[],
): ParsedWorkItemSyncPlanCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item sync-plan requires a workspace root");
  }

  const parsed: Partial<ParsedWorkItemSyncPlanCommand> = {
    projectRoot,
    statuses: [],
    labels: [],
    assignees: [],
    fields: [],
    statusMapping: {},
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--source-tracker":
        parsed.sourceTrackerId = next();
        break;
      case "--target-tracker":
        parsed.targetTrackerId = next();
        break;
      case "--direction":
        parsed.direction = parseWorkItemSyncDirection(next(), arg);
        break;
      case "--open":
        parsed.openOnly = true;
        break;
      case "--status":
        parsed.statuses?.push(parseWorkStatus(next(), arg));
        break;
      case "--label":
        parsed.labels?.push(next());
        break;
      case "--assignee":
        parsed.assignees?.push(next());
        break;
      case "--search":
        parsed.search = next();
        break;
      case "--limit":
        parsed.limit = parsePositiveInteger(next(), arg);
        break;
      case "--field":
        parsed.fields?.push(parseWorkItemSyncField(next(), arg));
        break;
      case "--comment-policy":
        parsed.commentPolicy = parseWorkItemSyncCommentPolicyMode(next(), arg);
        break;
      case "--status-map": {
        const [source, target] = parseStatusMapEntry(next(), arg);
        parsed.statusMapping![source] = target;
        break;
      }
      case "--conflict-policy":
        parsed.conflictPolicy = parseWorkItemSyncConflictPolicyMode(next(), arg);
        break;
      case "--write-create":
        parsed.writeCreates = parseWorkItemSyncWriteDisposition(next(), arg);
        break;
      case "--write-update":
        parsed.writeUpdates = parseWorkItemSyncWriteDisposition(next(), arg);
        break;
      case "--credentials":
        parsed.credentials = parseWorkItemSyncCredentialPolicy(next(), arg);
        break;
      case "--policy-reason":
        parsed.policyReason = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item sync-plan option: ${arg}`);
    }
  }

  if (!parsed.sourceTrackerId) {
    throw new Error("work-item sync-plan requires --source-tracker");
  }
  if (!parsed.targetTrackerId) {
    throw new Error("work-item sync-plan requires --target-tracker");
  }
  if (parsed.openOnly && (parsed.statuses?.length ?? 0) > 0) {
    throw new Error("work-item sync-plan cannot combine --open with --status");
  }

  return parsed as ParsedWorkItemSyncPlanCommand;
}

function parseWorkItemImportPlanCommand(
  argv: string[],
): ParsedWorkItemImportPlanCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("work-item import-plan requires a workspace root");
  }

  const parsed: Partial<ParsedWorkItemImportPlanCommand> = {
    projectRoot,
    statuses: [],
    labels: [],
    assignees: [],
    fields: [],
    statusMapping: {},
    fingerprints: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--source-tracker":
        parsed.sourceTrackerId = next();
        break;
      case "--target-tracker":
        parsed.targetTrackerId = next();
        break;
      case "--direction":
        parsed.direction = parseWorkItemImportDirection(next(), arg);
        break;
      case "--status":
        parsed.statuses?.push(parseWorkStatus(next(), arg));
        break;
      case "--label":
        parsed.labels?.push(next());
        break;
      case "--assignee":
        parsed.assignees?.push(next());
        break;
      case "--search":
        parsed.search = next();
        break;
      case "--limit":
        parsed.limit = parsePositiveInteger(next(), arg);
        break;
      case "--field":
        parsed.fields?.push(parseWorkItemSyncField(next(), arg));
        break;
      case "--status-map": {
        const [source, target] = parseStatusMapEntry(next(), arg);
        parsed.statusMapping![source] = target;
        break;
      }
      case "--conflict-policy":
        parsed.conflictPolicy = parseWorkItemSyncConflictPolicyMode(next(), arg);
        break;
      case "--write-create":
        parsed.writeCreates = parseWorkItemSyncWriteDisposition(next(), arg);
        break;
      case "--write-update":
        parsed.writeUpdates = parseWorkItemSyncWriteDisposition(next(), arg);
        break;
      case "--write-link":
        parsed.writeLinks = parseWorkItemSyncWriteDisposition(next(), arg);
        break;
      case "--fingerprint":
        parsed.fingerprints?.push(parseWorkItemImportFingerprint(next(), arg));
        break;
      case "--credentials":
        parsed.credentials = parseWorkItemSyncCredentialPolicy(next(), arg);
        break;
      case "--policy-reason":
        parsed.policyReason = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown work-item import-plan option: ${arg}`);
    }
  }

  if (!parsed.sourceTrackerId) {
    throw new Error("work-item import-plan requires --source-tracker");
  }
  if (!parsed.targetTrackerId) {
    throw new Error("work-item import-plan requires --target-tracker");
  }

  return parsed as ParsedWorkItemImportPlanCommand;
}

function parseAutomationEnqueueCommand(
  argv: string[],
): ParsedAutomationEnqueueCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation enqueue requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationEnqueueCommand> = {
    projectRoot,
    labels: [],
    assignees: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--title":
        parsed.title = next();
        break;
      case "--description":
        parsed.description = next();
        break;
      case "--status":
        parsed.status = parseWorkStatus(next(), arg);
        break;
      case "--label":
        parsed.labels?.push(next());
        break;
      case "--assignee":
        parsed.assignees?.push(next());
        break;
      case "--milestone":
        parsed.milestone = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation enqueue option: ${arg}`);
    }
  }

  if (!parsed.title) {
    throw new Error("automation enqueue requires --title");
  }

  return parsed as ParsedAutomationEnqueueCommand;
}

function parseAutomationHeartbeatPrepareCommand(
  argv: string[],
): ParsedAutomationHeartbeatPrepareCommand {
  const [, , command, projectRoot, ...rest] = argv;
  if (command !== "prepare") {
    throw new Error("automation heartbeat requires prepare");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation heartbeat prepare requires a workspace root");
  }

  const parsed: ParsedAutomationHeartbeatPrepareCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--name":
        parsed.name = next();
        break;
      case "--interval-minutes":
        parsed.intervalMinutes = parsePositiveInteger(next(), arg);
        break;
      case "--paused":
        parsed.status = "PAUSED";
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation heartbeat prepare option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationTargetCycleListCommand(
  argv: string[],
): ParsedAutomationTargetCycleListCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation target-cycle list requires a workspace root");
  }

  const parsed: ParsedAutomationTargetCycleListCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--full":
        parsed.detail = "full";
        break;
      case "--detail":
        parsed.detail = parseCliOutputDetail(next(), arg);
        break;
      default:
        throw new Error(`Unknown automation target-cycle list option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationTargetCycleRecordCommand(
  argv: string[],
): ParsedAutomationTargetCycleRecordCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation target-cycle record requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationTargetCycleRecordCommand> = {
    projectRoot,
    workItems: [],
    blockers: [],
    notes: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--cycle-id":
        parsed.cycleId = next();
        break;
      case "--run-id":
        parsed.runId = next();
        break;
      case "--status":
        parsed.status = parseTargetCycleStatus(next(), arg);
        break;
      case "--summary":
        parsed.summary = next();
        break;
      case "--eligible-work-items":
        parsed.eligibleWorkItemCount = parseNonNegativeInteger(next(), arg);
        break;
      case "--work-item":
        parsed.workItems?.push(parseTargetCycleWorkItem(next(), arg));
        break;
      case "--work-item-logical-id":
        lastParsedTargetCycleWorkItem(parsed, arg).logicalItemId = next();
        break;
      case "--work-item-tracker":
        lastParsedTargetCycleWorkItem(parsed, arg).trackerId = next();
        break;
      case "--work-item-status":
        lastParsedTargetCycleWorkItem(parsed, arg).cycleStatus =
          parseTargetCycleWorkItemStatus(next(), arg);
        break;
      case "--work-item-agent-profile":
        lastParsedTargetCycleWorkItem(parsed, arg).agentProfileId = next();
        break;
      case "--work-item-note":
        lastParsedTargetCycleWorkItem(parsed, arg).notes = next();
        break;
      case "--blocker":
        parsed.blockers?.push(next());
        break;
      case "--note":
        parsed.notes?.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--full":
        parsed.detail = "full";
        break;
      case "--detail":
        parsed.detail = parseCliOutputDetail(next(), arg);
        break;
      default:
        throw new Error(`Unknown automation target-cycle record option: ${arg}`);
    }
  }

  if (!parsed.status) {
    throw new Error("automation target-cycle record requires --status");
  }

  return parsed as ParsedAutomationTargetCycleRecordCommand;
}

function parseAutomationTargetReportCommand(
  argv: string[],
): ParsedAutomationTargetReportCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation target-report requires a workspace root");
  }

  const parsed: ParsedAutomationTargetReportCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--full":
        parsed.detail = "full";
        break;
      case "--detail":
        parsed.detail = parseCliOutputDetail(next(), arg);
        break;
      default:
        throw new Error(`Unknown automation target-report option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationRunOnceCommand(
  argv: string[],
): ParsedAutomationRunOnceCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation run-once requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationRunOnceCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--command":
        parsed.command = next();
        break;
      case "--run-id":
        parsed.runId = next();
        break;
      case "--owner":
        parsed.owner = next();
        break;
      case "--branch":
        parsed.branchName = next();
        break;
      case "--worktree-name":
        parsed.worktreeName = next();
        break;
      case "--base-ref":
        parsed.baseRef = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--full":
        parsed.runFullVerification = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation run-once option: ${arg}`);
    }
  }

  return parsed as ParsedAutomationRunOnceCommand;
}

function parseAutomationStatusCommand(
  argv: string[],
): ParsedAutomationStatusCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation status requires a workspace root");
  }

  const parsed: ParsedAutomationStatusCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--full":
        parsed.detail = "full";
        break;
      case "--detail":
        parsed.detail = parseCliOutputDetail(next(), arg);
        break;
      case "--home":
        parsed.homePath = next();
        break;
      default:
        throw new Error(`Unknown automation status option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationEligibleWorkCommand(
  argv: string[],
): ParsedAutomationEligibleWorkCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation eligible-work requires a workspace root");
  }

  const parsed: ParsedAutomationEligibleWorkCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--discovery":
        parsed.mode = "discovery";
        break;
      case "--mode":
        parsed.mode = parseEligibleWorkMode(next(), arg);
        break;
      default:
        throw new Error(`Unknown automation eligible-work option: ${arg}`);
    }
  }

  return parsed;
}

function parseEligibleWorkMode(
  value: string,
  optionName: string,
): NexusEligibleWorkMode {
  if (value === "default" || value === "discovery") {
    return value;
  }

  throw new Error(`${optionName} must be default or discovery`);
}

function parseAutomationAgentProfilesCommand(
  argv: string[],
): ParsedAutomationAgentProfilesCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation agent-profiles requires a workspace root");
  }

  const parsed: ParsedAutomationAgentProfilesCommand = { projectRoot };
  for (const arg of rest) {
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation agent-profiles option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationAppServerProbeCommand(
  argv: string[],
): ParsedAutomationAppServerProbeCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation app-server-probe requires a workspace root");
  }

  const parsed: ParsedAutomationAppServerProbeCommand = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--profile":
        parsed.profileId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation app-server-probe option: ${arg}`);
    }
  }

  return parsed;
}

function parseAutomationScheduleCommand(
  argv: string[],
): ParsedAutomationScheduleCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation schedule requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationScheduleCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--command":
        parsed.command = next();
        break;
      case "--owner":
        parsed.owner = next();
        break;
      case "--base-ref":
        parsed.baseRef = next();
        break;
      case "--interval-ms":
        parsed.intervalMs = parsePositiveInteger(next(), arg);
        break;
      case "--max-ticks":
        parsed.maxTicks = parsePositiveInteger(next(), arg);
        break;
      case "--max-runs":
        parsed.maxRuns = parsePositiveInteger(next(), arg);
        break;
      case "--run-id-prefix":
        parsed.runIdPrefix = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--full":
        parsed.runFullVerification = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation schedule option: ${arg}`);
    }
  }

  return parsed as ParsedAutomationScheduleCommand;
}

function parseAutomationCoordinatorLoopCommand(
  argv: string[],
): ParsedAutomationCoordinatorLoopCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation coordinator-loop requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationCoordinatorLoopCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--command":
        parsed.command = next();
        break;
      case "--adopt-current":
        parsed.adoptCurrent = true;
        break;
      case "--run-id":
        parsed.runId = next();
        break;
      case "--progress-jsonl":
        parsed.progressJsonl = true;
        break;
      case "--owner":
        parsed.owner = next();
        break;
      case "--interval-ms":
        parsed.intervalMs = parsePositiveInteger(next(), arg);
        break;
      case "--max-ticks":
        parsed.maxTicks = parsePositiveInteger(next(), arg);
        break;
      case "--max-runs":
        parsed.maxRuns = parsePositiveInteger(next(), arg);
        break;
      case "--run-id-prefix":
        parsed.runIdPrefix = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation coordinator-loop option: ${arg}`);
    }
  }

  return parsed as ParsedAutomationCoordinatorLoopCommand;
}

function parseAutomationCurrentAgentAdoptCommand(
  argv: string[],
): ParsedAutomationCurrentAgentAdoptCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation current-agent adopt requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationCurrentAgentAdoptCommand> = { projectRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--run-id":
        parsed.runId = next();
        break;
      case "--owner":
        parsed.owner = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation current-agent adopt option: ${arg}`);
    }
  }

  return parsed as ParsedAutomationCurrentAgentAdoptCommand;
}

function parseAutomationCurrentAgentRecordCommand(
  argv: string[],
): ParsedAutomationCurrentAgentRecordCommand {
  const [, , , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("automation current-agent record requires a workspace root");
  }

  const parsed: Partial<ParsedAutomationCurrentAgentRecordCommand> & {
    commitIds: string[];
    verification: NonNullable<NexusAutomationCurrentAgentAdoptionResultInput["verification"]>;
    publicationDecision?: NonNullable<NexusAutomationCurrentAgentAdoptionResultInput["publicationDecision"]>;
    status?: NexusAutomationCurrentAgentAdoptionResultStatus;
    summary?: string;
    error?: string | null;
  } = {
    projectRoot,
    commitIds: [],
    verification: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };
    const lastVerification = () => {
      const item = parsed.verification.at(-1);
      if (!item) {
        throw new Error(`${arg} requires a preceding --verification-command`);
      }

      return item;
    };

    switch (arg) {
      case "--run-id":
        parsed.runId = next();
        break;
      case "--status":
        parsed.status = parseCurrentAgentResultStatus(next(), arg);
        break;
      case "--summary":
        parsed.summary = next();
        break;
      case "--commit":
        parsed.commitIds.push(next());
        break;
      case "--verification-command":
        parsed.verification.push({ command: next() });
        break;
      case "--verification-status":
        lastVerification().status = parseVerificationStatus(next(), arg);
        break;
      case "--verification-summary":
        lastVerification().summary = next();
        break;
      case "--publication-type":
        parsed.publicationDecision = {
          ...(parsed.publicationDecision ?? {
            targetBranch: null,
            remote: null,
            prUrl: null,
            reason: null,
          }),
          type: parsePublicationDecisionType(next(), arg),
        };
        break;
      case "--publication-remote":
        parsed.publicationDecision = {
          ...(parsed.publicationDecision ?? {
            type: "not_decided",
            targetBranch: null,
            prUrl: null,
            reason: null,
          }),
          remote: next(),
        };
        break;
      case "--publication-target-branch":
        parsed.publicationDecision = {
          ...(parsed.publicationDecision ?? {
            type: "not_decided",
            remote: null,
            prUrl: null,
            reason: null,
          }),
          targetBranch: next(),
        };
        break;
      case "--publication-pr-url":
        parsed.publicationDecision = {
          ...(parsed.publicationDecision ?? {
            type: "not_decided",
            targetBranch: null,
            remote: null,
            reason: null,
          }),
          prUrl: next(),
        };
        break;
      case "--publication-reason":
        parsed.publicationDecision = {
          ...(parsed.publicationDecision ?? {
            type: "not_decided",
            targetBranch: null,
            remote: null,
            prUrl: null,
          }),
          reason: next(),
        };
        break;
      case "--error":
        parsed.error = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown automation current-agent record option: ${arg}`);
    }
  }

  if (!parsed.runId) {
    throw new Error("automation current-agent record requires --run-id");
  }
  if (!parsed.status) {
    throw new Error("automation current-agent record requires --status");
  }
  if (!parsed.summary) {
    throw new Error("automation current-agent record requires --summary");
  }

  return {
    projectRoot,
    runId: parsed.runId,
    json: parsed.json,
    result: {
      status: parsed.status,
      summary: parsed.summary,
      ...(parsed.commitIds.length ? { commitIds: parsed.commitIds } : {}),
      ...(parsed.verification.length ? { verification: parsed.verification } : {}),
      ...(parsed.publicationDecision
        ? { publicationDecision: parsed.publicationDecision }
        : {}),
      ...(parsed.error !== undefined ? { error: parsed.error } : {}),
    },
  };
}

function printHomeInitResult(
  result: {
    homePath: string;
    configPath: string;
    config: NexusHomeConfigBase;
  },
  parsed: ParsedHomeInitCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus home initialized.");
  writeLine(stdout, `  Home: ${result.homePath}`);
  writeLine(stdout, `  Config: ${result.configPath}`);
  writeLine(stdout, `  Projects root: ${result.config.paths.projectsRoot}`);
}

function printProjectCreateResult(
  result: CreateNexusProjectResult,
  parsed: ParsedProjectCreateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus workspace created.");
  printProjectStatusText(result.reference, stdout);
  writeLine(stdout, `  Config: ${result.projectConfigPath}`);
}

function printProjectSetupMissingAnswers(
  parsed: ParsedProjectSetupCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: false,
    error: "project_setup_answers_required",
    requiredAnswers: [...nexusProjectSetupRequiredAnswerPaths],
    nextAction:
      "Provide --answers <json-file>, or run from an interactive terminal to answer setup prompts.",
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, renderNexusProjectSetupRequiredAnswers());
}

function printProjectSetupPreviewResult(
  proposal: NexusProjectSetupProposal,
  parsed: ParsedProjectSetupCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: proposal.status === "ready",
    applied: false,
    proposal,
    nextAction: proposal.status === "ready"
      ? "Review the preview, then rerun without --dry-run to apply local setup writes."
      : "Fix the reported setup diagnostics before applying.",
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, renderNexusProjectSetupProposalSummary(proposal));
  writeLine(stdout, "");
  writeLine(stdout, payload.nextAction);
}

function printProjectSetupApplyResult(
  result: NexusProjectSetupApplyResult,
  parsed: ParsedProjectSetupCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    applied: true,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    worktreesRoot: result.worktreesRoot,
    proposal: result.proposal,
    writtenFiles: result.writtenFiles,
    ensuredLocalTrackerStores: result.ensuredLocalTrackerStores,
    git: result.git,
    nextActions: projectSetupApplyNextActions(result),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus workspace initialized.");
  writeLine(stdout, `  Root: ${result.projectRoot}`);
  writeLine(stdout, `  Config: ${result.projectConfigPath}`);
  writeLine(stdout, `  Worktrees: ${result.worktreesRoot}`);
  for (const action of payload.nextActions) {
    writeLine(stdout, `  Next: ${action}`);
  }
}

function printProjectComponentAddPreviewResult(
  proposal: NexusProjectComponentAddProposal,
  parsed: ParsedProjectComponentAddCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: proposal.status === "ready",
    applied: false,
    proposal,
    nextAction: proposal.status === "ready"
      ? "Review the component topology preview, then rerun without --dry-run to update the project."
      : "Fix the reported component topology diagnostics before applying.",
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, renderProjectComponentAddSummary(proposal));
  writeLine(stdout, "");
  writeLine(stdout, payload.nextAction);
}

function printProjectComponentAddApplyResult(
  result: NexusProjectComponentAddApplyResult,
  parsed: ParsedProjectComponentAddCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    applied: true,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    addedComponentIds: result.proposal.addedComponentIds,
    proposal: result.proposal,
    writtenFiles: result.writtenFiles,
    ensuredLocalTrackerStores: result.ensuredLocalTrackerStores,
    nextActions: [
      "Run dev-nexus workspace status <workspace-root> to inspect the updated component graph.",
      "Run dev-nexus setup check <workspace-root> join-existing-project to verify local readiness.",
      "Create component-scoped work items with --component <component-id>.",
    ],
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus workspace components added.");
  writeLine(stdout, `  Root: ${result.projectRoot}`);
  writeLine(stdout, `  Added: ${result.proposal.addedComponentIds.join(", ")}`);
  for (const action of payload.nextActions) {
    writeLine(stdout, `  Next: ${action}`);
  }
}

function renderProjectComponentAddSummary(
  proposal: NexusProjectComponentAddProposal,
): string {
  const lines = [
    `Workspace component add proposal: ${proposal.project.name} (${proposal.project.id})`,
    `Root: ${proposal.projectRoot}`,
    `Existing components: ${proposal.existingComponentIds.join(", ") || "none"}`,
    `Added components: ${proposal.addedComponentIds.join(", ") || "none"}`,
    `Diagnostics: ${proposal.diagnostics.length}`,
  ];
  for (const diagnostic of proposal.diagnostics) {
    lines.push(`- [${diagnostic.severity}] ${diagnostic.path}: ${diagnostic.message}`);
  }

  return lines.join("\n");
}

function printProjectImportResult(
  result: ImportNexusProjectResult,
  parsed: ParsedProjectImportCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus workspace imported.");
  printProjectStatusText(result.reference, stdout);
  writeLine(stdout, `  Config: ${result.projectConfigPath}`);
}

function printProjectListResult(
  result: ListNexusProjectsResult,
  parsed: ParsedProjectListCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus workspaces: ${result.projects.length}`);
  for (const project of result.projects) {
    writeLine(stdout, `  ${project.id} ${project.projectRoot}`);
  }
}

function cliOutputDetail(parsed: { detail?: CliOutputDetail }): CliOutputDetail {
  return parsed.detail ?? "summary";
}

function summarizeProjectConfigForCli(projectConfig: NexusProjectConfig) {
  return {
    id: projectConfig.id,
    name: projectConfig.name,
    componentCount: projectConfig.components.length,
  };
}

function summarizeTargetCycleLedgerForCli(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>,
) {
  const ledgerPath = projectConfig.automation
    ? nexusAutomationTargetCycleLedgerPath(projectRoot, projectConfig.automation)
    : "(automation target cycle ledger not configured)";
  return summarizeTargetCycleLedger(ledger, ledgerPath);
}

function printProjectStatusResult(
  project: NexusProjectStatusBase,
  parsed: ParsedProjectStatusCommand,
  stdout: TextWriter,
): void {
  const detail = cliOutputDetail(parsed);
  const payload = {
    ok: true,
    detail,
    project: detail === "full" ? project : summarizeProjectStatus(project),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus workspace ${project.id}.`);
  printProjectStatusText(project, stdout);
  writeLine(
    stdout,
    `  Work tracking: ${project.workTracking?.provider ?? "not configured"}`,
  );
  writeLine(
    stdout,
    `  Default tracker: ${project.defaultTrackerId ?? "not configured"}`,
  );
  writeLine(stdout, `  Trackers: ${project.workTrackers.length}`);
  for (const tracker of project.workTrackers) {
    const state = tracker.enabled ? "enabled" : "disabled";
    const defaultState =
      tracker.id === project.defaultTrackerId ? " default" : "";
    const unsupported =
      tracker.workTrackingCapabilityReport.unsupported.length > 0
        ? tracker.workTrackingCapabilityReport.unsupported.join(",")
        : "none";
    writeLine(
      stdout,
      `    ${tracker.id}${defaultState} [${tracker.workTracking.provider}] ` +
        `${state} roles=${tracker.roles.join(",")} unsupported=${unsupported}`,
    );
  }
  if (project.agentTargets) {
    writeLine(
      stdout,
      `  Agent targets: ${project.agentTargets.summary}`,
    );
    for (const recommendation of project.agentTargets.recommendations) {
      writeLine(stdout, `    Recommendation: ${recommendation}`);
    }
    for (const stale of project.agentTargets.staleGeneratedProviderDirectories) {
      writeLine(
        stdout,
        `    Stale generated ${stale.provider} ${stale.kind}: ${stale.path}`,
      );
    }
    for (const manual of project.agentTargets.manualProviderDirectories) {
      writeLine(
        stdout,
        `    Manual ${manual.provider} ${manual.kind}: ${manual.path}`,
      );
    }
  }
  writeLine(stdout, `  Hosts: ${project.hosts.length}`);
  for (const host of project.hosts) {
    const enabled = host.enabled ? "enabled" : "disabled";
    const platformTags =
      host.platformTags.length > 0 ? host.platformTags.join(",") : "none";
    const capabilityTags =
      host.capabilityTags.length > 0 ? host.capabilityTags.join(",") : "none";
    const overlay = host.overlayConfigured
      ? "overlay=configured"
      : "overlay=missing";
    writeLine(
      stdout,
      `    ${host.id} [${enabled}] platforms=${platformTags} capabilities=${capabilityTags} ${overlay}`,
    );
    for (const warning of host.warnings) {
      writeLine(stdout, `      Warning: ${warning}`);
    }
  }
  writeLine(stdout, `  Runner profiles: ${project.runnerProfiles.length}`);
  for (const profile of project.runnerProfiles) {
    const enabled = profile.enabled ? "enabled" : "disabled";
    const capabilities =
      profile.requiredCapabilities.length > 0
        ? profile.requiredCapabilities.join(",")
        : "none";
    const missing =
      profile.missingHostCapabilities.length > 0
        ? profile.missingHostCapabilities.join(",")
        : "none";
    writeLine(
      stdout,
      `    ${profile.id} [${enabled}] mutation=${profile.mutationClass} approval=${profile.approvalState} capabilities=${capabilities} missingHostCapabilities=${missing}`,
    );
  }
  if (project.authority) {
    printAuthorityProjectSummary(project.authority, stdout);
  }
  writeLine(stdout, `  Components: ${project.components.length}`);
  for (const component of project.components) {
    writeLine(
      stdout,
      `    ${component.id} [${component.role}] ${component.sourceRoot}`,
    );
  }
  writeLine(stdout, `  Config exists: ${project.projectConfigExists}`);
  writeLine(stdout, `  Worktrees root: ${project.worktreesRoot}`);
}

function printProjectHostingStatusResult(
  result: ProjectHostingStatusCliResult,
  parsed: ParsedProjectHostingCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, projectRoot: result.projectRoot, status: result.status };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus workspace hosting status: ${result.status.status}.`);
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Root: ${result.projectRoot}`);
  writeLine(
    stdout,
    `  Repository: ${hostingRepositoryText(result.status)}`,
  );
  writeLine(stdout, `  Remotes: ${result.status.remotes.length}`);
  for (const remote of result.status.remotes) {
    writeLine(
      stdout,
      `    ${remote.name} [${remote.role}] ${remote.status} expected=${remote.expectedUrl} current=${remote.currentUrl ?? "unknown"}`,
    );
  }
  writeLine(stdout, `  Auth profiles: ${result.status.authProfiles.length}`);
  for (const profile of result.status.authProfiles) {
    writeLine(
      stdout,
      `    ${profile.id} ${profile.status} expected=${profile.expectedAccount ?? "unknown"} observed=${profile.observedAccount ?? "unknown"}`,
    );
  }
  writeLine(stdout, `  Access declarations: ${result.status.access.length}`);
  for (const access of result.status.access) {
    writeLine(
      stdout,
      `    ${access.kind}:${access.providerIdentity} ${access.status} required=${access.requiredPermission} effective=${access.effectivePermission ?? "unknown"}`,
    );
  }
  printHostingIssues(result.status.issues, stdout);
}

function printProjectHostingPlanResult(
  result: ProjectHostingPlanCliResult,
  parsed: ParsedProjectHostingCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    projectRoot: result.projectRoot,
    status: result.status,
    plan: result.plan,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus workspace hosting plan: ${result.plan.status}.`);
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(
    stdout,
    `  Repository: ${result.plan.namespace ?? "not configured"}/${result.plan.repositoryName ?? "not configured"}`,
  );
  writeLine(stdout, `  Actions: ${result.plan.actions.length}`);
  for (const action of result.plan.actions) {
    writeLine(
      stdout,
      `    ${action.disposition} ${action.kind} ${hostingActionTargetText(action.target)} auth=${action.authProfile ?? "none"}`,
    );
    writeLine(stdout, `      ${action.reason}`);
  }
  if (result.plan.actions.length === 0) {
    writeLine(stdout, "    none");
  }
}

function printProjectHostingApplyResult(
  result: ProjectHostingApplyCliResult,
  parsed: ParsedProjectHostingCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: result.apply.ok,
    projectRoot: result.projectRoot,
    status: result.status,
    apply: result.apply,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus workspace hosting apply: ${result.apply.status}.`);
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Actions: ${result.apply.actions.length}`);
  for (const action of result.apply.actions) {
    writeLine(
      stdout,
      `    ${action.disposition} ${action.kind} ${action.actionId}`,
    );
    writeLine(stdout, `      ${action.reason}`);
  }
  if (result.apply.actions.length === 0) {
    writeLine(stdout, "    none");
  }
  if (result.apply.finalPlan) {
    writeLine(
      stdout,
      `  Remaining plan actions: ${result.apply.finalPlan.actions.length}`,
    );
  }
}

function hostingRepositoryText(status: NexusProjectHostingStatusResult): string {
  if (!status.configured) {
    return "not configured";
  }

  return (
    `${status.namespace ?? "unknown"}/${status.repositoryName ?? "unknown"} ` +
    `exists=${status.repository.exists ?? "unknown"} ` +
    `visibility=${status.repository.visibility ?? "unknown"} ` +
    `defaultBranch=${status.repository.defaultBranch ?? "unknown"}`
  );
}

function hostingActionTargetText(
  target: NexusProjectHostingPlanResult["actions"][number]["target"],
): string {
  if (target.kind && target.providerIdentity) {
    return `${target.type}:${target.kind}:${target.providerIdentity}`;
  }
  if (target.name) {
    return `${target.type}:${target.name}`;
  }
  return target.type;
}

function printHostingIssues(
  issues: NexusProjectHostingStatusResult["issues"],
  stdout: TextWriter,
): void {
  writeLine(stdout, `  Issues: ${issues.length}`);
  for (const issue of issues) {
    writeLine(stdout, `    [${issue.severity}] ${issue.code}: ${issue.message}`);
  }
}

function printProjectMcpRefreshResult(
  result: MaterializeNexusProjectAgentMcpConfigResult | ProjectMcpRefreshDryRunResult,
  parsed: ParsedProjectMcpRefreshCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    applied: parsed.dryRun !== true,
    ...result,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(
    stdout,
    parsed.dryRun
      ? "DevNexus MCP agent config refresh dry-run."
      : "DevNexus MCP agent config refreshed.",
  );
  writeLine(stdout, `  Agent targets: ${result.agentTargets.length}`);
  for (const target of result.agentTargets) {
    writeLine(
      stdout,
      `    ${target.agent}/${target.provider}: ${target.configPath} (${target.serverName}, ${target.configStatus}, ${target.configFormat}/${target.configSchema})`,
    );
    if (target.commandResolution.strategy !== "unchanged") {
      writeLine(stdout, `      Command: ${target.commandResolution.summary}`);
    }
    for (const note of target.activationNotes) {
      writeLine(stdout, `      Session: ${note}`);
    }
    writeLine(stdout, `      Trust: ${target.trustSemantics.summary}`);
    for (const gap of target.capabilityGaps) {
      writeLine(stdout, `      Gap: ${gap.severity} ${gap.summary}`);
    }
  }
  if (result.capabilityGaps.length > 0) {
    writeLine(stdout, `  Capability gaps: ${result.capabilityGaps.length}`);
  }
  if (result.gitExcludeEntries.length > 0) {
    writeLine(stdout, `  Git exclude entries: ${result.gitExcludeEntries.length}`);
  }
  if ("exposurePlan" in result) {
    writeLine(stdout, "  Exposure plan:");
    for (const target of result.exposurePlan.directTargets) {
      writeLine(
        stdout,
        `    direct ${target.agent}/${target.serverName}: ${target.mode} (${target.source})`,
      );
    }
    for (const server of result.exposurePlan.pluginServers) {
      writeLine(
        stdout,
        `    plugin ${server.pluginId}/${server.serverName}: ${server.mode} (${server.source})`,
      );
    }
  }
}

function buildProjectMcpRefreshExposurePlan(options: {
  projectConfig: NexusProjectConfig;
  selectedTargets: NexusProjectAgentMcpTarget[];
  materializedTargets: MaterializedNexusAgentMcpTarget[];
}): ProjectMcpRefreshExposurePlan {
  return {
    directTargets: options.materializedTargets.map((target) => {
      const configuredTarget =
        options.selectedTargets.find((candidate) =>
          candidate.agent.trim().toLowerCase() === target.agent.trim().toLowerCase()
        ) ?? {
          agent: target.agent,
          provider: target.provider,
        };
      const exposure = resolveNexusMcpExposure({
        workspaceExposure: options.projectConfig.mcp?.exposure,
        agentTarget: configuredTarget,
      });
      return {
        agent: target.agent,
        provider: target.provider,
        serverName: target.serverName,
        mode: exposure.mode,
        source: exposure.source,
        path: exposure.path,
        reason: exposure.reason,
      };
    }),
    pluginServers: options.selectedTargets.flatMap((target) =>
      resolveNexusPluginMcpServerExposures(options.projectConfig, {
        agent: target.agent,
      }),
    ),
  };
}

function printProjectMcpBudgetResult(
  report: NexusMcpContextBudgetReport,
  parsed: ParsedProjectMcpBudgetCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, report);
    return;
  }

  writeLine(stdout, "DevNexus MCP context budget.");
  writeLine(stdout, `  Project: ${report.projectRoot}`);
  writeLine(stdout, `  Direct MCP targets: ${report.totals.directTargetCount}`);
  writeLine(
    stdout,
    `  Plugin-declared MCP servers: ${report.totals.pluginDeclaredServerCount}`,
  );
  writeLine(
    stdout,
    `  Known tools: ${report.totals.knownToolCount}; estimated metadata: ${report.totals.estimatedBytes} bytes (~${report.totals.estimatedTokens} tokens)`,
  );
  writeLine(
    stdout,
    `  Visible MCP context: ${report.contextImpact.visibleEstimatedBytes} bytes (~${report.contextImpact.visibleEstimatedTokens} tokens)`,
  );
  if (report.contextImpact.gatewayRoutedToolCount > 0) {
    writeLine(
      stdout,
      `  Gateway routing: ${report.contextImpact.gatewaySurfaceToolCount} visible gateway tool(s) route ${report.contextImpact.gatewayRoutedToolCount} upstream tool(s); saved ${report.contextImpact.savedBytes} bytes (~${report.contextImpact.savedTokens} tokens)`,
    );
  }
  writeLine(stdout, "  Top MCP servers:");
  for (const server of report.topServers) {
    writeLine(
      stdout,
      `    ${server.source}:${server.serverName} ${server.toolCount} tool(s), ${server.estimatedBytes} bytes (${server.metadataStatus})`,
    );
  }
  if (report.topServers.length === 0) {
    writeLine(stdout, "    none");
  }
  writeLine(stdout, "  Top MCP tools:");
  for (const tool of report.topTools) {
    writeLine(
      stdout,
      `    ${tool.serverName}.${tool.toolName} ${tool.estimatedBytes} bytes`,
    );
  }
  if (report.topTools.length === 0) {
    writeLine(stdout, "    none");
  }
  for (const warning of report.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printProjectPluginRefreshResult(
  result: RefreshNexusProjectPluginResult,
  parsed: ParsedProjectPluginRefreshCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(
    stdout,
    `DevNexus workspace plugin ${result.applied ? "refreshed" : "refresh dry-run"}.`,
  );
  writeLine(stdout, `  Plugin: ${result.plugin.id}`);
  writeLine(stdout, `  Version: ${result.plugin.version ?? "not specified"}`);
  writeLine(stdout, `  Config: ${result.configWritten ? "written" : "not written"}`);
  writeLine(stdout, `  Capabilities: ${result.plugin.capabilityCount}`);
  writeLine(
    stdout,
    `  Projected skills: ${result.skillProjection.materializedSkillCount} support, ${result.skillProjection.materializedAgentSkillCount} agent`,
  );
  writeLine(
    stdout,
    `  MCP servers: ${result.mcpProjection.materializedServerCount} materialized, ${result.mcpProjection.skippedServers.length} skipped`,
  );
  for (const skipped of result.mcpProjection.skippedServers) {
    writeLine(
      stdout,
      `    Skipped ${skipped.serverName}: ${skipped.reason} (${skipped.capabilityIds.join(", ")})`,
    );
  }
}

function printProjectAgentProjectionCleanupPlanResult(
  plan: NexusAgentProjectionCleanupPlan,
  parsed: ParsedProjectAgentProjectionCleanupCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: plan.status === "ready",
    mode: "dry-run",
    projectRoot: plan.projectRoot,
    plan,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus agent workspaceion cleanup dry-run: ${plan.status}.`);
  writeLine(stdout, `  Active providers: ${plan.activeProviders.join(",") || "none"}`);
  writeLine(stdout, `  Removable: ${plan.removableCount}`);
  writeLine(stdout, `  Skipped: ${plan.skippedCount}`);
  for (const item of plan.items) {
    writeLine(
      stdout,
      `    ${item.action} ${item.provider} ${item.kind}: ${item.path} state=${item.state} cleanupSafe=${item.cleanupSafe} source=${item.sourceControl ?? "none"}`,
    );
    if (item.blocker) {
      writeLine(stdout, `      Refused: ${item.blocker}`);
    } else {
      writeLine(stdout, `      ${item.reason}`);
    }
  }
  for (const nextAction of plan.nextActions) {
    writeLine(stdout, `  Next: ${nextAction}`);
  }
}

function printProjectAgentProjectionCleanupApplyResult(
  result: NexusAgentProjectionCleanupApplyResult,
  parsed: ParsedProjectAgentProjectionCleanupCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: result.status === "completed",
    mode: "apply",
    projectRoot: result.projectRoot,
    result,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus agent workspaceion cleanup apply: ${result.status}.`);
  writeLine(stdout, `  Removed: ${result.removed.length}`);
  for (const item of result.removed) {
    writeLine(stdout, `    ${item.provider} ${item.kind}: ${item.path}`);
  }
  writeLine(stdout, `  Skipped: ${result.skipped.length}`);
  for (const item of result.skipped) {
    writeLine(
      stdout,
      `    ${item.provider} ${item.kind}: ${item.path} (${item.blocker ?? "not removable"})`,
    );
  }
  for (const error of result.errors) {
    writeLine(stdout, `  Error: ${error.path}: ${error.message}`);
  }
  for (const nextAction of result.nextActions) {
    writeLine(stdout, `  Next: ${nextAction}`);
  }
}

function printProjectTrackerConfigureResult(
  result: ConfigureNexusProjectTrackerResult,
  parsed: ParsedProjectTrackerConfigureCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus workspace tracker configured.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Provider: ${result.workTracking.provider}`);
}

function printProjectTrackerLinkResult(
  result: LinkNexusProjectTrackerResult,
  parsed: ParsedProjectTrackerLinkCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus workspace tracker linked.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Tracker project: ${result.vibeKanbanProjectId}`);
}

function printSetupFlowListResult(
  flows: NexusSetupFlowSummary[],
  parsed: ParsedSetupListCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, flows };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus setup flows: ${flows.length}`);
  for (const flow of flows) {
    writeLine(stdout, `  ${flow.id}: ${flow.title}`);
  }
}

function printSetupPlanResult(
  plan: NexusSetupPlan,
  parsed: ParsedSetupPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus setup plan: ${plan.flow.id}.`);
  if (plan.project) {
    writeLine(stdout, `  Project: ${plan.project.id} (${plan.project.name})`);
  }
  writeLine(stdout, `  Platform: ${plan.platform}`);
  writeLine(stdout, `  Steps: ${plan.steps.length}`);
  for (const step of plan.steps) {
    writeLine(stdout, `    ${step.id} [${step.kind}/${step.scope}] ${step.title}`);
  }
  if (plan.nextActions.length > 0) {
    writeLine(stdout, `  Next action: ${plan.nextActions[0]}`);
  }
}

function printSetupCheckResult(
  check: NexusSetupCheck,
  parsed: ParsedSetupCheckCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, check };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus setup check: ${check.status}.`);
  writeLine(stdout, `  Flow: ${check.flow.id}`);
  writeLine(stdout, `  Workspace root: ${check.projectRoot}`);
  for (const result of check.checks) {
    writeLine(stdout, `    ${result.id}: ${result.status} - ${result.summary}`);
  }
  if (check.nextActions.length > 0) {
    writeLine(stdout, `  Next action: ${check.nextActions[0]}`);
  }
}

function printSetupReadinessResult(
  report: NexusProjectSetupReadinessReport,
  parsed: ParsedSetupReadinessCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: report.verdict !== "blocked",
    report,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus setup readiness: ${report.verdict}.`);
  writeLine(stdout, `  Workspace root: ${report.projectRoot}`);
  for (const check of report.checks) {
    writeLine(stdout, `    ${check.id}: ${check.status} - ${check.summary}`);
  }
  if (report.actions.length > 0) {
    writeLine(stdout, `  Next action: ${report.actions[0]!.action}`);
  }
}

function printSetupRecordResult(
  result: RecordNexusSetupStepResult,
  parsed: ParsedSetupRecordCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus setup step recorded.");
  writeLine(stdout, `  Flow: ${parsed.flowId}`);
  writeLine(stdout, `  Step: ${parsed.stepId}`);
  writeLine(stdout, `  Status: ${parsed.status}`);
  writeLine(stdout, `  State: ${result.statePath}`);
}

function printCoordinationStatusResult(
  status: NexusCoordinationStatus,
  parsed: ParsedCoordinationStatusCommand,
  stdout: TextWriter,
): void {
  const detail = cliOutputDetail(parsed);
  const payload = {
    ok: true,
    detail,
    status: detail === "full" ? status : summarizeCoordinationStatus(status),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination status.");
  writeLine(stdout, `  Project: ${status.project.id}`);
  writeLine(stdout, `  Component: ${status.component.id}`);
  writeLine(
    stdout,
    `  Coordination tracker: ${status.coordinationTracker.trackerId} (${status.coordinationTracker.provider})`,
  );
  if (status.workItem) {
    writeLine(stdout, `  Work item: ${status.workItem.id} ${status.workItem.title}`);
  }
  writeLine(stdout, `  Repository: ${status.git.repositoryPath ?? "not resolved"}`);
  writeLine(stdout, `  Branch: ${status.git.branch ?? "unknown"}`);
  printAuthorityComponentSummary(status.authority, stdout);
  writeLine(
    stdout,
    `  Dirty: ${status.git.dirty === null ? "unknown" : String(status.git.dirty)}`,
  );
  writeLine(
    stdout,
    `  Pushed: ${status.git.pushed === null ? "unknown" : String(status.git.pushed)}`,
  );
  writeLine(stdout, `  Active leases: ${status.leases.activeCount}`);
  writeLine(stdout, `  Handoffs: ${status.handoffs.records.length}`);
  if (!status.handoffs.available) {
    writeLine(stdout, "  Handoff storage: incomplete");
    if (status.handoffs.capability.reason) {
      writeLine(stdout, `  Handoff blocker: ${status.handoffs.capability.reason}`);
    }
  }
  writeLine(stdout, `  Next action: ${status.nextAction}`);
}

function printCoordinationHandoffResult(
  result: NexusCoordinationHandoffResult,
  parsed: ParsedCoordinationHandoffCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination handoff recorded.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Component: ${result.component.id}`);
  writeLine(stdout, `  Work item: ${result.record.workItemId}`);
  if (result.comment?.trackerRef) {
    writeLine(
      stdout,
      `  Coordination tracker: ${result.comment.trackerRef.trackerId} (${result.comment.trackerRef.provider})`,
    );
  }
  writeLine(stdout, `  Status: ${result.record.status}`);
  writeLine(stdout, `  Branch: ${result.record.branch ?? "unknown"}`);
  if (result.blockedMutation) {
    writeLine(stdout, `  Blocked: ${result.blockedMutation.action}`);
    if (result.blockedMutation.fallbackSuggestion) {
      writeLine(stdout, `  Fallback: ${result.blockedMutation.fallbackSuggestion}`);
    }
  }
  if (result.lease) {
    writeLine(stdout, `  Lease: ${result.lease.id}`);
  }
  if (result.comment) {
    writeLine(stdout, `  Comment: ${result.comment.id}`);
  }
}

function printCoordinationIntegrationPlan(
  plan: NexusCoordinationIntegrationPlan,
  parsed: ParsedCoordinationIntegrateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination integration plan.");
  writeLine(stdout, `  Project: ${plan.project.id}`);
  writeLine(stdout, `  Component: ${plan.component.id}`);
  writeLine(stdout, `  Target: ${plan.target.ref}`);
  if (plan.handoffs.tracker) {
    writeLine(
      stdout,
      `  Coordination tracker: ${plan.handoffs.tracker.trackerId} (${plan.handoffs.tracker.provider})`,
    );
  }
  if (!plan.handoffs.available) {
    writeLine(stdout, "  Handoff storage: incomplete");
    if (plan.handoffs.capability.reason) {
      writeLine(stdout, `  Handoff blocker: ${plan.handoffs.capability.reason}`);
    }
  }
  printAuthorityComponentSummary(plan.authority, stdout);
  writeLine(stdout, `  Handoff branches: ${plan.branches.length}`);
  writeLine(
    stdout,
    `  Conflicts: ${plan.branches.filter((branch) => branch.merge.status === "conflict").length}`,
  );
  writeLine(stdout, `  Decision conflicts: ${plan.decisionConflicts.length}`);
  if (plan.suggestedOrder.length > 0) {
    writeLine(stdout, "  Suggested order:");
    for (const step of plan.suggestedOrder) {
      writeLine(stdout, `    ${step.direction}`);
    }
  }
  writeLine(stdout, `  Next action: ${plan.nextAction}`);
}

function printCoordinationIntegrationError(
  error: unknown,
  parsed: ParsedCoordinationIntegrateCommand,
  stdout: TextWriter,
  stderr: TextWriter,
): void {
  const payload = { ok: false, ...nexusCoordinationErrorPayload(error) };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stderr, payload.error);
  for (const diagnostic of payload.diagnostics ?? []) {
    writeLine(
      stderr,
      `  Component: ${diagnostic.componentId}; tracker: ${
        diagnostic.trackerId ?? "default"
      }; provider: ${diagnostic.provider ?? "unknown"}`,
    );
    if (diagnostic.storePath) {
      writeLine(stderr, `  Store: ${diagnostic.storePath}`);
    }
    writeLine(stderr, `  Stage: ${diagnostic.operation}/${diagnostic.stage}`);
    writeLine(stderr, `  Recovery: ${diagnostic.recovery}`);
  }
}

function printCoordinationCleanupPlan(
  plan: NexusCleanupPlan,
  parsed: ParsedCoordinationCleanupPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination cleanup plan.");
  writeLine(stdout, `  Project: ${plan.project.id}`);
  writeLine(stdout, `  Candidates: ${plan.summary.total}`);
  writeLine(stdout, `  Safe: ${plan.summary.safe}`);
  writeLine(stdout, `  Blocked: ${plan.summary.blocked}`);
  writeLine(stdout, `  Needs rescue: ${plan.summary.needsRescue}`);
  for (const candidate of plan.candidates) {
    writeLine(
      stdout,
      `    ${candidate.id}: ${candidate.classifications.join(", ")} - ${
        candidate.safeToDelete ? "safe" : "blocked"
      }`,
    );
  }
}

function printCoordinationRequestResult(
  result: NexusCoordinationRequestResult,
  parsed: ParsedCoordinationRequestCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordination request recorded.");
  writeLine(stdout, `  Project: ${result.project.id}`);
  writeLine(stdout, `  Component: ${result.component.id}`);
  if (result.record.workItemId) {
    writeLine(stdout, `  Work item: ${result.record.workItemId}`);
  }
  writeLine(stdout, `  Intent: ${result.record.intent}`);
  writeLine(stdout, `  Status: ${result.record.status}`);
  writeLine(stdout, `  Target: ${result.record.target.label}`);
  writeLine(
    stdout,
    `  Provider: ${result.record.provider.provider} ${result.record.provider.surface} draft`,
  );
  if (result.comment?.trackerRef) {
    writeLine(
      stdout,
      `  Request tracker: ${result.comment.trackerRef.trackerId} (${result.comment.trackerRef.provider})`,
    );
  }
  writeLine(stdout, `  Posted: ${String(result.record.provider.posted)}`);
  if (result.comment) {
    writeLine(stdout, `  Comment: ${result.comment.id}`);
  }
}

function printWorktreePrepareResult(
  result: PrepareNexusManualWorktreeResult,
  parsed: ParsedWorktreePrepareCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...summarizeNexusManualWorktreeResult(result) };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus worktree prepared.");
  writeLine(stdout, `  Scope: ${result.scope}`);
  if (result.component) {
    writeLine(stdout, `  Component: ${result.component.id}`);
  }
  writeLine(stdout, `  Worktree: ${result.worktree.worktreePath}`);
  writeLine(stdout, `  Branch: ${result.worktree.branchName}`);
  writeLine(stdout, `  Lease: ${result.lease.id}`);
  if (result.worktree.baseRef) {
    writeLine(stdout, `  Base ref: ${result.worktree.baseRef}`);
  }
  if (result.setup.context?.context.initiativeDelivery) {
    const initiative = result.setup.context.context.initiativeDelivery;
    writeLine(stdout, `  Initiative: ${initiative.initiativeId}`);
    writeLine(stdout, `  Review target: ${initiative.branchTarget}`);
    writeLine(stdout, `  Final target: ${initiative.finalPublicationTarget}`);
  }
  for (const action of result.nextActions) {
    writeLine(stdout, `  Next: ${action}`);
  }
}

function printWorkItemCreateResult(
  item: WorkItem,
  parsed: ParsedWorkItemCreateCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItem: item };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item created.");
  writeLine(stdout, `  Id: ${item.id}`);
  writeLine(stdout, `  Title: ${item.title}`);
  writeLine(stdout, `  Status: ${item.status}`);
}

function printWorkItemDiscoveryStatusResult(
  result: NexusWorkItemDiscoveryStatus,
  parsed: ParsedWorkItemDiscoveryStatusCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus work item discovery status: ${result.project.id}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  for (const component of result.components) {
    const defaultTracker = component.defaultTracker
      ? `${component.defaultTracker.id} [${component.defaultTracker.provider}]`
      : "not configured";
    writeLine(stdout, `  Component ${component.componentId}:`);
    writeLine(stdout, `    Default tracker: ${defaultTracker}`);
    writeLine(
      stdout,
      `    Discovery roles: ${component.effectiveDiscoveryPolicy.scannedRoles.join(",")}`,
    );
    for (const tracker of component.configuredTrackers) {
      writeLine(
        stdout,
        `    ${tracker.id} [${tracker.provider}] roles=${tracker.roles.join(",")} selected=${String(tracker.selectedForDiscovery)} readable=${tracker.readable.status}`,
      );
    }
  }
  for (const warning of result.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
  for (const blocker of result.blockers) {
    writeLine(stdout, `  Blocker: ${blocker}`);
  }
}

function printWorkItemClaimNextResult(
  claim: NexusWorkItemClaimResult,
  parsed: ParsedWorkItemClaimNextCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, claim };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  if (claim.status === "claimed") {
    writeLine(stdout, "DevNexus work item claimed.");
    writeLine(stdout, `  Id: ${claim.workItem.id}`);
    writeLine(stdout, `  Title: ${claim.workItem.title}`);
    writeLine(stdout, `  Lease: ${claim.owner.leaseToken}`);
    writeLine(stdout, `  Expires: ${claim.owner.expiresAt}`);
    return;
  }
  if (claim.status === "lost_race") {
    writeLine(stdout, "DevNexus work item claim lost race.");
    writeLine(stdout, `  Candidate: ${claim.candidate.id}`);
    writeLine(stdout, `  Observed status: ${claim.observedWorkItem.status}`);
    return;
  }

  writeLine(stdout, "DevNexus work item claim found no claimable work.");
  writeLine(stdout, `  Reason: ${claim.reason}`);
  if (claim.reason === "stale_claims") {
    writeLine(stdout, `  Stale claims: ${claim.staleClaims?.length ?? 0}`);
    for (const stale of claim.staleClaims ?? []) {
      writeLine(
        stdout,
        `    ${stale.id}: ${stale.owner.hostId} ` +
          `${stale.owner.agentId ? `/${stale.owner.agentId} ` : ""}` +
          `lease ${stale.owner.leaseToken} expired ${stale.owner.expiresAt}`,
      );
    }
  }
  if (claim.reason === "active_claims") {
    writeLine(stdout, `  Active claims: ${claim.activeClaims?.length ?? 0}`);
    for (const active of claim.activeClaims ?? []) {
      writeLine(
        stdout,
        `    ${active.id}: ${active.owner.hostId} ` +
          `${active.owner.agentId ? `/${active.owner.agentId} ` : ""}` +
          `lease ${active.owner.leaseToken} expires ${active.owner.expiresAt}`,
      );
    }
  }
}

function printWorkItemListResult(
  items: WorkItem[],
  parsed: ParsedWorkItemListCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItems: items };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus work items: ${items.length}`);
  for (const item of items) {
    writeLine(stdout, `  ${item.id} [${item.status}] ${item.title}`);
  }
}

function printWorkItemGetResult(
  item: WorkItem,
  parsed: ParsedWorkItemGetCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItem: item };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus work item ${item.id}.`);
  writeLine(stdout, `  Title: ${item.title}`);
  writeLine(stdout, `  Status: ${item.status}`);
}

function printWorkItemUpdateResult(
  item: WorkItem,
  parsed: ParsedWorkItemUpdateCommand | ParsedWorkItemSetStatusCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, workItem: item };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item updated.");
  writeLine(stdout, `  Id: ${item.id}`);
  writeLine(stdout, `  Title: ${item.title}`);
  writeLine(stdout, `  Status: ${item.status}`);
}

function printWorkItemCommentResult(
  comment: WorkComment,
  parsed: ParsedWorkItemCommentCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, comment };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item comment added.");
  writeLine(stdout, `  Id: ${comment.id}`);
}

function printWorkItemLinkResult(
  result: LinkWorkItemTrackerReferenceResult,
  parsed: ParsedWorkItemLinkCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item tracker reference linked.");
  writeLine(stdout, `  Logical item: ${result.componentId}:${result.logicalItemId}`);
  writeLine(stdout, `  Tracker: ${result.reference.trackerId}`);
  writeLine(stdout, `  Item id: ${result.reference.itemId}`);
  writeLine(stdout, `  Action: ${result.action}`);
}

function printWorkItemShowLinksResult(
  result: ShowWorkItemTrackerLinksResult,
  parsed: ParsedWorkItemShowLinksCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(
    stdout,
    `DevNexus work item tracker links: ${result.references.length}`,
  );
  writeLine(stdout, `  Logical item: ${result.componentId}:${result.logicalItemId}`);
  for (const reference of result.references) {
    const numberOrKey =
      reference.itemKey ?? reference.itemNumber?.toString() ?? reference.itemId;
    writeLine(
      stdout,
      `  ${reference.trackerId} [${reference.provider}] ${numberOrKey} ${reference.webUrl ?? ""}`.trimEnd(),
    );
  }
}

function printWorkItemUnlinkResult(
  result: UnlinkWorkItemTrackerReferenceResult,
  parsed: ParsedWorkItemUnlinkCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item tracker reference unlinked.");
  writeLine(stdout, `  Logical item: ${result.componentId}:${result.logicalItemId}`);
  writeLine(stdout, `  Tracker: ${result.removedReference.trackerId}`);
  writeLine(stdout, `  Item id: ${result.removedReference.itemId}`);
  if (result.audit.reason) {
    writeLine(stdout, `  Reason: ${result.audit.reason}`);
  }
}

function printWorkItemSyncPlanResult(
  plan: WorkItemSyncPlan,
  parsed: ParsedWorkItemSyncPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item sync dry-run plan.");
  writeLine(
    stdout,
    `  Source: ${plan.sourceTracker.trackerId} [${plan.sourceTracker.provider}]`,
  );
  writeLine(
    stdout,
    `  Target: ${plan.targetTracker.trackerId} [${plan.targetTracker.provider}]`,
  );
  writeLine(stdout, `  Creates: ${plan.counts.creates}`);
  writeLine(stdout, `  Updates: ${plan.counts.updates}`);
  writeLine(stdout, `  Skips: ${plan.counts.skips}`);
  writeLine(stdout, `  Conflicts: ${plan.counts.conflicts}`);
  writeLine(stdout, `  Blockers: ${plan.counts.blockers}`);
}

function printWorkItemImportPlanResult(
  plan: WorkItemImportPlan,
  parsed: ParsedWorkItemImportPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus inbound work item import dry-run plan.");
  writeLine(
    stdout,
    `  Source: ${plan.sourceTracker.trackerId} [${plan.sourceTracker.provider}]`,
  );
  writeLine(
    stdout,
    `  Target: ${plan.targetTracker.trackerId} [${plan.targetTracker.provider}]`,
  );
  writeLine(stdout, `  Creates: ${plan.counts.creates}`);
  writeLine(stdout, `  Updates: ${plan.counts.updates}`);
  writeLine(stdout, `  Skips: ${plan.counts.skips}`);
  writeLine(stdout, `  Conflicts: ${plan.counts.conflicts}`);
  writeLine(stdout, `  Ambiguous duplicates: ${plan.counts.ambiguousDuplicates}`);
  writeLine(stdout, `  Stale links: ${plan.counts.staleLinks}`);
  writeLine(stdout, `  Blockers: ${plan.counts.blockers}`);
  if (plan.wouldChangeFiles.length > 0) {
    writeLine(stdout, "  Files that would change:");
    for (const filePath of plan.wouldChangeFiles) {
      writeLine(stdout, `    ${filePath}`);
    }
  }
}

function printWorkItemImportExecuteResult(
  run: WorkItemImportRun,
  parsed: ParsedWorkItemImportPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, run };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus inbound work item import execution.");
  writeLine(stdout, `  Status: ${run.status}`);
  writeLine(stdout, `  Created: ${run.summary.counts.created}`);
  writeLine(stdout, `  Updated: ${run.summary.counts.updated}`);
  writeLine(stdout, `  Skipped: ${run.summary.counts.skipped}`);
  writeLine(stdout, `  Conflicted: ${run.summary.counts.conflicted}`);
  writeLine(stdout, `  Ambiguous duplicates: ${run.summary.counts.ambiguousDuplicates}`);
  writeLine(stdout, `  Stale links: ${run.summary.counts.staleLinks}`);
  writeLine(stdout, `  Blocked: ${run.summary.counts.blocked}`);
  writeLine(stdout, `  Links: ${run.summary.counts.links}`);
}

function printWorkItemSyncExecuteResult(
  run: WorkItemSyncRun,
  parsed: ParsedWorkItemSyncPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, run };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus work item sync execution.");
  writeLine(stdout, `  Status: ${run.status}`);
  writeLine(stdout, `  Created: ${run.summary.counts.created}`);
  writeLine(stdout, `  Updated: ${run.summary.counts.updated}`);
  writeLine(stdout, `  Skipped: ${run.summary.counts.skipped}`);
  writeLine(stdout, `  Conflicted: ${run.summary.counts.conflicted}`);
  writeLine(stdout, `  Blocked: ${run.summary.counts.blocked}`);
  writeLine(stdout, `  Links: ${run.summary.counts.links}`);
}

function printAutomationScheduleTick(
  tick: NexusAutomationSchedulerTick,
  stdout: TextWriter,
): void {
  const runStatus = tick.run ? ` run=${tick.run.status}` : "";
  const wait = tick.waitMs === null ? "" : ` waitMs=${tick.waitMs}`;
  writeLine(
    stdout,
    `DevNexus scheduler tick ${tick.index}: ${tick.status.status} action=${tick.action}${runStatus}${wait}`,
  );
}

function printAutomationCoordinatorLoopTick(
  tick: NexusAutomationCoordinatorLoopTick,
  stdout: TextWriter,
): void {
  const runStatus = tick.run ? ` run=${tick.run.status}` : "";
  const wait = tick.waitMs === null ? "" : ` waitMs=${tick.waitMs}`;
  writeLine(
    stdout,
    `DevNexus coordinator loop tick ${tick.index}: ${tick.status.status} decision=${tick.decision.type} action=${tick.action}${runStatus}${wait}`,
  );
}

function printAutomationCoordinatorLoopProgressEvent(
  event: NexusAutomationCoordinatorLoopProgressEvent,
  stderr: TextWriter,
): void {
  writeLine(
    stderr,
    JSON.stringify({
      kind: "dev-nexus.coordinator-loop.progress",
      version: 1,
      ...event,
    }),
  );
}

function printAutomationEnqueueResult(
  result: EnqueueNexusAutomationWorkItemResult,
  parsed: ParsedAutomationEnqueueCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus automation work item enqueued.");
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Id: ${result.workItem.id}`);
  writeLine(stdout, `  Title: ${result.workItem.title}`);
  writeLine(stdout, `  Status: ${result.workItem.status}`);
}

function printAutomationHeartbeatPrepareResult(
  result: NexusAutomationHeartbeatPreparation,
  parsed: ParsedAutomationHeartbeatPrepareCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus heartbeat automation prepared.");
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Name: ${result.codexAutomation.name}`);
  writeLine(stdout, `  Kind: ${result.codexAutomation.kind}`);
  writeLine(stdout, `  Destination: ${result.codexAutomation.destination}`);
  writeLine(stdout, `  Schedule: ${result.codexAutomation.rrule}`);
  writeLine(stdout, `  Status: ${result.codexAutomation.status}`);
  for (const warning of result.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
  writeLine(stdout, "  Prompt:");
  for (const line of result.codexAutomation.prompt.split("\n")) {
    writeLine(stdout, `    ${line}`);
  }
}

function printAutomationTargetCycleListResult(
  result: {
    projectConfig: NexusProjectConfig;
    ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
  },
  parsed: ParsedAutomationTargetCycleListCommand,
  stdout: TextWriter,
): void {
  const detail = cliOutputDetail(parsed);
  const payload = {
    ok: true,
    detail,
    projectConfig:
      detail === "full"
        ? result.projectConfig
        : summarizeProjectConfigForCli(result.projectConfig),
    ledger:
      detail === "full"
        ? result.ledger
        : summarizeTargetCycleLedgerForCli(
            parsed.projectRoot,
            result.projectConfig,
            result.ledger,
          ),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus target cycles.");
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Cycles: ${result.ledger.cycles.length}`);
  const lastCycle = result.ledger.cycles.at(-1);
  if (lastCycle) {
    writeLine(stdout, `  Last cycle: ${lastCycle.id} ${lastCycle.status}`);
    if (lastCycle.summary) {
      writeLine(stdout, `  Summary: ${lastCycle.summary}`);
    }
  }
}

function printAutomationTargetCycleRecordResult(
  result: {
    projectConfig: NexusProjectConfig;
    record: NexusAutomationTargetCycleRecordInput;
    ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
  },
  parsed: ParsedAutomationTargetCycleRecordCommand,
  stdout: TextWriter,
): void {
  const detail = cliOutputDetail(parsed);
  const payload = {
    ok: true,
    detail,
    projectConfig:
      detail === "full"
        ? result.projectConfig
        : summarizeProjectConfigForCli(result.projectConfig),
    record:
      detail === "full"
        ? result.record
        : {
            id: result.record.id,
            status: result.record.status,
            runId: result.record.runId ?? null,
            targetId: result.record.targetId ?? null,
            summary: result.record.summary ?? null,
            eligibleWorkItemCount: result.record.eligibleWorkItemCount ?? null,
            workItemCount: result.record.workItems?.length ?? 0,
            blockerCount: result.record.blockers?.length ?? 0,
            noteCount: result.record.notes?.length ?? 0,
          },
    ledger:
      detail === "full"
        ? result.ledger
        : summarizeTargetCycleLedgerForCli(
            parsed.projectRoot,
            result.projectConfig,
            result.ledger,
          ),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus target cycle recorded.");
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Cycle: ${result.record.id}`);
  writeLine(stdout, `  Status: ${result.record.status}`);
  writeLine(stdout, `  Cycles recorded: ${result.ledger.cycles.length}`);
}

function printAutomationTargetReportResult(
  result: NexusAutomationTargetReport,
  parsed: ParsedAutomationTargetReportCommand,
  stdout: TextWriter,
): void {
  const detail = cliOutputDetail(parsed);
  const payload = {
    ok: true,
    detail,
    report: detail === "full" ? result : summarizeTargetReport(result),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus target report: ${result.status}.`);
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Reason: ${result.statusReason}`);
  if (result.target?.objective) {
    writeLine(stdout, `  Objective: ${result.target.objective}`);
  }
  if (result.cycleSummary) {
    writeLine(stdout, `  Target cycles: ${result.cycleSummary.cycleCount}`);
  }
  if (result.runSummary) {
    writeLine(stdout, `  Automation runs: ${result.runSummary.runCount}`);
  }
  printExternalIssueVisibilitySummary(result.externalIssueVisibility, stdout);
  writeLine(
    stdout,
    `  Relaunch decision: ${result.relaunchDecision.type} (${result.relaunchDecision.reason})`,
  );
  if (result.authority) {
    printAuthorityProjectSummary(result.authority, stdout);
  }
  const publicationTrains = result.componentProgress
    .map((component) => component.publicationTrain)
    .filter((train): train is NonNullable<typeof train> => train !== null);
  if (publicationTrains.length > 0) {
    writeLine(
      stdout,
      `  Publication trains: ${publicationTrains.length} configured, ${publicationTrains.filter((train) => train.enabled).length} enabled.`,
    );
    for (const train of publicationTrains) {
      writeLine(
        stdout,
        `    ${train.componentId}: active=${train.activeVersionId ?? "unscoped"} candidate=${train.branches.candidateBranch} integration=${train.branches.integrationBranch} tier=${train.ciTiers.defaultTier} budget=${formatPublicationTrainBudget(train)}`,
      );
      if (train.initiativeDelivery) {
        writeLine(
          stdout,
          `      Initiative delivery: topology=${train.initiativeDelivery.defaultTopology} active=${train.initiativeDelivery.activeScopeId} integration=${train.initiativeDelivery.branchPlan.integrationBranch ?? "none"} slices=${train.initiativeDelivery.branchPlan.sliceBranchPattern}`,
        );
      }
      if (train.selector.labels.length === 0) {
        writeLine(stdout, "      Selector labels: none");
      }
    }
  }
  if (result.versionPlanning) {
    writeLine(
      stdout,
      `  Version planning: ${result.versionPlanning.shownVersionCount} shown, ${result.versionPlanning.omittedVersionCount} omitted.`,
    );
    for (const version of result.versionPlanning.versions) {
      writeLine(
        stdout,
        `    ${version.id}: ${version.readiness.state}; scope ${version.scopeCounts.resolvedItemCount}/${version.scopeCounts.configuredEntryCount} resolved; target ${version.targetBranch}.`,
      );
      if (version.gateWarnings.length > 0) {
        writeLine(
          stdout,
          `      Gate warnings: ${version.gateWarnings
            .map((gate) => `${gate.kind}=${gate.status}`)
            .join(", ")}`,
        );
      }
    }
  }
  if (result.workItemSummary) {
    writeLine(
      stdout,
      `  Work item refs: ${result.workItemSummary.uniqueReferences.length}`,
    );
  }
  if (result.blockers.length > 0) {
    writeLine(stdout, `  Blockers: ${result.blockers.length}`);
  }
}

function printAutomationScheduleResult(
  result: RunNexusAutomationSchedulerResult,
  parsed: ParsedAutomationScheduleCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus automation scheduler stopped.");
  writeLine(stdout, `  Reason: ${result.stoppedReason}`);
  writeLine(stdout, `  Ticks: ${result.ticks.length}`);
  writeLine(stdout, `  Runs: ${result.runs.length}`);
  const lastTick = result.ticks.at(-1);
  if (lastTick) {
    writeLine(stdout, `  Last status: ${lastTick.status.status}`);
    writeLine(stdout, `  Last action: ${lastTick.action}`);
  }
}

function formatPublicationTrainBudget(
  train: NonNullable<
    NexusAutomationTargetReport["componentProgress"][number]["publicationTrain"]
  >,
): string {
  const budget = train.ciTiers.fullMatrixBudget;
  const interval = budget.minimumIntervalMinutes === null
    ? "interval=none"
    : `interval=${budget.minimumIntervalMinutes}m`;
  const changes = budget.minimumChangeCount === null
    ? "changes=none"
    : `changes=${budget.minimumChangeCount}`;
  return `${interval},${changes}`;
}

function printAutomationCoordinatorLoopResult(
  result: RunNexusAutomationCoordinatorLoopResult,
  parsed: ParsedAutomationCoordinatorLoopCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus coordinator loop stopped.");
  writeLine(stdout, `  Reason: ${result.stoppedReason}`);
  writeLine(stdout, `  Ticks: ${result.ticks.length}`);
  writeLine(stdout, `  Runs: ${result.runs.length}`);
  const lastTick = result.ticks.at(-1);
  if (lastTick) {
    writeLine(stdout, `  Last status: ${lastTick.status.status}`);
    writeLine(stdout, `  Last decision: ${lastTick.decision.type}`);
    writeLine(stdout, `  Last action: ${lastTick.action}`);
  }
}

function printAutomationCurrentAgentCoordinatorLoopAdoptionResult(
  result: AdoptNexusAutomationCurrentAgentFromCoordinatorLoopResult,
  parsed: ParsedAutomationCoordinatorLoopCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus current-agent coordinator-loop adoption checked.");
  writeLine(stdout, `  Decision: ${result.decision.type}`);
  writeLine(stdout, `  Action: ${result.action}`);
  writeLine(stdout, `  Proceed: ${result.shouldProceed ? "yes" : "no"}`);
  if (result.adoption) {
    writeLine(stdout, `  Run: ${result.adoption.runId}`);
    if (result.adoption.contextFile) {
      writeLine(stdout, `  Context: ${result.adoption.contextFile}`);
    }
    if (result.adoption.resultFile) {
      writeLine(stdout, `  Result file: ${result.adoption.resultFile}`);
    }
  }
  if (result.targetCycle) {
    writeLine(stdout, `  Target cycle: ${result.targetCycle.id} ${result.targetCycle.status}`);
  }
}

function printAutomationCurrentAgentAdoptionResult(
  result: AdoptNexusAutomationCurrentAgentResult,
  parsed: ParsedAutomationCurrentAgentAdoptCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus current-agent adoption ${result.status}.`);
  writeLine(stdout, `  Run: ${result.runId}`);
  writeLine(stdout, `  Proceed: ${result.shouldProceed ? "yes" : "no"}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  if (result.contextFile) {
    writeLine(stdout, `  Context: ${result.contextFile}`);
  }
  if (result.resultFile) {
    writeLine(stdout, `  Result file: ${result.resultFile}`);
  }
}

function printAutomationCurrentAgentRecordResult(
  result: ReturnType<typeof recordNexusAutomationCurrentAgentAdoptionResult>,
  parsed: ParsedAutomationCurrentAgentRecordCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus current-agent adoption recorded ${result.status}.`);
  writeLine(stdout, `  Run: ${result.runId}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  writeLine(stdout, `  Result file: ${result.resultFile}`);
  if (result.targetCycle) {
    writeLine(stdout, `  Target cycle: ${result.targetCycle.id} ${result.targetCycle.status}`);
  }
}

function printAutomationRunOnceResult(
  result: RunNexusAutomationOnceResult,
  parsed: ParsedAutomationRunOnceCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus automation run ${result.status}.`);
  writeLine(stdout, `  Run: ${result.runId}`);
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  if (result.workItem) {
    writeLine(stdout, `  Work item: ${result.workItem.id} ${result.workItem.title}`);
  }
  if (result.worktree) {
    writeLine(stdout, `  Worktree: ${result.worktree.worktreePath}`);
    writeLine(stdout, `  Branch: ${result.worktree.branchName}`);
  }
  if (result.execution) {
    writeLine(
      stdout,
      `  Verification: ${result.execution.verification.length} record(s)`,
    );
    writeLine(stdout, `  Commits: ${result.execution.commitIds.length}`);
  }
}

function printAutomationAgentLaunchResult(
  result: RunNexusAutomationAgentLaunchOnceResult,
  parsed: ParsedAutomationRunOnceCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus automation agent launch ${result.status}.`);
  writeLine(stdout, `  Run: ${result.runId}`);
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  writeLine(stdout, `  Eligible work items: ${result.eligibleWorkItems.length}`);
  if (result.contextFile) {
    writeLine(stdout, `  Context: ${result.contextFile}`);
  }
  if (result.resultFile) {
    writeLine(stdout, `  Result file: ${result.resultFile}`);
  }
  if (result.launch?.verification) {
    writeLine(stdout, `  Verification: ${result.launch.verification.length} record(s)`);
  }
  if (result.launch?.commitIds) {
    writeLine(stdout, `  Commits: ${result.launch.commitIds.length}`);
  }
}

function printAutomationStatusResult(
  result: NexusAutomationStatus,
  parsed: ParsedAutomationStatusCommand,
  stdout: TextWriter,
): void {
  const detail = cliOutputDetail(parsed);
  const payload = {
    ok: true,
    detail,
    ...(detail === "full" ? result : summarizeAutomationStatus(result)),
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus automation status: ${result.status}.`);
  writeLine(stdout, `  Project: ${projectLabel(result.projectConfig)}`);
  writeLine(stdout, `  Summary: ${result.summary}`);
  if (result.target) {
    writeLine(stdout, `  Target state: ${result.target.statePath}`);
    if (result.target.objective) {
      writeLine(stdout, `  Target objective: ${result.target.objective}`);
    }
  }
  if (result.agent) {
    if (result.agent.coordinatorProfileId) {
      writeLine(
        stdout,
        `  Coordinator profile: ${result.agent.coordinatorProfileId}`,
      );
    }
    writeLine(
      stdout,
      `  Max concurrent subagents: ${result.agent.maxConcurrentSubagents}`,
    );
  }
  if (result.publication.length > 0) {
    writeLine(stdout, `  Publication policies: ${result.publication.length}`);
    for (const publication of result.publication) {
      writeLine(stdout, `    ${formatPublicationStatus(publication)}`);
    }
  }
  if (result.currentActors.length > 0) {
    writeLine(stdout, `  Current actors: ${result.currentActors.length}`);
    for (const actor of result.currentActors) {
      writeLine(
        stdout,
        `    ${actor.componentId}: ${actor.status} actor=${actor.expectedActorId ?? "unknown"} profile=${actor.profileId ?? "none"} roles=${actor.roles.length > 0 ? actor.roles.join(",") : "none"}`,
      );
      for (const warning of actor.warnings) {
        writeLine(stdout, `      Warning: ${warning}`);
      }
    }
  }
  printAuthorityProjectSummary(result.authority, stdout);
  if (result.externalIssueVisibility) {
    printExternalIssueVisibilitySummary(result.externalIssueVisibility, stdout);
  }
  if (result.selectedWorkItem) {
    writeLine(
      stdout,
      `  Selected work item: ${result.selectedWorkItem.id} ${result.selectedWorkItem.title}`,
    );
  }
  if (result.eligibleWorkItems) {
    writeLine(stdout, `  Eligible work items: ${result.eligibleWorkItems.length}`);
  }
  if (result.targetCycles) {
    writeLine(stdout, `  Target cycles: ${result.targetCycles.cycleCount}`);
    if (result.targetCycles.lastCycle) {
      writeLine(
        stdout,
        `  Last target cycle: ${result.targetCycles.lastCycle.id} ${result.targetCycles.lastCycle.status}`,
      );
    }
  }
  if (result.candidateCount !== null) {
    writeLine(stdout, `  Candidates: ${result.candidateCount}`);
  }
  if (result.lock) {
    writeLine(stdout, `  Lock: ${result.lock.status}`);
  }
  if (result.ledger) {
    writeLine(stdout, `  Runs recorded: ${result.ledger.runs.length}`);
    const lastRun = result.ledger.runs.at(-1);
    if (lastRun) {
      writeLine(
        stdout,
        `  Last run: ${lastRun.id} ${lastRun.status} ${lastRun.summary ?? ""}`.trimEnd(),
      );
    }
  }
}

function formatPublicationStatus(publication: NexusPublicationStatus): string {
  const actor = formatPublicationActor(publication.actor);
  const gitIdentity = formatPublicationGitIdentity(publication.gitIdentity);
  const upstream = publication.git.upstream ?? "none";
  const pushUrl = publication.git.pushUrl ?? "unknown";
  const checkStatus = publication.blocking ? "blocked" : "ok";

  return [
    `${publication.componentId}:`,
    `remote=${publication.git.remoteName ?? "none"}`,
    `upstream=${upstream}`,
    `pushUrl=${pushUrl}`,
    `actor=${actor}`,
    `gitIdentity=${gitIdentity}`,
    `checks=${checkStatus}`,
  ].join(" ");
}

function formatPublicationGitIdentity(identity: NexusGitIdentityStatus): string {
  const expected = identity.expected
    ? `${identity.expected.name ?? "unknown"}<${identity.expected.email ?? "unknown"}>`
    : "none";
  const observed =
    identity.observed.name || identity.observed.email
      ? `${identity.observed.name ?? "unknown"}<${identity.observed.email ?? "unknown"}>`
      : identity.observed.source;

  return `${expected}->${observed}:${identity.status}`;
}

function formatPublicationActor(actor: NexusPublicationActorStatus): string {
  const expected = actor.expected
    ? [
        actor.expected.kind,
        actor.expected.provider ?? "unknown-provider",
        actor.expected.handle ?? actor.expected.id ?? "unknown-actor",
      ].join(":")
    : "none";
  const observed = actor.observed
    ? `${actor.observed.provider}:${actor.observed.handle}`
    : actor.status;

  return `${expected}->${observed}`;
}

function printAuthorityProjectSummary(
  authority: NexusAuthorityProjectSummary,
  stdout: TextWriter,
): void {
  writeLine(stdout, `  Authority: ${authority.components.length} component(s)`);
  for (const component of authority.components) {
    printAuthorityComponentSummary(component, stdout, "    ");
  }
}

function printAuthorityComponentSummary(
  authority: NexusAuthorityComponentSummary,
  stdout: TextWriter,
  indent = "  ",
): void {
  const allowed = authority.keyAllowedActions.length > 0
    ? authority.keyAllowedActions.join(",")
    : "none";
  const blocked = authority.blockedActions.length > 0
    ? authority.blockedActions.join(",")
    : "none";
  const fallback = authority.fallbackActions.length > 0
    ? authority.fallbackActions.join(",")
    : "none";
  const bindings = authority.roleBindings.length > 0
    ? authority.roleBindings
        .map((binding) => binding.roles.join(","))
        .join(";")
    : "none";

  writeLine(
    stdout,
    `${indent}${authority.componentId}: actor=${authority.actor.actorId ?? "unknown"} profile=${authority.authProfile?.id ?? "none"} roles=${authority.roles.join(",") || "none"} bindings=${bindings} allowed=${allowed} blocked=${blocked} fallback=${fallback}`,
  );
}

function printAutomationEligibleWorkResult(
  result: NexusEligibleWorkSummary,
  parsed: ParsedAutomationEligibleWorkCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus eligible work: ${result.eligibleWorkItemCount}.`);
  writeLine(stdout, `  Mode: ${result.mode}`);
  if (result.importCandidateWorkItemCount > 0) {
    writeLine(
      stdout,
      `  Import candidates: ${result.importCandidateWorkItemCount}`,
    );
  }
  if (result.excludedWorkItemCount > 0) {
    writeLine(stdout, `  Visible excluded: ${result.excludedWorkItemCount}`);
    const categorySummary = formatCountRecord(result.excludedCategoryCounts);
    if (categorySummary) {
      writeLine(stdout, `  Excluded categories: ${categorySummary}`);
    }
  }
  if (result.staleInProgressWorkItemCount > 0) {
    writeLine(
      stdout,
      `  Stale in-progress coordinator-owned work: ${result.staleInProgressWorkItemCount}`,
    );
  }
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(stdout, `  Status: ${result.status}`);
  printExternalIssueVisibilitySummary(result.externalIssueVisibility, stdout);
  for (const warning of result.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
  for (const blocker of result.blockers) {
    writeLine(stdout, `  Blocker: ${blocker}`);
  }
  if (result.selector) {
    writeLine(stdout, `  Selector: ${formatAutomationSelector(result.selector)}`);
  }
  for (const component of result.components) {
    const counts = [
      component.importCandidateWorkItems.length > 0
        ? `import ${component.importCandidateWorkItems.length}`
        : null,
      component.excludedWorkItemCount > 0
        ? `excluded ${component.excludedWorkItemCount}`
        : null,
      component.staleInProgressWorkItems.length > 0
        ? `stale ${component.staleInProgressWorkItems.length}`
        : null,
    ].filter((count) => count !== null);
    writeLine(
      stdout,
      `  ${component.componentId} (${component.componentName}): ${component.workItems.length}${counts.length > 0 ? ` (${counts.join(", ")})` : ""}`,
    );
    for (const item of component.workItems) {
      writeLine(stdout, `    ${item.id} [${item.status}] ${item.title}`);
    }
    for (const item of component.importCandidateWorkItems) {
      writeLine(
        stdout,
        `    ${item.id} [${item.status}] import-only ${item.title}`,
      );
    }
    for (const tracker of component.trackerResults) {
      if (tracker.excludedCount === 0) {
        continue;
      }
      writeLine(
        stdout,
        `    tracker ${tracker.trackerId}: excluded ${tracker.excludedCount}${formatExclusionReasonCounts(tracker.exclusionReasonCounts)}`,
      );
    }
    for (const item of component.excludedWorkItems) {
      writeLine(
        stdout,
        `    ${item.id} [${item.status}] excluded ${item.title} (${item.reasons.join("; ")})`,
      );
    }
    for (const item of component.staleInProgressWorkItems) {
      writeLine(
        stdout,
        `    ${item.id} [${item.status}] stale coordinator-owned ${item.title}`,
      );
    }
  }
}

function formatExclusionReasonCounts(
  reasonCounts: Record<string, number>,
): string {
  const summary = formatCountRecord(reasonCounts);
  if (!summary) {
    return "";
  }

  return ` (${summary})`;
}

function formatCountRecord(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return "";
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
}

function printExternalIssueVisibilitySummary(
  visibility: NexusExternalIssueVisibilitySummary,
  stdout: TextWriter,
): void {
  writeLine(stdout, `  External issue visibility: ${visibility.summary}`);
}

function printAutomationAgentProfilesResult(
  result: NexusAutomationAgentProfileSummary,
  parsed: ParsedAutomationAgentProfilesCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus agent profiles.");
  writeLine(stdout, `  Project: ${result.project.id} (${result.project.name})`);
  writeLine(
    stdout,
    `  Automation: ${result.automationEnabled ? result.automationMode : "disabled"}`,
  );
  if (result.coordinatorProfileId) {
    writeLine(stdout, `  Coordinator profile: ${result.coordinatorProfileId}`);
  }
  if (result.maxConcurrentSubagents !== null) {
    writeLine(
      stdout,
      `  Max concurrent subagents: ${result.maxConcurrentSubagents}`,
    );
  }
  if (result.safety) {
    writeLine(
      stdout,
      `  Safety: ${result.safety.profile} hostMutation=${result.safety.allowHostMutation} dependencyInstall=${result.safety.allowDependencyInstall} liveServices=${result.safety.allowLiveServices}`,
    );
  }
  writeLine(stdout, `  Profiles: ${result.profiles.length}`);
  for (const profile of result.profiles) {
    const appServerSummary = profile.appServer
      ? [
          `appServer=${profile.appServer.mode}`,
          `appServerCommand=${profile.appServer.commandConfigured ? "yes" : "no"}`,
          `appServerArgs=${profile.appServer.argsCount}`,
          `endpoint=${profile.appServer.endpointScope}`,
          `ephemeralThread=${profile.appServer.ephemeralThreadDefault ? "yes" : "no"}`,
          `hostLocalHints=${profile.appServer.hostLocalSafetyHints.length}`,
        ].join(" ")
      : "";
    writeLine(
      stdout,
      [
        `    ${profile.id}`,
        `executor=${profile.executor}`,
        `mode=${profile.executorMode ?? "none"}`,
        `model=${profile.model ?? "none"}`,
        `version=${profile.version ?? "none"}`,
        `variant=${profile.variant ?? "none"}`,
        `reasoning=${profile.reasoning ?? "none"}`,
        `intelligence=${profile.intelligence ?? "none"}`,
        `intendedUse=${profile.intendedUse}`,
        `safety=${profile.safety.profile}`,
        `command=${profile.commandConfigured ? "yes" : "no"}`,
        `args=${profile.argsCount}`,
        appServerSummary,
      ].filter(Boolean).join(" "),
    );
  }
  writeLine(stdout, `  Plugin capabilities: ${result.pluginCapabilities.length}`);
  for (const plugin of result.pluginCapabilities) {
    writeLine(
      stdout,
      `    ${plugin.pluginId} capabilities=${plugin.capabilityCount}`,
    );
  }
}

function printAutomationAppServerProbeResult(
  result: CodexAppServerInitializeProbeReport,
  parsed: ParsedAutomationAppServerProbeCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: result.status === "ready", probe: result };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, `DevNexus Codex app-server probe: ${result.status}.`);
  writeLine(stdout, `  Profile: ${result.profileId}`);
  writeLine(
    stdout,
    `  Transport: ${result.transportMode} endpoint=${result.endpointScope}`,
  );
  writeLine(stdout, `  Client: ${result.clientIdentity.name}`);
  writeLine(stdout, `  Codex version: ${result.codexVersion ?? "unknown"}`);
  writeLine(
    stdout,
    `  Advertised methods: ${result.advertisedMethods.length > 0 ? result.advertisedMethods.join(", ") : "none"}`,
  );
  writeLine(stdout, "  Required capabilities:");
  for (const capability of result.requiredCapabilities) {
    writeLine(
      stdout,
      `    ${capability.capability}: ${capability.status}${capability.method ? ` (${capability.method})` : ""}`,
    );
  }
  writeLine(stdout, "  Optional capabilities:");
  for (const capability of result.optionalCapabilities) {
    writeLine(
      stdout,
      `    ${capability.capability}: ${capability.status}${capability.method ? ` (${capability.method})` : ""}`,
    );
  }
  if (result.blockerSummary) {
    writeLine(
      stdout,
      `  Blocker: ${result.blockerKind ?? "unknown"} - ${result.blockerSummary}`,
    );
  }
}

function formatAutomationSelector(
  selector: NonNullable<NexusEligibleWorkSummary["selector"]>,
): string {
  const parts: string[] = [];
  if (selector.statuses.length > 0) {
    parts.push(`status=${selector.statuses.join(",")}`);
  }
  if (selector.labels.length > 0) {
    parts.push(`label=${selector.labels.join(",")}`);
  }
  if (selector.excludeLabels.length > 0) {
    parts.push(`excludeLabel=${selector.excludeLabels.join(",")}`);
  }
  if (selector.assignees.length > 0) {
    parts.push(`assignee=${selector.assignees.join(",")}`);
  }
  if (selector.search) {
    parts.push(`search=${selector.search}`);
  }
  parts.push(`limit=${selector.limit}`);

  return parts.length > 0 ? parts.join(" ") : "none";
}

function projectLabel(config: NexusProjectConfig): string {
  return `${config.id} (${config.name})`;
}

function automationConfigForProjectRoot(projectRoot: string): {
  projectConfig: NexusProjectConfig;
  automationConfig: NonNullable<NexusProjectConfig["automation"]>;
} {
  const projectConfig = loadProjectConfig(path.resolve(projectRoot));
  const automationConfig = projectConfig.automation;
  if (!automationConfig) {
    throw new Error("Workspace automation is not configured");
  }

  return {
    projectConfig,
    automationConfig,
  };
}

function printProjectStatusText(
  project: Pick<NexusProjectStatusBase, "id" | "name" | "projectRoot">,
  stdout: TextWriter,
): void {
  writeLine(stdout, `  Id: ${project.id}`);
  writeLine(stdout, `  Name: ${project.name}`);
  writeLine(stdout, `  Root: ${project.projectRoot}`);
}

function fileProjectHomeStore(): NexusProjectHomeStore<NexusHomeConfigBase> {
  return {
    resolveHomePath: resolveNexusHome,
    loadHomeConfig: (homePath) =>
      loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
    saveHomeConfig: (homePath, registry) =>
      saveNexusHomeConfigFile(
        homePath,
        registry,
        validateNexusHomeConfigBase,
      ),
  };
}

function resolvedCommandHomePath(homePath: string | undefined): string {
  return resolveNexusHome(homePath ?? defaultNexusHomePath());
}

function optionalCommandHomeConfig(
  homePath: string | undefined,
): NexusHomeConfigBase | null {
  try {
    const resolvedHomePath = resolvedCommandHomePath(homePath);
    return fileProjectHomeStore().loadHomeConfig(resolvedHomePath);
  } catch {
    return null;
  }
}

function resolveProjectStatusForCli(
  parsed: ParsedProjectStatusCommand,
): NexusProjectStatusBase {
  if (parsed.homePath) {
    return getNexusProjectStatus({
      homePath: resolvedCommandHomePath(parsed.homePath),
      homeStore: fileProjectHomeStore(),
      project: parsed.project,
    }).project;
  }

  try {
    return buildNexusProjectStatusForPath(parsed.project, {
      homeConfig: optionalCommandHomeConfig(undefined),
    });
  } catch (pathError) {
    try {
      return getNexusProjectStatus({
        homePath: resolvedCommandHomePath(undefined),
        homeStore: fileProjectHomeStore(),
        project: parsed.project,
      }).project;
    } catch {
      throw pathError;
    }
  }
}

async function resolveProjectHostingStatusForCli(
  parsed: ParsedProjectHostingCommand,
  dependencies: DevNexusCliDependencies,
): Promise<ProjectHostingStatusCliResult> {
  const projectRoot = path.resolve(parsed.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const authProfiles = hostingAuthProfilesForCli(projectConfig, parsed.homePath);
  const localRemotes = hostingLocalGitRemotes(projectRoot, dependencies.gitRunner);
  const status = await statusNexusProjectHosting({
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    hosting: projectConfig.hosting,
    ...(authProfiles.length > 0 ? { authProfiles } : {}),
    ...(localRemotes ? { localRemotes } : {}),
    ...(dependencies.hostingProvider
      ? { provider: dependencies.hostingProvider }
      : {}),
  });

  return {
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    status,
  };
}

function hostingAuthProfilesForCli(
  projectConfig: NexusProjectConfig,
  homePath: string | undefined,
): NexusHostingAuthProfileConfig[] {
  const homeConfig = optionalCommandHomeConfig(homePath ?? projectConfig.home ?? undefined);
  return homeConfig?.authProfiles ?? [];
}

function hostingLocalGitRemotes(
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

function hostingLocalRemoteCommandRunner(
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

function statusQuery(statuses: WorkStatus[]): WorkStatus | WorkStatus[] | undefined;
function statusQuery(
  statuses: WorkStatusQuery[],
): WorkStatusQuery | WorkStatusQuery[] | undefined;
function statusQuery(
  statuses: WorkStatusQuery[],
): WorkStatusQuery | WorkStatusQuery[] | undefined {
  if (statuses.length === 0) {
    return undefined;
  }

  return statuses.length === 1 ? statuses[0] : statuses;
}

const openWorkStatuses: WorkStatus[] = [
  "todo",
  "ready",
  "in_progress",
  "blocked",
];

function workItemSyncPolicyFromParsed(
  parsed: ParsedWorkItemSyncPlanCommand,
  mode: "dry_run" | "execute",
): WorkItemSyncPolicyConfig {
  return defaultWorkItemSyncPolicy({
    sourceTrackerId: parsed.sourceTrackerId,
    targetTrackerId: parsed.targetTrackerId,
    ...(parsed.direction ? { direction: parsed.direction } : {}),
    filters: {
      ...(parsed.openOnly || parsed.statuses.length > 0
        ? {
            status: statusQuery(
              parsed.openOnly ? openWorkStatuses : parsed.statuses,
            ),
          }
        : {}),
      ...(parsed.labels.length > 0 ? { labels: parsed.labels } : {}),
      ...(parsed.assignees.length > 0 ? { assignees: parsed.assignees } : {}),
      ...(parsed.search ? { search: parsed.search } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    },
    ...(parsed.fields.length > 0 ? { fieldSet: parsed.fields } : {}),
    ...(parsed.commentPolicy
      ? { commentPolicy: { mode: parsed.commentPolicy } }
      : {}),
    statusMapping: parsed.statusMapping,
    ...(parsed.conflictPolicy
      ? { conflictPolicy: { mode: parsed.conflictPolicy } }
      : {}),
    writePolicy: {
      mode,
      ...(parsed.writeCreates ? { creates: parsed.writeCreates } : {}),
      ...(parsed.writeUpdates ? { updates: parsed.writeUpdates } : {}),
      ...(parsed.credentials ? { credentials: parsed.credentials } : {}),
      ...(parsed.policyReason !== undefined
        ? { reason: parsed.policyReason }
        : {}),
    },
  });
}

function workItemImportPolicyFromParsed(
  parsed: ParsedWorkItemImportPlanCommand,
  mode: "dry_run" | "execute",
): WorkItemImportPolicyConfig {
  return defaultWorkItemImportPolicy({
    sourceTrackerId: parsed.sourceTrackerId,
    targetTrackerId: parsed.targetTrackerId,
    ...(parsed.direction ? { direction: parsed.direction } : {}),
    filters: {
      ...(parsed.statuses.length > 0
        ? { status: statusQuery(parsed.statuses) }
        : {}),
      ...(parsed.labels.length > 0 ? { labels: parsed.labels } : {}),
      ...(parsed.assignees.length > 0 ? { assignees: parsed.assignees } : {}),
      ...(parsed.search ? { search: parsed.search } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    },
    ...(parsed.fields.length > 0 ? { fieldSet: parsed.fields } : {}),
    statusMapping: parsed.statusMapping,
    ...(parsed.conflictPolicy
      ? { conflictPolicy: { mode: parsed.conflictPolicy } }
      : {}),
    writePolicy: {
      mode,
      ...(parsed.writeCreates ? { creates: parsed.writeCreates } : {}),
      ...(parsed.writeUpdates ? { updates: parsed.writeUpdates } : {}),
      ...(parsed.writeLinks ? { links: parsed.writeLinks } : {}),
      ...(parsed.credentials ? { credentials: parsed.credentials } : {}),
      ...(parsed.policyReason !== undefined
        ? { reason: parsed.policyReason }
        : {}),
    },
    ...(parsed.fingerprints.length > 0
      ? { fingerprints: parsed.fingerprints }
      : {}),
  });
}

function workItemImportExecutionAuthorityFromProject(
  projectRoot: string,
  componentId?: string,
): WorkItemImportExecutionAuthorityInput {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const projectConfig = loadProjectConfig(resolvedProjectRoot);
  const component = componentId
    ? resolveProjectComponents(resolvedProjectRoot, projectConfig).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(resolvedProjectRoot, projectConfig);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot: resolvedProjectRoot,
    projectConfig,
  });
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: projectConfig.authority,
    componentId: component.id,
    publication,
    authProfiles,
    repository: component.remoteUrl,
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

function parseWorkStatus(value: string, optionName: string): WorkStatus {
  if (
    value === "todo" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done" ||
    value === "wont_do"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be a valid work status`);
}

function parseWorkStatusQuery(value: string, optionName: string): WorkStatusQuery {
  if (value === "open" || value === "closed") {
    return value;
  }

  return parseWorkStatus(value, optionName);
}

function parseStaleClaimPolicy(
  value: string,
  optionName: string,
): NexusWorkItemStaleClaimPolicy {
  if (value === "report" || value === "reclaim") {
    return value;
  }

  throw new Error(`${optionName} must be report or reclaim`);
}

function parseStatusMapEntry(
  value: string,
  optionName: string,
): [WorkStatus, WorkStatus] {
  const separator = value.includes(":") ? ":" : "=";
  const [source, target, extra] = value.split(separator);
  if (!source || !target || extra !== undefined) {
    throw new Error(`${optionName} must use source:target`);
  }

  return [
    parseWorkStatus(source, `${optionName} source`),
    parseWorkStatus(target, `${optionName} target`),
  ];
}

function parseCurrentAgentResultStatus(
  value: string,
  optionName: string,
): NexusAutomationCurrentAgentAdoptionResultStatus {
  if (
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be a valid current-agent result status`);
}

function parseVerificationStatus(
  value: string,
  optionName: string,
): NonNullable<
  NonNullable<NexusAutomationCurrentAgentAdoptionResultInput["verification"]>[number]["status"]
> {
  if (value === "passed" || value === "failed" || value === "not_run") {
    return value;
  }

  throw new Error(`${optionName} must be a valid verification status`);
}

function parsePublicationDecisionType(
  value: string,
  optionName: string,
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

  throw new Error(`${optionName} must be a valid publication decision type`);
}

function parseTargetCycleStatus(
  value: string,
  optionName: string,
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

  throw new Error(`${optionName} must be a valid target cycle status`);
}

function parseTargetCycleWorkItemStatus(
  value: string,
  optionName: string,
): NexusAutomationTargetCycleWorkItemStatus {
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

  throw new Error(`${optionName} must be a valid target cycle work item status`);
}

function parseTargetCycleWorkItem(
  value: string,
  optionName: string,
): NexusAutomationTargetCycleWorkItemInput {
  const separator = value.indexOf(":");
  if (separator < 0) {
    if (!value.trim()) {
      throw new Error(`${optionName} must be a non-empty work item id`);
    }

    return {
      id: value.trim(),
      cycleStatus: "selected",
    };
  }

  const componentId = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!componentId || !id) {
    throw new Error(`${optionName} must be <component-id:id> or <id>`);
  }

  return {
    componentId,
    id,
    cycleStatus: "selected",
  };
}

function lastParsedTargetCycleWorkItem(
  parsed: Partial<ParsedAutomationTargetCycleRecordCommand>,
  optionName: string,
): NexusAutomationTargetCycleWorkItemInput {
  const item = parsed.workItems?.at(-1);
  if (!item) {
    throw new Error(`${optionName} requires a preceding --work-item`);
  }

  return item;
}

function parseTrackerProvider(
  value: string,
  optionName: string,
): ParsedProjectTrackerConfigureCommand["provider"] {
  if (
    value === "local" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be local, github, gitlab, or jira`);
}

function parseSetupPlatform(
  value: string,
  optionName: string,
): NexusSetupPlatform {
  if (
    value === "auto" ||
    value === "macos" ||
    value === "windows" ||
    value === "linux"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be auto, macos, windows, or linux`);
}

function parseSetupRecordedStepStatus(
  value: string,
  optionName: string,
): NexusSetupRecordedStepStatus {
  if (
    value === "pending" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${optionName} must be pending, completed, blocked, or skipped`);
}

function printCliAuthorityBlock(
  block: NexusAuthorityMutationBlock,
  parsed: { json?: boolean },
  dependencies: DevNexusCliDependencies,
): 1 {
  const payload = {
    ok: false,
    error: "authority_mutation_blocked",
    blockedMutation: block,
  };
  if (parsed.json) {
    writeJson(dependencies.stdout ?? process.stdout, payload);
  } else {
    const stderr = dependencies.stderr ?? process.stderr;
    writeLine(stderr, block.reason);
    if (block.fallbackSuggestion) {
      writeLine(stderr, `Fallback: ${block.fallbackSuggestion}`);
    }
  }

  return 1;
}

function argvRequestsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

function argvRequestsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function cliErrorPayload(error: unknown): {
  ok: false;
  error: { code: string; message: string };
} | Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as { ok?: unknown }).ok === false
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not a structured DevNexus error payload.
  }

  return {
    ok: false,
    error: {
      code: "cli_error",
      message,
    },
  };
}

function projectSetupApplyNextActions(
  result: NexusProjectSetupApplyResult,
): string[] {
  return buildNexusProjectSetupApplyNextActions(result, {
    quoteArgument: shellQuoteArgument,
  });
}

if (isCliEntrypoint(import.meta.url)) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
