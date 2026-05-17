import path from "node:path";
import {
  prepareGitWorktree,
  safeDirectoryName,
  type GitRunner,
  type PrepareGitWorktreeResult,
} from "./gitWorktreeService.js";
import { defaultNexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  materializeNexusAutomationWorktreeSetup,
  preflightNexusAutomationWorktreeSetup,
  type NexusAutomationPluginDependencyProjection,
  type NexusAutomationWorktreeSetupResult,
} from "./nexusAutomationWorktreeSetup.js";
import {
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  projectPluginDependencyProjections,
  projectPluginWorkerFragments,
} from "./nexusPluginCapabilities.js";

export type NexusManualWorktreeScope = "component" | "project";

export interface PrepareNexusManualWorktreeOptions {
  projectRoot: string;
  componentId?: string;
  projectMeta?: boolean;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string | null;
  topic?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  workItemDescription?: string | null;
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
  setup: NexusAutomationWorktreeSetupResult;
  nextActions: string[];
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
      "worktree prepare accepts either --project-meta or --component, not both",
    );
  }

  const target = projectMeta
    ? projectWorktreeTarget(projectRoot, projectConfig)
    : componentWorktreeTarget(projectRoot, projectConfig, options.componentId);
  const slug = manualWorktreeSlug(options, options.now);
  const branchName =
    options.branchName ?? `codex/${safeDirectoryName(target.ownerId)}/${slug}`;
  const baseRef =
    options.baseRef !== undefined ? options.baseRef ?? null : target.defaultBaseRef;
  const automationConfig = projectConfig.automation ?? defaultNexusAutomationConfig;
  const pluginDependencyProjections = manualWorktreePluginDependencyProjections({
    projectRoot,
    projectConfig,
    componentId: target.ownerId,
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
  const worktree = prepareGitWorktree({
    componentId: target.ownerId,
    sourceRoot: target.sourceRoot,
    worktreesRoot: target.worktreesRoot,
    branchName,
    ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
    ...(baseRef ? { baseRef } : {}),
    ...(options.workItemId ? { workItemId: options.workItemId } : {}),
    ...(options.workItemTitle ? { workItemTitle: options.workItemTitle } : {}),
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
        workItem: contextWorkItem,
      },
      pluginFragments: projectPluginWorkerFragments(projectConfig, {
        componentId: target.ownerId,
      }),
    },
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });

  return {
    scope: target.scope,
    projectRoot,
    projectId: projectConfig.id,
    projectName: projectConfig.name,
    component: target.component,
    worktree,
    setup,
    nextActions: nextActions(target.scope, worktree),
  };
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
    throw new Error(`Project component is not configured: ${componentId}`);
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
}): NexusAutomationPluginDependencyProjection[] {
  const componentsById = new Map(
    resolveProjectComponents(options.projectRoot, options.projectConfig).map(
      (component) => [component.id, component],
    ),
  );

  return projectPluginDependencyProjections(options.projectConfig, {
    componentId: options.componentId,
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
  const scopeLabel = scope === "project" ? "project/meta" : "component";
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
