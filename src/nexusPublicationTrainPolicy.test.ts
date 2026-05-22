import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
} from "./nexusAutomationConfig.js";
import {
  summarizeNexusPublicationTrainPolicy,
} from "./nexusPublicationTrainPolicy.js";
import {
  saveProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { resolveProjectComponents } from "./nexusProjectLifecycle.js";

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

describe("publication train policy", () => {
  it("summarizes configured branch names, active version, CI budget, and selector posture", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-train-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, config);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    const summary = summarizeNexusPublicationTrainPolicy({
      projectConfig: config,
      component,
    });

    expect(summary).toMatchObject({
      enabled: true,
      componentId: "primary",
      activeVersionId: "0.2.0",
      activeVersionFound: true,
      objective: "Batch CI-sensitive publication work.",
      targetBranch: "main",
      branches: {
        integrationBranch: "integration/0.2.0",
        candidateBranch: "candidate/0.2.0",
      },
      initiativeDelivery: {
        enabled: true,
        activeScopeId: "initiative-a",
        branchSlug: "initiative-a",
        defaultTopology: "hybrid",
        defaultIntentPrefix: "feat",
        providerNoise: "status_only",
        branchPlan: {
          integrationBranch: "feat/initiative-a",
          sliceBranchPattern: "feat/initiative-a/{slice}",
          defaultSliceBaseBranch: "feat/initiative-a",
          finalPublicationTarget: "main",
        },
      },
      selector: {
        statuses: ["ready"],
        labels: [],
        requiresPublicLabel: false,
      },
      ciTiers: {
        defaultTier: "remote_smoke",
        source: "publication_train",
        fullMatrixBudget: {
          minimumIntervalMinutes: 90,
          minimumChangeCount: 4,
        },
      },
      warnings: [],
    });
  });

  it("returns null when the workspace has not opted into publication train policy", () => {
    const projectRoot = makeTempDir("dev-nexus-publication-train-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig({
      automation: defaultNexusAutomationConfig,
      versionPlanning: undefined,
    });
    saveProjectConfig(projectRoot, config);
    const component = resolveProjectComponents(projectRoot, config)[0]!;

    expect(
      summarizeNexusPublicationTrainPolicy({
        projectConfig: config,
        component,
      }),
    ).toBeNull();
  });
});

function projectConfig(
  overrides: Partial<NexusProjectConfig> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "publication-train-demo",
    name: "Publication Train Demo",
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
          activeVersionId: "0.2.0",
          branchNaming: {
            integrationPrefix: "integration",
            candidatePrefix: "candidate",
            unscopedName: "manual",
          },
          initiativeDelivery: {
            enabled: true,
            activeInitiativeId: "initiative-a",
            defaultTopology: "hybrid",
            branchNaming: {
              defaultIntentPrefix: "feat",
            },
          },
          ciTiers: {
            enabled: true,
            defaultTier: "remote_smoke",
            fullMatrixBudget: {
              minimumIntervalMinutes: 90,
              minimumChangeCount: 4,
            },
            tiers: [
              {
                id: "remote_smoke",
                name: "Cheap remote smoke",
                cost: "low",
                requiredChecks: ["Node 22 check (ubuntu-latest)"],
                optionalChecks: [],
                branchPatterns: [],
                eventNames: ["pull_request"],
              },
              {
                id: "candidate_matrix",
                name: "Candidate matrix",
                cost: "high",
                requiredChecks: [
                  "Node 22 check (ubuntu-latest)",
                  "Node 22 check (windows-latest)",
                  "Node 22 check (macos-latest)",
                ],
                optionalChecks: [],
                branchPatterns: ["candidate/**", "integration/**"],
                eventNames: ["pull_request", "push"],
              },
            ],
          },
          selector: {
            statuses: ["ready"],
            labels: [],
            milestones: [],
            assignees: [],
            providerQuery: null,
          },
        },
      },
    },
    versionPlanning: {
      versions: [
        {
          id: "0.2.0",
          objective: "Batch CI-sensitive publication work.",
          owningComponents: ["primary"],
          targetBranch: "main",
          scope: [],
          readinessGates: [],
          releasePolicy: {
            tags: "none",
            packages: "none",
            providerRelease: "none",
            releaseNotes: "none",
            changelog: "none",
          },
        },
      ],
    },
    ...overrides,
  };
}
