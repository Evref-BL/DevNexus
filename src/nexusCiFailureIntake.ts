import { createHash } from "node:crypto";

export type NexusCiFailureWorkItemStatus =
  | "todo"
  | "ready"
  | "in_progress"
  | "blocked"
  | "done"
  | "wont_do";

export interface NexusCiFailureRepositoryRef {
  owner: string;
  name: string;
}

export interface NexusCiFailureAllowedScope {
  repositories?: NexusCiFailureRepositoryRef[];
  branches?: string[];
  workflows?: string[];
  events?: string[];
  checkNames?: string[];
}

export interface NexusCiFailureIntakePolicy {
  allowed?: NexusCiFailureAllowedScope;
  workItem: {
    componentId: string;
    trackerId?: string | null;
    status?: NexusCiFailureWorkItemStatus;
    labels?: string[];
    assignees?: string[];
    titlePrefix?: string;
  };
  dedupe?: {
    suppressRepeatWithinMinutes?: number | null;
  };
  wakeup?: {
    enabled?: boolean;
    requireEligible?: boolean;
    eligibleStatuses?: NexusCiFailureWorkItemStatus[];
    requiredLabels?: string[];
    excludeLabels?: string[];
  };
}

export interface NexusCiFailurePullRequestRef {
  number: number;
  url?: string | null;
}

export interface NexusCiFailureReplay {
  repository: NexusCiFailureRepositoryRef;
  event: string;
  runId: string | number;
  runUrl?: string | null;
  workflowName: string;
  checkName?: string | null;
  jobName?: string | null;
  headSha: string;
  headBranch: string;
  conclusion: string;
  failureSummary?: string | null;
  pullRequests?: NexusCiFailurePullRequestRef[];
}

export interface NexusCiFailureExistingWorkItem {
  id: string;
  title: string;
  description?: string | null;
  status: NexusCiFailureWorkItemStatus;
  labels?: string[];
  updatedAt?: string | null;
}

export interface NexusCiFailurePlannedWorkItem {
  componentId: string;
  trackerId: string | null;
  title: string;
  description: string;
  status: NexusCiFailureWorkItemStatus;
  labels: string[];
  assignees: string[];
}

export type NexusCiFailureIntakeAction =
  | {
      kind: "create";
      workItem: NexusCiFailurePlannedWorkItem;
    }
  | {
      kind: "update";
      existingWorkItemId: string;
      workItem: NexusCiFailurePlannedWorkItem;
    }
  | {
      kind: "suppress";
      existingWorkItemId: string;
      reason: string;
      until: string;
    }
  | {
      kind: "none";
      reason: string;
    };

export interface NexusCiFailureWakeupDecision {
  shouldWake: boolean;
  reason: string;
}

export interface NexusCiFailureIntakePlan {
  accepted: boolean;
  blockers: string[];
  dedupeKey: string | null;
  dedupeLabel: string | null;
  action: NexusCiFailureIntakeAction;
  wakeup: NexusCiFailureWakeupDecision;
}

export function planNexusCiFailureIntake(options: {
  policy: NexusCiFailureIntakePolicy;
  failure: NexusCiFailureReplay;
  existingWorkItems?: NexusCiFailureExistingWorkItem[];
  now?: string | Date;
}): NexusCiFailureIntakePlan {
  const now = normalizeNow(options.now);
  const failure = options.failure;
  const blockers = scopeBlockers(options.policy.allowed, failure);
  if (!isFailureConclusion(failure.conclusion)) {
    blockers.push(`conclusion "${failure.conclusion}" is not a failure`);
  }

  const dedupeKey = ciFailureDedupeKey(failure);
  const dedupeLabel = ciFailureDedupeLabel(dedupeKey);
  if (blockers.length > 0) {
    return {
      accepted: false,
      blockers,
      dedupeKey,
      dedupeLabel,
      action: { kind: "none", reason: blockers.join("; ") },
      wakeup: { shouldWake: false, reason: blockers.join("; ") },
    };
  }

  const workItem = plannedWorkItem({
    policy: options.policy,
    failure,
    dedupeKey,
    dedupeLabel,
    now,
  });
  const existing = (options.existingWorkItems ?? []).find((item) =>
    matchesExistingFailure(item, dedupeKey, dedupeLabel),
  );
  if (!existing) {
    const action: NexusCiFailureIntakeAction = { kind: "create", workItem };
    return {
      accepted: true,
      blockers: [],
      dedupeKey,
      dedupeLabel,
      action,
      wakeup: wakeupDecision(options.policy, action),
    };
  }

  const suppression = repeatSuppression({
    policy: options.policy,
    existing,
    now,
  });
  if (suppression) {
    const action: NexusCiFailureIntakeAction = {
      kind: "suppress",
      existingWorkItemId: existing.id,
      reason: `repeat failure suppressed until ${suppression}`,
      until: suppression,
    };
    return {
      accepted: true,
      blockers: [],
      dedupeKey,
      dedupeLabel,
      action,
      wakeup: wakeupDecision(options.policy, action),
    };
  }

  const action: NexusCiFailureIntakeAction = {
    kind: "update",
    existingWorkItemId: existing.id,
    workItem,
  };
  return {
    accepted: true,
    blockers: [],
    dedupeKey,
    dedupeLabel,
    action,
    wakeup: wakeupDecision(options.policy, action),
  };
}

