import fs from "node:fs";
import path from "node:path";
import type {
  WorkStatus,
  WorkTrackingProviderName,
} from "./workTrackingTypes.js";

export type NexusWorkerContextFileId =
  | "agents"
  | "context"
  | "plan"
  | "target-state";

export interface NexusWorkerContextFileReference {
  id: NexusWorkerContextFileId;
  path: string;
  access: "read_only";
}

export interface NexusWorkerContextProject {
  id: string | null;
  name: string | null;
  root: string;
}

export interface NexusWorkerContextBoundarySet {
  roots: string[];
  files?: NexusWorkerContextFileReference[];
  notes: string[];
}

export interface NexusWorkerContextBoundaries {
  commandWorkingDirectory: string;
  gitWorkingDirectory: string;
  write: NexusWorkerContextBoundarySet;
  read: NexusWorkerContextBoundarySet;
}

export interface NexusWorkerProjectContextReferences {
  agentsPath: string;
  contextPath: string;
  planPath: string;
  targetStatePath: string;
  files: NexusWorkerContextFileReference[];
}

export interface NexusWorkerContextBundleWorkItem {
  id: string;
  title: string | null;
  status?: WorkStatus;
  provider?: WorkTrackingProviderName | string;
  labels?: string[];
  assignees?: string[];
}

export interface NexusWorkerContextBundleWorktree {
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: NexusWorkerContextBundleWorkItem | null;
}

export interface NexusWorkerContextBundle {
  version: 1;
  project: NexusWorkerContextProject;
  projectRoot: string;
  component: {
    id: string;
    sourceRoot: string;
  };
  ownership: NexusWorkerContextBundleWorktree;
  worktree: NexusWorkerContextBundleWorktree;
  projectContext: NexusWorkerProjectContextReferences;
  boundaries: NexusWorkerContextBoundaries;
}

export interface NexusWorkerContextBundleOptions {
  projectRoot: string;
  projectId?: string | null;
  projectName?: string | null;
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: NexusWorkerContextBundleWorkItem | null;
  targetStatePath?: string | null;
}

export interface MaterializeNexusWorkerContextBundleResult {
  contextDirectoryPath: string;
  contextJsonPath: string;
  briefingPath: string;
  context: NexusWorkerContextBundle;
  briefingMarkdown: string;
}

export const nexusWorkerContextDirectoryName = "context";
export const nexusWorkerContextJsonFileName = "context.json";
export const nexusWorkerBriefingFileName = "briefing.md";
export const defaultNexusWorkerTargetStatePath =
  ".dev-nexus/automation/target-state.md";

export class NexusWorkerContextBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusWorkerContextBundleError";
  }
}

export function nexusWorkerContextDirectoryPath(worktreePath: string): string {
  return path.join(
    normalizedAbsolutePath(worktreePath, "worktreePath"),
    ".dev-nexus",
    nexusWorkerContextDirectoryName,
  );
}

export function nexusWorkerContextJsonPath(worktreePath: string): string {
  return path.join(
    nexusWorkerContextDirectoryPath(worktreePath),
    nexusWorkerContextJsonFileName,
  );
}

export function nexusWorkerBriefingPath(worktreePath: string): string {
  return path.join(
    nexusWorkerContextDirectoryPath(worktreePath),
    nexusWorkerBriefingFileName,
  );
}

export function buildNexusWorkerContextBundle(
  options: NexusWorkerContextBundleOptions,
): NexusWorkerContextBundle {
  const projectRoot = normalizedAbsolutePath(options.projectRoot, "projectRoot");
  const projectId = optionalNullableString(options.projectId, "projectId") ?? null;
  const projectName =
    optionalNullableString(options.projectName, "projectName") ?? null;
  const componentId = requiredNonEmptyString(options.componentId, "componentId");
  const sourceRoot = normalizedAbsolutePath(options.sourceRoot, "sourceRoot");
  const worktreesRoot = normalizedAbsolutePath(
    options.worktreesRoot,
    "worktreesRoot",
  );
  const worktreePath = normalizedAbsolutePath(
    options.worktreePath,
    "worktreePath",
  );
  assertPathInsideRoot(
    worktreesRoot,
    worktreePath,
    "worktreePath",
    "worktreesRoot",
  );
  const branchName = requiredNonEmptyString(options.branchName, "branchName");
  const baseRef = optionalNullableString(options.baseRef, "baseRef") ?? null;
  const workItem = normalizeWorkerContextWorkItem(options.workItem);
  const projectContext = projectContextReferences({
    projectRoot,
    targetStatePath: options.targetStatePath,
  });
  const worktree = {
    componentId,
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName,
    baseRef,
    workItem,
  };

  return {
    version: 1,
    project: {
      id: projectId,
      name: projectName,
      root: projectRoot,
    },
    projectRoot,
    component: {
      id: componentId,
      sourceRoot,
    },
    ownership: worktree,
    worktree,
    projectContext,
    boundaries: {
      commandWorkingDirectory: worktreePath,
      gitWorkingDirectory: worktreePath,
      write: {
        roots: [worktreePath],
        notes: [
          "Write source changes only inside the component worktree unless the coordinator explicitly assigns another boundary.",
          "Run source and git commands from the component worktree.",
        ],
      },
      read: {
        roots: uniquePaths([sourceRoot, projectRoot]),
        files: projectContext.files,
        notes: [
          "Use the original component source root and project files as read-only context.",
          "Treat root project files as read-only unless the coordinator owns project state for this work.",
        ],
      },
    },
  };
}

