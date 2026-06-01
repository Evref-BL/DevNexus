import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";

export type NexusWorkspaceMetadataFreshnessStatus =
  | "current"
  | "ahead"
  | "behind"
  | "diverged"
  | "unchecked";

export interface NexusWorkspaceMetadataFreshnessReport {
  status: NexusWorkspaceMetadataFreshnessStatus;
  projectRoot: string;
  repositoryRoot: string | null;
  branch: string | null;
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  ahead: number | null;
  behind: number | null;
  changedMetadataPaths: string[];
  warnings: string[];
  blockers: string[];
}

export interface NexusWorkspaceMetadataFreshnessErrorPayload {
  ok: false;
  error: {
    code: "stale_workspace_metadata" | "workspace_metadata_freshness_unchecked";
    message: string;
  };
  workspaceMetadataFreshness: NexusWorkspaceMetadataFreshnessReport;
  nextActions: string[];
}

export class NexusWorkspaceMetadataFreshnessError extends Error {
  readonly payload: NexusWorkspaceMetadataFreshnessErrorPayload;
  readonly report: NexusWorkspaceMetadataFreshnessReport;

  constructor(payload: NexusWorkspaceMetadataFreshnessErrorPayload) {
    super(payload.error.message);
    this.name = "NexusWorkspaceMetadataFreshnessError";
    this.payload = payload;
    this.report = payload.workspaceMetadataFreshness;
  }
}

const workspaceMetadataStatusPaths = [
  "dev-nexus.project.json",
  ".dev-nexus",
  ".agents",
  "AGENTS.md",
  "CONTEXT.md",
  "PLAN.md",
];

export function assertNexusWorkspaceMetadataFreshness(options: {
  projectRoot: string;
  gitRunner?: GitRunner;
}): NexusWorkspaceMetadataFreshnessReport {
  const report = checkNexusWorkspaceMetadataFreshness(options);
  if (report.status === "behind" || report.status === "diverged") {
    throw new NexusWorkspaceMetadataFreshnessError(
      staleWorkspaceMetadataPayload(report),
    );
  }
  if (report.status === "unchecked" && report.blockers.length > 0) {
    throw new NexusWorkspaceMetadataFreshnessError(
      uncheckedWorkspaceMetadataPayload(report),
    );
  }

  return report;
}

export function checkNexusWorkspaceMetadataFreshness(options: {
  projectRoot: string;
  gitRunner?: GitRunner;
}): NexusWorkspaceMetadataFreshnessReport {
  const projectRoot = path.resolve(options.projectRoot);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const repositoryRoot = gitOutput(
    gitRunner,
    ["rev-parse", "--show-toplevel"],
    projectRoot,
  );
  const baseReport = {
    projectRoot,
    repositoryRoot,
    branch: null,
    upstream: null,
    upstreamRemote: null,
    upstreamBranch: null,
    ahead: null,
    behind: null,
    changedMetadataPaths: changedWorkspaceMetadataPaths(gitRunner, projectRoot),
    warnings: [] as string[],
    blockers: [] as string[],
  };
  if (!repositoryRoot) {
    return {
      ...baseReport,
      status: "unchecked",
      warnings: [
        "Workspace metadata freshness was not checked because the workspace root is not inside a Git repository.",
      ],
    };
  }

  const branch = gitOutput(
    gitRunner,
    ["symbolic-ref", "--short", "HEAD"],
    projectRoot,
  );
  if (!branch) {
    return {
      ...baseReport,
      status: "unchecked",
      blockers: [
        "Workspace metadata freshness cannot be checked from a detached HEAD.",
      ],
    };
  }

  const upstream = gitOutput(
    gitRunner,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    projectRoot,
  );
  if (!upstream) {
    return {
      ...baseReport,
      branch,
      status: "unchecked",
      warnings: [
        `Workspace metadata branch ${branch} has no configured upstream; stale metadata could not be checked.`,
      ],
    };
  }

  const upstreamParts = splitUpstreamRef(upstream);
  const fetched = upstreamParts
    ? fetchUpstream(gitRunner, projectRoot, upstreamParts)
    : null;
  if (fetched && fetched.exitCode !== 0) {
    return {
      ...baseReport,
      branch,
      upstream,
      upstreamRemote: upstreamParts?.remote ?? null,
      upstreamBranch: upstreamParts?.branch ?? null,
      status: "unchecked",
      blockers: [
        `Workspace metadata freshness cannot be checked because fetching ${upstream} failed: ${errorOutput(fetched)}`,
      ],
    };
  }

  const counts = aheadBehindCounts(
    gitOutput(
      gitRunner,
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      projectRoot,
    ),
  );
  if (!counts) {
    return {
      ...baseReport,
      branch,
      upstream,
      upstreamRemote: upstreamParts?.remote ?? null,
      upstreamBranch: upstreamParts?.branch ?? null,
      status: "unchecked",
      blockers: [
        `Workspace metadata freshness cannot be checked because ahead/behind counts for ${upstream} were unavailable.`,
      ],
    };
  }

  return {
    ...baseReport,
    branch,
    upstream,
    upstreamRemote: upstreamParts?.remote ?? null,
    upstreamBranch: upstreamParts?.branch ?? null,
    ahead: counts.ahead,
    behind: counts.behind,
    status: freshnessStatus(counts),
  };
}

