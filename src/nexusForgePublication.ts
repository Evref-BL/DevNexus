import { spawnSync } from "node:child_process";
import process from "node:process";
import { shellQuoteArgument } from "./nexusAutomationAgentProfile.js";
import type { NexusPublicationActorConfig } from "./nexusAutomationConfig.js";
import type { NexusPublicationProviderEvidenceInput } from "./nexusPublicationProviderEvidence.js";
import type { NexusResolvedProviderCredential } from "./nexusProviderCredentialBroker.js";

export type NexusForgePublicationCapability =
  | "actor.verify"
  | "pull_request.upsert"
  | "pull_request.checks"
  | "pull_request.merge"
  | "issue.close";

export type NexusForgePublicationBackend =
  | "github_rest"
  | "github_cli"
  | "unsupported";

export type NexusForgePublicationBackendPreference =
  | "auto"
  | "github_rest"
  | "github_cli";

export type NexusForgePublicationErrorCode =
  | "unsupported_provider"
  | "unsupported_capability"
  | "missing_credential"
  | "provider_request_failed"
  | "command_failed"
  | "invalid_provider_response";

export interface NexusForgeRepositoryRef {
  provider: string;
  host?: string | null;
  owner: string;
  name: string;
}

export interface NexusForgePublicationOperationMetadata {
  provider: string;
  backend: NexusForgePublicationBackend;
  capability: NexusForgePublicationCapability;
}

export interface NexusForgeObservedActor {
  provider: string;
  handle: string;
  source: string;
  backend: NexusForgePublicationBackend;
}

export interface NexusForgeActorVerificationResult {
  expected: NexusPublicationActorConfig | null;
  observed: NexusForgeObservedActor;
  matched: boolean | null;
  metadata: NexusForgePublicationOperationMetadata;
}

export interface NexusForgePullRequestResult {
  number: number;
  url: string | null;
  state: string | null;
  title: string | null;
  metadata: NexusForgePublicationOperationMetadata;
}

export interface NexusForgePullRequestChecksResult {
  evidence: NexusPublicationProviderEvidenceInput;
  metadata: NexusForgePublicationOperationMetadata;
}

export interface NexusForgePullRequestMergeResult {
  merged: boolean;
  sha: string | null;
  message: string | null;
  metadata: NexusForgePublicationOperationMetadata;
}

export interface NexusForgeIssueCloseResult {
  number: number;
  state: string | null;
  url: string | null;
  metadata: NexusForgePublicationOperationMetadata;
}

export interface NexusForgePublicationCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NexusForgePublicationOperationArgument =
  | string
  | number
  | boolean
  | null;

export interface NexusForgePublicationOperationPlan {
  provider: string;
  repository: string;
  capability: NexusForgePublicationCapability;
  backendPreference: NexusForgePublicationBackendPreference;
  command: string | null;
  arguments: Record<string, NexusForgePublicationOperationArgument>;
}

export type NexusForgePublicationCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
  },
) => NexusForgePublicationCommandResult;

export interface NexusForgePublicationAdapter {
  readonly provider: string;
  readonly backend: NexusForgePublicationBackend;
  readonly capabilities: NexusForgePublicationCapability[];
  assertCapability(capability: NexusForgePublicationCapability): void;
  verifyActor(options: {
    expected?: NexusPublicationActorConfig | null;
  }): Promise<NexusForgeActorVerificationResult>;
  upsertPullRequest(options: {
    number?: number | null;
    head: string;
    base: string;
    title: string;
    body?: string | null;
    draft?: boolean;
  }): Promise<NexusForgePullRequestResult>;
  inspectPullRequestChecks(options: {
    number: number;
    requiredChecks?: string[];
  }): Promise<NexusForgePullRequestChecksResult>;
  mergePullRequest(options: {
    number: number;
    method?: "merge" | "squash" | "rebase";
    deleteBranch?: boolean;
  }): Promise<NexusForgePullRequestMergeResult>;
  closeIssue(options: {
    number: number;
    reason?: "completed" | "not_planned" | null;
  }): Promise<NexusForgeIssueCloseResult>;
}

