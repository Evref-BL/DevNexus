import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  appendNexusAutomationRunRecord,
  buildNexusAutomationWorkItemQuery,
  evaluateNexusAutomationLedgerBackoff,
  readNexusAutomationRunLedger,
  releaseNexusAutomationRunLock,
  acquireNexusAutomationRunLock,
  type AcquireNexusAutomationRunLockResult,
  type NexusAutomationRunLedger,
  type NexusAutomationRunStatus,
} from "./nexusAutomation.js";
import {
  defaultNexusAutomationCommandRunner,
  summarizeNexusAutomationCommandRunResult,
  type NexusAutomationCommandRunner,
  type NexusAutomationCommandRunResult,
} from "./nexusAutomationCommandExecutor.js";
import { nonInteractiveGitEnvironment } from "./nexusAutomationEnvironment.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  summarizeNexusAuthorityForProject,
  type NexusAuthorityComponentSummary,
  type NexusAuthorityProjectSummary,
} from "./nexusAuthority.js";
import {
  normalizeNexusAutomationAgentPolicy,
  type NexusAutomationAgentPolicy,
} from "./nexusAutomationAgentProfile.js";
import type { GitRunner } from "./gitWorktreeService.js";
import {
  projectPluginCapabilityProjections,
  type NexusPluginCapabilityProjection,
} from "./nexusPluginCapabilities.js";
import {
  buildNexusRunnerProfilePolicySummary,
  type NexusRunnerProfilePolicySummary,
} from "./nexusRunnerProfile.js";
import {
  getNexusPublicationStatuses,
  publicationEnvironmentVariables,
  publicationProcessEnvironment,
  publicationPreflightChecks,
  resolveNexusPublicationPolicy,
  type NexusPublicationActorRunner,
} from "./nexusPublicationPolicy.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  buildNexusMcpRuntimeFreshnessChecks,
  type NexusMcpRuntimeProcess,
} from "./nexusSetupAssistant.js";
import {
  preflightNexusNpmRuntimeInstall,
  type NexusNpmRuntimeCommandRunner,
} from "./nexusNpmRuntime.js";
import {
  readNexusAutomationTargetContext,
  type NexusAutomationTargetContext,
} from "./nexusAutomationTarget.js";
import {
  summarizeNexusAutomationWorkTrackers,
  type NexusAutomationWorkTrackerSummary,
} from "./nexusAutomationWorkTrackerSummary.js";
import {
  listNexusEligibleWorkByComponent,
  type NexusEligibleWorkItem,
  type NexusEligibleWorkMode,
  type NexusEligibleWorkProviderFactory,
} from "./nexusEligibleWork.js";
import type {
  NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationEligibleWorkItems.js";
import {
  claimNexusEligibleWorkItem,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityRecord,
  type NexusWorkItemClaimOwner,
  type NexusWorkItemClaimOwnerInput,
} from "./nexusWorkItemClaim.js";
import {
  automationComponentEligibleWorkItemsForClaim as componentEligibleWorkItemsForClaim,
  automationWorkItemClaimFromResult as agentLaunchWorkItemClaim,
  automationWorkItemClaimSkipSummary,
  blockedAutomationWorkItemClaim as blockedWorkItemClaim,
  disabledAutomationWorkItemClaim as disabledWorkItemClaim,
  type NexusAutomationWorkItemClaim,
  type NexusAutomationWorkItemClaimStatus,
} from "./nexusAutomationWorkItemClaimContext.js";
import {
  buildNexusExternalIssueVisibilitySummary,
  type NexusExternalIssueVisibilitySummary,
} from "./nexusExternalIssueVisibility.js";
import type {
  NexusWorkItemDiscoveryCredentialResolver,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  nexusWorkItemDiscoveryCredentialEnvironment,
} from "./nexusWorkItemDiscoveryStatus.js";
import {
  automationWorkItemDiscoveryCredentialResolver,
  automationWorkTrackerProviderOptions,
  loadNexusAutomationAuthProfiles,
} from "./nexusAutomationWorkTrackingCredentials.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import type {
  NexusAutomationPreflightCheck,
  NexusAutomationProviderContext,
  NexusAutomationPreflightStatus,
  NexusAutomationWorkTrackerProviderFactory,
} from "./nexusAutomationRunOnce.js";
import type {
  NexusAutomationCodexAppServerLaunchMetadata,
} from "./nexusAutomationAgentLaunchMetadata.js";
import {
  createWorkTrackerProviderAsync,
  type CreateWorkTrackerProviderOptions,
} from "./workTrackingProviderService.js";
import {
  buildNexusVersionPlanningSurface,
  type NexusVersionPlanningSurface,
  type NexusVersionPlanningSurfaceWorkItemInput,
} from "./nexusVersionPlanningSurface.js";
import type {
  WorkItem,
  WorkItemQuery,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";
import type {
  WorktreePublicationDecisionInput,
  WorktreeVerificationInput,
  WorktreeVerificationStatus,
} from "./worktreeExecutionMetadata.js";

export type NexusAutomationAgentLaunchStatus =
  | "completed"
  | "failed"
  | "blocked";

export type NexusAutomationAgentResultWorkItemStatus =
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export interface NexusAutomationAgentResultWorkItem {
  componentId?: string | null;
  trackerId?: string | null;
  id: string;
  status: NexusAutomationAgentResultWorkItemStatus;
  summary?: string | null;
  notes?: string | null;
}

export interface NexusAutomationAgentLaunchComponentContext {
  id: string;
  name: string;
  role: ResolvedNexusProjectComponent["role"];
  kind: ResolvedNexusProjectComponent["kind"];
  sourceRoot: string;
  sourceRootExists: boolean;
  worktreesRoot: string;
  worktreesRootExists: boolean;
  remoteUrl: string | null;
  defaultBranch: string | null;
  workTracker: {
    provider: string | null;
    configured: boolean;
  };
  defaultTrackerId: string | null;
  workTrackers: NexusAutomationWorkTrackerSummary[];
  publication: NexusAutomationConfig["publication"];
  authority: NexusAuthorityComponentSummary | null;
  relationships: ResolvedNexusProjectComponent["relationships"];
}

export type {
  NexusAutomationComponentEligibleWorkItems,
} from "./nexusAutomationEligibleWorkItems.js";

export type NexusAutomationAgentLaunchWorkItemClaimStatus =
  NexusAutomationWorkItemClaimStatus;

export type NexusAutomationAgentLaunchWorkItemClaim =
  NexusAutomationWorkItemClaim;

export interface NexusAutomationAgentLaunchContext {
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
  result: NexusAutomationAgentResultContract;
  eligibleWorkItems: WorkItem[];
  workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null;
  importCandidateWorkItems: NexusEligibleWorkItem[];
  eligibleWorkWarnings: string[];
  eligibleWorkBlockers: string[];
  externalIssueVisibility: NexusExternalIssueVisibilitySummary;
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  versionPlanning?: NexusVersionPlanningSurface;
  safety: NexusAutomationConfig["safety"];
  publication: NexusAutomationConfig["publication"];
}

export interface NexusAutomationAgentResultContract {
  file: string;
  requiredFields: string[];
  optionalFields: string[];
  statuses: NexusAutomationAgentLaunchStatus[];
  workItemStatuses: NexusAutomationAgentResultWorkItemStatus[];
  verificationStatuses: WorktreeVerificationStatus[];
  publicationDecisionTypes: WorktreePublicationDecisionInput["type"][];
}

export interface NexusAutomationAgentLaunchInput {
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
  importCandidateWorkItems: NexusEligibleWorkItem[];
  eligibleWorkWarnings: string[];
  eligibleWorkBlockers: string[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  authProfiles?: NexusHostingAuthProfileConfig[];
  contextFile: string;
  resultFile: string;
}

export interface NexusAutomationAgentLaunchResult {
  status?: NexusAutomationAgentLaunchStatus;
  summary?: string | null;
  commitIds?: string[];
  verification?: WorktreeVerificationInput[];
  publicationDecision?: WorktreePublicationDecisionInput;
  workItems?: NexusAutomationAgentResultWorkItem[];
  error?: string | null;
  codexAppServer?: NexusAutomationCodexAppServerLaunchMetadata;
}

export type {
  NexusAutomationCodexAppServerLaunchMetadata,
} from "./nexusAutomationAgentLaunchMetadata.js";

export type NexusAutomationAgentLauncher = (
  input: NexusAutomationAgentLaunchInput,
) =>
  | NexusAutomationAgentLaunchResult
  | Promise<NexusAutomationAgentLaunchResult>;

export interface CreateNexusAutomationAgentCommandLauncherOptions {
  command: string;
  commandRunner?: NexusAutomationCommandRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface RunNexusAutomationAgentLaunchOnceOptions {
  projectRoot: string;
  homePath?: string;
  runId?: string;
  owner?: string | null;
  eligibleWorkMode?: NexusEligibleWorkMode;
  env?: NodeJS.ProcessEnv;
  credentialResolver?: NexusWorkItemDiscoveryCredentialResolver;
  provider?: WorkTrackerProvider;
  providerFactory?: NexusAutomationWorkTrackerProviderFactory;
  providerOptions?: CreateWorkTrackerProviderOptions;
  gitRunner?: GitRunner;
  publicationActorRunner?: NexusPublicationActorRunner;
  runtimePackageCommandRunner?: NexusNpmRuntimeCommandRunner;
  mcpRuntimeProcesses?: readonly NexusMcpRuntimeProcess[] | false;
  workItemClaimOwner?: NexusWorkItemClaimOwnerInput;
  claimAuthority?: NexusWorkItemClaimAuthority;
  workItemClaimLeaseTokenFactory?: () => string;
  now?: () => Date | string;
  launcher: NexusAutomationAgentLauncher;
}

export interface RunNexusAutomationAgentLaunchOnceResult {
  runId: string;
  projectRoot: string;
  sourceRoot: string | null;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig | null;
  status: NexusAutomationRunStatus;
  summary: string;
  ledger: NexusAutomationRunLedger | null;
  lock: AcquireNexusAutomationRunLockResult | null;
  preflight: NexusAutomationPreflightCheck[];
  selectorQuery: WorkItemQuery | null;
  eligibleWorkItems: WorkItem[];
  workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null;
  importCandidateWorkItems: NexusEligibleWorkItem[];
  eligibleWorkWarnings: string[];
  eligibleWorkBlockers: string[];
  componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[];
  components: ResolvedNexusProjectComponent[];
  contextFile: string | null;
  resultFile: string | null;
  launch: NexusAutomationAgentLaunchResult | null;
}

export interface NexusAutomationAgentLaunchComponentProvider {
  component: ResolvedNexusProjectComponent;
  provider: WorkTrackerProvider;
}

export interface NexusAutomationAgentResultFileReadResult {
  status: "missing" | "loaded" | "failed";
  summary: string;
  error: string | null;
  result?: NexusAutomationAgentLaunchResult;
}

export class NexusAutomationAgentLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationAgentLaunchError";
  }
}

export async function runNexusAutomationAgentLaunchOnce(
  options: RunNexusAutomationAgentLaunchOnceOptions,
): Promise<RunNexusAutomationAgentLaunchOnceResult> {
  const projectRoot = path.resolve(requiredNonEmptyString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const authProfiles = loadNexusAutomationAuthProfiles({
    projectRoot,
    projectConfig,
    homePath: options.homePath,
  });
  const discoveryEnv = nexusWorkItemDiscoveryCredentialEnvironment({
    projectRoot,
    projectConfig,
    env: options.env,
  });
  const credentialResolver =
    options.credentialResolver ??
    automationWorkItemDiscoveryCredentialResolver({
      env: discoveryEnv,
      authProfiles,
    });
  const runId = options.runId ?? generateNexusAutomationAgentRunId(options.now);
  let sourceRoot: string | null = null;
  let components: ResolvedNexusProjectComponent[] = [];
  let lock: AcquireNexusAutomationRunLockResult | null = null;
  let ledger: NexusAutomationRunLedger | null = null;
  let componentProviders: NexusAutomationAgentLaunchComponentProvider[] = [];
  let preflight: NexusAutomationPreflightCheck[] = [];
  let selectorQuery: WorkItemQuery | null = null;
  let eligibleWorkItems: WorkItem[] = [];
  let importCandidateWorkItems: NexusEligibleWorkItem[] = [];
  let eligibleWorkWarnings: string[] = [];
  let eligibleWorkBlockers: string[] = [];
  let componentEligibleWorkItems: NexusAutomationComponentEligibleWorkItems[] = [];
  let workItemClaim: NexusAutomationAgentLaunchWorkItemClaim | null = null;
  let contextFile: string | null = null;
  let resultFile: string | null = null;

  if (!automationConfig?.enabled) {
    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "skipped",
      summary: "Automation is not enabled for this workspace",
      ledger,
      lock,
      preflight: [],
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: null,
    });
  }

  if (automationConfig.mode !== "agent_launch") {
    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "blocked",
      summary: "Automation mode is not agent_launch",
      ledger,
      lock,
      preflight: [],
      selectorQuery,
      eligibleWorkItems,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: null,
    });
  }

  const startedAt = currentIso(options.now);
  lock = acquireNexusAutomationRunLock({
    projectRoot,
    config: automationConfig,
    runId,
    owner: options.owner ?? null,
    now: startedAt,
  });

  try {
    ledger = readNexusAutomationRunLedger(projectRoot, automationConfig);
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
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
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
        launch: null,
      });
    }

    components = resolveProjectComponents(projectRoot, projectConfig);
    sourceRoot = resolvePrimaryProjectComponent(projectRoot, projectConfig).sourceRoot;
    componentProviders = await createAgentLaunchComponentProviders({
      options,
      projectRoot,
      projectConfig,
      components,
    });
    if (componentProviders.length === 0) {
      const summary = "No workspace component has work tracking configured";
      preflight = [
        check(
          "workTracking",
          false,
          "At least one component has work tracking configured",
          summary,
        ),
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
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
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
        launch: null,
      });
    }

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
        projectRoot,
        components,
        componentProviders,
        automationConfig,
        runtimePackageCommandRunner: options.runtimePackageCommandRunner,
        mcpRuntimeProcesses: options.mcpRuntimeProcesses,
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
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
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
        launch: null,
      });
    }

    selectorQuery = buildNexusAutomationWorkItemQuery(automationConfig);
    const eligibleWork = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig,
      components,
      automationConfig,
      selectorQuery,
      mode: options.eligibleWorkMode ?? automationConfig.eligibleWorkMode,
      provider: options.provider,
      providerFactory: agentLaunchEligibleWorkProviderFactory({
        options,
        projectRoot,
        projectConfig,
      }),
      providerOptions: options.providerOptions,
      credentialResolver,
      env: discoveryEnv,
      now: options.now,
    });
    componentEligibleWorkItems = eligibleWork.componentEligibleWorkItems;
    eligibleWorkItems = eligibleWork.eligibleWorkItems;
    importCandidateWorkItems = eligibleWork.importCandidateWorkItems;
    eligibleWorkWarnings = eligibleWork.warnings;
    eligibleWorkBlockers = eligibleWork.blockers;
    if (eligibleWorkBlockers.length > 0) {
      const summary = eligibleWorkBlockers.join("; ");
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
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "blocked",
        summary,
        ledger,
        lock,
        preflight: [
          ...preflight,
          {
            name: "eligibleWorkDiscovery",
            status: "failed",
            message: summary,
          },
        ],
        selectorQuery,
        eligibleWorkItems,
        importCandidateWorkItems,
        eligibleWorkWarnings,
        eligibleWorkBlockers,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        launch: null,
      });
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
      return launchResult({
        runId,
        projectRoot,
        sourceRoot,
        projectConfig,
        automationConfig,
        status: "skipped",
        summary,
        ledger,
        lock,
        preflight,
        selectorQuery,
        eligibleWorkItems,
        importCandidateWorkItems,
        eligibleWorkWarnings,
        eligibleWorkBlockers,
        componentEligibleWorkItems,
        components,
        contextFile,
        resultFile,
        launch: null,
      });
    }

    if (automationConfig.workItemClaims.enabled) {
      try {
        const claim = await claimNexusEligibleWorkItem({
          projectRoot,
          projectConfig,
          components,
          automationConfig,
          homePath: options.homePath,
          selectorQuery,
          mode: options.eligibleWorkMode ?? automationConfig.eligibleWorkMode,
          provider: options.provider,
          providerFactory: agentLaunchEligibleWorkProviderFactory({
            options,
            projectRoot,
            projectConfig,
          }),
          providerOptions: options.providerOptions,
          env: discoveryEnv,
          claimAuthority: options.claimAuthority,
          owner: workItemClaimOwner({
            options,
            runId,
          }),
          leaseDurationMs: automationConfig.workItemClaims.leaseDurationMs,
          staleClaimPolicy: automationConfig.workItemClaims.staleClaimPolicy,
          leaseTokenFactory: options.workItemClaimLeaseTokenFactory,
          now: options.now,
        });
        workItemClaim = agentLaunchWorkItemClaim(claim);
        if (claim.status === "claimed") {
          eligibleWorkItems = [claim.workItem];
          componentEligibleWorkItems = componentEligibleWorkItemsForClaim({
            componentEligibleWorkItems,
            claim,
          });
        } else {
          const finishedAt = currentIso(options.now);
          const summary = automationWorkItemClaimSkipSummary(
            workItemClaim,
            "coordinator launch",
          );
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
          return launchResult({
            runId,
            projectRoot,
            sourceRoot,
            projectConfig,
            automationConfig,
            status: "skipped",
            summary,
            ledger,
            lock,
            preflight,
            selectorQuery,
            eligibleWorkItems,
            workItemClaim,
            importCandidateWorkItems,
            eligibleWorkWarnings,
            eligibleWorkBlockers,
            componentEligibleWorkItems,
            components,
            contextFile,
            resultFile,
            launch: null,
          });
        }
      } catch (error) {
        const finishedAt = currentIso(options.now);
        const summary =
          `Work-item claim coordination blocked: ${errorMessage(error)}`;
        workItemClaim = blockedWorkItemClaim(summary);
        ledger = appendNexusAutomationRunRecord({
          projectRoot,
          config: automationConfig,
          now: finishedAt,
          record: {
            id: runId,
            projectId: projectConfig.id,
            status: "blocked",
            startedAt,
            finishedAt,
            sourceRoot,
            summary,
            error: summary,
          },
        });
        return launchResult({
          runId,
          projectRoot,
          sourceRoot,
          projectConfig,
          automationConfig,
          status: "blocked",
          summary,
          ledger,
          lock,
          preflight: [
            ...preflight,
            {
              name: "workItemClaim",
              status: "failed",
              message: summary,
            },
          ],
          selectorQuery,
          eligibleWorkItems,
          workItemClaim,
          importCandidateWorkItems,
          eligibleWorkWarnings,
          eligibleWorkBlockers,
          componentEligibleWorkItems,
          components,
          contextFile,
          resultFile,
          launch: null,
        });
      }
    } else {
      workItemClaim = disabledWorkItemClaim();
    }

    const launchFiles = nexusAutomationAgentLaunchFiles({
      projectRoot,
      runId,
    });
    writeNexusAutomationAgentLaunchContext({
      contextFile: launchFiles.contextFile,
      context: buildAgentLaunchContext({
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
        importCandidateWorkItems,
        eligibleWorkWarnings,
        eligibleWorkBlockers,
        componentEligibleWorkItems,
        authProfiles,
        resultFile: launchFiles.resultFile,
      }),
    });
    contextFile = launchFiles.contextFile;
    resultFile = launchFiles.resultFile;

    const agentResult = await options.launcher({
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
      importCandidateWorkItems,
      eligibleWorkWarnings,
      eligibleWorkBlockers,
      componentEligibleWorkItems,
      authProfiles,
      contextFile,
      resultFile,
    });
    const status = normalizeAgentStatus(agentResult.status);
    const finishedAt = currentIso(options.now);
    const summary = agentResult.summary ?? defaultAgentSummary(status);
    ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config: automationConfig,
      now: finishedAt,
      record: {
        id: runId,
        projectId: projectConfig.id,
        status,
        startedAt,
        finishedAt,
        sourceRoot,
        componentId: workItemClaim?.componentId ?? null,
        workItemId: workItemClaim?.workItemId ?? null,
        workItemTitle: workItemClaim?.workItemTitle ?? null,
        commitIds: agentResult.commitIds ?? [],
        summary,
        verification: verificationRecords(agentResult.verification, finishedAt),
        publicationDecision: publicationDecisionRecord(
          agentResult.publicationDecision,
          finishedAt,
        ),
        error: agentResult.error ?? null,
        codexAppServer: agentResult.codexAppServer ?? null,
      },
    });

    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status,
      summary,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      workItemClaim,
      importCandidateWorkItems,
      eligibleWorkWarnings,
      eligibleWorkBlockers,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: agentResult,
    });
  } catch (error) {
    if (!automationConfig) {
      throw error;
    }

    const finishedAt = currentIso(options.now);
    const summary = errorMessage(error);
    ledger = appendNexusAutomationRunRecord({
      projectRoot,
      config: automationConfig,
      now: finishedAt,
      record: {
        id: runId,
        projectId: projectConfig.id,
        status: "failed",
        startedAt,
        finishedAt,
        sourceRoot,
        summary,
        error: summary,
      },
    });
    return launchResult({
      runId,
      projectRoot,
      sourceRoot,
      projectConfig,
      automationConfig,
      status: "failed",
      summary,
      ledger,
      lock,
      preflight,
      selectorQuery,
      eligibleWorkItems,
      workItemClaim,
      importCandidateWorkItems,
      eligibleWorkWarnings,
      eligibleWorkBlockers,
      componentEligibleWorkItems,
      components,
      contextFile,
      resultFile,
      launch: null,
    });
  } finally {
    if (automationConfig) {
      releaseNexusAutomationRunLock({
        projectRoot,
        config: automationConfig,
        runId,
      });
    }
  }
}

