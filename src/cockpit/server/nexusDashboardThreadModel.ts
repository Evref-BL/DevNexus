
import path from "node:path";
import type { NexusAutomationRunRecord } from "../../automation/nexusAutomation.js";
import type { NexusCleanupCandidate } from "../../operations/nexusCleanupPlan.js";
import {
  emptyNexusDashboardThreadResolutionStore,
  threadRecordKey,
} from "./nexusDashboardThreadResolution.js";
import type {
  NexusDashboardThreadResolutionRecord,
  NexusDashboardThreadResolutionStore,
} from "./nexusDashboardThreadResolution.js";
import { providerActionsFromText } from "./nexusDashboardProviderActions.js";
import type { NexusDashboardProviderUrls } from "./nexusDashboardProviderActions.js";
import type {
  NexusDashboardThreadDecision,
  NexusDashboardThreadRecord,
  NexusDashboardThreadSummary,
  NexusDashboardWorktreeSummary,
} from "./nexusDashboardTypes.js";

export function summarizeThreads(
  worktrees: NexusDashboardWorktreeSummary,
  providerUrls: NexusDashboardProviderUrls,
  cleanupCandidates: NexusCleanupCandidate[],
  runs: NexusAutomationRunRecord[],
  threadResolutions: NexusDashboardThreadResolutionStore = emptyNexusDashboardThreadResolutionStore(),
  metadata: Pick<NexusDashboardThreadSummary, "source" | "incomplete" | "detail"> = {},
): NexusDashboardThreadSummary {
  const matchedCleanupIds = new Set<string>();
  const assistantThreads = assistantThreadIndex(runs);
  const leaseRecords = worktrees.records
    .map((worktree): NexusDashboardThreadRecord => {
      const cleanup = cleanupCandidateForThread(cleanupCandidates, worktree);
      if (cleanup) {
        matchedCleanupIds.add(cleanup.id);
      }
      const assistantThread = assistantThreadForWork({
        index: assistantThreads,
        componentId: worktree.componentId,
        workItemId: worktree.workItemId,
        branchName: worktree.branchName,
      });
      const decision = threadDecision(worktree, cleanup, assistantThread);
      const actions = providerActionsFromText(
        `${worktree.workItemId ?? ""} ${worktree.branchName ?? ""} ${worktree.id}`,
        providerUrls,
        worktree.componentId,
      );
      return {
        id: worktree.id,
        title: threadTitle(worktree),
        componentId: worktree.componentId,
        workItemId: worktree.workItemId,
        branchName: worktree.branchName,
        hostId: worktree.hostId,
        agentId: worktree.agentId,
        state: worktree.effectiveStatus,
        decision,
        decisionLabel: threadDecisionLabel(decision),
        decisionDetail: threadDecisionDetail(decision, cleanup),
        stale: worktree.stale,
        dirty: worktree.dirty,
        pushed: worktree.pushed,
        cleanupSafe: cleanup?.safeToDelete ?? null,
        cleanupBlockers: cleanup?.blockers ?? [],
        assistantProvider: assistantThread ? "codex" : null,
        assistantThreadId: assistantThread?.threadId ?? null,
        updatedAt: worktree.updatedAt,
        actions,
      };
    });
  const cleanupRecords = cleanupCandidates
    .filter((candidate) => !matchedCleanupIds.has(candidate.id))
    .map((candidate) => cleanupThreadRecord(candidate, providerUrls, assistantThreads));
  const records = uniqueThreadRecords([...leaseRecords, ...cleanupRecords])
    .filter((record) => !threadResolutionForRecord(threadResolutions, record))
    .sort((left, right) => {
      const priority = threadDecisionPriority(left.decision) - threadDecisionPriority(right.decision);
      return priority !== 0 ? priority : right.updatedAt.localeCompare(left.updatedAt);
    });

  const needsDecision = records.filter((record) =>
    !["continue", "resume"].includes(record.decision),
  );
  return {
    totalCount: records.length,
    activeCount: records.filter((record) =>
      ["continue", "resume"].includes(record.decision)
    ).length,
    needsDecisionCount: needsDecision.length,
    archiveCandidateCount: records.filter((record) => record.decision === "archive").length,
    forgetCandidateCount: records.filter((record) => record.decision === "forget").length,
    source: metadata.source ?? (cleanupCandidates.length > 0 ? "cleanup" : "local"),
    incomplete: metadata.incomplete ?? cleanupCandidates.length === 0,
    detail: metadata.detail ?? null,
    records,
  };
}