export interface NexusForgePublicationAdapterOptions {
  repository: NexusForgeRepositoryRef;
  credential?: NexusResolvedProviderCredential | null;
  preferredBackend?: NexusForgePublicationBackendPreference;
  commandRunner?: NexusForgePublicationCommandRunner;
  fetch?: typeof fetch;
  baseEnv?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface GitHubPullRequestResponse {
  number?: number;
  html_url?: string | null;
  state?: string | null;
  title?: string | null;
  draft?: boolean | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  head?: {
    ref?: string | null;
    sha?: string | null;
  } | null;
  base?: {
    ref?: string | null;
  } | null;
}

interface GitHubPullRequestReviewResponse {
  state?: string | null;
  submitted_at?: string | null;
  user?: {
    login?: string | null;
  } | null;
}

interface GitHubCheckRunResponse {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  details_url?: string | null;
  html_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  check_suite?: {
    app?: {
      name?: string | null;
    } | null;
  } | null;
}

interface GitHubCheckRunsResponse {
  check_runs?: GitHubCheckRunResponse[];
}

interface GitHubActorResponse {
  login?: string | null;
  slug?: string | null;
}

interface GitHubMergeResponse {
  merged?: boolean;
  sha?: string | null;
  message?: string | null;
}

interface GitHubIssueResponse {
  number?: number;
  state?: string | null;
  html_url?: string | null;
}

interface GitHubErrorBody {
  message?: string;
}

export class NexusForgePublicationError extends Error {
  readonly code: NexusForgePublicationErrorCode;
  readonly metadata: Record<string, unknown>;

  constructor(
    code: NexusForgePublicationErrorCode,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "NexusForgePublicationError";
    this.code = code;
    this.metadata = metadata;
  }
}

export function createNexusForgePublicationAdapter(
  options: NexusForgePublicationAdapterOptions,
): NexusForgePublicationAdapter {
  const provider = normalizeProvider(options.repository.provider);
  if (provider !== "github") {
    return new UnsupportedForgePublicationAdapter(provider);
  }

  return new GitHubForgePublicationAdapter({
    ...options,
    repository: {
      ...options.repository,
      provider,
    },
  });
}

export function selectNexusForgePublicationBackend(options: {
  provider: string;
  credential?: NexusResolvedProviderCredential | null;
  preferredBackend?: NexusForgePublicationBackendPreference;
}): NexusForgePublicationBackend {
  if (normalizeProvider(options.provider) !== "github") {
    return "unsupported";
  }
  if (options.preferredBackend === "github_rest") {
    return "github_rest";
  }
  if (options.preferredBackend === "github_cli") {
    return "github_cli";
  }
  if (options.credential?.authorizationHeader) {
    return "github_rest";
  }
  if (
    options.credential?.kind === "provider_cli" ||
    options.credential?.env?.GH_CONFIG_DIR
  ) {
    return "github_cli";
  }

  return "github_cli";
}

export function buildNexusForgePublicationOperationPlan(options: {
  repository: NexusForgeRepositoryRef;
  capability: NexusForgePublicationCapability;
  backendPreference?: NexusForgePublicationBackendPreference;
  arguments?: Record<string, NexusForgePublicationOperationArgument>;
  cliArgs?: string[];
}): NexusForgePublicationOperationPlan {
  const provider = normalizeProvider(options.repository.provider);
  const backendPreference = options.backendPreference ?? "auto";
  return {
    provider,
    repository: `${options.repository.owner}/${options.repository.name}`,
    capability: options.capability,
    backendPreference,
    command:
      provider === "github" && options.cliArgs
        ? forgePublicationCommand(["gh", ...options.cliArgs])
        : null,
    arguments: { ...(options.arguments ?? {}) },
  };
}

class GitHubForgePublicationAdapter implements NexusForgePublicationAdapter {
  readonly provider = "github";
  readonly backend: NexusForgePublicationBackend;
  readonly capabilities: NexusForgePublicationCapability[] = [
    "actor.verify",
    "pull_request.upsert",
    "pull_request.checks",
    "pull_request.merge",
    "issue.close",
  ];

