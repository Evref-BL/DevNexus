
import type { GitRunner } from "../../worktrees/gitWorktreeService.js";
import type { NexusDashboardGitState } from "./nexusDashboardTypes.js";

export function collectDashboardGitState(
  repositoryPath: string,
  gitRunner: GitRunner,
): NexusDashboardGitState | null {
  const root = gitStdout(gitRunner, ["rev-parse", "--show-toplevel"], repositoryPath);
  if (!root) {
    return null;
  }
  const branch = gitStdout(gitRunner, ["rev-parse", "--abbrev-ref", "HEAD"], root);
  const headCommit = gitStdout(gitRunner, ["rev-parse", "HEAD"], root);
  const upstream = gitStdout(
    gitRunner,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    root,
  );
  const status = parseDashboardPorcelainStatus(
    gitRawStdout(gitRunner, ["status", "--porcelain=v1"], root) ?? "",
  );
  const aheadBehind = upstream
    ? parseAheadBehind(
        gitStdout(gitRunner, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], root),
      )
    : { ahead: null, behind: null };

  return {
    repositoryPath: root,
    branch,
    upstream,
    headCommit,
    dirty: status.dirty,
    stagedCount: status.stagedCount,
    unstagedCount: status.unstagedCount,
    untrackedCount: status.untrackedCount,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    warnings: upstream ? [] : ["Current branch has no upstream configured."],
  };
}

function parseDashboardPorcelainStatus(output: string): {
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
} {
  const changes = output.split(/\r?\n/u).filter(Boolean);
  return {
    dirty: changes.length > 0,
    stagedCount: changes.filter((line) => !line.startsWith("??") && line[0] !== " ").length,
    unstagedCount: changes.filter((line) => !line.startsWith("??") && line[1] !== " ").length,
    untrackedCount: changes.filter((line) => line.startsWith("??")).length,
  };
}

function parseAheadBehind(value: string | null): {
  ahead: number | null;
  behind: number | null;
} {
  if (!value) {
    return { ahead: null, behind: null };
  }
  const [ahead, behind] = value.split(/\s+/u).map((part) => Number(part));
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

function gitStdout(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  const stdout = gitRawStdout(gitRunner, args, cwd);
  const trimmed = stdout?.trim();
  return trimmed ? trimmed : null;
}

function gitRawStdout(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}
