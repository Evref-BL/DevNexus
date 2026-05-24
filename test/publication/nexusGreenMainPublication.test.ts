import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusGreenMainPublicationPlan,
  defaultNexusAutomationConfig,
  saveProjectConfig,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
        targetBranch: "main",
      },
    },
    ...overrides,
  };
}

function saveGreenMainProject(): string {
  const projectRoot = makeTempDir("dev-nexus-green-main-project-");
  saveProjectConfig(
    projectRoot,
    projectConfig({
      components: [
        {
          id: "primary",
          name: "Primary",
          kind: "git",
          role: "primary",
          remoteUrl: "git@example.invalid:demo/project.git",
          defaultBranch: "main",
          sourceRoot: "source",
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
            focusedCommands: ["npm test -- src/nexusGreenMainPublication.test.ts"],
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
              integrationBranch: null,
              directTargetPush: "blocked",
              mergeAuthority: "authorized_merge",
              requiredChecks: [
                "Node 22 check (ubuntu-latest)",
                "Node 22 check (windows-latest)",
              ],
              staleChecks: "block",
            },
          },
          relationships: [],
        },
      ],
    }),
  );
  return projectRoot;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("green-main publication planning", () => {
  it("allows merge commands only when all required checks are green", () => {
    const projectRoot = saveGreenMainProject();

    const plan = buildNexusGreenMainPublicationPlan({
      projectRoot,
      componentId: "primary",
      prNumber: 12,
      headBranch: "codex/primary/green-main",
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          bucket: "pass",
          link: "https://github.com/example/demo/actions/runs/1001/job/1",
        },
        {
          name: "Node 22 check (windows-latest)",
          bucket: "pass",
          link: "https://github.com/example/demo/actions/runs/1002/job/2",
        },
      ],
    });

    expect(plan.status).toBe("green");
    expect(plan.merge.allowed).toBe(true);
    expect(plan.commands.merge.enabled).toBe(true);
    expect(plan.commands.merge.command).toContain("gh pr merge 12");
    expect(plan.commands.merge.operation).toMatchObject({
      provider: "github",
      repository: "example/demo",
      capability: "pull_request.merge",
      backendPreference: "auto",
      arguments: {
        number: 12,
        method: "merge",
        deleteBranch: true,
      },
    });
    expect(plan.commands.waitRequiredChecks.operation).toMatchObject({
      capability: "pull_request.checks",
      arguments: {
        number: 12,
        required: true,
        watch: true,
      },
    });
    expect(plan.warnings).not.toContain(
      "Publication policy does not set GH_CONFIG_DIR.",
    );
    expect(plan.rerun.decision).toBe("not_needed");
  });

  it("summarizes known failed jobs and blocks merge by default", () => {
    const projectRoot = saveGreenMainProject();

    const plan = buildNexusGreenMainPublicationPlan({
      projectRoot,
      componentId: "primary",
      prNumber: 12,
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          bucket: "pass",
        },
        {
          name: "Node 22 check (windows-latest)",
          bucket: "fail",
          workflow: "Node CI",
          link: "https://github.com/example/demo/actions/runs/1002/job/2",
          failure: {
            step: "Run npm test",
            test: "green-main publication planning > blocks pending checks",
            message: "expected true to be false",
          },
        },
      ],
    });

    expect(plan.status).toBe("failed");
    expect(plan.merge.allowed).toBe(false);
    expect(plan.commands.merge.enabled).toBe(false);
    expect(plan.rerun.decision).toBe("blocked_policy");
    expect(plan.failedJobs).toMatchObject([
      {
        name: "Node 22 check (windows-latest)",
        platform: "windows-latest",
        workflow: "Node CI",
        runId: "1002",
        failingStep: "Run npm test",
        failingTest: "green-main publication planning > blocks pending checks",
        classification: "classified_failure",
      },
    ]);
  });

  it("requires an explicit one-rerun policy and reason before proposing rerun", () => {
    const projectRoot = saveGreenMainProject();

    const withoutReason = buildNexusGreenMainPublicationPlan({
      projectRoot,
      componentId: "primary",
      prNumber: 12,
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          bucket: "pass",
        },
        {
          name: "Node 22 check (windows-latest)",
          bucket: "fail",
          link: "https://github.com/example/demo/actions/runs/1002/job/2",
        },
      ],
      rerunPolicy: {
        allowed: true,
      },
    });

    expect(withoutReason.rerun.decision).toBe("blocked_reason_required");

    const withReason = buildNexusGreenMainPublicationPlan({
      projectRoot,
      componentId: "primary",
      prNumber: 12,
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          bucket: "pass",
        },
        {
          name: "Node 22 check (windows-latest)",
          bucket: "fail",
          link: "https://github.com/example/demo/actions/runs/1002/job/2",
        },
      ],
      rerunPolicy: {
        allowed: true,
        reason: "transient hosted runner failure",
      },
    });

    expect(withReason.rerun.decision).toBe("rerun_once");
    expect(withReason.commands.rerunFailedRun.enabled).toBe(true);
    expect(withReason.commands.rerunFailedRun.command).toContain(
      "gh run rerun 1002",
    );
  });

  it("classifies unparsed failures as manual investigation required", () => {
    const projectRoot = saveGreenMainProject();

    const plan = buildNexusGreenMainPublicationPlan({
      projectRoot,
      componentId: "primary",
      prNumber: 12,
      checks: [
        {
          name: "Node 22 check (ubuntu-latest)",
          bucket: "pass",
        },
        {
          name: "Node 22 check (windows-latest)",
          bucket: "fail",
        },
      ],
    });

    expect(plan.failedJobs[0]?.classification).toBe(
      "manual_investigation_required",
    );
  });
});