  private readonly repository: NexusForgeRepositoryRef;
  private readonly credential: NexusResolvedProviderCredential | null;
  private readonly commandRunner: NexusForgePublicationCommandRunner;
  private readonly fetchFn: typeof fetch;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly cwd: string | undefined;

  constructor(options: NexusForgePublicationAdapterOptions) {
    this.repository = options.repository;
    this.credential = options.credential ?? null;
    this.backend = selectNexusForgePublicationBackend({
      provider: options.repository.provider,
      credential: this.credential,
      preferredBackend: options.preferredBackend,
    });
    this.commandRunner =
      options.commandRunner ?? defaultForgePublicationCommandRunner;
    this.fetchFn = options.fetch ?? fetch;
    this.baseEnv = options.baseEnv ?? process.env;
    this.cwd = options.cwd;
  }

  assertCapability(capability: NexusForgePublicationCapability): void {
    if (!this.capabilities.includes(capability)) {
      throw unsupportedCapability(this.provider, this.backend, capability);
    }
  }

  async verifyActor(options: {
    expected?: NexusPublicationActorConfig | null;
  }): Promise<NexusForgeActorVerificationResult> {
    this.assertCapability("actor.verify");
    const expected = options.expected ?? null;
    const observed =
      this.backend === "github_rest"
        ? await this.verifyActorWithRest(expected)
        : this.verifyActorWithCli(expected);
    const expectedHandle = expected?.handle?.trim() || null;
    return {
      expected,
      observed,
      matched: expectedHandle
        ? handlesEqual(expectedHandle, observed.handle)
        : null,
      metadata: this.metadata("actor.verify"),
    };
  }

  async upsertPullRequest(options: {
    number?: number | null;
    head: string;
    base: string;
    title: string;
    body?: string | null;
  }): Promise<NexusForgePullRequestResult> {
    this.assertCapability("pull_request.upsert");
    return this.backend === "github_rest"
      ? this.upsertPullRequestWithRest(options)
      : this.upsertPullRequestWithCli(options);
  }

  async inspectPullRequestChecks(options: {
    number: number;
    requiredChecks?: string[];
  }): Promise<NexusForgePullRequestChecksResult> {
    this.assertCapability("pull_request.checks");
    return this.backend === "github_rest"
      ? this.inspectPullRequestChecksWithRest(options)
      : this.inspectPullRequestChecksWithCli(options);
  }

  async mergePullRequest(options: {
    number: number;
    method?: "merge" | "squash" | "rebase";
    deleteBranch?: boolean;
  }): Promise<NexusForgePullRequestMergeResult> {
    this.assertCapability("pull_request.merge");
    return this.backend === "github_rest"
      ? this.mergePullRequestWithRest(options)
      : this.mergePullRequestWithCli(options);
  }

  async closeIssue(options: {
    number: number;
    reason?: "completed" | "not_planned" | null;
  }): Promise<NexusForgeIssueCloseResult> {
    this.assertCapability("issue.close");
    return this.backend === "github_rest"
      ? this.closeIssueWithRest(options)
      : this.closeIssueWithCli(options);
  }

  private async verifyActorWithRest(
    expected: NexusPublicationActorConfig | null,
  ): Promise<NexusForgeObservedActor> {
    const isApp = expected?.kind === "app" || this.credential?.kind === "github_app";
    const credentialActor = isApp
      ? this.observedAppActorFromCredential()
      : null;
    if (credentialActor) {
      return credentialActor;
    }
    const response = await this.githubRestRequest<GitHubActorResponse>(
      isApp ? "/app" : "/user",
      { method: "GET", capability: "actor.verify" },
    );
    const handle = clean(isApp ? response.slug : response.login);
    if (!handle) {
      throw new NexusForgePublicationError(
        "invalid_provider_response",
        "GitHub actor response did not include a handle.",
        { backend: this.backend },
      );
    }

    return {
      provider: "github",
      handle,
      source: isApp ? "github_rest_app" : "github_rest_user",
      backend: this.backend,
    };
  }

