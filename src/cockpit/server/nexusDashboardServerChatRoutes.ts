import fs from "node:fs";
import path from "node:path";
import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import {
  buildNexusDashboardSnapshot,
  recordNexusDashboardThreadResolution,
  type BuildNexusDashboardHostSnapshotOptions,
  type BuildNexusDashboardSnapshotOptions,
  type NexusDashboardSnapshot,
} from "./nexusDashboard.js";
import type {
  NexusDashboardCodexChatStarter,
} from "./nexusDashboardCodexChat.js";
import {
  invalidateDashboardCache,
  type NexusDashboardServerCache,
} from "./nexusDashboardServerCache.js";
import {
  NexusDashboardRouteError,
  dashboardErrorBody,
  dashboardErrorStatusCode,
  optionalStringField,
  readJsonBody,
  rejectClientControlledField,
  requireDashboardMutationRequest,
  requiredDashboardThreadResolutionAction,
  requiredStringField,
  sendJson,
} from "./nexusDashboardServerHttp.js";
import {
  resolveDashboardWorkspaceSelection,
  workspaceIdFromUrl,
} from "./nexusDashboardServerWorkspace.js";

interface DashboardThreadActionContext {
  threadId: string | null;
  cwd: string | null;
}

type DashboardFeatureRecord = NexusDashboardSnapshot["features"]["records"][number];
type DashboardThreadRecord = NexusDashboardSnapshot["threads"]["records"][number];
type DashboardTrackedWorkItem = NexusDashboardSnapshot["trackedWork"]["records"][number];
type DashboardWorktreeRecord = NexusDashboardSnapshot["worktrees"]["records"][number];

