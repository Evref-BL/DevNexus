import { spawnSync } from "node:child_process";
import { resolveNexusCommandPath } from "./nexusCommandPath.js";
import {
  assertWorkStatus as assertSharedWorkStatus,
  dedupeStrings,
  expandWorkStatusQuery,
  isClosedWorkStatus,
  isOpenWorkStatus,
  isWorkStatus,
  matchesRequiredStrings,
  matchesWorkItemSearch,
  matchesWorkStatusFilter,
  normalizeWorkItemLimit,
  normalizeWorkItemSearch,
  normalizeWorkItemStringArray,
  requiredNonEmptyWorkItemString,
  workStatusSetHasClosed,
  workStatusSetHasOpen,
} from "./workTrackingQuery.js";
import type {
  CreateWorkItemInput,
  ExternalRef,
  GitLabWorkTrackingConfig,
  TrackerCapabilities,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkStatusQuery,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export const defaultGitLabApiBaseUrl = "https://gitlab.com/api/v4";
export const gitLabStatusLabelPrefix = "status:";

export interface GitLabWorkTrackerProviderOptions {
  config: GitLabWorkTrackingConfig;
  token?: string | null;
  fetch?: typeof fetch;
  apiBaseUrl?: string | null;
  env?: Record<string, string | undefined>;
  credentialRunner?: GitLabCredentialRunner | false;
  credentialInteractive?: boolean;
}

export interface GitLabCredentialCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface GitLabCredentialRequest {
  protocol: "https";
  host: string;
  path?: string;
}

export type GitLabCredentialRunner = (
  request: GitLabCredentialRequest,
  options: { interactive: boolean },
) => GitLabCredentialCommandResult;

interface GitLabIssue {
  id: number;
  iid: number;
  project_id?: number | string | null;
  title: string;
  description?: string | null;
  state: string;
  labels?: string[];
  assignees?: Array<{
    id?: number | null;
    username?: string | null;
  }>;
  milestone?: {
    id?: number | null;
    title?: string | null;
  } | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  web_url?: string | null;
  references?: {
    short?: string | null;
    relative?: string | null;
    full?: string | null;
  } | null;
}

interface GitLabNote {
  id: number;
  body?: string | null;
  author?: { username?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  noteable_iid?: number | null;
}

interface GitLabErrorBody {
  message?: unknown;
  error?: string;
}

export class GitLabWorkTrackerProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitLabWorkTrackerProviderError";
  }
}

const gitLabWorkStatusValidationOptions = {
  errorFactory: gitLabProviderError,
  invalidStatusMessage: invalidGitLabWorkStatusMessage,
};

export const gitLabWorkTrackerCapabilities: TrackerCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: true,
  board: false,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

export function createGitLabWorkTrackerProvider(
  options: GitLabWorkTrackerProviderOptions,
): GitLabWorkTrackerProvider {
  return new GitLabWorkTrackerProvider(options);
}