  private verifyActorWithCli(
    expected: NexusPublicationActorConfig | null,
  ): NexusForgeObservedActor {
    const isApp = expected?.kind === "app" || this.credential?.kind === "github_app";
    const credentialActor = isApp
      ? this.observedAppActorFromCredential()
      : null;
    if (credentialActor) {
      return credentialActor;
    }
    const result = this.runGh(
      [
        "api",
        isApp ? "app" : "user",
        "--jq",
        isApp ? ".slug" : ".login",
        "--hostname",
        githubCliHost(this.repository.host),
      ],
      "actor.verify",
    );
    const handle = clean(result.stdout);
    if (!handle) {
      throw new NexusForgePublicationError(
        "invalid_provider_response",
        "GitHub CLI actor command returned an empty handle.",
        { backend: this.backend },
      );
    }

    return {
      provider: "github",
      handle,
      source: isApp ? "github_cli_app" : "github_cli_user",
      backend: this.backend,
    };
  }

  private observedAppActorFromCredential(): NexusForgeObservedActor | null {
    if (this.credential?.kind !== "github_app") {
      return null;
    }
    const handle = clean(this.credential?.providerIdentity) ??
      clean(this.credential?.account);
    if (!handle) {
      return null;
    }

    return {
      provider: "github",
      handle,
      source: this.credential?.profileId
        ? `credential:${this.credential.profileId}`
        : "credential",
      backend: this.backend,
    };
  }

  private async upsertPullRequestWithRest(options: {
    number?: number | null;
    head: string;
    base: string;
    title: string;
    body?: string | null;
    draft?: boolean;
  }): Promise<NexusForgePullRequestResult> {
    const body = {
      head: options.head,
      base: options.base,
      title: options.title,
      ...(options.body !== undefined ? { body: options.body ?? "" } : {}),
      ...(!options.number && options.draft === true ? { draft: true } : {}),
    };
    const response = await this.githubRestRequest<GitHubPullRequestResponse>(
      options.number
        ? `${this.repositoryApiPath()}/pulls/${String(options.number)}`
        : `${this.repositoryApiPath()}/pulls`,
      {
        method: options.number ? "PATCH" : "POST",
        capability: "pull_request.upsert",
        body,
      },
    );
    return pullRequestResult(response, this.metadata("pull_request.upsert"));
  }

  private upsertPullRequestWithCli(options: {
    number?: number | null;
    head: string;
    base: string;
    title: string;
    body?: string | null;
    draft?: boolean;
  }): NexusForgePullRequestResult {
    const args = options.number
      ? [
          "pr",
          "edit",
          String(options.number),
          "--repo",
          this.repositorySlug(),
          "--title",
          options.title,
          ...(options.body !== undefined ? ["--body", options.body ?? ""] : []),
        ]
      : [
          "pr",
          "create",
          "--repo",
          this.repositorySlug(),
          "--head",
          options.head,
          "--base",
          options.base,
          "--title",
          options.title,
          ...(options.draft === true ? ["--draft"] : []),
          ...(options.body !== undefined ? ["--body", options.body ?? ""] : []),
        ];
    const result = this.runGh(args, "pull_request.upsert");
    const url = clean(result.stdout);
    const number = options.number ?? pullRequestNumberFromUrl(url);
    if (!number) {
      throw new NexusForgePublicationError(
        "invalid_provider_response",
        "GitHub CLI pull request command did not return or receive a PR number.",
        { backend: this.backend },
      );
    }

    return {
      number,
      url,
      state: null,
      title: options.title,
      metadata: this.metadata("pull_request.upsert"),
    };
  }

