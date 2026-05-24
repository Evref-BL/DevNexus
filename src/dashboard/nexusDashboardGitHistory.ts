import type { GitRunner } from "../worktrees/gitWorktreeService.js";

export type NexusDashboardGitHistoryRefKind =
  | "head"
  | "branch"
  | "remote"
  | "tag";

export interface NexusDashboardGitHistoryRef {
  name: string;
  kind: NexusDashboardGitHistoryRefKind;
  remote: string | null;
  hash: string;
}

export interface NexusDashboardGitHistoryCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committedAt: string | null;
  subject: string;
  refs: NexusDashboardGitHistoryRef[];
}

export interface NexusDashboardGitHistoryRepository {
  componentId: string;
  componentName: string;
  repositoryPath: string;
  head: string | null;
  defaultBranch: string | null;
  scope: {
    kind: "all" | "branches";
    branches: string[];
  };
  commits: NexusDashboardGitHistoryCommit[];
  branchNames: string[];
  tagNames: string[];
  moreAvailable: boolean;
  warnings: string[];
}

export interface NexusDashboardGitHistorySummary {
  totalCommitCount: number;
  repositories: NexusDashboardGitHistoryRepository[];
  incomplete: boolean;
  detail: string | null;
}

export interface NexusDashboardGitHistoryComponent {
  id: string;
  name: string;
  sourceRoot: string;
  sourceRootExists: boolean;
  git?: {
    repositoryPath: string;
    headCommit: string | null;
  } | null;
}

export interface NexusDashboardGitHistoryBranchReference {
  branchName: string;
  componentId: string | null;
  componentName: string | null;
  updatedAt: string | null;
}

const dashboardGitHistorySeparator = "\x1f";
const dashboardGitHistoryRecordSeparator = "\x1e";
const dashboardGitHistoryDefaultMaxCommits = 120;

export function summarizeGitHistory(options: {
  components: NexusDashboardGitHistoryComponent[];
  defaultBranch: string | null;
  gitRunner: GitRunner;
  branches?: string[];
  maxCommits?: number;
}): NexusDashboardGitHistorySummary {
  const repositories = options.components
    .filter((component) => component.sourceRootExists && component.git?.repositoryPath)
    .map((component) =>
      collectDashboardGitHistory(component, options.gitRunner, {
        branches: options.branches,
        defaultBranch: options.defaultBranch,
        maxCommits: options.maxCommits,
      }),
    )
    .filter((repository): repository is NexusDashboardGitHistoryRepository =>
      repository !== null,
    );
  const totalCommitCount = repositories.reduce(
    (total, repository) => total + repository.commits.length,
    0,
  );
  return {
    totalCommitCount,
    repositories,
    incomplete: repositories.some((repository) => repository.warnings.length > 0),
    detail: repositories.flatMap((repository) => repository.warnings)[0] ?? null,
  };
}

function collectDashboardGitHistory(
  component: NexusDashboardGitHistoryComponent,
  gitRunner: GitRunner,
  options: {
    branches?: string[];
    defaultBranch: string | null;
    maxCommits?: number;
  },
): NexusDashboardGitHistoryRepository | null {
  const repositoryPath = component.git?.repositoryPath ?? component.sourceRoot;
  const refOutput = gitRawStdout(gitRunner, ["show-ref", "-d", "--head"], repositoryPath);
  const refs = parseDashboardGitRefs(refOutput ?? "");
  const head = refs.find((ref) => ref.kind === "head")?.hash ?? component.git?.headCommit ?? null;
  const branches = uniqueNonEmptyStrings(options.branches ?? []);
  const maxCommits = Math.max(
    1,
    Math.floor(options.maxCommits ?? dashboardGitHistoryDefaultMaxCommits),
  );
  const logArgs = dashboardGitHistoryLogArgs({
    branches,
    maxCommits: maxCommits + 1,
  });
  const logOutput = gitRawStdout(gitRunner, logArgs, repositoryPath);
  if (logOutput === null) {
    return {
      componentId: component.id,
      componentName: component.name,
      repositoryPath,
      head,
      defaultBranch: options.defaultBranch,
      scope: {
        kind: branches.length > 0 ? "branches" : "all",
        branches,
      },
      commits: [],
      branchNames: branchNamesFromRefs(refs),
      tagNames: tagNamesFromRefs(refs),
      moreAvailable: false,
      warnings: ["Git history could not be read."],
    };
  }
  const parsedCommits = parseDashboardGitHistoryLog(logOutput, refs);
  const commits = parsedCommits.slice(0, maxCommits);
  return {
    componentId: component.id,
    componentName: component.name,
    repositoryPath,
    head,
    defaultBranch: options.defaultBranch,
    scope: {
      kind: branches.length > 0 ? "branches" : "all",
      branches,
    },
    commits,
    branchNames: branchNamesFromRefs(refs),
    tagNames: tagNamesFromRefs(refs),
    moreAvailable: parsedCommits.length > maxCommits,
    warnings: [],
  };
}