export class GitLabWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider = "gitlab";
  readonly capabilities = gitLabWorkTrackerCapabilities;

  private readonly config: GitLabWorkTrackingConfig;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly staticPrivateToken?: string;
  private readonly credentialRunner?: GitLabCredentialRunner;
  private readonly credentialInteractive: boolean;
  private credentialHeaders: Record<string, string> | null | undefined;

  constructor(options: GitLabWorkTrackerProviderOptions) {
    this.config = options.config;
    this.fetchFn = options.fetch ?? fetch;
    this.apiBaseUrl = normalizeGitLabApiBaseUrl(
      options.apiBaseUrl ?? options.config.host,
    );
    this.staticPrivateToken =
      optionalNonEmptyString(options.token, "token") ??
      optionalNonEmptyString(
        (options.env ?? process.env).GITLAB_TOKEN,
        "GITLAB_TOKEN",
      ) ??
      optionalNonEmptyString((options.env ?? process.env).GL_TOKEN, "GL_TOKEN");
    this.credentialRunner =
      options.credentialRunner === false
        ? undefined
        : options.credentialRunner ?? defaultGitLabCredentialRunner;
    this.credentialInteractive = options.credentialInteractive ?? false;
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    const status = input.status ?? "todo";
    assertWorkStatus(status);

    const created = await this.requestJson<GitLabIssue>("POST", this.issuePath(), {
      title: requiredNonEmptyString(input.title, "title"),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...requestLabels(labelsWithStatus(input.labels, status)),
      ...requestAssignees(input.assignees),
      ...requestMilestone(input.milestone),
    });

    if (isClosedWorkStatus(status)) {
      return this.updateWorkItem({ id: String(created.iid) }, { status });
    }

    return this.issueToWorkItem(created);
  }

  async listWorkItems(query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const statuses = normalizeStatusFilter(query.status);
    const state = gitLabStateForQuery(statuses);
    const limit = normalizeLimit(query.limit);
    const params = new URLSearchParams({
      state,
      per_page: String(limit ? Math.min(Math.max(limit, 1), 100) : 100),
      page: "1",
    });
    const labels = normalizeStringArray(query.labels, "labels");
    if (labels.length > 0) {
      params.set("labels", labels.join(","));
    }

    const issues = await this.requestJson<GitLabIssue[]>(
      "GET",
      `${this.issuePath()}?${params.toString()}`,
    );
    const assignees = normalizeStringArray(query.assignees, "assignees");
    const search = normalizeWorkItemSearch(query.search);
    const items = issues
      .map((issue) => this.issueToWorkItem(issue))
      .filter((item) => matchesStatusFilter(item, statuses))
      .filter((item) => matchesStringFilter(item.assignees, assignees))
      .filter((item) => !search || matchesWorkItemSearch(item, search));

    return limit === undefined ? items : items.slice(0, limit);
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    return this.issueToWorkItem(await this.getIssue(ref));
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    const issueIid = issueIidFromRef(ref);
    const body: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      body.title = requiredNonEmptyString(patch.title, "title");
    }
    if (patch.description !== undefined) {
      body.description = patch.description;
    }
    if (patch.assignees !== undefined) {
      Object.assign(body, requestAssignees(patch.assignees));
    }
    if (patch.milestone !== undefined) {
      Object.assign(body, requestMilestone(patch.milestone));
    }
    if (patch.status !== undefined) {
      assertWorkStatus(patch.status);
      body.state_event = isClosedWorkStatus(patch.status) ? "close" : "reopen";
    }
    if (patch.labels !== undefined || patch.status !== undefined) {
      const baseLabels =
        patch.labels !== undefined
          ? normalizeStringArray(patch.labels, "labels")
          : labelNames(await this.getIssue(ref));
      Object.assign(body, requestLabels(labelsWithStatus(baseLabels, patch.status)));
    }

    return this.issueToWorkItem(
      await this.requestJson<GitLabIssue>(
        "PUT",
        `${this.issuePath()}/${issueIid}`,
        body,
      ),
    );
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    const issueIid = issueIidFromRef(ref);
    const note = await this.requestJson<GitLabNote>(
      "POST",
      `${this.issuePath()}/${issueIid}/notes`,
      {
        body: requiredNonEmptyString(body, "body"),
      },
    );

    return this.noteToWorkComment(note, issueIid);
  }

  async setStatus(ref: WorkItemRef, status: WorkStatus): Promise<WorkItem> {
    return this.updateWorkItem(ref, { status });
  }

  private async getIssue(ref: WorkItemRef): Promise<GitLabIssue> {
    const issueIid = issueIidFromRef(ref);
    return this.requestJson<GitLabIssue>("GET", `${this.issuePath()}/${issueIid}`);
  }

  private issuePath(): string {
    return `/projects/${encodePathSegment(this.config.repository.id)}/issues`;
  }

  private async requestJson<T>(
    method: string,
    pathAndQuery: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(pathAndQuery.replace(/^\/+/, ""), `${this.apiBaseUrl}/`);
    const authorizationHeaders = this.authorizationHeaders();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "dev-nexus",
      ...authorizationHeaders,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await this.fetchFn(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const message = await gitLabErrorMessage(response, method, url);
      throw new GitLabWorkTrackerProviderError(
        gitLabErrorMessageWithCredentialHint(
          message,
          response,
          authorizationHeaders,
          this.config,
        ),
      );
    }

    return (await response.json()) as T;
  }

  private issueToWorkItem(issue: GitLabIssue): WorkItem {
    return {
      id: `gitlab-${issue.iid}`,
      title: requiredNonEmptyString(issue.title, "issue.title"),
      description: issue.description ?? null,
      status: workStatusFromIssue(issue),
      provider: "gitlab",
      labels: userLabelNames(issue),
      assignees: assigneeUsernames(issue),
      milestone: issue.milestone?.title ?? null,
      createdAt: issue.created_at ?? null,
      updatedAt: issue.updated_at ?? null,
      closedAt: issue.closed_at ?? null,
      webUrl: issue.web_url ?? null,
      externalRef: this.issueExternalRef(issue),
    };
  }

  private noteToWorkComment(note: GitLabNote, issueIid: number): WorkComment {
    return {
      id: `gitlab-note-${note.id}`,
      body: note.body ?? "",
      author: note.author?.username ?? null,
      createdAt: note.created_at ?? null,
      updatedAt: note.updated_at ?? null,
      externalRef: {
        provider: "gitlab",
        host: this.config.host ?? null,
        repositoryId: this.config.repository.id,
        itemId: String(note.id),
        itemNumber: note.noteable_iid ?? issueIid,
      },
    };
  }

  private issueExternalRef(issue: GitLabIssue): ExternalRef {
    return {
      provider: "gitlab",
      host: this.config.host ?? null,
      repositoryId: this.config.repository.id,
      itemId: String(issue.iid),
      itemNumber: issue.iid,
      itemKey: issue.references?.full ?? issue.references?.relative ?? null,
      nodeId: String(issue.id),
      webUrl: issue.web_url ?? null,
    };
  }

  private authorizationHeaders(): Record<string, string> {
    if (this.staticPrivateToken) {
      return { "PRIVATE-TOKEN": this.staticPrivateToken };
    }
    if (this.credentialHeaders !== undefined) {
      return this.credentialHeaders ?? {};
    }
    if (!this.credentialRunner) {
      this.credentialHeaders = null;
      return {};
    }

    const credential = fillGitLabCredential(
      this.credentialRunner,
      gitLabCredentialRequest(this.config),
      { interactive: this.credentialInteractive },
    );
    this.credentialHeaders = credential
      ? authorizationHeadersFromCredential(credential)
      : null;
    return this.credentialHeaders ?? {};
  }
}

