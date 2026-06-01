export type NexusWorkflowModeId =
  | "quick_fix"
  | "heartbeat"
  | "cleanup"
  | "investigation"
  | "release";

export interface NexusWorkflowModeChecklist {
  id: NexusWorkflowModeId;
  displayName: string;
  summary: string;
  requiredArtifacts: string[];
  optionalArtifacts: string[];
  skippedByDefault: string[];
  forbiddenArtifacts: string[];
  targetStateRequiredWhen: string[];
  finalSummaryMustReport: string[];
}

const workflowModeChecklists: NexusWorkflowModeChecklist[] = [
  {
    id: "quick_fix",
    displayName: "Quick Fix",
    summary:
      "Use for one bounded provider-native issue or defect where durable workspace state should stay untouched unless policy or active project state changed.",
    requiredArtifacts: [
      "expected Git identity and co-author trailers",
      "isolated branch or owned worktree for source edits",
      "focused verification evidence",
      "publication handoff or pull request link",
      "provider issue closure or explicit remaining blocker",
    ],
    optionalArtifacts: [
      "coordination handoff when multiple agents or branches are involved",
      "target-state edit when an active decision, blocker, boundary, or next direction changed",
      "workspace metadata change when policy/config changed",
    ],
    skippedByDefault: [
      "target-cycle record",
      "target-state rewrite",
      "workspace metadata pull request",
      "lease-only project metadata update",
      "work-item sync execution",
    ],
    forbiddenArtifacts: [
      "live provider mirroring beyond the approved high-signal comment/status policy",
      "remote runtime execution unless an approved runner profile explicitly owns it",
    ],
    targetStateRequiredWhen: [
      "current objective changes",
      "active blocker changes",
      "current decision or policy changes",
      "next direction changes",
      "boundary or exceptional recent change must be preserved",
    ],
    finalSummaryMustReport: [
      "branch, commit, and PR or handoff",
      "verification commands and outcomes",
      "issue closure or remaining blocker",
      "skipped bookkeeping that would be required in heartbeat mode",
    ],
  },
  {
    id: "heartbeat",
    displayName: "Heartbeat",
    summary:
      "Use for autonomous coordinator loops that select batches, advance tracker state, and keep durable target/run facts current.",
    requiredArtifacts: [
      "eligible-work discovery result",
      "target-cycle facts",
      "work-item comments or status updates",
      "coordination handoffs for active branches when available",
      "target-state update when active facts changed",
      "structured run result",
    ],
    optionalArtifacts: [
      "parallel subagent result records",
      "target report",
      "provider smoke evidence after approved live policy",
    ],
    skippedByDefault: [],
    forbiddenArtifacts: [
      "Vibe workspace/session/execution creation",
      "live runtime or destructive host actions without an approved runner profile",
    ],
    targetStateRequiredWhen: [
      "selected target, blockers, decisions, boundaries, or next direction changed",
      "completed history would otherwise be the only update; compact instead",
    ],
    finalSummaryMustReport: [
      "selected work items and outcomes",
      "target-cycle/run facts written",
      "verification status",
      "publication and blockers",
    ],
  },
  {
    id: "cleanup",
    displayName: "Cleanup",
    summary:
      "Use for branch, worktree, projection, or local runtime cleanup after integration state is known.",
    requiredArtifacts: [
      "cleanup plan with candidate ids",
      "ancestor/merge or abandonment evidence",
      "explicit preserved-dirty-state notes",
    ],
    optionalArtifacts: [
      "provider handoff comment when cleanup changes reviewer-visible state",
      "workspace metadata update when cleanup changes tracked policy/config",
    ],
    skippedByDefault: [
      "target-cycle record unless launched by automation",
      "target-state edit unless cleanup changes active blockers or boundaries",
    ],
    forbiddenArtifacts: [
      "deleting ambiguous dirty worktrees",
      "deleting unmerged branches without explicit approval",
    ],
    targetStateRequiredWhen: [
      "cleanup removes or adds an active blocker",
      "cleanup changes current operating boundaries",
    ],
    finalSummaryMustReport: [
      "deleted and preserved candidates",
      "verification evidence used before deletion",
      "remaining ambiguous cleanup items",
    ],
  },
  {
    id: "investigation",
    displayName: "Investigation",
    summary:
      "Use for read-only diagnosis or policy research before source or provider mutation is approved.",
    requiredArtifacts: [
      "evidence sources inspected",
      "diagnosis or decision tree",
      "recommended next implementable issue or unblocker",
    ],
    optionalArtifacts: [
      "draft issue comment",
      "prototype outside durable source",
    ],
    skippedByDefault: [
      "source commit",
      "publication handoff",
      "target-cycle record unless launched by automation",
    ],
    forbiddenArtifacts: [
      "live provider writes without explicit approval",
      "source or workspace mutation unless investigation becomes implementation",
    ],
    targetStateRequiredWhen: [
      "the investigation changes an active decision, blocker, or next direction",
    ],
    finalSummaryMustReport: [
      "findings and confidence",
      "open questions",
      "recommended implementation path",
    ],
  },
  {
    id: "release",
    displayName: "Release",
    summary:
      "Use for release trains, package publication, protected branch integration, and externally visible version changes.",
    requiredArtifacts: [
      "release scope and target branch",
      "required checks and provider evidence",
      "authority/approval evidence",
      "publication result or blocked release decision",
    ],
    optionalArtifacts: [
      "release notes",
      "changelog",
      "candidate branch plan",
    ],
    skippedByDefault: [],
    forbiddenArtifacts: [
      "self-approval by the same bot actor under default policy",
      "publishing with stale required checks",
      "token or secret material in shared project state",
    ],
    targetStateRequiredWhen: [
      "release train scope, blocker, authority, or next release direction changed",
    ],
    finalSummaryMustReport: [
      "release scope and checks",
      "approval and merge/publish actor",
      "published artifacts or blockers",
    ],
  },
];

const checklistByMode = new Map(
  workflowModeChecklists.map((checklist) => [checklist.id, checklist]),
);

export function listNexusWorkflowModeChecklists(): NexusWorkflowModeChecklist[] {
  return workflowModeChecklists.map(cloneChecklist);
}

export function getNexusWorkflowModeChecklist(
  mode: NexusWorkflowModeId,
): NexusWorkflowModeChecklist {
  const checklist = checklistByMode.get(mode);
  if (!checklist) {
    throw new Error(`Unknown DevNexus workflow mode: ${mode}`);
  }

  return cloneChecklist(checklist);
}

export function parseNexusWorkflowModeId(value: string): NexusWorkflowModeId {
  const normalized = value.trim().toLowerCase().replace(/-/gu, "_");
  if (checklistByMode.has(normalized as NexusWorkflowModeId)) {
    return normalized as NexusWorkflowModeId;
  }

  throw new Error(
    `workflow mode must be one of ${workflowModeChecklists.map((mode) => mode.id).join(", ")}`,
  );
}

function cloneChecklist(
  checklist: NexusWorkflowModeChecklist,
): NexusWorkflowModeChecklist {
  return {
    ...checklist,
    requiredArtifacts: [...checklist.requiredArtifacts],
    optionalArtifacts: [...checklist.optionalArtifacts],
    skippedByDefault: [...checklist.skippedByDefault],
    forbiddenArtifacts: [...checklist.forbiddenArtifacts],
    targetStateRequiredWhen: [...checklist.targetStateRequiredWhen],
    finalSummaryMustReport: [...checklist.finalSummaryMustReport],
  };
}