  private async inspectPullRequestChecksWithRest(options: {
    number: number;
  }): Promise<NexusForgePullRequestChecksResult> {
    const pullRequest = await this.githubRestRequest<GitHubPullRequestResponse>(
      `${this.repositoryApiPath()}/pulls/${String(options.number)}`,
      { method: "GET", capability: "pull_request.checks" },
    );
    const headSha = clean(pullRequest.head?.sha);
    if (!headSha) {
      throw new NexusForgePublicationError(
        "invalid_provider_response",
        "GitHub pull request response did not include head.sha.",
        { backend: this.backend, pullRequest: options.number },
      );
    }
    const checks = await this.githubRestRequest<GitHubCheckRunsResponse>(
      `${this.repositoryApiPath()}/commits/${headSha}/check-runs?per_page=100`,
      { method: "GET", capability: "pull_request.checks" },
    );
    const reviews = await this.githubRestRequest<GitHubPullRequestReviewResponse[]>(
      `${this.repositoryApiPath()}/pulls/${String(options.number)}/reviews?per_page=100`,
      { method: "GET", capability: "pull_request.checks" },
    );

    return {
      evidence: {
        provider: "github",
        sourceKind: "pull_request",
        reviewTarget: {
          kind: "pull_request",
          number: options.number,
          url: clean(pullRequest.html_url),
          title: clean(pullRequest.title),
        },
        headBranch: clean(pullRequest.head?.ref),
        headSha,
        targetBranch: clean(pullRequest.base?.ref),
        sourceUrl: clean(pullRequest.html_url),
        reviewState: reviewStateFromGitHubReviews(reviews),
        checks: (checks.check_runs ?? []).map((check) => ({
          name: clean(check.name) ?? "unnamed check",
          status: clean(check.status),
          conclusion: clean(check.conclusion),
          workflowName: clean(check.check_suite?.app?.name),
          url: clean(check.html_url) ?? clean(check.details_url),
          detailsUrl: clean(check.details_url),
          startedAt: clean(check.started_at),
          completedAt: clean(check.completed_at),
        })),
        mergeability: mergeabilityFromGitHubPullRequest(pullRequest),
        branchPolicy: branchPolicyFromGitHubPullRequest(pullRequest),
        baseStatus: baseStatusFromGitHubPullRequest(pullRequest),
        metadata: {
          backend: this.backend,
          mergeableState: clean(pullRequest.mergeable_state),
          draft: pullRequest.draft === true,
        },
      },
      metadata: this.metadata("pull_request.checks"),
    };
  }

  private inspectPullRequestChecksWithCli(options: {
    number: number;
  }): NexusForgePullRequestChecksResult {
    const result = this.runGh(
      [
      "pr",
      "checks",
      String(options.number),
      "--repo",
      this.repositorySlug(),
        "--json",
        "name,state,bucket,link,workflow",
      ],
      "pull_request.checks",
    );
    const checks = parseJsonArray<Record<string, unknown>>(
      result.stdout,
      "GitHub CLI pull request checks",
    );
    const view = this.runGh(
      [
        "pr",
        "view",
        String(options.number),
        "--repo",
        this.repositorySlug(),
        "--json",
        "number,url,title,headRefName,headRefOid,baseRefName,reviewDecision,mergeStateStatus,isDraft",
      ],
      "pull_request.checks",
    );
    const pullRequest = parseJsonObject(
      view.stdout,
      "GitHub CLI pull request view",
    );
    return {
      evidence: {
        provider: "github",
        sourceKind: "pull_request",
        reviewTarget: {
          kind: "pull_request",
          number: options.number,
          url: stringField(pullRequest, "url"),
          title: stringField(pullRequest, "title"),
        },
        headBranch: stringField(pullRequest, "headRefName"),
        headSha: stringField(pullRequest, "headRefOid"),
        targetBranch: stringField(pullRequest, "baseRefName"),
        sourceUrl: stringField(pullRequest, "url"),
        reviewState: stringField(pullRequest, "reviewDecision"),
        checks: checks.map((check) => ({
          name: stringField(check, "name") ?? "unnamed check",
          state: stringField(check, "state"),
          bucket: stringField(check, "bucket"),
          workflowName: stringField(check, "workflow"),
          url: stringField(check, "link"),
        })),
        mergeability: mergeabilityFromGitHubMergeState(
          stringField(pullRequest, "mergeStateStatus"),
        ),
        branchPolicy: branchPolicyFromGitHubMergeState(
          stringField(pullRequest, "mergeStateStatus"),
          booleanField(pullRequest, "isDraft"),
        ),
        baseStatus: baseStatusFromGitHubMergeState(
          stringField(pullRequest, "mergeStateStatus"),
        ),
        metadata: {
          backend: this.backend,
          mergeableState: stringField(pullRequest, "mergeStateStatus"),
          draft: booleanField(pullRequest, "isDraft") === true,
        },
      },
      metadata: this.metadata("pull_request.checks"),
    };
  }

