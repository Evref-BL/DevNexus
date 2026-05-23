import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultNexusAutomationConfig } from "../../src/automation/nexusAutomationConfig.js";
import { defaultNexusReleaseTrainCiTierPolicy } from "../../src/operations/nexusCiTierPolicy.js";
import {
  buildNexusMergeQueueReadinessReport,
  type NexusMergeQueueWorkflowTriggerInput,
} from "../../src/publication/nexusMergeQueueReadiness.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "../../src/project/nexusProjectConfig.js";
import type { NexusPublicationProviderEvidenceInput } from "../../src/publication/nexusPublicationProviderEvidence.js";

const tempDirs: string[] = [];
const now = "2026-05-21T11:30:00.000Z";
const nodeChecks = [
  "Node 22 check (ubuntu-latest)",
  "Node 22 check (windows-latest)",
  "Node 22 check (macos-latest)",
];
const mergeGroupTrigger: NexusMergeQueueWorkflowTriggerInput[] = [
  {
    workflowName: "CI",
    path: ".github/workflows/ci.yml",
    events: ["pull_request", "merge_group"],
  },
];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("merge queue readiness", () => {
  it("treats disabled merge queue checks as not required", () => {
    const projectRoot = makeTempDir("dev-nexus-merge-queue-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: false,
      now,
    });

    expect(report).toMatchObject({
      mutatesSource: false,
      mergeQueue: {
        enabled: false,
        workflowTriggerStatus: "not_configured",
      },
      nextAction: "not_required",
      blockers: [],
    });
  });

  it("distinguishes candidate matrix evidence from successful merge_group protected gate evidence", () => {
    const projectRoot = makeTempDir("dev-nexus-merge-queue-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: mergeGroupTrigger,
      providerEvidence: [
        providerEvidence("candidate_branch", "candidate/0.2.0", "candidate_matrix", "pass"),
        providerEvidence(
          "merge_queue_group",
          "refs/heads/gh-readonly-queue/main/pr-130",
          "protected_target",
          "pass",
        ),
      ],
      now,
    });

    expect(report.mergeQueue.workflowTriggerStatus).toBe("present");
    expect(report.ciTiers.protectedTarget.tier.id).toBe("protected_target");
    expect(report.candidateMatrixEvidence).toMatchObject([
      {
        sourceKind: "candidate_branch",
        intendedCiTier: "candidate_matrix",
        status: "success",
      },
    ]);
    expect(report.protectedTargetGate).toMatchObject({
      sourceKind: "merge_queue_group",
      headRef: "refs/heads/gh-readonly-queue/main/pr-130",
      intendedCiTier: "protected_target",
      status: "success",
    });
    expect(report.nextAction).toBe("wait");
    expect(report.blockers).toEqual([]);
  });

  it("warns and requests workflow update when configured merge queue lacks merge_group trigger evidence", () => {
    const projectRoot = makeTempDir("dev-nexus-merge-queue-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: [
        {
          workflowName: "CI",
          events: ["pull_request", "workflow_dispatch"],
        },
      ],
      providerEvidence: [
        providerEvidence(
          "merge_queue_group",
          "refs/heads/gh-readonly-queue/main/pr-130",
          "protected_target",
          "pass",
        ),
      ],
      now,
    });

    expect(report.mergeQueue.workflowTriggerStatus).toBe("missing");
    expect(report.nextAction).toBe("update_workflow");
    expect(report.blockers).toContain(
      "configured merge queue lacks workflow trigger evidence for merge_group",
    );
    expect(report.warnings).toContain(
      "required workflows appear to lack a merge_group trigger",
    );
  });

  it("requests a human decision when workflow trigger evidence is unavailable", () => {
    const projectRoot = makeTempDir("dev-nexus-merge-queue-");
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      providerEvidence: [],
      now,
    });

    expect(report.mergeQueue.workflowTriggerStatus).toBe("unknown");
    expect(report.nextAction).toBe("request_human_decision");
    expect(report.warnings).toContain(
      "workflow trigger evidence is unavailable; cannot confirm merge_group coverage",
    );
  });

  it("waits when merge queue group checks are pending and enters the queue when absent", () => {
    const projectRoot = makeTempDir("dev-nexus-merge-queue-");
    saveProjectConfig(projectRoot, projectConfig());

    const pending = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: mergeGroupTrigger,
      providerEvidence: [
        providerEvidence(
          "merge_queue_group",
          "refs/heads/gh-readonly-queue/main/pr-130",
          "protected_target",
          "pending",
        ),
      ],
      now,
    });
    const absent = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: mergeGroupTrigger,
      providerEvidence: [],
      now,
    });

    expect(pending.protectedTargetGate.status).toBe("pending");
    expect(pending.nextAction).toBe("wait");
    expect(pending.warnings).toContain(
      "merge queue protected target checks are still pending",
    );
    expect(absent.protectedTargetGate.status).toBe("unavailable");
    expect(absent.nextAction).toBe("enter_merge_queue");
    expect(absent.warnings).toContain("merge queue group evidence is unavailable");
  });

  it("blocks on failed, stale, missing, and unknown merge queue evidence", () => {
    const projectRoot = makeTempDir("dev-nexus-merge-queue-");
    saveProjectConfig(projectRoot, projectConfig());

    const failed = reportForStatus(projectRoot, "fail");
    const stale = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: mergeGroupTrigger,
      providerEvidence: [
        {
          ...providerEvidence(
            "merge_queue_group",
            "refs/heads/gh-readonly-queue/main/pr-130",
            "protected_target",
            "pass",
          ),
          stale: true,
        },
      ],
      now,
    });
    const missing = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: mergeGroupTrigger,
      providerEvidence: [
        {
          provider: "github",
          sourceKind: "merge_queue_group",
          headRef: "refs/heads/gh-readonly-queue/main/pr-130",
          targetBranch: "main",
          intendedCiTier: "protected_target",
          checks: [{ name: nodeChecks[0]!, bucket: "pass" }],
        },
      ],
      now,
    });
    const unknown = buildNexusMergeQueueReadinessReport({
      projectRoot,
      mergeQueueEnabled: true,
      workflowTriggers: mergeGroupTrigger,
      providerEvidence: [
        {
          ...providerEvidence(
            "merge_queue_group",
            "refs/heads/gh-readonly-queue/main/pr-130",
            "protected_target",
            "pass",
          ),
          checks: nodeChecks.map((name) => ({
            name,
            unknown: true,
          })),
        },
      ],
      now,
    });

    expect(failed.protectedTargetGate.status).toBe("failed");
    expect(failed.blockers).toContain("merge queue protected target checks failed");
    expect(stale.protectedTargetGate.status).toBe("stale");
    expect(stale.blockers).toContain("merge queue protected target checks are stale");
    expect(missing.protectedTargetGate.status).toBe("missing");
    expect(missing.blockers).toContain("merge queue protected target checks are missing");
    expect(unknown.protectedTargetGate.status).toBe("unavailable");
    expect(unknown.blockers).toContain(
      "merge queue protected target check state is unknown",
    );
    expect([failed, stale, missing, unknown].map((report) => report.nextAction))
      .toEqual([
        "resolve_blockers",
        "resolve_blockers",
        "resolve_blockers",
        "resolve_blockers",
      ]);
  });
});