function threadResolutionForRecord(
  store: NexusDashboardThreadResolutionStore,
  record: NexusDashboardThreadRecord,
): NexusDashboardThreadResolutionRecord | null {
  const key = threadRecordKey(record);
  return store.records.find((resolution) =>
    resolution.threadId === record.id ||
    resolution.threadKey === key ||
    threadResolutionScopeMatches(resolution, record)
  ) ?? null;
}

function threadResolutionScopeMatches(
  resolution: NexusDashboardThreadResolutionRecord,
  record: NexusDashboardThreadRecord,
): boolean {
  const sameComponent =
    !resolution.componentId ||
    !record.componentId ||
    resolution.componentId === record.componentId;
  if (!sameComponent) {
    return false;
  }
  if (resolution.branchName && record.branchName === resolution.branchName) {
    return true;
  }
  return Boolean(resolution.workItemId && record.workItemId === resolution.workItemId);
}

function uniqueThreadRecords(
  records: NexusDashboardThreadRecord[],
): NexusDashboardThreadRecord[] {
  const byKey = new Map<string, NexusDashboardThreadRecord>();
  for (const record of records) {
    const key = threadRecordKey(record);
    const previous = byKey.get(key);
    if (!previous || preferThreadRecord(record, previous) === record) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()];
}

function preferThreadRecord(
  left: NexusDashboardThreadRecord,
  right: NexusDashboardThreadRecord,
): NexusDashboardThreadRecord {
  const priority = threadDecisionPriority(left.decision) - threadDecisionPriority(right.decision);
  if (priority !== 0) {
    return priority < 0 ? left : right;
  }
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  return left.cleanupBlockers.length >= right.cleanupBlockers.length ? left : right;
}

function cleanupThreadRecord(
  candidate: NexusCleanupCandidate,
  providerUrls: NexusDashboardProviderUrls,
  assistantThreads: Map<string, AssistantThreadReference>,
): NexusDashboardThreadRecord {
  const actionText = `${candidate.branch ?? ""} ${candidate.id}`;
  const assistantThread = assistantThreadForWork({
    index: assistantThreads,
    componentId: candidate.componentId,
    workItemId: candidate.lease?.workItemId ?? null,
    branchName: candidate.branch,
  });
  const decision = cleanupThreadDecision(candidate);
  return {
    id: candidate.id,
    title: cleanupThreadTitle(candidate),
    componentId: candidate.componentId,
    workItemId: candidate.lease?.workItemId ?? null,
    branchName: candidate.branch,
    hostId: "local",
    agentId: null,
    state: candidate.classifications.join(", "),
    decision,
    decisionLabel: threadDecisionLabel(decision),
    decisionDetail: threadDecisionDetail(decision, candidate),
    stale: candidate.classifications.includes("stale"),
    dirty: candidate.classifications.includes("dirty"),
    pushed: candidate.git.ahead === 0 ? true : candidate.git.ahead ? false : null,
    cleanupSafe: candidate.safeToDelete,
    cleanupBlockers: candidate.blockers,
    assistantProvider: assistantThread ? "codex" : null,
    assistantThreadId: assistantThread?.threadId ?? null,
    updatedAt: "",
    actions: providerActionsFromText(actionText, providerUrls, candidate.componentId),
  };
}

interface AssistantThreadReference {
  threadId: string;
  finishedAt: string | null;
  startedAt: string;
}

function assistantThreadIndex(
  runs: NexusAutomationRunRecord[],
): Map<string, AssistantThreadReference> {
  const index = new Map<string, AssistantThreadReference>();
  for (const run of runs) {
    const appServer = run.codexAppServer;
    const threadId = appServer?.threadId;
    if (!threadId || appServer.ephemeral || appServer.threadPersistence !== "durable") {
      continue;
    }
    const reference: AssistantThreadReference = {
      threadId,
      finishedAt: run.finishedAt,
      startedAt: run.startedAt,
    };
    for (const key of assistantThreadKeys({
      componentId: run.componentId,
      workItemId: run.workItemId,
      branchName: run.branchName,
    })) {
      const previous = index.get(key);
      if (!previous || assistantThreadReferenceTime(reference) > assistantThreadReferenceTime(previous)) {
        index.set(key, reference);
      }
    }
  }

  return index;
}

function assistantThreadForWork(options: {
  index: Map<string, AssistantThreadReference>;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
}): AssistantThreadReference | null {
  for (const key of assistantThreadKeys(options)) {
    const reference = options.index.get(key);
    if (reference) {
      return reference;
    }
  }

  return null;
}