  private async mergePullRequestWithRest(options: {
    number: number;
    method?: "merge" | "squash" | "rebase";
  }): Promise<NexusForgePullRequestMergeResult> {
    const response = await this.githubRestRequest<GitHubMergeResponse>(
      `${this.repositoryApiPath()}/pulls/${String(options.number)}/merge`,
      {
        method: "PUT",
        capability: "pull_request.merge",
        body: {
          merge_method: options.method ?? "merge",
        },
      },
    );
    return {
      merged: response.merged === true,
      sha: clean(response.sha),
      message: clean(response.message),
      metadata: this.metadata("pull_request.merge"),
    };
  }

  private mergePullRequestWithCli(options: {
    number: number;
    method?: "merge" | "squash" | "rebase";
    deleteBranch?: boolean;
  }): NexusForgePullRequestMergeResult {
    const method = options.method ?? "merge";
    this.runGh(
      [
        "pr",
        "merge",
        String(options.number),
        "--repo",
        this.repositorySlug(),
        `--${method}`,
        ...(options.deleteBranch === false ? [] : ["--delete-branch"]),
      ],
      "pull_request.merge",
    );

    return {
      merged: true,
      sha: null,
      message: null,
      metadata: this.metadata("pull_request.merge"),
    };
  }

  private async closeIssueWithRest(options: {
    number: number;
    reason?: "completed" | "not_planned" | null;
  }): Promise<NexusForgeIssueCloseResult> {
    const response = await this.githubRestRequest<GitHubIssueResponse>(
      `${this.repositoryApiPath()}/issues/${String(options.number)}`,
      {
        method: "PATCH",
        capability: "issue.close",
        body: {
          state: "closed",
          ...(options.reason ? { state_reason: options.reason } : {}),
        },
      },
    );
    return {
      number: response.number ?? options.number,
      state: clean(response.state),
      url: clean(response.html_url),
      metadata: this.metadata("issue.close"),
    };
  }

  private closeIssueWithCli(options: {
    number: number;
    reason?: "completed" | "not_planned" | null;
  }): NexusForgeIssueCloseResult {
    const reason = options.reason;
    const result = this.runGh(
      [
        "issue",
        "close",
        String(options.number),
        "--repo",
        this.repositorySlug(),
        ...(reason ? ["--reason", reason] : []),
      ],
      "issue.close",
    );
    return {
      number: options.number,
      state: "closed",
      url: clean(result.stdout),
      metadata: this.metadata("issue.close"),
    };
  }