function scopeBlockers(
  allowed: NexusCiFailureAllowedScope | undefined,
  failure: NexusCiFailureReplay,
): string[] {
  const blockers: string[] = [];
  const repo = repositoryName(failure.repository);
  if (
    allowed?.repositories?.length &&
    !allowed.repositories.some(
      (candidate) => repositoryName(candidate).toLowerCase() === repo.toLowerCase(),
    )
  ) {
    blockers.push(`repository "${repo}" is not allowed`);
  }

  if (
    allowed?.branches?.length &&
    !allowed.branches.includes(failure.headBranch)
  ) {
    blockers.push(`branch "${failure.headBranch}" is not allowed`);
  }

  if (
    allowed?.workflows?.length &&
    !allowed.workflows.includes(failure.workflowName)
  ) {
    blockers.push(`workflow "${failure.workflowName}" is not allowed`);
  }

  if (allowed?.events?.length && !allowed.events.includes(failure.event)) {
    blockers.push(`event "${failure.event}" is not allowed`);
  }

  const checkName = failure.checkName ?? failure.jobName ?? failure.workflowName;
  if (allowed?.checkNames?.length && !allowed.checkNames.includes(checkName)) {
    blockers.push(`check "${checkName}" is not allowed`);
  }

  return blockers;
}

function plannedWorkItem(options: {
  policy: NexusCiFailureIntakePolicy;
  failure: NexusCiFailureReplay;
  dedupeKey: string;
  dedupeLabel: string;
  now: Date;
}): NexusCiFailurePlannedWorkItem {
  const status = options.policy.workItem.status ?? "ready";
  const labels = dedupeStrings([
    ...(options.policy.workItem.labels ?? []),
    options.dedupeLabel,
  ]);
  const checkName =
    options.failure.jobName ?? options.failure.checkName ?? options.failure.workflowName;
  const prefix = options.policy.workItem.titlePrefix ?? "CI failure";
  const title = `${prefix}: ${options.failure.workflowName} / ${checkName} on ${options.failure.headBranch}`;
  return {
    componentId: options.policy.workItem.componentId,
    trackerId: options.policy.workItem.trackerId ?? null,
    title,
    description: failureDescription({
      failure: options.failure,
      dedupeKey: options.dedupeKey,
      now: options.now,
    }),
    status,
    labels,
    assignees: dedupeStrings(options.policy.workItem.assignees ?? []),
  };
}