export function createNexusAutomationAgentCommandLauncher(
  options: CreateNexusAutomationAgentCommandLauncherOptions,
): NexusAutomationAgentLauncher {
  const command = requiredNonEmptyString(options.command, "command");
  const commandRunner = options.commandRunner ?? defaultNexusAutomationCommandRunner;

  return (input: NexusAutomationAgentLaunchInput): NexusAutomationAgentLaunchResult => {
    const commandResult = commandRunner(command, {
      cwd: input.projectRoot,
      env: agentLaunchEnvironment(options.env ?? process.env, input),
      timeoutMs: options.timeoutMs,
    });
    const commandVerification = verificationFromCommandResult(commandResult);
    const reported = readNexusAutomationAgentResultFile(input.resultFile);

    if (reported.status === "failed") {
      return {
        status: "failed",
        summary: reported.summary,
        verification: [commandVerification],
        error: reported.error,
      };
    }

    const verification = [
      commandVerification,
      ...(reported.result?.verification ?? []),
    ];
    if (!commandSucceeded(commandResult)) {
      return {
        status: "failed",
        summary: `Agent command failed: ${commandSummary(commandResult)}`,
        verification,
        commitIds: reported.result?.commitIds ?? [],
        publicationDecision: reported.result?.publicationDecision,
        workItems: reported.result?.workItems,
        error: commandSummary(commandResult),
      };
    }

    if (reported.status === "missing") {
      return {
        status: "failed",
        summary: reported.summary,
        verification,
        error: reported.error,
      };
    }

    const status = normalizeAgentStatus(reported.result?.status);
    return {
      status,
      summary: reported.result?.summary ?? defaultAgentSummary(status),
      verification,
      commitIds: reported.result?.commitIds ?? [],
      publicationDecision: reported.result?.publicationDecision,
      workItems: reported.result?.workItems,
      error: reported.result?.error ?? null,
    };
  };
}

