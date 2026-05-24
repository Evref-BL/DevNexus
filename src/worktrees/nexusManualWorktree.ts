import path from "node:path";
import {
  prepareGitWorktree,
  safeDirectoryName,
  type GitRunner,
  type PrepareGitWorktreeResult,
} from "./gitWorktreeService.js";
import { defaultNexusAutomationConfig } from "../automation/nexusAutomationConfig.js";
import { summarizeNexusAuthorityForComponent } from "../authority/nexusAuthority.js";
import {
  materializeNexusAutomationWorktreeSetup,
  preflightNexusAutomationWorktreeSetup,
  type NexusAutomationPluginDependencyProjection,
  type NexusAutomationWorktreeSetupResult,
} from "../automation/nexusAutomationWorktreeSetup.js";
import {
  activeNexusProjectAgentProviders,
  activeNexusProjectSkillAgentTargets,
  loadProjectConfig,
  normalizeNexusProjectAgentTargets,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import type { NexusProjectSkillAgentTarget } from "../agents/nexusSkills.js";
import {
  createOrRefreshNexusWorktreeLease,
  type NexusWorktreeLeaseRecord,
} from "./nexusWorktreeLease.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  projectPluginDependencyProjections,
  projectPluginWorkerFragments,
} from "../project/nexusPluginCapabilities.js";
import { buildNexusRunnerProfilePolicySummary } from "../remote-execution/nexusRunnerProfile.js";
import {
  loadNexusPublicationAuthProfiles,
  resolveNexusPublicationPolicy,
} from "../publication/nexusPublicationPolicy.js";
import {
  resolveExpectedAutomationGitIdentity,
  type NexusExpectedGitIdentity,
} from "../git/nexusGitIdentity.js";
import {
  buildNexusFeatureBranchDeliveryPlan,
} from "../publication/nexusFeatureBranchDeliveryPlan.js";
import {
  branchSlugFor,
  renderFeatureBranchPattern,
} from "../publication/nexusFeatureBranchDeliveryPolicy.js";
import {
  resolveComponentWorkItemRoute,
  throwWorkItemLookupFailure,
} from "../work-items/nexusWorkItemRouting.js";
import type { NexusWorkerContextFeatureBranchDelivery } from "../agents/nexusWorkerContextBundle.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "../work-items/workItemService.js";
import type { WorkItem } from "../work-items/workTrackingTypes.js";

export type NexusManualWorktreeScope = "component" | "project";

