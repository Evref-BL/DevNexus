import fs from "node:fs";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";
import {
  loadProjectConfig,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";

export type NexusCheckoutClassification =
  | "shared_project_checkout"
  | "shared_component_checkout"
  | "generated_component_worktree"
  | "generated_project_meta_worktree"
  | "integration_worktree"
  | "bootstrap_setup_operation"
  | "unknown";

export type NexusCheckoutMutationClass =
  | "read_only"
  | "local_tracker"
  | "target_state"
  | "project_state"
  | "skill_mcp_projection"
  | "coordination_record"
  | "component_source"
  | "worktree_bootstrap"
  | "publication_integration"
  | "cleanup_execution"
  | "local_remote_repair"
  | "provider_sync";

export type NexusSharedCheckoutGuardOverride =
  | "allow"
  | "bootstrap"
  | "integration";

export interface NexusCheckoutClassificationResult {
  classification: NexusCheckoutClassification;
  projectRoot: string;
  sharedProjectRoot: string | null;
  targetPath: string;
  repositoryPath: string | null;
  componentId: string | null;
  reason: string;
}

export interface NexusSharedCheckoutGuardDecision
  extends NexusCheckoutClassificationResult {
  ok: boolean;
  mutationClass: NexusCheckoutMutationClass;
  command: string;
  saferNextAction: string;
  override: NexusSharedCheckoutGuardOverride | null;
}

export interface ClassifyNexusCheckoutOptions {
  projectRoot: string;
  targetPath?: string | null;
  componentId?: string | null;
  gitRunner?: GitRunner;
}

export interface EvaluateNexusSharedCheckoutMutationOptions
  extends ClassifyNexusCheckoutOptions {
  mutationClass: NexusCheckoutMutationClass;
  command: string;
  override?: NexusSharedCheckoutGuardOverride | null;
}

interface ProjectContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
}

interface WorktreeListEntry {
  path: string;
}

export class NexusSharedCheckoutGuardError extends Error {
  readonly decision: NexusSharedCheckoutGuardDecision;

  constructor(decision: NexusSharedCheckoutGuardDecision) {
    super(
      `Refusing ${decision.mutationClass} mutation for ${decision.command} on ${decision.classification}: ${decision.saferNextAction}`,
    );
    this.name = "NexusSharedCheckoutGuardError";
    this.decision = decision;
  }
}

export function classifyNexusCheckout(
  options: ClassifyNexusCheckoutOptions,
): NexusCheckoutClassificationResult {
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const targetPath = path.resolve(options.targetPath ?? projectRoot);
  const targetRepositoryPath = gitTopLevel(gitRunner, targetPath);
  const projectRepositoryPath = gitTopLevel(gitRunner, projectRoot);

  if (!targetRepositoryPath) {
    return {
      classification: "unknown",
      projectRoot,
      sharedProjectRoot: null,
      targetPath,
      repositoryPath: null,
      componentId: options.componentId ?? null,
      reason: "No Git checkout could be resolved for the mutation target.",
    };
  }

  const contexts = projectContexts({
    projectRoot,
    projectRepositoryPath,
    gitRunner,
  });

  for (const context of contexts) {
    const componentWorktree = context.components.find((component) =>
      pathInside(component.worktreesRoot, targetRepositoryPath),
    );
    if (componentWorktree) {
      return {
        classification: "generated_component_worktree",
        projectRoot,
        sharedProjectRoot: context.projectRoot,
        targetPath,
        repositoryPath: targetRepositoryPath,
        componentId: componentWorktree.id,
        reason: `Target repository is inside configured worktrees root for component ${componentWorktree.id}.`,
      };
    }

    const projectMetaWorktreesRoot = path.join(
      projectWorktreesRootPath(context.projectRoot, context.projectConfig),
      context.projectConfig.id,
    );
    if (pathInside(projectMetaWorktreesRoot, targetRepositoryPath)) {
      return {
        classification: "generated_project_meta_worktree",
        projectRoot,
        sharedProjectRoot: context.projectRoot,
        targetPath,
        repositoryPath: targetRepositoryPath,
        componentId: null,
        reason: "Target repository is inside the configured workspace/meta worktrees root.",
      };
    }

    const componentSource = context.components.find((component) =>
      samePath(component.sourceRoot, targetRepositoryPath),
    );
    if (componentSource) {
      return {
        classification: "shared_component_checkout",
        projectRoot,
        sharedProjectRoot: context.projectRoot,
        targetPath,
        repositoryPath: targetRepositoryPath,
        componentId: componentSource.id,
        reason: `Target repository is the configured source root for component ${componentSource.id}.`,
      };
    }

    if (samePath(context.projectRoot, targetRepositoryPath)) {
      return {
        classification: "shared_project_checkout",
        projectRoot,
        sharedProjectRoot: context.projectRoot,
        targetPath,
        repositoryPath: targetRepositoryPath,
        componentId: null,
        reason: "Target repository is the shared DevNexus workspace checkout.",
      };
    }
  }

  return {
    classification: "unknown",
    projectRoot,
    sharedProjectRoot: contexts[0]?.projectRoot ?? null,
    targetPath,
    repositoryPath: targetRepositoryPath,
    componentId: options.componentId ?? null,
    reason: "Target repository is not a configured project checkout, component source, or generated worktree.",
  };
}

