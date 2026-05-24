import { describe, expect, it } from "vitest";
import {
  reportNexusVersionReadiness,
  type NexusVersionGreenMainValidationEvidence,
  type NexusVersionReadinessFacts,
} from "../../src/operations/nexusVersionReadiness.js";
import type { NexusAuthorityProjectSummary } from "../../src/authority/nexusAuthority.js";
import type { NexusAutomationTargetCycleRecord } from "../../src/automation/nexusAutomationTargetCycle.js";
import type { NexusVersionConfig } from "../../src/operations/nexusVersionPlanningConfig.js";
import type {
  NexusVersionResolvedScopeItem,
  NexusVersionScopeResult,
} from "../../src/operations/nexusVersionScopeResolver.js";
import type { WorkItem, WorkStatus } from "../../src/work-items/workTrackingTypes.js";

describe("version readiness reporter", () => {
  it("reports a complete version from work, check, release, and authority facts", () => {
    const version = versionConfig({
      releasePolicy: {
        tags: "none",
        packages: "none",
        providerRelease: "none",
        releaseNotes: "none",
        changelog: "none",
      },
    });
    const report = reportNexusVersionReadiness({
      version,
      scope: scopeResult([
        scopeItem("local-1", "core", "committed", "done"),
        scopeItem("local-2", "docs", "candidate", "done"),
      ]),
      facts: {
        authority: authoritySummary({
          core: ["git.commit"],
          docs: ["git.commit"],
        }),
        publicationDecisions: [{
          type: "review_handoff",
          targetBranch: "main",
          remote: "bot",
          prUrl: "https://example.test/pull/1",
          reason: "validated branch",
          decidedAt: "2026-05-20T00:00:00.000Z",
        }],
        greenMainValidation: [
          greenMain("core", "green", ["build"]),
          greenMain("docs", "green", ["build"]),
        ],
      },
    });

    expect(report.ready).toBe(true);
    expect(report.progress).toMatchObject({
      totalScopeItemCount: 2,
      requiredScopeItemCount: 2,
      blockedWorkItemCount: 0,
      failedWorkItemCount: 0,
      deferredWorkItemCount: 0,
      stretchWorkItemCount: 0,
      byWorkStatus: {
        done: 2,
      },
      byScopeStatus: {
        committed: 1,
        candidate: 1,
      },
    });
    expect(report.gates.map((gate) => [gate.kind, gate.status])).toEqual([
      ["work_items_done", "passed"],
      ["no_blockers", "passed"],
      ["checks_green", "passed"],
      ["release_authority", "passed"],
    ]);
    expect(report.release.state).toBe("not_required");
    expect(report.release.publicationDecisionEvidence).toEqual([
      "publication decision: review_handoff to main via bot",
    ]);
    expect(report.warnings).toEqual([]);
  });

  it("fails blocker gates and counts blocked work", () => {
    const report = reportNexusVersionReadiness({
      version: versionConfig(),
      scope: scopeResult([
        scopeItem("local-1", "core", "committed", "blocked"),
        scopeItem("local-2", "core", "candidate", "done"),
      ]),
      facts: {
        greenMainValidation: [greenMain("core", "green", ["build"])],
      },
    });

    expect(report.ready).toBe(false);
    expect(report.progress.blockedWorkItemCount).toBe(1);
    expect(report.progress.byBlockerState).toEqual({
      blocked: 1,
      unblocked: 1,
    });
    expect(report.gateByKind.no_blockers).toMatchObject({
      status: "failed",
      failingWorkItemIds: ["local-1"],
    });
    expect(report.gateByKind.work_items_done).toMatchObject({
      status: "failed",
      failingWorkItemIds: ["local-1"],
    });
  });

  it("uses target-cycle history to count failed scoped work", () => {
    const failedCycle = targetCycle([
      {
        componentId: "core",
        id: "local-2",
        cycleStatus: "failed",
      },
    ]);
    const report = reportNexusVersionReadiness({
      version: versionConfig(),
      scope: scopeResult([
        scopeItem("local-1", "core", "committed", "done"),
        scopeItem("local-2", "core", "candidate", "in_progress"),
      ]),
      facts: {
        targetCycles: [failedCycle],
        greenMainValidation: [greenMain("core", "green", ["build"])],
      },
    });

    expect(report.progress.failedWorkItemCount).toBe(1);
    expect(report.progress.failedWorkItemIds).toEqual(["local-2"]);
    expect(report.gateByKind.work_items_done).toMatchObject({
      status: "failed",
      failingWorkItemIds: ["local-2"],
    });
  });

  it("counts deferred and stretch work without making it required scope", () => {
    const report = reportNexusVersionReadiness({
      version: versionConfig(),
      scope: scopeResult([
        scopeItem("local-1", "core", "committed", "done"),
        scopeItem("local-2", "core", "deferred", "ready"),
        scopeItem("local-3", "core", "stretch", "ready"),
      ]),
      facts: {
        greenMainValidation: [greenMain("core", "green", ["build"])],
      },
    });

    expect(report.ready).toBe(true);
    expect(report.progress).toMatchObject({
      totalScopeItemCount: 3,
      requiredScopeItemCount: 1,
      deferredWorkItemCount: 1,
      stretchWorkItemCount: 1,
      byScopeStatus: {
        committed: 1,
        deferred: 1,
        stretch: 1,
      },
    });
    expect(report.gateByKind.work_items_done).toMatchObject({
      status: "passed",
      checkedWorkItemIds: ["local-1"],
    });
  });

  it("emits stable warnings when configured gates have no usable facts", () => {
    const report = reportNexusVersionReadiness({
      version: versionConfig({
        readinessGates: [
          { kind: "docs_ready", required: true, components: ["core"] },
          { kind: "migration_ready", required: true, components: ["core"] },
          { kind: "release_authority", required: true, components: ["core"] },
        ],
        releasePolicy: {
          tags: "none",
          packages: "manual",
          providerRelease: "manual",
          releaseNotes: "required",
          changelog: "required",
        },
      }),
      scope: scopeResult([
        scopeItem("local-1", "core", "committed", "done"),
      ]),
    });

    expect(report.ready).toBe(false);
    expect(report.gates.map((gate) => [gate.kind, gate.status])).toEqual([
      ["docs_ready", "warning"],
      ["migration_ready", "warning"],
      ["release_authority", "warning"],
    ]);
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      "gate_no_evidence",
      "gate_no_evidence",
      "release_authority_missing",
      "release_artifact_missing",
      "release_artifact_missing",
      "gate_no_evidence",
    ]);
  });

  it("treats green-main validation as evidence without granting publication authority", () => {
    const report = reportNexusVersionReadiness({
      version: versionConfig({
        readinessGates: [
          {
            kind: "checks_green",
            required: true,
            components: ["core"],
            checkNames: ["Node 22 check (ubuntu-latest)"],
          },
          { kind: "release_authority", required: true, components: ["core"] },
        ],
        releasePolicy: {
          tags: "manual",
          packages: "manual",
          providerRelease: "manual",
          releaseNotes: "none",
          changelog: "none",
        },
      }),
      scope: scopeResult([
        scopeItem("local-1", "core", "committed", "done"),
      ]),
      facts: {
        authority: authoritySummary({
          core: ["git.commit", "git.push_branch"],
        }, {
          core: [
            "git.push_target_branch",
            "provider.pull_request.merge",
            "package.publish",
            "release.publish",
          ],
        }),
        greenMainValidation: [
          greenMain("core", "green", ["Node 22 check (ubuntu-latest)"]),
        ],
      },
    });

    expect(report.gateByKind.checks_green).toMatchObject({
      status: "passed",
      evidenceOnly: true,
      grantsAuthority: false,
    });
    expect(report.authority).toMatchObject({
      directTargetPushAllowed: false,
      mergeAllowed: false,
      packagePublishAllowed: false,
      releasePublishAllowed: false,
    });
    expect(report.release.state).toBe("blocked");
    expect(report.gateByKind.release_authority).toMatchObject({
      status: "failed",
    });
  });
});