export interface PrepareNexusManualWorktreeOptions {
  projectRoot: string;
  componentId?: string;
  projectMeta?: boolean;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string | null;
  featureId?: string | null;
  featureChange?: string | null;
  featureParentBranch?: string | null;
  featureStackPosition?: number | null;
  branchIntent?: string | null;
  topic?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  workItemDescription?: string | null;
  hostId?: string | null;
  agentId?: string | null;
  workerAgentProvider?: string | null;
  writeScope?: string[];
  leaseNotes?: string[];
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface PrepareNexusManualWorktreeResult {
  scope: NexusManualWorktreeScope;
  projectRoot: string;
  projectId: string;
  projectName: string;
  component: ResolvedNexusProjectComponent | null;
  worktree: PrepareGitWorktreeResult;
  lease: NexusWorktreeLeaseRecord;
  setup: NexusAutomationWorktreeSetupResult;
  nextActions: string[];
}

export interface NexusPreparedWorktreeSetupStatusCounts {
  total: number;
  linked: number;
  present: number;
  skipped: number;
}

export interface NexusPreparedWorktreeSummary {
  scope: NexusManualWorktreeScope;
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  component: {
    id: string;
    name: string;
    role: string;
    sourceRoot: string;
    worktreesRoot: string;
    defaultBranch: string | null;
    defaultTrackerId: string | null;
  } | null;
  worktree: {
    componentId: string;
    sourceRoot: string;
    worktreesRoot: string;
    worktreePath: string;
    branchName: string;
    baseRef: string | null;
    requestedBaseRef: string | null;
    resolvedBaseCommit: string | null;
    baseRefKind: PrepareGitWorktreeResult["baseRefKind"];
    baseRefFreshness: PrepareGitWorktreeResult["baseRefFreshness"];
    workItem: PrepareGitWorktreeResult["workItem"];
    gitIdentity: PrepareGitWorktreeResult["gitIdentity"];
    featureBranchDelivery: NexusWorkerContextFeatureBranchDelivery | null;
    gitCommandCount: number;
  };
  lease: {
    id: string;
    status: NexusWorktreeLeaseRecord["status"];
    scope: NexusWorktreeLeaseRecord["scope"];
    hostId: string;
    agentId: string | null;
    workItemId: string | null;
    branchName: string | null;
    baseRef: string | null;
    requestedBaseRef: string | null;
    resolvedBaseCommit: string | null;
    baseRefKind: NexusWorktreeLeaseRecord["baseRefKind"];
    worktree: NexusWorktreeLeaseRecord["worktree"];
    writeScope: string[];
    notes: string[];
  };
  setup: {
    links: NexusPreparedWorktreeSetupStatusCounts & {
      items: Array<{
        source: string;
        target: string;
        required: boolean;
        status: string;
      }>;
    };
    dependencyProjections: NexusPreparedWorktreeSetupStatusCounts & {
      items: Array<{
        id: string;
        source: string;
        target: string;
        required: boolean;
        sourceControl: string;
        status: string;
        warningCount: number;
        warnings: string[];
        pluginId: string;
        capabilityId: string;
      }>;
    };
    skillProjections: {
      agentCount: number;
      skillCount: number;
      refreshedCount: number;
      agents: Array<{
        agent: string;
        skillsDirectory: string;
        sourceControl: string;
        skillCount: number;
        refreshedCount: number;
        missingCount: number;
        staleCount: number;
        presentCount: number;
      }>;
    };
    context: {
      contextDirectoryPath: string;
      contextJsonPath: string;
      briefingPath: string;
    } | null;
  };
  nextActions: string[];
}

export interface ResolvedNexusManualWorktreeWorkItem {
  componentId?: string;
  itemId?: string;
  workItem?: WorkItem | null;
}

interface ResolvedManualWorktreeFeatureDelivery {
  branchName: string;
  baseRef: string;
  context: NexusWorkerContextFeatureBranchDelivery;
}

export async function resolveNexusManualWorktreeWorkItem(options: {
  projectRoot: string;
  componentId?: string;
  projectMeta?: boolean;
  workItemId?: string | null;
  workItemTitle?: string | null;
  topic?: string | null;
  now?: () => Date | string;
}): Promise<ResolvedNexusManualWorktreeWorkItem> {
  if (!options.workItemId || options.projectMeta) {
    return {};
  }

  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const route = resolveComponentWorkItemRoute({
    projectRoot,
    projectConfig,
    componentId: options.componentId,
    workItemId: options.workItemId,
  });
  try {
    const workItem = await createWorkItemService({
      resolveProject: () =>
        manualWorkItemProjectContext(projectRoot, projectConfig, route.component),
      now: options.now,
    }).getWorkItem({
      projectRoot,
      componentId: route.component.id,
      id: route.itemId,
    });
    return {
      componentId: route.component.id,
      itemId: route.itemId,
      workItem,
    };
  } catch (error) {
    if (options.workItemTitle || options.topic) {
      return {
        componentId: route.component.id,
        itemId: route.itemId,
        workItem: null,
      };
    }

    throwWorkItemLookupFailure({
      component: route.component,
      itemId: route.itemId,
      cause: error,
    });
  }
}

export function prepareNexusManualWorktree(
  options: PrepareNexusManualWorktreeOptions,
): PrepareNexusManualWorktreeResult {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const projectMeta = options.projectMeta === true;
  if (projectMeta && options.componentId) {
    throw new Error(
      "worktree prepare accepts either --workspace-meta or --component, not both",
    );
  }
  const workItemRoute =
    !projectMeta && options.workItemId
      ? resolveComponentWorkItemRoute({
          projectRoot,
          projectConfig,
          componentId: options.componentId,
          workItemId: options.workItemId,
        })
      : null;

  const target = projectMeta
    ? projectWorktreeTarget(projectRoot, projectConfig)
    : componentWorktreeTarget(
        projectRoot,
        projectConfig,
        workItemRoute?.component.id ?? options.componentId,
      );
  const workItemId = workItemRoute?.itemId ?? options.workItemId;
  const slug = manualWorktreeSlug(
    {
      workItemId,
      topic: options.topic,
    },
    options.now,
  );
  const featureBranchDelivery = !projectMeta && options.featureId
    ? resolveManualWorktreeFeatureDelivery({
        projectRoot,
        componentId: target.ownerId,
        featureId: options.featureId,
        changeSlug: options.featureChange ?? slug,
        parentBranch: options.featureParentBranch,
        stackPosition: options.featureStackPosition,
        branchIntent: options.branchIntent,
      })
    : null;
  const branchName =
    options.branchName ??
    featureBranchDelivery?.branchName ??
    `codex/${safeDirectoryName(target.ownerId)}/${slug}`;
  const baseRef =
    options.baseRef !== undefined
      ? options.baseRef ?? null
      : featureBranchDelivery?.baseRef ?? target.defaultBaseRef;
  const automationConfig = projectConfig.automation ?? defaultNexusAutomationConfig;
  const publication = target.component
    ? resolveNexusPublicationPolicy(projectConfig, target.component)
    : automationConfig.publication;
  const authProfiles = loadNexusPublicationAuthProfiles({
    projectRoot,
    projectConfig,
  });
  const expectedGitIdentity = resolveExpectedAutomationGitIdentity({
    publication,
    authProfiles,
  });
  const authority = target.component
    ? summarizeNexusAuthorityForComponent({
        projectId: projectConfig.id,
        componentId: target.component.id,
        componentName: target.component.name,
        authority: projectConfig.authority,
        publication,
        safety: automationConfig.safety,
        tracker: target.component.defaultTrackerId,
        repository: target.component.remoteUrl,
      })
    : null;
  const agentTargetSelection = manualWorktreeAgentTargetSelection({
    projectConfig,
    workerAgentProvider: options.workerAgentProvider,
  });
  const pluginDependencyProjections = manualWorktreePluginDependencyProjections({
    projectRoot,
    projectConfig,
    componentId: target.ownerId,
    workerAgentProvider: agentTargetSelection.assignedProvider,
    activeProviders: agentTargetSelection.policy.activeProviders,
  });
  const failedPreflight = preflightNexusAutomationWorktreeSetup({
    sourceRoot: target.sourceRoot,
    worktreesRoot: target.worktreesRoot,
    automationConfig,
    pluginDependencyProjections,
  }).filter((check) => check.status === "failed");
  if (failedPreflight.length > 0) {
    throw new Error(
      `Worktree setup preflight failed: ${failedPreflight
        .map((check) => check.message)
        .join("; ")}`,
    );
  }
  const worktreeGitIdentity = preparedGitIdentity(expectedGitIdentity);
  const worktree = prepareGitWorktree({
    componentId: target.ownerId,
    sourceRoot: target.sourceRoot,
    worktreesRoot: target.worktreesRoot,
    branchName,
    ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
    ...(baseRef ? { baseRef } : {}),
    ...(workItemId ? { workItemId } : {}),
    ...(options.workItemTitle ? { workItemTitle: options.workItemTitle } : {}),
    ...(worktreeGitIdentity ? { gitIdentity: worktreeGitIdentity } : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });
  const contextWorkItem =
    worktree.workItem && options.workItemDescription !== undefined
      ? {
          ...worktree.workItem,
          description: options.workItemDescription,
        }
      : worktree.workItem;
  const setup = materializeNexusAutomationWorktreeSetup({
    sourceRoot: target.sourceRoot,
    worktreesRoot: target.worktreesRoot,
    worktreePath: worktree.worktreePath,
    automationConfig,
    pluginDependencyProjections,
    skillsConfig: projectConfig.skills,
    skillAgentTargets: agentTargetSelection.skillTargets,
    context: {
      project: {
        id: projectConfig.id,
        name: projectConfig.name,
        root: projectRoot,
      },
      ownership: {
        componentId: worktree.componentId,
        sourceRoot: worktree.sourceRoot,
        worktreesRoot: worktree.worktreesRoot,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseRef: worktree.baseRef,
        requestedBaseRef: worktree.requestedBaseRef,
        resolvedBaseCommit: worktree.resolvedBaseCommit,
        baseRefKind: worktree.baseRefKind,
        workItem: contextWorkItem,
      },
      featureBranchDelivery: featureBranchDelivery?.context ?? null,
      agentTargetPolicy: agentTargetSelection.policy,
      pluginFragments: projectPluginWorkerFragments(projectConfig, {
        componentId: target.ownerId,
        ...(agentTargetSelection.assignedProvider
          ? { agent: agentTargetSelection.assignedProvider }
          : { activeAgents: agentTargetSelection.policy.activeProviders }),
      }),
      publication,
      gitIdentity: expectedGitIdentity,
      authority,
      runnerProfiles: buildNexusRunnerProfilePolicySummary(
        projectConfig.runnerProfiles,
        projectConfig.hosts,
      ),
    },
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });
  const lease = createOrRefreshNexusWorktreeLease({
    projectRoot,
    componentId: target.scope === "component" ? target.ownerId : null,
    projectMeta: target.scope === "project",
    hostId: options.hostId,
    agentId: options.agentId,
    workItemId,
    branchName: worktree.branchName,
    baseRef: worktree.baseRef,
    requestedBaseRef: worktree.requestedBaseRef,
    resolvedBaseCommit: worktree.resolvedBaseCommit,
    baseRefKind: worktree.baseRefKind,
    worktreePath: worktree.worktreePath,
    writeScope: options.writeScope,
    status: "working",
    notes: options.leaseNotes,
    gitRunner: options.gitRunner,
    now: options.now,
  });

  return {
    scope: target.scope,
    projectRoot,
    projectId: projectConfig.id,
    projectName: projectConfig.name,
    component: target.component,
    worktree,
    lease,
    setup,
    nextActions: nextActions(target.scope, worktree),
  };
}

export function summarizeNexusManualWorktreeResult(
  result: PrepareNexusManualWorktreeResult,
): NexusPreparedWorktreeSummary {
  const links = countSetupStatuses(
    result.setup.links.map((link) => link.status),
  );
  const dependencyProjections = countSetupStatuses(
    result.setup.dependencyProjections.map((projection) => projection.status),
  );
  const skillAgents = result.setup.skillProjections.map((projection) => {
    const missingCount = projection.skills.filter(
      (skill) => skill.afterStatus === "missing",
    ).length;
    const staleCount = projection.skills.filter(
      (skill) => skill.afterStatus === "stale",
    ).length;
    const presentCount = projection.skills.filter(
      (skill) => skill.afterStatus === "present",
    ).length;
    const refreshedCount = projection.skills.filter((skill) => skill.refreshed)
      .length;
    return {
      agent: projection.agent,
      skillsDirectory: projection.skillsDirectory,
      sourceControl: projection.sourceControl,
      skillCount: projection.skills.length,
      refreshedCount,
      missingCount,
      staleCount,
      presentCount,
    };
  });

  return {
    scope: result.scope,
    projectRoot: result.projectRoot,
    project: {
      id: result.projectId,
      name: result.projectName,
    },
    component: result.component
      ? {
          id: result.component.id,
          name: result.component.name,
          role: result.component.role,
          sourceRoot: result.component.sourceRoot,
          worktreesRoot: result.component.worktreesRoot,
          defaultBranch: result.component.defaultBranch,
          defaultTrackerId: result.component.defaultTrackerId,
        }
      : null,
    worktree: {
      componentId: result.worktree.componentId,
      sourceRoot: result.worktree.sourceRoot,
      worktreesRoot: result.worktree.worktreesRoot,
      worktreePath: result.worktree.worktreePath,
      branchName: result.worktree.branchName,
      baseRef: result.worktree.baseRef,
      requestedBaseRef: result.worktree.requestedBaseRef,
      resolvedBaseCommit: result.worktree.resolvedBaseCommit,
      baseRefKind: result.worktree.baseRefKind,
      baseRefFreshness: result.worktree.baseRefFreshness,
      workItem: result.worktree.workItem,
      gitIdentity: result.worktree.gitIdentity,
      featureBranchDelivery: result.setup.context?.context.featureBranchDelivery ?? null,
      gitCommandCount: result.worktree.git.commands.length,
    },
    lease: {
      id: result.lease.id,
      status: result.lease.status,
      scope: result.lease.scope,
      hostId: result.lease.hostId,
      agentId: result.lease.agentId,
      workItemId: result.lease.workItemId,
      branchName: result.lease.branchName,
      baseRef: result.lease.baseRef,
      requestedBaseRef: result.lease.requestedBaseRef,
      resolvedBaseCommit: result.lease.resolvedBaseCommit,
      baseRefKind: result.lease.baseRefKind,
      worktree: result.lease.worktree,
      writeScope: result.lease.writeScope,
      notes: result.lease.notes,
    },
    setup: {
      links: {
        ...links,
        items: result.setup.links.map((link) => ({
          source: link.source,
          target: link.target,
          required: link.required,
          status: link.status,
        })),
      },
      dependencyProjections: {
        ...dependencyProjections,
        items: result.setup.dependencyProjections.map((projection) => ({
          id: projection.id,
          source: projection.source,
          target: projection.target,
          required: projection.required,
          sourceControl: projection.sourceControl,
          status: projection.status,
          warningCount: projection.warnings?.length ?? 0,
          warnings: projection.warnings ?? [],
          pluginId: projection.sourceMetadata.pluginId,
          capabilityId: projection.sourceMetadata.capabilityId,
        })),
      },
      skillProjections: {
        agentCount: skillAgents.length,
        skillCount: skillAgents.reduce(
          (total, agent) => total + agent.skillCount,
          0,
        ),
        refreshedCount: skillAgents.reduce(
          (total, agent) => total + agent.refreshedCount,
          0,
        ),
        agents: skillAgents,
      },
      context: result.setup.context
        ? {
            contextDirectoryPath: result.setup.context.contextDirectoryPath,
            contextJsonPath: result.setup.context.contextJsonPath,
            briefingPath: result.setup.context.briefingPath,
          }
        : null,
    },
    nextActions: result.nextActions,
  };
}

function countSetupStatuses(
  statuses: readonly string[],
): NexusPreparedWorktreeSetupStatusCounts {
  return {
    total: statuses.length,
    linked: statuses.filter((status) => status === "linked").length,
    present: statuses.filter((status) => status === "present").length,
    skipped: statuses.filter((status) => status === "skipped").length,
  };
}

function preparedGitIdentity(
  identity: NexusExpectedGitIdentity | null,
): { name: string; email: string } | null {
  if (!identity?.name || !identity.email) {
    return null;
  }

  return {
    name: identity.name,
    email: identity.email,
  };
}

function resolveManualWorktreeFeatureDelivery(options: {
  projectRoot: string;
  componentId: string;
  featureId: string;
  changeSlug: string;
  parentBranch?: string | null;
  stackPosition?: number | null;
  branchIntent?: string | null;
}): ResolvedManualWorktreeFeatureDelivery {
  const plan = buildNexusFeatureBranchDeliveryPlan({
    projectRoot: options.projectRoot,
    componentId: options.componentId,
    featureId: options.featureId,
  });
  const item = plan.items[0];
  if (!item) {
    throw new Error(
      `Feature branch delivery policy was not found for ${options.featureId}`,
    );
  }
  const feature = item.feature;
  const intent = options.branchIntent ?? feature.defaultIntentPrefix;
  if (!feature.allowedIntentPrefixes.includes(intent)) {
    throw new Error(
      `Feature branch intent ${intent} is not allowed for ${feature.activeScopeId}`,
    );
  }
  const changeSlug = branchSlugFor(options.changeSlug);
  const reviewBranchPattern = patternWithIntent(
    feature.branchPlan.reviewBranchPattern,
    feature.defaultIntentPrefix,
    intent,
  );
  const branchName = renderFeatureBranchPattern(reviewBranchPattern, {
    intent,
    feature: feature.branchSlug,
    change: changeSlug,
  });
  const stack = feature.branchPlan.stack;
  const parentBranch =
    options.parentBranch?.trim() ||
    (stack.status === "active" ? stack.defaultParentBranch : null);
  const stackPosition = options.stackPosition ??
    (stack.status === "active" ? 1 : null);
  const branchTarget = parentBranch ?? feature.branchPlan.defaultChangeReviewTarget;
  const hitlGates = [
    ...(feature.branchPlan.requiresFeatureBranchApproval
      ? ["feature branch approval"]
      : []),
    "pull request creation or retargeting",
    "force update or restack of a pushed branch",
    "final publication into target branch",
  ];

  return {
    branchName,
    baseRef: parentBranch ?? feature.branchPlan.defaultChangeBaseBranch,
    context: {
      featureId: feature.activeScopeId,
      changeSlug,
      branchStrategy: feature.defaultBranchStrategy,
      featureBranch: feature.branchPlan.featureBranch,
      branchTarget,
      parentBranch,
      stackPosition,
      childBranches: [],
      stackPublicationEligible: stack.publicationEligible,
      finalPublicationTarget: feature.branchPlan.finalPublicationTarget,
      reviewMode: feature.reviewMode,
      finalPullRequestCreation: feature.finalPullRequestCreation,
      commentPolicy: feature.commentPolicy,
      branchPublication: feature.branchPublication,
      hitlGates,
    },
  };
}

function patternWithIntent(
  pattern: string,
  currentIntent: string,
  requestedIntent: string,
): string {
  if (currentIntent === requestedIntent) {
    return pattern;
  }
  const currentPrefix = `${currentIntent}/`;
  return pattern.startsWith(currentPrefix)
    ? `${requestedIntent}/${pattern.slice(currentPrefix.length)}`
    : pattern;
}

function componentWorktreeTarget(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string | undefined,
): {
  scope: "component";
  ownerId: string;
  component: ResolvedNexusProjectComponent;
  sourceRoot: string;
  worktreesRoot: string;
  defaultBaseRef: string | null;
} {
  const component = componentId
    ? resolveProjectComponents(projectRoot, projectConfig).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(projectRoot, projectConfig);
  if (!component) {
    throw new Error(`Workspace component is not configured: ${componentId}`);
  }

  return {
    scope: "component",
    ownerId: component.id,
    component,
    sourceRoot: component.sourceRoot,
    worktreesRoot: component.worktreesRoot,
    defaultBaseRef:
      component.defaultBranch ?? projectConfig.repo.defaultBranch ?? null,
  };
}

function manualWorkItemProjectContext(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  component: ResolvedNexusProjectComponent,
): ResolvedWorkItemProjectContext {
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    homePath: projectConfig.home ?? "",
    projectRoot,
    projectId: projectConfig.id,
    projectName: projectConfig.name,
    componentId: component.id,
    componentName: component.name,
    sourceRoot: component.sourceRoot,
    workTracking: component.workTracking,
  };
}

function projectWorktreeTarget(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): {
  scope: "project";
  ownerId: string;
  component: null;
  sourceRoot: string;
  worktreesRoot: string;
  defaultBaseRef: string | null;
} {
  return {
    scope: "project",
    ownerId: projectConfig.id,
    component: null,
    sourceRoot: projectRoot,
    worktreesRoot: path.join(
      projectWorktreesRootPath(projectRoot, projectConfig),
      projectConfig.id,
    ),
    defaultBaseRef: projectConfig.repo.defaultBranch ?? null,
  };
}

function manualWorktreeSlug(
  options: Pick<PrepareNexusManualWorktreeOptions, "workItemId" | "topic">,
  now: (() => Date | string) | undefined,
): string {
  return safeDirectoryName(
    options.workItemId ??
      options.topic ??
      `worktree-${compactTimestamp(now?.() ?? new Date())}`,
  );
}

function manualWorktreePluginDependencyProjections(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  componentId: string | null;
  workerAgentProvider: string | null;
  activeProviders: string[];
}): NexusAutomationPluginDependencyProjection[] {
  const componentsById = new Map(
    resolveProjectComponents(options.projectRoot, options.projectConfig).map(
      (component) => [component.id, component],
    ),
  );

  return projectPluginDependencyProjections(options.projectConfig, {
    componentId: options.componentId,
    ...(options.workerAgentProvider
      ? { agent: options.workerAgentProvider }
      : { activeAgents: options.activeProviders }),
  }).map((projection) => {
    const sourceComponent = projection.sourceComponentId
      ? componentsById.get(projection.sourceComponentId)
      : null;
    if (projection.sourceComponentId && !sourceComponent) {
      throw new Error(
        `Plugin dependency projection ${projection.id} sourceComponentId references unknown component: ${projection.sourceComponentId}`,
      );
    }

    return {
      id: projection.id,
      ...(sourceComponent
        ? {
            sourceComponent: {
              id: sourceComponent.id,
              sourceRoot: sourceComponent.sourceRoot,
            },
          }
        : {}),
      source: projection.source,
      target: projection.target,
      required: projection.required,
      sourceControl: projection.sourceControl,
      reason: projection.reason,
      sourceMetadata: {
        pluginId: projection.pluginSource.pluginId,
        pluginName: projection.pluginSource.pluginName,
        version: projection.pluginSource.version,
        capabilityId: projection.pluginSource.capabilityId,
      },
    };
  });
}

