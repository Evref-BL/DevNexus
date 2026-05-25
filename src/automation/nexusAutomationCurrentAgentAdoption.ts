import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  acquireNexusAutomationRunLock,
  appendNexusAutomationRunRecord,
  buildNexusAutomationWorkItemQuery,
  eligibleNexusAutomationWorkItems,
  evaluateNexusAutomationLedgerBackoff,
  readNexusAutomationRunLedger,
  releaseNexusAutomationRunLock,
  type AcquireNexusAutomationRunLockResult,
  type NexusAutomationRunLedger,
  type NexusAutomationRunStatus,
} from "./nexusAutomation.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  summarizeNexusAuthorityForProject,
  type NexusAuthorityProjectSummary,
} from "../authority/nexusAuthority.js";
import {
  normalizeNexusAutomationAgentPolicy,
  type NexusAutomationAgentPolicy,
} from "./nexusAutomationAgentProfile.js";
import type { GitRunner } from "../worktrees/gitWorktreeService.js";
import {
  generateNexusAutomationAgentRunId,
  preflightNexusAutomationAgentLaunch,
  type NexusAutomationAgentLaunchComponentContext,
  type NexusAutomationAgentLaunchComponentProvider,
  type NexusAutomationAgentLaunchWorkItemClaim,
} from "./nexusAutomationAgentLaunch.js";
import type {
  NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationEligibleWorkItems.js";
import type {
  NexusAutomationPreflightCheck,
  NexusAutomationProviderContext,
  NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import {
  getNexusAutomationStatus,
  readNexusAutomationStatusLock,
  type NexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  summarizeNexusAutomationWorkTrackers,
} from "./nexusAutomationWorkTrackerSummary.js";
import {
  readNexusAutomationTargetContext,
  type NexusAutomationTargetContext,
} from "./nexusAutomationTarget.js";
import {
  readNexusAutomationTargetCycleLedger,
  recordNexusAutomationTargetCycleRecord,
  type NexusAutomationTargetCycleRecord,
  type NexusAutomationTargetCycleStatus,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
  type NexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  buildNexusExternalIssueVisibilitySummary,
  type NexusExternalIssueVisibilitySummary,
} from "../operations/nexusExternalIssueVisibility.js";
import {
  getNexusPublicationStatuses,
  loadNexusPublicationAuthProfiles,
  publicationCommandEnvironment,
  publicationEnvironmentVariables,
  publicationPreflightChecks,
  resolveNexusPublicationPolicy,
  type NexusPublicationActorRunner,
} from "../publication/nexusPublicationPolicy.js";
import type { NexusHostingAuthProfileConfig } from "../project/nexusProjectHosting.js";
import {
  projectPluginCapabilityProjections,
  type NexusPluginCapabilityProjection,
} from "../project/nexusPluginCapabilities.js";
import {
  buildNexusRunnerProfilePolicySummary,
  type NexusRunnerProfilePolicySummary,
} from "../remote-execution/nexusRunnerProfile.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  claimNexusEligibleWorkItem,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimOwnerInput,
  type NexusWorkItemClaimResult,
} from "../work-items/nexusWorkItemClaim.js";
import {
  automationComponentEligibleWorkItemsForClaim as componentEligibleWorkItemsForClaim,
  automationWorkItemClaimFromResult as currentAgentWorkItemClaim,
  automationWorkItemClaimSkipSummary,
  blockedAutomationWorkItemClaim as blockedWorkItemClaim,
  disabledAutomationWorkItemClaim as disabledWorkItemClaim,
} from "./nexusAutomationWorkItemClaimContext.js";
import {
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "../work-items/workTrackingProviderService.js";
import type {
  WorkItem,
  WorkItemQuery,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "../work-items/workTrackingTypes.js";
import {
  isAsciiIdentifierSegmentCharacter,
  isLowerAsciiIdentifierSegmentCharacter,
  replaceRunsWithHyphen,
  trimHyphens,
} from "../runtime/nexusTextNormalization.js";
import type {
  WorktreePublicationDecisionInput,
  WorktreeVerificationInput,
  WorktreeVerificationStatus,
} from "../worktrees/worktreeExecutionMetadata.js";

export type NexusAutomationCurrentAgentAdoptionStatus =
  | "started"
  | "blocked"
  | "failed"
  | "skipped";

export type NexusAutomationCurrentAgentAdoptionResultStatus =
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type NexusAutomationCurrentAgentCoordinatorLoopAction =
  | "adopted"
  | "waited"
  | "skipped"
  | "blocked"
  | "stopped";

export type NexusAutomationCurrentAgentCoordinatorLoopDecisionType =
  | "launch"
  | "wait"
  | "skip"
  | "block"
  | "fail"
  | "stop";

export interface NexusAutomationCurrentAgentCoordinatorLoopDecision {
  type: NexusAutomationCurrentAgentCoordinatorLoopDecisionType;
  reason: string;
  nextTickNotBefore: string | null;
}

export interface NexusAutomationCurrentAgentResultContract {
  file: string;
  requiredFields: string[];
  optionalFields: string[];
  statuses: NexusAutomationCurrentAgentAdoptionResultStatus[];
  verificationStatuses: WorktreeVerificationStatus[];
  publicationDecisionTypes: WorktreePublicationDecisionInput["type"][];
}

export interface NexusAutomationCurrentAgentAdoptionContext {
  version: 1;
  runId: string;
  startedAt: string;
  projectRoot: string;
  sourceRoot: string;
  project: {
    id: string;
    name: string;
    componentCount: number;
  };
  components: NexusAutomationAgentLaunchComponentContext[];
  automation: {
    mode: "agent_launch";
    selectorQuery: WorkItemQuery;
    eligibleWorkItemCount: number;
  };
  adoption: {
    mode: "current_agent";
    coordinatorLoop: boolean;
    metadataFile: string;
    targetCycleId: string | null;
  };
  target: NexusAutomationTargetContext;
  agent: {
    coordinatorProfileId: string | null;
    maxConcurrentSubagents: number;
    safety: NexusAutomationAgentPolicy["safety"];
    coordinatorProfile: NexusAutomationAgentPolicy["coordinatorProfile"];
    profiles: NexusAutomationAgentPolicy["profiles"];
  };
  runnerProfiles: NexusRunnerProfilePolicySummary[];
  pluginCapabilities: NexusPluginCapabilityProjection[];
  authority: NexusAuthorityProjectSummary;
  result: NexusAutomationCurrentAgentResultContract;
  eligibleWorkItems: WorkItem[];
  workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null;
  externalIssueVisibility: NexusExternalIssueVisibilitySummary;
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  safety: NexusAutomationConfig["safety"];
  publication: NexusAutomationConfig["publication"];
}

export interface NexusAutomationCurrentAgentAdoptionMetadata {
  version: 1;
  runId: string;
  startedAt: string;
  owner: string | null;
  projectRoot: string;
  sourceRoot: string;
  contextFile: string;
  resultFile: string;
  targetCycleId: string | null;
  coordinatorLoop: boolean;
}

export interface AdoptNexusAutomationCurrentAgentOptions {
  projectRoot: string;
  homePath?: string;
  runId?: string;
  owner?: string | null;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  publicationActorRunner?: NexusPublicationActorRunner;
  now?: () => Date | string;
  env?: NodeJS.ProcessEnv;
  workItemClaimOwner?: NexusWorkItemClaimOwnerInput;
  claimAuthority?: NexusWorkItemClaimAuthority;
  workItemClaimLeaseTokenFactory?: () => string;
  targetCycleId?: string | null;
  coordinatorLoop?: boolean;
}

export interface AdoptNexusAutomationCurrentAgentResult {
  runId: string;
  projectRoot: string;
  sourceRoot: string | null;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig | null;
  status: NexusAutomationCurrentAgentAdoptionStatus;
  shouldProceed: boolean;
  reused: boolean;
  summary: string;
  ledger: NexusAutomationRunLedger | null;
  lock: AcquireNexusAutomationRunLockResult | null;
  preflight: NexusAutomationPreflightCheck[];
  selectorQuery: WorkItemQuery | null;
  eligibleWorkItems: WorkItem[];
  workItemClaim?: NexusAutomationAgentLaunchWorkItemClaim | null;
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  components: ResolvedNexusProjectComponent[];
  contextFile: string | null;
  resultFile: string | null;
  metadataFile: string | null;
  environment: NodeJS.ProcessEnv | null;
  result: NexusAutomationCurrentAgentResultContract | null;
}

export interface AdoptNexusAutomationCurrentAgentFromCoordinatorLoopOptions
  extends AdoptNexusAutomationCurrentAgentOptions {
  intervalMs?: number;
  runIdPrefix?: string;
}

export interface AdoptNexusAutomationCurrentAgentFromCoordinatorLoopResult {
  projectRoot: string;
  startedAt: string;
  finishedAt: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  decision: NexusAutomationCurrentAgentCoordinatorLoopDecision;
  action: NexusAutomationCurrentAgentCoordinatorLoopAction;
  shouldProceed: boolean;
  waitMs: number | null;
  adoption: AdoptNexusAutomationCurrentAgentResult | null;
  targetCycle: NexusAutomationTargetCycleRecord | null;
}

export interface NexusAutomationCurrentAgentAdoptionResultInput {
  status: NexusAutomationCurrentAgentAdoptionResultStatus;
  summary: string;
  commitIds?: string[];
  verification?: WorktreeVerificationInput[];
  publicationDecision?: WorktreePublicationDecisionInput;
  error?: string | null;
}

export interface RecordNexusAutomationCurrentAgentAdoptionResultOptions {
  projectRoot: string;
  runId: string;
  now?: () => Date | string;
  result?: NexusAutomationCurrentAgentAdoptionResultInput;
  resultFile?: string;
}

export interface RecordNexusAutomationCurrentAgentAdoptionResult {
  runId: string;
  projectRoot: string;
  sourceRoot: string | null;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig | null;
  status: NexusAutomationCurrentAgentAdoptionResultStatus;
  summary: string;
  ledger: NexusAutomationRunLedger;
  contextFile: string;
  resultFile: string;
  metadataFile: string;
  result: NexusAutomationCurrentAgentAdoptionResultInput;
  targetCycle: NexusAutomationTargetCycleRecord | null;
  releasedLock: boolean;
}

interface CurrentAgentAdoptionFiles {
  launchDir: string;
  contextFile: string;
  resultFile: string;
  metadataFile: string;
}

export class NexusAutomationCurrentAgentAdoptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationCurrentAgentAdoptionError";
  }
}

export async function adoptNexusAutomationCurrentAgent(
  options: AdoptNexusAutomationCurrentAgentOptions,
): Promise<AdoptNexusAutomationCurrentAgentResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const runId = options.runId ?? generateNexusAutomationAgentRunId(options.now);
  let sourceRoot: string | null = null;
  let components: ResolvedNexusProjectComponent[] = [];
  let lock: AcquireNexusAutomationRunLockResult | null = null;
  let ledger: NexusAutomationRunLedger | null = null;
  let preflight: NexusAutomationPreflightCheck[] = [];
  let selectorQuery: WorkItemQuery | null = null;
  let eligibleWorkItems: WorkItem[] = [];
  let workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null = null;
  let componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[] = [];
  let contextFile: string | null = null;
  let resultFile: string | null = null;
  let metadataFile: string | null = null;
  let reused = false;

  const inactiveAutomation = currentAgentInactiveAutomation(automationConfig);
  if (inactiveAutomation) {
    return adoptionResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: inactiveAutomation.status,
      shouldProceed: false,
      reused,
      summary: inactiveAutomation.summary,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      metadataFile,
      environment: null,
      result: null,
    });
  }
  assertCurrentAgentActiveAutomationConfig(automationConfig);

  const startedAt = currentIso(options.now);
  ledger = readNexusAutomationRunLedger(projectRoot, automationConfig);
  const existingTerminalRun = [...ledger.runs]
    .reverse()
    .find((run) => run.id === runId);
  if (existingTerminalRun) {
    return adoptionResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: existingTerminalRun.status === "completed" ? "skipped" : existingTerminalRun.status,
      shouldProceed: false,
      reused: true,
      summary: `Automation run ${runId} is already recorded as ${existingTerminalRun.status}`,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      metadataFile,
      environment: null,
      result: null,
    });
  }

  const acquiredLock = acquireOrReuseNexusAutomationRunLock({
    projectRoot,
    config: automationConfig,
    runId,
    owner: options.owner ?? null,
    now: startedAt,
  });
  lock = acquiredLock;
  reused = acquiredLock.reused;

  try {
    const backoff = evaluateNexusAutomationLedgerBackoff(
      automationConfig,
      ledger,
      startedAt,
    );
    if (!backoff.shouldRun) {
      const summary = backoff.reason ?? "Automation retry backoff is active";
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: startedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "skipped",
          startedAt,
          finishedAt: startedAt,
          summary,
          nextRunNotBefore: backoff.retryAfter,
        },
      });
      releaseNexusAutomationRunLock({ projectRoot, config: automationConfig, runId });
      return adoptionResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
        shouldProceed: false,
        reused,
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        workItemClaim,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        metadataFile,
        environment: null,
        result: null,
      });
    }

    components = resolveProjectComponents(projectRoot, projectConfig);
    sourceRoot = resolvePrimaryProjectComponent(projectRoot, projectConfig).sourceRoot;
    const componentProviders = await createCurrentAgentComponentProviders({
      options,
      projectRoot,
      projectConfig,
      components,
    });
    if (componentProviders.length === 0) {
      const summary = "No workspace component has work tracking configured";
      preflight = [
        {
          name: "workTracking",
          status: "failed",
          message: summary,
        },
      ];
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: startedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "blocked",
          startedAt,
          finishedAt: startedAt,
          sourceRoot,
          summary,
          error: summary,
        },
      });
      releaseNexusAutomationRunLock({ projectRoot, config: automationConfig, runId });
      return adoptionResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
        shouldProceed: false,
        reused,
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        metadataFile,
        environment: null,
        result: null,
      });
    }

    const authProfiles = loadNexusPublicationAuthProfiles({
      projectRoot,
      projectConfig,
      homePath: options.homePath,
    });
    const publication = getNexusPublicationStatuses({
      projectRoot,
      projectConfig,
      components,
      action: "status",
      authProfiles,
      gitRunner: options.gitRunner,
      actorRunner: options.publicationActorRunner,
    });
    preflight = [
      ...preflightNexusAutomationAgentLaunch({
      components,
      componentProviders,
      automationConfig,
      }),
      ...publicationPreflightChecks(publication),
    ];
    const failedChecks = preflight.filter((check) => check.status === "failed");
    if (failedChecks.length > 0) {
      const summary = failedChecks.map((check) => check.message).join("; ");
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: startedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "blocked",
          startedAt,
          finishedAt: startedAt,
          sourceRoot,
          summary,
          error: summary,
        },
      });
      releaseNexusAutomationRunLock({ projectRoot, config: automationConfig, runId });
      return adoptionResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
        shouldProceed: false,
        reused,
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        metadataFile,
        environment: null,
        result: null,
      });
    }

    const reusableFiles = currentAgentAdoptionFiles({ projectRoot, runId });
    if (
      reused &&
      fs.existsSync(reusableFiles.contextFile) &&
      fs.existsSync(reusableFiles.metadataFile)
    ) {
      contextFile = reusableFiles.contextFile;
      resultFile = reusableFiles.resultFile;
      metadataFile = reusableFiles.metadataFile;
      const context = readCurrentAgentAdoptionContext(contextFile);
      selectorQuery = context.automation.selectorQuery;
      eligibleWorkItems = context.eligibleWorkItems;
      workItemClaim = context.workItemClaim ?? null;
      componentEligibleWorkItems = context.componentEligibleWorkItems;
      const resultContract = currentAgentResultContract(resultFile);
      return adoptionResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "started",
        shouldProceed: true,
        reused,
        summary: "Current agent adoption context reused",
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        workItemClaim,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        metadataFile,
        environment: currentAgentAdoptionEnvironment(
          options.env ?? process.env,
          {
            runId,
            startedAt: context.startedAt,
            projectRoot,
            sourceRoot,
            components,
            automationConfig,
            eligibleWorkItems,
            workItemClaim,
            contextFile,
            resultFile,
            metadataFile,
            targetCycleId: context.adoption.targetCycleId,
          },
        ),
        result: resultContract,
      });
    }

    selectorQuery = buildNexusAutomationWorkItemQuery(automationConfig);
    componentEligibleWorkItems = await listEligibleWorkItemsByComponent(
      componentProviders,
      selectorQuery,
      automationConfig,
      projectRoot,
    );
    eligibleWorkItems = componentEligibleWorkItems.flatMap(
      (component) => component.workItems,
    );
    const claimOutcome = await currentAgentAdoptionClaimOutcome({
      options,
      runId,
      projectRoot,
      projectConfig,
      automationConfig,
      sourceRoot,
      startedAt,
      reused,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      metadataFile,
    });
    workItemClaim = claimOutcome.workItemClaim;
    eligibleWorkItems = claimOutcome.eligibleWorkItems;
    componentEligibleWorkItems = claimOutcome.componentEligibleWorkItems;
    if (claimOutcome.result) {
      return claimOutcome.result;
    }
    if (eligibleWorkItems.length === 0) {
      const summary = "No eligible work item matched the automation selector";
      const finishedAt = currentIso(options.now);
      ledger = appendNexusAutomationRunRecord({
        projectRoot,
        config: automationConfig,
        now: finishedAt,
        record: {
          id: runId,
          projectId: projectConfig.id,
          status: "skipped",
          startedAt,
          finishedAt,
          sourceRoot,
          summary,
        },
      });
      releaseNexusAutomationRunLock({ projectRoot, config: automationConfig, runId });
      return adoptionResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
        shouldProceed: false,
        reused,
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        metadataFile,
        environment: null,
        result: null,
      });
    }

    const files = currentAgentAdoptionFiles({ projectRoot, runId });
    contextFile = files.contextFile;
    resultFile = files.resultFile;
    metadataFile = files.metadataFile;
    const resultContract = currentAgentResultContract(resultFile);
    const metadata: NexusAutomationCurrentAgentAdoptionMetadata = {
      version: 1,
      runId,
      startedAt,
      owner: options.owner ?? null,
      projectRoot,
      sourceRoot,
      contextFile,
      resultFile,
      targetCycleId: options.targetCycleId ?? null,
      coordinatorLoop: options.coordinatorLoop ?? false,
    };
    if (!reused || !fs.existsSync(contextFile) || !fs.existsSync(metadataFile)) {
      writeCurrentAgentAdoptionContext({
        contextFile,
        context: buildCurrentAgentAdoptionContext({
          runId,
          startedAt,
          projectRoot,
          sourceRoot,
          components,
          projectConfig,
          automationConfig,
          selectorQuery,
          eligibleWorkItems,
          workItemClaim,
          componentEligibleWorkItems,
          authProfiles,
          resultFile,
          metadataFile,
          targetCycleId: metadata.targetCycleId,
          coordinatorLoop: metadata.coordinatorLoop,
        }),
      });
      writeCurrentAgentAdoptionMetadata(files.metadataFile, metadata);
    }

    return adoptionResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "started",
      shouldProceed: true,
      reused,
      summary: reused
        ? "Current agent adoption context reused"
        : "Current agent adoption context created",
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      workItemClaim,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      metadataFile,
      environment: currentAgentAdoptionEnvironment(
        options.env ?? process.env,
        {
          runId,
          startedAt,
          projectRoot,
          sourceRoot,
          components,
          automationConfig,
          eligibleWorkItems,
          workItemClaim,
          contextFile,
          resultFile,
          metadataFile,
          targetCycleId: metadata.targetCycleId,
        },
      ),
      result: resultContract,
    });
  } catch (error) {
    releaseNexusAutomationRunLock({ projectRoot, config: automationConfig, runId });
    throw error;
  }
}