function versionConfig(
  overrides: Partial<NexusVersionConfig> = {},
): NexusVersionConfig {
  return {
    id: "0.2.0",
    objective: "Ship version readiness.",
    owningComponents: ["core"],
    targetBranch: "main",
    scope: [],
    readinessGates: [
      { kind: "work_items_done", required: true, components: ["core"] },
      { kind: "no_blockers", required: true, components: ["core"] },
      {
        kind: "checks_green",
        required: true,
        components: ["core"],
        checkNames: ["build"],
      },
      { kind: "release_authority", required: true, components: ["core"] },
    ],
    releasePolicy: {
      tags: "none",
      packages: "none",
      providerRelease: "none",
      releaseNotes: "none",
      changelog: "none",
    },
    ...overrides,
  };
}

function scopeResult(items: NexusVersionResolvedScopeItem[]): NexusVersionScopeResult {
  return {
    versionId: "0.2.0",
    items,
    warnings: [],
  };
}

function scopeItem(
  id: string,
  componentId: string,
  scopeStatus: NexusVersionResolvedScopeItem["scopeStatus"],
  workStatus: WorkStatus,
): NexusVersionResolvedScopeItem {
  return {
    versionId: "0.2.0",
    componentId,
    workItem: workItem(id, workStatus),
    scopeStatus,
    scopeStatuses: [scopeStatus],
    scopeEntryIndexes: [0],
    scopeEntries: [],
    sourceTrackerRef: {
      componentId,
      trackerId: "local",
      provider: "local",
    },
    canonicalTrackerRef: {
      componentId,
      trackerId: "local",
      provider: "local",
    },
    logicalItemId: id,
    dedupe: null,
  };
}