function manualWorktreeAgentTargetSelection(options: {
  projectConfig: NexusProjectConfig;
  workerAgentProvider?: string | null;
}): {
  assignedProvider: string | null;
  skillTargets: NexusProjectSkillAgentTarget[];
  policy: {
    explicit: boolean;
    activeProviders: string[];
    assignedProvider: string | null;
    recommendations: string[];
    warnings: string[];
  };
} {
  const normalized = normalizeNexusProjectAgentTargets(options.projectConfig);
  const activeProviders = activeNexusProjectAgentProviders(options.projectConfig);
  const selectedProvider =
    optionalNullableString(
      options.workerAgentProvider,
      "workerAgentProvider",
    )?.toLowerCase() ?? null;
  const assignedProvider =
    selectedProvider ??
    (activeProviders.length === 1 ? activeProviders[0]! : null);
  const warnings: string[] = [];
  if (assignedProvider && !activeProviders.includes(assignedProvider)) {
    throw new Error(
      `Worker agent provider ${assignedProvider} is not active in project agent target policy: ` +
        `${activeProviders.join(", ") || "none"}`,
    );
  }
  if (!assignedProvider && activeProviders.length > 1) {
    warnings.push(
      "No assigned worker provider was selected; worktree setup includes all active provider projections.",
    );
  }

  const activeSkillTargets = activeNexusProjectSkillAgentTargets(
    options.projectConfig,
  );
  const skillTargets = assignedProvider
    ? activeSkillTargets.filter((target) => target.agent === assignedProvider)
    : activeSkillTargets;

  return {
    assignedProvider,
    skillTargets,
    policy: {
      explicit: normalized.explicit,
      activeProviders,
      assignedProvider,
      recommendations: normalized.recommendations,
      warnings,
    },
  };
}

function compactTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "z")
    .toLowerCase();
}

function nextActions(
  scope: NexusManualWorktreeScope,
  worktree: PrepareGitWorktreeResult,
): string[] {
  const scopeLabel = scope === "project" ? "workspace/meta" : "component";
  return [
    `Run source and Git commands from ${worktree.worktreePath}.`,
    `Treat the original ${scopeLabel} checkout as shared context unless you explicitly own it.`,
    "Record progress with DevNexus coordination handoff before switching tasks or integrating.",
  ];
}

function requiredNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return trimmed;
}

function optionalNullableString(
  value: string | null | undefined,
  name: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty string when provided`);
  }

  return trimmed;
}
