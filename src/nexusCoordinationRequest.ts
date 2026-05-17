import os from "node:os";
import path from "node:path";
import {
  defaultGitRunner,
  type GitCommandResult,
  type GitRunner,
} from "./gitWorktreeService.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
} from "./workItemService.js";
import type {
  ExternalRef,
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  WorkComment,
  WorkItem,
} from "./workTrackingTypes.js";

export const coordinationRequestCommentMarker = "DevNexus coordination request";
export const coordinationRequestKind = "dev-nexus.coordination.request";

export type NexusCoordinationRequestIntent =
  | "approval"
  | "feedback"
  | "choice"
  | "review";

export type NexusCoordinationRequestStatus =
  | "waiting"
  | "answered"
  | "approved"
  | "changes_requested"
  | "timed_out"
  | "blocked";

export type NexusCoordinationRequestTargetKind =
  | "work_item"
  | "branch"
  | "reviewer"
  | "github_issue"
  | "github_pull_request"
  | "gitlab_issue"
  | "gitlab_merge_request"
  | "jira_issue"
  | "coordination_record";

export type NexusCoordinationRequestProviderName =
  | "dev-nexus"
  | "github"
  | "gitlab"
  | "jira";

export type NexusCoordinationRequestProviderSurface =
  | "coordination_record"
  | "work_item"
  | "branch"
  | "reviewer"
  | "issue"
  | "pull_request"
  | "merge_request";

export interface NexusCoordinationRequestGitContext {
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  baseRef: string | null;
  headCommit: string | null;
  dirty: boolean | null;
  ahead: number | null;
  behind: number | null;
  pushed: boolean | null;
  warnings: string[];
}

export interface NexusCoordinationRequestTarget {
  kind: NexusCoordinationRequestTargetKind;
  provider: NexusCoordinationRequestProviderName | null;
  value: string;
  label: string;
  externalRef: ExternalRef | null;
}

export interface NexusCoordinationRequestMockFlowStep {
  action: string;
  description: string;
  mutatesProvider: false;
}

export interface NexusCoordinationRequestProviderRecord {
  provider: NexusCoordinationRequestProviderName;
  surface: NexusCoordinationRequestProviderSurface;
  mode: "draft";
  posted: false;
  credentialsUsed: false;
  externalRef: ExternalRef | null;
  webUrl: string | null;
  draft: {
    title: string;
    body: string;
  };
  mockFlow: NexusCoordinationRequestMockFlowStep[];
}

export interface NexusCoordinationRequestResponseRecord {
  status: NexusCoordinationRequestStatus;
  responder: string | null;
  summary: string | null;
  requestedChanges: string[];
  receivedAt: string;
}

export interface NexusCoordinationRequestRecord {
  kind: typeof coordinationRequestKind;
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectRoot: string;
  componentId: string;
  componentName: string;
  workItemId: string | null;
  hostId: string;
  agentId: string | null;
  intent: NexusCoordinationRequestIntent;
  status: NexusCoordinationRequestStatus;
  question: string | null;
  note: string | null;
  target: NexusCoordinationRequestTarget;
  provider: NexusCoordinationRequestProviderRecord;
  git: NexusCoordinationRequestGitContext;
  response: NexusCoordinationRequestResponseRecord | null;
}