function workItem(id: string, status: WorkStatus): WorkItem {
  return {
    id,
    title: id,
    status,
    provider: "local",
    labels: [],
    assignees: [],
    milestone: null,
    externalRef: {
      provider: "local",
      itemId: id,
    },
  };
}

function greenMain(
  componentId: string,
  status: NexusVersionGreenMainValidationEvidence["status"],
  checkNames: string[],
): NexusVersionGreenMainValidationEvidence {
  return {
    componentId,
    source: "pull_request",
    status,
    checkNames,
    message: null,
  };
}

function targetCycle(
  workItems: Array<{
    componentId: string;
    id: string;
    cycleStatus: "failed";
  }>,
): NexusAutomationTargetCycleRecord {
  return {
    id: "target-cycle-1",
    projectId: "demo",
    targetId: "demo",
    runId: "run-1",
    status: "failed",
    startedAt: "2026-05-20T00:00:00.000Z",
    finishedAt: "2026-05-20T00:01:00.000Z",
    objective: null,
    summary: null,
    eligibleWorkItemCount: null,
    workItems: workItems.map((item) => ({
      componentId: item.componentId,
      trackerId: "local",
      trackerProvider: "local",
      id: item.id,
      logicalItemId: item.id,
      title: item.id,
      status: null,
      cycleStatus: item.cycleStatus,
      agentProfileId: null,
      notes: null,
    })),
    authority: null,
    blockers: [],
    notes: [],
    nextCycleNotBefore: null,
  };
}

function authoritySummary(
  allowedByComponent: Record<string, string[]>,
  blockedByComponent: Record<string, string[]> = {},
): NexusAuthorityProjectSummary {
  return {
    version: 1,
    projectId: "demo",
    components: Object.keys({ ...allowedByComponent, ...blockedByComponent }).map(
      (componentId) => ({
        version: 1,
        componentId,
        componentName: componentId,
        actor: {
          status: "matched",
          actorId: "bot",
          knownActor: true,
          kind: "machine_user",
          provider: "github",
          handle: "bot",
          displayName: "bot",
        },
        authProfile: {
          id: "bot-github",
          provider: "github",
          kind: "automation",
        },
        roleBindings: [],
        roles: ["maintainer"],
        keyAllowedActions: allowedByComponent[componentId] as never[],
        blockedActions: blockedByComponent[componentId] as never[] ?? [],
        waitingActions: [],
        fallbackActions: [],
        decisions: [],
        warnings: [],
        summary: componentId,
      }),
    ),
    warnings: [],
    summary: "demo",
  };
}
