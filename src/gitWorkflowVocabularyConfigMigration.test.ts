import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("git workflow vocabulary config migration", () => {
  it("renames old release-train and feature-branch delivery config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-vocabulary-"));
    const configPath = path.join(root, "dev-nexus.project.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        automation: {
          publication: {
            publicationTrain: {
              initiativeDelivery: {
                activeInitiativeId: "codex-goals",
                defaultTopology: "hybrid",
                allowedTopologies: ["direct", "hybrid"],
                branchNaming: {
                  integrationBranchPattern: "{intent}/{initiative}",
                  sliceBranchPattern: "{intent}/{initiative}/{slice}",
                },
                review: {
                  mode: "slice_pr",
                  finalPullRequestCreation: "at_initiative_start",
                },
                provider: {
                  noise: "status_only",
                },
                branchPublication: {
                  strategy: "publication_remote_then_fallback",
                },
              },
            },
          },
        },
      }, null, 2),
    );

    const dryRun = runMigration(configPath);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("would update");

    const writeRun = runMigration("--write", configPath);
    expect(writeRun.status).toBe(0);
    expect(writeRun.stdout).toContain("updated");

    const migrated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(migrated.automation.publication).toMatchObject({
      releaseTrain: {
        featureBranchDelivery: {
          activeFeatureId: "codex-goals",
          defaultBranchStrategy: "hybrid",
          allowedBranchStrategies: ["direct", "hybrid"],
          branchNaming: {
            featureBranchPattern: "{intent}/{feature}",
            reviewBranchPattern: "{intent}/{feature}/{change}",
          },
          review: {
            mode: "review_branch_pr",
            finalPullRequestCreation: "at_feature_start",
          },
          provider: {
            commentPolicy: "status_only",
          },
          branchPublication: {
            strategy: "push_remote_then_fallback",
          },
        },
      },
    });
  });
});

function runMigration(...args: string[]) {
  return spawnSync(
    process.execPath,
    [path.resolve("scripts/update-git-workflow-vocabulary-config.mjs"), ...args],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
    },
  );
}
