import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  defaultGitRunner,
  type GitRunner,
} from "./gitWorktreeService.js";
import type {
  NexusAutomationConfig,
  NexusAutomationDependencyLinkConfig,
} from "./nexusAutomationConfig.js";
import {
  materializeNexusWorkerContextBundle,
  type MaterializeNexusWorkerContextBundleResult,
  type NexusWorkerContextBundleWorktree,
} from "./nexusWorkerContextBundle.js";

export type NexusAutomationWorktreeSetupLinkStatus =
  | "linked"
  | "present"
  | "skipped";

export interface NexusAutomationWorktreeSetupPreflightCheck {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface NexusAutomationWorktreeSetupLinkResult {
  source: string;
  target: string;
  sourcePath: string;
  targetPath: string;
  required: boolean;
  status: NexusAutomationWorktreeSetupLinkStatus;
  message: string;
}

export interface NexusAutomationWorktreeSetupResult {
  links: NexusAutomationWorktreeSetupLinkResult[];
  context?: MaterializeNexusWorkerContextBundleResult;
}

export interface NexusAutomationWorktreeSetupContextInput {
  project: {
    id?: string | null;
    name?: string | null;
    root: string;
  };
  ownership: NexusWorkerContextBundleWorktree;
  targetStatePath?: string | null;
}

export interface NexusAutomationWorktreeSetupOptions {
  sourceRoot: string;
  worktreesRoot?: string;
  worktreePath: string;
  automationConfig: NexusAutomationConfig;
  context?: NexusAutomationWorktreeSetupContextInput;
  gitRunner?: GitRunner;
  platform?: NodeJS.Platform;
}

export class NexusAutomationWorktreeSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationWorktreeSetupError";
  }
}

export function preflightNexusAutomationWorktreeSetup(options: {
  sourceRoot: string;
  automationConfig: NexusAutomationConfig;
}): NexusAutomationWorktreeSetupPreflightCheck[] {
  const sourceRoot = path.resolve(
    requiredNonEmptyString(options.sourceRoot, "sourceRoot"),
  );

  return options.automationConfig.setup.dependencyLinks.map((link, index) => {
      const name = `dependencyLink:${index}`;
      try {
        const sourcePath = resolveInsideRoot(sourceRoot, link.source, "source");
      resolveInsideRoot(sourceRoot, link.target, "target");
      if (!fs.existsSync(sourcePath)) {
        if (link.required) {
          return {
            name,
            status: "failed",
            message: `Required dependency link source does not exist: ${sourcePath}`,
          };
        }

        return {
          name,
          status: "passed",
          message: `Optional dependency link source is absent and will be skipped: ${sourcePath}`,
        };
      }

      return {
        name,
        status: "passed",
        message: `Dependency link ${link.source} -> ${link.target} is safe to materialize`,
      };
    } catch (error) {
      return {
        name,
        status: "failed",
        message: errorMessage(error),
      };
    }
  });
}

export function materializeNexusAutomationWorktreeSetup(
  options: NexusAutomationWorktreeSetupOptions,
): NexusAutomationWorktreeSetupResult {
  const sourceRoot = path.resolve(
    requiredNonEmptyString(options.sourceRoot, "sourceRoot"),
  );
  const worktreePath = path.resolve(
    requiredNonEmptyString(options.worktreePath, "worktreePath"),
  );
  if (options.worktreesRoot) {
    assertWorktreePathInsideRoot(options.worktreesRoot, worktreePath);
  }
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const platform = options.platform ?? process.platform;

  const links = options.automationConfig.setup.dependencyLinks.map((link) =>
    materializeDependencyLink({
      link,
      sourceRoot,
      worktreePath,
      gitRunner,
      platform,
    }),
  );
  const context = options.context
    ? materializeWorkerContext({
        context: options.context,
        automationConfig: options.automationConfig,
        sourceRoot,
        worktreesRoot: options.worktreesRoot,
        worktreePath,
        gitRunner,
      })
    : undefined;

  return {
    links,
    ...(context ? { context } : {}),
  };
}

function materializeWorkerContext(options: {
  context: NexusAutomationWorktreeSetupContextInput;
  automationConfig: NexusAutomationConfig;
  sourceRoot: string;
  worktreesRoot?: string;
  worktreePath: string;
  gitRunner: GitRunner;
}): MaterializeNexusWorkerContextBundleResult {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.context.project.root, "context.project.root"),
  );
  const ownership = options.context.ownership;
  const ownershipSourceRoot = path.resolve(
    requiredNonEmptyString(ownership.sourceRoot, "context.ownership.sourceRoot"),
  );
  const ownershipWorktreesRoot = path.resolve(
    requiredNonEmptyString(
      ownership.worktreesRoot,
      "context.ownership.worktreesRoot",
    ),
  );
  const ownershipWorktreePath = path.resolve(
    requiredNonEmptyString(
      ownership.worktreePath,
      "context.ownership.worktreePath",
    ),
  );

  if (ownershipSourceRoot !== options.sourceRoot) {
    throw new NexusAutomationWorktreeSetupError(
      `context.ownership.sourceRoot must match sourceRoot: ${ownershipSourceRoot}`,
    );
  }
  if (options.worktreesRoot) {
    const setupWorktreesRoot = path.resolve(options.worktreesRoot);
    if (ownershipWorktreesRoot !== setupWorktreesRoot) {
      throw new NexusAutomationWorktreeSetupError(
        `context.ownership.worktreesRoot must match worktreesRoot: ${ownershipWorktreesRoot}`,
      );
    }
  }
  if (ownershipWorktreePath !== options.worktreePath) {
    throw new NexusAutomationWorktreeSetupError(
      `context.ownership.worktreePath must match worktreePath: ${ownershipWorktreePath}`,
    );
  }

  const result = materializeNexusWorkerContextBundle({
    projectRoot,
    projectId: options.context.project.id ?? null,
    projectName: options.context.project.name ?? null,
    componentId: ownership.componentId,
    sourceRoot: ownershipSourceRoot,
    worktreesRoot: ownershipWorktreesRoot,
    worktreePath: ownershipWorktreePath,
    branchName: ownership.branchName,
    baseRef: ownership.baseRef,
    workItem: ownership.workItem,
    targetStatePath:
      options.context.targetStatePath ?? options.automationConfig.target.statePath,
  });
  addGitInfoExclude({
    worktreePath: options.worktreePath,
    targetPath: result.contextDirectoryPath,
    isDirectory: true,
    gitRunner: options.gitRunner,
  });

  return result;
}

