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
      finalPullRequestAction: {
        status: "create_at_review_gate",
        humanInTheLoop: false,
        providerAction: {
          kind: "pull_request_upsert",
          componentId: "primary",
          head: "feat/codex-goals",
          base: "main",
          title: "Finalize initiative codex-goals",
          draft: false,
        },
        reasons: ["final pull request is created at the review gate"],
        cliCommand:
          "dev-nexus publication pull-request upsert " +
          `${projectRoot} --component primary --head feat/codex-goals --base main ` +
          '--title "Finalize initiative codex-goals" --body ' +
          '"Finalize initiative codex-goals. Head: feat/codex-goals Base: main Review target: main Run initiative-finalization with current provider evidence before publication."',
      },
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

  it("reports a missing initiative-start final pull request as a create action", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      finalPullRequestCreation: "at_initiative_start",
    }));

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan.nextAction).toBe("create_pull_request");
    expect(plan.items[0]).toMatchObject({
      finalPullRequestAction: {
        status: "create_at_initiative_start",
        humanInTheLoop: false,
        providerAction: {
          kind: "pull_request_upsert",
          head: "feat/codex-goals",
          base: "main",
          title: "Finalize initiative codex-goals",
          draft: false,
        },
        reasons: ["final pull request should have been created at initiative start"],
      },
      reviewReadiness: {
        status: "needs_final_pull_request",
        nextAction: "create_pull_request",
      },
    });
  });

  it("renders fallback fork pull request heads in final PR actions", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    const sourceRoot = path.join(projectRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, ".git", "config"),
      `[remote "origin"]
	url = git@github.com:Evref-BL/DevNexus.git
[remote "fork"]
	url = git@github.com:Gabriel-Darbord/DevNexus.git
`,
      "utf8",
    );
    saveProjectConfig(projectRoot, projectConfig({
      branchPublication: {
        strategy: "fallback_remote",
        fallbackRemote: "fork",
      },
    }));

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan.items[0]).toMatchObject({
      finalPullRequestHead: {
        status: "fork_branch",
        branch: "feat/codex-goals",
        owner: "Gabriel-Darbord",
        repository: "DevNexus",
        displayRef: "Gabriel-Darbord:feat/codex-goals",
      },
      finalPullRequestAction: {
        status: "create_at_review_gate",
        providerAction: {
          head: "Gabriel-Darbord:feat/codex-goals",
        },
      },
    });
    expect(plan.items[0]!.finalPullRequestAction.cliCommand).toContain(
      "--head Gabriel-Darbord:feat/codex-goals",
    );
  });

  it("blocks fork final PR creation when fallback remote metadata is missing", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      branchPublication: {
        strategy: "fallback_remote",
        fallbackRemote: "fork",
      },
    }));

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan.nextAction).toBe("resolve_branch_policy");
    expect(plan.items[0]).toMatchObject({
      finalPullRequestHead: {
        status: "blocked",
        remote: "fork",
        setupAction:
          "configure remote fork with a GitHub URL before creating a fork pull request",
      },
      finalPullRequestAction: {
        status: "blocked",
        humanInTheLoop: true,
        providerAction: null,
      },
      reviewReadiness: {
        status: "blocked",
        nextAction: "resolve_branch_policy",
      },
    });
  });

  it("reports manual-only final pull request creation as a HITL action", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-finalization-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig({
      finalPullRequestCreation: "manual_only",
    }));

    const plan = buildNexusInitiativeFinalizationPlan({
      projectRoot,
      componentId: "primary",
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan.nextAction).toBe("manual_pull_request");
    expect(plan.items[0]).toMatchObject({
      finalPullRequestAction: {
        status: "manual_only",
        humanInTheLoop: true,
        providerAction: null,
        cliCommand: null,
        reasons: ["final pull request creation is manual-only"],
      },
      reviewReadiness: {
        status: "needs_final_pull_request",
        nextAction: "manual_pull_request",
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

  it("includes conservative update choices for diverged review branches", () => {
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
          baseStatus: "diverged",
          checks: [
            { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
          ],
        },
      ],
      now: "2026-05-22T21:15:00.000Z",
    });

    expect(plan.nextAction).toBe("update_branch");
    expect(plan.items[0]).toMatchObject({
      branchUpdateDecision: {
        status: "diverged",
        recommendation: "merge_update",
        conflictRisk: "elevated",
        ciFreshnessRisk: "stale",
        forceWithLeaseRequired: false,
        humanInTheLoop: false,
        choices: [
          {
            id: "merge_update",
            recommended: true,
            humanInTheLoop: false,
            forceWithLeaseRequired: false,
          },
          {
            id: "rebase",
            recommended: false,
            humanInTheLoop: true,
            forceWithLeaseRequired: true,
          },
          {
            id: "no_update",
            recommended: false,
          },
        ],
      },
      reviewReadiness: {
        status: "needs_update",
        nextAction: "update_branch",
      },
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

function projectConfig(options: {
  finalPullRequestCreation?: "at_initiative_start" | "at_review_gate" | "manual_only";
  branchPublication?: {
    strategy: "publication_remote" | "fallback_remote" | "publication_remote_then_fallback" | "manual_only";
    fallbackRemote: string | null;
  };
} = {}): NexusProjectConfig {
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
            review: {
              ...defaultNexusInitiativeDeliveryConfig.review,
              finalPullRequestCreation:
                options.finalPullRequestCreation ??
                defaultNexusInitiativeDeliveryConfig.review
                  .finalPullRequestCreation,
            },
            branchPublication: options.branchPublication ?? {
              ...defaultNexusInitiativeDeliveryConfig.branchPublication,
            },
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