function currentAgentInactiveAutomation(
  automationConfig: NexusAutomationConfig | null,
): {
  status: "skipped" | "blocked";
  summary: string;
} | null {
  if (!automationConfig?.enabled) {
    return {
      status: "skipped",
      summary: "Automation is not enabled for this workspace",
    };
  }
  if (automationConfig.mode !== "agent_launch") {
    return {
      status: "blocked",
      summary: "Automation mode is not agent_launch",
    };
  }
  return null;
}

function assertCurrentAgentActiveAutomationConfig(
  automationConfig: NexusAutomationConfig | null,
): asserts automationConfig is NexusAutomationConfig {
  if (!automationConfig) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "Automation config unexpectedly missing after active automation check",
    );
  }
}

interface CurrentAgentAdoptionClaimOutcome {
  workItemClaim: NexusAutomationAgentLaunchWorkItemClaim;
  eligibleWorkItems: WorkItem[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  result: AdoptNexusAutomationCurrentAgentResult | null;
}

async function currentAgentAdoptionClaimOutcome(options: {
  options: AdoptNexusAutomationCurrentAgentOptions;
  runId: string;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  sourceRoot: string;
  startedAt: string;
  reused: boolean;
  ledger: NexusAutomationRunLedger;
  lock: AcquireNexusAutomationRunLockResult;
  preflight: NexusAutomationPreflightCheck[];
  selectorQuery: WorkItemQuery;
  eligibleWorkItems: WorkItem[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  components: ResolvedNexusProjectComponent[];
  contextFile: string | null;
  resultFile: string | null;
  metadataFile: string | null;
}): Promise<CurrentAgentAdoptionClaimOutcome> {
  if (!options.automationConfig.workItemClaims.enabled) {
    return {
      workItemClaim: disabledWorkItemClaim(),
      eligibleWorkItems: options.eligibleWorkItems,
      componentEligibleWorkItems: options.componentEligibleWorkItems,
      result: null,
    };
  }

  try {
    const claim = await claimNexusEligibleWorkItem({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      components: options.components,
      automationConfig: options.automationConfig,
      homePath: options.options.homePath,
      selectorQuery: options.selectorQuery,
      provider: options.options.provider,
      providerFactory: currentAgentClaimProviderFactory({
        options: options.options,
        projectRoot: options.projectRoot,
        projectConfig: options.projectConfig,
      }),
      providerOptions: options.options.providerOptions,
      env: options.options.env,
      claimAuthority: options.options.claimAuthority,
      owner: currentAgentWorkItemClaimOwner({
        options: options.options,
        runId: options.runId,
      }),
      leaseDurationMs: options.automationConfig.workItemClaims.leaseDurationMs,
      staleClaimPolicy: options.automationConfig.workItemClaims.staleClaimPolicy,
      leaseTokenFactory: options.options.workItemClaimLeaseTokenFactory,
      now: options.options.now,
    });
    return currentAgentClaimOutcomeFromClaim(options, claim);
  } catch (error) {
    return blockedCurrentAgentClaimOutcome(options, error);
  }
}

function currentAgentClaimOutcomeFromClaim(
  options: Parameters<typeof currentAgentAdoptionClaimOutcome>[0],
  claim: NexusWorkItemClaimResult,
): CurrentAgentAdoptionClaimOutcome {
  const workItemClaim = currentAgentWorkItemClaim(claim);
  if (claim.status === "claimed") {
    return {
      workItemClaim,
      eligibleWorkItems: [claim.workItem],
      componentEligibleWorkItems: componentEligibleWorkItemsForClaim({
        componentEligibleWorkItems: options.componentEligibleWorkItems,
        claim,
      }),
      result: null,
    };
  }

  const finishedAt = currentIso(options.options.now);
  const summary = automationWorkItemClaimSkipSummary(
    workItemClaim,
    "current-agent adoption",
  );
  const ledger = appendNexusAutomationRunRecord({
    projectRoot: options.projectRoot,
    config: options.automationConfig,
    now: finishedAt,
    record: {
      id: options.runId,
      projectId: options.projectConfig.id,
      status: "skipped",
      startedAt: options.startedAt,
      finishedAt,
      sourceRoot: options.sourceRoot,
      summary,
    },
  });
  releaseNexusAutomationRunLock({
    projectRoot: options.projectRoot,
    config: options.automationConfig,
    runId: options.runId,
  });
  return {
    workItemClaim,
    eligibleWorkItems: options.eligibleWorkItems,
    componentEligibleWorkItems: options.componentEligibleWorkItems,
    result: adoptionResult({
      ...currentAgentTerminalResultBase(options, ledger),
      status: "skipped",
      summary,
      workItemClaim,
      preflight: options.preflight,
    }),
  };
}

function blockedCurrentAgentClaimOutcome(
  options: Parameters<typeof currentAgentAdoptionClaimOutcome>[0],
  error: unknown,
): CurrentAgentAdoptionClaimOutcome {
  const finishedAt = currentIso(options.options.now);
  const summary = `Work-item claim coordination blocked: ${errorMessage(error)}`;
  const workItemClaim = blockedWorkItemClaim(summary);
  const ledger = appendNexusAutomationRunRecord({
    projectRoot: options.projectRoot,
    config: options.automationConfig,
    now: finishedAt,
    record: {
      id: options.runId,
      projectId: options.projectConfig.id,
      status: "blocked",
      startedAt: options.startedAt,
      finishedAt,
      sourceRoot: options.sourceRoot,
      summary,
      error: summary,
    },
  });
  releaseNexusAutomationRunLock({
    projectRoot: options.projectRoot,
    config: options.automationConfig,
    runId: options.runId,
  });
  return {
    workItemClaim,
    eligibleWorkItems: options.eligibleWorkItems,
    componentEligibleWorkItems: options.componentEligibleWorkItems,
    result: adoptionResult({
      ...currentAgentTerminalResultBase(options, ledger),
      status: "blocked",
      summary,
      workItemClaim,
      preflight: [
        ...options.preflight,
        {
          name: "workItemClaim",
          status: "failed",
          message: summary,
        },
      ],
    }),
  };
}

function currentAgentTerminalResultBase(
  options: Parameters<typeof currentAgentAdoptionClaimOutcome>[0],
  ledger: NexusAutomationRunLedger,
): Omit<
  AdoptNexusAutomationCurrentAgentResult,
  "status" | "summary" | "preflight" | "workItemClaim"
> {
  return {
    runId: options.runId,
    projectRoot: options.projectRoot,
    sourceRoot: options.sourceRoot,
    projectConfig: options.projectConfig,
    automationConfig: options.automationConfig,
    shouldProceed: false,
    reused: options.reused,
    ledger,
    lock: options.lock,
    selectorQuery: options.selectorQuery,
    eligibleWorkItems: options.eligibleWorkItems,
    componentEligibleWorkItems: options.componentEligibleWorkItems,
    components: options.components,
    contextFile: options.contextFile,
    resultFile: options.resultFile,
    metadataFile: options.metadataFile,
    environment: null,
    result: null,
  };
}

export async function adoptNexusAutomationCurrentAgentFromCoordinatorLoop(
  options: AdoptNexusAutomationCurrentAgentFromCoordinatorLoopOptions,
): Promise<AdoptNexusAutomationCurrentAgentFromCoordinatorLoopResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const startedAt = currentIso(options.now);
  const status = await getNexusAutomationStatus({
    projectRoot,
    provider: options.provider,
    providerFactory: options.providerFactory,
    providerOptions: options.providerOptions,
    gitRunner: options.gitRunner,
    publicationActorRunner: options.publicationActorRunner,
    now: options.now,
  });
  const targetReport = buildNexusAutomationTargetReport({
    projectRoot,
    now: startedAt,
  });
  const intervalMs = options.intervalMs ?? status.automationConfig?.schedule.intervalMs;
  const runId = coordinatorLoopRunId(
    options.runIdPrefix,
    1,
    startedAt,
  );
  const cycleId = coordinatorLoopCycleId(options.runIdPrefix, 1, startedAt);

  if (!status.automationConfig?.enabled) {
    return coordinatorAdoptionResult({
      projectRoot,
      startedAt,
      finishedAt: currentIso(options.now),
      status,
      targetReport,
      decision: {
        type: "stop",
        reason: status.summary,
        nextTickNotBefore: null,
      },
      action: "stopped",
      shouldProceed: false,
      waitMs: null,
      adoption: null,
      targetCycle: null,
    });
  }

  if (!status.automationConfig.schedule.enabled || !intervalMs) {
    const decision = {
      type: "stop",
      reason: "Automation schedule is disabled for this project",
      nextTickNotBefore: null,
    } satisfies NexusAutomationCurrentAgentCoordinatorLoopDecision;
    const targetCycle = recordCoordinatorAdoptionCycle({
      projectRoot,
      status,
      targetReport,
      cycleId,
      cycleStatus: "skipped",
      startedAt,
      finishedAt: currentIso(options.now),
      summary: decision.reason,
      eligibleWorkItemCount: null,
      workItems: [],
      notes: [
        "managed-loop: decision=stop",
        "managed-loop: no coordinator adopted",
      ],
    });
    return coordinatorAdoptionResult({
      projectRoot,
      startedAt,
      finishedAt: targetCycle.finishedAt ?? startedAt,
      status,
      targetReport,
      decision,
      action: "stopped",
      shouldProceed: false,
      waitMs: null,
      adoption: null,
      targetCycle,
    });
  }

  if (status.automationConfig.mode !== "agent_launch") {
    const summary =
      "Managed coordinator adoption requires automation.mode to be agent_launch";
    const decision = {
      type: "block",
      reason: summary,
      nextTickNotBefore: null,
    } satisfies NexusAutomationCurrentAgentCoordinatorLoopDecision;
    const targetCycle = recordCoordinatorAdoptionCycle({
      projectRoot,
      status,
      targetReport,
      cycleId,
      cycleStatus: "blocked",
      startedAt,
      finishedAt: currentIso(options.now),
      summary,
      eligibleWorkItemCount: null,
      workItems: [],
      blockers: [summary],
      notes: [
        "managed-loop: decision=block",
        "managed-loop: no coordinator adopted",
      ],
    });
    return coordinatorAdoptionResult({
      projectRoot,
      startedAt,
      finishedAt: targetCycle.finishedAt ?? startedAt,
      status,
      targetReport,
      decision,
      action: "blocked",
      shouldProceed: false,
      waitMs: null,
      adoption: null,
      targetCycle,
    });
  }

  const statusBasedDecision = statusDecision(status, intervalMs, startedAt);
  const targetGate = targetReportGateDecision(targetReport);
  const decision =
    statusBasedDecision.type === "launch"
      ? targetGate ?? statusBasedDecision
      : statusBasedDecision;
  if (decision.type !== "launch") {
    const finishedAt = currentIso(options.now);
    const targetCycle = recordCoordinatorAdoptionCycle({
      projectRoot,
      status,
      targetReport,
      cycleId,
      cycleStatus: cycleStatusForDecision(decision),
      startedAt,
      finishedAt,
      summary: decision.reason,
      eligibleWorkItemCount: eligibleWorkItemCount(status),
      workItems: targetCycleWorkItems(status),
      blockers:
        decision.type === "block" || decision.type === "fail"
          ? [decision.reason]
          : [],
      nextCycleNotBefore: decision.nextTickNotBefore,
      notes: [
        `managed-loop: decision=${decision.type}`,
        "managed-loop: no coordinator adopted",
      ],
    });
    return coordinatorAdoptionResult({
      projectRoot,
      startedAt,
      finishedAt,
      status,
      targetReport,
      decision,
      action: actionForDecision(decision),
      shouldProceed: false,
      waitMs: waitMsForDecision(decision, status, intervalMs, startedAt),
      adoption: null,
      targetCycle,
    });
  }

  const adoption = await adoptNexusAutomationCurrentAgent({
    ...options,
    projectRoot,
    runId: options.runId ?? runId,
    targetCycleId: cycleId,
    coordinatorLoop: true,
  });
  const finishedAt = currentIso(options.now);
  const targetCycle = recordCoordinatorAdoptionCycle({
    projectRoot,
    status,
    targetReport,
    cycleId,
    runId: adoption.runId,
    cycleStatus: adoption.shouldProceed
      ? "dispatched"
      : targetCycleStatusForRun(adoption.status),
    startedAt,
    finishedAt: adoption.shouldProceed ? null : finishedAt,
    summary: adoption.shouldProceed ? "Current agent adoption dispatched" : adoption.summary,
    eligibleWorkItemCount: eligibleWorkItemCount(status),
    workItems: targetCycleWorkItems(status),
    blockers:
      adoption.status === "blocked" || adoption.status === "failed"
        ? [adoption.summary]
        : [],
    notes: [
      "managed-loop: decision=launch",
      adoption.shouldProceed
        ? "managed-loop: current agent adopted"
        : `managed-loop: current agent ${adoption.status}`,
    ],
  });

  return coordinatorAdoptionResult({
    projectRoot,
    startedAt,
    finishedAt,
    status,
    targetReport,
    decision,
    action: adoption.shouldProceed ? "adopted" : actionForRun(adoption.status),
    shouldProceed: adoption.shouldProceed,
    waitMs: null,
    adoption,
    targetCycle,
  });
}

export function recordNexusAutomationCurrentAgentAdoptionResult(
  options: RecordNexusAutomationCurrentAgentAdoptionResultOptions,
): RecordNexusAutomationCurrentAgentAdoptionResult {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const runId = requiredNonEmptyString(options.runId, "runId");
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  if (!automationConfig) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "Workspace automation is not configured",
    );
  }
  const files = currentAgentAdoptionFiles({ projectRoot, runId });
  const metadata = readCurrentAgentAdoptionMetadata(files.metadataFile);
  const context = readCurrentAgentAdoptionContext(files.contextFile);
  const resultFile = options.resultFile
    ? path.resolve(options.resultFile)
    : metadata.resultFile;
  const result = normalizeCurrentAgentResult(
    options.result ?? readCurrentAgentResultFile(resultFile),
  );
  const finishedAt = currentIso(options.now);
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const ledger = appendNexusAutomationRunRecord({
    projectRoot,
    config: automationConfig,
    now: finishedAt,
    record: {
      id: runId,
      projectId: projectConfig.id,
      status: result.status,
      startedAt: metadata.startedAt,
      finishedAt,
      sourceRoot: metadata.sourceRoot,
      commitIds: result.commitIds ?? [],
      summary: result.summary,
      verification: verificationRecords(result.verification, finishedAt),
      publicationDecision: publicationDecisionRecord(
        result.publicationDecision,
        finishedAt,
      ),
      error: result.error ?? null,
    },
  });
  const targetCycle = metadata.targetCycleId
    ? recordCurrentAgentAdoptionTargetCycle({
        projectRoot,
        projectConfig,
        automationConfig,
        context,
        metadata,
        status: result.status,
        summary: result.summary,
        finishedAt,
      })
    : null;
  const releasedLock = releaseNexusAutomationRunLock({
    projectRoot,
    config: automationConfig,
    runId,
  });

  return {
    runId,
    projectRoot,
    sourceRoot: metadata.sourceRoot,
    projectConfig,
    automationConfig,
    status: result.status,
    summary: result.summary,
    ledger,
    contextFile: files.contextFile,
    resultFile,
    metadataFile: files.metadataFile,
    result,
    targetCycle,
    releasedLock,
  };
}

