import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  defaultNexusInitiativeDeliveryConfig,
} from "./nexusAutomationConfig.js";
import { buildNexusInitiativeFinalizationPlan } from "./nexusInitiativeFinalizationPlan.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";

const tempDirs: string[] = [];

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

describe("initiative finalization plan", () => {
  it("recommends creating the final pull request only at the review gate", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan.nextAction).toBe("create_pull_request");
    expect(plan.summary).toMatchObject({
      needsFinalPullRequestCount: 1,
      needsProviderEvidenceCount: 0,
    });
    expect(plan.items[0]).toMatchObject({
      finalPullRequestCreation: "at_review_gate",
      reviewReadiness: {
        status: "needs_final_pull_request",
        nextAction: "create_pull_request",
        safeToReview: false,
        reasons: ["final pull request is created at the review gate"],
      },
      publicationReadiness: {
        status: "needs_final_pull_request",
        nextAction: "create_pull_request",
        authorizedToMerge: false,
      },
    });
  });

  it("distinguishes safe review from authorized publication", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      providerEvidence: [
        {
          provider: "github",
          sourceKind: "pull_request",
          reviewTarget: 243,
          headBranch: "feat/codex-goals",
          targetBranch: "main",
          intendedCiTier: "remote_smoke",
          reviewState: "waiting_for_approval",
          mergeability: "mergeable",
          branchPolicy: "blocked",
          baseStatus: "current",
          metadata: {
            draft: true,
          },
          checks: [
            { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
          ],
        },
      ],
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan).toMatchObject({
      version: 1,
      generatedAt: "2026-05-22T21:15:00.000Z",
      mutatesSource: false,
      nextAction: "request_review",
      summary: {
        itemCount: 1,
        safeToReviewCount: 1,
        readyForPublicationCount: 0,
        needsReviewCount: 1,
      },
      items: [
        {
          componentId: "primary",
          initiativeId: "codex-goals",
          integrationBranch: "feat/codex-goals",
          reviewReadiness: {
            status: "ready_for_review",
            nextAction: "request_review",
            safeToReview: true,
          },
          publicationReadiness: {
            status: "needs_review",
            nextAction: "request_review",
            authorizedToMerge: false,
          },
          publicationAuthority: {
            authorizedToMerge: false,
            humanInTheLoop: true,
          },
        },
      ],
    });
  });

  it("stops at human approval when final publication evidence is otherwise ready", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      providerEvidence: [
        {
          provider: "github",
          sourceKind: "pull_request",
          reviewTarget: 243,
          headBranch: "feat/codex-goals",
          targetBranch: "main",
          intendedCiTier: "remote_smoke",
          reviewState: "approved",
          mergeability: "mergeable",
          branchPolicy: "clear",
          baseStatus: "current",
          metadata: {
            draft: false,
          },
          checks: [
            { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
          ],
        },
      ],
    });

    expect(plan.nextAction).toBe("request_publication_approval");
    expect(plan.summary).toMatchObject({
      safeToReviewCount: 1,
      readyForPublicationCount: 1,
    });
    expect(plan.items[0]).toMatchObject({
      reviewReadiness: {
        status: "ready_for_review",
        safeToReview: true,
      },
      publicationReadiness: {
        status: "ready_for_publication",
        nextAction: "request_publication_approval",
        authorizedToMerge: false,
        reasons: ["final publication requires human approval"],
      },
    });
  });
});

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "initiative-finalization-demo",
    name: "Initiative Finalization Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        targetBranch: "main",
        publicationTrain: {
          enabled: true,
          activeVersionId: "v-next",
          branchNaming: {
            integrationPrefix: "integration",
            candidatePrefix: "candidate",
            unscopedName: "manual",
          },
          initiativeDelivery: {
            ...defaultNexusInitiativeDeliveryConfig,
            enabled: true,
            activeInitiativeId: "codex-goals",
            defaultTopology: "hybrid",
          },
          selector: {
            statuses: ["ready"],
            labels: [],
          },
        },
      },
    },
    components: [
      {
        id: "primary",
        name: "Primary",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/project.git",
        defaultBranch: "main",
        sourceRoot: "source",
        relationships: [],
      },
    ],
  };
}