export function evaluateNexusSharedCheckoutMutation(
  options: EvaluateNexusSharedCheckoutMutationOptions,
): NexusSharedCheckoutGuardDecision {
  const override = options.override ?? null;
  if (options.mutationClass === "worktree_bootstrap" || override === "bootstrap") {
    const classified = classifyNexusCheckout(options);
    return guardDecision({
      ...classified,
      classification: "bootstrap_setup_operation",
      mutationClass: options.mutationClass,
      command: options.command,
      override,
      ok: true,
      saferNextAction: "Bootstrap/setup operation is allowed to create or adopt an owned worktree.",
    });
  }

  if (override === "allow" || override === "integration") {
    const classified = classifyNexusCheckout(options);
    return guardDecision({
      ...classified,
      classification:
        override === "integration"
          ? "integration_worktree"
          : classified.classification,
      mutationClass: options.mutationClass,
      command: options.command,
      override,
      ok: true,
      saferNextAction: `Explicit ${override} override allowed this mutation.`,
    });
  }

  const classified = classifyNexusCheckout(options);
  const ok = mutationAllowed(options.mutationClass, classified.classification);
  return guardDecision({
    ...classified,
    mutationClass: options.mutationClass,
    command: options.command,
    override,
    ok,
    saferNextAction: ok
      ? "Mutation target is an owned generated worktree for this mutation class."
      : saferNextAction(options.mutationClass, classified.classification),
  });
}

export function assertNexusSharedCheckoutMutationAllowed(
  options: EvaluateNexusSharedCheckoutMutationOptions,
): NexusSharedCheckoutGuardDecision {
  const decision = evaluateNexusSharedCheckoutMutation(options);
  if (!decision.ok) {
    throw new NexusSharedCheckoutGuardError(decision);
  }

  return decision;
}

export function parseNexusSharedCheckoutGuardOverride(
  value: string | null | undefined,
): NexusSharedCheckoutGuardOverride | null {
  if (value === undefined || value === null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "allow" ||
    normalized === "bootstrap" ||
    normalized === "integration"
  ) {
    return normalized;
  }
  throw new Error(
    "shared checkout guard override must be allow, bootstrap, or integration",
  );
}

function guardDecision(
  decision: NexusSharedCheckoutGuardDecision,
): NexusSharedCheckoutGuardDecision {
  return decision;
}

