import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  defaultNexusInitiativeDeliveryConfig,
} from "./nexusAutomationConfig.js";
import { buildNexusInitiativeDeliveryPlan } from "./nexusInitiativeDeliveryPlan.js";
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

describe("initiative delivery plan", () => {
  it("builds a read-only plan for configured initiative delivery policy", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-plan-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusInitiativeDeliveryPlan({
      projectRoot,
      componentId: "primary",
      initiativeId: "codex-goals",
    });

    expect(plan).toMatchObject({
      version: 1,
      projectRoot,
      project: {
        id: "initiative-plan-demo",
      },
      componentId: "primary",
      initiativeId: "codex-goals",
      itemCount: 1,
      mutatesSource: false,
      items: [
        {
          componentId: "primary",
          targetBranch: "main",
          publicationTrainVersionId: "v-next",
          initiative: {
            activeScopeId: "codex-goals",
            defaultTopology: "hybrid",
            branchPlan: {
              integrationBranch: "feat/codex-goals",
              sliceBranchPattern: "feat/codex-goals/{slice}",
              finalPublicationTarget: "main",
            },
          },
        },
      ],
      warnings: [],
    });
  });

  it("reports missing initiative delivery policy without mutating state", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-plan-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(),
      automation: defaultNexusAutomationConfig,
    });

    const plan = buildNexusInitiativeDeliveryPlan({ projectRoot });

    expect(plan.itemCount).toBe(0);
    expect(plan.warnings).toContain(
      "component primary has no initiative delivery policy configured",
    );
    expect(plan.mutatesSource).toBe(false);
  });
});

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "initiative-plan-demo",
    name: "Initiative Plan Demo",
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
            branchNaming: {
              ...defaultNexusInitiativeDeliveryConfig.branchNaming,
              defaultIntentPrefix: "feat",
            },
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
  };
}