export function normalizeGitLabApiBaseUrl(hostOrApiBaseUrl?: string | null): string {
  const value = hostOrApiBaseUrl?.trim();
  if (!value || value === "gitlab.com" || value === "https://gitlab.com") {
    return defaultGitLabApiBaseUrl;
  }

  const url = value.startsWith("http://") || value.startsWith("https://")
    ? new URL(value)
    : new URL(`https://${value}`);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith("/api/v4")) {
    return `${url.protocol}//${url.host}${normalizedPath}`;
  }

  return `${url.protocol}//${url.host}${normalizedPath}/api/v4`;
}

export function gitLabCredentialRequest(
  config: Pick<GitLabWorkTrackingConfig, "host" | "repository">,
): GitLabCredentialRequest {
  return {
    protocol: "https",
    host: normalizeGitLabCredentialHost(config.host),
    path: `${config.repository.id}.git`,
  };
}

export function normalizeGitLabCredentialHost(hostOrApiBaseUrl?: string | null): string {
  const value = hostOrApiBaseUrl?.trim();
  if (!value || value === "gitlab.com" || value === "https://gitlab.com") {
    return "gitlab.com";
  }

  const url = value.startsWith("http://") || value.startsWith("https://")
    ? new URL(value)
    : new URL(`https://${value}`);
  return url.host;
}