export function preflightNexusAutomationAgentLaunch(options: {
  projectRoot?: string;
  components: ResolvedNexusProjectComponent[];
  componentProviders: NexusAutomationAgentLaunchComponentProvider[];
  automationConfig: NexusAutomationConfig;
  runtimePackageCommandRunner?: NexusNpmRuntimeCommandRunner;
  mcpRuntimeProcesses?: readonly NexusMcpRuntimeProcess[] | false;
}): NexusAutomationPreflightCheck[] {
  return [
    ...preflightNexusAutomationAgentPolicy(options.automationConfig),
    ...(options.projectRoot
      ? preflightNexusNpmRuntimeInstall({
          projectRoot: options.projectRoot,
          allowRepair: options.automationConfig.safety.allowDependencyInstall,
          ...(options.runtimePackageCommandRunner
            ? { commandRunner: options.runtimePackageCommandRunner }
            : {}),
          })
      : []),
    ...(options.projectRoot
      ? preflightNexusMcpRuntimeFreshness({
          projectRoot: options.projectRoot,
          liveProcesses: options.mcpRuntimeProcesses,
        })
      : []),
    check(
      "workTracking",
      options.componentProviders.length > 0,
      "At least one component has work tracking configured",
      "No workspace component has work tracking configured",
    ),
    ...options.componentProviders.map(({ component, provider }) =>
      check(
        `component:${component.id}:trackerListItems`,
        provider.capabilities.listItems,
        `Component ${component.id} tracker can list work items`,
        `Component ${component.id} tracker provider ${provider.provider} cannot list work items`,
      ),
    ),
    ...options.components.map((component) =>
      check(
        `component:${component.id}:sourceRoot`,
        component.sourceRootExists,
        `Component ${component.id} source root exists`,
        `Component ${component.id} source root does not exist: ${component.sourceRoot}`,
      ),
    ),
  ];
}