function dashboardGitHistoryLogArgs(options: {
  branches: string[];
  maxCommits: number;
}): string[] {
  const args = [
    "-c",
    "log.showSignature=false",
    "log",
    `--max-count=${options.maxCommits}`,
    "--date-order",
    `--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%s%x1e`,
  ];
  if (options.branches.length > 0) {
    args.push(...options.branches);
  } else {
    args.push("--all", "--branches", "--remotes", "--tags");
  }
  args.push("--");
  return args;
}

function parseDashboardGitHistoryLog(
  output: string,
  refs: NexusDashboardGitHistoryRef[],
): NexusDashboardGitHistoryCommit[] {
  const refsByHash = refs.reduce((map, ref) => {
    const existing = map.get(ref.hash) ?? [];
    existing.push(ref);
    map.set(ref.hash, existing);
    return map;
  }, new Map<string, NexusDashboardGitHistoryRef[]>());
  return output
    .split(dashboardGitHistoryRecordSeparator)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const fields = record.split(dashboardGitHistorySeparator);
      const hash = fields[0] ?? "";
      const parentField = fields[1] ?? "";
      const timestamp = Number(fields[4]);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parentField ? parentField.split(" ").filter(Boolean) : [],
        authorName: fields[2] ?? "",
        authorEmail: fields[3] ?? "",
        committedAt: Number.isFinite(timestamp)
          ? new Date(timestamp * 1000).toISOString()
          : null,
        subject: fields.slice(5).join(dashboardGitHistorySeparator),
        refs: refsByHash.get(hash) ?? [],
      };
    })
    .filter((commit) => commit.hash);
}

function parseDashboardGitRefs(output: string): NexusDashboardGitHistoryRef[] {
  const refs: NexusDashboardGitHistoryRef[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [hash, ...refParts] = trimmed.split(/\s+/u);
    const refName = refParts.join(" ");
    if (!hash || !refName) {
      continue;
    }
    const parsed = dashboardGitRef(hash, refName);
    if (parsed) {
      refs.push(parsed);
    }
  }
  return refs;
}

function dashboardGitRef(
  hash: string,
  refName: string,
): NexusDashboardGitHistoryRef | null {
  if (refName === "HEAD") {
    return {
      name: "HEAD",
      kind: "head",
      remote: null,
      hash,
    };
  }
  if (refName.startsWith("refs/heads/")) {
    return {
      name: refName.slice("refs/heads/".length),
      kind: "branch",
      remote: null,
      hash,
    };
  }
  if (refName.startsWith("refs/remotes/") && !refName.endsWith("/HEAD")) {
    const name = refName.slice("refs/remotes/".length);
    return {
      name,
      kind: "remote",
      remote: name.split("/")[0] ?? null,
      hash,
    };
  }
  if (refName.startsWith("refs/tags/")) {
    const name = refName.endsWith("^{}")
      ? refName.slice("refs/tags/".length, -3)
      : refName.slice("refs/tags/".length);
    return {
      name,
      kind: "tag",
      remote: null,
      hash,
    };
  }
  return null;
}

function branchNamesFromRefs(refs: NexusDashboardGitHistoryRef[]): string[] {
  return uniqueNonEmptyStrings(
    refs
      .filter((ref) => ref.kind === "branch" || ref.kind === "remote")
      .map((ref) => ref.name),
  );
}

function tagNamesFromRefs(refs: NexusDashboardGitHistoryRef[]): string[] {
  return uniqueNonEmptyStrings(
    refs
      .filter((ref) => ref.kind === "tag")
      .map((ref) => ref.name),
  );
}

export function gitHistoryBranchReferences(
  history: NexusDashboardGitHistorySummary,
): NexusDashboardGitHistoryBranchReference[] {
  return history.repositories.flatMap((repository) =>
    repository.branchNames.map((branchName) => ({
      branchName,
      componentId: repository.componentId,
      componentName: repository.componentName,
      updatedAt: gitHistoryBranchUpdatedAt(repository, branchName),
    })),
  );
}

function gitHistoryBranchUpdatedAt(
  repository: NexusDashboardGitHistoryRepository,
  branchName: string,
): string | null {
  const normalized = normalizeDashboardBranchName(branchName);
  const commit = repository.commits.find((candidate) =>
    candidate.refs.some((ref) =>
      (ref.kind === "branch" || ref.kind === "remote") &&
      normalizeDashboardBranchName(ref.name) === normalized
    ),
  );
  return commit?.committedAt ?? null;
}

export function normalizeDashboardBranchName(branchName: string): string {
  return branchName
    .trim()
    .replace(/^refs\/heads\//u, "")
    .replace(/^refs\/remotes\//u, "");
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

function uniqueNonEmptyStrings(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}