export interface NexusCoordinationRequestOptions {
  projectRoot: string;
  componentId?: string;
  workItemId?: string;
  intent: string;
  question?: string | null;
  note?: string | null;
  target?: string | null;
  hostId?: string;
  agentId?: string;
  responseStatus?: string;
  responseSummary?: string | null;
  responder?: string | null;
  requestedChanges?: string[];
  currentPath?: string;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface NexusCoordinationRequestResult {
  project: {
    id: string;
    name: string;
    projectRoot: string;
  };
  component: {
    id: string;
    name: string;
    role: string;
    sourceRoot: string;
    worktreesRoot: string;
    workTrackingProvider: string | null;
  };
  workItem: WorkItem | null;
  record: NexusCoordinationRequestRecord;
  comment: WorkComment | null;
  warnings: string[];
}

interface ResolvedCoordinationRequestContext {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  currentPath: string;
}

const requestIntents = new Set<NexusCoordinationRequestIntent>([
  "approval",
  "feedback",
  "choice",
  "review",
]);

const requestStatuses = new Set<NexusCoordinationRequestStatus>([
  "waiting",
  "answered",
  "approved",
  "changes_requested",
  "timed_out",
  "blocked",
]);

export async function createNexusCoordinationRequest(
  options: NexusCoordinationRequestOptions,
): Promise<NexusCoordinationRequestResult> {
  const context = resolveCoordinationRequestContext(options);
  const intent = parseNexusCoordinationRequestIntent(options.intent, "intent");
  const question = optionalNullableTrimmedString(options.question) ?? null;
  const note = optionalNullableTrimmedString(options.note) ?? null;
  if (!question && !note) {
    throw new Error("coordination request requires a question or note");
  }

  const timestamp = currentTimestamp(options.now);
  const git = getCoordinationRequestGitContext(context, options.gitRunner);
  const explicitTarget = parseNexusCoordinationRequestTarget(
    optionalNullableTrimmedString(options.target) ?? null,
    context,
  );
  const workItemId =
    optionalTrimmedString(options.workItemId) ??
    (explicitTarget?.kind === "work_item" ? explicitTarget.value : undefined) ??
    inferWorkItemIdFromBranch(git.branch) ??
    null;
  const target =
    explicitTarget ??
    inferCoordinationRequestTarget({
      workItemId,
      branch: git.branch,
    });
  const status = coordinationRequestStatusFromResponse(options);
  const response = coordinationRequestResponse({
    status,
    timestamp,
    responseSummary: options.responseSummary,
    responder: options.responder,
    requestedChanges: options.requestedChanges,
  });
  const provider = providerRecordForTarget({
    context,
    target,
    intent,
    question,
    note,
    workItemId,
    git,
  });
  const record: NexusCoordinationRequestRecord = {
    kind: coordinationRequestKind,
    version: 1,
    id: coordinationRequestId(timestamp, intent, target),
    createdAt: timestamp,
    updatedAt: timestamp,
    projectId: context.projectConfig.id,
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    componentName: context.component.name,
    workItemId,
    hostId: optionalTrimmedString(options.hostId) ?? os.hostname(),
    agentId: optionalTrimmedString(options.agentId) ?? null,
    intent,
    status,
    question,
    note,
    target,
    provider,
    git,
    response,
  };

  const workItem = await maybeGetWorkItem(context, workItemId, options.now);
  const warnings = [...git.warnings];
  const comment = await maybeAddRequestComment({
    context,
    workItemId,
    body: formatCoordinationRequestComment(record),
    now: options.now,
    warnings,
  });

  return {
    project: projectSummary(context),
    component: componentSummary(context.component),
    workItem,
    record,
    comment,
    warnings,
  };
}

export function parseNexusCoordinationRequestIntent(
  value: string,
  pathName: string,
): NexusCoordinationRequestIntent {
  if (requestIntents.has(value as NexusCoordinationRequestIntent)) {
    return value as NexusCoordinationRequestIntent;
  }

  throw new Error(`${pathName} must be approval, feedback, choice, or review`);
}

export function parseNexusCoordinationRequestStatus(
  value: string,
  pathName: string,
): NexusCoordinationRequestStatus {
  if (requestStatuses.has(value as NexusCoordinationRequestStatus)) {
    return value as NexusCoordinationRequestStatus;
  }

  throw new Error(
    `${pathName} must be waiting, answered, approved, changes_requested, timed_out, or blocked`,
  );
}

export function formatCoordinationRequestComment(
  record: NexusCoordinationRequestRecord,
): string {
  const lines = [
    coordinationRequestCommentMarker,
    "",
    `Intent: ${record.intent}`,
    `Status: ${record.status}`,
    `Target: ${record.target.label}`,
    `Provider: ${record.provider.provider} ${record.provider.surface} (${record.provider.mode})`,
  ];
  if (record.question) {
    lines.push(`Question: ${record.question}`);
  }
  if (record.note) {
    lines.push(`Note: ${record.note}`);
  }
  if (record.response?.summary) {
    lines.push(`Response: ${record.response.summary}`);
  }
  if (record.response?.requestedChanges.length) {
    lines.push(
      `Requested changes: ${record.response.requestedChanges.join("; ")}`,
    );
  }
  lines.push(
    "",
    "```json",
    JSON.stringify(record, null, 2),
    "```",
  );

  return lines.join("\n");
}

function resolveCoordinationRequestContext(
  options: NexusCoordinationRequestOptions,
): ResolvedCoordinationRequestContext {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const projectConfig = loadProjectConfig(projectRoot);
  const currentPath = path.resolve(options.currentPath ?? process.cwd());
  const component = resolveCoordinationRequestComponent(
    projectRoot,
    projectConfig,
    options.componentId,
    currentPath,
  );

  return {
    projectRoot,
    projectConfig,
    component,
    currentPath,
  };
}

function resolveCoordinationRequestComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  componentId: string | undefined,
  currentPath: string,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (componentId) {
    const component = components.find((candidate) => candidate.id === componentId);
    if (!component) {
      throw new Error(`Project component is not configured: ${componentId}`);
    }

    return component;
  }

