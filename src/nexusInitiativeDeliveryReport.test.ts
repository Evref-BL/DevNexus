import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  defaultNexusInitiativeDeliveryConfig,
} from "./nexusAutomationConfig.js";
import { buildNexusInitiativeDeliveryReport } from "./nexusInitiativeDeliveryReport.js";
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

describe("initiative delivery report", () => {
  it("flags initiative pull requests that are behind the base branch", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusInitiativeDeliveryReport({
      projectRoot,
      componentId: "primary",
      initiativeId: "codex-goals",
      now: "2026-05-22T09:00:00.000Z",
      providerEvidence: [
        {
          provider: "github",
          sourceKind: "pull_request",
          reviewTarget: {
            kind: "pull_request",
            number: 243,
            url: "https://github.com/Evref-BL/DevNexus/pull/243",
            title: "Initiative delivery topology workflow",
          },
          headBranch: "feat/codex-goals",
          headSha: "abc123",
          targetBranch: "main",
          intendedCiTier: "remote_smoke",
          reviewState: "approved",
          mergeability: "mergeable",
          branchPolicy: "clear",
          baseStatus: "behind",
          checks: [
            { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
          ],
        },
      ],
    });

    expect(report).toMatchObject({
      version: 1,
      generatedAt: "2026-05-22T09:00:00.000Z",
      project: {
        id: "initiative-report-demo",
      },
      summary: {
        itemCount: 1,
        needsUpdateCount: 1,
        readyCount: 0,
      },
      nextAction: "update_branch",
      mutatesSource: false,
      items: [
        {
          componentId: "primary",
          initiativeId: "codex-goals",
          integrationBranch: "feat/codex-goals",
          finalPublicationTarget: "main",
          status: "needs_update",
          nextAction: "update_branch",
          providerEvidence: {
            reviewTarget: {
              number: 243,
            },
            checksStatus: "success",
            reviewState: "approved",
            mergeability: "mergeable",
            branchPolicy: "clear",
            baseStatus: "behind",
          },
          reasons: ["review branch base status is behind"],
        },
      ],
    });
  });

  it("reports ready initiative pull requests from green provider evidence", () => {
    const projectRoot = makeTempDir("dev-nexus-initiative-report-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const report = buildNexusInitiativeDeliveryReport({
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
          reviewDecision: "APPROVED",
          mergeability: true,
          branchPolicy: true,
          behindBase: false,
          checks: [
            { name: "Node 22 check (ubuntu-latest)", bucket: "pass" },
          ],
        },
      ],
    });

    expect(report.summary).toMatchObject({
      itemCount: 1,
      readyCount: 1,
      needsUpdateCount: 0,
    });
    expect(report.nextAction).toBe("ready_for_final_publication");
    expect(report.items[0]).toMatchObject({
      status: "ready",
      nextAction: "ready_for_final_publication",
      providerEvidence: {
        reviewState: "approved",
        baseStatus: "current",
      },
      reasons: [],
    });
  });
});

function projectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "initiative-report-demo",
    name: "Initiative Report Demo",
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
            milestones: [],
            assignees: [],
            providerQuery: null,
          },
        },
      },
    },
  };
}