function preflightNexusMcpRuntimeFreshness(options: {
  projectRoot: string;
  liveProcesses?: readonly NexusMcpRuntimeProcess[] | false;
}): NexusAutomationPreflightCheck[] {
  try {
    const projectConfig = loadProjectConfig(options.projectRoot);
    return buildNexusMcpRuntimeFreshnessChecks({
      projectRoot: options.projectRoot,
      projectConfig,
      liveProcesses: options.liveProcesses,
    }).map((freshnessCheck) => ({
        name: `mcpRuntime:${freshnessCheck.id}`,
        status: "failed",
        message: freshnessCheck.nextAction
          ? `${freshnessCheck.summary} ${freshnessCheck.nextAction}`
          : freshnessCheck.summary,
      }));
  } catch (error) {
    return [{
      name: "mcpRuntime:freshness",
      status: "failed",
      message:
        error instanceof Error
          ? `Unable to inspect MCP runtime freshness: ${error.message}`
          : `Unable to inspect MCP runtime freshness: ${String(error)}`,
    }];
  }
}

function preflightNexusAutomationAgentPolicy(
  automationConfig: NexusAutomationConfig,
): NexusAutomationPreflightCheck[] {
  const policy = normalizeNexusAutomationAgentPolicy(automationConfig);
  const checks: NexusAutomationPreflightCheck[] = [
    check(
      "agent:maxConcurrentSubagents",
      policy.maxConcurrentSubagents > 0,
      `Agent subagent cap is ${policy.maxConcurrentSubagents}`,
      "automation.agent.maxConcurrentSubagents must be a positive integer",
    ),
  ];

  if (!policy.coordinatorProfileId) {
    checks.push(
      check(
        "agent:coordinatorProfile",
        true,
        "No coordinator profile is configured; command policy must come from automation.agent.command or caller override",
        "Coordinator profile is not configured",
      ),
    );
    return checks;
  }

  const coordinatorProfile = policy.coordinatorProfile;
  checks.push(
    check(
      "agent:coordinatorProfile",
      coordinatorProfile !== null,
      `Coordinator profile ${policy.coordinatorProfileId} is configured`,
      `automation.agent.coordinatorProfileId references missing profile: ${policy.coordinatorProfileId}`,
    ),
  );
  if (!coordinatorProfile) {
    return checks;
  }

  checks.push(
    check(
      `agentProfile:${coordinatorProfile.id}:intendedUse`,
      coordinatorProfile.intendedUse !== "subagent",
      `Coordinator profile ${coordinatorProfile.id} intendedUse allows coordinator launch`,
      `automation.agent.profiles.${coordinatorProfile.id}.intendedUse must be coordinator or any for coordinator launch`,
    ),
  );
  if (coordinatorProfile.executorMode === "app_server") {
    checks.push(
      check(
        `agentProfile:${coordinatorProfile.id}:appServer`,
        coordinatorProfile.appServer !== undefined,
        `Coordinator profile ${coordinatorProfile.id} app-server policy is configured`,
        `automation.agent.profiles.${coordinatorProfile.id}.appServer must be configured for app-server launch`,
      ),
    );
  } else {
    checks.push(
      check(
        `agentProfile:${coordinatorProfile.id}:command`,
        coordinatorProfile.command !== null,
        `Coordinator profile ${coordinatorProfile.id} command is configured`,
        `automation.agent.profiles.${coordinatorProfile.id}.command must be configured for coordinator launch`,
      ),
    );
  }

  return checks;
}