  const inferred = components
    .flatMap((component) => [
      { component, root: component.sourceRoot },
      { component, root: component.worktreesRoot },
    ])
    .filter((candidate) => samePathOrDescendant(currentPath, candidate.root))
    .sort((a, b) => b.root.length - a.root.length)[0];

  return inferred?.component ?? resolvePrimaryProjectComponent(projectRoot, projectConfig);
}

function getCoordinationRequestGitContext(
  context: ResolvedCoordinationRequestContext,
  gitRunner: GitRunner | undefined,
): NexusCoordinationRequestGitContext {
  const runner = gitRunner ?? defaultGitRunner;
  const repositoryPath = findGitRepositoryPath(runner, [
    context.currentPath,
    context.component.sourceRoot,
  ]);
  const baseRefFallback = context.component.defaultBranch;
  if (!repositoryPath) {
    return {
      repositoryPath: null,
      branch: null,
      upstream: null,
      baseRef: baseRefFallback,
      headCommit: null,
      dirty: null,
      ahead: null,
      behind: null,
      pushed: null,
      warnings: ["No git repository could be resolved for the coordination path."],
    };
  }

  const branch = gitStdout(
    runOptionalGit(runner, ["symbolic-ref", "--short", "HEAD"], repositoryPath),
  );
  const headCommit = gitStdout(
    runOptionalGit(runner, ["rev-parse", "HEAD"], repositoryPath),
  );
  const upstream = gitStdout(
    runOptionalGit(
      runner,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      repositoryPath,
    ),
  );
  const parsedStatus = parsePorcelainStatus(
    gitStdout(runOptionalGit(runner, ["status", "--porcelain=v1"], repositoryPath)) ??
      "",
  );
  const aheadBehind = upstream
    ? parseAheadBehind(
        gitStdout(
          runOptionalGit(
            runner,
            ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            repositoryPath,
          ),
        ),
      )
    : { ahead: null, behind: null };
  const warnings: string[] = [];
  if (!upstream) {
    warnings.push("Current branch has no upstream configured.");
  }

  return {
    repositoryPath,
    branch,
    upstream,
    baseRef: upstream ?? baseRefFallback,
    headCommit,
    dirty: parsedStatus.dirty,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    pushed: upstream && aheadBehind.ahead !== null ? aheadBehind.ahead === 0 : null,
    warnings,
  };
}