  private async githubRestRequest<T>(
    pathAndQuery: string,
    options: {
      method: "GET" | "POST" | "PATCH" | "PUT";
      capability: NexusForgePublicationCapability;
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    const authorizationHeader = this.credential?.authorizationHeader;
    if (!authorizationHeader) {
      throw new NexusForgePublicationError(
        "missing_credential",
        `GitHub REST ${options.capability} requires an API credential.`,
        { backend: this.backend, capability: options.capability },
      );
    }
    const url = new URL(
      pathAndQuery.replace(/^\/+/, ""),
      `${githubApiBaseUrl(this.repository.host)}/`,
    );
    const response = await this.fetchFn(url, {
      method: options.method,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "dev-nexus",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: authorizationHeader,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object"
          ? (payload as GitHubErrorBody).message
          : undefined;
      throw new NexusForgePublicationError(
        "provider_request_failed",
        `${options.method} ${url.pathname} failed: ${response.status} ${
          message ?? response.statusText
        }`,
        { backend: this.backend, capability: options.capability },
      );
    }

    return payload as T;
  }

  private runGh(
    args: readonly string[],
    capability: NexusForgePublicationCapability,
  ): NexusForgePublicationCommandResult {
    const result = this.commandRunner("gh", args, {
      cwd: this.cwd,
      env: {
        ...this.baseEnv,
        ...(this.credential?.env ?? {}),
      },
    });
    if (result.status !== 0 || result.error) {
      const detail =
        result.stderr.trim() || result.stdout.trim() || result.error?.message;
      throw new NexusForgePublicationError(
        "command_failed",
        detail
          ? `GitHub CLI ${capability} failed: ${detail}`
          : `GitHub CLI ${capability} failed.`,
        { backend: this.backend, capability },
      );
    }

    return result;
  }

  private repositoryApiPath(): string {
    return `/repos/${encodeURIComponent(this.repository.owner)}/${encodeURIComponent(
      this.repository.name,
    )}`;
  }

  private repositorySlug(): string {
    return `${this.repository.owner}/${this.repository.name}`;
  }

  private metadata(
    capability: NexusForgePublicationCapability,
  ): NexusForgePublicationOperationMetadata {
    return {
      provider: "github",
      backend: this.backend,
      capability,
    };
  }
}

class UnsupportedForgePublicationAdapter implements NexusForgePublicationAdapter {
  readonly backend = "unsupported";
  readonly capabilities: NexusForgePublicationCapability[] = [];

  constructor(readonly provider: string) {}

  assertCapability(capability: NexusForgePublicationCapability): void {
    throw unsupportedCapability(this.provider, this.backend, capability);
  }

  async verifyActor(): Promise<NexusForgeActorVerificationResult> {
    throw unsupportedCapability(this.provider, this.backend, "actor.verify");
  }

  async upsertPullRequest(): Promise<NexusForgePullRequestResult> {
    throw unsupportedCapability(
      this.provider,
      this.backend,
      "pull_request.upsert",
    );
  }

  async inspectPullRequestChecks(): Promise<NexusForgePullRequestChecksResult> {
    throw unsupportedCapability(
      this.provider,
      this.backend,
      "pull_request.checks",
    );
  }

  async mergePullRequest(): Promise<NexusForgePullRequestMergeResult> {
    throw unsupportedCapability(
      this.provider,
      this.backend,
      "pull_request.merge",
    );
  }

  async closeIssue(): Promise<NexusForgeIssueCloseResult> {
    throw unsupportedCapability(this.provider, this.backend, "issue.close");
  }
}

function defaultForgePublicationCommandRunner(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
): NexusForgePublicationCommandResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function pullRequestResult(
  response: GitHubPullRequestResponse,
  metadata: NexusForgePublicationOperationMetadata,
): NexusForgePullRequestResult {
  if (!response.number) {
    throw new NexusForgePublicationError(
      "invalid_provider_response",
      "GitHub pull request response did not include a number.",
      { backend: metadata.backend },
    );
  }
  return {
    number: response.number,
    url: clean(response.html_url),
    state: clean(response.state),
    title: clean(response.title),
    metadata,
  };
}

function unsupportedCapability(
  provider: string,
  backend: NexusForgePublicationBackend,
  capability: NexusForgePublicationCapability,
): NexusForgePublicationError {
  return new NexusForgePublicationError(
    normalizeProvider(provider) === "github"
      ? "unsupported_capability"
      : "unsupported_provider",
    `Provider ${provider} does not support publication capability ${capability}.`,
    { provider, backend, capability },
  );
}

function parseJsonArray<T>(value: string, label: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // Fall through to the typed error below.
  }
  throw new NexusForgePublicationError(
    "invalid_provider_response",
    `${label} response was not a JSON array.`,
  );
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the typed error below.
  }
  throw new NexusForgePublicationError(
    "invalid_provider_response",
    `${label} response was not a JSON object.`,
  );
}

function forgePublicationCommand(args: string[]): string {
  return args.map(shellQuoteArgument).join(" ");
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function reviewStateFromGitHubReviews(
  reviews: GitHubPullRequestReviewResponse[],
): string | null {
  const latestByReviewer = new Map<string, string>();
  for (const [index, review] of reviews.entries()) {
    const reviewer = clean(review.user?.login) ?? `review-${index}`;
    const state = normalizedToken(review.state);
    if (state) {
      latestByReviewer.set(reviewer, state);
    }
  }
  const states = [...latestByReviewer.values()];
  if (
    states.some((state) =>
      state === "changes_requested" ||
      state === "rejected" ||
      state === "timed_out"
    )
  ) {
    return "changes_requested";
  }
  if (states.some((state) => state === "approved")) {
    return "approved";
  }
  return states.length > 0 ? "waiting_for_approval" : null;
}

function mergeabilityFromGitHubPullRequest(
  pullRequest: GitHubPullRequestResponse,
): string | boolean | null {
  return mergeabilityFromGitHubMergeState(clean(pullRequest.mergeable_state)) ??
    pullRequest.mergeable ??
    null;
}

function mergeabilityFromGitHubMergeState(value: string | null): string | null {
  const state = normalizedToken(value);
  if (!state) {
    return null;
  }
  if (state === "dirty") {
    return "conflicting";
  }
  if (state === "blocked" || state === "behind" || state === "draft") {
    return "blocked";
  }
  if (state === "clean" || state === "has_hooks" || state === "unstable") {
    return "mergeable";
  }
  return "unknown";
}

function branchPolicyFromGitHubPullRequest(
  pullRequest: GitHubPullRequestResponse,
): string | boolean | null {
  return branchPolicyFromGitHubMergeState(
    clean(pullRequest.mergeable_state),
    pullRequest.draft === true,
  );
}

function branchPolicyFromGitHubMergeState(
  value: string | null,
  draft: boolean | null,
): string | boolean | null {
  if (draft === true) {
    return "blocked";
  }
  const state = normalizedToken(value);
  if (!state) {
    return null;
  }
  if (state === "clean" || state === "has_hooks") {
    return "clear";
  }
  if (state === "unstable" || state === "behind") {
    return "pending";
  }
  if (state === "blocked" || state === "dirty" || state === "draft") {
    return "blocked";
  }
  return "unknown";
}

function baseStatusFromGitHubPullRequest(
  pullRequest: GitHubPullRequestResponse,
): string | null {
  return baseStatusFromGitHubMergeState(clean(pullRequest.mergeable_state));
}

function baseStatusFromGitHubMergeState(value: string | null): string | null {
  const state = normalizedToken(value);
  if (!state) {
    return null;
  }
  if (state === "behind") {
    return "behind";
  }
  if (state === "dirty") {
    return "diverged";
  }
  if (state === "clean" || state === "has_hooks" || state === "unstable") {
    return "current";
  }
  return "unknown";
}

function normalizedToken(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase().replace(/[\s-]+/gu, "_") || null;
}

function pullRequestNumberFromUrl(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = /\/pull\/(\d+)(?:$|[/?#])/u.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

function githubApiBaseUrl(host?: string | null): string {
  const normalized = githubCliHost(host);
  if (normalized === "github.com") {
    return "https://api.github.com";
  }
  if (normalized === "api.github.com") {
    return "https://api.github.com";
  }
  return `https://${normalized}/api/v3`;
}

function githubCliHost(host?: string | null): string {
  const value = host?.trim();
  if (!value || value === "https://github.com" || value === "api.github.com") {
    return "github.com";
  }
  return value
    .replace(/^https?:\/\//u, "")
    .replace(/^api\./u, "")
    .replace(/\/+$/u, "");
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function handlesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