export function generateNexusAutomationAgentRunId(
  now?: () => Date | string,
): string {
  const timestamp = currentIso(now)
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "-");
  const suffix = Math.random().toString(36).slice(2, 8);

  return `agent-${timestamp}-${suffix}`;
}

async function createAgentLaunchComponentProviders(options: {
  options: RunNexusAutomationAgentLaunchOnceOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
}): Promise<NexusAutomationAgentLaunchComponentProvider[]> {
  return Promise.all(
    options.components
      .filter((component) => component.workTracking)
      .map(async (component) => ({
        component,
        provider: await createAgentLaunchProvider({
          options: options.options,
          projectRoot: options.projectRoot,
          projectConfig: options.projectConfig,
          component,
        }),
      })),
  );
}

async function createAgentLaunchProvider(options: {
  options: RunNexusAutomationAgentLaunchOnceOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
}): Promise<WorkTrackerProvider> {
  const workTracking = options.component.workTracking;
  if (!workTracking) {
    throw new NexusAutomationAgentLaunchError(
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
    ...automationWorkTrackerProviderOptions({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      component: options.component,
      baseOptions: options.options.providerOptions,
      homePath: options.options.homePath,
      env: options.options.env,
      now: options.options.now,
    }),
    projectRoot: options.projectRoot,
    now: options.options.now,
  });
}