function failureDescription(options: {
  failure: NexusCiFailureReplay;
  dedupeKey: string;
  now: Date;
}): string {
  const failure = options.failure;
  const checkName = failure.jobName ?? failure.checkName ?? failure.workflowName;
  const lines = [
    "GitHub Actions failure intake.",
    "",
    `CI-Failure-Dedupe-Key: ${options.dedupeKey}`,
    `CI-Failure-Last-Seen: ${options.now.toISOString()}`,
    `Repository: ${repositoryName(failure.repository)}`,
    `Workflow: ${failure.workflowName}`,
    `Check: ${checkName}`,
    `Head SHA: ${failure.headSha}`,
    `Branch: ${failure.headBranch}`,
    `Event: ${failure.event}`,
    `Conclusion: ${failure.conclusion}`,
    `Run: ${failure.runUrl ?? failure.runId}`,
  ];

  for (const pullRequest of failure.pullRequests ?? []) {
    lines.push(
      `Pull Request: #${pullRequest.number}${pullRequest.url ? ` ${pullRequest.url}` : ""}`,
    );
  }

  if (failure.failureSummary) {
    lines.push(`Failure Summary: ${failure.failureSummary}`);
  }

  return `${lines.join("\n")}\n`;
}

function repeatSuppression(options: {
  policy: NexusCiFailureIntakePolicy;
  existing: NexusCiFailureExistingWorkItem;
  now: Date;
}): string | null {
  const minutes = options.policy.dedupe?.suppressRepeatWithinMinutes;
  if (!minutes || minutes <= 0) {
    return null;
  }

  const lastSeen = lastSeenAt(options.existing);
  if (!lastSeen) {
    return null;
  }

  const until = new Date(lastSeen.getTime() + minutes * 60_000);
  if (options.now.getTime() < until.getTime()) {
    return until.toISOString();
  }

  return null;
}

function wakeupDecision(
  policy: NexusCiFailureIntakePolicy,
  action: NexusCiFailureIntakeAction,
): NexusCiFailureWakeupDecision {
  if (!policy.wakeup?.enabled) {
    return { shouldWake: false, reason: "coordinator wakeup disabled by policy" };
  }

  if (action.kind === "none") {
    return { shouldWake: false, reason: action.reason };
  }
  if (action.kind === "suppress") {
    return { shouldWake: false, reason: action.reason };
  }

  if (!policy.wakeup.requireEligible) {
    return { shouldWake: true, reason: "coordinator wakeup enabled by policy" };
  }

  const eligibleStatuses = policy.wakeup.eligibleStatuses ?? ["ready"];
  if (!eligibleStatuses.includes(action.workItem.status)) {
    return {
      shouldWake: false,
      reason: `planned work item status "${action.workItem.status}" is not eligible`,
    };
  }

  const labels = new Set(action.workItem.labels);
  for (const required of policy.wakeup.requiredLabels ?? []) {
    if (!labels.has(required)) {
      return {
        shouldWake: false,
        reason: `planned work item is missing required label "${required}"`,
      };
    }
  }

  for (const excluded of policy.wakeup.excludeLabels ?? []) {
    if (labels.has(excluded)) {
      return {
        shouldWake: false,
        reason: `planned work item has excluded label "${excluded}"`,
      };
    }
  }

  return {
    shouldWake: true,
    reason: "planned work item is eligible for coordinator wakeup",
  };
}

function matchesExistingFailure(
  item: NexusCiFailureExistingWorkItem,
  dedupeKey: string,
  dedupeLabel: string,
): boolean {
  return (
    (item.labels ?? []).includes(dedupeLabel) ||
    (item.description ?? "").includes(`CI-Failure-Dedupe-Key: ${dedupeKey}`)
  );
}

function lastSeenAt(item: NexusCiFailureExistingWorkItem): Date | null {
  const match = /CI-Failure-Last-Seen:\s*(\S+)/u.exec(item.description ?? "");
  const value = match?.[1] ?? item.updatedAt;
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ciFailureDedupeKey(failure: NexusCiFailureReplay): string {
  return [
    "github-actions",
    repositoryName(failure.repository),
    failure.headSha,
    failure.workflowName,
    failure.jobName ?? failure.checkName ?? failure.workflowName,
  ].join(":");
}

function ciFailureDedupeLabel(dedupeKey: string): string {
  const digest = createHash("sha256").update(dedupeKey).digest("hex").slice(0, 12);
  return `ci-dedupe-${digest}`;
}

function repositoryName(repository: NexusCiFailureRepositoryRef): string {
  return `${repository.owner}/${repository.name}`;
}

function isFailureConclusion(value: string): boolean {
  return [
    "action_required",
    "cancelled",
    "failure",
    "failed",
    "startup_failure",
    "timed_out",
  ].includes(value);
}

function normalizeNow(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