async function createCurrentAgentComponentProviders(options: {
  options: AdoptNexusAutomationCurrentAgentOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
}): Promise<NexusAutomationAgentLaunchComponentProvider[]> {
  return Promise.all(
    options.components
      .filter((component) => component.workTracking)
      .map(async (component) => ({
        component,
        provider: await createCurrentAgentProvider({
          options: options.options,
          projectRoot: options.projectRoot,
          projectConfig: options.projectConfig,
          component,
        }),
      })),
  );
}

async function createCurrentAgentProvider(options: {
  options: AdoptNexusAutomationCurrentAgentOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): Promise<WorkTrackerProvider> {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      `Component ${options.component.id} work tracking is not configured`,
    );
  }
  if (options.options.provider) {
    return options.options.provider;
  }
  if (options.options.providerFactory) {
    return options.options.providerFactory({
      projectRoot: options.projectRoot,
      sourceRoot: options.component.sourceRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      workTracking,
    } satisfies NexusAutomationProviderContext);
  }

  return createWorkTrackerProviderAsync(workTracking as WorkTrackingConfig, {
    ...options.options.providerOptions,
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

function currentAgentClaimProviderFactory(options: {
  options: AdoptNexusAutomationCurrentAgentOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
}) {
  if (!options.options.providerFactory) {
    return undefined;
  }

  return (context: {
    component: ResolvedNexusProjectComponent;
    tracker: { workTracking: WorkTrackingConfig };
  }) =>
    options.options.providerFactory!({
      projectRoot: options.projectRoot,
      sourceRoot: context.component.sourceRoot,
      projectConfig: options.projectConfig,
      component: context.component,
      workTracking: context.tracker.workTracking,
    } satisfies NexusAutomationProviderContext);
}

function currentAgentWorkItemClaimOwner(options: {
  options: AdoptNexusAutomationCurrentAgentOptions;
  runId: string;
}): NexusWorkItemClaimOwnerInput {
  const configured = options.options.workItemClaimOwner;
  return {
    hostId: configured?.hostId ?? os.hostname(),
    agentId: configured?.agentId ?? options.runId,
    ownerId: configured?.ownerId ?? options.options.owner ?? null,
  };
}

async function listEligibleWorkItemsByComponent(
  componentProviders: NexusAutomationAgentLaunchComponentProvider[],
  selectorQuery: WorkItemQuery,
  automationConfig: NexusAutomationConfig,
  projectRoot: string,
): Promise<NexusAutomationComponentEligibleWorkItems[]> {
  const grouped: NexusAutomationComponentEligibleWorkItems[] = [];
  for (const { component, provider } of componentProviders) {
    grouped.push({
      componentId: component.id,
      workItems: eligibleNexusAutomationWorkItems(
        await provider.listWorkItems({
          ...selectorQuery,
          projectRoot,
        }),
        automationConfig,
      ),
    });
  }

  return grouped;
}

function acquireOrReuseNexusAutomationRunLock(options: {
  projectRoot: string;
  config: NexusAutomationConfig;
  runId: string;
  owner: string | null;
  now: string;
}): AcquireNexusAutomationRunLockResult & { reused: boolean } {
  const existing = readNexusAutomationStatusLock(
    options.projectRoot,
    options.config,
    options.now,
  );
  if (existing.status === "active" && existing.runId === options.runId) {
    return {
      lockPath: existing.path,
      lock: {
        runId: existing.runId,
        owner: existing.owner,
        acquiredAt: existing.acquiredAt!,
        expiresAt: existing.expiresAt!,
      },
      replacedStaleLock: false,
      reused: true,
    };
  }

  return {
    ...acquireNexusAutomationRunLock({
      projectRoot: options.projectRoot,
      config: options.config,
      runId: options.runId,
      owner: options.owner,
      now: options.now,
    }),
    reused: false,
  };
}

function buildCurrentAgentAdoptionContext(input: {
  runId: string;
  startedAt: string;
  projectRoot: string;
  sourceRoot: string;
  components: ResolvedNexusProjectComponent[];
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  selectorQuery: WorkItemQuery;
  eligibleWorkItems: WorkItem[];
  workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null;
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  authProfiles: NexusHostingAuthProfileConfig[];
  resultFile: string;
  metadataFile: string;
  targetCycleId: string | null;
  coordinatorLoop: boolean;
}): NexusAutomationCurrentAgentAdoptionContext {
  const authority = summarizeNexusAuthorityForProject({
    projectId: input.projectConfig.id,
    authority: input.projectConfig.authority,
    components: input.components.map((component) => ({
      projectId: input.projectConfig.id,
      componentId: component.id,
      componentName: component.name,
      authority: input.projectConfig.authority,
      publication: resolveNexusPublicationPolicy(input.projectConfig, component),
      authProfiles: input.authProfiles,
      safety: input.automationConfig.safety,
      tracker: component.defaultTrackerId,
      repository: component.remoteUrl,
    })),
  });

  return {
    version: 1,
    runId: input.runId,
    startedAt: input.startedAt,
    projectRoot: input.projectRoot,
    sourceRoot: input.sourceRoot,
    project: {
      id: input.projectConfig.id,
      name: input.projectConfig.name,
      componentCount: input.components.length,
    },
    components: input.components.map((component) =>
      componentContext(component, input.projectConfig, authority),
    ),
    automation: {
      mode: "agent_launch",
      selectorQuery: input.selectorQuery,
      eligibleWorkItemCount: input.eligibleWorkItems.length,
    },
    adoption: {
      mode: "current_agent",
      coordinatorLoop: input.coordinatorLoop,
      metadataFile: input.metadataFile,
      targetCycleId: input.targetCycleId,
    },
    target: readNexusAutomationTargetContext({
      projectRoot: input.projectRoot,
      config: input.automationConfig,
    }),
    agent: normalizeNexusAutomationAgentPolicy(input.automationConfig),
    runnerProfiles: buildNexusRunnerProfilePolicySummary(
      input.projectConfig.runnerProfiles,
      input.projectConfig.hosts,
    ),
    pluginCapabilities: projectPluginCapabilityProjections(input.projectConfig),
    authority,
    result: currentAgentResultContract(input.resultFile),
    eligibleWorkItems: input.eligibleWorkItems,
    workItemClaim: input.workItemClaim,
    externalIssueVisibility: buildNexusExternalIssueVisibilitySummary({
      components: input.components,
      componentEligibleWorkItems: input.componentEligibleWorkItems,
    }),
    componentEligibleWorkItems: input.componentEligibleWorkItems,
    safety: input.automationConfig.safety,
    publication: input.automationConfig.publication,
  };
}

function componentContext(
  component: ResolvedNexusProjectComponent,
  projectConfig: NexusProjectConfig,
  authority: NexusAuthorityProjectSummary,
): NexusAutomationAgentLaunchComponentContext {
  return {
    id: component.id,
    name: component.name,
    role: component.role,
    kind: component.kind,
    sourceRoot: component.sourceRoot,
    sourceRootExists: component.sourceRootExists,
    worktreesRoot: component.worktreesRoot,
    worktreesRootExists: component.worktreesRootExists,
    remoteUrl: component.remoteUrl,
    defaultBranch: component.defaultBranch,
    workTracker: {
      provider: component.workTracking?.provider ?? null,
      configured: Boolean(component.workTracking),
    },
    defaultTrackerId: component.defaultTrackerId,
    workTrackers: summarizeNexusAutomationWorkTrackers(component),
    publication: resolveNexusPublicationPolicy(projectConfig, component),
    authority:
      authority.components.find((summary) => summary.componentId === component.id) ??
      null,
    relationships: component.relationships,
  };
}

function writeCurrentAgentAdoptionContext(options: {
  contextFile: string;
  context: NexusAutomationCurrentAgentAdoptionContext;
}): void {
  fs.mkdirSync(path.dirname(options.contextFile), { recursive: true });
  fs.writeFileSync(
    options.contextFile,
    `${JSON.stringify(options.context, null, 2)}\n`,
    "utf8",
  );
}

function writeCurrentAgentAdoptionMetadata(
  metadataFile: string,
  metadata: NexusAutomationCurrentAgentAdoptionMetadata,
): void {
  fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
  fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function currentAgentAdoptionFiles(options: {
  projectRoot: string;
  runId: string;
}): CurrentAgentAdoptionFiles {
  const launchDir = path.join(
    options.projectRoot,
    ".dev-nexus",
    "automation",
    "agent-launches",
    safePathSegment(options.runId),
  );
  return {
    launchDir,
    contextFile: path.join(launchDir, "context.json"),
    resultFile: path.join(launchDir, "result.json"),
    metadataFile: path.join(launchDir, "adoption.json"),
  };
}

function currentAgentResultContract(
  resultFile: string,
): NexusAutomationCurrentAgentResultContract {
  return {
    file: resultFile,
    requiredFields: ["status", "summary"],
    optionalFields: [
      "commitIds",
      "verification",
      "publicationDecision",
      "error",
    ],
    statuses: ["completed", "failed", "blocked", "skipped"],
    verificationStatuses: ["passed", "failed", "not_run"],
    publicationDecisionTypes: [
      "not_decided",
      "local_only",
      "direct_integration",
      "review_handoff",
      "blocked",
    ],
  };
}

function currentAgentAdoptionEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  input: {
    runId: string;
    startedAt: string;
    projectRoot: string;
    sourceRoot: string;
    components: ResolvedNexusProjectComponent[];
    automationConfig: NexusAutomationConfig;
    eligibleWorkItems: WorkItem[];
    workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null;
    contextFile: string;
    resultFile: string;
    metadataFile: string;
    targetCycleId: string | null;
  },
): NodeJS.ProcessEnv {
  const target = readNexusAutomationTargetContext({
    projectRoot: input.projectRoot,
    config: input.automationConfig,
  });
  const publication = input.automationConfig.publication;
  return {
    ...baseEnv,
    ...publicationCommandEnvironment(publication, {
      projectRoot: input.projectRoot,
    }),
    ...publicationEnvironmentVariables(publication),
    DEV_NEXUS_AUTOMATION_MODE: "agent_launch",
    DEV_NEXUS_CURRENT_AGENT_ADOPTION: "true",
    DEV_NEXUS_CURRENT_AGENT_ADOPTION_FILE: input.metadataFile,
    DEV_NEXUS_RUN_ID: input.runId,
    DEV_NEXUS_STARTED_AT: input.startedAt,
    DEV_NEXUS_PROJECT_ROOT: input.projectRoot,
    DEV_NEXUS_SOURCE_ROOT: input.sourceRoot,
    DEV_NEXUS_COMPONENT_COUNT: input.components.length.toString(),
    DEV_NEXUS_COMPONENT_IDS: input.components
      .map((component) => component.id)
      .join(","),
    DEV_NEXUS_PRIMARY_COMPONENT_ID:
      input.components.find((component) => component.role === "primary")?.id ??
      input.components[0]?.id ??
      "",
    DEV_NEXUS_AGENT_CONTEXT_FILE: input.contextFile,
    DEV_NEXUS_AGENT_RESULT_FILE: input.resultFile,
    DEV_NEXUS_AGENT_RESULT_REQUIRED_FIELDS: "status,summary",
    DEV_NEXUS_AGENT_RESULT_OPTIONAL_FIELDS:
      "commitIds,verification,publicationDecision,error",
    DEV_NEXUS_TARGET_ID: input.automationConfig.target.id ?? "",
    DEV_NEXUS_TARGET_STATE_FILE: target.statePath,
    DEV_NEXUS_TARGET_CYCLE_LEDGER_FILE: target.cycleLedgerPath,
    DEV_NEXUS_TARGET_CYCLE_ID: input.targetCycleId ?? "",
    DEV_NEXUS_COORDINATOR_PROFILE_ID:
      input.automationConfig.agent.coordinatorProfileId ?? "",
    DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS:
      input.automationConfig.agent.maxConcurrentSubagents.toString(),
    DEV_NEXUS_ELIGIBLE_WORK_ITEM_COUNT: input.eligibleWorkItems.length.toString(),
    DEV_NEXUS_ELIGIBLE_WORK_ITEM_IDS: input.eligibleWorkItems
      .map((item) => item.id)
      .join(","),
    DEV_NEXUS_WORK_ITEM_CLAIM_STATUS: input.workItemClaim?.status ?? "none",
    DEV_NEXUS_CLAIMED_WORK_ITEM_ID: input.workItemClaim?.workItemId ?? "",
    DEV_NEXUS_CLAIM_COMPONENT_ID: input.workItemClaim?.componentId ?? "",
    DEV_NEXUS_CLAIM_TRACKER_ID: input.workItemClaim?.trackerId ?? "",
    DEV_NEXUS_CLAIM_LEASE_DURATION_MS:
      input.automationConfig.workItemClaims.leaseDurationMs.toString(),
    DEV_NEXUS_CLAIM_HEARTBEAT_INTERVAL_MS:
      input.automationConfig.workItemClaims.heartbeatIntervalMs.toString(),
    DEV_NEXUS_CLAIM_LEASE_TOKEN: input.workItemClaim?.owner?.leaseToken ?? "",
    DEV_NEXUS_CLAIM_HOST_ID: input.workItemClaim?.owner?.hostId ?? "",
    DEV_NEXUS_CLAIM_AGENT_ID: input.workItemClaim?.owner?.agentId ?? "",
    DEV_NEXUS_CLAIM_OWNER_ID: input.workItemClaim?.owner?.ownerId ?? "",
    DEV_NEXUS_CLAIM_EXPIRES_AT: input.workItemClaim?.owner?.expiresAt ?? "",
    DEV_NEXUS_CLAIM_AUTHORITY_KIND:
      input.workItemClaim?.authorityClaim?.authorityKind ?? "",
    DEV_NEXUS_CLAIM_FENCING_TOKEN:
      input.workItemClaim?.authorityClaim?.fencingToken.toString() ?? "",
    DEV_NEXUS_CLAIM_AUTHORITY_STATE:
      input.workItemClaim?.authorityClaim?.state ?? "",
  };
}

function readCurrentAgentAdoptionMetadata(
  metadataFile: string,
): NexusAutomationCurrentAgentAdoptionMetadata {
  if (!fs.existsSync(metadataFile)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      `Current-agent adoption metadata was not found: ${metadataFile}`,
    );
  }
  const value = JSON.parse(fs.readFileSync(metadataFile, "utf8").replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "current-agent adoption metadata must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "current-agent adoption metadata.version must be 1",
    );
  }
  return {
    version: 1,
    runId: requiredNonEmptyString(record.runId, "current-agent adoption.runId"),
    startedAt: requiredIsoString(
      record.startedAt,
      "current-agent adoption.startedAt",
    ),
    owner: optionalNullableString(record.owner) ?? null,
    projectRoot: requiredNonEmptyString(
      record.projectRoot,
      "current-agent adoption.projectRoot",
    ),
    sourceRoot: requiredNonEmptyString(
      record.sourceRoot,
      "current-agent adoption.sourceRoot",
    ),
    contextFile: requiredNonEmptyString(
      record.contextFile,
      "current-agent adoption.contextFile",
    ),
    resultFile: requiredNonEmptyString(
      record.resultFile,
      "current-agent adoption.resultFile",
    ),
    targetCycleId: optionalNullableString(record.targetCycleId) ?? null,
    coordinatorLoop: optionalBoolean(record.coordinatorLoop) ?? false,
  };
}

