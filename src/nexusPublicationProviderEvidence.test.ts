import { describe, expect, it } from "vitest";
import {
  classifyNexusPublicationProviderEvidenceChecks,
  findNexusPublicationProviderEvidence,
  normalizeNexusPublicationProviderEvidence,
} from "./nexusPublicationProviderEvidence.js";

const nodeChecks = [
  "Node 24 check (ubuntu-latest)",
  "Node 24 check (windows-latest)",
  "Node 24 check (macos-latest)",
];

describe("publication provider evidence facade", () => {
  it("normalizes GitHub pull request evidence without coupling to gh output", () => {
    const evidence = normalizeNexusPublicationProviderEvidence([
      {
        provider: "github",
        sourceKind: "pull_request",
        reviewTarget: {
          kind: "pull_request",
          number: 130,
          url: "https://github.com/Evref-BL/DevNexus/pull/130",
          title: "Add provider evidence facade",
        },
        headBranch: "codex/dev-nexus/github-122-provider-train-evidence",
        headSha: "abc123",
        targetBranch: "main",
        intendedCiTier: "remote_smoke",
        mergeability: "mergeable",
        branchPolicy: "clear",
        checks: [
          {
            name: "Node 24 check (ubuntu-latest)",
            status: "completed",
            conclusion: "success",
            workflow: "CI",
            jobName: "Node 24 check (ubuntu-latest)",
            detailsUrl: "https://github.com/Evref-BL/DevNexus/actions/runs/1",
          },
        ],
      },
    ]);

    expect(evidence[0]).toMatchObject({
      provider: "github",
      sourceKind: "pull_request",
      reviewTarget: {
        kind: "pull_request",
        number: 130,
      },
      headBranch: "codex/dev-nexus/github-122-provider-train-evidence",
      headRef: "codex/dev-nexus/github-122-provider-train-evidence",
      headSha: "abc123",
      targetBranch: "main",
      intendedCiTier: "remote_smoke",
      mergeability: "mergeable",
      branchPolicy: "clear",
      checks: [
        {
          name: "Node 24 check (ubuntu-latest)",
          status: "success",
          workflowName: "CI",
          jobName: "Node 24 check (ubuntu-latest)",
          runId: "1",
        },
      ],
    });
  });

  it("classifies branch check evidence states for required publication gates", () => {
    const evidence = normalizeNexusPublicationProviderEvidence([
      {
        provider: "generic",
        sourceKind: "branch",
        branchName: "candidate/0.2.0",
        headCommit: "abc123",
        targetBranch: "main",
        intendedCiTier: "candidate_matrix",
        checks: [
          { name: nodeChecks[0]!, bucket: "pass" },
          { name: nodeChecks[1]!, bucket: "pending" },
          { name: nodeChecks[2]!, bucket: "pass" },
        ],
      },
      {
        provider: "generic",
        sourceKind: "branch",
        branchName: "candidate/0.3.0",
        checks: [
          { name: nodeChecks[0]!, bucket: "pass", stale: true },
          { name: nodeChecks[1]!, bucket: "pass" },
          { name: nodeChecks[2]!, bucket: "pass" },
        ],
      },
      {
        provider: "generic",
        sourceKind: "branch",
        branchName: "candidate/0.4.0",
        checks: [
          { name: nodeChecks[0]!, bucket: "fail" },
          { name: nodeChecks[1]!, bucket: "pass" },
          { name: nodeChecks[2]!, bucket: "pass" },
        ],
      },
      {
        provider: "generic",
        sourceKind: "branch",
        branchName: "candidate/0.5.0",
        checks: [
          { name: nodeChecks[0]!, unknown: true },
          { name: nodeChecks[1]!, bucket: "pass" },
          { name: nodeChecks[2]!, bucket: "pass" },
        ],
      },
    ]);

    expect(
      classifyNexusPublicationProviderEvidenceChecks({
        evidence: findNexusPublicationProviderEvidence(evidence, {
          branchName: "candidate/0.2.0",
        }),
        requiredChecks: nodeChecks,
      }),
    ).toMatchObject({
      status: "pending",
      message: "one or more required checks are pending",
    });
    expect(
      classifyNexusPublicationProviderEvidenceChecks({
        evidence: findNexusPublicationProviderEvidence(evidence, {
          branchName: "candidate/0.3.0",
        }),
        requiredChecks: nodeChecks,
      }),
    ).toMatchObject({
      status: "stale",
      message: "one or more required checks are stale",
    });
    expect(
      classifyNexusPublicationProviderEvidenceChecks({
        evidence: findNexusPublicationProviderEvidence(evidence, {
          branchName: "candidate/0.4.0",
        }),
        requiredChecks: nodeChecks,
      }),
    ).toMatchObject({
      status: "failed",
      message: "one or more required checks failed",
    });
    expect(
      classifyNexusPublicationProviderEvidenceChecks({
        evidence: findNexusPublicationProviderEvidence(evidence, {
          branchName: "candidate/0.5.0",
        }),
        requiredChecks: nodeChecks,
      }),
    ).toMatchObject({
      status: "unavailable",
      message: "required check evidence is incomplete",
    });
  });

  it("distinguishes candidate, merge queue, and scheduled validation sources", () => {
    const evidence = normalizeNexusPublicationProviderEvidence([
      {
        provider: "github",
        branchName: "candidate/0.2.0",
        checks: [],
      },
      {
        provider: "github",
        sourceKind: "merge_group",
        headRef: "refs/heads/gh-readonly-queue/main/pr-130",
        targetBranch: "main",
        intendedCiTier: "protected_target",
        checks: [],
      },
      {
        provider: "gitlab",
        sourceKind: "schedule",
        targetBranch: "main",
        intendedCiTier: "scheduled_drift",
        checks: [],
      },
    ]);

    expect(evidence.map((item) => item.sourceKind)).toEqual([
      "candidate_branch",
      "merge_queue_group",
      "scheduled_validation",
    ]);
    expect(
      findNexusPublicationProviderEvidence(evidence, {
        sourceKind: "merge_queue_group",
        targetBranch: "main",
        intendedCiTier: "protected_target",
      }),
    ).toMatchObject({
      sourceKind: "merge_queue_group",
      headRef: "refs/heads/gh-readonly-queue/main/pr-130",
    });
  });

  it("reports missing required checks separately from missing provider evidence", () => {
    const evidence = normalizeNexusPublicationProviderEvidence([
      {
        branchName: "candidate/0.2.0",
        checks: [{ name: nodeChecks[0]!, bucket: "pass" }],
      },
    ]);

    expect(
      classifyNexusPublicationProviderEvidenceChecks({
        evidence: findNexusPublicationProviderEvidence(evidence, {
          branchName: "candidate/0.2.0",
        }),
        requiredChecks: nodeChecks,
      }),
    ).toMatchObject({
      status: "missing",
      requiredChecks: [
        { name: nodeChecks[0], status: "success" },
        { name: nodeChecks[1], status: "missing" },
        { name: nodeChecks[2], status: "missing" },
      ],
    });

    expect(
      classifyNexusPublicationProviderEvidenceChecks({
        evidence: null,
        requiredChecks: nodeChecks,
      }),
    ).toMatchObject({
      status: "unavailable",
      message: "provider check evidence is unavailable",
    });
  });
});