export function defaultGitLabCredentialRunner(
  request: GitLabCredentialRequest,
  options: { interactive: boolean },
): GitLabCredentialCommandResult {
  const env = {
    ...process.env,
    ...(options.interactive
      ? {}
      : {
          GCM_INTERACTIVE: "0",
          GIT_TERMINAL_PROMPT: "0",
        }),
  };
  const result = spawnSync(
    resolveNexusCommandPath("git", env),
    ["credential", "fill"],
    {
      input: gitLabCredentialInput(request),
      encoding: "utf8",
      env,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function fillGitLabCredential(
  runner: GitLabCredentialRunner,
  request: GitLabCredentialRequest,
  options: { interactive: boolean },
): Record<string, string> | undefined {
  const result = runner(request, options);
  if (result.status !== 0 || result.error) {
    return undefined;
  }

  const credential = parseGitLabCredentialOutput(result.stdout);
  return credential.password || (credential.authtype && credential.credential)
    ? credential
    : undefined;
}

function authorizationHeadersFromCredential(
  credential: Record<string, string>,
): Record<string, string> {
  const authtype = optionalNonEmptyString(credential.authtype, "authtype");
  const encodedCredential = optionalNonEmptyString(
    credential.credential,
    "credential",
  );
  if (authtype && encodedCredential) {
    return { Authorization: `${authtype} ${encodedCredential}` };
  }

  const password = optionalNonEmptyString(credential.password, "password");
  return password ? { "PRIVATE-TOKEN": password } : {};
}

function gitLabCredentialInput(request: GitLabCredentialRequest): string {
  return [
    `protocol=${request.protocol}`,
    `host=${request.host}`,
    ...(request.path ? [`path=${request.path}`] : []),
    "",
  ].join("\n");
}

function parseGitLabCredentialOutput(output: string): Record<string, string> {
  const credential: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    credential[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return credential;
}

function workStatusFromIssue(issue: GitLabIssue): WorkStatus {
  const statusLabel = labelNames(issue).find((label) =>
    label.startsWith(gitLabStatusLabelPrefix),
  );
  if (statusLabel) {
    const candidate = statusLabel.slice(gitLabStatusLabelPrefix.length);
    if (isWorkStatus(candidate)) {
      return candidate;
    }
  }

  return issue.state === "closed" ? "done" : "todo";
}

function gitLabStateForQuery(
  statuses: Set<WorkStatus> | undefined,
): "opened" | "closed" | "all" {
  if (!statuses || statuses.size === 0) {
    return "all";
  }

  const hasOpen = workStatusSetHasOpen(statuses);
  const hasClosed = workStatusSetHasClosed(statuses);
  return hasOpen && hasClosed ? "all" : hasClosed ? "closed" : "opened";
}

function labelsWithStatus(
  labels: string[] | undefined,
  status?: WorkStatus,
): string[] {
  const normalized = normalizeStringArray(labels, "labels").filter(
    (label) => !label.startsWith(gitLabStatusLabelPrefix),
  );
  if (
    status &&
    ((isOpenWorkStatus(status) && status !== "todo") || status === "wont_do")
  ) {
    normalized.push(`${gitLabStatusLabelPrefix}${status}`);
  }

  return dedupeStrings(normalized);
}

function userLabelNames(issue: GitLabIssue): string[] {
  return labelNames(issue).filter(
    (label) => !label.startsWith(gitLabStatusLabelPrefix),
  );
}

function labelNames(issue: GitLabIssue): string[] {
  return (issue.labels ?? [])
    .filter((label): label is string => Boolean(label && label.trim()))
    .map((label) => label.trim());
}

function assigneeUsernames(issue: GitLabIssue): string[] {
  return (issue.assignees ?? [])
    .map((assignee) => assignee.username ?? String(assignee.id ?? ""))
    .filter((login): login is string => Boolean(login && login.trim()))
    .map((login) => login.trim());
}

function issueIidFromRef(ref: WorkItemRef): number {
  if (ref.provider && ref.provider !== "gitlab") {
    throw new GitLabWorkTrackerProviderError(
      `gitlab provider cannot resolve ${ref.provider} work item refs`,
    );
  }
  if (ref.externalRef?.provider && ref.externalRef.provider !== "gitlab") {
    throw new GitLabWorkTrackerProviderError(
      `gitlab provider cannot resolve ${ref.externalRef.provider} external refs`,
    );
  }

  const candidate =
    ref.externalRef?.itemNumber ??
    ref.id ??
    ref.externalRef?.itemId;
  if (candidate === undefined || candidate === null) {
    throw new GitLabWorkTrackerProviderError("GitLab issue IID is required");
  }

  if (typeof candidate === "number") {
    return positiveInteger(candidate, "issue IID");
  }

  const normalized = candidate.trim().replace(/^gitlab-/, "");
  return positiveInteger(Number(normalized), "issue IID");
}

function normalizeStatusFilter(
  status: WorkStatusQuery | WorkStatusQuery[] | undefined,
): Set<WorkStatus> | undefined {
  return expandWorkStatusQuery(status, gitLabWorkStatusValidationOptions);
}

function matchesStatusFilter(
  item: WorkItem,
  statuses: Set<WorkStatus> | undefined,
): boolean {
  return matchesWorkStatusFilter(item, statuses);
}

function matchesStringFilter(
  itemValues: string[] | undefined,
  requiredValues: string[],
): boolean {
  return matchesRequiredStrings(itemValues, requiredValues);
}

function requestLabels(labels: string[]): Record<string, string> {
  return labels.length > 0 ? { labels: labels.join(",") } : {};
}

function requestAssignees(
  assignees: string[] | undefined,
): Record<string, number[]> {
  const assigneeIds = normalizePositiveIntegerArray(assignees, "assignees");
  return assigneeIds.length > 0 ? { assignee_ids: assigneeIds } : {};
}

function requestMilestone(
  value: string | null | undefined,
): Record<string, number | null> {
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { milestone_id: null };
  }

  return { milestone_id: positiveInteger(Number(value), "milestone") };
}

function normalizeLimit(limit: number | undefined): number | undefined {
  return normalizeWorkItemLimit(limit, { errorFactory: gitLabProviderError });
}

function normalizeStringArray(
  values: string[] | undefined,
  pathName: string,
): string[] {
  return normalizeWorkItemStringArray(values, pathName, {
    errorFactory: gitLabProviderError,
  });
}

function normalizePositiveIntegerArray(
  values: string[] | undefined,
  pathName: string,
): number[] {
  return normalizeStringArray(values, pathName).map((value, index) =>
    positiveInteger(Number(value), `${pathName}[${index}]`),
  );
}

function assertWorkStatus(status: string): asserts status is WorkStatus {
  assertSharedWorkStatus(status, gitLabWorkStatusValidationOptions);
}

function positiveInteger(value: number, pathName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new GitLabWorkTrackerProviderError(
      `${pathName} must be a positive integer`,
    );
  }

  return value;
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  return requiredNonEmptyWorkItemString(value, pathName, {
    errorFactory: gitLabProviderError,
  });
}

function optionalNonEmptyString(
  value: string | null | undefined,
  pathName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value.trim().length === 0) {
    return undefined;
  }

  return requiredNonEmptyString(value, pathName);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(requiredNonEmptyString(value, "path segment"));
}

function gitLabProviderError(message: string): GitLabWorkTrackerProviderError {
  return new GitLabWorkTrackerProviderError(message);
}

function invalidGitLabWorkStatusMessage(status: string): string {
  return `Invalid GitLab work status: ${status}; expected todo, ready, in_progress, blocked, done, or wont_do`;
}

async function gitLabErrorMessage(
  response: Response,
  method: string,
  url: URL,
): Promise<string> {
  let detail: string | undefined;
  try {
    const body = (await response.json()) as GitLabErrorBody;
    detail = gitLabErrorDetail(body);
  } catch {
    detail = await response.text().catch(() => undefined);
  }

  return [
    `GitLab request failed: ${method} ${url.pathname} returned ${response.status}`,
    detail ? `: ${detail}` : "",
  ].join("");
}

function gitLabErrorDetail(body: GitLabErrorBody): string | undefined {
  if (typeof body.error === "string") {
    return body.error;
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  if (body.message && typeof body.message === "object") {
    return JSON.stringify(body.message);
  }

  return undefined;
}

function gitLabErrorMessageWithCredentialHint(
  message: string,
  response: Response,
  authorizationHeaders: Record<string, string>,
  config: Pick<GitLabWorkTrackingConfig, "host" | "repository">,
): string {
  if (
    authorizationHeaders.Authorization ||
    authorizationHeaders["PRIVATE-TOKEN"] ||
    (response.status !== 401 && response.status !== 403)
  ) {
    return message;
  }

  return (
    `${message}. No GitLab token or git credential was available for ` +
    `${normalizeGitLabCredentialHost(config.host)}. Configure GITLAB_TOKEN, ` +
    "GL_TOKEN, or a git credential helper."
  );
}