function readCurrentAgentAdoptionContext(
  contextFile: string,
): NexusAutomationCurrentAgentAdoptionContext {
  if (!fs.existsSync(contextFile)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      `Current-agent adoption context was not found: ${contextFile}`,
    );
  }

  return JSON.parse(
    fs.readFileSync(contextFile, "utf8").replace(/^\uFEFF/, ""),
  ) as NexusAutomationCurrentAgentAdoptionContext;
}

function readCurrentAgentResultFile(
  resultFile: string,
): NexusAutomationCurrentAgentAdoptionResultInput {
  if (!fs.existsSync(resultFile)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      `Current-agent result file was not written: ${resultFile}`,
    );
  }

  return JSON.parse(
    fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, ""),
  ) as NexusAutomationCurrentAgentAdoptionResultInput;
}

function normalizeCurrentAgentResult(
  value: unknown,
): NexusAutomationCurrentAgentAdoptionResultInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "current-agent result must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  return {
    status: normalizeCurrentAgentResultStatus(
      record.status,
      "current-agent result.status",
    ),
    summary: requiredNonEmptyString(
      record.summary,
      "current-agent result.summary",
    ),
    ...(record.commitIds === undefined
      ? {}
      : {
          commitIds: normalizeStringArray(
            record.commitIds,
            "current-agent result.commitIds",
          ),
        }),
    ...(record.verification === undefined
      ? {}
      : { verification: normalizeVerificationInputList(record.verification) }),
    ...(record.publicationDecision === undefined
      ? {}
      : {
          publicationDecision: normalizePublicationDecisionInput(
            record.publicationDecision,
          ),
        }),
    ...(record.error === undefined
      ? {}
      : { error: optionalNullableString(record.error) ?? null }),
  };
}

