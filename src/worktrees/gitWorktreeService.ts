import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveNexusCommandPath } from "../runtime/nexusCommandPath.js";
import {
  asciiWordBreaks,
  isAsciiLetterOrDigit,
  replaceRunsWithHyphen,
  trimHyphens,
} from "../runtime/nexusTextNormalization.js";

export interface GitCommandResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GitRunner = (
  args: readonly string[],
  cwd?: string,
) => GitCommandResult;

export interface PrepareGitWorktreeOptions {
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  branchName: string;
  worktreeName?: string;
  baseRef?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  gitIdentity?: PreparedGitWorktreeIdentity | null;
  gitRunner?: GitRunner;
}

export interface PreparedGitWorktreeWorkItem {
  id: string;
  title: string | null;
}

export interface PreparedGitWorktreeIdentity {
  name: string;
  email: string;
}

export interface PrepareGitWorktreeResult {
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: PreparedGitWorktreeWorkItem | null;
  gitIdentity: PreparedGitWorktreeIdentity | null;
  git: {
    commands: GitCommandResult[];
  };
}

export interface RemoveGitWorktreeOptions {
  sourceRoot: string;
  worktreePath: string;
  force?: boolean;
  gitRunner?: GitRunner;
}

export interface RemoveGitWorktreeResult {
  sourceRoot: string;
  worktreePath: string;
  git: {
    commands: GitCommandResult[];
  };
}

export interface DeleteGitBranchOptions {
  sourceRoot: string;
  branchName: string;
  force?: boolean;
  gitRunner?: GitRunner;
}

export interface DeleteGitBranchResult {
  sourceRoot: string;
  branchName: string;
  force: boolean;
  git: {
    commands: GitCommandResult[];
  };
}

export class GitWorktreeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitWorktreeServiceError";
  }
}

