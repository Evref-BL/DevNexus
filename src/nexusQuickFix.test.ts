import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusQuickFixPlan,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0).reverse()) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("quick-fix planning", () => {
  it("plans a provider-native GitHub quick fix around bot identity and green-main publication", () => {
    const projectRoot = makeTempDir("dev-nexus-quick-fix-");
    saveProjectConfig(projectRoot, projectConfig());

    const plan = buildNexusQuickFixPlan({
      projectRoot,
      componentId: "core",
      workItemId: "github-50",
      topic: "quick fix mode",
      writeScope: ["src/nexusQuickFix.ts"],
    });

    expect(plan.issue).toMatchObject({
      workItemId: "github-50",
      repository: "example/demo",
      number: 50,
      url: "https://github.com/example/demo/issues/50",
    });
    expect(plan.branch).toMatchObject({
      name: "codex/core/quick-fix-mode",
      worktreeName: "codex-core-quick-fix-mode",
    });
    expect(plan.publication).toMatchObject({
      strategy: "green_main",
      remote: "bot",
      targetBranch: "main",
      commandEnvironment: {},
      requiredChecks: ["Node 24 check (ubuntu-latest)"],
    });
    expect(plan.startSteps[0]!.operation).toMatchObject({
      provider: "github",
      repository: "example/demo",
      capability: "actor.verify",
      backendPreference: "auto",
    });
    expect(plan.finishSteps.find((step) => step.id === "open-pr")?.operation)
      .toMatchObject({
        capability: "pull_request.upsert",
        arguments: {
          head: "codex/core/quick-fix-mode",
          base: "main",
        },
      });
    expect(
      plan.finishSteps.find((step) => step.id === "wait-required-checks")
        ?.operation,
    ).toMatchObject({
      capability: "pull_request.checks",
      arguments: {
        number: "<pr-number>",
        watch: true,
      },
    });
    expect(plan.finishSteps.find((step) => step.id === "merge-pr")?.operation)
      .toMatchObject({
        capability: "pull_request.merge",
        arguments: {
          number: "<pr-number>",
          method: "merge",
          deleteBranch: true,
        },
      });
    expect(plan.finishSteps.find((step) => step.id === "close-issue")?.operation)
      .toMatchObject({
        capability: "issue.close",
        arguments: {
          number: 50,
        },
      });
    expect(plan.startSteps.map((step) => step.id)).toEqual([
      "validate-bot-identity",
      "prepare-worktree",
      "mark-in-progress",
    ]);
    expect(plan.startSteps[1]!.command).toContain("worktree prepare");
    expect(plan.startSteps[1]!.command).toContain("--work-item github-50");
    expect(plan.finishSteps.map((step) => step.id)).toContain("close-issue");
    expect(plan.finishSteps.map((step) => step.id)).toContain(
      "cleanup-worktree",
    );
    expect(plan.skippedBookkeeping.join("\n")).toContain(
      "dogfood metadata PR",
    );
    expect(plan.warnings).toEqual([]);
  });

  it("rejects components without a GitHub primary tracker", () => {
    const projectRoot = makeTempDir("dev-nexus-quick-fix-");
    saveProjectConfig(projectRoot, projectConfig({
      workTrackers: [
        {
          id: "local",
          name: "Local",
          enabled: true,
          roles: ["primary"],
          workTracking: {
            provider: "local",
          },
        },
      ],
      defaultWorkTrackerId: "local",
    }));

    expect(() =>
      buildNexusQuickFixPlan({
        projectRoot,
        componentId: "core",
        workItemId: "local-1",
      }),
    ).toThrow(/does not have a GitHub primary\/default tracker/);
  });
});

function projectConfig(
  componentOverrides: Partial<NexusProjectConfig["components"][number]> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "quick-fix-demo",
    name: "Quick Fix Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:example/demo.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:example/demo.git",
        defaultBranch: "main",
        sourceRoot: "source",
        worktreesRoot: "worktrees/core",
        defaultWorkTrackerId: "github",
        workTrackers: [
          {
            id: "github",
            name: "GitHub Issues",
            enabled: true,
            roles: ["primary", "eligible_source"],
            workTracking: {
              provider: "github",
              repository: {
                owner: "example",
                name: "demo",
              },
            },
          },
        ],
        verification: {
          focusedCommands: ["npm test -- src/nexusQuickFix.test.ts"],
          fullCommands: ["npm run check"],
          requirePassing: true,
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "green_main",
          remote: "bot",
          targetBranch: "main",
          greenMain: {
            integrationPreference: "pull_request",
            directTargetPush: "blocked",
            mergeAuthority: "authorized_merge",
            requiredChecks: ["Node 24 check (ubuntu-latest)"],
            staleChecks: "block",
          },
        },
        relationships: [],
        ...componentOverrides,
      },
    ],
    automation: defaultNexusAutomationConfig,
  };
}