function assistantThreadKeys(options: {
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
}): string[] {
  const componentId = options.componentId ?? "workspace";
  return [
    options.branchName ? `branch:${componentId}:${options.branchName}` : null,
    options.workItemId ? `work:${componentId}:${options.workItemId}` : null,
  ].filter((key): key is string => Boolean(key));
}

function assistantThreadReferenceTime(reference: AssistantThreadReference): number {
  const time = new Date(reference.finishedAt ?? reference.startedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function cleanupThreadDecision(
  candidate: NexusCleanupCandidate,
): NexusDashboardThreadDecision {
  if (candidate.rescue.needed) {
    return "rescue";
  }
  if (candidate.classifications.includes("merged")) {
    return "merged";
  }
  if (candidate.safeToDelete) {
    return "forget";
  }
  if (candidate.classifications.includes("blocked")) {
    return "blocked";
  }
  return "review";
}

function threadDecision(
  worktree: NexusDashboardWorktreeSummary["records"][number],
  cleanup: NexusCleanupCandidate | null,
  assistantThread: AssistantThreadReference | null,
): NexusDashboardThreadDecision {
  const status = worktree.effectiveStatus || worktree.status;
  if (worktree.dirty) {
    return "rescue";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "merged") {
    return "merged";
  }
  if (cleanup?.safeToDelete) {
    return "forget";
  }
  if (status === "abandoned") {
    return "archive";
  }
  if (assistantThread) {
    return "resume";
  }
  if (
    worktree.stale ||
    status === "stale" ||
    status === "ready"
  ) {
    return "review";
  }
  return "continue";
}

function cleanupCandidateForThread(
  candidates: NexusCleanupCandidate[],
  worktree: NexusDashboardWorktreeSummary["records"][number],
): NexusCleanupCandidate | null {
  return candidates.find((candidate) =>
    candidate.lease?.id === worktree.id ||
    (Boolean(worktree.branchName) && candidate.branch === worktree.branchName)
  ) ?? null;
}

function threadDecisionLabel(decision: NexusDashboardThreadDecision): string {
  switch (decision) {
    case "archive":
      return "Archive";
    case "blocked":
      return "Blocked";
    case "forget":
      return "Forget";
    case "merged":
      return "Merged";
    case "rescue":
      return "Rescue";
    case "resume":
      return "Resume";
    case "review":
      return "Review";
    case "continue":
      return "Continue";
  }
}

function threadDecisionDetail(
  decision: NexusDashboardThreadDecision,
  cleanup: NexusCleanupCandidate | null,
): string {
  switch (decision) {
    case "archive":
      return "Park the thread outside the active flow, keeping its notes and branch context.";
    case "blocked":
      if (cleanup && !cleanup.safeToDelete && cleanup.blockers.length > 0) {
        return cleanup.blockers[0];
      }
      return "A blocker needs a human decision before this thread can continue or be cleaned up.";
    case "forget":
      return "Clean merged work can leave the active cockpit after cleanup proof.";
    case "merged":
      return "Merged work can leave the active cockpit after cleanup proof.";
    case "rescue":
      return "Local changes need inspection before this can be archived or forgotten.";
    case "resume":
      return "A previous assistant chat is available for this thread.";
    case "review":
      if (cleanup && !cleanup.safeToDelete && cleanup.blockers.length > 0) {
        return cleanup.blockers[0];
      }
      return "Decide whether to continue, archive the useful parts, or forget the thread.";
    case "continue":
      return "Active work; keep it visible in the cockpit.";
  }
}

function threadDecisionPriority(decision: NexusDashboardThreadDecision): number {
  switch (decision) {
    case "rescue":
      return 0;
    case "blocked":
      return 1;
    case "review":
      return 2;
    case "merged":
      return 3;
    case "resume":
      return 4;
    case "continue":
      return 5;
    case "archive":
      return 6;
    case "forget":
      return 7;
  }
}

function threadTitle(worktree: NexusDashboardWorktreeSummary["records"][number]): string {
  const branch = worktree.branchName ?? worktree.workItemId ?? worktree.id;
  return compactThreadBranch(branch);
}

function cleanupThreadTitle(candidate: NexusCleanupCandidate): string {
  return compactThreadBranch(
    candidate.branch ??
    (candidate.worktreePath ? path.basename(candidate.worktreePath) : candidate.id),
  );
}

function compactThreadBranch(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : value;
}