export function renderNexusWorkerBriefing(
  context: NexusWorkerContextBundle,
): string {
  const workItemLine = context.worktree.workItem
    ? `${context.worktree.workItem.id}: ${context.worktree.workItem.title}`
    : "none";
  const baseRefLine = context.worktree.baseRef ?? "none";

  return [
    "# DevNexus Worker Context",
    "",
    `Component: ${context.component.id}`,
    `Work item: ${workItemLine}`,
    `Branch: ${context.worktree.branchName}`,
    `Base ref: ${baseRefLine}`,
    "",
    `Run source and git commands in: ${context.worktree.worktreePath}`,
    "Source and Git commands run from the component checkout root shown above.",
    "Write source changes only inside this component worktree unless the coordinator assigns another boundary.",
    "Treat project context files as read-only unless the coordinator explicitly assigns project-state ownership.",
    "",
    "Project context:",
    `- AGENTS.md: ${context.projectContext.agentsPath}`,
    `- CONTEXT.md: ${context.projectContext.contextPath}`,
    `- PLAN.md: ${context.projectContext.planPath}`,
    `- target-state: ${context.projectContext.targetStatePath}`,
    "",
  ].join("\n");
}

export function materializeNexusWorkerContextBundle(
  options: NexusWorkerContextBundleOptions,
): MaterializeNexusWorkerContextBundleResult {
  const context = buildNexusWorkerContextBundle(options);
  const contextDirectoryPath = nexusWorkerContextDirectoryPath(
    context.worktree.worktreePath,
  );
  const contextJsonPath = nexusWorkerContextJsonPath(context.worktree.worktreePath);
  const briefingPath = nexusWorkerBriefingPath(context.worktree.worktreePath);
  const briefingMarkdown = renderNexusWorkerBriefing(context);

  fs.mkdirSync(contextDirectoryPath, { recursive: true });
  fs.writeFileSync(
    contextJsonPath,
    `${JSON.stringify(context, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(briefingPath, briefingMarkdown, "utf8");

  return {
    contextDirectoryPath,
    contextJsonPath,
    briefingPath,
    context,
    briefingMarkdown,
  };
}

function projectContextReferences(options: {
  projectRoot: string;
  targetStatePath?: string | null;
}): NexusWorkerProjectContextReferences {
  const targetStatePath = resolveInsideProjectRoot(
    options.projectRoot,
    options.targetStatePath ?? defaultNexusWorkerTargetStatePath,
    "targetStatePath",
  );
  const agentsPath = path.join(options.projectRoot, "AGENTS.md");
  const contextPath = path.join(options.projectRoot, "CONTEXT.md");
  const planPath = path.join(options.projectRoot, "PLAN.md");
  const files: NexusWorkerContextFileReference[] = [
    { id: "agents", path: agentsPath, access: "read_only" },
    { id: "context", path: contextPath, access: "read_only" },
    { id: "plan", path: planPath, access: "read_only" },
    { id: "target-state", path: targetStatePath, access: "read_only" },
  ];

  return {
    agentsPath,
    contextPath,
    planPath,
    targetStatePath,
    files,
  };
}

function normalizeWorkerContextWorkItem(
  workItem: NexusWorkerContextBundleWorkItem | null,
): NexusWorkerContextBundleWorkItem | null {
  if (workItem === null) {
    return null;
  }

  return {
    id: requiredNonEmptyString(workItem.id, "workItem.id"),
    title: optionalNullableString(workItem.title, "workItem.title") ?? null,
    ...(workItem.status ? { status: workItem.status } : {}),
    ...(workItem.provider
      ? { provider: requiredNonEmptyString(workItem.provider, "workItem.provider") }
      : {}),
    ...(workItem.labels ? { labels: [...workItem.labels] } : {}),
    ...(workItem.assignees ? { assignees: [...workItem.assignees] } : {}),
  };
}

function resolveInsideProjectRoot(
  projectRoot: string,
  value: string,
  name: string,
): string {
  const resolved = path.resolve(projectRoot, requiredNonEmptyString(value, name));
  assertPathInsideRoot(projectRoot, resolved, name, "projectRoot");

  return resolved;
}

function assertPathInsideRoot(
  root: string,
  value: string,
  valueName: string,
  rootName: string,
): void {
  const relative = path.relative(root, value);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusWorkerContextBundleError(
      `${valueName} must resolve inside ${rootName}: ${value}`,
    );
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function normalizedAbsolutePath(value: unknown, name: string): string {
  return path.resolve(requiredNonEmptyString(value, name));
}

function optionalNullableString(
  value: unknown,
  name: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusWorkerContextBundleError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