function mutationAllowed(
  mutationClass: NexusCheckoutMutationClass,
  classification: NexusCheckoutClassification,
): boolean {
  if (mutationClass === "read_only") {
    return true;
  }
  if (mutationClass === "local_remote_repair") {
    return (
      classification === "shared_project_checkout" ||
      classification === "generated_project_meta_worktree"
    );
  }
  if (classification === "generated_component_worktree") {
    return mutationClass === "component_source";
  }
  if (classification === "generated_project_meta_worktree") {
    return [
      "local_tracker",
      "target_state",
      "project_state",
      "skill_mcp_projection",
      "coordination_record",
      "cleanup_execution",
      "provider_sync",
    ].includes(mutationClass);
  }
  if (classification === "integration_worktree") {
    return mutationClass === "publication_integration";
  }
  if (classification === "bootstrap_setup_operation") {
    return mutationClass === "worktree_bootstrap";
  }

  return false;
}

function saferNextAction(
  mutationClass: NexusCheckoutMutationClass,
  classification: NexusCheckoutClassification,
): string {
  if (classification === "shared_project_checkout") {
    return "Prepare a workspace/meta worktree and rerun the project-state mutation there, or use an explicit integration/bootstrap override.";
  }
  if (classification === "shared_component_checkout") {
    return "Prepare a component worktree and rerun the source mutation there, or use an explicit integration/bootstrap override.";
  }
  if (classification === "unknown") {
    return "Run from a configured DevNexus workspace checkout or prepare an owned generated worktree before mutating.";
  }
  if (
    classification === "generated_component_worktree" &&
    mutationClass !== "component_source"
  ) {
    return "Use a workspace/meta worktree for project-state mutations; component worktrees are for component source changes.";
  }
  if (
    classification === "generated_project_meta_worktree" &&
    mutationClass === "component_source"
  ) {
    return "Use a component worktree for component source mutations; workspace/meta worktrees are for workspace state.";
  }

  return "Use an owned generated worktree or an explicit integration/bootstrap override before mutating.";
}

function projectContexts(options: {
  projectRoot: string;
  projectRepositoryPath: string | null;
  gitRunner: GitRunner;
}): ProjectContext[] {
  const contexts: ProjectContext[] = [];
  const primaryWorktree = options.projectRepositoryPath
    ? gitPrimaryWorktree(options.gitRunner, options.projectRepositoryPath)
    : null;
  const candidateRoots = uniquePaths([
    primaryWorktree,
    options.projectRoot,
  ].filter((value): value is string => Boolean(value)));
  for (const candidateRoot of candidateRoots) {
    const context = tryProjectContext(candidateRoot);
    if (context) {
      contexts.push(context);
    }
  }

  return contexts;
}

function tryProjectContext(projectRoot: string): ProjectContext | null {
  try {
    const projectConfig = loadProjectConfig(projectRoot);
    return {
      projectRoot: path.resolve(projectRoot),
      projectConfig,
      components: resolveProjectComponents(projectRoot, projectConfig),
    };
  } catch {
    return null;
  }
}

function gitTopLevel(gitRunner: GitRunner, cwd: string): string | null {
  const result = runOptionalGit(gitRunner, ["rev-parse", "--show-toplevel"], cwd);
  const resolved = result?.stdout.trim();
  return resolved ? path.resolve(resolved) : null;
}

function gitPrimaryWorktree(gitRunner: GitRunner, repositoryPath: string): string | null {
  const result = runOptionalGit(
    gitRunner,
    ["worktree", "list", "--porcelain"],
    repositoryPath,
  );
  if (!result) {
    return null;
  }
  const first = parseWorktreeList(result.stdout)[0];
  return first ? path.resolve(first.path) : null;
}

function parseWorktreeList(output: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      entries.push({ path: line.slice("worktree ".length).trim() });
    }
  }

  return entries;
}

function runOptionalGit(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result : null;
  } catch {
    return null;
  }
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

function pathInside(root: string, target: string): boolean {
  if (!fs.existsSync(root) && !path.isAbsolute(root)) {
    return false;
  }
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function canonicalPath(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = canonicalPath(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path.resolve(value));
    }
  }

  return result;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