function staleWorkspaceMetadataPayload(
  report: NexusWorkspaceMetadataFreshnessReport,
): NexusWorkspaceMetadataFreshnessErrorPayload {
  const message =
    `Workspace metadata checkout is behind ${report.upstream ?? "its upstream"} ` +
    `(ahead ${report.ahead ?? "unknown"}, behind ${report.behind ?? "unknown"}). ` +
    "Fast-forward the workspace metadata checkout before preparing a worktree.";
  return {
    ok: false,
    error: {
      code: "stale_workspace_metadata",
      message,
    },
    workspaceMetadataFreshness: report,
    nextActions: workspaceMetadataFreshnessNextActions(report),
  };
}

function uncheckedWorkspaceMetadataPayload(
  report: NexusWorkspaceMetadataFreshnessReport,
): NexusWorkspaceMetadataFreshnessErrorPayload {
  const message =
    report.blockers[0] ??
    "Workspace metadata freshness could not be checked before preparing a worktree.";
  return {
    ok: false,
    error: {
      code: "workspace_metadata_freshness_unchecked",
      message,
    },
    workspaceMetadataFreshness: report,
    nextActions: workspaceMetadataFreshnessNextActions(report),
  };
}

function workspaceMetadataFreshnessNextActions(
  report: NexusWorkspaceMetadataFreshnessReport,
): string[] {
  const actions: string[] = [];
  if (report.changedMetadataPaths.length > 0) {
    actions.push(
      `Review, commit, stash, or clean workspace metadata changes: ${report.changedMetadataPaths.join(", ")}.`,
    );
  }
  if (report.upstreamRemote && report.upstreamBranch) {
    actions.push(
      `Run git -C ${quoteShellArg(report.projectRoot)} pull --ff-only ${quoteShellArg(report.upstreamRemote)} ${quoteShellArg(report.upstreamBranch)}.`,
    );
  } else if (report.upstream) {
    actions.push(
      `Fast-forward ${report.branch ?? "the workspace branch"} from ${report.upstream}.`,
    );
  }
  actions.push(
    "Rerun dev-nexus worktree prepare after the workspace metadata checkout is current.",
  );

  return actions;
}

function changedWorkspaceMetadataPaths(
  gitRunner: GitRunner,
  projectRoot: string,
): string[] {
  const status = gitRawOutput(
    gitRunner,
    ["status", "--porcelain=v1", "--", ...workspaceMetadataStatusPaths],
    projectRoot,
  );
  if (!status) {
    return [];
  }

  const paths = new Set<string>();
  for (const line of status.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    for (const parsed of parsePorcelainPaths(line)) {
      paths.add(parsed);
    }
  }

  return [...paths];
}

function parsePorcelainPaths(line: string): string[] {
  const raw = line.slice(3).trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(" -> ")
    .map((value) => value.replace(/^"|"$/gu, ""))
    .filter((value) => value.length > 0);
}

function splitUpstreamRef(
  upstream: string,
): { remote: string; branch: string } | null {
  const separator = upstream.indexOf("/");
  if (separator <= 0 || separator === upstream.length - 1) {
    return null;
  }

  return {
    remote: upstream.slice(0, separator),
    branch: upstream.slice(separator + 1),
  };
}

function fetchUpstream(
  gitRunner: GitRunner,
  projectRoot: string,
  upstream: { remote: string; branch: string },
): GitCommandResult {
  return gitRunner(
    [
      "fetch",
      "--prune",
      upstream.remote,
      `refs/heads/${upstream.branch}:refs/remotes/${upstream.remote}/${upstream.branch}`,
    ],
    projectRoot,
  );
}

function aheadBehindCounts(
  output: string | null,
): { ahead: number; behind: number } | null {
  if (!output) {
    return null;
  }
  const [aheadValue, behindValue] = output.trim().split(/\s+/u);
  const ahead = Number(aheadValue);
  const behind = Number(behindValue);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return null;
  }

  return { ahead, behind };
}

function freshnessStatus(counts: {
  ahead: number;
  behind: number;
}): NexusWorkspaceMetadataFreshnessStatus {
  if (counts.behind > 0 && counts.ahead > 0) {
    return "diverged";
  }
  if (counts.behind > 0) {
    return "behind";
  }
  if (counts.ahead > 0) {
    return "ahead";
  }

  return "current";
}

function gitOutput(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  try {
    const result = gitRunner(args, cwd);
    if (result.exitCode !== 0) {
      return null;
    }
    const output = result.stdout.trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function gitRawOutput(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  try {
    const result = gitRunner(args, cwd);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.length > 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

function errorOutput(result: GitCommandResult): string {
  return (result.stderr || result.stdout || `exit ${result.exitCode ?? "unknown"}`)
    .trim()
    .replace(/\s+/gu, " ");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) {
    return value;
  }

  return `'${value.replace(/'/gu, "'\\''")}'`;
}