export function prepareGitWorktree(
  options: PrepareGitWorktreeOptions,
): PrepareGitWorktreeResult {
  const componentId = requiredNonEmptyString(options.componentId, "componentId");
  const sourceRoot = path.resolve(options.sourceRoot);
  const worktreesRoot = path.resolve(options.worktreesRoot);
  const branchName = normalizeBranchName(options.branchName);
  const baseRef = optionalNullableString(options.baseRef, "baseRef");
  const worktreeName = options.worktreeName
    ? normalizeWorktreeName(options.worktreeName)
    : safeDirectoryName(branchName);
  const workItem = normalizePreparedWorktreeWorkItem(
    options.workItemId,
    options.workItemTitle,
  );
  const gitIdentity = normalizePreparedGitIdentity(options.gitIdentity);
  const worktreePath = path.join(worktreesRoot, worktreeName);
  assertSafeWorktreePath(worktreesRoot, worktreePath);
  if (fs.existsSync(worktreePath)) {
    throw new GitWorktreeServiceError(
      `Worktree path already exists: ${worktreePath}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  const localBranch = readLocalBranchCheckout({
    gitRunner,
    commands,
    sourceRoot,
    branchName,
  });
  if (localBranch.checkedOutAt) {
    throw new GitWorktreeServiceError(
      `Branch ${branchName} is already checked out at ${localBranch.checkedOutAt}. Reuse that worktree or choose a different branch name.`,
    );
  }
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const addArgs = localBranch.exists
    ? ["worktree", "add", worktreePath, branchName]
    : [
        "worktree",
        "add",
        "-b",
        branchName,
        worktreePath,
        ...(baseRef ? [baseRef] : []),
      ];
  runGitCommand(gitRunner, commands, addArgs, sourceRoot);
  if (gitIdentity) {
    runGitCommand(
      gitRunner,
      commands,
      ["config", "--local", "user.name", gitIdentity.name],
      worktreePath,
    );
    runGitCommand(
      gitRunner,
      commands,
      ["config", "--local", "user.email", gitIdentity.email],
      worktreePath,
    );
  }

  return {
    componentId,
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName,
    baseRef,
    workItem,
    gitIdentity,
    git: {
      commands,
    },
  };
}

export function removeGitWorktree(
  options: RemoveGitWorktreeOptions,
): RemoveGitWorktreeResult {
  const sourceRoot = path.resolve(options.sourceRoot);
  const worktreePath = path.resolve(options.worktreePath);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  runGitCommand(
    gitRunner,
    commands,
    ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreePath],
    sourceRoot,
  );

  return {
    sourceRoot,
    worktreePath,
    git: {
      commands,
    },
  };
}

export function deleteGitBranch(
  options: DeleteGitBranchOptions,
): DeleteGitBranchResult {
  const sourceRoot = path.resolve(options.sourceRoot);
  const branchName = normalizeBranchName(options.branchName);
  const force = options.force === true;
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  runGitCommand(
    gitRunner,
    commands,
    ["branch", force ? "-D" : "-d", branchName],
    sourceRoot,
  );

  return {
    sourceRoot,
    branchName,
    force,
    git: {
      commands,
    },
  };
}

export function normalizeBranchName(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.length === 0) {
    throw new GitWorktreeServiceError("branchName must be non-empty");
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    /[\u0000-\u001F ~^:?*[\\]/u.test(trimmed)
  ) {
    throw new GitWorktreeServiceError(`Invalid branchName: ${value}`);
  }

  return trimmed;
}

export function safeDirectoryName(value: string): string {
  const sanitized = trimHyphens(
    replaceRunsWithHyphen(
      asciiWordBreaks(value.trim()),
      (character) => !isWorktreeDirectoryNameCharacter(character),
    ),
  ).toLowerCase();

  if (!sanitized) {
    throw new GitWorktreeServiceError(
      "Worktree name must contain at least one filesystem-safe character",
    );
  }
  if (sanitized === "." || sanitized === ".." || sanitized.includes("..")) {
    throw new GitWorktreeServiceError(`Invalid worktreeName: ${value}`);
  }

  return sanitized;
}

function isWorktreeDirectoryNameCharacter(character: string): boolean {
  return isAsciiLetterOrDigit(character) ||
    character === "." ||
    character === "_" ||
    character === "-";
}

export function normalizeWorktreeName(value: string): string {
  const trimmed = requiredNonEmptyString(value, "worktreeName");
  if (
    path.isAbsolute(trimmed) ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("..") ||
    /[\\/]/u.test(trimmed) ||
    !/^[A-Za-z0-9._-]+$/u.test(trimmed)
  ) {
    throw new GitWorktreeServiceError(`Invalid worktreeName: ${value}`);
  }

  return trimmed;
}

export function assertSafeWorktreePath(
  worktreesRoot: string,
  worktreePath: string,
): void {
  const resolvedRoot = path.resolve(worktreesRoot);
  const resolvedTarget = path.resolve(worktreePath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GitWorktreeServiceError(
      `Worktree path must be inside worktrees root: ${resolvedTarget}`,
    );
  }
}

export function defaultGitRunner(
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = spawnSync(resolveNexusCommandPath("git"), [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new GitWorktreeServiceError(
      `Failed to run git ${args.join(" ")}: ${result.error.message}`,
    );
  }

  return {
    args: [...args],
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
}

function readLocalBranchCheckout(options: {
  gitRunner: GitRunner;
  commands: GitCommandResult[];
  sourceRoot: string;
  branchName: string;
}): { exists: boolean; checkedOutAt: string | null } {
  const branchRef = `refs/heads/${options.branchName}`;
  const refResult = runGitCommand(
    options.gitRunner,
    options.commands,
    ["for-each-ref", "--format=%(refname)", branchRef],
    options.sourceRoot,
  );
  const exists = refResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes(branchRef);
  if (!exists) {
    return { exists: false, checkedOutAt: null };
  }

  const worktreeList = runGitCommand(
    options.gitRunner,
    options.commands,
    ["worktree", "list", "--porcelain"],
    options.sourceRoot,
  );
  return {
    exists: true,
    checkedOutAt: worktreePathForBranch(
      worktreeList.stdout,
      options.branchName,
    ),
  };
}

function worktreePathForBranch(
  porcelain: string,
  branchName: string,
): string | null {
  const expectedBranch = `refs/heads/${branchName}`;
  let currentWorktree: string | null = null;
  for (const line of porcelain.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      currentWorktree = line.slice("worktree ".length).trim();
      continue;
    }
    if (line.trim() === "") {
      currentWorktree = null;
      continue;
    }
    if (line === `branch ${expectedBranch}`) {
      return currentWorktree;
    }
  }

  return null;
}

export function runGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = gitRunner(args, cwd);
  commands.push(result);

  if (result.exitCode !== 0) {
    throw new GitWorktreeServiceError(
      `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  return result;
}

function normalizePreparedWorktreeWorkItem(
  workItemId: string | null | undefined,
  workItemTitle: string | null | undefined,
): PreparedGitWorktreeWorkItem | null {
  if (workItemId === undefined || workItemId === null) {
    return null;
  }

  return {
    id: requiredNonEmptyString(workItemId, "workItemId"),
    title: optionalNullableString(workItemTitle, "workItemTitle"),
  };
}

function normalizePreparedGitIdentity(
  value: PreparedGitWorktreeIdentity | null | undefined,
): PreparedGitWorktreeIdentity | null {
  if (value === undefined || value === null) {
    return null;
  }

  return {
    name: requiredNonEmptyString(value.name, "gitIdentity.name"),
    email: requiredNonEmptyString(value.email, "gitIdentity.email"),
  };
}

function optionalNullableString(
  value: string | null | undefined,
  name: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GitWorktreeServiceError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