function normalizeVerificationInputList(
  value: unknown,
): WorktreeVerificationInput[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "current-agent result.verification must be an array",
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new NexusAutomationCurrentAgentAdoptionError(
        `current-agent result.verification[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      command: requiredNonEmptyString(
        record.command,
        `current-agent result.verification[${index}].command`,
      ),
      ...(record.status === undefined
        ? {}
        : {
            status: normalizeVerificationStatus(
              record.status,
              `current-agent result.verification[${index}].status`,
            ),
          }),
      ...(record.summary === undefined
        ? {}
        : { summary: optionalNullableString(record.summary) ?? null }),
    };
  });
}

function normalizePublicationDecisionInput(
  value: unknown,
): WorktreePublicationDecisionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "current-agent result.publicationDecision must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    type: normalizePublicationDecisionType(
      record.type,
      "current-agent result.publicationDecision.type",
    ),
    targetBranch: optionalNullableString(record.targetBranch) ?? null,
    remote: optionalNullableString(record.remote) ?? null,
    prUrl: optionalNullableString(record.prUrl) ?? null,
    reason: optionalNullableString(record.reason) ?? null,
  };
}

function verificationRecords(
  values: WorktreeVerificationInput[] | undefined,
  recordedAt: string,
) {
  return (values ?? []).map((value) => ({
    command: requiredNonEmptyString(value.command, "verification.command"),
    status: value.status ?? "passed",
    summary: optionalNullableString(value.summary) ?? null,
    recordedAt,
  }));
}

function publicationDecisionRecord(
  value: WorktreePublicationDecisionInput | undefined,
  decidedAt: string,
) {
  if (!value) {
    return null;
  }

  return {
    type: value.type,
    targetBranch: value.targetBranch ?? null,
    remote: value.remote ?? null,
    prUrl: value.prUrl ?? null,
    reason: value.reason ?? null,
    decidedAt,
  };
}

function recordCurrentAgentAdoptionTargetCycle(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  context: NexusAutomationCurrentAgentAdoptionContext;
  metadata: NexusAutomationCurrentAgentAdoptionMetadata;
  status: NexusAutomationCurrentAgentAdoptionResultStatus;
  summary: string;
  finishedAt: string;
}): NexusAutomationTargetCycleRecord {
  const existing = readNexusAutomationTargetCycleLedger(
    options.projectRoot,
    options.automationConfig,
  ).cycles.find((cycle) => cycle.id === options.metadata.targetCycleId);
  const cycleStatus = targetCycleStatusForCurrentAgentResult(options.status);
  const ledger = recordNexusAutomationTargetCycleRecord({
    projectRoot: options.projectRoot,
    config: options.automationConfig,
    now: options.finishedAt,
    record: {
      id: options.metadata.targetCycleId!,
      projectId: options.projectConfig.id,
      targetId: options.automationConfig.target.id,
      runId: options.metadata.runId,
      status: cycleStatus,
      startedAt: existing?.startedAt ?? options.metadata.startedAt,
      finishedAt: options.finishedAt,
      objective: options.automationConfig.target.objective,
      summary: options.summary,
      eligibleWorkItemCount:
        existing?.eligibleWorkItemCount ??
        options.context.eligibleWorkItems.length,
      workItems: existing?.workItems ?? contextWorkItems(options.context),
      authority: existing?.authority ?? options.context.authority,
      blockers:
        cycleStatus === "blocked" || cycleStatus === "failed"
          ? [options.summary]
          : [],
      notes: [
        ...(existing?.notes ?? []),
        `managed-loop: current agent ${options.status}`,
      ],
      nextCycleNotBefore: existing?.nextCycleNotBefore ?? null,
    },
  });

  return ledger.cycles.at(-1)!;
}

function contextWorkItems(context: NexusAutomationCurrentAgentAdoptionContext) {
  return context.componentEligibleWorkItems.flatMap((component) =>
    component.workItems.map((item) => ({
      componentId: component.componentId,
      id: item.id,
      title: item.title,
      status: item.status,
      cycleStatus: "eligible" as const,
    })),
  );
}

function statusDecision(
  status: NexusAutomationStatus,
  intervalMs: number,
  now: string,
): NexusAutomationCurrentAgentCoordinatorLoopDecision {
  if (status.status === "ready") {
    return {
      type: "launch",
      reason: status.summary,
      nextTickNotBefore: null,
    };
  }
  if (status.status === "locked") {
    return {
      type: "wait",
      reason: status.summary,
      nextTickNotBefore: status.lock?.expiresAt ?? null,
    };
  }
  if (status.status === "backoff") {
    return {
      type: "wait",
      reason: status.summary,
      nextTickNotBefore: status.backoff?.retryAfter ?? null,
    };
  }
  if (status.status === "blocked") {
    return {
      type: "block",
      reason: status.summary,
      nextTickNotBefore: null,
    };
  }
  if (status.status === "disabled") {
    return {
      type: "stop",
      reason: status.summary,
      nextTickNotBefore: null,
    };
  }

  const nextTickNotBefore =
    status.status === "idle" &&
    status.automationConfig?.target.stopWhenNoEligibleWork
      ? null
      : addMilliseconds(now, intervalMs);

  return {
    type: "skip",
    reason: status.summary,
    nextTickNotBefore,
  };
}

function targetReportGateDecision(
  report: NexusAutomationTargetReport,
): NexusAutomationCurrentAgentCoordinatorLoopDecision | null {
  if (report.relaunchDecision.type === "wait") {
    return {
      type: "wait",
      reason: report.relaunchDecision.reason,
      nextTickNotBefore: null,
    };
  }
  if (report.relaunchDecision.type === "report_blocked") {
    return {
      type: "block",
      reason: report.relaunchDecision.reason,
      nextTickNotBefore: null,
    };
  }
  if (report.relaunchDecision.type === "report_failed") {
    return {
      type: "fail",
      reason: report.relaunchDecision.reason,
      nextTickNotBefore: null,
    };
  }

  return null;
}

function waitMsForDecision(
  decision: NexusAutomationCurrentAgentCoordinatorLoopDecision,
  status: NexusAutomationStatus,
  intervalMs: number,
  now: string,
): number | null {
  if (decision.type === "block" || decision.type === "fail" || decision.type === "stop") {
    return null;
  }
  if (
    decision.type === "skip" &&
    status.status === "idle" &&
    status.automationConfig?.target.stopWhenNoEligibleWork
  ) {
    return null;
  }
  if (decision.nextTickNotBefore) {
    return delayUntil(decision.nextTickNotBefore, now);
  }

  return intervalMs;
}

function actionForDecision(
  decision: NexusAutomationCurrentAgentCoordinatorLoopDecision,
): NexusAutomationCurrentAgentCoordinatorLoopAction {
  if (decision.type === "wait") {
    return "waited";
  }
  if (decision.type === "skip") {
    return "skipped";
  }
  if (decision.type === "block" || decision.type === "fail") {
    return "blocked";
  }

  return "stopped";
}

function actionForRun(
  status: NexusAutomationCurrentAgentAdoptionStatus,
): NexusAutomationCurrentAgentCoordinatorLoopAction {
  if (status === "skipped") {
    return "skipped";
  }
  if (status === "blocked" || status === "failed") {
    return "blocked";
  }

  return "adopted";
}

function cycleStatusForDecision(
  decision: NexusAutomationCurrentAgentCoordinatorLoopDecision,
): NexusAutomationTargetCycleStatus {
  if (decision.type === "block") {
    return "blocked";
  }
  if (decision.type === "fail") {
    return "failed";
  }

  return "skipped";
}

function targetCycleStatusForRun(
  status: NexusAutomationCurrentAgentAdoptionStatus,
): NexusAutomationTargetCycleStatus {
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "failed") {
    return "failed";
  }

  return "skipped";
}

function targetCycleStatusForCurrentAgentResult(
  status: NexusAutomationCurrentAgentAdoptionResultStatus,
): NexusAutomationTargetCycleStatus {
  return status;
}

function recordCoordinatorAdoptionCycle(options: {
  projectRoot: string;
  status: NexusAutomationStatus;
  targetReport: NexusAutomationTargetReport;
  cycleId: string;
  runId?: string | null;
  cycleStatus: NexusAutomationTargetCycleStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  eligibleWorkItemCount: number | null;
  workItems: ReturnType<typeof targetCycleWorkItems>;
  blockers?: string[];
  nextCycleNotBefore?: string | null;
  notes?: string[];
}): NexusAutomationTargetCycleRecord {
  const automationConfig = options.status.automationConfig;
  if (!automationConfig) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "automationConfig is required to record target cycle facts",
    );
  }
  const ledger = recordNexusAutomationTargetCycleRecord({
    projectRoot: options.projectRoot,
    config: automationConfig,
    now: options.finishedAt ?? options.startedAt,
    record: {
      id: options.cycleId,
      projectId: options.status.projectConfig.id,
      targetId: automationConfig.target.id,
      runId: options.runId ?? null,
      status: options.cycleStatus,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      objective: automationConfig.target.objective,
      summary: options.summary,
      eligibleWorkItemCount: options.eligibleWorkItemCount,
      workItems: options.workItems,
      authority: options.status.authority,
      blockers: options.blockers ?? [],
      notes: [
        ...(options.notes ?? []),
        `managed-loop: target-report=${options.targetReport.relaunchDecision.type}`,
      ],
      nextCycleNotBefore: options.nextCycleNotBefore ?? null,
    },
  });

  return ledger.cycles.at(-1)!;
}

function targetCycleWorkItems(status: NexusAutomationStatus) {
  const grouped =
    status.componentEligibleWorkItems ??
    (status.selectedWorkItem
      ? [
          {
            componentId: primaryComponentId(status),
            workItems: [status.selectedWorkItem],
          },
        ]
      : []);

  return grouped.flatMap((component) =>
    component.workItems.map((item: WorkItem) => ({
      componentId: component.componentId,
      id: item.id,
      title: item.title,
      status: item.status,
      cycleStatus: "eligible" as const,
    })),
  );
}

function eligibleWorkItemCount(status: NexusAutomationStatus): number {
  if (status.componentEligibleWorkItems) {
    return status.componentEligibleWorkItems.reduce(
      (total, component) => total + component.workItems.length,
      0,
    );
  }
  if (status.eligibleWorkItems) {
    return status.eligibleWorkItems.length;
  }
  if (status.selectedWorkItem) {
    return 1;
  }

  return status.status === "idle" ? 0 : status.candidateCount ?? 0;
}

function primaryComponentId(status: NexusAutomationStatus): string {
  return (
    status.components.find((component) => component.role === "primary")?.id ??
    status.components[0]?.id ??
    "primary"
  );
}

function coordinatorLoopRunId(
  prefix: string | undefined,
  tickIndex: number,
  timestamp: string,
): string {
  return [
    safeIdSegment(prefix ?? "current-agent"),
    timestampSegment(timestamp),
    tickIndex.toString(),
  ].join("-");
}

function coordinatorLoopCycleId(
  prefix: string | undefined,
  tickIndex: number,
  timestamp: string,
): string {
  return `target-cycle-${coordinatorLoopRunId(prefix, tickIndex, timestamp)}`;
}

function timestampSegment(timestamp: string): string {
  return timestamp
    .replace(/^(\d{4})-(\d{2})-(\d{2})T/u, "$1$2$3-t")
    .replaceAll(":", "")
    .replace(".", "-")
    .replace(/Z$/u, "-z")
    .toLowerCase();
}

function safeIdSegment(value: string): string {
  const normalized = trimHyphens(
    replaceRunsWithHyphen(
      value.trim().toLowerCase(),
      (character) => !isLowerAsciiIdentifierSegmentCharacter(character),
    ),
  );
  if (!normalized) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "runIdPrefix must contain at least one safe character",
    );
  }

  return normalized;
}

function adoptionResult(
  result: AdoptNexusAutomationCurrentAgentResult,
): AdoptNexusAutomationCurrentAgentResult {
  return result;
}

function coordinatorAdoptionResult(
  result: AdoptNexusAutomationCurrentAgentFromCoordinatorLoopResult,
): AdoptNexusAutomationCurrentAgentFromCoordinatorLoopResult {
  return result;
}

function normalizeCurrentAgentResultStatus(
  status: unknown,
  name: string,
): NexusAutomationCurrentAgentAdoptionResultStatus {
  if (
    status === "completed" ||
    status === "blocked" ||
    status === "failed" ||
    status === "skipped"
  ) {
    return status;
  }

  throw new NexusAutomationCurrentAgentAdoptionError(
    `${name} must be completed, blocked, failed, or skipped`,
  );
}

function normalizeVerificationStatus(
  status: unknown,
  name: string,
): WorktreeVerificationStatus {
  if (status === "passed" || status === "failed" || status === "not_run") {
    return status;
  }

  throw new NexusAutomationCurrentAgentAdoptionError(
    `${name} must be passed, failed, or not_run`,
  );
}

function normalizePublicationDecisionType(
  value: unknown,
  name: string,
): WorktreePublicationDecisionInput["type"] {
  if (
    value === "not_decided" ||
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new NexusAutomationCurrentAgentAdoptionError(
    `${name} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
  );
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationCurrentAgentAdoptionError(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${name}[${index}]`),
  );
}

function safePathSegment(value: string): string {
  const normalized = trimHyphens(
    replaceRunsWithHyphen(
      value.trim(),
      (character) => !isAsciiIdentifierSegmentCharacter(character),
    ),
  );
  if (!normalized) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      "runId must contain at least one safe character",
    );
  }

  return normalized;
}

function addMilliseconds(timestamp: Date | string, ms: number): string {
  return new Date(dateFrom(timestamp, "timestamp").getTime() + ms).toISOString();
}

function delayUntil(target: Date | string, now: Date | string): number {
  return Math.max(
    0,
    dateFrom(target, "target").getTime() - dateFrom(now, "now").getTime(),
  );
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  return dateFrom(value, "now").toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dateFrom(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationCurrentAgentAdoptionError(`${name} must be a valid date`);
  }

  return date;
}

function requiredIsoString(value: unknown, name: string): string {
  const stringValue = requiredNonEmptyString(value, name);
  dateFrom(stringValue, name);

  return stringValue;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, "value");
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new NexusAutomationCurrentAgentAdoptionError("value must be a boolean");
  }

  return value;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationCurrentAgentAdoptionError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