function materializeDependencyLink(options: {
  link: NexusAutomationDependencyLinkConfig;
  sourceRoot: string;
  worktreePath: string;
  gitRunner: GitRunner;
  platform: NodeJS.Platform;
}): NexusAutomationWorktreeSetupLinkResult {
  const sourcePath = resolveInsideRoot(
    options.sourceRoot,
    options.link.source,
    "source",
  );
  const targetPath = resolveInsideRoot(
    options.worktreePath,
    options.link.target,
    "target",
  );

  if (!fs.existsSync(sourcePath)) {
    if (options.link.required) {
      throw new NexusAutomationWorktreeSetupError(
        `Required dependency link source does not exist: ${sourcePath}`,
      );
    }

    return linkResult({
      link: options.link,
      sourcePath,
      targetPath,
      status: "skipped",
      message: `Optional dependency link source is absent: ${sourcePath}`,
    });
  }

  if (fs.existsSync(targetPath)) {
    return linkResult({
      link: options.link,
      sourcePath,
      targetPath,
      status: "present",
      message: `Dependency link target already exists: ${targetPath}`,
    });
  }

  const sourceStats = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.symlinkSync(
    sourcePath,
    targetPath,
    symlinkType(sourceStats, options.platform),
  );
  addGitInfoExclude({
    worktreePath: options.worktreePath,
    targetPath,
    isDirectory: sourceStats.isDirectory(),
    gitRunner: options.gitRunner,
  });

  return linkResult({
    link: options.link,
    sourcePath,
    targetPath,
    status: "linked",
    message: `Linked dependency ${sourcePath} -> ${targetPath}`,
  });
}

function addGitInfoExclude(options: {
  worktreePath: string;
  targetPath: string;
  isDirectory: boolean;
  gitRunner: GitRunner;
}): void {
  const result = options.gitRunner(
    ["rev-parse", "--git-path", "info/exclude"],
    options.worktreePath,
  );
  if (result.exitCode !== 0) {
    throw new NexusAutomationWorktreeSetupError(
      `git rev-parse --git-path info/exclude failed: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  const rawPath = result.stdout.trim();
  if (!rawPath) {
    throw new NexusAutomationWorktreeSetupError(
      "git rev-parse --git-path info/exclude returned an empty path",
    );
  }

  const excludePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(options.worktreePath, rawPath);
  const entry = gitExcludeEntry(
    options.worktreePath,
    options.targetPath,
    options.isDirectory,
  );
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8").split(/\r?\n/u)
    : [];
  if (!existing.includes(entry)) {
    fs.appendFileSync(excludePath, `${entry}\n`, "utf8");
  }
}

function gitExcludeEntry(
  worktreePath: string,
  targetPath: string,
  isDirectory: boolean,
): string {
  const relative = path.relative(path.resolve(worktreePath), path.resolve(targetPath));
  const normalized = relative.split(path.sep).join("/");
  return isDirectory && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function symlinkType(
  sourceStats: fs.Stats,
  platform: NodeJS.Platform,
): fs.symlink.Type {
  if (!sourceStats.isDirectory()) {
    return "file";
  }

  return platform === "win32" ? "junction" : "dir";
}

function linkResult(options: {
  link: NexusAutomationDependencyLinkConfig;
  sourcePath: string;
  targetPath: string;
  status: NexusAutomationWorktreeSetupLinkStatus;
  message: string;
}): NexusAutomationWorktreeSetupLinkResult {
  return {
    source: options.link.source,
    target: options.link.target,
    sourcePath: options.sourcePath,
    targetPath: options.targetPath,
    required: options.link.required,
    status: options.status,
    message: options.message,
  };
}

function resolveInsideRoot(root: string, value: string, name: string): string {
  const trimmed = requiredNonEmptyString(value, name);
  if (path.isAbsolute(trimmed)) {
    throw new NexusAutomationWorktreeSetupError(
      `${name} must be relative: ${trimmed}`,
    );
  }

  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, trimmed);
  const relative = path.relative(rootPath, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationWorktreeSetupError(
      `${name} must resolve inside ${rootPath}: ${trimmed}`,
    );
  }

  return resolved;
}

function assertWorktreePathInsideRoot(
  worktreesRoot: string,
  worktreePath: string,
): void {
  const rootPath = path.resolve(
    requiredNonEmptyString(worktreesRoot, "worktreesRoot"),
  );
  const resolvedWorktreePath = path.resolve(worktreePath);
  const relative = path.relative(rootPath, resolvedWorktreePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationWorktreeSetupError(
      `worktreePath must resolve inside worktreesRoot: ${resolvedWorktreePath}`,
    );
  }
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationWorktreeSetupError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