function workItemClaimOwner(options: {
  options: RunNexusAutomationAgentLaunchOnceOptions;
  runId: string;
}): NexusWorkItemClaimOwnerInput {
  const configured = options.options.workItemClaimOwner;
  return {
    hostId: configured?.hostId ?? os.hostname(),
    agentId: configured?.agentId ?? options.runId,
    ownerId: configured?.ownerId ?? options.options.owner ?? null,
  };
}

function buildAgentLaunchContext(
  input: Omit<
    NexusAutomationAgentLaunchInput,
    "contextFile" | "resultFile"
  > & {
    authProfiles: NexusHostingAuthProfileConfig[];
    resultFile: string;
  },
): NexusAutomationAgentLaunchContext {
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
  const versionPlanning = buildNexusVersionPlanningSurface({
    projectConfig: input.projectConfig,
    components: input.components,
    workItems: input.componentEligibleWorkItems.flatMap((component) =>
      component.workItems.map((item) =>
        versionSurfaceWorkItemInput(component.componentId, item),
      )
    ),
    authority,
    includeWorkItems: true,
    includeUnrelatedWorkItems: true,
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
    result: agentResultContract(input.resultFile),
    eligibleWorkItems: input.eligibleWorkItems,
    workItemClaim: input.workItemClaim,
    importCandidateWorkItems: input.importCandidateWorkItems,
    eligibleWorkWarnings: input.eligibleWorkWarnings,
    eligibleWorkBlockers: input.eligibleWorkBlockers,
    externalIssueVisibility: buildNexusExternalIssueVisibilitySummary({
      components: input.components,
      componentEligibleWorkItems: input.componentEligibleWorkItems,
    }),
    componentEligibleWorkItems: input.componentEligibleWorkItems,
    ...(versionPlanning ? { versionPlanning } : {}),
    safety: input.automationConfig.safety,
    publication: input.automationConfig.publication,
  };
}

function versionSurfaceWorkItemInput(
  componentId: string,
  item: WorkItem,
): NexusVersionPlanningSurfaceWorkItemInput {
  return {
    componentId,
    trackerId: item.trackerRef?.trackerId ?? null,
    trackerProvider: item.trackerRef?.provider ?? null,
    logicalItemId: item.externalRef?.itemId ?? item.id,
    workItem: item,
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

function writeNexusAutomationAgentLaunchContext(options: {
  contextFile: string;
  context: NexusAutomationAgentLaunchContext;
}): void {
  fs.mkdirSync(path.dirname(options.contextFile), { recursive: true });
  fs.writeFileSync(
    options.contextFile,
    `${JSON.stringify(options.context, null, 2)}\n`,
    "utf8",
  );
}

function nexusAutomationAgentLaunchFiles(options: {
  projectRoot: string;
  runId: string;
}): { contextFile: string; resultFile: string } {
  const launchDir = path.join(
    options.projectRoot,
    ".dev-nexus",
    "automation",
    "agent-launches",
    safePathSegment(options.runId),
  );
  const contextFile = path.join(launchDir, "context.json");
  const resultFile = path.join(launchDir, "result.json");

  return { contextFile, resultFile };
}

function agentResultContract(resultFile: string): NexusAutomationAgentResultContract {
  return {
    file: resultFile,
    requiredFields: ["status", "summary"],
    optionalFields: [
      "commitIds",
      "verification",
      "publicationDecision",
      "workItems",
      "error",
    ],
    statuses: ["completed", "failed", "blocked"],
    workItemStatuses: ["completed", "blocked", "failed", "skipped"],
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

function agentLaunchEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  input: NexusAutomationAgentLaunchInput,
): NodeJS.ProcessEnv {
  const publication = input.automationConfig.publication;
  const explicitEnv = {
    ...publicationProcessEnvironment(publication, {
      baseEnv,
      projectRoot: input.projectRoot,
      authProfiles: input.authProfiles,
    }),
    ...publicationEnvironmentVariables(publication),
  };
  return {
    ...explicitEnv,
    ...nonInteractiveGitEnvironment(explicitEnv),
    DEV_NEXUS_AUTOMATION_MODE: "agent_launch",
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
      "commitIds,verification,publicationDecision,workItems,error",
    DEV_NEXUS_TARGET_ID: input.automationConfig.target.id ?? "",
    DEV_NEXUS_TARGET_STATE_FILE: readNexusAutomationTargetContext({
      projectRoot: input.projectRoot,
      config: input.automationConfig,
    }).statePath,
    DEV_NEXUS_TARGET_CYCLE_LEDGER_FILE: readNexusAutomationTargetContext({
      projectRoot: input.projectRoot,
      config: input.automationConfig,
    }).cycleLedgerPath,
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

function agentLaunchEligibleWorkProviderFactory(options: {
  options: RunNexusAutomationAgentLaunchOnceOptions;
  projectRoot: string;
  projectConfig: NexusProjectConfig;
}): NexusEligibleWorkProviderFactory | undefined {
  return (context) => {
    if (options.options.providerFactory) {
      return options.options.providerFactory({
        projectRoot: options.projectRoot,
        sourceRoot: context.component.sourceRoot,
        projectConfig: options.projectConfig,
        component: context.component,
        workTracking: context.tracker.workTracking,
      });
    }

    return createWorkTrackerProviderAsync(context.tracker.workTracking, {
      ...automationWorkTrackerProviderOptions({
        projectRoot: options.projectRoot,
        projectConfig: options.projectConfig,
        component: context.component,
        workTrackingProvider: context.tracker.workTracking.provider,
        baseOptions: options.options.providerOptions,
        homePath: options.options.homePath,
        env: options.options.env,
        now: options.options.now,
      }),
      projectRoot: options.projectRoot,
      now: options.options.now,
    });
  };
}

export function readNexusAutomationAgentResultFile(
  resultFile: string,
): NexusAutomationAgentResultFileReadResult {
  if (!fs.existsSync(resultFile)) {
    const message = `Agent result file was not written: ${resultFile}`;
    return {
      status: "missing",
      summary: message,
      error: message,
    };
  }

  try {
    return {
      status: "loaded",
      summary: "Agent result file loaded",
      error: null,
      result: normalizeAgentResult(
        JSON.parse(fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, "")),
      ),
    };
  } catch (error) {
    const message = `Agent result file is invalid: ${errorMessage(error)}`;
    return {
      status: "failed",
      summary: message,
      error: message,
    };
  }
}

function normalizeAgentResult(value: unknown): NexusAutomationAgentLaunchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError("agent result must be an object");
  }

  const record = value as Record<string, unknown>;
  return {
    status: normalizeAgentStatus(
      requiredNonEmptyString(record.status, "agent result.status"),
    ),
    summary: requiredNonEmptyString(record.summary, "agent result.summary"),
    ...(record.commitIds === undefined
      ? {}
      : { commitIds: normalizeStringArray(record.commitIds, "agent result.commitIds") }),
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
    ...(record.workItems === undefined
      ? {}
      : { workItems: normalizeAgentResultWorkItems(record.workItems) }),
    ...(record.error === undefined
      ? {}
      : { error: optionalNullableString(record.error) ?? null }),
  };
}

function normalizeAgentResultWorkItems(
  value: unknown,
): NexusAutomationAgentResultWorkItem[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError(
      "agent result.workItems must be an array",
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new NexusAutomationAgentLaunchError(
        `agent result.workItems[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      ...(record.componentId === undefined
        ? {}
        : {
            componentId:
              optionalNullableString(record.componentId) ?? null,
          }),
      ...(record.trackerId === undefined
        ? {}
        : {
            trackerId:
              optionalNullableString(record.trackerId) ?? null,
          }),
      id: requiredNonEmptyString(record.id, `agent result.workItems[${index}].id`),
      status: normalizeAgentResultWorkItemStatus(
        record.status,
        `agent result.workItems[${index}].status`,
      ),
      ...(record.summary === undefined
        ? {}
        : { summary: optionalNullableString(record.summary) ?? null }),
      ...(record.notes === undefined
        ? {}
        : { notes: optionalNullableString(record.notes) ?? null }),
    };
  });
}

function normalizeVerificationInputList(
  value: unknown,
): WorktreeVerificationInput[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError(
      "agent result.verification must be an array",
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new NexusAutomationAgentLaunchError(
        `agent result.verification[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      command: requiredNonEmptyString(
        record.command,
        `agent result.verification[${index}].command`,
      ),
      ...(record.status === undefined
        ? {}
        : {
            status: normalizeVerificationStatus(
              record.status,
              `agent result.verification[${index}].status`,
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
    throw new NexusAutomationAgentLaunchError(
      "agent result.publicationDecision must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    type: normalizePublicationDecisionType(
      record.type,
      "agent result.publicationDecision.type",
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

function verificationFromCommandResult(
  result: NexusAutomationCommandRunResult,
): WorktreeVerificationInput {
  return {
    command: result.command,
    status: commandSucceeded(result) ? "passed" : "failed",
    summary: commandSummary(result),
  };
}

function commandSucceeded(result: NexusAutomationCommandRunResult): boolean {
  return result.exitCode === 0 && !result.error;
}

function commandSummary(result: NexusAutomationCommandRunResult): string {
  return summarizeNexusAutomationCommandRunResult(result);
}

function defaultAgentSummary(status: NexusAutomationAgentLaunchStatus): string {
  if (status === "completed") {
    return "Agent launch completed";
  }
  if (status === "blocked") {
    return "Agent launch reported a blocker";
  }

  return "Agent launch failed";
}

function normalizeAgentStatus(
  status: unknown,
): NexusAutomationAgentLaunchStatus {
  if (status === undefined || status === null) {
    return "completed";
  }
  if (status === "completed" || status === "failed" || status === "blocked") {
    return status;
  }

  throw new NexusAutomationAgentLaunchError(
    "agent launch status must be completed, failed, or blocked",
  );
}

function normalizeAgentResultWorkItemStatus(
  status: unknown,
  name: string,
): NexusAutomationAgentResultWorkItemStatus {
  if (
    status === "completed" ||
    status === "blocked" ||
    status === "failed" ||
    status === "skipped"
  ) {
    return status;
  }

  throw new NexusAutomationAgentLaunchError(
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

  throw new NexusAutomationAgentLaunchError(
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

  throw new NexusAutomationAgentLaunchError(
    `${name} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
  );
}

function check(
  name: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): NexusAutomationPreflightCheck {
  return {
    name,
    status: (passed ? "passed" : "failed") satisfies NexusAutomationPreflightStatus,
    message: passed ? passedMessage : failedMessage,
  };
}

type AgentLaunchResultInput = Omit<
  RunNexusAutomationAgentLaunchOnceResult,
  | "componentEligibleWorkItems"
  | "components"
  | "eligibleWorkBlockers"
  | "eligibleWorkWarnings"
  | "importCandidateWorkItems"
  | "workItemClaim"
> &
  Partial<
    Pick<
      RunNexusAutomationAgentLaunchOnceResult,
      | "componentEligibleWorkItems"
      | "components"
      | "eligibleWorkBlockers"
      | "eligibleWorkWarnings"
      | "importCandidateWorkItems"
      | "workItemClaim"
    >
  >;

function launchResult(
  result: AgentLaunchResultInput,
): RunNexusAutomationAgentLaunchOnceResult {
  return {
    ...result,
    importCandidateWorkItems: result.importCandidateWorkItems ?? [],
    eligibleWorkWarnings: result.eligibleWorkWarnings ?? [],
    eligibleWorkBlockers: result.eligibleWorkBlockers ?? [],
    componentEligibleWorkItems: result.componentEligibleWorkItems ?? [],
    components: result.components ?? [],
    workItemClaim: result.workItemClaim ?? null,
  };
}

function safePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new NexusAutomationAgentLaunchError(
      "runId must contain at least one safe character",
    );
  }

  return normalized;
}

function currentIso(now?: () => Date | string): string {
  const value = now ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusAutomationAgentLaunchError("now must return a valid date");
  }

  return date.toISOString();
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new NexusAutomationAgentLaunchError(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${name}[${index}]`),
  );
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationAgentLaunchError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