function parseNexusCoordinationRequestTarget(
  value: string | null,
  context: ResolvedCoordinationRequestContext,
): NexusCoordinationRequestTarget | null {
  if (!value) {
    return null;
  }
  const target = requiredNonEmptyString(value, "target");
  const targetSpecs: Array<{
    pattern: RegExp;
    kind: NexusCoordinationRequestTargetKind;
    provider: NexusCoordinationRequestProviderName;
  }> = [
    {
      pattern: /^(?:github|gh)[-_:/]issue[:#/,-]*(.+)$/iu,
      kind: "github_issue",
      provider: "github",
    },
    {
      pattern: /^(?:github|gh)[-_:/](?:pr|pull-request|pull_request)[:#/,-]*(.+)$/iu,
      kind: "github_pull_request",
      provider: "github",
    },
    {
      pattern: /^(?:gitlab|gl)[-_:/]issue[:#/,-]*(.+)$/iu,
      kind: "gitlab_issue",
      provider: "gitlab",
    },
    {
      pattern: /^(?:gitlab|gl)[-_:/](?:mr|merge-request|merge_request)[:#/,-]*(.+)$/iu,
      kind: "gitlab_merge_request",
      provider: "gitlab",
    },
    {
      pattern: /^(?:jira|jira-issue)[:#/,-]*(.+)$/iu,
      kind: "jira_issue",
      provider: "jira",
    },
  ];

  for (const spec of targetSpecs) {
    const match = spec.pattern.exec(target);
    if (match?.[1]) {
      return requestTarget({
        kind: spec.kind,
        provider: spec.provider,
        value: match[1],
        context,
      });
    }
  }

  const workItemMatch = /^work-item[:#/,-]*(.+)$/iu.exec(target);
  if (workItemMatch?.[1]) {
    return requestTarget({
      kind: "work_item",
      provider: "dev-nexus",
      value: workItemMatch[1],
      context,
    });
  }
  const branchMatch = /^branch[:#,-]*(.+)$/iu.exec(target);
  if (branchMatch?.[1]) {
    return requestTarget({
      kind: "branch",
      provider: "dev-nexus",
      value: branchMatch[1],
      context,
    });
  }
  const reviewerMatch = /^reviewer[:#,-]*(.+)$/iu.exec(target);
  if (reviewerMatch?.[1]) {
    return requestTarget({
      kind: "reviewer",
      provider: "dev-nexus",
      value: reviewerMatch[1],
      context,
    });
  }
  if (/^[A-Z][A-Z0-9]+-\d+$/u.test(target)) {
    return requestTarget({
      kind: "jira_issue",
      provider: "jira",
      value: target,
      context,
    });
  }

  return requestTarget({
    kind: "coordination_record",
    provider: "dev-nexus",
    value: target,
    context,
  });
}

function requestTarget(options: {
  kind: NexusCoordinationRequestTargetKind;
  provider: NexusCoordinationRequestProviderName;
  value: string;
  context: ResolvedCoordinationRequestContext;
}): NexusCoordinationRequestTarget {
  const value = requiredNonEmptyString(options.value, "target");
  const externalRef = externalRefForRequestTarget({
    kind: options.kind,
    provider: options.provider,
    value,
    context: options.context,
  });
  return {
    kind: options.kind,
    provider: options.provider,
    value,
    label: `${options.kind}:${value}`,
    externalRef,
  };
}

function inferCoordinationRequestTarget(options: {
  workItemId: string | null;
  branch: string | null;
}): NexusCoordinationRequestTarget {
  if (options.workItemId) {
    return {
      kind: "work_item",
      provider: "dev-nexus",
      value: options.workItemId,
      label: `work_item:${options.workItemId}`,
      externalRef: {
        provider: "local",
        itemId: options.workItemId,
      },
    };
  }
  if (options.branch) {
    return {
      kind: "branch",
      provider: "dev-nexus",
      value: options.branch,
      label: `branch:${options.branch}`,
      externalRef: null,
    };
  }

  return {
    kind: "coordination_record",
    provider: "dev-nexus",
    value: "draft",
    label: "coordination_record:draft",
    externalRef: null,
  };
}

function providerRecordForTarget(options: {
  context: ResolvedCoordinationRequestContext;
  target: NexusCoordinationRequestTarget;
  intent: NexusCoordinationRequestIntent;
  question: string | null;
  note: string | null;
  workItemId: string | null;
  git: NexusCoordinationRequestGitContext;
}): NexusCoordinationRequestProviderRecord {
  const provider = options.target.provider ?? "dev-nexus";
  const surface = providerSurfaceForTarget(options.target);
  const draft = {
    title: `${options.intent} request for ${options.target.label}`,
    body: draftRequestBody(options),
  };

  return {
    provider,
    surface,
    mode: "draft",
    posted: false,
    credentialsUsed: false,
    externalRef: options.target.externalRef,
    webUrl: options.target.externalRef?.webUrl ?? null,
    draft,
    mockFlow: mockFlowForProviderSurface(provider, surface),
  };
}

function providerSurfaceForTarget(
  target: NexusCoordinationRequestTarget,
): NexusCoordinationRequestProviderSurface {
  switch (target.kind) {
    case "github_issue":
    case "gitlab_issue":
    case "jira_issue":
      return "issue";
    case "github_pull_request":
      return "pull_request";
    case "gitlab_merge_request":
      return "merge_request";
    case "work_item":
      return "work_item";
    case "branch":
      return "branch";
    case "reviewer":
      return "reviewer";
    case "coordination_record":
      return "coordination_record";
  }
}

function mockFlowForProviderSurface(
  provider: NexusCoordinationRequestProviderName,
  surface: NexusCoordinationRequestProviderSurface,
): NexusCoordinationRequestMockFlowStep[] {
  if (provider === "github" && surface === "pull_request") {
    return [
      mockFlowStep("draft_review_request", "Draft a GitHub pull request review request."),
      mockFlowStep("read_reviews", "Read GitHub pull request reviews and review comments."),
    ];
  }
  if (provider === "github" && surface === "issue") {
    return [
      mockFlowStep("draft_comment", "Draft a GitHub issue comment."),
      mockFlowStep("read_comments", "Read GitHub issue comments."),
    ];
  }
  if (provider === "gitlab") {
    return [
      mockFlowStep("draft_note", `Draft a GitLab ${surface} note.`),
      mockFlowStep("read_notes", `Read GitLab ${surface} notes.`),
    ];
  }
  if (provider === "jira") {
    return [
      mockFlowStep("draft_comment", "Draft a Jira issue comment."),
      mockFlowStep("read_comments", "Read Jira issue comments."),
    ];
  }

  return [
    mockFlowStep("record_request", "Record a DevNexus coordination request."),
    mockFlowStep("read_record", "Read DevNexus coordination request records."),
  ];
}

function mockFlowStep(
  action: string,
  description: string,
): NexusCoordinationRequestMockFlowStep {
  return {
    action,
    description,
    mutatesProvider: false,
  };
}

function draftRequestBody(options: {
  context: ResolvedCoordinationRequestContext;
  target: NexusCoordinationRequestTarget;
  intent: NexusCoordinationRequestIntent;
  question: string | null;
  note: string | null;
  workItemId: string | null;
  git: NexusCoordinationRequestGitContext;
}): string {
  return [
    coordinationRequestCommentMarker,
    "",
    `Intent: ${options.intent}`,
    `Project: ${options.context.projectConfig.id}`,
    `Component: ${options.context.component.id}`,
    ...(options.workItemId ? [`Work item: ${options.workItemId}`] : []),
    `Target: ${options.target.label}`,
    ...(options.git.branch ? [`Branch: ${options.git.branch}`] : []),
    ...(options.git.headCommit ? [`Head: ${options.git.headCommit}`] : []),
    ...(options.question ? ["", options.question] : []),
    ...(options.note ? ["", options.note] : []),
    "",
    "Expected response: waiting, answered, approved, changes_requested, timed_out, or blocked.",
  ].join("\n");
}

function externalRefForRequestTarget(options: {
  kind: NexusCoordinationRequestTargetKind;
  provider: NexusCoordinationRequestProviderName;
  value: string;
  context: ResolvedCoordinationRequestContext;
}): ExternalRef | null {
  if (options.provider === "github") {
    return githubExternalRef(options);
  }
  if (options.provider === "gitlab") {
    return gitlabExternalRef(options);
  }
  if (options.provider === "jira") {
    return jiraExternalRef(options);
  }
  if (options.kind === "work_item") {
    return {
      provider: "local",
      itemId: options.value,
    };
  }

  return null;
}

function githubExternalRef(options: {
  kind: NexusCoordinationRequestTargetKind;
  value: string;
  context: ResolvedCoordinationRequestContext;
}): ExternalRef {
  const config =
    options.context.component.workTracking?.provider === "github"
      ? (options.context.component.workTracking as GitHubWorkTrackingConfig)
      : null;
  const itemNumber = positiveIntegerOrNull(options.value);
  const issuePath =
    options.kind === "github_pull_request" ? "pull" : "issues";
  const webUrl =
    config?.repository.owner && config.repository.name && itemNumber
      ? `https://${githubWebHost(config.host)}/${config.repository.owner}/${config.repository.name}/${issuePath}/${itemNumber}`
      : null;

  return {
    provider: "github",
    host: config?.host ?? null,
    repositoryOwner: config?.repository.owner ?? null,
    repositoryName: config?.repository.name ?? null,
    itemId: options.value,
    itemNumber,
    webUrl,
  };
}

function gitlabExternalRef(options: {
  kind: NexusCoordinationRequestTargetKind;
  value: string;
  context: ResolvedCoordinationRequestContext;
}): ExternalRef {
  const config =
    options.context.component.workTracking?.provider === "gitlab"
      ? (options.context.component.workTracking as GitLabWorkTrackingConfig)
      : null;
  const itemNumber = positiveIntegerOrNull(options.value);
  const targetPath =
    options.kind === "gitlab_merge_request" ? "merge_requests" : "issues";
  const webUrl =
    config?.repository.id && itemNumber
      ? `https://${gitlabWebHost(config.host)}/${config.repository.id}/-/${targetPath}/${itemNumber}`
      : null;

  return {
    provider: "gitlab",
    host: config?.host ?? null,
    repositoryId: config?.repository.id ?? null,
    itemId: options.value,
    itemNumber,
    webUrl,
  };
}

function jiraExternalRef(options: {
  value: string;
  context: ResolvedCoordinationRequestContext;
}): ExternalRef {
  const config =
    options.context.component.workTracking?.provider === "jira"
      ? (options.context.component.workTracking as JiraWorkTrackingConfig)
      : null;
  const projectKey = options.value.split("-")[0] ?? config?.projectKey ?? null;
  const host = config?.host ?? null;
  const webUrl = host ? `https://${host.replace(/^https?:\/\//u, "")}/browse/${options.value}` : null;

  return {
    provider: "jira",
    host,
    projectId: projectKey,
    itemId: options.value,
    itemKey: options.value,
    webUrl,
  };
}

function coordinationRequestStatusFromResponse(
  options: NexusCoordinationRequestOptions,
): NexusCoordinationRequestStatus {
  const explicitStatus = optionalTrimmedString(options.responseStatus);
  if (explicitStatus) {
    return parseNexusCoordinationRequestStatus(
      explicitStatus,
      "responseStatus",
    );
  }
  const requestedChanges = normalizedStringArray(
    options.requestedChanges,
    "requestedChanges",
  );
  if (requestedChanges.length > 0) {
    return "changes_requested";
  }
  if (
    optionalNullableTrimmedString(options.responseSummary) ||
    optionalNullableTrimmedString(options.responder)
  ) {
    return "answered";
  }

  return "waiting";
}

function coordinationRequestResponse(options: {
  status: NexusCoordinationRequestStatus;
  timestamp: string;
  responseSummary?: string | null;
  responder?: string | null;
  requestedChanges?: string[];
}): NexusCoordinationRequestResponseRecord | null {
  const summary = optionalNullableTrimmedString(options.responseSummary) ?? null;
  const responder = optionalNullableTrimmedString(options.responder) ?? null;
  const requestedChanges = normalizedStringArray(
    options.requestedChanges,
    "requestedChanges",
  );
  if (
    options.status === "waiting" &&
    !summary &&
    !responder &&
    requestedChanges.length === 0
  ) {
    return null;
  }

  return {
    status: options.status,
    responder,
    summary,
    requestedChanges,
    receivedAt: options.timestamp,
  };
}

async function maybeGetWorkItem(
  context: ResolvedCoordinationRequestContext,
  workItemId: string | null,
  now?: () => Date | string,
): Promise<WorkItem | null> {
  if (!workItemId || context.component.workTracking?.provider !== "local") {
    return null;
  }

  return workItemServiceForContext(context, now).getWorkItem({
    projectRoot: context.projectRoot,
    componentId: context.component.id,
    id: workItemId,
  });
}

async function maybeAddRequestComment(options: {
  context: ResolvedCoordinationRequestContext;
  workItemId: string | null;
  body: string;
  now?: () => Date | string;
  warnings: string[];
}): Promise<WorkComment | null> {
  if (!options.workItemId) {
    options.warnings.push(
      "No work item was inferred, so the coordination request was returned as a neutral record only.",
    );
    return null;
  }
  if (options.context.component.workTracking?.provider !== "local") {
    options.warnings.push(
      `Draft coordination request was not posted to ${options.context.component.workTracking?.provider ?? "unknown"}; this slice does not use live provider credentials.`,
    );
    return null;
  }

  return workItemServiceForContext(options.context, options.now).addComment({
    projectRoot: options.context.projectRoot,
    componentId: options.context.component.id,
    ref: { id: options.workItemId },
    body: options.body,
  });
}

function workItemServiceForContext(
  context: ResolvedCoordinationRequestContext,
  now?: () => Date | string,
) {
  return createWorkItemService({
    resolveProject: () => workItemProjectContext(context),
    now,
  });
}

function workItemProjectContext(
  context: ResolvedCoordinationRequestContext,
): ResolvedWorkItemProjectContext {
  const workTracking = context.component.workTracking;
  if (!workTracking) {
    throw new Error(`Component ${context.component.id} work tracking is not configured`);
  }

  return {
    homePath: context.projectConfig.home ?? "",
    projectRoot: context.projectRoot,
    projectId: context.projectConfig.id,
    projectName: context.projectConfig.name,
    componentId: context.component.id,
    componentName: context.component.name,
    sourceRoot: context.component.sourceRoot,
    workTracking,
  };
}

function coordinationRequestId(
  timestamp: string,
  intent: NexusCoordinationRequestIntent,
  target: NexusCoordinationRequestTarget,
): string {
  return `coordreq-${sanitizeIdPart(intent)}-${sanitizeIdPart(target.kind)}-${sanitizeIdPart(target.value)}-${sanitizeIdPart(timestamp)}`;
}

function projectSummary(
  context: ResolvedCoordinationRequestContext,
): NexusCoordinationRequestResult["project"] {
  return {
    id: context.projectConfig.id,
    name: context.projectConfig.name,
    projectRoot: context.projectRoot,
  };
}

function componentSummary(
  component: ResolvedNexusProjectComponent,
): NexusCoordinationRequestResult["component"] {
  return {
    id: component.id,
    name: component.name,
    role: component.role,
    sourceRoot: component.sourceRoot,
    worktreesRoot: component.worktreesRoot,
    workTrackingProvider: component.workTracking?.provider ?? null,
  };
}

function findGitRepositoryPath(
  gitRunner: GitRunner,
  candidates: string[],
): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    const result = runOptionalGit(gitRunner, ["rev-parse", "--show-toplevel"], resolved);
    const repositoryPath = gitStdout(result);
    if (repositoryPath) {
      return path.resolve(repositoryPath);
    }
  }

  return null;
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

function gitStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout.trim();
  return value ? value : null;
}

function parsePorcelainStatus(output: string): {
  dirty: boolean;
} {
  return {
    dirty: output.split(/\r?\n/u).some((line) => line.trim().length > 0),
  };
}

function parseAheadBehind(
  output: string | null,
): { ahead: number | null; behind: number | null } {
  if (!output) {
    return { ahead: null, behind: null };
  }
  const [aheadValue, behindValue] = output.split(/\s+/u);
  const ahead = Number(aheadValue);
  const behind = Number(behindValue);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return { ahead: null, behind: null };
  }

  return { ahead, behind };
}

function inferWorkItemIdFromBranch(branch: string | null): string | undefined {
  const match = branch?.match(/local-\d+/u);
  return match?.[0];
}

function samePathOrDescendant(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function currentTimestamp(now?: () => Date | string): string {
  const value = now?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizedStringArray(
  values: string[] | undefined,
  pathName: string,
): string[] {
  if (!values) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = requiredNonEmptyString(value, pathName);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableTrimmedString(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return optionalTrimmedString(value) ?? null;
}

function requiredNonEmptyString(value: string, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}

function positiveIntegerOrNull(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function githubWebHost(host: string | null | undefined): string {
  const value = host?.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  if (!value || value === "api.github.com") {
    return "github.com";
  }

  return value;
}

function gitlabWebHost(host: string | null | undefined): string {
  const value = host?.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  if (!value || value === "gitlab.com" || value.endsWith("/api/v4")) {
    return "gitlab.com";
  }

  return value;
}

function sanitizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}