export async function routeCodexThreadStart(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  codexChatStarter: NexusDashboardCodexChatStarter,
  actionToken: string,
  dashboardCache: NexusDashboardServerCache,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const workspaceId = workspaceIdFromUrl(url);
    const body = await readJsonBody(request);
    const prompt = requiredStringField(body, "prompt");
    const title = optionalStringField(body, "title");
    const targetId = optionalStringField(body, "targetId");
    rejectClientControlledField(body, "profileId");
    rejectClientControlledField(body, "projectRoot");
    rejectClientControlledField(body, "workspaceRoot");
    rejectClientControlledField(body, "cwd");
    rejectClientControlledField(body, "threadId");
    rejectClientControlledField(body, "assistantThreadId");
    const selection = await resolveDashboardWorkspaceSelection(
      snapshotOptions,
      workspaceId,
    );
    const threadContext = targetId
      ? await resolveDashboardThreadActionContext(selection.snapshotOptions, targetId)
      : null;
    const result = await codexChatStarter.start({
      projectRoot: selection.snapshotOptions.projectRoot,
      prompt,
      ...(title ? { title } : {}),
      ...(threadContext?.threadId ? { threadId: threadContext.threadId } : {}),
      ...(threadContext?.cwd ? { cwd: threadContext.cwd } : {}),
    });
    invalidateDashboardCache(dashboardCache);
    sendJson(response, { ok: true, result }, 201);
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

export async function routeDashboardThreadAction(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  actionToken: string,
  dashboardCache: NexusDashboardServerCache,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const workspaceId = workspaceIdFromUrl(url);
    const body = await readJsonBody(request);
    const threadId = requiredStringField(body, "threadId");
    const action = requiredDashboardThreadResolutionAction(body, "action");
    rejectClientControlledField(body, "projectRoot");
    rejectClientControlledField(body, "workspaceRoot");
    rejectClientControlledField(body, "path");
    rejectClientControlledField(body, "cwd");
    const selection = await resolveDashboardWorkspaceSelection(
      snapshotOptions,
      workspaceId,
    );
    const snapshot = await buildNexusDashboardSnapshot(selection.snapshotOptions);
    const thread = snapshot.threads.records.find((record) =>
      record.id === threadId
    );
    if (!thread) {
      throw new NexusDashboardRouteError(
        "thread_not_found",
        `Dashboard thread ${threadId} is not active in this workspace`,
        404,
      );
    }
    if (thread.decision !== action) {
      throw new NexusDashboardRouteError(
        "thread_action_not_allowed",
        `Dashboard thread ${threadId} is marked ${thread.decision}, not ${action}`,
        409,
      );
    }
    const record = recordNexusDashboardThreadResolution({
      projectRoot: selection.snapshotOptions.projectRoot,
      action,
      thread,
      now: snapshotOptions.now,
    });
    invalidateDashboardCache(dashboardCache);
    sendJson(response, {
      ok: true,
      result: {
        action: record.action,
        threadId: record.threadId,
        decidedAt: record.decidedAt,
        scope: "local",
      },
    });
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

async function resolveDashboardThreadActionContext(
  snapshotOptions: BuildNexusDashboardSnapshotOptions,
  targetId: string,
): Promise<DashboardThreadActionContext | null> {
  const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
  if (targetId.startsWith("thread:")) {
    const threadRecordId = targetId.slice("thread:".length);
    if (!threadRecordId) {
      return null;
    }
    return dashboardThreadContextById(snapshot, threadRecordId);
  }
  if (targetId.startsWith("tracked-work:")) {
    return dashboardThreadContextByTrackedWorkSelectId(snapshot, targetId);
  }
  if (targetId.startsWith("feature:")) {
    return dashboardThreadContextByFeatureSelectId(snapshot, targetId);
  }
  return null;
}

function dashboardThreadContextById(
  snapshot: NexusDashboardSnapshot,
  threadRecordId: string,
): DashboardThreadActionContext | null {
  const thread = snapshot.threads.records.find((record) =>
    record.id === threadRecordId
  );
  const worktree = thread
    ? dashboardWorktreeForThread(snapshot, thread)
    : snapshot.worktrees.records.find((record) => record.id === threadRecordId);
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardThreadContextByTrackedWorkSelectId(
  snapshot: NexusDashboardSnapshot,
  targetId: string,
): DashboardThreadActionContext | null {
  const item = dashboardTrackedWorkBySelectId(snapshot, targetId);
  if (!item) {
    return null;
  }
  const thread = snapshot.threads.records.find((record) =>
    dashboardThreadMatchesTrackedWork(record, item)
  );
  const worktree = thread
    ? dashboardWorktreeForThread(snapshot, thread)
    : dashboardWorktreeForTrackedWork(snapshot, item);
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardThreadContextByFeatureSelectId(
  snapshot: NexusDashboardSnapshot,
  targetId: string,
): DashboardThreadActionContext | null {
  const feature = snapshot.features.records.find((record) => record.id === targetId);
  if (!feature) {
    return null;
  }
  const branches = dashboardFeatureBranches(feature);
  const thread = snapshot.threads.records.find((record) =>
    dashboardBranchSetsIntersect([record.branchName], branches)
  );
  const worktree = thread
    ? dashboardWorktreeForThread(snapshot, thread)
    : snapshot.worktrees.records.find((record) =>
      dashboardBranchSetsIntersect([record.branchName], branches)
    );
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardTrackedWorkBySelectId(
  snapshot: NexusDashboardSnapshot,
  targetId: string,
): DashboardTrackedWorkItem | null {
  const parts = targetId.split(":");
  const componentId = parts[1] ?? "";
  const itemId = parts.slice(2).join(":");
  if (!componentId || !itemId) {
    return null;
  }
  return snapshot.trackedWork.records.find((item) =>
    item.componentId === componentId && item.id === itemId
  ) ?? null;
}

function dashboardThreadMatchesTrackedWork(
  thread: DashboardThreadRecord,
  item: DashboardTrackedWorkItem,
): boolean {
  const itemIds = new Set(
    [item.id, item.logicalItemId].filter((value): value is string => Boolean(value)),
  );
  return Boolean(
    thread.workItemId && itemIds.has(thread.workItemId) &&
      (!thread.componentId || thread.componentId === item.componentId),
  );
}

function dashboardWorktreeForThread(
  snapshot: NexusDashboardSnapshot,
  thread: DashboardThreadRecord,
): DashboardWorktreeRecord | null {
  return snapshot.worktrees.records.find((record) => record.id === thread.id) ??
    snapshot.worktrees.records.find((record) =>
      dashboardBranchSetsIntersect([record.branchName], [thread.branchName])
    ) ??
    snapshot.worktrees.records.find((record) =>
      Boolean(thread.workItemId && record.workItemId === thread.workItemId)
    ) ??
    null;
}

function dashboardWorktreeForTrackedWork(
  snapshot: NexusDashboardSnapshot,
  item: DashboardTrackedWorkItem,
): DashboardWorktreeRecord | null {
  const itemIds = new Set(
    [item.id, item.logicalItemId].filter((value): value is string => Boolean(value)),
  );
  return snapshot.worktrees.records.find((record) =>
    Boolean(record.workItemId && itemIds.has(record.workItemId)) &&
    (!record.componentId || record.componentId === item.componentId)
  ) ?? null;
}

function dashboardFeatureBranches(feature: DashboardFeatureRecord): string[] {
  return [
    feature.featureBranch,
    ...(feature.branches ?? []),
  ].filter((branch): branch is string => Boolean(branch?.trim()));
}

function dashboardBranchSetsIntersect(
  left: Array<string | null | undefined>,
  right: Array<string | null | undefined>,
): boolean {
  const normalizedRight = new Set(right.map(dashboardNormalizeBranchName).filter(Boolean));
  return left.map(dashboardNormalizeBranchName).some((branch) =>
    Boolean(branch) &&
    (normalizedRight.has(branch) ||
      [...normalizedRight].some((candidate) =>
        candidate.endsWith(`/${branch}`) || branch.endsWith(`/${candidate}`)
      ))
  );
}

function dashboardNormalizeBranchName(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^refs\/heads\//u, "")
    .replace(/^refs\/remotes\//u, "")
    .replace(/^remotes\//u, "");
}

function dashboardChatCwd(worktreePath: string | null): string | null {
  if (!worktreePath) {
    return null;
  }
  const resolvedWorktreePath = path.resolve(worktreePath);
  if (!fs.existsSync(resolvedWorktreePath)) {
    return null;
  }
  return resolvedWorktreePath;
}