function reportForStatus(projectRoot: string, bucket: string) {
  return buildNexusMergeQueueReadinessReport({
    projectRoot,
    mergeQueueEnabled: true,
    workflowTriggers: mergeGroupTrigger,
    providerEvidence: [
      providerEvidence(
        "merge_queue_group",
        "refs/heads/gh-readonly-queue/main/pr-130",
        "protected_target",
        bucket,
      ),
    ],
    now,
  });
}

function providerEvidence(
  sourceKind: NexusPublicationProviderEvidenceInput["sourceKind"],
  headRef: string,
  intendedCiTier: string,
  bucket: string,
): NexusPublicationProviderEvidenceInput {
  return {
    provider: "github",
    sourceKind,
    headRef,
    targetBranch: "main",
    intendedCiTier,
    checks: nodeChecks.map((name) => ({
      name,
      bucket,
      workflow: "CI",
    })),
  };
}

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "merge-queue-demo",
    name: "Merge Queue Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [componentConfig("dev-nexus", "DevNexus")],
    worktreesRoot: "worktrees",
    automation: {
      ...defaultNexusAutomationConfig,
      verification: {
        ...defaultNexusAutomationConfig.verification,
        ciTiers: defaultNexusReleaseTrainCiTierPolicy,
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        targetBranch: "main",
        greenMain: {
          integrationPreference: "pull_request",
          integrationBranch: null,
          directTargetPush: "blocked",
          mergeAuthority: "authorized_merge",
          requiredChecks: [...nodeChecks],
          staleChecks: "block",
        },
      },
    },
    ...overrides,
  };
}

function componentConfig(id: string, name: string): NexusProjectConfig["components"][number] {
  return {
    id,
    name,
    kind: "git",
    role: id === "dev-nexus" ? "primary" : "dependency",
    remoteUrl: `git@example.invalid:demo/${id}.git`,
    defaultBranch: "main",
    sourceRoot: `components/${id}`,
    relationships: [],
  };
}
